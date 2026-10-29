// Language and theme. The language comes from the URL (/ is English, /id/ Indonesian), so each
// has its own address for search engines; switching goes to the other address. The theme is
// remembered in localStorage and applied from index.html before the first paint; it follows
// Windows until the visitor picks one. Everything here also runs at build time, where there
// is no window, to prerender each page.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { copy, type Copy } from "./copy";
import { homePath, type Lang } from "./seo";

export type { Lang };
const browser = typeof window !== "undefined";

const LANG_KEY = "zefaro-site.lang";
const THEME_KEY = "zefaro-site.theme";
const MOTION_KEY = "zefaro-site.motion";

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage can be blocked */
    }
  },
};

function initialDark(): boolean {
  if (!browser) return false;
  const saved = store.get(THEME_KEY);
  if (saved) return saved === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

type Prefs = {
  lang: Lang;
  /** The page's own path, e.g. "/id/alternatif-xampp/". */
  path: string;
  /** This language's home page. */
  home: string;
  t: Copy;
  toggleLang: () => void;
  dark: boolean;
  toggleTheme: (origin?: { x: number; y: number }) => void;
  /** True when movement should be left out. Starts from the system setting; the visitor can override it. */
  reduce: boolean;
  toggleMotion: () => void;
};
const Ctx = createContext<Prefs | null>(null);

export function PrefsProvider({ lang, path, children }: { lang: Lang; path: string; children: ReactNode }) {
  const [dark, setDark] = useState<boolean>(initialDark);
  const [chosen, setChosen] = useState<boolean>(() => store.get(THEME_KEY) !== null);
  const [systemReduce, setSystemReduce] = useState<boolean>(() => browser && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [motion, setMotion] = useState<"system" | "on" | "off">(() => {
    const saved = store.get(MOTION_KEY);
    return saved === "on" || saved === "off" ? saved : "system";
  });
  const reduce = motion === "off" || (motion === "system" && systemReduce);

  useEffect(() => {
    document.documentElement.lang = lang;
    store.set(LANG_KEY, lang);
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);

  // Until the visitor picks a theme, follow Windows when it changes.
  useEffect(() => {
    if (chosen) return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => setDark(query.matches);
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [chosen]);

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setSystemReduce(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);

  const toggleMotion = useCallback(() => {
    const next = reduce ? "on" : "off";
    setMotion(next);
    store.set(MOTION_KEY, next);
  }, [reduce]);

  // The other language lives at another address. Guides are Indonesian only, so from one
  // the switch goes to the English home page.
  const toggleLang = useCallback(() => {
    const next: Lang = lang === "en" ? "id" : "en";
    store.set(LANG_KEY, next);
    window.location.assign(homePath(next));
  }, [lang]);
  // The new theme spreads out from the button as a circle (View Transitions), where the browser
  // supports it. Otherwise, and with reduced motion, it just switches.
  const toggleTheme = useCallback(
    (origin?: { x: number; y: number }) => {
      const next = !dark;
      const commit = () => {
        flushSync(() => {
          setDark(next);
          setChosen(true);
        });
        document.documentElement.classList.toggle("dark", next);
        document.documentElement.style.colorScheme = next ? "dark" : "light";
        store.set(THEME_KEY, next ? "dark" : "light");
      };
      const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
      if (!doc.startViewTransition || !origin || matchMedia("(prefers-reduced-motion: reduce)").matches) {
        commit();
        return;
      }
      const { x, y } = origin;
      const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      doc.startViewTransition(commit).ready.then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      });
    },
    [dark],
  );

  const value = useMemo(
    () => ({ lang, path, home: homePath(lang), t: copy[lang], toggleLang, dark, toggleTheme, reduce, toggleMotion }),
    [lang, path, dark, toggleLang, toggleTheme, reduce, toggleMotion],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePrefs outside PrefsProvider");
  return v;
}

/** Whether to leave movement out: the system's preference, unless the visitor chose otherwise. */
export function useReduce() {
  return usePrefs().reduce;
}
