import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { usePrefs, useReduce } from "../prefs";
import { Reveal } from "./Reveal";
import { SplitWords } from "./Split";

/** A line that is struck through, and dims, as it passes the middle of the screen. */
function NoLine({ text }: { text: string }) {
  const reduce = useReduce();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: q } = useScroll({ target: ref, offset: ["start 0.78", "start 0.4"] });
  const scaleX = useTransform(q, (v) => (reduce ? 1 : v));
  const opacity = useTransform(q, [0, 1], [1, reduce ? 1 : 0.4]);
  return (
    <motion.div className="no-line" ref={ref} style={{ opacity }}>
      {text}
      <motion.span className="strike" style={{ scaleX }} aria-hidden="true" />
    </motion.div>
  );
}

/** The four things Zefaro does not do, struck out one by one, then what it is. */
export function NoBand() {
  const { t } = usePrefs();
  return (
    <section className="no-sec" id="privacy">
      <div className="wrap">
        <h2 className="sr-only">{t.privacy.title}</h2>
        <div className="no-lines">
          {t.no.lines.map((l) => (
            <NoLine key={l} text={l} />
          ))}
          <div className="no-line no-final">
            <SplitWords text={t.no.final} wordClass="grad-text" stagger={0.07} />
          </div>
        </div>
        <div className="no-grid">
          <Reveal>
            <p className="lead">{t.privacy.lead}</p>
          </Reveal>
          <Reveal delay={0.1}>
            <ul>
              {t.privacy.items.map((it) => (
                <li key={it.title}>
                  <i className="fa-solid fa-check" aria-hidden="true" />
                  <div>
                    <b>{it.title}</b>
                    <span>{it.text}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
