import { describe, expect, it, vi } from "vitest";
import { getActiveModifiers } from "../../src/client/Utils";
import { GameConfigSchema } from "../../src/core/Schemas";
import { MapPlaylist } from "../../src/server/MapPlaylist";

/**
 * Phase 6 modes in the public rotation (brief §6.7): Battle Royale and
 * Capital Strike roll as special-game modifiers and reach the wire config.
 */
describe("MapPlaylist modes", () => {
  async function specialWith(mods: Record<string, unknown>) {
    const playlist = new MapPlaylist() as any;
    vi.spyOn(playlist, "getRandomSpecialGameModifiers").mockReturnValue(mods);
    return (await playlist.gameConfig("special")) as ReturnType<
      typeof GameConfigSchema.parse
    >;
  }

  it("Battle Royale reaches the config and the lobby card", async () => {
    const config = await specialWith({ isBattleRoyale: true });
    expect(config.battleRoyale).toBe(true);
    expect(config.capitalStrike).toBeUndefined();
    expect(config.publicGameModifiers?.isBattleRoyale).toBe(true);
    expect(GameConfigSchema.safeParse(config).success).toBe(true);
    const badges = getActiveModifiers(config.publicGameModifiers ?? {});
    expect(badges.map((b) => b.badgeKey)).toContain(
      "public_game_modifier.battle_royale",
    );
  });

  it("Capital Strike reaches the config and the lobby card", async () => {
    const config = await specialWith({ isCapitalStrike: true });
    expect(config.capitalStrike).toBe(true);
    expect(config.battleRoyale).toBeUndefined();
    expect(config.publicGameModifiers?.isCapitalStrike).toBe(true);
    expect(GameConfigSchema.safeParse(config).success).toBe(true);
    const badges = getActiveModifiers(config.publicGameModifiers ?? {});
    expect(badges.map((b) => b.badgeKey)).toContain(
      "public_game_modifier.capital_strike",
    );
  });

  it("King of the Hill reaches the config and the lobby card", async () => {
    const config = await specialWith({ isKingOfTheHill: true });
    expect(config.kingOfTheHill).toBe(true);
    expect(config.battleRoyale).toBeUndefined();
    expect(config.publicGameModifiers?.isKingOfTheHill).toBe(true);
    expect(GameConfigSchema.safeParse(config).success).toBe(true);
    const badges = getActiveModifiers(config.publicGameModifiers ?? {});
    expect(badges.map((b) => b.badgeKey)).toContain(
      "public_game_modifier.king_of_the_hill",
    );
  });

  it("a special game without either carries neither", async () => {
    const config = await specialWith({ isRandomSpawn: true });
    expect(config.battleRoyale).toBeUndefined();
    expect(config.capitalStrike).toBeUndefined();
    const badges = getActiveModifiers(config.publicGameModifiers ?? {});
    expect(
      badges.some(
        (b) =>
          b.badgeKey === "public_game_modifier.battle_royale" ||
          b.badgeKey === "public_game_modifier.capital_strike",
      ),
    ).toBe(false);
  });

  it("both are in the pool, and Battle Royale never rolls beside the clock or Blitz", () => {
    const playlist = new MapPlaylist() as any;
    let royale = 0;
    let strike = 0;
    let hill = 0;
    for (let i = 0; i < 600; i++) {
      const mods = playlist.getRandomSpecialGameModifiers([], 3);
      if (mods.isBattleRoyale) {
        royale++;
        expect(mods.isDoomsdayClock).toBeUndefined();
        expect(mods.isBlitz).toBeUndefined();
      }
      if (mods.isCapitalStrike) strike++;
      if (mods.isKingOfTheHill) {
        hill++;
        expect(mods.isDoomsdayClock).toBeUndefined();
        expect(mods.isBattleRoyale).toBeUndefined();
      }
    }
    expect(royale).toBeGreaterThan(0);
    expect(strike).toBeGreaterThan(0);
    expect(hill).toBeGreaterThan(0);
  });
});
