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
  `desktopSteamLocale` (upstream, session 13) reads the bridge through `desktopBridge()`.
- `src/client/sound/SoundManager.ts`, `src/client/sound/MenuMusic.ts` — the gameplay loop and
  the menu theme come from `BRAND.assets.gameplayMusic` / `menuMusic`; null (the shipped
  value — upstream's tracks are under `/proprietary`) means no Howl and no gesture listener.
  `tests/client/sound/SoundManagerNoMusic.test.ts` pins it; upstream's music suites run
  against a mocked brand that names the tracks.
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
  `tests/client/components/NotLoggedInWarning.test.ts`; and (session 12, upstream
  `09720270c`) `tests/client/{SteamLink,SteamLinkModal}.test.ts` — upstream gates the Steam
  link on a linked identity so a guest cannot bind Steam to a throwaway account; here the
  guest account is the account the player keeps, so the four "route a guest to log in" cases
  assert the guest reaching confirm instead.
- `tests/DesktopStatusBar.test.ts` (upstream `335c18fa7`) — desktop marker is
  `BRAND.desktop.windowObject`; `resources/lang/en.json` `desktop_status.offline` and
  `common.backend_unreachable` name FightWars.
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

### The live "cost so far" (Phase 4 item 4, session 7)

A running attack now shows what it has already cost, beside what it has left.

#### Shared upstream files edited

- `src/core/game/AttackImpl.ts`, `src/core/game/Game.ts` — `troopsCommitted()` and
  `commitTroops()`. Committed is every troop ever put into the attack: it rises when another
  attack on the same target merges in and is untouched by losses, so
  `troopsCommitted - troops` is the cost. A plain "troops it launched with" would have gone
  **negative** the moment two attacks combined, which `AttackExecution` does routinely.
- `src/core/execution/AttackExecution.ts` — the merge calls `commitTroops` instead of
  `setTroops(troops + other)`. Identical arithmetic for the live count; the determinism gate's
  final hash is unchanged (`23404413546031824`), which is the evidence that it is.
- `src/core/game/GameUpdates.ts`, `src/client/render/types/Renderer.ts` — `troopsCommitted` on
  `AttackUpdate` / `AttackData`. It rides the attack **array**, not the packed per-tick lane:
  it only moves when two attacks merge, which is a membership change, and the lane exists for
  values that change every tick for every attack.
- `src/core/game/GameUpdateUtils.ts` — `attackArrayMembershipEqual` compares it. A merge
  changes membership anyway, so this is belt and braces, but it means the committed total
  cannot go stale if deletion is ever deferred. Note the coupling it implies:
  `packAttackTroopDeltas` only emits while the arrays are _not_ being resent, so a tick that
  changes committed skips the lane and carries the fresh troop count on the array instead.
- `src/core/game/PlayerImpl.ts` — both attack-array map sites.
- `src/client/AttackCostEstimate.ts` — `attackSpend`, the display decision: null rather than a
  number when there is nothing to show, so no "−0" appears beside a freshly launched attack
  and no negative spend can reach the screen.
- `src/client/hud/layers/AttacksDisplay.ts` — renders it on outgoing attacks, on players and on
  wilderness. **Outgoing only:** the defender already sees an incoming attack's live troop
  count, but what it has _cost_ the attacker is information they did not have, and handing it
  over is a balance decision for brief §8's fog filtering rather than a legibility one.
- `resources/lang/en.json` — `attack_cost.spent_so_far`, the hover explanation.
- `tests/AttackImplBorder.test.ts`, `tests/GameUpdateUtils.test.ts`,
  `tests/client/AttackCostEstimate.test.ts`, `tests/client/view/GameView.test.ts`,
  `tests/perf/DiffPlayerUpdatePerf.ts` — the invariant through a merge, the array resend, the
  display decision, and fixtures.

#### Not done, and why

`tilesConquered` — the other half of "what has this attack bought" — is **not** derivable on the
client, contrary to the plan in `docs/HANDOFF.md` §3: the client sees territory changes but
cannot attribute them to one of a player's several concurrent attacks. Sending it would mean
widening `packedAttackUpdates`, the one per-tick lane with a real bandwidth cost under 120
players, so it is deliberately left out rather than guessed at.

## Phase 5 — depth (2026-09-13)

### Supply lines (brief §6.1, session 10)

An attack is fed through the attacker's own ground from its nearest capital, City, Port or
Factory. The further the front is from one, the more the attack bleeds per tile, the slower it
advances, and the more the standing stack melts away while it stands there. The decision it
creates is "put a city or a port behind the front before pushing past it" — and the reason it is
supply rather than a radius is that distance is **walked through your own territory**, so a
salient that loops back to within sight of its capital is still as far from supply as the road
home is long, and cutting that road strands everything past the cut.

Full description, tunables and hook points: `docs/MECHANICS.md` §02 G1.

#### FightWars-only files added

- `src/core/game/SupplyNetwork.ts` — one byte per tile: distance to its owner's nearest source,
  `255` for unknown or out of range. Maintained two ways, and the split is what makes it
  affordable: `onConquer` relaxes a newly taken tile to one more than the lowest of its owner's
  four neighbours (four array reads on the conquest path), so an advance carries its own supply
  line forward with no sweep involved; a level-order BFS re-floods each player from scratch
  round-robin over 60 ticks, because relaxation cannot see a distance get _shorter_ or a source
  disappear. Frontier arrays are reused, so a sweep allocates nothing, and a player's slot is
  skipped outright when neither its tile set nor its unit list has moved since its last flood —
  the field is a pure function of those two, so re-flooding an unchanged player is waste, and
  that waste is what makes an unguarded sweep grow with the map.
- `tests/SupplyNetwork.test.ts` — the field: sources, walked distance (a U-shaped territory
  whose far end is 20 tiles from its capital and 60 from supply), the range cap, the rendered
  flag, relaxation without a sweep, and a salient stranded by losing the ground behind it.
- `scripts/balanceRun.ts`, `package.json` (`npm run balance:run`) — the same headless game as
  `perf:gate`, run long, printing who is alive, how concentrated the land is and what got built.
  Phase 5's gate asks for a bot-vs-bot run per item and nothing existed to produce one. Its
  `--no-supply` flag turns this mechanic's penalty and attrition off and nothing else, so an A/B
  is of the mechanic rather than of two builds — and unlike stashing the feature, it does not
  also remove the script doing the measuring.
- `tests/SupplyAttrition.test.ts` — the same fight fought twice down a 150-tile corridor with
  the capital at either end, plus the supply curve's boundaries. The corridor comparison is an
  end-to-end claim dominated by the attrition; the per-tile penalty is pinned separately (see
  below), which is worth knowing before trusting either.

#### Shared upstream files edited

- `src/core/configuration/Config.ts` — `supplyFreeRange` 30, `supplyMaxRange` 90,
  `supplyMaxPenalty` 1.5, `supplyAttritionRate` 0.002, and the two curves over them. All linear
  (`+ - * /` only), so no `DetMath` is needed. `attackLogic` charges `supplyPenalty` on both
  `mag` and `tileCost` **before** the defense-post and fallout blocks, so it applies to the terra
  nullius branch too: an empty tile 80 tiles past your last port is exactly the push this is
  meant to make expensive. `AttackLogicInput.supplyDistance` and
  `AttackExplanation.supplyDistance` / `supplyMod` carry it in and out.
- `src/core/execution/AttackExecution.ts` — gathers `supplyDistance` from the attacker's side of
  the border (the tile being taken is still the defender's, so it has no supply value of the
  attacker's own), and charges attrition on the standing stack before the conquest loop, so a
  push that outruns its cities dies where it stands and a retreat brings home less than it set
  out with.
- `src/core/game/GameMap.ts` — state **bit 12** as a per-tile `supplied` flag, set inside
  `supplyFreeRange`. It rides the existing R16UI tile-state texture, so the client has it with no
  new wire format. The sweep writes distances directly and syncs the flag in one pass at the
  end: going through the setter during the flood would clear every tile's flag and set most of
  them again, and each flip records a tile update — a player's whole territory on the wire,
  twice, every cycle.
- `src/core/game/Game.ts`, `src/core/game/PlayerImpl.ts` — `Player.myUnitsVersion()`, an
  accessor for the per-player unit version that already existed as `_myUnitsVersion`. Paired
  with `tileChangeVersion()` it is the exact test for "this player's supply field cannot have
  changed", and it covers the one case `addUnit` / `removeUnit` miss: a City or Port that
  changes hands through `setOwner` rather than being built or destroyed.
- `src/core/game/GameImpl.ts`, `src/core/game/Game.ts` — owns the network, runs its sweep at the
  top of `executeNextTick`, relaxes on `conquer`, clears on `relinquish`, and marks a player's
  field dirty from `addUnit` / `removeUnit` when the unit is one of the three source structures,
  so a city built behind the front counts on the next tick rather than up to six seconds later.
- `src/client/AttackCostEstimate.ts`, `src/client/view/GameView.ts`,
  `resources/lang/en.json` — the hover breakdown gains an "Out of supply" row. The client knows
  exactly when an attack pays nothing and only a bound when it pays something, so past the flag
  it quotes the saturated penalty: the tooltip may say an attack is dearer than it turns out to
  be, never cheaper.
- `tests/AttackScenarios.test.ts` — each side now plants a capital, by default in the middle of
  its rect. Without one, both sides of every benchmark fight at full over-extension and the
  numbers stop being a benchmark of the formula. Two new rows fight the same 25k attack with the
  capital on the front line and with no capital at all, which brackets the mechanic: 300 tiles
  taken at 83.3 troops each, 263 at 95.1 from the middle, 204 at 122.5 with nothing behind it.
- `tests/AttackBreakdown.test.ts`, `tests/AttackLogicGolden.test.ts` — `supplyDistance` in the
  random sweep and the fixtures. The golden snapshot is **unchanged**, because the fixtures pass
  distance 0 and the penalty is exactly 1 there.
- `tests/__snapshots__/NationGoldPerMinute.test.ts.snap` — regenerated. Slower conquest leaves
  nations holding their ports and cities, so trade gold rises 45 % and train gold 139 % over
  twenty minutes. Making war dearer makes peace richer; the numbers are in `BUILD-STATE.md`.

#### Fixed on the way, not caused by this change

- `resources/lang/en.json` — three keys were out of alphabetical order and
  `tests/EnJsonSorted.test.ts` was **already red on the branch** before this work (confirmed by
  stashing the one key this change adds and watching it fail identically). Sorted; the diff is
  six moved lines, verified content-identical by a JSON round-trip.
- `tests/core/executions/WinCheckExecution.test.ts` — the timer case stubbed `mg.players` with a
  bare `{numTilesOwned, name}` object and then ran a real tick loop, so any system reading more
  of a player than that broke on it. The stub moved to after the loop: the win check still gets
  it, and the tick loop gets a real game.

#### Not done, and why

- **The map does not shade unsupplied territory yet.** The bit is set, streamed and read; what is
  missing is the render decision, and territory fill already carries patterns, skins, defense
  darkening, alt-view relations and a saturation control. Adding a sixth thing to that stack is a
  design pass, not a shader edit, and it belongs with the Phase 4 item 3 and 6 work. The mechanic
  is not invisible in the meantime: the attack tooltip names it and quotes the multiplier.
- **Rail is not a supply source.** Only the capital and City / Port / Factory are, so a railway to
  the front buys nothing yet. `docs/MECHANICS.md` §03 7.4 has the shape of the change — one more
  seed loop in `SupplyNetwork.refresh` — and the cross-owner cluster caveat that goes with it.
- **Ranges do not scale with map size**, matching `defensePostRange`. On the smallest maps 30
  tiles is most of a country and on `giantworldmap` it is a province.

### Terrain that costs something (brief §6.2, session 11)

Two commits, on purpose. The first turned the three-way terrain switch (and the second copy of
its weights in `AttackExecution.addNeighbors`) into one table a lobby can scale, and had to
leave the determinism hash and every snapshot byte-identical — a refactor that can only be read
as neutral if the balance change on top of it is measured against it. The second put the stored
0–30 elevation back inside the three bands: a mag-30 peak is dearer than a mag-20 foothill, a
slope costs on every tile of the ascent and pays back on every tile of the descent, and a
defender on high ground loses fewer troops holding it. Full description and the numbers:
`docs/MECHANICS.md` §02 G2.

#### Shared upstream files edited

- `src/core/configuration/Config.ts` — `TERRAIN_COST`, `terrainAttackBase` / `terrainPriorityWeight`
  as methods (the priority weight used to live in `AttackExecution`), the three elevation curves
  and their tunables (`terrainHeightSlope` 0.25, `terrainClimbSlope` 1.0,
  `terrainHighGroundDefence` 0.3), `elevation` / `climb` on `AttackLogicInput`, and five new
  fields on `AttackExplanation`. Height and climb are multiplied in as two statements so the
  explanation can name each and the recomposition test can mirror the order exactly.
- `src/core/Schemas.ts` — `TerrainCostConfigSchema`, an optional `terrain` block on `GameConfig`
  of per-band `{ loss, speed }` multipliers in 0.1–10.
- `src/core/execution/AttackExecution.ts` — gathers `elevation` and `climb`
  (`vantageElevation`: the highest tile the attacker holds beside the target, because an attack
  is launched from its best ground); the heap weight now comes from the table.
- `src/client/AttackCostEstimate.ts`, `resources/lang/en.json` — the tooltip gathers the same two
  inputs (`clientVantage`) and gains "Elevation", "Climb" and "High ground" rows; the row
  threshold rises from 0.5 % to 2 %, because with elevation charged on every tile almost every
  tile now carries a ×1.01 somewhere and a list of near-no-ops explains nothing.
- `tests/AttackLogicGolden.test.ts` — the fixtures pass `elevation: 0, climb: 0`, so every
  existing golden row is byte-identical; four new rows pin height inside a band, signed climb,
  high ground sparing the defender, and terra nullius paying for both.
- `tests/AttackBreakdown.test.ts` — random heights and climbs in the drift-alarm sweep, and
  `heightMod` / `climbMod` in the tamper list. Note that `highGroundMod` is **not** tamperable
  there — it scales the density the recomposition reads back — so its guard is the golden row,
  which was watched failing.
- `tests/AttackScenarios.test.ts.snap`, `tests/NationGoldPerMinute.test.ts.snap` — regenerated;
  every scenario moved, because elevation touches every tile.
- `scripts/balanceRun.ts` — `--flat-terrain`, the elevation A/B lever beside `--no-supply`; one
  lever at a time is enforced.

#### FightWars-only files added

- `tests/TerrainCostConfig.test.ts` — the table is the bare table with no lobby block, a lobby
  block scales one band and no other, and a multiplier of exactly 1 is exactly no change.

#### Fixed on the way, from this session's rebase onto upstream

- `src/server/ClusterCheckin.ts` — a comment in upstream's new file named their domain as an
  example mirror and tripped `tests/Brand.test.ts` (upstream may be named only through
  `BRAND.upstream`). Reworded; nothing but the comment changed.
- `tests/server/RenderHtml.test.ts` — upstream's new guarded-lines case asserts an empty asset
  manifest, which is only true on a box with no production build: `RuntimeAssetManifest` reads
  `static/asset-manifest.json` when it exists. The manifest is now pinned to `{}` in the test so
  it says the same thing after `npm run build-prod` as it does in CI.

#### Not done, and why

Forest, marsh, desert, urban and river crossings — the rest of §6.2's list. The byte has no spare
bits, a magnitude sub-range would destroy the elevation data the curves now read, and no source
PNG has a forest painted in it: the content does not exist, and inventing it across 121 maps is
the owner's art decision. River crossings change conquest topology and are a separate item.
Both are written up with hook points in `docs/MECHANICS.md` §02 G2.

### Upkeep (brief §6.3, first part, session 11)

Every structure level and every warship costs gold each tick, charged right after worker income,
so overbuilding is a debt that catches up with you rather than a price paid once. The engine
cannot hold a negative balance, so non-payment is modelled as consequences: no recruits on a short
tick, and after thirty seconds of shortfall the dearest thing the player owns is lost — nothing
exempt. Description and table: `docs/MECHANICS.md` §01 "Upkeep".

#### Shared upstream files edited

- `src/core/configuration/Config.ts` — `unitUpkeep(type, player)` (the table — session 12: arms rows × `armsUpkeepScale()` = 2 — scaled by the lobby
  gold multiplier like income), `upkeepDue(player)`, `upkeepGraceTicks()` = 300.
- `src/core/execution/PlayerExecution.ts` — the charge, the "no recruits while short" rule (troop
  growth now happens after upkeep, and only on a paid tick), `unpaidUpkeepTicks`, and
  `foreclose()`: highest `upkeep × level`, ties to the lowest id, deleted with an event message.
- `src/core/StatsSchemas.ts`, `src/core/game/Stats.ts`, `src/core/game/StatsImpl.ts` —
  `GOLD_INDEX_UPKEEP` (6) and `goldUpkeep`. `_addGold` grows the array on demand and every reader
  indexes by name, so archived records and the ranking are unaffected.
- `resources/lang/en.json` — `events_display.upkeep_foreclosed`.
- `scripts/balanceRun.ts` — `--no-upkeep`.

#### FightWars-only files added

- `tests/economy/Upkeep.test.ts` — the per-level charge and its stats row, construction exempt,
  recruits stopping and resuming, foreclosure at the grace tick and not one before, the clock
  resetting on a paid tick, and foreclosure stopping once the bill fits. Two breaks were watched:
  upkeep never due fails five of seven, foreclosure never firing fails the two that name it.

### Materials (brief §6.3, second part, session 11)

A second pool beside gold that exactly one thing makes and exactly one thing spends. Factories
produce 2 × level per tick; defense posts, warships, SAMs, silos and nukes cost a flat amount of
it; cities, ports and factories cost gold alone. That asymmetry is the tall-versus-wide choice —
gold raises a country, industry arms it. Description, table and what is not done:
`docs/MECHANICS.md` §03 7.2.

#### Shared upstream files edited

- `src/core/game/Game.ts` — `UnitInfo.materialsCost?`, `Player.materials/addMaterials/
removeMaterials`, `BuildableUnit.materialsCost`.
- `src/core/configuration/Config.ts` — `unitMaterialsCost` (the table; session 12: ×
  `materialsPriceScale()` = 2), `factoryMaterialsPerTick`, `startingMaterials` (session 12: one
  post's price); `unitInfo` decorates every non-zero type once, at the cache, so every
  caller sees the same object.
- `src/core/game/PlayerImpl.ts` — the pool, the gate in `canBuildUnitType`, the charge in
  `buildUnit` and `upgradeUnit`, the price on `buildableUnits`, and the packed lane widened from a
  quint to a sextet — materials change every tick for every factory owner, which is exactly the
  case the packed lane exists for.
- `src/core/execution/FactoryExecution.ts` — production, after the station is created and only
  once the factory is built.
- `src/core/game/GameUpdates.ts`, `src/core/game/GameUpdateUtils.ts`, `src/client/view/GameView.ts`,
  `src/client/view/PlayerView.ts`, `src/client/render/types/Renderer.ts` — the field on the first
  full update, the merge, the stride-6 unpack, the accessor, the state.
- `src/client/hud/layers/RadialMenuElements.ts`, `src/client/controllers/BuildPreviewController.ts`,
  `resources/lang/en.json` — the build menu greys out on a short pool and prints the materials
  price beside the gold; `player_panel.materials`.
- `tests/PackedPlayerUpdates.test.ts`, `tests/PlayerUpdateDiff.test.ts`,
  `tests/LiveTradeRevenue.test.ts`, `tests/client/view/GameView.test.ts`,
  `tests/GameUpdateUtils.test.ts`, the two `tests/client/render/frame/derive` fixtures — every
  quint-shaped expectation widened to the sextet; `tests/economy/ConstructionGold.test.ts` — the
  MIRV cost case buys a silo and a MIRV, both arms, so it is given their materials.
- `tests/MirvBetrayal.test.ts`, `tests/NationCounterWarshipInfestation.test.ts`,
  `tests/NationMIRV.test.ts`, `tests/NationNukeSamOverwhelm.test.ts`,
  `tests/nukes/HydrogenAndMirv.test.ts` — twenty `addGold` grants to players who then build arms
  each gained the matching `addMaterials` beside them. Infinite gold frees only humans (the
  SAM-overwhelm test already says so about gold), and nations in these fixtures have no factory.
- `scripts/balanceRun.ts` — `--no-materials`, and a "Materials held" line in the report.

#### FightWars-only files added

- `tests/economy/Materials.test.ts` — the starting stock, the gate held tile-invariant (same
  tile, same infinite gold, only the pool moves), the flat charge at build and upgrade, factory
  production per level and none under construction, the shipped price, and the zero floor.

#### Not done, and why

Train delivery of materials (the empty `FactoryStopHandler` hook) — production lands in the
owner's pool directly, which is simpler and deterministic; the hook is where geography would
start to matter. A HUD readout of the pool — the menu shows the price, nothing shows the balance;
that is a Phase 4 item 6 concern. Stats for materials — no schema slot yet.

### Blockades and the embargo price (brief §6.3, third part, session 11)

A warship parked within 25 tiles of a rival's port closes it — nothing leaves, nothing arrives —
so a fleet is worth building for something other than piracy and a harbour can be taken without
taking its land. And an embargo, which used to be free to give and binary to receive, now has a
price on the receiving end: the embargoed side's remaining trade pays less in proportion to how
many of its possible partners have closed to it. One embargo is a nuisance; five are a siege.
`docs/MECHANICS.md` §01 "Gaps" and "Embargoes".

#### FightWars-only files added

- `src/core/execution/Blockade.ts` — `isBlockaded(game, port)`, computed once per tick for every
  port and cached per game, because every source port asks about every candidate destination
  and a fresh grid query per pair would be the dearest thing in the tick.
- `tests/economy/Blockade.test.ts`, `tests/economy/EmbargoPrice.test.ts`.

#### Shared upstream files edited

- `src/core/configuration/Config.ts` — `blockadeRange` 25, `embargoTariffMax` 0.5,
  `embargoTariff(pressure)`.
- `src/core/game/Game.ts`, `src/core/game/PlayerImpl.ts` — `Player.embargoPressure()`.
- `src/core/execution/PortExecution.ts` — no spawn roll while blockaded (before the roll, so the
  pity counter does not wind up behind a blockade and burst when it lifts); blockaded
  destinations dropped from `tradingPorts`.
- `src/core/execution/TradeShipExecution.ts` — each end of an arriving route paid its own
  tariffed share; piracy payouts untouched.
- `scripts/balanceRun.ts` — `--no-blockades`, `--no-embargo-price`, and a fleet line.
- `tests/core/executions/TradeShipExecution.test.ts` — its player mocks gained
  `embargoPressure: () => 0`.

#### Two things changed after the first draft

- The blockade sweep scans from the warships (a few dozen) rather than the ports (a couple of
  hundred): same grid query either way, so the cheap direction is the short list. `perf:gate`
  idle 3.11 ms.
- The "friendly fleet" test had a stranger's warship in range too and could not fail; it is now
  the one relation that needs no diplomacy — a player's own warship never closes its own port —
  and was watched failing.

### Nuke consequences (brief §6.4, first half, session 11)

Fallout gets a clock and the clock gets consequences: it expires after three minutes, it
outlasts conquest, the owned land and cities under it count for nothing, a world more than 5 %
irradiated recruits less for everyone, the crossing modifier now rises with world fallout
instead of falling, and world fallout advances the existing Doomsday Clock rather than starting a
second one. `docs/MECHANICS.md` §04 "Gaps" A–C.

#### Shared upstream files edited

- `src/core/configuration/Config.ts` — `falloutHasConsequences`, `falloutDurationTicks` 1800,
  `falloutRegenThreshold` 0.05, `falloutRegenDepth` 0.75, `falloutRegenModifier`,
  `nuclearWinterSecondsPerFalloutShare` 600 in `DOOMSDAY_CLOCK_DEFAULTS`; `falloutDefenseModifier` inverted to 3 + 2·ratio;
  `troopIncreaseRate(player, worldFalloutRatio = 0)`; `maxTroops` subtracts irradiated tiles and
  skips irradiated cities.
- `src/core/game/GameImpl.ts` — the expiry queue and `expireFallout()` (once a second, front of
  the queue only); `conquer` keeps the bit and moves the count; `relinquish` drops it.
- `src/core/execution/DoomsdayClockExecution.ts` — `elapsed` advanced by nuclear winter.
- `src/core/execution/PlayerExecution.ts`, `src/client/hud/layers/ControlPanel.ts` — pass the
  world fallout ratio into the troop rate (both call sites, so the HUD's rate matches the sim's).
- `src/core/game/Game.ts`, `src/core/game/UnitImpl.ts`, `src/client/view/UnitView.ts` —
  `Unit.isIrradiated()`; `Player.numIrradiatedTiles()`.
- `src/core/game/PlayerImpl.ts`, `src/core/game/GameUpdates.ts`, `src/core/game/GameUpdateUtils.ts`,
  `src/client/render/types/Renderer.ts`, `src/client/view/PlayerView.ts` — `irradiatedTiles` on
  the object lane (rare change), diffed and merged like the trade counters.
- `tests/__snapshots__/AttackLogicGolden.test.ts.snap` — the rows with fallout moved, for the
  inverted modifier and nothing else; every other row is byte-identical.
- Four test fixtures with `PlayerState` literals gained `irradiatedTiles: 0`.
- `scripts/balanceRun.ts` — `--legacy-fallout`, and a fallout line in the report.

#### FightWars-only files added

- `tests/nukes/FalloutConsequences.test.ts`.

### Tiered relations and auto-coalitions (brief §6.5, session 11)

An alliance has a rung — non-aggression pact, defensive pact, full alliance — climbed by asking
again with the one button that already exists; each rung unlocks more (peace; allies who come to
your defence; help for free) and costs more to break (½×, 1×, 1½× the traitor window). And once
any side holds 40 % of the map, everyone else is offered a coalition: nations take pacts from any
fellow non-leader without their usual reluctance and seek them out, and humans get one card with
one button. `docs/MECHANICS.md` §05 "Gaps" 1 and 3. Vassalage, war goals and persistent
reputation are deliberately not built; §05 2 and 4 say why.

#### Shared upstream files edited

- `src/core/game/Game.ts` — `AllianceTier`, `ALLIANCE_TIER_KEYS`, `nextAllianceTier`; `tier()` on
  `AllianceRequest` and `Alliance`, `setTier` on `MutableAlliance`; `Player.allianceTierWith`,
  `allies()` redefined as defensive-pact-and-up, `createAllianceRequest(recipient, tier?)`,
  `markTraitor(durationScale?)`; `AllianceInfo.tier` / `nextTier`; `Game.leader` / `leaderShare` /
  `setLeader`; `MessageType.COALITION_OFFER`.
- `src/core/game/AllianceImpl.ts`, `src/core/game/AllianceRequestImpl.ts` — the tier, default
  `FullAlliance` so every existing constructor call means what it did.
- `src/core/game/GameImpl.ts` — requests carry a rung; accepting on an existing alliance climbs
  it in place and renews it; breaking scales the traitor window; the leader and the once-only
  `CoalitionUpdate` on the threshold flip (in team games, naming the team's largest member).
- `src/core/game/PlayerImpl.ts` — `canSendAllianceRequest` allows a deepening; the traitor
  window carries its scale; the alliance view ships the tier.
- `src/core/game/GameUpdates.ts`, `src/core/game/GameUpdateUtils.ts`,
  `src/client/render/types/Renderer.ts` — `tier` on the views (and in `allianceArrayEqual`, so a
  climb re-sends), `CoalitionUpdate`, `GameUpdateType.Coalition`.
- `src/core/Schemas.ts`, `src/core/execution/ExecutionManager.ts`,
  `src/core/execution/alliance/AllianceRequestExecution.ts` — `tier?` on the intent, threaded
  through; a request at or below the rung held is dropped.
- `src/core/execution/WinCheckExecution.ts` — publishes the leader and its share, both modes.
- `src/core/execution/nation/NationAllianceBehavior.ts`, `src/core/execution/NationExecution.ts`,
  `src/core/execution/utils/AiAttackBehavior.ts` — acceptance by rung, pacts first, climbing with
  partners the nation likes, the coalition rule, free help for a full ally; (session 12) the
  Hard/Impossible cap counts `allies()`, not pacts.
- `src/core/configuration/Config.ts` — `allianceTiersEnabled`, `allianceBreakTraitorScale`,
  `coalitionThreshold`; (session 12) `allianceCapCountsPacts`.
- `src/client/Utils.ts` — `COALITION_OFFER` gets the warn colour (the exhaustiveness test
  console-warns on any message type without one).
- `src/client/Transport.ts`, `src/client/hud/layers/ActionableEvents.ts`,
  `src/client/hud/layers/PlayerPanel.ts`, `resources/lang/en.json` — the intent carries the
  rung, the incoming card names it and accepts at it, the coalition card, the button label.
- `scripts/balanceRun.ts` — `--flat-alliances`, `--no-coalition`, and an alliances line;
  (session 12) `--pacts-count` and `--difficulty <easy|medium|hard|impossible>`.
- `tests/NationAllianceBehavior.test.ts` — the mock request gained `tier: () => FullAlliance`;
  three fixtures with alliance-view literals gained `tier: 3`; (session 12) the cap suite —
  a pact-holder gets a defensive pact, a defensive-pact-holder does not, the lever restores
  the old count.

#### FightWars-only files added

- `tests/AllianceTiers.test.ts` — the ladder (one object climbed in place; nothing above the top;
  a non-climb refused; a rung asked for outright; the clock reset on a climb), what each rung
  means, the break cost per rung, and tiers off. Three things the tests had to learn: a second
  request inside the 30 s cooldown is refused, `BreakAllianceExecution` acts a tick after its
  init, and the traitor window is read one tick after the mark.
- `tests/Coalition.test.ts` — the leader and its share from the win check; the offer once on the
  way up and once on the way down (published from _inside_ a tick — `executeNextTick` wipes the
  update map at its start, so a `setLeader` between ticks never reaches the client); nations
  accepting a fellow non-leader they would otherwise weigh, not the leader, and not once the
  leader falls back below the line.

### Doctrines (brief §6.6, session 11)

At spawn a player picks one of eight doctrines — a small passive and one unique unlock each,
every one a scale on a number the game already had — and nations roll one from their seeded
RNG. The pick rides the spawn intent; the client shows eight buttons under the spawn hint for
the length of the spawn phase. `docs/MECHANICS.md` §05 "Gaps" 5 has the table and the hooks.

#### Shared upstream files edited

- `src/core/game/Game.ts` — `Doctrine`, `DOCTRINES`, `DOCTRINE_KEYS`; `Player.doctrine` /
  `setDoctrine`.
- `src/core/game/PlayerImpl.ts`, `src/core/game/GameUpdates.ts`,
  `src/core/game/GameUpdateUtils.ts`, `src/client/render/types/Renderer.ts`,
  `src/client/view/PlayerView.ts` — `doctrine` on the object lane, through diff/apply to the
  view; `PlayerView.spawnTile()`.
- `src/core/Schemas.ts`, `src/core/execution/ExecutionManager.ts`,
  `src/core/execution/SpawnExecution.ts` — `doctrine?` on the spawn intent, stamped after the
  tile; absent keeps what is held.
- `src/core/execution/NationExecution.ts` — the roll in `init`, only with doctrines on;
  (session 12) the Expansionist expand-reserve scale applied after it.
- `src/core/execution/nation/NationStructureBehavior.ts`,
  `src/core/execution/nation/NationWarshipBehavior.ts` (session 12) — the nation's per-city
  structure target, posts under attack and standing warships weighted by its doctrine.
- `src/core/configuration/Config.ts` — `doctrinesEnabled` and the ten scales; `unitInfo` wraps
  `cost` / `materialsCost` per calling player; `AttackLogicInput.attacker/defender.doctrine`
  (optional); the terra-nullius scale and `AttackExplanation.terraNulliusMod`; the post bonus
  scale; `tradeShipGold` and `troopIncreaseRate` read the doctrine.
- `src/core/execution/AttackExecution.ts` — doctrines on the attack input;
  `withDoctrineReach` on the front's supply distance.
- `src/core/execution/Blockade.ts`, `src/core/game/AllianceImpl.ts`,
  `src/core/game/GameImpl.ts`, `src/core/execution/FactoryExecution.ts` — the Naval,
  Diplomatic (both halves) and Industrial hooks.
- `src/client/AttackCostEstimate.ts` — doctrines on the client's estimate input, the reach on
  its supply distance, an `expansionist` row.
- `src/client/Transport.ts`, `src/client/ClientGameRunner.ts`,
  `src/client/hud/layers/PlayerActionHandler.ts` — `SendSpawnIntentEvent(tile, doctrine?)`,
  None sent as absent.
- `src/client/hud/GameRenderer.ts`, `index.html`, `resources/lang/en.json`,
  `tests/client/graphics/GameRendererCreate.test.ts` — the picker registered, mounted,
  translated, and in the renderer test's tag list.
- `scripts/balanceRun.ts` — `--no-doctrines`, and a doctrines line in the report; (session 12)
  `--no-doctrine-play`.
- Fixtures: `tests/GameUpdateUtils.test.ts`, the two `derive` tests, `AttackBreakdown`, and
  the `PlayerInfoOverlay` mock players gained `doctrine`; (session 12) the hand-built config
  and player mocks in `tests/NationStructureBehavior.test.ts` gained
  `doctrineNationBuildScale` / `doctrine`.

#### FightWars-only files added

- `src/client/DoctrinePick.ts`, `src/client/hud/layers/DoctrinePicker.ts` — the session pick
  and the eight buttons.
- `tests/Doctrines.test.ts` — the pick (stamped, kept on a tile re-pick, on the wire, rolled by
  a nation, ignored with doctrines off), every passive and every unlock against the real
  formula (`TestConfig` flattens `attackLogic`, so the two attack cases build a plain `Config`),
  and the lever. The suite is a Public game with the spawn phase left open: in singleplayer
  the first pick ends the phase and a second intent is refused.

### Stability and partisans (brief §6.6, session 11)

Land taken from another state is held from its people until it assimilates (five minutes in
the same hands); enough of one people's land held unassimilated and ungarrisoned raises their
partisans — a tribe on the occupier's own ground, aimed at the occupier, that the occupier
cannot absorb as an enclave. `docs/MECHANICS.md` §05 "Gaps" 6.

#### Shared upstream files edited

- `src/core/game/Game.ts` — `Player.unrestTiles` / `unrestByPeople` / `lastUprising` /
  `markUprising` / `partisanOf` / `partisanFor` / `markPartisanOf`; `Game.occupiedFrom`;
  `MessageType.PARTISANS_RISE` (category ATTACK).
- `src/core/game/GameImpl.ts` — the per-tile people and settle-tick stores, the assimilation
  queue drained beside fallout, the bookkeeping in `conquer` and `relinquish`.
- `src/core/game/PlayerImpl.ts`, `src/core/game/GameUpdates.ts`,
  `src/core/game/GameUpdateUtils.ts`, `src/client/render/types/Renderer.ts`,
  `src/client/view/PlayerView.ts` — `unrestTiles` on the object lane; `numUnrestTiles()`.
- `src/core/execution/TribeExecution.ts` — an optional occupier: fought first whatever the
  odds, never befriended.
- `src/core/execution/PlayerExecution.ts` — the occupier cannot absorb its partisans as an
  enclave.
- `src/core/GameRunner.ts` — registers `UnrestExecution` when stability is on.
- `src/core/configuration/Config.ts` — `unrestEnabled`, `unrestAssimilationTicks`,
  `unrestPartisanThreshold` (session 12: max(300, `unrestPartisanShare()` = 10 % of the
  occupier's land)), `partisanCooldownTicks`, `partisanTroops`, `doctrineUnrestScale`.
- `src/client/Utils.ts`, `resources/lang/en.json` — the uprising message and its colour.
- `scripts/balanceRun.ts` — `--no-unrest`, `--flat-unrest` (session 12), and an unrest line
  in the report.
- Fixtures: `tests/GameUpdateUtils.test.ts` and the two `derive` tests gained `unrestTiles`.

#### FightWars-only files added

- `src/core/execution/UnrestExecution.ts` — once a second, where the next uprising stands.
- `tests/Stability.test.ts` — the books (held, not for tribes, liberated / inherited / let go,
  assimilated, on the wire, off), uprisings (at the threshold on the occupier's ground aimed at
  it, not below it or under a garrison or off, fighting the occupier and refusing its hand,
  the Partisan doctrine's half-and-double), and the enclave rule. Two things it had to learn:
  a queue entry must carry the tile's current settle tick or a re-taken tile settles early,
  and `PlayerExecution`'s cluster pass is staggered — an enclave is checked only after a tile
  change later than its last check, so the test takes one more tile after the first pass.

### Artillery (brief §6.4, session 12)

A land structure that bombards the attacks crossing its range: every five seconds it takes
2000 troops off the nearest attack on its owner within 40 tiles. `docs/MECHANICS.md` §04 D.

#### Shared upstream files edited

- `src/core/game/Game.ts` — `UnitType.Artillery` (appended last: the enum rides the wire by
  member order), in `Structures`; `UnitParamsMap` entry.
- `src/core/configuration/Config.ts` — `unitInfo` case (cost curve, 10 s), materials 400 base,
  upkeep 15 base; `artilleryRange` / `artilleryAttackRate` / `artilleryDamage` /
  `artilleryNationRatio`; the Fortress build scale covers it.
- `src/core/game/PlayerImpl.ts` — `canSpawnUnitType`: land-based structure spawn.
- `src/core/execution/ConstructionExecution.ts` — completes into `ArtilleryExecution`;
  `isStructure`.
- `src/core/game/UnitImpl.ts`, `src/core/StatsSchemas.ts` — the three stats switches; `arty`.
- `src/core/execution/nation/NationStructureBehavior.ts` — `getStructureRatios` takes the
  artillery ratio from `Config`; build order; `artilleryValue()` placement.
- `src/client/render/types/UnitType.ts`, `src/client/render/types/index.ts`,
  `src/client/render/gl/passes/StructurePass.ts`, `src/client/render/gl/render-settings.json`
  — `UT_ARTILLERY` (appended to `ALL_UNIT_TYPES`), drawn with the defense post's atlas column
  until the atlas is regenerated, a point light.
- `src/client/hud/HotbarIcons.ts`, `src/client/hud/layers/BuildMenu.ts`,
  `src/client/hud/layers/UnitDisplay.ts`, `src/client/InputHandler.ts`,
  `src/core/game/UserSettings.ts` (`buildArtillery: KeyJ`), `src/client/UserSettingModal.ts`,
  `src/client/hud/Tutorial.ts`, `src/client/hud/layers/TutorialPanel.ts`,
  `src/client/components/GameConfigSettings.ts`,
  `src/client/controllers/BuildPreviewController.ts` (range ghost),
  `src/client/controllers/SoundEffectController.ts` (the post's build sound),
  `src/client/HelpModal.ts`, `src/client/components/baseComponents/stats/PlayerStatsTable.ts`.
- `resources/lang/en.json` — `build_menu.desc.artillery`, `unit_type.artillery`,
  `help_modal.build_artillery_desc`, `user_setting.build_artillery(_desc)`.
- `scripts/balanceRun.ts` — `--no-artillery`, and guns in the structures line.
- Fixtures: the crowded-map config mocks in `tests/NationStructureBehavior.test.ts` gained
  `artilleryNationRatio`; `tests/client/PlayerStatsTable.test.ts` counts seven buildings.

#### FightWars-only files added

- `src/core/execution/ArtilleryExecution.ts` — the gun.
- `resources/images/ArtilleryIconWhite.svg` — the hotbar / build-menu / help icon.
- `tests/Artillery.test.ts` — the unit (a land structure with a materials price, upkeep and a
  stats key; what a Fortress nation builds more of) and the gun (one volley off the nearest
  attack in range, once per rate; out of range untouched; nothing under construction;
  never below zero, and an attack shelled to nothing ends). Four breaks — range, rate,
  damage, the construction gate — each caught by the case that names it.

### Radar (brief §6.4, session 12)

A land structure that extends its owner's SAM launchers: a SAM within 60 tiles of an active
radar intercepts 30 tiles further, capped at the SAM maximum. `docs/MECHANICS.md` §04 E.

#### Shared upstream files edited

- `src/core/game/Game.ts` — `UnitType.Radar` (appended), in `Structures`; `UnitParamsMap`;
  `Unit.samRangeBonus()`.
- `src/core/game/UnitImpl.ts` — `samRangeBonus()` (a `nearbyUnits` query, cached per tick);
  `toUpdate` carries `samRangeBonus` when non-zero; the three stats switches.
- `src/core/game/GameUpdates.ts` — `UnitUpdate.samRangeBonus?`.
- `src/core/configuration/Config.ts` — `unitInfo` case, materials 500 base, upkeep 20 base;
  `dynamicSamRange` = min(max, base + bonus) over a new private `baseSamRange`; `radarRange`,
  `radarSamRangeBonus`, `radarNationRatio`.
- `src/core/execution/nation/NationNukeBehavior.ts` — the four static `samRange(level)`
  reads now go through `dynamicSamRange`.
- `src/core/game/PlayerImpl.ts`, `src/core/execution/ConstructionExecution.ts`,
  `src/core/StatsSchemas.ts` (`radr`),
  `src/core/execution/nation/NationStructureBehavior.ts` (ratio, build order after artillery,
  never without a SAM, `radarValue()`).
- `src/client/view/UnitView.ts` — `samRangeBonus` into the render state, and an accessor.
- `src/client/render/types/Renderer.ts` (`UnitState.samRangeBonus`),
  `src/client/render/gl/utils/NukeTrajectory.ts` (`samRangeWithBonus`),
  `src/client/render/gl/index.ts`, `src/client/render/gl/passes/SamRadiusPass.ts` (the
  three rings use it), `src/client/render/preview/PreviewAnimationTicker.ts` (fixture),
  `src/client/render/gl/Renderer.ts` (placing a radar shows the SAM rings),
  `src/client/controllers/BuildPreviewController.ts` (existing SAM rings carry the bonus;
  the radar ghost shows its reach).
- `src/client/render/types/UnitType.ts`, `src/client/render/types/index.ts`,
  `src/client/render/gl/passes/StructurePass.ts` (the SAM's atlas column for now),
  `src/client/render/gl/render-settings.json`.
- `src/client/hud/HotbarIcons.ts`, `src/client/hud/layers/BuildMenu.ts`,
  `src/client/hud/layers/UnitDisplay.ts`, `src/client/InputHandler.ts`,
  `src/core/game/UserSettings.ts` (`buildRadar: KeyH`), `src/client/UserSettingModal.ts`,
  `src/client/hud/Tutorial.ts`, `src/client/hud/layers/TutorialPanel.ts`,
  `src/client/components/GameConfigSettings.ts`,
  `src/client/controllers/SoundEffectController.ts` (the SAM's build sound),
  `src/client/HelpModal.ts`, `src/client/components/baseComponents/stats/PlayerStatsTable.ts`.
- `resources/lang/en.json` — `build_menu.desc.radar`, `unit_type.radar`,
  `help_modal.build_radar_desc`, `user_setting.build_radar(_desc)`.
- `scripts/balanceRun.ts` — `--no-radar`; SAMs and radars in the structures line.
- Fixtures: every render `UnitState` literal (`tests/client/render/frame/**`,
  `tests/TrailManager.test.ts`, `tests/SpiralTrails.test.ts`,
  `tests/perf/client/SamRadiusPassPerf.test.ts`) gained `samRangeBonus: 0`; the crowded-map
  mocks gained `radarNationRatio`; `PlayerStatsTable.test.ts` counts eight buildings.

#### FightWars-only files added

- `src/core/execution/RadarExecution.ts` — keeps the wire honest: re-sends the SAMs it covers
  when it goes up and when it falls.
- `tests/determinism/DeterminismRunner.ts` — the digest names a decided game's winner by id
  (a Player has bigint fields; `JSON.stringify` refused it and the 24000-tick gate crashed
  the first time a world match ended inside the horizon).
- `resources/images/RadarIconWhite.svg`.
- `tests/Radar.test.ts` — the unit; the bonus on the SAM in reach and only that one; the
  cap; active-built-own only; the re-send on the way up and the way down. Five breaks (the
  bonus, the owner/active filter, the coverage range, the cap, the wire touch), each caught
  by the case that names it.

### Bomber (brief §6.4, session 12)

A conventional strike flown from a silo like an atom bomb: kills troops and the units in a
small radius, burns nothing. `docs/MECHANICS.md` §04 D.

#### Shared upstream files edited

- `src/core/game/Game.ts` — `UnitType.Bomber` (appended), in `BuildableAttacks`;
  `UnitParamsMap` (the atom bomb's shape).
- `src/core/StatsSchemas.ts` — `bombr`; `NukeType` includes it.
- `src/core/configuration/Config.ts` — `unitInfo` (250k flat), materials 300 base,
  `nukeMagnitudes` {4, 8}, `nukeSpeed` 8, `bomberNationEnabled`.
- `src/core/game/PlayerImpl.ts` — `canSpawnUnitType`: silo spawn.
- `src/core/execution/ConstructionExecution.ts` — dispatched with the two bombs.
- `src/core/execution/NukeExecution.ts` — the conventional branch in `detonate` (no
  relinquish, no water conversion, no nuked layer), the airborne exemption, its inbound line
  and detonation message.
- `src/core/execution/SAMLauncherExecution.ts`, `src/core/execution/SAMMissileExecution.ts` —
  the whitelists and the `unitCount` fast path.
- `src/core/execution/nation/NationNukeBehavior.ts` — the chooser's bomber branch; the
  `AtomBomb | HydrogenBomb` unions widened.
- `src/client/render/types/UnitType.ts`, `src/client/render/types/index.ts`,
  `src/client/render/gl/passes/UnitPass.ts` (the atom bomb's sprite column),
  `src/client/hud/SpriteLoader.ts`, `src/client/view/GameView.ts` (trail),
  `src/client/controllers/ImpactFeedbackController.ts` (a smaller ring),
  `src/client/controllers/SoundEffectController.ts` (the atom bomb's sounds),
  `src/client/controllers/BuildPreviewController.ts` (blast ghost).
- `src/client/hud/HotbarIcons.ts`, `src/client/hud/layers/BuildMenu.ts`,
  `src/client/hud/layers/UnitDisplay.ts` (needs a silo, like the bombs),
  `src/client/InputHandler.ts`, `src/core/game/UserSettings.ts` (`buildBomber: KeyN`),
  `src/client/UserSettingModal.ts`, `src/client/hud/Tutorial.ts`,
  `src/client/hud/layers/TutorialPanel.ts`, `src/client/components/GameConfigSettings.ts`,
  `src/client/HelpModal.ts`, `src/client/components/baseComponents/stats/PlayerStatsTable.ts`.
- `resources/lang/en.json` — `build_menu.desc.bomber`, `unit_type.bomber`,
  `help_modal.build_bomber_desc`, `user_setting.build_bomber(_desc)`,
  `events_display.bomber_detonated`.
- `scripts/balanceRun.ts` — `--no-bomber`; bombers in the fleet line.

#### FightWars-only files added

- `resources/images/BomberIconWhite.svg`.
- `tests/Bomber.test.ts` — the unit (a buildable attack with a price and a key, flown from a
  silo and refused without one), a strike (kills what stands in its radius and burns
  nothing — the atom bomb's opposite on the same landing), the SAM shooting it down, and a
  nation flying one when it cannot afford a warhead and not with the lever off. Three
  breaks (the conventional branch, the SAM whitelist, the nation branch), each caught by the
  case that names it. `TestConfig` flattens magnitudes and speeds, so the table is asserted
  against a plain `Config` and the strike spies the real blast in.

### Submarine (brief §6.4, session 12)

A warship hull that hides: hunts transports and trade ships, never engages a warship, seen
only within 12 tiles or under an enemy radar. `docs/MECHANICS.md` §04 D.

#### Shared upstream files edited

- `src/core/game/Game.ts` — `UnitType.Submarine` (appended), in `BuildableAttacks`;
  `UnitParamsMap` (the warship's shape).
- `src/core/StatsSchemas.ts` — `subm`.
- `src/core/configuration/Config.ts` — `unitInfo` (cost curve, health 1000), materials 800
  base, upkeep 40 base; `submarineDetectionRange`, `submarineNationEnabled`.
- `src/core/execution/WarshipExecution.ts` — takes a hull; prey and sight by hull
  (`detectsSubmarine`); docking counts both hulls.
- `src/core/execution/ShellExecution.ts` (veterancy credit),
  `src/core/execution/MoveWarshipExecution.ts` (moves both hulls),
  `src/core/game/GameImpl.ts` (capture on conquest),
  `src/core/execution/DoomsdayClockExecution.ts` (the decay), `src/core/game/PlayerImpl.ts`
  (port spawn), `src/core/execution/ConstructionExecution.ts`, `src/core/game/UnitImpl.ts`
  (stats switches).
- `src/core/execution/nation/NationWarshipBehavior.ts` — `hullFor()`: a Naval nation's second hull, for the standing fleet and for retaliation.
- `src/client/render/types/UnitType.ts`, `src/client/render/types/index.ts`,
  `src/client/render/gl/passes/UnitPass.ts` (the warship's sprite column),
  `src/client/hud/SpriteLoader.ts`, `src/client/controllers/WarshipSelectionController.ts`
  (box-select and select-all), `src/client/controllers/HoverHighlightController.ts`,
  `src/client/hud/layers/PlayerInfoOverlay.ts` (hover list, unit count),
  `src/client/controllers/SoundEffectController.ts` (the warship's sounds).
- `src/client/hud/HotbarIcons.ts`, `src/client/hud/layers/BuildMenu.ts`,
  `src/client/hud/layers/UnitDisplay.ts`, `src/client/InputHandler.ts`,
  `src/core/game/UserSettings.ts` (`buildSubmarine: KeyV`), `src/client/UserSettingModal.ts`,
  `src/client/hud/Tutorial.ts`, `src/client/hud/layers/TutorialPanel.ts`,
  `src/client/components/GameConfigSettings.ts`, `src/client/HelpModal.ts`,
  `src/client/components/baseComponents/stats/PlayerStatsTable.ts` (kept out of the
  buildings table like the warship).
- `resources/lang/en.json` — `build_menu.desc.submarine`, `unit_type.submarine`,
  `help_modal.build_submarine_desc`, `user_setting.build_submarine(_desc)`.
- `scripts/balanceRun.ts` — `--no-submarine`; submarines in the fleet line.

#### FightWars-only files added

- `resources/images/SubmarineIconWhite.svg`.
- `tests/Submarine.test.ts` — the unit; prey and sight (hunts a transport, never a warship;
  a warship sees it only when close), sight under a radar, the move order, and a Naval
  nation's second hull with the lever. Five breaks (detection, prey, the radar clause, the
  move order, the nation hull), each caught by the case that names it — the radar clause
  only after the case pinned detection to nothing, because a patrolling warship had
  wandered into plain sight and made the guard vacuous. The 16 × 16 test map pins the ranges.

### Carrier (brief §6.4, session 12)

A harbour that sails: ships spawn at the nearest port or carrier and heal beside one; no
guns, a deep hull. `docs/MECHANICS.md` §04 D.

#### Shared upstream files edited

- `src/core/game/Game.ts` — `UnitType.Carrier` (appended), in `BuildableAttacks`;
  `UnitParamsMap` (the warship's shape).
- `src/core/StatsSchemas.ts` — `carr`.
- `src/core/configuration/Config.ts` — `unitInfo` (cost curve, health 2000), materials 1500
  base, upkeep 60 base; `carrierNationEnabled`.
- `src/core/game/PlayerImpl.ts` — `warshipSpawn` picks the nearest port _or carrier_ on the
  same water; `canSpawnUnitType`.
- `src/core/execution/WarshipExecution.ts` — the third hull: no guns, prey for warships,
  the passive heal counts an owner's carrier.
- `src/core/execution/ConstructionExecution.ts`, `src/core/execution/MoveWarshipExecution.ts`,
  `src/core/game/GameImpl.ts`, `src/core/execution/DoomsdayClockExecution.ts`,
  `src/core/game/UnitImpl.ts` — the hull lists.
- `src/core/execution/nation/NationWarshipBehavior.ts` — `hullFor()`: the second hull, the submarine now third.
- `src/client/render/types/UnitType.ts`, `src/client/render/types/index.ts`,
  `src/client/render/gl/passes/UnitPass.ts`, `src/client/hud/SpriteLoader.ts`,
  `src/client/controllers/WarshipSelectionController.ts`,
  `src/client/controllers/HoverHighlightController.ts`,
  `src/client/hud/layers/PlayerInfoOverlay.ts`,
  `src/client/controllers/SoundEffectController.ts`.
- `src/client/hud/HotbarIcons.ts`, `src/client/hud/layers/BuildMenu.ts`,
  `src/client/hud/layers/UnitDisplay.ts`, `src/client/InputHandler.ts`,
  `src/core/game/UserSettings.ts` (`buildCarrier: KeyX`), `src/client/UserSettingModal.ts`,
  `src/client/hud/Tutorial.ts`, `src/client/hud/layers/TutorialPanel.ts`,
  `src/client/components/GameConfigSettings.ts`, `src/client/HelpModal.ts`,
  `src/client/components/baseComponents/stats/PlayerStatsTable.ts`.
- `resources/lang/en.json` — `build_menu.desc.carrier`, `unit_type.carrier`,
  `help_modal.build_carrier_desc`, `user_setting.build_carrier(_desc)`.
- `scripts/balanceRun.ts` — `--no-carrier`; carriers in the fleet line.

#### FightWars-only files added

- `resources/images/CarrierIconWhite.svg`.
- `tests/Carrier.test.ts` — the unit; a warship spawning at the carrier when it is the
  nearer harbour and at the port once the carrier is gone; the heal beside it (and none once
  it is gone, and never itself); no guns and prey; the move order; a Naval nation's second
  hull with the lever (the submarine with it off), driven through the retaliation build. Four breaks (harbour spawn, the
  heal, the guns, the nation hull), each caught by the case that names it.

### Paratrooper (brief §6.4, session 12)

An airborne assault: a fifth of the owner's troops fly from the nearest silo within range to
the target tile and land as an attack from there. `docs/MECHANICS.md` §04 D.

#### Shared upstream files edited

- `src/core/game/Game.ts` — `UnitType.Paratrooper` (appended), in `BuildableAttacks`;
  `UnitParamsMap` (the transport's shape).
- `src/core/configuration/Config.ts` — `unitInfo` (400k flat), materials 500 base;
  `paratrooperRange` / `paratrooperTroops` / `paratrooperMaxTroops` /
  `paratrooperStepsPerTick` / `paratrooperNationEnabled`.
- `src/core/game/PlayerImpl.ts` — `paratrooperSpawn`; `canSpawnUnitType`.
- `src/core/execution/ConstructionExecution.ts` — dispatches the drop (like the bombs, no
  structure).
- `src/core/execution/NukeExecution.ts` — the airborne exemption.
- `src/core/execution/utils/AiAttackBehavior.ts` — `maybeDrop` first in `sendBoatAttack`,
  and the random-target boat builder tries a drop too.
- `src/client/render/types/UnitType.ts`, `src/client/render/types/index.ts`,
  `src/client/render/gl/passes/UnitPass.ts` (the transport's sprite column),
  `src/client/hud/SpriteLoader.ts`, `src/client/view/GameView.ts` (trail),
  `src/client/hud/layers/AttacksDisplay.ts` (drops listed with the boats),
  `src/client/controllers/HoverHighlightController.ts`.
- `src/client/hud/HotbarIcons.ts`, `src/client/hud/layers/BuildMenu.ts`,
  `src/client/hud/layers/UnitDisplay.ts` (needs a silo, like the bombs),
  `src/client/InputHandler.ts`, `src/core/game/UserSettings.ts` (`buildParatrooper: KeyI`),
  `src/client/UserSettingModal.ts`, `src/client/hud/Tutorial.ts`,
  `src/client/hud/layers/TutorialPanel.ts`, `src/client/components/GameConfigSettings.ts`,
  `src/client/HelpModal.ts`.
- `resources/lang/en.json` — `build_menu.desc.paratrooper`, `unit_type.paratrooper`,
  `help_modal.build_paratrooper_desc`, `user_setting.build_paratrooper(_desc)`.
- `scripts/balanceRun.ts` — `--no-paratrooper`; drops in the fleet line. The config chain
  that picked a lever's `Config` subclass was a twenty-two-deep ternary by now; it is a
  lever table.

#### FightWars-only files added

- `src/core/execution/ParatrooperExecution.ts` — the drop.
- `resources/images/ParatrooperIconWhite.svg`.
- `tests/Paratrooper.test.ts` — the unit (a silo in range, onto land it may take, not its
  own, not beyond the range; the troop share and cap); a drop (troops leave with the plane,
  it flies and lands as an attack from the tile; the troops come home if the ground is its
  own by then); a nation dropping first when a silo reaches the target, and not with the
  lever off. Breaks: the range, the landing attack and the nation hook each fail their case;
  the own-land clause does not, because the friendliness clause beside it refuses the
  owner's own tile too — the assertion holds, the clause is belt and braces.

### Readouts: materials, occupied land, doctrine (Phase 4 item 6 / Phase 5 loose ends, session 12)

#### Shared upstream files edited

- `src/client/hud/layers/ControlPanel.ts` — `_materials` read each tick; a materials tile
  beside gold on desktop (the gold tile's grammar, a factory glyph via `.icon-mask`), and a
  second figure under gold in the same tile on the phone row.
- `src/client/hud/layers/PlayerPanel.ts` — `renderDoctrineBadge` (a chip in the identity
  row beside the nation chip, since the session-13 review), `renderUnrest` (an
  occupied-land status row), and `renderResources` as one three-tile grid (gold, troops,
  materials; the factory glyph is the control panel's masked SVG).
- `resources/lang/en.json` — `control_panel.materials`, `player_panel.materials`,
  `player_panel.doctrine` (the chip's accessible name), `player_panel.occupied_land`,
  `player_panel.occupied_land_aria`.

#### FightWars-only files added

- `tests/client/HudReadouts.test.ts` — the control panel prints the pool in both layouts and
  names the tile; the player panel names the doctrine (and not without one, nor with
  doctrines off), shows the pool, and shows occupied land only when there is any, with the
  words beside the colour (and not with stability off).

### Halos at every zoom (Phase 4 item 3, session 13)

#### Shared upstream files edited

- `src/client/render/gl/ZoomLegibility.ts` — `HALO_MIN_PX`, `MAX_HALO_WIDEN`,
  `haloReachTiles`, `haloWiden(zoom, cellTiles)`: the extra doubling-step blur iterations a
  tile-space halo needs to stay at least six CSS pixels wide.
- `src/client/render/gl/passes/SmallPlayerGlowPass.ts`, `FalloutBloomPass.ts` — `setZoom`;
  the blur loop runs the kernel again at steps 2, 4, 8 as the policy asks, the composite
  gains ×2 per iteration; the glow's cached aura is dirtied when the answer changes.
- `src/client/render/gl/Renderer.ts` — both passes get the CSS zoom each frame under
  `mapOverlay.politicalZoom`, or Infinity (native width) when it is off.

#### FightWars-only files added or changed

- `tests/client/ZoomLegibility.test.ts` — `haloWiden`: inert at and above a pixel per tile,
  the fewest iterations that clear the floor, the floor held at MIN_ZOOM inside the cap,
  monotone as the camera pulls out, coarser cells need fewer, finite below MIN_ZOOM, the cap.

### The chrome hides with one key (Phase 4 items 6–7, session 13)

#### Shared upstream files edited

- `src/core/game/UserSettings.ts` — `toggleHud: "KeyZ"` in the default keybinds.
- `src/client/InputHandler.ts` — `ToggleHudEvent`, fired on the key's release like the other
  actions.
- `src/client/hud/GameRenderer.ts` — registers `HudVisibilityController`.
- `index.html` — `data-hud` on the bottom HUD, the top-right cluster and the left sidebar.
- `src/client/styles.css` — `.hud-hidden [data-hud] { display: none }`.
- `src/client/hud/layers/GameRightSidebar.ts` — an eye button that fires the event.
- `src/client/UserSettingModal.ts`, `src/client/HelpModal.ts` — the keybind, listed.
- `resources/lang/en.json` — `user_setting.toggle_hud`, `toggle_hud_desc`, `hud.show_hint`.

#### FightWars-only files added

- `src/client/controllers/HudVisibilityController.ts` — the state, the root class, the
  "Show HUD (key)" button that names the bound key.
- `resources/images/HudIconWhite.svg` — the eye, struck through (CC BY-SA like the rest).
- `tests/client/HudVisibility.test.ts` — the default key, the key label, the input handler
  firing on release and staying out of text fields, the controller starting visible, toggling
  both ways, leaving a way back that works and names the rebound key.

### The player panel's palette (Phase 4 item 6, session 13)

#### Shared upstream files edited

- `src/client/hud/layers/PlayerPanel.ts` — every raw hue class replaced by a token: the
  relation chip and the alliance clock in the four status roles, the traitor badge in `loss`,
  the trade line in `alert` / `gain`, greys as ink steps, the identity chips in `action-ink` /
  `ink-dim`. The identity row keeps ten rem for the name and wraps the chips under it.

#### FightWars-only files changed

- `tests/client/HudTokens.test.ts` — the player panel names no raw hue.

### The leaderboard tables' and the send-resource modal's palette (Phase 4 item 6, session 13)

#### Shared upstream files edited

- `src/client/styles.css` — `--color-rank-silver` (the muted ink) and `--color-rank-bronze`
  (#cd7f32), with the numbers that chose them.
- `src/client/components/leaderboard/LeaderboardPlayerList.ts`, `LeaderboardClanTable.ts`,
  `LeaderboardTribeTable.ts` — the podium in the rank tokens, the local row and clan tag on
  the `action` ramp, wins and losses as `gain` / `loss`, spinner and errors as `action` /
  `loss`, the tribe boost as `signal`.
- `src/client/hud/layers/SendResourceModal.ts` — primary action `action`, cap and dead-target
  note `signal` / `alert`, keep figure `alert` / `gain`, greys as ink steps.

#### FightWars-only files changed

- `tests/client/HudTokens.test.ts` — the podium (three colours to every viewer, legible on
  the surface, bronze apart from `signal`); the four files name no raw hue.

### Attack presets (Phase 4 item 9, session 13)

#### Shared upstream files edited

- `src/core/game/UserSettings.ts` — `attackPreset1`–`4` default keybinds (`Shift+Digit1`–`4`).
- `src/client/InputHandler.ts` — `SetAttackRatioEvent`, `ATTACK_PRESETS`, the four keys.
- `src/client/hud/layers/ControlPanel.ts` — `applyAttackRatio` (the clamp the step handler
  had, shared), the preset handler.
- `src/client/UserSettingModal.ts` — the four rows in the keybinds tab.
- `resources/lang/en.json` — `user_setting.attack_preset`, `attack_preset_desc`.

#### FightWars-only files added

- `tests/client/AttackPresets.test.ts` — the keys and their values, no collision with the
  build digits, the input handler naming the ratio on Shift+digit and not on the plain digit,
  the panel taking and clamping a preset without touching the stored default.

### Rally point (Phase 4 item 9, session 13)

#### Shared upstream files edited

- `src/core/game/UserSettings.ts` — `setRallyPoint: "KeyO"`.
- `src/client/InputHandler.ts` — `SetRallyPointEvent` with the last pointer position.
- `src/client/hud/GameRenderer.ts` — registers `RallyPointController`.
- `src/client/UserSettingModal.ts`, `src/client/HelpModal.ts` — the keybind, listed.
- `resources/lang/en.json` — `user_setting.set_rally_point`, `set_rally_point_desc`,
  `rally.set`, `rally.cleared`.

#### FightWars-only files added

- `src/client/controllers/RallyPointController.ts` — one water tile; the ordinary move intent
  for each new hull of the player's own.
- `tests/client/RallyPoint.test.ts` — the key; set over water and marked, cleared over land,
  off-map ignored; each new own hull sent and nothing else; nothing without a point or after
  it is cleared.

### Build queue (Phase 4 item 9, session 13)

#### Shared upstream files edited

- `src/client/InputHandler.ts` — `QueueBuildEvent`, `CancelBuildQueueEvent`.
- `src/client/UIState.ts` — `buildQueue` (the one queued build, for the panel).
- `src/client/hud/layers/RadialMenuElements.ts` — build items are never disabled: an
  unaffordable one is grey, its tooltip says so, and its click queues.
- `src/client/hud/layers/BuildMenu.ts` — the grid's unaffordable item does the same
  (`queue`, `.build-button--queue`).
- `src/client/hud/layers/ControlPanel.ts` — `renderBuildQueue`, a strip under the readouts.
- `src/client/hud/GameRenderer.ts` — registers `BuildQueueController`.
- `resources/lang/en.json` — `build_menu.queue_hint`, `control_panel.queued`,
  `control_panel.cancel_queue`, `build_queue.queued` / `built` / `cancelled`.

#### FightWars-only files added

- `src/client/controllers/BuildQueueController.ts` — the one queued build, the once-a-second
  ask, the ordinary intent when it can.
- `tests/client/BuildQueue.test.ts` — holds and shows the build; asks once a second and sends
  nothing while it cannot; sends once and forgets when it can, with the rocket direction;
  cancel by chip or by asking again; a newer build replaces; death forgets; the grid and the
  radial both queue with the name and the rocket direction.

### The shadow simulation (Phase 7, session 13)

#### Shared upstream files edited

- `src/server/GameServer.ts` — `deps.shadowSim`; the shadow started with the game, handed
  every committed turn, asked before a gameplay intent joins a turn; `numShadowRefusals()`.
- `src/server/GameManager.ts`, `MetricsDashboard.ts`, `WorkerMetrics.ts` — the refusal count
  on the snapshot, the dashboard and the OTel gauge.
- `src/server/MapLandTiles.ts` — `mapFilePath` (the manifest's resolution, for any map file),
  `mapDirName` exported.
- `src/server/ServerEnv.ts` — `shadowSimEnabled()` (`SHADOW_SIM=off`).
- `src/server/DesyncDetector.ts` — `findOutOfSyncClients` and `check` take the server's own
  hash as the reference when there is one; a lone client is checked against it.
- `src/server/GameServer.ts` (winner) — a vote against the shadow's winner is overruled
  and counted; `archiveGame` records the shadow's winner and stats when it has them.
- `src/server/GameServer.ts` (caps) — `IntentCaps` consulted before the shadow on the
  gameplay path; `numSpamDrops()`.
- `src/core/game/TerrainMapLoader.ts`, `src/core/GameRunner.ts` — `useCache` /
  `{ freshMap }`: a game of its own map when a process runs several.
- `src/server/ShadowSim.ts` — the clock-only cooldowns (emoji, quick chat, embargo-all);
  `freshMap`.

#### FightWars-only files added (caps)

- `src/server/IntentCaps.ts` — per client, per family token buckets on the social intents.
- `tests/server/IntentCaps.test.ts` — the rate, clients and families apart, every social
  intent in a family and the game's own in none, never capping an attack.

#### FightWars-only files added (automation)

- `src/server/AutomationScorer.ts` — rate and evenness of a client's intent arrivals; a
  verdict once per client. Hooked in `GameServer.handleIntent`, `numAutomationFlags()`.
- `tests/server/AutomationScorer.test.ts` — nothing before the window fills, a machine's
  timing, a superhuman rate, a ragged hand left alone, a slow metronome left alone, once per
  client and clients apart.

#### FightWars-only files added

- `src/server/ShadowSim.ts` — the server's own `GameRunner`, the turn queue, the rule list.
- `src/server/ServerMapLoader.ts` — `GameMapLoader` over the server's map files.
- `tests/server/ShadowSim.test.ts` — the real sim on the plains test map: judges nothing
  before ready and applies the queued turns; never refuses when the map fails; control and
  spawn pass; no such client, disabled type, attacking self, unknown target, unknown unit,
  dead player, spawn after the phase, a unit that is not the sender's.
- `tests/server/GameServerShadow.test.ts` — started with the game, every turn handed over,
  a refusal is 403 and counted and kept out of the turn, control intents not asked about,
  the relay alone without a shadow.

### Game speed (Phase 6, the engine under Blitz, session 13)

#### Shared upstream files edited

- `src/core/Schemas.ts` — `GameConfig.gameSpeed` (1–4, optional, appended).
- `src/core/configuration/Config.ts` — `gameSpeed()`.
- `src/server/GameServer.ts` — `turnIntervalMs()` divides the deployment's interval by the
  lobby's speed, for the turn timer and the turn-stats budget.
- `src/client/LocalServer.ts` — the local pacing divides by it too.
- `src/client/hud/layers/GameRightSidebar.ts` — the clock in wall time.
- `src/client/components/GameConfigSettings.ts` — `GAME_SPEEDS`, the speed section,
  `game-speed-selected`.
- `src/client/HostLobbyModal.ts`, `src/client/SinglePlayerModal.ts` — the setting, pushed
  and sent.
- `resources/lang/en.json` — `host_modal.speed`, `game_speed.x1` / `x2` / `x4`.

#### FightWars-only files added

- `tests/GameSpeed.test.ts` — the default and the schema bounds, the server's turns per
  second at each speed, the sim's config untouched by it.
- `tests/client/GameSpeedSettings.test.ts` — three cards with the chosen one pressed, the
  event, the section absent when not offered, the host pushing the pick.

### Blitz in the public rotation (Phase 6, session 13)

#### Shared upstream files edited

- `src/core/Schemas.ts`, `src/core/game/Game.ts` — `publicGameModifiers.isBlitz`.
- `src/server/MapPlaylist.ts` — the modifier: compact forced, `gameSpeed` 4,
  `maxTimerValue` 20, four tickets, exclusive with peace time and the doomsday clock.
- `src/client/Utils.ts` — the "Blitz" badge.
- `resources/lang/en.json` — `public_game_modifier.blitz`, `blitz_label`.

#### FightWars-only files added

- `tests/server/MapPlaylistBlitz.test.ts` — 4× on a compact map with a five-minute clock; a
  special game without it untouched; in the pool and never beside a peace time or a clock.
- `tests/client/BlitzModifierBadge.test.ts` — the badge, present and absent.

### Battle Royale (Phase 6, session 13)

#### Shared upstream files edited

- `src/core/Schemas.ts` — `GameConfig.battleRoyale` (appended), `publicGameModifiers.isBattleRoyale`.
- `src/core/game/Game.ts` — `PublicGameModifiers.isBattleRoyale`, `MessageType.BATTLE_ROYALE_SHRINK`.
- `src/core/configuration/Config.ts` — `battleRoyale()` and the schedule accessors.
- `src/core/GameRunner.ts` — registers the execution when the flag is on.
- `src/server/MapPlaylist.ts` — the modifier, three tickets, exclusive with the clock and Blitz.
- `src/client/HostLobbyModal.ts`, `src/client/SinglePlayerModal.ts` — the toggle.
- `src/client/Utils.ts` — the badge and the event colour.
- `scripts/balanceRun.ts` — `--battle-royale`.
- `resources/lang/en.json` — `game_settings.battle_royale`, `public_game_modifier.battle_royale`, `events_display.battle_royale_shrink`.

#### FightWars-only files added

- `src/core/execution/BattleRoyaleExecution.ts` — the zone.
- `tests/BattleRoyale.test.ts` — the schedule, the edge irradiated and relinquished, the
  centre untouched, a unit outside destroyed, nothing with the flag off.

### Capital Strike (Phase 6, session 13)

#### Shared upstream files edited

- `src/core/Schemas.ts` — `GameConfig.capitalStrike` (appended), `publicGameModifiers.isCapitalStrike`.
- `src/core/game/Game.ts` — `PublicGameModifiers.isCapitalStrike`, `MessageType.CAPITAL_FELL`.
- `src/core/configuration/Config.ts` — `capitalStrike()`.
- `src/core/GameRunner.ts` — registers the execution when the flag is on.
- `src/server/MapPlaylist.ts` — the modifier, three tickets.
- `src/client/HostLobbyModal.ts`, `src/client/SinglePlayerModal.ts` — the toggle.
- `src/client/Utils.ts` — the badge and the event colour.
- `scripts/balanceRun.ts` — `--capital-strike`.
- `resources/lang/en.json` — `game_settings.capital_strike`, `public_game_modifier.capital_strike`, `events_display.capital_fell`.

#### FightWars-only files added

- `src/core/execution/CapitalStrikeExecution.ts` — the collapse.
- `tests/CapitalStrike.test.ts` — the collapse, a capital lost to fallout, a held capital, the
  flag off.
- `tests/server/MapPlaylistModes.test.ts` — Battle Royale and Capital Strike through the
  rotation to the config and the lobby card.

### King of the Hill (Phase 6, session 13)

#### Shared upstream files edited

- `src/core/Schemas.ts` — `GameConfig.kingOfTheHill` (appended), `publicGameModifiers.isKingOfTheHill`.
- `src/core/game/Game.ts` — `PublicGameModifiers.isKingOfTheHill`, `MessageType.HILL_STANDING`.
- `src/core/configuration/Config.ts` — `kingOfTheHill()`, `hillRadiusPercent()`, `hillSecondsToWin()`.
- `src/core/GameRunner.ts` — registers the execution when the flag is on.
- `src/server/MapPlaylist.ts` — the modifier, three tickets, exclusive with the clock and Battle Royale.
- `src/client/HostLobbyModal.ts`, `src/client/SinglePlayerModal.ts` — the toggle.
- `src/client/Utils.ts` — the badge and the event colour.
- `scripts/balanceRun.ts` — `--king-of-the-hill`.
- `resources/lang/en.json` — `game_settings.king_of_the_hill`, `public_game_modifier.king_of_the_hill`, `events_display.hill_standing` / `hill_unheld` / `hill_won`.

#### FightWars-only files added

- `src/core/execution/KingOfTheHillExecution.ts` — the hill.
- `tests/KingOfTheHill.test.ts` — the hill's place and land, scoring and the win, an empty
  hill, a tie, the centre moved onto land.
- `tests/server/MapPlaylistModes.test.ts` — gains the hill.

### The zone layer (Phase 6, session 13)

#### Shared upstream files edited

- `src/core/game/GameUpdates.ts` — `GameUpdateType.Zone`, `ZoneKind`, `ZoneUpdate`.
- `src/core/execution/BattleRoyaleExecution.ts`, `KingOfTheHillExecution.ts` — send it.
- `src/client/view/GameView.ts` — one live zone per kind, `FrameData.zones`.
- `src/client/render/types/Renderer.ts`, `types/index.ts`, `types/FrameData.ts` — `ZoneData`.
- `src/client/render/frame/Upload.ts` — `updateZones` on the upload target.
- `src/client/render/gl/MapRenderer.ts`, `gl/Renderer.ts` — the pass, wired and drawn.

#### FightWars-only files added

- `src/client/render/gl/passes/ZonePass.ts`, `src/client/render/gl/shaders/zone/zone.vert.glsl`,
  `zone.frag.glsl` — the ring and the hill.
- `tests/client/view/ZoneView.test.ts` — the view's zones.

### Survival (Phase 6, session 13)

#### Shared upstream files edited

- `src/core/Schemas.ts` — `GameConfig.survival` (appended), `publicGameModifiers.isSurvival`.
- `src/core/game/Game.ts` — `PublicGameModifiers.isSurvival`, `MessageType.SURVIVAL_WAVE`.
- `src/core/configuration/Config.ts` — `survival()`, `survivalWaveTicks()`, `survivalWaveTroopShare()`, `survivalWaveGold()`, `survivalSeconds()`.
- `src/core/GameRunner.ts` — registers the execution when the flag is on.
- `src/server/MapPlaylist.ts` — the modifier, three tickets, forces team mode and Humans vs Nations.
- `src/client/HostLobbyModal.ts`, `src/client/SinglePlayerModal.ts` — the toggle, sending team mode and the preset.
- `src/client/Utils.ts` — the badge and the event colour.
- `scripts/balanceRun.ts` — `--survival`.
- `resources/lang/en.json` — `game_settings.survival`, `public_game_modifier.survival`, `events_display.survival_wave` / `survival_won` / `survival_lost`.

#### FightWars-only files added

- `src/core/execution/SurvivalExecution.ts` — the waves and the clock.
- `tests/Survival.test.ts` — the sides, the waves, the win, the loss, the flag off.
- `tests/server/MapPlaylistModes.test.ts` — gains the forcing.

### Blitz in one click (Phase 6, session 13)

#### Shared upstream files edited

- `src/client/components/GameConfigSettings.ts` — `BLITZ_PRESET`, the card, `blitz-preset-selected`, `gameSpeed.blitz`.
- `src/client/HostLobbyModal.ts`, `src/client/SinglePlayerModal.ts` — the handler and `isBlitzPreset()`.
- `resources/lang/en.json` — `host_modal.blitz_preset_hint`.

#### FightWars-only files edited

- `tests/client/GameSpeedSettings.test.ts` — the card, the event, both modals building
  the same Blitz, the press released when any of the three moves.

### Placements (Phase 6, session 13)

#### Shared upstream files edited

- `src/core/ApiSchemas.ts` — `PlacementSchema`, `placement` on the user-me leaderboard entries.
- `src/client/components/RankedModal.ts` — `rankedStanding`, the placement line on the card.
- `resources/lang/en.json` — `matchmaking_modal.placement`.

#### FightWars-only files edited

- `src/api/Matches.ts` — `PLACEMENT_GAMES`, `placementOf`.
- `src/api/ProfileRoutes.ts` — the profile's `placement`, the ladder filter.
- `src/api/App.ts` — `placement` on `/users/@me`.
- `tests/api/Profiles.test.ts` — the placement case.

#### FightWars-only files added

- `tests/client/RankedStanding.test.ts` — the card's line.

### Historical scenarios (Phase 6, session 13)

#### Shared upstream files edited

- `src/core/Schemas.ts` — `GameConfig.scenario` (appended).
- `src/core/configuration/Config.ts` — `scenario()`.
- `src/core/game/Game.ts` — `Nation.doctrine`.
- `src/core/game/NationCreation.ts` — `scenarioNations`, the scenario branch.
- `src/core/execution/NationExecution.ts` — the doctrine handed to the spawn.
- `src/client/components/GameConfigSettings.ts` — the Scenario section, `scenario-selected`.
- `src/client/HostLobbyModal.ts`, `src/client/SinglePlayerModal.ts` — the pick and what it sets.
- `resources/lang/en.json` — `host_modal.scenario`, `scenario.*`.

#### FightWars-only files added

- `src/core/game/Scenarios.ts` — the four casts.
- `tests/Scenarios.test.ts` — the manifests, the cast, the doctrine kept, the unknown id.

### Draft (Phase 6, session 13)

#### Shared upstream files edited

- `src/core/Schemas.ts` — `GameConfig.draft`, `DraftPickIntentSchema` (appended to the intent union), `DraftInfoSchema`, `GameInfo.draft`.
- `src/server/GameServer.ts` — the draft state, `draft_pick`, pins on the lobby list and the start.
- `src/server/IntentAuthorization.ts` — `draft_pick`.
- `src/server/ConfigPatch.ts` — the mode keys a host may edit.
- `src/client/Transport.ts`, `src/client/Main.ts` — `SendDraftPickIntentEvent`, the `draft-pick` event.
- `src/client/components/LobbyPlayerView.ts` — the draft board.
- `src/client/HostLobbyModal.ts`, `src/client/JoinLobbyModal.ts` — the toggle, the board wired.
- `resources/lang/en.json` — `game_settings.draft`, `host_modal.draft_*`.

#### FightWars-only files added

- `tests/server/Draft.test.ts`, `tests/client/LobbyDraft.test.ts`.
- `tests/server/ConfigPatch.test.ts` — gains the mode keys.

### The match report (Phase 6, session 13)

#### Shared upstream files edited

- `src/client/view/GameView.ts` — the timeline fed every fifty ticks and on every broken alliance.
- `src/client/hud/layers/WinModal.ts` — `<match-report>` at the top, the win's stats kept for it.
- `resources/lang/en.json` — `win_modal.report_*`, `win_modal.gold_*`, `win_modal.betrayed`.

#### FightWars-only files added

- `src/client/view/MatchTimeline.ts`, `src/client/hud/layers/MatchReport.ts`.
- `tests/client/view/MatchTimeline.test.ts`, `tests/client/MatchReport.test.ts`.

### The caster view (Phase 6, session 13)

#### Shared upstream files edited

- `index.html` — `<caster-panel>`.
- `src/client/hud/GameRenderer.ts` — wired and in the controller list.
- `src/client/hud/layers/MatchReport.ts` — the chart moved out.
- `resources/lang/en.json` — `caster.*`.

#### FightWars-only files added

- `src/client/hud/layers/CasterPanel.ts`, `src/client/hud/layers/TerritoryChart.ts`.
- `tests/client/CasterPanel.test.ts`.

### Rulesets (Phase 6, brief §6.9, session 13)

#### Shared upstream files edited

- `src/core/Schemas.ts` — `RulesetSchema`, `GameConfig.ruleset` (appended).
- `src/core/configuration/Config.ts` — `tunable` / `tunableGold` and 92 accessors reading through them.
- `src/server/ConfigPatch.ts` — `ruleset`.
- `src/client/HostLobbyModal.ts` — the Custom rules editor; `src/client/JoinLobbyModal.ts` — the count.
- `scripts/balanceRun.ts` — `--ruleset <file>`; `package.json` — `rules:export`.
- `resources/lang/en.json` — `host_modal.rules_*`.

#### FightWars-only files added

- `src/core/configuration/Tunables.ts`, `resources/rulesets/default.json`, `scripts/exportRuleset.ts`.
- `tests/Ruleset.test.ts`, `tests/client/RulesEditor.test.ts`.

### The radial menu on the keyboard (Phase 7, session 13)

#### Shared upstream files edited

- `src/client/hud/layers/RadialMenu.ts` — keyboard handling, `activate`, roles and labels, the live region.
- `src/client/hud/layers/MainRadialMenu.ts` — `M` opens it.
- `resources/lang/en.json` — `radial_menu.label`.

#### FightWars-only files added

- `tests/client/graphics/RadialMenuKeyboard.test.ts`.

### The balance dashboard and the cold-load gate (Phase 7, session 13)

#### Shared upstream files edited

- `src/server/GameServer.ts` — `balanceSnapshot()`, `BalanceSnapshot`.
- `src/server/GameManager.ts` — `balance` on the metrics snapshot.
- `.github/workflows/ci.yml` — `coldload:gate` after the build; `package.json` — the script.

#### FightWars-only files edited or added

- `src/server/ShadowSim.ts` — `game?()` on the interface; `src/server/MetricsDashboard.ts` — the balance table.
- `scripts/coldLoadGate.ts`, `scripts/coldLoadModel.ts`.
- `tests/server/BalanceMetrics.test.ts`, `tests/scripts/ColdLoadModel.test.ts`.
