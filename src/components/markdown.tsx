import { Fragment, type ReactNode } from "react";

/**
 * The Markdown of Zefaro's release notes, as React elements: headings, lists
 * (nested by indentation), paragraphs, rules, code blocks, and inline code,
 * bold, italics and links. Nothing is parsed as HTML. A link shows its text
 * only: the notes are read here, not followed to a web page.
 */

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; children: Block[] }[] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

/** Indentation in columns (a tab counts as four). */
const indentOf = (line: string) => line.match(/^\s*/)![0].replace(/\t/g, "    ").length;

export function parseMarkdown(text: string): Block[] {
  return parseBlocks(text.replace(/\r/g, "").split("\n"));
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    const first = line.match(ITEM);
    if (first) {
      const base = indentOf(line);
      const ordered = /\d/.test(first[2]);
      const items: { text: string; children: Block[] }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(ITEM);
        if (!m || indentOf(lines[i]) !== base) break;
        const text = [m[3]];
        const nested: string[] = [];
        i++;
        // The item's continuation lines, and anything indented under it.
        while (i < lines.length) {
          const next = lines[i];
          if (!next.trim()) {
            const after = lines.slice(i + 1).find((l) => l.trim());
            if (after !== undefined && indentOf(after) > base) {
              nested.push("");
              i++;
              continue;
            }
            break;
          }
          if (indentOf(next) <= base) break;
          if (nested.length || ITEM.test(next)) nested.push(next);
          else text.push(next.trim());
          i++;
        }
        items.push({ text: text.join(" "), children: parseBlocks(nested) });
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEADING.test(lines[i]) &&
      !ITEM.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !lines[i].trim().startsWith("```")
    ) {
      para.push(lines[i++].trim());
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

// Bold and italics may hold code spans, whose `*` don't end them.
const INLINE =
  /(`[^`]+`)|(\*\*(?:`[^`]*`|[^*`])+?\*\*)|(\*(?:`[^`]*`|[^*\s`])(?:`[^`]*`|[^*`])*?\*)|(\[[^\]]+\]\([^)]+\))/g;

/** Inline code, bold, italics and links (as their text). */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const s = m[0];
    if (m[1]) {
      out.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {s.slice(1, -1)}
        </code>
      );
    } else if (m[2]) {
      out.push(<strong key={key++}>{inline(s.slice(2, -2))}</strong>);
    } else if (m[3]) {
      out.push(<em key={key++}>{inline(s.slice(1, -1))}</em>);
    } else {
      out.push(<Fragment key={key++}>{inline(s.slice(1, s.indexOf("](")))}</Fragment>);
    }
    last = at + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function render(blocks: Block[]): ReactNode[] {
  return blocks.map((b, i) => {
    switch (b.kind) {
      case "heading":
        return b.level <= 2 ? (
          <h3 key={i} className="pt-2 text-sm font-semibold text-foreground first:pt-0">
            {inline(b.text)}
          </h3>
        ) : (
          <h4 key={i} className="text-sm font-medium text-foreground">
            {inline(b.text)}
          </h4>
        );
      case "paragraph":
        return <p key={i}>{inline(b.text)}</p>;
      case "rule":
        return <hr key={i} className="border-border" />;
      case "code":
        return (
          <pre key={i} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
            {b.text}
          </pre>
        );
      case "list": {
        const List = b.ordered ? "ol" : "ul";
        return (
          <List key={i} className={b.ordered ? "list-decimal space-y-1.5 pl-5" : "list-disc space-y-1.5 pl-5"}>
            {b.items.map((item, j) => (
              <li key={j} className="space-y-1.5 marker:text-muted-foreground">
                <span>{inline(item.text)}</span>
                {render(item.children)}
              </li>
            ))}
          </List>
        );
      }
    }
  });
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{render(parseMarkdown(text))}</div>;
}
