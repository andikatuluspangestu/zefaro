# Zefaro website

The landing page for Zefaro, published at [zefaro.pages.dev](https://zefaro.pages.dev). React 19,
Vite and Framer Motion, in English and Bahasa Indonesia, with a light and a dark theme.

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # writes the finished site to dist/
```

## Publish

The site is plain static files with relative paths, hosted on Cloudflare Pages as the project `zefaro`
(https://zefaro.pages.dev). `npm run deploy` builds the site and uploads `dist/` with Wrangler, using
`wrangler.jsonc`. The first time on a machine, log in with `npx wrangler login`.

- `public/_headers` sets the cache and security headers. `public/404.html` is the page for unknown addresses.
- This Wrangler version redirects `pages` commands to Cloudflare Workers unless the project already
  exists as a Pages project. The `zefaro` Pages project was created once with
  `npx wrangler pages project create zefaro --production-branch main --force`; after that no flag is needed.
- If the site moves to its own domain, change the address in `index.html` (canonical and Open Graph),
  `public/sitemap.xml`, `public/robots.txt` and `../video/src/components/OgImage.tsx`, then run
  `npm run og` in `../video` to redraw `public/og.png`.

**Any other host**: upload the **contents** of `dist/` (not the folder itself) to the web root.
`dist/.htaccess` turns on compression and caching on Apache and is ignored elsewhere.

The download buttons point to
`https://github.com/andikatuluspangestu/zefaro/releases/latest`. They work once that
release exists. Links and the version number live in `src/copy.ts` and `index.html`; change
both when a new version ships.

## Where things are

| File | What it holds |
|---|---|
| `src/copy.ts` | Every word, English and Indonesian. The Indonesian object must match the English one, or the build fails. |
| `src/prefs.tsx` | Language and theme. Both are remembered, and the theme follows Windows until the visitor picks one. |
| `src/styles.css` | The app's own colour tokens, so the app window on the page is made of the app's colours. |
| `src/components/Story.tsx` | The pinned scroll story: link a folder, open the address, HTTPS, the site's page. Scroll position is the playhead. |
| `src/components/Tools.tsx` | The horizontal gallery of the seven site tools, pinned while you scroll down. |
| `src/components/Flow.tsx` | The request path, with a packet that travels it as you scroll. |
| `src/components/AppWindow.tsx` | The Services page in the hero. It plays one start-up, with a Replay button. |
| `public/og.png` | The link preview. Redraw it with `npm run og` in `../video`. |

Motion: words rise out of masks, the hero window tilts toward the pointer, buttons lean toward it,
and the story, gallery, request path, marquee and no-list play in step with your scroll. Nothing loops
by itself. Smooth scrolling is Lenis. Movement follows the system's reduced-motion setting, and the
play or pause button in the header overrides it (saved in `localStorage`); with motion off the story
and gallery are plain lists. Fonts: Bricolage Grotesque for display, Geist for text.
