import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { PhpLimits, SitePhpLimits } from "@/types";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    own: "This site's own limits",
    ownHint: (php: string) => `When this is off, the site uses PHP ${php}'s limits, from its settings page.`,
    hint: (file: string) =>
      `Zefaro writes them to ${file}, which PHP reads with every request. In a Git repository the file is kept out of commits (.git/info/exclude).`,
    upload: "Max file upload",
    memory: "Memory limit",
    memoryHint: "-1 for no limit.",
    inputVars: "Max input vars",
    version: (v: string) => `PHP's own: ${v}`,
    save: "Save",
    saved: "PHP limits saved",
    savedHint: "PHP uses them within a few seconds.",
    whole: "Use whole numbers.",
  },
  id: {
    own: "Batas sendiri untuk situs ini",
    ownHint: (php: string) => `Saat ini dimatikan, situs memakai batas PHP ${php} dari halaman pengaturannya.`,
    hint: (file: string) =>
      `Zefaro menulisnya ke ${file}, yang dibaca PHP di setiap request. Di repo Git, file ini tidak ikut ter-commit (.git/info/exclude).`,
    upload: "Maks. unggah file",
    memory: "Batas memori",
    memoryHint: "-1 untuk tanpa batas.",
    inputVars: "Maks. input vars",
    version: (v: string) => `Bawaan PHP: ${v}`,
    save: "Simpan",
    saved: "Batas PHP disimpan",
    savedHint: "PHP memakainya dalam beberapa detik.",
    whole: "Gunakan bilangan bulat.",
  },
});

type Draft = { on: boolean; upload: string; memory: string; vars: string };
const toDraft = (v: SitePhpLimits): Draft => {
  const s = v.own ?? v.version;
  return { on: !!v.own, upload: String(s.maxUploadMb), memory: String(s.memoryLimitMb), vars: String(s.maxInputVars) };
};
const mb = (n: number) => (n < 0 ? "-1" : `${n} MB`);

/** The Configuration tab's PHP limits: the site's own, or its version's. */
export function PhpLimitsPart({ site }: { site: string }) {
  const t = useT(messages);
  const [view, setView] = useState<SitePhpLimits | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .sitePhpLimits(site)
      .then((v) => {
        setView(v);
        setDraft(toDraft(v));
      })
      .catch((e) => toast.error(String(e)));
  }, [site]);

  if (!view || !draft) return <Skeleton className="h-48 w-full" />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(view));

  const save = async () => {
    let limits: PhpLimits | null = null;
    if (draft.on) {
      const n = [draft.upload, draft.memory, draft.vars].map((x) => Number(x.trim()));
      if (n.some((x) => !Number.isInteger(x))) {
        toast.error(t.whole);
        return;
      }
      limits = { maxUploadMb: n[0], memoryLimitMb: n[1], maxInputVars: n[2] };
    }
    setSaving(true);
    try {
      const v = await api.sitePhpLimitsSave(site, limits);
      setView(v);
      setDraft(toDraft(v));
      toast.success(t.saved, { description: t.savedHint });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, key: "upload" | "memory" | "vars", unit: string, versionValue: string, hint?: string) => (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <Input
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          inputMode="numeric"
          disabled={!draft.on || saving}
          className="w-32 font-mono tabular-nums"
        />
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      <span className="text-xs text-muted-foreground">
        {t.version(versionValue)}
        {hint && ` · ${hint}`}
      </span>
    </label>
  );

  return (
    <Card className="gap-4 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <label htmlFor="own-php" className="text-sm font-medium">
            {t.own}
          </label>
          <p className="text-xs text-muted-foreground">{t.ownHint(view.php)}</p>
        </div>
        <Switch id="own-php" checked={draft.on} onCheckedChange={(on) => setDraft({ ...draft, on })} disabled={saving} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {field(t.upload, "upload", "MB", mb(view.version.maxUploadMb))}
        {field(t.memory, "memory", "MB", mb(view.version.memoryLimitMb), t.memoryHint)}
        {field(t.inputVars, "vars", "", String(view.version.maxInputVars))}
      </div>
      <p className="text-xs text-muted-foreground">{t.hint(view.file)}</p>
      <div>
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          <Icon name="floppy-disk" />
          {t.save}
        </Button>
      </div>
    </Card>
  );
}
