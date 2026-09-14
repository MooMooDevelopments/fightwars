import { beforeEach, describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { BattleRoyaleExecution } from "../src/core/execution/BattleRoyaleExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

/** A Battle Royale that shrinks at once, fast, in four steps, one row-sweep per tick. */
class FastRoyale extends TestConfig {
  battleRoyale(): boolean {
    return true;
  }
  battleRoyaleGraceTicks(): number {
    return 0;
  }
  battleRoyaleIntervalTicks(): number {
    return 20;
  }
  battleRoyaleSteps(): number {
    return 4;
  }
  battleRoyaleFinalRadiusPercent(): number {
    return 10;
  }
  battleRoyaleRowsPerTick(): number {
    return 1000;
  }
}

/**
 * Battle Royale (brief §6.7): a circle on the map's centre that shrinks on
 * a schedule; land outside is irradiated and let go of, units on it die.
 */
describe("Battle Royale", () => {
  let game: Game;
  let centre: Player;
  let edge: Player;
  let royale: BattleRoyaleExecution;

  beforeEach(async () => {
    game = await setup(
      "plains",
      {},
      [
        new PlayerInfo("centre", PlayerType.Human, "c-c", "centre"),
        new PlayerInfo("edge", PlayerType.Human, "c-e", "edge"),
      ],
      undefined,
      FastRoyale as unknown as typeof Config,
    );
    centre = game.player("centre");
    edge = game.player("edge");
    const cx = Math.floor(game.width() / 2);
    const cy = Math.floor(game.height() / 2);
    game.addExecution(
      new SpawnExecution("test", centre.info(), game.ref(cx, cy)),
      new SpawnExecution("test", edge.info(), game.ref(15, 15)),
    );
    // A spawn lands on its second tick; the zone is added once both are home.
    for (let i = 0; i < 3; i++) game.executeNextTick();
    expect(centre.isAlive()).toBe(true);
    expect(edge.isAlive()).toBe(true);
    royale = new BattleRoyaleExecution();
    game.addExecution(royale);
    game.executeNextTick();
  });

  const run = (n: number) => {
    for (let i = 0; i < n; i++) game.executeNextTick();
  };

  it("starts wide enough to hold every tile and shrinks toward the centre in steps", () => {
    const r0 = royale.radius();
    expect(royale.inZone(game.ref(0, 0))).toBe(true);
    expect(royale.shrinks()).toBe(0);
    run(21);
    expect(royale.shrinks()).toBe(1);
    expect(royale.radius()).toBeLessThan(r0);
    run(80);
    expect(royale.shrinks()).toBe(4);
    run(50);
    expect(royale.shrinks()).toBe(4);
    expect(royale.radius()).toBe(Math.floor(r0 * 0.1) || 1);
  });

  it("irradiates the land outside the zone and takes it from its owner", () => {
    const corner = edge.spawnTile()!;
    expect(game.owner(corner)).toBe(edge);
    expect(royale.inZone(corner)).toBe(true);
    run(101);
    expect(game.hasFallout(corner)).toBe(true);
    expect(game.owner(corner).isPlayer()).toBe(false);
    expect(edge.numTilesOwned()).toBe(0);
    expect(game.numTilesWithFallout()).toBeGreaterThan(0);
  });

  it("leaves the centre's land alone", () => {
    const cx = Math.floor(game.width() / 2);
    const cy = Math.floor(game.height() / 2);
    run(101);
    expect(game.hasFallout(game.ref(cx, cy))).toBe(false);
    expect(game.owner(game.ref(cx, cy))).toBe(centre);
    expect(centre.numTilesOwned()).toBeGreaterThan(0);
  });

  it("destroys a unit left outside the zone", () => {
    expect(edge.isAlive()).toBe(true);
    const post = edge.buildUnit(UnitType.DefensePost, edge.spawnTile()!, {});
    expect(post.isActive()).toBe(true);
    // A ship of the survivor's, on ground nobody owns: nothing but the zone
    // can take it (a structure goes down with its land already).
    const far = game.ref(5, 5);
    expect(game.owner(far).isPlayer()).toBe(false);
    const ship = centre.buildUnit(UnitType.Warship, far, {});
    expect(ship.isActive()).toBe(true);
    run(101);
    expect(post.isActive()).toBe(false);
    expect(centre.isAlive()).toBe(true);
    expect(royale.inZone(far)).toBe(false);
    expect(ship.isActive()).toBe(false);
  });

  it("takes back ground reclaimed outside the zone, and again once the fallout clears", () => {
    run(101);
    const corner = game.ref(15, 15);
    expect(royale.inZone(corner)).toBe(false);
    expect(game.owner(corner).isPlayer()).toBe(false);
    // The world's reach never ends at the last shrink: a conquest outside
    // the circle is undone within one pass of the sweep.
    centre.conquer(corner);
    expect(game.owner(corner)).toBe(centre);
    run(2);
    expect(game.owner(corner).isPlayer()).toBe(false);
    expect(game.hasFallout(corner)).toBe(true);
    // And clean ground outside stays irradiated past the fallout's lifetime.
    run(game.config().falloutDurationTicks() + 5);
    expect(game.hasFallout(corner)).toBe(true);
    expect(game.owner(corner).isPlayer()).toBe(false);
  });

  it("never runs when the lobby did not ask for it", async () => {
    const plain = await setup("plains", {}, [
      new PlayerInfo("edge", PlayerType.Human, "c-e", "edge"),
    ]);
    const p = plain.player("edge");
    plain.addExecution(new SpawnExecution("test", p.info(), plain.ref(15, 15)));
    while (plain.inSpawnPhase()) plain.executeNextTick();
    for (let i = 0; i < 200; i++) plain.executeNextTick();
    expect(plain.config().battleRoyale()).toBe(false);
    const home = p.spawnTile()!;
    expect(home).toBeDefined();
    expect(plain.hasFallout(home)).toBe(false);
    expect(plain.owner(home)).toBe(p);
  });
});
