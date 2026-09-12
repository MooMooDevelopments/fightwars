/**
 * Orders the turns a client feeds its simulation.
 *
 * The server numbers turns from 0 and the sim must consume them in order.
 * A socket does not promise that order across a rejoin: after a reload the
 * runner asks the server for a "start" snapshot (every turn so far) while
 * live turns keep streaming, so a turn numbered far ahead of the next
 * expected one arrives before the snapshot that fills the gap. The old
 * runner logged an error and dropped every such turn; that was harmless
 * only because the snapshot always covered them. This holds turns that are
 * ahead and applies them the moment the gap closes, ignores turns already
 * applied, and never applies a turn out of order.
 */
export interface NumberedTurn {
  turnNumber: number;
}

export type OfferResult = "applied" | "held" | "stale";

export class TurnSequencer<T extends NumberedTurn> {
  private next = 0;
  private readonly pending = new Map<number, T>();

  constructor(
    private readonly apply: (turn: T) => void,
    /** Held turns beyond this are discarded oldest-first (a stuck rejoin). */
    private readonly maxPending = 6000,
  ) {}

  /** The turn number the sim expects next (= turns applied so far). */
  get nextTurn(): number {
    return this.next;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * A live turn from the server. Applied when it is the next one (and any
   * held successors with it), held when it is ahead, ignored when stale.
   */
  offer(turn: T): OfferResult {
    if (turn.turnNumber < this.next) return "stale";
    if (turn.turnNumber > this.next) {
      if (!this.pending.has(turn.turnNumber)) {
        if (this.pending.size >= this.maxPending) {
          const oldest = Math.min(...this.pending.keys());
          this.pending.delete(oldest);
        }
        this.pending.set(turn.turnNumber, turn);
      }
      return "held";
    }
    this.apply(turn);
    this.next++;
    this.drain();
    return "applied";
  }

  /**
   * The turns of a "start" snapshot: contiguous from some number at or below
   * the next expected one. Turns already applied are skipped; a hole (never
   * produced by the server, kept for safety) is filled with `empty` turns so
   * numbering stays continuous. Returns how many turns reached the sim.
   */
  applySnapshot(turns: readonly T[], empty: (turnNumber: number) => T): number {
    let applied = 0;
    for (const turn of turns) {
      if (turn.turnNumber < this.next) continue;
      while (turn.turnNumber > this.next) {
        this.apply(empty(this.next));
        this.next++;
        applied++;
      }
      this.apply(turn);
      this.next++;
      applied++;
    }
    applied += this.drain();
    return applied;
  }

  private drain(): number {
    let applied = 0;
    for (;;) {
      const turn = this.pending.get(this.next);
      if (turn === undefined) break;
      this.pending.delete(this.next);
      this.apply(turn);
      this.next++;
      applied++;
    }
    for (const n of this.pending.keys()) {
      if (n < this.next) this.pending.delete(n);
    }
    return applied;
  }
}
