import { useCallback, useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api } from "@/api";
import type { DbInfo, DbJob, DbOverview, DumpInfo } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/settings-layout";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { localeOf, useLang, useT, type Lang } from "@/i18n";
import { common } from "@/i18n/common";
import { messages } from "./DatabasesPage.i18n";

const POLL_MS = 500;
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

function bytes(n: number | null | undefined, lang: Lang) {
  if (n == null) return common[lang].unknown;
  const num = (v: number, digits: number) =>
    v.toLocaleString(localeOf(lang), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: false,
    });
  if (n >= 100 * 1024 ** 3) return `${num(Math.round(n / 1024 ** 3), 0)} GB`;
  if (n >= 1024 ** 3) return `${num(n / 1024 ** 3, 2)} GB`;
  if (n >= 1024 ** 2) return `${num(n / 1024 ** 2, 1)} MB`;
  if (n >= 1024) return `${num(n / 1024, 0)} KB`;
  return `${num(n, 0)} B`;
}

function duration(ms: number, d: (typeof messages)["en"]["duration"]) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return d.hm(h, m);
  if (m) return d.ms(m, String(sec).padStart(2, "0"));
  return d.s(sec);
}

const EXPORT_FORMATS = [
  { gzip: true, key: "compressed", ext: ".sql.gz", recommended: true },
  { gzip: false, key: "plain", ext: ".sql", recommended: false },
] as const;

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const today = () => new Date().toISOString().slice(0, 10);

/** Progress card for the running (or last) export/import. */
function JobCard({ job, onCancel, onDismiss }: { job: DbJob; onCancel: () => void; onDismiss: () => void }) {
  const t = useT(messages);
  const c = useT(common);
  const { lang } = useLang();
  const size = (n: number | null | undefined) => bytes(n, lang);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (job.state !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job.state]);

  const running = job.state === "running";
  const elapsed = (job.endedMs ?? now) - job.startedMs;
  const speed = elapsed > 0 ? job.done / (elapsed / 1000) : 0;
  // Import knows its total exactly (the file); an export's total is the
  // database's size, which the dump only approximates.
  const exact = job.kind === "import";
  const pct = job.total ? Math.min(running && !exact ? 99 : 100, (job.done / job.total) * 100) : 0;
  const left = running && job.total && speed > 0 && job.done < job.total ? (job.total - job.done) / speed : null;
  const title = t.job[job.kind][job.state](job.database);

  return (
    <Card
      className={cn(
        "gap-3 p-4",
        job.state === "failed" && "border-destructive/50",
        job.state === "done" && "border-success/40"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg bg-muted",
            job.state === "done" && "text-success",
            job.state === "failed" && "text-destructive"
          )}
        >
          {running ? (
            <Spinner />
          ) : (
            <Icon
              name={job.state === "done" ? "circle-check" : job.state === "failed" ? "circle-exclamation" : "ban"}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={job.file}>
            {job.kind === "export" ? "→ " : "← "}
            {job.file}
          </p>
        </div>
        {running ? (
          <Button size="sm" variant="outline" onClick={onCancel}>
            {c.cancel}
          </Button>
        ) : (
          <div className="flex gap-1">
            {job.state === "done" && job.kind === "export" && (
              <Button size="sm" variant="outline" onClick={() => api.dbReveal(job.file).catch((e) => toast.error(String(e)))}>
                <Icon name="folder-open" variant="regular" />
                {t.showInFolder}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              {t.dismiss}
            </Button>
          </div>
        )}
      </div>

      {(running || job.state === "done") && (
        <div className="space-y-1.5">
          <Progress value={job.state === "done" ? 100 : pct} className="h-2" />
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <span>
              {job.state === "done"
                ? job.kind === "export"
                  ? t.exportDone(size(job.resultSize), size(job.done))
                  : t.importDone(size(job.total))
                : t.progress(size(job.done), size(job.total), exact)}
            </span>
            <span>
              {speed > 0 && `${size(speed)}/s · `}
              {duration(elapsed, t.duration)}
              {left !== null && t.left(duration(left * 1000, t.duration))}
            </span>
          </div>
        </div>
      )}

      {job.state === "failed" && job.message && (
        <pre className="max-h-40 overflow-auto rounded-md bg-destructive/10 p-3 font-mono text-xs whitespace-pre-wrap text-destructive">
          {job.message}
        </pre>
      )}
    </Card>
  );
}

/**
 * `fixed`: opened from a row, so the target database is that row's.
 * `scan`: what the dump holds; null while Zefaro reads it. `from`: the database
 * picked out of a dump that holds several.
 */
type ImportDraft = {
  path: string;
  name: string;
  existing: DbInfo | null;
  fixed: boolean;
  scan: DumpInfo | null;
  scanError: string | null;
  from: string | null;
};

export function DatabasesPage({ backLabel, onBack }: { backLabel: string; onBack: () => void }) {
  const t = useT(messages);
  const c = useT(common);
  const { lang } = useLang();
  const size = (n: number | null | undefined) => bytes(n, lang);
  const [data, setData] = useState<DbOverview | null>(null);
  const [job, setJob] = useState<DbJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [exporting, setExporting] = useState<{ db: DbInfo; gzip: boolean } | null>(null);
  const [importing, setImporting] = useState<ImportDraft | null>(null);
  const [dropping, setDropping] = useState<DbInfo | null>(null);

  const load = useCallback(() => {
    api.dbOverview().then(setData).catch((e) => toast.error(String(e)));
  }, []);

  useEffect(() => {
    load();
    api.dbJob().then(setJob).catch(() => {});
  }, [load]);

  // Follow a running job; refresh the list when it ends.
  useEffect(() => {
    if (job?.state !== "running") return;
    const timer = window.setInterval(async () => {
      const j = await api.dbJob().catch(() => null);
      setJob(j);
      if (j && j.state !== "running") {
        load();
        if (j.state === "done") {
          toast.success(t.job[j.kind].done(j.database));
        }
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [job?.state, load, t]);

  const running = job?.state === "running";
  const startMariaDb = async () => {
    setStarting(true);
    try {
      await api.startService("mariadb");
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setStarting(false);
    }
  };

  const create = async () => {
    if (!creating) return;
    try {
      await api.dbCreate(creating);
      toast.success(t.created(creating));
      setCreating(null);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const chooseExport = async () => {
    if (!exporting) return;
    const { db, gzip } = exporting;
    const dir = await api.dbDefaultDir().catch(() => "");
    const ext = gzip ? "sql.gz" : "sql";
    const path = await saveDialog({
      title: t.exportTitle(db.name),
      defaultPath: `${dir ? dir + "\\" : ""}${db.name}-${today()}.${ext}`,
      filters: [{ name: gzip ? t.compressedSql : "SQL", extensions: gzip ? ["gz"] : ["sql"] }],
    });
    setExporting(null);
    if (!path) return;
    const free = await api.diskFree(path).catch(() => null);
    // Plain SQL is about the database's size; gzip is usually far smaller.
    if (free !== null && free < (gzip ? db.size / 3 : db.size)) {
      toast.warning(t.lowSpace(size(free)));
    }
    try {
      setJob(await api.dbExport(db.name, path, gzip));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const pickImport = async (into?: DbInfo) => {
    const path = await openDialog({
      title: into ? t.importInto(into.name) : t.importADatabase,
      multiple: false,
      directory: false,
      filters: [{ name: t.sqlDump, extensions: ["sql", "gz"] }],
    });
    if (typeof path !== "string") return;
    const name = into?.name ?? (await api.dbNameFromFile(path).catch(() => "imported"));
    setImporting({
      path,
      name,
      existing: into ?? data?.databases.find((d) => d.name.toLowerCase() === name.toLowerCase()) ?? null,
      fixed: !!into,
      scan: null,
      scanError: null,
      from: null,
    });
    // Read the dump to see which databases it holds (a dump made with
    // --all-databases has several, and MariaDB's own among them).
    try {
      const scan = await api.dbScanDump(path);
      const first = scan.databases[0]?.name ?? null;
      setImporting((d) =>
        d && d.path === path
          ? { ...d, scan, from: first, name: !d.fixed && first && NAME_RE.test(first) ? first : d.name }
          : d
      );
    } catch (e) {
      setImporting((d) => (d && d.path === path ? { ...d, scanError: String(e) } : d));
    }
  };

  const pickFrom = (from: string) =>
    setImporting((d) => (d ? { ...d, from, name: !d.fixed && NAME_RE.test(from) ? from : d.name } : d));

  const startImport = async () => {
    if (!importing) return;
    const { path, name, from } = importing;
    setImporting(null);
    try {
      setJob(await api.dbImport(path, name, !!importExisting, from));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const drop = async () => {
    if (!dropping) return;
    const name = dropping.name;
    setDropping(null);
    try {
      await api.dbDrop(name);
      toast(t.dropped(name));
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const importName = importing?.name ?? "";
  const importExisting = importing && !importing.fixed
    ? data?.databases.find((d) => d.name.toLowerCase() === importName.toLowerCase()) ?? null
    : importing?.existing ?? null;
  const totalSize = data?.databases.reduce((sum, d) => sum + d.size, 0) ?? 0;
  const scan = importing?.scan ?? null;
  const scanning = !!importing && !scan && !importing.scanError;
  // A dump with only MariaDB's own databases has nothing Zefaro can import.
  const onlySystem = !!scan && scan.databases.length === 0 && scan.system.length > 0;

  return (
    <>
      <BackButton label={backLabel} onClick={onBack} />
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          data?.running && (
            <>
              <Button size="sm" variant="outline" disabled={running} onClick={() => pickImport()}>
                <Icon name="upload" className="text-warning" />
                {t.importDump}
              </Button>
              <Button size="sm" onClick={() => setCreating("")}>
                <Icon name="plus" />
                {t.newDatabase}
              </Button>
            </>
          )
        }
      />

      <div className="space-y-4">
        {job && (
          <JobCard
            job={job}
            onCancel={() => api.dbJobCancel().catch(() => {})}
            onDismiss={() => {
              api.dbJobDismiss().catch(() => {});
              setJob(null);
            }}
          />
        )}

        {data === null ? (
          <Card className="gap-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </Card>
        ) : !data.running ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon name="database" />
              </EmptyMedia>
              <EmptyTitle>{t.notRunningTitle}</EmptyTitle>
              <EmptyDescription>{t.notRunningDescription}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={startMariaDb} disabled={starting}>
                {starting ? <Spinner /> : <Icon name="play" />}
                {t.startMariaDb}
              </Button>
            </EmptyContent>
          </Empty>
        ) : data.databases.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon name="database" />
              </EmptyMedia>
              <EmptyTitle>{t.emptyTitle}</EmptyTitle>
              <EmptyDescription>{t.emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4 text-xs tracking-wide uppercase">{t.colDatabase}</TableHead>
                  <TableHead className="text-right text-xs tracking-wide uppercase">{t.colSize}</TableHead>
                  <TableHead className="text-right text-xs tracking-wide uppercase">{t.colTables}</TableHead>
                  <TableHead className="pr-3 text-right text-xs tracking-wide uppercase">{t.colActions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.databases.map((d) => {
                  const busy = running && job?.database === d.name;
                  return (
                    <TableRow key={d.name}>
                      <TableCell className="pl-4 font-mono font-medium">
                        {d.name}
                        {busy && (
                          <Badge variant="secondary" className="ml-2 font-sans">
                            {job?.kind === "export" ? t.exporting : t.importing}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{size(d.size)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{d.tables}</TableCell>
                      <TableCell className="pr-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={running}
                                onClick={() => setExporting({ db: d, gzip: true })}
                                aria-label={t.exportTitle(d.name)}
                              >
                                <Icon name="download" className="text-info" />
                                {t.export}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t.exportTip(d.name)}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={running}
                                onClick={() => pickImport(d)}
                                aria-label={t.importInto(d.name)}
                              >
                                <Icon name="upload" className="text-warning" />
                                {t.import}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t.importTip(d.name)}</TooltipContent>
                          </Tooltip>
                          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="text-muted-foreground hover:text-destructive"
                                disabled={busy}
                                onClick={() => setDropping(d)}
                                aria-label={t.drop(d.name)}
                              >
                                <Icon name="trash-can" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t.drop(d.name)}</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}

        {data?.running && (
          <p className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {t.count(data.databases.length)} · {size(totalSize)}
            </span>
            <span title={data.dataDir}>{t.freeOnDrive(size(data.dataFree))}</span>
          </p>
        )}
      </div>

      {/* New database */}
      <AlertDialog open={creating !== null} onOpenChange={(o) => !o && setCreating(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.newDatabase}</AlertDialogTitle>
            <AlertDialogDescription>{t.newDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={creating ?? ""}
            placeholder="my_app"
            aria-label={t.nameLabel}
            onChange={(e) => setCreating(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && NAME_RE.test(creating ?? "") && create()}
            className="font-mono"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={!NAME_RE.test(creating ?? "")} onClick={create}>
              {t.createDatabase}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export */}
      <AlertDialog open={!!exporting} onOpenChange={(o) => !o && setExporting(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t.exportDialogBefore}
              <span className="font-mono">{exporting?.db.name}</span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {exporting && exporting.db.size > 0
                ? t.exportSize(size(exporting.db.size), exporting.db.tables)
                : t.exportEmpty}
              {t.exportIncludes}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div role="radiogroup" aria-label={t.format} className="grid gap-2">
            {EXPORT_FORMATS.map((f) => {
              const selected = exporting?.gzip === f.gzip;
              return (
                <button
                  key={f.ext}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => exporting && setExporting({ ...exporting, gzip: f.gzip })}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
                    selected && "border-primary bg-primary/5"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                      selected ? "border-primary" : "border-muted-foreground/50"
                    )}
                  >
                    {selected && <span className="size-2 rounded-full bg-primary" />}
                  </span>
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                      {t.formats[f.key].title}
                      <code className="font-mono text-xs font-normal text-muted-foreground">{f.ext}</code>
                      {f.recommended && (
                        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                          {t.recommended}
                        </Badge>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">{t.formats[f.key].text}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={chooseExport}>{t.chooseWhere}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import */}
      <AlertDialog open={!!importing} onOpenChange={(o) => !o && setImporting(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.importFile(importing ? fileName(importing.path) : "")}</AlertDialogTitle>
            <AlertDialogDescription>{t.importAccepts}</AlertDialogDescription>
          </AlertDialogHeader>
          {scanning && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {t.scanning}
            </p>
          )}
          {importing?.scanError && <p className="text-sm text-destructive">{importing.scanError}</p>}
          {scan?.origin && <p className="text-sm text-muted-foreground">{t.madeBy(scan.origin)}</p>}
          {scan && scan.databases.length > 0 && (
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">
                {scan.databases.length > 1 ? t.severalInDump : t.oneInDump}
              </span>
              <Select value={importing?.from ?? undefined} onValueChange={pickFrom}>
                <SelectTrigger className="w-full font-mono" aria-label={t.fromDumpLabel}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scan.databases.map((d) => (
                    <SelectItem key={d.name} value={d.name} className="font-mono">
                      {d.name} <span className="text-muted-foreground">{t.sqlSize(size(d.bytes))}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          {scan && scan.system.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {t.skipsSystem(scan.system.join(", "), scan.system.length)}
            </p>
          )}
          {onlySystem && (
            <p className="text-sm text-destructive">{t.onlySystem}</p>
          )}
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">{t.intoDatabase}</span>
            <Input
              value={importName}
              disabled={importing?.fixed}
              aria-label={t.targetLabel}
              onChange={(e) => importing && setImporting({ ...importing, name: e.target.value })}
              className="font-mono"
            />
          </label>
          {importExisting && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t.alreadyExists(importExisting.name, size(importExisting.size))}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant={importExisting ? "destructive" : "default"}
              disabled={!NAME_RE.test(importName) || scanning || onlySystem || !!importing?.scanError}
              onClick={startImport}
            >
              {importExisting ? t.replaceAndImport : t.import}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Drop */}
      <AlertDialog open={!!dropping} onOpenChange={(o) => !o && setDropping(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.dropTitle(dropping?.name)}</AlertDialogTitle>
            <AlertDialogDescription>{t.dropDescription(dropping?.tables, size(dropping?.size))}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={drop}>
              {t.dropDatabase}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
