import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";
import type { JobOutput, SiteJob } from "./types";

// Pieces several tabs of the site page use: running a job to the end,
// showing its output, hiding secret values, copying text.

const messages = defineMessages({
  en: {
    show: "Show value",
    hide: "Hide value",
    exit: (code: number | null) => (code === null ? "Ended" : `Exit code ${code}`),
    stopped: "Stopped",
    noOutput: "No output.",
    earlier: (n: number) => `${n} earlier lines not kept`,
  },
  id: {
    show: "Tampilkan nilai",
    hide: "Sembunyikan nilai",
    exit: (code: number | null) => (code === null ? "Selesai" : `Kode keluar ${code}`),
    stopped: "Dihentikan",
    noOutput: "Tidak ada output.",
    earlier: (n: number) => `${n} baris awal tidak disimpan`,
  },
});

/** Config and .env names whose values are secrets. */
export const isSecretKey = (key: string) => /pass(word)?|secret|token|(^|[._])key$|private|dsn|salt|credential/i.test(key);

export async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch (e) {
    toast.error(String(e));
  }
}

/** Follow a job: output lines as they arrive, then the finished job. */
export function useJob(jobId: number | null) {
  const [output, setOutput] = useState<{ job: SiteJob | null; lines: string[]; dropped: number }>({
    job: null,
    lines: [],
    dropped: 0,
  });
  useEffect(() => {
    setOutput({ job: null, lines: [], dropped: 0 });
    if (jobId === null) return;
    let next = 0;
    let stop = false;
    let timer = 0;
    const poll = async () => {
      try {
        const out: JobOutput | null = await api.siteJobOutput(jobId, next);
        if (stop || !out) return;
        next = out.from + out.lines.length;
        setOutput((prev) => ({ job: out.job, lines: [...prev.lines, ...out.lines], dropped: out.job.dropped }));
        if (out.job.state === "running") timer = window.setTimeout(poll, 400);
      } catch {
        if (!stop) timer = window.setTimeout(poll, 1000);
      }
    };
    poll();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [jobId]);
  return output;
}

/** Run a job and wait for it to finish. Resolves to the finished job and its last lines. */
export async function runToEnd(site: string, tool: "artisan" | "composer", args: string[]) {
  const job = await api.siteJobRun(site, tool, args);
  let lines: string[] = [];
  let next = 0;
  for (;;) {
    const out = await api.siteJobOutput(job.id, next);
    if (!out) return { job, lines };
    lines = [...lines, ...out.lines].slice(-200);
    next = out.from + out.lines.length;
    if (out.job.state !== "running") return { job: out.job, lines };
    await new Promise((r) => window.setTimeout(r, 400));
  }
}

/** Last non-empty line of output, for a toast. */
export const lastLine = (lines: string[]) => [...lines].reverse().find((l) => l.trim() !== "")?.trim() ?? "";

export function JobState({ job }: { job: SiteJob }) {
  const t = useT(messages);
  const c = useT(common);
  if (job.state === "running")
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        {c.running}
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "inline-flex size-2 rounded-full",
          job.state === "done" ? "bg-success" : job.state === "stopped" ? "bg-muted-foreground/40" : "bg-destructive"
        )}
      />
      {job.state === "stopped" ? t.stopped : t.exit(job.exitCode)}
    </span>
  );
}

/** A job's output, following new lines while it runs. */
export function JobConsole({
  jobId,
  className,
  actions,
}: {
  jobId: number;
  className?: string;
  actions?: ReactNode;
}) {
  const t = useT(messages);
  const c = useT(common);
  const { job, lines, dropped } = useJob(jobId);
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-background", className)}>
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs" title={job?.command}>
          {job?.command}
        </code>
        {job && <JobState job={job} />}
        {job?.state === "running" && (
          <Button size="xs" variant="outline" onClick={() => api.siteJobStop(job.id)}>
            <Icon name="stop" className="w-3" />
            {c.stop}
          </Button>
        )}
        {actions}
      </div>
      <pre ref={box} className="max-h-80 min-h-24 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {dropped > 0 && <span className="text-muted-foreground">{t.earlier(dropped)}{"\n"}</span>}
        {lines.length ? lines.join("\n") : job && job.state !== "running" ? <span className="text-muted-foreground">{t.noOutput}</span> : null}
      </pre>
    </div>
  );
}

/** A secret shown as dots until the eye is clicked. */
export function Masked({ value, className }: { value: string; className?: string }) {
  const t = useT(messages);
  const [shown, setShown] = useState(false);
  if (value === "") return <span className={className} />;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <span className="truncate">{shown ? value : "••••••••"}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground"
        aria-label={shown ? t.hide : t.show}
        title={shown ? t.hide : t.show}
        onClick={(e) => {
          e.stopPropagation();
          setShown(!shown);
        }}
      >
        <Icon name={shown ? "eye-slash" : "eye"} className="w-3 text-[11px]" />
      </Button>
    </span>
  );
}

/** A config or JSON value as short text: strings unquoted, the rest as JSON. */
export function showValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}
