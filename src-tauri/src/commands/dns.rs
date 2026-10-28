//! DNS: the Windows NRPT rule that sends `*.test` lookups to Zefaro's DNS
//! service (adding or removing it shows a UAC prompt), and the DNS settings
//! page — local domain, resolution test, cache flush.

use super::{blocking, services};
use crate::engine::{dns, nginx};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

/// Add the rule, make sure Zefaro's DNS is running, then ask Windows itself to
/// resolve a `.test` name. Returns whether that worked end to end.
#[tauri::command]
pub async fn dns_setup(state: State<'_, AppState>) -> AppResult<bool> {
    let cfg = state.config.lock().unwrap().clone();
    let sup = state.supervisor.clone();
    let tld = cfg.tld.clone();
    blocking(move || dns::install_rule(&tld)).await?;
    *state.dns_rule.lock().unwrap() = Some(true);

    let tld = cfg.tld.clone();
    blocking(move || {
        services::start(&cfg, &sup, dns::SERVICE_ID)?;
        Ok(dns::os_resolves(&tld))
    })
    .await
}

/// Remove the rule Zefaro added; `*.test` stops resolving to this machine.
#[tauri::command]
pub async fn dns_remove(state: State<'_, AppState>) -> AppResult<()> {
    blocking(dns::remove_rule).await?;
    *state.dns_rule.lock().unwrap() = Some(false);
    Ok(())
}

/// What the DNS settings page shows.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DnsSettingsView {
    pub tld: String,
    /// Local domains to choose from.
    pub tlds: Vec<String>,
    pub port: u16,
    pub running: bool,
    /// Windows sends `.tld` lookups to Zefaro; None while the startup check runs.
    pub rule_installed: Option<bool>,
    pub sites: usize,
    pub secured_sites: usize,
}

/// Result of "Test now".
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DnsTest {
    /// The name that was looked up, e.g. `zefaro-check-0.test`.
    pub name: String,
    /// Zefaro's DNS server answered it directly.
    pub server_answers: bool,
    /// Windows' own resolver returned 127.0.0.1 for it (the rule works).
    pub windows_resolves: bool,
}

fn view(state: &AppState) -> DnsSettingsView {
    let cfg = state.config.lock().unwrap().clone();
    DnsSettingsView {
        tlds: dns::ALLOWED_TLDS.iter().map(|t| t.to_string()).collect(),
        port: dns::PORT,
        running: state.supervisor.is_running(dns::SERVICE_ID),
        rule_installed: *state.dns_rule.lock().unwrap(),
        sites: cfg.sites.len(),
        secured_sites: cfg.sites.iter().filter(|s| s.secured).count(),
        tld: cfg.tld,
    }
}

#[tauri::command]
pub fn dns_settings(state: State<AppState>) -> DnsSettingsView {
    view(&state)
}

/// Ask Zefaro's server and Windows itself to resolve a name under the TLD.
#[tauri::command]
pub async fn dns_test(state: State<'_, AppState>) -> AppResult<DnsTest> {
    let tld = state.config.lock().unwrap().tld.clone();
    blocking(move || {
        Ok(DnsTest {
            name: format!("zefaro-check-0.{tld}"),
            server_answers: dns::probe(dns::PORT, &tld),
            windows_resolves: dns::os_resolves(&tld),
        })
    })
    .await
}

#[tauri::command]
pub async fn dns_flush_cache() -> AppResult<()> {
    blocking(dns::flush_cache).await
}

/// Switch the local domain (e.g. `.test` → `.internal`). Moves the Windows
/// rule (one UAC prompt, if it was set up), restarts DNS, and regenerates
/// nginx — secured sites get certificates from a CA for the new domain.
#[tauri::command]
pub async fn dns_set_tld(state: State<'_, AppState>, tld: String) -> AppResult<DnsSettingsView> {
    if !dns::ALLOWED_TLDS.contains(&tld.as_str()) {
        return Err(AppError::msg(crate::tr!(
            format!(".{tld} isn't one of the local domains Zefaro supports."),
            format!(".{tld} bukan salah satu domain lokal yang didukung Zefaro.")
        )));
    }
    let old = state.config.lock().unwrap().clone();
    if old.tld == tld {
        return Ok(view(&state));
    }
    let had_rule = *state.dns_rule.lock().unwrap() == Some(true);
    if had_rule {
        // First, so declining the UAC prompt changes nothing.
        let t = tld.clone();
        blocking(move || dns::move_rule(&t)).await?;
        *state.dns_rule.lock().unwrap() = Some(true);
    }

    let mut new = old.clone();
    new.tld = tld.clone();
    *state.config.lock().unwrap() = new.clone();
    crate::config::save(&new)?;
    if !had_rule {
        let rule = blocking(move || Ok(dns::rule_installed(&tld))).await?;
        *state.dns_rule.lock().unwrap() = Some(rule);
    }

    let sup = state.supervisor.clone();
    blocking(move || {
        if sup.is_running(dns::SERVICE_ID) {
            sup.restart(dns::spec(&new.tld)?)?;
        }
        nginx::sync(&new, &sup)
    })
    .await?;
    Ok(view(&state))
}
