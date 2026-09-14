/**
 * Determinism harness (FightWars).
 *
 * Runs the real simulation pipeline (GameRunner + Executor + real Config,
 * nations from the map manifest, bots, and scripted "human" players that
 * issue real wire intents) headlessly in a single process, and emits a
 * strong digest of the complete game state every N ticks.
 *
 * Two modes:
 *
 *   record  — scripted humans read the live game state to decide what to do,
 *             every intent they emit is written to an intent log
 *             (`{ params, turns: Turn[] }`), and digests are written to --out.
 *   replay  — the intent log is read back and fed turn-by-turn into a fresh
 *             game with the same parameters; digests are written to --out.
 *
 * `tests/determinism.test.ts` runs record + replay in SEPARATE PROCESSES and
 * requires the digest streams to be byte-identical. Any divergence between
 * the two is a desync bug in src/core.
 *
 * The digest deliberately covers far more than the live game's `hash()`
 * (which is a weak sum over troops + tiles + unit ids): every player's
 * troops (exact float bits), gold, tiles, alive/traitor flags, allies,
 * relations, targets, embargo count, outgoing attacks; every unit's owner,
 * tile, troops, health, level; and the owner, fallout and terrain byte of
 * every tile on the map.
 *
 * Usage:
 *   npx tsx tests/determinism/DeterminismRunner.ts --mode record \
 *       --log /tmp/intents.json --out /tmp/record.json \
 *       [--map pangaea] [--seed det-1] [--ticks 3000] [--bots 60] \
 *       [--humans 6] [--every 100]
 *   npx tsx tests/determinism/DeterminismRunner.ts --mode replay \
 *       --log /tmp/intents.json --out /tmp/replay.json [--ticks N]
 *       [--drop-intent-at TURN]   (test-only: tamper with the log)
 */
import fs from "fs";
import { createHash } from "node:crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../../src/core/configuration/Config";
import { Executor } from "../../src/core/execution/ExecutionManager";
import {
  AllPlayers,
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { TileRef } from "../../src/core/game/GameMap";
import { GameUpdateType, HashUpdate } from "../../src/core/game/GameUpdates";
import { createNationsForGame } from "../../src/core/game/NationCreation";
import { loadTerrainMap } from "../../src/core/game/TerrainMapLoader";
import { GameRunner } from "../../src/core/GameRunner";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import {
  GameConfig,
  GameStartInfo,
  Intent,
  StampedIntent,
  Turn,
} from "../../src/core/Schemas";
import { simpleHash } from "../../src/core/Util";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// ── Parameters ──

export interface RunParams {
  map: string;
  seed: string;
  ticks: number;
  bots: number;
  humans: number;
  every: number;
}

export interface IntentLog {
  version: 1;
  params: RunParams;
  turns: Turn[];
}

export interface DigestEntry {
  tick: number;
  /** The live game's own hash at the most recent 10-tick boundary. */
  upstreamHash: number | null;
  /** SHA-256 over the full observable game state. */
  digest: string;
}

export interface RunOutput {
  mode: "record" | "replay";
  params: RunParams;
  intentCount: number;
  intentTypes: Record<string, number>;
  digests: DigestEntry[];
  final: {
    ticks: number;
    alive: number;
    players: number;
    units: number;
    /** Highest combined tile count the scripted humans held at any digest. */
    peakHumanTiles: number;
    humans: {
      clientID: string;
      spawned: boolean;
      alive: boolean;
      tiles: number;
      troops: number;
      gold: string;
    }[];
  };
  wallMs: number;
}

interface Options {
  mode: "record" | "replay";
  log: string;
  out: string;
  params: Partial<RunParams>;
  dropIntentAt: number | null;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    mode: "record",
    log: "",
    out: "",
    params: {},
    dropIntentAt: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--mode": {
        const v = next();
        if (v !== "record" && v !== "replay") {
          throw new Error(`--mode must be record or replay, got ${v}`);
        }
        opts.mode = v;
        break;
      }
      case "--log":
        opts.log = next();
        break;
      case "--out":
        opts.out = next();
        break;
      case "--map":
        opts.params.map = next();
        break;
      case "--seed":
        opts.params.seed = next();
        break;
      case "--ticks":
        opts.params.ticks = parseInt(next(), 10);
        break;
      case "--bots":
        opts.params.bots = parseInt(next(), 10);
        break;
      case "--humans":
        opts.params.humans = parseInt(next(), 10);
        break;
      case "--every":
        opts.params.every = parseInt(next(), 10);
        break;
      case "--drop-intent-at":
        opts.dropIntentAt = parseInt(next(), 10);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (opts.log === "" || opts.out === "") {
    throw new Error("--log and --out are required");
  }
  return opts;
}

function resolveMap(name: string): GameMapType {
  const key = Object.keys(GameMapType).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key === undefined) {
    throw new Error(`unknown map "${name}"`);
  }
  return GameMapType[key as keyof typeof GameMapType];
}

// ── State digest ──

function f64(x: number): string {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  return b.toString("hex");
}

/**
 * SHA-256 over the complete observable game state. Player and unit order is
 * canonicalised by id so the digest does not depend on iteration order.
 */
export function stateDigest(game: Game): string {
  const h = createHash("sha256");
  const lines: string[] = [`tick=${game.ticks()}`];

  const players = [...game.allPlayers()].sort(
    (a, b) => a.smallID() - b.smallID(),
  );
  for (const p of players) {
    const allies = p
      .allies()
      .map((a) => a.smallID())
      .sort((a, b) => a - b)
      .join(",");
    const targets = p
      .targets()
      .map((t) => t.smallID())
      .sort((a, b) => a - b)
      .join(",");
    const relations = players
      .filter((o) => o !== p)
      .map((o) => p.relation(o))
      .join("");
    const attacks = p
      .outgoingAttacks()
      .map((a) => `${f64(a.troops())}:${a.target().smallID()}`)
      .sort()
      .join(",");
    lines.push(
      [
        `P${p.smallID()}`,
        p.type(),
        p.isAlive() ? 1 : 0,
        p.hasSpawned() ? 1 : 0,
        f64(p.troops()),
        p.gold().toString(),
        p.numTilesOwned(),
        p.isTraitor() ? 1 : 0,
        p.isDisconnected() ? 1 : 0,
        `A${allies}`,
        `T${targets}`,
        `R${relations}`,
        `E${p.getEmbargoes().length}`,
        `OA${attacks}`,
      ].join("|"),
    );
  }

  const units = game
    .units()
    .slice()
    .sort((a, b) => a.id() - b.id());
  for (const u of units) {
    lines.push(
      [
        `U${u.id()}`,
        u.type(),
        u.owner().smallID(),
        u.tile(),
        f64(u.troops()),
        u.hasHealth() ? f64(u.health()) : "-",
        u.level(),
        u.isActive() ? 1 : 0,
        u.isUnderConstruction() ? 1 : 0,
      ].join("|"),
    );
  }

  lines.push(`fallout=${game.numTilesWithFallout()}`);
  // A decided game names a Player (an object with bigint fields and a
  // handle on the game) or a Team (a string): digest it by identity, not
  // by serialising it — JSON.stringify refused the bigints, so a 24000-tick
  // world match that ended inside the horizon crashed the digest instead of
  // hashing the win.
  const winner = game.getWinner();
  lines.push(
    `winner=${winner === null ? "null" : typeof winner === "string" ? winner : winner.id()}`,
  );
  h.update(lines.join("\n"));

  const map = game.map();
  const n = map.width() * map.height();
  const owners = new Uint16Array(n);
  const flags = new Uint8Array(n);
  let i = 0;
  map.forEachTile((t: TileRef) => {
    owners[i] = map.ownerID(t);
    flags[i] = (map.hasFallout(t) ? 0x80 : 0) | (map.terrainByte(t) & 0x7f);
    i++;
  });
  h.update(Buffer.from(owners.buffer, owners.byteOffset, owners.byteLength));
  h.update(Buffer.from(flags.buffer, flags.byteOffset, flags.byteLength));
  return h.digest("hex");
}

// ── Scripted human ──

/**
 * A deterministic stand-in for a human player. It reads the live game state
 * and emits the same wire intents a real client would. Its randomness comes
 * from its own PseudoRandom, seeded from the run seed, so a given seed always
 * produces the same intent log for the same code.
 */
export class ScriptedHuman {
  private rng: PseudoRandom;
  private nextActionTick = 0;

  constructor(
    readonly clientID: string,
    readonly playerID: string,
    seed: number,
  ) {
    this.rng = new PseudoRandom(seed);
  }

  intents(game: Game, tick: number): Intent[] {
    const player = game.playerByClientID(this.clientID);
    if (!player) return [];

    if (game.inSpawnPhase()) {
      // Pick a spawn a few ticks in, and occasionally re-pick — a real
      // player does both.
      if (
        (!player.hasSpawned() && tick >= 2) ||
        (tick % 60 === 0 && this.rng.chance(4))
      ) {
        const tile = this.randomTile(game, (t) => {
          return game.map().isLand(t) && !game.hasOwner(t);
        });
        if (tile !== null) return [{ type: "spawn", tile }];
      }
      return [];
    }

    if (!player.isAlive()) return [];
    if (tick < this.nextActionTick) return [];
    this.nextActionTick = tick + this.rng.nextInt(10, 40);

    const roll = this.rng.nextInt(0, 99);
    if (roll < 50) return this.expand(player);
    if (roll < 70) return this.attackNeighbour(game, player);
    if (roll < 85) return this.build(game, player);
    if (roll < 90) return this.boat(game, player);
    if (roll < 93) return this.alliance(game, player);
    if (roll < 94) return [{ type: "emoji", recipient: AllPlayers, emoji: 0 }];
    if (roll < 95) return this.donate(player);
    if (roll < 96) return this.embargo(game, player);
    if (roll < 97) return this.target(game, player);
    if (roll < 98) return this.cancelAttack(player);
    if (roll < 99) return this.breakAlliance(player);
    return this.upgrade(game, player);
  }

  private troopsFor(player: Player): number {
    return player.troops() * this.rng.nextFloat(0.1, 0.5);
  }

  private expand(player: Player): Intent[] {
    return [{ type: "attack", targetID: null, troops: this.troopsFor(player) }];
  }

  private neighbours(game: Game, player: Player): Player[] {
    const seen = new Map<number, Player>();
    let scanned = 0;
    for (const t of player.borderTiles()) {
      if (scanned++ > 2000) break;
      for (const nb of game.map().neighbors(t)) {
        const o = game.owner(nb);
        if (o.isPlayer() && o !== player && !seen.has(o.smallID())) {
          seen.set(o.smallID(), o);
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.smallID() - b.smallID());
  }

  private attackNeighbour(game: Game, player: Player): Intent[] {
    const targets = this.neighbours(game, player).filter(
      (o) => !player.isAlliedWith(o) && !player.isOnSameTeam(o),
    );
    if (targets.length === 0) return this.expand(player);
    const target = targets[this.rng.nextInt(0, targets.length - 1)];
    return [
      { type: "attack", targetID: target.id(), troops: this.troopsFor(player) },
    ];
  }

  private randomOwnedTile(player: Player): TileRef | null {
    const tiles = player.tiles();
    if (tiles.size === 0) return null;
    const idx = this.rng.nextInt(0, tiles.size - 1);
    let i = 0;
    for (const t of tiles) {
      if (i++ === idx) return t;
    }
    return null;
  }

  private randomTile(
    game: Game,
    ok: (t: TileRef) => boolean,
    tries = 300,
  ): TileRef | null {
    const map = game.map();
    for (let k = 0; k < tries; k++) {
      const x = this.rng.nextInt(0, map.width() - 1);
      const y = this.rng.nextInt(0, map.height() - 1);
      const t = map.ref(x, y);
      if (ok(t)) return t;
    }
    return null;
  }

  private build(game: Game, player: Player): Intent[] {
    // Half the time aim at our own land (cities, ports, silos, SAMs...),
    // half the time anywhere on the map (warships on water, nukes on enemies).
    const tile = this.rng.chance(2)
      ? this.randomOwnedTile(player)
      : this.randomTile(game, () => true);
    if (tile === null) return [];
    // Transports are launched through the boat intent, never build_unit.
    const options = player
      .buildableUnits(tile)
      .filter((b) => b.canBuild !== false && b.type !== UnitType.TransportShip);
    if (options.length === 0) return [];
    const b = options[this.rng.nextInt(0, options.length - 1)];
    return [{ type: "build_unit", unit: b.type, tile: b.canBuild as TileRef }];
  }

  private upgrade(game: Game, player: Player): Intent[] {
    const tile = this.randomOwnedTile(player);
    if (tile === null) return [];
    const options = player
      .buildableUnits(tile)
      .filter((b) => b.canUpgrade !== false);
    if (options.length === 0) return [];
    const b = options[this.rng.nextInt(0, options.length - 1)];
    return [
      {
        type: "upgrade_structure",
        unit: b.type,
        unitId: b.canUpgrade as number,
      },
    ];
  }

  private boat(game: Game, player: Player): Intent[] {
    const dst = this.randomTile(game, (t) => {
      return game.map().isLand(t) && game.owner(t) !== player;
    });
    if (dst === null) return [];
    const src = player.bestTransportShipSpawn(dst);
    if (src === false) return [];
    return [{ type: "boat", troops: player.troops() * 0.2, dst }];
  }

  private others(game: Game, player: Player): Player[] {
    return game
      .players()
      .filter((o) => o !== player && o.isAlive())
      .sort((a, b) => a.smallID() - b.smallID());
  }

  private alliance(game: Game, player: Player): Intent[] {
    const candidates = this.others(game, player).filter((o) =>
      player.canSendAllianceRequest(o),
    );
    if (candidates.length === 0) return [];
    const o = candidates[this.rng.nextInt(0, candidates.length - 1)];
    return [{ type: "allianceRequest", recipient: o.id() }];
  }

  private breakAlliance(player: Player): Intent[] {
    const allies = player.allies();
    if (allies.length === 0) return [];
    const o = allies[this.rng.nextInt(0, allies.length - 1)];
    return [{ type: "breakAlliance", recipient: o.id() }];
  }

  private donate(player: Player): Intent[] {
    const allies = player.allies().filter((a) => player.canDonateGold(a));
    if (allies.length === 0) return [];
    const o = allies[this.rng.nextInt(0, allies.length - 1)];
    return [{ type: "donate_gold", recipient: o.id(), gold: null }];
  }

  private embargo(game: Game, player: Player): Intent[] {
    const candidates = this.others(game, player).filter(
      (o) => !player.hasEmbargoAgainst(o),
    );
    if (candidates.length === 0) return [];
    const o = candidates[this.rng.nextInt(0, candidates.length - 1)];
    return [{ type: "embargo", targetID: o.id(), action: "start" }];
  }

  private target(game: Game, player: Player): Intent[] {
    const candidates = this.others(game, player).filter((o) =>
      player.canTarget(o),
    );
    if (candidates.length === 0) return [];
    const o = candidates[this.rng.nextInt(0, candidates.length - 1)];
    return [{ type: "targetPlayer", target: o.id() }];
  }

  private cancelAttack(player: Player): Intent[] {
    const attacks = player.outgoingAttacks();
    if (attacks.length === 0) return [];
    return [{ type: "cancel_attack", attackID: attacks[0].id() }];
  }
}

// ── Run ──

export async function runDeterminism(
  mode: "record" | "replay",
  params: RunParams,
  replayTurns: Turn[] | null,
  dropIntentAt: number | null,
): Promise<{ output: RunOutput; log: IntentLog }> {
  console.debug = () => {};
  const started = performance.now();

  const map = resolveMap(params.map);
  const gameConfig: GameConfig = {
    gameMap: map,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    // Private: the spawn phase is ended by SpawnTimerExecution after
    // config.numSpawnPhaseTurns(), as it is in every multiplayer lobby.
    gameType: GameType.Private,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateGold: true,
    donateTroops: true,
    bots: params.bots,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
  };
  const gameStart: GameStartInfo = {
    gameID: params.seed,
    lobbyCreatedAt: 0,
    config: gameConfig,
    players: [],
  };

  const config = new Config(gameConfig, null, false);
  const terrain = await loadTerrainMap(
    map,
    GameMapSize.Normal,
    new NodeGameMapLoader(path.join(PROJECT_ROOT, "resources/maps")),
    false,
  );

  // Mirror createGameRunner(): humans draw their ids from the game random
  // before the nations do.
  const random = new PseudoRandom(simpleHash(gameStart.gameID));
  const scripts: ScriptedHuman[] = [];
  const humans: PlayerInfo[] = [];
  for (let i = 0; i < params.humans; i++) {
    const clientID = `HUMAN${String(i).padStart(3, "0")}`;
    const playerID = random.nextID();
    humans.push(
      new PlayerInfo(`Human ${i}`, PlayerType.Human, clientID, playerID),
    );
    scripts.push(
      new ScriptedHuman(
        clientID,
        playerID,
        simpleHash(`${params.seed}:${clientID}`),
      ),
    );
  }
  const nations = createNationsForGame(
    gameStart,
    terrain.nations,
    terrain.additionalNations,
    humans.length,
    random,
  );
  const game = createGame(
    humans,
    nations,
    terrain.gameMap,
    terrain.miniGameMap,
    config,
    terrain.teamGameSpawnAreas,
  );

  let lastHash: HashUpdate | undefined;
  let fatalError: string | undefined;
  const runner = new GameRunner(
    game,
    new Executor(game, gameStart.gameID, undefined),
    (gu) => {
      if ("errMsg" in gu) {
        fatalError = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      const hashes = gu.updates[GameUpdateType.Hash] as HashUpdate[];
      if (hashes.length > 0) lastHash = hashes[hashes.length - 1];
    },
  );
  runner.init();

  const turns: Turn[] = [];
  const digests: DigestEntry[] = [];
  const intentTypes: Record<string, number> = {};
  let intentCount = 0;
  let peakHumanTiles = 0;

  for (let turnNumber = 0; turnNumber < params.ticks; turnNumber++) {
    let intents: StampedIntent[];
    if (replayTurns !== null) {
      const t = replayTurns[turnNumber];
      if (t === undefined) {
        throw new Error(
          `intent log has ${replayTurns.length} turns, need ${params.ticks}`,
        );
      }
      if (t.turnNumber !== turnNumber) {
        throw new Error(`turn ${turnNumber} is numbered ${t.turnNumber}`);
      }
      intents = t.intents.slice();
      if (dropIntentAt !== null && turnNumber === dropIntentAt) {
        intents.shift();
      }
    } else {
      intents = [];
      const tick = game.ticks();
      for (const s of scripts) {
        for (const intent of s.intents(game, tick)) {
          intents.push({ clientID: s.clientID, ...intent } as StampedIntent);
        }
      }
    }
    for (const it of intents) {
      intentCount++;
      intentTypes[it.type] = (intentTypes[it.type] ?? 0) + 1;
    }
    const turn: Turn = { turnNumber, intents };
    turns.push(turn);
    runner.addTurn(turn);
    if (!runner.executeNextTick()) {
      throw new Error(`executeNextTick returned false at turn ${turnNumber}`);
    }
    if (fatalError !== undefined) {
      throw new Error(`game errored at tick ${game.ticks()}:\n${fatalError}`);
    }
    if (game.ticks() % params.every === 0) {
      let humanTiles = 0;
      for (const s of scripts) {
        humanTiles += game.playerByClientID(s.clientID)?.numTilesOwned() ?? 0;
      }
      peakHumanTiles = Math.max(peakHumanTiles, humanTiles);
      digests.push({
        tick: game.ticks(),
        upstreamHash: lastHash?.hash ?? null,
        digest: stateDigest(game),
      });
    }
  }

  const output: RunOutput = {
    mode,
    params,
    intentCount,
    intentTypes,
    digests,
    final: {
      ticks: game.ticks(),
      alive: game.players().filter((p) => p.isAlive()).length,
      players: game.players().length,
      units: game.units().length,
      peakHumanTiles,
      humans: scripts.map((s) => {
        const p = game.playerByClientID(s.clientID);
        return {
          clientID: s.clientID,
          spawned: p?.hasSpawned() ?? false,
          alive: p?.isAlive() ?? false,
          tiles: p?.numTilesOwned() ?? 0,
          troops: p?.troops() ?? 0,
          gold: (p?.gold() ?? 0n).toString(),
        };
      }),
    },
    wallMs: performance.now() - started,
  };
  return { output, log: { version: 1, params, turns } };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  let params: RunParams;
  let replayTurns: Turn[] | null = null;
  if (opts.mode === "replay") {
    const log = JSON.parse(fs.readFileSync(opts.log, "utf8")) as IntentLog;
    if (log.version !== 1)
      throw new Error(`unknown log version ${log.version}`);
    params = { ...log.params };
    if (opts.params.ticks !== undefined) params.ticks = opts.params.ticks;
    replayTurns = log.turns;
  } else {
    params = {
      map: opts.params.map ?? "pangaea",
      seed: opts.params.seed ?? "det-1",
      ticks: opts.params.ticks ?? 3000,
      bots: opts.params.bots ?? 60,
      humans: opts.params.humans ?? 6,
      every: opts.params.every ?? 100,
    };
  }

  const { output, log } = await runDeterminism(
    opts.mode,
    params,
    replayTurns,
    opts.dropIntentAt,
  );

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(output));
  if (opts.mode === "record") {
    fs.mkdirSync(path.dirname(opts.log), { recursive: true });
    fs.writeFileSync(opts.log, JSON.stringify(log));
  }
  console.error(
    `[determinism:${opts.mode}] map=${params.map} seed=${params.seed} ` +
      `ticks=${output.final.ticks} intents=${output.intentCount} ` +
      `digests=${output.digests.length} alive=${output.final.alive}/` +
      `${output.final.players} units=${output.final.units} ` +
      `wall=${output.wallMs.toFixed(0)}ms`,
  );
}

const isEntry =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
