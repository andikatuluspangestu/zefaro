import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { defineMessages, localeOf, useLang, useT } from "@/i18n";
import { copyText } from "./shared";
import type { Advisory, PackagesReport } from "./types";

const messages = defineMessages({
  en: {
    intro: "Checks composer.lock against known security advisories and newer releases on packagist.org, with composer audit and composer outdated.",
    check: "Check again",
    checking: "Checking packages on packagist.org…",
    checkedAt: (time: string, n: number) => `Checked ${time} · ${n} packages in composer.lock`,
    security: "Security",
    advisories: (n: number, p: number) => `${n} ${n === 1 ? "advisory" : "advisories"} in ${p} ${p === 1 ? "package" : "packages"}`,
    noAdvisories: "No known vulnerabilities in the locked versions.",
    locked: (v: string) => `locked ${v}`,
    affected: (v: string) => `Affected: ${v}`,
    fixHint: (name: string) => `Update with composer update ${name}, or raise its constraint in composer.json if the fix is in a newer major version.`,
    copyUpdate: "Copy update command",
    copied: "Copied",
    openAdvisory: "Open advisory",
    severity: { critical: "Critical", high: "High", medium: "Medium", low: "Low", unknown: "Unrated" },
    abandoned: "Abandoned",
    abandonedHint: "Their maintainers no longer look after these packages, so security fixes may never come.",
    useInstead: "Use instead:",
    noReplacement: "no replacement suggested",
    outdated: "Updates",
    outdatedCount: (n: number) => `${n} ${n === 1 ? "package has" : "packages have"} a newer release`,
    upToDate: "Every package is on its latest release.",
    all: "All",
    direct: "In composer.json",
    directBadge: "direct",
    safe: "Safe update",
    safeHint: "Allowed by composer.json: composer update installs it.",
    major: "Needs a constraint change",
    majorHint: "Newer than composer.json allows, usually a new major version. Read its upgrade guide first.",
    failed: (what: string) => `Zefaro couldn't run composer ${what}`,
  },
  id: {
    intro: "Memeriksa composer.lock terhadap peringatan keamanan yang diketahui dan rilis yang lebih baru di packagist.org, dengan composer audit dan composer outdated.",
    check: "Periksa lagi",
    checking: "Memeriksa paket di packagist.org…",
    checkedAt: (time: string, n: number) => `Diperiksa ${time} · ${n} paket di composer.lock`,
    security: "Keamanan",
    advisories: (n: number, p: number) => `${n} peringatan di ${p} paket`,
    noAdvisories: "Tidak ada kerentanan yang diketahui di versi yang terkunci.",
    locked: (v: string) => `terkunci ${v}`,
    affected: (v: string) => `Terdampak: ${v}`,
    fixHint: (name: string) => `Perbarui dengan composer update ${name}, atau naikkan batas versinya di composer.json bila perbaikannya ada di versi mayor yang lebih baru.`,
    copyUpdate: "Salin perintah update",
    copied: "Tersalin",
    openAdvisory: "Buka peringatan",
    severity: { critical: "Kritis", high: "Tinggi", medium: "Sedang", low: "Rendah", unknown: "Tanpa tingkat" },
    abandoned: "Ditinggalkan",
    abandonedHint: "Pengelolanya tidak lagi merawat paket ini, jadi perbaikan keamanan mungkin tidak akan datang.",
    useInstead: "Gantinya:",
    noReplacement: "tidak ada pengganti yang disarankan",
    outdated: "Pembaruan",
    outdatedCount: (n: number) => `${n} paket punya rilis yang lebih baru`,
    upToDate: "Semua paket sudah di rilis terbarunya.",
    all: "Semua",
    direct: "Di composer.json",
    directBadge: "langsung",
    safe: "Pembaruan aman",
    safeHint: "Diizinkan composer.json: composer update memasangnya.",
    major: "Perlu ubah batas versi",
    majorHint: "Lebih baru dari yang diizinkan composer.json, biasanya versi mayor baru. Baca panduan upgrade-nya dulu.",
    failed: (what: string) => `Zefaro tidak bisa menjalankan composer ${what}`,
  },
});

type Severity = "critical" | "high" | "medium" | "low" | "unknown";
const SEVERITY_TONE: Record<Severity, string> = {
  critical: "border-destructive/50 bg-destructive/10 text-destructive",
  high: "border-destructive/40 text-destructive",
  medium: "border-warning/50 text-warning",
  low: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

/** Reports already fetched this session, so switching tabs doesn't ask packagist again. */
const cache = new Map<string, { report: PackagesReport; at: number }>();

export function PackagesTab({ site }: { site: string }) {
  const t = useT(messages);
  const { lang } = useLang();
  const [result, setResult] = useState(() => cache.get(site) ?? null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyDirect, setOnlyDirect] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const fresh = { report: await api.sitePackages(site), at: Date.now() };
      cache.set(site, fresh);
      setResult(fresh);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }, [site]);

  // The first visit checks at once; later visits show the last result.
  useEffect(() => {
    if (!cache.has(site)) run();
  }, [site, run]);

  const report = result?.report ?? null;
  const groups = useMemo(() => {
    const map = new Map<string, Advisory[]>();
    for (const a of report?.advisories ?? []) map.set(a.package, [...(map.get(a.package) ?? []), a]);
    return [...map];
  }, [report]);
  const outdated = (report?.outdated ?? []).filter((p) => !onlyDirect || p.direct);
  const time = result ? new Date(result.at).toLocaleTimeString(localeOf(lang), { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-0 flex-1 basis-72 text-sm text-muted-foreground">
          {t.intro}
          {result && !running && <span className="mt-1 block text-xs">{t.checkedAt(time, result.report.locked)}</span>}
        </p>
        <Button size="sm" variant="outline" onClick={run} disabled={running}>
          {running ? <Spinner className="size-3" /> : <Icon name="rotate" />}
          {t.check}
        </Button>
      </div>

      {error && (
        <IconAlert icon="circle-exclamation" className="border-destructive/40 text-destructive *:data-[slot=alert-description]:text-muted-foreground" title={error} />
      )}

      {running && !report && (
        <Card className="gap-3 p-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {t.checking}
          </p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </Card>
      )}

      {report && (
        <div className={cn("space-y-6", running && "opacity-60")}>
          {/* Security */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Icon name="shield-halved" className="text-muted-foreground" />
              {t.security}
              {report.advisories.length > 0 && (
                <Badge variant="destructive" className="font-normal">
                  {t.advisories(report.advisories.length, groups.length)}
                </Badge>
              )}
            </h3>
            {report.auditError ? (
              <CheckError title={t.failed("audit")} detail={report.auditError} />
            ) : groups.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="circle-check" className="text-success" />
                {t.noAdvisories}
              </p>
            ) : (
              groups.map(([pkg, list]) => (
                <Card key={pkg} className="gap-0 overflow-hidden py-0">
                  <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2">
                    <code className="font-mono text-sm font-medium">{pkg}</code>
                    {list[0].version && <span className="font-mono text-xs text-muted-foreground">{t.locked(list[0].version)}</span>}
                    <Button
                      size="xs"
                      variant="ghost"
                      className="ml-auto text-muted-foreground"
                      title={t.fixHint(pkg)}
                      onClick={() => copyText(`composer update ${pkg}`, t.copied)}
                    >
                      <Icon name="copy" className="w-3" />
                      {t.copyUpdate}
                    </Button>
                  </div>
                  <ul className="divide-y">
                    {list.map((a, i) => {
                      const sev: Severity = a.severity ?? "unknown";
                      return (
                        <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                          <Badge variant="outline" className={cn("mt-0.5 w-16 shrink-0 justify-center", SEVERITY_TONE[sev])}>
                            {t.severity[sev]}
                          </Badge>
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="text-sm">{a.title}</p>
                            <p className="flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground">
                              {a.cve && <span>{a.cve}</span>}
                              <span>{t.affected(a.affectedVersions)}</span>
                            </p>
                          </div>
                          {a.link && (
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              className="text-muted-foreground"
                              aria-label={t.openAdvisory}
                              title={t.openAdvisory}
                              onClick={() => openUrl(a.link!).catch((e) => toast.error(String(e)))}
                            >
                              <Icon name="arrow-up-right-from-square" className="w-3" />
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              ))
            )}
          </section>

          {/* Abandoned */}
          {report.abandoned.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Icon name="box-archive" className="text-muted-foreground" />
                {t.abandoned}
                <Badge variant="outline" className="border-warning/50 font-normal text-warning">
                  {report.abandoned.length}
                </Badge>
              </h3>
              <p className="text-xs text-muted-foreground">{t.abandonedHint}</p>
              <Card className="gap-0 overflow-hidden py-0">
                <ul className="divide-y">
                  {report.abandoned.map((a) => (
                    <li key={a.package} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
                      <code className="font-mono">{a.package}</code>
                      <span className="text-xs text-muted-foreground">
                        {a.replacement ? (
                          <>
                            {t.useInstead}{" "}
                            <code className="font-mono text-foreground/80">{a.replacement}</code>
                          </>
                        ) : (
                          t.noReplacement
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {/* Updates */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Icon name="arrow-up-right-dots" className="text-muted-foreground" />
                {t.outdated}
              </h3>
              {report.outdated.length > 0 && (
                <>
                  <span className="text-xs text-muted-foreground">{t.outdatedCount(report.outdated.length)}</span>
                  <Tabs value={onlyDirect ? "direct" : "all"} onValueChange={(v) => setOnlyDirect(v === "direct")} className="ml-auto">
                    <TabsList className="h-8">
                      <TabsTrigger value="all" className="text-xs">
                        {t.all}
                      </TabsTrigger>
                      <TabsTrigger value="direct" className="text-xs">
                        {t.direct}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </>
              )}
            </div>
            {report.outdatedError ? (
              <CheckError title={t.failed("outdated")} detail={report.outdatedError} />
            ) : report.outdated.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="circle-check" className="text-success" />
                {t.upToDate}
              </p>
            ) : (
              <Card className="gap-0 overflow-hidden py-0">
                <ul className="divide-y">
                  {outdated.map((p) => {
                    const safe = p.status === "semver-safe-update";
                    return (
                      <li key={p.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                        <code className="min-w-0 flex-1 basis-48 truncate font-mono" title={p.description ?? undefined}>
                          {p.name}
                          {p.direct && (
                            <Badge variant="secondary" className="ml-2 h-4 px-1.5 font-sans text-[10px]">
                              {t.directBadge}
                            </Badge>
                          )}
                        </code>
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {p.version} <Icon name="arrow-right" className="mx-1 w-2.5" /> <span className="text-foreground">{p.latest}</span>
                        </span>
                        <Badge
                          variant="outline"
                          className={cn("w-44 justify-center", safe ? "border-success/40 text-success" : "border-warning/50 text-warning")}
                          title={safe ? t.safeHint : t.majorHint}
                        >
                          {safe ? t.safe : t.major}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function CheckError({ title, detail }: { title: string; detail: string }) {
  return (
    <IconAlert icon="circle-exclamation" className="border-destructive/40 text-destructive *:data-[slot=alert-description]:text-muted-foreground" title={title}>
      <span className="font-mono text-xs break-words whitespace-pre-wrap">{detail}</span>
    </IconAlert>
  );
}
