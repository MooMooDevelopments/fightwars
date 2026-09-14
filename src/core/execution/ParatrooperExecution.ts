import { renderTroops } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { AttackExecution } from "./AttackExecution";

/**
 * Paratrooper (brief §6.4, session 12). An airborne assault: a share of the
 * owner's troops flies from the nearest silo within `paratrooperRange()`
 * straight to the target tile — over water, mountains, anyone's land — and
 * lands as an attack from that tile, the way a transport ship lands one on
 * a shore. The drop is the naval invasion's shape with an air path: the
 * troops leave the owner at launch, the target is warned, and on landing
 * the tile is taken and an AttackExecution opens from it. Dropped on the
 * owner's own land (the target changed hands while it flew) the troops
 * come home; dropped on a friend's, they join the friend's count as a
 * transport's would.
 *
 * Nothing intercepts it (a SAM reads a warhead's trajectory, which a drop
 * does not carry); its limits are the range from a silo, the troop cap,
 * and the price. Deterministic: the air path is the shell's, stepped a
 * fixed number of tiles a tick.
 */
export class ParatrooperExecution implements Execution {
  private active = true;
  private mg: Game;
  private pathFinder: SteppingPathFinder<TileRef>;
  private plane: Unit | null = null;
  private target: Player | TerraNullius;
  private troops = 0;

  constructor(
    private player: Player,
    private dst: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinding.Air(mg);
    this.target = mg.owner(this.dst);
    if (this.target.isPlayer() && !this.player.canAttackPlayer(this.target)) {
      this.active = false;
      return;
    }
    const config = mg.config();
    this.troops = Math.min(
      config.paratrooperTroops(this.player),
      Math.floor(this.player.troops()),
    );
    if (this.troops < 1) {
      this.active = false;
      return;
    }
    const src = this.player.canBuild(UnitType.Paratrooper, this.dst);
    if (src === false) {
      console.warn(
        `${this.player} cannot drop on ${this.dst}: no silo in range or no ground to take`,
      );
      this.active = false;
      return;
    }
    this.plane = this.player.buildUnit(UnitType.Paratrooper, src, {
      troops: this.troops,
      targetTile: this.dst,
    });
    if (!this.plane.isActive()) {
      this.active = false;
      return;
    }
    // buildUnit took the troops with the plane (the transport's way).
    if (this.target.isPlayer()) {
      mg.displayIncomingUnit(
        this.plane.id(),
        // TODO TranslateText
        `Airborne assault incoming from ${this.player.displayName()} (${renderTroops(this.troops)})`,
        MessageType.NAVAL_INVASION_INBOUND,
        this.target.id(),
      );
    }
    mg.stats().boatSendTroops(this.player, this.target, this.troops);
  }

  tick(ticks: number): void {
    if (this.plane === null) {
      this.active = false;
      return;
    }
    if (!this.plane.isActive()) {
      // Shot out of the sky or its owner gone: the troops went with it.
      this.active = false;
      return;
    }
    const steps = this.mg.config().paratrooperStepsPerTick();
    for (let i = 0; i < steps; i++) {
      const result = this.pathFinder.next(this.plane.tile(), this.dst);
      if (result.status === PathStatus.COMPLETE) {
        this.land();
        return;
      } else if (result.status === PathStatus.NEXT) {
        this.plane.move(result.node);
      } else {
        // No air path at all is not possible on a rectangular map, but a
        // drop that cannot find one brings its troops home rather than
        // circling forever.
        this.player.addTroops(this.troops);
        this.plane.delete(false);
        this.active = false;
        return;
      }
    }
  }

  private land(): void {
    if (this.plane === null) return;
    const owner = this.mg.owner(this.dst);
    if (owner === this.player) {
      this.player.addTroops(this.troops);
    } else {
      this.player.conquer(this.dst);
      if (owner.isPlayer() && this.player.isFriendly(owner)) {
        this.player.addTroops(this.troops);
      } else {
        this.mg.addExecution(
          new AttackExecution(
            this.troops,
            this.player,
            owner.id(),
            this.dst,
            false,
          ),
        );
      }
    }
    this.mg.stats().boatArriveTroops(this.player, this.target, this.troops);
    this.plane.setReachedTarget();
    this.plane.delete(false);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
