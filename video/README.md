# Zefaro 1.0.0 video

An 85-second introduction, demo and promotion video for Zefaro, made with
[Remotion](https://www.remotion.dev). Every frame is drawn in React: the app screens are
rebuilt from Zefaro's own layout and colours with sample data, so no screen recording is needed.

## Formats

| Composition | Size | For | File |
| --- | --- | --- | --- |
| `ZefaroPromo` | 1920 x 1080 (16:9) | YouTube | `out/zefaro-1.0.0-youtube-16x9.mp4` |
| `ZefaroPromoVertical` | 1080 x 1920 (9:16) | TikTok and Instagram Reels | `out/zefaro-1.0.0-tiktok-reels-9x16.mp4` |
| `ZefaroPromoFeed` | 1080 x 1350 (4:5) | Instagram feed | `out/zefaro-1.0.0-instagram-feed-4x5.mp4` |

All three use the same scenes. `src/layout.ts` picks the layout from the frame size. The 9:16
version keeps text clear of TikTok's and Reels' own buttons and captions.

## Scenes

| Time | Scene | What it shows | Motion |
| --- | --- | --- | --- |
| 0:00 | Hook | The programs a project needs flash past, then the opening line | Word stamps, kinetic type |
| 0:04 | Intro | The logo builds itself; name, tagline and version | Iris in, tilt, chips landing |
| 0:09 | Orbit | Every service orbits the logo on a tilted ring | Slice in, 3D orbit, drawn lines |
| 0:15 | Services | **Start all** brings nine services up, on the music's first drop | 3D hinge window, camera cues |
| 0:24 | Sites | Link a folder, then secure it with HTTPS | Whip pan, window rises |
| 0:32 | New site | Pick a starter kit and PostgreSQL; the installer runs | Wipe with a red edge |
| 0:41 | Site tools | Tinker, Data, Artisan and Logs on a turning carousel | 3D carousel on a spring |
| 0:52 | Versions | PHP 7.4 to 8.5, and a version per site | Slice in, odometer |
| 0:58 | Mail | A password-reset email arrives and opens | Iris in, window zooms |
| 1:05 | Features | What is built in, and three numbers | Whip pan, marquees, counters |
| 1:12 | Principles | Free, open source, local only, no accounts | Four different line entrances |
| 1:16 | Outro | Download button, repository address and disclaimer | Wipe in |

Scene lengths are in `src/Root.tsx`, and the music offset is computed from them so the track's
first drop lands on the **Start all** click. How a scene comes in over the previous one is its
`entrance` (`src/components/SceneShell.tsx`): fade, iris, wipe, slice or whip. Demo scenes also
choose how the app window arrives (`windowIn` in `src/components/DemoFrame.tsx`): slide, tilt,
rise or zoom. Kinetic type, counters, marquees and landings are in `src/motion.tsx`.

Each demo scene has camera cues (`SHOTS`: the frame a move starts, the zoom, and the point to
zoom onto). The camera follows them on a damped spring, so it eases into every move and settles
softly. In 9:16 and 4:5 the whole app window is visible whenever the camera isn't zoomed in.

## Music

"Corporate Startup Promo" by alex-morgan from Pixabay (Pixabay Content License, not registered
with Content ID). The licence forbids redistributing the track on its own, so
`public/music/` is not in the repository: download it from Pixabay into
`public/music/startup-promo.mp3` before rendering.

`npm run installer-art` renders the installer's `sidebar.bmp` and `header.bmp` from the logo
into `../src-tauri/installer/`.
