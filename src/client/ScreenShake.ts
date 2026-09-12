/**
 * A decaying camera shake, in screen pixels.
 *
 * Screen pixels rather than world tiles on purpose: a blast should hit the
 * view with the same force whether the player is zoomed to a city or to a
 * continent. Expressed in tiles it would be invisible zoomed out and violent
 * zoomed in, which is backwards — the further out you are, the less a single
 * detonation deserves.
 *
 * Kept separate from TransformHandler so the curve can be tested without a
 * canvas, and pure so that two callers a frame apart agree about where the
 * camera is.
 */

/** How long a shake lasts. Long enough to feel, short enough not to annoy. */
export const SHAKE_DURATION_MS = 500;

/**
 * Two frequencies rather than one, and different ones per axis, so the motion
 * reads as a jolt rather than as a wobble — a single sine is a pendulum, and
 * the eye recognises it immediately.
 */
const FREQ_X_HZ = 27;
const FREQ_Y_HZ = 19;
const FREQ_WOBBLE_HZ = 7;

export interface ShakeOffset {
  x: number;
  y: number;
}

const NONE: ShakeOffset = { x: 0, y: 0 };

/**
 * Displacement in screen pixels at `elapsedMs` into a shake of peak amplitude
 * `strength` pixels. Zero once the shake is over, and zero for a strength that
 * is zero or negative, so a caller can hold one of these unconditionally.
 */
export function shakeDisplacement(
  elapsedMs: number,
  strength: number,
): ShakeOffset {
  if (strength <= 0 || elapsedMs < 0 || elapsedMs >= SHAKE_DURATION_MS) {
    return NONE;
  }
  // Quadratic decay: most of the movement is in the first half, which is how
  // a real impact behaves and what keeps the tail from reading as a rumble.
  const remaining = 1 - elapsedMs / SHAKE_DURATION_MS;
  const amplitude = strength * remaining * remaining;
  const t = elapsedMs / 1000;
  const wobble = Math.sin(2 * Math.PI * FREQ_WOBBLE_HZ * t);
  return {
    x: amplitude * Math.sin(2 * Math.PI * FREQ_X_HZ * t) * (0.7 + 0.3 * wobble),
    y: amplitude * Math.cos(2 * Math.PI * FREQ_Y_HZ * t) * (0.7 - 0.3 * wobble),
  };
}

/**
 * The live shake. One at a time: a second blast during the first replaces it
 * rather than adding to it, taking whichever is stronger and restarting the
 * decay. A MIRV lands dozens of warheads in a few seconds, and summing those
 * would leave the camera unusable exactly when the player most needs to see.
 */
export class ScreenShake {
  private strength = 0;
  private startedAtMs = 0;

  /** @param strength peak displacement in screen pixels */
  add(strength: number, nowMs: number): void {
    if (strength <= 0) return;
    const current = this.remainingStrength(nowMs);
    if (strength < current) return;
    this.strength = strength;
    this.startedAtMs = nowMs;
  }

  offset(nowMs: number): ShakeOffset {
    return shakeDisplacement(nowMs - this.startedAtMs, this.strength);
  }

  /** True while the camera is still moving, so a caller can skip the work. */
  isActive(nowMs: number): boolean {
    return this.strength > 0 && nowMs - this.startedAtMs < SHAKE_DURATION_MS;
  }

  /**
   * What is left of the running shake, as a peak amplitude. Used to decide
   * whether a new blast is the bigger one; comparing raw strengths would let
   * a small late blast cut off a large one that has barely started.
   */
  private remainingStrength(nowMs: number): number {
    const elapsed = nowMs - this.startedAtMs;
    if (this.strength <= 0 || elapsed >= SHAKE_DURATION_MS) return 0;
    const remaining = 1 - elapsed / SHAKE_DURATION_MS;
    return this.strength * remaining * remaining;
  }
}
