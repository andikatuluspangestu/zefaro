//! Node.js: the official Windows builds from nodejs.org, one folder per major
//! line under `bin\node\<major>`, and the active line exposed on the command
//! line through `bin\node.bat`, `npm.bat`, `npx.bat` and `corepack.bat`.
//!
//! Every download is checked against the SHA-256 that nodejs.org publishes in
//! the release's SHASUMS256.txt.

use crate::engine::{net, paths, process};
use crate::error::{AppError, AppResult};
use crate::model::InstallProgress;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const SERVICE_ID: &str = "node";
const INDEX_URL: &str = "https://nodejs.org/dist/index.json";
const DIST: &str = "https://nodejs.org/dist";
const VERSION_MARKER: &str = ".zefaro-version";
/// An LTS line still counts as maintained if it shipped a release this recently.
const MAINTAINED_DAYS: i64 = 183;
/// Command-line shims, each pointing at the file of the same role in the active line.
const SHIMS: &[(&str, &str)] = &[
    ("node.bat", "node.exe"),
    ("npm.bat", "npm.cmd"),
    ("npx.bat", "npx.cmd"),
    ("corepack.bat", "corepack.cmd"),
];

/// The newest build of one major line.
#[derive(Clone, Debug, PartialEq)]
pub struct Release {
    pub major: String,
    /// e.g. "24.22.1" (without the "v").
    pub version: String,
    /// LTS codename ("Krypton"); None for the Current line.
    pub lts: Option<String>,
    pub npm: Option<String>,
    /// Release date, "YYYY-MM-DD".
    pub date: String,
}

impl Release {
    fn file(&self) -> String {
        format!("node-v{}-win-x64.zip", self.version)
    }
}

pub fn fetch_releases() -> AppResult<Vec<Release>> {
    let json: serde_json::Value = net::get_json(INDEX_URL)?;
    let today = time::OffsetDateTime::now_utc().date();
    let releases = pick_releases(&json, today);
    if releases.is_empty() {
        return Err(AppError::msg(crate::tr!(
            "The Node.js release list has no Windows builds.",
            "Daftar rilis Node.js tidak berisi build Windows."
        )));
    }
    Ok(releases)
}

fn parse_date(s: &str) -> Option<time::Date> {
    let mut p = s.split('-').map(|x| x.parse::<i32>().ok());
    let (y, m, d) = (p.next()??, p.next()??, p.next()??);
    time::Date::from_calendar_date(y, time::Month::try_from(m as u8).ok()?, d as u8).ok()
}

/// Newest win-x64 build of each line worth offering, newest line first: the
/// Current line, plus every LTS line that is still getting releases.
pub fn pick_releases(json: &serde_json::Value, today: time::Date) -> Vec<Release> {
    let mut newest: BTreeMap<u32, Release> = BTreeMap::new();
    for r in json.as_array().into_iter().flatten() {
        let Some(version) = r["version"].as_str().and_then(|v| v.strip_prefix('v')) else {
            continue;
        };
        let has_zip = r["files"].as_array().is_some_and(|f| f.iter().any(|x| x == "win-x64-zip"));
        let Some(major) = version.split('.').next().and_then(|m| m.parse::<u32>().ok()) else {
            continue;
        };
        if !has_zip || newest.contains_key(&major) {
            continue; // index.json lists newest first
        }
        newest.insert(
            major,
            Release {
                major: major.to_string(),
                version: version.to_owned(),
                lts: r["lts"].as_str().map(str::to_owned),
                npm: r["npm"].as_str().map(str::to_owned),
                date: r["date"].as_str().unwrap_or_default().to_owned(),
            },
        );
    }
    let current = newest.keys().max().copied();
    let cutoff = today - time::Duration::days(MAINTAINED_DAYS);
    newest
        .into_iter()
        .rev()
        .filter(|(major, r)| {
            Some(*major) == current
                || (r.lts.is_some() && parse_date(&r.date).is_some_and(|d| d >= cutoff))
        })
        .map(|(_, r)| r)
        .collect()
}

pub fn root() -> PathBuf {
    paths::bin_dir().join("node")
}

pub fn dir(major: &str) -> PathBuf {
    root().join(major)
}

pub fn is_installed(major: &str) -> bool {
    !major.is_empty() && dir(major).join("node.exe").is_file()
}

/// Installed lines: major → exact version.
pub fn installed() -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let Ok(entries) = fs::read_dir(root()) else {
        return out;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.parse::<u32>().is_err() || !entry.path().join("node.exe").is_file() {
            continue;
        }
        let version = fs::read_to_string(entry.path().join(VERSION_MARKER))
            .map(|s| s.trim().to_owned())
            .unwrap_or_else(|_| name.clone());
        out.insert(name, version);
    }
    out
}

/// The SHA-256 nodejs.org lists for `file` in a release's SHASUMS256.txt.
pub fn checksum_for(sums: &str, file: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hash, name) = line.split_once(char::is_whitespace)?;
        (name.trim() == file && hash.len() == 64).then(|| hash.to_lowercase())
    })
}

/// Download, verify and unpack one line. Re-installing replaces it with the
/// newest build of that line.
pub fn install(release: &Release, progress: impl FnMut(InstallProgress)) -> AppResult<()> {
    install_into(&root(), &paths::downloads_dir(), release, progress)
}

/// `install`, into `root\<major>` with downloads in `scratch` (tests use temp folders).
pub fn install_into(
    root: &Path,
    scratch: &Path,
    release: &Release,
    mut progress: impl FnMut(InstallProgress),
) -> AppResult<()> {
    let mut report = |phase: &str, downloaded: u64, total: Option<u64>| {
        progress(InstallProgress { version: release.major.clone(), phase: phase.into(), downloaded, total })
    };

    report("download", 0, None);
    let file = release.file();
    let base = format!("{DIST}/v{}", release.version);
    let sums = net::get_text(&format!("{base}/SHASUMS256.txt"))?;
    let expected = checksum_for(&sums, &file)
        .ok_or_else(|| {
            AppError::msg(crate::tr!(
                format!("nodejs.org doesn't publish a checksum for {file}."),
                format!("nodejs.org tidak menerbitkan checksum untuk {file}.")
            ))
        })?;
    let zip_path = scratch.join(&file);
    let hash = net::download(&format!("{base}/{file}"), &zip_path, |done, total| report("download", done, total))?;
    if hash != expected {
        let _ = fs::remove_file(&zip_path);
        return Err(AppError::msg(crate::tr!(
            format!("{file} failed its checksum check, so the download is damaged. Try again."),
            format!("{file} gagal dalam pemeriksaan checksum, jadi unduhannya rusak. Coba lagi.")
        )));
    }

    // Unpack beside the target and swap in only once complete.
    report("extract", 0, None);
    let target = root.join(&release.major);
    let staging = root.join(format!(".{}.staging", release.major));
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;
    zip::ZipArchive::new(fs::File::open(&zip_path)?)?.extract(&staging)?;
    let inner = staging.join(format!("node-v{}-win-x64", release.version));
    if !inner.join("node.exe").is_file() {
        let _ = fs::remove_dir_all(&staging);
        return Err(AppError::msg(crate::tr!(
            "The downloaded archive doesn't contain node.exe.",
            "Arsip yang diunduh tidak berisi node.exe."
        )));
    }
    fs::write(inner.join(VERSION_MARKER), &release.version)?;
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| {
            let major = &release.major;
            AppError::msg(crate::tr!(
                format!("Zefaro couldn't replace Node.js {major} ({e}). Close anything using it and try again."),
                format!("Zefaro tidak dapat mengganti Node.js {major} ({e}). Tutup semua yang memakainya, lalu coba lagi.")
            ))
        })?;
    }
    fs::rename(&inner, &target)?;
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_file(&zip_path);

    report("configure", 0, None);
    let out = process::command(target.join("node.exe")).arg("--version").output()?;
    if !out.status.success() {
        let tail = process::tail(&out);
        return Err(AppError::msg(crate::tr!(
            format!("Node.js failed to start: {tail}"),
            format!("Node.js gagal berjalan: {tail}")
        )));
    }
    report("done", 0, None);
    Ok(())
}

/// Delete one installed line.
pub fn uninstall(major: &str) -> AppResult<()> {
    if major.parse::<u32>().is_err() {
        return Err(AppError::msg(crate::tr!(
            format!("{major} isn't a Node.js version line."),
            format!("{major} bukan lini versi Node.js.")
        )));
    }
    let target = dir(major);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| {
            AppError::msg(crate::tr!(
                format!("Zefaro couldn't remove Node.js {major} ({e}). Close anything using it and try again."),
                format!("Zefaro tidak dapat menghapus Node.js {major} ({e}). Tutup semua yang memakainya, lalu coba lagi.")
            ))
        })?;
    }
    Ok(())
}

/// Point the `node`, `npm`, `npx` and `corepack` shims at the active line, or
/// remove them when there is none. The line's folder goes first on PATH inside
/// the shim, so scripts npm runs use the same node.
pub fn write_shims(active: Option<&str>) -> AppResult<()> {
    let bin = paths::bin_dir();
    let Some(major) = active.filter(|m| is_installed(m)) else {
        for (shim, _) in SHIMS {
            let _ = fs::remove_file(bin.join(shim));
        }
        return Ok(());
    };
    fs::create_dir_all(&bin)?;
    let node_dir = dir(major);
    for (shim, target) in SHIMS {
        let path = node_dir.join(target);
        if !path.is_file() {
            let _ = fs::remove_file(bin.join(shim));
            continue;
        }
        fs::write(
            bin.join(shim),
            format!(
                "@echo off\r\nsetlocal\r\nset \"PATH={};%PATH%\"\r\n\"{}\" %*\r\n",
                node_dir.display(),
                path.display()
            ),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index() -> serde_json::Value {
        let r = |v: &str, lts: serde_json::Value, date: &str, zip: bool| {
            let files = if zip { vec!["win-x64-zip", "linux-x64"] } else { vec!["linux-x64"] };
            serde_json::json!({ "version": v, "date": date, "files": files, "npm": "11.0.0", "lts": lts })
        };
        serde_json::json!([
            r("v26.12.1", false.into(), "2026-10-21", true),
            r("v26.12.0", false.into(), "2026-10-01", true),
            r("v25.9.0", false.into(), "2026-03-31", true),
            r("v24.22.1", "Krypton".into(), "2026-10-20", true),
            r("v22.23.4", "Jod".into(), "2026-10-20", true),
            r("v20.20.2", "Iron".into(), "2026-03-24", true),
            r("v18.20.8", "Hydrogen".into(), "2025-03-27", true),
            r("v17.0.0", false.into(), "2021-10-19", false),
        ])
    }

    #[test]
    fn picks_current_and_maintained_lts_lines() {
        let today = parse_date("2026-10-27").unwrap();
        let picked = pick_releases(&index(), today);
        let majors: Vec<&str> = picked.iter().map(|r| r.major.as_str()).collect();
        assert_eq!(majors, ["26", "24", "22"]);
        assert_eq!(picked[0].version, "26.12.1");
        assert_eq!(picked[0].lts, None);
        assert_eq!(picked[1].lts.as_deref(), Some("Krypton"));
        assert_eq!(picked[1].file(), "node-v24.22.1-win-x64.zip");
    }

    #[test]
    fn finds_the_zip_checksum() {
        let sums = "aaaa  node-v24.22.1.tar.gz\n\
                    D2046D28C2C3DCD211AC5145C0BF30E2047EF9DFB306693C8C6E2ECCD8B95FA5  node-v24.22.1-win-x64.zip\n";
        assert_eq!(
            checksum_for(sums, "node-v24.22.1-win-x64.zip").as_deref(),
            Some("d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5")
        );
        assert_eq!(checksum_for(sums, "node-v24.22.1-win-x64.7z"), None);
    }

    /// Real download from nodejs.org into a temp folder (never Zefaro's own):
    /// verified, unpacked, and node/npm actually run.
    #[test]
    #[ignore = "network: downloads Node.js (~35 MB); run with --ignored"]
    fn live_install_from_nodejs_org() {
        let releases = fetch_releases().expect("index.json");
        let lts = releases.iter().find(|r| r.lts.is_some()).expect("an LTS line");
        let tmp = std::env::temp_dir().join(format!("zefaro-node-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let mut phases = Vec::new();
        install_into(&tmp.join("node"), &tmp, lts, |p| phases.push(p.phase)).expect("install");
        assert_eq!(phases.last().map(String::as_str), Some("done"));
        let node_dir = tmp.join("node").join(&lts.major);
        let out = process::command(node_dir.join("node.exe")).arg("--version").output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), format!("v{}", lts.version));
        let npm = process::command("cmd")
            .args(["/C"])
            .arg(node_dir.join("npm.cmd"))
            .arg("--version")
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&npm.stdout).trim(), lts.npm.clone().unwrap());
        let _ = fs::remove_dir_all(&tmp);
    }
}
