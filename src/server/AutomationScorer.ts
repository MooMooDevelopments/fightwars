import { ClientID } from "../core/Schemas";

/**
 * Automation detection over the intent stream (brief §8): superhuman click
 * cadence and machine-regular timing.
 *
 * A hand on a mouse is fast but ragged: a burst of clicks lands at five or
 * six a second with the gaps between them varying by a third or more. A
 * script is fast and even. This keeps the last WINDOW intent arrival times
 * per client and, once the window is full, asks two questions of the gaps:
 * how fast (intents per second over the window) and how even (the
 * coefficient of variation — standard deviation over mean). A client is
 * flagged when it is both fast and even, or when it is faster than any hand
 * for the whole window. Flagging is a verdict for the log and the metrics,
 * not a punishment: the caps and the shadow already bound what a script can
 * do, and a false flag must cost a player nothing.
 *
 * The thresholds were chosen from what the rate limiter already tolerates
 * (ten intents a second) and from how uneven human bursts are; they are
 * exported so a test can sit exactly on either side of them.
 */

/** Arrival times kept per client. */
export const WINDOW = 40;
/** Intents per second over a full window that no hand sustains. */
export const SUPERHUMAN_RATE = 8;
/** Intents per second at which regularity starts to count. */
export const FAST_RATE = 4;
/** Below this coefficient of variation of the gaps, the timing is a machine's. */
export const MACHINE_CV = 0.08;

export interface AutomationVerdict {
  clientID: ClientID;
  rate: number;
  cv: number;
  reason: "superhuman-rate" | "machine-timing";
}

export class AutomationScorer {
  private readonly arrivals = new Map<ClientID, number[]>();
  private readonly flagged = new Map<ClientID, AutomationVerdict>();

  /** Record an intent at `nowMs`; returns a verdict the first time the client is flagged. */
  observe(clientID: ClientID, nowMs: number): AutomationVerdict | null {
    let times = this.arrivals.get(clientID);
    if (times === undefined) {
      times = [];
      this.arrivals.set(clientID, times);
    }
    times.push(nowMs);
    if (times.length > WINDOW) times.shift();
    if (times.length < WINDOW || this.flagged.has(clientID)) return null;

    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    const span = times[times.length - 1] - times[0];
    if (span <= 0) return null;
    const rate = ((times.length - 1) * 1000) / span;
    const mean = span / gaps.length;
    const variance =
      gaps.reduce((acc, g) => acc + (g - mean) * (g - mean), 0) / gaps.length;
    const cv = Math.sqrt(variance) / mean;

    let reason: AutomationVerdict["reason"] | null = null;
    if (rate >= SUPERHUMAN_RATE) reason = "superhuman-rate";
    else if (rate >= FAST_RATE && cv < MACHINE_CV) reason = "machine-timing";
    if (reason === null) return null;

    const verdict = { clientID, rate, cv, reason };
    this.flagged.set(clientID, verdict);
    return verdict;
  }

  isFlagged(clientID: ClientID): boolean {
    return this.flagged.has(clientID);
  }

  verdicts(): AutomationVerdict[] {
    return [...this.flagged.values()];
  }
}
