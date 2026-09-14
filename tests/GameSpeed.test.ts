import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { GameMapType, UnitType } from "../src/core/game/Game";
import { UserSettings } from "../src/core/game/UserSettings";
import { GameConfig, GameConfigSchema } from "../src/core/Schemas";
import { ShadowSimLike } from "../src/server/ShadowSim";
import { cid, makeClient, makeGame, startGame } from "./util/GameServerHarness";
import { testGameConfig } from "./util/Wire";

/**
 * Game speed (brief §6.7, the engine under Blitz): turns per 100 ms of wall
 * clock. The simulation never reads it; the server commits turns faster.
 */
describe("game speed", () => {
  it("is 1 unless the lobby says otherwise, and rides the config schema", () => {
    const plain = new Config(testGameConfig(), new UserSettings(), false);
    expect(plain.gameSpeed()).toBe(1);
    const fast = new Config(
      testGameConfig({ gameSpeed: 4 }),
      new UserSettings(),
      false,
    );
    expect(fast.gameSpeed()).toBe(4);
    expect(
      GameConfigSchema.safeParse(testGameConfig({ gameSpeed: 4 })).success,
    ).toBe(true);
    expect(
      GameConfigSchema.safeParse(testGameConfig({ gameSpeed: 5 })).success,
    ).toBe(false);
    expect(
      GameConfigSchema.safeParse(testGameConfig({ gameSpeed: 0 })).success,
    ).toBe(false);
  });

  describe("on the server", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    const turnsIn = (ms: number, config: Partial<GameConfig>) => {
      const applyTurn = vi.fn();
      const game = makeGame({
        config,
        deps: {
          shadowSim: () =>
            ({
              start: async () => {},
              applyTurn,
              check: () => null,
              hashAt: () => null,
              winResult: () => null,
            }) as unknown as ShadowSimLike,
        },
      });
      game.joinClient(makeClient({ clientID: cid("a") }));
      startGame(game);
      vi.advanceTimersByTime(ms);
      return applyTurn.mock.calls.length;
    };

    it("commits turns as many times faster as the lobby asked", () => {
      expect(turnsIn(1000, {})).toBe(10);
      expect(turnsIn(1000, { gameSpeed: 2 })).toBe(20);
      expect(turnsIn(1000, { gameSpeed: 4 })).toBe(40);
    });
  });

  it("does not touch the simulation: the same turns give the same game", () => {
    // Sanity on the claim that a tick is a tick: speed lives outside the
    // sim, so nothing in Config that the sim reads changes with it.
    const a = new Config(testGameConfig(), new UserSettings(), false);
    const b = new Config(
      testGameConfig({ gameSpeed: 4 }),
      new UserSettings(),
      false,
    );
    expect(b.numSpawnPhaseTurns()).toBe(a.numSpawnPhaseTurns());
    expect(b.emojiMessageCooldown()).toBe(a.emojiMessageCooldown());
    expect(b.unitInfo(UnitType.City).cost).toBeDefined();
    expect(b.gameConfig().gameMap).toBe(GameMapType.World);
  });
});
