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
import type { ExternalApp } from "./types";

const messages = defineMessages({
  en: { open: "Open in", opened: (app: string) => `Opened in ${app}`, folder: "Folder" },
  id: { open: "Buka di", opened: (app: string) => `Dibuka di ${app}`, folder: "Folder" },
});

const ICON: Record<ExternalApp["kind"], string> = {
  editor: "code",
  terminal: "terminal",
  database: "database",
  folder: "folder-open",
};
const ORDER: ExternalApp["kind"][] = ["editor", "terminal", "database", "folder"];

/** A menu that opens the site in the editors, terminals and database tools found on this computer. */
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

  if (apps.length === 0) return null;
  const groups = ORDER.map((kind) => apps.filter((a) => a.kind === kind)).filter((g) => g.length > 0);
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
          <div key={group[0].kind}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              {group.map((app) => (
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
