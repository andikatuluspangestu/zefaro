import { useEffect } from "react";
import { useReduce } from "../prefs";
import Lenis from "lenis";

/**
 * Smooth, eased scrolling for wheel and trackpad (Lenis). The scroll position stays the
 * browser's own, so the scroll-linked animations read it as usual. Off for visitors who ask
 * for reduced motion.
 */
export function Smooth() {
  const reduce = useReduce();
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ lerp: 0.09, anchors: { offset: -80 } });
    let frame = requestAnimationFrame(function loop(time) {
      lenis.raf(time);
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, [reduce]);
  return null;
}
