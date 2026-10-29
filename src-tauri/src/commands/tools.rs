//! Composer, the Laravel installer, and PATH registration.

use super::blocking;
use crate::engine::{paths, php, tools};
use crate::error::{AppError, AppResult};
use crate::model::ToolsStatus;
use crate::state::AppState;
use tauri::State;

fn active_php(state: &AppState) -> String {
    state.config.lock().unwrap().default_php.clone()
}

/// Both tools write to Zefaro's COMPOSER_HOME, so only one install runs at a time.
fn begin(state: &AppState) -> AppResult<()> {
    let mut busy = state.tool_busy.lock().unwrap();
    if *busy {
        return Err(AppError::msg(crate::tr!(
            "Another tool install is still running.",
            "Instalasi alat lain masih berjalan."
        )));
    }
    *busy = true;
    Ok(())
}

fn end(state: &AppState) {
    *state.tool_busy.lock().unwrap() = false;
}

/// The active PHP line, when installed. Nothing to run, so Home can show it at once.
#[tauri::command]
pub fn tools_active_php(state: State<AppState>) -> Option<String> {
    tools::active_php_line(&active_php(&state))
}

/// Is Zefaro's bin folder on the user PATH? Asks PowerShell, so it's kept apart
/// from the quick facts above.
#[tauri::command]
pub async fn tools_bin_on_path() -> AppResult<bool> {
    blocking(|| Ok(tools::bin_on_path())).await
}

#[tauri::command]
pub async fn tools_status(state: State<'_, AppState>) -> AppResult<ToolsStatus> {
    let active = active_php(&state);
    blocking(move || Ok(tools::status(&active))).await
}

#[tauri::command]
pub async fn tools_install_composer(state: State<'_, AppState>) -> AppResult<()> {
    begin(&state)?;
    let result = blocking(tools::install_composer).await;
    end(&state);
    result?;
    php::write_shims(&active_php(&state))
}

#[tauri::command]
pub async fn tools_install_laravel(state: State<'_, AppState>) -> AppResult<()> {
    let active = active_php(&state);
    if !php::is_installed(&active) {
        return Err(AppError::msg(crate::tr!(
            "Install and activate a PHP version first.",
            "Instal dan aktifkan satu versi PHP terlebih dahulu."
        )));
    }
    begin(&state)?;
    let php_exe = paths::php_dir(&active).join("php.exe");
    let result = blocking(move || tools::install_laravel(&php_exe)).await;
    end(&state);
    result?;
    php::write_shims(&active)
}

#[tauri::command]
pub async fn path_add_bin() -> AppResult<()> {
    blocking(tools::add_bin_to_path).await
}
