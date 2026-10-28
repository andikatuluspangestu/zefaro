import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "framer-motion";
import { usePrefs, useReduce } from "../prefs";
import { WinChrome } from "./WinChrome";

const HOST = "shop.test";

function Tick({ p, i }: { p: MotionValue<number>; i: number }) {
  const scaleX = useTransform(p, [i * 0.25, (i + 1) * 0.25], [0, 1]);
  return (
    <span className="tick">
      <motion.span style={{ scaleX }} />
    </span>
  );
}

/**
 * One scroll, one site. The section is tall and its stage stays pinned; your scroll position is
 * the playhead. A folder drops into Sites, a browser opens the address, HTTPS goes on, and the
 * window turns into the site's own page. The captions on the left follow the same playhead.
 */
function StoryLive() {
  const { t } = usePrefs();
  const S = t.story;
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [stage, setStage] = useState(0);
  useMotionValueEvent(p, "change", (v) => setStage(v < 0.28 ? 0 : v < 0.52 ? 1 : v < 0.76 ? 2 : 3));

  // The window
  const winScale = useTransform(p, [0, 0.08, 0.8, 0.95], [0.9, 1, 1, 1.04]);
  const winRot = useTransform(p, [0, 0.08], [6, 0]);
  // The folder that drops in
  const chipY = useTransform(p, [0.04, 0.2], [-200, 0]);
  const chipOp = useTransform(p, [0.04, 0.09, 0.2, 0.26], [0, 1, 1, 0]);
  const chipScale = useTransform(p, [0.2, 0.26], [1, 0.5]);
  // Sites: empty state out, row in
  const emptyOp = useTransform(p, [0.18, 0.24], [1, 0]);
  const rowH = useTransform(p, [0.2, 0.28], [0, 60]);
  const rowOp = useTransform(p, [0.22, 0.28], [0, 1]);
  // The browser
  const bX = useTransform(p, [0.3, 0.4, 0.74, 0.82], ["118%", "0%", "0%", "118%"]);
  const bOp = useTransform(p, [0.3, 0.36, 0.74, 0.8], [0, 1, 1, 0]);
  const typedN = useTransform(p, [0.38, 0.48], [0, HOST.length]);
  const typed = useTransform(typedN, (v) => HOST.slice(0, Math.round(v)));
  const proto = useTransform(p, (v): string => (v < 0.6 ? "http://" : "https://"));
  const url = useTransform(p, (v) => (v < 0.6 ? "http://" : "https://") + HOST);
  const pageOp = useTransform(p, [0.46, 0.52], [0, 1]);
  const lockOpen = useTransform(p, [0.56, 0.6], [1, 0]);
  const lockShut = useTransform(p, [0.56, 0.6], [0, 1]);
  // Secure
  const btnScale = useTransform(p, [0.54, 0.57, 0.6], [1, 0.88, 1]);
  const secureOp = useTransform(p, [0.58, 0.6], [1, 0]);
  const securedOp = useTransform(p, [0.58, 0.6], [0, 1]);
  const toastY = useTransform(p, [0.6, 0.66, 0.72, 0.77], [28, 0, 0, 28]);
  const toastOp = useTransform(p, [0.6, 0.66, 0.72, 0.77], [0, 1, 1, 0]);
  // Inside the site
  const sitesOp = useTransform(p, [0.76, 0.82], [1, 0]);
  const overOp = useTransform(p, [0.78, 0.86], [0, 1]);
  const f0 = useTransform(p, [0.8, 0.86], [0, 1]);
  const f1 = useTransform(p, [0.83, 0.89], [0, 1]);
  const f2 = useTransform(p, [0.86, 0.92], [0, 1]);
  const f0y = useTransform(p, [0.8, 0.86], [24, 0]);
  const f1y = useTransform(p, [0.83, 0.89], [24, 0]);
  const f2y = useTransform(p, [0.86, 0.92], [24, 0]);
  const finds = [
    { op: f0, y: f0y, item: t.tools.overview.items[0] },
    { op: f1, y: f1y, item: t.tools.overview.items[1] },
    { op: f2, y: f2y, item: t.tools.overview.items[2] },
  ];

  return (
    <section className="story dark" id="story" ref={ref} style={{ height: "540vh" }}>
      <div className="story-stage">
        <>
          <div className="story-cap" style={{ paddingLeft: "max(32px, calc((100vw - var(--wrap)) / 2))" }}>
            <h2 className="story-title">{S.title}</h2>
            <div className="story-step" aria-live="polite">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={stage}
                  initial={{ opacity: 0, y: 36 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -36 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                >
                  <span className="story-n grad-text">{String(stage + 1).padStart(2, "0")}</span>
                  <h3>{S.steps[stage].title}</h3>
                  <p>{S.steps[stage].text}</p>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="ticks" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <Tick key={i} p={p} i={i} />
              ))}
            </div>
          </div>

          <div style={{ paddingRight: "max(32px, calc((100vw - var(--wrap)) / 2))", minWidth: 0 }}>
            <div className="scene">
              <motion.div style={{ position: "absolute", inset: 0, scale: winScale, rotateX: winRot, transformPerspective: 1400 }}>
                <WinChrome active="sites" label={`${t.win.title}: ${S.sites.heading}`}>
                  <motion.div className="layer" style={{ opacity: sitesOp }}>
                    <div className="win-head">
                      <div>
                        <h3>{S.sites.heading}</h3>
                        <p>{S.sites.description}</p>
                      </div>
                      <span className="mini-btn">
                        <i className="fa-solid fa-folder-plus" aria-hidden="true" /> {S.sites.link}
                      </span>
                    </div>
                    <div className="tbl-wrap">
                      <div className="tbl-head">
                        {S.sites.cols.map((c) => (
                          <span key={c}>{c}</span>
                        ))}
                      </div>
                      <div className="tbl-body">
                        <motion.div className="empty" style={{ opacity: emptyOp }}>
                          <i className="fa-solid fa-globe" aria-hidden="true" />
                          <b>{S.sites.emptyTitle}</b>
                          {S.sites.emptyText}
                        </motion.div>
                        <motion.div style={{ height: rowH, opacity: rowOp, overflow: "hidden" }}>
                      <div className="tbl-row" style={{ height: 60 }}>
                        <span>
                          <b>shop</b>
                          <motion.small className="mono">{url}</motion.small>
                        </span>
                        <span className="mono" style={{ fontSize: 11.5 }}>C:\Projects\shop</span>
                        <span><span className="pill">8.4</span></span>
                        <span style={{ position: "relative", height: 26 }}>
                          <motion.span className="mini-btn out" style={{ position: "absolute", left: 0, top: 0, opacity: secureOp, scale: btnScale }}>
                            <i className="fa-solid fa-lock-open" aria-hidden="true" /> {S.sites.secure}
                          </motion.span>
                          <motion.span className="mini-btn" style={{ position: "absolute", left: 0, top: 0, opacity: securedOp, background: "color-mix(in oklch, var(--success) 18%, transparent)", color: "var(--success)" }}>
                            <i className="fa-solid fa-lock" aria-hidden="true" /> {S.sites.secured}
                          </motion.span>
                        </span>
                      </div>
                        </motion.div>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div className="layer" style={{ opacity: overOp }}>
                    <div className="win-head">
                      <div>
                        <h3>shop</h3>
                        <p className="mono">https://{HOST}</p>
                      </div>
                      <span style={{ display: "flex", gap: 6 }}>
                        {S.site.chips.map((c) => (
                          <span className="chip" key={c}>{c}</span>
                        ))}
                      </span>
                    </div>
                    <h4 style={{ fontSize: 13, fontWeight: 600 }}>{t.tools.overview.heading}</h4>
                    {finds.map((f) => (
                      <motion.div className="find" key={f.item.title} style={{ opacity: f.op, y: f.y }}>
                        <b>{f.item.title}</b>
                        <p>{f.item.text}</p>
                        <span className="mini-btn">{f.item.action}</span>
                      </motion.div>
                    ))}
                  </motion.div>
                </WinChrome>
              </motion.div>

              <motion.div className="folder" style={{ y: chipY, opacity: chipOp, scale: chipScale }} aria-hidden="true">
                <i className="fa-solid fa-folder" /> C:\Projects\shop
              </motion.div>

              <motion.div className="browser" style={{ x: bX, opacity: bOp }} aria-hidden="true">
                <div className="addr">
                  <div className="addr-pill">
                    <span className="lock">
                      <motion.i className="fa-solid fa-lock-open" style={{ opacity: lockOpen, color: "var(--muted-foreground)" }} />
                      <motion.i className="fa-solid fa-lock" style={{ opacity: lockShut, color: "var(--success)" }} />
                    </span>
                    <span style={{ color: "var(--muted-foreground)" }}>
                      <motion.span>{proto}</motion.span>
                    </span>
                    <motion.span>{typed}</motion.span>
                  </div>
                </div>
                <motion.div className="page" style={{ opacity: pageOp }}>
                  <h4>{S.page.title}</h4>
                  <p>{S.page.text}</p>
                  <span className="mini-btn">{S.page.button}</span>
                  <div className="shapes"><span /><span /><span /></div>
                  <div className="foot mono">{S.page.foot}</div>
                </motion.div>
              </motion.div>

              <motion.div className="toast" style={{ y: toastY, opacity: toastOp }} aria-hidden="true">
                <i className="fa-solid fa-circle-check" /> {S.sites.toast}
              </motion.div>
            </div>
          </div>
        </>
      </div>
    </section>
  );
}

/** For visitors who ask for reduced motion: the same four steps as a plain list. */
function StoryStatic() {
  const { t } = usePrefs();
  return (
    <section className="story-static dark" id="story">
      <div className="wrap">
        <h2 className="display" style={{ fontSize: "clamp(2.2rem, 6vw, 4.4rem)" }}>{t.story.title}</h2>
        <ol>
          {t.story.steps.map((s, i) => (
            <li key={s.title}>
              <span className="story-n grad-text">{String(i + 1).padStart(2, "0")}</span>
              <h3 style={{ fontFamily: "var(--display)", fontSize: "1.8rem", letterSpacing: "-0.035em" }}>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Story() {
  const reduce = useReduce();
  return reduce ? <StoryStatic /> : <StoryLive />;
}
