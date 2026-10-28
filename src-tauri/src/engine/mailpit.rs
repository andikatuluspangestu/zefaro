//! Mailpit — catches every email your apps send. An SMTP server on
//! 127.0.0.1:1025 stores messages instead of delivering them; Zefaro shows them
//! on its Mail page (through Mailpit's API on 127.0.0.1:8025) and nginx serves
//! Mailpit's own web UI at mailpit.<tld>.
//!
//! PHP's mail() is pointed at it too: on Windows it sends through the SMTP
//! server named in php.ini (`SMTP` / `smtp_port`), which Zefaro's managed block sets.

use crate::config::MailpitConfig;
use crate::engine::archive::{self, Archive};
use crate::engine::paths;
use crate::engine::supervisor::{Probe, Spec};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const VERSION: &str = "1.32.0";
pub const SERVICE_ID: &str = "mailpit";
/// Mailpit's web UI is served at `mailpit.<tld>`.
pub const HOST: &str = "mailpit";
pub const DOWNLOAD_MB: u32 = 11;

/// mailpit-windows-amd64.zip from github.com/axllent/mailpit (v1.32.0);
/// SHA-256 = the digest GitHub publishes for the release asset. The zip holds
/// mailpit.exe at its root.
const ARCHIVE: Archive = Archive {
    name: "Mailpit 1.32.0",
    url: "https://github.com/axllent/mailpit/releases/download/v1.32.0/mailpit-windows-amd64.zip",
    sha256: "16915767a6c95dca569336e8f561f91cf355e9a33c57b91deedcc10a4bba7fd4",
    inner: "",
};

#[derive(Clone, Debug)]
pub struct Layout {
    /// mailpit.exe
    pub base: PathBuf,
    /// Working directory; holds mailpit.db, so mail survives restarts.
    pub data: PathBuf,
    pub log: PathBuf,
    pub opts: MailpitConfig,
}

impl Layout {
    pub fn standard(opts: &MailpitConfig) -> Self {
        Self {
            base: paths::bin_dir().join("mailpit"),
            data: paths::data_dir().join("mailpit"),
            log: paths::logs_dir().join("mailpit.log"),
            opts: opts.clone(),
        }
    }

    fn exe(&self) -> PathBuf {
        self.base.join("mailpit.exe")
    }
}

pub fn installed(l: &Layout) -> bool {
    l.exe().is_file()
}

/// Install on first use (serialized against concurrent starts).
pub fn prepare(l: &Layout, scratch: &Path, keep_zip: bool) -> AppResult<()> {
    archive::exclusive(&l.base, || {
        if !installed(l) {
            ARCHIVE.install(&l.base, scratch, keep_zip)?;
        }
        std::fs::create_dir_all(&l.data)?;
        Ok(())
    })
}

/// Mailpit's command line. Both servers bind to 127.0.0.1 only (its default
/// is every interface).
pub fn args(l: &Layout) -> Vec<String> {
    let o = &l.opts;
    let mut a = vec![
        format!("--listen=127.0.0.1:{}", o.ui_port),
        format!("--smtp=127.0.0.1:{}", o.smtp_port),
        format!("--database={}", l.data.join("mailpit.db").display()),
        format!("--max={}", o.max_messages),
        // Apps configured with any SMTP username/password still deliver here.
        "--smtp-auth-accept-any".into(),
        "--smtp-auth-allow-insecure".into(),
        // No reverse DNS on 127.0.0.1 connections: faster, and no stray names.
        "--smtp-disable-rdns".into(),
        "--disable-version-check".into(),
        "--label=Zefaro".into(),
    ];
    if o.max_age_days > 0 {
        a.push(format!("--max-age={}d", o.max_age_days));
    }
    a
}

pub fn spec(l: &Layout) -> Spec {
    Spec {
        id: SERVICE_ID.into(),
        program: l.exe(),
        args: args(l).into_iter().map(Into::into).collect(),
        cwd: l.data.clone(),
        env: Vec::new(),
        log: l.log.clone(),
        port: l.opts.ui_port,
        probe: Probe::Tcp,
        stop: None,
    }
}

// ---- API client -------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "PascalCase")]
pub struct Address {
    pub name: String,
    pub address: String,
}

/// One message in the list.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all(deserialize = "PascalCase", serialize = "camelCase"))]
pub struct Summary {
    #[serde(rename(deserialize = "ID"))]
    pub id: String,
    pub read: bool,
    pub from: Option<Address>,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub to: Vec<Address>,
    pub subject: String,
    /// RFC 3339.
    pub created: String,
    pub size: u64,
    pub attachments: u32,
    pub snippet: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    #[serde(rename(deserialize = "messages"), default, deserialize_with = "null_as_empty")]
    pub messages: Vec<Summary>,
    /// Messages matching (a search) or stored (no search).
    #[serde(rename(deserialize = "messages_count"))]
    pub total: u64,
    /// Unread messages in the whole mailbox.
    #[serde(rename(deserialize = "unread"))]
    pub unread: u64,
    pub start: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all(deserialize = "PascalCase", serialize = "camelCase"))]
pub struct Part {
    #[serde(rename(deserialize = "PartID"))]
    pub part_id: String,
    pub file_name: String,
    pub content_type: String,
    #[serde(rename(deserialize = "ContentID"))]
    pub content_id: String,
    pub size: u64,
}

/// A whole message.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all(deserialize = "PascalCase", serialize = "camelCase"))]
pub struct Message {
    #[serde(rename(deserialize = "ID"))]
    pub id: String,
    pub from: Option<Address>,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub to: Vec<Address>,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub cc: Vec<Address>,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub bcc: Vec<Address>,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub reply_to: Vec<Address>,
    pub subject: String,
    pub date: String,
    pub text: String,
    #[serde(rename(deserialize = "HTML"))]
    pub html: String,
    pub size: u64,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub inline: Vec<Part>,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub attachments: Vec<Part>,
}

fn null_as_empty<'de, D, T>(d: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(d)?.unwrap_or_default())
}

/// Talks to one Mailpit instance's API.
pub struct Client {
    base: String,
    agent: ureq::Agent,
}

impl Client {
    pub fn new(ui_port: u16) -> Self {
        Self {
            base: format!("http://127.0.0.1:{ui_port}/api/v1"),
            agent: ureq::AgentBuilder::new().timeout(Duration::from_secs(10)).build(),
        }
    }

    fn fail(e: ureq::Error) -> AppError {
        match e {
            ureq::Error::Transport(_) => AppError::msg(crate::tr!(
                "Mailpit isn't running. Start it on the Services page.",
                "Mailpit tidak berjalan. Mulai dari halaman Layanan."
            )),
            ureq::Error::Status(code, r) => {
                AppError::msg(format!("Mailpit: {} ({code})", r.into_string().unwrap_or_default().trim()))
            }
        }
    }

    fn get(&self, path: &str) -> AppResult<ureq::Response> {
        self.agent.get(&format!("{}{path}", self.base)).call().map_err(Self::fail)
    }

    /// Newest first. With `query`, Mailpit's search syntax
    /// (e.g. `from:shop subject:"order" is:unread`).
    pub fn list(&self, query: &str, start: u64, limit: u64) -> AppResult<Page> {
        let q = query.trim();
        let r = if q.is_empty() {
            self.agent
                .get(&format!("{}/messages", self.base))
                .query("start", &start.to_string())
                .query("limit", &limit.to_string())
                .call()
        } else {
            self.agent
                .get(&format!("{}/search", self.base))
                .query("query", q)
                .query("start", &start.to_string())
                .query("limit", &limit.to_string())
                .call()
        };
        Ok(r.map_err(Self::fail)?.into_json()?)
    }

    /// The whole message. Mailpit marks it read.
    pub fn get_message(&self, id: &str) -> AppResult<Message> {
        check_id(id)?;
        Ok(self.get(&format!("/message/{id}"))?.into_json()?)
    }

    pub fn headers(&self, id: &str) -> AppResult<std::collections::BTreeMap<String, Vec<String>>> {
        check_id(id)?;
        Ok(self.get(&format!("/message/{id}/headers"))?.into_json()?)
    }

    /// The message exactly as received (RFC 822 source).
    pub fn raw(&self, id: &str) -> AppResult<String> {
        check_id(id)?;
        Ok(self.get(&format!("/message/{id}/raw"))?.into_string()?)
    }

    /// The message's inline images as `data:` URLs keyed by Content-ID, for a
    /// preview that needs no network access (a sandboxed frame can't reach
    /// 127.0.0.1). Images over 5 MB in total are left out.
    pub fn inline_images(&self, id: &str) -> AppResult<std::collections::BTreeMap<String, String>> {
        const BUDGET: u64 = 5 * 1024 * 1024;
        let m = self.get_message(id)?;
        let mut out = std::collections::BTreeMap::new();
        let mut used = 0u64;
        for p in m.inline.iter().filter(|p| !p.content_id.is_empty() && p.content_type.starts_with("image/")) {
            used += p.size;
            if used > BUDGET {
                break;
            }
            let part = p.part_id.chars().all(|c| c.is_ascii_digit() || c == '.');
            if !part {
                continue;
            }
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut self.get(&format!("/message/{id}/part/{}", p.part_id))?.into_reader(), &mut bytes)?;
            out.insert(
                p.content_id.clone(),
                format!("data:{};base64,{}", p.content_type, crate::engine::dns::base64(&bytes)),
            );
        }
        Ok(out)
    }

    /// Mark messages read or unread; no IDs means every message.
    pub fn set_read(&self, ids: &[String], read: bool) -> AppResult<()> {
        ids.iter().try_for_each(|id| check_id(id))?;
        self.agent
            .put(&format!("{}/messages", self.base))
            .send_json(serde_json::json!({ "IDs": ids, "Read": read }))
            .map_err(Self::fail)?;
        Ok(())
    }

    /// Delete messages; no IDs means every message.
    pub fn delete(&self, ids: &[String]) -> AppResult<()> {
        ids.iter().try_for_each(|id| check_id(id))?;
        self.agent
            .delete(&format!("{}/messages", self.base))
            .send_json(serde_json::json!({ "IDs": ids }))
            .map_err(Self::fail)?;
        Ok(())
    }
}

/// Message IDs go into URL paths: letters and digits only.
fn check_id(id: &str) -> AppResult<()> {
    if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric()) {
        Ok(())
    } else {
        Err(AppError::msg(crate::tr!("Invalid message ID.", "ID pesan tidak valid.")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpStream;

    fn layout(root: &Path, smtp: u16, ui: u16) -> Layout {
        Layout {
            base: root.join("bin"),
            data: root.join("data"),
            log: root.join("mailpit.log"),
            opts: MailpitConfig { smtp_port: smtp, ui_port: ui, ..MailpitConfig::default() },
        }
    }

    #[test]
    fn binds_loopback_and_keeps_mail() {
        let l = layout(Path::new(r"C:\zefaro"), 1025, 8025);
        let a = args(&l);
        assert!(a.contains(&"--listen=127.0.0.1:8025".to_string()));
        assert!(a.contains(&"--smtp=127.0.0.1:1025".to_string()));
        assert!(a.iter().any(|x| x.starts_with("--database=") && x.ends_with("mailpit.db")));
        assert!(a.contains(&"--smtp-auth-accept-any".to_string()));
        assert!(!a.iter().any(|x| x.starts_with("--max-age")), "keep mail by default");
        assert!(check_id("3fCZMCdp3sd7klLq90J1ex").is_ok());
        assert!(check_id("../x").is_err() && check_id("").is_err());
    }

    /// One SMTP conversation, the way an app sends mail.
    fn send(port: u16, from: &str, to: &str, data: &str) {
        let stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut w = stream;
        let mut expect = |code: &str| {
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert!(line.starts_with(code), "expected {code}, got {line}");
                if line.as_bytes().get(3) != Some(&b'-') {
                    break;
                }
            }
        };
        expect("220");
        for (cmd, code) in [
            ("EHLO zefaro.test".to_owned(), "250"),
            // An app with SMTP credentials configured must still deliver.
            ("AUTH PLAIN AHVzZXIAcGFzcw==".to_owned(), "235"),
            (format!("MAIL FROM:<{from}>"), "250"),
            (format!("RCPT TO:<{to}>"), "250"),
            ("DATA".to_owned(), "354"),
        ] {
            write!(w, "{cmd}\r\n").unwrap();
            expect(code);
        }
        write!(w, "{data}\r\n.\r\n").unwrap();
        expect("250");
        write!(w, "QUIT\r\n").unwrap();
    }

    /// The pinned download in a temp folder on spare ports: install, run,
    /// receive mail over SMTP and from PHP's mail(), then read, search, mark,
    /// fetch source/headers and delete through the API.
    #[test]
    #[ignore = "network (~11 MB, cached in %TEMP%\\zefaro-test-cache) (run with --ignored)"]
    fn live_mailpit_catches_mail() {
        use crate::engine::supervisor::{port_open, Supervisor};
        let cache = std::env::temp_dir().join("zefaro-test-cache");
        std::fs::create_dir_all(&cache).unwrap();
        let tmp = std::env::temp_dir().join(format!("zefaro-mailpit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let l = layout(&tmp, 11026, 18026);
        prepare(&l, &cache, true).expect("install Mailpit");
        assert!(installed(&l));
        let sup = Supervisor::default();
        sup.start(spec(&l)).expect("start Mailpit");
        assert!(port_open(11026), "SMTP listening");

        send(
            11026,
            "shop@example.test",
            "budi@example.test",
            "From: Shop <shop@example.test>\r\nTo: Budi <budi@example.test>\r\nSubject: Order #1001\r\n\
             MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<h1>Thanks</h1>",
        );

        // PHP's mail(), configured the way Zefaro's php.ini does it.
        let php = crate::engine::paths::php_dir("8.3").join("php.exe");
        let php_sent = php.is_file() && {
            let out = crate::engine::process::command(&php)
                .args(["-n", "-d", "SMTP=127.0.0.1", "-d", "smtp_port=11026", "-d", "sendmail_from=app@zefaro.test", "-r"])
                .arg("echo mail('x@example.test', 'From PHP', 'Body') ? 'sent' : 'failed';")
                .output()
                .unwrap();
            assert_eq!(String::from_utf8_lossy(&out.stdout), "sent");
            true
        };

        let c = Client::new(18026);
        let page = c.list("", 0, 50).unwrap();
        assert_eq!(page.total, if php_sent { 2 } else { 1 });
        assert_eq!(page.unread, page.total);
        let order = page.messages.iter().find(|m| m.subject == "Order #1001").expect("SMTP message listed");
        assert_eq!(order.from.as_ref().unwrap().address, "shop@example.test");

        let found = c.list("subject:\"Order\"", 0, 50).unwrap();
        assert_eq!(found.total, 1);

        let full = c.get_message(&order.id).unwrap();
        assert!(full.html.contains("<h1>Thanks</h1>"));
        assert!(c.inline_images(&order.id).unwrap().is_empty(), "no inline images in this one");

        // An HTML mail with an inline (cid:) image comes back as a data: URL.
        send(
            11026,
            "shop@example.test",
            "budi@example.test",
            "From: shop@example.test\r\nTo: budi@example.test\r\nSubject: With logo\r\nMIME-Version: 1.0\r\n\
             Content-Type: multipart/related; boundary=\"B\"\r\n\r\n--B\r\nContent-Type: text/html\r\n\r\n\
             <img src=\"cid:logo\">\r\n--B\r\nContent-Type: image/png\r\nContent-ID: <logo>\r\n\
             Content-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n--B--",
        );
        let logo = c.list("subject:\"With logo\"", 0, 1).unwrap().messages.remove(0);
        let images = c.inline_images(&logo.id).unwrap();
        assert_eq!(images.get("logo").map(String::as_str), Some("data:image/png;base64,iVBORw0KGgo="));
        c.delete(&[logo.id]).unwrap();
        assert!(c.raw(&order.id).unwrap().contains("Subject: Order #1001"));
        assert!(c.headers(&order.id).unwrap().contains_key("Subject"));
        assert_eq!(c.list("", 0, 50).unwrap().unread, page.total - 1, "opening marks it read");
        c.set_read(&[order.id.clone()], false).unwrap();
        assert_eq!(c.list("", 0, 50).unwrap().unread, page.total);

        c.delete(&[order.id.clone()]).unwrap();
        assert_eq!(c.list("", 0, 50).unwrap().total, page.total - 1);
        c.delete(&[]).unwrap();
        assert_eq!(c.list("", 0, 50).unwrap().total, 0);

        sup.stop(SERVICE_ID).unwrap();
        assert!(Client::new(18026).list("", 0, 1).unwrap_err().to_string().contains("isn't running"));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
