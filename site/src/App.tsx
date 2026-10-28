import { useCallback, useState } from "react";
import { AnimatePresence, MotionConfig } from "framer-motion";
import { PrefsProvider, usePrefs } from "./prefs";
import { ReadyContext } from "./ready";
import { Smooth } from "./components/Smooth";
import { ProgressBar } from "./components/ProgressBar";
import { Preloader } from "./components/Preloader";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Marquee } from "./components/Marquee";
import { Stack } from "./components/Stack";
import { Story } from "./components/Story";
import { Tools } from "./components/Tools";
import { Flow } from "./components/Flow";
import { NoBand } from "./components/NoBand";
import { Install } from "./components/Install";
import { Faq } from "./components/Faq";
import { Footer } from "./components/Footer";

const SEEN = "zefaro-site.intro";

function seenIntro(): boolean {
  try {
    return sessionStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}

function Page() {
  const { t, reduce } = usePrefs();
  const [ready, setReady] = useState(() => reduce || seenIntro());
  const done = useCallback(() => {
    try {
      sessionStorage.setItem(SEEN, "1");
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  return (
    <ReadyContext.Provider value={ready}>
      <Smooth />
      <ProgressBar />
      <AnimatePresence>{!ready && <Preloader key="pre" onDone={done} />}</AnimatePresence>
      <a className="skip" href="#inside">
        {t.nav.skip}
      </a>
      <Header />
      <main>
        <Hero />
        <Marquee />
        <Stack />
        <Story />
        <Tools />
        <Flow />
        <NoBand />
        <Install />
        <Faq />
      </main>
      <Footer />
    </ReadyContext.Provider>
  );
}

/** Movement follows the system's setting until the visitor presses the play or pause button. */
function Gate() {
  const { reduce } = usePrefs();
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "never"}>
      <Page />
    </MotionConfig>
  );
}

export default function App() {
  return (
    <PrefsProvider>
      <Gate />
    </PrefsProvider>
  );
}
