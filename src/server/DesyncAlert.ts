/**
 * Desync alerting (FightWars).
 *
 * Upstream tells the disagreeing client and moves on; a silent desync is a
 * dead match nobody notices. Every desync the turn loop finds now also:
 *
 *   1. logs at error level (first event per game) / warn (repeats), with
 *      enough structure to find the match and replay it;
 *   2. increments a process-wide counter that worker metrics export;
 *   3. POSTs a JSON event to DESYNC_WEBHOOK_URL when that env var is set
 *      (fire-and-forget, 5 s timeout, never throws into the turn loop).
 */

export interface DesyncEvent {
  gameID: string;
  turn: number;
  mostCommonHash: number | null;
  outOfSyncClientIDs: readonly string[];
  totalActiveClients: number;
  gitCommit?: string;
}

export interface AlertLogger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

const seenGames = new Set<string>();
let eventCount = 0;

/** Desync events alerted since the process started. */
export function desyncEventCount(): number {
  return eventCount;
}

/** Test hook: forget which games have already alerted. */
export function resetDesyncAlerts(): void {
  seenGames.clear();
  eventCount = 0;
}

export function alertDesync(
  log: AlertLogger,
  event: DesyncEvent,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): void {
  eventCount++;
  const first = !seenGames.has(event.gameID);
  seenGames.add(event.gameID);
  const meta = {
    gameID: event.gameID,
    turn: event.turn,
    mostCommonHash: event.mostCommonHash,
    outOfSync: event.outOfSyncClientIDs.length,
    outOfSyncClientIDs: event.outOfSyncClientIDs.slice(0, 20),
    totalActiveClients: event.totalActiveClients,
    gitCommit: event.gitCommit,
    firstInGame: first,
  };
  if (first) {
    log.error("DESYNC: clients disagree on game state", meta);
  } else {
    log.warn("desync (repeat) in game", meta);
  }

  const url = env.DESYNC_WEBHOOK_URL;
  if (url === undefined || url === "") return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  void fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "desync",
      at: new Date().toISOString(),
      ...meta,
    }),
    signal: controller.signal,
  })
    .catch((err: unknown) => {
      log.warn("desync webhook failed", {
        gameID: event.gameID,
        error: String(err),
      });
    })
    .finally(() => clearTimeout(timer));
}
