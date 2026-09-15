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

import { MapEditorModal, tileColor } from "../../src/client/MapEditorModal";
import { TERRAIN_CODES } from "../../src/core/game/MapPackage";

/** The map editor's own behaviour: brushes, nations, and what it refuses. */
describe("map editor", () => {
  const editor = () => new MapEditorModal() as any;

  it("paints a square of the brush's size and leaves the rest alone", () => {
    const e = editor();
    e.brush = "mountain";
    e.brushSize = 3;
    e.paintAt(10, 10);
    const at = (x: number, y: number) => y * e.grid.width + x;
    expect(e.grid.terrain[at(10, 10)]).toBe(TERRAIN_CODES.land);
    expect(e.grid.elevation[at(10, 10)]).toBe(25);
    expect(e.grid.terrain[at(11, 11)]).toBe(TERRAIN_CODES.land);
    expect(e.grid.terrain[at(12, 12)]).toBe(TERRAIN_CODES.water);
    // The brush clips at the edge instead of wrapping.
    e.paintAt(0, 0);
    expect(e.grid.terrain[at(0, 0)]).toBe(TERRAIN_CODES.land);
    expect(e.grid.terrain[at(e.grid.width - 1, 0)]).toBe(TERRAIN_CODES.water);
  });

  it("colours a tile by what it is, not by what painted it", () => {
    expect(tileColor(TERRAIN_CODES.water, 0)).toBe("#1d4ed8");
    expect(tileColor(TERRAIN_CODES.impassable, 0)).toBe("#2b2b2b");
    expect(tileColor(TERRAIN_CODES.land, 5)).toBe("#4d7c3a");
    expect(tileColor(TERRAIN_CODES.land, 15)).toBe("#8a7a44");
    expect(tileColor(TERRAIN_CODES.land, 25)).toBe("#9a9a9a");
  });

  it("adds a nation only with a name, and drops it on request", () => {
    const e = editor();
    e.addNation(4, 4);
    expect(e.nations).toEqual([]);
    e.nationName = "  Northport  ";
    e.placingNation = true;
    e.addNation(4, 4);
    expect(e.nations).toEqual([{ name: "Northport", coordinates: [4, 4] }]);
    // The name is spent and placement ends, so the next click paints.
    expect(e.nationName).toBe("");
    expect(e.placingNation).toBe(false);
    e.removeNation(0);
    expect(e.nations).toEqual([]);
  });

  it("refuses to export a map that is not ready, and says why", () => {
    const e = editor();
    e.exportPackage();
    expect(e.problems).toEqual(
      expect.arrayContaining([
        "map_editor.problem_name",
        "map_editor.problem_land",
        "map_editor.problem_nations",
      ]),
    );
    expect(e.exported).toBeNull();
  });

  it("exports a package once the map holds land and a nation", () => {
    const e = editor();
    e.mapName = "Test Isle";
    e.brush = "plains";
    e.brushSize = 21;
    for (const [x, y] of [
      [20, 20],
      [40, 20],
      [30, 30],
    ]) {
      e.paintAt(x, y);
    }
    e.nationName = "Northport";
    e.addNation(20, 20);

    const clicked: string[] = [];
    const url = "blob:test";
    const createObjectURL = vi.fn(() => url);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === "a") {
        (el as HTMLAnchorElement).click = () =>
          clicked.push((el as HTMLAnchorElement).download);
      }
      return el;
    });

    e.exportPackage();

    expect(e.problems).toEqual([]);
    expect(clicked).toEqual(["test-isle.fwmap.json"]);
    expect(e.exported).toBe("test-isle.fwmap.json");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith(url);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resizing starts a blank map and forgets the nations on it", () => {
    const e = editor();
    e.brush = "plains";
    e.paintAt(5, 5);
    e.nationName = "Old";
    e.addNation(5, 5);
    e.resize(256, 160);
    expect(e.grid.width).toBe(256);
    expect(e.grid.height).toBe(160);
    expect(e.nations).toEqual([]);
    expect(e.grid.terrain.every((t: number) => t === TERRAIN_CODES.water)).toBe(
      true,
    );
  });
});
