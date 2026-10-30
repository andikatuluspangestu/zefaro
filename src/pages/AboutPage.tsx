import { openUrl } from "@tauri-apps/plugin-opener";
import type { AppInfo } from "@/types";
import type { PageId } from "@/App";
import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { ServiceLogo } from "@/components/service-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CONTRIBUTING_URL, REPO_URL } from "@/lib/links";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    tagline: "Yet Another Local Laravel Tools",
    summary: "A free, open-source local PHP development environment for Windows.",
    readDocs: "Read the documentation",
    viewSource: "View source",
    facts: { version: "Version", domain: "Local domain", settingsFolder: "Settings folder" },
    principles: {
      title: "How Zefaro works",
      description: "The rules the app follows on your machine.",
      free: {
        title: "Free to use",
        text: "Every feature is free: PHP versions, databases, phpMyAdmin, mail and local DNS. There is no paid tier.",
      },
      local: {
        title: "Local only",
        text: "Every service listens on 127.0.0.1, so other machines on your network can't reach it.",
      },
      verified: {
        title: "Verified downloads",
        text: "Zefaro downloads official builds only and checks each one against a pinned or published SHA-256.",
      },
      private: {
        title: "No accounts or analytics",
        text: "Zefaro goes online only to check for new versions and to download software.",
      },
    },
    installs: {
      title: "Software Zefaro installs",
      description:
        "Zefaro downloads each one from its project's official source when you first need it, then runs it on your machine.",
      component: "Component",
      version: "Version",
      licence: "Licence",
      source: "Source",
    },
    builtWith: {
      title: "Built with",
      description: "Open-source libraries inside the Zefaro app itself.",
      fontAwesome: "Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT",
      dashboardIcons: "Apache-2.0 (service logos; each logo is its project's trademark)",
      ring: "Apache-2.0 and ISC",
    },
    contributing: {
      title: "Contributing",
      description: "Zefaro is open source, and contributions are welcome.",
      text: "Read the contribution guide before you open a pull request. Zefaro accepts no AI features of any kind, and no cloud features.",
      readGuide: "Read the guide",
    },
    footer: {
      licence:
        "Zefaro is open source under the MIT License, © 2026 Zefaro contributors. Icons by Font Awesome (fontawesome.com) are used under the CC BY 4.0 licence.",
      trademarks:
        "Zefaro is an independent project and is not affiliated with, endorsed by or connected to Laravel. PHP, MariaDB, MySQL, PostgreSQL, Redis, nginx, phpMyAdmin, Mailpit, Node.js and Composer are trademarks of their respective owners.",
    },
  },
  id: {
    tagline: "Yet Another Local Laravel Tools",
    summary: "Lingkungan pengembangan PHP lokal untuk Windows yang gratis dan open source.",
    readDocs: "Baca dokumentasi",
    viewSource: "Lihat kode sumber",
    facts: { version: "Versi", domain: "Domain lokal", settingsFolder: "Folder pengaturan" },
    principles: {
      title: "Cara kerja Zefaro",
      description: "Aturan yang dipatuhi aplikasi ini di komputer Anda.",
      free: {
        title: "Gratis dipakai",
        text: "Semua fitur gratis: versi PHP, database, phpMyAdmin, email, dan DNS lokal. Tidak ada paket berbayar.",
      },
      local: {
        title: "Hanya lokal",
        text: "Setiap layanan hanya mendengarkan di 127.0.0.1, jadi komputer lain di jaringan Anda tidak bisa mengaksesnya.",
      },
      verified: {
        title: "Unduhan terverifikasi",
        text: "Zefaro hanya mengunduh build resmi dan memeriksa masing-masing dengan SHA-256 yang disematkan atau dipublikasikan.",
      },
      private: {
        title: "Tanpa akun atau analitik",
        text: "Zefaro hanya terhubung ke internet untuk memeriksa versi baru dan mengunduh software.",
      },
    },
    installs: {
      title: "Software yang dipasang Zefaro",
      description:
        "Zefaro mengunduh masing-masing dari sumber resmi proyeknya saat Anda pertama kali membutuhkannya, lalu menjalankannya di komputer Anda.",
      component: "Komponen",
      version: "Versi",
      licence: "Lisensi",
      source: "Sumber",
    },
    builtWith: {
      title: "Dibangun dengan",
      description: "Library open source di dalam aplikasi Zefaro sendiri.",
      fontAwesome: "Ikon CC BY 4.0, font SIL OFL 1.1, kode MIT",
      dashboardIcons: "Apache-2.0 (logo layanan; setiap logo adalah merek dagang proyeknya)",
      ring: "Apache-2.0 dan ISC",
    },
    contributing: {
      title: "Berkontribusi",
      description: "Zefaro adalah open source, dan kontribusi Anda diterima dengan senang hati.",
      text: "Baca panduan kontribusi sebelum Anda membuka pull request. Zefaro tidak menerima fitur AI dalam bentuk apa pun, dan tidak menerima fitur cloud.",
      readGuide: "Baca panduan",
    },
    footer: {
      licence:
        "Zefaro adalah open source dengan MIT License, © 2026 kontributor Zefaro. Ikon dari Font Awesome (fontawesome.com) dipakai dengan lisensi CC BY 4.0.",
      trademarks:
        "Zefaro adalah proyek independen dan tidak berafiliasi dengan, didukung oleh, atau terhubung dengan Laravel. PHP, MariaDB, MySQL, PostgreSQL, Redis, nginx, phpMyAdmin, Mailpit, Node.js, dan Composer adalah merek dagang milik pemiliknya masing-masing.",
    },
  },
});

type Messages = (typeof messages)["en"];

function principles(t: Messages["principles"]) {
  return [
    { icon: "heart", ...t.free },
    { icon: "shield-halved", ...t.local },
    { icon: "circle-check", ...t.verified },
    { icon: "eye-slash", ...t.private },
  ];
}

/** Libraries the app itself is built with. */
function builtWith(t: Messages["builtWith"]) {
  return [
    { name: "Tauri", license: "MIT / Apache-2.0" },
    { name: "React", license: "MIT" },
    { name: "shadcn/ui", license: "MIT" },
    { name: "Tailwind CSS", license: "MIT" },
    { name: "Font Awesome Free", license: t.fontAwesome },
    { name: "Geist", license: "SIL OFL 1.1" },
    { name: "Dashboard Icons", license: t.dashboardIcons },
    { name: "rcgen", license: "MIT / Apache-2.0" },
    { name: "ring", license: t.ring },
  ];
}

/** Component name → service logo id, for the components that have one. */
const LOGO_IDS: Record<string, string> = {
  nginx: "nginx",
  php: "php",
  "node.js": "node",
  mariadb: "mariadb",
  mysql: "mysql",
  postgresql: "postgresql",
  redis: "redis",
  phpmyadmin: "phpmyadmin",
  mailpit: "mailpit",
};

function ComponentLogo({ name }: { name: string }) {
  const id = LOGO_IDS[name.toLowerCase()];
  if (id) return <ServiceLogo id={id} status="running" className="size-7 rounded-md" />;
  return (
    <span
      aria-hidden="true"
      className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/70 text-muted-foreground ring-1 ring-foreground/5 ring-inset"
    >
      <Icon name="cube" className="text-xs" />
    </span>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h3 className="font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function AboutPage({
  info,
  onNavigate,
}: {
  info: AppInfo | null;
  onNavigate: (page: PageId) => void;
}) {
  const t = useT(messages);
  const PRINCIPLES = principles(t.principles);
  const BUILT_WITH = builtWith(t.builtWith);
  const facts = [
    { label: t.facts.version, value: info ? info.version : null, mono: true },
    { label: t.facts.domain, value: info ? `*.${info.tld}` : null, mono: true },
    { label: t.facts.settingsFolder, value: info ? info.configDir : null, mono: true },
  ];

  return (
    <div className="space-y-8">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-4 p-6">
          <Logo className="size-16" />
          <div className="min-w-56 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">Zefaro</h2>
              {info && (
                <Badge variant="secondary" className="font-mono">
                  v{info.version}
                </Badge>
              )}
            </div>
            <p className="text-sm font-medium">{t.tagline}</p>
            <p className="text-sm text-muted-foreground">{t.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onNavigate("docs")}>
              <Icon name="book" />
              {t.readDocs}
            </Button>
            <Button size="sm" variant="outline" onClick={() => openUrl(REPO_URL)}>
              <Icon name="github" variant="brands" />
              {t.viewSource}
            </Button>
          </div>
        </div>
        <Separator />
        <dl className="grid divide-y text-sm sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:divide-x sm:divide-y-0">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0 space-y-0.5 px-6 py-3">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className={f.mono ? "truncate font-mono text-xs leading-5" : "truncate"} title={f.value ?? undefined}>
                {f.value ?? <Skeleton className="h-4 w-24" />}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <section className="space-y-3">
        <SectionHeading title={t.principles.title} description={t.principles.description} />
        <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="flex gap-3 bg-card p-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon name={p.icon} className="text-sm" />
              </span>
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{p.title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{p.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading title={t.installs.title} description={t.installs.description} />
        <Card className="gap-0 overflow-hidden py-0">
          {info === null ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{t.installs.component}</TableHead>
                  <TableHead>{t.installs.version}</TableHead>
                  <TableHead>{t.installs.licence}</TableHead>
                  <TableHead className="pr-4">{t.installs.source}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {info.components.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-2.5 font-medium">
                        <ComponentLogo name={c.name} />
                        {c.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal text-muted-foreground">{c.version}</TableCell>
                    <TableCell className="text-xs whitespace-normal text-muted-foreground">{c.license}</TableCell>
                    <TableCell className="pr-4 font-mono text-xs whitespace-normal break-all text-muted-foreground">
                      {c.source}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeading title={t.builtWith.title} description={t.builtWith.description} />
        <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
          {BUILT_WITH.map((b) => (
            <div key={b.name} className="bg-card px-4 py-3">
              <p className="text-sm font-medium">{b.name}</p>
              <p className="text-xs text-muted-foreground">{b.license}</p>
            </div>
          ))}
          {/* Keeps the grid even when the list has an odd number of entries. */}
          {BUILT_WITH.length % 2 === 1 && <div className="hidden bg-card sm:block" />}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading title={t.contributing.title} description={t.contributing.description} />
        <Card className="gap-0 py-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Icon name="code-pull-request" className="text-sm" />
            </span>
            <p className="min-w-60 flex-1 text-sm leading-relaxed text-foreground/85">
              {t.contributing.text}
            </p>
            <Button size="sm" variant="outline" onClick={() => openUrl(CONTRIBUTING_URL)}>
              <Icon name="github" variant="brands" />
              {t.contributing.readGuide}
            </Button>
          </div>
        </Card>
      </section>

      <footer className="space-y-2 border-t pt-6 text-xs leading-relaxed text-muted-foreground">
        <p>{t.footer.licence}</p>
        <p>{t.footer.trademarks}</p>
      </footer>
    </div>
  );
}
