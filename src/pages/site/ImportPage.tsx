import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api } from "@/api";
import type { ImportSource, OldServer } from "@/types";
import { Icon } from "@/components/icon";
import { BackButton } from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, useT } from "@/i18n";
import { frameworkInfo } from "@/lib/frameworks";

const messages = defineMessages({
  en: {
    back: "Sites",
    title: "Import from XAMPP or Laragon",
    description: "Zefaro links your projects where they are, so nothing is moved or copied, and copies databases from the old MySQL into Zefaro's MariaDB.",
    projects: "Projects",
    projectsHint: "Each project you pick is linked at name.test. The old tool can stay installed.",
    noneFound: "Zefaro didn't find XAMPP (htdocs) or Laragon (www). Choose a folder of projects instead.",
    other: "Choose another folder",
    chooseFolder: "Choose a folder that holds projects",
    linked: "Linked",
    empty: "No project folders here.",
    linkSelected: (n: number) => `Link ${n} ${n === 1 ? "project" : "projects"}`,
    linkedDone: (n: number) => `Linked ${n} ${n === 1 ? "project" : "projects"}`,
    databases: "Databases",
    steps: [
      "Stop Zefaro's MariaDB (Services) and start MySQL in XAMPP or Laragon.",
      "Pick databases and copy them out. Zefaro saves them as compressed files.",
      "Stop the old MySQL, start Zefaro's MariaDB, then load them.",
    ],
    oldRunning: "Zefaro reached the old MySQL on port 3306.",
    oldStopped: "No old MySQL is answering on port 3306.",
    zefaroRunning: "Zefaro's MariaDB is running, so the old MySQL can't be reached. Stop it to copy databases out.",
    copy: (n: number) => `Copy ${n} out`,
    copied: (n: number) => `Copied ${n} ${n === 1 ? "database" : "databases"}`,
    waiting: (names: string) => `Ready to load: ${names}`,
    load: "Load into Zefaro",
    loaded: (n: number) => `Loaded ${n} ${n === 1 ? "database" : "databases"} into MariaDB`,
    loadNeedsZefaro: "Start Zefaro's MariaDB to load them.",
    refresh: "Check again",
    tables: (n: number) => `${n} tables`,
  },
  id: {
    back: "Situs",
    title: "Impor dari XAMPP atau Laragon",
    description: "Zefaro menautkan proyek Anda di tempatnya, jadi tidak ada yang dipindah atau disalin, dan menyalin database dari MySQL lama ke MariaDB milik Zefaro.",
    projects: "Proyek",
    projectsHint: "Setiap proyek yang dipilih ditautkan di name.test. Alat lama boleh tetap terpasang.",
    noneFound: "Zefaro tidak menemukan XAMPP (htdocs) atau Laragon (www). Pilih folder berisi proyek.",
    other: "Pilih folder lain",
    chooseFolder: "Pilih folder yang berisi proyek",
    linked: "Tertaut",
    empty: "Tidak ada folder proyek di sini.",
    linkSelected: (n: number) => `Tautkan ${n} proyek`,
    linkedDone: (n: number) => `${n} proyek ditautkan`,
    databases: "Database",
    steps: [
      "Hentikan MariaDB milik Zefaro (Layanan) lalu jalankan MySQL di XAMPP atau Laragon.",
      "Pilih database lalu salin keluar. Zefaro menyimpannya sebagai file terkompresi.",
      "Hentikan MySQL lama, mulai MariaDB milik Zefaro, lalu muat.",
    ],
    oldRunning: "Zefaro terhubung ke MySQL lama di port 3306.",
    oldStopped: "Belum ada MySQL lama yang menjawab di port 3306.",
    zefaroRunning: "MariaDB milik Zefaro sedang berjalan, jadi MySQL lama tidak bisa dijangkau. Hentikan dulu untuk menyalin database.",
    copy: (n: number) => `Salin ${n} keluar`,
    copied: (n: number) => `${n} database disalin`,
    waiting: (names: string) => `Siap dimuat: ${names}`,
    load: "Muat ke Zefaro",
    loaded: (n: number) => `${n} database dimuat ke MariaDB`,
    loadNeedsZefaro: "Mulai MariaDB milik Zefaro untuk memuatnya.",
    refresh: "Periksa lagi",
    tables: (n: number) => `${n} tabel`,
  },
});

const LABEL: Record<string, string> = { xampp: "XAMPP", laragon: "Laragon", folder: "" };

export function ImportPage({ onBack }: { onBack: () => void }) {
  const t = useT(messages);
  const [extra, setExtra] = useState<string | null>(null);
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [server, setServer] = useState<OldServer | null>(null);
  const [dbs, setDbs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const scan = useCallback(() => {
    api
      .importScan(extra)
      .then(setSources)
      .catch((e) => toast.error(String(e)));
  }, [extra]);
  const loadServer = useCallback(() => {
    api
      .importDbStatus()
      .then(setServer)
      .catch((e) => toast.error(String(e)));
  }, []);

  useEffect(scan, [scan]);
  useEffect(loadServer, [loadServer]);

  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const work = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  };

  const linkPicked = () =>
    work("link", async () => {
      const results = await api.importLink([...picked]);
      const ok = results.filter((r) => r.site);
      if (ok.length) toast.success(t.linkedDone(ok.length), { description: ok.map((r) => r.site!.url).join(", ") });
      for (const r of results.filter((r) => r.error)) toast.error(r.error!, { description: r.path });
      setPicked(new Set());
      scan();
    });

  const browse = async () => {
    const dir = await openDialog({ directory: true, title: t.chooseFolder });
    if (typeof dir === "string") setExtra(dir);
  };

  return (
    <>
      <BackButton label={t.back} onClick={onBack} />
      <div className="mb-6 space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t.title}</h2>
        <p className="text-sm text-muted-foreground">{t.description}</p>
      </div>

      <Card className="mb-4 gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">{t.projects}</h3>
            <p className="text-xs text-muted-foreground">{t.projectsHint}</p>
          </div>
          <Button size="sm" variant="outline" onClick={browse}>
            <Icon name="folder-open" />
            {t.other}
          </Button>
        </div>
        {sources === null ? (
          <Skeleton className="h-24 w-full" />
        ) : sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noneFound}</p>
        ) : (
          sources.map((s) => (
            <div key={s.root} className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {LABEL[s.kind] && <Badge variant="secondary">{LABEL[s.kind]}</Badge>}
                <span className="truncate font-mono">{s.root}</span>
              </div>
              {s.projects.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t.empty}</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {s.projects.map((p) => {
                    const fw = frameworkInfo(p.framework ?? undefined);
                    return (
                      <li key={p.path}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm has-disabled:cursor-default has-disabled:opacity-60">
                          <Checkbox
                            checked={picked.has(p.path)}
                            disabled={p.linked}
                            onCheckedChange={() => setPicked((cur) => toggle(cur, p.path))}
                          />
                          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" title={fw?.name}>
                            <Icon name={fw?.icon ?? "folder"} variant={fw?.brand ? "brands" : "solid"} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{p.folder}</span>
                            <span className="block truncate text-xs text-muted-foreground">{p.site}.test</span>
                          </span>
                          {p.linked && <Badge variant="outline">{t.linked}</Badge>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))
        )}
        <div>
          <Button onClick={linkPicked} disabled={picked.size === 0 || busy !== null}>
            {busy === "link" ? <Spinner className="size-3" /> : <Icon name="link" />}
            {t.linkSelected(picked.size)}
          </Button>
        </div>
      </Card>

      <Card className="gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-sm font-medium">{t.databases}</h3>
          <Button size="sm" variant="ghost" onClick={loadServer} disabled={busy !== null}>
            <Icon name="rotate" className="w-3" />
            {t.refresh}
          </Button>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {t.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {server === null ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm">
              <Icon
                name={server.running ? "circle-check" : "circle-info"}
                className={server.running ? "text-success" : "text-muted-foreground"}
              />
              {server.zefaroRunning ? t.zefaroRunning : server.running ? t.oldRunning : t.oldStopped}
            </p>
            {server.error && <p className="text-xs text-destructive">{server.error}</p>}
            {server.databases.length > 0 && (
              <>
                <ul className="divide-y rounded-lg border">
                  {server.databases.map((d) => (
                    <li key={d.name}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                        <Checkbox checked={dbs.has(d.name)} onCheckedChange={() => setDbs((cur) => toggle(cur, d.name))} />
                        <Icon name="database" className="text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                        <span className="text-xs text-muted-foreground">{t.tables(d.tables)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div>
                  <Button
                    variant="outline"
                    disabled={dbs.size === 0 || busy !== null}
                    onClick={() =>
                      work("dump", async () => {
                        const done = await api.importDbDump([...dbs]);
                        toast.success(t.copied(done.length), { description: done.join(", ") });
                        setDbs(new Set());
                        loadServer();
                      })
                    }
                  >
                    {busy === "dump" ? <Spinner className="size-3" /> : <Icon name="file-export" />}
                    {t.copy(dbs.size)}
                  </Button>
                </div>
              </>
            )}
            {server.waiting.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 p-3 text-sm">
                <Icon name="box-archive" className="text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  {t.waiting(server.waiting.join(", "))}
                  {!server.zefaroRunning && <span className="block text-xs text-muted-foreground">{t.loadNeedsZefaro}</span>}
                </span>
                <Button
                  disabled={!server.zefaroRunning || busy !== null}
                  onClick={() =>
                    work("load", async () => {
                      const done = await api.importDbLoad();
                      toast.success(t.loaded(done.length), { description: done.join(", ") });
                      loadServer();
                    })
                  }
                >
                  {busy === "load" ? <Spinner className="size-3" /> : <Icon name="file-import" />}
                  {t.load}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
