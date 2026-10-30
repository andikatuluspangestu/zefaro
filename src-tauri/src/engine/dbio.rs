//! Databases page: list, create and drop the databases of MariaDB, MySQL and
//! PostgreSQL, and export or import them — built for multi-gigabyte dumps.
//!
//! Export and import stream through each server's own clients (`mariadb-dump`
//! and `mariadb`, `mysqldump` and `mysql`, `pg_dump` and `psql` or
//! `pg_restore`): data flows between the server and the file in 1 MB chunks,
//! so a 50 GB database needs no more memory than a 5 MB one. Both report
//! progress as they go and can be cancelled at any chunk.

use crate::engine::dumpfilter::{PgFilter, Router};
use crate::engine::{mariadb, mysql, postgres, process};
use crate::error::{AppError, AppResult};
use flate2::read::MultiGzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

const CHUNK: usize = 1024 * 1024;
/// Databases MariaDB and MySQL keep for themselves; never listed, dropped or replaced.
const SYSTEM: &[&str] = &["information_schema", "mysql", "performance_schema", "sys"];
/// PostgreSQL's maintenance database and its templates.
const PG_SYSTEM: &[&str] = &["postgres", "template0", "template1"];

/// The database servers the Databases page manages.
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    MariaDb,
    MySql,
    PostgreSql,
}

impl Engine {
    pub fn name(self) -> &'static str {
        match self {
            Engine::MariaDb => "MariaDB",
            Engine::MySql => "MySQL",
            Engine::PostgreSql => "PostgreSQL",
        }
    }

    pub fn service_id(self) -> &'static str {
        match self {
            Engine::MariaDb => mariadb::SERVICE_ID,
            Engine::MySql => mysql::SERVICE_ID,
            Engine::PostgreSql => postgres::SERVICE_ID,
        }
    }

    pub fn port(self) -> u16 {
        match self {
            Engine::MariaDb => mariadb::PORT,
            Engine::MySql => mysql::PORT,
            Engine::PostgreSql => postgres::PORT,
        }
    }

    /// The folder that holds the server's data.
    pub fn data_dir(self) -> PathBuf {
        match self {
            Engine::MariaDb => mariadb::Layout::standard().data,
            Engine::MySql => mysql::Layout::standard().data,
            Engine::PostgreSql => postgres::Layout::standard().data,
        }
    }

    /// The server's own databases, which Zefaro never lists or touches.
    fn system(self) -> &'static [&'static str] {
        match self {
            Engine::PostgreSql => PG_SYSTEM,
            _ => SYSTEM,
        }
    }

    pub fn is_system(self, name: &str) -> bool {
        self.system().contains(&name.to_ascii_lowercase().as_str())
    }
}

/// Which server the tools talk to: its client programs and port.
#[derive(Clone, Debug)]
pub struct Client {
    pub engine: Engine,
    /// The server's `bin` folder, where its clients are.
    pub bin: PathBuf,
    pub port: u16,
}

impl Client {
    /// Zefaro's MariaDB.
    pub fn standard() -> Self {
        Self::of(Engine::MariaDb)
    }

    /// Zefaro's own install of `engine`.
    pub fn of(engine: Engine) -> Self {
        let base = match engine {
            Engine::MariaDb => mariadb::Layout::standard().base,
            Engine::MySql => mysql::Layout::standard().base,
            Engine::PostgreSql => postgres::Layout::standard().base,
        };
        Self { engine, bin: base.join("bin"), port: engine.port() }
    }

    /// Whether the client programs are there (the server is installed).
    pub fn installed(&self) -> bool {
        self.bin.join(self.exe(Tool::Client)).is_file()
    }

    fn exe(&self, tool: Tool) -> &'static str {
        match (self.engine, tool) {
            (Engine::MariaDb, Tool::Client) => "mariadb.exe",
            (Engine::MariaDb, Tool::Dump) => "mariadb-dump.exe",
            (Engine::MySql, Tool::Client) => "mysql.exe",
            (Engine::MySql, Tool::Dump) => "mysqldump.exe",
            (Engine::PostgreSql, Tool::Client) => "psql.exe",
            (Engine::PostgreSql, Tool::Dump) => "pg_dump.exe",
            (Engine::PostgreSql, Tool::Restore) => "pg_restore.exe",
            (_, Tool::Restore) => unreachable!("pg_restore is PostgreSQL's"),
        }
    }

    /// A client program with the connection settings applied.
    fn command(&self, tool: Tool) -> std::process::Command {
        let mut cmd = process::command(self.bin.join(self.exe(tool)));
        if self.engine == Engine::PostgreSql {
            for (k, v) in postgres::client_env(self.port) {
                cmd.env(k, v);
            }
            return cmd;
        }
        cmd.args([
            "--host=127.0.0.1".to_owned(),
            format!("--port={}", self.port),
            "--user=root".to_owned(),
            // Loopback only: TLS adds nothing here, and with root's empty
            // password the client warns on every connection.
            if self.engine == Engine::MySql { "--ssl-mode=DISABLED" } else { "--skip-ssl" }.to_owned(),
            "--default-character-set=utf8mb4".to_owned(),
            // Rows with large BLOBs or long multi-row INSERTs.
            "--max-allowed-packet=1G".to_owned(),
        ]);
        cmd
    }

    /// Run SQL; returns tab-separated rows without a header.
    pub fn query(&self, sql: &str) -> AppResult<String> {
        let mut cmd = self.command(Tool::Client);
        if self.engine == Engine::PostgreSql {
            cmd.args(["-X", "-q", "-t", "-A", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql]);
        } else {
            cmd.args(["--batch", "--skip-column-names", "-e", sql]);
        }
        process::run(&mut cmd).map_err(|e| AppError::msg(format!("{}: {e}", self.engine.name())))
    }
}

#[derive(Clone, Copy)]
enum Tool {
    Client,
    Dump,
    Restore,
}

/// One database on the Databases page.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub name: String,
    /// Data + indexes, as MariaDB reports them.
    pub size: u64,
    pub tables: u64,
}

/// What a dump file holds, read before importing it.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DumpInfo {
    /// "MySQL 8.4.3" or "MariaDB 11.8.9", when the dump says.
    pub origin: Option<String>,
    /// The databases a multi-database dump holds, MariaDB's own left out.
    /// Empty for a dump of a single database without sections.
    pub databases: Vec<DumpDatabase>,
    /// System databases in the dump, which Zefaro never imports.
    pub system: Vec<String>,
    /// A pg_dump archive in its custom format (loaded with pg_restore), not SQL.
    pub custom: bool,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DumpDatabase {
    pub name: String,
    /// Bytes of SQL in its section (uncompressed).
    pub bytes: u64,
}

/// Whether `name` is one of MariaDB's own databases.
pub fn is_system(name: &str) -> bool {
    Engine::MariaDb.is_system(name)
}

/// Database names Zefaro accepts for MariaDB: letters, digits, `_` and `-`, up to 64.
pub fn validate_name(name: &str) -> AppResult<()> {
    validate_for(Engine::MariaDb, name)
}

/// Database names Zefaro accepts: letters, digits, `_` and `-`, up to 64
/// (PostgreSQL's limit is 63), and none of the server's own.
pub fn validate_for(engine: Engine, name: &str) -> AppResult<()> {
    let max = if engine == Engine::PostgreSql { 63 } else { 64 };
    let ok = !name.is_empty()
        && name.len() <= max
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !ok {
        return Err(AppError::msg(crate::tr!(
            format!("Use letters, digits, _ and - only (at most {max} characters) for a database name."),
            format!("Gunakan hanya huruf, angka, _ dan - (paling banyak {max} karakter) untuk nama database."),
        )));
    }
    if engine.is_system(name) {
        let server = engine.name();
        return Err(AppError::msg(crate::tr!(
            format!("{name} is one of {server}'s own databases."),
            format!("{name} adalah salah satu database milik {server} sendiri.")
        )));
    }
    Ok(())
}

/// A database name from a file name: "my-app_2026-10-27.sql.gz" → "my-app_2026-10-27".
pub fn name_from_file(path: &Path) -> String {
    let file = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    let stem = file.trim_end_matches(".gz").trim_end_matches(".sql");
    let clean: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .take(64)
        .collect();
    if clean.is_empty() { "imported".into() } else { clean }
}

/// Tab-separated `name, size, tables` rows into `DbInfo`s.
fn parse_rows(out: &str) -> Vec<DbInfo> {
    out.lines()
        .filter_map(|line| {
            let mut f = line.split('\t');
            Some(DbInfo {
                name: f.next()?.to_owned(),
                size: f.next()?.trim().parse().unwrap_or(0),
                tables: f.next()?.trim().parse().unwrap_or(0),
            })
        })
        .collect()
}

pub fn list(c: &Client) -> AppResult<Vec<DbInfo>> {
    if c.engine == Engine::PostgreSql {
        return list_pg(c);
    }
    let sql = if c.engine == Engine::MySql {
        // MySQL's table sizes come from InnoDB statistics that lag behind (an
        // import of 12 MB still shows 64 KB). The tablespace files' sizes are
        // always current: one .ibd per table, named `db/table` (`_` is escaped
        // for LIKE).
        "SELECT s.schema_name, \
           COALESCE((SELECT SUM(ts.ALLOCATED_SIZE) FROM information_schema.INNODB_TABLESPACES ts \
             WHERE ts.NAME LIKE CONCAT(REPLACE(s.schema_name, '_', '|_'), '/%') ESCAPE '|'), 0), \
           (SELECT COUNT(*) FROM information_schema.tables t WHERE t.table_schema = s.schema_name) \
         FROM information_schema.schemata s \
         WHERE s.schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys') \
         ORDER BY s.schema_name"
    } else {
        "SELECT s.schema_name, COALESCE(SUM(t.data_length + t.index_length), 0), COUNT(t.table_name) \
         FROM information_schema.schemata s \
         LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name \
         WHERE s.schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys') \
         GROUP BY s.schema_name ORDER BY s.schema_name"
    };
    Ok(parse_rows(&c.query(sql)?))
}

/// PostgreSQL keeps each database's tables in that database's own catalog, so
/// counting them takes a connection to each: one psql run that `\connect`s in turn.
fn list_pg(c: &Client) -> AppResult<Vec<DbInfo>> {
    let out = c.query(
        "SELECT datname, pg_database_size(datname) FROM pg_database \
         WHERE NOT datistemplate AND datallowconn AND datname <> 'postgres' ORDER BY datname",
    )?;
    let mut dbs: Vec<DbInfo> = out
        .lines()
        .filter_map(|line| {
            let (name, size) = line.split_once('\t')?;
            Some(DbInfo { name: name.to_owned(), size: size.trim().parse().unwrap_or(0), tables: 0 })
        })
        .collect();
    // Names Zefaro can't quote safely stay listed, without a table count.
    let countable: Vec<usize> = (0..dbs.len()).filter(|&i| validate_for(Engine::PostgreSql, &dbs[i].name).is_ok()).collect();
    if countable.is_empty() {
        return Ok(dbs);
    }
    let mut cmd = c.command(Tool::Client);
    cmd.args(["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"]);
    for &i in &countable {
        cmd.arg("-c").arg(format!("\\connect \"{}\"", dbs[i].name));
        cmd.args([
            "-c",
            "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')",
        ]);
    }
    let counts = process::run(&mut cmd).map_err(|e| AppError::msg(format!("PostgreSQL: {e}")))?;
    for (&i, n) in countable.iter().zip(counts.lines().filter(|l| !l.trim().is_empty())) {
        dbs[i].tables = n.trim().parse().unwrap_or(0);
    }
    Ok(dbs)
}

pub fn exists(c: &Client, name: &str) -> AppResult<bool> {
    validate_for(c.engine, name)?;
    // MariaDB and MySQL on Windows store names in lower case; PostgreSQL
    // keeps a quoted name's case, so "Shop" and "shop" are two databases.
    Ok(list(c)?.iter().any(|d| match c.engine {
        Engine::PostgreSql => d.name == name,
        _ => d.name.eq_ignore_ascii_case(name),
    }))
}

pub fn create_db(c: &Client, name: &str) -> AppResult<()> {
    validate_for(c.engine, name)?;
    let sql = match c.engine {
        // UTF-8 with the C locale, from initdb.
        Engine::PostgreSql => format!("CREATE DATABASE \"{name}\""),
        _ => format!("CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"),
    };
    c.query(&sql).map(|_| ())
}

pub fn drop_db(c: &Client, name: &str) -> AppResult<()> {
    validate_for(c.engine, name)?;
    let sql = match c.engine {
        // FORCE ends open sessions (php artisan serve, a psql window), as
        // MariaDB and MySQL do by themselves.
        Engine::PostgreSql => format!("DROP DATABASE \"{name}\" WITH (FORCE)"),
        _ => format!("DROP DATABASE `{name}`"),
    };
    c.query(&sql).map(|_| ())
}

/// Data + index size of one database (an estimate of its dump's size).
pub fn size_of(c: &Client, name: &str) -> AppResult<u64> {
    Ok(list(c)?.into_iter().find(|d| d.name == name).map(|d| d.size).unwrap_or(0))
}

pub fn cancelled() -> AppError {
    AppError::msg(crate::tr!("Cancelled.", "Dibatalkan."))
}

/// Collect the last lines a child writes to stderr, on a thread so a chatty
/// child can never block on a full pipe.
fn stderr_tail(child: &mut Child) -> Arc<Mutex<String>> {
    let tail = Arc::new(Mutex::new(String::new()));
    if let Some(mut err) = child.stderr.take() {
        let tail = tail.clone();
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = err.read_to_string(&mut buf);
            let lines: Vec<&str> = buf.lines().filter(|l| !l.trim().is_empty()).collect();
            *tail.lock().unwrap() = lines[lines.len().saturating_sub(6)..].join("\n");
        });
    }
    tail
}

fn finish(mut child: Child, tail: Arc<Mutex<String>>, what: &str) -> AppResult<()> {
    let status = child.wait()?;
    // Give the stderr reader a moment to store what it got.
    for _ in 0..20 {
        if Arc::strong_count(&tail) == 1 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    if status.success() {
        return Ok(());
    }
    let msg = tail.lock().unwrap().clone();
    Err(AppError::msg(if msg.is_empty() {
        crate::tr!(format!("{what} failed ({status})."), format!("{what} gagal ({status})."))
    } else {
        msg
    }))
}

/// Write a dump of `db` to `dest` (gzip-compressed when `gzip`). Calls
/// `progress` with the uncompressed bytes dumped so far. The file appears
/// only once complete; a failure or cancel leaves nothing behind.
pub fn export(
    c: &Client,
    db: &str,
    dest: &Path,
    gzip: bool,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64),
) -> AppResult<u64> {
    validate_for(c.engine, db)?;
    let part = PathBuf::from(format!("{}.part", dest.display()));
    let mut cmd = c.command(Tool::Dump);
    match c.engine {
        Engine::PostgreSql => {
            cmd.args([
                "--format=plain",
                "--encoding=UTF8",
                // Ownership and grants name roles that exist on this server
                // only; without them the dump loads anywhere.
                "--no-owner",
                "--no-privileges",
                db,
            ]);
        }
        engine => {
            cmd.args([
                // A consistent snapshot without locking tables (InnoDB).
                "--single-transaction",
                // Stream rows instead of buffering whole tables in memory.
                "--quick",
                "--routines",
                "--triggers",
                "--events",
                "--hex-blob",
            ]);
            if engine == Engine::MySql {
                // GTIDs are off in Zefaro's MySQL; never write SET @@GLOBAL.GTID_PURGED.
                cmd.arg("--set-gtid-purged=OFF");
            }
            cmd.arg(db);
        }
    }
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let tail = stderr_tail(&mut child);
    let mut out = child.stdout.take().expect("piped stdout");

    let result = (|| -> AppResult<()> {
        let file = BufWriter::with_capacity(CHUNK, File::create(&part)?);
        let mut writer: Box<dyn Write> = if gzip {
            // Level 3: most of gzip's saving on SQL text at a speed that keeps
            // up with the dump.
            Box::new(GzEncoder::new(file, Compression::new(3)))
        } else {
            Box::new(file)
        };
        let mut buf = vec![0u8; CHUNK];
        let mut done = 0u64;
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(cancelled());
            }
            let n = out.read(&mut buf)?;
            if n == 0 {
                break;
            }
            writer.write_all(&buf[..n])?;
            done += n as u64;
            progress(done);
        }
        writer.flush()?;
        // Finishing the gzip stream happens on drop of GzEncoder; do it
        // explicitly so errors surface.
        drop(writer);
        Ok(())
    })();

    if let Err(e) = result {
        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    if let Err(e) = finish(child, tail, c.exe(Tool::Dump).trim_end_matches(".exe")) {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    if dest.exists() {
        fs::remove_file(dest)?;
    }
    fs::rename(&part, dest)?;
    Ok(fs::metadata(dest)?.len())
}

/// Counts the bytes read from the file, for progress on compressed input.
struct Counting<R> {
    inner: R,
    count: Arc<std::sync::atomic::AtomicU64>,
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.count.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }
}

/// Whether `path` is gzip-compressed, by its magic bytes (not its name).
pub fn is_gzip(path: &Path) -> AppResult<bool> {
    let mut magic = [0u8; 2];
    let n = File::open(path)?.read(&mut magic)?;
    Ok(n == 2 && magic == [0x1f, 0x8b])
}

/// The dump's SQL (decompressed when gzip), and a count of the file's bytes read.
fn open_dump(src: &Path) -> AppResult<(Box<dyn Read>, Arc<std::sync::atomic::AtomicU64>)> {
    let count = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let counting = Counting { inner: File::open(src)?, count: count.clone() };
    let reader: Box<dyn Read> = if is_gzip(src)? {
        Box::new(MultiGzDecoder::new(BufReader::with_capacity(CHUNK, counting)))
    } else {
        Box::new(BufReader::with_capacity(CHUNK, counting))
    };
    Ok((reader, count))
}

/// What kind of dump a file is, from its first bytes.
#[derive(Clone, Debug, PartialEq)]
pub enum Flavor {
    /// mysqldump, mariadb-dump or phpMyAdmin SQL.
    MySql,
    /// pg_dump's plain SQL.
    Postgres,
    /// pg_dumpall: every database, roles and tablespaces.
    PgCluster,
    /// pg_dump's custom format (`-Fc`), for pg_restore.
    PgCustom,
    /// SQL without a known banner (written by hand, or by another tool).
    Unknown,
}

/// How much of the (decompressed) start of a dump `sniff` reads.
const HEAD: usize = 64 * 1024;

/// The dump's flavor, and for pg_dump SQL the server version it came from.
pub fn sniff(src: &Path) -> AppResult<(Flavor, Option<String>)> {
    let (reader, _) = open_dump(src)?;
    let mut head = Vec::with_capacity(HEAD);
    reader.take(HEAD as u64).read_to_end(&mut head)?;
    if head.starts_with(b"PGDMP") {
        return Ok((Flavor::PgCustom, None));
    }
    let text = String::from_utf8_lossy(&head);
    if text.contains("-- PostgreSQL database cluster dump") {
        return Ok((Flavor::PgCluster, None));
    }
    if text.contains("-- PostgreSQL database dump") {
        // "-- Dumped from database version 16.2 (Debian 16.2-1.pgdg120+2)"
        let version = text
            .lines()
            .find_map(|l| l.strip_prefix("-- Dumped from database version "))
            .and_then(|v| v.split_whitespace().next())
            .map(|v| format!("PostgreSQL {v}"));
        return Ok((Flavor::Postgres, version));
    }
    let mysql = ["-- MySQL dump", "-- MariaDB dump", "-- phpMyAdmin SQL Dump"];
    if text.lines().any(|l| mysql.iter().any(|m| l.starts_with(m))) || text.contains("/*!40101 SET") {
        return Ok((Flavor::MySql, None));
    }
    Ok((Flavor::Unknown, None))
}

/// Refuses a dump made by the other kind of server: MySQL SQL doesn't run in
/// PostgreSQL, nor the other way round.
pub fn check_flavor(engine: Engine, flavor: &Flavor) -> AppResult<()> {
    let server = engine.name();
    match (engine, flavor) {
        (Engine::PostgreSql, Flavor::MySql) => Err(AppError::msg(crate::tr!(
            "This is a MySQL or MariaDB dump, which PostgreSQL can't load. Import it into MariaDB or MySQL instead.",
            "Ini dump MySQL atau MariaDB, yang tidak bisa dimuat oleh PostgreSQL. Impor ke MariaDB atau MySQL saja."
        ))),
        (Engine::PostgreSql, Flavor::PgCluster) => Err(AppError::msg(crate::tr!(
            "This is a pg_dumpall dump of a whole server. Zefaro imports one database at a time: make the dump with pg_dump instead.",
            "Ini dump pg_dumpall berisi seluruh server. Zefaro mengimpor satu database sekali jalan: buat dumpnya dengan pg_dump."
        ))),
        (Engine::MariaDb | Engine::MySql, Flavor::Postgres | Flavor::PgCluster | Flavor::PgCustom) => {
            Err(AppError::msg(crate::tr!(
                format!("This is a PostgreSQL dump, which {server} can't load. Import it into PostgreSQL instead."),
                format!("Ini dump PostgreSQL, yang tidak bisa dimuat oleh {server}. Impor ke PostgreSQL saja.")
            )))
        }
        _ => Ok(()),
    }
}

/// Reads the dump to find where it came from and which databases it holds.
/// A MariaDB or MySQL dump is read whole (about as long as reading the file
/// from disk); a PostgreSQL dump holds one database, so its start is enough.
pub fn scan(engine: Engine, src: &Path) -> AppResult<DumpInfo> {
    let (flavor, version) = sniff(src)?;
    check_flavor(engine, &flavor)?;
    if engine == Engine::PostgreSql {
        return Ok(DumpInfo {
            origin: version,
            databases: Vec::new(),
            system: Vec::new(),
            custom: flavor == Flavor::PgCustom,
        });
    }
    scan_sections(src)
}

fn scan_sections(src: &Path) -> AppResult<DumpInfo> {
    let (mut reader, _) = open_dump(src)?;
    let mut router = Router::scan();
    let (mut buf, mut sink) = (vec![0u8; CHUNK], Vec::new());
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        router.feed(&buf[..n], &mut sink)?;
        sink.clear();
    }
    let end = router.len();
    let mut info = DumpInfo { origin: router.origin.clone(), databases: Vec::new(), system: Vec::new(), custom: false };
    for (i, s) in router.sections.iter().enumerate() {
        let next = router.sections.get(i + 1).map_or(end, |n| n.offset);
        if is_system(&s.name) {
            info.system.push(s.name.clone());
        } else {
            info.databases.push(DumpDatabase { name: s.name.clone(), bytes: next - s.offset });
        }
    }
    Ok(info)
}

/// Which filter a dump streams through on its way to the client.
enum Filter {
    /// MariaDB and MySQL: one database's section, no USE or CREATE DATABASE.
    MySql(Router),
    /// pg_dump SQL: no \connect, ownership or grants.
    Pg(PgFilter),
    /// A pg_dump archive goes to pg_restore as it is.
    Raw,
}

impl Filter {
    fn feed(&mut self, data: &[u8], out: &mut Vec<u8>) -> AppResult<()> {
        match self {
            Filter::MySql(r) => r.feed(data, out),
            Filter::Pg(f) => {
                f.feed(data, out);
                Ok(())
            }
            Filter::Raw => {
                out.extend_from_slice(data);
                Ok(())
            }
        }
    }
}

/// Load the dump in `src` (plain or gzip) into `db`. Calls `progress` with
/// the bytes of the file read so far (out of its size on disk).
///
/// MariaDB and MySQL: from a dump that holds several databases, only the
/// section of `from` runs. `CREATE DATABASE`, `USE` and `SET GLOBAL` never
/// run, so nothing lands outside `db` (see `dumpfilter`).
///
/// PostgreSQL: pg_dump SQL runs through psql, without `\connect`, ownership
/// or grants (see `PgFilter`); a custom-format archive goes to pg_restore with
/// the same left out.
pub fn import(
    c: &Client,
    db: &str,
    src: &Path,
    from: Option<&str>,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64),
) -> AppResult<()> {
    validate_for(c.engine, db)?;
    let server = c.engine.name();
    if let Some(f) = from.filter(|f| c.engine.is_system(f)) {
        return Err(AppError::msg(crate::tr!(
            format!("{f} is one of {server}'s own databases, so Zefaro doesn't import it."),
            format!("{f} adalah salah satu database milik {server} sendiri, jadi Zefaro tidak mengimpornya.")
        )));
    }
    let (flavor, _) = sniff(src)?;
    check_flavor(c.engine, &flavor)?;
    let (mut reader, count) = open_dump(src)?;

    let (mut cmd, mut filter, tool) = match c.engine {
        Engine::PostgreSql if flavor == Flavor::PgCustom => {
            let mut cmd = c.command(Tool::Restore);
            // The archive comes on stdin; --exit-on-error stops at the first
            // failure, as psql and mariadb do.
            cmd.args(["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", db]);
            (cmd, Filter::Raw, Tool::Restore)
        }
        Engine::PostgreSql => {
            let mut cmd = c.command(Tool::Client);
            // `-f -` reads stdin as a script file, so errors say "psql:<stdin>:LINE:".
            cmd.args(["-X", "-q", "-v", "ON_ERROR_STOP=1", "--dbname", db, "-f", "-"]);
            (cmd, Filter::Pg(PgFilter::default()), Tool::Client)
        }
        _ => {
            let mut cmd = c.command(Tool::Client);
            // --binary-mode: dumps may contain bytes the client would otherwise
            // treat as its own commands.
            cmd.args(["--binary-mode", db]);
            (cmd, Filter::MySql(Router::import(from)), Tool::Client)
        }
    };
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn()?;
    let tail = stderr_tail(&mut child);
    let mut stdin = child.stdin.take().expect("piped stdin");
    let mysql = matches!(filter, Filter::MySql(_));

    let result = (|| -> AppResult<()> {
        if mysql {
            // Skip per-row foreign key and unique checks while loading — the
            // dump's data already satisfied them. Session only; restored below.
            // No newline: the server's "at line N" then matches the file's own lines.
            stdin.write_all(b"SET SESSION foreign_key_checks=0, unique_checks=0; ")?;
        }
        let (mut buf, mut out) = (vec![0u8; CHUNK], Vec::with_capacity(CHUNK));
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(cancelled());
            }
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            filter.feed(&buf[..n], &mut out)?;
            stdin.write_all(&out)?;
            out.clear();
            progress(count.load(Ordering::Relaxed));
        }
        if let Filter::MySql(router) = &filter {
            router.finish()?;
            stdin.write_all(b"\nSET SESSION unique_checks=1, foreign_key_checks=1;\n")?;
        }
        Ok(())
    })();
    std::mem::drop(stdin);

    let what = c.exe(tool).trim_end_matches(".exe");
    match result {
        Err(e) if e.to_string() == cancelled().to_string() => {
            let _ = child.kill();
            let _ = child.wait();
            Err(e)
        }
        // The client stops at the first SQL error and closes its input: its
        // own message says what went wrong, not our "broken pipe".
        Err(e) => finish(child, tail, what).and(Err(e)),
        Ok(()) => finish(child, tail, what),
    }
}

/// Free space on the drive holding `path` (or its nearest existing parent).
pub fn disk_free(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let mut p = path;
    while !p.exists() {
        p = p.parent()?;
    }
    let wide: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut free = 0u64;
    // SAFETY: `wide` is NUL-terminated; the out-pointers are valid u64s.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(free)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_checked_and_derived_from_files() {
        assert!(validate_name("my_app-2").is_ok());
        assert!(validate_name("bad name").is_err());
        assert!(validate_name("x`; DROP").is_err());
        assert!(validate_name("mysql").is_err());
        assert!(validate_name(&"a".repeat(65)).is_err());
        assert_eq!(name_from_file(Path::new(r"C:\d\shop_2026-10-27.sql.gz")), "shop_2026-10-27");
        assert_eq!(name_from_file(Path::new("my app.sql")), "my_app");
    }

    #[test]
    fn free_space_is_reported() {
        assert!(disk_free(&std::env::temp_dir().join("not/created")).unwrap() > 0);
    }

    /// A real MariaDB (Zefaro's installed binaries, temp data folder, spare
    /// port): create a database with generated rows, export it as .sql and
    /// .sql.gz, import both into new databases, compare, and cancel midway.
    /// `ZEFARO_DBIO_MB` sets the data size (default 64).
    #[test]
    #[ignore = "needs MariaDB installed by Zefaro (run with --ignored)"]
    fn live_export_import_round_trip() {
        use crate::engine::supervisor::Supervisor;
        let base = mariadb::Layout::standard().base;
        assert!(base.join("bin").join("mariadbd.exe").is_file(), "install MariaDB in Zefaro first");
        let tmp = std::env::temp_dir().join(format!("zefaro-dbio-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let l = mariadb::Layout {
            base: base.clone(),
            data: tmp.join("data"),
            conf: tmp.join("my.ini"),
            log: tmp.join("mariadb.log"),
            port: 3318,
        };
        mariadb::prepare(&l, &tmp, true).expect("init temp data folder");
        let sup = Supervisor::default();
        sup.start(mariadb::spec(&l)).expect("start MariaDB");
        let c = Client { engine: Engine::MariaDb, bin: base.join("bin"), port: 3318 };

        // Generate rows server-side: ~1 KB each, plus a blob with every byte value.
        let mb: u64 = std::env::var("ZEFARO_DBIO_MB").ok().and_then(|v| v.parse().ok()).unwrap_or(64);
        create_db(&c, "src").unwrap();
        c.query(
            "CREATE TABLE src.t (id INT PRIMARY KEY, body TEXT, bin BLOB, parent INT, \
             KEY(parent)) ENGINE=InnoDB",
        )
        .unwrap();
        c.query("CREATE TABLE src.child (id INT PRIMARY KEY, t_id INT, FOREIGN KEY (t_id) REFERENCES src.t(id))").unwrap();
        let rows = mb * 1024;
        let t0 = std::time::Instant::now();
        c.query(&format!(
            "SET SESSION max_recursive_iterations = {rows}; \
             INSERT INTO src.t WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {rows}) \
             SELECT i, CONCAT(TO_BASE64(RANDOM_BYTES(512)), REPEAT(MD5(i), 8)), \
                    UNHEX('00FF0A0D5C27225C6E'), i DIV 10 FROM n; \
             INSERT INTO src.child SELECT id, id FROM src.t WHERE id % 7 = 0;"
        ))
        .unwrap();
        println!("generated {mb} MB in {:?}", t0.elapsed());
        let checksum = |db: &str| c.query(&format!("CHECKSUM TABLE {db}.t, {db}.child")).unwrap().replace(db, "");
        let expected = checksum("src");

        for gzip in [false, true] {
            let file = tmp.join(if gzip { "src.sql.gz" } else { "src.sql" });
            let never = AtomicBool::new(false);
            let (mut calls, t0) = (0u32, std::time::Instant::now());
            let size = export(&c, "src", &file, gzip, &never, |_| calls += 1).expect("export");
            println!("export gzip={gzip}: {} MB file in {:?}", size / 1_048_576, t0.elapsed());
            assert!(calls > 1 && size > 0 && !tmp.join(format!("{}.part", file.display())).exists());
            assert_eq!(is_gzip(&file).unwrap(), gzip);

            let target = if gzip { "from_gz" } else { "from_sql" };
            create_db(&c, target).unwrap();
            let (mut last, t0) = (0u64, std::time::Instant::now());
            import(&c, target, &file, None, &never, |n| last = n).expect("import");
            println!("import gzip={gzip}: {:?}", t0.elapsed());
            assert_eq!(last, fs::metadata(&file).unwrap().len(), "progress reaches the file size");
            assert_eq!(checksum(target), expected, "imported data matches");
        }

        // Cancel: stops promptly and leaves no file behind.
        let stop = AtomicBool::new(false);
        let out = tmp.join("cancelled.sql");
        let err = export(&c, "src", &out, false, &stop, |n| {
            if n > 4 * 1_048_576 {
                stop.store(true, Ordering::Relaxed);
            }
        })
        .unwrap_err();
        assert_eq!(err.to_string(), "Cancelled.");
        assert!(!out.exists() && !tmp.join("cancelled.sql.part").exists());

        // A SQL error is reported with MariaDB's own message.
        let bad = tmp.join("bad.sql");
        fs::write(&bad, "CREATE TABLE ok (id INT);\nTHIS IS NOT SQL;\n").unwrap();
        create_db(&c, "bad").unwrap();
        let err = import(&c, "bad", &bad, None, &AtomicBool::new(false), |_| {}).unwrap_err().to_string();
        assert!(err.contains("ERROR 1064") && err.contains("line 2"), "{err}");

        // (mariadb-install-db also creates an empty "test" database on Windows.)
        let names: Vec<String> = list(&c).unwrap().into_iter().map(|d| d.name).filter(|n| n != "test").collect();
        assert_eq!(names, ["bad", "from_gz", "from_sql", "src"]);
        sup.stop(mariadb::SERVICE_ID).unwrap();
        let _ = fs::remove_dir_all(&tmp);
    }

    /// A real PostgreSQL (installed from the pinned zip into a temp folder; the
    /// zip is kept in `ZEFARO_PG_ZIP_DIR`, or downloaded there), on a spare
    /// port: list with table counts, export as .sql and .sql.gz and import
    /// both, load a custom-format archive and a `--create` dump that names
    /// another owner, refuse a MySQL dump, and drop.
    #[test]
    #[ignore = "installs PostgreSQL into a temp folder (run with --ignored)"]
    fn live_postgresql_export_import_round_trip() {
        use crate::engine::supervisor::Supervisor;
        let root = std::env::temp_dir().join(format!("zefaro-dbio-pg-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let scratch = std::env::var_os("ZEFARO_PG_ZIP_DIR").map(PathBuf::from).unwrap_or_else(|| root.join("dl"));
        let l = postgres::Layout {
            base: root.join("pg"),
            data: root.join("data"),
            log: root.join("postgresql.log"),
            port: 55433,
        };
        postgres::prepare(&l, &scratch, true).expect("install PostgreSQL");
        let sup = Supervisor::default();
        sup.start(postgres::spec(&l)).expect("start PostgreSQL");
        let c = Client { engine: Engine::PostgreSql, bin: l.base.join("bin"), port: 55433 };
        assert!(c.installed());
        let q = |db: &str, sql: &str| {
            let mut cmd = c.command(Tool::Client);
            cmd.args(["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "--dbname", db, "-c", sql]);
            process::run(&mut cmd).unwrap().trim().to_owned()
        };

        assert!(list(&c).unwrap().is_empty(), "postgres and the templates are hidden");
        assert!(validate_for(Engine::PostgreSql, "template1").is_err());
        create_db(&c, "src").unwrap();
        create_db(&c, "Mixed-Case").unwrap();
        assert!(exists(&c, "Mixed-Case").unwrap() && !exists(&c, "mixed-case").unwrap());
        q(
            "src",
            "CREATE TABLE parent (id bigserial PRIMARY KEY, body text, bin bytea); \
             CREATE TABLE child (id int PRIMARY KEY, parent_id bigint REFERENCES parent(id)); \
             CREATE VIEW v AS SELECT count(*) FROM parent; \
             INSERT INTO parent (body, bin) SELECT md5(i::text) || E'\\tGRANT ALL ON x TO y;\\n\\\\.', \
                    decode('00ff0a0d5c27', 'hex') FROM generate_series(1, 20000) i; \
             INSERT INTO child SELECT id, id FROM parent WHERE id % 7 = 0;",
        );
        let checksum = |db: &str| {
            q(db, "SELECT md5(string_agg(id || body || encode(bin, 'hex'), ',' ORDER BY id)) FROM parent")
                + &q(db, "SELECT count(*) FROM child")
                + &q(db, "SELECT last_value FROM parent_id_seq")
        };
        let expected = checksum("src");
        let info = list(&c).unwrap();
        let src = info.iter().find(|d| d.name == "src").unwrap();
        assert_eq!(src.tables, 2);
        assert!(src.size > 1_000_000, "{src:?}");

        let never = AtomicBool::new(false);
        for gzip in [false, true] {
            let file = root.join(if gzip { "src.sql.gz" } else { "src.sql" });
            let size = export(&c, "src", &file, gzip, &never, |_| {}).expect("export");
            assert!(size > 0 && is_gzip(&file).unwrap() == gzip);
            let scanned = scan(Engine::PostgreSql, &file).unwrap();
            assert!(scanned.origin.as_deref().unwrap().starts_with("PostgreSQL 18"), "{scanned:?}");
            assert!(scan(Engine::MySql, &file).is_err(), "MySQL refuses a PostgreSQL dump");
            let target = if gzip { "from_gz" } else { "from_sql" };
            create_db(&c, target).unwrap();
            let mut last = 0;
            import(&c, target, &file, None, &never, |n| last = n).expect("import");
            assert_eq!(last, fs::metadata(&file).unwrap().len());
            assert_eq!(checksum(target), expected, "imported data matches");
        }

        // pg_dump's custom format, through pg_restore.
        let archive = root.join("src.dump");
        process::run(c.command(Tool::Dump).args(["-Fc", "-f"]).arg(&archive).arg("src")).unwrap();
        assert!(scan(Engine::PostgreSql, &archive).unwrap().custom);
        create_db(&c, "from_custom").unwrap();
        import(&c, "from_custom", &archive, None, &never, |_| {}).expect("pg_restore");
        assert_eq!(checksum("from_custom"), expected);

        // A dump made elsewhere with --create, owned by a role this server lacks.
        q("postgres", "CREATE ROLE forge LOGIN");
        q("src", "ALTER TABLE parent OWNER TO forge; GRANT SELECT ON child TO forge");
        let created = root.join("created.sql");
        process::run(c.command(Tool::Dump).args(["--create", "-f"]).arg(&created).arg("src")).unwrap();
        let text = fs::read_to_string(&created).unwrap();
        assert!(text.contains("OWNER TO forge") && text.contains("\\connect") && text.contains("CREATE DATABASE"));
        q("src", "REASSIGN OWNED BY forge TO root; DROP OWNED BY forge");
        q("postgres", "DROP ROLE forge");
        create_db(&c, "from_create").unwrap();
        import(&c, "from_create", &created, None, &never, |_| {}).expect("import a --create dump");
        assert_eq!(checksum("from_create"), expected);

        // A SQL error is reported with psql's own message and line.
        let bad = root.join("bad.sql");
        fs::write(&bad, "CREATE TABLE ok (id int);\nTHIS IS NOT SQL;\n").unwrap();
        create_db(&c, "bad").unwrap();
        let err = import(&c, "bad", &bad, None, &never, |_| {}).unwrap_err().to_string();
        assert!(err.contains("syntax error") && err.contains(":2:"), "{err}");

        let mysql_dump = root.join("mysql.sql");
        fs::write(&mysql_dump, "-- MySQL dump 10.13  Distrib 8.4.3, for Win64\nCREATE TABLE `t` (id int);\n").unwrap();
        assert!(scan(Engine::PostgreSql, &mysql_dump).is_err());
        assert!(import(&c, "bad", &mysql_dump, None, &never, |_| {}).is_err());

        drop_db(&c, "bad").unwrap();
        let names: Vec<String> = list(&c).unwrap().into_iter().map(|d| d.name).collect();
        assert_eq!(names, ["Mixed-Case", "from_create", "from_custom", "from_gz", "from_sql", "src"]);
        sup.stop(postgres::SERVICE_ID).unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    /// A real MySQL (installed from the pinned zip into a temp folder; the zip
    /// is kept in `ZEFARO_MYSQL_ZIP_DIR`, or downloaded there), on a spare port:
    /// fresh sizes in the list, export as .sql and .sql.gz with MySQL's own
    /// mysqldump and import both, load a MariaDB dump, refuse a PostgreSQL one.
    #[test]
    #[ignore = "installs MySQL into a temp folder (run with --ignored)"]
    fn live_mysql_export_import_round_trip() {
        use crate::engine::supervisor::Supervisor;
        let root = std::env::temp_dir().join(format!("zefaro-dbio-mysql-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let scratch = std::env::var_os("ZEFARO_MYSQL_ZIP_DIR").map(PathBuf::from).unwrap_or_else(|| root.join("dl"));
        let l = mysql::Layout {
            base: root.join("mysql"),
            data: root.join("data"),
            conf: root.join("conf").join("my.ini"),
            log: root.join("mysql.log"),
            port: 53308,
        };
        mysql::prepare(&l, &scratch, true).expect("install MySQL");
        let sup = Supervisor::default();
        sup.start(mysql::spec(&l)).expect("start MySQL");
        let c = Client { engine: Engine::MySql, bin: l.base.join("bin"), port: 53308 };
        assert!(c.installed());
        assert!(list(&c).unwrap().is_empty(), "MySQL's own databases are hidden");

        create_db(&c, "src").unwrap();
        c.query(
            "USE src; \
             CREATE TABLE src.t (id INT PRIMARY KEY, body TEXT, bin BLOB, KEY(id)) ENGINE=InnoDB; \
             CREATE TABLE src.child (id INT PRIMARY KEY, t_id INT, FOREIGN KEY (t_id) REFERENCES src.t(id)); \
             CREATE VIEW src.v AS SELECT COUNT(*) AS n FROM src.t; \
             SET SESSION cte_max_recursion_depth = 100000; \
             INSERT INTO src.t (id, body, bin) \
             SELECT i, REPEAT(SHA2(i, 256), 10), UNHEX('00FF0A0D5C27225C6E') FROM \
             (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000) SELECT i FROM n) AS seq; \
             INSERT INTO src.child SELECT id, id FROM src.t WHERE id % 7 = 0;",
        )
        .unwrap();
        let info = list(&c).unwrap();
        let src = info.iter().find(|d| d.name == "src").unwrap();
        assert_eq!(src.tables, 3, "two tables and a view: {src:?}");
        assert!(src.size > 1_000_000, "sizes are current right after an insert: {src:?}");
        // In a tablespace name `_` mustn't match any character.
        create_db(&c, "shop-2026_x").unwrap();
        create_db(&c, "shop-2026xx").unwrap();
        c.query("CREATE TABLE `shop-2026xx`.orders (id INT PRIMARY KEY)").unwrap();
        let info = list(&c).unwrap();
        let size = |n: &str| info.iter().find(|d| d.name == n).unwrap().size;
        assert!(size("shop-2026xx") > 0 && size("shop-2026_x") == 0, "{info:?}");
        drop_db(&c, "shop-2026_x").unwrap();
        drop_db(&c, "shop-2026xx").unwrap();
        let checksum = |db: &str| c.query(&format!("CHECKSUM TABLE {db}.t, {db}.child")).unwrap().replace(db, "");
        let expected = checksum("src");

        let never = AtomicBool::new(false);
        for gzip in [false, true] {
            let file = root.join(if gzip { "src.sql.gz" } else { "src.sql" });
            let size = export(&c, "src", &file, gzip, &never, |_| {}).expect("export");
            assert!(size > 0 && is_gzip(&file).unwrap() == gzip);
            let scanned = scan(Engine::MySql, &file).unwrap();
            assert!(scanned.origin.as_deref().unwrap_or("").starts_with("MySQL"), "{scanned:?}");
            assert!(scan(Engine::PostgreSql, &file).is_err(), "PostgreSQL refuses a MySQL dump");
            let target = if gzip { "from_gz" } else { "from_sql" };
            create_db(&c, target).unwrap();
            import(&c, target, &file, None, &never, |_| {}).expect("import");
            assert_eq!(checksum(target), expected, "imported data matches");
        }
        let text = fs::read_to_string(root.join("src.sql")).unwrap();
        assert!(!text.contains("GTID_PURGED"), "no GTID statements");

        // A MariaDB dump, as Zefaro's MariaDB writes them.
        let mariadb_dump = root.join("from-mariadb.sql");
        fs::write(
            &mariadb_dump,
            "-- MariaDB dump 10.19  Distrib 11.8.3-MariaDB, for Win64 (AMD64)\n\
             /*!40101 SET NAMES utf8mb4 */;\n\
             CREATE TABLE `posts` (`id` int(11) NOT NULL AUTO_INCREMENT, `title` varchar(64) DEFAULT NULL, PRIMARY KEY (`id`)) \
             ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\
             INSERT INTO `posts` VALUES (1,'hello'),(2,'world');\n",
        )
        .unwrap();
        create_db(&c, "from_mariadb").unwrap();
        import(&c, "from_mariadb", &mariadb_dump, None, &never, |_| {}).expect("import a MariaDB dump");
        assert_eq!(c.query("SELECT COUNT(*) FROM from_mariadb.posts").unwrap().trim(), "2");

        let pg_dump = root.join("pg.sql");
        fs::write(&pg_dump, "--\n-- PostgreSQL database dump\n--\nCREATE TABLE t (id int);\n").unwrap();
        assert!(import(&c, "from_mariadb", &pg_dump, None, &never, |_| {}).is_err());

        // A SQL error is reported with MySQL's own message and line.
        let bad = root.join("bad.sql");
        fs::write(&bad, "CREATE TABLE ok (id INT);\nTHIS IS NOT SQL;\n").unwrap();
        create_db(&c, "bad").unwrap();
        let err = import(&c, "bad", &bad, None, &never, |_| {}).unwrap_err().to_string();
        assert!(err.contains("ERROR 1064") && err.contains("line 2"), "{err}");
        drop_db(&c, "bad").unwrap();

        let names: Vec<String> = list(&c).unwrap().into_iter().map(|d| d.name).collect();
        assert_eq!(names, ["from_gz", "from_mariadb", "from_sql", "src"]);
        sup.stop(mysql::SERVICE_ID).unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    /// A MySQL 8.4 `--all-databases` dump, `mysql` section included, imported
    /// into a real MariaDB: only the chosen database loads, under the target's
    /// name, and MariaDB's own tables stay as they were. With `ZEFARO_REAL_DUMP`
    /// set to a dump file, its smallest non-system database is imported too.
    #[test]
    #[ignore = "needs MariaDB installed by Zefaro (run with --ignored)"]
    fn live_imports_one_database_from_a_mysql8_dump() {
        use crate::engine::supervisor::Supervisor;
        let base = mariadb::Layout::standard().base;
        assert!(base.join("bin").join("mariadbd.exe").is_file(), "install MariaDB in Zefaro first");
        let tmp = std::env::temp_dir().join(format!("zefaro-dump8-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let l = mariadb::Layout {
            base: base.clone(),
            data: tmp.join("data"),
            conf: tmp.join("my.ini"),
            log: tmp.join("mariadb.log"),
            port: 3317,
        };
        mariadb::prepare(&l, &tmp, true).expect("init temp data folder");
        let sup = Supervisor::default();
        sup.start(mariadb::spec(&l)).expect("start MariaDB");
        let c = Client { engine: Engine::MariaDb, bin: base.join("bin"), port: 3317 };
        let q = |sql: &str| c.query(sql).unwrap().trim().to_owned();
        let system_tables = || q("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'mysql'");
        let before = system_tables();

        let dump = tmp.join("all.sql");
        fs::write(
            &dump,
            "-- MySQL dump 10.13  Distrib 8.4.3, for Win64 (x86_64)\n\
             /*!50503 SET NAMES utf8mb4 */;\n\
             /*!50606 SET GLOBAL INNODB_STATS_AUTO_RECALC=OFF */;\n\
             --\n-- Current Database: `mysql`\n--\n\n\
             CREATE DATABASE /*!32312 IF NOT EXISTS*/ `mysql` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;\n\n\
             USE `mysql`;\n\
             DROP TABLE IF EXISTS `columns_priv`;\n\
             CREATE TABLE `columns_priv` (`Host` char(255) NOT NULL) ENGINE=InnoDB;\n\
             CREATE TABLE `from_mysql8_only` (id int);\n\
             --\n-- Current Database: `shop`\n--\n\n\
             CREATE DATABASE /*!32312 IF NOT EXISTS*/ `shop` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;\n\n\
             USE `shop`;\n\
             CREATE TABLE `orders` (\n  `id` bigint unsigned NOT NULL AUTO_INCREMENT,\n  `note` varchar(64) COLLATE utf8mb4_0900_ai_ci,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;\n\
             INSERT INTO `orders` VALUES (1,'USE `mysql`; DROP TABLE x;'),(2,'ok');\n\
             --\n-- Current Database: `blog`\n--\n\n\
             USE `blog`;\n\
             CREATE TABLE `posts` (id int);\n",
        )
        .unwrap();

        let info = scan(Engine::MariaDb, &dump).unwrap();
        assert_eq!(info.origin.as_deref(), Some("MySQL 8.4.3"));
        let names: Vec<_> = info.databases.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, ["shop", "blog"]);
        assert_eq!(info.system, ["mysql"]);

        let never = AtomicBool::new(false);
        create_db(&c, "target").unwrap();
        // Without a choice, Zefaro refuses rather than running every section.
        let err = import(&c, "target", &dump, None, &never, |_| {}).unwrap_err().to_string();
        assert!(err.contains("several databases"), "{err}");
        assert!(import(&c, "target", &dump, Some("mysql"), &never, |_| {}).is_err());

        import(&c, "target", &dump, Some("shop"), &never, |_| {}).expect("import shop");
        assert_eq!(q("SELECT GROUP_CONCAT(note ORDER BY id) FROM target.orders"), "USE `mysql`; DROP TABLE x;,ok");
        assert_eq!(system_tables(), before, "MariaDB's own tables are untouched");
        let names: Vec<String> = list(&c).unwrap().into_iter().map(|d| d.name).filter(|n| n != "test").collect();
        assert_eq!(names, ["target"], "no shop or blog database appears");

        if let Ok(real) = std::env::var("ZEFARO_REAL_DUMP") {
            let real = PathBuf::from(real);
            let t0 = std::time::Instant::now();
            let info = scan(Engine::MariaDb, &real).unwrap();
            println!("scanned {} in {:?}: {info:?}", real.display(), t0.elapsed());
            // ZEFARO_REAL_DB picks the database; otherwise the smallest.
            let pick = std::env::var("ZEFARO_REAL_DB").ok();
            let chosen = match &pick {
                Some(name) => info.databases.iter().find(|d| &d.name == name),
                None => info.databases.iter().min_by_key(|d| d.bytes),
            };
            if let Some(small) = chosen {
                create_db(&c, "real").unwrap();
                let t0 = std::time::Instant::now();
                import(&c, "real", &real, Some(&small.name), &never, |_| {}).expect("import the real dump");
                println!("imported {} in {:?}", small.name, t0.elapsed());
                println!("{}", q("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'real'"));
                assert_eq!(system_tables(), before, "MariaDB's own tables are untouched");
            }
        }
        sup.stop(mariadb::SERVICE_ID).unwrap();
        let _ = fs::remove_dir_all(&tmp);
    }
}
