/**
 * Schema migrations for the FightWars API database. Append-only: never edit
 * a shipped entry, add a new one. Applied in order at startup and in tests.
 */
import { Db } from "./Db";

export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "0001_accounts",
    sql: `
      CREATE TABLE accounts (
        persistent_id UUID PRIMARY KEY,
        public_id     TEXT NOT NULL UNIQUE,
        username      TEXT,
        role          TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE sessions (
        token_hash    TEXT PRIMARY KEY,
        persistent_id UUID NOT NULL REFERENCES accounts(persistent_id) ON DELETE CASCADE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at    TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX sessions_persistent_id ON sessions(persistent_id);
    `,
  },
  {
    id: "0002_matches",
    sql: `
      CREATE TABLE matches (
        game_id      TEXT PRIMARY KEY,
        game_type    TEXT NOT NULL,
        game_mode    TEXT NOT NULL,
        game_map     TEXT NOT NULL,
        started_at   TIMESTAMPTZ NOT NULL,
        ended_at     TIMESTAMPTZ NOT NULL,
        num_turns    INTEGER NOT NULL,
        num_players  INTEGER NOT NULL,
        winner       JSONB,
        record       JSONB NOT NULL,
        ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX matches_started_at ON matches(started_at);
      CREATE TABLE match_players (
        game_id       TEXT NOT NULL REFERENCES matches(game_id) ON DELETE CASCADE,
        client_id     TEXT NOT NULL,
        persistent_id UUID REFERENCES accounts(persistent_id) ON DELETE SET NULL,
        username      TEXT NOT NULL,
        won           BOOLEAN NOT NULL,
        PRIMARY KEY (game_id, client_id)
      );
      CREATE INDEX match_players_persistent_id ON match_players(persistent_id);
    `,
  },
  {
    id: "0003_ratings",
    sql: `
      CREATE TABLE ratings (
        persistent_id UUID NOT NULL REFERENCES accounts(persistent_id) ON DELETE CASCADE,
        ladder        TEXT NOT NULL,
        rating        DOUBLE PRECISION NOT NULL,
        rd            DOUBLE PRECISION NOT NULL,
        volatility    DOUBLE PRECISION NOT NULL,
        games         INTEGER NOT NULL DEFAULT 0,
        wins          INTEGER NOT NULL DEFAULT 0,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (persistent_id, ladder)
      );
      CREATE INDEX ratings_ladder_rating ON ratings(ladder, rating DESC);
    `,
  },
];

export async function migrate(db: Db): Promise<string[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const done = new Set(
    (
      await db.query<{ id: string }>("SELECT id FROM schema_migrations")
    ).rows.map((r) => r.id),
  );
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.query(m.sql);
    await db.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
    applied.push(m.id);
  }
  return applied;
}
