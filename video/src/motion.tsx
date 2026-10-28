// Motion building blocks shared by the scenes: kinetic type, rolling numbers,
// marquees and drawn lines. Each is a pure function of the frame.

import type { CSSProperties, ReactNode } from "react";
import { Easing, interpolate, spring } from "remotion";
import { progress } from "./anim";
import { FPS } from "./theme";

const back = Easing.bezier(0.34, 1.56, 0.64, 1);

/**
 * Words rise into view one after another from behind a mask, each with a slight tilt that
 * straightens as it lands. `stagger` is frames between words.
 */
export function Kinetic({
  text,
  frame,
  start,
  stagger = 3,
  dur = 16,
  style,
  accent,
}: {
  text: string;
  frame: number;
  start: number;
  stagger?: number;
  dur?: number;
  style?: CSSProperties;
  /** Words drawn in the accent colour. */
  accent?: { words: string[]; color: string };
}) {
  const words = text.split(" ");
  return (
    <span style={{ display: "inline", ...style }}>
      {words.map((w, i) => {
        const p = interpolate(frame, [start + i * stagger, start + i * stagger + dur], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        });
        const hot = accent?.words.includes(w.replace(/[.,!?]/g, ""));
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: "0.08em", marginBottom: "-0.08em" }}>
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - p) * 105}%) rotate(${(1 - p) * 6}deg)`,
                transformOrigin: "0 100%",
                color: hot ? accent?.color : undefined,
              }}
            >
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Lands with a little overshoot: for words that stamp in. */
export const slam = (frame: number, start: number) =>
  spring({ frame: frame - start, fps: FPS, config: { damping: 11, stiffness: 170, mass: 0.7 } });

/** A number that counts up from `from` to `to` between two frames. */
export function count(frame: number, start: number, end: number, from: number, to: number) {
  return Math.round(from + (to - from) * progress(frame, start, end));
}

/**
 * A row of items sliding sideways at `speed` pixels per frame (negative: to the left),
 * starting `from` pixels in. The items repeat twice, so a scene-long slide never runs out.
 */
export function Marquee({ frame, speed, from, gap, children, style }: { frame: number; speed: number; from: number; gap: number; children: ReactNode[]; style?: CSSProperties }) {
  return (
    <div style={{ overflow: "hidden", width: "100%", ...style }}>
      <div style={{ display: "flex", gap, width: "max-content", transform: `translateX(${from + frame * speed}px)` }}>
        {children}
        {children}
      </div>
    </div>
  );
}

/** How much of a stroke is drawn: for SVG lines, as a dash offset from the length. */
export const draw = (frame: number, start: number, dur: number) => progress(frame, start, start + dur);

/** Back-out landing, 0 → 1 with overshoot. */
export const land = (frame: number, start: number, dur = 18) =>
  interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: back });
