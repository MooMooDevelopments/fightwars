# FightWars — handoff for the rest of the build

Written 2026-09-12 at the end of session 4. Phases 0–3 of the build brief are done; this is
the plan for Phases 4–7 and the items still blocked, written so that a fresh session (or a
person) can carry it without the conversation that produced it. `BUILD-STATE.md` stays the
per-session resume file; this document is the map of everything that remains.

## 1. Where things stand

| Phase | Brief section      | Status                                                                                                                                                                                                                                     |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | Audit              | Done. `docs/MECHANICS.md` (every system, formula, file, hook point), determinism gate, solo win, two-window lobby.                                                                                                                         |
| 1     | Foundation         | Done. Brand module, proprietary assets replaced, AGPL attribution, CI (tests, determinism, perf, licences, lint, maps).                                                                                                                    |
| 2     | Infrastructure     | Done except two blocked items (§6). API (`src/api/`): guest accounts, Glicko-2 ladders with seasons, ranked queues, profiles, clans, friends, public games; load harness; desync alerting; replay store; metrics; Postgres CI job.         |
| 3     | Parity and repair  | Done. `docs/BASELINE-VERIFICATION.md`, rejoin repair, tests for every verb, core coverage floor in CI.                                                                                                                                     |
| 4     | Identity           | **In progress: 5 of 10 items done, 1 part-done (see §3).** The visual direction is set and carried through: dark, map-first, players vivid and nations muted, one amber signal. Own face (Barlow Condensed/Barlow), own mark, own palette. |
| 5     | Depth              | Not started. Every hook point is already written down in `docs/MECHANICS.md` "Gaps vs FightWars brief" (§01–§05).                                                                                                                          |
| 6     | Modes and metagame | Ranked, seasons and clans (server side) exist from Phase 2; the rest not started.                                                                                                                                                          |
| 7     | Hardening          | Determinism, load harness, desync alerting and licence gate exist; server-side intent validation, anti-automation, fog filtering, accessibility audit, i18n audit not started.                                                             |

Repo: `C:\Users\disbo\dev\fightwars` (`origin` = github.com/MooMooDevelopments/fightwars, public;
`upstream` = openfrontio/OpenFrontIO). Brief:
`Claude Memories/fightwars-autonomous-prompt.md`. Tests: 484 + 67 files, 5791 + 673 tests.
`src/core` coverage 87 % lines with a CI floor of 85.

## 2. How to resume (every session, in this order)

1. Read `BUILD-STATE.md` (Handoff section first), then this file's section for the phase
   you are in.
2. `git fetch upstream && git rebase upstream/main`, `git push --force-with-lease origin main`.
   Expect conflicts in the brand-swept client files, `AccountIdentity.ts`, `ClanModal.ts`,
   `ClanDetailView.ts`, `ClientGameRunner.ts`, `vite.config.ts`.
3. Gates, all green before advancing: `npm test`, `npm run test:determinism` (`:full`
   nightly in CI), `npm run lint`, `npx prettier --check .`, `npx tsc --noEmit`,
   `npm run licenses:check`, `npm run perf:gate`, `npm run test:coverage` (core floor).
4. Dev stack: `npm run dev` (Vite 9000 + game master 3000 + workers 3001/3002 + API 8787).
   If 3000 is taken, `npm run dev:alt` (master on 3200). A second player for two-tab tests
   lives at `http://[::1]:9000` (its own origin, its own guest). The API has no watcher;
   restart the stack after editing `src/api/**`.
5. Commit at every working increment. Keep `FORK-CHANGES.md` (every upstream file touched),
   `docs/MECHANICS.md` (balance), `BUILD-STATE.md` (end of every session) current. The brief
   also asks for `CHANGELOG.md` (player-facing) and `docs/ARCHITECTURE.md` (upstream's, to
   be rewritten once the FightWars systems settle) — neither has been maintained yet.

Standing decisions are in `BUILD-STATE.md` and are not reopened: the fork, the licence, the
code's numbers as the baseline (80 % win, no Fast speed, 120 maps), Vite, Glicko-2 with one
period per match, PGlite in dev / Postgres in prod, one clan per account, "a session is an
account" (guests are signed in), seasons as an environment variable, `MASTER_PORT`.

## 3. Phase 4 — Identity (brief §7)

**Goal.** Dark, confident, map-first. The map is the interface; chrome hugs the edges and
hides with one key. Restrained palette, a strong condensed face for numbers.

**Before any UI code**, load the `frontend-design` skill and state the direction in two
sentences. Then `ui-ux-pro-max:ui-ux-pro-max` for palette and font pairing (pick, do not
invent), `ui-ux-pro-max:design-system` for tokens (the brand module `src/brand/Brand.ts` is
where tokens must end up — "brand through configuration, not code"), `dataviz` before any
chart, stat tile or sparkline, and on the finished work `impeccable` then
`web-design-guidelines`. Never load `frontend-design` and `impeccable` together.

**Status (end of session 6): 5 of 10 done, 1 part-done.**

| #   | Item                                                                                   | State                                                                |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Nation colours in OKLCH, three colourblind-safe palettes                               | **done**                                                             |
| 2   | Wordmark, favicon, app icons, `og:image`, display font (and the renderer's MSDF atlas) | **done**                                                             |
| 3   | Readable at every zoom (political blocks, halos, flashes)                              | not started                                                          |
| 4   | Every number explained on hover                                                        | **done** for the pre-attack estimate; the live "cost so far" remains |
| 5   | Feel: border wave, nuke flash + shake + ring + sound                                   | not started                                                          |
| 6   | Radial menus, HUD, leaderboard, events feed                                            | **part-done** — palette and typography only                          |
| 7   | Mobile first-class                                                                     | not started                                                          |
| 8   | Onboarding: 90-second tutorial                                                         | not started                                                          |
| 9   | Build queue, rally points, attack presets                                              | not started (keybind remapping already existed)                      |
| 10  | Clan create form; guest-appropriate account page                                       | **done**                                                             |

What the finished ones measure, and what each left behind, is in `BUILD-STATE.md` — it is kept
current and is the place to look before re-deriving anything.

### Before starting any of the rest

- **The client perf harness does not run.** `npm run perf:client` dies with
  `ReferenceError: document is not defined` — `src/client/Api.ts` registers a
  `session-cleared` listener at module scope and the script imports it into plain Node.
  `perf:client-mem` and `perf:client-tick` both die with `spawn npx ENOENT`: they spawn
  `npx vite` without `shell: true`, which does not work on Windows. Both breaks predate this
  work (reproduced at `dfef14c60`). **Item 3's stated verification is therefore unavailable
  until these are fixed**, and fixing them is the first task of that item, not an aside.
  `npm run perf:gate` — the headless _simulation_ budget — is fine and unrelated.
- **The asset generators' tools are deliberately not dependencies.** `npm run atlas:generate`,
  `fonts:sync` and `marks:generate` each need a one-off `npm install --no-save …`, written in
  the header of the script itself. `msdf-bmfont-xml` pulls `canvas`, a native module every CI
  `npm ci` would otherwise compile to regenerate files that change about once a year.
  `scripts/generateBrandMarks.ts` is excluded from `tsconfig.json` and allow-listed in
  `eslint.config.js` for the same reason — do not "fix" that with stub types, which would
  claim a check that is not happening.
- **The palette is semantic now.** Use `action` / `action-hover` / `action-ink` / `signal` /
  `rank-gold` / `surface` / `ink`, never hue names. `action-ink` is the step that reads as type
  on a dark surface; `action` is the one to put white text on. Do not add a _lighter_ hover
  step — that is exactly what left the old one at 2.56:1.
- Load `dataviz` before the first line of any chart, stat tile, meter or sparkline (item 6 is
  full of them). Run `impeccable` and `web-design-guidelines` on real code, never on a plan,
  and never load `frontend-design` and `impeccable` together.

### 3 — Readable at every zoom

The renderer is a pass pipeline under `src/client/render/gl/passes/` (~25 passes) fed by
`WebGLFrameBuilder.ts`; `src/client/render/frame/` holds the CPU-side trail and railroad
caches. Much of the machinery this item wants already exists — `BorderComputePass`,
`BorderStampPass`, `BorderScatterPass`, `SmallPlayerGlowPass`, `FalloutBloomPass`,
`LightmapPass`, `NightCompositePass`.

What is _not_ there: territory that reads as political blocks when zoomed out (today it is
per-tile fill at every zoom), and a legibility pass over halos and flashes at small scale.

Fix the perf harness first, take a baseline, then change one pass at a time. Nothing here
touches the simulation — colours and geometry are render-only — so the determinism gate should
stay green throughout. If it does not, something has leaked into the core.

**Still blocked:** real-GPU fps has never been measured. The Browser pane renders in software,
so its numbers say nothing about a real machine. Needs the owner to run the dev client on their
own hardware and report, or a GPU CI runner.

### 4 — The live "cost so far"

`Config.attackLogic` already fills in an `AttackExplanation` and the hover tooltip renders it
(`src/client/AttackCostEstimate.ts`, `PlayerInfoOverlay.renderAttackCost`). What remains is
showing what an attack _has already_ cost while it runs.

`AttackImpl` tracks only `_troops` and `_borderSize`, and `AttackUpdate` carries
`{attackerID, targetID, troops, id, retreating}`. The obvious move — add `startTroops` and
`tilesConquered` to `AttackUpdate` — is the wrong one: per-tick attack troop counts travel in a
packed `Float64Array` lane (`packedAttackUpdates`, built in `GameUpdateUtils.ts`) precisely
_because_ they change every tick for every live attack, while the attack arrays themselves are
resent only when membership or order changes.

Split it by how often each value changes:

- `startTroops` is fixed for the life of an attack → put it on the attack array, which is
  already only resent on membership change. Costs nothing per tick.
- Troops spent so far is then `startTroops - troops`, computed on the client from data it
  already has. No protocol change at all.
- `tilesConquered` does change per tick. Try deriving it client-side first (the client already
  receives territory updates) before widening the packed lane — that lane is the one part of
  this with a real bandwidth cost under 120 players.

### 5 — Feel

`src/client/controllers/SoundEffectController.ts` plays effects, `src/client/sound/Sounds.ts`
holds the `SoundEffect` union and the url map, `src/client/sound/SoundManager.ts` owns volume.

Two concrete findings:

- **Four sound files ship and are never played.** `resources/sounds/effects/` contains
  `sam-hit.mp3`, `sam-shoot.mp3`, `warship-lost.mp3` and `warship-shot.mp3`; none of the four
  appears anywhere in `src/`, and none is in the `SoundEffect` union or `soundEffectUrls`.
  Wiring them is the cheapest feel work available and costs no bytes.
- **There is no screen shake and no nuke flash anywhere in the client.** Nothing matches
  `shake`, and there is no flash pass — `CrosshairPass.triggerBlockedFlash` is a different
  thing (a blocked-build indicator). Shake belongs on `TransformHandler` (`offsetX` /
  `offsetY` / `scale`) as a decaying _render-time_ offset; it must never reach the simulation,
  and it must not move the camera state the input handler reads back.

Audio budget is 2 MB and `resources/sounds` is 1.5 MB, so ~500 KB of headroom. The music
playlist is deliberately empty (`BRAND.assets.music`) until CC-licensed tracks exist.

### 6 — Radial menus, HUD, leaderboard, events feed

Palette and typography are done; layout and information design are not. Layers live in
`src/client/hud/layers/` — `RadialMenu.ts`, `MainRadialMenu.ts`, `ControlPanel.ts` (698 lines),
`EventsDisplay.ts` (718), `UnitDisplay.ts`, `PlayerStats.ts`, `TeamStats.ts` — and the
leaderboard tables in `src/client/components/leaderboard/` (`LeaderboardPlayerList.ts`,
`LeaderboardClanTable.ts`, `LeaderboardTribeTable.ts`).

`--font-display` (Barlow Condensed) is defined and available as the `font-display` utility but
is **not yet applied anywhere** — the HUD still inherits the body face. Applying it to the
figures is the first and cheapest half of this item, and `font-variant-numeric: tabular-nums`
belongs with it wherever numbers sit in a column that updates every tick.

`dataviz` is mandatory before any of the stat tiles, meters or sparklines.

### 7 — Mobile

`src/client/InputHandler.ts` (1238 lines) already handles pointer events, long-press and pinch,
including a Safari `GestureEvent` path for trackpad pinch. So this is not "add touch" — it is
thumb reach, hit-target sizes, and a HUD that survives a phone.

The Browser pane's own width is narrow enough to be a useful first check (every header bug
fixed in session 6 was found that way), and `resize_window` emulates a device properly — but
pass width and height _without_ `preset`, since a preset clears the emulation.

**Definition-of-Done item that cannot be closed here:** real mobile Safari. Needs a device or
BrowserStack.

### 8 — Onboarding

`src/client/hud/Tutorial.ts` holds **22 steps** (`spawn`, `attack_wilderness`, `troops`,
`troop_rate`, `attack_ratio`, `capture_tribes`, `buy_city`, `propose_alliance`,
`alliance_info`, `buy_factory`, `factory_info`, `send_boat`, `buy_port`, `port_info`,
`buy_defense_post`, `buy_warship`, `buy_silo`, `launch_atom`, `atom_info`, `hydrogen_info`,
`mirv_info`, `sam_info`); `TutorialPanel.ts` renders them.

The brief asks for **90 seconds**: spawn → expand → ratio → build → ally, then out into a real
lobby. Twenty-two steps ending at MIRV and SAM is a different product, so this item is mostly
subtraction — cut the arc to five, move the rest to a reference the player can open later, and
add the hand-off into a real lobby at the end.

**There are no tutorial tests at all.** Pin step progression first: it is exactly what breaks
silently when steps are removed.

### 9 — Build queue, rally points, attack presets

Keybind remapping already exists (`UserSettingModal.ts`, "keybinds" tab). The other three do
not, and they are **intents** — player commands travelling through the lockstep protocol — so
each needs a schema entry in `src/core/Schemas.ts` (beside `AttackIntentSchema`), a `case` in
`src/core/execution/ExecutionManager.ts` (which dispatches on `"attack"`, `"spawn"`, `"boat"`,
`"allianceRequest"`, …), an `Execution` class in `src/core/execution/`, a test in
`tests/ExecutionManagerIntents.test.ts`, and a `docs/MECHANICS.md` note.

**This is the only Phase 4 item that touches the simulation** — everything else is render-only.
So: integer maths, seeded randomness only, a replay record version bump, and the determinism
gate green after every step. Those are the Phase 5 rules applied early. Treat it as Phase 5
work that happens to be listed here, and do it last.

**Phase 4 gate.** Everything above visible in the Browser pane, `impeccable` and
`web-design-guidelines` run on the real code, all standard gates green, fps and bundle numbers
recorded in `BUILD-STATE.md`. Two of those cannot be met on this machine: real-GPU fps and
mobile Safari.

## 4. Phase 5 — Depth (brief §6.1–6.6)

The ground rule from the brief: every addition must change what a good player decides.
Balance-test each item against bots before the next. Every sim change is a replay-breaking
change: bump the record version and keep the determinism gate green after every step. All new
maths must be integer or `DetMath`; all randomness on the seeded `PseudoRandom`.

Every item below has a worked hook-point analysis in `docs/MECHANICS.md`; the section is
named so it can be read before touching the code.

| Item                                                      | Mechanics section                    | The shape of the change                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 Supply lines (highest value)                          | §02 G1, §03 7.4                      | New `supplyDistance` on `AttackLogicInput`, gathered in `AttackExecution.attackLogicInput` from a per-tile flood off own City/Port/rail-cluster tiles (the flood in `validStructureSpawnTiles` is the template; `RailNetworkImpl` clusters already exist). Attrition in the tick loop before the budget loop. Free `state` bit for a "supplied" flag so the renderer can shade it.                                                                                  |
| 6.2 Terrain that costs something                          | §02 G2, §02 14–15                    | `terrainAttackBase` becomes multiplier tables keyed by `TerrainType`; new classes (forest, marsh, desert, urban, river) need a byte encoding in `map.bin` (reserve magnitude sub-ranges) and the Go generator's blue-channel table. Wire the tables through `GameConfig` so lobbies can vary them.                                                                                                                                                                  |
| 6.3 Materials, Manpower, upkeep, blockades, embargo price | §01 Gaps, §03 7.2–7.3                | New bigint pools beside `_gold/_troops` with the `addGold/removeGold` pattern; `UnitInfo.cost` widened to a bundle; production in `FactoryExecution.tick` (empty today), delivery via the unused `TrainStation.FactoryStopHandler`; upkeep in `PlayerExecution.tick` with an explicit unpaid-upkeep consequence; blockade filter in `PortExecution.tradingPorts`; tariff multiplier in `Config.tradeShipGold`. New wire slots on `PlayerUpdate` and `StatsSchemas`. |
| 6.4 Military breadth (6 units)                            | §03 7.1 (25-file checklist), §04 D–E | Budget ~25 code files + atlas + 37 locale files per unit; the compiler enforces the five core switches via `assertNever`. Artillery from `DefensePostExecution`'s commented ship-targeting; Submarine as a `submerged` warship state; Carrier generalises the port lookups; Bomber is a non-nuclear `NukeType`; Radar through `Config.dynamicSamRange` plus the three nation call sites and the client preview.                                                     |
| 6.4 Nuke consequences (irradiation timer, global fallout) | §04 A–C                              | A `falloutUntilTick` store beside `GameMapImpl.state`; fallout on owned land; a `falloutRatio` input to `troopIncreaseRate`; extend the existing Doomsday Clock (`requiredBasisPoints`), never a parallel execution. Note the current fallout modifier is inverted relative to the brief.                                                                                                                                                                           |
| 6.5 Tiered relations, war goals, coalitions, reputation   | §05 1–4                              | `tier` on `AllianceImpl`/request/intent; tier-aware `isFriendly`/`canAttackPlayer`; per-tier traitor table in `GameImpl.breakAlliance`; a "war" object beside `allianceRequests`; leader share published from `WinCheckExecution` for the ~40 % coalition rule (nation thresholds already exist in `findFFACrownTarget`); reputation as an optional `PlayerSchema` field read only by rendering unless nations use it (then it must be in the archived record).     |
| 6.6 Doctrines and stability                               | §05 5–6                              | `doctrine` on the spawn intent, stamped in `SpawnExecution.tick`, multipliers in the `Config` player-type switches; partisans = tribes spawned by an instability execution modelled on `DoomsdayClockExecution`, reusing `TribeExecution`/`AiAttackBehavior` with an "attack the occupier" preference.                                                                                                                                                              |

**Phase 5 gate.** Per item: a test per execution and per formula, `docs/MECHANICS.md` updated,
determinism quick + full green, `perf:gate` budgets held (server tick mean ≤ 8 ms at 150
players), a bot-vs-bot balance run recorded in `BUILD-STATE.md`.

## 5. Phase 6 — Modes and metagame (brief §6.7, §6.9, ranked, clans, replays)

Already in place from Phase 2: ranked 1v1/2v2 queues (`src/api/Matchmaking.ts`), Glicko-2
with seasons, clans with tags and the weighted-wins clan ladder, replay persistence
(`src/server/ReplayStore.ts`, `GET /w<N>/api/replay/:id`), post-match records with per-player
stats.

Remaining, roughly in the order the brief implies:

- **Placements** for ranked (N provisional games; `ratings.rd` already expresses uncertainty).
- **Modes**: Battle Royale (shrinking area — a new execution that irradiates or relinquishes
  outer tiles on a schedule; the fallout machinery is the cheap path), King of the Hill,
  Capital Strike (a capital unit + `conquerPlayer` on its loss), Survival (co-op vs
  escalating nations — the difficulty enum plus `NationExecution` cadence), Historical
  scenarios (map manifests with fixed spawns and doctrines), Draft (lobby-phase picks are
  server state, not sim state), **Blitz** — the brief's "4× speed" needs a real game-speed
  setting in the wire config; today the 100 ms turn is fixed on both sides
  (`ServerEnv.ts`/`ClientEnv.ts`, see `docs/MECHANICS.md` §06.5).
- **Spectator/caster mode** with economy graphs and a win projection (`spectator` join
  exists; graphs are `dataviz` work), **replay viewer** with timeline scrubbing and
  jump-to-event (the client already replays records; scrubbing needs snapshotting or
  re-simulation from turn 0), **post-match analytics** (territory over time, troop
  efficiency, gold by category — `StatsSchemas` gold indices exist — the tick an alliance
  broke).
- **Daily/weekly challenges** and cosmetic-only progression (API tables + `/users/@me`
  fields; the client's inventory/cosmetics UI exists but the catalogue is empty by design).
  **No pay-to-win, ever**; the store switch in `Brand.ts` stays off.
- **Creation tools (6.9)**: in-browser map editor exporting a map package (the Go generator
  under `map-generator/` defines the format; `npm run gen-maps` regenerates `Maps.gen.ts`),
  fully data-driven balance (one versioned config loadable per lobby — `GameConfig` is the
  wire surface; `Config.ts` module-level literals must move into it), community map browser
  with ratings (API + `docs/API.md`).

**Phase 6 gate.** Each mode played to its end condition in the Browser pane with two
origins; determinism gate over a recorded match of each mode; API tests for every new route
parsed with the client's schemas (the pattern in `tests/api/`).

## 6. Blocked items (need the owner or hardware)

- **Discord OAuth login** (`/auth/discord`, attach to the existing account row): needs a
  Discord application client id and secret. Guests remain the only identity. The account page
  no longer offers dead buttons — providers are `BRAND.identity`, all `false`, and the page
  shows the guest account instead; switching one to `true` means building its
  `/auth/login/*` route first, because the API serves none today.
- **Compose stack** (`docker-compose.yml`: game + api + postgres + redis): written, never run.
  Needs a box with Docker. Then point the desync webhook (`DESYNC_WEBHOOK_URL`) and the
  metrics dashboard (`/metrics`) at real alerting.
- **Cluster load run** (500 concurrent lobbies): the harness follows `workerIndex` already;
  the dev box has two workers. Needs more workers or hosts.
- **Real-GPU fps and mobile Safari**: never measured; the sandbox browser is software
  rendered. Needs a laptop and a phone (Definition of Done: 60 fps at 150 players on a 2019
  mid-range laptop). Note that the client perf harness does not currently run at all on this
  machine either — see §3, "Before starting any of the rest"; that is a code bug, not a
  hardware limit, and it has to be fixed before any fps target can be tracked.
- **Production domain**: `BRAND.siteUrl` is empty, so canonical/og tags are omitted.

## 7. Phase 7 — Hardening (brief §8 security, §11 definition of done)

- **Server-side intent validation.** The single biggest gap the audit found
  (`docs/MECHANICS.md` headline 1): the server checks schema, rate limits and four control
  intents, and zero gameplay semantics. The fix is a server-side shadow of the sim — the
  server already has every intent and could run `GameRunner` itself per lobby (cost: one
  extra sim per lobby; the perf gate says a 150-player tick is ~2 ms) and reject intents
  the authoritative state refuses (affordability, ownership, reachability, cooldown).
  Reject silently, log, count in `/api/metrics`.
- **Winner and stats by client vote** (headline 1): with a server-side sim the server settles
  them itself; ingest (`src/api/Matches.ts`) then trusts the server's record only.
- **Rate limits and spam caps** per client per tick (`SocketIngress` has the hook); alliance,
  emoji, donation caps beyond today's cooldowns.
- **Automation detection** (click cadence, pixel-perfect timing) as a server-side scorer over
  the intent stream; **multi-account detection** on the ranked ladder (the API sees
  persistent ids, IPs at `/join_verify`, and match co-occurrence).
- **Fog of war** filtering server-side: `NameVisibility.ts` already filters names per viewer;
  tile/unit fog would need per-viewer turn filtering, which conflicts with lockstep
  replay unless fog is a render-only feature. Decide before building.
- **Load testing to 500 lobbies** (blocked, above), **accessibility audit**
  (`web-design-guidelines`; full keyboard navigation and screen-reader labels on all chrome
  are Definition-of-Done items), **i18n** (strings are already extracted to
  `resources/lang/*.json`, 37 locales; audit new FightWars strings for keys), analytics and a
  live balance dashboard (`dataviz`; the metrics endpoint is the data source).
- **Performance in CI**: server tick, bandwidth and bundle are gated; add cold-load time
  (< 2.5 s on 10 Mbps) and fps once a GPU runner exists.

**Definition of done** (brief §11) is checked line by line, then `SHIPPED.md` is written:
what was built, what was cut and why, the measured numbers, what next.

## 8. What to do if something is red

The order never changes: determinism first (a red gate stops everything), then `npm test`,
then lint/prettier/tsc, then perf budgets. If a rebase on upstream breaks the client tests
that pin the guest-is-signed-in rule or the turn sequencer, keep the FightWars behaviour and
re-apply the pins; `FORK-CHANGES.md` lists every file where that is likely.
