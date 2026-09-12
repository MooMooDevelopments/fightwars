/**
 * Opaque keyset-pagination cursor over (ended_at, game_id) for the history
 * lists. The client round-trips it verbatim; only this file reads it.
 */
export function encodeCursor(endedAt: Date, gameId: string): string {
  return Buffer.from(JSON.stringify([endedAt.getTime(), gameId])).toString(
    "base64url",
  );
}

export function decodeCursor(
  cursor: string,
): { endedAt: Date; gameId: string } | null {
  try {
    const [ms, gameId] = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as [number, string];
    if (typeof ms !== "number" || typeof gameId !== "string") return null;
    return { endedAt: new Date(ms), gameId };
  } catch {
    return null;
  }
}

/** Seconds between two timestamps, never negative. */
export function durationSeconds(start: Date | string, end: Date | string) {
  return Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000),
  );
}
