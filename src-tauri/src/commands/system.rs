//! App/environment info and privileged-helper status.

use crate::engine::{mailpit, mariadb, nginx, phpmyadmin, redis};
use crate::error::AppResult;
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
    let (tld, language, close_to_tray, check_updates) = {
        let cfg = state.config.lock().unwrap();
        (cfg.tld.clone(), cfg.language.clone(), cfg.close_to_tray, cfg.check_updates)
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
    })
}

/// Look for a newer Zefaro on its GitHub releases page.
#[tauri::command]
pub async fn check_update() -> AppResult<crate::engine::update::UpdateInfo> {
    super::blocking(crate::engine::update::check).await
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
