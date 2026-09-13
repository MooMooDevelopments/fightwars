import { describe, expect, test } from "vitest";
import { resizeOffsetShift } from "../../src/client/TransformHandler";

/**
 * The camera centre is derived from the canvas size, so a viewport change
 * moves the view unless something cancels it. On a phone the viewport change
 * that matters is a rotation, and it is a big one.
 */
describe("resizeOffsetShift", () => {
  test("a viewport that does not change does not move the view", () => {
    expect(resizeOffsetShift(812, 812, 1)).toBe(0);
  });

  test("a phone rotating moves the view by most of a World map", () => {
    // The zoom the whole world is first shown at on a 375px-wide phone.
    const scale = 375 / 2000;
    const shift = resizeOffsetShift(375, 812, scale);
    // Over a thousand tiles of a 2000-tile map — which is what used to
    // happen, uncompensated, and left the player looking at empty ocean.
    expect(shift).toBeGreaterThan(1000);
  });

  test("the correction is symmetric, so rotating back returns to the start", () => {
    const scale = 0.5;
    const there = resizeOffsetShift(375, 812, scale);
    const back = resizeOffsetShift(812, 375, scale);
    expect(there + back).toBeCloseTo(0, 10);
  });

  test("the correction shrinks as the player zooms in", () => {
    // Half a screen of pixels is fewer tiles the closer you are.
    const zoomedOut = resizeOffsetShift(375, 812, 0.2);
    const zoomedIn = resizeOffsetShift(375, 812, 4);
    expect(zoomedIn).toBeLessThan(zoomedOut);
    expect(zoomedIn).toBeGreaterThan(0);
  });

  test("survives a scale of zero rather than moving the camera to infinity", () => {
    // A first frame before the scale is known must not strand the map.
    expect(resizeOffsetShift(375, 812, 0)).toBe(0);
    expect(resizeOffsetShift(375, 812, -1)).toBe(0);
    expect(resizeOffsetShift(375, 812, Number.NaN)).toBe(0);
    expect(resizeOffsetShift(375, 812, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
