import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { DumpEntry, DumpsStatus } from "@/types";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { defineMessages, localeOf, useLang, useT } from "@/i18n";
import { DumpTree } from "@/pages/site/dump-tree";
import type { DumpNode } from "@/pages/site/types";

/** The filter value for dumps that no site claims (scripts outside a site). */
const NO_SITE = "\u0000none";
const ALL = "\u0000all";

/** Keys, class names and values of a dump, lower-cased, for the search box. */
function nodeText(node: DumpNode, out: string[] = []): string[] {
  if (node.c) out.push(node.c);
  if (node.v !== undefined) out.push(String(node.v));
  for (const k of node.k ?? []) {
    out.push(k.key);
    nodeText(k.value, out);
  }
  return out;
}

function searchText(d: DumpEntry): string {
  return [d.name, d.file, d.command, d.uri, d.site, ...nodeText(d.node)].filter(Boolean).join("\n").toLowerCase();
}

const messages = defineMessages({
  en: {
    description: "dump() and dd() from your sites appear here instead of in the page.",
    catch: "Catch dumps",
    catchOn: "Sites send dump() and dd() here. Pages no longer show them.",
    catchOff: "Off: dumps print into the page as usual.",
    notRunning: "The receiver isn't running. Turn catching off and on again, or check the Logs page.",
    clear: "Clear",
    empty: "No dumps yet. Call dump($value) in a site, then load the page.",
    emptyOff: "Turn on catching, then call dump($value) in a site.",
    how: "Works with apps that use Symfony's VarDumper: Laravel, Symfony and most Composer projects. Plain var_dump() still prints into the page.",
    allSites: "All sites",
    noSite: "Outside a site",
    siteLabel: "Site",
    search: "Search dumps",
    clearSearch: "Clear search",
    noMatch: "No dumps match. Change the site or the search.",
    shown: (n: number, total: number) => `${n} of ${total}`,
  },
  id: {
    description: "dump() dan dd() dari situs Anda muncul di sini, bukan di halaman.",
    catch: "Tangkap dump",
    catchOn: "Situs mengirim dump() dan dd() ke sini. Halaman tidak lagi menampilkannya.",
    catchOff: "Mati: dump tampil di halaman seperti biasa.",
    notRunning: "Penerima dump tidak berjalan. Matikan lalu nyalakan lagi, atau lihat halaman Log.",
    clear: "Bersihkan",
    empty: "Belum ada dump. Panggil dump($value) di situs, lalu muat halamannya.",
    emptyOff: "Nyalakan penangkapan, lalu panggil dump($value) di situs.",
    how: "Bekerja untuk aplikasi yang memakai VarDumper dari Symfony: Laravel, Symfony, dan kebanyakan proyek Composer. var_dump() biasa tetap tampil di halaman.",
    allSites: "Semua situs",
    noSite: "Di luar situs",
    siteLabel: "Situs",
    search: "Cari dump",
    clearSearch: "Hapus pencarian",
    noMatch: "Tidak ada dump yang cocok. Ganti situs atau kata pencariannya.",
    shown: (n: number, total: number) => `${n} dari ${total}`,
  },
});

export function DumpsPage() {
  const t = useT(messages);
  const { lang } = useLang();
  const [status, setStatus] = useState<DumpsStatus | null>(null);
  const [dumps, setDumps] = useState<DumpEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [site, setSite] = useState<string>(ALL);
  const [query, setQuery] = useState("");

  // The sites that sent dumps, busiest first, and how many each sent.
  const sites = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of dumps ?? []) counts.set(d.site ?? NO_SITE, (counts.get(d.site ?? NO_SITE) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [dumps]);

  const texts = useMemo(() => new Map((dumps ?? []).map((d) => [d.id, searchText(d)])), [dumps]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (dumps ?? []).filter(
    (d) =>
      (site === ALL || (d.site ?? NO_SITE) === site) &&
      words.every((w) => texts.get(d.id)?.includes(w))
  );
  const filtering = site !== ALL || words.length > 0;

  const load = useCallback(() => {
    api.dumpsList().then(setDumps).catch(() => setDumps([]));
  }, []);

  useEffect(() => {
    api.dumpsStatus().then(setStatus).catch((e) => toast.error(String(e)));
    load();
  }, [load]);

  // New dumps arrive while the page is open.
  useEffect(() => {
    if (!status?.enabled) return;
    const timer = window.setInterval(load, 1500);
    return () => window.clearInterval(timer);
  }, [status?.enabled, load]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      setStatus(await api.dumpsSetEnabled(on));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = () =>
    api
      .dumpsClear()
      .then(() => {
        setDumps([]);
        setSite(ALL);
      })
      .catch((e) => toast.error(String(e)));

  const time = (s: number) => new Date(s * 1000).toLocaleTimeString(localeOf(lang), { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <>
      <PageHeader
        title="Dump"
        description={t.description}
        actions={
          <Button variant="outline" onClick={clear} disabled={!dumps?.length}>
            <Icon name="trash-can" variant="regular" />
            {t.clear}
          </Button>
        }
      />
      <Card className="mb-4 gap-2 p-4">
        {status === null ? (
          <Skeleton className="h-6 w-full" />
        ) : (
          <label className="flex items-start gap-3 text-sm">
            <Icon name="bug" className="mt-0.5 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t.catch}</span>
              <span className="block text-xs text-muted-foreground">
                {status.enabled ? (status.running ? t.catchOn : t.notRunning) : t.catchOff}
              </span>
            </span>
            <Switch checked={status.enabled} disabled={busy} onCheckedChange={toggle} aria-label={t.catch} />
          </label>
        )}
        <p className="text-xs text-muted-foreground">{t.how}</p>
      </Card>

      {dumps === null ? (
        <Skeleton className="h-32 w-full" />
      ) : dumps.length === 0 ? (
        <Card className="items-center p-8 text-center text-sm text-muted-foreground">{status?.enabled ? t.empty : t.emptyOff}</Card>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={site} onValueChange={setSite}>
              <SelectTrigger size="sm" className="w-full sm:w-52" aria-label={t.siteLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>
                  {t.allSites} <span className="text-muted-foreground tabular-nums">{dumps.length}</span>
                </SelectItem>
                {sites.map(([name, n]) => (
                  <SelectItem key={name} value={name}>
                    <span className={name === NO_SITE ? undefined : "font-mono"}>{name === NO_SITE ? t.noSite : name}</span>{" "}
                    <span className="text-muted-foreground tabular-nums">{n}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <InputGroup className="h-8 w-full sm:w-64">
              <InputGroupAddon>
                <Icon name="magnifying-glass" className="w-3.5" />
              </InputGroupAddon>
              <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search} />
              {query && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" onClick={() => setQuery("")} aria-label={t.clearSearch}>
                    <Icon name="xmark" className="w-3" />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
            {filtering && (
              <span className="text-xs text-muted-foreground tabular-nums sm:ml-auto">{t.shown(shown.length, dumps.length)}</span>
            )}
          </div>
          {shown.length === 0 && <Card className="items-center p-8 text-center text-sm text-muted-foreground">{t.noMatch}</Card>}
          {shown.map((d) => (
            <Card key={d.id} className="gap-2 p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="tabular-nums">{time(d.time)}</span>
                {d.site && (
                  <Badge variant="secondary" className="font-mono">
                    {d.site}
                  </Badge>
                )}
                {d.name && (
                  <span className="font-mono text-foreground/80" title={d.file ?? undefined}>
                    {d.name}
                    {d.line ? `:${d.line}` : ""}
                  </span>
                )}
                {d.command && <span className="truncate font-mono">{d.command}</span>}
                {d.uri && (
                  <span className="min-w-0 truncate font-mono" title={d.uri}>
                    {d.method && d.method !== "GET" ? `${d.method} ` : ""}
                    {d.uri.replace(/^https?:\/\/[^/]+/, "") || "/"}
                  </span>
                )}
              </div>
              <div className="max-h-[28rem] overflow-auto font-mono text-xs break-all">
                <DumpTree node={d.node} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
