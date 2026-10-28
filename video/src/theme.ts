// Colours and type from the app's light theme (src/styles.css, :root) and DESIGN.md.
// Palette: coral #FF6082, pink #FFE4F6, violet #B26CFF, indigo #705EFF.

export const C = {
  bg: "oklch(0.985 0.012 340)",
  card: "oklch(1 0 0)",
  sidebar: "oklch(0.968 0.022 338)",
  muted: "oklch(0.946 0.038 338)",
  fg: "oklch(0.225 0.055 282)",
  fg85: "oklch(0.225 0.055 282 / 85%)",
  mutedFg: "oklch(0.47 0.05 290)",
  border: "oklch(0.9 0.035 320)",
  input: "oklch(0.88 0.04 320)",
  /** Fills (buttons, badges, bars): indigo. Text on it is `onPrimary`. */
  primary: "oklch(0.56 0.215 277)",
  onPrimary: "oklch(0.99 0.005 330)",
  /** Accent for text, strokes and outlines on the light background: violet. */
  accent: "oklch(0.55 0.23 295)",
  accentSoft: "oklch(0.56 0.215 277 / 10%)",
  coral: "oklch(0.6 0.2 12)",
  pink: "oklch(0.946 0.038 338)",
  emerald: "oklch(0.5 0.13 160)",
  amber: "oklch(0.52 0.12 65)",
  sky: "oklch(0.5 0.215 295)",
  /** Hairlines and shadows are violet-tinted ink, not black. */
  line: "oklch(0.3 0.1 290 / 12%)",
  shadow: "rgb(60 30 120 / 30%)",
};

/** The brand gradient: coral to violet to indigo. */
export const GRADIENT = "linear-gradient(135deg, #FF6082 0%, #B26CFF 55%, #705EFF 100%)";

export const FONT = "'Geist Variable', system-ui, sans-serif";
export const MONO = "ui-monospace, 'Cascadia Mono', Consolas, monospace";

export const FPS = 30;
/** Seconds to frames. */
export const s = (sec: number) => Math.round(sec * FPS);
