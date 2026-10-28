import { useEffect } from "react";
import { motion } from "framer-motion";

const TILE =
  "M254 24 H770 C897 24 1000 127 1000 254 V770 C1000 897 897 1000 770 1000 H254 C127 1000 24 897 24 770 V254 C24 127 127 24 254 24 Z";

/** The logo draws itself once, then the screen lifts away. Shown on the first visit of a session. */
export function Preloader({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 1250);
    return () => window.clearTimeout(id);
  }, [onDone]);

  return (
    <motion.div
      className="pre"
      role="status"
      aria-label="Zefaro"
      initial={{ clipPath: "inset(0 0 0% 0)" }}
      exit={{ clipPath: "inset(0 0 100% 0)", transition: { duration: 0.75, ease: [0.76, 0, 0.24, 1] } }}
    >
      <svg viewBox="0 0 1024 1024" aria-hidden="true">
        <defs>
          <linearGradient id="pre-bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1024" y2="1024">
            <stop offset="0" stopColor="#FF6082" />
            <stop offset="0.55" stopColor="#B26CFF" />
            <stop offset="1" stopColor="#705EFF" />
          </linearGradient>
        </defs>
        <motion.path
          d={TILE}
          fill="url(#pre-bg)"
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformOrigin: "512px 512px" }}
        />
        <motion.path
          d="M296 336 H728 L296 688 H728"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="140"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, delay: 0.3, ease: "easeInOut" }}
        />
      </svg>
    </motion.div>
  );
}
