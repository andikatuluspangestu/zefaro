import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import type { TunnelInfo, TunnelSetup } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    share: "Share on the internet",
    title: (site: string) => `Share ${site} on the internet?`,
    intro: "Zefaro gives this site a temporary public address through a Cloudflare Quick Tunnel, so you can test a webhook or show your work to a client.",
    points: {
      public: "Anyone with the link can open the site from anywhere while it's shared: its pages, forms and routes. Share only what you'd show a stranger.",
      debug: "With APP_DEBUG=true, an error page shows your code and .env values to whoever sees it. Turn it off first, or share only for a moment.",
      address: "The address is a random https://….trycloudflare.com, new each time. Quick Tunnels need no account and are meant for testing, not for running a live site.",
      download: (version: string, size: string) =>
        `First, Zefaro downloads cloudflared ${version} (${size}) from Cloudflare's releases on GitHub and checks it against its SHA-256.`,
      stop: "It stays public until you click Stop sharing, stop nginx, or quit Zefaro.",
    },
    agree: "I understand this site will be public on the internet",
    cancel: "Cancel",
    confirm: "Share publicly",
    confirmDownload: (size: string) => `Download (${size}) and share`,
    downloading: (pct: number | null) => (pct === null ? "Downloading cloudflared…" : `Downloading cloudflared ${pct}%`),
    starting: "Starting the tunnel. Cloudflare is making the address…",
    publicAt: "Public at",
    publicHint: "Anyone with this link can open the site. Links and assets use this address while it's shared.",
    copy: "Copy",
    copied: "Address copied",
    open: "Open",
    stop: "Stop sharing",
    stopped: (site: string) => `${site} is no longer public`,
    failedTitle: "Sharing stopped",
    retry: "Try again",
    dismiss: "Dismiss",
  },
  id: {
    share: "Bagikan ke internet",
    title: (site: string) => `Bagikan ${site} ke internet?`,
    intro: "Zefaro memberi situs ini alamat publik sementara lewat Cloudflare Quick Tunnel, untuk menguji webhook atau menunjukkan hasil ke klien.",
    points: {
      public: "Siapa pun yang punya link bisa membuka situs ini dari mana saja selama dibagikan: halaman, form, dan route-nya. Bagikan hanya yang boleh dilihat orang asing.",
      debug: "Dengan APP_DEBUG=true, halaman error menampilkan kode dan nilai .env Anda ke siapa pun yang melihatnya. Matikan dulu, atau bagikan hanya sebentar.",
      address: "Alamatnya acak, https://….trycloudflare.com, dan berganti setiap kali. Quick Tunnel tidak butuh akun dan dibuat untuk pengujian, bukan untuk menjalankan situs produksi.",
      download: (version: string, size: string) =>
        `Pertama, Zefaro mengunduh cloudflared ${version} (${size}) dari rilis Cloudflare di GitHub dan memeriksanya dengan SHA-256-nya.`,
      stop: "Situs tetap publik sampai Anda klik Berhenti berbagi, menghentikan nginx, atau menutup Zefaro.",
    },
    agree: "Saya mengerti situs ini akan publik di internet",
    cancel: "Batal",
    confirm: "Bagikan secara publik",
    confirmDownload: (size: string) => `Unduh (${size}) dan bagikan`,
    downloading: (pct: number | null) => (pct === null ? "Mengunduh cloudflared…" : `Mengunduh cloudflared ${pct}%`),
    starting: "Memulai tunnel. Cloudflare sedang membuat alamatnya…",
    publicAt: "Publik di",
    publicHint: "Siapa pun yang punya link ini bisa membuka situsnya. Link dan aset memakai alamat ini selama dibagikan.",
    copy: "Salin",
    copied: "Alamat disalin",
    open: "Buka",
    stop: "Berhenti berbagi",
    stopped: (site: string) => `${site} tidak lagi publik`,
    failedTitle: "Berbagi berhenti",
    retry: "Coba lagi",
    dismiss: "Tutup",
  },
});

const megabytes = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/** A site's share: its state, kept fresh while it starts, and start/stop. */
export function useShare(site: string) {
  const t = useT(messages);
  const [info, setInfo] = useState<TunnelInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState<number | null | undefined>(undefined);

  const refresh = useCallback(() => api.tunnelStatus(site).then(setInfo).catch(() => {}), [site]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // Quickly while Cloudflare makes the address, slowly after (to notice a drop).
  useEffect(() => {
    if (!info) return;
    const timer = window.setInterval(refresh, info.state === "starting" ? 800 : 4000);
    return () => window.clearInterval(timer);
  }, [info, refresh]);

  // The download's progress, while start() is fetching cloudflared.
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      api
        .serviceProgress()
        .then((p) => {
          const d = p.cloudflared;
          setDownload(d ? (d.total ? Math.round((d.done / d.total) * 100) : null) : undefined);
        })
        .catch(() => {});
    }, 400);
    return () => window.clearInterval(timer);
  }, [busy]);

  const start = async () => {
    setBusy(true);
    try {
      setInfo(await api.tunnelStart(site));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
      setDownload(undefined);
      window.dispatchEvent(new Event("zefaro:tunnels"));
    }
  };
  const stop = async () => {
    try {
      await api.tunnelStop(site);
      setInfo(null);
      toast.success(t.stopped(site));
    } catch (e) {
      toast.error(String(e));
    }
    window.dispatchEvent(new Event("zefaro:tunnels"));
  };
  return { info, busy, download, start, stop };
}

export type Share = ReturnType<typeof useShare>;

/** The header's Share button and its confirmation. */
export function ShareButton({ site, share }: { site: string; share: Share }) {
  const t = useT(messages);
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [setup, setSetup] = useState<TunnelSetup | null>(null);

  const ask = () => {
    setAgreed(false);
    api.tunnelSetup().then(setSetup).catch(() => setSetup(null));
    setOpen(true);
  };
  const shared = !!share.info && share.info.state !== "failed";

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-lg"
            variant="outline"
            aria-label={t.share}
            onClick={ask}
            disabled={shared || share.busy}
            className={cn(shared && "border-warning/50 text-warning")}
          >
            <Icon name="share-nodes" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t.share}</TooltipContent>
      </Tooltip>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.title(site)}</AlertDialogTitle>
            <AlertDialogDescription>{t.intro}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-2 text-sm">
            {(
              [
                ["globe", t.points.public, "text-warning"],
                ["bug", t.points.debug, "text-warning"],
                ["link", t.points.address, "text-muted-foreground"],
                ...(setup && !setup.installed
                  ? [["download", t.points.download(setup.version, megabytes(setup.downloadBytes)), "text-muted-foreground"]]
                  : []),
                ["circle-stop", t.points.stop, "text-muted-foreground"],
              ] as [string, string, string][]
            ).map(([icon, text, tone]) => (
              <li key={icon} className="flex gap-2.5">
                <Icon name={icon} className={cn("mt-0.5 w-4", tone)} />
                <span>{text}</span>
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2.5 rounded-md border p-3 text-sm">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
            <span>{t.agree}</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <Button
              disabled={!agreed}
              onClick={() => {
                setOpen(false);
                share.start();
              }}
            >
              <Icon name="share-nodes" />
              {setup && !setup.installed ? t.confirmDownload(megabytes(setup.downloadBytes)) : t.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Under the site's header while it's shared: the address, and Stop. */
export function ShareBanner({ site, share }: { site: string; share: Share }) {
  const t = useT(messages);
  const { info, busy, download } = share;

  if (busy && !info) {
    return (
      <Card className="mb-5 gap-2 border-warning/40 p-4">
        <p className="flex items-center gap-2 text-sm">
          <Spinner className="size-4" />
          {download !== undefined ? t.downloading(download) : t.starting}
        </p>
        {download !== undefined && <Progress value={download ?? 0} className="h-1.5" />}
      </Card>
    );
  }
  if (!info) return null;
  if (info.state === "failed") {
    return (
      <Card className="mb-5 gap-2 border-destructive/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Icon name="circle-exclamation" className="text-destructive" />
          <span className="text-sm font-medium">{t.failedTitle}</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={share.stop}>
              {t.dismiss}
            </Button>
            <Button size="sm" variant="outline" onClick={share.start}>
              {t.retry}
            </Button>
          </div>
        </div>
        {info.error && <pre className="max-h-32 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">{info.error}</pre>}
      </Card>
    );
  }
  return (
    <Card className="mb-5 gap-2 border-warning/50 bg-warning/5 p-4" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {info.url ? (
          <>
            <Icon name="globe" className="text-warning" />
            <span className="text-sm font-medium">{t.publicAt}</span>
            <button
              type="button"
              className="min-w-0 truncate font-mono text-sm text-primary underline-offset-2 hover:underline"
              onClick={() => openUrl(info.url!).catch((e) => toast.error(String(e)))}
              title={info.url}
            >
              {info.url}
            </button>
          </>
        ) : (
          <span className="flex items-center gap-2 text-sm">
            <Spinner className="size-4" />
            {t.starting}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {info.url && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(info.url!)
                    .then(() => toast.success(t.copied))
                    .catch((e) => toast.error(String(e)))
                }
              >
                <Icon name="copy" />
                {t.copy}
              </Button>
              <Button size="sm" variant="outline" onClick={() => openUrl(info.url!).catch((e) => toast.error(String(e)))}>
                <Icon name="arrow-up-right-from-square" />
                {t.open}
              </Button>
            </>
          )}
          <Button size="sm" variant="destructive" onClick={share.stop} aria-label={`${t.stop} (${site})`}>
            <Icon name="circle-stop" />
            {t.stop}
          </Button>
        </div>
      </div>
      {info.url && <p className="text-xs text-muted-foreground">{t.publicHint}</p>}
    </Card>
  );
}
