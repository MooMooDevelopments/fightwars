/**
 * Public game listings (FightWars API), per docs/API.md "Games":
 *
 *   GET /public/games?start&end&type&mode&rankedType&playerTeams&limit&offset
 *       → [{ game, start, end, type, mode, difficulty, numPlayers, maxPlayers,
 *            lobbyFillTime, playerTeams, rankedType }], Content-Range: games a-b/total
 *   GET /public/game/:id?turns=false   the scrubbed record (no persistent ids, no reports)
 */
import type { Express } from "express";
import { z } from "zod";
import { ID } from "../core/Schemas";
import { replacer } from "../core/Util";
import { Db } from "./Db";
import { getMatchRecord, scrubRecord } from "./Matches";

const MAX_RANGE_MS = 2 * 86_400_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

const QuerySchema = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  type: z.enum(["Private", "Public", "Singleplayer"]).optional(),
  mode: z.enum(["Free For All", "Team"]).optional(),
  rankedType: z.enum(["unranked", "1v1", "2v2"]).optional(),
  playerTeams: z.string().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

interface GameRow {
  game_id: string;
  game_type: string;
  game_mode: string;
  difficulty: string | null;
  started_at: Date;
  ended_at: Date;
  num_players: number;
  max_players: number | null;
  lobby_fill_ms: number | null;
  player_teams: string | null;
  ranked_type: string | null;
}

export function registerGamesRoutes(app: Express, db: Db): void {
  app.get("/public/games", async (req, res) => {
    const q = QuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({
        error: "start and end (ISO 8601) are required",
        detail: z.prettifyError(q.error).slice(0, 300),
      });
      return;
    }
    const start = new Date(q.data.start);
    const end = new Date(q.data.end);
    if (
      end.getTime() < start.getTime() ||
      end.getTime() - start.getTime() > MAX_RANGE_MS
    ) {
      res.status(400).json({ error: "time range must be at most 2 days" });
      return;
    }
    const where = ["m.started_at >= $1", "m.started_at <= $2"];
    const params: unknown[] = [start, end];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(`${sql} $${params.length}`);
    };
    if (q.data.type !== undefined) add("m.game_type =", q.data.type);
    if (q.data.mode !== undefined) add("m.game_mode =", q.data.mode);
    if (q.data.rankedType !== undefined) {
      if (q.data.rankedType === "unranked") {
        where.push("(m.ranked_type IS NULL OR m.ranked_type = 'unranked')");
      } else add("m.ranked_type =", q.data.rankedType);
    }
    if (q.data.playerTeams !== undefined)
      add("m.player_teams =", q.data.playerTeams);
    const total = (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM matches m WHERE ${where.join(" AND ")}`,
        params,
      )
    ).rows[0].n;
    params.push(q.data.limit, q.data.offset);
    const rows = (
      await db.query<GameRow>(
        `SELECT m.game_id, m.game_type, m.game_mode, m.difficulty, m.started_at, m.ended_at,
                m.num_players, m.max_players, m.lobby_fill_ms, m.player_teams, m.ranked_type
         FROM matches m WHERE ${where.join(" AND ")}
         ORDER BY m.started_at, m.game_id
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
    ).rows;
    res.setHeader(
      "Content-Range",
      `games ${q.data.offset}-${q.data.offset + rows.length}/${total}`,
    );
    res.setHeader("Access-Control-Expose-Headers", "Content-Range");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(
      rows.map((r) => ({
        game: r.game_id,
        start: new Date(r.started_at).toISOString(),
        end: new Date(r.ended_at).toISOString(),
        type: r.game_type,
        mode: r.game_mode,
        difficulty: r.difficulty,
        numPlayers: r.num_players,
        maxPlayers: r.max_players,
        lobbyFillTime: r.lobby_fill_ms,
        playerTeams: r.player_teams,
        rankedType: r.ranked_type ?? "unranked",
      })),
    );
  });

  app.get("/public/game/:id", async (req, res) => {
    const id = ID.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "invalid game id" });
      return;
    }
    const record = await getMatchRecord(db, id.data);
    if (record === null) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const includeTurns = String(req.query.turns ?? "true") !== "false";
    res.setHeader("Cache-Control", "public, max-age=3600");
    res
      .type("application/json")
      .send(JSON.stringify(scrubRecord(record, includeTurns), replacer));
  });
}
