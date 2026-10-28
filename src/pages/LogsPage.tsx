import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { LogEntry, LogLevel, LogSource, LogTail } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { defineMessages, localeOf, useLang, useT } from "@/i18n";
import { common } from "@/i18n/common";

const messages = defineMessages({
  en: {
    title: "Logs",
    description: "Zefaro reads these lines directly from the nginx, PHP and database log files.",
    openFolder: "Open logs folder",
    none: {
      title: "No logs yet",
      description: "Start a service on the Services page and Zefaro lists its log here.",
    },
    sources: {
      label: "Log files",
      groups: { Web: "Web", PHP: "PHP", Databases: "Databases", System: "System", Workers: "Workers", Other: "Other" } satisfies Record<
        LogSource["group"],
        string
      >,
      empty: "Empty",
      live: "Written to in the last 15 seconds",
    },
    ago: {
      justNow: "just now",
      seconds: (n: number) => `${n}s ago`,
      minutes: (n: number) => `${n}m ago`,
      hours: (n: number) => `${n}h ago`,
      days: (n: number) => `${n}d ago`,
    },
    search: {
      placeholder: "Search lines",
      label: "Search log lines",
      clear: "Clear search",
    },
    filter: { all: "All", warn: "Warnings", error: "Errors" },
    live: "Live",
    paused: "Paused",
    copyLine: "Copy line",
    copiedLine: "Copied line",
    copyVisible: "Copy visible lines",
    copiedLines: (n: number) => `Copied ${n} ${n === 1 ? "line" : "lines"}`,
    copyFailed: "Couldn't copy to the clipboard. Try again.",
    showFile: "Show file in File Explorer",
    clear: {
      tooltip: "Clear this log",
      title: (label: string) => `Clear ${label}?`,
      body: (file: string, size: string) =>
        `Zefaro empties ${file} (${size}). The service keeps writing to it afterwards. You can't undo this.`,
      confirm: "Clear log",
      done: (label: string) => `Cleared ${label}`,
    },
    readFailed: "Zefaro couldn't read this log.",
    emptyLog: "This log is empty.",
    emptyFollow: "New lines show up here as the service writes them.",
    noMatch: "No lines match your search or filter.",
    showAll: "Show all lines",
    truncated: (n: string) => `Showing the last ${n} lines. Open the file to see older ones.`,
    scrollNewest: "Scroll to newest",
    status: (size: string, ago: string) => `${size} · updated ${ago}`,
  },
  id: {
    title: "Log",
    description: "Zefaro membaca baris-baris ini langsung dari file log nginx, PHP, dan database.",
    openFolder: "Buka folder log",
    none: {
      title: "Belum ada log",
      description: "Mulai layanan di halaman Layanan, lalu Zefaro menampilkan log-nya di sini.",
    },
    sources: {
      label: "File log",
      groups: { Web: "Web", PHP: "PHP", Databases: "Database", System: "Sistem", Workers: "Worker", Other: "Lainnya" },
      empty: "Kosong",
      live: "Ditulisi dalam 15 detik terakhir",
    },
    ago: {
      justNow: "baru saja",
      seconds: (n: number) => `${n} detik lalu`,
      minutes: (n: number) => `${n} menit lalu`,
      hours: (n: number) => `${n} jam lalu`,
      days: (n: number) => `${n} hari lalu`,
    },
    search: {
      placeholder: "Cari baris",
      label: "Cari baris log",
      clear: "Hapus pencarian",
    },
    filter: { all: "Semua", warn: "Peringatan", error: "Error" },
    live: "Live",
    paused: "Dijeda",
    copyLine: "Salin baris",
    copiedLine: "Baris tersalin",
    copyVisible: "Salin baris yang tampil",
    copiedLines: (n: number) => `${n} baris tersalin`,
    copyFailed: "Tidak bisa menyalin ke clipboard. Coba lagi.",
    showFile: "Tampilkan file di File Explorer",
    clear: {
      tooltip: "Kosongkan log ini",
      title: (label: string) => `Kosongkan ${label}?`,
      body: (file: string, size: string) =>
        `Zefaro mengosongkan ${file} (${size}). Layanan tetap menulis ke file ini setelahnya. Tindakan ini tidak bisa dibatalkan.`,
      confirm: "Kosongkan log",
      done: (label: string) => `${label} dikosongkan`,
    },
    readFailed: "Zefaro tidak bisa membaca log ini.",
    emptyLog: "Log ini kosong.",
    emptyFollow: "Baris baru muncul di sini saat layanan menulisnya.",
    noMatch: "Tidak ada baris yang cocok dengan pencarian atau filter Anda.",
    showAll: "Tampilkan semua baris",
    truncated: (n: string) => `Menampilkan ${n} baris terakhir. Buka file untuk melihat baris yang lebih lama.`,
    scrollNewest: "Gulir ke yang terbaru",
    status: (size: string, ago: string) => `${size} · diperbarui ${ago}`,
  },
});

type Messages = (typeof messages)["en"];

/** How often the page checks for new lines while following. */
const POLL_MS = 2000;
/** A source written to this recently shows a live dot. */
const LIVE_MS = 15_000;

type Filter = "all" | "warn" | "error";

const LEVEL_STYLE: Record<LogLevel, { row: string; tag: string }> = {
  info: { row: "border-l-transparent", tag: "border-border text-muted-foreground" },
  warn: {
    row: "border-l-warning/70 bg-warning/[0.04]",
    tag: "border-warning/40 text-warning",
  },
  error: {
    row: "border-l-destructive bg-destructive/[0.06]",
    tag: "border-destructive/50 text-destructive",
  },
};

function formatSize(bytes: number, locale: string) {
  const one = (n: number) => n.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (bytes >= 1024 * 1024) return `${one(bytes / 1048576)} MB`;
  if (bytes >= 1024) return `${one(bytes / 1024)} KB`;
  return `${bytes.toLocaleString(locale)} B`;
}

function formatAgo(ms: number | null, now: number, t: Messages["ago"], unknown: string) {
  if (ms === null) return unknown;
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return t.justNow;
  if (s < 60) return t.seconds(s);
  if (s < 3600) return t.minutes(Math.floor(s / 60));
  if (s < 86400) return t.hours(Math.floor(s / 3600));
  return t.days(Math.floor(s / 86400));
}

/** "2026-10-21 15:53:09" → "15:53:09" today, "21 Oct 15:53" on other days. */
function shortTime(ts: string | null, today: string, locale: string) {
  if (!ts) return "";
  const [date, time] = ts.split(" ");
  if (date === today) return time;
  const d = new Date(`${date}T00:00:00`);
  const day = isNaN(d.getTime())
    ? date
    : d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return `${day} ${time.slice(0, 5)}`;
}

function localDate(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Wrap case-insensitive matches of `query` in <mark>. */
function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, at)) {
    parts.push(text.slice(at, i));
    parts.push(
      <mark key={i} className="rounded-sm bg-primary/25 text-foreground">
        {text.slice(i, i + q.length)}
      </mark>
    );
    at = i + q.length;
  }
  parts.push(text.slice(at));
  return parts;
}

async function copy(text: string, done: string, failed: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error(failed);
  }
}

function SourceList({
  sources,
  active,
  now,
  onSelect,
}: {
  sources: LogSource[];
  active: string | null;
  now: number;
  onSelect: (id: string) => void;
}) {
  const t = useT(messages);
  const c = useT(common);
  const locale = localeOf(useLang().lang);
  const groups = useMemo(() => {
    const m = new Map<LogSource["group"], LogSource[]>();
    for (const s of sources) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m.entries()];
  }, [sources]);

  return (
    <nav aria-label={t.sources.label} className="flex flex-col gap-4">
      {groups.map(([group, items]) => (
        <div key={group} className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {t.sources.groups[group] ?? group}
          </p>
          {items.map((s) => {
            const live = s.modified !== null && now - s.modified < LIVE_MS && s.size > 0;
            const selected = s.id === active;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
                  selected && "bg-accent"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", selected && "font-medium")}>{s.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.size === 0
                      ? t.sources.empty
                      : `${formatSize(s.size, locale)} · ${formatAgo(s.modified, now, t.ago, c.unknown)}`}
                  </span>
                </span>
                {live && (
                  <span className="relative flex size-2 shrink-0" title={t.sources.live}>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-success" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function LogRow({
  entry,
  query,
  today,
  open,
  onToggle,
}: {
  entry: LogEntry;
  query: string;
  today: string;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT(messages);
  const locale = localeOf(useLang().lang);
  const style = LEVEL_STYLE[entry.level];
  return (
    <div className={cn("border-l-2", style.row)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 px-3 py-1 text-left hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
      >
        <span className="truncate text-muted-foreground tabular-nums" title={entry.ts ?? undefined}>
          {shortTime(entry.ts, today, locale)}
        </span>
        <span className="min-w-0">
          {entry.tag && (
            <span
              className={cn(
                "mr-2 inline-block rounded border px-1 text-[10px] leading-4 font-medium",
                style.tag
              )}
            >
              {entry.tag}
            </span>
          )}
          <span
            className={cn(
              open ? "break-all whitespace-pre-wrap" : "",
              entry.level === "error" && "text-destructive",
              entry.level === "warn" && "text-warning"
            )}
          >
            {highlight(entry.message, query)}
          </span>
          {entry.detail && (
            <span className="ml-2 text-muted-foreground">{highlight(entry.detail, query)}</span>
          )}
        </span>
      </button>
      {open && (
        <div className="mx-3 mb-2 ml-[calc(5.5rem+1.5rem)] flex items-start gap-2 rounded-md border bg-muted/40 p-2">
          <code className="min-w-0 flex-1 break-all whitespace-pre-wrap text-muted-foreground">
            {entry.raw}
          </code>
          <Button variant="ghost" size="icon-xs" onClick={() => copy(entry.raw, t.copiedLine, t.copyFailed)}
            aria-label={t.copyLine}
          >
            <Icon name="copy" variant="regular" className="w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function LogsPage() {
  const t = useT(messages);
  const c = useT(common);
  const locale = localeOf(useLang().lang);
  const [sources, setSources] = useState<LogSource[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [tail, setTail] = useState<LogTail | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  // What the shown tail was read from, to skip re-reading an unchanged file.
  const seen = useRef<{ id: string; size: number; modified: number | null } | null>(null);
  // The file being shown, so a slow read of a previous file is dropped.
  const activeRef = useRef<string | null>(null);

  const loadTail = useCallback(async (id: string) => {
    try {
      const next = await api.tailLog(id);
      if (activeRef.current !== id) return;
      seen.current = { id, size: next.source.size, modified: next.source.modified };
      setTail(next);
      setReadError(null);
    } catch (e) {
      if (activeRef.current === id) setReadError(String(e));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listLogs();
      setSources(list);
      setNow(Date.now());
      setActive((cur) => (cur && list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? null)));
      return list;
    } catch (e) {
      toast.error(String(e));
      setSources((s) => s ?? []);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Switching files: read the new one from scratch.
  useEffect(() => {
    activeRef.current = active;
    seen.current = null;
    setTail(null);
    setReadError(null);
    setOpenRow(null);
    setAtBottom(true);
    if (active) loadTail(active);
  }, [active, loadTail]);

  // Following: re-list (cheap) and re-read the open file only when it changed.
  useEffect(() => {
    if (!follow) return;
    const timer = window.setInterval(async () => {
      const list = await refresh();
      const cur = seen.current;
      const s = list?.find((x) => x.id === cur?.id);
      if (s && cur && (s.size !== cur.size || s.modified !== cur.modified)) {
        loadTail(s.id);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [follow, refresh, loadTail]);

  const entries = tail?.entries ?? [];
  const counts = useMemo(
    () => ({
      all: entries.length,
      warn: entries.filter((e) => e.level === "warn").length,
      error: entries.filter((e) => e.level === "error").length,
    }),
    [entries]
  );
  const q = query.trim();
  const visible = useMemo(() => {
    const needle = q.toLowerCase();
    return entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => filter === "all" || e.level === filter)
      .filter(({ e }) => !needle || e.raw.toLowerCase().includes(needle));
  }, [entries, filter, q]);

  // Stay pinned to the newest line unless the reader scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [visible, atBottom]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };
  const jumpToLatest = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setAtBottom(true);
  };

  const clear = async () => {
    if (!active) return;
    try {
      await api.clearLog(active);
      toast.success(t.clear.done(tail?.source.label ?? active));
      await refresh();
      await loadTail(active);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const reveal = (source?: string) => api.revealLog(source).catch((e) => toast.error(String(e)));
  const today = localDate(new Date(now));
  const current = sources?.find((s) => s.id === active) ?? tail?.source ?? null;

  const header = (
    <PageHeader
      title={t.title}
      description={t.description}
      actions={
        <Button variant="outline" size="sm" onClick={() => reveal()}>
          <Icon name="folder-open" variant="regular" />
          {t.openFolder}
        </Button>
      }
    />
  );

  if (sources !== null && sources.length === 0) {
    return (
      <>
        {header}
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="file-lines" variant="regular" />
            </EmptyMedia>
            <EmptyTitle>{t.none.title}</EmptyTitle>
            <EmptyDescription>{t.none.description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="md:sticky md:top-0 md:self-start">
          {sources === null ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <SourceList sources={sources} active={active} now={now} onSelect={setActive} />
          )}
        </div>

        <Card className="relative h-[calc(100svh-12.5rem)] min-h-[26rem] gap-0 overflow-hidden py-0">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b p-2">
            <InputGroup className="h-8 w-full sm:w-56">
              <InputGroupAddon>
                <Icon name="magnifying-glass" className="w-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.search.placeholder}
                aria-label={t.search.label}
              />
              {query && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" onClick={() => setQuery("")} aria-label={t.search.clear}>
                    <Icon name="xmark" className="w-3" />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>

            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs">
                  {t.filter.all}{" "}
                  <span className="text-muted-foreground tabular-nums">{counts.all.toLocaleString(locale)}</span>
                </TabsTrigger>
                <TabsTrigger value="warn" className="text-xs">
                  {t.filter.warn}{" "}
                  <span className="text-muted-foreground tabular-nums">{counts.warn.toLocaleString(locale)}</span>
                </TabsTrigger>
                <TabsTrigger value="error" className="text-xs">
                  {t.filter.error}{" "}
                  <span className="text-muted-foreground tabular-nums">{counts.error.toLocaleString(locale)}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="ml-auto flex items-center gap-1">
              <Button
                variant={follow ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFollow((f) => !f)}
                aria-pressed={follow}
              >
                <Icon name={follow ? "pause" : "play"} className="w-3" />
                {follow ? t.live : t.paused}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={visible.length === 0}
                    onClick={() =>
                      copy(visible.map(({ e }) => e.raw).join("\n"), t.copiedLines(visible.length), t.copyFailed)
                    }
                    aria-label={t.copyVisible}
                  >
                    <Icon name="copy" variant="regular" className="w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t.copyVisible}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={!active}
                    onClick={() => active && reveal(active)}
                    aria-label={t.showFile}
                  >
                    <Icon name="arrow-up-right-from-square" className="w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t.showFile}</TooltipContent>
              </Tooltip>
              <AlertDialog>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!current || current.size === 0}
                        aria-label={t.clear.tooltip}
                      >
                        <Icon name="trash-can" variant="regular" className="w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t.clear.tooltip}</TooltipContent>
                </Tooltip>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t.clear.title(current?.label ?? "")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t.clear.body(`${current?.id ?? ""}.log`, current ? formatSize(current.size, locale) : "")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={clear}>
                      {t.clear.confirm}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* Lines */}
          <div
            ref={scroller}
            onScroll={onScroll}
            className="min-h-0 flex-1 overflow-y-auto py-1 font-mono text-xs leading-5"
          >
            {readError && !tail ? (
              <div className="grid h-full place-items-center p-6 text-center font-sans text-sm text-muted-foreground">
                <div>
                  <Icon name="triangle-exclamation" className="mb-2 w-auto text-xl text-destructive" />
                  <p>{t.readFailed}</p>
                  <p className="text-xs">{readError}</p>
                </div>
              </div>
            ) : active && !tail ? (
              <div className="flex flex-col gap-1.5 p-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-4" style={{ width: `${90 - i * 9}%` }} />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="grid h-full place-items-center p-6 text-center font-sans text-sm text-muted-foreground">
                <div>
                  <Icon name="circle-check" variant="regular" className="mb-2 w-auto text-xl" />
                  <p>{t.emptyLog}</p>
                  {follow && <p className="text-xs">{t.emptyFollow}</p>}
                </div>
              </div>
            ) : visible.length === 0 ? (
              <div className="grid h-full place-items-center p-6 text-center font-sans text-sm text-muted-foreground">
                <div>
                  <p>{t.noMatch}</p>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    {t.showAll}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {tail?.truncated && filter === "all" && !q && (
                  <p className="px-3 py-1 font-sans text-[11px] text-muted-foreground">
                    {t.truncated(entries.length.toLocaleString(locale))}
                  </p>
                )}
                {visible.map(({ e, i }) => (
                  <LogRow
                    key={i}
                    entry={e}
                    query={q}
                    today={today}
                    open={openRow === i}
                    onToggle={() => setOpenRow((r) => (r === i ? null : i))}
                  />
                ))}
              </>
            )}
          </div>

          {!atBottom && visible.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute bottom-11 left-1/2 -translate-x-1/2 shadow-md"
              onClick={jumpToLatest}
            >
              <Icon name="arrow-down" className="w-3" />
              {t.scrollNewest}
            </Button>
          )}

          {/* Status bar */}
          <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate font-mono" title={current?.path}>
              {current?.path}
            </span>
            {current && (
              <span className="shrink-0 tabular-nums">
                {t.status(formatSize(current.size, locale), formatAgo(current.modified, now, t.ago, c.unknown))}
              </span>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
