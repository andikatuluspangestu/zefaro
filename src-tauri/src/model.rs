//! Serde data model shared with the frontend (camelCase on the wire).
//!
//! Everything here is free in Zefaro. AI and cloud features are out of scope
//! by design.

use serde::{Deserialize, Serialize};

/// A PHP project served at `<name>.<tld>`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    pub name: String,
    pub path: String,
    pub url: String,
    pub secured: bool,
    pub php_version: String,
    /// "linked" (explicitly linked) or "parked" (auto-served from a parked dir).
    pub kind: String,
    /// What the folder holds ("laravel", "wordpress", "php", …), found when
    /// sites are listed. Not stored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub framework: Option<String>,
    /// Forward the site to a dev server on this port (Vite, Next.js) instead
    /// of serving the folder with PHP.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<u16>,
}

/// One PHP release line (e.g. "8.5") as shown in the PHP versions list.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PhpVersion {
    /// Minor version line, e.g. "8.5".
    pub version: String,
    /// Newest patch release published for this line, e.g. "8.5.11".
    pub latest: Option<String>,
    /// Installed patch release, if this line is installed.
    pub installed: Option<String>,
    pub is_active: bool,
    pub update_available: bool,
    /// FastCGI port this line's php-cgi listens on: base port + 10 × major + minor.
    pub port: u16,
    /// Download size as published, e.g. "34.38MB".
    pub size: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PhpVersionsResponse {
    pub versions: Vec<PhpVersion>,
    /// True when the release list couldn't be fetched (only installed versions,
    /// or a stale cached list, are shown).
    pub offline: bool,
}

/// One Node.js major line as shown in the Node.js versions list.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NodeVersion {
    /// Major line, e.g. "24".
    pub major: String,
    /// Newest release of the line, e.g. "24.22.1".
    pub latest: Option<String>,
    pub installed: Option<String>,
    pub is_active: bool,
    pub update_available: bool,
    /// LTS codename ("Krypton"); None for Current or unknown lines.
    pub lts: Option<String>,
    /// npm bundled with `latest`.
    pub npm: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NodeVersionsResponse {
    pub versions: Vec<NodeVersion>,
    pub offline: bool,
    pub bin_dir: String,
    pub bin_on_path: bool,
}

/// php.ini limits for one PHP line. Each line keeps its own; edits only ever
/// touch the active line.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PhpLimits {
    pub max_upload_mb: i64,
    /// -1 means unlimited.
    pub memory_limit_mb: i64,
    pub max_input_vars: i64,
}

impl Default for PhpLimits {
    // PHP's own defaults, so a fresh install behaves like stock PHP.
    fn default() -> Self {
        Self {
            max_upload_mb: 2,
            memory_limit_mb: 128,
            max_input_vars: 1000,
        }
    }
}

/// What a PHP version's settings page shows: that line's limits plus the base
/// port, which is shared by every line.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PhpSettingsView {
    /// Active PHP line, if it is installed.
    pub active: Option<String>,
    /// The installed line these limits belong to (the requested one, else the
    /// active one); None when no PHP is installed.
    pub version: Option<String>,
    /// Every installed line, newest first, for switching between them.
    pub installed: Vec<String>,
    pub limits: PhpLimits,
    /// PHP's stock values, for "Reset to defaults".
    pub defaults: PhpLimits,
    pub base_port: u16,
    /// Where `version`'s php-cgi listens (base port + its version).
    pub port: Option<u16>,
    pub running: bool,
    /// `version`'s php.ini.
    pub ini_path: Option<String>,
}

/// Emitted as the `php-install-progress` event while a version installs.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub version: String,
    /// "download" | "extract" | "configure" | "done"
    pub phase: String,
    pub downloaded: u64,
    pub total: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub installed: Option<String>,
    pub latest: Option<String>,
    pub update_available: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    pub composer: ToolStatus,
    pub laravel: ToolStatus,
    /// Minimum PHP line the latest Laravel installer requires, e.g. "8.2".
    pub laravel_requires_php: Option<String>,
    /// Active PHP line, if it is installed.
    pub active_php: Option<String>,
    pub bin_dir: String,
    pub bin_on_path: bool,
}

/// A background service. `category` groups them in the UI: "core" (nginx,
/// one php-cgi per PHP version, DNS), "database", "mail". All are free in Zefaro.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub name: String,
    pub category: String,
    /// "running" | "starting" | "stopped" | "error"
    pub status: String,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    /// False for services that aren't wired up yet (shown as coming soon).
    pub available: bool,
    /// Its binary is downloaded on first start.
    pub needs_install: bool,
    /// A command-line tool rather than a background process (Node.js): no
    /// start/stop, "running" means a version is active.
    pub tool: bool,
    /// Version / role, e.g. "nginx 1.30.6" or "php-cgi · active".
    pub detail: Option<String>,
    /// Why the last run failed, when status is "error".
    pub error: Option<String>,
    /// A one-time system setup this service still needs (DNS: the Windows
    /// rule for *.test), explained for the user.
    pub setup: Option<String>,
    /// That one-time setup exists and can be removed again.
    pub setup_done: bool,
    /// Web address to open, for services with a UI (phpMyAdmin).
    pub url: Option<String>,
}

/// One log file in `~/.config/zefaro/logs`, as listed on the Logs page.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogSource {
    /// File name without `.log`, e.g. "nginx-error" or "php-8.3".
    pub id: String,
    pub label: String,
    /// "Web" | "PHP" | "Databases" | "System" | "Other"
    pub group: String,
    pub description: String,
    pub path: String,
    pub size: u64,
    /// Last write, in milliseconds since the Unix epoch.
    pub modified: Option<u64>,
}

/// One parsed line of a log.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Local time as `YYYY-MM-DD HH:MM:SS`, when the line has one.
    pub ts: Option<String>,
    pub level: String, // "info" | "warn" | "error"
    /// Short label: HTTP status, MariaDB severity, PHP error type.
    pub tag: Option<String>,
    pub message: String,
    /// Secondary facts (site, size, timing, nginx's client/request context).
    pub detail: Option<String>,
    /// The line exactly as written.
    pub raw: String,
}

/// The end of one log file.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogTail {
    pub source: LogSource,
    pub entries: Vec<LogEntry>,
    /// The file has older lines than the ones returned.
    pub truncated: bool,
}

/// App + environment summary shown in Settings / top bar.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tld: String,
    pub config_dir: String,
    /// Whether the privileged "Zefaro Helper" service is installed (hosts file,
    /// binding :80/:443, trusting the local CA). Stubbed until implemented.
    pub helper_installed: bool,
    /// Third-party software Zefaro downloads and runs, for the About page.
    pub components: Vec<Component>,
    /// The language setting: "system", "en" or "id".
    pub language: String,
    /// Closing the window keeps Zefaro running in the system tray.
    pub close_to_tray: bool,
    /// Look for a newer Zefaro when it starts.
    pub check_updates: bool,
}

/// One piece of third-party software Zefaro installs.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub name: String,
    pub version: String,
    pub license: String,
    /// Where Zefaro downloads it from.
    pub source: String,
}

/// Zefaro's local certificate authority, for the HTTPS settings.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CaStatus {
    /// The CA exists (it's made when the first site gets HTTPS).
    pub created: bool,
    /// It's in the current user's Trusted Root store, so browsers accept
    /// Zefaro's site certificates.
    pub trusted: bool,
    /// The only TLD it can sign certificates for.
    pub tld: String,
    pub thumbprint: Option<String>,
    /// Unix seconds.
    pub expires: Option<i64>,
    pub cert_path: String,
}

/// The export or import in progress (or the last one, until dismissed).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DbJob {
    /// "export" | "import"
    pub kind: String,
    pub database: String,
    pub file: String,
    /// "running" | "done" | "failed" | "cancelled"
    pub state: String,
    /// Export: uncompressed bytes dumped. Import: bytes of the file read.
    pub done: u64,
    /// Export: the database's size (an estimate of the dump). Import: file size.
    pub total: Option<u64>,
    pub started_ms: u64,
    pub ended_ms: Option<u64>,
    pub message: Option<String>,
    /// Size of the written export file.
    pub result_size: Option<u64>,
}
