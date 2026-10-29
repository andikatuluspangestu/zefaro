import type { InstallProgress, PhpVersion, PhpVersionsResponse } from "@/types";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { Section } from "./section";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";

const messages = defineMessages({
  en: {
    downloading: "Downloading…",
    downloadingPct: (pct: number) => `Downloading ${pct}%`,
    extracting: "Extracting…",
    configuring: "Configuring…",
    title: "Versions",
    offlineTitle: "Couldn't reach downloads.php.net",
    offlineBody: "Only installed versions are listed. Check your connection, then reopen this page.",
    colVersion: "PHP version",
    colProvider: "Provider",
    colInstalled: "Installed",
    colActive: "Active",
    colOptions: "Options",
    providerTitle: "Official builds from windows.php.net (non-thread-safe, 64-bit)",
    official: "Official · NTS x64",
    installed: "Installed",
    update: "Update",
    updateTo: (v: string) => `Update to ${v}`,
    activeHint: "Active. Turn on another version to switch.",
    activate: "Activate",
    settings: (v: string) => `PHP ${v} settings`,
  },
  id: {
    downloading: "Mengunduh…",
    downloadingPct: (pct: number) => `Mengunduh ${pct}%`,
    extracting: "Mengekstrak…",
    configuring: "Mengonfigurasi…",
    title: "Versi",
    offlineTitle: "Tidak bisa menjangkau downloads.php.net",
    offlineBody: "Hanya versi yang terpasang yang ditampilkan. Periksa koneksi Anda, lalu buka halaman ini lagi.",
    colVersion: "Versi PHP",
    colProvider: "Penyedia",
    colInstalled: "Terpasang",
    colActive: "Aktif",
    colOptions: "Opsi",
    providerTitle: "Build resmi dari windows.php.net (non-thread-safe, 64-bit)",
    official: "Resmi · NTS x64",
    installed: "Terpasang",
    update: "Perbarui",
    updateTo: (v: string) => `Perbarui ke ${v}`,
    activeHint: "Aktif. Aktifkan versi lain untuk berganti.",
    activate: "Aktifkan",
    settings: (v: string) => `Pengaturan PHP ${v}`,
  },
});

function InstallProgressBar({ p }: { p?: InstallProgress }) {
  const t = useT(messages);
  const pct = p?.total ? Math.min(100, Math.round((p.downloaded / p.total) * 100)) : null;
  const label =
    !p || p.phase === "download"
      ? pct === null
        ? t.downloading
        : t.downloadingPct(pct)
      : p.phase === "extract"
        ? t.extracting
        : t.configuring;
  return (
    <div className="flex w-56 items-center gap-2">
      <Progress value={!p || p.phase === "download" ? (pct ?? 0) : 100} className="h-1.5" />
      <span className="text-xs whitespace-nowrap text-muted-foreground">{label}</span>
    </div>
  );
}

export function VersionsSection({
  data,
  progress,
  installing,
  onInstall,
  onActivate,
  onSettings,
}: {
  data: PhpVersionsResponse | null;
  progress: Record<string, InstallProgress>;
  installing: Set<string>;
  onInstall: (v: PhpVersion) => void;
  onActivate: (v: PhpVersion) => void;
  /** Opens an installed version's settings page. */
  onSettings: (v: PhpVersion) => void;
}) {
  const t = useT(messages);
  const c = useT(common);
  return (
    <Section title={t.title}>
      {data?.offline && (
        <IconAlert icon="wifi" title={t.offlineTitle}>
          {t.offlineBody}
        </IconAlert>
      )}
      {data === null ? (
        <Card className="gap-3 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </Card>
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
                const busy = installing.has(v.version);
                return (
                  <TableRow key={v.version} data-state={v.isActive ? "selected" : undefined}>
                    <TableCell className="h-12 pl-4">
                      <span className="block font-semibold">PHP {v.version}</span>
                      {(v.installed ?? v.latest) && (
                        <span className="block text-xs text-muted-foreground">
                          {v.installed ?? v.latest}
                        </span>
                      )}
                    </TableCell>
                    <TableCell title={t.providerTitle}>
                      <span className="block text-sm">PHP for Windows</span>
                      <span className="block text-xs text-muted-foreground">
                        {t.official}
                      </span>
                    </TableCell>
                    <TableCell>
                      {busy ? (
                        <InstallProgressBar p={progress[v.version]} />
                      ) : v.installed ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="gap-1.5">
                            <Icon name="circle-check" className="w-3 text-success" />
                            {t.installed}
                          </Badge>
                          {v.updateAvailable && v.latest && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="xs" variant="outline" onClick={() => onInstall(v)}>
                                  <Icon name="rotate" className="w-3" />
                                  {t.update}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t.updateTo(v.latest)}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="secondary" onClick={() => onInstall(v)}>
                              <Icon name="download" className="w-3" />
                              {c.install}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            PHP {v.latest}
                            {v.size ? ` · ${v.size}` : ""}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>
                      {v.installed && !busy ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {/* A span, so the tooltip's attributes don't land on the switch. One version is
                                always active, so turning the active one off does nothing. */}
                            <span className="inline-flex">
                              <Switch
                                checked={v.isActive}
                                onCheckedChange={(on) => on && !v.isActive && onActivate(v)}
                                aria-label={`${t.activate} PHP ${v.version}`}
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{v.isActive ? t.activeHint : `${t.activate} PHP ${v.version}`}</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </TableCell>
                    <TableCell className="pr-3 text-right">
                      {v.installed && !busy ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="text-muted-foreground"
                              onClick={() => onSettings(v)}
                              aria-label={t.settings(v.version)}
                            >
                              <Icon name="gear" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t.settings(v.version)}</TooltipContent>
                        </Tooltip>
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
  );
}
