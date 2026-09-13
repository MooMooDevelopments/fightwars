import { GameEvent } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";

/** HUD elements (or, for "territory", the map ring) the tutorial can draw attention to. */
export type TutorialHighlight =
  | "territory"
  | "troops"
  | "troop_rate"
  | "attack_ratio"
  | "gold"
  | "city"
  | "port"
  | "defense_post"
  | "factory"
  | "warship"
  | "silo"
  | "atom"
  | "hydrogen"
  | "mirv"
  | "sam"
  | "tribes"
  | "nation";

/** Emitted whenever the highlighted HUD element changes (null clears it). */
export class TutorialHighlightEvent implements GameEvent {
  constructor(public readonly target: TutorialHighlight | null) {}
}

/** Snapshot of the player's state that the steps are evaluated against. */
export interface TutorialContext {
  hasSpawned: boolean;
  /** Multiplayer: the spawn timer is still running, so attacking is blocked. */
  inSpawnPhase: boolean;
  /** Any outgoing attack, wilderness or player. */
  attacking: boolean;
  /** The attack ratio changed this tick (slider drag or hotkey). */
  attackRatioMoved: boolean;
  boatsDisabled: boolean;
  /** A transport ship of ours is (or was seen) afloat. */
  boatSent: boolean;
  botsExist: boolean;
  nationsExist: boolean;
  alliancesDisabled: boolean;
  /** The player has at least one active alliance. */
  allied: boolean;
  gold: bigint;
  /** Null until the worker has reported it. */
  cityCost: bigint | null;
  cityDisabled: boolean;
  cities: number;
  portDisabled: boolean;
  ports: number;
  defensePostDisabled: boolean;
  defensePosts: number;
  factoryDisabled: boolean;
  factories: number;
  warshipDisabled: boolean;
  warships: number;
  siloDisabled: boolean;
  silos: number;
  atomDisabled: boolean;
  /** A completed missile silo that isn't reloading exists. */
  siloReady: boolean;
  /** An atom bomb of ours is (or was seen) in flight. */
  atomLaunched: boolean;
  hydrogenDisabled: boolean;
  mirvDisabled: boolean;
  samDisabled: boolean;
}

export interface TutorialStep {
  id: string;
  highlight?: TutorialHighlight;
  /**
   * Build steps: the unit this step asks for. While the player can't afford
   * it, the panel shows the generic earn-gold text instead of the step's own.
   */
  unit?: UnitType;
  /** Keybind action whose key is interpolated into the step text as {key}. */
  hotkey?:
    | "buildCity"
    | "buildPort"
    | "buildDefensePost"
    | "buildFactory"
    | "buildWarship"
    | "buildMissileSilo"
    | "buildAtomBomb";
  /**
   * Render these `tutorial.step.*` keys as a bullet list instead of the
   * step's own single text.
   */
  bullets?: string[];
  /** Steps that don't fit this game's config are skipped. Defaults to always. */
  applies?: (ctx: TutorialContext) => boolean;
  /** Informational steps complete when the player clicks "Got it". */
  manual?: true;
  isDone?: (ctx: TutorialContext) => boolean;
}

/**
 * The 90-second arc, and nothing else.
 *
 * This was 22 steps ending at MIRV and SAM — a manual, not an onboarding. The
 * brief asks for ninety seconds: spawn, expand, set your ratio, build
 * something, make an ally, and then out into a real game. Six steps, five of
 * which are the brief's beats and the last of which is the hand-off.
 *
 * Everything the removed steps taught — ports, factories, defence posts,
 * warships, silos, every warhead, how alliances and traitors work — is in the
 * help panel already (`help_modal.build_*_desc`, `info_alliance`), which is
 * reachable at any time and does not cost a first-time player ten minutes
 * before their first real match.
 *
 * One thing went with them and is worth knowing: the `capture_tribes` step put
 * a target crosshair on the nearest tribes. Its teaching survives — the
 * build step's own waiting text says how to earn gold — but the crosshair does
 * not, since `highlight` is fixed per step and the build step needs its own.
 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // Waits out the multiplayer spawn timer too: the next step asks the
  // player to expand, which is impossible until the game actually starts.
  { id: "spawn", isDone: (c) => c.hasSpawned && !c.inSpawnPhase },
  // Keeps the spawn ring on the player's territory so they can find it.
  // Any attack counts so a player who hits a bot first doesn't get stuck.
  {
    id: "attack_wilderness",
    highlight: "territory",
    isDone: (c) => c.attacking,
  },
  {
    id: "attack_ratio",
    highlight: "attack_ratio",
    isDone: (c) => c.attackRatioMoved,
  },
  // The first thing you build. While it is unaffordable the panel shows the
  // earn-gold text instead, which is where "attack neighbours, conquer them
  // for their gold" is taught.
  {
    id: "buy_city",
    highlight: "city",
    unit: UnitType.City,
    hotkey: "buildCity",
    applies: (c) => !c.cityDisabled,
    isDone: (c) => c.cities > 0,
  },
  // Marks the nearest nation with the target crosshair; done once the
  // nation accepts (nations may decline — Skip is the way past that).
  {
    id: "propose_alliance",
    highlight: "nation",
    applies: (c) => c.nationsExist && !c.alliancesDisabled,
    isDone: (c) => c.allied,
  },
  // The hand-off. Says where the rest of the game is documented and sends the
  // player to a real lobby, rather than ending on a checkmark.
  { id: "whats_next", manual: true },
];

/** Ticks a completed step stays on screen (with its checkmark) before advancing. */
export const STEP_DONE_LINGER_TICKS = 15;

/**
 * Cursor over the step list. Pure: feed it a context once per tick and read
 * back the current step. Steps whose `applies` is false for the current
 * context are skipped, so the visible count adapts to the game's config.
 */
export class TutorialProgress {
  private index = 0;
  /** Ticks since the current step completed, or null while it's pending. */
  private doneTicks: number | null = null;
  /**
   * Context snapshot used only for the step counter, taken on the first
   * update after the player has spawned (bots and nations all exist by
   * then). Bots/nations dying mid-game would otherwise shrink "Step n of N"
   * while the player is parked on an unrelated step; progression (skipping,
   * isDone) always uses the live context.
   */
  private countCtx: TutorialContext | null = null;

  constructor(
    private readonly steps: readonly TutorialStep[] = TUTORIAL_STEPS,
  ) {}

  current(): TutorialStep | null {
    return this.steps[this.index] ?? null;
  }

  finished(): boolean {
    return this.index >= this.steps.length;
  }

  stepDone(): boolean {
    return this.doneTicks !== null;
  }

  /** 1-based position of the current step among the steps that apply. */
  position(ctx: TutorialContext): number {
    return this.applicable(this.countCtx ?? ctx, this.index) + 1;
  }

  total(ctx: TutorialContext): number {
    return this.applicable(this.countCtx ?? ctx, this.steps.length);
  }

  /** Completes the current step if it's an informational ("Got it") one. */
  acknowledge(): void {
    const step = this.current();
    if (step?.manual && this.doneTicks === null) {
      this.doneTicks = 0;
    }
  }

  /** Moves past the current step without completing it. */
  skip(): void {
    if (this.finished()) return;
    this.index++;
    this.doneTicks = null;
  }

  update(ctx: TutorialContext): void {
    if (this.countCtx === null && ctx.hasSpawned) this.countCtx = ctx;
    if (this.doneTicks !== null) {
      this.doneTicks++;
      if (this.doneTicks < STEP_DONE_LINGER_TICKS) return;
      this.index++;
      this.doneTicks = null;
    }
    while (!this.finished() && !this.stepApplies(this.index, ctx)) {
      this.index++;
    }
    const step = this.current();
    if (step?.isDone?.(ctx)) {
      this.doneTicks = 0;
    }
  }

  private stepApplies(i: number, ctx: TutorialContext): boolean {
    return this.steps[i].applies?.(ctx) ?? true;
  }

  private applicable(ctx: TutorialContext, before: number): number {
    let n = 0;
    for (let i = 0; i < before; i++) {
      if (this.stepApplies(i, ctx)) n++;
    }
    return n;
  }
}
