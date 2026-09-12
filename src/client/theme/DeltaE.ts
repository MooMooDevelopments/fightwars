/**
 * CIEDE2000 colour difference in real ΔE units.
 *
 * `colord`'s lab plugin already exposes a `.delta()`, and `ColorAllocator`
 * uses it, but it divides by 100 and then rounds to three decimals — a
 * resolution of 0.1 ΔE. That is fine for "pick the most distant of these
 * few" at runtime; it is not fine for generating a palette by maximising the
 * smallest pairwise distance, where the rounding creates ties that the
 * search then breaks arbitrarily. Palette generation and the tests that
 * police it use this instead, and talk in ΔE units a human can reason about
 * (≈1 is a just-noticeable difference; ≈5 is comfortably distinct).
 *
 * Validated against the 34 reference pairs from Sharma, Wu & Dalal (2005) in
 * tests/client/DeltaE.test.ts.
 */

import { Rgb } from "./Oklch";

export interface Lab {
  l: number;
  a: number;
  b: number;
}

// D65 white point, the one sRGB is defined against.
const WHITE_X = 95.047;
const WHITE_Y = 100.0;
const WHITE_Z = 108.883;

const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** 8-bit sRGB → CIE L*a*b* under D65. */
export function rgbToLab(rgb: Rgb): Lab {
  const linear = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const r = linear(rgb.r);
  const g = linear(rgb.g);
  const b = linear(rgb.b);

  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) * 100;
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) * 100;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) * 100;

  const f = (t: number) =>
    t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  const fx = f(x / WHITE_X);
  const fy = f(y / WHITE_Y);
  const fz = f(z / WHITE_Z);

  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * CIEDE2000 difference between two Lab colours, with the usual kL = kC = kH
 * = 1. Follows Sharma, Wu & Dalal (2005), including the hue-averaging
 * branches that the original paper leaves implicit.
 */
export function deltaE2000(first: Lab, second: Lab): number {
  const { l: l1, a: a1, b: b1 } = first;
  const { l: l2, a: a2, b: b2 } = second;

  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;

  const cBar7 = Math.pow(cBar, 7);
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + Math.pow(25, 7))));

  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);

  const hp = (ap: number, bp: number) => {
    if (ap === 0 && bp === 0) return 0;
    const h = Math.atan2(bp, ap) * RAD;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);

  const dLp = l2 - l1;
  const dCp = c2p - c1p;

  let dhp: number;
  if (c1p * c2p === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * DEG) / 2);

  const lBarP = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;

  let hBarP: number;
  if (c1p * c2p === 0) {
    hBarP = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarP = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hBarP = (h1p + h2p + 360) / 2;
  } else {
    hBarP = (h1p + h2p - 360) / 2;
  }

  const t =
    1 -
    0.17 * Math.cos((hBarP - 30) * DEG) +
    0.24 * Math.cos(2 * hBarP * DEG) +
    0.32 * Math.cos((3 * hBarP + 6) * DEG) -
    0.2 * Math.cos((4 * hBarP - 63) * DEG);

  const dTheta = 30 * Math.exp(-Math.pow((hBarP - 275) / 25, 2));
  const cBarP7 = Math.pow(cBarP, 7);
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + Math.pow(25, 7)));
  const rt = -rc * Math.sin(2 * dTheta * DEG);

  const sl =
    1 +
    (0.015 * Math.pow(lBarP - 50, 2)) / Math.sqrt(20 + Math.pow(lBarP - 50, 2));
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;

  return Math.sqrt(
    Math.pow(dLp / sl, 2) +
      Math.pow(dCp / sc, 2) +
      Math.pow(dHp / sh, 2) +
      rt * (dCp / sc) * (dHp / sh),
  );
}

/** CIEDE2000 between two 8-bit sRGB colours. */
export function rgbDeltaE(first: Rgb, second: Rgb): number {
  return deltaE2000(rgbToLab(first), rgbToLab(second));
}
