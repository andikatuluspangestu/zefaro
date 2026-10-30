//! Persisted configuration, stored at `~/.config/zefaro/config.json`.
//!
//! Everything Zefaro keeps lives in that one folder, so backing it up or moving
//! it to another computer is a copy.

use crate::model::{PhpLimits, Site};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread::sleep;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct PhpConfig {
    /// php-cgi port base shared by every line (8.5 listens on base + 85).
    pub base_port: u16,
    /// php.ini limits per line ("8.5" → limits); lines without an entry use
    /// PHP's defaults.
    pub limits: BTreeMap<String, PhpLimits>,
    /// Extensions switched on or off per line ("8.5" → "intl" → true). Only
    /// choices that differ from Zefaro's defaults are stored, so a new default
    /// still reaches lines the user never touched.
    pub extensions: BTreeMap<String, BTreeMap<String, bool>>,
}

impl Default for PhpConfig {
    fn default() -> Self {
        Self {
            base_port: 9000,
            limits: BTreeMap::new(),
            extensions: BTreeMap::new(),
        }
    }
}

impl PhpConfig {
    pub fn limits_for(&self, minor: &str) -> PhpLimits {
        self.limits.get(minor).cloned().unwrap_or_default()
    }

    pub fn extensions_for(&self, minor: &str) -> BTreeMap<String, bool> {
        self.extensions.get(minor).cloned().unwrap_or_default()
    }
}

/// nginx settings, edited from the gear on the nginx card.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NginxConfig {
    /// Port for http:// (sites get `:port` in their address when it isn't 80).
    pub http_port: u16,
    /// Port for https:// on secured sites.
    pub https_port: u16,
    /// 0 = one per CPU core ("auto").
    pub worker_processes: u16,
    pub worker_connections: u32,
    /// Seconds an idle keep-alive connection stays open.
    pub keepalive_timeout: u32,
    /// Seconds nginx waits for PHP — raise it when stepping through Xdebug.
    pub fastcgi_read_timeout: u32,
    /// Request body limit in MB; 0 = none (PHP's upload limit applies).
    pub client_max_body_mb: u32,
    pub gzip: bool,
    /// HTTP/2 on secured sites.
    pub http2: bool,
    pub access_log: bool,
    /// Lowest severity written to nginx-error.log.
    pub error_log_level: String,
    /// Extra directives placed inside nginx's `http { }` block.
    pub extra_http: String,
}

impl Default for NginxConfig {
    fn default() -> Self {
        Self {
            http_port: 80,
            https_port: 443,
            worker_processes: 1,
            worker_connections: 1024,
            keepalive_timeout: 65,
            fastcgi_read_timeout: 300,
            client_max_body_mb: 0,
            gzip: false,
            http2: true,
            access_log: true,
            error_log_level: "warn".into(),
            extra_http: String::new(),
        }
    }
}

/// Mailpit settings, edited from the gear on the Mailpit card.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MailpitConfig {
    /// Where apps (and PHP's mail()) send mail.
    pub smtp_port: u16,
    /// Mailpit's web UI and API.
    pub ui_port: u16,
    /// Oldest messages are deleted beyond this many.
    pub max_messages: u32,
    /// Delete messages older than this many days; 0 keeps them.
    pub max_age_days: u32,
}

impl Default for MailpitConfig {
    fn default() -> Self {
        Self { smtp_port: 1025, ui_port: 8025, max_messages: 1000, max_age_days: 0 }
    }
}

/// A database server's settings (MariaDB, MySQL or PostgreSQL), edited from the
/// gear on its card. Fields a server doesn't have are ignored for it. The
/// defaults are what Zefaro used before these settings existed.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DbTuning {
    /// InnoDB's buffer pool (MariaDB, MySQL) or shared_buffers (PostgreSQL), in MB.
    pub memory_mb: u32,
    /// work_mem in MB: memory for each sort or hash (PostgreSQL).
    pub work_mem_mb: u32,
    pub max_connections: u32,
    /// max_allowed_packet in MB (MariaDB, MySQL).
    pub max_packet_mb: u32,
    /// Flush the log to disk about once a second instead of at every commit:
    /// much faster imports and tests, and a power cut can lose the last second.
    pub fast_writes: bool,
    /// Log queries that take longer than `slow_ms`.
    pub slow_log: bool,
    pub slow_ms: u32,
    /// Extra settings: `name = value` lines for my.ini's `[mysqld]`, or for
    /// PostgreSQL's command line.
    pub extra: String,
}

impl DbTuning {
    pub fn mysql_default() -> Self {
        Self {
            memory_mb: 128,
            work_mem_mb: 4,
            max_connections: 151,
            max_packet_mb: 1024,
            fast_writes: true,
            slow_log: false,
            slow_ms: 1000,
            extra: String::new(),
        }
    }

    pub fn postgres_default() -> Self {
        Self { max_connections: 100, fast_writes: false, ..Self::mysql_default() }
    }

    /// The `name = value` pairs of `extra`, comments and blank lines left out.
    pub fn extra_pairs(&self) -> Vec<(String, Option<String>)> {
        self.extra
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with(';'))
            .map(|l| match l.split_once('=') {
                Some((k, v)) => (k.trim().to_owned(), Some(v.trim().trim_matches(['"', '\'']).to_owned())),
                None => (l.to_owned(), None),
            })
            .collect()
    }

    /// Values Zefaro accepts; `postgres` checks PostgreSQL's settings.
    pub fn validate(&self, postgres: bool) -> crate::error::AppResult<()> {
        let range = |name: &str, v: u32, lo: u32, hi: u32| -> crate::error::AppResult<()> {
            if (lo..=hi).contains(&v) {
                Ok(())
            } else {
                Err(crate::error::AppError::msg(crate::tr!(
                    format!("{name} must be between {lo} and {hi}."),
                    format!("{name} harus antara {lo} dan {hi}.")
                )))
            }
        };
        range(if postgres { "shared_buffers" } else { "innodb_buffer_pool_size" }, self.memory_mb, 16, 32768)?;
        range("max_connections", self.max_connections, 10, 10000)?;
        range("slow query threshold", self.slow_ms, 0, 600_000)?;
        if postgres {
            range("work_mem", self.work_mem_mb, 1, 4096)?;
        } else {
            range("max_allowed_packet", self.max_packet_mb, 1, 1024)?;
        }
        for (name, value) in self.extra_pairs() {
            let ok_name = !name.is_empty()
                && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
                && !name.starts_with('[');
            // PostgreSQL takes `-c name=value`, so every line needs a value.
            if !ok_name || (postgres && value.as_deref().is_none_or(str::is_empty)) {
                let line = if let Some(v) = &value { format!("{name} = {v}") } else { name.clone() };
                return Err(crate::error::AppError::msg(crate::tr!(
                    format!("\"{line}\" isn't a setting Zefaro can pass on. Write one name = value per line."),
                    format!("\"{line}\" bukan pengaturan yang bisa diteruskan Zefaro. Tulis satu nama = nilai per baris.")
                )));
            }
        }
        Ok(())
    }
}

impl Default for DbTuning {
    fn default() -> Self {
        Self::mysql_default()
    }
}

fn postgres_tuning() -> DbTuning {
    DbTuning::postgres_default()
}

// `default` at struct level: fields added in newer versions fall back to their
// defaults instead of failing to parse — which would reset the whole config.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct ZefaroConfig {
    pub tld: String,
    /// Parked directories: every immediate subdirectory is auto-served.
    pub paths: Vec<String>,
    pub sites: Vec<Site>,
    /// Active PHP line (e.g. "8.4"); only takes effect once it is installed.
    pub default_php: String,
    pub php: PhpConfig,
    /// Serve phpMyAdmin at phpmyadmin.<tld>.
    pub phpmyadmin: bool,
    pub nginx: NginxConfig,
    /// Active Node.js major line (e.g. "24"); empty until one is installed.
    pub node_default: String,
    pub mailpit: MailpitConfig,
    /// Interface language: "system" (follow Windows), "en" or "id".
    pub language: String,
    /// Closing the window keeps Zefaro (and its services) running in the system tray.
    pub close_to_tray: bool,
    /// The user has answered the question shown the first time they close the window.
    pub close_asked: bool,
    /// Long-running processes for sites (queue workers, schedulers, Vite).
    pub workers: Vec<crate::engine::laravel::Worker>,
    /// Folder the new site wizard last made a project in.
    pub new_site_parent: String,
    /// Ask GitHub whether a newer Zefaro exists when Zefaro starts.
    pub check_updates: bool,
    /// Send `dump()` and `dd()` output from sites to Zefaro's Dumps page.
    pub dumps: bool,
    /// Services started when Zefaro opens (ids such as "mariadb"); only ones already installed.
    pub autostart: Vec<String>,
    /// Database servers' settings, from the gear on each card.
    pub mariadb: DbTuning,
    pub mysql: DbTuning,
    #[serde(default = "postgres_tuning")]
    pub postgres: DbTuning,
}

impl ZefaroConfig {
    /// `http://name.test` or `https://name.test`, with the port when it isn't
    /// the scheme's default.
    pub fn url_for(&self, host: &str, secure: bool) -> String {
        let (scheme, port, default) = if secure {
            ("https", self.nginx.https_port, 443)
        } else {
            ("http", self.nginx.http_port, 80)
        };
        if port == default {
            format!("{scheme}://{host}")
        } else {
            format!("{scheme}://{host}:{port}")
        }
    }
}

impl Default for ZefaroConfig {
    fn default() -> Self {
        Self {
            tld: "test".into(),
            paths: vec![],
            sites: seed_sites(),
            default_php: "8.3".into(),
            php: PhpConfig::default(),
            phpmyadmin: false,
            nginx: NginxConfig::default(),
            node_default: String::new(),
            mailpit: MailpitConfig::default(),
            language: "system".into(),
            close_to_tray: true,
            close_asked: false,
            workers: Vec::new(),
            new_site_parent: String::new(),
            check_updates: true,
            dumps: false,
            autostart: Vec::new(),
            mariadb: DbTuning::mysql_default(),
            mysql: DbTuning::mysql_default(),
            postgres: DbTuning::postgres_default(),
        }
    }
}

/// `~/.config/zefaro`, or the folder in `ZEFARO_CONFIG_DIR` (tests, portable copies).
pub fn config_dir() -> PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        if let Some(dir) = std::env::var_os("ZEFARO_CONFIG_DIR") {
            return PathBuf::from(dir);
        }
        dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".config").join("zefaro")
    })
    .clone()
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

/// config.json existed but couldn't be read at startup. Zefaro then runs on
/// defaults and never writes over the file, so the user's sites aren't lost.
static UNREADABLE: AtomicBool = AtomicBool::new(false);
/// One write at a time, so a delayed save can't land after a newer one.
static WRITE: Mutex<()> = Mutex::new(());
/// The latest settings that couldn't be written yet, because another program
/// had config.json open. A background thread writes them once it's free.
static PENDING: Mutex<Option<ZefaroConfig>> = Mutex::new(None);
static RETRYING: AtomicBool = AtomicBool::new(false);

pub fn load() -> ZefaroConfig {
    load_from(&config_path())
}

fn load_from(path: &Path) -> ZefaroConfig {
    // An editor saving the file can hold it for a moment: wait up to 5 s.
    for _ in 0..25 {
        match std::fs::read(path) {
            Ok(bytes) => return parse_or_set_aside(path, &bytes),
            Err(e) if e.kind() == ErrorKind::NotFound => return ZefaroConfig::default(),
            Err(_) => sleep(Duration::from_millis(200)),
        }
    }
    UNREADABLE.store(true, Ordering::Relaxed);
    eprintln!("Zefaro couldn't read {}; running on defaults and leaving the file alone.", path.display());
    ZefaroConfig::default()
}

/// Parse config.json. A file that isn't valid JSON is copied aside first, so
/// the defaults Zefaro falls back to don't silently replace it.
fn parse_or_set_aside(path: &Path, bytes: &[u8]) -> ZefaroConfig {
    // Some editors save UTF-8 with a byte order mark, which serde rejects.
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF".as_slice()).unwrap_or(bytes);
    match serde_json::from_slice(bytes) {
        Ok(cfg) => cfg,
        Err(e) => {
            let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            let aside = path.with_file_name(format!("config.broken-{secs}.json"));
            let _ = std::fs::copy(path, &aside);
            eprintln!("{} isn't valid JSON ({e}); kept a copy at {}.", path.display(), aside.display());
            ZefaroConfig::default()
        }
    }
}

/// Write the settings. When another program has config.json open (an editor,
/// a sync tool) the write is queued and retried in the background, and this
/// returns Ok: the settings are saved once the file is free.
pub fn save(cfg: &ZefaroConfig) -> std::io::Result<()> {
    if UNREADABLE.load(Ordering::Relaxed) {
        return Err(std::io::Error::other(crate::tr!(
            "Zefaro couldn't read config.json when it started, so it won't overwrite it. Close the program using it and restart Zefaro.",
            "Zefaro tidak bisa membaca config.json saat mulai, jadi tidak akan menimpanya. Tutup program yang memakainya, lalu mulai ulang Zefaro."
        )));
    }
    let json = serde_json::to_vec_pretty(cfg).unwrap_or_default();
    let _held = WRITE.lock().unwrap_or_else(|p| p.into_inner());
    match write_file(&config_path(), &json) {
        Ok(()) => {
            *PENDING.lock().unwrap() = None;
            Ok(())
        }
        Err(e) if is_locked(&e) => {
            *PENDING.lock().unwrap() = Some(cfg.clone());
            start_retrying();
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// Settings are waiting for config.json to be free.
pub fn pending() -> bool {
    PENDING.lock().unwrap().is_some()
}

/// Access denied, sharing violation, lock violation: another program has it.
fn is_locked(e: &std::io::Error) -> bool {
    e.kind() == ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(5 | 32 | 33))
}

/// Write through a temporary file and a rename, so a crash never leaves half
/// a file. A program holding the file open can block the rename; writing in
/// place may still work then.
fn write_file(path: &Path, json: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    let mut last = None;
    for _ in 0..5 {
        match std::fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
        sleep(Duration::from_millis(100));
    }
    let _ = std::fs::remove_file(&tmp);
    match std::fs::write(path, json) {
        Ok(()) => Ok(()),
        Err(e) => Err(if is_locked(&e) { e } else { last.unwrap_or(e) }),
    }
}

fn start_retrying() {
    if RETRYING.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(|| loop {
        sleep(Duration::from_secs(2));
        let _held = WRITE.lock().unwrap_or_else(|p| p.into_inner());
        let Some(cfg) = PENDING.lock().unwrap().clone() else {
            RETRYING.store(false, Ordering::Release);
            return;
        };
        let json = serde_json::to_vec_pretty(&cfg).unwrap_or_default();
        if write_file(&config_path(), &json).is_ok() {
            *PENDING.lock().unwrap() = None;
            RETRYING.store(false, Ordering::Release);
            return;
        }
    });
}

/// Demo sites so the dashboard is populated before the real engine lands.
fn seed_sites() -> Vec<Site> {
    vec![
        Site {
            name: "blog".into(),
            path: "C:\\Projects\\blog".into(),
            url: "http://blog.test".into(),
            secured: false,
            php_version: "8.3".into(),
            kind: "linked".into(),
            framework: None,
            proxy: None,
        },
        Site {
            name: "shop".into(),
            path: "C:\\Projects\\shop".into(),
            url: "https://shop.test".into(),
            secured: true,
            php_version: "8.3".into(),
            kind: "linked".into(),
            framework: None,
            proxy: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zefaro-config-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_a_file_with_a_byte_order_mark() {
        let dir = temp("bom");
        let path = dir.join("config.json");
        std::fs::write(&path, b"\xEF\xBB\xBF{\"tld\":\"localhost\"}").unwrap();
        assert_eq!(load_from(&path).tld, "localhost");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn keeps_a_copy_of_a_broken_file() {
        let dir = temp("broken");
        let path = dir.join("config.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert_eq!(load_from(&path).tld, "test");
        let copies = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with("config.broken-")).count();
        assert_eq!(copies, 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn writes_through_a_temporary_file() {
        let dir = temp("write");
        let path = dir.join("config.json");
        write_file(&path, b"{}").unwrap();
        write_file(&path, b"{\"tld\":\"x\"}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"tld\":\"x\"}");
        assert!(!dir.join("config.json.tmp").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A program holding config.json open without sharing (like some
    /// editors while saving) makes the write fail as "locked".
    #[cfg(windows)]
    #[test]
    fn a_file_held_without_sharing_reports_locked() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = temp("locked");
        let path = dir.join("config.json");
        std::fs::write(&path, b"{}").unwrap();
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(&path).unwrap();
        let err = write_file(&path, b"{\"tld\":\"x\"}").unwrap_err();
        assert!(is_locked(&err), "{err:?}");
        drop(held);
        write_file(&path, b"{\"tld\":\"x\"}").unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }
}
