/**
 * Daily and weekly challenges (brief §6.7): "win a game", "take 500 tiles",
 * "build twenty structures" — read off the match records the API already
 * ingests, so nothing new crosses the wire from the game and no client can
 * claim progress it did not earn.
 *
 * A challenge is a period (daily / weekly), a metric read from one player's
 * stats in one match, and a target. Progress is the sum over the matches
 * ingested inside the period, stored per account so the sum is cheap to
 * read. Which challenges are live is a function of the period's key, so
 * every player in a period sees the same set and it rotates without a
 * deployment. **Cosmetic only, by design:** a completed challenge is a line
 * on the profile; it grants nothing that touches a game.
 */
import {
  ATTACK_INDEX_SENT,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_WORK,
  OTHER_INDEX_BUILT,
} from "../core/StatsSchemas";

export type ChallengePeriod = "daily" | "weekly";

export interface ChallengeDef {
  id: string;
  period: ChallengePeriod;
  /** Translation key for the client; the API never sends prose. */
  nameKey: string;
  target: number;
  /** What one match by one player contributes. */
  metric: (m: MatchFacts) => number;
}

/** What one player did in one match, as the record carries it. */
export interface MatchFacts {
  won: boolean;
  stats: PlayerStatsJson | null;
}

type StatArray = (string | number)[] | undefined;
export interface PlayerStatsJson {
  attacks?: StatArray;
  conquests?: StatArray;
  gold?: StatArray;
  units?: Record<string, StatArray>;
  bombs?: Record<string, StatArray>;
  boats?: Record<string, StatArray>;
}

function at(a: StatArray, i: number): number {
  const v = a?.[i];
  return v === undefined ? 0 : Number(v);
}

function sumRecord(
  r: Record<string, StatArray> | undefined,
  i: number,
): number {
  if (r === undefined) return 0;
  return Object.values(r).reduce((acc, a) => acc + at(a, i), 0);
}

export const CHALLENGES: readonly ChallengeDef[] = [
  {
    id: "daily_win",
    period: "daily",
    nameKey: "challenge.daily_win",
    target: 1,
    metric: (m) => (m.won ? 1 : 0),
  },
  {
    id: "daily_play",
    period: "daily",
    nameKey: "challenge.daily_play",
    target: 3,
    metric: () => 1,
  },
  {
    id: "daily_attack",
    period: "daily",
    nameKey: "challenge.daily_attack",
    target: 500_000,
    metric: (m) => at(m.stats?.attacks, ATTACK_INDEX_SENT),
  },
  {
    id: "daily_build",
    period: "daily",
    nameKey: "challenge.daily_build",
    target: 20,
    metric: (m) => sumRecord(m.stats?.units, OTHER_INDEX_BUILT),
  },
  {
    id: "weekly_wins",
    period: "weekly",
    nameKey: "challenge.weekly_wins",
    target: 5,
    metric: (m) => (m.won ? 1 : 0),
  },
  {
    id: "weekly_trade",
    period: "weekly",
    nameKey: "challenge.weekly_trade",
    target: 5_000_000,
    metric: (m) =>
      at(m.stats?.gold, GOLD_INDEX_TRADE) + at(m.stats?.gold, GOLD_INDEX_WORK),
  },
  {
    id: "weekly_nukes",
    period: "weekly",
    nameKey: "challenge.weekly_nukes",
    target: 10,
    metric: (m) => sumRecord(m.stats?.bombs, 1),
  },
];

/** The period key a moment falls in: `d:YYYY-MM-DD` / `w:YYYY-Www`, UTC. */
export function periodKey(period: ChallengePeriod, at: Date): string {
  const y = at.getUTCFullYear();
  if (period === "daily") {
    const m = String(at.getUTCMonth() + 1).padStart(2, "0");
    const d = String(at.getUTCDate()).padStart(2, "0");
    return `d:${y}-${m}-${d}`;
  }
  // ISO week (Monday to Sunday, the week owning the year's first Thursday).
  const target = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
  target.setUTCDate(target.getUTCDate() - ((target.getUTCDay() + 6) % 7) + 3);
  const thursday = target.getTime();
  const isoYear = target.getUTCFullYear();
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const firstThursday = new Date(
    Date.UTC(isoYear, 0, 1 + ((4 - jan1.getUTCDay() + 7) % 7)),
  );
  const week =
    1 + Math.round((thursday - firstThursday.getTime()) / 604_800_000);
  return `w:${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * The challenges live in a period: three of the dailies and two of the
 * weeklies, chosen by the period key so the rotation is the same for
 * everyone and needs no state.
 */
export function activeChallenges(at: Date): ChallengeDef[] {
  const pick = (period: ChallengePeriod, n: number): ChallengeDef[] => {
    const pool = CHALLENGES.filter((c) => c.period === period);
    const key = periodKey(period, at);
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const start = h % pool.length;
    return Array.from(
      { length: Math.min(n, pool.length) },
      (_, i) => pool[(start + i) % pool.length],
    );
  };
  return [...pick("daily", 3), ...pick("weekly", 2)];
}

/** What one match adds to each live challenge, ids to amounts (zeroes dropped). */
export function progressFrom(
  facts: MatchFacts,
  at: Date,
): { id: string; period: ChallengePeriod; amount: number }[] {
  return activeChallenges(at)
    .map((c) => ({
      id: c.id,
      period: c.period,
      amount: Math.max(0, Math.floor(c.metric(facts))),
    }))
    .filter((p) => p.amount > 0);
}
