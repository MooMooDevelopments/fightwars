import { describe, expect, it } from "vitest";
import { TurnSequencer } from "../../src/client/TurnSequencer";

type T = { turnNumber: number; tag?: string };
const t = (turnNumber: number, tag?: string): T => ({ turnNumber, tag });
const empty = (turnNumber: number): T => ({ turnNumber, tag: "empty" });

function make() {
  const applied: T[] = [];
  const seq = new TurnSequencer<T>((turn) => applied.push(turn));
  return { seq, applied };
}

describe("TurnSequencer", () => {
  it("applies live turns in order and reports duplicates as stale", () => {
    const { seq, applied } = make();
    expect(seq.offer(t(0))).toBe("applied");
    expect(seq.offer(t(1))).toBe("applied");
    expect(seq.offer(t(1))).toBe("stale");
    expect(seq.offer(t(0))).toBe("stale");
    expect(applied.map((x) => x.turnNumber)).toEqual([0, 1]);
    expect(seq.nextTurn).toBe(2);
  });

  it("holds turns that arrive ahead and releases them when the gap closes", () => {
    const { seq, applied } = make();
    expect(seq.offer(t(2))).toBe("held");
    expect(seq.offer(t(3))).toBe("held");
    expect(seq.pendingCount).toBe(2);
    expect(applied).toEqual([]);
    expect(seq.offer(t(0))).toBe("applied");
    expect(applied.map((x) => x.turnNumber)).toEqual([0]);
    expect(seq.offer(t(1))).toBe("applied");
    expect(applied.map((x) => x.turnNumber)).toEqual([0, 1, 2, 3]);
    expect(seq.pendingCount).toBe(0);
    expect(seq.nextTurn).toBe(4);
  });

  // The rejoin-after-reload case: the runner asks for a snapshot from 0
  // while live turns 1225, 1226, ... keep arriving; then the snapshot lands
  // with turns 0..1226 (the server's view when it handled the rejoin).
  it("applies a snapshot once, then the held live turns beyond it", () => {
    const { seq, applied } = make();
    expect(seq.offer(t(1225, "live"))).toBe("held");
    expect(seq.offer(t(1226, "live"))).toBe("held");
    expect(seq.offer(t(1227, "live"))).toBe("held");
    const snapshot = Array.from({ length: 1227 }, (_, i) => t(i, "snap"));
    expect(seq.applySnapshot(snapshot, empty)).toBe(1228);
    expect(applied).toHaveLength(1228);
    expect(applied[1225].tag).toBe("snap");
    expect(applied[1226].tag).toBe("snap");
    expect(applied[1227].tag).toBe("live");
    expect(seq.nextTurn).toBe(1228);
    expect(seq.pendingCount).toBe(0);
    // A second, overlapping snapshot (a second rejoin) changes nothing.
    expect(seq.applySnapshot(snapshot, empty)).toBe(0);
    expect(seq.offer(t(1228))).toBe("applied");
  });

  it("fills a hole in a snapshot with empty turns so numbering stays continuous", () => {
    const { seq, applied } = make();
    seq.applySnapshot([t(0), t(3)], empty);
    expect(applied.map((x) => [x.turnNumber, x.tag])).toEqual([
      [0, undefined],
      [1, "empty"],
      [2, "empty"],
      [3, undefined],
    ]);
    expect(seq.nextTurn).toBe(4);
  });

  it("bounds the held set, discarding the oldest first", () => {
    const applied: T[] = [];
    const seq = new TurnSequencer<T>((turn) => applied.push(turn), 3);
    for (let n = 10; n < 15; n++) seq.offer(t(n));
    expect(seq.pendingCount).toBe(3);
    seq.applySnapshot(
      Array.from({ length: 12 }, (_, i) => t(i)),
      empty,
    );
    // 10 and 11 came from the snapshot; 12, 13, 14 were the held ones kept.
    expect(applied.map((x) => x.turnNumber)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
  });
});
