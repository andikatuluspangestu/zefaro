// Every page the site has, and what search engines and AI crawlers read about each: title,
// description, canonical and language alternates, Open Graph, and schema.org data. The
// prerender script (scripts/prerender.mjs) writes these into each page's static HTML.

import { copy, LINKS, REPO } from "./copy";
import { guides, GUIDE_UPDATED, type Guide } from "./guides";

export const SITE = "https://zefaro.pages.dev";
export const VERSION = "1.1.0";
export const FILE_SIZE = "3.2 MB";

export type Lang = "en" | "id";
export type Route = { path: string; lang: Lang; guide: Guide | null };

export const routes: Route[] = [
  { path: "/", lang: "en", guide: null },
  { path: "/id/", lang: "id", guide: null },
  ...guides.map((g) => ({ path: g.path, lang: "id" as const, guide: g })),
];

/** The page for a URL path; unknown paths get the English home page. */
export function routeFor(pathname: string): Route {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return routes.find((r) => r.path === path) ?? routes[0];
}

export const homePath = (lang: Lang) => (lang === "id" ? "/id/" : "/");

const HOME = {
  en: {
    title: "Zefaro: free local PHP and Laravel environment for Windows",
    description:
      "Free, open-source local PHP and Laravel environment for Windows, an alternative to XAMPP and Laragon. Open projects at name.test with PHP, HTTPS and databases.",
  },
  id: {
    title: "Zefaro: Alternatif XAMPP dan Laragon Gratis untuk Windows",
    description:
      "Aplikasi gratis dan open source untuk PHP dan Laravel di Windows. Alternatif XAMPP dan Laragon yang cocok untuk mahasiswa IT. Buka proyek di nama.test.",
  },
};

const APP_DESCRIPTION = {
  en: "A free, open-source local PHP development environment for Windows: PHP 7.4 to 8.5 side by side, nginx, sites at name.test with one-click HTTPS, MariaDB, PostgreSQL, Redis, phpMyAdmin, Mailpit, and tools for Laravel apps.",
  id: "Lingkungan pengembangan PHP lokal yang gratis dan open source untuk Windows: PHP 7.4 sampai 8.5 berdampingan, nginx, situs di nama.test dengan HTTPS satu klik, MariaDB, PostgreSQL, Redis, phpMyAdmin, Mailpit, dan alat untuk aplikasi Laravel.",
};

const FEATURES = {
  en: [
    "PHP 7.4 to 8.5 side by side, chosen per site",
    "Sites at name.test with one-click HTTPS",
    "MariaDB, PostgreSQL, Redis and phpMyAdmin",
    "Mailpit catches every email apps send",
    "Laravel site tools: Tinker, Artisan, data browser, logs, workers",
    "New site wizard for Laravel, WordPress, plain PHP and dev servers",
    "Import projects and databases from XAMPP or Laragon",
    "dump() viewer and one-click Xdebug",
  ],
  id: [
    "PHP 7.4 sampai 8.5 berdampingan, dipilih per situs",
    "Situs di nama.test dengan HTTPS satu klik",
    "MariaDB, PostgreSQL, Redis, dan phpMyAdmin",
    "Mailpit menangkap semua email aplikasi",
    "Alat situs Laravel: Tinker, Artisan, penjelajah data, log, worker",
    "Wizard situs baru untuk Laravel, WordPress, PHP biasa, dan dev server",
    "Impor proyek dan database dari XAMPP atau Laragon",
    "Penampil dump() dan Xdebug sekali klik",
  ],
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export function titleOf(r: Route) {
  return r.guide ? r.guide.title : HOME[r.lang].title;
}
export function descriptionOf(r: Route) {
  return r.guide ? r.guide.description : HOME[r.lang].description;
}

function schema(r: Route) {
  const url = SITE + r.path;
  const app = {
    "@type": "SoftwareApplication",
    "@id": `${SITE}/#app`,
    name: "Zefaro",
    alternateName: "Yet Another Local Laravel Tools",
    description: APP_DESCRIPTION[r.lang],
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Local web development environment",
    operatingSystem: "Windows 10, Windows 11",
    softwareVersion: VERSION,
    fileSize: FILE_SIZE,
    license: "https://opensource.org/license/mit",
    isAccessibleForFree: true,
    url: `${SITE}/`,
    downloadUrl: LINKS.download,
    installUrl: LINKS.download,
    releaseNotes: LINKS.changelog,
    codeRepository: REPO,
    screenshot: `${SITE}/og.png`,
    image: `${SITE}/og.png`,
    featureList: FEATURES[r.lang],
    keywords:
      r.lang === "id"
        ? "alternatif xampp, alternatif laragon, aplikasi untuk mahasiswa IT, PHP lokal, Laravel, Windows"
        : "XAMPP alternative, Laragon alternative, local PHP, Laravel, Windows development environment",
    author: { "@type": "Organization", name: "Zefaro contributors", url: REPO },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const page: Record<string, unknown> = {
    "@type": r.guide ? "Article" : "WebPage",
    "@id": `${url}#page`,
    url,
    name: titleOf(r),
    description: descriptionOf(r),
    inLanguage: r.lang === "id" ? "id-ID" : "en",
    isPartOf: { "@id": `${SITE}/#website` },
    about: { "@id": `${SITE}/#app` },
    primaryImageOfPage: `${SITE}/og.png`,
  };
  if (r.guide) {
    Object.assign(page, {
      headline: r.guide.h1,
      datePublished: GUIDE_UPDATED,
      dateModified: GUIDE_UPDATED,
      author: { "@type": "Organization", name: "Zefaro contributors", url: REPO },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Zefaro", item: `${SITE}/id/` },
          { "@type": "ListItem", position: 2, name: r.guide.label, item: url },
        ],
      },
    });
  }
  const faqItems = r.guide ? r.guide.faq : copy[r.lang].faq.items;
  const faq = {
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    mainEntity: faqItems.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const website = {
    "@type": "WebSite",
    "@id": `${SITE}/#website`,
    url: `${SITE}/`,
    name: "Zefaro",
    inLanguage: ["en", "id-ID"],
  };
  return { "@context": "https://schema.org", "@graph": [website, app, page, faq] };
}

/** Everything that goes in <head> for one page. */
export function headFor(r: Route): string {
  const url = SITE + r.path;
  const title = titleOf(r);
  const description = descriptionOf(r);
  const alternates = r.guide
    ? [`<link rel="alternate" hreflang="id" href="${url}" />`]
    : [
        `<link rel="alternate" hreflang="en" href="${SITE}/" />`,
        `<link rel="alternate" hreflang="id" href="${SITE}/id/" />`,
        `<link rel="alternate" hreflang="x-default" href="${SITE}/" />`,
      ];
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />`,
    `<link rel="canonical" href="${url}" />`,
    ...alternates,
    `<meta property="og:type" content="${r.guide ? "article" : "website"}" />`,
    `<meta property="og:site_name" content="Zefaro" />`,
    `<meta property="og:locale" content="${r.lang === "id" ? "id_ID" : "en_US"}" />`,
    `<meta property="og:locale:alternate" content="${r.lang === "id" ? "en_US" : "id_ID"}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITE}/og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Zefaro" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${SITE}/og.png" />`,
    `<script type="application/ld+json">${json(schema(r))}</script>`,
  ].join("\n    ");
}

/** sitemap.xml: every page, with its language alternates. */
export function sitemap(today: string): string {
  const alt = (r: Route) =>
    r.guide
      ? ""
      : `\n    <xhtml:link rel="alternate" hreflang="en" href="${SITE}/" />` +
        `\n    <xhtml:link rel="alternate" hreflang="id" href="${SITE}/id/" />` +
        `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/" />`;
  const urls = routes
    .map((r) => `  <url>\n    <loc>${SITE}${r.path}</loc>\n    <lastmod>${r.guide ? GUIDE_UPDATED : today}</lastmod>${alt(r)}\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}

/** llms-full.txt: the site's text as Markdown, for language models that read it whole. */
export function llmsFull(): string {
  const md = (r: Route) => {
    const g = r.guide!;
    const blocks = g.sections
      .map((s) => {
        const body = s.blocks
          .map((b) =>
            "p" in b
              ? b.p
              : "list" in b
                ? b.list.map((i) => `- ${i}`).join("\n")
                : "steps" in b
                  ? b.steps.map((i, n) => `${n + 1}. ${i}`).join("\n")
                  : [
                      `| ${b.table.head.join(" | ")} |`,
                      `|${b.table.head.map(() => " --- ").join("|")}|`,
                      ...b.table.rows.map((row) => `| ${row.join(" | ")} |`),
                    ].join("\n"),
          )
          .join("\n\n");
        return `### ${s.h2}\n\n${body}`;
      })
      .join("\n\n");
    const faq = g.faq.map((f) => `**${f.q}**\n${f.a}`).join("\n\n");
    return `## ${g.h1}\n\nURL: ${SITE}${g.path}\n\n${g.lead}\n\n${blocks}\n\n### Pertanyaan umum\n\n${faq}`;
  };
  const faqEn = copy.en.faq.items.map((f) => `**${f.q}**\n${f.a}`).join("\n\n");
  return [
    `# Zefaro\n\n> ${APP_DESCRIPTION.en}\n\nWebsite: ${SITE}/ (English), ${SITE}/id/ (Bahasa Indonesia)\nDownload: ${LINKS.download}\nSource: ${REPO} (MIT License)\nVersion: ${VERSION}, installer ${FILE_SIZE}, Windows 10 and 11 (64-bit)\n\nZefaro has no accounts, no analytics, no AI features and no cloud features. Every service listens on 127.0.0.1 only. It is an independent project, not affiliated with Laravel.`,
    `## Features\n\n${FEATURES.en.map((f) => `- ${f}`).join("\n")}`,
    `## FAQ\n\n${faqEn}`,
    ...routes.filter((r) => r.guide).map(md),
  ].join("\n\n") + "\n";
}
