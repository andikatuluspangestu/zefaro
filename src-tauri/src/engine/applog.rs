//! A Laravel app's own logs (`storage/logs/*.log`), read into entries for the
//! site page: time, environment, level, message, and the context and stack
//! trace that follow.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Only the end of a big log is read.
const TAIL_BYTES: u64 = 2 * 1024 * 1024;
/// Entries returned at most, newest kept.
const MAX_ENTRIES: usize = 500;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppLogFile {
    pub name: String,
    pub size: u64,
    /// ms since the Unix epoch.
    pub modified: Option<u64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppLogEntry {
    /// "2026-10-27 08:00:00" as written.
    pub time: String,
    /// "local", "production", …
    pub env: String,
    /// Lowercase: debug, info, notice, warning, error, critical, alert, emergency.
    pub level: String,
    pub message: String,
    /// Context JSON and the stack trace, as written.
    pub detail: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppLog {
    pub file: AppLogFile,
    pub entries: Vec<AppLogEntry>,
    /// Older entries exist than the ones returned.
    pub truncated: bool,
}

fn logs_dir(project: &Path) -> PathBuf {
    project.join("storage").join("logs")
}

fn file_info(path: &Path) -> Option<AppLogFile> {
    let meta = fs::metadata(path).ok()?;
    Some(AppLogFile {
        name: path.file_name()?.to_string_lossy().into_owned(),
        size: meta.len(),
        modified: meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64),
    })
}

/// The app's log files, most recently written first.
pub fn list(project: &Path) -> Vec<AppLogFile> {
    let mut files: Vec<AppLogFile> = fs::read_dir(logs_dir(project))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "log"))
        .filter_map(|e| file_info(&e.path()))
        .collect();
    files.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
    files
}

/// A log file of the app by name; anything that isn't a plain `*.log` name
/// is refused, so no other file can be read or cleared.
fn resolve(project: &Path, name: &str) -> AppResult<PathBuf> {
    let plain = name.ends_with(".log")
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if !plain {
        return Err(AppError::msg(crate::tr!(
            format!("{name} isn't a log file of this app."),
            format!("{name} bukan file log aplikasi ini.")
        )));
    }
    Ok(logs_dir(project).join(name))
}

/// Split log text into entries. A line that starts with `[date time]` starts
/// an entry; the lines after it (stack traces) belong to it.
pub fn parse(text: &str) -> Vec<AppLogEntry> {
    let mut entries: Vec<AppLogEntry> = Vec::new();
    for line in text.lines() {
        match parse_header(line) {
            Some(entry) => entries.push(entry),
            None => {
                if let Some(last) = entries.last_mut() {
                    if !last.detail.is_empty() {
                        last.detail.push('\n');
                    }
                    last.detail.push_str(line);
                }
            }
        }
    }
    entries
}

/// `[2026-10-27 08:00:00] local.ERROR: message {"context":1}`
fn parse_header(line: &str) -> Option<AppLogEntry> {
    let rest = line.strip_prefix('[')?;
    let (time, rest) = rest.split_once("] ")?;
    let looks_like_time = time.len() >= 19
        && time.as_bytes()[4] == b'-'
        && time.as_bytes()[10] == b' '
        && time[..4].chars().all(|c| c.is_ascii_digit());
    if !looks_like_time {
        return None;
    }
    let (channel, message) = rest.split_once(": ")?;
    let (env, level) = channel.rsplit_once('.')?;
    if level.is_empty() || !level.chars().all(|c| c.is_ascii_uppercase()) {
        return None;
    }
    // The context JSON (and an exception's first line) follows the message.
    let (message, detail) = match message.find(" {\"").or_else(|| message.find(" [object]")) {
        Some(at) => (&message[..at], message[at + 1..].to_owned()),
        None => (message, String::new()),
    };
    Some(AppLogEntry {
        time: time.to_owned(),
        env: env.to_owned(),
        level: level.to_lowercase(),
        message: message.trim_end().to_owned(),
        detail,
    })
}

pub fn read(project: &Path, name: &str) -> AppResult<AppLog> {
    let path = resolve(project, name)?;
    let info = file_info(&path).ok_or_else(|| {
        AppError::msg(crate::tr!(format!("{name} no longer exists."), format!("{name} sudah tidak ada.")))
    })?;
    let mut file = File::open(&path)?;
    let start = info.size.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if start > 0 {
        // Drop the partial first line; the first whole entry starts after it.
        text = text.split_once('\n').map(|(_, t)| t.to_owned()).unwrap_or_default();
    }
    let mut entries = parse(&text);
    let mut truncated = start > 0;
    if entries.len() > MAX_ENTRIES {
        entries.drain(..entries.len() - MAX_ENTRIES);
        truncated = true;
    }
    Ok(AppLog { file: info, entries, truncated })
}

/// Empty a log file (Laravel keeps writing to it).
pub fn clear(project: &Path, name: &str) -> AppResult<()> {
    let path = resolve(project, name)?;
    File::create(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"[2026-10-27 08:00:00] local.INFO: User signed in {"id":1}
[2026-10-27 08:00:05] local.ERROR: Division by zero {"exception":"[object] (DivisionByZeroError(code: 0): Division by zero at C:\\app\\routes\\web.php:7)
[stacktrace]
#0 C:\\app\\vendor\\laravel\\framework\\src\\Illuminate\\Routing\\Route.php(240): {closure}()
#1 {main}
"}
[2026-10-27 08:01:00] production.WARNING: Slow query
"#;

    #[test]
    fn splits_entries_and_keeps_traces() {
        let entries = parse(SAMPLE);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].level, "info");
        assert_eq!(entries[0].message, "User signed in");
        assert_eq!(entries[0].detail, r#"{"id":1}"#);
        assert_eq!(entries[1].level, "error");
        assert_eq!(entries[1].message, "Division by zero");
        assert!(entries[1].detail.contains("[stacktrace]"));
        assert!(entries[1].detail.ends_with("\"}"));
        assert_eq!(entries[2].env, "production");
        assert_eq!(entries[2].message, "Slow query");
        assert_eq!(entries[2].detail, "");
    }

    #[test]
    fn ignores_text_that_is_not_an_entry() {
        assert!(parse("PHP Warning: something\n[not a date] x.ERROR: y\n").is_empty());
    }

    #[test]
    fn refuses_other_files() {
        let p = Path::new("C:\\app");
        assert!(resolve(p, "laravel.log").is_ok());
        assert!(resolve(p, "laravel-2026-10-27.log").is_ok());
        assert!(resolve(p, "../.env").is_err());
        assert!(resolve(p, "..\\x.log").is_err());
        assert!(resolve(p, ".env").is_err());
    }

    /// Reads the log of the throwaway Laravel app in %TEMP%\zefaro-laravel-test,
    /// after something logged an exception there.
    #[test]
    #[ignore]
    fn live_reads_a_real_laravel_log() {
        let app = std::env::temp_dir().join("zefaro-laravel-test");
        let log = read(&app, "laravel.log").unwrap();
        assert!(!log.entries.is_empty());
        let error = log.entries.iter().rev().find(|e| e.level == "error").expect("an error entry");
        assert!(error.detail.contains("[stacktrace]"), "{error:?}");
        assert!(error.detail.contains("{main}"), "{error:?}");
        assert!(log.entries.iter().all(|e| !e.time.is_empty() && !e.env.is_empty()));
    }

    #[test]
    fn reads_the_end_of_a_log() {
        let dir = std::env::temp_dir().join("zefaro-applog-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(logs_dir(&dir)).unwrap();
        fs::write(logs_dir(&dir).join("laravel.log"), SAMPLE).unwrap();
        assert_eq!(list(&dir).len(), 1);
        let log = read(&dir, "laravel.log").unwrap();
        assert_eq!(log.entries.len(), 3);
        assert!(!log.truncated);
        clear(&dir, "laravel.log").unwrap();
        assert!(read(&dir, "laravel.log").unwrap().entries.is_empty());
        let _ = fs::remove_dir_all(dir);
    }
}
