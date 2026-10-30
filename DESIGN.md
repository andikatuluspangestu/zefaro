# Zefaro: design direction

Transcribed from decisions the project owner made while building Zefaro. It is the
direction the UI follows; `antislop` is the filter applied on top.

## Identity

- **Product:** Zefaro, "Yet Another Local Laravel Tools": a free, open-source local PHP development
  environment for Windows. Desktop app (Tauri). Audience: PHP and Laravel developers.
- **Personality:** a dependable workbench. Direct, calm, practical. It tells you
  what is running and what to do next; it does not sell.
- **Logo:** a white "Z" drawn as one rounded stroke (top bar, diagonal, bottom bar)
  with a soft shadow, on a rounded square with the brand gradient (coral `#FF6082`,
  violet `#B26CFF`, indigo `#705EFF`) and a light highlight top left. The name comes
  from zephyr, the light west wind. Source: `src-tauri/icons/app-icon.svg`.

## Palette

The four brand colours, set by the project owner:

| Colour | Hex | Role |
| --- | --- | --- |
| Coral | `#FF6082` | Start of the gradient. Never body text on white. |
| Pink | `#FFE4F6` | Light-theme tint: backgrounds, selected rows. On the dark theme, text and borders. |
| Violet | `#B26CFF` | Middle of the gradient. Accent text and focus ring on the dark theme. |
| Indigo | `#705EFF` | End of the gradient. The primary button fill. |

- **Themes:** light and dark. Zefaro follows Windows by default; Settings lets you pick
  either. The choice is saved in `localStorage` (`zefaro.theme`) and applied from
  `index.html` before the first paint, so the window never flashes the wrong theme.
- **Neutrals:** tinted towards violet (hue 280 to 340) so the brand colours sit on them
  naturally. Tokens are OKLCH values in `src/styles.css` (`:root` and `.dark`).
- **Primary action:** indigo fill with near-white text (5.0:1 on light, 4.7:1 on dark).
  Used for the main action on a screen, the unread badge and the selected state.
- **Brand gradient** (coral, violet, indigo at 135 degrees): the logo, progress bars, the short rule above each page title and the wordmark. It is
  decoration and never sits behind body text. Utilities: `bg-brand-gradient`,
  `text-brand-gradient`.
- **Accent text:** on the dark theme indigo is a fill only. Accent text is violet
  (5.9:1) or coral (6.6:1). White on coral is 2.9:1, so coral never carries white text.
- **Status colours:** semantic tokens `success`, `warning`, `info` and `destructive`, each
  with a shade that reads on its own theme. Components use the tokens, never fixed
  Tailwind colours such as `text-amber-500`.
- **Service logos:** each stack's own logo (Dashboard Icons, Apache-2.0) on a
  neutral tile.

## Typography

- **Sans:** Geist Variable (shipped with shadcn's setup; kept for its compact,
  even rhythm in dense settings screens).
- **Mono:** system monospace for paths, ports, commands and config.
- No uppercase-with-wide-tracking labels except table column headers.

## Components and icons

- shadcn/ui (`radix-nova`) built-in components, Tailwind v4.
- Font Awesome 7 icons (solid, regular, brands).
- Cards are flat: a single hairline ring and radius `--radius` (0.75rem), never a shadow,
  glow or glass. Shadows belong only to layers that float above the page (menus, popovers,
  dialogs, the "jump to newest" button in Logs).
- Anything that is on or off is a switch: settings, a service or worker running, HTTPS for
  a site, following a log. A switch sits at the end of its row with the row's title as its
  name. Checkboxes are kept for picking items from a list (projects or databases to
  import). A first start that downloads something stays a named button
  ("Install and start"), so a switch never starts a download.
- Sidebar: white in the light theme, beside the tinted page. Its header (logo, name,
  version) is as tall as the top bar, so the two borders run as one line. The pages you
  work in sit at the top (Develop, Tools); Diagnostics, Documentation, About and Settings
  sit at the bottom, with a card offering a new version above them only when one is out.
  Items are muted until hovered. The open page gets a light indigo fill and an indigo icon;
  its text stays the foreground colour, because indigo text on that fill is 4.4:1. No
  coloured stripe.
- Settings pages share one layout: back link, title, grouped rows, sticky save
  bar, generated-file viewer. A row has its name and at most one short line on what it
  does; when the name says it all, no line.
- The app's Settings page is split into three tabs (General, Updates and backup, HTTPS and
  system) so each fits the default 1000 x 680 window without scrolling. A tab that hides
  something needing attention (an update, an untrusted certificate authority) carries a
  small warning dot.

## Layout

- Sidebar (collapsible to icons) + one scrolling content column, max width 5xl. The
  Terminal page is the exception: it fills the whole area and stays mounted while other
  pages are open, so each terminal keeps its screen. Its colours come from the tokens
  (card background, foreground text, primary cursor); every ANSI colour reads at 4.5:1
  on that background, except black on the dark theme, which programs use as a fill.
- Home is the first page: what is running, your sites, and what needs attention. While a
  fresh install has no PHP or no site, a four-step "Get started" list leads the page.
- Minimum window 820 x 560; every page must fit without horizontal scroll.

## Voice

- International (British) English: colour, licence (noun), behaviour, centre,
  organise, initialise.
- Plain and specific. Name the actor ("Zefaro writes php.ini", "Windows asks for
  admin"). Short sentences. Second person for instructions.
- No marketing claims, no buzzwords, no em or en dashes.

## Dials

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

## Website

The landing page (`site/`, zefaro.pages.dev) uses the same palette and tokens. The owner asked for a
more modern, fluid and full-motion page, so its dials are higher than the app's:
ENERGY 5 / RHYTHM 4 / MOTION 4.

- **One idea, the wind.** Zefaro comes from zephyr, the light west wind. The brand gradient
  is that wind: the logo, one word of the headline, a request path that a packet travels as you
  scroll, and the progress marks. It is not a background, an orb or a glow.
- **The product, working.** The hero is the Services page starting up. A pinned scroll story
  links a folder, opens `shop.test` in a browser, turns on HTTPS and opens the site's own page,
  with the scroll position as the playhead. No fake terminal, no stock illustration, no invented
  numbers or customers. Example data is labelled as a sample.
- **Sections follow the content and change shape:** a kinetic headline over a tilting window, a
  scroll-driven marquee of the stack, names that open on hover, the pinned story on a dark band,
  a horizontal gallery for the seven site tools, the request path, a no-list that strikes itself
  out, one indigo install card, a narrow FAQ and a giant wordmark. No bento grid, no card grid.
- **Type:** Bricolage Grotesque for display, chosen because its width axis lets big words stretch
  and narrow like a sail (the headline words, the open stack name, the footer wordmark gaining
  weight). Geist for text, as in the app.
- **Motion with a purpose:** words rise out of masks, the window follows the pointer, buttons lean
  toward it, the theme change spreads from the button as a circle, and everything scroll-linked
  plays in step with the scroll and stops when it stops. Nothing loops by itself.
- **Control:** movement follows the system's reduced-motion setting, and a play or pause button in
  the header overrides it either way. With motion off, the story and the gallery become plain
  lists and smooth scrolling is off.
- **Colour:** indigo is the accent for actions; dark bands (the story) and a pink band (the
  no-list) change the mood without new colours. In both themes, text keeps the contrast the
  app's tokens give.
- **Languages:** English and Bahasa Indonesia, chosen from the browser, switchable in the header.
