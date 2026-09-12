import { AttackExecution } from "../src/core/execution/AttackExecution";
import { BoatRetreatExecution } from "../src/core/execution/BoatRetreatExecution";
import { EmbargoAllExecution } from "../src/core/execution/EmbargoAllExecution";
import { EmbargoExecution } from "../src/core/execution/EmbargoExecution";
import { EmojiExecution } from "../src/core/execution/EmojiExecution";
import { PauseExecution } from "../src/core/execution/PauseExecution";
import { RetreatExecution } from "../src/core/execution/RetreatExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { TargetPlayerExecution } from "../src/core/execution/TargetPlayerExecution";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
import {
  AllPlayers,
  Game,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

// Brief §5, "Diplomacy verbs — all of them": the executions behind trade
// embargo, emoji, target player and the retreat/cancel verbs, plus pause.
// Each is driven the way the wire drives it (add the execution, tick).

let game: Game;
let alice: Player;
let bob: Player;
let carol: Player;

function run(exec: Parameters<Game["addExecution"]>[0], ticks = 2) {
  game.addExecution(exec);
  for (let i = 0; i < ticks; i++) game.executeNextTick();
}

async function plains(gameType: GameType = GameType.Public) {
  game = await setup("plains", { gameType, infiniteTroops: true }, [
    new PlayerInfo("alice", PlayerType.Human, "cAlice00", "alice", true),
    new PlayerInfo("bob", PlayerType.Human, "cBob0000", "bob"),
    new PlayerInfo("carol", PlayerType.Human, "cCarol00", "carol"),
  ]);
  alice = game.player("alice");
  bob = game.player("bob");
  carol = game.player("carol");
  for (let x = 0; x < 3; x++) alice.conquer(game.ref(x, 10));
  for (let x = 0; x < 3; x++) bob.conquer(game.ref(x, 11));
  carol.conquer(game.ref(50, 50));
  while (game.inSpawnPhase()) game.executeNextTick();
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trade embargo", () => {
  beforeEach(plains);

  it("starts and stops an embargo against one player", () => {
    expect(alice.canTrade(bob)).toBe(true);
    run(new EmbargoExecution(alice, bob.id(), "start"));
    expect(alice.hasEmbargoAgainst(bob)).toBe(true);
    expect(alice.canTrade(bob)).toBe(false);
    expect(bob.canTrade(alice)).toBe(false);
    expect(alice.canTrade(carol)).toBe(true);
    run(new EmbargoExecution(alice, bob.id(), "stop"));
    expect(alice.hasEmbargoAgainst(bob)).toBe(false);
    expect(alice.canTrade(bob)).toBe(true);
  });

  it("ignores an embargo against a player who is not in the game", () => {
    const exec = new EmbargoExecution(alice, "nobody", "start");
    run(exec);
    expect(exec.isActive()).toBe(false);
    expect(alice.getEmbargoes()).toHaveLength(0);
  });

  it("embargoes everyone at once, then lifts them, under a cooldown", () => {
    // The cooldown counts from tick 0, so a fresh game refuses the first sweep.
    for (let i = 0; i < game.config().embargoAllCooldown(); i++) {
      game.executeNextTick();
    }
    expect(alice.canEmbargoAll()).toBe(true);
    run(new EmbargoAllExecution(alice, "start"));
    expect(alice.hasEmbargoAgainst(bob)).toBe(true);
    expect(alice.hasEmbargoAgainst(carol)).toBe(true);
    expect(alice.canEmbargoAll()).toBe(false);
    // Inside the cooldown a second sweep is a no-op.
    run(new EmbargoAllExecution(alice, "stop"));
    expect(alice.hasEmbargoAgainst(bob)).toBe(true);
    for (let i = 0; i < game.config().embargoAllCooldown(); i++) {
      game.executeNextTick();
    }
    run(new EmbargoAllExecution(alice, "stop"));
    expect(alice.hasEmbargoAgainst(bob)).toBe(false);
    expect(alice.hasEmbargoAgainst(carol)).toBe(false);
  });
});

describe("emoji", () => {
  beforeEach(plains);

  it("delivers an emoji to one player and to everyone, once per cooldown", () => {
    run(new EmojiExecution(alice, bob.id(), 0));
    expect(alice.outgoingEmojis()).toHaveLength(1);
    expect(alice.outgoingEmojis()[0].recipientID).toBe(bob.smallID());
    expect(alice.canSendEmoji(bob)).toBe(false);
    expect(alice.canSendEmoji(AllPlayers)).toBe(true);
    // Same recipient inside the cooldown: refused, nothing sent.
    run(new EmojiExecution(alice, bob.id(), 1));
    expect(alice.outgoingEmojis()).toHaveLength(1);
    run(new EmojiExecution(alice, AllPlayers, 1));
    expect(alice.outgoingEmojis()).toHaveLength(2);
  });

  it("drops an unknown emoji index and an unknown recipient", () => {
    run(new EmojiExecution(alice, bob.id(), 99_999));
    expect(alice.outgoingEmojis()).toHaveLength(0);
    const exec = new EmojiExecution(alice, "nobody", 0);
    run(exec);
    expect(exec.isActive()).toBe(false);
    expect(alice.outgoingEmojis()).toHaveLength(0);
  });
});

describe("target player", () => {
  beforeEach(plains);

  it("marks the target and sours their relation toward the requestor", () => {
    const before = bob.relation(alice);
    run(new TargetPlayerExecution(alice, bob.id()));
    expect(alice.targets()).toContain(bob);
    expect(bob.relation(alice)).toBeLessThanOrEqual(before);
    // One target per cooldown.
    expect(alice.canTarget(carol)).toBe(false);
    run(new TargetPlayerExecution(alice, carol.id()));
    expect(alice.targets()).not.toContain(carol);
  });

  it("never targets yourself, an ally, or a missing player", () => {
    expect(alice.canTarget(alice)).toBe(false);
    const exec = new TargetPlayerExecution(alice, "nobody");
    run(exec);
    expect(exec.isActive()).toBe(false);
    expect(alice.targets()).toHaveLength(0);
  });
});

describe("retreat", () => {
  beforeEach(plains);

  it("orders a retreat at once and executes it after the cancel delay", () => {
    // Against unclaimed land the stack spreads tile by tile for many ticks,
    // so the retreat lands while the attack is still live.
    run(new AttackExecution(50_000, alice, game.terraNullius().id()), 2);
    expect(alice.outgoingAttacks()).toHaveLength(1);
    const attack = alice.outgoingAttacks()[0];
    expect(attack.isActive()).toBe(true);
    expect(attack.retreating()).toBe(false);

    run(new RetreatExecution(alice, attack.id()), 2);
    expect(attack.retreating()).toBe(true);
    expect(attack.retreated()).toBe(false);
    for (let i = 0; i < 25 && !attack.retreated(); i++) game.executeNextTick();
    expect(attack.retreated()).toBe(true);
    for (let i = 0; i < 5 && attack.isActive(); i++) game.executeNextTick();
    expect(alice.outgoingAttacks()).toHaveLength(0);
  });

  it("tolerates an attack id that does not exist", () => {
    const exec = new RetreatExecution(alice, "no-such-attack");
    run(exec, 25);
    expect(exec.isActive()).toBe(false);
  });
});

describe("boat retreat", () => {
  let sailor: Player;

  // The layout tests/Attack.test.ts uses: two coastal players, the target
  // having expanded into the land across the water so a boat has somewhere
  // to go.
  beforeEach(async () => {
    game = await setup(
      "ocean_and_land",
      { infiniteGold: true, instantBuild: true, infiniteTroops: true },
      [
        new PlayerInfo("sailor", PlayerType.Human, "cSailor0", "sailor"),
        new PlayerInfo("target", PlayerType.Human, "cTarget0", "target"),
      ],
    );
    sailor = game.player("sailor");
    const target = game.player("target");
    game.addExecution(
      new SpawnExecution("game_id", target.info(), game.ref(0, 10)),
      new SpawnExecution("game_id", sailor.info(), game.ref(0, 15)),
    );
    game.executeNextTick();
    game.executeNextTick();
    // The sender is the player who expanded across the water (as in
    // Attack.test.ts): the transport needs a shore to leave from.
    void target;
    game.addExecution(
      new AttackExecution(100, sailor, game.terraNullius().id()),
    );
    game.executeNextTick();
    while (sailor.outgoingAttacks().length > 0) game.executeNextTick();
  });

  it("turns an outgoing transport around", () => {
    run(new TransportShipExecution(sailor, game.ref(15, 8), 50), 1);
    const ship = sailor.units(UnitType.TransportShip)[0];
    expect(ship).toBeDefined();
    expect(ship.isActive()).toBe(true);
    run(new BoatRetreatExecution(sailor, ship.id()), 2);
    expect(ship.transportShipState().isRetreating).toBe(true);
    for (let i = 0; i < 5 && ship.isActive(); i++) game.executeNextTick();
    expect(ship.isActive()).toBe(false);
  });

  it("ignores an id that is not one of the player's transports", () => {
    const exec = new BoatRetreatExecution(sailor, 424242);
    run(exec, 2);
    expect(exec.isActive()).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("pause", () => {
  it("only the lobby creator pauses a multiplayer game", async () => {
    await plains(GameType.Private);
    expect(game.isPaused()).toBe(false);
    run(new PauseExecution(bob, true), 1);
    expect(game.isPaused()).toBe(false);
    run(new PauseExecution(alice, true), 1);
    expect(game.isPaused()).toBe(true);
    run(new PauseExecution(alice, false), 1);
    expect(game.isPaused()).toBe(false);
  });

  it("anyone pauses a singleplayer game", async () => {
    await plains(GameType.Singleplayer);
    run(new PauseExecution(bob, true), 1);
    expect(game.isPaused()).toBe(true);
  });
});
