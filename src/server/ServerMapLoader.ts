import fs from "fs/promises";
import { GameMapType } from "../core/game/Game";
import { GameMapLoader, MapData } from "../core/game/GameMapLoader";
import { MapManifest } from "../core/game/TerrainMapLoader";
import { mapFilePath } from "./MapLandTiles";

/**
 * The map files as the server sees them, for the shadow simulation. The
 * same resolution MapLandTiles uses for a manifest — the hashed copy under
 * static/ in production, resources/ in dev — applied to the terrain
 * binaries. Layer images are never wanted server-side.
 */
export class ServerMapLoader implements GameMapLoader {
  getMapData(map: GameMapType): MapData {
    const readBin = (name: string) => async () =>
      new Uint8Array(await fs.readFile(await mapFilePath(map, name)));
    return {
      mapBin: readBin("map.bin"),
      map4xBin: readBin("map4x.bin"),
      map16xBin: readBin("map16x.bin"),
      manifest: async () =>
        JSON.parse(
          await fs.readFile(await mapFilePath(map, "manifest.json"), "utf8"),
        ) as MapManifest,
      webpPath: "",
      layerPng: async () => {
        throw new Error("the server never loads map layers");
      },
    };
  }
}
