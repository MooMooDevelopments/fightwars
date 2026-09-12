import { describe, expect, test } from "vitest";
import {
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
      expect(zoomLegibility(zoom, BASE_ALPHA)).toEqual({
        politicalStep: 0,
        decorFade: 0,
        fillAlpha: BASE_ALPHA,
      });
    }
  });

  test("leaves the point sample alone until a pixel covers two tiles", () => {
    // Between 1 and 0.5 px/tile the decoration is already fading, but nine
    // taps would only blur a tile that is very nearly a pixel in its own right.
    expect(zoomLegibility(0.9, BASE_ALPHA).politicalStep).toBe(0);
    expect(zoomLegibility(0.6, BASE_ALPHA).politicalStep).toBe(0);
    expect(zoomLegibility(0.9, BASE_ALPHA).decorFade).toBeGreaterThan(0);
  });

  test("spreads the taps over the pixel's footprint", () => {
    // Nine taps span three steps, so the step tracks a third of the footprint.
    expect(zoomLegibility(0.5, BASE_ALPHA).politicalStep).toBe(1); // 2 tiles
    expect(zoomLegibility(0.25, BASE_ALPHA).politicalStep).toBe(1); // 4 tiles
    expect(zoomLegibility(MIN_ZOOM, BASE_ALPHA).politicalStep).toBe(2); // 5
  });

  test("closes the fill up toward opaque, never past it", () => {
    const overview = zoomLegibility(MIN_ZOOM, BASE_ALPHA);
    expect(overview.fillAlpha).toBe(1);
    for (const zoom of [0.9, 0.7, 0.5, 0.3, MIN_ZOOM]) {
      const { fillAlpha } = zoomLegibility(zoom, BASE_ALPHA);
      expect(fillAlpha).toBeGreaterThanOrEqual(BASE_ALPHA);
      expect(fillAlpha).toBeLessThanOrEqual(1);
    }
  });

  test("never lowers an opacity the player chose", () => {
    // A player who set the fill to fully opaque must not have it opened up.
    for (const zoom of [1, 0.7, MIN_ZOOM]) {
      expect(zoomLegibility(zoom, 1).fillAlpha).toBe(1);
    }
  });

  test("holds together below MIN_ZOOM rather than dividing by nothing", () => {
    // Camera clamps, but the policy should not depend on that to stay finite.
    const beyond = zoomLegibility(0, BASE_ALPHA);
    expect(Number.isFinite(beyond.politicalStep)).toBe(true);
    expect(beyond.politicalStep).toBeLessThanOrEqual(4);
    expect(beyond.fillAlpha).toBe(1);
  });
});
