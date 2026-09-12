// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  filterSql,
  matchesFilter,
  memberStatKeys,
  numTeams,
} from "../../src/api/GameBuckets";
import { buildStatsTree, type StatRow } from "../../src/api/StatsTree";
import { PlayerStatsTreeSchema } from "../../src/core/ApiSchemas";

const row = (
  over: Partial<StatRow> & { won: boolean; stats?: unknown },
): StatRow => ({
  game_type: "Public",
  game_mode: "Free For All",
  difficulty: "Medium",
  player_teams: null,
  ranked_type: null,
  winner_known: true,
  stats: null,
  ...over,
});

describe("buildStatsTree", () => {
  it("files games by type / mode / difficulty, ranked apart, and sums bigint stats", () => {
    const tree = buildStatsTree([
      row({
        won: true,
        stats: { gold: ["10", "5"], units: { city: ["2"] }, betrayals: "1" },
      }),
      row({
        won: false,
        stats: { gold: ["1"], units: { city: ["1", "3"], port: ["4"] } },
      }),
      row({ won: false, winner_known: false }),
      row({ won: true, game_mode: "Team", player_teams: "Humans Vs Nations" }),
      row({ won: true, ranked_type: "1v1", stats: { attacks: ["9"] } }),
      row({ won: false, game_type: "Singleplayer", difficulty: "Impossible" }),
    ]);
    const parsed = PlayerStatsTreeSchema.parse(tree);
    const ffa = parsed.Public?.["Free For All"]?.Medium;
    expect(ffa?.wins).toBe(1n);
    // An incomplete game counts in total but is neither a win nor a loss.
    expect(ffa?.losses).toBe(1n);
    expect(ffa?.total).toBe(3n);
    expect(ffa?.stats?.gold).toEqual([11n, 5n]);
    expect(ffa?.stats?.units).toEqual({ city: [3n, 3n], port: [4n] });
    expect(ffa?.stats?.betrayals).toBe(1n);
    expect(ffa?.recent).toEqual({ games: 3, wins: 1 });
    expect(parsed.Public?.["Humans Vs Nations"]?.Medium?.wins).toBe(1n);
    expect(parsed.Ranked?.["1v1"]?.stats?.attacks).toEqual([9n]);
    expect(parsed.Singleplayer?.["Free For All"]?.Impossible?.losses).toBe(1n);
    expect(buildStatsTree([])).toEqual({});
  });
});

describe("GameBuckets", () => {
  const ffa = {
    game_mode: "Free For All",
    player_teams: null,
    ranked_type: null,
  };
  const duos = { game_mode: "Team", player_teams: "Duos", ranked_type: null };
  const five = { game_mode: "Team", player_teams: "5", ranked_type: null };
  const hvn = {
    game_mode: "Team",
    player_teams: "Humans Vs Nations",
    ranked_type: null,
  };
  const ranked = {
    game_mode: "Free For All",
    player_teams: null,
    ranked_type: "1v1",
  };

  it("maps a match onto the member-stat keys and the history filters", () => {
    expect(memberStatKeys(ffa)).toEqual(["total", "ffa"]);
    expect(memberStatKeys(duos)).toEqual(["total", "team", "duos"]);
    expect(memberStatKeys(five)).toEqual(["total", "team", "5"]);
    expect(memberStatKeys(hvn)).toEqual(["total", "hvn"]);
    expect(memberStatKeys(ranked)).toEqual(["total", "ranked", "1v1"]);
    expect(matchesFilter(ranked, "ffa")).toBe(false);
    expect(matchesFilter(hvn, "team")).toBe(false);
    expect(matchesFilter(hvn, "hvn")).toBe(true);
    expect(matchesFilter(duos, "team")).toBe(true);
    expect(filterSql("bogus")).toBeNull();
    expect(filterSql("ffa", "x")).toContain("x.game_mode = 'Free For All'");
  });

  it("derives the team count for the leaderboard formula", () => {
    expect(numTeams(duos, 8)).toBe(4);
    expect(numTeams({ ...duos, player_teams: "Quads" }, 10)).toBe(3);
    expect(numTeams(five, 20)).toBe(5);
    expect(numTeams(hvn, 9)).toBe(2);
    expect(numTeams({ ...duos, player_teams: null }, 6)).toBe(2);
  });
});
