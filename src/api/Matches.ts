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

export interface RatingRow {
  persistent_id: string;
  ladder: string;
  rating: number;
  rd: number;
  volatility: number;
  games: number;
  wins: number;
  updated_at: Date;
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
): Promise<RatingRow | null> {
  const r = await db.query<RatingRow>(
    "SELECT * FROM ratings WHERE persistent_id = $1 AND ladder = $2",
    [persistentId, ladder],
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
): Promise<IngestResult> {
  const info = record.info;
  const inserted = await db.query<{ game_id: string }>(
    `INSERT INTO matches
       (game_id, game_type, game_mode, game_map, started_at, ended_at,
        num_turns, num_players, winner, record)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      JSON.stringify(record, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    ],
  );
  if (inserted.rows.length === 0) {
    return { stored: false, ladder: ladderFor(record), rated: 0 };
  }

  const won = winners(record);
  for (const p of info.players) {
    let persistentId: string | null = null;
    if (p.persistentID) {
      persistentId = (await ensureAccount(db, p.persistentID)).persistent_id;
    }
    await db.query(
      `INSERT INTO match_players (game_id, client_id, persistent_id, username, won)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [info.gameID, p.clientID, persistentId, p.username, won.has(p.clientID)],
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
    const row = await getRating(db, p.persistentID!, ladder);
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
      `INSERT INTO ratings (persistent_id, ladder, rating, rd, volatility, games, wins, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, now())
       ON CONFLICT (persistent_id, ladder) DO UPDATE SET
         rating = EXCLUDED.rating, rd = EXCLUDED.rd, volatility = EXCLUDED.volatility,
         games = ratings.games + 1, wins = ratings.wins + EXCLUDED.wins, updated_at = now()`,
      [
        p.persistentID,
        ladder,
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
     WHERE r.ladder = $1
     ORDER BY r.rating DESC
     LIMIT $2`,
    [ladder, limit],
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
