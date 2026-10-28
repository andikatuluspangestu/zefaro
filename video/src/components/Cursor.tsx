import { interpolate } from "remotion";
import { glide } from "../anim";

/**
 * Where the pointer is at `frame`: [frame, x, y] waypoints. It speeds up and slows down
 * between them and travels on a slight arc, as a hand on a mouse does.
 */
export function cursorAt(frame: number, path: [number, number, number][]) {
  if (frame <= path[0][0]) return { x: path[0][1], y: path[0][2] };
  for (let i = 1; i < path.length; i++) {
    const [f0, x0, y0] = path[i - 1];
    const [f1, x1, y1] = path[i];
    if (frame <= f1) {
      const p = glide(frame, f0, f1);
      const bend = Math.sin(Math.PI * p) * 0.12;
      return { x: x0 + (x1 - x0) * p - (y1 - y0) * bend, y: y0 + (y1 - y0) * p + (x1 - x0) * bend };
    }
  }
  const last = path[path.length - 1];
  return { x: last[1], y: last[2] };
}

/** 0 → 1 → 0 around a click at `at`, for pressing a button. */
export const clickPress = (frame: number, at: number) =>
  interpolate(frame, [at - 3, at, at + 5], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

/** The pointer, with a ring that grows on each click frame in `clicks`. */
export function Cursor({ x, y, frame, clicks = [] }: { x: number; y: number; frame: number; clicks?: number[] }) {
  const ring = clicks
    .map((c) => frame - c)
    .filter((d) => d >= 0 && d < 14)
    .map((d) => d / 14)[0];
  return (
    <div style={{ position: "absolute", left: x, top: y, pointerEvents: "none", zIndex: 50 }}>
      {ring !== undefined && (
        <span
          style={{
            position: "absolute",
            left: -18,
            top: -18,
            width: 36,
            height: 36,
            borderRadius: 999,
            border: "2px solid rgb(112 94 255 / 55%)",
            transform: `scale(${0.4 + ring * 0.8})`,
            opacity: 1 - ring,
          }}
        />
      )}
      <svg width="22" height="22" viewBox="0 0 24 24" style={{ display: "block", filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 60%))" }}>
        <path d="M4 2 L4 19 L8.6 14.8 L11.6 21.4 L14.4 20.2 L11.5 13.7 L17.8 13.7 Z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
