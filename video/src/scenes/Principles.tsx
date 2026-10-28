import { useCurrentFrame } from "remotion";
import { progress } from "../anim";
import { SceneShell } from "../components/SceneShell";
import { pick, useLayout } from "../layout";
import { slam } from "../motion";
import { C } from "../theme";

/**
 * What Zefaro promises, one line at a time, each arriving its own way: stamped, slid,
 * risen from a mask, and focused from a blur.
 */
const LINES = [
  { text: "Free.", how: "stamp" },
  { text: "Open source.", how: "slide" },
  { text: "Runs on your machine only.", how: "mask" },
  { text: "No accounts. No tracking.", how: "focus" },
] as const;

export function Principles() {
  const frame = useCurrentFrame();
  const { kind, safe } = useLayout();
  const size = pick(kind, { landscape: 96, portrait: 92, feed: 78 });
  return (
    <SceneShell entrance="iris" push={{ from: 1.04, to: 1 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: kind === "landscape" ? "flex-start" : "center",
          textAlign: kind === "landscape" ? "left" : "center",
          gap: pick(kind, { landscape: 14, portrait: 26, feed: 16 }),
          paddingLeft: kind === "landscape" ? 180 : safe.left,
        }}
      >
        {LINES.map((l, i) => {
          const at = 4 + i * 16;
          const p = progress(frame, at, at + 16);
          const s = slam(frame, at);
          const style =
            l.how === "stamp"
              ? { transform: `scale(${1.8 - 0.8 * s})`, opacity: Math.min(1, s * 2) }
              : l.how === "slide"
                ? { transform: `translateX(${(1 - p) * -220}px)`, opacity: p }
                : l.how === "mask"
                  ? { clipPath: `inset(${(1 - p) * 100}% 0 0 0)`, transform: `translateY(${(1 - p) * 30}px)` }
                  : { filter: `blur(${(1 - p) * 16}px)`, opacity: p, transform: `scale(${1.08 - 0.08 * p})` };
          return (
            <div
              key={l.text}
              style={{
                fontSize: i === 0 ? size * 1.3 : size,
                fontWeight: 720,
                letterSpacing: "-0.045em",
                lineHeight: 1.05,
                color: i === 0 ? C.accent : C.fg,
                transformOrigin: kind === "landscape" ? "0 50%" : "50% 50%",
                ...style,
              }}
            >
              {l.text}
            </div>
          );
        })}
      </div>
    </SceneShell>
  );
}
