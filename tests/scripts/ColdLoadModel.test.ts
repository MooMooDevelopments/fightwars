import { describe, expect, it } from "vitest";
import {
  COLD_LOAD_BUDGET_SECONDS,
  criticalAssets,
  wireSeconds,
} from "../../scripts/coldLoadModel";

/** The cold-load model: what counts as critical, and what the wire costs. */
describe("cold-load model", () => {
  it("collects the page's scripts, stylesheets and preloads once each, in order", () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="/assets/index-abc.css">
      <link rel="modulepreload" crossorigin href="/assets/vendor-def.js">
      <link rel="icon" href="/favicon.ico">
      <script type="module" crossorigin src="/assets/index-ghi.js"></script>
      <script src="https://cdn.example/x.js"></script>
      <script type="module" crossorigin src="/assets/index-ghi.js"></script>
    </head><body></body></html>`;
    expect(criticalAssets(html)).toEqual([
      "/assets/index-abc.css",
      "/assets/vendor-def.js",
      "/assets/index-ghi.js",
      "https://cdn.example/x.js",
    ]);
  });

  it("reads through the built page's template expressions", () => {
    const html =
      '<script type="module" crossorigin src="<%- locals.cdnBaseRaw || "" %>/assets/index-1.js"></script>' +
      '<link rel="stylesheet" crossorigin href="<%- locals.cdnBaseRaw || "" %>/assets/index-1.css">';
    expect(criticalAssets(html)).toEqual([
      "/assets/index-1.js",
      "/assets/index-1.css",
    ]);
  });

  it("models the wire: connect, a round trip per file, and the bytes at 10 Mbps", () => {
    // 1.25 MB gz over 10 Mbps is one second; plus 0.15 connect and two trips.
    expect(wireSeconds([250_000, 1_000_000])).toBeCloseTo(1.25, 5);
    expect(wireSeconds([])).toBeCloseTo(0.2, 5);
    expect(COLD_LOAD_BUDGET_SECONDS).toBe(2.5);
  });
});
