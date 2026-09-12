/**
 * Draws the FightWars wordmarks and favicon into `resources/images/`.
 *
 * Run with `npm run marks:generate`. Output is committed; the tools are the
 * same one-off install the atlas generator documents (see
 * scripts/generateFontAtlas.ts), because opentype.js arrives with
 * msdf-bmfont-xml.
 *
 * Why generate rather than hand-write the SVG: the wordmark is set in Barlow
 * Condensed, and an SVG `<text font-family="Barlow Condensed">` used as an
 * `<img>` or a favicon cannot load a webfont — it silently falls back to
 * whatever the viewer happens to have, which is how a wordmark ends up
 * looking different on every machine. Outlining the letters into a `<path>`
 * makes the mark self-contained.
 *
 * The mark itself is the game's own front line: a stepped boundary cutting a
 * square, one side taken and one side not. Territory is tiled, so a border in
 * this game is never a smooth diagonal — it is a staircase. That is the one
 * shape nothing else in the genre draws, it survives being 16px wide, and it
 * says what the game is about without a sword or a globe in sight.
 */

import { existsSync, writeFileSync } from "fs";
import opentype from "opentype.js";
import { join } from "path";
import { fileURLToPath } from "url";
import { BRAND } from "../src/brand/Brand";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const IMAGES = join(ROOT, "resources", "images");

const FONT_TTF = join(
  ROOT,
  "node_modules",
  "@expo-google-fonts",
  "barlow-condensed",
  "600SemiBold",
  "BarlowCondensed_600SemiBold.ttf",
);

if (!existsSync(FONT_TTF)) {
  console.error(
    `\nFont not found: ${FONT_TTF}\n` +
      "  npm install --no-save @expo-google-fonts/barlow-condensed@0.4.1\n",
  );
  process.exit(1);
}

/**
 * Ink, ground and the one accent. Amber rather than a blue: blue is both the
 * upstream brand's and the default every dark game UI reaches for, and this
 * particular amber is already load-bearing elsewhere in the client — it is
 * the enemy/alert colour in the dichromat presets, chosen there because it
 * stays separable under all three colour deficiencies.
 */
const INK = "#f8fafc";
const GROUND = "#0f172a";
const ACCENT = "#ffb000";

/** One step of the front line, in mark units. */
const STEP = 16;
const MARK = 96;

/**
 * The staircase, from the top-right corner down to the bottom-left, as the
 * boundary of the "taken" region (everything below and right of it).
 */
function frontLinePath(): string {
  const points: [number, number][] = [[MARK, 0]];
  for (let i = 0; i < MARK / STEP; i++) {
    const x = MARK - i * STEP;
    const y = i * STEP;
    points.push([x - STEP, y]);
    points.push([x - STEP, y + STEP]);
  }
  points.push([0, MARK], [MARK, MARK]);
  return `M${points.map(([x, y]) => `${x},${y}`).join(" L")}Z`;
}

/** The untaken side: the same staircase, closed against the other two edges. */
function untakenPath(): string {
  const points: [number, number][] = [[MARK, 0]];
  for (let i = 0; i < MARK / STEP; i++) {
    const x = MARK - i * STEP;
    const y = i * STEP;
    points.push([x - STEP, y]);
    points.push([x - STEP, y + STEP]);
  }
  points.push([0, MARK], [0, 0]);
  return `M${points.map(([x, y]) => `${x},${y}`).join(" L")}Z`;
}

const font = opentype.loadSync(FONT_TTF);

/**
 * Outline a string, returning the path and its advance width at `size`.
 * Tracking is applied per glyph rather than by letter-spacing, which SVG
 * paths have no notion of.
 */
function outline(
  text: string,
  size: number,
  tracking: number,
): { path: string; width: number } {
  const scale = size / font.unitsPerEm;
  let x = 0;
  const parts: string[] = [];
  const glyphs = font.stringToGlyphs(text);
  glyphs.forEach((glyph, i) => {
    const path = glyph.getPath(x, 0, size);
    const d = path.toPathData(2);
    if (d !== "") parts.push(d);
    x += (glyph.advanceWidth ?? 0) * scale + tracking;
    const next = glyphs[i + 1];
    if (next !== undefined) {
      x += font.getKerningValue(glyph, next) * scale;
    }
  });
  return { path: parts.join(" "), width: x - tracking };
}

const TYPE_SIZE = 96;
const TRACKING = 1.5;

/** Read from the brand module so the card cannot contradict the site. */
const TAGLINE = BRAND.tagline.toUpperCase();

/**
 * Cap height, which is what the lockup aligns on — not the em box. Aligning a
 * mark to the em box leaves it looming over the letters by the height of the
 * font's (unused) ascender space, which is exactly how the first draft of
 * this wordmark ended up overlapping the nav bar.
 */
const CAP_HEIGHT =
  ((font.tables.os2?.sCapHeight ?? 700) / font.unitsPerEm) * TYPE_SIZE;

/**
 * The wordmark. "FIGHT" in ink, "WARS" in the accent — the split is the same
 * one the mark makes, not decoration: two halves of one territory, one taken.
 */
function wordmark(ink: string, ground: string | null): string {
  const first = outline("FIGHT", TYPE_SIZE, TRACKING);
  const second = outline("WARS", TYPE_SIZE, TRACKING);

  // The mark is a square the height of the capitals, and the lockup is
  // trimmed to the ink — no dead space above or below — so wherever a header
  // scales it by height, the letters scale by exactly the same amount.
  const markScale = CAP_HEIGHT / MARK;
  const gap = CAP_HEIGHT * 0.34;
  const textX = CAP_HEIGHT + gap;
  const width = round(textX + first.width + second.width);
  const height = round(CAP_HEIGHT);

  const background =
    ground === null
      ? ""
      : `\n  <rect width="${width}" height="${height}" fill="${ground}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="FightWars">
  <title>FightWars</title>${background}
  <g transform="scale(${round(markScale)})">
    <path d="${untakenPath()}" fill="none" stroke="${ink}" stroke-width="4" stroke-opacity="0.35"/>
    <path d="${frontLinePath()}" fill="${ACCENT}"/>
  </g>
  <g transform="translate(${round(textX)} ${height})">
    <path d="${first.path}" fill="${ink}"/>
    <g transform="translate(${round(first.width)} 0)">
      <path d="${second.path}" fill="${ACCENT}"/>
    </g>
  </g>
</svg>
`;
}

/** Two decimals is plenty for path geometry and keeps the files diffable. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The mark alone, on its own ground, for tabs and app icons. */
function favicon(): string {
  const pad = 10;
  const size = MARK + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="FightWars">
  <title>FightWars</title>
  <rect width="${size}" height="${size}" rx="18" fill="${GROUND}"/>
  <g transform="translate(${pad} ${pad})">
    <path d="${untakenPath()}" fill="none" stroke="${INK}" stroke-width="5" stroke-opacity="0.4"/>
    <path d="${frontLinePath()}" fill="${ACCENT}"/>
  </g>
</svg>
`;
}

const outputs: [string, string][] = [
  // Light ink for the dark UI it actually sits on.
  ["FightWarsLogo.svg", wordmark(INK, null)],
  // Dark ink, for a light ground (print, light-themed embeds).
  ["FightWarsLogoDark.svg", wordmark(GROUND, null)],
  ["Favicon.svg", favicon()],
];

for (const [name, svg] of outputs) {
  writeFileSync(join(IMAGES, name), svg, "utf8");
  console.log(`${name.padEnd(24)} ${svg.length} bytes`);
}

/**
 * The two PWA icons. Drawn rather than rasterised from the SVG: the mark is
 * axis-aligned rectangles, so drawing it directly avoids an SVG rasteriser's
 * sub-pixel seams between adjacent steps.
 *
 * The maskable one gets the mark at half size. A maskable icon is cropped to
 * whatever shape the launcher likes — a circle on most Android, a squircle on
 * some — and only the middle 80% is guaranteed to survive, so anything that
 * fills the tile loses its corners.
 */
async function writeIcons(): Promise<void> {
  const { createCanvas } = await import("canvas");

  const draw = (size: number, markFraction: number, radius: number) => {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = GROUND;
    if (radius > 0) {
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, radius);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, size, size);
    }

    const markSize = size * markFraction;
    const origin = (size - markSize) / 2;
    const unit = markSize / MARK;
    ctx.save();
    ctx.translate(origin, origin);
    ctx.scale(unit, unit);

    // Outline first, fill over it — the same order as the SVG, where the
    // untaken edge sits *under* the taken side. Stroking afterwards instead
    // lays a translucent line along every step and reads as a seam.
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(MARK, 0);
    for (let i = 0; i < MARK / STEP; i++) {
      const x = MARK - i * STEP;
      const y = i * STEP;
      ctx.lineTo(x - STEP, y);
      ctx.lineTo(x - STEP, y + STEP);
    }
    ctx.lineTo(0, MARK);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;

    // The taken side, as one path rather than a rectangle per step: abutting
    // fills at fractional device pixels leave a visible seam down every step.
    // Same walk as the SVG, so the two marks cannot drift apart.
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(MARK, 0);
    for (let i = 0; i < MARK / STEP; i++) {
      const x = MARK - i * STEP;
      const y = i * STEP;
      ctx.lineTo(x - STEP, y);
      ctx.lineTo(x - STEP, y + STEP);
    }
    ctx.lineTo(0, MARK);
    ctx.lineTo(MARK, MARK);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    return canvas.toBuffer("image/png");
  };

  const icons = join(ROOT, "resources", "icons");
  writeFileSync(join(icons, "icon512_rounded.png"), draw(512, 0.62, 96));
  writeFileSync(join(icons, "icon512_maskable.png"), draw(512, 0.5, 0));
  console.log("icon512_rounded.png     512x512 rounded");
  console.log(
    "icon512_maskable.png    512x512 maskable (mark inside the safe zone)",
  );
}

await writeIcons();

/**
 * The Open Graph card.
 *
 * It replaces `images/GameplayScreenshot.png`, which came from upstream
 * (commits #1692, #2063) and is a picture of *OpenFront's* interface — so
 * every link preview was showing someone else's product, and after the
 * Phase 4 palette work it was showing colours the game no longer uses.
 *
 * Drawn as the brand rather than as a screenshot on purpose: a screenshot
 * dates the moment the UI moves, and a card is read at thumbnail size where a
 * screenshot is mush anyway.
 */
async function writeSocialCard(): Promise<void> {
  const { createCanvas } = await import("canvas");
  const WIDTH = 1200;
  const HEIGHT = 630;
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // A faint tile grid: the board this game is played on, and the reason the
  // mark's border is a staircase rather than a diagonal.
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.05;
  ctx.lineWidth = 1;
  const GRID = 30;
  ctx.beginPath();
  for (let x = 0; x <= WIDTH; x += GRID) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, HEIGHT);
  }
  for (let y = 0; y <= HEIGHT; y += GRID) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(WIDTH, y + 0.5);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // The mark, oversized and bled off the bottom-right corner: the front line
  // running off the edge of the card reads as territory still being taken.
  const markPx = 620;
  const unit = markPx / MARK;
  ctx.save();
  ctx.translate(WIDTH - markPx * 0.62, HEIGHT - markPx * 0.72);
  ctx.scale(unit, unit);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.moveTo(MARK, 0);
  for (let i = 0; i < MARK / STEP; i++) {
    const x = MARK - i * STEP;
    const y = i * STEP;
    ctx.lineTo(x - STEP, y);
    ctx.lineTo(x - STEP, y + STEP);
  }
  ctx.lineTo(0, MARK);
  ctx.lineTo(MARK, MARK);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;

  // The wordmark, outlined from the same font the client ships.
  const cardType = 132;
  const cardCap = (700 / font.unitsPerEm) * cardType;
  const markSide = cardCap;
  const gap = cardCap * 0.34;
  const left = 84;
  const baseline = 330;

  ctx.save();
  ctx.translate(left, baseline - markSide);
  ctx.scale(markSide / MARK, markSide / MARK);
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.moveTo(MARK, 0);
  for (let i = 0; i < MARK / STEP; i++) {
    const x = MARK - i * STEP;
    const y = i * STEP;
    ctx.lineTo(x - STEP, y);
    ctx.lineTo(x - STEP, y + STEP);
  }
  ctx.lineTo(0, MARK);
  ctx.lineTo(MARK, MARK);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const textX = left + markSide + gap;
  // opentype's own Path knows how to draw itself onto a 2D context, which
  // avoids Path2D (node-canvas does not expose it) and re-parsing the SVG
  // path string we already have the commands for.
  const paint = (
    text: string,
    size: number,
    tracking: number,
    x: number,
    y: number,
    fill: string,
  ): number => {
    ctx.fillStyle = fill;
    let cursor = x;
    const scale = size / font.unitsPerEm;
    const glyphs = font.stringToGlyphs(text);
    glyphs.forEach((glyph, i) => {
      const path = glyph.getPath(cursor, y, size);
      path.fill = fill;
      path.draw(ctx as unknown as CanvasRenderingContext2D);
      cursor += (glyph.advanceWidth ?? 0) * scale + tracking;
      const next = glyphs[i + 1];
      if (next !== undefined) {
        cursor += font.getKerningValue(glyph, next) * scale;
      }
    });
    return cursor - tracking;
  };

  const afterFight = paint("FIGHT", cardType, 2, textX, baseline, INK);
  paint("WARS", cardType, 2, afterFight, baseline, ACCENT);

  // The tagline sits under the wordmark, aligned to the same left edge as the
  // letters rather than to the mark, so the two lines read as one block.
  paint(TAGLINE, 34, 3.5, textX, baseline + 74, "#94a3b8");

  writeFileSync(join(IMAGES, "SocialCard.png"), canvas.toBuffer("image/png"));
  console.log("SocialCard.png          1200x630 og:image");
}

await writeSocialCard();
