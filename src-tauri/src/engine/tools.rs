//! Composer and the Laravel installer, plus putting Zefaro's `bin` on PATH.
//!
//! Both tools live in Zefaro's own COMPOSER_HOME (`~/.config/zefaro/composer`) and
//! run with the active PHP line, so they never touch a Composer setup the user
//! already has.

use crate::engine::{net, paths, php, process};
use crate::error::{AppError, AppResult};
use crate::model::{ToolStatus, ToolsStatus};
use std::fs;
use std::path::Path;
use std::process::Command;

const COMPOSER_VERSIONS_URL: &str = "https://getcomposer.org/versions";
const COMPOSER_PHAR_URL: &str = "https://getcomposer.org/download/latest-stable/composer.phar";
const LARAVEL_PACKAGIST_URL: &str = "https://repo.packagist.org/p2/laravel/installer.json";
const LARAVEL_PACKAGE: &str = "laravel/installer";

/// Gather everything the PHP versions list shows about tooling. Network lookups that
/// fail (offline) simply leave `latest` empty.
pub fn status(active: &str) -> ToolsStatus {
    let php_exe = php::is_installed(active).then(|| paths::php_dir(active).join("php.exe"));

    let composer_installed = paths::composer_phar().is_file().then(|| {
        php_exe
            .as_deref()
            .and_then(composer_version)
            // Present but no PHP to ask it with yet.
            .unwrap_or_else(|| "installed".into())
    });
    let laravel_latest = laravel_latest();

    ToolsStatus {
        composer: tool(composer_installed, composer_latest()),
        laravel: tool(
            laravel_installed(),
            laravel_latest.as_ref().map(|(v, _)| v.clone()),
        ),
        laravel_requires_php: laravel_latest.and_then(|(_, req)| req).and_then(|r| min_php(&r)),
        active_php: php_exe.is_some().then(|| active.to_owned()),
        bin_dir: paths::bin_dir().display().to_string(),
        bin_on_path: bin_on_path(),
    }
}

fn tool(installed: Option<String>, latest: Option<String>) -> ToolStatus {
    let update_available =
        matches!((&installed, &latest), (Some(i), Some(l)) if i != l && i != "installed");
    ToolStatus { installed, latest, update_available }
}

fn composer(php_exe: &Path) -> Command {
    let mut cmd = process::command(php_exe);
    cmd.arg(paths::composer_phar())
        .env("COMPOSER_HOME", paths::composer_home())
        .env("COMPOSER_NO_INTERACTION", "1");
    cmd
}

fn composer_version(php_exe: &Path) -> Option<String> {
    let out = composer(php_exe).args(["--version", "--no-ansi"]).output().ok()?;
    parse_composer_version(&String::from_utf8_lossy(&out.stdout))
}

/// "Composer version 2.10.3 2025-10-01 12:00:00" → "2.10.3". Scans for the word
/// "version" so PHP warnings printed first don't break it.
pub fn parse_composer_version(output: &str) -> Option<String> {
    let mut words = output.split_whitespace();
    while let Some(word) = words.next() {
        if word == "version" {
            return words.next().map(str::to_owned);
        }
    }
    None
}

fn composer_latest() -> Option<String> {
    let v: serde_json::Value = net::get_json(COMPOSER_VERSIONS_URL).ok()?;
    v.get("stable")?.get(0)?.get("version")?.as_str().map(str::to_owned)
}

/// Install (or update to) the latest stable composer.phar, checksum-verified.
pub fn install_composer() -> AppResult<()> {
    let expected = net::get_text(&format!("{COMPOSER_PHAR_URL}.sha256"))?
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_lowercase();
    let hash = net::download(COMPOSER_PHAR_URL, &paths::composer_phar(), |_, _| {})?;
    if hash != expected {
        let _ = fs::remove_file(paths::composer_phar());
        return Err(AppError::msg(crate::tr!(
            "The composer.phar download failed its checksum check. Try again.",
            "Unduhan composer.phar gagal dalam pemeriksaan checksum. Coba lagi."
        )));
    }
    Ok(())
}

fn laravel_installed() -> Option<String> {
    let installed = paths::composer_home().join("vendor").join("composer").join("installed.json");
    parse_installed_version(&fs::read_to_string(installed).ok()?, LARAVEL_PACKAGE)
}

/// Version of `name` in Composer's vendor/composer/installed.json, without the
/// leading "v".
pub fn parse_installed_version(json: &str, name: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    // Composer 2 wraps the list in {"packages": [...]}; Composer 1 used a bare array.
    let list = v.get("packages").unwrap_or(&v).as_array()?;
    let pkg = list.iter().find(|p| p.get("name").and_then(|n| n.as_str()) == Some(name))?;
    pkg.get("version")?.as_str().map(|s| s.trim_start_matches('v').to_owned())
}

/// Latest stable Laravel installer on Packagist and its PHP constraint.
fn laravel_latest() -> Option<(String, Option<String>)> {
    let v: serde_json::Value = net::get_json(LARAVEL_PACKAGIST_URL).ok()?;
    parse_packagist_latest(&v, LARAVEL_PACKAGE)
}

/// Packagist's p2 metadata lists tagged releases newest first; skip
/// pre-releases (v6.0.0-beta1 …). Returns the version without its "v".
pub fn parse_packagist_latest(v: &serde_json::Value, name: &str) -> Option<(String, Option<String>)> {
    let releases = v.get("packages")?.get(name)?.as_array()?;
    let latest = releases.iter().find(|p| {
        p.get("version")
            .and_then(|x| x.as_str())
            .is_some_and(|ver| !ver.contains('-'))
    })?;
    let version = latest.get("version")?.as_str()?.trim_start_matches('v').to_owned();
    let php = latest
        .get("require")
        .and_then(|r| r.get("php"))
        .and_then(|p| p.as_str())
        .map(str::to_owned);
    Some((version, php))
}

/// Lowest PHP line a Composer constraint allows: "^8.2" / ">=8.2" / "^8.2|^9.0" → "8.2".
pub fn min_php(constraint: &str) -> Option<String> {
    let start = constraint.trim_start_matches(|c: char| !c.is_ascii_digit());
    let version: String = start.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let mut parts = version.split('.');
    let (major, minor) = (parts.next()?, parts.next().unwrap_or("0"));
    php::minor_key(&format!("{major}.{minor}")).map(|(a, b)| format!("{a}.{b}"))
}

/// `composer global require laravel/installer`, which installs or updates it
/// (`-W` lets it move to a new major version). Installs Composer first if needed.
pub fn install_laravel(php_exe: &Path) -> AppResult<()> {
    if !paths::composer_phar().is_file() {
        install_composer()?;
    }
    let out = composer(php_exe)
        .args(["global", "require", LARAVEL_PACKAGE, "-W", "--no-interaction", "--no-ansi"])
        .output()?;
    if !out.status.success() {
        let tail = process::tail(&out);
        return Err(AppError::msg(crate::tr!(
            format!("Composer couldn't install the Laravel installer:\n{tail}"),
            format!("Composer tidak dapat menginstal Laravel installer:\n{tail}")
        )));
    }
    Ok(())
}

/// Quote for a PowerShell single-quoted string literal.
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

use process::powershell;

/// Is Zefaro's bin folder on the *user* PATH (what new terminals get)? Reads the
/// raw registry value and expands each entry, so `%USERPROFILE%\…` forms match.
pub fn bin_on_path() -> bool {
    let dir = ps_quote(&paths::bin_dir().display().to_string());
    let script = format!(
        "$d={dir}.TrimEnd('\\');\
         $k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment');\
         $raw=if($k){{$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}}else{{''}};\
         $on=$false;\
         foreach($e in ($raw -split ';')){{if($e -and [Environment]::ExpandEnvironmentVariables($e).TrimEnd('\\') -ieq $d){{$on=$true}}}};\
         if($on){{'yes'}}else{{'no'}}"
    );
    powershell(&script).map(|o| o.trim() == "yes").unwrap_or(false)
}

/// Prepend Zefaro's bin folder to the user PATH (so Zefaro's php wins over others),
/// keeping the value's REG_EXPAND_SZ type and existing `%VAR%` entries intact,
/// then broadcast the change so newly opened terminals see it.
pub fn add_bin_to_path() -> AppResult<()> {
    let dir = ps_quote(&paths::bin_dir().display().to_string());
    let script = format!(
        "$d={dir}.TrimEnd('\\');\
         $k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment');\
         $raw=$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);\
         $keep=@($raw -split ';' | Where-Object {{ $_ -and ([Environment]::ExpandEnvironmentVariables($_).TrimEnd('\\') -ine $d) }});\
         $k.SetValue('Path', ((@($d) + $keep) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString);\
         $k.Close();\
         [Environment]::SetEnvironmentVariable('ZEFARO_ENV_REFRESH','1','User');\
         [Environment]::SetEnvironmentVariable('ZEFARO_ENV_REFRESH',$null,'User');\
         'ok'"
    );
    powershell(&script).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_composer_version_even_after_warnings() {
        let out = "PHP Warning: something\nComposer version 2.10.3 2025-10-01 12:00:00\n";
        assert_eq!(parse_composer_version(out).as_deref(), Some("2.10.3"));
        assert_eq!(parse_composer_version("garbage"), None);
    }

    #[test]
    fn reads_installed_version_from_both_composer_formats() {
        let v2 = r#"{"packages":[{"name":"x/y","version":"1.0.0"},{"name":"laravel/installer","version":"v5.32.0"}]}"#;
        assert_eq!(parse_installed_version(v2, LARAVEL_PACKAGE).as_deref(), Some("5.32.0"));
        let v1 = r#"[{"name":"laravel/installer","version":"v4.5.1"}]"#;
        assert_eq!(parse_installed_version(v1, LARAVEL_PACKAGE).as_deref(), Some("4.5.1"));
        assert_eq!(parse_installed_version(v2, "missing/pkg"), None);
    }

    #[test]
    fn picks_latest_stable_from_packagist_and_its_php_floor() {
        let v = serde_json::json!({ "packages": { "laravel/installer": [
            { "version": "v6.0.0-beta1", "require": { "php": "^8.4" } },
            { "version": "v5.32.0", "require": { "php": "^8.2" } },
            { "version": "v5.31.1" }
        ]}});
        let (version, php) = parse_packagist_latest(&v, LARAVEL_PACKAGE).unwrap();
        assert_eq!(version, "5.32.0");
        assert_eq!(php.as_deref(), Some("^8.2"));
    }

    #[test]
    #[ignore = "network: hits getcomposer.org and packagist (run with --ignored)"]
    fn live_latest_tool_versions() {
        assert!(composer_latest().is_some(), "composer versions endpoint");
        let (version, php) = laravel_latest().expect("packagist metadata");
        assert!(!version.starts_with('v') && !version.is_empty());
        assert!(php.as_deref().and_then(min_php).is_some(), "php constraint: {php:?}");
    }

    #[test]
    fn min_php_from_constraints() {
        assert_eq!(min_php("^8.2").as_deref(), Some("8.2"));
        assert_eq!(min_php(">=8.1.0").as_deref(), Some("8.1"));
        assert_eq!(min_php("^8.2|^9.0").as_deref(), Some("8.2"));
        assert_eq!(min_php("^8").as_deref(), Some("8.0"));
        assert_eq!(min_php("*"), None);
    }

    #[test]
    fn update_flag_ignores_unknown_installed_version() {
        assert!(tool(Some("5.31.1".into()), Some("5.32.0".into())).update_available);
        assert!(!tool(Some("5.32.0".into()), Some("5.32.0".into())).update_available);
        assert!(!tool(Some("installed".into()), Some("2.10.3".into())).update_available);
        assert!(!tool(None, Some("2.10.3".into())).update_available);
    }
}
