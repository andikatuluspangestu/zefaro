//! Starting with Windows, and starting services when Zefaro opens.
//!
//! "Start with Windows" is one value under the current user's `Run` key, so it
//! needs no admin rights and the uninstaller can remove it. Zefaro then opens
//! hidden in the tray (`--background`). The services to start on launch are
//! the ones in `autostart` (one switch in Settings); a service that isn't installed yet is
//! skipped, so signing in never starts a download.

use crate::config::ZefaroConfig;
use crate::engine::supervisor::Supervisor;
use crate::engine::{dns, mailpit, mariadb, mysql, nginx, postgres, redis};
use crate::error::AppResult;
use std::path::Path;

/// Argument that starts Zefaro hidden in the system tray.
pub const BACKGROUND_ARG: &str = "--background";

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "Zefaro";

/// The services that can start when Zefaro opens, in the order they start:
/// the name server and the databases first, nginx last (it starts each site's
/// PHP and should find the databases up).
pub const STARTABLE: &[&str] = &[
    dns::SERVICE_ID,
    mariadb::SERVICE_ID,
    mysql::SERVICE_ID,
    postgres::SERVICE_ID,
    redis::SERVICE_ID,
    mailpit::SERVICE_ID,
    nginx::SERVICE_ID,
];

/// What goes into the `Run` value: the quoted path of this program, then the
/// argument that keeps its window hidden.
pub fn run_command(exe: &Path) -> String {
    format!("\"{}\" {BACKGROUND_ARG}", exe.display())
}

/// True when `value` starts the program at `exe` (case-insensitive, like Windows paths).
fn runs(value: &str, exe: &Path) -> bool {
    value.trim().eq_ignore_ascii_case(run_command(exe).trim())
}

/// Is Zefaro set to start when the user signs in to Windows?
pub fn is_enabled() -> bool {
    registry::read(RUN_KEY, VALUE_NAME).is_some()
}

/// Add or remove the sign-in entry for the current user.
pub fn set_enabled(on: bool) -> AppResult<()> {
    if on {
        let exe = std::env::current_exe()?;
        registry::write(RUN_KEY, VALUE_NAME, &run_command(&exe))
    } else {
        registry::delete(RUN_KEY, VALUE_NAME)
    }
}

/// An entry that points at an old location (Zefaro was moved or reinstalled
/// elsewhere) is rewritten to start this copy.
pub fn repair() {
    let (Some(value), Ok(exe)) = (registry::read(RUN_KEY, VALUE_NAME), std::env::current_exe()) else { return };
    if !runs(&value, &exe) {
        let _ = registry::write(RUN_KEY, VALUE_NAME, &run_command(&exe));
    }
}

/// Is `id` installed, so that starting it downloads nothing?
fn installed(cfg: &ZefaroConfig, id: &str) -> bool {
    match id {
        nginx::SERVICE_ID => nginx::installed(),
        mariadb::SERVICE_ID => mariadb::installed(&mariadb::Layout::standard()),
        mysql::SERVICE_ID => mysql::installed(&mysql::Layout::standard()),
        postgres::SERVICE_ID => postgres::installed(&postgres::Layout::standard()),
        redis::SERVICE_ID => redis::installed(&redis::Layout::standard()),
        mailpit::SERVICE_ID => mailpit::installed(&mailpit::Layout::standard(&cfg.mailpit)),
        // Zefaro's own program: nothing to download. With `.localhost` there is no
        // Windows rule to answer for, so it has nothing to do.
        dns::SERVICE_ID => dns::needs_rule(&cfg.tld),
        _ => false,
    }
}

/// The ticked services that exist, in start order. Unknown ids are ignored.
pub fn plan(cfg: &ZefaroConfig) -> Vec<&'static str> {
    STARTABLE.iter().copied().filter(|id| cfg.autostart.iter().any(|a| a == id) && installed(cfg, id)).collect()
}

/// Start the ticked services one after another. A failure is kept on the
/// service (its card on the Services page shows why) and doesn't stop the rest.
pub fn start_services(cfg: &ZefaroConfig, sup: &Supervisor) {
    for id in plan(cfg) {
        if sup.is_running(id) {
            continue;
        }
        if let Err(e) = crate::commands::services::start(cfg, sup, id) {
            sup.record_failure(id, e.to_string());
        }
    }
}

#[cfg(windows)]
mod registry {
    use crate::error::{AppError, AppResult};
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    fn fail(what: &str, code: u32) -> AppError {
        AppError::msg(crate::tr!(
            format!("Windows refused to {what} (error {code})."),
            format!("Windows menolak untuk {what} (kesalahan {code}).")
        ))
    }

    /// A string value under HKEY_CURRENT_USER, if there is one.
    pub fn read(key: &str, name: &str) -> Option<String> {
        let mut hkey: HKEY = std::ptr::null_mut();
        // SAFETY: NUL-terminated names; `hkey` is only used when the call succeeds and is closed below.
        unsafe {
            if RegOpenKeyExW(HKEY_CURRENT_USER, wide(key).as_ptr(), 0, KEY_READ, &mut hkey) != ERROR_SUCCESS {
                return None;
            }
            let name = wide(name);
            let mut size = 0u32;
            let probe = RegQueryValueExW(hkey, name.as_ptr(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), &mut size);
            let mut out = None;
            if probe == ERROR_SUCCESS && size >= 2 {
                let mut buf = vec![0u16; (size as usize).div_ceil(2)];
                let mut kind = 0u32;
                let mut got = size;
                let ok = RegQueryValueExW(hkey, name.as_ptr(), std::ptr::null(), &mut kind, buf.as_mut_ptr().cast(), &mut got);
                if ok == ERROR_SUCCESS && kind == REG_SZ {
                    let len = (got as usize / 2).min(buf.len());
                    out = Some(String::from_utf16_lossy(&buf[..len]).trim_end_matches('\0').to_owned());
                }
            }
            RegCloseKey(hkey);
            out
        }
    }

    pub fn write(key: &str, name: &str, value: &str) -> AppResult<()> {
        let mut hkey: HKEY = std::ptr::null_mut();
        let data = wide(value);
        // SAFETY: NUL-terminated names and a NUL-terminated UTF-16 buffer whose byte length is passed.
        unsafe {
            let created = RegCreateKeyExW(
                HKEY_CURRENT_USER,
                wide(key).as_ptr(),
                0,
                std::ptr::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                std::ptr::null(),
                &mut hkey,
                std::ptr::null_mut(),
            );
            if created != ERROR_SUCCESS {
                return Err(fail(&crate::tr!("open the sign-in list", "membuka daftar saat masuk"), created));
            }
            let set = RegSetValueExW(hkey, wide(name).as_ptr(), 0, REG_SZ, data.as_ptr().cast(), (data.len() * 2) as u32);
            RegCloseKey(hkey);
            if set != ERROR_SUCCESS {
                return Err(fail(&crate::tr!("save the sign-in entry", "menyimpan entri saat masuk"), set));
            }
        }
        Ok(())
    }

    /// Removing a value that isn't there is not an error.
    pub fn delete(key: &str, name: &str) -> AppResult<()> {
        let mut hkey: HKEY = std::ptr::null_mut();
        // SAFETY: NUL-terminated names; the key is closed before returning.
        unsafe {
            if RegOpenKeyExW(HKEY_CURRENT_USER, wide(key).as_ptr(), 0, KEY_SET_VALUE, &mut hkey) != ERROR_SUCCESS {
                return Ok(());
            }
            let gone = RegDeleteValueW(hkey, wide(name).as_ptr());
            RegCloseKey(hkey);
            // ERROR_FILE_NOT_FOUND (2): nothing to remove.
            if gone != ERROR_SUCCESS && gone != 2 {
                return Err(fail(&crate::tr!("remove the sign-in entry", "menghapus entri saat masuk"), gone));
            }
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod registry {
    use crate::error::AppResult;

    pub fn read(_: &str, _: &str) -> Option<String> {
        None
    }
    pub fn write(_: &str, _: &str, _: &str) -> AppResult<()> {
        Ok(())
    }
    pub fn delete(_: &str, _: &str) -> AppResult<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_entry_quotes_the_path_and_asks_for_the_tray() {
        let exe = Path::new(r"C:\Users\Ana Maria\AppData\Local\Zefaro\zefaro.exe");
        assert_eq!(run_command(exe), r#""C:\Users\Ana Maria\AppData\Local\Zefaro\zefaro.exe" --background"#);
        assert!(runs(&run_command(exe).to_uppercase(), exe));
        assert!(!runs(r#""D:\Old\zefaro.exe" --background"#, exe));
    }

    #[test]
    fn only_ticked_services_that_exist_are_planned_in_start_order() {
        let mut cfg = ZefaroConfig::default();
        // Nothing ticked: nothing starts.
        assert!(plan(&cfg).is_empty());
        // Ids Zefaro doesn't know are ignored; order follows STARTABLE, not the list.
        cfg.autostart = vec!["nginx".into(), "bogus".into(), "dns".into(), "phpmyadmin".into()];
        let planned = plan(&cfg);
        assert!(planned.iter().all(|id| STARTABLE.contains(id)));
        let order: Vec<usize> = planned.iter().map(|id| STARTABLE.iter().position(|s| s == id).unwrap()).collect();
        assert!(order.windows(2).all(|w| w[0] < w[1]));
        // Zefaro's own DNS program is always there, so it is planned when the TLD needs a rule.
        assert!(planned.contains(&"dns"));
        cfg.tld = "localhost".into();
        assert!(!plan(&cfg).contains(&"dns"));
    }

    #[cfg(windows)]
    #[test]
    fn a_value_round_trips_through_a_throwaway_key() {
        let key = r"Software\ZefaroTest\Run";
        assert_eq!(registry::read(key, "Zefaro"), None);
        registry::write(key, "Zefaro", r#""C:\x y\zefaro.exe" --background"#).unwrap();
        assert_eq!(registry::read(key, "Zefaro").as_deref(), Some(r#""C:\x y\zefaro.exe" --background"#));
        registry::write(key, "Zefaro", "second").unwrap();
        assert_eq!(registry::read(key, "Zefaro").as_deref(), Some("second"));
        registry::delete(key, "Zefaro").unwrap();
        registry::delete(key, "Zefaro").unwrap();
        assert_eq!(registry::read(key, "Zefaro"), None);
        // Remove the throwaway key itself.
        let _ = std::process::Command::new("reg").args(["delete", r"HKCU\Software\ZefaroTest", "/f"]).output();
    }
}
