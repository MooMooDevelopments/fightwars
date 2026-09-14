import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "../src/core/execution/nation/NationWarshipBehavior";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  BuildableAttacks,
  Doctrine,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { unitTypeToOtherUnit } from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

/**
 * Carrier (brief §6.4, session 12). A harbour that sails: warships and
 * submarines spawn at the nearest port or carrier, and ships near a carrier
 * heal as they do near a port. It has no guns of its own, a deep hull, and
 * moves like a warship — the same execution drives it.
 *
 * half_land_half_ocean is 16 x 16: x < 8 land, x >= 8 ocean, on every row.
 */

let game: Game;
let a: Player;
let b: Player;

beforeEach(async () => {
  game = await setup(
    "half_land_half_ocean",
    { infiniteGold: true, instantBuild: true },
    [
      new PlayerInfo("a", PlayerType.Human, "c-a", "a"),
      new PlayerInfo("b", PlayerType.Human, "c-b", "b"),
    ],
  );
  a = game.player("a");
  b = game.player("b");
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      const t = game.ref(x, y);
      if (game.map().isLand(t)) a.conquer(t);
    }
    for (let y = 8; y < 16; y++) {
      const t = game.ref(x, y);
      if (game.map().isLand(t)) b.conquer(t);
    }
  }
  a.addMaterials(1_000_000n);
  b.addMaterials(1_000_000n);
  while (game.inSpawnPhase()) game.executeNextTick();
  a.buildUnit(UnitType.Port, game.ref(7, 1), {});
});

function ticks(n: number) {
  for (let i = 0; i < n; i++) game.executeNextTick();
}

/** A hull on patrol at `tile`, driven by the shared execution. */
function sail(owner: Player, hull: UnitType, tile: number) {
  const unit = owner.buildUnit(hull, tile, { patrolTile: tile });
  game.addExecution(new WarshipExecution(unit));
  game.executeNextTick(); // init
  return unit;
}

describe("the unit", () => {
  it("is a buildable attack that spawns at a port, with a materials price and a stats key", () => {
    expect(BuildableAttacks.has(UnitType.Carrier)).toBe(true);
    expect(game.config().unitMaterialsCost(UnitType.Carrier)).toBe(3000n);
    expect(game.config().unitUpkeep(UnitType.Carrier, a)).toBe(120n);
    expect(unitTypeToOtherUnit[UnitType.Carrier]).toBe("carr");
    expect(a.canBuild(UnitType.Carrier, game.ref(12, 4))).toBe(
      a.units(UnitType.Port)[0].tile(),
    );
  });
});

describe("a carrier", () => {
  it("is a harbour that sails: a warship spawns at it when it is nearer than any port", () => {
    // The port sits at (7, 1); the carrier at (14, 14) is far nearer to the
    // south-east, so a warship ordered there spawns on the carrier.
    const carrier = sail(a, UnitType.Carrier, game.ref(14, 14));
    expect(a.canBuild(UnitType.Warship, game.ref(15, 15))).toBe(carrier.tile());
    expect(a.canBuild(UnitType.Warship, game.ref(9, 1))).toBe(
      a.units(UnitType.Port)[0].tile(),
    );
    // Gone, the port is the only harbour again.
    carrier.delete(false);
    expect(a.canBuild(UnitType.Warship, game.ref(15, 15))).toBe(
      a.units(UnitType.Port)[0].tile(),
    );
  });

  it("heals the ships beside it as a port does, not itself", () => {
    vi.spyOn(game.config(), "warshipPassiveHealingRange").mockReturnValue(3);
    const carrier = sail(a, UnitType.Carrier, game.ref(13, 13));
    const near = sail(a, UnitType.Warship, game.ref(14, 13));
    near.modifyHealth(-300);
    carrier.modifyHealth(-300);
    const nearBefore = near.health();
    const carrierBefore = carrier.health();
    ticks(3);
    expect(near.health()).toBeGreaterThan(nearBefore);
    expect(carrier.health()).toBe(carrierBefore);
    // The control: the carrier gone, the same ship in the same water (far
    // from the port at (7, 1)) heals no more.
    carrier.delete(false);
    game.executeNextTick();
    const alone = near.health();
    ticks(3);
    expect(near.health()).toBe(alone);
    vi.restoreAllMocks();
  });

  it("has no guns, and is prey for an enemy warship", () => {
    const carrier = sail(a, UnitType.Carrier, game.ref(12, 6));
    const enemy = sail(b, UnitType.Warship, game.ref(12, 10));
    ticks(2);
    expect(carrier.targetUnit()).toBeUndefined();
    expect(enemy.targetUnit()).toBe(carrier);
  });

  it("answers the warship move order", () => {
    const carrier = sail(a, UnitType.Carrier, game.ref(12, 4));
    game.addExecution(
      new MoveWarshipExecution(a, [carrier.id()], game.ref(14, 10)),
    );
    ticks(2);
    expect(carrier.warshipState().patrolTile).toBe(game.ref(14, 10));
  });
});

describe("a Naval nation", () => {
  it("lays down a carrier as its second hull, and the submarine instead with the lever off", () => {
    a.buildUnit(UnitType.Warship, game.ref(12, 4), {
      patrolTile: game.ref(12, 4),
    });
    a.addGold(1_000_000_000n);
    a.setDoctrine(Doctrine.Naval);
    for (const enabled of [false, true]) {
      const random = new PseudoRandom(1);
      vi.spyOn(random, "chance").mockReturnValue(true);
      vi.spyOn(random, "nextInt").mockReturnValue(0); // the difficulty gate
      const behavior = new NationWarshipBehavior(
        random,
        game,
        a,
        new NationEmojiBehavior(random, game, a),
      );
      vi.spyOn(behavior as any, "warshipSpawnTile").mockReturnValue(
        game.ref(14, 4),
      );
      vi.spyOn(game.config(), "carrierNationEnabled").mockReturnValue(enabled);
      // The retaliation build is where most nation hulls come from; drive
      // that path directly.
      (behavior as any).maybeRetaliateWithWarship(game.ref(14, 4), b, "trade");
      game.executeNextTick();
      game.executeNextTick();
      expect(a.units(UnitType.Carrier).length).toBe(enabled ? 1 : 0);
      expect(a.units(UnitType.Submarine).length).toBe(enabled ? 0 : 1);
      if (!enabled) {
        // The lever off laid the submarine down; clear it for the next pass.
        a.units(UnitType.Submarine)[0].delete(false);
      }
      vi.restoreAllMocks();
    }
  });
});
