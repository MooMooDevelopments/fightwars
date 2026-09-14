import { describe, expect, it, vi } from "vitest";

// No language pack is loaded under vitest: make the translation visible.
vi.mock("../../src/client/Utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/Utils")>();
  return {
    ...actual,
    translateText: (key: string, params?: Record<string, string | number>) =>
      params === undefined ? key : `${key}:${Object.values(params).join("/")}`,
  };
});

import { rankedStanding } from "../../src/client/components/RankedModal";

/** The ranked card during placements says how many games are done. */
describe("ranked standing", () => {
  it("says the placement while it is in progress", () => {
    expect(
      rankedStanding({ elo: 1510, placement: { played: 3, of: 10 } }),
    ).toBe("matchmaking_modal.placement:3/10");
  });

  it("is silent once placed, and with no games at all", () => {
    expect(rankedStanding({ elo: 1620 })).toBeNull();
    expect(rankedStanding({})).toBeNull();
    expect(rankedStanding(undefined)).toBeNull();
  });
});
