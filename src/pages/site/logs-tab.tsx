import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";
import { copyText } from "./shared";
import type { AppLog, AppLogEntry, AppLogFile } from "./types";

const messages = defineMessages({
  en: {
    file: "Log file",
    search: "Search messages",
    follow: "Follow",
    followHint: "Reload every 2 seconds",
    reload: "Reload",
    clear: "Clear",
    clearTitle: (f: string) => `Clear ${f}?`,
    clearBody: "Zefaro empties the file. Laravel keeps writing new entries to it.",
    cleared: "Log cleared",
    none: "This app hasn't written a log yet. Laravel writes to storage/logs when something is logged or goes wrong.",
    empty: "No entries in this file.",
    noMatch: "No entries match.",
    levels: { all: "All", error: "Errors", warning: "Warnings", info: "Info", debug: "Debug" },
    older: "Only the newest entries are shown; the file has older ones.",
    count: (shown: number, all: number) => (shown === all ? `${all} entries` : `${shown} of ${all} entries`),
    copy: "Copy entry",
    copied: "Entry copied",
    size: (kb: number) => `${kb.toLocaleString("en-GB")} KB`,
  },
  id: {
    file: "File log",
    search: "Cari pesan",
    follow: "Ikuti",
    followHint: "Muat ulang setiap 2 detik",
    reload: "Muat ulang",
    clear: "Kosongkan",
    clearTitle: (f: string) => `Kosongkan ${f}?`,
    clearBody: "Zefaro mengosongkan file ini. Laravel tetap menulis entri baru ke dalamnya.",
    cleared: "Log dikosongkan",
    none: "Aplikasi ini belum menulis log. Laravel menulis ke storage/logs saat ada yang dicatat atau terjadi error.",
    empty: "Tidak ada entri di file ini.",
    noMatch: "Tidak ada entri yang cocok.",
    levels: { all: "Semua", error: "Error", warning: "Peringatan", info: "Info", debug: "Debug" },
    older: "Hanya entri terbaru yang ditampilkan; file ini punya entri yang lebih lama.",
    count: (shown: number, all: number) => (shown === all ? `${all} entri` : `${shown} dari ${all} entri`),
    copy: "Salin entri",
    copied: "Entri disalin",
    size: (kb: number) => `${kb.toLocaleString("id-ID")} KB`,
  },
});

type LevelFilter = "all" | "error" | "warning" | "info" | "debug";
const GROUP: Record<string, Exclude<LevelFilter, "all">> = {
  emergency: "error",
  alert: "error",
  critical: "error",
  error: "error",
  warning: "warning",
  notice: "info",
  info: "info",
  debug: "debug",
};
const TONE: Record<string, string> = {
  error: "text-destructive border-destructive/40",
  warning: "text-warning border-warning/40",
  info: "text-info border-info/40",
  debug: "text-muted-foreground border-border",
};

export function LogsTab({ site }: { site: string }) {
  const t = useT(messages);
  const c = useT(common);
  const [files, setFiles] = useState<AppLogFile[] | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [log, setLog] = useState<AppLog | null>(null);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const [follow, setFollow] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const loadFiles = useCallback(
    () =>
      api
        .siteLogs(site)
        .then((list) => {
          setFiles(list);
          setFile((cur) => (cur && list.some((f) => f.name === cur) ? cur : (list[0]?.name ?? null)));
        })
        .catch((e) => {
          setFiles([]);
          toast.error(String(e));
        }),
    [site],
  );

  const load = useCallback(() => {
    if (!file) return;
    api
      .siteLogRead(site, file)
      .then(setLog)
      .catch((e) => toast.error(String(e)));
  }, [site, file]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!follow) return;
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [follow, load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (log?.entries ?? [])
      .filter((e) => level === "all" || GROUP[e.level] === level)
      .filter((e) => !q || e.message.toLowerCase().includes(q) || e.detail.toLowerCase().includes(q))
      .reverse();
  }, [log, level, search]);

  const clear = async () => {
    setConfirm(false);
    if (!file) return;
    try {
      await api.siteLogClear(site, file);
      toast.success(t.cleared);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  if (files === null) return <Skeleton className="h-64 w-full" />;
  if (files.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{t.none}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={file ?? ""} onValueChange={setFile}>
          <SelectTrigger className="w-60" aria-label={t.file}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {files.map((f) => (
              <SelectItem key={f.name} value={f.name}>
                {f.name} <span className="text-muted-foreground">· {t.size(Math.max(1, Math.round(f.size / 1024)))}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} aria-label={t.search} className="max-w-xs" />
        <label className="ml-auto flex items-center gap-2 text-sm" title={t.followHint}>
          <Switch checked={follow} onCheckedChange={setFollow} />
          {t.follow}
        </label>
        <Button size="sm" variant="ghost" onClick={() => { loadFiles(); load(); }}>
          <Icon name="rotate" className="w-3" />
          {t.reload}
        </Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirm(true)} disabled={!file}>
          <Icon name="trash-can" className="w-3" />
          {t.clear}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(t.levels) as LevelFilter[]).map((l) => {
          const n = l === "all" ? (log?.entries.length ?? 0) : (log?.entries.filter((e) => GROUP[e.level] === l).length ?? 0);
          return (
            <Button key={l} size="xs" variant={level === l ? "secondary" : "ghost"} aria-pressed={level === l} onClick={() => setLevel(l)}>
              {t.levels[l]}
              <span className="text-muted-foreground">{n}</span>
            </Button>
          );
        })}
        {log && <span className="ml-auto text-xs text-muted-foreground">{t.count(shown.length, log.entries.length)}</span>}
      </div>

      {log?.truncated && <p className="text-xs text-muted-foreground">{t.older}</p>}

      {!log ? (
        <Skeleton className="h-48 w-full" />
      ) : log.entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.empty}</p>
      ) : shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.noMatch}</p>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <ul className="divide-y">
            {shown.slice(0, 300).map((e, i) => (
              <Entry key={`${e.time}-${i}`} entry={e} t={t} />
            ))}
          </ul>
        </Card>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.clearTitle(file ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>{t.clearBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={clear}>
              {t.clear}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Entry({ entry, t }: { entry: AppLogEntry; t: typeof messages.en }) {
  const [open, setOpen] = useState(false);
  const group = GROUP[entry.level] ?? "debug";
  return (
    <li className="group px-3 py-2">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 w-20 shrink-0 rounded border px-1.5 text-center font-mono text-[10px] uppercase", TONE[group])}>{entry.level}</span>
        <button
          className="min-w-0 flex-1 text-left disabled:cursor-default"
          onClick={() => setOpen(!open)}
          disabled={!entry.detail}
          aria-expanded={entry.detail ? open : undefined}
        >
          <span className="block text-sm break-words">{entry.message || <span className="text-muted-foreground">-</span>}</span>
          <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            {entry.time} · {entry.env}
            {entry.detail && <Icon name={open ? "chevron-up" : "chevron-down"} className="w-3 text-[9px]" />}
          </span>
        </button>
        <Button
          size="icon-xs"
          variant="ghost"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={t.copy}
          title={t.copy}
          onClick={() => copyText(`[${entry.time}] ${entry.env}.${entry.level.toUpperCase()}: ${entry.message} ${entry.detail}`.trim(), t.copied)}
        >
          <Icon name="copy" className="w-3" />
        </Button>
      </div>
      {open && entry.detail && (
        <pre className="mt-2 ml-23 max-h-80 overflow-auto rounded-md bg-background p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {entry.detail.replace(/\\\\/g, "\\").replace(/\\n/g, "\n")}
        </pre>
      )}
    </li>
  );
}
