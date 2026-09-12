import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameWireContext } from "../../src/core/ZbinWire";
import { Client } from "../../src/server/Client";
import {
  alertDesync,
  desyncEventCount,
  resetDesyncAlerts,
} from "../../src/server/DesyncAlert";
import {
  cid,
  makeClient,
  makeGame,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// A desync must never be silent: the first one in a game is an error-level
// log, repeats are warnings, every one counts, and an optional webhook fires.

const TURN_MS = 100;

describe("alertDesync", () => {
  beforeEach(() => resetDesyncAlerts());

  const event = (over: Partial<Parameters<typeof alertDesync>[1]> = {}) => ({
    gameID: "game0001",
    turn: 20,
    mostCommonHash: 1234,
    outOfSyncClientIDs: ["c1000000"],
    totalActiveClients: 3,
    gitCommit: "DEV",
    ...over,
  });

  it("logs the first desync in a game at error level, repeats at warn", () => {
    const log = mockLogger();
    alertDesync(log, event(), {});
    alertDesync(log, event({ turn: 30 }), {});
    alertDesync(log, event({ gameID: "game0002" }), {});
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][1]).toMatchObject({
      gameID: "game0001",
      turn: 20,
      outOfSync: 1,
      outOfSyncClientIDs: ["c1000000"],
      totalActiveClients: 3,
      firstInGame: true,
    });
    expect(desyncEventCount()).toBe(3);
  });

  it("posts to DESYNC_WEBHOOK_URL when set and swallows failures", async () => {
    const log = mockLogger();
    const ok = vi.fn(async () => new Response("ok"));
    alertDesync(
      log,
      event(),
      { DESYNC_WEBHOOK_URL: "https://hook.test/x" },
      ok,
    );
    expect(ok).toHaveBeenCalledTimes(1);
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hook.test/x");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      type: "desync",
      gameID: "game0001",
      turn: 20,
    });

    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    alertDesync(
      log,
      event({ turn: 30 }),
      { DESYNC_WEBHOOK_URL: "https://hook.test/x" },
      failing,
    );
    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith(
        "desync webhook failed",
        expect.objectContaining({ gameID: "game0001" }),
      ),
    );
  });

  it("does not call fetch when no webhook is configured", () => {
    const log = mockLogger();
    const f = vi.fn(async () => new Response("ok"));
    alertDesync(log, event(), {}, f);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("GameServer desync alerting", () => {
  beforeEach(() => {
    resetDesyncAlerts();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function reportHash(client: Client, turnNumber: number, hash: number) {
    await mockWsOf(client).emit({ type: "hash", hash, turnNumber });
  }

  it("raises an error-level alert when a client disagrees on a turn hash", async () => {
    const log = mockLogger();
    const game = makeGame({ log, id: cid("dsync") });
    const clients = ["a", "b", "c"].map((t) =>
      makeClient({ clientID: cid(`al${t}`) }),
    );
    for (const c of clients) game.joinClient(c);
    startGame(game);
    createGameWireContext(clients.map((c) => ({ clientID: c.clientID })));

    const [a, b, c] = clients;
    await reportHash(a, 0, 1234);
    await reportHash(b, 0, 1234);
    await reportHash(c, 0, 4321);
    vi.advanceTimersByTime(10 * TURN_MS);

    expect(log.error).toHaveBeenCalledWith(
      "DESYNC: clients disagree on game state",
      expect.objectContaining({
        gameID: cid("dsync"),
        turn: 0,
        outOfSync: 1,
        outOfSyncClientIDs: [c.clientID],
        totalActiveClients: 3,
      }),
    );
    expect(desyncEventCount()).toBe(1);
  });

  it("stays silent when every client agrees", async () => {
    const log = mockLogger();
    const game = makeGame({ log, id: cid("agree") });
    const clients = ["a", "b"].map((t) =>
      makeClient({ clientID: cid(`ag${t}`) }),
    );
    for (const c of clients) game.joinClient(c);
    startGame(game);
    for (const c of clients) await reportHash(c, 0, 1234);
    vi.advanceTimersByTime(10 * TURN_MS);
    expect(log.error).not.toHaveBeenCalled();
    expect(desyncEventCount()).toBe(0);
  });
});
