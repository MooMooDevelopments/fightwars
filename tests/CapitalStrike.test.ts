import { beforeEach, describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { CapitalStrikeExecution } from "../src/core/execution/CapitalStrikeExecution";
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

class CapitalStrikeOn extends TestConfig {
  capitalStrike(): boolean {
    return true;
  }
}

/**
 * Capital Strike (brief §6.7): a nation whose capital — its spawn tile — is
 * taken by another player collapses into rebels raised against the taker.
 */
describe("Capital Strike", () => {
  let game: Game;
  let striker: Player;
  let nation: Player;

  async function start(config?: typeof Config, withExecution = true) {
    game = await setup(
      "plains",
      {},
      [
        new PlayerInfo("striker", PlayerType.Human, "c-s", "striker"),
        new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
      ],
      undefined,
      config,
    );
    striker = game.player("striker");
    nation = game.player("nation");
    game.addExecution(
      new SpawnExecution("test", striker.info(), game.ref(50, 50)),
      new SpawnExecution("test", nation.info(), game.ref(20, 20)),
    );
    for (let i = 0; i < 3; i++) game.executeNextTick();
    while (game.inSpawnPhase()) game.executeNextTick();
    expect(nation.isAlive()).toBe(true);
    if (withExecution) game.addExecution(new CapitalStrikeExecution());
  }

  const run = (n: number) => {
    for (let i = 0; i < n; i++) game.executeNextTick();
  };

  const rebelsOf = (name: string) =>
    game.players().find((p) => p.name() === `${name} Rebels`);

  beforeEach(async () => {
    await start(CapitalStrikeOn as unknown as typeof Config);
  });

  it("collapses a nation into rebels when another player takes its capital", () => {
    const capital = nation.spawnTile()!;
    const land = nation.numTilesOwned();
    expect(land).toBeGreaterThan(1);
    // On the nation's other ground: a structure on the capital tile itself
    // is the striker's the moment the tile is.
    const elsewhere = [...nation.tiles()].find((t) => t !== capital)!;
    const post = nation.buildUnit(UnitType.DefensePost, elsewhere, {});
    nation.setTroops(12345);
    striker.conquer(capital);
    run(11);
    expect(nation.isAlive()).toBe(false);
    expect(nation.numTilesOwned()).toBe(0);
    const rebels = rebelsOf("nation")!;
    expect(rebels).toBeDefined();
    expect(rebels.type()).toBe(PlayerType.Bot);
    expect(rebels.partisanOf()?.name()).toBe(striker.name());
    expect(rebels.numTilesOwned()).toBe(land - 1);
    expect(rebels.troops()).toBeGreaterThanOrEqual(12345);
    expect(nation.troops()).toBe(0);
    expect(post.owner().name()).toBe(rebels.name());
    expect(game.owner(capital) === striker).toBe(true);
  });

  it("does nothing when the capital is merely lost, not taken", () => {
    const capital = nation.spawnTile()!;
    nation.relinquish(capital);
    game.setFallout(capital, true);
    run(11);
    expect(nation.isAlive()).toBe(true);
    expect(rebelsOf("nation")).toBeUndefined();
  });

  it("leaves a nation alone while it holds its own capital", () => {
    run(50);
    expect(nation.isAlive()).toBe(true);
    expect(rebelsOf("nation")).toBeUndefined();
  });

  it("never runs when the lobby did not ask for it", async () => {
    await start(undefined, false);
    expect(game.config().capitalStrike()).toBe(false);
    striker.conquer(nation.spawnTile()!);
    run(11);
    expect(nation.isAlive()).toBe(true);
    expect(rebelsOf("nation")).toBeUndefined();
  });
});
