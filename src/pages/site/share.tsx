import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import type { ShareOptions, TunnelInfo, TunnelSetup } from "@/types";
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
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { defineMessages, useT } from "@/i18n";

/** The user name a password-protected share asks for (Rust's SHARE_USER). */
const SHARE_USER = "zefaro";
/** How long a share lasts, in minutes; 0 until stopped. */
const DURATIONS = [30, 60, 240, 0] as const;

const messages = defineMessages({
  en: {
    share: "Share on the internet",
    title: (site: string) => `Share ${site} on the internet?`,
    intro: "Zefaro gives this site a temporary public address through a Cloudflare Quick Tunnel, so you can test a webhook or show your work to a client.",
    points: {
      public: "Anyone with the link can reach the site from anywhere while it's shared. Share only what you'd show a stranger, or ask for a password below.",
      debug: "With APP_DEBUG=true, an error page shows your code and .env values to whoever sees it. Turn it off before sharing.",
      address: "The address is a random https://….trycloudflare.com, new each time. Quick Tunnels need no account and are meant for testing, not for running a live site.",
      download: (version: string, size: string) =>
        `First, Zefaro downloads cloudflared ${version} (${size}) from Cloudflare's releases on GitHub and checks it against its SHA-256.`,
      stop: "It stops when the time below runs out, when you click Stop sharing, or when nginx or Zefaro stops.",
    },
    debugOn: "This site has APP_DEBUG=true: an error page would show visitors your code and .env values.",
    debugFix: "Turn off APP_DEBUG",
    debugFixed: "APP_DEBUG is now false in this site's .env.",
    password: "Ask for a password",
    passwordHint: `Visitors sign in as ${SHARE_USER} with this password. Turn it off for webhooks: services that call your site can't sign in.`,
    passwordLabel: "Password for visitors",
    newPassword: "New password",
    passwordShort: "Use at least 6 characters, without a colon.",
    duration: "Stop sharing after",
    durations: { 30: "30 minutes", 60: "1 hour", 240: "4 hours", 0: "Only when I stop it" } as Record<number, string>,
    agree: "I understand this site will be reachable on the internet",
    cancel: "Cancel",
    confirm: "Share",
    confirmDownload: (size: string) => `Download (${size}) and share`,
    downloading: (pct: number | null) => (pct === null ? "Downloading cloudflared…" : `Downloading cloudflared ${pct}%`),
    starting: "Starting the tunnel. Cloudflare is making the address…",
    publicAt: "Public at",
    publicHint: "Anyone with this link can reach the site. Links and assets use this address while it's shared.",
    signIn: "Sign in as",
    signInUnknown: "Visitors sign in with the password you chose.",
    until: (time: string) => `Stops by itself at ${time}.`,
    copy: "Copy",
    copied: "Address copied",
    copyLogin: "Copy password",
    copiedLogin: "Password copied",
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
      public: "Siapa pun yang punya link bisa membuka situs ini dari mana saja selama dibagikan. Bagikan hanya yang boleh dilihat orang asing, atau minta password di bawah.",
      debug: "Dengan APP_DEBUG=true, halaman error menampilkan kode dan nilai .env Anda ke siapa pun yang melihatnya. Matikan sebelum berbagi.",
      address: "Alamatnya acak, https://….trycloudflare.com, dan berganti setiap kali. Quick Tunnel tidak butuh akun dan dibuat untuk pengujian, bukan untuk menjalankan situs produksi.",
      download: (version: string, size: string) =>
        `Pertama, Zefaro mengunduh cloudflared ${version} (${size}) dari rilis Cloudflare di GitHub dan memeriksanya dengan SHA-256-nya.`,
      stop: "Berbagi berhenti saat waktu di bawah habis, saat Anda klik Berhenti berbagi, atau saat nginx atau Zefaro berhenti.",
    },
    debugOn: "Situs ini memakai APP_DEBUG=true: halaman error akan menampilkan kode dan nilai .env Anda ke pengunjung.",
    debugFix: "Matikan APP_DEBUG",
    debugFixed: "APP_DEBUG sekarang false di .env situs ini.",
    password: "Minta password",
    passwordHint: `Pengunjung masuk sebagai ${SHARE_USER} dengan password ini. Matikan untuk webhook: layanan yang memanggil situs Anda tidak bisa login.`,
    passwordLabel: "Password untuk pengunjung",
    newPassword: "Password baru",
    passwordShort: "Gunakan minimal 6 karakter, tanpa titik dua.",
    duration: "Berhenti berbagi setelah",
    durations: { 30: "30 menit", 60: "1 jam", 240: "4 jam", 0: "Hanya saat saya hentikan" } as Record<number, string>,
    agree: "Saya mengerti situs ini akan bisa dibuka dari internet",
    cancel: "Batal",
    confirm: "Bagikan",
    confirmDownload: (size: string) => `Unduh (${size}) dan bagikan`,
    downloading: (pct: number | null) => (pct === null ? "Mengunduh cloudflared…" : `Mengunduh cloudflared ${pct}%`),
    starting: "Memulai tunnel. Cloudflare sedang membuat alamatnya…",
    publicAt: "Publik di",
    publicHint: "Siapa pun yang punya link ini bisa membuka situsnya. Link dan aset memakai alamat ini selama dibagikan.",
    signIn: "Masuk sebagai",
    signInUnknown: "Pengunjung masuk dengan password yang Anda pilih.",
    until: (time: string) => `Berhenti sendiri pukul ${time}.`,
    copy: "Salin",
    copied: "Alamat disalin",
    copyLogin: "Salin password",
    copiedLogin: "Password disalin",
    open: "Buka",
    stop: "Berhenti berbagi",
    stopped: (site: string) => `${site} tidak lagi publik`,
    failedTitle: "Berbagi berhenti",
    retry: "Coba lagi",
    dismiss: "Tutup",
  },
});

const megabytes = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/** Letters and digits that can't be mistaken for one another when read out. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function newPassword(length = 12): string {
  const n = new Uint32Array(length);
  crypto.getRandomValues(n);
  return Array.from(n, (x) => ALPHABET[x % ALPHABET.length]).join("");
}

const passwordOk = (p: string) => [...p].length >= 6 && p.length <= 128 && !p.includes(":");

/** A site's share: its state, kept fresh while it starts, and start/stop. */
export function useShare(site: string) {
  const t = useT(messages);
  const [info, setInfo] = useState<TunnelInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState<number | null | undefined>(undefined);
  /** The options of the last start, for Try again and to show the password. */
  const [options, setOptions] = useState<ShareOptions | null>(null);

  const refresh = useCallback(() => api.tunnelStatus(site).then(setInfo).catch(() => {}), [site]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // Quickly while Cloudflare makes the address, slowly after (to notice a drop or the end time).
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

  const start = async (with_: ShareOptions | null = options) => {
    const opts = with_ ?? { password: "", minutes: 60 };
    setOptions(opts);
    setBusy(true);
    try {
      setInfo(await api.tunnelStart(site, opts));
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
  return { info, busy, download, start, stop, password: options?.password ?? "" };
}

export type Share = ReturnType<typeof useShare>;

/** The header's Share button and its confirmation. */
export function ShareButton({ site, share }: { site: string; share: Share }) {
  const t = useT(messages);
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [setup, setSetup] = useState<TunnelSetup | null>(null);
  /** APP_DEBUG in the site's .env: true, false, or null when there's no .env to read. */
  const [debug, setDebug] = useState<boolean | null>(null);
  const [debugFixed, setDebugFixed] = useState(false);
  const [protect, setProtect] = useState(true);
  const [password, setPassword] = useState("");
  const [minutes, setMinutes] = useState<number>(60);

  const ask = () => {
    setAgreed(false);
    setDebugFixed(false);
    setPassword(newPassword());
    api.tunnelSetup().then(setSetup).catch(() => setSetup(null));
    api
      .siteEnv(site)
      .then((env) => {
        const v = env.find((e) => e.key === "APP_DEBUG")?.value.trim().toLowerCase();
        setDebug(v === undefined ? null : v === "true" || v === "1");
      })
      .catch(() => setDebug(null));
    setOpen(true);
  };
  const turnOffDebug = () =>
    api
      .siteEnvSet(site, [["APP_DEBUG", "false"]])
      .then(() => {
        setDebug(false);
        setDebugFixed(true);
      })
      .catch((e) => toast.error(String(e)));

  const shared = !!share.info && share.info.state !== "failed";
  const passwordBad = protect && !passwordOk(password);

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
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.title(site)}</AlertDialogTitle>
            <AlertDialogDescription>{t.intro}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-2 text-sm">
            {(
              [
                ["globe", t.points.public, "text-warning"],
                // Known APP_DEBUG gets its own box below; unknown keeps the general warning.
                ...(debug === null ? [["bug", t.points.debug, "text-warning"]] : []),
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

          {debug === true && (
            <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm sm:flex-row sm:items-center">
              <Icon name="bug" className="hidden text-destructive sm:block" />
              <span className="flex-1">{t.debugOn}</span>
              <Button size="sm" variant="outline" onClick={turnOffDebug}>
                {t.debugFix}
              </Button>
            </div>
          )}
          {debugFixed && (
            <p className="flex items-center gap-2 text-sm text-success" role="status">
              <Icon name="circle-check" />
              {t.debugFixed}
            </p>
          )}

          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <label htmlFor="share-protect" className="text-sm font-medium">
                  {t.password}
                </label>
                <p className="text-xs text-muted-foreground">{t.passwordHint}</p>
              </div>
              <Switch id="share-protect" checked={protect} onCheckedChange={setProtect} />
            </div>
            {protect && (
              <div className="space-y-1">
                <div className="flex gap-2">
                  <Input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-label={t.passwordLabel}
                    aria-invalid={passwordBad}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon" variant="outline" aria-label={t.newPassword} onClick={() => setPassword(newPassword())}>
                        <Icon name="rotate" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t.newPassword}</TooltipContent>
                  </Tooltip>
                </div>
                {passwordBad && <p className="text-xs text-destructive">{t.passwordShort}</p>}
              </div>
            )}
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium">{t.duration}</span>
              <Select value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}>
                <SelectTrigger className="w-full sm:w-52" aria-label={t.duration}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {t.durations[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-start gap-2.5 rounded-md border p-3 text-sm">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
            <span>{t.agree}</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <Button
              disabled={!agreed || passwordBad}
              onClick={() => {
                setOpen(false);
                share.start({ password: protect ? password : "", minutes });
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

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Under the site's header while it's shared: the address, sign-in, end time, and Stop. */
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
            <Button size="sm" variant="outline" onClick={() => share.start()}>
              {t.retry}
            </Button>
          </div>
        </div>
        {info.error && <pre className="max-h-32 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">{info.error}</pre>}
      </Card>
    );
  }
  const copy = (text: string, done: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(done))
      .catch((e) => toast.error(String(e)));
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
              <Button size="sm" variant="outline" onClick={() => copy(info.url!, t.copied)}>
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
      {info.protected && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Icon name="lock" className="text-muted-foreground" />
          {share.password ? (
            <>
              <span>{t.signIn}</span>
              <code className="font-mono">{SHARE_USER}</code>
              <span className="text-muted-foreground">/</span>
              <code className="font-mono">{share.password}</code>
              <Button size="xs" variant="ghost" onClick={() => copy(share.password, t.copiedLogin)}>
                <Icon name="copy" />
                {t.copyLogin}
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">{t.signInUnknown}</span>
          )}
        </div>
      )}
      {info.url && (
        <p className="text-xs text-muted-foreground">
          {t.publicHint}
          {info.expiresMs !== null && ` ${t.until(clock(info.expiresMs))}`}
        </p>
      )}
    </Card>
  );
}
