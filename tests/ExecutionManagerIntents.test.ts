import { AllianceExtensionExecution } from "../src/core/execution/alliance/AllianceExtensionExecution";
import { AllianceRejectExecution } from "../src/core/execution/alliance/AllianceRejectExecution";
import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { BreakAllianceExecution } from "../src/core/execution/alliance/BreakAllianceExecution";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { BoatRetreatExecution } from "../src/core/execution/BoatRetreatExecution";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { DeleteUnitExecution } from "../src/core/execution/DeleteUnitExecution";
import { DonateGoldExecution } from "../src/core/execution/DonateGoldExecution";
import { DonateTroopsExecution } from "../src/core/execution/DonateTroopExecution";
import { EmbargoAllExecution } from "../src/core/execution/EmbargoAllExecution";
import { EmbargoExecution } from "../src/core/execution/EmbargoExecution";
import { EmojiExecution } from "../src/core/execution/EmojiExecution";
import { Executor } from "../src/core/execution/ExecutionManager";
import { MarkDisconnectedExecution } from "../src/core/execution/MarkDisconnectedExecution";
import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { NationExecution } from "../src/core/execution/NationExecution";
import { NoOpExecution } from "../src/core/execution/NoOpExecution";
import { PauseExecution } from "../src/core/execution/PauseExecution";
import { QuickChatExecution } from "../src/core/execution/QuickChatExecution";
import { RetreatExecution } from "../src/core/execution/RetreatExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { TargetPlayerExecution } from "../src/core/execution/TargetPlayerExecution";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
import { UpgradeStructureExecution } from "../src/core/execution/UpgradeStructureExecution";
import {
  AllPlayers,
  Game,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { StampedIntent } from "../src/core/Schemas";
import { setup } from "./util/Setup";

// Section 5 of the brief lists the verbs a player has: attack, boat, retreat,
// spawn, build/upgrade/delete, every diplomacy verb, quick chat, emoji,
// pause. They all reach the simulation through one door — Executor.createExec
// turning a stamped intent into an execution. This pins that door: every
// intent type on the wire maps to its execution, and an intent from an
// unknown client is a no-op rather than a crash.

let game: Game;
let executor: Executor;
const ALICE = "cAlice00";
const BOB = "cBob0000";

beforeEach(async () => {
  game = await setup("plains", {}, [
    new PlayerInfo("alice", PlayerType.Human, ALICE, "alice"),
    new PlayerInfo("bob", PlayerType.Human, BOB, "bob"),
  ]);
  executor = new Executor(game, "game_id", ALICE);
});

const stamped = (intent: Record<string, unknown>): StampedIntent =>
  ({ clientID: ALICE, ...intent }) as unknown as StampedIntent;

describe("Executor.createExec maps every wire intent to its execution", () => {
  const tile = () => game.ref(1, 1);

  it.each<[string, () => Record<string, unknown>, unknown]>([
    [
      "attack",
      () => ({ type: "attack", troops: 100, targetID: "bob" }),
      AttackExecution,
    ],
    [
      "cancel_attack",
      () => ({ type: "cancel_attack", attackID: "a1" }),
      RetreatExecution,
    ],
    [
      "cancel_boat",
      () => ({ type: "cancel_boat", unitID: 7 }),
      BoatRetreatExecution,
    ],
    [
      "move_warship",
      () => ({ type: "move_warship", unitIds: [1], tile: tile() }),
      MoveWarshipExecution,
    ],
    ["spawn", () => ({ type: "spawn", tile: tile() }), SpawnExecution],
    [
      "boat",
      () => ({ type: "boat", dst: tile(), troops: 50 }),
      TransportShipExecution,
    ],
    [
      "allianceRequest",
      () => ({ type: "allianceRequest", recipient: "bob" }),
      AllianceRequestExecution,
    ],
    [
      "allianceReject",
      () => ({ type: "allianceReject", requestor: "bob" }),
      AllianceRejectExecution,
    ],
    [
      "breakAlliance",
      () => ({ type: "breakAlliance", recipient: "bob" }),
      BreakAllianceExecution,
    ],
    [
      "allianceExtension",
      () => ({ type: "allianceExtension", recipient: "bob" }),
      AllianceExtensionExecution,
    ],
    [
      "targetPlayer",
      () => ({ type: "targetPlayer", target: "bob" }),
      TargetPlayerExecution,
    ],
    [
      "emoji",
      () => ({ type: "emoji", recipient: AllPlayers, emoji: 0 }),
      EmojiExecution,
    ],
    [
      "donate_troops",
      () => ({ type: "donate_troops", recipient: "bob", troops: 10 }),
      DonateTroopsExecution,
    ],
    [
      "donate_gold",
      () => ({ type: "donate_gold", recipient: "bob", gold: 10 }),
      DonateGoldExecution,
    ],
    [
      "embargo",
      () => ({ type: "embargo", targetID: "bob", action: "start" }),
      EmbargoExecution,
    ],
    [
      "embargo_all",
      () => ({ type: "embargo_all", action: "start" }),
      EmbargoAllExecution,
    ],
    [
      "build_unit",
      () => ({ type: "build_unit", unit: UnitType.City, tile: tile() }),
      ConstructionExecution,
    ],
    [
      "upgrade_structure",
      () => ({ type: "upgrade_structure", unitId: 3 }),
      UpgradeStructureExecution,
    ],
    [
      "delete_unit",
      () => ({ type: "delete_unit", unitId: 3 }),
      DeleteUnitExecution,
    ],
    [
      "quick_chat",
      () => ({
        type: "quick_chat",
        recipient: "bob",
        quickChatKey: "greet.hello",
      }),
      QuickChatExecution,
    ],
    [
      "mark_disconnected",
      () => ({ type: "mark_disconnected", isDisconnected: true }),
      MarkDisconnectedExecution,
    ],
    [
      "toggle_pause",
      () => ({ type: "toggle_pause", paused: true }),
      PauseExecution,
    ],
  ])("%s", (_type, intent, cls) => {
    expect(executor.createExec(stamped(intent()))).toBeInstanceOf(
      cls as new (...args: never[]) => unknown,
    );
  });

  it("turns a whole turn into one execution per intent", () => {
    const execs = executor.createExecs({
      turnNumber: 5,
      intents: [
        stamped({ type: "emoji", recipient: AllPlayers, emoji: 0 }),
        stamped({ type: "targetPlayer", target: "bob" }),
      ],
    });
    expect(execs).toHaveLength(2);
    expect(execs[0]).toBeInstanceOf(EmojiExecution);
    expect(execs[1]).toBeInstanceOf(TargetPlayerExecution);
  });

  it("replaces an intent from a client that is not in the game with a no-op", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const exec = executor.createExec(
      stamped({
        clientID: "cNobody0",
        type: "emoji",
        recipient: AllPlayers,
        emoji: 0,
      }),
    );
    expect(exec).toBeInstanceOf(NoOpExecution);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("rejects an intent type it does not know", () => {
    expect(() => executor.createExec(stamped({ type: "teleport" }))).toThrow(
      /not found/,
    );
  });

  it("spawns every human and one execution per nation", () => {
    const spawns = executor.spawnPlayers();
    expect(spawns).toHaveLength(2);
    for (const s of spawns) expect(s).toBeInstanceOf(SpawnExecution);
    const nations = executor.nationExecutions();
    expect(nations).toHaveLength(game.nations().length);
    for (const n of nations) expect(n).toBeInstanceOf(NationExecution);
  });
});
