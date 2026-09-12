import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

/**
 * The account page as FightWars actually ships it: no identity provider is
 * configured, because the API serves no /auth/login/* route. The inherited
 * page showed a sign-in wall whose buttons all pointed at those missing
 * routes; a player with a perfectly good guest account saw four dead options
 * and nothing about the account they already had.
 *
 * The provider screen is still covered, with providers switched on, by
 * AccountModal.rendering.test.ts.
 */

// ─── Mocks (mirrors tests/client/clan/ClanModalTestUtils.ts factories) ──────

vi.mock("../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => false as const),
  invalidateUserMe: vi.fn(),
  fetchPlayerById: vi.fn(async () => null),
  setMarketingConsent: vi.fn(async () => true),
  getApiBase: vi.fn(() => ""),
}));

vi.mock("../../src/client/Auth", () => ({
  discordLogin: vi.fn(),
  googleLogin: vi.fn(),
  linkGoogle: vi.fn(async () => true),
  linkSteam: vi.fn(async () => true),
  steamLogin: vi.fn(),
  logOut: vi.fn(async () => true),
  reauthAfterCrazyGamesChange: vi.fn(async () => false),
  sendMagicLink: vi.fn(async () => true),
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  showToast: vi.fn(),
  getDiscordAvatarUrl: vi.fn(() => null),
  copyToClipboard: vi.fn(),
  renderNumber: vi.fn((n: number) => String(n)),
  getMapName: vi.fn((m: string) => m),
  renderDuration: vi.fn(() => ""),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    getUserProfile: vi.fn(async () => null),
    showAuthPrompt: vi.fn(async () => null),
    isAvailable: false,
  },
}));

vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics: vi.fn(async () => null),
  translateCosmetic: vi.fn((v: unknown) => v),
}));

vi.stubGlobal("localStorage", {
  // The guest's name lives here, not on /users/@me.
  getItem: vi.fn((key: string) => (key === "username" ? "FightWarsTwo" : null)),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
});

import { BRAND } from "../../src/brand/Brand";
import { AccountModal } from "../../src/client/AccountModal";

function guestUserMe(): UserMeResponse {
  return {
    user: {},
    player: {
      publicId: "guest-public-id",
      username: "FightWarsTwo",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
      currency: { soft: 0, hard: 0 },
    },
  } as unknown as UserMeResponse;
}

describe("AccountModal — no identity provider configured", () => {
  let modal: AccountModal;

  beforeEach(async () => {
    if (!customElements.get("account-modal")) {
      customElements.define("account-modal", AccountModal);
    }
    modal = document.createElement("account-modal") as AccountModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  async function openWith(userMe: UserMeResponse | false) {
    const { getUserMe } = await import("../../src/client/Api");
    (
      getUserMe as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue(userMe);
    modal.open();
    await modal.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await modal.updateComplete;
  }

  it("ships with every provider off", () => {
    // The guard this whole file is about. If a provider is ever switched on,
    // its /auth/login route has to exist first.
    expect(BRAND.identity).toEqual({
      discord: false,
      google: false,
      steam: false,
      email: false,
    });
  });

  it("offers no sign-in button that cannot work", async () => {
    await openWith(guestUserMe());
    const text = modal.textContent ?? "";
    expect(text).not.toContain("main.login_google");
    expect(text).not.toContain("main.login_steam");
    expect(text).not.toContain("account_modal.link_discord");
  });

  it("shows the guest account the player already has", async () => {
    await openWith(guestUserMe());
    const text = modal.textContent ?? "";
    expect(text).toContain("account_modal.guest_title");
    // The name comes from local storage — /users/@me has no username for a
    // guest, which is why the first version of this panel rendered a blank
    // NAME row.
    expect(text).toContain("FightWarsTwo");
    expect(text).toContain("guest-public-id");
  });

  it("omits the name row entirely when no name is stored", async () => {
    const storage = localStorage as unknown as {
      getItem: { mockImplementation: (fn: () => null) => void };
    };
    storage.getItem.mockImplementation(() => null);
    await openWith(guestUserMe());
    const text = modal.textContent ?? "";
    expect(text).toContain("account_modal.guest_id");
    expect(text).not.toContain("account_modal.guest_name");
  });

  it("says plainly that the account lives in this browser", async () => {
    // The one real limitation of a session-as-account, and the thing a player
    // needs to know before they clear their site data.
    await openWith(guestUserMe());
    expect(modal.textContent ?? "").toContain("account_modal.guest_warning");
  });

  it("keeps a way to start over", async () => {
    await openWith(guestUserMe());
    expect(modal.textContent ?? "").toContain("account_modal.clear_session");
  });
});
