import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILTIN_PRESETS,
  migrateLegacyGraphicsSettings,
  parseGraphicsOverridesJson,
} from "../src/client/GraphicsPresets";
import builtinPresets from "../src/client/render/gl/graphics-presets.json";
import { GraphicsOverridesSchema } from "../src/client/render/gl/GraphicsOverrides";
import { applyGraphicsOverrides } from "../src/client/render/gl/RenderOverrides";
import {
  createRenderSettings,
  createThemeSettings,
} from "../src/client/render/gl/RenderSettings";
import {
  GRAPHICS_KEY,
  GRAPHICS_PRESETS_KEY,
  UserSettings,
} from "../src/core/game/UserSettings";

describe("built-in graphics presets", () => {
  it("every preset's overrides validate against the schema", () => {
    for (const preset of builtinPresets) {
      const parsed = GraphicsOverridesSchema.safeParse(preset.overrides);
      expect(parsed.success, `${preset.nameKey}: ${parsed.error}`).toBe(true);
    }
  });

  it.each(["deuteranopia", "protanopia", "tritanopia"] as const)(
    "%s preset applies the shared friend-foe colors and its own theme",
    (palette) => {
      const preset = builtinPresets.find(
        (p) => p.nameKey === `graphics_setting.preset_${palette}`,
      );
      expect(preset).toBeDefined();

      const settings = createRenderSettings();
      applyGraphicsOverrides(
        settings,
        GraphicsOverridesSchema.parse(preset!.overrides),
      );

      // Alt-view affiliation borders: self/ally blue family, enemy amber.
      // One triple serves all three deficiencies — see Palette.test.ts,
      // which pins that it stays separable under each of them.
      expect(settings.affiliation.selfR).toBeCloseTo(0.122, 2);
      expect(settings.affiliation.selfG).toBeCloseTo(0.31, 2);
      expect(settings.affiliation.selfB).toBeCloseTo(0.847, 2);
      expect(settings.affiliation.allyR).toBeCloseTo(0.373, 2);
      expect(settings.affiliation.allyG).toBeCloseTo(0.878, 2);
      expect(settings.affiliation.allyB).toBeCloseTo(1, 2);
      expect(settings.affiliation.enemyR).toBeCloseTo(1, 2);
      expect(settings.affiliation.enemyG).toBeCloseTo(0.69, 2);
      expect(settings.affiliation.enemyB).toBeCloseTo(0, 2);

      // Normal-view relationship border tints: friendly blue, enemy amber,
      // applied strongly so the cue doesn't rely on subtle hue.
      expect(settings.mapOverlay.friendlyTintR).toBeCloseTo(0.122, 2);
      expect(settings.mapOverlay.friendlyTintG).toBeCloseTo(0.31, 2);
      expect(settings.mapOverlay.friendlyTintB).toBeCloseTo(0.847, 2);
      expect(settings.mapOverlay.embargoTintR).toBeCloseTo(1, 2);
      expect(settings.mapOverlay.embargoTintG).toBeCloseTo(0.69, 2);
      expect(settings.mapOverlay.embargoTintB).toBeCloseTo(0, 2);
      expect(settings.mapOverlay.friendlyTintRatio).toBe(0.85);
      expect(settings.mapOverlay.embargoTintRatio).toBe(0.85);

      // The palette swap rides on the palette enum.
      expect(settings.theme).toEqual(createThemeSettings(palette));
    },
  );
});

describe("legacy colorblind flag", () => {
  it("accessibility.colorblind stored by old clients surfaces as the deuteranopia palette", async () => {
    const { UserSettings } = await import("../src/core/game/UserSettings");
    const userSettings = new UserSettings();
    // Old clients stored {accessibility:{colorblind:true}}; write it through
    // the settings cache in the pre-palette shape.
    userSettings.setGraphicsOverrides({
      accessibility: { colorblind: true },
    } as never);
    expect(userSettings.graphicsOverrides().palette).toBe("deuteranopia");

    // A save in the new shape sticks and stops the translation.
    userSettings.setGraphicsOverrides({});
    expect(userSettings.graphicsOverrides().palette).toBeUndefined();
  });
});

describe("migrateLegacyGraphicsSettings", () => {
  const userSettings = new UserSettings();

  beforeEach(() => {
    userSettings.removeCached(GRAPHICS_KEY);
    userSettings.removeCached(GRAPHICS_PRESETS_KEY);
  });

  it("snapshots pre-existing custom overrides into a preset and leaves them active", () => {
    userSettings.setGraphicsOverrides({ name: { nameScaleFactor: 2 } });
    migrateLegacyGraphicsSettings(userSettings);
    expect(userSettings.graphicsOverrides()).toEqual({
      name: { nameScaleFactor: 2 },
    });
    expect(Object.values(userSettings.graphicsPresets())).toEqual([
      { name: { nameScaleFactor: 2 } },
    ]);
  });

  it("upgrades a palette-only legacy colorblind config to the full Deuteranopia preset", () => {
    userSettings.setGraphicsOverrides({
      accessibility: { colorblind: true },
    } as never);
    migrateLegacyGraphicsSettings(userSettings);
    const deuteranopia = BUILTIN_PRESETS.find(
      (p) => p.nameKey === "graphics_setting.preset_deuteranopia",
    );
    expect(userSettings.graphicsOverrides()).toEqual(deuteranopia!.overrides);
    // Matches a built-in, so no phantom saved preset.
    expect(userSettings.graphicsPresets()).toEqual({});
  });

  it("grafts the Deuteranopia borders onto legacy colorblind configs with other tweaks", () => {
    userSettings.setGraphicsOverrides({
      accessibility: { colorblind: true },
      name: { nameScaleFactor: 2 },
    } as never);
    migrateLegacyGraphicsSettings(userSettings);
    const overrides = userSettings.graphicsOverrides();
    expect(overrides.name).toEqual({ nameScaleFactor: 2 });
    expect(overrides.palette).toBe("deuteranopia");
    // The friend-foe borders the old colorblind boolean hardcoded, now the
    // Deuteranopia preset's.
    expect(overrides.affiliation).toEqual({
      selfColor: "#1f4fd8",
      allyColor: "#5fe0ff",
      enemyColor: "#ffb000",
    });
    expect(overrides.mapOverlay).toEqual({
      friendlyTintColor: "#1f4fd8",
      embargoTintColor: "#ffb000",
      friendlyTintRatio: 0.85,
      embargoTintRatio: 0.85,
    });
    expect(Object.values(userSettings.graphicsPresets())).toEqual([overrides]);
  });

  it("stamps fresh profiles with no phantom preset and never runs twice", () => {
    migrateLegacyGraphicsSettings(userSettings);
    expect(userSettings.graphicsPresets()).toEqual({});
    // Custom tweaks made after the stamp are not re-snapshotted.
    userSettings.setGraphicsOverrides({ name: { nameScaleFactor: 2 } });
    migrateLegacyGraphicsSettings(userSettings);
    expect(userSettings.graphicsPresets()).toEqual({});
  });
});

describe("parseGraphicsOverridesJson", () => {
  it("accepts valid overrides JSON", () => {
    expect(
      parseGraphicsOverridesJson(
        '{"palette":"tritanopia","lighting":{"ambient":0.36}}',
      ),
    ).toEqual({ palette: "tritanopia", lighting: { ambient: 0.36 } });
  });

  it("rejects invalid JSON and non-objects", () => {
    expect(parseGraphicsOverridesJson("not json")).toBeNull();
    expect(parseGraphicsOverridesJson("5")).toBeNull();
    expect(parseGraphicsOverridesJson("null")).toBeNull();
    expect(parseGraphicsOverridesJson("[]")).toBeNull();
  });

  it("rejects unknown keys instead of stripping them to an empty config", () => {
    // The schema strips unknown keys when reading stored data; a paste that
    // survives only by stripping must not silently wipe the user's settings.
    expect(parseGraphicsOverridesJson('{"nmae":{"nameScaleFactor":2}}')).toBe(
      null,
    );
    expect(parseGraphicsOverridesJson('{"name":{"nameScale":2}}')).toBe(null);
    expect(
      parseGraphicsOverridesJson('{"accessibility":{"colorblind":true}}'),
    ).toBe(null);
  });
});
