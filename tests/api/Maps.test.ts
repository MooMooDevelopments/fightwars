// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validatePackageFile } from "../../src/api/Maps";
import { CommunityMapListSchema } from "../../src/core/ApiSchemas";
import {
  buildMapPackage,
  createGrid,
  TERRAIN_CODES,
} from "../../src/core/game/MapPackage";
import { call, guest, startTestApi } from "./fixtures";

/**
 * The community map browser (brief §6.9): publish an editor package, list
 * it with its rating, fetch it back, rate it once per account.
 */
function packageFile(name = "Test Isle") {
  const g = createGrid(32, 32);
  for (let y = 8; y < 24; y++) {
    for (let x = 8; x < 24; x++) {
      g.terrain[y * g.width + x] = TERRAIN_CODES.land;
      g.elevation[y * g.width + x] = 5;
    }
  }
  const pkg = buildMapPackage({
    name,
    grid: g,
    nations: [{ name: "Northport", coordinates: [10, 10] }],
  });
  const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
  return {
    format: "fightwars-map/1" as const,
    manifest: pkg.manifest,
    mapBin: b64(pkg.mapBin),
    map4xBin: b64(pkg.map4xBin),
    map16xBin: b64(pkg.map16xBin),
  };
}

describe("community maps", () => {
  it("accepts a real package and names what is wrong with a doctored one", () => {
    const good = packageFile();
    expect(validatePackageFile(good)).toEqual([]);
    expect(
      validatePackageFile({ ...good, format: "something-else" }),
    ).toContain("unknown_format");
    expect(
      validatePackageFile({
        ...good,
        mapBin: Buffer.from(new Uint8Array(10)).toString("base64"),
      }),
    ).toContain("bad_length_map");
    expect(
      validatePackageFile({
        ...good,
        manifest: {
          ...good.manifest,
          map: { ...good.manifest.map, num_land_tiles: 7 },
        },
      }),
    ).toContain("land_count_disagrees");
    expect(
      validatePackageFile({
        ...good,
        manifest: { ...good.manifest, nations: [] },
      }),
    ).toContain("no_nations");
    expect(
      validatePackageFile({
        ...good,
        manifest: {
          ...good.manifest,
          nations: [{ name: "x", coordinates: [0, 0] as [number, number] }],
        },
      }),
    ).toContain("nation_at_sea");
  });

  describe("through the API", () => {
    let api: Awaited<ReturnType<typeof startTestApi>>;
    beforeAll(async () => {
      api = await startTestApi();
    });
    afterAll(async () => {
      await api.close();
    });

    it("publishes, lists with ratings, serves the package and refuses junk", async () => {
      const author = await guest(api.base, randomUUID());
      const rater = await guest(api.base, randomUUID());

      // Anonymous publishing is refused.
      expect(
        (await call(api.base, null, "POST", "/maps", packageFile())).status,
      ).toBe(401);

      const created = await call(
        api.base,
        author,
        "POST",
        "/maps",
        packageFile("Northern Reach"),
      );
      expect(created.status).toBe(201);
      const id = (created.json as { id: string }).id;
      expect(id).toBeTruthy();

      // A package the schema likes but the checker does not.
      const broken = packageFile();
      broken.manifest.nations = [];
      const refused = await call(api.base, author, "POST", "/maps", broken);
      expect(refused.status).toBe(400);
      expect((refused.json as { problems: string[] }).problems).toContain(
        "no_nations",
      );
      expect(
        (await call(api.base, author, "POST", "/maps", { nope: true })).status,
      ).toBe(400);

      const listed = CommunityMapListSchema.parse(
        (await call(api.base, null, "GET", "/maps")).json,
      );
      expect(listed.maps).toHaveLength(1);
      expect(listed.maps[0]).toMatchObject({
        id,
        name: "Northern Reach",
        width: 32,
        height: 32,
        nations: 1,
        ratingAverage: null,
        ratingCount: 0,
      });

      const fetched = await call(api.base, null, "GET", `/maps/${id}`);
      expect(fetched.status).toBe(200);
      const pkg = fetched.json as ReturnType<typeof packageFile>;
      expect(pkg.manifest.name).toBe("Northern Reach");
      expect(validatePackageFile(pkg)).toEqual([]);
      expect(
        (await call(api.base, null, "GET", `/maps/${randomUUID()}`)).status,
      ).toBe(404);

      // Ratings: one per account, changeable, averaged.
      expect(
        (await call(api.base, null, "POST", `/maps/${id}/rating`, { stars: 5 }))
          .status,
      ).toBe(401);
      expect(
        (
          await call(api.base, rater, "POST", `/maps/${id}/rating`, {
            stars: 9,
          })
        ).status,
      ).toBe(400);
      const first = await call(api.base, rater, "POST", `/maps/${id}/rating`, {
        stars: 4,
      });
      expect(first.json).toEqual({ average: 4, count: 1 });
      const again = await call(api.base, rater, "POST", `/maps/${id}/rating`, {
        stars: 2,
      });
      expect(again.json).toEqual({ average: 2, count: 1 });
      const other = await call(api.base, author, "POST", `/maps/${id}/rating`, {
        stars: 5,
      });
      expect(other.json).toEqual({ average: 3.5, count: 2 });
      expect(
        (
          await call(api.base, rater, "POST", `/maps/${randomUUID()}/rating`, {
            stars: 3,
          })
        ).status,
      ).toBe(404);

      const rated = CommunityMapListSchema.parse(
        (await call(api.base, null, "GET", "/maps?sort=rating")).json,
      );
      expect(rated.maps[0]).toMatchObject({
        ratingAverage: 3.5,
        ratingCount: 2,
      });
    });
  });
});
