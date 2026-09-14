import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/DesktopPresence", () => ({
  desktopPresence: {
    isAvailable: vi.fn(() => false),
    openInviteDialog: vi.fn(async () => true),
    set: vi.fn(),
    consumePendingInvite: vi.fn(async () => null),
    subscribeInvites: vi.fn(() => () => undefined),
  },
}));

import { HostLobbyModal } from "../../src/client/HostLobbyModal";

/** The host's custom-rules editor: JSON in, a ruleset out, typos refused. */
describe("rules editor", () => {
  it("applies a valid ruleset and pushes it", () => {
    const modal = new HostLobbyModal() as any;
    modal.putGameConfig = vi.fn();
    modal.rulesText = JSON.stringify({
      version: 1,
      values: [{ key: "supplyMaxRange", value: 200 }],
    });
    modal.applyRules();
    expect(modal.rulesError).toBeNull();
    expect(modal.ruleset).toEqual({
      version: 1,
      values: [{ key: "supplyMaxRange", value: 200 }],
    });
    expect(modal.putGameConfig).toHaveBeenCalledOnce();
    modal.resetRules();
    expect(modal.ruleset).toBeNull();
    expect(modal.putGameConfig).toHaveBeenCalledTimes(2);
  });

  it("refuses bad JSON, a wrong shape and an unknown key without pushing", () => {
    const modal = new HostLobbyModal() as any;
    modal.putGameConfig = vi.fn();
    modal.rulesText = "{not json";
    modal.applyRules();
    expect(modal.rulesError).not.toBeNull();
    modal.rulesText = JSON.stringify({ version: 2, values: [] });
    modal.applyRules();
    expect(modal.rulesError).not.toBeNull();
    modal.rulesText = JSON.stringify({
      version: 1,
      values: [{ key: "supplyMaxRnge", value: 200 }],
    });
    modal.applyRules();
    expect(modal.rulesError).toContain("host_modal.rules_unknown");
    expect(modal.ruleset).toBeNull();
    expect(modal.putGameConfig).not.toHaveBeenCalled();
  });
});
