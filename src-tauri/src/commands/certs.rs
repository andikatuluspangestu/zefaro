//! HTTPS: Zefaro's local certificate authority — status, trust and removal.
//!
//! Trusting and removing are only ever started by the user; Windows shows its
//! own confirmation dialog for both, and nothing here needs admin rights.

use super::blocking;
use crate::engine::certs;
use crate::error::{AppError, AppResult};
use crate::model::CaStatus;
use crate::state::AppState;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

fn status(tld: String) -> CaStatus {
    let l = certs::Layout::standard();
    let meta = certs::read_meta(&l).filter(|m| m.tld == tld);
    CaStatus {
        created: meta.is_some(),
        trusted: meta.is_some() && certs::is_trusted(&l),
        tld,
        thumbprint: meta.as_ref().map(|m| m.thumbprint.clone()),
        expires: meta.map(|m| m.expires),
        cert_path: l.ca_cert().display().to_string(),
    }
}

#[tauri::command]
pub async fn ca_status(state: State<'_, AppState>) -> AppResult<CaStatus> {
    let tld = state.config.lock().unwrap().tld.clone();
    blocking(move || Ok(status(tld))).await
}

/// Add the CA to the current user's Trusted Root store (creating it first if
/// needed). Windows asks the user to confirm; resolves to the new status.
#[tauri::command]
pub async fn ca_trust(state: State<'_, AppState>) -> AppResult<CaStatus> {
    let tld = state.config.lock().unwrap().tld.clone();
    blocking(move || {
        let l = certs::Layout::standard();
        certs::ensure_ca(&l, &tld)?;
        certs::trust(&l)?;
        Ok(status(tld))
    })
    .await
}

/// Remove the CA from the Trusted Root store (Windows asks to confirm).
/// Sites keep their certificates; browsers just stop trusting them.
#[tauri::command]
pub async fn ca_untrust(state: State<'_, AppState>) -> AppResult<CaStatus> {
    let tld = state.config.lock().unwrap().tld.clone();
    blocking(move || {
        let l = certs::Layout::standard();
        if certs::read_meta(&l).is_some() {
            certs::untrust(&l)?;
        }
        Ok(status(tld))
    })
    .await
}

/// Show the CA certificate file in Explorer.
#[tauri::command]
pub fn ca_reveal(app: tauri::AppHandle) -> AppResult<()> {
    let path = certs::Layout::standard().ca_cert();
    if !path.is_file() {
        return Err(AppError::msg(crate::tr!(
            "Zefaro hasn't created its certificate authority yet.",
            "Zefaro belum membuat otoritas sertifikatnya."
        )));
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| {
            AppError::msg(crate::tr!(
                format!("Couldn't open Explorer: {e}"),
                format!("Tidak dapat membuka Explorer: {e}")
            ))
        })
}
