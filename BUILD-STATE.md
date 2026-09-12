# FightWars Build State

Last session: 2026-09-12 (session 6) | Current phase: 4 (identity) — 5 of its 10 work items done and a 6th part-done, with two Phase 2 items still blocked on the owner/hardware | Build status: green

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

Dev server: `npm run dev` → http://localhost:9000 (Vite) + game server (master 3000, workers
3001/3002) + API (8787). If something else holds 3000 (on this box the `vitality-web` Next
dev server does), `npm run dev:alt` runs the master on 3200 (`MASTER_PORT`; Vite's proxy
follows it). In the Claude desktop session the launch configs `fightwars-dev` /
`fightwars-dev-alt` (session `.claude/launch.json`) start them — check
`netstat -ano | findstr :3000` first: a master that cannot bind exits and the client then
shows an empty lobby list with `/w0/lobbies` websocket errors. Load harness:
`npm run load:test -- --clients 150 --map world --turns 600`.

## Handoff — read this first (written 2026-09-12 at the end of session 7)

- **The plan for everything that remains (Phases 4–7 and the blocked items) is
  `docs/HANDOFF.md`.** This section is the per-session resume; that file is the map. Its §3
  now carries a per-item handoff for each unfinished Phase 4 item — entry points, what is
  already there, the approach, and the traps — written after doing five of them.

- Tree is clean and pushed; HEAD is on `origin/main`. Nothing is mid-flight, no background
  process is running, the dev stack is stopped.
- **First commands:** `git fetch upstream && git rebase upstream/main` (then
  `git push --force-with-lease origin main` — the branch is ours), `npm run inst` if
  `package-lock.json` changed, then the gate block above. At the end of session 5 upstream
  had no new commits (21 ahead, 0 behind), so no rebase was needed. Expect rebase conflicts in the
  brand-swept files and also in `src/client/AccountIdentity.ts`, `ClanModal.ts`,
  `ClanDetailView.ts`, `ClientGameRunner.ts` (turn handling now goes through
  `TurnSequencer`) and `vite.config.ts` (coverage floor), plus the tests that pin the
  guest-is-signed-in rule.
- **Phase 3 is done**: `docs/BASELINE-VERIFICATION.md` maps every brief §5 item to the test
  that pins it (every path checked to exist), the rejoin-after-reload turn drop is fixed,
  the untested verbs/bots/attack record have tests, and `src/core` coverage has a CI floor.
  Two Phase 2 items remain blocked here: Discord login (needs a Discord application
  id/secret only the owner can create) and the compose stack (no Docker on this box).
- **Phase 4 (identity) is under way: 6 of 10 done, 2 part-done.** Done: nation colours + the
  three dichromat palettes; the clan create form; the attack-cost breakdown on hover **and the
  live spend during an attack (item 4)**; the display face and brand marks; the account page.
  Part-done: **item 3** has political blocks
  and borders that survive sub-pixel, but not the halo/flash legibility the brief also asks
  for; **item 5** has the sounds, the flash and the shake, but not the border wave or the nuke
  ring; **item 6** has had its palette and typography but not its layout or `dataviz` pass.
  Untouched: the live "cost so far" (item 4), mobile (7), the tutorial (8), and the
  build-queue / rally-point / attack-preset intents (9, do last — the only one that touches the
  simulation). See `docs/HANDOFF.md` §3.

- **Session 7, in order, with what each left behind:**
  1. **The client perf harness runs again.** `npm run perf:client` had never run — `src/client/Api.ts`
     registers a `session-cleared` listener at module scope and WebGLFrameBuilder reached it
     through Cosmetics, so importing the code under test threw `document is not defined`.
     Fixed by splitting the cosmetics _cache_ into `src/client/CosmeticsCache.ts`, a leaf the
     renderer can depend on without dragging in Api, Payments, InGameModal and lit-html.
     `perf:client-mem` and `perf:client-tick` no longer `spawn npx ENOENT` on Windows, but
     **still cannot be run here**: they need the run-openfront Chromium setup, which is
     Linux-only (apt-get, .deb).
     **Baseline, World / 400 bots / 1800 ticks:** main-thread burst mean 0.99 ms, p95 1.12 ms,
     p99 21.1 ms, max 140 ms, 20/1800 ticks over the 16.7 ms frame budget. View hash `5333c99b`.
  2. **Item 3, zoom legibility.** A pixel that covers several tiles now shows whoever holds
     most of it, decoration fades out over the same range, and the outline uses the same
     footprint so it survives below a pixel. Off above one CSS pixel per tile — verified
     indistinguishable at 2.5 px/tile. `mapOverlay.politicalZoom` turns it off.
  3. **Item 5, feel.** The four orphan sound files are wired; screen shake and a nuke flash
     exist.

- **The browser pane renders WebGL2.** This changes what is verifiable here: appearance can be
  checked on a real GPU, and was, for both item 3 and the flash. Frame _rate_ still cannot —
  the pane's timings say nothing about a real machine. Recipe: `npm run dev:alt` (port 3000 is
  taken on this box by something else), open `http://localhost:9000`, click Solo, set
  `document.querySelector('single-player-modal').bots = 400` before Start, and drive the camera
  with `document.querySelector('build-menu').transformHandler` (`targetScale = null` first, or
  the smoothing pulls your scale back).
- **A/B a graphics setting on one live game** rather than comparing two: write
  `localStorage["settings.graphics"]`, then dispatch
  `event:user-settings-changed:settings.graphics`. ClientGameRunner re-resolves the settings
  onto the renderer's live object. Worth knowing — the first before/after taken for item 3 was
  confounded by a hundred ticks of bot consolidation and overstated the result.
- **`npm test` is not reliably green on this box, and it is load, not code.** Runs this session
  produced 1, 3 and 8 failures, never the same set; every failing file passes on its own. The
  5-second default timeout is the thing that breaks — one full run logged 92 s of transform and
  71 s of import. Check a failure in isolation before believing it.
- **`npm run perf:gate` also fails under load** (mean 11 ms against a budget of 8). A clean tree
  stashed to the same commit fails identically with the same final hash, so it is the machine.
  It passed at 2.46 ms earlier in the same session with nothing else running.
- **The shake is now verified** — the console can drive it directly
  (`document.querySelector('build-menu').transformHandler.shake.add(60, performance.now())` in a
  rAF loop), which beats staging a nuke. What has _not_ been watched is the flash and shake
  firing from a real detonation, i.e. `ImpactFeedbackController` picking the event up. Build a
  silo, launch an atom bomb; that is the remaining five minutes.
- **The direction, stated once and carried through:** dark, map-first, the map the only
  saturated surface. Within that, one decision now encoded in every palette — **players are
  vivid, AI nations are muted**, so a glance separates people from scenery before any label
  is read. Keep it. `frontend-design` is still the skill to load before the _visual_
  identity work (wordmark, font, chrome); the three items done so far were colour science,
  a form and a tooltip, not visual identity.
- **Phase 4 so far** (details in the three commits, which carry the reasoning):
  - **Palettes.** `default`, `deuteranopia`, `protanopia`, `tritanopia`, generated offline by
    `npm run palettes:generate` (`scripts/generatePalettes.ts`) and committed as data.
    Farthest-point sampling over an OKLCH lattice; 128 human + 128 nation + 128 overflow
    colours each. The old single `colorblind` palette is gone; stored settings carrying it
    map to `deuteranopia` (rewritten _before_ schema validation, so an unknown enum member
    cannot discard the player's other graphics settings).
    Measured minimum CIEDE2000 separation, as that palette's viewer sees it —
    **raise the floors in `tests/client/Palette.test.ts` if a better generator earns it:**

    | palette      | first 120 | whole 256 | 24-player lobby (allocated) | team colours |
    | ------------ | --------- | --------- | --------------------------- | ------------ |
    | default      | 7.65      | 7.41      | 16.1                        | 42.8         |
    | deuteranopia | 3.07      | 2.91      | 6.8                         | 19.7         |
    | protanopia   | 3.28      | 3.08      | 7.1                         | 19.1         |
    | tritanopia   | 5.66      | 5.44      | 9.8                         | 22.0         |

    The lobby column is the one that matters and the one the allocator fix moved: themes now
    declare their vision and `ColorAllocator` measures distance in it, so "most distinct"
    means distinct to the player who _chose_ that palette. Before the fix the dichromat
    lobbies sat at 3.7–5.5.
    Two caveats to be honest about: ~3 ΔE across a full 256-colour dichromat pool is close
    to the physical limit of a dichromat's colour volume, not a number that can be tuned
    much higher; and territory renders at alpha 150/255 over terrain, so on-screen
    differences are smaller than these palette-space figures. Verified live on the World map
    (~107 nations) in all four palettes.

  - **Clan create form.** `POST /clans` finally has a client. `createClan` in `ClanApi.ts`,
    `ClanCreateView.ts`, offered only where a clan is missing (one clan per account makes a
    permanent Create tab a dead end). Creating sets the leader role locally — `getUserMe()`
    memoises the profile for the session, so refetching answers from a cache that predates
    the clan; the first version offered the new clan's own leader a "Join clan" button.
  - **Attack cost on hover.** `PlayerInfoOverlay` now shows, per tile, what an attack costs
    you and them, how fast the front advances, and the multipliers in play.
    `Config.attackLogic` takes an optional out-parameter and fills in every named factor, so
    the explanation is the simulation's own arithmetic rather than a second copy;
    `tests/AttackBreakdown.test.ts` recomposes the formula from those fields across 2000
    random cases and requires an exact match. Perf gate unchanged (mean 2.38 ms, 0
    over-budget ticks). **Still open from the brief's G3:** the live "cost so far" needs
    `startTroops` / `tilesConquered` on `AttackUpdate`, which `AttackImpl` does not track.
    The modifier row (defense post, fallout, traitor, tribe) is covered by tests but has not
    been seen in a live game — none of those was in reach during the verification run.

- **Found while there, not yet fixed:** `BRAND.assets.socialImage` still points at
  `resources/images/GameplayScreenshot.png`, which came from upstream (commits #1692,
  #2063). It is a screenshot of _OpenFront's_ UI, so the og:image misrepresents the product,
  and it now also shows the pre-Phase-4 palette. Replacing it needs a clean capture of our
  own client at 1200x630; the browser pane can frame one but cannot write it to disk, so it
  wants the Node asset pipeline (`resources/` images are generated in Node — see Phase 1).
- **The client perf harness does not run, and this predates session 6.** `npm run perf:client`
  dies with `ReferenceError: document is not defined` (`src/client/Api.ts` adds a
  `session-cleared` listener at module scope and the script imports it into plain Node);
  `perf:client-mem` and `perf:client-tick` die with `spawn npx ENOENT`, because they spawn
  `npx vite` without `shell: true`, which does not work on Windows. Reproduced at
  `dfef14c60`, so it is not fallout from the Phase 4 work. The renderer item's stated
  verification depends on it. `npm run perf:gate` — the headless _simulation_ budget — is
  unaffected and passes (mean 5.76 ms, 0 over-budget ticks).
- `npm run test:coverage` now fails if `src/core` drops below the floor in `vite.config.ts`
  (lines 85 / functions 83 / branches 77 / statements 84). Raise the floor as coverage grows.
- **A two-player browser test** now needs no localStorage trick: open the second player at
  `http://[::1]:9000` (a different origin, so its own persistent id and guest account; the
  API's CORS default allows it). Vite listens on IPv6 loopback only, so `127.0.0.1` will not
  connect. Ranked 1v1 was verified this way (see Done).
- The API keeps its data in memory unless `PGLITE_DIR` or `DATABASE_URL` is set. The API
  process is plain `tsx` with no watcher: after editing `src/api/**` restart the stack.
- Clan creation has **no client UI** (upstream creates clans on its website). To seed one in
  dev, POST to the API with the browser's persistent id as the bearer (dev accepts a raw id):
  `curl -X POST localhost:8787/clans -H "Authorization: Bearer <player_persistent_id>" -H "Content-Type: application/json" -d '{"tag":"FWX","name":"Testers"}'`.
- Known flaky under CPU contention only: `tests/client/InventoryModal.test.ts` and
  `MainInitialize.test.ts`. Run `npm test` on a quiet box; they pass alone every time.

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
- [x] Phase 2: **clans** (`src/api/ClanRoutes.ts`, migration 0005): every route
      `src/client/ClanApi.ts` calls — create/browse/detail/PATCH/disband, members with
      per-bucket W/L and sorting, join/requests/approve/deny/withdraw, kick/promote/demote/
      transfer, ban/unban, clan game history with cursor, the weighted-wins leaderboard from
      `docs/API.md` (30-day half-life, 90-day window, 60 s cache), `/public/clan/:tag/exists`,
      and a real `/reserved_clan_tags` (the game server now drops impersonated tags at join).
      Verified in the real client: browse, my clans, detail, members (with stats), game history.
- [x] Phase 2: **friends** (`src/api/FriendRoutes.ts`, migration 0006) per
      `src/client/FriendsApi.ts`; `/users/@me` carries `clans`, `clanRequests`, `friends`.
- [x] Phase 2: **public games** (`src/api/GamesRoutes.ts`): `/public/games` with the documented
      filters and `Content-Range`; `/public/game/:id?turns=false`. `GET /game/:id` now scrubs
      persistent ids and reports (it leaked them).
- [x] Phase 2: **profile stats tree** (`src/api/StatsTree.ts`) in `PlayerStatsTreeSchema` shape
      — bigint stats summed per type/mode/difficulty, ranked apart, recent form — plus clans
      on the profile and real `playerTeams`/`rankedType`/`clanTag` in history. Migration 0004
      adds those columns and backfills them from stored records (`tests/api/Migrations.test.ts`
      proves the backfill). Verified in the client's profile modal.
- [x] Phase 2: **ladder seasons** (migration 0007): `LADDER_SEASON` (default `1`) is the season
      new results accrue to; `?season=` reads older ones on both leaderboards.
- [x] Phase 2: **ranked in the browser**: two guests on two origins queued for 1v1, the API
      paired them, both loaded the same game on worker 1 and simulated in lockstep.
- [x] Phase 2: **CI "API on Postgres" job** — `tests/api` against a `postgres:16` service with a
      database per test file (`tests/api/fixtures.ts`), so `PgDb` is exercised on every push.
- [x] Client: FightWars guests count as signed in (`responseHasLinkedIdentity` is the one
      gate: ranked, account button, lobby card, warnings, clan modal). The clan Donate button
      and Donations tab sit behind `BRAND.monetisation.store` (they opened the store checkout).
- [x] API serves `/news.json` and `/streams.json` from `resources/` (the menu 404'd on them),
      answers errors as JSON, and its dev CORS list includes the loopback aliases.
- [x] Phase 3: **baseline verification** — `docs/BASELINE-VERIFICATION.md`: brief §5 item by
      item (loop, resources, attack model, structures, every diplomacy verb, lobby matrix,
      maps, controls) with the test or recorded run that pins each, and the deviations
      (80 % win threshold, no Fast speed, 120 maps, cost-table differences) cross-referenced
      to the decisions below.
- [x] Phase 3: **rejoin repair** — `src/client/TurnSequencer.ts`: live turns that outrun the
      start snapshot after a reload are held and applied in order instead of dropped with an
      error each (122 in one observed rejoin). One warning per gap.
- [x] Phase 3: **coverage on the core** — new tests for the intent dispatcher (every wire
      intent → its execution; unknown client → no-op), every untested diplomacy verb
      (embargo, embargo-all, emoji, target, retreat, boat retreat, pause), bots
      (`TribeExecution`), the attack record (`AttackImpl` border + front clustering) and the
      delete-unit cooldown branches. Floor for `src/core/**` in `vite.config.ts`, enforced
      by CI's `npm run test:coverage`.
- [x] Phase 3: the two flaky client files got the timeouts they need on a loaded box
      (`MainInitialize` hook 90 s, `InventoryModal` cases 30 s); they were only ever
      contention timeouts.

## In progress

- [ ] Nothing mid-flight. The tree is committed and green.

## Next up (concrete, ordered)

1. **Rebase check** at session start: `git fetch upstream && git rebase upstream/main`; fix
   conflicts (expect some in `index.html`, nav bars, Footer, SoundManager — the brand sweep
   touched them); rerun all gates.
2. **Phase 4 — identity** (Section 7 of the brief in full). Load `frontend-design` before
   any UI code; then `ui-ux-pro-max` for palette/type, `dataviz` before any chart or stat
   tile, and `impeccable` + `web-design-guidelines` on the result. Includes: a clan create
   form, a guest-appropriate account page (it still offers Discord/Google login), the
   `og:image` replacement, and the final display font.
3. **Phase 2 leftovers, when unblocked:** Discord OAuth login attached to the same account row
   (`/auth/discord`) — needs a Discord application client id/secret (owner). Run
   `docker-compose.yml` on a box with Docker; fix what breaks; point the desync webhook and
   the metrics dashboard at real alerting (hardware). Load harness: `--server-pid` sampling
   is unmeasured; a 500-lobby cluster run needs more workers/hosts than this box. Confirm a
   finished ranked game ingests with `rankedType` and rates on the ladder end to end.
4. Phase 5 (depth) after Phase 4. The cooldowns that count from tick 0 (delete unit,
   embargo-all, target) are upstream behaviour worth revisiting when rebalancing.

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
- 2026-09-12 — **A session is an account.** Every player is a guest account keyed by
  persistent id, so the client's identity gate (`responseHasLinkedIdentity`) is true for any
  `/users/@me` response; a linked Discord/Google/Steam login is an extra, not the threshold.
- 2026-09-12 — One clan per account (primary key on `clan_members.persistent_id`); tags are
  2–5 alphanumerics stored uppercase; leader > officer > member and you only act on ranks
  below yours; clan currency does not exist (no store), so donations are empty and `donate`
  is 400.
- 2026-09-12 — Clan member stats and the clan leaderboard count only games played while
  wearing the tag (`match_players.clan_tag`), and the leaderboard is public team games only,
  per `docs/API.md`.
- 2026-09-12 — Ladder seasons are an environment variable (`LADDER_SEASON`), not a table: a
  new season is a deploy with a new value; old seasons stay readable by query.
- 2026-09-12 — Public record routes (`/game/:id`, `/public/game/:id`) never carry persistent
  ids or reports.

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
- Two browser tabs in one profile share `localStorage`; use `http://[::1]:9000` for the
  second player instead (see Handoff).
- Client fps on a real GPU not measured (sandbox browser is software-rendered).
- Linked logins (Discord/Google/Steam) are still non-functional: the account page offers
  them and none is configured. Guests work everywhere else.
- No clan-creation UI in the client (upstream's lives on its website). Seed via the API.
- Rejoin after a mid-game reload: fixed in Phase 3 (`TurnSequencer`); one warning per gap
  remains by design.
- The discord card on a clan overview says "invite is no longer valid" for any invite the
  browser cannot resolve against Discord's public API (offline / fake invite) — expected.

## Numbers last measured (2026-09-12, this machine, upstream 7d95251f1 + Phase 1)

- Determinism test: **pass** — quick 3/3 in ~17 s; full (world, 150 bots, 8 humans,
  24 000 ticks, 5 processes) 3/3 in 206 s.
- `npm test` (session 4): 478 + 67 files, 5656 + 673 tests, ~165 s. `tests/api` alone: 14
  files, 220 tests, ~10 s on PGlite.
- **`src/core` coverage (session 4, `npm run test:coverage`)**: lines 87.2 %, functions
  86.1 %, branches 80.3 %, statements 86.3 % (execution/ 88.0 / 89.3 / 80.0 / 86.6; game/
  88.7 / 87.3 / 83.0 / 88.2). Before Phase 3: 85.5 / 83.6 / 78.8 / 84.5. Floor in
  `vite.config.ts`: 85 / 83 / 77 / 84 — watched to fail on a single test file. Weakest core
  files now: `TerrainMapLoader.ts` 36 %, `MotionPlans.ts` 52 %, `FetchGameMapLoader.ts` 56 %
  (loaders exercised by the browser and load harness, not unit tests), `NationCreation.ts`
  69 %, `NationEmojiBehavior.ts` 77 %, `TransportShipExecution.ts` 78 %.
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
