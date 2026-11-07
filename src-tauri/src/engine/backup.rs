//! Backing up and restoring Zefaro: the sites and settings, and the databases
//! of MariaDB, MySQL and PostgreSQL, in one zip file.
//!
//! ```text
//! manifest.json                       what is inside, and which Zefaro made it
//! config.json                         the sites and settings (the same file Zefaro keeps)
//! databases/<name>.sql                one plain SQL dump per MariaDB database
//! databases/mysql/<name>.sql          ... per MySQL database
//! databases/postgresql/<name>.sql     ... per PostgreSQL database
//! ```
//!
//! Left out on purpose: the HTTPS certificate authority (its private key is
//! encrypted for this Windows account and can't be opened anywhere else, so a
//! copy would be useless and only a risk), the downloaded programs (Zefaro
//! installs them again), mail, and the project folders themselves.
//!
//! A restore never overwrites a database that already exists: the dump loads
//! into a new database, and one that exists is skipped. The servers are used
//! one after another, and each is stopped again when the backup started it.

use crate::config::ZefaroConfig;
use crate::engine::dbio::{self, Client, Engine};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Bumped when a backup is laid out differently, so an older Zefaro says so
/// instead of misreading a newer file. 2 added MySQL and PostgreSQL; a backup
/// with MariaDB databases only is still written as 1, which every Zefaro reads.
pub const FORMAT: u32 = 2;

const MANIFEST: &str = "manifest.json";
const SETTINGS: &str = "config.json";
const DB_DIR: &str = "databases/";
/// Nothing in a backup's two small files is bigger than this.
const SMALL_FILE_LIMIT: u64 = 16 * 1024 * 1024;

/// The servers a backup holds databases of, in the order they're saved and restored.
pub const ENGINES: [Engine; 3] = [Engine::MariaDb, Engine::MySql, Engine::PostgreSql];

/// Where a database's dump sits in the zip.
fn entry_name(engine: Engine, name: &str) -> String {
    match engine {
        Engine::MariaDb => format!("{DB_DIR}{name}.sql"),
        Engine::MySql => format!("{DB_DIR}mysql/{name}.sql"),
        Engine::PostgreSql => format!("{DB_DIR}postgresql/{name}.sql"),
    }
}

/// How a database is named in messages: "shop (MySQL)".
pub fn label(engine: Engine, name: &str) -> String {
    format!("{name} ({})", engine.name())
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: u32,
    /// The Zefaro version that made the backup.
    pub zefaro: String,
    /// Unix seconds.
    pub created: i64,
    pub sites: usize,
    /// MariaDB databases dumped into the file (the name predates MySQL and PostgreSQL).
    pub databases: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mysql: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub postgresql: Vec<String>,
}

impl Manifest {
    pub fn names(&self, engine: Engine) -> &[String] {
        match engine {
            Engine::MariaDb => &self.databases,
            Engine::MySql => &self.mysql,
            Engine::PostgreSql => &self.postgresql,
        }
    }

    fn names_mut(&mut self, engine: Engine) -> &mut Vec<String> {
        match engine {
            Engine::MariaDb => &mut self.databases,
            Engine::MySql => &mut self.mysql,
            Engine::PostgreSql => &mut self.postgresql,
        }
    }

    /// Every database, labelled with its server.
    pub fn labels(&self) -> Vec<String> {
        ENGINES.iter().flat_map(|&e| self.names(e).iter().map(move |n| label(e, n))).collect()
    }
}

/// One database found in a backup.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DbEntry {
    pub engine: Engine,
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
    /// The server whose databases are being saved or loaded.
    pub server: Option<Engine>,
    /// The database being dumped or loaded.
    pub name: Option<&'a str>,
    /// That server's databases finished so far, and in all.
    pub done: usize,
    pub total: usize,
}

/// How a backup or restore reaches the database servers.
pub trait Servers {
    /// The server's client, with the server started if it wasn't running.
    /// `None` when it isn't installed and this caller doesn't install it.
    fn open(&mut self, engine: Engine) -> AppResult<Option<Client>>;
    /// Done with the server: stop it again if `open` started it.
    fn close(&mut self, engine: Engine);
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

/// Make the backup at `dest`: the settings of `cfg`, and, when `servers` is
/// given, every user database of each server it opens. Dumps are written one
/// at a time to `scratch` and added to the zip, so the extra disk space is
/// one database. `dest` only appears once the file is complete.
pub fn create(
    cfg: &ZefaroConfig,
    servers: Option<&mut dyn Servers>,
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
    let result = write_zip(cfg, servers, &part, scratch, cancel, &mut on);
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
    servers: Option<&mut dyn Servers>,
    part: &Path,
    scratch: &Path,
    cancel: &AtomicBool,
    on: &mut impl FnMut(Step),
) -> AppResult<Manifest> {
    let mut zip = ZipWriter::new(File::create(part)?);
    let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    on(Step { phase: "settings", server: None, name: None, done: 0, total: 0 });
    zip.start_file(SETTINGS, deflate)?;
    zip.write_all(&serde_json::to_vec_pretty(cfg)?)?;

    let mut manifest = Manifest {
        format: 1,
        zefaro: env!("CARGO_PKG_VERSION").to_owned(),
        created: 0,
        sites: cfg.sites.len(),
        databases: Vec::new(),
        mysql: Vec::new(),
        postgresql: Vec::new(),
    };
    if let Some(servers) = servers {
        for engine in ENGINES {
            if cancel.load(Ordering::Relaxed) {
                return Err(cancelled());
            }
            let Some(client) = servers.open(engine)? else { continue };
            let dumped = dump_server(&mut zip, deflate, &client, scratch, cancel, on);
            servers.close(engine);
            *manifest.names_mut(engine) = dumped?;
        }
    }

    on(Step { phase: "finishing", server: None, name: None, done: 0, total: 0 });
    if !manifest.mysql.is_empty() || !manifest.postgresql.is_empty() {
        manifest.format = FORMAT;
    }
    manifest.created = now();
    zip.start_file(MANIFEST, deflate)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
    zip.finish()?;
    Ok(manifest)
}

/// Every user database of one server, into the zip.
fn dump_server(
    zip: &mut ZipWriter<File>,
    deflate: SimpleFileOptions,
    client: &Client,
    scratch: &Path,
    cancel: &AtomicBool,
    on: &mut impl FnMut(Step),
) -> AppResult<Vec<String>> {
    let engine = client.engine;
    // Only names Zefaro can quote safely (PostgreSQL allows almost anything).
    let names: Vec<String> =
        dbio::list(client)?.into_iter().map(|d| d.name).filter(|n| dbio::validate_for(engine, n).is_ok()).collect();
    let total = names.len();
    for (i, name) in names.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(cancelled());
        }
        on(Step { phase: "database", server: Some(engine), name: Some(name), done: i, total });
        let dump = scratch.join(format!("{name}.sql"));
        let dumped = dbio::export(client, name, &dump, false, cancel, |_| {});
        let added = dumped.and_then(|_| {
            // `large_file`: one database can pass 4 GB.
            zip.start_file(entry_name(engine, name), deflate.large_file(true))?;
            io::copy(&mut File::open(&dump)?, zip)?;
            Ok(())
        });
        let _ = fs::remove_file(&dump);
        added?;
    }
    Ok(names)
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

/// The manifest's names for `engine` that Zefaro would have written itself.
/// They come from a file anyone could have edited, so the rest are ignored.
fn believed(manifest: &Manifest, engine: Engine) -> Vec<&String> {
    manifest.names(engine).iter().filter(|n| dbio::validate_for(engine, n).is_ok()).collect()
}

/// Read what a backup holds, without changing anything.
pub fn inspect(path: &Path) -> AppResult<Contents> {
    let (mut zip, manifest) = open(path)?;
    let mut databases = Vec::new();
    for engine in ENGINES {
        for name in believed(&manifest, engine) {
            if let Ok(entry) = zip.by_name(&entry_name(engine, name)) {
                databases.push(DbEntry { engine, name: name.clone(), bytes: entry.size() });
            }
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

/// How a database restore went, as labels ("shop (MySQL)").
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Restored {
    /// Databases that were loaded.
    pub loaded: Vec<String>,
    /// Databases that already exist here and were left as they are.
    pub skipped: Vec<String>,
}

/// Load the backup's databases, each into its own server. A server is only
/// opened when the backup has databases for it. A database that already
/// exists is skipped; one that fails to load is dropped again, so a second
/// try starts clean. Dumps go through `scratch` one at a time.
pub fn restore_databases(
    path: &Path,
    servers: &mut dyn Servers,
    scratch: &Path,
    cancel: &AtomicBool,
    mut on: impl FnMut(Step),
) -> AppResult<Restored> {
    let (mut zip, manifest) = open(path)?;
    fs::create_dir_all(scratch)?;
    let mut out = Restored::default();
    for engine in ENGINES {
        let names = believed(&manifest, engine);
        if names.is_empty() {
            continue;
        }
        if cancel.load(Ordering::Relaxed) {
            return Err(cancelled());
        }
        let client = servers.open(engine)?.ok_or_else(|| {
            let server = engine.name();
            msg(
                format!("{server} isn't installed, so its databases can't be restored."),
                format!("{server} belum terpasang, jadi database-nya tidak bisa dipulihkan."),
            )
        })?;
        let r = restore_server(&mut zip, &client, &names, scratch, cancel, &mut on, &mut out);
        servers.close(engine);
        r?;
    }
    on(Step { phase: "finishing", server: None, name: None, done: 0, total: 0 });
    Ok(out)
}

fn restore_server(
    zip: &mut ZipArchive<File>,
    client: &Client,
    names: &[&String],
    scratch: &Path,
    cancel: &AtomicBool,
    on: &mut impl FnMut(Step),
    out: &mut Restored,
) -> AppResult<()> {
    let engine = client.engine;
    let total = names.len();
    for (i, &name) in names.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(cancelled());
        }
        on(Step { phase: "database", server: Some(engine), name: Some(name), done: i, total });
        if dbio::exists(client, name)? {
            out.skipped.push(label(engine, name));
            continue;
        }
        let dump = scratch.join(format!("{name}.sql"));
        let extracted = (|| -> AppResult<()> {
            let mut entry = zip.by_name(&entry_name(engine, name)).map_err(|_| not_a_backup())?;
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
        out.loaded.push(label(engine, name));
    }
    Ok(())
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
            php_limits: None,
        }
    }

    fn config() -> ZefaroConfig {
        let mut cfg = ZefaroConfig::default();
        cfg.sites = vec![site("shop"), site("blog")];
        cfg.tld = "internal".into();
        cfg.autostart = vec!["mariadb".into(), "nginx".into()];
        cfg
    }

    /// Servers that are already running, and a record of which were opened.
    struct Running {
        clients: Vec<Client>,
        opened: Vec<Engine>,
        closed: Vec<Engine>,
    }

    impl Running {
        fn new(clients: Vec<Client>) -> Self {
            Self { clients, opened: Vec::new(), closed: Vec::new() }
        }
    }

    impl Servers for Running {
        fn open(&mut self, engine: Engine) -> AppResult<Option<Client>> {
            self.opened.push(engine);
            Ok(self.clients.iter().find(|c| c.engine == engine).cloned())
        }
        fn close(&mut self, engine: Engine) {
            self.closed.push(engine);
        }
    }

    /// A backup zip written by hand: the manifest's JSON, then (path, text) entries.
    fn handmade(file: &Path, manifest: &str, entries: &[(&str, &str)]) {
        let mut w = ZipWriter::new(File::create(file).unwrap());
        let plain = SimpleFileOptions::default();
        w.start_file(MANIFEST, plain).unwrap();
        w.write_all(manifest.as_bytes()).unwrap();
        for (path, text) in entries {
            w.start_file(*path, plain).unwrap();
            w.write_all(text.as_bytes()).unwrap();
        }
        w.finish().unwrap();
    }

    #[test]
    fn a_backup_without_databases_keeps_the_sites_and_settings() {
        let dir = temp("plain");
        let file = dir.join("backup.zip");
        let cfg = config();
        let mut phases = Vec::new();
        let manifest = create(&cfg, None, &file, &dir.join("scratch"), &AtomicBool::new(false), |s| phases.push(s.phase)).unwrap();
        assert_eq!(phases, ["settings", "finishing"]);
        // Without MySQL or PostgreSQL databases the file stays readable by every Zefaro.
        assert_eq!((manifest.format, manifest.sites, manifest.labels().len()), (1, 2, 0));
        let raw = String::from_utf8(read_small(&mut ZipArchive::new(File::open(&file).unwrap()).unwrap(), MANIFEST).unwrap()).unwrap();
        assert!(!raw.contains("mysql") && !raw.contains("postgresql"), "{raw}");
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
        let nowhere = Client { engine: Engine::MySql, bin: dir.join("no-such-bin"), port: 1 };
        let mut servers = Running::new(vec![nowhere]);
        let err = create(&config(), Some(&mut servers), &file, &dir.join("scratch"), &AtomicBool::new(false), |_| {});
        assert!(err.is_err());
        assert!(!file.exists() && !dir.join("backup.zip.part").exists());
        // Each server is opened in turn, and closed again even when it failed.
        assert_eq!(servers.opened, [Engine::MariaDb, Engine::MySql]);
        assert_eq!(servers.closed, [Engine::MySql]);
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
        assert_eq!(info.databases, [DbEntry { engine: Engine::MariaDb, name: "good".into(), bytes: 24 }]);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn mysql_and_postgresql_databases_have_their_own_folders() {
        let dir = temp("engines");
        let file = dir.join("all.zip");
        handmade(
            &file,
            r#"{"format":2,"zefaro":"1.6.0","created":0,"sites":0,"databases":["shop"],"mysql":["shop","crm"],"postgresql":["shop","postgres"]}"#,
            &[
                ("databases/shop.sql", "-- MariaDB"),
                ("databases/mysql/shop.sql", "-- MySQL shop"),
                ("databases/mysql/crm.sql", "-- MySQL crm"),
                ("databases/postgresql/shop.sql", "-- PostgreSQL shop"),
                ("databases/postgresql/postgres.sql", "-- the maintenance database"),
            ],
        );
        let info = inspect(&file).unwrap();
        let found: Vec<(Engine, &str, u64)> = info.databases.iter().map(|d| (d.engine, d.name.as_str(), d.bytes)).collect();
        assert_eq!(
            found,
            [
                (Engine::MariaDb, "shop", 10),
                (Engine::MySql, "shop", 13),
                (Engine::MySql, "crm", 12),
                (Engine::PostgreSql, "shop", 18),
            ],
            "PostgreSQL's own database is never believed"
        );
        assert_eq!(entry_name(Engine::PostgreSql, "shop"), "databases/postgresql/shop.sql");
        assert_eq!(label(Engine::MySql, "crm"), "crm (MySQL)");

        // A backup from before MySQL and PostgreSQL still reads.
        let old = dir.join("old.zip");
        handmade(&old, r#"{"format":1,"zefaro":"1.5.0","created":0,"sites":3,"databases":["blog"]}"#, &[("databases/blog.sql", "x")]);
        let info = inspect(&old).unwrap();
        assert_eq!((info.sites, info.databases.len(), info.databases[0].engine), (3, 1, Engine::MariaDb));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_restore_opens_only_the_servers_it_needs() {
        let dir = temp("open");
        let file = dir.join("mysql-only.zip");
        handmade(
            &file,
            r#"{"format":2,"zefaro":"1.6.0","created":0,"sites":0,"databases":[],"mysql":["crm"]}"#,
            &[("databases/mysql/crm.sql", "CREATE TABLE t (id INT);")],
        );
        // MySQL isn't there to open: the restore says so, and touched nothing else.
        let mut servers = Running::new(Vec::new());
        let err = restore_databases(&file, &mut servers, &dir.join("scratch"), &AtomicBool::new(false), |_| {})
            .unwrap_err()
            .to_string();
        assert!(err.contains("MySQL isn't installed"), "{err}");
        assert_eq!(servers.opened, [Engine::MySql]);

        // Cancelled before it starts: no server is opened at all.
        let mut servers = Running::new(Vec::new());
        let stop = AtomicBool::new(true);
        assert!(restore_databases(&file, &mut servers, &dir.join("scratch"), &stop, |_| {}).is_err());
        assert!(servers.opened.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    /// Real servers in temp folders, started when a backup or restore opens
    /// them and stopped when it closes them, the way Zefaro does it.
    struct TempServers {
        sup: crate::engine::supervisor::Supervisor,
        specs: Vec<(Client, crate::engine::supervisor::Spec)>,
    }

    impl Servers for TempServers {
        fn open(&mut self, engine: Engine) -> AppResult<Option<Client>> {
            let Some((client, spec)) = self.specs.iter().find(|(c, _)| c.engine == engine) else { return Ok(None) };
            self.sup.start(spec.clone())?;
            dbio::wait_ready(client, std::time::Duration::from_secs(30))?;
            Ok(Some(client.clone()))
        }
        fn close(&mut self, engine: Engine) {
            let _ = self.sup.stop(engine.service_id());
        }
    }

    /// MariaDB (Zefaro's installed binaries), MySQL and PostgreSQL (installed
    /// from their pinned zips, kept in `ZEFARO_MYSQL_ZIP_DIR` and
    /// `ZEFARO_PG_ZIP_DIR` or downloaded there), each with a temp data folder
    /// on a spare port. Back up all three, drop the databases, restore, and
    /// compare checksums. The same name on two servers stays two databases; a
    /// database that exists is skipped, and a broken dump is dropped again.
    #[test]
    #[ignore = "needs MariaDB installed by Zefaro; installs MySQL and PostgreSQL into temp folders (run with --ignored)"]
    fn live_backup_and_restore_round_trip() {
        use crate::engine::{mariadb, mysql, postgres};
        use std::path::PathBuf;
        let maria_base = mariadb::Layout::standard().base;
        assert!(maria_base.join("bin").join("mariadbd.exe").is_file(), "install MariaDB in Zefaro first");
        let tmp = temp("live");
        let zips = |var: &str| std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| tmp.join("dl"));

        let ml = mariadb::Layout {
            base: maria_base.clone(),
            data: tmp.join("mariadb-data"),
            conf: tmp.join("mariadb.ini"),
            log: tmp.join("mariadb.log"),
            port: 3319,
        };
        mariadb::prepare(&ml, &tmp, true).expect("init MariaDB's temp data folder");
        let yl = mysql::Layout {
            base: tmp.join("mysql"),
            data: tmp.join("mysql-data"),
            conf: tmp.join("mysql-conf").join("my.ini"),
            log: tmp.join("mysql.log"),
            port: 53318,
        };
        mysql::prepare(&yl, &zips("ZEFARO_MYSQL_ZIP_DIR"), true).expect("install MySQL");
        let pl = postgres::Layout { base: tmp.join("pg"), data: tmp.join("pg-data"), log: tmp.join("pg.log"), port: 55443 };
        postgres::prepare(&pl, &zips("ZEFARO_PG_ZIP_DIR"), true).expect("install PostgreSQL");

        let maria = Client { engine: Engine::MariaDb, bin: maria_base.join("bin"), port: 3319 };
        let my = Client { engine: Engine::MySql, bin: yl.base.join("bin"), port: 53318 };
        let pg = Client { engine: Engine::PostgreSql, bin: pl.base.join("bin"), port: 55443 };
        let mut servers = TempServers {
            sup: Default::default(),
            specs: vec![
                (maria.clone(), mariadb::spec(&ml)),
                (my.clone(), mysql::spec(&yl)),
                (pg.clone(), postgres::spec(&pl)),
            ],
        };
        // psql connects to the maintenance database; `\\` runs SQL after `\connect`.
        let pg_in = |db: &str, sql: &str| pg.query(&format!("\\connect \"{db}\" \\\\ {sql}")).unwrap();

        // The same data on every server; "shop" exists on all three.
        let maria_sums = |c: &Client| c.query("CHECKSUM TABLE shop.orders, `blog-2026`.posts").unwrap();
        let my_sums = |c: &Client| c.query("CHECKSUM TABLE shop.orders, crm.leads").unwrap();
        let pg_sums = || {
            pg_in("shop", "SELECT md5(string_agg(id || note || coalesce(encode(raw, 'hex'), '-'), ',' ORDER BY id)) FROM orders")
                + &pg_in("shop", "SELECT last_value FROM orders_id_seq")
        };
        servers.open(Engine::MariaDb).unwrap();
        dbio::create_db(&maria, "shop").unwrap();
        dbio::create_db(&maria, "blog-2026").unwrap();
        maria.query("CREATE TABLE shop.orders (id INT PRIMARY KEY, note TEXT, raw BLOB) ENGINE=InnoDB").unwrap();
        maria.query("INSERT INTO shop.orders VALUES (1, 'kopi susu \u{2615}', UNHEX('00FF0A0D5C27')), (2, 'teh', NULL)").unwrap();
        maria.query("CREATE TABLE `blog-2026`.posts (id INT PRIMARY KEY, title VARCHAR(80))").unwrap();
        maria.query("INSERT INTO `blog-2026`.posts VALUES (1, 'halo')").unwrap();
        let maria_expected = maria_sums(&maria);
        servers.close(Engine::MariaDb);

        servers.open(Engine::MySql).unwrap();
        dbio::create_db(&my, "shop").unwrap();
        dbio::create_db(&my, "crm").unwrap();
        my.query("CREATE TABLE shop.orders (id INT PRIMARY KEY, note TEXT, raw BLOB) ENGINE=InnoDB").unwrap();
        my.query("INSERT INTO shop.orders VALUES (1, 'es teh \u{1F375}', UNHEX('00FF0A0D5C27225C6E')), (2, 'kopi', NULL)").unwrap();
        my.query("CREATE TABLE crm.leads (id INT PRIMARY KEY, email VARCHAR(120))").unwrap();
        my.query("INSERT INTO crm.leads VALUES (1, 'a@example.com'), (2, 'b@example.com')").unwrap();
        let my_expected = my_sums(&my);
        servers.close(Engine::MySql);

        servers.open(Engine::PostgreSql).unwrap();
        dbio::create_db(&pg, "shop").unwrap();
        pg_in(
            "shop",
            "CREATE TABLE orders (id bigserial PRIMARY KEY, note text, raw bytea); \
             INSERT INTO orders (note, raw) VALUES ('wedang jahe', decode('00ff0a0d5c27', 'hex')), (E'tab\\there', NULL)",
        );
        let pg_expected = pg_sums();
        servers.close(Engine::PostgreSql);

        let file = tmp.join("backup.zip");
        let never = AtomicBool::new(false);
        let mut seen = Vec::new();
        let m = create(&config(), Some(&mut servers), &file, &tmp.join("scratch"), &never, |s| {
            if let (Some(server), Some(n)) = (s.server, s.name) {
                seen.push(label(server, n));
            }
        })
        .expect("backup");
        // (mariadb-install-db also creates an empty "test" database on Windows.)
        assert!(m.databases.contains(&"shop".into()) && m.databases.contains(&"blog-2026".into()), "{m:?}");
        assert_eq!((m.mysql.as_slice(), m.postgresql.as_slice(), m.format), (&["crm".to_owned(), "shop".to_owned()][..], &["shop".to_owned()][..], 2));
        assert_eq!(seen, m.labels());
        assert!(ENGINES.iter().all(|e| !servers.sup.is_running(e.service_id())), "each server is stopped after use");
        let info = inspect(&file).unwrap();
        assert!(info.databases.iter().any(|d| d.engine == Engine::PostgreSql && d.name == "shop" && d.bytes > 0));
        assert!(fs::read_dir(tmp.join("scratch")).unwrap().next().is_none(), "scratch dumps are cleaned up");

        // Everything exists: nothing is loaded, nothing is changed.
        let r = restore_databases(&file, &mut servers, &tmp.join("scratch"), &never, |_| {}).unwrap();
        assert!(r.loaded.is_empty(), "{r:?}");
        for l in ["shop (MariaDB)", "crm (MySQL)", "shop (MySQL)", "shop (PostgreSQL)"] {
            assert!(r.skipped.contains(&l.to_owned()), "{l} in {r:?}");
        }

        // Drop them all and restore: they come back identical.
        servers.open(Engine::MariaDb).unwrap();
        dbio::drop_db(&maria, "shop").unwrap();
        dbio::drop_db(&maria, "blog-2026").unwrap();
        servers.close(Engine::MariaDb);
        servers.open(Engine::MySql).unwrap();
        dbio::drop_db(&my, "shop").unwrap();
        dbio::drop_db(&my, "crm").unwrap();
        servers.close(Engine::MySql);
        servers.open(Engine::PostgreSql).unwrap();
        dbio::drop_db(&pg, "shop").unwrap();
        servers.close(Engine::PostgreSql);

        let r = restore_databases(&file, &mut servers, &tmp.join("scratch"), &never, |_| {}).unwrap();
        for l in ["shop (MariaDB)", "blog-2026 (MariaDB)", "crm (MySQL)", "shop (MySQL)", "shop (PostgreSQL)"] {
            assert!(r.loaded.contains(&l.to_owned()), "{l} in {r:?}");
        }
        servers.open(Engine::MariaDb).unwrap();
        assert_eq!(maria_sums(&maria), maria_expected, "MariaDB data matches");
        servers.close(Engine::MariaDb);
        servers.open(Engine::MySql).unwrap();
        assert_eq!(my_sums(&my), my_expected, "MySQL data matches");
        servers.close(Engine::MySql);
        servers.open(Engine::PostgreSql).unwrap();
        assert_eq!(pg_sums(), pg_expected, "PostgreSQL data and sequence match");
        servers.close(Engine::PostgreSql);

        // A dump that fails to load is dropped again, so a retry starts clean.
        let bad = tmp.join("bad.zip");
        handmade(
            &bad,
            r#"{"format":2,"zefaro":"1.6.0","created":0,"sites":0,"databases":[],"postgresql":["broken"]}"#,
            &[("databases/postgresql/broken.sql", "CREATE TABLE ok (id int);\nTHIS IS NOT SQL;\n")],
        );
        assert!(restore_databases(&bad, &mut servers, &tmp.join("scratch"), &never, |_| {}).is_err());
        servers.open(Engine::PostgreSql).unwrap();
        assert!(!dbio::exists(&pg, "broken").unwrap());
        servers.close(Engine::PostgreSql);

        // Cancelling stops before the next database.
        let stop = AtomicBool::new(true);
        let err = restore_databases(&file, &mut servers, &tmp.join("scratch"), &stop, |_| {}).unwrap_err();
        assert_eq!(err.to_string(), "Cancelled.");

        servers.sup.stop_all(|_| 0);
        let _ = fs::remove_dir_all(&tmp);
    }
}
