/**
 * Match ingest and the ladder (FightWars API).
 *
 * The game server POSTs the finished GameRecord here (Archive.ts, when the
 * API replay store is in use) or the same record can be pushed from the
 * file store. Ingest is idempotent per game id: the match and its players
 * are stored, and every human with a persistent id gets a Glicko-2 update
 * on the ladder for that game's mode.
 *
 * Ladders: "ffa" for Free For All, "team" for Team games. Singleplayer and
 * games with fewer than two humans never touch a rating.
 */
import { GameRecord } from "../core/Schemas";
import { ensureAccount } from "./Accounts";
import { Db } from "./Db";
import { DEFAULT_RATING, matchResults, Rating, updateRating } from "./Glicko2";

/**
 * The ladder season ratings accrue to: LADDER_SEASON, "1" when unset.
 * Changing it starts everyone at the default rating on the new season;
 * earlier seasons stay queryable (?season= on the leaderboards).
 */
export function seasonFrom(env: NodeJS.ProcessEnv): string {
  const s = env.LADDER_SEASON?.trim();
  return s === undefined || s === "" ? "1" : s;
}

/** A `?season=` query value, or undefined when absent or malformed. */
export function seasonParam(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  return /^[A-Za-z0-9_-]{1,32}$/.test(s) ? s : undefined;
}

export interface RatingRow {
  persistent_id: string;
  ladder: string;
  season: string;
  rating: number;
  rd: number;
  volatility: number;
  games: number;
  wins: number;
  updated_at: Date;
}

const bigintToString = (_k: string, v: unknown) =>
  typeof v === "bigint" ? v.toString() : v;

/**
 * A record safe to hand to anyone: persistent ids (login credentials in
 * dev, PII always) and player reports are stripped, like upstream's API.
 */
export function scrubRecord(
  record: GameRecord,
  includeTurns = true,
): Record<string, unknown> {
  const info: Record<string, unknown> = {
    ...record.info,
    players: record.info.players.map((p) => ({ ...p, persistentID: null })),
  };
  delete info.reports;
  const scrubbed: Record<string, unknown> = { ...record, info };
  if (!includeTurns) delete scrubbed.turns;
  return scrubbed;
}

export function ladderFor(record: GameRecord): string | null {
  if (record.info.config.gameType === "Singleplayer") return null;
  return record.info.config.gameMode === "Team" ? "team" : "ffa";
}

/** Which players won, from the record's winner tuple. */
export function winners(record: GameRecord): Set<string> {
  const w = record.info.winner;
  const out = new Set<string>();
  if (w === undefined || w === null) return out;
  const [kind, ...rest] = w as unknown as [string, ...string[]];
  if (kind === "player") {
    for (const id of rest) out.add(id);
  } else if (kind === "team") {
    // ["team", teamName, ...clientIDs]
    for (const id of rest.slice(1)) out.add(id);
  }
  return out;
}

export async function getRating(
  db: Db,
  persistentId: string,
  ladder: string,
  season: string,
): Promise<RatingRow | null> {
  const r = await db.query<RatingRow>(
    "SELECT * FROM ratings WHERE persistent_id = $1 AND ladder = $2 AND season = $3",
    [persistentId, ladder, season],
  );
  return r.rows[0] ?? null;
}

export interface IngestResult {
  stored: boolean;
  ladder: string | null;
  rated: number;
}

export async function ingestMatch(
  db: Db,
  record: GameRecord,
  season: string,
): Promise<IngestResult> {
  const info = record.info;
  const inserted = await db.query<{ game_id: string }>(
    `INSERT INTO matches
       (game_id, game_type, game_mode, game_map, started_at, ended_at,
        num_turns, num_players, winner, record,
        difficulty, player_teams, ranked_type, max_players, lobby_fill_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (game_id) DO NOTHING
     RETURNING game_id`,
    [
      info.gameID,
      info.config.gameType,
      info.config.gameMode,
      info.config.gameMap,
      new Date(info.start),
      new Date(info.end),
      info.num_turns,
      info.players.length,
      info.winner === undefined ? null : JSON.stringify(info.winner),
      JSON.stringify(record, bigintToString),
      info.config.difficulty,
      info.config.playerTeams === undefined
        ? null
        : String(info.config.playerTeams),
      info.config.rankedType ?? null,
      info.config.maxPlayers ?? null,
      Math.round(info.lobbyFillTime),
    ],
  );
  if (inserted.rows.length === 0) {
    return { stored: false, ladder: ladderFor(record), rated: 0 };
  }

  const won = winners(record);
  for (const p of info.players) {
    let persistentId: string | null = null;
    let verified = false;
    if (p.persistentID) {
      const account = await ensureAccount(db, p.persistentID);
      persistentId = account.persistent_id;
      // Played under the account's own name: the verified check in history.
      verified = account.username !== null && account.username === p.username;
    }
    await db.query(
      `INSERT INTO match_players
         (game_id, client_id, persistent_id, username, won, clan_tag, verified, stats)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        info.gameID,
        p.clientID,
        persistentId,
        p.username,
        won.has(p.clientID),
        p.clanTag === null ? null : p.clanTag.toUpperCase(),
        verified,
        p.stats === undefined ? null : JSON.stringify(p.stats, bigintToString),
      ],
    );
  }

  const ladder = ladderFor(record);
  if (ladder === null) return { stored: true, ladder, rated: 0 };

  const rated = info.players.filter((p) => p.persistentID);
  if (rated.length < 2) return { stored: true, ladder, rated: 0 };

  // Load every participant's current rating, compute all updates from the
  // pre-match ratings (a proper rating period), then write.
  const current = new Map<string, Rating>();
  for (const p of rated) {
    const row = await getRating(db, p.persistentID!, ladder, season);
    current.set(
      p.clientID,
      row === null
        ? DEFAULT_RATING
        : { rating: row.rating, rd: row.rd, volatility: row.volatility },
    );
  }
  const results = matchResults(
    rated.map((p) => ({
      id: p.clientID,
      rating: current.get(p.clientID)!,
      won: won.has(p.clientID),
    })),
  );
  for (const p of rated) {
    const next = updateRating(
      current.get(p.clientID)!,
      results.get(p.clientID)!,
    );
    await db.query(
      `INSERT INTO ratings (persistent_id, ladder, season, rating, rd, volatility, games, wins, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, now())
       ON CONFLICT (persistent_id, ladder, season) DO UPDATE SET
         rating = EXCLUDED.rating, rd = EXCLUDED.rd, volatility = EXCLUDED.volatility,
         games = ratings.games + 1, wins = ratings.wins + EXCLUDED.wins, updated_at = now()`,
      [
        p.persistentID,
        ladder,
        season,
        next.rating,
        next.rd,
        next.volatility,
        won.has(p.clientID) ? 1 : 0,
      ],
    );
  }
  return { stored: true, ladder, rated: rated.length };
}

export interface LeaderboardEntry {
  publicId: string;
  username: string | null;
  rating: number;
  rd: number;
  games: number;
  wins: number;
}

export async function leaderboard(
  db: Db,
  ladder: string,
  season: string,
  limit = 100,
): Promise<LeaderboardEntry[]> {
  const r = await db.query<{
    public_id: string;
    username: string | null;
    rating: number;
    rd: number;
    games: number;
    wins: number;
  }>(
    `SELECT a.public_id, a.username, r.rating, r.rd, r.games, r.wins
     FROM ratings r JOIN accounts a ON a.persistent_id = r.persistent_id
     WHERE r.ladder = $1 AND r.season = $2
     ORDER BY r.rating DESC
     LIMIT $3`,
    [ladder, season, limit],
  );
  return r.rows.map((row) => ({
    publicId: row.public_id,
    username: row.username,
    rating: row.rating,
    rd: row.rd,
    games: row.games,
    wins: row.wins,
  }));
}

export async function getMatchRecord(
  db: Db,
  gameId: string,
): Promise<GameRecord | null> {
  const r = await db.query<{ record: GameRecord }>(
    "SELECT record FROM matches WHERE game_id = $1",
    [gameId],
  );
  return r.rows[0]?.record ?? null;
}
