// @vitest-environment node
import { importJWK, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApp, type ApiContext } from "../../src/api/App";
import {
  TokenPayloadSchema,
  UserMeResponseSchema,
} from "../../src/core/ApiSchemas";
import { ReservedClanTagsResponseSchema } from "../../src/core/ClanApiSchemas";
import { JwksSchema } from "../../src/core/configuration/Config";
import { CosmeticsSchema } from "../../src/core/CosmeticSchemas";
import { GameRecordSchema } from "../../src/core/Schemas";
import { apiTestEnv } from "./fixtures";

// The API is exercised over real HTTP, and every response the game server
// consumes is parsed with the game server's own schema.

const API_KEY = "test-api-key";
let ctx: ApiContext;
let base: string;
let server: ReturnType<ApiContext["app"]["listen"]>;

beforeAll(async () => {
  ctx = await createApiApp(
    await apiTestEnv({ API_CORS_ORIGINS: "http://localhost:9000" }),
  );
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
  players: { clientID: string; persistentID: string | null }[],
  winner: string,
) {
  return GameRecordSchema.parse({
    version: "v0.0.2",
    gitCommit: "0123456789abcdef0123456789abcdef01234567",
    subdomain: "dev",
    domain: "localhost",
    info: {
      gameID,
      lobbyCreatedAt: 1700000000000,
      start: 1700000001000,
      end: 1700000062000,
      duration: 61000,
      num_turns: 600,
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

describe("FightWars API", () => {
  const alice = randomUUID();
  const bob = randomUUID();
  const carol = randomUUID();

  it("serves a JWKS the game server can parse", async () => {
    const res = await fetch(`${base}/.well-known/jwks.json`);
    expect(res.status).toBe(200);
    const parsed = JwksSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
  });

  it("guest login mints a JWT that verifies against the JWKS with the expected claims", async () => {
    const res = await fetch(`${base}/auth/guest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:9000",
      },
      body: JSON.stringify({ persistentId: alice }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:9000",
    );
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^fw_refresh=.+HttpOnly/);
    const body = (await res.json()) as {
      jwt: string;
      expiresIn: number;
      publicId: string;
    };
    expect(body.expiresIn).toBe(900);
    expect(body.publicId).toHaveLength(10);

    const jwks = JwksSchema.parse(
      await (await fetch(`${base}/.well-known/jwks.json`)).json(),
    );
    const key = await importJWK(jwks.keys[0], "EdDSA");
    const { payload } = await jwtVerify(body.jwt, key, {
      algorithms: ["EdDSA"],
      issuer: "http://localhost:8787",
      audience: "localhost",
    });
    const claims = TokenPayloadSchema.parse(payload);
    expect(claims.sub).toBe(alice); // base64url sub decodes to the uuid
    expect(claims.iss).toBe("http://localhost:8787");

    // The cookie refreshes and rotates.
    const refresh = await fetch(`${base}/auth/refresh`, {
      method: "POST",
      headers: { Cookie: cookie.split(";")[0] },
    });
    expect(refresh.status).toBe(200);
    const rotated = refresh.headers.get("set-cookie") ?? "";
    expect(rotated).not.toBe(cookie);
    // The consumed token no longer works.
    const replay = await fetch(`${base}/auth/refresh`, {
      method: "POST",
      headers: { Cookie: cookie.split(";")[0] },
    });
    expect(replay.status).toBe(401);
  });

  it("rejects a guest login without a uuid", async () => {
    const res = await fetch(`${base}/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persistentId: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("/users/@me parses with the game server's schema, for a JWT and (dev) a raw id", async () => {
    const login = (await (
      await fetch(`${base}/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistentId: bob }),
      })
    ).json()) as { jwt: string; publicId: string };
    for (const token of [login.jwt, bob]) {
      const res = await fetch(`${base}/users/@me`, {
        headers: { Authorization: `Bearer ${token}`, "x-api-key": API_KEY },
      });
      expect(res.status).toBe(200);
      const parsed = UserMeResponseSchema.safeParse(await res.json());
      expect(parsed.success, JSON.stringify(parsed)).toBe(true);
      if (parsed.success)
        expect(parsed.data.player.publicId).toBe(login.publicId);
    }
    const anon = await fetch(`${base}/users/@me`);
    expect(anon.status).toBe(401);
  });

  it("join_verify approves and censors, and needs the api key", async () => {
    const unauth = await fetch(`${base}/join_verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Alice", clanTag: "abc", token: null }),
    });
    expect(unauth.status).toBe(401);
    const res = await fetch(`${base}/join_verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ username: "Alice", clanTag: "abc", token: null }),
    });
    expect(await res.json()).toEqual({
      status: "approved",
      username: "Alice",
      clanTag: "ABC",
    });
  });

  it("catalogue stubs parse with the game server's schemas", async () => {
    expect(
      CosmeticsSchema.safeParse(
        await (await fetch(`${base}/cosmetics.json`)).json(),
      ).success,
    ).toBe(true);
    expect(
      ReservedClanTagsResponseSchema.safeParse(
        await (await fetch(`${base}/reserved_clan_tags`)).json(),
      ).success,
    ).toBe(true);
    const tribes = await fetch(`${base}/custom_tribes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: "{}",
    });
    expect(await tribes.json()).toEqual({ tribes: [] });
    const mm = await fetch(`${base}/matchmaking/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ id: 0, gameId: "abcdefgh", ccu: 0, mode: "1v1" }),
    });
    expect(mm.status).toBe(200);
    expect(await mm.json()).toEqual({});
  });

  it("ingests a match once, rates the humans, serves the record and the ladder", async () => {
    const rec = record(
      "gAmE0001",
      [
        { clientID: "c1000000", persistentID: alice },
        { clientID: "c2000000", persistentID: bob },
        { clientID: "c3000000", persistentID: carol },
        { clientID: "c4000000", persistentID: null }, // a guest without an account
      ],
      "c1000000",
    );
    const body = JSON.stringify(rec, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    const post = async () =>
      fetch(`${base}/game/gAmE0001`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body,
      });
    const first = (await (await post()).json()) as {
      ok: boolean;
      stored: boolean;
      ladder: string;
      rated: number;
    };
    expect(first).toMatchObject({
      ok: true,
      stored: true,
      ladder: "ffa",
      rated: 3,
    });
    const again = (await (await post()).json()) as { stored: boolean };
    expect(again.stored).toBe(false); // idempotent

    const got = await fetch(`${base}/game/gAmE0001`);
    expect(got.status).toBe(200);
    const back = GameRecordSchema.safeParse(await got.json());
    expect(back.success).toBe(true);
    expect((await fetch(`${base}/game/zzzzzzzz`)).status).toBe(404);

    const lb = (await (
      await fetch(`${base}/public/leaderboard/ffa`)
    ).json()) as {
      entries: {
        publicId: string;
        rating: number;
        games: number;
        wins: number;
      }[];
    };
    expect(lb.entries).toHaveLength(3);
    expect(lb.entries[0].wins).toBe(1);
    expect(lb.entries[0].rating).toBeGreaterThan(1500);
    expect(lb.entries[1].rating).toBeLessThan(1500);
    expect(lb.entries[0].rating).toBeGreaterThan(lb.entries[2].rating);

    const player = (await (
      await fetch(`${base}/public/player/${lb.entries[0].publicId}`)
    ).json()) as {
      ratings: { ffa: { games: number; wins: number } | null; team: unknown };
    };
    expect(player.ratings.ffa).toMatchObject({ games: 1, wins: 1 });
    expect(player.ratings.team).toBeNull();

    // /users/@me now reflects the rating.
    const me = await fetch(`${base}/users/@me`, {
      headers: { Authorization: `Bearer ${alice}` },
    });
    const parsed = UserMeResponseSchema.parse(await me.json());
    expect(parsed.player.leaderboard?.oneVone?.elo).toBeGreaterThan(1500);
  });

  it("refuses a record whose id disagrees with the path, and a bad key", async () => {
    const rec = record(
      "gAmE0002",
      [{ clientID: "c1000000", persistentID: alice }],
      "c1000000",
    );
    const body = JSON.stringify(rec, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    const mismatch = await fetch(`${base}/game/gAmE0003`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body,
    });
    expect(mismatch.status).toBe(400);
    const badKey = await fetch(`${base}/game/gAmE0002`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "wrong" },
      body,
    });
    expect(badKey.status).toBe(401);
  });

  // The singleplayer archive upload (LocalServer.archiveGame) gzips its body
  // and sends Content-Encoding: gzip. That is not a CORS-safelisted request
  // header, so the browser preflights it and drops the upload entirely unless
  // the header is advertised here.
  it("allows Content-Encoding on preflight so the gzipped archive upload passes", async () => {
    const res = await fetch(`${base}/archive_singleplayer_game`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:9000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,content-encoding",
      },
    });
    expect(res.status).toBe(204);
    const allowed = (res.headers.get("access-control-allow-headers") ?? "")
      .toLowerCase()
      .split(",")
      .map((h) => h.trim());
    expect(allowed).toContain("content-encoding");
    expect(allowed).toContain("content-type");
    expect(allowed).toContain("authorization");
  });
});
