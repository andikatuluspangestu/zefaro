// After `vite build`: render every page to static HTML, so search engines and AI crawlers that
// don't run JavaScript read the full text, and each page gets its own title, description,
// canonical, language alternates and schema.org data. Also writes sitemap.xml and
// llms-full.txt (the whole text as Markdown, for language models).
//
// dist/index.html                      English home
// dist/id/index.html                   Indonesian home
// dist/id/<guide>/index.html           Indonesian guides

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const server = join(root, "dist-ssr");
const { render, routes, headFor, sitemap, llmsFull } = await import(pathToFileURL(join(server, "entry-server.js")).href);

const template = readFileSync(join(dist, "index.html"), "utf8");
const SEO = /<!--seo:start-->[\s\S]*?<!--seo:end-->/;
if (!SEO.test(template) || !template.includes('<div id="root"></div>')) {
  throw new Error("dist/index.html has lost its <!--seo:start--> block or its empty #root");
}

for (const route of routes) {
  const body = render(route.path);
  const html = template
    .replace(SEO, headFor(route))
    .replace('<html lang="en">', `<html lang="${route.lang}">`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  const dir = join(dist, ...route.path.split("/").filter(Boolean));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  const words = body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  console.log(`${route.path.padEnd(32)} ${String(words).padStart(5)} words`);
}

writeFileSync(join(dist, "sitemap.xml"), sitemap(new Date().toISOString().slice(0, 10)));
writeFileSync(join(dist, "llms-full.txt"), llmsFull());
rmSync(server, { recursive: true, force: true });
console.log(`sitemap.xml: ${routes.length} pages`);
