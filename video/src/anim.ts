import { Easing, interpolate, spring } from "remotion";
import { FPS } from "./theme";

const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** 0 → 1 between two frames, eased and clamped. */
export const progress = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

/** Fade and rise in from `start`, over `dur` frames. */
export const enter = (frame: number, start: number, dur = 14, rise = 16) => {
  const p = progress(frame, start, start + dur);
  return { opacity: p, transform: `translateY(${(1 - p) * rise}px)` };
};

/** Slow in, slow out: for camera and pointer moves. */
export const glide = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.25, 1),
  });

/**
 * Follows a moving target with a damped spring, so a camera eases into every move and
 * settles without stopping dead. `target(f)` gives the values to aim at on frame f.
 * Deterministic: the spring is simulated from frame 0 each time.
 */
export function follow(frame: number, target: (f: number) => number[], omega = 5.5, zeta = 1): number[] {
  const x = [...target(0)];
  const v = x.map(() => 0);
  const steps = 4;
  const dt = 1 / FPS / steps;
  for (let f = 1; f <= frame; f++) {
    const t = target(f);
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < x.length; i++) {
        const a = omega * omega * (t[i] - x[i]) - 2 * zeta * omega * v[i];
        v[i] += a * dt;
        x[i] += v[i] * dt;
      }
    }
  }
  return x;
}

/** A gentle spring, for things that land (badges, rows). */
export const pop = (frame: number, start: number) =>
  spring({ frame: frame - start, fps: FPS, config: { damping: 200, stiffness: 120, mass: 0.6 } });

/** Characters of `text` typed so far, at `cps` characters per second from `start`. */
export const typed = (text: string, frame: number, start: number, cps = 22) =>
  text.slice(0, Math.max(0, Math.floor(((frame - start) / FPS) * cps)));
