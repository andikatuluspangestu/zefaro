// Typography and helpers for the documentation page.

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import { Button } from "@/components/ui/button";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";
import { cn } from "@/lib/utils";

const messages = defineMessages({
  en: {
    code: "Code",
    copyFailed: "Zefaro couldn't copy to the clipboard. Select the text and copy it yourself.",
  },
  id: {
    code: "Kode",
    copyFailed: "Zefaro tidak bisa menyalin ke clipboard. Pilih teksnya lalu salin sendiri.",
  },
});

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="pt-3 text-sm font-semibold text-foreground">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-foreground/85">{children}</p>;
}

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em]">{children}</code>;
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground/85 marker:text-muted-foreground">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** Numbered steps with a filled number badge. */
export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed">
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-semibold tabular-nums"
          >
            {i + 1}
          </span>
          <div className="pt-0.5 text-foreground/85">{item}</div>
        </li>
      ))}
    </ol>
  );
}

/** Block of code or terminal commands with a copy button. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const t = useT(messages);
  const c = useT(common);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t.copyFailed);
    }
  };
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between border-b bg-muted/40 py-1 pr-1.5 pl-3">
        <span className="text-xs font-medium text-muted-foreground">{label ?? t.code}</span>
        <Button size="xs" variant="ghost" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} className="w-3" />
          {copied ? c.copied : c.copy}
        </Button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-xs leading-relaxed">{code}</pre>
    </div>
  );
}

export function Note({
  title,
  warn,
  children,
}: {
  title: string;
  warn?: boolean;
  children?: ReactNode;
}) {
  return (
    <IconAlert
      icon={warn ? "triangle-exclamation" : "circle-info"}
      title={title}
      className={cn(warn && "border-warning/40 text-warning *:data-[slot=alert-description]:text-warning/90")}
    >
      {children}
    </IconAlert>
  );
}

/** Two-column reference list: a short key and its explanation. */
export function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y overflow-hidden rounded-lg border text-sm">
      {rows.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)]">
          <dt className="bg-muted/40 px-3 py-2 font-mono text-xs leading-5 break-words">{key}</dt>
          <dd className="px-3 py-2 leading-relaxed text-foreground/85">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
