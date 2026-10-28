//! Node.js versions (list / install / activate / uninstall). The active line
//! is what the `node`, `npm` and `npx` shims in Zefaro's bin folder run.

use super::blocking;
use crate::config;
use crate::engine::{node, paths, tools};
use crate::error::{AppError, AppResult};
use crate::model::{InstallProgress, NodeVersion, NodeVersionsResponse};
use crate::state::AppState;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const RELEASES_TTL: Duration = Duration::from_secs(30 * 60);

/// Cached release list; when offline, the last list seen and `offline`.
async fn releases(state: &AppState) -> (Vec<node::Release>, bool) {
    let cached = state.node_releases.lock().unwrap().clone();
    if let Some((at, list)) = &cached {
        if at.elapsed() < RELEASES_TTL {
            return (list.clone(), false);
        }
    }
    match blocking(node::fetch_releases).await {
        Ok(list) => {
            *state.node_releases.lock().unwrap() = Some((Instant::now(), list.clone()));
            (list, false)
        }
        Err(_) => (cached.map(|(_, list)| list).unwrap_or_default(), true),
    }
}

/// Offered lines plus anything installed that's no longer offered, newest first.
fn list(releases: &[node::Release], active: &str) -> Vec<NodeVersion> {
    let installed = node::installed();
    let mut majors: Vec<String> = releases.iter().map(|r| r.major.clone()).collect();
    for m in installed.keys() {
        if !majors.contains(m) {
            majors.push(m.clone());
        }
    }
    majors.sort_by_key(|m| std::cmp::Reverse(m.parse::<u32>().unwrap_or(0)));
    majors
        .into_iter()
        .map(|major| {
            let release = releases.iter().find(|r| r.major == major);
            let installed = installed.get(&major).cloned();
            NodeVersion {
                update_available: matches!((&installed, release), (Some(i), Some(r)) if *i != r.version),
                latest: release.map(|r| r.version.clone()),
                lts: release.and_then(|r| r.lts.clone()),
                npm: release.and_then(|r| r.npm.clone()),
                is_active: installed.is_some() && major == active,
                installed,
                major,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn node_versions(state: State<'_, AppState>) -> AppResult<NodeVersionsResponse> {
    let (releases, offline) = releases(&state).await;
    let active = state.config.lock().unwrap().node_default.clone();
    let bin_on_path = blocking(|| Ok(tools::bin_on_path())).await?;
    Ok(NodeVersionsResponse {
        versions: list(&releases, &active),
        offline,
        bin_dir: paths::bin_dir().display().to_string(),
        bin_on_path,
    })
}

/// Rejects a second install/uninstall of the same line while one runs.
struct Busy<'a>(&'a AppState, String);
impl<'a> Busy<'a> {
    fn claim(state: &'a AppState, major: &str) -> AppResult<Self> {
        if !state.node_busy.lock().unwrap().insert(major.to_owned()) {
            return Err(AppError::msg(crate::tr!(
                format!("Zefaro is still working on Node.js {major}. Wait for it to finish."),
                format!("Zefaro masih memproses Node.js {major}. Tunggu sampai selesai.")
            )));
        }
        Ok(Self(state, major.to_owned()))
    }
}
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.node_busy.lock().unwrap().remove(&self.1);
    }
}

/// Make `major` active (or, with None, keep the current one if it's still
/// installed, else pick the newest installed line) and rewrite the shims.
fn settle_active(state: &AppState, prefer: Option<&str>) -> AppResult<()> {
    let snapshot = {
        let mut cfg = state.config.lock().unwrap();
        let installed = node::installed();
        let next = match prefer {
            Some(m) if installed.contains_key(m) => m.to_owned(),
            _ if installed.contains_key(&cfg.node_default) => cfg.node_default.clone(),
            _ => installed
                .keys()
                .max_by_key(|m| m.parse::<u32>().unwrap_or(0))
                .cloned()
                .unwrap_or_default(),
        };
        cfg.node_default = next;
        cfg.clone()
    };
    config::save(&snapshot)?;
    node::write_shims(Some(&snapshot.node_default).filter(|m| !m.is_empty()).map(String::as_str))
}

/// Install (or update) a line, streaming `node-install-progress` events. The
/// first installed line becomes active.
#[tauri::command]
pub async fn node_install(app: AppHandle, state: State<'_, AppState>, major: String) -> AppResult<()> {
    let (releases, _) = releases(&state).await;
    let release = releases
        .into_iter()
        .find(|r| r.major == major)
        .ok_or_else(|| {
            AppError::msg(crate::tr!(
                format!("Node.js {major} isn't available to download."),
                format!("Node.js {major} tidak tersedia untuk diunduh.")
            ))
        })?;
    let _busy = Busy::claim(&state, &major)?;
    blocking(move || {
        node::install(&release, |p: InstallProgress| {
            let _ = app.emit("node-install-progress", p);
        })
    })
    .await?;
    settle_active(&state, None)
}

#[tauri::command]
pub fn node_activate(state: State<AppState>, major: String) -> AppResult<()> {
    if !node::is_installed(&major) {
        return Err(AppError::msg(crate::tr!(
            format!("Node.js {major} isn't installed."),
            format!("Node.js {major} belum terpasang.")
        )));
    }
    settle_active(&state, Some(&major))
}

/// Remove a line. Removing the active one makes the newest remaining line active.
#[tauri::command]
pub async fn node_uninstall(state: State<'_, AppState>, major: String) -> AppResult<()> {
    let _busy = Busy::claim(&state, &major)?;
    let m = major.clone();
    blocking(move || node::uninstall(&m)).await?;
    settle_active(&state, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_offered_lines_newest_first() {
        let r = |major: &str, version: &str, lts: Option<&str>| node::Release {
            major: major.into(),
            version: version.into(),
            lts: lts.map(Into::into),
            npm: Some("11.0.0".into()),
            date: "2026-10-20".into(),
        };
        let versions = list(&[r("26", "26.12.1", None), r("24", "24.22.1", Some("Krypton"))], "24");
        let majors: Vec<&str> = versions.iter().map(|v| v.major.as_str()).collect();
        assert!(majors.starts_with(&["26", "24"]));
        assert_eq!(versions[1].lts.as_deref(), Some("Krypton"));
        // Nothing is installed in the test environment's real bin folder unless
        // the developer installed Node through Zefaro; only check the shape.
        assert!(versions.iter().all(|v| v.is_active == (v.installed.is_some() && v.major == "24")));
    }
}
