import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Turn } from "../../src/core/Schemas";
import { ShadowSimLike } from "../../src/server/ShadowSim";
import {
  cid,
  makeClient,
  makeGame,
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
  };

  beforeEach(() => {
    vi.useFakeTimers();
    shadow = {
      start: vi.fn(async () => {}),
      applyTurn: vi.fn(),
      check: vi.fn(() => null),
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
