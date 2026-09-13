import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Side-effect import: the @customElement decorator registers <control-panel>.
import "../../src/client/hud/layers/ControlPanel";
import type { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { UserSettings } from "../../src/core/game/UserSettings";

/**
 * The control panel is the only part of the interface that is on screen for
 * the whole match, and almost all of it is `div`s painted to look like
 * controls. Names and roles are exactly what gets lost when such a thing is
 * restyled, and nothing else would notice — hence these.
 */
describe("control-panel accessible names", () => {
  let panel: ControlPanel;

  beforeEach(async () => {
    document.body.innerHTML = "";
    localStorage.clear();
    new UserSettings().setAttackRatio(0.35);

    panel = document.createElement("control-panel") as ControlPanel;
    panel.uiState = { attackRatio: 0 } as UIState;
    panel.eventBus = new EventBus();
    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => null,
      config: () => ({ maxTroops: () => 0, troopIncreaseRate: () => 0 }),
    } as unknown as GameView;
    document.body.appendChild(panel);
    panel.init();
    // The panel renders hidden until a tick makes it visible; the controls are
    // in the DOM either way, which is what this file is about.
    panel.setVisibile(true);
    await panel.updateComplete;
  });

  afterEach(() => {
    panel.remove();
  });

  it("gives both attack-ratio sliders a name and a spoken value", () => {
    const sliders = panel.querySelectorAll('input[type="range"]');
    // One per layout — the mobile and desktop panels are both in the DOM and
    // hidden from each other by breakpoint, so both have to be named.
    expect(sliders.length).toBeGreaterThan(0);
    for (const slider of sliders) {
      expect(slider.getAttribute("aria-label")).toBeTruthy();
      // Without this a screen reader says "35", not "35 percent".
      expect(slider.getAttribute("aria-valuetext")).toMatch(/%$/);
    }
  });

  it("announces the troop meter as a meter, with its value", () => {
    const meters = panel.querySelectorAll('[role="meter"]');
    expect(meters.length).toBeGreaterThan(0);
    for (const meter of meters) {
      expect(meter.getAttribute("aria-label")).toBeTruthy();
      expect(meter.getAttribute("aria-valuenow")).not.toBeNull();
      expect(meter.getAttribute("aria-valuemax")).not.toBeNull();
      expect(meter.getAttribute("aria-valuetext")).toBeTruthy();
    }
  });

  it("hides its decorative icons rather than reading them out", () => {
    for (const img of panel.querySelectorAll("img")) {
      // Every icon in this panel decorates a figure that is already text.
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("width")).toBeTruthy();
      expect(img.getAttribute("height")).toBeTruthy();
    }
  });
});
