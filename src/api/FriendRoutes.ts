/**
 * Friends (FightWars API), matching src/client/FriendsApi.ts:
 *
 *   GET    /friends?page&limit                  FriendsListResponseSchema
 *   GET    /friends/requests                    { incoming, outgoing }
 *   POST   /friends/requests/:publicId          { status: "requested" | "accepted" }
 *   POST   /friends/requests/:publicId/accept
 *   DELETE /friends/requests/:publicId          cancel outgoing or decline incoming
 *   DELETE /friends/:publicId
 *
 * A request to someone who already asked you is an acceptance. Friendship
 * rows are stored once, ordered (a < b), so a pair has one row.
 */
import type { Express, Request, Response } from "express";
import { getAccountByPublicId } from "./Accounts";
import type { Caller, ResolveCaller } from "./ClanRoutes";
import { Db } from "./Db";

function pair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export async function friendPublicIds(
  db: Db,
  persistentId: string,
): Promise<string[]> {
  const r = await db.query<{ public_id: string }>(
    `SELECT a.public_id
     FROM friends f
     JOIN accounts a ON a.persistent_id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
     WHERE f.a = $1 OR f.b = $1
     ORDER BY a.public_id`,
    [persistentId],
  );
  return r.rows.map((row) => row.public_id);
}

export function registerFriendRoutes(
  app: Express,
  db: Db,
  resolveCaller: ResolveCaller,
): void {
  const requireCaller = async (
    req: Request,
    res: Response,
  ): Promise<Caller | null> => {
    const caller = await resolveCaller(req);
    if (caller === null) res.status(401).json({ error: "unauthorized" });
    return caller;
  };

  const other = async (req: Request, res: Response, caller: Caller) => {
    const account = await getAccountByPublicId(db, String(req.params.publicId));
    if (account === null) {
      res.status(404).json({ error: "player not found" });
      return null;
    }
    if (account.persistent_id === caller.persistentId) {
      res.status(400).json({ error: "that is you" });
      return null;
    }
    return account;
  };

  const areFriends = async (x: string, y: string) => {
    const [a, b] = pair(x, y);
    const r = await db.query("SELECT 1 FROM friends WHERE a = $1 AND b = $2", [
      a,
      b,
    ]);
    return r.rows.length > 0;
  };

  app.get("/friends", async (req, res) => {
    const caller = await requireCaller(req, res);
    if (caller === null) return;
    const page = Math.max(
      1,
      Number.parseInt(String(req.query.page ?? "1"), 10) || 1,
    );
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.limit ?? "20"), 10) || 20),
    );
    const rows = (
      await db.query<{
        public_id: string;
        username: string | null;
        created_at: Date;
      }>(
        `SELECT a.public_id, a.username, f.created_at
         FROM friends f
         JOIN accounts a ON a.persistent_id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
         WHERE f.a = $1 OR f.b = $1
         ORDER BY f.created_at DESC, a.public_id
         LIMIT $2 OFFSET $3`,
        [caller.persistentId, limit, (page - 1) * limit],
      )
    ).rows;
    const total = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM friends WHERE a = $1 OR b = $1",
        [caller.persistentId],
      )
    ).rows[0].n;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      results: rows.map((r) => ({
        publicId: r.public_id,
        username: r.username,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      total,
      page,
      limit,
    });
  });

  app.get("/friends/requests", async (req, res) => {
    const caller = await requireCaller(req, res);
    if (caller === null) return;
    const list = async (column: "from_id" | "to_id") =>
      (
        await db.query<{
          public_id: string;
          username: string | null;
          created_at: Date;
        }>(
          `SELECT a.public_id, a.username, q.created_at
           FROM friend_requests q
           JOIN accounts a ON a.persistent_id = q.${column === "from_id" ? "to_id" : "from_id"}
           WHERE q.${column} = $1 ORDER BY q.created_at DESC`,
          [caller.persistentId],
        )
      ).rows.map((r) => ({
        publicId: r.public_id,
        username: r.username,
        createdAt: new Date(r.created_at).toISOString(),
      }));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      incoming: await list("to_id"),
      outgoing: await list("from_id"),
    });
  });

  app.post("/friends/requests/:publicId", async (req, res) => {
    const caller = await requireCaller(req, res);
    if (caller === null) return;
    const target = await other(req, res, caller);
    if (target === null) return;
    if (await areFriends(caller.persistentId, target.persistent_id)) {
      res.status(409).json({ error: "already friends" });
      return;
    }
    // They already asked us: accept instead.
    const reverse = await db.query(
      "DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2 RETURNING 1",
      [target.persistent_id, caller.persistentId],
    );
    if (reverse.rows.length > 0) {
      const [a, b] = pair(caller.persistentId, target.persistent_id);
      await db.query("INSERT INTO friends (a, b) VALUES ($1, $2)", [a, b]);
      res.json({ status: "accepted" });
      return;
    }
    const inserted = await db.query(
      `INSERT INTO friend_requests (from_id, to_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING 1`,
      [caller.persistentId, target.persistent_id],
    );
    if (inserted.rows.length === 0) {
      res.status(409).json({ error: "request pending" });
      return;
    }
    res.json({ status: "requested" });
  });

  app.post("/friends/requests/:publicId/accept", async (req, res) => {
    const caller = await requireCaller(req, res);
    if (caller === null) return;
    const target = await other(req, res, caller);
    if (target === null) return;
    const removed = await db.query(
      "DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2 RETURNING 1",
      [target.persistent_id, caller.persistentId],
    );
    if (removed.rows.length === 0) {
      res.status(404).json({ error: "no such request" });
      return;
    }
    const [a, b] = pair(caller.persistentId, target.persistent_id);
    await db.query(
      "INSERT INTO friends (a, b) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [a, b],
    );
    res.status(204).end();
  });

  app.delete("/friends/requests/:publicId", async (req, res) => {
    const caller = await requireCaller(req, res);
    if (caller === null) return;
    const target = await other(req, res, caller);
    if (target === null) return;
    const removed = await db.query(
      `DELETE FROM friend_requests
       WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
       RETURNING 1`,
      [caller.persistentId, target.persistent_id],
    );
    if (removed.rows.length === 0) {
      res.status(404).json({ error: "no such request" });
      return;
    }
    res.status(204).end();
  });

  app.delete("/friends/:publicId", async (req, res) => {
    const caller = await requireCaller(req, res);
    if (caller === null) return;
    const target = await other(req, res, caller);
    if (target === null) return;
    const [a, b] = pair(caller.persistentId, target.persistent_id);
    const removed = await db.query(
      "DELETE FROM friends WHERE a = $1 AND b = $2 RETURNING 1",
      [a, b],
    );
    if (removed.rows.length === 0) {
      res.status(404).json({ error: "not friends" });
      return;
    }
    res.status(204).end();
  });
}
