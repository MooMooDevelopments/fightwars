import { describe, expect, it } from "vitest";
import "../../src/client/hud/layers/MatchReport";
import {
  fmtShare,
  labelRows,
  REPORT_SERIES_COLORS,
} from "../../src/client/hud/layers/MatchReport";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import { makeEmptyGu, makeGameView, makePlayerUpdate } from "../util/viewStubs";

/** The match report: five series with legend and labels, a table, the tiles. */
describe("match report", () => {
  function playedGame() {
    const game = makeGameView({ myClientID: "client-a" });
    for (const tick of [50, 100, 150]) {
      const gu = makeEmptyGu(tick);
      gu.updates[GameUpdateType.Player] = [
        makePlayerUpdate({
          id: "alice",
          clientID: "client-a",
          smallID: 1,
          tilesOwned: tick / 10,
        }),
        makePlayerUpdate({
          id: "bob",
          clientID: "client-b",
          smallID: 2,
          tilesOwned: 30,
        }),
        makePlayerUpdate({
          id: "cy",
          clientID: "client-c",
          smallID: 3,
          tilesOwned: 20,
        }),
      ];
      if (tick === 150) {
        gu.updates[GameUpdateType.BrokeAlliance] = [
          {
            type: GameUpdateType.BrokeAlliance,
            traitorID: 2,
            betrayedID: 3,
            allianceID: 1,
          },
        ];
      }
      game.update(gu);
    }
    return game;
  }

  it("charts the leaders in fixed colour order with a legend and a table", async () => {
    const el = document.createElement("match-report") as any;
    el.game = playedGame();
    document.body.appendChild(el);
    await el.updateComplete;
    const paths = [
      ...el.querySelectorAll("path[data-series]"),
    ] as SVGPathElement[];
    expect(paths.map((p) => p.dataset.series)).toEqual(["2", "3", "1"]);
    expect(paths.map((p) => p.getAttribute("stroke"))).toEqual(
      REPORT_SERIES_COLORS.slice(0, 3),
    );
    expect(
      el.querySelectorAll("[data-report-legend] span.rounded-full").length,
    ).toBe(3);
    expect(el.querySelector("[data-report-table]")).toBeNull();
    (
      el.querySelector("[data-report-table-toggle]") as HTMLButtonElement
    ).click();
    await el.updateComplete;
    expect(el.querySelectorAll("[data-report-table] tbody tr").length).toBe(3);
    expect(el.querySelector("[data-report-breaks]")?.textContent).toContain(
      "win_modal.betrayed",
    );
    el.remove();
  });

  it("keeps the end labels apart and gives the axis a decimal when the scale is small", () => {
    expect(labelRows([50, 52, 54, 120], 10, 176).map((r) => r.y)).toEqual([
      50, 62, 74, 120,
    ]);
    expect(labelRows([170, 172], 10, 176).map((r) => r.y)).toEqual([164, 176]);
    expect(labelRows([5], 10, 176)[0].y).toBe(10);
    expect(fmtShare(0.004, 0.008)).toBe("0.4%");
    expect(fmtShare(0.25, 0.5)).toBe("25%");
  });

  it("says the game was too short to chart, and that gold comes at the end", async () => {
    const el = document.createElement("match-report") as any;
    el.game = makeGameView({ myClientID: "client-a" });
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.textContent).toContain("win_modal.report_too_short");
    expect(el.querySelector("[data-report-gold]")?.textContent).toContain(
      "win_modal.report_at_end",
    );
    el.remove();
  });
});
