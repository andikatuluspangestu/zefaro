//! Snapshots of a site's database: one click before `migrate:fresh` or a risky
//! change, and back in seconds. A snapshot is a compressed dump (MariaDB, MySQL,
//! PostgreSQL, through the same streaming export and import as the Databases
//! page) or a copy of the SQLite file, kept with a small JSON note in
//! `~/.config/zefaro/snapshots/<site>/`.

use crate::engine::apps::{self, Database};
use crate::engine::dbio::{self, Client, Engine};
use crate::engine::{laravel, mariadb, mysql, postgres, supervisor};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// One snapshot at a time, so two can't write the same database.
static BUSY: Mutex<()> = Mutex::new(());

/// What a site's database is, as far as a snapshot goes.
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    /// A database on one of Zefaro's servers.
    Server(Engine, String),
    Sqlite(PathBuf),
}

impl Target {
    /// "toko_online on MariaDB", "database/database.sqlite".
    pub fn describe(&self, project: &Path) -> String {
        match self {
            Target::Server(e, db) => crate::tr!(format!("{db} on {}", e.name()), format!("{db} di {}", e.name())),
            Target::Sqlite(f) => f.strip_prefix(project).unwrap_or(f).display().to_string().replace('\\', "/"),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub label: String,
    pub created_ms: u64,
    /// The server; None for SQLite.
    pub engine: Option<Engine>,
    /// The database name, or the SQLite file.
    pub database: String,
    pub bytes: u64,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn dir(site: &str) -> PathBuf {
    // Tests keep theirs out of the user's own folder.
    let root = if cfg!(test) {
        std::env::temp_dir().join("zefaro-test-snapshots")
    } else {
        crate::config::config_dir().join("snapshots")
    };
    root.join(site)
}

fn data_file(site: &str, s: &Snapshot) -> PathBuf {
    dir(site).join(if s.engine.is_some() { format!("{}.sql.gz", s.id) } else { format!("{}.sqlite", s.id) })
}

fn wal(file: &Path) -> PathBuf {
    PathBuf::from(format!("{}-wal", file.display()))
}

fn not_here() -> AppError {
    AppError::msg(crate::tr!(
        "This site's database isn't on one of Zefaro's servers or in a SQLite file, so Zefaro can't snapshot it.",
        "Database situs ini tidak ada di server milik Zefaro atau di file SQLite, jadi Zefaro tidak bisa membuat snapshot-nya."
    ))
}

/// The database the site's `.env` points at.
pub fn target_of(project: &Path) -> AppResult<Target> {
    let env: Vec<(String, String)> = fs::read_to_string(project.join(".env"))
        .map(|t| laravel::parse_env(&t).into_iter().map(|e| (e.key, e.value)).collect())
        .unwrap_or_default();
    let local = |h: &str| matches!(h, "127.0.0.1" | "localhost");
    let (engine, name) = match apps::database(project, &env).ok_or_else(not_here)? {
        Database::Sqlite { file } => return Ok(Target::Sqlite(file)),
        Database::Mysql { host, port, name, .. } if local(&host) && port == mariadb::port() => (Engine::MariaDb, name),
        Database::Mysql { host, port, name, .. } if local(&host) && port == mysql::port() => (Engine::MySql, name),
        Database::Postgres { host, port, name, .. } if local(&host) && port == postgres::port() => (Engine::PostgreSql, name),
        _ => return Err(not_here()),
    };
    if name.is_empty() {
        return Err(AppError::msg(crate::tr!(
            "Set DB_DATABASE in the site's .env first.",
            "Isi DB_DATABASE di .env situs terlebih dahulu."
        )));
    }
    Ok(Target::Server(engine, name))
}

fn require_running(engine: Engine) -> AppResult<()> {
    if supervisor::port_open(engine.port()) {
        return Ok(());
    }
    let server = engine.name();
    Err(AppError::msg(crate::tr!(
        format!("Start {server} first (Services → {server})."),
        format!("Mulai {server} terlebih dahulu (Layanan → {server}).")
    )))
}

/// The site's snapshots, newest first.
pub fn list(site: &str) -> Vec<Snapshot> {
    let mut out: Vec<Snapshot> = fs::read_dir(dir(site))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_slice::<Snapshot>(&fs::read(e.path()).ok()?).ok())
        .filter(|s| data_file(site, s).is_file())
        .collect();
    out.sort_by(|a, b| b.created_ms.cmp(&a.created_ms));
    out
}

fn find(site: &str, id: &str) -> AppResult<Snapshot> {
    list(site).into_iter().find(|s| s.id == id).ok_or_else(|| {
        AppError::msg(crate::tr!("That snapshot is no longer there.", "Snapshot itu sudah tidak ada."))
    })
}

/// Take a snapshot of the database the site uses now.
pub fn take(site: &str, project: &Path, label: &str) -> AppResult<Snapshot> {
    let _one = BUSY.lock().unwrap_or_else(|p| p.into_inner());
    let label: String = label.trim().chars().take(80).collect();
    let target = target_of(project)?;
    fs::create_dir_all(dir(site))?;
    let created_ms = now_ms();
    let mut snap = Snapshot { id: created_ms.to_string(), label, created_ms, engine: None, database: String::new(), bytes: 0 };
    match &target {
        Target::Server(engine, db) => {
            require_running(*engine)?;
            snap.engine = Some(*engine);
            snap.database = db.clone();
            let c = Client::of(*engine);
            if !dbio::exists(&c, db)? {
                return Err(AppError::msg(crate::tr!(
                    format!("There's no database named {db} on {} yet.", engine.name()),
                    format!("Belum ada database bernama {db} di {}.", engine.name())
                )));
            }
            let dest = data_file(site, &snap);
            let never = AtomicBool::new(false);
            if let Err(e) = dbio::export(&c, db, &dest, true, &never, |_| {}) {
                let _ = fs::remove_file(&dest);
                return Err(e);
            }
        }
        Target::Sqlite(file) => {
            snap.database = file.display().to_string();
            fs::copy(file, data_file(site, &snap))?;
            let w = wal(file);
            if w.is_file() {
                fs::copy(&w, wal(&data_file(site, &snap)))?;
            }
        }
    }
    snap.bytes = fs::metadata(data_file(site, &snap)).map(|m| m.len()).unwrap_or(0);
    fs::write(dir(site).join(format!("{}.json", snap.id)), serde_json::to_vec_pretty(&snap)?)?;
    Ok(snap)
}

/// Put the database back as it was in the snapshot: everything in it now is
/// replaced. A server database is dropped, created again and loaded.
pub fn restore(site: &str, id: &str) -> AppResult<()> {
    let _one = BUSY.lock().unwrap_or_else(|p| p.into_inner());
    let snap = find(site, id)?;
    let src = data_file(site, &snap);
    match snap.engine {
        Some(engine) => {
            require_running(engine)?;
            let c = Client::of(engine);
            if dbio::exists(&c, &snap.database)? {
                dbio::drop_db(&c, &snap.database)?;
            }
            dbio::create_db(&c, &snap.database)?;
            let never = AtomicBool::new(false);
            dbio::import(&c, &snap.database, &src, None, &never, |_| {})
        }
        None => {
            let file = PathBuf::from(&snap.database);
            let shm = PathBuf::from(format!("{}-shm", file.display()));
            let _ = fs::remove_file(wal(&file));
            let _ = fs::remove_file(&shm);
            fs::copy(&src, &file).map_err(|e| {
                AppError::msg(crate::tr!(
                    format!("Couldn't write {}: {e}. Stop the site's workers and try again.", file.display()),
                    format!("Tidak dapat menulis {}: {e}. Hentikan worker situs lalu coba lagi.", file.display())
                ))
            })?;
            if wal(&src).is_file() {
                fs::copy(wal(&src), wal(&file))?;
            }
            Ok(())
        }
    }
}

pub fn delete(site: &str, id: &str) -> AppResult<()> {
    let snap = find(site, id)?;
    let file = data_file(site, &snap);
    let _ = fs::remove_file(wal(&file));
    fs::remove_file(&file)?;
    fs::remove_file(dir(site).join(format!("{}.json", snap.id)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(env: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("zefaro-snap-{}-{}", std::process::id(), env.len()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(p.join("database")).unwrap();
        fs::write(p.join(".env"), env).unwrap();
        p
    }

    #[test]
    fn the_target_is_the_database_the_env_names_on_zefaros_servers() {
        let p = project(&format!("DB_CONNECTION=mysql\nDB_HOST=127.0.0.1\nDB_PORT={}\nDB_DATABASE=shop\n", mysql::port()));
        assert_eq!(target_of(&p).unwrap(), Target::Server(Engine::MySql, "shop".into()));
        fs::write(p.join(".env"), format!("DB_CONNECTION=pgsql\nDB_PORT={}\nDB_DATABASE=blog\n", postgres::port())).unwrap();
        assert_eq!(target_of(&p).unwrap(), Target::Server(Engine::PostgreSql, "blog".into()));
        fs::write(p.join(".env"), "DB_CONNECTION=mysql\nDB_HOST=db.example.com\nDB_DATABASE=shop\n").unwrap();
        assert!(target_of(&p).is_err(), "a remote server isn't Zefaro's");
        fs::write(p.join(".env"), "DB_CONNECTION=sqlite\n").unwrap();
        assert!(target_of(&p).is_err(), "no SQLite file yet");
        fs::write(p.join("database").join("database.sqlite"), b"SQLite format 3\0").unwrap();
        assert_eq!(target_of(&p).unwrap(), Target::Sqlite(p.join("database").join("database.sqlite")));
        let _ = fs::remove_dir_all(&p);
    }

    /// A temp MariaDB (Zefaro's installed binaries) on a spare port: snapshot,
    /// change the data, restore, and the rows are back. Run alone: it points
    /// MariaDB's active port at the temp server for the test.
    #[test]
    #[ignore = "needs MariaDB installed by Zefaro (run alone with --ignored)"]
    fn live_a_mariadb_snapshot_comes_back_as_it_was() {
        use crate::engine::supervisor::Supervisor;
        let tmp = std::env::temp_dir().join(format!("zefaro-snap-live-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let base = mariadb::Layout::standard().base;
        let l = mariadb::Layout { base, data: tmp.join("data"), conf: tmp.join("my.ini"), log: tmp.join("m.log"), port: 3339 };
        mariadb::prepare(&l, &tmp, true).unwrap();
        let sup = Supervisor::default();
        sup.start(mariadb::spec(&l)).unwrap();
        mariadb::set_port(3339);
        let c = Client::of(Engine::MariaDb);
        dbio::wait_ready(&c, std::time::Duration::from_secs(30)).unwrap();
        dbio::create_db(&c, "snap_live").unwrap();
        let q = |sql: &str| c.query(&format!("USE snap_live; {sql}")).unwrap().trim().to_owned();
        q("CREATE TABLE t (id int primary key, v text); INSERT INTO t VALUES (1, 'one'), (2, 'two');");

        let p = project("DB_CONNECTION=mariadb\nDB_HOST=127.0.0.1\nDB_PORT=3339\nDB_DATABASE=snap_live\n");
        let site = format!("snap-live-{}", std::process::id());
        let s = take(&site, &p, "before").unwrap();
        assert_eq!((s.engine, s.database.as_str()), (Some(Engine::MariaDb), "snap_live"));
        assert!(s.bytes > 0);
        q("DELETE FROM t WHERE id = 1; CREATE TABLE extra (x int);");
        restore(&site, &s.id).unwrap();
        assert_eq!(q("SELECT GROUP_CONCAT(v ORDER BY id) FROM t"), "one,two");
        assert_eq!(q("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'snap_live'"), "1", "the later table is gone");

        mariadb::set_port(mariadb::DEFAULT_PORT);
        sup.stop(mariadb::SERVICE_ID).unwrap();
        let _ = fs::remove_dir_all(dir(&site));
        let _ = fs::remove_dir_all(&p);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_sqlite_snapshot_comes_back_as_it_was() {
        let site = format!("snap-test-{}", std::process::id());
        let p = project("DB_CONNECTION=sqlite\n");
        let db = p.join("database").join("database.sqlite");
        fs::write(&db, b"before").unwrap();
        let s = take(&site, &p, "  before migrate  ").unwrap();
        assert_eq!((s.label.as_str(), s.engine, s.bytes), ("before migrate", None, 6));
        fs::write(&db, b"after the change").unwrap();
        assert_eq!(list(&site), [s.clone()]);
        restore(&site, &s.id).unwrap();
        assert_eq!(fs::read(&db).unwrap(), b"before");
        delete(&site, &s.id).unwrap();
        assert!(list(&site).is_empty());
        let _ = fs::remove_dir_all(dir(&site));
        let _ = fs::remove_dir_all(&p);
    }
}
