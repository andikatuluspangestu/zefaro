//! A site's own page: what's inside its Laravel app (overview, data, config,
//! routes, `.env`), a Tinker session, Artisan and Composer runs, and workers.

use super::blocking;
use crate::engine::laravel::{self, App, ArtisanCommand, EnvEntry, JobOutput, SiteJob, Worker};
use crate::engine::supervisor::{self, Health};
use crate::engine::{applog, apps, mariadb, paths, postgres};
use crate::error::{AppError, AppResult};
use crate::model::Site;
use crate::state::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

fn app_for(state: &AppState, name: &str) -> AppResult<App> {
    App::for_site(&state.config.lock().unwrap(), name)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SiteInfo {
    pub site: Site,
    pub is_laravel: bool,
    pub has_vendor: bool,
    pub has_env: bool,
    /// The PHP line the tools use (the site's, or the active one when the
    /// site's isn't installed). None when no PHP is installed.
    pub php: Option<String>,
    pub mariadb_running: bool,
    pub postgres_running: bool,
    pub mailpit_smtp_port: u16,
    pub mailpit_running: bool,
    pub composer_installed: bool,
}

/// Quick facts about a site, without starting PHP.
#[tauri::command]
pub fn site_info(name: String, state: State<AppState>) -> AppResult<SiteInfo> {
    let cfg = state.config.lock().unwrap();
    let site = cfg
        .sites
        .iter()
        .find(|s| s.name == name)
        .ok_or_else(|| AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada.")))?;
    let site = Site {
        url: cfg.url_for(&format!("{}.{}", site.name, cfg.tld), site.secured),
        framework: crate::engine::framework::detect(std::path::Path::new(&site.path)).map(str::to_owned),
        ..site.clone()
    };
    let app = App::for_site(&cfg, &name).ok();
    let folder = PathBuf::from(&site.path);
    Ok(SiteInfo {
        is_laravel: folder.join("artisan").is_file(),
        has_vendor: folder.join("vendor").join("autoload.php").is_file(),
        has_env: folder.join(".env").is_file(),
        php: app.map(|a| a.php),
        mariadb_running: supervisor::port_open(mariadb::PORT),
        postgres_running: supervisor::port_open(postgres::PORT),
        mailpit_smtp_port: cfg.mailpit.smtp_port,
        mailpit_running: supervisor::port_open(cfg.mailpit.smtp_port),
        composer_installed: paths::composer_phar().is_file(),
        site,
    })
}

async fn query(state: &AppState, name: &str, request: Value) -> AppResult<Value> {
    let app = app_for(state, name)?;
    blocking(move || laravel::query(&app, &request)).await
}

#[tauri::command]
pub async fn site_overview(name: String, state: State<'_, AppState>) -> AppResult<Value> {
    query(&state, &name, json!({ "op": "overview" })).await
}

#[tauri::command]
pub async fn site_tables(name: String, state: State<'_, AppState>) -> AppResult<Value> {
    query(&state, &name, json!({ "op": "tables" })).await
}

/// One page of a table. `request` holds table, page, perPage, search, sort,
/// direction and filters.
#[tauri::command]
pub async fn site_rows(name: String, mut request: Value, state: State<'_, AppState>) -> AppResult<Value> {
    request["op"] = json!("rows");
    query(&state, &name, request).await
}

#[tauri::command]
pub async fn site_update_cell(
    name: String,
    table: String,
    key: Value,
    column: String,
    value: Value,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    query(&state, &name, json!({ "op": "updateCell", "table": table, "key": key, "column": column, "value": value })).await
}

#[tauri::command]
pub async fn site_delete_row(name: String, table: String, key: Value, state: State<'_, AppState>) -> AppResult<Value> {
    query(&state, &name, json!({ "op": "deleteRow", "table": table, "key": key })).await
}

#[tauri::command]
pub async fn site_config(name: String, state: State<'_, AppState>) -> AppResult<Value> {
    query(&state, &name, json!({ "op": "config" })).await
}

#[tauri::command]
pub async fn site_routes(name: String, state: State<'_, AppState>) -> AppResult<Value> {
    query(&state, &name, json!({ "op": "routes" })).await
}

fn env_path(state: &AppState, name: &str) -> AppResult<PathBuf> {
    let cfg = state.config.lock().unwrap();
    let site = cfg
        .sites
        .iter()
        .find(|s| s.name == name)
        .ok_or_else(|| AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada.")))?;
    Ok(PathBuf::from(&site.path).join(".env"))
}

#[tauri::command]
pub fn site_env(name: String, state: State<AppState>) -> AppResult<Vec<EnvEntry>> {
    let path = env_path(&state, &name)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(laravel::parse_env(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

/// Set values in `.env` (creating it from `.env.example` when missing). The
/// site's Tinker session ends so the next run reads the new values, and a
/// cached config is cleared for the same reason.
#[tauri::command]
pub async fn site_env_set(
    name: String,
    values: Vec<(String, String)>,
    state: State<'_, AppState>,
) -> AppResult<Vec<EnvEntry>> {
    for (key, _) in &values {
        laravel::validate_env_key(key)?;
    }
    let path = env_path(&state, &name)?;
    let app = app_for(&state, &name).ok();
    state.tinker.end(&name);
    blocking(move || {
        let mut text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                std::fs::read_to_string(path.with_file_name(".env.example")).unwrap_or_default()
            }
            Err(e) => return Err(e.into()),
        };
        for (key, value) in &values {
            text = laravel::set_env(&text, key, value);
        }
        std::fs::write(&path, &text)?;
        if let Some(app) = app {
            if app.is_laravel() && app.path.join("bootstrap").join("cache").join("config.php").is_file() {
                let _ = laravel::artisan_command(&app, &["config:clear".into()]).and_then(|mut c| {
                    c.output()?;
                    Ok(())
                });
            }
        }
        Ok(laravel::parse_env(&text))
    })
    .await
}

// ------------------------------------------------------------------- Open --

fn env_pairs(project: &Path) -> Vec<(String, String)> {
    std::fs::read_to_string(project.join(".env"))
        .map(|t| laravel::parse_env(&t).into_iter().map(|e| (e.key, e.value)).collect())
        .unwrap_or_default()
}

/// Where the site can be opened: editors and terminals found on this
/// computer, database tools that fit its .env, and phpMyAdmin when Zefaro
/// serves it.
fn open_targets(state: &AppState, name: &str) -> AppResult<(PathBuf, Option<apps::Database>, Vec<apps::ExternalApp>)> {
    let (project, phpmyadmin) = {
        let cfg = state.config.lock().unwrap();
        let site = cfg
            .sites
            .iter()
            .find(|s| s.name == name)
            .ok_or_else(|| AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada.")))?;
        (PathBuf::from(&site.path), cfg.phpmyadmin)
    };
    let db = apps::database(&project, &env_pairs(&project));
    let mut list: Vec<apps::ExternalApp> = apps::detect()
        .into_iter()
        .filter(|a| match a.id.as_str() {
            "heidisql" => db.is_some(),
            "sqlitebrowser" => matches!(db, Some(apps::Database::Sqlite { .. })),
            _ => true,
        })
        .collect();
    if phpmyadmin && matches!(db, Some(apps::Database::Mysql { .. })) {
        list.push(apps::ExternalApp { id: "phpmyadmin".into(), name: "phpMyAdmin".into(), kind: "database".into(), exe: PathBuf::new() });
    }
    list.push(apps::ExternalApp { id: "explorer".into(), name: "File Explorer".into(), kind: "folder".into(), exe: PathBuf::new() });
    Ok((project, db, list))
}

#[tauri::command]
pub async fn site_open_targets(name: String, state: State<'_, AppState>) -> AppResult<Vec<apps::ExternalApp>> {
    let (_, _, list) = open_targets(&state, &name)?;
    Ok(list)
}

/// Open the site in one of the programs from `site_open_targets`.
#[tauri::command]
pub fn site_open(name: String, target: String, app: tauri::AppHandle, state: State<AppState>) -> AppResult<()> {
    let (project, db, list) = open_targets(&state, &name)?;
    let chosen = list.into_iter().find(|a| a.id == target).ok_or_else(|| {
        AppError::msg(crate::tr!("Zefaro can't find that program any more.", "Zefaro tidak menemukan program itu lagi."))
    })?;
    let opener_error = |e: tauri_plugin_opener::Error| {
        AppError::msg(crate::tr!(format!("Windows couldn't open it: {e}"), format!("Windows tidak dapat membukanya: {e}")))
    };
    match chosen.id.as_str() {
        "explorer" => app.opener().open_path(project.display().to_string(), None::<&str>).map_err(opener_error),
        "phpmyadmin" => {
            let url = {
                let cfg = state.config.lock().unwrap();
                cfg.url_for(&format!("{}.{}", crate::engine::phpmyadmin::HOST, cfg.tld), false)
            };
            let url = match &db {
                Some(apps::Database::Mysql { name, .. }) if !name.is_empty() => {
                    format!("{url}/index.php?route=/database/structure&db={name}")
                }
                _ => url,
            };
            app.opener().open_url(url, None::<&str>).map_err(opener_error)
        }
        _ => {
            let args: Vec<std::ffi::OsString> = match (chosen.id.as_str(), &db) {
                ("heidisql", Some(db)) => apps::heidisql_args(db).into_iter().map(Into::into).collect(),
                ("sqlitebrowser", Some(apps::Database::Sqlite { file })) => vec![file.into()],
                _ => apps::folder_args(&chosen, &project),
            };
            // Terminals start with the site's PHP, Composer and Node.js first on PATH.
            let php = app_for(&state, &name).map(|a| a.php).unwrap_or_default();
            let path = if php.is_empty() { std::env::var_os("PATH").unwrap_or_default() } else { laravel::tool_path(&php) };
            apps::launch(&chosen, &project, args, &path)
        }
    }
}

// ------------------------------------------------------------------- Logs --

fn project_of(state: &AppState, name: &str) -> AppResult<PathBuf> {
    let cfg = state.config.lock().unwrap();
    cfg.sites
        .iter()
        .find(|s| s.name == name)
        .map(|s| PathBuf::from(&s.path))
        .ok_or_else(|| AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada.")))
}

/// The app's log files (storage/logs), newest first.
#[tauri::command]
pub fn site_logs(name: String, state: State<AppState>) -> AppResult<Vec<applog::AppLogFile>> {
    Ok(applog::list(&project_of(&state, &name)?))
}

#[tauri::command]
pub async fn site_log_read(name: String, file: String, state: State<'_, AppState>) -> AppResult<applog::AppLog> {
    let project = project_of(&state, &name)?;
    blocking(move || applog::read(&project, &file)).await
}

#[tauri::command]
pub fn site_log_clear(name: String, file: String, state: State<AppState>) -> AppResult<()> {
    applog::clear(&project_of(&state, &name)?, &file)
}

// ----------------------------------------------------------------- Tinker --

/// Run code in the site's session, starting it first when needed. The answer
/// says whether the session is new (`started`), so earlier variables are gone.
#[tauri::command]
pub async fn tinker_eval(name: String, code: String, rollback: bool, state: State<'_, AppState>) -> AppResult<Value> {
    let app = app_for(&state, &name)?;
    // A session for another folder or PHP line, or one that ended, is replaced.
    let (session, started) = match state.tinker.current(&name).filter(|s| s.app == app && s.is_alive()) {
        Some(s) => (s, false),
        None => {
            let fresh = blocking(move || laravel::Session::start(app).map(Arc::new)).await?;
            state.tinker.adopt(&name, fresh.clone());
            (fresh, true)
        }
    };
    let laravel = session.laravel.clone();
    let mut reply = blocking(move || session.eval(&code, rollback)).await?;
    if reply.get("ended").and_then(Value::as_bool) == Some(true) {
        state.tinker.end(&name);
    }
    reply["started"] = json!(started);
    reply["laravel"] = json!(laravel);
    Ok(reply)
}

/// Forget the session's variables: the next run starts a new process.
#[tauri::command]
pub fn tinker_reset(name: String, state: State<AppState>) {
    state.tinker.end(&name);
}

/// Stop code that's still running (the session ends with it).
#[tauri::command]
pub fn tinker_stop(name: String, state: State<AppState>) {
    if let Some(s) = state.tinker.current(&name) {
        s.stop();
    }
}

// ---------------------------------------------------------------- Artisan --

#[tauri::command]
pub async fn artisan_commands(name: String, state: State<'_, AppState>) -> AppResult<Vec<ArtisanCommand>> {
    let app = app_for(&state, &name)?;
    blocking(move || laravel::artisan_list(&app)).await
}

/// Run `php artisan …` or `composer …` in the site's folder as a job.
/// Arguments go to the program as they are, never through a shell.
#[tauri::command]
pub fn site_job_run(name: String, tool: String, args: Vec<String>, state: State<AppState>) -> AppResult<SiteJob> {
    let app = app_for(&state, &name)?;
    let (cmd, display) = match tool.as_str() {
        "artisan" => (laravel::artisan_command(&app, &args)?, "php artisan"),
        "composer" => (laravel::composer_command(&app, &args)?, "composer"),
        _ => return Err(AppError::msg("Unknown tool.")),
    };
    let shown = std::iter::once(display.to_owned())
        .chain(args.iter().map(|a| if a.contains(' ') || a.is_empty() { format!("\"{a}\"") } else { a.clone() }))
        .collect::<Vec<_>>()
        .join(" ");
    state.site_jobs.spawn(&name, shown, cmd)
}

#[tauri::command]
pub fn site_job_output(id: u64, since: usize, state: State<AppState>) -> Option<JobOutput> {
    state.site_jobs.output(id, since)
}

#[tauri::command]
pub fn site_jobs(name: String, state: State<AppState>) -> Vec<SiteJob> {
    state.site_jobs.list(&name)
}

#[tauri::command]
pub fn site_job_stop(id: u64, state: State<AppState>) {
    state.site_jobs.stop(id);
}

// ---------------------------------------------------------------- Workers --

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkerStatus {
    #[serde(flatten)]
    pub worker: Worker,
    /// "stopped" | "starting" | "running" | "failed"
    pub state: String,
    pub message: Option<String>,
    pub pid: Option<u32>,
    /// For the Logs page and `tail_log`.
    pub log_id: String,
}

fn status_of(state: &AppState, w: &Worker) -> WorkerStatus {
    let status = state.supervisor.status(&laravel::worker_service_id(&w.id));
    let (label, message) = match status.health {
        Health::Stopped => ("stopped", None),
        Health::Starting => ("starting", None),
        Health::Running => ("running", None),
        Health::Failed(reason) => ("failed", Some(reason)),
    };
    WorkerStatus {
        worker: w.clone(),
        state: label.into(),
        message,
        pid: status.pid,
        log_id: laravel::worker_log_id(w),
    }
}

#[tauri::command]
pub fn workers_list(site: String, state: State<AppState>) -> Vec<WorkerStatus> {
    let workers: Vec<Worker> =
        state.config.lock().unwrap().workers.iter().filter(|w| w.site == site).cloned().collect();
    workers.iter().map(|w| status_of(&state, w)).collect()
}

/// Add a worker (empty id) or change one. A running worker restarts with the
/// new command.
#[tauri::command]
pub async fn worker_save(worker: Worker, state: State<'_, AppState>) -> AppResult<WorkerStatus> {
    let mut worker = worker;
    worker.label = worker.label.trim().to_owned();
    worker.command = worker.command.trim().to_owned();
    if worker.label.is_empty() || worker.command.is_empty() {
        return Err(AppError::msg(crate::tr!(
            "Give the worker a name and a command.",
            "Isi nama dan perintah worker."
        )));
    }
    let (snapshot, spec, restart) = {
        let mut cfg = state.config.lock().unwrap();
        if !cfg.sites.iter().any(|s| s.name == worker.site) {
            return Err(AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada.")));
        }
        if worker.id.is_empty() {
            let taken: Vec<String> = cfg.workers.iter().map(|w| w.id.clone()).collect();
            worker.id = laravel::new_worker_id(&format!("{} {}", worker.site, worker.label), &taken);
            cfg.workers.push(worker.clone());
        } else {
            let slot = cfg.workers.iter_mut().find(|w| w.id == worker.id).ok_or_else(|| {
                AppError::msg(crate::tr!("That worker no longer exists.", "Worker itu sudah tidak ada."))
            })?;
            *slot = worker.clone();
        }
        let spec = laravel::worker_spec(&cfg, &worker)?;
        let restart = state.supervisor.is_running(&spec.id);
        (cfg.clone(), spec, restart)
    };
    let _ = crate::config::save(&snapshot);
    if restart {
        let sup = state.supervisor.clone();
        blocking(move || sup.restart(spec).map(|_| ())).await?;
    }
    Ok(status_of(&state, &worker))
}

#[tauri::command]
pub async fn worker_remove(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let sup = state.supervisor.clone();
    let service = laravel::worker_service_id(&id);
    blocking(move || sup.stop(&service)).await?;
    let snapshot = {
        let mut cfg = state.config.lock().unwrap();
        cfg.workers.retain(|w| w.id != id);
        cfg.clone()
    };
    let _ = crate::config::save(&snapshot);
    Ok(())
}

fn find_worker(state: &AppState, id: &str) -> AppResult<(Worker, supervisor::Spec)> {
    let cfg = state.config.lock().unwrap();
    let worker = cfg
        .workers
        .iter()
        .find(|w| w.id == id)
        .cloned()
        .ok_or_else(|| AppError::msg(crate::tr!("That worker no longer exists.", "Worker itu sudah tidak ada.")))?;
    let spec = laravel::worker_spec(&cfg, &worker)?;
    Ok((worker, spec))
}

#[tauri::command]
pub async fn worker_start(id: String, state: State<'_, AppState>) -> AppResult<WorkerStatus> {
    let (worker, spec) = find_worker(&state, &id)?;
    let sup = state.supervisor.clone();
    blocking(move || sup.start(spec).map(|_| ())).await?;
    Ok(status_of(&state, &worker))
}

#[tauri::command]
pub async fn worker_stop(id: String, state: State<'_, AppState>) -> AppResult<WorkerStatus> {
    let (worker, spec) = find_worker(&state, &id)?;
    let sup = state.supervisor.clone();
    blocking(move || sup.stop(&spec.id)).await?;
    Ok(status_of(&state, &worker))
}

/// Start the workers marked to start with Zefaro. Called once at launch.
pub fn autostart(cfg: &crate::config::ZefaroConfig, sup: &supervisor::Supervisor) {
    for worker in cfg.workers.iter().filter(|w| w.autostart) {
        if let Ok(spec) = laravel::worker_spec(cfg, worker) {
            let _ = sup.start(spec);
        }
    }
}

/// Stop and forget everything a site had running: workers, its Tinker
/// session and its jobs. Called when the site is unlinked.
pub fn forget_site(state: &AppState, name: &str) {
    state.tinker.end(name);
    state.site_jobs.stop_site(name);
    let ids: Vec<String> = {
        let mut cfg = state.config.lock().unwrap();
        let ids = cfg.workers.iter().filter(|w| w.site == name).map(|w| w.id.clone()).collect();
        cfg.workers.retain(|w| w.site != name);
        ids
    };
    for id in ids {
        let _ = state.supervisor.stop(&laravel::worker_service_id(&id));
    }
}
