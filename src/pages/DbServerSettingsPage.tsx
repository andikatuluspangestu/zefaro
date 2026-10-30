import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { DbEngine, DbServerView, DbTuning } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { PageHeader } from "@/components/page-header";
import {
  BackButton,
  GeneratedFile,
  NumberInput,
  SaveBar,
  SettingGroup,
  SettingRow,
  isWhole,
} from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";

type NumKey = "memoryMb" | "workMemMb" | "maxConnections" | "maxPacketMb" | "slowMs";
/** Numbers are edited as text so a field can be empty while typing. */
type Draft = Omit<DbTuning, NumKey> & Record<NumKey, string>;
const NUM_KEYS: NumKey[] = ["memoryMb", "workMemMb", "maxConnections", "maxPacketMb", "slowMs"];

const toDraft = (s: DbTuning): Draft => {
  const d = { ...s } as unknown as Draft;
  for (const k of NUM_KEYS) d[k] = String(s[k]);
  return d;
};

function fromDraft(d: Draft): DbTuning | NumKey {
  const out = { ...d } as unknown as DbTuning;
  for (const k of NUM_KEYS) {
    if (!isWhole(d[k])) return k;
    out[k] = Number(d[k].trim());
  }
  return out;
}

const NAMES: Record<DbEngine, string> = { mariadb: "MariaDB", mysql: "MySQL", postgresql: "PostgreSQL" };

const messages = defineMessages({
  en: {
    title: (server: string) => `${server} settings`,
    description: "Memory, connections, write speed and the slow query log for this server.",
    manage: "Manage databases",
    notInstalled: "Not installed",
    connection: "Connection",
    connectionHint: "Fixed, so every site and tool finds the server where Zefaro said it is.",
    address: "Address",
    user: "User",
    userValue: "root, no password",
    version: "Version",
    resources: "Memory and connections",
    resourcesHint: "Sizes for a development machine. Raise them for big databases if you have the memory.",
    num: {
      memoryMb: {
        mysql: { title: "InnoDB buffer pool", description: "Memory that keeps tables and indexes cached (innodb_buffer_pool_size)." },
        pg: { title: "Shared buffers", description: "Memory PostgreSQL keeps tables and indexes in (shared_buffers)." },
      },
      workMemMb: { title: "Work memory", description: "Memory each sort or hash may use before going to disk (work_mem)." },
      maxConnections: { title: "Max connections", description: "Clients connected at once: sites, workers, Tinker, your database tool." },
      maxPacketMb: { title: "Max packet size", description: "The largest row or statement, for big imports (max_allowed_packet)." },
      slowMs: { title: "Slow query threshold", description: "Queries that take longer than this are logged." },
    },
    writes: "Writing",
    fast: {
      title: "Fast writes",
      mysql: "Flush the log to disk about once a second instead of at every commit (innodb_flush_log_at_trx_commit=2). Imports and test suites run much faster; a power cut can lose the last second of writes.",
      pg: "Commit without waiting for the log to reach the disk (synchronous_commit=off). Faster writes; a crash can lose the last moments of commits but never corrupts data.",
    },
    slow: "Slow queries",
    slowLog: {
      title: "Log slow queries",
      mysql: (file: string) => `Writes them to ${file}.`,
      pg: "Writes them to PostgreSQL's log, on the Logs page.",
    },
    showFile: "Show file",
    extraTitle: "Extra settings",
    extraHint: (pg: boolean): string =>
      pg
        ? "One name = value per line, passed to PostgreSQL after Zefaro's own. The port and listen address stay Zefaro's."
        : "One name = value per line, added to my.ini's [mysqld] after Zefaro's own. The port, folders and bind address stay Zefaro's.",
    extraLabel: "Extra settings",
    files: "Files",
    dataFolder: "Data folder",
    dataFolderHint: "Your databases. Back them up with Settings → Updates and backup, or export them.",
    show: "Show in folder",
    generated: (pg: boolean): string => (pg ? "Settings passed to PostgreSQL" : "Generated my.ini"),
    generatedNote: "Zefaro writes it from these settings each time the server starts, so edits to the file itself don't last.",
    mustBeWhole: (field: string) => `${field} must be a whole number.`,
    saved: (server: string) => `${server} settings saved`,
    savedRunning: (server: string) => `${server} restarted with them.`,
    savedStopped: (server: string) => `${server} uses them the next time it starts.`,
    notSaved: "Settings not saved",
    saveNoteRunning: (server: string) => `Saving restarts ${server}; open connections drop for a moment.`,
    unsaved: "Unsaved changes",
  },
  id: {
    title: (server: string) => `Pengaturan ${server}`,
    description: "Memori, koneksi, kecepatan tulis, dan log query lambat untuk server ini.",
    manage: "Kelola database",
    notInstalled: "Belum terpasang",
    connection: "Koneksi",
    connectionHint: "Tetap, supaya setiap situs dan alat menemukan server di tempat yang disebut Zefaro.",
    address: "Alamat",
    user: "User",
    userValue: "root, tanpa password",
    version: "Versi",
    resources: "Memori dan koneksi",
    resourcesHint: "Ukuran untuk komputer pengembangan. Naikkan untuk database besar bila memorinya ada.",
    num: {
      memoryMb: {
        mysql: { title: "InnoDB buffer pool", description: "Memori untuk menyimpan tabel dan index di cache (innodb_buffer_pool_size)." },
        pg: { title: "Shared buffers", description: "Memori tempat PostgreSQL menyimpan tabel dan index (shared_buffers)." },
      },
      workMemMb: { title: "Work memory", description: "Memori untuk setiap sort atau hash sebelum memakai disk (work_mem)." },
      maxConnections: { title: "Maks. koneksi", description: "Klien yang tersambung bersamaan: situs, worker, Tinker, alat database Anda." },
      maxPacketMb: { title: "Maks. ukuran paket", description: "Baris atau statement terbesar, untuk impor besar (max_allowed_packet)." },
      slowMs: { title: "Ambang query lambat", description: "Query yang lebih lama dari ini dicatat." },
    },
    writes: "Penulisan",
    fast: {
      title: "Tulis cepat",
      mysql: "Simpan log ke disk sekitar sekali per detik, bukan di setiap commit (innodb_flush_log_at_trx_commit=2). Impor dan test jauh lebih cepat; listrik padam bisa menghilangkan tulisan satu detik terakhir.",
      pg: "Commit tanpa menunggu log sampai ke disk (synchronous_commit=off). Tulis lebih cepat; crash bisa menghilangkan commit sesaat terakhir tetapi tidak pernah merusak data.",
    },
    slow: "Query lambat",
    slowLog: {
      title: "Catat query lambat",
      mysql: (file: string) => `Ditulis ke ${file}.`,
      pg: "Ditulis ke log PostgreSQL, di halaman Log.",
    },
    showFile: "Tampilkan file",
    extraTitle: "Pengaturan tambahan",
    extraHint: (pg: boolean) =>
      pg
        ? "Satu nama = nilai per baris, diteruskan ke PostgreSQL setelah pengaturan Zefaro. Port dan alamat listen tetap milik Zefaro."
        : "Satu nama = nilai per baris, ditambahkan ke [mysqld] di my.ini setelah pengaturan Zefaro. Port, folder, dan bind address tetap milik Zefaro.",
    extraLabel: "Pengaturan tambahan",
    files: "File",
    dataFolder: "Folder data",
    dataFolderHint: "Database Anda. Cadangkan lewat Pengaturan → Pembaruan dan cadangan, atau ekspor.",
    show: "Tampilkan di folder",
    generated: (pg: boolean) => (pg ? "Pengaturan yang diteruskan ke PostgreSQL" : "my.ini yang dibuat Zefaro"),
    generatedNote: "Zefaro menulisnya dari pengaturan ini setiap kali server dimulai, jadi suntingan langsung ke file itu tidak bertahan.",
    mustBeWhole: (field: string) => `${field} harus bilangan bulat.`,
    saved: (server: string) => `Pengaturan ${server} disimpan`,
    savedRunning: (server: string) => `${server} sudah di-restart dengan pengaturan ini.`,
    savedStopped: (server: string) => `${server} memakainya saat dimulai berikutnya.`,
    notSaved: "Pengaturan tidak disimpan",
    saveNoteRunning: (server: string) => `Menyimpan me-restart ${server}; koneksi yang terbuka terputus sebentar.`,
    unsaved: "Ada perubahan yang belum disimpan",
  },
});

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** The gear on the MariaDB, MySQL and PostgreSQL cards. */
export function DbServerSettingsPage({
  engine,
  backLabel,
  onBack,
  onManage,
}: {
  engine: DbEngine;
  backLabel: string;
  onBack: () => void;
  /** Open the Databases page for this server. */
  onManage: () => void;
}) {
  const t = useT(messages);
  const c = useT(common);
  const server = NAMES[engine];
  const pg = engine === "postgresql";
  const [view, setView] = useState<DbServerView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confText, setConfText] = useState<string | null>(null);

  useEffect(() => {
    api
      .dbServerSettings(engine)
      .then((v) => {
        setView(v);
        setDraft(toDraft(v.settings));
      })
      .catch((e) => toast.error(String(e)));
  }, [engine]);

  const saved = useMemo(() => (view ? JSON.stringify(toDraft(view.settings)) : ""), [view]);
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const isDefault = !!draft && !!view && JSON.stringify(draft) === JSON.stringify(toDraft(view.defaults));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
    setError(null);
  };
  const reveal = (what: "data" | "config" | "log" | "slow"): Promise<void> =>
    api.dbServerReveal(engine, what).catch((e) => {
      toast.error(String(e));
    });

  const numTitle = (k: NumKey) => (k === "memoryMb" ? t.num.memoryMb[pg ? "pg" : "mysql"].title : t.num[k].title);
  const numRow = (k: NumKey, icon: string, unit: string) => {
    const text = k === "memoryMb" ? t.num.memoryMb[pg ? "pg" : "mysql"] : t.num[k];
    return (
      <SettingRow key={k} icon={icon} title={text.title} description={text.description}>
        <NumberInput value={draft?.[k] ?? ""} onChange={(v) => set(k, v)} label={text.title} unit={unit} disabled={saving} />
      </SettingRow>
    );
  };

  const save = async () => {
    if (!draft) return;
    const parsed = fromDraft(draft);
    if (typeof parsed === "string") {
      setError(t.mustBeWhole(numTitle(parsed)));
      return;
    }
    setSaving(true);
    try {
      const v = await api.dbServerSave(engine, parsed);
      setView(v);
      setDraft(toDraft(v.settings));
      setConfText(null);
      setError(null);
      toast.success(t.saved(server), { description: v.running ? t.savedRunning(server) : t.savedStopped(server) });
    } catch (e) {
      setError(String(e));
      // The server may have put the old settings back.
      api.dbServerSettings(engine).then(setView).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <BackButton label={backLabel} onClick={onBack} />
      <PageHeader
        title={t.title(server)}
        description={t.description}
        actions={
          view && (
            <>
              <Badge variant="outline" className={cn(view.running && "border-success/40 text-success")}>
                {view.running ? c.running : view.installed ? c.stopped : t.notInstalled}
              </Badge>
              <Button size="sm" variant="outline" onClick={onManage}>
                <Icon name="database" />
                {t.manage}
              </Button>
            </>
          )
        }
      />

      {!view || !draft ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {error && (
            <IconAlert
              icon="circle-exclamation"
              title={t.notSaved}
              className="border-destructive/50 text-destructive *:data-[slot=alert-description]:text-destructive/90"
            >
              <span className="font-mono text-xs break-words whitespace-pre-wrap">{error}</span>
            </IconAlert>
          )}

          <SettingGroup title={t.connection} hint={t.connectionHint}>
            {[
              <SettingRow key="address" icon="plug" title={t.address}>
                <code className="font-mono text-sm">127.0.0.1:{view.port}</code>
              </SettingRow>,
              <SettingRow key="user" icon="user" title={t.user}>
                <span className="text-sm text-muted-foreground">{t.userValue}</span>
              </SettingRow>,
              <SettingRow key="version" icon="tag" title={t.version}>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {server} {view.version}
                </span>
              </SettingRow>,
            ]}
          </SettingGroup>

          <SettingGroup title={t.resources} hint={t.resourcesHint}>
            {[
              numRow("memoryMb", "memory", "MB"),
              ...(pg ? [numRow("workMemMb", "arrow-down-wide-short", "MB")] : []),
              numRow("maxConnections", "users", ""),
              ...(pg ? [] : [numRow("maxPacketMb", "box", "MB")]),
            ]}
          </SettingGroup>

          <SettingGroup title={t.writes}>
            {[
              <SettingRow key="fast" icon="bolt" title={t.fast.title} description={pg ? t.fast.pg : t.fast.mysql}>
                <Switch
                  checked={draft.fastWrites}
                  disabled={saving}
                  onCheckedChange={(v) => set("fastWrites", v)}
                  aria-label={t.fast.title}
                />
              </SettingRow>,
            ]}
          </SettingGroup>

          <SettingGroup title={t.slow}>
            {[
              <SettingRow
                key="slowLog"
                icon="hourglass-half"
                title={t.slowLog.title}
                description={pg ? t.slowLog.pg : t.slowLog.mysql(fileName(view.slowLogPath ?? ""))}
              >
                {!pg && view.settings.slowLog && (
                  <Button size="sm" variant="ghost" onClick={() => reveal("slow")}>
                    <Icon name="folder-open" variant="regular" />
                    {t.showFile}
                  </Button>
                )}
                <Switch checked={draft.slowLog} disabled={saving} onCheckedChange={(v) => set("slowLog", v)} aria-label={t.slowLog.title} />
              </SettingRow>,
              ...(draft.slowLog ? [numRow("slowMs", "stopwatch", "ms")] : []),
            ]}
          </SettingGroup>

          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold">{t.extraTitle}</h3>
              <p className="text-xs text-muted-foreground">{t.extraHint(pg)}</p>
            </div>
            <Textarea
              value={draft.extra}
              onChange={(e) => set("extra", e.target.value)}
              disabled={saving}
              spellCheck={false}
              rows={4}
              placeholder={pg ? "random_page_cost = 1.1\neffective_cache_size = 1GB" : "innodb_log_file_size = 256M\nsql_mode = STRICT_TRANS_TABLES"}
              className="font-mono text-xs"
              aria-label={t.extraLabel}
            />
          </section>

          <SettingGroup title={t.files}>
            {[
              <SettingRow key="data" icon="folder" title={t.dataFolder} description={t.dataFolderHint} below={<code className="font-mono text-xs break-all text-muted-foreground">{view.dataDir}</code>}>
                <Button size="sm" variant="ghost" onClick={() => reveal("data")}>
                  <Icon name="folder-open" variant="regular" />
                  {t.show}
                </Button>
              </SettingRow>,
            ]}
          </SettingGroup>

          <GeneratedFile
            title={t.generated(pg)}
            path={view.configPath}
            text={confText}
            onOpen={() =>
              api
                .dbServerConfigText(engine)
                .then(setConfText)
                .catch((e) => setConfText(`# ${String(e)}`))
            }
            onReveal={() => reveal(pg ? "data" : "config")}
            note={t.generatedNote}
          />

          <SaveBar
            dirty={dirty}
            saving={saving}
            isDefault={isDefault}
            note={view.running ? t.saveNoteRunning(server) : t.unsaved}
            onReset={() => {
              setDraft(toDraft(view.defaults));
              setError(null);
            }}
            onDiscard={() => {
              setDraft(toDraft(view.settings));
              setError(null);
            }}
            onSave={save}
          />
        </div>
      )}
    </div>
  );
}
