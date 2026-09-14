import { describe, expect, it } from "vitest";
import { INTENT_CAPS, IntentCaps } from "../../src/server/IntentCaps";

/**
 * Spam caps on the social intents: per client, per family, at a rate no
 * player reaches by hand. The game's own intents are never capped.
 */
describe("IntentCaps", () => {
  it("caps a family at its rate and no sooner", () => {
    const caps = new IntentCaps();
    const n = INTENT_CAPS.emoji.tokensPerInterval;
    for (let i = 0; i < n; i++) expect(caps.allow("a", "emoji")).toBe(true);
    expect(caps.allow("a", "emoji")).toBe(false);
  });

  it("keeps clients and families apart", () => {
    const caps = new IntentCaps();
    const n = INTENT_CAPS.emoji.tokensPerInterval;
    for (let i = 0; i <= n; i++) caps.allow("a", "emoji");
    expect(caps.allow("a", "emoji")).toBe(false);
    // Another client, and another family of the same client, are untouched.
    expect(caps.allow("b", "emoji")).toBe(true);
    expect(caps.allow("a", "quick_chat")).toBe(true);
  });

  it("puts every social intent in a family and nothing else", () => {
    for (const type of [
      "emoji",
      "quick_chat",
      "allianceRequest",
      "allianceReject",
      "allianceExtension",
      "breakAlliance",
      "donate_gold",
      "donate_troops",
      "targetPlayer",
      "embargo",
      "embargo_all",
    ] as const) {
      expect(IntentCaps.familyOf(type), type).not.toBeNull();
    }
    for (const type of [
      "attack",
      "build_unit",
      "move_warship",
      "spawn",
      "boat",
    ] as const) {
      expect(IntentCaps.familyOf(type), type).toBeNull();
    }
  });

  it("never caps the game's own intents", () => {
    const caps = new IntentCaps();
    for (let i = 0; i < 500; i++) expect(caps.allow("a", "attack")).toBe(true);
  });
});
