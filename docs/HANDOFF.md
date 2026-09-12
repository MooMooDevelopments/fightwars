# FightWars — handoff for the rest of the build

Written 2026-09-12 at the end of session 4. Phases 0–3 of the build brief are done; this is
the plan for Phases 4–7 and the items still blocked, written so that a fresh session (or a
person) can carry it without the conversation that produced it. `BUILD-STATE.md` stays the
per-session resume file; this document is the map of everything that remains.

## 1. Where things stand

| Phase | Brief section      | Status                                                                                                                                                                                                                             |
| ----- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Audit              | Done. `docs/MECHANICS.md` (every system, formula, file, hook point), determinism gate, solo win, two-window lobby.                                                                                                                 |
| 1     | Foundation         | Done. Brand module, proprietary assets replaced, AGPL attribution, CI (tests, determinism, perf, licences, lint, maps).                                                                                                            |
| 2     | Infrastructure     | Done except two blocked items (§6). API (`src/api/`): guest accounts, Glicko-2 ladders with seasons, ranked queues, profiles, clans, friends, public games; load harness; desync alerting; replay store; metrics; Postgres CI job. |
| 3     | Parity and repair  | Done. `docs/BASELINE-VERIFICATION.md`, rejoin repair, tests for every verb, core coverage floor in CI.                                                                                                                             |
| 4     | Identity           | **Next.** Nothing visual has been designed; the wordmark is a deliberate placeholder.                                                                                                                                              |
| 5     | Depth              | Not started. Every hook point is already written down in `docs/MECHANICS.md` "Gaps vs FightWars brief" (§01–§05).                                                                                                                  |
| 6     | Modes and metagame | Ranked, seasons and clans (server side) exist from Phase 2; the rest not started.                                                                                                                                                  |
| 7     | Hardening          | Determinism, load harness, desync alerting and licence gate exist; server-side intent validation, anti-automation, fog filtering, accessibility audit, i18n audit not started.                                                     |

Repo: `C:\Users\disbo\dev\fightwars` (`origin` = github.com/MooMooDevelopments/fightwars, public;
`upstream` = openfrontio/OpenFrontIO). Brief:
`Claude Memories/fightwars-autonomous-prompt.md`. Tests: 478 + 67 files, 5656 + 673 tests.
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

Work items, with where each lives today:

| Item                                                         | Entry point                                                                                                                                                                                                                                                           | Verify                                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Nation colours in OKLCH, three colourblind-safe palettes     | `src/client/theme/ColorAllocator.ts`, `src/client/theme/ThemeProvider.ts` (`SettingsTheme`), `UserSettings`. Generate with enforced perceptual spacing for 120 players; palettes as a setting. Colours are render-only, so this never touches the deterministic core. | A test that any 120 allocated colours keep a minimum ΔE; a screenshot per palette on the World map.                                      |
| Wordmark, favicon, app icons, `og:image`, display font       | `src/brand/Brand.ts` asset slots, `resources/` (SVG wordmarks, PNG icons generated in Node — `node-canvas` is not built under `--ignore-scripts`), Overpass is the placeholder face. `og:image` still shows upstream's screenshot.                                    | `tests/Brand.test.ts` still passes; `npm run licenses:check`; the font's licence recorded in `LICENSING.md`.                             |
| Readable at every zoom (political blocks, halos, flashes)    | WebGL renderer `src/client/render/gl/` (passes under `passes/`), `WebGLFrameBuilder.ts`, `MapLayerController.ts`.                                                                                                                                                     | `npm run perf:client` numbers not regressed; measured fps on a real GPU (never measured yet — the sandbox browser is software-rendered). |
| Every number explained on hover (attack cost tooltip)        | `Config.attackLogic` is pure and available on the client via `GameView.config()`; `docs/MECHANICS.md` §02 G3 lists the exact inputs to gather and the two `AttackUpdate` fields to add for a live "cost so far".                                                      | Unit test on the breakdown; tooltip visible in the Browser pane.                                                                         |
| Feel: border wave, nuke flash + shake + ring + sound, sting  | `src/client/render/frame/` (trails, telegraphs), `SoundEffectController.ts`, `SoundManager.ts`. Audio budget 2 MB total; `resources/sounds` is 1.5 MB today with no music (the playlist is empty until CC-licensed tracks exist).                                     | Bundle size check in CI (`build-prod`), audio total ≤ 2 MB.                                                                              |
| Radial menus, HUD, leaderboard, events feed                  | `src/client/hud/layers/` (`RadialMenu.ts`, `MainRadialMenu.ts`, `EventsDisplay.ts`, `ControlPanel.ts`, `UnitDisplay.ts`), `components/leaderboard/`.                                                                                                                  | `tests/client/**` for each layer; `web-design-guidelines` pass.                                                                          |
| Mobile first-class                                           | `src/client/InputHandler.ts` (touch/pointer), radial menus (thumb reach, long-press build), pinch zoom, larger hit targets, simplified HUD.                                                                                                                           | Browser pane at the mobile preset; mobile Safari is a Definition-of-Done item (needs a real device or BrowserStack).                     |
| Onboarding: 90-second tutorial against one easy bot          | `src/client/hud/layers/TutorialPanel.ts` (20-step panel exists), `SinglePlayerModal.ts`. Brief wants spawn → expand → ratio → build → ally, then a real lobby.                                                                                                        | A scripted Browser-pane run through the tutorial; a client test for step progression.                                                    |
| Keybind remapping, build queue, rally points, attack presets | Remapping exists (`UserSettingModal.ts` "keybinds" tab). Build queue / rally points / presets do not — they are intents, so each needs a schema entry, an execution, a test, and a `docs/MECHANICS.md` note.                                                          | Every new intent in `tests/ExecutionManagerIntents.test.ts`; determinism gate.                                                           |
| Clan create form; a guest-appropriate account page           | `ClanBrowseView.ts` (no create UI; the API's `POST /clans` exists), `AccountModal.ts` (still offers Discord/Google login that is not configured).                                                                                                                     | Browser pane against the dev API.                                                                                                        |

**Phase 4 gate.** Everything above visible in the Browser pane, `impeccable` and
`web-design-guidelines` run on the real code, all standard gates green, fps and bundle numbers
recorded in `BUILD-STATE.md`.

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
  Discord application client id and secret. Until then guests are the only identity and the
  account page's login buttons do nothing useful.
- **Compose stack** (`docker-compose.yml`: game + api + postgres + redis): written, never run.
  Needs a box with Docker. Then point the desync webhook (`DESYNC_WEBHOOK_URL`) and the
  metrics dashboard (`/metrics`) at real alerting.
- **Cluster load run** (500 concurrent lobbies): the harness follows `workerIndex` already;
  the dev box has two workers. Needs more workers or hosts.
- **Real-GPU fps and mobile Safari**: never measured; the sandbox browser is software
  rendered. Needs a laptop and a phone (Definition of Done: 60 fps at 150 players on a 2019
  mid-range laptop).
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
