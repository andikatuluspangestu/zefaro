// Fifteen promotional mockups, each in three sizes: 1920 x 1080, 1080 x 1350 and 1080 x 1920.
// Each one shows one real feature of the app. Colours and crops change from image to image so
// the set reads as a series. Render them all with `npm run mockups` (out/mockups/<size>/*.png).

import type { ComponentType, ReactNode } from "react";
import { Logo } from "../components/Logo";
import { Icon, ServiceLogo } from "../components/ui";
import { type Kind, pick, useLayout } from "../layout";
import { C } from "../theme";
import { DISPLAY, Grad, Pill, Scaled, TONES } from "./Frame";
import { DownloadBar, Poster } from "./Poster";
import {
  ArtisanScreen,
  Browser,
  DataScreen,
  HomeScreen,
  Laptop,
  MailScreen,
  NewSiteScreen,
  OverviewScreen,
  ServicesScreen,
  SitesScreen,
  TinkerScreen,
  ToastCard,
  VersionsScreen,
} from "./Screens";

type Place = { x: number; y: number; s: number; crop?: number };

/** Where the app window goes in each size, unless a mockup says otherwise. */
const SHOT: Record<Kind, Place> = {
  landscape: { x: 850, y: 190, s: 0.95 },
  feed: { x: 28, y: 600, s: 0.93 },
  portrait: { x: 28, y: 900, s: 0.93 },
};

/** The app window, placed for the current size. `crop` hides that many pixels of its left side. */
function Shot({ children, at }: { children: ReactNode; at?: Partial<Record<Kind, Partial<Place>>> }) {
  const { kind } = useLayout();
  const p = { ...SHOT[kind], ...at?.[kind] };
  const crop = p.crop ?? 0;
  if (!crop) {
    return (
      <Scaled scale={p.s} style={{ left: p.x, top: p.y }}>
        {children}
      </Scaled>
    );
  }
  return (
    <div style={{ position: "absolute", left: p.x, top: p.y, width: (1100 - crop) * p.s, height: 700 * p.s, overflow: "hidden", borderRadius: 12 * p.s }}>
      <Scaled scale={p.s} style={{ left: -crop * p.s, top: 0 }}>
        {children}
      </Scaled>
    </div>
  );
}

const At = ({ x, y, w, children }: { x: number; y: number; w?: number; children: ReactNode }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w }}>{children}</div>
);

/** Wind paths, by size. */
const W = {
  low: {
    landscape: "M -120 980 C 380 1080, 640 640, 1080 760 S 1680 380, 2080 470",
    feed: "M -80 560 C 300 460, 640 640, 1160 480",
    portrait: "M -100 840 C 300 740, 680 920, 1180 780",
  },
  high: {
    landscape: "M -100 140 C 400 40, 900 300, 2040 120",
    feed: "M 1160 560 C 760 680, 380 460, -80 600",
    portrait: "M 1180 830 C 760 950, 380 730, -100 870",
  },
};

/* 01 · the hero, in a laptop */
export function M01Hero() {
  const { kind } = useLayout();
  const laptop = pick(kind, { landscape: { x: 900, y: 240, w: 980 }, feed: { x: 40, y: 700, w: 1000 }, portrait: { x: 40, y: 870, w: 1000 } });
  const pill = kind === "portrait" ? 26 : 22;
  return (
    <Poster
      title={
        <>
          Yet Another Local <Grad>Laravel</Grad> Tools
        </>
      }
      head={{ landscape: 120, feed: 110, portrait: 128 }}
      sub="A free, open-source local PHP development environment for Windows. Link a folder, open name.test."
      wind={{ ...W.low, feed: "M -80 1290 C 300 1190, 700 1350, 1160 1210" }}
      extra={
        <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
          <Pill size={pill}>
            <Icon name="heart" style={{ color: C.coral }} /> Free
          </Pill>
          <Pill size={pill}>
            <Icon name="code-branch" style={{ color: C.primary }} /> Open source, MIT
          </Pill>
          <Pill size={pill}>
            <Icon name="windows" brands style={{ color: C.primary }} /> Windows 10 and 11
          </Pill>
        </div>
      }
    >
      <At x={laptop.x} y={laptop.y}>
        <Laptop width={laptop.w}>
          <ServicesScreen />
        </Laptop>
      </At>
    </Poster>
  );
}

/* 02 · Home */
export function M02Home() {
  return (
    <Poster
      tone="pink"
      title={
        <>
          Everything at a <Grad>glance.</Grad>
        </>
      }
      sub="Home shows what is running, your sites and anything that needs attention. A fresh install gets a four-step checklist."
    >
      <Shot>
        <HomeScreen />
      </Shot>
    </Poster>
  );
}

/* 03 · Services */
export function M03Services() {
  return (
    <Poster
      title={
        <>
          Start everything with <Grad>one click.</Grad>
        </>
      }
      sub="nginx, PHP, DNS, MariaDB, PostgreSQL, Redis, phpMyAdmin and Mailpit. A service that crashes is restarted."
      wind={W.low}
    >
      <Shot at={{ feed: { y: 620 } }}>
        <ServicesScreen />
      </Shot>
    </Poster>
  );
}

/* 04 · Sites */
export function M04Sites() {
  return (
    <Poster
      tone="pink"
      title={
        <>
          Every folder gets its own <Grad>.test</Grad> address.
        </>
      }
      sub="Link a project and open it at name.test, subdomains included. Zefaro knows Laravel, Symfony, WordPress and more."
    >
      <Shot at={{ feed: { y: 610 } }}>
        <SitesScreen />
      </Shot>
    </Poster>
  );
}

/* 05 · HTTPS */
export function M05Https() {
  const { kind } = useLayout();
  const b = pick(kind, { landscape: { x: 900, y: 230, w: 920 }, feed: { x: 100, y: 560, w: 880 }, portrait: { x: 80, y: 900, w: 920 } });
  const toast = pick(kind, { landscape: { x: 860, y: 760 }, feed: { x: 56, y: 940 }, portrait: { x: 60, y: 1420 } });
  return (
    <Poster tone="indigo" title="HTTPS in one click." sub="Zefaro runs its own certificate authority. It can only sign for .test names, and PHP trusts it too.">
      <At x={b.x} y={b.y}>
        <Browser width={b.w} />
      </At>
      <At x={toast.x} y={toast.y}>
        <ToastCard title="Zefaro now serves shop over HTTPS" text="https://shop.test" style={{ fontSize: 18 }} />
      </At>
    </Poster>
  );
}

/* 06 · New site */
export function M06NewSite() {
  return (
    <Poster
      title={
        <>
          A new Laravel app, <Grad>ready to open.</Grad>
        </>
      }
      sub="Any official starter kit, SQLite, MariaDB or PostgreSQL, tests, Git and HTTPS. Zefaro links it for you."
      wind={W.high}
    >
      <Shot at={{ feed: { y: 640 }, portrait: { y: 940 } }}>
        <NewSiteScreen />
      </Shot>
    </Poster>
  );
}

/* 07 · Overview */
export function M07Overview() {
  return (
    <Poster
      title={
        <>
          Fix .env problems with a <Grad>button.</Grad>
        </>
      }
      sub="Wrong APP_URL, mail that never reaches Mailpit, a missing storage link: the site's page spots them and fixes them."
    >
      <Shot at={{ feed: { y: 620 }, portrait: { y: 900 } }}>
        <OverviewScreen />
      </Shot>
    </Poster>
  );
}

/* 08 · Tinker */
export function M08Tinker() {
  return (
    <Poster tone="ink" title="Tinker that remembers." sub="Variables stay between runs, with SQL timing, and database changes rolled back when you ask.">
      <Shot at={{ feed: { y: 560 } }}>
        <TinkerScreen />
      </Shot>
    </Poster>
  );
}

/* 09 · Data */
export function M09Data() {
  return (
    <Poster
      tone="pink"
      title={
        <>
          Browse your data, <Grad>safely.</Grad>
        </>
      }
      sub="Search, sort and filter every table. Read-only until you allow changes, and secrets show as dots."
    >
      <Shot at={{ landscape: { crop: 200, s: 1.1, x: 900 }, feed: { crop: 200, x: 0, y: 580, s: 1.2 }, portrait: { crop: 200, x: 0, y: 900, s: 1.2 } }}>
        <DataScreen />
      </Shot>
    </Poster>
  );
}

/* 10 · Artisan */
export function M10Artisan() {
  return (
    <Poster
      title={
        <>
          Artisan commands, <Grad>as forms.</Grad>
        </>
      }
      sub="Every argument and option on screen, with the command it will run. Commands that delete data ask first."
      wind={W.low}
    >
      <Shot>
        <ArtisanScreen />
      </Shot>
    </Poster>
  );
}

/* 11 · PHP versions */
export function M11Php() {
  const { kind } = useLayout();
  const big = pick(kind, { landscape: 200, feed: 230, portrait: 200 });
  return (
    <Poster
      title={
        <>
          <div style={{ fontWeight: 800, fontSize: big, lineHeight: 0.86, letterSpacing: "-0.02em", marginBottom: 24 }}>
            <Grad>7.4</Grad>
            <span style={{ color: C.mutedFg, fontWeight: 300 }}> → </span>
            <Grad>8.5</Grad>
          </div>
          Every PHP version, side by side.
        </>
      }
      head={{ landscape: 72, feed: 68, portrait: 82 }}
      sub="From the official Windows builds. Each site picks its own version, and each version keeps its own settings."
    >
      <Shot at={{ landscape: { y: 230 }, feed: { y: 640 }, portrait: { y: 1010 } }}>
        <VersionsScreen />
      </Shot>
    </Poster>
  );
}

/* 12 · Mail */
export function M12Mail() {
  return (
    <Poster
      tone="pink"
      title={
        <>
          Catch every email <Grad>your app sends.</Grad>
        </>
      }
      sub="Mailpit is built in, and PHP's mail() points at it. Search, attachments, links and an unread count."
      wind={W.low}
    >
      <Shot at={{ feed: { y: 630 } }}>
        <MailScreen />
      </Shot>
    </Poster>
  );
}

/* 13 · the stack */
const STACK = [
  { logo: "nginx", name: "nginx", tag: "web server" },
  { logo: "php", name: "PHP", tag: "7.4 to 8.5" },
  { logo: "dns", name: "DNS", tag: "*.test" },
  { logo: "mariadb", name: "MariaDB", tag: "11.8 LTS" },
  { logo: "postgresql", name: "PostgreSQL", tag: "18" },
  { logo: "redis", name: "Redis", tag: "8" },
  { logo: "phpmyadmin", name: "phpMyAdmin", tag: "5.2" },
  { logo: "mailpit", name: "Mailpit", tag: "mail catcher" },
  { logo: "nodejs", name: "Node.js", tag: "Current and LTS" },
];

export function M13Stack() {
  const { kind } = useLayout();
  const g = pick(kind, { landscape: { x: 900, y: 200, w: 924, logo: 56 }, feed: { x: 72, y: 560, w: 936, logo: 52 }, portrait: { x: 80, y: 880, w: 920, logo: 60 } });
  return (
    <Poster
      tone="ink"
      title={
        <>
          The whole stack, <Grad>in one window.</Grad>
        </>
      }
      sub="Each program is downloaded from its project's official source and checked against a hash."
    >
      <div style={{ position: "absolute", left: g.x, top: g.y, width: g.w, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {STACK.map((s) => (
          <div key={s.name} style={{ display: "flex", flexDirection: "column", gap: 14, padding: 22, borderRadius: 24, background: "oklch(1 0 0 / 6%)", border: "1px solid oklch(1 0 0 / 12%)" }}>
            <ServiceLogo name={s.logo} size={g.logo} />
            <div>
              <div style={{ fontWeight: 650, fontSize: kind === "portrait" ? 28 : 24, letterSpacing: "-0.02em" }}>{s.name}</div>
              <div style={{ fontSize: kind === "portrait" ? 20 : 17, color: TONES.ink.muted }}>{s.tag}</div>
            </div>
          </div>
        ))}
      </div>
    </Poster>
  );
}

/* 14 · what it leaves out */
export function M14Privacy() {
  const { kind } = useLayout();
  const lines = ["No accounts.", "No analytics.", "No AI.", "No cloud."];
  return (
    <Poster
      tone="pink"
      head={{ landscape: 112, feed: 140, portrait: 150 }}
      textWidth={{ landscape: 1700 }}
      title={
        <>
          {lines.map((l) => (
            <div key={l} style={{ position: "relative", width: "fit-content", color: "oklch(0.225 0.055 282 / 42%)" }}>
              {l}
              <span style={{ position: "absolute", left: "-0.05em", right: "-0.05em", top: "54%", height: "0.065em", borderRadius: 6, background: C.primary }} />
            </div>
          ))}
          <div style={{ marginTop: "0.25em", fontSize: "0.86em" }}>
            <Grad>Just Zefaro, on your computer.</Grad>
          </div>
        </>
      }
      sub="Every service listens on 127.0.0.1 only. Free and open source, MIT."
    >
      {kind === "landscape" && (
        <div style={{ position: "absolute", left: 1380, top: 300 }}>
          <Logo size={400} />
        </div>
      )}
    </Poster>
  );
}

/* 15 · install */
export function M15Install() {
  const { kind } = useLayout();
  const steps = [
    { t: "Run the installer", d: "No administrator rights needed." },
    { t: "Install PHP", d: "Pick a version on the Services page." },
    { t: "Start all, set up DNS", d: "Windows asks once, for the .test rule." },
    { t: "Link a folder", d: "Then open name.test in your browser." },
  ];
  const box = pick(kind, {
    landscape: { x: 1000, y: 200, w: 824, n: 84, t: 38, d: 25 },
    feed: { x: 72, y: 470, w: 936, n: 72, t: 34, d: 23 },
    portrait: { x: 80, y: 760, w: 920, n: 92, t: 40, d: 27 },
  });
  return (
    <Poster
      tone="ink"
      title={
        <>
          Up and running in <Grad>four steps.</Grad>
        </>
      }
      head={{ landscape: 112, feed: 96, portrait: 128 }}
    >
      <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w }}>
        {steps.map((s, i) => (
          <div key={s.t} style={{ display: "flex", gap: 28, alignItems: "center", padding: kind === "feed" ? "18px 0" : "24px 0", borderTop: "1px solid oklch(1 0 0 / 14%)" }}>
            <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: box.n, lineHeight: 1, width: box.n * 1.2, letterSpacing: "-0.05em" }}>
              <Grad>{String(i + 1).padStart(2, "0")}</Grad>
            </span>
            <span>
              <span style={{ display: "block", fontSize: box.t, fontWeight: 650, letterSpacing: "-0.025em" }}>{s.t}</span>
              <span style={{ display: "block", fontSize: box.d, color: TONES.ink.muted, marginTop: 4 }}>{s.d}</span>
            </span>
          </div>
        ))}
      </div>
      {kind === "landscape" && <DownloadBar tone="ink" style={{ left: 96, right: "auto", width: 740, top: 760 }} />}
      {kind === "feed" && <DownloadBar tone="ink" style={{ left: 72, right: 72, top: 1110 }} />}
    </Poster>
  );
}

const DESIGNS: { n: string; slug: string; component: ComponentType }[] = [
  { n: "01", slug: "Hero", component: M01Hero },
  { n: "02", slug: "Home", component: M02Home },
  { n: "03", slug: "Services", component: M03Services },
  { n: "04", slug: "Sites", component: M04Sites },
  { n: "05", slug: "Https", component: M05Https },
  { n: "06", slug: "NewSite", component: M06NewSite },
  { n: "07", slug: "Overview", component: M07Overview },
  { n: "08", slug: "Tinker", component: M08Tinker },
  { n: "09", slug: "Data", component: M09Data },
  { n: "10", slug: "Artisan", component: M10Artisan },
  { n: "11", slug: "Php", component: M11Php },
  { n: "12", slug: "Mail", component: M12Mail },
  { n: "13", slug: "Stack", component: M13Stack },
  { n: "14", slug: "Privacy", component: M14Privacy },
  { n: "15", slug: "Install", component: M15Install },
];

export const SIZES = [
  { tag: "1920x1080", width: 1920, height: 1080 },
  { tag: "1080x1920", width: 1080, height: 1920 },
  { tag: "1080x1350", width: 1080, height: 1350 },
];

/** Every design in every size: ids look like Mockup05Https-1080x1350. */
export const MOCKUPS = DESIGNS.flatMap((d) =>
  SIZES.map((sz) => ({ id: `Mockup${d.n}${d.slug}-${sz.tag}`, component: d.component, width: sz.width, height: sz.height })),
);
