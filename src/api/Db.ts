/**
 * Database access for the FightWars API (Phase 2: accounts, ladder, clans).
 *
 * One tiny interface, two backends:
 *   - PgDb     — node-postgres against DATABASE_URL (production).
 *   - PgliteDb — PGlite, Postgres compiled to WASM, in-memory or under
 *                PGLITE_DIR (dev and tests: no server to install, same SQL).
 *
 * Both speak $1-style parameters and return { rows }.
 */
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

export interface QueryResult<T> {
  rows: T[];
}

export interface Db {
  readonly kind: "pg" | "pglite";
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
  close(): Promise<void>;
}

export class PgliteDb implements Db {
  readonly kind = "pglite" as const;
  private constructor(private readonly db: PGlite) {}

  /** dataDir undefined = in-memory (tests). */
  static async open(dataDir?: string): Promise<PgliteDb> {
    const db = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
    await db.waitReady;
    return new PgliteDb(db);
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    if (params.length === 0) {
      // The simple protocol: allows multi-statement SQL (migrations).
      const results = await this.db.exec(sql);
      const last = results[results.length - 1];
      return { rows: (last?.rows ?? []) as T[] };
    }
    const r = await this.db.query<T>(sql, params);
    return { rows: r.rows };
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

export class PgDb implements Db {
  readonly kind = "pg" as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.pool.query(sql, params);
    return { rows: r.rows as T[] };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** DATABASE_URL → Postgres; else PGLITE_DIR or in-memory PGlite. */
export async function openDb(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Db> {
  if (env.DATABASE_URL !== undefined && env.DATABASE_URL !== "") {
    return new PgDb(env.DATABASE_URL);
  }
  const dir = env.PGLITE_DIR;
  return PgliteDb.open(dir === undefined || dir === "" ? undefined : dir);
}
