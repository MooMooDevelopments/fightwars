/**
 * Copies the web font cuts the client loads out of @fontsource into
 * `resources/fonts/`, where they are committed and served.
 *
 * Run with `npm run fonts:sync`. Like the atlas generator, the source package
 * is deliberately not a saved dependency — three font files that change about
 * once a year are not worth a permanent install:
 *
 *   npm install --no-save @fontsource/barlow@5 @fontsource/barlow-condensed@5
 *   npm run fonts:sync
 *   npm install
 *
 * Only latin is taken. The client already ships a separate MSDF atlas for the
 * map's own text, and every UI string outside it is Latin; pulling latin-ext,
 * Cyrillic and Vietnamese would roughly quadruple the font payload to cover
 * glyphs nothing in the UI can currently produce.
 */

import { copyFileSync, existsSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DEST = join(ROOT, "resources", "fonts");

interface Cut {
  pkg: string;
  file: string;
  why: string;
}

/**
 * Three cuts, and no more. Each one has to earn its bytes: a weight nothing
 * uses still costs every player the download.
 */
const CUTS: Cut[] = [
  {
    pkg: "@fontsource/barlow-condensed",
    file: "barlow-condensed-latin-600-normal.woff2",
    why: "display face — wordmark, headings, and every number in the HUD",
  },
  {
    pkg: "@fontsource/barlow",
    file: "barlow-latin-400-normal.woff2",
    why: "body text",
  },
  {
    pkg: "@fontsource/barlow",
    file: "barlow-latin-600-normal.woff2",
    why: "labels, buttons and emphasis",
  },
];

/** Files the previous display face left behind, removed once nothing loads them. */
const RETIRED = ["overpass.woff", "overpass-bold.woff"];

let copied = 0;
for (const cut of CUTS) {
  const source = join(ROOT, "node_modules", cut.pkg, "files", cut.file);
  if (!existsSync(source)) {
    console.error(
      `\nMissing ${source}\n` + `  npm install --no-save ${cut.pkg}@5\n`,
    );
    process.exit(1);
  }
  copyFileSync(source, join(DEST, cut.file));
  copied++;
  console.log(`${cut.file.padEnd(42)} ${cut.why}`);
}

for (const stale of RETIRED) {
  const path = join(DEST, stale);
  if (existsSync(path)) {
    unlinkSync(path);
    console.log(`removed ${stale}`);
  }
}

const total = readdirSync(DEST).filter((f) => f.endsWith(".woff2")).length;
console.log(
  `\n${copied} cuts synced; ${total} woff2 files in resources/fonts.`,
);
