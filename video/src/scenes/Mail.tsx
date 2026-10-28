import { useCurrentFrame } from "remotion";
import { pop, progress } from "../anim";
import { AppWindow } from "../components/AppWindow";
import { Cursor, cursorAt } from "../components/Cursor";
import { DemoFrame, WIDE as W, type Shot } from "../components/DemoFrame";
import { Badge, Button, Card, Icon, Mono } from "../components/ui";
import { C } from "../theme";

// Sample messages for the demo.
const OLD = [
  { from: "My App", subject: "Your order #1042 has shipped", time: "10:12" },
  { from: "My App", subject: "Welcome to My App", time: "09:58" },
  { from: "Newsletter", subject: "October product update", time: "Yesterday" },
];
const ARRIVE_AT = 50;
const OPEN_AT = 110;
const SHOTS: Shot[] = [
  [0, 1, W.x, W.y],
  [30, 1.6, 150, 83],
  [108, 1.35, 560, 300],
  [200, 1, W.x, W.y],
];

export function Mail() {
  const frame = useCurrentFrame();
  const arrived = frame >= ARRIVE_AT;
  const land = pop(frame, ARRIVE_AT);
  const open = frame >= OPEN_AT;
  const view = progress(frame, OPEN_AT, OPEN_AT + 12);
  const cur = cursorAt(frame, [
    [10, 520, 470],
    [98, 140, 74],
    [140, 140, 74],
    [180, 620, 300],
  ]);
  return (
    <DemoFrame
      step="Mail"
      title="Every email lands here."
      text="Mailpit catches what your app sends on 127.0.0.1:1025, so nothing reaches a real inbox."
      shots={SHOTS}
      entrance="iris"
      windowIn="zoom"
    >
      <AppWindow page="mail" title="Mail" sites={4} running={[7, 7]} unread={arrived && !open ? 1 : 0}>
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          {/* Inbox */}
          <div style={{ width: 300, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: 10, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ height: 30, borderRadius: 8, border: `1px solid ${C.input}`, display: "flex", alignItems: "center", gap: 8, padding: "0 10px", color: C.mutedFg, fontSize: 12.5 }}>
                <Icon name="magnifying-glass" /> Search, e.g. from:shop is:unread
              </div>
            </div>
            {arrived && (
              <div style={{ height: 64 * land, overflow: "hidden" }}>
                <Message
                  from="My App"
                  subject="Reset your password"
                  time="10:31"
                  unread={!open}
                  selected={open}
                  glow={1 - progress(frame, ARRIVE_AT, ARRIVE_AT + 40)}
                />
              </div>
            )}
            {OLD.map((m) => (
              <Message key={m.subject} {...m} />
            ))}
          </div>
          {/* Message */}
          <div style={{ flex: 1, padding: 20, minWidth: 0 }}>
            {!open ? (
              <div style={{ height: "100%", display: "grid", placeItems: "center", color: C.mutedFg, fontSize: 13 }}>Select a message to read it.</div>
            ) : (
              <div style={{ opacity: view, transform: `translateY(${(1 - view) * 8}px)` }}>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Reset your password</div>
                <div style={{ marginTop: 6, fontSize: 12.5, color: C.mutedFg, lineHeight: 1.6 }}>
                  From <span style={{ color: C.fg }}>My App &lt;hello@my-app.test&gt;</span>
                  <br />
                  To <span style={{ color: C.fg }}>dev@example.test</span>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
                  {["HTML", "Text", "Headers", "Source"].map((t, i) => (
                    <span key={t} style={{ padding: "4px 10px", borderRadius: 7, fontSize: 12.5, background: i === 0 ? C.muted : "transparent", color: i === 0 ? C.fg : C.mutedFg }}>
                      {t}
                    </span>
                  ))}
                </div>
                <Card style={{ marginTop: 12, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <Icon name="link" style={{ color: C.mutedFg }} />
                  <span style={{ color: C.mutedFg }}>1 link in this email.</span>
                  <Mono style={{ color: C.sky, fontSize: 12 }}>http://my-app.test/reset-password/…</Mono>
                </Card>
                <div style={{ marginTop: 12, borderRadius: 10, background: "#fafafa", color: "#18181b", padding: "26px 28px", fontSize: 14, lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>My App</div>
                  <p style={{ margin: "12px 0" }}>You asked to reset your password. Click the button below to choose a new one.</p>
                  <span style={{ display: "inline-block", background: "#18181b", color: "#fff", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600 }}>
                    Reset password
                  </span>
                  <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "#71717a" }}>This link expires in 60 minutes.</p>
                </div>
              </div>
            )}
          </div>
          <div style={{ position: "absolute", top: 12, right: 16, display: "flex", gap: 6 }}>
            <Badge tone="emerald">
              <Icon name="circle" style={{ fontSize: 6 }} /> Mailpit running
            </Badge>
            <Button size="xs">
              <Icon name="arrow-up-right-from-square" /> Open Mailpit
            </Button>
          </div>
        </div>
        <Cursor x={cur.x} y={cur.y} frame={frame} clicks={[OPEN_AT]} />
      </AppWindow>
    </DemoFrame>
  );
}

function Message(m: { from: string; subject: string; time: string; unread?: boolean; selected?: boolean; glow?: number }) {
  return (
    <div
      style={{
        height: 64,
        boxSizing: "border-box",
        padding: "10px 14px",
        borderBottom: `1px solid ${C.border}`,
        background: m.selected ? C.muted : `oklch(0.673 0.213 303 / ${12 * (m.glow ?? 0)}%)`,
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {m.unread && <span style={{ width: 7, height: 7, borderRadius: 99, background: C.primary }} />}
        <span style={{ fontWeight: m.unread ? 650 : 500 }}>{m.from}</span>
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.mutedFg }}>{m.time}</span>
      </div>
      <div style={{ marginTop: 4, color: m.unread ? C.fg : C.mutedFg, fontWeight: m.unread ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {m.subject}
      </div>
    </div>
  );
}
