//! Command-line shims for the services Zefaro runs, written to Zefaro's bin folder
//! (the one "Add to PATH" adds), next to the PHP and Node.js shims:
//!
//! - `mariadb`, `mysql`, `mariadb-dump`, `mysqldump`, `mariadb-admin`: connect
//!   to Zefaro's MariaDB on 127.0.0.1 as root unless told otherwise. With
//!   `-P 3307` they reach Zefaro's MySQL instead.
//! - `redis-cli`: connects to Zefaro's Redis.
//! - `nginx`: runs against Zefaro's generated config, for `-t`, `-T`, `-v`, `-V`
//!   and `-s reload` only. Starting or stopping nginx stays with the Services
//!   page, so a second nginx can't grab the ports behind Zefaro's back.
//!
//! A shim is written only while its program is installed, and removed otherwise.

use crate::config::ZefaroConfig;
use crate::engine::{mariadb, nginx, paths, postgres, redis};
use crate::error::AppResult;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

/// MariaDB client tools: shim name → executable in MariaDB's bin folder.
const MARIADB_TOOLS: &[(&str, &str)] = &[
    ("mariadb", "mariadb.exe"),
    ("mysql", "mysql.exe"),
    ("mariadb-dump", "mariadb-dump.exe"),
    ("mysqldump", "mysqldump.exe"),
    ("mariadb-admin", "mariadb-admin.exe"),
];

/// PostgreSQL client tools: shim name → executable in PostgreSQL's bin folder.
const POSTGRES_TOOLS: &[&str] = &["psql", "pg_dump", "pg_dumpall", "pg_restore", "createdb", "dropdb", "pg_isready"];

fn header() -> String {
    "@echo off\r\nsetlocal\r\n".to_owned()
}

/// Client defaults come first; options the user passes come later and win.
pub fn render_client(exe: &Path, defaults: &str) -> String {
    format!("{}\"{}\" {defaults} %*\r\n", header(), exe.display())
}

/// A PostgreSQL client with Zefaro's server as the default. Environment
/// variables, so options the user passes (`-h`, `-U`, a database name) win.
pub fn render_pg_client(exe: &Path, env: &[(&str, String)]) -> String {
    let mut s = header();
    for (k, v) in env {
        s += &format!("if not defined {k} set \"{k}={v}\"\r\n");
    }
    s + &format!("\"{}\" %*\r\n", exe.display())
}

/// nginx with Zefaro's `-p`/`-c`, allowing only commands that don't start or
/// stop a server.
pub fn render_nginx(exe: &Path, dir: &Path, args: &[OsString]) -> String {
    let args: Vec<String> = args.iter().map(|a| format!("\"{}\"", a.to_string_lossy())).collect();
    format!(
        "{h}\
if /i \"%~1\"==\"-t\" goto run\r\n\
if /i \"%~1\"==\"-v\" goto run\r\n\
if \"%~1\"==\"-s\" if /i \"%~2\"==\"reload\" goto run\r\n\
echo Zefaro runs nginx: start and stop it on the Services page.\r\n\
echo Here you can use: nginx -t  (test the config), nginx -T  (print it),\r\n\
echo nginx -v / -V  (version), nginx -s reload.\r\n\
exit /b 1\r\n\
:run\r\n\
cd /d \"{dir}\"\r\n\
\"{exe}\" {args} %*\r\n",
        h = header(),
        dir = dir.display(),
        exe = exe.display(),
        args = args.join(" "),
    )
}

fn put(bin: &Path, name: &str, body: Option<String>) -> AppResult<()> {
    let path = bin.join(format!("{name}.bat"));
    match body {
        Some(body) => fs::write(path, body)?,
        None => {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

/// Where each service's programs live; tests point these at temp folders.
pub struct Sources {
    pub mariadb_bin: PathBuf,
    pub redis: PathBuf,
    pub postgres_bin: PathBuf,
    pub nginx: nginx::Layout,
}

impl Sources {
    pub fn standard(cfg: &ZefaroConfig) -> Self {
        Self {
            mariadb_bin: mariadb::Layout::standard().base.join("bin"),
            redis: redis::Layout::standard().base,
            postgres_bin: postgres::Layout::standard().base.join("bin"),
            nginx: nginx::Layout::standard(cfg),
        }
    }
}

/// Write (or remove) the MariaDB, Redis and nginx shims in `bin`.
pub fn write_into(bin: &Path, src: &Sources) -> AppResult<()> {
    fs::create_dir_all(bin)?;
    // --skip-ssl: loopback only, and it silences the client's warning about
    // TLS with a passwordless login. --plugin-dir: MySQL 8 and later (Zefaro's
    // MySQL included) need the caching_sha2_password plugin, which the client
    // doesn't find on its own.
    let plugins = src.mariadb_bin.parent().map(|base| base.join("lib").join("plugin")).unwrap_or_default();
    let client = format!(
        "--host=127.0.0.1 --port={} --user=root --skip-ssl \"--plugin-dir={}\"",
        mariadb::PORT,
        plugins.display()
    );
    for (name, exe) in MARIADB_TOOLS {
        let path = src.mariadb_bin.join(exe);
        put(bin, name, path.is_file().then(|| render_client(&path, &client)))?;
    }

    let cli = src.redis.join("redis-cli.exe");
    let redis_defaults = format!("-h 127.0.0.1 -p {}", redis::PORT);
    put(bin, "redis-cli", cli.is_file().then(|| render_client(&cli, &redis_defaults)))?;

    let pg_env = postgres::client_env(postgres::PORT);
    for name in POSTGRES_TOOLS {
        let path = src.postgres_bin.join(format!("{name}.exe"));
        put(bin, name, path.is_file().then(|| render_pg_client(&path, &pg_env)))?;
    }

    let l = &src.nginx;
    let exe = l.exe();
    put(bin, "nginx", exe.is_file().then(|| render_nginx(&exe, &l.nginx, &l.base_args())))?;
    Ok(())
}

/// Refresh the shims in Zefaro's bin folder. Never fatal: a shim that can't be
/// written only affects the command line.
pub fn refresh(cfg: &ZefaroConfig) {
    let _ = write_into(&paths::bin_dir(), &Sources::standard(cfg));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::process;

    #[test]
    fn client_defaults_come_before_user_arguments() {
        let s = render_client(Path::new(r"C:\h\mariadb\bin\mysql.exe"), "--host=127.0.0.1 --port=3306 --user=root");
        assert!(s.ends_with("\"C:\\h\\mariadb\\bin\\mysql.exe\" --host=127.0.0.1 --port=3306 --user=root %*\r\n"));
    }

    #[test]
    fn missing_programs_get_no_shim() {
        let tmp = std::env::temp_dir().join(format!("zefaro-shims-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let bin = tmp.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("mysql.bat"), "stale").unwrap();
        let src = Sources {
            mariadb_bin: tmp.join("none"),
            redis: tmp.join("none"),
            postgres_bin: tmp.join("none"),
            nginx: nginx::Layout::under(tmp.join("none"), tmp.join("rt"), tmp.join("logs"), 8080),
        };
        write_into(&bin, &src).unwrap();
        assert!(fs::read_dir(&bin).unwrap().next().is_none(), "stale shim removed, none added");
        let _ = fs::remove_dir_all(&tmp);
    }

    fn run_bat(bat: &Path, args: &[&str]) -> (bool, String) {
        let out = process::command("cmd").arg("/C").arg(bat).args(args).output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout).into_owned() + &String::from_utf8_lossy(&out.stderr);
        (out.status.success(), text)
    }

    /// The shims against the programs Zefaro installed on this machine, written
    /// into a temp folder (never Zefaro's own bin). Read-only: versions and
    /// `nginx -t`; a bare `nginx` must refuse to start a server.
    #[test]
    #[ignore = "needs MariaDB, Redis and nginx installed by Zefaro (run with --ignored)"]
    fn live_shims_run_the_installed_programs() {
        let cfg = crate::config::load();
        let src = Sources::standard(&cfg);
        let bin = std::env::temp_dir().join(format!("zefaro-shims-live-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bin);
        write_into(&bin, &src).unwrap();

        for name in ["mariadb", "mysql", "mariadb-dump", "mysqldump", "mariadb-admin"] {
            let (ok, out) = run_bat(&bin.join(format!("{name}.bat")), &["--version"]);
            assert!(ok && out.contains("MariaDB"), "{name}: {out}");
        }
        let (ok, out) = run_bat(&bin.join("redis-cli.bat"), &["--version"]);
        assert!(ok && out.contains("redis-cli"), "redis-cli: {out}");

        let (ok, out) = run_bat(&bin.join("nginx.bat"), &["-v"]);
        assert!(ok && out.contains("nginx/"), "nginx -v: {out}");
        let (ok, out) = run_bat(&bin.join("nginx.bat"), &["-t"]);
        assert!(ok && out.contains("test is successful"), "nginx -t: {out}");
        let (ok, out) = run_bat(&bin.join("nginx.bat"), &[]);
        assert!(!ok && out.contains("Services page"), "bare nginx must refuse: {out}");
        let (ok, _) = run_bat(&bin.join("nginx.bat"), &["-s", "stop"]);
        assert!(!ok, "nginx -s stop must refuse");

        if src.postgres_bin.join("psql.exe").is_file() {
            for name in ["psql", "pg_dump", "pg_restore", "createdb"] {
                let (ok, out) = run_bat(&bin.join(format!("{name}.bat")), &["--version"]);
                assert!(ok && out.contains("PostgreSQL"), "{name}: {out}");
            }
            if crate::engine::supervisor::port_open(postgres::PORT) {
                let (ok, out) = run_bat(&bin.join("psql.bat"), &["-tAc", "SELECT 40+2"]);
                assert!(ok && out.trim().ends_with("42"), "psql -c: {out}");
            }
        }

        // With MariaDB running, the client reaches it as root without options.
        if crate::engine::supervisor::port_open(mariadb::PORT) {
            let (ok, out) = run_bat(&bin.join("mariadb.bat"), &["-N", "-e", "SELECT 40+2"]);
            assert!(ok && out.trim().ends_with("42"), "mariadb -e: {out}");
        }
        // And MySQL with its port; the later --port wins.
        if crate::engine::supervisor::port_open(crate::engine::mysql::PORT) {
            let (ok, out) = run_bat(&bin.join("mysql.bat"), &["-P", "3307", "-N", "-e", "SELECT VERSION()"]);
            assert!(ok && out.trim().ends_with(crate::engine::mysql::VERSION), "mysql -P 3307: {out}");
        }
        let _ = fs::remove_dir_all(&bin);
    }
}
