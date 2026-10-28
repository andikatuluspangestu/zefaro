//! Databases page: list, create and drop MariaDB databases, and export or
//! import them — built for multi-gigabyte dumps.
//!
//! Export and import stream through MariaDB's own `mariadb-dump` and `mariadb`
//! clients: data flows between the server and the file in 1 MB chunks, so a
//! 50 GB database needs no more memory than a 5 MB one. Both report progress
//! as they go and can be cancelled at any chunk.

use crate::engine::dumpfilter::Router;
use crate::engine::{mariadb, process};
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
/// Databases MariaDB keeps for itself; never listed, dropped or replaced.
const SYSTEM: &[&str] = &["information_schema", "mysql", "performance_schema", "sys"];

/// Which MariaDB the tools talk to: its client programs and port.
#[derive(Clone, Debug)]
pub struct Client {
    /// MariaDB's `bin` folder (mariadb.exe, mariadb-dump.exe).
    pub bin: PathBuf,
    pub port: u16,
}

impl Client {
    pub fn standard() -> Self {
        Self { bin: mariadb::Layout::standard().base.join("bin"), port: mariadb::PORT }
    }

    fn command(&self, exe: &str) -> std::process::Command {
        let mut cmd = process::command(self.bin.join(exe));
        cmd.args([
            "--host=127.0.0.1".to_owned(),
            format!("--port={}", self.port),
            "--user=root".to_owned(),
            // Loopback only: TLS adds nothing here, and with root's empty
            // password the client warns on every connection.
            "--skip-ssl".to_owned(),
            "--default-character-set=utf8mb4".to_owned(),
            // Rows with large BLOBs or long multi-row INSERTs.
            "--max-allowed-packet=1G".to_owned(),
        ]);
        cmd
    }

    /// Run SQL; returns tab-separated rows without a header.
    pub fn query(&self, sql: &str) -> AppResult<String> {
        process::run(self.command("mariadb.exe").args(["--batch", "--skip-column-names", "-e", sql]))
            .map_err(|e| AppError::msg(format!("MariaDB: {e}")))
    }
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
    SYSTEM.contains(&name.to_ascii_lowercase().as_str())
}

/// Database names Zefaro accepts: letters, digits, `_` and `-`, up to 64.
pub fn validate_name(name: &str) -> AppResult<()> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !ok {
        return Err(AppError::msg(crate::tr!(
            "Use letters, digits, _ and - only (at most 64 characters) for a database name.",
            "Gunakan hanya huruf, angka, _ dan - (paling banyak 64 karakter) untuk nama database.",
        )));
    }
    if is_system(name) {
        return Err(AppError::msg(crate::tr!(
            format!("{name} is one of MariaDB's own databases."),
            format!("{name} adalah salah satu database milik MariaDB sendiri.")
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

pub fn list(c: &Client) -> AppResult<Vec<DbInfo>> {
    let out = c.query(
        "SELECT s.schema_name, COALESCE(SUM(t.data_length + t.index_length), 0), COUNT(t.table_name) \
         FROM information_schema.schemata s \
         LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name \
         WHERE s.schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys') \
         GROUP BY s.schema_name ORDER BY s.schema_name",
    )?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let mut f = line.split('\t');
            Some(DbInfo {
                name: f.next()?.to_owned(),
                size: f.next()?.trim().parse().unwrap_or(0),
                tables: f.next()?.trim().parse().unwrap_or(0),
            })
        })
        .collect())
}

pub fn exists(c: &Client, name: &str) -> AppResult<bool> {
    validate_name(name)?;
    Ok(list(c)?.iter().any(|d| d.name.eq_ignore_ascii_case(name)))
}

pub fn create_db(c: &Client, name: &str) -> AppResult<()> {
    validate_name(name)?;
    c.query(&format!("CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")).map(|_| ())
}

pub fn drop_db(c: &Client, name: &str) -> AppResult<()> {
    validate_name(name)?;
    c.query(&format!("DROP DATABASE `{name}`")).map(|_| ())
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
    validate_name(db)?;
    let part = PathBuf::from(format!("{}.part", dest.display()));
    let mut child = c
        .command("mariadb-dump.exe")
        .args([
            // A consistent snapshot without locking tables (InnoDB).
            "--single-transaction",
            // Stream rows instead of buffering whole tables in memory.
            "--quick",
            "--routines",
            "--triggers",
            "--events",
            "--hex-blob",
            db,
        ])
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
    if let Err(e) = finish(child, tail, "mariadb-dump") {
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

/// Reads the whole dump once to find where it came from and which databases it
/// holds. Takes about as long as reading the file from disk.
pub fn scan(src: &Path) -> AppResult<DumpInfo> {
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
    let mut info = DumpInfo { origin: router.origin.clone(), databases: Vec::new(), system: Vec::new() };
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

/// Run the SQL in `src` (plain or gzip) against `db`. Calls `progress` with
/// the bytes of the file read so far (out of its size on disk).
///
/// From a dump that holds several databases, only the section of `from` runs.
/// `CREATE DATABASE`, `USE` and `SET GLOBAL` never run, so nothing lands
/// outside `db` (see `dumpfilter`).
pub fn import(
    c: &Client,
    db: &str,
    src: &Path,
    from: Option<&str>,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64),
) -> AppResult<()> {
    validate_name(db)?;
    if let Some(f) = from.filter(|f| is_system(f)) {
        return Err(AppError::msg(crate::tr!(
            format!("{f} is one of MariaDB's own databases, so Zefaro doesn't import it."),
            format!("{f} adalah salah satu database milik MariaDB sendiri, jadi Zefaro tidak mengimpornya.")
        )));
    }
    let (mut reader, count) = open_dump(src)?;
    let mut router = Router::import(from);

    let mut child = c
        .command("mariadb.exe")
        // --binary-mode: dumps may contain bytes the client would otherwise
        // treat as its own commands.
        .args(["--binary-mode", db])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    let tail = stderr_tail(&mut child);
    let mut stdin = child.stdin.take().expect("piped stdin");

    let result = (|| -> AppResult<()> {
        // Skip per-row foreign key and unique checks while loading — the
        // dump's data already satisfied them. Session only; restored below.
        // No newline: MariaDB's "at line N" then matches the file's own lines.
        stdin.write_all(b"SET SESSION foreign_key_checks=0, unique_checks=0; ")?;
        let (mut buf, mut out) = (vec![0u8; CHUNK], Vec::with_capacity(CHUNK));
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(cancelled());
            }
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            router.feed(&buf[..n], &mut out)?;
            stdin.write_all(&out)?;
            out.clear();
            progress(count.load(Ordering::Relaxed));
        }
        router.finish()?;
        stdin.write_all(b"\nSET SESSION unique_checks=1, foreign_key_checks=1;\n")?;
        Ok(())
    })();
    std::mem::drop(stdin);

    match result {
        Err(e) if e.to_string() == cancelled().to_string() => {
            let _ = child.kill();
            let _ = child.wait();
            Err(e)
        }
        // The client stops at the first SQL error and closes its input: its
        // own message says what went wrong, not our "broken pipe".
        Err(e) => finish(child, tail, "mariadb").and(Err(e)),
        Ok(()) => finish(child, tail, "mariadb"),
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
        let c = Client { bin: base.join("bin"), port: 3318 };

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
        let c = Client { bin: base.join("bin"), port: 3317 };
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

        let info = scan(&dump).unwrap();
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
            let info = scan(&real).unwrap();
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
