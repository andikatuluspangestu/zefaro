import type { ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { enter, follow, progress } from "../anim";
import { pick, useLayout } from "../layout";
import { C } from "../theme";
import { WINDOW } from "./AppWindow";
import { SceneShell, type Entrance } from "./SceneShell";

/**
 * A camera cue: from `frame` on, the camera heads for zoom `z` on point (x, y) of the page
 * body. It gets there about 25 frames later, so cue a move that long before the action.
 */
export type Shot = [frame: number, z: number, x: number, y: number];

/** Where the page body sits inside the window (sidebar width, title bar + header height). */
const BODY = { x: 230, y: 80 };
/** The page body point that puts the whole window in view. */
export const WIDE = { x: 320, y: 270 };

/**
 * How the app window arrives: sliding in from the side, swinging in on a 3D hinge, rising
 * from below, or growing from a smaller size.
 */
export type WindowIn = "slide" | "tilt" | "rise" | "zoom";

/** The window's entrance transform at `slide` (0 → 1), before its own scale. */
function arrive(kind: WindowIn, slide: number) {
  const r = 1 - slide;
  switch (kind) {
    case "tilt":
      return `perspective(1800px) rotateY(${r * -32}deg) rotateX(${r * 8}deg) translateX(${r * 80}px)`;
    case "rise":
      return `translateY(${r * 160}px) rotateX(${r * 14}deg)`;
    case "zoom":
      return `scale(${0.82 + 0.18 * slide})`;
    default:
      return `translateX(${r * 60}px)`;
  }
}

/** The cue in force on `frame`. */
function cueAt(frame: number, shots: Shot[]) {
  let cue: Shot = [0, 1, WIDE.x, WIDE.y];
  for (const s of shots) if (s[0] <= frame) cue = s;
  return { z: cue[1], x: cue[2], y: cue[3] };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Clamps when the range is valid, otherwise leaves the value alone. */
const keep = (v: number, lo: number, hi: number) => (lo <= hi ? clamp(v, lo, hi) : v);

/**
 * A demo scene: caption plus the app window, with a camera that zooms onto the action.
 * Landscape puts the caption beside the window and moves the whole frame. Portrait and 4:5
 * put the caption on top and show the whole window below it, zooming inside its frame.
 * The camera follows its cues on a damped spring, so moves start and end softly.
 */
export function DemoFrame({
  step,
  title,
  text,
  shots = [],
  entrance = "fade",
  windowIn = "slide",
  children,
}: {
  step: string;
  title: ReactNode;
  text: ReactNode;
  shots?: Shot[];
  entrance?: Entrance;
  windowIn?: WindowIn;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const { kind, width, height, safe } = useLayout();
  const slide = progress(frame, 0, windowIn === "tilt" ? 30 : 20);

  const caption = (
    <>
      <div style={{ ...enter(frame, 4), fontSize: pick(kind, { landscape: 18, portrait: 30, feed: 24 }), color: C.accent, fontWeight: 600, letterSpacing: "0.02em" }}>
        {step}
      </div>
      <div style={{ ...enter(frame, 8), fontSize: pick(kind, { landscape: 48, portrait: 70, feed: 54 }), fontWeight: 650, lineHeight: 1.06, letterSpacing: "-0.03em" }}>
        {title}
      </div>
      <div style={{ ...enter(frame, 14), fontSize: pick(kind, { landscape: 24, portrait: 32, feed: 26 }), lineHeight: 1.4, color: C.mutedFg }}>{text}</div>
    </>
  );

  if (kind === "landscape") {
    const S = 1.16;
    const left0 = width - safe.right - WINDOW.w * S;
    const top0 = (height - WINDOW.h * S) / 2;
    const edge = 40;
    // For a cue: the whole frame scales by z and shifts so the focus point moves towards
    // the middle, while the window keeps covering the frame once it is bigger than it.
    const aim = (f: number) => {
      const c = cueAt(f, shots);
      const fx = left0 + (BODY.x + c.x) * S;
      const fy = top0 + (BODY.y + c.y) * S;
      const pull = clamp((c.z - 1) / 0.5, 0, 1) * 0.7;
      const scaled = (v: number, o: number) => o + (v - o) * c.z;
      const dx = keep((width / 2 - fx) * pull, width - edge - scaled(left0 + WINDOW.w * S, fx), edge - scaled(left0, fx));
      const dy = keep((height / 2 - fy) * pull, height - edge - scaled(top0 + WINDOW.h * S, fy), edge - scaled(top0, fy));
      return [fx * (1 - c.z) + dx, fy * (1 - c.z) + dy, Math.log(c.z)];
    };
    const [tx, ty, lz] = follow(frame, aim);
    return (
      <SceneShell entrance={entrance}>
        <AbsoluteFill style={{ transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${Math.exp(lz)})` }}>
          <div style={{ position: "absolute", left: safe.left, top: 0, bottom: 0, width: 370, display: "flex", flexDirection: "column", justifyContent: "center", gap: 20 }}>
            {caption}
          </div>
          <div
            style={{
              position: "absolute",
              left: left0,
              top: top0,
              width: WINDOW.w,
              height: WINDOW.h,
              transformOrigin: "0 0",
              transform: `${arrive(windowIn, slide)} scale(${S})`,
              opacity: Math.min(1, slide * 1.6),
            }}
          >
            {children}
          </div>
        </AbsoluteFill>
      </SceneShell>
    );
  }

  // Portrait and 4:5: the whole window fits the frame width at rest, under the caption.
  const boxW = width - 48;
  const k0 = boxW / WINDOW.w;
  const boxH = WINDOW.h * k0;
  const regionTop = pick(kind, { landscape: 0, portrait: 690, feed: 400 });
  const regionBottom = height - pick(kind, { landscape: 0, portrait: safe.bottom, feed: 60 });
  const box = { left: 24, top: regionTop + (regionBottom - regionTop - boxH) / 2, width: boxW, height: boxH };
  const aim = (f: number) => {
    const c = cueAt(f, shots);
    const k = k0 * c.z;
    const tx = clamp(boxW / 2 - k * (BODY.x + c.x), boxW - WINDOW.w * k, 0);
    const ty = clamp(boxH / 2 - k * (BODY.y + c.y), boxH - WINDOW.h * k, 0);
    return [tx, ty, Math.log(k)];
  };
  const [tx, ty, lk] = follow(frame, aim);
  return (
    <SceneShell entrance={entrance}>
      <div
        style={{
          position: "absolute",
          left: safe.left,
          right: safe.right,
          top: safe.top,
          height: box.top - 48 - safe.top,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          gap: pick(kind, { landscape: 20, portrait: 22, feed: 14 }),
        }}
      >
        {caption}
      </div>
      <div
        style={{
          position: "absolute",
          ...box,
          borderRadius: 12 * k0,
          overflow: "hidden",
          background: C.bg,
          boxShadow: `0 0 0 1px ${C.line}, 0 40px 80px -30px ${C.shadow}`,
          opacity: Math.min(1, slide * 1.6),
          transform: arrive(windowIn, slide),
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, width: WINDOW.w, height: WINDOW.h, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${Math.exp(lk)})` }}>
          {children}
        </div>
      </div>
    </SceneShell>
  );
}
