import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { InstallProgress, NodeVersion, NodeVersionsResponse } from "@/types";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { PageHeader } from "@/components/page-header";
import { PathCard } from "@/components/path-card";
import { BackButton } from "@/components/settings-layout";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Section } from "./php/section";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";

const Code = ({ children }: { children: ReactNode }) => <code className="font-mono">{children}</code>;

const messages = defineMessages({
  en: {
    downloading: "Downloading…",
    downloadingPct: (pct: number) => `Downloading ${pct}%`,
    extracting: "Extracting…",
    checking: "Checking…",
    installed: (v: string) => `Node.js ${v} installed`,
    activated: (v: string) => `Node.js ${v} is now active`,
    removed: (v: string) => `Removed Node.js ${v}`,
    title: "Node.js versions",
    description: "Install Node.js versions and choose the one node, npm and npx use.",
    versions: "Versions",
    offlineTitle: "Couldn't reach nodejs.org",
    offlineBody: "Only installed versions are listed. Check your connection, then reopen this page.",
    noVersions: "No versions to show.",
    colVersion: "Node.js version",
    colProvider: "Provider",
    colInstalled: "Installed",
    colActive: "Active",
    colOptions: "Options",
    ltsCodename: (name: string) => `LTS codename: ${name}`,
    providerTitle: "Official builds from nodejs.org (Windows x64 zip)",
    official: "Official · x64",
    installedBadge: "Installed",
    update: "Update",
    updateTo: (v: string) => `Update to ${v}`,
    active: "Active",
    activate: "Activate",
    uninstallLabel: (v: string) => `Uninstall Node.js ${v}`,
    uninstallTitle: (v: string | null) => `Uninstall Node.js ${v}?`,
    uninstallBody: (active: boolean) => (
      <>
        Zefaro deletes its folder. Your projects stay, and so do packages you installed with{" "}
        <Code>npm install -g</Code> (in <Code>{"%APPDATA%\\npm"}</Code>).
        {active && " Zefaro makes the newest remaining version active."}
      </>
    ),
    uninstall: "Uninstall",
    commandLine: "Command line",
    commands: "node, npm and npx",
    commandHelp: (
      <>
        The active version answers <Code>node</Code>, <Code>npm</Code>, <Code>npx</Code> and{" "}
        <Code>corepack</Code>. For example, use <Code>npm run dev</Code> for a Laravel app's Vite assets.
      </>
    ),
  },
  id: {
    downloading: "Mengunduh…",
    downloadingPct: (pct: number) => `Mengunduh ${pct}%`,
    extracting: "Mengekstrak…",
    checking: "Memeriksa…",
    installed: (v: string) => `Node.js ${v} terpasang`,
    activated: (v: string) => `Node.js ${v} sekarang aktif`,
    removed: (v: string) => `Node.js ${v} dicopot`,
    title: "Versi Node.js",
    description: "Instal versi Node.js dan pilih versi yang dipakai node, npm, dan npx.",
    versions: "Versi",
    offlineTitle: "Tidak bisa menjangkau nodejs.org",
    offlineBody: "Hanya versi yang terpasang yang ditampilkan. Periksa koneksi Anda, lalu buka halaman ini lagi.",
    noVersions: "Tidak ada versi untuk ditampilkan.",
    colVersion: "Versi Node.js",
    colProvider: "Penyedia",
    colInstalled: "Terpasang",
    colActive: "Aktif",
    colOptions: "Opsi",
    ltsCodename: (name: string) => `Nama kode LTS: ${name}`,
    providerTitle: "Build resmi dari nodejs.org (zip Windows x64)",
    official: "Resmi · x64",
    installedBadge: "Terpasang",
    update: "Perbarui",
    updateTo: (v: string) => `Perbarui ke ${v}`,
    active: "Aktif",
    activate: "Aktifkan",
    uninstallLabel: (v: string) => `Copot Node.js ${v}`,
    uninstallTitle: (v: string | null) => `Copot Node.js ${v}?`,
    uninstallBody: (active: boolean) => (
      <>
        Zefaro menghapus foldernya. Proyek Anda tetap ada, begitu juga paket yang Anda instal dengan{" "}
        <Code>npm install -g</Code> (di <Code>{"%APPDATA%\\npm"}</Code>).
        {active && " Zefaro menjadikan versi terbaru yang tersisa sebagai versi aktif."}
      </>
    ),
    uninstall: "Copot",
    commandLine: "Command line",
    commands: "node, npm, dan npx",
    commandHelp: (
      <>
        Versi yang aktif menjalankan <Code>node</Code>, <Code>npm</Code>, <Code>npx</Code>, dan{" "}
        <Code>corepack</Code>. Misalnya, pakai <Code>npm run dev</Code> untuk aset Vite di aplikasi Laravel.
      </>
    ),
  },
});

function ProgressBar({ p }: { p?: InstallProgress }) {
  const t = useT(messages);
  const pct = p?.total ? Math.min(100, Math.round((p.downloaded / p.total) * 100)) : null;
  const label =
    !p || p.phase === "download"
      ? pct === null
        ? t.downloading
        : t.downloadingPct(pct)
      : p.phase === "extract"
        ? t.extracting
        : t.checking;
  return (
    <div className="flex w-40 items-center gap-2">
      <Progress value={!p || p.phase === "download" ? (pct ?? 0) : 100} className="h-1.5" />
      <span className="text-xs whitespace-nowrap text-muted-foreground">{label}</span>
    </div>
  );
}

/** Node.js versions, opened from the Node.js card on the Services page. */
export function NodePage({ backLabel, onBack }: { backLabel: string; onBack: () => void }) {
  const t = useT(messages);
  const c = useT(common);
  const [data, setData] = useState<NodeVersionsResponse | null>(null);
  const [progress, setProgress] = useState<Record<string, InstallProgress>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(
    () => api.nodeVersions().then(setData).catch((e) => toast.error(String(e))),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unlisten = api.onNodeInstallProgress((p) =>
      setProgress((prev) => ({ ...prev, [p.version]: p }))
    );
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  const withBusy = async (v: NodeVersion, fn: () => Promise<void>) => {
    setBusy((s) => new Set(s).add(v.major));
    try {
      await fn();
    } catch (e) {
      toast.error(`Node.js ${v.major}: ${e}`);
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(v.major);
        return next;
      });
      setProgress((prev) => {
        const next = { ...prev };
        delete next[v.major];
        return next;
      });
      load();
    }
  };

  const install = (v: NodeVersion) =>
    withBusy(v, async () => {
      await api.nodeInstall(v.major);
      toast.success(t.installed(v.latest ?? v.major));
    });
  const activate = (v: NodeVersion) =>
    withBusy(v, async () => {
      await api.nodeActivate(v.major);
      toast.success(t.activated(v.major));
    });
  const uninstall = (v: NodeVersion) =>
    withBusy(v, async () => {
      await api.nodeUninstall(v.major);
      toast(t.removed(v.installed ?? v.major));
    });

  return (
    <>
      <BackButton label={backLabel} onClick={onBack} />
      <PageHeader
        title={t.title}
        description={t.description}
      />
      <div className="space-y-8">
        <Section title={t.versions}>
          {data?.offline && (
            <IconAlert icon="wifi" title={t.offlineTitle}>
              {t.offlineBody}
            </IconAlert>
          )}
          {data === null ? (
            <Card className="gap-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </Card>
          ) : data.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noVersions}</p>
          ) : (
            <Card className="gap-0 overflow-hidden py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4 text-xs tracking-wide uppercase">{t.colVersion}</TableHead>
                    <TableHead className="text-xs tracking-wide uppercase">{t.colProvider}</TableHead>
                    <TableHead className="text-xs tracking-wide uppercase">{t.colInstalled}</TableHead>
                    <TableHead className="text-xs tracking-wide uppercase">{t.colActive}</TableHead>
                    <TableHead className="w-16 pr-3 text-right text-xs tracking-wide uppercase">{t.colOptions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.versions.map((v) => {
                    const working = busy.has(v.major);
                    return (
                      <TableRow key={v.major} data-state={v.isActive ? "selected" : undefined}>
                        <TableCell className="h-12 pl-4">
                          <span className="flex items-center gap-1.5 font-semibold">
                            Node.js {v.major}
                            {v.lts ? (
                              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]" title={t.ltsCodename(v.lts)}>
                                LTS
                              </Badge>
                            ) : v.latest ? (
                              <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                                Current
                              </Badge>
                            ) : null}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {v.installed ?? v.latest}
                            {/* npm's version is known for the newest release only. */}
                            {v.npm && !v.updateAvailable && ` · npm ${v.npm}`}
                          </span>
                        </TableCell>
                        <TableCell title={t.providerTitle}>
                          <span className="block text-sm">Node.js</span>
                          <span className="block text-xs text-muted-foreground">{t.official}</span>
                        </TableCell>
                        <TableCell>
                          {working && (progress[v.major] || !v.installed) ? (
                            <ProgressBar p={progress[v.major]} />
                          ) : v.installed ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className="gap-1.5">
                                <Icon name="circle-check" className="w-3 text-success" />
                                {t.installedBadge}
                              </Badge>
                              {v.updateAvailable && v.latest && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="xs" variant="outline" disabled={working} onClick={() => install(v)}>
                                      <Icon name="rotate" className="w-3" />
                                      {t.update}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{t.updateTo(v.latest)}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          ) : v.latest ? (
                            <Button size="sm" variant="secondary" disabled={working} onClick={() => install(v)}>
                              <Icon name="download" className="w-3" />
                              {c.install}
                            </Button>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {v.isActive ? (
                            <Badge>{t.active}</Badge>
                          ) : v.installed && !working ? (
                            <Button size="sm" variant="ghost" onClick={() => activate(v)}>
                              {t.activate}
                            </Button>
                          ) : null}
                        </TableCell>
                        <TableCell className="pr-3 text-right">
                          {v.installed && !working ? (
                            <AlertDialog>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      className="text-muted-foreground hover:text-destructive"
                                      aria-label={t.uninstallLabel(v.major)}
                                    >
                                      <Icon name="trash-can" />
                                    </Button>
                                  </AlertDialogTrigger>
                                </TooltipTrigger>
                                <TooltipContent>{t.uninstallLabel(v.major)}</TooltipContent>
                              </Tooltip>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t.uninstallTitle(v.installed)}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t.uninstallBody(v.isActive)}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
                                  <AlertDialogAction variant="destructive" onClick={() => uninstall(v)}>
                                    {t.uninstall}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </Section>

        <Section title={t.commandLine}>
          {data ? (
            <PathCard
              binDir={data.binDir}
              onPath={data.binOnPath}
              commands={t.commands}
              onChanged={load}
            />
          ) : (
            <Skeleton className="h-20 w-full rounded-xl" />
          )}
          <p className="text-xs text-muted-foreground">
            {t.commandHelp}
          </p>
        </Section>
      </div>
    </>
  );
}
