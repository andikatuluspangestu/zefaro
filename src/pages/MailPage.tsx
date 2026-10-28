import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import type { MailAddress, MailMessage, MailPage as Page, MailStatus, MailSummary } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { MailSetup } from "@/components/mail-setup";
import { PageHeader } from "@/components/page-header";
import { MailpitSettingsPage } from "@/pages/MailpitSettingsPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { defineMessages, localeOf, useLang, useT } from "@/i18n";
import { common } from "@/i18n/common";

const messages = defineMessages({
  en: {
    description: (smtp: ReactNode) => <>Mailpit catches every email your apps send to SMTP {smtp}.</>,
    descriptionIdle: "Mailpit catches the email your apps send, on this computer.",
    noSender: "(no sender)",
    noSubject: "(no subject)",
    viewer: {
      markUnread: "Mark as unread",
      markedUnread: "Marked as unread",
      openInMailpit: "Open in Mailpit",
      openInMailpitHint: "Open in Mailpit for HTML, link and spam checks",
      delete: "Delete message",
      from: "From",
      to: "To",
      replyTo: "Reply-To",
      date: "Date",
      attachment: (type: string) => `${type}. Click to open or save it.`,
      links: (n: number) => `${n} link${n === 1 ? "" : "s"} in this email. Click one to open it in your browser.`,
      tabs: { text: "Text", headers: "Headers", source: "Source" },
      preview: "Message preview",
      noPlainText: "(no plain-text version)",
    },
    inbox: {
      newEmails: (n: number) => `${n} new emails`,
      newEmail: (subject: string) => `New email: ${subject}`,
      from: (name: string) => `From ${name}`,
      deletedAll: "Deleted all messages",
      deleted: "Message deleted",
      settings: "Mailpit settings",
      settingsHint: "Mailpit settings and how to connect your app",
      openMailpit: "Open Mailpit",
      emptyTitle: "No mail yet",
      emptyDescription:
        "Send an email from your app and it shows up here within a few seconds. Nothing reaches a real inbox.",
      searchPlaceholder: "Search, e.g. from:shop is:unread",
      searchLabel: "Search mail",
      clearSearch: "Clear search",
      count: (n: number, searching: boolean) =>
        `${n.toLocaleString(localeOf("en"))} ${searching ? "found" : n === 1 ? "message" : "messages"}`,
      unread: (n: number) => `${n.toLocaleString(localeOf("en"))} unread`,
      markAllRead: "Mark all read",
      deleteAll: "Delete all",
      deleteAllTitle: "Delete every message?",
      deleteAllBody: (n: number) => `Mailpit deletes all ${n.toLocaleString(localeOf("en"))} emails. You can't undo this.`,
      noMatch: "No messages match your search.",
      loadMore: "Load more",
      choose: "Choose a message to read it here.",
    },
    idle: {
      started: "Mailpit started",
      notRunning: "Mailpit isn't running",
      catch: "Catch email from your apps",
      body: "Mailpit receives the mail your apps send and keeps it here instead of delivering it, so you can test password resets, invoices and newsletters safely.",
      download: (version: string, mb: number) =>
        ` Zefaro downloads Mailpit ${version} (${mb.toLocaleString(localeOf("en"))} MB) the first time you start it.`,
      start: "Start Mailpit",
      installStart: "Install and start Mailpit",
    },
  },
  id: {
    description: (smtp: ReactNode) => <>Mailpit menangkap setiap email yang dikirim aplikasi Anda ke SMTP {smtp}.</>,
    descriptionIdle: "Mailpit menangkap email yang dikirim aplikasi Anda, di komputer ini.",
    noSender: "(tanpa pengirim)",
    noSubject: "(tanpa subjek)",
    viewer: {
      markUnread: "Tandai belum dibaca",
      markedUnread: "Ditandai belum dibaca",
      openInMailpit: "Buka di Mailpit",
      openInMailpitHint: "Buka di Mailpit untuk memeriksa HTML, link, dan spam",
      delete: "Hapus pesan",
      from: "Dari",
      to: "Kepada",
      replyTo: "Balas ke",
      date: "Tanggal",
      attachment: (type: string) => `${type}. Klik untuk membuka atau menyimpannya.`,
      links: (n: number) => `${n} link di email ini. Klik salah satu untuk membukanya di browser Anda.`,
      tabs: { text: "Teks", headers: "Header", source: "Sumber" },
      preview: "Pratinjau pesan",
      noPlainText: "(tidak ada versi teks biasa)",
    },
    inbox: {
      newEmails: (n: number) => `${n} email baru`,
      newEmail: (subject: string) => `Email baru: ${subject}`,
      from: (name: string) => `Dari ${name}`,
      deletedAll: "Semua pesan dihapus",
      deleted: "Pesan dihapus",
      settings: "Pengaturan Mailpit",
      settingsHint: "Pengaturan Mailpit dan cara menghubungkan aplikasi Anda",
      openMailpit: "Buka Mailpit",
      emptyTitle: "Belum ada email",
      emptyDescription:
        "Kirim email dari aplikasi Anda, dan email itu muncul di sini dalam beberapa detik. Tidak ada yang sampai ke kotak masuk sungguhan.",
      searchPlaceholder: "Cari, mis. from:shop is:unread",
      searchLabel: "Cari email",
      clearSearch: "Hapus pencarian",
      count: (n: number, searching: boolean) =>
        `${n.toLocaleString(localeOf("id"))} ${searching ? "ditemukan" : "pesan"}`,
      unread: (n: number) => `${n.toLocaleString(localeOf("id"))} belum dibaca`,
      markAllRead: "Tandai semua dibaca",
      deleteAll: "Hapus semua",
      deleteAllTitle: "Hapus semua pesan?",
      deleteAllBody: (n: number) =>
        `Mailpit menghapus seluruh ${n.toLocaleString(localeOf("id"))} email. Tindakan ini tidak bisa dibatalkan.`,
      noMatch: "Tidak ada pesan yang cocok dengan pencarian Anda.",
      loadMore: "Muat lebih banyak",
      choose: "Pilih pesan untuk membacanya di sini.",
    },
    idle: {
      started: "Mailpit berjalan",
      notRunning: "Mailpit tidak berjalan",
      catch: "Tangkap email dari aplikasi Anda",
      body: "Mailpit menerima email yang dikirim aplikasi Anda dan menyimpannya di sini alih-alih mengirimkannya, jadi Anda bisa menguji reset kata sandi, invoice, dan newsletter dengan aman.",
      download: (version: string, mb: number) =>
        ` Zefaro mengunduh Mailpit ${version} (${mb.toLocaleString(localeOf("id"))} MB) saat pertama kali Anda memulainya.`,
      start: "Mulai Mailpit",
      installStart: "Instal dan mulai Mailpit",
    },
  },
});

const PAGE = 50;
const POLL_MS = 3000;

function who(a: MailAddress | null | undefined, noSender: string) {
  if (!a) return noSender;
  return a.name || a.address;
}

function list(addrs: MailAddress[]) {
  return addrs.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
}

function bytes(n: number, locale: string) {
  if (n >= 1024 * 1024) {
    return `${(n / 1048576).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  }
  if (n >= 1024) return `${Math.round(n / 1024).toLocaleString(locale)} KB`;
  return `${n.toLocaleString(locale)} B`;
}

/** "14:02" today, "21 Oct" this year, else "21/10/2025". */
function when(iso: string, locale: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(locale);
}

/**
 * The message's HTML for a sandboxed frame (no scripts, no navigation, no
 * access to 127.0.0.1): inline images (cid:) become data: URLs.
 */
function previewHtml(m: MailMessage, images: Record<string, string>) {
  let html = m.html;
  for (const [cid, dataUrl] of Object.entries(images)) {
    html = html.split(`cid:${cid}`).join(dataUrl);
  }
  // Light page, as mail clients render it; the app itself is dark.
  return `<!doctype html><html><head><meta charset="utf-8">
<style>html{background:#fff;color:#111;font-family:system-ui,sans-serif}body{margin:16px}img{max-width:100%;height:auto}</style>
</head><body>${html}</body></html>`;
}

/** http(s) links in the message (HTML anchors, else URLs in the text), deduplicated. */
function links(m: MailMessage): { href: string; label: string }[] {
  const out = new Map<string, string>();
  if (m.html) {
    const doc = new DOMParser().parseFromString(m.html, "text/html");
    doc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") ?? "";
      if (/^https?:\/\//i.test(href) && !out.has(href)) {
        out.set(href, (a.textContent ?? "").trim().replace(/\s+/g, " "));
      }
    });
  } else {
    for (const href of m.text.match(/https?:\/\/[^\s<>"')]+/gi) ?? []) out.set(href, "");
  }
  return [...out].map(([href, label]) => ({ href, label: label && label !== href ? label : "" }));
}

function Row({ m, selected, onClick }: { m: MailSummary; selected: boolean; onClick: () => void }) {
  const t = useT(messages);
  const locale = localeOf(useLang().lang);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full gap-2.5 border-b px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:bg-accent/60",
        selected && "bg-accent"
      )}
    >
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", m.read ? "bg-transparent" : "bg-primary")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", !m.read && "font-semibold")}>{who(m.from, t.noSender)}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{when(m.created, locale)}</span>
        </span>
        <span className={cn("flex items-center gap-1.5 text-sm", m.read ? "text-muted-foreground" : "text-foreground")}>
          <span className="min-w-0 flex-1 truncate">{m.subject || t.noSubject}</span>
          {m.attachments > 0 && <Icon name="paperclip" className="w-3 shrink-0 text-xs text-muted-foreground" />}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{m.snippet}</span>
      </span>
    </button>
  );
}

type View = "preview" | "text" | "source" | "headers";

function Viewer({
  id,
  apiUrl,
  webUrl,
  onChanged,
  onDeleted,
}: {
  id: string;
  apiUrl: string;
  webUrl: string;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const all = useT(messages);
  const t = all.viewer;
  const c = useT(common);
  const locale = localeOf(useLang().lang);
  const [m, setM] = useState<MailMessage | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>("preview");
  const [raw, setRaw] = useState<string | null>(null);
  const [headers, setHeaders] = useState<Record<string, string[]> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setM(null);
    setImages({});
    setRaw(null);
    setHeaders(null);
    setError(null);
    api
      .mailGet(id)
      .then((msg) => {
        setM(msg);
        setView(msg.html ? "preview" : "text");
        onChanged(); // opening marks it read
        if (msg.inline.length) api.mailInlineImages(id).then(setImages).catch(() => {});
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (view === "source" && raw === null) api.mailRaw(id).then(setRaw).catch((e) => setRaw(String(e)));
    if (view === "headers" && headers === null) api.mailHeaders(id).then(setHeaders).catch(() => setHeaders({}));
  }, [view, id, raw, headers]);

  const markUnread = async () => {
    await api.mailSetRead([id], false).catch((e) => toast.error(String(e)));
    onChanged();
    toast(t.markedUnread);
  };
  const remove = async () => {
    try {
      await api.mailDelete([id]);
      onDeleted();
    } catch (e) {
      toast.error(String(e));
    }
  };

  if (error) {
    return <p className="p-6 text-sm text-destructive">{error}</p>;
  }
  if (!m) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const mailLinks = links(m);
  const meta: [string, string][] = [
    [t.from, m.from ? list([m.from]) : c.none],
    [t.to, list(m.to) || c.none],
    ...(m.cc.length ? ([["Cc", list(m.cc)]] as [string, string][]) : []),
    ...(m.bcc.length ? ([["Bcc", list(m.bcc)]] as [string, string][]) : []),
    ...(m.replyTo.length ? ([[t.replyTo, list(m.replyTo)]] as [string, string][]) : []),
    [t.date, new Date(m.date).toLocaleString(locale)],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-base leading-snug font-semibold break-words">{m.subject || all.noSubject}</h2>
          <div className="flex shrink-0 gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={markUnread} aria-label={t.markUnread}>
                  <Icon name="envelope" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.markUnread}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => openUrl(`${webUrl}/view/${m.id}`)}
                  aria-label={t.openInMailpit}
                >
                  <Icon name="arrow-up-right-from-square" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.openInMailpitHint}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={remove}
                  aria-label={t.delete}
                >
                  <Icon name="trash-can" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.delete}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {m.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {m.attachments.map((a) => (
              <Button
                key={a.partId}
                size="xs"
                variant="outline"
                onClick={() => openUrl(`${apiUrl}/message/${m.id}/part/${encodeURIComponent(a.partId)}`)}
                title={t.attachment(a.contentType)}
              >
                <Icon name="paperclip" className="w-3" />
                <span className="max-w-48 truncate">{a.fileName || a.partId}</span>
                <span className="text-muted-foreground">{bytes(a.size, locale)}</span>
              </Button>
            ))}
          </div>
        )}
        {mailLinks.length > 0 && (
          <details className="group text-xs">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground select-none hover:text-foreground">
              <Icon name="chevron-right" className="w-3 transition-transform group-open:rotate-90" />
              {t.links(mailLinks.length)}
            </summary>
            <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto">
              {mailLinks.map((l) => (
                <li key={l.href}>
                  <button
                    type="button"
                    onClick={() => openUrl(l.href)}
                    className="flex w-full items-baseline gap-2 rounded px-1.5 py-0.5 text-left hover:bg-accent"
                    title={l.href}
                  >
                    <Icon name="arrow-up-right-from-square" className="w-3 shrink-0 text-[10px] text-muted-foreground" />
                    {l.label && <span className="shrink-0 font-medium">{l.label}</span>}
                    <span className="min-w-0 truncate text-muted-foreground">{l.href}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="h-8">
            <TabsTrigger value="preview" className="text-xs" disabled={!m.html}>
              HTML
            </TabsTrigger>
            <TabsTrigger value="text" className="text-xs" disabled={!m.text}>
              {t.tabs.text}
            </TabsTrigger>
            <TabsTrigger value="headers" className="text-xs">
              {t.tabs.headers}
            </TabsTrigger>
            <TabsTrigger value="source" className="text-xs">
              {t.tabs.source}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {view === "preview" && m.html ? (
          // No scripts, no same-origin access, no navigation of the app.
          <iframe
            title={t.preview}
            sandbox=""
            srcDoc={previewHtml(m, images)}
            className="block h-full min-h-96 w-full border-0 bg-white"
          />
        ) : view === "text" || (view === "preview" && !m.html) ? (
          <pre className="p-4 font-mono text-xs leading-5 whitespace-pre-wrap">{m.text || t.noPlainText}</pre>
        ) : view === "headers" ? (
          headers === null ? (
            <div className="p-4"><Spinner /></div>
          ) : (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 p-4 font-mono text-xs">
              {Object.entries(headers).flatMap(([k, vs]) =>
                vs.map((v, i) => (
                  <div key={`${k}${i}`} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-all">{v}</dd>
                  </div>
                ))
              )}
            </dl>
          )
        ) : (
          <pre className="p-4 font-mono text-xs leading-5 break-all whitespace-pre-wrap">{raw ?? c.loading}</pre>
        )}
      </div>
    </div>
  );
}

function Inbox({ status, onSettings }: { status: MailStatus; onSettings: () => void }) {
  const all = useT(messages);
  const t = all.inbox;
  const c = useT(common);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const newest = useRef<string | null>(null);

  const load = useCallback(
    async (opts: { keep?: number; notify?: boolean } = {}) => {
      const limit = Math.max(PAGE, opts.keep ?? 0);
      try {
        const p = await api.mailList(applied, 0, limit);
        // Toast mail that arrived since the last look (not on first load or search).
        const top = p.messages[0];
        if (opts.notify && top && newest.current && top.id !== newest.current && !applied) {
          const fresh = p.messages.findIndex((m) => m.id === newest.current);
          const count = fresh === -1 ? 1 : fresh;
          toast(count > 1 ? t.newEmails(count) : t.newEmail(top.subject || all.noSubject), {
            description: count > 1 ? undefined : t.from(who(top.from, all.noSender)),
          });
        }
        if (!applied) newest.current = top?.id ?? null;
        setPage(p);
        window.dispatchEvent(new Event("zefaro:mail"));
      } catch (e) {
        setPage((prev) => prev ?? { messages: [], total: 0, unread: 0, start: 0 });
        if (!opts.notify) toast.error(String(e));
      }
    },
    [applied, t, all]
  );

  // Search as you type, with a short pause.
  useEffect(() => {
    const timer = window.setTimeout(() => setApplied(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(null);
    load();
  }, [load]);

  // New mail shows up on its own.
  const shown = page?.messages.length ?? 0;
  useEffect(() => {
    const timer = window.setInterval(() => load({ keep: shown, notify: true }), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, shown]);

  const more = async () => {
    if (!page) return;
    setLoadingMore(true);
    try {
      const next = await api.mailList(applied, page.messages.length, PAGE);
      setPage({ ...next, messages: [...page.messages, ...next.messages] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const markAllRead = async () => {
    await api.mailSetRead([], true).catch((e) => toast.error(String(e)));
    load({ keep: shown });
  };
  const deleteAll = async () => {
    try {
      await api.mailDelete([]);
      setSelected(null);
      toast(t.deletedAll);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const total = page?.total ?? 0;
  const empty = page !== null && page.messages.length === 0;
  const hasMore = !!page && page.messages.length < page.total;
  const selectedExists = useMemo(() => !!page?.messages.some((m) => m.id === selected), [page, selected]);

  return (
    <>
      <PageHeader
        title={c.nav.mail}
        description={all.description(
          <code className="font-mono text-xs">127.0.0.1:{status.settings.smtpPort}</code>,
        )}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={onSettings} aria-label={t.settings}>
                  <Icon name="gear" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.settingsHint}</TooltipContent>
            </Tooltip>
            <Button size="sm" variant="outline" onClick={() => openUrl(status.webUrl)}>
              <Icon name="arrow-up-right-from-square" />
              {t.openMailpit}
            </Button>
          </>
        }
      />

      {page !== null && total === 0 && !applied ? (
        <div className="space-y-4">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon name="inbox" />
              </EmptyMedia>
              <EmptyTitle>{t.emptyTitle}</EmptyTitle>
              <EmptyDescription>{t.emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
          <MailSetup smtpPort={status.settings.smtpPort} />
        </div>
      ) : (
        <Card className="h-[calc(100svh-12.5rem)] min-h-[28rem] flex-row gap-0 overflow-hidden py-0">
          {/* List */}
          <div className="flex w-80 shrink-0 flex-col border-r">
            <div className="space-y-2 border-b p-2">
              <InputGroup className="h-8">
                <InputGroupAddon>
                  <Icon name="magnifying-glass" className="w-3.5" />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  aria-label={t.searchLabel}
                />
                {query && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" onClick={() => setQuery("")} aria-label={t.clearSearch}>
                      <Icon name="xmark" className="w-3" />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="flex-1 tabular-nums">
                  {page ? t.count(total, !!applied) : "…"}
                  {page && page.unread > 0 && !applied && (
                    <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px]">
                      {t.unread(page.unread)}
                    </Badge>
                  )}
                </span>
                <Button size="xs" variant="ghost" disabled={!page?.unread} onClick={markAllRead}>
                  {t.markAllRead}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="xs" variant="ghost" className="hover:text-destructive" disabled={empty}>
                      {t.deleteAll}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t.deleteAllTitle}</AlertDialogTitle>
                      <AlertDialogDescription>{t.deleteAllBody(total)}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={deleteAll}>
                        {t.deleteAll}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {page === null ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : empty ? (
                <p className="p-6 text-center text-sm text-muted-foreground">{t.noMatch}</p>
              ) : (
                <>
                  {page.messages.map((m) => (
                    <Row key={m.id} m={m} selected={m.id === selected} onClick={() => setSelected(m.id)} />
                  ))}
                  {hasMore && (
                    <div className="p-2">
                      <Button size="sm" variant="ghost" className="w-full" disabled={loadingMore} onClick={more}>
                        {loadingMore && <Spinner />}
                        {t.loadMore}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Message */}
          <div className="min-w-0 flex-1">
            {selected && selectedExists ? (
              <Viewer
                key={selected}
                id={selected}
                apiUrl={status.apiUrl}
                webUrl={status.webUrl}
                onChanged={() => load({ keep: shown })}
                onDeleted={() => {
                  setSelected(null);
                  toast(t.deleted);
                  load({ keep: shown });
                }}
              />
            ) : (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
                <div className="space-y-2">
                  <Icon name="envelope-open" variant="regular" className="w-auto text-3xl" />
                  <p>{t.choose}</p>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

export function MailPage() {
  const all = useT(messages);
  const t = all.idle;
  const c = useT(common);
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [view, setView] = useState<"inbox" | "settings">("inbox");
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => {
    api.mailStatus().then(setStatus).catch((e) => toast.error(String(e)));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("zefaro:refresh", load);
    return () => window.removeEventListener("zefaro:refresh", load);
  }, [load]);

  const start = async () => {
    setStarting(true);
    try {
      setStatus(await api.mailStart());
      toast.success(t.started);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setStarting(false);
    }
  };

  if (view === "settings") {
    return (
      <MailpitSettingsPage
        backLabel={c.nav.mail}
        onBack={() => {
          setView("inbox");
          load();
        }}
      />
    );
  }

  if (!status) {
    return (
      <>
        <PageHeader title={c.nav.mail} description={all.descriptionIdle} />
        <Skeleton className="h-64 w-full rounded-xl" />
      </>
    );
  }

  if (!status.running) {
    return (
      <>
        <PageHeader title={c.nav.mail} description={all.descriptionIdle} />
        <div className="space-y-4">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon name="envelope" />
              </EmptyMedia>
              <EmptyTitle>{status.installed ? t.notRunning : t.catch}</EmptyTitle>
              <EmptyDescription>
                {t.body}
                {!status.installed && t.download(status.version, status.downloadMb)}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={start} disabled={starting}>
                {starting ? <Spinner /> : <Icon name={status.installed ? "play" : "download"} />}
                {status.installed ? t.start : t.installStart}
              </Button>
            </EmptyContent>
          </Empty>
          <MailSetup smtpPort={status.settings.smtpPort} />
        </div>
      </>
    );
  }

  return <Inbox status={status} onSettings={() => setView("settings")} />;
}
