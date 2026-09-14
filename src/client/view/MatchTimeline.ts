/**
 * Post-match analytics (brief §6.7): what the client remembers of a game as
 * it goes, for the report at the end. Client-side only — sampled from the
 * view, never read by the simulation — so nothing here is deterministic
 * state and nothing here touches the hash.
 *
 * Every SAMPLE_EVERY ticks the tiles of every player alive are recorded;
 * an alliance that breaks is recorded the tick it breaks. A three-hour game
 * at two hundred players is a few hundred thousand numbers.
 */
export interface TimelineSample {
  tick: number;
  /** smallID → tiles owned. */
  tiles: Map<number, number>;
}

export interface AllianceBreak {
  tick: number;
  traitorID: number;
  betrayedID: number;
}

export interface TimelineSeries {
  smallID: number;
  /** One value per sample, 0 where the player held nothing. */
  points: number[];
}

export class MatchTimeline {
  static readonly SAMPLE_EVERY = 50;
  readonly samples: TimelineSample[] = [];
  readonly breaks: AllianceBreak[] = [];

  /** Record a sample if the tick is on the cadence. */
  sample(
    tick: number,
    players: Iterable<{ smallID: number; tiles: number; alive: boolean }>,
  ): void {
    if (tick % MatchTimeline.SAMPLE_EVERY !== 0) return;
    const tiles = new Map<number, number>();
    for (const p of players) {
      if (p.alive && p.tiles > 0) tiles.set(p.smallID, p.tiles);
    }
    this.samples.push({ tick, tiles });
  }

  noteBreak(tick: number, traitorID: number, betrayedID: number): void {
    this.breaks.push({ tick, traitorID, betrayedID });
  }

  /** The series for these players over every sample taken. */
  series(smallIDs: readonly number[]): TimelineSeries[] {
    return smallIDs.map((smallID) => ({
      smallID,
      points: this.samples.map((s) => s.tiles.get(smallID) ?? 0),
    }));
  }

  /** The players who held the most land at the last sample, largest first. */
  leaders(limit: number): number[] {
    const last = this.samples[this.samples.length - 1];
    if (last === undefined) return [];
    return [...last.tiles.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, limit)
      .map(([id]) => id);
  }
}
