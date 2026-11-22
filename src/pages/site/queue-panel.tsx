import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
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
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, localeOf, useLang, useT } from "@/i18n";
import { JobConsole, lastLine, runToEnd } from "./shared";
import type { FailedJob, FailedJobs, ScheduledTask, WorkerStatus } from "./types";

const SHOWN = 20;

const messages = defineMessages({
  en: {
    failedTitle: "Failed jobs",
    failedEmpty: "No failed jobs.",
    unavailable: "Zefaro couldn't read the failed jobs:",
    unavailableHint: "With the database driver, the failed_jobs table has to exist: run the migrations.",
    retry: "Retry",
    retryAll: "Retry all",
    forget: "Delete",
    flush: "Delete all",
    flushTitle: (n: number) => `Delete all ${n} failed jobs?`,
    flushBody: "Zefaro runs php artisan queue:flush. The jobs can't be retried afterwards.",
    cancel: "Cancel",
    details: "Details",
    hideDetails: "Hide details",
    more: (n: number) => `Show all ${n}`,
    onQueue: (queue: string, connection: string) => `${queue} on ${connection}`,
    noQueueWorker: "A retried job waits on the queue until a queue worker runs. Add one above.",
    scheduleTitle: "Scheduled tasks",
    scheduleEmpty: "This app has no scheduled tasks.",
    next: (when: string) => `Next: ${when}`,
    everySeconds: (n: number) => `every ${n} s`,
    runNow: "Run now",
    noScheduler: "Tasks run on their own only while a scheduler worker (php artisan schedule:work) runs. Run now works without one.",
    reload: "Reload",
    closure: "Closure",
    done: "Done",
  },
  id: {
    failedTitle: "Job gagal",
    failedEmpty: "Tidak ada job yang gagal.",
    unavailable: "Zefaro tidak bisa membaca job yang gagal:",
    unavailableHint: "Dengan driver database, tabel failed_jobs harus ada: jalankan migrasi.",
    retry: "Coba lagi",
    retryAll: "Coba lagi semua",
    forget: "Hapus",
    flush: "Hapus semua",
    flushTitle: (n: number) => `Hapus semua ${n} job yang gagal?`,
    flushBody: "Zefaro menjalankan php artisan queue:flush. Job itu tidak bisa dicoba lagi setelahnya.",
    cancel: "Batal",
    details: "Detail",
    hideDetails: "Sembunyikan detail",
    more: (n: number) => `Tampilkan semua ${n}`,
    onQueue: (queue: string, connection: string) => `${queue} di ${connection}`,
    noQueueWorker: "Job yang dicoba lagi menunggu di antrean sampai ada queue worker yang berjalan. Tambahkan di atas.",
    scheduleTitle: "Tugas terjadwal",
    scheduleEmpty: "Aplikasi ini tidak punya tugas terjadwal.",
    next: (when: string) => `Berikutnya: ${when}`,
    everySeconds: (n: number) => `setiap ${n} dtk`,
    runNow: "Jalankan sekarang",
    noScheduler: "Tugas berjalan sendiri hanya selama scheduler worker (php artisan schedule:work) berjalan. Jalankan sekarang tetap bisa tanpanya.",
    reload: "Muat ulang",
    closure: "Closure",
    done: "Selesai",
  },
});

const runs = (workers: WorkerStatus[] | null, pattern: RegExp) =>
  (workers ?? []).some((w) => (w.state === "running" || w.state === "starting") && pattern.test(w.command));

/** Under the workers: the app's failed queue jobs and its scheduled tasks. */
export function QueuePanel({ site, workers }: { site: string; workers: WorkerStatus[] | null }) {
  const t = useT(messages);
  const { lang } = useLang();
  const [failed, setFailed] = useState<FailedJobs | null>(null);
  const [failedError, setFailedError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [confirmFlush, setConfirmFlush] = useState(false);
  const [runJob, setRunJob] = useState<number | null>(null);

  const loadFailed = useCallback(() => {
    setFailedError(null);
    return api
      .siteQueueFailed(site)
      .then(setFailed)
      .catch((e) => setFailedError(String(e)));
  }, [site]);
  const loadTasks = useCallback(() => {
    setTasksError(null);
    return api
      .siteSchedule(site)
      .then((r) => setTasks(r.tasks))
      .catch((e) => setTasksError(String(e)));
  }, [site]);
  useEffect(() => {
    loadFailed();
    loadTasks();
  }, [loadFailed, loadTasks]);

  /** Run an Artisan command to the end, say how it went, then read the list again. */
  const artisan = async (key: string, args: string[]) => {
    setBusy(key);
    try {
      const { job, lines } = await runToEnd(site, "artisan", args);
      const said = lastLine(lines);
      if (job.state === "done") toast.success(said || t.done);
      else toast.error(said || args.join(" "));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
      loadFailed();
    }
  };

  const when = (iso: string) =>
    new Date(iso).toLocaleString(localeOf(lang), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const queueWorker = runs(workers, /queue:(work|listen)|horizon/);
  const scheduler = runs(workers, /schedule:(work|run)/);
  const jobs = failed?.jobs ?? [];
  const shown = all ? jobs : jobs.slice(0, SHOWN);

  const jobRow = (j: FailedJob) => (
    <li key={j.id} className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="truncate text-sm font-medium" title={j.name ?? j.id}>
            {j.name ?? j.id}
          </div>
          <div className="text-xs text-muted-foreground">
            {[j.queue && j.connection ? t.onQueue(j.queue, j.connection) : j.queue ?? j.connection, j.failedAt].filter(Boolean).join(" · ")}
          </div>
          <p className="text-xs break-words text-destructive">{j.exception}</p>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen(open === j.id ? null : j.id)}>
            {open === j.id ? t.hideDetails : t.details}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => artisan(`retry:${j.id}`, ["queue:retry", j.id])}>
            {busy === `retry:${j.id}` ? <Spinner className="size-3" /> : <Icon name="rotate-right" />}
            {t.retry}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            title={t.forget}
            aria-label={t.forget}
            disabled={busy !== null}
            onClick={() => artisan(`forget:${j.id}`, ["queue:forget", j.id])}
          >
            {busy === `forget:${j.id}` ? <Spinner className="size-3" /> : <Icon name="trash-can" />}
          </Button>
        </div>
      </div>
      {open === j.id && (
        <pre className="max-h-64 overflow-auto rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {j.trace}
        </pre>
      )}
    </li>
  );

  const taskRow = (task: ScheduledTask, i: number) => (
    <li key={`${task.name}-${i}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <code className="block truncate font-mono text-xs" title={task.command ?? task.summary}>
          {task.command ?? (task.description || task.summary || t.closure)}
        </code>
        {task.command && task.description && <div className="text-xs text-muted-foreground">{task.description}</div>}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <code className="font-mono">{task.expression}</code>
          {task.repeatSeconds ? <span>{t.everySeconds(task.repeatSeconds)}</span> : null}
          {task.next && <span>{t.next(when(task.next))}</span>}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            const job = await api.siteJobRun(site, "artisan", ["schedule:test", `--name=${task.name}`]);
            setRunJob(job.id);
          } catch (e) {
            toast.error(String(e));
          }
        }}
      >
        <Icon name="play" />
        {t.runNow}
      </Button>
    </li>
  );

  return (
    <div className="space-y-6 pt-2">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{t.failedTitle}</h3>
          {failed?.available && failed.total > 0 && <Badge variant="outline">{failed.total}</Badge>}
          <div className="ml-auto flex gap-1">
            {failed?.available && failed.total > 0 && (
              <>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => artisan("retry-all", ["queue:retry", "all"])}>
                  {busy === "retry-all" ? <Spinner className="size-3" /> : <Icon name="rotate-right" />}
                  {t.retryAll}
                </Button>
                <Button size="sm" variant="ghost" className="hover:text-destructive" disabled={busy !== null} onClick={() => setConfirmFlush(true)}>
                  {busy === "flush" ? <Spinner className="size-3" /> : <Icon name="trash-can" />}
                  {t.flush}
                </Button>
              </>
            )}
            <Button size="icon-sm" variant="ghost" title={t.reload} aria-label={t.reload} onClick={loadFailed}>
              <Icon name="rotate" />
            </Button>
          </div>
        </div>
        {failedError ? (
          <p className="text-xs break-words text-destructive">{failedError}</p>
        ) : !failed ? (
          <Spinner className="size-4" />
        ) : !failed.available ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              {t.unavailable} <span className="break-words text-destructive">{failed.reason}</span>
            </p>
            <p>{t.unavailableHint}</p>
          </div>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.failedEmpty}</p>
        ) : (
          <>
            {!queueWorker && <IconAlert icon="circle-info" title={t.noQueueWorker} />}
            <Card className="gap-0 overflow-hidden py-0">
              <ul className="divide-y">{shown.map(jobRow)}</ul>
            </Card>
            {!all && jobs.length > SHOWN && (
              <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
                {t.more(jobs.length)}
              </Button>
            )}
          </>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{t.scheduleTitle}</h3>
          <Button size="icon-sm" variant="ghost" className="ml-auto" title={t.reload} aria-label={t.reload} onClick={loadTasks}>
            <Icon name="rotate" />
          </Button>
        </div>
        {tasksError ? (
          <p className="text-xs break-words text-destructive">{tasksError}</p>
        ) : !tasks ? (
          <Spinner className="size-4" />
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.scheduleEmpty}</p>
        ) : (
          <>
            {!scheduler && <IconAlert icon="circle-info" title={t.noScheduler} />}
            <Card className="gap-0 overflow-hidden py-0">
              <ul className="divide-y">{tasks.map(taskRow)}</ul>
            </Card>
          </>
        )}
        {runJob !== null && (
          <JobConsole
            jobId={runJob}
            actions={
              <Button size="icon-xs" variant="ghost" aria-label={t.hideDetails} title={t.hideDetails} onClick={() => setRunJob(null)}>
                <Icon name="xmark" />
              </Button>
            }
          />
        )}
      </section>

      <AlertDialog open={confirmFlush} onOpenChange={setConfirmFlush}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.flushTitle(failed?.total ?? 0)}</AlertDialogTitle>
            <AlertDialogDescription>{t.flushBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmFlush(false);
                artisan("flush", ["queue:flush"]);
              }}
            >
              {t.flush}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
