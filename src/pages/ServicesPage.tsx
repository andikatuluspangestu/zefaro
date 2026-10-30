import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import type { DbEngine, Service } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { NginxSettingsPage } from "@/pages/NginxSettingsPage";
import { PhpPage } from "@/pages/PhpPage";
import { DnsSettingsPage } from "@/pages/DnsSettingsPage";
import { NodePage } from "@/pages/NodePage";
import { DB_ENGINES, DatabasesPage } from "@/pages/DatabasesPage";
import { MailpitSettingsPage } from "@/pages/MailpitSettingsPage";
import { ServiceLogo } from "@/components/service-logo";
import { StatusDot } from "@/components/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { defineMessages, localeOf, useLang, useT } from "@/i18n";
import { common } from "@/i18n/common";

const CATS = [
  { id: "core", icon: "server" },
  { id: "database", icon: "database" },
  { id: "mail", icon: "envelope" },
] as const;

const messages = defineMessages({
  en: {
    cats: {
      core: { label: "Core", hint: "nginx, one PHP listener per version, and *.test DNS" },
      database: { label: "Databases", hint: "MariaDB, MySQL, PostgreSQL, Redis and phpMyAdmin" },
      mail: { label: "Mail", hint: "Mailpit catches the mail your apps send" },
    },
    installName: (name: string) => `Install ${name}`,
    manageVersions: "Manage versions",
    comingSoon: "Coming soon",
    notAvailable: "Not available yet",
    stopping: "Stopping…",
    installing: "Installing…",
    starting: "Starting…",
    progress: {
      connecting: "Connecting…",
      download: (done: string, total: string | null) => (total ? `Downloading ${done} of ${total} MB` : `Downloading ${done} MB`),
      extract: (done: string, total: string | null) => (total ? `Unpacking files: ${done} of ${total}` : `Unpacking files: ${done}`),
      setup: "Setting up",
    },
    open: "Open",
    runName: (name: string) => `Run ${name}`,
    installAndStart: "Install and start",
    settingsFor: (name: string) => `${name} settings`,
    changePort: "Change port",
    ruleActive: "Windows rule active",
    removeRuleTitle: "Remove the Windows rule that sends *.test lookups to Zefaro",
    remove: "Remove",
    runningOn: (name: string, port: number | null | undefined) => `${name} is running on :${port}`,
    stopped: (name: string) => `${name} stopped`,
    dnsRemoved: "Removed the *.test rule from Windows.",
    coreRunning: "Core services are running",
    coreStopped: "Core services stopped",
    description: "Start and stop the background services your sites depend on.",
    runningCount: (on: number, all: number) => `${on}/${all} running`,
    stopAll: "Stop all",
    startAll: "Start all",
    noPhp: "No PHP version is installed yet. Install one to see it here.",
    installPhp: "Install PHP",
    phpVersions: "PHP versions",
    dnsSettings: "DNS settings",
    nodeVersions: "Node.js versions",
    databases: "Create, export and import databases",
    mailpitSettings: "Mailpit settings",
  },
  id: {
    cats: {
      core: { label: "Inti", hint: "nginx, satu listener PHP per versi, dan DNS *.test" },
      database: { label: "Database", hint: "MariaDB, MySQL, PostgreSQL, Redis, dan phpMyAdmin" },
      mail: { label: "Email", hint: "Mailpit menangkap email yang dikirim aplikasi Anda" },
    },
    installName: (name: string) => `Instal ${name}`,
    manageVersions: "Kelola versi",
    comingSoon: "Segera hadir",
    notAvailable: "Belum tersedia",
    stopping: "Menghentikan…",
    installing: "Menginstal…",
    starting: "Memulai…",
    progress: {
      connecting: "Menghubungkan…",
      download: (done: string, total: string | null) => (total ? `Mengunduh ${done} dari ${total} MB` : `Mengunduh ${done} MB`),
      extract: (done: string, total: string | null) => (total ? `Membuka file: ${done} dari ${total}` : `Membuka file: ${done}`),
      setup: "Menyiapkan",
    },
    open: "Buka",
    runName: (name: string) => `Jalankan ${name}`,
    installAndStart: "Instal dan mulai",
    settingsFor: (name: string) => `Pengaturan ${name}`,
    changePort: "Ganti port",
    ruleActive: "Aturan Windows aktif",
    removeRuleTitle: "Hapus aturan Windows yang mengirim pencarian *.test ke Zefaro",
    remove: "Hapus",
    runningOn: (name: string, port: number | null | undefined) => `${name} berjalan di :${port}`,
    stopped: (name: string) => `${name} dihentikan`,
    dnsRemoved: "Aturan *.test sudah dihapus dari Windows.",
    coreRunning: "Layanan inti berjalan",
    coreStopped: "Layanan inti dihentikan",
    description: "Mulai dan hentikan layanan latar belakang yang dibutuhkan situs Anda.",
    runningCount: (on: number, all: number) => `${on}/${all} berjalan`,
    stopAll: "Hentikan semua",
    startAll: "Mulai semua",
    noPhp: "Belum ada versi PHP yang terpasang. Instal satu versi agar muncul di sini.",
    installPhp: "Instal PHP",
    phpVersions: "Versi PHP",
    dnsSettings: "Pengaturan DNS",
    nodeVersions: "Versi Node.js",
    databases: "Buat, ekspor, dan impor database",
    mailpitSettings: "Pengaturan Mailpit",
  },
});

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3";
/** Poll so crashes, automatic restarts and slow starts show up on their own. */
const POLL_MS = 3000;

const isPhp = (s: Service) => s.id.startsWith("php-");

type InstallProgress = Awaited<ReturnType<typeof api.serviceProgress>>[string];

const mb = (bytes: number) => (bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0);

/** Download, unpack and setup of a service's first start, as a bar with a line of text. */
function InstallBar({ progress }: { progress: InstallProgress | undefined }) {
  const t = useT(messages);
  const lang = useLang();
  const fmt = (n: number) => n.toLocaleString(localeOf(lang.lang));
  const pct = progress?.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  const label = !progress
    ? t.progress.connecting
    : progress.phase === "download"
      ? t.progress.download(mb(progress.done), progress.total ? mb(progress.total) : null)
      : progress.phase === "extract"
        ? t.progress.extract(fmt(progress.done), progress.total ? fmt(progress.total) : null)
        : t.progress.setup;
  const determinate = pct !== null && progress?.phase !== "setup";
  return (
    <div className="w-full space-y-1.5" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        {determinate && <span className="shrink-0 tabular-nums">{pct}%</span>}
      </div>
      {determinate ? (
        <Progress value={pct} aria-label={label} />
      ) : (
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-label={label}>
          <div className="zefaro-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-brand-gradient" />
        </div>
      )}
    </div>
  );
}

function ServiceCard({
  s,
  busy,
  progress,
  onStart,
  onStop,
  onRemoveSetup,
  onSettings,
  settingsLabel,
}: {
  s: Service;
  busy: boolean;
  /** Present while the service's first start downloads and installs it. */
  progress?: InstallProgress;
  onStart: () => void;
  onStop: () => void;
  onRemoveSetup: () => void;
  /** Shows a gear that opens this service's settings. */
  onSettings?: () => void;
  /** Tooltip for the gear; defaults to "<name> settings". */
  settingsLabel?: string;
}) {
  const t = useT(messages);
  const c = useT(common);
  const on = s.status === "running" || s.status === "starting";
  const where = s.url ? s.url.replace(/^https?:\/\//, "") : s.port ? `localhost:${s.port}` : null;
  const meta = s.tool ? null : [where, s.pid ? `PID ${s.pid}` : null].filter(Boolean).join(" · ");

  let action;
  if (s.tool && s.id === "dns") {
    // `.localhost` has nothing to start: only the settings, where the domain can change.
    action = (
      <Button size="sm" variant="outline" className="w-full" onClick={onSettings}>
        <Icon name="globe" />
        {t.dnsSettings}
      </Button>
    );
  } else if (s.tool) {
    // Nothing to start or stop: manage versions instead.
    action = (
      <Button size="sm" variant={s.needsInstall ? "default" : "outline"} className="w-full" onClick={onSettings}>
        <Icon name={s.needsInstall ? "download" : "layer-group"} />
        {s.needsInstall ? t.installName(s.name) : t.manageVersions}
      </Button>
    );
  } else if (!s.available) {
    action = (
      <Badge variant="outline" className="w-full justify-center text-muted-foreground">
        {s.detail?.startsWith("Coming") ? t.comingSoon : t.notAvailable}
      </Badge>
    );
  } else if (progress || (busy && s.needsInstall)) {
    action = (
      <div className="w-full space-y-3">
        <InstallBar progress={progress} />
        <Button size="sm" variant="outline" className="w-full" disabled>
          <Spinner />
          {t.installing}
        </Button>
      </div>
    );
  } else if (s.needsInstall && !busy) {
    // The first start downloads the service, so it stays a named button rather than a switch.
    action = (
      <Button size="sm" className="w-full" onClick={onStart}>
        <Icon name={s.status === "error" ? "rotate" : "download"} />
        {s.status === "error" ? c.tryAgain : t.installAndStart}
      </Button>
    );
  } else {
    const pending = busy || s.status === "starting";
    let state;
    if (pending) {
      state = (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3" />
          {busy && on ? t.stopping : t.starting}
        </span>
      );
    } else if (on && s.url) {
      const url = s.url;
      state = (
        <Button size="sm" variant="outline" onClick={() => openUrl(url)}>
          <Icon name="arrow-up-right-from-square" />
          {t.open}
        </Button>
      );
    } else {
      state = (
        <span className={cn("text-xs", s.status === "error" ? "text-destructive" : "text-muted-foreground")}>
          {on ? c.running : s.status === "error" ? c.failed : c.stopped}
        </span>
      );
    }
    action = (
      <div className="flex min-h-8 w-full items-center justify-between gap-2">
        {state}
        <Switch
          checked={on}
          disabled={pending}
          onCheckedChange={(v) => (v ? onStart() : onStop())}
          aria-label={t.runName(s.name)}
        />
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "gap-3 py-4 transition-colors",
        s.status === "running" && "border-success/40",
        s.status === "error" && "border-destructive/50",
        !s.available && "opacity-60"
      )}
    >
      <CardHeader className="gap-1 px-4">
        <CardTitle className="flex items-center gap-3 text-sm">
          <ServiceLogo id={s.id} status={s.status} />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <StatusDot status={s.status} />
            <span className="truncate">{s.name}</span>
          </span>
          {onSettings && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0 self-start text-muted-foreground"
                  onClick={onSettings}
                  aria-label={settingsLabel ?? t.settingsFor(s.name)}
                >
                  <Icon name="gear" className="w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{settingsLabel ?? t.settingsFor(s.name)}</TooltipContent>
            </Tooltip>
          )}
        </CardTitle>
        <CardDescription className="space-y-0.5 text-xs">
          {s.available && meta && <span className="block font-mono">{meta}</span>}
          {s.detail && <span className="block">{s.detail}</span>}
        </CardDescription>
        {s.error && (
          <div className="space-y-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
            <p className="line-clamp-3" title={s.error}>
              {s.error}
            </p>
            {onSettings && /Port \d+ /.test(s.error) && (
              <Button size="xs" variant="outline" onClick={onSettings}>
                <Icon name="gear" className="w-3" />
                {t.changePort}
              </Button>
            )}
          </div>
        )}
        {s.setupDone && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Icon name="circle-check" className="w-3 text-success" />
              {t.ruleActive}
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="shrink-0"
              disabled={busy}
              onClick={onRemoveSetup}
              title={t.removeRuleTitle}
            >
              {t.remove}
            </Button>
          </div>
        )}
      </CardHeader>
      {/* mt-auto: cards in a row share one height; keep every footer at the bottom. */}
      <CardFooter className="mt-auto px-4">{action}</CardFooter>
    </Card>
  );
}

const isDbEngine = (id: string) => DB_ENGINES.some((e) => e.id === id);

export function ServicesPage() {
  /** The card list, or the page a card's gear opened. */
  const t = useT(messages);
  const cm = useT(common);
  const [view, setView] = useState<"list" | "nginx" | "php" | "dns" | "node" | "db" | "mail">("list");
  /** The server the Databases page opens on. */
  const [dbEngine, setDbEngine] = useState<DbEngine>("mariadb");
  const [services, setServices] = useState<Service[] | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const [progress, setProgress] = useState<Record<string, InstallProgress>>({});
  const installing = busy.size > 0 || Object.keys(progress).length > 0;

  // Install progress: checked once on open (an install may have started on an
  // earlier visit), then often while something is starting.
  useEffect(() => {
    const check = () => api.serviceProgress().then(setProgress).catch(() => {});
    check();
    if (!installing) return;
    const timer = setInterval(check, 400);
    return () => clearInterval(timer);
  }, [installing]);

  const refresh = useCallback(
    () =>
      api
        .listServices()
        .then(setServices)
        .catch((e) => {
          toast.error(String(e));
          setServices((prev) => prev ?? []);
        }),
    []
  );

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const mark = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Run one start/stop; returns false (after a toast) on failure. */
  const act = async (s: Service, start: boolean, quiet = false) => {
    mark(s.id, true);
    try {
      if (start) await api.startService(s.id);
      else await api.stopService(s.id);
      if (!quiet) toast.success(start ? t.runningOn(s.name, s.port) : t.stopped(s.name));
      return true;
    } catch (e) {
      toast.error(`${s.name}: ${e}`);
      return false;
    } finally {
      mark(s.id, false);
      refresh();
    }
  };

  const removeDns = async (s: Service) => {
    mark(s.id, true);
    try {
      await api.dnsRemove();
      toast.success(t.dnsRemoved);
    } catch (e) {
      toast.error(`DNS: ${e}`);
    } finally {
      mark(s.id, false);
      refresh();
    }
  };

  // Start/stop all: background processes only, not tools like Node.js.
  const core = services?.filter((s) => s.category === "core" && s.available && !s.tool) ?? [];

  const startAll = async () => {
    setBulk(true);
    // PHP listeners first, so nginx never proxies to a port nobody serves.
    const order = [...core.filter(isPhp), ...core.filter((s) => !isPhp(s))];
    let ok = 0;
    for (const s of order) {
      if (s.status === "running") ok++;
      else if (await act(s, true, true)) ok++;
    }
    if (ok === order.length) toast.success(t.coreRunning);
    setBulk(false);
  };

  const stopAll = async () => {
    setBulk(true);
    const order = [...core.filter((s) => !isPhp(s)), ...core.filter(isPhp)];
    for (const s of order) {
      if (s.status !== "stopped") await act(s, false, true);
    }
    toast.success(t.coreStopped);
    setBulk(false);
  };

  const back = () => {
    setView("list");
    refresh();
  };
  const backLabel = cm.nav.services;
  if (view === "nginx") return <NginxSettingsPage backLabel={backLabel} onBack={back} />;
  if (view === "php") return <PhpPage backLabel={backLabel} onBack={back} />;
  if (view === "dns") {
    return <DnsSettingsPage backLabel={backLabel} onBack={back} />;
  }
  if (view === "node") return <NodePage backLabel={backLabel} onBack={back} />;
  if (view === "db") return <DatabasesPage engine={dbEngine} backLabel={backLabel} onBack={back} />;
  if (view === "mail") return <MailpitSettingsPage backLabel={backLabel} onBack={back} />;

  return (
    <>
      <PageHeader
        title={cm.nav.services}
        description={t.description}
      />

      {services === null ? (
        <div className={GRID}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {CATS.map((c) => {
            const cat = t.cats[c.id];
            const list = services.filter((s) => s.category === c.id);
            const usable = list.filter((s) => s.available && !s.tool);
            const running = usable.filter((s) => s.status === "running").length;
            const isCore = c.id === "core";
            return (
              <section key={c.id} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon name={c.icon} className="text-muted-foreground" />
                  <h3 className="text-sm font-semibold">{cat.label}</h3>
                  {usable.length > 0 && (
                    <Badge
                      variant="outline"
                      className={cn(running > 0 && "border-success/40 text-success")}
                    >
                      {t.runningCount(running, usable.length)}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">{cat.hint}</span>
                  {isCore && usable.length > 0 && (
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" variant="outline" disabled={bulk || running === 0} onClick={stopAll}>
                        {t.stopAll}
                      </Button>
                      <Button size="sm" disabled={bulk || running === usable.length} onClick={startAll}>
                        {bulk && <Spinner />}
                        {t.startAll}
                      </Button>
                    </div>
                  )}
                </div>
                {isCore && !list.some(isPhp) && (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm">
                    <Icon name="php" variant="brands" className="text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {t.noPhp}
                    </span>
                    <Button size="sm" className="ml-auto" onClick={() => setView("php")}>
                      <Icon name="download" />
                      {t.installPhp}
                    </Button>
                  </div>
                )}
                <div className={GRID}>
                  {list.map((s) => (
                    <ServiceCard
                      key={s.id}
                      s={s}
                      busy={busy.has(s.id)}
                      progress={progress[s.id]}
                      onStart={() =>
                        // DNS without the Windows rule can't work yet: set it up first.
                        s.id === "dns" && s.setup ? setView("dns") : act(s, true)
                      }
                      onStop={() => act(s, false)}
                      onRemoveSetup={() => removeDns(s)}
                      onSettings={
                        s.id === "nginx"
                          ? () => setView("nginx")
                          : isPhp(s)
                            ? () => setView("php")
                            : s.id === "dns"
                              ? () => setView("dns")
                              : s.id === "node"
                                ? () => setView("node")
                                : isDbEngine(s.id)
                                  ? () => {
                                      setDbEngine(s.id as DbEngine);
                                      setView("db");
                                    }
                                  : s.id === "mailpit"
                                    ? () => setView("mail")
                                    : undefined
                      }
                      settingsLabel={
                        isPhp(s)
                          ? t.phpVersions
                          : s.id === "dns"
                            ? t.dnsSettings
                            : s.id === "node"
                              ? t.nodeVersions
                              : isDbEngine(s.id)
                                ? t.databases
                                : s.id === "mailpit"
                                  ? t.mailpitSettings
                                  : undefined
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
