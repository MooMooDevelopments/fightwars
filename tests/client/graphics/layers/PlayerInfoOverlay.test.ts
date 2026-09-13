/**
 * Hovering an owned tile must show the owner's info card, and the name color
 * must reflect the local player's relation to them (friendly = green).
 */

vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  LitElement: class extends EventTarget {
    requestUpdate() {}
  },
  nothing: "",
}));

vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: unknown) => clazz,
  state: () => () => {},
  property: () => () => {},
  query: () => () => {},
}));

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  renderDuration: vi.fn(() => ""),
  renderNumber: vi.fn(() => "0"),
  renderTroops: vi.fn(() => "0"),
  getTranslatedPlayerTeamLabel: vi.fn(() => ""),
  getSvgAspectRatio: vi.fn(() => 1),
}));

vi.mock("../../../../src/client/hud/PlayerIcons", () => ({
  EMOJI_ICON_KIND: "emoji",
  IMAGE_ICON_KIND: "image",
  getFirstPlacePlayer: vi.fn(() => null),
  getPlayerIcons: vi.fn(() => []),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerInfoOverlay } from "../../../../src/client/hud/layers/PlayerInfoOverlay";
import { PlayerType, TerrainType } from "../../../../src/core/game/Game";

// Flattens the mocked-html template tree into one string for assertions.
function flatten(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (Array.isArray(node)) return node.map(flatten).join("");
  if (typeof node === "object" && "strings" in (node as object)) {
    const { strings, values } = node as {
      strings: readonly string[];
      values: unknown[];
    };
    return strings.map((s, i) => s + flatten(values[i])).join("");
  }
  if (typeof node === "object") return "";
  return String(node);
}

describe("PlayerInfoOverlay", () => {
  let overlay: PlayerInfoOverlay;

  const hovered = {
    isPlayer: () => true,
    profile: () => Promise.resolve(null),
    getTraitorRemainingTicks: () => 0,
    outgoingAttacks: () => [],
    troops: () => 100,
    gold: () => 0n,
    type: () => PlayerType.Human,
    team: () => null,
    displayName: () => "Bob",
    cosmetics: {},
    id: () => "bob",
    smallID: () => 2,
  };

  const makeGame = (myPlayer: unknown) => ({
    isValidCoord: () => true,
    ref: () => 42,
    owner: () => hovered,
    myPlayer: () => myPlayer,
    config: () => ({
      isUnitDisabled: () => true,
      maxTroops: () => 1000,
    }),
    teamClanTag: () => undefined,
  });

  beforeEach(() => {
    overlay = new PlayerInfoOverlay();
    overlay.eventBus = { on: vi.fn() } as never;
    overlay.transform = {
      screenToWorldCoordinates: () => ({ x: 5, y: 5 }),
    } as never;
    overlay.init();
  });

  it("shows the hovered player's card with a green name for a friend", () => {
    overlay.game = makeGame({
      isFriendly: () => true,
      isAlliedWith: () => false,
      smallID: () => 1,
    }) as never;

    overlay.maybeShow(10, 10);
    const out = flatten(overlay.render());

    expect(out).toContain("opacity-100 visible");
    expect(out).toContain("Bob");
    expect(out).toContain("text-green-500");
  });

  it("shows a white name when there is no local player", () => {
    overlay.game = makeGame(null) as never;

    overlay.maybeShow(10, 10);
    const out = flatten(overlay.render());

    expect(out).toContain("Bob");
    expect(out).toContain("text-white");
    expect(out).not.toContain("text-green-500");
  });

  it("adds the attack-cost breakdown once a uiState is wired in", () => {
    overlay.game = {
      ...makeGame({
        isFriendly: () => false,
        isAlliedWith: () => false,
        isOnSameTeam: () => false,
        smallID: () => 1,
        troops: () => 10_000,
        numTilesOwned: () => 500,
        type: () => PlayerType.Human,
      }),
      // The shared fixture is only rich enough for the name card; the cost
      // estimate reads the defender's army and territory too.
      owner: () => ({
        ...hovered,
        numTilesOwned: () => 400,
        isTraitor: () => false,
        isDisconnected: () => false,
      }),
      isLand: () => true,
      terrainType: () => TerrainType.Plains,
      hasUnitNearby: () => false,
      hasFallout: () => false,
      numTilesWithFallout: () => 0,
      numLandTiles: () => 1,
      // The supply term reads the hovered tile's neighbours: which of them
      // the player owns, and whether those are inside supply range.
      neighbors: () => [1, 2, 3, 4],
      ownerID: () => 1,
      isSupplied: () => true,
      magnitude: () => 0,
      config: () => ({
        isUnitDisabled: () => true,
        maxTroops: () => 1000,
        defensePostRange: () => 10,
        supplyMaxRange: () => 90,
        attackLogic: (
          _input: unknown,
          out: Record<string, number> | undefined,
        ) => {
          if (out !== undefined) out.troopRatio = 2;
          return {
            attackerTroopLoss: 12,
            defenderTroopLoss: 3,
            tickFraction: 0.5,
          };
        },
      }),
    } as never;
    overlay.uiState = { attackRatio: 0.2 } as never;

    overlay.maybeShow(10, 10);
    const out = flatten(overlay.render());

    expect(out).toContain("attack_cost.title");
    expect(out).toContain("attack_cost.they_outnumber");
  });

  it("still shows the card when no uiState was wired in", () => {
    // The breakdown is an extra; who owns the tile is the point of the card.
    overlay.game = makeGame({
      isFriendly: () => false,
      isAlliedWith: () => false,
      smallID: () => 1,
    }) as never;

    overlay.maybeShow(10, 10);
    const out = flatten(overlay.render());

    expect(out).toContain("Bob");
    expect(out).not.toContain("attack_cost.title");
  });
});
