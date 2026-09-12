import { describe, expect, test } from "vitest";
import { deltaE2000, rgbDeltaE, rgbToLab } from "../../src/client/theme/DeltaE";

/**
 * The 34 reference pairs published with Sharma, Wu & Dalal (2005), "The
 * CIEDE2000 color-difference formula: implementation notes, supplementary
 * test data, and mathematical observations". They were chosen to exercise
 * every branch the formula's hue arithmetic has — in particular the pairs
 * that straddle the 0°/360° wrap, which is where naive implementations go
 * wrong without ever looking wrong on ordinary colours.
 *
 * [L1, a1, b1, L2, a2, b2, expected dE00]
 */
const SHARMA: readonly (readonly number[])[] = [
  [50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485, 2.0425],
  [50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485, 2.8615],
  [50.0, 2.8361, -74.02, 50.0, 0.0, -82.7485, 3.4412],
  [50.0, -1.3802, -84.2814, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -1.1848, -84.8006, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -0.9009, -85.5211, 50.0, 0.0, -82.7485, 1.0],
  [50.0, 0.0, 0.0, 50.0, -1.0, 2.0, 2.3669],
  [50.0, -1.0, 2.0, 50.0, 0.0, 0.0, 2.3669],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0009, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.001, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0011, 7.2195],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0012, 7.2195],
  [50.0, -0.001, 2.49, 50.0, 0.0009, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.001, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.0011, -2.49, 4.7461],
  [50.0, 2.5, 0.0, 50.0, 0.0, -2.5, 4.3065],
  [50.0, 2.5, 0.0, 73.0, 25.0, -18.0, 27.1492],
  [50.0, 2.5, 0.0, 61.0, -5.0, 29.0, 22.8977],
  [50.0, 2.5, 0.0, 56.0, -27.0, -3.0, 31.903],
  [50.0, 2.5, 0.0, 58.0, 24.0, 15.0, 19.4535],
  [50.0, 2.5, 0.0, 50.0, 3.1736, 0.5854, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2972, 0.0, 1.0],
  [50.0, 2.5, 0.0, 50.0, 1.8634, 0.5757, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2592, 0.335, 1.0],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
  [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
];

describe("deltaE2000", () => {
  test.each(SHARMA.map((row, i) => [i + 1, row] as const))(
    "matches Sharma reference pair %i",
    (_i, row) => {
      const [l1, a1, b1, l2, a2, b2, expected] = row;
      const got = deltaE2000({ l: l1, a: a1, b: b1 }, { l: l2, a: a2, b: b2 });
      expect(got).toBeCloseTo(expected, 4);
    },
  );

  test("is symmetric", () => {
    for (const [l1, a1, b1, l2, a2, b2] of SHARMA) {
      const forward = deltaE2000(
        { l: l1, a: a1, b: b1 },
        { l: l2, a: a2, b: b2 },
      );
      const back = deltaE2000({ l: l2, a: a2, b: b2 }, { l: l1, a: a1, b: b1 });
      expect(back).toBeCloseTo(forward, 10);
    }
  });

  test("a colour is zero distance from itself", () => {
    expect(rgbDeltaE({ r: 12, g: 200, b: 77 }, { r: 12, g: 200, b: 77 })).toBe(
      0,
    );
  });

  test("would fail if the formula degraded to plain Lab distance", () => {
    // Pair 17 of the reference set: CIE76 gives ~34.7, CIEDE2000 gives 27.15.
    // The assertion above is only meaningful because the two disagree here.
    const first = { l: 50.0, a: 2.5, b: 0.0 };
    const second = { l: 73.0, a: 25.0, b: -18.0 };
    const cie76 = Math.hypot(
      second.l - first.l,
      second.a - first.a,
      second.b - first.b,
    );
    expect(Math.abs(cie76 - deltaE2000(first, second))).toBeGreaterThan(5);
  });
});

describe("rgbToLab", () => {
  test("maps sRGB white to L*=100 and neutral chroma", () => {
    const white = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(white.l).toBeCloseTo(100, 2);
    expect(Math.hypot(white.a, white.b)).toBeLessThan(0.02);
  });

  test("maps black to L*=0", () => {
    expect(rgbToLab({ r: 0, g: 0, b: 0 }).l).toBeCloseTo(0, 6);
  });

  test("greys stay neutral across the ramp", () => {
    for (const v of [32, 64, 128, 192, 224]) {
      const lab = rgbToLab({ r: v, g: v, b: v });
      expect(Math.hypot(lab.a, lab.b)).toBeLessThan(0.02);
    }
  });
});
