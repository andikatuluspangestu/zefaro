import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { StatusDot } from "@/components/status-dot";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";
import type { Overview, Worker, WorkerStatus } from "./types";

const messages = defineMessages({
  en: {
    intro: "A worker is a command Zefaro keeps running for this site and restarts if it crashes. Its output goes to the Logs page.",
    empty: "No workers yet. Add one below.",
    add: "Add a worker",
    suggestions: "Suggested",
    presets: {
      queue: { label: "Queue worker", hint: "Processes queued jobs" },
      schedule: { label: "Scheduler", hint: "Runs scheduled tasks every minute" },
      vite: { label: "Vite", hint: "Dev server for assets" },
      reverb: { label: "Reverb", hint: "WebSocket server" },
      horizon: { label: "Horizon", hint: "Redis queue dashboard and workers" },
    },
    name: "Name",
    command: "Command",
    commandHint: "Starts with php to use this site's PHP. Anything else runs in a Windows command prompt in the site's folder.",
    autostart: "Start when Zefaro starts",
    create: "Add worker",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    remove: "Remove",
    removeTitle: (name: string) => `Remove ${name}?`,
    removeBody: "Zefaro stops the worker and forgets it. Its log file stays.",
    log: "Show output",
    hideLog: "Hide output",
    noLog: "No output yet.",
    pid: (n: number) => `PID ${n}`,
    changed: "Saved. A running worker restarts with the new command.",
    started: (name: string) => `${name} started`,
    stoppedMsg: (name: string) => `${name} stopped`,
    removed: (name: string) => `${name} removed`,
    queueDriver: (d: string) => `This app's queue driver is "${d}", so a queue worker has nothing to process until you change QUEUE_CONNECTION.`,
  },
  id: {
    intro: "Worker adalah perintah yang dijaga Zefaro tetap berjalan untuk situs ini dan dijalankan ulang jika crash. Outputnya masuk ke halaman Log.",
    empty: "Belum ada worker. Tambahkan di bawah.",
    add: "Tambah worker",
    suggestions: "Saran",
    presets: {
      queue: { label: "Queue worker", hint: "Memproses job antrean" },
      schedule: { label: "Scheduler", hint: "Menjalankan tugas terjadwal tiap menit" },
      vite: { label: "Vite", hint: "Server dev untuk aset" },
      reverb: { label: "Reverb", hint: "Server WebSocket" },
      horizon: { label: "Horizon", hint: "Dashboard dan worker antrean Redis" },
    },
    name: "Nama",
    command: "Perintah",
    commandHint: "Diawali php untuk memakai PHP situs ini. Selain itu berjalan di command prompt Windows di folder situs.",
    autostart: "Mulai saat Zefaro mulai",
    create: "Tambah worker",
    save: "Simpan",
    cancel: "Batal",
    edit: "Ubah",
    remove: "Hapus",
    removeTitle: (name: string) => `Hapus ${name}?`,
    removeBody: "Zefaro menghentikan worker dan melupakannya. File lognya tetap ada.",
    log: "Tampilkan output",
    hideLog: "Sembunyikan output",
    noLog: "Belum ada output.",
    pid: (n: number) => `PID ${n}`,
    changed: "Tersimpan. Worker yang berjalan dimulai ulang dengan perintah baru.",
    started: (name: string) => `${name} dimulai`,
    stoppedMsg: (name: string) => `${name} dihentikan`,
    removed: (name: string) => `${name} dihapus`,
    queueDriver: (d: string) => `Driver antrean aplikasi ini "${d}", jadi queue worker tidak punya yang diproses sampai QUEUE_CONNECTION diubah.`,
  },
});

const PRESETS = [
  { id: "queue", command: "php artisan queue:work --tries=3", always: true },
  { id: "schedule", command: "php artisan schedule:work", always: true },
  { id: "vite", command: "npm run dev", always: true },
  { id: "reverb", command: "php artisan reverb:start", package: "reverb" },
  { id: "horizon", command: "php artisan horizon", package: "horizon" },
] as const;

type Draft = { id: string; label: string; command: string; autostart: boolean };
const blank: Draft = { id: "", label: "", command: "", autostart: false };

export function WorkersTab({ site, overview }: { site: string; overview: Overview | null }) {
  const t = useT(messages);
  const c = useT(common);
  const [workers, setWorkers] = useState<WorkerStatus[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [logOf, setLogOf] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [toRemove, setToRemove] = useState<WorkerStatus | null>(null);

  const load = useCallback(() => api.workersList(site).then(setWorkers).catch(() => {}), [site]);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!logOf) return;
    let stop = false;
    const read = () =>
      api
        .tailLog(logOf, 60)
        .then((r) => !stop && setLog(r.entries.map((e) => e.raw)))
        .catch(() => !stop && setLog([]));
    read();
    const timer = window.setInterval(read, 2000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [logOf]);

  const toggle = async (w: WorkerStatus) => {
    setBusy(w.id);
    try {
      const running = w.state === "running" || w.state === "starting";
      await (running ? api.workerStop(w.id) : api.workerStart(w.id));
      toast.success(running ? t.stoppedMsg(w.label) : t.started(w.label));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
      load();
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const worker: Worker = { id: draft.id, site, label: draft.label, command: draft.command, autostart: draft.autostart };
      const saved = await api.workerSave(worker);
      if (draft.id) toast.success(t.changed);
      setDraft(null);
      // A new worker starts right away: that is why it was added.
      if (!draft.id) {
        try {
          await api.workerStart(saved.id);
          toast.success(t.started(saved.label));
        } catch (e) {
          toast.error(String(e));
        }
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
      load();
    }
  };

  const remove = async () => {
    const w = toRemove;
    setToRemove(null);
    if (!w) return;
    try {
      await api.workerRemove(w.id);
      toast(t.removed(w.label));
      if (logOf === w.logId) setLogOf(null);
    } catch (e) {
      toast.error(String(e));
    }
    load();
  };

  const presets = PRESETS.filter((p) => ("always" in p && p.always) || ("package" in p && overview?.packages[p.package]));
  const queueIdle = overview?.drivers.queue === "sync" || overview?.drivers.queue === "null";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t.intro}</p>

      {workers && workers.length === 0 && !draft && <p className="py-4 text-center text-sm text-muted-foreground">{t.empty}</p>}

      {workers && workers.length > 0 && (
        <Card className="gap-0 overflow-hidden py-0">
          <ul className="divide-y">
            {workers.map((w) => {
              const running = w.state === "running" || w.state === "starting";
              return (
                <li key={w.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusDot status={w.state === "failed" ? "error" : w.state} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {w.label}
                        {w.pid && running && <span className="text-xs font-normal text-muted-foreground">{t.pid(w.pid)}</span>}
                      </div>
                      <code className="block truncate font-mono text-xs text-muted-foreground" title={w.command}>
                        {w.command}
                      </code>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={w.autostart}
                        onCheckedChange={(on) => api.workerSave({ ...w, autostart: on }).then(load).catch((e) => toast.error(String(e)))}
                        aria-label={t.autostart}
                      />
                      {t.autostart}
                    </label>
                    <Button size="sm" variant={running ? "outline" : "default"} disabled={busy === w.id} onClick={() => toggle(w)}>
                      {busy === w.id ? <Spinner className="size-3" /> : <Icon name={running ? "stop" : "play"} className="w-3" />}
                      {running ? c.stop : c.start}
                    </Button>
                    <Button size="icon-sm" variant="ghost" title={logOf === w.logId ? t.hideLog : t.log} aria-label={logOf === w.logId ? t.hideLog : t.log} onClick={() => setLogOf(logOf === w.logId ? null : w.logId)}>
                      <Icon name="file-lines" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" title={t.edit} aria-label={t.edit} onClick={() => setDraft({ id: w.id, label: w.label, command: w.command, autostart: w.autostart })}>
                      <Icon name="pen" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" title={t.remove} aria-label={t.remove} onClick={() => setToRemove(w)}>
                      <Icon name="trash-can" />
                    </Button>
                  </div>
                  {w.state === "failed" && w.message && <p className="text-xs break-words whitespace-pre-wrap text-destructive">{w.message}</p>}
                  {logOf === w.logId && (
                    <pre className="max-h-56 overflow-auto rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                      {log.length ? log.join("\n") : <span className="text-muted-foreground">{t.noLog}</span>}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {draft ? (
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-medium">{draft.id ? t.edit : t.add}</h3>
          <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <label className="space-y-1 text-xs text-muted-foreground">
              {t.name}
              <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="text-sm text-foreground" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              {t.command}
              <Input value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} className="font-mono text-xs text-foreground" spellCheck={false} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">{t.commandHint}</p>
          {draft.command.includes("queue:") && queueIdle && overview?.drivers.queue && (
            <IconAlert icon="triangle-exclamation" className="border-warning/40 text-warning" title={t.queueDriver(overview.drivers.queue)} />
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.autostart} onCheckedChange={(on) => setDraft({ ...draft, autostart: on })} />
            {t.autostart}
          </label>
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving || !draft.label.trim() || !draft.command.trim()}>
              {saving && <Spinner className="size-3" />}
              {draft.id ? t.save : t.create}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t.cancel}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDraft(blank)}>
            <Icon name="plus" className="w-3" />
            {t.add}
          </Button>
          <span className="text-xs text-muted-foreground">{t.suggestions}</span>
          {presets.map((p) => (
            <Button key={p.id} size="sm" variant="ghost" title={t.presets[p.id].hint} onClick={() => setDraft({ id: "", label: t.presets[p.id].label, command: p.command, autostart: false })}>
              {t.presets[p.id].label}
            </Button>
          ))}
        </div>
      )}

      <AlertDialog open={toRemove !== null} onOpenChange={(open) => !open && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.removeTitle(toRemove?.label ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>{t.removeBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              {t.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
