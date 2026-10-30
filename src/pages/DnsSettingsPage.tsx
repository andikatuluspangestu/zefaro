import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { DnsSettingsView, DnsTest } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { PageHeader } from "@/components/page-header";
import { BackButton, SaveBar, SettingGroup, SettingRow } from "@/components/settings-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";

const DEFAULT_TLD = "test";

const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono">{children}</span>;

const messages = defineMessages({
  en: {
    tldNotes: {
      test: "Reserved for testing (RFC 2606). The usual choice.",
      internal: "Reserved by ICANN for private networks.",
      localhost: "Needs no admin rights. Opens in Chrome, Edge and Firefox.",
    } as Record<string, string>,
    notNeeded: "Not needed",
    ruleNotNeeded: (tld: string) =>
      `Chrome, Edge and Firefox open *.${tld} names themselves, with no admin rights. Windows 10 doesn't resolve them, so curl, or a site that calls its own address, can't find them. Use .test if you need that.`,
    noAdminTitle: "This Windows account can't approve admin prompts",
    noAdminText:
      "Setting up .test needs one admin prompt. Use .localhost instead: it needs no admin rights and opens in your browser. If you know an administrator's password, you can still set up .test.",
    useLocalhost: "Use .localhost",
    confirmLocalhost:
      "No admin rights are needed. Names open in Chrome, Edge and Firefox; programs such as curl can't find them on Windows 10.",
    approvePrompt: "Approve the Windows admin prompt to finish the DNS setup.",
    setupWorks: (tld: string | undefined) => `DNS is running. Windows now resolves *.${tld} to Zefaro.`,
    setupNotYet:
      "The rule is in place, but Windows doesn't resolve the name yet. A VPN or a browser's own secure DNS can bypass the rule. Run the test below.",
    ruleRemoved: (tld: string | undefined) => `Removed the Windows rule for .${tld}`,
    dnsRunning: "DNS is running",
    flushed: "Flushed the Windows DNS cache",
    tldSaved: (tld: string) => `Sites now use .${tld}`,
    retrust: "Trust Zefaro's certificate again for HTTPS (Settings → HTTPS).",
    title: "DNS settings",
    description: (tld: string) => `How *.${tld} names reach Zefaro without editing the hosts file.`,
    actionFailed: "DNS action failed",
    status: "Status",
    windowsRule: "Windows rule",
    required: "Required",
    ruleOn: (tld: string) => `Windows sends *.${tld} lookups to Zefaro.`,
    ruleOff: (tld: string) => `Needed once so Windows sends *.${tld} lookups to Zefaro. Windows asks for admin permission.`,
    waitingWindows: "Waiting for Windows…",
    active: "Active",
    removeRule: "Remove rule",
    setUpRule: "Set up rule",
    dnsServer: "DNS server",
    serverNeedsRule: "You can start it once the Windows rule is set up.",
    serverAnswers: (tld: string, port: number) => `Answers *.${tld} with 127.0.0.1 on port ${port}.`,
    testTitle: "Resolution test",
    testDescription: "Zefaro looks up a name through its own server and through Windows.",
    zefaroAnswers: (name: string) => `Zefaro's DNS answers ${name}`,
    zefaroSilent: "Zefaro's DNS server doesn't answer. Start it above.",
    windowsResolves: (name: string) => `Windows resolves ${name} to 127.0.0.1`,
    windowsNotYet:
      "Windows doesn't resolve it yet. Flush the DNS cache, or check for a VPN or your browser's secure DNS.",
    windowsNoRule: "Windows doesn't send these names to Zefaro. Set up the Windows rule.",
    runTest: "Run test",
    cacheTitle: "DNS cache",
    cacheDescription: "Clear Windows' cache when a name still points to the wrong place.",
    flushCache: "Flush cache",
    localDomain: "Local domain",
    localDomainHint: "The ending every site gets. Zefaro offers only reserved domains, so it never hides a real website.",
    domain: "Domain",
    saveNote: (from: string, to: string) => `Saving moves your sites from .${from} to .${to}.`,
    confirmTitle: (from: string | undefined, to: string | null) => `Switch from .${from} to .${to}?`,
    confirmSites: (n: number, tld: string | null, old: string | undefined) => (
      <>
        Your {n} site{n === 1 ? "" : "s"} move to <Mono>name.{tld}</Mono>; update any <Mono>APP_URL</Mono> or
        bookmarks that use .{old}.
      </>
    ),
    confirmRule: (tld: string | null) => `Windows asks for admin once, to move the DNS rule to .${tld}.`,
    confirmCa: (tld: string | null) =>
      `Zefaro gives secured sites certificates from a new certificate authority for .${tld}. Trust it in Settings, on the HTTPS and system tab.`,
    switchTo: (tld: string | null) => `Switch to .${tld}`,
  },
  id: {
    tldNotes: {
      test: "Dicadangkan untuk pengujian (RFC 2606). Pilihan yang umum.",
      internal: "Dicadangkan oleh ICANN untuk jaringan privat.",
      localhost: "Tanpa hak admin. Terbuka di Chrome, Edge, dan Firefox.",
    } as Record<string, string>,
    notNeeded: "Tidak perlu",
    ruleNotNeeded: (tld: string) =>
      `Chrome, Edge, dan Firefox membuka nama *.${tld} sendiri, tanpa hak admin. Windows 10 tidak me-resolve nama itu, jadi curl, atau situs yang memanggil alamatnya sendiri, tidak bisa menemukannya. Pakai .test jika perlu itu.`,
    noAdminTitle: "Akun Windows ini tidak bisa menyetujui permintaan admin",
    noAdminText:
      "Menyiapkan .test butuh satu permintaan admin. Pakai .localhost saja: tidak butuh hak admin dan terbuka di browser Anda. Jika Anda tahu kata sandi administrator, .test tetap bisa disiapkan.",
    useLocalhost: "Pakai .localhost",
    confirmLocalhost:
      "Tidak perlu hak admin. Nama terbuka di Chrome, Edge, dan Firefox; program seperti curl tidak bisa menemukannya di Windows 10.",
    approvePrompt: "Setujui permintaan admin Windows untuk menyelesaikan pemasangan DNS.",
    setupWorks: (tld: string | undefined) => `DNS berjalan. Windows sekarang mengarahkan *.${tld} ke Zefaro.`,
    setupNotYet:
      "Aturan sudah terpasang, tetapi Windows belum bisa me-resolve nama tersebut. VPN atau secure DNS bawaan browser bisa melewati aturan ini. Jalankan tes di bawah.",
    ruleRemoved: (tld: string | undefined) => `Aturan Windows untuk .${tld} dihapus`,
    dnsRunning: "DNS berjalan",
    flushed: "Cache DNS Windows sudah dibersihkan",
    tldSaved: (tld: string) => `Situs sekarang memakai .${tld}`,
    retrust: "Percayai lagi sertifikat Zefaro untuk HTTPS (Pengaturan → HTTPS).",
    title: "Pengaturan DNS",
    description: (tld: string) => `Cara nama *.${tld} sampai ke Zefaro tanpa mengedit file hosts.`,
    actionFailed: "Aksi DNS gagal",
    status: "Status",
    windowsRule: "Aturan Windows",
    required: "Wajib",
    ruleOn: (tld: string) => `Windows mengirim pencarian *.${tld} ke Zefaro.`,
    ruleOff: (tld: string) => `Cukup sekali agar Windows mengirim pencarian *.${tld} ke Zefaro. Windows meminta izin admin.`,
    waitingWindows: "Menunggu Windows…",
    active: "Aktif",
    removeRule: "Hapus aturan",
    setUpRule: "Pasang aturan",
    dnsServer: "Server DNS",
    serverNeedsRule: "Anda bisa memulainya setelah aturan Windows terpasang.",
    serverAnswers: (tld: string, port: number) => `Menjawab *.${tld} dengan 127.0.0.1 di port ${port}.`,
    testTitle: "Tes resolusi",
    testDescription: "Zefaro mencari sebuah nama lewat servernya sendiri dan lewat Windows.",
    zefaroAnswers: (name: string) => `DNS Zefaro menjawab ${name}`,
    zefaroSilent: "Server DNS Zefaro tidak menjawab. Mulai server di atas.",
    windowsResolves: (name: string) => `Windows me-resolve ${name} ke 127.0.0.1`,
    windowsNotYet:
      "Windows belum me-resolve nama ini. Bersihkan cache DNS, atau periksa VPN atau secure DNS di browser Anda.",
    windowsNoRule: "Windows tidak mengirim nama-nama ini ke Zefaro. Pasang aturan Windows.",
    runTest: "Jalankan tes",
    cacheTitle: "Cache DNS",
    cacheDescription: "Bersihkan cache Windows saat sebuah nama masih mengarah ke tempat yang salah.",
    flushCache: "Bersihkan cache",
    localDomain: "Domain lokal",
    localDomainHint: "Akhiran untuk setiap situs. Zefaro hanya menawarkan domain yang dicadangkan, jadi tidak pernah menutupi situs web sungguhan.",
    domain: "Domain",
    saveNote: (from: string, to: string) => `Menyimpan akan memindahkan situs Anda dari .${from} ke .${to}.`,
    confirmTitle: (from: string | undefined, to: string | null) => `Ganti dari .${from} ke .${to}?`,
    confirmSites: (n: number, tld: string | null, old: string | undefined) => (
      <>
        {n} situs Anda pindah ke <Mono>name.{tld}</Mono>; perbarui <Mono>APP_URL</Mono> atau bookmark yang
        memakai .{old}.
      </>
    ),
    confirmRule: (tld: string | null) => `Windows meminta izin admin sekali, untuk memindahkan aturan DNS ke .${tld}.`,
    confirmCa: (tld: string | null) =>
      `Zefaro memberi situs yang diamankan sertifikat dari otoritas sertifikat baru untuk .${tld}. Percayai di Pengaturan, tab HTTPS dan sistem.`,
    switchTo: (tld: string | null) => `Ganti ke .${tld}`,
  },
});

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-xs", ok ? "text-muted-foreground" : "text-destructive")}>
      <Icon name={ok ? "circle-check" : "circle-xmark"} className={cn("w-3", ok && "text-success")} />
      {children}
    </p>
  );
}

export function DnsSettingsPage({ backLabel, onBack }: { backLabel: string; onBack: () => void }) {
  const t = useT(messages);
  const c = useT(common);
  const [view, setView] = useState<DnsSettingsView | null>(null);
  const [tld, setTld] = useState<string | null>(null);
  const [busy, setBusy] = useState<"rule" | "server" | "test" | "flush" | "save" | null>(null);
  const [test, setTest] = useState<DnsTest | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .dnsSettings()
      .then((v) => {
        setView(v);
        setTld(v.tld);
      })
      .catch((e) => toast.error(String(e)));
  }, []);
  useEffect(load, [load]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const runTest = () =>
    run("test", async () => {
      setTest(null);
      setTest(await api.dnsTest());
    });

  // Adds the rule (Windows' admin prompt), then starts DNS and checks it works.
  const setupRule = () =>
    run("rule", async () => {
      toast.info(t.approvePrompt);
      const works = await api.dnsSetup();
      if (works) {
        toast.success(t.setupWorks(view?.tld));
      } else {
        toast.warning(t.setupNotYet);
      }
      load();
    });

  const removeRule = () =>
    run("rule", async () => {
      await api.dnsRemove();
      toast(t.ruleRemoved(view?.tld));
      setTest(null);
      load();
    });

  const toggleServer = () =>
    run("server", async () => {
      if (view?.running) {
        await api.stopService("dns");
      } else {
        await api.startService("dns");
        toast.success(t.dnsRunning);
      }
      load();
    });

  const flush = () =>
    run("flush", async () => {
      await api.dnsFlushCache();
      toast.success(t.flushed);
    });

  const save = () =>
    run("save", async () => {
      if (!tld) return;
      const v = await api.dnsSetTld(tld);
      setView(v);
      setTld(v.tld);
      setTest(null);
      toast.success(t.tldSaved(v.tld), {
        description: v.securedSites > 0 ? t.retrust : undefined,
      });
    });

  const dirty = !!view && tld !== view.tld;
  const rule = view?.ruleInstalled;
  const needsRule = view?.needsRule ?? true;
  // The domain that needs no admin rights: chosen from the hint, and saved after a confirmation.
  const chooseLocalhost = () => {
    setTld("localhost");
    setConfirm(true);
  };

  return (
    <div>
      <BackButton label={backLabel} onClick={onBack} />
      <PageHeader
        title={t.title}
        description={t.description(view?.tld ?? "test")}
      />

      {!view || tld === null ? (
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
              title={t.actionFailed}
              className="border-destructive/50 text-destructive *:data-[slot=alert-description]:text-destructive/90"
            >
              {error}
            </IconAlert>
          )}

          {needsRule && !view.canElevate && (
            <IconAlert icon="user-lock" title={t.noAdminTitle}>
              <p>{t.noAdminText}</p>
              <Button size="sm" className="mt-3" disabled={busy !== null} onClick={chooseLocalhost}>
                <Icon name="globe" />
                {t.useLocalhost}
              </Button>
            </IconAlert>
          )}

          <SettingGroup title={t.status}>
            {(needsRule
              ? [
              <SettingRow
                key="rule"
                icon="shield-halved"
                tone={rule === false ? "warning" : undefined}
                title={
                  <>
                    {t.windowsRule}
                    {rule === false && (
                      <Badge variant="outline" className="border-warning/40 text-warning">
                        {t.required}
                      </Badge>
                    )}
                  </>
                }
                description={
                  rule
                    ? t.ruleOn(view.tld)
                    : t.ruleOff(view.tld)
                }
              >
                {busy === "rule" ? (
                  <Button size="sm" variant="outline" disabled>
                    <Spinner />
                    {t.waitingWindows}
                  </Button>
                ) : rule ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="gap-1.5">
                      <Icon name="circle-check" className="w-3 text-success" />
                      {t.active}
                    </Badge>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={removeRule}>
                      {t.removeRule}
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" disabled={busy !== null || rule === null} onClick={setupRule}>
                    <Icon name="shield-halved" />
                    {t.setUpRule}
                  </Button>
                )}
              </SettingRow>,
              <SettingRow
                key="server"
                icon="server"
                title={t.dnsServer}
                description={rule === false ? t.serverNeedsRule : t.serverAnswers(view.tld, view.port)}
              >
                <div className="flex items-center gap-2">
                  {busy === "server" && <Spinner className="size-3 text-muted-foreground" />}
                  <Switch
                    checked={view.running}
                    disabled={busy !== null || (!view.running && rule !== true)}
                    onCheckedChange={toggleServer}
                    aria-label={t.dnsServer}
                  />
                </div>
              </SettingRow>,
              <SettingRow
                key="test"
                icon="stethoscope"
                title={t.testTitle}
                description={t.testDescription}
                below={
                  test && (
                    <div className="space-y-0.5">
                      <Check ok={test.serverAnswers}>
                        {test.serverAnswers ? t.zefaroAnswers(test.name) : t.zefaroSilent}
                      </Check>
                      <Check ok={test.windowsResolves}>
                        {test.windowsResolves
                          ? t.windowsResolves(test.name)
                          : rule
                            ? t.windowsNotYet
                            : t.windowsNoRule}
                      </Check>
                    </div>
                  )
                }
              >
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={runTest}>
                  {busy === "test" ? <Spinner /> : <Icon name="play" />}
                  {t.runTest}
                </Button>
              </SettingRow>,
              <SettingRow
                key="flush"
                icon="broom"
                title={t.cacheTitle}
                description={t.cacheDescription}
              >
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={flush}>
                  {busy === "flush" ? <Spinner /> : <Icon name="rotate" />}
                  {t.flushCache}
                </Button>
              </SettingRow>,
                ]
              : [
                  <SettingRow key="rule" icon="shield-halved" title={t.windowsRule} description={t.ruleNotNeeded(view.tld)}>
                    <Badge variant="outline" className="gap-1.5">
                      <Icon name="circle-check" className="w-3 text-success" />
                      {t.notNeeded}
                    </Badge>
                  </SettingRow>,
                ])}
          </SettingGroup>

          <SettingGroup
            title={t.localDomain}
            hint={t.localDomainHint}
          >
            {[
              <SettingRow
                key="tld"
                icon="globe"
                title={t.domain}
                description={t.tldNotes[tld] ?? ""}
              >
                <Select value={tld} onValueChange={setTld} disabled={busy !== null}>
                  <SelectTrigger className="w-32" aria-label={t.localDomain}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {view.tlds.map((d) => (
                      <SelectItem key={d} value={d}>
                        .{d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>,
            ]}
          </SettingGroup>

          {/* Only the domain is saved; everything above acts at once. */}
          {(dirty || busy === "save") && (
            <SaveBar
              dirty={dirty}
              saving={busy === "save"}
              isDefault={tld === DEFAULT_TLD}
              note={t.saveNote(view.tld, tld)}
              onReset={() => setTld(DEFAULT_TLD)}
              onDiscard={() => setTld(view.tld)}
              onSave={() => setConfirm(true)}
            />
          )}
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.confirmTitle(view?.tld, tld)}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="list-disc space-y-1 pl-5">
                <li>{t.confirmSites(view?.sites ?? 0, tld, view?.tld)}</li>
                {rule && tld !== "localhost" && <li>{t.confirmRule(tld)}</li>}
                {tld === "localhost" && <li>{t.confirmLocalhost}</li>}
                {!!view?.securedSites && <li>{t.confirmCa(tld)}</li>}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={save}>{t.switchTo(tld)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
