/**
 * Map packages (brief §6.9, creation tools): the terrain a map editor paints,
 * packed into exactly the bytes `genTerrainFromBin` reads and the manifest
 * `loadTerrainMap` expects.
 *
 * The format is the Go generator's (`map-generator/map_generator.go`), and
 * this is its second implementation, in TypeScript, for maps made in the
 * browser:
 *
 * - one byte a tile, row-major (`y * width + x`);
 * - bit 7 land, bit 6 shoreline, bit 5 ocean, bits 0–4 magnitude;
 * - a land tile's magnitude is its elevation, 0–30; an impassable tile is
 *   `0b10011111` (land bit set, magnitude 31) and is not counted as land;
 * - a water tile's magnitude is half its distance to the nearest land,
 *   rounded up and capped at 31.
 *
 * Ocean is the largest water body, four-connected — a lake is water that is
 * not ocean, which is what makes an inland sea behave like one. Shoreline is
 * any land touching water and any water touching land. The two minimaps are
 * the grid halved and halved again, water winning every contested cell so a
 * river a tile wide survives the scaling, with ocean, shoreline and distance
 * recomputed at each scale rather than inherited.
 *
 * Nothing here runs inside a game: a package is built once, in the editor,
 * and what the simulation then loads is the bytes. Pure and synchronous, so
 * the tests can hold it to the byte.
 */

export const IMPASSABLE_MAGNITUDE = 31;
export const MAX_ELEVATION = 30;
/** Water beyond this distance from land packs as deep water. */
const MAX_WATER_DISTANCE = 62;

export type EditorTerrain = "water" | "land" | "impassable";

/** What the editor holds: a type per tile and, for land, an elevation. */
export interface EditorGrid {
  width: number;
  height: number;
  /** One entry per tile, row-major. */
  terrain: Uint8Array;
  /** Elevation 0–30 per tile; ignored for water and impassable. */
  elevation: Uint8Array;
}

export const TERRAIN_CODES: Record<EditorTerrain, number> = {
  water: 0,
  land: 1,
  impassable: 2,
};

export function createGrid(width: number, height: number): EditorGrid {
  return {
    width,
    height,
    terrain: new Uint8Array(width * height),
    elevation: new Uint8Array(width * height),
  };
}

export interface MapMetadataOut {
  width: number;
  height: number;
  num_land_tiles: number;
}

export interface PackedMap {
  meta: MapMetadataOut;
  bin: Uint8Array;
}

/** The ocean mask: the largest four-connected body of water, by tile count. */
export function oceanMask(grid: EditorGrid): Uint8Array {
  const { width, height, terrain } = grid;
  const size = width * height;
  const seen = new Uint8Array(size);
  const ocean = new Uint8Array(size);
  let best: number[] = [];
  const queue: number[] = [];
  for (let start = 0; start < size; start++) {
    if (terrain[start] !== TERRAIN_CODES.water || seen[start] === 1) continue;
    const body: number[] = [];
    seen[start] = 1;
    queue.length = 0;
    queue.push(start);
    for (let head = 0; head < queue.length; head++) {
      const ref = queue[head];
      body.push(ref);
      const x = ref % width;
      if (x > 0) push(ref - 1);
      if (x < width - 1) push(ref + 1);
      if (ref >= width) push(ref - width);
      if (ref < size - width) push(ref + width);
    }
    if (body.length > best.length) best = body;
  }
  for (const ref of best) ocean[ref] = 1;
  return ocean;

  function push(ref: number): void {
    if (seen[ref] === 1 || terrain[ref] !== TERRAIN_CODES.water) return;
    seen[ref] = 1;
    queue.push(ref);
  }
}

/**
 * Shoreline: land that touches water, and water that touches land.
 * Impassable tiles are never shoreline — they render as background.
 */
export function shorelineMask(grid: EditorGrid): Uint8Array {
  const { width, height, terrain } = grid;
  const size = width * height;
  const shore = new Uint8Array(size);
  const isWater = (ref: number) => terrain[ref] === TERRAIN_CODES.water;
  for (let ref = 0; ref < size; ref++) {
    if (terrain[ref] === TERRAIN_CODES.impassable) continue;
    const water = isWater(ref);
    const x = ref % width;
    const neighbours: number[] = [];
    if (x > 0) neighbours.push(ref - 1);
    if (x < width - 1) neighbours.push(ref + 1);
    if (ref >= width) neighbours.push(ref - width);
    if (ref < size - width) neighbours.push(ref + width);
    for (const n of neighbours) {
      // A land tile beside water, or a water tile beside anything solid.
      if (water ? !isWater(n) : isWater(n)) {
        shore[ref] = 1;
        break;
      }
    }
  }
  void height;
  return shore;
}

/** Each water tile's distance to the nearest land, by breadth-first search. */
export function waterDistance(grid: EditorGrid): Uint8Array {
  const { width, height, terrain } = grid;
  const size = width * height;
  const dist = new Uint8Array(size).fill(MAX_WATER_DISTANCE);
  const queue: number[] = [];
  for (let ref = 0; ref < size; ref++) {
    if (terrain[ref] === TERRAIN_CODES.water) continue;
    dist[ref] = 0;
    queue.push(ref);
  }
  for (let head = 0; head < queue.length; head++) {
    const ref = queue[head];
    const next = dist[ref] + 1;
    if (next > MAX_WATER_DISTANCE) continue;
    const x = ref % width;
    if (x > 0) relax(ref - 1, next);
    if (x < width - 1) relax(ref + 1, next);
    if (ref >= width) relax(ref - width, next);
    if (ref < size - width) relax(ref + width, next);
  }
  void height;
  return dist;

  function relax(ref: number, d: number): void {
    if (terrain[ref] !== TERRAIN_CODES.water || dist[ref] <= d) return;
    dist[ref] = d;
    queue.push(ref);
  }
}

/** The grid as the bytes the game loads, with the land count the manifest needs. */
export function packGrid(grid: EditorGrid): PackedMap {
  const { width, height, terrain, elevation } = grid;
  const size = width * height;
  const ocean = oceanMask(grid);
  const shore = shorelineMask(grid);
  const dist = waterDistance(grid);
  const bin = new Uint8Array(size);
  let land = 0;
  for (let ref = 0; ref < size; ref++) {
    if (terrain[ref] === TERRAIN_CODES.impassable) {
      bin[ref] = 0b10011111;
      continue;
    }
    let byte = 0;
    if (terrain[ref] === TERRAIN_CODES.land) {
      byte |= 0b1000_0000;
      land++;
      byte |= Math.min(MAX_ELEVATION, elevation[ref]);
    } else {
      byte |= Math.min(IMPASSABLE_MAGNITUDE, Math.ceil(dist[ref] / 2));
    }
    if (shore[ref] === 1) byte |= 0b0100_0000;
    if (ocean[ref] === 1) byte |= 0b0010_0000;
    bin[ref] = byte;
  }
  return { meta: { width, height, num_land_tiles: land }, bin };
}

/**
 * The grid at half scale. Water wins a contested cell so narrow rivers
 * survive; impassable beats land; elevation is the first land seen, which
 * keeps the scaling deterministic.
 */
export function halveGrid(grid: EditorGrid): EditorGrid {
  const w = Math.max(1, Math.floor(grid.width / 2));
  const h = Math.max(1, Math.floor(grid.height / 2));
  const out = createGrid(w, h);
  const written = new Uint8Array(w * h);
  for (let y = 0; y < grid.height; y++) {
    const my = Math.floor(y / 2);
    if (my >= h) continue;
    for (let x = 0; x < grid.width; x++) {
      const mx = Math.floor(x / 2);
      if (mx >= w) continue;
      const src = y * grid.width + x;
      const dst = my * w + mx;
      const from = grid.terrain[src];
      const to = out.terrain[dst];
      if (written[dst] === 1 && to === TERRAIN_CODES.water) continue;
      if (from === TERRAIN_CODES.water) {
        out.terrain[dst] = TERRAIN_CODES.water;
        out.elevation[dst] = 0;
        written[dst] = 1;
        continue;
      }
      if (written[dst] === 1 && to === TERRAIN_CODES.impassable) continue;
      out.terrain[dst] = from;
      out.elevation[dst] = grid.elevation[src];
      written[dst] = 1;
    }
  }
  return out;
}

/**
 * The grid a packed map came from, as far as an editor needs it: the type
 * of every tile and, for land, its elevation. The derived bits — ocean,
 * shoreline, a water tile's distance — are recomputed on the way out, so
 * a package opened in the editor and exported again is the same map.
 */
export function gridFromPacked(
  meta: { width: number; height: number },
  bin: Uint8Array,
): EditorGrid {
  const grid = createGrid(meta.width, meta.height);
  for (let i = 0; i < grid.terrain.length && i < bin.length; i++) {
    const byte = bin[i];
    const magnitude = byte & 0b0001_1111;
    if ((byte & 0b1000_0000) === 0) {
      grid.terrain[i] = TERRAIN_CODES.water;
      continue;
    }
    if (magnitude === IMPASSABLE_MAGNITUDE) {
      grid.terrain[i] = TERRAIN_CODES.impassable;
      continue;
    }
    grid.terrain[i] = TERRAIN_CODES.land;
    grid.elevation[i] = magnitude;
  }
  return grid;
}

export interface MapPackageNation {
  name: string;
  coordinates: [number, number];
  flag?: string;
}

export interface MapPackageInput {
  name: string;
  grid: EditorGrid;
  nations: MapPackageNation[];
}

export interface MapPackage {
  manifest: {
    name: string;
    map: MapMetadataOut;
    map4x: MapMetadataOut;
    map16x: MapMetadataOut;
    nations: MapPackageNation[];
  };
  mapBin: Uint8Array;
  map4xBin: Uint8Array;
  map16xBin: Uint8Array;
}

/** A painted grid and its nations as a package the game can load. */
export function buildMapPackage(input: MapPackageInput): MapPackage {
  const full = packGrid(input.grid);
  const half = halveGrid(input.grid);
  const quarter = halveGrid(half);
  const packed4x = packGrid(half);
  const packed16x = packGrid(quarter);
  return {
    manifest: {
      name: input.name,
      map: full.meta,
      map4x: packed4x.meta,
      map16x: packed16x.meta,
      nations: input.nations.map((n) => ({
        name: n.name,
        coordinates: [n.coordinates[0], n.coordinates[1]],
        ...(n.flag === undefined ? {} : { flag: n.flag }),
      })),
    },
    mapBin: full.bin,
    map4xBin: packed4x.bin,
    map16xBin: packed16x.bin,
  };
}

/** What a package needs before it is worth exporting; empty when it is fine. */
export function validatePackage(input: MapPackageInput): string[] {
  const problems: string[] = [];
  const { grid } = input;
  if (input.name.trim() === "") problems.push("map_editor.problem_name");
  if (grid.width < 16 || grid.height < 16) {
    problems.push("map_editor.problem_size");
  }
  let land = 0;
  for (let i = 0; i < grid.terrain.length; i++) {
    if (grid.terrain[i] === TERRAIN_CODES.land) land++;
  }
  if (land < 64) problems.push("map_editor.problem_land");
  if (input.nations.length === 0) problems.push("map_editor.problem_nations");
  for (const n of input.nations) {
    const [x, y] = n.coordinates;
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
      problems.push("map_editor.problem_nation_off_map");
      break;
    }
    if (grid.terrain[y * grid.width + x] !== TERRAIN_CODES.land) {
      problems.push("map_editor.problem_nation_at_sea");
      break;
    }
  }
  return problems;
}
