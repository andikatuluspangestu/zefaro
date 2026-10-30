import { useEffect, useState, type ReactNode } from "react";
import type { Intent } from "@/App";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import type { ProjectPreview, Site } from "@/types";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { IconAlert } from "@/components/icon-alert";
import { TrustCaButton, useCaStatus } from "@/components/https-trust";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";
import { SitePage } from "@/pages/site/SitePage";
import { NewSitePage } from "@/pages/site/NewSitePage";
import { ProjectLinkDialog } from "@/pages/site/project-dialog";
import { ImportPage } from "@/pages/site/ImportPage";
import { PhpSelect } from "@/pages/site/php-select";
import { frameworkInfo } from "@/lib/frameworks";

const messages = defineMessages({
  en: {
    title: "Sites",
    description: (code: ReactNode) => <>Zefaro serves each linked folder at its own {code} address.</>,
    linkFolder: "Link folder",
    newSite: "New site",
    chooseFolder: "Choose a project folder",
    linked: (name: string) => `Linked ${name}`,
    servesHttps: (name: string) => `Zefaro now serves ${name} over HTTPS`,
    servesHttp: (name: string) => `Zefaro now serves ${name} over HTTP`,
    unlinked: (name: string) => `Unlinked ${name}`,
    trust: {
      title: "Browsers don't trust Zefaro's HTTPS certificates yet",
      body: "Browsers warn that secured sites aren't private until you trust Zefaro's certificate authority. You only do this once, and Windows asks you to confirm.",
    },
    empty: {
      title: "No sites yet",
      description: "Make a new Laravel site, or link a project folder and Zefaro serves it at name.test.",
    },
    columns: { site: "Site", path: "Path", actions: "Actions" },
    httpsFor: (name: string) => `HTTPS for ${name}`,
    openInBrowser: "Open in browser",
    siteTools: "Open site tools: data, Tinker, Artisan, workers",
    unlinkSite: "Unlink site",
    unlinkTitle: (name: string) => `Unlink ${name}?`,
    unlinkBody: (url: string) => `Zefaro stops serving ${url}. Your project files stay as they are.`,
    proxyTitle: "Forwarded to a dev server on this port",
    import: "Import from XAMPP or Laragon",
  },
  id: {
    title: "Situs",
    description: (code: ReactNode) => <>Zefaro menyajikan setiap folder yang ditautkan di alamat {code} masing-masing.</>,
    linkFolder: "Tautkan folder",
    newSite: "Situs baru",
    chooseFolder: "Pilih folder proyek",
    linked: (name: string) => `${name} ditautkan`,
    servesHttps: (name: string) => `Zefaro kini menyajikan ${name} lewat HTTPS`,
    servesHttp: (name: string) => `Zefaro kini menyajikan ${name} lewat HTTP`,
    unlinked: (name: string) => `Tautan ${name} dilepas`,
    trust: {
      title: "Browser belum memercayai sertifikat HTTPS Zefaro",
      body: "Browser memperingatkan bahwa situs yang diamankan tidak privat sampai Anda memercayai otoritas sertifikat Zefaro. Cukup sekali, dan Windows akan meminta konfirmasi Anda.",
    },
    empty: {
      title: "Belum ada situs",
      description: "Buat situs Laravel baru, atau tautkan folder proyek lalu Zefaro menyajikannya di name.test.",
    },
    columns: { site: "Situs", path: "Lokasi", actions: "Tindakan" },
    httpsFor: (name: string) => `HTTPS untuk ${name}`,
    openInBrowser: "Buka di browser",
    siteTools: "Buka alat situs: data, Tinker, Artisan, worker",
    unlinkSite: "Lepas tautan situs",
    unlinkTitle: (name: string) => `Lepas tautan ${name}?`,
    unlinkBody: (url: string) => `Zefaro berhenti menyajikan ${url}. File proyek Anda tetap seperti semula.`,
    proxyTitle: "Diteruskan ke dev server di port ini",
    import: "Impor dari XAMPP atau Laragon",
  },
});

export function SitesPage({ intent, onIntentDone }: { intent?: Intent | null; onIntentDone?: () => void }) {
  const t = useT(messages);
  const c = useT(common);
  const [sites, setSites] = useState<Site[] | null>(null);
  const ca = useCaStatus();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  // A chosen folder that has a zefaro.json, waiting for the user's answer.
  const [project, setProject] = useState<{ path: string; preview: ProjectPreview } | null>(null);
  const needsTrust = !!sites?.some((s) => s.secured) && !!ca?.created && !ca.trusted;

  const refresh = () =>
    api
      .listSites()
      .then(setSites)
      .catch((e) => {
        toast.error(String(e));
        setSites([]);
      });

  useEffect(() => {
    refresh();
  }, []);

  // Sent here from Home: start a new site, or open one.
  useEffect(() => {
    if (!intent) return;
    if (intent.type === "new-site") setCreating(true);
    else if (intent.type === "import") setImporting(true);
    else if (intent.type === "open-site") setOpen(intent.name);
    else return;
    onIntentDone?.();
  }, [intent, onIntentDone]);

  const linkPlain = async (dir: string) => {
    try {
      const s = await api.linkSite(dir);
      toast.success(t.linked(s.name), { description: s.url });
    } catch (e) {
      toast.error(String(e));
    }
    refresh();
  };

  const link = async () => {
    const dir = await openDialog({ directory: true, title: t.chooseFolder });
    if (typeof dir !== "string") return;
    // A zefaro.json in the folder: ask whether to apply it. One that can't be
    // read is reported, and the folder is linked as usual.
    let preview: ProjectPreview | null = null;
    try {
      preview = await api.projectRead(dir);
    } catch (e) {
      toast.warning(String(e));
    }
    if (preview) setProject({ path: dir, preview });
    else await linkPlain(dir);
  };

  const [securing, setSecuring] = useState<string | null>(null);
  const toggleSecure = async (s: Site) => {
    setSecuring(s.name);
    try {
      const r = await api.secureSite(s.name);
      toast.success(r.secured ? t.servesHttps(r.name) : t.servesHttp(r.name));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSecuring(null);
    }
    refresh();
  };

  const unlink = async (s: Site) => {
    try {
      await api.unlinkSite(s.name);
      toast(t.unlinked(s.name));
    } catch (e) {
      toast.error(String(e));
    }
    refresh();
  };

  if (importing) {
    return (
      <ImportPage
        onBack={() => {
          setImporting(false);
          refresh();
        }}
      />
    );
  }

  if (creating) {
    return (
      <NewSitePage
        onBack={() => {
          setCreating(false);
          refresh();
        }}
        onOpenSite={(name) => {
          setCreating(false);
          setOpen(name);
          refresh();
        }}
      />
    );
  }

  if (open && sites?.some((s) => s.name === open)) {
    return <SitePage name={open} onBack={() => setOpen(null)} />;
  }

  const linkButton = (
    <>
      <Button variant="ghost" onClick={() => setImporting(true)}>
        <Icon name="file-import" />
        {t.import}
      </Button>
      <Button variant="outline" onClick={link}>
        <Icon name="folder-plus" />
        {t.linkFolder}
      </Button>
      <Button onClick={() => setCreating(true)}>
        <Icon name="plus" />
        {t.newSite}
      </Button>
    </>
  );

  return (
    <>
      {project && (
        <ProjectLinkDialog
          path={project.path}
          preview={project.preview}
          onClose={() => setProject(null)}
          onLinkPlain={() => linkPlain(project.path)}
          onLinked={() => refresh()}
        />
      )}
      <PageHeader
        title={t.title}
        description={t.description(
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">name.test</code>,
        )}
        actions={sites && sites.length > 0 ? linkButton : undefined}
      />

      {needsTrust && (
        <IconAlert
          icon="triangle-exclamation"
          className="mb-4 border-warning/40 text-warning *:data-[slot=alert-description]:text-muted-foreground"
          title={t.trust.title}
        >
          {t.trust.body}
          {/* Below the text rather than beside it: the button's label is longer in Indonesian. */}
          <div className="mt-2">
            <TrustCaButton status={ca} />
          </div>
        </IconAlert>
      )}

      {sites === null ? (
        <Card className="gap-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </Card>
      ) : sites.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="globe" />
            </EmptyMedia>
            <EmptyTitle>{t.empty.title}</EmptyTitle>
            <EmptyDescription>{t.empty.description}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{linkButton}</EmptyContent>
        </Empty>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t.columns.site}</TableHead>
                <TableHead>{t.columns.path}</TableHead>
                <TableHead>PHP</TableHead>
                <TableHead>HTTPS</TableHead>
                <TableHead className="pr-4 text-right">{t.columns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((s) => (
                <TableRow key={s.name}>
                  <TableCell className="pl-4">
                    <div className="flex flex-col">
                      <button
                        className="flex w-fit items-center gap-1.5 font-medium hover:text-primary hover:underline"
                        onClick={() => setOpen(s.name)}
                        title={t.siteTools}
                      >
                        {s.secured && <Icon name="lock" className="w-3 text-xs text-success" />}
                        {s.name}
                        {frameworkInfo(s.framework) && (
                          <span title={frameworkInfo(s.framework)!.name} className="text-muted-foreground">
                            <Icon
                              name={frameworkInfo(s.framework)!.icon}
                              variant={frameworkInfo(s.framework)!.brand ? "brands" : "solid"}
                              className="w-3.5 text-xs"
                            />
                          </span>
                        )}
                      </button>
                      <button
                        className="w-fit text-xs text-muted-foreground hover:text-primary hover:underline"
                        onClick={() => openUrl(s.url)}
                      >
                        {s.url}
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground" title={s.path}>
                    {s.path}
                  </TableCell>
                  <TableCell>
                    {s.proxy ? (
                      <Badge variant="secondary" title={t.proxyTitle}>
                        <Icon name="right-left" className="w-3" />:{s.proxy}
                      </Badge>
                    ) : (
                      <PhpSelect site={s} className="h-7 w-24" onChanged={() => refresh()} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={s.secured}
                      disabled={securing === s.name}
                      onCheckedChange={() => toggleSecure(s)}
                      aria-label={t.httpsFor(s.name)}
                    />
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(s.name)}>
                            <Icon name="screwdriver-wrench" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t.siteTools}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon-sm" onClick={() => openUrl(s.url)}>
                            <Icon name="arrow-up-right-from-square" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t.openInBrowser}</TooltipContent>
                      </Tooltip>
                      <AlertDialog>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Icon name="trash-can" />
                              </Button>
                            </AlertDialogTrigger>
                          </TooltipTrigger>
                          <TooltipContent>{t.unlinkSite}</TooltipContent>
                        </Tooltip>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t.unlinkTitle(s.name)}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t.unlinkBody(s.url)}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => unlink(s)}>
                              {t.unlinkSite}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
