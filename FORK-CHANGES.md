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

## Phase 4 — identity (2026-09-12)

Written in session 7 covering sessions 5–7; the file had no Phase 4 entries before that, which
is the gap this section closes.

### Nation colours in OKLCH (cfc7de38a)

#### FightWars-only files added

- `src/client/theme/Oklch.ts`, `src/client/theme/DeltaE.ts` — perceptual colour space and the
  CIEDE2000 distance the allocator separates players by.
- `scripts/generatePalettes.ts` — generates the four theme JSONs; run by hand, not in CI.
- `src/client/render/gl/{deuteranopia,protanopia,tritanopia}-theme.json` — one palette per form
  of colour blindness, replacing the single `colorblind-theme.json`.
- `tests/client/DeltaE.test.ts`, `tests/client/Palette.test.ts` — the distance function and the
  separation floor every generated palette must clear.

#### Shared upstream files edited

- `src/client/render/gl/default-theme.json` — regenerated in OKLCH.
- `src/client/render/gl/colorblind-theme.json` — deleted; three targeted palettes replace it.
- `src/client/theme/ColorAllocator.ts` — allocates by CIEDE2000 distance rather than hue index.
- `src/client/theme/ThemeProvider.ts`, `src/client/GraphicsPresets.ts`,
  `src/client/render/gl/{GraphicsOverrides,RenderSettings}.ts`,
  `src/client/render/gl/graphics-presets.json` — the palette is a user-visible setting with
  four values instead of a boolean.
- `src/core/game/UserSettings.ts` — stores the chosen palette.
- `resources/lang/en.json`, `package.json`, `tests/{Colors,GraphicsPresets,TranslationSystem}.test.ts`
  — strings, the `palettes:generate` script, and the tests that moved with the setting.

### Clan creation, attack cost, account page (da380e999, c54d8c642, 49bb3c999)

#### FightWars-only files added

- `src/client/components/clan/ClanCreateView.ts` — the create form; clans could be joined but
  not created from the game before.
- `src/client/AttackCostEstimate.ts` — turns `Config.attackLogic`'s `AttackExplanation` into the
  hover breakdown.
- `tests/client/clan/ClanApiCreate.test.ts`, `tests/AttackBreakdown.test.ts`,
  `tests/client/AttackCostEstimate.test.ts`, `tests/client/AccountModalGuest.test.ts`.

#### Shared upstream files edited

- `src/core/configuration/Config.ts` — `attackLogic` fills in an `AttackExplanation`; the numbers
  are unchanged, so this is additive and the determinism gate is unaffected.
- `src/client/hud/layers/PlayerInfoOverlay.ts`, `src/client/hud/GameRenderer.ts` — render the
  breakdown on hover.
- `src/client/{ClanApi,ClanModal}.ts` — the create call and its tab.
- `src/client/AccountModal.ts`, `src/client/UsernameInput.ts`, `src/brand/Brand.ts` — a guest is
  a signed-in account here, so the page shows what a guest actually has rather than a sign-in wall.

### A face and a mark of its own (938362c3f)

#### FightWars-only files added

- `scripts/generateBrandMarks.ts`, `scripts/generateFontAtlas.ts`, `scripts/syncFonts.ts` — asset
  generators. Their tools are deliberately **not** dependencies (`msdf-bmfont-xml` pulls native
  `canvas`); each script's header names the one-off `npm install --no-save`.
- `resources/fonts/barlow-*.woff2`, `resources/images/SocialCard.png`.

#### Shared upstream files edited

- `resources/atlases/msdf-atlas.{json,png}` — regenerated for Barlow Condensed.
- `resources/fonts/overpass*.woff`, `resources/images/GameplayScreenshot.png` — deleted.
- `resources/images/{Favicon.svg,FightWarsLogo.svg,FightWarsLogoDark.svg}`,
  `resources/icons/icon512_*.png` — own mark.
- `src/brand/Brand.ts`, `src/client/styles.css` — `--font-display` (Barlow Condensed) and the
  body face as brand tokens.
- `src/client/{Main,Utils,HelpModal}.ts`, `src/client/components/{DesktopNavBar,PlayPage}.ts`,
  `src/client/hud/layers/WinModal.ts`, `src/server/{GamePreviewBuilder,RenderHtml}.ts` — the
  wordmark and `og:image` follow the brand module.
- `tsconfig.json`, `eslint.config.js` — `scripts/generateBrandMarks.ts` excluded and allow-listed;
  it runs under a tool that is not installed, so type-checking it would claim a check that is not
  happening.
- `LICENSING.md`, `package.json`, `tests/Brand.test.ts`.

### The chrome stops being painted in upstream's blue (f70684ae4)

#### Shared upstream files edited

- `src/client/styles/core/variables.css`, `src/client/styles.css`, `index.html` — the semantic
  palette: `action` / `action-hover` / `action-ink` / `signal` / `rank-gold` / `surface` / `ink`.
  There is deliberately no _lighter_ hover step; that is what left the old one at 2.56:1.
- ~55 client files under `src/client/` (modals, nav bars, lobby and clan views, base components,
  HUD layers) — a mechanical sweep from upstream's hard-coded blues to those tokens, one
  substitution each. Listed as a group for the same reason as the Phase 1 brand sweep: they are
  one change, and a rebase resolves them the same way.
- `tests/client/clan/ClanModal.rendering.test.ts` — assertions that named the old colours.

### The client perf harness runs again (session 7)

#### FightWars-only files added

- `src/client/CosmeticsCache.ts` — the resolved cosmetics catalog, split out of `Cosmetics.ts`.
- `tests/perf/client/ViteServer.ts` — the dev server the two browser-driven harnesses start,
  previously duplicated byte-for-byte in both.

#### Shared upstream files edited

- `src/client/Cosmetics.ts` — the catalog cache moves to `CosmeticsCache.ts` and is re-exported.
  `Cosmetics.ts` owns fetching, purchasing and the modals around both, so it imports Api,
  Payments and InGameModal, and through them lit-html, which touches the DOM at module scope.
- `src/client/WebGLFrameBuilder.ts` — reads the cache from the leaf module, so the renderer no
  longer depends on the store. Behaviour is unchanged; this is an import-graph change.

### Readable at every zoom (Phase 4 item 3, session 7)

#### FightWars-only files added

- `src/client/render/gl/ZoomLegibility.ts` — the thresholds that decide how the map is drawn at
  the zoom it is being viewed at, and nothing else. Kept out of the passes because it is the only
  part of this that can be tested without a GL context.
- `src/client/render/gl/shaders/shared/political-owner.glsl` — nine taps over a pixel's own
  footprint, majority owner wins. Shared by the fill and the outline so the two agree.
- `tests/client/ZoomLegibility.test.ts`.

#### Shared upstream files edited

- `src/client/render/gl/shaders/map-overlay/territory.frag.glsl` — resolves the owner over the
  pixel footprint when a pixel covers more than one tile, fades patterns, skins and the defence
  darken out as it does, and closes the fill toward opaque. All three are per-tile detail that
  becomes noise below a pixel per tile.
- `src/client/render/gl/shaders/day-night/border-stamp.frag.glsl` — takes the strongest border in
  the same footprint, so a one-tile outline survives below a pixel instead of vanishing.
- `src/client/render/gl/passes/{TerritoryPass,BorderStampPass}.ts` — the uniforms for both.
- `src/client/render/gl/Renderer.ts` — computes the policy once a frame and hands it to both.
- `src/client/render/gl/utils/GlUtils.ts` — `shaderSrc` can splice shared GLSL chunks at a
  `// #chunks` marker. Not after `#version` like the defines: a chunk using `usampler2D` has to
  follow the shader's `precision` declaration for it.
- `src/client/render/gl/RenderSettings.ts`, `render-settings.json`, `GraphicsOverrides.ts` —
  `mapOverlay.politicalZoom`, default on. Nine fetches per pixel while zoomed out and none while
  zoomed in, so a machine that cannot spare them can have the plain point sample back.

### Feel: shake and flash (Phase 4 item 5, session 7)

#### FightWars-only files added

- `src/client/ScreenShake.ts` — a decaying camera shake in _screen_ pixels, so a blast hits the
  view equally hard at every zoom. One shake at a time: a bigger blast takes over, a smaller one
  does not, because a MIRV's salvo summed would leave the camera unusable exactly when the player
  needs to read it.
- `src/client/render/gl/passes/FlashPass.ts`,
  `src/client/render/gl/shaders/shared/flash.frag.glsl` — the wash a detonation leaves. In GL
  rather than as a DOM overlay so it covers the map and leaves the HUD, which sits above the
  canvas, legible.
- `src/client/controllers/ImpactFeedbackController.ts` — drives both from nuke detonations,
  scaled by warhead and by how far the blast is from the centre of the view. Separate from
  SoundEffectController, which watches the same events: a muted player should still feel a
  hydrogen bomb, and a player watching a distant one should not be thrown around by it.
- `tests/client/ImpactFeedback.test.ts`.

#### Shared upstream files edited

- `src/client/TransformHandler.ts` — holds the shake. Deliberately _not_ folded into
  `offsetX`/`offsetY`: those are the pan the player set, and every screen-to-world conversion
  reads them back, so a shake moving them would make the map land somewhere other than where it
  is drawn for as long as it lasted.
- `src/client/ClientGameRunner.ts` — `syncCamera` adds the shake, in the one place the render
  camera is built and nowhere else.
- `src/client/render/gl/Renderer.ts`, `MapRenderer.ts` — own the flash pass and expose
  `triggerFlash`.
- `src/client/hud/GameRenderer.ts` — registers the controller.
- `src/client/sound/Sounds.ts`, `src/client/controllers/SoundEffectController.ts`,
  `tests/client/controllers/SoundEffectController.test.ts` — the four orphan sound files.
