//! Mail page: the inbox Mailpit catches (list, read, search, mark, delete),
//! and Mailpit's settings (gear on its card).

use super::{blocking, services};
use crate::config::{self, ZefaroConfig, MailpitConfig};
use crate::engine::mailpit::{self, Client, Message, Page};
use crate::engine::supervisor::{self, Supervisor};
use crate::engine::{mariadb, nginx, php, redis};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use std::collections::BTreeMap;
use tauri::State;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MailStatus {
    pub installed: bool,
    pub running: bool,
    pub version: String,
    pub download_mb: u32,
    pub settings: MailpitConfig,
    pub defaults: MailpitConfig,
    /// Mailpit's own web UI: mailpit.<tld> through nginx, else its port.
    pub web_url: String,
    /// Base for message parts (inline images, attachments).
    pub api_url: String,
}

fn status(cfg: &ZefaroConfig, sup: &Supervisor) -> MailStatus {
    let l = mailpit::Layout::standard(&cfg.mailpit);
    MailStatus {
        installed: mailpit::installed(&l),
        running: sup.is_running(mailpit::SERVICE_ID),
        version: mailpit::VERSION.into(),
        download_mb: mailpit::DOWNLOAD_MB,
        settings: cfg.mailpit.clone(),
        defaults: MailpitConfig::default(),
        web_url: web_url(cfg, sup),
        api_url: format!("http://127.0.0.1:{}/api/v1", cfg.mailpit.ui_port),
    }
}

/// mailpit.<tld> when nginx serves it, else Mailpit's own port.
pub fn web_url(cfg: &ZefaroConfig, sup: &Supervisor) -> String {
    if sup.is_running(nginx::SERVICE_ID) {
        cfg.url_for(&format!("{}.{}", mailpit::HOST, cfg.tld), false)
    } else {
        format!("http://127.0.0.1:{}", cfg.mailpit.ui_port)
    }
}

fn client(state: &AppState) -> Client {
    Client::new(state.config.lock().unwrap().mailpit.ui_port)
}

#[tauri::command]
pub fn mail_status(state: State<AppState>) -> MailStatus {
    let cfg = state.config.lock().unwrap().clone();
    status(&cfg, &state.supervisor)
}

#[tauri::command]
pub async fn mail_list(state: State<'_, AppState>, query: String, start: u64, limit: u64) -> AppResult<Page> {
    let c = client(&state);
    blocking(move || c.list(&query, start, limit.clamp(1, 200))).await
}

/// One message; opening it marks it read.
#[tauri::command]
pub async fn mail_get(state: State<'_, AppState>, id: String) -> AppResult<Message> {
    let c = client(&state);
    blocking(move || c.get_message(&id)).await
}

/// Inline images as data: URLs keyed by Content-ID, for the preview.
#[tauri::command]
pub async fn mail_inline_images(state: State<'_, AppState>, id: String) -> AppResult<BTreeMap<String, String>> {
    let c = client(&state);
    blocking(move || c.inline_images(&id)).await
}

#[tauri::command]
pub async fn mail_headers(state: State<'_, AppState>, id: String) -> AppResult<BTreeMap<String, Vec<String>>> {
    let c = client(&state);
    blocking(move || c.headers(&id)).await
}

#[tauri::command]
pub async fn mail_raw(state: State<'_, AppState>, id: String) -> AppResult<String> {
    let c = client(&state);
    blocking(move || c.raw(&id)).await
}

/// Mark messages read or unread; no IDs means all.
#[tauri::command]
pub async fn mail_set_read(state: State<'_, AppState>, ids: Vec<String>, read: bool) -> AppResult<()> {
    let c = client(&state);
    blocking(move || c.set_read(&ids, read)).await
}

/// Delete messages; no IDs means all.
#[tauri::command]
pub async fn mail_delete(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<()> {
    let c = client(&state);
    blocking(move || c.delete(&ids)).await
}

fn validate(s: &MailpitConfig, cfg: &ZefaroConfig) -> AppResult<()> {
    let bad = |m: String| Err(AppError::msg(m));
    if s.smtp_port == 0 || s.ui_port == 0 || s.smtp_port == s.ui_port {
        return bad(crate::tr!(
            "Use two different ports between 1 and 65535.",
            "Gunakan dua port berbeda antara 1 dan 65535."
        )
        .into());
    }
    let taken: Vec<(u16, &str)> = vec![
        (cfg.nginx.http_port, "nginx (HTTP)"),
        (cfg.nginx.https_port, "nginx (HTTPS)"),
        (mariadb::PORT, "MariaDB"),
        (crate::engine::mysql::PORT, "MySQL"),
        (redis::PORT, "Redis"),
        (crate::engine::postgres::PORT, "PostgreSQL"),
        (crate::engine::dns::PORT, "DNS"),
    ];
    for port in [s.smtp_port, s.ui_port] {
        if let Some((_, who)) = taken.iter().find(|(p, _)| *p == port) {
            return bad(crate::tr!(
                format!("Port {port} is used by Zefaro's {who}."),
                format!("Port {port} dipakai oleh {who} milik Zefaro.")
            ));
        }
        if (cfg.php.base_port + 70..=cfg.php.base_port + 99).contains(&port) {
            return bad(crate::tr!(
                format!("Port {port} is in PHP's port range."),
                format!("Port {port} berada dalam rentang port PHP.")
            ));
        }
    }
    if !(10..=1_000_000).contains(&s.max_messages) {
        return bad(crate::tr!(
            "Keep between 10 and 1,000,000 messages.",
            "Simpan antara 10 dan 1.000.000 pesan."
        )
        .into());
    }
    if s.max_age_days > 3650 {
        return bad(crate::tr!(
            "Max age is at most 3650 days (0 keeps mail).",
            "Usia maksimum paling lama 3650 hari (0 menyimpan email selamanya)."
        )
        .into());
    }
    Ok(())
}

/// Save Mailpit's settings: restart it if running (ports, limits), move PHP's
/// mail() to the new SMTP port, and point mailpit.<tld> at the new UI port.
#[tauri::command]
pub async fn mail_save_settings(state: State<'_, AppState>, settings: MailpitConfig) -> AppResult<MailStatus> {
    let old = state.config.lock().unwrap().clone();
    validate(&settings, &old)?;
    let mut new = old.clone();
    new.mailpit = settings;
    let sup = state.supervisor.clone();
    {
        let (old, new, sup) = (old.clone(), new.clone(), sup.clone());
        blocking(move || {
            for (port, was) in [(new.mailpit.smtp_port, old.mailpit.smtp_port), (new.mailpit.ui_port, old.mailpit.ui_port)] {
                if port != was && supervisor::port_open(port) {
                    return Err(AppError::msg(supervisor::port_conflict(port, false)));
                }
            }
            if sup.is_running(mailpit::SERVICE_ID) {
                sup.restart(mailpit::spec(&mailpit::Layout::standard(&new.mailpit)))?;
            }
            Ok(())
        })
        .await?;
    }
    *state.config.lock().unwrap() = new.clone();
    config::save(&new)?;
    let sup2 = sup.clone();
    let cfg = new.clone();
    blocking(move || {
        // PHP's mail() follows the SMTP port; running php-cgi reloads php.ini.
        if old.mailpit.smtp_port != cfg.mailpit.smtp_port {
            for line in php::refresh_inis(&cfg) {
                let id = php::service_id(&line);
                if sup2.is_running(&id) {
                    sup2.restart(php::cgi_spec(&line, php::port_for(cfg.php.base_port, &line)))?;
                }
            }
        }
        nginx::sync(&cfg, &sup2)
    })
    .await?;
    Ok(status(&new, &sup))
}

/// Start Mailpit (installing it first), like Start on its card.
#[tauri::command]
pub async fn mail_start(state: State<'_, AppState>) -> AppResult<MailStatus> {
    let cfg = state.config.lock().unwrap().clone();
    let sup = state.supervisor.clone();
    let (c2, s2) = (cfg.clone(), sup.clone());
    blocking(move || services::start(&c2, &s2, mailpit::SERVICE_ID)).await?;
    Ok(status(&cfg, &sup))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_avoid_other_services() {
        let cfg = ZefaroConfig::default();
        assert!(validate(&MailpitConfig::default(), &cfg).is_ok());
        let clash = MailpitConfig { smtp_port: mariadb::PORT, ..MailpitConfig::default() };
        assert!(validate(&clash, &cfg).unwrap_err().to_string().contains("MariaDB"));
        let same = MailpitConfig { smtp_port: 2525, ui_port: 2525, ..MailpitConfig::default() };
        assert!(validate(&same, &cfg).is_err());
        let php = MailpitConfig { ui_port: cfg.php.base_port + 83, ..MailpitConfig::default() };
        assert!(validate(&php, &cfg).is_err());
        let tiny = MailpitConfig { max_messages: 1, ..MailpitConfig::default() };
        assert!(validate(&tiny, &cfg).is_err());
    }
}
