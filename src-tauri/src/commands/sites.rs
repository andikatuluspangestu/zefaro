//! Site management: list, link/unlink, toggle HTTPS, change PHP version.
//! Every change regenerates nginx's site configs (and reloads it if running).

use crate::engine::{certs, framework, laravel, nginx, php};
use crate::error::{AppError, AppResult};
use crate::model::Site;
use crate::state::AppState;
use std::path::Path;
use tauri::State;

/// Folder name → valid host label: "My App_v2" → "my-app-v2".
pub(crate) fn slug(name: &str) -> String {
    let dashed: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    dashed.split('-').filter(|part| !part.is_empty()).collect::<Vec<_>>().join("-")
}

#[tauri::command]
pub fn list_sites(state: State<AppState>) -> AppResult<Vec<Site>> {
    let cfg = state.config.lock().unwrap();
    // Addresses follow the current nginx ports.
    Ok(cfg
        .sites
        .iter()
        .map(|s| Site {
            url: cfg.url_for(&format!("{}.{}", s.name, cfg.tld), s.secured),
            framework: framework::detect(Path::new(&s.path)).map(str::to_owned),
            ..s.clone()
        })
        .collect())
}

/// Link a project directory as a served site.
#[tauri::command]
pub fn link_site(path: String, state: State<AppState>) -> AppResult<Site> {
    link(&state, path, Link::default())
}

/// Choices for a new link; each falls back to Zefaro's default when None.
#[derive(Default)]
pub(crate) struct Link {
    /// The PHP line (the active one when None).
    pub php: Option<String>,
    /// The site name (the folder's name when None).
    pub name: Option<String>,
    /// Forward to a dev server on this port instead of serving files with PHP.
    pub proxy: Option<u16>,
}

/// Link a folder as a site.
pub(crate) fn link(state: &AppState, path: String, opts: Link) -> AppResult<Site> {
    let folder = Path::new(&path)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| {
            AppError::msg(crate::tr!(
                "That isn't a folder path Zefaro can use.",
                "Itu bukan path folder yang bisa dipakai Zefaro."
            ))
        })?;
    let name = slug(opts.name.as_deref().unwrap_or(folder));
    if name.is_empty() {
        return Err(AppError::msg(crate::tr!(
            format!("Zefaro can't make a site name from the folder name {folder}."),
            format!("Zefaro tidak dapat membuat nama situs dari nama folder {folder}.")
        )));
    }

    let mut cfg = state.config.lock().unwrap();
    if cfg.sites.iter().any(|s| s.name == name) {
        return Err(AppError::msg(crate::tr!(
            format!("A site named {name} already exists."),
            format!("Situs bernama {name} sudah ada.")
        )));
    }
    let site = Site {
        name: name.clone(),
        path,
        url: cfg.url_for(&format!("{name}.{}", cfg.tld), false),
        secured: false,
        php_version: opts.php.unwrap_or_else(|| cfg.default_php.clone()),
        kind: "linked".into(),
        framework: None,
        proxy: opts.proxy,
    };
    // A project still pointing at localhost gets its new address.
    laravel::sync_app_url(Path::new(&site.path), &site.url, &cfg.tld);
    cfg.sites.push(site.clone());
    let snapshot = cfg.clone();
    drop(cfg);
    let _ = crate::config::save(&snapshot);
    nginx::sync(&snapshot, &state.supervisor)?;
    Ok(site)
}

#[tauri::command]
pub fn unlink_site(name: String, state: State<AppState>) -> AppResult<()> {
    super::laravel::forget_site(&state, &name);
    let mut cfg = state.config.lock().unwrap();
    cfg.sites.retain(|s| s.name != name);
    certs::remove_site(&certs::Layout::standard(), &format!("{name}.{}", cfg.tld));
    let snapshot = cfg.clone();
    drop(cfg);
    let _ = crate::config::save(&snapshot);
    nginx::sync(&snapshot, &state.supervisor)
}

/// Toggle HTTPS for a site: issue its certificate from Zefaro's local CA (made
/// on first use) and serve it on 443, or drop the certificate. Trusting the CA
/// is a separate step the user starts (`ca_trust`).
#[tauri::command]
pub fn secure_site(name: String, state: State<AppState>) -> AppResult<Site> {
    toggle_secure(&state, &name)
}

pub(crate) fn toggle_secure(state: &AppState, name: &str) -> AppResult<Site> {
    let mut cfg = state.config.lock().unwrap();
    let tld = cfg.tld.clone();
    let site = cfg
        .sites
        .iter_mut()
        .find(|s| s.name == name)
        .ok_or_else(|| AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada.")))?;
    let host = format!("{}.{}", site.name, tld);
    let layout = certs::Layout::standard();
    if site.secured {
        certs::remove_site(&layout, &host);
    } else {
        // Before flipping the flag, so a failure leaves the site as it was.
        certs::ensure_site(&layout, &tld, &host)?;
    }
    site.secured = !site.secured;
    let secured = site.secured;
    let mut out = site.clone();
    out.url = cfg.url_for(&host, secured);
    laravel::sync_app_url(Path::new(&out.path), &out.url, &tld);
    if let Some(s) = cfg.sites.iter_mut().find(|s| s.name == name) {
        s.url = out.url.clone();
    }
    let snapshot = cfg.clone();
    drop(cfg);
    let _ = crate::config::save(&snapshot);
    nginx::sync(&snapshot, &state.supervisor)?;
    Ok(out)
}

/// Why `version` can't serve `site`, if it can't: a site behind a dev server
/// has no PHP, and a line that isn't installed would fall back to the default.
fn php_choice_error(site: &Site, version: &str, installed: impl Fn(&str) -> bool) -> Option<String> {
    let is_line = matches!(version.split_once('.'), Some((a, b)) if !a.is_empty() && !b.is_empty()
        && a.chars().all(|c| c.is_ascii_digit()) && b.chars().all(|c| c.is_ascii_digit()));
    if site.proxy.is_some() {
        let msg = crate::tr!(
            "This site is served by its own dev server, not PHP.",
            "Situs ini dilayani dev server-nya sendiri, bukan PHP."
        );
        Some(msg.to_string())
    } else if !is_line || !installed(version) {
        Some(crate::tr!(
            format!("PHP {version} isn't installed. Install it on the PHP page first."),
            format!("PHP {version} belum terpasang. Pasang dulu di halaman PHP.")
        ))
    } else {
        None
    }
}

fn no_site() -> AppError {
    AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada."))
}

#[tauri::command]
pub fn set_site_php(name: String, version: String, state: State<AppState>) -> AppResult<Site> {
    let base_port = {
        let cfg = state.config.lock().unwrap();
        let site = cfg.sites.iter().find(|s| s.name == name).ok_or_else(no_site)?;
        if let Some(msg) = php_choice_error(site, &version, php::is_installed) {
            return Err(AppError::msg(msg));
        }
        cfg.php.base_port
    };
    // With nginx running, the new line's php-cgi must answer before nginx points
    // the site at it, or the site answers 502. If it can't start, nothing changes.
    // The config isn't held meanwhile: starting can take a few seconds.
    if state.supervisor.is_running(nginx::SERVICE_ID) {
        if let Err(e) = state.supervisor.start(php::cgi_spec(&version, php::port_for(base_port, &version))) {
            return Err(AppError::msg(crate::tr!(
                format!("PHP {version} didn't start, so the site stays as it was: {e}"),
                format!("PHP {version} gagal dimulai, jadi situs tetap seperti semula: {e}")
            )));
        }
    }
    let mut cfg = state.config.lock().unwrap();
    let site = cfg.sites.iter_mut().find(|s| s.name == name).ok_or_else(no_site)?;
    site.php_version = version;
    let out = site.clone();
    let snapshot = cfg.clone();
    drop(cfg);
    let _ = crate::config::save(&snapshot);
    nginx::sync(&snapshot, &state.supervisor)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{php_choice_error, slug};
    use crate::model::Site;

    fn site(proxy: Option<u16>) -> Site {
        Site {
            name: "blog".into(),
            path: r"C:\Projects\blog".into(),
            url: "http://blog.test".into(),
            secured: false,
            php_version: "8.3".into(),
            kind: "linked".into(),
            framework: None,
            proxy,
        }
    }

    #[test]
    fn only_installed_php_lines_can_serve_a_php_site() {
        let installed = |v: &str| v == "8.2" || v == "8.4";
        assert_eq!(php_choice_error(&site(None), "8.4", installed), None);
        assert!(php_choice_error(&site(None), "8.5", installed).is_some(), "not installed");
        assert!(php_choice_error(&site(None), "../8.4", installed).is_some(), "not a PHP line");
        assert!(php_choice_error(&site(None), "8", installed).is_some(), "not a PHP line");
        assert!(php_choice_error(&site(Some(5173)), "8.4", installed).is_some(), "dev server site");
    }

    #[test]
    fn slugs_are_valid_host_labels() {
        assert_eq!(slug("blog"), "blog");
        assert_eq!(slug("My App_v2"), "my-app-v2");
        assert_eq!(slug("--weird  name!!"), "weird-name");
        assert_eq!(slug("!!!"), "");
    }
}
