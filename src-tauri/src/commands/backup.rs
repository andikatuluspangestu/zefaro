//! Back up and restore Zefaro (Settings page): the sites and settings, and the
//! databases of MariaDB, MySQL and PostgreSQL, in one zip file. Both run as a background job with
//! progress and cancel, polled with `backup_job` like the database export.

use super::{blocking, services};
use crate::config::{self, BackupSchedule, ZefaroConfig};
use crate::engine::backup::{self, Contents, Servers, Step};
use crate::engine::backupsched::{self, Record};
use crate::engine::dbio::{Client, Engine};
use crate::engine::{nginx, paths};
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
        j.server = step.server.map(|e| e.name().to_owned());
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
        server: None,
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

/// Zefaro's own servers, for a backup or restore. A server that wasn't
/// running is started for it and stopped again once its databases are done,
/// so the job never leaves more running than it found.
struct OwnServers<'a> {
    cfg: &'a ZefaroConfig,
    state: &'a AppState,
    /// A restore installs a server its databases need; a backup skips one
    /// that isn't installed.
    install: bool,
    started: Vec<Engine>,
}

impl Servers for OwnServers<'_> {
    fn open(&mut self, engine: Engine) -> AppResult<Option<Client>> {
        let client = Client::of(engine);
        if !self.install && !client.installed() {
            return Ok(None);
        }
        if !self.state.supervisor.is_running(engine.service_id()) {
            services::start(self.cfg, &self.state.supervisor, engine.service_id())?;
            self.started.push(engine);
        }
        crate::engine::dbio::wait_ready(&client, std::time::Duration::from_secs(30))?;
        Ok(Some(client))
    }

    fn close(&mut self, engine: Engine) {
        if let Some(i) = self.started.iter().position(|&e| e == engine) {
            self.started.remove(i);
            let _ = self.state.supervisor.stop(engine.service_id());
        }
    }
}

impl Drop for OwnServers<'_> {
    /// One that failed to start half-way is stopped too.
    fn drop(&mut self) {
        for e in std::mem::take(&mut self.started) {
            let _ = self.state.supervisor.stop(e.service_id());
        }
    }
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

/// Make a backup at `path`; with `databases`, every database of each
/// installed server (MariaDB, MySQL, PostgreSQL) goes in.
#[tauri::command]
pub fn backup_start(app: AppHandle, path: String, databases: bool) -> AppResult<()> {
    start_backup(&app, PathBuf::from(path), databases)
}

/// Start the backup job; it runs on its own thread.
fn start_backup(app: &AppHandle, dest: PathBuf, databases: bool) -> AppResult<()> {
    let (slot, cancel) = begin(&app.state::<AppState>(), "backup", &dest)?;
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        let result = (|| -> AppResult<()> {
            let mut servers = OwnServers { cfg: &cfg, state: &state, install: false, started: Vec::new() };
            let none_installed = backup::ENGINES.iter().all(|&e| !Client::of(e).installed());
            if databases && none_installed {
                update(&slot, |j| {
                    j.message = Some(crate::tr!(
                        "No database server is installed, so no databases were included.".to_owned(),
                        "Belum ada server database yang terpasang, jadi tidak ada database yang disertakan.".to_owned()
                    ));
                });
            }
            let with: Option<&mut dyn Servers> = if databases && !none_installed { Some(&mut servers) } else { None };
            let manifest = backup::create(&cfg, with, &dest, &scratch(), &cancel, |s| progress(&slot, s))?;
            update(&slot, |j| {
                j.size = std::fs::metadata(&dest).ok().map(|m| m.len());
                j.loaded = manifest.labels();
            });
            Ok(())
        })();
        finish(&slot, result);
    });
    Ok(())
}

/// Restore from the backup at `path`: the databases, each into its own
/// server (never over one that exists), and/or the sites and settings.
#[tauri::command]
pub fn restore_start(app: AppHandle, state: State<AppState>, path: String, settings: bool, databases: bool) -> AppResult<()> {
    let src = PathBuf::from(path);
    // Refuse a file that isn't a backup before anything starts.
    let contents = backup::inspect(&src)?;
    let (slot, cancel) = begin(&state, "restore", &src)?;
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        let result = (|| -> AppResult<()> {
            // Databases first: if one fails or is cancelled, the settings stay as they were.
            if databases && !contents.databases.is_empty() {
                let mut servers = OwnServers { cfg: &cfg, state: &state, install: true, started: Vec::new() };
                let restored = backup::restore_databases(&src, &mut servers, &scratch(), &cancel, |s| progress(&slot, s))?;
                update(&slot, |j| {
                    j.loaded = restored.loaded;
                    j.skipped = restored.skipped;
                });
            }
            if settings {
                if cancel.load(Ordering::Relaxed) {
                    return Err(crate::engine::dbio::cancelled());
                }
                progress(&slot, Step { phase: "settings", server: None, name: None, done: 0, total: 0 });
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

// ---------------------------------------------------------------- schedule --

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleView {
    pub schedule: BackupSchedule,
    /// The folder the files go to, with the default filled in.
    pub folder: String,
    /// When the next one runs, while the schedule is on.
    pub next_ms: Option<u64>,
    pub last: Record,
}

fn schedule_view(schedule: BackupSchedule) -> ScheduleView {
    let next_ms = schedule
        .enabled
        .then(|| backupsched::next_slot(&schedule, backupsched::now_local()))
        .flatten()
        .map(backupsched::unix_ms);
    ScheduleView {
        folder: backupsched::folder(&schedule).display().to_string(),
        schedule,
        next_ms,
        last: backupsched::load(),
    }
}

#[tauri::command]
pub fn backup_schedule(state: State<AppState>) -> ScheduleView {
    schedule_view(state.config.lock().unwrap().backup_schedule.clone())
}

/// Save the schedule. Slots that already passed today don't count, so turning
/// it on never starts a backup right away.
#[tauri::command]
pub fn backup_schedule_save(state: State<AppState>, schedule: BackupSchedule) -> AppResult<ScheduleView> {
    backupsched::validate(&schedule)?;
    let mut schedule = schedule;
    schedule.folder = schedule.folder.trim().to_owned();
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.backup_schedule = schedule.clone();
        config::save(&cfg)?;
    }
    let mut record = backupsched::load();
    record.anchor_ms = now_ms();
    backupsched::save(&record)?;
    Ok(schedule_view(schedule))
}

/// Once a minute: start the scheduled backup when one is due, wait for it,
/// then delete the oldest of its files beyond the count to keep. A backup or
/// restore already running makes it wait for the next minute.
pub fn scheduler(app: AppHandle) {
    std::thread::spawn(move || loop {
        // The first look comes a minute after Zefaro starts, after its services.
        std::thread::sleep(std::time::Duration::from_secs(60));
        let schedule = app.state::<AppState>().config.lock().unwrap().backup_schedule.clone();
        let now = backupsched::now_local();
        let mut record = backupsched::load();
        if !backupsched::is_due(&schedule, now, &record) {
            continue;
        }
        let folder = backupsched::folder(&schedule);
        let dest = folder.join(backupsched::file_name(now));
        let started = std::fs::create_dir_all(&folder).map_err(AppError::from).and_then(|()| start_backup(&app, dest.clone(), schedule.databases));
        let job = match started {
            Ok(()) => wait_for(&app, &dest),
            Err(e) if is_busy(&app) => {
                let _ = e;
                continue;
            }
            Err(e) => Some(BackupJob { state: "failed".into(), message: Some(e.to_string()), ..empty_job(&dest) }),
        };
        let job = job.unwrap_or_else(|| BackupJob { state: "failed".into(), ..empty_job(&dest) });
        record.last_ms = Some(now_ms());
        record.last_file = Some(dest.display().to_string());
        record.last_state = Some(job.state.clone());
        record.last_message = job.message.clone();
        record.pruned = 0;
        if job.state == "done" {
            record.pruned = backupsched::prune(&folder, schedule.keep).map(|gone| gone.len() as u32).unwrap_or(0);
        } else if job.state == "failed" {
            crate::notify::send(
                &app,
                crate::notify::Notice {
                    title: crate::tr!("The scheduled backup failed".to_owned(), "Pencadangan terjadwal gagal".to_owned()),
                    body: job.message.clone().unwrap_or_default(),
                    tone: "error",
                    site: None,
                    view: None,
                },
            );
        }
        let _ = backupsched::save(&record);
    });
}

fn is_busy(app: &AppHandle) -> bool {
    app.state::<AppState>().backup_job.lock().unwrap().as_ref().is_some_and(|j| j.state == "running")
}

/// Wait for the job writing `dest` to end, and return how it ended.
fn wait_for(app: &AppHandle, dest: &Path) -> Option<BackupJob> {
    let file = dest.to_string_lossy().into_owned();
    loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let job = app.state::<AppState>().backup_job.lock().unwrap().clone();
        match job {
            Some(j) if j.file == file && j.state == "running" => continue,
            Some(j) if j.file == file => return Some(j),
            _ => return None,
        }
    }
}

fn empty_job(dest: &Path) -> BackupJob {
    BackupJob {
        kind: "backup".into(),
        state: String::new(),
        file: dest.to_string_lossy().into_owned(),
        phase: String::new(),
        server: None,
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
    }
}
