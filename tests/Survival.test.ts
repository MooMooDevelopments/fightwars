import { describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { SurvivalExecution } from "../src/core/execution/SurvivalExecution";
import {
  ColoredTeams,
  Game,
  GameMode,
  HumansVsNations,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

/** Waves every two seconds, a six-second clock. */
class FastSurvival extends TestConfig {
  survival(): boolean {
    return true;
  }
  survivalWaveTicks(): number {
    return 20;
  }
  survivalSeconds(): number {
    return 6;
  }
}

/**
 * Survival (brief §6.7): humans against nations that reinforce in waves;
 * outlast the clock to win, lose the last human to lose.
 */
describe("Survival", () => {
  let game: Game;
  let human: Player;
  let nation: Player;
  let survival: SurvivalExecution;

  async function start(config?: typeof Config, withExecution = true) {
    const nationInfo = new PlayerInfo(
      "nation",
      PlayerType.Nation,
      null,
      "nation",
    );
    game = await setup(
      "plains",
      { gameMode: GameMode.Team, playerTeams: HumansVsNations },
      [new PlayerInfo("human", PlayerType.Human, "c-h", "human")],
      undefined,
      config,
      true,
      [new Nation(undefined, nationInfo)],
    );
    human = game.player("human");
    nation = game.player("nation");
    game.addExecution(
      new SpawnExecution("test", human.info(), game.ref(50, 50)),
      new SpawnExecution("test", nation.info(), game.ref(15, 15)),
    );
    for (let i = 0; i < 3; i++) game.executeNextTick();
    while (game.inSpawnPhase()) game.executeNextTick();
    expect(human.isAlive()).toBe(true);
    expect(nation.isAlive()).toBe(true);
    survival = new SurvivalExecution();
    if (withExecution) game.addExecution(survival);
  }

  const run = (n: number) => {
    for (let i = 0; i < n; i++) game.executeNextTick();
  };

  it("puts the humans and the nations on opposite sides", async () => {
    await start(FastSurvival as unknown as typeof Config);
    expect(human.team()).toBe(ColoredTeams.Humans);
    expect(nation.team()).toBe(ColoredTeams.Nations);
  });

  it("reinforces every nation on each wave, more each time", async () => {
    await start(FastSurvival as unknown as typeof Config);
    nation.setTroops(1000);
    const max = game.config().maxTroops(nation);
    const share = game.config().survivalWaveTroopShare();
    const gold0 = nation.gold();
    let waves = 0;
    let firstJump = 0;
    let secondJump = 0;
    let humanJump = 0;
    let secondFloor = 0;
    for (let i = 0; i < 60 && waves < 2; i++) {
      const before = nation.troops();
      const humanBefore = human.troops();
      const maxBefore = game.config().maxTroops(nation);
      game.executeNextTick();
      if (survival.waves() > waves) {
        waves = survival.waves();
        const jump = nation.troops() - before;
        if (waves === 1) {
          firstJump = jump;
          humanJump = human.troops() - humanBefore;
        } else {
          secondJump = jump;
          // Wave two is twice the share of the ceiling as it stood.
          secondFloor = Math.floor(maxBefore * share * 2);
        }
      }
    }
    expect(waves).toBe(2);
    expect(firstJump).toBeGreaterThanOrEqual(Math.floor(max * share));
    expect(secondJump).toBeGreaterThan(firstJump);
    expect(secondJump).toBeGreaterThanOrEqual(secondFloor);
    expect(nation.gold()).toBeGreaterThanOrEqual(
      gold0 + game.config().survivalWaveGold() * 3n,
    );
    // The humans are not reinforced: their tick is regeneration alone.
    expect(humanJump).toBeLessThan(Math.floor(max * share));
  });

  it("hands the humans the game when the clock runs out with one alive", async () => {
    await start(FastSurvival as unknown as typeof Config);
    run(50);
    expect(game.getWinner()).toBeNull();
    run(30);
    expect(game.getWinner()).toBe(ColoredTeams.Humans);
    expect(survival.isActive()).toBe(false);
  });

  it("hands the nations the game the moment the last human falls", async () => {
    await start(FastSurvival as unknown as typeof Config);
    for (const tile of [...human.tiles()]) human.relinquish(tile);
    expect(human.isAlive()).toBe(false);
    run(11);
    expect(game.getWinner()).toBe(ColoredTeams.Nations);
  });

  it("never runs when the lobby did not ask for it", async () => {
    await start(undefined, false);
    expect(game.config().survival()).toBe(false);
    run(80);
    expect(game.getWinner()).toBeNull();
  });
});
