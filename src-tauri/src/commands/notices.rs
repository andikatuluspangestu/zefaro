//! Notices about the sites: a notification when one answers with a server error
//! or its Laravel log gets an error, and the Requests view of a site's logs.

use crate::engine::errwatch::{Event, Watched, Watcher, What};
use crate::engine::{paths, requests};
use crate::error::{AppError, AppResult};
use crate::notify::{self, Notice};
use crate::state::AppState;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

/// One notification per site in this time; what comes in between is counted
/// into the next one.
const QUIET: Duration = Duration::from_secs(60);

fn access_log() -> PathBuf {
    paths::logs_dir().join("nginx-access.log")
}

fn watched(cfg: &crate::config::ZefaroConfig) -> Vec<Watched> {
    cfg.sites
        .iter()
        .map(|s| {
            let project = PathBuf::from(&s.path);
            let logs = project.join("storage").join("logs");
            Watched {
                name: s.name.clone(),
                host: format!("{}.{}", s.name, cfg.tld).to_ascii_lowercase(),
                logs: (project.join("artisan").is_file() && logs.is_dir()).then_some(logs),
            }
        })
        .collect()
}

fn describe(what: &What) -> String {
    match what {
        What::Status { status, method, path } => format!("{status} · {method} {path}").trim().to_owned(),
        What::Log { level, message } => format!("{level}: {message}"),
    }
}

/// Every 3 seconds, while notifications are on: the new errors, one notice per site.
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut watcher = Watcher::default();
        let mut last: HashMap<String, (Instant, usize)> = HashMap::new();
        loop {
            std::thread::sleep(Duration::from_secs(3));
            let (on, sites) = {
                let state = app.state::<AppState>();
                let cfg = state.config.lock().unwrap();
                (cfg.notify_errors, watched(&cfg))
            };
            if !on {
                // Turned back on later, it starts from what's new then.
                watcher = Watcher::default();
                continue;
            }
            let mut by_site: HashMap<String, Vec<Event>> = HashMap::new();
            for event in watcher.tick(&access_log(), &sites) {
                by_site.entry(event.site.clone()).or_default().push(event);
            }
            for (site, events) in by_site {
                if let Some((at, held)) = last.get_mut(&site) {
                    if at.elapsed() < QUIET {
                        *held += events.len();
                        continue;
                    }
                }
                let held = last.get(&site).map(|(_, n)| *n).unwrap_or(0);
                // The app's own message says more than the status code.
                let pick = events.iter().find(|e| matches!(e.what, What::Log { .. })).unwrap_or(&events[0]);
                let more = events.len() - 1 + held;
                let mut body = describe(&pick.what);
                if more > 0 {
                    body.push_str(&crate::tr!(format!(" (and {more} more)"), format!(" (dan {more} lainnya)")));
                }
                notify::send(
                    &app,
                    Notice {
                        title: crate::tr!(format!("Error on {site}"), format!("Error di {site}")),
                        body,
                        tone: "error",
                        site: Some(site.clone()),
                        view: Some(if matches!(pick.what, What::Log { .. }) { "app" } else { "requests" }),
                    },
                );
                last.insert(site, (Instant::now(), 0));
            }
        }
    });
}

#[tauri::command]
pub fn set_notify_errors(state: State<AppState>, on: bool) -> AppResult<()> {
    let mut cfg = state.config.lock().unwrap();
    cfg.notify_errors = on;
    crate::config::save(&cfg)?;
    Ok(())
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SiteRequests {
    #[serde(flatten)]
    pub list: requests::Requests,
    /// nginx's access log is on (nginx settings); without it there's nothing to read.
    pub access_log: bool,
}

/// The site's latest requests, newest first, from nginx's access log.
#[tauri::command]
pub async fn site_requests(name: String, state: State<'_, AppState>) -> AppResult<SiteRequests> {
    let (host, access_log) = {
        let cfg = state.config.lock().unwrap();
        if !cfg.sites.iter().any(|s| s.name == name) {
            return Err(AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada.")));
        }
        (format!("{name}.{}", cfg.tld), cfg.nginx.access_log)
    };
    let list = super::blocking(move || requests::read(&self::access_log(), &host, 500)).await?;
    Ok(SiteRequests { list, access_log })
}
