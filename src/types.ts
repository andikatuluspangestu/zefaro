// Mirror of the Rust serde model (camelCase on the wire).

export interface Site {
  name: string;
  path: string;
  url: string;
  secured: boolean;
  phpVersion: string;
  kind: "linked" | "parked";
  /** What the folder holds: "laravel", "wordpress", "php", "static", … */
  framework?: string;
  /** Forwarded to a dev server on this port (Vite, Next.js) instead of PHP. */
  proxy?: number;
}

/** One PHP release line, e.g. "8.5". */
export interface PhpVersion {
  version: string;
  /** Newest published patch, e.g. "8.5.11". */
  latest: string | null;
  /** Installed patch, if installed. */
  installed: string | null;
  isActive: boolean;
  updateAvailable: boolean;
  /** php-cgi FastCGI port: base port + 10 × major + minor. */
  port: number;
  size: string | null;
}

export interface PhpVersionsResponse {
  versions: PhpVersion[];
  /** The release list couldn't be fetched; only installed/cached versions shown. */
  offline: boolean;
}

/** php.ini limits of one PHP line (each line keeps its own). */
export interface PhpLimits {
  maxUploadMb: number;
  /** -1 = unlimited */
  memoryLimitMb: number;
  maxInputVars: number;
}

export interface PhpSettingsView {
  /** Active PHP line, if installed. */
  active: string | null;
  /** The installed line these limits belong to; null when no PHP is installed. */
  version: string | null;
  /** Installed lines, newest first. */
  installed: string[];
  limits: PhpLimits;
  /** PHP's stock values. */
  defaults: PhpLimits;
  /** Shared by every line: each listens on base port + its version. */
  basePort: number;
  /** Where `version`'s php-cgi listens. */
  port: number | null;
  running: boolean;
  iniPath: string | null;
}

export interface InstallProgress {
  version: string;
  phase: "download" | "extract" | "configure" | "done";
  downloaded: number;
  total: number | null;
}

export interface ToolStatus {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
}

export interface ToolsStatus {
  composer: ToolStatus;
  laravel: ToolStatus;
  /** Minimum PHP line the latest Laravel installer needs, e.g. "8.2". */
  laravelRequiresPhp: string | null;
  activePhp: string | null;
  binDir: string;
  binOnPath: boolean;
}

export type ServiceStatus = "running" | "starting" | "stopped" | "error";

export interface Service {
  id: string;
  name: string;
  category: "core" | "database" | "mail";
  status: ServiceStatus;
  port: number | null;
  pid: number | null;
  /** False for services not wired up yet (DNS, databases, mail). */
  available: boolean;
  /** Binary is downloaded on first start (nginx). */
  needsInstall: boolean;
  /** e.g. "nginx 1.30.6", "php-cgi · active", "Coming soon". */
  detail: string | null;
  /** Why the last run failed, when status is "error". */
  error: string | null;
  /** One-time system setup still needed (DNS: the Windows rule for *.test). */
  setup: string | null;
  /** That setup exists and can be removed. */
  setupDone: boolean;
  /** Web address to open, for services with a UI (phpMyAdmin). */
  url: string | null;
  /** A command-line tool (Node.js): no start/stop; "running" = a version is active. */
  tool: boolean;
}

/** One Node.js major line. */
export interface NodeVersion {
  major: string;
  /** Newest release of the line, e.g. "24.22.1". */
  latest: string | null;
  installed: string | null;
  isActive: boolean;
  updateAvailable: boolean;
  /** LTS codename, e.g. "Krypton"; null for Current. */
  lts: string | null;
  /** npm bundled with `latest`. */
  npm: string | null;
}

export interface NodeVersionsResponse {
  versions: NodeVersion[];
  offline: boolean;
  binDir: string;
  binOnPath: boolean;
}

/** One log file in ~/.config/zefaro/logs. */
export interface LogSource {
  /** File name without .log, e.g. "nginx-error" or "php-8.3". */
  id: string;
  label: string;
  group: "Web" | "PHP" | "Databases" | "System" | "Workers" | "Other";
  description: string;
  path: string;
  size: number;
  /** Last write, ms since the Unix epoch. */
  modified: number | null;
}

export type LogLevel = "info" | "warn" | "error";

/** One parsed log line. */
export interface LogEntry {
  /** Local time "YYYY-MM-DD HH:MM:SS", when the line has one. */
  ts: string | null;
  level: LogLevel;
  /** HTTP status, MariaDB severity, PHP error type. */
  tag: string | null;
  message: string;
  /** Site, size, timing, or nginx's request context. */
  detail: string | null;
  /** The line exactly as written. */
  raw: string;
}

export interface LogTail {
  source: LogSource;
  entries: LogEntry[];
  /** The file has older lines than the ones returned. */
  truncated: boolean;
}

export interface AppInfo {
  name: string;
  version: string;
  tld: string;
  configDir: string;
  helperInstalled: boolean;
  /** Third-party software Zefaro downloads and runs. */
  components: Component[];
  /** Interface language setting: "system", "en" or "id". */
  language: string;
  /** Closing the window keeps Zefaro running in the system tray. */
  closeToTray: boolean;
  /** Look for a newer Zefaro when it starts. */
  checkUpdates: boolean;
  /** Zefaro starts, hidden in the tray, when the user signs in to Windows. */
  startWithWindows: boolean;
  /** Services started when Zefaro opens (ids such as "mariadb"). */
  autostart: string[];
  /** This Windows account can approve an admin prompt (a standard account can't). */
  canElevate: boolean;
}

export interface Component {
  name: string;
  version: string;
  license: string;
  /** Where Zefaro downloads it from. */
  source: string;
}

/** Zefaro's local certificate authority (HTTPS for sites). */
export interface CaStatus {
  /** Made when the first site gets HTTPS. */
  created: boolean;
  /** In the current user's Trusted Root store, so browsers accept site certificates. */
  trusted: boolean;
  /** The only TLD it can sign for. */
  tld: string;
  /** SHA-1 thumbprint, as Windows' confirmation dialog shows it. */
  thumbprint: string | null;
  /** Unix seconds. */
  expires: number | null;
  certPath: string;
}

/** nginx settings (gear on the nginx card). Mirrors `NginxConfig` in config.rs. */
export interface NginxSettings {
  httpPort: number;
  httpsPort: number;
  /** 0 = auto (one per CPU core). */
  workerProcesses: number;
  workerConnections: number;
  keepaliveTimeout: number;
  /** Seconds nginx waits for PHP. */
  fastcgiReadTimeout: number;
  /** 0 = no limit (PHP's upload limit applies). */
  clientMaxBodyMb: number;
  gzip: boolean;
  http2: boolean;
  accessLog: boolean;
  errorLogLevel: "debug" | "info" | "notice" | "warn" | "error" | "crit";
  /** Extra directives inside nginx's http { } block. */
  extraHttp: string;
}

export interface NginxSettingsView {
  settings: NginxSettings;
  defaults: NginxSettings;
  installed: boolean;
  running: boolean;
  confPath: string;
  securedSites: number;
}

export interface PortStatus {
  port: number;
  free: boolean;
  /** Zefaro's own nginx is listening there. */
  ours: boolean;
  /** e.g. "httpd (PID 2724)". */
  owner: string | null;
}

/** DNS settings (gear on the DNS card). */
export interface DnsSettingsView {
  /** Local domain, without the dot. */
  tld: string;
  /** Local domains to choose from. */
  tlds: string[];
  port: number;
  running: boolean;
  /** Windows sends .tld lookups to Zefaro; null while unknown, and for .localhost (no rule). */
  ruleInstalled: boolean | null;
  /** The domain needs the Windows rule, with its admin prompt: false for .localhost. */
  needsRule: boolean;
  /** This Windows account can approve an admin prompt. */
  canElevate: boolean;
  sites: number;
  securedSites: number;
}

export interface DnsTest {
  name: string;
  /** Zefaro's DNS server answered directly. */
  serverAnswers: boolean;
  /** Windows' own resolver returned 127.0.0.1 (the rule works). */
  windowsResolves: boolean;
}

/** One MariaDB database on the Databases page. */
export interface DbInfo {
  name: string;
  /** Data + indexes, in bytes. */
  size: number;
  tables: number;
}

export interface DbOverview {
  /** MariaDB answers on its port. */
  running: boolean;
  databases: DbInfo[];
  dataDir: string;
  /** Free bytes on the drive holding the data folder. */
  dataFree: number | null;
}

/** One extension DLL a PHP version ships (PHP settings page). */
export interface PhpExtension {
  /** As php.ini names it: "intl", "pdo_mysql". */
  name: string;
  /** Zefaro loads it (the user's choice, else Zefaro's default). */
  enabled: boolean;
  /** On unless the user turns it off. */
  defaultOn: boolean;
  /** Loaded with zend_extension=. */
  zend: boolean;
  /** The user's own php.ini lines load it, so Zefaro leaves it alone. */
  inIni: boolean;
  /** Why PHP couldn't load it, when it is on and failed. */
  error: string | null;
}

/** What a dump file holds, read before importing it. */
export interface DumpInfo {
  /** "MySQL 8.4.3" or "MariaDB 11.8.9", when the dump says. */
  origin: string | null;
  /** Databases in a multi-database dump, MariaDB's own left out. Empty for a single-database dump. */
  databases: { name: string; bytes: number }[];
  /** System databases in the dump, which Zefaro never imports. */
  system: string[];
}

/** The database export/import in progress, or the last one. */
export interface DbJob {
  kind: "export" | "import";
  database: string;
  file: string;
  state: "running" | "done" | "failed" | "cancelled";
  /** Export: uncompressed bytes dumped. Import: bytes of the file read. */
  done: number;
  /** Export: database size (estimate). Import: file size. */
  total: number | null;
  startedMs: number;
  endedMs: number | null;
  message: string | null;
  /** Size of the written export file. */
  resultSize: number | null;
}

/** Mailpit settings (gear on the Mailpit card). Mirrors MailpitConfig. */
export interface MailpitSettings {
  smtpPort: number;
  uiPort: number;
  maxMessages: number;
  /** 0 keeps mail forever. */
  maxAgeDays: number;
}

export interface MailStatus {
  installed: boolean;
  running: boolean;
  version: string;
  downloadMb: number;
  settings: MailpitSettings;
  defaults: MailpitSettings;
  /** Mailpit's own web UI (mailpit.test through nginx, else its port). */
  webUrl: string;
  /** e.g. http://127.0.0.1:8025/api/v1 — for message parts. */
  apiUrl: string;
}

export interface MailAddress {
  name: string;
  address: string;
}

export interface MailSummary {
  id: string;
  read: boolean;
  from: MailAddress | null;
  to: MailAddress[];
  subject: string;
  /** RFC 3339. */
  created: string;
  size: number;
  attachments: number;
  snippet: string;
}

export interface MailPage {
  messages: MailSummary[];
  /** Matching (search) or stored messages. */
  total: number;
  /** Unread in the whole mailbox. */
  unread: number;
  start: number;
}

export interface MailPart {
  partId: string;
  fileName: string;
  contentType: string;
  contentId: string;
  size: number;
}

export interface MailMessage {
  id: string;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo: MailAddress[];
  subject: string;
  date: string;
  text: string;
  html: string;
  size: number;
  inline: MailPart[];
  attachments: MailPart[];
}

/** One database inside a backup file. */
export interface BackupDb {
  name: string;
  /** Size of its dump, uncompressed. */
  bytes: number;
}

/** What a backup file holds, read before restoring it. */
export interface BackupContents {
  zefaro: string;
  /** Unix seconds. */
  created: number;
  sites: number;
  databases: BackupDb[];
}

/** The backup or restore in progress, or the last one until dismissed. */
export interface BackupJob {
  kind: "backup" | "restore";
  state: "running" | "done" | "failed" | "cancelled";
  file: string;
  phase: "preparing" | "settings" | "database" | "finishing";
  /** The database being dumped or loaded. */
  current: string | null;
  done: number;
  total: number;
  /** Why it failed, or a note about what was left out. */
  message: string | null;
  size: number | null;
  /** Databases dumped (backup) or loaded (restore). */
  loaded: string[];
  /** Restore: databases that already existed and were kept. */
  skipped: string[];
  settingsRestored: boolean;
  /** Restored sites use HTTPS, which needs the new certificate authority trusted. */
  hasSecuredSites: boolean;
  startedMs: number;
  endedMs: number | null;
}

/** The latest release on GitHub, compared with this copy of Zefaro. */
export interface UpdateInfo {
  current: string;
  latest: string;
  newer: boolean;
  /** The release page, with the installer and notes. */
  url: string;
  published: string | null;
  /** The release has an installer Zefaro can download and check itself. */
  canInstall: boolean;
  /** The installer's size in bytes. */
  installerSize: number | null;
}

/** How far "Update now" has got. */
export interface UpdateProgress {
  phase: "checking" | "downloading" | "verifying" | "installing";
  done: number;
  total: number | null;
}

/** A project's zefaro.json. */
export interface ProjectFile {
  name?: string;
  php?: string;
  https?: boolean;
  proxy?: number;
  services?: string[];
  database?: { driver: string; name: string };
  workers?: { label: string; command: string; autostart?: boolean }[];
}

/** What linking a folder with a zefaro.json would do. */
export interface ProjectPreview {
  file: ProjectFile;
  name: string;
  nameTaken: boolean;
  phpInstalled: boolean;
}

export interface ProjectReport {
  site: Site;
  done: string[];
  warnings: string[];
}

/** One finding on the Diagnostics page. */
export interface DoctorCheck {
  id: string;
  level: "ok" | "info" | "warn" | "error";
  title: string;
  detail: string;
  /** "services", "nginx", "php", "sites", "import", or "url:<address>". */
  action: string | null;
}

/** XAMPP's htdocs, Laragon's www, or a folder the user picked. */
export interface ImportSource {
  kind: "xampp" | "laragon" | "folder";
  root: string;
  projects: {
    folder: string;
    path: string;
    framework: string | null;
    /** The site name it would get. */
    site: string;
    linked: boolean;
  }[];
}

export interface ImportLinkResult {
  path: string;
  site: Site | null;
  error: string | null;
}

/** The old MySQL of XAMPP or Laragon on port 3306. */
export interface OldServer {
  running: boolean;
  zefaroRunning: boolean;
  databases: DbInfo[];
  /** Dumps copied out and not yet loaded. */
  waiting: string[];
  error: string | null;
}

/** One dump() that arrived from a site. */
export interface DumpEntry {
  id: string;
  /** Unix seconds. */
  time: number;
  file: string | null;
  line: number | null;
  name: string | null;
  /** The command line, for dumps from artisan or other PHP scripts. */
  command: string | null;
  node: import("./pages/site/types").DumpNode;
}

export interface DumpsStatus {
  enabled: boolean;
  running: boolean;
}

/** A shell the Terminal page can open. */
export interface TerminalShell {
  /** "pwsh" | "powershell" | "cmd" | "bash" */
  id: string;
  name: string;
}

export interface TerminalInfo {
  id: number;
  title: string;
  shell: string;
  shellName: string;
  cwd: string;
  site: string | null;
  php: string | null;
  /** Set once the shell has ended. */
  exitCode: number | null;
  startedMs: number;
}
