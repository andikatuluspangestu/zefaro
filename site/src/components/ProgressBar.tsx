import { motion, useScroll, useSpring } from "framer-motion";

/** A gradient line along the top edge that fills as you read down the page. */
export function ProgressBar() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });
  return <motion.div className="pbar" style={{ scaleX }} aria-hidden="true" />;
}
