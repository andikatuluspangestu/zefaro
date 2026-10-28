//! Reading the service logs in `~/.config/zefaro/logs` for the Logs page.
//!
//! Every service Zefaro runs appends to its own file there (nginx error and
//! access logs, php-cgi output per PHP line, MariaDB, Redis, DNS). This module
//! lists those files and turns the end of one into entries with a time, a
//! level and a message, understanding each service's own line format.

use crate::error::{AppError, AppResult};
use crate::model::{LogEntry, LogSource};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// How much of the end of a file one read looks at.
const TAIL_BYTES: u64 = 1024 * 1024;
pub const DEFAULT_LINES: usize = 1000;
const MAX_LINES: usize = 5000;

/// Which parser a file's lines go through.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    NginxError,
    NginxAccess,
    Php,
    MariaDb,
    Redis,
    Postgres,
    Plain,
}

/// Label, group, description and parser for a log file's name (without `.log`).
/// The group is a key the interface translates; label and description are text.
fn describe(id: &str) -> (String, &'static str, String, Kind) {
    match id {
        "nginx-error" => (
            crate::tr!("Web server errors", "Error server web").into(),
            "Web",
            crate::tr!("nginx errors and PHP messages", "Error nginx dan pesan PHP").into(),
            Kind::NginxError,
        ),
        "nginx-access" => (
            crate::tr!("Requests", "Permintaan").into(),
            "Web",
            crate::tr!("Every request nginx served", "Setiap permintaan yang dilayani nginx").into(),
            Kind::NginxAccess,
        ),
        "mariadb" => (
            "MariaDB".into(),
            "Databases",
            crate::tr!("Database server", "Server database").into(),
            Kind::MariaDb,
        ),
        "postgresql" => (
            "PostgreSQL".into(),
            "Databases",
            crate::tr!("Database server", "Server database").into(),
            Kind::Postgres,
        ),
        "redis" => (
            "Redis".into(),
            "Databases",
            crate::tr!("Key-value store", "Penyimpanan key-value").into(),
            Kind::Redis,
        ),
        "mailpit" => ("Mailpit".into(), "System", crate::tr!("Mail catcher", "Penangkap email").into(), Kind::Plain),
        "dns" => (
            "DNS".into(),
            "System",
            crate::tr!("Local domain name server", "Server nama domain lokal").into(),
            Kind::Plain,
        ),
        "nginx-stdout" => (
            crate::tr!("nginx output", "Output nginx").into(),
            "System",
            crate::tr!("nginx's console output", "Output konsol nginx").into(),
            Kind::Plain,
        ),
        _ if id.starts_with("worker-") => {
            let cfg = crate::config::load();
            let worker = cfg.workers.iter().find(|w| crate::engine::laravel::worker_log_id(w) == id);
            match worker {
                Some(w) => (
                    w.label.clone(),
                    "Workers",
                    crate::tr!(format!("Worker of {}", w.site), format!("Worker situs {}", w.site)),
                    Kind::Plain,
                ),
                None => (id.into(), "Workers", format!("{id}.log"), Kind::Plain),
            }
        }
        _ => match id.strip_prefix("php-") {
            Some(v) => (format!("PHP {v}"), "PHP", crate::tr!("php-cgi output", "Output php-cgi").into(), Kind::Php),
            None => (id.into(), "Other", format!("{id}.log"), Kind::Plain),
        },
    }
}

/// Sort order on the page: web first, then PHP (newest line first), databases, system.
fn rank(id: &str) -> (u8, String) {
    let group = match describe(id).1 {
        "Web" => 0,
        "PHP" => 1,
        "Databases" => 2,
        "System" => 3,
        "Workers" => 4,
        _ => 5,
    };
    let key = match id.strip_prefix("php-").and_then(crate::engine::php::minor_key) {
        // Invert so 8.5 sorts before 7.4.
        Some((major, minor)) => format!("{:05}", 99_999 - (major * 100 + minor)),
        None => id.to_owned(),
    };
    (group, key)
}

/// File name stem → path inside `dir`. Only plain names are accepted, so a
/// source can never point outside the logs folder.
pub fn resolve(dir: &Path, id: &str) -> AppResult<PathBuf> {
    let plain = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !id.starts_with('.');
    if !plain {
        return Err(AppError::msg(crate::tr!(
            format!("Zefaro has no log named {id}."),
            format!("Zefaro tidak punya log bernama {id}.")
        )));
    }
    Ok(dir.join(format!("{id}.log")))
}

fn source_for(path: &Path, id: &str) -> AppResult<LogSource> {
    let meta = fs::metadata(path)?;
    let (label, group, description, _) = describe(id);
    Ok(LogSource {
        id: id.to_owned(),
        label,
        group: group.into(),
        description,
        path: path.display().to_string(),
        size: meta.len(),
        modified: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64),
    })
}

/// Every `*.log` file in `dir`, in page order.
pub fn list(dir: &Path) -> AppResult<Vec<LogSource>> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("log") || !path.is_file() {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if resolve(dir, id).is_err() {
            continue;
        }
        out.push(source_for(&path, id)?);
    }
    out.sort_by_key(|s| rank(&s.id));
    Ok(out)
}

/// The end of one log.
pub struct Tail {
    pub source: LogSource,
    pub entries: Vec<LogEntry>,
    /// The file has older lines than the ones returned.
    pub truncated: bool,
}

/// Read the last `lines` lines of `<dir>/<id>.log` and parse them.
pub fn tail(dir: &Path, id: &str, lines: usize) -> AppResult<Tail> {
    let path = resolve(dir, id)?;
    if !path.is_file() {
        return Err(AppError::msg(crate::tr!(
            format!("{id}.log doesn't exist yet."),
            format!("{id}.log belum ada.")
        )));
    }
    let source = source_for(&path, id)?;
    let lines = lines.clamp(1, MAX_LINES);

    let mut file = File::open(&path)?;
    let start = source.size.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::with_capacity((source.size - start) as usize);
    file.take(TAIL_BYTES).read_to_end(&mut bytes)?;
    let text = String::from_utf8_lossy(&bytes);

    let mut all: Vec<&str> = text.lines().collect();
    // Reading from the middle of the file: the first line is a fragment.
    if start > 0 && !all.is_empty() {
        all.remove(0);
    }
    all.retain(|l| !l.trim().is_empty());
    let truncated = start > 0 || all.len() > lines;
    let shown = &all[all.len().saturating_sub(lines)..];

    let kind = describe(id).3;
    let mut entries: Vec<LogEntry> = Vec::with_capacity(shown.len());
    for raw in shown {
        let mut e = parse(kind, raw.trim_end());
        // Stack traces and other continuation lines carry no time of their
        // own; they belong to the line above.
        if e.ts.is_none() && e.level == "info" {
            if let Some(prev) = entries.last() {
                e.level = prev.level.clone();
            }
        }
        entries.push(e);
    }
    Ok(Tail { source, entries, truncated })
}

/// Empty a log. Services keep appending to it afterwards.
pub fn clear(dir: &Path, id: &str) -> AppResult<()> {
    let path = resolve(dir, id)?;
    if !path.is_file() {
        return Ok(());
    }
    fs::OpenOptions::new().write(true).open(&path)?.set_len(0)?;
    Ok(())
}

// ---- line parsers ----------------------------------------------------------

fn entry(ts: Option<String>, level: &str, tag: Option<String>, message: String, raw: &str) -> LogEntry {
    LogEntry {
        ts,
        level: level.into(),
        tag,
        message,
        detail: None,
        raw: raw.into(),
    }
}

fn parse(kind: Kind, raw: &str) -> LogEntry {
    let parsed = match kind {
        Kind::NginxError => nginx_error(raw),
        Kind::NginxAccess => nginx_access(raw),
        Kind::Php => php_line(raw),
        Kind::MariaDb => mariadb(raw),
        Kind::Redis => redis(raw),
        Kind::Postgres => postgres(raw),
        Kind::Plain => None,
    };
    parsed.unwrap_or_else(|| plain(raw))
}

/// Fallback: no known structure, guess the level from its words.
fn plain(raw: &str) -> LogEntry {
    if let Some(e) = php_line(raw) {
        return e;
    }
    entry(None, guess_level(raw), None, raw.trim().into(), raw)
}

fn guess_level(text: &str) -> &'static str {
    let t = text.to_ascii_lowercase();
    if ["fatal", "error", "failed", "panic", "crit", "emerg"].iter().any(|w| t.contains(w)) {
        "error"
    } else if t.contains("warn") || t.contains("deprecated") {
        "warn"
    } else {
        "info"
    }
}

fn month(name: &str) -> Option<u32> {
    let m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    m.iter().position(|x| x.eq_ignore_ascii_case(name)).map(|i| i as u32 + 1)
}

fn digits(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| b.is_ascii_digit())
}

/// `HH:MM:SS`
fn clock(s: &str) -> bool {
    let p: Vec<&str> = s.split(':').collect();
    p.len() == 3 && p.iter().all(|x| digits(x, 2))
}

/// PHP severity in a message like `PHP Warning:  …` → (level, tag).
fn php_severity(text: &str) -> Option<(&'static str, &'static str)> {
    let rest = text.trim_start();
    let rest = rest.strip_prefix("PHP ").unwrap_or(rest);
    let table: &[(&str, &str, &str)] = &[
        ("Fatal error", "error", "Fatal"),
        ("Parse error", "error", "Parse"),
        ("Recoverable fatal error", "error", "Fatal"),
        ("Warning", "warn", "Warning"),
        ("Deprecated", "warn", "Deprecated"),
        ("Notice", "warn", "Notice"),
        ("Strict Standards", "warn", "Strict"),
        ("Startup", "warn", "Startup"),
    ];
    table
        .iter()
        .find(|(p, _, _)| rest.starts_with(&format!("{p}:")) || rest.starts_with(&format!("{p} ")))
        .map(|(_, l, t)| (*l, *t))
}

/// `2026/10/21 14:57:46 [error] 12180#8096: *6 message`
fn nginx_error(raw: &str) -> Option<LogEntry> {
    let date = raw.get(0..10)?;
    let time = raw.get(11..19)?;
    if !(digits(date.get(0..4)?, 4) && date.get(4..5)? == "/" && clock(time)) {
        return None;
    }
    let rest = raw.get(20..)?.strip_prefix('[')?;
    let (lvl, rest) = rest.split_once("] ")?;
    let level = match lvl {
        "emerg" | "alert" | "crit" | "error" => "error",
        "warn" => "warn",
        _ => "info",
    };
    // Drop "pid#tid: " and the "*N " connection number.
    let rest = match rest.split_once(": ") {
        Some((pid, msg)) if pid.contains('#') && pid.bytes().all(|b| b.is_ascii_digit() || b == b'#') => msg,
        _ => rest,
    };
    let rest = match rest.strip_prefix('*').and_then(|r| r.split_once(' ')) {
        Some((n, msg)) if n.bytes().all(|b| b.is_ascii_digit()) => msg,
        _ => rest,
    };
    let ts = Some(format!("{} {time}", date.replace('/', "-")));

    // PHP errors arrive through FastCGI: `FastCGI sent in stderr: "PHP message: PHP Warning: …"`
    if let Some(i) = rest.find("PHP message: ") {
        let msg = &rest[i + "PHP message: ".len()..];
        let (message, context) = match msg.find("\" while reading") {
            Some(j) => (&msg[..j], Some(msg[j + 2..].to_owned())),
            None => (msg, None),
        };
        let (lvl, tag) = php_severity(message).unwrap_or(("error", "PHP"));
        let message = message.trim_start().strip_prefix("PHP ").unwrap_or(message);
        let mut e = entry(ts, lvl, Some(format!("PHP {tag}")), message.trim().into(), raw);
        e.detail = context;
        return Some(e);
    }

    // Split nginx's trailing ", client: …, server: …, request: …" context off.
    let (message, context) = match rest.find(", client: ") {
        Some(j) => (&rest[..j], Some(rest[j + 2..].to_owned())),
        None => (rest, None),
    };
    let mut e = entry(ts, level, None, message.into(), raw);
    e.detail = context;
    Some(e)
}

/// Read one double-quoted field from the start of `s`; returns (field, rest).
fn quoted(s: &str) -> Option<(&str, &str)> {
    let s = s.trim_start().strip_prefix('"')?;
    let mut escaped = false;
    for (i, c) in s.char_indices() {
        match c {
            '\\' if !escaped => escaped = true,
            '"' if !escaped => return Some((&s[..i], &s[i + 1..])),
            _ => escaped = false,
        }
    }
    None
}

fn word(s: &str) -> (&str, &str) {
    let s = s.trim_start();
    match s.split_once(' ') {
        Some((w, r)) => (w, r),
        None => (s, ""),
    }
}

/// `21/Oct/2026:15:53:09 +0700` → `2026-10-21 15:53:09`
fn access_time(s: &str) -> Option<String> {
    let (date, _zone) = s.split_once(' ').unwrap_or((s, ""));
    let mut p = date.splitn(4, [':', '/']);
    let (d, m, y) = (p.next()?, month(p.next()?)?, p.next()?);
    let time = p.next()?;
    (digits(d, 2) && digits(y, 4) && clock(time)).then(|| format!("{y}-{m:02}-{d} {time}"))
}

fn size(bytes: u64) -> String {
    match bytes {
        b if b >= 1024 * 1024 => format!("{:.1} MB", b as f64 / 1048576.0),
        b if b >= 1024 => format!("{:.1} KB", b as f64 / 1024.0),
        b => format!("{b} B"),
    }
}

/// nginx "combined" format, optionally followed by Zefaro's `"$host" $request_time`.
fn nginx_access(raw: &str) -> Option<LogEntry> {
    let (_addr, rest) = raw.split_once(" - ")?;
    let (_user, rest) = rest.split_once(" [")?;
    let (time, rest) = rest.split_once("] ")?;
    let ts = access_time(time)?;
    let (request, rest) = quoted(rest)?;
    let (status, rest) = word(rest);
    let (bytes, rest) = word(rest);
    let status_code: u16 = status.parse().ok()?;
    let referer = quoted(rest);
    let agent = referer.and_then(|(_, r)| quoted(r));
    let host = agent.and_then(|(_, r)| quoted(r));
    let took = host.map(|(_, r)| word(r).0).and_then(|t| t.parse::<f64>().ok());

    let level = match status_code {
        500.. => "error",
        400.. => "warn",
        _ => "info",
    };
    // "GET /path HTTP/1.1" → "GET /path"
    let message = match request.rsplit_once(" HTTP/") {
        Some((r, _)) => r.to_owned(),
        None => request.to_owned(),
    };
    let mut facts = Vec::new();
    if let Some((h, _)) = host.filter(|(h, _)| !h.is_empty() && *h != "-") {
        facts.push(h.to_owned());
    }
    if let Ok(b) = bytes.parse::<u64>() {
        facts.push(size(b));
    }
    if let Some(t) = took {
        facts.push(format!("{} ms", (t * 1000.0).round() as u64));
    }
    if let Some((r, _)) = referer.filter(|(r, _)| !r.is_empty() && *r != "-") {
        facts.push(crate::tr!(format!("from {r}"), format!("dari {r}")));
    }
    let mut e = entry(Some(ts), level, Some(status.into()), message, raw);
    e.detail = (!facts.is_empty()).then(|| facts.join(" · "));
    Some(e)
}

/// php-cgi output: `[21-Oct-2026 16:08:31 UTC] PHP Warning:  …` or just `PHP Warning:  …`.
fn php_line(raw: &str) -> Option<LogEntry> {
    let (ts, rest) = match raw.strip_prefix('[').and_then(|r| r.split_once("] ")) {
        Some((stamp, rest)) => {
            let mut p = stamp.split([' ', '-']);
            let (d, m, y, time) = (p.next()?, month(p.next()?)?, p.next()?, p.next()?);
            if !(digits(d, 2) && digits(y, 4) && clock(time)) {
                return None;
            }
            (Some(format!("{y}-{m:02}-{d} {time}")), rest)
        }
        None => (None, raw),
    };
    let (level, tag) = php_severity(rest)?;
    let message = rest.trim_start();
    let message = message.strip_prefix("PHP ").unwrap_or(message);
    Some(entry(ts, level, Some(format!("PHP {tag}")), message.trim().into(), raw))
}

/// `2026-10-21 16:08:31 140 [Warning] message` (the thread number is optional).
fn mariadb(raw: &str) -> Option<LogEntry> {
    let date = raw.get(0..10)?;
    let time = raw.get(11..19)?;
    if !(digits(date.get(0..4)?, 4) && date.get(4..5)? == "-" && clock(time)) {
        return None;
    }
    let rest = raw.get(20..)?.trim_start();
    let rest = match rest.split_once(' ') {
        Some((n, r)) if n.bytes().all(|b| b.is_ascii_digit()) => r,
        _ => rest,
    };
    let (lvl, message) = rest.strip_prefix('[')?.split_once("] ")?;
    let level = match lvl {
        "ERROR" => "error",
        "Warning" => "warn",
        _ => "info",
    };
    Some(entry(Some(format!("{date} {time}")), level, Some(lvl.into()), message.into(), raw))
}

/// `2026-10-27 16:30:01.123 WIB [4242] LOG:  database system is ready to accept connections`
fn postgres(raw: &str) -> Option<LogEntry> {
    let date = raw.get(0..10)?;
    let time = raw.get(11..19)?;
    if !(digits(date.get(0..4)?, 4) && date.get(4..5)? == "-" && clock(time)) {
        return None;
    }
    let rest = raw.split_once("] ").map(|(_, r)| r)?;
    let (lvl, message) = rest.split_once(':')?;
    let level = match lvl {
        "ERROR" | "FATAL" | "PANIC" => "error",
        "WARNING" => "warn",
        "LOG" | "INFO" | "NOTICE" | "DETAIL" | "HINT" | "STATEMENT" | "CONTEXT" | "DEBUG" => "info",
        _ => return None,
    };
    Some(entry(Some(format!("{date} {time}")), level, Some(lvl.into()), message.trim_start().into(), raw))
}

/// `12345:M 21 Oct 2026 16:08:31.123 * Ready to accept connections`
fn redis(raw: &str) -> Option<LogEntry> {
    let (_pid_role, rest) = raw.split_once(' ')?;
    let mut p = rest.splitn(5, ' ');
    let (d, m, y, time, rest) = (p.next()?, month(p.next()?)?, p.next()?, p.next()?, p.next()?);
    let time = time.split('.').next()?;
    if !(d.len() <= 2 && d.bytes().all(|b| b.is_ascii_digit()) && digits(y, 4) && clock(time)) {
        return None;
    }
    let (mark, message) = rest.split_once(' ')?;
    let level = match mark {
        "#" => "warn",
        _ => guess_level(message),
    };
    let ts = format!("{y}-{m:02}-{:0>2} {time}", d);
    Some(entry(Some(ts), level, None, message.into(), raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nginx_error_line() {
        let e = parse(
            Kind::NginxError,
            r#"2026/10/21 14:57:46 [error] 12180#8096: *6 CreateFile() "C:/x/favicon.ico" failed (2: not found), client: 127.0.0.1, server: _"#,
        );
        assert_eq!(e.ts.as_deref(), Some("2026-10-21 14:57:46"));
        assert_eq!(e.level, "error");
        assert_eq!(e.message, r#"CreateFile() "C:/x/favicon.ico" failed (2: not found)"#);
        assert_eq!(e.detail.as_deref(), Some("client: 127.0.0.1, server: _"));
    }

    #[test]
    fn php_message_through_fastcgi() {
        let e = parse(
            Kind::NginxError,
            r#"2026/10/21 15:00:00 [error] 1#2: *3 FastCGI sent in stderr: "PHP message: PHP Warning:  Undefined variable $user in C:\app\index.php on line 4" while reading response header from upstream, client: 127.0.0.1"#,
        );
        assert_eq!(e.level, "warn");
        assert_eq!(e.tag.as_deref(), Some("PHP Warning"));
        assert_eq!(e.message, r"Warning:  Undefined variable $user in C:\app\index.php on line 4");
        assert!(e.detail.unwrap().starts_with("while reading"));
    }

    #[test]
    fn access_line_with_and_without_host() {
        let old = parse(
            Kind::NginxAccess,
            r#"127.0.0.1 - - [21/Oct/2026:16:04:15 +0700] "GET /login HTTP/1.1" 404 405 "-" "Mozilla/5.0""#,
        );
        assert_eq!(old.ts.as_deref(), Some("2026-10-21 16:04:15"));
        assert_eq!(old.level, "warn");
        assert_eq!(old.tag.as_deref(), Some("404"));
        assert_eq!(old.message, "GET /login");
        assert_eq!(old.detail.as_deref(), Some("405 B"));

        let new = parse(
            Kind::NginxAccess,
            r#"127.0.0.1 - - [21/Oct/2026:16:04:15 +0700] "POST /api HTTP/1.1" 500 2048 "http://shop.test/" "Mozilla/5.0" "shop.test" 0.123"#,
        );
        assert_eq!(new.level, "error");
        assert_eq!(new.detail.as_deref(), Some("shop.test · 2.0 KB · 123 ms · from http://shop.test/"));
    }

    #[test]
    fn mariadb_and_redis_lines() {
        let m = parse(Kind::MariaDb, "2026-10-21 16:08:31 140 [Warning] Aborted connection 140");
        assert_eq!((m.level.as_str(), m.message.as_str()), ("warn", "Aborted connection 140"));
        let m = parse(Kind::MariaDb, "2026-10-21 16:08:31 0 [ERROR] Can't start server");
        assert_eq!(m.level, "error");

        let r = parse(Kind::Redis, "4242:M 21 Oct 2026 16:08:31.123 * Ready to accept connections tcp");
        assert_eq!(r.ts.as_deref(), Some("2026-10-21 16:08:31"));
        assert_eq!((r.level.as_str(), r.message.as_str()), ("info", "Ready to accept connections tcp"));
        let p = parse(Kind::Postgres, "2026-10-27 16:30:01.123 WIB [4242] LOG:  database system is ready to accept connections");
        assert_eq!(p.ts.as_deref(), Some("2026-10-27 16:30:01"));
        assert_eq!((p.level.as_str(), p.message.as_str()), ("info", "database system is ready to accept connections"));
        let p = parse(Kind::Postgres, "2026-10-27 16:31:00.000 WIB [99] FATAL:  database \"shop\" does not exist");
        assert_eq!((p.level.as_str(), p.tag.as_deref()), ("error", Some("FATAL")));
        let r = parse(Kind::Redis, "4242:M 1 Oct 2026 09:00:00.000 # WARNING overcommit");
        assert_eq!((r.level.as_str(), r.ts.as_deref()), ("warn", Some("2026-10-01 09:00:00")));
    }

    #[test]
    fn php_cgi_output_and_plain_fallback() {
        let p = parse(Kind::Php, "[21-Oct-2026 16:08:31 UTC] PHP Fatal error:  Allowed memory size exhausted");
        assert_eq!(p.ts.as_deref(), Some("2026-10-21 16:08:31"));
        assert_eq!((p.level.as_str(), p.tag.as_deref()), ("error", Some("PHP Fatal")));
        assert_eq!(parse(Kind::Plain, "Zefaro DNS: answering *.test").level, "info");
        assert_eq!(parse(Kind::Plain, "bind failed: port in use").level, "error");
    }

    #[test]
    fn tail_reads_the_end_and_rejects_paths() {
        let dir = std::env::temp_dir().join(format!("zefaro-logs-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let body: String = (1..=50)
            .map(|i| format!("2026-10-21 10:00:{:02} 0 [Note] line {i}\n", i % 60))
            .collect::<String>()
            + "  continuation of line 50\n\n";
        fs::write(dir.join("mariadb.log"), body).unwrap();
        fs::write(dir.join("php-8.3.log"), "").unwrap();
        fs::write(dir.join("php-8.5.log"), "").unwrap();
        fs::write(dir.join("nginx-error.log"), "").unwrap();
        fs::write(dir.join("notes.txt"), "").unwrap();

        let t = tail(&dir, "mariadb", 3).unwrap();
        assert!(t.truncated);
        let msgs: Vec<&str> = t.entries.iter().map(|e| e.message.as_str()).collect();
        assert_eq!(msgs, ["line 49", "line 50", "continuation of line 50"]);

        let ids: Vec<String> = list(&dir).unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, ["nginx-error", "php-8.5", "php-8.3", "mariadb"]);

        assert!(tail(&dir, "../config", 10).is_err());
        assert!(tail(&dir, "a/b", 10).is_err());
        clear(&dir, "mariadb").unwrap();
        assert!(tail(&dir, "mariadb", 10).unwrap().entries.is_empty());
        fs::remove_dir_all(&dir).ok();
    }
}
