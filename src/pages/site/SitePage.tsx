import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { BackButton } from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

const TAB_ICON: Record<SiteTab, string> = {
  overview: "gauge-high",
  data: "database",
  config: "sliders",
  logs: "scroll",
  tinker: "terminal",
  artisan: "wand-magic-sparkles",
  workers: "gears",
};

const messages = defineMessages({
  en: {
    back: "Sites",
    openInBrowser: "Open in browser",
    copy: "Copy address",
    copied: "Address copied",
    saveProject: "Save zefaro.json",
    saveProjectHint: "Writes this site's settings into its folder, so others can set it up the same way",
    savedProject: "Saved zefaro.json",
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
    copy: "Salin alamat",
    copied: "Alamat disalin",
    saveProject: "Simpan zefaro.json",
    saveProjectHint: "Menulis pengaturan situs ini ke foldernya, supaya orang lain bisa menyiapkannya dengan cara yang sama",
    savedProject: "zefaro.json disimpan",
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

/** The last overview of each site, so coming back to a site shows it at once while a fresh one loads. */
const overviewCache = new Map<string, Overview>();

export function SitePage({ name, onBack }: { name: string; onBack: () => void }) {
  const t = useT(messages);
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [overview, setOverview] = useState<Overview | null>(() => overviewCache.get(name) ?? null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [tab, setTab] = useState<SiteTab>("overview");
  const [tinkerDraft, setTinkerDraft] = useState<{ code: string; at: number } | null>(null);
  const [installJob, setInstallJob] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInfo = useCallback(() => api.siteInfo(name).then(setInfo).catch((e) => toast.error(String(e))), [name]);

  // Starting the app takes the longest, so only one load runs at a time.
  const overviewRun = useRef<Promise<void> | null>(null);
  const loadOverview = useCallback(() => {
    if (overviewRun.current) return overviewRun.current;
    setLoadingOverview(true);
    const run = (async () => {
      try {
        const fresh = await api.siteOverview(name);
        overviewCache.set(name, fresh);
        setOverview(fresh);
        setOverviewError(null);
      } catch (e) {
        overviewCache.delete(name);
        setOverview(null);
        setOverviewError(String(e));
      } finally {
        setLoadingOverview(false);
        overviewRun.current = null;
      }
    })();
    overviewRun.current = run;
    return run;
  }, [name]);

  // Both start at once. The overview doesn't wait to learn the folder is a Laravel
  // app: when it isn't, the overview fails fast and nothing shows it.
  useEffect(() => {
    loadInfo();
    loadOverview();
  }, [loadInfo, loadOverview]);

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
  const address = site.url.replace(/^https?:\/\//, "");
  const saveProject = () =>
    api
      .projectSave(name)
      .then((path) => toast.success(t.savedProject, { description: path }))
      .catch((e) => toast.error(String(e)));
  const copyAddress = () => {
    navigator.clipboard
      .writeText(site.url)
      .then(() => toast.success(t.copied))
      .catch((e) => toast.error(String(e)));
  };
  return (
    <>
      <BackButton label={t.back} onClick={onBack} />
      <Card className="mb-5 gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-xl text-primary">
            <Icon name={fw?.icon ?? "laravel"} variant={fw && !fw.brand ? "solid" : "brands"} className="w-auto" />
          </div>
          <div className="min-w-0 flex-1 basis-48 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">{site.name}</h2>
              {site.secured && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                  <Icon name="lock" className="w-3" />
                  HTTPS
                </span>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate text-sm text-foreground/80">{address}</span>
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" onClick={copyAddress} title={t.copy} aria-label={t.copy}>
                <Icon name="copy" className="w-3" />
              </Button>
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground" title={site.path}>
              {site.path}
            </p>
          </div>
          <div className="flex w-full shrink-0 gap-2 sm:w-auto">
            <Button size="lg" className="flex-1 sm:flex-none" onClick={() => openUrl(site.url)}>
              <Icon name="arrow-up-right-from-square" />
              {t.openInBrowser}
            </Button>
            <OpenBar site={name} className="flex-1 sm:flex-none" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-lg" variant="outline" aria-label={t.saveProject} onClick={saveProject}>
                  <Icon name="file-export" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-60">
                {t.saveProject}. {t.saveProjectHint}.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {site.proxy ? (
            <Badge variant="secondary">
              <Icon name="right-left" className="w-3" />
              localhost:{site.proxy}
            </Badge>
          ) : (
            info.php && (
              <Badge variant="secondary">
                <Icon name="php" variant="brands" className="w-3" />
                {overview?.php ?? info.php}
              </Badge>
            )
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
            <Badge variant={overview.environment === "production" ? "destructive" : "outline"}>{overview.environment}</Badge>
          )}
        </div>
      </Card>

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
          <Tabs value={tab} onValueChange={(v) => setTab(v as SiteTab)} className="gap-5">
            <TabsList
              variant="line"
              className="h-auto w-full max-w-full justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-none border-b p-0 [scrollbar-width:none] group-data-horizontal/tabs:h-auto [&::-webkit-scrollbar]:hidden"
            >
              {(Object.keys(t.tabs) as SiteTab[]).map((key) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="h-10 flex-none rounded-none px-3 text-sm group-data-horizontal/tabs:after:bottom-0 group-data-[variant=line]/tabs-list:after:bg-primary"
                >
                  <Icon name={TAB_ICON[key]} className="w-3.5 text-xs" />
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
