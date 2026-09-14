import { Config } from "../src/core/configuration/Config";
import { MissileSiloExecution } from "../src/core/execution/MissileSiloExecution";
import { NationExecution } from "../src/core/execution/NationExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { SAMLauncherExecution } from "../src/core/execution/SAMLauncherExecution";
import {
  BuildableAttacks,
  Cell,
  Difficulty,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { UserSettings } from "../src/core/game/UserSettings";
import { GameConfig } from "../src/core/Schemas";
import { unitTypeToBombUnit } from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

/** The production table: TestConfig flattens magnitudes and speeds. */
const real = new Config({} as GameConfig, new UserSettings(), false);

/**
 * Bomber (brief §6.4, session 12). A conventional strike: it flies from a
 * silo and lands like an atom bomb, kills troops and destroys the units in
 * a small radius, and burns nothing — the land keeps its owner, nothing
 * turns to water or fallout. SAMs can shoot it down.
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
  victim.setTroops(200_000);
});

/** Fly a bomber from the attacker's silo to `dst` and land it. */
function strike(dst: number): void {
  game.addExecution(new NukeExecution(UnitType.Bomber, attacker, dst));
  for (let i = 0; i < 400; i++) {
    game.executeNextTick();
    if (attacker.units(UnitType.Bomber).length === 0 && i > 2) break;
  }
  expect(attacker.units(UnitType.Bomber).length).toBe(0);
}

describe("the unit", () => {
  it("is a buildable attack with a materials price and a stats key, flown from a silo", () => {
    expect(BuildableAttacks.has(UnitType.Bomber)).toBe(true);
    expect(real.unitMaterialsCost(UnitType.Bomber)).toBe(600n);
    expect(real.nukeMagnitudes(UnitType.Bomber)).toEqual({
      inner: 4,
      outer: 8,
    });
    expect(real.nukeSpeed(UnitType.Bomber)).toBe(8);
    expect(unitTypeToBombUnit[UnitType.Bomber]).toBe("bombr");
    // No silo, no bomber; with one, it launches from it.
    expect(attacker.canBuild(UnitType.Bomber, game.ref(70, 70))).toBe(false);
    const silo = attacker.buildUnit(UnitType.MissileSilo, game.ref(20, 20), {});
    expect(attacker.canBuild(UnitType.Bomber, game.ref(70, 70))).toBe(
      silo.tile(),
    );
  });
});

describe("a strike", () => {
  beforeEach(() => {
    attacker.buildUnit(UnitType.MissileSilo, game.ref(20, 20), {});
    // The real blast, not the test config's one-tile one.
    vi.spyOn(game.config(), "nukeMagnitudes").mockImplementation((t) =>
      real.nukeMagnitudes(t),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("destroys what stands in its radius and kills troops, and burns nothing", () => {
    const dst = game.ref(70, 70);
    const post = victim.buildUnit(UnitType.DefensePost, game.ref(72, 70), {});
    const farCity = victim.buildUnit(UnitType.City, game.ref(85, 85), {});
    const tilesBefore = victim.numTilesOwned();
    const troopsBefore = victim.troops();
    const falloutBefore = game.numTilesWithFallout();

    strike(dst);

    expect(post.isActive()).toBe(false);
    expect(farCity.isActive()).toBe(true);
    expect(victim.troops()).toBeLessThan(troopsBefore);
    // Conventional: the land is still the victim's, nothing burned.
    expect(victim.numTilesOwned()).toBe(tilesBefore);
    expect(game.owner(dst)).toBe(victim);
    expect(game.isLand(dst)).toBe(true);
    expect(game.numTilesWithFallout()).toBe(falloutBefore);
  });

  it("is an atom bomb's opposite on the ground: the same landing turns land to fallout", () => {
    const dst = game.ref(70, 70);
    const tilesBefore = victim.numTilesOwned();
    game.addExecution(new NukeExecution(UnitType.AtomBomb, attacker, dst));
    for (let i = 0; i < 400; i++) {
      game.executeNextTick();
      if (attacker.units(UnitType.AtomBomb).length === 0 && i > 2) break;
    }
    expect(victim.numTilesOwned()).toBeLessThan(tilesBefore);
  });

  it("can be shot down: a SAM lists it among its targets", () => {
    const sam = victim.buildUnit(UnitType.SAMLauncher, game.ref(60, 60), {});
    const samExec = new SAMLauncherExecution(victim, null, sam);
    game.addExecution(samExec);
    game.executeNextTick();
    game.addExecution(
      new NukeExecution(UnitType.Bomber, attacker, game.ref(62, 62)),
    );
    game.executeNextTick();
    game.executeNextTick();
    const bomber = attacker.units(UnitType.Bomber)[0];
    expect(bomber).toBeDefined();
    // The launcher lists a bomber among what it intercepts (the whitelist),
    // so on the intercept tick a missile goes up: the bomber lands two
    // tiles from a SAM whose range is twenty.
    let shot = false;
    for (let i = 0; i < 400 && !shot; i++) {
      game.executeNextTick();
      shot = victim.units(UnitType.SAMMissile).length > 0;
      if (attacker.units(UnitType.Bomber).length === 0) break;
    }
    expect(shot).toBe(true);
  });
});

describe("a nation", () => {
  it("flies a bomber when it holds a silo but cannot afford a warhead, and not with the lever off", async () => {
    // Impossible with two players: findBestNukeTarget returns the human.
    for (const enabled of [true, false]) {
      const g = await setup("big_plains", {
        difficulty: Difficulty.Impossible,
        infiniteGold: true,
        instantBuild: true,
      });
      const nationInfo = new PlayerInfo("nation", PlayerType.Nation, null, "n");
      const humanInfo = new PlayerInfo("human", PlayerType.Human, null, "h");
      g.addPlayer(nationInfo);
      g.addPlayer(humanInfo);
      const nation = g.player("n");
      const human = g.player("h");
      for (let x = 10; x < 40; x++) {
        for (let y = 10; y < 40; y++) {
          const t = g.ref(x, y);
          if (g.map().isLand(t)) nation.conquer(t);
        }
      }
      for (let x = 60; x < 90; x++) {
        for (let y = 60; y < 90; y++) {
          const t = g.ref(x, y);
          if (g.map().isLand(t)) human.conquer(t);
        }
      }
      const silo = nation.buildUnit(UnitType.MissileSilo, g.ref(25, 25), {});
      g.addExecution(new MissileSiloExecution(silo));
      // Something worth striking: Impossible sends nothing at a bare field.
      human.buildUnit(UnitType.City, g.ref(75, 75), {});
      // Enough gold for a bomber (250k), never for an atom bomb (750k).
      nation.addGold(400_000n);
      nation.addMaterials(1_000_000n);
      nation.addTroops(100_000);
      human.addTroops(100_000);
      vi.spyOn(g.config(), "bomberNationEnabled").mockReturnValue(enabled);

      const exec = new NationExecution(
        "bomber-nation",
        new Nation(new Cell(25, 25), nation.info()),
      );
      exec.init(g);
      let flew = false;
      for (let tick = 0; tick < 300 && !flew; tick++) {
        // Held at 400k: the nation spends on cities otherwise, and the
        // point is a treasury that buys a bomber and never a warhead.
        nation.addGold(400_000n - nation.gold());
        exec.tick(tick);
        if (tick % 10 === 0) g.executeNextTick();
        flew = nation.units(UnitType.Bomber).length > 0;
      }
      expect(nation.units(UnitType.AtomBomb).length).toBe(0);
      expect(flew).toBe(enabled);
      vi.restoreAllMocks();
    }
  });
});
