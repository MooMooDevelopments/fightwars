/**
 * The FightWars API (Phase 2 of the brief: accounts, ladder, clans — the
 * replacement for the closed-source worker upstream depends on).
 *
 * Routes the game server calls (x-api-key):
 *   GET  /.well-known/jwks.json   public key for JWT verification
 *   GET  /users/@me               account profile for a bearer token
 *   POST /join_verify             name screening (+ Turnstile when configured)
 *   GET  /cosmetics.json          catalogue (empty: FightWars sells nothing)
 *   GET  /reserved_clan_tags      every registered clan tag
 *   POST /custom_tribes           { tribes: [] }
 *   POST /matchmaking/checkin     { assignment? } — ranked queue (Matchmaking.ts)
 *   POST /game/:id                ingest a finished GameRecord → ladder
 *   GET  /game/:id                the stored record, scrubbed of persistent ids
 *
 * Routes the browser calls (CORS with credentials):
 *   POST /auth/guest              { persistentId } → { jwt, expiresIn } + refresh cookie
 *   POST /auth/refresh            cookie → rotated cookie + { jwt, expiresIn }
 *   POST /auth/logout
 *   GET  /public/player/:publicId[/games]   ProfileRoutes.ts
 *   GET  /leaderboard/ranked, /public/leaderboard/:ladder
 *   GET  /public/games, /public/game/:id    GamesRoutes.ts
 *   *    /clans/*, /public/clans/*          ClanRoutes.ts
 *   *    /friends/*                         FriendRoutes.ts
 *   GET  /api/health
 */
import express, { type Express, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { base64urlToUuid } from "../core/Base64";
import { GameRecordSchema, ID, PersistentIdSchema } from "../core/Schemas";
import { replacer } from "../core/Util";
import { censorPlayer } from "../server/Censor";
import {
  createSession,
  ensureAccount,
  getAccount,
  revokeSessions,
  rotateSession,
} from "./Accounts";
import {
  clanRequestsFor,
  clansFor,
  registerClanRoutes,
  reservedClanTags,
} from "./ClanRoutes";
import { Db, openDb } from "./Db";
import { friendPublicIds, registerFriendRoutes } from "./FriendRoutes";
import { registerGamesRoutes } from "./GamesRoutes";
import { loadSigningKeys, SigningKeys, signToken, verifyToken } from "./Keys";
import {
  challengesFor,
  getMatchRecord,
  getRating,
  ingestMatch,
  leaderboard,
  placementOf,
  scrubRecord,
  seasonFrom,
  seasonParam,
} from "./Matches";
import { MatchmakingQueue, type Mode } from "./Matchmaking";
import { migrate } from "./Migrations";
import { registerProfileRoutes } from "./ProfileRoutes";

const REFRESH_COOKIE = "fw_refresh";
const JWT_TTL_SECONDS = 15 * 60;

export interface ApiContext {
  app: Express;
  db: Db;
  keys: SigningKeys;
  issuer: string;
  audience: string;
  /** Ranked queues; call `matchmaking.attach(httpServer)` after listen(). */
  matchmaking: MatchmakingQueue;
  /** The ladder season new results accrue to (LADDER_SEASON). */
  season: string;
}

function issuerFor(domain: string): string {
  return domain === "localhost"
    ? "http://localhost:8787"
    : `https://api.${domain}`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setRefreshCookie(
  res: Response,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  res.setHeader(
    "Set-Cookie",
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}; Path=/auth; HttpOnly; SameSite=Lax; ` +
      `Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`,
  );
}

function clearRefreshCookie(res: Response, secure: boolean): void {
  res.setHeader(
    "Set-Cookie",
    `${REFRESH_COOKIE}=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
  );
}

export async function createApiApp(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ApiContext> {
  const domain = env.DOMAIN ?? "localhost";
  const issuer = env.API_ISSUER ?? issuerFor(domain);
  const audience = domain;
  const isDev = (env.GAME_ENV ?? "dev") === "dev";
  const secureCookies = !isDev;
  const apiKey = env.API_KEY ?? "";
  const corsOrigins = new Set(
    // The loopback aliases give a dev box a second browser origin (its own
    // localStorage, so its own guest account) for two-player tests.
    (
      env.API_CORS_ORIGINS ??
      "http://localhost:9000,http://127.0.0.1:9000,http://[::1]:9000,http://localhost:3000"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const db = await openDb(env);
  await migrate(db);
  const keys = await loadSigningKeys(env);
  const season = seasonFrom(env);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "20mb" }));

  // One structured line per request (API_LOG=false silences it).
  if (env.API_LOG !== "false") {
    app.use((req, res, next) => {
      const startedAt = performance.now();
      res.on("finish", () => {
        console.log(
          JSON.stringify({
            level: "info",
            service: "fightwars-api",
            method: req.method,
            path: req.path,
            status: res.statusCode,
            ms: Math.round(performance.now() - startedAt),
          }),
        );
      });
      next();
    });
  }

  // CORS for the browser client; credentials are needed for the refresh cookie.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined && corsOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Api-Key",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE, OPTIONS",
      );
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Game-server-only routes: the shared secret, when one is configured.
  const requireApiKey = (req: Request, res: Response, next: () => void) => {
    if (apiKey !== "" && req.headers["x-api-key"] !== apiKey) {
      res.status(401).json({ error: "invalid api key" });
      return;
    }
    next();
  };

  // Resolve the caller: a JWT we signed, or (dev only) a raw persistent id —
  // the same rule the game server applies in verifyClientToken.
  const callerFromBearer = async (
    req: Request,
  ): Promise<{ persistentId: string; role?: string } | null> => {
    const auth = req.headers.authorization;
    if (auth === undefined || !auth.startsWith("Bearer ")) return null;
    const token = auth.slice("Bearer ".length).trim();
    let persistentId: string;
    let role: string | undefined;
    if (PersistentIdSchema.safeParse(token).success) {
      if (!isDev) return null;
      persistentId = token;
    } else {
      const v = await verifyToken(keys, token, issuer, audience);
      if (v === null) return null;
      persistentId = base64urlToUuid(v.persistentIdB64);
      role = v.role;
    }
    // Every authenticated caller has an account row (the dev raw-id path
    // can arrive before any /auth/guest call) and is marked seen.
    await ensureAccount(db, persistentId);
    return { persistentId, role };
  };

  const issueJwt = (persistentId: string, role: string | null) =>
    signToken(keys, {
      persistentId,
      issuer,
      audience,
      role: role ?? undefined,
      ttlSeconds: JWT_TTL_SECONDS,
    });

  // Ranked queues: a join token resolves to the account and its ladder rating.
  const matchmaking = new MatchmakingQueue(async (jwt, mode) => {
    let persistentId: string | null;
    if (PersistentIdSchema.safeParse(jwt).success) {
      persistentId = isDev ? jwt : null;
    } else {
      const v = await verifyToken(keys, jwt, issuer, audience);
      persistentId = v === null ? null : base64urlToUuid(v.persistentIdB64);
    }
    if (persistentId === null) return null;
    const account = await ensureAccount(db, persistentId);
    const rating = await getRating(
      db,
      account.persistent_id,
      mode === "1v1" ? "ffa" : "team",
      season,
    );
    return {
      persistentId: account.persistent_id,
      publicId: account.public_id,
      rating: rating?.rating ?? 1500,
    };
  });

  // ── Health / keys ──

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, issuer, db: db.kind });
  });

  app.get("/.well-known/jwks.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ keys: [keys.publicJwk] });
  });

  // ── Auth ──

  app.post("/auth/guest", async (req, res) => {
    const body = z
      .object({ persistentId: PersistentIdSchema })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "persistentId (uuid) required" });
      return;
    }
    const account = await ensureAccount(db, body.data.persistentId);
    const session = await createSession(db, account.persistent_id);
    setRefreshCookie(res, session.token, session.expiresAt, secureCookies);
    res.json({
      jwt: await issueJwt(account.persistent_id, account.role),
      expiresIn: JWT_TTL_SECONDS,
      publicId: account.public_id,
    });
  });

  app.post("/auth/refresh", async (req, res) => {
    const token = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
    if (token === undefined) {
      res.status(401).json({ error: "no session" });
      return;
    }
    const rotated = await rotateSession(db, token);
    if (rotated === null) {
      clearRefreshCookie(res, secureCookies);
      res.status(401).json({ error: "session expired" });
      return;
    }
    setRefreshCookie(res, rotated.token, rotated.expiresAt, secureCookies);
    res.json({
      jwt: await issueJwt(rotated.account.persistent_id, rotated.account.role),
      expiresIn: JWT_TTL_SECONDS,
      publicId: rotated.account.public_id,
    });
  });

  app.post("/auth/logout", async (req, res) => {
    const caller = await callerFromBearer(req);
    if (caller !== null) await revokeSessions(db, caller.persistentId);
    clearRefreshCookie(res, secureCookies);
    res.status(204).end();
  });

  // ── Profile the game server reads at join ──

  app.get("/users/@me", async (req, res) => {
    const caller = await callerFromBearer(req);
    if (caller === null) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const account = await ensureAccount(db, caller.persistentId);
    const [ffa, team, clans, clanRequests, friends, challenges] =
      await Promise.all([
        getRating(db, account.persistent_id, "ffa", season),
        getRating(db, account.persistent_id, "team", season),
        clansFor(db, account.persistent_id),
        clanRequestsFor(db, account.persistent_id),
        friendPublicIds(db, account.persistent_id),
        challengesFor(db, account.persistent_id, new Date()),
      ]);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      user: {},
      ban: null,
      player: {
        publicId: account.public_id,
        adfree: true,
        unlimitedRanked: true,
        canCreatePublicLobbies: true,
        trustTier: "trusted",
        username: account.username,
        flares: [],
        achievements: { singleplayerMap: [] },
        // FightWars (brief §6.7): the live challenges and what this account
        // has done toward each. Cosmetic only — nothing here touches a game.
        challenges,
        leaderboard: {
          oneVone: ffa
            ? {
                elo: Math.round(ffa.rating),
                placement: placementOf(ffa.games) ?? undefined,
              }
            : {},
          twoVtwo: team
            ? {
                elo: Math.round(team.rating),
                placement: placementOf(team.games) ?? undefined,
              }
            : {},
        },
        clans,
        clanRequests,
        friends,
        subscription: null,
      },
    });
  });

  // ── Join screening ──

  app.post("/join_verify", requireApiKey, async (req, res) => {
    const body = z
      .object({
        ip: z.string().optional(),
        token: z.string().nullable().optional(),
        username: z.string(),
        clanTag: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "bad request" });
      return;
    }
    const secret = env.TURNSTILE_SECRET;
    if (secret !== undefined && secret !== "" && body.data.token) {
      const ok = await verifyTurnstile(secret, body.data.token, body.data.ip);
      if (!ok) {
        res.json({ status: "rejected", reason: "turnstile" });
        return;
      }
    }
    const screened = censorPlayer(
      body.data.username,
      body.data.clanTag ?? null,
    );
    res.json({
      status: "approved",
      username: screened.username,
      clanTag:
        screened.clanTag === null ? null : screened.clanTag.toUpperCase(),
    });
  });

  // ── Catalogue stubs: FightWars sells nothing, so these are empty and static ──

  app.get("/cosmetics.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ patterns: {}, flags: {}, effects: {} });
  });
  // The menu's news box and the featured-stream card fetch these from the
  // API; serve the bundled feeds so the client never sees a 404.
  for (const feed of ["news.json", "streams.json"]) {
    app.get(`/${feed}`, (_req, res) => {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.type("application/json").send(bundledFeed(feed));
    });
  }
  app.get("/reserved_clan_tags", async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json(await reservedClanTags(db));
  });
  app.post("/custom_tribes", requireApiKey, (_req, res) => {
    res.json({ tribes: [] });
  });
  app.post("/matchmaking/checkin", requireApiKey, (req, res) => {
    const body = z
      .object({
        gameId: ID,
        mode: z.enum(["1v1", "2v2"]),
        instanceId: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.json({});
      return;
    }
    const assignment = matchmaking.checkin(
      body.data.mode as Mode,
      body.data.gameId,
      body.data.instanceId ?? null,
    );
    res.json(assignment === null ? {} : { assignment });
  });

  // ── Matches / ladder ──

  app.post("/game/:id", requireApiKey, async (req, res) => {
    const id = ID.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "invalid game id" });
      return;
    }
    const record = GameRecordSchema.safeParse(req.body);
    if (!record.success) {
      res.status(400).json({
        error: "invalid game record",
        detail: z.prettifyError(record.error).slice(0, 500),
      });
      return;
    }
    if (record.data.info.gameID !== id.data) {
      res.status(400).json({ error: "game id mismatch" });
      return;
    }
    const result = await ingestMatch(db, record.data, season);
    res.json({ ok: true, ...result });
  });

  app.get("/game/:id", async (req, res) => {
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
    res.setHeader("Cache-Control", "public, max-age=3600");
    res
      .type("application/json")
      .send(JSON.stringify(scrubRecord(record), replacer));
  });

  registerProfileRoutes(app, db, season);
  registerGamesRoutes(app, db);
  registerClanRoutes(app, db, callerFromBearer);
  registerFriendRoutes(app, db, callerFromBearer);

  app.get("/public/leaderboard/:ladder", async (req, res) => {
    const ladder = req.params.ladder;
    if (ladder !== "ffa" && ladder !== "team") {
      res.status(404).json({ error: "unknown ladder" });
      return;
    }
    const limit = Math.min(
      500,
      Number.parseInt(String(req.query.limit ?? "100"), 10) || 100,
    );
    const which = seasonParam(req.query.season) ?? season;
    res.json({
      ladder,
      season: which,
      entries: await leaderboard(db, ladder, which, limit),
    });
  });

  // Useful for the /users/@me dev path and for tests.
  app.get("/api/account", async (req, res) => {
    const caller = await callerFromBearer(req);
    if (caller === null) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const account = await getAccount(db, caller.persistentId);
    res.json(account === null ? null : { publicId: account.public_id });
  });

  // Errors are JSON, never Express's HTML stack page.
  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      _next: (e?: unknown) => void,
    ) => {
      console.error(
        JSON.stringify({
          level: "error",
          service: "fightwars-api",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      if (res.headersSent) return;
      res.status(500).json({ error: "internal error" });
    },
  );

  return { app, db, keys, issuer, audience, matchmaking, season };
}

const feedCache = new Map<string, string>();
/** resources/<name>, read once; an empty object if the file is missing. */
function bundledFeed(name: string): string {
  let body = feedCache.get(name);
  if (body === undefined) {
    try {
      body = readFileSync(
        path.join(__dirname, "../../resources", name),
        "utf8",
      );
    } catch {
      body = name === "news.json" ? "[]" : "{}";
    }
    feedCache.set(name, body);
  }
  return body;
}

async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | undefined,
): Promise<boolean> {
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set("remoteip", ip);
    const r = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form, signal: AbortSignal.timeout(4000) },
    );
    const json = (await r.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
