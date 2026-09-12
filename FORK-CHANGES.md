# FORK-CHANGES

Every divergence from `upstream/main` (openfrontio/OpenFrontIO), one line of reasoning each.
New files under `tests/`, `docs/` and the FightWars-only modules are listed once; edits to
shared upstream files are listed individually because each one is a future rebase conflict.

## Shared upstream files edited

- `package.json` — added `test:determinism` and `test:determinism:full` scripts (additive; the
  determinism gate must be runnable by name in CI).

## FightWars-only files added

- `tests/determinism.test.ts`, `tests/determinism/DeterminismRunner.ts` — the determinism gate:
  record + two replays in separate processes, SHA-256 state digest every 100 ticks, two negative
  controls. Runs under `npm test`.
- `FORK-CHANGES.md`, `BUILD-STATE.md`, `docs/MECHANICS.md` — build bookkeeping.

## Phase 1 — foundation (2026-09-12)

### Shared upstream files edited

- `vite.config.ts` — removed the `proprietary/` overlay (`serveProprietaryDir`, `getProprietaryDir`,
  `sourceDirs`); the fork has no all-rights-reserved assets.
- `src/server/PublicAssetManifest.ts` — removed `getProprietaryDir()` for the same reason.
- `Dockerfile` — dropped `COPY proprietary`.
- `tsconfig.json` — dropped `proprietary/**/*` from `include`.
- `package.json` — `name` → `fightwars`; added `licenses:check` and `perf:gate` scripts.
- `README.md`, `LICENSING.md`, `LICENSE-ASSETS` — fork identity, attribution and the Phase 6
  licensing entry. `LICENSE` itself is unchanged (AGPL-3.0 + OpenFront's §7 terms must stay).
- `.github/workflows/ci.yml` — `npm ci --ignore-scripts`; new jobs `determinism` (quick on push,
  full nightly), `perf` and `licenses`.
- `.github/workflows/{deploy,release,pr-*,issue-lifecycle-*,claude-code-review}.yml` — deleted;
  all were guarded by `github.repository == 'openfrontio/OpenFrontIO'` or needed OpenFront's
  secrets and Hetzner hosts.
- `resources/icons/icon512_*.png`, `resources/images/Favicon.svg` — replaced with FightWars marks
  (CC BY-SA 4.0 like the rest of `resources/`).

### Removed

- `proprietary/` (17 files: `OpenFront.ttf`, logos, favicon, six music tracks, the game-start
  alert) — all rights reserved upstream, not licensed for use outside OpenFront.

### FightWars-only files added

- `src/brand/Brand.ts` — the single source of every brand string, asset path, community link,
  telemetry name and monetisation switch. Components read `BRAND.*`; nothing hardcodes a name.
- `resources/images/FightWarsLogo.svg`, `FightWarsLogoDark.svg` — placeholder wordmarks until
  Phase 4 art.
- `resources/sounds/effects/game-start-alert.wav` — synthesised two-tone chime (Node script,
  no third-party audio).
- `scripts/checkLicenses.ts` — walks the production dependency tree, fails on any licence outside
  the AGPL-compatible allowlist.
- `scripts/perfGate.ts` — runs the headless full-game harness and fails on regression past the
  budgets recorded in `BUILD-STATE.md`.
- `CHANGELOG.md` — player-facing changes.

## Phase 2 (started early, 2026-09-12)

### FightWars-only files added

- `tests/load/LoadTest.ts` (`npm run load:test`) — the Section 8 load harness: N simulated clients
  per lobby over the real binary WebSocket protocol, dev persistent-id tokens, real intents from
  `ScriptedHuman`, real hashes from one shared headless `GameRunner` per lobby, optional send
  latency/jitter and disconnect-rejoin churn, per-client bandwidth and turn-cadence report, exit 1
  on desync/error/budget breach.
- `tests/determinism/DeterminismRunner.ts` — `ScriptedHuman` is now exported for the load harness.
- Load harness later gained: `--workers N` round-robin creation, 429 back-off on `create_game`, and
  a fresh terrain decode per lobby (the core `loadTerrainMap` cache shares one mutable `GameMap`
  per map name, which corrupts state when one process runs many games).

### Brand sweep (Phase 1, agent-assisted, 2026-09-12)

- `index.html` — title/og from the brand; canonical and `og:url` removed until `BRAND.siteUrl`
  is set; every ad and tracking script removed (Playwire/`ramp`, `googletag`, both `gtag`
  blocks, the obfuscated `HgWESkOz` anti-adblock loader, Cloudflare Insights) and their CSS.
- `src/client/Admiral.ts` — deleted (the `introjava.com` loader).
- ~45 client files, 6 server files and 4 core files now read `BRAND.*` for every product name,
  logo, community link, telemetry name and desktop identifier; ad, store and Steam surfaces are
  gated on `BRAND.monetisation.*` and render nothing when off (upstream code kept, tests keep it
  covered by mocking the switch on). Footer + loading screen show `BRAND.upstream.copyright`
  (AGPL §7(b)); title screen shows "Based on OpenFront"; Help modal has an About section with
  the source link (AGPL §13). `resources/lang/en.json` values rebranded (keys frozen;
  `win_modal.support_openfront` is the one key still carrying the old name).
- `src/client/DesktopShell.ts` — the desktop bridge is `window.fightwarsDesktop` and the scheme
  `app://fightwars`: a separate desktop shell, if ever built, must inject those names.
- `tests/Brand.test.ts` — asserts the copyright text, that no `src/` file outside `src/brand/`
  mentions the upstream name except via `BRAND.upstream`, and that `index.html` carries none of
  the ad/tracking markers.
- `scripts/pr-gate/`, `scripts/issue-lifecycle/`, `tests/PrGateRules.test.ts` — deleted with the
  workflows they served; `tsconfig.json` now includes `scripts/**/*` so the two FightWars
  scripts are type-checked and lintable.

### Desync alerting (Phase 2, 2026-09-12)

- `src/server/DesyncAlert.ts` — new: error-level structured log on the first desync per game
  (warn on repeats), a process-wide event counter, optional `DESYNC_WEBHOOK_URL` POST.
- `src/server/GameServer.ts` — one call to `alertDesync()` in `handleSynchronization()` where
  the tally already finds out-of-sync clients (additive; nothing else changed).
- `src/server/WorkerMetrics.ts` — `<prefix>.desync_events.total` observable gauge.
- `tests/server/DesyncAlert.test.ts` — unit + turn-loop integration.

### Replay persistence (Phase 2, 2026-09-12)

- `src/server/ReplayStore.ts` — new: `ReplayStore` interface, `FileReplayStore` (gzip JSON per
  game under `REPLAY_DIR`, default `./replays` in dev) and `ApiReplayStore` (upstream's
  behaviour, used outside dev when `REPLAY_DIR` is unset).
- `src/server/Archive.ts` — `archive()` / `readGameRecord()` now delegate to the store instead of
  calling OpenFront's API directly (same validation and logging).
- `src/server/Worker.ts` — new `GET /api/replay/:id` serving the stored record.
- `src/client/JoinLobbyModal.ts` — replay lookup asks the game server first, then the legacy API.
- `tests/server/ReplayStore.test.ts` — round-trip, missing, path-escape, store selection.

### Server turn timing and live metrics (Phase 2, 2026-09-12)

- `src/server/TurnStats.ts` — new: ring buffer of `endTurn()` durations and bytes broadcast per
  game; mean/p50/p99/max, over-budget count, bytes/s.
- `src/server/GameServer.ts` — `endTurn()` timed (from commit through broadcast) and bytes counted;
  `turnStatsSnapshot()` accessor. Additive.
- `src/server/GameManager.ts` — `metrics()` aggregate (`WorkerMetricsSnapshot`).
- `src/server/Worker.ts` — `GET /api/metrics`.
- `src/server/MetricsDashboard.ts` — new: the dependency-free dashboard page.
- `src/server/Master.ts` — `GET /metrics` (serves that page) and
  `GET /metrics/worker/:index` (proxies each worker so the page works with or without nginx/vite).
- `tests/server/TurnStats.test.ts`.

### Accounts, ladder and the API service (Phase 2, 2026-09-12)

- `src/api/` — new service (`npm run start:api`, dev on http://localhost:8787, which is the
  issuer the game server and client already use when `DOMAIN=localhost`):
  `Db.ts` (node-postgres or embedded PGlite), `Migrations.ts` (accounts, sessions, matches,
  match_players, ratings), `Keys.ts` (Ed25519 JWTs + JWKS), `Accounts.ts` (guest accounts keyed
  by persistent id, rotating refresh sessions), `Glicko2.ts` (rating), `Matches.ts` (record
  ingest → ladder), `App.ts` (routes), `Server.ts`. Replaces the closed-source worker's
  `/.well-known/jwks.json`, `/users/@me`, `/join_verify`, `/cosmetics.json`,
  `/reserved_clan_tags`, `/custom_tribes`, `/matchmaking/checkin`, `/game/:id`, `/auth/refresh`,
  plus new `/auth/guest`, `/public/player/:id`, `/public/leaderboard/:ladder`.
- `package.json` — `pg` and `@electric-sql/pglite` dependencies (MIT / Apache-2.0);
  `start:api`, `start:api-dev`; `dev` now also runs the API.
- `src/server/Archive.ts` — after saving to the replay store, POSTs the record to the API
  (`postRecordToApi`, skipped without `API_KEY` or with `ARCHIVE_TO_API=false`).
- `src/client/Auth.ts` — `doGuestLogin()`: a 401 from `/auth/refresh` now mints a guest session
  via `/auth/guest` before falling back to `logOut()`.
- `docker-compose.yml` — game + api + postgres + redis (not yet run: no Docker on the dev box).
- Tests: `tests/api/Api.test.ts` (every server-facing response parsed with the server's own
  schemas), `tests/api/Glicko2.test.ts` (paper example), `tests/server/ArchiveToApi.test.ts`.

### Ranked matchmaking (Phase 2, 2026-09-12)

- `src/api/Matchmaking.ts` — new: the 1v1 / 2v2 queues behind the exact contract the client
  (`WebSocket /matchmaking/join`, `join` / `queue-size` / `match-assignment` JSON frames) and
  the worker (`POST /matchmaking/checkin` with a pre-minted game id → `{ assignment }`)
  already speak. Rating-proximity pairing that widens with wait time; 2v2 teams balanced by
  rating sum. Attached to the API's HTTP server in `Server.ts`.
- `tests/api/Matchmaking.test.ts` — real sockets + worker check-ins; pairing unit tests.

### Player profiles and the ranked leaderboard (Phase 2, 2026-09-12)

- `src/api/ProfileRoutes.ts` — new: `GET /public/player/:publicId` (`PlayerProfileSchema`, stats
  tree empty for now), `GET /public/player/:publicId/games` (keyset-paginated history with the
  client's `filter`/`type`/`cursor` parameters) and `GET /leaderboard/ranked?page=N`
  (`RankedLeaderboardResponseSchema`; 1v1 from the ffa ladder, 2v2 from the team ladder).
- `src/api/Matchmaking.ts` closes sockets through `CloseCode` only (the guard test in
  `tests/CloseCodes.test.ts` enforces it across `src/`).
- `tests/api/Profiles.test.ts` — every response parsed with the client's schemas.

### Clans, friends, public games, stats tree, seasons (Phase 2, session 3, 2026-09-12)

#### FightWars-only files added

- `src/api/ClanRoutes.ts`, `src/api/FriendRoutes.ts`, `src/api/GamesRoutes.ts`,
  `src/api/StatsTree.ts`, `src/api/GameBuckets.ts`, `src/api/Cursor.ts` — the routes the
  client's `ClanApi.ts`, `FriendsApi.ts` and profile pages call; migrations 0004–0007 in
  `src/api/Migrations.ts`.
- `tests/api/fixtures.ts`, `tests/api/{Clans,Friends,Games,Migrations,StatsTree,Seasons}.test.ts`.
- `.github/workflows/ci.yml` — "API on Postgres" job (a `postgres:16` service, one database per
  test file) so the production adapter runs on every push.

#### Shared upstream files edited

- `src/client/AccountIdentity.ts` — `responseHasLinkedIdentity` is true for any `/users/@me`
  response: in FightWars every session is a guest account, so ranked, the account button, the
  lobby card and the not-logged-in warning treat guests as signed in. Tests updated:
  `tests/client/{AccountIdentity,LobbyCardTrust,Matchmaking}.test.ts`,
  `tests/client/components/NotLoggedInWarning.test.ts`.
- `src/client/ClanModal.ts` — signed-out means no session (not an empty `me.user`); the
  Donations tab renders only when `BRAND.monetisation.store` is on. `tests/client/clan/
{ClanModalGuest,ClanModal.handlers,ClanModalProfileHandoff}.test.ts` updated / mocked with
  the store on.
- `src/client/components/clan/ClanDetailView.ts` — Donate button behind the same switch (it
  opened the store checkout).
- `src/server/Master.ts`, `vite.config.ts` — `MASTER_PORT` (default 3000) for the master port
  and the Vite proxy targets; `package.json` gained `dev:alt` (master on 3200).

### Parity and repair (Phase 3, 2026-09-12)

#### FightWars-only files added

- `src/client/TurnSequencer.ts` — orders the turns the sim consumes; holds turns that arrive
  ahead of the start snapshot during a rejoin instead of dropping them.
- `docs/BASELINE-VERIFICATION.md` — brief §5 item by item with the test that pins each.
- `tests/client/TurnSequencer.test.ts`, `tests/ExecutionManagerIntents.test.ts`,
  `tests/DiplomacyVerbs.test.ts`, `tests/TribeExecution.test.ts`,
  `tests/AttackImplBorder.test.ts`, `tests/DeleteUnitCooldown.test.ts` — coverage for the
  intent dispatcher, every diplomacy verb, bots, the attack record and delete cooldowns.

#### Shared upstream files edited

- `src/client/ClientGameRunner.ts` — turn handling goes through `TurnSequencer`; the
  "got wrong turn" error is gone (one warning per rejoin gap instead).
  `tests/client/ClientGameRunnerMessages.test.ts` updated to the hold-then-apply rule.
- `vite.config.ts` — `test.coverage.thresholds` floor for `src/core/**` (lines 85, functions 83,
  branches 77, statements 84), enforced by CI's `npm run test:coverage`.
