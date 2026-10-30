//! Back up and restore Zefaro (Settings page): the sites and settings, and the
//! MariaDB databases, in one zip file. Both run as a background job with
//! progress and cancel, polled with `backup_job` like the database export.

use super::{blocking, services};
use crate::config::{self, ZefaroConfig};
use crate::engine::backup::{self, Contents, Step};
use crate::engine::dbio::Client;
use crate::engine::{mariadb, nginx, paths};
use crate::error::{AppError, AppResult};
use crate::model::BackupJob;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

type Slot = Arc<Mutex<Option<BackupJob>>>;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn update(slot: &Slot, f: impl FnOnce(&mut BackupJob)) {
    if let Some(job) = slot.lock().unwrap().as_mut() {
        f(job);
    }
}

fn progress(slot: &Slot, step: Step) {
    update(slot, |j| {
        j.phase = step.phase.to_owned();
        j.current = step.name.map(str::to_owned);
        j.done = step.done;
        j.total = step.total;
    });
}

/// Begin a job, unless one is still running.
fn begin(state: &AppState, kind: &str, file: &Path) -> AppResult<(Slot, Arc<std::sync::atomic::AtomicBool>)> {
    let mut slot = state.backup_job.lock().unwrap();
    if slot.as_ref().is_some_and(|j| j.state == "running") {
        return Err(AppError::msg(crate::tr!(
            "A backup or restore is already running.",
            "Pencadangan atau pemulihan sedang berjalan."
        )));
    }
    state.backup_cancel.store(false, Ordering::Relaxed);
    *slot = Some(BackupJob {
        kind: kind.to_owned(),
        state: "running".into(),
        file: file.to_string_lossy().into_owned(),
        phase: "preparing".into(),
        current: None,
        done: 0,
        total: 0,
        message: None,
        size: None,
        loaded: Vec::new(),
        skipped: Vec::new(),
        settings_restored: false,
        has_secured_sites: false,
        started_ms: now_ms(),
        ended_ms: None,
    });
    drop(slot);
    Ok((state.backup_job.clone(), state.backup_cancel.clone()))
}

/// Close the job with how it ended: done, cancelled, or failed with the reason.
fn finish(slot: &Slot, result: AppResult<()>) {
    update(slot, |j| {
        j.ended_ms = Some(now_ms());
        j.phase = "finishing".into();
        match result {
            Ok(()) => j.state = "done".into(),
            Err(e) if e.to_string() == crate::engine::dbio::cancelled().to_string() => j.state = "cancelled".into(),
            Err(e) => {
                j.state = "failed".into();
                j.message = Some(e.to_string());
            }
        }
    });
}

/// The MariaDB client, with MariaDB started if it wasn't running. The second
/// value says whether this started it (so it can be stopped again).
/// `None` when MariaDB isn't installed and `install` is false.
fn mariadb_client(cfg: &ZefaroConfig, state: &AppState, install: bool) -> AppResult<Option<(Client, bool)>> {
    if !install && !mariadb::installed(&mariadb::Layout::standard()) {
        return Ok(None);
    }
    let started_here = !state.supervisor.is_running(mariadb::SERVICE_ID);
    if started_here {
        services::start(cfg, &state.supervisor, mariadb::SERVICE_ID)?;
    }
    Ok(Some((Client::standard(), started_here)))
}

/// The zip's sibling folder for the dumps that are being added or loaded.
fn scratch() -> PathBuf {
    paths::downloads_dir().join("backup-scratch")
}

/// Look inside a backup file, to show what restoring it would do.
#[tauri::command]
pub async fn backup_inspect(path: String) -> AppResult<Contents> {
    blocking(move || backup::inspect(Path::new(&path))).await
}

/// Make a backup at `path`; with `databases`, every MariaDB database goes in.
#[tauri::command]
pub fn backup_start(app: AppHandle, state: State<AppState>, path: String, databases: bool) -> AppResult<()> {
    let dest = PathBuf::from(path);
    let (slot, cancel) = begin(&state, "backup", &dest)?;
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        let mut started_here = false;
        let result = (|| -> AppResult<()> {
            let client = if databases {
                match mariadb_client(&cfg, &state, false)? {
                    Some((client, started)) => {
                        started_here = started;
                        Some(client)
                    }
                    None => {
                        update(&slot, |j| {
                            j.message = Some(crate::tr!(
                                "MariaDB isn't installed, so no databases were included.".to_owned(),
                                "MariaDB belum terpasang, jadi tidak ada database yang disertakan.".to_owned()
                            ));
                        });
                        None
                    }
                }
            } else {
                None
            };
            let manifest = backup::create(&cfg, client.as_ref(), &dest, &scratch(), &cancel, |s| progress(&slot, s))?;
            update(&slot, |j| {
                j.size = std::fs::metadata(&dest).ok().map(|m| m.len());
                j.loaded = manifest.databases.clone();
            });
            Ok(())
        })();
        if started_here {
            let _ = state.supervisor.stop(mariadb::SERVICE_ID);
        }
        finish(&slot, result);
    });
    Ok(())
}

/// Restore from the backup at `path`: the databases (never over one that
/// exists) and/or the sites and settings.
#[tauri::command]
pub fn restore_start(app: AppHandle, state: State<AppState>, path: String, settings: bool, databases: bool) -> AppResult<()> {
    let src = PathBuf::from(path);
    // Refuse a file that isn't a backup before anything starts.
    let contents = backup::inspect(&src)?;
    let (slot, cancel) = begin(&state, "restore", &src)?;
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        let mut started_here = false;
        let result = (|| -> AppResult<()> {
            // Databases first: if one fails or is cancelled, the settings stay as they were.
            if databases && !contents.databases.is_empty() {
                let (client, started) = mariadb_client(&cfg, &state, true)?.expect("installs when missing");
                started_here = started;
                let restored = backup::restore_databases(&src, &client, &scratch(), &cancel, |s| progress(&slot, s))?;
                update(&slot, |j| {
                    j.loaded = restored.loaded;
                    j.skipped = restored.skipped;
                });
            }
            if settings {
                if cancel.load(Ordering::Relaxed) {
                    return Err(crate::engine::dbio::cancelled());
                }
                progress(&slot, Step { phase: "settings", name: None, done: 0, total: 0 });
                let restored = backup::read_settings(&src)?;
                apply_settings(&state, restored)?;
                let secured = state.config.lock().unwrap().sites.iter().any(|s| s.secured);
                update(&slot, |j| {
                    j.settings_restored = true;
                    j.has_secured_sites = secured;
                });
            }
            Ok(())
        })();
        if started_here {
            let _ = state.supervisor.stop(mariadb::SERVICE_ID);
        }
        finish(&slot, result);
    });
    Ok(())
}

/// Replace the sites and settings. What was there is copied next to
/// config.json first, so a restore can be taken back by hand.
fn apply_settings(state: &AppState, restored: ZefaroConfig) -> AppResult<()> {
    let current = config::config_path();
    if current.is_file() {
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = std::fs::copy(&current, current.with_file_name(format!("config.before-restore-{secs}.json")));
    }
    *state.config.lock().unwrap() = restored.clone();
    config::save(&restored)?;
    // nginx serves the restored sites now, if it is running.
    let _ = nginx::sync(&restored, &state.supervisor);
    Ok(())
}

#[tauri::command]
pub fn backup_job(state: State<AppState>) -> Option<BackupJob> {
    state.backup_job.lock().unwrap().clone()
}

/// Stop the running backup or restore at its next step.
#[tauri::command]
pub fn backup_cancel(state: State<AppState>) {
    state.backup_cancel.store(true, Ordering::Relaxed);
}

/// Forget a finished job (closes its panel).
#[tauri::command]
pub fn backup_dismiss(state: State<AppState>) {
    let mut slot = state.backup_job.lock().unwrap();
    if slot.as_ref().is_some_and(|j| j.state != "running") {
        *slot = None;
    }
}
