/**
 * Per-game turn timing (FightWars, Section 8: "live dashboard for tick
 * time, player count, bandwidth and desync events").
 *
 * The server's "tick" is GameServer.endTurn(): commit the turn, run the
 * desync tally, encode once and broadcast to every active client. This
 * keeps a ring of the most recent turn durations and the bytes sent, and
 * summarises them on demand. Cheap enough to run on every game.
 */

export interface TurnStatsSnapshot {
  /** Turns committed since the game started. */
  turns: number;
  /** Samples in the ring the percentiles are computed from. */
  window: number;
  meanMs: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Turns in the window that took longer than the turn interval. */
  overBudget: number;
  /** Bytes written to client sockets since the game started. */
  bytesOut: number;
  /** Bytes written per second over the window. */
  bytesOutPerSec: number;
}

export class TurnStats {
  private readonly ring: Float64Array;
  private readonly ringBytes: Float64Array;
  private readonly ringAt: Float64Array;
  private head = 0;
  private filled = 0;
  private turns = 0;
  private bytesOut = 0;
  private maxMs = 0;

  constructor(
    private readonly budgetMs: number,
    windowSize = 600,
  ) {
    this.ring = new Float64Array(windowSize);
    this.ringBytes = new Float64Array(windowSize);
    this.ringAt = new Float64Array(windowSize);
  }

  record(durationMs: number, bytes: number, now = Date.now()): void {
    this.turns++;
    this.bytesOut += bytes;
    if (durationMs > this.maxMs) this.maxMs = durationMs;
    this.ring[this.head] = durationMs;
    this.ringBytes[this.head] = bytes;
    this.ringAt[this.head] = now;
    this.head = (this.head + 1) % this.ring.length;
    if (this.filled < this.ring.length) this.filled++;
  }

  snapshot(): TurnStatsSnapshot {
    const n = this.filled;
    if (n === 0) {
      return {
        turns: this.turns,
        window: 0,
        meanMs: 0,
        p50Ms: 0,
        p99Ms: 0,
        maxMs: this.maxMs,
        overBudget: 0,
        bytesOut: this.bytesOut,
        bytesOutPerSec: 0,
      };
    }
    const samples = Array.from(this.ring.subarray(0, n)).sort((a, b) => a - b);
    let sum = 0;
    let over = 0;
    let windowBytes = 0;
    let oldest = Infinity;
    let newest = -Infinity;
    for (let i = 0; i < n; i++) {
      sum += this.ring[i];
      if (this.ring[i] > this.budgetMs) over++;
      windowBytes += this.ringBytes[i];
      if (this.ringAt[i] < oldest) oldest = this.ringAt[i];
      if (this.ringAt[i] > newest) newest = this.ringAt[i];
    }
    const spanSec = Math.max(0.001, (newest - oldest) / 1000);
    const pct = (p: number) =>
      samples[Math.min(n - 1, Math.floor((p / 100) * n))];
    return {
      turns: this.turns,
      window: n,
      meanMs: sum / n,
      p50Ms: pct(50),
      p99Ms: pct(99),
      maxMs: this.maxMs,
      overBudget: over,
      bytesOut: this.bytesOut,
      bytesOutPerSec: n > 1 ? windowBytes / spanSec : 0,
    };
  }
}
