import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { ToolStatus, ToolsStatus } from "@/types";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PathCard } from "@/components/path-card";
import { Section, cmpMinor } from "./section";
import { CaBundleRow } from "./ca-bundle-row";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";

const messages = defineMessages({
  en: {
    updateAvailable: (from: string | null, to: string | null) => `Update available: ${from} → ${to}.`,
    updating: "Updating…",
    installing: "Installing…",
    update: "Update",
    installed: "Installed",
    ready: (label: string) => `${label} is ready.`,
    title: "Command-line tools",
    noPhp: "Install and activate a PHP version first.",
    tooOld: (req: string, active: string) => `Needs PHP ${req} or newer. PHP ${active} is active.`,
    laravelTitle: "Laravel installer",
    laravelInstalledBefore: "Create new apps with ",
    laravelMissingBefore: "Create new Laravel apps with ",
    laravelMissingAfter: ". Zefaro installs Composer too if it's missing.",
    composerInstalled: "The PHP dependency manager. It runs on the active PHP version.",
    composerMissing: "The PHP dependency manager. The Laravel installer needs it.",
    commands: "php, composer, laravel, mariadb, mysql, redis-cli and nginx -t",
  },
  id: {
    updateAvailable: (from: string | null, to: string | null) => `Pembaruan tersedia: ${from} → ${to}.`,
    updating: "Memperbarui…",
    installing: "Menginstal…",
    update: "Perbarui",
    installed: "Terpasang",
    ready: (label: string) => `${label} siap dipakai.`,
    title: "Alat command line",
    noPhp: "Instal dan aktifkan versi PHP terlebih dahulu.",
    tooOld: (req: string, active: string) => `Butuh PHP ${req} atau lebih baru. Yang aktif sekarang PHP ${active}.`,
    laravelTitle: "Laravel installer",
    laravelInstalledBefore: "Buat aplikasi baru dengan ",
    laravelMissingBefore: "Buat aplikasi Laravel baru dengan ",
    laravelMissingAfter: ". Zefaro juga menginstal Composer jika belum ada.",
    composerInstalled: "Pengelola dependensi PHP. Composer berjalan di versi PHP yang aktif.",
    composerMissing: "Pengelola dependensi PHP. Laravel installer membutuhkannya.",
    commands: "php, composer, laravel, mariadb, mysql, redis-cli, dan nginx -t",
  },
});

type ToolId = "laravel" | "composer";

function ToolRow({
  icon,
  brand,
  title,
  status,
  blocked,
  idle,
  busy,
  disabled,
  onInstall,
}: {
  icon: string;
  brand?: boolean;
  title: string;
  status: ToolStatus;
  /** Why installing isn't possible right now, if it isn't. */
  blocked?: string;
  /** Description when installed and up to date / not installed. */
  idle: { installed: ReactNode; missing: ReactNode };
  busy: boolean;
  disabled: boolean;
  onInstall: () => void;
}) {
  const t = useT(messages);
  const c = useT(common);
  const { installed, latest, updateAvailable } = status;
  const description = blocked
    ? blocked
    : updateAvailable
      ? t.updateAvailable(installed, latest)
      : installed
        ? idle.installed
        : idle.missing;

  let action;
  if (busy) {
    action = (
      <Button size="sm" disabled>
        <Spinner />
        {installed ? t.updating : t.installing}
      </Button>
    );
  } else if (updateAvailable) {
    action = (
      <Button size="sm" disabled={disabled || !!blocked} onClick={onInstall}>
        {t.update}
      </Button>
    );
  } else if (installed) {
    action = (
      <Badge variant="outline" className="gap-1.5">
        <Icon name="circle-check" className="w-3 text-success" />
        {installed === "installed" ? t.installed : `v${installed}`}
      </Badge>
    );
  } else {
    action = (
      <Button size="sm" variant="secondary" disabled={disabled || !!blocked} onClick={onInstall}>
        <Icon name="download" className="w-3" />
        {c.install}
      </Button>
    );
  }

  return (
    <Item className="px-4 py-3">
      <ItemMedia className="size-10 rounded-lg bg-muted text-muted-foreground">
        <Icon name={icon} variant={brand ? "brands" : "solid"} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions>{action}</ItemActions>
    </Item>
  );
}

export function ToolsSection({
  tools,
  onChanged,
}: {
  tools: ToolsStatus | null;
  onChanged: () => void;
}) {
  const t = useT(messages);
  const [busy, setBusy] = useState<ToolId | null>(null);

  const run = async (id: ToolId, label: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
      toast.success(t.ready(label));
    } catch (e) {
      toast.error(`${label}: ${e}`);
    }
    setBusy(null);
    onChanged();
  };

  if (!tools) {
    return (
      <Section title={t.title}>
        <Skeleton className="h-36 w-full rounded-xl" />
      </Section>
    );
  }

  const noPhp = tools.activePhp ? undefined : t.noPhp;
  const req = tools.laravelRequiresPhp;
  const tooOld =
    tools.activePhp && req && cmpMinor(tools.activePhp, req) < 0
      ? t.tooOld(req, tools.activePhp)
      : undefined;

  return (
    <Section title={t.title}>
      <ItemGroup className="gap-0 rounded-xl border bg-card">
        <ToolRow
          icon="laravel"
          brand
          title={t.laravelTitle}
          status={tools.laravel}
          blocked={noPhp ?? tooOld}
          idle={{
            installed: (
              <>
                {t.laravelInstalledBefore}
                <code className="font-mono text-xs">laravel new my-app</code>.
              </>
            ),
            missing: (
              <>
                {t.laravelMissingBefore}
                <code className="font-mono text-xs">laravel new</code>
                {t.laravelMissingAfter}
              </>
            ),
          }}
          busy={busy === "laravel"}
          disabled={busy !== null}
          onInstall={() => run("laravel", t.laravelTitle, api.installLaravel)}
        />
        <ItemSeparator className="my-0" />
        <ToolRow
          icon="box-archive"
          title="Composer"
          status={tools.composer}
          idle={{
            installed: t.composerInstalled,
            missing: t.composerMissing,
          }}
          busy={busy === "composer"}
          disabled={busy !== null}
          onInstall={() => run("composer", "Composer", api.installComposer)}
        />
        <ItemSeparator className="my-0" />
        <CaBundleRow />
      </ItemGroup>

      <PathCard
        binDir={tools.binDir}
        onPath={tools.binOnPath}
        commands={t.commands}
        onChanged={onChanged}
      />
    </Section>
  );
}
