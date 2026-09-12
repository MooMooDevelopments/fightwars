import { Cosmetics } from "../core/CosmeticSchemas";

/**
 * The resolved cosmetics catalog, split out of Cosmetics.ts so that reading
 * it does not drag that module's tail in with it.
 *
 * Cosmetics.ts owns fetching, purchasing and the modals around both, so it
 * imports Api, Payments and InGameModal — and through them lit-html, which
 * touches the DOM at module scope. WebGLFrameBuilder wants none of that; it
 * wants one synchronous read per frame. Keeping the cache in a leaf module
 * lets the renderer (and the headless perf harness that measures it) depend
 * on the catalog without depending on the store.
 */
let cache: Cosmetics | null = null;

/**
 * Synchronous accessor for the most recently resolved cosmetics. Returns null
 * before the first successful `fetchCosmetics()` call. Useful when a code path
 * cannot await (e.g. WebGL per-frame sync).
 */
export function getCachedCosmetics(): Cosmetics | null {
  return cache;
}

/** Called by Cosmetics.fetchCosmetics once the catalog validates. */
export function setCachedCosmetics(cosmetics: Cosmetics | null): void {
  cache = cosmetics;
}
