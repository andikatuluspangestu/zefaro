import { useCallback, useEffect, useState } from "react";
import { api } from "@/api";
import type { AppInfo } from "@/types";
import { AppSidebar } from "@/components/app-sidebar";
import { Icon } from "@/components/icon";
import { StatusDot } from "@/components/status-dot";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { CloseDialog } from "@/components/close-dialog";
import { useStartupUpdateCheck } from "@/components/update-check";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HomePage } from "@/pages/HomePage";
import { SitesPage } from "@/pages/SitesPage";
import { ServicesPage } from "@/pages/ServicesPage";
import { MailPage } from "@/pages/MailPage";
import { LogsPage } from "@/pages/LogsPage";
import { DumpsPage } from "@/pages/DumpsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { AboutPage } from "@/pages/AboutPage";
import { DocsPage } from "@/pages/docs/DocsPage";
import { DoctorPage } from "@/pages/DoctorPage";
import { ThemeProvider } from "@/theme";
import { LANG_SETTINGS, LangProvider, cacheSetting, cachedSetting, resolveLang, useT, type LangSetting } from "@/i18n";
import { common } from "@/i18n/common";
import { toast } from "sonner";

export type PageId =
  | "home"
  | "sites"
  | "services"
  | "mail"
  | "logs"
  | "dumps"
  | "settings"
  | "docs"
  | "doctor"
  | "about";

/** What a page should do when another page sends the user to it. */
export type Intent = { type: "new-site" } | { type: "open-site"; name: string } | { type: "import" };

/** Holds the interface language: the saved setting, and what it resolves to. */
export default function App() {
  const [setting, setSetting] = useState<LangSetting>(cachedSetting);
  // Don't report a language to the backend until its saved setting has loaded,
  // or a stale cached value could overwrite it.
  const [loaded, setLoaded] = useState(false);
  const lang = resolveLang(setting);

  useEffect(() => {
    api
      .appInfo()
      .then((i) => LANG_SETTINGS.includes(i.language as LangSetting) && setSetting(i.language as LangSetting))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    cacheSetting(setting);
    if (loaded) api.setLanguage(setting, lang).catch(() => {});
  }, [setting, lang, loaded]);

  return (
    <LangProvider value={{ lang, setting, setSetting }}>
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </LangProvider>
  );
}

function Shell() {
  const t = useT(common);
  const [page, setPage] = useState<PageId>("home");
  const [intent, setIntent] = useState<Intent | null>(null);
  const go = useCallback((id: PageId, next?: Intent) => {
    setIntent(next ?? null);
    setPage(id);
  }, []);
  const clearIntent = useCallback(() => setIntent(null), []);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [summary, setSummary] = useState({ sites: 0, running: 0, total: 0 });
  const [unreadMail, setUnreadMail] = useState(0);

  // Unread mail for the sidebar badge (0 while Mailpit isn't running), and
  // whether settings are waiting for config.json to be free.
  useEffect(() => {
    const check = () => {
      api
        .mailList("", 0, 1)
        .then((p) => setUnreadMail(p.unread))
        .catch(() => setUnreadMail(0));
      api
        .configPending()
        .then((pending) =>
          pending
            ? toast.warning(t.configPending.title, { id: "config-pending", description: t.configPending.body, duration: Infinity })
            : toast.dismiss("config-pending"),
        )
        .catch(() => {});
    };
    check();
    const timer = window.setInterval(check, 5000);
    window.addEventListener("zefaro:refresh", check);
    window.addEventListener("zefaro:mail", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("zefaro:refresh", check);
      window.removeEventListener("zefaro:mail", check);
    };
  }, [t]);

  const loadSummary = useCallback(async () => {
    try {
      const [sites, services] = await Promise.all([api.listSites(), api.listServices()]);
      const usable = services.filter((s) => s.available && !s.tool);
      setSummary({
        sites: sites.length,
        running: usable.filter((s) => s.status === "running").length,
        total: usable.length,
      });
    } catch {
      /* ignore — backend may still be starting */
    }
  }, []);

  useEffect(() => {
    api.appInfo().then(setInfo).catch(() => {});
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    const h = () => loadSummary();
    window.addEventListener("zefaro:refresh", h);
    return () => window.removeEventListener("zefaro:refresh", h);
  }, [loadSummary]);

  const update = useStartupUpdateCheck(info);

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          active={page}
          onSelect={go}
          version={info?.version}
          newVersion={update?.newer ? update.latest : undefined}
          badges={{ mail: unreadMail }}
        />
        <SidebarInset className="h-svh overflow-hidden">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
            <span className="text-sm font-medium">{t.nav[page]}</span>
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="outline">
                <Icon name="globe" className="w-3" />
                {t.header.sites(summary.sites)}
              </Badge>
              <Badge variant="outline">
                <StatusDot status={summary.running ? "running" : "stopped"} />
                {t.header.running(summary.running, summary.total)}
              </Badge>
              <Badge variant="secondary" className="font-mono">
                *.{info?.tld ?? "test"}
              </Badge>
            </div>
          </header>
          {/* SidebarInset is already the page's <main>; this is just its scroll area. */}
          <div data-scroll-root className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-5xl p-6">
              {page === "home" && <HomePage onNavigate={go} />}
              {page === "sites" && <SitesPage intent={intent} onIntentDone={clearIntent} />}
              {page === "services" && <ServicesPage />}
              {page === "mail" && <MailPage />}
              {page === "logs" && <LogsPage />}
              {page === "dumps" && <DumpsPage />}
              {page === "settings" && <SettingsPage info={info} />}
              {page === "docs" && <DocsPage onNavigate={go} />}
              {page === "doctor" && <DoctorPage onNavigate={go} />}
              {page === "about" && <AboutPage info={info} onNavigate={go} />}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
      <Toaster position="bottom-right" />
      <CloseDialog />
    </TooltipProvider>
  );
}
