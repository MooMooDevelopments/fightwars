import { describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { KingOfTheHillExecution } from "../src/core/execution/KingOfTheHillExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

/** A hill of radius 5 on a 100-tile map, won after three seconds of holding. */
class FastHill extends TestConfig {
  kingOfTheHill(): boolean {
    return true;
  }
  hillRadiusPercent(): number {
    return 5;
  }
  hillSecondsToWin(): number {
    return 3;
  }
}

/**
 * King of the Hill (brief §6.7): the player holding the most of the hill
 * scores a second every second; the first to the target wins.
 */
describe("King of the Hill", () => {
  let game: Game;
  let king: Player;
  let edge: Player;
  let hill: KingOfTheHillExecution;

  async function start(map: string, kingAt: [number, number]) {
    game = await setup(
      map,
      {},
      [
        new PlayerInfo("king", PlayerType.Human, "c-k", "king"),
        new PlayerInfo("edge", PlayerType.Human, "c-e", "edge"),
      ],
      undefined,
      FastHill as unknown as typeof Config,
    );
    king = game.player("king");
    edge = game.player("edge");
    game.addExecution(
      new SpawnExecution("test", king.info(), game.ref(...kingAt)),
      new SpawnExecution("test", edge.info(), game.ref(15, 15)),
    );
    for (let i = 0; i < 3; i++) game.executeNextTick();
    while (game.inSpawnPhase()) game.executeNextTick();
    hill = new KingOfTheHillExecution();
    game.addExecution(hill);
    game.executeNextTick();
  }

  const run = (n: number) => {
    for (let i = 0; i < n; i++) game.executeNextTick();
  };

  it("sits on the map's centre and is made of land", async () => {
    await start("plains", [50, 50]);
    expect(hill.centre()).toEqual([50, 50]);
    expect(hill.hillRadius()).toBe(5);
    expect(hill.tiles().length).toBeGreaterThan(60);
    for (const t of hill.tiles()) expect(game.isLand(t)).toBe(true);
  });

  it("scores the holder every second and hands them the game at the target", async () => {
    await start("plains", [50, 50]);
    expect(hill.holder()).toBe(king);
    expect(hill.score(king)).toBe(0);
    run(10);
    expect(hill.score(king)).toBe(1);
    expect(hill.score(edge)).toBe(0);
    expect(game.getWinner()).toBeNull();
    run(20);
    expect(hill.score(king)).toBe(3);
    expect(game.getWinner()).toBe(king);
    expect(hill.isActive()).toBe(false);
  });

  it("scores nobody while the hill is empty", async () => {
    await start("plains", [80, 80]);
    expect(hill.holder()).toBeNull();
    run(40);
    expect(hill.score(king)).toBe(0);
    expect(hill.score(edge)).toBe(0);
    expect(game.getWinner()).toBeNull();
  });

  it("scores nobody on a tie", async () => {
    await start("plains", [80, 80]);
    const tiles = hill.tiles();
    king.conquer(tiles[0]);
    edge.conquer(tiles[1]);
    expect(hill.holder()).toBeNull();
    run(10);
    expect(hill.score(king)).toBe(0);
    expect(hill.score(edge)).toBe(0);
    king.conquer(tiles[2]);
    expect(hill.holder()).toBe(king);
  });

  it("moves the hill to the nearest land when the centre is water", async () => {
    // half_land_half_ocean is 16 x 16: x < 8 land, x >= 8 ocean, on every row.
    game = await setup(
      "half_land_half_ocean",
      {},
      [new PlayerInfo("king", PlayerType.Human, "c-k", "king")],
      undefined,
      FastHill as unknown as typeof Config,
    );
    hill = new KingOfTheHillExecution();
    game.addExecution(hill);
    game.executeNextTick();
    const [cx] = hill.centre();
    expect(cx).toBe(7);
    expect(hill.tiles().length).toBeGreaterThan(0);
    for (const t of hill.tiles()) expect(game.isLand(t)).toBe(true);
  });

  it("never runs when the lobby did not ask for it", async () => {
    const plain = await setup("plains", {}, [
      new PlayerInfo("king", PlayerType.Human, "c-k", "king"),
    ]);
    expect(plain.config().kingOfTheHill()).toBe(false);
  });
});
