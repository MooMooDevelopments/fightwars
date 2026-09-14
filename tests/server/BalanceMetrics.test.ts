import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import { Game, PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { metricsDashboardHtml } from "../../src/server/MetricsDashboard";
import { ShadowSimLike } from "../../src/server/ShadowSim";
import {
  cid,
  makeClient,
  makeGame,
  startGame,
} from "../util/GameServerHarness";
import { setup } from "../util/Setup";

/**
 * The balance dashboard (brief §11): a started game's leader, their share
 * against the win bar and the count standing, read from the shadow sim.
 */
describe("balance metrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  async function shadowGame(): Promise<Game> {
    const game = await setup("plains", {}, [
      new PlayerInfo("alice", PlayerType.Human, "c-a", "alice"),
      new PlayerInfo("bob", PlayerType.Human, "c-b", "bob"),
    ]);
    const a = game.player("alice");
    const b = game.player("bob");
    game.addExecution(
      new SpawnExecution("test", a.info(), game.ref(50, 50)),
      new SpawnExecution("test", b.info(), game.ref(15, 15)),
    );
    for (let i = 0; i < 3; i++) game.executeNextTick();
    while (game.inSpawnPhase()) game.executeNextTick();
    // Alice takes a strip so she leads.
    for (let x = 30; x < 70; x++)
      for (let y = 40; y < 45; y++) {
        const t = game.ref(x, y);
        if (!game.hasOwner(t)) a.conquer(t);
      }
    return game;
  }

  it("reads the leader, the bar and the count from the shadow", async () => {
    const shadowed = await shadowGame();
    const shadow: ShadowSimLike = {
      start: async () => {},
      applyTurn: () => {},
      check: () => null,
      hashAt: () => null,
      winResult: () => null,
      game: () => shadowed,
    };
    const server = makeGame({
      id: cid("bal"),
      deps: { shadowSim: () => shadow },
    });
    expect(server.balanceSnapshot()).toBeNull();
    server.joinClient(makeClient());
    startGame(server);
    const snap = server.balanceSnapshot()!;
    expect(snap).not.toBeNull();
    expect(snap.alive).toBe(2);
    expect(snap.humansAlive).toBe(2);
    expect(snap.leaderName).toBe("alice");
    expect(snap.leaderShare).toBeGreaterThan(0);
    expect(snap.leaderShare).toBeLessThan(1);
    expect(snap.claimedShare).toBeGreaterThanOrEqual(snap.leaderShare);
    expect(snap.winBar).toBeCloseTo(0.8, 5);
  });

  it("has no snapshot without a shadow, and the dashboard carries the table", () => {
    const server = makeGame({ deps: { shadowSim: () => null } });
    server.joinClient(makeClient());
    startGame(server);
    expect(server.balanceSnapshot()).toBeNull();
    const html = metricsDashboardHtml(2);
    expect(html).toContain('id="balance"');
    expect(html).toContain("leader share");
  });
});
