import { interpolate, useCurrentFrame } from "remotion";
import { pick, useLayout } from "../layout";
import { C, FONT } from "../theme";
import { Logo } from "./Logo";
import { Icon } from "./ui";

/**
 * The download address in the bottom-left corner while the features play, so a viewer who joins halfway
 * knows where to get Zefaro. Fades in at `from` and out at `to` (frames). Not drawn on the
 * vertical cut, where TikTok and Reels put their own buttons in the corners.
 */
export function SiteBadge({ from, to }: { from: number; to: number }) {
  const frame = useCurrentFrame();
  const { kind } = useLayout();
  if (kind === "portrait") return null;
  const opacity = interpolate(frame, [from, from + 15, to - 12, to], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(frame, [from, from + 15], [12, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const size = pick(kind, { landscape: 22, portrait: 22, feed: 20 });
  return (
    <div
      style={{
        position: "absolute",
        left: pick(kind, { landscape: 40, portrait: 40, feed: 32 }),
        bottom: pick(kind, { landscape: 34, portrait: 34, feed: 28 }),
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 16px 9px 10px",
        borderRadius: 999,
        background: "oklch(1 0 0 / 88%)",
        border: `1px solid ${C.border}`,
        boxShadow: `0 10px 24px -14px ${C.shadow}`,
        fontFamily: FONT,
        fontSize: size,
        fontWeight: 600,
        color: C.fg,
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      <Logo size={size * 1.4} />
      zefaro.pages.dev
      <Icon name="download" style={{ fontSize: size * 0.8, color: C.primary }} />
    </div>
  );
}
