import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { defineMessages, useT } from "@/i18n";
import { openInTerminal } from "@/lib/terminal-request";
import type { ExternalApp } from "./types";

const messages = defineMessages({
  en: { open: "Open in", opened: (app: string) => `Opened in ${app}`, folder: "Folder", zefaroTerminal: "Zefaro Terminal" },
  id: { open: "Buka di", opened: (app: string) => `Dibuka di ${app}`, folder: "Folder", zefaroTerminal: "Terminal Zefaro" },
});

const ICON: Record<ExternalApp["kind"], string> = {
  editor: "code",
  terminal: "terminal",
  database: "database",
  folder: "folder-open",
};
const ORDER: ExternalApp["kind"][] = ["editor", "terminal", "database", "folder"];

/** A menu that opens the site in Zefaro's own Terminal, and in the editors,
 *  terminals and database tools found on this computer. */
export function OpenBar({ site, className }: { site: string; className?: string }) {
  const t = useT(messages);
  const [apps, setApps] = useState<ExternalApp[]>([]);

  useEffect(() => {
    api.siteOpenTargets(site).then(setApps).catch(() => setApps([]));
  }, [site]);

  const open = async (app: ExternalApp) => {
    try {
      await api.siteOpen(site, app.id);
      if (app.kind !== "folder") toast.success(t.opened(app.name));
    } catch (e) {
      toast.error(String(e));
    }
  };

  // Zefaro's Terminal heads the terminals, and is there even when none is installed.
  const groups = ORDER.map((kind) => ({ kind, list: apps.filter((a) => a.kind === kind) })).filter(
    (g) => g.list.length > 0 || g.kind === "terminal",
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="lg" variant="outline" className={className}>
          <Icon name="code" className="w-3.5 text-muted-foreground" />
          {t.open}
          <Icon name="chevron-down" className="w-2.5 text-[10px] text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {groups.map((group, i) => (
          <div key={group.kind}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              {group.kind === "terminal" && (
                <DropdownMenuItem onSelect={() => openInTerminal(site)}>
                  <Icon name="terminal" className="w-3.5 text-primary" />
                  {t.zefaroTerminal}
                </DropdownMenuItem>
              )}
              {group.list.map((app) => (
                <DropdownMenuItem key={app.id} onSelect={() => open(app)}>
                  <Icon name={ICON[app.kind]} className="w-3.5 text-muted-foreground" />
                  {app.kind === "folder" ? t.folder : app.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
