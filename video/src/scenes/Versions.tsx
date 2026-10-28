import { useCurrentFrame } from "remotion";
import { follow } from "../anim";
import { SceneShell } from "../components/SceneShell";
import { Icon, ServiceLogo } from "../components/ui";
import { pick, useLayout } from "../layout";
import { Kinetic, land } from "../motion";
import { C, MONO } from "../theme";

const VERSIONS = ["7.4", "8.0", "8.1", "8.2", "8.3", "8.4", "8.5"];
const STEP = 9;
const ROLL_AT = 14;
const SITES = [
  { site: "legacy.test", php: "7.4" },
  { site: "blog.test", php: "8.3" },
  { site: "shop.test", php: "8.5" },
];

/**
 * An odometer rolls through every PHP version Zefaro installs, each chip lighting as the
 * counter passes it; then three sites slide in, each on its own version.
 */
export function Versions() {
  const frame = useCurrentFrame();
  const { kind, safe } = useLayout();
  const target = (f: number) => [Math.min(VERSIONS.length - 1, Math.max(0, Math.floor((f - ROLL_AT) / STEP)))];
  // Critically damped: the counter lands on each version without bouncing past it.
  const [pos] = follow(frame, target, 10, 1);
  const reached = Math.round(pos);
  const digit = pick(kind, { landscape: 230, portrait: 220, feed: 190 });
  const line = digit * 1.05;
  return (
    <SceneShell entrance="slice" push={{ from: 1, to: 1.05 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: pick(kind, { landscape: 34, portrait: 44, feed: 30 }),
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: pick(kind, { landscape: 54, portrait: 64, feed: 52 }), fontWeight: 680, letterSpacing: "-0.035em" }}>
          <Kinetic text="Every PHP version, side by side." frame={frame} start={2} stagger={3} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <ServiceLogo name="php" size={digit * 0.62} />
          <div style={{ height: line, overflow: "hidden", maskImage: "linear-gradient(transparent, black 18%, black 82%, transparent)", fontSize: digit, fontWeight: 750, letterSpacing: "-0.05em", lineHeight: `${line}px`, fontVariantNumeric: "tabular-nums" }}>
            <div style={{ transform: `translateY(${-pos * line}px)` }}>
              {VERSIONS.map((v) => (
                <div key={v} style={{ color: v === "8.5" ? C.accent : C.fg }}>
                  {v}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          {VERSIONS.map((v, i) => (
            <span
              key={v}
              style={{
                fontFamily: MONO,
                fontSize: pick(kind, { landscape: 22, portrait: 28, feed: 24 }),
                padding: "6px 14px",
                borderRadius: 10,
                border: `1px solid ${i <= reached ? C.accent : C.border}`,
                background: i <= reached ? C.accentSoft : "transparent",
                color: i <= reached ? C.fg : C.mutedFg,
              }}
            >
              {v}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: kind === "landscape" ? "row" : "column", gap: 12, marginTop: 6 }}>
          {SITES.map((s, i) => {
            const p = land(frame, 84 + i * 8, 18);
            return (
              <div
                key={s.site}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 18px",
                  borderRadius: 14,
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  fontSize: pick(kind, { landscape: 24, portrait: 30, feed: 26 }),
                  transform: `translateX(${(1 - p) * (i % 2 ? 120 : -120)}px) scale(${0.9 + 0.1 * Math.min(1, p)})`,
                  opacity: Math.min(1, p * 1.5),
                }}
              >
                <Icon name="globe" style={{ color: C.mutedFg }} />
                <span style={{ fontFamily: MONO }}>{s.site}</span>
                <Icon name="arrow-right" style={{ color: C.mutedFg, fontSize: "0.7em" }} />
                <span style={{ fontWeight: 650, color: C.accent }}>PHP {s.php}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: pick(kind, { landscape: 22, portrait: 28, feed: 24 }), color: C.mutedFg }}>
          <Kinetic text="Official Windows builds. Each site picks its own. Node.js too." frame={frame} start={112} stagger={2} />
        </div>
      </div>
    </SceneShell>
  );
}
