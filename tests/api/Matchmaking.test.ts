// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createApiApp, type ApiContext } from "../../src/api/App";
import {
  pickGroup,
  splitTeams,
  type QueueEntry,
} from "../../src/api/Matchmaking";
import { CloseCode } from "../../src/core/CloseCodes";
import { apiTestEnv } from "./fixtures";

const API_KEY = "test-api-key";
let ctx: ApiContext;
let base: string;
let wsBase: string;
let server: ReturnType<ApiContext["app"]["listen"]>;

beforeAll(async () => {
  ctx = await createApiApp(await apiTestEnv());
  await new Promise<void>((resolve) => {
    server = ctx.app.listen(0, () => resolve());
  });
  ctx.matchmaking.attach(server);
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});

afterAll(async () => {
  ctx.matchmaking.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await ctx.db.close();
});

interface Client {
  ws: WebSocket;
  messages: { type: string; [k: string]: unknown }[];
  next(type: string): Promise<{ type: string; [k: string]: unknown }>;
}

function connect(mode: "1v1" | "2v2", jwt: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `${wsBase}/matchmaking/join?instance_id=DEV_ID&mode=${mode}`,
    );
    const messages: Client["messages"] = [];
    const waiters: {
      type: string;
      resolve: (m: Client["messages"][number]) => void;
    }[] = [];
    ws.on("message", (d) => {
      const m = JSON.parse(String(d)) as Client["messages"][number];
      messages.push(m);
      const i = waiters.findIndex((w) => w.type === m.type);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    });
    ws.on("error", reject);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "join", jwt }));
      resolve({
        ws,
        messages,
        next: (type) =>
          new Promise((res) => {
            const found = messages.find((m) => m.type === type);
            if (found) res(found);
            else waiters.push({ type, resolve: res });
          }),
      });
    });
  });
}

async function checkin(mode: "1v1" | "2v2", gameId: string) {
  const r = await fetch(`${base}/matchmaking/checkin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ id: 0, gameId, ccu: 0, instanceId: "DEV_ID", mode }),
  });
  return (await r.json()) as {
    assignment?: { players: string[]; teams: string[][] };
  };
}

describe("ranked matchmaking", () => {
  it("queues two players, reports the queue size, and assigns them the worker's game id", async () => {
    const a = await connect("1v1", randomUUID());
    expect((await a.next("queue-size")).count).toBe(1);
    // Nobody to match yet: the worker's offer is declined.
    expect(await checkin("1v1", "gAmE0011")).toEqual({});

    const b = await connect("1v1", randomUUID());
    await b.next("queue-size");
    expect(ctx.matchmaking.size("1v1")).toBe(2);

    const offer = await checkin("1v1", "gAmE0012");
    expect(offer.assignment).toBeDefined();
    expect(offer.assignment!.players).toHaveLength(2);
    expect(offer.assignment!.teams).toEqual([
      [offer.assignment!.players[0]],
      [offer.assignment!.players[1]],
    ]);
    for (const c of [a, b]) {
      const m = await c.next("match-assignment");
      expect(m.gameId).toBe("gAmE0012");
      c.ws.close();
    }
    expect(ctx.matchmaking.size("1v1")).toBe(0);
    // Public ids are real accounts.
    for (const id of offer.assignment!.players) {
      expect((await fetch(`${base}/public/player/${id}`)).status).toBe(200);
    }
  });

  it("refuses a bad token and leaves the queue untouched", async () => {
    const ws = new WebSocket(
      `${wsBase}/matchmaking/join?instance_id=DEV_ID&mode=1v1`,
    );
    const code = await new Promise<number>((resolve) => {
      ws.on("open", () =>
        ws.send(JSON.stringify({ type: "join", jwt: "not-a-token" })),
      );
      ws.on("close", (c) => resolve(c));
    });
    expect(code).toBe(CloseCode.Unauthorized);
    expect(ctx.matchmaking.size("1v1")).toBe(0);
  });

  it("2v2 needs four and splits them into two balanced teams", async () => {
    const clients = await Promise.all(
      [1, 2, 3, 4].map(() => connect("2v2", randomUUID())),
    );
    await Promise.all(clients.map((c) => c.next("queue-size")));
    expect(await checkin("1v1", "gAmE0021")).toEqual({}); // wrong mode
    const offer = await checkin("2v2", "gAmE0022");
    expect(offer.assignment!.players).toHaveLength(4);
    expect(offer.assignment!.teams.map((t) => t.length)).toEqual([2, 2]);
    for (const c of clients) {
      expect((await c.next("match-assignment")).gameId).toBe("gAmE0022");
      c.ws.close();
    }
  });
});

describe("pairing", () => {
  const e = (rating: number, joinedAt = 0): QueueEntry =>
    ({ rating, joinedAt, publicId: String(rating) }) as unknown as QueueEntry;

  it("takes the closest pair inside the allowed gap and widens with patience", () => {
    const now = 10_000;
    expect(pickGroup([e(1500, now), e(1900, now)], 2, now)).toBeNull();
    const g = pickGroup([e(1500, now), e(1580, now), e(1900, now)], 2, now)!;
    expect(g.map((x) => x.rating)).toEqual([1500, 1580]);
    // 400 apart, but the older one has waited 40 s → allowed 500.
    expect(
      pickGroup([e(1500, now - 40_000), e(1900, now)], 2, now),
    ).not.toBeNull();
  });

  it("splits four into the two teams with the closest rating sums", () => {
    const teams = splitTeams([e(1400), e(1500), e(1600), e(1700)], "2v2");
    const sums = teams.map((t) => t.reduce((s, x) => s + x.rating, 0));
    expect(sums[0]).toBe(sums[1]);
  });
});
