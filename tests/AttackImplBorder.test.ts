import { AttackImpl } from "../src/core/game/AttackImpl";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameImpl } from "../src/core/game/GameImpl";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";

// The attack record behind every ground attack: its border bookkeeping and
// the front-line representatives the HUD labels (clusteredPositions).

let game: Game;
let attacker: Player;

function attack(border: TileRef[], source: TileRef | null = null): AttackImpl {
  const a = new AttackImpl(
    "attack1",
    game.terraNullius(),
    attacker,
    100,
    source,
    new Set(),
    game as GameImpl,
  );
  for (const t of border) a.addBorderTile(t);
  return a;
}

function square(x0: number, y0: number, size: number): TileRef[] {
  const out: TileRef[] = [];
  for (let x = x0; x < x0 + size; x++) {
    for (let y = y0; y < y0 + size; y++) out.push(game.ref(x, y));
  }
  return out;
}

function inSquare(t: TileRef, x0: number, y0: number, size: number): boolean {
  const x = game.x(t);
  const y = game.y(t);
  return x >= x0 && x < x0 + size && y >= y0 && y < y0 + size;
}

beforeEach(async () => {
  game = await setup("plains", {}, [
    new PlayerInfo("attacker", PlayerType.Human, "cAttack0", "attacker"),
  ]);
  attacker = game.player("attacker");
});

describe("AttackImpl", () => {
  it("counts border tiles once each and forgets them on removal", () => {
    const a = attack([]);
    const t = game.ref(5, 5);
    a.addBorderTile(t);
    a.addBorderTile(t);
    expect(a.borderSize()).toBe(1);
    a.removeBorderTile(t);
    a.removeBorderTile(t);
    expect(a.borderSize()).toBe(0);
    a.addBorderTile(t);
    a.addBorderTile(game.ref(6, 5));
    a.clearBorder();
    expect(a.borderSize()).toBe(0);
  });

  it("clamps troops at zero and unlinks itself from both players on delete", () => {
    const a = attack([]);
    a.setTroops(-5);
    expect(a.troops()).toBe(0);
    expect(a.isActive()).toBe(true);
    a.delete();
    expect(a.isActive()).toBe(false);
    expect(a.retreating()).toBe(false);
    a.orderRetreat();
    expect(a.retreating()).toBe(true);
    a.executeRetreat();
    expect(a.retreated()).toBe(true);
  });

  it("falls back to the source tile (or nothing) when there is no border", () => {
    const src = game.ref(3, 3);
    expect(attack([], src).clusteredPositions()).toEqual([src]);
    expect(attack([], null).clusteredPositions()).toEqual([]);
  });

  it("returns one representative per large front, largest first, at most two", () => {
    const big = square(10, 10, 8); // 64 tiles
    const medium = square(60, 60, 6); // 36 tiles
    const tiny = [game.ref(90, 90), game.ref(91, 90)]; // below the 30 minimum
    const positions = attack([...tiny, ...medium, ...big]).clusteredPositions();
    expect(positions).toHaveLength(2);
    expect(inSquare(positions[0], 10, 10, 8)).toBe(true);
    expect(inSquare(positions[1], 60, 60, 6)).toBe(true);
  });

  it("keeps the largest front even when every front is small", () => {
    const small = square(20, 20, 3); // 9 tiles
    const smaller = [game.ref(70, 70)];
    const positions = attack([...smaller, ...small]).clusteredPositions();
    expect(positions).toHaveLength(1);
    expect(inSquare(positions[0], 20, 20, 3)).toBe(true);
  });

  it("caps the representatives at two fronts", () => {
    const positions = attack([
      ...square(5, 5, 6),
      ...square(40, 40, 6),
      ...square(80, 80, 6),
    ]).clusteredPositions();
    expect(positions).toHaveLength(2);
  });
});
