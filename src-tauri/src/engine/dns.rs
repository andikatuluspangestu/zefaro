//! Zefaro's DNS: a tiny authoritative server that answers every name under the
//! local TLD (`*.test`) with 127.0.0.1, plus the Windows NRPT rule that sends
//! only `.test` lookups to it. Together they replace a hosts-file entry per
//! site and also cover subdomains (api.blog.test).
//!
//! The server runs as `zefaro.exe --dns <port> <tld>` under the supervisor, so it
//! gets the same logs, crash restarts and Job Object cleanup as nginx/php-cgi.
//! The NRPT rule is the only privileged part: added once through a UAC prompt.

use crate::engine::supervisor::{Probe, Spec};
use crate::engine::{paths, process};
use crate::error::{AppError, AppResult};
use std::net::{Ipv4Addr, ToSocketAddrs, UdpSocket};
use std::path::Path;
use std::time::Duration;

pub const SERVICE_ID: &str = "dns";
pub const PORT: u16 = 53;
/// Seconds clients may cache an answer.
const TTL: u32 = 60;
const TYPE_A: u16 = 1;
const TYPE_ANY: u16 = 255;
const CLASS_IN: u16 = 1;
const RCODE_FORMERR: u16 = 1;
const RCODE_NOTIMP: u16 = 4;
const RCODE_REFUSED: u16 = 5;

/// Answer one DNS query packet. Names under `tld` get A → 127.0.0.1; other
/// record types get an empty NOERROR answer so clients stick to IPv4 (nginx
/// only listens on 127.0.0.1, so offering ::1 would just add a failed
/// attempt). Names outside the TLD are REFUSED. Returns None for packets to
/// drop silently (responses, fragments).
pub fn respond(query: &[u8], tld: &str) -> Option<Vec<u8>> {
    if query.len() < 12 {
        return None;
    }
    let flags = u16::from_be_bytes([query[2], query[3]]);
    if flags & 0x8000 != 0 {
        return None; // a response, not a query
    }
    let opcode = (flags >> 11) & 0x0F;
    let qdcount = u16::from_be_bytes([query[4], query[5]]);
    // QR + same opcode + AA (authoritative for the TLD) + echo RD.
    let base = 0x8000 | (opcode << 11) | 0x0400 | (flags & 0x0100);
    let header_only = |rcode: u16| {
        let mut out = query[..2].to_vec();
        out.extend((base | rcode).to_be_bytes());
        out.extend([0u8; 8]);
        out
    };
    if opcode != 0 {
        return Some(header_only(RCODE_NOTIMP));
    }
    if qdcount != 1 {
        return Some(header_only(RCODE_FORMERR));
    }
    let Some((name, end)) = read_name(query, 12) else {
        return Some(header_only(RCODE_FORMERR));
    };
    let Some(tail) = query.get(end..end + 4) else {
        return Some(header_only(RCODE_FORMERR));
    };
    let qtype = u16::from_be_bytes([tail[0], tail[1]]);
    let qclass = u16::from_be_bytes([tail[2], tail[3]]);

    let ours = name == tld || name.ends_with(&format!(".{tld}"));
    let answer = ours && qclass == CLASS_IN && (qtype == TYPE_A || qtype == TYPE_ANY);
    let rcode = if ours { 0 } else { RCODE_REFUSED };

    let question = &query[12..end + 4];
    let mut out = Vec::with_capacity(question.len() + 28);
    out.extend_from_slice(&query[..2]);
    out.extend((base | rcode).to_be_bytes());
    out.extend(1u16.to_be_bytes()); // QDCOUNT
    out.extend(u16::from(answer).to_be_bytes()); // ANCOUNT
    out.extend([0u8; 4]); // NSCOUNT, ARCOUNT
    out.extend_from_slice(question);
    if answer {
        out.extend([0xC0, 0x0C]); // name: pointer to the question
        out.extend(TYPE_A.to_be_bytes());
        out.extend(CLASS_IN.to_be_bytes());
        out.extend(TTL.to_be_bytes());
        out.extend(4u16.to_be_bytes());
        out.extend(Ipv4Addr::LOCALHOST.octets());
    }
    Some(out)
}

/// Read an uncompressed name at `pos`, lowercased: ("blog.test", end offset).
fn read_name(packet: &[u8], mut pos: usize) -> Option<(String, usize)> {
    let mut labels = Vec::new();
    loop {
        let len = *packet.get(pos)? as usize;
        pos += 1;
        if len == 0 {
            break;
        }
        // > 63 would be a compression pointer, which a question can't use.
        if len > 63 || pos + len > 12 + 255 {
            return None;
        }
        labels.push(String::from_utf8_lossy(packet.get(pos..pos + len)?).to_ascii_lowercase());
        pos += len;
    }
    Some((labels.join("."), pos))
}

/// A standard query for `name`.
pub fn build_query(id: u16, name: &str, qtype: u16) -> Vec<u8> {
    let mut q = id.to_be_bytes().to_vec();
    q.extend(0x0100u16.to_be_bytes()); // RD
    q.extend(1u16.to_be_bytes()); // QDCOUNT
    q.extend([0u8; 6]);
    for label in name.split('.').filter(|l| !l.is_empty()) {
        q.push(label.len() as u8);
        q.extend(label.as_bytes());
    }
    q.push(0);
    q.extend(qtype.to_be_bytes());
    q.extend(CLASS_IN.to_be_bytes());
    q
}

/// Does the server on 127.0.0.1:`port` answer `*.{tld}` with 127.0.0.1?
/// Used as the supervisor's health check.
pub fn probe(port: u16, tld: &str) -> bool {
    let Ok(sock) = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)) else {
        return false;
    };
    let _ = sock.set_read_timeout(Some(Duration::from_millis(300)));
    let id = (std::process::id() as u16) ^ 0x4844;
    let query = build_query(id, &format!("zefaro-probe.{tld}"), TYPE_A);
    if sock.send_to(&query, (Ipv4Addr::LOCALHOST, port)).is_err() {
        return false;
    }
    let mut buf = [0u8; 512];
    match sock.recv(&mut buf) {
        Ok(n) => {
            n >= 16
                && buf[..2] == id.to_be_bytes()
                && u16::from_be_bytes([buf[6], buf[7]]) >= 1
                && buf[n - 4..n] == Ipv4Addr::LOCALHOST.octets()
        }
        Err(_) => false,
    }
}

/// Serve forever on 127.0.0.1:`port`.
pub fn serve(port: u16, tld: &str) -> std::io::Result<()> {
    let sock = UdpSocket::bind((Ipv4Addr::LOCALHOST, port))?;
    println!("Zefaro DNS: answering *.{tld} on 127.0.0.1:{port}");
    let mut buf = [0u8; 1500];
    loop {
        // Windows surfaces an ICMP "port unreachable" for an earlier reply as
        // an error on the next receive (WSAECONNRESET); keep serving.
        let Ok((n, peer)) = sock.recv_from(&mut buf) else {
            continue;
        };
        if let Some(reply) = respond(&buf[..n], tld) {
            let _ = sock.send_to(&reply, peer);
        }
    }
}

/// `zefaro.exe --dns [port] [tld]`; returns the process exit code.
pub fn cli(args: &[String]) -> i32 {
    let port = args.first().and_then(|p| p.parse().ok()).unwrap_or(PORT);
    let tld = args.get(1).cloned().unwrap_or_else(|| "test".into());
    match serve(port, &tld) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("Zefaro DNS: cannot listen on 127.0.0.1:{port} (UDP): {e}");
            1
        }
    }
}

/// The DNS service: this same executable in `--dns` mode.
pub fn spec(tld: &str) -> AppResult<Spec> {
    let exe = std::env::current_exe()?;
    Ok(Spec {
        id: SERVICE_ID.into(),
        cwd: exe.parent().map(Path::to_path_buf).unwrap_or_default(),
        args: vec!["--dns".into(), PORT.to_string().into(), tld.into()],
        program: exe,
        env: Vec::new(),
        log: paths::logs_dir().join("dns.log"),
        port: PORT,
        probe: Probe::Dns { tld: tld.into() },
        stop: None,
    })
}

const RULE_COMMENT: &str = "Zefaro: local development sites";

/// The TLD ends up in PowerShell scripts and an NRPT rule: plain labels only.
fn check_tld(tld: &str) -> AppResult<()> {
    if !tld.is_empty() && tld.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        Ok(())
    } else {
        Err(AppError::msg(crate::tr!(
            format!(".{tld} isn't a valid local domain."),
            format!(".{tld} bukan domain lokal yang valid.")
        )))
    }
}

fn rule_missing(tld: &str) -> AppError {
    AppError::msg(crate::tr!(
        format!("Windows didn't add the .{tld} DNS rule."),
        format!("Windows tidak menambahkan aturan DNS .{tld}.")
    ))
}

/// Is there an NRPT rule sending `.{tld}` lookups to 127.0.0.1? Readable
/// without admin rights.
pub fn rule_installed(tld: &str) -> bool {
    if check_tld(tld).is_err() {
        return false;
    }
    let script = format!(
        "if (Get-DnsClientNrptRule -ErrorAction SilentlyContinue | Where-Object {{ \
           $_.Namespace -contains '.{tld}' -and $_.NameServers -contains '127.0.0.1' }}) {{ 'yes' }} else {{ 'no' }}"
    );
    process::powershell(&script).map(|o| o.trim() == "yes").unwrap_or(false)
}

/// Add the NRPT rule (replacing any existing `.{tld}` rule, which would
/// conflict). Shows a UAC prompt.
pub fn install_rule(tld: &str) -> AppResult<()> {
    check_tld(tld)?;
    run_elevated(&format!(
        "Get-DnsClientNrptRule | Where-Object {{ $_.Namespace -contains '.{tld}' }} | Remove-DnsClientNrptRule -Force; \
         Add-DnsClientNrptRule -Namespace '.{tld}' -NameServers '127.0.0.1' -Comment '{RULE_COMMENT}'; \
         Clear-DnsClientCache"
    ))?;
    if !rule_installed(tld) {
        return Err(rule_missing(tld));
    }
    Ok(())
}

/// Local domains Zefaro offers. All are reserved and never exist on the public
/// internet, so no real website can be shadowed: `.test` by RFC 2606,
/// `.internal` by ICANN for private use (2024), and `.localhost` by RFC 6761.
pub const ALLOWED_TLDS: &[&str] = &["test", "internal", "localhost"];

/// The one local domain that needs no Windows rule, and so no admin rights.
pub const LOCALHOST: &str = "localhost";

/// Does this domain need the one-time Windows DNS rule (an admin prompt)?
/// `.localhost` doesn't: Chrome, Edge and Firefox send every `*.localhost`
/// name to this computer themselves. Windows 10 itself doesn't resolve them,
/// so programs other than browsers (curl, a site calling its own address)
/// can't find those names.
pub fn needs_rule(tld: &str) -> bool {
    tld != LOCALHOST
}

/// Does this `whoami /groups` listing include the Administrators group
/// (S-1-5-32-544)? An administrator's everyday token lists it as "deny only",
/// which still means the account can approve an admin prompt; a standard
/// account doesn't have it at all.
fn lists_admins(groups: &str) -> bool {
    groups.contains("S-1-5-32-544")
}

/// Can this Windows account approve an admin (UAC) prompt? A standard account
/// can't, and the one-time DNS rule then can't be added. When it can't be
/// told, the answer is yes, so nobody is steered away from `.test` by mistake.
pub fn can_elevate() -> bool {
    static CAN: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CAN.get_or_init(|| {
        process::run(process::command("whoami").arg("/groups")).map(|out| lists_admins(&out)).unwrap_or(true)
    })
}

/// What to add to a failed admin step when the account can't give admin rights.
fn no_admin_hint() -> String {
    if can_elevate() {
        return String::new();
    }
    let hint = crate::tr!(
        " This Windows account can't approve admin prompts. Switch the local domain to .localhost in DNS settings: it needs no admin rights.",
        " Akun Windows ini tidak bisa menyetujui permintaan admin. Ganti domain lokal ke .localhost di pengaturan DNS: tidak butuh hak admin."
    );
    hint.to_owned()
}

/// Point Zefaro's rule at another TLD: drop the rule Zefaro added and add one for
/// `tld`, in a single UAC prompt.
pub fn move_rule(tld: &str) -> AppResult<()> {
    check_tld(tld)?;
    run_elevated(&format!(
        "Get-DnsClientNrptRule | Where-Object {{ $_.Comment -eq '{RULE_COMMENT}' -or $_.Namespace -contains '.{tld}' }} | Remove-DnsClientNrptRule -Force; \
         Add-DnsClientNrptRule -Namespace '.{tld}' -NameServers '127.0.0.1' -Comment '{RULE_COMMENT}'; \
         Clear-DnsClientCache"
    ))?;
    if !rule_installed(tld) {
        return Err(rule_missing(tld));
    }
    Ok(())
}

/// Empty Windows' DNS cache, so names resolve afresh. Needs no admin rights.
pub fn flush_cache() -> AppResult<()> {
    process::powershell("Clear-DnsClientCache -ErrorAction Stop").map(|_| ())
}

/// Remove the rule Zefaro added (identified by its comment). Shows a UAC prompt.
pub fn remove_rule() -> AppResult<()> {
    run_elevated(&format!(
        "Get-DnsClientNrptRule | Where-Object {{ $_.Comment -eq '{RULE_COMMENT}' }} | Remove-DnsClientNrptRule -Force; \
         Clear-DnsClientCache"
    ))
}

/// Does Windows itself resolve `*.{tld}` to this machine? This goes through
/// the normal system resolver, so it proves the NRPT rule is in effect.
/// Retries briefly, since Windows can take a moment to apply a new rule.
pub fn os_resolves(tld: &str) -> bool {
    for attempt in 0..4 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(500));
        }
        let resolved = format!("zefaro-check-{attempt}.{tld}:80")
            .to_socket_addrs()
            .map(|mut addrs| addrs.any(|a| a.ip() == Ipv4Addr::LOCALHOST))
            .unwrap_or(false);
        if resolved {
            return true;
        }
    }
    false
}

/// Run a PowerShell script as administrator: Windows shows its UAC prompt and
/// this waits for the elevated process to finish. The script travels as
/// -EncodedCommand (Base64 of UTF-16LE), so no quoting can break it.
fn run_elevated(script: &str) -> AppResult<()> {
    let wrapped = format!("$ErrorActionPreference = 'Stop'; {script}");
    let utf16: Vec<u8> = wrapped.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let encoded = base64(&utf16);
    // 1223 = ERROR_CANCELLED: the user said no to the UAC prompt.
    let launcher = format!(
        "try {{ \
           $p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden \
             -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','{encoded}'; \
           exit $p.ExitCode \
         }} catch {{ \
           $e = $_.Exception; while ($e) {{ if ($e.NativeErrorCode -eq 1223) {{ exit 1223 }}; $e = $e.InnerException }}; \
           Write-Error $_.Exception.Message; exit 1 \
         }}"
    );
    let out = process::command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &launcher])
        .output()?;
    match out.status.code() {
        Some(0) => Ok(()),
        Some(1223) => Err(AppError::msg(crate::tr!(
            format!("You declined the Windows admin prompt, so nothing changed.{}", no_admin_hint()),
            format!("Anda menolak permintaan izin admin Windows, jadi tidak ada yang berubah.{}", no_admin_hint())
        ))),
        _ => {
            let tail = process::tail(&out);
            Err(AppError::msg(crate::tr!(
                format!("The admin step failed: {tail}{}", no_admin_hint()),
                format!("Langkah admin gagal: {tail}{}", no_admin_hint())
            )))
        }
    }
}

pub(crate) fn base64(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const TYPE_AAAA: u16 = 28;

    #[test]
    fn only_localhost_skips_the_windows_rule() {
        assert!(needs_rule("test") && needs_rule("internal"));
        assert!(!needs_rule("localhost"));
        assert!(ALLOWED_TLDS.contains(&"localhost"));
    }

    #[test]
    fn tells_administrators_from_standard_accounts() {
        // An administrator's filtered token still lists the group, "deny only".
        let admin = r"BUILTIN\Administrators Alias S-1-5-32-544 Group used for deny only";
        let standard = r"BUILTIN\Users Alias S-1-5-32-545 Mandatory group, Enabled by default";
        assert!(lists_admins(admin));
        assert!(!lists_admins(standard));
        assert!(!lists_admins(""));
    }

    fn rcode(resp: &[u8]) -> u16 {
        u16::from_be_bytes([resp[2], resp[3]]) & 0x0F
    }
    fn ancount(resp: &[u8]) -> u16 {
        u16::from_be_bytes([resp[6], resp[7]])
    }

    #[test]
    fn answers_names_under_the_tld_with_loopback() {
        for name in ["blog.test", "api.blog.test", "BLOG.Test", "test"] {
            let resp = respond(&build_query(0xBEEF, name, TYPE_A), "test").unwrap();
            assert_eq!(resp[..2], [0xBE, 0xEF], "{name}: id echoed");
            let flags = u16::from_be_bytes([resp[2], resp[3]]);
            assert!(flags & 0x8000 != 0 && flags & 0x0400 != 0, "{name}: QR + AA");
            assert!(flags & 0x0100 != 0, "{name}: RD echoed");
            assert_eq!(rcode(&resp), 0, "{name}");
            assert_eq!(ancount(&resp), 1, "{name}");
            assert_eq!(resp[resp.len() - 4..], [127, 0, 0, 1], "{name}");
        }
    }

    #[test]
    fn other_record_types_get_an_empty_answer() {
        let resp = respond(&build_query(1, "blog.test", TYPE_AAAA), "test").unwrap();
        assert_eq!((rcode(&resp), ancount(&resp)), (0, 0));
    }

    #[test]
    fn refuses_names_outside_the_tld() {
        for name in ["example.com", "latest", "test.com", "blogtest"] {
            let resp = respond(&build_query(1, name, TYPE_A), "test").unwrap();
            assert_eq!((rcode(&resp), ancount(&resp)), (RCODE_REFUSED, 0), "{name}");
        }
    }

    #[test]
    fn handles_bad_packets_without_panicking() {
        assert_eq!(respond(&[0u8; 5], "test"), None, "too short");
        let mut answer = respond(&build_query(1, "a.test", TYPE_A), "test").unwrap();
        assert_eq!(respond(&answer, "test"), None, "responses are dropped");
        answer.truncate(15);
        answer[2] = 0x01; // make it a query again, with a cut-off name
        assert_eq!(rcode(&respond(&answer, "test").unwrap()), RCODE_FORMERR);
        let mut status_query = build_query(1, "a.test", TYPE_A);
        status_query[2] |= 2 << 3; // opcode STATUS
        assert_eq!(rcode(&respond(&status_query, "test").unwrap()), RCODE_NOTIMP);
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
        assert_eq!(base64(b""), "");
    }

    #[test]
    fn rejects_unsafe_tlds() {
        assert!(check_tld("test").is_ok());
        assert!(check_tld("local-dev").is_ok());
        assert!(check_tld("te'st").is_err());
        assert!(check_tld("").is_err());
    }

    /// Run the real server on a spare port and query it over UDP.
    #[test]
    fn live_server_answers_probe() {
        let port = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap().local_addr().unwrap().port();
        std::thread::spawn(move || serve(port, "test"));
        std::thread::sleep(Duration::from_millis(200));
        assert!(probe(port, "test"));
        assert!(!probe(port, "other"), "a different TLD must not be answered");
    }

    /// Serve on the real port 53 and query with Windows' own DNS clients —
    /// independent implementations. (nslookup ignores `-port` and always uses
    /// 53, so this can't run on a spare port.)
    #[test]
    #[cfg(windows)]
    #[ignore = "needs UDP 127.0.0.1:53 free (run with --ignored)"]
    fn live_windows_clients_resolve_through_server_on_port_53() {
        std::thread::spawn(|| serve(PORT, "test"));
        std::thread::sleep(Duration::from_millis(300));
        assert!(probe(PORT, "test"), "server did not come up on port 53");

        let out = process::command("nslookup").args(["api.blog.test.", "127.0.0.1"]).output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        let after_name = text.split("api.blog.test").nth(1).unwrap_or_default();
        assert!(after_name.contains("127.0.0.1"), "nslookup:\n{text}{}", String::from_utf8_lossy(&out.stderr));

        let a = process::powershell(
            "(Resolve-DnsName -Name shop.test -Server 127.0.0.1 -DnsOnly -Type A -ErrorAction Stop).IPAddress",
        )
        .unwrap();
        assert_eq!(a.trim(), "127.0.0.1", "Resolve-DnsName A");

        let outside = process::powershell(
            "try { Resolve-DnsName -Name example.com -Server 127.0.0.1 -DnsOnly -ErrorAction Stop; 'answered' } catch { 'refused' }",
        )
        .unwrap();
        assert_eq!(outside.trim(), "refused", "names outside .test must be refused");
    }
}
