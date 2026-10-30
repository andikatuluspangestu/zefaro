//! Backing up and restoring Zefaro: the sites and settings, and the MariaDB
//! databases, in one zip file.
//!
//! ```text
//! manifest.json            what is inside, and which Zefaro made it
//! config.json              the sites and settings (the same file Zefaro keeps)
//! databases/<name>.sql     one plain SQL dump per MariaDB database
//! ```
//!
//! Left out on purpose: the HTTPS certificate authority (its private key is
//! encrypted for this Windows account and can't be opened anywhere else, so a
//! copy would be useless and only a risk), the downloaded programs (Zefaro
//! installs them again), mail, and the project folders themselves.
//!
//! A restore never overwrites a database that already exists: the dump loads
//! into a new database, and one that exists is skipped.

use crate::config::ZefaroConfig;
use crate::engine::dbio::{self, Client};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Bumped when a backup is laid out differently, so an older Zefaro says so
/// instead of misreading a newer file.
pub const FORMAT: u32 = 1;

const MANIFEST: &str = "manifest.json";
const SETTINGS: &str = "config.json";
const DB_DIR: &str = "databases/";
/// Nothing in a backup's two small files is bigger than this.
const SMALL_FILE_LIMIT: u64 = 16 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: u32,
    /// The Zefaro version that made the backup.
    pub zefaro: String,
    /// Unix seconds.
    pub created: i64,
    pub sites: usize,
    /// MariaDB databases dumped into the file.
    pub databases: Vec<String>,
}

/// One database found in a backup.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DbEntry {
    pub name: String,
    /// Size of its dump, uncompressed.
    pub bytes: u64,
}

/// What a backup file holds, read before restoring it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Contents {
    pub zefaro: String,
    pub created: i64,
    pub sites: usize,
    pub databases: Vec<DbEntry>,
}

/// Where a backup or restore has got to, for the progress bar.
pub struct Step<'a> {
    /// "settings", "database" or "finishing".
    pub phase: &'static str,
    /// The database being dumped or loaded.
    pub name: Option<&'a str>,
    /// Databases finished so far, and in all.
    pub done: usize,
    pub total: usize,
}

fn msg(en: String, id: String) -> AppError {
    AppError::msg(crate::tr!(en, id))
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn not_a_backup() -> AppError {
    AppError::msg(crate::tr!(
        "That file isn't a Zefaro backup.",
        "Berkas itu bukan cadangan Zefaro."
    ))
}

fn cancelled() -> AppError {
    dbio::cancelled()
}

/// Make the backup at `dest`: the settings of `cfg`, and, when `client` is
/// given, every user database of that MariaDB. Dumps are written one at a time
/// to `scratch` and added to the zip, so the extra disk space is one database.
/// `dest` only appears once the file is complete.
pub fn create(
    cfg: &ZefaroConfig,
    client: Option<&Client>,
    dest: &Path,
    scratch: &Path,
    cancel: &AtomicBool,
    mut on: impl FnMut(Step),
) -> AppResult<Manifest> {
    let part = dest.with_extension("zip.part");
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::create_dir_all(scratch)?;
    let result = write_zip(cfg, client, &part, scratch, cancel, &mut on);
    match result {
        Ok(manifest) => {
            if dest.exists() {
                fs::remove_file(dest)?;
            }
            fs::rename(&part, dest)?;
            Ok(manifest)
        }
        Err(e) => {
            let _ = fs::remove_file(&part);
            Err(e)
        }
    }
}

fn write_zip(
    cfg: &ZefaroConfig,
    client: Option<&Client>,
    part: &Path,
    scratch: &Path,
    cancel: &AtomicBool,
    on: &mut impl FnMut(Step),
) -> AppResult<Manifest> {
    let mut zip = ZipWriter::new(File::create(part)?);
    let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    on(Step { phase: "settings", name: None, done: 0, total: 0 });
    zip.start_file(SETTINGS, deflate)?;
    zip.write_all(&serde_json::to_vec_pretty(cfg)?)?;

    let names: Vec<String> = match client {
        Some(c) => dbio::list(c)?.into_iter().map(|d| d.name).collect(),
        None => Vec::new(),
    };
    let total = names.len();
    for (i, name) in names.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(cancelled());
        }
        on(Step { phase: "database", name: Some(name), done: i, total });
        let dump = scratch.join(format!("{name}.sql"));
        let client = client.expect("databases are only listed with a client");
        let dumped = dbio::export(client, name, &dump, false, cancel, |_| {});
        let added = dumped.and_then(|_| {
            // `large_file`: one database can pass 4 GB.
            zip.start_file(format!("{DB_DIR}{name}.sql"), deflate.large_file(true))?;
            io::copy(&mut File::open(&dump)?, &mut zip)?;
            Ok(())
        });
        let _ = fs::remove_file(&dump);
        added?;
    }

    on(Step { phase: "finishing", name: None, done: total, total });
    let manifest = Manifest {
        format: FORMAT,
        zefaro: env!("CARGO_PKG_VERSION").to_owned(),
        created: now(),
        sites: cfg.sites.len(),
        databases: names,
    };
    zip.start_file(MANIFEST, deflate)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
    zip.finish()?;
    Ok(manifest)
}

/// A small file of the archive, read whole (never more than the limit).
fn read_small(zip: &mut ZipArchive<File>, name: &str) -> AppResult<Vec<u8>> {
    let entry = zip.by_name(name).map_err(|_| not_a_backup())?;
    if entry.size() > SMALL_FILE_LIMIT {
        return Err(not_a_backup());
    }
    let mut out = Vec::with_capacity(entry.size() as usize);
    entry.take(SMALL_FILE_LIMIT).read_to_end(&mut out)?;
    Ok(out)
}

fn open(path: &Path) -> AppResult<(ZipArchive<File>, Manifest)> {
    let mut zip = ZipArchive::new(File::open(path)?).map_err(|_| not_a_backup())?;
    let manifest: Manifest = serde_json::from_slice(&read_small(&mut zip, MANIFEST)?).map_err(|_| not_a_backup())?;
    if manifest.format > FORMAT {
        return Err(msg(
            format!(
                "This backup was made by a newer Zefaro (version {}). Update Zefaro, then open it again.",
                manifest.zefaro
            ),
            format!(
                "Cadangan ini dibuat oleh Zefaro yang lebih baru (versi {}). Perbarui Zefaro, lalu buka lagi.",
                manifest.zefaro
            ),
        ));
    }
    Ok((zip, manifest))
}

/// Read what a backup holds, without changing anything.
pub fn inspect(path: &Path) -> AppResult<Contents> {
    let (mut zip, manifest) = open(path)?;
    let mut databases = Vec::new();
    for name in &manifest.databases {
        // Names come from a file anyone could have edited: only the plain
        // ones Zefaro itself would have written are believed.
        if dbio::validate_name(name).is_err() {
            continue;
        }
        if let Ok(entry) = zip.by_name(&format!("{DB_DIR}{name}.sql")) {
            databases.push(DbEntry { name: name.clone(), bytes: entry.size() });
        }
    }
    Ok(Contents { zefaro: manifest.zefaro, created: manifest.created, sites: manifest.sites, databases })
}

/// The sites and settings in a backup.
pub fn read_settings(path: &Path) -> AppResult<ZefaroConfig> {
    let (mut zip, _) = open(path)?;
    let bytes = read_small(&mut zip, SETTINGS)?;
    serde_json::from_slice(&bytes).map_err(|e| {
        msg(
            format!("The settings in this backup can't be read: {e}"),
            format!("Pengaturan di cadangan ini tidak bisa dibaca: {e}"),
        )
    })
}

/// How a database restore went.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Restored {
    /// Databases that were loaded.
    pub loaded: Vec<String>,
    /// Databases that already exist here and were left as they are.
    pub skipped: Vec<String>,
}

/// Load the backup's databases into `client`'s MariaDB. A database that
/// already exists is skipped; one that fails to load is dropped again, so a
/// second try starts clean. Dumps go through `scratch` one at a time.
pub fn restore_databases(
    path: &Path,
    client: &Client,
    scratch: &Path,
    cancel: &AtomicBool,
    mut on: impl FnMut(Step),
) -> AppResult<Restored> {
    let (mut zip, manifest) = open(path)?;
    fs::create_dir_all(scratch)?;
    let names: Vec<&String> = manifest.databases.iter().filter(|n| dbio::validate_name(n).is_ok()).collect();
    let total = names.len();
    let mut out = Restored::default();
    for (i, name) in names.into_iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(cancelled());
        }
        on(Step { phase: "database", name: Some(name), done: i, total });
        if dbio::exists(client, name)? {
            out.skipped.push(name.clone());
            continue;
        }
        let dump = scratch.join(format!("{name}.sql"));
        let extracted = (|| -> AppResult<()> {
            let mut entry = zip.by_name(&format!("{DB_DIR}{name}.sql")).map_err(|_| not_a_backup())?;
            io::copy(&mut entry, &mut File::create(&dump)?)?;
            Ok(())
        })();
        let loaded = extracted.and_then(|_| {
            dbio::create_db(client, name)?;
            let r = dbio::import(client, name, &dump, None, cancel, |_| {});
            if r.is_err() {
                let _ = dbio::drop_db(client, name);
            }
            r
        });
        let _ = fs::remove_file(&dump);
        loaded?;
        out.loaded.push(name.clone());
    }
    on(Step { phase: "finishing", name: None, done: total, total });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Site;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("zefaro-backup-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn site(name: &str) -> Site {
        Site {
            name: name.into(),
            path: format!("C:\\Projects\\{name}"),
            url: format!("http://{name}.test"),
            secured: false,
            php_version: "8.4".into(),
            kind: "linked".into(),
            framework: Some("laravel".into()),
            proxy: None,
        }
    }

    fn config() -> ZefaroConfig {
        let mut cfg = ZefaroConfig::default();
        cfg.sites = vec![site("shop"), site("blog")];
        cfg.tld = "internal".into();
        cfg.autostart = vec!["mariadb".into(), "nginx".into()];
        cfg
    }

    #[test]
    fn a_backup_without_databases_keeps_the_sites_and_settings() {
        let dir = temp("plain");
        let file = dir.join("backup.zip");
        let cfg = config();
        let mut phases = Vec::new();
        let manifest = create(&cfg, None, &file, &dir.join("scratch"), &AtomicBool::new(false), |s| phases.push(s.phase)).unwrap();
        assert_eq!(phases, ["settings", "finishing"]);
        assert_eq!((manifest.format, manifest.sites, manifest.databases.len()), (FORMAT, 2, 0));
        assert!(file.is_file() && !dir.join("backup.zip.part").exists());

        let info = inspect(&file).unwrap();
        assert_eq!((info.sites, info.zefaro.as_str(), info.databases.len()), (2, env!("CARGO_PKG_VERSION"), 0));
        let back = read_settings(&file).unwrap();
        assert_eq!(back.tld, "internal");
        assert_eq!(back.sites.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["shop", "blog"]);
        assert_eq!(back.autostart, ["mariadb", "nginx"]);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_cancelled_or_failed_backup_leaves_no_file() {
        let dir = temp("cancel");
        let file = dir.join("backup.zip");
        // A client that can't run: listing the databases fails, after the settings were written.
        let nowhere = Client { bin: dir.join("no-such-bin"), port: 1 };
        let err = create(&config(), Some(&nowhere), &file, &dir.join("scratch"), &AtomicBool::new(false), |_| {});
        assert!(err.is_err());
        assert!(!file.exists() && !dir.join("backup.zip.part").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn files_that_are_not_backups_are_refused() {
        let dir = temp("refuse");
        let text = dir.join("notes.zip");
        fs::write(&text, "this is not a zip").unwrap();
        assert!(inspect(&text).unwrap_err().to_string().contains("isn't a Zefaro backup"));

        // A zip with no manifest.
        let other = dir.join("other.zip");
        let mut w = ZipWriter::new(File::create(&other).unwrap());
        w.start_file("readme.txt", SimpleFileOptions::default()).unwrap();
        w.write_all(b"hello").unwrap();
        w.finish().unwrap();
        assert!(inspect(&other).unwrap_err().to_string().contains("isn't a Zefaro backup"));

        // A backup from a newer Zefaro says so rather than guessing.
        let newer = dir.join("newer.zip");
        let mut w = ZipWriter::new(File::create(&newer).unwrap());
        w.start_file(MANIFEST, SimpleFileOptions::default()).unwrap();
        w.write_all(br#"{"format":99,"zefaro":"9.0.0","created":0,"sites":0,"databases":[]}"#).unwrap();
        w.finish().unwrap();
        let err = inspect(&newer).unwrap_err().to_string();
        assert!(err.contains("newer Zefaro") && err.contains("9.0.0"), "{err}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn odd_database_names_in_a_manifest_are_not_believed() {
        let dir = temp("names");
        let file = dir.join("tricky.zip");
        let mut w = ZipWriter::new(File::create(&file).unwrap());
        let plain = SimpleFileOptions::default();
        w.start_file(MANIFEST, plain).unwrap();
        w.write_all(br#"{"format":1,"zefaro":"1.2.0","created":0,"sites":0,"databases":["good","..\\..\\evil","mysql","a/b"]}"#).unwrap();
        w.start_file("databases/good.sql", plain).unwrap();
        w.write_all(b"CREATE TABLE t (id INT);").unwrap();
        w.start_file("databases/mysql.sql", plain).unwrap();
        w.write_all(b"DROP DATABASE mysql;").unwrap();
        w.finish().unwrap();
        let info = inspect(&file).unwrap();
        assert_eq!(info.databases, [DbEntry { name: "good".into(), bytes: 24 }]);
        let _ = fs::remove_dir_all(dir);
    }

    /// A real MariaDB (Zefaro's installed binaries, temp data folder, spare
    /// port): back up two databases, drop one, restore, and compare checksums.
    /// A database that exists is skipped, and a broken dump is dropped again.
    #[test]
    #[ignore = "needs MariaDB installed by Zefaro (run with --ignored)"]
    fn live_backup_and_restore_round_trip() {
        use crate::engine::mariadb;
        use crate::engine::supervisor::Supervisor;
        let base = mariadb::Layout::standard().base;
        assert!(base.join("bin").join("mariadbd.exe").is_file(), "install MariaDB in Zefaro first");
        let tmp = temp("live");
        let l = mariadb::Layout {
            base: base.clone(),
            data: tmp.join("data"),
            conf: tmp.join("my.ini"),
            log: tmp.join("mariadb.log"),
            port: 3319,
        };
        mariadb::prepare(&l, &tmp, true).expect("init temp data folder");
        let sup = Supervisor::default();
        sup.start(mariadb::spec(&l)).expect("start MariaDB");
        let c = Client { bin: base.join("bin"), port: 3319 };

        dbio::create_db(&c, "shop").unwrap();
        dbio::create_db(&c, "blog-2026").unwrap();
        c.query("CREATE TABLE shop.orders (id INT PRIMARY KEY, note TEXT, raw BLOB) ENGINE=InnoDB").unwrap();
        c.query("INSERT INTO shop.orders VALUES (1, 'kopi susu \u{2615}', UNHEX('00FF0A0D5C27')), (2, 'teh', NULL)").unwrap();
        c.query("CREATE TABLE `blog-2026`.posts (id INT PRIMARY KEY, title VARCHAR(80))").unwrap();
        c.query("INSERT INTO `blog-2026`.posts VALUES (1, 'halo')").unwrap();
        let sums = |c: &Client| c.query("CHECKSUM TABLE shop.orders, `blog-2026`.posts").unwrap();
        let expected = sums(&c);

        let file = tmp.join("backup.zip");
        let never = AtomicBool::new(false);
        let mut seen = Vec::new();
        let m = create(&config(), Some(&c), &file, &tmp.join("scratch"), &never, |s| {
            if let Some(n) = s.name {
                seen.push(n.to_owned());
            }
        })
        .expect("backup");
        // (mariadb-install-db also creates an empty "test" database on Windows.)
        assert!(m.databases.contains(&"shop".into()) && m.databases.contains(&"blog-2026".into()), "{m:?}");
        assert_eq!(seen, m.databases);
        let info = inspect(&file).unwrap();
        assert!(info.databases.iter().any(|d| d.name == "shop" && d.bytes > 0));
        assert!(fs::read_dir(tmp.join("scratch")).unwrap().next().is_none(), "scratch dumps are cleaned up");

        // Everything exists: nothing is loaded, nothing is changed.
        let r = restore_databases(&file, &c, &tmp.join("scratch"), &never, |_| {}).unwrap();
        assert!(r.loaded.is_empty() && r.skipped.contains(&"shop".into()));
        assert_eq!(sums(&c), expected);

        // Drop two and restore: they come back identical.
        dbio::drop_db(&c, "shop").unwrap();
        dbio::drop_db(&c, "blog-2026").unwrap();
        let r = restore_databases(&file, &c, &tmp.join("scratch"), &never, |_| {}).unwrap();
        assert!(r.loaded.contains(&"shop".into()) && r.loaded.contains(&"blog-2026".into()), "{r:?}");
        assert_eq!(sums(&c), expected, "restored data matches");

        // A dump that fails to load is dropped again, so a retry starts clean.
        let bad = tmp.join("bad.zip");
        let mut w = ZipWriter::new(File::create(&bad).unwrap());
        let plain = SimpleFileOptions::default();
        w.start_file(MANIFEST, plain).unwrap();
        w.write_all(br#"{"format":1,"zefaro":"1.2.0","created":0,"sites":0,"databases":["broken"]}"#).unwrap();
        w.start_file("databases/broken.sql", plain).unwrap();
        w.write_all(b"CREATE TABLE ok (id INT);\nTHIS IS NOT SQL;\n").unwrap();
        w.finish().unwrap();
        assert!(restore_databases(&bad, &c, &tmp.join("scratch"), &never, |_| {}).is_err());
        assert!(!dbio::exists(&c, "broken").unwrap());

        // Cancelling stops before the next database.
        let stop = AtomicBool::new(true);
        assert_eq!(restore_databases(&file, &c, &tmp.join("scratch"), &stop, |_| {}).unwrap_err().to_string(), "Cancelled.");

        sup.stop(mariadb::SERVICE_ID).unwrap();
        let _ = fs::remove_dir_all(&tmp);
    }
}
