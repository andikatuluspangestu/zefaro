import { useRef } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform } from "framer-motion";
import { LINKS } from "../copy";
import { usePrefs, useReduce } from "../prefs";
import { useReady } from "../ready";
import { AppWindow } from "./AppWindow";
import { Magnetic } from "./Magnetic";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Rows of the headline: which words sit together, and which one carries the gradient. */
const ROWS = [[0, 1], [2, 3], [4]];
const GRADIENT_WORD = 3;

export function Hero() {
  const { t } = usePrefs();
  const ready = useReady();
  const reduce = useReduce();
  const ref = useRef<HTMLElement>(null);
  const words = t.hero.title.split(" ");

  // Scroll: the headline drifts up slower than the window, and the gradient slides across "Laravel".
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const headY = useTransform(p, [0, 1], [0, reduce ? 0 : -90]);
  const winY = useTransform(p, [0, 1], [0, reduce ? 0 : -150]);
  const gradX = useTransform(p, [0, 1], ["0%", "100%"]);

  // Pointer: the window tilts a few degrees toward the cursor.
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const rotX = useSpring(rx, { stiffness: 120, damping: 16 });
  const rotY = useSpring(ry, { stiffness: 120, damping: 16 });
  const tilt = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduce || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    ry.set(((e.clientX - r.left) / r.width - 0.5) * 9);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * 7);
  };
  const flat = () => {
    rx.set(0);
    ry.set(0);
  };

  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 26 },
    animate: ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 26 },
    transition: { duration: 0.8, delay, ease: EASE },
  });

  return (
    <section className="hero" id="top" ref={ref}>
      <div className="wrap">
        <motion.h1 className="display" aria-label={t.hero.title} style={{ y: headY }}>
          {ROWS.map((row, r) => (
            <span className="row" key={r} aria-hidden="true">
              {row.map((wi, k) => {
                const grad = wi === GRADIENT_WORD;
                return (
                  <span key={wi}>
                    <span className="sw">
                      <motion.span
                        className={`stretch${grad ? " grad-text" : ""}`}
                        style={grad ? { backgroundPositionX: gradX } : undefined}
                        initial={{ y: "112%" }}
                        animate={ready ? { y: "0%" } : { y: "112%" }}
                        transition={{ duration: 0.95, delay: 0.1 + (r * 2 + k) * 0.09, ease: EASE }}
                      >
                        {words[wi]}
                      </motion.span>
                    </span>
                    {k < row.length - 1 ? " " : ""}
                  </span>
                );
              })}
            </span>
          ))}
        </motion.h1>

        <div className="hero-low">
          <div className="hero-copy">
            <motion.p className="lead" {...rise(0.65)}>
              {t.hero.lead}
            </motion.p>
            <motion.div className="hero-actions" {...rise(0.8)}>
              <Magnetic>
                <a className="btn btn-primary btn-lg" href={LINKS.download}>
                  <i className="fa-brands fa-windows" aria-hidden="true" />
                  {t.hero.cta}
                </a>
              </Magnetic>
              <a className="link" href={LINKS.repo}>
                {t.hero.source}
              </a>
            </motion.div>
            <motion.p className="hero-meta" {...rise(0.95)}>
              {t.hero.meta}
            </motion.p>
          </div>
          <motion.div style={{ y: winY }}>
            <motion.div
              className="tilt"
              initial={{ opacity: 0, y: 70, scale: 0.96 }}
              animate={ready ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 70, scale: 0.96 }}
              transition={{ duration: 1.1, delay: 0.5, ease: EASE }}
              onPointerMove={tilt}
              onPointerLeave={flat}
            >
              <motion.div style={{ rotateX: rotX, rotateY: rotY }}>
                <AppWindow />
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
