import { useCurrentFrame } from "remotion";
import { enter, progress } from "../anim";
import { Logo } from "../components/Logo";
import { SceneShell } from "../components/SceneShell";
import { pick, useLayout } from "../layout";
import { Kinetic, land } from "../motion";
import { C, MONO } from "../theme";

/** An iris opens on the logo building itself; the name slides out beside it. */
export function Intro() {
  const frame = useCurrentFrame();
  const { kind, safe } = useLayout();
  const build = progress(frame, 6, 44);
  const shift = progress(frame, 40, 60);
  const logo = pick(kind, { landscape: 190, portrait: 210, feed: 170 });
  const word = pick(kind, { landscape: 160, portrait: 150, feed: 124 });
  const chips = ["v1.0.0", "open source", "zefaro.pages.dev"];
  return (
    <SceneShell entrance="iris" push={{ from: 1.04, to: 1 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: pick(kind, { landscape: 50, portrait: 64, feed: 44 }),
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 40 * shift }}>
          <div style={{ transform: `rotate(${(1 - progress(frame, 0, 40)) * -12}deg)` }}>
            <Logo size={logo} build={build} />
          </div>
          <div style={{ width: word * 3.3 * shift, overflow: "hidden", whiteSpace: "nowrap", textAlign: "left" }}>
            <div style={{ fontSize: word, fontWeight: 700, letterSpacing: "-0.05em", lineHeight: 1, ...enter(frame, 48, 16, 30) }}>Zefaro</div>
          </div>
        </div>
        <div style={{ fontSize: pick(kind, { landscape: 44, portrait: 52, feed: 42 }), fontWeight: 550, letterSpacing: "-0.025em", lineHeight: 1.18 }}>
          <Kinetic text="Yet Another Local Laravel Tools" frame={frame} start={64} stagger={3} />
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
          {chips.map((c, i) => {
            const p = land(frame, 84 + i * 5, 16);
            return (
              <span
                key={c}
                style={{
                  fontFamily: MONO,
                  fontSize: pick(kind, { landscape: 24, portrait: 30, feed: 26 }),
                  padding: "8px 18px",
                  borderRadius: 999,
                  border: `1px solid ${C.input}`,
                  color: i === 0 ? C.fg : C.mutedFg,
                  background: i === 0 ? C.accentSoft : "transparent",
                  transform: `scale(${p})`,
                  opacity: Math.min(1, p),
                }}
              >
                {c}
              </span>
            );
          })}
        </div>
      </div>
    </SceneShell>
  );
}
