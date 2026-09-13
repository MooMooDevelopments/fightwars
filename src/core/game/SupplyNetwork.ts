import { Game, Player, Unit, UnitType } from "./Game";
import { GameMap, TileRef } from "./GameMap";

/**
 * A tile whose distance to its owner's supply sources is unknown or beyond
 * `Config.supplyMaxRange()`. Both mean the same thing to the balance
 * formulas — fully over-extended — so no caller needs to tell them apart.
 */
export const SUPPLY_UNSUPPLIED = 255;

/**
 * How many ticks a full recompute cycle takes. Each tick refreshes the
 * players whose index in `game.players()` falls in this tick's slot, so the
 * cost of the sweep is spread instead of landing on one tick in sixty.
 *
 * Six seconds is long because the sweep only corrects drift: conquest keeps
 * itself right through `onConquer`, and the change a player actually watches
 * for — building a city behind the front — refreshes that player on the next
 * tick through `onUnitChanged`. At 20 ticks the sweep cost 1.17 ms of a
 * 5.8 ms tick on the 150-bot world benchmark, which is a great deal to pay
 * for correcting something that is already correct.
 */
export const SUPPLY_REFRESH_PERIOD = 60;

/** The structures a supply field floods from, beside the player's capital. */
const SOURCE_TYPES: readonly UnitType[] = [
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
];

/**
 * Per-tile distance, in tiles walked through the owner's own territory, to
 * the nearest of that owner's supply sources: its spawn tile, and every
 * City, Port and Factory it holds.
 *
 * This is the "supply lines" input the attack formulas read (brief §6.1). It
 * is maintained two ways, and the split is the reason it is affordable:
 *
 *  - **Incrementally, on the hot path.** A conquered tile's distance is one
 *    more than the lowest of its owner's four neighbours (`frontDistance`),
 *    four array reads at the moment of conquest. An advance therefore carries
 *    its own supply line forward, and a push that outruns its cities climbs
 *    a tile of distance per tile taken, with no sweep involved.
 *  - **By a periodic correcting sweep.** Relaxation alone cannot see a
 *    distance get *shorter* (a new city behind the front) or a source
 *    disappear (a captured port), so every player is re-flooded from scratch
 *    once per `SUPPLY_REFRESH_PERIOD` ticks. The sweep is authoritative; the
 *    relaxation only has to be right for the two seconds until it runs.
 *
 * Determinism: the flood is a level-order BFS in the map's fixed N/S/W/E
 * neighbour order, seeded from units in creation order, so every client walks
 * the tiles in the same sequence and writes the same bytes. Nothing here uses
 * randomness or floating point.
 */
export class SupplyNetwork {
  private readonly dist: Uint8Array;
  /** Players whose field has never been built; refreshed off-cycle. */
  private readonly refreshed = new Set<number>();
  /** Players whose sources changed since their last flood. */
  private readonly dirty = new Set<number>();
  // What each player's territory and unit list looked like when its field was
  // last built. A field is a pure function of those two, so a player whose
  // versions have not moved already has the right answer and re-flooding it
  // is pure waste — which matters, because the sweep's cost is proportional
  // to *claimed* land and by the late game that is the whole map.
  private readonly lastTileVersion = new Map<number, number>();
  private readonly lastUnitsVersion = new Map<number, number>();
  // BFS frontiers, reused across every flood so a sweep allocates nothing.
  private cur: TileRef[] = [];
  private next: TileRef[] = [];
  private readonly nbuf: TileRef[] = [0, 0, 0, 0];

  constructor(
    private readonly game: Game,
    private readonly map: GameMap,
    /** Called for each tile whose rendered supplied flag changed. */
    private readonly onTileChanged: (tile: TileRef) => void,
  ) {
    this.dist = new Uint8Array(game.width() * game.height()).fill(
      SUPPLY_UNSUPPLIED,
    );
  }

  /** Distance recorded for the tile, or SUPPLY_UNSUPPLIED. */
  distance(tile: TileRef): number {
    return this.dist[tile];
  }

  /**
   * What a tile's supply distance is for `ownerSmallID`, read from the
   * neighbours that player already owns. This is the number an attack pays
   * for the tile it is about to take — the front's distance from supply,
   * measured through the attacker's own ground.
   */
  frontDistance(tile: TileRef, ownerSmallID: number): number {
    let best = SUPPLY_UNSUPPLIED;
    const count = this.map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < count; i++) {
      const n = this.nbuf[i];
      if (this.map.ownerID(n) !== ownerSmallID) continue;
      const d = this.dist[n];
      if (d < best) best = d;
    }
    if (best === SUPPLY_UNSUPPLIED) return SUPPLY_UNSUPPLIED;
    const capped = best + 1;
    const max = this.game.config().supplyMaxRange();
    return capped > max ? max : capped;
  }

  /** Extends the field onto a tile that just changed hands. */
  onConquer(tile: TileRef, ownerSmallID: number): void {
    this.write(tile, this.frontDistance(tile, ownerSmallID));
  }

  /**
   * Notes that a player's set of sources may have changed. Called for every
   * unit built or destroyed; only the three structures a field floods from
   * mark anything, so trade ships and boats cost a switch and nothing else.
   */
  onUnitChanged(unit: Unit): void {
    if (!SOURCE_TYPES.includes(unit.type())) return;
    this.dirty.add(unit.owner().smallID());
  }

  /** Drops a tile out of the field when its owner loses it. */
  onRelinquish(tile: TileRef): void {
    this.write(tile, SUPPLY_UNSUPPLIED);
  }

  /** Runs this tick's slice of the correcting sweep. */
  tick(ticks: number): void {
    const players = this.game.players();
    const slot = ticks % SUPPLY_REFRESH_PERIOD;
    // Slots are positions in the living-players list, so a death shifts the
    // players behind it into a different slot and one cycle may refresh a
    // player twice or not at all. That is deterministic and self-correcting,
    // and cheaper than keeping a stable schedule of its own.
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const smallID = player.smallID();
      // A player that has never been flooded is done immediately rather than
      // waiting for its slot: until the first flood its whole territory reads
      // as unsupplied, which would tax the opening of every game. So is one
      // that has just gained or lost a source, which is the change a player
      // actually watches for.
      if (!this.refreshed.has(smallID) || this.dirty.has(smallID)) {
        this.refresh(player);
        continue;
      }
      if (i % SUPPLY_REFRESH_PERIOD !== slot) continue;
      if (
        player.tileChangeVersion() === this.lastTileVersion.get(smallID) &&
        player.myUnitsVersion() === this.lastUnitsVersion.get(smallID)
      ) {
        continue;
      }
      this.refresh(player);
    }
  }

  /** Rebuilds one player's field from its sources. */
  refresh(player: Player): void {
    const map = this.map;
    const dist = this.dist;
    const smallID = player.smallID();
    this.refreshed.add(smallID);
    this.dirty.delete(smallID);
    this.lastTileVersion.set(smallID, player.tileChangeVersion());
    this.lastUnitsVersion.set(smallID, player.myUnitsVersion());

    // The sweep writes `dist` directly and syncs the rendered flag once at
    // the end. Going through write() here would clear every tile's flag and
    // set most of them again, and each flip records a tile update — a
    // player's whole territory on the wire, twice, every cycle.
    // forEach, not for...of: `tiles()` iterates through a generator, and the
    // sweep makes two full passes over a player's territory.
    const tiles = player.tiles();
    tiles.forEach((tile) => {
      dist[tile] = SUPPLY_UNSUPPLIED;
    });

    let cur = this.cur;
    let next = this.next;
    cur.length = 0;
    const seed = (tile: TileRef) => {
      if (map.ownerID(tile) !== smallID || dist[tile] === 0) return;
      dist[tile] = 0;
      cur.push(tile);
    };
    const spawn = player.spawnTile();
    if (spawn !== undefined) seed(spawn);
    for (const unit of player.units(
      UnitType.City,
      UnitType.Port,
      UnitType.Factory,
    )) {
      if (unit.isActive()) seed(unit.tile());
    }

    const max = this.game.config().supplyMaxRange();
    for (let depth = 1; depth <= max && cur.length > 0; depth++) {
      next.length = 0;
      for (const tile of cur) {
        const count = map.neighbors4(tile, this.nbuf);
        for (let i = 0; i < count; i++) {
          const n = this.nbuf[i];
          if (map.ownerID(n) !== smallID || dist[n] <= depth) continue;
          dist[n] = depth;
          next.push(n);
        }
      }
      const swap = cur;
      cur = next;
      next = swap;
    }
    this.cur = cur;
    this.next = next;

    const free = this.game.config().supplyFreeRange();
    tiles.forEach((tile) => {
      const supplied = dist[tile] <= free;
      if (map.isSupplied(tile) !== supplied) {
        map.setSupplied(tile, supplied);
        this.onTileChanged(tile);
      }
    });
  }

  private write(tile: TileRef, distance: number): void {
    this.dist[tile] = distance;
    const supplied = distance <= this.game.config().supplyFreeRange();
    if (this.map.isSupplied(tile) !== supplied) {
      this.map.setSupplied(tile, supplied);
      this.onTileChanged(tile);
    }
  }
}
