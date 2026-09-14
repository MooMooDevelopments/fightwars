import { describe, expect, it, vi } from "vitest";
import "../../src/client/components/LobbyPlayerView";
import { GameMode } from "../../src/core/game/Game";
import { ClientInfo, DraftInfo } from "../../src/core/Schemas";

/** The draft board: two sides, the pool, and a Pick button for the captain on turn. */
describe("lobby draft board", () => {
  const clients: ClientInfo[] = [
    { clientID: "hostAAAAA", username: "Host", clanTag: null, teamIndex: 0 },
    { clientID: "playerBBB", username: "Bea", clanTag: null, teamIndex: 1 },
    { clientID: "playerCCC", username: "Cy", clanTag: null },
    { clientID: "playerDDD", username: "Di", clanTag: null },
  ];
  const draft: DraftInfo = {
    captains: ["hostAAAAA", "playerBBB"],
    turn: "hostAAAAA",
    picked: [],
  };

  async function board(currentClientID: string, onDraftPick = vi.fn()) {
    const el = document.createElement("lobby-player-view") as any;
    el.gameMode = GameMode.Team;
    el.clients = clients;
    el.lobbyCreatorClientID = "hostAAAAA";
    el.currentClientID = currentClientID;
    el.teamCount = 2;
    el.draft = draft;
    el.onDraftPick = onDraftPick;
    document.body.appendChild(el);
    await el.updateComplete;
    return { el, onDraftPick };
  }

  it("shows the captain on turn a Pick button on every pooled player", async () => {
    const { el, onDraftPick } = await board("hostAAAAA");
    expect(el.querySelector("[data-draft-board]")).not.toBeNull();
    const picks = [
      ...el.querySelectorAll("[data-draft-pick]"),
    ] as HTMLButtonElement[];
    expect(picks.map((b) => b.dataset.draftPick)).toEqual([
      "playerCCC",
      "playerDDD",
    ]);
    picks[1].click();
    expect(onDraftPick).toHaveBeenCalledWith("playerDDD");
    el.remove();
  });

  it("shows everyone else whose pick it is, and no buttons", async () => {
    const { el } = await board("playerCCC");
    expect(el.querySelectorAll("[data-draft-pick]").length).toBe(0);
    expect(el.querySelector("[data-draft-status]")?.textContent).toContain(
      "host_modal.draft_turn",
    );
    el.remove();
  });
});
