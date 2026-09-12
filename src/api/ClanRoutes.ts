/**
 * Clans (FightWars API), in the shapes the client already parses
 * (src/core/ClanApiSchemas.ts, called from src/client/ClanApi.ts).
 *
 *   GET    /public/clans/leaderboard        top 100 by weighted wins (docs/API.md)
 *   GET    /public/clan/:tag/exists         200 | 404 (the join-time tag probe)
 *   GET    /clans?search&page&limit         browse
 *   POST   /clans                           create (the caller becomes leader)
 *   GET    /clans/:tag                      ClanInfo
 *   PATCH  /clans/:tag                      name / description / discordUrl / isOpen
 *   DELETE /clans/:tag                      disband (leader)
 *   GET    /clans/:tag/members?page&limit&sort&order&search
 *   POST   /clans/:tag/join | leave
 *   POST   /clans/:tag/kick | promote | demote | transfer   { targetPublicId }
 *   GET    /clans/:tag/requests             pending joins (officer+)
 *   POST   /clans/:tag/requests/approve | deny              { targetPublicId }
 *   POST   /clans/:tag/requests/withdraw    the caller's own request
 *   POST   /clans/:tag/ban | unban          { targetPublicId, reason? }
 *   GET    /clans/:tag/bans                 (officer+)
 *   GET    /clans/:tag/games?filter&cursor  clan match history
 *   GET    /clans/:tag/donations            always empty — FightWars has no currency
 *   POST   /clans/:tag/donate               400, same reason
 *
 * Rules: one clan per account; tags are 2–5 alphanumerics stored uppercase;
 * leader > officer > member, and you only act on ranks below your own.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { ClanMemberStats } from "../core/ClanApiSchemas";
import { censorPlayer } from "../server/Censor";
import { getAccountByPublicId } from "./Accounts";
import { decodeCursor, durationSeconds, encodeCursor } from "./Cursor";
import { Db } from "./Db";
import {
  emptyMemberStats,
  filterSql,
  memberStatKeys,
  numTeams,
  type MatchShape,
} from "./GameBuckets";

export type Caller = { persistentId: string; role?: string };
export type ResolveCaller = (req: Request) => Promise<Caller | null>;

const TAG_RE = /^[a-zA-Z0-9]{2,5}$/;
const NAME_MAX = 35;
const DESCRIPTION_MAX = 200;
const REASON_MAX = 200;
const GAMES_PAGE = 20;
const LEADERBOARD_WINDOW_DAYS = 90;
const LEADERBOARD_HALF_LIFE_DAYS = 30;
const LEADERBOARD_SIZE = 100;
const LEADERBOARD_CACHE_MS = 60_000;

type Role = "leader" | "officer" | "member";
const RANK: Record<Role, number> = { leader: 0, officer: 1, member: 2 };

interface ClanRow {
  tag: string;
  name: string;
  description: string;
  discord_url: string | null;
  is_open: boolean;
  created_at: Date;
  member_count: number;
}

interface MemberRow {
  persistent_id: string;
  tag: string;
  role: Role;
  joined_at: Date;
}

// ── Data ──

async function getClan(db: Db, tag: string): Promise<ClanRow | null> {
  const r = await db.query<ClanRow>(
    `SELECT c.*, (SELECT count(*) FROM clan_members m WHERE m.tag = c.tag)::int AS member_count
     FROM clans c WHERE c.tag = $1`,
    [tag],
  );
  return r.rows[0] ?? null;
}

async function getMembership(
  db: Db,
  persistentId: string,
): Promise<MemberRow | null> {
  const r = await db.query<MemberRow>(
    "SELECT * FROM clan_members WHERE persistent_id = $1",
    [persistentId],
  );
  return r.rows[0] ?? null;
}

function clanInfo(c: ClanRow) {
  return {
    name: c.name,
    tag: c.tag,
    description: c.description,
    discordUrl: c.discord_url,
    isOpen: c.is_open,
    createdAt: new Date(c.created_at).toISOString(),
    memberCount: c.member_count,
  };
}

/** The clans a player belongs to, for /users/@me and the public profile. */
export async function clansFor(db: Db, persistentId: string) {
  const r = await db.query<{
    tag: string;
    name: string;
    role: Role;
    joined_at: Date;
    member_count: number;
  }>(
    `SELECT c.tag, c.name, m.role, m.joined_at,
            (SELECT count(*) FROM clan_members x WHERE x.tag = c.tag)::int AS member_count
     FROM clan_members m JOIN clans c ON c.tag = m.tag
     WHERE m.persistent_id = $1
     ORDER BY c.tag`,
    [persistentId],
  );
  return r.rows.map((row) => ({
    tag: row.tag,
    name: row.name,
    role: row.role,
    joinedAt: new Date(row.joined_at).toISOString(),
    memberCount: row.member_count,
  }));
}

/** The player's pending join requests, for /users/@me. */
export async function clanRequestsFor(db: Db, persistentId: string) {
  const r = await db.query<{ tag: string; name: string; created_at: Date }>(
    `SELECT c.tag, c.name, q.created_at
     FROM clan_requests q JOIN clans c ON c.tag = q.tag
     WHERE q.persistent_id = $1
     ORDER BY q.created_at`,
    [persistentId],
  );
  return r.rows.map((row) => ({
    tag: row.tag,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

/** Every registered tag, for the game server's ownership check. */
export async function reservedClanTags(db: Db): Promise<string[]> {
  return (
    await db.query<{ tag: string }>("SELECT tag FROM clans ORDER BY tag")
  ).rows.map((r) => r.tag);
}

/**
 * Per-member W/L in every bucket, over the games each member played while
 * wearing this clan's tag. Games without a recorded winner count for nobody.
 */
async function memberStats(
  db: Db,
  tag: string,
): Promise<Map<string, ClanMemberStats>> {
  const rows = (
    await db.query<
      MatchShape & {
        persistent_id: string;
        won: boolean;
        winner_known: boolean;
      }
    >(
      `SELECT mp.persistent_id, mp.won, m.game_mode, m.player_teams, m.ranked_type,
              (m.winner IS NOT NULL) AS winner_known
       FROM match_players mp JOIN matches m ON m.game_id = mp.game_id
       WHERE mp.clan_tag = $1 AND mp.persistent_id IS NOT NULL`,
      [tag],
    )
  ).rows;
  const out = new Map<string, ClanMemberStats>();
  for (const row of rows) {
    if (!row.winner_known) continue;
    let s = out.get(row.persistent_id);
    if (s === undefined) out.set(row.persistent_id, (s = emptyMemberStats()));
    for (const key of memberStatKeys(row)) {
      if (row.won) s[key].wins++;
      else s[key].losses++;
    }
  }
  return out;
}

// ── Validation ──

function normaliseTag(raw: string): string | null {
  return TAG_RE.test(raw) ? raw.toUpperCase() : null;
}

const DISCORD_HOSTS = new Set([
  "discord.gg",
  "www.discord.gg",
  "discord.com",
  "www.discord.com",
  "discordapp.com",
  "www.discordapp.com",
]);

/** "" → null (unset); a recognised invite → https://discord.gg/CODE; else undefined. */
export function normaliseDiscordUrl(input: string): string | null | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return undefined;
  }
  if (!DISCORD_HOSTS.has(url.hostname.toLowerCase())) return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  const code = url.hostname.toLowerCase().endsWith("discord.gg")
    ? parts[0]
    : parts[0] === "invite"
      ? parts[1]
      : undefined;
  if (code === undefined || !/^[A-Za-z0-9-]{2,32}$/.test(code))
    return undefined;
  return `https://discord.gg/${code}`;
}

const pageParams = (req: Request, maxLimit = 100) => {
  const page = Math.max(
    1,
    Number.parseInt(String(req.query.page ?? "1"), 10) || 1,
  );
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.parseInt(String(req.query.limit ?? "20"), 10) || 20),
  );
  return { page, limit, offset: (page - 1) * limit };
};

const TargetSchema = z.object({ targetPublicId: z.string().min(1).max(64) });

// ── Leaderboard (docs/API.md "Clan Leaderboard") ──

interface SessionRow extends MatchShape {
  game_id: string;
  clan_tag: string;
  num_players: number;
  started_at: Date;
  winner_known: boolean;
  clan_players: number;
  won: boolean;
}

export interface ClanLeaderboardEntry {
  clanTag: string;
  games: number;
  wins: number;
  losses: number;
  playerSessions: number;
  weightedWins: number;
  weightedLosses: number;
  weightedWLRatio: number;
}

/** One session's score, straight from the documented formula. */
export function sessionScore(
  s: {
    numTeams: number;
    totalPlayers: number;
    clanPlayers: number;
    won: boolean;
  },
  decay: number,
): number {
  const avgTeamSize = s.totalPlayers / Math.max(1, s.numTeams);
  const clanMemberRatio = s.clanPlayers / Math.max(1e-9, avgTeamSize);
  const weighted = clanMemberRatio * decay;
  const difficulty = Math.max(1, Math.sqrt(Math.max(0, s.numTeams - 1)));
  return s.won ? weighted * difficulty : weighted / difficulty;
}

export async function computeClanLeaderboard(
  db: Db,
  now = new Date(),
): Promise<{ start: string; end: string; clans: ClanLeaderboardEntry[] }> {
  const start = new Date(now.getTime() - LEADERBOARD_WINDOW_DAYS * 86_400_000);
  const rows = (
    await db.query<SessionRow>(
      `SELECT m.game_id, mp.clan_tag, m.game_mode, m.player_teams, m.ranked_type,
              m.num_players, m.started_at, (m.winner IS NOT NULL) AS winner_known,
              count(*)::int AS clan_players, bool_or(mp.won) AS won
       FROM match_players mp
       JOIN matches m ON m.game_id = mp.game_id
       JOIN clans c ON c.tag = mp.clan_tag
       WHERE m.game_type = 'Public' AND m.game_mode = 'Team' AND m.started_at >= $1
       GROUP BY m.game_id, mp.clan_tag, m.game_mode, m.player_teams, m.ranked_type,
                m.num_players, m.started_at, m.winner`,
      [start],
    )
  ).rows;
  const byTag = new Map<string, ClanLeaderboardEntry>();
  for (const s of rows) {
    let e = byTag.get(s.clan_tag);
    if (e === undefined) {
      e = {
        clanTag: s.clan_tag,
        games: 0,
        wins: 0,
        losses: 0,
        playerSessions: 0,
        weightedWins: 0,
        weightedLosses: 0,
        weightedWLRatio: 0,
      };
      byTag.set(s.clan_tag, e);
    }
    e.games++;
    e.playerSessions += s.clan_players;
    if (!s.winner_known) continue;
    const ageDays =
      (now.getTime() - new Date(s.started_at).getTime()) / 86_400_000;
    const decay = Math.pow(
      0.5,
      Math.max(0, ageDays) / LEADERBOARD_HALF_LIFE_DAYS,
    );
    const score = sessionScore(
      {
        numTeams: numTeams(s, s.num_players),
        totalPlayers: s.num_players,
        clanPlayers: s.clan_players,
        won: s.won,
      },
      decay,
    );
    if (s.won) {
      e.wins++;
      e.weightedWins += score;
    } else {
      e.losses++;
      e.weightedLosses += score;
    }
  }
  const clans = [...byTag.values()]
    .map((e) => ({
      ...e,
      weightedWLRatio:
        e.weightedLosses > 0
          ? e.weightedWins / e.weightedLosses
          : e.weightedWins,
    }))
    .sort(
      (a, b) =>
        b.weightedWins - a.weightedWins || a.clanTag.localeCompare(b.clanTag),
    )
    .slice(0, LEADERBOARD_SIZE);
  return { start: start.toISOString(), end: now.toISOString(), clans };
}

// ── Routes ──

export function registerClanRoutes(
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

  /** The clan at :tag or a 404. */
  const clanParam = async (
    req: Request,
    res: Response,
  ): Promise<ClanRow | null> => {
    const tag = normaliseTag(String(req.params.tag ?? ""));
    const clan = tag === null ? null : await getClan(db, tag);
    if (clan === null) res.status(404).json({ error: "clan not found" });
    return clan;
  };

  /** Caller's membership in the clan at or above `minRole`, else 401/403. */
  const requireRole = async (
    req: Request,
    res: Response,
    clan: ClanRow,
    minRole: Role,
  ): Promise<(MemberRow & { caller: Caller }) | null> => {
    const caller = await requireCaller(req, res);
    if (caller === null) return null;
    const m = await getMembership(db, caller.persistentId);
    if (m === null || m.tag !== clan.tag || RANK[m.role] > RANK[minRole]) {
      res.status(403).json({ error: "forbidden" });
      return null;
    }
    return { ...m, caller };
  };

  /** The account named by the body's targetPublicId, or 400/404. */
  const targetAccount = async (req: Request, res: Response) => {
    const body = TargetSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "targetPublicId required" });
      return null;
    }
    const account = await getAccountByPublicId(db, body.data.targetPublicId);
    if (account === null) res.status(404).json({ error: "player not found" });
    return account;
  };

  let leaderboardCache: {
    at: number;
    value: Awaited<ReturnType<typeof computeClanLeaderboard>>;
  } | null = null;

  app.get("/public/clans/leaderboard", async (_req, res) => {
    const now = Date.now();
    if (
      leaderboardCache === null ||
      now - leaderboardCache.at > LEADERBOARD_CACHE_MS
    ) {
      leaderboardCache = { at: now, value: await computeClanLeaderboard(db) };
    }
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      ...leaderboardCache.value,
      total: leaderboardCache.value.clans.length,
      limit: LEADERBOARD_SIZE,
    });
  });

  app.get("/public/clan/:tag/exists", async (req, res) => {
    const tag = normaliseTag(String(req.params.tag ?? ""));
    const clan = tag === null ? null : await getClan(db, tag);
    if (clan === null) {
      res.status(404).json({ error: "clan not found" });
      return;
    }
    res.json({ tag: clan.tag });
  });

  app.get("/clans", async (req, res) => {
    const { page, limit, offset } = pageParams(req);
    const search = String(req.query.search ?? "").trim();
    // The search pattern is $1 in both queries; limit/offset follow it.
    const where =
      search === "" ? "" : "WHERE c.tag ILIKE $1 OR c.name ILIKE $1";
    const filterParams: unknown[] =
      search === "" ? [] : [`%${search.replace(/[%_\\]/g, "\\$&")}%`];
    const pageParamsList = [...filterParams, limit, offset];
    const rows = (
      await db.query<ClanRow>(
        `SELECT c.*, (SELECT count(*) FROM clan_members m WHERE m.tag = c.tag)::int AS member_count
         FROM clans c ${where}
         ORDER BY member_count DESC, c.tag
         LIMIT $${pageParamsList.length - 1} OFFSET $${pageParamsList.length}`,
        pageParamsList,
      )
    ).rows;
    const total = (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM clans c ${where}`,
        filterParams,
      )
    ).rows[0].n;
    res.json({ results: rows.map(clanInfo), total, page, limit });
  });

  app.post("/clans", async (req, res) => {
    const caller = await requireCaller(req, res);
    if (caller === null) return;
    const body = z
      .object({
        tag: z.string(),
        name: z.string().trim().min(1).max(NAME_MAX),
        description: z.string().trim().max(DESCRIPTION_MAX).optional(),
        isOpen: z.boolean().optional(),
        discordUrl: z.string().max(255).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "bad request" });
      return;
    }
    const tag = normaliseTag(body.data.tag);
    if (tag === null || censorPlayer("player", tag).clanTag === null) {
      res.status(400).json({ error: "invalid tag", code: "TAG_INVALID" });
      return;
    }
    let discord: string | null = null;
    if (body.data.discordUrl !== undefined) {
      const d = normaliseDiscordUrl(body.data.discordUrl);
      if (d === undefined) {
        res
          .status(400)
          .json({ error: "invalid discord invite", code: "DISCORD_INVALID" });
        return;
      }
      discord = d;
    }
    if ((await getMembership(db, caller.persistentId)) !== null) {
      res.status(409).json({
        error: "already in a clan",
        message: "Already a member of a clan",
      });
      return;
    }
    if ((await getClan(db, tag)) !== null) {
      res
        .status(409)
        .json({ error: "tag taken", message: "Tag already registered" });
      return;
    }
    await db.query(
      `INSERT INTO clans (tag, name, description, discord_url, is_open)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        tag,
        body.data.name,
        body.data.description ?? "",
        discord,
        body.data.isOpen ?? true,
      ],
    );
    await db.query(
      "INSERT INTO clan_members (persistent_id, tag, role) VALUES ($1, $2, 'leader')",
      [caller.persistentId, tag],
    );
    res.status(201).json(clanInfo((await getClan(db, tag))!));
  });

  app.get("/clans/:tag", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    res.json(clanInfo(clan));
  });

  app.patch("/clans/:tag", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const m = await requireRole(req, res, clan, "officer");
    if (m === null) return;
    const body = z
      .object({
        name: z.string().trim().min(1).max(NAME_MAX).optional(),
        description: z.string().trim().max(DESCRIPTION_MAX).optional(),
        discordUrl: z.string().max(255).optional(),
        isOpen: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "bad request" });
      return;
    }
    if (body.data.isOpen !== undefined && m.role !== "leader") {
      res.status(403).json({ error: "leader only" });
      return;
    }
    const sets: string[] = [];
    const params: unknown[] = [clan.tag];
    const set = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (body.data.name !== undefined) set("name", body.data.name);
    if (body.data.description !== undefined)
      set("description", body.data.description);
    if (body.data.isOpen !== undefined) set("is_open", body.data.isOpen);
    if (body.data.discordUrl !== undefined) {
      const d = normaliseDiscordUrl(body.data.discordUrl);
      if (d === undefined) {
        res
          .status(400)
          .json({ error: "invalid discord invite", code: "DISCORD_INVALID" });
        return;
      }
      set("discord_url", d);
    }
    if (sets.length > 0) {
      await db.query(
        `UPDATE clans SET ${sets.join(", ")} WHERE tag = $1`,
        params,
      );
    }
    res.json(clanInfo((await getClan(db, clan.tag))!));
  });

  app.delete("/clans/:tag", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    if ((await requireRole(req, res, clan, "leader")) === null) return;
    await db.query("DELETE FROM clans WHERE tag = $1", [clan.tag]);
    res.status(204).end();
  });

  // ── Members ──

  app.get("/clans/:tag/members", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const { page, limit, offset } = pageParams(req);
    const caller = await resolveCaller(req);
    const search = String(req.query.search ?? "")
      .trim()
      .toLowerCase();
    const rows = (
      await db.query<{
        persistent_id: string;
        role: Role;
        joined_at: Date;
        public_id: string;
        username: string | null;
      }>(
        `SELECT m.persistent_id, m.role, m.joined_at, a.public_id, a.username
         FROM clan_members m JOIN accounts a ON a.persistent_id = m.persistent_id
         WHERE m.tag = $1`,
        [clan.tag],
      )
    ).rows.filter(
      (r) =>
        search === "" ||
        r.public_id.toLowerCase().includes(search) ||
        (r.username ?? "").toLowerCase().includes(search),
    );
    const stats = await memberStats(db, clan.tag);
    const members = rows.map((r) => ({
      role: r.role,
      joinedAt: new Date(r.joined_at).toISOString(),
      publicId: r.public_id,
      username: r.username,
      stats: stats.get(r.persistent_id) ?? emptyMemberStats(),
      _joined: new Date(r.joined_at).getTime(),
    }));
    const sortMatch = /^(wins|losses)(.+)$/.exec(String(req.query.sort ?? ""));
    const bucket = sortMatch ? sortMatch[2].toLowerCase() : null;
    const field = sortMatch ? (sortMatch[1] as "wins" | "losses") : null;
    if (bucket !== null && field !== null && bucket in emptyMemberStats()) {
      const key = bucket as keyof ClanMemberStats;
      const dir = String(req.query.order ?? "desc") === "asc" ? 1 : -1;
      members.sort(
        (a, b) =>
          dir * (a.stats[key][field] - b.stats[key][field]) ||
          RANK[a.role] - RANK[b.role] ||
          a._joined - b._joined,
      );
    } else {
      const dir = String(req.query.order ?? "asc") === "desc" ? -1 : 1;
      members.sort(
        (a, b) => RANK[a.role] - RANK[b.role] || dir * (a._joined - b._joined),
      );
    }
    let pendingRequests: number | undefined;
    if (caller !== null) {
      const me = await getMembership(db, caller.persistentId);
      if (me !== null && me.tag === clan.tag && me.role !== "member") {
        pendingRequests = (
          await db.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM clan_requests WHERE tag = $1",
            [clan.tag],
          )
        ).rows[0].n;
      }
    }
    res.json({
      results: members
        .slice(offset, offset + limit)
        .map(({ _joined: _j, ...m }) => m),
      total: members.length,
      page,
      limit,
      ...(pendingRequests === undefined ? {} : { pendingRequests }),
    });
  });

  app.post("/clans/:tag/join", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const caller = await requireCaller(req, res);
    if (caller === null) return;
    const existing = await getMembership(db, caller.persistentId);
    if (existing !== null) {
      res.status(409).json({
        error: "already in a clan",
        message:
          existing.tag === clan.tag
            ? "Already a member"
            : "Already a member of a clan",
      });
      return;
    }
    const ban = (
      await db.query<{ reason: string | null }>(
        "SELECT reason FROM clan_bans WHERE tag = $1 AND persistent_id = $2",
        [clan.tag, caller.persistentId],
      )
    ).rows[0];
    if (ban !== undefined) {
      res
        .status(403)
        .json({ error: "banned", code: "BANNED", reason: ban.reason });
      return;
    }
    const pending = await db.query(
      "SELECT 1 FROM clan_requests WHERE tag = $1 AND persistent_id = $2",
      [clan.tag, caller.persistentId],
    );
    if (pending.rows.length > 0) {
      res
        .status(409)
        .json({ error: "request pending", message: "Join request pending" });
      return;
    }
    if (clan.is_open) {
      await db.query(
        "INSERT INTO clan_members (persistent_id, tag, role) VALUES ($1, $2, 'member')",
        [caller.persistentId, clan.tag],
      );
      await db.query("DELETE FROM clan_requests WHERE persistent_id = $1", [
        caller.persistentId,
      ]);
      res.json({ status: "joined" });
      return;
    }
    await db.query(
      "INSERT INTO clan_requests (tag, persistent_id) VALUES ($1, $2)",
      [clan.tag, caller.persistentId],
    );
    res.json({ status: "requested" });
  });

  app.post("/clans/:tag/leave", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const m = await requireRole(req, res, clan, "member");
    if (m === null) return;
    if (m.role === "leader") {
      if (clan.member_count > 1) {
        res.status(409).json({ error: "transfer leadership first" });
        return;
      }
      await db.query("DELETE FROM clans WHERE tag = $1", [clan.tag]);
      res.status(204).end();
      return;
    }
    await db.query("DELETE FROM clan_members WHERE persistent_id = $1", [
      m.persistent_id,
    ]);
    res.status(204).end();
  });

  /** A member of this clan the caller outranks, or 403/404. */
  const outrankedMember = async (
    req: Request,
    res: Response,
    clan: ClanRow,
    me: MemberRow,
  ): Promise<(MemberRow & { public_id: string }) | null> => {
    const account = await targetAccount(req, res);
    if (account === null) return null;
    const target = await getMembership(db, account.persistent_id);
    if (target === null || target.tag !== clan.tag) {
      res.status(404).json({ error: "not a member" });
      return null;
    }
    if (RANK[me.role] >= RANK[target.role]) {
      res.status(403).json({ error: "cannot act on that rank" });
      return null;
    }
    return { ...target, public_id: account.public_id };
  };

  app.post("/clans/:tag/kick", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const me = await requireRole(req, res, clan, "officer");
    if (me === null) return;
    const target = await outrankedMember(req, res, clan, me);
    if (target === null) return;
    await db.query("DELETE FROM clan_members WHERE persistent_id = $1", [
      target.persistent_id,
    ]);
    res.status(204).end();
  });

  app.post("/clans/:tag/promote", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const me = await requireRole(req, res, clan, "leader");
    if (me === null) return;
    const target = await outrankedMember(req, res, clan, me);
    if (target === null) return;
    if (target.role !== "member") {
      res.status(409).json({ error: "already an officer" });
      return;
    }
    await db.query(
      "UPDATE clan_members SET role = 'officer' WHERE persistent_id = $1",
      [target.persistent_id],
    );
    res.status(204).end();
  });

  app.post("/clans/:tag/demote", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const me = await requireRole(req, res, clan, "leader");
    if (me === null) return;
    const target = await outrankedMember(req, res, clan, me);
    if (target === null) return;
    if (target.role !== "officer") {
      res.status(409).json({ error: "not an officer" });
      return;
    }
    await db.query(
      "UPDATE clan_members SET role = 'member' WHERE persistent_id = $1",
      [target.persistent_id],
    );
    res.status(204).end();
  });

  app.post("/clans/:tag/transfer", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const me = await requireRole(req, res, clan, "leader");
    if (me === null) return;
    const target = await outrankedMember(req, res, clan, me);
    if (target === null) return;
    await db.query(
      "UPDATE clan_members SET role = 'officer' WHERE persistent_id = $1",
      [me.persistent_id],
    );
    await db.query(
      "UPDATE clan_members SET role = 'leader' WHERE persistent_id = $1",
      [target.persistent_id],
    );
    res.status(204).end();
  });

  // ── Join requests ──

  app.get("/clans/:tag/requests", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    if ((await requireRole(req, res, clan, "officer")) === null) return;
    const { page, limit, offset } = pageParams(req);
    const rows = (
      await db.query<{
        public_id: string;
        username: string | null;
        created_at: Date;
      }>(
        `SELECT a.public_id, a.username, q.created_at
         FROM clan_requests q JOIN accounts a ON a.persistent_id = q.persistent_id
         WHERE q.tag = $1 ORDER BY q.created_at LIMIT $2 OFFSET $3`,
        [clan.tag, limit, offset],
      )
    ).rows;
    const total = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM clan_requests WHERE tag = $1",
        [clan.tag],
      )
    ).rows[0].n;
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

  app.post("/clans/:tag/requests/approve", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    if ((await requireRole(req, res, clan, "officer")) === null) return;
    const account = await targetAccount(req, res);
    if (account === null) return;
    const removed = await db.query(
      "DELETE FROM clan_requests WHERE tag = $1 AND persistent_id = $2 RETURNING 1",
      [clan.tag, account.persistent_id],
    );
    if (removed.rows.length === 0) {
      res.status(404).json({ error: "no such request" });
      return;
    }
    if ((await getMembership(db, account.persistent_id)) !== null) {
      res.status(409).json({ error: "already in a clan" });
      return;
    }
    await db.query(
      "INSERT INTO clan_members (persistent_id, tag, role) VALUES ($1, $2, 'member')",
      [account.persistent_id, clan.tag],
    );
    await db.query("DELETE FROM clan_requests WHERE persistent_id = $1", [
      account.persistent_id,
    ]);
    res.status(204).end();
  });

  app.post("/clans/:tag/requests/deny", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    if ((await requireRole(req, res, clan, "officer")) === null) return;
    const account = await targetAccount(req, res);
    if (account === null) return;
    const removed = await db.query(
      "DELETE FROM clan_requests WHERE tag = $1 AND persistent_id = $2 RETURNING 1",
      [clan.tag, account.persistent_id],
    );
    if (removed.rows.length === 0) {
      res.status(404).json({ error: "no such request" });
      return;
    }
    res.status(204).end();
  });

  app.post("/clans/:tag/requests/withdraw", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const caller = await requireCaller(req, res);
    if (caller === null) return;
    const removed = await db.query(
      "DELETE FROM clan_requests WHERE tag = $1 AND persistent_id = $2 RETURNING 1",
      [clan.tag, caller.persistentId],
    );
    if (removed.rows.length === 0) {
      res.status(404).json({ error: "no such request" });
      return;
    }
    res.status(204).end();
  });

  // ── Bans ──

  app.post("/clans/:tag/ban", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const me = await requireRole(req, res, clan, "officer");
    if (me === null) return;
    const account = await targetAccount(req, res);
    if (account === null) return;
    const reason = z
      .string()
      .trim()
      .max(REASON_MAX)
      .optional()
      .safeParse((req.body as { reason?: unknown })?.reason);
    if (!reason.success) {
      res.status(400).json({ error: "reason too long" });
      return;
    }
    if (account.persistent_id === me.persistent_id) {
      res.status(400).json({ error: "cannot ban yourself" });
      return;
    }
    const target = await getMembership(db, account.persistent_id);
    if (
      target !== null &&
      target.tag === clan.tag &&
      RANK[me.role] >= RANK[target.role]
    ) {
      res.status(403).json({ error: "cannot act on that rank" });
      return;
    }
    await db.query(
      `INSERT INTO clan_bans (tag, persistent_id, banned_by, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tag, persistent_id) DO UPDATE SET
         banned_by = EXCLUDED.banned_by, reason = EXCLUDED.reason, created_at = now()`,
      [
        clan.tag,
        account.persistent_id,
        me.persistent_id,
        reason.data === undefined || reason.data === "" ? null : reason.data,
      ],
    );
    if (target !== null && target.tag === clan.tag) {
      await db.query("DELETE FROM clan_members WHERE persistent_id = $1", [
        account.persistent_id,
      ]);
    }
    await db.query(
      "DELETE FROM clan_requests WHERE tag = $1 AND persistent_id = $2",
      [clan.tag, account.persistent_id],
    );
    res.status(204).end();
  });

  app.post("/clans/:tag/unban", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    if ((await requireRole(req, res, clan, "officer")) === null) return;
    const account = await targetAccount(req, res);
    if (account === null) return;
    const removed = await db.query(
      "DELETE FROM clan_bans WHERE tag = $1 AND persistent_id = $2 RETURNING 1",
      [clan.tag, account.persistent_id],
    );
    if (removed.rows.length === 0) {
      res.status(404).json({ error: "not banned" });
      return;
    }
    res.status(204).end();
  });

  app.get("/clans/:tag/bans", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    if ((await requireRole(req, res, clan, "officer")) === null) return;
    const { page, limit, offset } = pageParams(req);
    const rows = (
      await db.query<{
        public_id: string;
        username: string | null;
        by_public_id: string | null;
        by_username: string | null;
        reason: string | null;
        created_at: Date;
      }>(
        `SELECT a.public_id, a.username, b.reason, b.created_at,
                o.public_id AS by_public_id, o.username AS by_username
         FROM clan_bans b
         JOIN accounts a ON a.persistent_id = b.persistent_id
         LEFT JOIN accounts o ON o.persistent_id = b.banned_by
         WHERE b.tag = $1 ORDER BY b.created_at DESC LIMIT $2 OFFSET $3`,
        [clan.tag, limit, offset],
      )
    ).rows;
    const total = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM clan_bans WHERE tag = $1",
        [clan.tag],
      )
    ).rows[0].n;
    res.json({
      results: rows.map((r) => ({
        publicId: r.public_id,
        username: r.username,
        bannedBy: r.by_public_id ?? "",
        bannedByUsername: r.by_username,
        reason: r.reason,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      total,
      page,
      limit,
    });
  });

  // ── History ──

  app.get("/clans/:tag/games", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const where: string[] = [
      "EXISTS (SELECT 1 FROM match_players x WHERE x.game_id = m.game_id AND x.clan_tag = $1)",
    ];
    const params: unknown[] = [clan.tag];
    const filter = filterSql(String(req.query.filter ?? ""));
    if (filter !== null) where.push(filter);
    if (typeof req.query.cursor === "string") {
      const cursor = decodeCursor(req.query.cursor);
      if (cursor === null) {
        res.status(400).json({ error: "bad cursor" });
        return;
      }
      params.push(cursor.endedAt, cursor.gameId);
      where.push(
        `(m.ended_at, m.game_id) < ($${params.length - 1}, $${params.length})`,
      );
    }
    params.push(GAMES_PAGE + 1);
    const games = (
      await db.query<
        MatchShape & {
          game_id: string;
          game_map: string;
          started_at: Date;
          ended_at: Date;
          num_players: number;
          winner_known: boolean;
        }
      >(
        `SELECT m.game_id, m.game_mode, m.game_map, m.started_at, m.ended_at,
                m.num_players, m.player_teams, m.ranked_type,
                (m.winner IS NOT NULL) AS winner_known
         FROM matches m WHERE ${where.join(" AND ")}
         ORDER BY m.ended_at DESC, m.game_id DESC LIMIT $${params.length}`,
        params,
      )
    ).rows;
    const page = games.slice(0, GAMES_PAGE);
    const players = new Map<
      string,
      { publicId: string; username: string; verified: boolean; won: boolean }[]
    >();
    if (page.length > 0) {
      const ids = page.map((g) => g.game_id);
      const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
      const rows = (
        await db.query<{
          game_id: string;
          client_id: string;
          username: string;
          won: boolean;
          verified: boolean;
          public_id: string | null;
        }>(
          `SELECT mp.game_id, mp.client_id, mp.username, mp.won, mp.verified, a.public_id
           FROM match_players mp LEFT JOIN accounts a ON a.persistent_id = mp.persistent_id
           WHERE mp.clan_tag = $1 AND mp.game_id IN (${placeholders})
           ORDER BY mp.won DESC, mp.username`,
          [clan.tag, ...ids],
        )
      ).rows;
      for (const r of rows) {
        let list = players.get(r.game_id);
        if (list === undefined) players.set(r.game_id, (list = []));
        list.push({
          publicId: r.public_id ?? r.client_id,
          username: r.username,
          verified: r.verified,
          won: r.won,
        });
      }
    }
    const last = page[page.length - 1];
    res.json({
      results: page.map((g) => {
        const clanPlayers = players.get(g.game_id) ?? [];
        return {
          gameId: g.game_id,
          start: new Date(g.started_at).toISOString(),
          durationSeconds: durationSeconds(g.started_at, g.ended_at),
          map: g.game_map,
          mode: g.game_mode,
          playerTeams: g.player_teams,
          rankedType: g.ranked_type ?? "unranked",
          result: !g.winner_known
            ? "incomplete"
            : clanPlayers.some((p) => p.won)
              ? "victory"
              : "defeat",
          totalPlayers: g.num_players,
          clanPlayers,
        };
      }),
      nextCursor:
        games.length > GAMES_PAGE && last !== undefined
          ? encodeCursor(new Date(last.ended_at), last.game_id)
          : null,
    });
  });

  // ── Currency: FightWars has none, so the ledger is empty and donating fails ──

  app.get("/clans/:tag/donations", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    const { page, limit } = pageParams(req);
    res.json({ results: [], total: 0, page, limit });
  });

  app.post("/clans/:tag/donate", async (req, res) => {
    const clan = await clanParam(req, res);
    if (clan === null) return;
    res.status(400).json({
      error: "clan currency is disabled",
      message: "Clan currency is disabled",
    });
  });
}
