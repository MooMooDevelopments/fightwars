import { renderNumber } from "../../client/Utils";
import { UnitView } from "../../client/view";
import { Config } from "../configuration/Config";
import { SharedWaterCache } from "../execution/nation/SharedWaterCache";
import { AbstractGraph } from "../pathfinding/algorithms/AbstractGraph";
import { PathFinder } from "../pathfinding/types";
import { AllPlayersStats, ClientID, Winner } from "../Schemas";
import { ATTACK_INDEX_SENT } from "../StatsSchemas";
import { simpleHash } from "../Util";
import { AllianceImpl } from "./AllianceImpl";
import { AllianceRequestImpl } from "./AllianceRequestImpl";
import {
  Alliance,
  AllianceRequest,
  AllianceTier,
  Cell,
  ColoredTeams,
  Duos,
  EmojiMessage,
  Execution,
  Game,
  GameMode,
  GameUpdates,
  HumansVsNations,
  MessageType,
  MutableAlliance,
  Nation,
  Player,
  PlayerID,
  PlayerInfo,
  PlayerType,
  Quads,
  SpawnArea,
  Team,
  TeamGameSpawnAreas,
  TerrainType,
  TerraNullius,
  Trios,
  Unit,
  UnitInfo,
  UnitType,
} from "./Game";
import { GameMap, TileRef } from "./GameMap";
import { GameUpdate, GameUpdateType } from "./GameUpdates";
import { MotionPlanRecord, packMotionPlans } from "./MotionPlans";
import { PlayerImpl } from "./PlayerImpl";
import { RailNetwork } from "./RailNetwork";
import { createRailNetwork } from "./RailNetworkImpl";
import { Stats } from "./Stats";
import { StatsImpl } from "./StatsImpl";
import { SupplyNetwork } from "./SupplyNetwork";
import { assignTeams, resolveTeamsList } from "./TeamAssignment";
import { TerraNulliusImpl } from "./TerraNulliusImpl";
import { UnitGrid, UnitPredicate } from "./UnitGrid";
import { WaterManager } from "./WaterManager";

export function createGame(
  humans: PlayerInfo[],
  nations: Nation[],
  gameMap: GameMap,
  miniGameMap: GameMap,
  config: Config,
  teamGameSpawnAreas?: TeamGameSpawnAreas,
): Game {
  const stats = new StatsImpl();
  return new GameImpl(
    humans,
    nations,
    gameMap,
    miniGameMap,
    config,
    stats,
    teamGameSpawnAreas,
  );
}

export type CellString = string;

export class GameImpl implements Game {
  private _ticks = 0;
  private startTick: number | null = null;

  private unInitExecs: Execution[] = [];

  _players: Map<PlayerID, PlayerImpl> = new Map<PlayerID, PlayerImpl>();
  _playersBySmallID: Player[] = [];

  private execs: Execution[] = [];
  private _width: number;
  private _height: number;
  _terraNullius: TerraNulliusImpl;

  allianceRequests: AllianceRequestImpl[] = [];

  private nextPlayerID = 1;
  private _nextUnitID = 1;

  private updates: GameUpdates = createGameUpdatesMap();
  private tileUpdatePairs: number[] = [];
  /** [smallID, tilesOwned, gold, troops] quads — see PlayerImpl.toUpdate. */
  private playerStatsQuads: number[] = [];
  /** [smallID, direction, index, troops] quads — see packAttackTroopDeltas. */
  private attackTroopsQuads: number[] = [];
  private motionPlanRecords: MotionPlanRecord[] = [];
  private planDrivenUnitIds = new Set<number>();
  private unitGrid: UnitGrid;
  private _unitMap = new Map<number, Unit>();

  private playerTeams: Team[] = [];
  private botTeam: Team = ColoredTeams.Bot;
  private _railNetwork: RailNetwork = createRailNetwork(this);
  private _supplyNetwork: SupplyNetwork;

  // Used to assign unique IDs to each new alliance
  private nextAllianceID: number = 0;

  private _isPaused: boolean = false;
  private _winner: Player | Team | null = null;
  private _leader: Player | Team | null = null;
  private _leaderShare = 0;
  private _coalitionActive = false;
  private _waterManager: WaterManager;
  private _sharedWaterCache: SharedWaterCache;
  private _teamGameSpawnAreas: TeamGameSpawnAreas | undefined;
  /** Tiles from nuke blast radii this tick, drained by the renderer. */
  private _nukeImpactQueue: TileRef[] = [];

  constructor(
    private _humans: PlayerInfo[],
    private _nations: Nation[],
    private _map: GameMap,
    private miniGameMap: GameMap,
    private _config: Config,
    private _stats: Stats,
    teamGameSpawnAreas?: TeamGameSpawnAreas,
  ) {
    const constructorStart = performance.now();

    this._teamGameSpawnAreas = teamGameSpawnAreas;
    this._terraNullius = new TerraNulliusImpl();
    this._width = _map.width();
    this._height = _map.height();
    this.unitGrid = new UnitGrid(this._map);
    this._waterManager = new WaterManager(
      this._map,
      this.miniGameMap,
      _config.disableNavMesh(),
    );
    this._sharedWaterCache = new SharedWaterCache(this);
    this._supplyNetwork = new SupplyNetwork(this, this._map, (tile) =>
      this.recordTileUpdate(tile),
    );

    if (_config.gameConfig().gameMode === GameMode.Team) {
      this.populateTeams();
    }
    this.addPlayers();

    console.log(
      `[GameImpl] Constructor total: ${(performance.now() - constructorStart).toFixed(0)}ms`,
    );
  }

  private populateTeams() {
    const totalPlayers = this._humans.length + this._nations.length;
    this.playerTeams = resolveTeamsList(
      this._config.playerTeams(),
      totalPlayers,
    );
  }

  private addPlayers() {
    if (this.config().gameConfig().gameMode === GameMode.FFA) {
      this._humans.forEach((p) => this.addPlayer(p));
      this._nations.forEach((n) => this.addPlayer(n.playerInfo));
      return;
    }

    if (this._config.playerTeams() === HumansVsNations) {
      this._humans.forEach((p) => this.addPlayer(p, ColoredTeams.Humans));
      this._nations.forEach((n) =>
        this.addPlayer(n.playerInfo, ColoredTeams.Nations),
      );
      return;
    }

    // Team mode
    const allPlayers = [
      ...this._humans,
      ...this._nations.map((n) => n.playerInfo),
    ];
    const pt = this._config.playerTeams();
    const isDuosTriosQuads = pt === Duos || pt === Trios || pt === Quads;
    const playerToTeam = assignTeams(
      allPlayers,
      this.playerTeams,
      isDuosTriosQuads,
    );
    for (const [playerInfo, team] of playerToTeam.entries()) {
      if (team === "kicked") {
        console.warn(`Player ${playerInfo.name} was kicked from team`);
        continue;
      }
      this.addPlayer(playerInfo, team);
    }
  }

  isOnEdgeOfMap(ref: TileRef): boolean {
    return this._map.isOnEdgeOfMap(ref);
  }

  owner(ref: TileRef): Player | TerraNullius {
    return this.playerBySmallID(this.ownerID(ref));
  }

  playerBySmallID(id: number): Player | TerraNullius {
    if (id === 0) {
      return this.terraNullius();
    }
    return this._playersBySmallID[id - 1];
  }
  map(): GameMap {
    return this._map;
  }
  miniMap(): GameMap {
    return this.miniGameMap;
  }

  addUpdate(update: GameUpdate) {
    (this.updates[update.type] as GameUpdate[]).push(update);
  }

  nextUnitID(): number {
    const old = this._nextUnitID;
    this._nextUnitID++;
    return old;
  }

  setFallout(tile: TileRef, value: boolean) {
    if (value && this.hasOwner(tile)) {
      throw Error(`cannot set fallout, tile ${tile} has owner`);
    }
    if (this._map.hasFallout(tile)) {
      return;
    }
    this._territoryVersion++;
    this._map.setFallout(tile, value);
    this.recordTileUpdate(tile);
    if (value) {
      // Constant duration, so pushes arrive in expiry order and the queue
      // drains from the front — no per-tile timestamp store needed.
      this.falloutExpiry.push(
        this._ticks + this._config.falloutDurationTicks(),
        tile,
      );
    }
  }

  /** [expiryTick, tile] pairs in push order; drained in expireFallout. */
  private falloutExpiry: number[] = [];
  private falloutExpiryHead = 0;

  // Stability (brief §6.6). A tile taken from another state is held from
  // that people until it assimilates: `_occupiedFrom` is the people's small
  // id per tile (0 = nobody's, 1.3 MB on the world map, allocated on the
  // first conquest of the kind); the queue is [assimilateTick, tile,
  // occupierSmallID] in push order, drained from the front once a second
  // like fallout. A stale entry — the tile changed hands since — is skipped,
  // because whoever holds it now pushed an entry of their own.
  private _occupiedFrom: Uint16Array | null = null;
  // The tick each occupied tile settles on. A queue entry is only current
  // while it matches: the same holder re-taking a tile it had lost restarts
  // the window, and the old entry must not settle it early.
  private _assimilateAt: Uint32Array | null = null;
  private assimilation: number[] = [];
  private assimilationHead = 0;

  private occupied(): Uint16Array {
    if (this._occupiedFrom === null) {
      this._occupiedFrom = new Uint16Array(this.width() * this.height());
      this._assimilateAt = new Uint32Array(this.width() * this.height());
    }
    return this._occupiedFrom;
  }

  occupiedFrom(tile: TileRef): number {
    return this._occupiedFrom === null ? 0 : this._occupiedFrom[tile];
  }

  /** Whether a player's land is somebody's to hold: states occupy, tribes raid. */
  private isOccupier(player: Player): boolean {
    return player.type() !== PlayerType.Bot;
  }

  /** Bookkeeping for a tile leaving `holder`'s hands; returns the people it was held from. */
  private releaseOccupied(holder: PlayerImpl, tile: TileRef): number {
    const from = this.occupiedFrom(tile);
    if (from === 0) return 0;
    this.occupied()[tile] = 0;
    this._assimilateAt![tile] = 0;
    const left = (holder._unrest.get(from) ?? 1) - 1;
    if (left <= 0) holder._unrest.delete(from);
    else holder._unrest.set(from, left);
    holder._unrestTotal--;
    return from;
  }

  private holdOccupied(holder: PlayerImpl, tile: TileRef, from: number): void {
    this.occupied()[tile] = from;
    holder._unrest.set(from, (holder._unrest.get(from) ?? 0) + 1);
    holder._unrestTotal++;
    const people = this.playerBySmallID(from);
    const scale = people.isPlayer()
      ? this._config.doctrineUnrestScale((people as Player).doctrine())
      : 1;
    const at =
      this._ticks + Math.floor(this._config.unrestAssimilationTicks() * scale);
    this._assimilateAt![tile] = at;
    this.assimilation.push(at, tile, holder.smallID());
  }

  /** Occupied land settles once its window has passed in the same hands. */
  private assimilate(): void {
    const q = this.assimilation;
    while (
      this.assimilationHead < q.length &&
      q[this.assimilationHead] <= this._ticks
    ) {
      const at = q[this.assimilationHead];
      const tile = q[this.assimilationHead + 1];
      const holderID = q[this.assimilationHead + 2];
      this.assimilationHead += 3;
      if (this.occupiedFrom(tile) === 0) continue;
      if (this._assimilateAt![tile] !== at) continue; // superseded
      if (this._map.ownerID(tile) !== holderID) continue;
      this.releaseOccupied(this.playerBySmallID(holderID) as PlayerImpl, tile);
    }
    if (this.assimilationHead >= 4096 && this.assimilationHead * 2 > q.length) {
      this.assimilation = q.slice(this.assimilationHead);
      this.assimilationHead = 0;
    }
  }

  /**
   * Fallout consequences (brief §6.4): irradiated ground clears itself after
   * falloutDurationTicks, whoever holds it by then. Once a second, like the
   * Doomsday Clock, and only the front of the queue, which is in tick order.
   */
  private expireFallout(): void {
    const q = this.falloutExpiry;
    while (
      this.falloutExpiryHead < q.length &&
      q[this.falloutExpiryHead] <= this._ticks
    ) {
      const tile = q[this.falloutExpiryHead + 1];
      this.falloutExpiryHead += 2;
      if (!this._map.hasFallout(tile)) continue;
      this._map.setFallout(tile, false);
      this._territoryVersion++;
      const owner = this.owner(tile);
      if (owner.isPlayer()) (owner as PlayerImpl)._irradiatedTiles--;
      this.recordTileUpdate(tile);
    }
    if (
      this.falloutExpiryHead >= 4096 &&
      this.falloutExpiryHead * 2 > q.length
    ) {
      this.falloutExpiry = q.slice(this.falloutExpiryHead);
      this.falloutExpiryHead = 0;
    }
  }

  setWater(tile: TileRef): void {
    if (!this.isLand(tile)) return;
    if (this.hasOwner(tile)) {
      throw Error(`cannot set water, tile ${tile} has owner`);
    }
    // Clear fallout if present (water tiles shouldn't have fallout)
    if (this._map.hasFallout(tile)) {
      this._map.setFallout(tile, false);
    }
    this._territoryVersion++;
    this._map.setWater(tile);
    this.recordTileUpdate(tile);
  }

  queueWaterConversion(tile: TileRef): void {
    if (!this.isLand(tile)) return;
    if (this.hasOwner(tile)) {
      throw Error(`cannot queue water conversion, tile ${tile} has owner`);
    }
    if (!this._config.waterNukes()) {
      this.setFallout(tile, true);
      return;
    }
    this._waterManager.queueTile(tile);
  }

  queueNukeImpact(tile: TileRef): void {
    this._nukeImpactQueue.push(tile);
  }

  drainNukeImpacts(): TileRef[] {
    const tiles = this._nukeImpactQueue;
    this._nukeImpactQueue = [];
    return tiles;
  }

  unit(id: number): Unit | undefined {
    return this._unitMap.get(id);
  }

  units(): Unit[];
  units(types: readonly UnitType[]): Unit[];
  units(type: UnitType, type2?: UnitType, type3?: UnitType): Unit[];
  units(
    first?: UnitType | readonly UnitType[],
    second?: UnitType,
    third?: UnitType,
  ): Unit[] {
    // Built as a single flat array per call; per-player intermediate arrays
    // would churn the heap (player.units() with no args is allocation-free).
    const out: Unit[] = [];
    if (Array.isArray(first) && (first as readonly UnitType[]).length > 0) {
      const ts = new Set(first as readonly UnitType[]);
      for (const p of this._players.values()) {
        for (const u of p.units()) {
          if (ts.has(u.type())) out.push(u);
        }
      }
      return out;
    }
    if (first === undefined || Array.isArray(first)) {
      for (const p of this._players.values()) {
        for (const u of p.units()) {
          out.push(u);
        }
      }
      return out;
    }
    if (second === undefined) {
      const type = first as UnitType;
      // Single-type query: every nation asks for e.g. all transport ships on
      // every tick, and walking every player's unit list each time was ~3 %
      // of a headless game. The memo is exact — it is invalidated by any
      // unit list change — and callers get their own copy.
      const memo = this.unitsByTypeMemo.get(type);
      if (memo !== undefined && memo.version === this._unitsVersion) {
        return memo.units.slice();
      }
      for (const p of this._players.values()) {
        for (const u of p.units()) {
          if (u.type() === type) out.push(u);
        }
      }
      this.unitsByTypeMemo.set(type, {
        version: this._unitsVersion,
        units: out,
      });
      return out.slice();
    }
    for (const p of this._players.values()) {
      for (const u of p.units()) {
        const t = u.type();
        if (t === first || t === second || t === third) {
          out.push(u);
        }
      }
    }
    return out;
  }

  // Level-weighted count of one unit type across every player. Every port asked
  // for the trade-ship count every tick, and the walk over every player's unit
  // list was ~3.5 % of a long headless game. Memoised on the units version, which
  // moves on any unit list change and on every level-up (UnitImpl.increaseLevel).
  private readonly unitCountMemo = new Map<
    UnitType,
    { version: number; count: number }
  >();
  unitCount(type: UnitType): number {
    const memo = this.unitCountMemo.get(type);
    if (memo !== undefined && memo.version === this._unitsVersion) {
      return memo.count;
    }
    let total = 0;
    for (const player of this._players.values()) {
      total += player.unitCount(type);
    }
    this.unitCountMemo.set(type, { version: this._unitsVersion, count: total });
    return total;
  }

  unitInfo(type: UnitType): UnitInfo {
    return this.config().unitInfo(type);
  }

  nations(): Nation[] {
    return this._nations;
  }

  createAllianceRequest(
    requestor: Player,
    recipient: Player,
    tier: AllianceTier = AllianceTier.FullAlliance,
  ): AllianceRequest | null {
    const held = requestor.allianceTierWith(recipient);
    if (held !== null && tier <= held) {
      console.log("cannot request alliance, already allied at that tier");
      return null;
    }
    if (
      recipient
        .incomingAllianceRequests()
        .find((ar) => ar.requestor() === requestor) !== undefined
    ) {
      console.log(`duplicate alliance request from ${requestor.name()}`);
      return null;
    }
    const correspondingReq = requestor
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === recipient);
    if (correspondingReq !== undefined) {
      console.log(`got corresponding alliance requests, accepting`);
      correspondingReq.accept();
      return null;
    }
    const ar = new AllianceRequestImpl(
      requestor,
      recipient,
      this._ticks,
      this,
      tier,
    );
    this.allianceRequests.push(ar);
    this.addUpdate(ar.toUpdate());
    return ar;
  }

  acceptAllianceRequest(request: AllianceRequestImpl) {
    this.allianceRequests = this.allianceRequests.filter(
      (ar) => ar !== request,
    );

    const requestor = request.requestor();
    const recipient = request.recipient();

    const existing = requestor.allianceWith(recipient);
    if (existing) {
      if (request.tier() <= existing.tier()) {
        throw new Error(
          `cannot accept alliance request, already allied with ${recipient.name()} at tier ${existing.tier()}`,
        );
      }
      // Climbing the ladder: the same alliance, one rung up, with its clock
      // reset — a deepened bond is a renewed one.
      existing.setTier(request.tier());
      existing.extend();
    } else {
      // Create and register the new alliance
      const alliance = new AllianceImpl(
        this,
        requestor as PlayerImpl,
        recipient as PlayerImpl,
        this._ticks,
        this.nextAllianceID++,
        request.tier(),
      );
      (alliance.requestor() as PlayerImpl)._alliances.push(alliance);
      (alliance.recipient() as PlayerImpl)._alliances.push(alliance);
    }
    (request.requestor() as PlayerImpl).pastOutgoingAllianceRequests.push(
      request,
    );

    this.addUpdate({
      type: GameUpdateType.AllianceRequestReply,
      request: request.toUpdate(),
      accepted: true,
    });
  }

  rejectAllianceRequest(request: AllianceRequestImpl) {
    this.allianceRequests = this.allianceRequests.filter(
      (ar) => ar !== request,
    );
    (request.requestor() as PlayerImpl).pastOutgoingAllianceRequests.push(
      request,
    );
    this.addUpdate({
      type: GameUpdateType.AllianceRequestReply,
      request: request.toUpdate(),
      accepted: false,
    });
  }

  hasPlayer(id: PlayerID): boolean {
    return this._players.has(id);
  }
  config(): Config {
    return this._config;
  }

  isPaused(): boolean {
    return this._isPaused;
  }

  setPaused(paused: boolean): void {
    this._isPaused = paused;
    this.addUpdate({ type: GameUpdateType.GamePaused, paused });
  }

  inSpawnPhase(): boolean {
    return this.startTick === null;
  }

  endSpawnPhase(): void {
    if (this.startTick !== null) {
      return;
    }
    this.startTick = this._ticks;
    this.addUpdate({
      type: GameUpdateType.SpawnPhaseEnd,
      startTick: this.startTick,
    });
  }

  ticks(): number {
    return this._ticks;
  }

  executeNextTick(): GameUpdates {
    this.updates = createGameUpdatesMap();
    this.tileUpdatePairs.length = 0;
    this._supplyNetwork.tick(this._ticks);
    if (this._ticks % 10 === 0) {
      this.expireFallout();
      this.assimilate();
    }
    this.execs.forEach((e) => {
      if (
        (!this.inSpawnPhase() || e.activeDuringSpawnPhase()) &&
        e.isActive()
      ) {
        e.tick(this._ticks);
      }
    });
    const inited: Execution[] = [];
    const unInited: Execution[] = [];
    this.unInitExecs.forEach((e) => {
      if (!this.inSpawnPhase() || e.activeDuringSpawnPhase()) {
        e.init(this, this._ticks);
        inited.push(e);
      } else {
        unInited.push(e);
      }
    });

    this.removeInactiveExecutions();

    this.execs.push(...inited);
    this.unInitExecs = unInited;
    for (const player of this._players.values()) {
      const update = player.toUpdate(
        this.playerStatsQuads,
        this.attackTroopsQuads,
      );
      if (update !== null) this.addUpdate(update);
    }
    if (this.ticks() % 10 === 0) {
      this.addUpdate({
        type: GameUpdateType.Hash,
        tick: this.ticks(),
        hash: this.hash(),
      });
    }
    // Flush pending water conversions + throttled graph rebuild
    const waterChangedTiles = this._waterManager.tick(this._ticks);
    for (const tile of waterChangedTiles) {
      this.recordTileUpdate(tile);
    }
    this._ticks++;
    return this.updates;
  }

  private recordTileUpdate(tile: TileRef): void {
    // Low 16 bits: tile state, bits 16-23: terrain byte
    this.tileUpdatePairs.push(
      tile,
      (this._map.tileState(tile) & 0xffff) |
        (this._map.terrainByte(tile) << 16),
    );
  }

  drainPackedTileUpdates(): Uint32Array {
    const pairs = this.tileUpdatePairs;
    const packed = new Uint32Array(pairs.length);
    for (let i = 0; i < pairs.length; i++) {
      packed[i] = pairs[i];
    }
    pairs.length = 0;
    return packed;
  }

  drainPackedPlayerUpdates(): Float64Array | null {
    const quads = this.playerStatsQuads;
    if (quads.length === 0) return null;
    const packed = Float64Array.from(quads);
    quads.length = 0;
    return packed;
  }

  drainPackedAttackUpdates(): Float64Array | null {
    const quads = this.attackTroopsQuads;
    if (quads.length === 0) return null;
    const packed = Float64Array.from(quads);
    quads.length = 0;
    return packed;
  }

  recordMotionPlan(record: MotionPlanRecord): void {
    switch (record.kind) {
      case "grid":
        this.planDrivenUnitIds.add(record.unitId);
        break;
      case "train":
        this.planDrivenUnitIds.add(record.engineUnitId);
        for (const unitId of record.carUnitIds) {
          this.planDrivenUnitIds.add(unitId);
        }
        break;
    }
    this.motionPlanRecords.push(record);
  }

  private isUnitPlanDriven(unitId: number): boolean {
    return this.planDrivenUnitIds.has(unitId);
  }

  maybeAddUnitUpdate(unit: Unit): void {
    if (!this.isUnitPlanDriven(unit.id())) {
      this.addUpdate(unit.toUpdate());
    }
  }

  onUnitMoved(unit: Unit): void {
    this.updateUnitTile(unit);
    this.maybeAddUnitUpdate(unit);
  }

  drainPackedMotionPlans(): Uint32Array | null {
    const records = this.motionPlanRecords;
    if (records.length === 0) {
      return null;
    }
    const packed = packMotionPlans(records);
    records.length = 0;
    return packed;
  }

  private hash(): number {
    let hash = 1;
    this._players.forEach((p) => {
      hash += p.hash();
    });
    return hash;
  }

  terraNullius(): TerraNullius {
    return this._terraNullius;
  }

  removeInactiveExecutions(): void {
    // Compact in place to avoid reallocating the (large) executions array
    // every tick.
    const execs = this.execs;
    const inSpawnPhase = this.inSpawnPhase();
    let w = 0;
    for (let i = 0; i < execs.length; i++) {
      const exec = execs[i];
      const keep = inSpawnPhase
        ? !exec.activeDuringSpawnPhase() || exec.isActive()
        : exec.isActive();
      if (keep) {
        execs[w++] = exec;
      }
    }
    execs.length = w;
  }

  players(): Player[] {
    return Array.from(this._players.values()).filter((p) => p.isAlive());
  }

  allPlayers(): Player[] {
    return Array.from(this._players.values());
  }

  executions(): Execution[] {
    return [...this.execs, ...this.unInitExecs];
  }

  addExecution(...exec: Execution[]) {
    this.unInitExecs.push(...exec);
  }

  removeExecution(exec: Execution) {
    this.execs = this.execs.filter((execution) => execution !== exec);
    this.unInitExecs = this.unInitExecs.filter(
      (execution) => execution !== exec,
    );
  }

  playerView(id: PlayerID): Player {
    return this.player(id);
  }

  addPlayer(playerInfo: PlayerInfo, team: Team | null = null): Player {
    const player = new PlayerImpl(
      this,
      this.nextPlayerID,
      playerInfo,
      this.config().startManpower(playerInfo),
      team ?? this.maybeAssignTeam(playerInfo),
    );
    this._playersBySmallID.push(player);
    this.nextPlayerID++;
    this._players.set(playerInfo.id, player);
    return player;
  }

  private maybeAssignTeam(player: PlayerInfo): Team | null {
    if (this._config.gameConfig().gameMode !== GameMode.Team) {
      return null;
    }
    if (player.playerType === PlayerType.Bot) {
      return this.botTeam;
    }
    const rand = simpleHash(player.id);
    return this.playerTeams[rand % this.playerTeams.length];
  }

  player(id: PlayerID): Player {
    const player = this._players.get(id);
    if (player === undefined) {
      throw new Error(`Player with id ${id} not found`);
    }
    return player;
  }

  playerByClientID(id: ClientID): Player | null {
    for (const [, player] of this._players) {
      if (player.clientID() === id) {
        return player;
      }
    }
    return null;
  }

  isOnMap(cell: Cell): boolean {
    return (
      cell.x >= 0 &&
      cell.x < this._width &&
      cell.y >= 0 &&
      cell.y < this._height
    );
  }

  neighborsWithDiag(tile: TileRef): TileRef[] {
    const x = this.x(tile);
    const y = this.y(tile);
    const ns: TileRef[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue; // Skip the center tile
        const newX = x + dx;
        const newY = y + dy;
        if (
          newX >= 0 &&
          newX < this._width &&
          newY >= 0 &&
          newY < this._height
        ) {
          ns.push(this._map.ref(newX, newY));
        }
      }
    }
    return ns;
  }

  // Zero-allocation neighbor iteration for performance-critical code
  forEachNeighborWithDiag(
    tile: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void {
    this._map.forEachNeighborWithDiag(tile, callback);
  }

  conquer(owner: PlayerImpl, tile: TileRef): void {
    if (!this.isLand(tile)) {
      throw Error(`cannot conquer water`);
    }
    if (this.isImpassable(tile)) {
      throw Error(`cannot conquer impassable terrain`);
    }
    const previousOwner = this.owner(tile) as TerraNullius | PlayerImpl;
    if (previousOwner.isPlayer()) {
      previousOwner._lastTileChange = this._ticks;
      previousOwner._tileChangeVersion++;
      previousOwner._tiles.delete(tile);
      previousOwner._borderTiles.delete(tile);
    }
    this._territoryVersion++;
    this._map.setOwnerID(tile, owner.smallID());
    owner._tiles.add(tile);
    owner._lastTileChange = this._ticks;
    owner._tileChangeVersion++;
    this.updateBorders(tile);
    // Fallout outlasts conquest (brief §6.4): the tile changes hands still
    // irradiated, and the new owner's books carry it until it expires.
    if (this._map.hasFallout(tile)) {
      if (this._config.falloutHasConsequences()) {
        if (previousOwner.isPlayer()) previousOwner._irradiatedTiles--;
        owner._irradiatedTiles++;
      } else {
        this._map.setFallout(tile, false);
      }
    }
    // Stability (brief §6.6): land taken from another state is held from
    // its people until it assimilates; their own return liberates it, and a
    // third party inherits the grievance rather than starting a new one.
    if (this._config.unrestEnabled()) {
      // Whose land this is: the people it was already held from, or the
      // previous owner's own — and partisans' ground is their people's, so
      // taking it from them is taking it from the people, not from a tribe.
      let from = previousOwner.isPlayer()
        ? this.releaseOccupied(previousOwner, tile)
        : 0;
      if (from === 0 && previousOwner.isPlayer()) {
        if (previousOwner.partisanOf() !== null) {
          from = previousOwner.partisanFor();
        } else if (this.isOccupier(previousOwner)) {
          from = previousOwner.smallID();
        }
      }
      if (this.isOccupier(owner) && from !== 0 && from !== owner.smallID()) {
        this.holdOccupied(owner, tile, from);
      }
    }
    this._supplyNetwork.onConquer(tile, owner.smallID());
    this.recordTileUpdate(tile);
  }

  relinquish(tile: TileRef) {
    if (!this.hasOwner(tile)) {
      throw new Error(`Cannot relinquish tile because it is unowned`);
    }
    if (this.isWater(tile)) {
      throw new Error("Cannot relinquish water");
    }

    const previousOwner = this.owner(tile) as PlayerImpl;
    previousOwner._lastTileChange = this._ticks;
    previousOwner._tileChangeVersion++;
    previousOwner._tiles.delete(tile);
    previousOwner._borderTiles.delete(tile);
    if (this._map.hasFallout(tile)) previousOwner._irradiatedTiles--;
    this.releaseOccupied(previousOwner, tile);

    this._territoryVersion++;
    this._map.setOwnerID(tile, 0);
    this.updateBorders(tile);
    this._supplyNetwork.onRelinquish(tile);
    this.recordTileUpdate(tile);
  }

  // Reusable neighbor buffer to avoid closures/allocation in updateBorders.
  private borderNbuf: TileRef[] = [0, 0, 0, 0];

  private updateBorders(tile: TileRef) {
    this.updateBorderStatus(tile);
    const numNeighbors = this._map.neighbors4(tile, this.borderNbuf);
    for (let i = 0; i < numNeighbors; i++) {
      this.updateBorderStatus(this.borderNbuf[i]);
    }
  }

  private updateBorderStatus(t: TileRef): void {
    if (!this._map.hasOwner(t)) {
      return;
    }
    const owner = this.owner(t) as PlayerImpl;
    if (this._map.isBorder(t)) {
      owner._borderTiles.add(t);
    } else {
      owner._borderTiles.delete(t);
    }
  }

  target(targeter: Player, target: Player) {
    this.addUpdate({
      type: GameUpdateType.TargetPlayer,
      playerID: targeter.smallID(),
      targetID: target.smallID(),
    });
  }

  public breakAlliance(breaker: Player, alliance: MutableAlliance) {
    let other: Player;
    if (alliance.requestor() === breaker) {
      other = alliance.recipient();
    } else {
      other = alliance.requestor();
    }
    if (!breaker.isAlliedWith(other)) {
      throw new Error(
        `${breaker} not allied with ${other}, cannot break alliance`,
      );
    }
    if (!other.isTraitor() && !other.isDisconnected()) {
      // A Diplomatic breaker is forgiven sooner (brief §6.6).
      breaker.markTraitor(
        this._config.allianceBreakTraitorScale(alliance.tier()) *
          this._config.doctrineTraitorScale(breaker.doctrine()),
      );
    }

    this.detachAlliance(alliance);

    this.addUpdate({
      type: GameUpdateType.BrokeAlliance,
      traitorID: breaker.smallID(),
      betrayedID: other.smallID(),
      allianceID: alliance.id(),
    });
  }

  public expireAlliance(alliance: Alliance) {
    const p1Set = new Set(alliance.recipient().alliances());
    const alliances = alliance
      .requestor()
      .alliances()
      .filter((a) => p1Set.has(a));
    if (alliances.length !== 1) {
      throw new Error(
        `cannot expire alliance: must have exactly one alliance, have ${alliances.length}`,
      );
    }
    this.detachAlliance(alliances[0]);
    this.addUpdate({
      type: GameUpdateType.AllianceExpired,
      player1ID: alliance.requestor().smallID(),
      player2ID: alliance.recipient().smallID(),
    });
  }

  public removeAlliancesByPlayerSilently(player: Player): void {
    // Snapshot — detachAlliance reassigns the player's _alliances as it goes.
    const removed = [...(player as PlayerImpl)._alliances];
    for (const alliance of removed) this.detachAlliance(alliance);
  }

  /** Remove an alliance from both participants' per-player alliance lists. */
  private detachAlliance(alliance: Alliance): void {
    const requestor = alliance.requestor() as PlayerImpl;
    const recipient = alliance.recipient() as PlayerImpl;
    requestor._alliances = requestor._alliances.filter((a) => a !== alliance);
    recipient._alliances = recipient._alliances.filter((a) => a !== alliance);
  }

  public isSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this.config().spawnImmunityDuration()
    );
  }

  public elapsedGameSeconds(): number {
    return this.ticksSinceStart() / 10;
  }

  public isNationSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this.config().nationSpawnImmunityDuration()
    );
  }

  private ticksSinceStart(): number {
    if (this.inSpawnPhase()) {
      return 0;
    }

    return Math.max(0, this.ticks() - this.startTick!);
  }

  sendEmojiUpdate(msg: EmojiMessage): void {
    this.addUpdate({
      type: GameUpdateType.Emoji,
      emoji: msg,
    });
  }

  setWinner(
    winner: Player | Team | null,
    allPlayersStats: AllPlayersStats,
  ): void {
    this._winner = winner;
    // OFM: snapshot final tiles for standings (bots skipped in recordFinalTiles).
    for (const player of this.players()) {
      this.stats().recordFinalTiles(player, player.numTilesOwned());
    }
    this.addUpdate({
      type: GameUpdateType.Win,
      winner: winner === null ? undefined : this.makeWinner(winner),
      allPlayersStats,
    });
  }

  leaderShare(): number {
    return this._leaderShare;
  }

  leader(): Player | Team | null {
    return this._leader;
  }

  setLeader(leader: Player | Team | null, share: number): void {
    this._leader = leader;
    this._leaderShare = share;
    const active =
      leader !== null && share >= this._config.coalitionThreshold();
    if (active === this._coalitionActive) return;
    this._coalitionActive = active;
    // Only on the flip, so the client's offer card appears once and clears
    // once rather than being re-issued ten times a second.
    const leaderID =
      leader === null
        ? 0
        : typeof leader === "string"
          ? (this.leaderOfTeam(leader)?.smallID() ?? 0)
          : leader.smallID();
    this.addUpdate({
      type: GameUpdateType.Coalition,
      leaderID,
      share,
      active,
    });
  }

  /** In a team game the coalition is offered against a team; name its largest member. */
  private leaderOfTeam(team: Team): Player | null {
    let best: Player | null = null;
    for (const p of this.players()) {
      if (p.team() !== team) continue;
      if (best === null || p.numTilesOwned() > best.numTilesOwned()) best = p;
    }
    return best;
  }

  getWinner(): Player | Team | null {
    return this._winner;
  }

  private isEligibleForTeamWin(
    p: Player,
    team: string,
    threshold: number,
  ): boolean {
    if (p.team() !== team || p.clientID() === null || !p.hasSpawned()) {
      return false;
    }
    if (!p.isDisconnected()) return true;
    const snap = p.disconnectSnapshot();
    if (!snap || !snap.wasAlive) return true;
    return (
      snap.totalLand > 0 && 10 * snap.teamTiles >= threshold * snap.totalLand
    );
  }

  makeWinner(winner: string | Player): Winner | undefined {
    if (typeof winner === "string") {
      const threshold = this._config.teamLandShareWinThresholdTenths();
      return [
        "team",
        winner,
        ...this.allPlayers()
          .filter((p) => this.isEligibleForTeamWin(p, winner, threshold))
          .map((p) => p.clientID()!),
      ];
    }
    const clientId = winner.clientID();
    return clientId === null ? ["nation", winner.name()] : ["player", clientId];
  }

  teams(): Team[] {
    if (this._config.gameConfig().gameMode !== GameMode.Team) {
      return [];
    }
    return [this.botTeam, ...this.playerTeams];
  }

  teamTilesOwned(team: Team): number {
    let teamTiles = 0;
    for (const p of this.allPlayers()) {
      if (p.team() === team) teamTiles += p.numTilesOwned();
    }
    return teamTiles;
  }

  totalLandTiles(): number {
    return Math.max(0, this.numLandTiles() - this.numTilesWithFallout());
  }

  teamSpawnArea(team: Team): SpawnArea | undefined {
    if (!this._teamGameSpawnAreas) {
      return undefined;
    }
    const numTeams = this.playerTeams.length;
    const areas = this._teamGameSpawnAreas[String(numTeams)];
    if (!areas) {
      return undefined;
    }
    const teamIndex = this.playerTeams.indexOf(team);
    if (teamIndex < 0 || teamIndex >= areas.length) {
      return undefined;
    }
    return areas[teamIndex];
  }

  displayMessage(
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
    goldAmount?: bigint,
    params?: Record<string, string | number>,
    unitID?: number,
    focusPlayerID?: PlayerID,
  ): void {
    let id: number | null = null;
    if (playerID !== null) {
      id = this.player(playerID).smallID();
    }
    const focusID =
      focusPlayerID !== undefined
        ? this.player(focusPlayerID).smallID()
        : undefined;
    this.addUpdate({
      type: GameUpdateType.DisplayEvent,
      messageType: type,
      message: message,
      playerID: id,
      goldAmount: goldAmount,
      params: params,
      unitID: unitID,
      focusPlayerID: focusID,
    });
  }

  displayChat(
    message: string,
    category: string,
    target: PlayerID | undefined,
    playerID: PlayerID | null,
    isFrom: boolean,
    recipient: string,
  ): void {
    let id: number | null = null;
    if (playerID !== null) {
      id = this.player(playerID).smallID();
    }
    this.addUpdate({
      type: GameUpdateType.DisplayChatEvent,
      key: message,
      category: category,
      target: target,
      playerID: id,
      isFrom,
      recipient: recipient,
    });
  }

  displayIncomingUnit(
    unitID: number,
    message: string,
    type: MessageType,
    playerID: PlayerID,
  ): void {
    const id = this.player(playerID).smallID();

    this.addUpdate({
      type: GameUpdateType.UnitIncoming,
      unitID: unitID,
      message: message,
      messageType: type,
      playerID: id,
    });
  }

  // Bumped whenever any player's unit list changes (build, delete, capture);
  // keys the units(type) memo below.
  private _unitsVersion = 0;
  private readonly unitsByTypeMemo = new Map<
    UnitType,
    { version: number; units: Unit[] }
  >();
  bumpUnitsVersion(): void {
    this._unitsVersion++;
  }

  // Bumped on every change of tile ownership, fallout or land/water — i.e.
  // anything Player.nearby() can observe — so per-player answers can be memoised
  // for as long as nothing on the map moved.
  private _territoryVersion = 0;
  territoryVersion(): number {
    return this._territoryVersion;
  }

  addUnit(u: Unit) {
    this._unitsVersion++;
    this.unitGrid.addUnit(u);
    this._unitMap.set(u.id(), u);
    this._supplyNetwork.onUnitChanged(u);
  }
  removeUnit(u: Unit) {
    this._unitsVersion++;
    this._supplyNetwork.onUnitChanged(u);
    this.unitGrid.removeUnit(u);
    this._unitMap.delete(u.id());
    this.planDrivenUnitIds.delete(u.id());
    if (u.hasTrainStation()) {
      this._railNetwork.removeStation(u);
    }
  }
  updateUnitTile(u: Unit) {
    this.unitGrid.updateUnitCell(u);
  }

  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ) {
    return this.unitGrid.hasUnitNearby(
      tile,
      searchRange,
      type,
      playerId,
      includeUnderConstruction,
    );
  }

  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: Unit) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean {
    return this.unitGrid.anyUnitNearby(
      tile,
      searchRange,
      types,
      predicate as (unit: Unit | UnitView) => boolean,
      playerId,
      includeUnderConstruction,
    );
  }

  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
    includeUnderConstruction?: boolean,
  ): Array<{ unit: Unit; distSquared: number }> {
    return this.unitGrid.nearbyUnits(
      tile,
      searchRange,
      types,
      predicate,
      includeUnderConstruction,
    ) as Array<{
      unit: Unit;
      distSquared: number;
    }>;
  }

  ref(x: number, y: number): TileRef {
    return this._map.ref(x, y);
  }
  isValidRef(ref: TileRef): boolean {
    return this._map.isValidRef(ref);
  }
  x(ref: TileRef): number {
    return this._map.x(ref);
  }
  y(ref: TileRef): number {
    return this._map.y(ref);
  }
  cell(ref: TileRef): Cell {
    return this._map.cell(ref);
  }
  width(): number {
    return this._map.width();
  }
  height(): number {
    return this._map.height();
  }
  numLandTiles(): number {
    return this._map.numLandTiles();
  }
  waterVersion(): number {
    return this._map.waterVersion();
  }
  isValidCoord(x: number, y: number): boolean {
    return this._map.isValidCoord(x, y);
  }
  isLand(ref: TileRef): boolean {
    return this._map.isLand(ref);
  }
  isImpassable(ref: TileRef): boolean {
    return this._map.isImpassable(ref);
  }
  isOceanShore(ref: TileRef): boolean {
    return this._map.isOceanShore(ref);
  }
  isOcean(ref: TileRef): boolean {
    return this._map.isOcean(ref);
  }
  isShoreline(ref: TileRef): boolean {
    return this._map.isShoreline(ref);
  }
  magnitude(ref: TileRef): number {
    return this._map.magnitude(ref);
  }
  terrainByte(ref: TileRef): number {
    return this._map.terrainByte(ref);
  }
  setShorelineBit(ref: TileRef): void {
    this._map.setShorelineBit(ref);
  }
  clearShorelineBit(ref: TileRef): void {
    this._map.clearShorelineBit(ref);
  }
  setOcean(ref: TileRef): void {
    this._map.setOcean(ref);
  }
  setMagnitude(ref: TileRef, value: number): void {
    this._map.setMagnitude(ref, value);
  }
  ownerID(ref: TileRef): number {
    return this._map.ownerID(ref);
  }
  hasOwner(ref: TileRef): boolean {
    return this._map.hasOwner(ref);
  }
  setOwnerID(ref: TileRef, playerId: number): void {
    this._territoryVersion++;
    return this._map.setOwnerID(ref, playerId);
  }
  isSupplied(ref: TileRef): boolean {
    return this._map.isSupplied(ref);
  }

  setSupplied(ref: TileRef, value: boolean): void {
    this._map.setSupplied(ref, value);
  }

  hasFallout(ref: TileRef): boolean {
    return this._map.hasFallout(ref);
  }
  isBorder(ref: TileRef): boolean {
    return this._map.isBorder(ref);
  }
  neighbors(ref: TileRef): TileRef[] {
    return this._map.neighbors(ref);
  }
  // Zero-allocation neighbor iteration (cardinal only)
  forEachNeighbor(tile: TileRef, callback: (neighbor: TileRef) => void): void {
    this._map.forEachNeighbor(tile, callback);
  }
  neighbors4(ref: TileRef, out: TileRef[]): number {
    return this._map.neighbors4(ref, out);
  }
  isWater(ref: TileRef): boolean {
    return this._map.isWater(ref);
  }
  isShore(ref: TileRef): boolean {
    return this._map.isShore(ref);
  }
  cost(ref: TileRef): number {
    return this._map.cost(ref);
  }
  terrainType(ref: TileRef): TerrainType {
    return this._map.terrainType(ref);
  }
  forEachTile(fn: (tile: TileRef) => void): void {
    return this._map.forEachTile(fn);
  }
  manhattanDist(c1: TileRef, c2: TileRef): number {
    return this._map.manhattanDist(c1, c2);
  }
  euclideanDistSquared(c1: TileRef, c2: TileRef): number {
    return this._map.euclideanDistSquared(c1, c2);
  }
  circleSearch(
    tile: TileRef,
    radius: number,
    filter?: (tile: TileRef, d2: number) => boolean,
  ): Set<TileRef> {
    return this._map.circleSearch(tile, radius, filter);
  }
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef> {
    return this._map.bfs(tile, filter);
  }
  tileState(tile: TileRef): number {
    return this._map.tileState(tile);
  }
  tileStateBuffer(): Uint16Array {
    return this._map.tileStateBuffer();
  }
  updateTile(tile: TileRef, state: number): boolean {
    return this._map.updateTile(tile, state);
  }
  numTilesWithFallout(): number {
    return this._map.numTilesWithFallout();
  }
  stats(): Stats {
    return this._stats;
  }
  supplyNetwork(): SupplyNetwork {
    return this._supplyNetwork;
  }

  railNetwork(): RailNetwork {
    return this._railNetwork;
  }
  miniWaterHPA(): PathFinder<number> | null {
    return this._waterManager.miniWaterHPA();
  }
  miniWaterGraph(): AbstractGraph | null {
    return this._waterManager.miniWaterGraph();
  }
  waterGraphVersion(): number {
    return this._waterManager.waterGraphVersion();
  }
  getWaterComponent(tile: TileRef): number | null {
    return this._waterManager.getWaterComponent(tile);
  }
  hasWaterComponent(tile: TileRef, component: number): boolean {
    return this._waterManager.hasWaterComponent(tile, component);
  }
  getWaterComponentSize(tile: TileRef): number | null {
    return this._waterManager.getWaterComponentSize(tile);
  }
  sharedWaterComponents(player: Player): Set<number> | null {
    return this._sharedWaterCache.get(player);
  }
  conquerPlayer(conqueror: Player, conquered: Player) {
    if (conquered.isDisconnected() && conqueror.isOnSameTeam(conquered)) {
      const ships = conquered
        .units()
        .filter(
          (u) =>
            u.type() === UnitType.Warship ||
            u.type() === UnitType.Submarine ||
            u.type() === UnitType.TransportShip,
        );

      for (const ship of ships) {
        conqueror.captureUnit(ship);
      }
    }

    // Don't transfer gold when the conquered player didn't play (never attacked anyone)
    // This is especially important when starting gold is enabled
    const stats = this._stats.getPlayerStats(conquered);
    const attacksSent = stats?.attacks?.[ATTACK_INDEX_SENT] ?? 0n;
    const skipGoldTransfer =
      attacksSent === 0n && conquered.type() === PlayerType.Human;
    const gold = skipGoldTransfer ? 0n : conquered.gold();
    const goldCaptured = skipGoldTransfer
      ? 0n
      : this._config.conquerGoldAmount(conquered);

    if (skipGoldTransfer) {
      this.displayMessage(
        "events_display.conquered_no_gold",
        MessageType.CONQUERED_PLAYER,
        conqueror.id(),
        undefined,
        {
          name: conquered.displayName(),
        },
        undefined,
        conquered.id(),
      );
    } else {
      this.displayMessage(
        "events_display.received_gold_from_conquest",
        MessageType.CONQUERED_PLAYER,
        conqueror.id(),
        gold,
        {
          gold: renderNumber(goldCaptured),
          name: conquered.displayName(),
        },
        undefined,
        conquered.id(),
      );
      conqueror.addGold(goldCaptured);
      conquered.removeGold(gold);

      // Record stats
      this.stats().goldWar(conqueror, conquered, goldCaptured);
    }

    // OFM: per-kill log for standings (humans-only filtered in recordKill).
    this.stats().recordKill(conqueror, conquered, this.ticks());
    // OFM live standings: attribute the elimination so the live snapshot can
    // credit the kill (null when the conqueror has no client, e.g. a bot/nation),
    // and stamp the finishing place NOW rather than deferring to PlayerExecution:
    // if the game ends this tick (winner declared) the conquered player's
    // execution may never run again. Exclude the conquered player from the alive
    // count. PlayerExecution keeps the same stamp as a fallback for non-conquest
    // deaths; recordDeathPosition is first-write-wins, so this value sticks.
    this.stats().recordKilledBy(conquered, conqueror.clientID());
    this.stats().recordDeathPosition(
      conquered,
      this.players().filter(
        (p) => p !== conquered && p.type() !== PlayerType.Bot,
      ).length + 1,
    );

    this.addUpdate({
      type: GameUpdateType.ConquestEvent,
      conquerorId: conqueror.id(),
      conqueredId: conquered.id(),
      gold: goldCaptured,
    });
  }
}

// Or a more dynamic approach that will catch new enum values:
const createGameUpdatesMap = (): GameUpdates => {
  const map = {} as GameUpdates;
  Object.values(GameUpdateType)
    .filter((key) => !isNaN(Number(key))) // Filter out reverse mappings
    .forEach((key) => {
      map[key as GameUpdateType] = [];
    });
  return map;
};
