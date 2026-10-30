//! Sharing a site through a Cloudflare tunnel: what's needed, start, stop.

use super::blocking;
use crate::engine::{nginx, tunnel};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TunnelSetup {
    /// cloudflared is downloaded.
    pub installed: bool,
    pub version: &'static str,
    pub download_bytes: u64,
}

#[tauri::command]
pub fn tunnel_setup() -> TunnelSetup {
    TunnelSetup { installed: tunnel::installed(), version: tunnel::VERSION, download_bytes: tunnel::DOWNLOAD_BYTES }
}

/// Every share, for the indicator in the top bar.
#[tauri::command]
pub fn tunnel_list(state: State<AppState>) -> Vec<tunnel::TunnelInfo> {
    state.tunnels.list()
}

/// Rewrites nginx's config with the current routes and reloads it.
fn apply_for(app: &AppHandle) -> tunnel::Apply {
    let app = app.clone();
    std::sync::Arc::new(move || {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        nginx::sync(&cfg, &state.supervisor)
    })
}

/// Share a site on the internet. Downloads cloudflared first when needed (the
/// page asked the user, with the size, before calling this). nginx must be
/// running, since it serves the site to the tunnel.
#[tauri::command]
pub async fn tunnel_start(app: AppHandle, state: State<'_, AppState>, site: String) -> AppResult<tunnel::TunnelInfo> {
    if !state.config.lock().unwrap().sites.iter().any(|s| s.name == site) {
        return Err(AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada.")));
    }
    if !state.supervisor.is_running(nginx::SERVICE_ID) {
        return Err(AppError::msg(crate::tr!(
            "Start nginx first (Services → nginx): it serves the site to the tunnel.",
            "Mulai nginx terlebih dahulu (Layanan → nginx): nginx yang menyajikan situs ke tunnel."
        )));
    }
    if !tunnel::installed() {
        blocking(tunnel::install).await?;
    }
    let (tunnels, apply) = (state.tunnels.clone(), apply_for(&app));
    blocking(move || tunnels.start(&site, apply)).await
}

/// Where a share has got to (the address arrives a few seconds after start).
#[tauri::command]
pub fn tunnel_status(state: State<AppState>, site: String) -> Option<tunnel::TunnelInfo> {
    state.tunnels.get(&site)
}

#[tauri::command]
pub async fn tunnel_stop(app: AppHandle, state: State<'_, AppState>, site: String) -> AppResult<()> {
    let (tunnels, apply) = (state.tunnels.clone(), apply_for(&app));
    blocking(move || {
        tunnels.stop(&site, Some(&apply));
        Ok(())
    })
    .await
}
