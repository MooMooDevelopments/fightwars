import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { BreakAllianceExecution } from "../src/core/execution/alliance/BreakAllianceExecution";
import {
  AllianceTier,
  Game,
  nextAllianceTier,
  Player,
  PlayerType,
} from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

/**
 * Tiered relations (brief §6.5). One button, climbed by asking again: the
 * first request is a non-aggression pact, the next a defensive pact, the
 * next a full alliance. Each rung unlocks more and costs more to break.
 */

let game: Game;
let a: Player;
let b: Player;

beforeEach(async () => {
  game = await setup(
    "plains",
    { infiniteGold: true, instantBuild: true, infiniteTroops: true },
    [playerInfo("a", PlayerType.Human), playerInfo("b", PlayerType.Human)],
  );
  a = game.player("a");
  b = game.player("b");
  a.conquer(game.ref(0, 0));
  b.conquer(game.ref(0, 1));
});

/** A second request to the same player inside the cooldown is refused. */
function pastCooldown() {
  const wait = game.config().allianceRequestCooldown() + 1;
  for (let i = 0; i < wait; i++) game.executeNextTick();
}

/** a asks, b answers by asking back — the shape the accept button sends. */
function agree(tier?: AllianceTier) {
  pastCooldown();
  game.addExecution(new AllianceRequestExecution(a, b.id(), tier));
  game.executeNextTick();
  const asked = a.outgoingAllianceRequests()[0]?.tier();
  game.addExecution(new AllianceRequestExecution(b, a.id(), asked));
  game.executeNextTick();
}

describe("the ladder", () => {
  it("starts at a non-aggression pact and climbs one rung per agreement", () => {
    expect(nextAllianceTier(null)).toBe(AllianceTier.NonAggression);
    agree();
    expect(a.allianceTierWith(b)).toBe(AllianceTier.NonAggression);
    expect(a.isAlliedWith(b)).toBe(true);

    agree();
    expect(a.allianceTierWith(b)).toBe(AllianceTier.DefensivePact);
    agree();
    expect(a.allianceTierWith(b)).toBe(AllianceTier.FullAlliance);
    // One alliance object throughout, climbed in place.
    expect(a.alliances().length).toBe(1);
  });

  it("stops at the top: nothing left to ask for", () => {
    agree();
    agree();
    agree();
    expect(a.canSendAllianceRequest(b)).toBe(false);
    expect(nextAllianceTier(AllianceTier.FullAlliance)).toBe(
      AllianceTier.FullAlliance,
    );
  });

  it("refuses a request that would not climb", () => {
    agree(AllianceTier.DefensivePact);
    expect(a.allianceTierWith(b)).toBe(AllianceTier.DefensivePact);
    game.addExecution(
      new AllianceRequestExecution(a, b.id(), AllianceTier.NonAggression),
    );
    game.executeNextTick();
    expect(a.outgoingAllianceRequests().length).toBe(0);
    expect(a.allianceTierWith(b)).toBe(AllianceTier.DefensivePact);
  });

  it("can ask for a rung straight away, and the answer is at that rung", () => {
    agree(AllianceTier.FullAlliance);
    expect(a.allianceTierWith(b)).toBe(AllianceTier.FullAlliance);
  });

  it("resets the clock when a bond deepens", () => {
    agree();
    const expiresAt = a.allianceWith(b)!.expiresAt();
    agree(); // waits out the cooldown first, so the clock has moved

    expect(a.allianceWith(b)!.expiresAt()).toBeGreaterThan(expiresAt);
  });
});

describe("what each rung means", () => {
  it("a pact keeps the peace and nothing more", () => {
    agree(AllianceTier.NonAggression);
    expect(a.isFriendly(b)).toBe(true);
    expect(a.canAttackPlayer(b)).toBe(false);
    expect(a.allies()).toEqual([]);
  });

  it("a defensive pact makes a partner an ally worth defending", () => {
    agree(AllianceTier.DefensivePact);
    expect(a.allies()).toEqual([b]);
    expect(b.allies()).toEqual([a]);
  });

  it("ships the rung and the next one in the alliance info", () => {
    agree(AllianceTier.DefensivePact);
    const info = a.allianceInfo(b)!;
    expect(info.tier).toBe(AllianceTier.DefensivePact);
    expect(info.nextTier).toBe(AllianceTier.FullAlliance);
    agree(AllianceTier.FullAlliance);
    expect(a.allianceInfo(b)!.nextTier).toBeNull();
  });
});

describe("breaking a promise costs in proportion to the promise", () => {
  function breakAt(tier: AllianceTier): number {
    agree(tier);
    game.addExecution(new BreakAllianceExecution(a, b.id()));
    game.executeNextTick(); // init
    game.executeNextTick(); // the break happens in tick()
    expect(a.isTraitor()).toBe(true);
    // PlayerImpl keeps the countdown; the Player interface only exposes isTraitor.
    return (
      a as unknown as { getTraitorRemainingTicks(): number }
    ).getTraitorRemainingTicks();
  }

  it("marks the breaker for longer the deeper the bond", async () => {
    const pact = breakAt(AllianceTier.NonAggression);

    game = await setup(
      "plains",
      { infiniteGold: true, instantBuild: true, infiniteTroops: true },
      [playerInfo("a", PlayerType.Human), playerInfo("b", PlayerType.Human)],
    );
    a = game.player("a");
    b = game.player("b");
    a.conquer(game.ref(0, 0));
    b.conquer(game.ref(0, 1));
    const full = breakAt(AllianceTier.FullAlliance);

    expect(pact).toBeLessThan(full);
    // Read one tick after the mark was made, so one tick has already elapsed.
    const base = game.config().traitorDuration();
    expect(pact).toBe(Math.floor(base * 0.5) - 1);
    expect(full).toBe(Math.floor(base * 1.5) - 1);
  });
});

describe("with tiers off", () => {
  it("every request is a full alliance and there is no ladder", () => {
    vi.spyOn(game.config(), "allianceTiersEnabled").mockReturnValue(false);
    agree();
    expect(a.allianceTierWith(b)).toBe(AllianceTier.FullAlliance);
    expect(a.canSendAllianceRequest(b)).toBe(false);
    vi.restoreAllMocks();
  });
});
