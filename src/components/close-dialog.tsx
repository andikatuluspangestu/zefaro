import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { api } from "@/api";
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
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    title: "Keep Zefaro running in the system tray?",
    body: "Your sites and services keep working while the window is closed. Click Zefaro's icon in the system tray to open it again, or right-click it to quit.",
    later: "You can change this in Settings.",
    quit: "Quit and stop services",
    keep: "Keep running in the tray",
  },
  id: {
    title: "Biarkan Zefaro tetap berjalan di system tray?",
    body: "Situs dan layanan Anda tetap bekerja saat jendela ditutup. Klik ikon Zefaro di system tray untuk membukanya lagi, atau klik kanan untuk keluar.",
    later: "Anda bisa mengubahnya di Pengaturan.",
    quit: "Keluar dan hentikan layanan",
    keep: "Tetap jalan di tray",
  },
});

/**
 * Asks, the first time the window is closed, whether Zefaro should keep running
 * in the system tray. The backend sends `zefaro://close-asked` until the user answers.
 */
export function CloseDialog() {
  const t = useT(messages);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const off = listen("zefaro://close-asked", () => setOpen(true));
    return () => {
      off.then((f) => f());
    };
  }, []);

  const answer = (keepRunning: boolean) => {
    setOpen(false);
    api.closeWindow(keepRunning).catch((e) => toast.error(String(e)));
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.body} {t.later}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>{t.quit}</AlertDialogCancel>
          <AlertDialogAction onClick={() => answer(true)}>{t.keep}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
