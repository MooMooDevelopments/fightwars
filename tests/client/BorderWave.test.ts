import { describe, expect, test } from "vitest";
import {
  isConquest,
  MOTE_DURATION_MS,
  waveRadiusTiles,
} from "../../src/client/render/gl/passes/BorderWavePass";

describe("isConquest", () => {
  test("taking ground off another nation counts", () => {
    expect(isConquest(5, 7)).toBe(true);
  });

  test("growing into unclaimed land does not", () => {
    // This is the rule the whole effect hangs on. Without it the opening two
    // minutes of every game — every player expanding into terra nullius at
    // once — light the entire map up, and the wave stops meaning anything.
    expect(isConquest(0, 7)).toBe(false);
  });

  test("a tile falling out of ownership counts", () => {
    // Fallout clearing a nation off the map is a loss like any other.
    expect(isConquest(5, 0)).toBe(true);
  });

  test("a tile that did not change owner does not", () => {
    expect(isConquest(5, 5)).toBe(false);
    expect(isConquest(0, 0)).toBe(false);
  });
});

describe("waveRadiusTiles", () => {
  test("a mote grows over its life", () => {
    const r = waveRadiusTiles(4);
    expect(r.end).toBeGreaterThan(r.start);
  });

  test("never falls below a pixel, at any zoom", () => {
    // The strategic zoom is where knowing which border is moving matters
    // most, and it is where a world-space mote would otherwise be sub-pixel
    // and flicker instead of glowing.
    for (const zoom of [0.2, 0.5, 1, 4, 20]) {
      const r = waveRadiusTiles(zoom);
      expect(r.start * zoom).toBeGreaterThanOrEqual(1.1);
      expect(r.end * zoom).toBeGreaterThanOrEqual(1.1);
    }
  });

  test("settles to its world-space size once zoomed in", () => {
    expect(waveRadiusTiles(20)).toEqual(waveRadiusTiles(4));
  });

  test("survives a zoom of zero", () => {
    const r = waveRadiusTiles(0);
    expect(r.start).toBeGreaterThan(0);
    expect(r.end).toBeGreaterThan(r.start);
  });
});

describe("mote lifetime", () => {
  test("outlives the tick that spawned it, and not by much", () => {
    // Ticks are 100ms. Shorter than one and a wave would strobe with the
    // tick rate instead of flowing; much longer and a frontier that has
    // stopped moving stays lit.
    expect(MOTE_DURATION_MS).toBeGreaterThan(100);
    expect(MOTE_DURATION_MS).toBeLessThan(1000);
  });
});
