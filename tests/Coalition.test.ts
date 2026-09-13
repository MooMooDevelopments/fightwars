import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { WinCheckExecution } from "../src/core/execution/WinCheckExecution";
import {
  AllianceRequest,
  AllianceTier,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Tick,
} from "../src/core/game/Game";
import { CoalitionUpdate, GameUpdateType } from "../src/core/game/GameUpdates";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

/**
 * Auto-coalitions (brief §6.5). Once any side holds 40 % of the land,
 * everyone else is offered a coalition: nations take pacts and defensive
 * pacts from any non-leader without their usual reluctance, and one update
 * goes out — once, on the flip — so the client can show humans a card.
 */

let game: Game;
let leader: Player;
let nation: Player;
let small: Player;

beforeEach(async () => {
  game = await setup("plains", { infiniteGold: true, instantBuild: true }, [
    new PlayerInfo("leader", PlayerType.Human, "c-l", "leader"),
    new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
    new PlayerInfo("small", PlayerType.Human, "c-s", "small"),
  ]);
  leader = game.player("leader");
  nation = game.player("nation");
  small = game.player("small");
  // plains is 100x100 all land: give the leader half of it.
  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 100; x++) leader.conquer(game.ref(x, y));
  }
  for (let x = 0; x < 20; x++) nation.conquer(game.ref(x, 60));
  for (let x = 30; x < 50; x++) small.conquer(game.ref(x, 60));
  while (game.inSpawnPhase()) game.executeNextTick();
  // Registered, not driven by hand: an update only reaches the client if it
  // is added *during* a tick, which is where the real win check runs.
  game.addExecution(new WinCheckExecution());
  game.executeNextTick(); // init
});

/** Advances to the next tick the win check runs on and returns its coalition updates. */
function runWinCheck(): CoalitionUpdate[] {
  while (game.ticks() % 10 !== 0) game.executeNextTick();
  return game.executeNextTick()[GameUpdateType.Coalition] as CoalitionUpdate[];
}

describe("the leader and its share", () => {
  it("is published by the win check", () => {
    runWinCheck();
    expect(game.leader()).toBe(leader);
    expect(game.leaderShare()).toBeCloseTo(0.5, 2);
  });

  it("announces the coalition once on the way up, and once on the way down", () => {
    let sent = runWinCheck();
    expect(sent.length).toBe(1);
    expect(sent[0].active).toBe(true);
    expect(sent[0].leaderID).toBe(leader.smallID());
    expect(sent[0].share).toBeCloseTo(0.5, 2);

    // Still above: nothing new — the card must not be re-issued every check.
    expect(runWinCheck().length).toBe(0);

    // The leader falls to 30 %: the offer is withdrawn, once.
    for (let y = 30; y < 50; y++) {
      for (let x = 0; x < 100; x++) leader.relinquish(game.ref(x, y));
    }
    sent = runWinCheck();
    expect(sent.length).toBe(1);
    expect(sent[0].active).toBe(false);
    expect(runWinCheck().length).toBe(0);
  });
});

describe("nations under a coalition", () => {
  function decideOn(requestor: Player, tier: AllianceTier): AllianceRequest {
    const random = new PseudoRandom(46);
    const behavior = new NationAllianceBehavior(
      random,
      game,
      nation,
      new NationEmojiBehavior(random, game, nation),
    );
    const request = {
      requestor: () => requestor,
      recipient: () => nation,
      createdAt: () => (game.config().numSpawnPhaseTurns() + 2) as Tick,
      tier: () => tier,
      accept: vi.fn(),
      reject: vi.fn(),
    } as unknown as AllianceRequest;
    vi.spyOn(nation, "incomingAllianceRequests").mockReturnValue([request]);
    // Pin the ordinary reckoning to "no": not a threat, not the honeymoon,
    // not similarly strong. Whatever says yes from here is the coalition.
    const priv = behavior as unknown as Record<string, () => boolean>;
    vi.spyOn(priv, "isAlliancePartnerThreat").mockReturnValue(false);
    vi.spyOn(priv, "isEarlygame").mockReturnValue(false);
    vi.spyOn(priv, "isAlliancePartnerSimilarlyStrong").mockReturnValue(false);
    behavior.handleAllianceRequests();
    return request;
  }

  it("take a defensive pact from a fellow non-leader they would otherwise weigh", () => {
    game.setLeader(leader, 0.5);
    // Relation neutral, no history: below the threshold this goes through
    // the usual reckoning; under a coalition it is simply yes.
    const request = decideOn(small, AllianceTier.DefensivePact);
    expect(request.accept).toHaveBeenCalled();
  });

  it("do not extend that welcome to the leader", () => {
    game.setLeader(leader, 0.5);
    nation.updateRelation(leader, -60); // hostile, so the ordinary path says no
    const request = decideOn(leader, AllianceTier.DefensivePact);
    expect(request.accept).not.toHaveBeenCalled();
  });

  it("go back to weighing once the leader falls below the threshold", () => {
    game.setLeader(leader, 0.3);
    // Same neutral stranger as above; only the coalition is gone.
    const request = decideOn(small, AllianceTier.DefensivePact);
    expect(request.accept).not.toHaveBeenCalled();
  });
});
