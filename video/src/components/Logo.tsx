import { useId } from "react";

const TILE = "M254 24 H770 C897 24 1000 127 1000 254 V770 C1000 897 897 1000 770 1000 H254 C127 1000 24 897 24 770 V254 C24 127 127 24 254 24 Z";

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Zefaro's logo, the same artwork as src-tauri/icons/app-icon.svg. `build` (0 → 1) draws it
 * in: the tile scales up, then the Z is written in one stroke, top bar, diagonal, bottom bar.
 */
export function Logo({ size, build = 1 }: { size: number; build?: number }) {
  const id = `zefaro-${useId().replace(/:/g, "")}`;
  const part = (from: number, to: number) => Math.min(1, Math.max(0, (build - from) / (to - from)));
  const tile = ease(part(0, 0.4));
  const stroke = ease(part(0.3, 0.95));
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={`${id}-bg`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1024" y2="1024">
          <stop offset="0" stopColor="#FF6082" />
          <stop offset="0.55" stopColor="#B26CFF" />
          <stop offset="1" stopColor="#705EFF" />
        </linearGradient>
        <radialGradient id={`${id}-hi`} gradientUnits="userSpaceOnUse" cx="260" cy="180" r="620">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.28" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="18" stdDeviation="12" floodColor="#2A1470" floodOpacity="0.35" />
        </filter>
      </defs>
      <g style={{ transformOrigin: "512px 512px", transform: `scale(${0.8 + 0.2 * tile})`, opacity: tile }}>
        <path d={TILE} fill={`url(#${id}-bg)`} />
        <path d={TILE} fill={`url(#${id}-hi)`} />
      </g>
      {stroke > 0 && (
        <path
          d="M296 336 H728 L296 688 H728"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="140"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - stroke}
          filter={`url(#${id}-shadow)`}
        />
      )}
    </svg>
  );
}
