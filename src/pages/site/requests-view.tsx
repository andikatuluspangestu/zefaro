import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { defineMessages, useT } from "@/i18n";
import { LogsTab } from "./logs-tab";
import type { SiteRequest, SiteRequests } from "./types";

/** A request this slow (ms) counts as slow. */
const SLOW_MS = 1000;

const messages = defineMessages({
  en: {
    appLog: "App log",
    requests: "Requests",
    filters: { all: "All", errors: "Errors", server: "Server errors", slow: "Slow" },
    filtersHint: { errors: "Status 400 and up", server: "Status 500 and up", slow: `${SLOW_MS} ms and longer` },
    search: "Search paths",
    follow: "Follow",
    followHint: "Reload every 2 seconds",
    reload: "Reload",
    time: "Time",
    status: "Status",
    request: "Request",
    took: "Time taken",
    size: "Size",
    none: "No requests yet. Open the site in a browser and they show up here.",
    noMatch: "No requests match.",
    accessLogOff: "nginx's access log is off, so there are no requests to show. Turn it on in nginx's settings.",
    older: "Older ones are further back in nginx's access log.",
    count: (shown: number, all: number) => (shown === all ? `${all} requests` : `${shown} of ${all} requests`),
    seeAppLog: "See the app log",
    from: (r: string) => `From ${r}`,
  },
  id: {
    appLog: "Log aplikasi",
    requests: "Request",
    filters: { all: "Semua", errors: "Error", server: "Error server", slow: "Lambat" },
    filtersHint: { errors: "Status 400 ke atas", server: "Status 500 ke atas", slow: `${SLOW_MS} ms atau lebih` },
    search: "Cari path",
    follow: "Ikuti",
    followHint: "Muat ulang setiap 2 detik",
    reload: "Muat ulang",
    time: "Waktu",
    status: "Status",
    request: "Request",
    took: "Durasi",
    size: "Ukuran",
    none: "Belum ada request. Buka situs di browser, request-nya muncul di sini.",
    noMatch: "Tidak ada request yang cocok.",
    accessLogOff: "Log akses nginx mati, jadi tidak ada request yang bisa ditampilkan. Nyalakan di pengaturan nginx.",
    older: "Yang lebih lama ada lebih jauh di log akses nginx.",
    count: (shown: number, all: number) => (shown === all ? `${all} request` : `${shown} dari ${all} request`),
    seeAppLog: "Lihat log aplikasi",
    from: (r: string) => `Dari ${r}`,
  },
});

type Filter = "all" | "errors" | "server" | "slow";

const statusTone = (s: number) =>
  s >= 500
    ? "border-destructive/40 text-destructive"
    : s >= 400
      ? "border-warning/40 text-warning"
      : s >= 300
        ? "border-info/40 text-info"
        : "border-border text-muted-foreground";

function size(n: number | null) {
  if (n == null) return "";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** The requests nginx served for a site, newest first, from its access log. */
export function RequestsView({ site, onAppLog }: { site: string; onAppLog?: () => void }) {
  const t = useT(messages);
  const [data, setData] = useState<SiteRequests | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [follow, setFollow] = useState(true);

  const load = useCallback(
    () =>
      api
        .siteRequests(site)
        .then(setData)
        .catch((e) => toast.error(String(e))),
    [site],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!follow) return;
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [follow, load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.requests ?? []).filter((r) => {
      if (filter === "errors" && r.status < 400) return false;
      if (filter === "server" && r.status < 500) return false;
      if (filter === "slow" && (r.ms ?? 0) < SLOW_MS) return false;
      return !q || r.path.toLowerCase().includes(q);
    });
  }, [data, filter, search]);

  const row = (r: SiteRequest, i: number) => (
    <TableRow key={`${r.time}-${i}`} className="group">
      <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground" title={r.time}>
        {r.time.slice(11)}
      </TableCell>
      <TableCell>
        <span className={cn("inline-flex rounded border px-1.5 font-mono text-xs", statusTone(r.status))}>{r.status}</span>
      </TableCell>
      <TableCell className="max-w-0 w-full">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{r.method}</span>
          <span className="truncate font-mono text-xs" title={[r.host, r.path].filter(Boolean).join(" ") + (r.referer ? `\n${t.from(r.referer)}` : "")}>
            {r.path}
          </span>
          {r.status >= 500 && onAppLog && (
            <Button size="xs" variant="ghost" className="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={onAppLog}>
              {t.seeAppLog}
            </Button>
          )}
        </div>
      </TableCell>
      <TableCell className={cn("text-right font-mono text-xs whitespace-nowrap", (r.ms ?? 0) >= SLOW_MS && "text-warning")}>
        {r.ms != null ? `${r.ms.toLocaleString()} ms` : ""}
      </TableCell>
      <TableCell className="text-right font-mono text-xs whitespace-nowrap text-muted-foreground">{size(r.bytes)}</TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group">
          {(Object.keys(t.filters) as Filter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "secondary" : "ghost"}
              aria-pressed={filter === f}
              title={f === "all" ? undefined : t.filtersHint[f]}
              onClick={() => setFilter(f)}
            >
              {t.filters[f]}
            </Button>
          ))}
        </div>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} className="h-8 w-48 text-sm" aria-label={t.search} />
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground" title={t.followHint}>
          <Switch checked={follow} onCheckedChange={setFollow} aria-label={t.follow} />
          {t.follow}
        </label>
        <Button size="icon-sm" variant="ghost" title={t.reload} aria-label={t.reload} onClick={load}>
          <Icon name="rotate" />
        </Button>
      </div>

      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : !data.accessLog && data.requests.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t.accessLogOff}</p>
      ) : data.requests.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t.none}</p>
      ) : (
        <>
          <Card className="gap-0 overflow-hidden py-0">
            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t.noMatch}</p>
            ) : (
              <div className="max-h-[32rem] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead className="w-20">{t.time}</TableHead>
                      <TableHead className="w-16">{t.status}</TableHead>
                      <TableHead>{t.request}</TableHead>
                      <TableHead className="w-24 text-right">{t.took}</TableHead>
                      <TableHead className="w-20 text-right">{t.size}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{shown.map(row)}</TableBody>
                </Table>
              </div>
            )}
          </Card>
          <p className="text-xs text-muted-foreground">
            {t.count(shown.length, data.requests.length)}
            {data.older && ` · ${t.older}`}
          </p>
        </>
      )}
    </div>
  );
}

/** The Logs tab: the app's own log files, or the requests nginx served. */
export function SiteLogs({ site, initialView }: { site: string; initialView?: "app" | "requests" }) {
  const t = useT(messages);
  const [view, setView] = useState<"app" | "requests">(initialView ?? "app");
  return (
    <div className="space-y-4">
      <div className="flex gap-1" role="group">
        {(["app", "requests"] as const).map((v) => (
          <Button key={v} size="sm" variant={view === v ? "secondary" : "ghost"} aria-pressed={view === v} onClick={() => setView(v)}>
            <Icon name={v === "app" ? "file-lines" : "arrow-right-arrow-left"} />
            {v === "app" ? t.appLog : t.requests}
          </Button>
        ))}
      </div>
      {view === "app" ? <LogsTab site={site} /> : <RequestsView site={site} onAppLog={() => setView("app")} />}
    </div>
  );
}
