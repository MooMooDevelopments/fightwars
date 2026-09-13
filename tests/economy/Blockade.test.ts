import { isBlockaded } from "../../src/core/execution/Blockade";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { setup } from "../util/Setup";

/**
 * Blockades (brief §6.3): a warship parked within range of a port that its
 * owner is not friendly with closes that port — nothing leaves, nothing
 * arrives. The routing and spawn rules in PortExecution both read this one
 * answer, so the tests pin the answer.
 */

let game: Game;
let merchant: Player;
let rival: Player;
let friend: Player;

beforeEach(async () => {
  game = await setup("big_plains", { infiniteGold: true, instantBuild: true }, [
    new PlayerInfo("merchant", PlayerType.Human, "c-m", "merchant"),
    new PlayerInfo("rival", PlayerType.Human, "c-r", "rival"),
    new PlayerInfo("friend", PlayerType.Human, "c-f", "friend"),
  ]);
  merchant = game.player("merchant");
  rival = game.player("rival");
  friend = game.player("friend");
  for (let x = 90; x < 110; x++) merchant.conquer(game.ref(x, 100));
  rival.conquer(game.ref(10, 10));
  friend.conquer(game.ref(190, 190));
  while (game.inSpawnPhase()) game.executeNextTick();
});

const warshipAt = (owner: Player, x: number, y: number) =>
  owner.buildUnit(UnitType.Warship, game.ref(x, y), {
    patrolTile: game.ref(x, y),
  });

describe("blockades", () => {
  it("closes a port with a hostile warship inside the range, and not one outside", () => {
    const port = merchant.buildUnit(UnitType.Port, game.ref(100, 100), {});
    const range = game.config().blockadeRange();
    expect(isBlockaded(game, port)).toBe(false);

    const far = warshipAt(rival, 100 + range + 5, 100);
    game.executeNextTick();
    expect(isBlockaded(game, port)).toBe(false);

    far.delete(false);
    warshipAt(rival, 100 + range - 1, 100);
    game.executeNextTick();
    expect(isBlockaded(game, port)).toBe(true);
  });

  it("is not a blockade when the fleet is your own", () => {
    // The friendliness rule, on the one relation that needs no diplomacy:
    // a player's own warship never closes its own port. The earlier draft
    // of this case had a stranger's ship in range too and could not fail.
    const port = merchant.buildUnit(UnitType.Port, game.ref(100, 100), {});
    warshipAt(merchant, 104, 100);
    game.executeNextTick();
    expect(isBlockaded(game, port)).toBe(false);

    // A stranger's ship beside it closes the port; the merchant's does not
    // lift that.
    warshipAt(friend, 105, 100);
    game.executeNextTick();
    expect(isBlockaded(game, port)).toBe(true);
  });

  it("lifts the tick the warship is gone", () => {
    const port = merchant.buildUnit(UnitType.Port, game.ref(100, 100), {});
    const ship = warshipAt(rival, 105, 100);
    game.executeNextTick();
    expect(isBlockaded(game, port)).toBe(true);
    ship.delete(false);
    game.executeNextTick();
    expect(isBlockaded(game, port)).toBe(false);
  });

  it("answers the same for every port in a tick, from one sweep", () => {
    const a = merchant.buildUnit(UnitType.Port, game.ref(95, 100), {});
    const b = merchant.buildUnit(UnitType.Port, game.ref(105, 100), {});
    warshipAt(rival, 95, 102);
    game.executeNextTick();
    expect(isBlockaded(game, a)).toBe(true);
    // b is 10 tiles from the warship: inside the range too.
    expect(isBlockaded(game, b)).toBe(true);
  });

  it("is off entirely when the range is zero", () => {
    const port = merchant.buildUnit(UnitType.Port, game.ref(100, 100), {});
    warshipAt(rival, 101, 100);
    game.executeNextTick();
    vi.spyOn(game.config(), "blockadeRange").mockReturnValue(0);
    game.executeNextTick();
    expect(isBlockaded(game, port)).toBe(false);
    vi.restoreAllMocks();
  });
});
