// Full-text search over the documentation as rendered on the page.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { defineMessages, useLang, useT } from "@/i18n";
import { cn } from "@/lib/utils";

const messages = defineMessages({
  en: {
    placeholder: "Search the documentation",
    clear: "Clear search",
    results: "Search results",
    noMatch: (query: ReactNode) => (
      <>
        Nothing in the documentation matches {query}. Try a shorter word, or a port, command or file
        name.
      </>
    ),
    top: (n: number) => `Top ${n} results.`,
    count: (n: number) => `${n} result${n === 1 ? "" : "s"}.`,
    hint: "Use the arrow keys and Enter to jump.",
  },
  id: {
    placeholder: "Cari di dokumentasi",
    clear: "Hapus pencarian",
    results: "Hasil pencarian",
    noMatch: (query: ReactNode) => (
      <>
        Tidak ada yang cocok dengan {query} di dokumentasi. Coba kata yang lebih pendek, atau port,
        perintah, atau nama file.
      </>
    ),
    top: (n: number) => `${n} hasil teratas.`,
    count: (n: number) => `${n} hasil.`,
    hint: "Gunakan tombol panah dan Enter untuk melompat.",
  },
});

/** One searchable block of a section: a heading, paragraph, list item, code block… */
type Entry = {
  sectionId: string;
  sectionTitle: string;
  /** The nearest sub-heading (or FAQ question) above the block. */
  heading: string | null;
  /** What the search matches against. */
  text: string;
  /** What the result shows. */
  display: string;
  el: HTMLElement;
};

type Hit = Entry & { score: number; order: number };

const BLOCKS = [
  "h2",
  "h3",
  "p",
  "li",
  "dt",
  "dd",
  "pre",
  "[data-slot=alert-title]",
  "[data-slot=alert-description]",
  "[data-slot=accordion-trigger]",
  "[data-slot=accordion-content]",
].join(", ");

const MAX_RESULTS = 12;
/** Classes that briefly mark the block a result jumped to. */
const FLASH = ["rounded-md", "bg-primary/10", "ring-2", "ring-primary/40"];

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Text of a block without button labels ("Open Services") or decoration (step numbers). */
function blockText(el: HTMLElement): string {
  if (el.matches("[data-slot=accordion-trigger]")) return squash(el.textContent ?? "");
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("button, [aria-hidden]").forEach((b) => b.remove());
  return squash(copy.textContent ?? "");
}

/** Reads every section on the page into search entries, in page order. */
function buildIndex(): Entry[] {
  const entries: Entry[] = [];
  document.querySelectorAll<HTMLElement>("[data-doc-section]").forEach((section) => {
    const sectionId = section.id;
    const sectionTitle = section.dataset.docTitle ?? "";
    const summary = section.dataset.docSummary ?? "";
    let heading: string | null = null;
    section.querySelectorAll<HTMLElement>(BLOCKS).forEach((el) => {
      // The section summary is shown with the title (h2) instead.
      if (el.closest("header")?.parentElement === section && el.tagName === "P") return;
      // An FAQ question's <h3> wrapper; the trigger inside it is indexed instead.
      if (el.tagName === "H3" && el.querySelector("[data-slot=accordion-trigger]")) return;
      const text = blockText(el);
      if (!text) return;
      if (el.tagName === "H2") {
        entries.push({ sectionId, sectionTitle, heading: null, text, display: summary, el });
        return;
      }
      if (el.tagName === "H3" || el.matches("[data-slot=accordion-trigger]")) heading = text;
      entries.push({ sectionId, sectionTitle, heading, text, display: text, el });
    });
  });
  return entries;
}

function search(entries: Entry[], query: string): Hit[] {
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: Hit[] = [];
  entries.forEach((e, order) => {
    const own = e.text.toLowerCase();
    const context = `${e.sectionTitle} ${e.heading ?? ""}`.toLowerCase();
    // Every word must appear somewhere; at least one in the block itself.
    if (!words.every((w) => own.includes(w) || context.includes(w))) return;
    if (!words.some((w) => own.includes(w))) return;
    let score = 0;
    if (e.el.tagName === "H2" && own.includes(q)) score += 4;
    if (e.heading?.toLowerCase().includes(q)) score += 2;
    if (own.includes(q)) score += 1;
    hits.push({ ...e, score, order });
  });
  return hits.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, MAX_RESULTS);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A short window of `text` around the first match, with every match marked. */
function Snippet({ text, words }: { text: string; words: string[] }) {
  const lower = text.toLowerCase();
  const first = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), text.length);
  let start = 0;
  let end = text.length;
  if (text.length > 140) {
    start = Math.max(0, first - 40);
    // Start on a whole word.
    if (start > 0) start = text.indexOf(" ", start) + 1 || start;
    end = Math.min(text.length, start + 140);
  }
  const part = `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  if (!words.length) return <>{part}</>;
  const re = new RegExp(`(${words.map(escapeRe).join("|")})`, "gi");
  const pieces: ReactNode[] = part.split(re).map((p, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-primary/20 px-px text-foreground">
        {p}
      </mark>
    ) : (
      p
    )
  );
  return <>{pieces}</>;
}

/** Opens a closed FAQ item that holds `el`, then waits for it to render. */
async function reveal(el: HTMLElement) {
  const item = el.closest<HTMLElement>("[data-slot=accordion-item]");
  if (item?.dataset.state === "closed" && !el.matches("[data-slot=accordion-trigger]")) {
    item.querySelector<HTMLElement>("[data-slot=accordion-trigger]")?.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
}

function flash(el: HTMLElement) {
  el.classList.add(...FLASH);
  window.setTimeout(() => el.classList.remove(...FLASH), 1600);
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function DocsSearch({ onJump }: { onJump: (sectionId: string) => void }) {
  const t = useT(messages);
  const { lang } = useLang();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const index = useRef<Entry[] | null>(null);
  /** Bumped when the page changes language, so the index is read again from the new text. */
  const [indexVersion, setIndexVersion] = useState(0);

  // Effects run after the page has rendered in the new language, so the next build reads it.
  useEffect(() => {
    index.current = null;
    setIndexVersion((v) => v + 1);
  }, [lang]);

  // Ctrl+K or / puts the cursor in the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (combo || (e.key === "/" && !isTyping(e.target))) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const words = useMemo(() => query.toLowerCase().trim().split(/\s+/).filter(Boolean), [query]);
  const hits = useMemo(() => {
    if (!words.length) return [];
    index.current ??= buildIndex();
    return search(index.current, query);
    // indexVersion: rebuild after a language change.
  }, [query, words, indexVersion]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = async (hit: Hit) => {
    setOpen(false);
    input.current?.blur();
    await reveal(hit.el);
    onJump(hit.sectionId);
    const target = hit.el.tagName === "H2" ? (hit.el.closest("section") ?? hit.el) : hit.el;
    target.scrollIntoView({ behavior: "smooth", block: hit.el.tagName === "H2" ? "start" : "center" });
    flash(hit.el.closest<HTMLElement>("[data-slot=accordion-item]") ?? hit.el);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    } else if (e.key === "Escape") {
      if (query) setQuery("");
      else input.current?.blur();
    }
  };

  const showList = open && words.length > 0;

  return (
    <div className="relative">
      <InputGroup className="h-9 bg-background">
        <InputGroupAddon>
          <Icon name="magnifying-glass" className="w-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={t.placeholder}
          role="combobox"
          aria-label={t.placeholder}
          aria-expanded={showList}
          aria-controls="docs-search-results"
          aria-activedescendant={showList && hits[active] ? `docs-hit-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        <InputGroupAddon align="inline-end">
          {query ? (
            <InputGroupButton
              size="icon-xs"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
              aria-label={t.clear}
            >
              <Icon name="xmark" className="w-3" />
            </InputGroupButton>
          ) : (
            <kbd className="rounded border bg-muted px-1.5 font-sans text-[10px] text-muted-foreground">
              Ctrl K
            </kbd>
          )}
        </InputGroupAddon>
      </InputGroup>

      {showList && (
        <div
          ref={list}
          id="docs-search-results"
          role="listbox"
          aria-label={t.results}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-[min(24rem,60vh)] overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          {hits.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {t.noMatch(<strong className="text-foreground">{query.trim()}</strong>)}
            </p>
          ) : (
            hits.map((h, i) => (
              <div
                key={`${h.sectionId}-${h.order}`}
                id={`docs-hit-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setActive(i)}
                onClick={() => go(h)}
                className={cn(
                  "cursor-pointer space-y-0.5 rounded-md px-3 py-2",
                  i === active && "bg-accent text-accent-foreground"
                )}
              >
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="shrink-0 font-medium text-foreground">{h.sectionTitle}</span>
                  {h.heading && h.heading !== h.text && (
                    <>
                      <Icon name="chevron-right" className="w-2 shrink-0 text-[8px]" />
                      <span className="truncate">{h.heading}</span>
                    </>
                  )}
                </p>
                <p className="line-clamp-2 text-sm leading-snug text-foreground/85">
                  <Snippet text={h.display || h.text} words={words} />
                </p>
              </div>
            ))
          )}
          {hits.length > 0 && (
            <p className="border-t px-3 pt-1.5 pb-1 text-[11px] text-muted-foreground">
              {hits.length === MAX_RESULTS ? t.top(MAX_RESULTS) : t.count(hits.length)} {t.hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
