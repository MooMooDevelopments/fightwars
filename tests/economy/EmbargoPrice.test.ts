import { Config } from "../../src/core/configuration/Config";
import { Game, Player, PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { UserSettings } from "../../src/core/game/UserSettings";
import { GameConfig } from "../../src/core/Schemas";
import { setup } from "../util/Setup";

/**
 * Embargo price (brief §6.3): the embargoed side's remaining trade pays less
 * in proportion to how many of its possible partners have embargoed it. One
 * embargo is a nuisance; five are a siege — which is what makes trade denial
 * a coalition tool rather than a personal grudge.
 */

let game: Game;
let target: Player;
let a: Player;
let b: Player;
let c: Player;

beforeEach(async () => {
  game = await setup("plains", {}, [
    new PlayerInfo("target", PlayerType.Human, "c-t", "target"),
    new PlayerInfo("a", PlayerType.Human, "c-a", "a"),
    new PlayerInfo("b", PlayerType.Human, "c-b", "b"),
    new PlayerInfo("c", PlayerType.Human, "c-c", "c"),
  ]);
  [target, a, b, c] = ["target", "a", "b", "c"].map((id) => game.player(id));
  target.conquer(game.ref(10, 10));
  a.conquer(game.ref(20, 20));
  b.conquer(game.ref(30, 30));
  c.conquer(game.ref(40, 40));
  while (game.inSpawnPhase()) game.executeNextTick();
});

describe("embargo pressure", () => {
  it("is the share of possible partners embargoing you", () => {
    expect(target.embargoPressure()).toBe(0);
    a.addEmbargo(target, false);
    expect(target.embargoPressure()).toBeCloseTo(1 / 3);
    b.addEmbargo(target, false);
    expect(target.embargoPressure()).toBeCloseTo(2 / 3);
    c.addEmbargo(target, false);
    expect(target.embargoPressure()).toBe(1);
  });

  it("falls on the embargoed side, not the side that embargoes", () => {
    a.addEmbargo(target, false);
    expect(target.embargoPressure()).toBeGreaterThan(0);
    expect(a.embargoPressure()).toBe(0);
  });

  it("lifts with the embargo", () => {
    a.addEmbargo(target, false);
    a.stopEmbargo(target);
    expect(target.embargoPressure()).toBe(0);
  });
});

describe("the tariff", () => {
  const config = new Config({} as GameConfig, new UserSettings(), false);

  it("is exact at zero pressure and linear to the maximum", () => {
    expect(config.embargoTariff(0)).toBe(1);
    expect(config.embargoTariff(1)).toBe(1 - config.embargoTariffMax());
    expect(config.embargoTariff(0.5)).toBeCloseTo(
      1 - config.embargoTariffMax() / 2,
    );
  });
});
