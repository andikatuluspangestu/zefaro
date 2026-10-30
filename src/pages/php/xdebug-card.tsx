import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { PhpExtension } from "@/types";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    title: "Xdebug",
    label: (php: string) => `Xdebug for PHP ${php}`,
    about: (v: string) =>
      `Step through code with breakpoints from VS Code, PhpStorm or another editor. Turn it on and Zefaro downloads Xdebug ${v}, sets it up and restarts this PHP.`,
    off: "Off. Turn it on to debug; Zefaro sets it up and restarts this PHP.",
    working: "Setting up Xdebug and restarting PHP…",
    on: "On, and it only starts when your editor or browser asks (XDEBUG_TRIGGER), so pages stay fast. It talks to your editor on port 9003.",
    turnedOn: (php: string) => `Xdebug is on for PHP ${php}`,
    turnedOff: (php: string) => `Xdebug is off for PHP ${php}`,
    own: "Your own lines in php.ini load Xdebug, so Zefaro leaves it alone.",
    none: (php: string) => `Zefaro has no Xdebug build for PHP ${php}.`,
    copy: "Copy VS Code launch.json",
    copied: "Copied a launch.json for VS Code's PHP Debug extension",
  },
  id: {
    title: "Xdebug",
    label: (php: string) => `Xdebug untuk PHP ${php}`,
    about: (v: string) =>
      `Jalankan kode langkah demi langkah dengan breakpoint dari VS Code, PhpStorm, atau editor lain. Nyalakan, lalu Zefaro mengunduh Xdebug ${v}, menyiapkannya, dan me-restart PHP ini.`,
    off: "Mati. Nyalakan untuk debugging; Zefaro menyiapkannya dan me-restart PHP ini.",
    working: "Menyiapkan Xdebug dan me-restart PHP…",
    on: "Aktif, dan hanya mulai saat editor atau browser memintanya (XDEBUG_TRIGGER), jadi halaman tetap cepat. Terhubung ke editor Anda di port 9003.",
    turnedOn: (php: string) => `Xdebug aktif untuk PHP ${php}`,
    turnedOff: (php: string) => `Xdebug mati untuk PHP ${php}`,
    own: "Baris Anda sendiri di php.ini memuat Xdebug, jadi Zefaro tidak mengubahnya.",
    none: (php: string) => `Zefaro tidak punya build Xdebug untuk PHP ${php}.`,
    copy: "Salin launch.json VS Code",
    copied: "launch.json untuk ekstensi PHP Debug di VS Code disalin",
  },
});

const LAUNCH_JSON = `{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Listen for Xdebug (Zefaro)",
      "type": "php",
      "request": "launch",
      "port": 9003
    }
  ]
}
`;

/** One switch for Xdebug on a PHP line: downloads it the first time, saves, restarts PHP. */
export function XdebugCard({
  version,
  extensions,
  onChanged,
}: {
  version: string;
  extensions: PhpExtension[] | null;
  /** The line's extensions after the switch, with xdebug saved. */
  onChanged: (list: PhpExtension[]) => void;
}) {
  const t = useT(messages);
  const [available, setAvailable] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.phpXdebugVersion(version).then(setAvailable).catch(() => setAvailable(null));
  }, [version]);

  const ext = extensions?.find((e) => e.name === "xdebug");
  const on = !!ext?.enabled;
  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      onChanged(await api.phpXdebugSet(version, next));
      toast.success(next ? t.turnedOn(version) : t.turnedOff(version));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = () =>
    navigator.clipboard
      .writeText(LAUNCH_JSON)
      .then(() => toast.success(t.copied))
      .catch((e) => toast.error(String(e)));

  if (available === undefined || extensions === null) return null;
  const switchable = !!available && !ext?.inIni;
  const text = ext?.inIni
    ? t.own
    : !available
      ? t.none(version)
      : busy
        ? t.working
        : on
          ? t.on
          : ext
            ? t.off
            : t.about(available);
  return (
    <Card className="flex-row flex-wrap items-start gap-3 p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon name="bug" />
      </span>
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <div className="text-sm font-semibold">{t.title}</div>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {on && (
          <Button size="sm" variant="outline" onClick={copy}>
            <Icon name="copy" />
            {t.copy}
          </Button>
        )}
        {busy ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : (
          switchable && <Switch checked={on} onCheckedChange={toggle} aria-label={t.label(version)} />
        )}
      </div>
    </Card>
  );
}
