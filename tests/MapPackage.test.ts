import { describe, expect, it } from "vitest";
import { GameMapSize, TerrainType } from "../src/core/game/Game";
import {
  buildMapPackage,
  createGrid,
  EditorGrid,
  gridFromPacked,
  halveGrid,
  oceanMask,
  packGrid,
  shorelineMask,
  TERRAIN_CODES,
  validatePackage,
  waterDistance,
} from "../src/core/game/MapPackage";
import { genTerrainFromBin } from "../src/core/game/TerrainMapLoader";

/**
 * Map packages (brief §6.9): a painted grid becomes exactly the bytes the
 * game loads. The last case is the one that matters — the loader reads the
 * package back and agrees about every tile.
 */
describe("map package", () => {
  /** An island of land in a sea, with a lake and a peak. */
  function island(): EditorGrid {
    const g = createGrid(24, 20);
    const set = (x: number, y: number, t: number, e = 0) => {
      g.terrain[y * g.width + x] = t;
      g.elevation[y * g.width + x] = e;
    };
    for (let y = 4; y < 16; y++) {
      for (let x = 4; x < 20; x++) set(x, y, TERRAIN_CODES.land, 5);
    }
    // A lake inside the island, and a mountain beside it.
    for (let y = 8; y < 10; y++) {
      for (let x = 10; x < 13; x++) set(x, y, TERRAIN_CODES.water);
    }
    set(15, 9, TERRAIN_CODES.land, 25);
    set(16, 9, TERRAIN_CODES.impassable);
    return g;
  }

  it("calls the largest body ocean and leaves the lake alone", () => {
    const g = island();
    const ocean = oceanMask(g);
    expect(ocean[0]).toBe(1);
    expect(ocean[9 * g.width + 11]).toBe(0);
    // Every water tile but the lake's six: the island's 192 cells hold 186
    // tiles of land (the lake is cut out of them), so 294 are water.
    expect(ocean.reduce((a: number, b: number) => a + b, 0)).toBe(294 - 6);
  });

  it("marks the shore on both sides of the water, never the impassable", () => {
    const g = island();
    const shore = shorelineMask(g);
    expect(shore[4 * g.width + 4]).toBe(1); // land corner against the sea
    expect(shore[3 * g.width + 4]).toBe(1); // the water above it
    expect(shore[9 * g.width + 9]).toBe(1); // land against the lake
    expect(shore[10 * g.width + 10]).toBe(1); // under the lake
    expect(shore[10 * g.width + 6]).toBe(0); // inland, away from both
    expect(shore[9 * g.width + 16]).toBe(0); // impassable
  });

  it("measures water by its distance to land", () => {
    const g = island();
    const d = waterDistance(g);
    expect(d[3 * g.width + 10]).toBe(1);
    expect(d[2 * g.width + 10]).toBe(2);
    expect(d[0]).toBe(8); // (0,0) to the island's corner at (4,4)
    expect(d[9 * g.width + 11]).toBe(1); // the lake is one tile from its shore
  });

  it("packs a tile the way the loader reads it", () => {
    const g = island();
    const { meta, bin } = packGrid(g);
    // Land, minus the one impassable tile and the lake's six.
    expect(meta.num_land_tiles).toBe(16 * 12 - 6 - 1);
    expect(meta.width).toBe(24);
    const inland = bin[10 * g.width + 6];
    expect(inland & 0b1000_0000).toBeTruthy();
    expect(inland & 0b0001_1111).toBe(5);
    const peak = bin[9 * g.width + 15];
    expect(peak & 0b0001_1111).toBe(25);
    expect(bin[9 * g.width + 16]).toBe(0b1001_1111);
    const openSea = bin[0];
    expect(openSea & 0b1000_0000).toBe(0);
    expect(openSea & 0b0010_0000).toBeTruthy(); // ocean
    expect(openSea & 0b0001_1111).toBe(4); // ceil(8 / 2)
  });

  it("halves the grid with water winning and impassable over land", () => {
    const g = createGrid(4, 4);
    const at = (x: number, y: number) => y * 4 + x;
    // Left cell: water first, land after — water still takes it, which is
    // what keeps a one-tile river alive at half scale.
    g.terrain[at(1, 1)] = TERRAIN_CODES.land;
    g.elevation[at(1, 1)] = 7;
    // Right cell: land and impassable only, so impassable takes it.
    for (const [x, y] of [
      [2, 0],
      [3, 1],
      [2, 1],
    ] as [number, number][]) {
      g.terrain[at(x, y)] = TERRAIN_CODES.land;
      g.elevation[at(x, y)] = 3;
    }
    g.terrain[at(3, 0)] = TERRAIN_CODES.impassable;
    const half = halveGrid(g);
    expect(half.width).toBe(2);
    expect(half.terrain[0]).toBe(TERRAIN_CODES.water);
    expect(half.terrain[1]).toBe(TERRAIN_CODES.impassable);
  });

  it("builds a package the terrain loader reads back tile for tile", async () => {
    const g = island();
    const pkg = buildMapPackage({
      name: "Test Isle",
      grid: g,
      nations: [{ name: "Northport", coordinates: [6, 6], flag: "us" }],
    });
    expect(pkg.manifest.map.width).toBe(24);
    expect(pkg.manifest.map4x).toEqual({
      width: 12,
      height: 10,
      num_land_tiles: expect.any(Number),
    });
    expect(pkg.manifest.map16x.width).toBe(6);
    expect(pkg.mapBin.length).toBe(24 * 20);
    expect(pkg.map4xBin.length).toBe(12 * 10);

    const map = await genTerrainFromBin(pkg.manifest.map, pkg.mapBin);
    expect(map.width()).toBe(24);
    expect(map.numLandTiles()).toBe(pkg.manifest.map.num_land_tiles);
    expect(map.isLand(map.ref(6, 6))).toBe(true);
    expect(map.terrainType(map.ref(6, 6))).toBe(TerrainType.Plains);
    expect(map.terrainType(map.ref(15, 9))).toBe(TerrainType.Mountain);
    expect(map.isImpassable(map.ref(16, 9))).toBe(true);
    expect(map.isLand(map.ref(0, 0))).toBe(false);
    expect(map.isOcean(map.ref(0, 0))).toBe(true);
    expect(map.isOcean(map.ref(11, 9))).toBe(false); // the lake
    expect(map.isShoreline(map.ref(4, 4))).toBe(true);
    // Every tile round-trips: the loader's view equals what was painted.
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        const painted = g.terrain[y * g.width + x];
        const ref = map.ref(x, y);
        if (painted === TERRAIN_CODES.impassable) {
          expect(map.isImpassable(ref)).toBe(true);
        } else {
          expect(map.isLand(ref)).toBe(painted === TERRAIN_CODES.land);
        }
      }
    }
    void GameMapSize;
  });

  it("opens a package back up and exports the same map", () => {
    const g = island();
    const pkg = buildMapPackage({
      name: "Test Isle",
      grid: g,
      nations: [{ name: "Northport", coordinates: [6, 6] }],
    });
    const reopened = gridFromPacked(pkg.manifest.map, pkg.mapBin);
    expect(Array.from(reopened.terrain)).toEqual(Array.from(g.terrain));
    expect(Array.from(reopened.elevation)).toEqual(Array.from(g.elevation));
    const again = buildMapPackage({
      name: "Test Isle",
      grid: reopened,
      nations: [{ name: "Northport", coordinates: [6, 6] }],
    });
    expect(Array.from(again.mapBin)).toEqual(Array.from(pkg.mapBin));
    expect(Array.from(again.map4xBin)).toEqual(Array.from(pkg.map4xBin));
    expect(again.manifest).toEqual(pkg.manifest);
  });

  it("says what is wrong before an export, and nothing when it is fine", () => {
    const g = island();
    const good = {
      name: "Test Isle",
      grid: g,
      nations: [{ name: "Northport", coordinates: [6, 6] as [number, number] }],
    };
    expect(validatePackage(good)).toEqual([]);
    expect(validatePackage({ ...good, name: "  " })).toContain(
      "map_editor.problem_name",
    );
    expect(validatePackage({ ...good, nations: [] })).toContain(
      "map_editor.problem_nations",
    );
    expect(
      validatePackage({
        ...good,
        nations: [{ name: "x", coordinates: [0, 0] }],
      }),
    ).toContain("map_editor.problem_nation_at_sea");
    expect(
      validatePackage({
        ...good,
        nations: [{ name: "x", coordinates: [99, 0] }],
      }),
    ).toContain("map_editor.problem_nation_off_map");
    expect(validatePackage({ ...good, grid: createGrid(8, 8) })).toEqual(
      expect.arrayContaining([
        "map_editor.problem_size",
        "map_editor.problem_land",
      ]),
    );
  });
});
