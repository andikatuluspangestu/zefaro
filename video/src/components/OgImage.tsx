// The link preview for zefaro.pages.dev (site/public/og.png), 1200 x 630. Render it with
// `npm run og`, which writes straight into the site's public folder.

import { AbsoluteFill } from "remotion";
import { C, FONT, GRADIENT } from "../theme";
import { Logo } from "./Logo";

export function OgImage() {
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT, color: C.fg, padding: "60px 84px", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <Logo size={80} />
        <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1 }}>Zefaro</div>
      </div>
      <div>
        <div style={{ fontSize: 80, fontWeight: 700, letterSpacing: "-0.05em", lineHeight: 1.0, maxWidth: 900 }}>
          Yet Another Local Laravel Tools
        </div>
        <div style={{ marginTop: 24, width: 120, height: 8, borderRadius: 8, background: GRADIENT }} />
        <div style={{ marginTop: 24, fontSize: 30, color: C.mutedFg, letterSpacing: "-0.015em", lineHeight: 1.3 }}>
          A free, open-source local PHP development environment for Windows.
        </div>
      </div>
      <div style={{ fontSize: 28, color: C.mutedFg, fontWeight: 500 }}>zefaro.pages.dev</div>
    </AbsoluteFill>
  );
}
