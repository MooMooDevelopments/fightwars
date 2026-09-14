import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { UnrestExecution } from "../src/core/execution/UnrestExecution";
import {
  Doctrine,
  Game,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameUpdateType, PlayerUpdate } from "../src/core/game/GameUpdates";
import { setup } from "./util/Setup";

/**
 * Stability and partisans (brief §6.6). Land taken from another state is
 * held from its people until it assimilates; enough of one people's land
 * held unassimilated and ungarrisoned raises their partisans — a tribe on
 * the occupier's own ground, aimed at the occupier, that the occupier
 * cannot absorb as an enclave. Conquest becomes a commitment.
 */

let game: Game;
let occupier: Player;
let people: Player;
let tribe: Player;

beforeEach(async () => {
  game = await setup(
    "plains",
    { infiniteGold: true, instantBuild: true, gameType: GameType.Public },
    [
      new PlayerInfo("occupier", PlayerType.Human, "c-o", "occupier"),
      new PlayerInfo("people", PlayerType.Human, "c-p", "people"),
      new PlayerInfo("tribe", PlayerType.Bot, null, "tribe"),
    ],
  );
  occupier = game.player("occupier");
  people = game.player("people");
  tribe = game.player("tribe");
  // The people hold a 30x30 square; the occupier a 10x10 one; the tribe a tile.
  for (let y = 10; y < 40; y++) {
    for (let x = 10; x < 40; x++) people.conquer(game.ref(x, y));
  }
  for (let y = 60; y < 70; y++) {
    for (let x = 60; x < 70; x++) occupier.conquer(game.ref(x, y));
  }
  tribe.conquer(game.ref(90, 90));
  game.endSpawnPhase();
  game.executeNextTick();
});

/** The occupier takes the people's rows y0..y1 (inclusive), x 10..39. */
function occupyRows(y0: number, y1: number): number[] {
  const taken: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = 10; x < 40; x++) {
      const tile = game.ref(x, y);
      occupier.conquer(tile);
      taken.push(tile);
    }
  }
  return taken;
}

function partisans(): Player[] {
  return game.allPlayers().filter((p) => p.partisanOf() !== null);
}

function ticks(n: number) {
  for (let i = 0; i < n; i++) game.executeNextTick();
}

describe("occupied land", () => {
  it("is held from its people from the moment it is taken", () => {
    const taken = occupyRows(10, 12);
    expect(taken.length).toBe(90);
    expect(occupier.unrestTiles()).toBe(90);
    expect(occupier.unrestByPeople().get(people.smallID())).toBe(90);
    expect(game.occupiedFrom(taken[0])).toBe(people.smallID());
    expect(people.unrestTiles()).toBe(0);
  });

  it("breeds nothing when the land was nobody's, or a tribe's, or the taker is a tribe", () => {
    occupier.conquer(game.ref(50, 50)); // terra nullius
    occupier.conquer(game.ref(90, 90)); // the tribe's
    expect(occupier.unrestTiles()).toBe(0);
    tribe.conquer(game.ref(10, 10)); // a tribe raiding the people
    expect(tribe.unrestTiles()).toBe(0);
    expect(game.occupiedFrom(game.ref(10, 10))).toBe(0);
  });

  it("is liberated by its own people's return, inherited by a third party, cleared when let go", async () => {
    const [first, second, third] = occupyRows(10, 10);
    people.conquer(first);
    expect(occupier.unrestTiles()).toBe(29);
    expect(game.occupiedFrom(first)).toBe(0);

    const third_party = game.addPlayer(
      new PlayerInfo("third", PlayerType.Human, "c-t", "third"),
    );
    third_party.conquer(second);
    expect(occupier.unrestTiles()).toBe(28);
    expect(third_party.unrestByPeople().get(people.smallID())).toBe(1);
    expect(game.occupiedFrom(second)).toBe(people.smallID());

    occupier.relinquish(third);
    expect(occupier.unrestTiles()).toBe(27);
    expect(game.occupiedFrom(third)).toBe(0);
  });

  it("assimilates once its window has passed in the same hands", () => {
    vi.spyOn(game.config(), "unrestAssimilationTicks").mockReturnValue(50);
    const [first] = occupyRows(10, 10);
    ticks(40);
    expect(occupier.unrestTiles()).toBe(30);
    // A tile that changed hands meanwhile is the new holder's to settle.
    people.conquer(first);
    occupier.conquer(first);
    ticks(20);
    expect(occupier.unrestTiles()).toBe(1);
    expect(game.occupiedFrom(first)).toBe(people.smallID());
    ticks(50);
    expect(occupier.unrestTiles()).toBe(0);
    vi.restoreAllMocks();
  });

  it("crosses the wire on the object lane", () => {
    occupyRows(10, 10);
    const updates = game.executeNextTick();
    const mine = (updates[GameUpdateType.Player] as PlayerUpdate[]).find(
      (u) => u.id === occupier.id(),
    );
    expect(mine?.unrestTiles).toBe(30);
  });

  it("stays the people's in their partisans' hands: taking it from them is taking it from the people", () => {
    const rising = game.addPlayer(
      new PlayerInfo("rising", PlayerType.Bot, null, "rising"),
    );
    rising.markPartisanOf(occupier, people.smallID());
    rising.conquer(game.ref(50, 50));
    expect(rising.unrestTiles()).toBe(0);
    expect(game.occupiedFrom(game.ref(50, 50))).toBe(0);
    occupier.conquer(game.ref(50, 50));
    expect(occupier.unrestByPeople().get(people.smallID())).toBe(1);
    // The people themselves taking it back hold nothing against themselves.
    rising.conquer(game.ref(50, 50));
    people.conquer(game.ref(50, 50));
    expect(people.unrestTiles()).toBe(0);
    expect(game.occupiedFrom(game.ref(50, 50))).toBe(0);
  });

  it("records nothing with stability off", () => {
    vi.spyOn(game.config(), "unrestEnabled").mockReturnValue(false);
    occupyRows(10, 12);
    expect(occupier.unrestTiles()).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("uprisings", () => {
  beforeEach(() => {
    game.addExecution(new UnrestExecution());
    game.executeNextTick(); // init
  });

  it("rise once enough of one people's land is held, on the occupier's own ground, aimed at it", () => {
    const threshold = game.config().unrestPartisanThreshold();
    const taken = new Set(occupyRows(10, 10 + threshold / 30 - 1)); // exactly the threshold
    expect(occupier.unrestTiles()).toBe(threshold);
    ticks(10);
    const [rising] = partisans();
    expect(rising).toBeDefined();
    expect(rising.name()).toBe("people Partisans");
    expect(rising.type()).toBe(PlayerType.Bot);
    expect(rising.partisanOf()).toBe(occupier);
    // Read after up to ten ticks of recruiting, so at least the grant.
    expect(rising.troops()).toBeGreaterThanOrEqual(
      game.config().partisanTroops(threshold),
    );
    expect(rising.numTilesOwned()).toBeGreaterThan(0);
    // Every tile they stand on was the occupier's, and is nobody's grievance now.
    for (const tile of rising.tiles()) {
      expect(game.occupiedFrom(tile)).toBe(0);
    }
    // The ground they rose on is out of the occupier's books; the rest of
    // their patch was nobody's land beside it.
    const liberated = [...rising.tiles()].filter((t) => taken.has(t)).length;
    expect(liberated).toBeGreaterThan(0);
    expect(occupier.unrestTiles()).toBe(threshold - liberated);
    // Not twice: the cooldown holds, and the land held has dropped below the line.
    ticks(20);
    expect(partisans().length).toBe(1);
  });

  it("do not rise below the threshold, under a garrison, or with stability off", () => {
    const threshold = game.config().unrestPartisanThreshold();
    occupyRows(10, 10 + threshold / 30 - 2);
    ticks(10);
    expect(partisans().length).toBe(0);

    // One post in the middle of the occupied rows covers every tile of them.
    occupyRows(10 + threshold / 30 - 1, 10 + threshold / 30 - 1);
    expect(occupier.unrestTiles()).toBe(threshold);
    const post = occupier.buildUnit(UnitType.DefensePost, game.ref(25, 15), {});
    expect(post.isActive()).toBe(true);
    ticks(10);
    expect(partisans().length).toBe(0);

    post.delete(false);
    vi.spyOn(game.config(), "unrestEnabled").mockReturnValue(false);
    ticks(10);
    expect(partisans().length).toBe(0);
    vi.restoreAllMocks();
  });

  it("fight the occupier first, and will not be its friend", () => {
    const threshold = game.config().unrestPartisanThreshold();
    occupyRows(10, 10 + threshold / 30 - 1);
    ticks(10);
    const [rising] = partisans();
    // The tribe brain fires every 40-80 ticks; its first firing attacks
    // terra nullius, the next one the occupier it borders.
    let attacked = false;
    for (let i = 0; i < 200 && !attacked; i++) {
      game.executeNextTick();
      attacked = rising.outgoingAttacks().some((a) => a.target() === occupier);
    }
    expect(attacked).toBe(true);
    expect(occupier.createAllianceRequest(rising)).not.toBeNull();
    for (let i = 0; i < 100 && rising.incomingAllianceRequests().length; i++) {
      game.executeNextTick();
    }
    expect(occupier.isAlliedWith(rising)).toBe(false);
  });

  it("need a share of the occupier's own land, never less than the floor", () => {
    const config = game.config();
    const floor = config.unrestPartisanThreshold();
    expect(floor).toBe(300);
    expect(config.unrestPartisanThreshold(1000)).toBe(floor);
    expect(config.unrestPartisanThreshold(3000)).toBe(floor);
    expect(config.unrestPartisanThreshold(3010)).toBe(301);
    expect(config.unrestPartisanThreshold(100_000)).toBe(10_000);
    // The execution reads the share against the occupier's land: with the
    // share at the whole of it (400 tiles, 300 of them the people's), the
    // floor's worth of occupied land raises nobody...
    vi.spyOn(config, "unrestPartisanShare").mockReturnValue(100);
    occupyRows(10, 10 + floor / 30 - 1);
    expect(occupier.unrestTiles()).toBe(floor);
    expect(occupier.numTilesOwned()).toBe(400);
    ticks(10);
    expect(partisans().length).toBe(0);
    // ...and the same land does the moment the share no longer reaches it.
    vi.spyOn(config, "unrestPartisanShare").mockReturnValue(0);
    ticks(10);
    expect(partisans().length).toBe(1);
    vi.restoreAllMocks();
  });

  it("halve the land and double the time for a Partisan-doctrine people", () => {
    people.setDoctrine(Doctrine.Partisan);
    const threshold = game.config().unrestPartisanThreshold();
    occupyRows(10, 10 + threshold / 60 - 1); // half the threshold
    ticks(10);
    expect(partisans().length).toBe(1);
  });

  it("settle Partisan-doctrine land in twice the time", () => {
    vi.spyOn(game.config(), "unrestAssimilationTicks").mockReturnValue(50);
    people.setDoctrine(Doctrine.Partisan);
    occupyRows(10, 10);
    ticks(70);
    expect(occupier.unrestTiles()).toBe(30);
    ticks(50);
    expect(occupier.unrestTiles()).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("an enclave of partisans", () => {
  function enclave(id: string, mark: boolean): Player {
    // The occupier holds a 20x20 block; a tribe holds 3x3 inside it.
    for (let y = 60; y < 80; y++) {
      for (let x = 60; x < 80; x++) occupier.conquer(game.ref(x, y));
    }
    const bot = game.addPlayer(new PlayerInfo(id, PlayerType.Bot, null, id));
    if (mark) bot.markPartisanOf(occupier, people.smallID());
    for (let y = 70; y < 73; y++) {
      for (let x = 70; x < 73; x++) bot.conquer(game.ref(x, y));
    }
    game.addExecution(new PlayerExecution(bot));
    // The cluster pass only runs after a tile change later than its first
    // check, which init staggers up to ticksPerClusterCalc ahead — the same
    // reason a fresh spawn is not checked until it moves. Let that tick pass,
    // then take one more tile.
    ticks(30);
    bot.conquer(game.ref(73, 71));
    ticks(5);
    return bot;
  }

  it("is not the occupier's to absorb, though any other enclave is", () => {
    const plain = enclave("plain", false);
    expect(plain.isAlive()).toBe(false);
    const rising = enclave("rising", true);
    expect(rising.isAlive()).toBe(true);
    expect(rising.numTilesOwned()).toBe(10);
  });
});
