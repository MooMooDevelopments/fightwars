import { describe, expect, test } from "vitest";
import {
  AttackEstimate,
  emptyExplanation,
  outnumberedBy,
  significantFactors,
  terrainKey,
} from "../../src/client/AttackCostEstimate";
import { TerrainType } from "../../src/core/game/Game";

/**
 * The presentation half of the hover breakdown: which of `attackLogic`'s
 * factors are worth a line, in what order, and how the stack comparison and
 * terrain are named. The arithmetic itself is pinned by
 * tests/AttackBreakdown.test.ts against the simulation.
 */

function estimate(overrides: Partial<AttackEstimate["explanation"]> = {}) {
  return {
    result: { attackerTroopLoss: 10, defenderTroopLoss: 2, tickFraction: 0.05 },
    explanation: { ...emptyExplanation(), ...overrides },
    attackTroops: 10_000,
    tilesPerSecondPerFrontTile: 2,
    unclaimed: false,
    terrain: TerrainType.Plains,
  } satisfies AttackEstimate;
}

describe("significantFactors", () => {
  test("says nothing when nothing applies", () => {
    // A row reading "terrain x1.00" explains nothing; the breakdown is for
    // the modifiers actually in play.
    expect(significantFactors(estimate())).toEqual([]);
  });

  test("names each modifier that is in play", () => {
    const factors = significantFactors(
      estimate({
        defensePostLossMod: 5,
        defensePostSpeedMod: 3,
        botDefenderMod: 0.7,
      }),
    );
    expect(factors.map((f) => f.key)).toEqual([
      "defense_post",
      "defense_post_speed",
      "tribe",
    ]);
    expect(factors.map((f) => f.affects)).toEqual(["loss", "speed", "loss"]);
  });

  test("puts the biggest reason first", () => {
    // Ordered by distance from 1, so "why is this so expensive" is answered
    // by the first line rather than the fifth.
    const factors = significantFactors(
      estimate({
        traitorLossMod: 1.1,
        defensePostLossMod: 5,
        falloutMod: 0.5,
      }),
    );
    expect(factors.map((f) => f.key)).toEqual([
      "defense_post",
      "fallout",
      "traitor",
    ]);
  });

  test("ignores modifiers that round to no effect", () => {
    // Territory-size bonuses sit a hair off 1 for most of a game; listing
    // "your territory x1.00" would be noise on every single hover.
    expect(
      significantFactors(
        estimate({ largeAttackerMod: 0.999, largeDefenderMod: 1.004 }),
      ),
    ).toEqual([]);
    expect(
      significantFactors(estimate({ largeAttackerMod: 0.95 })).map(
        (f) => f.key,
      ),
    ).toEqual(["your_size"]);
  });
});

describe("outnumberedBy", () => {
  test("is the defender's army over the attacking stack", () => {
    expect(outnumberedBy(estimate({ troopRatio: 2.5 }))).toBe(2.5);
  });

  test("is absent for unclaimed land, which has no army", () => {
    expect(outnumberedBy({ ...estimate(), unclaimed: true })).toBeNull();
  });
});

describe("terrainKey", () => {
  test.each([
    [TerrainType.Plains, "plains"],
    [TerrainType.Highland, "highland"],
    [TerrainType.Mountain, "mountain"],
  ])("names %s", (terrain, expected) => {
    expect(terrainKey({ ...estimate(), terrain })).toBe(expected);
  });
});
