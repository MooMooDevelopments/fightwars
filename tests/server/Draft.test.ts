import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameMode } from "../../src/core/game/Game";
import { makeClient, makeGame } from "../util/GameServerHarness";

/**
 * Draft (brief §6.7): the host and the first other player captain; they pick
 * the pool in snake order; every pick is a team pin the lobby shows and the
 * start stamps.
 */
describe("GameServer draft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  const actor = (clientID: string, creator = false) => ({
    clientID,
    isLobbyCreator: creator,
    isAdmin: false,
    isAdminBot: false,
  });

  function lobby() {
    const game = makeGame({
      creatorPersistentID: "creator-pid",
      config: { gameMode: GameMode.Team, playerTeams: 2, draft: true },
    });
    const host = makeClient({
      clientID: "hostAAAAA",
      persistentID: "creator-pid",
    });
    const b = makeClient({ clientID: "playerBBB" });
    const c = makeClient({ clientID: "playerCCC" });
    const d = makeClient({ clientID: "playerDDD" });
    for (const cl of [host, b, c, d])
      expect(game.joinClient(cl)).toBe("joined");
    return { game, host, b, c, d };
  }

  it("seats the host and the first other player as captains, host to pick first", () => {
    const { game } = lobby();
    const info = game.gameInfo();
    expect(info.draft).toEqual({
      captains: ["hostAAAAA", "playerBBB"],
      turn: "hostAAAAA",
      picked: [],
    });
    const byId = new Map(info.clients!.map((c) => [c.clientID, c.teamIndex]));
    expect(byId.get("hostAAAAA")).toBe(0);
    expect(byId.get("playerBBB")).toBe(1);
    expect(byId.get("playerCCC")).toBeUndefined();
  });

  it("picks in snake order and pins each pick to the captain's team", () => {
    const { game } = lobby();
    expect(
      game.handleIntent(
        { type: "draft_pick", target: "playerCCC" },
        actor("hostAAAAA", true),
      ).status,
    ).toBe(200);
    let info = game.gameInfo();
    expect(info.draft?.turn).toBe("playerBBB");
    expect(info.draft?.picked).toEqual(["playerCCC"]);
    expect(
      info.clients!.find((c) => c.clientID === "playerCCC")?.teamIndex,
    ).toBe(0);
    expect(
      game.handleIntent(
        { type: "draft_pick", target: "playerDDD" },
        actor("playerBBB"),
      ).status,
    ).toBe(200);
    info = game.gameInfo();
    expect(
      info.clients!.find((c) => c.clientID === "playerDDD")?.teamIndex,
    ).toBe(1);
    // Everyone placed: no turn.
    expect(info.draft?.turn).toBeNull();
  });

  it("refuses a pick out of turn, of a captain, or of someone already picked", () => {
    const { game } = lobby();
    expect(
      game.handleIntent(
        { type: "draft_pick", target: "playerCCC" },
        actor("playerBBB"),
      ).status,
    ).toBe(403);
    expect(
      game.handleIntent(
        { type: "draft_pick", target: "playerBBB" },
        actor("hostAAAAA", true),
      ).status,
    ).toBe(400);
    game.handleIntent(
      { type: "draft_pick", target: "playerCCC" },
      actor("hostAAAAA", true),
    );
    expect(
      game.handleIntent(
        { type: "draft_pick", target: "playerCCC" },
        actor("playerBBB"),
      ).status,
    ).toBe(400);
  });

  it("is off without the flag, and off again when the host turns it off", () => {
    const game = makeGame({
      creatorPersistentID: "creator-pid",
      config: { gameMode: GameMode.Team, playerTeams: 2 },
    });
    game.joinClient(
      makeClient({ clientID: "hostAAAAA", persistentID: "creator-pid" }),
    );
    game.joinClient(makeClient({ clientID: "playerBBB" }));
    expect(game.gameInfo().draft).toBeUndefined();
    expect(
      game.handleIntent(
        { type: "draft_pick", target: "playerBBB" },
        actor("hostAAAAA", true),
      ).status,
    ).toBe(400);
    game.updateGameConfig({ draft: true });
    expect(game.gameInfo().draft?.captains).toEqual(["hostAAAAA", "playerBBB"]);
    game.updateGameConfig({ draft: false });
    expect(game.gameInfo().draft).toBeUndefined();
    expect(
      game.gameInfo().clients!.every((c) => c.teamIndex === undefined),
    ).toBe(true);
  });
});
