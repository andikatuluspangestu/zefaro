//! Databases page (gear on the MariaDB card): list, create, drop, and export or
//! import databases of any size as a background job with progress and cancel.

use super::blocking;
use crate::engine::{dbio, mariadb, paths, supervisor};
use crate::error::{AppError, AppResult};
use crate::model::DbJob;
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DbOverview {
    /// MariaDB answers on its port; nothing else works without it.
    pub running: bool,
    pub databases: Vec<dbio::DbInfo>,
    pub data_dir: String,
    /// Free space on the drive holding the data folder.
    pub data_free: Option<u64>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn require_running() -> AppResult<()> {
    if supervisor::port_open(mariadb::PORT) {
        Ok(())
    } else {
        Err(AppError::msg(crate::tr!(
            "Start MariaDB first (Services → MariaDB).",
            "Mulai MariaDB terlebih dahulu (Layanan → MariaDB)."
        )))
    }
}

fn busy_with(state: &AppState) -> Option<DbJob> {
    state.db_job.lock().unwrap().clone().filter(|j| j.state == "running")
}

fn ensure_idle(state: &AppState, db: Option<&str>) -> AppResult<()> {
    match busy_with(state) {
        Some(j) if db.is_none() || db == Some(j.database.as_str()) => {
            let kind = match j.kind.as_str() {
                "export" => "ekspor",
                "import" => "impor",
                other => other,
            };
            Err(AppError::msg(crate::tr!(
                format!("Wait for the {} of {} to finish (or cancel it).", j.kind, j.database),
                format!("Tunggu sampai {kind} {} selesai (atau batalkan).", j.database)
            )))
        }
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn db_overview() -> AppResult<DbOverview> {
    blocking(|| {
        let running = supervisor::port_open(mariadb::PORT);
        let data = mariadb::Layout::standard().data;
        Ok(DbOverview {
            databases: if running { dbio::list(&dbio::Client::standard())? } else { Vec::new() },
            running,
            data_free: dbio::disk_free(&data),
            data_dir: data.display().to_string(),
        })
    })
    .await
}

#[tauri::command]
pub async fn db_create(name: String) -> AppResult<()> {
    blocking(move || {
        require_running()?;
        let c = dbio::Client::standard();
        if dbio::exists(&c, &name)? {
            return Err(AppError::msg(crate::tr!(
                format!("A database named {name} already exists."),
                format!("Database bernama {name} sudah ada.")
            )));
        }
        dbio::create_db(&c, &name)
    })
    .await
}

#[tauri::command]
pub async fn db_drop(state: State<'_, AppState>, name: String) -> AppResult<()> {
    ensure_idle(&state, Some(&name))?;
    blocking(move || {
        require_running()?;
        dbio::drop_db(&dbio::Client::standard(), &name)
    })
    .await
}

/// A database name suggested by a dump's file name.
#[tauri::command]
pub fn db_name_from_file(path: String) -> String {
    dbio::name_from_file(Path::new(&path))
}

/// Where a dump came from and which databases it holds. Reads the whole file.
#[tauri::command]
pub async fn db_scan_dump(path: String) -> AppResult<dbio::DumpInfo> {
    blocking(move || dbio::scan(Path::new(&path))).await
}

/// Free space on the drive that holds `path`.
#[tauri::command]
pub fn disk_free(path: String) -> Option<u64> {
    dbio::disk_free(Path::new(&path))
}

#[tauri::command]
pub fn db_job(state: State<AppState>) -> Option<DbJob> {
    state.db_job.lock().unwrap().clone()
}

#[tauri::command]
pub fn db_job_cancel(state: State<AppState>) {
    state.db_cancel.store(true, Ordering::Relaxed);
}

/// Forget a finished job (the page stops showing its result).
#[tauri::command]
pub fn db_job_dismiss(state: State<AppState>) {
    let mut job = state.db_job.lock().unwrap();
    if job.as_ref().is_some_and(|j| j.state != "running") {
        *job = None;
    }
}

/// Run `work` on a thread as the current job, updating it as bytes flow.
fn spawn_job(
    state: &AppState,
    job: DbJob,
    work: impl FnOnce(&dyn Fn(u64)) -> AppResult<Option<u64>> + Send + 'static,
) -> DbJob {
    let slot: Arc<Mutex<Option<DbJob>>> = state.db_job.clone();
    state.db_cancel.store(false, Ordering::Relaxed);
    *slot.lock().unwrap() = Some(job.clone());
    std::thread::spawn(move || {
        let progress = {
            let slot = slot.clone();
            move |done: u64| {
                if let Some(j) = slot.lock().unwrap().as_mut() {
                    j.done = done;
                }
            }
        };
        let result = work(&progress);
        if let Some(j) = slot.lock().unwrap().as_mut() {
            j.ended_ms = Some(now_ms());
            match result {
                Ok(size) => {
                    j.state = "done".into();
                    j.result_size = size;
                    if let Some(total) = j.total.filter(|_| j.kind == "import") {
                        j.done = total;
                    }
                }
                Err(e) if e.to_string() == dbio::cancelled().to_string() => j.state = "cancelled".into(),
                Err(e) => {
                    j.state = "failed".into();
                    j.message = Some(e.to_string());
                }
            }
        }
    });
    job
}

/// Export `name` to `path` (`.sql`, or `.sql.gz` when `gzip`).
#[tauri::command]
pub async fn db_export(state: State<'_, AppState>, name: String, path: String, gzip: bool) -> AppResult<DbJob> {
    ensure_idle(&state, None)?;
    let (n, c) = (name.clone(), dbio::Client::standard());
    let total = blocking(move || {
        require_running()?;
        if !dbio::exists(&c, &n)? {
            return Err(AppError::msg(crate::tr!(
                format!("There's no database named {n}."),
                format!("Tidak ada database bernama {n}.")
            )));
        }
        dbio::size_of(&c, &n)
    })
    .await?;
    let dest = PathBuf::from(&path);
    let job = DbJob {
        kind: "export".into(),
        database: name.clone(),
        file: path,
        state: "running".into(),
        done: 0,
        total: Some(total),
        started_ms: now_ms(),
        ended_ms: None,
        message: None,
        result_size: None,
    };
    let cancel = state.db_cancel.clone();
    Ok(spawn_job(&state, job, move |progress| {
        dbio::export(&dbio::Client::standard(), &name, &dest, gzip, &cancel, progress).map(Some)
    }))
}

/// Import the dump at `path` (`.sql` or gzip) into `name`. With `replace`, an
/// existing database of that name is dropped first; otherwise it must not exist.
/// `from` picks one database out of a dump that holds several.
#[tauri::command]
pub async fn db_import(
    state: State<'_, AppState>,
    path: String,
    name: String,
    replace: bool,
    from: Option<String>,
) -> AppResult<DbJob> {
    ensure_idle(&state, None)?;
    let src = PathBuf::from(&path);
    let (n, s) = (name.clone(), src.clone());
    let total = blocking(move || {
        require_running()?;
        let size = std::fs::metadata(&s)
            .map_err(|e| {
                let file = s.display();
                AppError::msg(crate::tr!(format!("Can't read {file}: {e}"), format!("Tidak dapat membaca {file}: {e}")))
            })?
            .len();
        let c = dbio::Client::standard();
        if dbio::exists(&c, &n)? {
            if !replace {
                return Err(AppError::msg(crate::tr!(
                    format!("A database named {n} already exists."),
                    format!("Database bernama {n} sudah ada.")
                )));
            }
            dbio::drop_db(&c, &n)?;
        }
        dbio::create_db(&c, &n)?;
        Ok(size)
    })
    .await?;
    let job = DbJob {
        kind: "import".into(),
        database: name.clone(),
        file: path,
        state: "running".into(),
        done: 0,
        total: Some(total),
        started_ms: now_ms(),
        ended_ms: None,
        message: None,
        result_size: None,
    };
    let cancel = state.db_cancel.clone();
    Ok(spawn_job(&state, job, move |progress| {
        dbio::import(&dbio::Client::standard(), &name, &src, from.as_deref(), &cancel, progress).map(|_| None)
    }))
}

/// Show an exported file in Explorer.
#[tauri::command]
pub fn db_reveal(app: tauri::AppHandle, path: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(AppError::msg(crate::tr!("That file no longer exists.", "File itu sudah tidak ada.")));
    }
    app.opener()
        .reveal_item_in_dir(&p)
        .map_err(|e| {
            AppError::msg(crate::tr!(
                format!("Couldn't open Explorer: {e}"),
                format!("Tidak dapat membuka Explorer: {e}")
            ))
        })
}

/// A default folder for exports: the user's Documents, else Zefaro's folder.
#[tauri::command]
pub fn db_default_dir() -> String {
    dirs::document_dir().unwrap_or_else(paths::bin_dir).display().to_string()
}
