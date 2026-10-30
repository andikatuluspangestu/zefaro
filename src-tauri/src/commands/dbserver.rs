//! A database server's own settings page (the gear on the MariaDB, MySQL and
//! PostgreSQL cards): memory, connections, write speed, the slow query log and
//! extra lines. Saving restarts a running server, and puts the old settings
//! back if it won't start with the new ones.

use super::{blocking, services};
use crate::config::{self, DbTuning, ZefaroConfig};
use crate::engine::dbio::Engine;
use crate::engine::{mariadb, mysql, postgres};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

/// Names that would move or open up the server; Zefaro sets them itself.
const MYSQL_OWN: &[&str] = &[
    "basedir",
    "datadir",
    "port",
    "bind-address",
    "bind_address",
    "skip-networking",
    "skip_networking",
    "socket",
    "mysqlx",
    "mysqlx-port",
    "mysqlx_port",
    "admin-address",
    "admin_address",
    "log-error",
    "log_error",
    "slow_query_log_file",
];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DbServerView {
    pub engine: Engine,
    pub version: &'static str,
    pub port: u16,
    pub installed: bool,
    pub running: bool,
    pub settings: DbTuning,
    pub defaults: DbTuning,
    pub data_dir: String,
    /// my.ini (MariaDB, MySQL); None for PostgreSQL, whose settings go on its command line.
    pub config_path: Option<String>,
    pub log_path: String,
    /// Where slow queries go (MariaDB, MySQL); PostgreSQL writes them to its log.
    pub slow_log_path: Option<String>,
}

fn tuning(cfg: &ZefaroConfig, engine: Engine) -> &DbTuning {
    match engine {
        Engine::MariaDb => &cfg.mariadb,
        Engine::MySql => &cfg.mysql,
        Engine::PostgreSql => &cfg.postgres,
    }
}

fn tuning_mut(cfg: &mut ZefaroConfig, engine: Engine) -> &mut DbTuning {
    match engine {
        Engine::MariaDb => &mut cfg.mariadb,
        Engine::MySql => &mut cfg.mysql,
        Engine::PostgreSql => &mut cfg.postgres,
    }
}

fn defaults(engine: Engine) -> DbTuning {
    if engine == Engine::PostgreSql { DbTuning::postgres_default() } else { DbTuning::mysql_default() }
}

fn view(state: &AppState, engine: Engine) -> DbServerView {
    let settings = tuning(&state.config.lock().unwrap(), engine).clone();
    let running = state.supervisor.is_running(engine.service_id());
    let s = |p: PathBuf| p.display().to_string();
    let (version, installed, config_path, log_path, slow_log_path) = match engine {
        Engine::MariaDb => {
            let l = mariadb::Layout::standard();
            (mariadb::VERSION, mariadb::installed(&l), Some(s(l.conf.clone())), s(l.log.clone()), Some(s(mariadb::slow_log(&l))))
        }
        Engine::MySql => {
            let l = mysql::Layout::standard();
            (mysql::VERSION, mysql::installed(&l), Some(s(l.conf.clone())), s(l.log.clone()), Some(s(mysql::slow_log(&l))))
        }
        Engine::PostgreSql => {
            let l = postgres::Layout::standard();
            (postgres::VERSION, postgres::installed(&l), None, s(l.log.clone()), None)
        }
    };
    DbServerView {
        engine,
        version,
        port: engine.port(),
        installed,
        running,
        settings,
        defaults: defaults(engine),
        data_dir: s(engine.data_dir()),
        config_path,
        log_path,
        slow_log_path,
    }
}

/// Settings Zefaro accepts for `engine`: ranges, and extra lines that don't
/// touch what Zefaro sets itself (the port, the data folder, listening only on
/// 127.0.0.1).
pub fn check(engine: Engine, s: &DbTuning) -> AppResult<()> {
    let pg = engine == Engine::PostgreSql;
    s.validate(pg)?;
    let own: &[&str] = if pg { postgres::ZEFARO_OWN } else { MYSQL_OWN };
    if let Some((name, _)) = s.extra_pairs().into_iter().find(|(n, _)| own.contains(&n.to_ascii_lowercase().as_str())) {
        return Err(AppError::msg(crate::tr!(
            format!("Zefaro sets {name} itself (it keeps the server on 127.0.0.1 and in its own folder). Remove that line."),
            format!("Zefaro mengatur {name} sendiri (supaya server tetap di 127.0.0.1 dan di foldernya sendiri). Hapus baris itu.")
        )));
    }
    Ok(())
}

#[tauri::command]
pub fn db_server_settings(state: State<AppState>, engine: Engine) -> DbServerView {
    view(&state, engine)
}

/// Save `settings`. A running server restarts with them; if it doesn't come
/// back, the previous settings are restored and it starts with those.
#[tauri::command]
pub async fn db_server_save(state: State<'_, AppState>, engine: Engine, settings: DbTuning) -> AppResult<DbServerView> {
    check(engine, &settings)?;
    let (old, snapshot) = {
        let mut cfg = state.config.lock().unwrap();
        let old = tuning(&cfg, engine).clone();
        *tuning_mut(&mut cfg, engine) = settings;
        (old, cfg.clone())
    };
    config::save(&snapshot)?;
    let sup = state.supervisor.clone();
    let id = engine.service_id();
    if sup.is_running(id) {
        let restarted = {
            let (sup, snapshot) = (sup.clone(), snapshot.clone());
            blocking(move || {
                sup.stop(id)?;
                services::start(&snapshot, &sup, id)
            })
            .await
        };
        if let Err(e) = restarted {
            let restored = {
                let mut cfg = state.config.lock().unwrap();
                *tuning_mut(&mut cfg, engine) = old;
                cfg.clone()
            };
            config::save(&restored)?;
            let back = blocking(move || {
                let _ = sup.stop(id);
                services::start(&restored, &sup, id)
            })
            .await;
            let server = engine.name();
            return Err(AppError::msg(match back {
                Ok(()) => crate::tr!(
                    format!("{server} didn't start with these settings, so Zefaro put the previous ones back and restarted it. {e}"),
                    format!("{server} tidak mau berjalan dengan pengaturan ini, jadi Zefaro mengembalikan pengaturan sebelumnya dan menjalankannya lagi. {e}")
                ),
                Err(e2) => crate::tr!(
                    format!("{server} didn't start with these settings ({e}), and not with the previous ones either ({e2}). Check its log on the Logs page."),
                    format!("{server} tidak mau berjalan dengan pengaturan ini ({e}), juga tidak dengan yang sebelumnya ({e2}). Periksa log-nya di halaman Log.")
                ),
            }));
        }
    } else {
        // Written now, so the file shown matches; the next start writes it again.
        let _ = write_config(&snapshot, engine);
    }
    Ok(view(&state, engine))
}

fn write_config(cfg: &ZefaroConfig, engine: Engine) -> AppResult<()> {
    match engine {
        Engine::MariaDb => {
            let l = mariadb::Layout::standard();
            if mariadb::installed(&l) { mariadb::write_ini(&l, &cfg.mariadb) } else { Ok(()) }
        }
        Engine::MySql => {
            let l = mysql::Layout::standard();
            if mysql::installed(&l) { mysql::write_ini(&l, &cfg.mysql) } else { Ok(()) }
        }
        Engine::PostgreSql => Ok(()),
    }
}

/// What the server reads: my.ini, or PostgreSQL's settings as name = value.
#[tauri::command]
pub fn db_server_config_text(state: State<AppState>, engine: Engine) -> String {
    let cfg = state.config.lock().unwrap().clone();
    match engine {
        Engine::MariaDb => mariadb::render_ini_with(&mariadb::Layout::standard(), &cfg.mariadb),
        Engine::MySql => mysql::render_ini_with(&mysql::Layout::standard(), &cfg.mysql),
        Engine::PostgreSql => {
            let mut out = String::from(
                "# Passed to postgres.exe as -c settings by Zefaro, after its own:\n\
                 # listen_addresses=127.0.0.1, logging to postgresql.log.\n",
            );
            for setting in postgres::tuning_settings(&cfg.postgres) {
                let (k, v) = setting.split_once('=').unwrap_or((&setting, ""));
                out.push_str(&format!("{k} = {v}\n"));
            }
            out
        }
    }
}

/// Show the server's data folder, config file or a log in Explorer.
#[tauri::command]
pub fn db_server_reveal(app: tauri::AppHandle, state: State<AppState>, engine: Engine, what: String) -> AppResult<()> {
    let v = view(&state, engine);
    let path = match what.as_str() {
        "data" => Some(v.data_dir),
        "config" => v.config_path,
        "log" => Some(v.log_path),
        "slow" => v.slow_log_path,
        _ => None,
    }
    .map(PathBuf::from)
    .filter(|p| p.exists())
    .ok_or_else(|| {
        AppError::msg(crate::tr!(
            "That file isn't there yet. It appears once the server has run with it.",
            "File itu belum ada. File akan muncul setelah server berjalan dengannya."
        ))
    })?;
    app.opener().reveal_item_in_dir(&path).map_err(|e| {
        AppError::msg(crate::tr!(format!("Couldn't open Explorer: {e}"), format!("Tidak dapat membuka Explorer: {e}")))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extra_lines_cannot_move_or_open_up_the_server() {
        let with = |extra: &str| DbTuning { extra: extra.into(), ..DbTuning::mysql_default() };
        assert!(check(Engine::MariaDb, &with("innodb_log_file_size = 256M\nsql_mode = STRICT_ALL_TABLES\nskip-name-resolve")).is_ok());
        for bad in ["bind-address = 0.0.0.0", "PORT=3310", "datadir=D:/x", "[client]", "skip-networking"] {
            assert!(check(Engine::MySql, &with(bad)).is_err(), "{bad}");
        }
        let pg = |extra: &str| DbTuning { extra: extra.into(), ..DbTuning::postgres_default() };
        assert!(check(Engine::PostgreSql, &pg("random_page_cost = 1.1\neffective_cache_size = 1GB")).is_ok());
        for bad in ["listen_addresses = '*'", "port = 5433", "jit"] {
            assert!(check(Engine::PostgreSql, &pg(bad)).is_err(), "{bad}");
        }
        assert!(check(Engine::MariaDb, &DbTuning { memory_mb: 8, ..DbTuning::mysql_default() }).is_err());
        assert!(check(Engine::PostgreSql, &DbTuning { work_mem_mb: 0, ..DbTuning::postgres_default() }).is_err());
    }

    fn tuned() -> DbTuning {
        DbTuning {
            memory_mb: 64,
            max_connections: 42,
            max_packet_mb: 64,
            fast_writes: false,
            slow_log: true,
            slow_ms: 250,
            ..DbTuning::mysql_default()
        }
    }

    /// The installed MariaDB, and MySQL from its zip (kept in
    /// `ZEFARO_MYSQL_ZIP_DIR`), started in temp folders with the card's
    /// settings: the server reports them back, and a bad extra line makes the
    /// start fail with MariaDB's own reason.
    #[test]
    #[ignore = "starts MariaDB and MySQL in temp folders (run with --ignored)"]
    fn live_mariadb_and_mysql_run_with_the_cards_settings() {
        use crate::engine::dbio::Client;
        use crate::engine::supervisor::Supervisor;
        let tmp = std::env::temp_dir().join(format!("zefaro-dbserver-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let sup = Supervisor::default();
        let ask = |c: &Client| {
            c.query("SELECT @@innodb_buffer_pool_size DIV 1048576, @@max_connections, @@max_allowed_packet DIV 1048576, @@innodb_flush_log_at_trx_commit, @@slow_query_log, @@long_query_time")
                .unwrap()
                .split_whitespace()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        };

        let base = mariadb::Layout::standard().base;
        assert!(mariadb::installed(&mariadb::Layout::standard()), "install MariaDB in Zefaro first");
        let l = mariadb::Layout { base: base.clone(), data: tmp.join("m-data"), conf: tmp.join("m.ini"), log: tmp.join("mariadb.log"), port: 3327 };
        mariadb::prepare(&l, &tmp, true).unwrap();
        mariadb::write_ini(&l, &tuned()).unwrap();
        sup.start(mariadb::spec(&l)).expect("MariaDB starts with the settings");
        let c = Client { engine: Engine::MariaDb, bin: base.join("bin"), port: 3327 };
        assert_eq!(ask(&c), ["64", "42", "64", "1", "1", "0.250000"]);
        sup.stop(mariadb::SERVICE_ID).unwrap();
        // A line MariaDB doesn't know: it refuses to start, and says why.
        mariadb::write_ini(&l, &DbTuning { extra: "no_such_setting = 1".into(), ..tuned() }).unwrap();
        let err = sup.start(mariadb::spec(&l)).unwrap_err().to_string();
        println!("MariaDB with a bad line: {err}");
        let log = std::fs::read_to_string(&l.log).unwrap_or_default();
        assert!(log.contains("no_such_setting") || err.contains("no_such_setting"), "{err}\n{log}");
        let _ = sup.stop(mariadb::SERVICE_ID);

        let scratch = std::env::var_os("ZEFARO_MYSQL_ZIP_DIR").map(PathBuf::from).unwrap_or_else(|| tmp.join("dl"));
        let my = mysql::Layout {
            base: tmp.join("mysql"),
            data: tmp.join("my-data"),
            conf: tmp.join("my.ini"),
            log: tmp.join("mysql.log"),
            port: 53317,
        };
        mysql::prepare(&my, &scratch, true).unwrap();
        mysql::write_ini(&my, &tuned()).unwrap();
        sup.start(mysql::spec(&my)).expect("MySQL starts with the settings");
        let c = Client { engine: Engine::MySql, bin: my.base.join("bin"), port: 53317 };
        assert_eq!(ask(&c), ["64", "42", "64", "1", "1", "0.250000"]);
        sup.stop(mysql::SERVICE_ID).unwrap();
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// PostgreSQL from its zip (kept in `ZEFARO_PG_ZIP_DIR`) in a temp folder,
    /// started with the card's settings: SHOW reports them back.
    #[test]
    #[ignore = "installs PostgreSQL into a temp folder (run with --ignored)"]
    fn live_postgresql_runs_with_the_cards_settings() {
        use crate::engine::dbio::Client;
        use crate::engine::supervisor::Supervisor;
        let tmp = std::env::temp_dir().join(format!("zefaro-dbserver-pg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let scratch = std::env::var_os("ZEFARO_PG_ZIP_DIR").map(PathBuf::from).unwrap_or_else(|| tmp.join("dl"));
        let l = postgres::Layout { base: tmp.join("pg"), data: tmp.join("data"), log: tmp.join("postgresql.log"), port: 55434 };
        postgres::prepare(&l, &scratch, true).unwrap();
        let s = DbTuning {
            memory_mb: 64,
            work_mem_mb: 16,
            max_connections: 42,
            fast_writes: true,
            slow_log: true,
            slow_ms: 250,
            extra: "random_page_cost = 1.1".into(),
            ..DbTuning::postgres_default()
        };
        let sup = Supervisor::default();
        sup.start(postgres::spec_with(&l, &s)).expect("PostgreSQL starts with the settings");
        let c = Client { engine: Engine::PostgreSql, bin: l.base.join("bin"), port: 55434 };
        let show = |name: &str| c.query(&format!("SHOW {name}")).unwrap().trim().to_owned();
        assert_eq!(show("shared_buffers"), "64MB");
        assert_eq!(show("work_mem"), "16MB");
        assert_eq!(show("max_connections"), "42");
        assert_eq!(show("synchronous_commit"), "off");
        assert_eq!(show("log_min_duration_statement"), "250ms");
        assert_eq!(show("random_page_cost"), "1.1");
        assert_eq!(show("listen_addresses"), "127.0.0.1");
        sup.stop(postgres::SERVICE_ID).unwrap();
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
