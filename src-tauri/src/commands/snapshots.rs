//! Snapshots of a site's database (the site page's Data tab).

use super::blocking;
use crate::engine::snapshots::{self, Snapshot};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotsView {
    /// The database a new snapshot would take, e.g. "shop on MariaDB".
    pub target: Option<String>,
    /// Why there's none (no database, or not one of Zefaro's).
    pub problem: Option<String>,
    pub snapshots: Vec<Snapshot>,
}

fn project_of(state: &AppState, name: &str) -> AppResult<PathBuf> {
    let cfg = state.config.lock().unwrap();
    cfg.sites
        .iter()
        .find(|s| s.name == name)
        .map(|s| PathBuf::from(&s.path))
        .ok_or_else(|| AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada.")))
}

#[tauri::command]
pub fn site_snapshots(state: State<AppState>, name: String) -> AppResult<SnapshotsView> {
    let project = project_of(&state, &name)?;
    let (target, problem) = match snapshots::target_of(&project) {
        Ok(t) => (Some(t.describe(&project)), None),
        Err(e) => (None, Some(e.to_string())),
    };
    Ok(SnapshotsView { target, problem, snapshots: snapshots::list(&name) })
}

#[tauri::command]
pub async fn site_snapshot_take(state: State<'_, AppState>, name: String, label: String) -> AppResult<Snapshot> {
    let project = project_of(&state, &name)?;
    blocking(move || snapshots::take(&name, &project, &label)).await
}

#[tauri::command]
pub async fn site_snapshot_restore(state: State<'_, AppState>, name: String, id: String) -> AppResult<()> {
    project_of(&state, &name)?;
    blocking(move || snapshots::restore(&name, &id)).await
}

#[tauri::command]
pub async fn site_snapshot_delete(name: String, id: String) -> AppResult<()> {
    blocking(move || snapshots::delete(&name, &id)).await
}
