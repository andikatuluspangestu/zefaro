//! Meilisearch, the search engine Laravel Scout talks to. Listens on
//! 127.0.0.1:7700 in development mode without a master key (Scout's
//! MEILISEARCH_KEY stays empty) and never sends usage analytics. Its own
//! preview page opens at the address. The index lives in Zefaro's data folder.

use crate::engine::supervisor::{Probe, Spec};
use crate::engine::{net, paths, progress};
use crate::error::{AppError, AppResult};
use std::fs;
use std::path::PathBuf;

pub const VERSION: &str = "1.56.1";
pub const SERVICE_ID: &str = "meilisearch";
pub const PORT: u16 = 7700;
pub const DOWNLOAD_MB: u32 = 337;

/// meilisearch-windows-amd64.exe (the MIT-licensed community build) from
/// Meilisearch's GitHub release; SHA-256 = the digest GitHub publishes for it.
const URL: &str = "https://github.com/meilisearch/meilisearch/releases/download/v1.56.1/meilisearch-windows-amd64.exe";
const SHA256: &str = "ac6d2506cafe862c93a6add533e125a19852339ec21303413120bde84aad3a48";

#[derive(Clone, Debug)]
pub struct Layout {
    pub exe: PathBuf,
    /// data.ms (the index), dumps and snapshots.
    pub data: PathBuf,
    pub log: PathBuf,
    pub port: u16,
}

impl Layout {
    pub fn standard() -> Self {
        Self {
            exe: paths::bin_dir().join("meilisearch").join("meilisearch.exe"),
            data: paths::data_dir().join("meilisearch"),
            log: paths::logs_dir().join("meilisearch.log"),
            port: PORT,
        }
    }
}

pub fn installed(l: &Layout) -> bool {
    l.exe.is_file()
}

/// Download on first use (checked), and make the data folder.
pub fn prepare(l: &Layout) -> AppResult<()> {
    if !installed(l) {
        progress::scope(SERVICE_ID, || {
            fs::create_dir_all(l.exe.parent().unwrap())?;
            let download = l.exe.with_file_name("meilisearch.download");
            let hash = net::download(URL, &download, |done, total| progress::report("download", done, total))?;
            if !hash.eq_ignore_ascii_case(SHA256) {
                let _ = fs::remove_file(&download);
                return Err(AppError::msg(crate::tr!(
                    "The Meilisearch download didn't match its checksum, so Zefaro deleted it.",
                    "Unduhan Meilisearch tidak cocok dengan checksum-nya, jadi Zefaro menghapusnya."
                )));
            }
            fs::rename(&download, &l.exe)?;
            Ok(())
        })?;
    }
    fs::create_dir_all(&l.data)?;
    Ok(())
}

pub fn args(l: &Layout) -> Vec<std::ffi::OsString> {
    let d = |name: &str| -> std::ffi::OsString { l.data.join(name).into() };
    vec![
        "--db-path".into(),
        d("data.ms"),
        "--dump-dir".into(),
        d("dumps"),
        "--snapshot-dir".into(),
        d("snapshots"),
        "--http-addr".into(),
        format!("127.0.0.1:{}", l.port).into(),
        "--env".into(),
        "development".into(),
        "--no-analytics".into(),
    ]
}

pub fn spec(l: &Layout) -> Spec {
    Spec {
        id: SERVICE_ID.into(),
        program: l.exe.clone(),
        args: args(l),
        cwd: l.data.clone(),
        env: Vec::new(),
        log: l.log.clone(),
        port: l.port,
        probe: Probe::Tcp,
        // Its store survives being ended; there's no shutdown command.
        stop: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_on_loopback_without_analytics() {
        let l = Layout { exe: r"C:\z\meilisearch.exe".into(), data: r"C:\z\data\meilisearch".into(), log: r"C:\z\m.log".into(), port: 7700 };
        let args: Vec<String> = args(&l).iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|w| w == ["--http-addr", "127.0.0.1:7700"]));
        assert!(args.windows(2).any(|w| w == ["--env", "development"]));
        assert!(args.contains(&"--no-analytics".to_owned()));
        assert!(args.windows(2).any(|w| w[0] == "--db-path" && w[1].ends_with(r"meilisearch\data.ms")));
    }

    /// Meilisearch for real (downloaded into a temp folder) on a spare port:
    /// healthy, and it indexes and finds a document without a key.
    #[test]
    #[ignore = "downloads Meilisearch (337 MB) into a temp folder (run with --ignored)"]
    fn live_meilisearch_indexes_and_searches_without_a_key() {
        use crate::engine::supervisor::Supervisor;
        let root = std::env::temp_dir().join(format!("zefaro-meili-live-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let l = Layout { exe: root.join("bin").join("meilisearch.exe"), data: root.join("data"), log: root.join("m.log"), port: 57700 };
        prepare(&l).expect("download Meilisearch");
        let sup = Supervisor::default();
        sup.start(spec(&l)).expect("start Meilisearch");
        let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(20)).build();
        let base = "http://127.0.0.1:57700";
        let health = agent.get(&format!("{base}/health")).call().unwrap().into_string().unwrap();
        assert!(health.contains("available"), "{health}");
        agent
            .post(&format!("{base}/indexes/products/documents"))
            .set("Content-Type", "application/json")
            .send_string(r#"[{"id":1,"name":"Kopi Arabika Gayo"},{"id":2,"name":"Teh Melati"}]"#)
            .unwrap();
        let mut found = String::new();
        for _ in 0..40 {
            found = agent.get(&format!("{base}/indexes/products/search?q=arabika")).call().map(|r| r.into_string().unwrap_or_default()).unwrap_or_default();
            if found.contains("Gayo") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        sup.stop(SERVICE_ID).unwrap();
        let _ = fs::remove_dir_all(&root);
        assert!(found.contains("Kopi Arabika Gayo") && !found.contains("Teh Melati"), "{found}");
    }
}
