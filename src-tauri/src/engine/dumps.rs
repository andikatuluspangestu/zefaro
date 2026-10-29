//! The Dumps page: `dump()` and `dd()` from sites, shown in Zefaro instead of
//! the page. Sites get `VAR_DUMPER_FORMAT=tcp://127.0.0.1:9912` from nginx, so
//! Symfony's VarDumper (which Laravel and Symfony use) sends each dump to a
//! small receiver Zefaro runs with the active PHP. When the receiver isn't
//! running, VarDumper prints into the page as usual.

use crate::config::{config_dir, ZefaroConfig};
use crate::engine::supervisor::{Probe, Spec};
use crate::engine::{paths, php};
use crate::error::{AppError, AppResult};
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

/// The newest dumps first, at most `SHOWN`. Lines that don't parse are skipped.
pub fn read() -> Vec<serde_json::Value> {
    let text = fs::read_to_string(file()).unwrap_or_default();
    parse_newest(&text, SHOWN)
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
}
