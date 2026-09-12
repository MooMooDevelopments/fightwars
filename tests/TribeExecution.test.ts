import { TribeExecution } from "../src/core/execution/TribeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

// Bots ("tribes", brief §5: "bot AI") run a 90-line brain: on its first firing
// tick a tribe attacks unclaimed land; afterwards it accepts every alliance
// request, sheds one structure at a time and keeps attacking. Firing ticks
// are seeded from the tribe id, so the loop bounds below cover any seed
// (attack rate is 40–80 ticks).

let game: Game;
let tribe: Player;
let human: Player;

const MAX_FIRE_WAIT = 90;

function tickUntil(pred: () => boolean, max = MAX_FIRE_WAIT): boolean {
  for (let i = 0; i < max; i++) {
    if (pred()) return true;
    game.executeNextTick();
  }
  return pred();
}

beforeEach(async () => {
  game = await setup("plains", { infiniteTroops: true }, [
    new PlayerInfo("tribe", PlayerType.Bot, null, "tribe"),
    new PlayerInfo("human", PlayerType.Human, "cHuman00", "human"),
  ]);
  tribe = game.player("tribe");
  human = game.player("human");
  tribe.conquer(game.ref(10, 10));
  human.conquer(game.ref(80, 80));
  while (game.inSpawnPhase()) game.executeNextTick();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TribeExecution", () => {
  it("attacks terra nullius on its first firing tick", () => {
    const exec = new TribeExecution(tribe);
    game.addExecution(exec);
    expect(tickUntil(() => tribe.outgoingAttacks().length > 0)).toBe(true);
    const attack = tribe.outgoingAttacks()[0];
    expect(attack.target().isPlayer()).toBe(false);
    expect(exec.isActive()).toBe(true);
  });

  it("accepts an alliance request from a human", () => {
    game.addExecution(new TribeExecution(tribe));
    // Past the first firing tick, where only the opening attack happens.
    expect(tickUntil(() => tribe.outgoingAttacks().length > 0)).toBe(true);
    expect(human.createAllianceRequest(tribe)).not.toBeNull();
    expect(tribe.incomingAllianceRequests()).toHaveLength(1);
    expect(tickUntil(() => human.allianceWith(tribe) !== null)).toBe(true);
    expect(tribe.isFriendly(human)).toBe(true);
  });

  it("sheds its structures one at a time", () => {
    game.addExecution(new TribeExecution(tribe));
    expect(tickUntil(() => tribe.outgoingAttacks().length > 0)).toBe(true);
    const city = tribe.buildUnit(UnitType.City, game.ref(10, 10), {});
    expect(city.isMarkedForDeletion()).toBe(false);
    // The delete cooldown counts from tick 0, then a firing tick must come.
    const wait = game.config().deleteUnitCooldown() + MAX_FIRE_WAIT;
    expect(tickUntil(() => city.isMarkedForDeletion(), wait)).toBe(true);
  });

  it("stops once the tribe is dead", () => {
    const exec = new TribeExecution(tribe);
    game.addExecution(exec);
    expect(tickUntil(() => tribe.outgoingAttacks().length > 0)).toBe(true);
    for (const tile of [...tribe.tiles()]) tribe.relinquish(tile);
    expect(tribe.isAlive()).toBe(false);
    expect(tickUntil(() => !exec.isActive())).toBe(true);
  });
});
