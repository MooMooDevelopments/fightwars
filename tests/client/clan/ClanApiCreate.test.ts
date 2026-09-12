import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

import {
  CLAN_DESCRIPTION_MAX,
  CLAN_NAME_MAX,
  CLAN_TAG_RE,
  createClan,
} from "../../../src/client/ClanApi";

const CLAN = {
  tag: "FWX",
  name: "Testers",
  description: "",
  memberCount: 1,
  isOpen: true,
  discordUrl: null,
  createdAt: "2026-09-12T00:00:00.000Z",
};

const mockFetch = (impl: (...args: unknown[]) => unknown) =>
  vi.stubGlobal("fetch", vi.fn(impl));

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("createClan", () => {
  it("posts the form and returns the created clan", async () => {
    const fetchSpy = vi.fn(() => ({
      ok: true,
      status: 201,
      json: async () => CLAN,
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await createClan({
      tag: "FWX",
      name: "Testers",
      description: "hello",
      isOpen: false,
      discordUrl: "https://discord.gg/abc",
    });

    expect(result).toMatchObject({ tag: "FWX", name: "Testers" });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/clans");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      tag: "FWX",
      name: "Testers",
      description: "hello",
      isOpen: false,
      discordUrl: "https://discord.gg/abc",
    });
  });

  // Every rejection the player can act on gets its own message. A single
  // "failed" would leave them retyping the same form with nothing to change.
  it.each([
    [409, { error: "tag taken" }, "clan_modal.create_tag_taken"],
    [409, { error: "already in a clan" }, "clan_modal.create_already_member"],
    [400, { code: "TAG_INVALID" }, "clan_modal.create_tag_bad"],
    [400, { code: "DISCORD_INVALID" }, "clan_modal.discord_invalid"],
    [400, {}, "clan_modal.error_failed"],
    [401, {}, "clan_modal.create_sign_in"],
    [403, {}, "clan_modal.create_sign_in"],
    [500, {}, "clan_modal.error_failed"],
  ])("maps %i %o to %s", async (status, body, expected) => {
    mockFetch(() => ({ ok: false, status, json: async () => body }));
    expect(await createClan({ tag: "FWX", name: "Testers" })).toEqual({
      error: expected,
    });
  });

  it("reports a network failure rather than throwing", async () => {
    mockFetch(() => {
      throw new Error("offline");
    });
    expect(await createClan({ tag: "FWX", name: "Testers" })).toEqual({
      error: "clan_modal.error_network",
    });
  });

  it("rejects a response that is not a clan", async () => {
    mockFetch(() => ({
      ok: true,
      status: 201,
      json: async () => ({ tag: "FWX" }),
    }));
    expect(await createClan({ tag: "FWX", name: "Testers" })).toEqual({
      error: "clan_modal.error_failed",
    });
  });
});

describe("clan form rules mirror the server", () => {
  // src/api/ClanRoutes.ts: TAG_RE, NAME_MAX, DESCRIPTION_MAX. If the server
  // moves, this fails and the form gets fixed with it rather than quietly
  // accepting input the server will reject.
  it("uses the server's tag pattern", () => {
    for (const good of ["ab", "AB", "A1", "abcde", "12345"]) {
      expect(CLAN_TAG_RE.test(good)).toBe(true);
    }
    for (const bad of ["a", "abcdef", "a-b", "ab ", "", "a_b", "áb"]) {
      expect(CLAN_TAG_RE.test(bad)).toBe(false);
    }
  });

  it("uses the server's length caps", () => {
    expect(CLAN_NAME_MAX).toBe(35);
    expect(CLAN_DESCRIPTION_MAX).toBe(200);
  });
});
