import {
  ColoredTeams,
  Execution,
  Game,
  GameMode,
  MessageType,
  Player,
  Team,
} from "../game/Game";
import { TileRef } from "../game/GameMap";

/**
 * King of the Hill (brief §6.7): hold the middle, win the game.
 *
 * The hill is every land tile within a radius of the map's centre; when the
 * centre is water the hill is moved to the nearest land, ring by ring, so
 * every map has one. Once a second the owner holding the most hill tiles —
 * a player in free-for-all, a team in a team game — scores a point; a tie
 * or an empty hill scores nobody. The first to `hillSecondsToWin` points
 * wins through the same `setWinner` the land win uses, so the record, the
 * ratings and the post-match screen see an ordinary win. Every thirty
 * seconds the standing is posted to the feed: the leader and their score
 * against the target. Bots cannot win a team game, as with land.
 */
export class KingOfTheHillExecution implements Execution {
  private static readonly STANDING_EVERY_TICKS = 300;
  private mg: Game | null = null;
  private hill: TileRef[] = [];
  private cx = 0;
  private cy = 0;
  private radius = 0;
  private scores = new Map<Player | Team, number>();
  private done = false;

  init(mg: Game): void {
    this.mg = mg;
    const w = mg.width();
    const h = mg.height();
    this.radius = Math.max(
      1,
      Math.floor((Math.min(w, h) * mg.config().hillRadiusPercent()) / 100),
    );
    [this.cx, this.cy] = this.nearestLand(
      mg,
      Math.floor(w / 2),
      Math.floor(h / 2),
    );
    const rSq = this.radius * this.radius;
    for (
      let y = Math.max(0, this.cy - this.radius);
      y <= Math.min(h - 1, this.cy + this.radius);
      y++
    ) {
      for (
        let x = Math.max(0, this.cx - this.radius);
        x <= Math.min(w - 1, this.cx + this.radius);
        x++
      ) {
        const dx = x - this.cx;
        const dy = y - this.cy;
        if (dx * dx + dy * dy > rSq) continue;
        const tile = mg.ref(x, y);
        if (mg.isLand(tile)) this.hill.push(tile);
      }
    }
  }

  /** The centre itself if it is land, else the first land tile on the smallest square ring around it. */
  private nearestLand(mg: Game, cx: number, cy: number): [number, number] {
    const w = mg.width();
    const h = mg.height();
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
    const limit = Math.max(w, h);
    for (let r = 0; r <= limit; r++) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
          if (inside(x, y) && mg.isLand(mg.ref(x, y))) return [x, y];
        }
      }
    }
    return [cx, cy];
  }

  /** The hill's tiles. */
  tiles(): TileRef[] {
    return this.hill;
  }

  centre(): [number, number] {
    return [this.cx, this.cy];
  }

  hillRadius(): number {
    return this.radius;
  }

  score(who: Player | Team): number {
    return this.scores.get(who) ?? 0;
  }

  /** Who holds the most of the hill right now, or null for a tie or an empty hill. */
  holder(): Player | Team | null {
    const mg = this.mg;
    if (mg === null) return null;
    const teams = mg.config().gameConfig().gameMode === GameMode.Team;
    const counts = new Map<Player | Team, number>();
    for (const tile of this.hill) {
      const owner = mg.owner(tile);
      if (!owner.isPlayer()) continue;
      const player = owner as Player;
      const key: Player | Team | null = teams ? player.team() : player;
      if (key === null) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best: Player | Team | null = null;
    let bestCount = 0;
    let tied = false;
    for (const [who, count] of counts) {
      if (count > bestCount) {
        best = who;
        bestCount = count;
        tied = false;
      } else if (count === bestCount) {
        tied = true;
      }
    }
    return tied ? null : best;
  }

  tick(ticks: number): void {
    const mg = this.mg;
    if (mg === null || this.done || ticks % 10 !== 0) return;
    if (mg.inSpawnPhase()) return;
    const holder = this.holder();
    if (holder !== null) {
      const score = this.score(holder) + 1;
      this.scores.set(holder, score);
      if (
        score >= mg.config().hillSecondsToWin() &&
        holder !== ColoredTeams.Bot
      ) {
        this.done = true;
        mg.displayMessage(
          "events_display.hill_won",
          MessageType.HILL_STANDING,
          null,
          undefined,
          { name: this.nameOf(holder) },
        );
        mg.setWinner(holder, mg.stats().stats());
        return;
      }
    }
    if (ticks % KingOfTheHillExecution.STANDING_EVERY_TICKS === 0) {
      const target = mg.config().hillSecondsToWin();
      if (holder === null) {
        mg.displayMessage(
          "events_display.hill_unheld",
          MessageType.HILL_STANDING,
          null,
          undefined,
          { target },
        );
      } else {
        mg.displayMessage(
          "events_display.hill_standing",
          MessageType.HILL_STANDING,
          null,
          undefined,
          { name: this.nameOf(holder), score: this.score(holder), target },
        );
      }
    }
  }

  private nameOf(who: Player | Team): string {
    return typeof who === "string" ? who : who.displayName();
  }

  isActive(): boolean {
    return !this.done;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
