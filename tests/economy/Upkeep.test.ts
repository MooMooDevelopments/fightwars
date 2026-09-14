import { PlayerExecution } from "../../src/core/execution/PlayerExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { GOLD_INDEX_UPKEEP } from "../../src/core/StatsSchemas";
import { setup } from "../util/Setup";

/**
 * Upkeep (brief §6.3): every structure level and every warship costs gold
 * per tick, and a treasury that cannot pay has consequences — no recruits
 * while it is short, and after the grace period the most expensive thing the
 * player owns is lost. The engine cannot hold a negative balance, so these
 * consequences *are* the debt.
 */

let game: Game;
let player: Player;

async function boot(startingGold: number): Promise<void> {
  game = await setup(
    "plains",
    { infiniteGold: false, instantBuild: true, startingGold },
    // A clientID, so the stats tree records this player.
    [new PlayerInfo("payer", PlayerType.Human, "c-payer", "payer")],
  );
  player = game.player("payer");
  for (let y = 10; y < 30; y++) {
    for (let x = 10; x < 30; x++) player.conquer(game.ref(x, y));
  }
  while (game.inSpawnPhase()) game.executeNextTick();
  // Only this player's execution: no bots, no nations, nothing else moving
  // gold, so what the treasury does is upkeep and worker income alone.
  game.addExecution(new PlayerExecution(player));
  game.executeNextTick();
}

describe("upkeep", () => {
  it("charges each built structure level every tick", async () => {
    await boot(10_000_000);
    const city = player.buildUnit(UnitType.City, game.ref(15, 15), {});
    player.buildUnit(UnitType.Port, game.ref(20, 20), {});
    city.increaseLevel();
    const before = player.gold();
    game.executeNextTick();

    const income = game.config().goldAdditionRate(player);
    const due =
      game.config().unitUpkeep(UnitType.City, player) * 2n +
      game.config().unitUpkeep(UnitType.Port, player);
    expect(due).toBeGreaterThan(0n);
    expect(player.gold()).toBe(before + income - due);
    expect(game.config().upkeepDue(player)).toBe(due);
    expect(game.stats().getPlayerStats(player)?.gold?.[GOLD_INDEX_UPKEEP]).toBe(
      due,
    );
  });

  it("charges nothing for a structure still under construction", async () => {
    await boot(10_000_000);
    const silo = player.buildUnit(UnitType.MissileSilo, game.ref(15, 15), {});
    silo.setUnderConstruction(true);
    expect(game.config().upkeepDue(player)).toBe(0n);
    silo.setUnderConstruction(false);
    expect(game.config().upkeepDue(player)).toBeGreaterThan(0n);
  });

  it("stops recruits while upkeep goes unpaid", async () => {
    await boot(0);
    // A silo costs 25/tick against 100/tick of income: affordable. Two SAMs
    // and a silo, 75, still affordable. Warships make it 155 — not.
    player.buildUnit(UnitType.MissileSilo, game.ref(15, 15), {});
    player.buildUnit(UnitType.SAMLauncher, game.ref(16, 16), {});
    player.buildUnit(UnitType.SAMLauncher, game.ref(17, 17), {});
    player.buildUnit(UnitType.Warship, game.ref(0, 0), { patrolTile: 0 });
    player.buildUnit(UnitType.Warship, game.ref(0, 1), { patrolTile: 0 });
    expect(game.config().upkeepDue(player)).toBeGreaterThan(
      game.config().goldAdditionRate(player),
    );
    const troops = player.troops();
    for (let i = 0; i < 20; i++) game.executeNextTick();
    expect(player.gold()).toBe(0n);
    expect(player.troops()).toBe(troops);
  });

  it("recruits again the tick the bill is met", async () => {
    await boot(0);
    player.buildUnit(UnitType.Warship, game.ref(0, 0), { patrolTile: 0 });
    player.buildUnit(UnitType.Warship, game.ref(0, 1), { patrolTile: 0 });
    player.buildUnit(UnitType.Warship, game.ref(0, 2), { patrolTile: 0 });
    for (let i = 0; i < 5; i++) game.executeNextTick();
    const stalled = player.troops();
    player.addGold(1_000_000n);
    game.executeNextTick();
    expect(player.troops()).toBeGreaterThan(stalled);
  });

  it("forecloses on the most expensive unit after the grace period, and not before", async () => {
    await boot(0);
    const city = player.buildUnit(UnitType.City, game.ref(15, 15), {});
    const silo = player.buildUnit(UnitType.MissileSilo, game.ref(20, 20), {});
    for (let i = 0; i < 4; i++) {
      player.buildUnit(UnitType.Warship, game.ref(0, i), { patrolTile: 0 });
    }
    const grace = game.config().upkeepGraceTicks();
    for (let i = 0; i < grace - 1; i++) game.executeNextTick();
    expect(player.units(UnitType.Warship).length).toBe(4);
    expect(silo.isActive()).toBe(true);

    game.executeNextTick();
    // Warships are the dearest thing here (40 against the silo's 25), and the
    // oldest of them goes first.
    expect(player.units(UnitType.Warship).length).toBe(3);
    expect(silo.isActive()).toBe(true);
    expect(city.isActive()).toBe(true);

    // The clock restarts: another full grace period before the next one.
    for (let i = 0; i < grace - 1; i++) game.executeNextTick();
    expect(player.units(UnitType.Warship).length).toBe(3);
    game.executeNextTick();
    expect(player.units(UnitType.Warship).length).toBe(2);
  });

  it("resets the grace clock as soon as a tick is paid in full", async () => {
    await boot(0);
    for (let i = 0; i < 4; i++) {
      player.buildUnit(UnitType.Warship, game.ref(0, i), { patrolTile: 0 });
    }
    const grace = game.config().upkeepGraceTicks();
    for (let i = 0; i < grace - 10; i++) game.executeNextTick();
    player.addGold(1_000_000n);
    game.executeNextTick(); // paid: clock back to zero
    player.removeGold(player.gold());
    for (let i = 0; i < grace - 1; i++) game.executeNextTick();
    expect(player.units(UnitType.Warship).length).toBe(4);
  });

  it("keeps foreclosing, dearest first, until the bill fits the income", async () => {
    await boot(0);
    // Three warships (80 each since the session-12 retune) and a city:
    // 250/tick against a human's 100. Each grace period takes the dearest
    // unit: 250 -> 170 -> 90, and 90 fits.
    const city = player.buildUnit(UnitType.City, game.ref(15, 15), {});
    for (let i = 0; i < 3; i++) {
      player.buildUnit(UnitType.Warship, game.ref(0, i), { patrolTile: 0 });
    }
    const grace = game.config().upkeepGraceTicks();
    // Two foreclosures take two warships and the bill drops to 90, which
    // 100 of income covers: the clock resets and nothing else is lost,
    // however long the game runs on.
    for (let i = 0; i < grace * 4; i++) game.executeNextTick();
    expect(player.units(UnitType.Warship).length).toBe(1);
    expect(city.isActive()).toBe(true);
    expect(player.gold()).toBeGreaterThan(0n);
  });
});

// Session-12 retune: the arms rows of the table carry armsUpkeepScale() = 2;
// the economy rows do not.
describe("arms upkeep scale", () => {
  it("doubles posts, SAMs, silos and warships and leaves cities, ports and factories alone", () => {
    const config = game.config();
    const at = (type: UnitType) => config.unitUpkeep(type, player);
    expect(at(UnitType.DefensePost)).toBe(10n);
    expect(at(UnitType.MissileSilo)).toBe(50n);
    expect(at(UnitType.SAMLauncher)).toBe(50n);
    expect(at(UnitType.Warship)).toBe(80n);
    expect(at(UnitType.City)).toBe(10n);
    expect(at(UnitType.Port)).toBe(10n);
    expect(at(UnitType.Factory)).toBe(15n);
    vi.spyOn(config, "armsUpkeepScale").mockReturnValue(1);
    expect(at(UnitType.Warship)).toBe(40n);
    expect(at(UnitType.DefensePost)).toBe(5n);
    expect(at(UnitType.City)).toBe(10n);
    vi.restoreAllMocks();
  });
});
