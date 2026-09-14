import { FactoryExecution } from "../../src/core/execution/FactoryExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { setup } from "../util/Setup";

/**
 * Materials (brief §6.3): Factories make them, arms consume them, nothing
 * else touches them. The pool answers one question — how much industry
 * stands behind this army — and the tall-versus-wide choice falls out of it:
 * gold alone raises cities, ports and factories; a single defense post needs
 * a factory somewhere behind it.
 */

let game: Game;
let player: Player;

beforeEach(async () => {
  // Real gold, and plenty of it: infinite gold is the "infinite resources"
  // cheat and would make materials free too (see the last case).
  game = await setup("plains", { infiniteGold: false, instantBuild: true }, [
    new PlayerInfo("smith", PlayerType.Human, "c-smith", "smith"),
  ]);
  player = game.player("smith");
  player.addGold(1_000_000_000n);
  for (let y = 10; y < 30; y++) {
    for (let x = 10; x < 30; x++) player.conquer(game.ref(x, y));
  }
  while (game.inSpawnPhase()) game.executeNextTick();
});

describe("materials", () => {
  it("starts with enough for one defense post, and not two", () => {
    const post = game.config().unitMaterialsCost(UnitType.DefensePost);
    expect(player.materials()).toBe(game.config().startingMaterials());
    // The start is one post, whatever the table says a post costs; the
    // table is the base times the price scale (session-12 retune: x2).
    expect(post).toBe(400n);
    expect(game.config().unitMaterialsCost(UnitType.MIRV)).toBe(40_000n);
    vi.spyOn(game.config(), "materialsPriceScale").mockReturnValue(1);
    expect(game.config().unitMaterialsCost(UnitType.DefensePost)).toBe(200n);
    expect(game.config().startingMaterials()).toBe(200n);
    vi.restoreAllMocks();
    expect(player.materials()).toBeGreaterThanOrEqual(post);
    expect(player.materials()).toBeLessThan(post * 2n);
  });

  it("gates arms and only arms: the same tile, with and without materials", () => {
    // Held constant: the tile and the gold (infinite). Only the pool moves,
    // so what flips is the gate and not a spawn rule.
    const tile = game.ref(15, 15);
    player.addMaterials(100_000n);
    const withCity = player.canBuild(UnitType.City, tile);
    const withPost = player.canBuild(UnitType.DefensePost, tile);
    const withSilo = player.canBuild(UnitType.MissileSilo, tile);
    expect(withPost).not.toBe(false);
    expect(withSilo).not.toBe(false);

    player.removeMaterials(player.materials());
    expect(player.canBuild(UnitType.City, tile)).toBe(withCity);
    expect(player.canBuild(UnitType.Factory, tile)).toBe(withCity);
    expect(player.canBuild(UnitType.DefensePost, tile)).toBe(false);
    expect(player.canBuild(UnitType.MissileSilo, tile)).toBe(false);
    expect(player.canBuild(UnitType.SAMLauncher, tile)).toBe(false);
  });

  it("charges the flat price at build and at every upgrade", () => {
    player.addMaterials(10_000n);
    const before = player.materials();
    const post = player.buildUnit(UnitType.DefensePost, game.ref(15, 15), {});
    const price = game.config().unitMaterialsCost(UnitType.DefensePost);
    expect(player.materials()).toBe(before - price);
    player.upgradeUnit(post);
    expect(player.materials()).toBe(before - price * 2n);
    // Flat, not escalating: the second post costs what the first did.
    player.buildUnit(UnitType.DefensePost, game.ref(20, 20), {});
    expect(player.materials()).toBe(before - price * 3n);
  });

  it("is made by factories, per level, once they are built", () => {
    const factory = player.buildUnit(UnitType.Factory, game.ref(15, 15), {});
    game.addExecution(new FactoryExecution(factory));
    game.executeNextTick(); // init
    const start = player.materials();
    for (let i = 0; i < 10; i++) game.executeNextTick();
    const perTick = game.config().factoryMaterialsPerTick(1);
    expect(player.materials()).toBe(start + perTick * 10n);

    factory.increaseLevel();
    const mid = player.materials();
    for (let i = 0; i < 10; i++) game.executeNextTick();
    expect(player.materials()).toBe(
      mid + game.config().factoryMaterialsPerTick(2) * 10n,
    );
  });

  it("makes nothing while the factory is still going up", () => {
    const factory = player.buildUnit(UnitType.Factory, game.ref(15, 15), {});
    factory.setUnderConstruction(true);
    game.addExecution(new FactoryExecution(factory));
    game.executeNextTick();
    const start = player.materials();
    for (let i = 0; i < 10; i++) game.executeNextTick();
    expect(player.materials()).toBe(start);
  });

  it("ships the price with the build menu so the client can grey it out", () => {
    const actions = player.buildableUnits(game.ref(15, 15));
    const post = actions.find((b) => b.type === UnitType.DefensePost)!;
    const city = actions.find((b) => b.type === UnitType.City)!;
    expect(post.materialsCost).toBe(
      game.config().unitMaterialsCost(UnitType.DefensePost),
    );
    expect(city.materialsCost).toBe(0n);
  });

  it("is free under infinite gold, which is the infinite-resources cheat", async () => {
    const sandbox = await setup(
      "plains",
      { infiniteGold: true, instantBuild: true },
      [new PlayerInfo("god", PlayerType.Human, "c-god", "god")],
    );
    const god = sandbox.player("god");
    god.removeMaterials(god.materials());
    expect(
      sandbox.unitInfo(UnitType.MissileSilo).materialsCost?.(sandbox, god),
    ).toBe(0n);
    // Only humans: a nation in the same lobby still pays.
    expect(
      game.unitInfo(UnitType.MissileSilo).materialsCost?.(game, player),
    ).toBe(game.config().unitMaterialsCost(UnitType.MissileSilo));
  });

  it("never goes below zero, like gold", () => {
    player.removeMaterials(player.materials());
    expect(player.removeMaterials(5n)).toBe(0n);
    expect(player.materials()).toBe(0n);
    player.addMaterials(-5n);
    expect(player.materials()).toBe(0n);
  });
});
