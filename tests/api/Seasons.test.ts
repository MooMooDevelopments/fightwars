// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seasonFrom, seasonParam } from "../../src/api/Matches";
import { RankedLeaderboardResponseSchema } from "../../src/core/ApiSchemas";
import {
  call,
  ingest,
  makeRecord,
  startTestApi,
  type TestApi,
} from "./fixtures";

// Ratings accrue to LADDER_SEASON; earlier seasons stay readable by query.

let api: TestApi;
const alice = randomUUID();
const bob = randomUUID();

beforeAll(async () => {
  api = await startTestApi({ LADDER_SEASON: "s2" });
  await ingest(
    api.base,
    makeRecord({
      gameID: "seasnGm1",
      players: [
        { clientID: "cali0000", persistentID: alice },
        { clientID: "cbob0000", persistentID: bob },
      ],
      winner: "cali0000",
    }),
  );
});

afterAll(async () => {
  await api.close();
});

describe("ladder seasons", () => {
  it("reads the season from the environment, defaulting to 1", () => {
    expect(seasonFrom({})).toBe("1");
    expect(seasonFrom({ LADDER_SEASON: "  " })).toBe("1");
    expect(seasonFrom({ LADDER_SEASON: "2026-q4" })).toBe("2026-q4");
    expect(seasonParam("s2")).toBe("s2");
    expect(seasonParam("no spaces")).toBeUndefined();
    expect(seasonParam(undefined)).toBeUndefined();
  });

  it("files results under the current season and serves other seasons by query", async () => {
    expect(api.ctx.season).toBe("s2");
    const current = await call(
      api.base,
      null,
      "GET",
      "/public/leaderboard/ffa",
    );
    expect(current.status).toBe(200);
    const body = current.json as { season: string; entries: unknown[] };
    expect(body.season).toBe("s2");
    expect(body.entries).toHaveLength(2);

    const old = (
      await call(api.base, null, "GET", "/public/leaderboard/ffa?season=1")
    ).json as { season: string; entries: unknown[] };
    expect(old.season).toBe("1");
    expect(old.entries).toEqual([]);

    // One game each: both are in placement, so the ranked ladder is empty
    // while the raw public ladder above lists them. Seasons are filed the
    // same either way.
    const ranked = RankedLeaderboardResponseSchema.parse(
      (await call(api.base, null, "GET", "/leaderboard/ranked")).json,
    );
    expect(ranked["1v1"]).toEqual([]);
    const rankedOld = RankedLeaderboardResponseSchema.parse(
      (await call(api.base, null, "GET", "/leaderboard/ranked?season=1")).json,
    );
    expect(rankedOld["1v1"]).toEqual([]);

    // The profile's extension field says which season its ratings are from.
    const login = (
      await call(api.base, null, "POST", "/auth/guest", {
        persistentId: alice,
      })
    ).json as { publicId: string };
    const profile = (
      await call(api.base, null, "GET", `/public/player/${login.publicId}`)
    ).json as { season: string; ratings: { ffa: { games: number } | null } };
    expect(profile.season).toBe("s2");
    expect(profile.ratings.ffa?.games).toBe(1);
  });
});
