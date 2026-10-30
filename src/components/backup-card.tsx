import { useCallback, useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api } from "@/api";
import type { BackupContents, BackupJob } from "@/types";
import { Icon } from "@/components/icon";
import { SettingGroup, SettingRow } from "@/components/settings-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, localeOf, useLang, useT, type Lang } from "@/i18n";
import { common } from "@/i18n/common";

const POLL_MS = 500;

const messages = defineMessages({
  en: {
    title: "Backup",
    backupTitle: "Back up",
    backupHint: "Sites and settings in one zip. HTTPS certificates stay out.",
    withDatabases: "Include MariaDB databases",
    withDatabasesHint: "Starts MariaDB briefly if needed. MySQL and PostgreSQL aren't included.",
    backUp: "Back up…",
    restoreTitle: "Restore",
    restoreHint: "From a Zefaro backup, made here or on another computer.",
    restore: "Restore…",
    saveTitle: "Save the backup",
    openTitle: "Choose a backup",
    zip: "Zefaro backup",
    confirmTitle: "Restore this backup?",
    madeWith: (when: string, v: string) => `Made ${when} with Zefaro ${v}.`,
    settingsItem: (n: number) => `Sites and settings (${n} site${n === 1 ? "" : "s"})`,
    settingsHint: "Replaces your current sites and settings. A copy of today's config.json is kept next to it.",
    databasesItem: (n: number) => `Databases (${n})`,
    databasesHint:
      "A database that already exists here is skipped, never overwritten. If MariaDB isn't installed, Zefaro downloads it first.",
    noDatabases: "This backup has no databases.",
    cancel: "Cancel",
    doRestore: "Restore",
    preparing: "Getting ready…",
    savingSettings: "Reading the sites and settings…",
    onDatabase: (name: string, i: number, n: number) => `${name} (${i} of ${n})`,
    dumping: "Saving a database",
    loading: "Loading a database",
    finishing: "Finishing…",
    backupDone: (size: string) => `Backup saved (${size})`,
    restoreDone: "Restore finished",
    backupFailed: "The backup failed",
    restoreFailed: "The restore failed",
    cancelled: "Cancelled. Nothing was left half-written.",
    databasesSaved: (n: number) => `${n} database${n === 1 ? "" : "s"} in the file.`,
    databasesLoaded: (n: number) => `${n} database${n === 1 ? "" : "s"} loaded.`,
    databasesSkipped: (names: string) => `Already here, so left as they are: ${names}.`,
    settingsRestored: "Sites and settings restored. Open Diagnostics to check that the site folders and the local domain match this computer.",
    trustAgain: "Some sites use HTTPS: Zefaro makes a new certificate authority for them. Trust it again on the HTTPS and system tab.",
    reload: "Reload Zefaro",
    close: "Close",
    stop: "Cancel",
  },
  id: {
    title: "Cadangan",
    backupTitle: "Cadangkan",
    backupHint: "Situs dan pengaturan dalam satu zip. Sertifikat HTTPS tidak ikut.",
    withDatabases: "Sertakan database MariaDB",
    withDatabasesHint: "MariaDB dinyalakan sebentar bila perlu. MySQL dan PostgreSQL tidak ikut.",
    backUp: "Cadangkan…",
    restoreTitle: "Pulihkan",
    restoreHint: "Dari cadangan Zefaro, dibuat di sini atau di komputer lain.",
    restore: "Pulihkan…",
    saveTitle: "Simpan cadangan",
    openTitle: "Pilih cadangan",
    zip: "Cadangan Zefaro",
    confirmTitle: "Pulihkan cadangan ini?",
    madeWith: (when: string, v: string) => `Dibuat ${when} dengan Zefaro ${v}.`,
    settingsItem: (n: number) => `Situs dan pengaturan (${n} situs)`,
    settingsHint: "Menggantikan situs dan pengaturan Anda sekarang. Salinan config.json hari ini disimpan di sebelahnya.",
    databasesItem: (n: number) => `Database (${n})`,
    databasesHint:
      "Database yang sudah ada di sini dilewati, tidak pernah ditimpa. Jika MariaDB belum terpasang, Zefaro mengunduhnya dulu.",
    noDatabases: "Cadangan ini tidak berisi database.",
    cancel: "Batal",
    doRestore: "Pulihkan",
    preparing: "Bersiap…",
    savingSettings: "Membaca situs dan pengaturan…",
    onDatabase: (name: string, i: number, n: number) => `${name} (${i} dari ${n})`,
    dumping: "Menyimpan database",
    loading: "Memuat database",
    finishing: "Menyelesaikan…",
    backupDone: (size: string) => `Cadangan tersimpan (${size})`,
    restoreDone: "Pemulihan selesai",
    backupFailed: "Pencadangan gagal",
    restoreFailed: "Pemulihan gagal",
    cancelled: "Dibatalkan. Tidak ada berkas setengah jadi yang tertinggal.",
    databasesSaved: (n: number) => `${n} database di dalam berkas.`,
    databasesLoaded: (n: number) => `${n} database dimuat.`,
    databasesSkipped: (names: string) => `Sudah ada di sini, jadi dibiarkan: ${names}.`,
    settingsRestored: "Situs dan pengaturan dipulihkan. Buka Diagnostik untuk memeriksa bahwa folder situs dan domain lokal cocok dengan komputer ini.",
    trustAgain: "Beberapa situs memakai HTTPS: Zefaro membuat otoritas sertifikat baru untuknya. Percayai lagi di tab HTTPS dan sistem.",
    reload: "Muat ulang Zefaro",
    close: "Tutup",
    stop: "Batal",
  },
});

function size(n: number | null | undefined, lang: Lang) {
  if (n == null) return common[lang].unknown;
  const num = (v: number, digits: number) =>
    v.toLocaleString(localeOf(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
  if (n >= 1024 ** 3) return `${num(n / 1024 ** 3, 2)} GB`;
  if (n >= 1024 ** 2) return `${num(n / 1024 ** 2, 1)} MB`;
  if (n >= 1024) return `${num(n / 1024, 0)} KB`;
  return `${num(n, 0)} B`;
}

/** YYYY-MM-DD in local time, for the suggested file name. */
function today() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The Backup and restore group of the Settings page, with its restore dialog. */
export function BackupGroup() {
  const t = useT(messages);
  const { lang } = useLang();
  const [job, setJob] = useState<BackupJob | null>(null);
  const [withDatabases, setWithDatabases] = useState(true);
  const [preview, setPreview] = useState<{ path: string; contents: BackupContents } | null>(null);
  const [restoreSettings, setRestoreSettings] = useState(true);
  const [restoreDatabases, setRestoreDatabases] = useState(true);

  useEffect(() => {
    api.backupJob().then(setJob).catch(() => {});
  }, []);

  // Follow a running job; say how it ended.
  useEffect(() => {
    if (job?.state !== "running") return;
    const timer = window.setInterval(async () => {
      const j = await api.backupJob().catch(() => null);
      setJob(j);
      if (j && j.state !== "running") {
        if (j.state === "done") toast.success(j.kind === "backup" ? t.backupDone(size(j.size, lang)) : t.restoreDone);
        else if (j.state === "failed") toast.error(j.kind === "backup" ? t.backupFailed : t.restoreFailed, { description: j.message ?? undefined });
        else toast(t.cancelled);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [job?.state, t, lang]);

  const running = job?.state === "running";

  const chooseBackup = useCallback(async () => {
    const dir = await api.dbDefaultDir().catch(() => "");
    const path = await saveDialog({
      title: t.saveTitle,
      defaultPath: `${dir ? dir + "\\" : ""}zefaro-backup-${today()}.zip`,
      filters: [{ name: t.zip, extensions: ["zip"] }],
    });
    if (!path) return;
    try {
      await api.backupStart(path, withDatabases);
      setJob(await api.backupJob());
    } catch (e) {
      toast.error(String(e));
    }
  }, [t, withDatabases]);

  const chooseRestore = useCallback(async () => {
    const path = await openDialog({
      title: t.openTitle,
      multiple: false,
      directory: false,
      filters: [{ name: t.zip, extensions: ["zip"] }],
    });
    if (typeof path !== "string") return;
    try {
      const contents = await api.backupInspect(path);
      setRestoreSettings(true);
      setRestoreDatabases(contents.databases.length > 0);
      setPreview({ path, contents });
    } catch (e) {
      toast.error(String(e));
    }
  }, [t]);

  const startRestore = async () => {
    if (!preview) return;
    const { path } = preview;
    setPreview(null);
    try {
      await api.restoreStart(path, restoreSettings, restoreDatabases);
      setJob(await api.backupJob());
    } catch (e) {
      toast.error(String(e));
    }
  };

  const dismiss = () => {
    api.backupDismiss().catch(() => {});
    setJob(null);
  };

  const phase = (j: BackupJob) => {
    if (j.phase === "settings") return t.savingSettings;
    if (j.phase === "finishing") return t.finishing;
    if (j.phase === "database" && j.current) {
      return `${j.kind === "backup" ? t.dumping : t.loading}: ${t.onDatabase(j.current, j.done + 1, j.total)}`;
    }
    return t.preparing;
  };

  /** The running job, or how the last one ended, as the group's third row. */
  const jobRow = (j: BackupJob) => {
    if (j.state === "running") {
      const pct = j.total > 0 ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0;
      return (
        <SettingRow
          key="job"
          icon="hourglass-half"
          title={phase(j)}
          description={<span className="break-all font-mono">{j.file}</span>}
          below={<Progress value={pct} className="h-2" aria-label={phase(j)} />}
        >
          <Button size="sm" variant="ghost" onClick={() => api.backupCancel().catch(() => {})}>
            {t.stop}
          </Button>
        </SettingRow>
      );
    }
    const done = j.state === "done";
    const title = done
      ? j.kind === "backup"
        ? t.backupDone(size(j.size, lang))
        : t.restoreDone
      : j.state === "failed"
        ? j.kind === "backup"
          ? t.backupFailed
          : t.restoreFailed
        : t.cancelled;
    const notes = done
      ? [
          j.kind === "backup" && j.loaded.length > 0 ? t.databasesSaved(j.loaded.length) : null,
          j.kind === "restore" && j.loaded.length > 0 ? t.databasesLoaded(j.loaded.length) : null,
          j.skipped.length > 0 ? t.databasesSkipped(j.skipped.join(", ")) : null,
          j.message,
          j.settingsRestored ? t.settingsRestored : null,
        ].filter(Boolean)
      : [];
    return (
      <SettingRow
        key="job"
        icon={done ? "circle-check" : j.state === "failed" ? "circle-exclamation" : "circle-xmark"}
        title={title}
        tone={j.state === "failed" ? "warning" : undefined}
        description={
          j.state === "failed" ? (
            <span className="text-destructive">{j.message}</span>
          ) : (
            <span className="break-all font-mono">{j.file}</span>
          )
        }
        below={
          notes.length > 0 || (j.settingsRestored && j.hasSecuredSites) ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              {notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
              {j.settingsRestored && j.hasSecuredSites && <p className="text-warning">{t.trustAgain}</p>}
            </div>
          ) : undefined
        }
      >
        {j.settingsRestored && (
          <Button size="sm" onClick={() => window.location.reload()}>
            <Icon name="rotate" />
            {t.reload}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          {t.close}
        </Button>
      </SettingRow>
    );
  };

  const contents = preview?.contents;

  return (
    <>
      <SettingGroup title={t.title}>
        {[
          <SettingRow key="backup" icon="box-archive" title={t.backupTitle} description={t.backupHint}>
            <Button size="sm" variant="outline" disabled={running} onClick={chooseBackup}>
              {running ? <Spinner className="size-3" /> : <Icon name="download" />}
              {t.backUp}
            </Button>
          </SettingRow>,
          <SettingRow key="databases" icon="database" title={t.withDatabases} description={t.withDatabasesHint}>
            <Switch checked={withDatabases} onCheckedChange={setWithDatabases} aria-label={t.withDatabases} />
          </SettingRow>,
          <SettingRow key="restore" icon="clock-rotate-left" title={t.restoreTitle} description={t.restoreHint}>
            <Button size="sm" variant="outline" disabled={running} onClick={chooseRestore}>
              <Icon name="upload" />
              {t.restore}
            </Button>
          </SettingRow>,
          ...(job ? [jobRow(job)] : []),
        ]}
      </SettingGroup>

      <AlertDialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {contents && <p>{t.madeWith(new Date(contents.created * 1000).toLocaleString(localeOf(lang)), contents.zefaro)}</p>}
                {contents && (
                  <>
                    <label className="flex items-start justify-between gap-3">
                      <span>
                        <span className="text-foreground">{t.settingsItem(contents.sites)}</span>
                        <span className="block text-xs">{t.settingsHint}</span>
                      </span>
                      <Switch className="mt-0.5" checked={restoreSettings} onCheckedChange={setRestoreSettings} />
                    </label>
                    <label className="flex items-start justify-between gap-3">
                      <span>
                        <span className="text-foreground">{t.databasesItem(contents.databases.length)}</span>
                        <span className="block text-xs">
                          {contents.databases.length === 0
                            ? t.noDatabases
                            : contents.databases.map((d) => `${d.name} (${size(d.bytes, lang)})`).join(", ")}
                        </span>
                        {contents.databases.length > 0 && <span className="block text-xs">{t.databasesHint}</span>}
                      </span>
                      <Switch
                        className="mt-0.5"
                        checked={restoreDatabases}
                        disabled={contents.databases.length === 0}
                        onCheckedChange={setRestoreDatabases}
                      />
                    </label>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={!restoreSettings && !restoreDatabases} onClick={startRestore}>
              {t.doRestore}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
