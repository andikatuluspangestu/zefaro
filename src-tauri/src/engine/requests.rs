//! The requests nginx served for a site, read from the end of its access log
//! (`nginx-access.log`, in Zefaro's `zefaro` format: nginx's "combined" plus
//! `"$host" $request_time`).

use crate::engine::logs::{access_time, quoted, word};
use crate::error::AppResult;
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// How much of the end of the log is read for one look.
const TAIL_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    /// `2026-11-14 10:00:01`, in the computer's time.
    pub time: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    pub bytes: Option<u64>,
    /// How long nginx took to answer, in milliseconds.
    pub ms: Option<u64>,
    pub host: Option<String>,
    pub referer: Option<String>,
    pub agent: Option<String>,
    pub addr: String,
}

fn field(v: &str) -> Option<String> {
    (!v.is_empty() && v != "-").then(|| v.to_owned())
}

/// One access log line, or None for anything else.
pub fn parse(raw: &str) -> Option<Request> {
    let (addr, rest) = raw.split_once(" - ")?;
    let (_user, rest) = rest.split_once(" [")?;
    let (time, rest) = rest.split_once("] ")?;
    let time = access_time(time)?;
    let (request, rest) = quoted(rest)?;
    let (status, rest) = word(rest);
    let (bytes, rest) = word(rest);
    let status: u16 = status.parse().ok()?;
    let referer = quoted(rest);
    let agent = referer.and_then(|(_, r)| quoted(r));
    let host = agent.and_then(|(_, r)| quoted(r));
    let ms = host
        .map(|(_, r)| word(r).0)
        .and_then(|t| t.parse::<f64>().ok())
        .map(|secs| (secs * 1000.0).round() as u64);
    // "GET /path HTTP/1.1"; a broken request is just its text.
    let line = request.rsplit_once(" HTTP/").map(|(r, _)| r).unwrap_or(request);
    let (method, path) = line.split_once(' ').unwrap_or(("", line));
    Some(Request {
        time,
        method: method.to_owned(),
        path: path.to_owned(),
        status,
        bytes: bytes.parse().ok(),
        ms,
        host: host.and_then(|(h, _)| field(h)),
        referer: referer.and_then(|(r, _)| field(r)),
        agent: agent.and_then(|(a, _)| field(a)),
        addr: addr.to_owned(),
    })
}

/// The site's names: `shop.test` and its subdomains.
pub fn serves(host: &str, site_host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == site_host || host.strip_suffix(site_host).is_some_and(|sub| sub.ends_with('.'))
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Requests {
    /// Newest first.
    pub requests: Vec<Request>,
    /// The log has older lines than the part read.
    pub older: bool,
}

/// The site's latest `limit` requests, from the end of the access log.
pub fn read(log: &Path, site_host: &str, limit: usize) -> AppResult<Requests> {
    let mut file = match File::open(log) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Requests { requests: Vec::new(), older: false }),
        Err(e) => return Err(e.into()),
    };
    let len = file.metadata()?.len();
    let from = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(from))?;
    let mut bytes = Vec::new();
    file.take(len - from).read_to_end(&mut bytes)?;
    let text = String::from_utf8_lossy(&bytes);
    // A read that starts mid-file starts mid-line: skip that piece.
    let text = if from > 0 { text.split_once('\n').map(|(_, rest)| rest).unwrap_or("") } else { &text };
    let site_host = site_host.to_ascii_lowercase();
    let mut requests: Vec<Request> = text
        .lines()
        .filter_map(parse)
        .filter(|r| r.host.as_deref().is_some_and(|h| serves(h, &site_host)))
        .collect();
    let older = from > 0 || requests.len() > limit;
    let skip = requests.len().saturating_sub(limit);
    requests.drain(..skip);
    requests.reverse();
    Ok(Requests { requests, older })
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINE: &str = r#"127.0.0.1 - - [14/Nov/2026:10:00:01 +0700] "POST /checkout?step=2 HTTP/1.1" 500 5120 "https://shop.test/cart" "Mozilla/5.0 (Windows NT 10.0)" "shop.test" 0.231"#;

    #[test]
    fn reads_every_field_of_a_line() {
        let r = parse(LINE).unwrap();
        assert_eq!(r.time, "2026-11-14 10:00:01");
        assert_eq!((r.method.as_str(), r.path.as_str(), r.status), ("POST", "/checkout?step=2", 500));
        assert_eq!((r.bytes, r.ms), (Some(5120), Some(231)));
        assert_eq!(r.host.as_deref(), Some("shop.test"));
        assert_eq!(r.referer.as_deref(), Some("https://shop.test/cart"));
        assert_eq!(r.addr, "127.0.0.1");
    }

    #[test]
    fn older_lines_without_host_and_broken_requests() {
        let r = parse(r#"127.0.0.1 - - [14/Nov/2026:10:00:01 +0700] "GET / HTTP/1.1" 200 12 "-" "curl/8""#).unwrap();
        assert_eq!((r.host, r.ms, r.referer), (None, None, None));
        let r = parse(r#"127.0.0.1 - - [14/Nov/2026:10:00:01 +0700] "\x16\x03" 400 150 "-" "-" "-" 0.000"#).unwrap();
        assert_eq!((r.method.as_str(), r.status), ("", 400));
        assert!(parse("not a log line").is_none());
    }

    #[test]
    fn a_site_serves_its_name_and_subdomains_only() {
        assert!(serves("shop.test", "shop.test"));
        assert!(serves("API.Shop.test", "shop.test"));
        assert!(!serves("myshop.test", "shop.test"));
        assert!(!serves("shop.test.evil", "shop.test"));
    }

    /// Every line of a real access log parses (read-only): set ZEFARO_ACCESS_LOG
    /// to its path and ZEFARO_ACCESS_HOST to a site's name.
    #[test]
    #[ignore = "reads a real nginx-access.log (run with --ignored)"]
    fn live_parses_a_real_access_log() {
        let Some(path) = std::env::var_os("ZEFARO_ACCESS_LOG") else { return };
        let text = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        let parsed = lines.iter().filter(|l| parse(l).is_some()).count();
        let bad: Vec<&&str> = lines.iter().filter(|l| parse(l).is_none()).take(3).collect();
        assert_eq!(parsed, lines.len(), "unparsed: {bad:?}");
        if let Ok(host) = std::env::var("ZEFARO_ACCESS_HOST") {
            let r = read(std::path::Path::new(&path), &host, 500).unwrap();
            eprintln!("{} lines, {} for {host}, newest: {:?}", lines.len(), r.requests.len(), r.requests.first());
            assert!(!r.requests.is_empty());
        }
    }

    #[test]
    fn reads_the_newest_requests_of_one_site() {
        let path = std::env::temp_dir().join(format!("zefaro-requests-{}.log", std::process::id()));
        let line = |host: &str, path: &str| {
            format!(r#"127.0.0.1 - - [14/Nov/2026:10:00:01 +0700] "GET {path} HTTP/1.1" 200 1 "-" "-" "{host}" 0.001"#)
        };
        let text = [line("shop.test", "/a"), line("blog.test", "/x"), line("shop.test", "/b"), line("api.shop.test", "/c")].join("\n");
        std::fs::write(&path, text + "\n").unwrap();
        let all = read(&path, "shop.test", 10).unwrap();
        assert_eq!(all.requests.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), ["/c", "/b", "/a"]);
        assert!(!all.older);
        let two = read(&path, "shop.test", 2).unwrap();
        assert_eq!(two.requests.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), ["/c", "/b"]);
        assert!(two.older);
        let _ = std::fs::remove_file(&path);
        assert!(read(&path, "shop.test", 2).unwrap().requests.is_empty());
    }
}
