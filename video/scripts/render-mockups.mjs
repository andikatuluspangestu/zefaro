// Renders the promotional mockups (src/mockups/Mockups.tsx), each design in three sizes, to
// out/mockups/<size>/zefaro-<nn>-<name>.png, one at a time.
// Pass filters to render only some: `npm run mockups -- 05 1080x1350` renders matching ids.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const DESIGNS = [
  "01Hero", "02Home", "03Services", "04Sites", "05Https", "06NewSite", "07Overview", "08Tinker",
  "09Data", "10Artisan", "11Php", "12Mail", "13Stack", "14Privacy", "15Install",
];
const SIZES = ["1920x1080", "1080x1920", "1080x1350"];

const filters = process.argv.slice(2);
const ids = DESIGNS.flatMap((d) => SIZES.map((s) => `Mockup${d}-${s}`)).filter((id) => filters.every((f) => id.includes(f)));

for (const id of ids) {
  // Mockup05Https-1080x1350 -> out/mockups/1080x1350/zefaro-05-https.png
  const [, n, name, size] = id.match(/^Mockup(\d+)([A-Za-z]+)-(\d+x\d+)$/);
  const slug = name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  mkdirSync(`out/mockups/${size}`, { recursive: true });
  const file = `out/mockups/${size}/zefaro-${n}-${slug}.png`;
  const r = spawnSync("npx", ["remotion", "still", id, file], { stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
