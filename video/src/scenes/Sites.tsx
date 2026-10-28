import type { ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { pop, progress } from "../anim";
import { AppWindow, PageTitle } from "../components/AppWindow";
import { Cursor, clickPress, cursorAt } from "../components/Cursor";
import { DemoFrame, WIDE as W, type Shot } from "../components/DemoFrame";
import { Toast } from "../components/Toast";
import { Badge, Button, Card, Icon, Mono } from "../components/ui";
import { C } from "../theme";

const COLS = "1.2fr 1.5fr 70px 110px 70px";
const LINK_AT = 80;
const SECURE_AT = 165;
const SHOTS: Shot[] = [
  [0, 1, W.x, W.y],
  [52, 1.55, 790, 53],
  [118, 1.55, 678, 329],
  [205, 1, W.x, W.y],
];

export function Sites() {
  const frame = useCurrentFrame();
  const linked = frame >= LINK_AT + 6;
  const secured = frame >= SECURE_AT + 4;
  const row = pop(frame, LINK_AT + 6);
  const cur = cursorAt(frame, [
    [20, 420, 420],
    [72, 790, 53],
    [112, 790, 53],
    [155, 678, 329],
    [205, 678, 329],
    [255, 110, 338],
  ]);
  return (
    <DemoFrame
      step="Sites"
      title="Link a folder. Open name.test."
      text="Zefaro serves each linked folder at its own .test address. HTTPS is one click per site."
      shots={SHOTS}
      entrance="whip"
      windowIn="rise"
    >
      <AppWindow page="sites" title="Sites" sites={linked ? 4 : 3} running={[7, 7]}>
        <PageTitle
          title="Sites"
          description="Zefaro serves each linked folder at its own name.test address."
          actions={
            <Button variant="primary" pressed={clickPress(frame, LINK_AT)}>
              <Icon name="folder-plus" /> Link folder
            </Button>
          }
        />
        <Card style={{ overflow: "hidden" }}>
          <Row head>
            <span>Site</span>
            <span>Path</span>
            <span>PHP</span>
            <span>HTTPS</span>
            <span style={{ textAlign: "right" }}>Actions</span>
          </Row>
          <SiteRow name="blog" url="http://blog.test" path="C:\Projects\blog" php="8.3" secured={false} />
          <SiteRow name="shop" url="https://shop.test" path="C:\Projects\shop" php="8.2" secured />
          <SiteRow name="docs" url="http://docs.test" path="C:\Projects\docs" php="8.4" secured={false} />
          {linked && (
            <div style={{ opacity: row, transform: `translateY(${(1 - row) * -8}px)`, background: `oklch(0.56 0.215 277 / ${6 * (1 - progress(frame, LINK_AT + 20, LINK_AT + 50))}%)` }}>
              <SiteRow
                name="my-app"
                url={secured ? "https://my-app.test" : "http://my-app.test"}
                path="C:\Projects\my-app"
                php="8.4"
                secured={secured}
                pressed={clickPress(frame, SECURE_AT)}
                glow={secured ? 1 - progress(frame, SECURE_AT + 4, SECURE_AT + 40) : 0}
              />
            </div>
          )}
        </Card>
        <Toast frame={frame} at={LINK_AT + 8} until={SECURE_AT - 6} title="Linked my-app" description="http://my-app.test" />
        <Toast frame={frame} at={SECURE_AT + 6} until={SECURE_AT + 90} title="Zefaro now serves my-app over HTTPS" />
        <Cursor x={cur.x} y={cur.y} frame={frame} clicks={[LINK_AT, SECURE_AT]} />
      </AppWindow>
    </DemoFrame>
  );
}

function Row({ children, head }: { children: ReactNode; head?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: COLS,
        alignItems: "center",
        gap: 12,
        padding: head ? "0 16px" : "0 16px",
        height: head ? 38 : 58,
        borderBottom: `1px solid ${C.border}`,
        fontSize: head ? 12.5 : 13.5,
        color: head ? C.mutedFg : C.fg,
        fontWeight: head ? 500 : 400,
      }}
    >
      {children}
    </div>
  );
}

function SiteRow(p: { name: string; url: string; path: string; php: string; secured: boolean; pressed?: number; glow?: number }) {
  return (
    <Row>
      <span style={{ lineHeight: 1.35 }}>
        <span style={{ fontWeight: 600 }}>{p.name}</span>
        <br />
        <Mono style={{ color: p.secured ? C.emerald : C.mutedFg, fontSize: 12 }}>{p.url}</Mono>
      </span>
      <span style={{ color: C.mutedFg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.path}</span>
      <Badge style={{ justifySelf: "start" }}>{p.php}</Badge>
      <span>
        {p.secured ? (
          <Button size="xs" variant="secondary" style={{ color: C.emerald, boxShadow: `0 0 0 ${4 * (p.glow ?? 0)}px oklch(0.8 0.16 160 / ${30 * (p.glow ?? 0)}%)` }}>
            <Icon name="lock" /> Secured
          </Button>
        ) : (
          <Button size="xs" pressed={p.pressed}>
            <Icon name="lock-open" /> Secure
          </Button>
        )}
      </span>
      <span style={{ display: "flex", justifyContent: "flex-end", gap: 14, color: C.mutedFg, fontSize: 13 }}>
        <Icon name="arrow-up-right-from-square" />
        <Icon name="trash-can" />
      </span>
    </Row>
  );
}
