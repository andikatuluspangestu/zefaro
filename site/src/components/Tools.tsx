import { useRef, useState } from "react";
import { easeInOut, motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "framer-motion";
import { usePrefs, useReduce } from "../prefs";
import { SplitWords } from "./Split";
import { Reveal } from "./Reveal";
import { TABS, ToolPanel, type TabId } from "./ToolPanels";

function Slide({ id, i, width }: { id: TabId; i: number; width?: string }) {
  const { t } = usePrefs();
  const tab = t.tools.tabs[id];
  return (
    <div className="tools-slide" style={width ? { flexBasis: width } : undefined}>
      <div>
        <span className="idx">
          {String(i + 1).padStart(2, "0")} / {String(TABS.length).padStart(2, "0")}
        </span>
        <h3>{tab.label}</h3>
        <p className="cap">{tab.caption}</p>
      </div>
      <div className="panel">
        <div className="panel-in">
          <ToolPanel id={id} />
        </div>
      </div>
    </div>
  );
}

function Dot({ p, i, n }: { p: MotionValue<number>; i: number; n: number }) {
  const scaleX = useTransform(p, [(i / n) * 0.9, ((i + 1) / n) * 0.95], [i === 0 ? 0.15 : 0, 1]);
  return (
    <span className="tick" style={{ width: 40 }}>
      <motion.span style={{ scaleX }} />
    </span>
  );
}

/**
 * Seven tabs, one gallery. The section is tall and its stage stays pinned: scrolling down slides
 * the slides sideways. With reduced motion they are simply stacked.
 */
function ToolsLive() {
  const { t } = usePrefs();
  const n = TABS.length;
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  // Each slide holds still for a while, then the track glides to the next.
  const share = 1 / n;
  const stops: number[] = [];
  const places: string[] = [];
  TABS.forEach((_, i) => {
    const place = `${-(i / n) * 100}%`;
    stops.push(i * share, i === n - 1 ? 1 : i * share + share * 0.55);
    places.push(place, place);
  });
  const x = useTransform(p, stops, places, { ease: easeInOut });
  const [active, setActive] = useState(0);
  useMotionValueEvent(p, "change", (v) => setActive(Math.min(n - 1, Math.floor(v * n))));

  return (
    <div ref={ref} style={{ height: `${n * 72}vh` }}>
      <div className="tools-stage">
        <motion.div className="tools-track" style={{ x, width: `${n * 100}%` }}>
          {TABS.map((id, i) => (
            <Slide key={id} id={id} i={i} width={`${100 / n}%`} />
          ))}
        </motion.div>
        <div className="tools-dots" aria-hidden="true">
          <div className="wrap">
            {TABS.map((id, i) => (
              <Dot key={id} p={p} i={i} n={n} />
            ))}
            <span className="lbl">{t.tools.tabs[TABS[active]].label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Tools() {
  const { t } = usePrefs();
  const reduce = useReduce();
  return (
    <section className="tools" id="tools">
      <div className="wrap tools-intro">
        <h2 className="display" style={{ maxWidth: "12em" }}>
          <SplitWords text={t.tools.title} />
        </h2>
        <Reveal>
          <p className="lead">{t.tools.text}</p>
          <p className="muted" style={{ marginTop: 12, fontSize: "0.9rem" }}>{t.tools.sample}</p>
        </Reveal>
      </div>
      {reduce ? (
        <div className="wrap tools-static">
          {TABS.map((id, i) => (
            <Slide key={id} id={id} i={i} />
          ))}
        </div>
      ) : (
        <ToolsLive />
      )}
    </section>
  );
}
