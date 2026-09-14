import {
  AttackExplanation,
  AttackLogicInput,
  AttackLogicResult,
} from "../core/configuration/Config";
import { TerrainType, UnitType } from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { GameView, PlayerView } from "./view";

/**
 * What attacking one tile would cost, worked out on the client before the
 * attack is launched.
 *
 * `Config.attackLogic` is pure and the client holds a `Config`, so this is the
 * simulation's own arithmetic rather than a model of it — the inputs are
 * gathered the same way `AttackExecution.attackLogicInput` gathers them, and
 * the explanation comes back from the same call that produces the numbers.
 *
 * One input the client cannot know is the width of the attack front, which
 * only scales how fast tiles fall, never what they cost in troops. So the
 * speed here is quoted per tile of front and the caller multiplies by the
 * front it expects; the troop costs are absolute.
 */
export interface AttackEstimate {
  /** Per-tile costs, straight from `Config.attackLogic`. */
  result: AttackLogicResult;
  /** Every named factor behind those costs. */
  explanation: AttackExplanation;
  /** Troops this attack would send, at the player's current attack ratio. */
  attackTroops: number;
  /**
   * Tiles taken per second for each tile of attack front. A 20-tile front
   * against this defender advances twenty times as fast.
   */
  tilesPerSecondPerFrontTile: number;
  /** True when the tile belongs to nobody — cheap, and nobody shoots back. */
  unclaimed: boolean;
  /** The tile's terrain, which sets the base cost every modifier scales. */
  terrain: TerrainType;
}

/** Ticks per second; a tick is 100 ms. */
const TICKS_PER_SECOND = 10;

/**
 * How far from supply the client can tell this tile is.
 *
 * The server streams one bit per tile — inside the free supply range or not —
 * so the client knows exactly when an attack pays nothing, and only knows a
 * bound when it pays something. Past the range the estimate quotes the
 * saturated penalty, which is the worst case: the tooltip may say an attack
 * is dearer than it turns out to be, never cheaper. Quoting a made-up middle
 * value would be the one thing worse than that.
 */
function clientSupplyDistance(
  game: GameView,
  tile: TileRef,
  me: PlayerView,
): number {
  const mine = me.smallID();
  for (const neighbor of game.neighbors(tile)) {
    if (game.ownerID(neighbor) === mine && game.isSupplied(neighbor)) {
      return 0;
    }
  }
  // Same forgiveness the simulation grants an Expansionist (brief §6.6).
  const max = game.config().supplyMaxRange();
  const reach = game.config().doctrineSupplyReach(me.doctrine());
  return max > reach ? max - reach : 0;
}

/**
 * The height the attack would come from: the highest tile the player holds
 * beside the target, the same rule the simulation uses. The target's own
 * height when none is held, so the climb reads as zero.
 */
function clientVantage(game: GameView, tile: TileRef, me: PlayerView): number {
  const mine = me.smallID();
  let best = -1;
  for (const neighbor of game.neighbors(tile)) {
    if (game.ownerID(neighbor) !== mine) continue;
    const m = game.magnitude(neighbor);
    if (m > best) best = m;
  }
  return best === -1 ? game.magnitude(tile) : best;
}

/**
 * Estimate the cost of attacking `tile`. Returns null when the tile cannot be
 * attacked at all — not land, the player's own, a teammate's, or there is no
 * local player.
 */
export function estimateAttackCost(
  game: GameView,
  tile: TileRef,
  attackRatio: number,
): AttackEstimate | null {
  const me = game.myPlayer();
  if (me === null || !game.isLand(tile)) return null;

  const owner = game.owner(tile);
  const defender =
    owner !== null && owner.isPlayer() ? (owner as PlayerView) : null;
  if (defender !== null && defender === me) return null;

  const attackTroops = Math.floor(me.troops() * attackRatio);
  if (attackTroops <= 0) return null;

  const input: AttackLogicInput = {
    terrain: game.terrainType(tile),
    attackTroops,
    attacker: {
      type: me.type(),
      numTiles: me.numTilesOwned(),
      doctrine: me.doctrine(),
    },
    defender:
      defender === null
        ? null
        : {
            type: defender.type(),
            numTiles: defender.numTilesOwned(),
            troops: defender.troops(),
            isTraitor: defender.isTraitor(),
            isDisconnectedTeammate:
              defender.isDisconnected() && me.isOnSameTeam(defender),
            doctrine: defender.doctrine(),
          },
    // Same check the simulation makes: an active defense post of the
    // defender's within range of this tile.
    defenderHasDefensePost:
      defender !== null &&
      game.hasUnitNearby(
        tile,
        game.config().defensePostRange(),
        UnitType.DefensePost,
        defender.id(),
      ),
    supplyDistance: clientSupplyDistance(game, tile, me),
    elevation: game.magnitude(tile),
    climb: game.magnitude(tile) - clientVantage(game, tile, me),
    falloutRatio: game.hasFallout(tile)
      ? game.numTilesWithFallout() / game.numLandTiles()
      : null,
    // A front of one, so the speed below is per front tile. The simulation
    // adds up to 4 tiles of jitter to the real front; that is noise on a
    // figure the player reads as "about this fast".
    borderSize: 1,
  };

  const explanation = blankExplanation();
  const result = game.config().attackLogic(input, explanation);

  return {
    result,
    explanation,
    attackTroops,
    tilesPerSecondPerFrontTile:
      result.tickFraction > 0 ? TICKS_PER_SECOND / result.tickFraction : 0,
    unclaimed: defender === null,
    terrain: input.terrain,
  };
}

/** One line of the breakdown: a named multiplier and what it changes. */
/**
 * What a running attack has cost so far, or null when there is nothing worth
 * showing.
 *
 * The estimate above answers "what would this cost"; this answers "what has it
 * cost", which is the same question one tick later and the one a player asks
 * while watching a front stall.
 *
 * Null rather than zero for a freshly launched attack: a "−0" beside every new
 * attack is noise in a row that is already dense. Null also covers the moment
 * between a merge raising the committed total and the live count catching up,
 * which would otherwise read as a negative spend.
 */
export function attackSpend(attack: {
  troops: number;
  troopsCommitted: number;
}): number | null {
  const spent = attack.troopsCommitted - attack.troops;
  return spent > 0 ? spent : null;
}

export interface AttackFactor {
  /** Translation key under `attack_cost.factor`. */
  key: string;
  /** The multiplier, e.g. 1.5 for "half again as costly". */
  value: number;
  /** Which figure it moves. */
  affects: "loss" | "speed" | "both";
}

/**
 * The factors worth showing a player: the ones that move the answer by more
 * than a couple of per cent, because a list of near-no-ops explains nothing
 * - and with elevation charged on every tile, almost every tile now carries
 * a x1.01 somewhere. Ordered by how much they move the answer, furthest from
 * 1 first, so the reason an attack is expensive is the first line rather
 * than the fifth.
 */
const FACTOR_WORTH_A_LINE = 0.02;
export function significantFactors(estimate: AttackEstimate): AttackFactor[] {
  const e = estimate.explanation;
  const all: AttackFactor[] = [
    { key: "defense_post", value: e.defensePostLossMod, affects: "loss" },
    {
      key: "defense_post_speed",
      value: e.defensePostSpeedMod,
      affects: "speed",
    },
    { key: "fallout", value: e.falloutMod, affects: "both" },
    { key: "supply", value: e.supplyMod, affects: "both" },
    { key: "expansionist", value: e.terraNulliusMod, affects: "both" },
    { key: "height", value: e.heightMod, affects: "both" },
    { key: "climb", value: e.climbMod, affects: "both" },
    { key: "high_ground", value: e.highGroundMod, affects: "loss" },
    { key: "tribe", value: e.botDefenderMod, affects: "loss" },
    { key: "traitor", value: e.traitorLossMod, affects: "loss" },
    { key: "traitor_speed", value: e.traitorSpeedMod, affects: "speed" },
    { key: "your_size", value: e.largeAttackerMod, affects: "loss" },
    { key: "their_size", value: e.largeDefenderMod, affects: "both" },
  ];
  return all
    .filter((factor) => Math.abs(factor.value - 1) > FACTOR_WORTH_A_LINE)
    .sort((a, b) => Math.abs(b.value - 1) - Math.abs(a.value - 1));
}

/**
 * How the attack stack compares with the defending army: below 1 you
 * outnumber them, above 1 they outnumber you. The single number that moves
 * the cost most, and the only one the player changes with the ratio slider.
 */
export function outnumberedBy(estimate: AttackEstimate): number | null {
  return estimate.unclaimed ? null : estimate.explanation.troopRatio;
}

/** Terrain's own name, for the line that says where the base cost came from. */
export function terrainKey(estimate: AttackEstimate): string {
  switch (estimate.terrain) {
    case TerrainType.Mountain:
      return "mountain";
    case TerrainType.Highland:
      return "highland";
    default:
      return "plains";
  }
}

function blankExplanation(): AttackExplanation {
  return {
    terrainMag: 0,
    terrainTileCost: 0,
    defensePostLossMod: 1,
    defensePostSpeedMod: 1,
    falloutMod: 1,
    supplyDistance: 0,
    supplyMod: 1,
    terraNulliusMod: 1,
    elevation: 0,
    heightMod: 1,
    climb: 0,
    climbMod: 1,
    highGroundMod: 1,
    botDefenderMod: 1,
    disconnectedTeammateMod: 1,
    traitorLossMod: 1,
    traitorSpeedMod: 1,
    largeAttackerMod: 1,
    largeDefenderMod: 1,
    largeAttackerSpeedMod: 1,
    troopRatio: 0,
    clampedLossRatio: 1,
    defenderDensity: 0,
    speedCost: 0,
    borderSize: 1,
  };
}

/** Exported for tests: the neutral shape `attackLogic` fills in. */
export const emptyExplanation = blankExplanation;
