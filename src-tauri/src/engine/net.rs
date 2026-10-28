//! Minimal HTTP client for release metadata and downloads.

use crate::error::{AppError, AppResult};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

const USER_AGENT: &str = concat!("Zefaro/", env!("CARGO_PKG_VERSION"));

fn agent() -> AppResult<&'static ureq::Agent> {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    if let Some(agent) = AGENT.get() {
        return Ok(agent);
    }
    let tls = native_tls::TlsConnector::new()
        .map_err(|e| {
            AppError::msg(crate::tr!(
                format!("Zefaro couldn't set up TLS: {e}"),
                format!("Zefaro tidak dapat menyiapkan TLS: {e}")
            ))
        })?;
    let agent = ureq::AgentBuilder::new()
        .tls_connector(Arc::new(tls))
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(60))
        .user_agent(USER_AGENT)
        .build();
    Ok(AGENT.get_or_init(|| agent))
}

fn get(url: &str) -> AppResult<ureq::Response> {
    agent()?
        .get(url)
        .call()
        .map_err(|e| {
            AppError::msg(crate::tr!(
                format!("The request to {url} failed: {e}"),
                format!("Permintaan ke {url} gagal: {e}")
            ))
        })
}

pub fn get_text(url: &str) -> AppResult<String> {
    Ok(get(url)?.into_string()?)
}

pub fn get_json<T: serde::de::DeserializeOwned>(url: &str) -> AppResult<T> {
    Ok(serde_json::from_str(&get_text(url)?)?)
}

/// Stream `url` into `dest`, reporting `(downloaded, total)` as it goes, and
/// return the lowercase hex SHA-256 of what was written. Bytes land in a
/// `.part` file first so an interrupted download never looks complete.
pub fn download(
    url: &str,
    dest: &Path,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> AppResult<String> {
    let resp = get(url)?;
    let total = resp.header("Content-Length").and_then(|v| v.parse().ok());
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let part = dest.with_extension("part");
    let mut file = std::fs::File::create(&part)?;
    let mut reader = resp.into_reader();
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let (mut done, mut reported) = (0u64, 0u64);
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        hasher.update(&buf[..n]);
        done += n as u64;
        // Throttle: a 35 MB zip would otherwise fire ~550 events.
        if done - reported >= 512 * 1024 {
            on_progress(done, total);
            reported = done;
        }
    }
    file.flush()?;
    drop(file);
    on_progress(done, total);
    std::fs::rename(&part, dest)?;
    Ok(format!("{:x}", hasher.finalize()))
}
