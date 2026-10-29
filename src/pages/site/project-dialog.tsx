import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { defineMessages, useT } from "@/i18n";
import type { ProjectPreview, Site } from "@/types";

const messages = defineMessages({
  en: {
    title: "This folder has a zefaro.json",
    body: "It sets the site up the way the project expects. Apply it, or link the folder with Zefaro's defaults.",
    name: "Site",
    php: "PHP",
    notInstalled: "not installed, the active version is used",
    https: "HTTPS",
    on: "On",
    proxy: "Dev server",
    services: "Starts",
    database: "Creates database",
    workers: "Workers",
    taken: (name: string) => `A site named ${name} already exists, so it can't be linked again.`,
    apply: "Link and apply",
    plain: "Link only",
    cancel: "Cancel",
    applied: (name: string) => `Linked ${name} and applied zefaro.json`,
  },
  id: {
    title: "Folder ini punya zefaro.json",
    body: "File itu menyiapkan situs sesuai kebutuhan proyek. Terapkan, atau tautkan folder dengan pengaturan bawaan Zefaro.",
    name: "Situs",
    php: "PHP",
    notInstalled: "belum terpasang, versi aktif yang dipakai",
    https: "HTTPS",
    on: "Aktif",
    proxy: "Dev server",
    services: "Menjalankan",
    database: "Membuat database",
    workers: "Worker",
    taken: (name: string) => `Situs bernama ${name} sudah ada, jadi tidak bisa ditautkan lagi.`,
    apply: "Tautkan dan terapkan",
    plain: "Tautkan saja",
    cancel: "Batal",
    applied: (name: string) => `${name} ditautkan dan zefaro.json diterapkan`,
  },
});

/** Asks whether to apply a folder's zefaro.json when linking it. */
export function ProjectLinkDialog({
  path,
  preview,
  onClose,
  onLinkPlain,
  onLinked,
}: {
  path: string;
  preview: ProjectPreview;
  onClose: () => void;
  onLinkPlain: () => void;
  onLinked: (site: Site) => void;
}) {
  const t = useT(messages);
  const [busy, setBusy] = useState(false);
  const f = preview.file;
  const rows: [string, string][] = [
    [t.name, `${preview.name}.test`],
    ...(f.proxy ? ([[t.proxy, `localhost:${f.proxy}`]] as [string, string][]) : []),
    ...(f.php && !f.proxy ? ([[t.php, preview.phpInstalled ? f.php : `${f.php} (${t.notInstalled})`]] as [string, string][]) : []),
    ...(f.https ? ([[t.https, t.on]] as [string, string][]) : []),
    ...(f.services?.length ? ([[t.services, f.services.join(", ")]] as [string, string][]) : []),
    ...(f.database ? ([[t.database, `${f.database.name} (${f.database.driver})`]] as [string, string][]) : []),
    ...(f.workers?.length ? ([[t.workers, f.workers.map((w) => w.label).join(", ")]] as [string, string][]) : []),
  ];

  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.projectLink(path);
      toast.success(t.applied(r.site.name), { description: r.done.join(" ") });
      for (const w of r.warnings) toast.warning(w, { duration: 10000 });
      onLinked(r.site);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icon name="file-code" className="text-primary" />
            {t.title}
          </AlertDialogTitle>
          <AlertDialogDescription>{t.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="divide-y rounded-lg border text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate text-right font-medium" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {preview.nameTaken && <p className="text-sm text-destructive">{t.taken(preview.name)}</p>}
        <AlertDialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t.cancel}
          </Button>
          <Button
            variant="outline"
            disabled={busy || preview.nameTaken}
            onClick={() => {
              onClose();
              onLinkPlain();
            }}
          >
            {t.plain}
          </Button>
          <Button onClick={apply} disabled={busy || preview.nameTaken}>
            {busy ? <Spinner className="size-3" /> : <Icon name="check" />}
            {t.apply}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
