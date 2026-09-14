import { Execution, Game, Unit, UnitType } from "../game/Game";

/**
 * Radar (brief §6.4, session 12). A land structure that extends the reach
 * of its owner's SAM launchers: every SAM within `Config.radarRange()` of an
 * active radar intercepts `Config.radarSamRangeBonus()` tiles further, capped
 * at `Config.maxSamRange()` so the interception sweep's constants hold.
 *
 * The bonus itself is read by `Config.dynamicSamRange` through
 * `Unit.samRangeBonus()` — the one read point every SAM range check goes
 * through (the launcher, the three nation call sites, the client through
 * `UnitUpdate.samRangeBonus`). This execution only keeps the wire honest: a
 * SAM's update is re-sent when a radar that covers it goes up or comes down,
 * because nothing about the SAM itself changed.
 */
export class RadarExecution implements Execution {
  private mg: Game;
  private active = true;
  private announced = false;

  constructor(private radar: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.radar.isActive()) {
      this.active = false;
      this.touchCoveredSams();
      return;
    }
    if (this.radar.isUnderConstruction()) return;
    if (!this.announced) {
      this.announced = true;
      this.touchCoveredSams();
    }
  }

  /** Re-send every SAM of the owner's this radar reaches, so the client redraws its ring. */
  private touchCoveredSams(): void {
    const owner = this.radar.owner();
    const range = this.mg.config().radarRange();
    for (const { unit } of this.mg.nearbyUnits(
      this.radar.tile(),
      range,
      UnitType.SAMLauncher,
    )) {
      if (unit.owner() === owner && unit.isActive()) unit.touch();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
