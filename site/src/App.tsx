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
import { Guide } from "./components/Guide";
import { routeFor, type Route } from "./seo";

const SEEN = "zefaro-site.intro";

function seenIntro(): boolean {
  // Prerendered pages show the content itself, never the preloader.
  if (typeof window === "undefined") return true;
  try {
    return sessionStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}

function Page({ route }: { route: Route }) {
  const { t, reduce } = usePrefs();
  // Guides open straight on their text; the logo intro is for the home page.
  const [ready, setReady] = useState(() => reduce || !!route.guide || seenIntro());
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
      <a className="skip" href={route.guide ? "#guide" : "#inside"}>
        {t.nav.skip}
      </a>
      <Header />
      <main>
        {route.guide ? (
          <Guide guide={route.guide} />
        ) : (
          <>
            <Hero />
            <Marquee />
            <Stack />
            <Story />
            <Tools />
            <Flow />
            <NoBand />
            <Install />
            <Faq />
          </>
        )}
      </main>
      <Footer />
    </ReadyContext.Provider>
  );
}

/** Movement follows the system's setting until the visitor presses the play or pause button. */
function Gate({ route }: { route: Route }) {
  const { reduce } = usePrefs();
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "never"}>
      <Page route={route} />
    </MotionConfig>
  );
}

/** One page of the site, chosen by its URL path. */
export default function App({ path }: { path: string }) {
  const route = routeFor(path);
  return (
    <PrefsProvider lang={route.lang} path={route.path}>
      <Gate route={route} />
    </PrefsProvider>
  );
}
