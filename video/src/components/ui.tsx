// Small copies of the app's shadcn building blocks, drawn with inline styles.

import type { CSSProperties, ReactNode } from "react";
import { Img, staticFile } from "remotion";
import { C, FONT, MONO } from "../theme";

export function Icon({ name, brands, style }: { name: string; brands?: boolean; style?: CSSProperties }) {
  return <i className={`${brands ? "fa-brands" : "fa-solid"} fa-${name}`} style={{ width: "1.1em", textAlign: "center", ...style }} />;
}

export function Badge({ children, tone = "neutral", style }: { children: ReactNode; tone?: "neutral" | "primary" | "outline" | "emerald"; style?: CSSProperties }) {
  const tones: Record<string, CSSProperties> = {
    neutral: { background: C.muted, color: C.fg },
    primary: { background: C.primary, color: C.onPrimary },
    outline: { border: `1px solid ${C.border}`, color: C.mutedFg },
    emerald: { background: "oklch(0.8 0.16 160 / 15%)", color: C.emerald },
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 20,
        padding: "0 8px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "outline",
  size = "sm",
  pressed = 0,
  style,
}: {
  children: ReactNode;
  variant?: "primary" | "outline" | "ghost" | "secondary";
  size?: "sm" | "xs";
  /** 0 → 1: how far into a click the button is (darkens and shrinks slightly). */
  pressed?: number;
  style?: CSSProperties;
}) {
  const v: Record<string, CSSProperties> = {
    primary: { background: C.primary, color: C.onPrimary },
    outline: { background: "oklch(1 0 0 / 70%)", border: `1px solid ${C.input}`, color: C.fg },
    ghost: { color: C.fg },
    secondary: { background: C.muted, color: C.fg },
  };
  const h = size === "sm" ? 30 : 24;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: h,
        padding: size === "sm" ? "0 11px" : "0 8px",
        borderRadius: 8,
        fontSize: size === "sm" ? 13 : 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
        transform: `scale(${1 - pressed * 0.04})`,
        filter: `brightness(${1 - pressed * 0.15})`,
        ...v[variant],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, ...style }}>{children}</div>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: 999, background: color, flexShrink: 0 }} />;
}

/** A service logo on its tile, as on the Services page. */
export function ServiceLogo({ name, live = true, size = 36 }: { name: string; live?: boolean; size?: number }) {
  const wide = name === "php" || name === "phpmyadmin";
  const light = name === "mariadb";
  return (
    <span
      style={{
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 9,
        padding: wide ? 2 : 6,
        boxSizing: "border-box",
        background: light ? "#fff" : "oklch(0.946 0.038 338 / 80%)",
        boxShadow: `inset 0 0 0 1px ${light ? "rgb(0 0 0 / 5%)" : "rgb(60 30 120 / 8%)"}`,
        opacity: live ? 1 : 0.55,
        filter: live ? "none" : "grayscale(1)",
      }}
    >
      <Img src={staticFile(`logos/${name}.svg`)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </span>
  );
}

export function Mono({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ fontFamily: MONO, fontSize: "0.92em", ...style }}>{children}</span>;
}

export const textBase: CSSProperties = { fontFamily: FONT, color: C.fg, letterSpacing: "-0.005em" };
