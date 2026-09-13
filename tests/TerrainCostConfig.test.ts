import {
  AttackLogicInput,
  Config,
  TERRAIN_COST,
} from "../src/core/configuration/Config";
import { PlayerType, TerrainType } from "../src/core/game/Game";
import { UserSettings } from "../src/core/game/UserSettings";
import { GameConfig } from "../src/core/Schemas";

/**
 * Terrain is a table, and a lobby can scale it (brief §6.2). These pin the
 * two facts that make the table safe to build on: with no `terrain` block the
 * numbers are the table's own to the bit, and with one the multiplier reaches
 * the formula rather than a copy of it.
 */

function config(terrain?: GameConfig["terrain"]): Config {
  return new Config({ terrain } as GameConfig, new UserSettings(), false);
}

function input(terrain: TerrainType): AttackLogicInput {
  return {
    terrain,
    attackTroops: 20_000,
    attacker: { type: PlayerType.Human, numTiles: 5_000 },
    defender: {
      type: PlayerType.Human,
      numTiles: 5_000,
      troops: 20_000,
      isTraitor: false,
      isDisconnectedTeammate: false,
    },
    defenderHasDefensePost: false,
    supplyDistance: 0,
    elevation: 0,
    climb: 0,
    falloutRatio: null,
    borderSize: 10,
  };
}

describe("terrain cost table", () => {
  it("is the bare table when the lobby says nothing", () => {
    const c = config();
    for (const band of [
      TerrainType.Plains,
      TerrainType.Highland,
      TerrainType.Mountain,
    ] as const) {
      expect(c.terrainAttackBase(band)).toEqual({
        mag: TERRAIN_COST[band].mag,
        tileCost: TERRAIN_COST[band].tileCost,
      });
      expect(c.terrainPriorityWeight(band)).toBe(TERRAIN_COST[band].priority);
    }
    expect(c.terrainPriorityWeight(TerrainType.Ocean)).toBe(0);
    expect(() => c.terrainAttackBase(TerrainType.Impassable)).toThrow();
  });

  it("scales one band without touching the others", () => {
    const flat = config();
    const walls = config({ mountain: { loss: 2, speed: 3 } });

    const before = flat.attackLogic(input(TerrainType.Mountain));
    const after = walls.attackLogic(input(TerrainType.Mountain));
    expect(after.attackerTroopLoss).toBeCloseTo(before.attackerTroopLoss * 2);
    expect(after.tickFraction).toBeCloseTo(before.tickFraction * 3);
    expect(after.defenderTroopLoss).toBe(before.defenderTroopLoss);

    expect(walls.attackLogic(input(TerrainType.Plains))).toEqual(
      flat.attackLogic(input(TerrainType.Plains)),
    );
  });

  it("treats a multiplier of exactly 1 as no change at all", () => {
    // Exact, not close: a lobby that spells out the defaults must produce
    // the same bits as one that says nothing, or two lobbies with the same
    // settings would desync from each other.
    const a = config();
    const b = config({
      plains: { loss: 1, speed: 1 },
      highland: { loss: 1 },
      mountain: { speed: 1 },
    });
    for (const band of [
      TerrainType.Plains,
      TerrainType.Highland,
      TerrainType.Mountain,
    ]) {
      expect(b.attackLogic(input(band))).toEqual(a.attackLogic(input(band)));
    }
  });
});
