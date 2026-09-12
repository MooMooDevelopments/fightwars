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
  {
    id: "0004_match_details",
    sql: `
      ALTER TABLE matches
        ADD COLUMN difficulty    TEXT,
        ADD COLUMN player_teams  TEXT,
        ADD COLUMN ranked_type   TEXT,
        ADD COLUMN max_players   INTEGER,
        ADD COLUMN lobby_fill_ms INTEGER;
      UPDATE matches SET
        difficulty    = record->'info'->'config'->>'difficulty',
        player_teams  = record->'info'->'config'->>'playerTeams',
        ranked_type   = record->'info'->'config'->>'rankedType',
        max_players   = round((record->'info'->'config'->>'maxPlayers')::numeric)::int,
        lobby_fill_ms = round((record->'info'->>'lobbyFillTime')::numeric)::int;
      CREATE INDEX matches_type_started ON matches(game_type, started_at);
      ALTER TABLE match_players
        ADD COLUMN clan_tag TEXT,
        ADD COLUMN verified BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN stats    JSONB;
      UPDATE match_players mp SET
        clan_tag = upper(p.value->>'clanTag'),
        stats    = p.value->'stats'
      FROM matches m, jsonb_array_elements(m.record->'info'->'players') AS p
      WHERE mp.game_id = m.game_id AND mp.client_id = p.value->>'clientID';
      CREATE INDEX match_players_clan_tag ON match_players(clan_tag) WHERE clan_tag IS NOT NULL;
    `,
  },
  {
    id: "0005_clans",
    sql: `
      CREATE TABLE clans (
        tag         TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        discord_url TEXT,
        is_open     BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE clan_members (
        persistent_id UUID PRIMARY KEY REFERENCES accounts(persistent_id) ON DELETE CASCADE,
        tag           TEXT NOT NULL REFERENCES clans(tag) ON DELETE CASCADE,
        role          TEXT NOT NULL,
        joined_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX clan_members_tag ON clan_members(tag);
      CREATE TABLE clan_requests (
        tag           TEXT NOT NULL REFERENCES clans(tag) ON DELETE CASCADE,
        persistent_id UUID NOT NULL REFERENCES accounts(persistent_id) ON DELETE CASCADE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tag, persistent_id)
      );
      CREATE INDEX clan_requests_persistent_id ON clan_requests(persistent_id);
      CREATE TABLE clan_bans (
        tag           TEXT NOT NULL REFERENCES clans(tag) ON DELETE CASCADE,
        persistent_id UUID NOT NULL REFERENCES accounts(persistent_id) ON DELETE CASCADE,
        banned_by     UUID REFERENCES accounts(persistent_id) ON DELETE SET NULL,
        reason        TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tag, persistent_id)
      );
    `,
  },
  {
    id: "0006_friends",
    sql: `
      CREATE TABLE friend_requests (
        from_id    UUID NOT NULL REFERENCES accounts(persistent_id) ON DELETE CASCADE,
        to_id      UUID NOT NULL REFERENCES accounts(persistent_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (from_id, to_id)
      );
      CREATE INDEX friend_requests_to ON friend_requests(to_id);
      CREATE TABLE friends (
        a          UUID NOT NULL REFERENCES accounts(persistent_id) ON DELETE CASCADE,
        b          UUID NOT NULL REFERENCES accounts(persistent_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (a, b),
        CHECK (a < b)
      );
      CREATE INDEX friends_b ON friends(b);
    `,
  },
  {
    id: "0007_ladder_seasons",
    sql: `
      ALTER TABLE ratings ADD COLUMN season TEXT NOT NULL DEFAULT '1';
      ALTER TABLE ratings DROP CONSTRAINT ratings_pkey;
      ALTER TABLE ratings ADD PRIMARY KEY (persistent_id, ladder, season);
      DROP INDEX ratings_ladder_rating;
      CREATE INDEX ratings_season_ladder_rating ON ratings(season, ladder, rating DESC);
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
