import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import {
  HUD_HIDDEN_CLASS,
  HudVisibilityController,
  keyLabel,
} from "../../src/client/controllers/HudVisibilityController";
import { InputHandler, ToggleHudEvent } from "../../src/client/InputHandler";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import {
  getDefaultKeybinds,
  KEYBINDS_KEY,
  UserSettings,
} from "../../src/core/game/UserSettings";

/**
 * The chrome hides with one key (brief §7). One key, every HUD surface at
 * once, and a way back that a phone can tap.
 */
describe("hide HUD: the key", () => {
  it("is Z by default, on every platform", () => {
    expect(getDefaultKeybinds(false).toggleHud).toBe("KeyZ");
    expect(getDefaultKeybinds(true).toggleHud).toBe("KeyZ");
  });

  it("is a word a player can read", () => {
    expect(keyLabel("KeyZ")).toBe("Z");
    expect(keyLabel("Digit1")).toBe("1");
    expect(keyLabel("Shift+KeyR")).toBe("Shift+R");
  });
});

describe("hide HUD: the input handler", () => {
  let inputHandler: InputHandler;
  let eventBus: EventBus;
  let emitted: unknown[];

  beforeEach(() => {
    new UserSettings().removeCached(KEYBINDS_KEY, false);
    document.body.innerHTML = "";
    eventBus = new EventBus();
    emitted = [];
    vi.spyOn(eventBus, "emit").mockImplementation((e) => {
      emitted.push(e);
    });
    inputHandler = new InputHandler(
      {
        inSpawnPhase: () => false,
        myPlayer: () => ({ isAlive: () => true }),
      } as unknown as GameView,
      {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        upgradeMultiplier: 1,
      },
      document.createElement("canvas"),
      eventBus,
    );
    inputHandler.initialize();
  });

  afterEach(() => {
    inputHandler.destroy();
  });

  it("fires the toggle on the key's release, like the other actions", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ" }));
    expect(emitted.some((e) => e instanceof ToggleHudEvent)).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyZ" }));
    expect(emitted.filter((e) => e instanceof ToggleHudEvent).length).toBe(1);
  });

  it("stays out of a text field", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyZ", bubbles: true }),
    );
    expect(emitted.some((e) => e instanceof ToggleHudEvent)).toBe(false);
  });
});

describe("hide HUD: the controller", () => {
  let eventBus: EventBus;
  let root: HTMLElement;
  let host: HTMLElement;
  let controller: HudVisibilityController;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    eventBus = new EventBus();
    root = document.createElement("div");
    host = document.createElement("div");
    document.body.append(root, host);
    controller = new HudVisibilityController(
      eventBus,
      new UserSettings(),
      root,
      host,
    );
  });

  it("starts visible, even on a root a previous game left hidden", () => {
    root.classList.add(HUD_HIDDEN_CLASS);
    controller.init();
    expect(root.classList.contains(HUD_HIDDEN_CLASS)).toBe(false);
    expect(controller.isHidden()).toBe(false);
  });

  it("toggles the root class on the event, both ways", () => {
    controller.init();
    eventBus.emit(new ToggleHudEvent());
    expect(root.classList.contains(HUD_HIDDEN_CLASS)).toBe(true);
    expect(controller.isHidden()).toBe(true);
    eventBus.emit(new ToggleHudEvent());
    expect(root.classList.contains(HUD_HIDDEN_CLASS)).toBe(false);
  });

  it("leaves a way back that names the key, and the way back works", () => {
    controller.init();
    eventBus.emit(new ToggleHudEvent());
    const hint = host.querySelector<HTMLButtonElement>("[data-hud-hint]");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain("hud.show_hint");
    expect(hint?.textContent).toContain('"key":"Z"');
    hint?.click();
    expect(controller.isHidden()).toBe(false);
    expect(host.querySelector("[data-hud-hint]")).toBeNull();
  });

  it("names the key the player rebound, not the default", () => {
    localStorage.setItem(KEYBINDS_KEY, JSON.stringify({ toggleHud: "KeyH" }));
    // UserSettings memoises reads; drop the memo so the write above is seen.
    (UserSettings as unknown as { cache: Map<string, unknown> }).cache.clear();
    controller.init();
    eventBus.emit(new ToggleHudEvent());
    expect(host.querySelector("[data-hud-hint]")?.textContent).toContain(
      '"key":"H"',
    );
  });
});
