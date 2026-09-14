import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { NationExecution } from "../src/core/execution/NationExecution";
import {
  Cell,
  Doctrine,
  GameMode,
  Nation,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { GameMapType } from "../src/core/game/Maps.gen";
import { scenarioNations } from "../src/core/game/NationCreation";
import { SCENARIOS, scenarioById } from "../src/core/game/Scenarios";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

const MAP_DIRS: Partial<Record<GameMapType, string>> = {
  [GameMapType.Europe]: "europe",
  [GameMapType.World]: "world",
  [GameMapType.China]: "china",
};

function manifestNations(map: GameMapType) {
  const dir = MAP_DIRS[map];
  expect(dir, `no manifest dir for ${map}`).toBeDefined();
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, `../resources/maps/${dir}/manifest.json`),
      "utf8",
    ),
  ) as {
    nations: { name: string; coordinates: [number, number]; flag?: string }[];
  };
  return manifest.nations;
}

/**
 * Historical scenarios (brief §6.7): a fixed cast on a map, each nation with
 * a doctrine and, in a team scenario, a bloc.
 */
describe("scenarios", () => {
  it("every cast member is on its map's manifest, and blocs are in range", () => {
    for (const sc of SCENARIOS) {
      const names = new Set(manifestNations(sc.map).map((m) => m.name));
      for (const sn of sc.nations) {
        expect(
          names.has(sn.manifestName ?? sn.name),
          `${sc.id}: ${sn.manifestName ?? sn.name}`,
        ).toBe(true);
        if (sc.blocKeys.length === 0) expect(sn.bloc).toBeUndefined();
        else expect(sn.bloc).toBeLessThan(sc.blocKeys.length);
      }
      expect(new Set(sc.nations.map((sn) => sn.name)).size).toBe(
        sc.nations.length,
      );
    }
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      "ww1",
      "ww2",
      "coldwar",
      "warringstates",
    ]);
  });

  it("builds the cast with the manifest's spawn and flag, the scenario's doctrine and bloc", () => {
    const sc = scenarioById("ww1")!;
    const nations = scenarioNations(
      sc,
      manifestNations(sc.map),
      new PseudoRandom(1),
    );
    expect(nations).toHaveLength(sc.nations.length);
    const germany = nations.find((n) => n.playerInfo.name === "Germany")!;
    expect(germany.doctrine).toBe(Doctrine.Industrial);
    expect(germany.playerInfo.teamIndex).toBe(1);
    expect(germany.playerInfo.nationFlag).toBe("de");
    expect(germany.spawnCell).toBeDefined();
    const france = nations.find((n) => n.playerInfo.name === "France")!;
    expect(france.playerInfo.teamIndex).toBe(0);
    // Warring States: a kingdom wears a province's spawn under its own name.
    const ws = scenarioById("warringstates")!;
    const qin = scenarioNations(
      ws,
      manifestNations(ws.map),
      new PseudoRandom(1),
    ).find((n) => n.playerInfo.name === "Qin")!;
    expect(qin.playerInfo.teamIndex).toBeNull();
    expect(qin.doctrine).toBe(Doctrine.Expansionist);
    expect(qin.spawnCell).toBeDefined();
  });

  it("a nation spawned with a scenario doctrine keeps it", async () => {
    const game = await setup(
      "plains",
      { gameMode: GameMode.FFA },
      [],
      undefined,
      undefined,
      false,
    );
    const info = new PlayerInfo("Qin", PlayerType.Nation, null, "qin");
    const nation = new Nation(new Cell(50, 50), info, Doctrine.Fortress);
    game.addPlayer(info);
    game.addExecution(new NationExecution("test", nation));
    for (let i = 0; i < 10 && !game.player("qin").isAlive(); i++) {
      game.executeNextTick();
    }
    expect(game.player("qin").isAlive()).toBe(true);
    expect(game.player("qin").doctrine()).toBe(Doctrine.Fortress);
  });

  it("an unknown id is no scenario", () => {
    expect(scenarioById("atlantis")).toBeNull();
    expect(scenarioById(undefined)).toBeNull();
  });
});
