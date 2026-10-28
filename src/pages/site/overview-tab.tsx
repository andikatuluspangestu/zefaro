import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";
import { lastLine, runToEnd } from "./shared";
import type { SiteTab } from "./SitePage";
import type { Overview, SiteInfo } from "./types";

const messages = defineMessages({
  en: {
    reload: "Reload",
    loadFailed: "Zefaro couldn't start this app",
    application: "Application",
    drivers: "Drivers",
    status: "State",
    packages: "Packages",
    rows: {
      name: "Name",
      environment: "Environment",
      debug: "Debug mode",
      url: "App URL",
      timezone: "Timezone",
      locale: "Locale",
      database: "Database",
      cache: "Cache",
      session: "Sessions",
      queue: "Queue",
      mail: "Mail",
      filesystem: "Files",
      key: "App key",
      migrations: "Migrations",
      storage: "Storage link",
      caches: "Cached by artisan",
    },
    on: "On",
    off: "Off",
    set: "Set",
    notSet: "Not set",
    upToDate: "Up to date",
    pending: (n: number) => `${n} pending`,
    unknown: "Unknown",
    linked: "Linked",
    notLinked: "Not linked",
    nothingCached: "Nothing",
    maintenance: "In maintenance mode",
    warnings: "Worth a look",
    fix: {
      key: {
        title: "The app key isn't set",
        body: "Encrypted values and sessions need APP_KEY. Zefaro runs php artisan key:generate.",
        action: "Generate key",
        done: "App key generated",
      },
      dbDown: {
        title: "The database isn't reachable",
        body: (e: string) => `The app can't connect: ${e}`,
        mariadb: "MariaDB isn't running. Start it on the Services page, or here.",
        start: "Start MariaDB",
        started: "MariaDB started",
        postgres: "PostgreSQL isn't running. Start it on the Services page, or here.",
        startPostgres: "Start PostgreSQL",
        startedPostgres: "PostgreSQL started",
      },
      migrate: {
        title: (n: number) => `${n} ${n === 1 ? "migration hasn't" : "migrations haven't"} run yet`,
        body: "Tables the code expects may be missing. Zefaro runs php artisan migrate.",
        action: "Run migrations",
        done: "Migrations finished",
      },
      mail: {
        title: "Mail doesn't go to Mailpit",
        body: (mailer: string) =>
          `The app sends mail with "${mailer}", so Mailpit won't show it. Zefaro can set MAIL_MAILER, MAIL_HOST and MAIL_PORT in .env.`,
        action: "Point to Mailpit",
        done: "Mail now goes to Mailpit",
        notRunning: "Mailpit isn't running yet; start it on the Services page.",
      },
      storage: {
        title: "public/storage isn't linked",
        body: "Files saved on the public disk won't load in the browser. Zefaro runs php artisan storage:link.",
        action: "Link storage",
        done: "Storage linked",
      },
      debug: {
        title: "Debug mode is on in production",
        body: "APP_DEBUG=true shows stack traces and settings to anyone who triggers an error.",
        action: "Turn off debug",
        done: "Debug mode is off",
      },
      cached: {
        title: "Configuration is cached",
        body: "The app ignores .env until the cache is cleared. Zefaro runs php artisan config:clear.",
        action: "Clear cache",
        done: "Config cache cleared",
      },
      queue: {
        title: (driver: string) => `The queue uses "${driver}", but nothing processes it`,
        body: "Queued jobs wait until a worker runs. Add a queue worker on the Workers tab.",
        action: "Open Workers",
      },
    },
    failed: (what: string) => `${what} failed`,
    appUrl: {
      title: "APP_URL doesn't match the site's address",
      body: (now: string, site: string) => `.env says ${now || "nothing"}, but Zefaro serves the site at ${site}. Links, redirects and asset URLs the app builds point to the wrong place.`,
      action: (site: string) => `Set APP_URL to ${site}`,
      done: "APP_URL updated",
    },
  },
  id: {
    reload: "Muat ulang",
    loadFailed: "Zefaro tidak bisa menjalankan aplikasi ini",
    application: "Aplikasi",
    drivers: "Driver",
    status: "Kondisi",
    packages: "Paket",
    rows: {
      name: "Nama",
      environment: "Environment",
      debug: "Mode debug",
      url: "URL aplikasi",
      timezone: "Zona waktu",
      locale: "Bahasa",
      database: "Database",
      cache: "Cache",
      session: "Sesi",
      queue: "Antrean",
      mail: "Email",
      filesystem: "File",
      key: "App key",
      migrations: "Migrasi",
      storage: "Tautan storage",
      caches: "Di-cache artisan",
    },
    on: "Aktif",
    off: "Mati",
    set: "Terisi",
    notSet: "Kosong",
    upToDate: "Terbaru",
    pending: (n: number) => `${n} belum jalan`,
    unknown: "Tidak diketahui",
    linked: "Tertaut",
    notLinked: "Belum tertaut",
    nothingCached: "Tidak ada",
    maintenance: "Dalam mode pemeliharaan",
    warnings: "Perlu dilihat",
    fix: {
      key: {
        title: "App key belum diisi",
        body: "Nilai terenkripsi dan sesi butuh APP_KEY. Zefaro menjalankan php artisan key:generate.",
        action: "Buat key",
        done: "App key dibuat",
      },
      dbDown: {
        title: "Database tidak terjangkau",
        body: (e: string) => `Aplikasi tidak bisa terhubung: ${e}`,
        mariadb: "MariaDB belum berjalan. Mulai di halaman Layanan, atau di sini.",
        start: "Mulai MariaDB",
        started: "MariaDB dimulai",
        postgres: "PostgreSQL belum berjalan. Mulai di halaman Layanan, atau di sini.",
        startPostgres: "Mulai PostgreSQL",
        startedPostgres: "PostgreSQL dimulai",
      },
      migrate: {
        title: (n: number) => `${n} migrasi belum dijalankan`,
        body: "Tabel yang dibutuhkan kode mungkin belum ada. Zefaro menjalankan php artisan migrate.",
        action: "Jalankan migrasi",
        done: "Migrasi selesai",
      },
      mail: {
        title: "Email tidak masuk ke Mailpit",
        body: (mailer: string) =>
          `Aplikasi mengirim email lewat "${mailer}", jadi Mailpit tidak menampilkannya. Zefaro bisa mengisi MAIL_MAILER, MAIL_HOST dan MAIL_PORT di .env.`,
        action: "Arahkan ke Mailpit",
        done: "Email kini masuk ke Mailpit",
        notRunning: "Mailpit belum berjalan; mulai di halaman Layanan.",
      },
      storage: {
        title: "public/storage belum tertaut",
        body: "File di disk public tidak akan tampil di browser. Zefaro menjalankan php artisan storage:link.",
        action: "Tautkan storage",
        done: "Storage tertaut",
      },
      debug: {
        title: "Mode debug aktif di production",
        body: "APP_DEBUG=true menampilkan stack trace dan pengaturan ke siapa saja yang memicu error.",
        action: "Matikan debug",
        done: "Mode debug mati",
      },
      cached: {
        title: "Konfigurasi di-cache",
        body: "Aplikasi mengabaikan .env sampai cache dibersihkan. Zefaro menjalankan php artisan config:clear.",
        action: "Bersihkan cache",
        done: "Cache konfigurasi dibersihkan",
      },
      queue: {
        title: (driver: string) => `Antrean memakai "${driver}", tetapi tidak ada yang memprosesnya`,
        body: "Job antrean menunggu sampai worker berjalan. Tambahkan queue worker di tab Worker.",
        action: "Buka Worker",
      },
    },
    failed: (what: string) => `${what} gagal`,
    appUrl: {
      title: "APP_URL tidak sama dengan alamat situs",
      body: (now: string, site: string) => `.env berisi ${now || "kosong"}, padahal Zefaro menyajikan situs di ${site}. Tautan, redirect, dan URL aset buatan aplikasi mengarah ke tempat yang salah.`,
      action: (site: string) => `Isi APP_URL dengan ${site}`,
      done: "APP_URL diperbarui",
    },
  },
});

type Warning = { id: string; icon: string; title: string; body: ReactNode; action?: { label: string; run: () => Promise<void> } };

export function OverviewTab({
  info,
  overview,
  error,
  loading,
  onReload,
  onTab,
}: {
  info: SiteInfo;
  overview: Overview | null;
  error: string | null;
  loading: boolean;
  onReload: () => void;
  onTab: (tab: SiteTab) => void;
}) {
  const t = useT(messages);
  const c = useT(common);
  const [running, setRunning] = useState<string | null>(null);
  const site = info.site.name;

  if (error)
    return (
      <IconAlert
        icon="circle-exclamation"
        className="border-destructive/40 text-destructive *:data-[slot=alert-description]:text-muted-foreground"
        title={t.loadFailed}
        action={
          <Button size="sm" variant="outline" onClick={onReload}>
            {c.tryAgain}
          </Button>
        }
      >
        <span className="font-mono text-xs break-words whitespace-pre-wrap">{error}</span>
      </IconAlert>
    );
  if (!overview)
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );

  const artisan = (args: string[], done: string) => async () => {
    const { job, lines } = await runToEnd(site, "artisan", args);
    if (job.state !== "done") throw new Error(lastLine(lines) || t.failed(args[0]));
    toast.success(done);
  };
  const env = (values: [string, string][], done: string) => async () => {
    await api.siteEnvSet(site, values);
    toast.success(done);
  };

  const d = overview.drivers;
  const local = !d.databaseHost || ["127.0.0.1", "localhost", "::1"].includes(d.databaseHost);
  const mysqlLike = d.databaseDriver === "mysql" || d.databaseDriver === "mariadb";
  const warnings: Warning[] = [];

  const siteUrl = info.site.url;
  const trim = (u: string | null) => (u ?? "").replace(/\/+$/, "");
  if (trim(overview.url) !== trim(siteUrl))
    warnings.push({
      id: "appUrl",
      icon: "link-slash",
      title: t.appUrl.title,
      body: t.appUrl.body(overview.url ?? "", siteUrl),
      action: { label: t.appUrl.action(siteUrl), run: env([["APP_URL", siteUrl]], t.appUrl.done) },
    });

  if (!overview.keySet)
    warnings.push({ id: "key", icon: "key", title: t.fix.key.title, body: t.fix.key.body, action: { label: t.fix.key.action, run: artisan(["key:generate"], t.fix.key.done) } });

  if (!overview.database.connected) {
    const mariaDown = mysqlLike && local && !info.mariadbRunning;
    const pgDown = d.databaseDriver === "pgsql" && local && !info.postgresRunning;
    warnings.push({
      id: "db",
      icon: "database",
      title: t.fix.dbDown.title,
      body: (
        <>
          {t.fix.dbDown.body(overview.database.error ?? "")}
          {mariaDown && <span className="mt-1 block">{t.fix.dbDown.mariadb}</span>}
          {pgDown && <span className="mt-1 block">{t.fix.dbDown.postgres}</span>}
        </>
      ),
      action: mariaDown
        ? {
            label: t.fix.dbDown.start,
            run: async () => {
              await api.startService("mariadb");
              toast.success(t.fix.dbDown.started);
            },
          }
        : pgDown
          ? {
              label: t.fix.dbDown.startPostgres,
              run: async () => {
                await api.startService("postgresql");
                toast.success(t.fix.dbDown.startedPostgres);
              },
            }
          : undefined,
    });
  } else if (overview.pendingMigrations && overview.pendingMigrations.length > 0) {
    warnings.push({
      id: "migrate",
      icon: "table-list",
      title: t.fix.migrate.title(overview.pendingMigrations.length),
      body: t.fix.migrate.body,
      action: { label: t.fix.migrate.action, run: artisan(["migrate", "--force"], t.fix.migrate.done) },
    });
  }

  const pointsAtMailpit = d.mail === "smtp" && d.mailHost && ["127.0.0.1", "localhost"].includes(d.mailHost) && d.mailPort === String(info.mailpitSmtpPort);
  if (d.mail && d.mail !== "array" && !pointsAtMailpit)
    warnings.push({
      id: "mail",
      icon: "envelope",
      title: t.fix.mail.title,
      body: (
        <>
          {t.fix.mail.body(d.mail)}
          {!info.mailpitRunning && <span className="mt-1 block">{t.fix.mail.notRunning}</span>}
        </>
      ),
      action: {
        label: t.fix.mail.action,
        run: env(
          [
            ["MAIL_MAILER", "smtp"],
            ["MAIL_HOST", "127.0.0.1"],
            ["MAIL_PORT", String(info.mailpitSmtpPort)],
            ["MAIL_USERNAME", "null"],
            ["MAIL_PASSWORD", "null"],
          ],
          t.fix.mail.done,
        ),
      },
    });

  if (!overview.storageLinked && d.filesystem !== "s3")
    warnings.push({ id: "storage", icon: "link", title: t.fix.storage.title, body: t.fix.storage.body, action: { label: t.fix.storage.action, run: artisan(["storage:link"], t.fix.storage.done) } });

  if (overview.debug && overview.environment === "production")
    warnings.push({ id: "debug", icon: "bug", title: t.fix.debug.title, body: t.fix.debug.body, action: { label: t.fix.debug.action, run: env([["APP_DEBUG", "false"]], t.fix.debug.done) } });

  if (overview.configCached)
    warnings.push({ id: "cached", icon: "box-archive", title: t.fix.cached.title, body: t.fix.cached.body, action: { label: t.fix.cached.action, run: artisan(["config:clear"], t.fix.cached.done) } });

  if (d.queue && d.queue !== "sync" && d.queue !== "null")
    warnings.push({
      id: "queue",
      icon: "list-check",
      title: t.fix.queue.title(d.queue),
      body: t.fix.queue.body,
      action: { label: t.fix.queue.action, run: async () => onTab("workers") },
    });

  const run = async (w: Warning) => {
    if (!w.action) return;
    setRunning(w.id);
    try {
      await w.action.run();
      if (w.id !== "queue") onReload();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setRunning(null);
    }
  };

  const cached = [overview.configCached && "config", overview.routesCached && "routes", overview.eventsCached && "events"].filter(Boolean).join(", ");
  const dbLabel = [d.databaseDriver, d.databaseName && (d.databaseDriver === "sqlite" ? d.databaseName.split(/[\\/]/).pop() : d.databaseName)].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      {overview.maintenance && (
        <IconAlert icon="screwdriver-wrench" className="border-warning/40 text-warning" title={t.maintenance} />
      )}
      {warnings.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t.warnings}</h3>
          {warnings.map((w) => (
            <IconAlert
              key={w.id}
              icon={w.icon}
              className="border-warning/40 text-warning *:data-[slot=alert-description]:text-muted-foreground"
              title={w.title}
            >
              {w.body}
              {w.action && (
                <div className="mt-2">
                  <Button size="sm" variant="outline" disabled={running !== null} onClick={() => run(w)}>
                    {running === w.id ? <Spinner className="size-3" /> : null}
                    {w.action.label}
                  </Button>
                </div>
              )}
            </IconAlert>
          ))}
        </section>
      )}

      <div className="flex items-center justify-end">
        <Button size="sm" variant="ghost" onClick={onReload} disabled={loading}>
          {loading ? <Spinner className="size-3" /> : <Icon name="rotate" className="w-3" />}
          {t.reload}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Group title={t.application}>
          <Row label={t.rows.name} value={overview.name} />
          <Row label={t.rows.environment} value={overview.environment} />
          <Row label={t.rows.debug} value={overview.debug ? t.on : t.off} tone={overview.debug && overview.environment === "production" ? "warn" : undefined} />
          <Row label={t.rows.url} value={overview.url} mono />
          <Row label={t.rows.timezone} value={overview.timezone} />
          <Row label={t.rows.locale} value={overview.locale} />
        </Group>
        <Group title={t.drivers}>
          <Row label={t.rows.database} value={dbLabel} tone={overview.database.connected ? "ok" : "warn"} mono />
          <Row label={t.rows.cache} value={d.cache} />
          <Row label={t.rows.session} value={d.session} />
          <Row label={t.rows.queue} value={d.queue} />
          <Row label={t.rows.mail} value={d.mail} />
          <Row label={t.rows.filesystem} value={d.filesystem} />
        </Group>
        <Group title={t.status}>
          <Row label={t.rows.key} value={overview.keySet ? t.set : t.notSet} tone={overview.keySet ? "ok" : "warn"} />
          <Row
            label={t.rows.migrations}
            value={overview.pendingMigrations === null ? t.unknown : overview.pendingMigrations.length === 0 ? t.upToDate : t.pending(overview.pendingMigrations.length)}
            tone={overview.pendingMigrations && overview.pendingMigrations.length > 0 ? "warn" : undefined}
          />
          <Row label={t.rows.storage} value={overview.storageLinked ? t.linked : t.notLinked} />
          <Row label={t.rows.caches} value={cached || t.nothingCached} />
        </Group>
        <Group title={t.packages}>
          {(Object.entries(overview.packages) as [string, boolean][]).filter(([, on]) => on).length === 0 ? (
            <Row label="" value={c.none} />
          ) : (
            (Object.entries(overview.packages) as [string, boolean][])
              .filter(([, on]) => on)
              .map(([name]) => <Row key={name} label={name.charAt(0).toUpperCase() + name.slice(1)} value={t.on} />)
          )}
        </Group>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-0 py-0">
      <h3 className="border-b px-4 py-2.5 text-sm font-medium">{title}</h3>
      <dl className="divide-y">{children}</dl>
    </Card>
  );
}

function Row({ label, value, mono, tone }: { label: string; value: string | null | undefined; mono?: boolean; tone?: "ok" | "warn" }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`flex min-w-0 items-center gap-1.5 truncate text-right ${mono ? "font-mono text-xs" : ""} ${tone === "warn" ? "text-warning" : ""}`}
        title={value ?? undefined}
      >
        {tone === "ok" && <span className="size-1.5 shrink-0 rounded-full bg-success" />}
        <span className="truncate">{value || "-"}</span>
      </dd>
    </div>
  );
}
