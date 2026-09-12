import { describe, expect, test } from "vitest";
import { PALETTE_NAMES } from "../../src/client/render/gl/GraphicsOverrides";
import {
  ThemeName,
  createThemeSettings,
} from "../../src/client/render/gl/RenderSettings";
import { deltaE2000, rgbToLab } from "../../src/client/theme/DeltaE";
import { Vision, hexToRgb, simulateVision } from "../../src/client/theme/Oklch";
import { SettingsTheme } from "../../src/client/theme/ThemeProvider";
import { PlayerView } from "../../src/client/view";
import { PlayerType } from "../../src/core/game/Game";

/**
 * The palettes in src/client/render/gl/*-theme.json are generated offline by
 * scripts/generatePalettes.ts and committed. These tests are the contract
 * that generator has to keep: a player must be able to tell any two
 * territories apart, in whichever palette they chose.
 *
 * Floors are set just under what the committed palettes actually achieve, so
 * a regeneration that quietly makes a palette worse fails here rather than
 * shipping. Raise them when a better generator earns it — the numbers in
 * BUILD-STATE.md record what each palette measures today.
 */

/** Which deficiency each palette is laid out for. */
const VISION: Record<ThemeName, Vision> = {
  default: "normal",
  deuteranopia: "deuteranopia",
  protanopia: "protanopia",
  tritanopia: "tritanopia",
};

/**
 * Smallest CIEDE2000 difference between any two colours of a set, as the
 * palette's intended viewer sees them. ≈1 ΔE is a just-noticeable
 * difference; ≈5 is comfortably distinct at a glance.
 */
function minPairwise(hexes: string[], vision: Vision): number {
  const labs = hexes.map((hex) =>
    rgbToLab(simulateVision(hexToRgb(hex), vision)),
  );
  let min = Infinity;
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      min = Math.min(min, deltaE2000(labs[i], labs[j]));
    }
  }
  return min;
}

/**
 * Floors for [first 120 allocated, whole pool]. A 120-player game is the
 * worst case the brief asks for; the whole pool covers the overflow tier
 * as well.
 */
const FLOORS: Record<
  ThemeName,
  { first120: number; wholePool: number; lobby24: number }
> = {
  default: { first120: 7.5, wholePool: 7.2, lobby24: 15.5 },
  deuteranopia: { first120: 2.7, wholePool: 2.6, lobby24: 6.5 },
  protanopia: { first120: 2.8, wholePool: 2.7, lobby24: 6.8 },
  tritanopia: { first120: 5.3, wholePool: 5.2, lobby24: 9.5 },
};

describe.each(PALETTE_NAMES)("%s palette", (name) => {
  const settings = createThemeSettings(name);
  const vision = VISION[name];
  const pool = [...settings.humanColors, ...settings.nationColors];

  test("declares the vision it was laid out for", () => {
    // RenderSettings casts this field past tsc (a JSON import widens it to
    // string), so it is checked here instead: a palette that claimed the
    // wrong vision would silently get the wrong allocator metric.
    expect(settings.vision).toBe(vision);
  });

  test("has a full pool for both player types and an overflow tier", () => {
    expect(settings.humanColors.length).toBeGreaterThanOrEqual(128);
    expect(settings.nationColors.length).toBeGreaterThanOrEqual(128);
    expect(settings.fallbackColors.length).toBeGreaterThanOrEqual(128);
  });

  test("every colour is a distinct six-digit hex", () => {
    const all = [...pool, ...settings.fallbackColors];
    for (const hex of all) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  test(`the first 120 allocated colours stay ≥ ${FLOORS[name].first120} ΔE apart`, () => {
    expect(minPairwise(pool.slice(0, 120), vision)).toBeGreaterThanOrEqual(
      FLOORS[name].first120,
    );
  });

  test(`the whole pool stays ≥ ${FLOORS[name].wholePool} ΔE apart`, () => {
    expect(minPairwise(pool, vision)).toBeGreaterThanOrEqual(
      FLOORS[name].wholePool,
    );
  });

  test("team colours are separable from one another", () => {
    const teams = Object.entries(settings.teamColors)
      // Tribes are deliberately neutral grey, and Humans/Nations alias Blue
      // and Red, so none of the three is a distinct team identity.
      .filter(([team]) => !["Bot", "Humans", "Nations"].includes(team))
      .map(([, hex]) => hex);
    expect(teams.length).toBe(7);
    expect(minPairwise(teams, vision)).toBeGreaterThan(18);
  });

  test("no allocatable colour can be mistaken for the tribe grey", () => {
    // Tribes render in a flat neutral grey and have to stay readable as "not
    // a player". Colors.test.ts pins this for nations through the runtime
    // allocator; here it covers every colour in every pool, including the
    // overflow tier a 128-player game reaches.
    const grey = settings.teamColors.Bot;
    const all = [...pool, ...settings.fallbackColors];
    const confusable = all.filter(
      (hex) => minPairwise([hex, grey], vision) < 10,
    );
    expect(confusable).toEqual([]);
  });

  test("players are prominent and nations recede", () => {
    // The one design promise the generator encodes: a glance separates
    // people from scenery. For unimpaired vision that is carried by chroma,
    // for the dichromat palettes by lightness, because a dichromat cannot
    // read the chroma split.
    const labs = (hexes: string[]) =>
      hexes.map((hex) => rgbToLab(simulateVision(hexToRgb(hex), vision)));
    const humans = labs(settings.humanColors);
    const nations = labs(settings.nationColors);

    if (vision === "normal") {
      const chroma = (lab: { a: number; b: number }) =>
        Math.hypot(lab.a, lab.b);
      expect(Math.min(...humans.map(chroma))).toBeGreaterThan(
        Math.max(...nations.map(chroma)),
      );
    } else {
      expect(Math.min(...humans.map((lab) => lab.l))).toBeGreaterThan(
        Math.max(...nations.map((lab) => lab.l)),
      );
    }
  });
});

describe("friend-foe colours shared by the dichromat presets", () => {
  // One triple serves all three palettes; GraphicsPresets.test.ts pins that
  // the presets actually carry it.
  const SELF = "#1f4fd8";
  const ALLY = "#5fe0ff";
  const ENEMY = "#ffb000";

  test.each(["normal", "deuteranopia", "protanopia", "tritanopia"] as const)(
    "self, ally and enemy stay separable under %s vision",
    (vision) => {
      expect(minPairwise([SELF, ALLY, ENEMY], vision)).toBeGreaterThan(30);
    },
  );

  test("beats the Okabe-Ito triple it replaced under every vision", () => {
    // The check is only worth having if the comparison is real: the old
    // triple was separable too, just by less.
    for (const vision of [
      "normal",
      "deuteranopia",
      "protanopia",
      "tritanopia",
    ] as const) {
      const old = minPairwise(["#0072b2", "#56b4e9", "#d55e00"], vision);
      expect(minPairwise([SELF, ALLY, ENEMY], vision)).toBeGreaterThan(old);
    }
  });
});

/**
 * The pool tests above bound the worst case. This one measures what a real
 * game hands out: `ColorAllocator` picks the most distant unused colour for
 * the first fifty players of each pool, so an ordinary lobby should do
 * considerably better than the pool's floor. The numbers are the ones worth
 * quoting — they are what a player actually sees.
 */
describe.each(PALETTE_NAMES)("%s palette, as allocated in a game", (name) => {
  const vision = VISION[name];

  // territoryColor() only reads team/type/id from the player.
  const player = (type: PlayerType, id: string) =>
    ({
      team: () => null,
      type: () => type,
      id: () => id,
    }) as unknown as PlayerView;

  const allocate = (type: PlayerType, count: number): string[] => {
    const theme = new SettingsTheme(createThemeSettings(name));
    return Array.from({ length: count }, (_, i) =>
      theme.territoryColor(player(type, `${type}-${i}`)).toHex(),
    );
  };

  test(`a 24-player lobby keeps every player ≥ ${FLOORS[name].lobby24} ΔE apart`, () => {
    const colors = allocate(PlayerType.Human, 24);
    expect(new Set(colors).size).toBe(24);
    // Above the ~5 ΔE "distinct at a glance" mark in every palette, including
    // the two dichromacies with the least colour space to work in.
    expect(minPairwise(colors, vision)).toBeGreaterThan(FLOORS[name].lobby24);
  });

  test("no player colour collides with a nation colour in the same game", () => {
    const theme = new SettingsTheme(createThemeSettings(name));
    const humans = Array.from({ length: 24 }, (_, i) =>
      theme.territoryColor(player(PlayerType.Human, `h-${i}`)).toHex(),
    );
    const nations = Array.from({ length: 60 }, (_, i) =>
      theme.territoryColor(player(PlayerType.Nation, `n-${i}`)).toHex(),
    );
    expect(new Set([...humans, ...nations]).size).toBe(84);
    expect(minPairwise([...humans, ...nations], vision)).toBeGreaterThan(2.5);
  });
});
