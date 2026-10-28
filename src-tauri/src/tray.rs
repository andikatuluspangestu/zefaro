//! Zefaro keeps running in the system tray when its window is closed, so the
//! services it supervises keep serving. Only "Quit Zefaro" in the tray menu (or
//! closing with the tray option turned off) stops them.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

const TRAY_ID: &str = "zefaro";
const OPEN: &str = "open";
const QUIT: &str = "quit";

/// Brings the main window back: from the tray, or when Zefaro is launched again.
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let open = MenuItem::with_id(app, OPEN, crate::tr!("Open Zefaro", "Buka Zefaro"), true, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        QUIT,
        crate::tr!("Quit Zefaro and stop services", "Keluar dari Zefaro dan hentikan layanan"),
        true,
        None::<&str>,
    )?;
    Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])
}

/// Adds Zefaro's icon to the notification area.
pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Zefaro")
        .menu(&menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN => show_main(app),
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Rebuilds the menu after the interface language changes.
pub fn relabel<R: Runtime>(app: &AppHandle<R>) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// One Zefaro at a time. A second launch asks the running one to show its
/// window and then exits, instead of starting a second set of services.
#[cfg(windows)]
pub mod single {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::{CreateEventW, CreateMutexW, SetEvent, WaitForSingleObject, INFINITE};

    const MUTEX: &str = "Local\\Zefaro.Instance";
    const SHOW: &str = "Local\\Zefaro.ShowWindow";

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    /// The running Zefaro's "show your window" event, created by whichever Zefaro starts first.
    fn show_event() -> usize {
        // SAFETY: a NUL-terminated name; auto-reset, initially unsignalled.
        unsafe { CreateEventW(std::ptr::null(), 0, 0, wide(SHOW).as_ptr()) as usize }
    }

    /// True for the first Zefaro. For a later one, signals the first to show its
    /// window and returns false: the caller should exit.
    pub fn claim() -> bool {
        let event = show_event();
        // SAFETY: a NUL-terminated name. The handle stays open for the life of
        // the process on purpose: it is what marks Zefaro as running.
        let mutex = unsafe { CreateMutexW(std::ptr::null(), 0, wide(MUTEX).as_ptr()) };
        // SAFETY: reads the calling thread's last error, set by CreateMutexW.
        let taken = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        if mutex.is_null() || !taken {
            return true;
        }
        if event != 0 {
            // SAFETY: a valid event handle from CreateEventW.
            unsafe { SetEvent(event as _) };
        }
        false
    }

    /// Calls `on_show` whenever a later launch asks for the window.
    pub fn listen(on_show: impl Fn() + Send + 'static) {
        let event = show_event();
        if event == 0 {
            return;
        }
        std::thread::spawn(move || loop {
            // SAFETY: a valid event handle, never closed.
            unsafe { WaitForSingleObject(event as _, INFINITE) };
            on_show();
        });
    }
}
