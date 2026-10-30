//! nginx settings (the gear on the nginx card): ports, workers, timeouts,
//! compression, logging and extra directives.
//!
//! Saving regenerates nginx.conf and checks it with `nginx -t` before keeping
//! anything; a running nginx is reloaded, or restarted when a port changed.

use super::blocking;
use crate::config::{self, ZefaroConfig, NginxConfig};
use crate::engine::supervisor::{self, Supervisor};
use crate::engine::{mariadb, nginx, redis};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

const LOG_LEVELS: &[&str] = &["debug", "info", "notice", "warn", "error", "crit"];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NginxSettingsView {
    pub settings: NginxConfig,
    pub defaults: NginxConfig,
    pub installed: bool,
    pub running: bool,
    /// The generated nginx.conf.
    pub conf_path: String,
    /// Sites with HTTPS on, which need the HTTPS port.
    pub secured_sites: usize,
}

/// Who holds a port, for the settings page.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PortStatus {
    pub port: u16,
    pub free: bool,
    /// Zefaro's own nginx is the one listening.
    pub ours: bool,
    /// "httpd (PID 2724)" etc., when another program holds it.
    pub owner: Option<String>,
}

fn view(cfg: &ZefaroConfig, sup: &Supervisor) -> NginxSettingsView {
    NginxSettingsView {
        settings: cfg.nginx.clone(),
        defaults: NginxConfig::default(),
        installed: nginx::installed(),
        running: sup.is_running(nginx::SERVICE_ID),
        conf_path: nginx::Layout::standard(cfg).conf.display().to_string(),
        secured_sites: cfg.sites.iter().filter(|s| s.secured).count(),
    }
}

/// Ports other Zefaro services use, which nginx must not take.
fn reserved(cfg: &ZefaroConfig) -> Vec<(u16, String)> {
    let mut out = vec![
        (mariadb::PORT, "MariaDB".to_owned()),
        (crate::engine::mysql::PORT, "MySQL".to_owned()),
        (redis::PORT, "Redis".to_owned()),
        (crate::engine::postgres::PORT, "PostgreSQL".to_owned()),
    ];
    // php-cgi listens on base + 10 × major + minor (7.4 → base + 74 … 8.9 → base + 89).
    for offset in 70..=99u16 {
        if let Some(p) = cfg.php.base_port.checked_add(offset) {
            out.push((p, crate::tr!("PHP (base port range)", "PHP (rentang port dasar)").to_owned()));
        }
    }
    out
}

pub fn validate(s: &NginxConfig, cfg: &ZefaroConfig) -> AppResult<()> {
    let bad = |m: &str| Err(AppError::msg(m.to_owned()));
    if s.http_port == 0 || s.https_port == 0 {
        return bad(crate::tr!("Ports must be between 1 and 65535.", "Port harus antara 1 dan 65535."));
    }
    if s.http_port == s.https_port {
        return bad(crate::tr!("The HTTP and HTTPS ports must be different.", "Port HTTP dan HTTPS harus berbeda."));
    }
    for port in [s.http_port, s.https_port] {
        if let Some((_, who)) = reserved(cfg).into_iter().find(|(p, _)| *p == port) {
            return Err(AppError::msg(crate::tr!(
                format!("Port {port} is used by Zefaro's {who}."),
                format!("Port {port} dipakai oleh {who} milik Zefaro.")
            )));
        }
    }
    if s.worker_processes > 64 {
        return bad(crate::tr!("Worker processes must be 0 (auto) to 64.", "Proses worker harus 0 (otomatis) sampai 64."));
    }
    if !(64..=65535).contains(&s.worker_connections) {
        return bad(crate::tr!("Worker connections must be 64 to 65535.", "Koneksi worker harus 64 sampai 65535."));
    }
    if s.keepalive_timeout > 3600 {
        return bad(crate::tr!("Keep-alive timeout must be 0 to 3600 seconds.", "Batas waktu keep-alive harus 0 sampai 3600 detik."));
    }
    if !(1..=86400).contains(&s.fastcgi_read_timeout) {
        return bad(crate::tr!("PHP timeout must be 1 to 86400 seconds.", "Batas waktu PHP harus 1 sampai 86400 detik."));
    }
    if s.client_max_body_mb > 102_400 {
        return bad(crate::tr!("Max request size must be 0 (no limit) to 102400 MB.", "Ukuran maksimum permintaan harus 0 (tanpa batas) sampai 102400 MB."));
    }
    if !LOG_LEVELS.contains(&s.error_log_level.as_str()) {
        return bad(crate::tr!("Unknown error log level.", "Level log error tidak dikenal."));
    }
    Ok(())
}

fn port_status(port: u16, cfg: &ZefaroConfig, sup: &Supervisor) -> PortStatus {
    let ours = sup.is_running(nginx::SERVICE_ID)
        && (port == cfg.nginx.http_port
            || (port == cfg.nginx.https_port && cfg.sites.iter().any(|s| s.secured)));
    if ours {
        return PortStatus { port, free: false, ours: true, owner: None };
    }
    if !supervisor::port_open(port) {
        return PortStatus { port, free: true, ours: false, owner: None };
    }
    let owner = supervisor::port_owner(port, false).map(|(pid, name)| {
        if pid == 4 {
            crate::tr!("Windows (PID 4, usually IIS)", "Windows (PID 4, biasanya IIS)").to_owned()
        } else {
            format!("{name} (PID {pid})")
        }
    });
    PortStatus { port, free: false, ours: false, owner }
}

#[tauri::command]
pub fn nginx_settings(state: State<AppState>) -> NginxSettingsView {
    let cfg = state.config.lock().unwrap().clone();
    view(&cfg, &state.supervisor)
}

#[tauri::command]
pub async fn nginx_port_status(state: State<'_, AppState>, port: u16) -> AppResult<PortStatus> {
    let cfg = state.config.lock().unwrap().clone();
    let sup = state.supervisor.clone();
    blocking(move || Ok(port_status(port, &cfg, &sup))).await
}

/// Write and test the config for `cfg`; reload or restart a running nginx.
fn apply(cfg: &ZefaroConfig, sup: &Supervisor, ports_changed: bool) -> AppResult<()> {
    let l = nginx::Layout::standard(cfg);
    nginx::write_config(cfg, &l)?;
    if nginx::installed() {
        nginx::test_config(&l)?;
    }
    if sup.is_running(nginx::SERVICE_ID) {
        if ports_changed {
            sup.restart(nginx::spec(&l))?;
        } else {
            nginx::reload(&l)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn nginx_save_settings(
    state: State<'_, AppState>,
    settings: NginxConfig,
) -> AppResult<NginxSettingsView> {
    let mut settings = settings;
    settings.extra_http = settings.extra_http.replace("\r\n", "\n");
    let old = state.config.lock().unwrap().clone();
    validate(&settings, &old)?;
    let sup = state.supervisor.clone();
    let mut new = old.clone();
    new.nginx = settings;

    let applied = {
        let (old, new, sup) = (old.clone(), new.clone(), sup.clone());
        blocking(move || {
            let ports_changed = old.nginx.http_port != new.nginx.http_port
                || old.nginx.https_port != new.nginx.https_port;
            // A new port must be free before nginx is pointed at it.
            for (port, changed) in [
                (new.nginx.http_port, old.nginx.http_port != new.nginx.http_port),
                (new.nginx.https_port, old.nginx.https_port != new.nginx.https_port),
            ] {
                if changed && supervisor::port_open(port) {
                    return Err(AppError::msg(supervisor::port_conflict(port, false)));
                }
            }
            match apply(&new, &sup, ports_changed) {
                Ok(()) => Ok(()),
                Err(e) => {
                    // Put the previous, working config back.
                    let _ = apply(&old, &sup, ports_changed);
                    Err(e)
                }
            }
        })
        .await
    };
    applied?;

    *state.config.lock().unwrap() = new.clone();
    config::save(&new)?;
    Ok(view(&new, &sup))
}

/// The generated nginx.conf, as nginx reads it.
#[tauri::command]
pub fn nginx_config_text(state: State<AppState>) -> AppResult<String> {
    let cfg = state.config.lock().unwrap().clone();
    let l = nginx::Layout::standard(&cfg);
    Ok(std::fs::read_to_string(&l.conf).unwrap_or_else(|_| nginx::render_main(&l)))
}

/// Show nginx's generated config folder (nginx.conf, sites/) in Explorer.
#[tauri::command]
pub fn nginx_reveal_config(app: tauri::AppHandle, state: State<AppState>) -> AppResult<()> {
    let cfg = state.config.lock().unwrap().clone();
    let l = nginx::Layout::standard(&cfg);
    let result = if l.conf.is_file() {
        app.opener().reveal_item_in_dir(&l.conf)
    } else {
        std::fs::create_dir_all(&l.runtime)?;
        app.opener().open_path(l.runtime.display().to_string(), None::<&str>)
    };
    result.map_err(|e| {
        AppError::msg(crate::tr!(
            format!("Couldn't open Explorer: {e}"),
            format!("Tidak dapat membuka Explorer: {e}")
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_rejects_clashes_and_bad_values() {
        let cfg = ZefaroConfig::default();
        let ok = NginxConfig::default();
        assert!(validate(&ok, &cfg).is_ok());

        let same = NginxConfig { http_port: 8080, https_port: 8080, ..ok.clone() };
        assert!(validate(&same, &cfg).is_err());
        let mariadb = NginxConfig { http_port: mariadb::PORT, ..ok.clone() };
        assert!(validate(&mariadb, &cfg).unwrap_err().to_string().contains("MariaDB"));
        let php = NginxConfig { http_port: cfg.php.base_port + 83, ..ok.clone() };
        assert!(validate(&php, &cfg).is_err());
        let level = NginxConfig { error_log_level: "loud".into(), ..ok.clone() };
        assert!(validate(&level, &cfg).is_err());
        let alt = NginxConfig { http_port: 8080, https_port: 8443, ..ok };
        assert!(validate(&alt, &cfg).is_ok());
    }

    #[test]
    fn site_urls_carry_non_default_ports() {
        let mut cfg = ZefaroConfig::default();
        assert_eq!(cfg.url_for("blog.test", false), "http://blog.test");
        assert_eq!(cfg.url_for("blog.test", true), "https://blog.test");
        cfg.nginx.http_port = 8080;
        cfg.nginx.https_port = 8443;
        assert_eq!(cfg.url_for("blog.test", false), "http://blog.test:8080");
        assert_eq!(cfg.url_for("blog.test", true), "https://blog.test:8443");
    }
}
