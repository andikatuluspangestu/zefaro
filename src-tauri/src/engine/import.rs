//! Moving from XAMPP or Laragon: find their project folders so Zefaro can link
//! them where they are (nothing is copied or moved), and read the Windows
//! hosts file for entries that would send a `.test` name somewhere else.

use crate::engine::framework;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundProject {
    /// The folder's own name.
    pub folder: String,
    pub path: String,
    /// "laravel", "wordpress", … when Zefaro recognises it.
    pub framework: Option<String>,
}

/// XAMPP's htdocs ships these; they're XAMPP's own pages, not projects.
const XAMPP_OWN: &[&str] = &["dashboard", "img", "webalizer", "xampp", "forbidden", "restricted"];

/// Where XAMPP and Laragon keep projects when installed in the usual places:
/// ("xampp" | "laragon", the tool's folder, its projects folder).
pub fn detect() -> Vec<(&'static str, PathBuf, PathBuf)> {
    let mut found = Vec::new();
    for drive in ['C', 'D', 'E', 'F'] {
        let root = PathBuf::from(format!("{drive}:\\"));
        if !root.is_dir() {
            continue;
        }
        for (kind, folder, projects) in [("xampp", "xampp", "htdocs"), ("laragon", "laragon", "www")] {
            let tool = root.join(folder);
            if tool.join(projects).is_dir() {
                found.push((kind, tool.clone(), tool.join(projects)));
            }
        }
    }
    found
}

/// The project folders directly inside `dir`, by name.
pub fn scan(dir: &Path) -> Vec<FoundProject> {
    let mut out: Vec<FoundProject> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let folder = e.file_name().to_string_lossy().into_owned();
            if folder.starts_with('.') || XAMPP_OWN.contains(&folder.to_ascii_lowercase().as_str()) {
                return None;
            }
            let path = e.path();
            Some(FoundProject {
                framework: framework::detect(&path).map(str::to_owned),
                path: path.display().to_string(),
                folder,
            })
        })
        .collect();
    out.sort_by_key(|p| p.folder.to_ascii_lowercase());
    out
}

/// Names under `.{tld}` that the hosts file sends to an address other than
/// this computer, which would override Zefaro for those names.
pub fn hosts_overrides(hosts: &str, tld: &str) -> Vec<(String, String)> {
    let suffix = format!(".{tld}");
    let mut out = Vec::new();
    for line in hosts.lines() {
        let line = line.split('#').next().unwrap_or_default().trim();
        let mut parts = line.split_whitespace();
        let Some(ip) = parts.next() else { continue };
        let local = ip == "127.0.0.1" || ip == "::1" || ip.starts_with("127.") || ip == "0.0.0.0";
        if local {
            continue;
        }
        for name in parts {
            let name = name.to_ascii_lowercase();
            if name.ends_with(&suffix) || name == tld {
                out.push((name, ip.to_owned()));
            }
        }
    }
    out
}

pub fn hosts_path() -> PathBuf {
    let windows = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    windows.join("System32").join("drivers").join("etc").join("hosts")
}

/// Visual C++ runtime DLLs PHP, nginx and MariaDB for Windows load. Returns
/// the ones missing from System32.
pub fn missing_vc_runtime() -> Vec<&'static str> {
    let windows = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let system = windows.join("System32");
    ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"]
        .into_iter()
        .filter(|dll| !system.join(dll).is_file())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_lists_projects_and_skips_xampps_own_pages() {
        let dir = std::env::temp_dir().join(format!("zefaro-import-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        for name in ["shop", "Blog", "dashboard", "xampp", ".git"] {
            fs::create_dir_all(dir.join(name)).unwrap();
        }
        fs::write(dir.join("index.php"), "<?php").unwrap();
        fs::write(dir.join("shop").join("artisan"), "").unwrap();
        let found = scan(&dir);
        let names: Vec<&str> = found.iter().map(|p| p.folder.as_str()).collect();
        assert_eq!(names, ["Blog", "shop"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hosts_overrides_only_count_other_addresses() {
        let hosts = "127.0.0.1 localhost\n127.0.0.1 shop.test #laragon magic!\n\
                     10.0.0.5  api.test www.example.com\n# 10.0.0.6 old.test\n192.168.1.9 test\n";
        assert_eq!(
            hosts_overrides(hosts, "test"),
            [("api.test".to_owned(), "10.0.0.5".to_owned()), ("test".to_owned(), "192.168.1.9".to_owned())]
        );
    }
}
