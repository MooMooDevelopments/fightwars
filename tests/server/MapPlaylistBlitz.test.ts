import { describe, expect, it, vi } from "vitest";
import { GameMapSize } from "../../src/core/game/Game";
import { GameConfigSchema } from "../../src/core/Schemas";
import { MapPlaylist } from "../../src/server/MapPlaylist";

/**
 * Blitz in the public rotation (brief §6.7): a compact map at 4x for five
 * wall-clock minutes, which is twenty game minutes on the timer.
 */
describe("MapPlaylist Blitz", () => {
  async function specialWith(mods: Record<string, unknown>) {
    const playlist = new MapPlaylist() as any;
    vi.spyOn(playlist, "getRandomSpecialGameModifiers").mockReturnValue(mods);
    return (await playlist.gameConfig("special")) as ReturnType<
      typeof GameConfigSchema.parse
    >;
  }

  it("runs at 4x on a compact map with a five-minute clock", async () => {
    const config = await specialWith({ isBlitz: true });
    expect(config.gameSpeed).toBe(4);
    expect(config.gameMapSize).toBe(GameMapSize.Compact);
    expect(config.maxTimerValue).toBe(20);
    expect(config.publicGameModifiers?.isBlitz).toBe(true);
    expect(config.publicGameModifiers?.isCompact).toBe(true);
    expect(GameConfigSchema.safeParse(config).success).toBe(true);
  });

  it("leaves a special game without it at normal speed and no clock", async () => {
    const config = await specialWith({ isRandomSpawn: true });
    expect(config.gameSpeed).toBeUndefined();
    expect(config.maxTimerValue).toBeUndefined();
    expect(config.publicGameModifiers?.isBlitz).toBeUndefined();
  });

  it("is in the pool, and never rolls with a peace time or a doomsday clock", () => {
    const playlist = new MapPlaylist() as any;
    let seen = 0;
    for (let i = 0; i < 400; i++) {
      const mods = playlist.getRandomSpecialGameModifiers([], 3);
      if (mods.isBlitz) {
        seen++;
        expect(mods.isPeaceTime).toBeUndefined();
        expect(mods.isDoomsdayClock).toBeUndefined();
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
