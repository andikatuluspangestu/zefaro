import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import type { LanRoute } from "@/types";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { defineMessages, useT } from "@/i18n";

const MINUTES = [15, 30, 60, 120] as const;

const messages = defineMessages({
  en: {
    button: "Open on a phone",
    title: (site: string) => `Open ${site} on a phone?`,
    intro: "For a while, nginx also serves this site on this computer's address on your network, so a phone or tablet on the same Wi-Fi can open it.",
    points: {
      network: "Only devices on private networks (home or office Wi-Fi) get in. Anyone on that Wi-Fi who knows the address can open the site while it lasts.",
      firewall: "The first time, Windows may ask whether nginx may accept connections: allow it on private networks.",
      vite: "Pages built with npm run build work as they are. With the Vite dev server running, the phone can't reach its hot reload: build the assets first.",
    },
    duration: "Stop after",
    minutes: { 15: "15 minutes", 30: "30 minutes", 60: "1 hour", 120: "2 hours" } as Record<number, string>,
    cancel: "Cancel",
    start: "Open on the network",
    open: "On your phone, open",
    hint: (time: string) => `Same Wi-Fi as this computer. Stops by itself at ${time}.`,
    copy: "Copy",
    copied: "Address copied",
    test: "Open here",
    stop: "Stop",
    stopped: (site: string) => `${site} is no longer on the network`,
  },
  id: {
    button: "Buka di HP",
    title: (site: string) => `Buka ${site} di HP?`,
    intro: "Untuk sementara, nginx juga menyajikan situs ini di alamat komputer ini pada jaringan Anda, jadi HP atau tablet di Wi-Fi yang sama bisa membukanya.",
    points: {
      network: "Hanya perangkat di jaringan privat (Wi-Fi rumah atau kantor) yang bisa masuk. Siapa pun di Wi-Fi itu yang tahu alamatnya bisa membuka situs selama masih aktif.",
      firewall: "Pertama kali, Windows mungkin bertanya apakah nginx boleh menerima koneksi: izinkan untuk jaringan privat.",
      vite: "Halaman yang dibangun dengan npm run build langsung jalan. Saat dev server Vite berjalan, HP tidak bisa menjangkau hot reload-nya: build aset dulu.",
    },
    duration: "Berhenti setelah",
    minutes: { 15: "15 menit", 30: "30 menit", 60: "1 jam", 120: "2 jam" } as Record<number, string>,
    cancel: "Batal",
    start: "Buka di jaringan",
    open: "Di HP Anda, buka",
    hint: (time: string) => `Wi-Fi yang sama dengan komputer ini. Berhenti sendiri pukul ${time}.`,
    copy: "Salin",
    copied: "Alamat disalin",
    test: "Buka di sini",
    stop: "Hentikan",
    stopped: (site: string) => `${site} tidak lagi ada di jaringan`,
  },
});

/** A site's phone address: its state, start and stop. */
export function usePhone(site: string) {
  const t = useT(messages);
  const [route, setRoute] = useState<LanRoute | null>(null);
  const refresh = useCallback(() => api.lanStatus(site).then(setRoute).catch(() => {}), [site]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // Notice the end time passing.
  useEffect(() => {
    if (!route) return;
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [route, refresh]);
  const start = async (minutes: number) => {
    try {
      setRoute(await api.lanStart(site, minutes));
    } catch (e) {
      toast.error(String(e));
    }
  };
  const stop = async () => {
    try {
      await api.lanStop(site);
      setRoute(null);
      toast.success(t.stopped(site));
    } catch (e) {
      toast.error(String(e));
    }
  };
  return { route, start, stop };
}

export type Phone = ReturnType<typeof usePhone>;

export function PhoneButton({ site, phone }: { site: string; phone: Phone }) {
  const t = useT(messages);
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<number>(30);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-lg" variant="outline" aria-label={t.button} onClick={() => setOpen(true)} disabled={!!phone.route}>
            <Icon name="mobile-screen" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t.button}</TooltipContent>
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
                ["wifi", t.points.network],
                ["shield-halved", t.points.firewall],
                ["bolt", t.points.vite],
              ] as const
            ).map(([icon, text]) => (
              <li key={icon} className="flex gap-2.5">
                <Icon name={icon} className="mt-0.5 w-4 text-muted-foreground" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1.5 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm font-medium">{t.duration}</span>
            <Select value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}>
              <SelectTrigger className="w-full sm:w-44" aria-label={t.duration}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MINUTES.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t.minutes[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <Button
              onClick={() => {
                setOpen(false);
                phone.start(minutes);
              }}
            >
              <Icon name="mobile-screen" />
              {t.start}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Under the header while the site is on the network: the address to type on the phone. */
export function PhoneBanner({ phone }: { phone: Phone }) {
  const t = useT(messages);
  const r = phone.route;
  if (!r) return null;
  return (
    <Card className="mb-5 gap-2 border-primary/40 bg-primary/5 p-4" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Icon name="mobile-screen" className="text-primary" />
        <span className="text-sm font-medium">{t.open}</span>
        <code className="font-mono text-lg font-semibold tracking-tight select-all">{r.url}</code>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              navigator.clipboard
                .writeText(r.url)
                .then(() => toast.success(t.copied))
                .catch((e) => toast.error(String(e)))
            }
          >
            <Icon name="copy" />
            {t.copy}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openUrl(r.url).catch((e) => toast.error(String(e)))}>
            <Icon name="arrow-up-right-from-square" />
            {t.test}
          </Button>
          <Button size="sm" variant="destructive" onClick={phone.stop}>
            <Icon name="circle-stop" />
            {t.stop}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t.hint(clock(r.expiresMs))}</p>
    </Card>
  );
}
