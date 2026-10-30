//! Sharing a site on the internet for a while, through a Cloudflare Quick
//! Tunnel: `cloudflared` connects out to Cloudflare, which hands back a random
//! `https://….trycloudflare.com` address and forwards its requests to this
//! computer. No account, no open port on the router.
//!
//! Each shared site gets its own nginx listener on a spare loopback port (see
//! [`Route`] and `nginx::write_config`), so the tunnel never depends on the
//! site's `.test` name. Once the public address is known, that listener tells
//! PHP the request came for it over HTTPS, so the app builds links and asset
//! URLs that work for the person opening it.
//!
//! cloudflared runs only while the user shares, inside a Job Object: stopping
//! the share, or Zefaro exiting for any reason, ends it.

use crate::engine::supervisor::job::Job;
use crate::engine::{net, paths, process, progress};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const VERSION: &str = "2026.10.6";
/// The size of the download, for the confirmation.
pub const DOWNLOAD_BYTES: u64 = 55_390_656;
/// The install's id in [`progress`], polled like a service's.
pub const PROGRESS_ID: &str = "cloudflared";
/// cloudflared-windows-amd64.exe from Cloudflare's GitHub release. The SHA-256
/// is the one in the release notes, which GitHub's own digest of the asset matches.
const URL: &str = "https://github.com/cloudflare/cloudflared/releases/download/2026.10.6/cloudflared-windows-amd64.exe";
const SHA256: &str = "d521b3bf68982165f0d06d76732f22d9a105ef057ff3ae4c0986f3a23190950f";

pub fn exe() -> PathBuf {
    paths::bin_dir().join("cloudflared").join("cloudflared.exe")
}

pub fn installed() -> bool {
    exe().is_file()
}

/// Download cloudflared and check it; a file that doesn't match is deleted.
pub fn install() -> AppResult<()> {
    progress::scope(PROGRESS_ID, || {
        let dest = exe();
        let download = dest.with_file_name("cloudflared.download");
        let hash = net::download(URL, &download, |done, total| progress::report("download", done, total))?;
        if !hash.eq_ignore_ascii_case(SHA256) {
            let _ = std::fs::remove_file(&download);
            return Err(AppError::msg(crate::tr!(
                "The cloudflared download didn't match its checksum, so Zefaro deleted it.",
                "Unduhan cloudflared tidak cocok dengan checksum-nya, jadi Zefaro menghapusnya."
            )));
        }
        std::fs::rename(&download, &dest)?;
        Ok(())
    })
}

/// Where nginx listens for one shared site, and the public host once known.
#[derive(Clone, Debug, PartialEq)]
pub struct Route {
    pub site: String,
    pub port: u16,
    /// `abc-def.trycloudflare.com`; None until cloudflared has printed it.
    pub host: Option<String>,
}

/// Shared sites' listeners, read by `nginx::write_config` whenever it writes
/// the configuration, so a share survives any other change to nginx's setup.
static ROUTES: Mutex<Vec<Route>> = Mutex::new(Vec::new());

pub fn routes() -> Vec<Route> {
    ROUTES.lock().unwrap().clone()
}

fn set_route(route: Route) {
    let mut routes = ROUTES.lock().unwrap();
    routes.retain(|r| r.site != route.site);
    routes.push(route);
}

fn remove_route(site: &str) {
    ROUTES.lock().unwrap().retain(|r| r.site != site);
}

#[cfg(test)]
pub fn set_route_for_test(route: Route) {
    set_route(route);
}

#[cfg(test)]
pub fn remove_route_for_test(site: &str) {
    remove_route(site);
}

/// The public address in a line cloudflared prints, e.g.
/// `INF |  https://calm-river-1234.trycloudflare.com  |`.
pub fn public_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let rest = &line[start..];
    let end = rest.find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | ':' | '/'))).unwrap_or(rest.len());
    let url = rest[..end].trim_end_matches('/');
    let host = url.strip_prefix("https://")?;
    // The tunnel's own name, not a Cloudflare link in another message.
    let name = host.strip_suffix(".trycloudflare.com")?;
    (!name.is_empty() && name != "api" && !name.contains('.')).then(|| url.to_owned())
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TunnelInfo {
    pub site: String,
    /// The public address, once Cloudflare has made it.
    pub url: Option<String>,
    /// "starting" | "running" | "failed"
    pub state: String,
    pub error: Option<String>,
    pub started_ms: u64,
}

struct Tunnel {
    info: Arc<Mutex<TunnelInfo>>,
    stopping: Arc<AtomicBool>,
    job: Job,
}

/// Applies the routes to nginx (rewrites its config, reloads it).
pub type Apply = Arc<dyn Fn() -> AppResult<()> + Send + Sync>;

/// The shares in progress, one per site.
#[derive(Default)]
pub struct Tunnels {
    map: Mutex<BTreeMap<String, Tunnel>>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn free_port() -> AppResult<u16> {
    Ok(std::net::TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// Zefaro's own config file: without `--config`, a quick tunnel refuses to
/// start when the user has a `~/.cloudflared/config.yml` for tunnels of their
/// own. It holds one harmless setting, since cloudflared logs an error for an
/// empty file.
const CONFIG: &str = "# Zefaro's quick tunnels: not ~/.cloudflared/config.yml.\nno-autoupdate: true\n";

fn empty_config() -> AppResult<PathBuf> {
    let path = crate::config::config_dir().join("runtime").join("cloudflared.yml");
    if std::fs::read_to_string(&path).ok().as_deref() != Some(CONFIG) {
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(&path, CONFIG)?;
    }
    Ok(path)
}

fn log_path(site: &str) -> PathBuf {
    paths::logs_dir().join(format!("tunnel-{site}.log"))
}

impl Tunnels {
    pub fn list(&self) -> Vec<TunnelInfo> {
        self.map.lock().unwrap().values().map(|t| t.info.lock().unwrap().clone()).collect()
    }

    pub fn get(&self, site: &str) -> Option<TunnelInfo> {
        self.map.lock().unwrap().get(site).map(|t| t.info.lock().unwrap().clone())
    }

    /// Share `site`: give it a listener, then start cloudflared towards it.
    /// Returns at once; the address arrives a few seconds later (see `get`).
    pub fn start(&self, site: &str, apply: Apply) -> AppResult<TunnelInfo> {
        if let Some(info) = self.get(site).filter(|i| i.state != "failed") {
            return Ok(info);
        }
        self.stop(site, None);
        if !installed() {
            return Err(AppError::msg(crate::tr!("Download cloudflared first.", "Unduh cloudflared terlebih dahulu.")));
        }
        let port = free_port()?;
        set_route(Route { site: site.to_owned(), port, host: None });
        if let Err(e) = apply() {
            remove_route(site);
            let _ = apply();
            return Err(e);
        }

        let spawned = (|| -> AppResult<(std::process::Child, Job)> {
            let mut child = process::command(exe())
                .arg("--config")
                .arg(empty_config()?)
                .args(["tunnel", "--no-autoupdate", "--url", &format!("http://127.0.0.1:{port}")])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()?;
            let job = Job::new()?;
            if let Err(e) = job.assign(&child) {
                let _ = child.kill();
                return Err(e);
            }
            Ok((child, job))
        })();
        let (mut child, job) = match spawned {
            Ok(pair) => pair,
            Err(e) => {
                remove_route(site);
                let _ = apply();
                return Err(e);
            }
        };

        let info = Arc::new(Mutex::new(TunnelInfo {
            site: site.to_owned(),
            url: None,
            state: "starting".into(),
            error: None,
            started_ms: now_ms(),
        }));
        let stopping = Arc::new(AtomicBool::new(false));
        let tail = Arc::new(Mutex::new(Vec::<String>::new()));
        let log = Arc::new(Mutex::new(std::fs::File::create(log_path(site)).ok()));

        // cloudflared logs to stderr; stdout stays quiet but is drained too.
        let readers: Vec<Box<dyn std::io::Read + Send>> = [
            child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        ]
        .into_iter()
        .flatten()
        .collect();
        for reader in readers {
            let (info, tail, log, apply, site) = (info.clone(), tail.clone(), log.clone(), apply.clone(), site.to_owned());
            std::thread::spawn(move || {
                for line in BufReader::new(reader).lines().map_while(Result::ok) {
                    if let Some(f) = log.lock().unwrap().as_mut() {
                        let _ = writeln!(f, "{line}");
                    }
                    {
                        let mut t = tail.lock().unwrap();
                        t.push(line.clone());
                        let excess = t.len().saturating_sub(8);
                        t.drain(..excess);
                    }
                    let Some(url) = public_url(&line) else { continue };
                    let mut i = info.lock().unwrap();
                    if i.url.is_none() {
                        let host = url.trim_start_matches("https://").to_owned();
                        i.url = Some(url);
                        i.state = "running".into();
                        drop(i);
                        set_route(Route { site: site.clone(), port, host: Some(host) });
                        if let Err(e) = apply() {
                            info.lock().unwrap().error = Some(e.to_string());
                        }
                    }
                }
            });
        }

        // When cloudflared ends by itself, say why and take the listener down.
        {
            let (info, stopping, tail, apply, site) = (info.clone(), stopping.clone(), tail.clone(), apply.clone(), site.to_owned());
            std::thread::spawn(move || {
                let status = child.wait();
                if stopping.load(Ordering::Relaxed) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
                let lines = tail.lock().unwrap().join("\n");
                let mut i = info.lock().unwrap();
                i.state = "failed".into();
                i.url = None;
                i.error = Some(crate::tr!(
                    format!("cloudflared stopped ({}). {lines}", status.map(|s| s.to_string()).unwrap_or_default()),
                    format!("cloudflared berhenti ({}). {lines}", status.map(|s| s.to_string()).unwrap_or_default())
                ));
                drop(i);
                remove_route(&site);
                let _ = apply();
            });
        }

        let snapshot = info.lock().unwrap().clone();
        self.map.lock().unwrap().insert(site.to_owned(), Tunnel { info, stopping, job });
        Ok(snapshot)
    }

    /// Stop sharing `site`: cloudflared ends and its listener goes. `apply`
    /// rewrites nginx's config; None when nginx is about to stop anyway.
    pub fn stop(&self, site: &str, apply: Option<&Apply>) -> bool {
        let Some(t) = self.map.lock().unwrap().remove(site) else { return false };
        t.stopping.store(true, Ordering::Relaxed);
        t.job.terminate();
        remove_route(site);
        if let Some(apply) = apply {
            let _ = apply();
        }
        true
    }

    /// Stop every share (Zefaro is stopping its services or quitting).
    pub fn stop_all(&self) {
        let sites: Vec<String> = self.map.lock().unwrap().keys().cloned().collect();
        for site in sites {
            self.stop(&site, None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_quick_tunnel_address_in_cloudflareds_log() {
        let banner = "2026-10-30T09:00:01Z INF |  https://calm-river-plant-1234.trycloudflare.com                                  |";
        assert_eq!(public_url(banner).as_deref(), Some("https://calm-river-plant-1234.trycloudflare.com"));
        for other in [
            "2026-10-30T09:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...",
            "2026-10-30T09:00:01Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment. See https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/do-more-with-tunnels/trycloudflare",
            "failed to request quick Tunnel: Post \"https://api.trycloudflare.com/tunnel\": dial tcp: lookup api.trycloudflare.com: no such host",
            "https://evil.example.com/.trycloudflare.com",
        ] {
            assert_eq!(public_url(other), None, "{other}");
        }
    }

    #[test]
    fn routes_are_one_per_site() {
        set_route(Route { site: "route-test".into(), port: 1, host: None });
        set_route(Route { site: "route-test".into(), port: 1, host: Some("a.trycloudflare.com".into()) });
        let mine: Vec<Route> = routes().into_iter().filter(|r| r.site == "route-test").collect();
        assert_eq!(mine, [Route { site: "route-test".into(), port: 1, host: Some("a.trycloudflare.com".into()) }]);
        remove_route("route-test");
        assert!(!routes().iter().any(|r| r.site == "route-test"));
    }

    #[test]
    fn the_pinned_download_is_cloudflares_own() {
        assert!(URL.starts_with("https://github.com/cloudflare/cloudflared/releases/download/"));
        assert!(URL.contains(VERSION));
        assert!(SHA256.len() == 64 && SHA256.bytes().all(|b| b.is_ascii_hexdigit()));
    }
}
