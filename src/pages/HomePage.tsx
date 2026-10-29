import { useCallback, useEffect, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import type { Intent, PageId } from "@/App";
import type { DnsSettingsView, Service, Site } from "@/types";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { useCaStatus } from "@/components/https-trust";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { frameworkInfo } from "@/lib/frameworks";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";

const messages = defineMessages({
  en: {
    description: "Your local PHP environment at a glance.",
    newSite: "New site",
    stats: {
      services: "Services",
      servicesValue: (running: number, total: number) => `${running} of ${total} running`,
      sites: "Sites",
      sitesValue: (n: number) => (n === 1 ? "1 site" : `${n} sites`),
      php: "PHP",
      phpNone: "Not installed",
      domain: "Local domain",
    },
    sites: {
      title: "Your sites",
      all: "All sites",
      emptyTitle: "No sites yet",
      emptyText: "Make a new Laravel site, or link a project folder.",
      open: "Open in browser",
      link: "Link folder",
    },
    setup: {
      title: "Get started",
      description: "Four steps and your first site is live.",
      steps: {
        php: { title: "Install PHP", text: "Pick a PHP version on the Services page.", action: "Services" },
        start: { title: "Start the services", text: "nginx and PHP are what serve your sites. Start them on the Services page.", action: "Services" },
        dns: { title: "Set up the .test domain", text: "One Windows rule, with one administrator prompt.", action: "Set up" },
        site: { title: "Add your first site", text: "Create a Laravel app, or link a folder you already have.", action: "New site" },
      },
    },
    attention: {
      title: "Needs attention",
      ok: "Nothing needs your attention.",
      failed: (name: string) => `${name} failed to start`,
      failedText: "Open Services to see why.",
      dns: (tld: string) => `Windows doesn't send .${tld} to Zefaro yet`,
      dnsText: "Without the DNS rule, site addresses won't open in a browser.",
      dnsAction: "Set up",
      trust: "Your browser doesn't trust Zefaro's certificate yet",
      trustText: "HTTPS sites show a warning until you trust it.",
      trustAction: "Open Sites",
      path: "Zefaro's folder isn't on PATH",
      pathText: "php and composer won't work in a terminal until it is.",
      pathAction: "Open Services",
      services: "Services",
    },
  },
  id: {
    description: "Ringkasan lingkungan PHP lokal Anda.",
    newSite: "Situs baru",
    stats: {
      services: "Layanan",
      servicesValue: (running: number, total: number) => `${running} dari ${total} berjalan`,
      sites: "Situs",
      sitesValue: (n: number) => `${n} situs`,
      php: "PHP",
      phpNone: "Belum terpasang",
      domain: "Domain lokal",
    },
    sites: {
      title: "Situs Anda",
      all: "Semua situs",
      emptyTitle: "Belum ada situs",
      emptyText: "Buat situs Laravel baru, atau tautkan folder proyek.",
      open: "Buka di browser",
      link: "Tautkan folder",
    },
    setup: {
      title: "Mulai di sini",
      description: "Empat langkah, lalu situs pertama Anda sudah jalan.",
      steps: {
        php: { title: "Pasang PHP", text: "Pilih versi PHP di halaman Layanan.", action: "Layanan" },
        start: { title: "Jalankan layanan", text: "nginx dan PHP yang menyajikan situs Anda. Jalankan di halaman Layanan.", action: "Layanan" },
        dns: { title: "Siapkan domain .test", text: "Satu aturan Windows, dengan satu permintaan hak administrator.", action: "Siapkan" },
        site: { title: "Tambahkan situs pertama", text: "Buat aplikasi Laravel, atau tautkan folder yang sudah ada.", action: "Situs baru" },
      },
    },
    attention: {
      title: "Perlu perhatian",
      ok: "Tidak ada yang perlu Anda tangani.",
      failed: (name: string) => `${name} gagal dimulai`,
      failedText: "Buka Layanan untuk melihat penyebabnya.",
      dns: (tld: string) => `Windows belum mengarahkan .${tld} ke Zefaro`,
      dnsText: "Tanpa aturan DNS, alamat situs tidak bisa dibuka di browser.",
      dnsAction: "Siapkan",
      trust: "Browser Anda belum mempercayai sertifikat Zefaro",
      trustText: "Situs HTTPS menampilkan peringatan sampai sertifikatnya dipercaya.",
      trustAction: "Buka Situs",
      path: "Folder Zefaro belum ada di PATH",
      pathText: "php dan composer belum bisa dipakai di terminal sebelum itu.",
      pathAction: "Buka Layanan",
      services: "Layanan",
    },
  },
});

type Snapshot = {
  sites: Site[];
  services: Service[];
  activePhp: string | null;
  /** Null until the PATH check, which asks PowerShell, has answered. */
  binOnPath: boolean | null;
  dns: DnsSettingsView | null;
};

/** What needs doing, in the order it should be done. */
type Step = { id: "php" | "start" | "dns" | "site"; icon: string; done: boolean; go: () => void };

type Attention = { key: string; title: string; text: string; action: string; go: () => void };

function Tile({ icon, brand, label, children }: { icon: string; brand?: boolean; label: string; children: ReactNode }) {
  return (
    <Card size="sm" className="flex-row items-center gap-3 px-(--card-spacing)">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary dark:text-info">
        <Icon name={icon} variant={brand ? "brands" : "solid"} className="text-base" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate font-medium">{children}</div>
      </div>
    </Card>
  );
}

export function HomePage({ onNavigate }: { onNavigate: (page: PageId, intent?: Intent) => void }) {
  const t = useT(messages);
  const c = useT(common);
  const ca = useCaStatus();
  const [data, setData] = useState<Snapshot | null>(null);

  const load = useCallback(async () => {
    try {
      // All four answer quickly, so the page doesn't wait on one after another.
      const [sites, services, activePhp, dns] = await Promise.all([
        api.listSites(),
        api.listServices(),
        api.toolsActivePhp().catch(() => null),
        api.dnsSettings().catch(() => null),
      ]);
      setData((prev) => ({ sites, services, activePhp, dns, binOnPath: prev?.binOnPath ?? null }));
    } catch (e) {
      toast.error(String(e));
      setData((prev) => prev ?? { sites: [], services: [], activePhp: null, binOnPath: null, dns: null });
    }
    // The PATH check starts PowerShell; it fills in once the page is already up.
    api
      .toolsBinOnPath()
      .then((binOnPath) => setData((prev) => (prev ? { ...prev, binOnPath } : prev)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("zefaro:refresh", load);
    // Services start and stop in the background; keep their state current.
    const timer = window.setInterval(() => {
      api
        .listServices()
        .then((services) => setData((prev) => (prev ? { ...prev, services } : prev)))
        .catch(() => {});
    }, 4000);
    return () => {
      window.removeEventListener("zefaro:refresh", load);
      window.clearInterval(timer);
    };
  }, [load]);

  const header = (
    <PageHeader
      title={c.nav.home}
      description={t.description}
      actions={
        data && (
          <Button onClick={() => onNavigate("sites", { type: "new-site" })}>
            <Icon name="plus" />
            {t.newSite}
          </Button>
        )
      }
    />
  );

  if (!data) {
    return (
      <>
        {header}
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[68px] rounded-xl" />
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </>
    );
  }

  const { sites, services, activePhp, binOnPath, dns } = data;
  const usable = services.filter((s) => s.available && !s.tool);
  const running = usable.filter((s) => s.status === "running").length;
  const core = usable.filter((s) => s.category === "core");
  const tld = dns?.tld ?? "test";

  const steps: Step[] = [
    { id: "php", icon: "php", done: !!activePhp, go: () => onNavigate("services") },
    { id: "start", icon: "play", done: core.some((s) => s.status === "running"), go: () => onNavigate("services") },
    { id: "dns", icon: "globe", done: dns?.ruleInstalled !== false, go: () => onNavigate("services") },
    { id: "site", icon: "folder-plus", done: sites.length > 0, go: () => onNavigate("sites", { type: "new-site" }) },
  ];
  const showSetup = steps.some((s) => !s.done) && sites.length === 0;

  const attention: Attention[] = [];
  for (const s of usable.filter((s) => s.status === "error")) {
    attention.push({
      key: `failed-${s.id}`,
      title: t.attention.failed(s.name),
      text: s.error ?? t.attention.failedText,
      action: t.attention.services,
      go: () => onNavigate("services"),
    });
  }
  if (!showSetup && dns?.ruleInstalled === false) {
    attention.push({
      key: "dns",
      title: t.attention.dns(tld),
      text: t.attention.dnsText,
      action: t.attention.dnsAction,
      go: () => onNavigate("services"),
    });
  }
  if (sites.some((s) => s.secured) && ca?.created && !ca.trusted) {
    attention.push({
      key: "trust",
      title: t.attention.trust,
      text: t.attention.trustText,
      action: t.attention.trustAction,
      go: () => onNavigate("sites"),
    });
  }
  if (activePhp && binOnPath === false) {
    attention.push({
      key: "path",
      title: t.attention.path,
      text: t.attention.pathText,
      action: t.attention.pathAction,
      go: () => onNavigate("services"),
    });
  }

  return (
    <>
      {header}

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile icon="server" label={t.stats.services}>
          {t.stats.servicesValue(running, usable.length)}
        </Tile>
        <Tile icon="globe" label={t.stats.sites}>
          {t.stats.sitesValue(sites.length)}
        </Tile>
        <Tile icon="php" brand label={t.stats.php}>
          {activePhp ? `PHP ${activePhp}` : t.stats.phpNone}
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">*.{tld}</span>
        </Tile>
      </div>

      {showSetup && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{t.setup.title}</CardTitle>
            <CardDescription>{t.setup.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="divide-y">
              {steps.map((s, i) => {
                const copy = t.setup.steps[s.id];
                return (
                  <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span
                      className={
                        s.done
                          ? "grid size-8 shrink-0 place-items-center rounded-full bg-success/15 text-success"
                          : "grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
                      }
                    >
                      {s.done ? <Icon name="check" /> : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={s.done ? "font-medium text-muted-foreground line-through" : "font-medium"}>{copy.title}</div>
                      <div className="text-sm text-muted-foreground">{copy.text}</div>
                    </div>
                    {!s.done && (
                      <Button size="sm" variant={steps.find((x) => !x.done) === s ? "default" : "outline"} onClick={s.go}>
                        {copy.action}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>{t.sites.title}</CardTitle>
            {sites.length > 0 && (
              <CardAction>
                <Button size="sm" variant="ghost" onClick={() => onNavigate("sites")}>
                  {t.sites.all}
                  <Icon name="arrow-right" />
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {sites.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <span className="grid size-10 place-items-center rounded-xl bg-accent text-primary dark:text-info">
                  <Icon name="globe" className="text-base" />
                </span>
                <div>
                  <div className="font-medium">{t.sites.emptyTitle}</div>
                  <div className="text-sm text-muted-foreground">{t.sites.emptyText}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onNavigate("sites")}>
                    <Icon name="folder-plus" />
                    {t.sites.link}
                  </Button>
                  <Button size="sm" onClick={() => onNavigate("sites", { type: "new-site" })}>
                    <Icon name="plus" />
                    {t.newSite}
                  </Button>
                </div>
              </div>
            ) : (
              <ul className="-my-1.5">
                {sites.slice(0, 6).map((s) => {
                  const fw = frameworkInfo(s.framework);
                  return (
                    <li key={s.name} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onNavigate("sites", { type: "open-site", name: s.name })}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" title={fw?.name}>
                          <Icon name={fw?.icon ?? "globe"} variant={fw?.brand ? "brands" : "solid"} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{s.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{s.url}</span>
                        </span>
                      </button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t.sites.open}
                        title={t.sites.open}
                        onClick={() => openUrl(s.url).catch((e) => toast.error(String(e)))}
                      >
                        <Icon name="up-right-from-square" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {(!showSetup || attention.length > 0) && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{t.attention.title}</CardTitle>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="circle-check" className="text-success" />
                {t.attention.ok}
              </div>
            ) : (
              <ul className="space-y-2">
                {attention.map((a) => (
                  <li key={a.key} className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2.5">
                    <Icon name="triangle-exclamation" className="text-warning" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{a.title}</div>
                      <div className="truncate text-sm text-muted-foreground">{a.text}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={a.go}>
                      {a.action}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
