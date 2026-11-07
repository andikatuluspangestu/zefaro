import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import type { TunnelRequest } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    title: "Requests",
    hint: "What reached the site through the shared address, newest first: handy for webhooks. Zefaro keeps the last 200 while the site is shared.",
    empty: "Nothing yet. Open the address, or let the service send its webhook.",
    clear: "Clear",
    replay: "Send again",
    replayed: "Sent again",
    copyBody: "Copy body",
    copied: "Body copied",
    headers: "Headers",
    body: "Body",
    noBody: "No body.",
    binary: (size: string) => `Binary body, ${size}.`,
    truncated: (size: string) => `The body is ${size}; the first 1 MB is shown, and it can't be sent again.`,
    websocket: "WebSocket",
    again: "replay",
    waiting: "waiting",
  },
  id: {
    title: "Request",
    hint: "Yang masuk ke situs lewat alamat yang dibagikan, terbaru di atas: berguna untuk webhook. Zefaro menyimpan 200 terakhir selama situs dibagikan.",
    empty: "Belum ada. Buka alamatnya, atau tunggu layanan mengirim webhook-nya.",
    clear: "Bersihkan",
    replay: "Kirim ulang",
    replayed: "Sudah dikirim ulang",
    copyBody: "Salin body",
    copied: "Body disalin",
    headers: "Header",
    body: "Body",
    noBody: "Tanpa body.",
    binary: (size: string) => `Body biner, ${size}.`,
    truncated: (size: string) => `Body-nya ${size}; yang ditampilkan 1 MB pertama, dan tidak bisa dikirim ulang.`,
    websocket: "WebSocket",
    again: "kirim ulang",
    waiting: "menunggu",
  },
});

const size = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** JSON bodies are shown indented. */
function pretty(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function statusTone(status: number | null) {
  if (status === null) return "text-muted-foreground";
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-warning";
  return "text-success";
}

/** Under the share banner: the requests that came in, and one opened. */
export function SharedRequests({ site }: { site: string }) {
  const t = useT(messages);
  const [list, setList] = useState<TunnelRequest[]>([]);
  const [open, setOpen] = useState<TunnelRequest | null>(null);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(() => api.tunnelRequests(site).then(setList).catch(() => {}), [site]);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const show = (id: number) =>
    api
      .tunnelRequest(site, id)
      .then(setOpen)
      .catch((e) => toast.error(String(e)));

  const replay = async (id: number) => {
    setSending(true);
    try {
      const again = await api.tunnelReplay(site, id);
      toast.success(t.replayed);
      await refresh();
      await show(again);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="mb-5 gap-0 py-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Icon name="right-left" className="text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t.title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{list.length}</span>
        {list.length > 0 && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              setOpen(null);
              api.tunnelRequestsClear(site).then(refresh);
            }}
          >
            {t.clear}
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <div className="grid xl:grid-cols-2">
          <ul className="max-h-80 divide-y overflow-auto border-b xl:border-r xl:border-b-0">
            {list.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => show(r.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                    open?.id === r.id && "bg-muted",
                  )}
                >
                  <span className="w-14 shrink-0 font-mono text-xs font-semibold">{r.method}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={r.path}>
                    {r.path}
                  </span>
                  {r.replay && <Badge variant="outline">{t.again}</Badge>}
                  {r.websocket && <Badge variant="outline">{t.websocket}</Badge>}
                  <span className={cn("w-10 text-right font-mono text-xs tabular-nums", statusTone(r.status))}>
                    {r.status ?? "…"}
                  </span>
                  <span className="hidden w-16 text-right text-xs text-muted-foreground tabular-nums sm:inline">{time(r.atMs)}</span>
                </button>
              </li>
            ))}
          </ul>
          {open ? (
            <div className="min-w-0 space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs" title={`${open.method} ${open.path}`}>
                  {open.method} {open.path}
                </code>
                <span className={cn("font-mono text-xs", statusTone(open.status))}>
                  {open.status ?? t.waiting}
                  {open.durationMs !== null && ` · ${open.durationMs} ms`}
                </span>
                {open.body && !open.binary && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(open.body)
                        .then(() => toast.success(t.copied))
                        .catch((e) => toast.error(String(e)))
                    }
                  >
                    <Icon name="copy" />
                    {t.copyBody}
                  </Button>
                )}
                {!open.websocket && !open.truncated && (
                  <Button size="xs" variant="outline" disabled={sending} onClick={() => replay(open.id)}>
                    {sending ? <Spinner className="size-3" /> : <Icon name="rotate-right" />}
                    {t.replay}
                  </Button>
                )}
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{t.headers}</h4>
                <dl className="max-h-40 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs">
                  {open.headers.map(([k, v], i) => (
                    <div key={`${k}-${i}`} className="flex gap-2">
                      <dt className="shrink-0 text-muted-foreground">{k}:</dt>
                      <dd className="min-w-0 break-all">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{t.body}</h4>
                {open.truncated && <p className="mb-1 text-xs text-warning">{t.truncated(size(open.bodyBytes))}</p>}
                {open.binary ? (
                  <p className="text-xs text-muted-foreground">{t.binary(size(open.bodyBytes))}</p>
                ) : open.body ? (
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">{pretty(open.body)}</pre>
                ) : (
                  <p className="text-xs text-muted-foreground">{t.noBody}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t.hint}</p>
          )}
        </div>
      )}
    </Card>
  );
}
