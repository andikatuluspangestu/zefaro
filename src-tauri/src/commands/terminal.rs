//! The Terminal page: open shells on pseudo consoles, stream their output to
//! the page over a channel, and pass keystrokes and size changes back.

use super::blocking;
use crate::engine::php;
use crate::engine::terminal::{self, OpenRequest, Shell, TerminalInfo};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    id: u32,
    code: Option<u32>,
}

#[tauri::command]
pub async fn terminal_shells() -> AppResult<Vec<Shell>> {
    blocking(|| Ok(terminal::shells())).await
}

#[tauri::command]
pub fn terminal_list(state: State<AppState>) -> Vec<TerminalInfo> {
    state.terminals.list()
}

/// Open a terminal: in a site's folder with its PHP line, or in `cwd` (the
/// home folder when empty) with the active PHP line. `shell` is a
/// [`terminal::shells`] id; the first one when empty or not found.
#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    state: State<'_, AppState>,
    shell: Option<String>,
    site: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> AppResult<TerminalInfo> {
    let (folder, php_line) = {
        let cfg = state.config.lock().unwrap();
        let active = php::is_installed(&cfg.default_php).then(|| cfg.default_php.clone());
        match &site {
            Some(name) => {
                let s = cfg.sites.iter().find(|s| &s.name == name).ok_or_else(|| {
                    AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada."))
                })?;
                let line = Some(s.php_version.clone()).filter(|l| php::is_installed(l)).or(active);
                (PathBuf::from(&s.path), line)
            }
            None => {
                let dir = cwd
                    .filter(|c| !c.trim().is_empty())
                    .map(PathBuf::from)
                    .or_else(dirs::home_dir)
                    .unwrap_or_else(|| PathBuf::from("C:\\"));
                (dir, active)
            }
        }
    };
    let terminals = state.inner().terminals.clone();
    blocking(move || {
        let shells = terminal::shells();
        let chosen = shell
            .and_then(|id| shells.iter().find(|s| s.id == id).cloned())
            .or_else(|| shells.first().cloned())
            .ok_or_else(|| AppError::msg(crate::tr!("No shell was found.", "Tidak ada shell yang ditemukan.")))?;
        let on_exit: terminal::ExitFn = Arc::new(move |id, code| {
            let _ = app.emit("terminal-exit", TerminalExit { id, code });
        });
        terminals.open(OpenRequest { shell: chosen, cwd: folder, site, php: php_line, cols, rows }, on_exit)
    })
    .await
}

/// Stream a terminal's output to the page: what was kept first, then
/// everything new. A page attaching again replaces the previous one.
#[tauri::command]
pub fn terminal_attach(state: State<AppState>, id: u32, on_output: Channel<InvokeResponseBody>) -> AppResult<()> {
    let t = state.terminals.get(id)?;
    t.attach(Box::new(move |bytes| on_output.send(InvokeResponseBody::Raw(bytes.to_vec())).is_ok()));
    Ok(())
}

#[tauri::command]
pub fn terminal_detach(state: State<AppState>, id: u32) {
    if let Ok(t) = state.terminals.get(id) {
        t.detach();
    }
}

/// Keystrokes and pasted text, as the page's terminal produces them.
#[tauri::command]
pub async fn terminal_write(state: State<'_, AppState>, id: u32, data: String) -> AppResult<()> {
    let t = state.terminals.get(id)?;
    blocking(move || t.write(data.as_bytes())).await
}

#[tauri::command]
pub fn terminal_resize(state: State<AppState>, id: u32, cols: u16, rows: u16) -> AppResult<()> {
    state.terminals.get(id)?.resize(cols, rows)
}

/// End the terminal's shell and everything started in it.
#[tauri::command]
pub fn terminal_close(state: State<AppState>, id: u32) {
    state.terminals.close(id);
}
