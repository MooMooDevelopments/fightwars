import { describe, expect, it } from "vitest";
import { MatchTimeline } from "../../../src/client/view/MatchTimeline";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import {
  makeEmptyGu,
  makeGameView,
  makePlayerUpdate,
} from "../../util/viewStubs";

/** The client's record of the game for the report at the end. */
describe("MatchTimeline", () => {
  it("samples on the cadence only, the alive with land", () => {
    const t = new MatchTimeline();
    const players = [
      { smallID: 1, tiles: 10, alive: true },
      { smallID: 2, tiles: 0, alive: true },
      { smallID: 3, tiles: 7, alive: false },
    ];
    t.sample(49, players);
    expect(t.samples).toHaveLength(0);
    t.sample(50, players);
    t.sample(100, [{ smallID: 1, tiles: 12, alive: true }]);
    expect(t.samples.map((s) => s.tick)).toEqual([50, 100]);
    expect([...t.samples[0].tiles.entries()]).toEqual([[1, 10]]);
    expect(t.series([1, 2])).toEqual([
      { smallID: 1, points: [10, 12] },
      { smallID: 2, points: [0, 0] },
    ]);
    expect(t.leaders(5)).toEqual([1]);
  });

  it("ranks the leaders by the last sample, largest first", () => {
    const t = new MatchTimeline();
    t.sample(50, [
      { smallID: 1, tiles: 5, alive: true },
      { smallID: 2, tiles: 50, alive: true },
      { smallID: 3, tiles: 20, alive: true },
    ]);
    expect(t.leaders(2)).toEqual([2, 3]);
  });

  it("is fed by the view: tiles every fifty ticks and every broken alliance", () => {
    const game = makeGameView();
    const at = (tick: number, tiles: number) => {
      const gu = makeEmptyGu(tick);
      gu.updates[GameUpdateType.Player] = [
        makePlayerUpdate({ id: "alice", smallID: 1, tilesOwned: tiles }),
      ];
      return gu;
    };
    game.update(at(50, 4));
    game.update(at(70, 9));
    const gu = at(100, 9);
    gu.updates[GameUpdateType.BrokeAlliance] = [
      {
        type: GameUpdateType.BrokeAlliance,
        traitorID: 1,
        betrayedID: 2,
        allianceID: 7,
      },
    ];
    game.update(gu);
    expect(game.timeline().samples.map((s) => s.tick)).toEqual([50, 100]);
    expect(game.timeline().series([1])[0].points).toEqual([4, 9]);
    expect(game.timeline().breaks).toEqual([
      { tick: 100, traitorID: 1, betrayedID: 2 },
    ]);
  });
});
