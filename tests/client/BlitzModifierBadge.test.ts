import { describe, expect, it } from "vitest";
import { getActiveModifiers } from "../../src/client/Utils";

/** The lobby card says "Blitz" the way it says "Doomsday Clock". */
describe("Blitz badge", () => {
  it("surfaces the badge when the modifier is active", () => {
    const mods = getActiveModifiers({ isBlitz: true });
    expect(mods).toHaveLength(1);
    expect(mods[0].badgeKey).toBe("public_game_modifier.blitz");
    expect(mods[0].labelKey).toBe("public_game_modifier.blitz_label");
    expect(mods[0].formattedValue).toBe("4×");
  });

  it("is absent otherwise", () => {
    expect(
      getActiveModifiers({ isCompact: true }).some(
        (m) => m.badgeKey === "public_game_modifier.blitz",
      ),
    ).toBe(false);
  });
});
