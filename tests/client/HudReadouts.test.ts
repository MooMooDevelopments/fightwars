import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import "../../src/client/hud/layers/ControlPanel";
import type { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
import "../../src/client/hud/layers/PlayerPanel";
import type { PlayerPanel } from "../../src/client/hud/layers/PlayerPanel";
import type { UIState } from "../../src/client/UIState";
import { renderNumber } from "../../src/client/Utils";
import type { GameView, PlayerView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { Doctrine } from "../../src/core/game/Game";
import { UserSettings } from "../../src/core/game/UserSettings";

/**
 * The Phase 5 readouts (brief §6.3 materials, §6.6 doctrine and unrest;
 * manpower is the troop meter's cap, which the bar already prints). Each is
 * words and a figure first; the one colour (unrest's alert token) rides
 * beside an icon and a label, never alone.
 */

describe("control panel: materials beside gold", () => {
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
    panel.setVisibile(true);
    await panel.updateComplete;
  });

  afterEach(() => {
    panel.remove();
  });

  it("prints the pool in both layouts, in the gold tile's grammar", async () => {
    (panel as any)._materials = 4200n;
    panel.requestUpdate();
    await panel.updateComplete;
    const readouts = panel.querySelectorAll('[data-readout="materials"]');
    // One per layout — desktop and mobile are both in the DOM.
    expect(readouts.length).toBe(2);
    for (const r of readouts) {
      expect(r.textContent?.trim()).toBe(renderNumber(4200n));
    }
    // The tile is named for a screen reader; the glyph is decoration.
    const named = panel.querySelectorAll(
      '[aria-label="control_panel.materials"]',
    );
    expect(named.length).toBe(2);
  });
});

describe("player panel: doctrine, materials and occupied land", () => {
  let panel: PlayerPanel;
  let host: HTMLDivElement;
  let doctrinesOn = true;
  let unrestOn = true;

  const player = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      doctrine: () => Doctrine.Fortress,
      numUnrestTiles: () => 0,
      materials: () => 1500n,
      gold: () => 100n,
      troops: () => 10,
      ...over,
    }) as unknown as PlayerView;

  beforeEach(() => {
    document.body.innerHTML = "";
    panel = document.createElement("player-panel") as PlayerPanel;
    panel.g = {
      config: () => ({
        doctrinesEnabled: () => doctrinesOn,
        unrestEnabled: () => unrestOn,
      }),
    } as unknown as GameView;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    doctrinesOn = true;
    unrestOn = true;
    host.remove();
  });

  it("names the doctrine as a chip, and not for a player without one or with doctrines off", () => {
    render((panel as any).renderDoctrineBadge(player()), host);
    const chip = host.querySelector('[data-readout="doctrine"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("player_panel.doctrine");
    expect(chip?.textContent).toContain("doctrine.fortress");

    render(
      (panel as any).renderDoctrineBadge(
        player({ doctrine: () => Doctrine.None }),
      ),
      host,
    );
    expect(host.querySelector('[data-readout="doctrine"]')).toBeNull();

    doctrinesOn = false;
    render((panel as any).renderDoctrineBadge(player()), host);
    expect(host.querySelector('[data-readout="doctrine"]')).toBeNull();
  });

  it("shows the materials pool with the other resources", () => {
    render((panel as any).renderResources(player()), host);
    const tile = host.querySelector('[data-readout="materials"]');
    expect(tile).not.toBeNull();
    expect(tile?.textContent).toContain(renderNumber(1500n));
    expect(tile?.textContent).toContain("player_panel.materials");
  });

  it("shows occupied land only when there is some, with words beside the colour", () => {
    render((panel as any).renderUnrest(player()), host);
    expect(host.querySelector('[data-readout="unrest"]')).toBeNull();

    render(
      (panel as any).renderUnrest(player({ numUnrestTiles: () => 350 })),
      host,
    );
    const row = host.querySelector('[data-readout="unrest"]');
    expect(row).not.toBeNull();
    expect(row?.className).toContain("text-status-alert");
    expect(row?.textContent).toContain(renderNumber(350));
    expect(row?.textContent).toContain("player_panel.occupied_land");

    unrestOn = false;
    render(
      (panel as any).renderUnrest(player({ numUnrestTiles: () => 350 })),
      host,
    );
    expect(host.querySelector('[data-readout="unrest"]')).toBeNull();
  });
});
