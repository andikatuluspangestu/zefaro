import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { defineMessages, useT } from "@/i18n";
import { Masked, copyText, isSecretKey, showValue } from "./shared";
import type { ConfigResponse, EnvEntry, RoutesResponse } from "./types";

const messages = defineMessages({
  en: {
    parts: { env: ".env", config: "Config values", routes: "Routes" },
    filter: "Filter",
    envHint: "Changes go to the .env file. Zefaro ends the Tinker session so the next run reads them.",
    noEnv: "The .env file has no variables yet.",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    saved: (key: string) => `Saved ${key}`,
    newVariable: "New variable",
    name: "Name",
    value: "Value",
    add: "Add",
    line: (n: number) => `Line ${n}`,
    configHint: "What the app sees after merging config files and .env. Click a row to copy its config() call.",
    configCached: "Config is cached, so these values may not match .env until the cache is cleared.",
    copied: "Copied",
    more: (n: number) => `${n} more. Narrow the filter to see them.`,
    shown: (n: number, all: number) => (n === all ? `${all} items` : `${n} of ${all} items`),
    noMatch: "Nothing matches.",
    routesCached: "Routes are cached; run php artisan route:clear to pick up changes.",
    method: "Method",
    uri: "URI",
    name2: "Name",
    action: "Action",
    middleware: "Middleware",
    loadFailed: "Zefaro couldn't read this",
    reload: "Try again",
    typeLabel: "Type",
  },
  id: {
    parts: { env: ".env", config: "Nilai config", routes: "Route" },
    filter: "Filter",
    envHint: "Perubahan ditulis ke file .env. Zefaro mengakhiri sesi Tinker agar proses berikutnya membaca nilai baru.",
    noEnv: "File .env belum punya variabel.",
    edit: "Ubah",
    save: "Simpan",
    cancel: "Batal",
    saved: (key: string) => `${key} tersimpan`,
    newVariable: "Variabel baru",
    name: "Nama",
    value: "Nilai",
    add: "Tambah",
    line: (n: number) => `Baris ${n}`,
    configHint: "Yang dilihat aplikasi setelah file config dan .env digabung. Klik baris untuk menyalin pemanggilan config()-nya.",
    configCached: "Config di-cache, jadi nilai ini mungkin berbeda dari .env sampai cache dibersihkan.",
    copied: "Tersalin",
    more: (n: number) => `${n} lagi. Persempit filter untuk melihatnya.`,
    shown: (n: number, all: number) => (n === all ? `${all} item` : `${n} dari ${all} item`),
    noMatch: "Tidak ada yang cocok.",
    routesCached: "Route di-cache; jalankan php artisan route:clear agar perubahan terbaca.",
    method: "Method",
    uri: "URI",
    name2: "Nama",
    action: "Aksi",
    middleware: "Middleware",
    loadFailed: "Zefaro tidak bisa membaca ini",
    reload: "Coba lagi",
    typeLabel: "Tipe",
  },
});

type Part = "env" | "config" | "routes";
const LIMIT = 300;

export function ConfigTab({ site, onChanged }: { site: string; onChanged: () => void }) {
  const t = useT(messages);
  const [part, setPart] = useState<Part>("env");
  return (
    <div className="space-y-4">
      <Tabs value={part} onValueChange={(v) => setPart(v as Part)}>
        <TabsList variant="line">
          {(Object.keys(t.parts) as Part[]).map((p) => (
            <TabsTrigger key={p} value={p}>
              {t.parts[p]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {part === "env" && <EnvPart site={site} onChanged={onChanged} />}
      {part === "config" && <ConfigPart site={site} />}
      {part === "routes" && <RoutesPart site={site} />}
    </div>
  );
}

function EnvPart({ site, onChanged }: { site: string; onChanged: () => void }) {
  const t = useT(messages);
  const [entries, setEntries] = useState<EnvEntry[] | null>(null);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [draft, setDraft] = useState({ key: "", value: "" });

  useEffect(() => {
    api.siteEnv(site).then(setEntries).catch((e) => {
      setEntries([]);
      toast.error(String(e));
    });
  }, [site]);

  const save = async (key: string, value: string) => {
    try {
      setEntries(await api.siteEnvSet(site, [[key, value]]));
      toast.success(t.saved(key));
      setEditing(null);
      onChanged();
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    }
  };

  const shown = useMemo(
    () => (entries ?? []).filter((e) => e.key.toLowerCase().includes(filter.trim().toLowerCase())),
    [entries, filter],
  );

  if (entries === null) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t.envHint}</p>
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.filter} aria-label={t.filter} className="max-w-xs" />
      <Card className="gap-0 overflow-hidden py-0">
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t.noEnv}</p>
        ) : (
          <ul className="divide-y">
            {shown.map((e) => (
              <li key={e.key} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                <code className="w-56 shrink-0 truncate font-mono text-xs" title={`${e.key} (${t.line(e.line)})`}>
                  {e.key}
                </code>
                {editing?.key === e.key ? (
                  <>
                    <Input
                      autoFocus
                      value={editing.value}
                      onChange={(ev) => setEditing({ key: e.key, value: ev.target.value })}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") save(e.key, editing.value);
                        if (ev.key === "Escape") setEditing(null);
                      }}
                      className="h-7 flex-1 font-mono text-xs"
                    />
                    <Button size="xs" onClick={() => save(e.key, editing.value)}>
                      {t.save}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
                      {t.cancel}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 font-mono text-xs">
                      {isSecretKey(e.key) ? <Masked value={e.value} /> : <span className="block truncate" title={e.value}>{e.value}</span>}
                    </span>
                    <Button size="icon-xs" variant="ghost" className="text-muted-foreground" aria-label={t.edit} title={t.edit} onClick={() => setEditing({ key: e.key, value: e.value })}>
                      <Icon name="pen" className="w-3" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="gap-3 p-4">
        <h3 className="text-sm font-medium">{t.newVariable}</h3>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (await save(draft.key.trim(), draft.value)) setDraft({ key: "", value: "" });
          }}
        >
          <Input value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value.toUpperCase() })} placeholder={t.name} aria-label={t.name} className="w-56 font-mono text-xs" />
          <Input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} placeholder={t.value} aria-label={t.value} className="min-w-48 flex-1 font-mono text-xs" />
          <Button type="submit" disabled={!draft.key.trim()}>
            <Icon name="plus" className="w-3" />
            {t.add}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function useLoaded<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  const run = useCallback(() => {
    setState({ data: null, error: null });
    load().then((data) => setState({ data, error: null })).catch((e) => setState({ data: null, error: String(e) }));
  }, [load]);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

function LoadError({ error, reload }: { error: string; reload: () => void }) {
  const t = useT(messages);
  return (
    <IconAlert
      icon="circle-exclamation"
      className="border-destructive/40 text-destructive *:data-[slot=alert-description]:text-muted-foreground"
      title={t.loadFailed}
      action={
        <Button size="sm" variant="outline" onClick={reload}>
          {t.reload}
        </Button>
      }
    >
      <span className="font-mono text-xs break-words whitespace-pre-wrap">{error}</span>
    </IconAlert>
  );
}

function ConfigPart({ site }: { site: string }) {
  const t = useT(messages);
  const load = useCallback(() => api.siteConfig(site), [site]);
  const { data, error, reload } = useLoaded<ConfigResponse>(load);
  const [filter, setFilter] = useState("");
  const items = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.items ?? []).filter((i) => !q || i.key.toLowerCase().includes(q) || showValue(i.value).toLowerCase().includes(q));
  }, [data, filter]);

  if (error) return <LoadError error={error} reload={reload} />;
  if (!data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t.configHint}</p>
      {data.cached && (
        <IconAlert icon="box-archive" className="border-warning/40 text-warning" title={t.configCached} />
      )}
      <div className="flex items-center gap-3">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.filter} aria-label={t.filter} className="max-w-xs" />
        <span className="text-xs text-muted-foreground">{t.shown(items.length, data.items.length)}</span>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t.noMatch}</p>
        ) : (
          <ul className="divide-y">
            {items.slice(0, LIMIT).map((i) => (
              <li
                key={i.key}
                role="button"
                tabIndex={0}
                title={`config('${i.key}')`}
                onClick={() => copyText(`config('${i.key}')`, t.copied)}
                onKeyDown={(e) => e.key === "Enter" && copyText(`config('${i.key}')`, t.copied)}
                className="flex cursor-pointer items-center gap-3 px-4 py-1.5 hover:bg-muted/50"
              >
                <code className="w-80 max-w-[45%] shrink-0 truncate font-mono text-xs">{i.key}</code>
                <span className={cn("min-w-0 flex-1 font-mono text-xs", i.value === null && "text-muted-foreground/60 italic")}>
                  {i.value === null ? "null" : isSecretKey(i.key) && showValue(i.value) !== "" ? <Masked value={showValue(i.value)} /> : <span className="block truncate" title={showValue(i.value)}>{showValue(i.value) || <span className="text-muted-foreground/60">""</span>}</span>}
                </span>
                <Badge variant="outline" className="shrink-0 font-mono text-[10px]" title={t.typeLabel}>
                  {i.type}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {items.length > LIMIT && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t.more(items.length - LIMIT)}</p>}
      </Card>
    </div>
  );
}

const METHOD_TONE: Record<string, string> = {
  GET: "text-success",
  POST: "text-info",
  PUT: "text-warning",
  PATCH: "text-warning",
  DELETE: "text-destructive",
};

function RoutesPart({ site }: { site: string }) {
  const t = useT(messages);
  const load = useCallback(() => api.siteRoutes(site), [site]);
  const { data, error, reload } = useLoaded<RoutesResponse>(load);
  const [filter, setFilter] = useState("");
  const routes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.routes ?? []).filter(
      (r) => !q || [r.uri, r.name ?? "", r.action, r.methods.join(" "), ...r.middleware].some((s) => s.toLowerCase().includes(q)),
    );
  }, [data, filter]);

  if (error) return <LoadError error={error} reload={reload} />;
  if (!data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-3">
      {data.cached && <IconAlert icon="box-archive" className="border-warning/40 text-warning" title={t.routesCached} />}
      <div className="flex items-center gap-3">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.filter} aria-label={t.filter} className="max-w-xs" />
        <span className="text-xs text-muted-foreground">{t.shown(routes.length, data.routes.length)}</span>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t.method}</TableHead>
                <TableHead>{t.uri}</TableHead>
                <TableHead>{t.name2}</TableHead>
                <TableHead>{t.action}</TableHead>
                <TableHead className="pr-4">{t.middleware}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routes.slice(0, LIMIT).map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-4 font-mono text-xs">
                    {r.methods.map((m) => (
                      <span key={m} className={cn("mr-1.5 font-medium", METHOD_TONE[m])}>
                        {m}
                      </span>
                    ))}
                  </TableCell>
                  <TableCell className="font-mono text-xs">/{r.uri.replace(/^\//, "")}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.name}</TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs" title={r.action}>
                    {r.action}
                  </TableCell>
                  <TableCell className="pr-4 text-xs text-muted-foreground">{r.middleware.join(", ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {routes.length > LIMIT && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t.more(routes.length - LIMIT)}</p>}
        {routes.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">{t.noMatch}</p>}
      </Card>
    </div>
  );
}
