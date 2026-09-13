import { describe, expect, test } from "vitest";
import { deltaE2000, rgbToLab } from "../../src/client/theme/DeltaE";
import { Vision, hexToRgb, simulateVision } from "../../src/client/theme/Oklch";
// Read off disk relative to the repo root. These tests run in jsdom, where
// `import.meta.url` is an http URL and cannot be turned into a path; Vite's
// `?raw` is no good either, since it hands back the *compiled* stylesheet and
// the point here is what the source says.
import { readFileSync } from "fs";
import { join } from "path";

const read = (relative: string) =>
  readFileSync(join(process.cwd(), relative), "utf8");

const STYLES = read("src/client/styles.css");
const CONTROL_PANEL = read("src/client/hud/layers/ControlPanel.ts");

/**
 * The chrome's palette, held to the same standard as the map's.
 *
 * `Palette.test.ts` pins the territory colours because a player has to tell
 * two nations apart. This file pins the HUD's, for the same reason and one
 * more: the HUD is where the game states things in colour — an alert, a
 * currency, how much of your army is still at home — and a pairing that
 * collapses under dichromacy states them to nobody.
 *
 * Every number here was measured before the token it guards was chosen, not
 * after. The commentary in `styles.css` quotes them; this is what stops the
 * commentary drifting away from the values.
 */

/** Read a `--color-*` token out of the stylesheet's `@theme` block. */
function token(name: string): string {
  const direct = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(
    STYLES,
  );
  if (direct !== null) return direct[1].toLowerCase();
  // One level of aliasing: `--color-meter-fill: var(--color-action);`
  const alias = new RegExp(
    `--color-${name}:\\s*var\\(--color-([a-z-]+)\\)\\s*;`,
  ).exec(STYLES);
  if (alias !== null) return token(alias[1]);
  throw new Error(`no --color-${name} in styles.css`);
}

const VISIONS: Vision[] = [
  "normal",
  "protanopia",
  "deuteranopia",
  "tritanopia",
];

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** CIEDE2000 between two colours, as a viewer with `vision` sees them. */
function separation(a: string, b: string, vision: Vision): number {
  return deltaE2000(
    rgbToLab(simulateVision(hexToRgb(a), vision)),
    rgbToLab(simulateVision(hexToRgb(b), vision)),
  );
}

/** The worst any of the four viewers does on a pair. */
function worstSeparation(a: string, b: string): number {
  return Math.min(...VISIONS.map((vision) => separation(a, b, vision)));
}

describe("the troop meter's steps", () => {
  const fill = token("meter-fill");
  const committed = token("meter-committed");
  const track = token("meter-track");
  const ink = token("ink");
  const surface = token("surface");

  test("a white label is legible over every part of the bar", () => {
    // The labels sit on top of the meter and the fill moves under them, so
    // there is no arranging for them to be over a known colour. All three
    // steps have to carry white on their own — which is what let the
    // per-label drop-shadow go.
    expect(contrast(ink, fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, committed)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, track)).toBeGreaterThanOrEqual(4.5);
  });

  test("the two segments are distinct to every viewer", () => {
    // 8 is this repo's working floor for "tell apart at a glance"; the pair
    // measures 17.1 at its worst, so there is room for a later restep.
    expect(worstSeparation(fill, committed)).toBeGreaterThanOrEqual(8);
  });

  test("the committed segment is distinct from the empty track", () => {
    expect(worstSeparation(committed, track)).toBeGreaterThanOrEqual(8);
  });

  test("the track reads as a track rather than as the page behind it", () => {
    expect(worstSeparation(track, surface)).toBeGreaterThanOrEqual(6);
  });

  test("committed troops are the recessive step", () => {
    // Ground already spent should not out-shout ground you still hold. This
    // is the direction of the ramp, not a contrast requirement.
    expect(luminance(committed)).toBeLessThan(luminance(fill));
    expect(luminance(track)).toBeLessThan(luminance(committed));
  });
});

describe("the chrome's status colours", () => {
  const signal = token("signal");
  const actionInk = token("action-ink");
  const surface = token("surface");
  const rankGold = token("rank-gold");

  test("a warning and an informational note are distinct to every viewer", () => {
    expect(worstSeparation(signal, actionInk)).toBeGreaterThanOrEqual(8);
  });

  test("both read as type on the chrome surface", () => {
    expect(contrast(signal, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(actionInk, surface)).toBeGreaterThanOrEqual(4.5);
  });

  test("growth slowing is separable from growth rising", () => {
    // The rate tile states this in two channels — a caret and a colour. The
    // colour still has to work on its own for anyone reading at a glance.
    // The pair this replaced (green-400 / orange-400) measured 10.4 under
    // deuteranopia against 53.0 for normal vision, which is the collapse this
    // floor exists to catch.
    expect(worstSeparation(token("ink"), signal)).toBeGreaterThanOrEqual(20);
  });

  test("the rank gold is NOT safe to reuse for the currency", () => {
    // Documenting the reason the gold counter is plain ink with a coin icon
    // rather than a gold figure: to a dichromat, rank gold and the alert
    // colour are the same colour, so an always-on money readout in it would
    // be indistinguishable from an alert. If a later change makes these two
    // separable, this test fails and the decision can be revisited — it is
    // not asserting that a collision is desirable.
    expect(worstSeparation(rankGold, signal)).toBeLessThan(8);
  });
});

describe("the event feed's severity palette", () => {
  // The feed sits on the same dark surface as the rest of the chrome.
  const FEED_SURFACE = token("surface");
  const roles = {
    loss: token("status-loss"),
    alert: token("status-alert"),
    gain: token("status-gain"),
    note: token("status-note"),
  };

  test("every role reads as type on the feed's surface", () => {
    for (const [name, hex] of Object.entries(roles)) {
      expect(
        contrast(hex, FEED_SURFACE),
        `${name} on the feed surface`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("no two roles collapse for any viewer", () => {
    // The set this replaced was red-400 / yellow-400 / green-400 / gray-200 /
    // blue-400, and its weakest pair was loss against gain at 6.9. That pair
    // is "your attack failed" against "you conquered a player" — the
    // distinction the feed exists to make.
    const entries = Object.entries(roles);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [a, aHex] = entries[i];
        const [b, bHex] = entries[j];
        expect(worstSeparation(aHex, bHex), `${a} vs ${b}`).toBeGreaterThan(8);
      }
    }
  });

  test("loss and gain are not merely distinct but obviously so", () => {
    // A floor well above the general one, because confusing these two inverts
    // the meaning of a message rather than blurring it.
    expect(worstSeparation(roles.loss, roles.gain)).toBeGreaterThanOrEqual(25);
  });
});

/**
 * A Tailwind class that names a hue instead of a role. A colour decision made
 * outside the palette, where nothing measures it.
 */
const HUE_CLASS =
  /\b(?:text|bg|border|from|to|ring)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray|slate|zinc|neutral|stone)-\d{2,3}\b/g;

describe("the HUD does not reach past the palette", () => {
  test("the feeds and the severity map name no raw hue either", () => {
    for (const relative of [
      "src/client/hud/layers/EventsDisplay.ts",
      "src/client/hud/layers/AttacksDisplay.ts",
      "src/client/Utils.ts",
    ]) {
      expect(read(relative).match(HUE_CLASS) ?? [], relative).toEqual([]);
    }
  });

  test("no icon is tinted by a hand-tuned filter chain", () => {
    // `filter: brightness(0) saturate(100%) invert(27%) sepia(91%) ...` is a
    // colour nobody can read and nothing can check against the palette. The
    // .icon-mask utility lets an icon take currentColor instead.
    for (const relative of [
      "src/client/hud/layers/ControlPanel.ts",
      "src/client/hud/layers/AttacksDisplay.ts",
    ]) {
      expect(read(relative), relative).not.toMatch(/filter: brightness\(0\)/);
    }
  });

  test("the control panel names no raw hue", () => {
    // The panel the player reads every tick is the one place worth holding to
    // this mechanically. A hue name here is a colour decision made outside the
    // palette, where nothing measures it.
    expect(CONTROL_PANEL.match(HUE_CLASS) ?? []).toEqual([]);
  });
});
