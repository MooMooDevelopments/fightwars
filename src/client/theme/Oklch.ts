/**
 * Colour maths for palette generation: OKLCH → sRGB with gamut mapping, and
 * dichromat simulation.
 *
 * Why OKLCH and not the CIE LCh that `colord` already provides: LCh(ab) is
 * perceptually uneven around the blue corner — a fixed chroma step near
 * h≈270° changes appearance far more than the same step near h≈90°, so a
 * palette laid out on an LCh lattice clusters its blues and thins its
 * yellows. OKLab was fitted to fix exactly that, so an evenly walked OKLCH
 * lattice gives an evenly spread set of candidates to sample from.
 *
 * Nothing here is used by the simulation. Colours are render-only; this
 * module exists so palettes can be generated offline (scripts/
 * generatePalettes.ts) and checked in, rather than computed on every client
 * at boot.
 */

export interface Rgb {
  /** 0–255. */
  r: number;
  /** 0–255. */
  g: number;
  /** 0–255. */
  b: number;
}

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** Chroma, 0–~0.37 within sRGB. */
  c: number;
  /** Hue angle in degrees, 0–360. */
  h: number;
}

/** The three dichromacies, plus unimpaired vision. */
export const VISION_TYPES = [
  "normal",
  "protanopia",
  "deuteranopia",
  "tritanopia",
] as const;

export type Vision = (typeof VISION_TYPES)[number];

/** sRGB transfer function: linear-light 0–1 → encoded 0–1. */
function gammaEncode(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** Inverse sRGB transfer function: encoded 0–1 → linear-light 0–1. */
function gammaDecode(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/**
 * OKLCH → linear-light sRGB. Components may fall outside 0–1 when the colour
 * is outside the sRGB gamut; `oklchToHex` maps those back in.
 */
export function oklchToLinearRgb(color: Oklch): {
  r: number;
  g: number;
  b: number;
} {
  const hRad = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(hRad);
  const b = color.c * Math.sin(hRad);

  const lp = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const mp = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const sp = color.l - 0.0894841775 * a - 1.291485548 * b;

  const l = lp * lp * lp;
  const m = mp * mp * mp;
  const s = sp * sp * sp;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/** True when every linear component sits inside the sRGB cube. */
function inGamut(linear: { r: number; g: number; b: number }): boolean {
  const e = 1e-6;
  return (
    linear.r >= -e &&
    linear.r <= 1 + e &&
    linear.g >= -e &&
    linear.g <= 1 + e &&
    linear.b >= -e &&
    linear.b <= 1 + e
  );
}

/** True when the OKLCH colour is representable in sRGB without clipping. */
export function isInSrgbGamut(color: Oklch): boolean {
  return inGamut(oklchToLinearRgb(color));
}

/**
 * OKLCH → 8-bit sRGB. Out-of-gamut colours have their chroma reduced (hue and
 * lightness held) by bisection until they fit, which keeps the hue of a
 * requested colour rather than clipping a channel and skewing it.
 */
export function oklchToRgb(color: Oklch): Rgb {
  let lo = 0;
  let hi = color.c;
  if (!isInSrgbGamut(color)) {
    // 20 halvings resolve chroma to <1e-6, far below a quantisation step.
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (isInSrgbGamut({ ...color, c: mid })) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
  } else {
    lo = color.c;
  }

  const linear = oklchToLinearRgb({ ...color, c: lo });
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  return {
    r: Math.round(gammaEncode(clamp01(linear.r)) * 255),
    g: Math.round(gammaEncode(clamp01(linear.g)) * 255),
    b: Math.round(gammaEncode(clamp01(linear.b)) * 255),
  };
}

/** Lower-case `#rrggbb`. */
export function rgbToHex(rgb: Rgb): string {
  const hex = (n: number) =>
    Math.min(255, Math.max(0, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`;
}

/** `#rrggbb` or `#rgb` → 8-bit sRGB. Throws on anything else. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) throw new Error(`not a hex colour: ${hex}`);
  let body = m[1];
  if (body.length === 3) {
    body = body
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

/** Convenience: OKLCH → `#rrggbb`, gamut-mapped. */
export function oklchToHex(color: Oklch): string {
  return rgbToHex(oklchToRgb(color));
}

/**
 * Machado, Oliveira & Fernandes (2009) dichromat simulation matrices at
 * severity 1.0, applied to linear-light sRGB. Chosen over Brettel's
 * projection because a single matrix per deficiency is enough at full
 * severity and it is the set most tooling agrees on, so a palette that
 * passes here also passes the checkers players are likely to try.
 */
const CVD_MATRICES: Record<Exclude<Vision, "normal">, readonly number[]> = {
  protanopia: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882,
    -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182,
    0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733,
    0.691367, 0.3039,
  ],
};

/**
 * What `rgb` looks like to a viewer with the given deficiency. `normal`
 * returns the colour unchanged, so callers can treat unimpaired vision as a
 * fourth case without branching.
 */
export function simulateVision(rgb: Rgb, vision: Vision): Rgb {
  if (vision === "normal") return rgb;
  const m = CVD_MATRICES[vision];
  const r = gammaDecode(rgb.r / 255);
  const g = gammaDecode(rgb.g / 255);
  const b = gammaDecode(rgb.b / 255);
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  return {
    r: Math.round(gammaEncode(clamp01(m[0] * r + m[1] * g + m[2] * b)) * 255),
    g: Math.round(gammaEncode(clamp01(m[3] * r + m[4] * g + m[5] * b)) * 255),
    b: Math.round(gammaEncode(clamp01(m[6] * r + m[7] * g + m[8] * b)) * 255),
  };
}

/** Hex-in, hex-out form of {@link simulateVision}. */
export function simulateHex(hex: string, vision: Vision): string {
  return rgbToHex(simulateVision(hexToRgb(hex), vision));
}
