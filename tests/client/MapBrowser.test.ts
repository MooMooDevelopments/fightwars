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

const fetchCommunityMaps = vi.fn();
const fetchCommunityMap = vi.fn();
const rateCommunityMap = vi.fn();
const publishCommunityMap = vi.fn();
vi.mock("../../src/client/Api", () => ({
  fetchCommunityMaps: (...a: unknown[]) => fetchCommunityMaps(...a),
  fetchCommunityMap: (...a: unknown[]) => fetchCommunityMap(...a),
  rateCommunityMap: (...a: unknown[]) => rateCommunityMap(...a),
  publishCommunityMap: (...a: unknown[]) => publishCommunityMap(...a),
  getUserMe: vi.fn(async () => false),
  invalidateUserMe: vi.fn(),
  fetchPlayerById: vi.fn(async () => false),
}));

import { MapBrowserModal } from "../../src/client/MapBrowserModal";
import { CommunityMap } from "../../src/core/ApiSchemas";
import {
  buildMapPackage,
  createGrid,
  TERRAIN_CODES,
} from "../../src/core/game/MapPackage";

const MAP: CommunityMap = {
  id: "map-1",
  name: "Northern Reach",
  author: "mapmaker",
  width: 32,
  height: 32,
  nations: 2,
  createdAt: new Date().toISOString(),
  ratingAverage: null,
  ratingCount: 0,
};

/** The community browser: what it lists, what it rates, what it opens. */
describe("map browser", () => {
  const browser = () => new MapBrowserModal() as any;

  it("lists what the API returns and re-fetches when the sort changes", async () => {
    fetchCommunityMaps.mockResolvedValue([MAP]);
    const b = browser();
    await b.refresh();
    expect(fetchCommunityMaps).toHaveBeenCalledWith("new");
    expect(b.maps).toEqual([MAP]);
    await b.setSort("rating");
    expect(fetchCommunityMaps).toHaveBeenLastCalledWith("rating");
    // Choosing the sort it already has costs nothing.
    const calls = fetchCommunityMaps.mock.calls.length;
    await b.setSort("rating");
    expect(fetchCommunityMaps.mock.calls.length).toBe(calls);
  });

  it("puts a rating straight onto the row, and says so when signed out", async () => {
    fetchCommunityMaps.mockResolvedValue([MAP]);
    const b = browser();
    await b.refresh();
    rateCommunityMap.mockResolvedValue({ average: 4.5, count: 2 });
    await b.rate("map-1", 5);
    expect(rateCommunityMap).toHaveBeenCalledWith("map-1", 5);
    expect(b.maps[0]).toMatchObject({ ratingAverage: 4.5, ratingCount: 2 });
    expect(b.message).toBeNull();

    rateCommunityMap.mockResolvedValue(null);
    await b.rate("map-1", 1);
    expect(b.message).toBe("map_browser.rate_failed");
    // The row keeps the rating it had rather than showing a lie.
    expect(b.maps[0].ratingAverage).toBe(4.5);
  });

  it("hands a fetched package to the editor", async () => {
    const g = createGrid(32, 32);
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) {
        g.terrain[y * g.width + x] = TERRAIN_CODES.land;
        g.elevation[y * g.width + x] = 5;
      }
    }
    const built = buildMapPackage({
      name: "Northern Reach",
      grid: g,
      nations: [{ name: "Northport", coordinates: [10, 10] }],
    });
    const b64 = (bytes: Uint8Array) => {
      let s = "";
      for (const byte of bytes) s += String.fromCharCode(byte);
      return btoa(s);
    };
    const pkg = {
      format: "fightwars-map/1",
      manifest: built.manifest,
      mapBin: b64(built.mapBin),
      map4xBin: b64(built.map4xBin),
      map16xBin: b64(built.map16xBin),
    };
    fetchCommunityMap.mockResolvedValue(pkg);

    const loaded: unknown[] = [];
    const editor = document.createElement("div");
    (editor as any).loadPackage = (p: unknown) => loaded.push(p);
    (editor as any).open = vi.fn(async () => undefined);
    vi.spyOn(document, "querySelector").mockReturnValue(editor);

    const b = browser();
    b.close = vi.fn();
    await b.openInEditor("map-1");

    expect(fetchCommunityMap).toHaveBeenCalledWith("map-1");
    expect(loaded).toEqual([pkg]);
    expect((editor as any).open).toHaveBeenCalledOnce();
    expect(b.close).toHaveBeenCalledOnce();
    expect(b.message).toBeNull();
    vi.restoreAllMocks();
  });

  it("says so when the package cannot be fetched", async () => {
    fetchCommunityMap.mockResolvedValue(null);
    const b = browser();
    await b.openInEditor("gone");
    expect(b.message).toBe("map_browser.open_failed");
    expect(b.fetchingId).toBeNull();
  });
});
