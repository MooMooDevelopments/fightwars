# FightWars changelog

Player-facing changes, newest first. Engineering detail lives in `BUILD-STATE.md` and
`FORK-CHANGES.md`.

## Unreleased

### Phase 5 — Depth (2026-09-13)

- **Supply lines.** An attack is fed from your capital and from your cities, ports and
  factories, along ground you own. Push far past the last of them and every tile costs more
  troops and takes longer to take, and the stack itself starts to melt away where it stands.
  Distance is measured along your own territory, not across the map: a long salient is badly
  supplied even when it curls back to within sight of home, and cutting the ground behind an
  army strands it. Build behind the front before you push past it.
- The attack breakdown you get by hovering an enemy tile now names supply among the reasons an
  attack is expensive.
- **Terrain that costs something.** Height now counts inside plains, highland and mountain: a
  peak is dearer than a foothill, attacking uphill costs more on every tile of the climb and
  pouring downhill costs less on every tile of the descent, and a defender on high ground loses
  fewer troops holding it. Ridgelines are worth holding and valleys are the way in. Lobby hosts
  can scale each terrain band's cost, so a map can be made flat or its mountains made walls.
- The hover breakdown names elevation, climb and high ground when they matter, and no longer
  lists factors that move the answer by less than two per cent.
- **Upkeep.** Cities, ports, factories, defence posts, silos, SAMs and warships now cost gold
  every second you hold them. Fall short and you stop recruiting; stay short for thirty seconds
  and you lose the dearest thing you own. Build what you can feed.
- **Materials.** Factories now make materials, and defence posts, warships, SAMs, silos and
  nukes cost them on top of gold — a flat price each, so the question is how much industry
  stands behind your army, not how rich you are. Cities, ports and factories still cost gold
  alone: gold raises a country, industry arms it. The build menu shows the materials price and
  greys out what you cannot yet afford.
- **Blockades.** Park a warship within 25 tiles of a rival's port and it closes: no trade ships
  leave, none arrive. A fleet is now worth building for something other than piracy.
- **Embargoes have a price.** Being embargoed by more of the world makes the trade you still
  have worth less — one embargo is a nuisance, five are a siege.
- **Nukes have consequences.** Fallout now lasts three minutes whoever holds the ground, and the
  land and cities under it produce nothing while it does. Crossing it gets harder as more of the
  world burns, not easier. Once more than a twentieth of the world is irradiated, everyone
  recruits less — including whoever launched — and the Doomsday Clock runs ahead.
- **Relations have rungs.** Your first agreement with a neighbour is a non-aggression pact;
  ask again and it becomes a defensive pact, whose partners come to your defence; ask once more
  and it is a full alliance. Each rung costs more to break. Nations climb the ladder with
  players they have come to like.
- **Coalitions.** When anyone holds 40 % of the map, everyone else is offered a coalition —
  one card, one button, defensive pacts with every other player who will have you. The leader
  knowing it is coming is the late game.
- **Doctrines.** Pick one of eight when you pick where to spawn — Expansionist, Mercantile,
  Fortress, Naval, Nuclear, Diplomatic, Industrial, Partisan — for a small passive and one
  unlock. Nations pick too.
- **Conquest is a commitment.** Land you take from another state is theirs in spirit for
  five minutes; hold enough of one people's land without a defense post over it and their
  partisans rise on your own ground — and you cannot absorb them, only fight them. Their
  people, returning, walk right in.
- **Artillery.** A new structure: build it behind a front and every five seconds it takes
  two thousand troops off the nearest enemy attack within forty tiles. A defence post makes
  an attack cost more per tile; artillery makes an attack bleed where it stands. Hotkey J.
  Costs materials and upkeep like the rest of the arsenal; nations build them too.
- **Radar.** A new structure: every SAM launcher within sixty tiles of a radar intercepts
  thirty tiles further, up to the SAM cap. A radar defends nothing by itself; it makes the
  launchers you already have reach. Hotkey H. Nations build them beside their SAMs.
- **Bomber.** A conventional strike from your nearest silo: it flies like an atom bomb,
  kills troops and destroys buildings and ships in a small radius, and burns nothing — the
  land keeps its owner and there is no fallout. SAMs can shoot it down. Hotkey N. A nation
  with a silo and no warhead it can afford flies one.
- **Submarine.** A warship that hides. It hunts transports and trade ships and never
  engages a warship; an enemy warship sees it only within twelve tiles, or anywhere under
  one of their radars. Spawns at your port, patrols, retreats to heal and moves like a
  warship. Hotkey V. Naval nations keep one as their second hull.
- **Carrier.** A harbour that sails. Warships and submarines spawn at your nearest port or
  carrier, and ships beside a carrier heal as they do beside a port. It has no guns and a
  deep hull; keep it behind the fleet. Hotkey X. Naval nations keep one as their second hull.
- **Paratroopers.** An airborne assault: a fifth of your troops (up to 25,000) fly from your
  nearest Missile Silo within 120 tiles straight to the tile you click and land as an attack
  from there — over water, mountains, anyone's land. Nothing shoots them down. Hotkey I.
  Nations drop rather than sail when a silo reaches a target they cannot walk to.
- **Readouts.** Your materials now sit beside your gold at the bottom of the screen. Click
  a player and their panel shows their materials, how much of their land is occupied, and
  the doctrine they chose.
- **Retune: an army costs twice as much to keep.** Defence posts, SAMs, silos and warships
  now cost double the gold per second to hold. Cities, ports and factories are unchanged:
  the bill is for the arsenal, not the country.
- **Retune: arms cost twice the materials.** Defence posts, warships, SAMs, silos and nukes
  need double the materials they did, so a factory line is a real choice against a city
  line. You still start with enough for one defence post.
- **Retune: nations play their doctrine.** A Mercantile nation now builds more ports, an
  Industrial one more factories, a Nuclear one more silos, a Fortress one digs in harder
  when attacked, a Naval one keeps a second warship, and an Expansionist one pushes into
  empty land with less held back. Before, a nation's doctrine only changed its prices.
- **Retune: pacts are not alliances.** Hard and Impossible nations refuse a partner who is
  already allied with much of the map. That count no longer includes non-aggression pacts,
  so a peaceable neighbour can still be offered a defensive pact.
- **Retune: uprisings scale with the conqueror.** "Enough of one people's land" is now
  300 tiles or a tenth of everything you own, whichever is more — a small state feels
  its first conquest, an empire is not kept in permanent revolt by every border it ever
  crossed.

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
