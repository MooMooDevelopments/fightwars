import {
  STEP_DONE_LINGER_TICKS,
  TUTORIAL_STEPS,
  TutorialContext,
  TutorialProgress,
} from "../src/client/hud/Tutorial";

function ctx(overrides: Partial<TutorialContext> = {}): TutorialContext {
  return {
    hasSpawned: false,
    inSpawnPhase: false,
    attacking: false,
    attackRatioMoved: false,
    boatsDisabled: false,
    boatSent: false,
    botsExist: true,
    nationsExist: true,
    alliancesDisabled: false,
    allied: false,
    gold: 0n,
    cityCost: null,
    cityDisabled: false,
    cities: 0,
    portDisabled: false,
    ports: 0,
    defensePostDisabled: false,
    defensePosts: 0,
    factoryDisabled: false,
    factories: 0,
    warshipDisabled: false,
    warships: 0,
    siloDisabled: false,
    silos: 0,
    atomDisabled: false,
    siloReady: false,
    atomLaunched: false,
    hydrogenDisabled: false,
    mirvDisabled: false,
    samDisabled: false,
    ...overrides,
  };
}

// Feed the same context until the completed step has lingered and advanced.
function settle(progress: TutorialProgress, c: TutorialContext) {
  for (let i = 0; i <= STEP_DONE_LINGER_TICKS; i++) progress.update(c);
}

/**
 * The arc itself, as a contract.
 *
 * The brief asks for ninety seconds: spawn, expand, set your ratio, build
 * something, make an ally, then out into a real game. This list was 22 steps
 * ending at MIRV and SAM. If it grows back, that is a product decision, and
 * this test is where it has to be made deliberately rather than by adding
 * "just one more" step.
 */
describe("the tutorial's arc", () => {
  it("is the five beats and the hand-off, in order", () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
      "spawn",
      "attack_wilderness",
      "attack_ratio",
      "buy_city",
      "propose_alliance",
      "whats_next",
    ]);
  });

  it("asks the player to build exactly one thing", () => {
    // Every other structure and weapon is in the help panel. A second build
    // step is a manual growing back inside the onboarding.
    const builds = TUTORIAL_STEPS.filter((s) => s.unit !== undefined);
    expect(builds).toHaveLength(1);
    expect(builds[0].id).toBe("buy_city");
  });

  it("ends on something the player has to read, not a checkmark", () => {
    const last = TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1];
    expect(last.id).toBe("whats_next");
    expect(last.manual).toBe(true);
  });
});

describe("TutorialProgress", () => {
  it("walks the steps in order as the player acts", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    expect(p.current()?.id).toBe("spawn");
    expect(p.stepDone()).toBe(false);

    p.update(ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("spawn");
    expect(p.stepDone()).toBe(true);

    settle(p, ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");

    settle(p, ctx({ hasSpawned: true, attacking: true }));
    expect(p.current()?.id).toBe("attack_ratio");

    // Completed by moving the slider, which only shows up for a single tick.
    p.update(
      ctx({ hasSpawned: true, attacking: true, attackRatioMoved: true }),
    );
    expect(p.stepDone()).toBe(true);
    settle(p, ctx({ hasSpawned: true, attacking: true }));
    expect(p.current()?.id).toBe("buy_city");

    settle(p, ctx({ hasSpawned: true, attacking: true, cities: 1 }));
    expect(p.current()?.id).toBe("propose_alliance");

    settle(p, ctx({ hasSpawned: true, cities: 1, allied: true }));
    expect(p.current()?.id).toBe("whats_next");
  });

  it("holds the spawn step until the multiplayer spawn timer ends", () => {
    const p = new TutorialProgress();
    // Spot picked, but the spawn phase is still running: stay put.
    for (let i = 0; i < 100; i++) {
      p.update(ctx({ hasSpawned: true, inSpawnPhase: true }));
    }
    expect(p.current()?.id).toBe("spawn");
    expect(p.stepDone()).toBe(false);

    settle(p, ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");
  });

  it("lingers on a completed step before advancing", () => {
    const p = new TutorialProgress();
    p.update(ctx({ hasSpawned: true }));
    for (let i = 1; i < STEP_DONE_LINGER_TICKS; i++) {
      p.update(ctx({ hasSpawned: true }));
      expect(p.current()?.id).toBe("spawn");
    }
    p.update(ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");
  });

  it("only advances the hand-off on acknowledge", () => {
    const first = TUTORIAL_STEPS.findIndex((s) => s.id === "whats_next");
    const p = new TutorialProgress(TUTORIAL_STEPS.slice(first));
    const c = ctx({ hasSpawned: true, cities: 1, allied: true });
    p.update(c);
    expect(p.current()?.id).toBe("whats_next");

    // Nothing the player does in the game moves past it.
    for (let i = 0; i < 100; i++) p.update(c);
    expect(p.current()?.id).toBe("whats_next");
    expect(p.stepDone()).toBe(false);

    p.acknowledge();
    expect(p.stepDone()).toBe(true);
    settle(p, c);
    expect(p.finished()).toBe(true);
  });

  it("ignores acknowledge on action steps", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    p.acknowledge();
    expect(p.stepDone()).toBe(false);
  });

  it("skips steps that do not apply to the game and counts only the rest", () => {
    const p = new TutorialProgress();
    const c = ctx({
      hasSpawned: true,
      attacking: true,
      nationsExist: false,
      cityDisabled: true,
    });
    // The city and the alliance drop out; spawn, expand, ratio and the
    // hand-off always apply.
    expect(p.total(c)).toBe(TUTORIAL_STEPS.length - 2);

    settle(p, c);
    settle(p, c);
    expect(p.current()?.id).toBe("attack_ratio");
    expect(p.position(c)).toBe(3);

    p.update({ ...c, attackRatioMoved: true });
    settle(p, c);
    expect(p.current()?.id).toBe("whats_next");
    expect(p.position(c)).toBe(4);

    p.acknowledge();
    settle(p, c);
    expect(p.finished()).toBe(true);
    expect(p.current()).toBeNull();
  });

  it("gates the build step on the city existing, not on the gold", () => {
    const p = new TutorialProgress([
      TUTORIAL_STEPS.find((s) => s.id === "buy_city")!,
    ]);
    // Rich, but nothing built: the step stands. (The panel shows the
    // earn-gold text until the city is affordable; that is its own concern.)
    p.update(ctx({ gold: 500_000n, cityCost: 125_000n }));
    expect(p.stepDone()).toBe(false);

    // Spending the gold elsewhere does not complete it; the city does.
    p.update(ctx({ gold: 0n, cityCost: 125_000n }));
    expect(p.stepDone()).toBe(false);
    p.update(ctx({ gold: 0n, cityCost: 250_000n, cities: 1 }));
    expect(p.stepDone()).toBe(true);
  });

  it("asks for an alliance after the city, and skips it without nations", () => {
    const first = TUTORIAL_STEPS.findIndex((s) => s.id === "propose_alliance");
    const p = new TutorialProgress(TUTORIAL_STEPS.slice(first));
    p.update(ctx());
    expect(p.current()?.id).toBe("propose_alliance");
    expect(p.current()?.highlight).toBe("nation");

    settle(p, ctx({ allied: true }));
    expect(p.current()?.id).toBe("whats_next");

    // Without nations (or with alliances off) the step is skipped entirely.
    const q = new TutorialProgress(TUTORIAL_STEPS.slice(first));
    q.update(ctx({ nationsExist: false }));
    expect(q.current()?.id).toBe("whats_next");
  });
});

describe("TutorialProgress.skip", () => {
  it("moves past the current step without completing it", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    expect(p.current()?.id).toBe("spawn");

    p.skip();
    expect(p.stepDone()).toBe(false);
    p.update(ctx());
    expect(p.current()?.id).toBe("attack_wilderness");

    p.skip();
    p.update(ctx());
    expect(p.current()?.id).toBe("attack_ratio");

    // Skipping lands on the next *applicable* step.
    p.skip();
    p.update(ctx({ cityDisabled: true }));
    expect(p.current()?.id).toBe("propose_alliance");
  });

  it("can skip through to the end", () => {
    const p = new TutorialProgress();
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) p.skip();
    p.update(ctx());
    expect(p.finished()).toBe(true);
    p.skip();
    expect(p.finished()).toBe(true);
  });
});

describe("TutorialProgress step counter", () => {
  it("does not shrink when bots or nations die off mid-tutorial", () => {
    const p = new TutorialProgress();
    // Pre-spawn ticks (nothing spawned yet) must not freeze the counter.
    p.update(ctx({ botsExist: false, nationsExist: false }));
    const before = ctx({ hasSpawned: true });
    p.update(before);
    const total = p.total(before);
    expect(total).toBe(TUTORIAL_STEPS.length);

    const after = ctx({
      hasSpawned: true,
      botsExist: false,
      nationsExist: false,
    });
    p.update(after);
    expect(p.total(after)).toBe(total);
    expect(p.position(after)).toBeGreaterThanOrEqual(1);
  });
});
