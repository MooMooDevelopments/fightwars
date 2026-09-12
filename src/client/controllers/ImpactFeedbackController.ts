import { Cell, UnitType } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { Controller } from "../Controller";
import type { MapRenderer } from "../render/gl";
import type { TransformHandler } from "../TransformHandler";
import { GameView, UnitView } from "../view";

/**
 * What a detonation does to the view: a jolt and a wash.
 *
 * Separate from SoundEffectController, which watches the same events, because
 * the two answer to different things — a player who has muted the game should
 * still feel a hydrogen bomb, and a player watching a distant one should not
 * be thrown around by it. Sound is on or off; this is a question of where the
 * camera is pointing.
 */

/** Peak shake in screen pixels, and peak flash opacity, per warhead. */
interface Impact {
  shakePx: number;
  flash: number;
}

/**
 * A hydrogen bomb should feel like a different weapon from an atom bomb, and a
 * single MIRV warhead like a fraction of either — dozens of them land in a few
 * seconds, and at full strength the view would be unusable for the whole
 * salvo, which is exactly when the player needs to read it.
 */
const IMPACTS: Partial<Record<UnitType, Impact>> = {
  [UnitType.HydrogenBomb]: { shakePx: 22, flash: 0.55 },
  [UnitType.AtomBomb]: { shakePx: 11, flash: 0.34 },
  [UnitType.MIRVWarhead]: { shakePx: 5, flash: 0.14 },
};

/**
 * Beyond this many screen widths from the centre of the view, a detonation is
 * something the player is watching rather than something happening to them,
 * and neither the camera nor the screen should react.
 */
const FALLOFF_SCREENS = 1.5;

/**
 * How much of an impact survives at `distancePx` from the centre of a screen
 * `screenPx` across. 1 at the centre, 0 past the falloff, smooth between —
 * a hard cutoff would pop as the player pans past a blast.
 */
export function distanceFalloff(distancePx: number, screenPx: number): number {
  if (screenPx <= 0) return 0;
  const reach = screenPx * FALLOFF_SCREENS;
  if (distancePx >= reach) return 0;
  if (distancePx <= 0) return 1;
  const t = 1 - distancePx / reach;
  return t * t;
}

export class ImpactFeedbackController implements Controller {
  constructor(
    private readonly game: GameView,
    private readonly transform: TransformHandler,
    private readonly renderer: MapRenderer,
  ) {}

  tick(): void {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;
    for (const u of updates[GameUpdateType.Unit] ?? []) {
      const unit = this.game.unit(u.id);
      if (unit === undefined) continue;
      const impact = IMPACTS[unit.type()];
      if (impact === undefined) continue;
      if (unit.isActive() || !unit.reachedTarget()) continue;
      this.apply(unit, impact);
    }
  }

  private apply(unit: UnitView, impact: Impact): void {
    const falloff = this.falloffFor(unit);
    if (falloff <= 0) return;
    this.transform.shake.add(impact.shakePx * falloff, performance.now());
    this.renderer.triggerFlash(impact.flash * falloff);
  }

  /** How much of a detonation reaches the player, by where they are looking. */
  private falloffFor(unit: UnitView): number {
    const rect = this.transform.boundingRect();
    const screenPx = Math.max(rect.width, rect.height);
    const tile = unit.lastTile();
    const at = this.transform.worldToCanvasCoordinates(
      new Cell(this.game.x(tile), this.game.y(tile)),
    );
    const dx = at.x - rect.width / 2;
    const dy = at.y - rect.height / 2;
    return distanceFalloff(Math.hypot(dx, dy), screenPx);
  }
}
