import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { cn } from "@/lib/utils";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";
import { JobConsole, JobState } from "./shared";
import type { ArtisanCommand, SiteJob } from "./types";

const messages = defineMessages({
  en: {
    search: "Find a command",
    quick: "Common",
    quickItems: {
      migrate: "Migrate",
      seed: "Migrate and seed",
      clear: "Clear caches",
      storage: "Link storage",
      routes: "List routes",
      about: "About",
    },
    arguments: "Arguments",
    options: "Options",
    optional: "optional",
    required: "required",
    noParams: "This command takes no arguments or options.",
    run: "Run",
    running: "Running…",
    pick: "Pick a command on the left, or one of the common ones above.",
    preview: "Runs as",
    noMatch: "No command matches.",
    recent: "Recent runs",
    confirmTitle: (name: string) => `Run ${name}?`,
    confirmBody: {
      destructive: "This command deletes or rewrites data in the database. It can't be undone.",
      production: "This app runs in production, so the command changes real data.",
      key: "A new app key makes every encrypted value and session made with the old key unreadable.",
    },
    confirmRun: "Run anyway",
    interactive: "Zefaro runs commands without prompts, so a command that asks questions uses its defaults.",
    loadFailed: "Zefaro couldn't list the commands",
    retry: "Try again",
    ago: (s: number) => (s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`),
    default: "default",
    commaHint: "Separate several values with commas.",
    spaceHint: "Separate several values with spaces.",
  },
  id: {
    search: "Cari perintah",
    quick: "Umum",
    quickItems: {
      migrate: "Migrasi",
      seed: "Migrasi dan seed",
      clear: "Bersihkan cache",
      storage: "Tautkan storage",
      routes: "Daftar route",
      about: "Tentang",
    },
    arguments: "Argumen",
    options: "Opsi",
    optional: "opsional",
    required: "wajib",
    noParams: "Perintah ini tidak punya argumen atau opsi.",
    run: "Jalankan",
    running: "Berjalan…",
    pick: "Pilih perintah di kiri, atau salah satu yang umum di atas.",
    preview: "Dijalankan sebagai",
    noMatch: "Tidak ada perintah yang cocok.",
    recent: "Jalan terakhir",
    confirmTitle: (name: string) => `Jalankan ${name}?`,
    confirmBody: {
      destructive: "Perintah ini menghapus atau menulis ulang data di database. Tidak bisa dibatalkan.",
      production: "Aplikasi ini berjalan di production, jadi perintah ini mengubah data sungguhan.",
      key: "App key baru membuat semua nilai terenkripsi dan sesi dari key lama tidak terbaca.",
    },
    confirmRun: "Tetap jalankan",
    interactive: "Zefaro menjalankan perintah tanpa pertanyaan, jadi perintah yang bertanya memakai nilai bawaannya.",
    loadFailed: "Zefaro tidak bisa mendaftar perintah",
    retry: "Coba lagi",
    ago: (s: number) => (s < 60 ? `${s} dtk lalu` : s < 3600 ? `${Math.floor(s / 60)} mnt lalu` : `${Math.floor(s / 3600)} jam lalu`),
    default: "bawaan",
    commaHint: "Pisahkan beberapa nilai dengan koma.",
    spaceHint: "Pisahkan beberapa nilai dengan spasi.",
  },
});

/** Commands that make no sense without a terminal, or that never end (Workers covers those). */
const HIDDEN = new Set(["tinker", "serve", "db", "queue:work", "queue:listen", "schedule:work", "schedule:run", "pail", "install:api", "install:broadcasting", "boost:mcp"]);
const DESTRUCTIVE = new Set(["migrate:fresh", "migrate:reset", "migrate:refresh", "migrate:rollback", "db:wipe", "migrate:install"]);
const REWRITES_DATA_IN_PRODUCTION = (name: string) => name.startsWith("migrate") || name.startsWith("db:");

const QUICK: { id: keyof typeof messages.en.quickItems; icon: string; command: string; preset: Record<string, string | boolean> }[] = [
  { id: "migrate", icon: "table-list", command: "migrate", preset: {} },
  { id: "seed", icon: "seedling", command: "migrate", preset: { seed: true } },
  { id: "clear", icon: "broom", command: "optimize:clear", preset: {} },
  { id: "storage", icon: "link", command: "storage:link", preset: {} },
  { id: "routes", icon: "route", command: "route:list", preset: {} },
  { id: "about", icon: "circle-info", command: "about", preset: {} },
];

type Values = Record<string, string | boolean>;

const shell = (a: string) => (/[\s"']/.test(a) || a === "" ? `"${a.replace(/"/g, '\\"')}"` : a);

function buildArgs(cmd: ArtisanCommand, values: Values): { args: string[]; missing: boolean } {
  const args = [cmd.name];
  let missing = false;
  for (const a of cmd.arguments) {
    const v = String(values[`arg:${a.name}`] ?? "").trim();
    if (!v) {
      if (a.required) missing = true;
      continue;
    }
    if (a.array) args.push(...v.split(/\s+/));
    else args.push(v);
  }
  for (const o of cmd.options) {
    const v = values[`opt:${o.name}`];
    if (!o.acceptsValue) {
      if (v === true) args.push(`--${o.name}`);
      continue;
    }
    const text = String(v ?? "").trim();
    if (!text) continue;
    if (o.multiple) for (const part of text.split(",")) part.trim() && args.push(`--${o.name}=${part.trim()}`);
    else args.push(`--${o.name}=${text}`);
  }
  return { args, missing };
}

export function ArtisanTab({ site, environment }: { site: string; environment: string | null }) {
  const t = useT(messages);
  const c = useT(common);
  const [commands, setCommands] = useState<ArtisanCommand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({});
  const [jobId, setJobId] = useState<number | null>(null);
  const [recent, setRecent] = useState<SiteJob[]>([]);
  const [confirm, setConfirm] = useState<{ title: string; body: string; args: string[] } | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setCommands(null);
    api.artisanCommands(site).then(setCommands).catch((e) => setError(String(e)));
  }, [site]);
  useEffect(load, [load]);

  const refreshRecent = useCallback(() => api.siteJobs(site).then((j) => setRecent(j.filter((x) => x.command.startsWith("php artisan")).slice(0, 6))).catch(() => {}), [site]);
  useEffect(() => {
    refreshRecent();
    const timer = window.setInterval(refreshRecent, 3000);
    return () => window.clearInterval(timer);
  }, [refreshRecent]);

  const visible = useMemo(() => (commands ?? []).filter((x) => !HIDDEN.has(x.name)), [commands]);
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const map = new Map<string, ArtisanCommand[]>();
    for (const cmd of visible) {
      if (q && !cmd.name.toLowerCase().includes(q) && !cmd.description.toLowerCase().includes(q)) continue;
      const ns = cmd.name.includes(":") ? cmd.name.split(":")[0] : "";
      map.set(ns, [...(map.get(ns) ?? []), cmd]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  }, [visible, filter]);

  const command = visible.find((x) => x.name === selected) ?? null;
  const built = command ? buildArgs(command, values) : null;

  const choose = (name: string, preset: Values = {}) => {
    setSelected(name);
    // Presets name options by their plain name ("seed").
    setValues(Object.fromEntries(Object.entries(preset).map(([k, v]) => [`opt:${k}`, v])));
  };

  const start = async (args: string[]) => {
    setStarting(true);
    try {
      const job = await api.siteJobRun(site, "artisan", args);
      setJobId(job.id);
      refreshRecent();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setStarting(false);
    }
  };

  const run = () => {
    if (!command || !built || built.missing) return;
    const name = command.name;
    let body: string | null = null;
    if (DESTRUCTIVE.has(name)) body = t.confirmBody.destructive;
    else if (name === "key:generate") body = t.confirmBody.key;
    else if (environment === "production" && REWRITES_DATA_IN_PRODUCTION(name)) body = t.confirmBody.production;
    if (body) setConfirm({ title: t.confirmTitle(`php artisan ${name}`), body, args: built.args });
    else start(built.args);
  };

  if (error)
    return (
      <IconAlert
        icon="circle-exclamation"
        className="border-destructive/40 text-destructive *:data-[slot=alert-description]:text-muted-foreground"
        title={t.loadFailed}
        action={
          <Button size="sm" variant="outline" onClick={load}>
            {t.retry}
          </Button>
        }
      >
        <span className="font-mono text-xs break-words whitespace-pre-wrap">{error}</span>
      </IconAlert>
    );
  if (!commands) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t.quick}</span>
        {QUICK.filter((q) => visible.some((x) => x.name === q.command)).map((q) => (
          <Button key={q.id} size="sm" variant="outline" onClick={() => choose(q.command, q.preset)}>
            <Icon name={q.icon} className="w-3" />
            {t.quickItems[q.id]}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Card className="h-fit gap-0 py-0">
          <div className="border-b p-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.search} aria-label={t.search} className="h-8" />
          </div>
          <div className="max-h-[30rem] overflow-y-auto p-1">
            {groups.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">{t.noMatch}</p>}
            {groups.map(([ns, list]) => (
              <div key={ns} className="mb-1">
                {ns && <div className="px-2 pt-2 pb-0.5 text-[11px] font-medium text-muted-foreground">{ns}</div>}
                {list.map((cmd) => (
                  <button
                    key={cmd.name}
                    onClick={() => choose(cmd.name)}
                    title={cmd.description}
                    className={cn(
                      "block w-full truncate rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-muted",
                      cmd.name === selected && "bg-muted font-medium text-primary",
                    )}
                  >
                    {cmd.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Card>

        <div className="min-w-0 space-y-3">
          {!command ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t.pick}</p>
          ) : (
            <Card className="gap-4 p-4">
              <div>
                <h3 className="font-mono text-sm font-medium">{command.name}</h3>
                <p className="text-sm text-muted-foreground">{command.description}</p>
              </div>

              {command.arguments.length === 0 && command.options.length === 0 && (
                <p className="text-sm text-muted-foreground">{t.noParams}</p>
              )}

              {command.arguments.length > 0 && (
                <section className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground">{t.arguments}</h4>
                  {command.arguments.map((a) => (
                    <Field key={a.name} label={a.name} note={a.required ? t.required : t.optional} description={a.description} hint={a.array ? t.spaceHint : undefined}>
                      <Input
                        value={String(values[`arg:${a.name}`] ?? "")}
                        onChange={(e) => setValues({ ...values, [`arg:${a.name}`]: e.target.value })}
                        placeholder={a.default !== null && a.default !== undefined && a.default !== false ? String(a.default) : undefined}
                        className="font-mono text-xs"
                      />
                    </Field>
                  ))}
                </section>
              )}

              {command.options.length > 0 && (
                <section className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground">{t.options}</h4>
                  {command.options.map((o) =>
                    o.acceptsValue ? (
                      <Field key={o.name} label={`--${o.name}`} note={o.shortcut || undefined} description={o.description} hint={o.multiple ? t.commaHint : undefined}>
                        <Input
                          value={String(values[`opt:${o.name}`] ?? "")}
                          onChange={(e) => setValues({ ...values, [`opt:${o.name}`]: e.target.value })}
                          placeholder={o.default !== null && o.default !== undefined && o.default !== false && !Array.isArray(o.default) ? `${t.default}: ${String(o.default)}` : undefined}
                          className="font-mono text-xs"
                        />
                      </Field>
                    ) : (
                      <label key={o.name} className="flex items-start gap-3 text-sm">
                        <Switch checked={values[`opt:${o.name}`] === true} onCheckedChange={(on) => setValues({ ...values, [`opt:${o.name}`]: on })} className="mt-0.5" />
                        <span className="min-w-0">
                          <code className="font-mono text-xs">--{o.name}</code>
                          {o.description && <span className="block text-xs text-muted-foreground">{o.description}</span>}
                        </span>
                      </label>
                    ),
                  )}
                </section>
              )}

              <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                <Button onClick={run} disabled={!built || built.missing || starting}>
                  <Icon name="play" className="w-3" />
                  {t.run}
                </Button>
                {built && (
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={`php artisan ${built.args.map(shell).join(" ")}`}>
                    {t.preview}: php artisan {built.args.map(shell).join(" ")}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t.interactive}</p>
            </Card>
          )}

          {jobId !== null && <JobConsole jobId={jobId} />}

          {recent.length > 0 && (
            <section className="space-y-1">
              <h4 className="text-xs font-medium text-muted-foreground">{t.recent}</h4>
              <ul className="divide-y rounded-lg border">
                {recent.map((j) => (
                  <li key={j.id}>
                    <button className={cn("flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-muted/50", j.id === jobId && "bg-muted/50")} onClick={() => setJobId(j.id)}>
                      <code className="min-w-0 flex-1 truncate font-mono text-xs">{j.command}</code>
                      <JobState job={j} />
                      <span className="w-16 text-right text-xs text-muted-foreground">{t.ago(Math.max(0, Math.round((Date.now() - j.startedMs) / 1000)))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const args = confirm!.args;
                setConfirm(null);
                start(args);
              }}
            >
              {t.confirmRun}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, note, description, hint, children }: { label: string; note?: string; description: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
      <div className="pt-1.5">
        <code className="font-mono text-xs">{label}</code>
        {note && <span className="ml-1.5 text-[11px] text-muted-foreground">{note}</span>}
      </div>
      <div className="space-y-1">
        {children}
        {(description || hint) && (
          <p className="text-xs text-muted-foreground">
            {description} {hint}
          </p>
        )}
      </div>
    </div>
  );
}
