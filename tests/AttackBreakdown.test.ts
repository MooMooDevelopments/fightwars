import { describe, expect, test } from "vitest";
import {
  ATTACKER_LOSS_BASE,
  ATTACKER_LOSS_PER_DENSITY,
  AttackExplanation,
  AttackLogicInput,
  Config,
  TERRA_NULLIUS_COST_SCALE,
  TERRA_NULLIUS_MAX_COST,
  TERRA_NULLIUS_MIN_COST,
} from "../src/core/configuration/Config";
import { PlayerType, TerrainType } from "../src/core/game/Game";
import { UserSettings } from "../src/core/game/UserSettings";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { GameConfig } from "../src/core/Schemas";

/**
 * `attackLogic` fills in an `AttackExplanation` so the client can show a
 * player *why* an attack costs what it costs. The explanation is only worth
 * showing if it is the same arithmetic the simulation ran, so these tests
 * recompose the published formula from the explanation's fields and require
 * it to reproduce the result exactly.
 *
 * That makes this a drift alarm, not a restatement: change a tunable or a
 * step in attackLogic without telling the explanation about it, and the two
 * disagree here rather than in a tooltip nobody cross-checks.
 */

const config = new Config({} as GameConfig, new UserSettings(), false);
const within = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function blankExplanation(): AttackExplanation {
  return {
    terrainMag: 0,
    terrainTileCost: 0,
    defensePostLossMod: 0,
    defensePostSpeedMod: 0,
    falloutMod: 0,
    supplyDistance: 0,
    supplyMod: 0,
    elevation: 0,
    heightMod: 0,
    climb: 0,
    climbMod: 0,
    highGroundMod: 0,
    botDefenderMod: 0,
    disconnectedTeammateMod: 0,
    traitorLossMod: 0,
    traitorSpeedMod: 0,
    largeAttackerMod: 0,
    largeDefenderMod: 0,
    largeAttackerSpeedMod: 0,
    troopRatio: 0,
    clampedLossRatio: 0,
    defenderDensity: 0,
    speedCost: 0,
    borderSize: 0,
  };
}

/** The published formula, written out from the explanation's fields alone. */
function recompose(
  e: AttackExplanation,
  input: AttackLogicInput,
): {
  attackerTroopLoss: number;
  defenderTroopLoss: number;
  tickFraction: number;
} {
  // Order matters: these are exact float comparisons, and attackLogic
  // charges supply before the defense post and the fallout.
  const mag =
    e.terrainMag *
    e.supplyMod *
    e.heightMod *
    e.climbMod *
    e.defensePostLossMod *
    e.falloutMod *
    e.botDefenderMod;
  const tileCost =
    e.terrainTileCost *
    e.supplyMod *
    e.heightMod *
    e.climbMod *
    e.defensePostSpeedMod *
    e.falloutMod;

  if (input.defender === null) {
    return {
      attackerTroopLoss:
        mag / (input.attacker.type === PlayerType.Bot ? 10 : 5),
      defenderTroopLoss: 0,
      tickFraction:
        within(
          (TERRA_NULLIUS_COST_SCALE * tileCost) / input.attackTroops,
          TERRA_NULLIUS_MIN_COST,
          TERRA_NULLIUS_MAX_COST,
        ) /
        (e.borderSize * 2),
    };
  }

  return {
    attackerTroopLoss:
      mag *
      e.disconnectedTeammateMod *
      e.traitorLossMod *
      e.clampedLossRatio *
      (ATTACKER_LOSS_BASE * e.largeAttackerMod * e.largeDefenderMod +
        ATTACKER_LOSS_PER_DENSITY * e.defenderDensity),
    defenderTroopLoss: e.defenderDensity,
    tickFraction:
      (e.speedCost *
        tileCost *
        e.largeAttackerSpeedMod *
        e.largeDefenderMod *
        e.traitorSpeedMod) /
      e.borderSize,
  };
}

const TERRAINS = [
  TerrainType.Plains,
  TerrainType.Highland,
  TerrainType.Mountain,
];

function randomInput(rand: PseudoRandom): AttackLogicInput {
  const terrain = TERRAINS[rand.nextInt(0, TERRAINS.length)];
  const terraNullius = rand.chance(4);
  return {
    terrain,
    attackTroops: rand.nextInt(1, 5_000_000),
    attacker: {
      type: rand.chance(3) ? PlayerType.Bot : PlayerType.Human,
      numTiles: rand.nextInt(1, 1_000_000),
    },
    defender: terraNullius
      ? null
      : {
          type: rand.chance(3) ? PlayerType.Bot : PlayerType.Human,
          numTiles: rand.nextInt(1, 1_000_000),
          troops: rand.nextInt(1, 5_000_000),
          isTraitor: rand.chance(4),
          isDisconnectedTeammate: rand.chance(8),
        },
    defenderHasDefensePost: rand.chance(3),
    // Half the cases sit somewhere on the supply ramp, including past its
    // saturation point and on the 255 an out-of-field tile carries.
    supplyDistance: rand.chance(2) ? rand.nextInt(0, 256) : 0,
    // Real heights and climbs, including the ones the floor clamps.
    elevation: rand.nextInt(0, 31),
    climb: rand.chance(3) ? 0 : rand.nextInt(-30, 31),
    falloutRatio: rand.chance(3) ? rand.nextInt(1, 100) / 100 : null,
    borderSize: rand.nextInt(1, 400),
  };
}

describe("attackLogic explanation", () => {
  test("recomposes the result exactly, across 2000 random situations", () => {
    const rand = new PseudoRandom(20260912);
    let terraNulliusSeen = 0;
    let defendedSeen = 0;

    for (let i = 0; i < 2000; i++) {
      const input = randomInput(rand);
      const explanation = blankExplanation();
      const result = config.attackLogic(input, explanation);
      const rebuilt = recompose(explanation, input);

      // Exact, not approximate: the same operations in the same order on the
      // same doubles. An "almost equal" here would hide a reordered factor.
      expect(rebuilt.attackerTroopLoss, `case ${i}`).toBe(
        result.attackerTroopLoss,
      );
      expect(rebuilt.defenderTroopLoss, `case ${i}`).toBe(
        result.defenderTroopLoss,
      );
      expect(rebuilt.tickFraction, `case ${i}`).toBe(result.tickFraction);

      if (input.defender === null) terraNulliusSeen++;
      else defendedSeen++;
    }

    // The sweep is only meaningful if it reached both branches.
    expect(terraNulliusSeen).toBeGreaterThan(100);
    expect(defendedSeen).toBeGreaterThan(100);
  });

  test("would fail if a factor were dropped from the explanation", () => {
    // Guards the guard: prove the recomposition is sensitive to the factors
    // it multiplies, so a passing sweep above means something.
    const input: AttackLogicInput = {
      terrain: TerrainType.Mountain,
      attackTroops: 100_000,
      attacker: { type: PlayerType.Human, numTiles: 5_000 },
      defender: {
        type: PlayerType.Human,
        numTiles: 4_000,
        troops: 200_000,
        isTraitor: true,
        isDisconnectedTeammate: false,
      },
      defenderHasDefensePost: true,
      supplyDistance: 55,
      elevation: 24,
      climb: 6,
      falloutRatio: 0.25,
      borderSize: 30,
    };
    const explanation = blankExplanation();
    const result = config.attackLogic(input, explanation);
    expect(recompose(explanation, input).attackerTroopLoss).toBe(
      result.attackerTroopLoss,
    );

    for (const field of [
      "defensePostLossMod",
      "supplyMod",
      "heightMod",
      "climbMod",
      "falloutMod",
      "traitorLossMod",
      "largeAttackerMod",
    ] as const) {
      const tampered = { ...explanation, [field]: 1 };
      expect(
        recompose(tampered, input).attackerTroopLoss,
        `${field} should change the answer`,
      ).not.toBe(result.attackerTroopLoss);
    }
  });

  test("leaves every modifier at 1 when nothing applies", () => {
    const explanation = blankExplanation();
    config.attackLogic(
      {
        terrain: TerrainType.Plains,
        attackTroops: 10_000,
        attacker: { type: PlayerType.Human, numTiles: 100 },
        defender: {
          type: PlayerType.Human,
          numTiles: 100,
          troops: 10_000,
          isTraitor: false,
          isDisconnectedTeammate: false,
        },
        defenderHasDefensePost: false,
        supplyDistance: 0,
        elevation: 0,
        climb: 0,
        falloutRatio: null,
        borderSize: 10,
      },
      explanation,
    );
    expect(explanation.defensePostLossMod).toBe(1);
    expect(explanation.defensePostSpeedMod).toBe(1);
    expect(explanation.falloutMod).toBe(1);
    expect(explanation.supplyMod).toBe(1);
    expect(explanation.heightMod).toBe(1);
    expect(explanation.climbMod).toBe(1);
    expect(explanation.highGroundMod).toBe(1);
    expect(explanation.botDefenderMod).toBe(1);
    expect(explanation.disconnectedTeammateMod).toBe(1);
    expect(explanation.traitorLossMod).toBe(1);
    expect(explanation.traitorSpeedMod).toBe(1);
    expect(explanation.borderSize).toBe(10);
  });

  test("costs nothing in troops against a disconnected teammate", () => {
    const explanation = blankExplanation();
    const result = config.attackLogic(
      {
        terrain: TerrainType.Plains,
        attackTroops: 10_000,
        attacker: { type: PlayerType.Human, numTiles: 100 },
        defender: {
          type: PlayerType.Human,
          numTiles: 100,
          troops: 10_000,
          isTraitor: false,
          isDisconnectedTeammate: true,
        },
        defenderHasDefensePost: false,
        supplyDistance: 0,
        elevation: 0,
        climb: 0,
        falloutRatio: null,
        borderSize: 10,
      },
      explanation,
    );
    expect(explanation.disconnectedTeammateMod).toBe(0);
    expect(result.attackerTroopLoss).toBe(0);
  });

  test("the simulation's own calls are unaffected by the out-parameter", () => {
    const rand = new PseudoRandom(7);
    for (let i = 0; i < 200; i++) {
      const input = randomInput(rand);
      const withOut = config.attackLogic(input, blankExplanation());
      const without = config.attackLogic(input);
      expect(withOut).toEqual(without);
    }
  });
});
