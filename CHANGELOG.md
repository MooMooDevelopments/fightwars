# FightWars changelog

Player-facing changes, newest first. Engineering detail lives in `BUILD-STATE.md` and
`FORK-CHANGES.md`.

## Unreleased

### Phase 2 — Infrastructure (2026-09-12)

- Accounts: every player is now an account, created silently on first visit. No sign-up.
- A ladder: finished multiplayer games rate everyone in them (Glicko-2), with public player
  pages and a leaderboard per mode.
- Replays are kept by the game server itself; a finished game can be replayed from its id.
- Operators get a live metrics page and a desync alert that cannot be missed.

### Phase 1 — Foundation (2026-09-12)

- FightWars is born as a fork of OpenFront. The title screen says so, the footer and loading
  screen keep OpenFront's copyright notice, and an About link offers the complete source code.
- New FightWars logo, favicon and app icons. The display font is Overpass (open licence).
- No ads, no ad-block gate, no store prompts, no tracking beacons. The game loads only what it
  needs to play.
- Background music is off for now; a new lobby-start chime replaces the old one.

### Phase 0 — Audit (2026-09-12)

- No player-facing changes. Under the hood: a determinism gate that replays a full 40-minute
  match in separate processes and requires identical results, so desync bugs are caught before
  they ship.
