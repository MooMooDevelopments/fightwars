/**
 * Accounts for the FightWars API.
 *
 * Every player is an account keyed by their persistent id (the UUID the
 * client mints on first visit; a signed JWT carries it as `sub`). There is
 * no password: a browser proves possession of the id by presenting it once
 * to /auth/guest and thereafter holds a rotating refresh cookie. Linked
 * logins (Discord etc.) attach to the same row later.
 */
import { createHash, randomBytes } from "node:crypto";
import { Db } from "./Db";

export interface Account {
  persistent_id: string;
  public_id: string;
  username: string | null;
  role: string | null;
  created_at: Date;
  last_seen_at: Date;
}

const PUBLIC_ID_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function mintPublicId(): string {
  const bytes = randomBytes(10);
  let s = "";
  for (const b of bytes) s += PUBLIC_ID_ALPHABET[b % PUBLIC_ID_ALPHABET.length];
  return s;
}

export async function ensureAccount(
  db: Db,
  persistentId: string,
): Promise<Account> {
  const existing = await db.query<Account>(
    "UPDATE accounts SET last_seen_at = now() WHERE persistent_id = $1 RETURNING *",
    [persistentId],
  );
  if (existing.rows.length > 0) return existing.rows[0];
  // Retry on the (astronomically unlikely) public id collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const inserted = await db.query<Account>(
      `INSERT INTO accounts (persistent_id, public_id)
       VALUES ($1, $2)
       ON CONFLICT (persistent_id) DO UPDATE SET last_seen_at = now()
       RETURNING *`,
      [persistentId, mintPublicId()],
    );
    if (inserted.rows.length > 0) return inserted.rows[0];
  }
  throw new Error("could not create account");
}

export async function getAccount(
  db: Db,
  persistentId: string,
): Promise<Account | null> {
  const r = await db.query<Account>(
    "SELECT * FROM accounts WHERE persistent_id = $1",
    [persistentId],
  );
  return r.rows[0] ?? null;
}

export async function getAccountByPublicId(
  db: Db,
  publicId: string,
): Promise<Account | null> {
  const r = await db.query<Account>(
    "SELECT * FROM accounts WHERE public_id = $1",
    [publicId],
  );
  return r.rows[0] ?? null;
}

// ── Refresh sessions ──

const SESSION_TTL_DAYS = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mint a refresh token for the account; only its hash is stored. */
export async function createSession(
  db: Db,
  persistentId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.query(
    "INSERT INTO sessions (token_hash, persistent_id, expires_at) VALUES ($1, $2, $3)",
    [hashToken(token), persistentId, expiresAt],
  );
  return { token, expiresAt };
}

/**
 * Exchange a refresh token: returns the account and a rotated token, or
 * null when the token is unknown or expired. The old token is consumed.
 */
export async function rotateSession(
  db: Db,
  token: string,
): Promise<{ account: Account; token: string; expiresAt: Date } | null> {
  const r = await db.query<{ persistent_id: string }>(
    `DELETE FROM sessions
     WHERE token_hash = $1 AND expires_at > now()
     RETURNING persistent_id`,
    [hashToken(token)],
  );
  if (r.rows.length === 0) return null;
  const account = await ensureAccount(db, r.rows[0].persistent_id);
  const next = await createSession(db, account.persistent_id);
  return { account, ...next };
}

export async function revokeSessions(
  db: Db,
  persistentId: string,
): Promise<void> {
  await db.query("DELETE FROM sessions WHERE persistent_id = $1", [
    persistentId,
  ]);
}
