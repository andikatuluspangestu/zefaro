import { progress } from "../anim";
import { C } from "../theme";
import { Icon } from "./ui";

/** A sonner-style toast in the bottom-right of the window, shown between `at` and `until`. */
export function Toast({ frame, at, until, title, description }: { frame: number; at: number; until: number; title: string; description?: string }) {
  const p = Math.min(progress(frame, at, at + 10), 1 - progress(frame, until - 8, until));
  if (p <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        right: 20,
        bottom: 20,
        width: 330,
        display: "flex",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 10,
        background: C.card,
        border: `1px solid ${C.input}`,
        boxShadow: `0 12px 30px -10px ${C.shadow}`,
        opacity: p,
        transform: `translateY(${(1 - p) * 14}px)`,
        fontSize: 13,
      }}
    >
      <Icon name="circle-check" style={{ color: C.emerald, marginTop: 2 }} />
      <div>
        <div style={{ fontWeight: 500 }}>{title}</div>
        {description && <div style={{ color: C.mutedFg, marginTop: 2, fontSize: 12.5 }}>{description}</div>}
      </div>
    </div>
  );
}
