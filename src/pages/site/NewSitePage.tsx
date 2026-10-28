import { useEffect, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { BackButton } from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { defineMessages, useT } from "@/i18n";
import { JobConsole, useJob } from "./shared";
import type { NewSite, NewSiteDefaults, NewSiteTarget } from "./types";

const messages = defineMessages({
  en: {
    back: "Sites",
    title: "New site",
    description: "Zefaro makes a Laravel app with the Laravel installer, links it, and points its .env at Zefaro's services.",
    project: "Project",
    name: "Name",
    nameHint: "Lowercase letters, digits and hyphens. It becomes the folder and the address.",
    folder: "Folder",
    browse: "Browse",
    chooseFolder: "Choose where to make the project",
    php: "PHP version",
    willMake: (path: string, url: string) => `Makes ${path}, served at ${url}`,
    kit: "Starter kit",
    kits: {
      none: { label: "Laravel", hint: "The plain framework, no front end" },
      react: { label: "React", hint: "Inertia, React and TypeScript" },
      vue: { label: "Vue", hint: "Inertia, Vue and TypeScript" },
      livewire: { label: "Livewire", hint: "Blade with Livewire and Flux" },
      svelte: { label: "Svelte", hint: "Inertia, Svelte and TypeScript" },
      community: { label: "Community", hint: "Any starter kit on Packagist" },
    },
    package: "Composer package",
    packageHint: "The kit's package name, for example vendor/starter-kit.",
    auth: "Login and registration",
    authHint: "Laravel's own pages for signing up, logging in and resetting passwords.",
    teams: "Teams",
    teamsHint: "Users can create teams and invite others.",
    livewireClass: "Class-based components",
    livewireClassHint: "Separate PHP classes instead of single-file components.",
    database: "Database",
    sqlite: { label: "SQLite", hint: "A file in the project. Nothing to start." },
    mariadb: { label: "MariaDB", hint: (db: string) => `Zefaro's MariaDB, in a database named ${db}.` },
    mariadbDown: "MariaDB isn't running.",
    startMariadb: "Start MariaDB",
    pgsql: { label: "PostgreSQL", hint: (db: string) => `Zefaro's PostgreSQL, in a database named ${db}.` },
    pgsqlDown: "PostgreSQL isn't running.",
    pgsqlInstall: (mb: number) => `PostgreSQL isn't installed yet. Starting it downloads it (${mb} MB).`,
    startPgsql: "Start PostgreSQL",
    extras: "Options",
    tests: "Tests",
    node: "Build the front end",
    nodeHint: "Runs npm install and npm run build with Zefaro's Node.js.",
    noNode: "Install Node.js on the Node.js page to build the front end here.",
    kitNeedsNode: "Without a build, the starter kit's pages load unstyled until you run npm install and npm run build.",
    git: "Git repository",
    gitHint: "Runs git init and makes a first commit.",
    noGit: "Git isn't installed.",
    https: "HTTPS",
    httpsHint: "Serve it at https:// with Zefaro's certificate.",
    mailpit: "Send mail to Mailpit",
    mailpitHint: "Sets MAIL_MAILER, MAIL_HOST and MAIL_PORT in .env.",
    create: "Create site",
    creating: "Creating…",
    duration: "This takes a few minutes: Composer downloads Laravel and its packages.",
    needTools: {
      title: "Composer and the Laravel installer are needed",
      body: "Zefaro installs both into its own Composer folder. Your own Composer setup isn't touched.",
      action: "Install them",
      done: "Composer and the Laravel installer are installed",
    },
    noPhp: "Install a PHP version on the PHP page first.",
    done: (url: string) => `${url} is ready`,
    failed: "The site wasn't created. The output above says why.",
    openTools: "Open site tools",
    openBrowser: "Open in browser",
    another: "Make another",
    edit: "Back to the form",
  },
  id: {
    back: "Situs",
    title: "Situs baru",
    description: "Zefaro membuat aplikasi Laravel dengan installer Laravel, menautkannya, dan mengarahkan .env-nya ke layanan Zefaro.",
    project: "Proyek",
    name: "Nama",
    nameHint: "Huruf kecil, angka, dan tanda hubung. Menjadi nama folder dan alamat.",
    folder: "Folder",
    browse: "Pilih",
    chooseFolder: "Pilih tempat membuat proyek",
    php: "Versi PHP",
    willMake: (path: string, url: string) => `Membuat ${path}, disajikan di ${url}`,
    kit: "Starter kit",
    kits: {
      none: { label: "Laravel", hint: "Framework saja, tanpa front end" },
      react: { label: "React", hint: "Inertia, React, dan TypeScript" },
      vue: { label: "Vue", hint: "Inertia, Vue, dan TypeScript" },
      livewire: { label: "Livewire", hint: "Blade dengan Livewire dan Flux" },
      svelte: { label: "Svelte", hint: "Inertia, Svelte, dan TypeScript" },
      community: { label: "Komunitas", hint: "Starter kit apa pun di Packagist" },
    },
    package: "Paket Composer",
    packageHint: "Nama paket kit, misalnya vendor/starter-kit.",
    auth: "Login dan registrasi",
    authHint: "Halaman bawaan Laravel untuk daftar, masuk, dan reset password.",
    teams: "Tim",
    teamsHint: "Pengguna bisa membuat tim dan mengundang orang lain.",
    livewireClass: "Komponen berbasis class",
    livewireClassHint: "Class PHP terpisah, bukan komponen satu file.",
    database: "Database",
    sqlite: { label: "SQLite", hint: "Satu file di dalam proyek. Tidak perlu dijalankan." },
    mariadb: { label: "MariaDB", hint: (db: string) => `MariaDB milik Zefaro, di database bernama ${db}.` },
    mariadbDown: "MariaDB belum berjalan.",
    startMariadb: "Mulai MariaDB",
    pgsql: { label: "PostgreSQL", hint: (db: string) => `PostgreSQL milik Zefaro, di database bernama ${db}.` },
    pgsqlDown: "PostgreSQL belum berjalan.",
    pgsqlInstall: (mb: number) => `PostgreSQL belum terpasang. Memulainya akan mengunduhnya (${mb} MB).`,
    startPgsql: "Mulai PostgreSQL",
    extras: "Opsi",
    tests: "Tes",
    node: "Build front end",
    nodeHint: "Menjalankan npm install dan npm run build dengan Node.js milik Zefaro.",
    noNode: "Pasang Node.js di halaman Node.js agar front end bisa di-build di sini.",
    kitNeedsNode: "Tanpa build, halaman starter kit tampil tanpa gaya sampai Anda menjalankan npm install dan npm run build.",
    git: "Repositori Git",
    gitHint: "Menjalankan git init dan membuat commit pertama.",
    noGit: "Git belum terpasang.",
    https: "HTTPS",
    httpsHint: "Disajikan di https:// dengan sertifikat Zefaro.",
    mailpit: "Kirim email ke Mailpit",
    mailpitHint: "Mengisi MAIL_MAILER, MAIL_HOST, dan MAIL_PORT di .env.",
    create: "Buat situs",
    creating: "Membuat…",
    duration: "Butuh beberapa menit: Composer mengunduh Laravel dan paketnya.",
    needTools: {
      title: "Butuh Composer dan installer Laravel",
      body: "Zefaro memasang keduanya di folder Composer miliknya sendiri. Pengaturan Composer Anda tidak tersentuh.",
      action: "Pasang sekarang",
      done: "Composer dan installer Laravel terpasang",
    },
    noPhp: "Pasang versi PHP di halaman PHP terlebih dahulu.",
    done: (url: string) => `${url} siap`,
    failed: "Situs tidak dibuat. Output di atas menjelaskan sebabnya.",
    openTools: "Buka alat situs",
    openBrowser: "Buka di browser",
    another: "Buat lagi",
    edit: "Kembali ke formulir",
  },
});

type Kit = NewSite["kit"];
const KITS: { id: Kit; icon: string; brand?: boolean }[] = [
  { id: "none", icon: "laravel", brand: true },
  { id: "react", icon: "react", brand: true },
  { id: "vue", icon: "vuejs", brand: true },
  { id: "livewire", icon: "bolt" },
  { id: "svelte", icon: "fire" },
  { id: "community", icon: "users" },
];

export function NewSitePage({ onBack, onOpenSite }: { onBack: () => void; onOpenSite: (name: string) => void }) {
  const t = useT(messages);
  const [defaults, setDefaults] = useState<NewSiteDefaults | null>(null);
  const [form, setForm] = useState<NewSite | null>(null);
  const [target, setTarget] = useState<NewSiteTarget | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { job } = useJob(jobId);

  const load = () =>
    api
      .newSiteDefaults()
      .then((d) => {
        setDefaults(d);
        setForm(
          (f) =>
            f ?? {
              name: "",
              parent: d.parent,
              php: d.activePhp ?? d.phpVersions[0] ?? "",
              kit: "none",
              community: "",
              auth: true,
              teams: false,
              livewireClass: false,
              database: "sqlite",
              testing: "pest",
              node: !!d.node,
              git: false,
              https: false,
              mailpit: true,
            },
        );
      })
      .catch((e) => toast.error(String(e)));

  useEffect(() => {
    load();
  }, []);

  // Check the name and folder as the user types.
  useEffect(() => {
    if (!form || form.name === "") {
      setTarget(null);
      setProblem(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .newSiteCheck(form.name, form.parent)
        .then((r) => {
          setTarget(r);
          setProblem(null);
        })
        .catch((e) => {
          setTarget(null);
          setProblem(String(e));
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [form?.name, form?.parent]);

  if (!defaults || !form)
    return (
      <>
        <BackButton label={t.back} onClick={onBack} />
        <Skeleton className="mb-6 h-7 w-48" />
        <Skeleton className="h-96 w-full" />
      </>
    );

  const set = <K extends keyof NewSite>(key: K, value: NewSite[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const isKit = form.kit !== "none";
  const officialKit = isKit && form.kit !== "community";
  const toolsMissing = !defaults.installer || !defaults.composer;
  const canCreate =
    !!target && !problem && !!form.php && !toolsMissing && (form.kit !== "community" || form.community.includes("/")) && (form.database !== "mariadb" || defaults.mariadbRunning) && (form.database !== "pgsql" || defaults.postgresRunning);

  const run = async (key: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await work();
      if (done) toast.success(done);
      await load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    try {
      const j = await api.newSiteCreate(form);
      setJobId(j.id);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const browse = async () => {
    const dir = await openDialog({ directory: true, title: t.chooseFolder, defaultPath: form.parent });
    if (typeof dir === "string") set("parent", dir);
  };

  // While or after creating: the console and what to do next.
  if (jobId !== null) {
    const url = target?.url ?? "";
    return (
      <>
        <BackButton label={t.back} onClick={onBack} />
        <h2 className="mb-1 text-xl font-semibold tracking-tight">{form.name}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{job?.state === "running" ? t.duration : null}</p>
        <JobConsole jobId={jobId} className="[&_pre]:max-h-[26rem]" />
        {job?.state === "done" && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-2 flex items-center gap-2 text-sm text-success">
              <Icon name="circle-check" />
              {t.done(url)}
            </span>
            <Button onClick={() => onOpenSite(form.name)}>
              <Icon name="screwdriver-wrench" />
              {t.openTools}
            </Button>
            <Button variant="outline" onClick={() => openUrl(form.https ? url.replace(/^http:/, "https:") : url)}>
              <Icon name="arrow-up-right-from-square" />
              {t.openBrowser}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setJobId(null);
                setForm({ ...form, name: "" });
              }}
            >
              {t.another}
            </Button>
          </div>
        )}
        {(job?.state === "failed" || job?.state === "stopped") && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-destructive">{t.failed}</span>
            <Button variant="outline" onClick={() => setJobId(null)}>
              {t.edit}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <BackButton label={t.back} onClick={onBack} />
      <div className="mb-6 space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t.title}</h2>
        <p className="text-sm text-muted-foreground">{t.description}</p>
      </div>

      {defaults.phpVersions.length === 0 && <IconAlert icon="triangle-exclamation" className="mb-4 border-warning/40 text-warning" title={t.noPhp} />}
      {toolsMissing && defaults.phpVersions.length > 0 && (
        <IconAlert
          icon="box-open"
          className="mb-4 border-warning/40 text-warning *:data-[slot=alert-description]:text-muted-foreground"
          title={t.needTools.title}
        >
          {t.needTools.body}
          <div className="mt-2">
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "tools",
                  async () => {
                    if (!defaults.composer) await api.installComposer();
                    await api.installLaravel();
                  },
                  t.needTools.done,
                )
              }
            >
              {busy === "tools" ? <Spinner className="size-3" /> : <Icon name="download" />}
              {t.needTools.action}
            </Button>
          </div>
        </IconAlert>
      )}

      <div className="space-y-4">
        <Section title={t.project}>
          <Field label={t.name} hint={problem ?? (target ? t.willMake(target.path, form.https ? target.url.replace(/^http:/, "https:") : target.url) : t.nameHint)} error={!!problem}>
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => set("name", e.target.value.toLowerCase().replace(/[\s_]+/g, "-"))}
              placeholder="my-app"
              className="max-w-sm font-mono"
              spellCheck={false}
            />
          </Field>
          <Field label={t.folder}>
            <div className="flex max-w-xl gap-2">
              <Input value={form.parent} onChange={(e) => set("parent", e.target.value)} className="font-mono text-xs" spellCheck={false} />
              <Button variant="outline" onClick={browse}>
                <Icon name="folder-open" />
                {t.browse}
              </Button>
            </div>
          </Field>
          <Field label={t.php}>
            <Select value={form.php} onValueChange={(v) => set("php", v)} disabled={defaults.phpVersions.length === 0}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {defaults.phpVersions.map((v) => (
                  <SelectItem key={v} value={v}>
                    PHP {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>

        <Section title={t.kit}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {KITS.map((k) => (
              <button
                key={k.id}
                type="button"
                aria-pressed={form.kit === k.id}
                onClick={() => set("kit", k.id)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                  form.kit === k.id && "border-primary bg-primary/5",
                )}
              >
                <Icon name={k.icon} variant={k.brand ? "brands" : "solid"} className={cn("mt-0.5 text-muted-foreground", form.kit === k.id && "text-primary")} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.kits[k.id].label}</span>
                  <span className="block text-xs text-muted-foreground">{t.kits[k.id].hint}</span>
                </span>
              </button>
            ))}
          </div>
          {form.kit === "community" && (
            <Field label={t.package} hint={t.packageHint}>
              <Input value={form.community} onChange={(e) => set("community", e.target.value.trim())} placeholder="vendor/starter-kit" className="max-w-sm font-mono" spellCheck={false} />
            </Field>
          )}
          {officialKit && (
            <div className="space-y-3 pt-1">
              <Toggle label={t.auth} hint={t.authHint} checked={form.auth} onChange={(v) => set("auth", v)} />
              {form.auth && <Toggle label={t.teams} hint={t.teamsHint} checked={form.teams} onChange={(v) => set("teams", v)} />}
              {form.kit === "livewire" && <Toggle label={t.livewireClass} hint={t.livewireClassHint} checked={form.livewireClass} onChange={(v) => set("livewireClass", v)} />}
            </div>
          )}
        </Section>

        <Section title={t.database}>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["sqlite", "mariadb", "pgsql"] as const).map((db) => (
              <button
                key={db}
                type="button"
                aria-pressed={form.database === db}
                onClick={() => set("database", db)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                  form.database === db && "border-primary bg-primary/5",
                )}
              >
                <Icon name={db === "sqlite" ? "file" : "database"} className={cn("mt-0.5 text-muted-foreground", form.database === db && "text-primary")} />
                <span>
                  <span className="block text-sm font-medium">{db === "sqlite" ? t.sqlite.label : db === "mariadb" ? t.mariadb.label : t.pgsql.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {db === "sqlite" ? t.sqlite.hint : (db === "mariadb" ? t.mariadb : t.pgsql).hint(target?.database ?? (form.name.replace(/-/g, "_") || "my_app"))}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {form.database === "mariadb" && !defaults.mariadbRunning && (
            <div className="flex items-center gap-3 text-sm text-warning">
              <Icon name="triangle-exclamation" />
              {t.mariadbDown}
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("mariadb", () => api.startService("mariadb"))}>
                {busy === "mariadb" && <Spinner className="size-3" />}
                {t.startMariadb}
              </Button>
            </div>
          )}
          {form.database === "pgsql" && !defaults.postgresRunning && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-warning">
              <Icon name="triangle-exclamation" />
              {defaults.postgresInstalled ? t.pgsqlDown : t.pgsqlInstall(defaults.postgresDownloadMb)}
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("pgsql", () => api.startService("postgresql"))}>
                {busy === "pgsql" && <Spinner className="size-3" />}
                {t.startPgsql}
              </Button>
            </div>
          )}
        </Section>

        <Section title={t.extras}>
          <Field label={t.tests}>
            <Select value={form.testing} onValueChange={(v) => set("testing", v as NewSite["testing"])}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pest">Pest</SelectItem>
                <SelectItem value="phpunit">PHPUnit</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Toggle
            label={t.node}
            hint={!defaults.node ? t.noNode : isKit && !form.node ? t.kitNeedsNode : t.nodeHint}
            warn={isKit && !form.node}
            checked={form.node}
            disabled={!defaults.node}
            onChange={(v) => set("node", v)}
          />
          <Toggle label={t.git} hint={defaults.git ? t.gitHint : t.noGit} checked={form.git} disabled={!defaults.git} onChange={(v) => set("git", v)} />
          <Toggle label={t.https} hint={t.httpsHint} checked={form.https} onChange={(v) => set("https", v)} />
          <Toggle label={t.mailpit} hint={t.mailpitHint} checked={form.mailpit} onChange={(v) => set("mailpit", v)} />
        </Section>

        <div className="flex flex-wrap items-center gap-3 pb-2">
          <Button size="lg" onClick={create} disabled={!canCreate}>
            <Icon name="plus" />
            {t.create}
          </Button>
          <span className="text-xs text-muted-foreground">{t.duration}</span>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-4 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </Card>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: boolean; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <span className="pt-2 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 space-y-1">
        {children}
        {hint && <p className={cn("text-xs break-words", error ? "text-destructive" : "text-muted-foreground")}>{hint}</p>}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  warn,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  warn?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={cn("flex items-start gap-3", disabled && "opacity-60")}>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className={cn("block text-xs", warn ? "text-warning" : "text-muted-foreground")}>{hint}</span>
      </span>
    </label>
  );
}
