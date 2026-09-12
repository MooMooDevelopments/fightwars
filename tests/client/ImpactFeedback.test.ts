import { describe, expect, test } from "vitest";
import { distanceFalloff } from "../../src/client/controllers/ImpactFeedbackController";
import {
  FLASH_DURATION_MS,
  flashIntensity,
  MAX_FLASH_INTENSITY,
} from "../../src/client/render/gl/passes/FlashPass";
import {
  ScreenShake,
  SHAKE_DURATION_MS,
  shakeDisplacement,
} from "../../src/client/ScreenShake";

describe("shakeDisplacement", () => {
  test("is still before it starts and after it ends", () => {
    expect(shakeDisplacement(-1, 20)).toEqual({ x: 0, y: 0 });
    expect(shakeDisplacement(SHAKE_DURATION_MS, 20)).toEqual({ x: 0, y: 0 });
    expect(shakeDisplacement(SHAKE_DURATION_MS + 100, 20)).toEqual({
      x: 0,
      y: 0,
    });
  });

  test("never moves the camera further than it was asked to", () => {
    for (let t = 0; t < SHAKE_DURATION_MS; t += 3) {
      const { x, y } = shakeDisplacement(t, 20);
      expect(Math.abs(x)).toBeLessThanOrEqual(20);
      expect(Math.abs(y)).toBeLessThanOrEqual(20);
    }
  });

  test("dies away rather than holding on", () => {
    const peak = (from: number, to: number) => {
      let m = 0;
      for (let t = from; t < to; t += 2) {
        const { x, y } = shakeDisplacement(t, 20);
        m = Math.max(m, Math.hypot(x, y));
      }
      return m;
    };
    const early = peak(0, SHAKE_DURATION_MS / 4);
    const late = peak((SHAKE_DURATION_MS * 3) / 4, SHAKE_DURATION_MS);
    expect(late).toBeLessThan(early / 4);
  });

  test("does nothing for a strength of zero", () => {
    expect(shakeDisplacement(10, 0)).toEqual({ x: 0, y: 0 });
    expect(shakeDisplacement(10, -5)).toEqual({ x: 0, y: 0 });
  });
});

describe("ScreenShake", () => {
  test("a salvo does not stack into something unusable", () => {
    // Thirty warheads inside one shake: the camera must move like the biggest
    // of them, not like the sum. Sampled across the whole shake that follows
    // the last of them — sampling before it would pass no matter what add did.
    const shake = new ScreenShake();
    const last = 1029;
    for (let i = 0; i < 30; i++) shake.add(5, 1000 + i);
    let peak = 0;
    for (let t = last; t < last + SHAKE_DURATION_MS; t += 2) {
      const { x, y } = shake.offset(t);
      peak = Math.max(peak, Math.abs(x), Math.abs(y));
    }
    expect(peak).toBeGreaterThan(0); // it does shake
    expect(peak).toBeLessThanOrEqual(5); // by one warhead, not thirty
  });

  test("a bigger blast takes over, a smaller one does not", () => {
    const shake = new ScreenShake();
    shake.add(20, 0);
    shake.add(3, 10); // small and late — must not cut the big one short
    expect(shake.isActive(10)).toBe(true);
    const big = Math.hypot(shake.offset(20).x, shake.offset(20).y);

    const other = new ScreenShake();
    other.add(3, 0);
    other.add(20, 10); // bigger — takes over
    expect(other.isActive(SHAKE_DURATION_MS + 5)).toBe(true);
    expect(big).toBeGreaterThan(0);
  });

  test("goes quiet, and says so", () => {
    const shake = new ScreenShake();
    expect(shake.isActive(0)).toBe(false);
    shake.add(20, 0);
    expect(shake.isActive(SHAKE_DURATION_MS - 1)).toBe(true);
    expect(shake.isActive(SHAKE_DURATION_MS)).toBe(false);
    expect(shake.offset(SHAKE_DURATION_MS)).toEqual({ x: 0, y: 0 });
  });
});

describe("flashIntensity", () => {
  test("never hides the map completely, whatever it is asked for", () => {
    expect(flashIntensity(0, 10)).toBeLessThanOrEqual(MAX_FLASH_INTENSITY);
    expect(flashIntensity(0, 1)).toBeLessThanOrEqual(MAX_FLASH_INTENSITY);
  });

  test("clears, and quickly", () => {
    expect(flashIntensity(FLASH_DURATION_MS, 0.5)).toBe(0);
    expect(flashIntensity(FLASH_DURATION_MS / 2, 0.5)).toBeLessThan(
      flashIntensity(0, 0.5) / 4,
    );
  });

  test("does nothing for a strength of zero", () => {
    expect(flashIntensity(0, 0)).toBe(0);
    expect(flashIntensity(-5, 0.5)).toBe(0);
  });
});

describe("distanceFalloff", () => {
  test("is full at the centre and gone past the reach", () => {
    expect(distanceFalloff(0, 1000)).toBe(1);
    expect(distanceFalloff(1500, 1000)).toBe(0);
    expect(distanceFalloff(99999, 1000)).toBe(0);
  });

  test("falls off without a step, so panning past a blast does not pop", () => {
    let previous = 1;
    for (let d = 0; d <= 1500; d += 25) {
      const f = distanceFalloff(d, 1000);
      expect(f).toBeLessThanOrEqual(previous);
      previous = f;
    }
  });

  test("survives a screen with no size", () => {
    expect(distanceFalloff(0, 0)).toBe(0);
  });
});
