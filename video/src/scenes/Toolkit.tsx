import type { ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { enter, follow, pop, progress, typed } from "../anim";
import { SceneShell } from "../components/SceneShell";
import { Badge, Button, Card, Icon, Mono } from "../components/ui";
import { pick, useLayout } from "../layout";
import { Kinetic, count } from "../motion";
import { C, MONO } from "../theme";

/** Frames each panel faces the camera for. */
const TURN = 84;
const PANELS = [
  { id: "tinker", label: "Tinker", icon: "terminal" },
  { id: "data", label: "Data", icon: "table" },
  { id: "artisan", label: "Artisan", icon: "hammer" },
  { id: "logs", label: "Logs", icon: "file-lines" },
] as const;
const PW = 720;
const PH = 450;

/**
 * Four of the site page's tabs on a turning carousel. Each panel plays its own short demo
 * while it faces the camera, then the ring turns to the next on a spring.
 */
export function Toolkit() {
  const frame = useCurrentFrame();
  const { kind, width, height, safe } = useLayout();
  const wide = kind === "landscape";
  const active = Math.min(PANELS.length - 1, Math.floor(frame / TURN));
  const [rot] = follow(frame, (f) => [Math.min(PANELS.length - 1, Math.floor(f / TURN)) * -90], 7, 0.75);
  const scale = pick(kind, { landscape: 1.45, portrait: 1.3, feed: 1.2 });
  const cx = wide ? width * 0.66 : width / 2;
  const cy = wide ? height / 2 : pick(kind, { landscape: 0, portrait: 1080, feed: 900 });
  const radius = PW / 2 + 40;

  return (
    <SceneShell entrance="fade" push={{ from: 1, to: 1.03 }}>
      <div
        style={{
          position: "absolute",
          left: safe.left,
          ...(wide
            ? { top: 0, bottom: 0, width: 470, display: "flex", flexDirection: "column", justifyContent: "center" }
            : { right: safe.right, top: safe.top, textAlign: "center" }),
        }}
      >
        <div style={{ fontSize: pick(kind, { landscape: 20, portrait: 30, feed: 24 }), color: C.accent, fontWeight: 600, marginBottom: 16 }}>Site tools</div>
        <div style={{ fontSize: pick(kind, { landscape: 56, portrait: 70, feed: 54 }), fontWeight: 680, letterSpacing: "-0.035em", lineHeight: 1.05 }}>
          <Kinetic text="Look inside your Laravel app." frame={frame} start={4} stagger={3} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 26, flexWrap: "wrap", justifyContent: wide ? "flex-start" : "center" }}>
          {PANELS.map((p, i) => (
            <span
              key={p.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 16px",
                borderRadius: 999,
                fontSize: pick(kind, { landscape: 20, portrait: 28, feed: 24 }),
                fontWeight: 600,
                background: i === active ? C.primary : C.muted,
                color: i === active ? C.onPrimary : C.mutedFg,
                opacity: enter(frame, 20 + i * 4, 12, 10).opacity,
                transform: `${enter(frame, 20 + i * 4, 12, 10).transform} scale(${i === active ? 1 + 0.06 * (1 - progress(frame, i * TURN, i * TURN + 10)) : 1})`,
              }}
            >
              <Icon name={p.icon} /> {p.label}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 22, fontSize: pick(kind, { landscape: 22, portrait: 28, feed: 24 }), color: C.mutedFg, lineHeight: 1.45, ...enter(frame, 30) }}>
          Plus .env, config values, routes and queue workers.
        </div>
      </div>

      <div style={{ position: "absolute", left: cx, top: cy, width: 0, height: 0, perspective: 2200 }}>
        <div style={{ transformStyle: "preserve-3d", transform: `scale(${scale}) translateZ(${-radius}px) rotateY(${rot}deg)` }}>
          {PANELS.map((p, i) => {
            const a = ((i * 90 + rot) % 360 + 360) % 360;
            const facing = Math.cos((a * Math.PI) / 180);
            return (
              <div
                key={p.id}
                style={{
                  position: "absolute",
                  left: -PW / 2,
                  top: -PH / 2,
                  width: PW,
                  height: PH,
                  transform: `rotateY(${i * 90}deg) translateZ(${radius}px)`,
                  backfaceVisibility: "hidden",
                  opacity: Math.max(0, facing) ** 0.6,
                  filter: `brightness(${0.45 + 0.55 * Math.max(0, facing)})`,
                }}
              >
                <Panel label={p.label} icon={p.icon}>
                  {p.id === "tinker" && <Tinker f={frame - (i * TURN + 8)} />}
                  {p.id === "data" && <Data f={frame - (i * TURN + 8)} />}
                  {p.id === "artisan" && <Artisan f={frame - (i * TURN + 8)} />}
                  {p.id === "logs" && <Logs f={frame - (i * TURN + 8)} />}
                </Panel>
              </div>
            );
          })}
        </div>
      </div>
    </SceneShell>
  );
}

function Panel({ label, icon, children }: { label: string; icon: string; children: ReactNode }) {
  return (
    <div
      style={{
        width: PW,
        height: PH,
        borderRadius: 14,
        background: C.bg,
        border: `1px solid ${C.line}`,
        boxShadow: `0 50px 90px -40px ${C.shadow}`,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontSize: 14,
      }}
    >
      <div style={{ height: 42, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: `1px solid ${C.border}`, background: C.card }}>
        <span style={{ fontWeight: 600 }}>shop</span>
        <Mono style={{ color: C.mutedFg, fontSize: 12 }}>https://shop.test</Mono>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 7, background: C.muted, fontSize: 12.5, fontWeight: 500 }}>
          <Icon name={icon} style={{ fontSize: 11 }} /> {label}
        </span>
      </div>
      <div style={{ flex: 1, padding: 16, position: "relative", overflow: "hidden" }}>{children}</div>
    </div>
  );
}

/** Code typed into the session; the value comes back with the SQL it ran. */
function Tinker({ f }: { f: number }) {
  const first = "User::where('active', true)->count()";
  const second = "User::latest()->first()";
  const n = count(f, 32, 46, 0, 1284);
  return (
    <div style={{ fontFamily: MONO, fontSize: 13.5, lineHeight: 1.7 }}>
      <div>
        <span style={{ color: C.accent }}>&gt; </span>
        {typed(first, f, 0, 32)}
      </div>
      {f >= 30 && (
        <div style={{ ...enter(f, 30, 8, 6) }}>
          <span style={{ color: C.sky, fontSize: 20, fontWeight: 600 }}>{n.toLocaleString("en-GB")}</span>
          <span style={{ color: C.mutedFg, marginLeft: 14, fontSize: 12 }}>1 query · 2.4 ms</span>
        </div>
      )}
      {f >= 44 && (
        <div style={{ marginTop: 8 }}>
          <span style={{ color: C.accent }}>&gt; </span>
          {typed(second, f, 44, 34)}
        </div>
      )}
      {f >= 62 && (
        <div style={{ marginTop: 4, ...enter(f, 62, 8, 6) }}>
          <span style={{ color: C.amber }}>▾ User</span> <span style={{ color: C.mutedFg }}>#1284</span>
          <div style={{ marginLeft: 8, paddingLeft: 12, borderLeft: `1px solid ${C.border}` }}>
            {[
              ["id", <span style={{ color: C.sky }}>1284</span>],
              ["name", <span style={{ color: "oklch(0.85 0.12 160)" }}>"Ana Wijaya"</span>],
              ["email", <span style={{ color: "oklch(0.85 0.12 160)" }}>"ana@example.test"</span>],
              ["password", <span style={{ color: C.mutedFg }}>••••••••</span>],
            ].map(([k, v], i) => (
              <div key={String(k)} style={enter(f, 64 + i * 3, 8, 4)}>
                <span style={{ color: C.mutedFg }}>{k}: </span>
                {v}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ROWS = [
  [1281, "Budi Santoso", "budi@example.test"],
  [1282, "Ana Wijaya", "ana@example.test"],
  [1283, "Citra Lestari", "citra@example.test"],
  [1284, "Anaya Putri", "anaya@example.test"],
  [1285, "Dewi Ratna", "dewi@example.test"],
  [1286, "Eko Prasetyo", "eko@example.test"],
] as const;

/** The users table; a search narrows it to the rows that match. */
function Data({ f }: { f: number }) {
  const q = typed("ana", f, 14, 10);
  const filter = progress(f, 44, 58);
  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <span style={{ width: 120, padding: "6px 10px", borderRadius: 8, background: C.muted, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="cube" style={{ fontSize: 11, color: C.mutedFg }} /> users
        </span>
        <span style={{ flex: 1, height: 30, borderRadius: 8, border: `1px solid ${q ? C.accent : C.input}`, display: "flex", alignItems: "center", gap: 8, padding: "0 10px", fontSize: 13 }}>
          <Icon name="magnifying-glass" style={{ fontSize: 11, color: C.mutedFg }} />
          {q || <span style={{ color: C.mutedFg }}>Search this table</span>}
        </span>
        <Badge tone="outline">Read only</Badge>
      </div>
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 1.3fr 110px", padding: "8px 12px", fontSize: 12, color: C.mutedFg, borderBottom: `1px solid ${C.border}` }}>
          <span>
            <Icon name="key" style={{ fontSize: 9, color: C.amber }} /> id
          </span>
          <span>name</span>
          <span>email</span>
          <span>password</span>
        </div>
        {ROWS.map((r, i) => {
          const keep = String(r[1]).toLowerCase().includes("ana");
          const h = keep ? 1 : 1 - filter;
          return (
            <div
              key={r[0]}
              style={{
                display: "grid",
                gridTemplateColumns: "70px 1fr 1.3fr 110px",
                padding: `${8 * h}px 12px`,
                height: 36 * h,
                boxSizing: "border-box",
                overflow: "hidden",
                fontFamily: MONO,
                fontSize: 12.5,
                borderBottom: h > 0.05 ? `1px solid ${C.border}` : "none",
                background: keep && filter > 0 ? `oklch(0.673 0.213 303 / ${8 * filter}%)` : "transparent",
                ...enter(f, i * 3, 10, 8),
                opacity: h * enter(f, i * 3, 10, 8).opacity,
              }}
            >
              <span style={{ color: C.sky }}>{r[0]}</span>
              <span>{r[1]}</span>
              <span>{r[2]}</span>
              <span style={{ color: C.mutedFg }}>••••••••</span>
            </div>
          );
        })}
      </Card>
      <div style={{ marginTop: 10, fontSize: 12, color: C.mutedFg }}>{filter > 0.5 ? "2 rows · App\\Models\\User" : "6 rows · App\\Models\\User"}</div>
    </div>
  );
}

/** A command picked from the list runs with its output streaming in. */
function Artisan({ f }: { f: number }) {
  const lines = [
    { at: 34, text: "   INFO  Running migrations.", tone: C.sky },
    { at: 40, text: "  2026_10_27_create_orders_table ........ 18ms DONE" },
    { at: 46, text: "  2026_10_27_create_invoices_table ...... 11ms DONE" },
    { at: 54, text: "   INFO  Seeding database.", tone: C.sky },
    { at: 60, text: "  Database\\Seeders\\DemoSeeder ........... 42ms DONE" },
  ];
  return (
    <div style={{ display: "flex", gap: 14, height: "100%" }}>
      <div style={{ width: 170, display: "flex", flexDirection: "column", gap: 2, fontFamily: MONO, fontSize: 12.5 }}>
        {["about", "cache:clear", "make:model", "migrate", "migrate:fresh", "queue:work", "route:list", "storage:link"].map((c) => (
          <span key={c} style={{ padding: "4px 8px", borderRadius: 6, background: c === "migrate" && f >= 6 ? C.muted : "transparent", color: c === "migrate" && f >= 6 ? C.accent : C.fg }}>
            {c}
          </span>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: MONO, fontWeight: 600 }}>migrate</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
          <span
            style={{
              width: 30,
              height: 17,
              borderRadius: 99,
              background: f >= 16 ? C.primary : C.muted,
              position: "relative",
            }}
          >
            <span style={{ position: "absolute", top: 2, left: f >= 16 ? 15 : 2, width: 13, height: 13, borderRadius: 99, background: C.card }} />
          </span>
          <Mono>--seed</Mono>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button variant="primary" size="xs" pressed={f >= 26 && f < 32 ? 1 : 0}>
            <Icon name="play" /> Run
          </Button>
          <Mono style={{ color: C.mutedFg, fontSize: 12 }}>php artisan migrate --seed</Mono>
        </div>
        <Card style={{ flex: 1, padding: "8px 12px", fontFamily: MONO, fontSize: 12, lineHeight: 1.7 }}>
          {lines
            .filter((l) => f >= l.at)
            .map((l) => (
              <div key={l.at} style={{ color: l.tone ?? C.fg, whiteSpace: "pre", ...enter(f, l.at, 6, 4) }}>
                {l.text}
              </div>
            ))}
        </Card>
      </div>
    </div>
  );
}

/** Entries newest first; an error opens to show its stack trace. */
function Logs({ f }: { f: number }) {
  const open = progress(f, 30, 44);
  const entries = [
    { level: "error", msg: "SQLSTATE[23505]: Unique violation: users_email_unique", time: "10:42:18" },
    { level: "warning", msg: "Slow query: select * from orders (812 ms)", time: "10:41:02" },
    { level: "info", msg: "User signed in {\"id\":1284}", time: "10:40:55" },
    { level: "info", msg: "Order 1042 paid", time: "10:39:20" },
  ];
  const tone: Record<string, string> = { error: C.coral, warning: C.amber, info: C.sky };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, fontSize: 12 }}>
        {["All 24", "Errors 1", "Warnings 3", "Info 20"].map((c, i) => (
          <span key={c} style={{ padding: "4px 10px", borderRadius: 7, background: i === 0 ? C.muted : "transparent", color: i === 0 ? C.fg : C.mutedFg }}>
            {c}
          </span>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, color: C.emerald }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: C.emerald, opacity: 0.5 + 0.5 * Math.sin(f / 4) }} /> Following
        </span>
      </div>
      <Card style={{ overflow: "hidden" }}>
        {entries.map((e, i) => (
          <div key={e.time} style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, ...enter(f, i * 4, 10, -10) }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 64, textAlign: "center", fontFamily: MONO, fontSize: 10, textTransform: "uppercase", border: `1px solid ${tone[e.level]}`, color: tone[e.level], borderRadius: 4, padding: "1px 0" }}>
                {e.level}
              </span>
              <span style={{ fontSize: 13, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.msg}</span>
              <Mono style={{ fontSize: 11, color: C.mutedFg }}>{e.time}</Mono>
            </div>
            {i === 0 && open > 0 && (
              <div style={{ height: 86 * open, overflow: "hidden", marginTop: 6 * open }}>
                <div style={{ background: C.card, borderRadius: 6, padding: "6px 10px", fontFamily: MONO, fontSize: 11, lineHeight: 1.6, color: C.mutedFg }}>
                  <div>[stacktrace]</div>
                  <div>#0 app/Http/Controllers/RegisterController.php(41): User::create()</div>
                  <div>#1 vendor/laravel/framework/src/Illuminate/Routing/Controller.php(54)</div>
                  <div>#2 {"{main}"}</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </Card>
      <div style={{ fontSize: 11.5, color: C.mutedFg, transform: `scale(${pop(f, 50)})`, transformOrigin: "0 50%" }}>storage/logs/laravel.log · 48 KB</div>
    </div>
  );
}
