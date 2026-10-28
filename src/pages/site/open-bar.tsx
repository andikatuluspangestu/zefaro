import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
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

/** Buttons that open the site in the editors, terminals and database tools found on this computer. */
export function OpenBar({ site }: { site: string }) {
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
  const sorted = [...apps].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">{t.open}</span>
      {sorted.map((app) => (
        <Button key={app.id} size="sm" variant="outline" onClick={() => open(app)}>
          <Icon name={ICON[app.kind]} className="w-3 text-muted-foreground" />
          {app.kind === "folder" ? t.folder : app.name}
        </Button>
      ))}
    </div>
  );
}
