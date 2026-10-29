// What the site page receives from the backend (commands/laravel.rs and the
// PHP runner, engine/laravel-runner.php).

import type { Site } from "@/types";

export interface SiteInfo {
  site: Site;
  isLaravel: boolean;
  hasVendor: boolean;
  hasEnv: boolean;
  /** PHP line the tools use; null when no PHP is installed. */
  php: string | null;
  mariadbRunning: boolean;
  postgresRunning: boolean;
  mailpitSmtpPort: number;
  mailpitRunning: boolean;
  composerInstalled: boolean;
}

export interface Overview {
  laravel: string;
  php: string;
  name: string | null;
  environment: string;
  debug: boolean;
  url: string | null;
  timezone: string | null;
  locale: string | null;
  keySet: boolean;
  maintenance: boolean;
  configCached: boolean;
  routesCached: boolean;
  eventsCached: boolean;
  storageLinked: boolean;
  drivers: {
    database: string | null;
    databaseDriver: string | null;
    databaseName: string | null;
    databaseHost: string | null;
    databasePort: string | null;
    cache: string | null;
    session: string | null;
    queue: string | null;
    mail: string | null;
    mailHost: string | null;
    mailPort: string | null;
    filesystem: string | null;
    broadcast: string | null;
    log: string | null;
  };
  database: { connected: boolean; error: string | null };
  /** Names of migrations not run yet; null when they couldn't be read. */
  pendingMigrations: string[] | null;
  packages: Record<"horizon" | "reverb" | "octane" | "pulse" | "telescope", boolean>;
}

export interface TableInfo {
  name: string;
  /** Bytes, when the database reports it. */
  size: number | null;
  /** Eloquent model class for the table. */
  model: string | null;
}

export interface TablesResponse {
  driver: string;
  tables: TableInfo[];
}

export interface Column {
  name: string;
  type: string | null;
  nullable: boolean;
}

/** A cell: plain JSON, or a marker for values the runner shortened. */
export type Cell =
  | string
  | number
  | boolean
  | null
  | { binary: number }
  | { text: string; length: number };

export interface RowFilter {
  column: string;
  op: "=" | "!=" | "<" | "<=" | ">" | ">=" | "like" | "not like" | "null" | "not null";
  value: string;
}

export interface RowsRequest {
  table: string;
  page: number;
  perPage: number;
  search: string;
  sort: string | null;
  direction: "asc" | "desc";
  filters: RowFilter[];
}

export interface RowsResponse {
  table: string;
  columns: Column[];
  primaryKey: string[];
  /** Columns the model hides ($hidden), shown masked. */
  hidden: string[];
  model: string | null;
  rows: Cell[][];
  total: number;
  page: number;
  perPage: number;
}

export interface ConfigItem {
  key: string;
  value: unknown;
  type: string;
}

export interface ConfigResponse {
  cached: boolean;
  items: ConfigItem[];
}

export interface RouteInfo {
  methods: string[];
  uri: string;
  name: string | null;
  action: string;
  middleware: string[];
  domain: string | null;
}

export interface RoutesResponse {
  cached: boolean;
  routes: RouteInfo[];
}

export interface EnvEntry {
  key: string;
  value: string;
  line: number;
}

/** A value from a Tinker run, as a tree. */
export interface DumpNode {
  /** null, bool, int, float, string, binary, resource, array, object, model,
   *  collection, date, enum, closure */
  t: string;
  v?: string | number | boolean;
  /** Class name. */
  c?: string;
  /** Length or item count. */
  n?: number;
  k?: { key: string; value: DumpNode }[];
  /** Items not shown (limit or depth). */
  more?: number;
}

export interface TinkerError {
  class: string;
  message: string;
  file: string;
  line: number;
  trace: { file: string; line: number }[];
}

export interface QueryLog {
  sql: string;
  bindings: unknown[];
  time: number;
  connection: string;
}

export interface TinkerReply {
  ok: boolean;
  /** The process is gone: exit(), dd(), a fatal error, or Stop. */
  ended?: boolean;
  /** A new session started for this run, so earlier variables are gone. */
  started?: boolean;
  laravel?: string;
  result?: DumpNode | null;
  error?: TinkerError | null;
  output: string;
  stderr?: string;
  dumps: DumpNode[];
  queries: QueryLog[];
  timeMs?: number;
  memory?: number;
  rolledBack?: boolean;
  vars?: { name: string; type: string }[];
}

export interface ArtisanArgument {
  name: string;
  required: boolean;
  array: boolean;
  description: string;
  default: unknown;
}

export interface ArtisanOption {
  name: string;
  shortcut: string;
  acceptsValue: boolean;
  valueRequired: boolean;
  multiple: boolean;
  description: string;
  default: unknown;
}

export interface ArtisanCommand {
  name: string;
  description: string;
  usage: string;
  arguments: ArtisanArgument[];
  options: ArtisanOption[];
}

export interface SiteJob {
  id: number;
  site: string;
  command: string;
  state: "running" | "done" | "failed" | "stopped";
  exitCode: number | null;
  startedMs: number;
  endedMs: number | null;
  dropped: number;
}

export interface JobOutput {
  job: SiteJob;
  from: number;
  lines: string[];
}

export interface Worker {
  id: string;
  site: string;
  label: string;
  command: string;
  autostart: boolean;
}

export interface WorkerStatus extends Worker {
  state: "stopped" | "starting" | "running" | "failed";
  message: string | null;
  pid: number | null;
  logId: string;
}

export interface NewSite {
  /** What to make: a Laravel app, WordPress, a plain PHP folder, or a name for a dev server. */
  kind: "laravel" | "wordpress" | "php" | "proxy";
  /** Proxy sites: the dev server's port. */
  proxyPort: number;
  /** Proxy sites: the project's existing folder. */
  folder: string;
  name: string;
  parent: string;
  php: string;
  kit: "none" | "react" | "vue" | "livewire" | "svelte" | "community";
  /** Composer package of a community starter kit. */
  community: string;
  auth: boolean;
  teams: boolean;
  livewireClass: boolean;
  database: "sqlite" | "mariadb" | "pgsql";
  testing: "pest" | "phpunit";
  node: boolean;
  git: boolean;
  https: boolean;
  mailpit: boolean;
}

export interface NewSiteDefaults {
  parent: string;
  /** Installed PHP lines, newest first. */
  phpVersions: string[];
  activePhp: string | null;
  installer: boolean;
  composer: boolean;
  /** Active Node.js line, if installed. */
  node: string | null;
  git: boolean;
  mariadbRunning: boolean;
  postgresRunning: boolean;
  /** Its first start otherwise downloads it. */
  postgresInstalled: boolean;
  postgresDownloadMb: number;
  tld: string;
}

export interface NewSiteTarget {
  path: string;
  url: string;
  /** MariaDB or PostgreSQL database name: the site name with - turned into _. */
  database: string;
}

export interface AppLogFile {
  name: string;
  size: number;
  /** ms since the Unix epoch. */
  modified: number | null;
}

export interface AppLogEntry {
  time: string;
  env: string;
  /** debug, info, notice, warning, error, critical, alert, emergency */
  level: string;
  message: string;
  /** Context JSON and stack trace. */
  detail: string;
}

export interface AppLog {
  file: AppLogFile;
  /** Oldest first. */
  entries: AppLogEntry[];
  truncated: boolean;
}

/** A program the site can be opened in. */
export interface ExternalApp {
  id: string;
  name: string;
  kind: "editor" | "terminal" | "database" | "folder";
}
