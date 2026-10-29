//! Projects the new site wizard makes besides Laravel apps: WordPress, and a
//! plain PHP folder with one page.

use crate::engine::{archive, net, paths};
use crate::error::{AppError, AppResult};
use std::fs;
use std::path::{Path, PathBuf};

const WP_VERSION_CHECK: &str = "https://api.wordpress.org/core/version-check/1.7/";
/// Every WordPress release zip lives here, each with a `.sha1` beside it.
const WP_RELEASES: &str = "https://downloads.wordpress.org/release/";

/// The newest WordPress release: (version, zip URL).
pub fn latest_wordpress() -> AppResult<(String, String)> {
    let v: serde_json::Value = net::get_json(WP_VERSION_CHECK)?;
    parse_wordpress_offer(&v).ok_or_else(|| {
        AppError::msg(crate::tr!(
            "WordPress.org didn't name a release Zefaro can download.",
            "WordPress.org tidak menyebut rilis yang bisa diunduh Zefaro."
        ))
    })
}

pub fn parse_wordpress_offer(v: &serde_json::Value) -> Option<(String, String)> {
    let offer = v.get("offers")?.as_array()?.iter().find(|o| o.get("response").and_then(|r| r.as_str()) != Some("development"))?;
    let version = offer.get("version")?.as_str()?.to_owned();
    let url = offer.get("download")?.as_str()?.to_owned();
    // Only WordPress.org's own release folder, over HTTPS.
    (url.starts_with(WP_RELEASES) && url.ends_with(".zip") && !version.is_empty()).then_some((version, url))
}

/// Download a WordPress release (kept in Zefaro's downloads folder for next
/// time) and check it against WordPress.org's SHA-1. Returns the zip's path.
pub fn download_wordpress(version: &str, url: &str) -> AppResult<PathBuf> {
    let expected = net::get_text(&format!("{url}.sha1"))?
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if expected.len() != 40 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::msg(crate::tr!(
            "WordPress.org's checksum for the download couldn't be read.",
            "Checksum WordPress.org untuk unduhan itu tidak bisa dibaca."
        )));
    }
    let dir = paths::downloads_dir();
    fs::create_dir_all(&dir)?;
    let zip = dir.join(format!("wordpress-{version}.zip"));
    if zip.is_file() && archive::sha1_file(&zip)? == expected {
        return Ok(zip);
    }
    net::download(url, &zip, |_, _| {})?;
    if archive::sha1_file(&zip)? != expected {
        let _ = fs::remove_file(&zip);
        return Err(AppError::msg(crate::tr!(
            "The WordPress download didn't match WordPress.org's checksum, so Zefaro deleted it. Try again.",
            "Unduhan WordPress tidak cocok dengan checksum WordPress.org, jadi Zefaro menghapusnya. Coba lagi."
        )));
    }
    Ok(zip)
}

/// Unpack the release's `wordpress/` folder into `dest`.
pub fn unpack_wordpress(zip: &Path, dest: &Path) -> AppResult<()> {
    archive::extract_inner(zip, "wordpress", dest)?;
    if !dest.join("wp-config-sample.php").is_file() {
        return Err(AppError::msg(crate::tr!(
            "The WordPress zip didn't hold the files Zefaro expected.",
            "Zip WordPress tidak berisi file yang diharapkan Zefaro."
        )));
    }
    Ok(())
}

/// wp-config.php from WordPress's sample: Zefaro's MariaDB as root (no
/// password, local only) and fresh secret keys.
pub fn wp_config(sample: &str, database: &str, port: u16, mut secret: impl FnMut() -> String) -> String {
    let mut text = sample
        .replace("'database_name_here'", &format!("'{database}'"))
        .replace("'username_here'", "'root'")
        .replace("'password_here'", "''")
        // 127.0.0.1, not localhost: MariaDB listens on IPv4 only.
        .replace("'localhost'", &format!("'127.0.0.1:{port}'"));
    while let Some(i) = text.find("'put your unique phrase here'") {
        text.replace_range(i..i + "'put your unique phrase here'".len(), &format!("'{}'", secret()));
    }
    text
}

/// 64 random characters for a WordPress secret key, without quotes or
/// backslashes so they sit safely in a PHP string.
pub fn random_secret() -> String {
    use ring::rand::SecureRandom;
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-./:;<=>?@[]^_{|}~";
    let mut bytes = [0u8; 64];
    let _ = ring::rand::SystemRandom::new().fill(&mut bytes);
    bytes.iter().map(|b| CHARS[*b as usize % CHARS.len()] as char).collect()
}

/// The one page of a new plain PHP site.
pub fn plain_index(name: &str) -> String {
    format!(
        r#"<?php
// The first page of {name}. Replace it with your own code.
?><!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{name}</title>
    <style>
        body {{ font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.6; color: #1f1d2b; }}
        code {{ background: #f3eefc; padding: .1rem .35rem; border-radius: .25rem; }}
    </style>
</head>
<body>
    <h1>{name}</h1>
    <p>This page runs on PHP <?= PHP_VERSION ?>. Edit <code>index.php</code> in <code><?= htmlspecialchars(__DIR__) ?></code> to start.</p>
</body>
</html>
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_wordpress_offer_from_its_own_site_only() {
        let v = json!({ "offers": [{ "response": "upgrade", "version": "7.1.4",
            "download": "https://downloads.wordpress.org/release/wordpress-7.1.4.zip" }] });
        assert_eq!(
            parse_wordpress_offer(&v),
            Some(("7.1.4".into(), "https://downloads.wordpress.org/release/wordpress-7.1.4.zip".into()))
        );
        let elsewhere = json!({ "offers": [{ "version": "7.1.4", "download": "http://example.com/wp.zip" }] });
        assert_eq!(parse_wordpress_offer(&elsewhere), None);
    }

    #[test]
    fn wp_config_points_at_zefaros_mariadb_with_fresh_keys() {
        let sample = "define( 'DB_NAME', 'database_name_here' );\ndefine( 'DB_USER', 'username_here' );\n\
                      define( 'DB_PASSWORD', 'password_here' );\ndefine( 'DB_HOST', 'localhost' );\n\
                      define( 'AUTH_KEY', 'put your unique phrase here' );\ndefine( 'NONCE_SALT', 'put your unique phrase here' );\n";
        let mut n = 0;
        let out = wp_config(sample, "blog", 3306, || {
            n += 1;
            format!("key{n}")
        });
        assert!(out.contains("'DB_NAME', 'blog'") && out.contains("'DB_USER', 'root'") && out.contains("'DB_PASSWORD', ''"));
        assert!(out.contains("'DB_HOST', '127.0.0.1:3306'"));
        assert!(out.contains("'AUTH_KEY', 'key1'") && out.contains("'NONCE_SALT', 'key2'"));
        assert!(!out.contains("put your unique phrase here"));
        let secret = random_secret();
        assert_eq!(secret.len(), 64);
        assert!(!secret.contains('\'') && !secret.contains('\\'));
    }
}
