import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { Controller } from "../Controller";
import { SetRallyPointEvent } from "../InputHandler";
import { MapRenderer } from "../render/gl";
import { TransformHandler } from "../TransformHandler";
import { MoveWarshipIntentEvent } from "../Transport";
import { showToast, translateText } from "../Utils";
import { GameView } from "../view";

/** The hulls a rally point sends: everything MoveWarshipExecution moves. */
const RALLY_HULLS: ReadonlySet<UnitType> = new Set([
  UnitType.Warship,
  UnitType.Submarine,
  UnitType.Carrier,
]);

/**
 * A rally point for warships (brief §7 item 9), client-side.
 *
 * The simulation never knows a rally point exists: this holds one water
 * tile for the local player, and the tick a new warship of theirs appears
 * it sends the ordinary move intent — the same one a click on the water
 * sends for a selected ship. Nothing new rides the wire, and a ship that
 * cannot reach the tile (a different water body) is refused by the same
 * rule that refuses a click.
 *
 * Set with a key over water; the same key over land clears it. The move
 * indicator marks the tile when it is set and again each time a ship is
 * sent, which is what the player sees when moving ships by hand. A
 * standing flag on the map is a hook point (a pass of its own).
 */
export class RallyPointController implements Controller {
  private rally: TileRef | null = null;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly transformHandler: TransformHandler,
    private readonly view: MapRenderer,
  ) {}

  init(): void {
    this.eventBus.on(SetRallyPointEvent, this.onSet);
  }

  rallyTile(): TileRef | null {
    return this.rally;
  }

  private onSet = (e: SetRallyPointEvent): void => {
    const cell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return;
    const ref = this.game.ref(cell.x, cell.y);
    if (!this.game.isWater(ref)) {
      if (this.rally !== null) {
        this.rally = null;
        showToast(translateText("rally.cleared"), "green");
      }
      return;
    }
    this.rally = ref;
    const me = this.game.myPlayer();
    if (me !== null) {
      this.view.showMoveIndicator(
        this.game.x(ref),
        this.game.y(ref),
        me.smallID(),
      );
    }
    showToast(translateText("rally.set"), "green");
  };

  tick(): void {
    if (this.rally === null) return;
    const me = this.game.myPlayer();
    if (me === null) return;
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;
    const ids: number[] = [];
    for (const u of updates[GameUpdateType.Unit] ?? []) {
      const unit = this.game.unit(u.id);
      if (unit === undefined || !unit.isActive()) continue;
      if (unit.createdAt() !== this.game.ticks()) continue;
      if (!RALLY_HULLS.has(unit.type()) || unit.owner() !== me) continue;
      ids.push(unit.id());
    }
    if (ids.length > 0) {
      this.eventBus.emit(new MoveWarshipIntentEvent(ids, this.rally));
    }
  }
}
