//! Pinned third-party downloads: fetch a release archive, check it against
//! the SHA-256 recorded in Zefaro's source, and unpack it.

use crate::engine::locks::KeyedLocks;
use crate::engine::{net, paths, progress};
use crate::error::{AppError, AppResult};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::OnceLock;

/// Run `f` while holding the install lock for `dest`. Callers check "already
/// installed?" inside `f`. Without this, two starts at once (MariaDB, and
/// phpMyAdmin which also starts MariaDB) share the download and staging files
/// and delete them from under each other ("file not found").
pub fn exclusive<T>(dest: &Path, f: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
    static LOCKS: OnceLock<KeyedLocks> = OnceLock::new();
    let gate = LOCKS.get_or_init(KeyedLocks::default).get(&dest.display().to_string());
    let _held = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f()
}

/// Remove `*.staging` folders an interrupted install left behind. Called at
/// startup, before any install can be running.
pub fn remove_stale_staging() {
    for dir in [paths::bin_dir(), paths::apps_dir()] {
        let Ok(entries) = fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.extension().is_some_and(|e| e == "staging") {
                let _ = fs::remove_dir_all(path);
            }
        }
    }
}

/// A release zip pinned by URL and SHA-256. When bumping a version, update
/// the URL, hash and `inner` folder together, after verifying the release's
/// signature (see each module's ARCHIVE comment).
pub struct Archive {
    /// For messages, e.g. "MariaDB 11.8.9".
    pub name: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    /// The single top-level folder inside the zip; its contents become `dest`.
    pub inner: &'static str,
}

impl Archive {
    fn file_name(&self) -> &str {
        self.url.rsplit('/').next().unwrap_or("download.zip")
    }

    /// Download into `scratch` (reusing an intact earlier download), verify,
    /// and unpack into `dest`, replacing it. Extraction goes through a staging
    /// folder so a failure never leaves a half-unpacked `dest`. The zip is
    /// deleted afterwards unless `keep_zip`.
    pub fn install(&self, dest: &Path, scratch: &Path, keep_zip: bool) -> AppResult<()> {
        self.install_without(dest, scratch, keep_zip, &[])
    }

    /// Like [`install`](Self::install), but folders of `inner` named in
    /// `skip` are not unpacked (PostgreSQL's zip carries pgAdmin and docs).
    pub fn install_without(&self, dest: &Path, scratch: &Path, keep_zip: bool, skip: &[&str]) -> AppResult<()> {
        let zip_path = scratch.join(self.file_name());
        let cached = zip_path.is_file() && sha256_file(&zip_path)? == self.sha256;
        if !cached {
            let hash = net::download(self.url, &zip_path, |done, total| progress::report("download", done, total))?;
            if hash != self.sha256 {
                let _ = fs::remove_file(&zip_path);
                let name = self.name;
                return Err(AppError::msg(crate::tr!(
                    format!("The {name} download failed its checksum check. Try again."),
                    format!("Unduhan {name} gagal dalam pemeriksaan checksum. Coba lagi.")
                )));
            }
        }

        let staging = dest.with_extension("staging");
        if staging.exists() {
            fs::remove_dir_all(&staging)?;
        }
        fs::create_dir_all(&staging)?;
        let mut zip = zip::ZipArchive::new(fs::File::open(&zip_path)?)?;
        extract_except(&mut zip, &staging, self.inner, skip)?;
        let inner = staging.join(self.inner);
        if !inner.is_dir() {
            let _ = fs::remove_dir_all(&staging);
            let name = self.name;
            return Err(AppError::msg(crate::tr!(
                format!("The {name} archive doesn't have the folder layout Zefaro expects."),
                format!("Arsip {name} tidak punya susunan folder yang diharapkan Zefaro.")
            )));
        }
        if dest.exists() {
            fs::remove_dir_all(dest)?;
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&inner, dest)?;
        let _ = fs::remove_dir_all(&staging);
        // What follows (a data folder, a config) has no measurable progress.
        progress::report("setup", 0, None);
        if !keep_zip {
            let _ = fs::remove_file(&zip_path);
        }
        Ok(())
    }
}

/// Unpack every entry except those under `inner/<skipped folder>/`,
/// reporting how many entries are done.
fn extract_except(zip: &mut zip::ZipArchive<fs::File>, to: &Path, inner: &str, skip: &[&str]) -> AppResult<()> {
    let count = zip.len() as u64;
    for i in 0..zip.len() {
        if i % 64 == 0 {
            progress::report("extract", i as u64, Some(count));
        }
        let mut entry = zip.by_index(i)?;
        // enclosed_name refuses absolute paths and `..`.
        let Some(rel) = entry.enclosed_name() else { continue };
        let mut parts = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned());
        let top = parts.next().unwrap_or_default();
        let second = parts.next().unwrap_or_default();
        if top == inner && skip.iter().any(|s| s.eq_ignore_ascii_case(&second)) {
            continue;
        }
        let out = to.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        std::io::copy(&mut entry, &mut fs::File::create(&out)?)?;
    }
    Ok(())
}

/// Lowercase hex SHA-256 of a file, streamed.
pub fn sha256_file(path: &Path) -> AppResult<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Four threads install the same archive into the same folder at once —
    /// what happens when MariaDB and phpMyAdmin are started together.
    #[test]
    fn concurrent_installs_of_the_same_archive_dont_collide() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("zefaro-race-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let cache = root.join("cache");
        fs::create_dir_all(&cache).unwrap();
        let zip_path = cache.join("pkg.zip");
        let mut writer = zip::ZipWriter::new(fs::File::create(&zip_path).unwrap());
        writer.start_file("pkg/hello.txt", zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(b"hi").unwrap();
        writer.finish().unwrap();

        // The verified zip is already cached, so nothing is downloaded.
        let sha: &'static str = Box::leak(sha256_file(&zip_path).unwrap().into_boxed_str());
        let archive: &'static Archive = Box::leak(Box::new(Archive {
            name: "test package",
            url: "https://invalid.example/pkg.zip",
            sha256: sha,
            inner: "pkg",
        }));
        let dest = root.join("installed");
        let workers: Vec<_> = (0..4)
            .map(|_| {
                let (dest, cache) = (dest.clone(), cache.clone());
                std::thread::spawn(move || {
                    exclusive(&dest, || {
                        if dest.join("hello.txt").is_file() {
                            Ok(())
                        } else {
                            archive.install(&dest, &cache, false)
                        }
                    })
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap().expect("concurrent install failed");
        }
        assert_eq!(fs::read_to_string(dest.join("hello.txt")).unwrap(), "hi");
        assert!(!dest.with_extension("staging").exists(), "staging folder left behind");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn sha256_of_known_content() {
        let path = std::env::temp_dir().join(format!("zefaro-sha-{}.txt", std::process::id()));
        fs::write(&path, b"abc").unwrap();
        assert_eq!(
            sha256_file(&path).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = fs::remove_file(path);
    }
}
