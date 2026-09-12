/**
 * Ranked matchmaking queue (FightWars API).
 *
 * The contract is the one the existing client and game server already speak:
 *
 *   Client  → WebSocket  /matchmaking/join?instance_id=<id>&mode=1v1|2v2
 *             sends   { type: "join", jwt, clanTag? }
 *             receives{ type: "queue-size", count }
 *                     { type: "match-assignment", gameId }
 *   Worker  → POST /matchmaking/checkin { id, gameId, ccu, instanceId, mode }
 *             every ~5 s with a freshly minted game id; when the queue can
 *             fill a match the reply is { assignment: { players, teams } }
 *             (public ids) and the worker creates that game; the matched
 *             clients are told the same gameId and join it.
 *
 * Pairing is by ladder rating: the queue is sorted and the closest group is
 * taken, with the acceptable gap widening the longer the oldest player has
 * waited. 1v1 matches two players; 2v2 matches four and splits them so the
 * two teams' rating sums are as close as possible.
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { CloseCode } from "../core/CloseCodes";

export type Mode = "1v1" | "2v2";

export interface QueueEntry {
  ws: WebSocket;
  persistentId: string;
  publicId: string;
  rating: number;
  instanceId: string | null;
  joinedAt: number;
}

export interface Assignment {
  players: string[];
  teams: string[][];
}

export interface Resolver {
  /** Turn a join token into an identity, or null to refuse. */
  (
    jwt: string,
    mode: Mode,
  ): Promise<{
    persistentId: string;
    publicId: string;
    rating: number;
  } | null>;
}

const PLAYERS: Record<Mode, number> = { "1v1": 2, "2v2": 4 };
// Rating gap allowed right away, and how much it widens per second waited.
const BASE_GAP = 100;
const GAP_PER_SECOND = 10;
const MAX_GAP = 1500;
const QUEUE_SIZE_INTERVAL_MS = 5000;

export class MatchmakingQueue {
  private readonly queues: Record<Mode, QueueEntry[]> = {
    "1v1": [],
    "2v2": [],
  };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly resolve: Resolver) {}

  /** Attach the WebSocket endpoint to an HTTP server. */
  attach(server: HttpServer, path = "/matchmaking/join"): void {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    server.on(
      "upgrade",
      (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const url = new URL(req.url ?? "/", "http://x");
        if (url.pathname !== path) {
          socket.destroy();
          return;
        }
        const mode = url.searchParams.get("mode");
        if (mode !== "1v1" && mode !== "2v2") {
          socket.destroy();
          return;
        }
        const instanceId = url.searchParams.get("instance_id");
        wss.handleUpgrade(req, socket, head, (ws) => {
          this.onConnection(ws, mode, instanceId);
        });
      },
    );
    this.timer ??= setInterval(
      () => this.broadcastSizes(),
      QUEUE_SIZE_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const mode of Object.keys(this.queues) as Mode[]) {
      for (const e of this.queues[mode])
        e.ws.close(CloseCode.TryAgainLater, "shutdown");
      this.queues[mode] = [];
    }
  }

  size(mode: Mode): number {
    return this.queues[mode].length;
  }

  private onConnection(
    ws: WebSocket,
    mode: Mode,
    instanceId: string | null,
  ): void {
    let entry: QueueEntry | null = null;
    ws.on("message", (data) => {
      void (async () => {
        let msg: { type?: string; jwt?: string };
        try {
          msg = JSON.parse(String(data));
        } catch {
          ws.close(CloseCode.BadRequest, "bad message");
          return;
        }
        if (
          msg.type !== "join" ||
          typeof msg.jwt !== "string" ||
          entry !== null
        ) {
          return;
        }
        const who = await this.resolve(msg.jwt, mode);
        if (who === null) {
          ws.close(CloseCode.Unauthorized, "unauthorized");
          return;
        }
        // One seat per account: a second tab replaces the first.
        this.remove(mode, who.persistentId);
        entry = { ws, ...who, instanceId, joinedAt: Date.now() };
        this.queues[mode].push(entry);
        this.broadcastSizes(mode);
      })();
    });
    ws.on("close", () => {
      if (entry !== null) {
        this.queues[mode] = this.queues[mode].filter((e) => e !== entry);
        this.broadcastSizes(mode);
      }
    });
    ws.on("error", () => ws.close());
  }

  private remove(mode: Mode, persistentId: string): void {
    for (const e of this.queues[mode]) {
      if (e.persistentId === persistentId)
        e.ws.close(CloseCode.Normal, "replaced");
    }
    this.queues[mode] = this.queues[mode].filter(
      (e) => e.persistentId !== persistentId,
    );
  }

  private broadcastSizes(only?: Mode): void {
    for (const mode of Object.keys(this.queues) as Mode[]) {
      if (only !== undefined && mode !== only) continue;
      const msg = JSON.stringify({
        type: "queue-size",
        count: this.queues[mode].length,
      });
      for (const e of this.queues[mode]) {
        if (e.ws.readyState === WebSocket.OPEN) e.ws.send(msg);
      }
    }
  }

  /**
   * A worker offers a game id for `mode`. Returns the assignment when a
   * match can be made now, else null. The matched clients are told the
   * game id and removed from the queue.
   */
  checkin(
    mode: Mode,
    gameId: string,
    instanceId: string | null,
    now = Date.now(),
  ): Assignment | null {
    const eligible = this.queues[mode].filter(
      (e) =>
        e.instanceId === null ||
        instanceId === null ||
        instanceId === undefined ||
        e.instanceId === instanceId,
    );
    const group = pickGroup(eligible, PLAYERS[mode], now);
    if (group === null) return null;
    const teams = splitTeams(group, mode);
    const assignment: Assignment = {
      players: group.map((e) => e.publicId),
      teams: teams.map((t) => t.map((e) => e.publicId)),
    };
    const msg = JSON.stringify({ type: "match-assignment", gameId });
    for (const e of group) {
      if (e.ws.readyState === WebSocket.OPEN) e.ws.send(msg);
    }
    const chosen = new Set(group);
    this.queues[mode] = this.queues[mode].filter((e) => !chosen.has(e));
    this.broadcastSizes(mode);
    return assignment;
  }
}

/** The closest-rated group of `n` whose spread fits the oldest member's patience. */
export function pickGroup(
  entries: readonly QueueEntry[],
  n: number,
  now: number,
): QueueEntry[] | null {
  if (entries.length < n) return null;
  const sorted = [...entries].sort((a, b) => a.rating - b.rating);
  let best: QueueEntry[] | null = null;
  let bestSpread = Infinity;
  for (let i = 0; i + n <= sorted.length; i++) {
    const group = sorted.slice(i, i + n);
    const spread = group[n - 1].rating - group[0].rating;
    const oldest = Math.min(...group.map((e) => e.joinedAt));
    const allowed = Math.min(
      MAX_GAP,
      BASE_GAP + ((now - oldest) / 1000) * GAP_PER_SECOND,
    );
    if (spread <= allowed && spread < bestSpread) {
      best = group;
      bestSpread = spread;
    }
  }
  return best;
}

/** 1v1: one each. 2v2: the split of four with the closest team rating sums. */
export function splitTeams(group: QueueEntry[], mode: Mode): QueueEntry[][] {
  if (mode === "1v1") return [[group[0]], [group[1]]];
  const [a, b, c, d] = group;
  const options: [QueueEntry[], QueueEntry[]][] = [
    [
      [a, b],
      [c, d],
    ],
    [
      [a, c],
      [b, d],
    ],
    [
      [a, d],
      [b, c],
    ],
  ];
  const sum = (t: QueueEntry[]) => t.reduce((s, e) => s + e.rating, 0);
  options.sort(
    (x, y) => Math.abs(sum(x[0]) - sum(x[1])) - Math.abs(sum(y[0]) - sum(y[1])),
  );
  return options[0];
}
