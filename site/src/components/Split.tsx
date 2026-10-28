import { motion } from "framer-motion";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * A line of text whose words rise one after another out of their own mask. It plays when it
 * scrolls into view, or, with `when`, when that turns true.
 */
export function SplitWords({
  text,
  className,
  delay = 0,
  stagger = 0.055,
  when,
  wordClass,
}: {
  text: string;
  className?: string;
  /** A class for each word itself, for effects such as a gradient fill that cannot pass through the mask. */
  wordClass?: string;
  delay?: number;
  stagger?: number;
  when?: boolean;
}) {
  const words = text.split(" ");
  const shared = { initial: { y: "112%" } };
  return (
    <span className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} aria-hidden="true">
          <span className="sw">
            <motion.span
              className={wordClass}
              {...shared}
              {...(when === undefined
                ? { whileInView: { y: "0%" }, viewport: { once: true, margin: "0px 0px -60px 0px" } }
                : { animate: when ? { y: "0%" } : { y: "112%" } })}
              transition={{ duration: 0.8, delay: delay + i * stagger, ease: EASE }}
            >
              {w}
            </motion.span>
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}
