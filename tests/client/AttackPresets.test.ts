import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../src/client/hud/layers/ControlPanel";
import type { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
import {
  ATTACK_PRESETS,
  InputHandler,
  SetAttackRatioEvent,
} from "../../src/client/InputHandler";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import {
  getDefaultKeybinds,
  KEYBINDS_KEY,
  UserSettings,
} from "../../src/core/game/UserSettings";

/**
 * Attack presets (brief §7 item 9): a step key nudges the ratio, a preset
 * key names it. Four keys, a quarter to everything, on Shift and the digit
 * row — the plain digits are the build menu's.
 */
describe("attack presets: the keys", () => {
  it("are Shift and the digit row, a quarter to everything", () => {
    const k = getDefaultKeybinds(false);
    expect([
      k.attackPreset1,
      k.attackPreset2,
      k.attackPreset3,
      k.attackPreset4,
    ]).toEqual([
      "Shift+Digit1",
      "Shift+Digit2",
      "Shift+Digit3",
      "Shift+Digit4",
    ]);
    expect(ATTACK_PRESETS).toEqual([25, 50, 75, 100]);
  });

  it("do not collide with the build keys on the same digits", () => {
    const k = getDefaultKeybinds(false);
    expect(k.buildCity).toBe("Digit1");
    expect(k.attackPreset1).not.toBe(k.buildCity);
  });
});

describe("attack presets: the input handler", () => {
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

  const presets = () =>
    emitted.filter(
      (e): e is SetAttackRatioEvent => e instanceof SetAttackRatioEvent,
    );

  it("names the ratio on Shift and a digit", () => {
    window.dispatchEvent(
      new KeyboardEvent("keyup", { code: "Digit2", shiftKey: true }),
    );
    expect(presets().map((e) => e.percent)).toEqual([50]);
    window.dispatchEvent(
      new KeyboardEvent("keyup", { code: "Digit4", shiftKey: true }),
    );
    expect(presets().map((e) => e.percent)).toEqual([50, 100]);
  });

  it("leaves the plain digit to the build menu", () => {
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Digit2" }));
    expect(presets()).toEqual([]);
  });
});

describe("attack presets: the control panel", () => {
  let panel: ControlPanel;
  let uiState: UIState;
  let eventBus: EventBus;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    new UserSettings().setAttackRatio(0.2);
    panel = document.createElement("control-panel") as ControlPanel;
    uiState = { attackRatio: 0 } as UIState;
    panel.uiState = uiState;
    eventBus = new EventBus();
    panel.eventBus = eventBus;
    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => null,
    } as unknown as GameView;
    document.body.appendChild(panel);
    panel.init();
  });

  afterEach(() => {
    panel.remove();
  });

  it("takes the preset as the ratio", () => {
    // Like the step keys, a preset changes this game's ratio and not the
    // stored default; the slider and the settings modal own that.
    eventBus.emit(new SetAttackRatioEvent(75));
    expect(uiState.attackRatio).toBeCloseTo(0.75);
    expect(new UserSettings().attackRatio()).toBeCloseTo(0.2);
  });

  it("clamps a preset to the slider's range", () => {
    eventBus.emit(new SetAttackRatioEvent(140));
    expect(uiState.attackRatio).toBe(1);
    eventBus.emit(new SetAttackRatioEvent(0));
    expect(uiState.attackRatio).toBeCloseTo(0.01);
  });
});
