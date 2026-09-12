/**
 * Player-facing profile routes (FightWars API), shaped to the schemas the
 * client already parses (src/core/ApiSchemas.ts):
 *
 *   GET /public/player/:publicId            PlayerProfileSchema (stats tree + clans)
 *   GET /public/player/:publicId/games      PublicPlayerGamesResponseSchema
 *       ?filter=ffa|team|hvn|ranked &type=public|private|singleplayer &cursor=
 *   GET /leaderboard/ranked?page=N          RankedLeaderboardResponseSchema
 *
 * Ratings ride in an extra `ratings` field the strict schema ignores.
 */
import type { Express } from "express";
import { getAccountByPublicId } from "./Accounts";
import { clansFor } from "./ClanRoutes";
import { decodeCursor, durationSeconds, encodeCursor } from "./Cursor";
import { Db } from "./Db";
import { filterSql } from "./GameBuckets";
import { getRating } from "./Matches";
import { buildStatsTree, type StatRow } from "./StatsTree";

const HISTORY_PAGE = 20;
const LEADERBOARD_PAGE = 50;

interface HistoryRow {
  game_id: string;
  game_type: string;
  game_mode: string;
  game_map: string;
  started_at: Date;
  ended_at: Date;
  num_players: number;
  player_teams: string | null;
  ranked_type: string | null;
  winner_known: boolean;
  username: string;
  won: boolean;
  clan_tag: string | null;
}

export function registerProfileRoutes(app: Express, db: Db): void {
  app.get("/public/player/:publicId", async (req, res) => {
    const account = await getAccountByPublicId(db, req.params.publicId);
    if (account === null) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const [ffa, team, clans, statRows] = await Promise.all([
      getRating(db, account.persistent_id, "ffa"),
      getRating(db, account.persistent_id, "team"),
      clansFor(db, account.persistent_id),
      db.query<StatRow>(
        `SELECT m.game_type, m.game_mode, m.difficulty, m.player_teams, m.ranked_type,
                mp.won, (m.winner IS NOT NULL) AS winner_known, mp.stats
         FROM match_players mp JOIN matches m ON m.game_id = mp.game_id
         WHERE mp.persistent_id = $1
         ORDER BY m.ended_at DESC, m.game_id DESC`,
        [account.persistent_id],
      ),
    ]);
    const shape = (r: typeof ffa) =>
      r === null
        ? null
        : { rating: r.rating, rd: r.rd, games: r.games, wins: r.wins };
    res.setHeader("Cache-Control", "no-store");
    res.json({
      createdAt: new Date(account.created_at).toISOString(),
      username: account.username,
      stats: buildStatsTree(statRows.rows),
      clans,
      // FightWars extension (ignored by the strict client schema).
      publicId: account.public_id,
      ratings: { ffa: shape(ffa), team: shape(team) },
    });
  });

  app.get("/public/player/:publicId/games", async (req, res) => {
    const account = await getAccountByPublicId(db, req.params.publicId);
    if (account === null) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const type = String(req.query.type ?? "");
    const where: string[] = ["mp.persistent_id = $1"];
    const params: unknown[] = [account.persistent_id];
    const filter = filterSql(String(req.query.filter ?? ""));
    if (filter !== null) where.push(filter);
    if (type === "public") where.push("m.game_type = 'Public'");
    else if (type === "private") where.push("m.game_type = 'Private'");
    else if (type === "singleplayer")
      where.push("m.game_type = 'Singleplayer'");
    const cursor =
      typeof req.query.cursor === "string"
        ? decodeCursor(req.query.cursor)
        : null;
    if (typeof req.query.cursor === "string" && cursor === null) {
      res.status(400).json({ error: "bad cursor" });
      return;
    }
    if (cursor !== null) {
      params.push(cursor.endedAt, cursor.gameId);
      where.push(
        `(m.ended_at, m.game_id) < ($${params.length - 1}, $${params.length})`,
      );
    }
    params.push(HISTORY_PAGE + 1);
    const rows = (
      await db.query<HistoryRow>(
        `SELECT m.game_id, m.game_type, m.game_mode, m.game_map, m.started_at,
                m.ended_at, m.num_players, m.player_teams, m.ranked_type,
                (m.winner IS NOT NULL) AS winner_known,
                mp.username, mp.won, mp.clan_tag
         FROM match_players mp JOIN matches m ON m.game_id = mp.game_id
         WHERE ${where.join(" AND ")}
         ORDER BY m.ended_at DESC, m.game_id DESC
         LIMIT $${params.length}`,
        params,
      )
    ).rows;
    const page = rows.slice(0, HISTORY_PAGE);
    const last = page[page.length - 1];
    res.json({
      results: page.map((r) => ({
        gameId: r.game_id,
        start: new Date(r.started_at).toISOString(),
        durationSeconds: durationSeconds(r.started_at, r.ended_at),
        map: r.game_map,
        mode: r.game_mode,
        type: r.game_type,
        playerTeams: r.player_teams,
        rankedType: r.ranked_type ?? "unranked",
        result: !r.winner_known ? "incomplete" : r.won ? "victory" : "defeat",
        totalPlayers: r.num_players,
        username: r.username,
        clanTag: r.clan_tag,
      })),
      nextCursor:
        rows.length > HISTORY_PAGE && last !== undefined
          ? encodeCursor(new Date(last.ended_at), last.game_id)
          : null,
    });
  });

  app.get("/leaderboard/ranked", async (req, res) => {
    const page = Math.max(
      1,
      Number.parseInt(String(req.query.page ?? "1"), 10) || 1,
    );
    const offset = (page - 1) * LEADERBOARD_PAGE;
    const entries = async (ladder: string) =>
      (
        await db.query<{
          public_id: string;
          username: string | null;
          rating: number;
          games: number;
          wins: number;
        }>(
          `SELECT a.public_id, a.username, r.rating, r.games, r.wins
           FROM ratings r JOIN accounts a ON a.persistent_id = r.persistent_id
           WHERE r.ladder = $1
           ORDER BY r.rating DESC, r.games DESC, a.public_id
           LIMIT $2 OFFSET $3`,
          [ladder, LEADERBOARD_PAGE, offset],
        )
      ).rows.map((r, i) => ({
        rank: offset + i + 1,
        elo: Math.round(r.rating),
        peakElo: null,
        wins: r.wins,
        losses: r.games - r.wins,
        total: r.games,
        public_id: r.public_id,
        accountUsername: r.username,
      }));
    res.setHeader("Cache-Control", "no-store");
    res.json({ "1v1": await entries("ffa"), "2v2": await entries("team") });
  });
}
