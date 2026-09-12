// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATING,
  matchResults,
  updateRating,
} from "../../src/api/Glicko2";

describe("Glicko-2", () => {
  it("reproduces the worked example from Glickman's paper", () => {
    // Player 1500/200/0.06 beats 1400/30, loses to 1550/100 and 1700/300
    // (tau = 0.5). Expected: r' = 1464.06, RD' = 151.52, sigma' = 0.05999.
    const next = updateRating({ rating: 1500, rd: 200, volatility: 0.06 }, [
      { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
      { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
      { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
    ]);
    expect(next.rating).toBeCloseTo(1464.06, 1);
    expect(next.rd).toBeCloseTo(151.52, 1);
    expect(next.volatility).toBeCloseTo(0.05999, 4);
  });

  it("inflates RD and keeps the rating when a player sits out", () => {
    const next = updateRating({ rating: 1600, rd: 50, volatility: 0.06 }, []);
    expect(next.rating).toBe(1600);
    expect(next.rd).toBeGreaterThan(50);
    expect(next.volatility).toBe(0.06);
  });

  it("scores a many-player match: winner beats all, losers draw each other", () => {
    const r = matchResults([
      { id: "w", rating: DEFAULT_RATING, won: true },
      { id: "a", rating: DEFAULT_RATING, won: false },
      { id: "b", rating: DEFAULT_RATING, won: false },
    ]);
    expect(r.get("w")!.map((x) => x.score)).toEqual([1, 1]);
    expect(r.get("a")!.map((x) => x.score)).toEqual([0, 0.5]);
    expect(r.get("b")!.map((x) => x.score)).toEqual([0, 0.5]);
    const w = updateRating(DEFAULT_RATING, r.get("w")!);
    const a = updateRating(DEFAULT_RATING, r.get("a")!);
    expect(w.rating).toBeGreaterThan(1500);
    expect(a.rating).toBeLessThan(1500);
    expect(w.rd).toBeLessThan(DEFAULT_RATING.rd);
  });

  it("team wins: teammates have no result against each other", () => {
    const r = matchResults([
      { id: "t1", rating: DEFAULT_RATING, won: true },
      { id: "t2", rating: DEFAULT_RATING, won: true },
      { id: "l1", rating: DEFAULT_RATING, won: false },
    ]);
    expect(r.get("t1")!).toHaveLength(1);
    expect(r.get("l1")!.map((x) => x.score)).toEqual([0, 0]);
  });
});
