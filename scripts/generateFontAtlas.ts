/**
 * Regenerates the MSDF text atlas the WebGL renderer draws player names,
 * troop counts and structure levels with (`resources/atlases/msdf-atlas.*`).
 *
 * Run with `npm run atlas:generate`. The output is committed; this is not part
 * of the build, and the tools it needs are deliberately *not* dependencies —
 * `msdf-bmfont-xml` pulls `canvas`, a native module that would make every CI
 * `npm ci` build a C++ addon to regenerate a file that changes about once a
 * year. Install them for the one run:
 *
 *   npm install --no-save msdf-bmfont-xml@^2.7.0 @expo-google-fonts/barlow-condensed@0.4.1
 *   npm rebuild canvas        # canvas ships prebuilds but its install script is gated
 *   npm run atlas:generate
 *   npm install               # restore the saved tree
 *
 * The TTF comes from @expo-google-fonts rather than @fontsource because
 * msdf-bmfont-xml reads TTF/OTF and fontsource ships only woff/woff2. Both
 * carry the same SIL OFL-1.1 Barlow; the woff2 the browser loads comes from
 * fontsource (see scripts/syncFonts.ts).
 *
 * Parameters are not free choices — they must keep matching what the renderer
 * reads back out of the JSON (`AtlasData.ts`, `TextProgram.ts`): a distance
 * range of 16 at a 48px em, which is what keeps a name's edges clean when the
 * map is zoomed right in. The charset is read from the atlas being replaced,
 * so coverage can never silently shrink.
 */

import { execFileSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const ATLAS_JSON = join(ROOT, "resources", "atlases", "msdf-atlas.json");
const ATLAS_PNG = join(ROOT, "resources", "atlases", "msdf-atlas.png");

/** The display face, and the cut of it the map is set in. */
const FONT_TTF = join(
  ROOT,
  "node_modules",
  "@expo-google-fonts",
  "barlow-condensed",
  "600SemiBold",
  "BarlowCondensed_600SemiBold.ttf",
);

const CLI = join(ROOT, "node_modules", "msdf-bmfont-xml", "cli.js");

/** Must stay in step with what AtlasData.ts / TextProgram.ts expect. */
const EM_SIZE = 48;
const DISTANCE_RANGE = 16;
const GLYPH_PADDING = 8;
const MAX_TEXTURE = "1024,1024";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!existsSync(CLI)) {
  fail(
    "msdf-bmfont-xml is not installed. It is intentionally not a dependency:\n" +
      "  npm install --no-save msdf-bmfont-xml@^2.7.0 @expo-google-fonts/barlow-condensed@0.4.1\n" +
      "  npm rebuild canvas",
  );
}
if (!existsSync(FONT_TTF)) {
  fail(
    `Font not found: ${FONT_TTF}\n` +
      "  npm install --no-save @expo-google-fonts/barlow-condensed@0.4.1",
  );
}

// Take the charset from the atlas we are replacing. Typing one out by hand is
// how coverage quietly shrinks and a player's name loses its accents.
interface BmFont {
  info: { face: string; size: number; charset: string[] };
  common: { scaleW: number; scaleH: number };
  distanceField: { fieldType: string; distanceRange: number };
  chars: unknown[];
  kernings: { first: number; second: number; amount: number }[];
  pages: string[];
}
const previous = JSON.parse(readFileSync(ATLAS_JSON, "utf8")) as BmFont;
const charset = previous.info.charset.join("");

const work = mkdtempSync(join(tmpdir(), "fw-atlas-"));
try {
  const charsetFile = join(work, "charset.txt");
  writeFileSync(charsetFile, charset, "utf8");

  execFileSync(
    process.execPath,
    [
      CLI,
      "-f",
      "json",
      // The page name inside the JSON follows this filename, and the renderer
      // fetches atlases/msdf-atlas.png, so it has to be exactly this.
      "-o",
      join(work, "msdf-atlas.png"),
      "-s",
      String(EM_SIZE),
      "-t",
      "msdf",
      "-r",
      String(DISTANCE_RANGE),
      "-p",
      String(GLYPH_PADDING),
      "-m",
      MAX_TEXTURE,
      "-i",
      charsetFile,
      FONT_TTF,
    ],
    { stdio: "inherit" },
  );

  // msdf-bmfont names the JSON after the font face, not after -o.
  const producedJson = join(work, "BarlowCondensed_600SemiBold.json");
  if (!existsSync(producedJson)) {
    fail(`Generator did not produce ${producedJson}`);
  }

  const next = JSON.parse(readFileSync(producedJson, "utf8")) as BmFont;

  // Guard the things the renderer reads back out. A silently different
  // distance range shows up as mushy or chipped glyph edges at high zoom,
  // which is exactly the kind of regression nobody attributes to a font swap.
  if (next.distanceField.distanceRange !== DISTANCE_RANGE) {
    fail(
      `distanceRange is ${next.distanceField.distanceRange}, expected ${DISTANCE_RANGE}`,
    );
  }
  if (next.pages.length !== 1 || next.pages[0] !== "msdf-atlas.png") {
    fail(
      `pages should be ["msdf-atlas.png"], got ${JSON.stringify(next.pages)}`,
    );
  }
  if (next.chars.length !== previous.chars.length) {
    fail(
      `glyph count changed: ${previous.chars.length} → ${next.chars.length}. ` +
        "Coverage must not shrink; check the charset.",
    );
  }

  // Drop kerning pairs that adjust nothing. buildKernTable() fills a
  // zero-initialised table and writes only the pairs it is given, so a
  // missing pair and a zero pair are the same thing to the renderer — and
  // Barlow Condensed lists thousands of zeroes. Halves the file.
  const keptKernings = next.kernings.filter((k) => k.amount !== 0);
  const dropped = next.kernings.length - keptKernings.length;
  next.kernings = keptKernings;
  writeFileSync(ATLAS_JSON, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  copyFileSync(join(work, "msdf-atlas.png"), ATLAS_PNG);

  console.log(
    `\natlas: ${previous.info.face} → ${next.info.face}  ` +
      `${next.common.scaleW}x${next.common.scaleH}px, ` +
      `${next.chars.length} glyphs, ${next.kernings.length} kerning pairs ` +
      `(${dropped} no-ops dropped), range ${next.distanceField.distanceRange}`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
