//! The site page's Tests tab: run the app's PHPUnit or Pest tests with the
//! site's PHP as a job (live output, Stop), then show each test from the
//! JUnit report the runner writes (`--log-junit`), so results never depend on
//! parsing the console.

use crate::engine::laravel::App;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TestCase {
    pub name: String,
    /// `Tests\Feature\ExampleTest`.
    pub class: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    /// Seconds.
    pub time: f64,
    /// "passed" | "failed" | "error" | "skipped"
    pub status: String,
    pub message: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestReport {
    pub cases: Vec<TestCase>,
    /// When the report was written (Unix ms).
    pub finished_ms: u64,
}

/// The test runner a project has: Pest when installed, else PHPUnit.
pub fn runner(project: &Path) -> Option<(&'static str, PathBuf)> {
    ["pest", "phpunit"].into_iter().find_map(|name| {
        let script = project.join("vendor").join("bin").join(name);
        script.is_file().then_some((name, script))
    })
}

pub fn report_path(site: &str) -> PathBuf {
    crate::config::config_dir().join("runtime").join(format!("tests-{site}.xml"))
}

/// The runner's command line, and how it's shown in the output.
pub fn command(app: &App, site: &str, filter: Option<&str>) -> AppResult<(Command, String)> {
    let (name, script) = runner(&app.path).ok_or_else(|| {
        AppError::msg(crate::tr!(
            "No PHPUnit or Pest in vendor/bin. Run composer install (with the dev packages) first.",
            "Tidak ada PHPUnit atau Pest di vendor/bin. Jalankan composer install (dengan paket dev) terlebih dahulu."
        ))
    })?;
    let report = report_path(site);
    std::fs::create_dir_all(report.parent().unwrap())?;
    // An old report never stands in for this run's.
    let _ = std::fs::remove_file(&report);
    let mut cmd = app.php();
    cmd.arg(&script).arg("--colors=never").arg("--log-junit").arg(&report);
    let mut shown = format!("vendor/bin/{name}");
    if let Some(f) = filter.filter(|f| !f.trim().is_empty()) {
        cmd.arg("--filter").arg(f);
        shown.push_str(&format!(" --filter \"{f}\""));
    }
    Ok((cmd, shown))
}

/// The last run's report, if it finished.
pub fn read_report(site: &str) -> Option<TestReport> {
    let path = report_path(site);
    let text = std::fs::read_to_string(&path).ok()?;
    let finished_ms = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(TestReport { cases: parse_junit(&text), finished_ms })
}

/// A `--filter` pattern for the tests that failed: their method names (or
/// Pest descriptions), regex-escaped.
pub fn failed_filter(cases: &[TestCase]) -> Option<String> {
    let mut names: Vec<String> = cases
        .iter()
        .filter(|c| c.status == "failed" || c.status == "error")
        .map(|c| regex_escape(&c.name))
        .collect();
    names.sort();
    names.dedup();
    (!names.is_empty()).then(|| names.join("|"))
}

fn regex_escape(s: &str) -> String {
    s.chars()
        .flat_map(|c| {
            let special = "\\.+*?()|[]{}^$#&-~/".contains(c);
            special.then_some('\\').into_iter().chain(std::iter::once(c))
        })
        .collect()
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest.find(';') else { break };
        let entity = &rest[1..end];
        let ch = match entity {
            "lt" => Some('<'),
            "gt" => Some('>'),
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// `name="x" file="y"` → value of `key`.
fn attr(tag: &str, key: &str) -> Option<String> {
    let pat = format!(" {key}=\"");
    let start = tag.find(&pat)? + pat.len();
    let end = tag[start..].find('"')? + start;
    Some(unescape(&tag[start..end]))
}

/// `C:\app\tests\Unit\ExampleTest.php:15` at the end of a failure message.
fn location(message: &str) -> Option<(String, u32)> {
    message.lines().rev().map(str::trim).filter(|l| !l.is_empty()).find_map(|l| {
        let (file, line) = l.rsplit_once(':')?;
        (file.ends_with(".php")).then_some(())?;
        Some((file.to_owned(), line.parse().ok()?))
    })
}

/// The test cases of a JUnit report, as PHPUnit and Pest write it.
pub fn parse_junit(xml: &str) -> Vec<TestCase> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find("<testcase ") {
        rest = &rest[i..];
        let Some(tag_end) = rest.find('>') else { break };
        let tag = &rest[..tag_end];
        let closed = tag.ends_with('/');
        let body = if closed {
            ""
        } else {
            let end = rest.find("</testcase>").unwrap_or(rest.len());
            &rest[tag_end + 1..end]
        };
        let (status, message) = ["failure", "error", "skipped"]
            .iter()
            .find_map(|kind| {
                let open = format!("<{kind}");
                let at = body.find(&open)?;
                let after = &body[at..];
                let gt = after.find('>')?;
                let text = if after[..gt].ends_with('/') {
                    String::new()
                } else {
                    let close = format!("</{kind}>");
                    unescape(after[gt + 1..].split(&close).next().unwrap_or("").trim())
                };
                let status = if *kind == "failure" { "failed" } else { kind };
                Some((status.to_owned(), (!text.is_empty()).then_some(text)))
            })
            .unwrap_or_else(|| ("passed".to_owned(), None));
        // Pest writes `file="tests/Feature/X.php::it works"`; PHPUnit a path and a line.
        let raw_file = attr(tag, "file");
        let mut file = raw_file.as_deref().map(|f| f.split("::").next().unwrap_or(f).to_owned());
        let mut line = attr(tag, "line").and_then(|l| l.parse().ok());
        if let Some((f, l)) = message.as_deref().and_then(location) {
            file = Some(f);
            line = Some(l);
        }
        out.push(TestCase {
            name: attr(tag, "name").unwrap_or_default(),
            class: attr(tag, "class").or_else(|| attr(tag, "classname").map(|c| c.replace('.', "\\"))).unwrap_or_default(),
            file,
            line,
            time: attr(tag, "time").and_then(|t| t.parse().ok()).unwrap_or(0.0),
            status,
            message,
        });
        rest = &rest[tag_end..];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHPUNIT: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Unit" tests="3" assertions="2" errors="0" failures="1" skipped="1" time="0.03">
    <testcase name="test_that_true_is_true" file="C:\app\tests\Unit\ExampleTest.php" line="12" class="Tests\Unit\ExampleTest" classname="Tests.Unit.ExampleTest" assertions="1" time="0.001"/>
    <testcase name="test_sum" file="C:\app\tests\Unit\MathTest.php" line="9" class="Tests\Unit\MathTest" classname="Tests.Unit.MathTest" assertions="1" time="0.002">
      <failure type="PHPUnit\Framework\ExpectationFailedException">Tests\Unit\MathTest::test_sum
Failed asserting that 3 is identical to 4 &amp; &lt;nothing&gt; else.

C:\app\tests\Unit\MathTest.php:11</failure>
    </testcase>
    <testcase name="test_later" file="C:\app\tests\Unit\MathTest.php" line="15" class="Tests\Unit\MathTest" classname="Tests.Unit.MathTest" assertions="0" time="0.000">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>"#;

    #[test]
    fn reads_phpunits_junit_report() {
        let cases = parse_junit(PHPUNIT);
        assert_eq!(cases.len(), 3);
        assert_eq!((cases[0].status.as_str(), cases[0].line), ("passed", Some(12)));
        let failed = &cases[1];
        assert_eq!((failed.status.as_str(), failed.class.as_str()), ("failed", "Tests\\Unit\\MathTest"));
        assert!(failed.message.as_deref().unwrap().contains("3 is identical to 4 & <nothing> else."));
        assert_eq!((failed.file.as_deref(), failed.line), (Some(r"C:\app\tests\Unit\MathTest.php"), Some(11)), "the failing line, not the method's");
        assert_eq!(cases[2].status, "skipped");
        assert_eq!(failed_filter(&cases).as_deref(), Some("test_sum"));
    }

    #[test]
    fn reads_pests_report_and_escapes_its_descriptions() {
        let pest = r#"<testsuites><testsuite name="Feature">
<testcase name="it returns a successful response (200)" file="tests/Feature/ExampleTest.php::it returns a successful response (200)" class="Tests\Feature\ExampleTest" classname="Tests.Feature.ExampleTest" assertions="1" time="0.12"><error type="Error">Call to undefined function foo()</error></testcase>
</testsuite></testsuites>"#;
        let cases = parse_junit(pest);
        assert_eq!(cases[0].status, "error");
        assert_eq!(cases[0].file.as_deref(), Some("tests/Feature/ExampleTest.php"));
        assert_eq!(failed_filter(&cases).as_deref(), Some("it returns a successful response \\(200\\)"));
    }
}
