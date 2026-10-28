import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrefs } from "../prefs";
import { SplitWords } from "./Split";
import { Reveal } from "./Reveal";

/** The programs Zefaro runs. A name opens its details when you point at it, or tap it. */
export function Stack() {
  const { t } = usePrefs();
  const [open, setOpen] = useState(0);
  return (
    <section className="sec-tight" id="inside">
      <div className="wrap">
        <div className="stack-head">
          <h2 className="display">
            <SplitWords text={t.inside.title} />
          </h2>
          <Reveal>
            <p className="lead">{t.inside.text}</p>
          </Reveal>
        </div>
        <ul className="stack-list">
          {t.inside.rows.map((r, i) => {
            const isOpen = open === i;
            return (
              <li key={r.name} className={`stack-item${isOpen ? " open" : ""}`}>
                <h3 style={{ font: "inherit", margin: 0 }}>
                  <button
                    className="stack-btn"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(i)}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(i)}
                    onFocus={() => setOpen(i)}
                  >
                    <span className="no">{String(i + 1).padStart(2, "0")}</span>
                    <span className="nm">{r.name}</span>
                    <span className="tg">{r.tag}</span>
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      className="stack-more"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <p>{r.text}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
