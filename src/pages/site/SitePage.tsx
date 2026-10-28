import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { BackButton } from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { defineMessages, useT } from "@/i18n";
import { frameworkInfo } from "@/lib/frameworks";
import { JobConsole, runToEnd } from "./shared";
import { OverviewTab } from "./overview-tab";
import { DataTab } from "./data-tab";
import { ConfigTab } from "./config-tab";
import { TinkerTab } from "./tinker-tab";
import { ArtisanTab } from "./artisan-tab";
import { WorkersTab } from "./workers-tab";
import { LogsTab } from "./logs-tab";
import { OpenBar } from "./open-bar";
import type { Overview, SiteInfo } from "./types";

export type SiteTab = "overview" | "data" | "config" | "logs" | "tinker" | "artisan" | "workers";

const messages = defineMessages({
  en: {
    back: "Sites",
    openInBrowser: "Open in browser",
    tabs: {
      overview: "Overview",
      data: "Data",
      config: "Configuration",
      logs: "Logs",
      tinker: "Tinker",
      artisan: "Artisan",
      workers: "Workers",
    },
    notLaravel: {
      title: "This site isn't a Laravel app",
      body: "Zefaro's app tools need a Laravel project: its folder has no artisan file. The site is still served as usual.",
      detected: (name: string) => `Zefaro sees a ${name} project here. The app tools need Laravel; the site is still served as usual.`,
    },
    noPhp: {
      title: "No PHP installed",
      body: "Install a PHP version on the PHP page, then come back.",
    },
    noVendor: {
      title: "Dependencies aren't installed",
      body: "The vendor folder is missing, so Laravel can't start. Zefaro can run composer install in this folder.",
      run: "Run composer install",
      noComposer: "Install Composer on the PHP page first.",
    },
    noEnv: {
      title: "No .env file",
      body: "Laravel reads its settings from .env. Zefaro can copy .env.example to .env, then generate the app key.",
      run: "Create .env",
    },
    installed: "Dependencies installed",
    envCreated: "Created .env and generated the app key",
  },
  id: {
    back: "Situs",
    openInBrowser: "Buka di browser",
    tabs: {
      overview: "Ringkasan",
      data: "Data",
      config: "Konfigurasi",
      logs: "Log",
      tinker: "Tinker",
      artisan: "Artisan",
      workers: "Worker",
    },
    notLaravel: {
      title: "Situs ini bukan aplikasi Laravel",
      body: "Alat aplikasi Zefaro butuh proyek Laravel: foldernya tidak punya file artisan. Situs tetap disajikan seperti biasa.",
      detected: (name: string) => `Zefaro melihat proyek ${name} di sini. Alat aplikasi butuh Laravel; situs tetap disajikan seperti biasa.`,
    },
    noPhp: {
      title: "Belum ada PHP terpasang",
      body: "Pasang versi PHP di halaman PHP, lalu kembali ke sini.",
    },
    noVendor: {
      title: "Dependensi belum terpasang",
      body: "Folder vendor tidak ada, jadi Laravel tidak bisa berjalan. Zefaro bisa menjalankan composer install di folder ini.",
      run: "Jalankan composer install",
      noComposer: "Pasang Composer di halaman PHP terlebih dahulu.",
    },
    noEnv: {
      title: "Tidak ada file .env",
      body: "Laravel membaca pengaturannya dari .env. Zefaro bisa menyalin .env.example ke .env, lalu membuat app key.",
      run: "Buat .env",
    },
    installed: "Dependensi terpasang",
    envCreated: ".env dibuat dan app key dibuat",
  },
});

export function SitePage({ name, onBack }: { name: string; onBack: () => void }) {
  const t = useT(messages);
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [tab, setTab] = useState<SiteTab>("overview");
  const [tinkerDraft, setTinkerDraft] = useState<{ code: string; at: number } | null>(null);
  const [installJob, setInstallJob] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInfo = useCallback(() => api.siteInfo(name).then(setInfo).catch((e) => toast.error(String(e))), [name]);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      setOverview(await api.siteOverview(name));
      setOverviewError(null);
    } catch (e) {
      setOverview(null);
      setOverviewError(String(e));
    } finally {
      setLoadingOverview(false);
    }
  }, [name]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const ready = !!info && info.isLaravel && info.hasVendor && !!info.php;
  useEffect(() => {
    if (ready) loadOverview();
  }, [ready, loadOverview]);

  const openInTinker = (code: string) => {
    setTinkerDraft({ code, at: Date.now() });
    setTab("tinker");
  };

  const composerInstall = async () => {
    try {
      const job = await api.siteJobRun(name, "composer", ["install"]);
      setInstallJob(job.id);
      // Wait for it, then look again.
      for (;;) {
        const out = await api.siteJobOutput(job.id, Number.MAX_SAFE_INTEGER);
        if (!out || out.job.state !== "running") {
          if (out?.job.state === "done") toast.success(t.installed);
          break;
        }
        await new Promise((r) => window.setTimeout(r, 1000));
      }
      loadInfo();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const createEnv = async () => {
    setBusy(true);
    try {
      await api.siteEnvSet(name, []);
      const { job } = await runToEnd(name, "artisan", ["key:generate"]);
      if (job.state === "done") toast.success(t.envCreated);
      await loadInfo();
      loadOverview();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!info) {
    return (
      <>
        <BackButton label={t.back} onClick={onBack} />
        <Skeleton className="mb-2 h-7 w-48" />
        <Skeleton className="mb-6 h-4 w-80" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }

  const site = info.site;
  const fw = frameworkInfo(site.framework);
  return (
    <>
      <BackButton label={t.back} onClick={onBack} />
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {site.secured && <Icon name="lock" className="w-3.5 text-sm text-success" />}
            {site.name}
          </h2>
          <p className="truncate font-mono text-xs text-muted-foreground" title={site.path}>
            {site.path}
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {info.php && (
              <Badge variant="secondary">
                <Icon name="php" variant="brands" className="w-3" />
                {overview?.php ?? info.php}
              </Badge>
            )}
            {overview ? (
              <Badge variant="secondary">
                <Icon name={fw?.icon ?? "laravel"} variant={fw && !fw.brand ? "solid" : "brands"} className="w-3" />
                {fw && fw.name !== "Laravel" ? `${fw.name} · ` : ""}Laravel {overview.laravel}
              </Badge>
            ) : (
              fw &&
              !info.isLaravel && (
                <Badge variant="secondary">
                  <Icon name={fw.icon} variant={fw.brand ? "brands" : "solid"} className="w-3" />
                  {fw.name}
                </Badge>
              )
            )}
            {overview && (
              <Badge variant={overview.environment === "production" ? "destructive" : "outline"}>
                {overview.environment}
              </Badge>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={() => openUrl(site.url)}>
          <Icon name="arrow-up-right-from-square" />
          {t.openInBrowser}
        </Button>
      </div>

      <OpenBar site={name} />

      {!info.isLaravel ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name={fw?.icon ?? "laravel"} variant={fw && !fw.brand ? "solid" : "brands"} />
            </EmptyMedia>
            <EmptyTitle>{t.notLaravel.title}</EmptyTitle>
            <EmptyDescription>
              {fw && fw.name !== "PHP" && fw.name !== "HTML" ? t.notLaravel.detected(fw.name) : t.notLaravel.body}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !info.php ? (
        <IconAlert icon="triangle-exclamation" className="border-warning/40 text-warning *:data-[slot=alert-description]:text-muted-foreground" title={t.noPhp.title}>
          {t.noPhp.body}
        </IconAlert>
      ) : !info.hasVendor ? (
        <div className="space-y-3">
          <IconAlert
            icon="box-open"
            className="border-warning/40 text-warning *:data-[slot=alert-description]:text-muted-foreground"
            title={t.noVendor.title}
          >
            {t.noVendor.body}
            <div className="mt-2">
              {info.composerInstalled ? (
                <Button size="sm" onClick={composerInstall} disabled={installJob !== null}>
                  <Icon name="download" />
                  {t.noVendor.run}
                </Button>
              ) : (
                t.noVendor.noComposer
              )}
            </div>
          </IconAlert>
          {installJob !== null && <JobConsole jobId={installJob} />}
        </div>
      ) : (
        <>
          {!info.hasEnv && (
            <IconAlert
              icon="file-circle-exclamation"
              className="mb-4 border-warning/40 text-warning *:data-[slot=alert-description]:text-muted-foreground"
              title={t.noEnv.title}
            >
              {t.noEnv.body}
              <div className="mt-2">
                <Button size="sm" onClick={createEnv} disabled={busy}>
                  <Icon name="file-circle-plus" />
                  {t.noEnv.run}
                </Button>
              </div>
            </IconAlert>
          )}
          <Tabs value={tab} onValueChange={(v) => setTab(v as SiteTab)} className="gap-4">
            <TabsList className="max-w-full overflow-x-auto overflow-y-hidden">
              {(Object.keys(t.tabs) as SiteTab[]).map((key) => (
                <TabsTrigger key={key} value={key}>
                  {t.tabs[key]}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="overview">
              <OverviewTab
                info={info}
                overview={overview}
                error={overviewError}
                loading={loadingOverview}
                onReload={() => {
                  loadInfo();
                  loadOverview();
                }}
                onTab={setTab}
              />
            </TabsContent>
            <TabsContent value="data">
              <DataTab site={name} overview={overview} onOpenInTinker={openInTinker} />
            </TabsContent>
            <TabsContent value="config">
              <ConfigTab site={name} onChanged={loadOverview} />
            </TabsContent>
            <TabsContent value="logs">
              <LogsTab site={name} />
            </TabsContent>
            {/* Mounted while hidden, so the session's history survives switching tabs. */}
            <TabsContent value="tinker" forceMount className="data-[state=inactive]:hidden">
              <TinkerTab site={name} draft={tinkerDraft} environment={overview?.environment ?? null} />
            </TabsContent>
            <TabsContent value="artisan" forceMount className="data-[state=inactive]:hidden">
              <ArtisanTab site={name} environment={overview?.environment ?? null} />
            </TabsContent>
            <TabsContent value="workers">
              <WorkersTab site={name} overview={overview} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  );
}
