import { useId } from "react";

const TILE =
  "M254 24 H770 C897 24 1000 127 1000 254 V770 C1000 897 897 1000 770 1000 H254 C127 1000 24 897 24 770 V254 C24 127 127 24 254 24 Z";

/** Zefaro's logo: a white Z on the coral, violet and indigo tile. Same artwork as public/zefaro.svg. */
export function Logo({ title = "Zefaro" }: { title?: string }) {
  const id = `zefaro-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 1024 1024" role="img" aria-label={title}>
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
      <path d={TILE} fill={`url(#${id}-bg)`} />
      <path d={TILE} fill={`url(#${id}-hi)`} />
      <path
        d="M296 336 H728 L296 688 H728"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="140"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${id}-shadow)`}
      />
    </svg>
  );
}
