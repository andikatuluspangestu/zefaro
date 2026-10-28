import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { InstallProgress, PhpVersion, PhpVersionsResponse, ToolsStatus } from "@/types";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/settings-layout";
import { PhpSettingsPage } from "@/pages/PhpSettingsPage";
import { VersionsSection } from "./php/versions-section";
import { ToolsSection } from "./php/tools-section";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    title: "PHP versions",
    description: "Install PHP versions and choose the active one. A row's gear opens its settings.",
    installed: (v: string) => `PHP ${v} installed`,
    activated: (v: string) => `PHP ${v} is now active`,
  },
  id: {
    title: "Versi PHP",
    description: "Instal versi PHP dan pilih yang aktif. Ikon roda gigi di tiap baris membuka pengaturannya.",
    installed: (v: string) => `PHP ${v} terpasang`,
    activated: (v: string) => `PHP ${v} sekarang aktif`,
  },
});

/** PHP versions and command-line tools, opened from the gear on a PHP card
 *  (or "Install PHP") on the Services page. */
export function PhpPage({ backLabel, onBack }: { backLabel: string; onBack: () => void }) {
  const t = useT(messages);
  const [versions, setVersions] = useState<PhpVersionsResponse | null>(null);
  const [tools, setTools] = useState<ToolsStatus | null>(null);
  const [progress, setProgress] = useState<Record<string, InstallProgress>>({});
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  /** Version whose settings page is open (from a row's gear). */
  const [settingsFor, setSettingsFor] = useState<string | null>(null);

  const loadVersions = useCallback(
    () => api.phpVersions().then(setVersions).catch((e) => toast.error(String(e))),
    []
  );
  const loadTools = useCallback(
    () => api.toolsStatus().then(setTools).catch((e) => toast.error(String(e))),
    []
  );

  useEffect(() => {
    loadVersions();
    loadTools();
  }, [loadVersions, loadTools]);

  useEffect(() => {
    const unlisten = api.onPhpInstallProgress((p) =>
      setProgress((prev) => ({ ...prev, [p.version]: p }))
    );
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  const install = async (v: PhpVersion) => {
    setInstalling((s) => new Set(s).add(v.version));
    try {
      await api.phpInstall(v.version);
      toast.success(t.installed(v.latest ?? v.version));
    } catch (e) {
      toast.error(`PHP ${v.version}: ${e}`);
    } finally {
      setInstalling((s) => {
        const next = new Set(s);
        next.delete(v.version);
        return next;
      });
      setProgress((prev) => {
        const next = { ...prev };
        delete next[v.version];
        return next;
      });
      loadVersions();
      loadTools();
    }
  };

  const activate = async (v: PhpVersion) => {
    try {
      await api.phpActivate(v.version);
      toast.success(t.activated(v.version));
    } catch (e) {
      toast.error(String(e));
    }
    loadVersions();
    loadTools();
  };

  if (settingsFor) {
    return (
      <PhpSettingsPage
        version={settingsFor}
        backLabel={t.title}
        onBack={() => {
          setSettingsFor(null);
          loadVersions();
        }}
      />
    );
  }

  return (
    <>
      <BackButton label={backLabel} onClick={onBack} />
      <PageHeader
        title={t.title}
        description={t.description}
      />
      <div className="space-y-8">
        <VersionsSection
          data={versions}
          progress={progress}
          installing={installing}
          onInstall={install}
          onActivate={activate}
          onSettings={(v) => setSettingsFor(v.version)}
        />
        <ToolsSection tools={tools} onChanged={loadTools} />
      </div>
    </>
  );
}
