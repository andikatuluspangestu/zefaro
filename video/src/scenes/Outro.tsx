import { useCurrentFrame } from "remotion";
import { enter, progress } from "../anim";
import { Logo } from "../components/Logo";
import { SceneShell } from "../components/SceneShell";
import { Icon } from "../components/ui";
import { pick, useLayout } from "../layout";
import { C, MONO } from "../theme";

/** Name, what to do next, and where to get it. The camera settles back from a slight zoom. */
export function Outro() {
  const frame = useCurrentFrame();
  const { kind, safe } = useLayout();
  const wide = kind === "landscape";
  return (
    <SceneShell entrance="wipe" push={{ from: 1.08, to: 1 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: pick(kind, { landscape: 80, portrait: 70, feed: 52 }),
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: wide ? "row" : "column", alignItems: "center", gap: 32, ...enter(frame, 2, 18) }}>
          <Logo size={pick(kind, { landscape: 128, portrait: 170, feed: 130 })} build={progress(frame, 0, 30) * 0.5 + 0.5} />
          <div style={{ textAlign: wide ? "left" : "center" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: wide ? "flex-start" : "center", gap: 18 }}>
              <span style={{ fontSize: pick(kind, { landscape: 110, portrait: 120, feed: 100 }), fontWeight: 700, letterSpacing: "-0.05em", lineHeight: 1 }}>Zefaro</span>
              <span style={{ fontSize: 30, fontFamily: MONO, color: C.mutedFg }}>1.0.0</span>
            </div>
            <div style={{ fontSize: pick(kind, { landscape: 30, portrait: 36, feed: 30 }), color: C.mutedFg, marginTop: 12, lineHeight: 1.3 }}>
              Free, open-source local PHP development for Windows.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: wide ? "row" : "column", alignItems: "center", gap: 18, ...enter(frame, 26) }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 14, height: 76, padding: "0 34px", borderRadius: 18, background: C.primary, color: C.onPrimary, fontSize: 32, fontWeight: 600 }}>
            <Icon name="download" /> Download Zefaro 1.0.0
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 14,
              height: 76,
              padding: "0 30px",
              borderRadius: 18,
              border: `1px solid ${C.input}`,
              fontSize: wide ? 28 : 25,
              fontFamily: MONO,
            }}
          >
            <Icon name="github" brands /> github.com/andikatuluspangestu/zefaro
          </span>
        </div>
        <div style={{ fontSize: pick(kind, { landscape: 20, portrait: 24, feed: 20 }), color: C.mutedFg, lineHeight: 1.6, ...enter(frame, 40) }}>
          Windows 10 and 11, 64-bit. MIT License.
          <br />
          Zefaro is an independent project, not affiliated with Laravel.
        </div>
      </div>
    </SceneShell>
  );
}
