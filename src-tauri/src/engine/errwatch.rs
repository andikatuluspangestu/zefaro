//! Watches for errors on the sites: server errors (5xx) in nginx's access log
//! and ERROR (or worse) lines in each Laravel app's `storage/logs`. Only what
//! is written after Zefaro starts watching counts.

use crate::engine::requests;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// At most this much new text is read from one file per look.
const MAX_READ: u64 = 512 * 1024;
/// More events than this for one site in one look are only counted.
const MAX_EVENTS: usize = 20;

/// A site Zefaro watches: its name, `name.test`, and its Laravel log folder.
#[derive(Clone, Debug)]
pub struct Watched {
    pub name: String,
    pub host: String,
    /// `storage/logs`, for a Laravel app.
    pub logs: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum What {
    Status { status: u16, method: String, path: String },
    Log { level: String, message: String },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Event {
    pub site: String,
    pub what: What,
}

#[derive(Default)]
pub struct Watcher {
    /// How far each file has been read.
    cursors: HashMap<PathBuf, u64>,
    /// Log folders seen before: a file new in one of them is read from its start.
    dirs: HashSet<PathBuf>,
}

impl Watcher {
    /// The errors written since the last look.
    pub fn tick(&mut self, access_log: &Path, sites: &[Watched]) -> Vec<Event> {
        let mut events = Vec::new();
        for line in self.new_lines(access_log, false) {
            let Some(r) = requests::parse(&line) else { continue };
            if r.status < 500 {
                continue;
            }
            let Some(host) = r.host.as_deref() else { continue };
            if let Some(site) = sites.iter().find(|s| requests::serves(host, &s.host)) {
                events.push(Event { site: site.name.clone(), what: What::Status { status: r.status, method: r.method, path: r.path } });
            }
        }
        for site in sites {
            let Some(dir) = &site.logs else { continue };
            let known = self.dirs.contains(dir);
            let Ok(entries) = fs::read_dir(dir) else { continue };
            let mut files: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_file() && p.extension().is_some_and(|x| x.eq_ignore_ascii_case("log")))
                .collect();
            files.sort();
            for file in files {
                for line in self.new_lines(&file, known) {
                    if let Some((level, message)) = laravel_error(&line) {
                        events.push(Event { site: site.name.clone(), what: What::Log { level, message } });
                    }
                }
            }
            self.dirs.insert(dir.clone());
        }
        // A burst (a broken page reloaded, a failing loop) is kept to a few per site.
        let mut per_site: HashMap<String, usize> = HashMap::new();
        events.retain(|e| {
            let n = per_site.entry(e.site.clone()).or_insert(0);
            *n += 1;
            *n <= MAX_EVENTS
        });
        events
    }

    /// Whole lines added to `path` since it was last read. A file seen for the
    /// first time is read from its start only when `from_start` (it appeared
    /// while Zefaro was watching); otherwise reading starts at its end.
    fn new_lines(&mut self, path: &Path, from_start: bool) -> Vec<String> {
        let Ok(len) = fs::metadata(path).map(|m| m.len()) else { return Vec::new() };
        let start = match self.cursors.get(path) {
            None if !from_start => {
                self.cursors.insert(path.to_path_buf(), len);
                return Vec::new();
            }
            None => 0,
            // Cleared or replaced.
            Some(&at) if len < at => 0,
            Some(&at) => at,
        };
        if start >= len {
            return Vec::new();
        }
        let from = start.max(len - MAX_READ.min(len));
        let mut bytes = Vec::new();
        let read = File::open(path).and_then(|mut f| {
            f.seek(SeekFrom::Start(from))?;
            f.take(len - from).read_to_end(&mut bytes)
        });
        if read.is_err() {
            return Vec::new();
        }
        // Only whole lines; the rest waits for the next look.
        let Some(end) = bytes.iter().rposition(|&b| b == b'\n') else {
            self.cursors.insert(path.to_path_buf(), start);
            return Vec::new();
        };
        self.cursors.insert(path.to_path_buf(), from + end as u64 + 1);
        let text = String::from_utf8_lossy(&bytes[..end]);
        let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
        // Skipped ahead past a big burst: the first piece is half a line.
        if from > start && !lines.is_empty() {
            lines.remove(0);
        }
        lines
    }
}

/// `[2026-11-14 10:00:01] local.ERROR: message {"exception":…}` → ("ERROR", "message").
pub fn laravel_error(line: &str) -> Option<(String, String)> {
    let rest = line.strip_prefix('[')?;
    let (stamp, rest) = rest.split_once("] ")?;
    if stamp.len() < 19 || !stamp.starts_with(|c: char| c.is_ascii_digit()) {
        return None;
    }
    let (channel, message) = rest.split_once(": ")?;
    let level = channel.rsplit('.').next()?;
    if !matches!(level, "ERROR" | "CRITICAL" | "ALERT" | "EMERGENCY") {
        return None;
    }
    // The context JSON after the message is for the log, not a notification.
    let message = message.split(" {\"").next().unwrap_or(message).trim();
    let message: String = message.chars().take(200).collect();
    Some((level.to_owned(), message))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zefaro-errwatch-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn append(path: &Path, text: &str) {
        use std::io::Write;
        fs::OpenOptions::new().create(true).append(true).open(path).unwrap().write_all(text.as_bytes()).unwrap();
    }

    #[test]
    fn reads_laravel_error_lines() {
        let (level, message) =
            laravel_error(r#"[2026-11-14 10:00:01] local.ERROR: SQLSTATE[42S02]: Base table not found {"exception":"[object] (…)"}"#).unwrap();
        assert_eq!((level.as_str(), message.as_str()), ("ERROR", "SQLSTATE[42S02]: Base table not found"));
        assert!(laravel_error("[2026-11-14 10:00:01] production.CRITICAL: Disk full").is_some());
        assert!(laravel_error("[2026-11-14 10:00:01] local.WARNING: Slow query").is_none());
        assert!(laravel_error("#0 /app/vendor/laravel/framework/src/Foo.php(12): bar()").is_none());
        assert!(laravel_error("[stacktrace]").is_none());
    }

    #[test]
    fn only_what_is_written_after_watching_starts() {
        let dir = temp("logs");
        let access = dir.join("nginx-access.log");
        let logs = dir.join("storage-logs");
        fs::create_dir_all(&logs).unwrap();
        append(&access, "127.0.0.1 - - [14/Nov/2026:10:00:00 +0700] \"GET /old HTTP/1.1\" 500 1 \"-\" \"-\" \"shop.test\" 0.010\n");
        append(&logs.join("laravel.log"), "[2026-11-14 10:00:00] local.ERROR: old one\n");
        let sites = [Watched { name: "shop".into(), host: "shop.test".into(), logs: Some(logs.clone()) }];
        let mut w = Watcher::default();
        assert!(w.tick(&access, &sites).is_empty(), "what was there before isn't news");

        append(&access, "127.0.0.1 - - [14/Nov/2026:10:00:05 +0700] \"POST /pay HTTP/1.1\" 502 1 \"-\" \"-\" \"shop.test\" 0.010\n");
        append(&access, "127.0.0.1 - - [14/Nov/2026:10:00:05 +0700] \"GET / HTTP/1.1\" 200 1 \"-\" \"-\" \"shop.test\" 0.010\n");
        append(&access, "127.0.0.1 - - [14/Nov/2026:10:00:05 +0700] \"GET / HTTP/1.1\" 500 1 \"-\" \"-\" \"blog.test\" 0.010\n");
        append(&logs.join("laravel.log"), "[2026-11-14 10:00:05] local.ERROR: new one {\"exception\":\"x\"}\n#0 trace line\n");
        // A daily log made while watching is read from its start.
        append(&logs.join("laravel-2026-11-14.log"), "[2026-11-14 10:00:06] local.CRITICAL: daily\n");
        let events = w.tick(&access, &sites);
        assert_eq!(
            events,
            [
                Event { site: "shop".into(), what: What::Status { status: 502, method: "POST".into(), path: "/pay".into() } },
                Event { site: "shop".into(), what: What::Log { level: "CRITICAL".into(), message: "daily".into() } },
                Event { site: "shop".into(), what: What::Log { level: "ERROR".into(), message: "new one".into() } },
            ]
        );
        assert!(w.tick(&access, &sites).is_empty(), "each line counts once");

        // Half a line waits; a cleared log starts over.
        append(&logs.join("laravel.log"), "[2026-11-14 10:00:07] local.ERROR: half");
        assert!(w.tick(&access, &sites).is_empty());
        append(&logs.join("laravel.log"), " done\n");
        assert_eq!(w.tick(&access, &sites).len(), 1);
        fs::write(logs.join("laravel.log"), "[2026-11-14 10:00:08] local.ERROR: after clear\n").unwrap();
        assert_eq!(w.tick(&access, &sites).len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_site_added_later_starts_at_the_end_of_its_logs() {
        let dir = temp("added");
        let access = dir.join("nginx-access.log");
        let logs = dir.join("logs");
        fs::create_dir_all(&logs).unwrap();
        append(&logs.join("laravel.log"), "[2026-11-14 10:00:00] local.ERROR: from last week\n");
        let mut w = Watcher::default();
        assert!(w.tick(&access, &[]).is_empty());
        let sites = [Watched { name: "shop".into(), host: "shop.test".into(), logs: Some(logs.clone()) }];
        assert!(w.tick(&access, &sites).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
