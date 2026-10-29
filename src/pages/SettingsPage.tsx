import { useEffect, useState, type ReactNode } from "react";
import type { AppInfo } from "@/types";
import { toast } from "sonner";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { TrustCaButton, UntrustCaButton, useCaStatus } from "@/components/https-trust";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { announceUpdate, updateMessages } from "@/components/update-check";
import { THEME_SETTINGS, useTheme, type ThemeSetting } from "@/theme";
import { LANG_SETTINGS, defineMessages, localeOf, resolveLang, useLang, useT, type LangSetting } from "@/i18n";

/** Each language's name, written in that language. */
const LANGUAGE_NAMES = { en: "English", id: "Bahasa Indonesia" } as const;

const messages = defineMessages({
  en: {
    title: "Settings",
    description: "Language, appearance, your environment, HTTPS certificates and the app version.",
    language: {
      title: "Language",
      description: "The language of Zefaro's interface, messages and documentation.",
      label: "Interface language",
      system: (name: string) => `Same as Windows (${name})`,
    },
    appearance: {
      title: "Appearance",
      description: "Light or dark. Zefaro can follow Windows and switch with it.",
      label: "Theme",
      options: { system: "Same as Windows", light: "Light", dark: "Dark" },
    },
    environment: {
      title: "Environment",
      description: "Where Zefaro keeps its config and which domain your sites use.",
      version: "Version",
      domain: "Local domain",
      configFolder: "Config folder",
      helper: "Privileged helper",
      installed: "Installed",
      notInstalled: "Not installed",
    },
    https: {
      description: "Zefaro's local certificate authority signs the certificate for each secured site.",
      authority: "Certificate authority",
      notCreated: "Zefaro creates it when you secure your first site",
      trusted: "Trusted",
      notTrusted: "Not trusted",
      canSign: "Can sign for",
      only: " only",
      expires: "Expires",
      thumbprint: "Thumbprint (SHA-1)",
      showFile: "Show certificate file",
    },
    footer: "Zefaro is a free, open-source local PHP environment. It has no AI or cloud features, by design.",
    window: {
      title: "Closing the window",
      description: "What happens when you click the close button.",
      label: "Keep running in the system tray",
      on: "Zefaro hides in the system tray and your services keep running. Quit from the tray icon's menu.",
      off: "Zefaro quits and stops every service.",
    },
    updates: {
      title: "Updates",
      description: "Zefaro reads its latest release from GitHub. It never downloads or installs anything by itself.",
      label: "Check for updates when Zefaro starts",
      on: "Zefaro tells you when a new version is out.",
      off: "Zefaro only checks when you click Check now.",
      check: "Check now",
    },
  },
  id: {
    title: "Pengaturan",
    description: "Bahasa, tampilan, lingkungan kerja, sertifikat HTTPS, dan versi aplikasi.",
    language: {
      title: "Bahasa",
      description: "Bahasa untuk tampilan, pesan, dan dokumentasi Zefaro.",
      label: "Bahasa tampilan",
      system: (name: string) => `Ikuti Windows (${name})`,
    },
    appearance: {
      title: "Tampilan",
      description: "Terang atau gelap. Zefaro bisa mengikuti Windows dan berganti bersamanya.",
      label: "Tema",
      options: { system: "Ikuti Windows", light: "Terang", dark: "Gelap" },
    },
    environment: {
      title: "Lingkungan kerja",
      description: "Tempat Zefaro menyimpan konfigurasinya dan domain yang dipakai situs Anda.",
      version: "Versi",
      domain: "Domain lokal",
      configFolder: "Folder konfigurasi",
      helper: "Helper berhak admin",
      installed: "Terpasang",
      notInstalled: "Tidak terpasang",
    },
    https: {
      description: "Otoritas sertifikat lokal milik Zefaro menandatangani sertifikat setiap situs yang diamankan.",
      authority: "Otoritas sertifikat",
      notCreated: "Zefaro membuatnya saat Anda mengamankan situs pertama",
      trusted: "Dipercaya",
      notTrusted: "Belum dipercaya",
      canSign: "Bisa menandatangani",
      only: " saja",
      expires: "Berlaku sampai",
      thumbprint: "Thumbprint (SHA-1)",
      showFile: "Tampilkan file sertifikat",
    },
    footer: "Zefaro adalah lingkungan PHP lokal yang gratis dan open source. Zefaro sengaja tidak punya fitur AI atau cloud.",
    window: {
      title: "Menutup jendela",
      description: "Yang terjadi saat Anda mengklik tombol tutup.",
      label: "Tetap berjalan di system tray",
      on: "Zefaro bersembunyi di system tray dan layanan Anda tetap berjalan. Keluar lewat menu ikon tray.",
      off: "Zefaro keluar dan menghentikan semua layanan.",
    },
    updates: {
      title: "Pembaruan",
      description: "Zefaro membaca rilis terbarunya dari GitHub. Zefaro tidak pernah mengunduh atau memasang apa pun sendiri.",
      label: "Periksa pembaruan saat Zefaro dimulai",
      on: "Zefaro memberi tahu saat versi baru keluar.",
      off: "Zefaro hanya memeriksa saat Anda mengklik Periksa sekarang.",
      check: "Periksa sekarang",
    },
  },
});

function Row({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon name={icon} className="text-muted-foreground" />
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

function LanguageCard() {
  const t = useT(messages).language;
  const { setting, setSetting } = useLang();
  const label = (s: LangSetting) => (s === "system" ? t.system(LANGUAGE_NAMES[resolveLang("system")]) : LANGUAGE_NAMES[s]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 text-sm">
          <Icon name="language" className="text-muted-foreground" />
          <span className="w-40 shrink-0 text-muted-foreground">{t.label}</span>
          <Select value={setting} onValueChange={(v) => setSetting(v as LangSetting)}>
            <SelectTrigger className="w-64" aria-label={t.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANG_SETTINGS.map((s) => (
                <SelectItem key={s} value={s}>
                  {label(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function AppearanceCard() {
  const t = useT(messages).appearance;
  const { setting, setSetting } = useTheme();
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 text-sm">
          <Icon name="circle-half-stroke" className="text-muted-foreground" />
          <span className="w-40 shrink-0 text-muted-foreground">{t.label}</span>
          <Select value={setting} onValueChange={(v) => setSetting(v as ThemeSetting)}>
            <SelectTrigger className="w-64" aria-label={t.label}>
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
        </div>
      </CardContent>
    </Card>
  );
}

function WindowCard({ info }: { info: AppInfo | null }) {
  const t = useT(messages).window;
  const [on, setOn] = useState<boolean | null>(info?.closeToTray ?? null);
  useEffect(() => setOn(info?.closeToTray ?? null), [info]);
  const change = (v: boolean) => {
    setOn(v);
    api.setCloseToTray(v).catch((e) => {
      setOn(!v);
      toast.error(String(e));
    });
  };
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {on === null ? (
          <Skeleton className="h-6 w-full" />
        ) : (
          <div className="flex items-start gap-3 text-sm">
            <Icon name="window-minimize" variant="regular" className="mt-0.5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div>{t.label}</div>
              <p className="text-xs text-muted-foreground">{on ? t.on : t.off}</p>
            </div>
            <Switch checked={on} onCheckedChange={change} aria-label={t.label} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UpdatesCard({ info }: { info: AppInfo | null }) {
  const t = useT(messages).updates;
  const u = useT(updateMessages);
  const [on, setOn] = useState<boolean | null>(info?.checkUpdates ?? null);
  const [checking, setChecking] = useState(false);
  useEffect(() => setOn(info?.checkUpdates ?? null), [info]);
  const change = (v: boolean) => {
    setOn(v);
    api.setCheckUpdates(v).catch((e) => {
      setOn(!v);
      toast.error(String(e));
    });
  };
  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await api.checkUpdate();
      if (r.newer) announceUpdate(r, u);
      else toast.success(u.upToDate(r.current));
    } catch (e) {
      toast.error(u.failed, { description: String(e) });
    } finally {
      setChecking(false);
    }
  };
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {on === null ? (
          <Skeleton className="h-6 w-full" />
        ) : (
          <>
            <div className="flex items-start gap-3 text-sm">
              <Icon name="arrows-rotate" className="mt-0.5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div>{t.label}</div>
                <p className="text-xs text-muted-foreground">{on ? t.on : t.off}</p>
              </div>
              <Switch checked={on} onCheckedChange={change} aria-label={t.label} />
            </div>
            <Button size="sm" variant="outline" className="mt-4" onClick={checkNow} disabled={checking}>
              {checking ? <Spinner className="size-3" /> : <Icon name="magnifying-glass" />}
              {t.check}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HttpsCard() {
  const t = useT(messages).https;
  const { lang } = useLang();
  const ca = useCaStatus();
  const rows: { icon: string; label: string; value: ReactNode }[] = ca
    ? [
        {
          icon: "certificate",
          label: t.authority,
          value: !ca.created ? (
            <span className="text-muted-foreground">{t.notCreated}</span>
          ) : ca.trusted ? (
            <Badge variant="secondary">
              <Icon name="circle-check" className="w-3 text-success" />
              {t.trusted}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-warning/40 text-warning">
              {t.notTrusted}
            </Badge>
          ),
        },
        {
          icon: "globe",
          label: t.canSign,
          value: (
            <>
              <span className="font-mono">*.{ca.tld}</span>
              <span className="text-muted-foreground">{t.only}</span>
            </>
          ),
        },
        ...(ca.created && ca.expires
          ? [
              {
                icon: "calendar",
                label: t.expires,
                value: new Date(ca.expires * 1000).toLocaleDateString(localeOf(lang), { dateStyle: "long" }),
              },
            ]
          : []),
        ...(ca.thumbprint
          ? [
              {
                icon: "fingerprint",
                label: t.thumbprint,
                value: <span className="font-mono text-xs">{ca.thumbprint}</span>,
              },
            ]
          : []),
      ]
    : [];

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>HTTPS</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {ca === null ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <>
            {rows.map((r, i) => (
              <div key={r.label}>
                {i > 0 && <Separator className="my-3" />}
                <Row icon={r.icon} label={r.label}>
                  {r.value}
                </Row>
              </div>
            ))}
            {ca.created && (
              <div className="mt-4 flex flex-wrap gap-2">
                {ca.trusted ? <UntrustCaButton /> : <TrustCaButton status={ca} />}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => api.caReveal().catch((e) => toast.error(String(e)))}
                >
                  <Icon name="folder-open" variant="regular" />
                  {t.showFile}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsPage({ info }: { info: AppInfo | null }) {
  const t = useT(messages);
  const e = t.environment;
  const rows: { icon: string; label: string; value: ReactNode }[] = info
    ? [
        { icon: "circle-info", label: e.version, value: `${info.name} ${info.version}` },
        { icon: "globe", label: e.domain, value: <span className="font-mono">*.{info.tld}</span> },
        {
          icon: "folder",
          label: e.configFolder,
          value: <span className="font-mono text-xs">{info.configDir}</span>,
        },
        {
          icon: "shield-halved",
          label: e.helper,
          value: (
            <Badge variant={info.helperInstalled ? "secondary" : "outline"}>
              {info.helperInstalled ? e.installed : e.notInstalled}
            </Badge>
          ),
        },
      ]
    : [];

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <LanguageCard />
      <AppearanceCard />
      <WindowCard info={info} />
      <UpdatesCard info={info} />
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{e.title}</CardTitle>
          <CardDescription>{e.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {info === null ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            rows.map((r, i) => (
              <div key={r.label}>
                {i > 0 && <Separator className="my-3" />}
                <Row icon={r.icon} label={r.label}>
                  {r.value}
                </Row>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <HttpsCard />
      <p className="mt-4 text-xs text-muted-foreground">{t.footer}</p>
    </>
  );
}
