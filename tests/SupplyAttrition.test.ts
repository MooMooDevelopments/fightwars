import { Config } from "../src/core/configuration/Config";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { UserSettings } from "../src/core/game/UserSettings";
import { GameConfig } from "../src/core/Schemas";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";

/**
 * What supply lines cost an attack that has outrun them (brief §6.1).
 *
 * The scenario is the one the mechanic exists to punish: a corridor of
 * conquered ground 150 tiles long with a war at the far end of it. The only
 * difference between the two runs is which end of the corridor the capital
 * sits at, so everything the numbers differ by is supply.
 */

const CORRIDOR_Y = 100;
const CORRIDOR_END = 150;
const TICKS = 200;

interface Run {
  tilesTaken: number;
  troopsSpent: number;
}

/**
 * Two configurations that differ in one number, so a comparison between them
 * isolates the attrition term from the per-tile penalty that rides alongside
 * it. Both keep the real attack formula.
 */
class NoAttrition extends UseRealAttackLogic {
  supplyAttritionRate(): number {
    return 0;
  }
}
class HeavyAttrition extends UseRealAttackLogic {
  supplyAttritionRate(): number {
    return 0.05;
  }
}

/** One attack down the corridor, fed from `capitalX`. */
async function corridorAttack(
  capitalX: number,
  ConfigClass: typeof Config = UseRealAttackLogic,
): Promise<Run> {
  const game: Game = await setup(
    "big_plains",
    {},
    [
      new PlayerInfo("attacker", PlayerType.Human, null, "attacker"),
      new PlayerInfo("defender", PlayerType.Human, null, "defender"),
    ],
    undefined,
    ConfigClass,
  );
  const attacker: Player = game.player("attacker");
  const defender: Player = game.player("defender");

  for (let x = 0; x <= CORRIDOR_END; x++) {
    attacker.conquer(game.ref(x, CORRIDOR_Y));
  }
  // A block, not a line: the attack needs somewhere to keep going.
  for (let x = CORRIDOR_END + 1; x < 200; x++) {
    for (let y = CORRIDOR_Y - 20; y <= CORRIDOR_Y + 20; y++) {
      defender.conquer(game.ref(x, y));
    }
  }
  attacker.setSpawnTile(game.ref(capitalX, CORRIDOR_Y));
  attacker.setTroops(200_000);
  defender.setTroops(200_000);
  // Let the supply field settle before the attack starts, so the difference
  // is the capital's position and not which run got a sweep first.
  for (let i = 0; i < 25; i++) game.executeNextTick();

  const tilesBefore = attacker.numTilesOwned();
  const troopsBefore = attacker.troops();
  game.addExecution(new AttackExecution(100_000, attacker, defender.id()));
  for (let i = 0; i < TICKS; i++) game.executeNextTick();

  const inFlight = attacker
    .outgoingAttacks()
    .reduce((sum, a) => sum + a.troops(), 0);
  return {
    tilesTaken: attacker.numTilesOwned() - tilesBefore,
    troopsSpent: troopsBefore - attacker.troops() - inFlight,
  };
}

describe("an attack at the end of a long supply line", () => {
  it("advances more slowly and costs more than the same attack fed from the front", async () => {
    const stranded = await corridorAttack(0);
    const supplied = await corridorAttack(CORRIDOR_END);

    // Both fights are identical but for the 150 tiles between the front and
    // the capital. This is the end-to-end claim and the attrition dominates
    // it; the per-tile penalty is pinned separately by the tamper loop in
    // AttackBreakdown.test.ts and by the AttackScenarios snapshots, both of
    // which fail if attackLogic stops charging for supply.
    expect(stranded.tilesTaken).toBeLessThan(supplied.tilesTaken);

    // Not raw troops spent: both stacks are spent to the last man either
    // way, so what supply changes is what they bought with themselves.
    const strandedPerTile = stranded.troopsSpent / stranded.tilesTaken;
    const suppliedPerTile = supplied.troopsSpent / supplied.tilesTaken;
    expect(strandedPerTile).toBeGreaterThan(suppliedPerTile * 1.1);
  }, 60_000);

  it("bleeds the standing stack, over and above what the ground costs", async () => {
    // The per-tile penalty and the attrition both slow a stranded attack, so
    // the only way to see the attrition on its own is to move its rate and
    // hold everything else still. At 5% a tick the stack is half gone in
    // fourteen seconds and the advance stops well short.
    const bleeding = await corridorAttack(0, HeavyAttrition);
    const noBleed = await corridorAttack(0, NoAttrition);

    expect(bleeding.tilesTaken).toBeLessThan(noBleed.tilesTaken / 2);
    expect(bleeding.troopsSpent).toBeGreaterThan(0);
  }, 60_000);
});

describe("the supply curve", () => {
  const config = new Config({} as GameConfig, new UserSettings(), false);
  const free = config.supplyFreeRange();
  const max = config.supplyMaxRange();

  it("costs nothing inside the free range", () => {
    expect(config.supplyOverExtension(0)).toBe(0);
    expect(config.supplyOverExtension(free)).toBe(0);
    expect(config.supplyPenalty(free)).toBe(1);
  });

  it("rises to the full penalty at the maximum range and stays there", () => {
    expect(config.supplyOverExtension(max)).toBe(1);
    expect(config.supplyPenalty(max)).toBe(config.supplyMaxPenalty());
    // 255 is what a tile outside the field carries; it must read as
    // saturated rather than as some enormous extrapolated penalty.
    expect(config.supplyPenalty(255)).toBe(config.supplyMaxPenalty());
  });

  it("climbs monotonically in between", () => {
    let previous = config.supplyPenalty(free);
    for (let d = free + 1; d <= max; d++) {
      const penalty = config.supplyPenalty(d);
      expect(penalty).toBeGreaterThan(previous);
      previous = penalty;
    }
    expect(config.supplyPenalty(Math.floor((free + max) / 2))).toBeCloseTo(
      1 + (config.supplyMaxPenalty() - 1) / 2,
      6,
    );
  });
});
