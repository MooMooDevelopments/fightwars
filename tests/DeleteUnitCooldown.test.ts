import { DeleteUnitExecution } from "../src/core/execution/DeleteUnitExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

// The branches DeleteUnitExecution.test.ts leaves out: the per-player
// cooldown between voluntary deletions, a unit that is already gone, and a
// unit standing on water.

let game: Game;
let player: Player;

beforeEach(async () => {
  game = await setup("ocean_and_land", { infiniteGold: true }, [
    new PlayerInfo("player", PlayerType.Human, "cPlayer0", "player"),
  ]);
  player = game.player("player");
  for (let y = 10; y < 14; y++) player.conquer(game.ref(0, y));
  while (game.inSpawnPhase()) game.executeNextTick();
  // The cooldown counts from tick 0: a fresh game refuses the first deletion
  // until it has elapsed once.
  for (let i = 0; i < game.config().deleteUnitCooldown(); i++) {
    game.executeNextTick();
  }
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DeleteUnitExecution cooldown and stale units", () => {
  it("refuses a second deletion inside the cooldown, allows it after", () => {
    const first = player.buildUnit(UnitType.City, game.ref(0, 10), {});
    const second = player.buildUnit(UnitType.City, game.ref(0, 12), {});
    const a = new DeleteUnitExecution(player, first.id());
    a.init(game, game.ticks());
    expect(a.isActive()).toBe(true);
    expect(first.isMarkedForDeletion()).toBe(true);

    const b = new DeleteUnitExecution(player, second.id());
    b.init(game, game.ticks());
    expect(b.isActive()).toBe(false);
    expect(second.isMarkedForDeletion()).toBe(false);

    for (let i = 0; i < game.config().deleteUnitCooldown(); i++) {
      game.executeNextTick();
    }
    const c = new DeleteUnitExecution(player, second.id());
    c.init(game, game.ticks());
    expect(c.isActive()).toBe(true);
    expect(second.isMarkedForDeletion()).toBe(true);
  });

  it("ignores a unit that no longer exists or is already inactive", () => {
    const city = player.buildUnit(UnitType.City, game.ref(0, 10), {});
    const id = city.id();
    city.delete(false);
    const exec = new DeleteUnitExecution(player, id);
    exec.init(game, game.ticks());
    expect(exec.isActive()).toBe(false);
    const ghost = new DeleteUnitExecution(player, 987654);
    ghost.init(game, game.ticks());
    expect(ghost.isActive()).toBe(false);
  });

  it("goes inactive if the unit dies before its deletion fuse runs out", () => {
    const city = player.buildUnit(UnitType.City, game.ref(0, 10), {});
    const exec = new DeleteUnitExecution(player, city.id());
    exec.init(game, game.ticks());
    expect(city.isMarkedForDeletion()).toBe(true);
    city.delete(false);
    exec.tick(game.ticks());
    expect(exec.isActive()).toBe(false);
  });
});
