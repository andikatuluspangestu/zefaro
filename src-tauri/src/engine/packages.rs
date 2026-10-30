//! A site's Composer packages, checked: `composer audit` (known security
//! advisories and abandoned packages) and `composer outdated` (newer
//! releases). Both read composer.lock, so the vendor folder isn't needed, and
//! both ask packagist.org, so they need the internet.

use crate::engine::laravel::{self, App};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use serde_json::Value;
use std::process::Output;

/// A known vulnerability in a locked package version.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Advisory {
    pub package: String,
    pub title: String,
    /// "critical" | "high" | "medium" | "low", when the advisory says.
    pub severity: Option<String>,
    pub cve: Option<String>,
    /// The advisory's page.
    pub link: Option<String>,
    /// Version constraint of the affected releases, e.g. ">=7.0.0,<7.4.5".
    pub affected_versions: String,
    /// The version in composer.lock.
    pub version: Option<String>,
    pub reported_at: Option<String>,
}

/// A package its maintainers no longer look after.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Abandoned {
    pub package: String,
    /// The package they suggest instead.
    pub replacement: Option<String>,
}

/// A package with a newer release than the one locked.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Outdated {
    pub name: String,
    pub version: String,
    pub latest: String,
    /// "semver-safe-update" (allowed by composer.json), "update-possible"
    /// (needs a constraint change, usually a major version) or "up-to-date".
    pub status: String,
    /// Required by composer.json itself, not by another package.
    pub direct: Option<bool>,
    pub description: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub advisories: Vec<Advisory>,
    pub abandoned: Vec<Abandoned>,
    pub outdated: Vec<Outdated>,
    /// Packages in composer.lock (including dev).
    pub locked: usize,
    /// Why a check couldn't run, each on its own: one failing leaves the other.
    pub audit_error: Option<String>,
    pub outdated_error: Option<String>,
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned)
}

/// `composer audit --format=json`. Composer writes `"advisories": []` when
/// there are none and an object keyed by package when there are some.
pub fn parse_audit(json: &str, versions: &dyn Fn(&str) -> Option<String>) -> AppResult<(Vec<Advisory>, Vec<Abandoned>)> {
    let root: Value = serde_json::from_str(json)?;
    let mut advisories = Vec::new();
    if let Some(map) = root.get("advisories").and_then(Value::as_object) {
        for (package, list) in map {
            // A list, or (from older Composer) an object keyed by index.
            let items: Vec<&Value> = match list {
                Value::Array(a) => a.iter().collect(),
                Value::Object(o) => o.values().collect(),
                _ => Vec::new(),
            };
            for a in items {
                advisories.push(Advisory {
                    package: text(a, "packageName").unwrap_or_else(|| package.clone()),
                    title: text(a, "title").unwrap_or_default(),
                    severity: text(a, "severity").map(|s| s.to_ascii_lowercase()),
                    cve: text(a, "cve"),
                    link: text(a, "link"),
                    affected_versions: text(a, "affectedVersions").unwrap_or_default(),
                    version: versions(package),
                    reported_at: text(a, "reportedAt"),
                });
            }
        }
    }
    let rank = |s: &Option<String>| match s.as_deref() {
        Some("critical") => 0,
        Some("high") => 1,
        Some("medium") => 2,
        Some("low") => 3,
        _ => 4,
    };
    advisories.sort_by(|a, b| rank(&a.severity).cmp(&rank(&b.severity)).then(a.package.cmp(&b.package)));
    let abandoned = root
        .get("abandoned")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(package, r)| Abandoned { package: package.clone(), replacement: r.as_str().map(str::to_owned) })
                .collect()
        })
        .unwrap_or_default();
    Ok((advisories, abandoned))
}

/// `composer outdated --format=json`: the list is under "locked" with
/// `--locked`, "installed" without. It also names abandoned packages, which
/// `composer audit --locked` leaves out.
pub fn parse_outdated(json: &str) -> AppResult<(Vec<Outdated>, Vec<Abandoned>)> {
    let root: Value = serde_json::from_str(json)?;
    let list = root.get("locked").or_else(|| root.get("installed")).and_then(Value::as_array);
    let abandoned = list
        .into_iter()
        .flatten()
        .filter_map(|p| match p.get("abandoned")? {
            Value::Bool(true) => Some(Abandoned { package: text(p, "name")?, replacement: None }),
            Value::String(r) => Some(Abandoned { package: text(p, "name")?, replacement: Some(r.clone()).filter(|r| !r.is_empty()) }),
            _ => None,
        })
        .collect();
    let mut out: Vec<Outdated> = list
        .into_iter()
        .flatten()
        .filter_map(|p| {
            Some(Outdated {
                name: text(p, "name")?,
                version: text(p, "version").unwrap_or_default(),
                latest: text(p, "latest").unwrap_or_default(),
                status: text(p, "latest-status").unwrap_or_default(),
                direct: p.get("direct-dependency").and_then(Value::as_bool),
                description: text(p, "description"),
            })
        })
        .filter(|p| p.status != "up-to-date")
        .collect();
    // Direct dependencies first, then major updates before safe ones.
    out.sort_by(|a, b| {
        (b.direct == Some(true)).cmp(&(a.direct == Some(true))).then(b.status.cmp(&a.status)).then(a.name.cmp(&b.name))
    });
    Ok((out, abandoned))
}

/// Package name → version, from composer.lock (packages and packages-dev).
pub fn locked_versions(lock: &str) -> Vec<(String, String)> {
    let Ok(root) = serde_json::from_str::<Value>(lock) else { return Vec::new() };
    ["packages", "packages-dev"]
        .iter()
        .filter_map(|k| root.get(*k).and_then(Value::as_array))
        .flatten()
        .filter_map(|p| Some((text(p, "name")?, text(p, "version").unwrap_or_default())))
        .collect()
}

/// The JSON a Composer run printed, or why there's none. Composer exits
/// non-zero when the audit finds something, so the exit code alone says nothing.
fn json_of(out: &Output) -> Result<String, String> {
    let stdout = String::from_utf8_lossy(&out.stdout);
    match stdout.find('{') {
        Some(at) => Ok(stdout[at..].to_owned()),
        None => {
            let err = String::from_utf8_lossy(&out.stderr);
            let msg = [err.trim(), stdout.trim()].into_iter().find(|s| !s.is_empty()).unwrap_or("").to_owned();
            Err(laravel::last_lines(&msg, 6))
        }
    }
}

fn run(app: &App, args: &[&str]) -> Result<String, String> {
    let args: Vec<String> = args.iter().map(|s| (*s).to_owned()).collect();
    let mut cmd = laravel::composer_command(app, &args).map_err(|e| e.to_string())?;
    let out = cmd.output().map_err(|e| e.to_string())?;
    json_of(&out)
}

/// Run both checks for a site's folder.
pub fn check(app: &App) -> AppResult<Report> {
    let lock = std::fs::read_to_string(app.path.join("composer.lock")).map_err(|_| {
        AppError::msg(crate::tr!(
            "This site has no composer.lock, so there are no locked packages to check. Run composer install or composer update first.",
            "Situs ini tidak punya composer.lock, jadi tidak ada paket terkunci untuk diperiksa. Jalankan composer install atau composer update dulu."
        ))
    })?;
    let locked = locked_versions(&lock);
    let version = |name: &str| locked.iter().find(|(n, _)| n == name).map(|(_, v)| v.clone());

    let (mut advisories, mut abandoned, mut audit_error) = (Vec::new(), Vec::new(), None);
    match run(app, &["audit", "--locked", "--format=json", "--abandoned=report"])
        .and_then(|j| parse_audit(&j, &version).map_err(|e| e.to_string()))
    {
        Ok((a, b)) => (advisories, abandoned) = (a, b),
        Err(e) => audit_error = Some(e),
    }
    let (outdated, outdated_error) = match run(app, &["outdated", "--locked", "--format=json"])
        .and_then(|j| parse_outdated(&j).map_err(|e| e.to_string()))
    {
        Ok((list, gone)) => {
            abandoned.extend(gone);
            (list, None)
        }
        Err(e) => (Vec::new(), Some(e)),
    };
    advisories.dedup();
    abandoned.sort_by(|a, b| a.package.cmp(&b.package).then(b.replacement.is_some().cmp(&a.replacement.is_some())));
    abandoned.dedup_by(|a, b| a.package == b.package);
    Ok(Report { advisories, abandoned, outdated, locked: locked.len(), audit_error, outdated_error })
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUDIT: &str = r#"{
        "advisories": {
            "guzzlehttp/psr7": [
                {"advisoryId": "PKSA-1", "packageName": "guzzlehttp/psr7", "affectedVersions": ">=2,<2.4.5",
                 "title": "Improper header validation", "cve": "CVE-2023-29197",
                 "link": "https://github.com/guzzle/psr7/security/advisories/GHSA-wxmh-65f7-jcvw",
                 "reportedAt": "2023-04-17T16:00:00+00:00", "sources": [], "severity": "high"}
            ],
            "league/commonmark": {"0": {"packageName": "league/commonmark", "affectedVersions": "<2.6.0",
                 "title": "Quadratic complexity", "cve": null, "link": "", "severity": "medium"}},
            "acme/old": [{"packageName": "acme/old", "affectedVersions": "*", "title": "Critical thing", "severity": "CRITICAL"}]
        },
        "abandoned": {"swiftmailer/swiftmailer": "symfony/mailer", "fruitcake/laravel-cors": null}
    }"#;

    #[test]
    fn audit_lists_advisories_most_severe_first_with_locked_versions() {
        let version = |p: &str| (p == "guzzlehttp/psr7").then(|| "2.4.1".to_owned());
        let (adv, abandoned) = parse_audit(AUDIT, &version).unwrap();
        let order: Vec<_> = adv.iter().map(|a| a.package.as_str()).collect();
        assert_eq!(order, ["acme/old", "guzzlehttp/psr7", "league/commonmark"]);
        let psr7 = &adv[1];
        assert_eq!(psr7.severity.as_deref(), Some("high"));
        assert_eq!(psr7.cve.as_deref(), Some("CVE-2023-29197"));
        assert_eq!(psr7.version.as_deref(), Some("2.4.1"));
        assert_eq!(adv[2].link, None, "an empty link is no link");
        assert_eq!(adv[0].severity.as_deref(), Some("critical"));
        assert_eq!(
            abandoned,
            [
                Abandoned { package: "fruitcake/laravel-cors".into(), replacement: None },
                Abandoned { package: "swiftmailer/swiftmailer".into(), replacement: Some("symfony/mailer".into()) },
            ]
        );
        // Nothing found: Composer writes an empty array.
        let (none, gone) = parse_audit(r#"{"advisories": [], "abandoned": []}"#, &|_| None).unwrap();
        assert!(none.is_empty() && gone.is_empty());
    }

    #[test]
    fn outdated_keeps_updates_direct_and_major_first() {
        let json = r#"{"locked": [
            {"name": "monolog/monolog", "direct-dependency": false, "version": "3.5.0", "latest": "3.8.1", "latest-status": "semver-safe-update"},
            {"name": "laravel/framework", "direct-dependency": true, "version": "v11.9.0", "latest": "v12.38.1", "latest-status": "update-possible", "description": "The Laravel Framework."},
            {"name": "guzzlehttp/guzzle", "direct-dependency": true, "version": "7.8.0", "latest": "7.10.0", "latest-status": "semver-safe-update"},
            {"name": "psr/log", "version": "3.0.2", "latest": "3.0.2", "latest-status": "up-to-date"},
            {"name": "swiftmailer/swiftmailer", "version": "v6.3.0", "latest": "v6.3.0", "latest-status": "up-to-date", "abandoned": "symfony/mailer"},
            {"name": "acme/gone", "version": "1.0.0", "latest": "1.0.0", "latest-status": "up-to-date", "abandoned": true}
        ]}"#;
        let (list, gone) = parse_outdated(json).unwrap();
        assert_eq!(
            gone,
            [
                Abandoned { package: "swiftmailer/swiftmailer".into(), replacement: Some("symfony/mailer".into()) },
                Abandoned { package: "acme/gone".into(), replacement: None },
            ]
        );
        let names: Vec<_> = list.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["laravel/framework", "guzzlehttp/guzzle", "monolog/monolog"]);
        assert_eq!(list[0].latest, "v12.38.1");
        assert!(parse_outdated(r#"{"installed": []}"#).unwrap().0.is_empty());
    }

    #[test]
    fn locked_versions_cover_dev_packages() {
        let lock = r#"{"packages": [{"name": "a/b", "version": "1.0.0"}], "packages-dev": [{"name": "c/d", "version": "v2.1.0"}]}"#;
        assert_eq!(locked_versions(lock), [("a/b".to_owned(), "1.0.0".to_owned()), ("c/d".to_owned(), "v2.1.0".to_owned())]);
        assert!(locked_versions("not json").is_empty());
    }

    #[test]
    fn json_is_found_after_composer_warnings() {
        #[cfg(windows)]
        use std::os::windows::process::ExitStatusExt;
        let out = |stdout: &str, stderr: &str| Output {
            status: std::process::ExitStatus::from_raw(1),
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
        };
        assert_eq!(json_of(&out("Warning: something\n{\"advisories\": []}", "")).unwrap(), "{\"advisories\": []}");
        let err = json_of(&out("", "  [Composer\\Downloader\\TransportException]\n  curl error 6: Could not resolve host: repo.packagist.org\n")).unwrap_err();
        assert!(err.contains("Could not resolve host"), "{err}");
    }
}
