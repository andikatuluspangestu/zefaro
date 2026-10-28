import { useCurrentFrame } from "remotion";
import { pop } from "../anim";
import { AppWindow, PageTitle } from "../components/AppWindow";
import { Cursor, clickPress, cursorAt } from "../components/Cursor";
import { DemoFrame, WIDE as W, type Shot } from "../components/DemoFrame";
import { Button, Card, Dot, Icon, Mono, ServiceLogo } from "../components/ui";
import { C } from "../theme";

// Lands on the music's first drop (see MUSIC_OFFSET in Root.tsx).
export const START_AT = 60;
const SHOTS: Shot[] = [
  [0, 1, W.x, W.y],
  [30, 1.6, 790, 53],
  [74, 1, W.x, W.y],
  [170, 1.3, 300, 190],
];

const SERVICES = [
  { logo: "nginx", name: "nginx", detail: "127.0.0.1:80" },
  { logo: "php", name: "PHP 8.4", detail: "127.0.0.1:9084" },
  { logo: "dns", name: "DNS", detail: "*.test → 127.0.0.1" },
  { logo: "mariadb", name: "MariaDB", detail: "127.0.0.1:3306" },
  { logo: "postgresql", name: "PostgreSQL", detail: "127.0.0.1:5432" },
  { logo: "redis", name: "Redis", detail: "127.0.0.1:6379" },
  { logo: "phpmyadmin", name: "phpMyAdmin", detail: "phpmyadmin.test" },
  { logo: "mailpit", name: "Mailpit", detail: "127.0.0.1:1025" },
  { logo: "nodejs", name: "Node.js", detail: "v24 active", tool: true },
];

/** Frames after Start all at which service `i` reports starting, then running. */
const startOf = (i: number) => START_AT + 8 + i * 6;
const runOf = (i: number) => startOf(i) + 16;

export function Services() {
  const frame = useCurrentFrame();
  const running = SERVICES.filter((s, i) => !s.tool && frame >= runOf(i)).length;
  const cur = cursorAt(frame, [
    [6, 360, 420],
    [50, 790, 53],
    [110, 790, 53],
    [160, 600, 520],
  ]);
  return (
    <DemoFrame
      step="Services"
      title="Start everything with one click."
      text="Web server, PHP, DNS, MariaDB, PostgreSQL, Redis and Mailpit. If one crashes, Zefaro restarts it."
      shots={SHOTS}
      windowIn="tilt"
    >
      <AppWindow page="services" title="Services" sites={3} running={[running, 8]}>
        <PageTitle
          title="Services"
          description="Start and stop the background services your sites depend on."
          actions={
            <Button variant="primary" pressed={clickPress(frame, START_AT)}>
              <Icon name="play" /> Start all
            </Button>
          }
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {SERVICES.map((s, i) => {
            const state = s.tool ? "running" : frame >= runOf(i) ? "running" : frame >= startOf(i) ? "starting" : "stopped";
            const land = s.tool ? 0 : pop(frame, runOf(i));
            const color = state === "running" ? C.emerald : state === "starting" ? C.amber : C.mutedFg;
            return (
              <Card key={s.name} style={{ padding: 12, height: 118, display: "flex", flexDirection: "column", gap: 10, boxSizing: "border-box" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <ServiceLogo name={s.logo} live={state !== "stopped"} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 600 }}>
                      {s.name}
                      <span style={{ transform: `scale(${1 + 0.5 * land * (1 - land)})` }}>
                        <Dot color={color} />
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: C.mutedFg }}>
                      {s.tool ? "Tool" : state === "running" ? "Running" : state === "starting" ? "Starting" : "Stopped"}
                    </div>
                  </div>
                </div>
                <Mono style={{ fontSize: 11.5, color: C.mutedFg }}>{s.detail}</Mono>
                <div style={{ marginTop: "auto" }}>
                  <Button size="xs" style={{ width: "100%", justifyContent: "center", boxSizing: "border-box" }}>
                    {s.tool ? (
                      <>
                        <Icon name="layer-group" /> Manage versions
                      </>
                    ) : state === "stopped" ? (
                      <>
                        <Icon name="play" /> Start
                      </>
                    ) : (
                      <>
                        <Icon name="stop" /> Stop
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
        <Cursor x={cur.x} y={cur.y} frame={frame} clicks={[START_AT]} />
      </AppWindow>
    </DemoFrame>
  );
}
