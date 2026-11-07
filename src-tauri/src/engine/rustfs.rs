//! RustFS, S3-compatible object storage for Laravel's `s3` disk without a cloud
//! account. Listens on 127.0.0.1:9000 (the S3 API) and 127.0.0.1:9001 (its web
//! console, for buckets and files), with Zefaro's local keys. Path-style
//! addressing, as Laravel's `AWS_USE_PATH_STYLE_ENDPOINT=true` expects.
//! RustFS replaces MinIO, which stopped publishing binaries in 2025.

use crate::engine::archive::{self, Archive};
use crate::engine::paths;
use crate::engine::supervisor::{Probe, Spec};
use crate::error::{AppError, AppResult};
use std::fs;
use std::path::{Path, PathBuf};

pub const VERSION: &str = "1.0.4";
pub const SERVICE_ID: &str = "rustfs";
pub const PORT: u16 = 9000;
pub const CONSOLE_PORT: u16 = 9001;
pub const DOWNLOAD_MB: u32 = 106;
/// Local keys only: RustFS listens on 127.0.0.1.
pub const ACCESS_KEY: &str = "zefaro";
pub const SECRET_KEY: &str = "zefaro-secret";
pub const REGION: &str = "us-east-1";

/// rustfs-windows-x86_64-v1.0.4.zip from RustFS's GitHub release; SHA-256 =
/// the digest GitHub publishes for the asset.
const ARCHIVE: Archive = Archive {
    name: "RustFS 1.0.4",
    url: "https://github.com/rustfs/rustfs/releases/download/1.0.4/rustfs-windows-x86_64-v1.0.4.zip",
    sha256: "2e3af0b187dd70435dfdefe5f61aae7eede5a21fc9a2a2f07e289f727adbcfa6",
    // Unpacked whole; `exe` finds the program wherever the zip keeps it.
    inner: "",
};

#[derive(Clone, Debug)]
pub struct Layout {
    pub base: PathBuf,
    /// The buckets and their objects.
    pub data: PathBuf,
    pub log: PathBuf,
    pub port: u16,
    pub console_port: u16,
}

impl Layout {
    pub fn standard() -> Self {
        Self {
            base: paths::bin_dir().join("rustfs"),
            data: paths::data_dir().join("rustfs"),
            log: paths::logs_dir().join("rustfs.log"),
            port: PORT,
            console_port: CONSOLE_PORT,
        }
    }
}

/// rustfs.exe in the unpacked release, at its top or one folder down.
pub fn exe(l: &Layout) -> Option<PathBuf> {
    let top = l.base.join("rustfs.exe");
    if top.is_file() {
        return Some(top);
    }
    fs::read_dir(&l.base).ok()?.flatten().map(|e| e.path().join("rustfs.exe")).find(|p| p.is_file())
}

pub fn installed(l: &Layout) -> bool {
    exe(l).is_some()
}

/// Download on first use (checked), and make the data folder.
pub fn prepare(l: &Layout, scratch: &Path, keep_zip: bool) -> AppResult<()> {
    archive::exclusive(&l.base, || {
        if !installed(l) {
            ARCHIVE.install(&l.base, scratch, keep_zip)?;
            if !installed(l) {
                return Err(AppError::msg(crate::tr!(
                    "The RustFS download has no rustfs.exe in it.",
                    "Unduhan RustFS tidak berisi rustfs.exe."
                )));
            }
        }
        fs::create_dir_all(&l.data)?;
        Ok(())
    })
}

/// The web console: its own listener, with the console under this path (the
/// listener's root is the S3 API too).
pub fn console_url(l: &Layout) -> String {
    format!("http://127.0.0.1:{}/rustfs/console/", l.console_port)
}

/// Its settings, as RustFS reads them from the environment.
pub fn env(l: &Layout) -> Vec<(String, String)> {
    [
        ("RUSTFS_ADDRESS", format!("127.0.0.1:{}", l.port)),
        ("RUSTFS_CONSOLE_ENABLE", "true".into()),
        ("RUSTFS_CONSOLE_ADDRESS", format!("127.0.0.1:{}", l.console_port)),
        ("RUSTFS_ACCESS_KEY", ACCESS_KEY.into()),
        ("RUSTFS_SECRET_KEY", SECRET_KEY.into()),
        ("RUSTFS_REGION", REGION.into()),
        // Logs go to the supervisor's file through stdout, not a folder of its own.
        ("RUST_LOG", "warn".into()),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v))
    .collect()
}

pub fn spec(l: &Layout) -> Spec {
    Spec {
        id: SERVICE_ID.into(),
        program: exe(l).unwrap_or_else(|| l.base.join("rustfs.exe")),
        args: vec!["server".into(), l.data.clone().into()],
        cwd: l.data.clone(),
        env: env(l),
        log: l.log.clone(),
        port: l.port,
        probe: Probe::Tcp,
        // Objects are written before a request is answered; ending it is safe.
        stop: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout(base: PathBuf) -> Layout {
        Layout { data: base.join("data"), log: base.join("r.log"), base: base.join("bin"), port: 9000, console_port: 9001 }
    }

    #[test]
    fn listens_on_loopback_with_zefaros_keys() {
        let l = layout(PathBuf::from(r"C:\z"));
        let env = env(&l);
        let get = |k: &str| env.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        assert_eq!(get("RUSTFS_ADDRESS"), Some("127.0.0.1:9000"));
        assert_eq!(get("RUSTFS_CONSOLE_ADDRESS"), Some("127.0.0.1:9001"));
        assert_eq!((get("RUSTFS_ACCESS_KEY"), get("RUSTFS_SECRET_KEY")), (Some(ACCESS_KEY), Some(SECRET_KEY)));
        let s = spec(&l);
        assert_eq!(s.args, [std::ffi::OsString::from("server"), l.data.clone().into()]);
    }

    /// RustFS for real, in a temp folder on spare ports (the zip is kept in
    /// `ZEFARO_RUSTFS_ZIP_DIR`, or downloaded there): the S3 API refuses an
    /// unsigned request the S3 way, and the console page loads.
    #[test]
    #[ignore = "downloads RustFS into a temp folder (run with --ignored)"]
    fn live_rustfs_answers_s3_and_its_console() {
        use crate::engine::supervisor::Supervisor;
        let root = std::env::temp_dir().join(format!("zefaro-rustfs-live-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let scratch = std::env::var_os("ZEFARO_RUSTFS_ZIP_DIR").map(PathBuf::from).unwrap_or_else(|| root.join("dl"));
        fs::create_dir_all(&scratch).unwrap();
        let l = Layout { base: root.join("bin"), data: root.join("data"), log: root.join("rustfs.log"), port: 59100, console_port: 59101 };
        prepare(&l, &scratch, true).expect("install RustFS");
        let sup = Supervisor::default();
        let started = sup.start(spec(&l));
        let log = fs::read_to_string(&l.log).unwrap_or_default();
        started.unwrap_or_else(|e| panic!("start RustFS: {e}\n{log}"));
        let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(20)).build();
        let s3 = match agent.get("http://127.0.0.1:59100/").call() {
            Ok(r) | Err(ureq::Error::Status(_, r)) => (r.status(), r.into_string().unwrap_or_default()),
            Err(e) => panic!("S3 API: {e}"),
        };
        assert!(s3.0 == 403 && s3.1.contains("AccessDenied"), "{s3:?}");
        // The console listener may come up a moment after the API.
        let get = |path: &str| match agent.get(&format!("http://127.0.0.1:59101{path}")).call() {
            Ok(r) | Err(ureq::Error::Status(_, r)) => (r.status(), r.into_string().unwrap_or_default()),
            Err(_) => (0, String::new()),
        };
        let mut version = (0, String::new());
        for _ in 0..60 {
            version = get("/rustfs/console/version");
            if version.0 == 200 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        let page = get(&console_url(&l).replace("http://127.0.0.1:59101", ""));
        let log = fs::read_to_string(&l.log).unwrap_or_default();
        sup.stop(SERVICE_ID).unwrap();
        let _ = fs::remove_dir_all(&root);
        assert_eq!(version.0, 200, "{version:?}\n{log}");
        assert!(page.0 == 200 && page.1.to_ascii_lowercase().contains("<html"), "{}: {}", page.0, &page.1[..page.1.len().min(300)]);
    }

    #[test]
    fn finds_the_program_at_the_top_or_one_folder_down() {
        let root = std::env::temp_dir().join(format!("zefaro-rustfs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let l = layout(root.clone());
        assert!(!installed(&l));
        fs::create_dir_all(l.base.join("rustfs-windows-x86_64")).unwrap();
        fs::write(l.base.join("rustfs-windows-x86_64").join("rustfs.exe"), b"MZ").unwrap();
        assert_eq!(exe(&l), Some(l.base.join("rustfs-windows-x86_64").join("rustfs.exe")));
        fs::write(l.base.join("rustfs.exe"), b"MZ").unwrap();
        assert_eq!(exe(&l), Some(l.base.join("rustfs.exe")));
        let _ = fs::remove_dir_all(&root);
    }
}
