import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { CaStatus } from "@/types";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";

const messages = defineMessages({
  en: {
    trust: {
      button: "Trust certificate…",
      title: "Trust Zefaro's certificate authority?",
      what: "Zefaro signs a certificate for each site you secure. So that browsers accept them, Zefaro adds its certificate authority to the trusted certificates of your Windows account. You don't need administrator rights.",
      scope: (names: ReactNode) => (
        <>
          It can only sign for {names} names, so browsers reject anything it signs for real websites. Its private key
          is encrypted so that only your Windows account can use it.
        </>
      ),
      check: (name: ReactNode, thumbprint: ReactNode | null) => (
        <>
          Windows then shows its own security warning. Check that it names {name}
          {thumbprint && <> with thumbprint {thumbprint}</>}, then choose Yes. You can remove the trust at any time in
          Settings.
        </>
      ),
      confirm: "Trust certificate",
      done: "Browsers now trust Zefaro's HTTPS certificates",
      doneHint: "Restart your browser if a site still shows a warning.",
    },
    untrust: {
      button: "Remove trust…",
      title: "Stop trusting Zefaro's certificates?",
      body: "Zefaro removes its certificate authority from your trusted certificates, and Windows asks you to confirm. Secured sites still load, but browsers warn that the connection isn't private until you trust it again.",
      confirm: "Remove trust",
      done: "Windows no longer trusts Zefaro's certificate authority",
    },
  },
  id: {
    trust: {
      button: "Percayai sertifikat…",
      title: "Percayai otoritas sertifikat Zefaro?",
      what: "Zefaro menandatangani sertifikat untuk setiap situs yang Anda amankan. Agar browser menerimanya, Zefaro menambahkan otoritas sertifikatnya ke sertifikat tepercaya akun Windows Anda. Anda tidak perlu hak admin.",
      scope: (names: ReactNode) => (
        <>
          Otoritas ini hanya bisa menandatangani nama {names}, jadi browser menolak apa pun yang ditandatanganinya untuk
          situs web sungguhan. Kunci privatnya dienkripsi sehingga hanya akun Windows Anda yang bisa memakainya.
        </>
      ),
      check: (name: ReactNode, thumbprint: ReactNode | null) => (
        <>
          Lalu Windows menampilkan peringatan keamanannya sendiri. Pastikan peringatan itu menyebut {name}
          {thumbprint && <> dengan thumbprint {thumbprint}</>}, lalu pilih Yes (Ya). Anda bisa menghapus kepercayaan ini
          kapan saja di Pengaturan.
        </>
      ),
      confirm: "Percayai sertifikat",
      done: "Browser kini memercayai sertifikat HTTPS Zefaro",
      doneHint: "Mulai ulang browser Anda jika situs masih menampilkan peringatan.",
    },
    untrust: {
      button: "Hapus kepercayaan…",
      title: "Berhenti memercayai sertifikat Zefaro?",
      body: "Zefaro menghapus otoritas sertifikatnya dari sertifikat tepercaya Anda, dan Windows akan meminta konfirmasi Anda. Situs yang diamankan tetap bisa dibuka, tetapi browser memperingatkan bahwa koneksinya tidak privat sampai Anda memercayainya lagi.",
      confirm: "Hapus kepercayaan",
      done: "Windows tidak lagi memercayai otoritas sertifikat Zefaro",
    },
  },
});

/** Zefaro's CA status, reloaded whenever something changes (`zefaro:refresh`). */
export function useCaStatus() {
  const [status, setStatus] = useState<CaStatus | null>(null);
  const reload = useCallback(() => {
    api.caStatus().then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener("zefaro:refresh", reload);
    return () => window.removeEventListener("zefaro:refresh", reload);
  }, [reload]);
  return status;
}

/** "AB12CD…" → "AB12 CD34 …", easier to compare with Windows' dialog. */
function groupHex(hex: string) {
  return hex.match(/.{1,4}/g)?.join(" ") ?? hex;
}

/**
 * Explains what trusting does, then asks Windows to add the CA. Windows shows
 * its own security warning, which the user must accept.
 */
export function TrustCaButton({
  status,
  size = "sm",
  variant = "default",
}: {
  status: CaStatus | null;
  size?: "sm" | "default";
  variant?: "default" | "outline";
}) {
  const t = useT(messages).trust;
  const c = useT(common);
  const [busy, setBusy] = useState(false);
  const tld = status?.tld ?? "test";

  const trust = async () => {
    setBusy(true);
    try {
      const s = await api.caTrust();
      if (s.trusted) {
        toast.success(t.done, { description: t.doneHint });
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size={size} variant={variant} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="shield-halved" />}
          {t.button}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>{t.what}</p>
              <p>{t.scope(<span className="font-mono">*.{tld}</span>)}</p>
              <p>
                {t.check(
                  <span className="font-medium text-foreground">Zefaro Local CA (.{tld})</span>,
                  status?.thumbprint ? (
                    <span className="font-mono text-xs break-all text-foreground">
                      {groupHex(status.thumbprint)}
                    </span>
                  ) : null,
                )}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={trust}>{t.confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Removes the CA from the trusted certificates (Windows asks to confirm). */
export function UntrustCaButton() {
  const t = useT(messages).untrust;
  const c = useT(common);
  const [busy, setBusy] = useState(false);
  const untrust = async () => {
    setBusy(true);
    try {
      const s = await api.caUntrust();
      if (!s.trusted) toast(t.done);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy}>
          {busy ? <Spinner /> : <Icon name="shield" />}
          {t.button}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title}</AlertDialogTitle>
          <AlertDialogDescription>{t.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={untrust}>
            {t.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
