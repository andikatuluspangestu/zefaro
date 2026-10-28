import { useState } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { defineMessages, useT } from "@/i18n";
import { Masked, isSecretKey } from "./shared";
import type { DumpNode } from "./types";

const messages = defineMessages({
  en: {
    more: (n: number) => `${n} more not shown`,
    binary: (n: number) => `binary, ${n} bytes`,
    chars: (n: number) => `${n} chars`,
    recursion: "recursion",
    empty: "empty",
    items: (n: number) => `${n} ${n === 1 ? "item" : "items"}`,
    newModel: "not saved",
    truncated: "shortened",
  },
  id: {
    more: (n: number) => `${n} lagi tidak ditampilkan`,
    binary: (n: number) => `biner, ${n} byte`,
    chars: (n: number) => `${n} karakter`,
    recursion: "rekursi",
    empty: "kosong",
    items: (n: number) => `${n} item`,
    newModel: "belum disimpan",
    truncated: "dipotong",
  },
});

const short = (cls: string) => cls.split("\\").pop() ?? cls;

/** A value from a Tinker run, as an expandable tree. */
export function DumpTree({ node, name, depth = 0 }: { node: DumpNode; name?: string; depth?: number }) {
  const t = useT(messages);
  const container = node.k !== undefined || node.more !== undefined;
  const [open, setOpen] = useState(depth < 1);

  const key = name !== undefined && (
    <span className={cn("shrink-0", name.startsWith("@") ? "text-info" : "text-muted-foreground")}>
      {name}
      <span className="text-muted-foreground/60">: </span>
    </span>
  );

  if (!container) {
    return (
      <div className="flex min-w-0 gap-0 py-px">
        {key}
        <Scalar node={node} secret={name !== undefined && isSecretKey(name)} />
      </div>
    );
  }

  const count = node.n ?? node.k?.length ?? 0;
  const label =
    node.t === "array" ? (
      <span className="text-muted-foreground">array:{count}</span>
    ) : (
      <>
        <span className="text-warning" title={node.c}>{node.c ? short(node.c) : node.t}</span>
        {node.t === "model" && (
          <span className="text-muted-foreground"> #{node.v === "new" ? t.newModel : node.v}</span>
        )}
        {node.t === "collection" && <span className="text-muted-foreground"> ({count})</span>}
        {node.t === "object" && node.v !== undefined && <span className="text-muted-foreground"> {JSON.stringify(node.v)}</span>}
        {node.t === "collection" && node.v !== undefined && <span className="text-muted-foreground"> {String(node.v)}</span>}
      </>
    );

  return (
    <div className="py-px">
      <button className="flex max-w-full items-center gap-1 text-left hover:text-foreground" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={open ? "caret-down" : "caret-right"} className="w-3 text-[10px] text-muted-foreground" />
        {key}
        {label}
        {!open && node.k && node.k.length === 0 && <span className="ml-1 text-muted-foreground/60">{t.empty}</span>}
      </button>
      {open && (
        <div className="ml-[5px] border-l pl-3">
          {node.k?.map((child, i) => <DumpTree key={`${child.key}-${i}`} node={child.value} name={child.key} depth={depth + 1} />)}
          {node.k?.length === 0 && <div className="text-muted-foreground/60">{t.empty}</div>}
          {node.more ? <div className="text-muted-foreground/70">… {t.more(node.more)}</div> : null}
        </div>
      )}
    </div>
  );
}

function Scalar({ node, secret }: { node: DumpNode; secret: boolean }) {
  const t = useT(messages);
  switch (node.t) {
    case "null":
      return <span className="text-muted-foreground/70 italic">null</span>;
    case "bool":
      return <span className={node.v ? "text-success" : "text-destructive"}>{String(node.v)}</span>;
    case "int":
    case "float":
      return <span className="text-info">{String(node.v)}</span>;
    case "string": {
      const text = String(node.v ?? "");
      if (secret && text !== "") return <Masked value={text} />;
      const cut = node.n !== undefined && node.n > text.length;
      return (
        <span className="min-w-0 break-words whitespace-pre-wrap text-success/90" title={cut ? t.chars(node.n!) : undefined}>
          "{text}"
          {cut && <span className="text-muted-foreground"> … {t.truncated} ({t.chars(node.n!)})</span>}
        </span>
      );
    }
    case "binary":
      return <span className="text-muted-foreground">{t.binary(node.n ?? 0)}</span>;
    case "date":
      return (
        <span className="text-warning">
          {String(node.v)} <span className="text-muted-foreground">{node.c ? short(node.c) : ""}</span>
        </span>
      );
    case "enum":
      return (
        <span>
          <span className="text-warning">{node.c ? short(node.c) : "enum"}</span>
          <span className="text-muted-foreground">::</span>
          {String(node.v)}
        </span>
      );
    case "closure":
      return <span className="text-warning">Closure</span>;
    case "resource":
      return <span className="text-muted-foreground">resource ({String(node.v)})</span>;
    case "object":
      return (
        <span>
          <span className="text-warning">{node.c ? short(node.c) : "object"}</span>{" "}
          <span className="text-muted-foreground">{node.v === "recursion" ? `*${t.recursion}*` : String(node.v ?? "")}</span>
        </span>
      );
    default:
      return <span className="text-muted-foreground">{node.t}</span>;
  }
}
