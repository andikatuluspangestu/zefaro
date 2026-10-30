import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { Site } from "@/types";
import { Icon } from "@/components/icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    label: (site: string) => `PHP version for ${site}`,
    notInstalled: "not installed",
    switched: (site: string, v: string) => `${site} now runs on PHP ${v}.`,
  },
  id: {
    label: (site: string) => `Versi PHP untuk ${site}`,
    notInstalled: "belum terpasang",
    switched: (site: string, v: string) => `${site} sekarang berjalan di PHP ${v}.`,
  },
});

// One request for every picker on the page (the Sites table has one per row),
// asked again after a change anywhere ("zefaro:refresh"), at most once a second.
let lines: { at: number; list: Promise<string[]> } | null = null;
function installedLines(fresh = false) {
  if (!lines || (fresh && Date.now() - lines.at > 1000)) {
    lines = { at: Date.now(), list: api.phpLines().catch(() => []) };
  }
  return lines.list;
}

/** Pick the PHP line a site is served by. Not for sites behind a dev server. */
export function PhpSelect({ site, className, onChanged }: { site: Site; className?: string; onChanged?: (s: Site) => void }) {
  const t = useT(messages);
  const [installed, setInstalled] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = (fresh: boolean) => installedLines(fresh).then((l) => live && setInstalled(l));
    load(false);
    const refresh = () => load(true);
    window.addEventListener("zefaro:refresh", refresh);
    return () => {
      live = false;
      window.removeEventListener("zefaro:refresh", refresh);
    };
  }, []);

  // A site can name a line that was removed since; it's served by the default
  // line meanwhile, and stays in the list so the picker shows the truth.
  const missing = installed !== null && !installed.includes(site.phpVersion);
  const options = installed === null ? [site.phpVersion] : missing ? [...installed, site.phpVersion] : installed;

  const change = async (v: string) => {
    if (v === site.phpVersion) return;
    setBusy(true);
    try {
      const s = await api.setSitePhp(site.name, v);
      toast.success(t.switched(site.name, v));
      onChanged?.(s);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Select value={site.phpVersion} onValueChange={change} disabled={busy || installed === null}>
      <SelectTrigger
        size="sm"
        className={cn("gap-1.5 tabular-nums", className)}
        aria-label={t.label(site.name)}
        title={missing ? `PHP ${site.phpVersion}: ${t.notInstalled}` : undefined}
      >
        {busy ? (
          <Spinner className="size-3" />
        ) : missing ? (
          <Icon name="triangle-exclamation" className="w-3.5 text-warning" />
        ) : (
          <Icon name="php" variant="brands" className="w-3.5 text-muted-foreground" />
        )}
        {/* The version alone: the "not installed" note belongs to the list. */}
        <SelectValue>{site.phpVersion}</SelectValue>
        {missing && <span className="sr-only">{t.notInstalled}</span>}
      </SelectTrigger>
      <SelectContent>
        {options.map((v) => (
          <SelectItem key={v} value={v} disabled={missing && v === site.phpVersion}>
            {v}
            {missing && v === site.phpVersion && <span className="text-xs text-muted-foreground">{t.notInstalled}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
