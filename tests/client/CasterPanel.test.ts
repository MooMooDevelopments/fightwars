import { describe, expect, it } from "vitest";
import "../../src/client/hud/layers/CasterPanel";
import { projectWin } from "../../src/client/hud/layers/CasterPanel";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import {
  makeEmptyGu,
  makeGameView,
  makePlayerUpdate,
  stubConfig,
} from "../util/viewStubs";

/** The caster panel: for watchers only, with a projection read off the leader's pace. */
describe("caster panel", () => {
  it("projects the minutes to the bar from the leader's pace", () => {
    // 1% every 5 s toward a 10% bar from 2%: 8% left at 0.2%/s = 40 s.
    expect(projectWin([0.01, 0.02], 5, 0.1)).toBeCloseTo(40 / 60, 5);
    expect(projectWin([0.05, 0.05], 5, 0.1)).toBeNull();
    expect(projectWin([0.06, 0.05], 5, 0.1)).toBeNull();
    expect(projectWin([0.2, 0.3], 5, 0.1)).toBe(0);
    expect(projectWin([0.2], 5, 0.1)).toBeNull();
  });

  function watched(myClientID?: string) {
    const game = makeGameView({
      myClientID,
      config: stubConfig({
        isReplay: () => false,
        percentageTilesOwnedToWin: () => 80,
        gameConfig: () => ({ maxTimerValue: undefined }),
      } as any),
    });
    for (const tick of [50, 100]) {
      const gu = makeEmptyGu(tick);
      if (tick === 50) {
        gu.updates[GameUpdateType.SpawnPhaseEnd] = [
          { type: GameUpdateType.SpawnPhaseEnd, startTick: 50 },
        ];
      }
      gu.updates[GameUpdateType.Player] = [
        makePlayerUpdate({
          id: "alice",
          clientID: "client-a",
          smallID: 1,
          tilesOwned: 10 + tick / 10,
          troops: 500,
          gold: 20n,
        }),
        makePlayerUpdate({
          id: "bob",
          clientID: "client-b",
          smallID: 2,
          tilesOwned: 30,
          troops: 900,
          gold: 5n,
        }),
      ];
      game.update(gu);
    }
    return game;
  }

  it("shows a watcher the projection, the chart and the five largest", async () => {
    const el = document.createElement("caster-panel") as any;
    el.game = watched();
    document.body.appendChild(el);
    el.tick();
    await el.updateComplete;
    expect(el.querySelector("[data-caster-panel]")).not.toBeNull();
    expect(el.querySelector("[data-caster-projection]")?.textContent).toContain(
      "caster.leader",
    );
    expect(
      [...el.querySelectorAll("[data-caster-row]")].map(
        (r: any) => r.dataset.casterRow,
      ),
    ).toEqual(["2", "1"]);
    expect(el.querySelectorAll("path[data-series]").length).toBe(2);
    (el.querySelector("[data-caster-hide]") as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.querySelector("[data-caster-panel]")).toBeNull();
    expect(el.querySelector("[data-caster-show]")).not.toBeNull();
    el.remove();
  });

  it("stays out of a living player's way", async () => {
    const el = document.createElement("caster-panel") as any;
    el.game = watched("client-a");
    document.body.appendChild(el);
    el.tick();
    await el.updateComplete;
    expect(el.querySelector("[data-caster-panel]")).toBeNull();
    el.remove();
  });
});
