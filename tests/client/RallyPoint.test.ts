import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
  showToast: vi.fn(),
}));

import { RallyPointController } from "../../src/client/controllers/RallyPointController";
import { SetRallyPointEvent } from "../../src/client/InputHandler";
import type { MapRenderer } from "../../src/client/render/gl";
import type { TransformHandler } from "../../src/client/TransformHandler";
import { MoveWarshipIntentEvent } from "../../src/client/Transport";
import type { GameView, UnitView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { UnitType } from "../../src/core/game/Game";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import { getDefaultKeybinds } from "../../src/core/game/UserSettings";

/**
 * A rally point for warships (brief §7 item 9): one water tile, held on
 * the client, that every new warship of the player's own is sent to with
 * the ordinary move intent. The simulation never knows.
 */
describe("rally point", () => {
  const me = { smallID: () => 7 };
  const them = { smallID: () => 8 };
  let eventBus: EventBus;
  let emitted: unknown[];
  let tick: number;
  let units: Map<number, UnitView>;
  let unitUpdates: { id: number }[];
  let controller: RallyPointController;
  let showMoveIndicator: ReturnType<typeof vi.fn>;

  // A 10x10 map: x < 5 is land, x >= 5 is water; ref = y * 10 + x.
  const ref = (x: number, y: number) => y * 10 + x;
  const game = () =>
    ({
      isValidCoord: (x: number, y: number) =>
        x >= 0 && x < 10 && y >= 0 && y < 10,
      ref,
      x: (r: number) => r % 10,
      y: (r: number) => Math.floor(r / 10),
      isWater: (r: number) => r % 10 >= 5,
      myPlayer: () => me,
      ticks: () => tick,
      updatesSinceLastTick: () => ({ [GameUpdateType.Unit]: unitUpdates }),
      unit: (id: number) => units.get(id),
    }) as unknown as GameView;

  const ship = (
    id: number,
    over: Partial<{
      type: UnitType;
      owner: unknown;
      createdAt: number;
      active: boolean;
    }> = {},
  ) => {
    const u = {
      id: () => id,
      type: () => over.type ?? UnitType.Warship,
      owner: () => over.owner ?? me,
      createdAt: () => over.createdAt ?? tick,
      isActive: () => over.active ?? true,
    } as unknown as UnitView;
    units.set(id, u);
    unitUpdates.push({ id });
    return u;
  };

  const moves = () =>
    emitted.filter(
      (e): e is MoveWarshipIntentEvent => e instanceof MoveWarshipIntentEvent,
    );

  beforeEach(() => {
    eventBus = new EventBus();
    emitted = [];
    const realEmit = eventBus.emit.bind(eventBus);
    vi.spyOn(eventBus, "emit").mockImplementation((e) => {
      emitted.push(e);
      realEmit(e);
    });
    tick = 100;
    units = new Map();
    unitUpdates = [];
    showMoveIndicator = vi.fn();
    controller = new RallyPointController(
      game(),
      eventBus,
      {
        // Screen (x, y) is the tile (x, y) here.
        screenToWorldCoordinates: (x: number, y: number) => ({ x, y }),
      } as unknown as TransformHandler,
      { showMoveIndicator } as unknown as MapRenderer,
    );
    controller.init();
  });

  it("has a key of its own by default", () => {
    expect(getDefaultKeybinds(false).setRallyPoint).toBe("KeyO");
  });

  it("is set over water and marked, and cleared over land", () => {
    eventBus.emit(new SetRallyPointEvent(7, 3));
    expect(controller.rallyTile()).toBe(ref(7, 3));
    expect(showMoveIndicator).toHaveBeenCalledWith(7, 3, 7);

    eventBus.emit(new SetRallyPointEvent(2, 3));
    expect(controller.rallyTile()).toBeNull();
  });

  it("ignores a press off the map", () => {
    eventBus.emit(new SetRallyPointEvent(7, 3));
    eventBus.emit(new SetRallyPointEvent(40, 40));
    expect(controller.rallyTile()).toBe(ref(7, 3));
  });

  it("sends each new warship of mine there, and nothing else", () => {
    eventBus.emit(new SetRallyPointEvent(7, 3));
    ship(1);
    ship(2, { type: UnitType.Submarine });
    ship(3, { owner: them });
    ship(4, { createdAt: tick - 1 });
    ship(5, { type: UnitType.TransportShip });
    ship(6, { active: false });
    controller.tick();
    expect(moves().length).toBe(1);
    expect(moves()[0].unitIds).toEqual([1, 2]);
    expect(moves()[0].tile).toBe(ref(7, 3));
  });

  it("sends nothing without a rally point, or once it is cleared", () => {
    ship(1);
    controller.tick();
    expect(moves()).toEqual([]);

    eventBus.emit(new SetRallyPointEvent(7, 3));
    eventBus.emit(new SetRallyPointEvent(1, 1));
    unitUpdates = [];
    ship(2);
    controller.tick();
    expect(moves()).toEqual([]);
  });
});
