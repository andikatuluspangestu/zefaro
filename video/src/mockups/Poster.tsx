// The layout every mockup shares, in three sizes: 1920 x 1080 (landscape), 1080 x 1350 (feed)
// and 1080 x 1920 (story). The headline and copy sit in the same place per size; each mockup
// places its own picture with `pick`.

import type { CSSProperties, ReactNode } from "react";
import { Icon } from "../components/ui";
import { type Kind, useLayout } from "../layout";
import { C } from "../theme";
import { Brand, Canvas, Headline, Sub, type Tone, Wind } from "./Frame";

export const TEXT: Record<Kind, { x: number; y: number; w: number; head: number; sub: number; brand: number; by: number }> = {
  landscape: { x: 96, y: 210, w: 740, head: 104, sub: 30, brand: 30, by: 72 },
  feed: { x: 72, y: 156, w: 936, head: 100, sub: 28, brand: 26, by: 64 },
  portrait: { x: 80, y: 280, w: 920, head: 118, sub: 34, brand: 34, by: 130 },
};

/** The download line at the foot of a story, where a link sticker or swipe-up would go. */
export function DownloadBar({ tone, style }: { tone: Tone; style?: CSSProperties }) {
  const onIndigo = tone === "indigo";
  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        right: 80,
        top: 1690,
        display: "flex",
        alignItems: "center",
        gap: 22,
        padding: "30px 36px",
        borderRadius: 32,
        background: onIndigo ? "#ffffff" : C.primary,
        color: onIndigo ? C.primary : "#ffffff",
        ...style,
      }}
    >
      <Icon name="download" style={{ fontSize: 40 }} />
      <span>
        <span style={{ display: "block", fontSize: 26, opacity: 0.85 }}>Download free for Windows</span>
        <span style={{ display: "block", fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em" }}>zefaro.pages.dev</span>
      </span>
    </div>
  );
}

export function Poster({
  tone = "light",
  title,
  sub,
  head,
  wind,
  extra,
  children,
  bar = true,
  textWidth,
}: {
  tone?: Tone;
  title: ReactNode;
  sub?: ReactNode;
  /** Headline size per format, when the default doesn't fit. */
  head?: Partial<Record<Kind, number>>;
  /** The wind stroke's path per format. */
  wind?: Partial<Record<Kind, string>>;
  /** Anything to place under the copy (pills, a list). */
  extra?: ReactNode;
  /** The picture, positioned by the mockup itself. */
  children?: ReactNode;
  /** The download bar on stories. */
  bar?: boolean;
  /** Width of the copy per format, when the picture leaves more room. */
  textWidth?: Partial<Record<Kind, number>>;
}) {
  const { kind, width, height } = useLayout();
  const t = TEXT[kind];
  const d = wind?.[kind];
  return (
    <Canvas tone={tone}>
      {d && <Wind w={width} h={height} width={kind === "landscape" ? 40 : 34} d={d} />}
      <div style={{ position: "absolute", left: t.x, top: t.by }}>
        <Brand size={t.brand} tone={tone} />
      </div>
      <div style={{ position: "absolute", left: t.x, top: t.y, width: textWidth?.[kind] ?? t.w }}>
        <Headline size={head?.[kind] ?? t.head}>{title}</Headline>
        {sub && (
          <Sub size={t.sub} tone={tone} style={{ marginTop: kind === "portrait" ? 30 : 24, maxWidth: kind === "landscape" ? 660 : 860 }}>
            {sub}
          </Sub>
        )}
        {extra}
      </div>
      {children}
      {kind === "portrait" && bar && <DownloadBar tone={tone} />}
    </Canvas>
  );
}
