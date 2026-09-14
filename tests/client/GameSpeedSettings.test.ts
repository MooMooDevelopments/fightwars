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
  BLITZ_PRESET,
  GAME_SPEEDS,
  GameConfigSettings,
} from "../../src/client/components/GameConfigSettings";
import { HostLobbyModal } from "../../src/client/HostLobbyModal";
import { SinglePlayerModal } from "../../src/client/SinglePlayerModal";
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

  it("offers Blitz as one card, pressed when the lobby is Blitz already", async () => {
    const el = document.createElement(
      "game-config-settings",
    ) as GameConfigSettings;
    const settings = {
      map: { selected: GameMapType.World, useRandom: false },
      difficulty: { selected: Difficulty.Medium, disabled: false },
      gameMode: { selected: GameMode.FFA },
      gameSpeed: { selected: 1, blitz: false },
      teamCount: { selected: 2 },
      options: {
        titleKey: "game_settings.options",
        bots: { value: 0, labelKey: "x", disabledKey: "y" },
        toggles: [],
        inputCards: [],
      },
      unitTypes: { titleKey: "x", disabledUnits: [] },
    };
    el.settings = settings as unknown as GameConfigSettings["settings"];
    document.body.appendChild(el);
    await el.updateComplete;
    const card = el.querySelector<HTMLButtonElement>("[data-blitz-preset]")!;
    expect(card).not.toBeNull();
    expect(card.getAttribute("aria-pressed")).toBe("false");
    const emitted: unknown[] = [];
    el.addEventListener("blitz-preset-selected", (e) =>
      emitted.push((e as CustomEvent).detail),
    );
    card.click();
    expect(emitted).toEqual([{ ...BLITZ_PRESET }]);
    el.settings = {
      ...settings,
      gameSpeed: { selected: 4, blitz: true },
    } as unknown as GameConfigSettings["settings"];
    await el.updateComplete;
    expect(
      el
        .querySelector<HTMLButtonElement>("[data-blitz-preset]")!
        .getAttribute("aria-pressed"),
    ).toBe("true");
    el.remove();
  });

  it("the preset sets the speed, the map and the clock at once, and is pushed", () => {
    const modal = new HostLobbyModal() as any;
    const putGameConfig = vi.fn();
    modal.putGameConfig = putGameConfig;
    expect(modal.isBlitzPreset()).toBe(false);
    modal.handleConfigBlitzPreset();
    expect(modal.gameSpeed).toBe(4);
    expect(modal.compactMap).toBe(true);
    expect(modal.maxTimer).toBe(true);
    expect(modal.maxTimerValue).toBe(20);
    expect(modal.isBlitzPreset()).toBe(true);
    expect(putGameConfig).toHaveBeenCalled();
    // Any of the three moved: no longer Blitz.
    modal.gameSpeed = 2;
    expect(modal.isBlitzPreset()).toBe(false);
  });

  it("offers the scenarios as cards and the modal takes the map, mode and blocs", async () => {
    const el = document.createElement(
      "game-config-settings",
    ) as GameConfigSettings;
    el.settings = {
      map: { selected: GameMapType.World, useRandom: false },
      difficulty: { selected: Difficulty.Medium, disabled: false },
      gameMode: { selected: GameMode.FFA },
      gameSpeed: { selected: 1 },
      scenario: { selected: null },
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
    const cards = [
      ...el.querySelectorAll<HTMLButtonElement>("[data-scenario]"),
    ];
    expect(cards.map((c) => c.dataset.scenario)).toEqual([
      "none",
      "ww1",
      "ww2",
      "coldwar",
      "warringstates",
    ]);
    expect(cards[0].getAttribute("aria-pressed")).toBe("true");
    const emitted: (string | null)[] = [];
    el.addEventListener("scenario-selected", (e) =>
      emitted.push((e as CustomEvent<{ id: string | null }>).detail.id),
    );
    cards[2].click();
    cards[0].click();
    expect(emitted).toEqual(["ww2", null]);
    el.remove();

    const modal = new HostLobbyModal() as any;
    modal.putGameConfig = vi.fn();
    modal.loadNationCount = vi.fn(async () => undefined);
    modal.handleConfigScenarioSelected(
      new CustomEvent("scenario-selected", { detail: { id: "ww2" } }),
    );
    expect(modal.scenario).toBe("ww2");
    expect(modal.selectedMap).toBe(GameMapType.Europe);
    expect(modal.gameMode).toBe(GameMode.Team);
    expect(modal.teamCount).toBe(3);
    modal.handleConfigScenarioSelected(
      new CustomEvent("scenario-selected", { detail: { id: "warringstates" } }),
    );
    expect(modal.selectedMap).toBe(GameMapType.China);
    expect(modal.gameMode).toBe(GameMode.FFA);
    modal.handleConfigScenarioSelected(
      new CustomEvent("scenario-selected", { detail: { id: null } }),
    );
    expect(modal.scenario).toBeNull();
    expect(modal.selectedMap).toBe(GameMapType.China);
  });

  it("the solo modal builds the same Blitz", () => {
    const modal = new SinglePlayerModal() as any;
    modal.handleConfigBlitzPreset();
    expect(modal.gameSpeed).toBe(4);
    expect(modal.compactMap).toBe(true);
    expect(modal.maxTimer).toBe(true);
    expect(modal.maxTimerValue).toBe(20);
    expect(modal.isBlitzPreset()).toBe(true);
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
