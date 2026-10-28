# Zefaro website

The landing page for Zefaro, published at [zefaro.web.id](https://zefaro.web.id). React 19,
Vite and Framer Motion, in English and Bahasa Indonesia, with a light and a dark theme.

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # writes the finished site to dist/
```

## Publish

Upload the **contents** of `dist/` (not the folder itself) to the web root of zefaro.web.id,
for example `public_html`. It is plain static files, with relative paths, so any host works.
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
