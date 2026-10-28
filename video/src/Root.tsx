import "@fontsource-variable/geist";
import "@fortawesome/fontawesome-free/css/all.css";
import { useEffect, useState, type ReactNode } from "react";
import { AbsoluteFill, Audio, Composition, Sequence, continueRender, delayRender, interpolate, staticFile } from "remotion";
import { InstallerHeader, InstallerSidebar } from "./components/InstallerArt";
import { OgImage } from "./components/OgImage";
import { OVERLAP, SceneJoin } from "./components/SceneShell";
import { Features } from "./scenes/Features";
import { Hook } from "./scenes/Hook";
import { Intro } from "./scenes/Intro";
import { Mail } from "./scenes/Mail";
import { NewSite } from "./scenes/NewSite";
import { Orbit } from "./scenes/Orbit";
import { Outro } from "./scenes/Outro";
import { Principles } from "./scenes/Principles";
import { START_AT, Services } from "./scenes/Services";
import { Sites } from "./scenes/Sites";
import { Toolkit } from "./scenes/Toolkit";
import { Versions } from "./scenes/Versions";
import { C, FPS, s } from "./theme";

/** Scenes in order, with their lengths in seconds (85 s in total). */
const SCENES = [
  { id: "hook", sec: 4.5, el: <Hook /> },
  { id: "intro", sec: 4.5, el: <Intro /> },
  { id: "orbit", sec: 6, el: <Orbit /> },
  { id: "services", sec: 9, el: <Services /> },
  { id: "sites", sec: 8, el: <Sites /> },
  { id: "new-site", sec: 9, el: <NewSite /> },
  { id: "toolkit", sec: 11.5, el: <Toolkit /> },
  { id: "versions", sec: 6, el: <Versions /> },
  { id: "mail", sec: 7, el: <Mail /> },
  { id: "features", sec: 6.5, el: <Features /> },
  { id: "principles", sec: 4.5, el: <Principles /> },
  { id: "outro", sec: 8.5, el: <Outro /> },
];

const TOTAL = SCENES.reduce((n, sc) => n + s(sc.sec), 0);

/** Where a scene starts, in frames. */
const startOf = (id: string) => {
  let f = 0;
  for (const sc of SCENES) {
    if (sc.id === id) return f;
    f += s(sc.sec);
  }
  return 0;
};

/**
 * "Corporate Startup Promo" by alex-morgan (Pixabay Content License, not registered with
 * Content ID). The track's first drop is at 18.85 s; the offset puts it on the Start all
 * click in the Services scene.
 */
const MUSIC = staticFile("music/startup-promo.mp3");
const DROP = 18.85;
const MUSIC_OFFSET = DROP - (startOf("services") + START_AT) / FPS;

/** Holds the render until the web fonts (Geist, Font Awesome) are ready. */
function Fonts({ children }: { children: ReactNode }) {
  const [handle] = useState(() => delayRender("Loading fonts"));
  useEffect(() => {
    Promise.all([
      document.fonts.load("600 20px 'Geist Variable'"),
      document.fonts.load("900 20px 'Font Awesome 7 Free'"),
      document.fonts.load("400 20px 'Font Awesome 7 Brands'"),
    ])
      .then(() => document.fonts.ready)
      .finally(() => continueRender(handle));
  }, [handle]);
  return <>{children}</>;
}

function ZefaroPromo() {
  return (
    <Fonts>
      <AbsoluteFill style={{ background: C.bg }}>
        <Audio
          src={MUSIC}
          trimBefore={s(MUSIC_OFFSET)}
          volume={(f) =>
            interpolate(f, [0, s(0.6), TOTAL - s(3), TOTAL], [0, 0.8, 0.8, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
          }
        />
        {SCENES.map((sc, i) => {
          const from = SCENES.slice(0, i).reduce((n, p) => n + s(p.sec), 0);
          const tail = i < SCENES.length - 1 ? OVERLAP : 0;
          return (
            <Sequence key={sc.id} from={from} durationInFrames={s(sc.sec) + tail} name={sc.id}>
              <SceneJoin.Provider value={{ first: i === 0, tail }}>{sc.el}</SceneJoin.Provider>
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </Fonts>
  );
}

/** The same video in three formats; every scene adapts its layout to the frame size. */
export function Root() {
  return (
    <>
      <Composition id="ZefaroPromo" component={ZefaroPromo} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
      <Composition id="ZefaroPromoVertical" component={ZefaroPromo} durationInFrames={TOTAL} fps={FPS} width={1080} height={1920} />
      <Composition id="ZefaroPromoFeed" component={ZefaroPromo} durationInFrames={TOTAL} fps={FPS} width={1080} height={1350} />
      <Composition id="InstallerSidebar" component={InstallerSidebar} durationInFrames={1} fps={FPS} width={164} height={314} />
      <Composition id="OgImage" component={OgImage} durationInFrames={1} fps={FPS} width={1200} height={630} />
      <Composition id="InstallerHeader" component={InstallerHeader} durationInFrames={1} fps={FPS} width={150} height={57} />
    </>
  );
}
