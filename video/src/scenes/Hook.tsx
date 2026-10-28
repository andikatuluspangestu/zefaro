import { useCurrentFrame } from "remotion";
import { progress } from "../anim";
import { SceneShell } from "../components/SceneShell";
import { pick, useLayout } from "../layout";
import { Kinetic, slam } from "../motion";
import { C, MONO } from "../theme";

/** The programs a PHP project needs, flashing past one per beat. */
const WORDS = ["nginx", "PHP", "MariaDB", "PostgreSQL", "Redis", "Mailpit", "Node.js", "HTTPS"];
const BEAT = 6;
const TITLE_AT = WORDS.length * BEAT + 6;

/**
 * Opens on a fast flash of names, each stamping in over the last, then the line that says
 * what the video is about rises in word by word.
 */
export function Hook() {
  const frame = useCurrentFrame();
  const { kind, safe } = useLayout();
  const index = Math.min(WORDS.length - 1, Math.floor(frame / BEAT));
  const flashing = frame < TITLE_AT - 2;
  // Each word starts landing a beat early, so it is readable for its whole beat.
  const stamp = slam(frame, index * BEAT - 3);
  const big = pick(kind, { landscape: 190, portrait: 150, feed: 140 });
  const gone = progress(frame, TITLE_AT - 6, TITLE_AT);
  return (
    <SceneShell push={{ from: 1, to: 1.06 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        {flashing && (
          <div
            style={{
              fontSize: big,
              fontWeight: 750,
              letterSpacing: "-0.05em",
              lineHeight: 1,
              color: index % 3 === 1 ? C.accent : C.fg,
              transform: `scale(${1.6 - 0.6 * stamp})`,
              opacity: Math.min(1, stamp * 2) * (1 - gone),
              filter: `blur(${(1 - stamp) * 8}px)`,
            }}
          >
            {WORDS[index]}
          </div>
        )}
        {!flashing && (
          <div style={{ maxWidth: pick(kind, { landscape: 1500, portrait: 860, feed: 900 }) }}>
            <div style={{ fontSize: pick(kind, { landscape: 104, portrait: 96, feed: 84 }), fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1.02 }}>
              <Kinetic text="All of it, set up and running." frame={frame} start={TITLE_AT} stagger={4} accent={{ words: ["running"], color: C.accent }} />
            </div>
            <div style={{ marginTop: 34, fontSize: pick(kind, { landscape: 34, portrait: 38, feed: 32 }), color: C.mutedFg, fontFamily: MONO }}>
              <Kinetic text="One app. On Windows. Free." frame={frame} start={TITLE_AT + 22} stagger={5} />
            </div>
          </div>
        )}
      </div>
    </SceneShell>
  );
}
