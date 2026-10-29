// Typed wrappers around Tauri `invoke`. One place that knows command names,
// so pages stay clean and refactors are localized. Mutating calls emit a
// `zefaro:refresh` window event so the top-bar summary can stay in sync.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppInfo,
  DumpEntry,
  DumpsStatus,
  DoctorCheck,
  ImportSource,
  ImportLinkResult,
  OldServer,
  ProjectPreview,
  ProjectReport,
  UpdateInfo,
  CaStatus,
  DbJob,
  DbOverview,
  DumpInfo,
  PhpExtension,
  DnsSettingsView,
  DnsTest,
  InstallProgress,
  LogSource,
  LogTail,
  MailMessage,
  MailPage,
  MailStatus,
  MailpitSettings,
  NodeVersionsResponse,
  NginxSettings,
  NginxSettingsView,
  PhpLimits,
  PhpSettingsView,
  PhpVersionsResponse,
  PortStatus,
  Service,
  Site,
  ToolsStatus,
} from "./types";
import type {
  AppLog,
  AppLogFile,
  ArtisanCommand,
  ExternalApp,
  ConfigResponse,
  EnvEntry,
  JobOutput,
  NewSite,
  NewSiteDefaults,
  NewSiteTarget,
  Overview,
  RoutesResponse,
  RowsRequest,
  RowsResponse,
  SiteInfo,
  SiteJob,
  TablesResponse,
  TinkerReply,
  Worker,
  WorkerStatus,
} from "./pages/site/types";

const notify = () => window.dispatchEvent(new Event("zefaro:refresh"));
async function mutate<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  notify();
  return r;
}

export const api = {
  // sites
  listSites: () => invoke<Site[]>("list_sites"),
  /** The folder's zefaro.json and what linking with it would do; null when it has none. */
  projectRead: (path: string) => invoke<ProjectPreview | null>("project_read", { path }),
  /** Link a folder and apply its zefaro.json. */
  projectLink: (path: string) => mutate(invoke<ProjectReport>("project_link", { path })),
  /** Write zefaro.json into the site's folder; resolves to its path. */
  projectSave: (name: string) => invoke<string>("project_save", { name }),
  doctorRun: () => invoke<DoctorCheck[]>("doctor_run"),
  importScan: (extra: string | null) => invoke<ImportSource[]>("import_scan", { extra }),
  importLink: (paths: string[]) => mutate(invoke<ImportLinkResult[]>("import_link", { paths })),
  importDbStatus: () => invoke<OldServer>("import_db_status"),
  importDbDump: (names: string[]) => invoke<string[]>("import_db_dump", { names }),
  importDbLoad: () => mutate(invoke<string[]>("import_db_load")),
  phpXdebugVersion: (version: string) => invoke<string | null>("php_xdebug_version", { version }),
  phpXdebugInstall: (version: string) => invoke<PhpExtension[]>("php_xdebug_install", { version }),
  dumpsStatus: () => invoke<DumpsStatus>("dumps_status"),
  dumpsSetEnabled: (on: boolean) => mutate(invoke<DumpsStatus>("dumps_set_enabled", { on })),
  dumpsList: () => invoke<DumpEntry[]>("dumps_list"),
  dumpsClear: () => invoke<void>("dumps_clear"),
  linkSite: (path: string) => mutate(invoke<Site>("link_site", { path })),
  unlinkSite: (name: string) => mutate(invoke<void>("unlink_site", { name })),
  secureSite: (name: string) => mutate(invoke<Site>("secure_site", { name })),
  setSitePhp: (name: string, version: string) =>
    mutate(invoke<Site>("set_site_php", { name, version })),

  // new site wizard
  newSiteDefaults: () => invoke<NewSiteDefaults>("new_site_defaults"),
  /** Rejects with a readable reason when the name or folder can't be used. */
  newSiteCheck: (name: string, parent: string) => invoke<NewSiteTarget>("new_site_check", { name, parent }),
  /** Runs the Laravel installer, links the site and sets up .env, as one job. */
  newSiteCreate: (options: NewSite) => mutate(invoke<SiteJob>("new_site_create", { options })),

  // a site's Laravel app (site page)
  siteInfo: (name: string) => invoke<SiteInfo>("site_info", { name }),
  /** Editors, terminals and database tools found on this computer that fit the site. */
  siteOpenTargets: (name: string) => invoke<ExternalApp[]>("site_open_targets", { name }),
  siteOpen: (name: string, target: string) => invoke<void>("site_open", { name, target }),
  siteLogs: (name: string) => invoke<AppLogFile[]>("site_logs", { name }),
  siteLogRead: (name: string, file: string) => invoke<AppLog>("site_log_read", { name, file }),
  siteLogClear: (name: string, file: string) => invoke<void>("site_log_clear", { name, file }),
  siteOverview: (name: string) => invoke<Overview>("site_overview", { name }),
  siteTables: (name: string) => invoke<TablesResponse>("site_tables", { name }),
  siteRows: (name: string, request: RowsRequest) => invoke<RowsResponse>("site_rows", { name, request }),
  siteUpdateCell: (name: string, table: string, key: Record<string, unknown>, column: string, value: unknown) =>
    invoke<{ affected: number }>("site_update_cell", { name, table, key, column, value }),
  siteDeleteRow: (name: string, table: string, key: Record<string, unknown>) =>
    invoke<{ affected: number }>("site_delete_row", { name, table, key }),
  siteConfig: (name: string) => invoke<ConfigResponse>("site_config", { name }),
  siteRoutes: (name: string) => invoke<RoutesResponse>("site_routes", { name }),
  siteEnv: (name: string) => invoke<EnvEntry[]>("site_env", { name }),
  /** Ends the site's Tinker session and clears a cached config. */
  siteEnvSet: (name: string, values: [string, string][]) => invoke<EnvEntry[]>("site_env_set", { name, values }),
  tinkerEval: (name: string, code: string, rollback: boolean) =>
    invoke<TinkerReply>("tinker_eval", { name, code, rollback }),
  tinkerReset: (name: string) => invoke<void>("tinker_reset", { name }),
  tinkerStop: (name: string) => invoke<void>("tinker_stop", { name }),
  artisanCommands: (name: string) => invoke<ArtisanCommand[]>("artisan_commands", { name }),
  /** `php artisan …` or `composer …` in the site's folder; arguments never pass through a shell. */
  siteJobRun: (name: string, tool: "artisan" | "composer", args: string[]) =>
    invoke<SiteJob>("site_job_run", { name, tool, args }),
  siteJobOutput: (id: number, since: number) => invoke<JobOutput | null>("site_job_output", { id, since }),
  siteJobs: (name: string) => invoke<SiteJob[]>("site_jobs", { name }),
  siteJobStop: (id: number) => invoke<void>("site_job_stop", { id }),
  workersList: (site: string) => invoke<WorkerStatus[]>("workers_list", { site }),
  /** An empty id adds a worker; a running worker restarts with the change. */
  workerSave: (worker: Worker) => invoke<WorkerStatus>("worker_save", { worker }),
  workerRemove: (id: string) => invoke<void>("worker_remove", { id }),
  workerStart: (id: string) => invoke<WorkerStatus>("worker_start", { id }),
  workerStop: (id: string) => invoke<WorkerStatus>("worker_stop", { id }),

  // php
  phpVersions: () => invoke<PhpVersionsResponse>("php_versions"),
  phpInstall: (version: string) => mutate(invoke<void>("php_install", { version })),
  phpActivate: (version: string) => mutate(invoke<void>("php_activate", { version })),
  /** Settings of one installed line (the active one when omitted). */
  phpSettings: (version?: string) => invoke<PhpSettingsView>("php_settings", { version }),
  /** Writes that line's php.ini only; resolves to the line, e.g. "8.5". */
  phpSaveLimits: (limits: PhpLimits, version?: string) =>
    invoke<string>("php_save_limits", { limits, version }),
  phpIniText: (version: string) => invoke<string>("php_ini_text", { version }),
  phpExtensions: (version: string) => invoke<PhpExtension[]>("php_extensions", { version }),
  phpSaveExtensions: (version: string, changes: Record<string, boolean>) =>
    invoke<PhpExtension[]>("php_save_extensions", { version, changes }),
  phpRevealIni: (version: string) => invoke<void>("php_reveal_ini", { version }),
  phpSaveBasePort: (port: number) => invoke<void>("php_save_base_port", { port }),
  /** The CA bundle php.ini points at: Mozilla's roots plus Zefaro's CA. */
  phpCaBundle: () => invoke<{ updatedMs: number | null; hasZefaroCa: boolean; path: string }>("php_ca_bundle"),
  /** Downloads Mozilla's list again. */
  phpCaBundleUpdate: () => invoke<{ updatedMs: number | null; hasZefaroCa: boolean; path: string }>("php_ca_bundle_update"),
  onPhpInstallProgress: (cb: (p: InstallProgress) => void) =>
    listen<InstallProgress>("php-install-progress", (e) => cb(e.payload)),

  // node.js
  nodeVersions: () => invoke<NodeVersionsResponse>("node_versions"),
  nodeInstall: (major: string) => mutate(invoke<void>("node_install", { major })),
  nodeActivate: (major: string) => mutate(invoke<void>("node_activate", { major })),
  nodeUninstall: (major: string) => mutate(invoke<void>("node_uninstall", { major })),
  onNodeInstallProgress: (cb: (p: InstallProgress) => void) =>
    listen<InstallProgress>("node-install-progress", (e) => cb(e.payload)),

  // tooling
  toolsStatus: () => invoke<ToolsStatus>("tools_status"),
  /** The active PHP line when installed; nothing to run, so it answers at once. */
  toolsActivePhp: () => invoke<string | null>("tools_active_php"),
  /** Is Zefaro's bin folder on the user PATH? Asks PowerShell, so it's slower. */
  toolsBinOnPath: () => invoke<boolean>("tools_bin_on_path"),
  installComposer: () => invoke<void>("tools_install_composer"),
  installLaravel: () => invoke<void>("tools_install_laravel"),
  addBinToPath: () => invoke<void>("path_add_bin"),

  // services
  listServices: () => invoke<Service[]>("list_services"),
  startService: (id: string) => mutate(invoke<void>("start_service", { id })),
  stopService: (id: string) => mutate(invoke<void>("stop_service", { id })),
  /** Install progress of services being started, by id. */
  serviceProgress: () =>
    invoke<Record<string, { phase: "download" | "extract" | "setup"; done: number; total: number | null }>>("service_progress"),
  /** Adds the Windows *.test rule (UAC prompt) and starts DNS; resolves to
   *  whether Windows now resolves *.test to this machine. */
  dnsSetup: () => mutate(invoke<boolean>("dns_setup")),
  dnsRemove: () => mutate(invoke<void>("dns_remove")),
  dnsSettings: () => invoke<DnsSettingsView>("dns_settings"),
  dnsTest: () => invoke<DnsTest>("dns_test"),
  dnsFlushCache: () => invoke<void>("dns_flush_cache"),
  /** Moves the Windows rule (UAC prompt if it was set up), restarts DNS, regenerates nginx. */
  dnsSetTld: (tld: string) => mutate(invoke<DnsSettingsView>("dns_set_tld", { tld })),

  // nginx settings
  nginxSettings: () => invoke<NginxSettingsView>("nginx_settings"),
  nginxPortStatus: (port: number) => invoke<PortStatus>("nginx_port_status", { port }),
  /** Tested with `nginx -t` before it's kept; a running nginx reloads or restarts. */
  nginxSaveSettings: (settings: NginxSettings) =>
    mutate(invoke<NginxSettingsView>("nginx_save_settings", { settings })),
  nginxConfigText: () => invoke<string>("nginx_config_text"),
  nginxRevealConfig: () => invoke<void>("nginx_reveal_config"),

  // mail (Mailpit)
  mailStatus: () => invoke<MailStatus>("mail_status"),
  /** Newest first; `query` uses Mailpit's search syntax. */
  mailList: (query: string, start: number, limit: number) =>
    invoke<MailPage>("mail_list", { query, start, limit }),
  /** Opening a message marks it read. */
  mailGet: (id: string) => invoke<MailMessage>("mail_get", { id }),
  /** Inline images as data: URLs by Content-ID (the preview has no network). */
  mailInlineImages: (id: string) => invoke<Record<string, string>>("mail_inline_images", { id }),
  mailHeaders: (id: string) => invoke<Record<string, string[]>>("mail_headers", { id }),
  mailRaw: (id: string) => invoke<string>("mail_raw", { id }),
  /** No IDs = every message. */
  mailSetRead: (ids: string[], read: boolean) => invoke<void>("mail_set_read", { ids, read }),
  /** No IDs = every message. */
  mailDelete: (ids: string[]) => invoke<void>("mail_delete", { ids }),
  mailSaveSettings: (settings: MailpitSettings) =>
    mutate(invoke<MailStatus>("mail_save_settings", { settings })),
  mailStart: () => mutate(invoke<MailStatus>("mail_start")),

  // databases
  dbOverview: () => invoke<DbOverview>("db_overview"),
  dbCreate: (name: string) => invoke<void>("db_create", { name }),
  dbDrop: (name: string) => invoke<void>("db_drop", { name }),
  dbNameFromFile: (path: string) => invoke<string>("db_name_from_file", { path }),
  diskFree: (path: string) => invoke<number | null>("disk_free", { path }),
  dbJob: () => invoke<DbJob | null>("db_job"),
  dbJobCancel: () => invoke<void>("db_job_cancel"),
  dbJobDismiss: () => invoke<void>("db_job_dismiss"),
  dbExport: (name: string, path: string, gzip: boolean) =>
    invoke<DbJob>("db_export", { name, path, gzip }),
  /** With `replace`, an existing database of that name is dropped first. */
  dbScanDump: (path: string) => invoke<DumpInfo>("db_scan_dump", { path }),
  dbImport: (path: string, name: string, replace: boolean, from: string | null) =>
    invoke<DbJob>("db_import", { path, name, replace, from }),
  dbReveal: (path: string) => invoke<void>("db_reveal", { path }),
  dbDefaultDir: () => invoke<string>("db_default_dir"),

  // https
  caStatus: () => invoke<CaStatus>("ca_status"),
  /** Windows shows its own confirmation dialog; rejects if the user declines. */
  caTrust: () => mutate(invoke<CaStatus>("ca_trust")),
  caUntrust: () => mutate(invoke<CaStatus>("ca_untrust")),
  caReveal: () => invoke<void>("ca_reveal"),

  // logs
  listLogs: () => invoke<LogSource[]>("list_logs"),
  tailLog: (source: string, lines?: number) => invoke<LogTail>("tail_log", { source, lines }),
  clearLog: (source: string) => invoke<void>("clear_log", { source }),
  /** Show the logs folder, or one log file selected, in Explorer. */
  revealLog: (source?: string) => invoke<void>("reveal_log", { source }),

  // system
  appInfo: () => invoke<AppInfo>("app_info"),
  /** Saves the language setting and switches the backend's messages to `resolved`. */
  setLanguage: (setting: string, resolved: string) => invoke<void>("set_language", { setting, resolved }),
  /** What closing the window does: keep running in the tray (true) or quit. */
  /** Settings wait to be written because another program has config.json open. */
  configPending: () => invoke<boolean>("config_pending"),
  setCloseToTray: (on: boolean) => invoke<void>("set_close_to_tray", { on }),
  /** Ask GitHub whether a newer Zefaro exists. Nothing is downloaded. */
  checkUpdate: () => invoke<UpdateInfo>("check_update"),
  setCheckUpdates: (on: boolean) => invoke<void>("set_check_updates", { on }),
  /** Answer to the first-close question: remember it, then hide or quit. */
  closeWindow: (keepRunning: boolean) => invoke<void>("close_window", { keepRunning }),
};
