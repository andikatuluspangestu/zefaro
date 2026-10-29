import { useId, useState } from "react";
import { motion } from "framer-motion";
import { LINKS } from "../copy";
import { usePrefs } from "../prefs";
import { Reveal } from "./Reveal";
import { SplitWords } from "./Split";

export function Faq() {
  const { t } = usePrefs();
  const uid = useId();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="sec-tight" id="faq">
      <div className="wrap faq">
        <div className="faq-head">
          <h2 className="display">
            <SplitWords text={t.faq.title} />
          </h2>
          <Reveal>
            <p>
              {t.faq.text.split("GitHub")[0]}
              <a className="link" href={LINKS.issues}>
                GitHub
              </a>
              {t.faq.text.split("GitHub")[1]}
            </p>
          </Reveal>
        </div>
        <Reveal delay={0.08}>
          <div>
            {t.faq.items.map((it, i) => {
              const isOpen = open === i;
              return (
                <div className="qa" key={it.q}>
                  <h3>
                    <button
                      id={`${uid}-q${i}`}
                      aria-expanded={isOpen}
                      aria-controls={`${uid}-a${i}`}
                      onClick={() => setOpen(isOpen ? null : i)}
                    >
                      {it.q}
                      <i className="fa-solid fa-plus" aria-hidden="true" />
                    </button>
                  </h3>
                  {/* Every answer stays in the page (closed ones at zero height), so search
                      engines and crawlers read all of them. */}
                  <motion.div
                    className="ans"
                    id={`${uid}-a${i}`}
                    role="region"
                    aria-labelledby={`${uid}-q${i}`}
                    aria-hidden={!isOpen}
                    initial={false}
                    animate={isOpen ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    <div>{it.a}</div>
                  </motion.div>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
