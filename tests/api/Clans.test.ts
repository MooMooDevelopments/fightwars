// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  computeClanLeaderboard,
  normaliseDiscordUrl,
  sessionScore,
} from "../../src/api/ClanRoutes";
import {
  PlayerProfileSchema,
  PublicPlayerGamesResponseSchema,
  UserMeResponseSchema,
} from "../../src/core/ApiSchemas";
import {
  ClanBansResponseSchema,
  ClanBrowseResponseSchema,
  ClanGamesResponseSchema,
  ClanInfoSchema,
  ClanLeaderboardResponseSchema,
  ClanMembersResponseSchema,
  ClanRequestsResponseSchema,
  ReservedClanTagsResponseSchema,
} from "../../src/core/ClanApiSchemas";
import {
  call,
  guest,
  ingest,
  makeRecord,
  startTestApi,
  type Session,
  type TestApi,
} from "./fixtures";

// Every response is parsed with the client's own schema (ClanApi.ts).

let api: TestApi;
let alice: Session;
let bob: Session;
let carol: Session;
let dave: Session;

beforeAll(async () => {
  api = await startTestApi();
  [alice, bob, carol, dave] = await Promise.all(
    [1, 2, 3, 4].map(() => guest(api.base, randomUUID())),
  );
});

afterAll(async () => {
  await api.close();
});

const me = async (s: Session) => {
  const r = await call(api.base, s, "GET", "/users/@me");
  expect(r.status).toBe(200);
  return UserMeResponseSchema.parse(r.json).player;
};

describe("clan lifecycle", () => {
  it("creates a clan, rejects duplicates and second clans, lists it publicly", async () => {
    expect(
      (
        await call(api.base, null, "POST", "/clans", {
          tag: "alp",
          name: "Alpha",
        })
      ).status,
    ).toBe(401);
    const created = await call(api.base, alice, "POST", "/clans", {
      tag: "alp",
      name: "Alpha",
      description: "First clan",
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const info = ClanInfoSchema.parse(created.json);
    expect(info.tag).toBe("ALP");
    expect(info.memberCount).toBe(1);
    expect(info.isOpen).toBe(true);

    expect(
      (
        await call(api.base, bob, "POST", "/clans", {
          tag: "ALP",
          name: "Copy",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(api.base, alice, "POST", "/clans", {
          tag: "BET",
          name: "Beta",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(api.base, bob, "POST", "/clans", {
          tag: "toolong",
          name: "x",
        })
      ).status,
    ).toBe(400);

    const browse = await call(
      api.base,
      null,
      "GET",
      "/clans?search=alp&page=1&limit=20",
    );
    expect(browse.status).toBe(200);
    const list = ClanBrowseResponseSchema.parse(browse.json);
    expect(list.total).toBe(1);
    expect(list.results[0].tag).toBe("ALP");

    expect(
      (await call(api.base, null, "GET", "/public/clan/alp/exists")).status,
    ).toBe(200);
    expect(
      (await call(api.base, null, "GET", "/public/clan/zzz/exists")).status,
    ).toBe(404);
    const reserved = await call(api.base, null, "GET", "/reserved_clan_tags");
    expect(ReservedClanTagsResponseSchema.parse(reserved.json)).toEqual([
      "ALP",
    ]);

    const mine = await me(alice);
    expect(mine.clans?.[0]).toMatchObject({
      tag: "ALP",
      role: "leader",
      memberCount: 1,
    });
  });

  it("joins an open clan directly and shows it on /users/@me", async () => {
    expect((await call(api.base, null, "POST", "/clans/ALP/join")).status).toBe(
      401,
    );
    const join = await call(api.base, bob, "POST", "/clans/ALP/join");
    expect(join.status).toBe(200);
    expect(join.json).toEqual({ status: "joined" });
    expect((await call(api.base, bob, "POST", "/clans/ALP/join")).status).toBe(
      409,
    );
    expect((await me(bob)).clans?.[0]).toMatchObject({
      tag: "ALP",
      role: "member",
      memberCount: 2,
    });
  });

  it("edits the clan (officer+), validates the Discord invite, closes it", async () => {
    expect(
      (await call(api.base, bob, "PATCH", "/clans/ALP", { name: "Nope" }))
        .status,
    ).toBe(403);
    const bad = await call(api.base, alice, "PATCH", "/clans/ALP", {
      discordUrl: "https://example.com/x",
    });
    expect(bad.status).toBe(400);
    expect((bad.json as { code: string }).code).toBe("DISCORD_INVALID");
    const ok = await call(api.base, alice, "PATCH", "/clans/ALP", {
      isOpen: false,
      discordUrl: "discord.gg/abc123",
      description: "Invite only",
    });
    expect(ok.status).toBe(200);
    const info = ClanInfoSchema.parse(ok.json);
    expect(info.isOpen).toBe(false);
    expect(info.discordUrl).toBe("https://discord.gg/abc123");
    expect(info.description).toBe("Invite only");
  });

  it("queues join requests on a closed clan; officers approve, deny or the player withdraws", async () => {
    const req = await call(api.base, carol, "POST", "/clans/ALP/join");
    expect(req.json).toEqual({ status: "requested" });
    expect(
      (await call(api.base, carol, "POST", "/clans/ALP/join")).status,
    ).toBe(409);
    expect((await me(carol)).clanRequests?.[0]).toMatchObject({
      tag: "ALP",
      name: "Alpha",
    });

    expect(
      (await call(api.base, bob, "GET", "/clans/ALP/requests")).status,
    ).toBe(403);
    const pending = await call(api.base, alice, "GET", "/clans/ALP/requests");
    expect(
      ClanRequestsResponseSchema.parse(pending.json).results[0].publicId,
    ).toBe(carol.publicId);

    const members = ClanMembersResponseSchema.parse(
      (await call(api.base, alice, "GET", "/clans/ALP/members")).json,
    );
    expect(members.pendingRequests).toBe(1);

    expect(
      (
        await call(api.base, alice, "POST", "/clans/ALP/requests/approve", {
          targetPublicId: carol.publicId,
        })
      ).status,
    ).toBe(204);
    expect((await me(carol)).clans?.[0].tag).toBe("ALP");
    expect((await me(carol)).clanRequests).toEqual([]);

    // Dave asks, then changes his mind.
    expect(
      (await call(api.base, dave, "POST", "/clans/ALP/join")).json,
    ).toEqual({ status: "requested" });
    expect(
      (await call(api.base, dave, "POST", "/clans/ALP/requests/withdraw"))
        .status,
    ).toBe(204);
    expect(
      (await call(api.base, dave, "POST", "/clans/ALP/requests/withdraw"))
        .status,
    ).toBe(404);
    // And asks again, to be denied.
    await call(api.base, dave, "POST", "/clans/ALP/join");
    expect(
      (
        await call(api.base, alice, "POST", "/clans/ALP/requests/deny", {
          targetPublicId: dave.publicId,
        })
      ).status,
    ).toBe(204);
    expect((await me(dave)).clanRequests).toEqual([]);
  });

  it("promotes, lets officers kick members but not each other, bans and unbans", async () => {
    expect(
      (
        await call(api.base, bob, "POST", "/clans/ALP/promote", {
          targetPublicId: carol.publicId,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(api.base, alice, "POST", "/clans/ALP/promote", {
          targetPublicId: bob.publicId,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call(api.base, alice, "POST", "/clans/ALP/promote", {
          targetPublicId: bob.publicId,
        })
      ).status,
    ).toBe(409);
    // An officer cannot kick the leader or another officer.
    expect(
      (
        await call(api.base, bob, "POST", "/clans/ALP/kick", {
          targetPublicId: alice.publicId,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(api.base, bob, "POST", "/clans/ALP/kick", {
          targetPublicId: carol.publicId,
        })
      ).status,
    ).toBe(204);
    expect((await me(carol)).clans).toEqual([]);

    expect(
      (
        await call(api.base, bob, "POST", "/clans/ALP/ban", {
          targetPublicId: carol.publicId,
          reason: "spam",
        })
      ).status,
    ).toBe(204);
    const banned = await call(api.base, carol, "POST", "/clans/ALP/join");
    expect(banned.status).toBe(403);
    expect(banned.json).toMatchObject({ code: "BANNED", reason: "spam" });
    const bans = ClanBansResponseSchema.parse(
      (await call(api.base, alice, "GET", "/clans/ALP/bans")).json,
    );
    expect(bans.results[0]).toMatchObject({
      publicId: carol.publicId,
      bannedBy: bob.publicId,
      reason: "spam",
    });
    expect(
      (
        await call(api.base, bob, "POST", "/clans/ALP/unban", {
          targetPublicId: carol.publicId,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call(api.base, bob, "POST", "/clans/ALP/unban", {
          targetPublicId: carol.publicId,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(api.base, carol, "POST", "/clans/ALP/join")).json,
    ).toEqual({ status: "requested" });
    await call(api.base, alice, "POST", "/clans/ALP/requests/deny", {
      targetPublicId: carol.publicId,
    });
  });

  it("counts member stats, clan history and the leaderboard from games played under the tag", async () => {
    // Bob (ALP) and Dave win a public Duos game against two strangers.
    await ingest(
      api.base,
      makeRecord({
        gameID: "clanGm01",
        gameType: "Public",
        gameMode: "Team",
        playerTeams: "Duos",
        start: Date.now() - 3_600_000,
        players: [
          {
            clientID: "cbob0000",
            persistentID: bob.persistentId,
            clanTag: "alp",
            username: "Bob",
          },
          { clientID: "cdave000", persistentID: dave.persistentId },
          { clientID: "cx100000", persistentID: randomUUID() },
          { clientID: "cx200000", persistentID: randomUUID() },
        ],
        winner: ["cbob0000", "cdave000"],
      }),
    );
    // Bob loses an FFA under the tag; Alice plays an FFA without the tag.
    await ingest(
      api.base,
      makeRecord({
        gameID: "clanGm02",
        start: Date.now() - 1_800_000,
        players: [
          {
            clientID: "cbob0000",
            persistentID: bob.persistentId,
            clanTag: "ALP",
          },
          { clientID: "cali0000", persistentID: alice.persistentId },
        ],
        winner: "cali0000",
      }),
    );

    const members = ClanMembersResponseSchema.parse(
      (
        await call(
          api.base,
          null,
          "GET",
          "/clans/ALP/members?sort=winsTotal&order=desc",
        )
      ).json,
    );
    expect(members.total).toBe(2);
    expect(members.results[0].publicId).toBe(bob.publicId);
    expect(members.results[0].stats).toMatchObject({
      total: { wins: 1, losses: 1 },
      team: { wins: 1, losses: 0 },
      duos: { wins: 1, losses: 0 },
      ffa: { wins: 0, losses: 1 },
    });
    // Alice played without the tag: nothing counts for the clan.
    expect(members.results[1].stats?.total).toEqual({ wins: 0, losses: 0 });

    const games = ClanGamesResponseSchema.parse(
      (await call(api.base, null, "GET", "/clans/ALP/games")).json,
    );
    expect(games.results.map((g) => g.gameId)).toEqual([
      "clanGm02",
      "clanGm01",
    ]);
    expect(games.results[1]).toMatchObject({
      result: "victory",
      playerTeams: "Duos",
      totalPlayers: 4,
    });
    expect(games.results[1].clanPlayers).toEqual([
      { publicId: bob.publicId, username: "Bob", verified: false, won: true },
    ]);
    expect(games.results[0].result).toBe("defeat");
    const teamOnly = ClanGamesResponseSchema.parse(
      (await call(api.base, null, "GET", "/clans/ALP/games?filter=team")).json,
    );
    expect(teamOnly.results.map((g) => g.gameId)).toEqual(["clanGm01"]);

    const board = ClanLeaderboardResponseSchema.parse(
      (await call(api.base, null, "GET", "/public/clans/leaderboard")).json,
    );
    expect(board.clans).toHaveLength(1);
    expect(board.clans[0]).toMatchObject({
      clanTag: "ALP",
      games: 1,
      wins: 1,
      losses: 0,
      playerSessions: 1,
    });
    expect(board.clans[0].weightedWins).toBeGreaterThan(0);

    // The profile carries the clan, the stats tree and the tag in history.
    const profile = PlayerProfileSchema.parse(
      (await call(api.base, null, "GET", `/public/player/${bob.publicId}`))
        .json,
    );
    expect(profile.clans?.[0]).toMatchObject({ tag: "ALP", role: "officer" });
    expect(profile.stats.Public?.Team?.Medium?.wins).toBe(1n);
    expect(profile.stats.Public?.["Free For All"]?.Medium?.losses).toBe(1n);
    const history = PublicPlayerGamesResponseSchema.parse(
      (
        await call(
          api.base,
          null,
          "GET",
          `/public/player/${bob.publicId}/games?filter=team`,
        )
      ).json,
    );
    expect(history.results[0]).toMatchObject({
      gameId: "clanGm01",
      clanTag: "ALP",
      playerTeams: "Duos",
    });
  });

  it("has no currency: the ledger is empty and donating fails", async () => {
    const ledger = await call(
      api.base,
      bob,
      "GET",
      "/clans/ALP/donations?page=1&limit=10",
    );
    expect(ledger.json).toEqual({ results: [], total: 0, page: 1, limit: 10 });
    expect(
      (
        await call(api.base, bob, "POST", "/clans/ALP/donate", {
          currencyType: "soft",
          amount: "1",
          idempotencyKey: "k",
        })
      ).status,
    ).toBe(400);
  });

  it("transfers leadership, lets the old leader leave, and the last member disbands", async () => {
    expect(
      (await call(api.base, alice, "POST", "/clans/ALP/leave")).status,
    ).toBe(409);
    expect(
      (
        await call(api.base, alice, "POST", "/clans/ALP/transfer", {
          targetPublicId: bob.publicId,
        })
      ).status,
    ).toBe(204);
    expect((await me(alice)).clans?.[0].role).toBe("officer");
    expect((await me(bob)).clans?.[0].role).toBe("leader");
    expect((await call(api.base, alice, "DELETE", "/clans/ALP")).status).toBe(
      403,
    );
    expect(
      (await call(api.base, alice, "POST", "/clans/ALP/leave")).status,
    ).toBe(204);
    expect((await me(alice)).clans).toEqual([]);
    expect((await call(api.base, bob, "POST", "/clans/ALP/leave")).status).toBe(
      204,
    );
    expect((await call(api.base, null, "GET", "/clans/ALP")).status).toBe(404);
    expect(
      (await call(api.base, null, "GET", "/reserved_clan_tags")).json,
    ).toEqual([]);
  });
});

describe("clan helpers", () => {
  it("normalises Discord invites", () => {
    expect(normaliseDiscordUrl("")).toBeNull();
    expect(normaliseDiscordUrl("https://discord.gg/abc")).toBe(
      "https://discord.gg/abc",
    );
    expect(normaliseDiscordUrl("discord.com/invite/xYz-1")).toBe(
      "https://discord.gg/xYz-1",
    );
    expect(normaliseDiscordUrl("https://example.com/abc")).toBeUndefined();
    expect(normaliseDiscordUrl("https://discord.com/abc")).toBeUndefined();
  });

  it("scores sessions per the documented formula", () => {
    // Full team of clan players in a 2-team game: ratio 1, difficulty 1.
    expect(
      sessionScore(
        { numTeams: 2, totalPlayers: 4, clanPlayers: 2, won: true },
        1,
      ),
    ).toBeCloseTo(1);
    // Half a team in a 5-team game, won: 0.5 × √4 = 1; lost: 0.5 / 2 = 0.25.
    expect(
      sessionScore(
        { numTeams: 5, totalPlayers: 10, clanPlayers: 1, won: true },
        1,
      ),
    ).toBeCloseTo(1);
    expect(
      sessionScore(
        { numTeams: 5, totalPlayers: 10, clanPlayers: 1, won: false },
        1,
      ),
    ).toBeCloseTo(0.25);
    expect(
      sessionScore(
        { numTeams: 2, totalPlayers: 4, clanPlayers: 2, won: true },
        0.5,
      ),
    ).toBeCloseTo(0.5);
  });

  it("returns an empty board when no clan has played", async () => {
    const board = await computeClanLeaderboard(api.ctx.db);
    expect(ClanLeaderboardResponseSchema.parse({ ...board }).clans).toEqual([]);
  });
});
