//! PostgreSQL. Listens on 127.0.0.1:5432 with the superuser `root` and no
//! password (trust login from this computer only), the same login Laravel's
//! `.env` defaults to.
//!
//! PostgreSQL's Windows builds come from EDB. Their zip also carries pgAdmin,
//! the documentation and C headers; Zefaro unpacks only bin, lib and share.

use crate::config::DbTuning;
use crate::engine::archive::{self, Archive};
use crate::engine::supervisor::{Probe, Spec};
use crate::engine::{paths, process};
use crate::error::{AppError, AppResult};
use std::fs;
use std::path::{Path, PathBuf};

pub const VERSION: &str = "18.6";
pub const SERVICE_ID: &str = "postgresql";
pub const PORT: u16 = 5432;
pub const DOWNLOAD_MB: u32 = 328;
/// The superuser initdb creates, and the user every Zefaro tool connects as.
pub const USER: &str = "root";

/// postgresql-18.6-1-windows-x64-binaries.zip, the archive the EDB download
/// page links for PostgreSQL 18.6. EDB publishes no checksum for it; the
/// SHA-256 was recorded from a download over HTTPS from get.enterprisedb.com.
const ARCHIVE: Archive = Archive {
    name: "PostgreSQL 18.6",
    url: "https://get.enterprisedb.com/postgresql/postgresql-18.6-1-windows-x64-binaries.zip",
    sha256: "fbe23da234ee31547bf8a36d29dfd81e82b849df2d2b78d2eecb43d360252f8c",
    inner: "pgsql",
};

/// Folders of the zip Zefaro doesn't need.
const SKIP: &[&str] = &["pgAdmin 4", "StackBuilder", "doc", "include", "symbols"];

#[derive(Clone, Debug)]
pub struct Layout {
    /// bin/postgres.exe, lib, share.
    pub base: PathBuf,
    pub data: PathBuf,
    pub log: PathBuf,
    pub port: u16,
}

impl Layout {
    pub fn standard() -> Self {
        Self {
            base: paths::bin_dir().join("postgresql"),
            data: paths::data_dir().join("postgresql"),
            log: paths::logs_dir().join("postgresql.log"),
            port: PORT,
        }
    }

    pub fn bin(&self, exe: &str) -> PathBuf {
        self.base.join("bin").join(exe)
    }
}

pub fn installed(l: &Layout) -> bool {
    l.bin("postgres.exe").is_file()
}

fn initialized(l: &Layout) -> bool {
    l.data.join("PG_VERSION").is_file()
}

/// initdb's arguments: UTF-8 with the C locale, so collation doesn't depend
/// on Windows' language, and trust login. The server only listens on
/// 127.0.0.1, so "trust" means programs on this computer.
pub fn initdb_args(l: &Layout) -> Vec<String> {
    vec![
        format!("--pgdata={}", l.data.display()),
        format!("--username={USER}"),
        "--auth=trust".into(),
        "--encoding=UTF8".into(),
        "--no-locale".into(),
        "--no-instructions".into(),
    ]
}

fn initialize(l: &Layout) -> AppResult<()> {
    if l.data.is_dir() && fs::read_dir(&l.data)?.next().is_some() {
        let data = l.data.display();
        return Err(AppError::msg(crate::tr!(
            format!("{data} has files in it but isn't a PostgreSQL data folder. Move the folder somewhere else and start PostgreSQL again."),
            format!("{data} berisi file tetapi bukan folder data PostgreSQL. Pindahkan folder itu ke tempat lain, lalu mulai PostgreSQL lagi.")
        )));
    }
    if let Some(parent) = l.data.parent() {
        fs::create_dir_all(parent)?;
    }
    process::run(process::command(l.bin("initdb.exe")).args(initdb_args(l))).map(|_| ()).map_err(|e| {
        AppError::msg(crate::tr!(
            format!("Zefaro couldn't create the PostgreSQL data folder: {e}"),
            format!("Zefaro tidak dapat membuat folder data PostgreSQL: {e}")
        ))
    })
}

/// Install on first use and create the data folder once. Serialized, so two
/// starts at once can't install or initialise twice.
pub fn prepare(l: &Layout, scratch: &Path, keep_zip: bool) -> AppResult<()> {
    archive::exclusive(&l.base, || {
        if !installed(l) {
            ARCHIVE.install_without(&l.base, scratch, keep_zip, SKIP)?;
        }
        if !initialized(l) {
            initialize(l)?;
        }
        Ok(())
    })
}

/// The command line with Zefaro's default settings (tests; Services uses [spec_with]).
#[cfg(test)]
pub fn spec(l: &Layout) -> Spec {
    spec_with(l, &DbTuning::postgres_default())
}

/// The settings from the gear on the PostgreSQL card, as `-c` values. They
/// come after Zefaro's own, which they can't override: `listen_addresses` and
/// logging stay as Zefaro needs them.
pub fn tuning_settings(s: &DbTuning) -> Vec<String> {
    let mut out = vec![
        format!("shared_buffers={}MB", s.memory_mb),
        format!("work_mem={}MB", s.work_mem_mb),
        format!("max_connections={}", s.max_connections),
        // Off: a commit returns before its WAL is on disk. A crash can lose the
        // last moments of commits but never corrupts the data.
        format!("synchronous_commit={}", if s.fast_writes { "off" } else { "on" }),
        format!("log_min_duration_statement={}", if s.slow_log { s.slow_ms as i64 } else { -1 }),
    ];
    for (name, value) in s.extra_pairs() {
        if ZEFARO_OWN.contains(&name.as_str()) {
            continue;
        }
        if let Some(value) = value {
            out.push(format!("{name}={value}"));
        }
    }
    out
}

/// Settings Zefaro sets itself and never takes from the user's extra lines.
pub const ZEFARO_OWN: &[&str] = &["listen_addresses", "port", "logging_collector", "log_destination", "log_connections", "data_directory"];

/// The PostgreSQL command line with the card's settings.
pub fn spec_with(l: &Layout, s: &DbTuning) -> Spec {
    let c = |setting: &str| -> [std::ffi::OsString; 2] { ["-c".into(), setting.into()] };
    let mut args: Vec<std::ffi::OsString> = vec!["-D".into(), l.data.clone().into(), "-p".into(), l.port.to_string().into()];
    for setting in [
        // Loopback only, whatever postgresql.conf says.
        "listen_addresses=127.0.0.1",
        // Log to stderr, which the supervisor writes to postgresql.log.
        "logging_collector=off",
        "log_destination=stderr",
        // Zefaro's health check connects and leaves without logging in.
        "log_connections=off",
    ] {
        args.extend(c(setting));
    }
    for setting in tuning_settings(s) {
        args.extend(c(&setting));
    }
    Spec {
        id: SERVICE_ID.into(),
        program: l.bin("postgres.exe"),
        args,
        cwd: l.base.clone(),
        env: Vec::new(),
        log: l.log.clone(),
        port: l.port,
        probe: Probe::Tcp,
        // A fast shutdown ends sessions and writes a checkpoint, so the next
        // start needs no crash recovery.
        stop: Some((
            l.bin("pg_ctl.exe"),
            vec!["stop".into(), "-D".into(), l.data.clone().into(), "-m".into(), "fast".into(), "-s".into()],
        )),
    }
}

/// psql's connection settings as environment variables, which arguments the
/// user passes still override.
pub fn client_env(port: u16) -> Vec<(&'static str, String)> {
    vec![
        ("PGHOST", "127.0.0.1".into()),
        ("PGPORT", port.to_string()),
        ("PGUSER", USER.into()),
        ("PGDATABASE", "postgres".into()),
    ]
}

/// Does a database exist?
pub fn database_exists(l: &Layout, name: &str) -> AppResult<bool> {
    let out = psql(l, &format!("SELECT 1 FROM pg_database WHERE datname = '{}'", name.replace('\'', "''")))?;
    Ok(out.trim() == "1")
}

/// Create a database owned by root.
pub fn create_database(l: &Layout, name: &str) -> AppResult<()> {
    psql(l, &format!("CREATE DATABASE \"{}\"", name.replace('"', "\"\""))).map(|_| ())
}

/// Run SQL through psql as root on the postgres database; returns its output
/// (tuples only, unaligned).
pub fn psql(l: &Layout, sql: &str) -> AppResult<String> {
    let mut cmd = process::command(l.bin("psql.exe"));
    cmd.args(["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql]);
    for (k, v) in client_env(l.port) {
        cmd.env(k, v);
    }
    process::run(&mut cmd)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::supervisor::{port_open, Supervisor};

    fn layout(root: &Path, port: u16) -> Layout {
        Layout { base: root.join("pg"), data: root.join("data"), log: root.join("postgresql.log"), port }
    }

    #[test]
    fn card_settings_follow_zefaros_own() {
        // The defaults are PostgreSQL's own, which Zefaro always used.
        let d = tuning_settings(&DbTuning::postgres_default());
        for s in ["shared_buffers=128MB", "work_mem=4MB", "max_connections=100", "synchronous_commit=on", "log_min_duration_statement=-1"] {
            assert!(d.contains(&s.to_owned()), "{s}");
        }
        let s = DbTuning {
            memory_mb: 256,
            fast_writes: true,
            slow_log: true,
            slow_ms: 200,
            extra: "random_page_cost = 1.1\nlisten_addresses = '*'\n".into(),
            ..DbTuning::postgres_default()
        };
        let l = layout(Path::new(r"C:\zefaro"), 5432);
        let args: Vec<String> = spec_with(&l, &s).args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        for want in ["shared_buffers=256MB", "synchronous_commit=off", "log_min_duration_statement=200", "random_page_cost=1.1"] {
            assert!(args.windows(2).any(|w| w == ["-c", want]), "{want}: {args:?}");
        }
        assert!(!args.iter().any(|a| a.contains('*')), "Zefaro's listen_addresses can't be replaced");
        let zefaro = args.iter().position(|a| a == "listen_addresses=127.0.0.1").unwrap();
        assert!(zefaro < args.iter().position(|a| a == "shared_buffers=256MB").unwrap());
    }

    #[test]
    fn spec_listens_on_loopback_and_stops_gracefully() {
        let l = layout(Path::new(r"C:\zefaro"), 5432);
        let args: Vec<String> = spec(&l).args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|w| w == ["-c", "listen_addresses=127.0.0.1"]));
        assert!(args.windows(2).any(|w| w == ["-p", "5432"]));
        let stop = spec(&l).stop.unwrap();
        assert!(stop.0.ends_with("pg_ctl.exe"));
        assert!(stop.1.iter().any(|a| a == "fast"));
        assert!(initdb_args(&l).contains(&"--username=root".to_owned()));
        assert!(initdb_args(&l).contains(&"--auth=trust".to_owned()));
    }

    /// Installs PostgreSQL from the pinned zip into a temp folder (the zip is
    /// kept in `ZEFARO_PG_ZIP_DIR`, or downloaded there), initialises it, starts
    /// it on a spare port, creates a database and stops it cleanly.
    #[test]
    #[ignore]
    fn live_installs_starts_and_stops_postgresql() {
        let root = std::env::temp_dir().join("zefaro-postgres-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let scratch = std::env::var_os("ZEFARO_PG_ZIP_DIR").map(PathBuf::from).unwrap_or_else(|| root.join("dl"));
        let l = layout(&root, 55432);
        // Install inside a progress scope while another thread watches it, as
        // the Services page does.
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let watcher = {
            let (seen, done) = (seen.clone(), done.clone());
            std::thread::spawn(move || {
                while !done.load(std::sync::atomic::Ordering::Relaxed) {
                    if let Some(p) = crate::engine::progress::all().get(SERVICE_ID) {
                        let mut seen = seen.lock().unwrap();
                        if seen.last() != Some(&p.phase) {
                            seen.push(p.phase.clone());
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            })
        };
        crate::engine::progress::scope(SERVICE_ID, || prepare(&l, &scratch, true)).unwrap();
        done.store(true, std::sync::atomic::Ordering::Relaxed);
        watcher.join().unwrap();
        let seen = seen.lock().unwrap().clone();
        assert!(seen.contains(&"extract".to_owned()) && seen.ends_with(&["setup".to_owned()]), "{seen:?}");
        assert!(!crate::engine::progress::all().contains_key(SERVICE_ID), "cleared after the start");
        assert!(installed(&l));
        assert!(!l.base.join("pgAdmin 4").exists(), "pgAdmin was unpacked");
        assert!(l.data.join("PG_VERSION").is_file());

        let sup = Supervisor::default();
        sup.start(spec(&l)).unwrap();
        assert!(port_open(55432));
        assert!(psql(&l, "SELECT version()").unwrap().contains("PostgreSQL 18.6"));
        assert!(psql(&l, "SHOW server_encoding").unwrap().contains("UTF8"));
        assert!(!database_exists(&l, "zefaro_test").unwrap());
        create_database(&l, "zefaro_test").unwrap();
        assert!(database_exists(&l, "zefaro_test").unwrap());

        sup.stop(SERVICE_ID).unwrap();
        assert!(!port_open(55432));
        let log = fs::read_to_string(&l.log).unwrap();
        assert!(log.contains("database system is shut down"), "{log}");
        let _ = fs::remove_dir_all(&root);
    }
}
