// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApp, type ApiContext } from "../../src/api/App";
import {
  PlayerProfileSchema,
  PublicPlayerGamesResponseSchema,
  RankedLeaderboardResponseSchema,
  UserMeResponseSchema,
} from "../../src/core/ApiSchemas";
import { GameRecordSchema } from "../../src/core/Schemas";
import { apiTestEnv } from "./fixtures";

// Profile routes are parsed with the client's own schemas.

const API_KEY = "test-api-key";
let ctx: ApiContext;
let base: string;
let server: ReturnType<ApiContext["app"]["listen"]>;

beforeAll(async () => {
  ctx = await createApiApp(await apiTestEnv());
  await new Promise<void>((resolve) => {
    server = ctx.app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await ctx.db.close();
});

function record(
  gameID: string,
  players: { clientID: string; persistentID: string }[],
  winner: string,
  start: number,
) {
  return GameRecordSchema.parse({
    version: "v0.0.2",
    gitCommit: "0123456789abcdef0123456789abcdef01234567",
    subdomain: "dev",
    domain: "localhost",
    info: {
      gameID,
      lobbyCreatedAt: start - 5000,
      start,
      end: start + 90_000,
      duration: 90_000,
      num_turns: 900,
      lobbyFillTime: 5000,
      winner: ["player", winner],
      config: {
        gameMap: "Africa",
        difficulty: "Medium",
        donateGold: true,
        donateTroops: true,
        gameType: "Public",
        gameMode: "Free For All",
        gameMapSize: "Normal",
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        nations: "disabled",
      },
      players: players.map((p, i) => ({
        clientID: p.clientID,
        username: `Player${i}`,
        clanTag: null,
        persistentID: p.persistentID,
        stats: { conquests: ["1"] },
      })),
    },
    turns: [{ turnNumber: 0, intents: [] }],
  });
}

async function ingest(rec: ReturnType<typeof record>) {
  const body = JSON.stringify(rec, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  const r = await fetch(`${base}/game/${rec.info.gameID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body,
  });
  expect(r.status).toBe(200);
}

describe("profile routes", () => {
  const alice = randomUUID();
  const bob = randomUUID();
  let alicePublic = "";

  it("serves a profile the client can parse, 404 for strangers", async () => {
    const login = (await (
      await fetch(`${base}/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistentId: alice }),
      })
    ).json()) as { publicId: string };
    alicePublic = login.publicId;
    const res = await fetch(`${base}/public/player/${alicePublic}`);
    expect(res.status).toBe(200);
    const parsed = PlayerProfileSchema.safeParse(await res.json());
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    expect((await fetch(`${base}/public/player/nobody`)).status).toBe(404);
  });

  it("lists a player's games newest first with a working cursor and filters", async () => {
    // 22 games so the 20-per-page history needs a second page.
    for (let i = 0; i < 22; i++) {
      await ingest(
        record(
          `hIst${String(i).padStart(4, "0")}`,
          [
            { clientID: "c1000000", persistentID: alice },
            { clientID: "c2000000", persistentID: bob },
          ],
          i % 2 === 0 ? "c1000000" : "c2000000",
          1_700_000_000_000 + i * 600_000,
        ),
      );
    }
    const first = await fetch(`${base}/public/player/${alicePublic}/games`);
    expect(first.status).toBe(200);
    const page1 = PublicPlayerGamesResponseSchema.parse(await first.json());
    expect(page1.results).toHaveLength(20);
    expect(page1.results[0].gameId).toBe("hIst0021");
    expect(page1.results[0].result).toBe("defeat");
    expect(page1.results[1].result).toBe("victory");
    expect(page1.results[0].durationSeconds).toBe(90);
    expect(page1.nextCursor).not.toBeNull();

    const second = await fetch(
      `${base}/public/player/${alicePublic}/games?cursor=${encodeURIComponent(page1.nextCursor!)}`,
    );
    const page2 = PublicPlayerGamesResponseSchema.parse(await second.json());
    expect(page2.results.map((g) => g.gameId)).toEqual([
      "hIst0001",
      "hIst0000",
    ]);
    expect(page2.nextCursor).toBeNull();

    const teamOnly = PublicPlayerGamesResponseSchema.parse(
      await (
        await fetch(`${base}/public/player/${alicePublic}/games?filter=team`)
      ).json(),
    );
    expect(teamOnly.results).toHaveLength(0);
    const privateOnly = PublicPlayerGamesResponseSchema.parse(
      await (
        await fetch(`${base}/public/player/${alicePublic}/games?type=private`)
      ).json(),
    );
    expect(privateOnly.results).toHaveLength(0);
    expect(
      (await fetch(`${base}/public/player/${alicePublic}/games?cursor=garbage`))
        .status,
    ).toBe(400);
  });

  it("keeps a player in placement off the ladder and says how far along they are", async () => {
    const carol = randomUUID();
    const login = (await (
      await fetch(`${base}/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistentId: carol }),
      })
    ).json()) as { publicId: string };
    for (let i = 0; i < 3; i++) {
      await ingest(
        record(
          `pLac${String(i).padStart(4, "0")}`,
          [
            { clientID: "c1000000", persistentID: alice },
            { clientID: "c3000000", persistentID: carol },
          ],
          "c3000000",
          1_800_000_000_000 + i * 600_000,
        ),
      );
    }
    const profile = (await (
      await fetch(`${base}/public/player/${login.publicId}`)
    ).json()) as {
      ratings: { ffa: { games: number; placement: unknown } | null };
    };
    expect(profile.ratings.ffa).toMatchObject({
      games: 3,
      placement: { played: 3, of: 10 },
    });
    const aliceProfile = (await (
      await fetch(`${base}/public/player/${alicePublic}`)
    ).json()) as { ratings: { ffa: { placement: unknown } | null } };
    expect(aliceProfile.ratings.ffa?.placement).toBeNull();
    const me = await fetch(`${base}/users/@me`, {
      headers: { Authorization: `Bearer ${carol}` },
    });
    const parsedMe = UserMeResponseSchema.parse(await me.json());
    expect(parsedMe.player.leaderboard?.oneVone?.placement).toEqual({
      played: 3,
      of: 10,
    });
    expect(parsedMe.player.leaderboard?.oneVone?.elo).toBeGreaterThan(1500);
    const ladder = RankedLeaderboardResponseSchema.parse(
      await (await fetch(`${base}/leaderboard/ranked?page=1`)).json(),
    );
    expect(ladder["1v1"].map((e) => e.public_id)).not.toContain(login.publicId);
    expect(ladder["1v1"]).toHaveLength(2);
  });

  it("serves the ranked leaderboard the client parses, ranked and paged", async () => {
    const res = await fetch(`${base}/leaderboard/ranked?page=1`);
    expect(res.status).toBe(200);
    const parsed = RankedLeaderboardResponseSchema.parse(await res.json());
    expect(parsed["1v1"]).toHaveLength(2);
    expect(parsed["1v1"][0].rank).toBe(1);
    expect(parsed["1v1"][0].elo).toBeGreaterThanOrEqual(parsed["1v1"][1].elo);
    expect(parsed["1v1"][0].total).toBe(22);
    expect(parsed["1v1"][0].wins + parsed["1v1"][0].losses).toBe(22);
    expect(parsed["2v2"]).toEqual([]);
    const page9 = RankedLeaderboardResponseSchema.parse(
      await (await fetch(`${base}/leaderboard/ranked?page=9`)).json(),
    );
    expect(page9["1v1"]).toEqual([]);
  });
});
