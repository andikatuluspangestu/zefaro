import { useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { pick, useLayout } from "../layout";
import { Kinetic, Marquee, count, land } from "../motion";
import { C } from "../theme";

const ROW_A = [
  ["lock", "HTTPS for .test"],
  ["globe", "Sites in one click"],
  ["layer-group", "Starter kits"],
  ["database", "MariaDB"],
  ["database", "PostgreSQL"],
  ["bolt", "Redis"],
  ["envelope", "Mailpit"],
  ["table", "phpMyAdmin"],
];
const ROW_B = [
  ["terminal", "Tinker"],
  ["hammer", "Artisan"],
  ["list-check", "Queue workers"],
  ["file-lines", "App logs"],
  ["code", "Open in your editor"],
  ["box-archive", "Composer"],
  ["node-js", "Node.js"],
  ["file-export", "Import 5 GB dumps"],
];
const STATS = [
  { n: 9, label: "services" },
  { n: 7, label: "PHP versions" },
  { n: 0, label: "accounts" },
];

/** Two rows of features sliding opposite ways under counters that roll up. */
export function Features() {
  const frame = useCurrentFrame();
  const { kind, safe } = useLayout();
  const chip = pick(kind, { landscape: 30, portrait: 34, feed: 30 });
  const pill = (icon: string, label: string, i: number) => (
    <span
      key={`${label}-${i}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 26px",
        borderRadius: 18,
        background: C.card,
        border: `1px solid ${C.border}`,
        fontSize: chip,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <i className={`${icon === "node-js" ? "fa-brands" : "fa-solid"} fa-${icon}`} style={{ color: C.accent }} />
      {label}
    </span>
  );
  return (
    <SceneShell entrance="whip">
      <div
        style={{
          position: "absolute",
          inset: 0,
          paddingTop: safe.top,
          paddingBottom: safe.bottom,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: pick(kind, { landscape: 38, portrait: 46, feed: 34 }),
        }}
      >
        <div style={{ textAlign: "center", padding: `0 ${safe.right}px 0 ${safe.left}px`, fontSize: pick(kind, { landscape: 64, portrait: 70, feed: 58 }), fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.05 }}>
          <Kinetic text="Built in. Nothing to configure." frame={frame} start={4} stagger={4} accent={{ words: ["Nothing"], color: C.accent }} />
        </div>
        <div style={{ transform: "rotate(-2deg)", display: "flex", flexDirection: "column", gap: 18 }}>
          <Marquee frame={frame} speed={-3.2} from={0} gap={16}>
            {ROW_A.map(([i, l], k) => pill(i, l, k))}
          </Marquee>
          <Marquee frame={frame} speed={3.2} from={-1400} gap={16}>
            {ROW_B.map(([i, l], k) => pill(i, l, k))}
          </Marquee>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: pick(kind, { landscape: 90, portrait: 50, feed: 50 }) }}>
          {STATS.map((s, i) => {
            const p = land(frame, 60 + i * 8, 18);
            return (
              <div key={s.label} style={{ textAlign: "center", transform: `translateY(${(1 - p) * 40}px)`, opacity: Math.min(1, p * 1.5) }}>
                <div style={{ fontSize: pick(kind, { landscape: 96, portrait: 100, feed: 84 }), fontWeight: 750, letterSpacing: "-0.05em", lineHeight: 1, color: s.n === 0 ? C.accent : C.fg, fontVariantNumeric: "tabular-nums" }}>
                  {s.n === 0 ? 0 : count(frame, 60 + i * 8, 90 + i * 8, 0, s.n)}
                </div>
                <div style={{ fontSize: pick(kind, { landscape: 24, portrait: 28, feed: 24 }), color: C.mutedFg, marginTop: 8 }}>{s.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </SceneShell>
  );
}
