// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GameRecordSchema } from "../../src/core/Schemas";
import {
  call,
  ingest,
  makeRecord,
  startTestApi,
  type TestApi,
} from "./fixtures";

// docs/API.md "Games": the public listing and the scrubbed record.

let api: TestApi;
const T0 = Date.parse("2026-09-01T00:00:00Z");
const pid = randomUUID();

beforeAll(async () => {
  api = await startTestApi();
  await ingest(
    api.base,
    makeRecord({
      gameID: "pubGame01",
      start: T0,
      gameType: "Public",
      gameMode: "Team",
      playerTeams: "Duos",
      maxPlayers: 8,
      players: [
        { clientID: "c1000000", persistentID: pid },
        { clientID: "c2000000", persistentID: randomUUID() },
      ],
      winner: ["c1000000"],
    }),
  );
  await ingest(
    api.base,
    makeRecord({
      gameID: "pubGame02",
      start: T0 + 3_600_000,
      gameType: "Private",
      players: [
        { clientID: "c1000000", persistentID: pid },
        { clientID: "c3000000" },
      ],
      winner: "c3000000",
    }),
  );
  await ingest(
    api.base,
    makeRecord({
      gameID: "pubGame03",
      start: T0 + 3 * 86_400_000,
      gameType: "Public",
      rankedType: "1v1",
      players: [
        { clientID: "c1000000", persistentID: pid },
        { clientID: "c4000000" },
      ],
      winner: null,
    }),
  );
});

afterAll(async () => {
  await api.close();
});

const iso = (ms: number) => encodeURIComponent(new Date(ms).toISOString());

describe("GET /public/games", () => {
  it("requires a start/end range of at most two days", async () => {
    expect((await call(api.base, null, "GET", "/public/games")).status).toBe(
      400,
    );
    const wide = await call(
      api.base,
      null,
      "GET",
      `/public/games?start=${iso(T0)}&end=${iso(T0 + 5 * 86_400_000)}`,
    );
    expect(wide.status).toBe(400);
  });

  it("lists games in the window oldest first with a Content-Range header and filters", async () => {
    const r = await call(
      api.base,
      null,
      "GET",
      `/public/games?start=${iso(T0)}&end=${iso(T0 + 86_400_000)}`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-range")).toBe("games 0-2/2");
    const games = r.json as Record<string, unknown>[];
    expect(games.map((g) => g.game)).toEqual(["pubGame01", "pubGame02"]);
    expect(games[0]).toMatchObject({
      type: "Public",
      mode: "Team",
      difficulty: "Medium",
      numPlayers: 2,
      maxPlayers: 8,
      lobbyFillTime: 5000,
      playerTeams: "Duos",
      rankedType: "unranked",
      start: new Date(T0).toISOString(),
    });

    const teams = await call(
      api.base,
      null,
      "GET",
      `/public/games?start=${iso(T0)}&end=${iso(T0 + 86_400_000)}&mode=Team&playerTeams=Duos`,
    );
    expect((teams.json as { game: string }[]).map((g) => g.game)).toEqual([
      "pubGame01",
    ]);
    const priv = await call(
      api.base,
      null,
      "GET",
      `/public/games?start=${iso(T0)}&end=${iso(T0 + 86_400_000)}&type=Private`,
    );
    expect((priv.json as { game: string }[]).map((g) => g.game)).toEqual([
      "pubGame02",
    ]);
    const paged = await call(
      api.base,
      null,
      "GET",
      `/public/games?start=${iso(T0)}&end=${iso(T0 + 86_400_000)}&limit=1&offset=1`,
    );
    expect(paged.headers.get("content-range")).toBe("games 1-2/2");
    expect((paged.json as { game: string }[]).map((g) => g.game)).toEqual([
      "pubGame02",
    ]);
    const ranked = await call(
      api.base,
      null,
      "GET",
      `/public/games?start=${iso(T0 + 2 * 86_400_000)}&end=${iso(T0 + 4 * 86_400_000)}&rankedType=1v1`,
    );
    expect(ranked.json as { game: string; rankedType: string }[]).toEqual([
      expect.objectContaining({ game: "pubGame03", rankedType: "1v1" }),
    ]);
  });
});

describe("GET /public/game/:id and GET /game/:id", () => {
  it("serve the record without persistent ids, optionally without turns", async () => {
    const full = await call(api.base, null, "GET", "/public/game/pubGame01");
    expect(full.status).toBe(200);
    const record = GameRecordSchema.parse(full.json);
    expect(record.info.players.map((p) => p.persistentID)).toEqual([
      null,
      null,
    ]);
    expect(record.info.reports).toBeUndefined();
    expect(record.turns).toHaveLength(1);

    const slim = await call(
      api.base,
      null,
      "GET",
      "/public/game/pubGame01?turns=false",
    );
    expect((slim.json as { turns?: unknown }).turns).toBeUndefined();

    const internal = await call(api.base, null, "GET", "/game/pubGame01");
    expect(
      GameRecordSchema.parse(internal.json).info.players[0].persistentID,
    ).toBeNull();
    expect(
      (await call(api.base, null, "GET", "/public/game/nope00000")).status,
    ).toBe(404);
  });
});
