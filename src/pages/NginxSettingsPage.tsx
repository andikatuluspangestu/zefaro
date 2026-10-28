import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { NginxSettings, NginxSettingsView, PortStatus } from "@/types";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";

type NumKey =
  | "httpPort"
  | "httpsPort"
  | "workerProcesses"
  | "workerConnections"
  | "keepaliveTimeout"
  | "fastcgiReadTimeout"
  | "clientMaxBodyMb";
type BoolKey = "gzip" | "http2" | "accessLog";

/** Numbers are edited as text so a field can be empty while typing. */
type Draft = Omit<NginxSettings, NumKey> & Record<NumKey, string>;

const NUM_KEYS: NumKey[] = [
  "httpPort",
  "httpsPort",
  "workerProcesses",
  "workerConnections",
  "keepaliveTimeout",
  "fastcgiReadTimeout",
  "clientMaxBodyMb",
];

const toDraft = (s: NginxSettings): Draft => {
  const d = { ...s } as unknown as Draft;
  for (const k of NUM_KEYS) d[k] = String(s[k]);
  return d;
};

/** Draft → settings, or the first field that isn't a whole number. */
function fromDraft(d: Draft): NginxSettings | NumKey {
  const out = { ...d } as unknown as NginxSettings;
  for (const k of NUM_KEYS) {
    if (!isWhole(d[k])) return k;
    out[k] = Number(d[k].trim());
  }
  return out;
}

const LEVELS: NginxSettings["errorLogLevel"][] = ["debug", "info", "notice", "warn", "error", "crit"];

const NUM_FIELDS: Record<NumKey, { icon: string; unit?: string }> = {
  httpPort: { icon: "globe" },
  httpsPort: { icon: "lock" },
  workerProcesses: { icon: "microchip" },
  workerConnections: { icon: "plug" },
  keepaliveTimeout: { icon: "hourglass-half", unit: "s" },
  fastcgiReadTimeout: { icon: "stopwatch", unit: "s" },
  clientMaxBodyMb: { icon: "arrow-up-from-bracket", unit: "MB" },
};

const BOOL_ICONS: Record<BoolKey, string> = {
  gzip: "file-zipper",
  http2: "bolt",
  accessLog: "list",
};

const messages = defineMessages({
  en: {
    num: {
      httpPort: { title: "HTTP port", description: "If it isn't 80, site addresses include :port." },
      httpsPort: { title: "HTTPS port", description: "For secured sites. If it isn't 443, addresses include :port." },
      workerProcesses: { title: "Worker processes", description: "0 starts one per CPU core. 1 is enough for local work." },
      workerConnections: { title: "Worker connections", description: "Open connections each worker can handle." },
      keepaliveTimeout: { title: "Keep-alive timeout", description: "How long nginx keeps an idle connection open." },
      fastcgiReadTimeout: { title: "PHP timeout", description: "How long nginx waits for PHP. Raise it when you use Xdebug." },
      clientMaxBodyMb: { title: "Max request size", description: "0 removes nginx's limit; PHP's upload limit still applies." },
    },
    bool: {
      gzip: { title: "Gzip compression", description: "Compress CSS, JS, JSON and SVG responses." },
      http2: { title: "HTTP/2", description: "Applies to secured sites only." },
      accessLog: { title: "Access log", description: "Record every request. The Logs page shows them." },
    },
    levelDefault: (level: string) => `${level} (default)`,
    checkingPort: (port: string) => `Checking port ${port}…`,
    usedByZefaro: "Used by Zefaro's nginx",
    portFree: (port: string) => `Port ${port} is free`,
    inUseBy: (owner: string | null) => `In use by ${owner ?? "another program"}`,
    use: (port: number) => `Use ${port}`,
    mustBeWhole: (field: string) => `${field} must be a whole number.`,
    saved: "nginx settings saved",
    savedRunning: "nginx is now using the new settings.",
    savedStopped: "nginx uses them the next time it starts.",
    title: "nginx settings",
    description: "Ports and behaviour for nginx, the web server in front of every site.",
    notInstalled: "Not installed",
    notSaved: "Settings not saved",
    ports: "Ports",
    portsHint: "If another web server (Apache/httpd, XAMPP, IIS) holds 80 or 443, move Zefaro to free ports here.",
    phpRequests: "PHP and requests",
    performance: "Performance",
    performanceHint: "The defaults suit a development machine.",
    features: "Features and logging",
    errorLevel: "Error log level",
    errorLevelDescription: "Lowest severity written to nginx-error.log.",
    extraTitle: "Extra directives",
    extraHintBefore: "Zefaro adds these inside nginx's ",
    extraHintAfter: " block, for every site. nginx tests them before Zefaro saves anything.",
    extraLabel: "Extra nginx directives",
    generated: "Generated nginx.conf",
    generatedNoteBefore: "Zefaro rewrites this file whenever settings change, so make changes on this page. Per-site configs are in the ",
    generatedNoteAfter: " folder next to it.",
    saveNoteRunning: "Saving reloads nginx; a port change restarts it.",
    unsaved: "Unsaved changes.",
  },
  id: {
    num: {
      httpPort: { title: "Port HTTP", description: "Jika bukan 80, alamat situs menyertakan :port." },
      httpsPort: { title: "Port HTTPS", description: "Untuk situs yang diamankan. Jika bukan 443, alamat menyertakan :port." },
      workerProcesses: { title: "Proses worker", description: "0 memulai satu per inti CPU. 1 sudah cukup untuk kerja lokal." },
      workerConnections: { title: "Koneksi worker", description: "Jumlah koneksi terbuka yang bisa ditangani tiap worker." },
      keepaliveTimeout: { title: "Batas waktu keep-alive", description: "Berapa lama nginx menjaga koneksi idle tetap terbuka." },
      fastcgiReadTimeout: { title: "Batas waktu PHP", description: "Berapa lama nginx menunggu PHP. Naikkan saat Anda memakai Xdebug." },
      clientMaxBodyMb: { title: "Ukuran request maksimum", description: "0 menghapus batas nginx; batas unggah PHP tetap berlaku." },
    },
    bool: {
      gzip: { title: "Kompresi gzip", description: "Kompres respons CSS, JS, JSON, dan SVG." },
      http2: { title: "HTTP/2", description: "Hanya berlaku untuk situs yang diamankan." },
      accessLog: { title: "Access log", description: "Catat setiap request. Halaman Log menampilkannya." },
    },
    levelDefault: (level: string) => `${level} (bawaan)`,
    checkingPort: (port: string) => `Memeriksa port ${port}…`,
    usedByZefaro: "Dipakai oleh nginx milik Zefaro",
    portFree: (port: string) => `Port ${port} kosong`,
    inUseBy: (owner: string | null) => `Dipakai oleh ${owner ?? "program lain"}`,
    use: (port: number) => `Pakai ${port}`,
    mustBeWhole: (field: string) => `${field} harus berupa bilangan bulat.`,
    saved: "Pengaturan nginx tersimpan",
    savedRunning: "nginx sekarang memakai pengaturan baru.",
    savedStopped: "nginx memakainya saat berikutnya dimulai.",
    title: "Pengaturan nginx",
    description: "Port dan perilaku nginx, web server di depan setiap situs.",
    notInstalled: "Belum terpasang",
    notSaved: "Pengaturan tidak tersimpan",
    ports: "Port",
    portsHint: "Jika web server lain (Apache/httpd, XAMPP, IIS) memakai 80 atau 443, pindahkan Zefaro ke port yang kosong di sini.",
    phpRequests: "PHP dan request",
    performance: "Performa",
    performanceHint: "Nilai bawaan sudah cocok untuk mesin pengembangan.",
    features: "Fitur dan logging",
    errorLevel: "Level error log",
    errorLevelDescription: "Tingkat keparahan terendah yang ditulis ke nginx-error.log.",
    extraTitle: "Direktif tambahan",
    extraHintBefore: "Zefaro menambahkan direktif ini di dalam blok ",
    extraHintAfter: " milik nginx, untuk setiap situs. nginx mengujinya sebelum Zefaro menyimpan apa pun.",
    extraLabel: "Direktif nginx tambahan",
    generated: "nginx.conf yang dibuat Zefaro",
    generatedNoteBefore: "Zefaro menulis ulang file ini setiap kali pengaturan berubah, jadi ubah lewat halaman ini. Konfigurasi per situs ada di folder ",
    generatedNoteAfter: " di sebelahnya.",
    saveNoteRunning: "Menyimpan akan me-reload nginx; mengganti port akan memulai ulang nginx.",
    unsaved: "Ada perubahan yang belum disimpan.",
  },
});

/** Live "who holds this port" line under a port field. */
function PortCheck({
  port,
  status,
  checking,
  suggestion,
  onUse,
}: {
  port: string;
  status: PortStatus | null;
  checking: boolean;
  suggestion: number;
  onUse: (p: number) => void;
}) {
  const t = useT(messages);
  if (!isWhole(port)) return null;
  if (checking || !status || String(status.port) !== port.trim()) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3" /> {t.checkingPort(port)}
      </p>
    );
  }
  if (status.ours || status.free) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon name="circle-check" className="w-3 text-success" />
        {status.ours ? t.usedByZefaro : t.portFree(port)}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
      <span className="flex items-center gap-1.5">
        <Icon name="triangle-exclamation" className="w-3" />
        {t.inUseBy(status.owner)}
      </span>
      <Button size="xs" variant="outline" onClick={() => onUse(suggestion)}>
        {t.use(suggestion)}
      </Button>
    </div>
  );
}

function usePortStatus(port: string) {
  const [status, setStatus] = useState<PortStatus | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const n = Number(port.trim());
    if (!isWhole(port) || n < 1 || n > 65535) return;
    setChecking(true);
    let alive = true;
    const timer = window.setTimeout(() => {
      api
        .nginxPortStatus(n)
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus(null))
        .finally(() => alive && setChecking(false));
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [port]);
  return { status, checking };
}

export function NginxSettingsPage({ backLabel, onBack }: { backLabel: string; onBack: () => void }) {
  const t = useT(messages);
  const c = useT(common);
  const [view, setView] = useState<NginxSettingsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confText, setConfText] = useState<string | null>(null);

  useEffect(() => {
    api
      .nginxSettings()
      .then((v) => {
        setView(v);
        setDraft(toDraft(v.settings));
      })
      .catch((e) => toast.error(String(e)));
  }, []);

  const http = usePortStatus(draft?.httpPort ?? "");
  const https = usePortStatus(draft?.httpsPort ?? "");

  const saved = useMemo(() => (view ? JSON.stringify(toDraft(view.settings)) : ""), [view]);
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const isDefault = !!draft && !!view && JSON.stringify(draft) === JSON.stringify(toDraft(view.defaults));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    const parsed = fromDraft(draft);
    if (typeof parsed === "string") {
      setError(t.mustBeWhole(t.num[parsed].title));
      return;
    }
    setSaving(true);
    try {
      const v = await api.nginxSaveSettings(parsed);
      setView(v);
      setDraft(toDraft(v.settings));
      setConfText(null);
      setError(null);
      toast.success(t.saved, {
        description: v.running ? t.savedRunning : t.savedStopped,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const numRow = (k: NumKey, below?: ReactNode) => (
    <SettingRow key={k} icon={NUM_FIELDS[k].icon} {...t.num[k]} below={below}>
      <NumberInput
        value={draft?.[k] ?? ""}
        onChange={(v) => set(k, v)}
        label={t.num[k].title}
        unit={NUM_FIELDS[k].unit}
        disabled={saving}
      />
    </SettingRow>
  );

  const boolRow = (k: BoolKey) => (
    <SettingRow key={k} icon={BOOL_ICONS[k]} {...t.bool[k]}>
      <Switch
        checked={draft?.[k] ?? false}
        disabled={saving}
        onCheckedChange={(v) => set(k, v)}
        aria-label={t.bool[k].title}
      />
    </SettingRow>
  );

  return (
    <div>
      <BackButton label={backLabel} onClick={onBack} />
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          view && (
            <Badge
              variant="outline"
              className={cn(view.running && "border-success/40 text-success")}
            >
              {view.running ? c.running : view.installed ? c.stopped : t.notInstalled}
            </Badge>
          )
        }
      />

      {!view || !draft ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
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

          <SettingGroup
            title={t.ports}
            hint={t.portsHint}
          >
            {[
              numRow(
                "httpPort",
                <PortCheck
                  port={draft.httpPort}
                  status={http.status}
                  checking={http.checking}
                  suggestion={8080}
                  onUse={(p) => set("httpPort", String(p))}
                />
              ),
              numRow(
                "httpsPort",
                <PortCheck
                  port={draft.httpsPort}
                  status={https.status}
                  checking={https.checking}
                  suggestion={8443}
                  onUse={(p) => set("httpsPort", String(p))}
                />
              ),
            ]}
          </SettingGroup>

          <SettingGroup title={t.phpRequests}>
            {[numRow("fastcgiReadTimeout"), numRow("clientMaxBodyMb")]}
          </SettingGroup>

          <SettingGroup title={t.performance} hint={t.performanceHint}>
            {[numRow("workerProcesses"), numRow("workerConnections"), numRow("keepaliveTimeout")]}
          </SettingGroup>

          <SettingGroup title={t.features}>
            {[
              boolRow("gzip"),
              boolRow("http2"),
              boolRow("accessLog"),
              <SettingRow
                key="level"
                icon="triangle-exclamation"
                title={t.errorLevel}
                description={t.errorLevelDescription}
              >
                <Select
                  value={draft.errorLogLevel}
                  onValueChange={(v) => set("errorLogLevel", v as NginxSettings["errorLogLevel"])}
                  disabled={saving}
                >
                  <SelectTrigger className="w-36" aria-label={t.errorLevel}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l === "warn" ? t.levelDefault(l) : l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>,
            ]}
          </SettingGroup>

          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold">{t.extraTitle}</h3>
              <p className="text-xs text-muted-foreground">
                {t.extraHintBefore}
                <code className="font-mono">http {"{ }"}</code>
                {t.extraHintAfter}
              </p>
            </div>
            <Textarea
              value={draft.extraHttp}
              onChange={(e) => set("extraHttp", e.target.value)}
              disabled={saving}
              spellCheck={false}
              rows={4}
              placeholder={"proxy_buffer_size 16k;\nlarge_client_header_buffers 4 32k;"}
              className="font-mono text-xs"
              aria-label={t.extraLabel}
            />
          </section>

          <GeneratedFile
            title={t.generated}
            path={view.confPath}
            text={confText}
            onOpen={() =>
              api
                .nginxConfigText()
                .then(setConfText)
                .catch((e) => setConfText(`# ${String(e)}`))
            }
            onReveal={api.nginxRevealConfig}
            note={
              <>
                {t.generatedNoteBefore}
                <code className="font-mono">sites</code>
                {t.generatedNoteAfter}
              </>
            }
          />

          <SaveBar
            dirty={dirty}
            saving={saving}
            isDefault={isDefault}
            note={view.running ? t.saveNoteRunning : t.unsaved}
            onReset={() => {
              setDraft(toDraft(view.defaults));
              setError(null);
            }}
            onDiscard={() => {
              setDraft(toDraft(view.settings));
              setError(null);
            }}
            onSave={save}
          />
        </div>
      )}
    </div>
  );
}
