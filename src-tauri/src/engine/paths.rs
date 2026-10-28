//! Where Zefaro keeps things on disk, all under `~/.config/zefaro`.

use crate::config::config_dir;
use std::path::PathBuf;

/// Shims (`php.bat`, `composer.bat`, `laravel.bat`) and tool binaries.
/// This is the folder users add to PATH.
pub fn bin_dir() -> PathBuf {
    config_dir().join("bin")
}

pub fn php_root() -> PathBuf {
    bin_dir().join("php")
}

/// One folder per PHP line, e.g. `bin/php/8.5`.
pub fn php_dir(minor: &str) -> PathBuf {
    php_root().join(minor)
}

/// The nginx binary distribution (nginx.exe, conf/mime.types, …).
pub fn nginx_dir() -> PathBuf {
    bin_dir().join("nginx")
}

/// nginx's prefix: Zefaro's generated nginx.conf, per-site configs, the default
/// page, and the logs/ and temp/ folders nginx expects under its prefix.
pub fn nginx_runtime() -> PathBuf {
    config_dir().join("nginx")
}

/// Database files (MariaDB's data directory).
pub fn data_dir() -> PathBuf {
    config_dir().join("data")
}

/// PHP web apps Zefaro serves itself (phpMyAdmin).
pub fn apps_dir() -> PathBuf {
    config_dir().join("apps")
}

/// Service logs (php-<ver>.log, nginx-error.log, nginx-access.log, …).
pub fn logs_dir() -> PathBuf {
    config_dir().join("logs")
}

pub fn downloads_dir() -> PathBuf {
    config_dir().join("downloads")
}

/// Mozilla CA bundle, referenced from php.ini so curl/openssl can verify HTTPS.
pub fn cacert() -> PathBuf {
    config_dir().join("cacert.pem")
}

pub fn composer_phar() -> PathBuf {
    bin_dir().join("composer.phar")
}

/// Zefaro's own COMPOSER_HOME, so global packages never touch a Composer setup
/// the user already has.
pub fn composer_home() -> PathBuf {
    config_dir().join("composer")
}

pub fn laravel_bin() -> PathBuf {
    composer_home()
        .join("vendor")
        .join("laravel")
        .join("installer")
        .join("bin")
        .join("laravel")
}
