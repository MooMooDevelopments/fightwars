/**
 * Load-test harness (FightWars, Section 8 of the brief).
 *
 * Drives a running game server with N simulated clients over the real
 * binary WebSocket protocol. One private lobby per --lobbies; --clients
 * players per lobby. Every client joins with a fresh dev persistent-id
 * token, sends real intents (spawn, attack, boat, build, alliances, …) and
 * real state hashes, and can be given artificial send latency and periodic
 * disconnect/rejoin churn.
 *
 * How the hashes are real without running 150 simulations: each lobby runs
 * ONE headless GameRunner (the exact code a browser client runs in its
 * worker) fed by the turns the server relays. Every simulated client in
 * that lobby reports the hash that sim produced, and every client's
 * scripted decisions read that sim's state — the server sees 150 clients
 * that agree, exactly as 150 honest browsers would.
 *
 * What it measures (per lobby and overall):
 *   - bytes down per client per second (the brief's budget: < 8 KB/s)
 *   - turn inter-arrival p50 / p99 / max at the client (100 ms nominal)
 *   - intents sent, hashes sent, desync messages, server errors, closes
 *   - server CPU % and RSS while the run lasts (when --server-pid is given)
 *
 * Exit code 1 when any desync/error was received or a budget is exceeded,
 * so this doubles as a gate.
 *
 * Usage (against the dev server started by `npm run dev` or
 * `npm run start:server-dev`; worker 0 listens on 3001):
 *   npx tsx tests/load/LoadTest.ts --clients 150 --map world --turns 1500
 *   npx tsx tests/load/LoadTest.ts --lobbies 20 --clients 4 --turns 600
 * Options:
 *   --worker-base http://localhost:3001   worker HTTP base (ws on same port)
 *   --workers N        round-robin lobby creation over workers 0..N-1 (ports 3001+i)
 *   --clients N --lobbies N --map name --bots N --nations default|disabled|N
 *   --turns N          turns to observe per lobby before stopping
 *   --latency-ms N --jitter-ms N          added to every client send
 *   --churn-per-min F  expected disconnect+rejoin events per client per minute
 *   --max-kbps-down F  per-client bandwidth budget (default 8)
 *   --server-pid PID   sample CPU/RSS of that process (Linux /proc or Windows)
 *   --out report.json  write the full report
 */
import fs from "fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";
import { Config } from "../../src/core/configuration/Config";
import { Executor } from "../../src/core/execution/ExecutionManager";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { GameUpdateType, HashUpdate } from "../../src/core/game/GameUpdates";
import { createNationsForGame } from "../../src/core/game/NationCreation";
import { genTerrainFromBin } from "../../src/core/game/TerrainMapLoader";
import { GameRunner } from "../../src/core/GameRunner";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import {
  ClientMessage,
  GameConfig,
  GameStartInfo,
  Intent,
  ServerMessage,
} from "../../src/core/Schemas";
import { simpleHash } from "../../src/core/Util";
import {
  createGameWireContext,
  decodeServerMessage,
  encodeClientMessage,
} from "../../src/core/ZbinWire";
import { ZbContext } from "../../zbin";
import { ScriptedHuman } from "../determinism/DeterminismRunner";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// ── Options ──

interface Options {
  workerBase: string;
  /** Round-robin lobby creation across this many workers (ports 3001+i). */
  workers: number;
  clients: number;
  lobbies: number;
  map: string;
  bots: number;
  nations: "default" | "disabled" | number;
  turns: number;
  latencyMs: number;
  jitterMs: number;
  churnPerMin: number;
  maxKbpsDown: number;
  serverPid: number | null;
  out: string | null;
  gitCommit: string;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    workerBase: "http://localhost:3001",
    workers: 1,
    clients: 150,
    lobbies: 1,
    map: "world",
    bots: 0,
    nations: "default",
    turns: 1500,
    latencyMs: 0,
    jitterMs: 0,
    churnPerMin: 0,
    maxKbpsDown: 8,
    serverPid: null,
    out: null,
    gitCommit: process.env.GIT_COMMIT ?? "DEV",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--worker-base":
        o.workerBase = next().replace(/\/$/, "");
        break;
      case "--clients":
        o.clients = parseInt(next(), 10);
        break;
      case "--workers":
        o.workers = parseInt(next(), 10);
        break;
      case "--lobbies":
        o.lobbies = parseInt(next(), 10);
        break;
      case "--map":
        o.map = next();
        break;
      case "--bots":
        o.bots = parseInt(next(), 10);
        break;
      case "--nations": {
        const v = next();
        o.nations = v === "default" || v === "disabled" ? v : parseInt(v, 10);
        break;
      }
      case "--turns":
        o.turns = parseInt(next(), 10);
        break;
      case "--latency-ms":
        o.latencyMs = parseFloat(next());
        break;
      case "--jitter-ms":
        o.jitterMs = parseFloat(next());
        break;
      case "--churn-per-min":
        o.churnPerMin = parseFloat(next());
        break;
      case "--max-kbps-down":
        o.maxKbpsDown = parseFloat(next());
        break;
      case "--server-pid":
        o.serverPid = parseInt(next(), 10);
        break;
      case "--out":
        o.out = next();
        break;
      case "--git-commit":
        o.gitCommit = next();
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  return o;
}

function resolveMap(name: string): GameMapType {
  const key = Object.keys(GameMapType).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key === undefined) throw new Error(`unknown map "${name}"`);
  return GameMapType[key as keyof typeof GameMapType];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

// ── Simulated client ──

interface ClientStats {
  bytesIn: number;
  msgsIn: number;
  turns: number;
  intentsSent: number;
  hashesSent: number;
  desyncs: number;
  errors: string[];
  closes: number;
  rejoins: number;
  turnGaps: number[];
}

class SimClient {
  ws: WebSocket | null = null;
  clientID: string | null = null;
  readonly token = randomUUID();
  readonly stats: ClientStats = {
    bytesIn: 0,
    msgsIn: 0,
    turns: 0,
    intentsSent: 0,
    hashesSent: 0,
    desyncs: 0,
    errors: [],
    closes: 0,
    rejoins: 0,
    turnGaps: [],
  };
  private lastTurnAt = 0;
  private lastTurnSeen = -1;
  private closedByUs = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  script: ScriptedHuman | null = null;

  constructor(
    readonly lobby: Lobby,
    readonly index: number,
    readonly username: string,
  ) {}

  private wsUrl(): string {
    return `${this.lobby.workerBase.replace(/^http/, "ws")}/`;
  }

  connect(rejoin: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl());
      this.ws = ws;
      this.closedByUs = false;
      ws.binaryType = "nodebuffer";
      ws.once("open", () => {
        const msg: ClientMessage = rejoin
          ? {
              type: "rejoin",
              gameID: this.lobby.gameID,
              lastTurn: Math.max(0, this.lastTurnSeen),
              token: this.token,
              gitCommit: this.lobby.opts.gitCommit,
            }
          : {
              type: "join",
              gameID: this.lobby.gameID,
              username: this.username,
              clanTag: null,
              turnstileToken: null,
              token: this.token,
              gitCommit: this.lobby.opts.gitCommit,
            };
        this.rawSend(msg);
        // Real clients ping every 5 s; the server drops silent sockets.
        if (this.pingTimer !== null) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(
          () => this.rawSend({ type: "ping" }),
          5000,
        );
        resolve();
      });
      ws.on("message", (data: WebSocket.RawData) => this.onMessage(data));
      ws.on("close", () => {
        if (this.pingTimer !== null) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        // Only unexpected closes count; stop() and churn() close on purpose.
        if (!this.closedByUs && this.lobby.running) {
          this.stats.closes++;
          // Unexpected close: rejoin like a real client would.
          this.stats.rejoins++;
          void sleep(200).then(() => this.connect(true).catch(() => {}));
        }
      });
      ws.on("error", (err) => {
        this.stats.errors.push(`ws: ${String(err)}`);
        reject(err);
      });
    });
  }

  closeQuietly(): void {
    this.closedByUs = true;
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.ws?.close();
  }

  /** Simulated disconnect+rejoin (churn). */
  async churn(): Promise<void> {
    if (this.ws === null) return;
    this.closedByUs = true;
    this.ws.close();
    await sleep(300 + Math.random() * 700);
    this.stats.rejoins++;
    await this.connect(true);
  }

  private rawSend(msg: ClientMessage): void {
    const ws = this.ws;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(encodeClientMessage(msg, this.lobby.ctx ?? undefined));
  }

  /** Send with the configured artificial latency. */
  send(msg: ClientMessage): void {
    const { latencyMs, jitterMs } = this.lobby.opts;
    const delay = latencyMs + Math.random() * jitterMs;
    if (delay <= 0) this.rawSend(msg);
    else setTimeout(() => this.rawSend(msg), delay);
  }

  private onMessage(data: WebSocket.RawData): void {
    const bytes =
      data instanceof Buffer
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data as ArrayBuffer);
    this.stats.bytesIn += bytes.byteLength;
    this.stats.msgsIn++;
    let msg: ServerMessage;
    try {
      msg = decodeServerMessage(bytes, this.lobby.ctx ?? undefined);
    } catch (e) {
      this.stats.errors.push(`decode: ${String(e)}`);
      return;
    }
    switch (msg.type) {
      case "lobby_info":
        this.clientID = msg.myClientID;
        this.lobby.onLobbyInfo(this, msg.lobby.clients?.length ?? 0);
        break;
      case "start":
        this.clientID = msg.myClientID ?? this.clientID;
        this.lobby.onStart(msg.gameStartInfo, msg.turns);
        break;
      case "turn": {
        const now = performance.now();
        if (this.lastTurnAt > 0)
          this.stats.turnGaps.push(now - this.lastTurnAt);
        this.lastTurnAt = now;
        this.stats.turns++;
        this.lastTurnSeen = msg.turn.turnNumber;
        this.lobby.onTurn(msg.turn.turnNumber, msg.turn);
        break;
      }
      case "desync":
        this.stats.desyncs++;
        break;
      case "error":
        this.stats.errors.push(`server: ${msg.error}`);
        break;
      case "ping":
      case "prestart":
      case "new_lobby":
        break;
    }
  }
}

// ── Lobby: one server game, N clients, one shared sim ──

class Lobby {
  gameID = "";
  workerBase = "";
  ctx: ZbContext | null = null;
  running = false;
  readonly clients: SimClient[] = [];
  private runner: GameRunner | null = null;
  private pendingTurns = new Map<number, any>();
  private nextTurn = 0;
  private started = false;
  private startInfo: GameStartInfo | null = null;
  private lastHash: HashUpdate | null = null;
  private hashSentForTick = -1;
  private lobbyCount = 0;
  turnsExecuted = 0;
  simMsTotal = 0;
  simMsMax = 0;
  readonly log: string[] = [];

  constructor(
    readonly opts: Options,
    readonly index: number,
  ) {}

  private createBase(): string {
    const base = new URL(this.opts.workerBase);
    const first = Number.parseInt(base.port || "3001", 10);
    base.port = String(first + (this.index % Math.max(1, this.opts.workers)));
    return base.toString().replace(/\/$/, "");
  }

  async create(): Promise<void> {
    // Build the clients first: the first client's token creates the game so
    // it is the lobby creator and may send toggle_game_start_timer.
    for (let i = 0; i < this.opts.clients; i++) {
      this.clients.push(
        new SimClient(this, i, `Load${String(i).padStart(4, "0")}`),
      );
    }
    const gameConfig: GameConfig = {
      gameMap: resolveMap(this.opts.map),
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Private,
      difficulty: Difficulty.Medium,
      nations: this.opts.nations,
      donateGold: true,
      donateTroops: true,
      bots: this.opts.bots,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    };
    // The worker rate-limits creation per IP; back off on 429 like a
    // well-behaved client rather than failing the whole run.
    let res: Response | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      res = await fetch(`${this.createBase()}/api/create_game`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.clients[0].token}`,
        },
        body: JSON.stringify(gameConfig),
      });
      if (res.status !== 429) break;
      await sleep(500 + attempt * 250);
    }
    if (res === null || !res.ok) {
      throw new Error(
        `create_game ${res?.status}: ${res ? await res.text() : "no response"}`,
      );
    }
    const info = (await res.json()) as { gameID: string; workerIndex: number };
    this.gameID = info.gameID;
    // Connect to the worker that owns the game: ports are 3001 + index.
    const base = new URL(this.opts.workerBase);
    base.port = String(3001 + info.workerIndex);
    this.workerBase = base.toString().replace(/\/$/, "");
    this.running = true;
  }

  async join(): Promise<void> {
    // Stagger connects a little so 150 sockets do not all handshake at once.
    for (const c of this.clients) {
      await c.connect(false);
      await sleep(5);
    }
    // Wait until the server reports everyone in the lobby (or 20 s).
    const deadline = Date.now() + 20_000;
    while (this.lobbyCount < this.opts.clients && Date.now() < deadline) {
      await sleep(100);
    }
    this.log.push(
      `lobby ${this.gameID}: ${this.lobbyCount}/${this.opts.clients} clients joined`,
    );
  }

  onLobbyInfo(_c: SimClient, count: number): void {
    this.lobbyCount = Math.max(this.lobbyCount, count);
  }

  start(): void {
    // Only the lobby creator may start; that is clients[0] (see create()).
    const first = this.clients[0];
    first.send({
      type: "intent",
      intent: { type: "toggle_game_start_timer" },
    });
  }

  async onStart(info: GameStartInfo, missed: any[]): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.startInfo = info;
    this.ctx = createGameWireContext(info.players);
    console.debug = () => {};
    // Mirror createGameRunner(), but decode the terrain fresh for this lobby:
    // loadTerrainMap() caches one mutable GameMap per map name, which is fine
    // for a browser running one game and fatal for a process running 100.
    const runner = await buildRunner(info, (gu) => {
      if ("errMsg" in gu) {
        this.log.push(`sim error: ${gu.errMsg}`);
        return;
      }
      const hashes = gu.updates[GameUpdateType.Hash] as HashUpdate[];
      if (hashes.length > 0) this.lastHash = hashes[hashes.length - 1];
    });
    this.runner = runner;
    // Scripts for every client that is a player in this game.
    for (const c of this.clients) {
      const p = info.players.find((p) => p.clientID === c.clientID);
      if (p === undefined) continue;
      c.script = new ScriptedHuman(
        c.clientID!,
        "",
        (this.index + 1) * 100_003 + c.index,
      );
    }
    for (const t of missed) this.onTurn(t.turnNumber, t);
    this.log.push(
      `lobby ${this.gameID}: started, ${info.players.length} players in start info`,
    );
  }

  onTurn(turnNumber: number, turn: any): void {
    if (this.runner === null) {
      this.pendingTurns.set(turnNumber, turn);
      return;
    }
    // Turns arrive once per client; execute each turn number once, in order.
    if (turnNumber < this.nextTurn) return;
    this.pendingTurns.set(turnNumber, turn);
    while (this.pendingTurns.has(this.nextTurn)) {
      const t = this.pendingTurns.get(this.nextTurn)!;
      this.pendingTurns.delete(this.nextTurn);
      this.executeTurn(t);
      this.nextTurn++;
    }
  }

  private executeTurn(turn: any): void {
    const runner = this.runner!;
    const game = runner.game;
    // Decide intents BEFORE the tick, as a client would for the next turn.
    const tick = game.ticks();
    for (const c of this.clients) {
      if (c.script === null) continue;
      for (const intent of c.script.intents(game, tick)) {
        c.send({ type: "intent", intent: intent as Intent });
        c.stats.intentsSent++;
      }
    }
    runner.addTurn(turn);
    const t0 = performance.now();
    runner.executeNextTick();
    const dt = performance.now() - t0;
    this.simMsTotal += dt;
    if (dt > this.simMsMax) this.simMsMax = dt;
    this.turnsExecuted++;
    // Every client reports the sim's hash, as browsers do.
    if (this.lastHash !== null && this.lastHash.tick !== this.hashSentForTick) {
      this.hashSentForTick = this.lastHash.tick;
      for (const c of this.clients) {
        if (c.clientID === null) continue;
        c.send({
          type: "hash",
          hash: this.lastHash.hash,
          turnNumber: this.lastHash.tick,
        });
        c.stats.hashesSent++;
      }
    }
  }

  stop(): void {
    this.running = false;
    for (const c of this.clients) {
      c.closeQuietly();
    }
  }
}

// ── Fresh runner per lobby ──

const mapLoader = new NodeGameMapLoader(
  path.join(PROJECT_ROOT, "resources/maps"),
);

async function buildRunner(
  gameStart: GameStartInfo,
  callBack: ConstructorParameters<typeof GameRunner>[2],
): Promise<GameRunner> {
  const config = new Config(gameStart.config, null, false, gameStart.listed);
  const files = mapLoader.getMapData(gameStart.config.gameMap);
  const manifest = await files.manifest();
  const compact = gameStart.config.gameMapSize === GameMapSize.Compact;
  const gameMap = compact
    ? await genTerrainFromBin(manifest.map4x, await files.map4xBin())
    : await genTerrainFromBin(manifest.map, await files.mapBin());
  const miniGameMap = compact
    ? await genTerrainFromBin(manifest.map16x, await files.map16xBin())
    : await genTerrainFromBin(manifest.map4x, await files.map4xBin());
  const random = new PseudoRandom(simpleHash(gameStart.gameID));
  const humans = gameStart.players.map(
    (p) =>
      new PlayerInfo(
        p.username,
        PlayerType.Human,
        p.clientID,
        random.nextID(),
        p.isLobbyCreator ?? false,
        p.clanTag,
        p.friends ?? [],
        p.teamIndex ?? null,
      ),
  );
  const nations = createNationsForGame(
    gameStart,
    manifest.nations,
    manifest.additionalNations ?? [],
    humans.length,
    random,
  );
  const game = createGame(
    humans,
    nations,
    gameMap,
    miniGameMap,
    config,
    manifest.teamGameSpawnAreas,
  );
  const runner = new GameRunner(
    game,
    new Executor(
      game,
      gameStart.gameID,
      undefined,
      gameStart.tribes?.map((t) => t.name),
    ),
    callBack,
  );
  runner.init();
  return runner;
}

// ── Server process sampling ──

function sampleProcess(
  pid: number,
): { cpuMs: number; rssBytes: number } | null {
  try {
    if (process.platform === "linux") {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const clk = 100;
      const cpuMs =
        ((parseInt(fields[11], 10) + parseInt(fields[12], 10)) * 1000) / clk;
      const rssBytes = parseInt(fields[21], 10) * 4096;
      return { cpuMs, rssBytes };
    }
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `$p=Get-Process -Id ${pid}; "$($p.TotalProcessorTime.TotalMilliseconds) $($p.WorkingSet64)"`,
        ],
        { encoding: "utf8", timeout: 5000 },
      ).trim();
      const [cpu, rss] = out.split(/\s+/);
      return { cpuMs: parseFloat(cpu), rssBytes: parseInt(rss, 10) };
    }
  } catch {
    return null;
  }
  return null;
}

// ── Main ──

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `load test: ${opts.lobbies} lobby(ies) × ${opts.clients} clients, map=${opts.map}, ` +
      `bots=${opts.bots}, turns=${opts.turns}, latency=${opts.latencyMs}±${opts.jitterMs}ms, ` +
      `churn=${opts.churnPerMin}/min → ${opts.workerBase}`,
  );

  const lobbies: Lobby[] = [];
  for (let i = 0; i < opts.lobbies; i++) {
    const l = new Lobby(opts, i);
    await l.create();
    lobbies.push(l);
    console.log(`created ${l.gameID} on ${l.workerBase}`);
  }
  await Promise.all(lobbies.map((l) => l.join()));
  for (const l of lobbies) console.log(l.log[l.log.length - 1]);

  const startedAt = performance.now();
  for (const l of lobbies) l.start();

  const serverSamples: { t: number; cpuMs: number; rssBytes: number }[] = [];
  const sampleTimer =
    opts.serverPid !== null
      ? setInterval(() => {
          const s = sampleProcess(opts.serverPid!);
          if (s) serverSamples.push({ t: performance.now(), ...s });
        }, 2000)
      : null;

  // Churn: schedule disconnect/rejoin events at the requested rate.
  const churnTimer =
    opts.churnPerMin > 0
      ? setInterval(() => {
          for (const l of lobbies) {
            for (const c of l.clients) {
              if (Math.random() < opts.churnPerMin / 60) void c.churn();
            }
          }
        }, 1000)
      : null;

  // Run until every lobby has executed --turns turns (or 10 minutes).
  const deadline = performance.now() + 10 * 60 * 1000;
  let lastReport = 0;
  while (
    lobbies.some((l) => l.turnsExecuted < opts.turns) &&
    performance.now() < deadline
  ) {
    await sleep(250);
    const now = performance.now();
    if (now - lastReport > 10_000) {
      lastReport = now;
      const done = lobbies.map((l) => l.turnsExecuted).join(",");
      console.log(`  turns executed: ${done}`);
    }
  }
  const elapsedS = (performance.now() - startedAt) / 1000;
  if (sampleTimer) clearInterval(sampleTimer);
  if (churnTimer) clearInterval(churnTimer);
  for (const l of lobbies) l.stop();
  await sleep(300);

  // ── Report ──
  const all = lobbies.flatMap((l) => l.clients);
  const gaps = all.flatMap((c) => c.stats.turnGaps).sort((a, b) => a - b);
  const bytesIn = all.reduce((a, c) => a + c.stats.bytesIn, 0);
  const kbpsPerClient = bytesIn / 1024 / elapsedS / Math.max(1, all.length);
  const desyncs = all.reduce((a, c) => a + c.stats.desyncs, 0);
  const errors = all.flatMap((c) => c.stats.errors);
  const closes = all.reduce((a, c) => a + c.stats.closes, 0);
  const rejoins = all.reduce((a, c) => a + c.stats.rejoins, 0);
  const intents = all.reduce((a, c) => a + c.stats.intentsSent, 0);
  const hashes = all.reduce((a, c) => a + c.stats.hashesSent, 0);
  const turnsExecuted = lobbies.map((l) => l.turnsExecuted);
  const simMean =
    lobbies.reduce((a, l) => a + l.simMsTotal, 0) /
    Math.max(
      1,
      lobbies.reduce((a, l) => a + l.turnsExecuted, 0),
    );
  const simMax = Math.max(...lobbies.map((l) => l.simMsMax));

  let cpuPct: number | null = null;
  let rssMb: number | null = null;
  if (serverSamples.length >= 2) {
    const a = serverSamples[0];
    const b = serverSamples[serverSamples.length - 1];
    cpuPct = ((b.cpuMs - a.cpuMs) / (b.t - a.t)) * 100;
    rssMb = Math.max(...serverSamples.map((s) => s.rssBytes)) / 1024 / 1024;
  }

  const report = {
    opts,
    elapsedS,
    clients: all.length,
    turnsExecuted,
    kbpsPerClient,
    turnGapMs: {
      p50: percentile(gaps, 50),
      p99: percentile(gaps, 99),
      max: gaps.length ? gaps[gaps.length - 1] : 0,
      samples: gaps.length,
    },
    intents,
    hashes,
    desyncs,
    errors: errors.slice(0, 20),
    errorCount: errors.length,
    closes,
    rejoins,
    simMsPerTurn: { mean: simMean, max: simMax },
    server: { cpuPct, rssMb, samples: serverSamples.length },
    lobbyLog: lobbies.flatMap((l) => l.log),
  };

  console.log(`\n${"=".repeat(72)}`);
  console.log(
    `${all.length} clients, ${elapsedS.toFixed(1)} s, turns executed per lobby: ${turnsExecuted.join(", ")}`,
  );
  console.log(
    `down/client: ${kbpsPerClient.toFixed(2)} KB/s (budget ${opts.maxKbpsDown}) | ` +
      `turn gap p50 ${report.turnGapMs.p50.toFixed(1)} p99 ${report.turnGapMs.p99.toFixed(1)} ` +
      `max ${report.turnGapMs.max.toFixed(0)} ms`,
  );
  console.log(
    `intents ${intents}, hashes ${hashes}, desyncs ${desyncs}, errors ${errors.length}, ` +
      `closes ${closes}, rejoins ${rejoins} | shared sim ${simMean.toFixed(2)} ms/turn (max ${simMax.toFixed(1)})`,
  );
  if (cpuPct !== null) {
    console.log(
      `server pid ${opts.serverPid}: cpu ${cpuPct.toFixed(0)}%, rss ${rssMb!.toFixed(0)} MB`,
    );
  }
  if (errors.length > 0)
    console.log(`first errors:\n  ${errors.slice(0, 5).join("\n  ")}`);
  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 2));
    console.log(`report written to ${opts.out}`);
  }

  const failures: string[] = [];
  if (desyncs > 0) failures.push(`${desyncs} desync message(s)`);
  if (errors.length > 0) failures.push(`${errors.length} error(s)`);
  if (kbpsPerClient > opts.maxKbpsDown)
    failures.push(
      `${kbpsPerClient.toFixed(2)} KB/s per client > ${opts.maxKbpsDown}`,
    );
  if (turnsExecuted.some((t) => t < opts.turns))
    failures.push(`not every lobby reached ${opts.turns} turns`);
  if (failures.length > 0) {
    console.error(`LOAD TEST FAILED: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("load test passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
