/**
 * The community map browser (brief §6.9): maps made in the in-browser
 * editor, published, listed and rated.
 *
 * A published map is the editor's own export — the manifest and the three
 * binaries, base64'd — stored whole, plus the row that makes it findable.
 * The API checks the package before it stores it: the three binaries must
 * be exactly `width * height` bytes for the dimensions they claim, every
 * nation must stand on land, and the whole thing must fit inside the size
 * cap. A map that passes can be handed straight to `genTerrainFromBin`.
 *
 * Ratings are one to five stars, one per account per map, changeable; the
 * listing carries the average and the count so a browser can sort by them.
 */
import type { Db } from "./Db";

export const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
const LAND_BIT = 0b1000_0000;
const MAGNITUDE_MASK = 0b0001_1111;
const IMPASSABLE_MAGNITUDE = 31;

export interface MapPackageFile {
  format: string;
  manifest: {
    name: string;
    map: { width: number; height: number; num_land_tiles: number };
    map4x: { width: number; height: number; num_land_tiles: number };
    map16x: { width: number; height: number; num_land_tiles: number };
    nations: { name: string; coordinates: [number, number]; flag?: string }[];
  };
  mapBin: string;
  map4xBin: string;
  map16xBin: string;
}

export interface MapRow {
  id: string;
  name: string;
  author: string | null;
  width: number;
  height: number;
  nations: number;
  createdAt: string;
  ratingAverage: number | null;
  ratingCount: number;
}

function decode(b64: string): Uint8Array {
  const buf = Buffer.from(b64, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * What is wrong with a package, as translation-free reasons; empty when it
 * is loadable. Checked here and not only in the editor, because the editor
 * is a client and a client is not a gate.
 */
export function validatePackageFile(pkg: MapPackageFile): string[] {
  const problems: string[] = [];
  if (pkg.format !== "fightwars-map/1") problems.push("unknown_format");
  const m = pkg.manifest;
  if (m.name.trim() === "" || m.name.length > 60) problems.push("bad_name");
  const scales: [string, { width: number; height: number }, string][] = [
    ["map", m.map, pkg.mapBin],
    ["map4x", m.map4x, pkg.map4xBin],
    ["map16x", m.map16x, pkg.map16xBin],
  ];
  let full: Uint8Array | null = null;
  for (const [label, meta, b64] of scales) {
    // The full map has a floor; the two minimaps are it halved and halved
    // again, so they only have to be positive and inside the ceiling.
    const min = label === "map" ? 16 : 1;
    if (
      meta.width < min ||
      meta.height < min ||
      meta.width > 4096 ||
      meta.height > 4096
    ) {
      problems.push(`bad_dimensions_${label}`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = decode(b64);
    } catch {
      problems.push(`bad_base64_${label}`);
      continue;
    }
    if (bytes.length !== meta.width * meta.height) {
      problems.push(`bad_length_${label}`);
      continue;
    }
    if (label === "map") full = bytes;
  }
  if (full !== null) {
    let land = 0;
    for (let i = 0; i < full.length; i++) {
      if (
        (full[i] & LAND_BIT) !== 0 &&
        (full[i] & MAGNITUDE_MASK) !== IMPASSABLE_MAGNITUDE
      ) {
        land++;
      }
    }
    if (land !== m.map.num_land_tiles) problems.push("land_count_disagrees");
    if (land < 64) problems.push("too_little_land");
    if (m.nations.length === 0) problems.push("no_nations");
    if (m.nations.length > 400) problems.push("too_many_nations");
    for (const n of m.nations) {
      const [x, y] = n.coordinates;
      if (x < 0 || y < 0 || x >= m.map.width || y >= m.map.height) {
        problems.push("nation_off_map");
        break;
      }
      if ((full[y * m.map.width + x] & LAND_BIT) === 0) {
        problems.push("nation_at_sea");
        break;
      }
    }
  }
  return problems;
}

export async function publishMap(
  db: Db,
  persistentId: string,
  pkg: MapPackageFile,
): Promise<{ id: string }> {
  const row = await db.query<{ id: string }>(
    `INSERT INTO community_maps
       (name, persistent_id, width, height, num_nations, package)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      pkg.manifest.name.trim(),
      persistentId,
      pkg.manifest.map.width,
      pkg.manifest.map.height,
      pkg.manifest.nations.length,
      JSON.stringify(pkg),
    ],
  );
  return { id: row.rows[0].id };
}

export type MapSort = "new" | "rating";

export async function listMaps(
  db: Db,
  sort: MapSort,
  limit: number,
  offset: number,
): Promise<MapRow[]> {
  const order =
    sort === "rating"
      ? "AVG(r.stars) DESC NULLS LAST, m.created_at DESC"
      : "m.created_at DESC";
  const rows = await db.query<{
    id: string;
    name: string;
    username: string | null;
    width: number;
    height: number;
    num_nations: number;
    created_at: Date;
    avg: string | null;
    count: string;
  }>(
    `SELECT m.id, m.name, a.username, m.width, m.height, m.num_nations,
            m.created_at, AVG(r.stars) AS avg, COUNT(r.stars) AS count
       FROM community_maps m
       JOIN accounts a ON a.persistent_id = m.persistent_id
       LEFT JOIN community_map_ratings r ON r.map_id = m.id
      GROUP BY m.id, a.username
      ORDER BY ${order}
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    author: r.username,
    width: r.width,
    height: r.height,
    nations: r.num_nations,
    createdAt: new Date(r.created_at).toISOString(),
    ratingAverage: r.avg === null ? null : Math.round(Number(r.avg) * 10) / 10,
    ratingCount: Number(r.count),
  }));
}

export async function getMapPackage(
  db: Db,
  id: string,
): Promise<MapPackageFile | null> {
  const rows = await db.query<{ package: MapPackageFile }>(
    "SELECT package FROM community_maps WHERE id = $1",
    [id],
  );
  return rows.rows[0]?.package ?? null;
}

export async function rateMap(
  db: Db,
  id: string,
  persistentId: string,
  stars: number,
): Promise<{ average: number; count: number } | null> {
  const exists = await db.query<{ id: string }>(
    "SELECT id FROM community_maps WHERE id = $1",
    [id],
  );
  if (exists.rows.length === 0) return null;
  await db.query(
    `INSERT INTO community_map_ratings (map_id, persistent_id, stars, rated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (map_id, persistent_id) DO UPDATE SET
       stars = EXCLUDED.stars, rated_at = now()`,
    [id, persistentId, stars],
  );
  const agg = await db.query<{ avg: string | null; count: string }>(
    "SELECT AVG(stars) AS avg, COUNT(*) AS count FROM community_map_ratings WHERE map_id = $1",
    [id],
  );
  return {
    average: Math.round(Number(agg.rows[0].avg ?? 0) * 10) / 10,
    count: Number(agg.rows[0].count),
  };
}
