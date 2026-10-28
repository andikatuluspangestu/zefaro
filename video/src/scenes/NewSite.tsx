import type { ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { enter, pop, progress, typed } from "../anim";
import { AppWindow } from "../components/AppWindow";
import { Cursor, clickPress, cursorAt } from "../components/Cursor";
import { DemoFrame, WIDE as W, type Shot } from "../components/DemoFrame";
import { Button, Card, Icon, Mono } from "../components/ui";
import { C, MONO } from "../theme";

const KIT_AT = 62;
const DB_AT = 96;
const CREATE_AT = 128;
const SHOTS: Shot[] = [
  [0, 1, W.x, W.y],
  [6, 1.45, 260, 110],
  [40, 1.35, 520, 290],
  [116, 1, W.x, W.y],
  [150, 1.3, 330, 200],
];

const KITS = [
  { name: "Laravel", icon: "laravel", brand: true },
  { name: "React", icon: "react", brand: true },
  { name: "Vue", icon: "vuejs", brand: true },
  { name: "Livewire", icon: "bolt" },
  { name: "Svelte", icon: "fire" },
];
const DBS = [
  { name: "SQLite", icon: "file" },
  { name: "MariaDB", icon: "database" },
  { name: "PostgreSQL", icon: "database" },
];
const LOG: { at: number; text: string; tone?: string }[] = [
  { at: 0, text: "> laravel new shop --livewire --database=pgsql --pest --npm", tone: C.mutedFg },
  { at: 10, text: "Created the PostgreSQL database shop." },
  { at: 22, text: "   Creating a \"laravel/livewire-starter-kit\" project…" },
  { at: 40, text: "   INFO  Application ready in [shop]." },
  { at: 52, text: "Linked http://shop.test." },
  { at: 60, text: "Secured https://shop.test with HTTPS." },
  { at: 70, text: "Set APP_URL, MAIL_MAILER, DB_HOST, DB_PORT, DB_DATABASE in .env." },
  { at: 82, text: "Ready: https://shop.test", tone: C.emerald },
];

export function NewSite() {
  const frame = useCurrentFrame();
  const name = typed("shop", frame, 16, 10);
  const kit = frame >= KIT_AT ? 3 : 0;
  const db = frame >= DB_AT ? 2 : 0;
  const running = frame >= CREATE_AT + 4;
  const t = frame - CREATE_AT - 6;
  const cur = cursorAt(frame, [
    [4, 520, 470],
    [44, 594, 234],
    [KIT_AT + 14, 594, 234],
    [86, 700, 346],
    [DB_AT + 14, 700, 346],
    [120, 84, 423],
    [180, 600, 520],
  ]);
  return (
    <DemoFrame
      step="New site"
      title="A new Laravel app, ready to open."
      text="Pick a starter kit and a database. Zefaro runs the installer, links the site, adds HTTPS and fills in .env."
      shots={SHOTS}
      entrance="wipe"
      windowIn="tilt"
    >
      <AppWindow page="sites" title="Sites" sites={running && t > 52 ? 5 : 4} running={[8, 8]}>
        <div style={{ fontSize: 13, color: C.mutedFg, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="arrow-left" style={{ fontSize: 11 }} /> Sites
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, margin: "6px 0 16px" }}>New site</div>
        {!running ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Section title="Project">
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ width: 80, color: C.mutedFg, fontSize: 13 }}>Name</span>
                <span style={{ width: 240, height: 32, borderRadius: 8, border: `1px solid ${C.accent}`, display: "flex", alignItems: "center", padding: "0 10px", fontFamily: MONO, fontSize: 13 }}>
                  {name}
                  <span style={{ width: 1.5, height: 16, background: C.fg, marginLeft: 1, opacity: Math.floor(frame / 8) % 2 }} />
                </span>
                {name === "shop" && (
                  <span style={{ fontSize: 12, color: C.mutedFg, ...enter(frame, 50, 10, 6) }}>
                    Makes C:\Sites\shop, served at <Mono style={{ color: C.fg }}>http://shop.test</Mono>
                  </span>
                )}
              </div>
            </Section>
            <Section title="Starter kit">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                {KITS.map((k, i) => (
                  <Choice key={k.name} icon={k.icon} brand={k.brand} label={k.name} on={kit === i} pulse={i === 3 ? pop(frame, KIT_AT) : 1} pressed={i === 3 ? clickPress(frame, KIT_AT) : 0} />
                ))}
              </div>
            </Section>
            <Section title="Database">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {DBS.map((d, i) => (
                  <Choice key={d.name} icon={d.icon} label={d.name} on={db === i} pulse={i === 2 ? pop(frame, DB_AT) : 1} pressed={i === 2 ? clickPress(frame, DB_AT) : 0} />
                ))}
              </div>
            </Section>
            <div>
              <Button variant="primary" pressed={clickPress(frame, CREATE_AT)}>
                <Icon name="plus" /> Create site
              </Button>
            </div>
          </div>
        ) : (
          <Card style={{ overflow: "hidden", ...enter(frame, CREATE_AT + 4, 10, 10) }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
              <Mono>laravel new shop</Mono>
              <span style={{ marginLeft: "auto", color: t >= 82 ? C.emerald : C.mutedFg, display: "flex", alignItems: "center", gap: 6 }}>
                {t >= 82 ? (
                  <>
                    <Icon name="circle-check" /> Exit code 0
                  </>
                ) : (
                  <>
                    <Icon name="spinner" style={{ transform: `rotate(${frame * 12}deg)` }} /> Running
                  </>
                )}
              </span>
            </div>
            <div style={{ padding: "12px 14px", fontFamily: MONO, fontSize: 13, lineHeight: 1.75, minHeight: 300 }}>
              {LOG.filter((l) => t >= l.at).map((l) => (
                <div key={l.at} style={{ color: l.tone ?? C.fg, ...enter(frame, CREATE_AT + 6 + l.at, 8, 6) }}>
                  {l.text}
                </div>
              ))}
            </div>
            <div style={{ height: 3, background: C.muted }}>
              <div style={{ height: "100%", width: `${progress(frame, CREATE_AT + 6, CREATE_AT + 88) * 100}%`, background: t >= 82 ? C.emerald : C.accent }} />
            </div>
          </Card>
        )}
        <Cursor x={cur.x} y={cur.y} frame={frame} clicks={[KIT_AT, DB_AT, CREATE_AT]} />
      </AppWindow>
    </DemoFrame>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{title}</div>
      {children}
    </Card>
  );
}

function Choice(p: { icon: string; brand?: boolean; label: string; on: boolean; pulse: number; pressed: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 44,
        padding: "0 12px",
        borderRadius: 9,
        border: `1px solid ${p.on ? C.accent : C.border}`,
        background: p.on ? C.accentSoft : "transparent",
        fontSize: 13,
        fontWeight: 500,
        transform: `scale(${(1 - p.pressed * 0.04) * (p.on ? 0.96 + 0.04 * p.pulse : 1)})`,
      }}
    >
      <i className={`${p.brand ? "fa-brands" : "fa-solid"} fa-${p.icon}`} style={{ color: p.on ? C.accent : C.mutedFg, width: "1.1em", textAlign: "center" }} />
      {p.label}
    </div>
  );
}
