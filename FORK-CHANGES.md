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

- `src/core/configuration/Config.ts` — `unitUpkeep(type, player)` (the table, scaled by the lobby
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
- `src/core/configuration/Config.ts` — `unitMaterialsCost` (the table), `factoryMaterialsPerTick`,
  `startingMaterials`; `unitInfo` decorates every non-zero type once, at the cache, so every
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
  partners the nation likes, the coalition rule, free help for a full ally.
- `src/core/configuration/Config.ts` — `allianceTiersEnabled`, `allianceBreakTraitorScale`,
  `coalitionThreshold`.
- `src/client/Utils.ts` — `COALITION_OFFER` gets the warn colour (the exhaustiveness test
  console-warns on any message type without one).
- `src/client/Transport.ts`, `src/client/hud/layers/ActionableEvents.ts`,
  `src/client/hud/layers/PlayerPanel.ts`, `resources/lang/en.json` — the intent carries the
  rung, the incoming card names it and accepts at it, the coalition card, the button label.
- `scripts/balanceRun.ts` — `--flat-alliances`, `--no-coalition`, and an alliances line.
- `tests/NationAllianceBehavior.test.ts` — the mock request gained `tier: () => FullAlliance`;
  three fixtures with alliance-view literals gained `tier: 3`.

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
