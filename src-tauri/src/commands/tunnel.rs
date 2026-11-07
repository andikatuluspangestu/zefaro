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
pub async fn tunnel_start(
    app: AppHandle,
    state: State<'_, AppState>,
    site: String,
    options: Option<tunnel::ShareOptions>,
) -> AppResult<tunnel::TunnelInfo> {
    let options = options.unwrap_or_default();
    options.check()?;
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
    blocking(move || tunnels.start(&site, &options, apply)).await
}

/// Where a share has got to (the address arrives a few seconds after start).
#[tauri::command]
pub fn tunnel_status(state: State<AppState>, site: String) -> Option<tunnel::TunnelInfo> {
    state.tunnels.get(&site)
}

// ------------------------------------------------------- On the network --

/// Open a site on this computer's network address for `minutes`, for a
/// phone on the same Wi-Fi. nginx must be running.
#[tauri::command]
pub async fn lan_start(app: AppHandle, state: State<'_, AppState>, site: String, minutes: u32) -> AppResult<crate::engine::lan::LanRoute> {
    if !state.config.lock().unwrap().sites.iter().any(|s| s.name == site) {
        return Err(AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada.")));
    }
    if !state.supervisor.is_running(nginx::SERVICE_ID) {
        return Err(AppError::msg(crate::tr!(
            "Start nginx first (Services → nginx).",
            "Mulai nginx terlebih dahulu (Layanan → nginx)."
        )));
    }
    let apply = apply_for(&app);
    blocking(move || crate::engine::lan::start(&site, minutes, apply)).await
}

#[tauri::command]
pub fn lan_status(site: String) -> Option<crate::engine::lan::LanRoute> {
    crate::engine::lan::get(&site)
}

#[tauri::command]
pub async fn lan_stop(app: AppHandle, site: String) -> AppResult<()> {
    let apply = apply_for(&app);
    blocking(move || {
        crate::engine::lan::stop(&site, Some(&apply));
        Ok(())
    })
    .await
}

fn inspector(state: &AppState, site: &str) -> AppResult<std::sync::Arc<crate::engine::inspector::Inspector>> {
    state.tunnels.inspector(site).ok_or_else(|| {
        AppError::msg(crate::tr!("This site isn't being shared any more.", "Situs ini sudah tidak dibagikan."))
    })
}

/// The requests that reached a shared site, newest first, without bodies.
#[tauri::command]
pub fn tunnel_requests(state: State<AppState>, site: String) -> Vec<crate::engine::inspector::Recorded> {
    state.tunnels.inspector(&site).map(|i| i.list()).unwrap_or_default()
}

/// One request, with its headers and body.
#[tauri::command]
pub fn tunnel_request(state: State<AppState>, site: String, id: u64) -> AppResult<crate::engine::inspector::Recorded> {
    inspector(&state, &site)?
        .get(id)
        .ok_or_else(|| AppError::msg(crate::tr!("That request is no longer kept.", "Request itu sudah tidak disimpan.")))
}

/// Send a request again; returns the new one once the site has answered.
#[tauri::command]
pub async fn tunnel_replay(state: State<'_, AppState>, site: String, id: u64) -> AppResult<u64> {
    let i = inspector(&state, &site)?;
    blocking(move || {
        i.replay(id).map_err(|e| {
            AppError::msg(crate::tr!(
                format!("Couldn't send it again ({e}). A body over 1 MB or a WebSocket can't be replayed."),
                format!("Tidak dapat mengirim ulang ({e}). Body di atas 1 MB atau WebSocket tidak bisa dikirim ulang.")
            ))
        })
    })
    .await
}

#[tauri::command]
pub fn tunnel_requests_clear(state: State<AppState>, site: String) {
    if let Some(i) = state.tunnels.inspector(&site) {
        i.clear();
    }
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
