import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Turn } from "../../src/core/Schemas";
import { ShadowSimLike } from "../../src/server/ShadowSim";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

/**
 * GameServer and its shadow (ShadowSim): every committed turn reaches the
 * shadow, and a gameplay intent the shadow refuses never reaches a turn.
 * The shadow itself is a fake here; ShadowSim.test.ts covers the real one.
 */
describe("GameServer with a shadow simulation", () => {
  let shadow: {
    start: ReturnType<typeof vi.fn>;
    applyTurn: ReturnType<typeof vi.fn>;
    check: ReturnType<typeof vi.fn>;
    hashAt: ReturnType<typeof vi.fn>;
    winResult: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    shadow = {
      start: vi.fn(async () => {}),
      applyTurn: vi.fn(),
      check: vi.fn(() => null),
      hashAt: vi.fn(() => null),
      winResult: vi.fn(() => null),
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const ALICE = cid("alice");
  const actorFor = (clientID: string) => ({
    clientID,
    isLobbyCreator: false,
    isAdmin: false,
    isAdminBot: false,
  });

  it("starts the shadow with the game and hands it every turn", () => {
    const game = makeGame({
      deps: { shadowSim: () => shadow as unknown as ShadowSimLike },
    });
    game.joinClient(makeClient({ clientID: ALICE }));
    startGame(game);
    expect(shadow.start).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(350);
    expect(shadow.applyTurn).toHaveBeenCalledTimes(3);
    const turns = shadow.applyTurn.mock.calls.map(
      (c) => (c[0] as Turn).turnNumber,
    );
    expect(turns).toEqual([0, 1, 2]);
  });

  it("refuses the intent the shadow refuses, keeps it out of the turn, and counts it", () => {
    const game = makeGame({
      deps: { shadowSim: () => shadow as unknown as ShadowSimLike },
    });
    game.joinClient(makeClient({ clientID: ALICE }));
    startGame(game);

    const ok = game.handleIntent(
      { type: "attack", targetID: null, troops: 5 },
      actorFor(ALICE),
    );
    expect(ok.status).toBe(200);

    shadow.check.mockReturnValue("player is dead");
    const refused = game.handleIntent(
      { type: "attack", targetID: null, troops: 5 },
      actorFor(ALICE),
    );
    expect(refused.status).toBe(403);
    expect(refused.error).toBe("player is dead");
    expect(game.numShadowRefusals()).toBe(1);

    vi.advanceTimersByTime(150);
    const committed = shadow.applyTurn.mock.calls[0][0] as Turn;
    // The accepted attack is in the turn; the refused one is not.
    expect(committed.intents.filter((i) => i.type === "attack").length).toBe(1);
  });

  it("does not ask the shadow about control intents", () => {
    const game = makeGame({
      deps: { shadowSim: () => shadow as unknown as ShadowSimLike },
    });
    game.joinClient(makeClient({ clientID: ALICE }));
    startGame(game);
    shadow.check.mockReturnValue("nope");
    // The shadow is only consulted on the gameplay path; a control intent
    // that authorizeIntent refuses never gets there either way.
    const outcome = game.handleIntent(
      { type: "toggle_pause", paused: true },
      actorFor(ALICE),
    );
    expect(outcome.status).not.toBe(200);
    expect(game.numShadowRefusals()).toBe(0);
  });

  it("holds a lone client to the server's hash, and a majority too", async () => {
    const game = makeGame({
      deps: { shadowSim: () => shadow as unknown as ShadowSimLike },
    });
    const a = makeClient({ clientID: cid("a") });
    const b = makeClient({ clientID: cid("b") });
    const c = makeClient({ clientID: cid("c") });
    for (const x of [a, b, c]) game.joinClient(x);
    startGame(game);
    shadow.hashAt.mockImplementation((turn: number) =>
      turn === 0 ? 1234 : null,
    );
    // a and b agree with each other and not with the server; c agrees with
    // the server. Without the reference a majority would have carried it.
    await mockWsOf(a).emit({ type: "hash", hash: 9999, turnNumber: 0 });
    await mockWsOf(b).emit({ type: "hash", hash: 9999, turnNumber: 0 });
    await mockWsOf(c).emit({ type: "hash", hash: 1234, turnNumber: 0 });
    vi.advanceTimersByTime(10 * 100);
    expect(game.numDesyncedClients()).toBe(2);

    const lone = makeGame({
      deps: { shadowSim: () => shadow as unknown as ShadowSimLike },
    });
    const solo = makeClient({ clientID: cid("solo") });
    lone.joinClient(solo);
    startGame(lone);
    await mockWsOf(solo).emit({ type: "hash", hash: 9999, turnNumber: 0 });
    vi.advanceTimersByTime(10 * 100);
    expect(lone.numDesyncedClients()).toBe(1);
  });

  it("overrules a winner vote the shadow disagrees with, and records the shadow's win", async () => {
    const archive = vi.fn(async (_record: unknown) => {});
    const game = makeGame({
      deps: { shadowSim: () => shadow as unknown as ShadowSimLike, archive },
    });
    const a = makeClient({ clientID: cid("a") });
    const b = makeClient({ clientID: cid("b") });
    for (const x of [a, b]) game.joinClient(x);
    startGame(game);
    const stats = { [a.clientID]: {}, [b.clientID]: {} };
    shadow.winResult.mockReturnValue({
      winner: ["player", a.clientID],
      allPlayersStats: stats,
    });

    // b votes for themselves: overruled, and the game is not archived on it.
    await mockWsOf(b).emit({
      type: "winner",
      winner: ["player", b.clientID],
      allPlayersStats: stats,
    });
    expect(game.numOverruledWinnerVotes()).toBe(1);
    expect(archive).not.toHaveBeenCalled();

    // The honest ballots still carry the vote; the record takes the shadow's.
    await mockWsOf(a).emit({
      type: "winner",
      winner: ["player", a.clientID],
      allPlayersStats: stats,
    });
    // One of two IPs is not a majority; the vote resolves when b's IP leaves
    // the electorate or on the end-of-game path. Force the end instead.
    vi.advanceTimersByTime(100);
    expect(archive).not.toHaveBeenCalled();
    game.end();
    expect(archive).toHaveBeenCalledTimes(1);
    const record = archive.mock.calls[0][0] as unknown as {
      info: { winner?: unknown };
    };
    expect(record.info.winner).toEqual(["player", a.clientID]);
  });

  it("drops a flood of emoji with 429, counts it, and keeps the rest of the game flowing", () => {
    const game = makeGame({ deps: { shadowSim: () => null } });
    game.joinClient(makeClient({ clientID: ALICE }));
    startGame(game);
    const emoji = { type: "emoji", recipient: ALICE, emoji: "😀" } as const;
    let dropped = 0;
    for (let i = 0; i < 12; i++) {
      const outcome = game.handleIntent(emoji as never, actorFor(ALICE));
      if (outcome.status === 429) dropped++;
    }
    expect(dropped).toBe(2);
    expect(game.numSpamDrops()).toBe(2);
    // An attack is not a social intent and is never capped.
    for (let i = 0; i < 50; i++) {
      expect(
        game.handleIntent(
          { type: "attack", targetID: null, troops: 5 },
          actorFor(ALICE),
        ).status,
      ).toBe(200);
    }
  });

  it("flags a client whose attacks arrive like clockwork, and plays on", () => {
    const game = makeGame({ deps: { shadowSim: () => null } });
    game.joinClient(makeClient({ clientID: ALICE }));
    startGame(game);
    for (let i = 0; i < 45; i++) {
      // Well under the rate limiter's ten a second, exactly even.
      vi.advanceTimersByTime(200);
      const outcome = game.handleIntent(
        { type: "attack", targetID: null, troops: 5 },
        actorFor(ALICE),
      );
      expect(outcome.status).toBe(200);
    }
    expect(game.numAutomationFlags()).toBe(1);
  });

  it("runs the relay alone when there is no shadow", () => {
    const game = makeGame({ deps: { shadowSim: () => null } });
    game.joinClient(makeClient({ clientID: ALICE }));
    startGame(game);
    const ok = game.handleIntent(
      { type: "attack", targetID: null, troops: 5 },
      actorFor(ALICE),
    );
    expect(ok.status).toBe(200);
    expect(game.numShadowRefusals()).toBe(0);
  });
});
