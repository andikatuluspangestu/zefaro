import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { usePrefs, useReduce } from "../prefs";

/** The stack's names, huge, sliding sideways in step with your scroll. They stop when you stop. */
export function Marquee() {
  const { t } = usePrefs();
  const reduce = useReduce();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const a = useTransform(p, [0, 1], reduce ? ["0%", "0%"] : ["4%", "-38%"]);
  const b = useTransform(p, [0, 1], reduce ? ["0%", "0%"] : ["-38%", "4%"]);
  const names = t.inside.rows.map((r) => r.name);
  const row = (filled: boolean, key: string) =>
    [...names, ...names].map((n, i) => (
      <span key={`${key}-${i}`} className={filled ? "fill" : undefined}>
        {n} <i aria-hidden="true">·</i>
      </span>
    ));

  return (
    <div className="marq" ref={ref} aria-hidden="true">
      <motion.div className="marq-row" style={{ x: a }}>
        {row(false, "a")}
      </motion.div>
      <motion.div className="marq-row" style={{ x: b }}>
        {row(true, "b")}
      </motion.div>
    </div>
  );
}
