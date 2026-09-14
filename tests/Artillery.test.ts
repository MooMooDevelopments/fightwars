import { ArtilleryExecution } from "../src/core/execution/ArtilleryExecution";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import {
  Doctrine,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  UnitType,
} from "../src/core/game/Game";
import { unitTypeToOtherUnit } from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

/**
 * Artillery (brief §6.4, session 12). A land structure that bombards the
 * attacks crossing its range: every volley takes troops off the nearest
 * attack on its owner within range. A defense post makes an attack cost
 * more per tile; artillery makes a standing attack bleed where it stands.
 */

let game: Game;
let gunner: Player;
let attacker: Player;

beforeEach(async () => {
  game = await setup("plains", { infiniteGold: true, instantBuild: true }, [
    new PlayerInfo("gunner", PlayerType.Human, "c-g", "gunner"),
    new PlayerInfo("attacker", PlayerType.Human, "c-a", "attacker"),
  ]);
  gunner = game.player("gunner");
  attacker = game.player("attacker");
  // Two squares sharing a front along x = 40.
  for (let y = 10; y < 60; y++) {
    for (let x = 10; x < 40; x++) gunner.conquer(game.ref(x, y));
    for (let x = 40; x < 70; x++) attacker.conquer(game.ref(x, y));
  }
  gunner.addMaterials(1_000_000n);
  attacker.addMaterials(1_000_000n);
  while (game.inSpawnPhase()) game.executeNextTick();
  attacker.setTroops(500_000);
  gunner.setTroops(500_000);
});

function ticks(n: number) {
  for (let i = 0; i < n; i++) game.executeNextTick();
}

/** An attack on the gunner, launched and registered (one tick). */
function launch(troops: number) {
  game.addExecution(new AttackExecution(troops, attacker, gunner.id()));
  game.executeNextTick();
  const attack = attacker.outgoingAttacks()[0];
  expect(attack).toBeDefined();
  return attack;
}

describe("the unit", () => {
  it("is a land structure that costs materials and upkeep, with a stats key", () => {
    expect(Structures.has(UnitType.Artillery)).toBe(true);
    const config = game.config();
    expect(config.unitMaterialsCost(UnitType.Artillery)).toBe(800n);
    expect(config.unitUpkeep(UnitType.Artillery, gunner)).toBe(30n);
    expect(config.unitInfo(UnitType.Artillery).cost(game, gunner)).toBe(0n); // infinite gold
    expect(unitTypeToOtherUnit[UnitType.Artillery]).toBe("arty");
    // Land only: the sea refuses it, the owner's land takes it.
    expect(gunner.canBuild(UnitType.Artillery, game.ref(20, 30))).not.toBe(
      false,
    );
    expect(gunner.canBuild(UnitType.Artillery, game.ref(55, 30))).toBe(false);
  });

  it("is what a Fortress nation builds more of, like a post", () => {
    const config = game.config();
    expect(
      config.doctrineNationBuildScale(Doctrine.Fortress, UnitType.Artillery),
    ).toBe(1.5);
    expect(
      config.doctrineNationBuildScale(Doctrine.Naval, UnitType.Artillery),
    ).toBe(1);
  });
});

describe("a gun", () => {
  it("takes one volley's troops off the nearest attack in range, once per volley", () => {
    const gun = gunner.buildUnit(UnitType.Artillery, game.ref(30, 30), {});
    game.addExecution(new ArtilleryExecution(gun));
    game.executeNextTick(); // init
    const attack = launch(100_000);
    const before = attack.troops();
    game.executeNextTick(); // the first volley
    const damage = game.config().artilleryDamage();
    // Read against the attack's own movement: a volley is a step change of
    // exactly `damage` on top of whatever the front cost that tick.
    const afterVolley = attack.troops();
    expect(before - afterVolley).toBeGreaterThanOrEqual(damage);
    expect(before - afterVolley).toBeLessThan(damage * 2);
    // No second volley inside the rate.
    const rate = game.config().artilleryAttackRate();
    let lost = 0;
    for (let i = 1; i < rate; i++) {
      const t = attack.troops();
      game.executeNextTick();
      const step = t - attack.troops();
      if (step >= damage) lost++;
    }
    expect(lost).toBe(0);
    // And one more on the rate.
    const t = attack.troops();
    game.executeNextTick();
    expect(t - attack.troops()).toBeGreaterThanOrEqual(damage);
  });

  it("does not reach an attack outside its range", () => {
    // The gun sits twenty tiles behind the front; with the range pinned to
    // ten, the front is out of reach. Pinning it is also what proves the
    // gun reads the range at all.
    vi.spyOn(game.config(), "artilleryRange").mockReturnValue(10);
    const gun = gunner.buildUnit(UnitType.Artillery, game.ref(20, 30), {});
    game.addExecution(new ArtilleryExecution(gun));
    game.executeNextTick();
    const attack = launch(100_000);
    const damage = game.config().artilleryDamage();
    let volleys = 0;
    for (let i = 0; i < 3 * game.config().artilleryAttackRate(); i++) {
      const t = attack.troops();
      game.executeNextTick();
      if (t - attack.troops() >= damage) volleys++;
    }
    expect(volleys).toBe(0);
    vi.restoreAllMocks();
  });

  it("fires nothing while under construction, and stops when destroyed", () => {
    const gun = gunner.buildUnit(UnitType.Artillery, game.ref(30, 30), {});
    vi.spyOn(gun, "isUnderConstruction").mockReturnValue(true);
    game.addExecution(new ArtilleryExecution(gun));
    game.executeNextTick();
    const attack = launch(100_000);
    const damage = game.config().artilleryDamage();
    let volleys = 0;
    for (let i = 0; i < game.config().artilleryAttackRate(); i++) {
      const t = attack.troops();
      game.executeNextTick();
      if (t - attack.troops() >= damage) volleys++;
    }
    expect(volleys).toBe(0);
    vi.restoreAllMocks();
    gun.delete(false);
    game.executeNextTick();
    game.executeNextTick();
    expect(gun.isActive()).toBe(false);
  });

  it("can finish an attack: a volley never leaves a negative count", () => {
    const gun = gunner.buildUnit(UnitType.Artillery, game.ref(30, 30), {});
    game.addExecution(new ArtilleryExecution(gun));
    game.executeNextTick();
    const attack = launch(500);
    game.executeNextTick();
    expect(attack.troops()).toBeGreaterThanOrEqual(0);
    ticks(5);
    expect(attack.isActive()).toBe(false);
  });
});
