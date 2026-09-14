import { describe, expect, it, vi } from "vitest";

// jsdom's DOMMatrix cannot parse a CSS transform, and d3's interpolator
// reaches for it during the submenu's scale animation: an identity stub
// keeps the animation inert here.
vi.hoisted(() => {
  (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(_init?: string) {}
  };
});

vi.mock("../../../src/client/hud/layers/BuildMenu", () => ({
  BuildMenu: class {},
  flattenedBuildTable: [],
}));
vi.mock("../../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  renderNumber: (num: number) => num.toString(),
  // Never resolves: the icon pass needs SVG geometry jsdom lacks.
  getSvgAspectRatio: () => new Promise(() => {}),
}));

import { RadialMenu } from "../../../src/client/hud/layers/RadialMenu";
import {
  CenterButtonElement,
  MenuElement,
  MenuElementParams,
} from "../../../src/client/hud/layers/RadialMenuElements";
import { EventBus } from "../../../src/core/EventBus";

/**
 * The radial menu on a keyboard (brief §11): arrows walk the enabled arcs,
 * Enter activates, Escape steps back or closes, and the arcs are menu items
 * a screen reader can name.
 */
describe("radial menu keyboard", () => {
  const key = (k: string, extra: Partial<KeyboardEventInit> = {}) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, ...extra }));

  function menu() {
    const eventBus = new EventBus();
    const acted: string[] = [];
    const leaf = (id: string, disabled = false): MenuElement => ({
      id,
      name: id,
      disabled: () => disabled,
      action: () => acted.push(id),
    });
    const sub: MenuElement = {
      id: "more",
      name: "more",
      disabled: () => false,
      subMenu: () => [leaf("deep")],
    };
    const root: MenuElement = {
      id: "root",
      name: "root",
      disabled: () => false,
      subMenu: () => [leaf("one"), leaf("off", true), leaf("two"), sub],
    };
    const centre = {
      id: "centre",
      name: "centre",
      disabled: () => false,
      action: () => {},
    } as unknown as CenterButtonElement;
    const radial = new RadialMenu(eventBus, root, centre, {
      menuTransitionDuration: 0,
    });
    radial.init();
    radial.setParams({
      game: { inSpawnPhase: () => false },
    } as unknown as MenuElementParams);
    radial.showRadialMenu(200, 200);
    return { radial, acted };
  }

  it("walks the enabled arcs with the arrows, skipping the disabled, and wraps", () => {
    const { radial } = menu();
    expect(radial.focusedIndex()).toBe(-1);
    key("ArrowRight");
    expect(radial.focusedIndex()).toBe(0);
    key("ArrowRight");
    expect(radial.focusedIndex()).toBe(2);
    key("ArrowRight");
    expect(radial.focusedIndex()).toBe(3);
    key("ArrowRight");
    expect(radial.focusedIndex()).toBe(0);
    key("ArrowLeft");
    expect(radial.focusedIndex()).toBe(3);
    const live = document.querySelector("[data-radial-live]");
    expect(live?.textContent).toBe("more");
    expect(
      document
        .querySelector('path[data-id="more"]')
        ?.getAttribute("aria-current"),
    ).toBe("true");
    radial.hideRadialMenu();
  });

  it("activates with Enter, descends into a submenu, and Escape steps back then closes", () => {
    const { radial, acted } = menu();
    key("ArrowLeft");
    expect(radial.focusedIndex()).toBe(3);
    key("Enter");
    expect(radial.getCurrentLevel()).toBe(1);
    key("ArrowRight");
    key("Escape");
    expect(radial.getCurrentLevel()).toBe(0);
    expect(radial.isMenuVisible()).toBe(true);
    key("Escape");
    expect(radial.isMenuVisible()).toBe(false);
    expect(acted).toEqual([]);
  });

  it("runs a leaf's action from the keyboard and closes", () => {
    const { radial, acted } = menu();
    key("ArrowRight");
    key(" ");
    expect(acted).toEqual(["one"]);
    expect(radial.isMenuVisible()).toBe(false);
    // Closed: the keys do nothing more.
    key("ArrowRight");
    expect(radial.focusedIndex()).toBe(-1);
  });

  it("names the arcs for a screen reader", () => {
    const { radial } = menu();
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.map((p) => p.getAttribute("aria-label"))).toEqual([
      "one",
      "off",
      "two",
      "more",
    ]);
    expect(items[1].getAttribute("aria-disabled")).toBe("true");
    expect(document.querySelector('svg[role="menu"]')).not.toBeNull();
    radial.hideRadialMenu();
  });
});
