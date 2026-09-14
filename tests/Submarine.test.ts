import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "../src/core/execution/nation/NationWarshipBehavior";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
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
 * Submarine (brief §6.4, session 12). A warship hull that hides: it hunts
 * transports and trade ships and never engages a warship; an enemy warship
 * sees it only within `submarineDetectionRange()` or under one of its own
 * radars. Everything else — spawn at a port, patrol, retreat, docking,
 * healing, veterancy, the move intent — is the warship's, and the same
 * execution drives both hulls.
 *
 * half_land_half_ocean is 16 x 16: x < 8 land, x >= 8 ocean, on every row —
 * so the detection and radar ranges are pinned small enough to fit it.
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
  a.buildUnit(UnitType.Port, game.ref(7, 4), {});
  b.buildUnit(UnitType.Port, game.ref(7, 12), {});
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
    expect(BuildableAttacks.has(UnitType.Submarine)).toBe(true);
    expect(game.config().unitMaterialsCost(UnitType.Submarine)).toBe(1600n);
    expect(game.config().unitUpkeep(UnitType.Submarine, a)).toBe(80n);
    expect(unitTypeToOtherUnit[UnitType.Submarine]).toBe("subm");
    expect(a.canBuild(UnitType.Submarine, game.ref(12, 4))).toBe(
      a.units(UnitType.Port)[0].tile(),
    );
    expect(a.canBuild(UnitType.Submarine, game.ref(3, 3))).toBe(false); // land
  });
});

describe("a submarine", () => {
  it("hunts a transport and never a warship; a warship hunts it only when close", () => {
    vi.spyOn(game.config(), "submarineDetectionRange").mockReturnValue(6);
    const sub = sail(a, UnitType.Submarine, game.ref(12, 4));
    // An enemy warship eleven tiles off: unseen, and not the submarine's prey.
    const far = sail(b, UnitType.Warship, game.ref(13, 15));
    ticks(2);
    expect(sub.targetUnit()).toBeUndefined();
    expect(far.targetUnit()).toBeUndefined();
    // A warship inside the detection range sees it (both patrol, so read
    // it straight after the first targeting tick).
    const near = sail(b, UnitType.Warship, game.ref(12, 6));
    ticks(1);
    expect(near.targetUnit()).toBe(sub);
    expect(sub.targetUnit()).toBeUndefined(); // still not its prey
    near.delete(false);
    far.delete(false);
    // A transport crossing its patrol is.
    game.addExecution(new TransportShipExecution(b, game.ref(3, 3), 1000));
    ticks(3);
    const transport = b.units(UnitType.TransportShip)[0];
    expect(transport).toBeDefined();
    let hunted = false;
    for (let i = 0; i < 40 && !hunted; i++) {
      game.executeNextTick();
      hunted = sub.targetUnit() === transport;
    }
    expect(hunted).toBe(true);
    vi.restoreAllMocks();
  });

  it("is seen from afar under one of the enemy's radars", () => {
    // Detection pinned to nothing, so the only way to see it is the radar.
    vi.spyOn(game.config(), "submarineDetectionRange").mockReturnValue(0);
    vi.spyOn(game.config(), "radarRange").mockReturnValue(12);
    const sub = sail(a, UnitType.Submarine, game.ref(12, 4));
    const far = sail(b, UnitType.Warship, game.ref(13, 15));
    ticks(2);
    expect(far.targetUnit()).toBeUndefined();
    b.buildUnit(UnitType.Radar, game.ref(7, 12), {}); // ~9 tiles from the sub
    ticks(2);
    expect(far.targetUnit()).toBe(sub);
    vi.restoreAllMocks();
  });

  it("answers the warship move order", () => {
    const sub = sail(a, UnitType.Submarine, game.ref(12, 4));
    game.addExecution(
      new MoveWarshipExecution(a, [sub.id()], game.ref(14, 10)),
    );
    ticks(2);
    expect(sub.warshipState().patrolTile).toBe(game.ref(14, 10));
  });
});

describe("a Naval nation", () => {
  it("lays down a submarine as its second hull, and not with the lever off", () => {
    const first = a.buildUnit(UnitType.Warship, game.ref(12, 4), {
      patrolTile: game.ref(12, 4),
    });
    expect(first.isActive()).toBe(true);
    a.addGold(1_000_000_000n);
    const random = new PseudoRandom(1);
    vi.spyOn(random, "chance").mockReturnValue(true);
    const behavior = new NationWarshipBehavior(
      random,
      game,
      a,
      new NationEmojiBehavior(random, game, a),
    );
    vi.spyOn(behavior as any, "warshipSpawnTile").mockReturnValue(
      game.ref(14, 4),
    );
    a.setDoctrine(Doctrine.Naval);
    vi.spyOn(game.config(), "submarineNationEnabled").mockReturnValue(false);
    expect(behavior.maybeSpawnWarship()).toBe(true);
    game.executeNextTick();
    game.executeNextTick();
    expect(a.units(UnitType.Submarine).length).toBe(0);
    expect(a.units(UnitType.Warship).length).toBe(2);
    vi.restoreAllMocks();
    // The lever on: with a warship and no submarine, the next hull hides.
    a.units(UnitType.Warship)[1].delete(false);
    const random2 = new PseudoRandom(1);
    vi.spyOn(random2, "chance").mockReturnValue(true);
    const behavior2 = new NationWarshipBehavior(
      random2,
      game,
      a,
      new NationEmojiBehavior(random2, game, a),
    );
    vi.spyOn(behavior2 as any, "warshipSpawnTile").mockReturnValue(
      game.ref(14, 4),
    );
    expect(behavior2.maybeSpawnWarship()).toBe(true);
    game.executeNextTick();
    game.executeNextTick();
    expect(a.units(UnitType.Submarine).length).toBe(1);
    vi.restoreAllMocks();
  });
});
