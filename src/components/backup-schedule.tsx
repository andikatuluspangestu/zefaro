import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api } from "@/api";
import type { BackupSchedule, BackupScheduleView } from "@/types";
import { Icon } from "@/components/icon";
import { SettingGroup, SettingRow } from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { defineMessages, localeOf, useLang, useT } from "@/i18n";

const KEEP = [3, 7, 14, 30] as const;

const messages = defineMessages({
  en: {
    title: "Automatic backups",
    hint: "Zefaro makes the same backup as Back up, by itself, while it's running.",
    enable: "Back up automatically",
    off: "Off.",
    next: (when: string) => `Next backup: ${when}.`,
    when: "When",
    whenHint: "A backup missed while the computer was off is made the next time Zefaro runs.",
    daily: "Every day",
    weekly: "Every week",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    at: "at",
    folder: "Folder",
    change: "Change…",
    chooseFolder: "Choose where the backups go",
    keep: "Keep",
    keepHint: "When there are more, the oldest ones Zefaro made in that folder are deleted. Other files are never touched.",
    keepN: (n: number) => `Newest ${n}`,
    databases: "Include databases",
    databasesHint: "Every database of MariaDB, MySQL and PostgreSQL, whichever are installed.",
    lastDone: (when: string) => `Last backup ${when}`,
    lastFailed: (when: string) => `The backup ${when} failed`,
    lastCancelled: (when: string) => `The backup ${when} was cancelled`,
    pruned: (n: number) => `${n} older backup${n === 1 ? "" : "s"} deleted.`,
    show: "Show",
    saved: "Schedule saved",
  },
  id: {
    title: "Pencadangan otomatis",
    hint: "Zefaro membuat cadangan yang sama seperti tombol Cadangkan, dengan sendirinya, selama Zefaro berjalan.",
    enable: "Cadangkan otomatis",
    off: "Mati.",
    next: (when: string) => `Pencadangan berikutnya: ${when}.`,
    when: "Kapan",
    whenHint: "Pencadangan yang terlewat saat komputer mati dibuat begitu Zefaro berjalan lagi.",
    daily: "Setiap hari",
    weekly: "Setiap minggu",
    days: ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"],
    at: "pukul",
    folder: "Folder",
    change: "Ganti…",
    chooseFolder: "Pilih tempat menyimpan cadangan",
    keep: "Simpan",
    keepHint: "Kalau lebih dari itu, cadangan terlama buatan Zefaro di folder itu dihapus. File lain tidak pernah disentuh.",
    keepN: (n: number) => `${n} terbaru`,
    databases: "Sertakan database",
    databasesHint: "Semua database MariaDB, MySQL, dan PostgreSQL yang terpasang.",
    lastDone: (when: string) => `Cadangan terakhir ${when}`,
    lastFailed: (when: string) => `Pencadangan ${when} gagal`,
    lastCancelled: (when: string) => `Pencadangan ${when} dibatalkan`,
    pruned: (n: number) => `${n} cadangan lama dihapus.`,
    show: "Tampilkan",
    saved: "Jadwal tersimpan",
  },
});

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Settings → Updates and backup: the schedule for backups Zefaro makes by itself. */
export function BackupScheduleGroup() {
  const t = useT(messages);
  const { lang } = useLang();
  const [view, setView] = useState<BackupScheduleView | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api.backupSchedule().then(setView).catch(() => {}), []);
  useEffect(() => {
    load();
    // The last result changes when a scheduled backup ends.
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const save = async (patch: Partial<BackupSchedule>) => {
    if (!view) return;
    setSaving(true);
    try {
      setView(await api.backupScheduleSave({ ...view.schedule, ...patch }));
      toast.success(t.saved);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const chooseFolder = async () => {
    const dir = await openDialog({ directory: true, title: t.chooseFolder, defaultPath: view?.folder });
    if (typeof dir === "string") save({ folder: dir });
  };

  if (!view) return null;
  const s = view.schedule;
  const when = (ms: number) =>
    new Date(ms).toLocaleString(localeOf(lang), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const last = view.last;

  const rows = [
    <SettingRow
      key="enable"
      icon="calendar-check"
      title={t.enable}
      description={s.enabled && view.nextMs ? t.next(when(view.nextMs)) : t.off}
    >
      <Switch checked={s.enabled} disabled={saving} onCheckedChange={(on) => save({ enabled: on })} aria-label={t.enable} />
    </SettingRow>,
  ];

  if (s.enabled) {
    rows.push(
      <SettingRow key="when" icon="clock" title={t.when} description={t.whenHint}>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={s.every} disabled={saving} onValueChange={(v) => save({ every: v as BackupSchedule["every"] })}>
            <SelectTrigger className="w-36" aria-label={t.when}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">{t.daily}</SelectItem>
              <SelectItem value="weekly">{t.weekly}</SelectItem>
            </SelectContent>
          </Select>
          {s.every === "weekly" && (
            <Select value={String(s.weekday)} disabled={saving} onValueChange={(v) => save({ weekday: Number(v) })}>
              <SelectTrigger className="w-32" aria-label={t.weekly}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {t.days.map((d, i) => (
                  <SelectItem key={d} value={String(i + 1)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="text-xs text-muted-foreground">{t.at}</span>
          <Select value={String(s.hour)} disabled={saving} onValueChange={(v) => save({ hour: Number(v) })}>
            <SelectTrigger className="w-24" aria-label={t.at}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, h) => (
                <SelectItem key={h} value={String(h)}>
                  {hourLabel(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SettingRow>,
      <SettingRow key="folder" icon="folder" title={t.folder} description={<span className="break-all font-mono">{view.folder}</span>}>
        <Button size="sm" variant="outline" disabled={saving} onClick={chooseFolder}>
          <Icon name="folder-open" variant="regular" />
          {t.change}
        </Button>
      </SettingRow>,
      <SettingRow key="keep" icon="layer-group" title={t.keep} description={t.keepHint}>
        <Select value={String(s.keep)} disabled={saving} onValueChange={(v) => save({ keep: Number(v) })}>
          <SelectTrigger className="w-32" aria-label={t.keep}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(KEEP.includes(s.keep as (typeof KEEP)[number]) ? KEEP : [...KEEP, s.keep].sort((a, b) => a - b)).map((n) => (
              <SelectItem key={n} value={String(n)}>
                {t.keepN(n)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>,
      <SettingRow key="databases" icon="database" title={t.databases} description={t.databasesHint}>
        <Switch checked={s.databases} disabled={saving} onCheckedChange={(on) => save({ databases: on })} aria-label={t.databases} />
      </SettingRow>,
    );
  }

  if (last.lastMs && last.lastState) {
    const at = when(last.lastMs);
    const failed = last.lastState === "failed";
    rows.push(
      <SettingRow
        key="last"
        icon={last.lastState === "done" ? "circle-check" : failed ? "circle-exclamation" : "circle-xmark"}
        tone={failed ? "warning" : undefined}
        title={last.lastState === "done" ? t.lastDone(at) : failed ? t.lastFailed(at) : t.lastCancelled(at)}
        description={
          failed ? (
            <span className="text-destructive">{last.lastMessage}</span>
          ) : (
            <span>
              <span className="break-all font-mono">{last.lastFile}</span>
              {last.pruned > 0 && <span className="block">{t.pruned(last.pruned)}</span>}
            </span>
          )
        }
      >
        {last.lastState === "done" && last.lastFile && (
          <Button size="sm" variant="ghost" onClick={() => api.dbReveal(last.lastFile!).catch((e) => toast.error(String(e)))}>
            <Icon name="folder-open" variant="regular" />
            {t.show}
          </Button>
        )}
      </SettingRow>,
    );
  }

  return (
    <SettingGroup title={t.title} hint={t.hint}>
      {rows}
    </SettingGroup>
  );
}
