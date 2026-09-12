/**
 * The per-mode stats tree on a player profile (PlayerStatsTreeSchema):
 *
 *   { Public: { "Free For All": { Medium: leaf } }, Ranked: { "1v1": leaf } }
 *
 * built from the player's stored match rows. A leaf carries wins / losses /
 * total, the summed in-game stats (attacks, gold, units…) and the recent
 * form over the last 100 games. Bigints ride JSON as decimal strings, the
 * same convention the client's BigIntStringSchema parses.
 */
import { HumansVsNations } from "../core/game/Game";
import { isHvn, isRanked, type MatchShape } from "./GameBuckets";

const RECENT_WINDOW = 100;

export interface StatRow extends MatchShape {
  game_type: string;
  difficulty: string | null;
  won: boolean;
  winner_known: boolean;
  stats: unknown;
}

type StatArray = string[];
type StatRecord = Record<string, StatArray>;

export interface StatsLeafJson {
  wins: string;
  losses: string;
  total: string;
  stats: {
    attacks?: StatArray;
    betrayals?: string;
    killedAt?: string;
    conquests?: StatArray;
    boats?: StatRecord;
    bombs?: StatRecord;
    gold?: StatArray;
    units?: StatRecord;
  };
  recent: { games: number; wins: number };
}

interface Acc {
  wins: bigint;
  losses: bigint;
  total: bigint;
  recentGames: number;
  recentWins: number;
  attacks?: bigint[];
  betrayals?: bigint;
  killedAt?: bigint;
  conquests?: bigint[];
  boats?: Record<string, bigint[]>;
  bombs?: Record<string, bigint[]>;
  gold?: bigint[];
  units?: Record<string, bigint[]>;
}

function toBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return 0n;
}

function addArray(base: bigint[] | undefined, next: unknown): bigint[] {
  const arr = Array.isArray(next) ? next : [];
  const out = base ? [...base] : [];
  for (let i = 0; i < arr.length; i++) {
    out[i] = (out[i] ?? 0n) + toBig(arr[i]);
  }
  return out;
}

function addRecord(
  base: Record<string, bigint[]> | undefined,
  next: unknown,
): Record<string, bigint[]> {
  const out: Record<string, bigint[]> = base ? { ...base } : {};
  if (next && typeof next === "object") {
    for (const [k, v] of Object.entries(next as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = addArray(out[k], v);
    }
  }
  return out;
}

function accumulate(acc: Acc, row: StatRow): void {
  acc.total += 1n;
  if (row.won) acc.wins += 1n;
  else if (row.winner_known) acc.losses += 1n;
  if (acc.recentGames < RECENT_WINDOW) {
    acc.recentGames++;
    if (row.won) acc.recentWins++;
  }
  const s = row.stats;
  if (!s || typeof s !== "object") return;
  const st = s as Record<string, unknown>;
  if (st.attacks !== undefined) acc.attacks = addArray(acc.attacks, st.attacks);
  if (st.betrayals !== undefined)
    acc.betrayals = (acc.betrayals ?? 0n) + toBig(st.betrayals);
  if (st.killedAt !== undefined)
    acc.killedAt = (acc.killedAt ?? 0n) + toBig(st.killedAt);
  if (st.conquests !== undefined)
    acc.conquests = addArray(acc.conquests, st.conquests);
  if (st.boats !== undefined) acc.boats = addRecord(acc.boats, st.boats);
  if (st.bombs !== undefined) acc.bombs = addRecord(acc.bombs, st.bombs);
  if (st.gold !== undefined) acc.gold = addArray(acc.gold, st.gold);
  if (st.units !== undefined) acc.units = addRecord(acc.units, st.units);
}

function strs(a: bigint[]): string[] {
  return a.map((v) => v.toString());
}

function strRecord(r: Record<string, bigint[]>): StatRecord {
  const out: StatRecord = {};
  for (const [k, v] of Object.entries(r)) out[k] = strs(v);
  return out;
}

function leafJson(acc: Acc): StatsLeafJson {
  const stats: StatsLeafJson["stats"] = {};
  if (acc.attacks) stats.attacks = strs(acc.attacks);
  if (acc.betrayals !== undefined) stats.betrayals = acc.betrayals.toString();
  if (acc.killedAt !== undefined) stats.killedAt = acc.killedAt.toString();
  if (acc.conquests) stats.conquests = strs(acc.conquests);
  if (acc.boats) stats.boats = strRecord(acc.boats);
  if (acc.bombs) stats.bombs = strRecord(acc.bombs);
  if (acc.gold) stats.gold = strs(acc.gold);
  if (acc.units) stats.units = strRecord(acc.units);
  return {
    wins: acc.wins.toString(),
    losses: acc.losses.toString(),
    total: acc.total.toString(),
    stats,
    recent: { games: acc.recentGames, wins: acc.recentWins },
  };
}

function newAcc(): Acc {
  return { wins: 0n, losses: 0n, total: 0n, recentGames: 0, recentWins: 0 };
}

export type StatsTreeJson = Record<
  string,
  Record<string, Record<string, StatsLeafJson> | StatsLeafJson>
>;

/**
 * Rows must be ordered newest first (the recent window is the head).
 * Ranked games file under Ranked[rankedType]; everything else under
 * [gameType][mode][difficulty], where a Humans-vs-Nations team game is its
 * own mode (the client lists it beside FFA and Team).
 */
export function buildStatsTree(rows: StatRow[]): StatsTreeJson {
  const ranked = new Map<string, Acc>();
  const byType = new Map<string, Map<string, Map<string, Acc>>>();
  for (const row of rows) {
    if (isRanked(row)) {
      const key = row.ranked_type!;
      let acc = ranked.get(key);
      if (acc === undefined) ranked.set(key, (acc = newAcc()));
      accumulate(acc, row);
      continue;
    }
    if (
      row.game_type !== "Public" &&
      row.game_type !== "Private" &&
      row.game_type !== "Singleplayer"
    ) {
      continue;
    }
    const mode = isHvn(row) ? HumansVsNations : row.game_mode;
    const difficulty = row.difficulty ?? "Medium";
    let modes = byType.get(row.game_type);
    if (modes === undefined) byType.set(row.game_type, (modes = new Map()));
    let diffs = modes.get(mode);
    if (diffs === undefined) modes.set(mode, (diffs = new Map()));
    let acc = diffs.get(difficulty);
    if (acc === undefined) diffs.set(difficulty, (acc = newAcc()));
    accumulate(acc, row);
  }
  const tree: StatsTreeJson = {};
  for (const [type, modes] of byType) {
    const modeJson: Record<string, Record<string, StatsLeafJson>> = {};
    for (const [mode, diffs] of modes) {
      const diffJson: Record<string, StatsLeafJson> = {};
      for (const [d, acc] of diffs) diffJson[d] = leafJson(acc);
      modeJson[mode] = diffJson;
    }
    tree[type] = modeJson;
  }
  if (ranked.size > 0) {
    const r: Record<string, StatsLeafJson> = {};
    for (const [k, acc] of ranked) r[k] = leafJson(acc);
    tree.Ranked = r;
  }
  return tree;
}
