// Interface language: English or Indonesian.
//
// Each page keeps its own strings next to it, in both languages, and reads them
// with `useT`:
//
//   const messages = defineMessages({
//     en: { title: "Sites", linked: (name: string) => `Linked ${name}` },
//     id: { title: "Situs", linked: (name: string) => `${name} ditautkan` },
//   });
//   const t = useT(messages);   // t.title, t.linked("blog")
//
// `defineMessages` makes the Indonesian object match the English one, so a
// missing or misspelt key fails the build.

import { createContext, useContext, type ReactNode } from "react";

export type Lang = "en" | "id";
/** What the user picked in Settings. "system" follows Windows' display language. */
export type LangSetting = "system" | Lang;

export const LANG_SETTINGS: LangSetting[] = ["system", "en", "id"];

/** The language shown for a setting: "system" becomes Indonesian when Windows is in Indonesian. */
export function resolveLang(setting: LangSetting): Lang {
  if (setting !== "system") return setting;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  return preferred.some((l) => l?.toLowerCase().startsWith("id")) ? "id" : "en";
}

/** Locale for number and date formatting. */
export const localeOf = (lang: Lang) => (lang === "id" ? "id-ID" : "en-GB");

export function defineMessages<T>(m: { en: T; id: NoInfer<T> }) {
  return m;
}

type LangState = { lang: Lang; setting: LangSetting; setSetting: (s: LangSetting) => void };

const LangContext = createContext<LangState>({ lang: "en", setting: "system", setSetting: () => {} });

export function LangProvider({ value, children }: { value: LangState; children: ReactNode }) {
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/** The language shown, and the setting behind it. */
export function useLang() {
  return useContext(LangContext);
}

/** A page's strings in the current language. */
export function useT<T>(messages: { en: T; id: T }): T {
  return messages[useContext(LangContext).lang];
}

/** Remembered between launches so the first frame is already in the right language. */
const STORAGE_KEY = "zefaro.language";

export function cachedSetting(): LangSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "en" || v === "id" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

export function cacheSetting(s: LangSetting) {
  try {
    localStorage.setItem(STORAGE_KEY, s);
  } catch {
    /* private mode or blocked storage: the backend still has the setting */
  }
}
