//! Logs page: the service log files in `~/.config/zefaro/logs`.

use super::blocking;
use crate::engine::{logs, paths};
use crate::error::AppResult;
use crate::model::{LogSource, LogTail};
use tauri_plugin_opener::OpenerExt;

/// Every log file, with size and last write time (cheap; polled by the page).
#[tauri::command]
pub async fn list_logs() -> AppResult<Vec<LogSource>> {
    blocking(|| logs::list(&paths::logs_dir())).await
}

/// The last `lines` lines of one log, parsed.
#[tauri::command]
pub async fn tail_log(source: String, lines: Option<usize>) -> AppResult<LogTail> {
    blocking(move || {
        let t = logs::tail(&paths::logs_dir(), &source, lines.unwrap_or(logs::DEFAULT_LINES))?;
        Ok(LogTail { source: t.source, entries: t.entries, truncated: t.truncated })
    })
    .await
}

#[tauri::command]
pub async fn clear_log(source: String) -> AppResult<()> {
    blocking(move || logs::clear(&paths::logs_dir(), &source)).await
}

/// Show the logs folder (or one log file, selected) in Explorer.
#[tauri::command]
pub fn reveal_log(app: tauri::AppHandle, source: Option<String>) -> AppResult<()> {
    let dir = paths::logs_dir();
    std::fs::create_dir_all(&dir)?;
    let target = match source {
        Some(id) => logs::resolve(&dir, &id)?,
        None => dir,
    };
    let result = if target.is_file() {
        app.opener().reveal_item_in_dir(&target)
    } else {
        app.opener().open_path(target.display().to_string(), None::<&str>)
    };
    result.map_err(|e| {
        crate::error::AppError::msg(crate::tr!(
            format!("Couldn't open Explorer: {e}"),
            format!("Tidak dapat membuka Explorer: {e}")
        ))
    })
}
