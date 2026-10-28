import type { ReactNode } from "react";
import { usePrefs } from "../prefs";
import { Logo } from "./Logo";

type PageId = "home" | "sites" | "services" | "mail" | "logs" | "docs" | "about";

const NAV: { group: "develop" | "tools" | "help"; items: { id: PageId; icon: string }[] }[] = [
  { group: "develop", items: [{ id: "home", icon: "house" }, { id: "sites", icon: "globe" }] },
  { group: "tools", items: [{ id: "services", icon: "server" }, { id: "mail", icon: "envelope" }, { id: "logs", icon: "file-lines" }] },
  { group: "help", items: [{ id: "docs", icon: "book" }, { id: "about", icon: "circle-info" }] },
];

/** The app's window frame and sidebar, drawn from the app's own tokens. */
export function WinChrome({ active, children, label }: { active: PageId; children: ReactNode; label?: string }) {
  const { t } = usePrefs();
  return (
    <div className="win" role="img" aria-label={label ?? t.win.title}>
      <div className="win-bar">
        <span style={{ width: 16, height: 16, display: "inline-block" }}>
          <Logo />
        </span>
        {t.win.title}
      </div>
      <div className="win-body">
        <div className="win-side" aria-hidden="true">
          {NAV.map((g) => (
            <div key={g.group} style={{ display: "contents" }}>
              <div className="grp">{t.win.groups[g.group]}</div>
              {g.items.map((it) => (
                <div key={it.id} className={`nav-item${it.id === active ? " on" : ""}`}>
                  <i className={`fa-solid fa-${it.icon}`} />
                  {t.win.items[it.id]}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="win-main">{children}</div>
      </div>
    </div>
  );
}
