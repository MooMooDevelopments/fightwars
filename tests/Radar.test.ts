import { RadarExecution } from "../src/core/execution/RadarExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  UnitType,
} from "../src/core/game/Game";
import { GameUpdateType, UnitUpdate } from "../src/core/game/GameUpdates";
import { unitTypeToOtherUnit } from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

/**
 * Radar (brief §6.4, session 12). A land structure that extends the reach
 * of its owner's SAM launchers: a SAM within `radarRange()` of an active
 * radar intercepts `radarSamRangeBonus()` tiles further, capped at
 * `maxSamRange()`. One read point — `Config.dynamicSamRange` — serves the
 * launcher, the nation's coverage estimates and the client.
 */

let game: Game;
let owner: Player;
let other: Player;

beforeEach(async () => {
  game = await setup("plains", { infiniteGold: true, instantBuild: true }, [
    new PlayerInfo("owner", PlayerType.Human, "c-o", "owner"),
    new PlayerInfo("other", PlayerType.Human, "c-x", "other"),
  ]);
  owner = game.player("owner");
  other = game.player("other");
  for (let y = 5; y < 78; y++) {
    for (let x = 5; x < 78; x++) owner.conquer(game.ref(x, y));
  }
  for (let y = 82; y < 90; y++) {
    for (let x = 82; x < 90; x++) other.conquer(game.ref(x, y));
  }
  owner.addMaterials(1_000_000n);
  other.addMaterials(1_000_000n);
  while (game.inSpawnPhase()) game.executeNextTick();
});

function range(sam: ReturnType<Player["buildUnit"]>): number {
  return game.config().dynamicSamRange(sam, game.ticks());
}

describe("the unit", () => {
  it("is a land structure that costs materials and upkeep, with a stats key", () => {
    expect(Structures.has(UnitType.Radar)).toBe(true);
    const config = game.config();
    expect(config.unitMaterialsCost(UnitType.Radar)).toBe(1000n);
    expect(config.unitUpkeep(UnitType.Radar, owner)).toBe(40n);
    expect(unitTypeToOtherUnit[UnitType.Radar]).toBe("radr");
    expect(owner.canBuild(UnitType.Radar, game.ref(50, 50))).not.toBe(false);
    expect(owner.canBuild(UnitType.Radar, game.ref(85, 85))).toBe(false);
  });
});

describe("a radar", () => {
  it("extends a SAM in reach by the bonus, and only that SAM", () => {
    const near = owner.buildUnit(UnitType.SAMLauncher, game.ref(25, 25), {});
    const far = owner.buildUnit(UnitType.SAMLauncher, game.ref(75, 75), {});
    const base = game.config().samRange(1);
    expect(range(near)).toBe(base);
    expect(near.samRangeBonus()).toBe(0);

    owner.buildUnit(UnitType.Radar, game.ref(20, 20), {});
    game.executeNextTick(); // a new tick: the per-tick cache re-reads
    const bonus = game.config().radarSamRangeBonus();
    expect(near.samRangeBonus()).toBe(bonus);
    expect(range(near)).toBe(base + bonus);
    // (75,75) is ~78 tiles from the radar: outside its 60.
    expect(far.samRangeBonus()).toBe(0);
    expect(range(far)).toBe(base);
  });

  it("never pushes a SAM past the maximum range", () => {
    const sam = owner.buildUnit(UnitType.SAMLauncher, game.ref(30, 30), {});
    owner.buildUnit(UnitType.Radar, game.ref(40, 40), {});
    game.executeNextTick();
    vi.spyOn(game.config(), "radarSamRangeBonus").mockReturnValue(1000);
    game.executeNextTick();
    expect(range(sam)).toBe(game.config().maxSamRange());
    vi.restoreAllMocks();
  });

  it("counts only when active, built, and the SAM owner's own", () => {
    const sam = owner.buildUnit(UnitType.SAMLauncher, game.ref(30, 30), {});
    const base = game.config().samRange(1);
    // Someone else's radar beside the SAM does nothing for it.
    const theirs = other.buildUnit(UnitType.Radar, game.ref(35, 35), {});
    game.executeNextTick();
    expect(range(sam)).toBe(base);
    theirs.delete(false);
    // The owner's, still under construction, does nothing either...
    const mine = owner.buildUnit(UnitType.Radar, game.ref(40, 40), {});
    vi.spyOn(mine, "isUnderConstruction").mockReturnValue(true);
    game.executeNextTick();
    expect(range(sam)).toBe(base);
    vi.restoreAllMocks();
    // ...until it is built, and not after it is gone.
    game.executeNextTick();
    expect(range(sam)).toBe(base + game.config().radarSamRangeBonus());
    mine.delete(false);
    game.executeNextTick();
    expect(range(sam)).toBe(base);
  });

  it("re-sends the SAMs it covers when it goes up and when it falls, so the client redraws the ring", () => {
    const sam = owner.buildUnit(UnitType.SAMLauncher, game.ref(30, 30), {});
    const radar = owner.buildUnit(UnitType.Radar, game.ref(40, 40), {});
    game.addExecution(new RadarExecution(radar));
    game.executeNextTick(); // init
    const bonus = game.config().radarSamRangeBonus();
    const samUpdates = () =>
      (game.executeNextTick()[GameUpdateType.Unit] as UnitUpdate[]).filter(
        (u) => u.id === sam.id(),
      );
    // The tick the radar announces itself: the SAM's update carries the bonus.
    const up = samUpdates();
    expect(up.length).toBeGreaterThan(0);
    expect(up[up.length - 1].samRangeBonus).toBe(bonus);
    // Quiet after that.
    expect(samUpdates().length).toBe(0);
    // The radar falls: the SAM is re-sent without the bonus.
    radar.delete(false);
    const down = samUpdates();
    expect(down.length).toBeGreaterThan(0);
    expect(down[down.length - 1].samRangeBonus).toBeUndefined();
  });
});
