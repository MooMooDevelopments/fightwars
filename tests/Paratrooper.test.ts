import { ParatrooperExecution } from "../src/core/execution/ParatrooperExecution";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  BuildableAttacks,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

/**
 * Paratrooper (brief §6.4, session 12). An airborne assault: a fifth of the
 * owner's troops fly from the nearest silo within range straight to the
 * target tile and land as an attack from there. The naval invasion's shape
 * with an air path; nothing intercepts it, so the silo's range, the troop
 * cap and the price are its limits.
 */

let game: Game;
let attacker: Player;
let victim: Player;

beforeEach(async () => {
  game = await setup("plains", { infiniteGold: true, instantBuild: true }, [
    new PlayerInfo("attacker", PlayerType.Human, "c-a", "attacker"),
    new PlayerInfo("victim", PlayerType.Human, "c-v", "victim"),
  ]);
  attacker = game.player("attacker");
  victim = game.player("victim");
  for (let y = 5; y < 40; y++) {
    for (let x = 5; x < 40; x++) attacker.conquer(game.ref(x, y));
  }
  for (let y = 50; y < 90; y++) {
    for (let x = 50; x < 90; x++) victim.conquer(game.ref(x, y));
  }
  attacker.addMaterials(1_000_000n);
  victim.addMaterials(1_000_000n);
  while (game.inSpawnPhase()) game.executeNextTick();
  attacker.setTroops(200_000);
  victim.setTroops(50_000);
});

function ticks(n: number) {
  for (let i = 0; i < n; i++) game.executeNextTick();
}

describe("the unit", () => {
  it("is a buildable attack flown from a silo in range, onto land it may take", () => {
    expect(BuildableAttacks.has(UnitType.Paratrooper)).toBe(true);
    const config = game.config();
    expect(config.unitMaterialsCost(UnitType.Paratrooper)).toBe(1000n);
    expect(config.paratrooperTroops(attacker)).toBe(25_000); // capped
    attacker.setTroops(50_000);
    expect(config.paratrooperTroops(attacker)).toBe(10_000); // a fifth
    // No silo: no drop.
    expect(attacker.canBuild(UnitType.Paratrooper, game.ref(70, 70))).toBe(
      false,
    );
    const silo = attacker.buildUnit(UnitType.MissileSilo, game.ref(30, 30), {});
    expect(attacker.canBuild(UnitType.Paratrooper, game.ref(70, 70))).toBe(
      silo.tile(),
    );
    // Not on the owner's own land, and not beyond the silo's range.
    expect(attacker.canBuild(UnitType.Paratrooper, game.ref(20, 20))).toBe(
      false,
    );
    vi.spyOn(config, "paratrooperRange").mockReturnValue(20);
    expect(attacker.canBuild(UnitType.Paratrooper, game.ref(70, 70))).toBe(
      false,
    );
    vi.restoreAllMocks();
  });
});

describe("a drop", () => {
  beforeEach(() => {
    attacker.buildUnit(UnitType.MissileSilo, game.ref(30, 30), {});
  });

  it("takes the troops at launch, flies, and lands as an attack from the target tile", () => {
    const dst = game.ref(70, 70);
    const troopsBefore = attacker.troops();
    const tilesBefore = victim.numTilesOwned();
    game.addExecution(new ParatrooperExecution(attacker, dst));
    game.executeNextTick(); // init: the plane is built and the troops leave
    const plane = attacker.units(UnitType.Paratrooper)[0];
    expect(plane).toBeDefined();
    const carried = game.config().paratrooperTroops({
      troops: () => troopsBefore,
    } as unknown as Player);
    expect(attacker.troops()).toBeCloseTo(troopsBefore - carried, 0);
    // It flies straight there and lands within a hundred ticks.
    let landed = false;
    for (let i = 0; i < 100 && !landed; i++) {
      game.executeNextTick();
      landed = attacker.units(UnitType.Paratrooper).length === 0;
    }
    expect(landed).toBe(true);
    expect(game.owner(dst)).toBe(attacker);
    const attack = attacker
      .outgoingAttacks()
      .find((a) => a.target() === victim);
    expect(attack).toBeDefined();
    ticks(30);
    expect(victim.numTilesOwned()).toBeLessThan(tilesBefore);
  });

  it("brings the troops home when the ground is its own by the time it lands", () => {
    const dst = game.ref(70, 70);
    const troopsBefore = attacker.troops();
    game.addExecution(new ParatrooperExecution(attacker, dst));
    game.executeNextTick();
    expect(attacker.units(UnitType.Paratrooper).length).toBe(1);
    attacker.conquer(dst); // the target changed hands in flight
    for (let i = 0; i < 100; i++) {
      game.executeNextTick();
      if (attacker.units(UnitType.Paratrooper).length === 0) break;
    }
    expect(attacker.units(UnitType.Paratrooper).length).toBe(0);
    expect(attacker.outgoingAttacks().length).toBe(0);
    // Everything that flew came back (troop growth aside, it cannot be less).
    expect(attacker.troops()).toBeGreaterThanOrEqual(troopsBefore * 0.99);
  });
});

describe("a nation", () => {
  it("drops rather than sails when a silo is in range, and sails with the lever off", () => {
    // The nation cannot reach the victim by land here, so sendAttack takes
    // the boat path; a silo in range turns that into a drop.
    attacker.buildUnit(UnitType.MissileSilo, game.ref(30, 30), {});
    attacker.addGold(1_000_000_000n);
    const behavior = new AiAttackBehavior(
      new PseudoRandom(7),
      game,
      attacker,
      0.5,
      0.3,
      0.1,
      null as any,
      null as any,
    );
    // Plains has no sea, so the boat path finds no shore and sends nothing;
    // what the lever decides is whether the drop goes first.
    const added: string[] = [];
    vi.spyOn(game, "addExecution").mockImplementation((e) => {
      added.push(e.constructor.name);
    });

    vi.spyOn(game.config(), "paratrooperNationEnabled").mockReturnValue(false);
    expect((behavior as any).sendBoatAttack(victim)).toBe(false);
    expect(added).toEqual([]);

    vi.spyOn(game.config(), "paratrooperNationEnabled").mockReturnValue(true);
    expect((behavior as any).sendBoatAttack(victim)).toBe(true);
    expect(added).toEqual(["ParatrooperExecution"]);
    vi.restoreAllMocks();
  });
});
