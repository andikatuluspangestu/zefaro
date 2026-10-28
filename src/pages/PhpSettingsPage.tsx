import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { PhpExtension, PhpLimits, PhpSettingsView } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { PageHeader } from "@/components/page-header";
import {
  BackButton,
  GeneratedFile,
  NumberInput,
  SaveBar,
  SettingGroup,
  SettingRow,
  isWhole,
} from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";
import { ExtensionsSection } from "@/pages/php/extensions-section";

type LimitKey = keyof PhpLimits;
/** Numbers are edited as text so a field can be empty while typing. */
type Draft = Record<LimitKey | "basePort", string>;

const messages = defineMessages({
  en: {
    limits: {
      maxUploadMb: {
        title: "Max file upload size",
        description: "Largest file PHP accepts per upload (also sets post_max_size).",
      },
      memoryLimitMb: {
        title: "Memory limit",
        description: "Memory each script can use; -1 means no limit.",
      },
      maxInputVars: {
        title: "Max input vars",
        description: "Form fields and query parameters PHP reads per request.",
      },
    },
    basePort: "Base port",
    mustBeWhole: (field: string) => `${field} must be a whole number.`,
    saved: (v: string) => `PHP ${v} settings saved`,
    savedRunning: "php-cgi restarted with the new values.",
    savedStopped: "php-cgi uses them the next time it starts.",
    titleFor: (v: string) => `PHP ${v} settings`,
    title: "PHP settings",
    description: "php.ini limits and extensions for this version, and the port range every version shares.",
    active: "Active",
    runningOn: (port: number | null) => `Running · :${port}`,
    versionLabel: "PHP version",
    switchBlocked: "Save or discard your changes before you switch version",
    emptyTitle: "No PHP version installed",
    emptyDescription: "Install one on the PHP versions page, then adjust its settings here.",
    notSaved: "Settings not saved",
    limitsFor: (v: string) => `Limits for PHP ${v}`,
    limitsHint: "Zefaro writes these to this version's php.ini only. Other versions keep their own.",
    basePortHint: "Shared by every PHP version. Each listens on base + its version, and Zefaro points nginx there.",
    listensOn: (v: string, port: number) => `PHP ${v} listens on ${port}.`,
    listensExample: "PHP 8.5 listens on base + 85.",
    iniNoteBefore: "You can edit php.ini yourself above the line that starts with ",
    iniNoteAfter: (v: string) =>
      `; Zefaro rewrites everything below it. Restart PHP ${v} on the Services page afterwards.`,
    saveNoteRunning: (v: string) => `Saving restarts PHP ${v}; a base port change moves every version.`,
    unsaved: "Unsaved changes.",
    loadFailed: (names: string) => `PHP couldn't load ${names}. See the extension list.`,
  },
  id: {
    limits: {
      maxUploadMb: {
        title: "Ukuran unggah maksimum",
        description: "File terbesar yang diterima PHP per unggahan (juga mengatur post_max_size).",
      },
      memoryLimitMb: {
        title: "Batas memori",
        description: "Memori yang boleh dipakai tiap skrip; -1 berarti tanpa batas.",
      },
      maxInputVars: {
        title: "Maks. input vars",
        description: "Field formulir dan parameter query yang dibaca PHP per request.",
      },
    },
    basePort: "Port dasar",
    mustBeWhole: (field: string) => `${field} harus berupa bilangan bulat.`,
    saved: (v: string) => `Pengaturan PHP ${v} tersimpan`,
    savedRunning: "php-cgi dimulai ulang dengan nilai baru.",
    savedStopped: "php-cgi memakainya saat berikutnya dimulai.",
    titleFor: (v: string) => `Pengaturan PHP ${v}`,
    title: "Pengaturan PHP",
    description: "Batas php.ini dan ekstensi untuk versi ini, serta rentang port yang dipakai bersama semua versi.",
    active: "Aktif",
    runningOn: (port: number | null) => `Berjalan · :${port}`,
    versionLabel: "Versi PHP",
    switchBlocked: "Simpan atau buang perubahan Anda sebelum berganti versi",
    emptyTitle: "Belum ada versi PHP yang terpasang",
    emptyDescription: "Instal satu versi di halaman Versi PHP, lalu atur pengaturannya di sini.",
    notSaved: "Pengaturan tidak tersimpan",
    limitsFor: (v: string) => `Batas untuk PHP ${v}`,
    limitsHint: "Zefaro hanya menulis nilai ini ke php.ini versi ini. Versi lain memakai pengaturannya sendiri.",
    basePortHint: "Dipakai bersama semua versi PHP. Tiap versi mendengarkan di port dasar + versinya, dan Zefaro mengarahkan nginx ke sana.",
    listensOn: (v: string, port: number) => `PHP ${v} mendengarkan di port ${port}.`,
    listensExample: "PHP 8.5 mendengarkan di port dasar + 85.",
    iniNoteBefore: "Anda bisa mengedit php.ini sendiri di atas baris yang diawali ",
    iniNoteAfter: (v: string) =>
      `; Zefaro menulis ulang semua yang ada di bawahnya. Setelah itu, mulai ulang PHP ${v} di halaman Layanan.`,
    saveNoteRunning: (v: string) => `Menyimpan akan memulai ulang PHP ${v}; mengganti port dasar memindahkan semua versi.`,
    unsaved: "Ada perubahan yang belum disimpan.",
    loadFailed: (names: string) => `PHP tidak bisa memuat ${names}. Lihat daftar ekstensi.`,
  },
});

const LIMITS: { key: LimitKey; icon: string; unit?: string; negative?: boolean }[] = [
  { key: "maxUploadMb", icon: "arrow-up-from-bracket", unit: "MB" },
  { key: "memoryLimitMb", icon: "memory", unit: "MB", negative: true },
  { key: "maxInputVars", icon: "list-ol" },
];

const toDraft = (limits: PhpLimits, basePort: number): Draft => ({
  maxUploadMb: String(limits.maxUploadMb),
  memoryLimitMb: String(limits.memoryLimitMb),
  maxInputVars: String(limits.maxInputVars),
  basePort: String(basePort),
});

/** Zefaro's default base port; mirrors PhpConfig::default in config.rs. */
const DEFAULT_BASE_PORT = 9000;

/** Where a line's php-cgi listens: base + 10 × major + minor (8.5 → base + 85). */
function portFor(base: number, version: string) {
  const [major, minor] = version.split(".").map(Number);
  return base + major * 10 + minor;
}

export function PhpSettingsPage({
  version: initial,
  backLabel,
  onBack,
}: {
  /** The PHP line to open; the active one when omitted. */
  version?: string;
  backLabel: string;
  onBack: () => void;
}) {
  const t = useT(messages);
  const c = useT(common);
  const [version, setVersion] = useState(initial);
  const [view, setView] = useState<PhpSettingsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iniText, setIniText] = useState<string | null>(null);
  const [exts, setExts] = useState<PhpExtension[] | null>(null);
  /** Extension switches changed but not saved: name → on. */
  const [extDraft, setExtDraft] = useState<Record<string, boolean>>({});

  const load = useCallback((v?: string) => {
    api
      .phpSettings(v)
      .then((s) => {
        setView(s);
        setDraft(toDraft(s.limits, s.basePort));
        setIniText(null);
        setError(null);
        setExtDraft({});
        setExts(null);
        // Listing runs PHP once to check which extensions load, so it comes separately.
        if (s.version) api.phpExtensions(s.version).then(setExts).catch((e) => toast.error(String(e)));
      })
      .catch((e) => toast.error(String(e)));
  }, []);

  useEffect(() => load(version), [load, version]);

  const saved = useMemo(() => (view ? JSON.stringify(toDraft(view.limits, view.basePort)) : ""), [view]);
  const extsDirty = Object.keys(extDraft).length > 0;
  const dirty = (!!draft && JSON.stringify(draft) !== saved) || extsDirty;
  const extsAtDefault = (exts ?? []).every((e) => e.inIni || (extDraft[e.name] ?? e.enabled) === e.defaultOn);
  const isDefault =
    !!draft &&
    !!view &&
    JSON.stringify(draft) === JSON.stringify(toDraft(view.defaults, DEFAULT_BASE_PORT)) &&
    extsAtDefault;

  const toggleExt = (name: string, on: boolean) => {
    const savedOn = exts?.find((e) => e.name === name)?.enabled;
    setExtDraft((d) => {
      const next = { ...d };
      if (on === savedOn) delete next[name];
      else next[name] = on;
      return next;
    });
    setError(null);
  };

  const set = (k: keyof Draft, v: string) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
    setError(null);
  };

  const save = async () => {
    if (!draft || !view?.version) return;
    const bad = LIMITS.find((f) => !isWhole(draft[f.key], f.negative));
    if (bad || !isWhole(draft.basePort)) {
      setError(t.mustBeWhole(bad ? t.limits[bad.key].title : t.basePort));
      return;
    }
    const limits: PhpLimits = {
      maxUploadMb: Number(draft.maxUploadMb),
      memoryLimitMb: Number(draft.memoryLimitMb),
      maxInputVars: Number(draft.maxInputVars),
    };
    const basePort = Number(draft.basePort);
    setSaving(true);
    try {
      const limitsChanged = LIMITS.some((f) => limits[f.key] !== view.limits[f.key]);
      if (limitsChanged) await api.phpSaveLimits(limits, view.version);
      if (basePort !== view.basePort) await api.phpSaveBasePort(basePort);
      let failed: string[] = [];
      if (extsDirty) {
        const list = await api.phpSaveExtensions(view.version, extDraft);
        failed = list.filter((e) => e.enabled && e.error && e.name in extDraft).map((e) => e.name);
      }
      toast.success(t.saved(view.version), {
        description: view.running ? t.savedRunning : t.savedStopped,
      });
      if (failed.length) toast.warning(t.loadFailed(failed.join(", ")));
      load(view.version);
    } catch (e) {
      setError(String(e));
      // Whatever did save (limits before a rejected base port) shows as saved.
      api.phpSettings(view.version).then(setView).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const basePort = draft && isWhole(draft.basePort) ? Number(draft.basePort) : null;

  return (
    <div>
      <BackButton label={backLabel} onClick={onBack} />
      <PageHeader
        title={view?.version ? t.titleFor(view.version) : t.title}
        description={t.description}
        actions={
          view?.version && (
            <div className="flex items-center gap-2">
              {view.version === view.active && <Badge variant="secondary">{t.active}</Badge>}
              <Badge
                variant="outline"
                className={cn(view.running && "border-success/40 text-success")}
              >
                {view.running ? t.runningOn(view.port) : c.stopped}
              </Badge>
              {view.installed.length > 1 && (
                <Select
                  value={view.version}
                  onValueChange={(v) => setVersion(v)}
                  disabled={saving || dirty}
                >
                  <SelectTrigger
                    className="w-32"
                    aria-label={t.versionLabel}
                    title={dirty ? t.switchBlocked : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {view.installed.map((v) => (
                      <SelectItem key={v} value={v}>
                        PHP {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )
        }
      />

      {!view || !draft ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : !view.version ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="php" variant="brands" />
            </EmptyMedia>
            <EmptyTitle>{t.emptyTitle}</EmptyTitle>
            <EmptyDescription>{t.emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-6">
          {error && (
            <IconAlert
              icon="circle-exclamation"
              title={t.notSaved}
              className="border-destructive/50 text-destructive *:data-[slot=alert-description]:text-destructive/90"
            >
              {error}
            </IconAlert>
          )}

          <SettingGroup
            title={t.limitsFor(view.version)}
            hint={t.limitsHint}
          >
            {LIMITS.map((f) => (
              <SettingRow
                key={f.key}
                icon={f.icon}
                title={t.limits[f.key].title}
                description={t.limits[f.key].description}
              >
                <NumberInput
                  value={draft[f.key]}
                  onChange={(v) => set(f.key, v)}
                  label={t.limits[f.key].title}
                  unit={f.unit}
                  disabled={saving}
                  allowNegative={f.negative}
                />
              </SettingRow>
            ))}
          </SettingGroup>

          <SettingGroup
            title={t.basePort}
            hint={t.basePortHint}
          >
            {[
              <SettingRow
                key="base"
                icon="network-wired"
                title={t.basePort}
                description={
                  basePort !== null
                    ? t.listensOn(view.version, portFor(basePort, view.version))
                    : t.listensExample
                }
              >
                <NumberInput
                  value={draft.basePort}
                  onChange={(v) => set("basePort", v)}
                  label={t.basePort}
                  disabled={saving}
                />
              </SettingRow>,
            ]}
          </SettingGroup>

          <ExtensionsSection
            version={view.version}
            extensions={exts}
            draft={extDraft}
            onToggle={toggleExt}
            disabled={saving}
          />

          <GeneratedFile
            title="php.ini"
            path={view.iniPath}
            text={iniText}
            onOpen={() =>
              api
                .phpIniText(view.version!)
                .then(setIniText)
                .catch((e) => setIniText(`; ${String(e)}`))
            }
            onReveal={() => api.phpRevealIni(view.version!)}
            note={
              <>
                {t.iniNoteBefore}
                <code className="font-mono">; ---- Managed by Zefaro</code>
                {t.iniNoteAfter(view.version)}
              </>
            }
          />

          <SaveBar
            dirty={dirty}
            saving={saving}
            isDefault={isDefault}
            note={
              view.running
                ? t.saveNoteRunning(view.version)
                : t.unsaved
            }
            onReset={() => {
              setDraft(toDraft(view.defaults, DEFAULT_BASE_PORT));
              setExtDraft(
                Object.fromEntries(
                  (exts ?? []).filter((e) => !e.inIni && e.enabled !== e.defaultOn).map((e) => [e.name, e.defaultOn])
                )
              );
              setError(null);
            }}
            onDiscard={() => {
              setDraft(toDraft(view.limits, view.basePort));
              setExtDraft({});
              setError(null);
            }}
            onSave={save}
          />
        </div>
      )}
    </div>
  );
}
