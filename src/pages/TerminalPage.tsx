import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { api } from "@/api";
import type { Site, TerminalInfo, TerminalShell } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme, type Theme } from "@/theme";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    newTab: "New terminal",
    moreTabs: "Choose a shell or a site",
    shells: "Shell, in your home folder",
    sites: "In a site's folder",
    noSites: "No sites yet",
    closeTab: (title: string) => `Close ${title}`,
    ended: "ended",
    search: "Find (Ctrl+F)",
    searchPlaceholder: "Find in the output",
    previous: "Previous match",
    next: "Next match",
    closeSearch: "Close search",
    clear: "Clear the screen",
    smaller: "Smaller text",
    larger: "Larger text",
    emptyTitle: "No terminal open",
    emptyBody: "A terminal starts with Zefaro's PHP, Composer, Node.js and database clients on PATH.",
    exited: (code: number | null) =>
      `Process ended${code === null ? "" : ` with code ${code}`}. Press Enter to start it again, or close the tab.`,
    php: (v: string) => `PHP ${v}`,
  },
  id: {
    newTab: "Terminal baru",
    moreTabs: "Pilih shell atau situs",
    shells: "Shell, di folder home Anda",
    sites: "Di folder situs",
    noSites: "Belum ada situs",
    closeTab: (title: string) => `Tutup ${title}`,
    ended: "berakhir",
    search: "Cari (Ctrl+F)",
    searchPlaceholder: "Cari di output",
    previous: "Hasil sebelumnya",
    next: "Hasil berikutnya",
    closeSearch: "Tutup pencarian",
    clear: "Bersihkan layar",
    smaller: "Teks lebih kecil",
    larger: "Teks lebih besar",
    emptyTitle: "Tidak ada terminal yang terbuka",
    emptyBody: "Terminal dimulai dengan PHP, Composer, Node.js, dan klien database milik Zefaro di PATH.",
    exited: (code: number | null) =>
      `Proses berakhir${code === null ? "" : ` dengan kode ${code}`}. Tekan Enter untuk memulainya lagi, atau tutup tab.`,
    php: (v: string) => `PHP ${v}`,
  },
});

// ANSI colours for each theme, checked against the terminal's background
// (the card colour): every one is at least 4.5:1, except black on the dark
// theme (2.7:1), which programs use as a background rather than for text.
const PALETTE: Record<Theme, ITheme> = {
  light: {
    black: "#2b2838", red: "#c0283a", green: "#1b7a4b", yellow: "#8a5f00",
    blue: "#3451cf", magenta: "#8c3bcf", cyan: "#0e7085", white: "#66637a",
    brightBlack: "#66637a", brightRed: "#d0303f", brightGreen: "#1f8550", brightYellow: "#946700",
    brightBlue: "#4560dc", brightMagenta: "#9c4bdc", brightCyan: "#117c92", brightWhite: "#2b2838",
  },
  dark: {
    black: "#5e5975", red: "#ff6b7a", green: "#5fd39a", yellow: "#f2c661",
    blue: "#8ba2ff", magenta: "#c99aff", cyan: "#5fd0e0", white: "#d9d4e6",
    brightBlack: "#8f8aa6", brightRed: "#ff8f9b", brightGreen: "#82e3b2", brightYellow: "#ffd986",
    brightBlue: "#a9bbff", brightMagenta: "#dab8ff", brightCyan: "#8ae0ec", brightWhite: "#f6f2fb",
  },
};

/** A CSS colour (the tokens are OKLCH) as rgb(), which xterm.js reads everywhere. */
function rgb(css: string): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return css;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function themeFor(theme: Theme): ITheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => rgb(style.getPropertyValue(name).trim());
  return {
    ...PALETTE[theme],
    background: token("--card"),
    foreground: token("--foreground"),
    cursor: token("--primary"),
    cursorAccent: token("--card"),
    selectionBackground: theme === "dark" ? "rgba(178, 108, 255, 0.35)" : "rgba(112, 94, 255, 0.22)",
  };
}

const FONT_KEY = "zefaro.terminal.fontSize";
const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20];
function cachedFontSize(): number {
  try {
    const v = Number(localStorage.getItem(FONT_KEY));
    if (FONT_SIZES.includes(v)) return v;
  } catch {
    /* storage can be blocked */
  }
  return 13;
}

/** What a tab's view gives the page: its xterm and search. */
type View = { term: Terminal; search: SearchAddon; fit: () => void };

/** One terminal: an xterm attached to its shell in Zefaro. Stays mounted while
 * its tab is hidden, so scrollback, selection and search survive tab switches. */
function TerminalView({
  info,
  active,
  theme,
  fontSize,
  views,
  onRestart,
  onFind,
}: {
  info: TerminalInfo;
  active: boolean;
  theme: Theme;
  fontSize: number;
  views: Map<number, View>;
  onRestart: (info: TerminalInfo) => void;
  onFind: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ended = useRef(info.exitCode !== null);
  ended.current = info.exitCode !== null;
  const restart = useRef(onRestart);
  restart.current = onRestart;
  const find = useRef(onFind);
  find.current = onFind;

  useEffect(() => {
    const el = ref.current!;
    const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
    const term = new Terminal({
      fontFamily: mono || "Consolas, monospace",
      fontSize: cachedFontSize(),
      cursorBlink: true,
      scrollback: 10000,
      theme: themeFor(theme),
    });
    const fitAddon = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(search);
    term.loadAddon(
      // Ctrl+click, so a click meant to select text doesn't open a browser.
      new WebLinksAddon((e, uri) => {
        if ((e.ctrlKey || e.metaKey) && /^https?:\/\//i.test(uri)) openUrl(uri).catch((err) => toast.error(String(err)));
      })
    );
    term.open(el);

    // Hidden tabs have no size; fit once they are shown again.
    const fit = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        try {
          fitAddon.fit();
        } catch {
          /* not laid out yet */
        }
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    views.set(info.id, { term, search, fit });

    const copy = () => {
      const text = term.getSelection();
      if (text) navigator.clipboard.writeText(text).catch(() => {});
      return !!text;
    };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const key = e.key.toLowerCase();
      // Ctrl+C copies when text is selected and interrupts otherwise, as in Windows Terminal.
      if (e.ctrlKey && key === "c" && (e.shiftKey || term.hasSelection())) {
        copy();
        term.clearSelection();
        return false;
      }
      // Leave Ctrl+V to the browser: its paste event reaches xterm with no clipboard permission.
      if (e.ctrlKey && key === "v") return false;
      if (e.ctrlKey && key === "f") {
        e.preventDefault();
        find.current();
        return false;
      }
      return true;
    });
    // Right-click copies a selection, or pastes, as in Windows Terminal.
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      if (copy()) {
        term.clearSelection();
        return;
      }
      navigator.clipboard
        .readText()
        .then((text) => text && term.paste(text))
        .catch(() => {});
    };
    el.addEventListener("contextmenu", onContext);

    const dataSub = term.onData((data) => {
      if (ended.current) {
        if (data === "\r") restart.current(info);
        return;
      }
      api.terminalWrite(info.id, data).catch(() => {});
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      api.terminalResize(info.id, cols, rows).catch(() => {});
    });
    api
      .terminalAttach(info.id, (bytes) => term.write(bytes))
      .then(() => api.terminalResize(info.id, term.cols, term.rows))
      .catch((e) => term.writeln(String(e)));

    return () => {
      observer.disconnect();
      el.removeEventListener("contextmenu", onContext);
      dataSub.dispose();
      resizeSub.dispose();
      views.delete(info.id);
      api.terminalDetach(info.id).catch(() => {});
      term.dispose();
    };
    // One xterm per terminal; theme and font changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.id]);

  useEffect(() => {
    // The theme provider (a parent) puts the new colours on <html> after this
    // effect runs; read them on the next frame.
    const frame = requestAnimationFrame(() => {
      const v = views.get(info.id);
      if (v) v.term.options.theme = themeFor(theme);
    });
    return () => cancelAnimationFrame(frame);
  }, [theme, info.id, views]);

  useEffect(() => {
    const v = views.get(info.id);
    if (!v) return;
    v.term.options.fontSize = fontSize;
    v.fit();
  }, [fontSize, info.id, views]);

  useEffect(() => {
    if (!active) return;
    const v = views.get(info.id);
    v?.fit();
    v?.term.focus();
  }, [active, info.id, views]);

  // The padding sits outside the element xterm measures, so it fits rows to the space left.
  return (
    <div className={cn("absolute inset-0 py-2 pl-3", !active && "invisible")}>
      <div ref={ref} className="size-full" />
    </div>
  );
}

/** The Terminal page. `visible` is false while another page is open: the page
 * stays mounted then, so every terminal keeps its screen. */
export function TerminalPage({ visible }: { visible: boolean }) {
  const t = useT(messages);
  const { theme } = useTheme();
  const [tabs, setTabs] = useState<TerminalInfo[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [shells, setShells] = useState<TerminalShell[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [fontSize, setFontSize] = useState(cachedFontSize);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const views = useRef(new Map<number, View>()).current;
  const searchBox = useRef<HTMLInputElement>(null);

  const open = useCallback(async (o: { shell?: string | null; site?: string | null; cwd?: string | null }, replace?: number) => {
    try {
      const info = await api.terminalOpen({ shell: o.shell ?? null, site: o.site ?? null, cwd: o.cwd ?? null, cols: 120, rows: 30 });
      setTabs((list) => {
        const rest = list ?? [];
        if (replace === undefined) return [...rest, info];
        return rest.map((x) => (x.id === replace ? info : x));
      });
      setActive(info.id);
      if (replace !== undefined) api.terminalClose(replace).catch(() => {});
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  // Pick up terminals that are still running (the page was reloaded), or start
  // one. Once, even when React runs effects twice in development.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    api.terminalShells().then(setShells).catch(() => {});
    api
      .terminalList()
      .then((list) => {
        setTabs(list);
        if (list.length > 0) setActive(list[list.length - 1].id);
        else open({});
      })
      .catch((e) => {
        setTabs([]);
        toast.error(String(e));
      });
  }, [open]);

  useEffect(() => {
    const off = api.onTerminalExit(({ id, code }) => {
      setTabs((list) => list?.map((x) => (x.id === id ? { ...x, exitCode: code ?? 1 } : x)) ?? list);
      const v = views.get(id);
      if (v) v.term.write(`\r\n\x1b[2m${t.exited(code)}\x1b[0m\r\n`);
    });
    return () => {
      off.then((f) => f());
    };
  }, [t, views]);

  const loadSites = () => api.listSites().then(setSites).catch(() => {});

  const close = (id: number) => {
    api.terminalClose(id).catch(() => {});
    const list = tabs ?? [];
    const next = list.filter((x) => x.id !== id);
    setTabs(next);
    // The tab to the left takes over, as in a browser.
    if (active === id) setActive(next.length ? next[Math.max(0, list.findIndex((x) => x.id === id) - 1)].id : null);
  };

  const current = tabs?.find((x) => x.id === active) ?? null;
  const view = () => (active === null ? undefined : views.get(active));

  const setSize = (next: number) => {
    setFontSize(next);
    try {
      localStorage.setItem(FONT_KEY, String(next));
    } catch {
      /* ignore */
    }
  };
  const step = (dir: 1 | -1) => {
    const i = FONT_SIZES.indexOf(fontSize);
    const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, i + dir))];
    if (next !== fontSize) setSize(next);
  };

  const find = (dir: 1 | -1) => {
    const v = view();
    if (!v || !query) return;
    if (dir === 1) v.search.findNext(query);
    else v.search.findPrevious(query);
  };
  const openSearch = useCallback(() => {
    setSearching(true);
    requestAnimationFrame(() => searchBox.current?.select());
  }, []);
  const closeSearch = () => {
    setSearching(false);
    view()?.search.clearDecorations();
    view()?.term.focus();
  };

  useEffect(() => {
    if (visible) view()?.term.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const iconButton = (label: string, icon: string, onClick: () => void, disabled = false) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>
          <Icon name={icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        // Ctrl+F from the tab bar or toolbar too, not only from inside a terminal.
        if (e.ctrlKey && e.key.toLowerCase() === "f" && current) {
          e.preventDefault();
          openSearch();
        }
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-background px-2">
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs?.map((x) => {
            const on = x.id === active;
            return (
              <div
                key={x.id}
                className={cn(
                  "group flex h-8 max-w-52 shrink-0 items-center rounded-md text-sm",
                  on ? "bg-primary/10 text-foreground dark:bg-primary/20" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <button
                  role="tab"
                  aria-selected={on}
                  title={x.cwd}
                  onClick={() => setActive(x.id)}
                  onAuxClick={(e) => e.button === 1 && close(x.id)}
                  className="flex min-w-0 items-center gap-2 rounded-md py-1 pl-2.5 pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon name="terminal" className={cn("w-3.5 text-xs", on && "text-primary")} />
                  <span className="truncate">{x.title}</span>
                  {x.exitCode !== null && <span className="text-xs text-muted-foreground">({t.ended})</span>}
                </button>
                <button
                  aria-label={t.closeTab(x.title)}
                  onClick={() => close(x.id)}
                  className="mr-1 grid size-5 place-items-center rounded text-muted-foreground opacity-60 outline-none hover:bg-foreground/10 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <Icon name="xmark" className="w-3 text-xs" />
                </button>
              </div>
            );
          })}
          <div className="flex shrink-0 items-center">
            {iconButton(t.newTab, "plus", () => open({}))}
            <DropdownMenu onOpenChange={(o) => o && loadSites()}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={t.moreTabs}>
                      <Icon name="chevron-down" className="text-xs" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t.moreTabs}</TooltipContent>
              </Tooltip>
              {/* Focus stays in the terminal the menu just opened, not on this button. */}
              <DropdownMenuContent align="start" className="min-w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenuLabel>{t.shells}</DropdownMenuLabel>
                {shells.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => open({ shell: s.id })}>
                    <Icon name="terminal" className="text-muted-foreground" />
                    {s.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t.sites}</DropdownMenuLabel>
                {sites.length === 0 && (
                  <DropdownMenuItem disabled>{t.noSites}</DropdownMenuItem>
                )}
                {sites.map((s) => (
                  <DropdownMenuItem key={s.name} onSelect={() => open({ site: s.name })}>
                    <Icon name="globe" className="text-muted-foreground" />
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto pl-3 text-xs text-muted-foreground">PHP {s.phpVersion}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {current && (
          <span className="hidden max-w-72 truncate px-2 font-mono text-xs text-muted-foreground lg:block" title={current.cwd}>
            {current.shellName}
            {current.php && ` · ${t.php(current.php)}`}
          </span>
        )}
        {iconButton(t.search, "magnifying-glass", openSearch, !current)}
        {iconButton(t.clear, "broom", () => view()?.term.clear(), !current)}
        {iconButton(t.smaller, "minus", () => step(-1), fontSize === FONT_SIZES[0])}
        <span className="w-6 text-center text-xs text-muted-foreground tabular-nums" aria-hidden>
          {fontSize}
        </span>
        {iconButton(t.larger, "plus", () => step(1), fontSize === FONT_SIZES[FONT_SIZES.length - 1])}
      </div>

      <div className="relative min-h-0 flex-1 bg-card">
        {tabs?.map((x) => (
          <TerminalView
            key={x.id}
            info={x}
            active={x.id === active}
            theme={theme}
            fontSize={fontSize}
            views={views}
            onRestart={(info) => open({ shell: info.shell, site: info.site, cwd: info.site ? null : info.cwd }, info.id)}
            onFind={openSearch}
          />
        ))}
        {searching && current && (
          <div className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10">
            <Input
              ref={searchBox}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") find(e.shiftKey ? -1 : 1);
                if (e.key === "Escape") closeSearch();
              }}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              className="h-7 w-56"
            />
            {iconButton(t.previous, "arrow-up", () => find(-1), !query)}
            {iconButton(t.next, "arrow-down", () => find(1), !query)}
            {iconButton(t.closeSearch, "xmark", closeSearch)}
          </div>
        )}
        {tabs && tabs.length === 0 && (
          <Empty className="absolute inset-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon name="terminal" />
              </EmptyMedia>
              <EmptyTitle>{t.emptyTitle}</EmptyTitle>
              <EmptyDescription>{t.emptyBody}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row flex-wrap justify-center">
              {shells.map((s) => (
                <Button key={s.id} variant={s === shells[0] ? "default" : "outline"} size="sm" onClick={() => open({ shell: s.id })}>
                  <Icon name="terminal" />
                  {s.name}
                </Button>
              ))}
            </EmptyContent>
          </Empty>
        )}
      </div>
    </div>
  );
}
