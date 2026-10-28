import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, localeOf, useLang, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    title: "HTTPS certificates for PHP",
    body: (date: string | null, zefaro: boolean) =>
      `${date ? `Mozilla's list of trusted authorities, downloaded ${date}.` : "Mozilla's list of trusted authorities isn't downloaded yet."} ${
        zefaro ? "Zefaro's own authority is included, so PHP code can call your secured .test sites." : "Zefaro's own authority is added once you secure a site."
      } Zefaro downloads the list again every 30 days.`,
    update: "Update now",
    updated: "PHP's certificate list is up to date",
  },
  id: {
    title: "Sertifikat HTTPS untuk PHP",
    body: (date: string | null, zefaro: boolean) =>
      `${date ? `Daftar otoritas tepercaya dari Mozilla, diunduh ${date}.` : "Daftar otoritas tepercaya dari Mozilla belum diunduh."} ${
        zefaro ? "Otoritas milik Zefaro ikut di dalamnya, jadi kode PHP bisa memanggil situs .test Anda yang aman." : "Otoritas milik Zefaro ditambahkan setelah Anda mengamankan sebuah situs."
      } Zefaro mengunduh ulang daftar ini setiap 30 hari.`,
    update: "Perbarui sekarang",
    updated: "Daftar sertifikat PHP sudah terbaru",
  },
});

/** The CA bundle php.ini points curl and OpenSSL at. */
export function CaBundleRow() {
  const t = useT(messages);
  const { lang } = useLang();
  const [state, setState] = useState<{ updatedMs: number | null; hasZefaroCa: boolean; path: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.phpCaBundle().then(setState).catch(() => {});
  }, []);

  const update = async () => {
    setBusy(true);
    try {
      setState(await api.phpCaBundleUpdate());
      toast.success(t.updated);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const date = state?.updatedMs ? new Date(state.updatedMs).toLocaleDateString(localeOf(lang), { dateStyle: "medium" }) : null;
  return (
    <Item className="px-4 py-3">
      <ItemMedia className="size-10 rounded-lg bg-muted text-muted-foreground">
        <Icon name="certificate" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t.title}</ItemTitle>
        <ItemDescription title={state?.path}>{state ? t.body(date, state.hasZefaroCa) : "…"}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="outline" disabled={busy || !state} onClick={update}>
          {busy ? <Spinner /> : <Icon name="rotate" className="w-3" />}
          {t.update}
        </Button>
      </ItemActions>
    </Item>
  );
}
