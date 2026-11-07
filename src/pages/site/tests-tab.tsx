import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { defineMessages, useT } from "@/i18n";
import { JobConsole, useJob } from "./shared";
import type { TestCase, TestsView } from "./types";

const messages = defineMessages({
  en: {
    noRunner: "No test runner yet",
    noRunnerBody: "There's no PHPUnit or Pest in vendor/bin. Run composer install with the dev packages, then come back.",
    filter: "Only tests whose name matches",
    filterPlaceholder: "Filter, e.g. UserTest or it_creates",
    run: "Run tests",
    runFailed: (n: number) => `Run ${n} failed`,
    hint: (runner: string) => `Runs vendor/bin/${runner} with the site's PHP. Tests use the settings in phpunit.xml, so a test that refreshes the database empties the one configured there.`,
    summary: { passed: "passed", failed: "failed", error: "errors", skipped: "skipped" },
    took: (s: string) => `in ${s}`,
    lastRun: (when: string) => `Last run ${when}`,
    onlyProblems: "Only failures",
    none: "No results yet. Run the tests to see each one here.",
    noMatch: "Every test passed.",
    open: "Open in editor",
  },
  id: {
    noRunner: "Belum ada test runner",
    noRunnerBody: "Tidak ada PHPUnit atau Pest di vendor/bin. Jalankan composer install dengan paket dev, lalu kembali ke sini.",
    filter: "Hanya test yang namanya cocok",
    filterPlaceholder: "Filter, misalnya UserTest atau it_creates",
    run: "Jalankan test",
    runFailed: (n: number) => `Jalankan ${n} yang gagal`,
    hint: (runner: string) => `Menjalankan vendor/bin/${runner} dengan PHP situs. Test memakai pengaturan di phpunit.xml, jadi test yang me-refresh database akan mengosongkan database yang diatur di sana.`,
    summary: { passed: "lolos", failed: "gagal", error: "error", skipped: "dilewati" },
    took: (s: string) => `dalam ${s}`,
    lastRun: (when: string) => `Terakhir dijalankan ${when}`,
    onlyProblems: "Hanya yang gagal",
    none: "Belum ada hasil. Jalankan test untuk melihat setiap test di sini.",
    noMatch: "Semua test lolos.",
    open: "Buka di editor",
  },
});

const STATUS_ICON: Record<TestCase["status"], [string, string]> = {
  passed: ["circle-check", "text-success"],
  failed: ["circle-xmark", "text-destructive"],
  error: ["circle-exclamation", "text-destructive"],
  skipped: ["circle-minus", "text-muted-foreground"],
};

const seconds = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`);
const shortClass = (c: string) => c.split("\\").pop() ?? c;

export function TestsTab({ site }: { site: string }) {
  const t = useT(messages);
  const [view, setView] = useState<TestsView | null>(null);
  const [filter, setFilter] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const { job } = useJob(jobId);

  const load = useCallback(() => api.siteTests(site).then(setView).catch((e) => toast.error(String(e))), [site]);
  useEffect(() => {
    load();
  }, [load]);
  // The report is written when the run ends.
  useEffect(() => {
    if (job && job.state !== "running") load();
  }, [job, load]);

  const cases = view?.report?.cases ?? [];
  const counts = useMemo(() => {
    const c = { passed: 0, failed: 0, error: 0, skipped: 0 };
    for (const x of cases) c[x.status]++;
    return c;
  }, [cases]);
  const failed = counts.failed + counts.error;
  const total = cases.reduce((s, x) => s + x.time, 0);
  const shown = onlyProblems ? cases.filter((x) => x.status === "failed" || x.status === "error") : cases;
  const running = job?.state === "running";

  const run = async (failedOnly: boolean) => {
    try {
      const j = await api.siteTestsRun(site, failedOnly ? "" : filter, failedOnly);
      setJobId(j.id);
    } catch (e) {
      toast.error(String(e));
    }
  };

  if (!view) return <Skeleton className="h-48 w-full" />;
  if (!view.runner)
    return (
      <IconAlert icon="vial" className="border-warning/40 text-warning *:data-[slot=alert-description]:text-muted-foreground" title={t.noRunner}>
        {t.noRunnerBody}
      </IconAlert>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !running && run(false)}
          placeholder={t.filterPlaceholder}
          aria-label={t.filter}
          className="font-mono sm:flex-1"
          spellCheck={false}
        />
        <div className="flex gap-2">
          <Button onClick={() => run(false)} disabled={running}>
            <Icon name="play" />
            {t.run}
          </Button>
          {failed > 0 && (
            <Button variant="outline" onClick={() => run(true)} disabled={running}>
              <Icon name="rotate-right" />
              {t.runFailed(failed)}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t.hint(view.runner)}</p>

      {jobId !== null && <JobConsole jobId={jobId} />}

      {view.report ? (
        <Card className="gap-0 py-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 text-sm">
            {(["passed", "failed", "error", "skipped"] as const)
              .filter((k) => k === "passed" || counts[k] > 0)
              .map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <Icon name={STATUS_ICON[k][0]} className={STATUS_ICON[k][1]} />
                  <span className="font-semibold tabular-nums">{counts[k]}</span>
                  <span className="text-muted-foreground">{t.summary[k]}</span>
                </span>
              ))}
            <span className="text-muted-foreground">{t.took(seconds(total))}</span>
            <span className="text-xs text-muted-foreground">
              {t.lastRun(new Date(view.report.finishedMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}
            </span>
            <label className="ml-auto flex items-center gap-2 text-xs">
              <Switch checked={onlyProblems} onCheckedChange={setOnlyProblems} />
              {t.onlyProblems}
            </label>
          </div>
          {shown.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">{onlyProblems ? t.noMatch : t.none}</p>
          ) : (
            <ul className="divide-y">
              {shown.map((x, i) => (
                <li key={`${x.class}::${x.name}::${i}`} className="px-4 py-2.5">
                  <div className="flex items-start gap-2.5 text-sm">
                    <Icon name={STATUS_ICON[x.status][0]} className={cn("mt-0.5", STATUS_ICON[x.status][1])} />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium break-words">{x.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground" title={x.class}>
                        {shortClass(x.class)}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">{seconds(x.time)}</span>
                    {x.file && x.line !== null && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => api.siteOpenFile(site, x.file!, x.line!).catch((e) => toast.error(String(e)))}
                        title={`${x.file}:${x.line}`}
                      >
                        <Icon name="arrow-up-right-from-square" />
                        {t.open}
                      </Button>
                    )}
                  </div>
                  {x.message && (
                    <pre className="mt-2 ml-6 max-h-60 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">
                      {x.message}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        !running && <p className="text-sm text-muted-foreground">{t.none}</p>
      )}
    </div>
  );
}
