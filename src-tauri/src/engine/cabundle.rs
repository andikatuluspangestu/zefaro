//! The CA bundle PHP verifies HTTPS with: Mozilla's roots (curl's
//! cacert.pem) plus Zefaro's own CA, so PHP code calling a secured `.test`
//! site trusts it. php.ini's `curl.cainfo` and `openssl.cafile` point here.
//!
//! Mozilla's list changes when a CA is distrusted, so Zefaro downloads it again
//! once it's older than [`MAX_AGE`].

use crate::engine::{certs, paths, php};
use crate::error::AppResult;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

/// Refresh Mozilla's list when the copy is older than this.
pub const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

pub fn path() -> PathBuf {
    crate::config::config_dir().join("ca-bundle.pem")
}

/// The bundle's text: Mozilla's roots, then Zefaro's CA when it exists.
pub fn render(mozilla: &str, zefaro_ca: Option<&str>) -> String {
    let mut out = mozilla.trim_end().to_owned();
    out.push('\n');
    if let Some(ca) = zefaro_ca {
        out.push_str("\nZefaro Local CA (.test)\n=====================\n");
        out.push_str(ca.trim_end());
        out.push('\n');
    }
    out
}

/// Write the bundle from the current files. Without Mozilla's list there is
/// no bundle (PHP then uses its own defaults). Returns whether it exists.
pub fn rebuild() -> bool {
    let Ok(mozilla) = fs::read_to_string(paths::cacert()) else {
        let _ = fs::remove_file(path());
        return false;
    };
    let zefaro_ca = fs::read_to_string(certs::Layout::standard().ca_cert()).ok();
    let text = render(&mozilla, zefaro_ca.as_deref());
    if fs::read_to_string(path()).ok().as_deref() != Some(text.as_str()) {
        // PHP reads the file on each HTTPS request, so a running php-cgi
        // picks up the change without a restart.
        if fs::write(path(), text).is_err() {
            return path().is_file();
        }
    }
    true
}

/// When Mozilla's list was last downloaded.
pub fn updated() -> Option<SystemTime> {
    fs::metadata(paths::cacert()).and_then(|m| m.modified()).ok()
}

pub fn is_stale() -> bool {
    updated().and_then(|t| t.elapsed().ok()).is_none_or(|age| age > MAX_AGE)
}

/// Download Mozilla's list again (checksum-verified) and rebuild the bundle.
pub fn update() -> AppResult<()> {
    php::ensure_cacert()?;
    rebuild();
    Ok(())
}

/// At startup: refresh a stale list in the background, then rebuild. Offline
/// is fine; the old list stays.
pub fn refresh_if_stale() {
    if is_stale() && php::installed().len() > 0 {
        let _ = php::ensure_cacert();
    }
    rebuild();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_zefaro_ca_after_mozilla_roots() {
        let moz = "##\n## Bundle of CA Root Certificates\n-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n\n";
        let ca = "-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----\n";
        let out = render(moz, Some(ca));
        assert!(out.starts_with("##\n## Bundle"));
        assert!(out.ends_with("BBB\n-----END CERTIFICATE-----\n"));
        assert_eq!(out.matches("BEGIN CERTIFICATE").count(), 2);
        assert_eq!(render(moz, None).matches("BEGIN CERTIFICATE").count(), 1);
    }

    /// PHP with Zefaro's php.ini trusts a site certificate from Zefaro's CA
    /// through the bundle. Needs PHP 8.3 installed by Zefaro; uses a throwaway
    /// CA in the temp folder.
    #[test]
    #[ignore]
    fn live_php_trusts_a_site_certificate_through_the_bundle() {
        let root = std::env::temp_dir().join("zefaro-cabundle-test");
        let _ = fs::remove_dir_all(&root);
        let layout = certs::Layout::at(root.join("certs"));
        let site = certs::ensure_site(&layout, "test", "bundle.test").unwrap();
        let mozilla = fs::read_to_string(paths::cacert()).expect("cacert.pem from a PHP install");
        let bundle = root.join("ca-bundle.pem");
        fs::write(&bundle, render(&mozilla, Some(&fs::read_to_string(layout.ca_cert()).unwrap()))).unwrap();
        let check = |cafile: &std::path::Path| {
            let code = format!(
                "var_export(openssl_x509_checkpurpose(file_get_contents('{}'), X509_PURPOSE_SSL_SERVER, ['{}']));",
                site.cert.display().to_string().replace('\\', "/"),
                cafile.display().to_string().replace('\\', "/")
            );
            let out = crate::engine::process::command(paths::php_dir("8.3").join("php.exe"))
                .arg("-c")
                .arg(paths::php_dir("8.3").join("php.ini"))
                .args(["-r", &code])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).into_owned()
        };
        assert_eq!(check(&bundle), "true");
        assert_eq!(check(&paths::cacert()), "false");
        let _ = fs::remove_dir_all(root);
    }
}
