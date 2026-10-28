import type { CSSProperties, ReactNode } from "react";
import { C, MONO } from "../theme";
import { Logo } from "./Logo";
import { Dot, Icon } from "./ui";

export type Page = "home" | "sites" | "services" | "mail" | "logs" | "docs" | "about" | "settings";

const GROUPS: { label: string; items: { id: Page; label: string; icon: string }[] }[] = [
  { label: "Develop", items: [{ id: "home", label: "Home", icon: "house" }, { id: "sites", label: "Sites", icon: "globe" }] },
  {
    label: "Tools",
    items: [
      { id: "services", label: "Services", icon: "server" },
      { id: "mail", label: "Mail", icon: "envelope" },
      { id: "logs", label: "Logs", icon: "file-lines" },
    ],
  },
  {
    label: "Help",
    items: [
      { id: "docs", label: "Documentation", icon: "book" },
      { id: "about", label: "About", icon: "circle-info" },
    ],
  },
];

export const WINDOW = { w: 1100, h: 700 };

/**
 * The Zefaro window: title bar, sidebar, page header with status badges, and the page body.
 * Drawn at 1100 x 700 and scaled up by the scene.
 */
export function AppWindow({
  page,
  title,
  children,
  unread = 0,
  sites = 0,
  running = [0, 0],
  style,
}: {
  page: Page;
  title: string;
  children: ReactNode;
  unread?: number;
  sites?: number;
  running?: [number, number];
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: WINDOW.w,
        height: WINDOW.h,
        borderRadius: 12,
        overflow: "hidden",
        background: C.bg,
        border: `1px solid ${C.line}`,
        boxShadow: `0 40px 80px -30px ${C.shadow}`,
        display: "flex",
        flexDirection: "column",
        fontSize: 14,
        ...style,
      }}
    >
      {/* Title bar */}
      <div style={{ height: 32, display: "flex", alignItems: "center", padding: "0 10px", background: C.sidebar, borderBottom: `1px solid ${C.border}`, gap: 8, color: C.mutedFg, fontSize: 12 }}>
        <Logo size={14} />
        <span>Zefaro</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 22, paddingRight: 6 }}>
          <Icon name="minus" />
          <Icon name="square" style={{ fontSize: 10 }} />
          <Icon name="xmark" />
        </span>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: 230, background: C.sidebar, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", padding: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: 8 }}>
            <Logo size={32} />
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontWeight: 600 }}>Zefaro</div>
              <div style={{ fontSize: 12, color: C.mutedFg }}>v1.0.0</div>
            </div>
          </div>
          {GROUPS.map((g) => (
            <div key={g.label} style={{ padding: "8px 0 0" }}>
              <div style={{ fontSize: 12, color: C.mutedFg, padding: "6px 8px" }}>{g.label}</div>
              {g.items.map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    height: 32,
                    padding: "0 8px",
                    borderRadius: 7,
                    background: page === n.id ? C.muted : "transparent",
                    fontWeight: page === n.id ? 500 : 400,
                  }}
                >
                  <Icon name={n.icon} style={{ fontSize: 13 }} />
                  {n.label}
                  {n.id === "mail" && unread > 0 && (
                    <span style={{ marginLeft: "auto", background: C.primary, color: C.onPrimary, borderRadius: 999, fontSize: 10, padding: "1px 6px", fontVariantNumeric: "tabular-nums" }}>
                      {unread}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 9, height: 32, padding: "0 8px" }}>
            <Icon name="gear" style={{ fontSize: 13 }} />
            Settings
          </div>
        </div>
        {/* Main */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ height: 48, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: `1px solid ${C.border}` }}>
            <Icon name="table-columns" style={{ color: C.mutedFg, fontSize: 13 }} />
            <span style={{ fontWeight: 500 }}>{title}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <HeaderBadge>
                <Icon name="globe" style={{ fontSize: 11 }} /> {sites} {sites === 1 ? "site" : "sites"}
              </HeaderBadge>
              <HeaderBadge>
                <Dot color={running[0] > 0 ? C.emerald : C.mutedFg} size={7} /> {running[0]}/{running[1]} services running
              </HeaderBadge>
              <HeaderBadge mono>*.test</HeaderBadge>
            </span>
          </div>
          <div style={{ flex: 1, padding: 24, overflow: "hidden", position: "relative" }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function HeaderBadge({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 9px",
        borderRadius: 999,
        background: C.muted,
        fontSize: 12,
        fontFamily: mono ? MONO : undefined,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </span>
  );
}

export function PageTitle({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</div>
        <div style={{ fontSize: 13, color: C.mutedFg, marginTop: 4 }}>{description}</div>
      </div>
      {actions}
    </div>
  );
}
