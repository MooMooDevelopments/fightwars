import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameRecord, GameRecordSchema } from "../../src/core/Schemas";
import { postRecordToApi } from "../../src/server/Archive";

// Finished records reach the FightWars API so the ladder updates. The call
// is best-effort: no key means no call, and a failure is logged, not thrown.

function record(): GameRecord {
  return GameRecordSchema.parse({
    version: "v0.0.2",
    gitCommit: "0123456789abcdef0123456789abcdef01234567",
    subdomain: "dev",
    domain: "localhost",
    info: {
      gameID: "abCD1234",
      lobbyCreatedAt: 1700000000000,
      start: 1700000001000,
      end: 1700000002000,
      duration: 1000,
      num_turns: 2,
      lobbyFillTime: 5000,
      winner: ["player", "abCD1234"],
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
          clientID: "abCD1234",
          username: "NormalName",
          clanTag: null,
          persistentID: null,
          stats: { conquests: ["1"] },
        },
      ],
    },
    turns: [{ turnNumber: 0, intents: [] }],
  });
}

describe("postRecordToApi", () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, API_KEY: "k", DOMAIN: "localhost" };
    delete process.env.ARCHIVE_TO_API;
  });
  afterEach(() => {
    process.env = env;
  });

  it("posts the record to the issuer with the api key", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await postRecordToApi(record(), f)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8787/game/abCD1234");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(JSON.parse(init.body as string).info.gameID).toBe("abCD1234");
  });

  it("does nothing without an api key or when disabled", async () => {
    const f = vi.fn(async () => new Response("{}"));
    process.env.API_KEY = "";
    expect(await postRecordToApi(record(), f)).toBe(false);
    process.env.API_KEY = "k";
    process.env.ARCHIVE_TO_API = "false";
    expect(await postRecordToApi(record(), f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("swallows failures", async () => {
    const bad = vi.fn(async () => new Response("no", { status: 500 }));
    expect(await postRecordToApi(record(), bad)).toBe(false);
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await postRecordToApi(record(), down)).toBe(false);
  });
});
