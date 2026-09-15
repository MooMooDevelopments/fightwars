# FightWars — shipped

What was built, what was cut and why, what the numbers say, and what I would do next.

Written 2026-09-15 at the end of session 13, against the brief's §11 Definition of Done.
The engineering detail behind every line is in `BUILD-STATE.md` (newest first),
`docs/MECHANICS.md` (how each system actually works, by section) and `FORK-CHANGES.md`
(every file this fork touches, by item). The player-facing summary is `CHANGELOG.md`.

FightWars is a fork of OpenFront: a real-time territorial-conquest browser game, lockstep
across every client, with the server relaying intents. What follows is the fork's own work.

---

## The short version

Thirteen sessions. Everything in the brief's §6 and §7 is shipped and playable. Four
Definition-of-Done lines cannot be closed from here — they need a laptop, a phone, a GPU
runner and a cluster, and the one thing worse than a missing measurement is a fabricated
one. They are listed as open, with what it would take to close each.

The simulation is deterministic and gated on it. The server runs its own copy of every
game and is the arbiter of the hash, the winner and the record. The balance is data: 91
knobs a lobby can override, shipped as a versioned file. Eight modes, a map editor, a
community map browser, ranked placements, challenges, a caster view and a post-match
report all landed on top of it without moving the hash of a default game.

---

## The Definition of Done, line by line

### Determinism — **met**

> Two independent servers replaying one intent log produce byte-identical state hashes
> across a full 40-minute match.

`npm run test:determinism` runs two independent `GameRunner`s over one intent log and
compares digests; `test:determinism:full` does it for a 24,000-tick world match with 150
bots and 8 humans — forty wall-clock minutes of game — and the nightly CI job runs it.
Green on every commit of this session. The digest names the winner by id rather than
serialising the `Player` object, after the first decided game inside the horizon crashed
it (session 12).

Beyond the gate: the server plays its own copy of every game (`ShadowSim`), and **its**
hash is the desync reference — a client that disagrees with the server is out of sync
whatever the other clients say. Every simulation change this session shipped with an
8,000-tick A/B whose lever reproduced the previous commit's hash to the digit.

### Performance — **met where it can be measured here; three numbers need hardware**

| What                                  | Measured                                      | Budget             | Where                                  |
| ------------------------------------- | --------------------------------------------- | ------------------ | -------------------------------------- |
| Server tick, 150 players              | mean 1.92 ms, p99 2.83 ms, max 5.3 ms         | < 8 ms             | `/api/metrics` under a 150-client load |
| Simulation tick, 150 bots             | mean ~3.0 ms, p95 5.3, p99 7.0, 0 over budget | mean ≤ 8           | `npm run perf:gate`, in CI             |
| Bandwidth down per client             | 0.72 KB/s                                     | < 8 KB/s           | 150-client load test                   |
| Cold load, critical path              | 0.99 s modelled (735 KB gzipped, 4 files)     | < 2.5 s at 10 Mbps | `npm run coldload:gate`, in CI         |
| Initial download with the largest map | 19.2 MB (assets 3.5 + map 15.6)               | < 90 MB            | same gate                              |
| **60 fps on a 2019 mid-range laptop** | **not measured**                              | 60 fps             | needs the laptop                       |

The cold-load gate models the wire — connect, a round trip a file, the bytes at line rate.
What it cannot model is JavaScript parse and execute on a mid-range laptop, which is the
other half of "to first click". The entry chunk is 2.6 MB raw, 669 KB gzipped, and is the
number to watch.

### Compatibility — **two of four met, two need devices**

- **Full keyboard navigation** — the HUD, the modals and, since this session, the radial
  action menu: `M` opens it, arrows and Tab walk the enabled arcs, Enter or Space acts,
  Escape steps back and then closes.
- **Screen-reader labels on all chrome** — including the radial menu's arcs
  (`role="menuitem"` with a label each) and a live region that names the focused one.
- **Three colourblind-safe palettes** — protanopia, deuteranopia and tritanopia, generated
  by farthest-point sampling in OKLCH with the dichromacy simulated _into_ the distance
  metric, and pinned by tests that measure CIEDE2000 separation. The chrome is held to the
  same standard: every in-game surface names palette roles, never a raw hue.
- **Mobile Safari** — **not verified.** The layout was built and photographed at 375 px in
  a Chromium browser pane (the HUD, the tutorial panel, the radial menu, the player panel),
  but nobody has opened it on an iPhone. That needs a phone.

### Data-driven — **met for the scalars; honest about the rest**

`src/core/configuration/Tunables.ts` is a registry of 91 knobs — every scalar accessor in
`Config.ts` whose body was a plain number — each with its default and bounds.
`resources/rulesets/default.json` is that registry as a versioned file, regenerated by
`npm run rules:export` and held equal by a test. A lobby may carry a ruleset of overrides;
unknown keys are ignored and values clamped, and the ruleset rides the config every client
and the shadow sim share, so lockstep holds whatever a host sets. A host edits it in the
lobby; `balance:run --ruleset` runs the instrument under one.

What is **not** in the registry, deliberately: the accessors with logic in them (the
alliance ladder's bands, the difficulty scaling, the attack formula), the timing knobs
(`msPerTick`, `gameSpeed`) and the lobby settings that already have their own controls.
And the ruleset is read when the game is built — there is no hot reload mid-game; a change
is a new lobby.

### Licence — **met**

AGPL-3.0 throughout, attribution present, source published at
`MooMooDevelopments/fightwars`, and `npm run licenses:check` (in CI) fails the build on a
dependency that is not AGPL-compatible. It passes on 197 production packages.

### Onboarding — **met, as far as it can be judged without players**

A six-step tutorial teaches spawning, attacking, building and the win condition inside
ninety seconds, and the first-run path puts a new player into a solo game without reading
anything. Whether a real newcomer then survives a public match is a claim only playtesting
can support, and there has been none.

### Every section of §6 and §7 shipped — **met**

§6.1 supply lines · §6.2 terrain that costs something · §6.3 economy with a tall-vs-wide
choice (materials, upkeep, blockades, embargo pricing) · §6.4 military breadth (artillery,
radar, bombers, submarines, carriers, paratroopers) · §6.5 diplomacy as a system (alliance
tiers, auto-coalitions, embargo economics) · §6.6 doctrines and stability (eight doctrines,
occupation, partisans) · §6.7 modes (ranked with placements, Battle Royale, King of the
Hill, Capital Strike, Survival, Historical Scenarios, Draft, Blitz) · §6.8 AI worth playing
against (utility-based nations with doctrines, coalitions and nuclear judgement) · §6.9
creation tools (the in-browser map editor, data-driven balance, the community map browser).

§7 identity: the OKLCH palette and three colourblind sets, the wordmark and the display
font, readability at every zoom, every number explained on hover, the feel pass (border
wave, nuke flash, shake, ring, sound), the HUD and feeds on one palette, mobile, the
tutorial, the build queue and rally points, the clan and account surfaces.

§8 infrastructure and security: the shadow sim refusing impossible intents, spam caps,
automation detection, the winner on record being the server's, a metrics dashboard with a
live balance view, and a documented decision that server-side fog of war is out of scope
for a lockstep game.

### Fun at both ends — **built, not playtested**

A five-minute Blitz (4× on a compact map, one click in the lobby, its own slot in the
public rotation) and a sixty-minute 150-player World match both run and both end. Whether
they are _good_ is a judgement about play, and the only honest thing to say is that no
human has played either against other humans. The instrument says the long game is decided
by supply, doctrine and coalitions rather than by a runaway leader, which is what the brief
asked for.

---

## What was cut, and why

- **Vassal states** (§6.5's fourth rung). Asymmetric by nature: a tribute hook, a one-way
  attack rule, and an offer only a much stronger side can make. It needs its own UI and its
  own balance pass; the three rungs that shipped are complete without it.
- **War goals and peace terms.** The hooks are named in `docs/MECHANICS.md` §05; the value
  is in a negotiation UI that was never designed.
- **Forest, marsh, desert and river-crossing terrain** (§6.2's second half). The terrain
  byte has no spare bits, and **no source map has a forest painted in it** — the generator
  reads one channel. Inventing that content across 121 maps is an art decision for the
  owner, not a code change.
- **Server-side fog of war.** Every client runs the whole simulation from one intent log.
  Real fog is a rewrite of lockstep, replays and the desync check; client-side fog hides
  nothing from anyone who opens the console. Written up as a decision so nobody builds the
  fake one.
- **Playing a community map in a lobby.** The editor, the package format, publishing,
  browsing and rating all shipped; _playing_ one needs a map identity on the wire so the
  server and every client fetch the same bytes. That is a wire change, and starting one in
  the last hours of a session is the wrong risk.
- **Discord login.** Needs a client id and secret the owner holds. The account page shows
  the guest account rather than a dead button.
- **Cosmetic rewards for challenges.** The catalogue is empty by design — no pay-to-win,
  and nothing that touches a game.

---

## The numbers, as last measured

- **Tests:** 564 files, 6,748 tests (client and core) plus 77 files, 783 tests (server);
  green. API tests run against Postgres in CI and PGlite locally.
- **Coverage floor:** `src/core` held at 85 % lines, 83 % functions, 77 % branches in CI.
- **Simulation:** `perf:gate` mean ~3.0 ms, p95 5.3, p99 7.0, 0 ticks over budget, final
  hash `23568288087060504` — unchanged across every commit of this session, which is the
  evidence that none of the thirteen features touched the default game's simulation.
- **Server:** mean 1.92 ms a turn at 150 players, 0.72 KB/s down per client, worker RSS
  123 MB, 0 desyncs over 600 turns; 100 lobbies × 2 clients across two workers in lockstep.
- **Download:** 3.5 MB of assets, 15.6 MB for the largest map, 0.99 s modelled cold load.
- **Balance:** the world-map 8,000-tick baseline hash `44138072306226350`; every mode's A/B
  and what it moved is in `BUILD-STATE.md`.

---

## What I would do next, in order

1. **Put it on a phone and a laptop.** Four Definition-of-Done lines are waiting on
   devices, not on code: 60 fps at 150 players, mobile Safari, the parse-and-execute half
   of cold load, and a 500-lobby cluster run. Everything needed to measure them exists.
2. **Playtest with people.** The balance instrument is a bot-versus-bot simulator; it can
   say the leader's share fell, not whether the game is fun. Every number in this document
   about _play_ is a proxy.
3. **Let a lobby play a community map.** A map identity on the wire, the server fetching
   the package for its shadow sim, the client fetching the same bytes, and a cache. It is
   the one piece of §6.9 that is written up rather than built.
4. **Finish the palette sweep into the menus.** The in-game HUD names no raw hue; the
   settings, report and moderation modals still do.
5. **The HUD's layout.** The panels sit where upstream put them. Rearranging them is the
   one part of §7 item 6 that is a design decision rather than an engineering one, and it
   should be seen before it is shipped.
6. **A replay scrubber**, beside the caster view that now exists.

---

## How to pick this up

`docs/HANDOFF.md` §1a is the authority and is kept paste-ready (mirrored at
`Claude Memories/fightwars-finish-prompt.md`). The resume protocol, the gates before every
commit, and the traps worth not relearning are all there. `BUILD-STATE.md` is the running
log, newest first; read it top to bottom before touching anything.
