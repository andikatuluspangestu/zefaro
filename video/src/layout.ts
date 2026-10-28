import { useVideoConfig } from "remotion";

export type Kind = "landscape" | "portrait" | "feed";

/**
 * Which format is rendering, and the margins text must stay inside. Portrait keeps clear of
 * TikTok's and Reels' own buttons and captions (top bar, right-hand buttons, bottom caption).
 */
export function useLayout() {
  const { width, height } = useVideoConfig();
  const kind: Kind = width > height ? "landscape" : height / width > 1.5 ? "portrait" : "feed";
  const safe =
    kind === "portrait"
      ? { top: 230, bottom: 430, left: 90, right: 150 }
      : kind === "feed"
        ? { top: 70, bottom: 70, left: 72, right: 72 }
        : { top: 80, bottom: 80, left: 96, right: 72 };
  return { kind, width, height, safe };
}

/** Picks a value for the current format. */
export const pick = <T,>(kind: Kind, v: { landscape: T; portrait: T; feed: T }) => v[kind];
