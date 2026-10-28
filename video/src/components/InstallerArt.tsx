// The NSIS installer's bitmaps (src-tauri/installer/sidebar.bmp and header.bmp), drawn from
// the logo. Render them with `npm run installer-art`, which also converts them to BMP.

import { AbsoluteFill } from "remotion";
import { FONT } from "../theme";
import { Logo } from "./Logo";

/** 164 x 314: the welcome and finish pages' left panel. */
export function InstallerSidebar() {
  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #1b1830 0%, #100e1d 100%)",
        fontFamily: FONT,
        color: "oklch(0.965 0.014 335)",
        alignItems: "center",
        paddingTop: 66,
      }}
    >
      <Logo size={76} />
      <div style={{ marginTop: 16, fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em" }}>Zefaro</div>
      <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.45, color: "oklch(0.745 0.04 300)", textAlign: "center" }}>
        Yet Another
        <br />
        Local Laravel Tools
      </div>
      <div style={{ marginTop: 16, width: 22, height: 3, borderRadius: 2, background: "linear-gradient(90deg, #FF6082, #B26CFF, #705EFF)" }} />
    </AbsoluteFill>
  );
}

/** 150 x 57: the inner pages' header, on white. */
export function InstallerHeader() {
  return (
    <AbsoluteFill style={{ background: "#FFFFFF", justifyContent: "center", paddingLeft: 14 }}>
      <Logo size={38} />
    </AbsoluteFill>
  );
}
