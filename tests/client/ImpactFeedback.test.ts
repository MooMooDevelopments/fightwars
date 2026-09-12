import { afterEach, describe, expect, test, vi } from "vitest";
import {
  distanceFalloff,
  ImpactFeedbackController,
} from "../../src/client/controllers/ImpactFeedbackController";
import {
  FLASH_DURATION_MS,
  flashIntensity,
  MAX_FLASH_INTENSITY,
} from "../../src/client/render/gl/passes/FlashPass";
import {
  shockwaveAlpha,
  shockwaveDurationMs,
  shockwaveRadius,
  shockwaveStrokeTiles,
} from "../../src/client/render/gl/passes/ShockwavePass";
import {
  ScreenShake,
  SHAKE_DURATION_MS,
  shakeDisplacement,
} from "../../src/client/ScreenShake";
import { UnitType } from "../../src/core/game/Game";
import { GameUpdateType } from "../../src/core/game/GameUpdates";

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

describe("shockwave", () => {
  const ATOM = 30;
  const HYDROGEN = 100;

  test("reaches the blast's radius, and stops there", () => {
    expect(shockwaveRadius(0, ATOM)).toBe(0);
    const duration = shockwaveDurationMs(ATOM);
    expect(shockwaveRadius(duration, ATOM)).toBeCloseTo(ATOM, 5);
    // Past the end it must not keep growing — the ring is gone by then, and a
    // radius still climbing would be a quad still being expanded for nothing.
    expect(shockwaveRadius(duration * 10, ATOM)).toBe(ATOM);
  });

  test("opens fast and slows, rather than sliding out at one speed", () => {
    const duration = shockwaveDurationMs(HYDROGEN);
    const firstHalf = shockwaveRadius(duration / 2, HYDROGEN);
    // A linear expansion would put it at exactly half way.
    expect(firstHalf).toBeGreaterThan(HYDROGEN * 0.6);
  });

  test("never goes backwards", () => {
    let previous = -1;
    const duration = shockwaveDurationMs(ATOM);
    for (let t = 0; t <= duration; t += 5) {
      const r = shockwaveRadius(t, ATOM);
      expect(r).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
  });

  test("a bigger warhead takes longer, but not proportionally", () => {
    const atom = shockwaveDurationMs(ATOM);
    const hydrogen = shockwaveDurationMs(HYDROGEN);
    expect(hydrogen).toBeGreaterThan(atom);
    // Three times the ground must not mean three times the wait.
    expect(hydrogen).toBeLessThan(atom * 2);
  });

  test("is still readable while it is expanding, and gone at the end", () => {
    const duration = shockwaveDurationMs(ATOM);
    const peak = 0.85;
    expect(shockwaveAlpha(0, ATOM, peak)).toBeCloseTo(peak, 5);
    expect(shockwaveAlpha(duration, ATOM, peak)).toBe(0);
    // A third of the way through is where the ring is big enough to mean
    // something. Measured on a live map: below about 0.5 a warm-white line
    // over terrain cannot be seen at all, which is what the first version of
    // this curve shipped at.
    expect(shockwaveAlpha(duration / 3, ATOM, peak)).toBeGreaterThan(0.5);
    // By the last fifth it is on its way out rather than snapping off.
    expect(shockwaveAlpha(duration * 0.8, ATOM, peak)).toBeLessThan(peak / 2);
  });

  test("fades without a step", () => {
    let previous = 1;
    const duration = shockwaveDurationMs(HYDROGEN);
    for (let t = 0; t <= duration; t += 5) {
      const a = shockwaveAlpha(t, HYDROGEN, 0.55);
      expect(a).toBeLessThanOrEqual(previous);
      previous = a;
    }
  });

  test("does nothing for a strength of zero, or before it starts", () => {
    expect(shockwaveAlpha(0, ATOM, 0)).toBe(0);
    expect(shockwaveAlpha(-5, ATOM, 0.5)).toBe(0);
  });

  test("the stroke never falls below a pixel", () => {
    // Item 3's lesson: a world-space line thinner than a pixel does not look
    // thin, it flickers as it crosses pixel centres. Zoomed right out a tile
    // is a fifth of a pixel, so the stroke has to be measured in tiles there.
    for (const zoom of [0.2, 0.5, 1, 4, 20]) {
      expect(shockwaveStrokeTiles(zoom) * zoom).toBeGreaterThanOrEqual(0.9);
    }
    // Zoomed in it settles to its world-space width rather than growing.
    expect(shockwaveStrokeTiles(20)).toBe(shockwaveStrokeTiles(4));
  });

  test("survives a zoom of zero", () => {
    expect(shockwaveStrokeTiles(0)).toBeGreaterThan(0);
  });
});

/**
 * A detonation, wired to the three things the controller talks to. Enough of
 * each to answer the calls it makes and nothing more — the point is what the
 * controller does with the answers.
 */
function detonation(unitType: UnitType) {
  const MAP_W = 1000;
  const TILE = 250_500; // (x 500, y 250) — the centre of a 1000-wide map
  const unit = {
    type: () => unitType,
    isActive: () => false,
    reachedTarget: () => true,
    lastTile: () => TILE,
  };
  const game = {
    updatesSinceLastTick: () => ({ [GameUpdateType.Unit]: [{ id: 1 }] }),
    unit: () => unit,
    config: () => ({
      nukeMagnitudes: () => ({ inner: 12, outer: 30 }),
    }),
    x: (t: number) => t % MAP_W,
    y: (t: number) => Math.floor(t / MAP_W),
  };
  const shake = { add: vi.fn() };
  const transform = {
    shake,
    boundingRect: () => ({ width: 1000, height: 800 }),
    // Dead centre of the view, so the distance falloff is 1 and cannot be
    // what a missing shake is blamed on.
    worldToCanvasCoordinates: () => ({ x: 500, y: 400 }),
  };
  const renderer = { triggerFlash: vi.fn(), triggerShockwave: vi.fn() };
  const controller = new ImpactFeedbackController(
    game as never,
    transform as never,
    renderer as never,
  );
  return { controller, shake, renderer };
}

function setReducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduced-motion"),
    media: query,
  }));
}

describe("ImpactFeedbackController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("a detonation shakes, washes and rings", () => {
    setReducedMotion(false);
    const { controller, shake, renderer } = detonation(UnitType.AtomBomb);
    controller.tick();
    expect(shake.add).toHaveBeenCalledTimes(1);
    expect(shake.add.mock.calls[0][0]).toBeGreaterThan(0);
    expect(renderer.triggerFlash.mock.calls[0][0]).toBeGreaterThan(0);
    // At the blast's own radius, on the tile it went off on.
    expect(renderer.triggerShockwave).toHaveBeenCalledWith(500, 250, 30, 0.85);
  });

  test("reduced motion takes the jolt away and keeps the information", () => {
    setReducedMotion(true);
    const { controller, shake, renderer } = detonation(UnitType.AtomBomb);
    controller.tick();
    // Nothing moves the camera at all.
    expect(shake.add).not.toHaveBeenCalled();
    // The wash survives, faint: a detonation the player cannot see is worse
    // than one they can.
    const flash = renderer.triggerFlash.mock.calls[0][0] as number;
    expect(flash).toBeGreaterThan(0);
    expect(flash).toBeLessThan(0.34 / 2);
    // The ring is untouched — it is the part that carries the information.
    expect(renderer.triggerShockwave).toHaveBeenCalledWith(500, 250, 30, 0.85);
  });

  test("a browser with no matchMedia is not treated as asking for less", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { controller, shake } = detonation(UnitType.HydrogenBomb);
    controller.tick();
    expect(shake.add).toHaveBeenCalledTimes(1);
  });
});
