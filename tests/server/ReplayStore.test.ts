import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameRecord, GameRecordSchema } from "../../src/core/Schemas";
import { GameEnv } from "../../src/core/configuration/Config";
import {
  FileReplayStore,
  selectReplayStore,
} from "../../src/server/ReplayStore";

// A current-format record: the shape GameServer archives at game end.
function record(gameID = "abCD1234"): GameRecord {
  return GameRecordSchema.parse({
    version: "v0.0.2",
    gitCommit: "0123456789abcdef0123456789abcdef01234567",
    subdomain: "eu1",
    domain: "fightwars.test",
    info: {
      gameID,
      lobbyCreatedAt: 1700000000000,
      start: 1700000001000,
      end: 1700000002000,
      duration: 1000,
      num_turns: 2,
      lobbyFillTime: 5000,
      winner: ["player", gameID],
      config: {
        gameMap: "Africa",
        difficulty: "Medium",
        donateGold: true,
        donateTroops: true,
        gameType: "Private",
        gameMode: "Free For All",
        gameMapSize: "Normal",
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        nations: "disabled",
      },
      players: [
        {
          clientID: gameID,
          username: "NormalName",
          clanTag: "ABC",
          persistentID: null,
          stats: { conquests: ["1", "2", "0"] },
        },
      ],
    },
    turns: [
      { turnNumber: 0, intents: [] },
      {
        turnNumber: 1,
        intents: [{ type: "spawn", tile: 4242, clientID: gameID }],
      },
    ],
  });
}

describe("FileReplayStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-replays-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a game record through a gzip file", async () => {
    const store = new FileReplayStore(dir);
    const rec = record();
    await store.save(rec);
    expect(fs.existsSync(path.join(dir, "abCD1234.json.gz"))).toBe(true);
    // Kilobytes, not megabytes: the record is the intent log, not the state.
    expect(fs.statSync(path.join(dir, "abCD1234.json.gz")).size).toBeLessThan(
      4096,
    );
    const back = await store.load("abCD1234");
    expect(back).toEqual(rec);
    expect(back?.info.players[0].stats?.conquests).toEqual([1n, 2n, 0n]);
    expect(back?.turns[1].intents[0]).toMatchObject({
      type: "spawn",
      tile: 4242,
    });
  });

  it("returns null for a game it never stored", async () => {
    const store = new FileReplayStore(dir);
    expect(await store.load("zzzzzzzz")).toBeNull();
  });

  it("refuses ids that could escape the directory", async () => {
    const store = new FileReplayStore(dir);
    await expect(store.load("../etc" as string)).rejects.toThrow(
      /invalid game id/,
    );
  });

  it("creates the directory on first save", async () => {
    const nested = path.join(dir, "a", "b");
    const store = new FileReplayStore(nested);
    await store.save(record("abCD5678"));
    expect(await store.load("abCD5678")).toEqual(record("abCD5678"));
  });
});

describe("selectReplayStore()", () => {
  it("uses a file store at REPLAY_DIR when set", () => {
    const dir = path.join(os.tmpdir(), "fw-replay-dir");
    const store = selectReplayStore({ REPLAY_DIR: dir }, GameEnv.Prod);
    expect(store.kind).toBe("file");
    expect((store as FileReplayStore).dir).toBe(path.resolve(dir));
  });

  it("uses a file store in dev when REPLAY_DIR is unset", () => {
    expect(selectReplayStore({}, GameEnv.Dev).kind).toBe("file");
  });

  it("uses the API store outside dev when REPLAY_DIR is unset", () => {
    expect(selectReplayStore({}, GameEnv.Prod).kind).toBe("api");
    expect(selectReplayStore({ REPLAY_DIR: "" }, GameEnv.Preprod).kind).toBe(
      "api",
    );
  });
});
