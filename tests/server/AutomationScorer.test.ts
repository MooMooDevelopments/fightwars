import { describe, expect, it } from "vitest";
import {
  AutomationScorer,
  FAST_RATE,
  MACHINE_CV,
  SUPERHUMAN_RATE,
  WINDOW,
} from "../../src/server/AutomationScorer";

/**
 * Automation detection: fast and even is a script; fast and ragged is a
 * hand; slow and even is a metronome nobody minds.
 */
describe("AutomationScorer", () => {
  // Feed WINDOW arrivals with the given gaps (ms), starting at t=0.
  function feed(scorer: AutomationScorer, gaps: (i: number) => number) {
    let t = 0;
    let verdict = null;
    for (let i = 0; i < WINDOW; i++) {
      verdict = scorer.observe("c", t) ?? verdict;
      t += gaps(i);
    }
    return verdict;
  }

  it("says nothing until the window is full", () => {
    const scorer = new AutomationScorer();
    for (let i = 0; i < WINDOW - 1; i++) {
      expect(scorer.observe("c", i * 50)).toBeNull();
    }
    expect(scorer.isFlagged("c")).toBe(false);
  });

  it("flags a machine's timing: fast and even", () => {
    const scorer = new AutomationScorer();
    // 200 ms apart, to the millisecond: five a second, no jitter.
    const verdict = feed(scorer, () => 200);
    expect(verdict?.reason).toBe("machine-timing");
    expect(verdict!.rate).toBeGreaterThanOrEqual(FAST_RATE);
    expect(verdict!.cv).toBeLessThan(MACHINE_CV);
    expect(scorer.isFlagged("c")).toBe(true);
  });

  it("flags a rate no hand sustains, however ragged", () => {
    const scorer = new AutomationScorer();
    // Twelve a second with a third of jitter.
    const verdict = feed(scorer, (i) => 60 + (i % 3) * 25);
    expect(verdict?.reason).toBe("superhuman-rate");
    expect(verdict!.rate).toBeGreaterThanOrEqual(SUPERHUMAN_RATE);
  });

  it("leaves a fast but ragged hand alone", () => {
    const scorer = new AutomationScorer();
    // Five a second on average, gaps swinging between 120 and 280 ms.
    const verdict = feed(scorer, (i) => [120, 200, 280, 200][i % 4]);
    expect(verdict).toBeNull();
    expect(scorer.isFlagged("c")).toBe(false);
  });

  it("leaves a slow metronome alone", () => {
    const scorer = new AutomationScorer();
    // One a second, perfectly even: a player holding a rhythm, not a script.
    const verdict = feed(scorer, () => 1000);
    expect(verdict).toBeNull();
  });

  it("flags a client once, and keeps clients apart", () => {
    const scorer = new AutomationScorer();
    feed(scorer, () => 200);
    expect(scorer.observe("c", 100_000)).toBeNull();
    expect(scorer.verdicts().length).toBe(1);
    expect(scorer.isFlagged("d")).toBe(false);
  });
});
