import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { glide } from "../anim";
import { C, FONT } from "../theme";

/**
 * How a scene joins its neighbours. Each scene runs `tail` frames past its own length,
 * underneath the next scene, which comes in on top.
 */
export const SceneJoin = createContext({ first: false, tail: 0 });

/** Frames two scenes overlap for. */
export const OVERLAP = 18;

/**
 * How a scene comes in over the previous one:
 * - `fade`: fades in while settling from a slight zoom.
 * - `iris`: a circle opens from the middle.
 * - `wipe`: the new scene slides its edge in from the right.
 * - `slice`: a diagonal edge sweeps across.
 * - `whip`: the new scene rushes in sideways with motion blur.
 */
export type Entrance = "fade" | "iris" | "wipe" | "slice" | "whip";

/**
 * Wraps every scene: its entrance, a slow push from `push.from` to `push.to`, and, at the
 * end, a zoom through to 1.08 with blur while the next scene comes in on top.
 */
export function SceneShell({
  children,
  push = { from: 1, to: 1 },
  entrance = "fade",
  style,
}: {
  children: ReactNode;
  push?: { from: number; to: number };
  entrance?: Entrance;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const { first, tail } = useContext(SceneJoin);
  const own = d - tail;
  const inP = first ? 1 : glide(frame, 0, OVERLAP);
  // The last scene has no successor to cover it, so it fades out itself.
  const outFade = tail ? 1 : 1 - glide(frame, d - 15, d);
  const through = tail ? interpolate(frame, [own - 4, own + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) }) : 0;
  const slow = push.from + (push.to - push.from) * glide(frame, 0, own);
  const settle = entrance === "fade" ? 1 + 0.05 * (1 - inP) : 1;
  const scale = slow * settle * (1 + 0.08 * through);

  const outer: CSSProperties = { background: C.bg, fontFamily: FONT, color: C.fg, opacity: outFade };
  if (inP < 1) {
    if (entrance === "fade") outer.opacity = inP * outFade;
    if (entrance === "iris") outer.clipPath = `circle(${inP * 75}% at 50% 50%)`;
    if (entrance === "wipe") outer.clipPath = `inset(0 0 0 ${(1 - inP) * 100}%)`;
    if (entrance === "slice") {
      const x = (1 - inP) * 140;
      outer.clipPath = `polygon(${x}% 0, ${x + 140}% 0, ${x + 100}% 100%, ${x - 40}% 100%)`;
    }
    if (entrance === "whip") {
      outer.transform = `translateX(${(1 - inP) * 35}%)`;
      outer.filter = `blur(${(1 - inP) * 18}px)`;
      outer.opacity = Math.min(1, inP * 2) * outFade;
    }
  }
  return (
    <AbsoluteFill style={outer}>
      <Backdrop />
      <AbsoluteFill
        style={{
          transform: `scale(${scale})`,
          // Leaving: blur and dim as the camera pushes through, so the incoming scene reads
          // clearly on top instead of two sharp screens overlapping.
          filter: through > 0 ? `blur(${through * 14}px) brightness(${1 - 0.45 * through})` : undefined,
          ...style,
        }}
      >
        {children}
      </AbsoluteFill>
      {/* The edge of a wipe or slice: a thin line in the primary colour that leads the reveal. */}
      {inP < 1 && (entrance === "wipe" || entrance === "slice") && (
        <AbsoluteFill
          style={{
            background: C.primary,
            clipPath:
              entrance === "wipe"
                ? `inset(0 ${100 - (1 - inP) * 100 - 0.4}% 0 ${(1 - inP) * 100}%)`
                : `polygon(${(1 - inP) * 140}% 0, ${(1 - inP) * 140 + 0.8}% 0, ${(1 - inP) * 140 - 39.2}% 100%, ${(1 - inP) * 140 - 40}% 100%)`,
          }}
        />
      )}
    </AbsoluteFill>
  );
}

/** A faint grid and a red glow low on the left, behind every scene. */
export function Backdrop() {
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(oklch(0.3 0.1 290 / 5%) 1px, transparent 1px), linear-gradient(90deg, oklch(0.3 0.1 290 / 5%) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at 30% 50%, black 20%, transparent 75%)",
        }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(circle at 10% 100%, oklch(0.673 0.213 303 / 16%), transparent 45%)" }} />
    </AbsoluteFill>
  );
}
