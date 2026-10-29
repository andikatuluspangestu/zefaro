import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { DumpEntry, DumpsStatus } from "@/types";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { defineMessages, localeOf, useLang, useT } from "@/i18n";
import { DumpTree } from "@/pages/site/dump-tree";

const messages = defineMessages({
  en: {
    description: "dump() and dd() from your sites appear here instead of in the page.",
    catch: "Catch dumps",
    catchOn: "Sites send dump() and dd() here. Pages no longer show them.",
    catchOff: "Off: dumps print into the page as usual.",
    notRunning: "The receiver isn't running. Turn catching off and on again, or check the Logs page.",
    clear: "Clear",
    empty: "No dumps yet. Call dump($value) in a site, then load the page.",
    emptyOff: "Turn on catching, then call dump($value) in a site.",
    how: "Works with apps that use Symfony's VarDumper: Laravel, Symfony and most Composer projects. Plain var_dump() still prints into the page.",
  },
  id: {
    description: "dump() dan dd() dari situs Anda muncul di sini, bukan di halaman.",
    catch: "Tangkap dump",
    catchOn: "Situs mengirim dump() dan dd() ke sini. Halaman tidak lagi menampilkannya.",
    catchOff: "Mati: dump tampil di halaman seperti biasa.",
    notRunning: "Penerima dump tidak berjalan. Matikan lalu nyalakan lagi, atau lihat halaman Log.",
    clear: "Bersihkan",
    empty: "Belum ada dump. Panggil dump($value) di situs, lalu muat halamannya.",
    emptyOff: "Nyalakan penangkapan, lalu panggil dump($value) di situs.",
    how: "Bekerja untuk aplikasi yang memakai VarDumper dari Symfony: Laravel, Symfony, dan kebanyakan proyek Composer. var_dump() biasa tetap tampil di halaman.",
  },
});

export function DumpsPage() {
  const t = useT(messages);
  const { lang } = useLang();
  const [status, setStatus] = useState<DumpsStatus | null>(null);
  const [dumps, setDumps] = useState<DumpEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.dumpsList().then(setDumps).catch(() => setDumps([]));
  }, []);

  useEffect(() => {
    api.dumpsStatus().then(setStatus).catch((e) => toast.error(String(e)));
    load();
  }, [load]);

  // New dumps arrive while the page is open.
  useEffect(() => {
    if (!status?.enabled) return;
    const timer = window.setInterval(load, 1500);
    return () => window.clearInterval(timer);
  }, [status?.enabled, load]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      setStatus(await api.dumpsSetEnabled(on));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = () =>
    api
      .dumpsClear()
      .then(() => setDumps([]))
      .catch((e) => toast.error(String(e)));

  const time = (s: number) => new Date(s * 1000).toLocaleTimeString(localeOf(lang), { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <>
      <PageHeader
        title="Dump"
        description={t.description}
        actions={
          <Button variant="outline" onClick={clear} disabled={!dumps?.length}>
            <Icon name="trash-can" variant="regular" />
            {t.clear}
          </Button>
        }
      />
      <Card className="mb-4 gap-2 p-4">
        {status === null ? (
          <Skeleton className="h-6 w-full" />
        ) : (
          <label className="flex items-start gap-3 text-sm">
            <Icon name="bug" className="mt-0.5 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t.catch}</span>
              <span className="block text-xs text-muted-foreground">
                {status.enabled ? (status.running ? t.catchOn : t.notRunning) : t.catchOff}
              </span>
            </span>
            <Switch checked={status.enabled} disabled={busy} onCheckedChange={toggle} aria-label={t.catch} />
          </label>
        )}
        <p className="text-xs text-muted-foreground">{t.how}</p>
      </Card>

      {dumps === null ? (
        <Skeleton className="h-32 w-full" />
      ) : dumps.length === 0 ? (
        <Card className="items-center p-8 text-center text-sm text-muted-foreground">{status?.enabled ? t.empty : t.emptyOff}</Card>
      ) : (
        <div className="space-y-3">
          {dumps.map((d) => (
            <Card key={d.id} className="gap-2 p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="tabular-nums">{time(d.time)}</span>
                {d.name && (
                  <span className="font-mono text-foreground/80" title={d.file ?? undefined}>
                    {d.name}
                    {d.line ? `:${d.line}` : ""}
                  </span>
                )}
                {d.command && <span className="truncate font-mono">{d.command}</span>}
              </div>
              <div className="max-h-[28rem] overflow-auto font-mono text-xs break-all">
                <DumpTree node={d.node} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
