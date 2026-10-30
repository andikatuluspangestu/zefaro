//! The Dumps page: `dump()` and `dd()` from sites, shown in Zefaro instead of
//! the page. Sites get `VAR_DUMPER_FORMAT=tcp://127.0.0.1:9912` from nginx, so
//! Symfony's VarDumper (which Laravel and Symfony use) sends each dump to a
//! small receiver Zefaro runs with the active PHP. When the receiver isn't
//! running, VarDumper prints into the page as usual.

use crate::config::{config_dir, ZefaroConfig};
use crate::engine::supervisor::{Probe, Spec};
use crate::engine::{paths, php};
use crate::error::{AppError, AppResult};
use crate::model::Site;
use std::fs;
use std::path::{Path, PathBuf};

pub const SERVICE_ID: &str = "dumps";
pub const PORT: u16 = 9912;
/// How many dumps the page shows (newest first).
pub const SHOWN: usize = 200;

const SERVER: &str = include_str!("dump-server.php");

/// What nginx hands sites as VAR_DUMPER_FORMAT.
pub fn format() -> String {
    format!("tcp://127.0.0.1:{PORT}")
}

/// One JSON line per dump, written by the receiver.
pub fn file() -> PathBuf {
    config_dir().join("runtime").join("dumps.jsonl")
}

fn server_script() -> AppResult<PathBuf> {
    let path = config_dir().join("runtime").join("dump-server.php");
    if fs::read_to_string(&path).ok().as_deref() != Some(SERVER) {
        fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))?;
        fs::write(&path, SERVER)?;
    }
    Ok(path)
}

/// The receiver, run by the active PHP line (or the newest installed one).
pub fn spec(cfg: &ZefaroConfig) -> AppResult<Spec> {
    let line = if php::is_installed(&cfg.default_php) {
        cfg.default_php.clone()
    } else {
        php::installed().into_keys().max_by_key(|l| php::minor_key(l)).ok_or_else(|| {
            AppError::msg(crate::tr!(
                "Install a PHP version first: the dump receiver runs on PHP.",
                "Pasang versi PHP terlebih dahulu: penerima dump berjalan dengan PHP."
            ))
        })?
    };
    let dir = paths::php_dir(&line);
    Ok(Spec {
        id: SERVICE_ID.into(),
        program: dir.join("php.exe"),
        args: vec![
            "-c".into(),
            dir.join("php.ini").into(),
            server_script()?.into(),
            PORT.to_string().into(),
            file().into(),
        ],
        cwd: config_dir().join("runtime"),
        env: Vec::new(),
        log: paths::logs_dir().join("dumps.log"),
        port: PORT,
        probe: Probe::Tcp,
        stop: None,
    })
}

/// The newest dumps first, at most `SHOWN`, each with the site it came from
/// (`site`, or null). Lines that don't parse are skipped.
pub fn read(sites: &[Site], tld: &str) -> Vec<serde_json::Value> {
    let text = fs::read_to_string(file()).unwrap_or_default();
    let mut dumps = parse_newest(&text, SHOWN);
    for d in &mut dumps {
        let site = site_of(d, sites, tld);
        d["site"] = site.map_or(serde_json::Value::Null, serde_json::Value::from);
    }
    dumps
}

/// The site a dump came from: the host of its request (`blog.test`, or
/// `api.blog.test` under a wildcard), else the site folder holding the file
/// that called dump() (artisan commands, and dumps saved before Zefaro kept
/// the request).
pub fn site_of(dump: &serde_json::Value, sites: &[Site], tld: &str) -> Option<String> {
    let text = |k: &str| dump.get(k).and_then(|v| v.as_str());
    if let Some(host) = text("uri").and_then(host_of) {
        let local = [tld, "localhost"].iter().find_map(|t| host.strip_suffix(&format!(".{t}")).map(str::to_owned));
        if let Some(local) = local {
            // The longest name that the host is, or ends with.
            let hit = sites
                .iter()
                .filter(|s| {
                    let name = s.name.to_ascii_lowercase();
                    local == name || local.ends_with(&format!(".{name}"))
                })
                .max_by_key(|s| s.name.len());
            if let Some(s) = hit {
                return Some(s.name.clone());
            }
        }
    }
    let file = norm(text("file")?);
    sites
        .iter()
        .filter(|s| {
            let root = norm(&s.path);
            !root.is_empty() && (file == root || file.starts_with(&format!("{}/", root.trim_end_matches('/'))))
        })
        .max_by_key(|s| s.path.len())
        .map(|s| s.name.clone())
}

/// `http://Blog.test:8080/x?y` → `blog.test`.
fn host_of(uri: &str) -> Option<String> {
    let rest = uri.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?.split(':').next()?;
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

/// Windows paths compare without case, with forward slashes.
fn norm(path: &str) -> String {
    path.replace('\\', "/").to_ascii_lowercase()
}

pub fn parse_newest(text: &str, limit: usize) -> Vec<serde_json::Value> {
    text.lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|v| v.get("node").is_some())
        .take(limit)
        .collect()
}

pub fn clear() -> AppResult<()> {
    for path in [file(), PathBuf::from(format!("{}.old", file().display()))] {
        match fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_first_and_bad_lines_skipped() {
        let text = "{\"id\":\"1\",\"node\":{\"t\":\"int\",\"v\":1}}\nnot json\n{\"id\":\"2\",\"node\":{\"t\":\"null\"}}\n{\"id\":\"3\"}\n";
        let out = parse_newest(text, 10);
        let ids: Vec<&str> = out.iter().map(|v| v["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["2", "1"]);
        assert_eq!(parse_newest(text, 1).len(), 1);
        assert_eq!(format(), "tcp://127.0.0.1:9912");
    }

    fn site(name: &str, path: &str) -> Site {
        Site {
            name: name.into(),
            path: path.into(),
            url: format!("http://{name}.test"),
            secured: false,
            php_version: "8.4".into(),
            kind: "linked".into(),
            framework: None,
            proxy: None,
        }
    }

    #[test]
    fn dumps_name_their_site_by_host_then_by_file() {
        let sites = [
            site("blog", r"C:\Users\dev\sites\blog"),
            site("api", r"C:\Users\dev\code\api"),
            site("shop.api", r"C:\Users\dev\code\shop-api"),
        ];
        let of = |v: serde_json::Value| site_of(&v, &sites, "test");
        assert_eq!(of(serde_json::json!({ "uri": "http://blog.test/posts?x=1" })).as_deref(), Some("blog"));
        assert_eq!(of(serde_json::json!({ "uri": "https://Blog.test:8443/" })).as_deref(), Some("blog"));
        assert_eq!(of(serde_json::json!({ "uri": "http://blog.localhost/" })).as_deref(), Some("blog"));
        // A wildcard subdomain, and the longer name winning over its suffix.
        assert_eq!(of(serde_json::json!({ "uri": "http://tenant1.api.test/" })).as_deref(), Some("api"));
        assert_eq!(of(serde_json::json!({ "uri": "http://shop.api.test/" })).as_deref(), Some("shop.api"));
        // artisan: no request, so the file says which site.
        let cli = serde_json::json!({ "command": "artisan tinker", "file": "c:/users/dev/code/API/app/Models/User.php" });
        assert_eq!(of(cli).as_deref(), Some("api"));
        // "api" must not claim "api-old", a sibling folder sharing its prefix.
        assert_eq!(of(serde_json::json!({ "file": r"C:\Users\dev\code\api-old\x.php" })), None);
        assert_eq!(of(serde_json::json!({ "uri": "http://example.com/", "file": r"D:\elsewhere\x.php" })), None);
        assert_eq!(of(serde_json::json!({ "uri": "not a uri" })), None);
    }
}
