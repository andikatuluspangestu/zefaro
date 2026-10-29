import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { PhpExtension } from "@/types";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    title: "Xdebug",
    about: "Step through code with breakpoints from VS Code, PhpStorm or another editor.",
    install: (v: string) => `Download Xdebug ${v}`,
    installing: "Downloading…",
    installed: (php: string) => `Xdebug was added to PHP ${php}. Turn it on with its switch below, then save.`,
    off: "Downloaded. Turn on xdebug in the list below and save to use it.",
    on: "On, and it only starts when your editor or browser asks (XDEBUG_TRIGGER), so pages stay fast. It talks to your editor on port 9003.",
    none: (php: string) => `Zefaro has no Xdebug build for PHP ${php}.`,
    copy: "Copy VS Code launch.json",
    copied: "Copied a launch.json for VS Code's PHP Debug extension",
  },
  id: {
    title: "Xdebug",
    about: "Jalankan kode langkah demi langkah dengan breakpoint dari VS Code, PhpStorm, atau editor lain.",
    install: (v: string) => `Unduh Xdebug ${v}`,
    installing: "Mengunduh…",
    installed: (php: string) => `Xdebug ditambahkan ke PHP ${php}. Nyalakan dengan switch-nya di bawah, lalu simpan.`,
    off: "Sudah diunduh. Nyalakan xdebug di daftar di bawah lalu simpan untuk memakainya.",
    on: "Aktif, dan hanya mulai saat editor atau browser memintanya (XDEBUG_TRIGGER), jadi halaman tetap cepat. Terhubung ke editor Anda di port 9003.",
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

/** Download Xdebug for a PHP line; it then appears in the extension list. */
export function XdebugCard({
  version,
  extensions,
  onInstalled,
}: {
  version: string;
  extensions: PhpExtension[] | null;
  onInstalled: (list: PhpExtension[]) => void;
}) {
  const t = useT(messages);
  const [available, setAvailable] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.phpXdebugVersion(version).then(setAvailable).catch(() => setAvailable(null));
  }, [version]);

  const ext = extensions?.find((e) => e.name === "xdebug");
  const install = async () => {
    setBusy(true);
    try {
      onInstalled(await api.phpXdebugInstall(version));
      toast.success(t.installed(version));
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
  return (
    <Card className="flex-row flex-wrap items-start gap-3 p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon name="bug" />
      </span>
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <div className="text-sm font-semibold">{t.title}</div>
        <p className="text-xs text-muted-foreground">{ext ? (ext.enabled ? t.on : t.off) : available ? t.about : t.none(version)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!ext && available && (
          <Button size="sm" onClick={install} disabled={busy}>
            {busy ? <Spinner className="size-3" /> : <Icon name="download" />}
            {busy ? t.installing : t.install(available)}
          </Button>
        )}
        {ext && (
          <Button size="sm" variant="outline" onClick={copy}>
            <Icon name="copy" />
            {t.copy}
          </Button>
        )}
      </div>
    </Card>
  );
}
