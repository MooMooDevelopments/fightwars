import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { GameMapSize, GameMapType, UnitType } from "../../src/core/game/Game";
import { GameMapLoader, MapData } from "../../src/core/game/GameMapLoader";
import { MapManifest } from "../../src/core/game/TerrainMapLoader";
import { GameStartInfo, StampedIntent, Turn } from "../../src/core/Schemas";
import { ShadowSim } from "../../src/server/ShadowSim";
import { testGameConfig } from "../util/Wire";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAINS = path.join(__dirname, "../testdata/maps/plains");

/** Serves the plains test map whatever map the start info names. */
class PlainsLoader implements GameMapLoader {
  getMapData(_map: GameMapType): MapData {
    const readBin = (name: string) => async () =>
      new Uint8Array(fs.readFileSync(path.join(PLAINS, name)));
    return {
      mapBin: readBin("map.bin"),
      map4xBin: readBin("map4x.bin"),
      map16xBin: readBin("map16x.bin"),
      manifest: async () => {
        // The test manifest has no nations; the loader gives it an empty
        // list, as the map loader in tests/util/Setup.ts does.
        const manifest = JSON.parse(
          fs.readFileSync(path.join(PLAINS, "manifest.json"), "utf8"),
        ) as MapManifest;
        return { ...manifest, nations: manifest.nations ?? [] };
      },
      webpPath: "",
      layerPng: async () => {
        throw new Error("no layers");
      },
    };
  }
}

class FailingLoader implements GameMapLoader {
  getMapData(): MapData {
    throw new Error("no such map");
  }
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function startInfo(over: Partial<GameStartInfo["config"]> = {}): GameStartInfo {
  return {
    gameID: "shadow-test",
    lobbyCreatedAt: 0,
    config: testGameConfig({
      gameMap: GameMapType.World,
      gameMapSize: GameMapSize.Normal,
      bots: 0,
      ...over,
    }),
    players: [
      { clientID: "alice", username: "Alice", clanTag: "AAA" },
      { clientID: "bob", username: "Bob", clanTag: "BBB" },
      { clientID: "carol", username: "Carol", clanTag: "CCC" },
    ],
  } as GameStartInfo;
}

const stamped = (clientID: string, intent: object): StampedIntent =>
  ({ ...intent, clientID }) as StampedIntent;

const turn = (n: number, intents: StampedIntent[] = []): Turn => ({
  turnNumber: n,
  intents,
});

/** Apply empty turns until the spawn phase is over. */
function runPastSpawn(shadow: ShadowSim, from: number): number {
  let n = from;
  while (shadow.game()!.inSpawnPhase() && n < 2000) {
    shadow.applyTurn(turn(n++));
  }
  expect(shadow.game()!.inSpawnPhase()).toBe(false);
  return n;
}

/**
 * The server's own copy of the game (HANDOFF §7 headline 1). It judges
 * only what cannot become possible within a turn, and judges nothing
 * until its map has loaded.
 */
describe("ShadowSim", () => {
  it("judges nothing before it is ready, and applies the turns it missed once it is", async () => {
    const shadow = new ShadowSim(startInfo(), new PlainsLoader(), log);
    expect(shadow.ready()).toBe(false);
    expect(
      shadow.check(
        stamped("nobody", { type: "attack", targetID: null, troops: 1 }),
      ),
    ).toBeNull();
    shadow.applyTurn(turn(0));
    shadow.applyTurn(turn(1));
    await shadow.start();
    expect(shadow.ready()).toBe(true);
    expect(shadow.ticks()).toBe(2);
  });

  it("has no win until the sim declares one", async () => {
    const shadow = new ShadowSim(startInfo(), new PlainsLoader(), log);
    await shadow.start();
    for (let n = 0; n < 25; n++) shadow.applyTurn(turn(n));
    expect(shadow.winResult()).toBeNull();
  });

  it("keeps the hashes its own sim produced, by tick", async () => {
    const shadow = new ShadowSim(startInfo(), new PlainsLoader(), log);
    await shadow.start();
    for (let n = 0; n < 25; n++) shadow.applyTurn(turn(n));
    // The core hashes every ten ticks; a tick it did not hash has nothing.
    expect(shadow.hashAt(10)).toEqual(expect.any(Number));
    expect(shadow.hashAt(20)).toEqual(expect.any(Number));
    expect(shadow.hashAt(11)).toBeNull();
    expect(shadow.hashAt(30)).toBeNull();
  });

  it("never refuses when its map cannot load", async () => {
    // A different size: the terrain loader caches by map and size, and the
    // test above has already loaded this map at Normal.
    const shadow = new ShadowSim(
      startInfo({ gameMapSize: GameMapSize.Compact }),
      new FailingLoader(),
      log,
    );
    await shadow.start();
    expect(shadow.ready()).toBe(false);
    shadow.applyTurn(turn(0));
    expect(
      shadow.check(
        stamped("nobody", { type: "attack", targetID: null, troops: 1 }),
      ),
    ).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it("lets control intents and spawns through, and refuses a client the game does not have", async () => {
    const shadow = new ShadowSim(startInfo(), new PlainsLoader(), log);
    await shadow.start();
    expect(
      shadow.check(stamped("nobody", { type: "toggle_pause", paused: true })),
    ).toBeNull();
    expect(
      shadow.check(stamped("alice", { type: "spawn", tile: 5 })),
    ).toBeNull();
    expect(shadow.check(stamped("nobody", { type: "spawn", tile: 5 }))).toBe(
      "no player for this client",
    );
    expect(
      shadow.check(
        stamped("ghost", { type: "attack", targetID: null, troops: 1 }),
      ),
    ).toBe("no player for this client");
  });

  it("refuses what the lobby disabled, an attack on oneself, and an unknown target or unit", async () => {
    const shadow = new ShadowSim(
      startInfo({ disabledUnits: [UnitType.Warship] }),
      new PlainsLoader(),
      log,
    );
    await shadow.start();
    const alice = shadow.game()!.playerByClientID("alice")!;
    expect(
      shadow.check(
        stamped("alice", {
          type: "build_unit",
          unit: UnitType.Warship,
          tile: 5,
        }),
      ),
    ).toBe("unit type disabled in this lobby");
    expect(
      shadow.check(
        stamped("alice", { type: "build_unit", unit: UnitType.City, tile: 5 }),
      ),
    ).toBeNull();
    expect(
      shadow.check(
        stamped("alice", { type: "attack", targetID: alice.id(), troops: 1 }),
      ),
    ).toBe("attacking self");
    expect(
      shadow.check(
        stamped("alice", {
          type: "attack",
          targetID: "no-such-player",
          troops: 1,
        }),
      ),
    ).toBe("unknown target");
    expect(
      shadow.check(
        stamped("alice", { type: "move_warship", unitIds: [424242], tile: 5 }),
      ),
    ).toBe("unknown unit");
  });

  it("refuses a dead player, and a unit that is somebody else's", async () => {
    const shadow = new ShadowSim(startInfo(), new PlainsLoader(), log);
    await shadow.start();
    const game = shadow.game()!;
    const alice = game.playerByClientID("alice")!;
    const bob = game.playerByClientID("bob")!;
    // Alice and Bob spawn in the first turn; Carol never does.
    const aliceTile = game.ref(20, 20);
    const bobTile = game.ref(70, 20);
    let n = 0;
    shadow.applyTurn(
      turn(n++, [
        stamped("alice", { type: "spawn", tile: aliceTile }),
        stamped("bob", { type: "spawn", tile: bobTile }),
      ]),
    );
    runPastSpawn(shadow, n);

    expect(alice.isAlive()).toBe(true);
    expect(bob.isAlive()).toBe(true);
    expect(
      shadow.check(
        stamped("bob", { type: "attack", targetID: null, troops: 1 }),
      ),
    ).toBeNull();
    expect(
      shadow.check(
        stamped("carol", { type: "attack", targetID: null, troops: 1 }),
      ),
    ).toBe("player is dead");
    expect(
      shadow.check(stamped("carol", { type: "spawn", tile: aliceTile })),
    ).toBe("spawn phase is over");

    const city = bob.buildUnit(UnitType.City, bob.spawnTile()!, {});
    expect(
      shadow.check(stamped("bob", { type: "delete_unit", unitId: city.id() })),
    ).toBeNull();
    expect(
      shadow.check(
        stamped("bob", {
          type: "move_warship",
          unitIds: [city.id()],
          tile: bobTile,
        }),
      ),
    ).toBeNull();
    // Alice is alive and the city is Bob's.
    expect(
      shadow.check(
        stamped("alice", { type: "delete_unit", unitId: city.id() }),
      ),
    ).toBe("unit not owned");
    expect(
      shadow.check(
        stamped("alice", {
          type: "move_warship",
          unitIds: [city.id()],
          tile: aliceTile,
        }),
      ),
    ).toBe("unit not owned");
  });
});
