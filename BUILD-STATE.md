# FightWars Build State

Last session: 2026-09-12 (session 1) | Current phase: 1 | Build status: green

Repo: `C:\Users\disbo\dev\fightwars` · `upstream` = openfrontio/OpenFrontIO (forked at
`c77005586`, 2026-09-12) · `origin` = github.com/MooMooDevelopments/fightwars (**private for
now — see Known broken / deferred**).

Gates (run all four before advancing; every one was green at the end of session 1):

```
npm test                      # full suite incl. the determinism gate (~2.5 min; 1 client UI test
                              # file times out under heavy CPU contention — passes in isolation)
npm run test:determinism      # the gate alone, quick mode (~17 s)
npm run test:determinism:full # 24000-tick world match, 150 bots, 8 humans (~3.5 min)
npm run lint && npx prettier --check .
```

Dev server: `npm run dev` → http://localhost:9000 (Vite, not Webpack). In the Claude desktop
session the launch config `fightwars-dev` (in the session's `.claude/launch.json`) starts it.

## Done

- [x] Phase 0: forked, `upstream` remote, deps installed with `npm run inst`, baseline
      `npm test` / lint / prettier all green on upstream `c77005586`.
- [x] Phase 0: mechanics inventory at `docs/MECHANICS.md` (302 KB, six sections, every
      formula with `file:line`, gaps vs the brief with hook points).
- [x] Phase 0: determinism test at `tests/determinism.test.ts` +
      `tests/determinism/DeterminismRunner.ts` — green in quick mode and in full-match mode.
      Two negative controls (different seed diverges; one dropped intent diverges) both pass,
      so the gate has been watched to fail.
- [x] Phase 0: singleplayer match played to the win condition in the real client (Onion map,
      "You Won!" at tick 18,899 holding 208,228 of 210,555 land tiles).
- [x] Phase 0: two-window private lobby works (two clients, distinct persistent IDs, same game
      `aeWLK76Jmg`, identical state on both clients at tick 902 after the host's attack; no
      desync logged by the server).
- [x] `FORK-CHANGES.md`, `BUILD-STATE.md` created.

## In progress

- [ ] Nothing mid-flight. Phase 1 has not started.

## Next up (concrete, ordered)

1. **Phase 1 — rebase check:** `git fetch upstream && git rebase upstream/main` (nothing to
   rebase yet; do it anyway to start the habit, resolve nothing).
2. **Phase 1 — brand module.** Create `src/brand/` (name, tagline, logo paths, favicon,
   colour tokens, footer attribution, repo URL) and route every brand string through it.
   `docs/MECHANICS.md` §06.10 lists the ~52 source files, `index.html`, `manifest.json` and
   28 `en.json` keys that carry "OpenFront". The win modal advertises OpenFront on Steam and
   `src/client/Admiral.ts:45` loads an `introjava.com` ad script — both go.
3. **Phase 1 — replace the 17 `proprietary/` assets** (font, logos, favicon, seven music/SFX
   files). They are all-rights-reserved and may not be used outside OpenFront. Ship
   placeholders under `resources/` (CC BY-SA compatible) until real FightWars art exists;
   remove the `proprietary/` overlay from the build.
4. **Phase 1 — licence compliance.** Keep `LICENSE` (AGPL-3.0) and `LICENSE-ASSETS`; add
   FightWars to `LICENSING.md` timeline; "Based on OpenFront" on the title screen, "©
   OpenFront and Contributors" in footer + loading screen; in-game About panel links to the
   public repo. Add a dependency licence check (`license-checker` or similar) that fails CI on
   anything AGPL-incompatible.
5. **Phase 1 — CI.** `.github/workflows/` runs build, vitest+coverage, lint, prettier, gen-maps
   drift today. Add the determinism gate as its own job (quick mode on every push; full mode
   nightly or on `main`) and a perf job that runs `npm run perf:game` and fails on regression
   against the numbers below.
6. **Phase 1 — flip the repo public** once 2–4 are done (see deferred note).
7. Then Phase 2 (Section 8 infrastructure). Note before starting: auth, stats, cosmetics,
   matchmaking check-in and the match archive all live in OpenFront's closed-source API
   (`docs/MECHANICS.md` §06.9). FightWars needs its own — Postgres + a small API service — and
   the archive path is the only place replays are stored, so replay persistence is Phase 2
   work, not Phase 6.

## Decisions made (never re-litigate these)

- 2026-09-12 — Repo lives at `~/dev/fightwars`, not under OneDrive — node_modules and a
  650 MB git history do not belong in a synced folder.
- 2026-09-12 — GitHub remote is `MooMooDevelopments/fightwars` — the only GitHub account
  available in this environment (no org access).
- 2026-09-12 — Determinism gate is record + two replays in **separate processes** with a
  SHA-256 over every player, unit and tile every 100 ticks, not upstream's `hash()` — upstream's
  hash omits gold, relations, tile identity and the tick (see `docs/MECHANICS.md` §06.8).
- 2026-09-12 — Quick mode of the gate runs under `npm test` (pangaea, 60 bots, 6 humans, 3000
  ticks); the full 24000-tick world match is a separate script — 17 s vs 3.5 min.
- 2026-09-12 — The brief's "72% to win", "Port 20 s build", "MIRV 35M", "SAM interception
  probability" and "Fast speed" do not match the code; the code's values are the baseline and
  are recorded in `docs/MECHANICS.md`. Rebalancing is Phase 5 work, not a Phase 0 fix.
- 2026-09-12 — Upstream uses Vite (port 9000), not Webpack as the brief says. Brief is wrong;
  no action.
- 2026-09-12 — Upstream's `.claude/skills/run-openfront/` Playwright driver is Ubuntu-only
  and its Start-button selector (`single_modal.start`) is stale (`game_settings.start` now).
  In this environment the Browser pane drives the game directly; the modal's options are set
  as element properties (`single-player-modal.bots/.selectedMap/.infiniteTroops/...`).

## Known broken / deferred

- **REPO IS PRIVATE.** AGPL §13 only triggers once players interact over a network, so
  nothing is violated yet, but the brief wants a public repo from day one. Deferred to the end
  of Phase 1 so that the first public commit already carries attribution and no proprietary
  assets. Flip with `gh repo edit MooMooDevelopments/fightwars --visibility public`.
- `tests/client/InventoryModal.test.ts` — 4 tests time out at 5 s when the machine is under
  heavy load (six audit agents + lint in parallel); passes alone in 8.7 s. Not a code bug;
  upstream's timeout is tight. Revisit only if CI flakes.
- `.gitmodules` references `src/server/gatekeeper` but the path does not exist in the tree
  (`git submodule status` is empty) — stale upstream file, harmless.
- The client loads ad-tech (id5, 33across, pubcid, Carbon, cloudflare insights) even in dev
  and fills localStorage with tracking IDs; `Admiral.ts` loads an anti-adblock script. All of
  it goes in Phase 1 (brand/monetisation config) — FightWars has no ads on day one.
- Two browser tabs in one profile share `localStorage`, so a two-window test needs a second
  identity. Working trick: override `Storage.prototype.getItem` for `player_persistent_id`
  and `username` in the second tab before joining.

## Numbers last measured (2026-09-12, upstream c77005586, this machine)

- Determinism test: **pass** — quick mode 3/3 in 16.6 s; full mode (world, 150 bots, 8
  humans, 24 000 ticks, 5 processes) 3/3 in 205.8 s.
- Headless sim throughput (`DeterminismRunner`, one process): onion 3000 ticks 1.2 s;
  pangaea 3.5 s; world (47 players) 6.3 s.
- Server tick @150p: `npm run perf:game -- --map world --bots 150 --ticks 1000` (the sim runs
  client-side; this is the per-tick sim cost) — **mean 2.89 ms, p50 2.55, p95 5.90, p99 8.11,
  max 10.4 ms**, 0 of 1000 ticks over the 100 ms turn budget, 82 MB peak heap, 346 ticks/s.
- Client fps: not measured yet (needs a real GPU; the sandbox browser uses SwiftShader).
- Bundle (`npm run build-prod` → `static/`): JS+CSS **3.3 MB** (index 2.40 MB, worker 0.65 MB,
  CSS 0.21 MB, vendor 0.11 MB); largest map dir 14.4 MB (`sol`); all maps 581 MB. Initial
  download incl. the largest map ≈ 18 MB, under the 90 MB target. `tsc --noEmit` clean.
- `npm test`: 450 files / 5503 tests, 132 s (before the determinism gate was added).
