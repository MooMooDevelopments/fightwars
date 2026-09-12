/**
 * How a stored match maps onto the buckets the client's history filters,
 * clan member stats and the profile stats tree use. One definition so the
 * API's SQL filters, the per-member W/L keys and the labels the client
 * derives from the same fields (GameTypeLabels.ts) never disagree.
 */
import type { ClanMemberStats } from "../core/ClanApiSchemas";
import { Duos, HumansVsNations, Quads, Trios } from "../core/game/Game";

export type GameFilter = "ffa" | "team" | "hvn" | "ranked";

export interface MatchShape {
  game_mode: string;
  player_teams: string | null;
  ranked_type: string | null;
}

export function isRanked(m: MatchShape): boolean {
  return m.ranked_type !== null && m.ranked_type !== "unranked";
}

export function isHvn(m: MatchShape): boolean {
  return m.player_teams === HumansVsNations;
}

export function matchesFilter(m: MatchShape, filter: GameFilter): boolean {
  switch (filter) {
    case "ranked":
      return isRanked(m);
    case "hvn":
      return !isRanked(m) && isHvn(m);
    case "ffa":
      return !isRanked(m) && m.game_mode === "Free For All";
    case "team":
      return !isRanked(m) && !isHvn(m) && m.game_mode === "Team";
  }
}

/** SQL predicate for `filter` over a `matches` row aliased `m`. */
export function filterSql(filter: string, alias = "m"): string | null {
  const unranked = `(${alias}.ranked_type IS NULL OR ${alias}.ranked_type = 'unranked')`;
  switch (filter) {
    case "ranked":
      return `(${alias}.ranked_type IS NOT NULL AND ${alias}.ranked_type <> 'unranked')`;
    case "hvn":
      return `(${unranked} AND ${alias}.player_teams = '${HumansVsNations}')`;
    case "ffa":
      return `(${unranked} AND ${alias}.game_mode = 'Free For All')`;
    case "team":
      return `(${unranked} AND ${alias}.game_mode = 'Team' AND (${alias}.player_teams IS NULL OR ${alias}.player_teams <> '${HumansVsNations}'))`;
    default:
      return null;
  }
}

/** The ClanMemberStats keys one match contributes to (always "total"). */
export function memberStatKeys(m: MatchShape): (keyof ClanMemberStats)[] {
  const keys: (keyof ClanMemberStats)[] = ["total"];
  if (isRanked(m)) {
    keys.push("ranked");
    if (m.ranked_type === "1v1") keys.push("1v1");
    return keys;
  }
  if (m.game_mode === "Free For All") {
    keys.push("ffa");
    return keys;
  }
  if (isHvn(m)) {
    keys.push("hvn");
    return keys;
  }
  keys.push("team");
  const pt = m.player_teams;
  if (pt === Duos) keys.push("duos");
  else if (pt === Trios) keys.push("trios");
  else if (pt === Quads) keys.push("quads");
  else if (pt !== null && /^[2-7]$/.test(pt)) {
    keys.push(pt as keyof ClanMemberStats);
  }
  return keys;
}

export const MEMBER_STAT_KEYS: (keyof ClanMemberStats)[] = [
  "total",
  "ffa",
  "team",
  "hvn",
  "duos",
  "trios",
  "quads",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "ranked",
  "1v1",
];

export function emptyMemberStats(): ClanMemberStats {
  const out = {} as ClanMemberStats;
  for (const k of MEMBER_STAT_KEYS) out[k] = { wins: 0, losses: 0 };
  return out;
}

/** Number of teams in a team game, from its team config and player count. */
export function numTeams(m: MatchShape, numPlayers: number): number {
  const pt = m.player_teams;
  if (pt === null) return m.game_mode === "Team" ? 2 : Math.max(2, numPlayers);
  if (pt === HumansVsNations) return 2;
  const per = pt === Duos ? 2 : pt === Trios ? 3 : pt === Quads ? 4 : null;
  if (per !== null) return Math.max(2, Math.ceil(numPlayers / per));
  const n = Number.parseInt(pt, 10);
  return Number.isFinite(n) && n >= 2 ? n : 2;
}
