import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import { defineMessages, useT } from "@/i18n";
import type { AppInfo, UpdateInfo } from "@/types";

export const updateMessages = defineMessages({
  en: {
    available: (v: string) => `Zefaro ${v} is available`,
    availableBody: (current: string) => `You have ${current}. Download the new installer and run it over this one; your sites and settings stay.`,
    download: "Download",
    upToDate: (v: string) => `Zefaro ${v} is the latest version`,
    failed: "Zefaro couldn't check for updates",
  },
  id: {
    available: (v: string) => `Zefaro ${v} sudah tersedia`,
    availableBody: (current: string) => `Versi Anda ${current}. Unduh installer baru lalu jalankan di atas versi ini; situs dan pengaturan Anda tetap.`,
    download: "Unduh",
    upToDate: (v: string) => `Zefaro ${v} adalah versi terbaru`,
    failed: "Zefaro tidak bisa memeriksa pembaruan",
  },
});

/** Tell the user about a newer version, with a button to its release page. */
export function announceUpdate(u: UpdateInfo, t: (typeof updateMessages)["en"]) {
  toast.info(t.available(u.latest), {
    id: "zefaro-update",
    description: t.availableBody(u.current),
    duration: 15000,
    action: { label: t.download, onClick: () => openUrl(u.url).catch((e) => toast.error(String(e))) },
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
