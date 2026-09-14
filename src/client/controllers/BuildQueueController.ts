import { EventBus } from "../../core/EventBus";
import { PlayerBuildableUnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { Controller } from "../Controller";
import { CancelBuildQueueEvent, QueueBuildEvent } from "../InputHandler";
import { BuildUnitIntentEvent } from "../Transport";
import { UIState } from "../UIState";
import { showToast, translateText } from "../Utils";
import { GameView } from "../view";

/** Ticks between two asks of the worker whether the queued build is possible. */
export const BUILD_QUEUE_POLL_TICKS = 10;

interface Queued {
  unit: PlayerBuildableUnitType;
  tile: TileRef;
  labelKey: string;
  rocketDirectionUp?: boolean;
}

/**
 * A build queue of one (brief §7 item 9), client-side.
 *
 * The simulation never knows a queue exists: this holds the one build the
 * player asked for and could not afford, asks the worker once a second
 * whether it can be built now — the same question the build menu asks when
 * it opens — and the tick the answer is yes, sends the ordinary build
 * intent and forgets. Nothing new rides the wire, and the gold is spent by
 * the same rule that spends it for a click.
 *
 * One, not many: a second queued build would sit behind the first for
 * whatever the first costs, and a player who wants two things should say
 * which comes first by asking for it first.
 */
export class BuildQueueController implements Controller {
  private queued: Queued | null = null;
  private polling = false;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly uiState: UIState,
  ) {}

  init(): void {
    this.uiState.buildQueue = null;
    this.eventBus.on(QueueBuildEvent, this.onQueue);
    this.eventBus.on(CancelBuildQueueEvent, this.onCancel);
  }

  queuedBuild(): Queued | null {
    return this.queued;
  }

  private onQueue = (e: QueueBuildEvent): void => {
    // The same build asked for twice is the player changing their mind.
    if (
      this.queued !== null &&
      this.queued.unit === e.unit &&
      this.queued.tile === e.tile
    ) {
      this.clear();
      showToast(translateText("build_queue.cancelled"), "green");
      return;
    }
    this.queued = {
      unit: e.unit,
      tile: e.tile,
      labelKey: e.labelKey,
      rocketDirectionUp: e.rocketDirectionUp,
    };
    this.uiState.buildQueue = {
      unit: e.unit,
      tile: e.tile,
      labelKey: e.labelKey,
    };
    showToast(
      translateText("build_queue.queued", {
        unit: translateText(e.labelKey),
      }),
      "green",
    );
  };

  private onCancel = (): void => {
    if (this.queued === null) return;
    this.clear();
    showToast(translateText("build_queue.cancelled"), "green");
  };

  private clear(): void {
    this.queued = null;
    this.uiState.buildQueue = null;
  }

  tick(): void {
    const queued = this.queued;
    if (queued === null) return;
    const me = this.game.myPlayer();
    if (me === null || !me.isAlive()) {
      this.clear();
      return;
    }
    if (this.polling || this.game.ticks() % BUILD_QUEUE_POLL_TICKS !== 0) {
      return;
    }
    this.polling = true;
    me.buildables(queued.tile, [queued.unit])
      .then((buildables) => {
        // The answer is for the build that was queued when we asked; a
        // build queued since is asked about on the next poll.
        if (this.queued !== queued) return;
        const entry = buildables.find((b) => b.type === queued.unit);
        if (entry === undefined || entry.canBuild === false) return;
        this.eventBus.emit(
          new BuildUnitIntentEvent(
            queued.unit,
            entry.canBuild,
            queued.rocketDirectionUp,
          ),
        );
        this.clear();
        showToast(
          translateText("build_queue.built", {
            unit: translateText(queued.labelKey),
          }),
          "green",
        );
      })
      .finally(() => {
        this.polling = false;
      });
  }
}
