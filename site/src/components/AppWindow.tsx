import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { usePrefs, useReduce } from "../prefs";
import { useReady } from "../ready";
import { WinChrome } from "./WinChrome";

type State = "stopped" | "starting" | "running";

const SERVICES = [
  { name: "nginx", icon: "server", brand: false, port: "127.0.0.1:80" },
  { name: "PHP 8.4", icon: "php", brand: true, port: "127.0.0.1:9084" },
  { name: "DNS", icon: "globe", brand: false, port: "*.test → 127.0.0.1" },
  { name: "MariaDB", icon: "database", brand: false, port: "127.0.0.1:3306" },
  { name: "Redis", icon: "layer-group", brand: false, port: "127.0.0.1:6379" },
  { name: "Mailpit", icon: "envelope", brand: false, port: "127.0.0.1:1025" },
];

/**
 * The Services page. When the hero is in view and the intro is over, Start all is pressed and each
 * service goes from stopped to running. The Replay button runs it again; nothing loops by itself.
 */
export function AppWindow() {
  const { t } = usePrefs();
  const ready = useReady();
  const reduce = useReduce();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.3 });
  const timers = useRef<number[]>([]);
  const [states, setStates] = useState<State[]>(() => SERVICES.map(() => "stopped"));
  const [pressed, setPressed] = useState(false);

  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
  const set = (i: number, s: State) => setStates((prev) => prev.map((p, j) => (j === i ? s : p)));

  const play = useCallback(() => {
    clear();
    if (reduce) {
      setStates(SERVICES.map(() => "running"));
      return;
    }
    setStates(SERVICES.map(() => "stopped"));
    later(900, () => setPressed(true));
    later(1100, () => setPressed(false));
    SERVICES.forEach((_, i) => {
      later(1200 + i * 280, () => set(i, "starting"));
      later(1200 + i * 280 + 950, () => set(i, "running"));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  useEffect(() => {
    if (seen && ready) play();
    return clear;
  }, [seen, ready, play]);

  const running = states.filter((s) => s === "running").length;

  return (
    <div ref={ref}>
      <WinChrome active="services" label={`${t.win.title}: ${t.win.heading}`}>
        <div style={{ padding: "16px 18px 18px" }}>
          <div className="win-head">
            <div>
              <h3>{t.win.heading}</h3>
              <p>{t.win.description}</p>
            </div>
            <span className="chip" aria-hidden="true">
              <span className={`dot${running ? " running" : ""}`} />
              {t.win.count(running, SERVICES.length)}
            </span>
          </div>
          <div className="svc-grid" aria-hidden="true">
            {SERVICES.map((s, i) => (
              <div className="svc" key={s.name}>
                <div className="svc-top">
                  <span className="svc-ico">
                    <i className={`${s.brand ? "fa-brands" : "fa-solid"} fa-${s.icon}`} />
                  </span>
                  <div>
                    <b>{s.name}</b>
                    <span className="svc-state">
                      <span className={`dot ${states[i]}`} />
                      {t.win.state[states[i]]}
                    </span>
                  </div>
                </div>
                <div className="svc-port mono">{s.port}</div>
                {states[i] === "starting" && (
                  <div className="bar">
                    <motion.span initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.95, ease: "easeInOut" }} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="win-foot">
            <span />
            <motion.span className="mini-btn" animate={{ scale: pressed ? 0.92 : 1 }} transition={{ duration: 0.12 }}>
              <i className="fa-solid fa-play" aria-hidden="true" /> {t.win.startAll}
            </motion.span>
          </div>
        </div>
      </WinChrome>
      <div className="win-foot" style={{ marginTop: 14 }}>
        <span>{t.win.note}</span>
        <button className="replay" onClick={play}>
          {t.win.replay}
        </button>
      </div>
    </div>
  );
}
