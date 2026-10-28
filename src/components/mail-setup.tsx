import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";

const messages = defineMessages({
  en: {
    copiedEnv: "Copied the .env lines",
    copyFailed: "Couldn't copy to the clipboard",
    host: "Host",
    port: "Port",
    credentials: "Username / password",
    credentialsValue: "None (Mailpit accepts any value)",
    encryption: "Encryption",
    title: "Send your app's mail to Mailpit",
    hintBefore: "Use these SMTP settings. Zefaro already points PHP's ",
    hintAfter: " here.",
  },
  id: {
    copiedEnv: "Baris .env tersalin",
    copyFailed: "Gagal menyalin ke clipboard",
    host: "Host",
    port: "Port",
    credentials: "Username / password",
    credentialsValue: "Tidak ada (Mailpit menerima nilai apa pun)",
    encryption: "Enkripsi",
    title: "Kirim email aplikasi Anda ke Mailpit",
    hintBefore: "Pakai pengaturan SMTP ini. Zefaro sudah mengarahkan ",
    hintAfter: " milik PHP ke sini.",
  },
});

/** How to point an app at Zefaro's Mailpit: SMTP details and a Laravel .env. */
export function MailSetup({ smtpPort }: { smtpPort: number }) {
  const t = useT(messages);
  const c = useT(common);
  const env = `MAIL_MAILER=smtp
MAIL_HOST=127.0.0.1
MAIL_PORT=${smtpPort}
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=null`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(env);
      toast.success(t.copiedEnv);
    } catch {
      toast.error(t.copyFailed);
    }
  };

  const rows: [string, string][] = [
    [t.host, "127.0.0.1"],
    [t.port, String(smtpPort)],
    [t.credentials, t.credentialsValue],
    [t.encryption, c.none],
  ];

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid gap-6 p-4 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{t.title}</h3>
            <p className="text-xs text-muted-foreground">
              {t.hintBefore}
              <code className="font-mono">mail()</code>
              {t.hintAfter}
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono text-xs leading-5">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Laravel .env</h3>
            <Button size="xs" variant="outline" onClick={copy}>
              <Icon name="copy" variant="regular" className="w-3" />
              {c.copy}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-5">{env}</pre>
        </div>
      </div>
    </Card>
  );
}
