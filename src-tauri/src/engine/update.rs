//! Is there a newer Zefaro, and installing it. Reads the latest release from the
//! project's public GitHub page. The lookup carries nothing but Zefaro's version
//! (in its User-Agent). Zefaro downloads and runs a new installer only when the
//! user asks for it: the file must come from this project's own release
//! downloads and match its published SHA-256, or it is deleted and never run.

use crate::engine::{net, paths};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

const LATEST_URL: &str = "https://api.github.com/repos/andikatuluspangestu/zefaro/releases/latest";
/// Where to send people when the lookup fails or finds nothing.
pub const RELEASES_URL: &str = "https://github.com/andikatuluspangestu/zefaro/releases";
/// Release files are only taken from this project's own download address.
const DOWNLOAD_PREFIX: &str = "https://github.com/andikatuluspangestu/zefaro/releases/download/";

/// What the installer is started with, by its NSIS script (checked against the
/// one the build generates): `/P` a progress window and no questions, `/UPDATE`
/// an update, which keeps the DNS rule, certificate authority and PATH entry
/// (the uninstall hook skips its cleanup), and `/R` open Zefaro again afterwards.
pub const INSTALLER_ARGS: [&str; 3] = ["/P", "/UPDATE", "/R"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    /// The latest release's version, without the leading "v".
    pub latest: String,
    pub newer: bool,
    /// The release's page, with its installer and notes.
    pub url: String,
    /// When it was published (ISO 8601), if GitHub says.
    pub published: Option<String>,
    /// The release has an installer Zefaro can download and check.
    pub can_install: bool,
    /// The installer's size in bytes, for the confirmation.
    pub installer_size: Option<u64>,
}

/// "v1.2.3", "1.2.3" or "1.2" → (1, 2, 3). Anything after a "-" (pre-release
/// tags) is ignored for the numbers.
pub fn parse_version(s: &str) -> Option<(u64, u64, u64)> {
    let s = s.trim().trim_start_matches(['v', 'V']);
    let core = s.split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    let major = parts.next()??;
    let minor = parts.next().unwrap_or(Some(0))?;
    let patch = parts.next().unwrap_or(Some(0))?;
    Some((major, minor, patch))
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    matches!((parse_version(latest), parse_version(current)), (Some(l), Some(c)) if l > c)
}

/// The installer of a release, and what it can be checked against.
#[derive(Debug, Clone, PartialEq)]
pub struct Installer {
    /// `Zefaro_1.2.0_x64-setup.exe`
    pub name: String,
    pub url: String,
    pub size: Option<u64>,
    /// The SHA-256 GitHub reports for the file, in lower-case hex.
    pub digest: Option<String>,
    /// The release's `SHA256SUMS.txt`.
    pub sums_url: Option<String>,
}

fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The installer in a release's asset list. Its name is exactly the one the
/// build writes for `version`, and its address must be a download of this project.
pub fn installer_of(release: &serde_json::Value, version: &str) -> Option<Installer> {
    let assets = release.get("assets")?.as_array()?;
    let named = |n: &str| assets.iter().find(|a| a.get("name").and_then(|v| v.as_str()) == Some(n));
    let own = |a: &serde_json::Value| {
        a.get("browser_download_url").and_then(|v| v.as_str()).filter(|u| u.starts_with(DOWNLOAD_PREFIX)).map(str::to_owned)
    };
    let name = format!("Zefaro_{version}_x64-setup.exe");
    let file = named(&name)?;
    Some(Installer {
        url: own(file)?,
        size: file.get("size").and_then(|v| v.as_u64()),
        digest: file
            .get("digest")
            .and_then(|v| v.as_str())
            .and_then(|d| d.strip_prefix("sha256:"))
            .filter(|h| is_sha256(h))
            .map(str::to_ascii_lowercase),
        sums_url: named("SHA256SUMS.txt").and_then(own),
        name,
    })
}

/// The hash listed for `name` in a `SHA256SUMS.txt` ("<hash> *<file>" per line).
pub fn checksum_for(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let (hash, file) = (parts.next()?, parts.next()?);
        (file.trim_start_matches('*') == name && is_sha256(hash)).then(|| hash.to_ascii_lowercase())
    })
}

/// The fields Zefaro reads from GitHub's "latest release" answer. Drafts and
/// pre-releases never come back from that endpoint.
pub fn from_release(json: &serde_json::Value, current: &str) -> Option<UpdateInfo> {
    let tag = json.get("tag_name")?.as_str()?;
    parse_version(tag)?;
    let latest = tag.trim_start_matches(['v', 'V']).to_owned();
    let installer = installer_of(json, &latest);
    Some(UpdateInfo {
        newer: is_newer(&latest, current),
        current: current.to_owned(),
        url: json.get("html_url").and_then(|v| v.as_str()).unwrap_or(RELEASES_URL).to_owned(),
        published: json.get("published_at").and_then(|v| v.as_str()).map(str::to_owned),
        can_install: installer.as_ref().is_some_and(|i| i.digest.is_some() || i.sums_url.is_some()),
        installer_size: installer.as_ref().and_then(|i| i.size),
        latest,
    })
}

fn latest_release() -> AppResult<(serde_json::Value, UpdateInfo)> {
    let current = env!("CARGO_PKG_VERSION");
    let json: serde_json::Value = net::get_json(LATEST_URL)?;
    let info = from_release(&json, current).ok_or_else(|| {
        AppError::msg(crate::tr!(
            "GitHub's answer didn't name a release Zefaro understands.",
            "Jawaban GitHub tidak menyebut rilis yang dipahami Zefaro."
        ))
    })?;
    Ok((json, info))
}

pub fn check() -> AppResult<UpdateInfo> {
    latest_release().map(|(_, info)| info)
}

/// The SHA-256 the installer must have. The release's `SHA256SUMS.txt` and the
/// checksum GitHub reports for the file are both used when there; if they
/// disagree, or neither exists, nothing is installed.
fn expected_hash(installer: &Installer) -> AppResult<String> {
    let listed = installer.sums_url.as_deref().and_then(|u| net::get_text(u).ok()).and_then(|t| checksum_for(&t, &installer.name));
    match (listed, &installer.digest) {
        (Some(a), Some(b)) if &a != b => Err(AppError::msg(crate::tr!(
            "The checksum in the release's SHA256SUMS.txt and the one GitHub reports for the installer disagree, so Zefaro won't install it.",
            "Checksum di SHA256SUMS.txt rilis dan yang dilaporkan GitHub untuk installer berbeda, jadi Zefaro tidak akan memasangnya."
        ))),
        (Some(hash), _) => Ok(hash),
        (None, Some(hash)) => Ok(hash.clone()),
        (None, None) => Err(AppError::msg(crate::tr!(
            "The release publishes no checksum for its installer, so Zefaro can't check it. Download it from the release page instead.",
            "Rilis tidak menerbitkan checksum untuk installer-nya, jadi Zefaro tidak bisa memeriksanya. Unduh dari halaman rilis."
        ))),
    }
}

/// How far an update has got: for the progress bar.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    /// "checking", "downloading", "verifying" or "installing".
    pub phase: &'static str,
    pub done: u64,
    pub total: Option<u64>,
}

static PROGRESS: Mutex<Option<UpdateProgress>> = Mutex::new(None);
static BUSY: AtomicBool = AtomicBool::new(false);

pub fn progress() -> Option<UpdateProgress> {
    PROGRESS.lock().unwrap().clone()
}

fn set_progress(phase: &'static str, done: u64, total: Option<u64>) {
    *PROGRESS.lock().unwrap() = Some(UpdateProgress { phase, done, total });
}

/// Clears the progress and the "one at a time" flag when an update attempt ends.
struct Attempt;

impl Attempt {
    fn begin() -> AppResult<Self> {
        if BUSY.swap(true, Ordering::AcqRel) {
            return Err(AppError::msg(crate::tr!("An update is already running.", "Pembaruan sedang berjalan.")));
        }
        Ok(Attempt)
    }
}

impl Drop for Attempt {
    fn drop(&mut self) {
        *PROGRESS.lock().unwrap() = None;
        BUSY.store(false, Ordering::Release);
    }
}

/// Download `url` to `dest` and check its SHA-256 against `expected`. A file
/// that doesn't match is deleted before the error is returned.
fn fetch_verified(url: &str, dest: &Path, expected: &str, mut on: impl FnMut(u64, Option<u64>)) -> AppResult<()> {
    let got = net::download(url, dest, &mut on)?;
    if got.eq_ignore_ascii_case(expected) {
        return Ok(());
    }
    let _ = std::fs::remove_file(dest);
    Err(AppError::msg(crate::tr!(
        "The downloaded installer doesn't match its published checksum, so Zefaro deleted it and won't run it.",
        "Installer yang diunduh tidak cocok dengan checksum yang diterbitkan, jadi Zefaro menghapusnya dan tidak akan menjalankannya."
    )))
}

/// Download the newest installer and check it. Returns where it is; the
/// caller stops the services, runs it with [`launch`] and exits.
pub fn download_installer() -> AppResult<PathBuf> {
    let _attempt = Attempt::begin()?;
    set_progress("checking", 0, None);
    let (json, info) = latest_release()?;
    if !info.newer {
        return Err(AppError::msg(crate::tr!(
            format!("Zefaro {} is already the latest version.", info.current),
            format!("Zefaro {} sudah versi terbaru.", info.current)
        )));
    }
    let installer = installer_of(&json, &info.latest).ok_or_else(|| {
        AppError::msg(crate::tr!(
            "This release has no installer Zefaro can download. Get it from the release page.",
            "Rilis ini tidak punya installer yang bisa diunduh Zefaro. Ambil dari halaman rilis."
        ))
    })?;
    let expected = expected_hash(&installer)?;

    let dir = paths::downloads_dir().join("update");
    let _ = std::fs::remove_dir_all(&dir);
    let dest = dir.join(&installer.name);
    set_progress("downloading", 0, installer.size);
    fetch_verified(&installer.url, &dest, &expected, |done, total| set_progress("downloading", done, total.or(installer.size)))?;
    set_progress("installing", 0, None);
    Ok(dest)
}

/// Start the installer on its own (it outlives Zefaro, which is about to exit).
pub fn launch(installer: &Path) -> AppResult<()> {
    if !installer.is_file() {
        return Err(AppError::msg(crate::tr!(
            "The installer isn't there any more. Try the update again.",
            "Installer sudah tidak ada. Coba perbarui lagi."
        )));
    }
    let mut cmd = std::process::Command::new(installer);
    cmd.args(INSTALLER_ARGS);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(|_| ()).map_err(|e| {
        AppError::msg(crate::tr!(
            format!("Windows couldn't start the installer: {e}"),
            format!("Windows tidak bisa memulai installer: {e}")
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const HASH: &str = "c72cee193dac194bab2daa70c356384fb98245d1a727eb8aaada2745d879a875";
    const URL: &str = "https://github.com/andikatuluspangestu/zefaro/releases/download/v1.2.0";

    fn release() -> serde_json::Value {
        json!({
            "tag_name": "v1.2.0",
            "html_url": "https://github.com/andikatuluspangestu/zefaro/releases/tag/v1.2.0",
            "published_at": "2026-10-30T01:00:00Z",
            "assets": [
                { "name": "SHA256SUMS.txt", "size": 93, "browser_download_url": format!("{URL}/SHA256SUMS.txt") },
                { "name": "Zefaro_1.2.0_x64-setup.exe", "size": 3343033, "digest": format!("sha256:{HASH}"),
                  "browser_download_url": format!("{URL}/Zefaro_1.2.0_x64-setup.exe") },
            ],
        })
    }

    #[test]
    fn versions_compare_by_number() {
        assert_eq!(parse_version("v1.0.10"), Some((1, 0, 10)));
        assert_eq!(parse_version("2.1"), Some((2, 1, 0)));
        assert_eq!(parse_version("1.2.0-beta.1"), Some((1, 2, 0)));
        assert_eq!(parse_version("latest"), None);
        assert!(is_newer("1.0.10", "1.0.9"));
        assert!(is_newer("v1.1.0", "1.0.1"));
        assert!(!is_newer("1.0.1", "1.0.1"));
        assert!(!is_newer("1.0.0", "1.0.1"));
        assert!(!is_newer("nonsense", "1.0.1"));
    }

    #[test]
    fn reads_githubs_latest_release() {
        let release = json!({
            "tag_name": "v1.0.2",
            "html_url": "https://github.com/andikatuluspangestu/zefaro/releases/tag/v1.0.2",
            "published_at": "2026-10-30T01:00:00Z",
        });
        let info = from_release(&release, "1.0.1").unwrap();
        assert_eq!(info.latest, "1.0.2");
        assert!(info.newer);
        assert!(info.url.ends_with("/v1.0.2"));
        assert_eq!(from_release(&release, "1.0.2").map(|i| i.newer), Some(false));
        assert_eq!(from_release(&json!({ "message": "Not Found" }), "1.0.1"), None);
        // No assets listed: nothing to install from, but the news still shows.
        assert!(!info.can_install && info.installer_size.is_none());
    }

    #[test]
    fn finds_the_installer_and_what_to_check_it_against() {
        let info = from_release(&release(), "1.1.0").unwrap();
        assert!(info.newer && info.can_install);
        assert_eq!(info.installer_size, Some(3343033));
        let i = installer_of(&release(), "1.2.0").unwrap();
        assert_eq!(i.name, "Zefaro_1.2.0_x64-setup.exe");
        assert_eq!(i.digest.as_deref(), Some(HASH));
        assert_eq!(i.sums_url.as_deref(), Some("https://github.com/andikatuluspangestu/zefaro/releases/download/v1.2.0/SHA256SUMS.txt"));
    }

    #[test]
    fn refuses_files_from_anywhere_but_this_projects_downloads() {
        let mut other = release();
        other["assets"][1]["browser_download_url"] = json!("https://example.com/Zefaro_1.2.0_x64-setup.exe");
        assert_eq!(installer_of(&other, "1.2.0"), None);
        assert!(!from_release(&other, "1.1.0").unwrap().can_install);

        // A look-alike name for another version is not the installer.
        assert_eq!(installer_of(&release(), "1.3.0"), None);
        // A sums file from elsewhere is ignored; the digest GitHub reports still counts.
        let mut sums = release();
        sums["assets"][0]["browser_download_url"] = json!("https://evil.test/SHA256SUMS.txt");
        let i = installer_of(&sums, "1.2.0").unwrap();
        assert!(i.sums_url.is_none() && i.digest.is_some());
        // A digest that isn't a SHA-256 is not believed.
        let mut bad = release();
        bad["assets"][1]["digest"] = json!("sha256:1234");
        assert!(installer_of(&bad, "1.2.0").unwrap().digest.is_none());
        // No checksum of any kind: it can't be checked, so it isn't offered.
        let mut none = release();
        none["assets"][1]["digest"] = json!(null);
        none["assets"].as_array_mut().unwrap().remove(0);
        assert!(!from_release(&none, "1.1.0").unwrap().can_install);
    }

    #[test]
    fn reads_the_checksum_listed_for_a_file() {
        let sums = format!("{HASH} *Zefaro_1.1.0_x64-setup.exe\n{} other.zip\n", "ab".repeat(32));
        assert_eq!(checksum_for(&sums, "Zefaro_1.1.0_x64-setup.exe").as_deref(), Some(HASH));
        assert_eq!(checksum_for(&sums, "other.zip").as_deref(), Some("ab".repeat(32).as_str()));
        assert_eq!(checksum_for(&sums, "missing.exe"), None);
        assert_eq!(checksum_for("not-a-hash *Zefaro_1.1.0_x64-setup.exe", "Zefaro_1.1.0_x64-setup.exe"), None);
        assert_eq!(checksum_for(&format!("{} *x.exe", HASH.to_uppercase()), "x.exe").as_deref(), Some(HASH));
    }

    /// Serves `body` once over plain HTTP on loopback, and returns the address.
    fn serve_once(body: &'static [u8]) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut s, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                let _ = s.read(&mut buf);
                let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = s.write_all(body);
            }
        });
        format!("http://{addr}/Zefaro_9.9.9_x64-setup.exe")
    }

    #[test]
    fn a_download_is_kept_only_when_its_checksum_matches() {
        use sha2::{Digest, Sha256};
        let body: &'static [u8] = b"pretend this is an installer";
        let right = format!("{:x}", Sha256::digest(body));
        let dir = std::env::temp_dir().join(format!("zefaro-update-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let good = dir.join("good.exe");
        let mut last = (0, None);
        fetch_verified(&serve_once(body), &good, &right, |d, t| last = (d, t)).expect("matching file is kept");
        assert_eq!(std::fs::read(&good).unwrap(), body);
        assert_eq!(last.0, body.len() as u64, "progress reaches the size");

        // Upper-case hex is the same hash.
        let upper = dir.join("upper.exe");
        fetch_verified(&serve_once(body), &upper, &right.to_uppercase(), |_, _| {}).unwrap();

        let bad = dir.join("bad.exe");
        let err = fetch_verified(&serve_once(body), &bad, &"0".repeat(64), |_, _| {}).unwrap_err().to_string();
        assert!(err.contains("doesn't match"), "{err}");
        assert!(!bad.exists() && !dir.join("bad.part").exists(), "a file that doesn't match is deleted");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn running_a_missing_installer_is_an_error() {
        let err = launch(&std::env::temp_dir().join("zefaro-no-such-installer.exe")).unwrap_err().to_string();
        assert!(err.contains("isn't there any more"), "{err}");
    }

    /// The flags must be ones the installer's NSIS script reads. Checked against
    /// the script of the last build, when it is on disk.
    #[test]
    fn installer_flags_are_ones_the_nsis_script_reads() {
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/release/nsis/x64/installer.nsi");
        let Ok(text) = std::fs::read_to_string(script) else { return };
        for flag in INSTALLER_ARGS {
            assert!(text.contains(&format!("GetOptions}} $CMDLINE \"{flag}\"")), "{flag} isn't read by the installer script");
        }
    }
}
