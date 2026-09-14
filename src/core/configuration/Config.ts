import { z } from "zod";
import { PlayerView } from "../../client/view";
import { AssetManifest } from "../AssetUrls";
import { ClusterConfig } from "../ClusterConfig";
import { exp, log, pow, pow2 } from "../DetMath";
import { DoomsdayClockSpeed } from "../game/DoomsdayClock";
import {
  AllianceTier,
  Difficulty,
  Doctrine,
  Game,
  GameType,
  Gold,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  TerraNullius,
  Tick,
  Unit,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { UserSettings } from "../game/UserSettings";
import { GameConfig, TeamCountConfig } from "../Schemas";
import { NukeType } from "../StatsSchemas";
import { assertNever, sigmoid, toInt, within } from "../Util";

declare global {
  interface Window {
    // Values the page carries into the bundle. Every field is optional to
    // TypeScript because the page is data, not code; ClientEnv.get() decides
    // which are actually required. Only gitCommit, gameEnv, turnstileSiteKey
    // and jwtAudience are: they describe the ENVIRONMENT, and are identical
    // for every player on a site. Everything below them names a SERVER, and
    // a static page (docs/MultiServer.md, "Server list v2") carries none of
    // it — the API's list answers instead.
    BOOTSTRAP_CONFIG?: {
      gitCommit?: string;
      assetManifest?: AssetManifest;
      cdnBase?: string;
      gameEnv?: string;
      // The fleet map + which entry served this page (docs/MultiServer.md).
      // Absent on a static page.
      cluster?: ClusterConfig;
      instanceLetter?: string;
      // Legacy scalar, still injected by desktop shells that predate the
      // cluster map. Web shells send cluster/instanceLetter instead; a static
      // page sends neither.
      numWorkers?: number;
      turnstileSiteKey?: string;
      jwtAudience?: string;
      // The rendering server's own id. Absent on a static page, which no
      // server rendered; ClientEnv.instanceId() then answers "".
      instanceId?: string;
      // Desktop-only: explicit game-server host for the WebSocket origin.
      // Absent on the web build (client falls back to same-origin location).
      serverHost?: string;
      // The load-balancer apex this deployment sits behind; absent for
      // standalone deployments (beta, branch previews, dev), desktop, and
      // static pages.
      siteHost?: string;
    };
  }
}

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export function parseGameEnv(value: string | undefined): GameEnv {
  switch (value) {
    case "dev":
      return GameEnv.Dev;
    case "staging":
      return GameEnv.Preprod;
    case "prod":
      return GameEnv.Prod;
    default:
      throw new Error(`unsupported game env: ${value}`);
  }
}

/** Scales a gold amount, flooring, and leaves it untouched at scale 1. */
function scaleGold(gold: bigint, scale: number): bigint {
  return scale === 1 ? gold : BigInt(Math.floor(Number(gold) * scale));
}

export interface AttackLogicInput {
  terrain: TerrainType;
  attackTroops: number;
  attacker: { type: PlayerType; numTiles: number; doctrine?: Doctrine };
  /** null when attacking terra nullius. */
  defender: {
    type: PlayerType;
    numTiles: number;
    troops: number;
    isTraitor: boolean;
    /** Defender is disconnected and on the attacker's team. */
    isDisconnectedTeammate: boolean;
    doctrine?: Doctrine;
  } | null;
  /** A defense post owned by the defender is in range of the tile. */
  defenderHasDefensePost: boolean;
  /**
   * Tiles walked through the attacker's own territory from its nearest
   * supply source (spawn tile, City, Port or Factory) to this tile. Values
   * at or past `supplyMaxRange()` — including the 255 a tile out of the
   * field carries — all mean "fully over-extended".
   */
  supplyDistance: number;
  /**
   * Elevation of the tile being taken, 0-30 as stored in the map. The band
   * in `terrain` is this collapsed to three steps; this is the texture
   * inside the band.
   */
  elevation: number;
  /**
   * Elevation of the tile minus that of the highest tile the attacker holds
   * beside it: positive attacking uphill, negative pouring downhill. Zero on
   * flat ground and whenever the attacker holds no neighbour.
   */
  climb: number;
  /** Fraction of land tiles with fallout, or null if the tile has no fallout. */
  falloutRatio: number | null;
  /** Tiles on the attack front this tick (plus jitter); fixed for the tick. */
  borderSize: number;
}

/**
 * Every named quantity that goes into an attack's cost, filled in by
 * `attackLogic` when a caller asks for it.
 *
 * This exists so the client can *explain* a cost rather than restate it. The
 * explanation is written by the same code that computes the result — an
 * optional out-parameter rather than a second implementation — because a
 * tooltip that quietly disagrees with the simulation is worse than no tooltip.
 * `tests/AttackBreakdown.test.ts` recomposes the outputs from these fields and
 * fails if the two ever part company.
 *
 * Every `…Mod` field is a multiplier: 1 means "does not apply".
 */
export interface AttackExplanation {
  /** Terrain's base loss magnitude and base tile cost, before modifiers. */
  terrainMag: number;
  terrainTileCost: number;
  /** Defender's defense post in range: raises losses, slows the advance. */
  defensePostLossMod: number;
  defensePostSpeedMod: number;
  /** Fallout on the tile: same modifier applied to both. */
  falloutMod: number;
  /** How far the tile is from the attacker's supply, and what that costs. */
  supplyDistance: number;
  supplyMod: number;
  /** Expansionist terra-nullius discount (brief §6.6); 1 otherwise. */
  terraNulliusMod: number;
  /** The tile's height above the band's base, and what the climb to it costs. */
  elevation: number;
  heightMod: number;
  climb: number;
  climbMod: number;
  /** High ground: how much less the defender loses holding it. */
  highGroundMod: number;
  /** Attacking a tribe costs the attacker less. */
  botDefenderMod: number;
  /** 0 when the defender is a disconnected teammate: nobody loses troops. */
  disconnectedTeammateMod: number;
  /** A traitor defends worse and falls faster. */
  traitorLossMod: number;
  traitorSpeedMod: number;
  /** Big territories are cheaper to attack from and into. */
  largeAttackerMod: number;
  largeDefenderMod: number;
  largeAttackerSpeedMod: number;
  /** Defender army ÷ attacking stack. Below 1 means you outnumber them. */
  troopRatio: number;
  /** `troopRatio` after the clamp each half of the formula applies. */
  clampedLossRatio: number;
  /** Defender troops per tile — their land's packing density. */
  defenderDensity: number;
  /** Tick-fractions one tile costs before terrain and territory scaling. */
  speedCost: number;
  /** Tiles on the attack front this tick; the cost is shared across them. */
  borderSize: number;
}

export interface AttackLogicResult {
  attackerTroopLoss: number;
  defenderTroopLoss: number;
  /**
   * Share of this tick's conquest budget the tile consumes. An attack keeps
   * conquering tiles until the fractions sum to 1, so a tile costing 0.1
   * means about ten such tiles per tick.
   */
  tickFraction: number;
}

export interface NukeMagnitude {
  inner: number;
  outer: number;
}

// attackLogic tunables
const LARGE_TERRITORY_MIDPOINT = 300_000;
const LARGE_TERRITORY_STEEPNESS = 2.5;
// Floors: a huge attacker's bonus bottoms at 0.3x (losses; speed uses the
// deeper LARGE_ATTACKER_SPEED_DEPTH below), a huge defender's at 0.7x.
const LARGE_ATTACKER_DEPTH = 0.7;
const LARGE_DEFENDER_DEPTH = 0.3;
const BOT_DEFENDER_LOSS_MULT = 0.7;
export const TERRA_NULLIUS_COST_SCALE = 2000;
export const TERRA_NULLIUS_MIN_COST = 5;
export const TERRA_NULLIUS_MAX_COST = 100;
// Attacker loss = mag * clampedRatio * (BASE * largeAttackerBonus + DENSITY * troopsPerTile).
// BASE is the old 0.48 ratio weight times the 0.965 large-defender sigmoid
// tail that every defender used to get. DENSITY sets which stack size pays
// the old 0.0052 density weight: at 0.0039 a stack of 3/4 the defender's
// army matches the old cost, bigger stacks pay less, smaller pay more.
export const ATTACKER_LOSS_BASE = 0.463;
export const ATTACKER_LOSS_PER_DENSITY = 0.0039;
// Speed divisor: 7.5 / 0.965, absorbing the same sigmoid tail.
export const SPEED_COST_DIVISOR = 7.77;
// Speed-only: the attacker's territory bonus runs a touch deeper for speed
// than the 0.7 loss depth above (floor 0.27x vs 0.3x). Paired with the 0.82
// sub-parity floor on the ratio curve, an overwhelming push lands ~18%
// faster for a small attacker, ~20% at the 300k midpoint, ~25% for giants.
const LARGE_ATTACKER_SPEED_DEPTH = 0.73;

/**
 * Logistic in log(tiles): ~1 for small territories, easing down to
 * 1 - depth for huge ones, halfway at LARGE_TERRITORY_MIDPOINT.
 */
function largeTerritoryBonus(numTiles: number, depth: number): number {
  return (
    1 -
    depth *
      sigmoid(
        log(numTiles),
        LARGE_TERRITORY_STEEPNESS,
        log(LARGE_TERRITORY_MIDPOINT),
      )
  );
}

/**
 * What a tile of each terrain band costs to take (brief §6.2). This is the
 * balance surface for terrain; nothing else in the simulation knows a number
 * about plains, highland or mountain.
 *
 *  - `mag`: how bloody the tile is (drives attacker troop loss)
 *  - `tileCost`: how expensive the tile is to take (higher = slower)
 *  - `priority`: how much an attack prefers to take it *later* than the
 *    flatter ground beside it (the conquest heap's terrain weight)
 *
 * A lobby scales `mag` and `tileCost` per band through `GameConfig.terrain`;
 * see {@link Config.terrainAttackBase}.
 */
export const TERRAIN_COST: Readonly<
  Record<
    TerrainType.Plains | TerrainType.Highland | TerrainType.Mountain,
    { mag: number; tileCost: number; priority: number }
  >
> = {
  [TerrainType.Plains]: { mag: 80, tileCost: 16.5, priority: 1 },
  [TerrainType.Highland]: { mag: 100, tileCost: 20, priority: 1.5 },
  [TerrainType.Mountain]: { mag: 120, tileCost: 25, priority: 2 },
};

function terrainBand(
  terrain: TerrainType,
): TerrainType.Plains | TerrainType.Highland | TerrainType.Mountain {
  switch (terrain) {
    case TerrainType.Plains:
    case TerrainType.Highland:
    case TerrainType.Mountain:
      return terrain;
    case TerrainType.Impassable:
      throw new Error(`impassable terrain cannot be attacked`);
    default:
      throw new Error(`terrain type ${terrain} not supported`);
  }
}

function terrainBandKey(
  band: TerrainType.Plains | TerrainType.Highland | TerrainType.Mountain,
): "plains" | "highland" | "mountain" {
  return band === TerrainType.Plains
    ? "plains"
    : band === TerrainType.Highland
      ? "highland"
      : "mountain";
}
const DEFAULT_SPAWN_IMMUNITY_TICKS = 5 * 10;

export const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});

/** SAM launcher construction duration in ticks (non-instant-build). */
export const SAM_CONSTRUCTION_TICKS = 30 * 10;

// Doomsday Clock tunables (anti-stall). Off unless enabled in GameConfig.
// Times in seconds. The required map share rises in waves (levels + times in
// DoomsdayClock.ts, chosen by `speed`). A side caught below the bar gets a
// warnSeconds cooldown ("Danger, decay in Xs"), then troops bleed DOWN TO A
// FLOOR (drainFloorPercent of max), not to zero: the warn (30s) + the linear
// drain (~90s from full troops, sooner with fewer troops or a shrinking
// territory) make ~2 minutes from caught to the floor. A doomed side is crippled
// to 5% of max, not eliminated, so a brief dip below the bar is recoverable (the
// drain stops the moment it climbs back); the rising bar still guarantees a
// finish by squeezing territory and leaving the doomed side easy to conquer.
const DOOMSDAY_CLOCK_DEFAULTS = {
  enabled: false,
  speed: "normal" as DoomsdayClockSpeed,
  warnSeconds: 30, // cooldown (the flashing danger cue) before decay begins
  drainStartPercent: 2, // starts bleeding at once (already beats troop income)
  drainMaxPercent: 5,
  drainRampSeconds: 90, // ramps LINEARLY to the max over this long
  drainFloorPercent: 5, // drain settles here: crippled to 5% of max, never wiped
  // The floor decays start -> drainFloorPercent over floorDecaySeconds, leaving
  // one comeback window with a usable army. It must not be permanent: maxTroops is
  // sublinear (~100k at one tile), so a fixed 40% is ~40k troops on a single tile.
  floorStartPercent: 40,
  floorDecaySeconds: 90,
  // TERRITORY ROT — the finisher, since the drain never kills. rotDeathSeconds is
  // a DEADLINE, not a rate: the territory is gone this long after the skull
  // appeared, whatever it holds. 0 disables rot. Timeline:
  //
  //   0s    skull blinks, warn countdown
  //   30s   skull steady, troops draining              (warnSeconds)
  //   120s  floor at 5%, territory rotting, skull RED  (warn + floorDecay)
  //   150s  nothing left, eliminated                   (rotDeathSeconds)
  rotDeathSeconds: 150,
  // Grainy opening: pinholes across this share of the territory before the holes
  // grow together. Held to a third of the rot window, so shortening the window
  // shortens this too: at 20s the speckle WAS the death rather than its opening.
  rotGrainSeconds: 10,
  rotSpecklePercent: 15,
  // Warships bleed on their OWN gentler start + a STEEP (convex) ramp to a much
  // higher ceiling. A ship caught when its side is first doomed lasts about as
  // long as troops (the low start + no income ≈ the troop net rate), but the rate
  // curves up sharply (warshipDrainCurveExponent), so once a side has been under
  // the clock the full ramp, ships drop to the same floor in ~2s (50%/s), not
  // sunk. Ships only.
  warshipDrainStartPercent: 1,
  warshipDrainMaxPercent: 50,
  warshipDrainCurveExponent: 8, // >1 = convex: stays gentle early, then spikes
  // NUCLEAR WINTER (FightWars, brief §6.4): game seconds the clock is advanced
  // per unit of world fallout ratio, so a world a tenth irradiated runs its
  // clock a minute ahead. One input to the one clock; there is no second one.
  nuclearWinterSecondsPerFalloutShare: 600,
};

// Share of the land a side must hold to win, in every game mode.
const PERCENT_TILES_OWNED_TO_WIN = 80;

// Overtime tunables (anti-stalemate). Off unless enabled in GameConfig.
// After startMinutes the percentage of tiles required to win falls from the
// base by dropPercentPerMinute, with no floor: the bar keeps sinking until the
// leading side crosses it, so a stalled game always ends. Only `enabled` and
// `startMinutes` are wire-configurable.
const OVERTIME_DEFAULTS = {
  enabled: false,
  startMinutes: 30,
  dropPercentPerMinute: 2,
};

export class Config {
  private unitInfoCache = new Map<UnitType, UnitInfo>();
  constructor(
    private _gameConfig: GameConfig,
    private _userSettings: UserSettings | null,
    private _isReplay: boolean,
    public readonly listed: boolean = false,
    private _spectator: boolean = false,
  ) {}

  isReplay(): boolean {
    return this._isReplay;
  }

  /** True when the player joined the lobby as a spectator (watch-only). */
  isIntentionalSpectator(): boolean {
    return this._spectator;
  }

  /**
   * Tiered relations (brief §6.5). Off, every request is a full alliance and
   * every break costs the same, which is the game as it was — the balance
   * lever `--flat-alliances` uses this.
   */
  allianceTiersEnabled(): boolean {
    return true;
  }

  /**
   * Whether a Hard/Impossible nation's "too many alliances" reckoning counts
   * non-aggression pacts. Off (the session-12 retune): a pact is peace and
   * nothing more, so only partners who would defend each other — `allies()`,
   * defensive pact and up — count against the cap; on, every rung counts and
   * the cheap pacts nations hand out block the defensive pacts the cap exists
   * to ration. The balance lever `--pacts-count` uses this.
   */
  allianceCapCountsPacts(): boolean {
    return false;
  }

  /**
   * How much longer the traitor mark lasts for breaking a deeper bond: a
   * pact is half the usual window, a defensive pact the usual, a full
   * alliance half again as long. Breaking a promise costs in proportion to
   * the promise.
   */
  allianceBreakTraitorScale(tier: AllianceTier): number {
    if (!this.allianceTiersEnabled()) return 1;
    switch (tier) {
      case AllianceTier.NonAggression:
        return 0.5;
      case AllianceTier.DefensivePact:
        return 1;
      case AllianceTier.FullAlliance:
        return 1.5;
      default:
        return 1;
    }
  }

  /**
   * Auto-coalitions (brief §6.5): once any side holds this share of the
   * land, everyone else is offered a coalition — nations accept pacts and
   * defensive pacts from any non-leader without their usual reluctance and
   * seek them out, and humans get a one-click offer. The leader knowing it
   * is coming is the late game. 1.01 never triggers (the lever).
   */
  coalitionThreshold(): number {
    return 0.4;
  }

  /**
   * Doctrines (brief §6.6): a passive and an unlock each, picked at spawn.
   * Off, nobody has one and nations do not roll — the game as it was; the
   * balance lever `--no-doctrines` uses this.
   */
  doctrinesEnabled(): boolean {
    return true;
  }

  /**
   * Gold-cost scale of a unit type under a doctrine. Each doctrine has one
   * structure it builds for three quarters: the Mercantile port, the
   * Fortress post, the Naval warship, the Nuclear silo, the Industrial
   * factory.
   */
  doctrineUnitCostScale(doctrine: Doctrine, type: UnitType): number {
    if (!this.doctrinesEnabled()) return 1;
    switch (doctrine) {
      case Doctrine.Mercantile:
        return type === UnitType.Port ? 0.75 : 1;
      case Doctrine.Fortress:
        return type === UnitType.DefensePost ? 0.75 : 1;
      case Doctrine.Naval:
        return type === UnitType.Warship ? 0.75 : 1;
      case Doctrine.Nuclear:
        return type === UnitType.MissileSilo ? 0.75 : 1;
      case Doctrine.Industrial:
        return type === UnitType.Factory ? 0.75 : 1;
      default:
        return 1;
    }
  }

  /**
   * How much more of its doctrine's own thing a *nation* builds (brief §6.6,
   * session-12 retune). A doctrine only changed prices, so a Mercantile
   * nation built no more ports than any other and Expansionist and
   * Mercantile nations died more: a doctrine has to change what a nation
   * decides, not just what it pays. Half again as many of the structure it
   * builds cheap — port, factory, silo — half again the posts under attack
   * for a Fortress state, a second standing warship for a Naval one, and an
   * Expansionist nation expands into empty land with three quarters of the
   * reserve. Humans are untouched: they play their doctrine themselves.
   * The balance lever `--no-doctrine-play` uses this.
   */
  doctrineNationBuildScale(doctrine: Doctrine, type: UnitType): number {
    if (!this.doctrinesEnabled()) return 1;
    switch (doctrine) {
      case Doctrine.Mercantile:
        return type === UnitType.Port ? 1.5 : 1;
      case Doctrine.Fortress:
        return type === UnitType.DefensePost ? 1.5 : 1;
      case Doctrine.Naval:
        return type === UnitType.Warship ? 2 : 1;
      case Doctrine.Nuclear:
        return type === UnitType.MissileSilo ? 1.5 : 1;
      case Doctrine.Industrial:
        return type === UnitType.Factory ? 1.5 : 1;
      default:
        return 1;
    }
  }

  /** Expansionist nations keep three quarters of the usual reserve before expanding. */
  doctrineNationExpandReserveScale(doctrine: Doctrine): number {
    if (!this.doctrinesEnabled()) return 1;
    return doctrine === Doctrine.Expansionist ? 0.75 : 1;
  }

  /** Materials scale: a Nuclear state arms a warhead for half. */
  doctrineMaterialsScale(doctrine: Doctrine, type: UnitType): number {
    if (!this.doctrinesEnabled()) return 1;
    if (doctrine !== Doctrine.Nuclear) return 1;
    return type === UnitType.AtomBomb ||
      type === UnitType.HydrogenBomb ||
      type === UnitType.MIRV
      ? 0.5
      : 1;
  }

  /** Mercantile: every trade pays 15 % more. */
  doctrineTradeGoldScale(doctrine: Doctrine): number {
    if (!this.doctrinesEnabled()) return 1;
    return doctrine === Doctrine.Mercantile ? 1.15 : 1;
  }

  /** Partisan: the people take up arms 10 % faster. */
  doctrineTroopRegenScale(doctrine: Doctrine): number {
    if (!this.doctrinesEnabled()) return 1;
    return doctrine === Doctrine.Partisan ? 1.1 : 1;
  }

  /** Expansionist: empty land is taken for three quarters of the price. */
  doctrineTerraNulliusCostScale(doctrine: Doctrine): number {
    if (!this.doctrinesEnabled()) return 1;
    return doctrine === Doctrine.Expansionist ? 0.75 : 1;
  }

  /** Expansionist: over-extension starts this many tiles further out. */
  doctrineSupplyReach(doctrine: Doctrine): number {
    if (!this.doctrinesEnabled()) return 0;
    return doctrine === Doctrine.Expansionist ? 15 : 0;
  }

  /** Fortress: a defense post defends 30 % harder. */
  doctrineDefensePostBonusScale(doctrine: Doctrine): number {
    if (!this.doctrinesEnabled()) return 1;
    return doctrine === Doctrine.Fortress ? 1.3 : 1;
  }

  /** Naval: a warship blockades half again as far. */
  doctrineBlockadeRangeScale(doctrine: Doctrine): number {
    if (!this.doctrinesEnabled()) return 1;
    return doctrine === Doctrine.Naval ? 1.5 : 1;
  }

  /** Diplomatic: an alliance either party holds lasts half again as long. */
  doctrineAllianceDurationScale(doctrine: Doctrine): number {
    if (!this.doctrinesEnabled()) return 1;
    return doctrine === Doctrine.Diplomatic ? 1.5 : 1;
  }

  /** Diplomatic: the traitor mark for breaking a bond lasts half as long. */
  doctrineTraitorScale(doctrine: Doctrine): number {
    if (!this.doctrinesEnabled()) return 1;
    return doctrine === Doctrine.Diplomatic ? 0.5 : 1;
  }

  /** Industrial: a factory turns out half again as much. */
  doctrineFactoryOutputScale(doctrine: Doctrine): number {
    if (!this.doctrinesEnabled()) return 1;
    return doctrine === Doctrine.Industrial ? 1.5 : 1;
  }

  traitorDefenseDebuff(): number {
    return 0.5;
  }
  traitorSpeedDebuff(): number {
    return 0.8;
  }
  traitorDuration(): number {
    return 30 * 10; // 30 seconds
  }

  teamLandShareWinThresholdTenths(): number {
    return 7;
  }

  // Doomsday Clock config, resolved against defaults. One read per tick.
  doomsdayClockConfig(): typeof DOOMSDAY_CLOCK_DEFAULTS {
    const c = this._gameConfig.doomsdayClock;
    const d = DOOMSDAY_CLOCK_DEFAULTS;
    return {
      enabled: c?.enabled ?? d.enabled,
      speed: c?.speed ?? d.speed,
      // Drain/warn tuning is internal (not wire-configurable): always defaults.
      warnSeconds: d.warnSeconds,
      drainStartPercent: d.drainStartPercent,
      drainMaxPercent: d.drainMaxPercent,
      drainRampSeconds: d.drainRampSeconds,
      drainFloorPercent: d.drainFloorPercent,
      floorStartPercent: d.floorStartPercent,
      floorDecaySeconds: d.floorDecaySeconds,
      rotDeathSeconds: d.rotDeathSeconds,
      rotGrainSeconds: d.rotGrainSeconds,
      rotSpecklePercent: d.rotSpecklePercent,
      warshipDrainStartPercent: d.warshipDrainStartPercent,
      warshipDrainMaxPercent: d.warshipDrainMaxPercent,
      warshipDrainCurveExponent: d.warshipDrainCurveExponent,
      nuclearWinterSecondsPerFalloutShare: this.falloutHasConsequences()
        ? d.nuclearWinterSecondsPerFalloutShare
        : 0,
    };
  }
  // Overtime config, resolved against defaults.
  overtimeConfig(): typeof OVERTIME_DEFAULTS {
    const c = this._gameConfig.overtime;
    const d = OVERTIME_DEFAULTS;
    return {
      enabled: c?.enabled ?? d.enabled,
      startMinutes: c?.startMinutes ?? d.startMinutes,
      // The drop rate is internal (not wire-configurable): always the default.
      dropPercentPerMinute: d.dropPercentPerMinute,
    };
  }
  spawnImmunityDuration(): Tick {
    return (
      this._gameConfig.spawnImmunityDuration ?? DEFAULT_SPAWN_IMMUNITY_TICKS
    );
  }
  nationSpawnImmunityDuration(): Tick {
    return DEFAULT_SPAWN_IMMUNITY_TICKS;
  }
  hasExtendedSpawnImmunity(): boolean {
    return this.spawnImmunityDuration() > DEFAULT_SPAWN_IMMUNITY_TICKS;
  }

  gameConfig(): GameConfig {
    return this._gameConfig;
  }

  userSettings(): UserSettings {
    if (this._userSettings === null) {
      throw new Error("userSettings is null");
    }
    return this._userSettings;
  }

  cityTroopIncrease(): number {
    return 250_000;
  }

  /**
   * Nuke consequences (brief §6.4). Fallout used to be permanent until
   * someone walked onto it, and then gone. Now it is a mark with a clock:
   * it outlasts conquest, expires on its own after `falloutDurationTicks`,
   * makes the owned land under it count for nothing, and past a threshold
   * of the world burning drags everyone's recruiting down — which is how
   * MAD arrives without a rule that says so.
   *
   * Crossing irradiated ground: the multiplier on attacker loss and tile
   * cost. It used to fall as more of the world burned (5 → 3), which
   * rewarded escalation; it now rises (3 → 5). Both ends of the old range,
   * the other way up.
   */
  falloutDefenseModifier(falloutRatio: number): number {
    if (!this.falloutHasConsequences()) return 5 - falloutRatio * 2;
    return 3 + falloutRatio * 2;
  }

  /** Master switch for the §6.4 consequences; the balance lever flips it. */
  falloutHasConsequences(): boolean {
    return true;
  }

  /** Ticks an irradiated tile stays irradiated: three minutes. */
  falloutDurationTicks(): Tick {
    return 1800;
  }

  /** Share of the world's land irradiated before recruiting starts to suffer. */
  falloutRegenThreshold(): number {
    return 0.05;
  }

  /** Share of recruiting lost when the whole world is irradiated. */
  falloutRegenDepth(): number {
    return 0.75;
  }

  /** 1 below the threshold, falling linearly to 1 − depth at ratio 1. */
  falloutRegenModifier(falloutRatio: number): number {
    if (!this.falloutHasConsequences()) return 1;
    const threshold = this.falloutRegenThreshold();
    if (falloutRatio <= threshold) return 1;
    const past = (falloutRatio - threshold) / (1 - threshold);
    return 1 - this.falloutRegenDepth() * (past > 1 ? 1 : past);
  }

  /**
   * Stability (brief §6.6): land taken from another state breeds unrest
   * until it assimilates, and enough of one people's land held
   * unassimilated and ungarrisoned raises their partisans. Off, nothing is
   * recorded and nobody rises — the balance lever `--no-unrest`.
   */
  unrestEnabled(): boolean {
    return true;
  }

  /** Ticks an occupied tile takes to assimilate in the same hands: five minutes. */
  unrestAssimilationTicks(): Tick {
    return 3000;
  }

  /**
   * Unassimilated tiles held from one people before their partisans rise:
   * a flat floor, or a share of the occupier's own land, whichever is
   * larger — so a small conqueror feels it before an empire does, and an
   * empire is not kept in permanent revolt by the first 300 tiles of every
   * neighbour it ever bordered.
   */
  unrestPartisanThreshold(occupierTiles: number = 0): number {
    return Math.max(
      300,
      Math.floor((occupierTiles * this.unrestPartisanShare()) / 100),
    );
  }

  /** The share (whole percent) of the occupier's land behind the threshold. */
  unrestPartisanShare(): number {
    return 10;
  }

  /** Ticks between uprisings of the same people against the same occupier. */
  partisanCooldownTicks(): Tick {
    return 1800;
  }

  /** The troops an uprising starts with, by the land held from its people. */
  partisanTroops(unrestTiles: number): number {
    return Math.min(80_000, 5_000 + 30 * unrestTiles);
  }

  /**
   * Partisan doctrine (brief §6.6): the people's land rebels twice as fast —
   * half the tiles raise them and the land takes twice as long to settle.
   */
  doctrineUnrestScale(doctrine: Doctrine): number {
    if (!this.doctrinesEnabled()) return 1;
    return doctrine === Doctrine.Partisan ? 2 : 1;
  }

  msPerTick(): number {
    return 100;
  }
  SAMCooldown(): number {
    return 90;
  }
  SiloCooldown(): number {
    return 90;
  }

  defensePostRange(): number {
    return 30;
  }

  /**
   * The terrain table with this lobby's multipliers applied. Multiplying by
   * exactly 1 is exact in IEEE arithmetic, so a lobby with no `terrain`
   * block produces the same bits as the bare table.
   */
  terrainAttackBase(terrain: TerrainType): { mag: number; tileCost: number } {
    const band = terrainBand(terrain);
    const base = TERRAIN_COST[band];
    const scale = this._gameConfig.terrain?.[terrainBandKey(band)];
    if (scale === undefined) return { mag: base.mag, tileCost: base.tileCost };
    return {
      mag: base.mag * (scale.loss ?? 1),
      tileCost: base.tileCost * (scale.speed ?? 1),
    };
  }

  /**
   * How much an attack prefers flatter ground: the conquest heap's terrain
   * weight, from the same table as the costs so the two cannot drift apart.
   * Water and impassable weigh 0 — they never enter the heap.
   */
  terrainPriorityWeight(terrain: TerrainType): number {
    switch (terrain) {
      case TerrainType.Plains:
      case TerrainType.Highland:
      case TerrainType.Mountain:
        return TERRAIN_COST[terrain].priority;
      default:
        return 0;
    }
  }

  /**
   * Elevation that costs something (brief §6.2, second half). The band
   * table above steps 80 -> 100 -> 120 across plains, highland and mountain;
   * these three curves put the stored 0-30 elevation back inside it, so a
   * mag-30 peak is dearer than a mag-20 foothill, a slope costs on every tile
   * of the ascent and pays back on every tile of the descent, and a defender
   * on high ground loses fewer troops holding it. All linear, so every engine
   * agrees on the bits.
   *
   * Cost of a tile at the top of the range, over its band's base. 0.25 makes
   * a mag-30 mountain tile 150 against plains' 80 - the ratio goes from 1.5
   * to just under 1.9.
   */
  terrainHeightSlope(): number {
    return 0.25;
  }

  /**
   * Cost of climbing the full 30 steps in one tile, which never happens; a
   * typical uphill tile is +1 or +2 and the 99th-percentile climb on the
   * world map is +12, which at 1.0 is +40 %. Symmetric downhill, floored so
   * a plunge is never free.
   */
  terrainClimbSlope(): number {
    return 1.0;
  }

  /** Share of per-tile defender loss that a mag-30 defender is spared. */
  terrainHighGroundDefence(): number {
    return 0.3;
  }

  terrainHeightModifier(elevation: number): number {
    return 1 + (this.terrainHeightSlope() * elevation) / 30;
  }

  terrainClimbModifier(climb: number): number {
    const mod = 1 + (this.terrainClimbSlope() * climb) / 30;
    return mod < 0.5 ? 0.5 : mod;
  }

  terrainHighGroundModifier(elevation: number): number {
    return 1 - (this.terrainHighGroundDefence() * elevation) / 30;
  }

  /**
   * Supply lines (brief §6.1). An attack is fed through the attacker's own
   * ground from its nearest spawn tile, City, Port or Factory; the further
   * the front is from one, the more the attack bleeds and the slower it
   * moves. The decision this is here to create is "put a city or a port
   * behind the front before pushing past it".
   *
   * Distances are in tiles walked through owned territory, not straight-line
   * distance, and are not scaled by map size — a 30-tile reach means the same
   * thing on every map, the way `defensePostRange` does.
   *
   * This one is the reach that costs nothing.
   */
  supplyFreeRange(): number {
    return 30;
  }

  /** Tiles of reach at which the penalty and the attrition saturate. */
  supplyMaxRange(): number {
    return 90;
  }

  /** Loss and slowdown multiplier at (and past) `supplyMaxRange`. */
  supplyMaxPenalty(): number {
    return 1.5;
  }

  /**
   * Share of a stranded attack's standing stack that melts away each tick at
   * full over-extension. 0.002 costs a stack about a sixth of itself over ten
   * seconds of sitting at the end of a dead supply line.
   */
  supplyAttritionRate(): number {
    return 0.002;
  }

  /**
   * 0 inside the free range, rising linearly to 1 at `supplyMaxRange`. Only
   * + - * / so every engine agrees on the bits (see DetMath).
   */
  supplyOverExtension(supplyDistance: number): number {
    const free = this.supplyFreeRange();
    const max = this.supplyMaxRange();
    if (supplyDistance <= free) return 0;
    if (supplyDistance >= max) return 1;
    return (supplyDistance - free) / (max - free);
  }

  /** Multiplier on both attacker loss and tile cost for an over-extended attack. */
  supplyPenalty(supplyDistance: number): number {
    return (
      1 +
      (this.supplyMaxPenalty() - 1) * this.supplyOverExtension(supplyDistance)
    );
  }

  defensePostDefenseBonus(): number {
    return 5;
  }

  defensePostSpeedBonus(): number {
    return 3;
  }

  playerTeams(): TeamCountConfig {
    return this._gameConfig.playerTeams ?? 0;
  }

  spawnNations(): boolean {
    return this._gameConfig.nations !== "disabled";
  }

  isUnitDisabled(unitType: UnitType): boolean {
    return this._gameConfig.disabledUnits?.includes(unitType) ?? false;
  }

  bots(): number {
    return this._gameConfig.bots;
  }
  instantBuild(): boolean {
    return this._gameConfig.instantBuild;
  }
  disableNavMesh(): boolean {
    return this._gameConfig.disableNavMesh ?? false;
  }
  disableAlliances(): boolean {
    // customAllianceDuration === 0 disables alliances (the "custom alliances"
    // control at 0). The legacy boolean is still honored for older configs.
    return (
      this._gameConfig.customAllianceDuration === 0 ||
      (this._gameConfig.disableAlliances ?? false)
    );
  }
  waterNukes(): boolean {
    return this._gameConfig.waterNukes ?? false;
  }
  isRandomSpawn(): boolean {
    return this._gameConfig.randomSpawn;
  }
  infiniteGold(): boolean {
    return this._gameConfig.infiniteGold;
  }
  donateGold(): boolean {
    return this._gameConfig.donateGold;
  }
  infiniteTroops(): boolean {
    return this._gameConfig.infiniteTroops;
  }
  donateTroops(): boolean {
    return this._gameConfig.donateTroops;
  }
  goldMultiplier(): number {
    return this._gameConfig.goldMultiplier ?? 1;
  }
  startingGold(playerInfo: PlayerInfo): Gold {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 0n;
    }
    return this.startingGoldFor(playerInfo);
  }

  /**
   * Global spawn throttle for the train economy, counted in Train *units*
   * (~7 per train: engine, tail, 5 cars). Up to 1.5x spawns for the very
   * first trains, ~1x around 35 units (~5 trains), then a capacity
   * sigmoid damps spawning past the ~300-unit midpoint. The damping
   * flattens onto a ~0.25 plateau past ~460 units (~65 trains), so a big
   * enough rail economy still scales at a quarter of the un-damped rate,
   * until a global hard cap far beyond any normal game collapses the
   * plateau past ~900 units (~130 trains).
   */
  trainSaturation(numTrainUnits: number): number {
    const boost = 1 + 0.5 * exp(-numTrainUnits / 30);
    const damping = 1 - sigmoid(numTrainUnits, Math.LN2 / 100, 300);
    const plateau = 0.25 * (1 - sigmoid(numTrainUnits, Math.LN2 / 150, 900));
    return boost * Math.max(damping, plateau);
  }

  trainSpawnRate(numPlayerFactories: number, numTrainUnits: number): number {
    // hyperbolic decay, midpoint at 10 factories
    // expected number of trains = numPlayerFactories  / trainSpawnRate(numPlayerFactories)
    const rate = (numPlayerFactories + 10) * 15;
    return Math.max(1, Math.floor(rate / this.trainSaturation(numTrainUnits)));
  }

  trainGold(
    rel: "self" | "team" | "ally" | "other",
    citiesVisited: number,
    player: Player | PlayerView,
  ): Gold {
    // No penalty for the first 10 cities.
    citiesVisited = Math.max(0, citiesVisited - 9);
    let baseGold: number;
    switch (rel) {
      case "ally":
        baseGold = 35_000;
        break;
      case "team":
      case "other":
        baseGold = 25_000;
        break;
      case "self":
        baseGold = 10_000;
        break;
    }
    const distPenalty = citiesVisited * 5_000;
    const gold = Math.max(5000, baseGold - distPenalty);
    return toInt(gold * this.goldMultiplierFor(player));
  }

  trainStationMinRange(): number {
    return 15;
  }
  trainStationMaxRange(): number {
    return 110;
  }
  railroadMaxSize(): number {
    return this.trainStationMaxRange() * 1.4142;
  }

  tradeShipGold(dist: number, player: Player | PlayerView): Gold {
    // Sigmoid: concave start, sharp S-curve middle, linear end - heavily punishes trades under range debuff.
    const debuff = this.tradeShipShortRangeDebuff();
    const baseGold = 75_000 / (1 + exp(-0.03 * (dist - debuff))) + 50 * dist;
    return BigInt(
      Math.floor(
        baseGold *
          this.goldMultiplierFor(player) *
          this.doctrineTradeGoldScale(player.doctrine()),
      ),
    );
  }

  /**
   * Global spawn throttle for the trade-ship economy. A mild ~1.45x odds
   * boost while the world fleet is small (the pity timer square-roots the
   * realized effect, so ~1.2x actual spawns), held through the opening
   * trading minutes and crossing the old un-boosted curve around 110
   * ships, then a capacity sigmoid damps spawning past the ~230-ship
   * midpoint. The damping flattens onto a 0.25 plateau past ~310 ships
   * (~half cadence per port after the pity timer), so heavy port
   * investment keeps scaling income linearly, until a global hard cap far
   * beyond any normal game collapses the plateau past ~800 at sea.
   */
  tradeShipSaturation(numTradeShips: number): number {
    const boost = 1 + 0.45 * exp(-numTradeShips / 120);
    const damping = 1 - sigmoid(numTradeShips, Math.LN2 / 50, 230);
    const plateau = 0.25 * (1 - sigmoid(numTradeShips, Math.LN2 / 100, 800));
    return boost * Math.max(damping, plateau);
  }

  // Probability of trade ship spawn = 1 / tradeShipSpawnRate
  tradeShipSpawnRate(
    tradeShipSpawnRejections: number,
    numTradeShips: number,
  ): number {
    // Pity timer: increases spawn chance after consecutive rejections
    const rejectionModifier = 1 / (tradeShipSpawnRejections + 1);

    return Math.max(
      1,
      Math.floor(
        (100 * rejectionModifier) / this.tradeShipSaturation(numTradeShips),
      ),
    );
  }

  unitInfo(type: UnitType): UnitInfo {
    const cached = this.unitInfoCache.get(type);
    if (cached !== undefined) {
      return cached;
    }

    let info: UnitInfo;
    switch (type) {
      case UnitType.TransportShip:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Warship:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 250_000),
            UnitType.Warship,
          ),
          maxHealth: 1000,
        };
        break;
      case UnitType.Shell:
        info = {
          cost: () => 0n,
          damage: 250,
        };
        break;
      case UnitType.SAMMissile:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Port:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, pow2(numUnits) * 125_000),
            UnitType.Port,
            UnitType.Factory,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          upgradable: true,
        };
        break;
      case UnitType.AtomBomb:
        info = {
          cost: this.costWrapper(() => 750_000, UnitType.AtomBomb),
        };
        break;
      case UnitType.HydrogenBomb:
        info = {
          cost: this.costWrapper(() => 5_000_000, UnitType.HydrogenBomb),
        };
        break;
      case UnitType.MIRV:
        info = {
          cost: (game: Game, player: Player) => {
            if (
              player.type() === PlayerType.Human &&
              this.hasInfiniteGoldFor(player)
            ) {
              return 0n;
            }
            return 25_000_000n + game.stats().numMirvsLaunched() * 15_000_000n;
          },
        };
        break;
      case UnitType.MIRVWarhead:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.TradeShip:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.MissileSilo:
        info = {
          cost: this.costWrapper(() => 1_000_000, UnitType.MissileSilo),
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
          upgradable: true,
        };
        break;
      case UnitType.DefensePost:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(250_000, (numUnits + 1) * 50_000),
            UnitType.DefensePost,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
        };
        break;
      case UnitType.SAMLauncher:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(3_000_000, (numUnits + 1) * 1_500_000),
            UnitType.SAMLauncher,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : SAM_CONSTRUCTION_TICKS,
          upgradable: true,
        };
        break;
      case UnitType.City:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, pow2(numUnits) * 125_000),
            UnitType.City,
          ),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      case UnitType.Factory:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, pow2(numUnits) * 125_000),
            UnitType.Factory,
            UnitType.Port,
          ),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      case UnitType.Train:
        info = {
          cost: () => 0n,
        };
        break;
      default:
        assertNever(type);
    }

    // Materials are one table (unitMaterialsCost) rather than a line in each
    // case above; every caller of unitInfo sees the same decorated object.
    // Infinite gold is the "infinite resources" cheat: costWrapper already
    // makes gold free for a human under it, and materials follow the same
    // rule, so a sandbox lobby is not the one place arms are gated.
    const materials = this.unitMaterialsCost(type);
    if (materials !== 0n && info.materialsCost === undefined) {
      info = {
        ...info,
        materialsCost: (_game: Game, player: Player) =>
          player.type() === PlayerType.Human && this.hasInfiniteGoldFor(player)
            ? 0n
            : scaleGold(
                materials,
                this.doctrineMaterialsScale(player.doctrine(), type),
              ),
      };
    }
    // Doctrine passives (brief §6.6) sit on top of whatever curve the unit
    // has, so a Fortress state's fifth post is still dearer than its first.
    const baseCost = info.cost;
    info = {
      ...info,
      cost: (game: Game, player: Player, extraUnits?: number) =>
        scaleGold(
          baseCost(game, player, extraUnits),
          this.doctrineUnitCostScale(player.doctrine(), type),
        ),
    };
    this.unitInfoCache.set(type, info);
    return info;
  }

  private hasInfiniteGoldFor(player: Player | PlayerView): boolean {
    if (this.infiniteGold()) return true;
    const hc = this._gameConfig.hostCheats;
    return (hc?.infiniteGold ?? false) && player.isLobbyCreator();
  }

  private hasInfiniteTroopsFor(player: Player | PlayerView): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      player.isLobbyCreator()
    );
  }

  private hasInfiniteTroopsForInfo(playerInfo: PlayerInfo): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      playerInfo.isLobbyCreator
    );
  }

  private goldMultiplierFor(player: Player | PlayerView): number {
    const base = this.goldMultiplier();
    const hc = this._gameConfig.hostCheats;
    if (hc?.goldMultiplier && player.isLobbyCreator()) {
      return hc.goldMultiplier;
    }
    return base;
  }

  public conquerGoldAmount(captured: Player): Gold {
    if (
      captured.type() === PlayerType.Bot ||
      captured.type() === PlayerType.Nation
    ) {
      return captured.gold();
    } else {
      return captured.gold() / 2n;
    }
  }

  private startingGoldFor(playerInfo: PlayerInfo): Gold {
    const base = BigInt(this._gameConfig.startingGold ?? 0);
    const hc = this._gameConfig.hostCheats;
    if (hc?.startingGold && playerInfo.isLobbyCreator) {
      return base + BigInt(hc.startingGold);
    }
    return base;
  }

  private costWrapper(
    costFn: (units: number) => number,
    ...types: UnitType[]
  ): (g: Game, p: Player, extraUnits?: number) => bigint {
    return (game: Game, player: Player, extraUnits: number = 0) => {
      if (
        player.type() === PlayerType.Human &&
        this.hasInfiniteGoldFor(player)
      ) {
        return 0n;
      }
      const numUnits = types.reduce(
        (acc, type) =>
          acc +
          Math.min(player.unitsOwned(type), player.unitsConstructed(type)),
        0,
      );
      return BigInt(costFn(numUnits + extraUnits));
    };
  }

  defaultDonationAmount(sender: Player): number {
    return Math.floor(sender.troops() / 3);
  }
  donateCooldown(): Tick {
    return 10 * 10;
  }
  embargoAllCooldown(): Tick {
    return 10 * 10;
  }
  deletionMarkDuration(): Tick {
    return 30 * 10;
  }

  deleteUnitCooldown(): Tick {
    return 30 * 10;
  }
  emojiMessageDuration(): Tick {
    return 5 * 10;
  }
  emojiMessageCooldown(): Tick {
    return 5 * 10;
  }
  quickChatCooldown(): Tick {
    return 3 * 10;
  }
  targetDuration(): Tick {
    return 10 * 10;
  }
  targetCooldown(): Tick {
    return 15 * 10;
  }
  allianceRequestDuration(): Tick {
    return 20 * 10;
  }
  allianceRequestCooldown(): Tick {
    return 30 * 10;
  }
  allianceDuration(): Tick {
    // Host can set a custom alliance duration in minutes (1-15); 0 disables
    // alliances (see disableAlliances). Falls back to the 5 minute default.
    const m = this._gameConfig.customAllianceDuration;
    if (typeof m === "number" && m > 0) return m * 60 * 10;
    return 300 * 10; // 5 minutes.
  }
  temporaryEmbargoDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  minDistanceBetweenPlayers(): number {
    return 30;
  }

  percentageTilesOwnedToWin(elapsedGameSeconds: number): number {
    const base = PERCENT_TILES_OWNED_TO_WIN;
    const sd = this.overtimeConfig();
    if (!sd.enabled) {
      return base;
    }
    // Whole seconds only: elapsedGameSeconds is ticks/10 and can carry a
    // fractional part. The bar moves in WHOLE percentage points (one step
    // every 60/dropPercentPerMinute seconds), so the HUD shows exactly the
    // integer the sim checks — and integer math is trivially deterministic.
    const secondsPastStart =
      Math.floor(elapsedGameSeconds) - sd.startMinutes * 60;
    if (secondsPastStart <= 0) {
      return base;
    }
    return Math.max(
      0,
      base - Math.floor((secondsPastStart * sd.dropPercentPerMinute) / 60),
    );
  }
  armyLimitWarningThreshold(): number {
    return 0.8;
  }
  boatMaxNumber(): number {
    if (this.isUnitDisabled(UnitType.TransportShip)) {
      return 0;
    }
    return 3;
  }
  numSpawnPhaseTurns(): number {
    if (this._gameConfig.gameType === GameType.Singleplayer) {
      return 100;
    }
    if (this.isRandomSpawn()) {
      return 150;
    }
    return 200;
  }
  numBots(): number {
    return this.bots();
  }

  /**
   * Per-tile attack outcome. Pure: depends only on the given input and this
   * config's tunables, never on Game/Player objects. AttackExecution gathers
   * the input from the simulation.
   *
   * Two base values come from the terrain and are scaled by the situation:
   *  - `mag`: how bloody the tile is (drives attacker troop loss)
   *  - `tileCost`: how expensive the tile is to take (higher = slower)
   *
   * Speed: each tick the attack can take about `borderSize` tiles worth of
   * budget; each tile consumes `tileCost`, scaled by how outnumbered the
   * attack is. The result reports that as a fraction of the tick.
   */
  /**
   * Cost of taking one tile. Pass `out` to also receive the named factors
   * behind the numbers (see {@link AttackExplanation}); omit it on the
   * simulation's hot path, where nothing allocates.
   */
  attackLogic(
    input: AttackLogicInput,
    out?: AttackExplanation,
  ): AttackLogicResult {
    const { attackTroops, attacker, defender } = input;
    const terrain = this.terrainAttackBase(input.terrain);
    let { mag, tileCost } = terrain;
    if (out !== undefined) {
      out.terrainMag = terrain.mag;
      out.terrainTileCost = terrain.tileCost;
      out.defensePostLossMod = 1;
      out.defensePostSpeedMod = 1;
      out.falloutMod = 1;
      out.supplyDistance = input.supplyDistance;
      out.supplyMod = 1;
      out.terraNulliusMod = 1;
      out.elevation = input.elevation;
      out.heightMod = 1;
      out.climb = input.climb;
      out.climbMod = 1;
      out.highGroundMod = 1;
      out.botDefenderMod = 1;
      out.disconnectedTeammateMod = 1;
      out.traitorLossMod = 1;
      out.traitorSpeedMod = 1;
      out.largeAttackerMod = 1;
      out.largeDefenderMod = 1;
      out.largeAttackerSpeedMod = 1;
      out.troopRatio = 0;
      out.clampedLossRatio = 1;
      out.defenderDensity = 0;
      out.speedCost = 0;
      out.borderSize = input.borderSize;
    }

    // Over-extension is charged before anything else so it applies to the
    // terra nullius branch too: the brief's "far from supply" is about the
    // attacker's reach, and an empty tile 80 tiles past your last port is
    // exactly the push this is meant to make expensive.
    const supplyMod = this.supplyPenalty(input.supplyDistance);
    if (supplyMod !== 1) {
      mag *= supplyMod;
      tileCost *= supplyMod;
      if (out !== undefined) out.supplyMod = supplyMod;
    }

    // Elevation next, still before the situational modifiers: like supply it
    // is a property of the ground, so it applies to the terra nullius branch
    // too. Height and climb are multiplied in separately so the explanation
    // can name them; the order here is the order tests recompose them in.
    const heightMod = this.terrainHeightModifier(input.elevation);
    if (heightMod !== 1) {
      mag *= heightMod;
      tileCost *= heightMod;
      if (out !== undefined) out.heightMod = heightMod;
    }
    const climbMod = this.terrainClimbModifier(input.climb);
    if (climbMod !== 1) {
      mag *= climbMod;
      tileCost *= climbMod;
      if (out !== undefined) out.climbMod = climbMod;
    }

    if (defender !== null && input.defenderHasDefensePost) {
      // A Fortress state's posts defend harder (brief §6.6).
      const postLoss =
        this.defensePostDefenseBonus() *
        this.doctrineDefensePostBonusScale(defender.doctrine ?? Doctrine.None);
      mag *= postLoss;
      tileCost *= this.defensePostSpeedBonus();
      if (out !== undefined) {
        out.defensePostLossMod = postLoss;
        out.defensePostSpeedMod = this.defensePostSpeedBonus();
      }
    }
    if (input.falloutRatio !== null) {
      const fallout = this.falloutDefenseModifier(input.falloutRatio);
      mag *= fallout;
      tileCost *= fallout;
      if (out !== undefined) out.falloutMod = fallout;
    }

    if (defender === null) {
      // An Expansionist takes empty land for less (brief §6.6).
      const tn = this.doctrineTerraNulliusCostScale(
        attacker.doctrine ?? Doctrine.None,
      );
      mag *= tn;
      tileCost *= tn;
      if (out !== undefined) out.terraNulliusMod = tn;
      const tickBudget = input.borderSize * 2;
      return {
        attackerTroopLoss: mag / (attacker.type === PlayerType.Bot ? 10 : 5),
        defenderTroopLoss: 0,
        tickFraction:
          within(
            (TERRA_NULLIUS_COST_SCALE * tileCost) / attackTroops,
            TERRA_NULLIUS_MIN_COST,
            TERRA_NULLIUS_MAX_COST,
          ) / tickBudget,
      };
    }

    if (defender.isDisconnectedTeammate) {
      // No troop loss if defender is disconnected and on same team
      mag = 0;
      if (out !== undefined) out.disconnectedTeammateMod = 0;
    }
    if (
      (attacker.type === PlayerType.Human ||
        attacker.type === PlayerType.Nation) &&
      defender.type === PlayerType.Bot
    ) {
      mag *= BOT_DEFENDER_LOSS_MULT;
      if (out !== undefined) out.botDefenderMod = BOT_DEFENDER_LOSS_MULT;
    }

    // Big territories are cheaper and faster to attack from and into, so
    // late games stay dynamic. The attacker's bonus is the stronger one.
    const largeAttackerBonus = largeTerritoryBonus(
      attacker.numTiles,
      LARGE_ATTACKER_DEPTH,
    );
    const largeDefenderBonus = largeTerritoryBonus(
      defender.numTiles,
      LARGE_DEFENDER_DEPTH,
    );

    const traitorLossMod = defender.isTraitor ? this.traitorDefenseDebuff() : 1;
    const traitorCostMod = defender.isTraitor ? this.traitorSpeedDebuff() : 1;

    // Defender loses its average troops-per-tile, less on high ground.
    const highGroundMod = this.terrainHighGroundModifier(input.elevation);
    const defenderTroopLoss =
      highGroundMod === 1
        ? defender.troops / defender.numTiles
        : (defender.troops / defender.numTiles) * highGroundMod;
    if (out !== undefined) out.highGroundMod = highGroundMod;

    // Two ratios drive the attacker's loss: how outnumbered the attack is
    // (defender army / attack stack, clamped: bigger pushes pay less per
    // tile) scales a cost made of a base plus the defender's troop density
    // (packed land is expensive, spread-thin land is cheap).
    const troopRatio = defender.troops / attackTroops;
    const attackerTroopLoss =
      mag *
      traitorLossMod *
      within(troopRatio, 0.6, 2) *
      (ATTACKER_LOSS_BASE * largeAttackerBonus * largeDefenderBonus +
        ATTACKER_LOSS_PER_DENSITY * defenderTroopLoss);

    // Speed: a tile's cost in tick-fractions grows with how outnumbered the
    // attack is. Floored at 0.82 below parity (overwhelming stacks land ~18%
    // faster), then rising linearly (saturating at 7.5x), with a second ramp
    // for hopeless attacks past 20x.
    const speedCost =
      (within(troopRatio, 0.82, 7.5) * within(troopRatio / 20, 1, 50)) /
      SPEED_COST_DIVISOR;
    const largeAttackerSpeedBonus = largeTerritoryBonus(
      attacker.numTiles,
      LARGE_ATTACKER_SPEED_DEPTH,
    );
    if (out !== undefined) {
      out.traitorLossMod = traitorLossMod;
      out.traitorSpeedMod = traitorCostMod;
      out.largeAttackerMod = largeAttackerBonus;
      out.largeDefenderMod = largeDefenderBonus;
      out.largeAttackerSpeedMod = largeAttackerSpeedBonus;
      out.troopRatio = troopRatio;
      out.clampedLossRatio = within(troopRatio, 0.6, 2);
      out.defenderDensity = defenderTroopLoss;
      out.speedCost = speedCost;
    }
    return {
      attackerTroopLoss,
      defenderTroopLoss,
      tickFraction:
        (speedCost *
          tileCost *
          largeAttackerSpeedBonus *
          largeDefenderBonus *
          traitorCostMod) /
        input.borderSize,
    };
  }

  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number {
    return Math.floor(attacker.troops() / 5);
  }

  warshipShellLifetime(): number {
    return 20; // in ticks (one tick is 100ms)
  }

  radiusPortSpawn() {
    return 20;
  }

  /**
   * Blockades (brief §6.3): a hostile warship within this many tiles of a
   * port stops its trade ships leaving and arriving. 25 — inside a warship's
   * patrol reach, outside a shore battery's — so a blockade is a fleet
   * commitment rather than a drive-by.
   */
  blockadeRange(): number {
    return 25;
  }

  /**
   * Embargo price (brief §6.3). An embargo used to be free to give and
   * binary to receive. Now the embargoed side's remaining trade pays less
   * in proportion to how many of the players it could trade with have
   * embargoed it: with half the world's ports closed to you, the ships that
   * still sail are worth less, because the market you are selling into has
   * shrunk. That is what makes trade denial a coalition tool — one embargo
   * is a nuisance, five are a siege.
   *
   * The share of a trade payout lost when every possible partner embargoes
   * you; scales linearly down to nothing at zero.
   */
  embargoTariffMax(): number {
    return 0.5;
  }

  /** Multiplier on a trade payout for a player embargoed by `pressure` of its possible partners (0-1). */
  embargoTariff(pressure: number): number {
    return 1 - this.embargoTariffMax() * pressure;
  }

  tradeShipShortRangeDebuff(): number {
    return 300;
  }

  proximityBonusPortsNb(totalPorts: number) {
    return within(totalPorts / 3, 4, totalPorts);
  }

  attackAmount(attacker: Player, defender: Player | TerraNullius) {
    if (attacker.type() === PlayerType.Bot) {
      return attacker.troops() / 20;
    } else {
      return attacker.troops() / 5;
    }
  }

  startManpower(playerInfo: PlayerInfo): number {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 10_000;
    }
    if (playerInfo.playerType === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          return 12_500;
        case Difficulty.Medium:
          return 18_750;
        case Difficulty.Hard:
          return 25_000; // Like humans
        case Difficulty.Impossible:
          return 31_250;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }
    return this.hasInfiniteTroopsForInfo(playerInfo) ? 1_000_000 : 25_000;
  }

  maxTroops(player: Player | PlayerView): number {
    const maxTroops =
      player.type() === PlayerType.Human && this.hasInfiniteTroopsFor(player)
        ? 1_000_000_000
        : 2 *
            (pow(player.numTilesOwned() - player.numIrradiatedTiles(), 0.6) *
              1000 +
              50000) +
          player
            .units(UnitType.City)
            // Irradiated land produces nothing: neither the tiles nor the
            // cities standing on them.
            .filter((u) => !u.isUnderConstruction() && !u.isIrradiated())
            .map((city) => city.level())
            .reduce((a, b) => a + b, 0) *
            this.cityTroopIncrease();

    if (player.type() === PlayerType.Bot) {
      return maxTroops / 3;
    }

    if (player.type() === PlayerType.Human) {
      return maxTroops;
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return maxTroops * 0.5;
      case Difficulty.Medium:
        return maxTroops * 0.75;
      case Difficulty.Hard:
        return maxTroops * 1; // Like humans
      case Difficulty.Impossible:
        return maxTroops * 1.25;
      default:
        assertNever(this._gameConfig.difficulty);
    }
  }

  troopIncreaseRate(
    player: Player | PlayerView,
    worldFalloutRatio: number = 0,
  ): number {
    const max = this.maxTroops(player);

    let toAdd = 10 + pow(player.troops(), 0.73) / 4;
    // World fallout drags everyone's recruiting, the nuker's included.
    toAdd *= this.falloutRegenModifier(worldFalloutRatio);

    const ratio = 1 - player.troops() / max;
    toAdd *= ratio;

    if (player.type() === PlayerType.Bot) {
      toAdd *= 0.5;
    }

    if (player.type() === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          toAdd *= 0.9;
          break;
        case Difficulty.Medium:
          toAdd *= 0.95;
          break;
        case Difficulty.Hard:
          toAdd *= 1; // Like humans
          break;
        case Difficulty.Impossible:
          toAdd *= 1.05;
          break;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }

    toAdd *= this.doctrineTroopRegenScale(player.doctrine());

    return Math.min(player.troops() + toAdd, max) - player.troops();
  }

  /**
   * Materials (brief §6.3). Factories make them, arms consume them, and
   * nothing else touches them, so the pool is the answer to one question:
   * how much industry stands behind this army. A player with gold and no
   * factories can raise cities, ports and factories but not a single
   * defense post, and that is the tall-versus-wide choice the brief asks
   * for. Flat per unit — a throughput gate, not a price curve.
   */
  unitMaterialsCost(type: UnitType): Gold {
    let base: bigint;
    switch (type) {
      case UnitType.DefensePost:
        base = 200n;
        break;
      case UnitType.Warship:
        base = 600n;
        break;
      case UnitType.SAMLauncher:
      case UnitType.MissileSilo:
        base = 1_000n;
        break;
      case UnitType.AtomBomb:
        base = 1_500n;
        break;
      case UnitType.HydrogenBomb:
        base = 6_000n;
        break;
      case UnitType.MIRV:
        base = 20_000n;
        break;
      default:
        return 0n;
    }
    return base * BigInt(this.materialsPriceScale());
  }

  /**
   * The whole arms table times this (session-12 retune). At the first-cut
   * prices the pool sat at 100k+ unused at the end of every bot run — supply
   * was never the constraint, so industry never was either. Doubled, a
   * level-one factory arms a post every twenty seconds and a silo every
   * hundred. The balance lever `--cheap-materials` restores 1.
   */
  materialsPriceScale(): number {
    return 2;
  }

  /**
   * Materials a factory makes per tick per level: 2, so a level-one factory
   * makes a defense post every ten seconds and a silo every fifty. Not
   * scaled by the gold multiplier — materials are not money.
   */
  factoryMaterialsPerTick(level: number): Gold {
    return 2n * BigInt(level);
  }

  /** Enough at spawn for one defense post, and not two, whatever a post costs. */
  startingMaterials(): Gold {
    return this.unitMaterialsCost(UnitType.DefensePost);
  }

  /**
   * Upkeep (brief §6.3). Every structure level and every warship costs gold
   * each tick, charged in PlayerExecution.tick right after income, so that
   * overbuilding is a debt that catches up with you rather than a one-off
   * price you paid last minute. Worker income is 100/tick for a human, so a
   * five-city, three-port, one-factory player pays 95 of it back before
   * trade — enough to make the next city a decision, not a reflex.
   *
   * Scaled by the lobby's gold multiplier like income is, so a 10x-gold lobby
   * keeps the same ratio of income to upkeep.
   */
  unitUpkeep(type: UnitType, player: Player | PlayerView): Gold {
    let base: number;
    switch (type) {
      case UnitType.City:
      case UnitType.Port:
        base = 10;
        break;
      case UnitType.Factory:
        base = 15;
        break;
      case UnitType.DefensePost:
        base = 5;
        break;
      case UnitType.SAMLauncher:
      case UnitType.MissileSilo:
        base = 25;
        break;
      case UnitType.Warship:
        base = 40;
        break;
      default:
        return 0n;
    }
    return BigInt(Math.floor(base * this.goldMultiplierFor(player)));
  }

  /**
   * What a player owes this tick: upkeep per level of every active, built
   * unit that has one. Deterministic: units() is creation order.
   */
  upkeepDue(player: Player): Gold {
    let due = 0n;
    for (const unit of player.units()) {
      if (!unit.isActive() || unit.isUnderConstruction()) continue;
      const each = this.unitUpkeep(unit.type(), player);
      if (each === 0n) continue;
      due += each * BigInt(unit.level());
    }
    return due;
  }

  /**
   * Ticks of unpaid upkeep a player is allowed before something is lost: 30
   * seconds. Long enough to notice the empty treasury and sell or conquer,
   * short enough that ignoring it is not a strategy.
   */
  upkeepGraceTicks(): Tick {
    return 300;
  }

  goldAdditionRate(player: Player | PlayerView): Gold {
    const multiplier = this.goldMultiplierFor(player);
    let baseRate: bigint;
    if (player.type() === PlayerType.Bot) {
      baseRate = 50n;
    } else {
      baseRate = 100n;
    }
    return BigInt(Math.floor(Number(baseRate) * multiplier));
  }

  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    switch (unitType) {
      case UnitType.MIRVWarhead:
        return { inner: 12, outer: 18 };
      case UnitType.AtomBomb:
        return { inner: 12, outer: 30 };
      case UnitType.HydrogenBomb:
        return { inner: 80, outer: 100 };
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  nukeAllianceBreakThreshold(): number {
    return 100;
  }

  nukeSpeed(unitType: UnitType): number {
    switch (unitType) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        return 10;
      case UnitType.MIRV:
        return 15;
      case UnitType.MIRVWarhead:
        return 22;
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  mirvNormalizeTargetTicks(): number {
    return 14;
  }

  defaultNukeTargetableRange(): number {
    return 150;
  }

  defaultSamRange(): number {
    return 70;
  }

  samRange(level: number): number {
    // rational growth function (level 1 = 70, level 5 just above hydro range, asymptotically approaches 150)
    return this.maxSamRange() - 480 / (level + 5);
  }

  maxSamRange(): number {
    return 150;
  }

  samUpgradeDuration(): number {
    return Math.floor(this.SAMCooldown() / 2);
  }

  dynamicSamRange(sam: Unit, currentTick: number): number {
    const state = sam.samLauncherState();
    if (state === undefined || state.upgradeStartTick === undefined) {
      return this.samRange(sam.level());
    }
    const duration = state.duration ?? this.samUpgradeDuration();
    const elapsed = currentTick - state.upgradeStartTick;
    if (elapsed >= duration) {
      return this.samRange(state.targetLevel);
    }
    const targetRange = this.samRange(state.targetLevel);
    const diff = targetRange - state.startRange;
    return state.startRange + (diff * elapsed) / duration;
  }

  defaultSamMissileSpeed(): number {
    return 12;
  }

  // Humans can be soldiers, soldiers attacking, soldiers in boat etc.
  nukeDeathFactor(
    nukeType: NukeType,
    humans: number,
    tilesOwned: number,
    maxTroops: number,
  ): number {
    if (nukeType !== UnitType.MIRVWarhead) {
      return (5 * humans) / Math.max(1, tilesOwned);
    }
    const targetTroops = 0.03 * maxTroops;
    const excessTroops = Math.max(0, humans - targetTroops);
    const scalingFactor = 500;

    const steepness = 2;
    const normalizedExcess = excessTroops / maxTroops;
    return scalingFactor * (1 - exp(-steepness * normalizedExcess));
  }

  structureMinDist(): number {
    return 15;
  }

  shellLifetime(): number {
    return 50;
  }

  warshipPatrolRange(): number {
    return 100;
  }

  warshipTargettingRange(): number {
    return 130;
  }

  warshipShellAttackRate(): number {
    return 20;
  }

  warshipDockingRange(): number {
    return 5;
  }

  warshipPortHealingBonusPerLevel(): number {
    return 5;
  }

  /** Health at or below which a warship retreats to repair, as a percent of its
   *  (veterancy-adjusted) max health, so the threshold scales with max health. */
  warshipRetreatHealthPercent(): number {
    return 75;
  }

  warshipPassiveHealing(): number {
    return 1;
  }

  warshipPassiveHealingRange(): number {
    return 150;
  }

  warshipPortSwitchThreshold(): number {
    return 0.75;
  }

  // --- Warship veterancy ---

  /** Maximum veterancy level a warship can reach. */
  warshipMaxVeterancy(): number {
    return 3;
  }

  /** Max-health boost per veterancy level, as an integer percent of base max
   *  health. Integer-only to keep src/core deterministic (no float constants). */
  warshipVeterancyHealthBonus(): number {
    return 20;
  }

  /** Shell-damage boost per veterancy level, as an integer percent of the
   *  rolled damage. Integer-only to keep src/core deterministic. */
  warshipVeterancyShellDamageBonus(): number {
    return 20;
  }

  /** Transport ships a warship must destroy to gain one veterancy level. */
  warshipVeterancyTransportKills(): number {
    return 10;
  }

  /** Trade ships a warship must capture to gain one veterancy level. */
  warshipVeterancyTradeCaptures(): number {
    return 25;
  }

  defensePostShellAttackRate(): number {
    return 100;
  }

  safeFromPiratesCooldownMax(): number {
    return 20;
  }

  defensePostTargettingRange(): number {
    return 75;
  }

  allianceExtensionPromptOffset(): number {
    return 300; // 30 seconds before expiration
  }
}
