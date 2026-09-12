/**
 * How the map should be drawn at the zoom it is currently being viewed at.
 *
 * Territory is stored and drawn per tile. That is right when a tile is several
 * pixels across, and wrong when a pixel is several tiles across: a point
 * sample of a fragmented frontier shimmers as the camera moves, one-tile
 * borders fall below a pixel and disappear, and patterns and skins — detail
 * meant to be read at arm's length — become noise. Zoomed out, the map should
 * read the way a political map reads: flat national colours, visible edges.
 *
 * This module owns the thresholds and nothing else. The passes read the
 * numbers it returns and push them to the GPU; keeping the policy here means
 * it can be reasoned about and tested without a GL context, which is the only
 * part of the renderer that can be.
 *
 * `zoom` throughout is the camera's pixels-per-tile, clamped to [0.2, 20] by
 * Camera and TransformHandler alike.
 */

/** Camera.zoom bounds, mirrored so the policy can be reasoned about alone. */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 20;

export interface ZoomLegibility {
  /**
   * Spacing in tiles between the nine taps the political-owner resolve uses,
   * spread over the pixel's own footprint. 0 disables it: at this zoom a tile
   * is at least a pixel, so the point sample is already the honest answer and
   * the taps would only cost.
   */
  politicalStep: number;
  /**
   * How far to fade patterns and skins out, 0..1. They are per-tile detail;
   * below a pixel per tile they are indistinguishable from noise, and they
   * are what stops a large holding from reading as one colour.
   */
  decorFade: number;
  /**
   * Territory fill opacity, overriding `mapOverlay.territoryAlpha`. Zoomed
   * out, terrain showing through the fill is what turns a block back into
   * speckle, so the fill closes up toward opaque.
   */
  fillAlpha: number;
}

/**
 * Below this many pixels per tile a tile is smaller than a pixel and the
 * per-tile treatment starts to cost more than it gives.
 */
const DETAIL_ZOOM = 1;

/**
 * At and below this, the map is being read as a whole rather than played on,
 * and the political treatment is at full strength. Roughly the zoom at which
 * a 2000-tile map first fits on a laptop screen.
 */
const OVERVIEW_ZOOM = 0.4;

/**
 * Fewest tiles a pixel must cover before the taps are worth taking. Below
 * two, the point sample and the majority disagree too rarely to pay nine
 * texture fetches for, and resolving anyway would blur a tile that is very
 * nearly a pixel in its own right.
 */
const MIN_TILES_PER_PIXEL = 2;

/**
 * Largest tap spacing. A guard rather than a working limit: MIN_ZOOM of 0.2
 * caps the footprint at five tiles, which asks for a step of 2, so this only
 * binds if the camera is ever allowed further out.
 */
const MAX_STEP = 4;

/**
 * 0 at `DETAIL_ZOOM` and above, 1 at `OVERVIEW_ZOOM` and below, smooth
 * between — the same shape as a shader smoothstep, computed here so the
 * thresholds live in one place.
 */
export function overviewFraction(zoom: number): number {
  if (zoom >= DETAIL_ZOOM) return 0;
  if (zoom <= OVERVIEW_ZOOM) return 1;
  const t = (DETAIL_ZOOM - zoom) / (DETAIL_ZOOM - OVERVIEW_ZOOM);
  return t * t * (3 - 2 * t);
}

/**
 * @param zoom pixels per tile
 * @param baseFillAlpha `mapOverlay.territoryAlpha` — the opacity the fill has
 *   when zoomed in, which this only ever raises
 */
export function zoomLegibility(
  zoom: number,
  baseFillAlpha: number,
): ZoomLegibility {
  const overview = overviewFraction(zoom);
  if (overview === 0) {
    return { politicalStep: 0, decorFade: 0, fillAlpha: baseFillAlpha };
  }

  // Nine taps span three steps across, so a step of a third of the footprint
  // covers the pixel without reaching past it into a neighbour's tiles.
  const tilesPerPixel = 1 / Math.max(zoom, MIN_ZOOM);
  const politicalStep =
    tilesPerPixel < MIN_TILES_PER_PIXEL
      ? 0
      : Math.min(MAX_STEP, Math.max(1, Math.round(tilesPerPixel / 3)));

  return {
    politicalStep,
    decorFade: overview,
    fillAlpha: baseFillAlpha + (1 - baseFillAlpha) * overview,
  };
}
