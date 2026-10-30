import { useEffect, useState } from "react";
import type { AppInfo, CaStatus, Service, UpdateInfo } from "@/types";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { BackupGroup } from "@/components/backup-card";
import { TrustCaButton, UntrustCaButton, useCaStatus } from "@/components/https-trust";
import { PageHeader } from "@/components/page-header";
import { SettingGroup, SettingRow } from "@/components/settings-layout";
import { announceUpdate, openUpdateDialog, updateMessages } from "@/components/update-check";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { THEME_SETTINGS, useTheme, type ThemeSetting } from "@/theme";
import { LANG_SETTINGS, defineMessages, localeOf, resolveLang, useLang, useT, type LangSetting } from "@/i18n";

// One layout with the other settings pages (DESIGN.md): titled groups of rows,
// each row an icon, its name, at most one short line on what it does, and its
// control on the right. Three tabs, so each part fits without scrolling.

/** Each language's name, written in that language. */
const LANGUAGE_NAMES = { en: "English", id: "Bahasa Indonesia" } as const;

/** "a, b and c". */
function list(items: string[], and: string) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

/** The services that can start with Zefaro, in the order they are listed. */
const STARTABLE = ["nginx", "mariadb", "mysql", "postgresql", "redis", "mailpit", "dns"];

type SettingsTab = "general" | "updates" | "system";
const TAB_ICON: Record<SettingsTab, string> = { general: "sliders", updates: "box-archive", system: "lock" };
/** The tab last open, so coming back to Settings lands where you left. */
let lastTab: SettingsTab = "general";

const messages = defineMessages({
  en: {
    title: "Settings",
    tabs: { general: "General", updates: "Updates and backup", system: "HTTPS and system" },
    needsAttention: "Needs attention",
    interface: {
      title: "Appearance",
      language: "Language",
      system: (name: string) => `Same as Windows (${name})`,
      theme: "Theme",
      options: { system: "Same as Windows", light: "Light", dark: "Dark" },
    },
    running: {
      title: "Startup",
      windows: "Start with Windows",
      windowsHint: "Opens hidden in the system tray.",
      tray: "Keep running when closed",
      trayOn: "Closing hides Zefaro in the tray.",
      trayOff: "Closing quits Zefaro and stops every service.",
      services: "Start services with Zefaro",
      servicesOn: (names: string[]) => `${list(names, "and")} start when Zefaro opens.`,
      servicesNone: "Installed services start when Zefaro opens; none is installed yet.",
      servicesFailed: (e: string) => `Zefaro couldn't read the services: ${e}`,
    },
    updates: {
      title: "Updates",
      current: (v: string) => `Zefaro ${v}`,
      latest: "Up to date.",
      youHave: (v: string) => `You have ${v}.`,
      check: "Check now",
      download: "Download",
      onStart: "Check on startup",
    },
    https: {
      title: "HTTPS",
      authority: "Certificate authority",
      notCreated: "Created when you secure a site.",
      trusted: "Trusted: browsers accept your sites.",
      notTrusted: "Not trusted: browsers warn on secured sites.",
      signsFor: (tld: string) => (
        <>
          Signs for <span className="font-mono">*.{tld}</span> only
        </>
      ),
      validUntil: (date: string) => `Valid until ${date}.`,
      showFile: "Show file",
    },
    computer: {
      title: "This computer",
      domain: "Local domain",
      domainHint: "Change it in DNS settings.",
      folder: "Config folder",
      copy: "Copy path",
      copied: "Path copied",
      copyFailed: "Couldn't copy to the clipboard",
    },
  },
  id: {
    title: "Pengaturan",
    tabs: { general: "Umum", updates: "Pembaruan dan cadangan", system: "HTTPS dan sistem" },
    needsAttention: "Perlu perhatian",
    interface: {
      title: "Tampilan",
      language: "Bahasa",
      system: (name: string) => `Ikuti Windows (${name})`,
      theme: "Tema",
      options: { system: "Ikuti Windows", light: "Terang", dark: "Gelap" },
    },
    running: {
      title: "Memulai",
      windows: "Mulai bersama Windows",
      windowsHint: "Terbuka tersembunyi di system tray.",
      tray: "Tetap berjalan saat ditutup",
      trayOn: "Menutup jendela menyembunyikan Zefaro di tray.",
      trayOff: "Menutup jendela mengakhiri Zefaro dan menghentikan semua layanan.",
      services: "Mulai layanan bersama Zefaro",
      servicesOn: (names: string[]) => `${list(names, "dan")} dimulai saat Zefaro terbuka.`,
      servicesNone: "Layanan yang terpasang dimulai saat Zefaro terbuka; belum ada yang terpasang.",
      servicesFailed: (e: string) => `Zefaro tidak bisa membaca daftar layanan: ${e}`,
    },
    updates: {
      title: "Pembaruan",
      current: (v: string) => `Zefaro ${v}`,
      latest: "Sudah versi terbaru.",
      youHave: (v: string) => `Versi Anda ${v}.`,
      check: "Periksa sekarang",
      download: "Unduh",
      onStart: "Periksa saat dimulai",
    },
    https: {
      title: "HTTPS",
      authority: "Otoritas sertifikat",
      notCreated: "Dibuat saat Anda mengamankan situs.",
      trusted: "Dipercaya: browser menerima situs Anda.",
      notTrusted: "Belum dipercaya: browser memberi peringatan di situs aman.",
      signsFor: (tld: string) => (
        <>
          Hanya menandatangani <span className="font-mono">*.{tld}</span>
        </>
      ),
      validUntil: (date: string) => `Berlaku sampai ${date}.`,
      showFile: "Tampilkan file",
    },
    computer: {
      title: "Komputer ini",
      domain: "Domain lokal",
      domainHint: "Ganti di pengaturan DNS.",
      folder: "Folder konfigurasi",
      copy: "Salin jalur",
      copied: "Jalur disalin",
      copyFailed: "Gagal menyalin ke clipboard",
    },
  },
});

/** Stands in for a control while its value is loading. */
const Pending = () => <Skeleton className="h-8 w-28" />;

/** Stands in for a line of text while loading; a span, so it can sit inside a paragraph. */
const TextPending = ({ className }: { className: string }) => (
  <span aria-hidden className={`inline-block h-3 animate-pulse rounded-md bg-muted align-middle ${className}`} />
);

/** A setting saved as soon as it changes, and put back if saving fails. null while loading. */
function useSaved(value: boolean | null | undefined, save: (on: boolean) => Promise<unknown>) {
  const [on, setOn] = useState<boolean | null>(value ?? null);
  useEffect(() => setOn(value ?? null), [value]);
  const change = (v: boolean) => {
    setOn(v);
    save(v).catch((e) => {
      setOn(!v);
      toast.error(String(e));
    });
  };
  return [on, change] as const;
}

function SavedSwitch({ on, change, label }: { on: boolean | null; change: (v: boolean) => void; label: string }) {
  return on === null ? <Pending /> : <Switch checked={on} onCheckedChange={change} aria-label={label} />;
}

function InterfaceGroup() {
  const t = useT(messages).interface;
  const lang = useLang();
  const theme = useTheme();
  const langLabel = (s: LangSetting) => (s === "system" ? t.system(LANGUAGE_NAMES[resolveLang("system")]) : LANGUAGE_NAMES[s]);
  return (
    <SettingGroup title={t.title}>
      {[
        <SettingRow key="lang" icon="language" title={t.language}>
          <Select value={lang.setting} onValueChange={(v) => lang.setSetting(v as LangSetting)}>
            <SelectTrigger className="w-56" aria-label={t.language}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANG_SETTINGS.map((s) => (
                <SelectItem key={s} value={s}>
                  {langLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>,
        <SettingRow key="theme" icon="circle-half-stroke" title={t.theme}>
          <Select value={theme.setting} onValueChange={(v) => theme.setSetting(v as ThemeSetting)}>
            <SelectTrigger className="w-56" aria-label={t.theme}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_SETTINGS.map((s) => (
                <SelectItem key={s} value={s}>
                  {t.options[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>,
      ]}
    </SettingGroup>
  );
}

function RunningGroup({ info }: { info: AppInfo | null }) {
  const t = useT(messages).running;
  const [picked, setPicked] = useState<string[] | null>(info?.autostart ?? null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windows, setWindows] = useSaved(info?.startWithWindows, api.setStartWithWindows);
  const [tray, setTray] = useSaved(info?.closeToTray, api.setCloseToTray);
  useEffect(() => setPicked(info?.autostart ?? null), [info]);
  useEffect(() => {
    api
      .listServices()
      .then(setServices)
      .catch((e) => setError(String(e)));
  }, []);

  // One switch for all of them: Zefaro skips the ones that aren't installed, so a
  // service installed later starts too.
  const setAll = (on: boolean) => {
    const before = picked ?? [];
    const next = on ? STARTABLE : [];
    setPicked(next);
    api.setAutostart(next).catch((e) => {
      setPicked(before);
      toast.error(String(e));
    });
  };
  const on = picked === null ? null : picked.length > 0;
  // Tools have nothing to start (DNS under .localhost is one).
  const starting = services
    ?.filter((s) => STARTABLE.includes(s.id) && !s.tool && !s.needsInstall && picked?.includes(s.id))
    .map((s) => s.name);
  const servicesLine = error
    ? <span className="text-destructive">{t.servicesFailed(error)}</span>
    : !on || !starting
      ? undefined
      : starting.length
        ? t.servicesOn(starting)
        : t.servicesNone;

  return (
    <SettingGroup title={t.title}>
      {[
        <SettingRow key="windows" icon="power-off" title={t.windows} description={t.windowsHint}>
          <SavedSwitch on={windows} change={setWindows} label={t.windows} />
        </SettingRow>,
        <SettingRow key="tray" icon="window-minimize" title={t.tray} description={tray === false ? t.trayOff : t.trayOn}>
          <SavedSwitch on={tray} change={setTray} label={t.tray} />
        </SettingRow>,
        <SettingRow key="services" icon="server" title={t.services} description={servicesLine}>
          <SavedSwitch on={on} change={setAll} label={t.services} />
        </SettingRow>,
      ]}
    </SettingGroup>
  );
}

function UpdatesGroup({ info, update }: { info: AppInfo | null; update: UpdateInfo | null }) {
  const t = useT(messages).updates;
  const u = useT(updateMessages);
  const [checking, setChecking] = useState(false);
  const [onStart, setOnStart] = useSaved(info?.checkUpdates, api.setCheckUpdates);
  // What the last check found: the startup check, then "Check now".
  const [found, setFound] = useState<UpdateInfo | null>(update);
  useEffect(() => setFound(update), [update]);

  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await api.checkUpdate();
      setFound(r);
      if (r.newer) announceUpdate(r, u);
      else toast.success(u.upToDate(r.current));
    } catch (e) {
      toast.error(u.failed, { description: String(e) });
    } finally {
      setChecking(false);
    }
  };
  const page = (url: string) => openUrl(url).catch((e) => toast.error(String(e)));
  const newer = found?.newer ? found : null;
  const version = info?.version ?? "";

  const versionRow = newer ? (
    <SettingRow key="version" icon="circle-arrow-up" title={u.available(newer.latest)} description={t.youHave(newer.current)}>
      <Button size="sm" variant="ghost" onClick={() => page(newer.url)}>
        {u.notes}
      </Button>
      {newer.canInstall ? (
        <Button size="sm" onClick={() => openUpdateDialog(newer)}>
          <Icon name="download" />
          {u.updateNow}
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => page(newer.url)}>
          {t.download}
        </Button>
      )}
    </SettingRow>
  ) : (
    <SettingRow
      key="version"
      icon="circle-info"
      title={info ? t.current(version) : <TextPending className="w-24" />}
      description={found ? t.latest : undefined}
    >
      <Button size="sm" variant="outline" onClick={checkNow} disabled={checking}>
        {checking ? <Spinner className="size-3" /> : <Icon name="magnifying-glass" />}
        {t.check}
      </Button>
    </SettingRow>
  );

  return (
    <SettingGroup title={t.title}>
      {[
        versionRow,
        <SettingRow key="onstart" icon="arrows-rotate" title={t.onStart}>
          <SavedSwitch on={onStart} change={setOnStart} label={t.onStart} />
        </SettingRow>,
      ]}
    </SettingGroup>
  );
}

function HttpsGroup({ ca }: { ca: CaStatus | null }) {
  const t = useT(messages).https;
  const { lang } = useLang();

  if (ca === null) {
    return (
      <SettingGroup title={t.title}>
        {[
          <SettingRow key="loading" icon="certificate" title={t.authority} description={<TextPending className="w-64" />}>
            <Pending />
          </SettingRow>,
        ]}
      </SettingGroup>
    );
  }

  return (
    <SettingGroup title={t.title}>
      {[
        <SettingRow
          key="authority"
          icon="certificate"
          title={t.authority}
          description={!ca.created ? t.notCreated : ca.trusted ? t.trusted : t.notTrusted}
          tone={ca.created && !ca.trusted ? "warning" : undefined}
        >
          {ca.created && (ca.trusted ? <UntrustCaButton /> : <TrustCaButton status={ca} />)}
        </SettingRow>,
        ...(ca.created
          ? [
              <SettingRow
                key="scope"
                icon="globe"
                title={t.signsFor(ca.tld)}
                description={
                  ca.expires
                    ? t.validUntil(new Date(ca.expires * 1000).toLocaleDateString(localeOf(lang), { dateStyle: "long" }))
                    : undefined
                }
              >
                <Button size="sm" variant="ghost" onClick={() => api.caReveal().catch((e) => toast.error(String(e)))}>
                  <Icon name="folder-open" variant="regular" />
                  {t.showFile}
                </Button>
              </SettingRow>,
            ]
          : []),
      ]}
    </SettingGroup>
  );
}

function ComputerGroup({ info }: { info: AppInfo | null }) {
  const t = useT(messages).computer;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t.copied);
    } catch {
      toast.error(t.copyFailed);
    }
  };
  return (
    <SettingGroup title={t.title}>
      {[
        <SettingRow key="domain" icon="globe" title={t.domain} description={t.domainHint}>
          {info ? <span className="font-mono text-sm">*.{info.tld}</span> : <Pending />}
        </SettingRow>,
        <SettingRow
          key="folder"
          icon="folder"
          title={t.folder}
          description={
            info ? (
              <span className="block truncate font-mono text-xs" title={info.configDir}>
                {info.configDir}
              </span>
            ) : (
              <TextPending className="w-64" />
            )
          }
        >
          <Button size="sm" variant="ghost" disabled={!info} onClick={() => info && copy(info.configDir)}>
            <Icon name="copy" variant="regular" />
            {t.copy}
          </Button>
        </SettingRow>,
      ]}
    </SettingGroup>
  );
}

export function SettingsPage({ info, update = null }: { info: AppInfo | null; update?: UpdateInfo | null }) {
  const t = useT(messages);
  const ca = useCaStatus();
  const [tab, setTab] = useState<SettingsTab>(lastTab);
  const choose = (v: string) => {
    lastTab = v as SettingsTab;
    setTab(lastTab);
  };
  // A tab hides its rows, so it carries a dot when one of them needs you.
  const attention: Record<SettingsTab, boolean> = {
    general: false,
    updates: !!update?.newer,
    system: !!ca?.created && !ca.trusted,
  };
  return (
    <>
      <PageHeader title={t.title} />
      <Tabs value={tab} onValueChange={choose} className="gap-5 pb-2">
        <TabsList
          variant="line"
          className="h-auto w-full max-w-full justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-none border-b p-0 [scrollbar-width:none] group-data-horizontal/tabs:h-auto [&::-webkit-scrollbar]:hidden"
        >
          {(Object.keys(t.tabs) as SettingsTab[]).map((key) => (
            <TabsTrigger
              key={key}
              value={key}
              className="h-10 flex-none rounded-none px-3 text-sm group-data-horizontal/tabs:after:bottom-0 group-data-[variant=line]/tabs-list:after:bg-primary"
            >
              <Icon name={TAB_ICON[key]} className="w-3.5 text-xs" />
              {t.tabs[key]}
              {attention[key] && (
                <span className="size-1.5 rounded-full bg-warning" role="img" aria-label={t.needsAttention} />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Each panel holds its own controls, so the panel itself is no tab stop. */}
        <TabsContent value="general" tabIndex={-1} className="space-y-6 outline-none">
          <InterfaceGroup />
          <RunningGroup info={info} />
        </TabsContent>
        <TabsContent value="updates" tabIndex={-1} className="space-y-6 outline-none">
          <UpdatesGroup info={info} update={update} />
          <BackupGroup />
        </TabsContent>
        <TabsContent value="system" tabIndex={-1} className="space-y-6 outline-none">
          <HttpsGroup ca={ca} />
          <ComputerGroup info={info} />
        </TabsContent>
      </Tabs>
    </>
  );
}
