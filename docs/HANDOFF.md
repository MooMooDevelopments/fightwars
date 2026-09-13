# FightWars — handoff for the rest of the build

Written 2026-09-12 at the end of session 4. Phases 0–3 of the build brief are done; this is
the plan for Phases 4–7 and the items still blocked, written so that a fresh session (or a
person) can carry it without the conversation that produced it. `BUILD-STATE.md` stays the
per-session resume file; this document is the map of everything that remains.

## 1. Where things stand

| Phase | Brief section      | Status                                                                                                                                                                                                                               |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | Audit              | Done. `docs/MECHANICS.md` (every system, formula, file, hook point), determinism gate, solo win, two-window lobby.                                                                                                                   |
| 1     | Foundation         | Done. Brand module, proprietary assets replaced, AGPL attribution, CI (tests, determinism, perf, licences, lint, maps).                                                                                                              |
| 2     | Infrastructure     | Done except two blocked items (§6). API (`src/api/`): guest accounts, Glicko-2 ladders with seasons, ranked queues, profiles, clans, friends, public games; load harness; desync alerting; replay store; metrics; Postgres CI job.   |
| 3     | Parity and repair  | Done. `docs/BASELINE-VERIFICATION.md`, rejoin repair, tests for every verb, core coverage floor in CI.                                                                                                                               |
| 4     | Identity           | **In progress: 6 of 10 done, 2 part-done (see §3).** The visual direction is set and carried through: dark, map-first, players vivid and nations muted, one amber signal. Own face (Barlow Condensed/Barlow), own mark, own palette. |
| 5     | Depth              | **In progress: 6.1 supply lines (session 10) and 6.2 elevation (session 11) done.** Every remaining hook point is written down in `docs/MECHANICS.md` "Gaps vs FightWars brief" (§01–§05).                                           |
| 6     | Modes and metagame | Ranked, seasons and clans (server side) exist from Phase 2; the rest not started.                                                                                                                                                    |
| 7     | Hardening          | Determinism, load harness, desync alerting and licence gate exist; server-side intent validation, anti-automation, fog filtering, accessibility audit, i18n audit not started.                                                       |

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

**Status (end of session 9): 6 items done, 2 part-done, 2 not started — counted by the rows
of the table below, which is the honest count.** (Earlier versions of this line said "6 of 10"
by counting the sub-items inside a row; the table has always been the thing to read.)

Item 5 was finished in session 8 — the nuke ring and the border wave, plus the
`prefers-reduced-motion` respect the shake and flash shipped without. Session 9 took item 6's
typography and colour half. Items 3 and 6 keep their named remainders, written at the end of
their sections.

| #   | Item                                                                                   | State                                                                    |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Nation colours in OKLCH, three colourblind-safe palettes                               | **done**                                                                 |
| 2   | Wordmark, favicon, app icons, `og:image`, display font (and the renderer's MSDF atlas) | **done**                                                                 |
| 3   | Readable at every zoom (political blocks, halos, flashes)                              | **part-done** — blocks and borders; halos and flashes remain             |
| 4   | Every number explained on hover                                                        | **done** — estimate before, spend during (tiles conquered: see below)    |
| 5   | Feel: border wave, nuke flash + shake + ring + sound                                   | **done**                                                                 |
| 6   | Radial menus, HUD, leaderboard, events feed                                            | **part-done** — typography, tokens and a11y; layout and the feeds remain |
| 7   | Mobile first-class                                                                     | **part-done** — rotation, header and touch targets; layout remains       |
| 8   | Onboarding: 90-second tutorial                                                         | **done**                                                                 |
| 9   | Build queue, rally points, attack presets                                              | not started (keybind remapping already existed)                          |
| 10  | Clan create form; guest-appropriate account page                                       | **done**                                                                 |

What the finished ones measure, and what each left behind, is in `BUILD-STATE.md` — it is kept
current and is the place to look before re-deriving anything.

### Before starting any of the rest

- **The client perf harness runs again (fixed in session 7).** `npm run perf:client` works;
  its baseline is in `BUILD-STATE.md`. `perf:client-mem` and `perf:client-tick` no longer die
  on Windows but still cannot run here — they need the run-openfront Chromium setup, which is
  Linux-only. `npm run perf:gate`, the headless _simulation_ budget, is unrelated to all three
  and fails on this box only under load.
- **The browser pane renders WebGL2**, so appearance _is_ verifiable here — see `BUILD-STATE.md`
  for the recipe and for how to A/B a graphics setting on one live game. Frame rate is not.
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

**Done (session 7).** `src/client/render/gl/ZoomLegibility.ts` owns the thresholds; the shared
chunk `shaders/shared/political-owner.glsl` resolves a pixel to whoever holds most of its
footprint; the territory fill fades patterns, skins and the defence darken out over the same
range and closes toward opaque; the border stamp takes the strongest border in the same
footprint so a one-tile outline survives below a pixel. All of it is inert above one CSS pixel
per tile, and `mapOverlay.politicalZoom` turns it off. Nothing touched the simulation and the
determinism gate stayed green.

**What is still open on this item:** the brief also asks for a legibility pass over _halos and
flashes_ at small scale — `SmallPlayerGlowPass` and `FalloutBloomPass` were not touched, and
they have the same sub-pixel problem the border had. That is the natural next slice.

**Still blocked:** real-GPU _fps_ has never been measured. The pane renders WebGL2, so
appearance is verifiable here and was verified; frame timing is not. Needs the owner on their
own hardware, or a GPU CI runner.

### 4 — The live "cost so far"

**Done (session 7).** A running attack shows what it has already cost beside what it has left —
`↑ 18.7K −2.26K Madagascar` — with the hover explaining both halves.

The plan in the previous version of this section was right about where to put the value and
wrong about what the value is. "Troops it launched with" goes **negative** the moment two
attacks on the same target merge, which `AttackExecution` does routinely: the survivor absorbs
the other's troops. So the sim tracks `troopsCommitted` — every troop ever put in, raised by a
merge and untouched by losses — and the cost is `troopsCommitted - troops`. It rides the attack
array as planned, since a merge is a membership change anyway.

**`tilesConquered` is not derivable client-side**, contrary to the old plan here. The client
sees territory changes but cannot attribute them to one of a player's several concurrent
attacks. Doing it properly means widening `packedAttackUpdates` — the one per-tick lane with a
real bandwidth cost at 120 players — so it was left out rather than guessed. If someone wants
it, that is the decision to take deliberately, not a client-side derivation to discover.

**Deliberately outgoing-only.** The defender already sees an incoming attack's live troop count,
but what it has _cost_ the attacker is new information; handing it over is a balance decision
for brief §8's fog filtering, not a legibility one.

### 5 — Feel

`src/client/controllers/SoundEffectController.ts` plays effects, `src/client/sound/Sounds.ts`
holds the `SoundEffect` union and the url map, `src/client/sound/SoundManager.ts` owns volume.

**Done (session 7).** The four orphan sound files (`sam-hit`, `sam-shoot`, `warship-lost`,
`warship-shot`) are wired and throttled; `src/client/ScreenShake.ts` and
`src/client/render/gl/passes/FlashPass.ts` exist, driven by
`src/client/controllers/ImpactFeedbackController.ts` off nuke detonations, scaled by warhead and
by distance from the centre of the view.

**Done (session 8), and this item is now finished.**

- **The nuke ring.** `src/client/render/gl/passes/ShockwavePass.ts` — an expanding world-space
  ring at the blast's own outer radius, triggered from `ImpactFeedbackController` beside the
  flash and the shake. Deliberately _not_ scaled by the distance falloff the other two use:
  the flash and the shake are felt and answer to where the camera is pointing, the ring is map
  information and answers to the blast.
- **The border wave.** `src/client/render/gl/passes/BorderWavePass.ts` — one short-lived mote
  per tile that changes hands, fed from the per-tile owner-change callback the border recompute
  already uses (`TerritoryPass.setBorderPatchConsumer`, wired in `Renderer.ts`). The wave is
  emergent: there is no frontier object anywhere, only a few hundred tiles flipping together.
  `isConquest` is the rule that makes it mean something — growth into unclaimed land does not
  count, or the first two minutes of every game set the whole map alight.
- **`prefers-reduced-motion`.** The shake goes entirely, the flash drops to 30%, the ring is
  untouched. A MIRV is thirty flashes in a few seconds, which is what WCAG 2.3.1 is about.
  This was missing from the shake and flash as shipped in session 7.
- **The session-7 gap is closed.** Two real atom bombs, built and launched through the normal
  intent path, were watched driving `shake.add`, `triggerFlash` and `triggerShockwave`; the
  camera centre was sampled moving 16x13 tiles through the real `syncCamera` loop while
  `transformHandler.offsetX/offsetY` stayed byte-identical, then settled back to baseline.

**Two lessons worth carrying into the rest of Phase 4**, both learned the hard way here:

1. **Opacity has to be chosen by looking.** Both effects were first written at opacities that
   sounded right and were invisible on a live map. Over terrain, a pale line starts to read at
   about 0.6 and disappears below 0.5. Photograph it before believing a number.
2. **Module identity breaks after any HMR.** `await import("/src/client/…")` from the console
   returns a _different_ module object from the one the running app holds once Vite has
   hot-reloaded anything, so prototype patches silently never fire and every measurement comes
   back zero. Restart the dev server before instrumenting, and prove the patch is reached
   before believing a null result.

**Known limit:** at the strategic zoom (below about one pixel per tile) the wave is faint. The
pixel floor stops it flickering, but a small skirmish is not legible from there. Whether it
should be is an open question — arguably only a big offensive should show from that far out.

**Neither effect has its own graphics toggle.** The wave rides `passEnabled.fx`; the ring has no
switch. A per-effect toggle would need `RenderSettings`, `render-settings.json`,
`debug/Layout.ts` and `GraphicsAdvancedSettings.ts` changed together.

Audio budget is 2 MB and `resources/sounds` is 1.5 MB, so ~500 KB of headroom. The music
playlist is deliberately empty (`BRAND.assets.music`) until CC-licensed tracks exist.

### 6 — Radial menus, HUD, leaderboard, events feed

Palette and typography are done; layout and information design are not. Layers live in
`src/client/hud/layers/` — `RadialMenu.ts`, `MainRadialMenu.ts`, `ControlPanel.ts` (698 lines),
`EventsDisplay.ts` (718), `UnitDisplay.ts`, `PlayerStats.ts`, `TeamStats.ts` — and the
leaderboard tables in `src/client/components/leaderboard/` (`LeaderboardPlayerList.ts`,
`LeaderboardClanTable.ts`, `LeaderboardTribeTable.ts`).

**Done (session 9): the typography and the colour underneath it**, on the two surfaces a
player reads every tick — `ControlPanel.ts` and the shared `StatsTable.ts`.

- `--font-display` is applied to the figures, at **weight 600**, which is the only weight of
  the condensed face `Main.ts` registers. Asking for `font-bold` (700) there gets a synthesised
  bold; do not.
- Tabular figures went on anything live or in a column and came **off** the stats table's name
  column. `dataviz` says a large standalone number wants proportional figures; a HUD counter
  that reticks ten times a second wants stable digit widths more, or it wobbles while the eye
  is on the map. That is the rule this repo follows, and the reason is written at the
  `FIGURE_CLASS` constant.
- The troop meter is rebuilt on component tokens (`--color-meter-fill` / `-committed` /
  `-track`): a track that is a dark step of the action ramp rather than neutral grey, a 2px
  gap in the track colour between the segments instead of a stroke around them, and no border.
  White is legible on all three steps by measurement, which is what retired the per-label
  drop-shadow.
- **Two colour findings worth remembering.** The troop rate's green/orange pair measured 53.0
  CIEDE2000 for normal vision and **10.4 for a deuteranope** — the exact pair the three map
  palettes exist to avoid, in the chrome. And rank gold separates from `signal` by only 5.8
  under deuteranopia, so a gold currency readout and an alert are one colour to that player;
  the coin icon carries the currency instead and the figure wears ink.
- `tests/client/HudTokens.test.ts` holds the chrome to the standard `Palette.test.ts` holds the
  map to. `tests/client/ControlPanelAccessibility.test.ts` pins the names and roles.
- Both audits were run on the real code. They found: two unnamed sliders, a meter that
  announced nothing, and a readout wearing `cursor-pointer` with no handler. All fixed.

**What is still open on this item:**

- **The feeds.** `EventsDisplay.ts` (716 lines) and `AttacksDisplay.ts` have not been touched —
  no typography, no tokens, no information design. This is the biggest remaining piece.
- **Layout.** Nothing has moved. The brief wants chrome that hugs the edges and hides with one
  key; the control panel, the stats table and the build menu still sit where upstream put them.
- **The radial menus.** `RadialMenu.ts` (1402 lines) and `RadialMenuElements.ts` (819) are
  untouched.
- **The rest of the palette sweep.** 328 raw hue class names remain across the HUD, mostly in
  the modals (`PlayerPanel.ts` 48, `SendResourceModal.ts` 31, `MultiTabModal.ts` 30) and the
  three leaderboard tables. The two tick-by-tick surfaces are clean and a test keeps the
  control panel that way.
- **Stat tiles, meters and sparklines beyond the troop meter.** `dataviz` is mandatory before
  the first line of any of them.

**Carried to item 7 (mobile):** the attack-ratio slider's hit area is 6px tall. Fixing it
properly means restyling the native range control, which is mobile's job, not a padding patch.

### 7 — Mobile

`src/client/InputHandler.ts` (1238 lines) already handles pointer events, long-press and pinch,
including a Safari `GestureEvent` path for trackpad pinch. So this is not "add touch" — it is
thumb reach, hit-target sizes, and a HUD that survives a phone.

**Done (session 9), all found by putting the game on a 375x812 viewport and looking:**

- **Rotating the phone threw the map off screen.** `syncCamera` derives the camera centre from
  the canvas size, and nothing compensated when that size changed — a 375→812 rotation moved
  the view 1295 tiles across a 2000-tile map. `resizeOffsetShift` in `TransformHandler.ts`
  cancels it; the ResizeObserver in `ClientGameRunner.ts` applies it and refreshes the bounding
  rect, which hit-testing and the blast falloff also read. Proved with the same sequence run
  with and without the change.
- **The phone header drew its controls over the wordmark** — `1fr auto 1fr` gave the middle
  column the logo's natural 230px and left 56px for 176px of controls. `PlayPage.ts`.
- **The attack-ratio slider is a 44px target** with a 6px visible track, a 22px thumb and a
  focus ring (`.slider-touch` in `styles.css`).

**What is still open:**

- **Layout.** Nothing has moved. The brief's "chrome hugs the edges and hides with one key" is
  unexercised on any width, and on a phone it is the difference between playing and not.
- **The spawn screen wastes a portrait phone.** Fitting a 2:1 map into a 0.46:1 viewport leaves
  the map 375x170 in an 812-tall screen and the rest dead grey. In-game is fine (the camera
  zooms to the player on spawn) — it is only the _choose a starting location_ screen. Whether
  to fit, fill-and-pan, or ask for landscape is a product decision, not a bug to fix blind.
- **The rest of the HUD at phone width** beyond the control panel: the radial menus, the stats
  table, the modals.

**Definition-of-Done item that cannot be closed here:** real mobile Safari. The pane emulates
an Android touch device — `resize_window` with a width under 768 sets a mobile user agent and
five touch points — which is enough to find layout and hit-target faults and not enough to
close the item. Needs a device or BrowserStack.

### 8 — Onboarding

**Done (session 9).** `src/client/hud/Tutorial.ts` holds **6 steps**, down from 22: `spawn`,
`attack_wilderness`, `attack_ratio`, `buy_city`, `propose_alliance`, `whats_next`. The first
five are the brief's beats; the last is the hand-off, which names the help panel and sends the
player to a real lobby. Verified live: the panel reads "Step 1 of 6".

Everything the removed steps taught is already in `help_modal` (`build_city_desc` through
`build_sam_desc`, `info_alliance`), so the cut needed no new reference to be written.

**Two deliberate losses**, so nobody re-derives them as bugs:

- `capture_tribes` was the only step with `highlight: "tribes"`, so the target crosshairs over
  the nearest tribes are gone. Its _teaching_ survives in the build step's earn-gold text.
- The `troops` and `troop_rate` info steps are gone. Both were "read this", and after session
  9's HUD work the readouts state their own meaning — the meter is a labelled meter and the
  rate tile carries a caret and a tooltip.

**This section used to say "There are no tutorial tests at all." That was wrong** — `tests/Tutorial.test.ts`
had 13, and seven of them failed the moment the steps were cut, which is exactly the safety net
the note said was missing. Check before repeating a claim like that.

The rewritten file keeps the mechanics coverage and adds three tests that hold the arc as a
contract: the exact step list in order, that exactly one step asks the player to build
anything, and that the last step is one they must read.

**Left behind:** the `tutorial.step.*` copy for the removed steps is still in `en.json` and
every other locale, unused. An orphan-key sweep is its own job.

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

### Progress

| Item                                                       | State                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 Supply lines                                           | **Done (session 10).** `src/core/game/SupplyNetwork.ts`; charged in `Config.attackLogic` and as attrition in `AttackExecution.tick`. Full description in `docs/MECHANICS.md` §02 G1. Two things deliberately left: the map does not shade unsupplied territory (a design pass, not a shader edit — it belongs with items 3 and 6 of Phase 4), and rail is not a source yet (§03 7.4 has the shape). |
| 6.2 Terrain that costs something                           | **Done for elevation (session 11).** `TERRAIN_COST` table, lobby multipliers on `GameConfig.terrain`, height / climb / high-ground curves; `docs/MECHANICS.md` §02 G2. Forest, marsh, desert, urban and river crossings deliberately not: no spare byte, no painted content, topology change — reasons and hook points in G2.                                                                       |
| 6.3 Materials, Manpower, upkeep, blockades, embargo price  | **In progress (session 11): upkeep done** (`docs/MECHANICS.md` §01 "Upkeep"). Materials, blockades and the embargo price next; Manpower already exists as `maxTroops` (cities and land cap regen) and should be surfaced, not duplicated. Materials is the part the "two update lanes" note below was written for.                                                                                  |
| 6.4 Military breadth, nuke consequences                    | Not started.                                                                                                                                                                                                                                                                                                                                                                                        |
| 6.5 Tiered relations, war goals, coalitions, reputation    | Not started.                                                                                                                                                                                                                                                                                                                                                                                        |
| 6.6 Doctrines and stability                                | Not started.                                                                                                                                                                                                                                                                                                                                                                                        |
| Phase 4 item 9 — build queue, rally points, attack presets | Not started; folded into Phase 5 (it is the only simulation item on the Phase 4 list).                                                                                                                                                                                                                                                                                                              |

### Before starting Phase 5

Five things learned doing Phase 4 that apply to every item below, because Phase 5 is the first
phase where nearly every change is a _simulation_ change.

- **The determinism hash is a two-way instrument, not just a gate.** It reads
  `final hash <N>` on every `npm run perf:gate` and `npm run test:determinism`. Session 10 is
  the worked example of the second half of this: supply lines moved it from
  `23404413546031824` to `23180482065575010`, and then lengthening the correcting sweep from
  20 ticks to 60 moved it again to `23307802903294904` — a cadence change is a simulation
  change, and the hash says so before any test does. The Phase 5 constant is now
  `23307802903294904`.
  - A refactor that is _supposed_ to change nothing must leave it **identical**. Session 7
    swapped `setTroops(a + b)` for `commitTroops(b)` inside `AttackExecution`'s merge and the
    hash stayed at `23404413546031824` — stronger evidence than any test that the simulation
    does the same work. It has read that value in every session from 7 to 9, across an
    attack-state change, two new render passes and a HUD rebuild, so treat it as the known-good
    constant for the current balance: **if it moves and you did not mean to move it, stop.**
  - A change that is _supposed_ to alter play must **move** it. If you retune a formula and the
    hash is unchanged, your change is not live — wrong config path, dead branch, or a value
    nothing reads. Check that before believing a balance result.
  - Record the hash in the commit message when either fact is the point.

- **Know which lane a new number belongs in before you add it.** There are two, and they are
  not interchangeable:
  - The **object arrays** (`PlayerUpdate.outgoingAttacks`, and friends) are resent only when
    `diffPlayerUpdate` sees a change, so they are for values that rarely move.
  - The **packed `Float64Array` lanes** (`packedPlayerUpdates`, `packedAttackUpdates`) carry
    values that change every tick for every entity, and are the only part of the protocol with
    a real bandwidth cost at 120 players. Phase 5 adds a lot of per-tick quantities —
    materials, manpower, upkeep — and each one is this decision.
  - **The trap:** `packAttackTroopDeltas` returns early unless the arrays are _membership
    equal_. A value added to an array's comparison therefore suppresses that tick's packed
    delta (correctly — the array carries the fresh value instead), and a test fixture that ties
    an array-borne field to a per-tick one will silently stop the lane emitting at all. That
    happened in session 7 and only the existing lane test caught it.

- **`perf:gate` is not trustworthy on this machine under load.** It has read anywhere from
  2.39 ms to 19.1 ms for the _same commit_ depending on what else was running, and the browser
  pane rendering a game in software is enough to fail it on its own. Before believing a
  regression: close the pane, stop the dev stack, re-run; if it still fails, `git stash` to a
  clean tree and watch it fail the same way. An identical final hash across both runs means the
  simulation is doing identical work and only wall-clock differs. Phase 5's gate says "perf:gate
  budgets held" — hold it against an _idle_ box or the number means nothing.

- **Nothing counts as verified until it has been watched failing, or photographed.** Phase 5 is
  balance work, where a change that does nothing looks exactly like a change that works.
  Sessions 7 to 9 each lost time to that same mistake in a different disguise: a test that
  sampled the shake before the blast it asserted on, a regex guard carrying stray bytes that
  could never match anything, and two render effects shipped at opacities invisible on a live
  map. All three were caught the same way — break the thing the check watches and confirm the
  check fails. For a balance change the equivalents are the hash above and the bot-vs-bot run
  Phase 5's gate already demands; neither is optional.

- **Check where a quantity is mutated before designing around it.** Item 4's plan in §3 called
  for `startTroops`, "what the attack launched with", and that value cannot exist: attacks on
  the same target merge, so the survivor's live count jumps above its own starting figure and
  the subtraction goes negative. The fix was a different quantity (`troopsCommitted`, raised by
  a merge, untouched by losses), not a different formula. Phase 5 items 6.3 and 6.5 both
  introduce pooled quantities with several writers — `grep` every mutation site first.

### What Phase 4 still owes

Phase 4 is **not** finished and should not be treated as done when Phase 5 starts. Read the §3
table for the current state; as of session 9 the outstanding work is:

- **§3 item 9 — build queue, rally points, attack presets.** Not started, and the only Phase 4
  item that touches the simulation: three new intents, each needing a `Schemas.ts` entry, an
  `ExecutionManager` case, an `Execution` class, a test in `ExecutionManagerIntents.test.ts`
  and a `docs/MECHANICS.md` note. It is Phase 5 work that happens to be listed under Phase 4,
  so the cleanest thing is to **fold it into Phase 5 and do it under Phase 5's rules** — the
  note above about the determinism hash and the two update lanes applies to it directly.
- **§3 item 3 — halos and flashes at small zoom.** The political-block and border half is done;
  `SmallPlayerGlowPass` and `FalloutBloomPass` were never touched and have the same sub-pixel
  problem the border had.
- **§3 item 6 — the HUD's layout and the feeds.** Typography, tokens and accessibility are
  done; information design is not, and `dataviz` is still mandatory before the first stat tile,
  meter or sparkline.
- **§3 item 7 — mobile layout.** Rotation, the header and touch targets are done; the layout
  itself is not. Real mobile Safari remains unverifiable on this machine (§6).

If Phase 5 starts before these land, say so explicitly in `BUILD-STATE.md` rather than letting
the phase table imply Phase 4 closed.

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
