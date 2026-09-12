/**
 * Shared helpers for the API tests: an app bound to a random port, a
 * configurable GameRecord factory, ingest, and guest login.
 */
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { vi } from "vitest";
import { createApiApp, type ApiContext } from "../../src/api/App";
import { GameRecordSchema } from "../../src/core/Schemas";

export const API_KEY = "test-api-key";

// Booting an app (PGlite in WASM, seven migrations, an Ed25519 key) takes a
// few seconds per file; with every API file starting at once on a busy box,
// or against CI's Postgres service, the default 10 s hook timeout is too
// tight. Applies to every file that imports these helpers.
vi.setConfig({ hookTimeout: 60_000 });

/**
 * Env for createApiApp. With TEST_DATABASE_URL set (CI's Postgres service)
 * every test file gets its own freshly created database, so files stay as
 * isolated as they are on in-memory PGlite.
 */
export async function apiTestEnv(
  extra: Record<string, string> = {},
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = {
    DOMAIN: "localhost",
    GAME_ENV: "dev",
    API_KEY,
    API_LOG: "false",
    ...extra,
  };
  const url = process.env.TEST_DATABASE_URL;
  if (url !== undefined && url !== "") {
    const name = `fw_test_${randomBytes(6).toString("hex")}`;
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const u = new URL(url);
    u.pathname = `/${name}`;
    env.DATABASE_URL = u.toString();
  }
  return env;
}

export interface TestApi {
  ctx: ApiContext;
  base: string;
  close(): Promise<void>;
}

export async function startTestApi(
  extra: Record<string, string> = {},
): Promise<TestApi> {
  const ctx = await createApiApp(await apiTestEnv(extra));
  const server = await new Promise<ReturnType<ApiContext["app"]["listen"]>>(
    (resolve) => {
      const s = ctx.app.listen(0, () => resolve(s));
    },
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    ctx,
    base,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await ctx.db.close();
    },
  };
}

export interface RecordPlayer {
  clientID: string;
  persistentID?: string | null;
  username?: string;
  clanTag?: string | null;
  stats?: Record<string, unknown>;
}

export interface RecordOptions {
  gameID: string;
  players: RecordPlayer[];
  /** A client id (player win), a list (team win) or null (no winner). */
  winner?: string | string[] | null;
  start?: number;
  durationMs?: number;
  gameType?: "Public" | "Private" | "Singleplayer";
  gameMode?: "Free For All" | "Team";
  playerTeams?: string | number;
  rankedType?: "1v1" | "2v2";
  difficulty?: "Easy" | "Medium" | "Hard" | "Impossible";
  maxPlayers?: number;
}

export function makeRecord(o: RecordOptions) {
  const start = o.start ?? 1_700_000_000_000;
  const durationMs = o.durationMs ?? 90_000;
  let winner: unknown;
  if (o.winner === null) winner = undefined;
  else if (Array.isArray(o.winner)) winner = ["team", "Red", ...o.winner];
  else winner = ["player", o.winner ?? o.players[0].clientID];
  return GameRecordSchema.parse({
    version: "v0.0.2",
    gitCommit: "0123456789abcdef0123456789abcdef01234567",
    subdomain: "dev",
    domain: "localhost",
    info: {
      gameID: o.gameID,
      lobbyCreatedAt: start - 5000,
      start,
      end: start + durationMs,
      duration: durationMs,
      num_turns: Math.round(durationMs / 100),
      lobbyFillTime: 5000,
      winner,
      config: {
        gameMap: "Africa",
        difficulty: o.difficulty ?? "Medium",
        donateGold: true,
        donateTroops: true,
        gameType: o.gameType ?? "Public",
        gameMode: o.gameMode ?? "Free For All",
        ...(o.playerTeams === undefined ? {} : { playerTeams: o.playerTeams }),
        ...(o.rankedType === undefined ? {} : { rankedType: o.rankedType }),
        ...(o.maxPlayers === undefined ? {} : { maxPlayers: o.maxPlayers }),
        gameMapSize: "Normal",
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        nations: "disabled",
      },
      players: o.players.map((p, i) => ({
        clientID: p.clientID,
        username: p.username ?? `Player${i}`,
        clanTag: p.clanTag ?? null,
        persistentID: p.persistentID ?? null,
        stats: p.stats ?? { conquests: ["1"] },
      })),
    },
    turns: [{ turnNumber: 0, intents: [] }],
  });
}

export async function ingest(
  base: string,
  rec: ReturnType<typeof makeRecord>,
): Promise<void> {
  const body = JSON.stringify(rec, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  const r = await fetch(`${base}/game/${rec.info.gameID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body,
  });
  if (r.status !== 200) {
    throw new Error(`ingest ${rec.info.gameID}: ${r.status} ${await r.text()}`);
  }
}

export interface Session {
  persistentId: string;
  publicId: string;
  jwt: string;
  headers: Record<string, string>;
}

export async function guest(
  base: string,
  persistentId: string,
): Promise<Session> {
  const r = await fetch(`${base}/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persistentId }),
  });
  const json = (await r.json()) as { jwt: string; publicId: string };
  return {
    persistentId,
    publicId: json.publicId,
    jwt: json.jwt,
    headers: {
      Authorization: `Bearer ${json.jwt}`,
      "Content-Type": "application/json",
    },
  };
}

/** fetch with JSON body and the session's bearer; returns status + parsed body. */
export async function call(
  base: string,
  session: Session | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session === null
        ? {}
        : { Authorization: session.headers.Authorization }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json, headers: r.headers };
}
