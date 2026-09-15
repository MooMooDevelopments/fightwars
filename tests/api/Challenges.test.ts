// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activeChallenges,
  CHALLENGES,
  periodKey,
  progressFrom,
} from "../../src/api/Challenges";
import { UserMeResponseSchema } from "../../src/core/ApiSchemas";
import { call, guest, ingest, makeRecord, startTestApi } from "./fixtures";

/**
 * Challenges (brief §6.7): read off the ingested records, summed per
 * period, served on /users/@me. Cosmetic only.
 */
describe("challenges", () => {
  it("keys the period in UTC, daily by date and weekly by ISO week", () => {
    const d = new Date(Date.UTC(2026, 8, 15, 23, 30));
    expect(periodKey("daily", d)).toBe("d:2026-09-15");
    expect(periodKey("daily", new Date(Date.UTC(2026, 8, 16, 0, 1)))).toBe(
      "d:2026-09-16",
    );
    expect(periodKey("weekly", d)).toBe("w:2026-W38");
    // Sunday and the Monday after are different weeks.
    expect(periodKey("weekly", new Date(Date.UTC(2026, 8, 20)))).toBe(
      "w:2026-W38",
    );
    expect(periodKey("weekly", new Date(Date.UTC(2026, 8, 21)))).toBe(
      "w:2026-W39",
    );
  });

  it("rotates a fixed set per period, the same for everyone", () => {
    const a = activeChallenges(new Date(Date.UTC(2026, 8, 15)));
    const again = activeChallenges(new Date(Date.UTC(2026, 8, 15, 18)));
    expect(a.map((c) => c.id)).toEqual(again.map((c) => c.id));
    expect(a.filter((c) => c.period === "daily")).toHaveLength(3);
    expect(a.filter((c) => c.period === "weekly")).toHaveLength(2);
    const ids = new Set<string>();
    for (let day = 1; day <= 28; day++) {
      for (const c of activeChallenges(new Date(Date.UTC(2026, 8, day)))) {
        ids.add(c.id);
      }
    }
    expect(ids.size).toBe(CHALLENGES.length);
  });

  it("reads one match's contribution from the record's own stats", () => {
    const at = new Date(Date.UTC(2026, 8, 15));
    const live = new Set(activeChallenges(at).map((c) => c.id));
    const facts = {
      won: true,
      stats: {
        attacks: ["600000", "0", "0"],
        units: { city: ["4", "0"], port: ["2", "0"] },
        gold: ["1", "0", "7000000"],
        bombs: { abomb: ["3", "2"] },
      },
    };
    const got = new Map(progressFrom(facts, at).map((p) => [p.id, p.amount]));
    for (const id of got.keys()) expect(live.has(id)).toBe(true);
    if (live.has("daily_win")) expect(got.get("daily_win")).toBe(1);
    if (live.has("daily_attack")) expect(got.get("daily_attack")).toBe(600000);
    if (live.has("daily_build")) expect(got.get("daily_build")).toBe(6);
    if (live.has("weekly_nukes")) expect(got.get("weekly_nukes")).toBe(2);
    // A loss with nothing done contributes nothing at all.
    expect(
      progressFrom({ won: false, stats: null }, at).map((p) => p.id),
    ).not.toContain("daily_win");
  });

  describe("through the API", () => {
    let api: Awaited<ReturnType<typeof startTestApi>>;
    beforeAll(async () => {
      api = await startTestApi();
    });
    afterAll(async () => {
      await api.close();
    });

    it("sums a player's games into the live challenges and marks them done", async () => {
      const pid = randomUUID();
      const session = await guest(api.base, pid);
      const before = UserMeResponseSchema.parse(
        (await call(api.base, session, "GET", "/users/@me")).json,
      );
      const live = before.player.challenges!;
      expect(live.length).toBe(5);
      expect(live.every((c) => c.progress === 0 && !c.completed)).toBe(true);

      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        await ingest(
          api.base,
          makeRecord({
            gameID: `chAl${String(i).padStart(4, "0")}`,
            // Ends a second ago: the same day and week as the read below,
            // whatever the UTC hour the suite runs at.
            start: now - 2_000,
            durationMs: 1_000,
            players: [
              {
                clientID: "c1000000",
                persistentID: pid,
                stats: { conquests: ["1"] },
              },
              { clientID: "c2000000", persistentID: randomUUID() },
            ],
            winner: "c1000000",
          }),
        );
      }
      const after = UserMeResponseSchema.parse(
        (await call(api.base, session, "GET", "/users/@me")).json,
      );
      const byId = new Map(after.player.challenges!.map((c) => [c.id, c]));
      const play = byId.get("daily_play");
      if (play !== undefined) {
        expect(play.progress).toBe(3);
        expect(play.completed).toBe(true);
      }
      const win = byId.get("daily_win");
      if (win !== undefined) {
        expect(win.progress).toBe(1);
        expect(win.completed).toBe(true);
      }
      // Progress never runs past its target in the payload.
      for (const c of after.player.challenges!) {
        expect(c.progress).toBeLessThanOrEqual(c.target);
      }
    });
  });
});
