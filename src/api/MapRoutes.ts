/**
 * Community map routes (brief §6.9):
 *
 *   POST /maps                 publish an editor package (auth)
 *   GET  /maps?sort=&page=     the browser's listing, with ratings
 *   GET  /maps/:id             the package itself, as the editor exported it
 *   POST /maps/:id/rating      one to five stars, one per account (auth)
 *
 * A package is checked before it is stored (`validatePackageFile`), so
 * anything the listing offers can be handed to the terrain loader.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  CommunityMapListSchema,
  MapPackageFileSchema,
} from "../core/ApiSchemas";
import type { ResolveCaller } from "./ClanRoutes";
import type { Db } from "./Db";
import {
  getMapPackage,
  listMaps,
  MAX_PACKAGE_BYTES,
  publishMap,
  rateMap,
  validatePackageFile,
} from "./Maps";

const PAGE = 24;

export function registerMapRoutes(
  app: Express,
  db: Db,
  resolveCaller: ResolveCaller,
): void {
  const requireCaller = async (
    req: Request,
    res: Response,
  ): Promise<string | null> => {
    const caller = await resolveCaller(req);
    if (caller === null) {
      res.status(401).json({ error: "unauthorized" });
      return null;
    }
    return caller.persistentId;
  };

  app.post("/maps", async (req, res) => {
    const persistentId = await requireCaller(req, res);
    if (persistentId === null) return;
    const parsed = MapPackageFileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_package" });
      return;
    }
    const size = JSON.stringify(parsed.data).length;
    if (size > MAX_PACKAGE_BYTES) {
      res.status(413).json({ error: "package_too_large" });
      return;
    }
    const problems = validatePackageFile(parsed.data);
    if (problems.length > 0) {
      res.status(400).json({ error: "invalid_map", problems });
      return;
    }
    const { id } = await publishMap(db, persistentId, parsed.data);
    res.status(201).json({ id });
  });

  app.get("/maps", async (req, res) => {
    const sort = req.query.sort === "rating" ? "rating" : "new";
    const page = Math.max(
      1,
      Number.parseInt(String(req.query.page ?? "1"), 10) || 1,
    );
    const maps = await listMaps(db, sort, PAGE, (page - 1) * PAGE);
    res.setHeader("Cache-Control", "no-store");
    res.json(CommunityMapListSchema.parse({ maps }));
  });

  app.get("/maps/:id", async (req, res) => {
    const pkg = await getMapPackage(db, req.params.id).catch(() => null);
    if (pkg === null) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(pkg);
  });

  app.post("/maps/:id/rating", async (req, res) => {
    const persistentId = await requireCaller(req, res);
    if (persistentId === null) return;
    const body = z
      .object({ stars: z.number().int().min(1).max(5) })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "bad_rating" });
      return;
    }
    const result = await rateMap(
      db,
      req.params.id,
      persistentId,
      body.data.stars,
    ).catch(() => null);
    if (result === null) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(result);
  });
}
