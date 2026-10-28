import { useCurrentFrame } from "remotion";
import { progress } from "../anim";
import { Logo } from "../components/Logo";
import { SceneShell } from "../components/SceneShell";
import { ServiceLogo } from "../components/ui";
import { pick, useLayout } from "../layout";
import { Kinetic, draw, land } from "../motion";
import { C } from "../theme";

const STACK = [
  { logo: "nginx", name: "nginx" },
  { logo: "php", name: "PHP 7.4–8.5" },
  { logo: "mariadb", name: "MariaDB" },
  { logo: "postgresql", name: "PostgreSQL" },
  { logo: "redis", name: "Redis" },
  { logo: "mailpit", name: "Mailpit" },
  { logo: "nodejs", name: "Node.js" },
  { logo: "phpmyadmin", name: "phpMyAdmin" },
  { logo: "dns", name: ".test DNS" },
];

/**
 * Zefaro's logo in the middle; the programs it runs fly out onto a tilted ring and orbit it,
 * nearer ones larger and brighter, each tied to the centre by a line that draws itself.
 */
export function Orbit() {
  const frame = useCurrentFrame();
  const { kind, width, height, safe } = useLayout();
  const wide = kind === "landscape";
  const cx = wide ? width * 0.655 : width / 2;
  const cy = wide ? height / 2 : pick(kind, { landscape: 0, portrait: 1180, feed: 820 });
  const rx = pick(kind, { landscape: 470, portrait: 400, feed: 400 });
  const ry = pick(kind, { landscape: 230, portrait: 300, feed: 220 });
  const spin = frame * 0.012;
  const tile = pick(kind, { landscape: 92, portrait: 100, feed: 84 });

  const items = STACK.map((s, i) => {
    const out = land(frame, 8 + i * 4, 22);
    const a = spin + (i / STACK.length) * Math.PI * 2;
    const depth = (Math.sin(a) + 1) / 2; // 0 far, 1 near
    return {
      ...s,
      i,
      out,
      x: cx + Math.cos(a) * rx * out,
      y: cy + Math.sin(a) * ry * out,
      depth,
      line: draw(frame, 14 + i * 4, 20),
    };
  });

  return (
    <SceneShell entrance="slice" push={{ from: 1.08, to: 1 }}>
      <svg style={{ position: "absolute", inset: 0 }} width={width} height={height}>
        {items.map((it) => (
          <line
            key={it.name}
            x1={cx}
            y1={cy}
            x2={cx + (it.x - cx) * it.line}
            y2={cy + (it.y - cy) * it.line}
            stroke={C.accent}
            strokeOpacity={0.15 + 0.35 * it.depth}
            strokeWidth={2}
            strokeDasharray="6 8"
            strokeDashoffset={-frame * 1.5}
          />
        ))}
      </svg>
      {[...items]
        .sort((a, b) => a.depth - b.depth)
        .map((it) => {
          const scale = (0.72 + 0.4 * it.depth) * Math.min(1, it.out);
          return (
            <div
              key={it.name}
              style={{
                position: "absolute",
                left: it.x,
                top: it.y,
                transform: `translate(-50%, -50%) scale(${scale})`,
                opacity: Math.min(1, it.out * 1.4) * (0.45 + 0.55 * it.depth),
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                filter: `blur(${(1 - it.depth) * 1.5}px)`,
              }}
            >
              <div style={{ padding: 8, borderRadius: 22, background: C.card, border: `1px solid ${C.border}`, boxShadow: `0 20px 40px -20px ${C.shadow}` }}>
                <ServiceLogo name={it.logo} size={tile} />
              </div>
              <span style={{ fontSize: pick(kind, { landscape: 22, portrait: 26, feed: 22 }), fontWeight: 600, whiteSpace: "nowrap" }}>{it.name}</span>
            </div>
          );
        })}
      <div
        style={{
          position: "absolute",
          left: cx,
          top: cy,
          transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * progress(frame, 0, 14)})`,
          filter: `drop-shadow(0 0 ${40 + 20 * Math.sin(frame / 8)}px oklch(0.673 0.213 303 / 45%))`,
        }}
      >
        <Logo size={pick(kind, { landscape: 150, portrait: 170, feed: 140 })} />
      </div>
      <div
        style={{
          position: "absolute",
          left: safe.left,
          ...(wide
            ? { top: 0, bottom: 0, width: 480, display: "flex", flexDirection: "column", justifyContent: "center" }
            : { right: safe.right, top: safe.top + 20, textAlign: "center" }),
        }}
      >
        <div style={{ fontSize: pick(kind, { landscape: 22, portrait: 30, feed: 24 }), color: C.accent, fontWeight: 600, marginBottom: 18 }}>
          <Kinetic text="The stack" frame={frame} start={4} />
        </div>
        <div style={{ fontSize: pick(kind, { landscape: 62, portrait: 72, feed: 58 }), fontWeight: 680, letterSpacing: "-0.035em", lineHeight: 1.05 }}>
          <Kinetic text="Everything a PHP project runs, in one window." frame={frame} start={10} stagger={3} />
        </div>
        <div style={{ marginTop: 22, fontSize: pick(kind, { landscape: 24, portrait: 30, feed: 26 }), color: C.mutedFg, lineHeight: 1.4 }}>
          <Kinetic text="Downloaded from each project's official source and checked before use." frame={frame} start={40} stagger={2} />
        </div>
      </div>
    </SceneShell>
  );
}
