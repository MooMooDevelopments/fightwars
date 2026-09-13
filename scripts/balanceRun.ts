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
 *                                      [--no-supply]
 *
 * `--no-supply` turns the supply penalty and its attrition off while leaving
 * everything else alone, so one run against another is an A/B of that one
 * mechanic rather than of two different builds. Prefer it to stashing the
 * feature — a stash also removes the script doing the measuring.
 */
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../src/core/configuration/Config";
import { Executor } from "../src/core/execution/ExecutionManager";
import {
  Difficulty,
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

function pct(part: number, whole: number): string {
  return whole === 0 ? "0.0%" : `${((part / whole) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const ticks = Number(arg("--ticks", "5000"));
  const bots = Number(arg("--bots", "150"));
  const map = resolveMap(arg("--map", "world"));
  const seed = arg("--seed", "perf-gate");
  const noSupply = process.argv.includes("--no-supply");
  console.debug = () => {};
  console.log(
    `[balance] map=${map} bots=${bots} seed=${seed} ticks=${ticks}${noSupply ? " supply=off" : ""}\n`,
  );

  const gameConfig: GameConfig = {
    gameMap: map,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
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
  console.log(
    `Structures:     ${countOf(UnitType.City)} cities, ` +
      `${countOf(UnitType.Port)} ports, ${countOf(UnitType.Factory)} factories, ` +
      `${countOf(UnitType.DefensePost)} posts`,
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
