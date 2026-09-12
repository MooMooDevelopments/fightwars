import { Colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";
import { PseudoRandom } from "../../core/PseudoRandom";
import { simpleHash } from "../../core/Util";
extend([lchPlugin]);
extend([labPlugin]);

/**
 * How far apart two colors are. Larger is more distinguishable; only relative
 * magnitudes matter to the allocator.
 */
export type ColorDistance = (first: Colord, second: Colord) => number;

/**
 * Default: colord's CIEDE2000, normalized to 0..1. Correct for a palette
 * meant for unimpaired vision.
 */
const defaultDistance: ColorDistance = (first, second) => first.delta(second);

/**
 * Assigns a stable, visually distinct color to each id from a pool, falling
 * back to a larger list once the pool is exhausted. Theme-agnostic: it knows
 * nothing about teams or palettes — a theme supplies the pool and owns any
 * team-color logic.
 *
 * A theme may also supply the distance function. It has to, for the dichromat
 * palettes: "most distinct" measured in ordinary color space picks colors a
 * colorblind player cannot tell apart, which would undo the palette they
 * chose precisely to avoid that.
 */
export class ColorAllocator {
  private availableColors: Colord[];
  private fallbackColors: Colord[];
  private assigned = new Map<string, Colord>();
  private distance: ColorDistance;

  constructor(
    colors: Colord[],
    fallback: Colord[],
    distance: ColorDistance = defaultDistance,
  ) {
    this.availableColors = [...colors];
    this.fallbackColors = [...colors, ...fallback];
    this.distance = distance;
  }

  /**
   * Return the color assigned to `id`, allocating one on first request. New
   * colors are chosen to be as visually distinct as possible from those already
   * handed out (falling back to random selection once the pool is large or
   * exhausted, for performance). Assignments are stable for the allocator's
   * lifetime.
   */
  assignColor(id: string): Colord {
    if (this.assigned.has(id)) {
      return this.assigned.get(id)!;
    }

    if (this.availableColors.length === 0) {
      this.availableColors = [...this.fallbackColors];
    }

    let selectedIndex: number;

    if (this.assigned.size === 0 || this.assigned.size > 50) {
      // Randomly pick the first color if no colors have been assigned yet.
      //
      // Or if more than 50 colors assigned just pick a random one for perf reasons,
      // as selecting a distinct color is O(n^2), and the color palette is mostly exhausted anyways.
      const rand = new PseudoRandom(simpleHash(id));
      selectedIndex = rand.nextInt(0, this.availableColors.length);
    } else {
      const assignedColors = Array.from(this.assigned.values());
      selectedIndex = selectDistinctColorIndex(
        this.availableColors,
        assignedColors,
        this.distance,
      );
    }

    const color = this.availableColors.splice(selectedIndex, 1)[0];
    this.assigned.set(id, color);
    return color;
  }
}

/**
 * Index of the available color that is most different from the
 * already-assigned colors (the one whose nearest assigned neighbor is farthest
 * away). Throws if no colors have been assigned yet.
 */
export function selectDistinctColorIndex(
  availableColors: Colord[],
  assignedColors: Colord[],
  distance: ColorDistance = defaultDistance,
): number {
  if (assignedColors.length === 0) {
    throw new Error("No assigned colors");
  }

  let maxDeltaE = 0;
  let maxIndex = 0;

  for (let i = 0; i < availableColors.length; i++) {
    const color = availableColors[i];
    const deltaE = minDeltaE(color, assignedColors, distance);
    if (deltaE > maxDeltaE) {
      maxDeltaE = deltaE;
      maxIndex = i;
    }
  }
  return maxIndex;
}

/** Smallest distance from `color` to any of the assigned colors. */
function minDeltaE(
  color: Colord,
  assignedColors: Colord[],
  distance: ColorDistance,
) {
  return assignedColors.reduce(
    (min, assigned) => Math.min(min, distance(color, assigned)),
    Infinity,
  );
}
