import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  showToast: vi.fn(),
}));

import {
  BUILD_QUEUE_POLL_TICKS,
  BuildQueueController,
} from "../../src/client/controllers/BuildQueueController";
import "../../src/client/hud/layers/BuildMenu";
import type { BuildMenu } from "../../src/client/hud/layers/BuildMenu";
import {
  buildMenuElement,
  COLORS,
  type MenuElementParams,
} from "../../src/client/hud/layers/RadialMenuElements";
import {
  CancelBuildQueueEvent,
  QueueBuildEvent,
} from "../../src/client/InputHandler";
import { BuildUnitIntentEvent } from "../../src/client/Transport";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { BuildableUnit, UnitType } from "../../src/core/game/Game";

/**
 * A build queue of one (brief §7 item 9): the build the player could not
 * afford, sent as the ordinary intent the tick the worker says it can be.
 */
describe("build queue", () => {
  let eventBus: EventBus;
  let emitted: unknown[];
  let tick: number;
  let alive: boolean;
  let canBuild: number | false;
  let buildables: ReturnType<typeof vi.fn>;
  let uiState: UIState;
  let controller: BuildQueueController;
  const TILE = 4242;

  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    eventBus = new EventBus();
    emitted = [];
    const realEmit = eventBus.emit.bind(eventBus);
    vi.spyOn(eventBus, "emit").mockImplementation((e) => {
      emitted.push(e);
      realEmit(e);
    });
    tick = 0;
    alive = true;
    canBuild = false;
    buildables = vi.fn(
      async (_tile: number, units: UnitType[]): Promise<BuildableUnit[]> =>
        units.map((type) => ({
          type,
          canBuild,
          canUpgrade: false,
          cost: 1000n,
          materialsCost: 0n,
        })) as BuildableUnit[],
    );
    uiState = { attackRatio: 0.2 } as UIState;
    controller = new BuildQueueController(
      {
        myPlayer: () => ({ isAlive: () => alive, buildables }),
        ticks: () => tick,
      } as unknown as GameView,
      eventBus,
      uiState,
    );
    controller.init();
  });

  const intents = () =>
    emitted.filter(
      (e): e is BuildUnitIntentEvent => e instanceof BuildUnitIntentEvent,
    );

  const advance = async (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      tick++;
      controller.tick();
      await flush();
    }
  };

  it("holds the build and shows it on the panel", () => {
    eventBus.emit(new QueueBuildEvent(UnitType.City, TILE, "unit_type.city"));
    expect(controller.queuedBuild()?.unit).toBe(UnitType.City);
    expect(uiState.buildQueue).toEqual({
      unit: UnitType.City,
      tile: TILE,
      labelKey: "unit_type.city",
    });
  });

  it("asks once a second, not every tick, and sends nothing while it cannot", async () => {
    eventBus.emit(new QueueBuildEvent(UnitType.City, TILE, "unit_type.city"));
    await advance(BUILD_QUEUE_POLL_TICKS * 3);
    expect(buildables).toHaveBeenCalledTimes(3);
    expect(buildables).toHaveBeenCalledWith(TILE, [UnitType.City]);
    expect(intents()).toEqual([]);
    expect(controller.queuedBuild()).not.toBeNull();
  });

  it("sends the ordinary build intent the moment it can, once, and forgets", async () => {
    eventBus.emit(
      new QueueBuildEvent(UnitType.AtomBomb, TILE, "unit_type.atom_bomb", true),
    );
    canBuild = TILE;
    await advance(BUILD_QUEUE_POLL_TICKS * 2);
    expect(intents().length).toBe(1);
    expect(intents()[0].unit).toBe(UnitType.AtomBomb);
    expect(intents()[0].tile).toBe(TILE);
    expect(intents()[0].rocketDirectionUp).toBe(true);
    expect(controller.queuedBuild()).toBeNull();
    expect(uiState.buildQueue).toBeNull();
  });

  it("is cancelled by the chip, or by asking for the same build again", async () => {
    eventBus.emit(new QueueBuildEvent(UnitType.City, TILE, "unit_type.city"));
    eventBus.emit(new CancelBuildQueueEvent());
    expect(controller.queuedBuild()).toBeNull();

    eventBus.emit(new QueueBuildEvent(UnitType.City, TILE, "unit_type.city"));
    eventBus.emit(new QueueBuildEvent(UnitType.City, TILE, "unit_type.city"));
    expect(controller.queuedBuild()).toBeNull();

    canBuild = TILE;
    await advance(BUILD_QUEUE_POLL_TICKS);
    expect(intents()).toEqual([]);
  });

  it("replaces the queued build with a newer one", () => {
    eventBus.emit(new QueueBuildEvent(UnitType.City, TILE, "unit_type.city"));
    eventBus.emit(
      new QueueBuildEvent(UnitType.Port, TILE + 1, "unit_type.port"),
    );
    expect(controller.queuedBuild()?.unit).toBe(UnitType.Port);
  });

  it("forgets the build when the player dies", async () => {
    eventBus.emit(new QueueBuildEvent(UnitType.City, TILE, "unit_type.city"));
    alive = false;
    await advance(1);
    expect(controller.queuedBuild()).toBeNull();
    expect(uiState.buildQueue).toBeNull();
  });
});

describe("build queue: the build menu", () => {
  it("queues an unaffordable item with its name and the rocket direction", () => {
    const menu = document.createElement("build-menu") as BuildMenu;
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    vi.spyOn(eventBus, "emit").mockImplementation((e) => {
      emitted.push(e);
    });
    menu.eventBus = eventBus;
    menu.uiState = { rocketDirectionUp: false } as UIState;
    menu.queue(
      {
        type: UnitType.AtomBomb,
        canBuild: false,
        canUpgrade: false,
        cost: 1n,
        materialsCost: 0n,
      } as BuildableUnit,
      { unitType: UnitType.AtomBomb, icon: "", key: "unit_type.atom_bomb" },
      77,
    );
    const q = emitted.find(
      (e): e is QueueBuildEvent => e instanceof QueueBuildEvent,
    );
    expect(q?.unit).toBe(UnitType.AtomBomb);
    expect(q?.tile).toBe(77);
    expect(q?.labelKey).toBe("unit_type.atom_bomb");
    expect(q?.rocketDirectionUp).toBe(false);
  });
});

describe("build queue: the radial menu", () => {
  it("keeps an unaffordable item clickable, grey, and queues it", () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    vi.spyOn(eventBus, "emit").mockImplementation((e) => {
      emitted.push(e);
    });
    const me = { id: () => "me" };
    const closeMenu = vi.fn();
    const params = {
      myPlayer: me,
      selected: me,
      tile: 99,
      playerActions: {
        buildableUnits: [
          {
            type: UnitType.City,
            canBuild: false,
            canUpgrade: false,
            cost: 125000n,
            materialsCost: 0n,
          },
        ],
      },
      game: { config: () => ({ isUnitDisabled: () => false }) },
      buildMenu: {
        canBuildOrUpgrade: () => false,
        cost: () => 125000n,
        count: () => "0",
      },
      eventBus,
      uiState: { rocketDirectionUp: true },
      closeMenu,
    } as unknown as MenuElementParams;

    const items = buildMenuElement.subMenu!(params);
    const city = items.find((el) => el.name === "city");
    expect(city).toBeDefined();
    expect(city!.disabled(params)).toBe(false);
    const color = city!.color;
    expect(typeof color === "function" ? color(params) : color).toBe(
      COLORS.disabled,
    );

    city!.action!(params);
    const q = emitted.find(
      (e): e is QueueBuildEvent => e instanceof QueueBuildEvent,
    );
    expect(q?.unit).toBe(UnitType.City);
    expect(q?.tile).toBe(99);
    expect(q?.labelKey).toBe("unit_type.city");
    expect(closeMenu).toHaveBeenCalled();
  });
});
