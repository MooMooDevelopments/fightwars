/**
 * Balance run (FightWars).
 *
 * Boots the headless full game with nothing but bots and nations in it, runs
 * it for a long horizon, and prints what the world looked like at the end:
 * who is alive, how the land is shared out, and what got built. Phase 5's
 * gate asks for a bot-vs-bot run per item, and the point of one is the
 * *shape* of the outcome — whether a change made the map concentrate faster,
 * stall, or leave more players standing — which no per-tick timing can show.
 *
 * It shares the perf harness's setup deliberately: same seed, same map, same
 * nations, so a balance run and a `perf:gate` run describe the same game.
 *
 * Usage: npx tsx scripts/balanceRun.ts [--ticks 5000] [--bots 150]
 *                                      [--map world] [--seed perf-gate]
 *                                      [--difficulty medium]
 *                                      [--no-supply] [--flat-terrain]
 *                                      [--no-upkeep] [--no-materials]
 *                                      [--no-blockades] [--no-embargo-price]
 *                                      [--legacy-fallout] [--flat-alliances]
 *                                      [--no-coalition] [--no-doctrines]
 *                                      [--no-unrest] [--flat-unrest]
 *                                      [--pacts-count] [--no-doctrine-play]
 *                                      [--cheap-materials] [--cheap-arms-upkeep]
 *
 * `--no-supply` turns the supply penalty and its attrition off, and
 * `--flat-terrain` turns the elevation curves off (the band table stays),
 * each leaving everything else alone, so one run against another is an A/B
 * of that one mechanic rather than of two different builds. Prefer a flag to
 * stashing the feature — a stash also removes the script doing the measuring.
 * Every Phase 5 mechanic should get one.
 */
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../src/core/configuration/Config";
import { Executor } from "../src/core/execution/ExecutionManager";
import {
  Difficulty,
  DOCTRINE_KEYS,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { createGame } from "../src/core/game/GameImpl";
import { GameUpdateType, HashUpdate } from "../src/core/game/GameUpdates";
import { createNationsForGame } from "../src/core/game/NationCreation";
import { loadTerrainMap } from "../src/core/game/TerrainMapLoader";
import { GameRunner } from "../src/core/GameRunner";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { GameConfig, GameStartInfo } from "../src/core/Schemas";
import { simpleHash } from "../src/core/Util";
import { NodeGameMapLoader } from "../tests/perf/fullgame/NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined
    ? process.argv[i + 1]
    : fallback;
}

/** The same game with supply lines charging nothing. */
class NoSupply extends Config {
  supplyMaxPenalty(): number {
    return 1;
  }
  supplyAttritionRate(): number {
    return 0;
  }
}

/** The same game with every alliance a full one and no ladder to climb. */
class FlatAlliances extends Config {
  allianceTiersEnabled(): boolean {
    return false;
  }
}

/** The same game with conquest breeding nothing and nobody rising. */
class NoUnrest extends Config {
  unrestEnabled(): boolean {
    return false;
  }
}

/** The same game with arms upkeep at its first-cut rates (post 5, silo 25, warship 40). */
class CheapArmsUpkeep extends Config {
  armsUpkeepScale(): number {
    return 1;
  }
}

/** The same game with the arms table at its first-cut prices (post 200, silo 1000, atom bomb 1500). */
class CheapMaterials extends Config {
  materialsPriceScale(): number {
    return 1;
  }
}

/** The same game with nations holding a doctrine but not playing it (prices only). */
class NoDoctrinePlay extends Config {
  doctrineNationBuildScale(): number {
    return 1;
  }
  doctrineNationExpandReserveScale(): number {
    return 1;
  }
}

/** The same game with Hard/Impossible nations counting pacts against the alliance cap. */
class PactsCount extends Config {
  allianceCapCountsPacts(): boolean {
    return true;
  }
}

/** The same game with the uprising threshold a flat 300 tiles for everyone. */
class FlatUnrest extends Config {
  unrestPartisanShare(): number {
    return 0;
  }
}

/** The same game with nobody holding a doctrine and nations not rolling one. */
class NoDoctrines extends Config {
  doctrinesEnabled(): boolean {
    return false;
  }
}

/** The same game with nobody ever offered a coalition. */
class NoCoalition extends Config {
  coalitionThreshold(): number {
    return 1.01;
  }
}

/** The same game with fallout as it was: permanent until conquered, then gone. */
class LegacyFallout extends Config {
  falloutHasConsequences(): boolean {
    return false;
  }
  falloutDurationTicks(): number {
    return 1_000_000_000;
  }
}

/** The same game with no blockades. */
class NoBlockades extends Config {
  blockadeRange(): number {
    return 0;
  }
}

/** The same game with embargoes free to receive again. */
class NoEmbargoPrice extends Config {
  embargoTariffMax(): number {
    return 0;
  }
}

/** The same game with arms costing no materials. */
class NoMaterials extends Config {
  unitMaterialsCost(): bigint {
    return 0n;
  }
}

/** The same game with no structure or warship upkeep. */
class NoUpkeep extends Config {
  unitUpkeep(): bigint {
    return 0n;
  }
}

/** The same game with elevation charging nothing beyond its band. */
class FlatTerrain extends Config {
  terrainHeightSlope(): number {
    return 0;
  }
  terrainClimbSlope(): number {
    return 0;
  }
  terrainHighGroundDefence(): number {
    return 0;
  }
}

/** Map name to enum member, the same spelling the perf harness accepts. */
function resolveMap(name: string): GameMapType {
  const key = Object.keys(GameMapType).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key === undefined) {
    throw new Error(`unknown map "${name}"`);
  }
  return GameMapType[key as keyof typeof GameMapType];
}

/** Difficulty name to enum member, case-insensitive. */
function resolveDifficulty(name: string): Difficulty {
  const key = Object.keys(Difficulty).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key === undefined) {
    throw new Error(`unknown difficulty "${name}"`);
  }
  return Difficulty[key as keyof typeof Difficulty];
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "0.0%" : `${((part / whole) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const ticks = Number(arg("--ticks", "5000"));
  const bots = Number(arg("--bots", "150"));
  const map = resolveMap(arg("--map", "world"));
  const difficulty = resolveDifficulty(arg("--difficulty", "medium"));
  const seed = arg("--seed", "perf-gate");
  const noSupply = process.argv.includes("--no-supply");
  const flatTerrain = process.argv.includes("--flat-terrain");
  const noUpkeep = process.argv.includes("--no-upkeep");
  const noMaterials = process.argv.includes("--no-materials");
  const noBlockades = process.argv.includes("--no-blockades");
  const noEmbargoPrice = process.argv.includes("--no-embargo-price");
  const legacyFallout = process.argv.includes("--legacy-fallout");
  const flatAlliances = process.argv.includes("--flat-alliances");
  const noCoalition = process.argv.includes("--no-coalition");
  const noDoctrines = process.argv.includes("--no-doctrines");
  const noUnrest = process.argv.includes("--no-unrest");
  const flatUnrest = process.argv.includes("--flat-unrest");
  const pactsCount = process.argv.includes("--pacts-count");
  const noDoctrinePlay = process.argv.includes("--no-doctrine-play");
  const cheapMaterials = process.argv.includes("--cheap-materials");
  const cheapArmsUpkeep = process.argv.includes("--cheap-arms-upkeep");
  if (
    [
      noSupply,
      flatTerrain,
      noUpkeep,
      noMaterials,
      noBlockades,
      noEmbargoPrice,
      legacyFallout,
      flatAlliances,
      noCoalition,
      noDoctrines,
      noUnrest,
      flatUnrest,
      pactsCount,
      noDoctrinePlay,
      cheapMaterials,
      cheapArmsUpkeep,
    ].filter(Boolean).length > 1
  ) {
    throw new Error("one lever at a time");
  }
  console.debug = () => {};
  console.log(
    `[balance] map=${map} difficulty=${Difficulty[difficulty]} bots=${bots} seed=${seed} ticks=${ticks}${noSupply ? " supply=off" : ""}${flatTerrain ? " terrain=flat" : ""}${noUpkeep ? " upkeep=off" : ""}${noMaterials ? " materials=off" : ""}${noBlockades ? " blockades=off" : ""}${noEmbargoPrice ? " embargo-price=off" : ""}${legacyFallout ? " fallout=legacy" : ""}${flatAlliances ? " alliances=flat" : ""}${noCoalition ? " coalition=off" : ""}${noDoctrines ? " doctrines=off" : ""}${noUnrest ? " unrest=off" : ""}${flatUnrest ? " unrest=flat" : ""}${pactsCount ? " alliance-cap=counts-pacts" : ""}${noDoctrinePlay ? " doctrine-play=off" : ""}${cheapMaterials ? " materials=cheap" : ""}${cheapArmsUpkeep ? " arms-upkeep=cheap" : ""}\n`,
  );

  const gameConfig: GameConfig = {
    gameMap: map,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
  };
  const gameStart: GameStartInfo = {
    gameID: seed,
    lobbyCreatedAt: 0,
    config: gameConfig,
    players: [],
  };

  const config = noSupply
    ? new NoSupply(gameConfig, null, false)
    : flatTerrain
      ? new FlatTerrain(gameConfig, null, false)
      : noUpkeep
        ? new NoUpkeep(gameConfig, null, false)
        : noMaterials
          ? new NoMaterials(gameConfig, null, false)
          : noBlockades
            ? new NoBlockades(gameConfig, null, false)
            : noEmbargoPrice
              ? new NoEmbargoPrice(gameConfig, null, false)
              : legacyFallout
                ? new LegacyFallout(gameConfig, null, false)
                : flatAlliances
                  ? new FlatAlliances(gameConfig, null, false)
                  : noCoalition
                    ? new NoCoalition(gameConfig, null, false)
                    : noDoctrines
                      ? new NoDoctrines(gameConfig, null, false)
                      : noUnrest
                        ? new NoUnrest(gameConfig, null, false)
                        : flatUnrest
                          ? new FlatUnrest(gameConfig, null, false)
                          : pactsCount
                            ? new PactsCount(gameConfig, null, false)
                            : noDoctrinePlay
                              ? new NoDoctrinePlay(gameConfig, null, false)
                              : cheapMaterials
                                ? new CheapMaterials(gameConfig, null, false)
                                : cheapArmsUpkeep
                                  ? new CheapArmsUpkeep(gameConfig, null, false)
                                  : new Config(gameConfig, null, false);
  const mapLoader = new NodeGameMapLoader(
    path.join(PROJECT_ROOT, "resources/maps"),
  );
  const terrain = await loadTerrainMap(map, GameMapSize.Normal, mapLoader);
  const random = new PseudoRandom(simpleHash(seed));
  const nations = createNationsForGame(
    gameStart,
    terrain.nations,
    terrain.additionalNations,
    0,
    random,
  );
  const game = createGame(
    [],
    nations,
    terrain.gameMap,
    terrain.miniGameMap,
    config,
    terrain.teamGameSpawnAreas,
  );

  let lastHash: HashUpdate | undefined;
  let fatal: string | undefined;
  const runner = new GameRunner(
    game,
    new Executor(game, gameStart.gameID, undefined),
    (gu) => {
      if ("errMsg" in gu) {
        fatal = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      const hashes = gu.updates[GameUpdateType.Hash] as HashUpdate[];
      if (hashes.length > 0) lastHash = hashes[hashes.length - 1];
    },
  );
  runner.init();

  let turnNumber = 0;
  const step = () => {
    runner.addTurn({ turnNumber: turnNumber++, intents: [] });
    return runner.executeNextTick() && fatal === undefined;
  };
  while (game.inSpawnPhase()) {
    if (!step()) throw new Error(`errored in spawn phase:\n${fatal}`);
  }
  const spawned = game.players().filter((p) => p.isAlive()).length;
  const start = performance.now();
  for (let i = 0; i < ticks; i++) {
    if (!step()) throw new Error(`errored at tick ${game.ticks()}:\n${fatal}`);
  }
  const wall = performance.now() - start;

  const alive = game.players().filter((p) => p.isAlive());
  const ownedTiles = alive.reduce((s, p) => s + p.numTilesOwned(), 0);
  const land = game.numLandTiles();
  const byTiles = [...alive].sort(
    (a, b) => b.numTilesOwned() - a.numTilesOwned(),
  );
  const share = (n: number) =>
    pct(
      byTiles.slice(0, n).reduce((s, p) => s + p.numTilesOwned(), 0),
      ownedTiles,
    );
  const countOf = (type: UnitType) =>
    alive.reduce((s, p) => s + p.units(type).length, 0);
  const kind = (p: Player) =>
    p.type() === PlayerType.Bot
      ? "tribe"
      : p.type() === PlayerType.Nation
        ? "nation"
        : "human";

  console.log(`--- After ${ticks} ticks (${(wall / 1000).toFixed(1)}s) ---`);
  console.log(`Spawned:        ${spawned}`);
  console.log(`Alive:          ${alive.length}`);
  console.log(
    `Land claimed:   ${ownedTiles} / ${land} (${pct(ownedTiles, land)})`,
  );
  console.log(
    `Concentration:  top 1 ${share(1)}, top 5 ${share(5)}, top 20 ${share(20)}`,
  );
  const materials = alive.reduce((s, p) => s + Number(p.materials()), 0);
  console.log(`Materials held: ${materials}`);
  console.log(
    `Fallout:        ${game.numTilesWithFallout()} tiles (${pct(game.numTilesWithFallout(), land)}), ` +
      `${alive.reduce((s, p) => s + p.numIrradiatedTiles(), 0)} of them owned`,
  );
  console.log(
    `Fleet:          ${countOf(UnitType.Warship)} warships, ` +
      `${countOf(UnitType.TradeShip)} trade ships at sea`,
  );
  console.log(
    `Structures:     ${countOf(UnitType.City)} cities, ` +
      `${countOf(UnitType.Port)} ports, ${countOf(UnitType.Factory)} factories, ` +
      `${countOf(UnitType.DefensePost)} posts`,
  );
  const tiers = [0, 0, 0, 0];
  for (const p of alive) for (const a of p.alliances()) tiers[a.tier()]++;
  console.log(
    `Alliances:      ${tiers[1] / 2} pacts, ${tiers[2] / 2} defensive, ${tiers[3] / 2} full; ` +
      `leader share ${pct(game.leaderShare(), 1)}`,
  );
  const doctrines = new Map<string, number>();
  for (const p of alive) {
    const key = DOCTRINE_KEYS[p.doctrine()];
    doctrines.set(key, (doctrines.get(key) ?? 0) + 1);
  }
  console.log(
    `Doctrines:      ${[...doctrines.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}`,
  );
  const partisans = game.allPlayers().filter((p) => p.partisanOf() !== null);
  console.log(
    `Unrest:         ${alive.reduce((s, p) => s + p.unrestTiles(), 0)} occupied tiles, ` +
      `${partisans.length} uprisings (${partisans.filter((p) => p.isAlive()).length} alive)`,
  );
  console.log(`Final hash:     ${lastHash?.hash} (tick ${lastHash?.tick})`);
  console.log("\nTop 10 by territory:");
  for (const p of byTiles.slice(0, 10)) {
    console.log(
      `  ${p.displayName().padEnd(22)} ${kind(p).padEnd(7)} ` +
        `${String(p.numTilesOwned()).padStart(7)} tiles  ` +
        `${String(Math.floor(p.troops())).padStart(9)} troops  ` +
        `${p.units(UnitType.City).length} cities`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
