import { useEffect, useRef } from "react";
import { motion, useMotionValue, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "framer-motion";
import { usePrefs, useReduce } from "../prefs";
import { useMediaQuery } from "../lib/hooks";
import { SplitWords } from "./Split";
import { Reveal } from "./Reveal";

const D = "M100 250 C 215 250, 215 110, 330 110 S 485 250, 600 250 S 755 110, 870 110 S 985 250, 1100 250";
const NODES = [
  { x: 100, y: 250, up: false },
  { x: 330, y: 110, up: true },
  { x: 600, y: 250, up: false },
  { x: 870, y: 110, up: true },
  { x: 1100, y: 250, up: false },
];
const ICONS: { icon: string; brand?: boolean }[] = [
  { icon: "window-maximize" },
  { icon: "windows", brand: true },
  { icon: "sitemap" },
  { icon: "server" },
  { icon: "php", brand: true },
];

function Lit({ p, at, brand, icon }: { p: MotionValue<number>; at: number; brand?: boolean; icon: string }) {
  const opacity = useTransform(p, [Math.max(0, at - 0.05), at], [0, 1]);
  return (
    <>
      <i className={`${brand ? "fa-brands" : "fa-solid"} fa-${icon}`} aria-hidden="true" />
      <motion.span className="on" style={{ opacity }}>
        <i className={`${brand ? "fa-brands" : "fa-solid"} fa-${icon}`} aria-hidden="true" />
      </motion.span>
    </>
  );
}

/** A packet travels the path from your browser to PHP as you scroll; each stop lights as it passes. */
function Wide() {
  const { t } = usePrefs();
  const reduce = useReduce();
  const ref = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.45"] });
  const p = useTransform(scrollYProgress, (v) => (reduce ? 1 : v));
  const px = useMotionValue(NODES[0].x);
  const py = useMotionValue(NODES[0].y);
  const left = useTransform(px, (v) => `${(v / 1200) * 100}%`);
  const top = useTransform(py, (v) => `${(v / 360) * 100}%`);

  const place = (v: number) => {
    const el = pathRef.current;
    if (!el) return;
    const pt = el.getPointAtLength(el.getTotalLength() * Math.min(1, Math.max(0, v)));
    px.set(pt.x);
    py.set(pt.y);
  };
  useMotionValueEvent(p, "change", place);
  useEffect(() => {
    place(p.get());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="path" ref={ref}>
      <svg viewBox="0 0 1200 360" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="wind" gradientUnits="userSpaceOnUse" x1="100" y1="0" x2="1100" y2="0">
            <stop offset="0" stopColor="#FF6082" />
            <stop offset="0.55" stopColor="#B26CFF" />
            <stop offset="1" stopColor="#705EFF" />
          </linearGradient>
        </defs>
        <path ref={pathRef} d={D} fill="none" stroke="var(--border)" strokeWidth="3" strokeDasharray="1 11" strokeLinecap="round" />
        <motion.path d={D} fill="none" stroke="url(#wind)" strokeWidth="5" strokeLinecap="round" style={{ pathLength: p }} />
      </svg>
      {t.flow.nodes.map((n, i) => (
        <div className={`pnode ${NODES[i].up ? "up" : "down"}`} key={n.name} style={{ left: `${(NODES[i].x / 1200) * 100}%`, top: `${(NODES[i].y / 360) * 100}%` }}>
          <div className="ico">
            <Lit p={p} at={i / 4} brand={ICONS[i].brand} icon={ICONS[i].icon} />
          </div>
          <div className="lab">
            <b>{n.name}</b>
            <span className="tx">{n.text}</span>
          </div>
        </div>
      ))}
      <motion.div className="packet" style={{ left, top }} aria-hidden="true" />
    </div>
  );
}

function Narrow() {
  const { t } = usePrefs();
  const reduce = useReduce();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.7", "end 0.6"] });
  const p = useTransform(scrollYProgress, (v) => (reduce ? 1 : v));
  return (
    <div className="vpath" ref={ref}>
      <motion.div className="vfill" style={{ scaleY: p }} aria-hidden="true" />
      {t.flow.nodes.map((n, i) => (
        <div className="vnode" key={n.name}>
          <div className="ico">
            <Lit p={p} at={i / 4} brand={ICONS[i].brand} icon={ICONS[i].icon} />
          </div>
          <div>
            <b>{n.name}</b>
            <span className="tx">{n.text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Flow() {
  const { t } = usePrefs();
  const wide = useMediaQuery("(min-width: 861px)");
  return (
    <section className="flow-sec" id="flow">
      <div className="wrap">
        <div className="flow-head">
          <h2 className="display">
            <SplitWords text={t.flow.title} />
          </h2>
          <Reveal>
            <p className="lead">{t.flow.text}</p>
          </Reveal>
        </div>
        {wide ? <Wide /> : <Narrow />}
        <div className="flow-notes">
          {t.flow.notes.map((n, i) => (
            <Reveal key={n.title} delay={i * 0.1}>
              <h3>{n.title}</h3>
              <p>{n.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
