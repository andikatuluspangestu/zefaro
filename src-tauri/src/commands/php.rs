//! PHP versions (list / install / activate) and php.ini settings. Changes are
//! pushed to the running php-cgi listeners and nginx.

use super::{blocking, services};
use crate::config;
use crate::engine::{nginx, paths, php::{self, Release}};
use crate::error::{AppError, AppResult};
use crate::model::{InstallProgress, PhpLimits, PhpSettingsView, PhpVersionsResponse};
use crate::state::AppState;
use std::collections::BTreeMap;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const RELEASES_TTL: Duration = Duration::from_secs(30 * 60);

/// Cached release list; refetched after the TTL. When offline, fall back to the
/// last list we saw (even if stale) and report `offline`.
async fn releases(state: &AppState) -> (Vec<Release>, bool) {
    let cached = state.php_releases.lock().unwrap().clone();
    if let Some((at, list)) = &cached {
        if at.elapsed() < RELEASES_TTL {
            return (list.clone(), false);
        }
    }
    match blocking(php::fetch_releases).await {
        Ok(list) => {
            *state.php_releases.lock().unwrap() = Some((Instant::now(), list.clone()));
            (list, false)
        }
        Err(_) => (cached.map(|(_, list)| list).unwrap_or_default(), true),
    }
}

#[tauri::command]
pub async fn php_versions(state: State<'_, AppState>) -> AppResult<PhpVersionsResponse> {
    let (releases, offline) = releases(&state).await;
    let (active, base_port) = {
        let cfg = state.config.lock().unwrap();
        (cfg.default_php.clone(), cfg.php.base_port)
    };
    Ok(PhpVersionsResponse {
        versions: php::list(&releases, &active, base_port),
        offline,
    })
}

/// The installed PHP lines, newest first, read from disk only: what a site can
/// be switched to, cheap enough to ask for from every row of the Sites table.
#[tauri::command]
pub async fn php_lines() -> AppResult<Vec<String>> {
    blocking(|| {
        let mut lines: Vec<String> = php::installed().into_keys().collect();
        lines.sort_by_key(|v| std::cmp::Reverse(php::minor_key(v)));
        Ok(lines)
    })
    .await
}

/// Install (or update) a PHP line, streaming `php-install-progress` events.
/// A running php-cgi for that line is stopped first (Windows locks its DLLs)
/// and started again afterwards. The first installed line becomes active.
#[tauri::command]
pub async fn php_install(
    app: AppHandle,
    state: State<'_, AppState>,
    version: String,
) -> AppResult<()> {
    let (releases, _) = releases(&state).await;
    let release = releases
        .into_iter()
        .find(|r| r.minor == version)
        .ok_or_else(|| {
            AppError::msg(crate::tr!(
                format!("PHP {version} isn't available to download."),
                format!("PHP {version} tidak tersedia untuk diunduh.")
            ))
        })?;

    if !state.php_installing.lock().unwrap().insert(version.clone()) {
        return Err(AppError::msg(crate::tr!(
            format!("Zefaro is already installing PHP {version}."),
            format!("Zefaro sedang menginstal PHP {version}.")
        )));
    }
    let (limits, extensions, smtp_port) = {
        let cfg = state.config.lock().unwrap();
        (cfg.php.limits_for(&version), cfg.php.extensions_for(&version), cfg.mailpit.smtp_port)
    };
    let sup = state.supervisor.clone();
    let service = php::service_id(&version);
    let result = blocking(move || {
        let was_running = sup.is_running(&service);
        if was_running {
            sup.stop(&service)?;
        }
        php::install(&release, &limits, &extensions, smtp_port, |p: InstallProgress| {
            let _ = app.emit("php-install-progress", p);
        })?;
        Ok(was_running)
    })
    .await;
    state.php_installing.lock().unwrap().remove(&version);
    let was_running = result?;

    let snapshot = {
        let mut cfg = state.config.lock().unwrap();
        if !php::is_installed(&cfg.default_php) {
            cfg.default_php = version.clone();
        }
        cfg.clone()
    };
    config::save(&snapshot)?;
    php::write_shims(&snapshot.default_php)?;
    let sup = state.supervisor.clone();
    blocking(move || {
        if was_running {
            services::start(&snapshot, &sup, &php::service_id(&version))?;
        }
        nginx::sync(&snapshot, &sup)
    })
    .await
}

#[tauri::command]
pub async fn php_activate(state: State<'_, AppState>, version: String) -> AppResult<()> {
    if !php::is_installed(&version) {
        return Err(AppError::msg(crate::tr!(
            format!("PHP {version} isn't installed."),
            format!("PHP {version} belum terpasang.")
        )));
    }
    let snapshot = {
        let mut cfg = state.config.lock().unwrap();
        cfg.default_php = version;
        cfg.clone()
    };
    config::save(&snapshot)?;
    php::write_shims(&snapshot.default_php)?;
    // Sites whose own version isn't installed fall back to the active one.
    let sup = state.supervisor.clone();
    blocking(move || nginx::sync(&snapshot, &sup)).await
}

/// The active line's limits plus the shared base port.
#[tauri::command]
pub fn php_settings(state: State<AppState>, version: Option<String>) -> AppResult<PhpSettingsView> {
    let cfg = state.config.lock().unwrap();
    let mut installed: Vec<String> = php::installed().into_keys().collect();
    installed.sort_by_key(|v| std::cmp::Reverse(php::minor_key(v)));
    let active = php::is_installed(&cfg.default_php).then(|| cfg.default_php.clone());
    let version = version
        .filter(|v| installed.contains(v))
        .or_else(|| active.clone())
        .or_else(|| installed.first().cloned());
    Ok(PhpSettingsView {
        limits: version.as_deref().map(|v| cfg.php.limits_for(v)).unwrap_or_default(),
        defaults: PhpLimits::default(),
        port: version.as_deref().map(|v| php::port_for(cfg.php.base_port, v)),
        running: version.as_deref().is_some_and(|v| state.supervisor.is_running(&php::service_id(v))),
        ini_path: version.as_deref().map(|v| paths::php_dir(v).join("php.ini").display().to_string()),
        active,
        version,
        installed,
        base_port: cfg.php.base_port,
    })
}

/// Save limits for one installed line (the active one when `version` is
/// omitted), rewrite just its php.ini, and restart its php-cgi if running so
/// the new values take effect. Returns the line they were applied to.
#[tauri::command]
pub async fn php_save_limits(
    state: State<'_, AppState>,
    limits: PhpLimits,
    version: Option<String>,
) -> AppResult<String> {
    php::validate_limits(&limits)?;
    let (active, snapshot) = {
        let mut cfg = state.config.lock().unwrap();
        let active = version.unwrap_or_else(|| cfg.default_php.clone());
        if !php::is_installed(&active) {
            return Err(AppError::msg(crate::tr!(
                format!("PHP {active} isn't installed."),
                format!("PHP {active} belum terpasang.")
            )));
        }
        cfg.php.limits.insert(active.clone(), limits.clone());
        (active, cfg.clone())
    };
    config::save(&snapshot)?;
    php::write_ini(
        &paths::php_dir(&active),
        &limits,
        &snapshot.php.extensions_for(&active),
        snapshot.mailpit.smtp_port,
    )?;
    let sup = state.supervisor.clone();
    let line = active.clone();
    blocking(move || {
        if sup.is_running(&php::service_id(&line)) {
            sup.restart(php::cgi_spec(&line, php::port_for(snapshot.php.base_port, &line)))?;
        }
        Ok(())
    })
    .await?;
    Ok(active)
}

fn require_installed(version: &str) -> AppResult<()> {
    if php::is_installed(version) {
        return Ok(());
    }
    Err(AppError::msg(crate::tr!(
        format!("PHP {version} isn't installed."),
        format!("PHP {version} belum terpasang.")
    )))
}

/// The extensions one line ships, which are on, and which failed to load.
/// Runs that line's PHP once to check.
#[tauri::command]
pub async fn php_extensions(state: State<'_, AppState>, version: String) -> AppResult<Vec<php::PhpExtension>> {
    require_installed(&version)?;
    let choices = state.config.lock().unwrap().php.extensions_for(&version);
    blocking(move || Ok(php::extension_list(&paths::php_dir(&version), &choices))).await
}

/// Switch extensions on or off for one line (`changes`: name → on), rewrite its
/// php.ini, restart its php-cgi if it is running, and return the new list.
#[tauri::command]
pub async fn php_save_extensions(
    state: State<'_, AppState>,
    version: String,
    changes: BTreeMap<String, bool>,
) -> AppResult<Vec<php::PhpExtension>> {
    require_installed(&version)?;
    let dir = paths::php_dir(&version);
    let shipped = php::shipped_extensions(&dir.join("ext"));
    if let Some(unknown) = changes.keys().find(|k| !shipped.contains(k)) {
        return Err(AppError::msg(crate::tr!(
            format!("PHP {version} has no extension named {unknown}."),
            format!("PHP {version} tidak punya ekstensi bernama {unknown}.")
        )));
    }
    let snapshot = {
        let mut cfg = state.config.lock().unwrap();
        let choices = cfg.php.extensions.entry(version.clone()).or_default();
        for (name, on) in changes {
            // Store only what differs from Zefaro's default.
            if on == php::default_on(&name) {
                choices.remove(&name);
            } else {
                choices.insert(name, on);
            }
        }
        if choices.is_empty() {
            cfg.php.extensions.remove(&version);
        }
        cfg.clone()
    };
    config::save(&snapshot)?;
    let choices = snapshot.php.extensions_for(&version);
    php::write_ini(&dir, &snapshot.php.limits_for(&version), &choices, snapshot.mailpit.smtp_port)?;
    let sup = state.supervisor.clone();
    blocking(move || {
        if sup.is_running(&php::service_id(&version)) {
            sup.restart(php::cgi_spec(&version, php::port_for(snapshot.php.base_port, &version)))?;
        }
        Ok(php::extension_list(&dir, &choices))
    })
    .await
}

/// The Xdebug version Zefaro can install for a line, if any.
#[tauri::command]
pub fn php_xdebug_version(version: String) -> Option<&'static str> {
    php::xdebug_version(&version)
}

/// Download Xdebug for one line. It then appears with the line's extensions,
/// off until switched on.
#[tauri::command]
pub async fn php_xdebug_install(state: State<'_, AppState>, version: String) -> AppResult<Vec<php::PhpExtension>> {
    require_installed(&version)?;
    let choices = state.config.lock().unwrap().php.extensions_for(&version);
    blocking(move || {
        php::install_xdebug(&version)?;
        Ok(php::extension_list(&paths::php_dir(&version), &choices))
    })
    .await
}

/// One line's php.ini, as php-cgi reads it.
#[tauri::command]
pub fn php_ini_text(version: String) -> AppResult<String> {
    if !php::is_installed(&version) {
        return Err(AppError::msg(crate::tr!(
            format!("PHP {version} isn't installed."),
            format!("PHP {version} belum terpasang.")
        )));
    }
    Ok(std::fs::read_to_string(paths::php_dir(&version).join("php.ini"))?)
}

/// Show one line's php.ini in Explorer.
#[tauri::command]
pub fn php_reveal_ini(app: tauri::AppHandle, version: String) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let ini = paths::php_dir(&version).join("php.ini");
    if !ini.is_file() {
        return Err(AppError::msg(crate::tr!(
            format!("PHP {version} has no php.ini yet."),
            format!("PHP {version} belum punya php.ini.")
        )));
    }
    app.opener()
        .reveal_item_in_dir(&ini)
        .map_err(|e| {
            AppError::msg(crate::tr!(
                format!("Couldn't open Explorer: {e}"),
                format!("Tidak dapat membuka Explorer: {e}")
            ))
        })
}

/// The base port is shared by every line (each listens on base + its version).
/// Running php-cgi listeners move to their new ports and nginx follows.
#[tauri::command]
pub async fn php_save_base_port(state: State<'_, AppState>, port: u16) -> AppResult<()> {
    php::validate_base_port(port)?;
    let snapshot = {
        let mut cfg = state.config.lock().unwrap();
        cfg.php.base_port = port;
        cfg.clone()
    };
    config::save(&snapshot)?;
    let sup = state.supervisor.clone();
    blocking(move || services::refresh_php(&snapshot, &sup)).await
}

/// The CA bundle PHP verifies HTTPS with (PHP settings page).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaBundle {
    /// When Mozilla's list was downloaded, ms since the Unix epoch.
    pub updated_ms: Option<u64>,
    /// Zefaro's own CA is in it, so PHP trusts secured .test sites.
    pub has_zefaro_ca: bool,
    pub path: String,
}

fn ca_bundle_status() -> CaBundle {
    use crate::engine::cabundle;
    let exists = cabundle::rebuild();
    CaBundle {
        updated_ms: cabundle::updated()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64),
        has_zefaro_ca: exists && crate::engine::certs::Layout::standard().ca_cert().is_file(),
        path: cabundle::path().display().to_string(),
    }
}

#[tauri::command]
pub async fn php_ca_bundle() -> AppResult<CaBundle> {
    blocking(|| Ok(ca_bundle_status())).await
}

/// Download Mozilla's CA list again now.
#[tauri::command]
pub async fn php_ca_bundle_update(state: State<'_, AppState>) -> AppResult<CaBundle> {
    blocking(crate::engine::cabundle::update).await?;
    // A line installed before the bundle existed points at the old file.
    let cfg = state.config.lock().unwrap().clone();
    let sup = state.supervisor.clone();
    blocking(move || {
        if !php::refresh_inis(&cfg).is_empty() {
            crate::commands::services::refresh_php(&cfg, &sup)?;
        }
        Ok(ca_bundle_status())
    })
    .await
}
