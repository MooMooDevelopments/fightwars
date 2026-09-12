# FightWars Build State

Last session: 2026-09-12 (session 2) | Current phase: 2 | Build status: green

Repo: `C:\Users\disbo\dev\fightwars` · `upstream` = openfrontio/OpenFrontIO (forked at
`c77005586`, rebased onto `7d95251f1` the same day) · `origin` = github.com/MooMooDevelopments/fightwars
(public since the end of session 1).

Gates (run all before advancing; every one was green at the end of session 1):

```
npm test                      # full suite incl. the determinism gate (~2 min)
npm run test:determinism      # the gate alone, quick mode (~17 s)
npm run test:determinism:full # 24000-tick world match, 150 bots, 8 humans (~3.5 min)
npm run lint && npx prettier --check . && npx tsc --noEmit
npm run licenses:check        # every prod dependency AGPL-compatible
npm run perf:gate             # headless sim budgets (world, 150 bots)
```

Dev server: `npm run dev` → http://localhost:9000 (Vite). In the Claude desktop session the
launch config `fightwars-dev` (session `.claude/launch.json`) starts it. Load harness against
it: `npm run load:test -- --clients 150 --map world --turns 600`.

## Done

- [x] Phase 0: audit — `docs/MECHANICS.md`, determinism gate, solo match won in the client,
      two-window private lobby verified in lockstep (see session-1 notes below).
- [x] Phase 1: brand extracted to `src/brand/Brand.ts`; every product string, logo, community
      link, telemetry name, desktop identifier and monetisation switch reads from it
      (`tests/Brand.test.ts` enforces it).
- [x] Phase 1: all 17 all-rights-reserved `proprietary/` assets removed and replaced (SVG
      wordmarks, favicon, PNG app icons generated in Node, Overpass as display font, synthesised
      lobby-start chime, no music). Overlay removed from vite/Dockerfile/tsconfig.
- [x] Phase 1: licence compliance — AGPL §7(b) copyright in footer + loading screen, §7(c)
      "Based on OpenFront" on the title screen, §13 source link in footer + Help/About;
      `LICENSING.md` Phase 6 entry; `README.md` rewritten; dependency licence gate
      (`scripts/checkLicenses.ts`, 181 prod packages, all compatible).
- [x] Phase 1: ads, ad-block gate, tracking beacons and store/Steam prompts removed or gated
      off (`index.html` clean; `Admiral.ts` deleted).
- [x] Phase 1: CI — `ci.yml` runs build, tests+coverage, determinism (quick on push, full
      nightly), perf gate, licence gate, lint, prettier, gen-maps. Upstream deploy/release/bot
      workflows and their scripts deleted.
- [x] Phase 2: load harness `tests/load/LoadTest.ts` — 150 real-protocol clients in one lobby
      and a multi-lobby mode; both pass against the dev server.
- [x] Phase 2: desync alerting (`src/server/DesyncAlert.ts`): error log, event counter metric,
      optional `DESYNC_WEBHOOK_URL`. Tested in the turn loop.
- [x] Phase 2: replay persistence (`src/server/ReplayStore.ts`): gzip record per game under
      `REPLAY_DIR` (dev default `./replays`), `GET /w<N>/api/replay/:id`, client asks the game
      server first. Verified end to end against the dev server.
- [x] Phase 2: server turn timing + live metrics — `TurnStats` in `GameServer.endTurn()`,
      `GET /w<N>/api/metrics`, dashboard at the master's `/metrics` (dev: http://localhost:3000/metrics).
      Verified under the 150-client load: see numbers below.
- [x] Phase 2: **accounts, ladder and the API service** (`src/api/`, `npm run start:api`, part of
      `npm run dev`): Ed25519 JWTs + JWKS, guest accounts keyed by persistent id with rotating
      refresh cookies, `/users/@me`, `/join_verify`, catalogue stubs, match ingest → Glicko-2
      ladders (ffa/team), `/public/player/:id`, `/public/leaderboard/:ladder`. Postgres via
      `DATABASE_URL`, embedded PGlite otherwise. The game server pushes finished records to it;
      the client mints a guest session on a 401. Verified end to end on the dev stack: guest
      login → JWT join → the server fetched the JWKS and the profile from the API.
- [x] Phase 2: ranked matchmaking queues (`src/api/Matchmaking.ts`): 1v1 and 2v2 over the
      existing client/worker contract; pairing by ladder rating with widening tolerance.
      Tested with real sockets. Not yet exercised in a browser (Ranked needs a JWT, which
      the guest flow now provides — try it next session with two browser profiles).
- [x] Phase 2: player profiles, game history and the ranked leaderboard
      (`src/api/ProfileRoutes.ts`) in the exact shapes the client's Api.ts parses, so the
      in-game profile and leaderboard pages have a backend. Stats tree still empty.
- [x] Phase 2: `docker-compose.yml` (game + api + postgres + redis) — written, **not run**
      (no Docker on the dev box).
- [x] CI is live on GitHub: every job green on the first dispatched run (push-triggered runs
      appear with a few minutes of delay).

## In progress

- [ ] Nothing mid-flight. The tree is committed and green.

## Next up (concrete, ordered)

1. **Rebase check** at session start: `git fetch upstream && git rebase upstream/main`; fix
   conflicts (expect some in `index.html`, nav bars, Footer, SoundManager — the brand sweep
   touched them); rerun all gates.
2. **Phase 2 — finish the accounts backend:** Discord OAuth login attached to the same account
   row (`/auth/discord` — BLOCKED ON A DISCORD APPLICATION CLIENT ID/SECRET, which only the
   owner can create), clans (tables + `/clans/*` matching `ClanApiSchemas.ts`), friends,
   `/public/games` listing per `docs/API.md`, the per-mode stats tree on profiles
   (`PlayerStatsTreeSchema`), ladder seasons, and a browser run of Ranked. Then a
   `PgDb` integration test against a real Postgres in CI (service container).
3. **Phase 2 — run the compose stack** on a box with Docker; fix what breaks; then point the
   desync webhook and the metrics dashboard at real alerting.
4. **Phase 2 — load harness extensions:** `--server-pid` sampling is written but unmeasured;
   add a 500-lobby cluster run (needs multiple workers: the harness already follows
   `workerIndex` from `create_game`).
5. Then Phase 3 (parity and repair) and on. Before Phase 4, load `frontend-design` for the
   visual identity — the placeholder wordmark is deliberately plain.

## Decisions made (never re-litigate these)

- 2026-09-12 — Repo lives at `~/dev/fightwars`, not under OneDrive.
- 2026-09-12 — GitHub remote is `MooMooDevelopments/fightwars` (only account available).
- 2026-09-12 — Determinism gate = record + two replays in separate processes with a SHA-256
  over every player, unit and tile every 100 ticks (upstream's `hash()` is too weak). Quick
  mode under `npm test`; full match as a separate script and nightly in CI.
- 2026-09-12 — The brief's "72% to win", "Port 20 s", "MIRV 35M", "SAM probability" and
  "Fast speed" do not match the code; code values are the baseline (`docs/MECHANICS.md`).
  Rebalancing is Phase 5.
- 2026-09-12 — Upstream uses Vite (port 9000), not Webpack. Brief is wrong; no action.
- 2026-09-12 — Display font is Overpass (already in `resources/`, open) until Phase 4 picks
  the final condensed face. Music playlist is empty until CC-licensed tracks exist.
- 2026-09-12 — Server-rendered logo slots point at SVGs (`BRAND.assets.logoPng` is an SVG);
  node-canvas is not built under `--ignore-scripts`, so rasters are generated with the
  pure-Node PNG encoder in the session notes, only where PNG is mandatory (PWA icons).
- 2026-09-12 — Desktop-shell identifiers are `window.fightwarsDesktop` / `app://fightwars`.
  No FightWars desktop shell exists; the code path stays for later.
- 2026-09-12 — CrazyGames SDK script stays (distribution platform, not ads); Turnstile stays.
- 2026-09-12 — Upstream's PR-gate / issue-lifecycle bots and their scripts are gone; we do
  not run their process.
- 2026-09-12 — The API is a second process in this repo (`src/api/`), not a separate repo, and
  runs on 8787 because that is the issuer the game server already derives for `DOMAIN=localhost`.
- 2026-09-12 — Ladder rating is Glicko-2 (tau 0.5) with one rating period per match: the winner
  beats everyone, non-winners draw each other (records carry no finer placement). Guests
  without a persistent id are stored but never rated.
- 2026-09-12 — Dev/test database is PGlite (Postgres in WASM), production is node-postgres;
  same SQL, one adapter (`src/api/Db.ts`).
- 2026-09-12 — After every rebase on upstream, `origin/main` is force-pushed
  (`--force-with-lease`): the branch is ours and the brief mandates the rebase.

## Known broken / deferred

- `BRAND.siteUrl` is empty: canonical/og:url tags are omitted until a production domain
  exists. `og:image` still points at upstream's gameplay screenshot (CC BY-SA, but shows
  OpenFront chrome) — replace in Phase 4.
- `win_modal.support_openfront` is the one locale key still carrying the upstream name
  (keys are frozen for Crowdin compatibility; value says FightWars).
- `tests/client/InventoryModal.test.ts` and `MainInitialize.test.ts` time out under heavy CPU
  contention (e.g. with the dev stack running); both pass alone. Run `npm test` on a quiet box.
- `.gitmodules` references a `gatekeeper` submodule path that does not exist — stale
  upstream file, harmless.
- Two browser tabs in one profile share `localStorage`; for a two-window test override
  `Storage.prototype.getItem` for `player_persistent_id`/`username` in the second tab.
- Client fps on a real GPU not measured (sandbox browser is software-rendered).
- Ranked/matchmaking, cosmetics, auth and stats are non-functional without the closed API
  (`docs/MECHANICS.md` §06.9) — Phase 2 item 4.

## Numbers last measured (2026-09-12, this machine, upstream 7d95251f1 + Phase 1)

- Determinism test: **pass** — quick 3/3 in ~17 s; full (world, 150 bots, 8 humans,
  24 000 ticks, 5 processes) 3/3 in 206 s.
- `npm test`: 451 + 63 files, 5471 + 655 tests, ~110 s.
- Server tick @150p (`perf:gate`, world, 150 bots, 1000 ticks, client-side sim cost):
  mean 2.6 ms, p95 4.6, p99 6.7, 0 ticks over the 100 ms turn budget. Budgets in
  `scripts/perfGate.ts`: mean ≤ 8, p95 ≤ 20, p99 ≤ 40.
- **Server tick @150p, measured on the server** (`/api/metrics` during the 150-client load,
  world, 600 turns): **mean 1.92 ms, p99 2.83 ms, max 5.3 ms**, 0 turns over the 100 ms
  turn interval, 65 KB/s out for the lobby, worker RSS 123 MB. Target < 8 ms: met.
- Load test (150 clients, world, 600 turns, dev server): **0.72 KB/s down per client**
  (budget 8), turn gap p50 108 ms / p99 115 / max 423, 0 desyncs, 0 errors, 0 rejoins.
  **100 lobbies × 2 clients across both dev workers** (onion, 200 turns, `--workers 2`): every
  lobby in lockstep, 0 desyncs, 0 errors, 0.06 KB/s per client, 24.5 s wall. The brief's 500-lobby
  cluster run needs more workers/hosts than the dev box, not more harness.
- Bundle (`build-prod` → `static/`): JS+CSS 3.3 MB; largest map 14.4 MB; ≈ 18 MB initial
  download incl. the largest map (target < 90 MB). `tsc --noEmit` clean.
- Client fps: not measured.

## Session-1 notes worth keeping

- Solo match to the win condition: Onion map, "You Won!" at tick 18,899 with 208,228 of
  210,555 land tiles. Lessons: attacking at 100% ratio leaves zero defence and a nation
  kills you; the in-game speed panel (▶▶ → Max) makes long matches fast.
- Two-window lobby: game `aeWLK76Jmg`, both clients identical at tick 902 after the host's
  attack; no desync logged. The host's Start button must be the one _inside_
  `host-lobby-modal` (a bare selector picks the singleplayer modal's and starts a solo game).
- Solo modal options are element properties: `single-player-modal.bots/.selectedMap/
.infiniteTroops/.instantBuild/.selectedDifficulty`; start via
  `o-button[translationKey="game_settings.start"] button` inside that modal.
