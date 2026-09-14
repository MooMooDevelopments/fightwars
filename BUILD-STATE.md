# FightWars Build State

Last session: 2026-09-15 (session 13) | Current phase: **5 (depth) — retune pass done, all six 6.4 units built; Phase 5 is shipped end to end (the remainders are hook points, listed in `docs/HANDOFF.md` §4)** — 6.1 (supply lines) and 6.2 (elevation) done, **6.3 done** (upkeep, materials, blockades, embargo price; Manpower surfaced as `maxTroops`, not rebuilt), **6.4 half done** (nuke consequences; the six units not started); Phase 4 is **not** closed behind it (items 3, 6 and 7 are part-done and item 9 is folded into Phase 5), and two Phase 2 items are still blocked on the owner/hardware | Build status: green

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

## Handoff — read this first (written 2026-09-14, session 12 in progress)

### Session 13 — rebase onto upstream's audio delivery

- **Rebased first** onto upstream `1e973bb53` (4 commits: the new sound set with ambience
  and a settings Audio tab, Steam locale as default language, the desktop gate's strings).
  Four conflicts, all at fork commits that touch audio:
  - `SoundManager.ts` — upstream replaced the playlist with one looping gameplay track plus
    a home-page theme (`MenuMusic.ts`), both under `/proprietary`, which the fork does not
    carry. `BRAND.assets.music` (a list) became `gameplayMusic` / `menuMusic`
    (`string | null`); both null here. `SoundManager` builds no music Howl and `MenuMusic`
    arms no gesture listener when the track is null. Upstream's own suites run against a
    mocked brand that names the tracks; `tests/client/sound/SoundManagerNoMusic.test.ts`
    pins the shipped case. The two new mp3s were removed from `proprietary/`.
  - `SoundEffectController.ts` — upstream rewrote it (nuke warnings, train-station cues,
    conquest by player type); the fork's four combat sounds (`sam-shoot`, `sam-hit`,
    `warship-shot`, `warship-lost`) were re-applied on top, and upstream's new
    per-effect channel map (`CUE_CATEGORY`, exhaustive by type) gained the four rows.
  - `Brand.ts` fonts block, `GameRenderer.ts` controller list (Ambience + ImpactFeedback),
    `ActionableEvents.ts` accept-alliance handler (sound + tier): keep both.
- **After the rebase** the Brand test found upstream's new `desktopSteamLocale` reading the
  upstream global by name — routed through `desktopBridge()`; its test and the audio
  settings test set the marker by `BRAND.desktop.windowObject` now.
- Suite 528 files / 6558 tests green, quick determinism 3/3, lint / prettier / licences
  clean.

### Session 13 — the readouts photographed and reviewed (Phase 4, Stage 4)

- **Photographed.** A solo game on the dev server, at the pane's own 800 px (phone row) and
  at 1600 × 900 (desktop). The control panel's tiles read as designed. The player panel did
  not: the materials tile sat alone on a second `justify-between` row with the right half
  empty, and a nation's relation line and doctrine chip stacked on two lines under the name.
- **Reviewed** with `impeccable /critique` (a design-review agent plus the mechanical
  detector, which found nothing) and `web-design-guidelines` (one finding: an `aria-label`
  on a bare `div` is not announced). Seven fixes, all applied:
  1. Gold, troops and materials are one `grid-cols-3` row, figure over label, so nothing is
     half a row of nothing.
  2. The doctrine chip moved into the identity row beside the nation chip, in that chip's
     exact classes — doctrine is identity, relation is state and keeps its own line.
  3. The chip's visible word is the name alone (`⚖ Expansionist`); "Expansionist doctrine"
     is its accessible name, the effect its tooltip.
  4. The occupied-land row is `role="status"` with the full sentence as its accessible name
     (`player_panel.occupied_land_aria`); the visible copy is "N tiles occupied".
  5. One factory glyph across the HUD: the player panel's tile wears the control panel's
     masked SVG rather than the 🏭 emoji.
  6. The phone row's materials figure wears ink, not muted ink, with an 11 px glyph — a peer
     currency, not a caption of gold.
  7. Both control-panel materials containers carry `role="group"` so their labels announce.
- Re-photographed: a tribe's panel shows the three tiles in one row. The nation chip in its
  new position is pinned by `tests/client/HudReadouts.test.ts` (accessible name, visible
  name) but was not re-photographed — a nation was not in reach on the map by the time the
  fix landed.

### Session 13 — Draft, and the config patch that dropped every mode

- **What shipped.** Draft as server lobby state: the host and the first other seated
  player captain, pinned to the two teams; the captain on turn — snake order — picks a
  pooled player with a `draft_pick` intent and the pick is a team pin that the lobby
  list, telemetry and the game start all read through the same path as matchmade pins,
  so the start assigns the teams the captains built and balances the unpicked as usual.
  The lobby draws the two sides and the pool in place of the team preview; only the
  captain on turn sees Pick buttons. A captain leaving resets the draft. Host toggle,
  two teams forced.
- **Found on the way, and the more important fix.** `applyGameConfigPatch` copies only
  listed keys, and none of this session's mode flags were on the list: a host toggling
  game speed, Battle Royale, Capital Strike, King of the Hill, Survival, a scenario or the
  draft after creating the lobby changed the host's screen and nothing else. The create
  path carries the full config, which is why every mode test passed and the lobby cards
  looked right. Each key is on the list now and in the patch test. Lesson: a new
  `GameConfig` field needs three places — the schema, the modal, and `ConfigPatch.ts` —
  and the third is silent when missed.
- **Guards broken and watched fail:** the draft key dropped from the patch (the patch
  test), plus the draft tests' refusals as written.
- **The wire golden moved, and was read:** `GameServerWire.test.ts`'s transcript gained
  `"draft": undefined` on every decoded lobby-info — the appended optional field, absent
  on the wire, present as a key in the decoded object. Nothing else in the transcript
  changed; the snapshot was updated on that reading.
- **Not done:** captains picking spawn regions or doctrines for their side, a pick timer,
  the draft in a public listed lobby (private lobbies only by construction: it needs a
  host).

### Session 13 — historical scenarios

- **What shipped.** Four scenarios as data in the core — 1914 and 1939 on Europe, the Cold
  War on World, the Warring States on China — each a cast of nations taken from the map's
  manifest (spawn and flag) with a doctrine from the scenario and, in the team ones, a
  bloc. A scenario id in the config makes the runner build that cast instead of the
  manifest's roster; a nation spawned by a scenario keeps its doctrine rather than rolling
  one; the bloc is a pinned team index, so humans who join are dealt into the same teams.
  A Scenario section in the host and solo lobbies: none, or a card with the era and the
  blocs; a pick sets the map, the mode and the team count. Warring States dresses
  provinces as kingdoms under their own names.
- **Guards broken and watched fail:** the blocs ignored, the doctrine dropped from the
  cast, the spawn forgetting the doctrine.
- **Not done:** the rotation (a `isScenario` roll), bloc names on the teams themselves (the
  game's teams are colours; the card names the blocs), a scenario's humans placed inside
  their bloc's ground (spawn areas are the map's, not the scenario's).

### Session 13 — placements

- **What shipped.** Ten provisional games per ladder. The rating moves from the first game
  as it always did — the deviation already says how little it means — but until ten games
  a player is off the ranked ladder, their profile and `/users/@me` carry
  `placement: {played, of}`, and the ranked modal's card reads "Placement: n of 10 games"
  instead of a number. The raw `/public/leaderboard/:ladder` endpoint is untouched: it is
  data, with `games` on every row.
- **Guards broken and watched fail:** the ladder listing the unplaced, everyone counted as
  placed.
- **Not done:** a placement badge on the profile page and in the leaderboard modal's own
  row for the viewer (the ranked card is the one place the number is shown today).
- **Pushed red, fixed in the next commit.** The commit chain ran the suite, the quick
  gate, the perf gate and the commit as one line without stopping on the suite's one
  failure — `tests/api/Seasons.test.ts` expected one-game players on the ranked ladder,
  which placements now hide. The gate must gate: `&&` between the suite and the commit,
  never `;`. Same lesson as session 13's game-speed commit, relearned; recorded twice now.

### Session 13 — Blitz in one click

- **What shipped.** A fourth card in the speed section of the host and solo modals:
  Blitz. One click sets 4×, the compact map (through the modal's own compact handler, so
  bots and nations rescale as they do for the toggle) and twenty game minutes on the
  clock — five wall minutes at 4× — and the card reads pressed while all three hold. The
  join view, which only reads, does not get it. Same grammar as the speed cards, a hint
  line under the label.
- **Guards broken and watched fail:** the preset forgetting the map, the card never
  reading pressed.
- **Not done:** nothing in §6.7's Blitz line; the rotation and the lobby now agree.

### Session 13 — Survival, co-op against nations that keep coming

- **What shipped.** `SurvivalExecution` on top of the Humans-vs-Nations preset the game
  already had: the lobby toggle (host and solo) sends team mode and that preset, and the
  playlist's `isSurvival` forces both after the roll. Every two minutes after the spawn
  phase, wave n hands each living nation fifteen percent of its own troop ceiling times n
  (capped at the ceiling) and 200k gold times n, announced in the feed; the humans win at
  twenty minutes with one alive, the nations win the second the last human falls, both
  through the ordinary team `setWinner`. The land win keeps running beside it.
  `GameConfig.survival` appended, a badge, `balance:run --survival`.
- **A/B, 8000 ticks (the off arm reproduces the zone-layer commit's hash; the instrument
  has no humans, so the waves inflate the nations against each other):**

  | metric (World, Medium, 150 bots, seed `perf-gate`) | off                                           | `--survival`                                                  |
  | -------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
  | winner by 8000                                     | none yet                                      | team Nations, on the first check (no human in the instrument) |
  | alive at 8000                                      | 25                                            | 31                                                            |
  | top-1 / top-5 share                                | 13.9 % / 53.1 %                               | 16.8 % / 52.3 %                                               |
  | ports / cities                                     | 100 / 158                                     | 132 / 166                                                     |
  | leader's troops                                    | 3.79M (DR Congo)                              | 2.37M (Japan) on 110k tiles                                   |
  | wall time, 8000 ticks                              | 24.9 s                                        | 54.2 s                                                        |
  | final hash                                         | `44138072306226350` (the zone-layer commit's) | `48608727574649150`                                           |

  Read: the instrument has no humans, so the loss fires on the first check and the rest is
  the sim running past a declared winner with six waves of reinforcements landing on
  every nation — twice the wall time is the cost of nations fighting at their ceilings.
  What the mode does to a human side is not measurable here; the tests pin the waves,
  the win and the loss.

- **Guards broken and watched fail:** the reinforcement dropped, the waves not growing,
  no loss on the last human, no win at the clock.
- **Not done:** nations that aim at the humans by design (they fight by team already but
  choose targets as usual), a wave countdown in the HUD, a lobby timer shorter than the
  survival clock still ends the game the old way (the playlist sets none).

### Session 13 — the zone layer: the ring and the hill on the map

- **What shipped.** A `Zone` game update from the core (Battle Royale on every shrink,
  the hill once), one live zone per kind on the client's frame, and `ZonePass` in the
  WebGL renderer: the range circle's single-quad SDF with a kind switch. The Battle
  Royale ring is a two-tile rim in the fallout's warm hue that breathes on the wall clock
  with a faint haze outside it — the direction of loss reads before the ground is
  irradiated; the hill is a gold disc at low alpha with a firm rim. Drawn under the build
  preview's range circle. Direction: the renderer's own overlay grammar (the range circle,
  the SAM radius, the fallout bloom), no new visual world — so no `frontend-design` pass,
  and no skill audit on a forty-line shader: the check was the world map in the browser
  pane, where the hill sits on the Gulf of Guinea coast (the map's centre is water, so it
  moved to the nearest land) and reads at spawn zoom as a gold disc with a firm rim.
- **Guards broken and watched fail:** the view never marking its zones dirty, the ring
  never announced. Typecheck (`tsc --noEmit`, which the production build runs) caught the
  wrapper `MapRenderer` missing the new method — vitest does not type-check, and two
  committed tests carried type errors (`PlayerType.FakeHuman`, a `name()` on a possibly
  unowned tile) that only `tsc` saw; fixed here. **Run `tsc --noEmit` before a commit that
  touches the client**; it is not in `npm test` or `npm run lint`.
- **Not done:** a capital marker for Capital Strike; a HUD score for the hill; a countdown
  to the next shrink.

### Session 13 — King of the Hill, hold the middle

- **What shipped.** `KingOfTheHillExecution`: the hill is every land tile within six
  percent of the shorter side of the map's centre, moved ring by ring to the nearest land
  when the centre is water so every map has one. Once a second the owner with the most of
  it — a player in FFA, a team in a team game — scores a point; a tie or an empty hill
  scores nobody; the first to five minutes, cumulative, wins through the same `setWinner`
  the land win uses, so records, ratings and the post-match screen see an ordinary win.
  The standing is posted to the feed every thirty seconds. `GameConfig.kingOfTheHill`
  appended, a lobby toggle, `isKingOfTheHill` in the rotation (three tickets, never with
  the doomsday clock or Battle Royale) with a badge, `balance:run --king-of-the-hill`.
- **A/B, 8000 ticks (the off arm reproduces the Capital Strike commit's hash):**

  | metric (World, Medium, 150 bots, seed `perf-gate`) | off                                               | `--king-of-the-hill`                                                  |
  | -------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
  | winner by 8000                                     | none yet                                          | DR Congo, on the hill (the centre of the world map is central Africa) |
  | alive at 8000                                      | 25                                                | 22                                                                    |
  | top-1 / top-5 share                                | 13.9 % / 53.1 %                                   | 19.9 % / 63.3 %                                                       |
  | uprisings (alive)                                  | 261 (1)                                           | 262 (0)                                                               |
  | final hash                                         | `44138072306226350` (the Capital Strike commit's) | `40177875890187300`                                                   |

  Read: the win lands inside 800 game seconds because a nation that spawned on the hill
  keeps it — nobody contests the middle on purpose, so the mode is decided by the spawn
  until nations learn to want the hill. Everything after the win is the sim running past
  a declared winner (nations stop attacking once one is set), which is why the arms
  differ beyond the hill. The balance report now prints the winner, for every mode.

- **Guards broken and watched fail:** a tie scoring the first counted, no winner at the
  target, water counted as hill, the score not kept.
- **Not done:** the hill drawn on the map and a score readout in the HUD — the feed is the
  only tell, every thirty seconds — and nations that contest the hill on purpose. Three
  modes now share the same gap: nothing draws Battle Royale's ring, the hill, or a capital.
  One zone layer in the renderer closes all three; it is the next UI item in §5.

### Session 13 — Capital Strike, the nation collapses into rebels

- **What shipped.** `CapitalStrikeExecution`: a nation's capital is its spawn tile — the
  tile the supply network already feeds from, so no new unit, no new wire field beyond the
  flag. Once a second, a living human or nation whose capital another player holds
  collapses: the taker is paid as for a conquest (the existing `conquerPlayer` — gold, the
  kill, the finishing place), and every other tile, the troops and every structure and
  ship pass to a rebel tribe raised against the taker on the §6.6 partisan machinery, so
  the taker cannot absorb the remains as an enclave and has to fight for them. A capital
  merely lost — nuked, irradiated, relinquished by the Battle Royale zone — does not fall:
  nobody took it. `GameConfig.capitalStrike` appended, a lobby toggle, `isCapitalStrike`
  in the rotation (three tickets, composes with everything) with a badge, a broadcast
  event, `balance:run --capital-strike`.
- **A/B, 8000 ticks (the off arm reproduces the Battle Royale commit's hash):**

  | metric (World, Medium, 150 bots, seed `perf-gate`) | off                                              | `--capital-strike`       |
  | -------------------------------------------------- | ------------------------------------------------ | ------------------------ |
  | alive at 8000                                      | 25                                               | 27                       |
  | land claimed                                       | 100.0 %                                          | 100.0 %                  |
  | top-1 / top-5 / top-20 share                       | 13.9 % / 53.1 % / 99.3 %                         | 11.8 % / 41.2 % / 97.5 % |
  | uprisings (alive)                                  | 261 (1)                                          | 363 (4)                  |
  | cities / ports / factories                         | 158 / 100 / 39                                   | 154 / 107 / 32           |
  | alliances: pacts / defensive                       | 22 / 10                                          | 14 / 16                  |
  | final hash                                         | `44138072306226350` (the Battle Royale commit's) | `49283760174073100`      |

  Read: collapses happen by accident — nations do not aim at capitals — and each one
  hands a rebel tribe the fallen nation's whole remainder, which is why the leader's share
  and the top five's are lower and more tribes are alive at the horizon. The instrument
  does not count the collapses themselves; the event feed does, in a real game.

- **Guards broken and watched fail:** the land not passed to the rebels, the units not
  passed, a held capital counted as taken, an empty capital counted as taken. One test
  first built its structure on the capital tile itself — which the striker's conquest
  captures before the collapse — and would have passed with the unit hand-over dropped;
  it stands on the nation's other ground now.
- **Not done:** a capital marker on the map and in the attack-hover breakdown (the spawn
  tile is not drawn today, so a player has to remember where they started), and nations
  that aim at capitals — the AI plays the mode as a normal game and only collapses others
  by accident.

### Session 13 — Battle Royale, a shrinking zone

- **What shipped.** `BattleRoyaleExecution` (`src/core/execution/`): a circle on the map's
  centre, starting wide enough to hold every tile; three game minutes after the spawn
  phase it shrinks in twelve equal steps of radius, one every thirty seconds, to a tenth
  of the start. From the first shrink a sweep cycles the map 32 rows a tick, walking only
  the part of each row outside the circle: land outside is relinquished and irradiated —
  fallout, the state a nuke leaves, which the win check already discounts, so the win bar
  tracks the zone — and at the end of every pass every unit outside is destroyed. Integer
  maths only. Each step posts an event. `GameConfig.battleRoyale` appended to the wire
  schema, `Config.battleRoyale*()` accessors for the schedule, a toggle in the host and
  single-player modals, `isBattleRoyale` in the public rotation (three tickets, never
  beside a doomsday clock or Blitz) with a lobby-card badge.
- **The first A/B found the design flaw.** The first cut scorched each band once. It ended
  with zero fallout and 99.9 % of the land claimed: this fork's fallout clears itself after
  three minutes and irradiated ground can be conquered, so the nations simply walked back
  out. The zone is now a standing rule — the sweep never stops, and ground reclaimed
  outside the circle is lost again within one pass (about three seconds on the world map);
  a test pins a conquest outside the zone undone and the fallout outliving its lifetime.
- **A/B, 8000 ticks, `balance:run` (lever `--battle-royale`; the off arm reproduces the
  Blitz commit's hash):**

  | metric (World, Medium, 150 bots, seed `perf-gate`) | off                                      | `--battle-royale`                                                       |
  | -------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
  | alive at 8000                                      | 25                                       | 6                                                                       |
  | land claimed                                       | 100.0 %                                  | 4.3 %                                                                   |
  | fallout                                            | 0                                        | 624,357 tiles (95.8 %), 715 of them owned mid-sweep                     |
  | top-1 / top-5 share                                | 13.9 % / 53.1 %                          | 49.1 % / 96.7 %                                                         |
  | cities / ports / factories                         | 158 / 100 / 39                           | 10 / 3 / 5                                                              |
  | trade ships at sea                                 | 403                                      | 2                                                                       |
  | wall time, 8000 ticks                              | 24.9 s                                   | 34.4 s (the sweep, ~1.2 ms a tick averaged; 32 rows a tick is the dial) |
  | final hash                                         | `44138072306226350` (the Blitz commit's) | `11967845698967392`                                                     |

  The first cut's arm, for the record: 51 alive, 99.9 % claimed, zero fallout, hash
  `34227311783745136` — a scorch the map healed from.

- **Guards broken and watched fail:** the relinquish dropped, the unit deletion dropped
  (the first version of that test passed with the guard gone — a defence post goes down
  with its land already, so the test now uses a warship on ground nobody owns), the sweep
  stopped after its first pass.
- **Not done:** the zone drawn on the map (a ring layer in the Pixi renderer) and a
  countdown to the next shrink in the HUD — the event and the fallout are the only tells
  today.

### Session 13 — Blitz in the public rotation

- **What shipped.** `isBlitz` as a public-game modifier: a compact map (forced), 4× speed,
  `maxTimerValue` 20 game minutes — five wall minutes at 4× — with four tickets in the
  special pool (it is the mode that gets shared), mutually exclusive with a peace time and a
  doomsday clock (five minutes has room for neither), and a "Blitz" badge on the lobby card
  in the modifier-badge grammar. Appended to the modifiers schema so the binary wire keeps
  its field order.
- **Guards broken and watched fail:** Blitz at normal speed, Blitz on a full-size map,
  Blitz beside a peace time.
- **Not done:** a one-click Blitz preset in the host and single-player modals (a host can
  set compact + 4× + five minutes by hand today).

### Session 13 — Phase 6 opens: game speed, the engine under Blitz

- **What shipped.** `GameConfig.gameSpeed` (1–4, absent = 1): turns per 100 ms of wall
  clock. The simulation never reads it — a tick is a tick, and every duration in ticks
  compresses with it, which is exactly what "4× speed" means. The server divides its turn
  interval and its turn-stats budget by it; the local server divides the same way for
  singleplayer; the HUD clock divides game seconds by it so a five-minute Blitz at 4× reads
  five on the clock, not twenty. The host lobby and the single-player modal offer 1× / 2× /
  4× in the settings component's own card grammar; the join view, which only reads, does
  not. Appended to the config schema so the binary wire keeps its field order.
- **Measured / pinned:** the server commits 10 / 20 / 40 turns a second at 1× / 2× / 4×
  under fake timers; the schema refuses 0 and 5; nothing in the sim's config moves with
  it (spawn phase, cooldowns, costs). Not measured: a real 4× lobby's tick budget on this
  box — the perf gate's 3 ms tick against a 25 ms interval leaves room, and the
  turn-stats "over budget" column will say if it does not.
- **Guards broken and watched fail:** the server ignoring the speed, the selector saying
  nothing.
- **Not done in this commit:** the Blitz preset itself (small map, 4×, five minutes) as a
  lobby button and a public-playlist entry — next.

### Session 13 — automation detection, and the fog-of-war decision

- **What shipped.** `AutomationScorer`: forty arrival times per client; eight intents a
  second over the window is a rate no hand sustains, four a second with the gaps' coefficient
  of variation under 0.08 is a machine's timing. Flagged once, to the log with the numbers
  and to `numAutomationFlags()`. A verdict, never a punishment — the caps and the shadow
  already bound what a script can do, and a false flag must cost a player nothing. The
  thresholds are exported and the tests sit on either side of each: a machine at 200 ms
  even is flagged, twelve a second ragged is flagged, five a second swinging 120–280 ms is
  a hand and left alone, one a second even is a metronome and left alone.
- **Fog of war, decided: out of scope.** Every client runs the whole sim from one intent
  log; server-side fog is a rewrite of lockstep, the replay format and the desync check
  together, and client-side fog hides nothing from a client that holds the state. Written
  into `docs/MECHANICS.md` §06 2e so nobody builds the client-side version by mistake.
- **i18n audit:** continuous rather than a pass — `tests/TranslationSystem.test.ts` fails
  on any string without a key or any key without a use, and every FightWars string this
  session went through it.
- **Guards broken and watched fail:** evenness ignored (a ragged hand became a machine),
  the server never scoring.

### Session 13 — spam caps, the clock-only cooldowns, and a map of the game's own

- **What shipped.** `IntentCaps` caps the social intents per client and family with token
  buckets — emoji 10 / 10 s, quick chat 10 / 10 s, alliance intents 15 / min, donations
  10 / min, targeting 10 / min, embargoes 20 / min — dropped with 429 and counted, never a
  kick; attacks, builds and moves are never capped. The shadow reads the sim's cooldown
  predicates that depend on nothing but the clock (emoji, quick chat, embargo-all) and
  refuses an intent inside one; the relation-dependent predicates (donate, alliance,
  target) are deliberately left alone, an alliance made this turn would make them wrong.
- **A bug the shadow would have shipped.** `loadTerrainMap` caches `TerrainMapData` per map
  and size for the whole process, and the `GameMap` inside carries tile ownership. Every
  client runs one game per worker, so nobody had noticed; two shadows in one server process
  shared territory — the second test's spawn failed on land the first test's game owned.
  `createGameRunner` takes `{ freshMap: true }` now and the shadow passes it. Found by the
  tests interfering with each other, which is the kind of finding the note in HANDOFF §2
  about test-order coupling is for.
- **Guards broken and watched fail:** the emoji cooldown ignored, the shared map (two
  cases), the caps unconsulted. Two things learned writing the tests: an intent's execution
  is added on its turn and runs on the next tick, so a check right after `applyTurn` sees
  the state before it; and an emoji intent carries an index into the emoji table, not the
  glyph.

### Session 13 — the winner is the server's

- **What shipped.** The shadow keeps the `WinUpdate` its sim declared — the same update
  every client votes from, winner and stats. A winner vote that names anyone else is
  overruled (logged, `numOverruledWinnerVotes()`) and never enters the tally; the honest
  ballots still carry the vote so the end of the game keeps its timing. The archived record
  carries the shadow's winner and stats whenever it has them (`settledBy: "shadow"` in the
  log), whoever voted for what; without a shadow the vote stands as before. Headline 1's
  "winner and stats by client vote" is closed for every shadowed game.
- **Guards broken and watched fail:** any vote counting, the record taking the vote.
- **Not exercised end to end:** a real game ending on the dev server (a one-player private
  lobby does not start); `ShadowSim.test.ts` shows no win before the sim declares one, and
  the integration test drives the server with a fake shadow that has.

### Session 13 — the server's hash is the desync reference

- **What shipped.** The shadow keeps the state hashes its sim emits every ten ticks — the
  same numbers the clients report, from the same code. `DesyncDetector.check` takes a
  `reference(turn)`; where the shadow has a hash for the turn under check, that is the
  correct hash, every client that reported something else is out of sync, no vote and no
  strict-majority rule, and a lone client is checked too (headline 2 used to skip a room of
  one). Where the shadow has nothing, the check is the vote it always was. A majority of
  tampered clients cannot outvote the server any more.
- **Guards broken and watched fail:** the vote outranking the server (three cases), the
  shadow forgetting its hashes, the server never asking.

### Session 13 — Phase 7 opens: the server runs its own copy of the game

- **What shipped.** `ShadowSim`: the server builds the same `GameRunner` the clients run
  (`createGameRunner` with `ServerMapLoader`, which resolves map files the way
  `MapLandTiles` resolves a manifest — hashed under `static/` in production, `resources/`
  in dev), feeds it every committed turn from `endTurn`, and asks it before a gameplay
  intent joins a turn. A refusal is a 403 with the reason, logged and counted: the game's
  `numShadowRefusals()`, the worker's `shadowRefusalCount()`, a "refused" column on the
  metrics dashboard, the OTel gauge `shadow_refusals.total`. `SHADOW_SIM=off` runs the
  relay alone. `docs/MECHANICS.md` §06 2e has the rule list.
- **The line it draws.** One turn behind the clients, it refuses only what cannot become
  possible within a turn: a client with no player, a spawn after the phase, a dead player, a
  disabled unit type, an attack on oneself or on nobody, a unit that is not the sender's.
  Gold, territory, reachability and alliances move within a tick, and refusing on them would
  drop honest intents — those stay the simulation's, where every client applies the same
  rule. Until its map loads it judges nothing; if the map fails or a tick throws, it logs
  and judges nothing from then on. The relay never depends on it.
- **Measured.** Through the server's own loader on this box: the world map in 47 ms, 300
  turns with 50 bots in 255 ms (0.85 ms a turn early in a game). A stranger's intent refused,
  a player who failed to spawn refused as dead after the phase. Not exercised through a real
  lobby: the pane cannot fill a second seat, and a one-player private lobby does not start.
- **Guards broken and watched fail:** the dead keep playing, anyone's unit (the first cut's
  ownership case was conditional on a nation existing and skipped itself — a third player
  made it unconditional), the server ignoring the shadow.
- **Also fixed in passing:** a `clientID` in a server test must match the ID regex or
  `start()` bails at the start-info parse before any hook runs — the harness's `cid()`
  makes valid ones.

### Session 13 — item 7's remainder, looked at on a phone

- **Photographed at 375 × 812** (the pane's mobile preset: Android user agent, five touch
  points): the home page (wordmark, the four actions, the lobby cards — nothing overlaps),
  the spawn screen, the in-game HUD row (gold with materials stacked under it, the troop
  meter with its rate, the sword and the 44 px slider — all on one row, nothing clipped),
  the leaderboard (full-width table, five rows, readable), the top-right cluster with the
  new eye. The radial and the player panel were not reached: the taps that should have
  opened them attacked instead and the player died at 0:55; a spectator gets no menu.
- **The spawn-screen decision, taken:** _fit_, and no change. The handoff called the dead
  grey above and below a 375 × 170 map waste. It is not empty: the prompt sits above the
  map, the doctrine picker below, the tutorial at the foot, and the whole map is what a
  player wants to see before choosing a spawn — a filled-and-panned map would hide half
  the world at the one moment the player is choosing where in it to be. Pinch is there for
  anyone who wants a closer look.
- **What item 7 still owes:** the radial and the panel at phone width, seen; real mobile
  Safari (hardware).

### Session 13 — item 9 closes: a build queue of one, client-side

- **What shipped.** An unaffordable item in the build ring (and in the Ctrl+click grid) is
  no longer dead: it wears the disabled grey, its tooltip says "Click to queue it; it builds
  when you can afford it", and a click queues it. `BuildQueueController` holds the one
  queued build, asks the worker once a second whether it can be built now — the same
  question the build menu asks when it opens — and the tick the answer is yes sends the
  ordinary build intent and forgets. The control panel shows "Queued: City ✕" on a strip of
  its own under the readouts, with a cancel; asking for the same build again also cancels,
  which is the phone's way out. A player who dies loses the queue. One, not many: a second
  queued build would sit behind the first for whatever the first costs, and a player who
  wants two things says which comes first by asking for it first.
- **Photographed.** The build ring at 28K gold with a 125K city: grey, the hint in the
  tooltip, the click, the toast, the chip. The first cut put the chip in the readout row and
  it squeezed the troop meter until "12.1K / 12.1K" lost its second figure — the strip is
  what fixed it. Re-photographed with the meter whole. The queue firing was not seen live:
  the player died at 2:39 with the city still 90 K short, and the chip went with them —
  which is the death clause doing its job; the firing is the unit test's.
- **Guards broken and watched fail:** building when the worker says it cannot, asking every
  tick instead of once a second, the queue outliving the player.
- **Item 9 is closed.** Presets, rally point and build queue are all client-side, none
  touched `src/core`, the determinism gate never moved.

### Session 13 — item 9: a rally point for warships, client-side

- **What shipped.** `O` over water sets the rally point; the tick a new warship, submarine
  or carrier of the player's own appears, `RallyPointController` sends it the ordinary move
  intent — the one a click on the water sends for a selected ship. `O` over land clears it.
  The move indicator marks the tile when it is set and each time a ship is sent. Listed and
  rebindable. The simulation never knows a rally point exists; a ship that cannot reach the
  tile is refused by the same water-component rule that refuses a click.
- **Guards broken and watched fail:** other players' ships sent (the owner clause), ships
  from earlier ticks sent (the created-at clause), land accepted as a rally point.
- **Not photographed** — a port, a warship and the key are a couple of minutes of browser
  work and the unit tests cover every clause; the standing flag on the map is the hook
  point (a pass of its own; `MoveIndicatorPass` is a transient animation).

### Session 13 — item 9 opens: attack presets, client-side

- **What shipped.** Four keybinds — `Shift+1` to `Shift+4` — set the attack ratio to a
  quarter, half, three quarters and everything (`ATTACK_PRESETS`, `SetAttackRatioEvent`).
  A step key nudges the ratio; a preset key names it, so a probe becomes an all-in in one
  press without counting increments. The plain digits stay the build menu's — the key
  matcher compares the shift state, so the two never collide. Listed and rebindable in the
  settings' keybinds tab. Like the step keys, a preset changes this game's ratio and not
  the stored default, which the slider and the settings own.
- **Item 9 re-read.** HANDOFF §3 said the three features are intents through the lockstep
  protocol. Presets are not, and neither need the other two be: a build queue is a client
  that holds a build order and sends the ordinary intent when the gold is there; a rally
  point is a client that sends the ordinary move intent to each new warship of its own.
  Nothing new rides the wire and the simulation stays as it is. That is the plan for both
  (`docs/HANDOFF.md` §3 item 9).
- **Guards broken and watched fail:** the panel ignoring the event (two cases), the keys
  not wired. Not photographed: the browser pane's synthetic key press carries no `code`
  (noted at the HUD-hide entry); the input-handler test is the evidence.

### Session 13 — the leaderboard tables and the send-resource modal name no raw hue

- **What shipped.** The three leaderboard tables (117 raw hue classes between them and the
  send-resource modal) and the modal are at zero, held there by `HudTokens.test.ts`. What
  said something: the podium (yellow / slate / amber), the local player's row and the clan
  tag (blue), win against loss (green / red — the dichromat trap the feeds already left),
  the loading spinner and every error state (red), the modal's primary action (indigo),
  its cap marker and dead-target note (amber), its keep figure (amber / emerald).
- **Two new tokens, measured before they were chosen.** `rank-silver` is the muted ink
  (28.0 CIEDE2000 from gold at its worst); `rank-bronze` is the classic #cd7f32 (20.2 from
  gold, 36.2 from silver, 11.9 from `signal` for the worst-off viewer — the podium must not
  read as an alert — 5.68:1 on the surface). Twenty candidates were measured with the
  repo's own CIEDE2000 and vision simulation; the runner-up bronzes either fell under 4.5:1
  on the surface (#b45309, #c2410c) or sat within 12 of `signal`. Pinned by three tests,
  broken and watched fail (bronze set to `signal`; silver set to gold).
- **The rest wears the roles it already had:** wins are `gain`, losses `loss`, the local
  row and the tag the `action` ramp, the spinner `action`, every error `loss`, the primary
  button `action` / `action-hover`, the cap and the boost `signal`, the keep figure `alert`
  / `gain`, greys as ink steps on `surface-deep`.
- **Not photographed.** The dev box has no leaderboard data (the modal says "no data yet"),
  and the send-resource modal needs a second player to send to. The tokens are measured;
  the layout is untouched.
- **Palette sweep count:** 265 → 148 raw hue classes across the HUD. Held to zero: the
  control panel, the feeds, the player panel, the three leaderboard tables, the send-resource
  modal. What is left is the modals nobody reads mid-game and the radial menus' hex colours.

### Session 13 — the player panel names no raw hue (item 6, the palette sweep)

- **What shipped.** `PlayerPanel.ts` had 51 raw hue classes — the most of any HUD surface —
  and four of them said something: the relation chip (red / paler red / emerald / grey), the
  alliance clock (red / yellow / emerald), the traitor badge (red) and the trade line (amber
  / blue). Every one now speaks a status role the palette measures for all four viewers:
  hostile is `loss`, distrustful is `alert` (the palette's own finding — a paler red is the
  one thing a dichromat cannot tell from red), friendly is `gain`, neutral is a note; the
  clock is loss under thirty seconds, alert under a minute, gain beyond, with the seconds
  printed beside it. The greys became ink steps, the nation chip wears the action ink, the
  bot and human chips the dim ink. Zero hue classes remain; `tests/client/HudTokens.test.ts`
  holds the panel there the way it holds the control panel and the feeds.
- **Photographed, and it found the previous commit's mistake.** With the doctrine chip in the
  identity row, a nation's name truncated to "Nebr…" beside two chips. The name keeps ten
  rem for itself now and the chips wrap under it: "Nigeria", then Nation and Expansionist on
  the next line, then Neutral. Re-photographed.
- **The sweep that remains:** `SendResourceModal.ts` 41, the three leaderboard tables 30 / 26
  / 20, 265 across the HUD in all (from 328 at the start of the session-9 count). The two
  tick-by-tick surfaces, the feeds and the player panel are the ones held mechanically.
- **HANDOFF §3 item 6 was stale:** it still listed the feeds as untouched. They were done in
  session 9 (`EventsDisplay.ts` and `AttacksDisplay.ts` name no raw hue and both trays
  announce). Corrected.

### Session 13 — the chrome hides with one key (items 6 and 7, layout)

- **What shipped.** `Z` (a keybind, `toggleHud`, rebindable in the settings and listed in the
  help modal) hides every HUD surface at once — the leaderboard, the control panel and unit
  bar, the feeds and chat, the top-right cluster, the tutorial — and the map is the whole
  screen. `HudVisibilityController` owns the state: one class on the document root
  (`hud-hidden`) and one rule in `styles.css`; every surface marked `data-hud` in
  `index.html` follows without knowing. Modals and the radial menus are not marked — they are
  things the player opened, not chrome. The way back is a small "Show HUD (Z)" button at the
  bottom right that names the key the player actually has bound, because a phone has no Z;
  the top-right cluster has an eye button for the same hand. A game always starts with its
  interface, even on a page a previous game left hidden.
- **Photographed** on the dev server: the key (as a real `KeyboardEvent` — the browser
  pane's synthetic key press carries no `code`, and every keybind in the game reads `code`),
  the button at the bottom right, and the eye in the cluster. All three paths toggle it.
- **Guards broken and watched fail:** the key not wired, a stale class carrying into a new
  game, no way back.
- Stage 4 on this: `web-design-guidelines` by hand (a `<button>` with an accessible name, a
  focus ring, a hover state, decorative `alt=""` on the icon); `impeccable` not run — a
  chip and an icon in the incumbent grammar, not a surface.

### Session 13 — item 3's remainder: halos keep a width on screen

- **What shipped.** The small-player glow and the fallout bloom are blurred in tile space
  with a fixed five-tap kernel, so zoomed out they shrank with the tiles: an eight-tile aura
  is under two pixels at MIN_ZOOM, and a lone small player — the one the aura exists to
  point at — was a speck nobody found. `ZoomLegibility.haloWiden(zoom, cellTiles)` now says
  how many extra blur iterations a halo needs to be at least `HALO_MIN_PX` (6 CSS px)
  across; each iteration re-runs the same kernel at a doubling step, so it spreads without
  tearing into copies, and the composite gains ×2 per iteration to put back the peak the
  spread took. Both passes ask the policy each frame with their own cell size (four tiles
  for the glow, eight for the bloom) — the glow rebuilds its cached aura only when the
  answer changes, the bloom rebuilds every frame anyway. Inert at and above one pixel per
  tile, where both draw exactly as before, and off with `mapOverlay.politicalZoom`, the
  switch the political map already had. Item 3 has no named remainder now.
- **Photographed.** A solo game, the local player kept to a handful of tiles past the
  one-minute grace, camera pinned on them at half a pixel per tile, glow strength raised to
  1 so the pair isolates the widening: with `politicalZoom` off the aura is a three-pixel
  speck; on, a ten-pixel ring around the same tiles. At a quarter of a pixel per tile the
  pane's 1.6× downscaled screenshot could not tell the two apart either way — the floor is
  six CSS pixels and the screenshot has fewer than four of them to show. Not measured in
  pixels: the map canvas has no `preserveDrawingBuffer`, so a `drawImage` readback is black.
  The fallout bloom was not photographed (no nuke in reach); it shares the mechanism and the
  policy tests, with twice the reach per iteration.
- **Guards broken and watched fail:** never widening (two cases), one iteration too many
  (two), the cap ignored (one — a cell too fine to reach the floor is what exercises it;
  neither real bloom gets there, and the test says so).

### Session 12 (continued) — the Phase 5 readouts, the first Phase 4 increment

- **What shipped.** Materials beside gold on the control panel, in the gold tile's grammar
  (a factory glyph through `.icon-mask` carries the identity, the figure wears ink in the
  display face; on the phone row it stacks under the gold figure inside the same tile rather
  than squeezing a fifth tile in). On the player panel: a materials tile with gold and
  troops, an occupied-land row (`text-status-alert` beside ⚠ and the words, shown only when
  there is any), and a doctrine chip in the panel's own chip grammar — a name, not a colour,
  because eight doctrine colours would be eight more things for a dichromat to lose.
  Manpower needed nothing: the troop meter already prints `maxTroops` as its cap.
- **Direction held, stated once.** Dark, map-first, the map the only saturated surface;
  figures in the display face wearing ink; an icon carries identity. No new colour token —
  `dataviz` was read before the tiles and its answer for a bare stat tile is a hero figure,
  a label and no colour of its own. `frontend-design` was loaded first per the standing
  procedure; `impeccable` is the next session's review, not this commit's.
- **Not photographed in this session** — see the session-13 entry above for the dev-server
  pass, the review and the seven fixes it produced.

### Session 12 (continued) — 6.4's sixth unit: Paratrooper, and Phase 5 is whole

- **What shipped.** `UnitType.Paratrooper`: an airborne assault. A fifth of the owner's
  troops (capped at 25 000) fly from the nearest silo within 120 tiles straight to the tile
  clicked — over water, mountains, anyone's land — and land as an attack from it, the naval
  invasion's shape with an air path. Dropped on the owner's own ground by the time it lands,
  the troops come home. Nothing intercepts it; the silo's range, the cap and the price are
  its limits. `docs/MECHANICS.md` §04 D; `FORK-CHANGES.md` the files. Lever
  `--no-paratrooper` reproduces the carrier commit's hash `41848662333804620`.
- **No new wire.** A drop is a `buildUnit` intent with the target tile, the way a nuke is,
  so the client's target-click flow and the intent schema carry it unchanged. `buildUnit`
  takes `params.troops` with the plane exactly as it does for a transport — the first cut
  deducted them twice, and the "troops leave with the plane" case caught it at once.
- **Nations drop first.** `AiAttackBehavior.sendBoatAttack` — a player target out of reach by
  land — tries `maybeDrop` before looking for a shore, and the random-target boat builder
  does the same. Same seed, 8000 ticks, off → on: alive 28 → 25, top-1 15.0 → 13.9 %, top-5
  48.6 → 53.1 %, fallout 2004 → 0, hash `41848662333804620` → `44138072306226350`. Nations
  that could only shell each other across water now put troops on the far shore, and the
  map consolidates faster in the middle while the leader loses a point.
- **Three guards broken and watched fail** (the range, the landing attack, the nation hook);
  the own-land clause's break passed because the friendliness clause beside it refuses the
  owner's own tile too — recorded, not disguised.
- **The balance script's config chain became a table.** Twenty-two levers deep, the ternary
  prettier kept re-wrapping had broken an edit script three commits running. A lever is
  now one row in a list, and the first flag set picks its `Config`. A refactor of the
  instrument only: every lever reproduced its hash before and after.
- **Phase 5 is whole.** Brief §6.1–6.6 are all built, each behind a `Config` switch with a
  `balance:run` lever, tests whose guards were broken and watched fail, a `docs/MECHANICS.md`
  section, a `FORK-CHANGES.md` file list and an A/B here. What is left is hook points, all
  written down: docking at a carrier, the six units' own atlas glyphs, a shell drawn for an
  artillery volley, SAM interception of drops, forest / marsh / desert terrain (no painted
  content), vassals, war goals, the readouts and the map shading for supply and occupation,
  rail as a supply source — see `docs/HANDOFF.md` §3–§4 and the "Next up" list.

### Session 12 (continued) — 6.4's fifth unit: Carrier

- **What shipped.** `UnitType.Carrier`: a harbour that sails. Warships and submarines spawn
  at the nearest port _or carrier_ on the same water (`warshipSpawn`), and ships beside a
  carrier heal as they do beside a port (`healWarship`'s passive heal, never itself). No guns
  (the shared `WarshipExecution` gives the third hull no prey), health 2000, prey for any
  warship, moves like one. `docs/MECHANICS.md` §04 D; `FORK-CHANGES.md` the files. Lever
  `--no-carrier` reproduces the submarine commit's hash `41848662333804620`.
- **Two of the four port semantics, on purpose.** The audit listed spawn, passive heal,
  docking and the retreat target. Spawn and heal generalise to a moving harbour in one line
  each; docking does not — a retreat is a _tile_ stored in `WarshipState` and matched by
  `port.tile()` equality, and a carrier moves. Docking to a carrier means the retreat target
  becoming a unit id, which is a wire change for the whole warship state. Written down in
  §04 D as the hook; not built.
- **The hull order changed under it.** A Naval nation's second hull was the submarine; the
  carrier is now second and the submarine third. The reason is in the submarine commit's
  own numbers: a raider is sunk too soon to be the hull a third one waits on, and a carrier
  keeps the first warship alive and gives the raider that follows somewhere to spawn. The
  submarine test pins the carrier off to test the submarine's turn.
- **Four guards, four breaks** (the harbour spawn, the heal, the guns, the nation hull), each
  failing exactly its own case; the nation case was re-broken after the reorder. The heal
  case's first control — a second warship "far away" — healed two points anyway because
  ships patrol and it wandered somewhere; the control is now the same ship with the carrier
  deleted.
- **The bots cannot afford one at this horizon, and the instrument that can says so.** Same
  seed, 8000 ticks, off → on: byte-identical on Medium (`41848662333804620`) _and_ on
  Impossible (`93964623359914700`). Instrumented: the one Naval nation that reached a
  second-hull decision with a warship in hand held 1 282 materials against a carrier's
  3 000 (a warship's 1 200 is why fleets are small at all — the materials price is the
  navy's ceiling). The `NationGoldPerMinute` snapshot — Impossible, 61 nations, no tribes,
  twenty minutes — is richer and longer, and it moved: alive 22 → 20, trade gold +7.2 %
  (572.4M → 613.7M), train gold +18.2 % (105.7M → 124.9M), ships arrived 2590 → 2760. The
  carrier is live where a nation can pay for it; the bot run's horizon is what cannot.

### Session 12 (continued) — 6.4's fourth unit: Submarine

- **What shipped.** `UnitType.Submarine`: a warship hull that hides. It hunts transports and
  trade ships and never engages a warship; an enemy warship sees it only within 12 tiles or
  under one of its own radars (the radar's second job). Spawns at a port, patrols, retreats,
  docks, heals, earns veterancy and answers the move order exactly as a warship does,
  because **the same `WarshipExecution` drives both hulls** — the constructor takes the hull
  and only prey and sight differ by it. `docs/MECHANICS.md` §04 D; `FORK-CHANGES.md` the
  files. Lever `--no-submarine` reproduces the bomber commit's hash `42857537573621660`.
- **Not a flag on the warship, a hull.** The audit's sketch was a `submerged` flag on
  `WarshipState`; a second `UnitType` that reuses the execution was cheaper and cleaner —
  every warship site that should include it (docking, capture, decay, the move intent,
  selection, hover, sounds) is one added type in a list, and nothing has to ask a warship
  whether it is secretly a submarine. Cost: those lists, found by grep, not by the compiler.
- **A guard that could not fail, caught by breaking it — again.** The radar-sight case
  passed with the radar clause disabled: the far warship was on patrol, wandered inside
  the plain detection range, and saw the submarine the ordinary way. The case now pins
  detection to nothing, so the radar is the only pair of eyes; the break fails it. Five
  breaks in all (detection, prey, the radar clause, the move order, the nation hull).
- **The first A/B was byte-identical, and that was a real finding.** Nations' standing-fleet
  build fires a handful of times in 8000 ticks (two entries in 4000, instrumented), so a
  rule that lived only there never ran. The hull rule moved into `hullFor()` and the
  retaliation build — where nations actually lay down ships — reads it too. Off → on:
  warships 8 → 6, hash `42857537573621660` → `41848662333804620`, nothing else moves. The
  submarines Naval nations built were sunk by the end (0 in the fleet line): a hidden raider
  that sits next to enemy warships under their radars is found. The unit is live and small,
  which is honest for a raider in a bot world that never escorts its transports.

### Session 12 (continued) — 6.4's third unit: Bomber

- **What shipped.** `UnitType.Bomber`: a conventional strike flown from the nearest ready
  silo like an atom bomb — {4, 8} blast, speed 8, 250k gold, 300 base materials — that kills
  the troops and the units in its radius and burns nothing: no tile relinquished, none turned
  to water or fallout, the nuked layer untouched. SAMs shoot it down like a warhead. A nation
  with a silo and no warhead it can afford flies one. `docs/MECHANICS.md` §04 D;
  `FORK-CHANGES.md` the files. Lever `--no-bomber` reproduces the radar commit's hash
  `40696498796941470` to the digit.
- **The audit's shape held exactly.** A new `NukeType`, one `conventional` branch in
  `detonate`, the airborne exemption, three SAM whitelists — nothing else in the nuke path
  cared what was flying. The one thing the audit did not list: `NationNukeBehavior`'s
  helper signatures are `AtomBomb | HydrogenBomb` unions in three places; widened.
- **Three guards, three breaks** (the conventional branch, the SAM whitelist, the nation
  branch), each failing exactly its own case. `TestConfig` flattens `nukeMagnitudes` to one
  tile and `nukeSpeed` to a constant, so the table is asserted against a plain `Config` and
  the strike spies the real blast in — the `TestConfig` rule from session 11, third time.
  The nation case had to hold the treasury at 400k every tick: left alone, the nation spent
  it on cities before it ever thought about a strike.
- **Cheap strikes flatten the top.** Same seed, 8000 ticks, off → on: top-1 20.1 → 14.9 %,
  top-5 59.6 → 48.6 %, fallout 7959 → 2004 tiles, cities 163 → 147, guns 37 → 29, radars
  14 → 9, alive 28 both. Nations that could not afford a warhead now hit back at whoever is
  winning with what they can afford, and the leader pays for it. The report's "bombers in
  the air" is what is in flight at the last tick, not a strike count.

### Session 12 (continued) — 6.4's second unit: Radar

- **What shipped.** `UnitType.Radar`: a land structure that extends its owner's SAM launchers
  — a SAM within 60 tiles of an active radar intercepts 30 tiles further, capped at the SAM
  maximum of 150. `docs/MECHANICS.md` §04 E; `FORK-CHANGES.md` the files. Lever `--no-radar`
  reproduces the artillery commit's hash `51679296370667120` to the digit.
- **One read point, or nations lie to themselves.** The audit had it right: `dynamicSamRange`
  is where the launcher reads a SAM's reach, and `NationNukeBehavior` duplicated the static
  formula in four places. A bonus added only in `dynamicSamRange` would have had nations
  fly warheads into rings they thought they cleared, and the client draw a ring the launcher
  did not honour. All four nation sites now go through `dynamicSamRange`, and the client
  gets the bonus on the object lane (`UnitUpdate.samRangeBonus`, absent when 0) — the lane
  choice again: it changes when a radar goes up or comes down, not per tick.
- **The SAM did not change, so nobody would have re-sent it.** A unit update goes out when
  the unit touches itself; a radar appearing beside a SAM changes nothing on the SAM. That
  is the whole of `RadarExecution`: on the tick it comes up and the tick it falls it
  `touch()`es every SAM it covers. The test reads the tick's `GameUpdates` directly, the
  way the coalition test learnt to in session 11.
- **The `UnitState` fixtures, again.** Every render-state literal (`derive` tests, the trail
  managers, the SAM radius perf test, `PreviewAnimationTicker`) needed `samRangeBonus: 0`
  — the compiler found all seven. Five guards, five breaks (the bonus, the owner/active
  filter, the coverage range, the cap, the wire touch), each failing exactly its own case.
- **The 24000-tick gate had never seen a decided game.** `test:determinism:full` crashed at
  this commit — not a divergence, `JSON.stringify` refusing a bigint: the digest serialised
  `game.getWinner()`, which is a `Player` object, and for the first time a world match with
  150 bots and 8 humans ended inside the horizon (one human left standing). The digest now
  names the winner by id. Every earlier full gate passed because nobody had won by tick
  24000; a gate that only works on undecided games is a gate with a hole in it, closed now.
- **Nations build them beside their SAMs.** Same seed, 8000 ticks, off → on: **14 radars**
  next to 22 SAMs, alive 30 → 28, fallout 0 → 7959, guns 40 → 37, top-5 51.1 → 59.6 %,
  materials held 120k → 95k. Nations spending on defence and the top five gaining together
  is one seed's story (the retune runs swung as far); what is not noise is that the
  materials are being spent — 95k is the least left over since the pool existed.

### Session 12 (continued) — 6.4's first unit: Artillery

- **What shipped.** `UnitType.Artillery`: a land structure that bombards the attacks crossing
  its range — every five seconds it takes 2000 troops off the nearest attack on its owner
  within 40 tiles. A defense post makes an attack cost more per tile; artillery makes a
  standing attack bleed where it stands, so a front under guns is one the attacker has to
  commit to crossing quickly or not at all. `docs/MECHANICS.md` §04 D has the whole design;
  `FORK-CHANGES.md` the 30-odd files. Lever `--no-artillery` (nation ratio 0) reproduces the
  upkeep commit's hash `41594670571444300` to the digit.
- **Attacks are not units, so this is not a shell emitter.** The audit's plan was to revive
  `DefensePostExecution`'s commented ship-targeting; `ShellExecution` homes on a `Unit`, and
  an attack has only border tiles. The gun reads `clusteredPositions()` (one representative
  tile per disconnected border segment) and measures to those — bounded by the owner's
  incoming attacks, once per volley per gun. No shell is drawn for a volley; that is Phase 4
  render work, and the hook is `ArtilleryExecution.tick`'s volley.
- **Append, never insert, a `UnitType`.** `z.enum(UnitType)` rides the wire by member order
  (`zbin/README.md`), so `Artillery` went on the end of the enum and of the client's
  `ALL_UNIT_TYPES`. And the icon atlas is a pre-built PNG whose generator is not in the repo;
  node-canvas is not built under `--ignore-scripts`, so nothing here can rasterise an SVG. The
  gun draws with the defense post's atlas column (`StructurePass` maps it) and has its own
  SVG everywhere the client uses an image URL; the atlas column is the Phase 4 asset pass's.
- **The checklist held.** Five core switches enforced by the compiler (`unitInfo`,
  `canSpawnUnitType`, the three stats switches through `satisfies`), plus the ones only a test
  finds: `PlayerStatsTable` counts buildings, `NationStructureBehavior`'s hand-built config
  mocks needed `artilleryNationRatio`, the tutorial's default-key table is typed from a const.
  Four guards, four breaks (range, rate, damage, the construction gate), each failing exactly
  its own case.
- **Nations build them, and spend on them instead of nukes.** Same seed, 8000 ticks, off → on:
  **40 guns**, alive 33 → 30, fallout 3523 → 0 tiles, factories 51 → 37, ports 104 → 111,
  leader 20.3 → 19.8 %. The materials that were warheads are guns now — at 0.2 per city
  the ratio may be high; a lower ratio or a dearer gun is the retune question this leaves.

### Session 12 — the retune pass opens: uprisings scale with the conqueror

- **Rebased first** onto upstream `56a171d27` (6 commits: backend reachability in the UI, the
  machine at check-in, a server-rendered page preferring its own server, Steam link needing a
  real account, a zh-hant flag, mls). One conflict (`MainInitialize.test.ts` imports). Then
  the fork's gates: the Brand test found two more upstream comment lines naming its domains
  (`ServerList.ts`, rewritten generically), upstream's new `DesktopStatusBar` suite set the
  desktop marker by the upstream global (now `BRAND.desktop.windowObject`), two new
  `en.json` strings said "OpenFront servers" (now FightWars), and upstream's new "a guest must
  log in before linking Steam" cases contradict the fork's _a session is an account_ decision
  (`BUILD-STATE.md` Decisions, 2026-09-12) — rewritten to assert the fork rule in
  `tests/client/SteamLink.test.ts` and `SteamLinkModal.test.ts`, `FORK-CHANGES.md` says so.
- **A worktree has no `node_modules`.** The session opened in a git worktree; vitest resolved
  through the main checkout's install, so every test that spawns a child process with a
  worktree-relative path (`determinism`, `RenderDesktopDescriptor`, the PGlite migrations,
  the zbin fuzz) failed until `npm run inst` ran _in the worktree_. Five of eight red files
  were that. Install first in any worktree.
- **What shipped.** The first retune lever: `Config.unrestPartisanThreshold(occupierTiles)` is
  max(300, `unrestPartisanShare()` = 10 % of the occupier's own land), so a small conqueror
  feels an occupation at 300 tiles and an empire only at a real invasion. `UnrestExecution`
  passes `numTilesOwned()`. Lever `--flat-unrest` (share 0) reproduces the stability commit's
  8000-tick hash `47153110926552660` to the digit. Guard broken and watched fail: the
  execution reading the flat threshold fails only the new "share of the occupier's own land"
  case.
- **Second lever: the Hard/Impossible alliance cap counts allies, not pacts.**
  `hasTooManyAlliances` refuses a partner already bound to half (Hard) or a quarter
  (Impossible) of the non-tribe players; it counted every `alliances()` entry, so the pacts
  nations hand any non-hostile neighbour blocked the defensive pacts the cap rations. Now
  `allies()`; `Config.allianceCapCountsPacts()` is the switch, `--pacts-count` the lever, and
  `balance:run` gained `--difficulty` because the Medium default never reaches the cap at
  all. Guard broken and watched fail: counting every rung again fails exactly the two "grants
  a defensive pact to an asker holding many pacts" cases.
- **Where the cap bites, and where it does not.** The threshold is a share of the _non-tribe_
  player count, so with 72 nations on the world map Hard needs 36 partners and Impossible 18:
  on Hard the two 8000-tick runs are byte-identical (`67031158969095820`, nobody near it) and
  on Medium the run reproduces the unrest commit's hash. On Impossible it is live: alive
  41 → 43, pacts 28 → 37, defensive 20 → 18, fallout 24296 → 11380 tiles, leader 11.6 → 11.1 %.
  The second instrument, the impossible-nations `NationGoldPerMinute` snapshot (61 nations,
  cap 15): alive **23 → 26**, trade gold −2.1 % (475.9M → 466.1M), train gold −2.5 % (99.6M →
  97.1M). Three nations back of the eleven that snapshot lost when tiers landed, so the cap
  was part of that story, not all of it — the rest is the doctrines commit's 30 → 23, which
  is the next lever's business.

- **Third lever: nations play their doctrine.** A doctrine only changed prices, so a
  Mercantile nation built no more ports than any other. `Config.doctrineNationBuildScale`
  now weights the nation's build choice — port / factory / silo targets ×1.5, posts allowed
  under attack ×1.5 for a Fortress state, a second standing warship for a Naval one — and
  `doctrineNationExpandReserveScale` lets an Expansionist nation expand with ¾ of the reserve
  (applied once in `NationExecution.init`, after the roll). Humans untouched. Lever
  `--no-doctrine-play` reproduces the pacts commit's Medium hash `44195822438377410` to the
  digit. Four guards, four breaks, each failing exactly its own case (the port target, the
  Fortress posts, the second warship, the expand reserve). The hand-built mocks in
  `NationStructureBehavior.test.ts` had to gain `doctrine` / `doctrineNationBuildScale` —
  the "every mock gains the new method" rule, again.
- **The bots build differently; who survives is noise at two seeds.** Off → on, seed
  `perf-gate`: alive 34 → 29, posts 32 → 25, fallout 0 → 5202; seed `retune-2`: alive 35 → 34,
  posts 16 → 30, warships 10 → 18, fallout 1025 → 4671, top-1 19.7 → 16.3 %. Survivors by
  doctrine swing both ways between the seeds (Expansionist 4 → 5 then 5 → 3, Nuclear 5 → 1
  then 2 → 5), so the "Expansionist and Mercantile die more" reading of session 11 was one
  seed's story and this commit does not claim to have reversed it. What it claims: nations
  now _decide_ by their doctrine, and the structure counts say so.

- **Fourth lever: arms cost twice the materials.** The pool sat at 100k+ unused at the end of
  every bot run at the first-cut prices — supply was never the constraint, so industry never
  was either. `unitMaterialsCost` is now the base table × `materialsPriceScale()` = 2, and
  `startingMaterials()` is one post's price by construction (400), so "one post and not two"
  survives any table. Lever `--cheap-materials` (scale 1) reproduces the doctrine-play hash
  `45473217189748110` to the digit; the guard pins 400 / 40 000 and the scale, and fails
  when the scale is put back to 1.
- **The bots built industry.** Same seed, ×1 → ×2: factories 36 → 46, posts 25 → 31, warships
  14 → 8, fallout 5202 → 0 tiles, alive 29 → 33, top-1 11.5 → 13.3 %, materials still held
  157k → 132k. Nations answered the price with factories, which is the tall-versus-wide choice
  the item was built for; the pool is still large because it pools in nations with nothing to
  spend it on (no silo, no coast). Fallout 0 at 8000 ticks is one seed's story — a 3000-material
  atom bomb is a hundred seconds of one factory.

- **Fifth lever: an army costs twice as much to keep.** Session 11 left upkeep "a pressure,
  not a wall" on purpose, to be retuned once 6.3 was whole. The arms rows of `unitUpkeep`
  (post, SAM, silo, warship) now carry `armsUpkeepScale()` = 2 — a warship 80/tick, a silo
  50 — and the economy rows stay where a five-city, three-port human still pays 95 of 100:
  the wall is for the arsenal, not the country. Lever `--cheap-arms-upkeep` reproduces the
  materials commit's hash `44792639413653100` to the digit. The foreclosure test's arithmetic
  was rewritten before its assertion (250 → 170 → 90 against 100, so two warships go, not
  one), and the table guard fails with the scale put back to 1 — as does that test, which is
  the point of writing the arithmetic down.
- **Two seeds, no verdict on the leader, a verdict on the arsenal.** ×1 → ×2, seed
  `perf-gate`: top-1 13.3 → 20.3 %, posts 31 → 27, warships 8 → 10, fallout 0 → 3523;
  seed `retune-2`: top-1 13.9 → 11.4 %, posts 33 → 37, warships 11 → 15, fallout 0 → 1902,
  alive 38 → 35. The leader share swings seven points each way, which is what one seed is
  worth at this horizon (the doctrine-play A/B swung as far). What both seeds agree on:
  nations still build the arsenal at twice the rent, and cities go up (158 → 172, 173 → 178)
  — the bill is paid out of growth, which is where it should come from.

- **Three shares measured, one chosen.** Same seed, 8000 ticks: flat / 5 % / 10 % gave 507 /
  342 / 269 uprisings, leader share 12.7 / 13.2 / 11.3 %, top-20 96.2 / 96.1 / 91.8 %, alive
  37 / 33 / 34. Occupied tiles barely move (327k / 352k / 333k) because that number is
  five-minute churn from ongoing wars, not the threshold's business. 10 % cuts the revolt
  spam by nearly half and leaves the leader where the lever-off game had it; the mechanic is
  still live (269 uprisings), which is the brief's ask.

### Session 11 (continued) — item 6.6 closes: conquest is a commitment

- **What shipped.** Stability and partisans (brief §6.6, second half). Land taken from
  another state is held from its people until it assimilates (five minutes in the same
  hands); enough of one people's land held unassimilated and out of reach of the occupier's
  posts raises their partisans — a tribe spawned on the occupier's own ground, aimed at the
  occupier whatever the odds, refusing its hand, and exempt from the enclave rule _against the
  occupier only_, so the people returning walk right in. The Partisan doctrine's unlock lands
  with it: half the land, twice the time. `docs/MECHANICS.md` §05 6; files in
  `FORK-CHANGES.md`. Lever: `--no-unrest`, which reproduces the doctrines commit's hash.
- **Two per-tile stores, allocated on the first conquest of the kind.** The people a tile is
  held from (`Uint16`, 1.3 MB on the world map) and the tick it settles on (`Uint32`,
  2.6 MB). The second exists because the first cut's queue settled a re-taken tile early:
  the same holder losing and re-taking a tile pushes a second entry, and the first must be
  recognised as superseded. A queue entry is current only while it matches the tile's tick.
- **Partisans stand for a people, or the strongest empire eats them.** The first bot run
  put the leader at 23 % of the map (11 % without unrest): uprisings turned occupied land into
  _tribe_ land, which nobody records a grievance for, and the biggest army took it free.
  Now a partisan's ground is its people's — taking it is taking it from the people — and
  the laundering loop is closed.
- **A guard that could not fail, again.** The enclave-exemption break passed its test twice:
  `PlayerExecution` staggers a player's first cluster check up to `ticksPerClusterCalc`
  ticks after init and only runs it after a tile change later than that, so the test's
  enclave was never checked at all. It now waits the stagger out and takes one more tile.
  All four breaks caught: the conquer bookkeeping, the threshold, the exemption, the attack.
- **The bots**, same seed, 8000 ticks, unrest off → on: alive 35 → 37; top 1 / 5 / 20
  11.3 / 41.5 / 89.1 → 12.7 / 46.8 / 96.2 %; 327170 tiles occupied at the end and 507 (7 alive)
  uprisings; fallout 3894 → 0. Read against the doctrine commit's run: the mechanic is
  live and expensive, and the numbers say the threshold (300 tiles, flat) is a first cut —
  the retune should make it a share of the occupier's land so a small conqueror feels it
  before an empire does. the `NationGoldPerMinute` snapshot did not move: no nation holds 300 tiles of another's for long enough in that twenty-minute run.
- **A killed gate job leaves its workers behind.** Stopping the ten-minute gate chain
  mid-`determinism:full` left 28 vitest workers running; the next three full-suite runs each
  failed one _different_ test (a hardening bound, the ICU check, a shell-script timeout), all
  green alone. `Get-Process node` before trusting a flaky suite; kill anything older than the
  run. On a clean box the suite was green (514 files); with the owner's desktop busy (a game
  client, Discord, Spotify at a third of the CPU) the three heaviest tests — the ICU sweep, the
  2 000-value zbin fuzz, an inventory-settings sweep — hit their 5 s timeouts and pass alone.
  Those timeouts measure the machine, not the code.
- **The uprising search had to be bounded.** `determinism:full` went from eight minutes to not
  finishing: a fully garrisoned empire was walked to its last tile once a second, two grid
  queries per candidate, for every people it held. Now at most 256 candidates per attempt, and
  a fruitless attempt counts against the cooldown. Perf at 1000 ticks never showed it — the
  horizon again.

### Session 11 (continued) — item 6.6 opens with doctrines

- **Rebased first** onto upstream `0e0fb9ea6` (18 commits: the GAME_DOMAIN page/game host
  split, the server list from the API, smarter Hard/Impossible betrayal, two maps). 58 fork
  commits replayed; the `NationGoldPerMinute` snapshot conflicted at every Phase 5 commit and
  was taken from the fork side each time, then regenerated alone at the end. Two fork gates
  caught what the merge could not: the Brand test found 27 upstream comment lines naming the
  upstream domains (rewritten generically), and upstream's new ServerList tests set the
  desktop marker by the upstream global (now `BRAND.desktop.windowObject`). Both bot hashes
  were unchanged by the rebase — nothing upstream touched reaches a Medium-difficulty run.
- **What shipped.** Doctrines (brief §6.6, first half): eight of them, a small passive and one
  unlock each, every one a scale on a number the game already had; picked with the spawn tile
  (the pick rides the spawn intent, absent keeps what is held), rolled by nations from their
  seeded RNG, and shown as eight buttons under the spawn hint for the length of the spawn
  phase. `docs/MECHANICS.md` §05 "Gaps" 5 has the table and every hook; files in
  `FORK-CHANGES.md`. Lever: `--no-doctrines`, which reproduces the previous build's
  8000-tick hash to the digit.
- **The costs wrap the curve, they do not replace it.** `unitInfo` is cached per type, so the
  discount is a wrapper around the unit's own `cost` that reads the calling player's doctrine
  at call time — a Fortress state's fifth post is still dearer than its first, and the
  infinite-gold rule underneath it is untouched. The same wrapper halves a Nuclear state's
  warhead materials.
- **`TestConfig` flattens `attackLogic`.** The first cut of the terra-nullius and post-bonus
  tests asserted a ratio of 0.75 against `game.config()` and got 1: the test config replaces
  the formula with a flat one for every other suite. Those two cases build a plain `Config`.
  And a singleplayer game ends its spawn phase on the first pick, so the suite is a Public
  game with the phase left open — the second intent of the "re-pick keeps the doctrine" case
  was being refused, not ignored.
- **Every guard broken and watched fail**: the spawn stamp (two cases), the cost wrapper, the
  blockade reach, the nation roll.
- **The bots spread out.** Same seed, 8000 ticks: doctrines on ends with **35** alive (34
  off), top 1 / 5 / 20 at 11.3 / 41.5 / 89.1 % (14.3 / 48.0 / 91.0 off), materials held
  +26 %, fallout **doubled** (1 973 → 3 894 tiles) — Nuclear states with cheap silos and
  half-price warheads use them. Survivors by doctrine: partisan 7, naval 7, nuclear 6,
  fortress 6, industrial 3, diplomatic 3, expansionist 2, mercantile 1 — from a uniform roll,
  so Expansionist and Mercantile nations die more; a nation does not yet _play_ its doctrine
  (a Mercantile one builds no more ports than any other), which is the §05 7 personality work
  and the retune's first question.
- **Nation economy** (`NationGoldPerMinute`): trade gold +25.7 % (378.6M → 475.9M), train gold -8.5 % (108.8M → 99.6M), alive nations 30 → 23 — every nation now plays a rolled doctrine; the retune pass owns it.

### Session 11 (continued) — item 6.5: relations have rungs, and the map has a leader

- **What shipped.** An alliance is now one of three rungs — non-aggression pact, defensive
  pact, full alliance — climbed by asking again with the one button that already existed; a
  pact is peace and nothing more, a defensive pact makes an ally worth defending, a full one
  gets a nation's help for free; breaking costs ½×, 1×, 1½× the traitor window. And the win
  check now publishes the leader and its share every ten ticks; when any side crosses 40 %
  one `CoalitionUpdate` goes out (and one more when it falls back), nations take pacts from
  any fellow non-leader without their usual reluctance and go looking for them, and humans get
  one card with one button. `docs/MECHANICS.md` §05 "Gaps" 1 and 3; files in
  `FORK-CHANGES.md`. Vassal, war goals / peace terms and persistent reputation are
  deliberately not built — §05 1, 2 and 4 say why. Levers: `--flat-alliances`,
  `--no-coalition`.
- **Climbed in place, not stacked.** Accepting a request from a partner already held calls
  `setTier` + `extend()` on the existing `AllianceImpl` rather than making a second object, so
  every "how many alliances" count, the expiry, and the client's alliance array stay one entry
  per pair. `allianceArrayEqual` compares the tier, so a climb re-sends the array.
- **A guard that could not fail, caught by breaking it.** The coalition acceptance test passed
  with the coalition branch deleted: at neutral relation the ordinary path already said yes
  through `isEarlygame()`. The test now pins the three private "yes" routes (threat, honeymoon,
  similar strength) to false, and its control case — same neutral stranger, leader at 30 % —
  is refused. The other two breaks (the `allies()` tier filter, the break-cost scale) were
  caught first time. Break it before you trust it, every time.
- **Three things the tests had to learn.** A second request to the same player inside the 30 s
  cooldown is refused, so the ladder test waits it out between rungs; `BreakAllianceExecution`
  acts in `tick()`, one tick after `init()`; and an update added _between_ ticks never reaches
  the client — `executeNextTick` clears the update map at its start — so the coalition test
  registers the real `WinCheckExecution` and reads the update from the tick it ran in.
- **The bots kept more countries alive.** Same seed, 8000 ticks: flat alliances end with 15
  full alliances and **23** states alive, top 20 holding 99.7 %; with rungs, 44 pacts, 7
  defensive pacts, 0 full and **34** alive, top 20 at 91.0 %. Cheap peace is taken far more
  often than an alliance was, and small states live on it. Nobody reached 40 %, so
  `--no-coalition` is byte-identical to on at this horizon — the coalition is proven by the
  tests, not yet by the bots. Open question for the retune: on the impossible-nations 20-minute
  snapshot the count went the other way (45 → 34 alive) — likely `hasTooManyAlliances`
  counting pacts as alliances on Hard/Impossible while pact partners do not defend each other.
- **Three exhaustiveness gates earned their keep.** The full suite caught what the targeted
  runs could not: `MessageTypeClasses` console-warns on a message type without a colour
  (`COALITION_OFFER`), `TranslationSystem` flags keys built from a template (`deepen_*`, now a
  declared dynamic pattern) and keys nothing reads any more (`request_alliance`, now the card
  for a tier-less request), and the `WinCheckExecution` mock player had no `smallID` for the
  leader the win check now publishes. Run the whole suite before calling an item done.
- **Nation economy** (`NationGoldPerMinute`): trade gold −7.3 % (424.8M → 393.9M), train gold
  +59 % (55.7M → 88.8M), alive nations 45 → 34 — a different game, as expected of a diplomacy
  change; the retune pass owns it.

### Session 11 (continued) — item 6.4 opens with nuke consequences

- **What shipped.** Fallout gets a clock and the clock gets consequences: it expires after three
  minutes whoever holds the ground; it outlasts conquest and the owned land and cities under it
  count for nothing in `maxTroops`; a world more than 5 % irradiated recruits less for everyone,
  the nuker included; the crossing modifier now rises with world fallout (3 → 5) instead of
  falling (5 → 3); and world fallout advances the existing Doomsday Clock — one entry in
  `DOOMSDAY_CLOCK_DEFAULTS`, no second clock. `docs/MECHANICS.md` §04 "Gaps" A–C; files in
  `FORK-CHANGES.md`. All behind `Config.falloutHasConsequences()`; `--legacy-fallout` flips it.
- **No per-tile timestamp store.** Durations are constant, so `setFallout(true)` pushes
  `[expiryTick, tile]` onto a flat array that is therefore already in expiry order, and
  `expireFallout()` pops from the front once a second. The obvious `Uint32Array` per tile is
  8 MB on the world map for a value almost every tile never has.
- **`irradiatedTiles` went to the object lane, not the sextet.** It changes when a nuke lands or
  a mark expires, not every tick — the opposite case from materials — so it is diffed and merged
  like the trade counters. The lane decision is per field, and both directions are now on the
  record.
- **A test suite's hand-built config caught a design slip.** The first cut put nuclear winter
  on `Config` as a method; `DoomsdayClockExecution.test.ts` builds the clock's config object by
  hand and 38 cases failed on "not a function". Moving the value into `DOOMSDAY_CLOCK_DEFAULTS`,
  where the MECHANICS hook note had said it belonged, fixed 35 of them and left three that read
  `NaN` from the fixture's missing field until the execution learned to default it. The fixture
  gained one line. **When a mechanic extends an existing system, its tunables go where that
  system keeps its tunables.**
- **The mark now outlives the conquest, and the bots show it.** Same seed, 8000 ticks: under
  legacy semantics the world ends with **0** fallout tiles — nations do nuke, but every mark is
  erased the moment the land is retaken; with consequences on it ends with **2 945** irradiated
  tiles, all of them owned, producing nothing for three minutes each. That is the mechanic doing
  exactly what §6.4 asks. Alive 23 either way; top-5 share 43.3 % → 46.6 %; posts 17 → 20 —
  small, because 0.5 % of the world is not yet a burning one. The lever's baseline hash differs
  from the trade commit's for one unrelated reason: the blockade sweep was inverted after that
  run, and a port still under construction is no longer blockadable (it is not operating).
- **Nation economy** (`NationGoldPerMinute`): trade gold −4.8 % (446.0M → 424.8M), train gold +2.9 % (54.1M → 55.7M) —
  divergence, as with every earlier item.

### Session 11 (continued) — item 6.3 closes: blockades and the embargo price

- **What shipped.** `src/core/execution/Blockade.ts`: a warship of a non-friendly player within
  25 tiles of a port closes it — no departures (`PortExecution.tick` returns before the spawn
  roll, so the pity counter cannot wind up behind a blockade), no arrivals (`tradingPorts` drops
  blockaded destinations). And `Player.embargoPressure()` — the share of possible partners with
  an embargo against you — feeds `Config.embargoTariff`, 1 − 0.5 × pressure, on the embargoed
  side's trade-ship payouts, each end of a route paying its own. `docs/MECHANICS.md` §01 "Gaps"
  and "Embargoes"; files in `FORK-CHANGES.md`.
- **The embargo price is the coalition tool the brief asked for, and the bots proved it.**
  Nations already embargo whoever is winning (temporary embargoes from the relations code); the
  tariff turns that from a gesture into a siege. Same seed, 8000 ticks, only the tariff off:
  top-1 share **18.3 % → 12.0 %**, top-5 51.0 % → 43.2 %; alive 28 → 23, so the mid-field
  consolidates while the leader is cut. Blockades barely move a bot game — bots do not blockade
  on purpose — which is a note for nation AI, not a doubt about the mechanic.
- **Scan from the warships, not the ports.** The first sweep asked every port whether a hostile
  warship was near it: a couple of hundred grid queries per tick. The shipped one asks each
  warship (a few dozen) which non-friendly ports are in reach, marks them, and caches the answer
  per game per tick because every source port asks about every candidate destination.
  `perf:gate` idle: **3.11 ms**. It read 8.4 ms with three over-budget ticks while four jobs ran
  beside it — the load caveat in `docs/HANDOFF.md` §4, once more.
- **A guard that could not fail, caught by breaking it.** The first "friendly fleet" case had a
  stranger's warship in range as well, so ignoring friendliness still passed it. Rewritten around
  the one relation that needs no diplomacy — a player's own warship never closes its own port —
  and watched failing. Four breaks in all (never blockaded, friendliness ignored, nothing marked,
  pressure never counted); each caught by the test that names it.
- **Lever caveat, stated plainly.** Both mechanics landed together, so neither `--no-blockades`
  nor `--no-embargo-price` alone reproduces the materials build's hash (the other mechanic is
  still live). The levers are pinned by their unit tests instead; the script refuses two at once.
- **Nation economy** (`NationGoldPerMinute`): trade gold −4.8 % (468.7M → 446.0M), train gold
  −39 % (88.6M → 54.1M), ships 1944 → 1884. The train swing is divergence, not mechanism — trains
  never touch a blockade or a tariff — and it has swung +79 % and +22 % on earlier changes. Read
  the trade column, not the train one.
- **`TradeShipExecution.test.ts`** stubs players; its mocks gained `embargoPressure: () => 0`.

### Session 11 (continued) — item 6.3, materials

- **What shipped.** A second pool beside gold that exactly one thing makes and one thing spends:
  Factories produce 2 × level per tick; posts, warships, SAMs, silos and nukes cost a flat
  amount; cities, ports and factories cost gold alone. That asymmetry is the tall-versus-wide
  choice — gold raises a country, industry arms it. `docs/MECHANICS.md` §03 7.2; files in
  `FORK-CHANGES.md`. Hash `24015216964771530 → 34062363394006440` at 8000 ticks (see below for
  why the 1000-tick gate did not move). **The Phase 5 constant at `perf:gate` is unchanged at
  `24015216964771530`; the balance run is the instrument for this one.**
- **The packed lane became a sextet.** Materials change every tick for every factory owner —
  exactly the case the packed lane exists for — so `[smallID, tiles, gold, troops, goldEarned]`
  gained a sixth slot, and every quint-shaped expectation in seven test files had to be widened
  by hand. The "two update lanes" note in `docs/HANDOFF.md` §4 was written for this decision,
  and it was the right lane; the cost was the fixtures.
- **The hash did not move at 1000 ticks, and that was not a dead branch.** `perf:gate` runs
  bots and nations for 1000 ticks; no nation reaches a second defense post or a first silo that
  soon, so the gate is never hit and the game is bit-identical. At 8000 ticks it moves. **Before
  concluding a change is not live, ask whether the instrument's horizon can reach it** — the
  1000-tick gate is a performance instrument that happens to print a hash, not a balance one.
- **Infinite gold is the infinite-resources cheat.** Twenty-nine tests across the nuke, SAM,
  MIRV and attack suites failed at first because their sandboxes have infinite gold and no
  materials. Rather than hand each a stockpile, `unitInfo` makes `materialsCost` 0 for a human
  under infinite gold, the same way `costWrapper` already makes gold free — one rule, and a
  sandbox lobby is not the one place arms are gated. Pinned in `tests/economy/Materials.test.ts`.
- **A test that saw a spawn rule instead of the gate.** The first "gates arms" case asserted
  `canBuild(City)` at a tile and failed for a reason that had nothing to do with materials. It
  now holds the tile and the gold constant and moves only the pool, so what flips is the gate.
  Assert on the thing you changed, at inputs you control.
- **Three breaks, three named catches:** the gate made to never refuse fails only "gates arms
  and only arms"; production switched off fails only "is made by factories"; the charge removed
  fails only "charges the flat price". Each guard is load-bearing for exactly one thing.
- **The bots built.** Gated: cities 143 → 171, ports 75 → 100, factories 26 → 40, posts
  41 → 33; alive 34 → 28 (fewer posts, easier conquest). Nations that cannot arm early build
  economy instead — `NationGoldPerMinute` trade gold **+21 %**, train gold +22 %, ships +20 %.
  The materials pool sat at 107k unused when arms were free and 95k when gated — supply is not
  the constraint at these rates, the flat prices are. Revisit both with blockades in.

### Session 11 (continued) — item 6.3 opens with upkeep

- **What shipped.** Every structure level and every warship costs gold per tick, charged in
  `PlayerExecution.tick` after income and before troop growth. A short treasury recruits
  nobody that tick; thirty seconds short and the dearest unit is foreclosed, nothing exempt.
  `docs/MECHANICS.md` §01 "Upkeep" has the table; `FORK-CHANGES.md` the files. Hash
  `24015429958765936 → 24015216964771530`. **The Phase 5 constant is now
  `24015216964771530`.**
- **Debt had to become consequences.** `removeGold` clamps at zero and nothing in the engine
  can represent a negative balance, so "overbuilding bankrupts you" is modelled as two rules
  rather than a number: no recruits on a short tick, one foreclosure per grace period. The
  foreclosure picks by `upkeep × level`, ties to the lowest id, so every client picks the same
  unit. A test that expected a city to fall after three warships was wrong and the mechanic was
  right: once the warships are gone the bill fits, the clock resets, and the city stays. **Write
  the arithmetic down before writing the assertion.**
- **Upkeep is a pressure at these rates, not a wall.** The A/B below moves the bots very little
  — three more cities, three fewer ports, six more posts — and the top-1 share actually rose.
  Against a 100/tick human income the table bites; against a nation's trade-and-train income at
  scale it does not yet. Left as is on purpose: materials and blockades land on the same economy
  next, and tuning one lever before the others exist is tuning against the wrong game. Revisit
  the table once 6.3 is whole.
- **Nation economy under upkeep** (`NationGoldPerMinute`): trade gold −5.7 % (410.5M → 387.0M),
  train gold **+79 %** (40.7M → 72.9M), ships arrived 1705 → 1619. Fewer ports, more rail —
  nations reroute income rather than lose it. Worth knowing before blockades are designed.
- **The A/B lever proved itself again first:** `--no-upkeep` reproduced the elevation-on game
  to the hash (`26700484981869784`).

### Session 11 — item 6.2, terrain that costs something

- **What shipped, in two commits on purpose.** First the three-way terrain switch (and the
  second copy of its weights in `AttackExecution.addNeighbors`) became one table, `TERRAIN_COST`,
  with a per-band `{ loss, speed }` multiplier block on `GameConfig.terrain` — a refactor that
  had to leave the hash at `23307802903294904` and every snapshot byte-identical, and did. Then
  the stored 0–30 elevation went back inside the three bands: height, signed climb, and a
  defender's high ground. Hash `23307802903294904 → 24015429958765936`. Full description and
  the tunables in `docs/MECHANICS.md` §02 G2; every touched file in `FORK-CHANGES.md`.
  **The Phase 5 constant is now `24015429958765936`.**
- **Measure the ground before designing on it.** A histogram of `world/map.bin` decided the
  design: adjacent tiles differ by 0–2 elevation 79 % of the time and the 99th percentile is 12,
  so a climb measured to one tile is small — but an attack pays it on every tile of an ascent and
  is paid back on every tile of a descent, which is exactly the ridgeline feel the brief asks for.
  Twenty lines of Python over the byte array, before any TypeScript.
- **What this item does not do, and why it is not a gap in the work.** Forest, marsh, desert,
  urban and river crossings are the rest of §6.2. The byte has no spare bits; a magnitude
  sub-range would destroy the elevation data the new curves read; and **no source PNG has a
  forest painted in it** — the generator reads only the blue channel. The content does not
  exist, and inventing it across 121 maps is the owner's art decision. River crossings change
  conquest topology (thin water is a wall by design on many maps). Both are written up with hook
  points in G2. If Phase 5 is ever "done", this is the entry that says what it still owes.
- **The A/B lever proved itself first.** `npm run balance:run -- --flat-terrain` reproduced the
  previous session's supply-on game **to the hash** (`33895282646835616`), so the run beside it
  is elevation and nothing else. Every Phase 5 mechanic should ship with a lever like that; the
  script enforces one at a time.
- **The tooltip needed a threshold.** With elevation charged on every tile, almost every hover
  carried an "Elevation ×1.01" row. `significantFactors` now shows a factor only past 2 %; a
  list of near-no-ops explains nothing.
- **Which guard is load-bearing, watched failing:** height forced to 1 → four golden rows and the
  `AttackBreakdown` tamper loop; climb never gathered → the world-mountain scenario snapshot;
  high ground forced to 1 → **only** the golden rows, because `highGroundMod` scales the density
  the recomposition reads back and so cannot be tampered there. Written down so nobody trusts the
  tamper loop for it.
- **Two upstream tests needed porting after the rebase, neither about terrain.** A comment in
  upstream's new `ClusterCheckin.ts` named their domain and tripped the Brand gate; upstream's
  new `RenderHtml` guarded-lines case asserts an empty asset manifest, which is only true on a
  box with no production build. Both are in `FORK-CHANGES.md`. **`InventoryModal` failed three
  cases under the full suite and passed alone** — still the contention flake, still not fixed.
- **A pattern that fails by not matching.** Two edit scripts this session asserted on match
  count and stopped — once on a backslash mangled between shell and script, once on an em dash
  written as a hyphen. Both times the assertion was the only thing that noticed. Keep asserting
  on the count; a replace that matches nothing looks exactly like "already applied".

### Session 10 — Phase 5 opens: supply lines (item 6.1)

- **What shipped:** `src/core/game/SupplyNetwork.ts` — one byte per tile holding the distance,
  **walked through the owner's own territory**, to its nearest capital, City, Port or Factory.
  `Config.attackLogic` charges a penalty on both attacker loss and tile cost; `AttackExecution`
  bleeds the standing stack on top of it. Full description in `docs/MECHANICS.md` §02 G1, every
  touched file in `FORK-CHANGES.md`.
- **The hash moved twice, and the second time was the lesson.** Supply lines took it from the
  three-session constant `23404413546031824` to `23180482065575010`. Then lengthening the
  correcting sweep from 20 ticks to 60 moved it again, to `23307802903294904`: **a refresh
  cadence is a simulation parameter**, not a performance knob, however much it looks like one.
  The Phase 5 constant is `23307802903294904`.
- **The sweep cost 1.17 ms of a 5.8 ms tick before it was measured properly.** Instrumenting
  `SupplyNetwork.tick` directly (a static counter and a `console.log` every N sweeps) was what
  showed it: the **execution profiler cannot see it**, because the sweep runs in
  `executeNextTick` rather than in an `Execution`, and its time lands in the profiler's
  unattributed "remainder". `perf:gate` went 3.52 ms (baseline, this session, post-rebase) →
  5.5 ms → 4.95 ms (period 20 → 60) → **3.82 ms**.
- **The thing that actually fixed it was an exactness argument, not a tuning knob.** A player's
  supply field is a pure function of two things: their tile set and their unit list. Both are
  already versioned (`tileChangeVersion`, and `_myUnitsVersion`, which needed an accessor on
  `Player`), so a player whose versions have not moved since their last flood provably has the
  right field and re-flooding it is waste. With that skip, plus `forEach` instead of `for...of`
  over `player.tiles()` (`tiles()` iterates through a generator and the sweep makes two full
  passes), the sweep settles at **~0.6 ms/tick** at 8000 ticks and its cost stops growing with
  the map. **The hash stayed at `23307802903294904` across that change, which is the proof it
  was an optimisation** — the same instrument that must move for a balance change must not move
  for this one.
- **The worst single sweep is 13.7 ms**, when one dominant player's whole territory is flooded
  in one tick. That is inside the 100 ms turn budget and the 115 ms outlier ticks in a long run
  are not the sweep, but it is the shape to watch: if it ever matters, split one player's flood
  across ticks rather than shortening the period.
- **A test that passed for the wrong reason, caught by breaking the code.** The corridor
  comparison in `tests/SupplyAttrition.test.ts` was written to guard the whole mechanic. With
  `supplyPenalty` forced to 1 it **still passed** — the attrition alone explained the entire
  difference. The per-tile penalty is actually guarded by the tamper loop in
  `AttackBreakdown.test.ts` and by the `AttackScenarios` snapshots. Five breaks were run in all
  (ownership filter, relaxation, range cap, attrition, penalty) and each one is named against
  the test that caught it. **Breaking each mechanism separately is the only way to find out
  which guard is load-bearing** — a suite that goes red is not evidence that the test you meant
  to write works.
- **The benchmark scenarios needed capitals.** `AttackScenarios.test.ts` set up rectangles with
  no supply source anywhere, so after this change every scenario fought at full over-extension
  and the snapshot stopped being a benchmark of the formula. Each side now plants a capital in
  the middle of its rect. The snapshot moved anyway and that diff is the balance record: normal
  plains fights ~15-18 % fewer tiles at ~18 % more loss per tile; single-capital million-tile
  empires −44 % to −48 % tiles at +80 % to +139 %.
- **New instrument: `npm run balance:run`** (`scripts/balanceRun.ts`) — the same headless game
  as `perf:gate`, run long, printing who is alive, how concentrated the land is and what got
  built. Phase 5's gate asks for a bot-vs-bot run per item and nothing existed to produce one.
- **The bots proved it without being told.** The A/B below is the same game with only the
  penalty and the attrition switched off: supply lines halve the runaway leader (top-1 share
  29.4 % → 13.9 %) and leave two thirds more players alive at 8000 ticks. The row worth
  believing is the structures — cities +11 %, ports +16 %, defense posts 11 → 29. Nothing tells
  a bot to build more; that is the existing AI answering the incentive, which is the strongest
  evidence available that the mechanic changes a decision rather than just a number.
- **Making war dearer made peace richer.** `NationGoldPerMinute` moved +45 % trade gold and
  +139 % train gold over twenty minutes, because nations that are not being overrun keep their
  ports and cities. Nothing in Phase 5's economy items should take today's gold figures as an
  untouched baseline.
- **Deliberately not done:** the map does not shade unsupplied territory yet (the bit is set and
  streamed; the render decision belongs with the Phase 4 item 3 and 6 work, since territory fill
  already carries patterns, skins, defense darkening, alt-view and saturation), and rail is not
  a supply source yet. Both are written up with their hook points.

### Session 9 — item 6's typography and colour half, the feeds, and item 8

- **What shipped:** the display face on the HUD's figures, component tokens for the troop
  meter, and the two audits run on real code. Details in `docs/HANDOFF.md` §3 item 6, which
  also lists what is still open (the feeds, the layout, the radial menus, the modal palette
  sweep).
- **Two colour findings worth carrying.** Measured with the same machinery as the map palettes
  (`src/client/theme/DeltaE.ts` + `Oklch.ts`):
  - The troop rate's **green-400 / orange-400 pair measured 10.4 CIEDE2000 to a deuteranope**
    against 53.0 for normal vision. A game shipping three colourblind map palettes had the one
    pair they exist to avoid painted into its chrome. It is `ink` vs `signal` now — 28.9 at its
    worst across all four viewers — with a ▼ so the state is not colour-alone.
  - **Rank gold and `signal` separate by 5.8 under deuteranopia.** So the gold currency counter
    cannot be gold: to that player an always-on money readout and an alert would be one colour.
    The coin icon carries the currency; the figure wears ink. `tests/client/HudTokens.test.ts`
    holds this as an _inverted_ assertion, so the reason fails loudly if it stops being true.
- **A deletion that the tutorial caught.** The rate tile encodes the slope of the number it
  displays, in colour, unlabelled — which read as a second variable smuggled into one tile, so
  it was removed. Tutorial step 4 teaches that colour explicitly. Restored, fixed rather than
  deleted, and the tutorial copy now describes the caret. **Grep the tutorial and `en.json`
  before removing any HUD affordance** — 22 steps describe this interface in detail.
- **The condensed face is registered at weight 600 only** (`BRAND.assets.fontFaces`). Use
  `font-semibold` with `font-display`; `font-bold` gets a synthesised 700.
- **`npm test` green again** — 211 client files, 2581 tests, plus the full suite earlier in the
  session. Second clean run since the upstream jsdom teardown landed.
- **The feeds had the same defect, worse.** `severityColors` painted the whole event feed in
  red/yellow/green/grey/blue and its weakest pair was **loss against gain at 6.9** — "your
  attack failed" against "you conquered a player", the distinction the feed exists to make. The
  fix was not the red: moving gain off green and onto the blue ink puts the same red at 13.2 at
  its worst. Five roles became four (`blue` and `info` both meant "neutral").
- **Six icons stopped being tinted by hand-tuned `filter` chains.** The new `.icon-mask`
  utility in `styles.css` makes an icon a shape filled by `currentColor`, so an icon inside
  `text-status-loss` _is_ that token. Use it for any new monochrome icon.
- **A guard was written wrong and passed vacuously.** The raw-hue regex had literal backspace
  bytes where `` should have been — a non-raw Python string in the script that wrote the
  test. It looked correct in review and could never match. Caught only by breaking the code it
  guards and watching it not fail. **Write the regex, then break the thing it watches.**
- **Item 7 (mobile) is part-done.** Three faults found by putting the game on a 375x812
  viewport: rotating the phone threw the map 1295 tiles off course (`syncCamera` derives the
  camera centre from the canvas size and nothing compensated), the phone header drew its
  controls over the wordmark, and the attack-ratio slider was a 6px touch target. All three
  fixed and the first proved with a with/without A/B. **Put the game on a phone viewport
  before assuming mobile is fine** — none of these needed a device to find.
- **Item 8 is done:** the tutorial is 6 steps, down from 22. And `docs/HANDOFF.md` was wrong to
  say there were no tutorial tests — there were 13, and 7 of them failed on the cut. The note
  is corrected.
- **Numbers:** `perf:gate` 2.34 ms, final hash `23404413546031824` — unchanged for the third
  session running.

### Session 8 — item 5 finished

- **Rebased onto three new upstream commits** (`f02d74660`): a global jsdom teardown
  (`tests/domTeardown.ts`) that supersedes the same fix this fork had made locally in two test
  files, the desktop Exit control moving from the settings modal into the nav, and a second set
  of clean-room reimplementations. Conflicts were in `resources/lang/en.json` and three tests.
  The new `tests/client/NavUtilityIcons.quit.test.ts` had to be renamed to this fork's
  `fightwarsDesktop` global.
- **Phase 4 item 5 is done.** The nuke ring (`ShockwavePass`), the border wave
  (`BorderWavePass`) and `prefers-reduced-motion` for the shake and flash. Details, and the two
  lessons, are in `docs/HANDOFF.md` §3 item 5. The short version:
  - **Two effects were shipped invisible before being photographed.** Both the ring's fade and
    the wave's motes were first written at opacities that sounded right — the ring at 0.24 a
    third of the way through its life, the wave at 0.5 — and neither can be seen on a live map.
    The readable band over terrain is about 0.6; below 0.5 a pale line is simply not there.
    **Photograph any new effect before believing its numbers.**
  - **Module identity breaks after any HMR.** Once Vite has hot-reloaded anything,
    `await import("/src/client/…")` from the console hands back a different module object from
    the one the running app holds, so a prototype patch never fires and every measurement reads
    zero. It cost an hour of chasing a bug that was not there. Restart the dev server before
    instrumenting, and prove the patch is reached before trusting a null result.
  - **The browser pane only runs rAF while it is displayed.** With the pane hidden the game's
    frame loop is throttled to nothing and each screenshot forces a burst of about 14 frames.
    That is enough to photograph with, and enough to sample per-frame state through, but it is
    not a timeline — do not read anything into how often something ran.
- **Numbers this session.** `perf:gate` 2.39 ms mean, final hash `23404413546031824` —
  identical to session 7, which is the evidence that two new render passes touched nothing the
  simulation does. `perf:client` on World: main-thread burst mean 0.27 ms, p95 0.55, p99 0.88,
  max 2.71, 0/1800 ticks over the frame budget, view hash `0de99c33`. **Not comparable to
  session 7's baseline** (mean 0.99, p99 21.1, view hash `5333c99b`) — the view hash moved, so
  it is a different scenario, not a 4x win.
- **`npm test` was fully green for the first time** — 488 + 67 files, 5860 + 673 tests, no
  failures, on the same box that produced 1, 3 and 8 load-induced failures per run in session 7.
  The likely cause is the upstream commit this session rebased onto: `tests/domTeardown.ts`
  removes every element from `document.body` after each test, so a component still connected at
  file teardown can no longer leave a timer armed that fires against a dead `document` and gets
  reported against whichever file happened to be running. Treat the "not reliably green" note
  below as probably fixed, but do not delete it until a few more full runs agree.
- **Also `.claude/launch.json`**: the desktop session's working directory was the Claude Memories
  folder rather than the repo, so the launch configs there now call
  `npm --prefix C:/Users/disbo/dev/fightwars run dev`. The repo's own `.claude/launch.json`
  still works when the session's directory is the repo.

## Earlier handoff (written 2026-09-12 at the end of session 7)

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
- **Phase 4 (identity): 5 items done, 2 part-done, 3 not started** — see the table in
  `docs/HANDOFF.md` §3, which is the count to trust. Done: nation colours + the three dichromat
  palettes (1); the display face and brand marks (2); the attack-cost breakdown on hover and the
  live spend during an attack (4); **feel — sounds, flash, shake, nuke ring, border wave (5,
  finished in session 8)**; the clan create form and account page (10). Part-done: **item 3** has
  political blocks and borders that survive sub-pixel, but not the halo/flash legibility the brief
  also asks for; **item 6** has had its palette and typography but not its layout or `dataviz`
  pass. Not started: mobile (7), the tutorial (8), and the build-queue / rally-point /
  attack-preset intents (9, do last — the only one that touches the simulation).

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
- Known flaky under CPU contention only: `tests/client/InventoryModal.test.ts`,
  `MainInitialize.test.ts`, and (session 11) `tests/TranslationSystem.test.ts` and
  `tests/zbin/fuzz.test.ts` — each went red under the full parallel suite and passed alone in
  the same minute. Run `npm test` on a quiet box; they pass alone every time. The session-11
  failure reasons were not captured (the run was filtered to summary lines), so this is a
  pattern match, not a diagnosis.

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

- [ ] Nothing mid-flight. The tree is committed and green; Phase 5 is whole. Session 13 starts from `docs/HANDOFF.md` §1a (Phase 4 identity, the readouts first, then §5–§7).

## Next up (concrete, ordered)

0. **Phase 5 is whole (session 12).** The retune pass (five levers) and the six 6.4 units
   are on `origin/main`, one commit each. What Phase 5 still owes is hook points, every one
   written up where its system lives: docking at a carrier (`docs/MECHANICS.md` §04 D), the
   six units' own atlas glyphs (the icon and unit atlases cannot be regenerated on this box —
   §03 7.1), a shell drawn for an artillery volley, SAM interception of drops, forest /
   marsh / desert terrain (§02 G2, needs painted content), vassals and war goals (§05 1–2),
   map shading for unsupplied and occupied land (the readouts themselves landed at the end
   of session 12), rail as a supply source
   (§03 7.4), train delivery of materials, garrison as troops (§05 6). The economy numbers
   to re-read after any of them: the Impossible `NationGoldPerMinute` alive count sits at 23
   after the six units (it walked 26 → 21 → 24 → 20 → 20 → 22 → 20 → 23 through them) and
   the bot-run materials pool is still ~95k unused. Nation ratios for artillery and radar
   (`artilleryNationRatio`, `radarNationRatio`) and the arms upkeep are the levers if that
   count falls again.

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
4. The cooldowns that count from tick 0 (delete unit, embargo-all, target) are upstream
   behaviour worth revisiting when rebalancing.

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

## Numbers last measured — Phase 5 item 6.4, Paratrooper (2026-09-15, session 12)

- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, Medium, seed `perf-gate`):

  | after 8000 ticks       | `--no-paratrooper`  | drops on            |
  | ---------------------- | ------------------- | ------------------- |
  | players alive          | 28                  | 25                  |
  | top 1 / 5 / 20 share   | 15.0 / 48.6 / 97.5  | 13.9 / 53.1 / 99.3  |
  | cities / ports / fact. | 147 / 104 / 35      | 158 / 100 / 39      |
  | posts / guns           | 27 / 29             | 23 / 30             |
  | SAMs / radars          | 19 / 9              | 17 / 9              |
  | fallout tiles          | 2004                | 0                   |
  | pacts / defensive      | 30 / 7              | 22 / 10             |
  | uprisings              | 261 (4 alive)       | 261 (1 alive)       |
  | final hash             | `41848662333804620` | `44138072306226350` |

  The off hash equals the carrier commit's: the lever restores that game exactly.

- **Nation economy** (`NationGoldPerMinute`, impossible nations, 20 minutes): alive 20 → 23, trade gold −3.9 % (613.7M → 589.7M), train gold 124.9M → 124.9M, ships arrived 2760 → 2650 — three more nations standing at twenty minutes: a drop is a cheaper answer to a neighbour across the water than a fleet, and the six units together leave the Impossible count where the retune pass found it (23).

## Numbers last measured — Phase 5 item 6.4, Carrier (2026-09-15, session 12)

- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, seed `perf-gate`):
  `--no-carrier` and carrier on are byte-identical on Medium (`41848662333804620`, the
  submarine commit's hash) and on Impossible (`93964623359914700`): no nation affords a
  carrier's 3 000 materials by tick 8000 (the closest held 1 282).
- **Nation economy** (`NationGoldPerMinute`, impossible nations, 20 minutes): alive 22 → 20,
  trade gold +7.2 % (572.4M → 613.7M), train gold +18.2 % (105.7M → 124.9M), ships arrived
  2590 → 2760 — the second instrument moves; nations that can pay lay carriers down as their
  second hull.

## Numbers last measured — Phase 5 item 6.4, Submarine (2026-09-15, session 12)

- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, Medium, seed `perf-gate`):

  | after 8000 ticks      | `--no-submarine`    | submarine on        |
  | --------------------- | ------------------- | ------------------- |
  | players alive         | 28                  | 28                  |
  | top 1 / 5 / 20 share  | 14.9 / 48.6 / 97.5  | 15.0 / 48.6 / 97.5  |
  | warships / submarines | 8 / 0               | 6 / 0               |
  | materials held        | 94603               | 97003               |
  | fallout tiles         | 2004                | 2004                |
  | final hash            | `42857537573621660` | `41848662333804620` |

  The off hash equals the bomber commit's: the lever restores that game exactly.

- **Nation economy** (`NationGoldPerMinute`, impossible nations, 20 minutes): alive 20 → 22, trade gold −4.5 % (599.1M → 572.4M), train gold −13.4 % (122.1M → 105.7M), ships arrived 2717 → 2590 — on Impossible every Naval nation lays a submarine down beside its warship, and a raider that sinks trade ships is what the trade column shows.

## Numbers last measured — Phase 5 item 6.4, Bomber (2026-09-15, session 12)

- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, Medium, seed `perf-gate`):

  | after 8000 ticks       | `--no-bomber`       | bomber on           |
  | ---------------------- | ------------------- | ------------------- |
  | players alive          | 28                  | 28                  |
  | top 1 / 5 / 20 share   | 20.1 / 59.6 / 99.4  | 14.9 / 48.6 / 97.5  |
  | cities / ports / fact. | 163 / 107 / 45      | 147 / 104 / 35      |
  | posts / guns           | 26 / 37             | 27 / 29             |
  | SAMs / radars          | 22 / 14             | 19 / 9              |
  | fallout tiles          | 7959                | 2004                |
  | materials held         | 95239               | 94603               |
  | pacts / defensive      | 16 / 8.5            | 30 / 7              |
  | uprisings              | 248 (5 alive)       | 261 (4 alive)       |
  | final hash             | `40696498796941470` | `42857537573621660` |

  The off hash equals the radar commit's: the lever restores that game exactly.

- **Nation economy** (`NationGoldPerMinute`, impossible nations, 20 minutes): alive 20 → 20, trade gold −1.5 % (608.3M → 599.1M), train gold +8.6 % (112.4M → 122.1M), ships arrived 2758 → 2717 — the first arms commit that did not cost a nation on Impossible: a bomber is a cheap line on the bill.

## Numbers last measured — Phase 5 item 6.4, Radar (2026-09-15, session 12)

- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, Medium, seed `perf-gate`):

  | after 8000 ticks       | `--no-radar`        | radar on            |
  | ---------------------- | ------------------- | ------------------- |
  | players alive          | 30                  | 28                  |
  | top 1 / 5 / 20 share   | 19.8 / 51.1 / 97.5  | 20.1 / 59.6 / 99.4  |
  | cities / ports / fact. | 172 / 111 / 37      | 163 / 107 / 45      |
  | posts / guns           | 26 / 40             | 26 / 37             |
  | SAMs / radars          | 22 / 0              | 22 / 14             |
  | fallout tiles          | 0                   | 7959                |
  | materials held         | 120561              | 95239               |
  | uprisings              | 274 (4 alive)       | 248 (5 alive)       |
  | final hash             | `51679296370667120` | `40696498796941470` |

  The off hash equals the artillery commit's: the lever restores that game exactly.

- **Nation economy** (`NationGoldPerMinute`, impossible nations, 20 minutes): alive **24 → 20**, trade gold −8.1 % (661.7M → 608.3M), train gold −11.6 % (127.1M → 112.4M), ships arrived 2948 → 2758. The arms commits have walked this number 26 → 21 → 24 → 20: on Impossible every nation buys every new line of the arsenal and pays its rent, and four fewer stand at twenty minutes. Each remaining unit adds a line to that bill — re-read this after the sixth, and retune the nation ratios (`artilleryNationRatio`, `radarNationRatio`) or the arms upkeep against it then, not per unit.

## Numbers last measured — Phase 5 item 6.4, Artillery (2026-09-15, session 12)

- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, Medium, seed `perf-gate`):

  | after 8000 ticks       | `--no-artillery`    | artillery on        |
  | ---------------------- | ------------------- | ------------------- |
  | players alive          | 33                  | 30                  |
  | top 1 / 5 / 20 share   | 20.3 / 50.9 / 99.5  | 19.8 / 51.1 / 97.5  |
  | cities / ports / fact. | 172 / 104 / 51      | 172 / 111 / 37      |
  | posts / guns           | 27 / 0              | 26 / 40             |
  | fallout tiles          | 3523                | 0                   |
  | materials held         | 122622              | 120561              |
  | pacts / defensive      | 11 / 8              | 17 / 10             |
  | uprisings              | 285 (10 alive)      | 274 (4 alive)       |
  | final hash             | `41594670571444300` | `51679296370667120` |

  The off hash equals the upkeep commit's: the lever restores that game exactly.

- **Nation economy** (`NationGoldPerMinute`, impossible nations, 20 minutes): alive 21 → 24, trade gold +4.6 % (632.9M → 661.7M), train gold +13.1 % (112.4M → 127.1M), ships arrived 2875 → 2948 — three of the five nations the upkeep commit lost are standing again, behind guns.

## Numbers last measured — Phase 5 retune, arms upkeep ×2 (2026-09-15, session 12)

- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, Medium):

  | after 8000 ticks       | seed `perf-gate` ×1 | ×2                  | seed `retune-2` ×1  | ×2                  |
  | ---------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
  | players alive          | 33                  | 33                  | 38                  | 35                  |
  | top 1 / 5 / 20 share   | 13.3 / 50.6 / 95.6  | 20.3 / 50.9 / 99.5  | 13.9 / 43.4 / 91.5  | 11.4 / 43.7 / 91.5  |
  | cities / ports / fact. | 158 / 100 / 46      | 172 / 104 / 51      | 173 / 119 / 43      | 178 / 109 / 42      |
  | posts / warships       | 31 / 8              | 27 / 10             | 33 / 11             | 37 / 15             |
  | fallout tiles          | 0                   | 3523                | 0                   | 1902                |
  | pacts / defensive      | 40 / 10             | 11 / 8              | 51 / 8              | 44 / 11             |
  | uprisings              | 264 (2 alive)       | 285 (10 alive)      | 293 (6 alive)       | 298 (2 alive)       |
  | final hash             | `44792639413653100` | `41594670571444300` | `49937020157577090` | `52556608536748910` |

  The `perf-gate` ×1 hash equals the materials commit's: the lever restores that game exactly.

- **Nation economy** (`NationGoldPerMinute`, impossible nations, 20 minutes): alive **26 → 21**, trade gold +10.5 % (572.7M → 632.9M), train gold −11.2 % (126.6M → 112.4M), ships arrived 2693 → 2875. Five fewer nations standing on Impossible, where every nation arms; the run has swung 23 → 26 → 25 → 26 → 21 across the five retune commits, so this is inside what one 20-minute game has moved on before — but it is the number to re-read when the six units land, since each of them is a new line on this bill.

## Numbers last measured — Phase 5 retune, arms cost twice the materials (2026-09-15, session 12)

- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, Medium, seed `perf-gate`):

  | after 8000 ticks       | `--cheap-materials` (×1) | ×2 (shipped)        |
  | ---------------------- | ------------------------ | ------------------- |
  | players alive          | 29                       | 33                  |
  | top 1 / 5 / 20 share   | 11.5 / 47.9 / 99.0       | 13.3 / 50.6 / 95.6  |
  | cities / ports / fact. | 167 / 104 / 36           | 158 / 100 / 46      |
  | posts / warships       | 25 / 14                  | 31 / 8              |
  | materials held         | 156928                   | 131821              |
  | fallout tiles          | 5202                     | 0                   |
  | pacts / defensive      | 20 / 7                   | 40 / 10             |
  | uprisings              | 278 (4 alive)            | 264 (2 alive)       |
  | final hash             | `45473217189748110`      | `44792639413653100` |

  The ×1 hash equals the doctrine-play commit's: the lever restores that game exactly.

- **Nation economy** (`NationGoldPerMinute`, impossible nations, 20 minutes): alive 25 → 26, trade gold −3.9 % (596.2M → 572.7M), train gold −8.0 % (137.6M → 126.6M), ships arrived 2702 → 2693 — a little less trade, one more nation standing.

## Numbers last measured — Phase 5 retune, nations play their doctrine (2026-09-14, session 12)

- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, Medium):

  | after 8000 ticks      | seed `perf-gate` off | on                  | seed `retune-2` off | on                  |
  | --------------------- | -------------------- | ------------------- | ------------------- | ------------------- |
  | players alive         | 34                   | 29                  | 35                  | 34                  |
  | top 1 / 5 / 20 share  | 11.3 / 44.2 / 91.8   | 11.5 / 47.9 / 99.0  | 19.7 / 50.2 / 97.1  | 16.3 / 48.7 / 95.1  |
  | posts / warships      | 32 / 13              | 25 / 14             | 16 / 10             | 30 / 18             |
  | cities / ports / fact | 170 / 106 / 35       | 167 / 104 / 36      | 173 / 118 / 41      | 174 / 112 / 37      |
  | fallout tiles         | 0                    | 5202                | 1025                | 4671                |
  | pacts / defensive     | 43 / 6               | 20 / 7              | 52 / 8              | 35 / 4              |
  | uprisings             | 269 (1 alive)        | 278 (4 alive)       | 321 (2 alive)       | 289 (0 alive)       |
  | final hash            | `44195822438377410`  | `45473217189748110` | `47999011053332750` | `46510484518345010` |

  Survivors by doctrine, off → on. `perf-gate`: naval 7 → 4, fortress 5 → 2, nuclear 5 → 1,
  partisan 4 → 4, expansionist 4 → 5, industrial 3 → 4, diplomatic 3 → 4, mercantile 2 → 1,
  none 1 → 4. `retune-2`: partisan 6 → 8, expansionist 5 → 3, diplomatic 5 → 5, naval 5 → 4,
  fortress 4 → 3, mercantile 3 → 3, industrial 3 → 3, nuclear 2 → 5, none 2 → 0.

- **Nation economy** (`NationGoldPerMinute`, impossible nations, 20 minutes): alive 26 → 25, trade gold **+27.9 %** (466.1M → 596.2M), train gold **+41.7 %** (97.1M → 137.6M), ships arrived 2097 → 2702 — Mercantile and Industrial nations building the ports and factories their doctrine says, on Impossible where every nation plays one.

## Numbers last measured — Phase 5 retune, alliance cap counts allies (2026-09-14, session 12)

- **Bot-vs-bot** (`balance:run --ticks 8000 --difficulty impossible`, world, 150 bots + nations, seed `perf-gate`):

  | after 8000 ticks     | `--pacts-count` (old count) | allies only (shipped) |
  | -------------------- | --------------------------- | --------------------- |
  | players alive        | 41                          | 43                    |
  | top 1 / 5 / 20 share | 11.3 / 46.0 / 94.8          | 11.0 / 45.7 / 97.4    |
  | pacts / defensive    | 28 / 20                     | 37 / 18               |
  | fallout tiles        | 24296                       | 11380                 |
  | uprisings            | 263 (4 alive)               | 259 (5 alive)         |
  | final hash           | `77315446805294380`         | `73248487342847200`   |

  Hard: both runs `67031158969095820` (the cap needs 36 partners of 72 nations; nobody has
  them). Medium: `44195822438377410`, the unrest commit's hash, to the digit.

- **Nation economy** (`NationGoldPerMinute`, impossible nations, 20 minutes): alive 23 → 26,
  trade gold 475.9M → 466.1M, train gold 99.6M → 97.1M, ships arrived 2116 → 2097.

## Numbers last measured — Phase 5 retune, unrest share (2026-09-14, session 12)

- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, seed `perf-gate`):

  | after 8000 ticks     | `--flat-unrest` (300 flat) | share 5 % (measured, not kept) | share 10 % (shipped) |
  | -------------------- | -------------------------- | ------------------------------ | -------------------- |
  | players alive        | 37                         | 33                             | 34                   |
  | top 1 / 5 / 20 share | 12.7 / 46.8 / 96.2         | 13.2 / 45.7 / 96.1             | 11.3 / 44.2 / 91.8   |
  | occupied tiles       | 327170                     | 352219                         | 333386               |
  | uprisings            | 507 (7 alive)              | 342 (4 alive)                  | 269 (1 alive)        |
  | fallout tiles        | 0                          | 2901                           | 0                    |
  | pacts / defensive    | 39 / 10                    | 24 / 12                        | 43 / 6               |
  | final hash           | `47153110926552660`        | `44537865805050056`            | `44195822438377410`  |

  The flat hash equals the stability commit's: the lever restores that game exactly.

## Numbers last measured — Phase 5 item 6.6, stability (2026-09-14, session 11)

- Determinism hash at `perf:gate` (1000 ticks): `23271086399647930` → `24046876959589696`.
  `perf:gate` on a busy desktop (a game client and Discord at a third of the CPU): **mean 4.09 ms**, p95 7.62, p99 10.9, 0 over budget — read against 3.36 idle at the doctrines commit; the bookkeeping is O(1) per conquest and the search is bounded.
- `test:determinism:full`: pass 3/3 in 736 s (the same busy box; 476 s at the doctrines commit). `npm test`: 514 files, 6267 tests.
- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, seed `perf-gate`):

  | after 8000 ticks     | `--no-unrest`       | unrest on           |
  | -------------------- | ------------------- | ------------------- |
  | players alive        | 35                  | 37                  |
  | top 1 / 5 / 20 share | 11.3 / 41.5 / 89.1  | 12.7 / 46.8 / 96.2  |
  | occupied tiles       | 0                   | 327170              |
  | uprisings            | 0 (0 alive)         | 507 (7 alive)       |
  | fallout tiles        | 3894                | 0                   |
  | pacts / defensive    | 52 / 6              | 39 / 10             |
  | final hash           | `45194573167176620` | `47153110926552660` |

  The off hash equals the doctrines commit's: the lever restores that game exactly.

## Numbers last measured — Phase 5 item 6.6, doctrines (2026-09-14, session 11)

- Determinism hash at `perf:gate` (1000 ticks): `23351105707837370` → `23271086399647930` — moved,
  as it must: nations roll a doctrine in `init` and every price and rate reads it.
  `perf:gate` idle: **mean 3.36 ms**, p95 6.2, p99 8.37, 0 over budget.
- `test:determinism:full`: pass 3/3 in 476 s. `npm test`: 513 files, 6254 tests —
  `NationGoldPerMinute` regenerated alone before the suite.
- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, seed `perf-gate`):

  | after 8000 ticks          | `--no-doctrines`    | doctrines on        |
  | ------------------------- | ------------------- | ------------------- |
  | players alive             | 34                  | 35                  |
  | top 1 / 5 / 20 share      | 14.3 / 48.0 / 91.0  | 11.3 / 41.5 / 89.1  |
  | materials held            | 75 962              | 95 878              |
  | fallout tiles             | 1 973               | 3 894               |
  | ports / factories / posts | 93 / 35 / 27        | 104 / 34 / 31       |
  | pacts / defensive         | 44 / 7              | 52 / 6              |
  | final hash                | `29973981493118710` | `45194573167176620` |

  The off hash equals the 6.5 commit's: the lever restores the previous game exactly, PRNG
  sequence included, because a nation only rolls with doctrines on.

## Numbers last measured — Phase 5 item 6.5, tiers + coalitions (2026-09-14, session 11)

- Determinism hash at `perf:gate` (1000 ticks): `24015216964771530` → `23351105707837370` —
  moved, as it must: nations ask for pacts from the opening and grant them at neutral
  relation. `perf:gate` idle: **mean 2.55 ms**, p95 4.71, p99 6.44, 0 over budget.
- `test:determinism:full`: pass 3/3 in 226 s. `npm test`: 506 files, 6044 tests — `NationGoldPerMinute`
  regenerated alone, as the rule says.
- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, seed `perf-gate`):

  | after 8000 ticks         | flat alliances      | tiers + coalition   | `--no-coalition`    |
  | ------------------------ | ------------------- | ------------------- | ------------------- |
  | players alive            | 23                  | 34                  | 34                  |
  | top 1 / 5 / 20 share     | 12.2 / 46.6 / 99.7  | 14.3 / 48.0 / 91.0  | same                |
  | pacts / defensive / full | 0 / 0 / 15          | 44 / 7 / 0          | same                |
  | leader share             | 12.3 %              | 14.3 %              | same                |
  | final hash               | `30525071524541864` | `29973981493118710` | `29973981493118710` |

  The flat hash equals the 6.4 "consequences on" hash: the lever restores the previous game
  exactly. No side reaches 40 % in 8000 ticks, so the coalition never fires here; no full
  alliance forms because nations climb to the top rung only with partners they have come to
  like, and none did by then.

## Numbers last measured — Phase 5 item 6.4, nuke consequences (2026-09-14, session 11)

- Determinism hash at `perf:gate` (1000 ticks): `24015216964771530`, unchanged — nothing is
  irradiated that early. `perf:gate` idle: **mean 2.62 ms**, p95 4.75, p99 6.8, 0 over budget.
- `test:determinism:full`: pass 3/3 in 226 s. `npm test`: 504 + 69 files, 6029 + 706 tests —
  one file, `NationGoldPerMinute`, was red in the full run because its snapshot regeneration
  ran concurrently with the suite and lost the write; regenerated alone afterwards and green
  alone. **Do not run a `-u` regeneration beside the suite that reads the same file.**
- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, seed `perf-gate`):

  | after 8000 ticks    | legacy fallout      | consequences on     |
  | ------------------- | ------------------- | ------------------- |
  | players alive       | 23                  | 23                  |
  | top 1 / top 5 share | 12.3 / 43.3 %       | 12.2 / 46.6 %       |
  | fallout tiles       | 0                   | 2945                |
  | final hash          | `33068600064576010` | `30525071524541864` |

  Nations nuke on this seed; legacy semantics erase every mark by conquest before the end,
  consequences keep them on owned land. The golden rows with fallout moved for the inverted
  crossing modifier and nothing else.

## Numbers last measured — Phase 5 item 6.3, blockades + embargo price (2026-09-14, session 11)

- Determinism hash at `perf:gate` (1000 ticks): `24015216964771530`, unchanged — no bot
  blockades and no embargo pressure that early. At 8000 ticks the three configurations:
  both on `34817588719088750`, blockades off `33860372927156296`, tariff off
  `38854839324619416`.
- `perf:gate`, idle: **mean 3.11 ms**, p95 5.53, p99 7.78, 0 over budget.
- `test:determinism:full`: pass 3/3 in **211 s** on an idle box — back at the 206 s baseline,
  which says the sweep optimisations of session 10 hold with all of Phase 5 so far live.
  `npm test`: 503 + 69 files, 6019 + 706 tests, all green.
- **Bot-vs-bot** (`balance:run --ticks 8000`, world, 150 bots + nations, seed `perf-gate`):

  | after 8000 ticks       | both on       | blockades off | tariff off        |
  | ---------------------- | ------------- | ------------- | ----------------- |
  | players alive          | 23            | 23            | 28                |
  | top 1 / top 5 share    | 12.0 / 43.2 % | 11.7 / 44.7 % | **18.3 / 51.0 %** |
  | warships / trade ships | 23 / 402      | 18 / 392      | 14 / 443          |
  | cities / ports         | 170 / 106     | 172 / 100     | 172 / 105         |
  | posts                  | 18            | 21            | 19                |

  Cumulative across Phase 5, players alive at 8000 ticks: 16 → 27 → 32 → 34 → 28 → 23; top-1
  share 29.4 % → 13.9 % → 11.0 % → 15.0 % → 15.4 % → 12.0 %.

## Numbers last measured — Phase 5 item 6.3, materials (2026-09-14, session 11, this machine)

- **Determinism hash at `perf:gate` (1000 ticks): `24015216964771530`, unchanged** — the gate
  is never reached that early (handoff note above). At `balance:run --ticks 8000`:
  `29119482670225350 → 34062363394006440`.
- **Bot-vs-bot A/B** (`balance:run --ticks 8000`, world, 150 bots + nations, seed `perf-gate`;
  `--no-materials` zeroes `unitMaterialsCost` and nothing else, and reproduced the upkeep game to
  the hash first):

  | after 8000 ticks  | arms free     | arms gated    |
  | ----------------- | ------------- | ------------- |
  | players alive     | 34            | 28            |
  | top 1 / top 5     | 15.0 / 45.7 % | 15.4 / 48.9 % |
  | cities / ports    | 143 / 75      | **171 / 100** |
  | factories / posts | 26 / 41       | **40 / 33**   |
  | materials held    | 107 148       | 94 660        |

- Nation economy (`NationGoldPerMinute`): trade gold +21 % (387.0M → 468.7M), train gold +22 %
  (72.9M → 88.6M), ships arrived 1619 → 1944.
- `perf:gate`, idle: mean 3.84 ms, p95 6.84, p99 9.13, 0 over budget. `test:determinism:full`:
  pass 3/3 in 340 s. `npm test`: 501 + 69 files, 6010 + 706 tests, all green.
- Cumulative across Phase 5 so far, players alive at 8000 ticks: 16 → 27 → 32 → 34 → 28.

## Numbers last measured — Phase 5 item 6.3, upkeep (2026-09-14, session 11, this machine)

- **Determinism hash: `24015216964771530`** (world, 150 bots, seed `perf-gate`).
- `test:determinism:full`: pass 3/3 in 464 s, on a box otherwise idle. `npm test`: 500 + 69
  files, 6002 + 706 tests, all green.
- `perf:gate`, idle box: **mean 3.47 ms** (≤ 8), p95 6.5, p99 8.87, 0 over budget. A first
  read of 4.35 ms ran beside the A/B and the nation snapshot and was load, not upkeep — the
  per-tick work is one loop over each player's units, which `PlayerExecution.tick` already made
  for the structure sweep.
- **Bot-vs-bot A/B** (`balance:run --ticks 8000`, world, 150 bots + nations, seed `perf-gate`;
  `--no-upkeep` zeroes `unitUpkeep` and nothing else):

  | after 8000 ticks  | no upkeep | upkeep   |
  | ----------------- | --------- | -------- |
  | players alive     | 32        | 34       |
  | top 1 share       | 11.0 %    | 15.0 %   |
  | top 5 share       | 46.4 %    | 45.7 %   |
  | top 20 share      | 98.4 %    | 90.5 %   |
  | cities / ports    | 140 / 78  | 143 / 75 |
  | factories / posts | 29 / 35   | 26 / 41  |

  A pressure, not a wall — see the handoff note. Cumulative across Phase 5 so far: alive
  16 → 27 → 32 → 34.

## Numbers last measured — Phase 5 item 6.2 (2026-09-14, session 11, this machine)

- **Determinism hash: `24015429958765936`** (world, 150 bots, seed `perf-gate`). The neutral
  table refactor before it held `23307802903294904`.
- `perf:gate`: mean **3.7 ms** (≤ 8), p95 7.15, p99 10.4, 0 over budget. Elevation is four
  neighbour reads per conquered tile beside the four supply already does; no measurable cost.
- `test:determinism:full`: pass 3/3 in 642 s — **not comparable** to session 10's 321 s: it ran
  concurrently with the full suite and a repo-wide prettier check. Re-measure on an idle box
  before reading anything into it; the per-tick cost above says elevation added nothing.
- Balance, `AttackScenarios` snapshot (48 scenarios, table refactor → elevation): median
  **−3.2 % tiles**, **+3.9 % attacker loss per tile**, **−6.7 % defender loss per tile**. By
  ground: plains −3.8 % tiles; world highland/mountain −9.6 % at +10.6 %; world mountain −10.0 %
  at +11.1 % with the defender losing 23 % fewer per tile. A gradient, not a cliff.
- Second-order, `NationGoldPerMinute`: trade gold +2.8 % (399.2M → 410.5M), train gold +19.7 %
  (34.0M → 40.7M). Smaller than supply's, same direction.
- **Bot-vs-bot A/B** (`balance:run --ticks 8000`, world, 150 bots + nations, seed `perf-gate`):

  | after 8000 ticks | flat terrain | elevation    |
  | ---------------- | ------------ | ------------ |
  | players alive    | 27           | **32**       |
  | top 1 share      | 13.9 %       | **11.0 %**   |
  | top 5 share      | 57.1 %       | **46.4 %**   |
  | biggest player   | 90 287 tiles | 71 895 tiles |
  | cities / ports   | 152 / 88     | 140 / 78     |
  | defense posts    | 29           | 35           |

  Fewer cities and more posts is the interesting row: with ground worth holding, the bots hold
  it rather than spread. Cumulative with supply: alive 16 → 27 → 32, top-1 29.4 % → 13.9 % →
  11.0 %.

## Numbers last measured — Phase 5 item 6.1 (2026-09-13, session 10, this machine)

- **Determinism hash: `23307802903294904`** (world, 150 bots, seed `perf-gate`). Held across the
  sweep optimisation; moved twice on purpose before that (see the session-10 handoff).
- `perf:gate`: **mean 3.82 ms** (≤ 8), p95 7.85 (≤ 20), p99 12.6 (≤ 40), 0 ticks over budget.
  Pre-supply baseline the same day, post-rebase: mean 3.52, p95 6.34, p99 9.1, hash
  `23404413546031824`.
- Supply sweep alone (instrumented, world, 150 bots): 0.17 ms/tick cumulative at tick 1000,
  settling at **0.56 ms/tick by tick 8000**; worst single sweep 13.7 ms.
- `test:determinism:full`: pass 3/3 in **321 s** (world, 150 bots, 8 humans, 24 000 ticks, 5
  sequential processes), against a 206 s baseline. It read 671 s before the sweep optimisation;
  the 1.55x that remains is the mechanic itself — slower conquest means longer wars means more
  attacks alive per tick — and not the sweep.
- `npm test`: **494 + 67 files, 5928 + 673 tests, all green**, which includes
  `tests/EnJsonSorted.test.ts`, red on the branch before this session for three keys that had
  nothing to do with Phase 5.
- Balance, from the `AttackScenarios` snapshot diff (46 scenarios, each side now given a
  capital): median **−15.2 % tiles conquered** and **+20.9 % attacker loss per tile**; the range
  runs from no change to −47.6 % tiles for single-capital million-tile empires. The three
  bracketing rows on identical 25k attacks: capital on the front line 300 tiles at 83.3 troops
  each, capital mid-territory 263 at 95.1, no capital at all 204 at 122.5.
- Second-order, from `NationGoldPerMinute` (world, impossible nations, 20 minutes): slower
  conquest leaves nations holding their ports and cities, so **trade gold +45 %** (276.3M →
  399.2M), **train gold +139 %** (14.2M → 34.0M), ships at sea 218 → 278. Making war dearer
  makes peace richer; worth remembering before any economy item of Phase 5 reads these numbers
  as its own baseline.
- **Bot-vs-bot balance run** (`npm run balance:run -- --ticks 8000`, world, 150 bots + nations,
  seed `perf-gate`, 222 spawned). The `--no-supply` flag turns only the penalty and the
  attrition off, so this is an A/B of the mechanic and not of two builds:

  | after 8000 ticks | supply off    | supply on    |
  | ---------------- | ------------- | ------------ |
  | players alive    | 16            | **27**       |
  | top 1 share      | 29.4 %        | **13.9 %**   |
  | top 5 share      | 85.6 %        | **57.1 %**   |
  | biggest player   | 191 621 tiles | 90 287 tiles |
  | cities / ports   | 137 / 76      | 152 / 88     |
  | defense posts    | 11            | 29           |

  The runaway leader is halved, two thirds more players are still standing, and everyone builds
  more — which is the decision the mechanic exists to create, arriving without anyone being told
  about it.

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
