import { describe, expect, it } from "vitest";
import {
  GameUpdateType,
  ZoneKind,
  ZoneUpdate,
} from "../../../src/core/game/GameUpdates";
import { makeEmptyGu, makeGameView } from "../../util/viewStubs";

/**
 * The mode zones (brief §6.7) ride a GameUpdate from the core to the frame
 * the renderer draws: one live zone per kind, cleared by `active: false`.
 */
describe("GameView zones", () => {
  const zone = (over: Partial<ZoneUpdate>): ZoneUpdate => ({
    type: GameUpdateType.Zone,
    kind: ZoneKind.BattleRoyale,
    x: 5,
    y: 5,
    radius: 4,
    active: true,
    ...over,
  });

  it("starts with none and carries the latest of each kind on the frame", () => {
    const game = makeGameView();
    game.update(makeEmptyGu(1));
    expect(game.frameData().zones).toEqual([]);

    const gu = makeEmptyGu(2);
    gu.updates[GameUpdateType.Zone] = [zone({ radius: 4 })];
    game.update(gu);
    expect(game.frameData().zones).toEqual([
      { kind: ZoneKind.BattleRoyale, x: 5, y: 5, radius: 4 },
    ]);

    const gu2 = makeEmptyGu(3);
    gu2.updates[GameUpdateType.Zone] = [
      zone({ radius: 3 }),
      zone({ kind: ZoneKind.Hill, x: 2, y: 2, radius: 1 }),
    ];
    game.update(gu2);
    expect(game.frameData().zones).toEqual([
      { kind: ZoneKind.BattleRoyale, x: 5, y: 5, radius: 3 },
      { kind: ZoneKind.Hill, x: 2, y: 2, radius: 1 },
    ]);
  });

  it("clears a zone on active: false and keeps the frame's list otherwise", () => {
    const game = makeGameView();
    const gu = makeEmptyGu(1);
    gu.updates[GameUpdateType.Zone] = [zone({})];
    game.update(gu);
    const before = game.frameData().zones;
    game.update(makeEmptyGu(2));
    expect(game.frameData().zones).toBe(before);

    const gu3 = makeEmptyGu(3);
    gu3.updates[GameUpdateType.Zone] = [zone({ active: false })];
    game.update(gu3);
    expect(game.frameData().zones).toEqual([]);
  });
});
