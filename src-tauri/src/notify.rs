//! Telling the user about something while Zefaro may be hidden in the tray: a
//! toast inside the window when it's in front, a Windows notification otherwise.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// The event the interface turns into a toast.
pub const EVENT: &str = "zefaro://notice";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub title: String,
    pub body: String,
    /// "error" or "info".
    pub tone: &'static str,
    /// The site it's about: its toast opens the site's logs.
    pub site: Option<String>,
    /// Which log: "app" (laravel.log) or "requests" (nginx's).
    pub view: Option<&'static str>,
}

/// The window is showing and has the focus.
fn in_front(app: &AppHandle) -> bool {
    app.get_webview_window("main").is_some_and(|w| {
        w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false)
    })
}

pub fn send(app: &AppHandle, notice: Notice) {
    if in_front(app) {
        let _ = app.emit(EVENT, notice);
    } else {
        let _ = app.notification().builder().title(&notice.title).body(&notice.body).show();
    }
}
