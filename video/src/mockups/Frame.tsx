// Shared pieces for the promotional mockups: the canvas, the display type, the brand line and
// the wind, the brand gradient drawn as one curved stroke (Zefaro comes from zephyr).

import "@fontsource-variable/bricolage-grotesque/standard.css";
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { Logo } from "../components/Logo";
import { C, FONT } from "../theme";

export const DISPLAY = "'Bricolage Grotesque Variable', 'Geist Variable', system-ui, sans-serif";

export type Tone = "light" | "pink" | "indigo" | "ink";

export const TONES: Record<Tone, { bg: string; fg: string; muted: string }> = {
  light: { bg: C.bg, fg: C.fg, muted: C.mutedFg },
  pink: { bg: "oklch(0.946 0.038 338)", fg: C.fg, muted: C.mutedFg },
  indigo: { bg: C.primary, fg: "#ffffff", muted: "oklch(0.94 0.03 300)" },
  ink: { bg: "oklch(0.2 0.05 285)", fg: "oklch(0.965 0.014 335)", muted: "oklch(0.8 0.04 300)" },
};

export function Canvas({ tone = "light", children, style }: { tone?: Tone; children: ReactNode; style?: CSSProperties }) {
  const t = TONES[tone];
  return (
    <AbsoluteFill style={{ background: t.bg, color: t.fg, fontFamily: FONT, letterSpacing: "-0.006em", overflow: "hidden", ...style }}>
      {children}
    </AbsoluteFill>
  );
}

export function Headline({ children, size, style }: { children: ReactNode; size: number; style?: CSSProperties }) {
  return (
    <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: size, lineHeight: 0.96, letterSpacing: "-0.034em", textWrap: "balance", ...style }}>
      {children}
    </div>
  );
}

export function Sub({ children, size, tone = "light", style }: { children: ReactNode; size: number; tone?: Tone; style?: CSSProperties }) {
  return <div style={{ fontSize: size, lineHeight: 1.4, color: TONES[tone].muted, textWrap: "pretty", ...style }}>{children}</div>;
}

/** Text filled with the brand gradient. */
export function Grad({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        backgroundImage: "linear-gradient(120deg, #FF6082 0%, #B26CFF 55%, #705EFF 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        WebkitTextFillColor: "transparent",
      }}
    >
      {children}
    </span>
  );
}

/** Logo, name and address, for the corner of every image. */
export function Brand({ tone = "light", size = 30, address = true, style }: { tone?: Tone; size?: number; address?: boolean; style?: CSSProperties }) {
  const t = TONES[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.4, ...style }}>
      <Logo size={size * 1.25} />
      <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: size, letterSpacing: "-0.04em" }}>Zefaro</span>
      {address && <span style={{ fontSize: size * 0.62, color: t.muted, marginLeft: size * 0.3 }}>zefaro.pages.dev</span>}
    </div>
  );
}

/** The wind: one thick curved stroke in the brand gradient, drawn behind the content. */
export function Wind({ d, w, h, width = 28, opacity = 1, style }: { d: string; w: number; h: number; width?: number; opacity?: number; style?: CSSProperties }) {
  const id = `wind-${Math.abs(hash(d))}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", inset: 0, overflow: "visible", opacity, ...style }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FF6082" />
          <stop offset="0.55" stopColor="#B26CFF" />
          <stop offset="1" stopColor="#705EFF" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={`url(#${id})`} strokeWidth={width} strokeLinecap="round" />
    </svg>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Scales a fixed-size drawing (such as the 1100 x 700 app window) from its top-left corner. */
export function Scaled({ scale, children, style }: { scale: number; children: ReactNode; style?: CSSProperties }) {
  return <div style={{ position: "absolute", transform: `scale(${scale})`, transformOrigin: "0 0", color: C.fg, ...style }}>{children}</div>;
}

/** A pill with an icon, for short facts. */
export function Pill({ children, tone = "light", size = 22 }: { children: ReactNode; tone?: Tone; size?: number }) {
  const dark = tone === "indigo" || tone === "ink";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.45,
        padding: `${size * 0.45}px ${size * 0.85}px`,
        borderRadius: 999,
        fontSize: size,
        fontWeight: 550,
        background: dark ? "oklch(1 0 0 / 14%)" : "oklch(1 0 0 / 75%)",
        border: dark ? "1px solid oklch(1 0 0 / 22%)" : `1px solid ${C.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
