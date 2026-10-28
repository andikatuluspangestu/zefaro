import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PageId } from "@/App";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ISSUES_URL } from "@/lib/links";
import { defineMessages, useLang, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { DocsSearch } from "./search";
import { SECTIONS, type DocSection } from "./sections";
import { SECTIONS_ID } from "./sections.id";

const messages = defineMessages({
  en: {
    title: "Documentation",
    description: "How to use Zefaro, where it keeps things, and what to do when something goes wrong.",
    contents: "Documentation contents",
    feedbackTitle: "Something missing or wrong?",
    feedbackText: "Open an issue on GitHub and describe what you expected to find.",
    openIssue: "Open an issue",
  },
  id: {
    title: "Dokumentasi",
    description: "Cara memakai Zefaro, tempat Zefaro menyimpan semuanya, dan apa yang dilakukan saat ada masalah.",
    contents: "Daftar isi dokumentasi",
    feedbackTitle: "Ada yang kurang atau keliru?",
    feedbackText: "Buka issue di GitHub dan jelaskan apa yang Anda harapkan ada di sini.",
    openIssue: "Buka issue",
  },
});

/** The sections in each language. Both have the same ids, icons and order. */
const SECTIONS_BY_LANG = { en: SECTIONS, id: SECTIONS_ID } as const;

/** Section icons that live in Font Awesome's brands set. */
const BRAND_ICONS = new Set(["php", "node-js"]);

/** Sections by their table-of-contents heading, in page order. */
const groupsOf = (sections: DocSection[]) =>
  sections.reduce<{ name: string; sections: DocSection[] }[]>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last?.name === s.group) last.sections.push(s);
    else acc.push({ name: s.group, sections: [s] });
    return acc;
  }, []);

const SectionIcon = ({ icon, className }: { icon: string; className?: string }) => (
  <Icon name={icon} variant={BRAND_ICONS.has(icon) ? "brands" : "solid"} className={className} />
);

/**
 * Full documentation with a table of contents that follows scrolling. The contents sit
 * beside the text when the column is wide enough, and above it otherwise.
 */
export function DocsPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const t = useT(messages);
  const sections = SECTIONS_BY_LANG[useLang().lang];
  const groups = useMemo(() => groupsOf(sections), [sections]);
  const [current, setCurrent] = useState(sections[0].id);
  /** While a clicked jump is scrolling, keep the clicked entry highlighted. */
  const lockedUntil = useRef(0);

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>("[data-scroll-root]");
    if (!scroller) return;
    const update = () => {
      if (Date.now() < lockedUntil.current) return;
      // At the very bottom the last sections can't reach the top edge.
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
        setCurrent(sections[sections.length - 1].id);
        return;
      }
      // Otherwise: the last section whose heading has scrolled past the top.
      const edge = scroller.getBoundingClientRect().top + 96;
      let active = sections[0].id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= edge) active = s.id;
      }
      setCurrent(active);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, [sections]);

  /** Highlights `id` in the contents while a jump scrolls there. */
  const markCurrent = (id: string) => {
    setCurrent(id);
    lockedUntil.current = Date.now() + 800;
  };

  const jump = (id: string) => {
    markCurrent(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
      />
      <div className="@container">
        <div className="grid gap-10 @3xl:grid-cols-[11rem_minmax(0,1fr)]">
          {/* Side contents for a wide column. */}
          <nav aria-label={t.contents} className="hidden @3xl:block">
            <div className="sticky top-2 space-y-5 pt-2">
              {groups.map((g) => (
                <div key={g.name}>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">{g.name}</p>
                  <ul className="border-l">
                    {g.sections.map((s) => (
                      <li key={s.id}>
                        <button
                          onClick={() => jump(s.id)}
                          aria-current={current === s.id ? "true" : undefined}
                          className={cn(
                            "-ml-px block w-full border-l-2 py-1 pr-2 pl-3 text-left text-sm transition-colors",
                            current === s.id
                              ? "border-primary font-medium text-foreground"
                              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                          )}
                        >
                          {s.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>

          <article className="min-w-0 max-w-3xl">
            <div className="sticky top-0 z-20 -mt-2 mb-6 bg-background pt-2 pb-3">
              <DocsSearch onJump={markCurrent} />
            </div>

            {/* Contents above the text for a narrow column. */}
            <nav
              aria-label={t.contents}
              className="mb-10 grid gap-x-6 gap-y-4 rounded-xl border p-4 @md:grid-cols-2 @3xl:hidden"
            >
              {groups.map((g) => (
                <div key={g.name}>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{g.name}</p>
                  <ul className="space-y-0.5">
                    {g.sections.map((s) => (
                      <li key={s.id}>
                        <button
                          onClick={() => jump(s.id)}
                          className="flex items-center gap-2 py-0.5 text-left text-sm text-foreground/85 hover:text-foreground"
                        >
                          <SectionIcon icon={s.icon} className="w-3.5 text-xs text-muted-foreground" />
                          {s.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>

            {sections.map((s) => (
              <section
                key={s.id}
                id={s.id}
                data-doc-section
                data-doc-title={s.title}
                data-doc-summary={s.summary}
                className="scroll-mt-16 space-y-4 border-t py-10 first-of-type:border-t-0 first-of-type:pt-0"
              >
                <header className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted/50">
                    <SectionIcon icon={s.icon} className="text-sm" />
                  </span>
                  <div className="space-y-0.5">
                    <h2 className="text-lg leading-tight font-semibold tracking-tight">{s.title}</h2>
                    <p className="text-sm text-muted-foreground">{s.summary}</p>
                  </div>
                </header>
                {s.body(onNavigate)}
              </section>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{t.feedbackTitle}</p>
                <p className="text-xs text-muted-foreground">{t.feedbackText}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => openUrl(ISSUES_URL)}>
                <Icon name="github" variant="brands" />
                {t.openIssue}
              </Button>
            </div>
          </article>
        </div>
      </div>
    </>
  );
}
