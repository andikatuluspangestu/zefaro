//! Looking inside a site's Laravel app: overview, tables and rows, config,
//! routes and `.env`, a Tinker-style session, Artisan jobs and workers.
//!
//! The PHP side is `laravel-runner.php`, Zefaro's own script. It boots the app
//! the way `artisan` does and answers in JSON lines that start with
//! [`MARK`], so whatever the app prints itself can't be taken for an answer.

use crate::config::{config_dir, ZefaroConfig};
use crate::engine::supervisor::{job::Job, Probe, Spec};
use crate::engine::{node, paths, php, process};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const RUNNER: &str = include_str!("laravel-runner.php");
const MARK: &str = "\u{1e}ZEFARO:";

/// How long a one-shot request (overview, rows, …) may take.
const QUERY_TIMEOUT: Duration = Duration::from_secs(60);
/// How long a new Tinker session may take to boot the app.
const BOOT_TIMEOUT: Duration = Duration::from_secs(60);
/// Code in a Tinker session that runs longer than this is stopped.
const EVAL_TIMEOUT: Duration = Duration::from_secs(600);
/// Lines of output an Artisan job keeps.
const JOB_LINES: usize = 5000;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Where the runner is written, refreshed whenever Zefaro ships a new one.
fn runner() -> AppResult<PathBuf> {
    let path = config_dir().join("runtime").join("laravel-runner.php");
    if fs::read_to_string(&path).ok().as_deref() != Some(RUNNER) {
        fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))?;
        fs::write(&path, RUNNER)?;
    }
    Ok(path)
}

/// The app a request runs against: its folder and the PHP line it uses.
#[derive(Clone, Debug, PartialEq)]
pub struct App {
    pub path: PathBuf,
    pub php: String,
}

impl App {
    /// The site's PHP line, or the active one when the site's isn't installed.
    pub fn for_site(cfg: &ZefaroConfig, name: &str) -> AppResult<Self> {
        let site = cfg.sites.iter().find(|s| s.name == name).ok_or_else(|| {
            AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada."))
        })?;
        let php = if php::is_installed(&site.php_version) {
            site.php_version.clone()
        } else if php::is_installed(&cfg.default_php) {
            cfg.default_php.clone()
        } else {
            return Err(AppError::msg(crate::tr!(
                format!("Install PHP {} first (PHP page).", site.php_version),
                format!("Pasang PHP {} terlebih dahulu (halaman PHP).", site.php_version)
            )));
        };
        Ok(Self { path: PathBuf::from(&site.path), php })
    }

    pub fn is_laravel(&self) -> bool {
        self.path.join("artisan").is_file()
    }

    pub fn has_vendor(&self) -> bool {
        self.path.join("vendor").join("autoload.php").is_file()
    }

    pub fn php_exe(&self) -> PathBuf {
        paths::php_dir(&self.php).join("php.exe")
    }

    fn php_ini(&self) -> PathBuf {
        paths::php_dir(&self.php).join("php.ini")
    }

    /// `php -c php.ini …` in the app's folder, with Zefaro's tools first on PATH
    /// so anything the app runs (`php`, `composer`, `node`) is Zefaro's too.
    pub fn php(&self) -> Command {
        let mut cmd = process::command(self.php_exe());
        cmd.arg("-c").arg(self.php_ini()).current_dir(&self.path).env("PATH", tool_path(&self.php));
        cmd
    }

    fn require_ready(&self) -> AppResult<()> {
        if !self.is_laravel() {
            return Err(AppError::msg(crate::tr!(
                "This site isn't a Laravel app (no artisan file in its folder).",
                "Situs ini bukan aplikasi Laravel (tidak ada file artisan di foldernya)."
            )));
        }
        if !self.has_vendor() {
            return Err(AppError::msg(crate::tr!(
                "Run composer install for this site first.",
                "Jalankan composer install untuk situs ini terlebih dahulu."
            )));
        }
        Ok(())
    }
}

/// PATH for processes started for a site: its PHP, Zefaro's bin folder and the
/// active Node.js line, then the user's own PATH.
pub(crate) fn tool_path(php: &str) -> OsString {
    let mut dirs = vec![paths::php_dir(php), paths::bin_dir()];
    let cfg = crate::config::load();
    if node::is_installed(&cfg.node_default) {
        dirs.push(node::dir(&cfg.node_default));
    }
    if let Some(existing) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&existing));
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

/// The answer in a runner's output: the last line that starts with [`MARK`].
fn answer(stdout: &str) -> Option<Value> {
    stdout.lines().rev().find_map(|line| line.strip_prefix(MARK)).and_then(|json| serde_json::from_str(json).ok())
}

/// "Exception: message (app/Models/User.php:12)".
pub fn error_text(error: &Value) -> String {
    let class = error.get("class").and_then(Value::as_str).unwrap_or("Error");
    let message = error.get("message").and_then(Value::as_str).unwrap_or("");
    let short = class.rsplit('\\').next().unwrap_or(class);
    match (error.get("file").and_then(Value::as_str), error.get("line").and_then(Value::as_u64)) {
        (Some(file), Some(line)) if !file.is_empty() => format!("{short}: {message} ({file}:{line})"),
        _ => format!("{short}: {message}"),
    }
}

/// Run to completion with `input` on stdin, killing it after `timeout`.
fn run_with_timeout(mut cmd: Command, input: &[u8], timeout: Duration) -> AppResult<(String, String)> {
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input);
    }
    let out = read_in_background(child.stdout.take());
    let err = read_in_background(child.stderr.take());
    let deadline = Instant::now() + timeout;
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::msg(crate::tr!(
                format!("The app didn't answer within {} seconds.", timeout.as_secs()),
                format!("Aplikasi tidak menjawab dalam {} detik.", timeout.as_secs())
            )));
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Ok((out.join().unwrap_or_default(), err.join().unwrap_or_default()))
}

fn read_in_background(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes);
        }
        String::from_utf8_lossy(&bytes).into_owned()
    })
}

fn last_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

/// One request to the runner: `{"op": "overview"}`, `{"op": "rows", …}`.
pub fn query(app: &App, request: &Value) -> AppResult<Value> {
    app.require_ready()?;
    let mut cmd = app.php();
    cmd.arg(runner()?).arg("query");
    let (stdout, stderr) = run_with_timeout(cmd, request.to_string().as_bytes(), QUERY_TIMEOUT)?;
    match answer(&stdout) {
        Some(reply) if reply.get("ok").and_then(Value::as_bool) == Some(true) => {
            Ok(reply.get("data").cloned().unwrap_or(Value::Null))
        }
        Some(reply) => Err(AppError::msg(error_text(reply.get("error").unwrap_or(&Value::Null)))),
        None => {
            let detail = last_lines(if stderr.trim().is_empty() { &stdout } else { &stderr }, 6);
            Err(AppError::msg(crate::tr!(
                format!("The app stopped before answering. {detail}"),
                format!("Aplikasi berhenti sebelum menjawab. {detail}")
            )))
        }
    }
}

// ------------------------------------------------------------------- .env --

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvEntry {
    pub key: String,
    pub value: String,
    /// 1-based line in `.env`.
    pub line: usize,
}

/// `KEY=value` lines of a `.env` file, quotes removed. Comments and blank
/// lines are skipped; a repeated key keeps its last value, as dotenv does.
pub fn parse_env(text: &str) -> Vec<EnvEntry> {
    let mut entries: Vec<EnvEntry> = Vec::new();
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim();
        let line = line.strip_prefix("export ").unwrap_or(line);
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let key = key.trim();
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.') {
            continue;
        }
        let value = unquote(value.trim());
        entries.retain(|e| e.key != key);
        entries.push(EnvEntry { key: key.to_owned(), value, line: i + 1 });
    }
    entries.sort_by_key(|e| e.line);
    entries
}

fn unquote(value: &str) -> String {
    for quote in ['"', '\''] {
        if let Some(rest) = value.strip_prefix(quote) {
            if let Some(end) = rest.find(quote) {
                let inner = &rest[..end];
                return if quote == '"' { inner.replace("\\n", "\n").replace("\\\"", "\"") } else { inner.to_owned() };
            }
        }
    }
    // Unquoted: a ` #` starts a comment.
    match value.find(" #") {
        Some(at) => value[..at].trim_end().to_owned(),
        None => value.to_owned(),
    }
}

/// Quote a value when dotenv would otherwise read it differently.
fn quote(value: &str) -> String {
    let plain = !value.is_empty()
        && value.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:/@,+=${}".contains(c));
    if plain || value.is_empty() {
        value.to_owned()
    } else {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n"))
    }
}

/// Set `key` in `.env` text: replace its line (the last one, which dotenv
/// uses) or append it. Line endings and everything else stay as they were.
pub fn set_env(text: &str, key: &str, value: &str) -> String {
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let line = format!("{key}={}", quote(value));
    let mut lines: Vec<String> = text.split(newline).map(str::to_owned).collect();
    let found = lines.iter().rposition(|l| {
        let l = l.trim_start();
        let l = l.strip_prefix("export ").unwrap_or(l);
        l.split_once('=').is_some_and(|(k, _)| k.trim() == key)
    });
    match found {
        Some(i) => lines[i] = line,
        None => {
            // Keep the file's final newline after the new line.
            if lines.last().is_some_and(|l| l.is_empty()) {
                lines.pop();
                lines.push(line);
                lines.push(String::new());
            } else {
                lines.push(line);
            }
        }
    }
    lines.join(newline)
}

/// Is this a local development address: localhost, 127.0.0.1, or a name
/// under `.tld`? A real domain isn't.
pub fn is_local_url(url: &str, tld: &str) -> bool {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let host = rest.split(['/', ':', '?']).next().unwrap_or("").to_lowercase();
    host.is_empty()
        || host == "localhost"
        || host == "127.0.0.1"
        || host.ends_with(".localhost")
        || host == tld
        || host.ends_with(&format!(".{tld}"))
}

/// Point APP_URL in the project's .env at `url` when it holds a local
/// address (or nothing). A real domain is left alone. Returns whether the
/// file changed.
pub fn sync_app_url(project: &Path, url: &str, tld: &str) -> bool {
    let path = project.join(".env");
    let Ok(text) = fs::read_to_string(&path) else { return false };
    let current = parse_env(&text).into_iter().find(|e| e.key == "APP_URL").map(|e| e.value);
    match &current {
        Some(value) if value == url => return false,
        Some(value) if !is_local_url(value, tld) => return false,
        _ => {}
    }
    fs::write(&path, set_env(&text, "APP_URL", url)).is_ok()
}

pub fn validate_env_key(key: &str) -> AppResult<()> {
    let valid = !key.is_empty()
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !key.starts_with(|c: char| c.is_ascii_digit());
    if valid {
        Ok(())
    } else {
        Err(AppError::msg(crate::tr!(
            format!("{key} isn't a valid .env name. Use letters, digits and _."),
            format!("{key} bukan nama .env yang valid. Pakai huruf, angka dan _.")
        )))
    }
}

// ----------------------------------------------------------------- Tinker --

enum Line {
    Out(String),
    Err(String),
}

/// A long-running runner in `serve` mode: variables survive between runs,
/// like a Tinker session.
pub struct Session {
    pub app: App,
    pub laravel: String,
    stdin: Mutex<ChildStdin>,
    lines: Mutex<Receiver<Line>>,
    child: Mutex<Child>,
    job: Job,
    next_id: AtomicU64,
}

fn pump(pipe: impl Read + Send + 'static, tx: Sender<Line>, wrap: fn(String) -> Line) {
    std::thread::spawn(move || {
        for line in BufReader::new(pipe).lines() {
            let Ok(line) = line else { break };
            if tx.send(wrap(line)).is_err() {
                break;
            }
        }
    });
}

impl Session {
    pub fn start(app: App) -> AppResult<Self> {
        app.require_ready()?;
        let mut cmd = app.php();
        cmd.arg(runner()?).arg("serve").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn()?;
        let job = Job::new()?;
        if let Err(e) = job.assign(&child) {
            let _ = child.kill();
            return Err(e);
        }
        let (tx, rx) = mpsc::channel();
        if let Some(out) = child.stdout.take() {
            pump(out, tx.clone(), Line::Out);
        }
        if let Some(err) = child.stderr.take() {
            pump(err, tx, Line::Err);
        }
        let stdin = child.stdin.take().ok_or_else(|| AppError::msg("stdin"))?;

        let deadline = Instant::now() + BOOT_TIMEOUT;
        let mut noise = String::new();
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok(Line::Out(line)) => match line.strip_prefix(MARK).and_then(|j| serde_json::from_str::<Value>(j).ok()) {
                    Some(ready) if ready.get("ready").and_then(Value::as_bool) == Some(true) => {
                        let laravel = ready.get("laravel").and_then(Value::as_str).unwrap_or("").to_owned();
                        return Ok(Self {
                            app,
                            laravel,
                            stdin: Mutex::new(stdin),
                            lines: Mutex::new(rx),
                            child: Mutex::new(child),
                            job,
                            next_id: AtomicU64::new(1),
                        });
                    }
                    Some(failed) => {
                        job.terminate();
                        return Err(AppError::msg(error_text(failed.get("error").unwrap_or(&Value::Null))));
                    }
                    None => noise.push_str(&format!("{line}\n")),
                },
                Ok(Line::Err(line)) => noise.push_str(&format!("{line}\n")),
                Err(RecvTimeoutError::Timeout) => {
                    job.terminate();
                    return Err(AppError::msg(crate::tr!(
                        "The app took longer than a minute to start.",
                        "Aplikasi butuh lebih dari satu menit untuk mulai."
                    )));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    let detail = last_lines(&noise, 6);
                    return Err(AppError::msg(crate::tr!(
                        format!("The app stopped while starting. {detail}"),
                        format!("Aplikasi berhenti saat mulai. {detail}")
                    )));
                }
            }
        }
    }

    /// Run code and return the runner's answer. An answer with `"ended": true`
    /// means the process is gone (exit, dd(), a fatal error, or Stop).
    pub fn eval(&self, code: &str, rollback: bool) -> AppResult<Value> {
        let lines = self.lines.lock().unwrap();
        // Lines left over from an earlier run that was stopped.
        while lines.try_recv().is_ok() {}
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = serde_json::json!({ "id": id, "code": code, "rollback": rollback });
        {
            let mut stdin = self.stdin.lock().unwrap();
            writeln!(stdin, "{request}").and_then(|_| stdin.flush()).map_err(|_| ended_error())?;
        }
        let deadline = Instant::now() + EVAL_TIMEOUT;
        let (mut stray, mut stderr) = (String::new(), String::new());
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match lines.recv_timeout(left) {
                Ok(Line::Out(line)) => match line.strip_prefix(MARK).and_then(|j| serde_json::from_str::<Value>(j).ok()) {
                    Some(mut reply) if reply.get("id").and_then(Value::as_u64) == Some(id) => {
                        // Output printed outside PHP's buffer (e.g. by exit()) comes first.
                        let buffered = reply.get("output").and_then(Value::as_str).unwrap_or("").to_owned();
                        reply["output"] = Value::String(stray + &buffered);
                        reply["stderr"] = Value::String(stderr);
                        return Ok(reply);
                    }
                    Some(_) => {}
                    None => stray.push_str(&format!("{line}\n")),
                },
                Ok(Line::Err(line)) => stderr.push_str(&format!("{line}\n")),
                Err(RecvTimeoutError::Timeout) => {
                    self.stop();
                    return Ok(ended(
                        crate::tr!(
                            format!("Still running after {} minutes; Zefaro stopped the session.", EVAL_TIMEOUT.as_secs() / 60),
                            format!("Masih berjalan setelah {} menit; Zefaro menghentikan sesi.", EVAL_TIMEOUT.as_secs() / 60)
                        ),
                        stray,
                        stderr,
                    ));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Ok(ended(
                        crate::tr!("The session's PHP process ended.", "Proses PHP sesi berhenti.").to_owned(),
                        stray,
                        stderr,
                    ));
                }
            }
        }
    }

    /// Kill the process (and anything it started). A running eval returns
    /// with `"ended": true`.
    pub fn stop(&self) {
        self.job.terminate();
        let _ = self.child.lock().unwrap().kill();
    }

    pub fn is_alive(&self) -> bool {
        matches!(self.child.lock().unwrap().try_wait(), Ok(None))
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stop();
    }
}

fn ended_error() -> AppError {
    AppError::msg(crate::tr!("The session's PHP process ended.", "Proses PHP sesi berhenti."))
}

fn ended(message: String, output: String, stderr: String) -> Value {
    serde_json::json!({
        "ok": false,
        "ended": true,
        "error": { "class": "Session", "message": message, "file": "", "line": 0, "trace": [] },
        "output": output,
        "stderr": stderr,
        "dumps": [],
        "queries": [],
    })
}

/// Tinker sessions by site name.
#[derive(Default)]
pub struct Sessions {
    map: Mutex<HashMap<String, Arc<Session>>>,
}

impl Sessions {
    /// Make `session` the site's session, ending the one it replaces.
    pub fn adopt(&self, site: &str, session: Arc<Session>) {
        if let Some(old) = self.map.lock().unwrap().insert(site.to_owned(), session) {
            old.stop();
        }
    }

    pub fn current(&self, site: &str) -> Option<Arc<Session>> {
        self.map.lock().unwrap().get(site).cloned()
    }

    pub fn end(&self, site: &str) {
        if let Some(s) = self.map.lock().unwrap().remove(site) {
            s.stop();
        }
    }

    pub fn end_all(&self) {
        for (_, s) in self.map.lock().unwrap().drain() {
            s.stop();
        }
    }
}

// ---------------------------------------------------------------- Artisan --

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArtisanArgument {
    pub name: String,
    pub required: bool,
    pub array: bool,
    pub description: String,
    pub default: Value,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArtisanOption {
    pub name: String,
    pub shortcut: String,
    pub accepts_value: bool,
    pub value_required: bool,
    pub multiple: bool,
    pub description: String,
    pub default: Value,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArtisanCommand {
    pub name: String,
    pub description: String,
    pub usage: String,
    pub arguments: Vec<ArtisanArgument>,
    pub options: Vec<ArtisanOption>,
}

/// Options every Symfony command has; the interface sets them itself.
const GLOBAL_OPTIONS: &[&str] =
    &["help", "silent", "quiet", "verbose", "version", "ansi", "no-ansi", "no-interaction", "env"];

/// Commands from `artisan list --format=json`, hidden ones left out.
pub fn parse_artisan_list(json: &Value) -> Vec<ArtisanCommand> {
    let text = |v: &Value, key: &str| v.get(key).and_then(Value::as_str).unwrap_or("").to_owned();
    let flag = |v: &Value, key: &str| v.get(key).and_then(Value::as_bool).unwrap_or(false);
    let mut commands: Vec<ArtisanCommand> = json
        .get("commands")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|c| !flag(c, "hidden"))
        .map(|c| {
            let definition = c.get("definition").cloned().unwrap_or(Value::Null);
            let arguments = definition
                .get("arguments")
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|m| m.values())
                .map(|a| ArtisanArgument {
                    name: text(a, "name"),
                    required: flag(a, "is_required"),
                    array: flag(a, "is_array"),
                    description: text(a, "description"),
                    default: a.get("default").cloned().unwrap_or(Value::Null),
                })
                // `command` is the command's own name, not something to fill in.
                .filter(|a| a.name != "command")
                .collect();
            let options = definition
                .get("options")
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|m| m.values())
                .map(|o| ArtisanOption {
                    name: text(o, "name").trim_start_matches("--").to_owned(),
                    shortcut: text(o, "shortcut"),
                    accepts_value: flag(o, "accept_value"),
                    value_required: flag(o, "is_value_required"),
                    multiple: flag(o, "is_multiple"),
                    description: text(o, "description"),
                    default: o.get("default").cloned().unwrap_or(Value::Null),
                })
                .filter(|o| !GLOBAL_OPTIONS.contains(&o.name.as_str()))
                .collect();
            ArtisanCommand {
                name: text(c, "name"),
                description: text(c, "description"),
                usage: c.get("usage").and_then(Value::as_array).and_then(|u| u.first()).and_then(Value::as_str).unwrap_or("").to_owned(),
                arguments,
                options,
            }
        })
        .filter(|c| !c.name.is_empty() && c.name != "_complete" && c.name != "completion")
        .collect();
    commands.sort_by(|a, b| a.name.cmp(&b.name));
    commands
}

pub fn artisan_list(app: &App) -> AppResult<Vec<ArtisanCommand>> {
    app.require_ready()?;
    let mut cmd = app.php();
    cmd.args(["artisan", "list", "--format=json", "--no-ansi", "--no-interaction"]);
    let (stdout, stderr) = run_with_timeout(cmd, b"", QUERY_TIMEOUT)?;
    // Deprecation notices can come before the JSON.
    let json = stdout.find('{').and_then(|at| serde_json::from_str::<Value>(&stdout[at..]).ok());
    match json {
        Some(json) => Ok(parse_artisan_list(&json)),
        None => {
            let detail = last_lines(if stderr.trim().is_empty() { &stdout } else { &stderr }, 6);
            Err(AppError::msg(crate::tr!(
                format!("artisan list failed. {detail}"),
                format!("artisan list gagal. {detail}")
            )))
        }
    }
}

/// An Artisan or Composer run in a site's folder, with its output.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SiteJob {
    pub id: u64,
    pub site: String,
    /// What ran, as typed: "php artisan migrate --seed".
    pub command: String,
    /// "running" | "done" | "failed" | "stopped"
    pub state: String,
    pub exit_code: Option<i32>,
    pub started_ms: u64,
    pub ended_ms: Option<u64>,
    /// Lines dropped from the start once a job prints more than it keeps.
    pub dropped: usize,
}

struct Running {
    job: SiteJob,
    lines: Vec<String>,
    kill: Option<Arc<Job>>,
}

/// A job's state plus the lines after `since`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JobOutput {
    pub job: SiteJob,
    /// Index of the first line in `lines`, counted from the job's first line.
    pub from: usize,
    pub lines: Vec<String>,
}

#[derive(Default)]
pub struct Jobs {
    map: JobMap,
    next: AtomicU64,
}

type JobMap = Arc<Mutex<HashMap<u64, Running>>>;

/// Append a line to a job, dropping the oldest past [`JOB_LINES`].
fn push_line(map: &JobMap, id: u64, text: String) {
    if let Some(r) = map.lock().unwrap().get_mut(&id) {
        r.lines.push(text);
        if r.lines.len() > JOB_LINES {
            let extra = r.lines.len() - JOB_LINES;
            r.lines.drain(..extra);
            r.job.dropped += extra;
        }
    }
}

/// A job being written to: it can run commands one after another into the
/// same output, add its own lines, and finishes once.
pub struct JobHandle {
    id: u64,
    map: JobMap,
}

impl JobHandle {
    pub fn job(&self) -> SiteJob {
        self.map.lock().unwrap().get(&self.id).map(|r| r.job.clone()).expect("job exists")
    }

    /// A line of Zefaro's own in the output.
    pub fn line(&self, text: impl Into<String>) {
        push_line(&self.map, self.id, text.into());
    }

    /// Stop was pressed.
    pub fn stopped(&self) -> bool {
        self.map.lock().unwrap().get(&self.id).is_none_or(|r| r.job.state == "stopped")
    }

    /// Run `cmd` to the end with its output in the job. Returns its exit code
    /// (None when it was killed).
    pub fn run(&self, mut cmd: Command) -> AppResult<Option<i32>> {
        if self.stopped() {
            return Ok(None);
        }
        let mut child = cmd
            .env("NO_COLOR", "1")
            .env("COLUMNS", "120")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        let kill = Arc::new(Job::new()?);
        if let Err(e) = kill.assign(&child) {
            let _ = child.kill();
            return Err(e);
        }
        if let Some(r) = self.map.lock().unwrap().get_mut(&self.id) {
            r.kill = Some(kill);
        }
        let readers: Vec<_> = [
            child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>),
            child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>),
        ]
        .into_iter()
        .flatten()
        .map(|pipe| {
            let (map, id) = (self.map.clone(), self.id);
            std::thread::spawn(move || {
                for line in BufReader::new(pipe).split(b'\n') {
                    let Ok(bytes) = line else { break };
                    // Progress bars redraw with \r: keep the last state of the line.
                    let raw = String::from_utf8_lossy(&bytes);
                    let last = raw.trim_end_matches('\r').rsplit('\r').next().unwrap_or("");
                    push_line(&map, id, strip_ansi(last));
                }
            })
        })
        .collect();
        let status = child.wait();
        for reader in readers {
            let _ = reader.join();
        }
        if let Some(r) = self.map.lock().unwrap().get_mut(&self.id) {
            r.kill = None;
        }
        Ok(status.ok().and_then(|s| s.code()).filter(|_| !self.stopped()))
    }

    /// Mark the job done (`Ok(Some(0))`), failed (another code, or an error,
    /// which becomes its last line) or leave it stopped.
    pub fn finish(&self, result: AppResult<Option<i32>>) {
        if let Err(e) = &result {
            self.line(e.to_string());
        }
        if let Some(r) = self.map.lock().unwrap().get_mut(&self.id) {
            if r.job.state == "running" {
                let code = result.ok().flatten();
                r.job.exit_code = code;
                r.job.state = if code == Some(0) { "done" } else { "failed" }.into();
            }
            r.job.ended_ms = Some(now_ms());
            r.kill = None;
        }
    }
}

impl Jobs {
    /// A new running job with no output yet.
    pub fn begin(&self, site: &str, display: String) -> JobHandle {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let job = SiteJob {
            id,
            site: site.to_owned(),
            command: display,
            state: "running".into(),
            exit_code: None,
            started_ms: now_ms(),
            ended_ms: None,
            dropped: 0,
        };
        let mut map = self.map.lock().unwrap();
        // Keep the 20 newest finished jobs.
        let mut finished: Vec<u64> = map.iter().filter(|(_, r)| r.job.state != "running").map(|(k, _)| *k).collect();
        finished.sort_unstable();
        for old in finished.iter().take(finished.len().saturating_sub(20)) {
            map.remove(old);
        }
        map.insert(id, Running { job, lines: Vec::new(), kill: None });
        JobHandle { id, map: self.map.clone() }
    }

    /// Run `cmd` (already pointed at the site's folder) as a job in the background.
    pub fn spawn(&self, site: &str, display: String, cmd: Command) -> AppResult<SiteJob> {
        let handle = self.begin(site, display);
        let job = handle.job();
        std::thread::spawn(move || {
            let result = handle.run(cmd);
            handle.finish(result);
        });
        Ok(job)
    }

    pub fn output(&self, id: u64, since: usize) -> Option<JobOutput> {
        let map = self.map.lock().unwrap();
        let r = map.get(&id)?;
        let from = since.max(r.job.dropped);
        let skip = from - r.job.dropped;
        Some(JobOutput { job: r.job.clone(), from, lines: r.lines.iter().skip(skip).cloned().collect() })
    }

    pub fn list(&self, site: &str) -> Vec<SiteJob> {
        let mut jobs: Vec<SiteJob> =
            self.map.lock().unwrap().values().filter(|r| r.job.site == site).map(|r| r.job.clone()).collect();
        jobs.sort_by_key(|j| std::cmp::Reverse(j.id));
        jobs
    }

    pub fn stop(&self, id: u64) {
        if let Some(r) = self.map.lock().unwrap().get_mut(&id) {
            if r.job.state == "running" {
                r.job.state = "stopped".into();
                if let Some(kill) = &r.kill {
                    kill.terminate();
                }
            }
        }
    }

    pub fn stop_site(&self, site: &str) {
        let ids: Vec<u64> = self.list(site).iter().map(|j| j.id).collect();
        for id in ids {
            self.stop(id);
        }
    }
}

/// Remove terminal colour and cursor codes from a line of output.
pub fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                // Parameters, then one final byte in @..~.
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            } else {
                chars.next();
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Split a command line into words: spaces separate, double or single quotes
/// group.
pub fn split_words(line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for c in line.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => word.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                started = true;
            }
            None if c.is_whitespace() => {
                if started || !word.is_empty() {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            None => word.push(c),
        }
    }
    if started || !word.is_empty() {
        words.push(word);
    }
    words
}

/// `php artisan …` for a job: arguments go to PHP directly, never through a shell.
pub fn artisan_command(app: &App, args: &[String]) -> AppResult<Command> {
    app.require_ready()?;
    let mut cmd = app.php();
    cmd.arg("artisan").args(args).args(["--no-interaction", "--no-ansi"]);
    Ok(cmd)
}

/// `composer …` with Zefaro's Composer, for `composer install` on a new checkout.
pub fn composer_command(app: &App, args: &[String]) -> AppResult<Command> {
    if !paths::composer_phar().is_file() {
        return Err(AppError::msg(crate::tr!(
            "Install Composer first (Tools page).",
            "Pasang Composer terlebih dahulu (halaman Alat)."
        )));
    }
    let mut cmd = app.php();
    cmd.arg(paths::composer_phar())
        .args(args)
        .args(["--no-interaction", "--no-ansi"])
        .env("COMPOSER_HOME", paths::composer_home());
    Ok(cmd)
}

// ---------------------------------------------------------------- Workers --

/// A long-running process for a site (queue worker, scheduler, Vite, …),
/// kept running by the supervisor.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Worker {
    pub id: String,
    pub site: String,
    pub label: String,
    /// "php artisan queue:work" runs with the site's PHP; anything else runs
    /// through cmd.exe ("npm run dev").
    pub command: String,
    /// Start with Zefaro.
    pub autostart: bool,
}

impl Default for Worker {
    fn default() -> Self {
        Self { id: String::new(), site: String::new(), label: String::new(), command: String::new(), autostart: false }
    }
}

pub const WORKER_PREFIX: &str = "worker:";

pub fn worker_service_id(id: &str) -> String {
    format!("{WORKER_PREFIX}{id}")
}

/// Log id (file name without `.log`) of a worker.
pub fn worker_log_id(w: &Worker) -> String {
    let clean = |s: &str| -> String {
        s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect()
    };
    let id: String = format!("worker-{}-{}", clean(&w.site), clean(&w.id));
    id.chars().take(64).collect()
}

/// A short id from the label: "Queue worker" → "queue-worker", made unique.
pub fn new_worker_id(label: &str, taken: &[String]) -> String {
    let base: String = label
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let base = if base.is_empty() { "worker".to_owned() } else { base.chars().take(24).collect() };
    let mut id = base.clone();
    let mut n = 2;
    while taken.contains(&id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

pub fn worker_spec(cfg: &ZefaroConfig, w: &Worker) -> AppResult<Spec> {
    let app = App::for_site(cfg, &w.site)?;
    let words = split_words(&w.command);
    let (program, args): (PathBuf, Vec<OsString>) = match words.first().map(String::as_str) {
        None => {
            return Err(AppError::msg(crate::tr!("Enter a command to run.", "Isi perintah yang dijalankan.")));
        }
        Some("php") => {
            app.require_ready()?;
            let mut args: Vec<OsString> = vec!["-c".into(), app.php_ini().into()];
            args.extend(words[1..].iter().map(OsString::from));
            (app.php_exe(), args)
        }
        Some(_) => {
            let comspec = std::env::var_os("ComSpec").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("cmd.exe"));
            (comspec, vec!["/d".into(), "/s".into(), "/c".into(), w.command.clone().into()])
        }
    };
    Ok(Spec {
        id: worker_service_id(&w.id),
        program,
        args,
        cwd: app.path.clone(),
        env: vec![
            ("PATH".into(), tool_path(&app.php).to_string_lossy().into_owned()),
            ("NO_COLOR".into(), "1".into()),
        ],
        log: paths::logs_dir().join(format!("{}.log", worker_log_id(w))),
        port: 0,
        probe: Probe::Alive,
        stop: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_answer_among_other_output() {
        let out = format!("Deprecated: something\n{MARK}{{\"ok\":false}}\nhello\n{MARK}{{\"ok\":true,\"data\":1}}\n");
        assert_eq!(answer(&out).unwrap()["data"], 1);
        assert!(answer("no answer here").is_none());
    }

    #[test]
    fn reads_env_files_like_dotenv() {
        let text = "# comment\nAPP_NAME=\"My App\"\nAPP_ENV=local\r\n\nDB_PASSWORD='p#ss'\nMAIL_HOST=127.0.0.1 # local\nAPP_ENV=testing\nexport QUEUE_CONNECTION=database\nbroken line\n";
        let env = parse_env(text);
        let get = |k: &str| env.iter().find(|e| e.key == k).map(|e| e.value.as_str());
        assert_eq!(get("APP_NAME"), Some("My App"));
        assert_eq!(get("APP_ENV"), Some("testing"));
        assert_eq!(get("DB_PASSWORD"), Some("p#ss"));
        assert_eq!(get("MAIL_HOST"), Some("127.0.0.1"));
        assert_eq!(get("QUEUE_CONNECTION"), Some("database"));
        assert_eq!(env.len(), 5);
    }

    #[test]
    fn sets_env_values_in_place() {
        let text = "APP_NAME=Laravel\r\nMAIL_MAILER=log\r\nMAIL_PORT=2525\r\n";
        let out = set_env(text, "MAIL_MAILER", "smtp");
        assert_eq!(out, "APP_NAME=Laravel\r\nMAIL_MAILER=smtp\r\nMAIL_PORT=2525\r\n");
        let out = set_env(&out, "MAIL_FROM_NAME", "My App");
        assert_eq!(out, "APP_NAME=Laravel\r\nMAIL_MAILER=smtp\r\nMAIL_PORT=2525\r\nMAIL_FROM_NAME=\"My App\"\r\n");
        assert_eq!(set_env("A=1", "B", ""), "A=1\nB=");
        assert_eq!(set_env("A=1\n", "A", "say \"hi\""), "A=\"say \\\"hi\\\"\"\n");
    }

    #[test]
    fn app_url_follows_the_site_only_when_local() {
        assert!(is_local_url("http://localhost", "test"));
        assert!(is_local_url("http://localhost:8000/", "test"));
        assert!(is_local_url("https://shop.test", "test"));
        assert!(is_local_url("", "test"));
        assert!(!is_local_url("https://shop.example.com", "test"));
        assert!(!is_local_url("https://contest.com", "test"));

        let dir = std::env::temp_dir().join("zefaro-app-url-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(".env"), "APP_NAME=Shop\nAPP_URL=http://localhost\n").unwrap();
        assert!(sync_app_url(&dir, "https://shop.test", "test"));
        assert_eq!(fs::read_to_string(dir.join(".env")).unwrap(), "APP_NAME=Shop\nAPP_URL=https://shop.test\n");
        assert!(!sync_app_url(&dir, "https://shop.test", "test"));
        fs::write(dir.join(".env"), "APP_URL=https://shop.example.com\n").unwrap();
        assert!(!sync_app_url(&dir, "https://shop.test", "test"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_bad_env_names() {
        assert!(validate_env_key("MAIL_HOST").is_ok());
        assert!(validate_env_key("1ABC").is_err());
        assert!(validate_env_key("A B").is_err());
        assert!(validate_env_key("").is_err());
    }

    #[test]
    fn parses_artisan_list() {
        let json = serde_json::json!({
            "commands": [
                { "name": "migrate", "description": "Run the database migrations", "hidden": false,
                  "usage": ["migrate [--seed]"],
                  "definition": {
                    "arguments": {},
                    "options": {
                      "seed": { "name": "--seed", "shortcut": "", "accept_value": false, "is_value_required": false, "is_multiple": false, "description": "Seed", "default": false },
                      "help": { "name": "--help", "shortcut": "-h", "accept_value": false, "is_value_required": false, "is_multiple": false, "description": "", "default": false }
                    } } },
                { "name": "make:model", "description": "Create a model", "hidden": false,
                  "definition": { "arguments": {
                    "command": { "name": "command", "is_required": true },
                    "name": { "name": "name", "is_required": true, "is_array": false, "description": "The name", "default": null } },
                    "options": {} } },
                { "name": "secret", "hidden": true, "definition": {} },
                { "name": "_complete", "hidden": false, "definition": {} }
            ]
        });
        let commands = parse_artisan_list(&json);
        assert_eq!(commands.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["make:model", "migrate"]);
        assert_eq!(commands[0].arguments.len(), 1);
        assert!(commands[0].arguments[0].required);
        assert_eq!(commands[1].options.len(), 1);
        assert_eq!(commands[1].options[0].name, "seed");
        assert_eq!(commands[1].usage, "migrate [--seed]");
    }

    #[test]
    fn strips_terminal_codes() {
        assert_eq!(strip_ansi("\u{1b}[32mINFO\u{1b}[39m Done.\u{1b}[0K"), "INFO Done.");
        assert_eq!(strip_ansi("plain"), "plain");
    }

    #[test]
    fn splits_command_lines() {
        assert_eq!(split_words("php artisan queue:work --tries=3"), ["php", "artisan", "queue:work", "--tries=3"]);
        assert_eq!(split_words(r#"php artisan say "hello world" ''"#), ["php", "artisan", "say", "hello world", ""]);
        assert!(split_words("   ").is_empty());
    }

    #[test]
    fn worker_ids_are_unique_slugs() {
        let taken = vec!["queue-worker".to_owned()];
        assert_eq!(new_worker_id("Queue worker", &taken), "queue-worker-2");
        assert_eq!(new_worker_id("Vite (dev)", &taken), "vite-dev");
        assert_eq!(new_worker_id("!!!", &taken), "worker");
        let w = Worker { id: "vite-dev".into(), site: "my.app".into(), ..Default::default() };
        assert_eq!(worker_log_id(&w), "worker-my-app-vite-dev");
    }

    /// Needs the throwaway app made with
    /// `composer create-project laravel/laravel %TEMP%\zefaro-laravel-test`
    /// and PHP 8.3 installed by Zefaro.
    #[test]
    #[ignore]
    fn live_reads_and_runs_code_in_a_laravel_app() {
        let app = App { path: std::env::temp_dir().join("zefaro-laravel-test"), php: "8.3".into() };
        let overview = query(&app, &serde_json::json!({ "op": "overview" })).unwrap();
        assert!(overview["laravel"].as_str().unwrap().contains('.'));
        assert_eq!(overview["database"]["connected"], true);
        let tables = query(&app, &serde_json::json!({ "op": "tables" })).unwrap();
        assert!(tables["tables"].as_array().unwrap().iter().any(|t| t["name"] == "users"));
        let routes = query(&app, &serde_json::json!({ "op": "routes" })).unwrap();
        assert!(routes["routes"].as_array().unwrap().iter().any(|r| r["uri"] == "up"));
        assert!(query(&app, &serde_json::json!({ "op": "rows", "table": "nope" })).is_err());

        let session = Session::start(app.clone()).unwrap();
        let first = session.eval("$n = 40; echo 'hi'; $n + 2", false).unwrap();
        assert_eq!(first["ok"], true, "{first}");
        assert_eq!(first["result"]["v"], 42);
        assert_eq!(first["output"], "hi");
        let second = session.eval("$n", false).unwrap();
        assert_eq!(second["result"]["v"], 40);
        let failed = session.eval("throw new RuntimeException('boom');", false).unwrap();
        assert_eq!(failed["error"]["message"], "boom");
        let ended = session.eval("exit(1);", false).unwrap();
        assert_eq!(ended["ended"], true);
        assert!(!session.is_alive() || { std::thread::sleep(Duration::from_millis(300)); !session.is_alive() });

        let commands = artisan_list(&app).unwrap();
        assert!(commands.iter().any(|c| c.name == "migrate"));
        let jobs = Jobs::default();
        let job = jobs.spawn("test", "php artisan about".into(), artisan_command(&app, &["about".into()]).unwrap()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(60);
        while jobs.output(job.id, 0).unwrap().job.state == "running" && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }
        let out = jobs.output(job.id, 0).unwrap();
        assert_eq!(out.job.state, "done", "{:?}", out.lines);
        assert!(out.lines.iter().any(|l| l.contains("Laravel Version")));
    }

    /// Same throwaway app as above.
    #[test]
    #[ignore]
    fn live_runs_workers_under_the_supervisor() {
        use crate::engine::supervisor::{Health, Supervisor};
        let mut cfg = ZefaroConfig::default();
        cfg.sites[0].name = "zefaro-laravel-test".into();
        cfg.sites[0].path = std::env::temp_dir().join("zefaro-laravel-test").display().to_string();
        cfg.sites[0].php_version = "8.3".into();
        let sup = Supervisor::default();

        let queue = Worker {
            id: "live-queue".into(),
            site: "zefaro-laravel-test".into(),
            label: "Queue".into(),
            command: "php artisan queue:work --sleep=1".into(),
            autostart: false,
        };
        let spec = worker_spec(&cfg, &queue).unwrap();
        sup.start(spec.clone()).unwrap();
        assert_eq!(sup.status(&spec.id).health, Health::Running);
        sup.stop(&spec.id).unwrap();
        assert_eq!(sup.status(&spec.id).health, Health::Stopped);

        let broken = Worker { id: "live-broken".into(), command: "php artisan no-such-command".into(), ..queue };
        let err = sup.start(worker_spec(&cfg, &broken).unwrap()).unwrap_err().to_string();
        assert!(err.contains("no-such-command"), "{err}");
    }
}
