import {
  ColoredTeams,
  Execution,
  Game,
  MessageType,
  PlayerType,
} from "../game/Game";

/**
 * Survival (brief §6.7): co-op against nations that keep coming.
 *
 * The lobby puts every human on one side and every nation on the other
 * (Humans vs Nations); this execution is the escalation and the clock.
 * Every wave — a fixed interval after the spawn phase — each living nation
 * is handed a share of its own troop ceiling times the wave number, and a
 * purse times the wave number, so the pressure grows without end. The
 * humans win by being alive when the clock runs out; the nations win the
 * second the last human falls. Both go through the ordinary `setWinner`,
 * so the record and the post-match screen see a team win. The land win
 * keeps running beside it: nations that take four fifths of the map have
 * overrun the humans, and humans who take it have earned the early end.
 */
export class SurvivalExecution implements Execution {
  private mg: Game | null = null;
  private startTick: number | null = null;
  private wave = 0;
  private done = false;

  init(mg: Game): void {
    this.mg = mg;
  }

  waves(): number {
    return this.wave;
  }

  tick(ticks: number): void {
    const mg = this.mg;
    if (mg === null || this.done || ticks % 10 !== 0) return;
    if (mg.inSpawnPhase()) return;
    const config = mg.config();
    this.startTick ??= ticks;

    const humansAlive = mg
      .players()
      .some((p) => p.type() === PlayerType.Human && p.isAlive());
    if (!humansAlive) {
      this.done = true;
      mg.displayMessage(
        "events_display.survival_lost",
        MessageType.SURVIVAL_WAVE,
        null,
        undefined,
        { waves: this.wave },
      );
      mg.setWinner(ColoredTeams.Nations, mg.stats().stats());
      return;
    }
    if (mg.elapsedGameSeconds() >= config.survivalSeconds()) {
      this.done = true;
      mg.displayMessage(
        "events_display.survival_won",
        MessageType.SURVIVAL_WAVE,
        null,
        undefined,
        { waves: this.wave },
      );
      mg.setWinner(ColoredTeams.Humans, mg.stats().stats());
      return;
    }

    const since = ticks - this.startTick;
    if (since > 0 && since % config.survivalWaveTicks() === 0) {
      this.wave++;
      const share = config.survivalWaveTroopShare() * this.wave;
      const gold = config.survivalWaveGold() * BigInt(this.wave);
      for (const nation of mg.players()) {
        if (nation.type() !== PlayerType.Nation || !nation.isAlive()) continue;
        const max = config.maxTroops(nation);
        nation.setTroops(
          Math.min(max, nation.troops() + Math.floor(max * share)),
        );
        nation.addGold(gold);
      }
      mg.displayMessage(
        "events_display.survival_wave",
        MessageType.SURVIVAL_WAVE,
        null,
        undefined,
        { wave: this.wave },
      );
    }
  }

  isActive(): boolean {
    return !this.done;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
