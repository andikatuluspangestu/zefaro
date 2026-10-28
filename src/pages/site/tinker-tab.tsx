import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { defineMessages, useT } from "@/i18n";
import { DumpTree } from "./dump-tree";
import { copyText } from "./shared";
import type { TinkerReply } from "./types";

const messages = defineMessages({
  en: {
    placeholder: "Write PHP, like in php artisan tinker. The last expression is shown.\nExample: App\\Models\\User::count()",
    run: "Run",
    stop: "Stop",
    reset: "Reset session",
    resetHint: "Forget variables and start a new PHP process",
    shortcut: "Ctrl+Enter runs",
    rollback: "Undo database changes after each run",
    rollbackHint: "Wraps the run in a transaction and rolls it back, so you can try writes safely.",
    production: "This app runs in production. Code here reads and changes real data.",
    session: (v: string | undefined) => `Session${v ? ` · Laravel ${v}` : ""}`,
    freshSession: "A new session started, so earlier variables are gone.",
    variables: "Variables",
    empty: "Nothing yet. Run some code to start a session; variables stay until you reset it.",
    noValue: "No value returned",
    output: "Output",
    dumps: "dump()",
    queries: (n: number, ms: number) => `${n} ${n === 1 ? "query" : "queries"} · ${ms.toFixed(1)} ms`,
    bindings: "Bindings",
    rolledBack: "Database changes were undone",
    ended: "The session ended",
    endedHint: "The next run starts a new session; variables are gone.",
    stderr: "Messages",
    reuse: "Put this code back in the editor",
    copyCode: "Copy code",
    copied: "Code copied",
    running: "Running…",
    memory: "peak memory",
    failed: "Zefaro couldn't run this",
    trace: "Stack",
    clear: "Clear history",
  },
  id: {
    placeholder: "Tulis PHP seperti di php artisan tinker. Ekspresi terakhir ditampilkan.\nContoh: App\\Models\\User::count()",
    run: "Jalankan",
    stop: "Hentikan",
    reset: "Reset sesi",
    resetHint: "Lupakan variabel dan mulai proses PHP baru",
    shortcut: "Ctrl+Enter menjalankan",
    rollback: "Batalkan perubahan database setelah tiap jalan",
    rollbackHint: "Membungkus proses dalam transaksi lalu di-rollback, jadi Anda bisa mencoba penulisan dengan aman.",
    production: "Aplikasi ini berjalan di production. Kode di sini membaca dan mengubah data sungguhan.",
    session: (v: string | undefined) => `Sesi${v ? ` · Laravel ${v}` : ""}`,
    freshSession: "Sesi baru dimulai, jadi variabel sebelumnya hilang.",
    variables: "Variabel",
    empty: "Belum ada. Jalankan kode untuk memulai sesi; variabel tetap ada sampai Anda mereset.",
    noValue: "Tidak ada nilai dikembalikan",
    output: "Output",
    dumps: "dump()",
    queries: (n: number, ms: number) => `${n} query · ${ms.toFixed(1)} ms`,
    bindings: "Binding",
    rolledBack: "Perubahan database dibatalkan",
    ended: "Sesi berakhir",
    endedHint: "Proses berikutnya memulai sesi baru; variabel hilang.",
    stderr: "Pesan",
    reuse: "Kembalikan kode ini ke editor",
    copyCode: "Salin kode",
    copied: "Kode disalin",
    running: "Berjalan…",
    memory: "memori puncak",
    failed: "Zefaro tidak bisa menjalankan ini",
    trace: "Stack",
    clear: "Bersihkan riwayat",
  },
});

interface Entry {
  id: number;
  code: string;
  rollback: boolean;
  running: boolean;
  reply?: TinkerReply;
  failure?: string;
  /** The session had variables, but a new process answered: they're gone. */
  lostVariables?: boolean;
}

const fmtBytes = (n: number) => `${(n / 1048576).toFixed(0)} MB`;

export function TinkerTab({
  site,
  draft,
  environment,
}: {
  site: string;
  draft: { code: string; at: number } | null;
  environment: string | null;
}) {
  const t = useT(messages);
  const [code, setCode] = useState("");
  const [rollback, setRollback] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [vars, setVars] = useState<{ name: string; type: string }[]>([]);
  const [laravel, setLaravel] = useState<string | undefined>();
  const [cursor, setCursor] = useState<number | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  // A session that has answered and not ended or been reset.
  const live = useRef(false);
  const running = entries.some((e) => e.running);

  useEffect(() => {
    if (!draft) return;
    setCode(draft.code);
    window.setTimeout(() => editor.current?.focus(), 0);
  }, [draft]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [entries]);

  const run = async () => {
    const text = code.trim();
    if (!text || running) return;
    const id = nextId.current++;
    setEntries((all) => [...all, { id, code: text, rollback, running: true }]);
    setCode("");
    setCursor(null);
    try {
      const hadSession = live.current;
      const reply = await api.tinkerEval(site, text, rollback);
      live.current = !reply.ended;
      const lostVariables = hadSession && !!reply.started;
      setEntries((all) => all.map((e) => (e.id === id ? { ...e, running: false, reply, lostVariables } : e)));
      setVars(reply.ended ? [] : (reply.vars ?? []));
      if (reply.laravel) setLaravel(reply.laravel);
    } catch (e) {
      setEntries((all) => all.map((x) => (x.id === id ? { ...x, running: false, failure: String(e) } : x)));
    }
  };

  const reset = async () => {
    await api.tinkerReset(site).catch(() => {});
    live.current = false;
    setVars([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run();
      return;
    }
    // Arrow keys walk through earlier code while the editor is empty or showing one of them.
    const history = entries.map((x) => x.code);
    if (e.key === "ArrowUp" && history.length && (code === "" || cursor !== null) && !code.slice(0, editor.current?.selectionStart ?? 0).includes("\n")) {
      e.preventDefault();
      const i = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(i);
      setCode(history[i]);
    } else if (e.key === "ArrowDown" && cursor !== null) {
      e.preventDefault();
      if (cursor >= history.length - 1) {
        setCursor(null);
        setCode("");
      } else {
        setCursor(cursor + 1);
        setCode(history[cursor + 1]);
      }
    }
  };

  return (
    <div className="space-y-3">
      {environment === "production" && (
        <IconAlert icon="triangle-exclamation" className="border-warning/40 text-warning" title={t.production} />
      )}

      <Card className="gap-0 overflow-hidden py-0">
        <Textarea
          ref={editor}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setCursor(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={t.placeholder}
          spellCheck={false}
          rows={Math.min(12, Math.max(4, code.split("\n").length + 1))}
          className="resize-none rounded-none border-0 bg-transparent px-4 py-3 font-mono text-xs leading-relaxed shadow-none focus-visible:ring-0"
          aria-label="Tinker"
        />
        <div className="flex flex-wrap items-center gap-3 border-t px-3 py-2">
          <Button size="sm" onClick={run} disabled={!code.trim() || running}>
            {running ? <Spinner className="size-3" /> : <Icon name="play" className="w-3" />}
            {t.run}
          </Button>
          {running && (
            <Button size="sm" variant="outline" onClick={() => api.tinkerStop(site)}>
              <Icon name="stop" className="w-3" />
              {t.stop}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={reset} disabled={running} title={t.resetHint}>
            <Icon name="rotate-left" className="w-3" />
            {t.reset}
          </Button>
          <label className="ml-auto flex items-center gap-2 text-xs" title={t.rollbackHint}>
            <Switch checked={rollback} onCheckedChange={setRollback} />
            {t.rollback}
          </label>
          <span className="hidden text-xs text-muted-foreground sm:inline">{t.shortcut}</span>
        </div>
      </Card>

      {vars.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t.variables}</span>
          {vars.map((v) => (
            <Badge key={v.name} variant="outline" className="font-mono" title={v.type}>
              ${v.name}
              <span className="ml-1 text-muted-foreground">{v.type.split("\\").pop()}</span>
            </Badge>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t.session(laravel)}</span>
            <button className="hover:text-foreground" onClick={() => setEntries([])}>
              {t.clear}
            </button>
          </div>
          {entries.map((entry) => (
            <EntryView
              key={entry.id}
              entry={entry}
              t={t}
              onReuse={() => {
                setCode(entry.code);
                editor.current?.focus();
              }}
            />
          ))}
          <div ref={bottom} />
        </div>
      )}
    </div>
  );
}

function EntryView({ entry, t, onReuse }: { entry: Entry; t: typeof messages.en; onReuse: () => void }) {
  const r = entry.reply;
  const [showQueries, setShowQueries] = useState(false);
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="group flex items-start gap-2 border-b bg-muted/30 px-3 py-2">
        <Icon name="angle-right" className="mt-0.5 w-3 text-xs text-primary" />
        <pre className="min-w-0 flex-1 font-mono text-xs whitespace-pre-wrap">{entry.code}</pre>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button size="icon-xs" variant="ghost" title={t.reuse} aria-label={t.reuse} onClick={onReuse}>
            <Icon name="arrow-turn-up" className="w-3" />
          </Button>
          <Button size="icon-xs" variant="ghost" title={t.copyCode} aria-label={t.copyCode} onClick={() => copyText(entry.code, t.copied)}>
            <Icon name="copy" className="w-3" />
          </Button>
        </div>
      </div>
      <div className="space-y-2 px-3 py-2.5 font-mono text-xs leading-relaxed">
        {entry.running && (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-3" />
            {t.running}
          </span>
        )}
        {entry.failure && (
          <div className="text-destructive">
            <p className="font-sans font-medium">{t.failed}</p>
            <p className="break-words whitespace-pre-wrap">{entry.failure}</p>
          </div>
        )}
        {r && (
          <>
            {r.output && (
              <Section label={t.output}>
                <pre className="break-words whitespace-pre-wrap">{r.output}</pre>
              </Section>
            )}
            {r.dumps.map((d, i) => (
              <Section key={i} label={t.dumps}>
                <DumpTree node={d} />
              </Section>
            ))}
            {r.stderr && (
              <Section label={t.stderr}>
                <pre className="break-words whitespace-pre-wrap text-warning">{r.stderr.trim()}</pre>
              </Section>
            )}
            {r.error && (
              <div className="text-destructive">
                <p className="break-words whitespace-pre-wrap">
                  <span className="font-medium">{r.error.class.split("\\").pop()}</span>: {r.error.message}
                </p>
                {r.error.file && (
                  <p className="text-muted-foreground">
                    {r.error.file}:{r.error.line}
                  </p>
                )}
                {r.error.trace.length > 0 && (
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer select-none">{t.trace}</summary>
                    {r.error.trace.map((f, i) => (
                      <div key={i}>
                        {f.file || "tinker"}:{f.line}
                      </div>
                    ))}
                  </details>
                )}
              </div>
            )}
            {r.ended && !r.error?.class.startsWith("Session") && (
              <p className="font-sans text-warning">
                {t.ended}. {t.endedHint}
              </p>
            )}
            {r.ended && r.error?.class === "Session" && (
              <p className="font-sans text-warning">
                {r.error.message} {t.endedHint}
              </p>
            )}
            {r.ok && r.result && (r.result.t !== "null" || (!r.output && r.dumps.length === 0)) && <DumpTree node={r.result} />}
            {entry.lostVariables && <p className="font-sans text-muted-foreground">{t.freshSession}</p>}
            <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 font-sans text-[11px] text-muted-foreground", !r.ok && "border-destructive/20")}>
              {r.timeMs !== undefined && <span>{r.timeMs.toFixed(1)} ms</span>}
              {r.memory !== undefined && (
                <span>
                  {fmtBytes(r.memory)} {t.memory}
                </span>
              )}
              {r.queries.length > 0 && (
                <button className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => setShowQueries(!showQueries)}>
                  {t.queries(r.queries.length, r.queries.reduce((a, q) => a + q.time, 0))}
                </button>
              )}
              {r.rolledBack && <span className="text-warning">{t.rolledBack}</span>}
            </div>
            {showQueries && (
              <ul className="space-y-1.5 rounded-md bg-background p-2">
                {r.queries.map((q, i) => (
                  <li key={i}>
                    <code className="break-words whitespace-pre-wrap">{q.sql}</code>
                    <div className="text-muted-foreground">
                      {q.bindings.length > 0 && <span>{t.bindings}: {JSON.stringify(q.bindings)} · </span>}
                      {q.time.toFixed(2)} ms · {q.connection}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 font-sans text-[11px] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
