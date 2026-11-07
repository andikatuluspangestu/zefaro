import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { defineMessages, useT } from "@/i18n";
import type { Snapshot, SnapshotsView } from "./types";

const messages = defineMessages({
  en: {
    title: "Snapshots",
    hint: (target: string) => `Save ${target} as it is now, and put it back later in one click.`,
    label: "Note (optional)",
    labelPlaceholder: "before migrate:fresh",
    take: "Take snapshot",
    taking: "Taking a snapshot…",
    taken: "Snapshot saved",
    none: "No snapshots yet. Take one before a migration or a risky change.",
    restore: "Restore",
    restoring: "Restoring…",
    restored: "Database restored from the snapshot",
    remove: "Delete snapshot",
    removed: "Snapshot deleted",
    confirmTitle: "Restore this snapshot?",
    confirmBody: (when: string, target: string) =>
      `${target} goes back to how it was at ${when}. Everything in it now, including tables and rows added since, is replaced.`,
    confirm: "Restore",
    cancel: "Cancel",
    deleteTitle: "Delete this snapshot?",
    deleteBody: "The snapshot file is deleted. The database itself doesn't change.",
    deleteConfirm: "Delete",
  },
  id: {
    title: "Snapshot",
    hint: (target: string) => `Simpan ${target} seperti sekarang, lalu kembalikan nanti dengan sekali klik.`,
    label: "Catatan (opsional)",
    labelPlaceholder: "sebelum migrate:fresh",
    take: "Ambil snapshot",
    taking: "Mengambil snapshot…",
    taken: "Snapshot disimpan",
    none: "Belum ada snapshot. Ambil satu sebelum migrasi atau perubahan berisiko.",
    restore: "Pulihkan",
    restoring: "Memulihkan…",
    restored: "Database dipulihkan dari snapshot",
    remove: "Hapus snapshot",
    removed: "Snapshot dihapus",
    confirmTitle: "Pulihkan snapshot ini?",
    confirmBody: (when: string, target: string) =>
      `${target} kembali seperti pada ${when}. Semua isinya sekarang, termasuk tabel dan baris yang ditambahkan sejak itu, akan diganti.`,
    confirm: "Pulihkan",
    cancel: "Batal",
    deleteTitle: "Hapus snapshot ini?",
    deleteBody: "File snapshot dihapus. Database-nya sendiri tidak berubah.",
    deleteConfirm: "Hapus",
  },
});

const size = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** Above the Data tab's tables: take, restore and delete snapshots of the site's database. */
export function Snapshots({ site, onRestored }: { site: string; onRestored: () => void }) {
  const t = useT(messages);
  const [view, setView] = useState<SnapshotsView | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<"take" | string | null>(null);
  const [toRestore, setToRestore] = useState<Snapshot | null>(null);
  const [toDelete, setToDelete] = useState<Snapshot | null>(null);

  const load = useCallback(() => api.siteSnapshots(site).then(setView).catch((e) => toast.error(String(e))), [site]);
  useEffect(() => {
    load();
  }, [load]);

  if (!view) return null;
  // No database Zefaro can snapshot, and none taken before: stay out of the way.
  if (!view.target && view.snapshots.length === 0) return null;

  const take = async () => {
    setBusy("take");
    try {
      await api.siteSnapshotTake(site, label);
      setLabel("");
      toast.success(t.taken);
      await load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  };
  const restore = async (s: Snapshot) => {
    setToRestore(null);
    setBusy(s.id);
    try {
      await api.siteSnapshotRestore(site, s.id);
      toast.success(t.restored);
      onRestored();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (s: Snapshot) => {
    setToDelete(null);
    try {
      await api.siteSnapshotDelete(site, s.id);
      toast.success(t.removed);
      await load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <Card className="mb-4 gap-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="camera" className="text-muted-foreground" />
            {t.title}
          </h3>
          <p className="text-xs text-muted-foreground">{view.target ? t.hint(view.target) : view.problem}</p>
        </div>
        {view.target && (
          <div className="flex gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t.labelPlaceholder}
              aria-label={t.label}
              maxLength={80}
              className="h-8 w-full sm:w-56"
              disabled={busy !== null}
            />
            <Button size="sm" onClick={take} disabled={busy !== null}>
              {busy === "take" ? <Spinner className="size-3.5" /> : <Icon name="camera" />}
              {busy === "take" ? t.taking : t.take}
            </Button>
          </div>
        )}
      </div>
      {view.snapshots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.none}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {view.snapshots.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{s.label || when(s.createdMs)}</span>
                {s.label && <span className="ml-2 text-muted-foreground">{when(s.createdMs)}</span>}
              </span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{size(s.bytes)}</span>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setToRestore(s)}>
                {busy === s.id ? <Spinner className="size-3.5" /> : <Icon name="clock-rotate-left" />}
                {busy === s.id ? t.restoring : t.restore}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={t.remove} disabled={busy !== null} onClick={() => setToDelete(s)}>
                    <Icon name="trash-can" variant="regular" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t.remove}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!toRestore} onOpenChange={(o) => !o && setToRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {toRestore && t.confirmBody(when(toRestore.createdMs), view.target ?? toRestore.database)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <Button variant="destructive" onClick={() => toRestore && restore(toRestore)}>
              {t.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <Button variant="destructive" onClick={() => toDelete && remove(toDelete)}>
              {t.deleteConfirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
