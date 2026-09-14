import { Execution, Game, MessageType, Unit } from "../game/Game";
import { TileRef } from "../game/GameMap";

/**
 * Battle Royale (brief §6.7): a shrinking playable area.
 *
 * The zone is a circle on the map's centre. It starts wide enough to hold
 * the whole map, waits the grace after the spawn phase, and then shrinks
 * in equal steps of radius, one step every interval, to the final share of
 * the starting radius. Once the first shrink lands the zone is a standing
 * rule, not a one-off scorch: a sweep cycles the map a band of rows per
 * tick (so a 1M-tile map costs a fraction of a millisecond a tick, never
 * one tick's worth at once), and every land tile outside the radius is let
 * go of by its owner and irradiated — fallout, the state a nuke leaves,
 * which the win check already discounts. Fallout clears itself after
 * `falloutDurationTicks` and irradiated ground can be conquered, which is
 * why the sweep never stops: ground reclaimed outside the zone is lost
 * again within one pass. At the end of every pass every unit standing
 * outside is destroyed. Integer maths throughout: squared distances
 * against a squared radius, so the sim stays whole.
 */
export class BattleRoyaleExecution implements Execution {
  private mg: Game | null = null;
  private cx = 0;
  private cy = 0;
  private startRadius = 0;
  private finalRadius = 0;
  private step = 0;
  private nextShrinkTick: number | null = null;
  private sweepRow = 0;

  init(mg: Game): void {
    this.mg = mg;
    const w = mg.width();
    const h = mg.height();
    this.cx = Math.floor(w / 2);
    this.cy = Math.floor(h / 2);
    // From the centre to the farthest corner: the whole map is inside.
    this.startRadius = Math.ceil(
      Math.sqrt(this.cx * this.cx + this.cy * this.cy),
    );
    this.finalRadius = Math.max(
      1,
      Math.floor(
        (this.startRadius * mg.config().battleRoyaleFinalRadiusPercent()) / 100,
      ),
    );
  }

  /** The zone's current radius in tiles. */
  radius(): number {
    const steps = this.mg?.config().battleRoyaleSteps() ?? 1;
    const done = Math.min(this.step, steps);
    return (
      this.startRadius -
      Math.floor(((this.startRadius - this.finalRadius) * done) / steps)
    );
  }

  /** The shrinks applied so far. */
  shrinks(): number {
    return this.step;
  }

  inZone(tile: TileRef): boolean {
    if (this.mg === null) return true;
    const dx = this.mg.x(tile) - this.cx;
    const dy = this.mg.y(tile) - this.cy;
    const r = this.radius();
    return dx * dx + dy * dy <= r * r;
  }

  tick(ticks: number): void {
    const mg = this.mg;
    if (mg === null) return;
    if (mg.inSpawnPhase()) return;
    const config = mg.config();
    if (this.nextShrinkTick === null) {
      this.nextShrinkTick = ticks + config.battleRoyaleGraceTicks();
      return;
    }
    if (
      this.step < config.battleRoyaleSteps() &&
      ticks >= this.nextShrinkTick
    ) {
      this.step++;
      this.nextShrinkTick = ticks + config.battleRoyaleIntervalTicks();
      mg.displayMessage(
        "events_display.battle_royale_shrink",
        MessageType.BATTLE_ROYALE_SHRINK,
        null,
        undefined,
        { step: this.step, steps: config.battleRoyaleSteps() },
      );
    }
    if (this.step > 0) this.sweep(mg, config.battleRoyaleRowsPerTick());
  }

  /**
   * Clears the band of rows from `sweepRow`: outside the radius, owned land
   * is relinquished and clean land irradiated. Rows within the circle are
   * only walked outside the chord the circle cuts through them.
   */
  private sweep(mg: Game, rows: number): void {
    const r = this.radius();
    const rSq = r * r;
    const w = mg.width();
    const h = mg.height();
    const end = Math.min(h, this.sweepRow + rows);
    for (let y = this.sweepRow; y < end; y++) {
      const dy = y - this.cy;
      const dySq = dy * dy;
      if (dySq > rSq) {
        this.clearSpan(mg, y, 0, w);
        continue;
      }
      // The half-chord, exact in integers after the float estimate.
      let half = Math.floor(Math.sqrt(rSq - dySq));
      while ((half + 1) * (half + 1) + dySq <= rSq) half++;
      while (half > 0 && half * half + dySq > rSq) half--;
      this.clearSpan(mg, y, 0, Math.max(0, this.cx - half));
      this.clearSpan(mg, y, Math.min(w, this.cx + half + 1), w);
    }
    this.sweepRow = end;
    if (this.sweepRow >= h) {
      this.sweepRow = 0;
      const outside: Unit[] = [];
      for (const unit of mg.units()) {
        if (unit.isActive() && !this.inZone(unit.tile())) outside.push(unit);
      }
      for (const unit of outside) unit.delete(false);
    }
  }

  private clearSpan(mg: Game, y: number, x0: number, x1: number): void {
    for (let x = x0; x < x1; x++) {
      const tile = mg.ref(x, y);
      if (!mg.isLand(tile)) continue;
      const owner = mg.owner(tile);
      if (owner.isPlayer()) owner.relinquish(tile);
      if (!mg.hasFallout(tile)) mg.setFallout(tile, true);
    }
  }

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
