import { useState } from "react";
import type { AppInfo, UpdateInfo } from "@/types";
import { releases } from "@/lib/changelog";
import { Icon } from "@/components/icon";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/settings-layout";
import { openUpdateDialog } from "@/components/update-check";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { defineMessages, localeOf, useLang, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    title: "Release notes",
    description: "What changed in each version of Zefaro. They're kept inside Zefaro, so they open without the internet.",
    newer: (v: string) => `Zefaro ${v} is available`,
    newerHint: "From the release itself; Zefaro read it when it checked for updates.",
    updateNow: "Update now",
    version: (v: string) => `Zefaro ${v}`,
    installed: "Installed",
    older: "Older",
    show: "Show notes",
    hide: "Hide notes",
    englishOnly: "The notes are written in English.",
  },
  id: {
    title: "Catatan rilis",
    description: "Perubahan di setiap versi Zefaro. Catatannya tersimpan di dalam Zefaro, jadi bisa dibuka tanpa internet.",
    newer: (v: string) => `Zefaro ${v} sudah tersedia`,
    newerHint: "Dari rilisnya langsung; Zefaro membacanya saat memeriksa pembaruan.",
    updateNow: "Perbarui sekarang",
    version: (v: string) => `Zefaro ${v}`,
    installed: "Terpasang",
    older: "Lebih lama",
    show: "Tampilkan catatan",
    hide: "Sembunyikan catatan",
    englishOnly: "Catatan ditulis dalam bahasa Inggris.",
  },
});

const NOTES = "space-y-3 text-sm leading-relaxed text-muted-foreground";

/** The notes of every Zefaro version, opened from Settings → Updates and backup. */
export function ReleaseNotesPage({
  info,
  newer,
  backLabel,
  onBack,
}: {
  info: AppInfo | null;
  /** A newer version the last check found, with the notes of its release. */
  newer: UpdateInfo | null;
  backLabel: string;
  onBack: () => void;
}) {
  const t = useT(messages);
  const { lang } = useLang();
  // The installed version opens by itself; older ones open on request.
  const [open, setOpen] = useState<Set<string>>(() => new Set(info?.version ? [info.version] : [releases[0]?.version ?? ""]));
  const toggle = (v: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(v)) next.add(v);
      return next;
    });
  const date = (iso: string | null | undefined) =>
    iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(localeOf(lang), { dateStyle: "long" }) : null;

  const installed = info?.version ?? null;

  return (
    <>
      <BackButton label={backLabel} onClick={onBack} />
      <PageHeader title={t.title} description={t.description} />
      <div className="space-y-4">
        {newer && (
          <Card className="gap-3 border-primary/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Icon name="circle-arrow-up" className="text-primary" />
              <h3 className="text-sm font-semibold">{t.newer(newer.latest)}</h3>
              {newer.published && <span className="text-xs text-muted-foreground">{date(newer.published)}</span>}
              {newer.canInstall && (
                <Button size="sm" className="ml-auto" onClick={() => openUpdateDialog(newer)}>
                  <Icon name="download" />
                  {t.updateNow}
                </Button>
              )}
            </div>
            {newer.notes ? (
              <>
                <Markdown text={newer.notes.replace(/^#\s+Zefaro\b[^\n]*\n+/, "")} className={NOTES} />
                <p className="text-xs text-muted-foreground">{t.newerHint}</p>
              </>
            ) : null}
          </Card>
        )}

        {releases.map((r) => {
          const current = r.version === installed;
          const shown = open.has(r.version);
          return (
            <Card key={r.version} className="gap-0 overflow-hidden py-0">
              <button
                type="button"
                aria-expanded={shown}
                onClick={() => toggle(r.version)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Icon name={shown ? "chevron-down" : "chevron-right"} className="w-3 text-muted-foreground" />
                <span className="text-sm font-semibold">{t.version(r.version)}</span>
                {current && (
                  <Badge variant="secondary" className="gap-1.5">
                    <Icon name="circle-check" className="w-3 text-success" />
                    {t.installed}
                  </Badge>
                )}
                {r.date && <span className="text-xs text-muted-foreground">{date(r.date)}</span>}
                <span className="sr-only">{shown ? t.hide : t.show}</span>
              </button>
              {shown && (
                <div className="border-t px-4 py-4">
                  <Markdown text={r.body} className={NOTES} />
                </div>
              )}
            </Card>
          );
        })}
        {lang === "id" && <p className="text-xs text-muted-foreground">{t.englishOnly}</p>}
      </div>
    </>
  );
}
