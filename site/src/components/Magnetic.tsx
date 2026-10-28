import { useRef, type ReactNode } from "react";
import { useReduce } from "../prefs";
import { motion, useMotionValue, useSpring } from "framer-motion";

/** The button leans toward the pointer as it comes close, then settles back. Mouse only. */
export function Magnetic({ children, strength = 0.28 }: { children: ReactNode; strength?: number }) {
  const reduce = useReduce();
  const ref = useRef<HTMLSpanElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 220, damping: 18, mass: 0.4 });
  const y = useSpring(my, { stiffness: 220, damping: 18, mass: 0.4 });

  const move = (e: React.PointerEvent) => {
    if (reduce || e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mx.set((e.clientX - (r.left + r.width / 2)) * strength);
    my.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const leave = () => {
    mx.set(0);
    my.set(0);
  };

  return (
    <motion.span ref={ref} style={{ x, y, display: "inline-block" }} onPointerMove={move} onPointerLeave={leave}>
      {children}
    </motion.span>
  );
}
