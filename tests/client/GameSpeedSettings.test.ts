import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/DesktopPresence", () => ({
  desktopPresence: {
    isAvailable: vi.fn(() => false),
    openInviteDialog: vi.fn(async () => true),
    set: vi.fn(),
    consumePendingInvite: vi.fn(async () => null),
    subscribeInvites: vi.fn(() => () => undefined),
  },
}));

// The map cards lazy-load through an IntersectionObserver jsdom lacks.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(
  globalThis as unknown as { IntersectionObserver: unknown }
).IntersectionObserver ??= NoopObserver;

import "../../src/client/components/GameConfigSettings";
import {
  GAME_SPEEDS,
  GameConfigSettings,
} from "../../src/client/components/GameConfigSettings";
import { HostLobbyModal } from "../../src/client/HostLobbyModal";
import { Difficulty, GameMapType, GameMode } from "../../src/core/game/Game";

/** The game-speed selector: three cards, an event, and a host who pushes it. */
describe("game speed in the lobby", () => {
  it("offers normal, fast and Blitz, and says which is chosen", async () => {
    const el = document.createElement(
      "game-config-settings",
    ) as GameConfigSettings;
    el.settings = {
      map: { selected: GameMapType.World, useRandom: false },
      difficulty: { selected: Difficulty.Medium, disabled: false },
      gameMode: { selected: GameMode.FFA },
      gameSpeed: { selected: 4 },
      teamCount: { selected: 2 },
      options: {
        titleKey: "game_settings.options",
        bots: { value: 0, labelKey: "x", disabledKey: "y" },
        toggles: [],
        inputCards: [],
      },
      unitTypes: { titleKey: "x", disabledUnits: [] },
    } as unknown as GameConfigSettings["settings"];
    document.body.appendChild(el);
    await el.updateComplete;
    const buttons = [
      ...el.querySelectorAll<HTMLButtonElement>("[data-game-speed]"),
    ];
    expect(buttons.map((b) => Number(b.dataset.gameSpeed))).toEqual([
      ...GAME_SPEEDS,
    ]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    const emitted: number[] = [];
    el.addEventListener("game-speed-selected", (e) =>
      emitted.push((e as CustomEvent<{ speed: number }>).detail.speed),
    );
    buttons[1].click();
    expect(emitted).toEqual([2]);
    el.remove();
  });

  it("stays out of a view that does not offer it", async () => {
    const el = document.createElement(
      "game-config-settings",
    ) as GameConfigSettings;
    el.settings = {
      map: { selected: GameMapType.World, useRandom: false },
      difficulty: { selected: Difficulty.Medium, disabled: false },
      gameMode: { selected: GameMode.FFA },
      teamCount: { selected: 2 },
      options: {
        titleKey: "game_settings.options",
        bots: { value: 0, labelKey: "x", disabledKey: "y" },
        toggles: [],
        inputCards: [],
      },
      unitTypes: { titleKey: "x", disabledUnits: [] },
    } as unknown as GameConfigSettings["settings"];
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.querySelectorAll("[data-game-speed]").length).toBe(0);
    el.remove();
  });

  it("is pushed to the lobby when the host picks it", () => {
    const modal = new HostLobbyModal() as any;
    const putGameConfig = vi.fn();
    modal.putGameConfig = putGameConfig;
    modal.handleConfigGameSpeedSelected(
      new CustomEvent("game-speed-selected", { detail: { speed: 4 } }),
    );
    expect(modal.gameSpeed).toBe(4);
    expect(putGameConfig).toHaveBeenCalledOnce();
  });
});
