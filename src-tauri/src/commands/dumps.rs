//! The Dumps page: turn catching on or off, list what arrived, clear it.

use super::blocking;
use crate::engine::{dumps, nginx};
use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DumpsStatus {
    /// Sites send their dumps to Zefaro.
    pub enabled: bool,
    /// The receiver is running.
    pub running: bool,
}

fn status(state: &AppState) -> DumpsStatus {
    DumpsStatus {
        enabled: state.config.lock().unwrap().dumps,
        running: state.supervisor.is_running(dumps::SERVICE_ID),
    }
}

#[tauri::command]
pub fn dumps_status(state: State<AppState>) -> DumpsStatus {
    status(&state)
}

/// Start or stop the receiver, and add or remove VAR_DUMPER_FORMAT from every
/// site's nginx config.
#[tauri::command]
pub async fn dumps_set_enabled(on: bool, state: State<'_, AppState>) -> AppResult<DumpsStatus> {
    let snapshot = {
        let mut cfg = state.config.lock().unwrap();
        cfg.dumps = on;
        crate::config::save(&cfg)?;
        cfg.clone()
    };
    let sup = state.supervisor.clone();
    blocking(move || {
        if on {
            sup.start(dumps::spec(&snapshot)?)?;
        } else {
            sup.stop(dumps::SERVICE_ID)?;
        }
        nginx::sync(&snapshot, &sup)
    })
    .await?;
    Ok(status(&state))
}

/// The newest dumps first.
#[tauri::command]
pub async fn dumps_list() -> AppResult<Vec<serde_json::Value>> {
    blocking(|| Ok(dumps::read())).await
}

#[tauri::command]
pub fn dumps_clear() -> AppResult<()> {
    dumps::clear()
}
