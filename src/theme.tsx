// Light and dark theme. The setting is "system" (follow Windows), "light" or "dark".
// It is kept in localStorage and applied from index.html before the first paint, so the
// window never flashes the wrong theme.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeSetting = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_SETTINGS: ThemeSetting[] = ["system", "light", "dark"];
const STORAGE_KEY = "zefaro.theme";

const prefersDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

export function resolveTheme(setting: ThemeSetting): Theme {
  return setting === "system" ? (prefersDark() ? "dark" : "light") : setting;
}

export function cachedTheme(): ThemeSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage can be blocked */
  }
  return "system";
}

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

type ThemeState = { setting: ThemeSetting; theme: Theme; setSetting: (s: ThemeSetting) => void };
const ThemeContext = createContext<ThemeState>({ setting: "system", theme: "dark", setSetting: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSetting] = useState<ThemeSetting>(cachedTheme);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(cachedTheme()));

  useEffect(() => {
    const update = () => setTheme(resolveTheme(setting));
    update();
    try {
      localStorage.setItem(STORAGE_KEY, setting);
    } catch {
      /* ignore */
    }
    if (setting !== "system" || typeof matchMedia !== "function") return;
    // Windows switching between light and dark while the app is open.
    const query = matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [setting]);

  useEffect(() => apply(theme), [theme]);

  const value = useMemo(() => ({ setting, theme, setSetting }), [setting, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
