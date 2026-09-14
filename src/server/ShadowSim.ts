import { Game } from "../core/game/Game";
import { GameMapLoader } from "../core/game/GameMapLoader";
import {
  GameUpdateType,
  HashUpdate,
  WinUpdate,
} from "../core/game/GameUpdates";
import { createGameRunner, GameRunner } from "../core/GameRunner";
import { GameStartInfo, StampedIntent, Turn } from "../core/Schemas";

/** The logging surface the shadow needs; GameServer's logger satisfies it. */
export interface ShadowLog {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** What GameServer needs from a shadow, so a test can hand it a fake. */
export interface ShadowSimLike {
  start(): Promise<void>;
  applyTurn(turn: Turn): void;
  check(intent: StampedIntent): string | null;
  /** The hash the server's own sim produced for `turn`, or null if none. */
  hashAt(turn: number): number | null;
  /** The win the server's own sim declared, with its stats, or null. */
  winResult(): ShadowWin | null;
}

/** What the sim declares when a game ends: the same update the clients vote from. */
export interface ShadowWin {
  winner: WinUpdate["winner"];
  allPlayersStats: WinUpdate["allPlayersStats"];
}

/**
 * The server's own copy of the game (brief §8, HANDOFF §7 headline 1).
 *
 * The simulation runs on every client and the server only relays intents,
 * so until now the server checked schema, rate and four control intents,
 * and zero gameplay semantics: a hacked client could ask to move a ship it
 * does not own, or keep playing after it was dead. This runs the same
 * GameRunner the clients run, fed the same turns in the same order, and
 * refuses the intents its own state says are impossible.
 *
 * It is authoritative one turn behind: it has applied every turn the server
 * has committed, and an intent arriving now is judged against that state.
 * So it refuses only what cannot become possible within a turn — a player
 * the game does not have, a dead player, a unit that is not theirs, a unit
 * type the lobby disabled, an attack on themselves. Gold, territory and
 * alliances all move within a tick, and refusing on those would drop
 * honest intents; those stay the simulation's own business, where every
 * client applies the same rule to the same state.
 *
 * Until the map has loaded it judges nothing: an intent it cannot see is
 * let through, never refused, and the turns it missed are queued and
 * applied the moment it is ready.
 */
export class ShadowSim implements ShadowSimLike {
  private runner: GameRunner | null = null;
  private queued: Turn[] = [];
  private failed = false;
  // The state hashes the sim emits every ten ticks, by tick — the same
  // numbers the clients report, from the same code, so a client that
  // disagrees with these is out of sync with the server, whatever the
  // other clients say.
  private readonly hashes = new Map<number, number>();
  // The win the sim declared, if it has. The clients vote on exactly this
  // update; the server has it first-hand.
  private win: ShadowWin | null = null;

  constructor(
    private readonly gameStart: GameStartInfo,
    private readonly mapLoader: GameMapLoader,
    private readonly log: ShadowLog,
  ) {}

  async start(): Promise<void> {
    try {
      const runner = await createGameRunner(
        this.gameStart,
        undefined,
        this.mapLoader,
        (gu) => {
          if (!("updates" in gu)) return;
          for (const hu of gu.updates[GameUpdateType.Hash] ?? []) {
            this.hashes.set((hu as HashUpdate).tick, (hu as HashUpdate).hash);
          }
          for (const wu of gu.updates[GameUpdateType.Win] ?? []) {
            const { winner, allPlayersStats } = wu as WinUpdate;
            this.win ??= { winner, allPlayersStats };
          }
        },
      );
      this.runner = runner;
      for (const turn of this.queued) this.step(turn);
      this.queued = [];
      this.log.info("shadow sim ready", { queuedTurns: this.queued.length });
    } catch (error) {
      // A shadow that cannot run judges nothing; the game goes on as it
      // always has, and the log says why.
      this.failed = true;
      this.log.error("shadow sim failed to start", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  ready(): boolean {
    return this.runner !== null;
  }

  ticks(): number {
    return this.runner?.game.ticks() ?? 0;
  }

  /** The shadow's own game, for tests and diagnostics; null until ready. */
  game(): Game | null {
    return this.runner?.game ?? null;
  }

  hashAt(turn: number): number | null {
    return this.hashes.get(turn) ?? null;
  }

  winResult(): ShadowWin | null {
    return this.win;
  }

  applyTurn(turn: Turn): void {
    if (this.failed) return;
    if (this.runner === null) {
      this.queued.push(turn);
      return;
    }
    this.step(turn);
  }

  private step(turn: Turn): void {
    const runner = this.runner!;
    runner.addTurn(turn);
    if (!runner.executeNextTick()) {
      // A tick that throws is a bug in the sim; the clients will have hit it
      // too. Stop judging rather than judge from a state that stopped.
      this.failed = true;
      this.runner = null;
      this.log.error("shadow sim stopped: tick failed", {
        turn: turn.turnNumber,
      });
    }
  }

  /** null lets the intent through; a string is why it is refused. */
  check(intent: StampedIntent): string | null {
    if (this.runner === null) return null;
    const game = this.runner.game;
    switch (intent.type) {
      case "kick_player":
      case "update_game_config":
      case "toggle_game_start_timer":
      case "toggle_pause":
      case "mark_disconnected":
        // Control intents: authorizeIntent's business, not the sim's.
        return null;
    }
    const player = game.playerByClientID(intent.clientID);
    if (player === null) return "no player for this client";
    if (intent.type === "spawn") {
      return game.inSpawnPhase() ? null : "spawn phase is over";
    }
    if (!game.inSpawnPhase() && !player.isAlive()) return "player is dead";
    switch (intent.type) {
      case "build_unit":
        if (game.config().isUnitDisabled(intent.unit)) {
          return "unit type disabled in this lobby";
        }
        return null;
      case "attack":
        if (intent.targetID === player.id()) return "attacking self";
        if (intent.targetID !== null && !game.hasPlayer(intent.targetID)) {
          return "unknown target";
        }
        return null;
      case "move_warship":
        for (const id of intent.unitIds) {
          const unit = game.unit(id);
          if (unit === undefined) return "unknown unit";
          if (unit.owner() !== player) return "unit not owned";
        }
        return null;
      case "delete_unit":
      case "cancel_boat":
      case "upgrade_structure": {
        const id =
          intent.type === "cancel_boat" ? intent.unitID : intent.unitId;
        const unit = game.unit(id);
        if (unit === undefined) return "unknown unit";
        if (unit.owner() !== player) return "unit not owned";
        return null;
      }
      default:
        return null;
    }
  }
}
