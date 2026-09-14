import fs from "fs/promises";
import path from "path";
import { normalizeAssetPath } from "src/core/AssetUrls";
import { GameMapType } from "src/core/game/Game";
import { fileURLToPath } from "url";
import { logger } from "./Logger";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";

const log = logger.child({ component: "MapLandTiles" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const staticDir = path.join(__dirname, "../../static");
export const resourcesDir = path.join(__dirname, "../../resources");

const landTilesCache = new Map<GameMapType, number>();

export function mapDirName(map: GameMapType): string {
  const key = (
    Object.keys(GameMapType) as Array<keyof typeof GameMapType>
  ).find((k) => GameMapType[k] === map);
  if (!key) throw new Error(`Unknown map: ${map}`);
  return key.toLowerCase();
}

/**
 * Where a map file lives on this server: the hashed copy under static/ in
 * production (via the runtime asset manifest), resources/ in dev. The
 * Dockerfile deletes resources/maps in production, so the second branch
 * only runs locally. Shared with ServerMapLoader, which reads the binaries.
 */
export async function mapFilePath(
  map: GameMapType,
  file: string,
): Promise<string> {
  const relativePath = `maps/${mapDirName(map)}/${file}`;
  const assetManifest = await getRuntimeAssetManifest();
  const hashedUrl = assetManifest[relativePath];
  if (hashedUrl) {
    return path.join(staticDir, normalizeAssetPath(hashedUrl));
  }
  return path.join(resourcesDir, relativePath);
}

async function readManifestFile(map: GameMapType): Promise<string> {
  return fs.readFile(await mapFilePath(map, "manifest.json"), "utf8");
}

// Gets the number of land tiles for a map.
export async function getMapLandTiles(map: GameMapType): Promise<number> {
  const cached = landTilesCache.get(map);
  if (cached !== undefined) return cached;

  try {
    const raw = await readManifestFile(map);
    const tiles = (JSON.parse(raw) as { map: { num_land_tiles: number } }).map
      .num_land_tiles;
    landTilesCache.set(map, tiles);
    return tiles;
  } catch (error) {
    log.error(`Failed to load manifest for ${map}: ${error}`, { map });
    return 1_000_000; // Default fallback
  }
}
