//! Opening a site from a phone on the same Wi-Fi: for a while, nginx also
//! serves the site on this computer's network address (`http://192.168.1.20:5xxxx`),
//! to devices on private networks only. The app is told it was asked for that
//! address, so the links it builds open on the phone too.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::net::{Ipv4Addr, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanRoute {
    pub site: String,
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub started_ms: u64,
    /// When it stops by itself.
    pub expires_ms: u64,
}

static ROUTES: Mutex<Vec<LanRoute>> = Mutex::new(Vec::new());

/// Rewrites nginx's config and reloads it.
pub type Apply = Arc<dyn Fn() -> AppResult<()> + Send + Sync>;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn routes() -> Vec<LanRoute> {
    ROUTES.lock().unwrap().clone()
}

pub fn get(site: &str) -> Option<LanRoute> {
    routes().into_iter().find(|r| r.site == site)
}

/// An address a phone can reach: 10/8, 172.16/12 or 192.168/16.
pub fn is_private(ip: Ipv4Addr) -> bool {
    ip.is_private()
}

/// This computer's address on the local network: the one Windows would send
/// from (a UDP "connect" sends nothing).
pub fn lan_ip() -> Option<Ipv4Addr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.168.0.1:9").or_else(|_| s.connect("10.0.0.1:9")).ok()?;
    match s.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if is_private(ip) => Some(ip),
        _ => None,
    }
}

/// Serve `site` on the network address for `minutes` (1 to 240).
pub fn start(site: &str, minutes: u32, apply: Apply) -> AppResult<LanRoute> {
    if !(1..=240).contains(&minutes) {
        return Err(AppError::msg(crate::tr!("Pick 1 to 240 minutes.", "Pilih 1 sampai 240 menit.")));
    }
    let ip = lan_ip().ok_or_else(|| {
        AppError::msg(crate::tr!(
            "This computer isn't on a local network (Wi-Fi or cable), so a phone can't reach it.",
            "Komputer ini tidak terhubung ke jaringan lokal (Wi-Fi atau kabel), jadi HP tidak bisa menjangkaunya."
        ))
    })?;
    let port = std::net::TcpListener::bind((ip, 0))?.local_addr()?.port();
    let started_ms = now_ms();
    let route = LanRoute {
        site: site.to_owned(),
        ip: ip.to_string(),
        port,
        url: format!("http://{ip}:{port}"),
        started_ms,
        expires_ms: started_ms + u64::from(minutes) * 60_000,
    };
    {
        let mut r = ROUTES.lock().unwrap();
        r.retain(|x| x.site != site);
        r.push(route.clone());
    }
    if let Err(e) = apply() {
        stop(site, None);
        let _ = apply();
        return Err(e);
    }
    // Ends by itself, unless stopped or started again first.
    let site = site.to_owned();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        match get(&site) {
            Some(r) if r.started_ms == started_ms => {
                if now_ms() >= r.expires_ms {
                    stop(&site, Some(&apply));
                    return;
                }
            }
            _ => return,
        }
    });
    Ok(route)
}

pub fn stop(site: &str, apply: Option<&Apply>) -> bool {
    let removed = {
        let mut r = ROUTES.lock().unwrap();
        let before = r.len();
        r.retain(|x| x.site != site);
        before != r.len()
    };
    if removed {
        if let Some(apply) = apply {
            let _ = apply();
        }
    }
    removed
}

/// Every site stops (nginx is stopping, or Zefaro quits).
pub fn stop_all() {
    ROUTES.lock().unwrap().clear();
}

#[cfg(test)]
pub fn set_for_test(route: LanRoute) {
    let mut r = ROUTES.lock().unwrap();
    r.retain(|x| x.site != route.site);
    r.push(route);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_private_addresses_count() {
        for ip in ["192.168.1.20", "10.0.0.5", "172.16.3.4"] {
            assert!(is_private(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "127.0.0.1", "100.64.0.1"] {
            assert!(!is_private(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn a_route_ends_when_stopped() {
        let calls = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let c = calls.clone();
        let apply: Apply = Arc::new(move || {
            c.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Ok(())
        });
        assert!(start("lan-test", 0, apply.clone()).is_err(), "0 minutes");
        // Without a network (a test machine may have none) there's nothing to start.
        if lan_ip().is_none() {
            return;
        }
        let r = start("lan-test", 5, apply.clone()).unwrap();
        assert!(r.url.starts_with("http://") && r.expires_ms > r.started_ms);
        assert_eq!(get("lan-test").map(|x| x.port), Some(r.port));
        assert!(stop("lan-test", Some(&apply)));
        assert!(get("lan-test").is_none());
        assert_eq!(calls.load(std::sync::atomic::Ordering::Relaxed), 2, "applied on start and stop");
    }
}
