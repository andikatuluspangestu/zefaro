import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { LINKS } from "../copy";
import { guides } from "../guides";
import { usePrefs, useReduce } from "../prefs";
import { Logo } from "./Logo";

export function Footer() {
  const { t, path, home } = usePrefs();
  const f = t.footer;
  const reduce = useReduce();
  const ref = useRef<HTMLDivElement>(null);
  // The wordmark gets heavier, and rises, as it comes into view.
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const settings = useTransform(p, (v) => `"wght" ${reduce ? 800 : Math.round(300 + 500 * v)}`);
  const y = useTransform(p, [0, 1], [reduce ? 0 : 80, 0]);

  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-top">
          <div>
            <a className="brand" href={path === home ? "#top" : home} aria-label="Zefaro">
              <Logo />
              Zefaro
            </a>
            <p style={{ marginTop: 10 }}>{f.line}</p>
            <p style={{ marginTop: 6 }}>{f.legal}</p>
          </div>
          <ul>
            <li><a href={LINKS.repo}>{f.links.github}</a></li>
            <li><a href={LINKS.download}>{f.links.releases}</a></li>
            <li><a href={LINKS.changelog}>{f.links.changelog}</a></li>
            <li><a href={LINKS.issues}>{f.links.issues}</a></li>
            <li><a href={LINKS.license}>{f.links.license}</a></li>
          </ul>
        </div>
        <nav className="footer-guides" aria-label={f.guides}>
          <span>{f.guides}</span>
          {guides.map((g) => (
            <a key={g.id} href={g.path} hrefLang="id">
              {g.label}
            </a>
          ))}
        </nav>
        <div ref={ref} className="mega-wrap" aria-hidden="true">
          <motion.div className="mega grad-text" style={{ fontVariationSettings: settings, y }}>
            Zefaro
          </motion.div>
        </div>
      </div>
    </footer>
  );
}
