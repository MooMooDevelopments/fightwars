/**
 * The tunables (brief §6.9, data-driven balance): every scalar knob in
 * `Config.ts` a lobby may override, with the number the code carries and
 * the bounds a ruleset value is clamped to. The keys are the accessor
 * names, so `docs/MECHANICS.md`'s references hold. `resources/rulesets/
 * default.json` is this table as data, versioned; `npm run rules:export`
 * regenerates it and a test keeps the two equal.
 *
 * Generated from the accessors in session 13; add an entry when an
 * accessor becomes a plain number and remove it when it grows logic.
 */
export interface Tunable {
  default: number;
  min: number;
  max: number;
  integer: boolean;
}

export const RULESET_VERSION = 1;

export const TUNABLES: Readonly<Record<string, Tunable>> = {
  SAMCooldown: { default: 90, min: 0, max: 900, integer: true },
  SiloCooldown: { default: 90, min: 0, max: 900, integer: true },
  allianceRequestCooldown: { default: 300, min: 0, max: 3000, integer: true },
  allianceRequestDuration: { default: 200, min: 0, max: 2000, integer: true },
  armsUpkeepScale: { default: 2, min: 0, max: 20, integer: true },
  armyLimitWarningThreshold: { default: 0.8, min: 0, max: 8, integer: false },
  artilleryAttackRate: { default: 50, min: 0, max: 500, integer: true },
  artilleryDamage: { default: 2000, min: 0, max: 20000, integer: true },
  artilleryNationRatio: { default: 0.2, min: 0, max: 2, integer: false },
  artilleryRange: { default: 40, min: 0, max: 400, integer: true },
  battleRoyaleFinalRadiusPercent: {
    default: 10,
    min: 0,
    max: 100,
    integer: true,
  },
  battleRoyaleGraceTicks: { default: 1800, min: 0, max: 18000, integer: true },
  battleRoyaleIntervalTicks: { default: 300, min: 0, max: 3000, integer: true },
  battleRoyaleRowsPerTick: { default: 32, min: 0, max: 320, integer: true },
  battleRoyaleSteps: { default: 12, min: 0, max: 120, integer: true },
  blockadeRange: { default: 25, min: 0, max: 250, integer: true },
  cityTroopIncrease: { default: 250000, min: 0, max: 2500000, integer: true },
  coalitionThreshold: { default: 0.4, min: 0, max: 4, integer: false },
  defaultNukeTargetableRange: {
    default: 150,
    min: 0,
    max: 1500,
    integer: true,
  },
  defaultSamMissileSpeed: { default: 12, min: 0, max: 120, integer: true },
  defaultSamRange: { default: 70, min: 0, max: 700, integer: true },
  defensePostDefenseBonus: { default: 5, min: 0, max: 50, integer: true },
  defensePostRange: { default: 30, min: 0, max: 300, integer: true },
  defensePostShellAttackRate: {
    default: 100,
    min: 0,
    max: 1000,
    integer: true,
  },
  defensePostSpeedBonus: { default: 3, min: 0, max: 30, integer: true },
  defensePostTargettingRange: { default: 75, min: 0, max: 750, integer: true },
  deleteUnitCooldown: { default: 300, min: 0, max: 3000, integer: true },
  deletionMarkDuration: { default: 300, min: 0, max: 3000, integer: true },
  donateCooldown: { default: 100, min: 0, max: 1000, integer: true },
  embargoAllCooldown: { default: 100, min: 0, max: 1000, integer: true },
  embargoTariffMax: { default: 0.5, min: 0, max: 5, integer: false },
  emojiMessageCooldown: { default: 50, min: 0, max: 500, integer: true },
  emojiMessageDuration: { default: 50, min: 0, max: 500, integer: true },
  falloutDurationTicks: { default: 1800, min: 0, max: 18000, integer: true },
  falloutRegenDepth: { default: 0.75, min: 0, max: 7.5, integer: false },
  falloutRegenThreshold: { default: 0.05, min: 0, max: 0.5, integer: false },
  hillRadiusPercent: { default: 6, min: 0, max: 60, integer: true },
  hillSecondsToWin: { default: 300, min: 0, max: 3000, integer: true },
  materialsPriceScale: { default: 2, min: 0, max: 20, integer: true },
  maxSamRange: { default: 150, min: 0, max: 1500, integer: true },
  minDistanceBetweenPlayers: { default: 30, min: 0, max: 300, integer: true },
  mirvNormalizeTargetTicks: { default: 14, min: 0, max: 140, integer: true },
  nukeAllianceBreakThreshold: {
    default: 100,
    min: 0,
    max: 1000,
    integer: true,
  },
  paratrooperMaxTroops: { default: 25000, min: 0, max: 250000, integer: true },
  paratrooperRange: { default: 120, min: 0, max: 1200, integer: true },
  paratrooperStepsPerTick: { default: 2, min: 0, max: 20, integer: true },
  partisanCooldownTicks: { default: 1800, min: 0, max: 18000, integer: true },
  quickChatCooldown: { default: 30, min: 0, max: 300, integer: true },
  radarNationRatio: { default: 0.1, min: 0, max: 1, integer: false },
  radarRange: { default: 60, min: 0, max: 600, integer: true },
  radarSamRangeBonus: { default: 30, min: 0, max: 300, integer: true },
  safeFromPiratesCooldownMax: { default: 20, min: 0, max: 200, integer: true },
  shellLifetime: { default: 50, min: 0, max: 500, integer: true },
  structureMinDist: { default: 15, min: 0, max: 150, integer: true },
  submarineDetectionRange: { default: 12, min: 0, max: 120, integer: true },
  supplyAttritionRate: { default: 0.002, min: 0, max: 0.02, integer: false },
  supplyFreeRange: { default: 30, min: 0, max: 300, integer: true },
  supplyMaxPenalty: { default: 1.5, min: 0, max: 15, integer: false },
  supplyMaxRange: { default: 90, min: 0, max: 900, integer: true },
  survivalSeconds: { default: 1200, min: 0, max: 12000, integer: true },
  survivalWaveGold: { default: 200000, min: 0, max: 2000000, integer: true },
  survivalWaveTicks: { default: 1200, min: 0, max: 12000, integer: true },
  survivalWaveTroopShare: { default: 0.15, min: 0, max: 1.5, integer: false },
  targetCooldown: { default: 150, min: 0, max: 1500, integer: true },
  targetDuration: { default: 100, min: 0, max: 1000, integer: true },
  teamLandShareWinThresholdTenths: {
    default: 7,
    min: 0,
    max: 70,
    integer: true,
  },
  terrainClimbSlope: { default: 1, min: 0, max: 10, integer: false },
  terrainHeightSlope: { default: 0.25, min: 0, max: 2.5, integer: false },
  terrainHighGroundDefence: { default: 0.3, min: 0, max: 3, integer: false },
  tradeShipShortRangeDebuff: { default: 300, min: 0, max: 3000, integer: true },
  trainStationMaxRange: { default: 110, min: 0, max: 1100, integer: true },
  trainStationMinRange: { default: 15, min: 0, max: 150, integer: true },
  traitorDefenseDebuff: { default: 0.5, min: 0, max: 5, integer: false },
  traitorSpeedDebuff: { default: 0.8, min: 0, max: 8, integer: false },
  unrestAssimilationTicks: { default: 3000, min: 0, max: 30000, integer: true },
  unrestPartisanShare: { default: 10, min: 0, max: 100, integer: true },
  upkeepGraceTicks: { default: 300, min: 0, max: 3000, integer: true },
  warshipDockingRange: { default: 5, min: 0, max: 50, integer: true },
  warshipMaxVeterancy: { default: 3, min: 0, max: 30, integer: true },
  warshipPassiveHealing: { default: 1, min: 0, max: 10, integer: true },
  warshipPassiveHealingRange: {
    default: 150,
    min: 0,
    max: 1500,
    integer: true,
  },
  warshipPatrolRange: { default: 100, min: 0, max: 1000, integer: true },
  warshipPortHealingBonusPerLevel: {
    default: 5,
    min: 0,
    max: 50,
    integer: true,
  },
  warshipPortSwitchThreshold: {
    default: 0.75,
    min: 0,
    max: 7.5,
    integer: false,
  },
  warshipRetreatHealthPercent: { default: 75, min: 0, max: 750, integer: true },
  warshipShellAttackRate: { default: 20, min: 0, max: 200, integer: true },
  warshipTargettingRange: { default: 130, min: 0, max: 1300, integer: true },
  warshipVeterancyHealthBonus: { default: 20, min: 0, max: 200, integer: true },
  warshipVeterancyShellDamageBonus: {
    default: 20,
    min: 0,
    max: 200,
    integer: true,
  },
  warshipVeterancyTradeCaptures: {
    default: 25,
    min: 0,
    max: 250,
    integer: true,
  },
  warshipVeterancyTransportKills: {
    default: 10,
    min: 0,
    max: 100,
    integer: true,
  },
};

export function isTunable(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(TUNABLES, key);
}

/** The value a ruleset entry sets, clamped to the registry; null for a key it does not know. */
export function clampTunable(key: string, value: number): number | null {
  if (!isTunable(key) || !Number.isFinite(value)) return null;
  const t = TUNABLES[key];
  const clamped = Math.min(t.max, Math.max(t.min, value));
  return t.integer ? Math.round(clamped) : clamped;
}

/** The registry as the versioned ruleset of record. */
export function defaultRuleset(): {
  version: number;
  values: { key: string; value: number }[];
} {
  return {
    version: RULESET_VERSION,
    values: Object.keys(TUNABLES)
      .sort()
      .map((key) => ({ key, value: TUNABLES[key].default })),
  };
}
