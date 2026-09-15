import { describe, expect, it } from "vitest";
import "../../src/client/components/ChallengeList";
import { ChallengeProgress } from "../../src/core/ApiSchemas";

/** The challenges panel: two groups, a bar each, done said plainly. */
describe("challenge list", () => {
  const rows: ChallengeProgress[] = [
    {
      id: "daily_win",
      period: "daily",
      nameKey: "challenge.daily_win",
      target: 1,
      progress: 1,
      completed: true,
    },
    {
      id: "daily_build",
      period: "daily",
      nameKey: "challenge.daily_build",
      target: 20,
      progress: 5,
      completed: false,
    },
    {
      id: "weekly_wins",
      period: "weekly",
      nameKey: "challenge.weekly_wins",
      target: 5,
      progress: 0,
      completed: false,
    },
  ];

  async function panel(challenges: ChallengeProgress[]) {
    const el = document.createElement("challenge-list") as any;
    el.challenges = challenges;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it("groups the live challenges and shows each one's progress", async () => {
    const el = await panel(rows);
    const ids = [...el.querySelectorAll("[data-challenge]")].map(
      (n: any) => n.dataset.challenge,
    );
    expect(ids).toEqual(["daily_win", "daily_build", "weekly_wins"]);
    const statuses = [...el.querySelectorAll("[data-challenge-status]")].map(
      (n: any) => n.textContent.trim(),
    );
    expect(statuses[0]).toBe("challenge.done");
    expect(statuses[1]).toContain("challenge.progress");
    const bars = [...el.querySelectorAll("[data-challenge] span span")];
    // The browser normalises the percentage it was given.
    expect((bars[1] as HTMLElement).style.width).toBe("25%");
    expect((bars[2] as HTMLElement).style.width).toBe("0%");
    el.remove();
  });

  it("says so when there are none", async () => {
    const el = await panel([]);
    expect(el.querySelector("[data-challenges-empty]")).not.toBeNull();
    expect(el.querySelector("[data-challenges]")).toBeNull();
    el.remove();
  });
});
