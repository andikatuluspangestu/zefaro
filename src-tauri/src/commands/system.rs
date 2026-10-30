//! App/environment info and privileged-helper status.

use crate::engine::{mailpit, mariadb, nginx, phpmyadmin, redis};
use crate::error::{AppError, AppResult};
use crate::model::{AppInfo, Component};
use crate::state::AppState;
use tauri::State;

/// Versions come from the engine's pinned constants, so the About page always
/// matches what Zefaro actually installs.
fn components() -> Vec<Component> {
    let c = |name: &str, version: String, license: &str, source: &str| Component {
        name: name.into(),
        version,
        license: license.into(),
        source: source.into(),
    };
    vec![
        c("nginx", nginx::VERSION.into(), "BSD-2-Clause", "nginx.org"),
        c("PHP", "7.4 to 8.5".into(), "PHP License", "downloads.php.net/~windows"),
        c("Node.js", "Current and maintained LTS".into(), "MIT", "nodejs.org/dist"),
        c("MariaDB", format!("{} LTS", mariadb::VERSION), "GPL-2.0", "archive.mariadb.org"),
        c("PostgreSQL", crate::engine::postgres::VERSION.into(), "PostgreSQL License", "get.enterprisedb.com"),
        c(
            "Redis",
            redis::VERSION.into(),
            "RSALv2 / SSPLv1 / AGPLv3 (Windows build: Apache-2.0)",
            "github.com/redis-windows/redis-windows",
        ),
        c("phpMyAdmin", phpmyadmin::VERSION.into(), "GPL-2.0", "files.phpmyadmin.net"),
        c("Mailpit", mailpit::VERSION.into(), "MIT", "github.com/axllent/mailpit"),
        c("Composer", "latest stable".into(), "MIT", "getcomposer.org"),
        c("Laravel Installer", "latest".into(), "MIT", "packagist.org"),
        c("CA certificates", "Mozilla (via curl)".into(), "MPL-2.0", "curl.se/ca"),
    ]
}

#[tauri::command]
pub fn app_info(state: State<AppState>) -> AppResult<AppInfo> {
    let (tld, language, close_to_tray, check_updates, autostart) = {
        let cfg = state.config.lock().unwrap();
        (cfg.tld.clone(), cfg.language.clone(), cfg.close_to_tray, cfg.check_updates, cfg.autostart.clone())
    };
    Ok(AppInfo {
        name: "Zefaro".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        tld,
        config_dir: crate::config::config_dir().to_string_lossy().into_owned(),
        // TODO: query the real Zefaro Helper Windows service.
        helper_installed: false,
        components: components(),
        language,
        close_to_tray,
        check_updates,
        start_with_windows: crate::engine::startup::is_enabled(),
        autostart,
        can_elevate: crate::engine::dns::can_elevate(),
    })
}

/// Start Zefaro, hidden in the tray, when the user signs in to Windows.
#[tauri::command]
pub async fn set_start_with_windows(on: bool) -> AppResult<()> {
    super::blocking(move || crate::engine::startup::set_enabled(on)).await
}

/// The services to start when Zefaro opens. Only ids Zefaro can start are kept,
/// and each once, so a stale or odd list can't do anything else.
#[tauri::command]
pub fn set_autostart(state: State<AppState>, ids: Vec<String>) -> AppResult<Vec<String>> {
    let mut kept: Vec<String> = Vec::new();
    for id in ids {
        if crate::engine::startup::STARTABLE.contains(&id.as_str()) && !kept.contains(&id) {
            kept.push(id);
        }
    }
    let mut cfg = state.config.lock().unwrap();
    cfg.autostart = kept.clone();
    crate::config::save(&cfg)?;
    Ok(kept)
}

/// Look for a newer Zefaro on its GitHub releases page.
#[tauri::command]
pub async fn check_update() -> AppResult<crate::engine::update::UpdateInfo> {
    super::blocking(crate::engine::update::check).await
}

/// Stop what Zefaro runs, in the order it uses on exit: serving and site workers
/// first, databases last so they flush cleanly.
pub fn stop_everything(state: &AppState) {
    use crate::engine::{laravel, postgres};
    state.tinker.end_all();
    state.supervisor.stop_all(|id| match id {
        nginx::SERVICE_ID => 0,
        id if id.starts_with(laravel::WORKER_PREFIX) => 0,
        mariadb::SERVICE_ID | redis::SERVICE_ID | postgres::SERVICE_ID => 2,
        _ => 1,
    });
}

/// Download the newest installer, check it against its published checksum,
/// stop the services and run it. Zefaro then closes; the installer replaces it
/// (keeping sites, settings, databases, the DNS rule and the HTTPS authority)
/// and opens it again. Only ever called after the user said yes.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let installer = super::blocking(crate::engine::update::download_installer).await?;
    // Services stop cleanly first, so the installer doesn't have to kill them.
    stop_everything(&state);
    crate::engine::update::launch(&installer).map_err(|e| {
        AppError::msg(crate::tr!(
            format!("{e} Zefaro's services were stopped; start them again on the Services page."),
            format!("{e} Layanan Zefaro sudah dihentikan; mulai lagi di halaman Layanan.")
        ))
    })?;
    app.exit(0);
    Ok(())
}

/// How far the update has got, while `update_install` runs.
#[tauri::command]
pub fn update_progress() -> Option<crate::engine::update::UpdateProgress> {
    crate::engine::update::progress()
}

/// Whether Zefaro looks for a newer version when it starts.
#[tauri::command]
pub fn set_check_updates(state: State<AppState>, on: bool) -> AppResult<()> {
    let mut cfg = state.config.lock().unwrap();
    cfg.check_updates = on;
    crate::config::save(&cfg)?;
    Ok(())
}

/// Settings are waiting for config.json to be free (another program has it open).
#[tauri::command]
pub fn config_pending() -> bool {
    crate::config::pending()
}

/// What closing the window does from now on: keep running in the tray, or
/// quit (stopping every service).
#[tauri::command]
pub fn set_close_to_tray(state: State<AppState>, on: bool) -> AppResult<()> {
    let mut cfg = state.config.lock().unwrap();
    cfg.close_to_tray = on;
    cfg.close_asked = true;
    crate::config::save(&cfg)?;
    Ok(())
}

/// The answer to the question asked the first time the window is closed:
/// remember it, then hide to the tray or quit.
#[tauri::command]
pub fn close_window(app: tauri::AppHandle, state: State<AppState>, keep_running: bool) -> AppResult<()> {
    set_close_to_tray(state, keep_running)?;
    if keep_running {
        if let Some(w) = tauri::Manager::get_webview_window(&app, "main") {
            let _ = w.hide();
        }
    } else {
        app.exit(0);
    }
    Ok(())
}

/// Saves the language setting ("system", "en" or "id") and switches the
/// backend's messages to `resolved` ("en" or "id"), the language the interface
/// actually shows.
#[tauri::command]
pub fn set_language(
    app: tauri::AppHandle,
    state: State<AppState>,
    setting: String,
    resolved: String,
) -> AppResult<()> {
    if !(setting == "system" || crate::i18n::LANGUAGES.contains(&setting.as_str()))
        || !crate::i18n::LANGUAGES.contains(&resolved.as_str())
    {
        return Err(crate::error::AppError::msg(crate::tr!(
            format!("Unknown language: {setting} ({resolved})."),
            format!("Bahasa tidak dikenal: {setting} ({resolved}).")
        )));
    }
    crate::i18n::set(&resolved);
    crate::tray::relabel(&app);
    let mut cfg = state.config.lock().unwrap();
    if cfg.language != setting {
        cfg.language = setting;
        crate::config::save(&cfg)?;
    }
    Ok(())
}
