import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  UnitType,
} from "../game/Game";
import { euclDistFN, TileRef } from "../game/GameMap";
import { PlayerExecution } from "./PlayerExecution";
import { TribeExecution } from "./TribeExecution";

/**
 * Stability and partisans (brief §6.6). Land taken from another state is
 * occupied until it assimilates; while enough of one people's land is held
 * unassimilated and ungarrisoned, they rise. An uprising is a tribe spawned
 * on the occupier's own ground — the existing bot machinery, pointed at the
 * occupier — that the occupier cannot absorb as an enclave and has to fight.
 *
 * The books are kept by GameImpl (conquer / relinquish / assimilate); this
 * execution only reads them once a second, like the win check, and decides
 * where the next uprising stands. Every choice is deterministic: tiles are
 * walked in the occupier's own tile order, the first that qualifies wins.
 */
export class UnrestExecution implements Execution {
  /** Occupied tiles examined per attempt before giving up until the cooldown. */
  private static readonly MAX_CANDIDATES = 256;
  private active = true;
  private mg: Game;

  init(mg: Game) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (ticks % 10 !== 0) return;
    const config = this.mg.config();
    if (!config.unrestEnabled()) return;
    for (const occupier of this.mg.players()) {
      if (!occupier.isAlive()) continue;
      if (occupier.type() === PlayerType.Bot) continue;
      for (const [formerID, tiles] of occupier.unrestByPeople()) {
        const former = this.mg.playerBySmallID(formerID);
        if (!former.isPlayer()) continue;
        const scale = config.doctrineUnrestScale((former as Player).doctrine());
        const threshold = Math.ceil(config.unrestPartisanThreshold() / scale);
        if (tiles < threshold) continue;
        const last = occupier.lastUprising(formerID);
        if (last >= 0 && ticks - last < config.partisanCooldownTicks()) {
          continue;
        }
        const center = this.findRisingGround(occupier, formerID);
        // An attempt, ground found or not: a garrisoned people tries again
        // after the cooldown, not every second across the whole empire.
        occupier.markUprising(formerID, ticks);
        if (center === null) continue;
        this.rise(occupier, former as Player, center, tiles);
      }
    }
  }

  /**
   * The first of the occupier's tiles, in its own tile order, that is held
   * from these people, out of reach of the occupier's defense posts, and with
   * no structure of anyone's within the four tiles an uprising takes.
   */
  private findRisingGround(occupier: Player, formerID: number): TileRef | null {
    const range = this.mg.config().defensePostRange();
    let looked = 0;
    for (const tile of occupier.tiles()) {
      if (this.mg.occupiedFrom(tile) !== formerID) continue;
      // Bounded: each candidate costs two grid queries, and an empire that
      // has garrisoned everything must not be walked to the end each time.
      if (++looked > UnrestExecution.MAX_CANDIDATES) return null;
      const garrison = this.mg.nearbyUnits(
        tile,
        range,
        UnitType.DefensePost,
        ({ unit }) => unit.owner() === occupier && unit.isActive(),
      );
      if (garrison.length > 0) continue;
      if (this.mg.nearbyUnits(tile, 4, Structures.types).length > 0) continue;
      return tile;
    }
    return null;
  }

  /** A people's partisans: a tribe on the occupier's ground, aimed at it. */
  private rise(
    occupier: Player,
    former: Player,
    center: TileRef,
    unrestTiles: number,
  ): void {
    const info = new PlayerInfo(
      `${former.name()} Partisans`,
      PlayerType.Bot,
      null,
      `partisan:${occupier.smallID()}:${former.smallID()}:${this.mg.ticks()}`,
    );
    const partisans = this.mg.addPlayer(info);
    partisans.markPartisanOf(occupier, former.smallID());
    partisans.setTroops(this.mg.config().partisanTroops(unrestTiles));
    for (const tile of this.mg.bfs(center, euclDistFN(center, 4, true))) {
      if (!this.mg.isLand(tile) || this.mg.isImpassable(tile)) continue;
      const owner = this.mg.owner(tile);
      if (owner.isPlayer() && owner !== occupier) continue;
      partisans.conquer(tile);
    }
    partisans.setSpawnTile(center);
    this.mg.addExecution(new PlayerExecution(partisans));
    this.mg.addExecution(new TribeExecution(partisans, occupier));
    this.mg.displayMessage(
      "events_display.partisans_rise",
      MessageType.PARTISANS_RISE,
      occupier.id(),
      undefined,
      { people: former.displayName() },
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
