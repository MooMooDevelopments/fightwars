import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import {
  clampTunable,
  defaultRuleset,
  TUNABLES,
} from "../src/core/configuration/Tunables";
import { UserSettings } from "../src/core/game/UserSettings";
import { RulesetSchema } from "../src/core/Schemas";
import { testGameConfig } from "./util/Wire";

/**
 * Rulesets (brief §6.9): a lobby's overrides for the tunables, clamped,
 * unknown keys ignored, the registry the versioned config of record.
 */
describe("rulesets", () => {
  const withRules = (values: { key: string; value: number }[]) =>
    new Config(
      testGameConfig({ ruleset: { version: 1, values } }),
      new UserSettings(),
      false,
    );

  it("overrides a tunable, leaves the rest at the code's number", () => {
    const plain = new Config(testGameConfig(), new UserSettings(), false);
    const custom = withRules([{ key: "supplyMaxRange", value: 200 }]);
    expect(plain.supplyMaxRange()).toBe(TUNABLES.supplyMaxRange.default);
    expect(custom.supplyMaxRange()).toBe(200);
    expect(custom.supplyFreeRange()).toBe(plain.supplyFreeRange());
  });

  it("clamps to the registry and rounds the integers", () => {
    const c = withRules([
      { key: "supplyMaxRange", value: 1e9 },
      { key: "supplyMaxPenalty", value: -5 },
      { key: "defensePostRange", value: 12.6 },
    ]);
    expect(c.supplyMaxRange()).toBe(TUNABLES.supplyMaxRange.max);
    expect(c.supplyMaxPenalty()).toBe(TUNABLES.supplyMaxPenalty.min);
    expect(c.defensePostRange()).toBe(13);
    expect(clampTunable("nothingOfTheSort", 5)).toBeNull();
    expect(clampTunable("supplyMaxRange", Number.NaN)).toBeNull();
  });

  it("ignores a key it does not know, and sets gold as gold", () => {
    const c = withRules([
      { key: "msPerTick", value: 1 },
      { key: "survivalWaveGold", value: 1234.6 },
    ]);
    expect(c.msPerTick()).toBe(100);
    expect(c.survivalWaveGold()).toBe(1235n);
  });

  it("keeps the timing and lobby knobs out of the registry", () => {
    for (const k of ["msPerTick", "gameSpeed", "bots", "goldMultiplier"]) {
      expect(k in TUNABLES, k).toBe(false);
    }
    expect(Object.keys(TUNABLES).length).toBeGreaterThan(80);
  });

  it("is a versioned file of record that matches the registry", () => {
    const file = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../resources/rulesets/default.json"),
        "utf8",
      ),
    );
    expect(file).toEqual(defaultRuleset());
    expect(RulesetSchema.safeParse(file).success).toBe(true);
  });

  it("the wire refuses another version or an oversized list", () => {
    expect(RulesetSchema.safeParse({ version: 2, values: [] }).success).toBe(
      false,
    );
    expect(
      RulesetSchema.safeParse({
        version: 1,
        values: Array.from({ length: 201 }, (_, i) => ({
          key: `k${i}`,
          value: 1,
        })),
      }).success,
    ).toBe(false);
  });
});
