import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import type { MailStatus, MailpitSettings } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { MailSetup } from "@/components/mail-setup";
import { PageHeader } from "@/components/page-header";
import { BackButton, NumberInput, SaveBar, SettingGroup, SettingRow, isWhole } from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";

type Key = keyof MailpitSettings;
type Draft = Record<Key, string>;
const KEYS: Key[] = ["smtpPort", "uiPort", "maxMessages", "maxAgeDays"];

const ICONS: Record<Key, string> = {
  smtpPort: "paper-plane",
  uiPort: "window-maximize",
  maxMessages: "inbox",
  maxAgeDays: "clock-rotate-left",
};

type Field = { title: string; description: string; unit?: string };

const messages = defineMessages({
  en: {
    fields: {
      smtpPort: { title: "SMTP port", description: "Where apps and PHP's mail() send mail." },
      uiPort: { title: "Web UI port", description: "Mailpit's inbox and API (also at mailpit.test)." },
      maxMessages: { title: "Keep at most", description: "Mailpit deletes the oldest messages past this.", unit: "msgs" },
      maxAgeDays: { title: "Delete after", description: "Mailpit deletes older messages; 0 keeps them.", unit: "days" },
    } as Record<Key, Field>,
    mustBeWhole: (field: string) => `${field} must be a whole number.`,
    saved: "Mailpit settings saved",
    savedRunning: "Mailpit restarted; PHP's mail() follows the SMTP port.",
    title: "Mailpit settings",
    description: "The local mail catcher: nothing your apps send leaves this computer.",
    notInstalled: "Not installed",
    open: "Open Mailpit",
    notSaved: "Settings not saved",
    ports: "Ports",
    portsHint: "Both listen on 127.0.0.1 only.",
    storage: "Storage",
    storageHint: "Mailpit keeps mail in Zefaro's data folder, so it survives restarts.",
    saveNoteRunning: "Saving restarts Mailpit.",
    unsaved: "Unsaved changes.",
  },
  id: {
    fields: {
      smtpPort: { title: "Port SMTP", description: "Tujuan aplikasi dan mail() milik PHP mengirim email." },
      uiPort: { title: "Port web UI", description: "Kotak masuk dan API Mailpit (juga di mailpit.test)." },
      maxMessages: { title: "Simpan paling banyak", description: "Mailpit menghapus pesan terlama yang melewati batas ini.", unit: "pesan" },
      maxAgeDays: { title: "Hapus setelah", description: "Mailpit menghapus pesan yang lebih lama; 0 menyimpan semuanya.", unit: "hari" },
    } as Record<Key, Field>,
    mustBeWhole: (field: string) => `${field} harus berupa bilangan bulat.`,
    saved: "Pengaturan Mailpit tersimpan",
    savedRunning: "Mailpit dimulai ulang; mail() milik PHP mengikuti port SMTP.",
    title: "Pengaturan Mailpit",
    description: "Penangkap email lokal: tidak ada email dari aplikasi Anda yang keluar dari komputer ini.",
    notInstalled: "Belum terpasang",
    open: "Buka Mailpit",
    notSaved: "Pengaturan tidak tersimpan",
    ports: "Port",
    portsHint: "Keduanya hanya mendengarkan di 127.0.0.1.",
    storage: "Penyimpanan",
    storageHint: "Mailpit menyimpan email di folder data Zefaro, jadi tetap ada setelah dimulai ulang.",
    saveNoteRunning: "Menyimpan akan memulai ulang Mailpit.",
    unsaved: "Ada perubahan yang belum disimpan.",
  },
});

const toDraft = (s: MailpitSettings): Draft =>
  Object.fromEntries(KEYS.map((k) => [k, String(s[k])])) as Draft;

/** Mailpit's settings (gear on its card, or Settings on the Mail page). */
export function MailpitSettingsPage({ backLabel, onBack }: { backLabel: string; onBack: () => void }) {
  const t = useT(messages);
  const c = useT(common);
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .mailStatus()
      .then((s) => {
        setStatus(s);
        setDraft(toDraft(s.settings));
      })
      .catch((e) => toast.error(String(e)));
  }, []);

  const saved = useMemo(() => (status ? JSON.stringify(toDraft(status.settings)) : ""), [status]);
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const isDefault = !!draft && !!status && JSON.stringify(draft) === JSON.stringify(toDraft(status.defaults));

  const save = async () => {
    if (!draft || !status) return;
    const bad = KEYS.find((k) => !isWhole(draft[k]));
    if (bad) {
      setError(t.mustBeWhole(t.fields[bad].title));
      return;
    }
    setSaving(true);
    try {
      const settings = Object.fromEntries(KEYS.map((k) => [k, Number(draft[k])])) as unknown as MailpitSettings;
      const s = await api.mailSaveSettings(settings);
      setStatus(s);
      setDraft(toDraft(s.settings));
      setError(null);
      toast.success(t.saved, {
        description: s.running ? t.savedRunning : undefined,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <BackButton label={backLabel} onClick={onBack} />
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          status && (
            <>
              <Badge variant="outline" className={cn(status.running && "border-success/40 text-success")}>
                {status.running ? c.running : status.installed ? c.stopped : t.notInstalled}
              </Badge>
              {status.running && (
                <Button size="sm" variant="outline" onClick={() => openUrl(status.webUrl)}>
                  <Icon name="arrow-up-right-from-square" />
                  {t.open}
                </Button>
              )}
            </>
          )
        }
      />

      {!status || !draft ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
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

          <MailSetup smtpPort={status.settings.smtpPort} />

          <SettingGroup title={t.ports} hint={t.portsHint}>
            {(["smtpPort", "uiPort"] as Key[]).map((k) => (
              <SettingRow key={k} icon={ICONS[k]} title={t.fields[k].title} description={t.fields[k].description}>
                <NumberInput
                  value={draft[k]}
                  onChange={(v) => setDraft({ ...draft, [k]: v })}
                  label={t.fields[k].title}
                  unit={t.fields[k].unit}
                  disabled={saving}
                />
              </SettingRow>
            ))}
          </SettingGroup>

          <SettingGroup title={t.storage} hint={t.storageHint}>
            {(["maxMessages", "maxAgeDays"] as Key[]).map((k) => (
              <SettingRow key={k} icon={ICONS[k]} title={t.fields[k].title} description={t.fields[k].description}>
                <NumberInput
                  value={draft[k]}
                  onChange={(v) => setDraft({ ...draft, [k]: v })}
                  label={t.fields[k].title}
                  unit={t.fields[k].unit}
                  disabled={saving}
                />
              </SettingRow>
            ))}
          </SettingGroup>

          <SaveBar
            dirty={dirty}
            saving={saving}
            isDefault={isDefault}
            note={status.running ? t.saveNoteRunning : t.unsaved}
            onReset={() => setDraft(toDraft(status.defaults))}
            onDiscard={() => setDraft(toDraft(status.settings))}
            onSave={save}
          />
        </div>
      )}
    </div>
  );
}
