import { describe, expect, test } from "vitest";
import {
  HALO_MIN_PX,
  haloReachTiles,
  haloWiden,
  MAX_HALO_WIDEN,
  MAX_ZOOM,
  MIN_ZOOM,
  overviewFraction,
  zoomLegibility,
} from "../../src/client/render/gl/ZoomLegibility";

/** The default `mapOverlay.territoryAlpha` from render-settings.json. */
const BASE_ALPHA = 0.588;

describe("overviewFraction", () => {
  test("is 0 wherever a tile is at least a pixel across", () => {
    for (const zoom of [1, 1.5, 4, 20, MAX_ZOOM]) {
      expect(overviewFraction(zoom)).toBe(0);
    }
  });

  test("is 1 once the map is being read rather than played on", () => {
    for (const zoom of [0.4, 0.3, MIN_ZOOM]) {
      expect(overviewFraction(zoom)).toBe(1);
    }
  });

  test("rises without a step between the two", () => {
    // A step here would be visible as a snap while the player scrolls.
    const samples = [0.95, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45].map(overviewFraction);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
    expect(samples[0]).toBeLessThan(0.05); // continuous with the 0 side
    expect(samples[samples.length - 1]).toBeGreaterThan(0.95); // and the 1 side
  });
});

describe("zoomLegibility", () => {
  test("changes nothing at the zoom the game is played at", () => {
    // The contract the renderer relies on: zoomed in, this costs nothing and
    // the map is drawn exactly as it was before any of this existed.
    for (const zoom of [1, 2.5, 8, MAX_ZOOM]) {
      expect(zoomLegibility(zoom, 1, BASE_ALPHA)).toEqual({
        politicalStep: 0,
        decorFade: 0,
        fillAlpha: BASE_ALPHA,
      });
    }
  });

  test("leaves the point sample alone until a pixel covers two tiles", () => {
    // Between 1 and 0.5 px/tile the decoration is already fading, but nine
    // taps would only blur a tile that is very nearly a pixel in its own right.
    expect(zoomLegibility(0.9, 1, BASE_ALPHA).politicalStep).toBe(0);
    expect(zoomLegibility(0.6, 1, BASE_ALPHA).politicalStep).toBe(0);
    expect(zoomLegibility(0.9, 1, BASE_ALPHA).decorFade).toBeGreaterThan(0);
  });

  test("spreads the taps over the pixel's footprint", () => {
    // Nine taps span three steps, so the step tracks a third of the footprint.
    expect(zoomLegibility(0.5, 1, BASE_ALPHA).politicalStep).toBe(1); // 2 tiles
    expect(zoomLegibility(0.25, 1, BASE_ALPHA).politicalStep).toBe(1); // 4 tiles
    expect(zoomLegibility(MIN_ZOOM, 1, BASE_ALPHA).politicalStep).toBe(2); // 5
  });

  test("closes the fill up toward opaque, never past it", () => {
    const overview = zoomLegibility(MIN_ZOOM, 1, BASE_ALPHA);
    expect(overview.fillAlpha).toBe(1);
    for (const zoom of [0.9, 0.7, 0.5, 0.3, MIN_ZOOM]) {
      const { fillAlpha } = zoomLegibility(zoom, 1, BASE_ALPHA);
      expect(fillAlpha).toBeGreaterThanOrEqual(BASE_ALPHA);
      expect(fillAlpha).toBeLessThanOrEqual(1);
    }
  });

  test("never lowers an opacity the player chose", () => {
    // A player who set the fill to fully opaque must not have it opened up.
    for (const zoom of [1, 0.7, MIN_ZOOM]) {
      expect(zoomLegibility(zoom, 1, 1).fillAlpha).toBe(1);
    }
  });

  test("holds together below MIN_ZOOM rather than dividing by nothing", () => {
    // Camera clamps, but the policy should not depend on that to stay finite.
    const beyond = zoomLegibility(0, 1, BASE_ALPHA);
    expect(Number.isFinite(beyond.politicalStep)).toBe(true);
    expect(beyond.politicalStep).toBeLessThanOrEqual(4);
    expect(beyond.fillAlpha).toBe(1);
  });

  test("asks the same of a dense screen as of a sparse one", () => {
    // A CSS pixel is the same size to the eye on both, so the same view must
    // get the same treatment — a 2x display must not demand twice the zooming
    // out before the map becomes readable.
    for (const zoom of [1, 0.9, 0.5, MIN_ZOOM]) {
      const one = zoomLegibility(zoom, 1, BASE_ALPHA);
      const two = zoomLegibility(zoom, 2, BASE_ALPHA);
      expect(two.decorFade).toBe(one.decorFade);
      expect(two.fillAlpha).toBe(one.fillAlpha);
    }
  });

  test("takes narrower taps on a denser screen", () => {
    // Twice the rendered pixels means half the tiles under each of them, so
    // the taps have half as far to spread to cover one.
    expect(zoomLegibility(MIN_ZOOM, 1, BASE_ALPHA).politicalStep).toBe(2);
    expect(zoomLegibility(MIN_ZOOM, 2, BASE_ALPHA).politicalStep).toBe(1);
    // Dense enough and there is nothing left to resolve.
    expect(zoomLegibility(0.5, 4, BASE_ALPHA).politicalStep).toBe(0);
  });
});

describe("haloWiden", () => {
  // The two tile-space blooms: the small-player glow on four-tile cells and
  // the fallout bloom on eight.
  const GLOW = 4;
  const FALLOUT = 8;

  test("leaves both halos alone at the zoom the game is played at", () => {
    for (const zoom of [1, 1.5, 4, MAX_ZOOM, Infinity]) {
      expect(haloWiden(zoom, GLOW)).toBe(0);
      expect(haloWiden(zoom, FALLOUT)).toBe(0);
    }
  });

  test("widens until the halo clears the floor, and no further", () => {
    for (const cell of [GLOW, FALLOUT]) {
      for (const zoom of [0.9, 0.7, 0.5, 0.4, 0.3, MIN_ZOOM]) {
        const n = haloWiden(zoom, cell);
        if (n < MAX_HALO_WIDEN) {
          expect(haloReachTiles(n, cell) * zoom).toBeGreaterThanOrEqual(
            HALO_MIN_PX,
          );
        }
        if (n > 0) {
          expect(haloReachTiles(n - 1, cell) * zoom).toBeLessThan(HALO_MIN_PX);
        }
      }
    }
  });

  test("holds the floor at the furthest the camera goes", () => {
    // The guard is not a working limit: MIN_ZOOM must be reachable within it.
    for (const cell of [GLOW, FALLOUT]) {
      const n = haloWiden(MIN_ZOOM, cell);
      expect(n).toBeLessThan(MAX_HALO_WIDEN);
      expect(haloReachTiles(n, cell) * MIN_ZOOM).toBeGreaterThanOrEqual(
        HALO_MIN_PX,
      );
    }
  });

  test("never narrows as the camera pulls out", () => {
    const zooms = [1, 0.9, 0.8, 0.6, 0.5, 0.4, 0.3, MIN_ZOOM];
    for (const cell of [GLOW, FALLOUT]) {
      const ns = zooms.map((z) => haloWiden(z, cell));
      for (let i = 1; i < ns.length; i++) {
        expect(ns[i]).toBeGreaterThanOrEqual(ns[i - 1]);
      }
    }
  });

  test("asks less of a bloom whose cells are already coarser", () => {
    // Eight-tile cells reach twice as far per iteration as four-tile ones.
    for (const zoom of [0.9, 0.5, MIN_ZOOM]) {
      expect(haloWiden(zoom, FALLOUT)).toBeLessThanOrEqual(
        haloWiden(zoom, GLOW),
      );
    }
    expect(haloReachTiles(1, FALLOUT)).toBe(2 * haloReachTiles(1, GLOW));
  });

  test("holds together below MIN_ZOOM rather than looping forever", () => {
    expect(haloWiden(0, GLOW)).toBe(haloWiden(MIN_ZOOM, GLOW));
    expect(haloWiden(-1, FALLOUT)).toBeLessThanOrEqual(MAX_HALO_WIDEN);
  });

  test("stops at the cap when no iteration can reach the floor", () => {
    // Neither real bloom gets here (both clear the floor inside the cap at
    // MIN_ZOOM); a cell too fine to reach it is what exercises the guard.
    expect(haloWiden(MIN_ZOOM, 0.001)).toBe(MAX_HALO_WIDEN);
  });
});
