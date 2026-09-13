import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import {
  SUPPLY_REFRESH_PERIOD,
  SUPPLY_UNSUPPLIED,
} from "../src/core/game/SupplyNetwork";
import { setup } from "./util/Setup";

/**
 * The supply field (brief §6.1): how far each tile is from its owner's
 * nearest supply source, walked through that owner's own ground.
 *
 * The distinction these tests exist to hold is the one that makes supply a
 * decision rather than a radius — distance is measured along territory, not
 * across the map, so a long thin conquest is badly supplied even when it
 * loops back to within sight of its own capital.
 */

let game: Game;
let player: Player;
let rival: Player;

beforeEach(async () => {
  game = await setup("big_plains", {}, [
    new PlayerInfo("player", PlayerType.Human, "cPlayer0", "player"),
    new PlayerInfo("rival", PlayerType.Human, "cPlayer1", "rival"),
  ]);
  player = game.player("player");
  rival = game.player("rival");
  while (game.inSpawnPhase()) game.executeNextTick();
});

/** Owns a run of tiles along y, x from..to inclusive. */
function ownRow(p: Player, y: number, from: number, to: number) {
  for (let x = from; x <= to; x++) p.conquer(game.ref(x, y));
}

/** Owns a run of tiles along x, y from..to inclusive. */
function ownColumn(p: Player, x: number, from: number, to: number) {
  for (let y = from; y <= to; y++) p.conquer(game.ref(x, y));
}

const distance = (x: number, y: number) =>
  game.supplyNetwork().distance(game.ref(x, y));

describe("supply field", () => {
  it("leaves a player with no sources entirely unsupplied", () => {
    // Nothing to be supplied from: no spawn tile, no City, no Port, no
    // Factory. Territory alone does not feed an army.
    ownRow(player, 10, 0, 20);
    game.executeNextTick();

    expect(distance(0, 10)).toBe(SUPPLY_UNSUPPLIED);
    expect(distance(20, 10)).toBe(SUPPLY_UNSUPPLIED);
    expect(game.isSupplied(game.ref(10, 10))).toBe(false);
  });

  it("counts tiles walked from the spawn tile", () => {
    ownRow(player, 10, 0, 60);
    player.setSpawnTile(game.ref(0, 10));
    game.executeNextTick();

    expect(distance(0, 10)).toBe(0);
    expect(distance(1, 10)).toBe(1);
    expect(distance(25, 10)).toBe(25);
    expect(distance(60, 10)).toBe(60);
  });

  it("counts from a City the same way", () => {
    ownRow(player, 10, 0, 40);
    player.buildUnit(UnitType.City, game.ref(10, 10), {});
    game.executeNextTick();

    expect(distance(10, 10)).toBe(0);
    expect(distance(0, 10)).toBe(10);
    expect(distance(40, 10)).toBe(30);
  });

  it("takes the nearest of several sources", () => {
    ownRow(player, 10, 0, 40);
    player.setSpawnTile(game.ref(0, 10));
    player.buildUnit(UnitType.Port, game.ref(40, 10), {});
    game.executeNextTick();

    // 20 from either end, not 20 from one and 20 ignored.
    expect(distance(20, 10)).toBe(20);
    expect(distance(39, 10)).toBe(1);
  });

  it("walks around territory it does not own rather than across it", () => {
    // A U: out along y=10, down the x=20 column, back along y=30. The far
    // end sits 20 tiles from the capital as the crow flies and 60 tiles away
    // by road, and it is the 60 that has to count.
    ownRow(player, 10, 0, 20);
    ownColumn(player, 20, 10, 30);
    ownRow(player, 30, 0, 20);
    player.setSpawnTile(game.ref(0, 10));
    game.executeNextTick();

    expect(game.manhattanDist(game.ref(0, 10), game.ref(0, 30))).toBe(20);
    expect(distance(0, 30)).toBe(60);
    expect(distance(20, 30)).toBe(40);
  });

  it("stops counting at the maximum range", () => {
    const max = game.config().supplyMaxRange();
    ownRow(player, 10, 0, max + 30);
    player.setSpawnTile(game.ref(0, 10));
    game.executeNextTick();

    expect(distance(max, 10)).toBe(max);
    // Past the range the penalty is already saturated, so the flood does not
    // pay to keep walking: everything beyond reads as out of the field.
    expect(distance(max + 1, 10)).toBe(SUPPLY_UNSUPPLIED);
    expect(distance(max + 30, 10)).toBe(SUPPLY_UNSUPPLIED);
  });

  it("flags tiles inside the free range and only those", () => {
    const free = game.config().supplyFreeRange();
    ownRow(player, 10, 0, free + 10);
    player.setSpawnTile(game.ref(0, 10));
    game.executeNextTick();

    expect(game.isSupplied(game.ref(free, 10))).toBe(true);
    expect(game.isSupplied(game.ref(free + 1, 10))).toBe(false);
  });

  it("extends the field onto conquered ground without waiting for a sweep", () => {
    ownRow(player, 10, 0, 20);
    player.setSpawnTile(game.ref(0, 10));
    game.executeNextTick();
    expect(distance(20, 10)).toBe(20);

    // No tick between the conquest and the read: an advance carries its own
    // supply line forward, which is what keeps a moving front from reading
    // as stranded for the two seconds until its owner's next sweep.
    player.conquer(game.ref(21, 10));
    expect(distance(21, 10)).toBe(21);
    player.conquer(game.ref(22, 10));
    expect(distance(22, 10)).toBe(22);
  });

  it("drops a tile out of the field when it changes hands", () => {
    ownRow(player, 10, 0, 20);
    player.setSpawnTile(game.ref(0, 10));
    game.executeNextTick();
    expect(game.isSupplied(game.ref(20, 10))).toBe(true);

    // The rival has no sources of its own, so the tile it takes is stranded
    // the moment it takes it.
    rival.conquer(game.ref(20, 10));
    expect(distance(20, 10)).toBe(SUPPLY_UNSUPPLIED);
    expect(game.isSupplied(game.ref(20, 10))).toBe(false);
  });

  it("strands a salient once the ground linking it home is lost", () => {
    ownRow(player, 10, 0, 40);
    player.setSpawnTile(game.ref(0, 10));
    game.executeNextTick();
    expect(distance(40, 10)).toBe(40);

    // Cut the corridor in half. The far end is still owned and still 40
    // tiles from the capital in a straight line, but there is no longer a
    // road home, and the sweep is what notices.
    rival.conquer(game.ref(20, 10));
    // Losing the road is drift, not conquest, so it is the periodic sweep
    // that notices rather than the relaxation on the conquered tile.
    for (let i = 0; i <= SUPPLY_REFRESH_PERIOD; i++) game.executeNextTick();

    expect(distance(40, 10)).toBe(SUPPLY_UNSUPPLIED);
    expect(distance(10, 10)).toBe(10);
  });
});
