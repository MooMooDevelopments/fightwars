import { AttackLogicInput, Config } from "../src/core/configuration/Config";
import { BreakAllianceExecution } from "../src/core/execution/alliance/BreakAllianceExecution";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { isBlockaded } from "../src/core/execution/Blockade";
import { FactoryExecution } from "../src/core/execution/FactoryExecution";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NationStructureBehavior } from "../src/core/execution/nation/NationStructureBehavior";
import { NationWarshipBehavior } from "../src/core/execution/nation/NationWarshipBehavior";
import { NationExecution } from "../src/core/execution/NationExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  AllianceTier,
  Cell,
  Doctrine,
  DOCTRINES,
  Game,
  GameType,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  UnitType,
} from "../src/core/game/Game";
import { GameUpdateType, PlayerUpdate } from "../src/core/game/GameUpdates";
import { SUPPLY_UNSUPPLIED } from "../src/core/game/SupplyNetwork";
import { UserSettings } from "../src/core/game/UserSettings";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { GameConfig } from "../src/core/Schemas";
import { setup } from "./util/Setup";

/**
 * Doctrines (brief §6.6): picked at spawn, one passive and one unlock each.
 * The pick rides the spawn intent; nations roll one from their seeded RNG;
 * every passive and unlock is a scale on a number the game already had.
 */

let game: Game;
let a: Player;
let b: Player;

/** The real attack formula: TestConfig flattens it for other suites. */
const real = new Config({} as GameConfig, new UserSettings(), false);

beforeEach(async () => {
  // The spawn phase is left open so a client's spawn intent is honoured.
  game = await setup(
    "plains",
    // Public, not singleplayer: a singleplayer pick ends the spawn phase.
    { infiniteGold: false, instantBuild: true, gameType: GameType.Public },
    [
      new PlayerInfo("a", PlayerType.Human, "c-a", "a"),
      new PlayerInfo("b", PlayerType.Human, "c-b", "b"),
    ],
    undefined,
    undefined,
    false,
  );
  a = game.player("a");
  b = game.player("b");
  a.addGold(1_000_000_000n);
  b.addGold(1_000_000_000n);
});

/** Two squares of land, spawn phase over. */
function settle() {
  for (let y = 10; y < 30; y++) {
    for (let x = 10; x < 30; x++) a.conquer(game.ref(x, y));
  }
  for (let y = 60; y < 80; y++) {
    for (let x = 60; x < 80; x++) b.conquer(game.ref(x, y));
  }
  game.endSpawnPhase();
}

/** A client's spawn pick: queued, then acted on a tick later. */
function pickSpawn(player: Player, tile: number, doctrine?: Doctrine) {
  game.addExecution(
    new SpawnExecution("g", player.info(), tile, true, doctrine),
  );
  game.executeNextTick(); // init
  return game.executeNextTick(); // tick: the spawn lands
}

describe("the pick", () => {
  it("is stamped by the spawn intent and kept when only the tile is re-picked", () => {
    pickSpawn(a, game.ref(20, 20), Doctrine.Fortress);
    expect(a.doctrine()).toBe(Doctrine.Fortress);

    pickSpawn(a, game.ref(40, 40));
    expect(a.spawnTile()).toBe(game.ref(40, 40));
    expect(a.doctrine()).toBe(Doctrine.Fortress);
  });

  it("crosses the wire on the object lane", () => {
    const updates = pickSpawn(a, game.ref(20, 20), Doctrine.Naval);
    const mine = (updates[GameUpdateType.Player] as PlayerUpdate[]).find(
      (u) => u.id === a.id(),
    );
    expect(mine?.doctrine).toBe(Doctrine.Naval);
  });

  it("is rolled by a nation from its seeded RNG, and not with doctrines off", () => {
    const info = new PlayerInfo("nation", PlayerType.Nation, null, "nation");
    game.addPlayer(info);
    game.addExecution(
      new NationExecution("g", new Nation(new Cell(50, 50), info)),
    );
    game.executeNextTick(); // init rolls
    expect(DOCTRINES).toContain(game.player("nation").doctrine());

    vi.spyOn(game.config(), "doctrinesEnabled").mockReturnValue(false);
    const other = new PlayerInfo("other", PlayerType.Nation, null, "other");
    game.addPlayer(other);
    game.addExecution(
      new NationExecution("g", new Nation(new Cell(70, 70), other)),
    );
    game.executeNextTick();
    expect(game.player("other").doctrine()).toBe(Doctrine.None);
    vi.restoreAllMocks();
  });

  it("is ignored by the spawn with doctrines off", () => {
    vi.spyOn(game.config(), "doctrinesEnabled").mockReturnValue(false);
    pickSpawn(a, game.ref(20, 20), Doctrine.Fortress);
    expect(a.doctrine()).toBe(Doctrine.None);
    vi.restoreAllMocks();
  });
});

describe("passives", () => {
  beforeEach(settle);

  function price(type: UnitType, doctrine: Doctrine): bigint {
    a.setDoctrine(doctrine);
    return game.config().unitInfo(type).cost(game, a);
  }

  it("each doctrine builds its one structure for three quarters, and nothing else cheaper", () => {
    const pairs: [Doctrine, UnitType][] = [
      [Doctrine.Mercantile, UnitType.Port],
      [Doctrine.Fortress, UnitType.DefensePost],
      [Doctrine.Naval, UnitType.Warship],
      [Doctrine.Nuclear, UnitType.MissileSilo],
      [Doctrine.Industrial, UnitType.Factory],
    ];
    for (const [doctrine, type] of pairs) {
      const base = price(type, Doctrine.None);
      expect(base).toBeGreaterThan(0n);
      expect(price(type, doctrine)).toBe(
        BigInt(Math.floor(Number(base) * 0.75)),
      );
      expect(price(UnitType.City, doctrine)).toBe(
        price(UnitType.City, Doctrine.None),
      );
    }
    // Off, the discount is gone and the curve is the plain one.
    vi.spyOn(game.config(), "doctrinesEnabled").mockReturnValue(false);
    expect(price(UnitType.Port, Doctrine.Mercantile)).toBe(
      price(UnitType.Port, Doctrine.None),
    );
    vi.restoreAllMocks();
  });

  it("Mercantile: every trade pays 15 % more", () => {
    a.setDoctrine(Doctrine.None);
    const base = Number(game.config().tradeShipGold(100, a));
    a.setDoctrine(Doctrine.Mercantile);
    expect(Number(game.config().tradeShipGold(100, a)) / base).toBeCloseTo(
      1.15,
      3,
    );
  });

  it("Expansionist: empty land for three quarters, charged on losses and on speed", () => {
    const input = (doctrine: Doctrine): AttackLogicInput => ({
      terrain: TerrainType.Plains,
      attackTroops: 20_000,
      attacker: { type: PlayerType.Human, numTiles: 5_000, doctrine },
      defender: null,
      defenderHasDefensePost: false,
      supplyDistance: 0,
      elevation: 0,
      climb: 0,
      falloutRatio: null,
      borderSize: 10,
    });
    const plain = real.attackLogic(input(Doctrine.None));
    const cheap = real.attackLogic(input(Doctrine.Expansionist));
    expect(cheap.attackerTroopLoss / plain.attackerTroopLoss).toBeCloseTo(
      0.75,
      6,
    );
    expect(cheap.tickFraction).toBeLessThanOrEqual(plain.tickFraction);
  });

  it("Partisan: the people take up arms 10 % faster", () => {
    a.setDoctrine(Doctrine.None);
    const base = game.config().troopIncreaseRate(a);
    a.setDoctrine(Doctrine.Partisan);
    expect(game.config().troopIncreaseRate(a) / base).toBeCloseTo(1.1, 6);
  });

  it("Diplomatic: the traitor mark for breaking a bond lasts half as long", () => {
    a.setDoctrine(Doctrine.Diplomatic);
    const request = a.createAllianceRequest(b, AllianceTier.NonAggression)!;
    request.accept();
    expect(a.isAlliedWith(b)).toBe(true);
    game.addExecution(new BreakAllianceExecution(a, b.id()));
    game.executeNextTick(); // init
    game.executeNextTick(); // the break happens in tick()
    expect(a.isTraitor()).toBe(true);
    // A pact is half the usual window; Diplomatic halves it again. Read one
    // tick after the mark, so one tick has already elapsed.
    const base = game.config().traitorDuration();
    const remaining = (
      a as unknown as { getTraitorRemainingTicks(): number }
    ).getTraitorRemainingTicks();
    expect(remaining).toBe(Math.floor(base * 0.25) - 1);
  });
});

describe("unlocks", () => {
  beforeEach(settle);

  it("Fortress: a defense post defends 30 % harder", () => {
    const input = (doctrine: Doctrine): AttackLogicInput => ({
      terrain: TerrainType.Plains,
      attackTroops: 20_000,
      attacker: { type: PlayerType.Human, numTiles: 5_000 },
      defender: {
        type: PlayerType.Human,
        numTiles: 5_000,
        troops: 20_000,
        isTraitor: false,
        isDisconnectedTeammate: false,
        doctrine,
      },
      defenderHasDefensePost: true,
      supplyDistance: 0,
      elevation: 0,
      climb: 0,
      falloutRatio: null,
      borderSize: 10,
    });
    const plain = real.attackLogic(input(Doctrine.None));
    const walled = real.attackLogic(input(Doctrine.Fortress));
    expect(walled.attackerTroopLoss / plain.attackerTroopLoss).toBeCloseTo(
      1.3,
      6,
    );
  });

  it("Expansionist: over-extension starts 15 tiles further out, and absence stays absence", () => {
    const exec = new AttackExecution(1000, a, null);
    (exec as unknown as { mg: Game }).mg = game;
    const reach = (
      exec as unknown as { withDoctrineReach(d: number): number }
    ).withDoctrineReach.bind(exec);
    a.setDoctrine(Doctrine.Expansionist);
    expect(reach(40)).toBe(25);
    expect(reach(10)).toBe(0);
    expect(reach(SUPPLY_UNSUPPLIED)).toBe(SUPPLY_UNSUPPLIED);
    a.setDoctrine(Doctrine.None);
    expect(reach(40)).toBe(40);
  });

  it("Nuclear: a warhead for half the materials, and nothing else", () => {
    const materials = (type: UnitType) =>
      game.config().unitInfo(type).materialsCost!(game, a);
    a.setDoctrine(Doctrine.None);
    const bomb = materials(UnitType.AtomBomb);
    const post = materials(UnitType.DefensePost);
    a.setDoctrine(Doctrine.Nuclear);
    expect(materials(UnitType.AtomBomb)).toBe(bomb / 2n);
    expect(materials(UnitType.HydrogenBomb)).toBe(
      game.config().unitMaterialsCost(UnitType.HydrogenBomb) / 2n,
    );
    expect(materials(UnitType.DefensePost)).toBe(post);
  });

  it("Diplomatic: a bond either party holds lasts half again as long", () => {
    const bond = () => {
      const request = a.createAllianceRequest(b, AllianceTier.NonAggression)!;
      request.accept();
      const alliance = a.allianceWith(b)!;
      return alliance.expiresAt() - game.ticks();
    };
    const usual = game.config().allianceDuration();
    expect(bond()).toBe(usual);
    a.breakAlliance(a.allianceWith(b)!);
    // The Diplomatic side may be the recipient: the longer of the two applies.
    b.setDoctrine(Doctrine.Diplomatic);
    expect(bond()).toBe(Math.floor(usual * 1.5));
  });

  it("Industrial: a factory turns out half again as much", () => {
    const factory = a.buildUnit(UnitType.Factory, game.ref(15, 15), {});
    game.addExecution(new FactoryExecution(factory));
    game.executeNextTick(); // init
    const perTick = game.config().factoryMaterialsPerTick(1);
    a.setDoctrine(Doctrine.None);
    let start = a.materials();
    for (let i = 0; i < 10; i++) game.executeNextTick();
    expect(a.materials()).toBe(start + perTick * 10n);

    a.setDoctrine(Doctrine.Industrial);
    start = a.materials();
    for (let i = 0; i < 10; i++) game.executeNextTick();
    expect(a.materials()).toBe(
      start + BigInt(Math.floor(Number(perTick) * 1.5)) * 10n,
    );
  });
});

describe("Naval: a warship blockades half again as far", () => {
  let merchant: Player;
  let admiral: Player;

  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("merchant", PlayerType.Human, "c-m", "merchant"),
        new PlayerInfo("admiral", PlayerType.Human, "c-ad", "admiral"),
      ],
    );
    merchant = game.player("merchant");
    admiral = game.player("admiral");
    for (let x = 90; x < 110; x++) merchant.conquer(game.ref(x, 100));
    admiral.conquer(game.ref(10, 10));
    while (game.inSpawnPhase()) game.executeNextTick();
  });

  it("closes a port a plain fleet cannot reach", () => {
    const port = merchant.buildUnit(UnitType.Port, game.ref(100, 100), {});
    const range = game.config().blockadeRange();
    const x = 100 + range + Math.floor(range / 4);
    admiral.buildUnit(UnitType.Warship, game.ref(x, 100), {
      patrolTile: game.ref(x, 100),
    });
    game.executeNextTick();
    expect(isBlockaded(game, port)).toBe(false);

    admiral.setDoctrine(Doctrine.Naval);
    game.executeNextTick();
    expect(isBlockaded(game, port)).toBe(true);
  });
});

/**
 * Nations play their doctrine (brief §6.6, session-12 retune). A doctrine
 * only changed prices, so a Mercantile nation built no more ports than any
 * other and the survivors skewed away from Expansionist and Mercantile. Now
 * the nation's build choice is weighted by it; humans are untouched.
 */
describe("nations play their doctrine", () => {
  beforeEach(settle);

  it("wants half again as many of its own structure, a second warship, three quarters the reserve", () => {
    const pairs: [Doctrine, UnitType, number][] = [
      [Doctrine.Mercantile, UnitType.Port, 1.5],
      [Doctrine.Fortress, UnitType.DefensePost, 1.5],
      [Doctrine.Naval, UnitType.Warship, 2],
      [Doctrine.Nuclear, UnitType.MissileSilo, 1.5],
      [Doctrine.Industrial, UnitType.Factory, 1.5],
    ];
    for (const [doctrine, type, scale] of pairs) {
      expect(real.doctrineNationBuildScale(doctrine, type)).toBe(scale);
      expect(real.doctrineNationBuildScale(doctrine, UnitType.City)).toBe(1);
      expect(real.doctrineNationBuildScale(Doctrine.None, type)).toBe(1);
    }
    expect(real.doctrineNationExpandReserveScale(Doctrine.Expansionist)).toBe(
      0.75,
    );
    expect(real.doctrineNationExpandReserveScale(Doctrine.Mercantile)).toBe(1);
    // Off, a doctrine is a badge again.
    vi.spyOn(real, "doctrinesEnabled").mockReturnValue(false);
    expect(
      real.doctrineNationBuildScale(Doctrine.Naval, UnitType.Warship),
    ).toBe(1);
    expect(real.doctrineNationExpandReserveScale(Doctrine.Expansionist)).toBe(
      1,
    );
    vi.restoreAllMocks();
  });

  it("Mercantile: four cities and three ports want a fourth port; a plain nation is content", () => {
    const behavior = new NationStructureBehavior(new PseudoRandom(1), game, a);
    vi.spyOn(a, "unitsOwned").mockImplementation((type: UnitType) =>
      type === UnitType.Port ? 3 : 0,
    );
    const wants = () =>
      (behavior as any).shouldBuildStructure(UnitType.Port, 4, true);
    a.setDoctrine(Doctrine.Industrial);
    expect(wants()).toBe(false); // floor(4 × 0.75) = 3, held
    a.setDoctrine(Doctrine.Mercantile);
    expect(wants()).toBe(true); // floor(4 × 0.75 × 1.5) = 4
    vi.restoreAllMocks();
  });

  it("Expansionist: the nation keeps three quarters of the reserve before expanding", () => {
    const build = (id: string, doctrine: Doctrine) => {
      const info = new PlayerInfo(id, PlayerType.Nation, null, id);
      game.addPlayer(info).setDoctrine(doctrine);
      const exec = new NationExecution("g", new Nation(new Cell(50, 50), info));
      const before = (exec as any).expandRatio as number;
      exec.init(game);
      return [before, (exec as any).expandRatio as number];
    };
    const [plainBefore, plainAfter] = build("plain", Doctrine.Fortress);
    expect(plainAfter).toBe(plainBefore);
    const [before, after] = build("expander", Doctrine.Expansionist);
    expect(after).toBeCloseTo(before * 0.75, 10);
  });
});

describe("Naval: a nation keeps a second warship", () => {
  let admiral: Player;

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [new PlayerInfo("admiral", PlayerType.Human, "c-ad", "admiral")],
    );
    admiral = game.player("admiral");
    admiral.addGold(1_000_000_000n);
    // The land half's north-west corner; x = 7 is the shore, x >= 8 ocean.
    for (let x = 0; x < 7; x++) {
      for (let y = 0; y < 8; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) admiral.conquer(tile);
      }
    }
    while (game.inSpawnPhase()) game.executeNextTick();
  });

  it("builds a second where a plain nation stops at one", () => {
    admiral.buildUnit(UnitType.Port, game.ref(6, 4), {});
    admiral.buildUnit(UnitType.Warship, game.ref(8, 4), {
      patrolTile: game.ref(8, 4),
    });
    expect(admiral.units(UnitType.Warship).length).toBe(1);
    const random = new PseudoRandom(1);
    vi.spyOn(random, "chance").mockReturnValue(true);
    const behavior = new NationWarshipBehavior(
      random,
      game,
      admiral,
      new NationEmojiBehavior(random, game, admiral),
    );
    // The spawn tile is a random draw near the port that can miss the water
    // fifty times; pin it to the sea beside the first warship.
    vi.spyOn(behavior as any, "warshipSpawnTile").mockReturnValue(
      game.ref(9, 4),
    );
    admiral.setDoctrine(Doctrine.Mercantile);
    expect(behavior.maybeSpawnWarship()).toBe(false);
    admiral.setDoctrine(Doctrine.Naval);
    expect(behavior.maybeSpawnWarship()).toBe(true);
    vi.restoreAllMocks();
  });
});
