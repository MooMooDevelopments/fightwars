import { Config } from "../../src/core/configuration/Config";
import { PlayerExecution } from "../../src/core/execution/PlayerExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { UserSettings } from "../../src/core/game/UserSettings";
import { GameConfig } from "../../src/core/Schemas";
import { setup } from "../util/Setup";

/**
 * Nuke consequences (brief §6.4). Fallout used to be a mark that lasted
 * exactly until someone walked onto it. Now it has a clock, it outlasts
 * conquest, the owned land under it counts for nothing, and past a
 * threshold of the world burning everyone recruits less — the nuker too.
 */

let game: Game;
let player: Player;

beforeEach(async () => {
  game = await setup("plains", { infiniteGold: true, instantBuild: true }, [
    new PlayerInfo("owner", PlayerType.Human, "c-o", "owner"),
  ]);
  player = game.player("owner");
  for (let y = 10; y < 30; y++) {
    for (let x = 10; x < 30; x++) player.conquer(game.ref(x, y));
  }
  while (game.inSpawnPhase()) game.executeNextTick();
});

/** Ticks until the expiry sweep after `duration` more ticks have passed. */
function tickPast(duration: number) {
  for (let i = 0; i < duration; i++) game.executeNextTick();
  while (game.ticks() % 10 !== 0) game.executeNextTick();
  game.executeNextTick();
}

describe("fallout has a clock", () => {
  it("clears itself after the duration, and not before", () => {
    const tile = game.ref(50, 50); // unowned
    game.setFallout(tile, true);
    expect(game.hasFallout(tile)).toBe(true);
    const duration = game.config().falloutDurationTicks();
    for (let i = 0; i < duration - 20; i++) game.executeNextTick();
    expect(game.hasFallout(tile)).toBe(true);
    tickPast(30);
    expect(game.hasFallout(tile)).toBe(false);
  });

  it("outlasts conquest and counts against the new owner until it expires", () => {
    const tile = game.ref(50, 50);
    game.setFallout(tile, true);
    expect(player.numIrradiatedTiles()).toBe(0);
    player.conquer(tile);
    expect(game.hasFallout(tile)).toBe(true);
    expect(player.numIrradiatedTiles()).toBe(1);

    tickPast(game.config().falloutDurationTicks());
    expect(game.hasFallout(tile)).toBe(false);
    expect(player.numIrradiatedTiles()).toBe(0);
  });

  it("leaves the count with whoever holds the tile", () => {
    const tile = game.ref(50, 50);
    game.setFallout(tile, true);
    player.conquer(tile);
    player.relinquish(tile);
    expect(player.numIrradiatedTiles()).toBe(0);
    expect(game.hasFallout(tile)).toBe(true);
  });
});

describe("irradiated land produces nothing", () => {
  it("does not count toward the troop cap", () => {
    const before = game.config().maxTroops(player);
    for (let x = 10; x < 30; x++) {
      const tile = game.ref(x, 10);
      player.relinquish(tile);
      game.setFallout(tile, true);
      player.conquer(tile);
    }
    expect(player.numIrradiatedTiles()).toBe(20);
    expect(player.numTilesOwned()).toBe(400);
    expect(game.config().maxTroops(player)).toBeLessThan(before);
  });

  it("silences a city standing on it", () => {
    const city = player.buildUnit(UnitType.City, game.ref(15, 15), {});
    const withCity = game.config().maxTroops(player);
    player.relinquish(city.tile());
    game.setFallout(city.tile(), true);
    player.conquer(city.tile());
    expect(city.isIrradiated()).toBe(true);
    // One tile's worth less land, and the whole city's worth less cap.
    expect(withCity - game.config().maxTroops(player)).toBeGreaterThan(
      game.config().cityTroopIncrease() - 1,
    );
  });
});

describe("a burning world recruits less", () => {
  const config = new Config({} as GameConfig, new UserSettings(), false);

  it("costs nothing below the threshold and up to the depth past it", () => {
    const t = config.falloutRegenThreshold();
    expect(config.falloutRegenModifier(0)).toBe(1);
    expect(config.falloutRegenModifier(t)).toBe(1);
    expect(config.falloutRegenModifier(1)).toBeCloseTo(
      1 - config.falloutRegenDepth(),
    );
    expect(config.falloutRegenModifier((1 + t) / 2)).toBeCloseTo(
      1 - config.falloutRegenDepth() / 2,
    );
  });

  it("reaches the troop rate through the world ratio", () => {
    const clean = game.config().troopIncreaseRate(player, 0);
    const burning = game.config().troopIncreaseRate(player, 0.5);
    expect(burning).toBeLessThan(clean);
    expect(burning / clean).toBeCloseTo(
      game.config().falloutRegenModifier(0.5),
      6,
    );
  });

  it("is what the player execution feeds in", () => {
    // Irradiate half the map's land while the player holds none of it, then
    // compare a tick of growth against a clean world.
    game.addExecution(new PlayerExecution(player));
    game.executeNextTick();
    const cleanBefore = player.troops();
    game.executeNextTick();
    const cleanGrowth = player.troops() - cleanBefore;

    const land = game.numLandTiles();
    let burned = 0;
    for (let y = 40; y < 100 && burned < land / 2; y++) {
      for (let x = 0; x < 100 && burned < land / 2; x++) {
        const tile = game.ref(x, y);
        if (game.isLand(tile) && !game.hasOwner(tile)) {
          game.setFallout(tile, true);
          burned++;
        }
      }
    }
    const burningBefore = player.troops();
    game.executeNextTick();
    const burningGrowth = player.troops() - burningBefore;
    expect(burningGrowth).toBeLessThan(cleanGrowth);
  });
});

describe("crossing irradiated ground", () => {
  const config = new Config({} as GameConfig, new UserSettings(), false);

  it("gets harder as the world burns, not easier", () => {
    expect(config.falloutDefenseModifier(0)).toBe(3);
    expect(config.falloutDefenseModifier(1)).toBe(5);
    expect(config.falloutDefenseModifier(0.5)).toBeGreaterThan(
      config.falloutDefenseModifier(0.1),
    );
  });
});

describe("nuclear winter", () => {
  it("advances the existing clock by seconds per share of the world burned", () => {
    const config = new Config({} as GameConfig, new UserSettings(), false);
    expect(
      config.doomsdayClockConfig().nuclearWinterSecondsPerFalloutShare,
    ).toBeGreaterThan(0);
  });
});
