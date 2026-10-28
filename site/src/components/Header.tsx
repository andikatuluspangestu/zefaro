import { useState } from "react";
import { motion, useMotionValueEvent, useScroll } from "framer-motion";
import { LINKS } from "../copy";
import { usePrefs } from "../prefs";
import { useReady } from "../ready";
import { Logo } from "./Logo";

/** Floats at the top, steps out of the way while you read down, and returns when you scroll up. */
export function Header() {
  const { t, dark, toggleTheme, toggleLang, reduce, toggleMotion } = usePrefs();
  const ready = useReady();
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);

  useMotionValueEvent(scrollY, "change", (v) => {
    const prev = scrollY.getPrevious() ?? 0;
    setHidden(v > prev && v > 240);
  });

  return (
    <motion.header
      className="hd"
      initial={{ y: "-130%" }}
      animate={{ y: ready && !hidden ? 0 : "-130%" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="wrap hd-in">
        <a className="brand" href="#top" aria-label="Zefaro">
          <Logo />
          Zefaro
        </a>
        <nav className="nav" aria-label="Sections">
          <a href="#inside">{t.nav.inside}</a>
          <a href="#story">{t.nav.story}</a>
          <a href="#tools">{t.nav.tools}</a>
          <a href="#install">{t.nav.how}</a>
          <a href="#faq">{t.nav.faq}</a>
        </nav>
        <div className="hd-end">
          <button className="icon-btn" onClick={toggleLang} aria-label={t.nav.lang} title={t.nav.lang}>
            {t.nav.langShort}
          </button>
          <button
            className="icon-btn"
            onClick={toggleMotion}
            aria-pressed={!reduce}
            aria-label={reduce ? t.nav.motionOn : t.nav.motionOff}
            title={reduce ? t.nav.motionOn : t.nav.motionOff}
          >
            <i className={`fa-solid ${reduce ? "fa-circle-play" : "fa-circle-pause"}`} aria-hidden="true" />
          </button>
          <button
            className="icon-btn"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
            }}
            aria-label={t.nav.theme}
            title={t.nav.theme}
            aria-pressed={dark}
          >
            <i className={`fa-solid ${dark ? "fa-sun" : "fa-moon"}`} aria-hidden="true" />
          </button>
          <a className="btn btn-primary" href={LINKS.download}>
            <i className="fa-solid fa-download" aria-hidden="true" />
            <span className="long">{t.nav.download}</span>
          </a>
        </div>
      </div>
    </motion.header>
  );
}
