import { Attack, Execution, Game, Unit } from "../game/Game";

/**
 * Artillery (brief §6.4, session 12). A land structure that bombards the
 * attacks crossing its range: every `artilleryAttackRate()` ticks it finds
 * the nearest cluster of any attack on its owner within
 * `artilleryRange()` of the gun and takes `artilleryDamage()` troops off
 * that attack. A defense post makes an attack cost more per tile; artillery
 * makes a standing attack bleed where it stands, whether or not it is
 * advancing — so a front held under guns is a front the attacker has to
 * commit to crossing quickly, or not at all.
 *
 * Attacks are not units, which is why this is not a shell emitter: the
 * shell pattern (`ShellExecution`) homes on a `Unit`, and an attack has only
 * border tiles. The gun reads `clusteredPositions()` — one representative
 * tile per disconnected segment of the attack's border — and measures to
 * those. Bounded: the owner's incoming attacks, a few clusters each, once
 * per volley per gun.
 *
 * Deterministic: incoming attacks are iterated in their registration order
 * and ties go to the first, so every client picks the same target.
 */
export class ArtilleryExecution implements Execution {
  private mg: Game;
  private active = true;
  private lastVolley = -1;

  constructor(private gun: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.gun.isActive()) {
      this.active = false;
      return;
    }
    if (this.gun.isUnderConstruction()) return;
    const config = this.mg.config();
    if (
      this.lastVolley >= 0 &&
      ticks - this.lastVolley < config.artilleryAttackRate()
    ) {
      return;
    }
    const target = this.findTarget(config.artilleryRange());
    if (target === null) return;
    this.lastVolley = ticks;
    target.setTroops(Math.max(0, target.troops() - config.artilleryDamage()));
  }

  /** The attack on the owner with a border cluster nearest the gun, within range. */
  private findTarget(range: number): Attack | null {
    const rangeSquared = range * range;
    const here = this.gun.tile();
    let best: Attack | null = null;
    let bestDist = Infinity;
    for (const attack of this.gun.owner().incomingAttacks()) {
      if (!attack.isActive() || attack.retreated()) continue;
      for (const tile of attack.clusteredPositions()) {
        const d = this.mg.euclideanDistSquared(here, tile);
        if (d <= rangeSquared && d < bestDist) {
          bestDist = d;
          best = attack;
        }
      }
    }
    return best;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
