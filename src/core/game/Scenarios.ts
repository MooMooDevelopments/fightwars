import { Doctrine } from "./Game";
import { GameMapType } from "./Maps.gen";

/**
 * Historical scenarios (brief §6.7): a map with a fixed cast.
 *
 * A scenario names the nations that take the field — by their manifest
 * name, so the spawn and the flag come from the map — and gives each a
 * doctrine and, in a team scenario, a bloc. The blocs are the game's teams
 * in order, so humans who join are dealt into them by the ordinary team
 * assignment and the nations are pinned to theirs. A scenario without
 * blocs is free-for-all. Nothing else about the game changes: the cast is
 * the whole scenario, and it lives here as data so the simulation on
 * every client reads the same list.
 */
export interface ScenarioNation {
  /** The name on the map. */
  name: string;
  /** The manifest nation whose spawn and flag this one takes; the name when absent. */
  manifestName?: string;
  doctrine: Doctrine;
  /** Index into the scenario's blocs; absent in a free-for-all scenario. */
  bloc?: number;
}

export interface Scenario {
  id: string;
  nameKey: string;
  eraKey: string;
  map: GameMapType;
  /** Translation keys of the blocs, in team order; empty for free-for-all. */
  blocKeys: string[];
  nations: ScenarioNation[];
}

const n = (
  name: string,
  doctrine: Doctrine,
  bloc?: number,
  manifestName?: string,
): ScenarioNation =>
  manifestName === undefined
    ? { name, doctrine, bloc }
    : { name, manifestName, doctrine, bloc };

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "ww1",
    nameKey: "scenario.ww1.name",
    eraKey: "scenario.ww1.era",
    map: GameMapType.Europe,
    blocKeys: ["scenario.bloc.entente", "scenario.bloc.central"],
    nations: [
      n("France", Doctrine.Fortress, 0),
      n("England", Doctrine.Naval, 0),
      n("Russia", Doctrine.Expansionist, 0),
      n("Serbia", Doctrine.Partisan, 0),
      n("Belgium", Doctrine.Fortress, 0),
      n("Italy", Doctrine.Naval, 0),
      n("Romania", Doctrine.Diplomatic, 0),
      n("Germany", Doctrine.Industrial, 1),
      n("Austria", Doctrine.Fortress, 1),
      n("Hungary", Doctrine.Fortress, 1),
      n("Bulgaria", Doctrine.Expansionist, 1),
      n("Türkiye", Doctrine.Fortress, 1),
    ],
  },
  {
    id: "ww2",
    nameKey: "scenario.ww2.name",
    eraKey: "scenario.ww2.era",
    map: GameMapType.Europe,
    blocKeys: [
      "scenario.bloc.allies",
      "scenario.bloc.axis",
      "scenario.bloc.soviets",
    ],
    nations: [
      n("England", Doctrine.Naval, 0),
      n("France", Doctrine.Fortress, 0),
      n("Poland", Doctrine.Fortress, 0),
      n("Greece", Doctrine.Partisan, 0),
      n("Norway", Doctrine.Naval, 0),
      n("Belgium", Doctrine.Fortress, 0),
      n("Netherlands", Doctrine.Mercantile, 0),
      n("Denmark", Doctrine.Mercantile, 0),
      n("Germany", Doctrine.Industrial, 1),
      n("Italy", Doctrine.Naval, 1),
      n("Hungary", Doctrine.Expansionist, 1),
      n("Romania", Doctrine.Fortress, 1),
      n("Bulgaria", Doctrine.Expansionist, 1),
      n("Finland", Doctrine.Fortress, 1),
      n("Slovakia", Doctrine.Fortress, 1),
      n("Russia", Doctrine.Industrial, 2),
      n("Ukraine", Doctrine.Expansionist, 2),
      n("Belarus", Doctrine.Fortress, 2),
    ],
  },
  {
    id: "coldwar",
    nameKey: "scenario.coldwar.name",
    eraKey: "scenario.coldwar.era",
    map: GameMapType.World,
    blocKeys: [
      "scenario.bloc.nato",
      "scenario.bloc.pact",
      "scenario.bloc.nonaligned",
    ],
    nations: [
      n("United States", Doctrine.Industrial, 0),
      n("Canada", Doctrine.Mercantile, 0),
      n("United Kingdom", Doctrine.Naval, 0),
      n("France", Doctrine.Nuclear, 0),
      n("Germany", Doctrine.Industrial, 0),
      n("Italy", Doctrine.Naval, 0),
      n("Spain", Doctrine.Fortress, 0),
      n("Norway", Doctrine.Naval, 0),
      n("Japan", Doctrine.Mercantile, 0),
      n("Australia", Doctrine.Naval, 0),
      n("Türkiye", Doctrine.Fortress, 0),
      n("Russia", Doctrine.Nuclear, 1),
      n("Poland", Doctrine.Fortress, 1),
      n("Belarus", Doctrine.Fortress, 1),
      n("Ukraine", Doctrine.Industrial, 1),
      n("Romania", Doctrine.Fortress, 1),
      n("China", Doctrine.Expansionist, 1),
      n("Mongolia", Doctrine.Expansionist, 1),
      n("Cuba", Doctrine.Partisan, 1),
      n("Kazakhstan", Doctrine.Fortress, 1),
      n("India", Doctrine.Diplomatic, 2),
      n("Egypt", Doctrine.Diplomatic, 2),
      n("Indonesia", Doctrine.Naval, 2),
      n("Brazil", Doctrine.Industrial, 2),
      n("Argentina", Doctrine.Mercantile, 2),
      n("Iran", Doctrine.Fortress, 2),
      n("Sweden", Doctrine.Diplomatic, 2),
      n("Finland", Doctrine.Diplomatic, 2),
      n("Ethiopia", Doctrine.Partisan, 2),
    ],
  },
  {
    id: "warringstates",
    nameKey: "scenario.warringstates.name",
    eraKey: "scenario.warringstates.era",
    map: GameMapType.China,
    blocKeys: [],
    nations: [
      n("Qin", Doctrine.Expansionist, undefined, "Shaanxi"),
      n("Chu", Doctrine.Expansionist, undefined, "Hunan"),
      n("Qi", Doctrine.Mercantile, undefined, "Shandong"),
      n("Yan", Doctrine.Fortress, undefined, "Beijing"),
      n("Zhao", Doctrine.Fortress, undefined, "Shanxi"),
      n("Wei", Doctrine.Industrial, undefined, "Henan"),
      n("Han", Doctrine.Diplomatic, undefined, "Hubei"),
      n("Shu", Doctrine.Fortress, undefined, "Sichuan"),
      n("Ba", Doctrine.Fortress, undefined, "Chongqing"),
      n("Yue", Doctrine.Naval, undefined, "Zhejiang"),
      n("Song", Doctrine.Mercantile, undefined, "Jiangsu"),
      n("Zhongshan", Doctrine.Partisan, undefined, "Hebei"),
    ],
  },
];

export function scenarioById(id: string | null | undefined): Scenario | null {
  if (id === null || id === undefined) return null;
  return SCENARIOS.find((s) => s.id === id) ?? null;
}
