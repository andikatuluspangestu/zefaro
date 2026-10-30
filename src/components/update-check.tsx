import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { defineMessages, useT } from "@/i18n";
import type { AppInfo, UpdateInfo, UpdateProgress } from "@/types";

export const updateMessages = defineMessages({
  en: {
    available: (v: string) => `Zefaro ${v} is available`,
    availableBody: (current: string) => `You have ${current}. Update now, or download the installer yourself; your sites and settings stay.`,
    download: "Download",
    updateNow: "Update now",
    notes: "Release notes",
    upToDate: (v: string) => `Zefaro ${v} is the latest version`,
    failed: "Zefaro couldn't check for updates",
    confirmTitle: (v: string) => `Update to Zefaro ${v}?`,
    confirmDownload: (size: string) =>
      `Zefaro downloads the installer (${size}) from GitHub and checks it against the checksum published with the release. A file that doesn't match is deleted and never run.`,
    confirmInstall:
      "Then it stops your services, closes, installs and opens again. Your sites, settings, databases, the DNS rule and the HTTPS certificate stay.",
    cancel: "Cancel",
    phases: {
      checking: "Checking the release…",
      downloading: "Downloading the installer…",
      verifying: "Checking the download…",
      installing: "Closing Zefaro to install…",
    },
    updateFailed: "The update didn't finish",
    nothingChanged: "Nothing was installed. You can try again, or download the installer yourself.",
    close: "Close",
    releasePage: "Release page",
  },
  id: {
    available: (v: string) => `Zefaro ${v} sudah tersedia`,
    availableBody: (current: string) => `Versi Anda ${current}. Perbarui sekarang, atau unduh installer sendiri; situs dan pengaturan Anda tetap.`,
    download: "Unduh",
    updateNow: "Perbarui sekarang",
    notes: "Catatan rilis",
    upToDate: (v: string) => `Zefaro ${v} adalah versi terbaru`,
    failed: "Zefaro tidak bisa memeriksa pembaruan",
    confirmTitle: (v: string) => `Perbarui ke Zefaro ${v}?`,
    confirmDownload: (size: string) =>
      `Zefaro mengunduh installer (${size}) dari GitHub dan mencocokkannya dengan checksum yang diterbitkan bersama rilis. Berkas yang tidak cocok dihapus dan tidak pernah dijalankan.`,
    confirmInstall:
      "Lalu Zefaro menghentikan layanan, menutup diri, memasang, dan terbuka lagi. Situs, pengaturan, database, aturan DNS, dan sertifikat HTTPS Anda tetap.",
    cancel: "Batal",
    phases: {
      checking: "Memeriksa rilis…",
      downloading: "Mengunduh installer…",
      verifying: "Memeriksa unduhan…",
      installing: "Menutup Zefaro untuk memasang…",
    },
    updateFailed: "Pembaruan tidak selesai",
    nothingChanged: "Tidak ada yang terpasang. Anda bisa mencoba lagi, atau mengunduh installer sendiri.",
    close: "Tutup",
    releasePage: "Halaman rilis",
  },
});

const EVENT = "zefaro:update-now";

/** Ask for the update dialog (shown by `UpdateHost`, mounted once in the app). */
export function openUpdateDialog(u: UpdateInfo) {
  window.dispatchEvent(new CustomEvent<UpdateInfo>(EVENT, { detail: u }));
}

/** Tell the user about a newer version, with buttons to update or read its page. */
export function announceUpdate(u: UpdateInfo, t: (typeof updateMessages)["en"]) {
  const page = () => openUrl(u.url).catch((e) => toast.error(String(e)));
  toast.info(t.available(u.latest), {
    id: "zefaro-update",
    description: t.availableBody(u.current),
    duration: 15000,
    action: u.canInstall ? { label: t.updateNow, onClick: () => openUpdateDialog(u) } : { label: t.download, onClick: page },
    cancel: u.canInstall ? { label: t.notes, onClick: page } : undefined,
  });
}

/** Once per launch, when the setting is on: ask GitHub for a newer release. Quiet when offline. */
export function useStartupUpdateCheck(info: AppInfo | null): UpdateInfo | null {
  const t = useT(updateMessages);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const enabled = info?.checkUpdates ?? false;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api
      .checkUpdate()
      .then((u) => {
        if (!alive) return;
        setUpdate(u);
        if (u.newer) announceUpdate(u, t);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // `t` changes with the language; one check per launch is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return update;
}

function megabytes(n: number | null | undefined) {
  return n == null ? "?" : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The "Update now" dialog: what will happen, then the download's progress. It
 * opens from the toast or Settings (`openUpdateDialog`). When the download is
 * checked, Zefaro closes itself and the installer takes over, so a successful
 * update never returns to this dialog.
 */
export function UpdateHost() {
  const t = useT(updateMessages);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const open = (e: Event) => {
      setUpdate((e as CustomEvent<UpdateInfo>).detail);
      setRunning(false);
      setProgress(null);
      setError(null);
    };
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);

  // Follow the download while it runs.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      api.updateProgress().then(setProgress).catch(() => {});
    }, 400);
    return () => window.clearInterval(timer);
  }, [running]);

  const start = async () => {
    setRunning(true);
    setError(null);
    try {
      await api.updateInstall();
      // The app is closing; nothing more to do here.
      setProgress({ phase: "installing", done: 0, total: null });
    } catch (e) {
      setRunning(false);
      setProgress(null);
      setError(String(e));
    }
  };

  const pct = progress?.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <AlertDialog open={update !== null} onOpenChange={(o) => !o && !running && setUpdate(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{error ? t.updateFailed : t.confirmTitle(update?.latest ?? "")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              {error ? (
                <>
                  <p className="text-destructive">{error}</p>
                  <p>{t.nothingChanged}</p>
                </>
              ) : running ? (
                <>
                  <p>{t.phases[progress?.phase ?? "checking"]}</p>
                  <Progress value={progress?.phase === "installing" ? 100 : pct} className="h-2" />
                </>
              ) : (
                <>
                  <p>{t.confirmDownload(megabytes(update?.installerSize))}</p>
                  <p>{t.confirmInstall}</p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!running && (
          <AlertDialogFooter>
            {error ? (
              <>
                <Button variant="outline" onClick={() => update && openUrl(update.url).catch(() => {})}>
                  {t.releasePage}
                </Button>
                <AlertDialogCancel>{t.close}</AlertDialogCancel>
                <Button onClick={start}>{t.updateNow}</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => update && openUrl(update.url).catch(() => {})}>
                  {t.notes}
                </Button>
                <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    // Stay open: the dialog now shows the download.
                    e.preventDefault();
                    start();
                  }}
                >
                  {t.updateNow}
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
