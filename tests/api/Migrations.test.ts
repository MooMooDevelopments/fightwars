// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgliteDb } from "../../src/api/Db";
import { migrate, MIGRATIONS } from "../../src/api/Migrations";

// 0004 backfills the new match columns from the stored record JSON. Records
// ingested before that migration must come out with the same columns the
// ingest now writes directly.

let db: PgliteDb;

beforeAll(async () => {
  db = await PgliteDb.open();
});

afterAll(async () => {
  await db.close();
});

describe("0004_match_details backfill", () => {
  it("fills difficulty, team config, ranked type, clan tags and stats from existing records", async () => {
    await db.query(`
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    for (const m of MIGRATIONS.slice(0, 3)) {
      await db.query(m.sql);
      await db.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
    }
    const record = {
      info: {
        gameID: "oldGame01",
        lobbyFillTime: 4321.6,
        config: {
          difficulty: "Hard",
          playerTeams: 3,
          rankedType: "2v2",
          maxPlayers: 12,
        },
        players: [
          { clientID: "cA000000", clanTag: "abc", stats: { gold: ["7", "1"] } },
          { clientID: "cB000000", clanTag: null, stats: {} },
        ],
      },
    };
    await db.query(
      `INSERT INTO matches (game_id, game_type, game_mode, game_map, started_at, ended_at,
                            num_turns, num_players, winner, record)
       VALUES ('oldGame01', 'Public', 'Team', 'Africa', now(), now(), 10, 2, NULL, $1)`,
      [JSON.stringify(record)],
    );
    await db.query(
      `INSERT INTO match_players (game_id, client_id, persistent_id, username, won) VALUES
         ('oldGame01', 'cA000000', NULL, 'A', true),
         ('oldGame01', 'cB000000', NULL, 'B', false)`,
    );

    const applied = await migrate(db);
    expect(applied).toContain("0004_match_details");

    const match = (
      await db.query<{
        difficulty: string;
        player_teams: string;
        ranked_type: string;
        max_players: number;
        lobby_fill_ms: number;
      }>("SELECT * FROM matches WHERE game_id = 'oldGame01'")
    ).rows[0];
    expect(match).toMatchObject({
      difficulty: "Hard",
      player_teams: "3",
      ranked_type: "2v2",
      max_players: 12,
      lobby_fill_ms: 4322,
    });
    const players = (
      await db.query<{
        client_id: string;
        clan_tag: string | null;
        stats: unknown;
      }>(
        "SELECT client_id, clan_tag, stats FROM match_players ORDER BY client_id",
      )
    ).rows;
    expect(players).toEqual([
      { client_id: "cA000000", clan_tag: "ABC", stats: { gold: ["7", "1"] } },
      { client_id: "cB000000", clan_tag: null, stats: {} },
    ]);
    // Idempotent: a second run applies nothing.
    expect(await migrate(db)).toEqual([]);
  });
});
