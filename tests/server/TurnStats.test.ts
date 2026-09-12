import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnStats } from "../../src/server/TurnStats";
import {
  cid,
  makeClient,
  makeGame,
  startGame,
} from "../util/GameServerHarness";

describe("TurnStats", () => {
  it("summarises a window of turn durations and bytes", () => {
    const s = new TurnStats(100, 4);
    s.record(1, 100, 1000);
    s.record(2, 100, 1100);
    s.record(3, 100, 1200);
    s.record(150, 100, 1300); // one over budget
    s.record(4, 100, 1400); // evicts the first sample
    const snap = s.snapshot();
    expect(snap.turns).toBe(5);
    expect(snap.window).toBe(4);
    expect(snap.maxMs).toBe(150);
    expect(snap.overBudget).toBe(1);
    expect(snap.bytesOut).toBe(500);
    expect(snap.p50Ms).toBeGreaterThanOrEqual(3);
    expect(snap.p99Ms).toBe(150);
    expect(snap.meanMs).toBeCloseTo((2 + 3 + 150 + 4) / 4, 5);
    // 400 bytes over the 0.3 s the window spans.
    expect(snap.bytesOutPerSec).toBeCloseTo(400 / 0.3, 3);
  });

  it("is safe before any turn", () => {
    const snap = new TurnStats(100).snapshot();
    expect(snap).toMatchObject({ turns: 0, window: 0, meanMs: 0, bytesOut: 0 });
  });
});

describe("GameServer turn timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("records one sample per committed turn and the bytes broadcast", () => {
    const game = makeGame({ id: cid("tstats") });
    const clients = ["a", "b"].map((t) =>
      makeClient({ clientID: cid(`ts${t}`) }),
    );
    for (const c of clients) game.joinClient(c);
    startGame(game);
    vi.advanceTimersByTime(10 * 100);
    const snap = game.turnStatsSnapshot();
    expect(snap.turns).toBeGreaterThanOrEqual(10);
    expect(snap.window).toBe(snap.turns);
    // Two open sockets each received every turn frame.
    expect(snap.bytesOut).toBeGreaterThan(0);
    expect(snap.bytesOut % 2).toBe(0);
    expect(snap.overBudget).toBe(0);
  });
});
