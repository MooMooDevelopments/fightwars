# FightWars — Mechanics Inventory

The Phase 0 audit of the OpenFront simulation this fork is built on. Every formula and constant
below was read from the code at upstream commit `c77005586` (2026-09-12), not guessed. Each section
gives, per mechanic: where it lives (`file:line`), the actual formula, whether it is data-driven or
hardcoded, and the player decision it drives. Each section ends with the gaps against the FightWars
brief and the exact hook points for closing them.

**Keep this current.** When a balance value moves, edit the section that owns it.

## Conventions

- **Ticks:** the sim runs at 10 ticks per second (`Config.msPerTick()` = 100 ms). Durations in
  ticks are given with seconds alongside.
- **Gold** is a `bigint`. Troops are fractional floats throughout the sim.
- **"Data-driven"** means the value is read from a `Config` method, the `GameConfig` sent with the
  lobby, or the map manifest. **"Hardcoded"** means a literal inside a `Config` method body or an
  execution class. Almost every balance number is the latter: `Config` is a concrete class of
  methods with literals inside them, not a data file.
- File paths are relative to the repo root.

## Headline findings (what a fresh engineer must know before touching anything)

1. **The sim runs on every client; the server relays intents — and, since session 13, runs its
   own copy too.** The server validates schema shape, rate limits and who may send four control
   intents, and `ShadowSim` (§06 2e) runs the same `GameRunner` the clients run, one turn behind,
   refusing the gameplay intents its state says are impossible (no such player, dead player, a
   unit that is not theirs, a unit type the lobby disabled, an attack on oneself). What moves
   within a tick — affordability, territory, alliances — stays the clients' business, where every
   client applies the same rule to the same state. The winner and the stats are the shadow's
   where it saw the game end: a vote for anyone else is overruled, and the archived record
   carries what the server saw. Without a shadow the client vote stands, as before. See §06.
2. **The live desync hash is weak.** It covers troop count, tile count and unit `(tile, type, id)`
   per player. Gold, relations, tile identity, PRNG state and the tick are not hashed. A desynced
   client is told once and has its votes ignored; a desync alerts (session 2). FightWars'
   determinism gate (`tests/determinism.test.ts`) therefore hashes the full state itself and
   passes a 24,000-tick world match byte-for-byte. Since session 13 the check is no longer a
   vote among the clients where the server has its own hash: `ShadowSim` produces the same
   per-turn hash from the same code, and a client that disagrees with it is out of sync
   however many clients agree with that client (§06 2e). See §06 and `BUILD-STATE.md`.
3. **Terrain is one byte per tile:** land, shore, ocean bits and a 5-bit magnitude that combat
   collapses into three bands (plains / highland / mountain). Forest, marsh, desert, urban and
   rivers do not exist in the map format, the loader, or the Go generator. Map "layers" are
   render-only PNGs. See §02.
4. **The per-tile attack cost is one pure function,** `Config.attackLogic`, with every constant a
   module-level literal. There is no supply or distance term anywhere. No cost breakdown reaches
   the client. See §02.
5. **There is no upkeep, no debt, and gold income is flat** (100 per tick per player regardless of
   size). Trade ships, trains and conquest are the only scaling income. See §01.
6. **Nations have no personalities.** Every AI number is a global `Difficulty` switch across ~40
   sites; per-nation variation is three RNG ratios. Target choice is an ordered predicate list.
   Bots ("tribes") are stat-crippled players with a 90-line brain. See §05.
7. **Diplomacy is a numeric relation score plus a binary alliance.** Breaking marks the traitor for
   only 30 seconds. See §05.
8. **SAM interception is fully deterministic** (no hit chance exists). Fallout is permanent and has
   no production effect. A rich, integer-only doomsday clock already exists and is built to be
   extended. See §04.
9. **There is no game-speed setting.** The 100 ms turn is hard-coded; the `.`/`,` keys only apply
   to singleplayer and replays. "Compact" (4× downscaled map) exists. See §06.
10. **The auth, stats, cosmetics, matchmaking check-in and match archive all live in a
    closed-source API that is not in the repo.** `GAME_ENV=dev` bypasses auth; production is
    unbootable without a JWKS endpoint. See §06.
11. **Seventeen files under `proprietary/` are all-rights-reserved** (font, logos, favicon, seven
    music and SFX files) and must be replaced, not rebranded. Brand strings sit in ~52 source
    files, `index.html`, `manifest.json` and 28 locale keys. See §06.

## Where the brief and the code disagree

| Brief says                                 | Code does                                                           | Section |
| ------------------------------------------ | ------------------------------------------------------------------- | ------- |
| Win at 72% of land tiles                   | 80% of (land − fallout); overtime lowers it 2 pts/min after 30 min  | §05     |
| Port: `2^n × 125k`, cap 1M, 20 s build     | Cost matches; builds in 5 s; the count `n` is shared with factories | §03     |
| Missile silo cost scales per unit          | Flat 1,000,000                                                      | §03     |
| MIRV costs 35,000,000                      | `25M + 15M × MIRVs launched game-wide`                              | §03     |
| SAM "interception probability"             | Deterministic: capacity = sum of covering SAM levels per 90 ticks   | §04     |
| Warship 1000 HP, shells 250 dmg            | 1000 HP; shells 200–300 (+20 %/veterancy level)                     | §04     |
| Webpack dev server                         | Vite (port 9000)                                                    | §06     |
| Classic / Fast speed                       | No speed setting exists in the wire config                          | §06     |
| ~30 maps                                   | 120 maps in the roster                                              | §06     |
| Terrain: elevation, rivers, forest, marsh… | Elevation bands only; nothing else is in the data                   | §02     |

## Contents

- §01 Economy — population, troops, max-pop, gold, trade ships, ports
- §02 Combat — the attack chain, terrain, defence posts, retreat, transports, spawn immunity
- §03 Structures — every unit's cost curve and build time, construction, rail and trains, deletion
- §04 Nukes and navy — nukes, silos, SAMs, fallout, doomsday clock, warships, water pathing
- §05 Diplomacy, win and AI — relations, alliances, donations, embargo, spawn, win, bots, nations
- §06 Wire, server and client — intents, validation, desync, lobbies, maps, controls, determinism,
  closed-API dependencies, branding, CI

---

## 01 — Economy: population, troops, max-pop, gold, trade ships, ports

Source of truth audit of `C:\Users\disbo\dev\fightwars` (OpenFront fork). All formulas quoted verbatim.
Tick rate: `Config.msPerTick()` returns `100` (`src/core/configuration/Config.ts:346-348`), i.e. **10 ticks/second, 600 ticks/minute**.

Conventions used below:

- `Config` is the concrete balance class at `src/core/configuration/Config.ts` (there is no `DefaultConfig.ts` file any more; tests still say "DefaultConfig" in describe strings).
- "Data-driven" = value comes from `GameConfig` (the wire schema in `src/core/Schemas.ts:485-556`) or the map manifest. "Hardcoded" = literal inside a Config method or an execution.
- Every number below is a literal in `Config.ts` unless stated otherwise; nothing in this section reads a map manifest.

---

### Gold type and helpers

**Where:** `src/core/game/Game.ts:28` — `export type Gold = bigint;`
`src/core/Util.ts:397-405` (`toInt`), `:411-413` (`minInt`), `:39-41` (`within`), `:461-467` (`sigmoid`).

**Verbatim:**

```ts
export function toInt(num: number): bigint {
  if (num === Infinity) {
    return BigInt(Number.MAX_SAFE_INTEGER);
  }
  if (num === -Infinity) {
    return BigInt(Number.MIN_SAFE_INTEGER);
  }
  return BigInt(Math.floor(num));
}
export function minInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
export function within(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
export function sigmoid(value, decayRate, midpoint) {
  return 1 / (1 + exp(-decayRate * (value - midpoint)));
}
```

- **Gold is `bigint` everywhere in core.** `PlayerImpl._gold: bigint` (`PlayerImpl.ts:119`). Costs are `bigint` (`UnitInfo.cost: (game, player, extraUnits?) => Gold`, `Game.ts:178`). Client converts with `Number(...)` for display.
- **Troops are stored as `bigint`** (`PlayerImpl._troops: bigint`, `:120`) but the public API is `number`: `troops(): number { return Number(this._troops); }` (`:1341-1343`). `addTroops` floors via `toInt` (`:1345-1351`), `removeTroops` clamps to what is held and returns the actual removed count (`:1352-1358`).
- `exp`, `log`, `pow`, `pow2` come from `src/core/DetMath` (deterministic math wrappers for lockstep).

Data-driven: no (type decisions). Player decision: none directly — but it means fractional troop/gold income is floored every tick; sub-1 per-tick values are lost.

---

### Starting resources

**Where:** `Config.startManpower` `Config.ts:964-983`; `Config.startingGold` `:418-423`; `Config.startingGoldFor` `:707-714`; wired in `GameImpl.addPlayer` `src/core/game/GameImpl.ts:666-678` → `PlayerImpl` constructor `PlayerImpl.ts:192-201`.

**Verbatim (troops):**

```ts
startManpower(playerInfo: PlayerInfo): number {
  if (playerInfo.playerType === PlayerType.Bot) { return 10_000; }
  if (playerInfo.playerType === PlayerType.Nation) {
    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy: return 12_500;
      case Difficulty.Medium: return 18_750;
      case Difficulty.Hard: return 25_000; // Like humans
      case Difficulty.Impossible: return 31_250;
    }
  }
  return this.hasInfiniteTroopsForInfo(playerInfo) ? 1_000_000 : 25_000;
}
```

**Verbatim (gold):**

```ts
startingGold(playerInfo: PlayerInfo): Gold {
  if (playerInfo.playerType === PlayerType.Bot) { return 0n; }
  return this.startingGoldFor(playerInfo);
}
private startingGoldFor(playerInfo: PlayerInfo): Gold {
  const base = BigInt(this._gameConfig.startingGold ?? 0);
  const hc = this._gameConfig.hostCheats;
  if (hc?.startingGold && playerInfo.isLobbyCreator) { return base + BigInt(hc.startingGold); }
  return base;
}
```

- Constructor: `this._troops = toInt(startTroops); this._gold = mg.config().startingGold(playerInfo);` (`PlayerImpl.ts:198-199`). Starting gold is written to the field directly and **does not count toward `goldEarned`** (`:1314-1321` comment; pinned by `tests/LiveTradeRevenue.test.ts` "goldEarned counts every addGold and excludes starting gold").
- Data-driven: `startingGold` (schema `zb.uint({ max: 1000000000 })`, `Schemas.ts:547`), `hostCheats.startingGold` (`:553`), `difficulty`. Troop starts are hardcoded.
- Default human start: **25,000 troops, 0 gold**.

Player decision: with 0 starting gold the first structure (125k) is gated purely by per-tick worker gold: 125,000 ÷ 100 gold/tick = 1,250 ticks = **125 s ≈ 2.1 in-game minutes** after the spawn phase ends before a human can afford a first city or port from worker income alone. Every tick of trade income after that compounds, so the opening port is the whole early game.

---

### Max population (`maxTroops`)

**Where:** `Config.maxTroops` `Config.ts:985-1017`; `Config.cityTroopIncrease` `:337-339`.

**Verbatim:**

```ts
cityTroopIncrease(): number { return 250_000; }

maxTroops(player: Player | PlayerView): number {
  const maxTroops =
    player.type() === PlayerType.Human && this.hasInfiniteTroopsFor(player)
      ? 1_000_000_000
      : 2 * (pow(player.numTilesOwned(), 0.6) * 1000 + 50000) +
        player
          .units(UnitType.City)
          .filter((u) => !u.isUnderConstruction())
          .map((city) => city.level())
          .reduce((a, b) => a + b, 0) *
          this.cityTroopIncrease();

  if (player.type() === PlayerType.Bot) { return maxTroops / 3; }
  if (player.type() === PlayerType.Human) { return maxTroops; }
  switch (this._gameConfig.difficulty) {
    case Difficulty.Easy: return maxTroops * 0.5;
    case Difficulty.Medium: return maxTroops * 0.75;
    case Difficulty.Hard: return maxTroops * 1; // Like humans
    case Difficulty.Impossible: return maxTroops * 1.25;
  }
}
```

Plain-language: `max = 2 × (tiles^0.6 × 1000 + 50,000) + 250,000 × Σ(city levels, completed cities only)`, then ×1/3 for bots, ×{0.5, 0.75, 1, 1.25} for nations by difficulty.

Illustrative values (0 cities → +1 city level):
| tiles | max (no city) | max (+1 city level) |
|---|---|---|
| 1 | 102,000 | 352,000 |
| 100 | 131,698 | 381,698 |
| 1,000 | 226,191 | 476,191 |
| 10,000 | 602,377 | 852,377 |
| 100,000 | 2,100,000 | 2,350,000 |
| 300,000 | 3,966,364 | 4,216,364 |

- Territory contribution is **sublinear (exponent 0.6)**; each city level is a flat +250k. A single level-1 city equals roughly the max-pop of ~4,000 tiles.
- City levels come from `UnitImpl._level` (starts at 1, `UnitImpl.ts:44`; `increaseLevel()` `:704-715`), raised by `UpgradeStructureExecution` → `PlayerImpl.upgradeUnit` (`PlayerImpl.ts:1472-1477`). Cap `MAX_UPGRADE_AMOUNT = 50` (`Game.ts:173`).
- Cities under construction do not count (`filter(!isUnderConstruction)`); construction takes `2 * 10` ticks (`Config.ts:637`) unless `instantBuild`.
- Data-driven: only via `difficulty`, `infiniteTroops`, `hostCheats.infiniteTroops`. The 0.6 / 1000 / 50000 / 250000 constants are hardcoded.
- Client reads the same function: `ControlPanel.ts:137` (`config.maxTroops(player)`), `StatsColumns.ts:269`; `armyLimitWarningThreshold()` returns `0.8` (`Config.ts:808-810`) — HUD warns at 80 % of max.

Player decision: the flat +250k per city level dominates early; the first city is the largest single pop increase available, and expanding tiles gives diminishing returns.

---

### Troop generation per tick (`troopIncreaseRate`)

**Where:** `Config.troopIncreaseRate` `Config.ts:1019-1051`; applied in `PlayerExecution.tick` `src/core/execution/PlayerExecution.ts:86-87`.

**Verbatim:**

```ts
troopIncreaseRate(player: Player | PlayerView): number {
  const max = this.maxTroops(player);

  let toAdd = 10 + pow(player.troops(), 0.73) / 4;

  const ratio = 1 - player.troops() / max;
  toAdd *= ratio;

  if (player.type() === PlayerType.Bot) { toAdd *= 0.5; }

  if (player.type() === PlayerType.Nation) {
    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy: toAdd *= 0.9; break;
      case Difficulty.Medium: toAdd *= 0.95; break;
      case Difficulty.Hard: toAdd *= 1; break; // Like humans
      case Difficulty.Impossible: toAdd *= 1.05; break;
    }
  }

  return Math.min(player.troops() + toAdd, max) - player.troops();
}
```

Application (`PlayerExecution.ts:86-89`):

```ts
const troopInc = this.config.troopIncreaseRate(this.player);
this.player.addTroops(troopInc);
const goldFromWorkers = this.config.goldAdditionRate(this.player);
this.player.addGold(goldFromWorkers);
```

Plain-language: per tick, `Δ = (10 + troops^0.73 / 4) × (1 − troops/max)`, clamped so troops never exceed max. It is **logistic-like**: growth depends on current troops (compound) and shrinks linearly as you approach max. Result is floored by `addTroops → toInt`.

Illustrative values:
| troops | max | per tick | per second | per minute |
|---|---|---|---|---|
| 25,000 | 100,000 | 311.9 | 3,119 | 187k |
| 50,000 | 100,000 | 341.6 | 3,416 | 205k |
| 90,000 | 100,000 | 104.4 | 1,044 | 63k |
| 250,000 | 500,000 | 1,095 | 10,950 | 657k |
| 1,000,000 | 2,000,000 | 3,004 | 30,035 | 1.8M |

Key properties:

- **Not tied to tiles or cities directly**; those only enter through `max`. Two players with the same troops and same max regen identically regardless of geography.
- Peak regen is around 40-60 % of max (product of a rising `troops^0.73` and a falling `(1−ratio)`).
- If `troops === 0` regen is `10 × 1 = 10/tick` (the `+10` floor keeps a dead-army player recovering).
- `PlayerExecution.activeDuringSpawnPhase()` returns `false` (`:33-35`) — **no regen or worker gold during the spawn phase** (`numSpawnPhaseTurns()`: 100 singleplayer / 150 random-spawn / 200 otherwise, `Config.ts:817-825`).
- Regen also does not run for dead players (`:69-84` returns after `removeOnDeath`).
- Client displays the same function ×10 as "per second" (`ControlPanel.ts:144`).
- Data-driven: difficulty only. Constants `10`, `0.73`, `4`, `0.5` hardcoded.

Player decision: hovering around half of max-pop yields the highest absolute regen; sitting at cap wastes the compound term, so a good player spends troops (attacks/boats) before hitting ~80 %.

---

### The "troop ratio" / target ratio

There is **no server-side target troop ratio** on `PlayerImpl` (no `targetTroopRatio`, no worker/soldier split). Two distinct things exist:

#### 1. Client attack ratio (human)

**Where:** `src/core/game/UserSettings.ts:725-731` (persisted setting), `src/client/hud/layers/ControlPanel.ts:38,97-119,335-337`, consumed in `src/client/ClientGameRunner.ts:1176,1335,1372,1459`.

**Verbatim:**

```ts
attackRatio(): number { return this.getFloat("settings.attackRatio", 0.2); }
```

```ts
// ControlPanel.ts:103-118
let newAttackRatio = this.attackRatio + event.attackRatio / 100;
if (newAttackRatio < 0.01) {
  newAttackRatio = 0.01;
}
if (newAttackRatio > 1) {
  newAttackRatio = 1;
}
```

```ts
// ClientGameRunner.ts:1174-1177
new SendAttackIntentEvent(
  this.gameView.owner(tile).id(),
  this.myPlayer!.troops() * this.renderer.uiState.attackRatio,
);
```

- Default `0.2` (20 % of current troops per attack), range `[0.01, 1]`, step from `attackRatioIncrement()` (default `10`, `UserSettings.ts:712-716`). Keys `KeyT`/`KeyY` (`:30-31`).
- Purely client-side; the server only sees the absolute troop count in the intent. Nothing in core enforces a ratio.

#### 2. AI reserve ratio (nations/tribes)

**Where:** `src/core/execution/NationExecution.ts:45,58`, `TribeExecution.ts:18,26`, `src/core/execution/utils/AiAttackBehavior.ts:401-405,1049-1053,1247-1250`.

**Verbatim:**

```ts
this.reserveRatio = this.random.nextInt(30, 40) / 100;   // NationExecution.ts:58
private hasReserveRatioTroops(): boolean {
  const maxTroops = this.game.config().maxTroops(this.player);
  const ratio = this.player.troops() / maxTroops;
  return ratio >= this.reserveRatio;
}
const targetTroops = maxTroops * reserveRatio;   // AiAttackBehavior.ts:1053
```

- AI keeps 30-40 % of **max** troops in reserve and only attacks/donates with the surplus.

#### 3. Server-side default attack sizes (when the intent carries no count)

**Where:** `Config.attackAmount` `Config.ts:956-962`, `Config.boatAttackAmount` `:936-938`, `Config.defaultDonationAmount` `:737-739`.

```ts
attackAmount(attacker, defender) { if (attacker.type() === PlayerType.Bot) { return attacker.troops() / 20; } else { return attacker.troops() / 5; } }
boatAttackAmount(attacker, defender): number { return Math.floor(attacker.troops() / 5); }
defaultDonationAmount(sender: Player): number { return Math.floor(sender.troops() / 3); }
```

- `AttackExecution.ts:116-123` removes troops up-front: `this.startTroops = this._owner.removeTroops(this.startTroops)` (clamped to what is held).

Data-driven: none. Player decision: the attack ratio is the single most-used lever in play; a good player lowers it for probing and raises it for finishing pushes, and never lets troops idle at cap.

---

### Per-tick gold income ("workers")

**Where:** `Config.goldAdditionRate` `Config.ts:1053-1062`; `Config.goldMultiplier` `:415-417`; `Config.goldMultiplierFor` `:687-694`; applied `PlayerExecution.ts:88-92`; stat bucket `StatsImpl.goldWork` `src/core/game/StatsImpl.ts:257-259` → `GOLD_INDEX_WORK = 0` (`src/core/StatsSchemas.ts:83`).

**Verbatim:**

```ts
goldAdditionRate(player: Player | PlayerView): Gold {
  const multiplier = this.goldMultiplierFor(player);
  let baseRate: bigint;
  if (player.type() === PlayerType.Bot) { baseRate = 50n; } else { baseRate = 100n; }
  return BigInt(Math.floor(Number(baseRate) * multiplier));
}
goldMultiplier(): number { return this._gameConfig.goldMultiplier ?? 1; }
private goldMultiplierFor(player: Player | PlayerView): number {
  const base = this.goldMultiplier();
  const hc = this._gameConfig.hostCheats;
  if (hc?.goldMultiplier && player.isLobbyCreator()) { return hc.goldMultiplier; }
  return base;
}
```

- **Flat 100 gold/tick for humans and nations, 50 for bots = 1,000/s = 60,000/min.** Does not scale with tiles, population, cities, or anything else. (Pinned in `tests/economy/ConstructionGold.test.ts:52` — `const passivePerTick = 100n; // DefaultConfig goldAdditionRate for humans`.)
- `goldMultiplier` scales it (schema `zb.float({ min: 0.1, max: 1000 })`, `Schemas.ts:546`; host cheat variant at `:552` applies only to the lobby creator and _replaces_ rather than stacks).
- Data-driven: `goldMultiplier`, `hostCheats.goldMultiplier`. Base rates hardcoded.

Player decision: worker gold is a fixed floor that makes the first structure inevitable but never competitive; all meaningful gold comes from trade/trains/conquest, so a good player builds a port ASAP.

---

### Gold accounting on the player (`addGold` / `removeGold` and the per-source counters)

**Where:** `PlayerImpl.ts:1282-1339`.

**Verbatim:**

```ts
addGold(toAdd: Gold, tile?: TileRef): void {
  this._gold += toAdd;
  this._goldEarned += toAdd;           // lifetime gross income
  if (tile) { this.mg.addUpdate({ type: GameUpdateType.BonusEvent, player: this.id(), tile, gold: Number(toAdd), troops: 0 }); }
}
removeGold(toRemove: Gold): Gold {
  if (toRemove <= 0n) { return 0n; }
  const actualRemoved = minInt(this._gold, toRemove);
  this._gold -= actualRemoved;
  return actualRemoved;
}
```

- Separate cumulative counters `_tradeGold`, `_trainGold`, `_piracyGold`, `_goldEarned` (`:122-129`) feed the live leaderboard columns; `GoldRateTracker` (`src/client/hud/layers/lib/GoldRateTracker.ts`) turns deltas into per-in-game-minute rates over a 2-minute window (pinned in `tests/GoldRateTracker.test.ts`).
- `removeGold` never goes negative — an overdraft is silently truncated. There is no debt.
- Stats buckets: `GOLD_INDEX_WORK=0, WAR=1, TRADE=2, STEAL=3, TRAIN_SELF=4, TRAIN_OTHER=5` (`StatsSchemas.ts:83-88`).

---

### Gold from conquest (`conquerGoldAmount`)

**Where:** `Config.conquerGoldAmount` `Config.ts:696-705`; `GameImpl.conquerPlayer` `src/core/game/GameImpl.ts:1322-1376`; callers `AttackExecution.ts:429`, `PlayerExecution.ts:295` (cluster removal). Test `tests/ConquerGold.test.ts`.

**Verbatim:**

```ts
public conquerGoldAmount(captured: Player): Gold {
  if (captured.type() === PlayerType.Bot || captured.type() === PlayerType.Nation) {
    return captured.gold();
  } else {
    return captured.gold() / 2n;
  }
}
```

```ts
// GameImpl.ts:1336-1374
const stats = this._stats.getPlayerStats(conquered);
const attacksSent = stats?.attacks?.[ATTACK_INDEX_SENT] ?? 0n;
const skipGoldTransfer = attacksSent === 0n && conquered.type() === PlayerType.Human;
const gold = skipGoldTransfer ? 0n : conquered.gold();
const goldCaptured = skipGoldTransfer ? 0n : this._config.conquerGoldAmount(conquered);
...
conqueror.addGold(goldCaptured);
conquered.removeGold(gold);
this.stats().goldWar(conqueror, conquered, goldCaptured);
```

- Bot/Nation: conqueror gets **100 %** of their gold. Human: conqueror gets **50 %**, victim loses **100 %** (the other half evaporates).
- **AFK rule:** a human who never sent an attack (`attacksSent === 0n`) transfers nothing and keeps their gold (prevents farming idle players with starting gold). Note: stats require a clientID, so this check is human-only by construction.
- Independently, `PlayerExecution.removeOnDeath` (`:497-515`) zeros a dead player's gold and deletes non-nuke units on the tick after death — so even the untransferred half is destroyed.
- Data-driven: no.

Player decision: killing a rich human yields half their bank instantly — a hoarding neighbour is a target; conversely spending down before dying denies the enemy.

---

### Ports: cost, placement, level scaling

**Where:** `Config.unitInfo(UnitType.Port)` `Config.ts:558-568`; `Config.costWrapper` `:716-735`; `PlayerImpl.portSpawn` `PlayerImpl.ts:1655-1675`; `Config.radiusPortSpawn` `:944-946`; `Config.structureMinDist` `:1156-1158`; `PlayerImpl.unitsOwned/unitsConstructed` `:494-545`.

**Verbatim:**

```ts
case UnitType.Port:
  info = {
    cost: this.costWrapper(
      (numUnits: number) => Math.min(1_000_000, pow2(numUnits) * 125_000),
      UnitType.Port,
      UnitType.Factory,
    ),
    constructionDuration: this.instantBuild() ? 0 : 5 * 10,
    upgradable: true,
  };
```

```ts
private costWrapper(costFn, ...types) {
  return (game, player, extraUnits = 0) => {
    if (player.type() === PlayerType.Human && this.hasInfiniteGoldFor(player)) { return 0n; }
    const numUnits = types.reduce((acc, type) =>
      acc + Math.min(player.unitsOwned(type), player.unitsConstructed(type)), 0);
    return BigInt(costFn(numUnits + extraUnits));
  };
}
```

- **Cost curve:** `min(1,000,000, 2^n × 125,000)` where `n` = ports **plus factories** already counted (shared pool — `costWrapper(…, UnitType.Port, UnitType.Factory)`; Factory symmetrically counts ports, `:641-650`). So 125k → 250k → 500k → 1M → 1M cap. City uses the same curve but its own pool (`:631-639`).
- `n` counts `min(unitsOwned, unitsConstructed)` so **captured** structures do not inflate your price (pinned in `tests/economy/ConstructionCost.test.ts`). `unitsOwned` counts `level` for completed units and `1` for under-construction (`PlayerImpl.ts:532-545`), so **upgrades also raise the next-build price** (each upgrade calls `recordUnitConstructed`, `:1476`).
- Build time `5 * 10 = 50` ticks (5 s). `upgradable: true` → level via `UpgradeStructureExecution`, cost = same `cost()` call (`PlayerImpl.upgradeUnit`, `:1472-1477`).
- Placement: `portSpawn` BFS within `radiusPortSpawn() = 20` manhattan for an owned **shore** tile (`isShore`), closest first, intersected with `validStructureSpawnTiles` (`structureMinDist() = 15`).
- Port level effects: (a) trade-ship spawn attempts per check = level (`PortExecution.shouldSpawnTradeShip`, below); (b) destination weighting = level (`tradingPorts`); (c) warship healing `warshipPortHealingBonusPerLevel() = 5` (`Config.ts:1180-1182`).
- Disabling: `disabledUnits` in GameConfig (`isUnitDisabled`, `Config.ts:376-378`). The schema flag `publicGameModifiers.isPortsDisabled` (`Schemas.ts:498`) is **only read by the client label code** (`src/client/Utils.ts:217`) — `MapPlaylist.ts:390-403` never maps it into `disabledUnits`. Nukes/SAMs modifiers are wired; ports are not.
- Data-driven: `instantBuild`, `infiniteGold`, `hostCheats.infiniteGold`, `disabledUnits`. Curve constants hardcoded.

Player decision: the shared Port/Factory pool means a second port costs the same as a first factory — a good player sequences ports before factories when coastal, and upgrades a port (level 2 = two spawn rolls) once the marginal port would cost 500k+.

---

### Trade ship spawn rate

**Where:** `PortExecution` `src/core/execution/PortExecution.ts:19-56,71-84`; `Config.tradeShipSpawnRate` `Config.ts:509-523`; `Config.tradeShipSaturation` `:502-507`; `PseudoRandom.chance` `src/core/PseudoRandom.ts:93-95`; `GameImpl.unitCount` `GameImpl.ts:350-361`. Golden values in `tests/TradeTrainGolden.test.ts`.

**Verbatim:**

```ts
// PortExecution.ts
init(mg, ticks) { this.mg = mg; this.random = new PseudoRandom(mg.ticks()); this.checkOffset = mg.ticks() % 10; }
tick(ticks) {
  if (!this.port.isActive()) { this.active = false; return; }
  if (this.port.isUnderConstruction()) { return; }
  if (!this.port.hasTrainStation()) { this.createStation(); }
  // Only check every 10 ticks for performance.
  if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) { return; }
  if (!this.shouldSpawnTradeShip()) { return; }
  const ports = this.tradingPorts();
  if (ports.length === 0) { return; }
  const port = this.random.randElement(ports);
  this.mg.addExecution(new TradeShipExecution(this.port.owner(), this.port, port));
}
shouldSpawnTradeShip(): boolean {
  const numTradeShips = this.mg.unitCount(UnitType.TradeShip);
  for (let i = 0; i < this.port!.level(); i++) {
    const spawnRate = this.mg.config().tradeShipSpawnRate(this.tradeShipSpawnRejections, numTradeShips);
    if (this.random.chance(spawnRate)) { this.tradeShipSpawnRejections = 0; return true; }
    this.tradeShipSpawnRejections++;
  }
  return false;
}
```

```ts
// Config.ts
tradeShipSaturation(numTradeShips: number): number {
  const boost = 1 + 0.45 * exp(-numTradeShips / 120);
  const damping = 1 - sigmoid(numTradeShips, Math.LN2 / 50, 230);
  const plateau = 0.25 * (1 - sigmoid(numTradeShips, Math.LN2 / 100, 800));
  return boost * Math.max(damping, plateau);
}
// Probability of trade ship spawn = 1 / tradeShipSpawnRate
tradeShipSpawnRate(tradeShipSpawnRejections: number, numTradeShips: number): number {
  const rejectionModifier = 1 / (tradeShipSpawnRejections + 1);
  return Math.max(1, Math.floor((100 * rejectionModifier) / this.tradeShipSaturation(numTradeShips)));
}
```

```ts
chance(odds: number): boolean { return this.nextInt(0, odds) === 0; }   // P = 1/odds
```

Mechanics:

- A port rolls **once every 10 ticks (1 s)**, `level` times per roll. Each roll succeeds with `P = 1/spawnRate`.
- **Pity timer:** every failed roll increments `tradeShipSpawnRejections`; `spawnRate = floor(100 / (rej+1) / saturation)`. After k rejections the odds are k+1 times better; a success resets to 0. Expected wait therefore scales as roughly `sqrt(100/saturation)` rolls (the docstring says "the pity timer square-roots the realized effect").
- **Global saturation** uses the **world-wide** count of live trade ships (`mg.unitCount(TradeShip)` sums over all players), not the owner's.

Saturation table (rej = 0):
| world ships | saturation | spawnRate | P per roll |
|---|---|---|---|
| 0 | 1.393 | 71 | 1.4 % |
| 50 | 1.198 | 83 | 1.2 % |
| 110 | 0.992 | 100 | 1.0 % |
| 230 | 0.533 | 187 | 0.53 % |
| 310 | 0.256 | 389 | 0.26 % |
| 800 | 0.125 | 799 | 0.13 % |
| 1000 | 0.050 | 1999 | 0.05 % |

- With pity, a lone level-1 port in an empty world spawns roughly every ~10-12 s; at the 0.25 plateau roughly half that cadence.
- The port's RNG is seeded with `mg.ticks()` at init — deterministic across clients.
- Data-driven: no (all constants hardcoded; only `disabledUnits` can switch it off).

Player decision: port levels are linear in spawn attempts but the world fleet cap is shared, so late-game the marginal port yields less; a good player front-loads port investment before the fleet hits ~230.

---

### Trade ship routing (which port pairs, distance, proximity bonus)

**Where:** `PortExecution.tradingPorts` `PortExecution.ts:99-143`; `Config.tradeShipShortRangeDebuff` `Config.ts:948-950`; `Config.proximityBonusPortsNb` `:952-954`; `PlayerImpl.canTrade` `PlayerImpl.ts:1204-1208`. Tests `tests/PortExecution.test.ts`.

**Verbatim:**

```ts
tradeShipShortRangeDebuff(): number { return 300; }
proximityBonusPortsNb(totalPorts: number) { return within(totalPorts / 3, 4, totalPorts); }
canTrade(other: Player): boolean {
  const embargo = other.hasEmbargoAgainst(this) || this.hasEmbargoAgainst(other);
  return !embargo && other.id() !== this.id();
}
```

```ts
// It's a probability list, so if an element appears twice it's because it's
// twice more likely to be picked later.
tradingPorts(): Unit[] {
  const sourceComponents = new Set<number>();
  for (const neighbor of this.mg.neighbors(this.port!.tile())) {
    if (!this.mg.isWater(neighbor)) continue;
    const comp = this.mg.getWaterComponent(neighbor);
    if (comp !== null) sourceComponents.add(comp);
  }
  const ports = this.mg.players()
    .filter((p) => p !== this.port!.owner() && p.canTrade(this.port!.owner()))
    .flatMap((p) => p.units(UnitType.Port))
    .filter((p) => { for (const comp of sourceComponents) { if (this.mg.hasWaterComponent(p.tile(), comp)) return true; } return false; })
    .sort((p1, p2) => this.mg.manhattanDist(this.port!.tile(), p1.tile()) - this.mg.manhattanDist(this.port!.tile(), p2.tile()));

  const weightedPorts: Unit[] = [];
  for (const [i, otherPort] of ports.entries()) {
    const expanded = new Array(otherPort.level()).fill(otherPort);
    weightedPorts.push(...expanded);
    const tooClose = this.mg.manhattanDist(this.port!.tile(), otherPort.tile()) < this.mg.config().tradeShipShortRangeDebuff();
    const closeBonus = i < this.mg.config().proximityBonusPortsNb(ports.length);
    if (!tooClose && closeBonus) { weightedPorts.push(...expanded); }
    if (!tooClose && this.port!.owner().isFriendly(otherPort.owner())) { weightedPorts.push(...expanded); }
  }
  return weightedPorts;
}
```

Rules:

1. **Candidates** = every port of every _other_ alive player where `canTrade` holds (no embargo either direction) and which shares a **water component** with a water tile adjacent to the source port (same ocean/lake). Note: candidate ports are not filtered for `isUnderConstruction` here (only the captured-ship re-route does that).
2. **Never your own ports.** Self-trade is impossible (`p !== owner`).
3. Sorted by manhattan distance, ascending.
4. Weighting (entries in the pick list):
   - `level` entries for every candidate (base weight = port level).
   - **+level again** if the port is among the nearest `within(N/3, 4, N)` ports (at least the 4 nearest, or a third of them) **and** is at least 300 manhattan away.
   - **+level again** if the owner is friendly (allied or same team) **and** at least 300 away.
   - So a close-but-≥300 allied port gets 3× weight; a port <300 away gets only base weight (no bonus, and it will pay badly — see payout).
5. Destination chosen uniformly from the weighted list via `randElement`.

- Data-driven: no.

Player decision: ports placed ≥300 tiles from the neighbours you trade with get double the routing weight _and_ the full payout; allied ports triple it — alliances are an economic act, not just a military one.

---

### Trade ship travel, payout formula, and arrival crediting

**Where:** `TradeShipExecution` `src/core/execution/TradeShipExecution.ts:15-224`; `Config.tradeShipGold` `Config.ts:484-489`. Golden values `tests/TradeTrainGolden.test.ts` (snapshot), scenario numbers `tests/TradeTrainScenarios.test.ts`.

**Verbatim (payout):**

```ts
tradeShipGold(dist: number, player: Player | PlayerView): Gold {
  // Sigmoid: concave start, sharp S-curve middle, linear end - heavily punishes trades under range debuff.
  const debuff = this.tradeShipShortRangeDebuff();
  const baseGold = 75_000 / (1 + exp(-0.03 * (dist - debuff))) + 50 * dist;
  return BigInt(Math.floor(baseGold * this.goldMultiplierFor(player)));
}
```

`gold = 75,000 / (1 + e^(−0.03·(dist − 300))) + 50·dist`, ×goldMultiplier, floored.

| dist (tiles travelled) | gold    |
| ---------------------- | ------- |
| 50                     | 2,541   |
| 100                    | 5,185   |
| 200                    | 13,556  |
| 300                    | 52,500  |
| 400                    | 91,443  |
| 500                    | 99,814  |
| 800                    | 114,999 |
| 1,000                  | 124,999 |
| 2,000                  | 175,000 |

**Verbatim (travel and completion), `TradeShipExecution.ts`:**

```ts
// :40-56  spawn on first tick
this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, spawn, {
  targetUnit: this._dstPort,
  lastSetSafeFromPirates: ticks,
});
this.mg.stats().boatSendTrade(this.origOwner, this._dstPort.owner());
// :124-146 movement — one pathfinder step per tick
this.mg.recordMotionPlan({
  kind: "grid",
  unitId,
  planId,
  startTick: ticks + 1,
  ticksPerStep: 1,
  path,
});
if (this.mg.isWater(result.node) && this.mg.isShoreline(result.node)) {
  this.tradeShip.setSafeFromPirates();
}
this.tradeShip.move(result.node);
this.tilesTraveled++;
// :174-207 complete()
const gold = this.mg
  .config()
  .tradeShipGold(this.tilesTraveled, this.tradeShip!.owner());
if (this.wasCaptured) {
  this.tradeShip!.owner().addGold(gold, this._dstPort.tile());
  this.tradeShip!.owner().addPiracyGold(gold);
  this.mg
    .stats()
    .boatCapturedTrade(this.tradeShip!.owner(), this.origOwner, gold);
} else {
  this.srcPort.owner().addGold(gold, this.srcPort.tile());
  this._dstPort.owner().addGold(gold, this._dstPort.tile());
  this.srcPort.owner().addTradeGold(gold);
  this._dstPort.owner().addTradeGold(gold);
  this.mg
    .stats()
    .boatArriveTrade(this.srcPort.owner(), this._dstPort.owner(), gold);
}
```

- `dist` is **tiles actually travelled along the water path** (`tilesTraveled++` per step), not straight-line. Speed is 1 tile/tick (`ticksPerStep: 1`), so a 500-tile route takes 50 s.
- **Both** the source-port owner and the destination-port owner receive the **full** payout (gold is created, not transferred). Trade is strictly positive-sum for both parties.
- Trade ships cost `0n` (`Config.ts:597-600`), `canBuild` still requires the owner to be alive and the unit not disabled.
- Cancellation cases (`:78-93`): if the destination port's owner becomes the same as the source owner (port captured) → ship deleted, no payout; if not captured and (`dstPort` inactive **or** `canTrade` now false because an embargo was placed mid-voyage) → ship deleted, no payout. **An embargo therefore kills in-flight ships in both directions, immediately.**
- `goldMultiplier` applies to the _current ship owner_ (the pirate, if captured).
- Data-driven: `goldMultiplier` only. Curve constants hardcoded.

Player decision: distance is the payout lever — 300 tiles is the knee (52.5k), 500 tiles is near the plateau (~100k); a good player routes trade with distant partners and treats sub-200-tile trades as near-worthless.

---

### Trade ship capture (piracy) rules

**Where:** `WarshipExecution.findBestTarget` `src/core/execution/WarshipExecution.ts:250-320`; `WarshipExecution.huntDownTradeShip` `:659-700`; `UnitImpl.setSafeFromPirates/isSafeFromPirates` `src/core/game/UnitImpl.ts:602-611`; `Config.safeFromPiratesCooldownMax` `Config.ts:1235-1237`; `Config.warshipTargettingRange` `:1168-1170`; `Config.warshipPatrolRange` `:1164-1166`; re-routing after capture `TradeShipExecution.ts:96-121`; `PlayerImpl.captureUnit` `PlayerImpl.ts:1360-1365`.

**Verbatim:**

```ts
safeFromPiratesCooldownMax(): number { return 20; }
warshipTargettingRange(): number { return 130; }
warshipPatrolRange(): number { return 100; }
isSafeFromPirates(): boolean {
  return this.mg.ticks() - this._lastSetSafeFromPirates < this.mg.config().safeFromPiratesCooldownMax();
}
```

```ts
// WarshipExecution.ts:277-319 (trade-ship-specific filters)
if (unit === this.warship || unit.owner() === owner || !owner.canAttackPlayer(unit.owner(), true) || this.alreadySentShell.has(unit) || ...) continue;
if (includeTradeShips && type === UnitType.TradeShip) {
  hasReachablePort = warshipComponent !== null && owner.units(UnitType.Port).some((port) => port.isActive() && !port.isMarkedForDeletion() && !port.isUnderConstruction() && mg.hasWaterComponent(port.tile(), warshipComponent!));
  patrolTile = this.warship.warshipState().patrolTile;
  patrolRangeSquared = config.warshipPatrolRange() ** 2;
  if (!hasReachablePort || patrolTile === undefined || unit.isSafeFromPirates() || unit.targetUnit()?.owner() === owner || unit.targetUnit()?.owner().isFriendly(owner)) continue;
  if (mg.euclideanDistSquared(patrolTile, unit.tile()) > patrolRangeSquared!) continue;
}
```

```ts
// :663-671 capture
if (dist <= 5) {
  this.warship.owner().captureUnit(target);
  this.warship.recordTradeCapture();
  ...
}
```

Rules, in order:

1. Warship sees trade ships within **130** tiles of itself, but only captures ones within **100** (patrol range) of its **patrol tile**.
2. Target owner must be attackable (`canAttackPlayer(owner, true)` — not friendly, not spawn-immune if the pirate is human; `PlayerImpl.ts:1893-1902`).
3. The pirate must own an active, completed port on the same water component (otherwise the captured ship could never deliver).
4. **Ship is immune while `safeFromPirates`**: a ship touching a shoreline water tile refreshes the timestamp; immunity lasts **20 ticks (2 s)** after the last shoreline contact. Ships hugging coasts are effectively uncapturable; ships crossing open water are exposed.
5. Ships whose _destination_ is the pirate or a friend of the pirate are skipped (you do not rob your own customers).
6. Capture is a **manhattan-distance ≤ 5 touch** (or path COMPLETE) — no combat roll, no damage. `captureUnit` calls `unit.setOwner`; trade ships are excluded from the stats switch in `setOwner` (`UnitImpl.ts:231-262`) because `boatCapturedTrade` is recorded at delivery.
7. After capture `TradeShipExecution` (`:96-121`) redirects the ship to the **pirate's nearest active port on the same water component**; if none, the ship is deleted. Payout at arrival = `tradeShipGold(tilesTraveled)` — **total tiles including pre-capture travel** — credited to the pirate only, as `piracyGold` / `GOLD_INDEX_STEAL`. Original owners get nothing.
8. A captured ship can be recaptured (the `wasCaptured` flag stays true; if `origOwner` recaptures, the message is not re-shown but payout still goes to the current owner).
9. Warship veterancy: `warshipVeterancyTradeCaptures() = 25` captures per level (`Config.ts:1227-1229`; progress meter in `UnitImpl.addVeterancyProgress`).
10. Trade ships are **never shelled** — `ShellExecution`/`DefensePostExecution` do not reference them; the only destroy path is a nuke blast (`NukeExecution.ts:450-463` deletes every non-projectile unit within `outer` radius, recorded as `boatDestroyTrade`).

- Data-driven: no.

Player decision: a single warship parked on an open-water choke with a nearby port converts enemy trade into your income at zero cost; conversely, coast-hugging routes are safe, so port placement inside a coastline shields you.

---

### Embargoes (the existing "trade block")

**Where:** `PlayerImpl.ts:1178-1253` (`canEmbargoAll`, `hasEmbargoAgainst`, `canTrade`, `addEmbargo`, `stopEmbargo`, `endTemporaryEmbargo`, `tradingPartners`); `EmbargoExecution.ts`, `EmbargoAllExecution.ts`; expiry in `PlayerExecution.ts:100-108`; `Config.temporaryEmbargoDuration` `Config.ts:781-783`; `Config.embargoAllCooldown` `:743-745`.

**Verbatim:**

```ts
temporaryEmbargoDuration(): Tick { return 300 * 10; } // 5 minutes.
embargoAllCooldown(): Tick { return 10 * 10; }
addEmbargo(other: Player, isTemporary: boolean): void {
  const embargo = this.embargoes.get(other.id());
  if (embargo !== undefined && !embargo.isTemporary) return;
  ...
  this.embargoes.set(other.id(), { createdAt: this.mg.ticks(), isTemporary, target: other });
}
```

```ts
// PlayerExecution.ts:100-108
for (const embargo of this.player.getEmbargoes()) {
  if (
    embargo.isTemporary &&
    this.mg.ticks() - embargo.createdAt >
      this.mg.config().temporaryEmbargoDuration()
  ) {
    this.player.stopEmbargo(embargo.target);
  }
}
```

- Binary: an embargo in **either** direction makes `canTrade` false → no new routes between the pair (`tradingPorts` filter) **and** in-flight ships between them are deleted (`TradeShipExecution.ts:88-93`).
- Permanent (player action) or temporary (5 min; set by AI/relations code). `EmbargoAll` skips bots and teammates, 10 s cooldown.
- **Price effect (session 11):** the embargoed side's remaining trade-ship payouts are multiplied by `embargoTariff(embargoPressure())`, where pressure is the share of possible partners embargoing it (bots excluded from the denominator). Route weighting is unchanged.
- Data-driven: no.

Player decision: embargo is a free, instant economic strike that also costs _you_ that partner's revenue; use it on a rival whose trade with you is less valuable than the denial to them.

---

### Train income (secondary gold source, for completeness)

**Where:** `Config.trainGold` `Config.ts:449-472`; `Config.trainSpawnRate` `:442-447`; `Config.trainSaturation` `:435-440`; `TradeStationStopHandler.onStop` `src/core/game/TrainStation.ts:15-40`.

**Verbatim:**

```ts
trainGold(rel: "self" | "team" | "ally" | "other", citiesVisited: number, player): Gold {
  citiesVisited = Math.max(0, citiesVisited - 9);         // No penalty for the first 10 cities.
  let baseGold: number;
  switch (rel) { case "ally": baseGold = 35_000; break; case "team": case "other": baseGold = 25_000; break; case "self": baseGold = 10_000; break; }
  const distPenalty = citiesVisited * 5_000;
  const gold = Math.max(5000, baseGold - distPenalty);
  return toInt(gold * this.goldMultiplierFor(player));
}
trainSpawnRate(numPlayerFactories, numTrainUnits) { const rate = (numPlayerFactories + 10) * 15; return Math.max(1, Math.floor(rate / this.trainSaturation(numTrainUnits))); }
```

- Per stop at a City/Port station: train owner gets `gold`; if the station belongs to someone else, station owner **also** gets `gold` (`TrainStation.ts:31-38`). Factories pay nothing. Ports double as train stations if a factory is within `trainStationMaxRange() = 110` (`PortExecution.createStation`, `CityExecution.createStation`).
- Data-driven: `goldMultiplier`.

---

### Upkeep — **built (Phase 5, brief §6.3, session 11)**

**Where:** `Config.unitUpkeep(type, player)`, `Config.upkeepDue(player)`, `Config.upkeepGraceTicks()`; charged in `PlayerExecution.tick` right after worker income and before troop growth; `foreclose()` in the same file; stats index `GOLD_INDEX_UPKEEP` (6).

**Per tick, per level, per active built unit** (× the lobby's gold multiplier, like income):

| Unit                     | Upkeep                        |
| ------------------------ | ----------------------------- |
| City, Port               | 10                            |
| Factory                  | 15                            |
| DefensePost              | 5 × `armsUpkeepScale()` = 10  |
| SAMLauncher, MissileSilo | 25 × `armsUpkeepScale()` = 50 |
| Warship                  | 40 × `armsUpkeepScale()` = 80 |
| everything else          | 0                             |

The arms rows carry `armsUpkeepScale()` = 2 since the session-12 retune: at ×1 upkeep was a pressure and not a wall (session 11's A/B moved three cities and six posts), so a standing army now costs a real share of a treasury to keep while the economy rows stay where they were. Lever `--cheap-arms-upkeep` restores ×1.

Against a human's 100/tick of worker income, five cities, three ports and a factory pay 95 back before trade — enough to make the next city a decision rather than a reflex. Under construction pays nothing (`isUnderConstruction()`), so a half-built silo is not a bill.

**Non-payment.** `removeGold` clamps at zero and the engine cannot hold debt, so a short treasury is modelled as consequences rather than a negative balance:

- **This tick:** no troop growth. `troopIncreaseRate` is skipped for any tick in which `removeGold(due)` returned less than `due`.
- **Running:** `PlayerExecution.unpaidUpkeepTicks` counts consecutive short ticks and resets to zero on the first tick paid in full. At `upkeepGraceTicks()` = 300 (30 s) it fires `foreclose()`: the single active built unit with the highest `unitUpkeep × level` is deleted (ties to the oldest, i.e. lowest id, so every client picks the same one), an `events_display.upkeep_foreclosed` message is shown, and the counter restarts — one loss per grace period. Nothing is exempt: a player who cannot feed their last city loses it, which is what "overbuilding bankrupts you" has to mean for the threat to be real. In practice the dearest unit goes first, so a player with three warships and a city loses one warship and is then solvent (`tests/economy/Upkeep.test.ts`).

**Bots and nations** pay it too. `NationStructureBehavior` budgets on `gold()` before building, so upkeep slows their building rather than trapping them; a nation that overbuilds forecloses like anyone else.

**Stats:** `Stats.goldUpkeep` records what was taken under `gold[6]`. Readers of the gold array index by name (`GameInfoRanking`, `StatsTree` adds element-wise), so the new column is never mistaken for income.

**A/B lever:** `npm run balance:run -- --no-upkeep` zeroes `unitUpkeep` and nothing else.

---

### Infinite gold / infinite troops / host cheats

**Where:** `Config.ts:403-411` (`infiniteGold`, `infiniteTroops`), `:665-685` (`hasInfiniteGoldFor`, `hasInfiniteTroopsFor`, `hasInfiniteTroopsForInfo`), `:687-694` (`goldMultiplierFor`); schema `Schemas.ts:513-514, 546-554`.

**Verbatim:**

```ts
infiniteGold(): boolean { return this._gameConfig.infiniteGold; }
infiniteTroops(): boolean { return this._gameConfig.infiniteTroops; }
private hasInfiniteGoldFor(player): boolean {
  if (this.infiniteGold()) return true;
  const hc = this._gameConfig.hostCheats;
  return (hc?.infiniteGold ?? false) && player.isLobbyCreator();
}
private hasInfiniteTroopsFor(player): boolean {
  if (this.infiniteTroops()) return true;
  return (this._gameConfig.hostCheats?.infiniteTroops ?? false) && player.isLobbyCreator();
}
```

Effects:

- **Infinite gold** does _not_ grant gold; it makes every `costWrapper` cost return `0n` for **Human** players (`:721-725`) and MIRV cost `0n` (`:582-587`). Nations/bots are unaffected (they still pay). Worker income is unchanged.
- **Infinite troops**: `startManpower` → `1_000_000` (`:982`), `maxTroops` → `1_000_000_000` for humans (`:987-988`). Regen formula still applies (and with a 1e9 cap the `(1−ratio)` term ≈ 1, so regen ≈ `10 + troops^0.73/4`).
- **Host cheats** (`hostCheats.{infiniteGold, infiniteTroops, goldMultiplier, startingGold}`) apply only to `player.isLobbyCreator()`; `goldMultiplier` cheat replaces the global multiplier for the host rather than stacking; `startingGold` cheat adds to the base.
- Data-driven: yes, entirely from `GameConfig`.

---

### Per-tick execution order (where economy hooks live)

`PlayerExecution.tick` (`PlayerExecution.ts:45-124`), one instance per player, runs after spawn phase:

1. `decayRelations()`
2. Structure ownership sweep: any structure on a tile no longer owned → captured by tile owner (`captureUnit`) or deleted if DefensePost / tile unowned (`:47-67`). **Ports/cities/factories change hands with territory, free of charge.**
3. Death check → `removeOnDeath` (zero gold, delete non-nuke units, drop alliances).
4. `addTroops(troopIncreaseRate)`; `addGold(goldAdditionRate)`; `stats.goldWork`.
5. Alliance expiry; temporary embargo expiry.
6. Cluster removal (encircled territory handover, may call `conquerPlayer`).

`PortExecution.tick` (one per port) and `TradeShipExecution.tick` (one per ship) are separate executions added via `mg.addExecution`.

---

### Gaps vs FightWars brief

| Brief requirement                                               | Exists today?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Hook point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Materials + Manpower as distinct resources**                  | **Materials: yes (session 11)** — see §03 7.2. **Manpower: exists under another name.** `maxTroops` already caps regeneration by land and cities (`Config.maxTroops`, `troopIncreaseRate`), which is the brief's "caps troop regen, grows with cities and density"; a second pool would duplicate it. Surface it as a number, do not rebuild it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Add fields alongside `PlayerImpl._gold/_troops` (`PlayerImpl.ts:119-120`) with `addX/removeX` mirroring `addGold/removeGold` (`:1314-1339`); add per-tick rates as new `Config` methods next to `goldAdditionRate` (`Config.ts:1053`) and apply them in `PlayerExecution.tick` at `:86-92`. `UnitInfo.cost` (`Game.ts:175-183`) is gold-only — either widen to a cost bundle or add `materialsCost`/`manpowerCost` fns and check them in `canBuildUnitType` (`PlayerImpl.ts:1425-1440`) and deduct in `buildUnit` (`:1391-1392`). The `PlayerUpdate` wire (`toUpdate`, `:212-262`; packed quint `[smallID, tiles, gold, troops, goldEarned]`) and `Stats` gold indices (`StatsSchemas.ts:83-88`) need new slots.                                                                                 |
| **Per-tick upkeep on structures / warships**                    | **Yes (session 11)** — see "Upkeep" above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Cleanest: a `Config.upkeepRate(unit: Unit): Gold` (or per-resource) and a loop in `PlayerExecution.tick` after line 89 iterating `this.player.units()` (the structure sweep at `:47-67` already iterates them). Decide the 0-balance policy: `removeGold` clamps silently (`:1332-1339`), so add an explicit "unpaid upkeep" consequence (disable unit, delete, or troop drain). Warships: could alternatively live in `WarshipExecution.tick` but per-player batching is cheaper.                                                                                                                                                                                                                                                                                                               |
| **Blockadable trade ships**                                     | **Yes (session 11)** — `src/core/execution/Blockade.ts`: a port with a warship of a non-friendly player within `Config.blockadeRange()` = 25 tiles launches no trade ships (`PortExecution.tick` returns before the spawn roll, so the pity counter does not wind up behind a blockade) and receives none (`tradingPorts` drops blockaded destinations). Answered once per tick for every port and cached per game, because every source port asks about every candidate destination. `--no-blockades` on `balance:run` sets the range to 0. Capture-by-touch is unchanged, and there is still no sink-instead-of-capture mode. Previously: capture-by-touch exists (`WarshipExecution.huntDownTradeShip`, `:659-700`) with patrol-range and shoreline-immunity rules; embargo deletes in-flight ships (`TradeShipExecution.ts:88-93`). There is no "blockade zone" that prevents routing or spawning, and no interception that _destroys_ rather than captures (only nukes destroy). | Routing block: filter in `PortExecution.tradingPorts` (`:99-143`) — e.g. reject candidates whose path crosses a hostile warship's patrol circle, or add a `Config.blockadeRange()` and check `mg.nearbyUnits(port.tile(), range, Warship)` for hostile owners at both ends. Spawn block: early-return in `PortExecution.tick` before `shouldSpawnTradeShip()` (`:45-47`). Interception: `findBestTarget` (`:250-320`) already selects trade ships; change the `dist <= 5` capture branch (`:663-671`) to `target.delete(true, warship.owner())` for a sink-instead-of-capture mode (stats hook `boatDestroyTrade` already exists at `UnitImpl.ts:351-352`). Shoreline immunity (`safeFromPiratesCooldownMax = 20`, `Config.ts:1235`) must be revisited or blockades near coasts will never bite. |
| **Embargo price effects**                                       | **Yes (session 11)** — `Player.embargoPressure()` is the share of living non-bot players (other than itself) with an embargo against it; `Config.embargoTariff(pressure)` = 1 − 0.5 × pressure multiplies the embargoed side's trade-ship payout in `TradeShipExecution.complete`, each end of a route paying its own. One embargo is a nuisance; a coalition is a siege. `--no-embargo-price` sets the maximum to 0. Bilateral `canTrade` is unchanged — the price is on the trade that still happens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Add a relation-aware multiplier in `Config.tradeShipGold` (`Config.ts:484-489`) — it already takes `player` and could take `(srcOwner, dstOwner)`; apply in `TradeShipExecution.complete` (`:174-207`) where both owners are known. For "soft" embargoes, keep `canTrade` true but reduce weight in `tradingPorts` (`:118-136`) and payout. `Embargo` record (`PlayerImpl.ts:137`, `{createdAt, isTemporary, target}`) would need a `severity`/`tariff` field; `EmbargoExecution` (`:1-37`) and the intent schema would carry it.                                                                                                                                                                                                                                                                |
| Trade income already scales with port level, distance, alliance | Yes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `tradingPorts` weighting; `tradeShipGold` sigmoid. Reusable as-is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Gold as bigint                                                  | Yes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Keep new resources bigint for determinism; `toInt` for float→bigint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Structure capture with territory                                | Yes, free                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `PlayerExecution.ts:47-67`. If Materials should be lost/gained on capture, hook `captureUnit` (`PlayerImpl.ts:1360-1365`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 02 — Combat: the attack chain

Source of truth for the land-attack pipeline in `C:\Users\disbo\dev\fightwars` (OpenFront fork). Every path below is relative to that repo root. Line numbers are from the tree as read on 2026-09-12. All code is quoted verbatim; nothing was modified.

Reading order for the flow: **§1 (client ratio) → §2 (commitment) → §3 (border set / priority) → §4 (per-tick budget) → §5 (per-tile formula) → §6–§10 (modifiers) → §11 (end / retreat) → §12 (boats) → §13 (spawn immunity) → §14 (terrain model) → §15 (map generator) → §16 (tests) → Gaps**.

---

### 1. Attack ratio (client-side; the only "how many troops" knob)

**Where it lives**

- Default: `src/core/game/UserSettings.ts:725-727`
- Bounds / stepping: `src/client/hud/layers/ControlPanel.ts:102-120` (keyboard), `:352-357` (slider)
- Applied at click: `src/client/ClientGameRunner.ts:1171-1181`, `:1330-1339` (keyboard attack), `:1365-1373` (retaliate), `:1453-1461` (boat)
- Wire schema: `src/core/Schemas.ts:617-621` (`AttackIntentSchema`), `:630-636` (`BoatAttackIntentSchema`)

**Actual code**

```ts
// UserSettings.ts:725
attackRatio(): number {
  return this.getFloat("settings.attackRatio", 0.2);
}
```

```ts
// ControlPanel.ts:102-120
this.eventBus.on(AttackRatioEvent, (event) => {
  let newAttackRatio = this.attackRatio + event.attackRatio / 100;
  if (newAttackRatio < 0.01) {
    newAttackRatio = 0.01;
  }
  if (newAttackRatio > 1) {
    newAttackRatio = 1;
  }
  if (newAttackRatio === 0.11 && this.attackRatio === 0.01) {
    // If we're changing the ratio from 1%, then set it to 10% instead of 11% to keep a consistency
    newAttackRatio = 0.1;
  }
  this.attackRatio = newAttackRatio;
  this.onAttackRatioChange(this.attackRatio);
});
```

```ts
// ClientGameRunner.ts:1171-1181
this.myPlayer.actions(tile, [UnitType.TransportShip]).then((actions) => {
  if (actions.canAttack) {
    this.eventBus.emit(
      new SendAttackIntentEvent(
        this.gameView.owner(tile).id(),
        this.myPlayer!.troops() * this.renderer.uiState.attackRatio,
      ),
    );
  } else if (this.canAutoBoat(actions.buildableUnits, tile)) {
    this.sendBoatAttackIntent(tile);
  }
});
```

```ts
// Schemas.ts:617-621
export const AttackIntentSchema = z.object({
  type: z.literal("attack"),
  targetID: MappedID.nullable(),
  troops: zb.float({ min: 0 }).nullable(),
});
```

**Flow.** The player holds a ratio _r_ ∈ [0.01, 1] (default 0.2, persisted in localStorage). A click on an enemy/unclaimed tile computes `troops = myTroops * r` **on the client** and sends it as a float in the intent. `targetID` is the tile owner's id (or terra nullius id). If `troops` is `null`, the server falls back to `Config.attackAmount` (§2). The intent is turned into an execution at `src/core/execution/ExecutionManager.ts:60-66`:

```ts
case "attack": {
  return new AttackExecution(intent.troops, player, intent.targetID, null);
}
```

**Data-driven vs hardcoded.** Ratio bounds (0.01/1, the 0.11→0.10 snap) hardcoded in ControlPanel. Default 0.2 hardcoded in UserSettings. No server-side cap on the requested amount other than `min(owner.troops(), requested)` (§2).

**Decision it drives.** The single biggest lever a player has: `attackTroops` feeds the `troopRatio = defender.troops / attackTroops` term that controls both attacker losses (clamped [0.6, 2]) and speed (clamped [0.82, 7.5] × second ramp past 20×) — see §5.

---

### 2. Troop commitment on the server (`AttackExecution.init`)

**Where it lives**: `src/core/execution/AttackExecution.ts:43-49` (ctor), `:59-188` (init). Fallback amount: `src/core/configuration/Config.ts:956-962`.

```ts
// Config.ts:956-962
attackAmount(attacker: Player, defender: Player | TerraNullius) {
  if (attacker.type() === PlayerType.Bot) {
    return attacker.troops() / 20;
  } else {
    return attacker.troops() / 5;
  }
}
```

```ts
// AttackExecution.ts:114-130
this.startTroops ??= this.mg.config().attackAmount(this._owner, this.target);
if (this.removeTroops) {
  this.startTroops = Math.min(this._owner.troops(), this.startTroops);
  // Take the amount that was actually deducted, not the amount asked for.
  // removeTroops() floors, so a fractional request leaves the attack
  // holding troops the owner never paid for — and retreat refunds the
  // combined total, turning the leftover fractions into free troops.
  this.startTroops = this._owner.removeTroops(this.startTroops);
}
this.attack = this._owner.createAttack(
  this.target,
  this.startTroops,
  this.sourceTile,
  new Set<TileRef>(),
);
```

`removeTroops` (`src/core/game/PlayerImpl.ts:1352-1359`) floors to an integer via `toInt` and returns the amount actually removed:

```ts
removeTroops(troops: number): number {
  if (troops <= 0) { return 0; }
  const toRemove = minInt(this._troops, toInt(troops));
  this._troops -= toRemove;
  return Number(toRemove);
}
```

**Pre-checks in `init`, in order** (`AttackExecution.ts:66-112`):

1. target must exist (`mg.hasPlayer`) — else inactive.
2. owner ≠ target.
3. `owner.isFriendly(target)` (ally or same team) → refused (`:85-95`).
4. If both are non-bots: `targetPlayer.addEmbargo(owner, true)` and any incoming alliance request from the target is rejected (`:97-107`).
5. `owner.canAttackPlayer(target)` (`PlayerImpl.ts:1893-1902`) — spawn immunity check, see §13.

**Merging / cancelling** (`:141-165`):

- Opposing attack in flight (target attacking us): the two stacks cancel troop-for-troop; the smaller is deleted, the larger keeps the difference.
- Another of our own outgoing land attacks on the same target: merged into this one and the older deleted. **Boat attacks (`sourceTile !== null`) never merge.**

**Relation hit** (`:167-187`): target's relation to attacker drops by −60 / −70 / −80 / −100 for Easy / Medium / Hard / Impossible.

**Data-driven vs hardcoded.** `/5` and `/20` fallback hardcoded in Config; difficulty relation deltas hardcoded in AttackExecution.

**Decision it drives.** How many troops leave the owner's pool immediately (they are gone from `troops()` and from the income formula's `player.troops()` until they return via retreat). Troop count at commit sets `attackTroops` for every subsequent per-tile call.

---

### 3. Border set and conquest priority (`addNeighbors`, `refreshToConquer`)

**Where it lives**: `src/core/execution/AttackExecution.ts:190-199` (refresh), `:375-423` (addNeighbors). Border bookkeeping: `src/core/game/AttackImpl.ts:77-98`. Heap: `src/core/execution/utils/FlatBinaryHeap.ts:46-71` (min-heap — `dequeue` returns the **lowest** priority).

```ts
// AttackExecution.ts:190-199
private refreshToConquer() {
  this.toConquer.clear();
  this.attack.clearBorder();
  this._owner.borderTiles().forEach((tile) => this.addNeighbors(tile));
}
```

```ts
// AttackExecution.ts:375-423
private addNeighbors(tile: TileRef) {
  const tickNow = this.mg.ticks();
  const numNeighbors = this.map.neighbors4(tile, this.nbuf);
  for (let i = 0; i < numNeighbors; i++) {
    const neighbor = this.nbuf[i];
    if (this.map.isWater(neighbor) || this.map.isImpassable(neighbor) ||
        this.map.ownerID(neighbor) !== this.targetSmallID) {
      continue;
    }
    this.attack.addBorderTile(neighbor);
    let numOwnedByMe = 0;
    const numInner = this.map.neighbors4(neighbor, this.nbuf2);
    for (let j = 0; j < numInner; j++) {
      if (this.map.ownerID(this.nbuf2[j]) === this.ownerSmallID) { numOwnedByMe++; }
    }
    let mag: number;
    switch (this.map.terrainType(neighbor)) {
      case TerrainType.Plains:   mag = 1;   break;
      case TerrainType.Highland: mag = 1.5; break;
      case TerrainType.Mountain: mag = 2;   break;
      default:                   mag = 0;   break;
    }
    const priority =
      (this.random.nextInt(0, 7) + 10) * (1 - numOwnedByMe * 0.5 + mag / 2) + tickNow;
    this.toConquer.enqueue(neighbor, priority);
  }
}
```

**Flow.**

- Land attack (`sourceTile === null`): initial frontier is every neighbour of every one of the attacker's border tiles that is owned by the target (`:135`). Boat attack: only neighbours of the landing tile (`:133`).
- Frontier is 4-connected (`neighbors4`, order N, S, W, E — `GameMap.ts:412-422`). Water and impassable never enter it.
- Each time a tile is conquered, its neighbours are enqueued (`:305`). A tile can be enqueued more than once; the dequeue-time revalidation (§4) discards stale entries.
- **Priority** (lower = sooner): base jitter `nextInt(0,7)+10` ∈ {10..16} (`PseudoRandom.nextInt` is max-exclusive, `src/core/PseudoRandom.ts:46-50`), scaled by `(1 − 0.5·numOwnedByMe + mag/2)`: tiles with more attacker-owned neighbours are taken first (pincers close), rougher terrain is taken later (Plains ×1.5 max, Highland ×1.75, Mountain ×2.0 before the ownership discount), plus `tickNow` so older frontier entries win over newer ones (a rolling wave, not a random flood).
- `this.random = new PseudoRandom(123)` (`:26`) — **fixed seed per attack**, so the jitter sequence is identical for every attack; deterministic across clients.

**Terrain here is a _priority_ effect only** — it affects _which_ tile is taken next, not what it costs. Cost/speed per terrain is in §5.

**Data-driven vs hardcoded.** All constants (1/1.5/2, 0.5, 10..16) hardcoded.

**Decision it drives.** Shape of the front: the wave prefers flat land and enveloped tiles.

---

### 4. Per-tick conquest budget (`AttackExecution.tick`, `tickFraction`)

**Where it lives**: `src/core/execution/AttackExecution.ts:235-320`. `borderSize` counter: `AttackImpl.ts:77-98`.

```ts
// AttackExecution.ts:268-319
const borderSize = this.attack.borderSize() + this.random.nextInt(0, 5);
// Each tile consumes a fraction of the tick; conquer until it is spent.
let tickBudget = 1;

while (tickBudget > 0) {
  if (troopCount < 1) {
    this.attack.delete();
    this.active = false;
    return;
  }
  if (this.toConquer.size() === 0) {
    this.refreshToConquer();
    this.retreat();
    return;
  }

  const tileToConquer = this.toConquer.dequeue();
  this.attack.removeBorderTile(tileToConquer);

  let onBorder = false;
  const numNeighbors = this.map.neighbors4(tileToConquer, this.nbuf);
  for (let i = 0; i < numNeighbors; i++) {
    if (this.map.ownerID(this.nbuf[i]) === this.ownerSmallID) {
      onBorder = true;
      break;
    }
  }
  if (this.map.ownerID(tileToConquer) !== this.targetSmallID || !onBorder) {
    continue;
  }
  if (!this.map.isLand(tileToConquer) || this.map.isImpassable(tileToConquer)) {
    continue;
  }
  this.addNeighbors(tileToConquer);
  const { attackerTroopLoss, defenderTroopLoss, tickFraction } = this.mg
    .config()
    .attackLogic(this.attackLogicInput(troopCount, tileToConquer, borderSize));
  tickBudget -= tickFraction;
  troopCount -= attackerTroopLoss;
  this.attack.setTroops(troopCount);
  if (targetPlayer) {
    targetPlayer.removeTroops(defenderTroopLoss);
  }
  this._owner.conquer(tileToConquer);
  this.handleDeadDefender();
}
```

**Flow, per tick (100 ms — `Config.msPerTick()` `Config.ts:346-348`):**

1. Guards: retreat states (§11), `attack.isActive()`, new alliance since start → auto-retreat with no malus (`:262-266`).
2. `borderSize = attack.borderSize() + nextInt(0,5)` → border count plus 0–4 jitter, **fixed for this tick**.
3. Budget = 1.0. Loop: pop the min-priority tile, drop it if it is no longer target-owned, no longer adjacent to us, water or impassable (stale entries cost nothing). Otherwise call `attackLogic`, subtract `tickFraction` from the budget, apply losses, conquer. The loop runs until the budget goes ≤ 0, so a tile costing 0.02 means ~50 tiles this tick.
4. `attack.setTroops` clamps at 0 (`AttackImpl.ts:35-37`). Attack dies when `troopCount < 1`.
5. Frontier empty → `refreshToConquer()` then `retreat()` **with no malus** (troops return, `:279-283`).
6. `handleDeadDefender` (`:425-459`): once the target has `< 100` tiles, `mg.conquerPlayer(owner, target)` and the remainder is swept in up to 100 passes (tiles adjacent to us go to us; enclaves go to any hostile neighbour).

**`conquer`** (`src/core/game/GameImpl.ts:748-770`) rejects water/impassable, moves the tile between `_tiles`/`_borderTiles` sets, sets the owner id, updates borders, **clears fallout on the tile** (`:768`), and records the tile update for the client.

**Data-driven vs hardcoded.** Budget of 1 per tick and border jitter 0–4 hardcoded.

**Decision it drives.** Speed is _border-normalised_: `tickFraction ∝ 1/borderSize`, so the number of tiles taken per tick scales with the length of the front — a wide front conquers proportionally more tiles per tick, but the same _fraction_ of its front.

---

### 5. Per-tile formula (`Config.attackLogic`)

**Where it lives**: `src/core/configuration/Config.ts:843-934`. Inputs/outputs `:72-102`. Tunables `:109-133`. Helpers `:139-167`. Input gathering: `AttackExecution.ts:322-364`. Math helpers: `within` `src/core/Util.ts:39-41`, `sigmoid` `:461-467`, deterministic `log`/`exp` from `src/core/DetMath.ts`.

#### 5.1 Tunables (verbatim, `Config.ts:109-133`)

```ts
const LARGE_TERRITORY_MIDPOINT = 300_000;
const LARGE_TERRITORY_STEEPNESS = 2.5;
// Floors: a huge attacker's bonus bottoms at 0.3x (losses; speed uses the
// deeper LARGE_ATTACKER_SPEED_DEPTH below), a huge defender's at 0.7x.
const LARGE_ATTACKER_DEPTH = 0.7;
const LARGE_DEFENDER_DEPTH = 0.3;
const BOT_DEFENDER_LOSS_MULT = 0.7;
const TERRA_NULLIUS_COST_SCALE = 2000;
const TERRA_NULLIUS_MIN_COST = 5;
const TERRA_NULLIUS_MAX_COST = 100;
// Attacker loss = mag * clampedRatio * (BASE * largeAttackerBonus + DENSITY * troopsPerTile).
const ATTACKER_LOSS_BASE = 0.463;
const ATTACKER_LOSS_PER_DENSITY = 0.0039;
// Speed divisor: 7.5 / 0.965, absorbing the same sigmoid tail.
const SPEED_COST_DIVISOR = 7.77;
const LARGE_ATTACKER_SPEED_DEPTH = 0.73;
```

#### 5.2 Helpers

```ts
// Config.ts:139-149
function largeTerritoryBonus(numTiles: number, depth: number): number {
  return (
    1 -
    depth *
      sigmoid(
        log(numTiles),
        LARGE_TERRITORY_STEEPNESS,
        log(LARGE_TERRITORY_MIDPOINT),
      )
  );
}
// Util.ts:461-467
export function sigmoid(value, decayRate, midpoint) {
  return 1 / (1 + exp(-decayRate * (value - midpoint)));
}
// Util.ts:39-41
export function within(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
```

Closed form: `sigmoid(log n, 2.5, log 300000) = 1 / (1 + (300000 / n)^2.5)`. So:

| numTiles  | sigmoid | attacker loss bonus (depth 0.7) | attacker speed bonus (0.73) | defender bonus (0.3) |
| --------- | ------- | ------------------------------- | --------------------------- | -------------------- |
| 1 000     | ≈ 6e-7  | 1.000                           | 1.000                       | 1.000                |
| 20 000    | 0.00115 | 0.9992                          | 0.9992                      | 0.9997               |
| 100 000   | 0.0605  | 0.958                           | 0.956                       | 0.982                |
| 300 000   | 0.5     | 0.65                            | 0.635                       | 0.85                 |
| 1 000 000 | 0.953   | 0.333                           | 0.304                       | 0.714                |
| ∞         | 1       | 0.30                            | 0.27                        | 0.70                 |

```ts
// Config.ts:151-167
function terrainAttackBase(terrain: TerrainType): {
  mag: number;
  tileCost: number;
} {
  switch (terrain) {
    case TerrainType.Plains:
      return { mag: 80, tileCost: 16.5 };
    case TerrainType.Highland:
      return { mag: 100, tileCost: 20 };
    case TerrainType.Mountain:
      return { mag: 120, tileCost: 25 };
    case TerrainType.Impassable:
      throw new Error(`impassable terrain cannot be attacked`);
    default:
      throw new Error(`terrain type ${terrain} not supported`);
  }
}
```

#### 5.3 The function (verbatim, `Config.ts:843-934`)

```ts
attackLogic(input: AttackLogicInput): AttackLogicResult {
  const { attackTroops, attacker, defender } = input;
  let { mag, tileCost } = terrainAttackBase(input.terrain);

  if (defender !== null && input.defenderHasDefensePost) {
    mag *= this.defensePostDefenseBonus();      // 5
    tileCost *= this.defensePostSpeedBonus();   // 3
  }
  if (input.falloutRatio !== null) {
    const fallout = this.falloutDefenseModifier(input.falloutRatio);  // 5 - ratio*2
    mag *= fallout;
    tileCost *= fallout;
  }

  if (defender === null) {
    const tickBudget = input.borderSize * 2;
    return {
      attackerTroopLoss: mag / (attacker.type === PlayerType.Bot ? 10 : 5),
      defenderTroopLoss: 0,
      tickFraction:
        within((TERRA_NULLIUS_COST_SCALE * tileCost) / attackTroops,
               TERRA_NULLIUS_MIN_COST, TERRA_NULLIUS_MAX_COST) / tickBudget,
    };
  }

  if (defender.isDisconnectedTeammate) {
    // No troop loss if defender is disconnected and on same team
    mag = 0;
  }
  if ((attacker.type === PlayerType.Human || attacker.type === PlayerType.Nation) &&
      defender.type === PlayerType.Bot) {
    mag *= BOT_DEFENDER_LOSS_MULT;   // 0.7
  }

  const largeAttackerBonus = largeTerritoryBonus(attacker.numTiles, LARGE_ATTACKER_DEPTH);
  const largeDefenderBonus = largeTerritoryBonus(defender.numTiles, LARGE_DEFENDER_DEPTH);

  const traitorLossMod = defender.isTraitor ? this.traitorDefenseDebuff() : 1;  // 0.5
  const traitorCostMod = defender.isTraitor ? this.traitorSpeedDebuff() : 1;    // 0.8

  // Defender loses its average troops-per-tile.
  const defenderTroopLoss = defender.troops / defender.numTiles;

  const troopRatio = defender.troops / attackTroops;
  const attackerTroopLoss =
    mag * traitorLossMod * within(troopRatio, 0.6, 2) *
    (ATTACKER_LOSS_BASE * largeAttackerBonus * largeDefenderBonus +
     ATTACKER_LOSS_PER_DENSITY * defenderTroopLoss);

  const speedCost =
    (within(troopRatio, 0.82, 7.5) * within(troopRatio / 20, 1, 50)) / SPEED_COST_DIVISOR;
  const largeAttackerSpeedBonus = largeTerritoryBonus(attacker.numTiles, LARGE_ATTACKER_SPEED_DEPTH);
  return {
    attackerTroopLoss,
    defenderTroopLoss,
    tickFraction:
      (speedCost * tileCost * largeAttackerSpeedBonus * largeDefenderBonus * traitorCostMod) /
      input.borderSize,
  };
}
```

#### 5.4 Input gathering (`AttackExecution.ts:322-364`)

```ts
const defenderHasDefensePost =
  defender !== null &&
  this.mg.hasUnitNearby(
    tile,
    this.mg.config().defensePostRange(),
    UnitType.DefensePost,
    defender.id(),
  );
return {
  terrain: this.map.terrainType(tile),
  attackTroops,
  attacker: { type: this._owner.type(), numTiles: this._owner.numTilesOwned() },
  defender:
    defender === null
      ? null
      : {
          type: defender.type(),
          numTiles: defender.numTilesOwned(),
          troops: defender.troops(),
          isTraitor: defender.isTraitor(),
          isDisconnectedTeammate:
            defender.isDisconnected() && this._owner.isOnSameTeam(defender),
        },
  defenderHasDefensePost,
  falloutRatio: this.mg.hasFallout(tile)
    ? this.mg.numTilesWithFallout() / this.mg.numLandTiles()
    : null,
  borderSize,
};
```

Note `attackTroops` is the **live** remaining stack (`troopCount` decremented inside the tick loop), and `defender.troops`/`numTiles` are re-read per tile, so both ratios drift within a tick.

#### 5.5 Plain-English summary of player-vs-player

- **Defender loss per tile** = `defender.troops / defender.numTiles` (average density). Independent of terrain, posts, anything.
- **Attacker loss per tile** = `mag × traitor(0.5|1) × clamp(defTroops/attackTroops, 0.6, 2) × (0.463 × attackerSizeBonus × defenderSizeBonus + 0.0039 × defenderDensity)`, where `mag` = 80/100/120 by terrain, ×5 under a defense post, ×(5−2·falloutRatio) on fallout, ×0.7 if a human/nation hits a bot, 0 if the defender is a disconnected teammate.
- **Tile speed cost** (fraction of the tick) = `clamp(ratio, 0.82, 7.5) × clamp(ratio/20, 1, 50) / 7.77 × tileCost × attackerSpeedBonus × defenderSizeBonus × traitor(0.8|1) / borderSize`, `tileCost` = 16.5/20/25 by terrain, ×3 under a post, ×(5−2·falloutRatio) on fallout.

#### 5.6 Worked example (matches golden snapshot `tests/__snapshots__/AttackLogicGolden.test.ts.snap:1625-1628`)

Plains, attacker 20 000 tiles, defender 20 000 tiles / 100 000 troops, attack 100 000, border 100:

- bonuses: attacker loss 0.99920, defender 0.99966, attacker speed 0.99916
- defenderLoss = 100000/20000 = **5**
- attackerLoss = 80 × 1 × 1 × (0.463×0.99920×0.99966 + 0.0039×5) = 80 × 0.48196 = **38.56**
- speedCost = (1 × 1)/7.77 = 0.12870; tickFraction = 0.12870 × 16.5 × 0.99916 × 0.99966 / 100 = **0.02121** → ≈ 47 tiles per tick ≈ 470 tiles/s at parity on a 100-tile front. Attacker pays ~7.7× the defender per tile at parity.

Other pinned values (same snapshot, `:1640-1674`): defense post → loss 192.79 (×5), tickFraction 0.0636 (×3); traitor → 19.28 / 0.01697; fallout 100 % → 115.67 / 0.0636 (×3 both); human-vs-bot → 26.99; disconnected teammate → 0 loss; Mountain + post + fallout 0.5 + traitor stacked → 578.36 / 0.3085.

#### 5.7 Terra nullius branch

- Attacker loss per tile = `mag/5` (human/nation) or `mag/10` (bot): Plains 16 / 8, Highland 20 / 10, Mountain 24 / 12 — **flat, independent of stack size**.
- Speed: `cost = clamp(2000 × tileCost / attackTroops, 5, 100)`, `tickFraction = cost / (2 × borderSize)`. Plains with 1 000 troops, border 100: cost 33 → 0.165 (≈ 6 tiles/tick). With ≥ 6 600 troops on plains the cost floors at 5 → `2.5/borderSize` → ~40 % of the front per tick. With ≤ 330 troops it caps at 100 → `50/borderSize`.
- Pinned at snapshot `:195-199` (`terraNullius border=100`: loss 16, fraction 0.165).

**Data-driven vs hardcoded.** Everything is a module-level `const` or a literal in `Config.ts`; **nothing is read from `GameConfig` (the lobby settings) or from the map**. The only runtime inputs are the ones listed in `AttackLogicInput`.

**Decision it drives.** Whether an attack is worth launching (loss ratio), how fast it lands (tickFraction), whether a defender's density makes it a wall (0.0039 × density term: a 1 000-troop/tile turtle adds 3.9 to the 0.463 base — 8× bloodier).

---

### 6. Terrain modifiers (combat)

**Where**: `terrainAttackBase` `Config.ts:151-167`; priority weights `AttackExecution.ts:401-415`; classification `GameMap.ts:377-387`.

| Terrain     | magnitude range | `mag` (loss)                  | `tileCost` (speed) | frontier priority weight |
| ----------- | --------------- | ----------------------------- | ------------------ | ------------------------ |
| Plains      | 0–9             | 80                            | 16.5               | ×1.0 → (1 + 0.5)         |
| Highland    | 10–19           | 100                           | 20                 | ×1.5 → (1 + 0.75)        |
| Mountain    | 20–30           | 120                           | 25                 | ×2 → (1 + 1.0)           |
| Impassable  | 31              | throws                        | throws             | never enqueued           |
| Ocean/water | —               | never reached (`isLand` gate) | —                  | never enqueued           |

Relative to plains: Highland costs +25 % losses and +21 % time; Mountain +50 % losses and +52 % time. **Magnitude within a band is ignored** — a magnitude-10 hill and a magnitude-19 hill are identical to the attack formula. There is a legacy `GameMap.cost()` (`GameMap.ts:371-373`: `magnitude < 10 ? 2 : 1`) that **no code in `src/core` calls**.

**Data-driven vs hardcoded.** Three hardcoded tuples. Terrain _class_ comes from the map (§14).

---

### 7. Defense posts

**Where**: range `Config.ts:356-358` (30 tiles, Euclidean), loss bonus `:360-362` (×5), speed bonus `:364-366` (×3); unit cost `:609-617`; lookup `AttackExecution.ts:332-339` → `GameImpl.ts:1107-1121` → `UnitGrid.ts:227-257` (`unitIsInRange` `:204-224`); the (dormant) shell behaviour `src/core/execution/DefensePostExecution.ts`.

```ts
// Config.ts:356-366
defensePostRange(): number { return 30; }
defensePostDefenseBonus(): number { return 5; }
defensePostSpeedBonus(): number { return 3; }
// Config.ts:609-617
case UnitType.DefensePost:
  info = {
    cost: this.costWrapper((numUnits: number) => Math.min(250_000, (numUnits + 1) * 50_000), UnitType.DefensePost),
    constructionDuration: this.instantBuild() ? 0 : 5 * 10,
  };
```

**Flow.** For every tile conquered, `hasUnitNearby(tile, 30, DefensePost, defender.id())` scans the unit grid for an **active, not-under-construction** post owned by the _defender_ within `dist² ≤ 900`. If found: `mag ×= 5` and `tileCost ×= 3`. Boolean — two overlapping posts give no extra bonus. Posts only matter when there is a player defender (`defender !== null` gate). Cost escalates 50k, 100k, 150k, 200k, then caps at 250k gold; 5 s build.

`DefensePostExecution.tick` (`:41-99`) is effectively a no-op: the ship-targeting block is commented out (`:56-98`), so posts currently **do not shoot**; `defensePostShellAttackRate()`=100 and `defensePostTargettingRange()`=75 (`Config.ts:1231-1241`) are unused by the sim.

There is a `DEFENSE_BONUS_BIT` (bit 14) in the tile-state `Uint16Array` (`GameMap.ts:137`, `:350-360`) with `hasDefenseBonus`/`setDefenseBonus`, **but no code sets it** (grep across `src` finds only the GameMap definitions). The renderer's tile-state layout documents it; it is a dead hook you could reuse for a per-tile "in supply / fortified" flag without changing the wire format.

**Decision it drives.** Where to place posts (30-tile radius from the border) and, for the attacker, whether to route around them (5× losses, 3× slower is the harshest single modifier in the game).

---

### 8. Large-territory scaling

Covered numerically in §5.2. Semantics (`Config.ts:883-892`, `:919-922`):

- Attacker's own size **reduces attacker losses** (to 0.3×) and **reduces tile cost** (to 0.27×) — big empires push cheaper and faster.
- Defender's size **reduces attacker losses** (to 0.7×) and **reduces tile cost** (to 0.7×) — big empires are also easier to bite into.
- Both are logistic in `log(numTiles)`, midpoint 300 000 tiles, steepness 2.5. Below ~50 000 tiles the effect is < 1 %.
- The two large-attacker depths differ (0.7 losses / 0.73 speed) — the comment at `:129-132` explains the ~18/20/25 % "overwhelming push" speed-up combined with the 0.82 ratio floor.

**Data-driven vs hardcoded.** Hardcoded constants. **Decision.** Late-game anti-stall: giants cannot turtle.

---

### 9. Traitor / teammate / bot / difficulty modifiers

**Traitor** (`Config.ts:266-274`; marked in `GameImpl.ts:836` when an alliance is broken; expiry `PlayerImpl.ts:851-861`):

```ts
traitorDefenseDebuff(): number { return 0.5; }
traitorSpeedDebuff():   number { return 0.8; }
traitorDuration():      number { return 30 * 10; } // 30 seconds
```

A traitor _defender_ halves attacker losses and is 20 % faster to conquer for 300 ticks. Being a traitor gives no penalty as an _attacker_.

**Disconnected teammate defender** (`Config.ts:871-874`): `mag = 0` — teammates absorb a disconnected ally's land at zero cost (speed unchanged).

**Bot** (`Config.ts:875-881`, `:860`, `:956-962`): human/nation attacking a bot → attacker losses ×0.7. Bot attacking terra nullius → losses ×½ (`mag/10` instead of `mag/5`). Bot default commitment 1/20 instead of 1/5. Bots ignore PvP immunity as attackers (§13).

**Difficulty**: only touches relations (§2) and bot/nation troop pools (`Config.ts:964-1017`), not the per-tile formula.

---

### 10. Fallout modifier

**Where**: `Config.ts:341-345`, applied at `:851-855`; input at `AttackExecution.ts:359-361`; fallout is set by nukes via `GameImpl.queueWaterConversion` `:255-264` / `setFallout` `:230-240` (only on unowned tiles) and cleared on conquest `:768`.

```ts
falloutDefenseModifier(falloutRatio: number): number {
  // So defense modifier is between [5, 2.5]
  return 5 - falloutRatio * 2;
}
```

`falloutRatio = numTilesWithFallout / numLandTiles` (map-wide, not local). A fallout tile costs 5× losses and 5× time when almost nothing is irradiated, easing to 3× (at ratio 1, `5 − 2 = 3`; the comment's "2.5" is stale). Fallout can only exist on **unowned** tiles, so this branch only fires when conquering terra nullius or when a defender's tile was nuked (nukes relinquish tiles first). Note the terra-nullius branch applies it to both `mag` and `tileCost` **before** the `/5` and the `2000·tileCost/attackTroops` clamp.

---

### 11. Ending an attack; retreat; what returns

**Where**: `AttackExecution.ts:201-233` (`retreat`), `:243-266` (state checks), `:21` (`malusForRetreat = 25`); `src/core/execution/RetreatExecution.ts` (`cancelDelay = 20`, `:3`); `AttackImpl.ts:61-75`; intent `Schemas.ts:704-707`; wiring `ExecutionManager.ts:68-69`.

```ts
// RetreatExecution.ts:20-30
tick(ticks: number): void {
  if (!this.retreatOrdered) { this.player.orderRetreat(this.attackID); this.retreatOrdered = true; }
  if (this.mg.ticks() >= this.startTick + cancelDelay) { this.player.executeRetreat(this.attackID); this.active = false; }
}
```

```ts
// AttackExecution.ts:201-233
private retreat(malusPercent = 0) {
  const deaths = this.attack.troops() * (malusPercent / 100);
  if (deaths) { this.mg.displayMessage("events_display.attack_cancelled_retreat", MessageType.ATTACK_CANCELLED, this._owner.id(), undefined, { troops: renderTroops(deaths) }); }
  if (this.removeTroops === false && this.sourceTile === null) {
    this.attack.setTroops(this.attack.troops() - (this.startTroops ?? 0));
  }
  const survivors = this.attack.troops() - deaths;
  this._owner.addTroops(survivors);
  this.attack.delete();
  this.active = false;
  if (this.attack.retreated()) { this.mg.stats().attackCancel(this._owner, this.target, survivors); }
}
```

**Ways an attack ends**

1. **Player cancel** (`cancel_attack` intent): tick 0 → `orderRetreat` sets `_retreating`; the attack **freezes** (`tick` returns early at `:253-255`: no conquest, no losses) for 20 ticks (2 s); then `executeRetreat` sets `_retreated` and the next tick calls `retreat(25)` against a player target or `retreat(0)` against terra nullius (`:243-251`). **25 % of the remaining stack dies; 75 % returns** to `owner.troops()`.
2. **Frontier exhausted** (`:279-283`): `retreat()` with **0 % malus** — full remaining stack returns. This is how a completed conquest returns its survivors.
3. **Troops < 1** (`:273-277`): attack deleted; nothing returns.
4. **Alliance formed mid-attack** (`:262-266`): `retreat()` at 0 %.
5. **Cancelled out by an opposing attack** at init (`:141-154`) — troops on both sides annihilate 1:1; the survivor stack keeps fighting.
6. **`attack.isActive()` false** (deleted externally, e.g. by a nuke reducing troops — `tests/Attack.test.ts:90`) → execution stops.

**Boat-landed attacks** (`sourceTile !== null`, `removeTroops = false`): troops were removed at departure, so the `startTroops` subtraction is skipped and the whole surviving stack returns on retreat (comment `:216-220`).

**Wire state visible to the client** — `AttackUpdate` (`src/core/game/GameUpdates.ts:208-214`): `{ attackerID, targetID, troops, id, retreating }`. **No per-tile cost, loss rate, or terrain info is sent.** `Attack.clusteredPositions()` (`AttackImpl.ts:100-184`) gives up to 2 front-line label positions (clusters ≥ 30 tiles).

---

### 12. Transports / amphibious attacks

**Where**: `src/core/execution/TransportShipExecution.ts` (whole file), `src/core/game/TransportShipUtils.ts:5-42`, `src/core/execution/BoatRetreatExecution.ts:12-28`, `Config.ts:811-816` (`boatMaxNumber`), `:936-938` (`boatAttackAmount`), intents `Schemas.ts:630-636`, `:709-712`; client `ClientGameRunner.ts:1453-1461`.

```ts
// Config.ts:811-816, 936-938
boatMaxNumber(): number { if (this.isUnitDisabled(UnitType.TransportShip)) { return 0; } return 3; }
boatAttackAmount(attacker, defender): number { return Math.floor(attacker.troops() / 5); }
// TransportShipExecution.ts:19, 25
const malusForRetreat = 25;
private ticksPerMove = 1;   // TODO: make this configurable
```

**Flow (`init` `:55-167`)**

1. Max **3** transports in flight per player (or 0 if the unit is disabled in the lobby); else `no_boats_available` message.
2. Same friendly/immunity gates as land (`canAttackPlayer`). Alliance requests from the target are rejected.
3. `troops = min(intent.troops ?? troops/5, attacker.troops())`.
4. Landing tile `dst = targetTransportTile()` (`TransportShipUtils.ts:33-42`): `SpatialQuery.closestReachableShore(owner(tile), attacker, tile)` — the nearest shore tile of the _target's_ territory reachable by water from the attacker.
5. Launch tile `src = attacker.canBuild(TransportShip, dst)` → `canBuildTransportShip` (`:5-31`) → `closestShoreByWater(player, dst)`.
6. The boat unit is built with `{troops, targetTile}` (troops leave the owner's pool via `buildUnit`), a full water path is computed (`WaterPathFinder`), and a motion plan is recorded; the target gets `NAVAL_INVASION_INBOUND`.

**Flow (`tick` `:169-319`)**, one step per tick:

- If `dst` has become water (nuked) → auto-retreat (`:202-211`).
- **Retreat** (`cancel_boat` intent → `BoatRetreatExecution` sets `isRetreating`): `retreatDst = attacker.bestTransportShipSpawn(boat.tile())`; on arrival at own land (`:239-260`): `deaths = troops × 25/100`, survivors returned. No retreat destination → all troops returned, boat deleted (no malus, `:219-227`).
- **Arrival on enemy/unclaimed shore** (`:261-282`): `attacker.conquer(dst)` unconditionally (the beachhead tile is free), then `new AttackExecution(boat.troops(), attacker, target.id(), dst, false)` — a land attack seeded from that one tile, `removeTroops=false`. If the target is friendly by then, troops just return.
- `NOT_FOUND` path (`:286-297`): troops returned, boat deleted, no malus.
- Disconnected-teammate capture (`:186-196`): a teammate can inherit the boat.

No per-tile combat happens at sea; defense posts do not shoot boats (§7). Warships can sink transports (outside this section).

---

### 13. Spawn immunity

**Where**: `Config.ts:168` (`DEFAULT_SPAWN_IMMUNITY_TICKS = 5 * 10`), `:314-324`; `GameImpl.ts:882-898`; `PlayerImpl.ts:1883-1902` (`isImmune`, `canAttackPlayer`), `:1601-1605` (nukes); lobby wiring `src/client/HostLobbyModal.ts:1388-1412`; spawn placement `src/core/execution/SpawnExecution.ts:47-185`, `src/core/execution/Util.ts:140-159`.

```ts
// Config.ts:314-324
spawnImmunityDuration(): Tick { return this._gameConfig.spawnImmunityDuration ?? DEFAULT_SPAWN_IMMUNITY_TICKS; }
nationSpawnImmunityDuration(): Tick { return DEFAULT_SPAWN_IMMUNITY_TICKS; }
hasExtendedSpawnImmunity(): boolean { return this.spawnImmunityDuration() > DEFAULT_SPAWN_IMMUNITY_TICKS; }
// GameImpl.ts:882-887
public isSpawnImmunityActive(): boolean {
  return this.inSpawnPhase() || this.ticksSinceStart() < this.config().spawnImmunityDuration();
}
// PlayerImpl.ts:1883-1902
public isImmune(): boolean {
  if (this.type() === PlayerType.Human) { return this.mg.isSpawnImmunityActive(); }
  if (this.type() === PlayerType.Nation) { return this.mg.isNationSpawnImmunityActive(); }
  return false;
}
public canAttackPlayer(player: Player, treatAFKFriendly = false): boolean {
  if (this.type() !== PlayerType.Human) {
    // Only human attackers respect PVP immunity
    return !this.isFriendly(player, treatAFKFriendly);
  }
  return !player.isImmune() && !this.isFriendly(player, treatAFKFriendly);
}
```

**Rules**

- Default 50 ticks (5 s) after the spawn phase ends; **data-driven** via `GameConfig.spawnImmunityDuration` (lobby host sets minutes → `minutes*60*10` ticks, `HostLobbyModal.ts:1388-1389`). Nations always get the 5 s default.
- Only **human attackers** are blocked; nations and bots attack humans freely during immunity (`tests/Attack.test.ts:561-590`). Bots are never immune.
- Applies to land attacks, boats (same `canAttackPlayer`) and nukes (`nukeSpawn` returns false while active, `PlayerImpl.ts:1603`). Terra nullius is never immune.
- Spawn footprint: `getSpawnTiles` = BFS within Euclidean radius 4 (centre-shifted) of the chosen tile, excluding owned/water/impassable (`Util.ts:145-148`). Random spawn: up to 1 000 tries, min-distance constraint relaxed after 750 (`SpawnExecution.ts:25-26`).
- `AttackExecution.activeDuringSpawnPhase()` is `false` (`:55-57`), so no attack ticks during the spawn phase at all.

---

### 14. The terrain model — exactly what exists in the data

**Where**: `src/core/game/GameMap.ts:108-138` (bit layout), `:211-250` (getters), `:377-387` (classification); `src/core/game/Game.ts:365-371` (`TerrainType`); `src/core/game/TerrainMapLoader.ts:235-251` (`genTerrainFromBin`), `:19-54` (manifest types).

#### 14.1 Per-tile storage

Two typed arrays per map, indexed by `ref = y*width + x`:

**`terrain: Uint8Array` — immutable except nukes (one byte per tile, straight from `map.bin`)**

| bit | meaning                                               | constant                |
| --- | ----------------------------------------------------- | ----------------------- |
| 7   | land (1) / water (0)                                  | `IS_LAND_BIT = 7`       |
| 6   | shoreline (land next to water, or water next to land) | `SHORELINE_BIT = 6`     |
| 5   | ocean (member of the largest water body)              | `OCEAN_BIT = 5`         |
| 0–4 | magnitude 0–31                                        | `MAGNITUDE_MASK = 0x1f` |

- Land magnitude = "elevation" 0–30; **31 = impassable** (`IMPASSABLE_MAGNITUDE = 31`, `:132`; a land tile with mag 31 is solid void: unownable, unattackable, un-nukable, blocks nuke trajectories).
- Water magnitude = Manhattan distance to nearest land ÷ 2, capped at 31 (render depth shading only).
- Only mutation: `setWater(ref)` writes `0` (lake, magnitude 0) when a nuke floods a tile (`:257-262`); `updateTile` on the client mirrors that (`:532-559`).

**`state: Uint16Array` — mutable game state**

| bits | meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| 0–11 | owner smallID (`PLAYER_ID_MASK = 0xfff`, 0 = terra nullius)      |
| 12   | unused                                                           |
| 13   | fallout (`FALLOUT_BIT`)                                          |
| 14   | defense bonus (`DEFENSE_BONUS_BIT`) — **defined, never written** |
| 15   | reserved                                                         |

#### 14.2 Classification (`GameMap.ts:377-387`)

```ts
terrainType(ref: TileRef): TerrainType {
  if (this.isLand(ref)) {
    const magnitude = this.magnitude(ref);
    if (magnitude >= GameMapImpl.IMPASSABLE_MAGNITUDE) return TerrainType.Impassable;
    if (magnitude < 10) return TerrainType.Plains;
    if (magnitude < 20) return TerrainType.Highland;
    return TerrainType.Mountain;
  }
  return TerrainType.Ocean;
}
```

`enum TerrainType { Plains, Highland, Mountain, Ocean, Impassable }` (`Game.ts:365-371`).

#### 14.3 What does and does not exist

| Concept                          | Exists in data?                                                                                                                 | Where                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Land / water                     | **yes**                                                                                                                         | bit 7                                                                                                        |
| Shore                            | **yes**                                                                                                                         | bit 6 (+ `isOceanShore` derived, `:223-234`)                                                                 |
| Ocean vs lake                    | **yes**                                                                                                                         | bit 5                                                                                                        |
| Elevation                        | **yes, 0–30 (5 bits)**, but the sim collapses it to 3 bands                                                                     | bits 0–4                                                                                                     |
| Impassable                       | **yes**                                                                                                                         | mag 31                                                                                                       |
| Forest                           | **no**                                                                                                                          | —                                                                                                            |
| Marsh / swamp                    | **no**                                                                                                                          | —                                                                                                            |
| Desert                           | **no**                                                                                                                          | —                                                                                                            |
| Urban                            | **no**                                                                                                                          | —                                                                                                            |
| Rivers                           | **no** as a type; a 1-tile-wide water strip is just "water (lake or ocean)" and is uncrossable by land attacks (`isWater` gate) | —                                                                                                            |
| Roads / rail                     | only as _units_ (`Railroad`, `TrainStation`), not terrain bits                                                                  | `src/core/game/Railroad.ts`, `RailNetworkImpl.ts`                                                            |
| Map "layers" (`manifest.layers`) | **render-only PNG overlays** (`MapLayer` `TerrainMapLoader.ts:42-54`: `id`, `placement: land                                    | water`, `nukeable`, `alpha`); loaded as `ImageBitmap` and handed to the renderer; **no sim code reads them** | `map-generator/README.md:178-188` |

The byte has **no spare bits** (8/8 used). Options for adding terrain classes: (a) sub-divide the 0–30 magnitude range (e.g. reserve magnitudes 25–30 for "marsh" — but they currently render as high mountain and the generator's blue→magnitude mapping would need a second channel); (b) use `state` bit 12 (free) and bit 14 (dead) for two boolean overlays; (c) add a second `Uint8Array` side-channel loaded from a new `terrain2.bin` (requires touching `genTerrainFromBin`, the worker transfer, `updateTile` packing which only has room for 8 terrain bits at bits 16–23 of a uint32, and the WebGL R16UI texture upload noted at `GameMap.ts:91-103`).

#### 14.4 File format

`resources/maps/<name>/map.bin` (+ `map4x.bin`, `map16x.bin`) is a raw `width*height` byte array, row-major, **no header**; dimensions and `num_land_tiles` come from `manifest.json` (`MapMetadata` `TerrainMapLoader.ts:19-23`; loader check `:239-243`). `numLandTiles` **excludes** impassable tiles (used as the denominator for fallout ratio and win-percentage).

---

### 15. How the Go map generator produces the bits

**Where**: `map-generator/map_generator.go:36-57` (types), `:93-105` (pixel table), `:140-163` (pixel loop), `:312-352` (`processShore`), `:355-400` (`processDistToLand`), `:404-425` (`setImpassableNeighborWaterDepth`, `deepMagnitude = 20`), `:458-540` (`processWater`: largest body → Ocean), `:577-627` (`removeSmallIslands`, `minIslandSize = 30`), `:628-676` (`packTerrain`).

Only the **blue channel and alpha** of the source PNG matter (red/green ignored except for the pure-black test):

```go
// map_generator.go:147-161
if alpha < 20 || blue == 106 {
    terrain[x][y] = Terrain{Type: Water}
} else if red == 0 && green == 0 && blue == 0 {
    terrain[x][y] = Terrain{Type: Impassable}          // #000
} else {
    terrain[x][y] = Terrain{Type: Land}
    mag := math.Min(200, math.Max(140, float64(blue))) - 140
    terrain[x][y].Magnitude = mag / 2                  // 0..30
}
```

| pixel                     | terrain    | magnitude                             |
| ------------------------- | ---------- | ------------------------------------- |
| alpha < 20 or blue == 106 | Water      | BFS distance to land (÷2 when packed) |
| #000000 (alpha ≥ 20)      | Impassable | 31                                    |
| blue < 140                | Plains     | 0                                     |
| blue 140–158              | Plains     | 0–9                                   |
| blue 159–178              | Highland   | 10–19                                 |
| blue 179–200              | Mountain   | 20–30                                 |
| blue > 200                | Mountain   | 30                                    |

```go
// map_generator.go:642-671
if tile.Type == Impassable { packedData[y*width+x] = 0b10011111; continue }
var packedByte byte = 0
if tile.Type == Land { packedByte |= 0b10000000; numLandTiles++ }
if tile.Shoreline    { packedByte |= 0b01000000 }
if tile.Ocean        { packedByte |= 0b00100000 }
if tile.Type == Land { packedByte |= byte(math.Min(math.Ceil(tile.Magnitude), 31)) }
else                 { packedByte |= byte(math.Min(math.Ceil(tile.Magnitude/2), 31)) }
```

Post-processing: islands/lakes < 30 tiles (15 at 4×) are removed (majority-neighbour fill); the largest water body becomes Ocean; shoreline bits set on both sides of a coast; water depth = BFS Manhattan distance from shoreline water; water beside impassable forced to depth 20. Then 4× and 16× minimaps (`createMiniMap`, priority Water > Impassable > Land). So **the generator has no notion of forest/marsh/desert/urban/river either** — adding one means a new colour key in this loop, a new bit or magnitude sub-range in `packTerrain`, and the matching decode in `GameMap.terrainType`.

---

### 16. Tests that pin this behaviour

- `tests/AttackLogicGolden.test.ts` (259 lines) — pure-formula snapshot: terrain × territory × troops grid, situational modifiers (post / fallout / traitor / bot / disconnected / stacking), ratio clamps, speed floor, large-territory sweep, terra nullius, border-size sweep, extremes, and `impassable terrain throws`. Snapshot at `tests/__snapshots__/AttackLogicGolden.test.ts.snap`. **Any change to §5 constants breaks this by design.**
- `tests/AttackScenarios.test.ts` (550 lines) — end-to-end on real maps with `UseRealAttackLogic`; 34 named scenarios (`:216-535`) e.g. `plains equal 50k vs 50k, attack 10k`, `plains defender with defense posts covering the whole border`, `world mountain region, 100k vs 100k, attack 20k`, `giant 1M vs 600k tiles, 8M vs 8M troops, attack 2M`. Metrics: ticks, tiles conquered, losses each side, per-second/per-tile rates. Snapshot `AttackScenarios.test.ts.snap`.
- `tests/Attack.test.ts` (725 lines) — nukes reduce attack/boat troops (`:90`, `:110`); **boat retreat 25 % penalty** (`:143`); alliance race conditions (`:177-347`); transport rejects alliance requests (`:349`); immunity matrix (`:395-635`): human blocked, nation/bot not, boats and nukes blocked, nation immunity separate; fractional troop duplication fix (`:640-725`).
- `tests/ImpassableTerrain.test.ts` (524 lines) — `isImpassable`/`terrainType`/`numLandTiles` semantics, `conquer` throws, attack never expands into impassable (`:254`), `canAttack` false (`:245-252`), nukes/MIRV fly over but do not destroy, `setWater` refuses, rail pathfinding avoids (`:235`).

---

### Gaps vs FightWars brief

#### G1. Supply lines / attrition far from City, Port or rail cluster — **built (Phase 5, brief §6.1)**

**What exists.** `SupplyNetwork` (`src/core/game/SupplyNetwork.ts`) holds one byte per tile: how many tiles you walk **through that tile's owner's own territory** to reach the nearest of that owner's supply sources. `255` (`SUPPLY_UNSUPPLIED`) means unknown or past the range, which the formulas treat the same as the range itself.

- **Sources** are the player's `spawnTile()` — its capital — plus every active City, Port and Factory it owns, seeded in that order. A player holding none of these has no field at all and fights everywhere at the full penalty.
- **Distance is walked, not measured.** A salient that loops back to within sight of its own capital is still as far from supply as the road home is long, and cutting the road strands everything past the cut. This is the whole difference between supply and a radius, and `tests/SupplyNetwork.test.ts` pins it with a U-shaped territory whose far end is 20 tiles from the capital and 60 tiles from supply.
- **Maintained two ways.** `onConquer` relaxes a newly taken tile to one more than the lowest of its owner's four neighbours (four array reads, from `GameImpl.conquer`), so an advance carries its own supply line forward with no sweep involved; `onRelinquish` drops a lost tile back to 255. The correcting sweep (`SupplyNetwork.tick`, called at the top of `GameImpl.executeNextTick`) re-floods each player from scratch, round-robin over `SUPPLY_REFRESH_PERIOD` = 60 ticks, because relaxation cannot see a distance get _shorter_ (a new city behind the front) or a source disappear. Two players skip the queue: one that has never been flooded (until then its whole territory reads unsupplied, which would tax the opening of every game), and one that has just gained or lost a City, Port or Factory (`onUnitChanged` from `GameImpl.addUnit` / `removeUnit`) — that is the change a player actually watches for.
- **A player's slot is skipped when nothing could have changed.** The field is a pure function of the player's tile set and unit list, and both are already versioned (`tileChangeVersion()`, `myUnitsVersion()`), so a player whose versions have not moved since its last flood provably has the right answer. This is what keeps the sweep from growing with the map: without it the cost is proportional to _claimed_ land, which by the late game is all of it.
- **The flood** is a level-order BFS in the map's fixed N/S/W/E order over `player.tiles()`, capped at `supplyMaxRange()`; frontier arrays are reused, so a sweep allocates nothing, and both full passes over the territory use `TileSet.forEach` rather than `for...of` (`tiles()` iterates through a generator).

**Measured cost** (world, 150 bots, instrumented — note the execution profiler cannot see this, because the sweep is not an `Execution` and its time lands in the profiler's unattributed remainder): 0.17 ms/tick cumulative at tick 1000, settling at **0.56 ms/tick by tick 8000**. The worst _single_ sweep is 13.7 ms, when one dominant player's whole territory is flooded in one tick — inside the 100 ms turn budget, but the shape to watch. If it ever matters, split one player's flood across ticks rather than shortening the period.

**Where it is charged.** `AttackLogicInput.supplyDistance` is gathered in `AttackExecution.attackLogicInput` as `supplyNetwork().frontDistance(tile, attackerSmallID)` — the tile being taken is still the defender's, so the reach is measured from the attacker's side of the border. `Config.attackLogic` applies `supplyPenalty(d)` to **both** `mag` and `tileCost` before the defense-post and fallout blocks, so it applies to the terra nullius branch too. `AttackExplanation.supplyDistance` / `supplyMod` carry it to the client tooltip.

**Attrition** on the standing stack is charged in `AttackExecution.tick` before the conquest loop, as `troops × supplyAttritionRate() × supplyOverExtension(d)`, using the supply distance of the last tile the attack costed (carried on the execution as `frontSupplyDistance`, 0 until the first tile). So a stranded push bleeds whether or not it is taking ground, and a retreat brings home less than it set out with.

**Tunables** (`Config`, all linear, + - \* / only, so no `DetMath` needed):

| Knob                    | Value | Meaning                                                                     |
| ----------------------- | ----- | --------------------------------------------------------------------------- |
| `supplyFreeRange()`     | 30    | Tiles of reach that cost nothing. Also the threshold for the rendered flag. |
| `supplyMaxRange()`      | 90    | Where the penalty and the attrition saturate; the flood stops here.         |
| `supplyMaxPenalty()`    | 1.5   | Multiplier on attacker loss and tile cost at saturation.                    |
| `supplyAttritionRate()` | 0.002 | Share of a stranded stack lost per tick at full over-extension.             |

Ranges are in tiles and are **not** scaled by map size, matching `defensePostRange()`. On a small map 30 tiles is most of a country and on the giant map it is a province; if that turns out to matter, scale them off `numLandTiles()` here rather than at the call sites.

**Per-tile "supplied" flag.** `GameMap` state **bit 12** (`isSupplied` / `setSupplied`) is set for tiles inside `supplyFreeRange` and cleared beyond it. The sweep writes `dist` directly and syncs the flag in one pass at the end — going through the flag setter during the flood would clear every tile and set most of them again, and each flip calls `recordTileUpdate`, putting a player's whole territory on the wire twice per cycle. The flag rides the existing R16UI tile-state texture, so the client has it with no new wire format.

**What is not done.** The map does not yet _shade_ unsupplied territory; only the attack tooltip shows the penalty (`attack_cost.factor.supply`, "Out of supply"). The client can tell supplied from not but not how far past the range a tile is, so `clientSupplyDistance` in `src/client/AttackCostEstimate.ts` quotes the saturated penalty beyond the flag — the worst case, never an understatement. Rail clusters and track tiles are **not** sources yet (see §03 7.4); only City, Port, Factory and the capital are.

#### G2. Terrain cost multipliers — **built for elevation (Phase 5, brief §6.2); new terrain classes deliberately not**

**What exists.**

- **The table.** `TERRAIN_COST` in `src/core/configuration/Config.ts` is the one place the simulation knows a number about plains, highland or mountain: `{ mag, tileCost, priority }` per band, 80/16.5/1, 100/20/1.5, 120/25/2. `Config.terrainAttackBase(terrain)` reads it and `Config.terrainPriorityWeight(terrain)` feeds the conquest heap in `AttackExecution.addNeighbors`, which used to carry its own copy of the weights.
- **Lobby multipliers.** `GameConfig.terrain` (`TerrainCostConfigSchema` in `src/core/Schemas.ts`) is an optional `{ plains, highland, mountain }` block of `{ loss, speed }` multipliers in 0.1–10, applied to `mag` and `tileCost`. Absent means 1, and multiplying by exactly 1 is exact in IEEE arithmetic, so a lobby that spells out the defaults produces the same bits as one that says nothing — `tests/TerrainCostConfig.test.ts` pins that with `toEqual`, because two lobbies with the same settings must not desync from each other.
- **Elevation inside the band.** The map stores 0–30 and the bands collapse it to three steps; three linear curves put it back. `AttackLogicInput` gained `elevation` (the target tile's magnitude) and `climb` (that minus the highest magnitude the attacker holds beside it — `AttackExecution.vantageElevation`, four neighbour reads; the target's own height when the attacker holds no neighbour, so an amphibious landing is a flat step). In `attackLogic`, after supply and before the defense-post block so terra nullius pays too:

  | curve                                                                         | tunable                      | value | effect                                                                                                                        |
  | ----------------------------------------------------------------------------- | ---------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
  | `terrainHeightModifier(elevation)` = 1 + slope·e/30                           | `terrainHeightSlope()`       | 0.25  | a mag-30 tile costs 25 % over its band; mountain-vs-plains ratio 1.5 → ~1.9                                                   |
  | `terrainClimbModifier(climb)` = max(0.5, 1 + slope·c/30)                      | `terrainClimbSlope()`        | 1.0   | the 99th-percentile adjacent climb on the world map is +12, i.e. +40 %; symmetric downhill, floored so a plunge is never free |
  | `terrainHighGroundModifier(elevation)` = 1 − depth·e/30, on **defender** loss | `terrainHighGroundDefence()` | 0.3   | a defender at mag 30 loses 30 % fewer troops per tile                                                                         |

  Height and climb multiply `mag` and `tileCost` in two separate statements so the explanation can name them; `tests/AttackBreakdown.test.ts` recomposes them in that exact order. `AttackExplanation` carries `elevation`, `heightMod`, `climb`, `climbMod`, `highGroundMod`; the client tooltip gathers the same inputs (`clientVantage` in `src/client/AttackCostEstimate.ts`) and shows rows only past a 2 % threshold, because with elevation on every tile almost every tile carries a ×1.01 somewhere.

**Why adjacent climb is enough.** Measured on the world map (651 569 land tiles): 34 % plains, 38 % highland, 28 % mountain; adjacent tiles differ by 0 in 41 % of pairs, by 1 in 27 %, by 2 in 11 %, and the 99th percentile is 12. A single tile's climb is small, but an attack pays it on every tile of an ascent and is paid it back on every tile of a descent, which is what makes a ridgeline worth holding and a valley the way in.

**Balance record** (`AttackScenarios` snapshot, 48 scenarios, HEAD → this change): median −3.2 % tiles, +3.9 % attacker loss per tile, −6.7 % defender loss per tile. By ground: plains fights −3.8 % tiles, the world highland/mountain region −9.6 % at +10.6 %, the world mountain region −10.0 % at +11.1 % with defenders losing 23 % fewer per tile. A gradient, not a cliff.

**What is deliberately not done, and why.**

- **Forest, marsh, desert, urban.** The byte has no spare bits (§14.3), so a new class costs either a magnitude sub-range — which would destroy the very elevation data the curves above now read — or a second per-tile channel through `genTerrainFromBin`, the worker transfer, `updateTile`'s 8-bit terrain slot and the R16UI upload. Either is a week of plumbing for classes that would then cover zero tiles: the generator reads only the blue channel, and no source PNG under `map-generator/assets/maps` has a forest painted in it. The content does not exist, and inventing it across 121 maps is an art decision the owner should make, not a simulation session. When it is made: new colour keys in `map_generator.go:147-161`, a decode in `GameMap.terrainType`, rows in `TERRAIN_COST`, and the lobby schema already has the shape.
- **River crossings.** A one-tile water strip is water, and `addNeighbors` will not step onto water; making an attack cross narrow water at a cost changes conquest topology (transport ships, `sharesBorderWith`, border rendering, and every map that uses thin water as a wall by design). Real feature, separate item.
- **Ranges do not scale with map size**, same as `defensePostRange` and supply.

#### G3. Tooltip breakdown of attack cost

**Not surfaced anywhere.** What the client has:

- `PlayerActions.canAttack: boolean` (`Game.ts:944-950`) — yes/no only.
- `AttackUpdate {attackerID, targetID, troops, id, retreating}` (`GameUpdates.ts:208-214`) — live stack size only; `AttacksDisplay.ts` renders troops and a retreat/retaliate button.
- ControlPanel shows `ratio %` and `troops × ratio` (`ControlPanel.ts:580-582`).
- `attackLogic`, `terrainAttackBase`, `tileCost` are **not referenced in `src/client` at all**.

To build a pre-attack tooltip: `attackLogic` is pure and `Config` is available on the client (`GameView` holds `_config`, `src/client/view/GameView.ts:1132-1141` already calls it), so the client can call `config().attackLogic({...})` with `terrain = gameView.terrainType(tile)`, the hovered owner's `troops()`/`numTilesOwned()`, `isTraitor()`, a defense-post proximity check via the client-side `UnitGrid`, `hasFallout(tile)` + `numTilesWithFallout()/numLandTiles()`, and an estimated `borderSize` (e.g. count of my border tiles adjacent to the target — `sharesBorderWith` logic at `PlayerImpl.ts:554-566`). Show `attackerLoss / defenderLoss` per tile and `1/tickFraction` tiles-per-tick as the estimate, with each multiplier listed (terrain ×, post ×5/×3, fallout ×, traitor ×, size bonuses). A live "cost so far" needs new fields on `AttackUpdate` (e.g. `startTroops`, `tilesConquered`) which `AttackImpl` does not track today (only `_troops`, `_borderSize`).

---

## 03 — Structures, units, construction, rail network, deletion, auto-upgrade

Repo: `C:\Users\disbo\dev\fightwars` (read-only audit). All paths below are relative to that root. Tick = 100 ms (`Config.msPerTick()` `src/core/configuration/Config.ts:346-348`), so ticks ÷ 10 = seconds.

There is exactly one config class: `export class Config` at `src/core/configuration/Config.ts:247`. There is no `DefaultConfig`/`DevConfig` split; every number in this document is hardcoded in that class unless flagged **data-driven** (read from `GameConfig` on the wire).

Conventions used in the tables:

- `n` = the count the cost curve scales on. It is computed by `costWrapper` (`Config.ts:716-735`) as `Σ over listed types of min(player.unitsOwned(type), player.unitsConstructed(type))` plus the optional `extraUnits` argument. `unitsOwned` (`src/core/game/PlayerImpl.ts:532-547`) counts an under-construction unit as 1 and a completed unit as its **level**; `unitsConstructed` (`PlayerImpl.ts:506-508`) is a monotonically increasing counter bumped on every `buildUnit` and every `upgradeUnit` (`PlayerImpl.ts:1390`, `1476`) and never decremented. Net effect: losing a structure (captured/destroyed/deleted) lowers `n` back down, so the price of the next one falls.
- Infinite-gold (`GameConfig.infiniteGold`, or `hostCheats.infiniteGold` for the lobby creator) short-circuits every `costWrapper` and the MIRV cost to `0n` **for humans only** (`Config.ts:721-726`, `582-587`, `665-669`). Nations/bots always pay.
- "Structure" = member of the `Structures` group (`src/core/game/Game.ts:233-240`): City, DefensePost, SAMLauncher, MissileSilo, Port, Factory. `ConstructionExecution.isStructure` (`src/core/execution/ConstructionExecution.ts:161-173`) re-lists the same six by hand.

### 1. Per-UnitType table

| UnitType (enum string, `Game.ts:194-211`) | Cost formula (verbatim from `Config.unitInfo`, `Config.ts:525-663`)                                                          | `n` scales on                                                                                                                                                               | Cap               | Build duration                                                                                     | Upgradeable                                                                                                                                                                                                                                                                                                                                                                                                                     | Placement rule (`PlayerImpl.canSpawnUnitType` `1561-1599`)                                                                                                                                                                                                                                                                                   | Kind                                                                                                                                                                                                                                                          | Execution class                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `City` ("City")                           | `Math.min(1_000_000, pow2(numUnits) * 125_000)` `Config.ts:634`                                                              | City only                                                                                                                                                                   | 1,000,000 (n ≥ 3) | `2 * 10` = 20 ticks = **2 s** (`Config.ts:637`; 0 if `instantBuild`)                               | **Yes**, `upgradable: true` `Config.ts:638`. No max level anywhere in `src/core` (grep `maxLevel                                                                                                                                                                                                                                                                                                                                | MAX_LEVEL`empty). Upgrade cost = same formula at current`n` (`PlayerImpl.upgradeUnit` `1472-1477`). Each level adds `cityTroopIncrease()`= 250,000 to`maxTroops` (`Config.ts:337-339`, `985-995`)                                                                                                                                            | `landBasedStructureSpawn` (`1699-1708`): first tile of `validStructureSpawnTiles(tile)` — own territory, Euclidean radius 15 flood, ≥ `structureMinDist()` = 15 from ANY structure of ANY owner incl. under-construction (`1710-1781`, `Config.ts:1156-1158`) | structure                                                                                         | `CityExecution` (`src/core/execution/CityExecution.ts`) |
| `Factory` ("Factory")                     | `Math.min(1_000_000, pow2(numUnits) * 125_000)` `Config.ts:644`                                                              | **Factory + Port combined** (`costWrapper(..., UnitType.Factory, UnitType.Port)` `645-646`)                                                                                 | 1,000,000         | 20 ticks = **2 s** (`648`)                                                                         | Yes (`649`). Each level = one extra train-spawn roll per tick (`TrainStationExecution.shouldSpawnTrain` `src/core/execution/TrainStationExecution.ts:361-374`) and +1 to `unitCount(Factory)` fed into `trainSpawnRate`                                                                                                                                                                                                         | `landBasedStructureSpawn` (as City)                                                                                                                                                                                                                                                                                                          | structure                                                                                                                                                                                                                                                     | `FactoryExecution` (`src/core/execution/FactoryExecution.ts`)                                     |
| `Port` ("Port")                           | `Math.min(1_000_000, pow2(numUnits) * 125_000)` `Config.ts:561`                                                              | **Port + Factory combined** (`562-563`)                                                                                                                                     | 1,000,000         | `5 * 10` = 50 ticks = **5 s** (`565`)                                                              | Yes (`566`). Each level = one extra trade-ship roll per 10-tick check (`PortExecution.shouldSpawnTradeShip` `src/core/execution/PortExecution.ts:163-176`), weights the port `level` times in other ports' destination lists (`218`), and heals docked warships `warshipPortHealingBonusPerLevel()` = 5/level (`Config.ts:1180-1182`)                                                                                           | `portSpawn` (`1653-1674`): BFS Manhattan radius `radiusPortSpawn()` = 20 (`Config.ts:944-946`) from click, keep own **shore** tiles, nearest that is also in `validStructureSpawnTiles` (spacing 15)                                                                                                                                         | structure                                                                                                                                                                                                                                                     | `PortExecution`                                                                                   |
| `DefensePost` ("Defense Post")            | `Math.min(250_000, (numUnits + 1) * 50_000)` `Config.ts:612`                                                                 | DefensePost only                                                                                                                                                            | 250,000 (n ≥ 4)   | 50 ticks = **5 s** (`615`)                                                                         | **No** — no `upgradable` flag (`609-617`); `canUpgradeUnitType` returns false                                                                                                                                                                                                                                                                                                                                                   | `landBasedStructureSpawn`                                                                                                                                                                                                                                                                                                                    | structure                                                                                                                                                                                                                                                     | `DefensePostExecution`                                                                            |
| `MissileSilo` ("Missile Silo")            | `() => 1_000_000` **flat** `Config.ts:604`                                                                                   | —                                                                                                                                                                           | —                 | `10 * 10` = 100 ticks = **10 s** (`605`)                                                           | Yes (`606`). Each level pushes a slot onto `missileTimerQueue`; silo is on cooldown when `queue.length === level` (`src/core/game/UnitImpl.ts:534`); new level starts on cooldown (`UnitImpl.ts:719-721`). Reload after `SiloCooldown()` = 90 ticks = 9 s (`Config.ts:352-354`, `MissileSiloExecution.ts:262-274`)                                                                                                              | `landBasedStructureSpawn`                                                                                                                                                                                                                                                                                                                    | structure                                                                                                                                                                                                                                                     | `MissileSiloExecution`                                                                            |
| `SAMLauncher` ("SAM Launcher")            | `Math.min(3_000_000, (numUnits + 1) * 1_500_000)` `Config.ts:622`                                                            | SAMLauncher only                                                                                                                                                            | 3,000,000 (n ≥ 1) | `SAM_CONSTRUCTION_TICKS` = `30 * 10` = 300 ticks = **30 s** (`Config.ts:183`, `625-627`)           | Yes (`628`). Range per level `samRange(level) = 150 - 480/(level+5)` (`Config.ts:1105-1108`): L1 70, L2 81.4, L3 90, L4 96.7, L5 102, asymptote `maxSamRange()` 150. Range interpolates over `samUpgradeDuration()` = `floor(90/2)` = 45 ticks (`1114-1116`, `dynamicSamRange` `1118-1131`, state set in `UnitImpl.increaseLevel` `705-714`). Extra missile slot per level, same queue rule as silo. `SAMCooldown()` = 90 ticks | `landBasedStructureSpawn`                                                                                                                                                                                                                                                                                                                    | structure                                                                                                                                                                                                                                                     | `SAMLauncherExecution`                                                                            |
| `Warship` ("Warship")                     | `Math.min(1_000_000, (numUnits + 1) * 250_000)` `Config.ts:541`                                                              | Warship only                                                                                                                                                                | 1,000,000 (n ≥ 3) | none — spawns instantly at the port (`ConstructionExecution.tick` `51-56` delegates on first tick) | No. `maxHealth: 1000` (`544`); veterancy (0-3) instead: +20 % max HP and +20 % shell damage per level (`Config.ts:1205-1229`)                                                                                                                                                                                                                                                                                                   | `warshipSpawn` (`1676-1693`): clicked tile must be **water**; spawns at nearest own **active, completed** Port sharing the click's water component. Fails silently (no charge) if none                                                                                                                                                       | mobile                                                                                                                                                                                                                                                        | `WarshipExecution` (`src/core/execution/WarshipExecution.ts:40-55` — `canBuild` then `buildUnit`) |
| `TransportShip` ("Transport")             | `() => 0n` `Config.ts:535`                                                                                                   | —                                                                                                                                                                           | —                 | none                                                                                               | No                                                                                                                                                                                                                                                                                                                                                                                                                              | `canBuildTransportShip` (`src/core/game/TransportShipUtils.ts:5-31`): `unitCount(TransportShip) < boatMaxNumber()` (= 3, or 0 if disabled; `Config.ts:811-816`); target tile not own; can attack owner; source = closest own shore reachable by water. Payload `boatAttackAmount` = `troops / 5` (`Config.ts:936-938`)                       | mobile                                                                                                                                                                                                                                                        | `TransportShipExecution`                                                                          |
| `TradeShip` ("Trade Ship")                | `() => 0n` `Config.ts:599`                                                                                                   | —                                                                                                                                                                           | —                 | none                                                                                               | No                                                                                                                                                                                                                                                                                                                                                                                                                              | `tradeShipSpawn` (`1783-1787`): tile must be one of the player's own Port tiles. Not player-buildable (`PlayerBuildable` group excludes it)                                                                                                                                                                                                  | mobile                                                                                                                                                                                                                                                        | `TradeShipExecution`, spawned by `PortExecution.tick` (`139-152`)                                 |
| `Train` ("Train")                         | `() => 0n` `Config.ts:654`                                                                                                   | —                                                                                                                                                                           | —                 | none                                                                                               | No                                                                                                                                                                                                                                                                                                                                                                                                                              | `landBasedUnitSpawn` (`1695-1697`): land and not impassable. Not player-buildable                                                                                                                                                                                                                                                            | mobile (7 `Train` units per train: engine + tail engine + 5 carriages, `TrainExecution.createTrainUnits` `148-169`)                                                                                                                                           | `TrainExecution`, spawned by `TrainStationExecution`                                              |
| `AtomBomb` ("Atom Bomb")                  | `() => 750_000` **flat** `Config.ts:571`                                                                                     | —                                                                                                                                                                           | —                 | none (delegated on first tick)                                                                     | No                                                                                                                                                                                                                                                                                                                                                                                                                              | `nukeSpawn` (`1601-1651`): blocked during spawn immunity, on impassable target, on teammate-owned target (unless game over & not singleplayer), and in Team mode if outer blast radius would hit a teammate structure; launches from the **nearest ready silo** (active, not cooling down, not under construction) else fails without charge | mobile                                                                                                                                                                                                                                                        | `NukeExecution` (`ConstructionExecution.ts:106-124`; `amount` fans out N `NukeExecution`s)        |
| `HydrogenBomb` ("Hydrogen Bomb")          | `() => 5_000_000` **flat** `Config.ts:576`                                                                                   | —                                                                                                                                                                           | —                 | none                                                                                               | No                                                                                                                                                                                                                                                                                                                                                                                                                              | same as AtomBomb                                                                                                                                                                                                                                                                                                                             | mobile                                                                                                                                                                                                                                                        | `NukeExecution`                                                                                   |
| `MIRV` ("MIRV")                           | `25_000_000n + game.stats().numMirvsLaunched() * 15_000_000n` `Config.ts:588` (bypasses `costWrapper`; infinite gold → `0n`) | **game-wide** MIRVs launched so far (`StatsImpl._numMirvLaunched` single bigint, `src/core/game/StatsImpl.ts:55-59`) — 1st 25M, 2nd 40M, 3rd 55M regardless of who launched | none              | none                                                                                               | No                                                                                                                                                                                                                                                                                                                                                                                                                              | `nukeSpawn` plus target tile must have an owner (`1567-1571`); teammate-structure check skipped for MIRV (`1626`)                                                                                                                                                                                                                            | mobile                                                                                                                                                                                                                                                        | `MirvExecution` (`src/core/execution/MIRVExecution.ts:75-82`)                                     |
| `MIRVWarhead` ("MIRV Warhead")            | `() => 0n` `Config.ts:594`                                                                                                   | —                                                                                                                                                                           | —                 | —                                                                                                  | No                                                                                                                                                                                                                                                                                                                                                                                                                              | `targetTile` returned as-is (`1575-1576`)                                                                                                                                                                                                                                                                                                    | mobile (spawned by MIRV split)                                                                                                                                                                                                                                | `NukeExecution`                                                                                   |
| `Shell` ("Shell")                         | `() => 0n`, `damage: 250` `Config.ts:549-551`                                                                                | —                                                                                                                                                                           | —                 | —                                                                                                  | No                                                                                                                                                                                                                                                                                                                                                                                                                              | pass-through (`1581-1583`)                                                                                                                                                                                                                                                                                                                   | projectile                                                                                                                                                                                                                                                    | `ShellExecution`                                                                                  |
| `SAMMissile` ("SAMMissile")               | `() => 0n` `Config.ts:555`                                                                                                   | —                                                                                                                                                                           | —                 | —                                                                                                  | No                                                                                                                                                                                                                                                                                                                                                                                                                              | pass-through                                                                                                                                                                                                                                                                                                                                 | projectile                                                                                                                                                                                                                                                    | `SAMMissileExecution`                                                                             |

`UnitInfo` shape (`Game.ts:175-183`): `{ cost(game, player, extraUnits?), maxHealth?, damage?, constructionDuration?, upgradable? }` — there is no per-type `maxLevel`, `upkeep`, `materials`, or placement descriptor; placement is the hand-written switch in `PlayerImpl.canSpawnUnitType`.

Group membership (`Game.ts:219-252`): `Nukes` = Atom, Hydrogen, MIRVWarhead, MIRV; `BuildableAttacks` = Atom, Hydrogen, MIRV, Warship; `Structures` = City, DefensePost, SAMLauncher, MissileSilo, Port, Factory; `BuildMenus` = Structures ∪ BuildableAttacks; `PlayerBuildable` = BuildMenus ∪ TransportShip. The client build menu iterates a hand-written `buildTable` (`src/client/hud/layers/BuildMenu.ts:49-122`) and asks the worker for `buildables(tile, BuildMenus.types)` (`BuildMenu.ts:489`).

Bulk purchase: `MAX_UPGRADE_AMOUNT = 50` (`Game.ts:173`) caps `amount` on both `build_unit` and `upgrade_structure` intents (`src/core/Schemas.ts:689-702`). `BuildableUnit.upgradeCosts[n-1]` = cumulative cost of n upgrades computed as `Σ_{k=0}^{n-1} cost(mg, player, k)` (`PlayerImpl.ts:1521-1529`); `bulkCost`/`maxBulkAmount` helpers `Game.ts:968-988`.

#### 1.1 Mismatches vs the FightWars brief reference table

Brief table: `Claude Memories/fightwars-master-prompt.md:56-70` (identical copy at `fightwars-autonomous-prompt.md:129-143`).

| Brief claim                    | Code                                                                                                                                  | Verdict                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port `2^n × 125k`, cap 1M      | `Math.min(1_000_000, pow2(numUnits) * 125_000)`                                                                                       | formula and cap **match**, BUT `n` is the **combined** Port+Factory count (`Config.ts:562-563`), which the brief does not say. Building 3 factories makes your first port 1M. |
| Port **20 s build**            | `constructionDuration: 5 * 10` = **5 s** (`Config.ts:565`)                                                                            | **MISMATCH** (4× faster than brief)                                                                                                                                           |
| Warship `(n+1) × 250k`, cap 1M | `Math.min(1_000_000, (numUnits + 1) * 250_000)`                                                                                       | **match**                                                                                                                                                                     |
| Warship 1000 HP, Shell 250 dmg | `maxHealth: 1000` (`544`), `damage: 250` (`550`)                                                                                      | **match** (base; veterancy adds up to +60 %)                                                                                                                                  |
| Atom Bomb 750,000              | `750_000` flat                                                                                                                        | **match**                                                                                                                                                                     |
| Hydrogen Bomb 5,000,000        | `5_000_000` flat                                                                                                                      | **match**                                                                                                                                                                     |
| MIRV **35,000,000**            | `25_000_000 + 15_000_000 × numMirvsLaunched` (game-wide)                                                                              | **MISMATCH** — first MIRV is 25M, second 40M; 35M is never a price                                                                                                            |
| Missile Silo "scales per-unit" | `1_000_000` **flat** (`Config.ts:604`)                                                                                                | **MISMATCH** — does not scale                                                                                                                                                 |
| City "scales per-unit"         | `2^n × 125k`, cap 1M, City-only count                                                                                                 | consistent (brief just omits the numbers)                                                                                                                                     |
| Factory "scales per-unit"      | `2^n × 125k`, cap 1M, **shared count with Port**                                                                                      | consistent, shared counter not mentioned                                                                                                                                      |
| Defense Post "scales per-unit" | `(n+1) × 50k`, cap 250k, **not upgradable**                                                                                           | consistent; brief silent on non-upgradability                                                                                                                                 |
| SAM Launcher "scales per-unit" | `(n+1) × 1.5M`, cap 3M (so 1.5M then 3M forever), **30 s build**                                                                      | consistent; the 30 s timer is by far the longest and is undocumented                                                                                                          |
| "each with a build timer"      | Warship, Atom, Hydrogen, MIRV have **no** timer (delegate on first tick); City/Factory 2 s, Port/DefensePost 5 s, Silo 10 s, SAM 30 s | partial mismatch                                                                                                                                                              |
| Transport "free, from coast"   | 0 gold, max **3** concurrent, carries `troops/5`, cannot target own land                                                              | match plus undocumented cap                                                                                                                                                   |
| Trade Ship / Train "free"      | 0n                                                                                                                                    | match                                                                                                                                                                         |

### 2. Construction flow

Data-driven vs hardcoded: cost, duration, upgradability are hardcoded per type in `Config.unitInfo`; the only wire-configurable knobs are `instantBuild` (`Schemas.ts:515`, `Config.ts:383-385`), `disabledUnits` (`Schemas.ts:544`, `Config.isUnitDisabled` `376-378`), `infiniteGold`/`hostCheats`, and `goldMultiplier` (affects income, not prices).

1. **Intent**: client emits `build_unit` `{ unit: z.enum(UnitType), tile, rocketDirectionUp?, amount? (1..50) }` (`Schemas.ts:689-695`). `ExecutionManager.createExec` maps it to `new ConstructionExecution(player, intent.unit, intent.tile, intent.rocketDirectionUp, intent.amount)` (`src/core/execution/ExecutionManager.ts:107-114`).
2. **`ConstructionExecution.init`** (`ConstructionExecution.ts:28-44`): if `isUnitDisabled(type)` or `!isValidRef(tile)` → `active = false`, nothing charged.
3. **First `tick`** (`46-80`):
   - Non-structure (`!isStructure(type)`): `completeConstruction()` immediately → spawns the specialised execution (`NukeExecution` × `amount`, `MirvExecution`, `WarshipExecution`), which does its own `canBuild` + `buildUnit` on its first tick (`NukeExecution.ts:187-215`, `WarshipExecution.ts:40-54`, `MIRVExecution.ts:75-82`). If `canBuild` fails there, **nothing is charged** because gold is only removed inside `buildUnit`.
   - Structure: `player.canBuild(type, tile)` (`PlayerImpl.ts:1549-1559` = `canBuildUnitType` [disabled? gold ≥ cost? alive?] then `canSpawnUnitType`). On failure: `console.warn`, execution dies, no charge. On success: `player.buildUnit(type, spawnTile, {})` (`PlayerImpl.ts:1368-1397`) which **charges the full cost now** (`removeGold(cost)` line 1391), increments `unitsConstructed`, pushes the `UnitImpl` (level 1) and emits an update. If `constructionDuration > 0` → `setUnderConstruction(true)` and `ticksUntilComplete = duration`; else complete at once.
4. **Countdown** (`82-98`): each tick decrements. If the structure becomes inactive (destroyed/deleted) the execution ends **without refund**. If the owner changes mid-build (capture), the execution silently follows the new owner (`87-89`) and completes it for the captor — the original builder's gold is gone.
5. **Completion** (`100-159`): `setUnderConstruction(false)` then `addExecution(new <Type>Execution(structure))`. `PortExecution`/`MissileSiloExecution`/`DefensePostExecution`/`SAMLauncherExecution` all early-return while `isUnderConstruction()`.
6. **While under construction** a structure: counts as 1 toward `unitsOwned` (so it already raises the next price), is included in spacing checks (`nearbyUnits(..., includeUnderConstruction=true)` `PlayerImpl.ts:1717-1723`, `UnitGrid.ts:138-164`), is excluded from `unitCount`, `maxTroops` city sum (`Config.ts:990-994`), SAM/silo/defense/port behaviour, warship docking (`warshipSpawn` filters `!isUnderConstruction()`), nuke launch (`nukeSpawn` `1642-1645`), and cannot be upgraded (`isUnitValidToUpgrade` `1446-1457`).
7. **Cancellation**: there is **no cancel-construction intent** (only `cancel_attack` and `cancel_boat` exist, `Schemas.ts:705,710`). The only way out is `delete_unit` (30 s mark, see §5) — still no refund.
8. **`instantBuild` cheat**: every `constructionDuration` is written as `this.instantBuild() ? 0 : N` (`Config.ts:565,605,615,625-627,637,648`), so `ConstructionExecution` takes the "No construction time" branch (`76-79`) and the structure is live the same tick. Costs are unaffected. Tests (`tests/DeleteUnitExecution.test.ts:347-351`, `tests/core/executions/TrainExecution.test.ts:11`) rely on it.

Decision it drives: the price you see in the build menu is the price you pay, charged at placement, and the counter that sets it (`min(owned, constructed)`) means the curve is a function of what you currently hold, not history.

### 3. Upgrade flow

1. **Server-side eligibility** is computed in `PlayerImpl.buildableUnits` (`1479-1547`) for the clicked tile: for each upgradable type, `findExistingUnitToUpgrade(type, tile)` (`1407-1423`) = the closest same-type unit within `structureMinDist()` = 15 (Euclidean via `nearbyUnits`, under-construction included), then `isUnitValidToUpgrade` (not under construction, not marked for deletion, owned by this player). Result is `BuildableUnit.canUpgrade = unitId | false` plus the cumulative `upgradeCosts[0..49]`. Note `canBuild` is computed independently — a click within 15 tiles of your own city can yield both an upgrade target and a shifted build tile; `buildNew = canBuild !== false && canUpgrade === false` (`1516`) is only used to decide whether to compute ghost-rail previews.
2. **Intent**: `upgrade_structure { unit, unitId, amount? }` (`Schemas.ts:697-702`) → `new UpgradeStructureExecution(player, intent.unitId, intent.amount)` (`ExecutionManager.ts:119-124`). The `unit` type field is **ignored** server-side.
3. **`UpgradeStructureExecution.init`** (`src/core/execution/UpgradeStructureExecution.ts:195-219`) does all the work synchronously (its `tick` is a no-op and `isActive()` is always false): verify ownership, then loop `amount` times: `player.canUpgradeUnit(structure)` (`PlayerImpl.ts:1459-1470` = type upgradable ∧ `canBuildUnitType` [gold ≥ cost at the **current** `n`] ∧ valid) → `player.upgradeUnit(structure)` (`1472-1477`: `removeGold(cost)`, `unit.increaseLevel()`, `recordUnitConstructed`). Because each step bumps `unitsConstructed` and the unit's level, the k-th step costs `cost(n + k)`; the loop stops at the first unaffordable step, so a bulk order partially applies.
4. **`UnitImpl.increaseLevel`** (`704-723`): SAM → snapshot `samLauncherState` for the 45-tick range ramp; `_level++`; bump both unit-version memos; Silo/SAM → push a cooldown slot (new missile slot starts loaded-but-cooling). **No build time for upgrades** (SAM range ramp is cosmetic/targeting only).
5. **Level loss**: `decreaseLevel(destroyer?)` (`725-741`) is how nukes degrade structures — at level 0 the unit is deleted with `destroyer` credited.
6. Upgrade cost is the **same curve as building** — there is no separate upgrade formula anywhere. There is **no level cap**; the only bound is 50 per intent.

Data-driven vs hardcoded: entirely hardcoded (`upgradable` flags and formulas in `Config.unitInfo`; the 15-tile snap radius is `structureMinDist()`).

### 4. Rail network and trains

#### 4.1 Objects

- `RailNetworkImpl` (`src/core/game/RailNetworkImpl.ts:97-470`), created once per game at `GameImpl.ts:109` (`createRailNetwork(this)`, `RailNetworkImpl.ts:91-95`). Hardcoded: `maxConnectionDistance = 4` hops, `stationRadius = 3` tiles, `gridCellSize = 4` (`98-100`).
- `StationManagerImpl` (`38-72`): `Set<TrainStation>` + id array (ids from 1; `count()` returns `nextId`, used as A\* node count).
- `TrainStation` (`src/core/game/TrainStation.ts:237-335`): wraps a City/Port/Factory `Unit`; holds its `Railroad`s and `railroadByNeighbor`; `tradeAvailable(other)` = same owner or `owner.canTrade(other)` (`253-256`); `onTrainStop` dispatches to a handler by unit type (`328-334`).
- `Railroad` (`src/core/game/Railroad.ts:6-42`): `from`, `to`, `tiles[]`, `id`; `OrientedRailroad` (`58-80`) reverses tiles when travelling `to → from`.
- `RailSpatialGrid` (`src/core/game/RailroadSpatialGrid.ts`): 4×4-tile buckets of railroads for `query(tile, radius)`.
- `Cluster` (`TrainStation.ts:340-425`): `stations: Set`, `tradeStations: Set` (only City and Port — `isTradeStation` `344-347`; Factory is a node but never a trade destination), `hasAnyTradeDestination(player)`, `randomTradeDestination(player, random)` (reservoir sampling), `availableForTrade`, `merge`.

#### 4.2 Station creation rules (who becomes a rail node)

- **Factory** (`FactoryExecution.ts:78-91`, runs once on the first tick after completion): always `new TrainStationExecution(factory, spawnTrains = true)`, and for every City/Port/Factory within `trainStationMaxRange()` = **110** (`Config.ts:477-479`) that lacks a station, `new TrainStationExecution(unit)` (spawnTrains undefined → false). **Only factories spawn trains.**
- **City** (`CityExecution.ts:34-43`): one-time check on its first tick — station only if `hasUnitNearby(tile, 110, Factory)`. A city completed before any factory is in range gets promoted later by the factory's sweep above.
- **Port** (`PortExecution.ts:130-132, 178-187`): checked **every tick** until it has a station; same 110-range factory test.
- `TrainStationExecution` constructor calls `unit.setTrainStation(true)` immediately (`TrainStationExecution.ts:322-327`); the `TrainStation` object is created and `railNetwork().connectStation(station)` on its first tick (`347-351`). It goes inactive when the unit dies.
- Station removal: `GameImpl.removeUnit` (`1094-1102`) → `railNetwork.removeStation(u)` if `hasTrainStation()`; `RailNetworkImpl.removeStation` (`148-167`) deletes its railroads (emitting `RailroadDestructionEvent`), drops it from the manager/cluster, and marks the cluster **dirty** (or deletes an emptied cluster). Ownership changes do **not** touch stations — a captured city stays a node in the same cluster; only `tradeAvailable` changes.

#### 4.3 Connecting a new station (`connectStation` `117-122`)

1. **Snap** (`connectToExistingRails` `176-238`): query railroads within 3 tiles; for each, split at the closest tile index (skip if index 0 or end): two new `Railroad`s replace the old one (`RailroadSnapEvent`), the station joins `from`'s cluster; multiple clusters → `mergeClusters` (new merged `Cluster`, `464-469`). Returns true if any snap happened.
2. Else **link** (`connectToNearbyStations` `337-382`): candidates = City/Factory/Port units within 110 tiles (nearest first) that already have a station; skip if already reachable in ≤ 4 station hops (`distanceFrom` BFS `416-445`) or if `distSquared ≤ trainStationMinRange()²` (= 15², `Config.ts:474-476`); `connect()` (`399-414`) runs the rail A\* and accepts the path only if `0 < length < railroadMaxSize()` = `110 × 1.4142` ≈ 155.6 tiles (`Config.ts:480-482`) → `RailroadConstructionEvent`. Join the neighbour's cluster; merge if several; if none linked → fresh `Cluster` of one.
3. **Rail pathing** (`src/core/pathfinding/algorithms/AStar.Rail.ts`): 4-neighbour grid A*; impassable tiles blocked; water only enterable from/into shoreline; cost 1 (+5 on water/shoreline, +3 on direction change); heuristic = **2 × Manhattan** (weighted A*, deliberately non-optimal for speed). Wrapped by `PathFinding.Rail(game)` (`RailNetworkImpl.ts:82-84`).

#### 4.4 Clusters — how computed, when recomputed, what they are used for

- A cluster is the connected component of the station graph (edges = railroads). It is maintained **incrementally** on connect/merge and only fully recomputed after removals.
- `RecomputeRailClusterExecution` (`src/core/execution/RecomputeRailClusterExecution.ts`) is added exactly once at game start in `GameRunner.init` (`src/core/GameRunner.ts:126-130`) **unless `Factory` is in `disabledUnits`**; it is permanently active and calls `railNetwork.recomputeClusters()` **every tick**. That method (`RailNetworkImpl.ts:124-146`) returns immediately when `dirtyClusters` is empty; otherwise, for each dirty cluster it BFS-walks (`computeCluster` `447-462`) from an arbitrary member, and any members not reached are split off into new `Cluster`s (repeat until all accounted for). So a severed network is corrected at most one tick after the station died.
- Uses today (exhaustive):
  1. `TrainStationExecution.spawnTrain` (`381-397`): no cluster or `!cluster.hasAnyTradeDestination(owner)` → no train; destination = `cluster.randomTradeDestination(owner, random)`.
  2. `StationPathFinder.findPath` (`src/core/pathfinding/PathFinder.Station.ts:451-465`): refuses a route unless source and destination share a cluster (`getCluster() ===`), then A\* over station ids (cost 1/hop, Manhattan heuristic, `maxNeighbors 32`).
  3. Nothing else reads `Cluster` — no supply, no economy bonus, no UI beyond rail tiles.
- Client preview: `BuildableUnit.overlappingRailroads` and `ghostRailPaths` (`Game.ts:962-963`, computed `RailNetworkImpl.ts:240-335`) show where a City/Port/Factory would snap/link; hardcoded type lists at `241` and `258`; at most 5 ghost paths.

#### 4.5 Train spawn / route / payout

- **Spawn** (`TrainStationExecution.ts:340-409`): only factory stations (`spawnTrains`); hardcoded `numCars = 5`, `ticksCooldown = 10` between spawns per station (`319-321`). Per tick, per **level** of the factory, one roll `random.chance(spawnRate)` where
  `spawnRate = trainSpawnRate(owner.unitCount(Factory), game.unitCount(Train))` = `max(1, floor((numPlayerFactories + 10) * 15 / trainSaturation(numTrainUnits)))` (`Config.ts:442-447`), `trainSaturation(u) = (1 + 0.5·e^{-u/30}) · max(1 − σ(u; ln2/100, 300), 0.25·(1 − σ(u; ln2/150, 900)))` (`435-440`). `unitCount(Factory)` is **level-weighted** (`PlayerImpl.ts:511-529`), and `numTrainUnits` counts every engine/car in the world (~7 per train). At 1 factory level and 0 trains: rate ≈ 165/1.5 = 110 → 1 spawn per ~11 s per level. Golden values: `tests/TradeTrainGolden.test.ts:152-160`.
  Destination: random trade station (City/Port) in the same cluster that `tradeAvailable(owner)`; never itself.
- **Route** (`TrainExecution.init` `47-106`): `findStationsPath(source, destination)`; `canBuild(Train, stations[0].tile())`; build 1 engine + 1 tail + 5 carriages (all `UnitType.Train`, cost 0, `loaded: false`); concatenate oriented railroad tiles into one path and record a `MotionPlanRecord { kind: "train", speed: 2, spacing: 2 }` (`95-105`). Hardcoded `speed = 2` tiles/tick, `spacing = 2` (`26, 22`). `loadCargo()` (`127-136`) exists but has **no caller** anywhere in `src` — trains are never rendered loaded.
- **Movement** (`getNextTile` `270-287`): advance 2 tiles; on reaching a station call `stationReached()` then move to the next segment (`nextStation` `231-244`, with `resolveSplitRailroad` `246-262` re-resolving if the segment was split mid-transit — tests `tests/core/executions/TrainExecution.test.ts`). Train is deleted when: it arrives; source or next station dies (`activeSourceOrDestination` `183-189`); or the next station no longer trades with the owner (`canTradeWithDestination` `264-268`).
- **Payout** (`TradeStationStopHandler.onStop` `TrainStation.ts:192-217`) fires at **every intermediate and final City/Port** on the route (not just the destination); Factory stops pay nothing (`FactoryStopHandler` empty `219-225`):
  `gold = trainGold(rel(trainOwner, stationOwner), tradeStopsVisited, trainOwner)` with (`Config.ts:449-472`)
  `citiesVisited = max(0, citiesVisited − 9)`; base = 35,000 (`ally`), 25,000 (`team` or `other`), 10,000 (`self`); `gold = max(5000, base − 5000·citiesVisited) × goldMultiplierFor(trainOwner)`.
  `rel` (`427-441`): self / same team / allied / other. The train owner always receives `gold`; if the station belongs to someone else that owner **also** receives the same `gold` (both credited; stats `trainSelfTrade` / `trainExternalTrade`). `tradeStopsVisited` increments **after** the payout (`TrainExecution.ts:293-297`), so the 10th trade stop is the first one penalised. Golden table: `tests/TradeTrainGolden.test.ts:101-131`.
  Decision: foreign stations pay 2.5–3.5× what your own do, so the incentive is to rail into neighbours, and alliances are worth +10k per stop.

#### 4.6 Tests that pin this

`tests/core/game/RailNetwork.test.ts` (snap, link, min/max range, ghost paths, 5-path cap, ≤3-hop dedupe, factory-promotes-city), `tests/core/game/Cluster.test.ts`, `tests/core/game/TrainStation.test.ts`, `tests/core/executions/TrainExecution.test.ts`, `tests/core/pathfinding/PathFinding.Rail.test.ts`, `tests/TradeTrainGolden.test.ts`, `tests/TradeTrainScenarios.test.ts`.

### 5. Unit deletion

- Intent `delete_unit { unitId }` (`Schemas.ts:720-723`) → `DeleteUnitExecution(player, unitId)` (`ExecutionManager.ts:125-126`).
- `init` (`src/core/execution/DeleteUnitExecution.ts:249-300`) rejects, in order: unit missing or not owned; unit inactive; **tile owner ≠ player** (so a structure standing on lost ground cannot be deleted); **tile not land** (so warships, transports and any water unit cannot be deleted this way); spawn phase; `player.canDeleteUnit()` = `ticks − lastDeleteUnitTick ≥ deleteUnitCooldown()` = **300 ticks / 30 s** (`PlayerImpl.ts:1167-1172`, `Config.ts:750-752`). On success `recordDeleteUnit()` and `unit.markForDeletion()`.
- `UnitImpl.markForDeletion` (`309-316`): `_deletionAt = ticks + deletionMarkDuration()` = **300 ticks / 30 s** (`Config.ts:746-748`); emits an update so the client can render the mark (`StructurePass` instance field `markedForDeletion`, `src/client/render/gl/passes/StructurePass.ts:64`).
- `tick` (`302-320`): once `isOverdueDeletion()` (`ticks − deletionAt > 0`, i.e. tick 301 after marking) → `unit.delete(false)` → message `events_display.unit_voluntarily_deleted`.
- **Refund: none.** Gold is not returned, `unitsConstructed` is not decremented (but `unitsOwned` drops, so `n = min(owned, constructed)` falls and the next build is cheaper).
- During the 30 s mark the unit keeps functioning; it just cannot be upgraded (`isUnitValidToUpgrade`). Capture clears the mark (`UnitImpl.setOwner` `231-232` → `clearPendingDeletion`), confirmed by `tests/DeleteUnitExecution.test.ts:465-475`. Station removal happens through the normal `GameImpl.removeUnit` path.
- Rate limit: one deletion per 30 s per player, plus 30 s delay — shedding N structures takes ≥ 30·N seconds.

### 6. Auto-upgrade

Entirely client-side sugar over the normal upgrade intent; the server has no notion of it.

- Trigger: middle mouse button (`event.button === 1`) in `InputHandler.onPointerDown` (`src/client/InputHandler.ts:767-772`) emits `AutoUpgradeEvent(x, y)` (`185-190`). Documented in the brief as "middle-click auto-upgrades" (`fightwars-master-prompt.md:81`).
- `ClientGameRunner.autoUpgradeEvent` (`src/client/ClientGameRunner.ts:1185-1212`): screen → tile, ignore during spawn phase, then `findAndUpgradeNearestBuilding(tile)` (`1214-1289`):
  1. `myPlayer.actions(tile, Structures.types)` → worker → `PlayerImpl.buildableUnits` (§3.1).
  2. Candidates = entries with `canUpgrade !== false` (i.e. an affordable, valid same-type structure within 15 tiles); pick the one whose unit is closest (Manhattan) to the click.
  3. Guard: for every **unaffordable** type (`canUpgrade === false`, different type), if the player owns one of that type within `structureMinDist()` at a distance ≤ the best candidate's, do nothing — prevents spending on a farther factory when the player clicked an unaffordable city (the "Evan's scenario" test).
  4. Emit `SendUpgradeStructureIntentEvent(unitId, unitType)` → `upgrade_structure` with default `amount` 1.
- Tests: `tests/AutoUpgrade.test.ts` (only exercises the event class), `tests/FindAndUpgradeNearestBuilding.test.ts` (a **test-local copy** of the algorithm, flagged as such at lines 7-12 — it does not import the production function, so drift is possible).
- Nation AI has its own upgrade heuristic (`NationStructureBehavior.ts` `UPGRADE_DENSITY_THRESHOLD = 1/1500`, line 79) unrelated to this.

### 7. Gaps vs FightWars brief

#### 7.1 Adding a new unit (Submarine, Carrier, Bomber, Artillery, Paratrooper, Radar Station) — exact touch points

**All six are built (session 12)** — Artillery, Radar, Bomber, Submarine, Carrier and Paratrooper; see §04 D–E for each mechanic. The checklist below was walked six times and holds. Two things it taught: append a new `UnitType` member at the _end_ of the enum (`z.enum(UnitType)` rides the wire by member order, `zbin/README.md`), and the icon atlas cannot be regenerated on this box (`generate-sprite-atlases.mjs` is not in the repo and node-canvas is not built under `--ignore-scripts`), so a new structure draws with an existing column until the Phase 4 asset pass — `StructurePass` maps `Artillery` onto the defense post's glyph.

The brief (`fightwars-master-prompt.md:142`) asks for "cost curve in config, construction via the standard path, behaviour in its own class". Concretely, using `SAMLauncher` as the tracer (grep `SAMLauncher|SAM Launcher|sam_launcher`, case-insensitive):

**Core (`src/core`) — compile-enforced, cannot be skipped:**

1. `src/core/game/Game.ts:194-211` `UnitType` enum (string value is the wire/render key) and `UnitParamsMap` (`262-320`, must add a key or `UnitParams<T>` fails). Add to `Structures` (`233-240`) for territory-bound buildings or `BuildableAttacks` (`226-231`) for mobile purchasables; anything in neither is invisible to the build menu and `PlayerBuildable`.
2. `src/core/configuration/Config.ts:525-663` `unitInfo` switch — `default: assertNever(type)` forces a case: `cost` (use `costWrapper(fn, ...countedTypes)`), `constructionDuration`, `upgradable`, `maxHealth`, `damage`.
3. `src/core/game/PlayerImpl.ts:1561-1599` `canSpawnUnitType` switch (`assertNever`) — placement rule. Reuse `landBasedStructureSpawn` (Radar Station, Artillery if static), `warshipSpawn` (Submarine, Carrier — port spawn), `nukeSpawn`-like silo/carrier lookup (Bomber, Paratrooper), or write a new one. `validStructureSpawnTiles` `1710-1781` is the shared spacing flood (radius 15 hardcoded at `1714`).
4. `src/core/execution/ConstructionExecution.ts:105-158` `completeConstruction` switch + `161-173` `isStructure` list, then a new `src/core/execution/<Name>Execution.ts` implementing `Execution` (`init/tick/isActive/activeDuringSpawnPhase`). For structures the pattern is `XExecution(structure)` gating on `isUnderConstruction()`; for mobile units the pattern is `WarshipExecution`/`NukeExecution` (do `canBuild` + `buildUnit` yourself on first tick).
5. `src/core/game/UnitImpl.ts:344-365` `delete` stats switch and `src/core/StatsSchemas.ts:42-59` (`OtherUnitType` union + `unitTypeToOtherUnit` `satisfies Record<...>` — adding to the union without a 4-char key is a type error) if kills/losses should be tracked; `UnitImpl.increaseLevel/decreaseLevel` (`704-741`) if the unit has per-level state like the SAM.
6. `src/core/execution/nation/NationStructureBehavior.ts:46-64` `getStructureRatios` and `NationNukeBehavior.ts` (SAM references at 608, 687, 704, 792, 1014, 1068) if nations should build/respect it — otherwise nations ignore it entirely.
7. Rail hooks only if it is a rail node: hardcoded `[City, Port, Factory]` lists at `RailNetworkImpl.ts:241, 258, 282-286, 340-342`, `FactoryExecution.ts:82`, `TrainStation.createTrainStopHandlers` `227-235`, `Cluster.isTradeStation` `344-347`.
8. Wire: `Schemas.ts` `BuildUnitIntentSchema.unit = z.enum(UnitType)` (`691`) and `disabledUnits` (`544`) pick the new enum value up automatically. `src/server/MapPlaylist.ts:398-402` if a playlist should disable it.

**Client (`src/client`) — 17 files mention SAMLauncher (11 via `UnitType.SAMLauncher`):** 9. `src/client/render/types/UnitType.ts` — add `UT_<NAME>` constant and membership in `STRUCTURE_TYPES` / `NUKE_TYPES` / `SMOOTHED_NUKE_TYPES` (`14-60`). 10. `src/client/render/gl/passes/StructurePass.ts:49-56` `STRUCTURE_ORDER` (index = column in `resources/atlases/icon-atlas.png`, generated by `generate-sprite-atlases.mjs` referenced at line 5 — the script is not in `scripts/`, locate before touching); mobile units instead go through `UnitPass.ts` (`41-77`) and `resources/sprites/*.png` + `resources/atlases/unit-atlas.png`. Type-specific passes: `SamRadiusPass.ts`, `StructureLevelPass.ts`, `PointLightPass.ts`, `Renderer.ts:89-101` (`SAM_RADIUS_*` sets — a Radar Station that "extends SAM reach" must be added here), `render-settings.json`, `structure.frag.glsl`. 11. `src/client/hud/layers/BuildMenu.ts:49-122` `buildTable` entry (icon, `build_menu.desc.*`, `unit_type.*` keys, `countable`). 12. `src/client/InputHandler.ts:1164` hotkey table (`buildSamLauncher`) plus `UserSettingModal.ts`, `HelpModal.ts`, `hud/HotbarIcons.ts` for the keybind UI. 13. `src/client/components/GameConfigSettings.ts:116` disabled-unit toggle list; `hud/layers/TutorialPanel.ts:378`. 14. `src/client/controllers/BuildPreviewController.ts` (ghost preview switch at `450-462`, SAM-specific `392`, `666-672`), `SoundEffectController.ts:91`, `StructureHighlightController.ts` (build-time highlight of related structures, e.g. Warship → Port). 15. Stats/HUD: `hud/layers/UnitDisplay.ts:74,123,184,301`, `PlayerInfoOverlay.ts:550`, `hud/layers/lib/StatsColumns.ts:286`, `components/baseComponents/stats/PlayerStatsTable.ts`, `view/UnitView.ts:300`. 16. Assets: `resources/images/<Name>IconWhite.svg` (+ `.v1.png` variants as for `SamLauncherUnit.v1.png`), and **37 locale files** `resources/lang/*.json` (`en.json` keys at 167 `build_menu.desc.sam_launcher`, 974 `build_sam_desc`, 1994 `unit_type.sam_launcher`, 2046-2047 `build_sam_launcher*`).

Counting: ~8 core files (5 mandatory by `assertNever`/type exhaustiveness), ~17 client files, 1 atlas regeneration, 37 locale files. Budget a new unit at roughly 25 code files + assets; nothing is table-driven enough to add one by data alone.

#### 7.2 Materials as a construction gate — **built (Phase 5, brief §6.3, session 11)**

**What exists.** A second pool beside gold, `PlayerImpl._materials` (bigint, `materials()` / `addMaterials` / `removeMaterials`, clamped at zero like gold), that exactly one thing produces and exactly one thing consumes:

- **Production:** `FactoryExecution.tick` adds `Config.factoryMaterialsPerTick(level)` = 2 × level per tick to the factory's owner once the factory is built (nothing while `isUnderConstruction()`). A level-one factory makes a defense post every ten seconds and a silo every fifty. Not scaled by the gold multiplier — materials are not money.
- **Consumption:** `Config.unitMaterialsCost(type)` — a base table (DefensePost 200, Warship 600, SAMLauncher 1000, MissileSilo 1000, AtomBomb 1500, HydrogenBomb 6000, MIRV 20 000; everything else 0) × `materialsPriceScale()` = **2** since the session-12 retune (the pool sat at 100k+ unused at the end of every bot run at ×1: supply was never the constraint, so industry never was either; lever `--cheap-materials` restores ×1). **Flat per unit, never escalating**: materials are a throughput gate, not a price curve. `Config.unitInfo` decorates every non-zero type with `UnitInfo.materialsCost`, so every caller sees the same object; `canBuildUnitType` refuses when the pool is short, `buildUnit` and `upgradeUnit` charge it. Cities, ports and factories cost gold alone, so the economy can bootstrap — and that asymmetry _is_ the tall-versus-wide choice: gold raises a country, industry arms it.
- **Start:** `startingMaterials()` = one defense post's price (400 at ×2), one post and not two, whatever a post costs.
- **Wire:** materials change every tick for every factory owner, so they ride the packed per-tick lane, which is now a **sextet** `[smallID, tilesOwned, gold, troops, goldEarned, materials]` (`PlayerImpl.toUpdate`, `GameView`, the tests in `PackedPlayerUpdates.test.ts`). `PlayerUpdate.materials` is set on the first full emission and excluded from `diffPlayerUpdate` like the other packed fields. This is the "two update lanes" decision the Phase 5 handoff note was written for, and it went to the packed lane for the reason that note gives.
- **Client:** `BuildableUnit.materialsCost` ships the price; the radial build menu greys out and prints "N materials" beside the gold when the pool is short (`RadialMenuElements.ts`); `PlayerView.materials()` reads the state; the control panel prints the pool beside gold in the gold tile's grammar (a factory glyph carries the identity, the figure wears ink — session 12), and the player panel shows it with the other resources.
- **Nations** budget on gold and then call `canBuild`, so a nation with no factory simply never places a post or a silo until it has one; `NationStructureBehavior` already builds factories at 0.75 per city.

**A/B lever:** `npm run balance:run -- --no-materials` zeroes `unitMaterialsCost` and nothing else.

**Not done:** train delivery (`FactoryStopHandler.onStop` is still empty — production lands in the owner's pool directly, which is simpler and deterministic; the train hook is the place to make geography matter later); a HUD readout of the pool (the radial menu shows the price, nothing shows the balance — a Phase 4 item 6 concern); stats for materials produced or spent (no schema slot; add one when the stats tree is next touched).

#### 7.3 Upkeep

- No per-tick cost exists anywhere. Income is `PlayerExecution.tick` → `config.goldAdditionRate(player)` → `player.addGold` (`src/core/execution/PlayerExecution.ts:88-89`; `Config.ts:1053-1062`, 100/tick humans, 50/tick bots × multiplier).
- Hook: same `PlayerExecution.tick`, `upkeep = Σ_{u ∈ player.units()} level(u) × config.unitUpkeep(u.type())`, subtract with a bankruptcy rule (the brief wants overbuilding to hurt: e.g. at `gold < 0` mark the most expensive structure for deletion via the existing `markForDeletion`, or halt trade-ship/train spawns). Note the existing shed path is slow — one voluntary deletion per 30 s with a 30 s fuse — so upkeep needs its own faster consequence or players cannot react.
- Warships: `WarshipExecution.tick` already has per-tick health logic; charge there or in the same player loop.

#### 7.4 Rail clusters as supply sources (brief §5.1: "extend the existing rail-cluster computation into a general supply-source graph")

**Half built.** The supply field itself exists — see §02 G1 for what it is and where it is charged — but its sources are the player's capital and its City / Port / Factory tiles. Rail is not wired in yet, so a railway running to the front buys nothing.

- What exists to hook: `Cluster.stations` gives every node tile (`station.tile()`); clusters are kept correct by `RecomputeRailClusterExecution` every tick after a removal, and merged eagerly on connect; `Railroad.tiles` gives the actual track tiles and `RailSpatialGrid.query(tile, r)` answers "is there track near here" in O(cells).
- Where it would go: `SupplyNetwork.refresh` seeds from `player.spawnTile()` and `player.units(City, Port, Factory)`. Adding track is one more seed loop in the same place — every own-owned tile of every `Railroad` the player holds, seeded at distance 0 — and nothing else changes, because the flood already walks only the player's own ground.
- Caveats to design around: (a) clusters are **cross-owner** — a cluster can contain stations of several players; supply must filter by `station.unit.owner()` (and possibly by `tradeAvailable` for allied transit, matching the brief's "rail transit" alliance tier). (b) Only City/Port/Factory are nodes, and all three are already sources in their own right, so the value rail adds is the **track between them**, not the stations. (c) `Cluster` is only touched on topology change, so a per-cluster cached "owned tile set" would make the seed loop cheap if the naive version shows up in `perf:gate`.

## 04 — Nukes, SAMs, Fallout, Doomsday Clock, Navy, Water Pathfinding

Repo: `C:\Users\disbo\dev\fightwars` (HEAD `c77005586`). Read-only audit. All paths below are relative to the repo root; line numbers are from the files as read on 2026-09-12.

Tick = 100 ms (`Config.msPerTick()`, `src/core/configuration/Config.ts:346`). 10 ticks = 1 s.

---

### 1. Nuke unit costs and magnitudes (data-driven, `Config.ts`)

`src/core/configuration/Config.ts:567-600, 602-606, 618-629`

| Unit         | Cost                                                                                                                                                  | Build time                                                | Notes                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------- |
| AtomBomb     | `750_000` flat (`costWrapper`)                                                                                                                        | instant (non-structure)                                   |                               |
| HydrogenBomb | `5_000_000` flat                                                                                                                                      | instant                                                   |                               |
| MIRV         | `25_000_000n + game.stats().numMirvsLaunched() * 15_000_000n` (line 588) — escalates globally per MIRV ever launched, 0 for humans with infinite gold | instant                                                   |                               |
| MIRVWarhead  | `0n`                                                                                                                                                  | —                                                         | spawned by MIRVExecution only |
| MissileSilo  | `1_000_000` flat                                                                                                                                      | `10 * 10` = 100 ticks (0 if instantBuild)                 | `upgradable: true`            |
| SAMLauncher  | `min(3_000_000, (numUnits + 1) * 1_500_000)`                                                                                                          | `SAM_CONSTRUCTION_TICKS = 30 * 10` = 300 ticks (line 183) | `upgradable: true`            |
| SAMMissile   | `0n`                                                                                                                                                  | —                                                         |                               |

Magnitudes — `Config.nukeMagnitudes()` (`Config.ts:1064-1074`):

```ts
case UnitType.MIRVWarhead: return { inner: 12, outer: 18 };
case UnitType.AtomBomb:    return { inner: 12, outer: 30 };
case UnitType.HydrogenBomb: return { inner: 80, outer: 100 };
```

Speeds — `Config.nukeSpeed()` (`Config.ts:1080-1091`), in curve-pixels per tick:

```ts
AtomBomb / HydrogenBomb: 10
MIRV:                    15   (overridden by MIRVExecution.calculateDeterministicSpeed, see §3)
MIRVWarhead:             22   (+0..4 offset per warhead index band, see §3)
```

Confirmed by `tests/NukeSpeed.test.ts:9-14`.

Other tunables:

- `nukeAllianceBreakThreshold()` = `100` (`Config.ts:1076`)
- `mirvNormalizeTargetTicks()` = `14` (`Config.ts:1093`)
- `defaultNukeTargetableRange()` = `150` (`Config.ts:1097`)
- `SiloCooldown()` = `90` ticks (`Config.ts:352`); `SAMCooldown()` = `90` ticks (`Config.ts:349`)
- `waterNukes()` = `gameConfig.waterNukes ?? false` (`Config.ts:397`) — wire-configurable (`Schemas.ts:530`)

Test harness override: `tests/util/TestConfig.ts:11,32-45` forces a flat nuke speed of 4 and its own magnitudes, so unit tests do not exercise the production numbers above.

---

### 2. Atom / Hydrogen bomb — `NukeExecution`

File: `src/core/execution/NukeExecution.ts` (529 lines). Constructor `(nukeType, player, dst, src?, speed=-1, waitTicks=0, rocketDirectionUp=true)`.

#### 2.1 Launch gate (tick 1) — `NukeExecution.tick()` lines 185-252

`player.canBuild(nukeType, dst)` → `PlayerImpl.canSpawnUnitType` → `PlayerImpl.nukeSpawn()` (`src/core/game/PlayerImpl.ts:1601-1651`). Targeting restrictions, verbatim order:

1. `mg.isSpawnImmunityActive()` → `false`. Spawn immunity = in spawn phase OR `ticksSinceStart() < spawnImmunityDuration()` (`GameImpl.ts:882-887`); duration default `5 * 10` = 50 ticks (`Config.ts:176`, `DEFAULT_SPAWN_IMMUNITY_TICKS`), wire-overridable (`Schemas.ts:543`). **No nukes at all may be launched by anyone during spawn immunity** (global check, not per-target).
2. `mg.isImpassable(tile)` → `false`.
3. Target tile owner is on the launcher's **team** and game is not over → `false`. Nuking teammates is allowed "aftergame" except in Singleplayer.
4. Team mode only, non-MIRV: `mg.anyUnitNearby(tile, magnitude.outer, Structures.types, unit => same team)` → `false`. Cannot splash a teammate structure.
5. Silo choice: `units(MissileSilo).filter(active && !isInCooldown() && !isUnderConstruction())`, sorted by Manhattan distance to target, first wins. No ready silo → `false`.

**Not checked**: allies (non-team alliances) — an ally CAN be nuked, the alliance then breaks (§2.4); own land — yes, you can nuke yourself; water tiles — allowed (only units die); range — there is no max range from silo. MIRV additionally requires `mg.hasOwner(targetTile)` (`PlayerImpl.ts:1567-1570`). MIRVWarhead `canBuild` always returns the target tile (`PlayerImpl.ts:1575`); `canBuildUnitType` also skips the `isAlive()` check for warheads (`PlayerImpl.ts:1436`), so a dead launcher's warheads still fall.

Nukes are bought through the `build_unit` intent → `ConstructionExecution` (`src/core/execution/ConstructionExecution.ts:104-122`): for non-structures it immediately calls `completeConstruction()`, spawning `amount ?? 1` `NukeExecution`s with `waitTicks 0`; gold is charged inside `player.buildUnit()`.

#### 2.2 Silo stagger and cooldown (lines 196-211, 247-250)

Same-silo stacked purchases: `waitTicks += lastDep - ticks` where `lastDep` walks `silo.missileTimerQueue()` so each successive nuke departs ≥1 tick after the previous (`tests/core/executions/NukeExecution.test.ts:370-520` covers this). After `buildUnit`, `silo.launch()` pushes the current tick onto the silo's `_missileTimerQueue` (`UnitImpl.ts:524-527`).

`MissileSiloExecution` (`src/core/execution/MissileSiloExecution.ts:16-38`): each tick, if `SiloCooldown() - (ticks - frontTime) <= 0` → `silo.reloadMissile()` (shift). **Silo level = number of tubes**: `isInCooldown()` ⇔ `queue.length === level` (`UnitImpl.ts:533-535`). A level-3 silo can fire 3 nukes back-to-back and reloads one tube per 90 ticks from each launch. Upgrading a silo (`UnitImpl.increaseLevel()` line 705-723) **pushes a timer** on upgrade, so the new tube starts on cooldown.

#### 2.3 Flight — Parabola pathfinder (lines 265-292)

`UniversalPathFinding.Parabola(mg, { increment: speed, directionUp })` → `src/core/pathfinding/PathFinder.Parabola.ts`.

Control points (`getParabolaControlPoints`, lines 15-54): cubic Bezier p0=src, p3=dst, `p1.x = p0.x + dx/4`, `p2.x = p0.x + 3dx/4`, `p1.y = p0.y + dy/4 + heightMult*maxHeight`, `p2.y = p0.y + 3dy/4 + heightMult*maxHeight`, `maxHeight = max(distance/3, PARABOLA_MIN_HEIGHT=50)` when `distanceBasedHeight` (default true), `heightMult = directionUp ? -1 : 1`. p1/p2 Y are clamped to `[0, mapHeight-1]` unless `ignoreMapBounds`. So the "parabola" is a screen-space arc bowing toward -Y (up) by dist/3 — it is purely cosmetic; terrain is never consulted.

`DistanceBasedBezierCurve` (`src/core/utilities/Line.ts`) precomputes points spaced `increment` px apart in 1/256 fixed point (deterministic). `next(from, to, speed)` advances `speed` px per call → **one cached point per tick** because spacing == speed. Trajectory tile list = `curve.getAllPoints()` floored to tiles (`NukeExecution.getTrajectory` line 330-343). Flight ticks ≈ curveLength / speed.

Motion plan (`recordMotionPlan`, line 306-328): the full path is sent once to clients as a `grid` plan with `startTick = ticks + waitTicks + 1`, `ticksPerStep: 1`; no per-tick unit updates in flight (`tests/nukes/NukeMotionPlan.test.ts`).

`waitTicks > 0` → decremented each tick before moving (line 260-263). Used by silo stagger, MIRV warheads, and nation SAM-overwhelm salvos.

#### 2.4 Targetability window (lines 345-368)

```ts
isTargetable = dist²(nukeTile, target) < 150² || dist²(src, nukeTile) < 150²
```

Each trajectory tile carries `targetable` (`TrajectoryTile`, `Game.ts:258`). Long flights have a mid-air untargetable zone; SAMs can only engage within 150 tiles of launch or impact (`tests/core/executions/NukeExecution.test.ts:76` "nuke should only be targetable near src and dst").

#### 2.5 Alliance breaking on launch (lines 134-183, `maybeBreakAlliances`)

Not for MIRVWarhead. `listNukeBreakAlliance` (`src/core/execution/Util.ts:100-129`):

- `computeNukeBlastCounts` (`Util.ts:18-37`): circle search of radius `outer`; weight `1` if `d² <= inner²`, else `0.5`; sum per owner.
- Player is "angered" if weighted count `> 100` **OR** any `Structures.types` unit of theirs is within `outer` (`nearbyUnits`).
- For each: reject pending alliance requests both ways, `breakAlliance` if allied (launcher becomes traitor), `attackedPlayer.updateRelation(launcher, -100)`.

`tests/AllianceAcceptNukes.test.ts`: accepting an alliance while a nuke/MIRV/warhead is in flight between the two players destroys it.

#### 2.6 Impact-tile selection (lines 56-128, `tilesToDestroy`)

Default (fallout mode):

```ts
bfs(
  dst,
  (_, n) =>
    d2 <= outer2 && (d2 <= inner2 || rand.chance(2)) && !isImpassable(n),
);
```

`rand = new PseudoRandom(mg.ticks())`. **Inner disc: 100% of tiles. Outer ring: each tile independently 50%**, and since it is a BFS, a tile in the ring that loses the coin flip also blocks propagation behind it (ragged edge). Impassable tiles are never included and block the BFS.

Water-nukes mode: 16 angular samples of `radius² ∈ U[inner², outer²]`, smoothed once (`0.6 self + 0.2 each neighbour`), then a bounding-box scan takes every tile with `d² ≤ interpolated threshold` — a smooth blob, no scattered land pixels (comment line 70-73).

Approximate tile counts (full inner disc + half of ring, ignoring BFS shadowing): Atom ≈ 452 + 1187 ≈ **1.6k tiles**; Hydrogen ≈ 20.1k + 5.7k ≈ **25.8k tiles**; MIRV warhead ≈ 452 + 283 ≈ **735 tiles** each.

#### 2.7 Detonation (lines 370-496, `detonate`)

Order of effects:

1. **Land**: every impacted tile with an owner → `owner.relinquish(tile)`; every land tile → `mg.queueWaterConversion(tile)`; every tile → `mg.queueNukeImpact(tile)` (render-only, drained in `GameRunner.ts:206` as `packedNukeImpacts` for the "nukeable" decoration layer).
   - `GameImpl.queueWaterConversion` (`GameImpl.ts:256-266`): if `!waterNukes()` → `setFallout(tile, true)` immediately; else `WaterManager.queueTile`.
2. **Troops** (`nukeDeathFactor`, `Config.ts:1138-1157`), applied **once per impacted tile** to the player's pool, each outgoing `AttackExecution`, and each transport ship, with `numTilesLeft = tilesBeforeNuke - i` decreasing:
   ```ts
   // Atom / Hydrogen
   return (5 * humans) / Math.max(1, tilesOwned);
   // MIRVWarhead
   targetTroops = 0.03 * maxTroops;
   excess = max(0, humans - targetTroops);
   return 500 * (1 - exp((-2 * excess) / maxTroops));
   ```
   Because `player.troops()` is re-read every iteration, k impacted tiles on an N-tile player remove ≈ `1 - (1 - 5/N)^k` of the army. Example: an atom bomb (≈1.6k tiles) on a 20k-tile player kills ≈ 34%; on a 5k-tile player ≈ 81%. **Kill fraction is inversely proportional to territory size, not to distance from ground zero** — there is no per-ring damage falloff for troops, only the 50% ring inclusion in §2.6. MIRV warheads instead grind the pool toward 3% of max troops (asymptote), 500 troops/tile at most.
3. **Units**: every unit in `mg.units()` with `dist²(dst, unit.tile()) < outer²` is `delete(true, destroyer)` — structures, warships, trade ships, transports, trains. Exempt: AtomBomb, HydrogenBomb, MIRVWarhead, MIRV, SAMMissile (line 452-459). Strict `<` so a unit exactly on the outer radius survives. Structures are destroyed outright regardless of level (no HP, no ring falloff).
4. `redrawBuildings(outer + SPRITE_RADIUS=16)` → `unit.touch()` so clients redraw.
5. `nuke.setReachedTarget(); nuke.delete(false)`; NUKE_DETONATED message per impacted player (not for warheads); `stats().bombLand`.

Interception guard at impact (lines 272-286): if any enemy `SAMMissile` whose `targetUnit()` is this nuke is within `defaultSamMissileSpeed()=12` tiles of `dst`, the nuke does **not** detonate this tick (SAM wins the race).

#### 2.8 Hardcoded vs data-driven

Data-driven (Config methods): magnitudes, speeds, targetable range, cooldowns, costs, death factor, water-nuke toggle. Hardcoded in NukeExecution: `SPRITE_RADIUS = 16`, `rand.chance(2)` (50% ring), 16 angular samples / 0.6-0.2-0.2 smoothing, the `5 *` in `nukeDeathFactor` and MIRV `0.03 / 500 / 2` constants (in Config but literal).

Decision it drives: a nuke is a territory-and-structure eraser with army attrition scaled to the victim's size; the outer 50% ring gives a ragged crater; fallout is permanent-until-conquered scorched earth.

---

### 3. MIRV — `MirvExecution`

File: `src/core/execution/MIRVExecution.ts` (371 lines).

Constants (hardcoded, lines 29-37):

```ts
range = 1500;
rangeSquared;
minimumSpread = 55;
warheadCount = 350;
MATH_SCALE = 100;
longFlightMult = 14;
longFlightLinearPercent = 10;
shortFlightMult = 10;
```

#### 3.1 Launch (lines 74-141)

- `canBuild(MIRV, dst)` (needs owned target tile + ready silo; §2.1).
- `buildUnit(MIRV, spawn, { targetTile, targetPlayer })`; `stats().bombLaunch`.
- **Betrayal on launch** (lines 88-99): break alliance with target player, `-100` relation both ways. `tests/MirvBetrayal.test.ts`: launcher becomes traitor; a fizzled launch has no side effects.
- Separation point: `x = floor((baseX + spawnX)/2)`, `y = max(0, baseY - 500) + 50` (line 100-102) — 450 tiles above the target (or the top of the map).
- Speed normalised so the carrier's flight takes ~`mirvNormalizeTargetTicks()=14` ticks regardless of distance: `idealTicks = bezierLength/15`; if longer than 14, `target = 14 + sqrt(diff)*14/100 + diff*10%`; if shorter, `target = 14 - sqrt(diff)*10/100`; floor 1 tick; `speed = actualLength / targetTicks` in 1/256 fixed point (lines 298-370). `tests/nukes/HydrogenAndMirv.test.ts:234-444` pins these branches and map-edge behaviour.
- Full carrier path precomputed once; MIRV INBOUND banner to target.
- `silo.launch()` — MIRV occupies one tube exactly like an atom bomb (`tests/MissileSilo.test.ts:96`).

#### 3.2 Split geometry (lines 153-227, 237-284)

- From 20 down to 11 ticks before separation: up to 100 attempts/tick to stage targets.
- `tryGenerateTarget`: `r1 = random.next()`, `r2 = (r1 * 15485863) % 1`; `x = round(r1*3000 - 1500 + baseX)`, `y` likewise; must be valid, **land**, within Euclidean `1500` of `dst`, **owned by `targetPlayer`**, and Manhattan `>= 55` from every already-staged target.
- At ≤10 ticks: `finalizeDestinations(500 + (10-remaining)*50)` re-validates ownership, tops up, sorts **farthest-first** by Manhattan distance from `dst`.
- `spawnWarheadsWithWait`: for index `i`, `speedOffset = 0 (i<70) | 1 (<140) | 2 (<210) | 3 (<280) | 4`; each warhead is `new NukeExecution(MIRVWarhead, player, target, separateDst, 22 + speedOffset, remainingTicks + random.nextInt(0,15))` — launched from the separation point, so no silo is involved and no alliance check runs. Warheads exist (with `waitTicks > 0`) while the carrier is still flying so SAMs can pre-target them (`HydrogenAndMirv.test.ts:204`).
- Carrier itself cannot be intercepted (`SAMMissileExecution` whitelist, §4.4); if the carrier unit is deleted (e.g. alliance accepted), all warhead executions are cancelled (lines 143-151).
- Warheads: magnitude `{12,18}`, no NUKE_DETONATED message, MIRV death factor.

Net: up to 350 × ~735 tiles = ~257k tiles inside a 1500-radius disc restricted to one player's land; 55-tile spread means warheads tile the territory rather than overlap.

#### 3.3 Nation MIRV behaviour — `src/core/execution/nation/NationMIRVBehavior.ts`

- `MIRV_COOLDOWN_TICKS = 300` per target, shared static map across nations (line 24-30).
- Preconditions: MIRV not disabled, ≥1 silo, gold ≥ cost, then `random.chance(hesitationOdds)` bails (Easy 2, Medium 4, Hard 8, Impossible 16 → 1-in-N chance to hesitate).
- Triggers in order: counter an inbound MIRV from the largest attacker; **victory denial** when a player/team holds ≥ `75/65/55/40`% of `numLandTiles()` (note: all land, not minus fallout — comment line 55-58); **steamroll stop** when the city leader has > `20/10/10/8` cities and ≥ `2/1.5/1.25/1.15×` the runner-up.
- Target tile = `calculateTerritoryCenter(enemy)`.

---

### 4. SAM launchers and interception

#### 4.1 Range (`Config.ts:1101-1131`)

```ts
defaultSamRange() = 70;
samRange(level) = maxSamRange() - 480 / (level + 5); // maxSamRange() = 150
```

L1 = 70, L2 ≈ 81.4, L3 = 90, L4 ≈ 96.7, L5 = 102, L6 ≈ 106.4, L7 = 110, L10 = 118; asymptote 150. Comment: "level 5 just above hydro range" (hydrogen outer = 100).

Upgrade animates range: `samUpgradeDuration() = floor(SAMCooldown()/2) = 45` ticks; `dynamicSamRange(sam, tick)` lerps `startRange → samRange(targetLevel)` over `duration` from `upgradeStartTick` (state set in `UnitImpl.increaseLevel`, lines 705-714). Client duplicates the formula in `src/client/render/gl/utils/NukeTrajectory.ts:17-24` (`MAX_SAM_RANGE 150, DIVISOR 480, OFFSET 5`, plus `SAM_SAFETY_MARGIN 0.75` for the preview).

#### 4.2 Cooldown, ammunition, stacking

`SAMCooldown() = 90` ticks. Same tube model as silos: **level = simultaneous missiles**; `isInCooldown()` when `queue.length === level`. `SAMLauncherExecution.tick` (lines 333-345) reloads every expired timer, then if not in cooldown fires at as many targets as it has free tubes in one tick (`for target of targets { if isInCooldown() break; launch(); ... }`).

Multiple SAMs: each SAM runs its own `SAMTargetingSystem`; a nuke flagged `setTargetedBySAM(true)` is skipped by every other SAM (`isValidNukeTarget`, line 165-183); the flag is cleared if the missile aborts (`SAMMissileExecution.ts:56-59`). Therefore **total interception capacity over a 90-tick window = Σ(level of every SAM whose dynamic range covers the trajectory)**, one missile per nuke, no double-tapping. `NationNukeBehavior.maybeDestroyEnemySam` (lines 780-1005) models exactly this: `bombsNeeded = Σ covering SAM levels + 1`, plus `floor(needed/5)` spares, all arriving within `floor(SAMCooldown/2) = 45` ticks. Test: `tests/NationNukeSamOverwhelm.test.ts`.

#### 4.3 Interception probability

**There is none.** Interception is deterministic: if the SAM missile reaches its precomputed interception tile before the nuke detonates, the nuke dies. `grep samHittingChance|hittingChance|interceptChance` across `src/core` returns nothing. `SAMLauncherExecution` allocates `this.pseudoRandom ??= new PseudoRandom(this.sam.id())` (line 347) but never uses it — a vestige of a removed hit-chance roll. The only "miss" is geometric: nuke untargetable (mid-air) or out of range at every reachable tick.

#### 4.4 Targeting algorithm — `SAMTargetingSystem` (`SAMLauncherExecution.ts:35-272`)

- Detection sweep: `nearbyUnits(samTile, maxSamRange()*4 = 600, [AtomBomb, HydrogenBomb, MIRVWarhead], isTargetableNearbyUnit)`; skipped entirely when no nuke of those types exists anywhere (`unitCount` fast path, lines 356-362).
- Valid: not `targetedBySAM()`, not own, not friendly (`isFriendly`) — unless game is over in multiplayer and they are on the same team (aftergame fun).
- `computeInterceptionTile` (lines 99-154): walk trajectory from `curIdx` to `len-2`; for each index `i`: `nukeTicks = i - curIdx + waitTicks`, `samTicks = ceil(manhattan(sam, tile) / 12)`, `allowed = dynamicSamRange(sam, ticks + nukeTicks)`; first tile with `targetable && dist² ≤ allowed² && nukeTicks ≥ samTicks` is the interception point, scheduled at `tick = nukeTicks - samTicks`. Early break when distance has increased 3+ consecutive steps and exceeds `maxSamRange`. Fallback `checkDetonationInterception`: if the final tile is targetable and within range, intercept at `trajectory[len-2]`.
- Cache per nuke id: `-1` unreachable at current level (cleared on level-up), `-2` permanently out of reach, else scheduled tick. Fires when `cached.tick ∈ {ticks, ticks+1}`.
- Priority score (lines 185-214): `typeBonus = 70_001 if HydrogenBomb`, `distanceBonus = max(0, 200_000 - manhattan(sam, nukeTarget)*1000)`, `urgencyBonus = max(0, 10_000 - timeToExplode*100)`. Hydrogen first, then nukes aimed nearest the SAM.

#### 4.5 SAM missile — `SAMMissileExecution` (`src/core/execution/SAMMissileExecution.ts`)

- Built at the SAM tile with `targetUnit`; `speed = defaultSamMissileSpeed() = 12` tiles/tick via `PathFinding.Air` (random-walk toward the fixed `targetTile`, §9.3).
- Aborts (deletes itself, clears the nuke's flag) if target inactive, SAM destroyed, target now same owner, or target type not in `[AtomBomb, HydrogenBomb, MIRVWarhead]` (line 45-63).
- On `COMPLETE`: `target.delete(true, owner)`, SAM_HIT message, `stats().bombIntercept(owner, type, 1)`.

#### 4.6 Perf harness

`tests/perf/sam/SAMSwarmPerf.ts`: 100 SAMs, 1000 ticks, 25 missiles/tick; documents the "Behavior B" predictive targeting and the zero-allocation cache.

---

### 5. Fallout

#### 5.1 Storage and lifecycle

- Tile state bit 13 (`GameMap.ts:100, 136`, `FALLOUT_BIT = 13`); `numTilesWithFallout()` counter maintained in `setFallout`/`updateTile` (`GameMap.ts:301-316, 536-544`).
- Set by: `GameImpl.queueWaterConversion` when `waterNukes` is off (`GameImpl.ts:263`) — i.e. **every land tile inside a nuke blast**; and by Doomsday rot (`DoomsdayClockExecution.ts:352`). `setFallout` throws if the tile has an owner (`GameImpl.ts:231`), so fallout only ever exists on unowned land.
- Cleared by: `GameImpl.conquer` (`GameImpl.ts:768`, `this._map.setFallout(tile, false)`) — **conquering a fallout tile makes it a normal tile instantly**; `setWater` (line 247-250) when a water nuke converts it. **There is no timer**: fallout persists until someone takes the tile.

#### 5.2 Effects that exist today

1. **Attack cost and losses** — `AttackExecution.ts:359-361` builds `falloutRatio = hasFallout(tile) ? numTilesWithFallout()/numLandTiles() : null`; `Config.attackLogic` (`Config.ts:851-855`):
   ```ts
   if (input.falloutRatio !== null) {
     const fallout = this.falloutDefenseModifier(input.falloutRatio); // 5 - falloutRatio * 2  (Config.ts:341-345)
     mag *= fallout;
     tileCost *= fallout;
   }
   ```
   Modifier ∈ **[3, 5]** (the code comment "between [5, 2.5]" is wrong: ratio ≤ 1 gives a floor of 3). Since a fallout tile is unowned, the `defender === null` branch applies: attacker loses `mag/5` per tile (`mag/10` for bots) and the tile costs `within(2000*tileCost/attackTroops, 5, 100)/(borderSize*2)` of the tick. Net: a fallout Plains tile costs 3-5× a clean one in both blood and time, and **paradoxically gets cheaper as more of the map is irradiated** (global ratio rises → modifier falls).
2. **Win condition denominator** — `WinCheckExecution.ts:130-137`: `tilesOwned*100 > (numLandTiles - numTilesWithFallout) * percentageTilesOwnedToWin`. Fallout shrinks the pie.
3. **Doomsday bar denominator** — `DoomsdayClockExecution.ts:128`.
4. **Nation AI** — fallout tiles excluded from `PlayerImpl.nearby()` neighbours (`PlayerImpl.ts:614, 666`), from AI expansion/boat targets (`AiAttackBehavior.ts:68, 576, 913`); a dedicated `nuked` strategy captures adjacent fallout land when idle (`tests/AiAttackBehaviorNukedTerritory.test.ts`); Impossible nations use non-fallout land share for crown targeting (`NationNukeBehavior.ts:202-216, 328-335`).
5. **Rendering** — `FalloutBloomPass`, `FalloutLightPass`, `LightmapPass` in `src/client/render/gl/passes/` (visual only).

#### 5.3 Effects that do NOT exist (as of the Phase 0 audit — see "Gaps" A–C below for what session 11 built)

- No production effect. `goldAdditionRate` (`Config.ts:1053-1063`) is a flat `100n`/tick (bots 50) × multiplier, not tile-based. `maxTroops` (`Config.ts:985-1016`) = `2*(tiles^0.6*1000 + 50000) + Σ city levels * 250_000`; `troopIncreaseRate` (`Config.ts:1019-1050`) = `(10 + troops^0.73/4) * (1 - troops/max)`. Neither reads fallout, and since fallout tiles are never owned they cannot be counted anyway.
- No decay / half-life. No radiation damage to units or troops standing on/near fallout.
- No "global fallout" modifier on income or regen; `falloutRatio` reaches only `attackLogic`.

---

### 6. Doomsday Clock

#### 6.1 What it is

An **anti-stall / battle-royale zone**: once armed, every side must hold a rising share of the non-fallout map; a side below the bar is skulled, bleeds troops and warship HP to a floor, then its territory rots into fallout until it is dead. The leader is never doomed. Off unless `gameConfig.doomsdayClock.enabled` (`Schemas.ts:463-466`: only `enabled` and `speed ∈ {slow, normal, fast, veryfast}` are wire-configurable).

#### 6.2 Config — `DOOMSDAY_CLOCK_DEFAULTS` (`Config.ts:194-231`), resolved by `doomsdayClockConfig()` (`Config.ts:281-302`)

```ts
enabled: false, speed: "normal",
warnSeconds: 30,
drainStartPercent: 2, drainMaxPercent: 5, drainRampSeconds: 90,
drainFloorPercent: 5,
floorStartPercent: 40, floorDecaySeconds: 90,
rotDeathSeconds: 150, rotGrainSeconds: 10, rotSpecklePercent: 15,
warshipDrainStartPercent: 1, warshipDrainMaxPercent: 50, warshipDrainCurveExponent: 8,
```

Only `enabled` and `speed` come from the wire; everything else always uses defaults.

#### 6.3 Bar schedule — `src/core/game/DoomsdayClock.ts:54-124`

```ts
LEVELS      = [200, 400, 700, 1100, 1700, 2500, 3500]   // basis points: 2/4/7/11/17/25/35 %
LEVELS_TEAM = [300, 600, 1000, 1500, 2100, 2800, 3500]  // 3/6/10/15/21/28/35 %
SCHEDULES: normal  { graceSeconds: 600, rampSeconds: 7×168, pauseSeconds: 6×54 + 0 }  // 35% at 35:00
           slow    { 600, 7×240, 6×70 + 0 }   // 45:00
           fast    { 600, 7×102, 6×31 + 0 }   // 25:00
           veryfast{ 600, 7×36,  6×8  + 0 }   // 15:00
```

`requiredBasisPoints(profile, elapsed)`: 0 through the 10-minute grace, then per wave a linear ramp `prev + floor((target-prev)*t/ramp)` followed by a flat hold. `doomsdayClockRequiredTiles = floor(bp * land / 10000)` with `land = numLandTiles - numTilesWithFallout`. `doomsdayClockWaveState` is the HUD companion (`src/client/components/DoomsdayClockPanel.ts`).

#### 6.4 Execution — `src/core/execution/DoomsdayClockExecution.ts`

- Runs on `ticks % 10 === 0`. Contenders: `players()` with `type !== Bot`. Sides: singletons in FFA, teams otherwise (`sides()`, line 368-379).
- Idles (clears all marks, deactivates) when a winner is set or fewer than 2 sides.
- Leader = side with most tiles (first wins ties) — **never doomed** (line 136-148).
- Doomed side member each second:
  - `enterDoomsdayClock()`; `secondsUnder = floor(doomsdayClockTicks()/10)`.
  - After `warnSeconds` (30 s): `troopFloor = doomsdayClockTroopFloor(maxTroops, secondsPastWarn)` = linear 40% → 5% of max over 90 s; `chunk = doomsdayClockDrain(maxTroops, secondsPastWarn, cfg)` = `max(1, floor(maxTroops * pct/100))`, pct linear 2 → 5 over 90 s; `removeTroops(min(chunk, troops - floor))`.
  - Rot when `rotDeathSeconds > 0 && secondsPastWarn >= floorDecaySeconds && troops <= floor`: quota `ceil(tilesLeft / max(1, 150 - secondsUnder))` per second, self-correcting to the 150 s deadline; grainy opening for 10 s speckles `ceil(held*15%/100/10)` interior holes (R2 lattice noise) then dendritic spread ranked by rotted-neighbour count + hashed noise. Each rotted tile: `relinquish` + `setFallout(true)` + `markRotted()` (lines 340-365). Structures on rotted land are deleted by `PlayerExecution.tick` (`PlayerExecution.ts:52-54`, structures on unowned land are deleted).
  - Warships: `dmg = doomsdayClockDrain(maxHealth, secondsPastWarn, {start 1%, max 50%}, exponent 8)`, integer fixed-point convex curve (`drainCurveFraction`), capped at `health - floor(maxHealth*5%)`; no attacker passed → environmental loss. `WarshipExecution.healWarship` returns early for doomed owners, retreat is cancelled and repair suppressed (`WarshipExecution.ts:77-82, 135-138, 179-183`).
- Above bar: `clearDoomsdayClock()` and rot state deleted (recovery restarts rot from scratch).

Timeline (comment `Config.ts:207-214`): 0 s skull blinks → 30 s draining → 120 s floor at 5%, rot begins, skull red → 150 s eliminated.

Tests: `tests/DoomsdayClockExecution.test.ts` (logic, warship decay, teams, waves, drain curve, floor, integration, rot); `tests/Warship.test.ts:72-156` (doomed warships).

Decision it drives: a deterministic, integer-only endgame closer that turns the loser's land into fallout rather than handing it to neighbours.

---

### 7. Warships

#### 7.1 Config (`Config.ts:538-545, 940-946, 1160-1229`)

```ts
Warship: cost min(1_000_000, (numUnits+1) * 250_000), maxHealth 1000
Shell:   cost 0, damage 250
warshipShellLifetime() = 20   // unused by ShellExecution (uses shellLifetime)
shellLifetime() = 50          // ticks a shell survives after its firing unit dies
warshipPatrolRange() = 100
warshipTargettingRange() = 130
warshipShellAttackRate() = 20 // ticks between shells
warshipDockingRange() = 5
warshipPortHealingBonusPerLevel() = 5
warshipRetreatHealthPercent() = 75
warshipPassiveHealing() = 1
warshipPassiveHealingRange() = 150
warshipPortSwitchThreshold() = 0.75
warshipMaxVeterancy() = 3
warshipVeterancyHealthBonus() = 20      // % of base max HP per level
warshipVeterancyShellDamageBonus() = 20 // % of rolled damage per level
warshipVeterancyTransportKills() = 10
warshipVeterancyTradeCaptures() = 25
defensePostShellAttackRate() = 100
defensePostTargettingRange() = 75       // unused (ship targeting commented out)
safeFromPiratesCooldownMax() = 20
```

#### 7.2 Spawn

`PlayerImpl.warshipSpawn` (`PlayerImpl.ts:1676-1692`): target must be water; spawns at the closest **active, completed port on the same water component** (`getWaterComponent`); no port → false. Built through `ConstructionExecution` → `new WarshipExecution({ owner, patrolTile })`. `Unit.maxHealth()` = `maxHealthWithVeterancy(1000, vet, 20)` = `1000 + floor(1000*vet*20/100)` → 1000/1200/1400/1600 (`src/core/game/Veterancy.ts`).

#### 7.3 Tick order — `WarshipExecution.tick` (`src/core/execution/WarshipExecution.ts:59-131`)

1. HP ≤ 0 → delete.
2. `healWarship()`: +1 HP/tick if within 150 of any own port; if docked, share `port.level * 5` HP/tick across docked ships (`applyActiveDockedHealing`, remainder carried). Suppressed when doomed.
3. Manual patrol override detection; doomed → cancel retreat.
4. Docked: undock when fully healed or the port is gone; else stay.
5. `handleRepairRetreat()`: while retreating, still shoots transports/warships (`findRetreatAggroTarget`), paths to `retreatPort`, docks within 5 tiles if `dockedShips < port.level()`; re-targets a closer port if `dist² < current * 0.75`.
6. `shouldStartRepairRetreat`: patrolling, not doomed, no manual move in last 50 ticks, `healthBeforeHealing < floor(maxHealth*75/100)`, owner has a port.
7. `findTargetUnit()` → priority **TransportShip (0) > Warship (1) > TradeShip (2)**, ties by distance, within `warshipTargettingRange 130` (`findBestTarget`, lines 251-337). Exclusions: self, same owner, `!owner.canAttackPlayer(unit.owner(), true)` (friendly / AFK-friendly / spawn-immune humans), already shelled (`alreadySentShell`), enemy warships that are `docked`. Trade ships additionally require: owner has an active, completed port on the warship's water component; not `isSafeFromPirates()` (20 ticks after touching a shoreline water tile, `TradeShipExecution.ts:155-157`); trade ship's destination port not owned by / friendly with the warship owner; within `warshipPatrolRange 100` of `patrolTile`.
8. Transport or Warship target → `shootTarget()` then `patrol()`. TradeShip → `huntDownTradeShip()`.

#### 7.4 Shooting — `shootTarget` (lines 634-657) and `ShellExecution`

- Fires when `ticks - lastShellAttack > 20`; **against transports `lastShellAttack` is not updated**, so a warship can shell a new transport every tick (each transport once, via `alreadySentShell`).
- `ShellExecution` (`src/core/execution/ShellExecution.ts`): shell unit spawned at the firer's tile, moves **3 steps/tick** along `PathFinding.Air` toward the target's current tile (re-queried each tick, so it homes). Deleted if target dies, changes to own side, or `shellLifetime 50` ticks after the firing unit dies. On arrival: `target.modifyHealth(-damage, owner)`.
- Damage (`effectOnTarget`, lines 77-95): `roll = nextInt(1,6)` → `(roll-1)*25 + 200` = **200/225/250/275/300** (uniform), × `(100 + vet*20)/100` floored, × `baseDamage/250`. `tests/ShellRandom.test.ts` pins 200-300. A 1000 HP warship dies in 4-5 shells ≈ 80-100 ticks of sustained fire; a veteran-3 ship deals 240-360.
- Transports have no `maxHealth` → `hasHealth()` false → `modifyHealth` drives `_health` to 0 → deleted with destroyer credited (`UnitImpl.modifyHealth`, lines 275-298); `stats().boatDestroyTroops`.
- Veterancy (`UnitImpl.recordKill/recordTradeCapture/addVeterancyProgress`, lines 637-693): killing-blow on a Warship = +1 level and resets progress; transports worth 25 pts, captures worth 10 pts, 250 pts per level (10 transports OR 25 captures). Awarded in `ShellExecution.tick` lines 60-67 only when the shell's owner unit is still an active Warship. Tests: `tests/WarshipVeterancy.test.ts`.

#### 7.5 Trade-ship capture — `huntDownTradeShip` (lines 659-700)

Two movement steps per tick; greedy neighbour step when Manhattan ≤ 20 (minimap upscaling makes A\* jitter); when Manhattan ≤ 5 → `owner.captureUnit(target)` (owner swap, `PlayerImpl.ts:1361-1366`), `recordTradeCapture()`. `tests/Warship.test.ts:158-245` cover port requirement and component rules.

#### 7.6 Patrol — `patrol()` / `randomTile()` (lines 717-824)

Random tile within `±patrolRange/2 = ±50` of `patrolTile`, must be water, not shoreline (first pass), same water component; after 500 misses the range grows ×1.5, up to 3 expansions, then retry allowing shoreline. Guarded against non-integer/out-of-range `patrolTile` (`tests/WarshipPatrolTileGuard.test.ts`). Moves 1 tile/tick via `WaterPathFinder`.

#### 7.7 Manual move — `MoveWarshipExecution`

Dedupes ids, only warships the owner has, only if the new tile is in the same water component; sets `patrolTile` and clears `targetTile`. Changing `patrolTile` disables auto-retreat for 50 ticks (`handleManualPatrolOverride`).

#### 7.8 Nation behaviour — `NationWarshipBehavior.ts`

- `maybeSpawnWarship`: 1-in-50 chance/tick; only if ports > 0, ships == 0, gold > cost; random water tile within ±250 of a random port.
- Retaliation when own transport destroyed / trade ship captured / incoming transport ≥20 from target without a friendly warship within 90: Easy never, Medium 15%, Hard 50%, Impossible 80%; cap 10 warships; relation −7.5 (trade) / −15 (transport).
- Counter warship infestation (Hard/Impossible, top-3 richest nations, >10 warships in game): FFA enemy with >10 warships, or team with >15; builds a warship on top of a random enemy warship tile. `tests/NationCounterWarshipInfestation.test.ts`.

---

### 8. Transport ships

File: `src/core/execution/TransportShipExecution.ts` (337 lines). Wire intent `boat { dst, troops }` → `ExecutionManager.ts:83-84`.

- **Capacity**: no fixed cap. `troops ??= boatAttackAmount() = floor(attacker.troops()/5)` (`Config.ts:936-938`), then `min(troops, attacker.troops())`. Nation AI caps via `troopSendCapForExpansion`.
- **Fleet cap**: `boatMaxNumber() = 3` (0 if TransportShip disabled) checked in `init` and `canBuildTransportShip` (`TransportShipUtils.ts:5-31`).
- **Legality**: target ≠ self; `canAttackPlayer(target)` (human attackers cannot boat a spawn-immune player; nations ignore immunity; friendly/allied blocked, `PlayerImpl.ts:1893-1902`). Boating an ally-target rejects their pending alliance request (`rejectIncomingAllianceRequests`).
- **Landing tile**: `targetTransportTile` → `SpatialQuery.closestReachableShore(owner, attacker, tile, maxDist 50)` — BFS from the clicked tile for the nearest shore land tile owned by the clicked tile's owner whose water component is reachable from the attacker's own shoreline (`SpatialQuery.ts:126-155`).
- **Source tile**: `closestShoreByWater(player, dst)` — multi-source water A\* from all the attacker's shore border tiles to dst, refined (`SpatialQuery.ts:187-220`).
- **Speed**: `ticksPerMove = 1` (hardcoded, line 25). Path recorded once as a motion plan; re-recorded on retreat or water-graph rebuild.
- **Arrival**: `attacker.conquer(dst)` then `new AttackExecution(troops, attacker, target, dst, false)`; if target is friendly, troops are simply added back. Own tile (retreat landing): survivors = `troops * (1 - 25/100)` (`malusForRetreat = 25`, line 19) — **retreating costs 25% of the boat**.
- **Retreat**: `cancel_boat` intent → `BoatRetreatExecution` sets `isRetreating`; destination = `bestTransportShipSpawn(boat.tile())`; auto-retreat if the landing tile has become water (nuke), checked every tick (lines 202-211). No retreat destination or path → troops refunded in full and boat deleted.
- Vulnerability: one shell kills it (§7.4); nuke death factor applies per impacted tile to troops aboard (§2.7).
- Team takeover of a disconnected teammate's boat is honoured (lines 186-196).

---

### 9. Water and air pathfinding

#### 9.1 Water chain — `src/core/pathfinding/PathFinder.ts:47-67`

`AStarWaterHierarchical` (HPA*, cluster graph on the 2× minimap, owned by `WaterManager`) → `ComponentCheckTransformer` (reject different components) → `SmoothingWaterTransformer` (LOS binary-search smoothing avoiding magnitude < 2/3, local A* on the first/last 50 tiles) → `ShoreCoercingTransformer` (shore endpoints → best water neighbour and back) → `MiniMapTransformer` (upscale ×2). Fallback when the graph has < 100 nodes or nav mesh disabled: plain `AStarWater` (heuristic weight 5, 1M iterations, magnitude penalty: `< 3` from shore ×10 cost, `3..10` free, `> 10` +1 — `AStar.Water.ts:10-15`). One shared chain per game per `waterGraphVersion`; `WaterPathMemo` (24 MB LRU, keyed `from*numTiles+to`, flushed on any `waterVersion` change) is opt-in for trade ships. `WaterPathFinder` wraps a per-unit stepper with a 0..49-tick stagger (`STAGGER_SPREAD = 50`) so ships do not all re-plan the tick a nuke changes the graph.

#### 9.2 Water nukes — `src/core/game/WaterManager.ts`

`tick()` flushes queued tiles (skipping any conquered or impassable since queuing; clears fallout), then `finalizeWaterChanges`: propagate ocean bit, recompute magnitude `ceil(dist_to_coast/2)` capped 31 within ±62 of crater groups (union-find crater clustering), fix shoreline bits in a 2-ring, downsample to minimap (2×2 → water if ≥3 of the valid 4 sub-tiles), propagate minimap ocean + magnitude, fold into persistent `ConnectedComponents` (components only merge), mark graph dirty. Graph rebuild at most every `WATER_GRAPH_REBUILD_INTERVAL = 20` ticks and never on the same tick as a conversion. Tests: `tests/nukes/WaterNukes.test.ts`.

#### 9.3 Air — `src/core/pathfinding/PathFinder.Air.ts`

Seeded by `game.ticks()` at construction. Each step moves one tile in X or Y toward the target; when both differ, X with probability `1/ratio` where `ratio = floor(1 + |dy|/(|dx|+1))`. Used by shells and SAM missiles; ignores terrain entirely.

#### 9.4 Parabola — see §2.3. `tests/NukeTrajectory.test.ts` tests the client-side mirror (`src/client/render/gl/utils/NukeTrajectory.ts`) of control points, targetable thresholds and SAM intercept sampling.

---

### 10. Nation nuke behaviour — `src/core/execution/nation/NationNukeBehavior.ts`

- Constants: `MAX_NATION_SILO_UPGRADE_LEVEL = 5`, `HIGH_DENSITY_NUKE_THRESHOLD = 1/75` structure-levels per tile, `MIN_LEVEL_SUM_FOR_HIGH_DENSITY_NUKE = 5`; 1-in-3 nations are "hydro nations" (only hydrogen unless under heavy attack).
- Target choice order: sole remaining enemy (Hard+), incoming attacker, high-density target (Impossible richest nation, 50%), crown > 50% of non-fallout land (Impossible FFA), ally's targets, most hated hostile not ≥2× weaker, FFA crown ahead by 40/30/20/10% of non-fallout land, strongest team.
- Tile scoring: structures in outer radius (City 25k·lvl, DefensePost 5k·lvl, Silo 50k·lvl, Port 15k·lvl, Factory 15k·lvl); Medium: −1 if any SAM within 50; Impossible hydrogen: +100k·lvl per outrangeable SAM (level < 5); −30/tile distance to nearest own silo (floor 20% of structure value); −1M per recent (≤600 ticks) own nuke overlapping inner radius.
- Hard/Impossible reject trajectories interceptable by any enemy SAM (`isTrajectoryInterceptableBySam`, mirrors the client preview: skips the mid-air untargetable segment, uses static `samRange(level)`).
- Perceived cost inflates ×1.5 per atom, ×1.25 per hydrogen to "save for a MIRV".
- SAM overwhelm (§4.2) with per-bomb `waitTicks` so all arrive within 45 ticks; upgrades the best-protected unblocked silo when tube capacity is the bottleneck.

---

### Gaps vs FightWars brief

#### A–C. Nuke consequences — **built (Phase 5, brief §6.4, session 11)**

Fallout used to be a mark that lasted exactly until someone walked onto it. It is now a mark with a clock, and the clock has consequences. Everything below sits behind `Config.falloutHasConsequences()` (true; the `--legacy-fallout` lever on `balance:run` flips it and makes the duration effectively infinite).

- **A timer.** `GameImpl.setFallout(tile, true)` pushes `[ticks + falloutDurationTicks(), tile]` onto a flat queue; durations are constant, so pushes arrive in expiry order and `expireFallout()` — once a second, like the Doomsday Clock — pops from the front, clears the bit, bumps the territory version, decrements the owner's count and records the tile. No per-tile timestamp store. `falloutDurationTicks()` = 1800 (three minutes).
- **Fallout on owned land.** `GameImpl.conquer` no longer clears the bit: a tile changes hands still irradiated and the new owner's `_irradiatedTiles` carries it until it expires (`relinquish` and expiry decrement). Detonation is unchanged — it still relinquishes and then irradiates — so owned fallout arises only through conquest, which is what "costing extra to cross for minutes" needs: the `falloutRatio` input to `attackLogic` now fires on defended tiles too, which the old semantics made impossible.
- **Production.** `Config.maxTroops` uses `numTilesOwned() − numIrradiatedTiles()` for the land term and skips cities for which `Unit.isIrradiated()` (`mg.hasFallout(tile)`, mirrored on `UnitView`). Gold is flat per tick and untouched — the brief's "producing nothing" is troops, which is what land and cities produce.
- **Global escalation.** `troopIncreaseRate(player, worldFalloutRatio)` multiplies by `falloutRegenModifier(ratio)`: 1 up to `falloutRegenThreshold()` = 5 % of the world's land, then linearly down to 1 − `falloutRegenDepth()` = 0.25 at a wholly irradiated world. `PlayerExecution` and the HUD's `ControlPanel` both pass `numTilesWithFallout() / numLandTiles()`. Everyone pays, the nuker included — MAD without a rule that names it.
- **The crossing modifier, the right way up.** `falloutDefenseModifier` was 5 − 2·ratio: the more the world burned, the _cheaper_ irradiated ground was to cross, which rewarded escalation. It is now 3 + 2·ratio, the same range the other way. The golden rows with fallout moved for exactly this reason and nothing else.
- **Nuclear winter extends the existing clock.** `DoomsdayClockExecution.tick` computes `elapsed = elapsedGameSeconds() + floor(falloutRatio × cfg.nuclearWinterSecondsPerFalloutShare)`, a new entry in `DOOMSDAY_CLOCK_DEFAULTS` (600: a world a tenth irradiated runs its clock a minute ahead) resolved by `doomsdayClockConfig()` and zeroed by the master switch — so the clock's own tests, which build that config by hand, needed one extra field and nothing else. One input to the one clock, so the HUD, the leader exemption and the side grouping stay single-sourced. Off when the clock is off, as before.
- **Wire.** `PlayerUpdate.irradiatedTiles` rides the **object** lane — it changes when a nuke lands or a mark expires, not every tick — compared in `diffPlayerUpdate` and merged in `applyStateUpdate`; `PlayerView.numIrradiatedTiles()`.

Tests: `tests/nukes/FalloutConsequences.test.ts` — the clock, conquest carrying the mark, the count following the tile, land and cities counting for nothing, the regen curve at its threshold and depth, the rate reaching `PlayerExecution`, the crossing modifier's direction. Three breaks watched: expiry never firing, the master switch off, the land subtraction removed.

**Not done:** the client draws fallout exactly as before (the bit is the same bit; an owned irradiated tile renders as territory under the fallout overlay, which already exists) — a fading overlay as the clock runs down is a Phase 4 item 3 concern. Structures other than cities are unaffected by standing on fallout. Gold production is untouched.

#### D. Submarine / carrier / bomber / artillery hooks in the warship/shell pattern

- **Pattern**: an emitter execution (`WarshipExecution.shootTarget` / `DefensePostExecution.shoot`) chooses a target and adds `new ShellExecution(spawnTile, owner, ownerUnit, targetUnit)`; the shell homes via `PathFinding.Air` at 3 steps/tick and applies `modifyHealth(-effectOnTarget(), owner)`. Veterancy is credited back through `ownerUnit.recordKill` only if `ownerUnit.type() === Warship` (`ShellExecution.ts:60-67`) — generalise that check for new hull types.
- **Registration points for any new unit type**: `UnitType` enum + `Structures`/`BuildMenus` groups (`Game.ts:233-250`); `Config.unitInfo` switch (cost, maxHealth, constructionDuration); `PlayerImpl.canSpawnUnitType` switch (`PlayerImpl.ts:1561-1596`, `assertNever` forces the case); `ConstructionExecution.completeConstruction` switch (`ConstructionExecution.ts:100-135`); `UnitImpl.delete` stats switch (`UnitImpl.ts:344-364`); nuke unit-deletion exemption list (`NukeExecution.ts:452-459`) if the unit is airborne.
- **Artillery — built (Phase 5, brief §6.4, session 12).** `UnitType.Artillery`, a land structure in `Structures` (`landBasedStructureSpawn`, the shared spacing flood). `src/core/execution/ArtilleryExecution.ts`: once per `Config.artilleryAttackRate()` (50 ticks) the gun reads its owner's `incomingAttacks()`, measures from its tile to each attack's `clusteredPositions()` (one representative tile per disconnected border segment — attacks are not units, which is why this is not a `ShellExecution` emitter), and takes `artilleryDamage()` (2000 troops) off the nearest attack within `artilleryRange()` (40 tiles), never below zero; an attack shelled to nothing ends on its own next tick. Deterministic: registration order, ties to the first. Bounded: incoming attacks × a few clusters, once per volley per gun. Cost curve `min(500k, (n+1) × 100k)`, 10 s to build, materials 400 × `materialsPriceScale`, upkeep 15 × `armsUpkeepScale`; stats key `arty`. Nations: `getStructureRatios` entry at `Config.artilleryNationRatio()` (0.2 per city, Fortress ×1.5 through `doctrineNationBuildScale`), placed by `artilleryValue()` — high ground, the border at half the range, room from other guns. Client: build menu, hotbar (`J`), keybind settings, disabled-units toggle, help modal, ghost range preview, stats table; the defense post's build sound and atlas glyph for now. No shell is drawn for a volley — the render pass is Phase 4 work, noted in `BUILD-STATE.md`. Lever `balance:run --no-artillery` (ratio 0) reproduces the previous commit's hash.
- **Submarine — built (Phase 5, brief §6.4, session 12).** Not a flag on `WarshipState` but a hull: `UnitType.Submarine` in `BuildableAttacks`, the warship's params, `warshipSpawn` (a port on the same water), and **the same `WarshipExecution`** — its constructor takes the hull (`Warship` by default; from an existing unit, the unit's type) and builds it. Two things differ by hull. Prey: `findTargetUnit` for a submarine is `[TransportShip, TradeShip]` (never a warship; `findRetreatAggroTarget` transports only), for a warship `[TransportShip, Warship, Submarine, TradeShip]`. Sight: in `findBestTarget` an enemy submarine is skipped unless `detectsSubmarine` — within `Config.submarineDetectionRange()` (12 tiles) of this ship, or under one of the owner's active radars (`radarRange`, §04 E) — exactly where docked enemies are skipped. Everything else is the warship's: patrol, retreat, docking (`dockedShipsAtPort` counts both hulls), healing, veterancy (`ShellExecution` credits both), the move intent (`MoveWarshipExecution` moves both), capture on conquest, the doomsday decay. Cost `min(1.5M, (n+1) × 400k)`, health 1000, materials 800 × `materialsPriceScale`, upkeep 40 × `armsUpkeepScale`, stats key `subm` (recorded; the stats table's warship section is the warship's, noted). It does not blockade (`Blockade.ts` reads warships) — a hidden siege would be a different unit. Nations: a Naval-doctrine nation's second hull is a submarine (`NationWarshipBehavior.hullFor()`, read by the standing-fleet build and the retaliation build alike — the standing build alone fires a handful of times a game, which is why the first A/B was byte-identical); `Config.submarineNationEnabled()` is the switch and `balance:run --no-submarine` the lever, reproducing the previous commit's hash. Client: the warship's sprite column, box-select and select-all, hover and the unit overlay, build menu, hotbar `V`, keybind settings, disabled-units toggle, help modal.
- **Carrier — built (Phase 5, brief §6.4, session 12), for two of the four port semantics.** `UnitType.Carrier` is a third `WarshipExecution` hull (`BuildableAttacks`, the warship's params, `warshipSpawn`): no guns (`findTargetUnit` / `findRetreatAggroTarget` return nothing for it), health 2000, prey for any warship at the warship's priority. It is a harbour that sails in exactly the two places a harbour can move: `PlayerImpl.warshipSpawn` picks the nearest _port or carrier_ on the same water (`units(Port, Carrier)`), so a fleet can be reinforced far from home; and `healWarship`'s passive heal counts an owner's carrier within `warshipPassiveHealingRange` like a port (the carrier never heals itself). The other two — docking (`isPortFullOfHealing`, `findNearestPort`, the `retreatPort` tile in `WarshipState`) — are **not** generalised on purpose: a retreat is a tile stored on the wire and matched by `port.tile()` equality, and a carrier moves; docking to a moving harbour needs the retreat target to become a unit id, which is a wire change for the whole warship state. Cost `min(3M, (n+1) × 1M)`, materials 1500 × `materialsPriceScale`, upkeep 60 × `armsUpkeepScale`, stats key `carr` (kept out of the buildings table like the other hulls). Nations: a Naval nation's second hull (`hullFor()`: warship, then carrier, then submarine — the raider is sunk too soon to be the hull a third waits on, which the first A/B proved by being byte-identical on Medium and Impossible alike); `Config.carrierNationEnabled()` is the switch and `balance:run --no-carrier` the lever, reproducing the previous commit's hash. Client: the warship's sprite column, selection, hover and the unit overlay, build menu, hotbar `X`, keybind settings, disabled-units toggle, help modal.
- **Paratrooper — built (Phase 5, brief §6.4, session 12), the sixth.** `UnitType.Paratrooper` in `BuildableAttacks`, the transport's params (`troops`, `targetTile`), spawned by `PlayerImpl.paratrooperSpawn(tile)`: the nearest active, built silo within `Config.paratrooperRange()` (120 tiles) of a land tile the player does not hold and may attack (cooldown ignored — a drop is not a warhead). `src/core/execution/ParatrooperExecution.ts` is the naval invasion's shape with an air path: `paratrooperTroops(player)` = min(`paratrooperMaxTroops()` 25 000, ⌊troops ÷ 5⌋) leave with the plane (`buildUnit` takes `params.troops`, as for a transport), the target is warned (`NAVAL_INVASION_INBOUND`), the plane steps `paratrooperStepsPerTick()` (2) tiles a tick along `PathFinding.Air`, and on landing the tile is conquered and an `AttackExecution` opens from it — or the troops come home if the ground is the owner's by then, or join a friend's as a transport's would. Nothing intercepts it (a SAM reads a warhead's `trajectory()`, which a drop does not carry): the silo's range, the cap and the price (400k flat, materials 500 × `materialsPriceScale`) are its limits, and stats count it with the boats. The build intent needs no new wire: like a nuke, the build menu sends `buildUnit` with the target tile. Nations: `AiAttackBehavior.sendBoatAttack` — a player target out of reach by land — tries `maybeDrop` first (a silo in range of a sampled tile of the target's, the price met), and the random-target boat builder does the same; `Config.paratrooperNationEnabled()` is the switch, `balance:run --no-paratrooper` the lever. Client: the transport's sprite and trail, the incoming-attacks panel lists drops with boats, build menu (target-click), hotbar `I`, keybind settings, disabled-units toggle, help modal.
- **Bomber — built (Phase 5, brief §6.4, session 12).** Exactly the audit's shape: `UnitType.Bomber` is a `NukeType` (`StatsSchemas`, key `bombr`) in `BuildableAttacks`, flown by `NukeExecution` from the nearest ready silo like an atom bomb (`nukeSpawn`; `ConstructionExecution` dispatches it with the two bombs), `nukeMagnitudes` {4, 8}, `nukeSpeed` 8, gold 250k flat, materials 300 × `materialsPriceScale`. In `detonate` the strike is _conventional_: the units in the radius die and `nukeDeathFactor` takes its troops, but no tile is relinquished, none is queued for water conversion or the nuked layer, so the land keeps its owner and there is no fallout; `maybeBreakAlliances` still runs (bombing an ally is hostile). The airborne-exemption list in the same method and every SAM whitelist (`getValidTargets`, the `unitCount` fast path, `SAMMissileExecution.nukesWhitelist`) list it, so a SAM shoots it down like a warhead. Nations: `maybeSendNuke`'s chooser takes a bomber when it holds a silo and can afford neither warhead — `Config.bomberNationEnabled()` is the switch, `balance:run --no-bomber` the lever, and it reproduces the previous commit's hash. Client: the atom bomb's sprite (unit atlas, same story as the icon atlas), trail and launch/landing sounds, a smaller impact ring, `NUKE_TYPES` / `NUKE_MAGNITUDES` for the telegraph, build menu, hotbar `N`, keybind settings, disabled-units toggle, help modal, blast ghost, stats table. Its own inbound line (`NUKE_INBOUND`) and `events_display.bomber_detonated`.

#### E. Radar stations extending SAM reach — **built (Phase 5, brief §6.4, session 12)**

`UnitType.Radar`, a land structure in `Structures`. A SAM within `Config.radarRange()` (60 tiles) of an active, built radar of its owner's intercepts `Config.radarSamRangeBonus()` (30) tiles further, capped at `maxSamRange()` (150) so the interception sweep's `maxSamRange`-based constants still bound the search. The bonus is read exactly where the audit said it had to be: `Config.dynamicSamRange(sam, tick)` is now `min(maxSamRange, baseSamRange + sam.samRangeBonus())`, and the four nation call sites that duplicated the static formula (`isTrajectoryInterceptableBySam`, `nukeTileScore`, `findEnemySamsCoveringTile`, `maybeUpgradeHelpfulSilo`) go through it, so a nation's coverage estimate cannot disagree with the launcher. `Unit.samRangeBonus()` (`UnitImpl`) is a `nearbyUnits` query cached per tick. The client gets it on the object lane — `UnitUpdate.samRangeBonus` (absent when 0) → `UnitView.samRangeBonus()` / render `UnitState.samRangeBonus` — and `SamRadiusPass` draws `samRangeWithBonus(level, bonus)` (`NukeTrajectory.ts`, the client's copy of the cap); `RadarExecution` re-sends every SAM it covers when it goes up and when it falls, because nothing about the SAM itself changed. Cost `min(2M, (n+1) × 750k)`, 15 s, materials 500 × `materialsPriceScale`, upkeep 20 × `armsUpkeepScale`, stats key `radr`; nations at `radarNationRatio()` (0.1 per city, never without a SAM to extend) placed by `radarValue()` (as many own SAMs in reach as possible, weighted by level). Client: build menu, hotbar `H`, keybind settings, disabled-units toggle, help modal, range ghost (and placing one shows the SAM rings), stats table; the SAM's build sound and atlas glyph for now. Lever `balance:run --no-radar` reproduces the previous commit's hash. The hook notes below are the audit's, kept for the record.

- **Single read point**: `Config.dynamicSamRange(sam, tick)` (`Config.ts:1118-1131`) is what `SAMTargetingSystem` uses for both the interception scan and the detonation fallback. The detection sweep radius is `maxSamRange()*4 = 600` and the early-break uses `maxSamRange()²` (`SAMLauncherExecution.ts:108, 141, 229`), so any range extension must stay ≤ 150 or those constants must follow.
- **Duplicates to keep in sync**: `NationNukeBehavior` uses static `samRange(level)` in `isTrajectoryInterceptableBySam` (line 620), `findEnemySamsCoveringTile` (line 1023), `nukeTileScore` (line 711) and `maybeUpgradeHelpfulSilo` (line 1078); the client preview reimplements the formula in `NukeTrajectory.ts:17-24`. A radar bonus applied only in `dynamicSamRange` would make nations misjudge SAM coverage and the client preview lie.
- **Hook**: `dynamicSamRange` receives the `Unit`, so `sam.owner().units(UnitType.Radar)` (or `mg.nearbyUnits` via the unit's game handle) can add a bonus; route the three nation call sites through the same method (they already hold the `Unit`), and expose the bonus to the client through the SAM's `SamLauncherState` (`Game.ts:53-58`) so the preview reads a range, not a level.

---

## 05 — Diplomacy, Win Conditions, Teams, Bots/Nations AI, Difficulty, Veterancy

Repo: `C:\Users\disbo\dev\fightwars` (OpenFront fork). All paths below are relative to that root. Ticks are 100 ms (10/s) — `Config.ts:939` "one tick is 100ms". Every number is quoted from source; nothing is inferred.

Conventions: `PlayerType` = `Bot` ("BOT", the map-filling tribes), `Human`, `Nation` (the AI states) — `src/core/game/Game.ts:373-377`. "Friendly" = same team OR allied, and never a disconnected player unless `treatAFKFriendly` (`PlayerImpl.ts:1272-1280`).

---

### Relations (the numeric score behind everything)

- Storage: `PlayerImpl.ts:169` `private relations = new Map<Player, number>()`. Missing entry reads as 0.
- Range: `PlayerImpl.ts:951-958` `updateRelation(other, delta)` → `within(relation + delta, -100, 100)`. Throws on self.
- Bucketing `PlayerImpl.ts:928-939` (`Relation` enum `Game.ts:327-332`: Hostile=0, Distrustful=1, Neutral=2, Friendly=3):
  - `< -50` → Hostile
  - `< 0` → Distrustful
  - `< 50` → Neutral
  - `>= 50` → Friendly
- Decay `PlayerImpl.ts:960-970`, called every tick from `PlayerExecution.ts:46`: each stored score moves 0.05 toward 0 per tick (0.5/s, 30/min); snapped to 0 when `|r| < 0.1`. A -100 fully decays in 2000 ticks = 200 s. Note: decay runs for **every** player (humans too), but only nation code reads relations — for humans it is purely informational (client `playerProfile()` `PlayerImpl.ts:1842-1853` exposes `relations: Record<smallID, Relation>` + `alliances`).
- Deltas applied (every `updateRelation` call site in `src/core`):
  | Event | File:line | Delta on whose view of whom |
  |---|---|---|
  | Attack started on a player | `AttackExecution.ts:168-186` | target's view of attacker: Easy -60 / Medium -70 / Hard -80 / Impossible -100 (applied once at `init`) |
  | Alliance formed by counter-request | `AllianceRequestExecution.ts:47-48` | both directions +100 |
  | Alliance broken | `BreakAllianceExecution.ts:38,47` | victim → breaker -100; every neighbour of breaker (`nearby()`, not on victim's team) → breaker -40 |
  | Target player | `TargetPlayerExecution.ts:26` | target → requester -40 |
  | Gold donation | `DonateGoldExecution.ts:59-62` | recipient → sender: `chunks*5` capped 100 (formula below) |
  | Troop donation | `DonateTroopExecution.ts:64-66` | recipient → sender +50 if `troops >= minTroops` (random, difficulty-scaled — below) |
  | Nuke lands on you | `NukeExecution.ts:179-181` | victim → launcher -100 |
  | MIRV launched at you | `MIRVExecution.ts:95-98` | -100 both directions |
  | Emoji 🖕 to a nation | `NationEmojiBehavior.ts:291-292` | nation → sender -100 |
  | Emoji 🤡 to a nation | `NationEmojiBehavior.ts:302-303` | -10 |
  | Emoji 🕊️/🏳️/❤️/🥰/👏 to a nation | `NationEmojiBehavior.ts:313-316` | +15 **Easy only** |
  | Embargo placed on a nation | `NationExecution.ts:294-315` | nation → embargoer -20 (reversed +20 when lifted; one-shot per player via `embargoMalusApplied` set) |
  | Nation warship retaliation | `NationWarshipBehavior.ts:254` | nation → enemy -7.5 (trade capture) / -15 (transport sunk) |
  | Nation assists an ally's target | `AiAttackBehavior.ts:516` | nation → ally -20 (cost of the favour) |
- Data-driven vs hardcoded: entirely hardcoded literals in executions. No config knob.
- Decision it drives: nation alliance accept/reject (`relation < Neutral` → reject), nation `hated` attack strategy (only `Relation.Hostile`), nation nuke target ("most hated"), nation auto-embargo (`<= Hostile` → embargo), assist-ally gating (`< Friendly` → refuse), attack-emoji flavour.

---

### Alliances — request, accept, duration, extension, expiry

#### Request

- Entry: intent `allianceRequest` (`Schemas.ts:638-641`) → `AllianceRequestExecution` (`ExecutionManager.ts:85-86`). `activeDuringSpawnPhase()` = false (queued until spawn ends).
- Gate `PlayerImpl.ts:796-841` `canSendAllianceRequest(other)`: false if `disableAlliances()`, self, either side disconnected, already friendly, requester dead, a pending outgoing to `other` exists. **True immediately** if `other` has a pending request to us (counter-request). Otherwise cooldown: most recent past request to `other` must be `>= allianceRequestCooldown()` = `30 * 10` = 300 ticks = **30 s** (`Config.ts:771-773`). Note only `pastOutgoingAllianceRequests` (accepted or rejected ones, pushed in `GameImpl.ts:426-428,442-444`) count; a still-pending one is blocked outright.
- Creation `GameImpl.ts:371-399`: refuses if already allied or a duplicate pending exists; if the recipient already has a request pending to the requester it accepts that instead.
- Counter-request path `AllianceRequestExecution.ts:37-57`: accepts the incoming request, +100 relation both ways, ends **temporary** embargoes both ways (`endTemporaryEmbargo`), and calls `cancelNukesBetweenAlliedPlayers` (`:89-171`) which deletes in-flight AtomBomb/HydrogenBomb (when `wouldNukeBreakAlliance` on the target tile, `Util.ts:51-95`), MIRV (by `targetPlayer` captured at launch) and MIRVWarhead (by tile owner) between the two, and displays `alliance_nukes_destroyed_*`. Tests: `tests/AllianceAcceptNukes.test.ts` (9 cases).
- Request lifetime `AllianceRequestExecution.ts:64-79`: auto-rejected when `ticks - createdAt > allianceRequestDuration()` = `20 * 10` = **20 s** (`Config.ts:768-770`).
- Reject: intent `allianceReject` → `AllianceRejectExecution.ts` finds the requester's outgoing request to us and `.reject()`s it.
- Attacking someone auto-rejects **their** pending request to you (`AttackExecution.ts:105,368-`), and a nuke auto-rejects the target's pending requests (`NukeExecution.ts:152-157`) and rejects the launcher's own outgoing request to the victim so an alliance cannot be "accepted mid-flight" (`:165-173`).

#### Duration and extension

- `AllianceImpl.ts:17` `expiresAt_ = createdAt_ + mg.config().allianceDuration()`.
- `Config.ts:774-780` `allianceDuration()`: if `customAllianceDuration` (minutes, `zb.uint({max:15})`, `Schemas.ts:539`) is a number `> 0` → `m * 60 * 10` ticks; else **`300 * 10` = 3000 ticks = 5 min**. `customAllianceDuration === 0` OR legacy `disableAlliances` → `disableAlliances()` true (`Config.ts:389-396`). Tests: `tests/CustomAllianceDuration.test.ts` (0 disables; 1-15 min → ticks; unset → 5 min).
- Expiry: `PlayerExecution.ts:94-98` each tick: `if (alliance.expiresAt() <= ticks) alliance.expire()` → `GameImpl.expireAlliance` (`:849-866`) detaches and emits `AllianceExpired`. **No traitor flag on expiry.**
- Extension window: `allianceExtensionPromptOffset()` = 300 ticks = 30 s before expiry (`Config.ts:1243-1245`). `PlayerImpl.allianceInfo` (`:772-794`) reports `inExtensionWindow`, `canExtend` (both alive, neither disconnected, in window, not already agreed).
- `AllianceExtensionExecution.ts:15-79`: marks the caller's flag on the `AllianceImpl` (`extensionRequestedRequestor_/Recipient_`, `:43-54`); when both flags set → `extend()` (`:82-86`) resets flags and sets `expiresAt_ = now + allianceDuration()` (a fresh full duration from the moment of agreement, not appended). First single agreement emits `wants_to_renew_alliance` to the other side. Note the execution does not check the window itself — an extension can be requested any time (`GameImpl`/`AllianceImpl` do not gate on `inExtensionWindow`; only the client UI does). Tests: `tests/AllianceExtensionExecution.test.ts`.
- Death: `PlayerExecution.removeOnDeath` (`:497-515`) → `removeAllAlliances()` silently (no traitor).

#### Breaking — the traitor timer

- Intent `breakAlliance` → `BreakAllianceExecution.ts:25-51` → `player.breakAlliance(alliance)` → `GameImpl.breakAlliance` (`:823-847`): **breaker is marked traitor only if the other side is neither already a traitor nor disconnected** (`:835-837`). Emits `BrokeAlliance{traitorID, betrayedID}`.
- `PlayerImpl.markTraitor` (`:863-869`): `markedTraitorTick = now`, `_betrayalCount++` (also for nations), `stats().betray(this)` (humans only in stats).
- `isTraitor()` = `getTraitorRemainingTicks() > 0` where remaining = `traitorDuration() - (now - markedTraitorTick)` (`:851-861`). `traitorDuration()` = `30 * 10` = **30 s** (`Config.ts:272-274`). A re-break restarts the timer.
- Other break paths that also go through `breakAlliance` (so also mark traitor): nuke hitting an ally past threshold (`NukeExecution.ts:175-178`), MIRV launch at an ally (`MIRVExecution.ts:90-94`), nation `betray()` (`NationAllianceBehavior.ts:430-434`), tribe breaking with a traitor neighbour (`TribeExecution.ts:105-109`).
- Nuke threshold: `nukeAllianceBreakThreshold()` = 100 (`Config.ts:1076-1078`). `listNukeBreakAlliance` (`Util.ts:100-129`): weighted tiles in blast (inner radius = 1, outer ring = 0.5) `> 100`, OR **any structure of that player inside `magnitude.outer`**. MIRV warheads never break alliances (`NukeExecution.ts:135-138`).

#### What traitor status changes

- Combat `Config.ts:894-895,905-907,924-932` `attackLogic`: `traitorLossMod = defender.isTraitor ? traitorDefenseDebuff() : 1` where `traitorDefenseDebuff()` = **0.5** (`:266-268`) multiplies the attacker's troop loss (attacker loses half as much against a traitor); `traitorCostMod = traitorSpeedDebuff()` = **0.8** (`:269-271`) multiplies `tickFraction` (tiles fall 20% faster). Only applies while the traitor **defends**.
- `AiAttackBehavior.shouldAttack` (`:935-955`): traitors are always attackable (bypasses the Easy 75% / Medium 25% "leave humans alone" rolls).
- Nation alliance decision: traitors rejected 90% of the time (`NationAllianceBehavior.ts:96-101`).
- Nation strategy `traitor` (Medium+): attack weakest bordering traitor `< 1.2x` our troops in FFA (`AiAttackBehavior.ts:522-535`).
- Nation `maybeBetray`: betray traitors `< 1.2x` our troops (non-Easy) (`NationAllianceBehavior.ts:407-415`).
- Tribes: `getNeighborTraitorToAttack` — random non-friendly traitor neighbour; tribe breaks its own alliance first if allied (`TribeExecution.ts:100-113`, odds 1/6 if friendly else 1/3).
- Nation emoji `annoyTraitors` 🤡 (`NationEmojiBehavior.ts:169-184`).
- Exposed to clients as `isTraitor` + `traitorRemainingTicks` (`PlayerImpl.ts:384-385`).
- Persistence: `_betrayalCount` (`betrayals()`, `:909-911`) is the only cumulative memory; it is **never read by the sim** (stats only).

Decision it drives: 30 s is short — betrayal is a tactical, not strategic, cost. There is no lasting reputation.

---

### Teams

- `Team = string` (`Game.ts:86`). `ColoredTeams` (`:102-113`): Red, Blue, Teal, Purple, Yellow, Orange, Green, Bot, Humans, Nations.
- `TeamCountConfig` (`Schemas.ts:440-456`): a number, or `"Duos"|"Trios"|"Quads"|"Humans Vs Nations"`.
- `resolveTeamsList` (`TeamAssignment.ts:185-216`): HvN → [Humans, Nations]; Duos/Trios/Quads → `ceil(total/2|3|4)` teams; `< 2` throws; `< 8` uses colour names in order Red, Blue, Yellow, Green, Purple, Orange, Teal; `>= 8` → `"Team N"`.
- Assignment `assignTeams` (`:15-161`): (1) server-pinned `teamIndex` honoured unconditionally (matchmaking); (2) clans strict — one team, overflow **kicked**; (3) friends soft — prefer team with most friends, spill rather than kick; Duos/Trios/Quads fill fullest-first, otherwise emptiest-first; nations placed last (shuffled by `simpleHash(nations[0].id)`). `maxTeamSize = ceil(players/teams)`. FFA: `GameImpl.maybeAssignTeam` returns null; bots always `botTeam` (`GameImpl.ts:681-690`).
- `isOnSameTeam` (`PlayerImpl.ts:1259-1270`): false for self, null team, or if either is `ColoredTeams.Bot` — **bots share a team label but can attack each other** (confirmed `tests/Team.test.ts:13`).
- Team HUD/spawn: `teamSpawnArea` per map (`GameImpl.ts:977-993`, `teamGameSpawnAreas` keyed by team count).
- Tests: `tests/TeamAssignment.test.ts` (24 cases), `tests/Team.test.ts`.

---

### Donations

- Config flags `donateGold`/`donateTroops` (`Schemas.ts:481-482`, "to humans only") — checked only when the **recipient is Human** (`PlayerImpl.ts:1077-1082,1107-1112`); donating to a nation is always allowed if friendly. Public lobbies: `donateGold: mode === Team`, `donateTroops: mode === Team` (`MapPlaylist.ts:412-413`).
- Gate `canDonateGold/Troops` (`PlayerImpl.ts:1067-1125`): not self, both alive, `isFriendly` (ally or teammate; disconnected recipients are not friendly), and per-recipient cooldown `donateCooldown()` = `10 * 10` = **10 s** (`Config.ts:740-742`) tracked in `sentDonations`.
- Amounts: gold default `sender.gold() / 3n` (`DonateGoldExecution.ts:49`); troops default `defaultDonationAmount` = `floor(sender.troops()/3)` (`Config.ts:737-739`), clamped to recipient's headroom `maxTroops(recipient) - recipient.troops()` (`DonateTroopExecution.ts:45-47`); `<= 0` → inactive. No per-donation cap beyond that.
- Relation reward for gold (`DonateGoldExecution.ts:93-124`): chunk = Easy 2 500 / Medium 5 000 / Hard 12 500 / Impossible 25 000; `adjustedChunk = chunk * (1 + ticks / (3000 + numSpawnPhaseTurns()))` (doubles every 5 min of play); `+5` per full chunk, capped 100. Nation replies with ❤️ (≥50) / 👍 (>0) / ❓🥱 (0).
- Relation reward for troops (`DonateTroopExecution.ts:91-123`): `minTroops = random in [max/13, max/11]` Easy, `[max/11, max/9]` Medium, `[max/9, max/7]` Hard, `[max/7, max/5]` Impossible, where `max = maxTroops(recipient)`; `>= minTroops` → +50 and ❤️, else ❓🥱.
- Nation donation behaviour: `AiAttackBehavior.donateTroops` (`:1130-1265`) — team games only, **not** Public, `donateTroops` on, no winner yet, Easy never / Medium 25% / Hard 50% / Impossible always; picks the in-combat teammate with the lowest `troops/maxTroops` it can donate to; gives `troops - maxTroops*reserveRatio`.
- Tests: `tests/Donate.test.ts`, `tests/AllianceDonation.test.ts`.

---

### Embargoes and trade routing

- Storage `PlayerImpl.ts:137` `embargoes: Map<PlayerID, Embargo{createdAt, isTemporary, target}>`.
- `addEmbargo(other, isTemporary)` (`:1214-1230`): a permanent embargo is never downgraded (`existing && !isTemporary → return`); emits `EmbargoEvent start`. `stopEmbargo` deletes and emits `stop`. `endTemporaryEmbargo` only removes temporary ones.
- Manual: intent `embargo {targetID, action}` → `EmbargoExecution` (permanent). Intent `embargo_all` → `EmbargoAllExecution.ts:9-27`: cooldown `embargoAllCooldown()` = 100 ticks = **10 s** (`Config.ts:743-745`), skips bots and teammates.
- Automatic temporary embargo: **attacking a non-bot player as a non-bot** adds `addEmbargo(attacker, true)` on the target (`AttackExecution.ts:97-106`); lifted automatically when an alliance forms (`AllianceRequestExecution.ts:50-54`) or after `temporaryEmbargoDuration()` = `300 * 10` = **5 min** (`Config.ts:781-783`, checked in `PlayerExecution.ts:100-108`).
- Effect — `canTrade(other)` (`PlayerImpl.ts:1204-1208`) is false if **either** side embargoes the other. Consumers: `PortExecution.ts:108` (trade-ship destination ports filtered to `canTrade`), `TradeShipExecution.ts:93` (in-flight ship aborts if dst owner stops being tradable), `TrainStation.ts:78` (rail traffic), `SharedWaterCache.ts:119`, `NationStructureBehavior.ts:1136` (nations ignore embargoed neighbours when scoring rail connectivity). Trade income by relationship is `Config.trainGold(rel: "self"|"team"|"ally"|"other", …)` (`Config.ts:449-`).
- Nation auto-embargo `NationExecution.handleEmbargoesToHostileNations` (`:317-363`): relation `<= Hostile` → embargo; lift at `>= Neutral` only on Easy/Medium; lift at `>= Friendly` on Hard; **Impossible never lifts**. Hard/Impossible in team games embargo every non-teammate non-bot ("stop trading with all").

---

### Targeting ("target player")

- Intent `targetPlayer` → `TargetPlayerExecution.ts:23-28`: `canTarget` (`PlayerImpl.ts:972-985`): not self, not friendly, and **global** cooldown — any target within `targetCooldown()` = `15 * 10` = 15 s blocks (`Config.ts:765-767`). Effect: `targets_.push({tick, target})`, `GameImpl.target` emits `TargetPlayer` update, victim relation -40.
- `targets()` returns only those younger than `targetDuration()` = `10 * 10` = **10 s** (`Config.ts:762-764`). `transitiveTargets()` (`:1000-1006`) = union of own targets and every ally's targets — used by the client HUD (`PlayerIcons.ts:111`) to draw crosshairs.
- Sim effect: nations read `ally.targets()` in `assistAllies` (`AiAttackBehavior.ts:497-519`) — attacks the target if relation to the ally `>= Friendly`, target is not self/friendly, and `sendAttack` succeeds; nuke target selection also honours ally targets (`NationNukeBehavior.ts:220-231`). No effect on humans beyond UI.

---

### Emoji and quick chat

- Emoji: intent `emoji {recipient: id|"AllPlayers", emoji: index}` (`Schemas.ts:658-664`, index into `flattenedEmojiTable`, `Util.ts:435-452`). `canSendEmoji` (`PlayerImpl.ts:1032-1050`): per-recipient cooldown `emojiMessageCooldown()` = 50 ticks = **5 s**; visible for `emojiMessageDuration()` = 50 ticks = 5 s (`Config.ts:753-758`). `EmojiExecution.ts:36-57` sends then `respondToEmoji` (nation auto-reply, relation deltas above).
- Nation casual emoji `NationEmojiBehavior.maybeSendCasualEmoji` (`:57-68`, runs every nation attack tick): overwhelmed (incoming ≥ 3× troops, 1/16 roll, broadcast 💀🆘…), very small human attack (<10% troops, 1/8, ❓/🥱), congratulate winner (team: all nations if another team won; FFA: largest nation only), brag 👑 (1/300 if crown), charm human allies (1/250), annoy traitors 🤡 (1/40), rat 🐀 (after 10 min, 1/10000, humans < 1% land), greet neighbours 👋 (first minute, 1/250). `shouldSendEmoji` (`:261-276`): nations only, humans only as recipients, 300-tick (30 s) per-recipient throttle on the "maybe" variants; bots never emote.
- Quick chat: intent `quick_chat {recipient, quickChatKey, target?}` (`Schemas.ts:725-`), keys from `resources/QuickChat.json` (help 8, attack 5, defend 5, greet 16, misc 7, warnings 17). `canSendQuickChat` per-recipient cooldown `quickChatCooldown()` = 30 ticks = **3 s** (`Config.ts:759-761`, `PlayerImpl.ts:1052-1064`). `QuickChatExecution.ts:29-62` emits two `displayChat` events (sender-side and recipient-side). No sim effect.

---

### Spawn phase

- Length `Config.numSpawnPhaseTurns()` (`:817-825`): Singleplayer **100** ticks (10 s, but SP ends the instant the human picks — `SpawnExecution.ts:108-115`); randomSpawn **150**; otherwise **200** ticks (20 s). `SpawnTimerExecution.ts:10-14` ends the phase when `ticks > numSpawnPhaseTurns()` (multiplayer only, `GameRunner.ts:108-110`).
- `GameImpl.inSpawnPhase()` = `startTick === null` (`:467-469`); executions with `activeDuringSpawnPhase() === false` are neither ticked nor `init`ed until it ends (`:484-506`) — so all diplomacy/donation/attack intents queued during spawn fire on the first post-spawn tick (nations explicitly reject alliance requests with `createdAt <= numSpawnPhaseTurns()+1`, `NationAllianceBehavior.ts:33-39`).
- Spawn intent: `SpawnIntentSchema {tile: uint}` (`Schemas.ts:623-628`) → `SpawnExecution(gameID, player.info(), tile, fromIntent=true)` (`ExecutionManager.ts:74-82`). `SpawnExecution.tick` (`:47-116`): rejects invalid refs; **rejects a client intent unless it was queued during the spawn phase** (`queuedDuringSpawnPhase` captured in `init`, `:42-45,74-76`); with randomSpawn a player who has spawned cannot re-roll (`:78-81`); otherwise relinquishes all current tiles and re-conquers around the new centre (re-picking is allowed). Spawn footprint `getSpawnTiles` (`Util.ts:140-159`): BFS within Euclidean radius **4** of the centre; for chosen tiles invalid tiles (owned/water/impassable) are filtered; for random spawns all must be valid. First spawn also attaches `PlayerExecution` and, for bots, `TribeExecution` (`:99-104`).
- Random spawn (`:126-185`): up to `MAX_SPAWN_TRIES = 1000`; needs land, unowned, not border; for the first `RELAX_MIN_DIST_AT = 750` tries enforces `manhattanDist >= minDistanceBetweenPlayers()` = **30** (`Config.ts:784-786`) from every other player's `spawnTile()`; honours team spawn areas.
- Spawn immunity: `spawnImmunityDuration()` = `gameConfig.spawnImmunityDuration ?? 50` ticks (5 s) (`Config.ts:314-318`, `DEFAULT_SPAWN_IMMUNITY_TICKS = 5*10` `:166`); nations always 50 (`nationSpawnImmunityDuration`). `isImmune()` (`PlayerImpl.ts:1883-1891`) applies to humans and nations; `canAttackPlayer` (`:1893-1902`) — **only human attackers respect immunity**. Public "Peace Time" modifier sets 2400 ticks = 4 min (`MapPlaylist.ts:406-407`); 25M gold → 1500, 5M → SAM build (300) + 150 (`:794-804`).
- Unspawned humans: nothing places them; `players()` (alive = has tiles) simply omits them. Ranked 2v2 is voided if any of `maxPlayers` humans never spawned (`WinCheckExecution.ts:57-82`).

---

### Win conditions

- `WinCheckExecution` added in `GameRunner.init` (`:122`); checks every 10 ticks (`:35`); inactive in spawn phase.
- `hasWon(tiles)` (`:115-139`): true if `elapsedGameSeconds >= maxTimerValue*60` (lobby timer, minutes), or `>= HARD_TIME_LIMIT_SECONDS = 170*60` (`:26`), or **`tiles * 100 > (numLandTiles - numTilesWithFallout) * percentageTilesOwnedToWin(elapsed)`**.
- `percentageTilesOwnedToWin` (`Config.ts:788-812`): base `PERCENT_TILES_OWNED_TO_WIN = 80` (`:234`); with overtime enabled (`OVERTIME_DEFAULTS` `:240-244`: `startMinutes 30`, `dropPercentPerMinute 2`, no floor) the bar drops `floor(secondsPast * 2 / 60)` whole points after `startMinutes`. Public FFA lobbies enable overtime by default (`MapPlaylist.ts:201`).
- FFA (`:84-111`): the largest alive player wins (`setWinner(max)`); ranked 1v1 also ends when only one non-disconnected human remains.
- Team (`:141-189`): sums `numTilesOwned` per team over alive players; largest team vs the same `hasWon`; **`ColoredTeams.Bot` can never win** (`:184`). Ranked 2v2 ends when one team has all alive non-disconnected humans.
- `GameImpl.setWinner` (`:915-928`) snapshots final tiles and emits `Win{winner: ["player", clientID] | ["team", name, ...eligibleClientIDs] | ["nation", name]}`. Team-win eligibility `isEligibleForTeamWin` (`:934-948`): on team, has clientID, spawned; if disconnected, their `disconnectSnapshot` must show the team already at `>= teamLandShareWinThresholdTenths()/10` = **70%** of land when they dropped (`Config.ts:276-278`).
- No "last man standing" rule outside ranked; a stalled FFA is ended only by overtime, the timer, or the 170-min hard limit. Doomsday clock (separate section) is the other anti-stall.
- **Battle Royale (FightWars, session 13, brief §6.7):** `GameConfig.battleRoyale` (appended to the wire schema; `Config.battleRoyale()`) registers `BattleRoyaleExecution` in `GameRunner.init`. The zone is a circle on the map's centre; its starting radius is the distance to the farthest corner (every tile inside), and after `battleRoyaleGraceTicks()` (1800 = three game minutes after the spawn phase) it shrinks in `battleRoyaleSteps()` (12) equal steps of radius, one every `battleRoyaleIntervalTicks()` (300 = thirty seconds), to `battleRoyaleFinalRadiusPercent()` (10 %) of the start. From the first shrink on, a sweep cycles the map `battleRoyaleRowsPerTick()` (32) rows a tick, walking only the part of each row outside the circle's chord: every owned land tile outside the radius is `relinquish`ed and every clean one `setFallout(true)` — the state a nuke leaves, which `hasWon` already discounts from the land count, so the win bar tracks the zone — and at the end of each pass every active unit standing outside is `delete(false)`d. The sweep never stops because fallout clears itself after `falloutDurationTicks` (1800) and irradiated ground can be conquered: a first cut that scorched once let the nations reclaim the whole map within a pass of the fallout's lifetime (the A/B that found it is in `BUILD-STATE.md`), so the zone is a standing rule, and ground reclaimed outside it is lost again within one pass (about three seconds on a 1000-row map). Integer maths only (squared distance against a squared radius; the chord's half-width is corrected to the exact integer after the float estimate). Each step posts `events_display.battle_royale_shrink` (`MessageType.BATTLE_ROYALE_SHRINK`, appended to the enum). Public rotation: `isBattleRoyale` modifier (three tickets, never beside a doomsday clock or Blitz), badge on the lobby card; a host or solo player toggles it under `game_settings.battle_royale`. `tests/BattleRoyale.test.ts` pins the step schedule, the irradiated-and-relinquished edge, the untouched centre, a unit outside destroyed, a conquest outside the zone undone and the fallout outliving its lifetime, and nothing happening with the flag off. Lever: `balance:run --battle-royale`.
- **Capital Strike (FightWars, session 13, brief §6.7):** `GameConfig.capitalStrike` (appended; `Config.capitalStrike()`) registers `CapitalStrikeExecution`. A nation's capital is its spawn tile — the tile `SupplyNetwork` already feeds from — so no new unit and no wire change. Once a second (like the win check) every living human or nation whose spawn tile another player holds collapses: `conquerPlayer(taker, fallen)` first (gold, the kill, the finishing place — the existing bookkeeping), then a rebel tribe (`PlayerType.Bot`, `"<name> Rebels"`, `markPartisanOf(taker, fallen.smallID())`) takes every other tile, the troops and every active unit (`captureUnit`) the nation held, and gets `PlayerExecution` + `TribeExecution(rebels, taker)` — the §6.6 partisan machinery, so the taker cannot absorb the remains as an enclave and has to fight for them. A capital merely lost — nuked, irradiated, relinquished, Battle Royale — does not fall: `owner(capital)` must be another player. Bots (tribes, partisans) have no capital. Broadcast `events_display.capital_fell` (`MessageType.CAPITAL_FELL`, appended). Public rotation: `isCapitalStrike` (three tickets, no exclusions — it composes with the clock and Battle Royale); badge on the lobby card; a lobby toggle under `game_settings.capital_strike`. `tests/CapitalStrike.test.ts`: the collapse (land, troops, a structure elsewhere to the rebels; the capital tile to the striker; the nation dead), a capital lost to fallout untouched, a held capital untouched, nothing with the flag off; `tests/server/MapPlaylistModes.test.ts`: both modes reach the config and the card. Not done: a capital marker on the map and in the attack-hover breakdown (the spawn tile is not drawn today), nations aiming at capitals. Lever: `balance:run --capital-strike`.
- **King of the Hill (FightWars, session 13, brief §6.7):** `GameConfig.kingOfTheHill` (appended; `Config.kingOfTheHill()`) registers `KingOfTheHillExecution`. The hill is every land tile within `hillRadiusPercent()` (6 % of the shorter side) of the map's centre; when the centre is water the centre moves to the first land tile on the smallest square ring around it (`nearestLand`, deterministic, ring by ring), so every map has a hill. Once a second (`ticks % 10`) the owner with the most hill tiles — a player in FFA, a `team()` in a team game — scores one; a tie or an empty hill scores nobody. At `hillSecondsToWin()` (300, cumulative, not consecutive) the holder wins through the same `setWinner(holder, stats)` the land win uses, so the record, the ratings and the post-match screen see an ordinary win; `ColoredTeams.Bot` cannot win, as with land. The land win check keeps running beside it. Every 300 ticks the standing is broadcast (`events_display.hill_standing` / `hill_unheld`, `MessageType.HILL_STANDING`, appended); the win posts `hill_won`. Rotation: `isKingOfTheHill` (three tickets, never beside the doomsday clock or Battle Royale — the hill is the clock, and a shrinking zone already says where to fight); badge; lobby toggle under `game_settings.king_of_the_hill`. `tests/KingOfTheHill.test.ts`: the hill on the centre and all land, the holder scoring a second a second and winning at the target, an empty hill and a tie scoring nobody, the centre moved onto land on `half_land_half_ocean`. Not done: the hill drawn on the map and a score readout in the HUD (the feed carries the standing every thirty seconds), nations that contest the hill. Lever: `balance:run --king-of-the-hill`.
- **The zone layer (FightWars, session 13):** the modes' zones reach the map through `GameUpdateType.Zone` (`ZoneUpdate {kind: ZoneKind.BattleRoyale | Hill, x, y, radius, active}`, appended to the update enum — updates cross the worker boundary by structured clone, not the wire, so the order is a courtesy). `BattleRoyaleExecution` sends one on every shrink, `KingOfTheHillExecution` once on its first tick. `GameView` keeps one live zone per kind (`_zones`, cleared by `active: false`) and puts the list on `FrameData.zones` only on ticks it changed; `uploadFrameData` pushes it through `FrameUploadTarget.updateZones` (`MapRenderer` → `Renderer` → `ZonePass`). `ZonePass` (`render/gl/passes/`, shaders `shaders/zone/`) is the range circle's single-quad SDF with a kind switch: the Battle Royale ring is a two-tile warm rim (the fallout's hue) that breathes on wall-clock time with a faint haze outside it; the hill is a gold disc at low alpha with a firm one-tile rim. Drawn under the range circle, above the SAM radius, in `renderOverlays`. `tests/client/view/ZoneView.test.ts` (one per kind, latest wins, cleared, the frame's list untouched on quiet ticks), and the two mode tests assert the updates. Not drawn: a capital marker (Capital Strike still has no tell on the map).
- **Survival (FightWars, session 13, brief §6.7):** `GameConfig.survival` (appended; `Config.survival()`) registers `SurvivalExecution`. Co-op: the host and single-player modals send `gameMode: Team` and `playerTeams: HumansVsNations` whenever the toggle is on (the existing preset — `GameImpl.addPlayers` puts every human on `ColoredTeams.Humans` and every nation on `ColoredTeams.Nations`), and the playlist's `isSurvival` modifier forces the same after the roll (`mode`, `playerTeams`, `nations: "default"` — the difficulty line then reads Hard; never beside a peace time, the 25M purse or hard nations, which HvN already is). Once a second after the spawn phase: no living human → `setWinner(ColoredTeams.Nations)`; `elapsedGameSeconds() >= survivalSeconds()` (1200 = twenty minutes) → `setWinner(ColoredTeams.Humans)`; otherwise every `survivalWaveTicks()` (1200 = two minutes) wave n hands each living nation `floor(maxTroops × survivalWaveTroopShare() (0.15) × n)` troops (capped at its ceiling) and `survivalWaveGold()` (200k) × n gold, and broadcasts `events_display.survival_wave` (`MessageType.SURVIVAL_WAVE`, appended). The land win keeps running beside it (nations at the bar have overrun the humans; humans at it have earned the early end), and a lobby timer shorter than the survival clock ends the game the old way — the playlist sets none. `tests/Survival.test.ts`: the sides, the waves (each nation reinforced, more each time, the human's tick regeneration alone), the humans winning at the clock, the nations winning the second the last human falls, nothing with the flag off; `tests/server/MapPlaylistModes.test.ts` gains the forcing. Not done: nations that aim at the humans rather than each other (they fight by team already, but pick targets as usual), a wave countdown in the HUD. Lever: `balance:run --survival` (no humans in the instrument, so the waves inflate the nations against each other).
- **Placements (FightWars, session 13, brief §6.7):** `PLACEMENT_GAMES` = 10 and `placementOf(games)` in `src/api/Matches.ts`. The rating moves from the first game as before (Glicko-2's deviation already says how little it means); what changes is what is shown. `/public/player/:id` `ratings.<ladder>.placement` is `{played, of}` until placed, then `null`; `/users/@me` `player.leaderboard.oneVone|twoVtwo.placement` the same (absent once placed; `PlacementSchema` appended to the client's `UserMeResponseSchema`, optional, so the strict parse keeps it); `/leaderboard/ranked` lists placed players only (`r.games >= PLACEMENT_GAMES`), while `/public/leaderboard/:ladder` stays the raw data endpoint with `games` on every row. The ranked modal's card says "Placement: n of 10 games" instead of the number while it is in progress (`rankedStanding`). `tests/api/Profiles.test.ts`: a three-game player carries the placement on profile and `/users/@me`, is off the ladder, and a placed player's field is null; `tests/client/RankedStanding.test.ts`: the card's line.
- **Historical scenarios (FightWars, session 13, brief §6.7):** `src/core/game/Scenarios.ts` is the data — `SCENARIOS` (`ww1` 1914 on Europe, two blocs; `ww2` 1939 on Europe, three; `coldwar` on World, three; `warringstates` on China, free-for-all) — each a cast of `ScenarioNation {name, manifestName?, doctrine, bloc?}`. `GameConfig.scenario` (appended, the id; `Config.scenario()`) makes `createNationsForGame` return `scenarioNations`: the manifest lends each named nation its spawn and flag (a kingdom can wear a province's under its own name), the scenario gives the doctrine (`Nation.doctrine`, passed to `SpawnExecution` by `NationExecution` so the nation keeps it instead of rolling one) and the bloc (`PlayerInfo.teamIndex`, honoured by `assignTeams` as a pin, so humans are dealt into the same teams). The count settings do not apply to a scenario; a name the manifest does not know is skipped. The lobby (host and solo) has a Scenario section — none, or a card per scenario with its era and blocs; picking one sets the map, the mode (team when it has blocs) and the team count to the bloc count, through the modals' own handlers; the join view does not show it. Bloc names are cosmetic today: the teams are the game's colours in bloc order. Not in the rotation. `tests/Scenarios.test.ts`: every cast member is on its map's manifest and every bloc in range, the cast built with spawn, flag, doctrine and pin, a nation spawned with a scenario doctrine keeping it, an unknown id no scenario; `tests/client/GameSpeedSettings.test.ts` gains the cards, the event, and the host taking map, mode and blocs.
- **Draft (FightWars, session 13, brief §6.7):** server lobby state, never the sim's. `GameConfig.draft` (appended) with team mode: `GameServer` seats two captains — the host and the first other seated player (`syncDraft`, re-run on every `gameInfo`, on config edits, and when the roster changes; a captain leaving resets the draft) — pins them to teams 0 and 1, and the captain on turn (snake order A B B A A B …, `draftTurn`) sends a `draft_pick` intent (appended to `IntentSchema`; `IntentAuthorization` lets any seated player through before the start) naming a pooled player, who is pinned to that captain's team (`draftPins`). Pins ride the same path as matchmade pins — `draftTeamIndex(c) ?? matchmakingTeamIndex(c)` on the lobby list (`ClientInfo.teamIndex`), telemetry and the game start's players — so `assignTeams` honours them and the unpicked are balanced as usual. `GameInfo.draft` (`DraftInfoSchema {captains, turn, picked}`, appended) tells the lobby; `LobbyPlayerView.renderDraft` replaces the team preview with the two sides and the pool, and only the captain on turn sees Pick buttons (`draft-pick` DOM event → `SendDraftPickIntentEvent` → the transport). The host's Draft toggle forces team mode with two teams. **Found on the way:** `applyGameConfigPatch` copies only listed keys, so every mode flag added this session (`gameSpeed`, `battleRoyale`, `capitalStrike`, `kingOfTheHill`, `survival`, `scenario`, `draft`) was dropped from a host's lobby edits after creation — fixed, with each key in `tests/server/ConfigPatch.test.ts`. Not done: captains picking spawn regions (the map's team spawn areas stay in team order) or doctrines for their side, and a pick timer. `tests/server/Draft.test.ts`: the captains and the first turn, snake order and the pins on the list, the refusals, off without the flag and off again when the host clears it; `tests/client/LobbyDraft.test.ts`: the board.
- **Post-match analytics (FightWars, session 13, brief §6.7):** client-side only. `MatchTimeline` (`src/client/view/`) records every fifty ticks the tiles of every living player (`GameView.update` after `populateFrame`) and every `BrokeAlliance` update the tick it arrives; nothing the sim reads. `<match-report>` (`hud/layers/MatchReport.ts`) sits at the top of the win modal (and the death modal, with what has been played so far): land share over time for the five largest at the end with the viewer always among them (an SVG line chart — `REPORT_SERIES_COLORS`, five categorical hues in fixed rank order validated on the modal's surface with the dataviz validator, every adjacent pair over the colour-blind floor; two-pixel lines, three hairline gridlines, one axis in percent of land, direct labels at the line ends plus a legend, a hover crosshair with a readout, and "Show as a table" for the same numbers at six times); the viewer's gold by source from the win's `allPlayersStats` (`GOLD_INDEX_*` — single-hue bars with the value beside each; "available when the game ends" on the death modal); tiles held per thousand troops sent (`ATTACK_INDEX_SENT`); and the alliances broken, humans' first, with the minute. `tests/client/view/MatchTimeline.test.ts` (the cadence, the series, the leaders, the view feeding it), `tests/client/MatchReport.test.ts` (rank order and colours, legend, table, breaks; the short game and the gold notice).
- **Caster view (FightWars, session 13, brief §6.7 spectator/caster):** `<caster-panel>` (`hud/layers/CasterPanel.ts`, in `index.html` beside the win modal, a `Controller` in `GameRenderer`'s list) shows for whoever is watching rather than playing — `GameView.isSpectator()`: a spectator, a replay, a player who has died — once the spawn phase ends, and stays hidden for a living player. Top right under the clock, collapsible. Three parts: a **win projection** — the leader (first of `MatchTimeline.leaders(5)`, live tiles before the first sample) against the win bar (`Config.percentageTilesOwnedToWin(elapsed)`, land less fallout), a bar of share over bar, and `projectWin(shares, 5 s, bar)`: a straight line through the leader's last thirty samples (two and a half minutes), minutes to the bar at that pace, "past the bar" at or over it, "not closing" when flat or falling; the lobby timer's remaining time when one is set — the **territory chart** (`<territory-chart>`, `TerritoryChart.ts`: the chart moved out of the match report so both draw it the same way, `compact` for the panel) — and **the five largest now**, troops and gold each with its own small bar on its own scale (two measures, two columns, never one axis). `tests/client/CasterPanel.test.ts`: the projection's arithmetic (pace, flat, falling, past, too few points), a watcher's panel with the projection, the rows in rank order and the chart, the collapse, and a living player seeing nothing. Not done: a replay scrubber beside it, a caster's pick of which players to follow, a screenshot in the browser pane (a dead player or a replay is needed to see it; jsdom rendered it).
- **Rulesets (FightWars, session 13, brief §6.9 data-driven balance):** `GameConfig.ruleset` (appended; `RulesetSchema {version: 1, values: [{key, value}] ≤ 200}`) is a lobby's list of overrides for the tunables. `src/core/configuration/Tunables.ts` is the registry — 91 keys, one per scalar accessor in `Config.ts` whose body was a plain number, each with the number the code carries and bounds (0 to ten times the default; integers rounded) — and `clampTunable` the only way in: an unknown key is ignored, a value clamped. Every one of those accessors now reads `this.tunable("<its name>", <its number>)` (`tunableGold` for gold), with an empty-ruleset fast path so a lobby without rules costs nothing per call; the timing and lobby knobs (`msPerTick`, `gameSpeed`, `bots`, `goldMultiplier`, the spawn-immunity pair, the spawn-phase and bot counts) are deliberately outside the registry, and accessors with logic in them are untouched. The ruleset rides the game config every client and the shadow sim share, so lockstep holds whatever the lobby set. `resources/rulesets/default.json` is the registry as data — the versioned config of record; `npm run rules:export` regenerates it and `tests/Ruleset.test.ts` keeps the two equal. The host lobby has a Custom rules editor (JSON in, applied on a click; bad JSON, a wrong shape or an unknown key is refused with the reason and nothing pushed; Reset clears), `ConfigPatch` carries `ruleset` so the edit reaches the game, and the join view says "N custom rules". `balance:run --ruleset <file.json>` runs the instrument under one. Not done: a form in place of the JSON box, hot reload mid-game (the ruleset is read at construction — a change is a new lobby), the accessors with logic (`allianceDuration`'s bands, the cooldown pairs) as tunables, and a ruleset picker for public lobbies. `tests/Ruleset.test.ts` (override, clamp and rounding, unknown key and gold, the excluded knobs, the file of record, the wire's refusals), `tests/client/RulesEditor.test.ts`, `tests/server/ConfigPatch.test.ts` gains the key.
- Leader detection: none is persisted. `checkWinnerFFA` sorts by tiles every 10 ticks but keeps nothing. Nation code independently recomputes "crown" in `NationNukeBehavior.findFFACrownTarget` (`:295-360`) and the Impossible >50% crown rule (`:198-217`), and `NationMIRVBehavior.selectVictoryDenialTarget` (`:154-198`) — these are the only "leader" computations in the sim.

---

### Disconnection and pause

- Server (`GameServer.ts:1690-1720`): a client whose last ping is older than `disconnectedTimeout` gets a server-injected `mark_disconnected` intent (clients cannot send it — `IntentAuthorization.ts:43-44`); reconnect/ping flips it back. Spectators never reach the sim.
- `MarkDisconnectedExecution.ts:9-23` → `PlayerImpl.markDisconnected(true, snapshot{currentTick, teamTiles, totalLand, wasAlive})` (`:1800-1820`); snapshot kept from the first disconnect until reconnect.
- Effects: `isFriendly(other)` is false toward a disconnected player (`:1272-1280`) so **allies and teammates can attack them**; `attackLogic` sets `mag = 0` (no attacker losses) when `defender.isDisconnectedTeammate` (`Config.ts:871-874`, computed at `AttackExecution.ts:355-356`); alliance requests to/from them are blocked; extension `canExtend` false; nation `afk` strategy hunts disconnected bordering enemies (FFA: `< 3x` our troops); ranked win checks skip them; team-win eligibility above. Tests: `tests/Disconnected.test.ts`.
- Pause: intent `toggle_pause` → `PauseExecution.ts:17-24`: only lobby creator or singleplayer; `GameImpl.setPaused` emits `GamePaused`. Active during spawn phase.

---

### Veterancy (warships only)

- `Config.ts:1202-1229`: `warshipMaxVeterancy 3`, `warshipVeterancyHealthBonus 20` (% of base max health per level), `warshipVeterancyShellDamageBonus 20` (% per level), `warshipVeterancyTransportKills 10`, `warshipVeterancyTradeCaptures 25`.
- `Veterancy.ts:11-23` `maxHealthWithVeterancy = base + floor(base * vet * bonus / 100)`. `UnitImpl.ts:617-665`: warship kill → instant level and progress reset; transports and captures share one integer meter (`transportThreshold * captureThreshold` points per level). Shell damage `ShellExecution.ts:85-92` `dmg * (100 + vet*20) / 100`. Not healed on level-up. Tests: `tests/WarshipVeterancy.test.ts` (11 cases). No player-level veterancy exists.

---

### Bots, tribes, nations — what each is and how many spawn

| Kind          | PlayerType | Created by                                                                                                                   | Count                                                                                                                                                                                                                                                                       | Controller                                                                                | Troop/gold profile                                                                                                                                                                                                                                                                                             |
| ------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tribe ("bot") | `Bot`      | `TribeSpawner.spawnTribes(numTribes)` (`TribeSpawner.ts:32-80`) from `GameRunner.init` when `config.bots() > 0` (`:117-121`) | `gameConfig.bots` (`zb.uint({max:400})`); public lobbies **400** (100 on compact) (`MapPlaylist.ts:453`)                                                                                                                                                                    | `TribeExecution` attached at first spawn (`SpawnExecution.ts:101-103`)                    | `startManpower 10 000` (`Config.ts:957-959`), `maxTroops / 3`, troop growth `* 0.5`, gold `50n`/tick vs 100n, starting gold 0, attack ratio `troops/20` vs `/5`, terra-nullius loss `mag/10` vs `/5`, humans/nations lose `0.7x` attacking them (`BOT_DEFENDER_LOSS_MULT`), conquering one yields all its gold |
| Nation        | `Nation`   | `createNationsForGame` (`NationCreation.ts:28-105`) in `createGameRunner` (`GameRunner.ts:63-69`)                            | `config.nations`: `"disabled"` → 0; number (1-400) → exact, filling from manifest → `additionalNations` pool → procedurally generated names (`:107-163`); `"default"` → all manifest nations, except Public HvN (= human count) and Public compact (25%, min 1, `:166-177`) | `NationExecution` per nation (`ExecutionManager.ts:158-164`, added when `spawnNations()`) | difficulty-scaled (table below); starting gold like humans                                                                                                                                                                                                                                                     |
| Human         | `Human`    | server `GameStartInfo.players`                                                                                               | lobby                                                                                                                                                                                                                                                                       | client intents                                                                            | baseline                                                                                                                                                                                                                                                                                                       |

- Tribe names: `resolveTribeNameData(map)` (`TribeNames.ts:35-93`) — map `customTribes` (with optional fixed coordinates, spawned first, `TribeSpawner.ts:93-123`) → theme prefix+suffix from `resources/tribeNameThemes.json` (17 themes: default 176×66, north_america, south_america, europe, africa, asia, oceania, space, fantasy, war, western, under_ocean, tournament, funny, scary, weird, vs) → purchased names (`GameStartInfo.tribes`) into random slots. **Names are the only per-tribe data; there are no stats or behaviour attached to a name.**
- Nation identity: `PlayerInfo{name, playerType, clientID:null, id, …, nationFlag}` (`Game.ts:436-464`) + `Nation{spawnCell?}`. Nations without a spawn cell (HvN extras, generated) spawn randomly; those with one pick a tile within ±25 of it, rejecting mountains 50% of the time (`NationExecution.ts:263-292`), and **hop to a new tile every attack-tick during the spawn phase** (`:107-162`). Nothing in the manifest carries personality, aggression, or preferences — `TerrainMapLoader.ts:56-66` `Nation{coordinates?, flag?, name}`.
- Confirmed: **no personalities today.** The only per-instance variation is the seeded `PseudoRandom(simpleHash(id)+simpleHash(gameID))` and three ratios rolled in the constructor (`NationExecution.ts:57-59`, `TribeExecution.ts:23-27`): `triggerRatio ∈ [0.50,0.59]`, `reserveRatio ∈ [0.30,0.39]`, `expandRatio ∈ [0.10,0.19]`, plus `attackRate` (below). Everything else is a function of `gameConfig.difficulty` — one global value for all nations in the game.

#### Tribe (bot) behaviour — `TribeExecution.ts`

- `attackRate ∈ [40,80)` ticks (4-8 s), phase-offset `attackTick`. Each attack tick: accept **every** incoming alliance request and every extension (`:67-84`); delete one owned structure per `deleteUnitCooldown()` = 30 s (`:86-94`, so captured buildings rot away — nations prioritise recapturing them); then `maybeAttack` (`:96-124`): traitor neighbour (odds 1/3, 1/6 if allied — breaks alliance first), terra nullius while any borders it, else `AiAttackBehavior.attackRandomTarget` (`AiAttackBehavior.ts:761-793`): needs `troops/maxTroops >= triggerRatio`; retaliate vs largest non-friendly incoming attack; 1/3 chance at a traitor; else shuffle neighbours, skip friendly, skip nations/humans 50% of the time, attack the first that `sendAttack` accepts. Bots ignore `shouldAttack`'s human-protection (always true for bots, `:945`). No structures, no nukes, no boats-of-their-own beyond `sendAttack`'s boat path, no emojis.

#### Nation cadence — `NationExecution.ts`

- `attackRate` by difficulty (`:74-88`): Easy `[65,100)`, Medium `[55,70)`, Hard `[45,60)`, Impossible `[30,50)` ticks. One full decision pass per `attackRate` ticks (`:181-210`), in fixed order: casual emoji → embargo-relation sync → alliance requests → alliance extensions → MIRV → structures → warship spawn → hostile embargoes → **attack** → counter warship spam → nuke. `handleStructures` also runs at 1/3 and 2/3 of the interval (`:182-195`). Warship tracking runs **every tick** except on Easy (`:92-101`). First post-spawn tick: `forceSendAttack(terraNullius)` with half the army (`:175-179`, `AiAttackBehavior.ts:795-803`).

#### Difficulty table (all four tiers: Easy / Medium / Hard / Impossible)

| Lever                                       | File:line                           | Easy                                                   | Medium                                                                               | Hard                                                                                                          | Impossible                                                                                                    |
| ------------------------------------------- | ----------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `startManpower`                             | `Config.ts:961-978`                 | 12 500                                                 | 18 750                                                                               | 25 000                                                                                                        | 31 250                                                                                                        |
| `maxTroops` multiplier                      | `:1004-1016`                        | ×0.5                                                   | ×0.75                                                                                | ×1                                                                                                            | ×1.25                                                                                                         |
| troop growth                                | `:1031-1046`                        | ×0.9                                                   | ×0.95                                                                                | ×1                                                                                                            | ×1.05                                                                                                         |
| attack cadence (ticks)                      | `NationExecution.ts:74-88`          | 65-99                                                  | 55-69                                                                                | 45-59                                                                                                         | 30-49                                                                                                         |
| attack-relation hit on victim               | `AttackExecution.ts:168-186`        | -60                                                    | -70                                                                                  | -80                                                                                                           | -100                                                                                                          |
| `shouldAttack` humans                       | `AiAttackBehavior.ts:947-954`       | 25%                                                    | 75%                                                                                  | always                                                                                                        | always                                                                                                        |
| bot-attack parallelism                      | `:465-481`                          | 1                                                      | 1-2                                                                                  | 3                                                                                                             | 100                                                                                                           |
| bot-attack size                             | `:1109-1128`                        | all spare                                              | 4× target troops (skip if < 2×)                                                      | same                                                                                                          | same                                                                                                          |
| troop floor vs strongest neighbour (FFA)    | `:983-1030`                         | none                                                   | none                                                                                 | keep 75%                                                                                                      | keep 90%                                                                                                      |
| "too weak" attack skip (FFA)                | `:962-976`                          | —                                                      | —                                                                                    | < 20% of target                                                                                               | < 20%                                                                                                         |
| strategy order                              | `:355-370`                          | nuked, bots, retaliate, assist, betray, hated, weakest | bots, nuked, retaliate, assist, betray, hated, afk, traitor, weakest, island, donate | bots, retaliate, assist, betray, nuked, traitor, afk, hated, veryWeak, juicy, victim, weakest, island, donate | retaliate, bots, veryWeak, betray, assist, victim, traitor, juicy, afk, hated, nuked, weakest, island, donate |
| alliance "confused" random answer           | `NationAllianceBehavior.ts:171-185` | 1/10                                                   | 1/20                                                                                 | 1/40                                                                                                          | never                                                                                                         |
| early-game auto-accept                      | `:187-218`                          | 90% first 5 min                                        | 70% first 3 min                                                                      | 50% first 3 min                                                                                               | 30% first 1 min                                                                                               |
| threat detection (accept out of fear)       | `:220-252`                          | never                                                  | troops > 2.5× ours                                                                   | troops > ours and maxTroops > 2×                                                                              | troops > 1.5× or (troops > and maxTroops > 1.5×) or (troops > and tiles > 1.5×)                               |
| reject in team games                        | `:254-272`                          | 25%                                                    | 50%                                                                                  | 75%                                                                                                           | 100%                                                                                                          |
| "enough alliances"                          | `:274-306`                          | never                                                  | ≥ rand[4,6)                                                                          | ≥ rand[3,5) or all-but-one neighbours                                                                         | ≥ rand[2,4) or all-but-one neighbours                                                                         |
| accept on Friendly relation                 | `:308-327`                          | yes                                                    | yes                                                                                  | 83%                                                                                                           | 67%                                                                                                           |
| similar-strength thresholds (troop%, tile%) | `:330-369`                          | [60,70], [70,80]                                       | [70,80], [80,90]                                                                     | [75,85], [85,95]                                                                                              | [80,90], [90,100]                                                                                             |
| reject over-allied partners                 | `:150-169`                          | —                                                      | —                                                                                    | partner alliances ≥ 50% of non-bot players                                                                    | ≥ 25%                                                                                                         |
| betray weak ally (maxTroops-aware)          | `:371-428`                          | ×10 troops only, never humans                          | ×10 troops                                                                           | ally < 20% max and weaker; traitor < 1.2×; only-neighbour < 1/3                                               | same as Hard                                                                                                  |
| alliance requests to bots                   | `:68-72`                            | allowed                                                | no                                                                                   | no                                                                                                            | no                                                                                                            |
| donate to teammate                          | `AiAttackBehavior.ts:1150-1170`     | never                                                  | 25%                                                                                  | 50%                                                                                                           | always                                                                                                        |
| MIRV hesitation                             | `NationMIRVBehavior.ts:39-52`       | 1/2                                                    | 1/4                                                                                  | 1/8                                                                                                           | 1/16                                                                                                          |
| MIRV victory-denial land %                  | `:59-72`                            | 75                                                     | 65                                                                                   | 55                                                                                                            | 40                                                                                                            |
| MIRV steamroll city gap / min leader cities | `:74-104`                           | 2× / 20                                                | 1.5× / 10                                                                            | 1.25× / 10                                                                                                    | 1.15× / 8                                                                                                     |
| nuke FFA crown lead threshold               | `NationNukeBehavior.ts:335-354`     | 40 pts                                                 | 30                                                                                   | 20                                                                                                            | 10                                                                                                            |
| nuke tiles allowed                          | `:630-648`                          | target-owned only                                      | target-owned only                                                                    | + terra nullius, + team enemies                                                                               | same                                                                                                          |
| SAM avoidance                               | `:141-148,683-691`                  | ignore                                                 | -1 score if SAM within 50                                                            | trajectory intercept check                                                                                    | + outrange-SAM bonus, SAM-overwhelm salvos                                                                    |
| SAM ratio per city                          | `NationStructureBehavior.ts:33-38`  | 0.15                                                   | 0.20                                                                                 | 0.25                                                                                                          | 0.30                                                                                                          |
| rail-connectivity scoring                   | `:1053-1073`                        | 0%                                                     | 60%                                                                                  | 75%                                                                                                           | 100%                                                                                                          |
| defence posts under attack                  | `:186-238`                          | none                                                   | 50% roll, 1 post                                                                     | ceil(ratio/0.4)                                                                                               | same                                                                                                          |
| warship retaliation                         | `NationWarshipBehavior.ts:229-256`  | never                                                  | 15%                                                                                  | 50%                                                                                                           | 80%                                                                                                           |
| counter warship spam                        | `:303-336`                          | no                                                     | no                                                                                   | yes                                                                                                           | yes                                                                                                           |
| auto-embargo lift                           | `NationExecution.ts:341-361`        | at Neutral                                             | at Neutral                                                                           | at Friendly                                                                                                   | never                                                                                                         |
| gold-donation chunk                         | `DonateGoldExecution.ts:93-107`     | 2 500                                                  | 5 000                                                                                | 12 500                                                                                                        | 25 000                                                                                                        |

Public lobbies: `difficulty = isHardNations || HvN ? Hard : Medium` (`MapPlaylist.ts:443-446`). Impossible is reachable only from private/singleplayer config.

#### Target selection — `AiAttackBehavior.maybeAttack` (`:52-112`)

1. Build `borderingPlayers` from border-tile neighbours + `nearby()`, **sorted ascending by troops** (weakest first); split into `borderingFriends` / `borderingEnemies` by `isFriendly`.
2. If any non-fallout terra nullius borders us → `sendAttack(TN)` and stop (expansion beats war).
3. No enemies: 1/5 chance `attackWithRandomBoat`. Enemies: 1/10 chance random boat and stop; else `maybeSendAllianceRequests(borderingEnemies)` (30% per enemy, subject to decision logic).
4. `attackBestTarget` (`:227-251`): if a hostile bot neighbour owns structures → `attackBots` first; require `troops/maxTroops >= reserveRatio`; require `>= triggerRatio` unless 1/10 roll; then run the difficulty-ordered strategy list, first that returns true wins.

- Strategies (`:253-370`): `retaliate` = largest non-friendly incoming attacker (bots ignored unless we are a bot), forced; `bots` = neighbouring bots sorted structures-first then by troop density, up to N in parallel; `assist` = ally targets; `traitor`; `afk`; `betray` = `maybeBetray` each bordering friend then forced attack; `nuked` = reclaim fallout TN; `victim` = weakest bordering enemy with incoming ≥ 50% of its troops (FFA: ≤ 1.2× ours); `juicy` (`:580-636`, Hard/Impossible) = among enemies with troops ≤ 75% of ours, maximise `norm(structure levels excl. DefensePost/Silo) + norm(1 - troops/maxTroops) + norm(tiles)`; `hated` = first `Relation.Hostile` in `allRelationsSorted` (FFA: ≤ 3× ours); `veryWeak` = troops < 15% of their max (FFA ≤ 1.2×); `weakest` = `borderingEnemies[0]` (FFA only if fewer troops than us); `island` = nearest reachable non-friendly by cluster-centre distance, 1/3 chance of second-nearest; `donate`.
- Sizing `calculateAttackTroops` (`:1039-1085`): land `troops - maxTroops*reserveRatio` (or `expandRatio` vs TN / bots-with-structures); boat `troops/5`; capped by `troopSendCap` (FFA Hard/Impossible: `troops - ceil(maxNeighborTroops * 0.75|0.9)`, raised to total incoming when under attack; expansion floors at 5% of troops); rejected if `< 1` or `isAttackTooWeak`. Tests: `tests/AiAttackBehavior.test.ts` (cap, floor, juicy), `tests/AiAttackBehaviorNukedTerritory.test.ts`.
- There is **no scoring across strategies** — it is a priority list, not a utility function. The only weighted score is `findJuicyTarget`.

#### Structures — `NationStructureBehavior`

- Ratios per city (`:47-64`): Port 0.75, Factory 0.75 (×0.33 if coastal and ports enabled), SAM by difficulty, MissileSilo 0.2 (first silo at 0.4, max 3). Build order Port → Factory → SAM → Silo, then City (`:498-543`). Cities are the pacing unit; if cities disabled, `floor(tiles/2000)`.
- Perceived cost (`:652-680`): `realCost * (1 + increasePerOwned * owned)` (City/Port/Factory/Silo 1.0, SAM 0.3) **until gold ≥ save-up target** (`:682-720`: MIRV+H-bomb; or 5 H-bombs; or 20 A-bombs; team games: 1 H-bomb; silos disabled: 1 SAM). Upgrade instead of build when structures/tiles > 1/1500 (`:610-633`). High-starting-gold (≥ 3M) pacing gaps 0/0/250/150/100 ticks and a SAM-first opening on Hard/Impossible (`:105-114,455-468`). Post-save-up alternates 15 s on / 15 s off so the nuke behaviour can spend (`:420-436`). Placement value functions per type (`:924-1360`) score tiles by magnitude, border distance (clamped at A-bomb outer radius 30), same-type spacing (60), cross-type spacing, and rail connectivity weighted by trade value of neighbours it `canTrade` with. Tests: `tests/NationStructureBehavior.test.ts`.

#### Nukes — `NationNukeBehavior.maybeSendNuke` (`:58-164`)

- Needs a silo. Target = `findBestNukeTarget` (`:166-260`): Hard/Impossible with 2 players left → the other; largest incoming attacker; Impossible richest nation 50% → highest structure-density player (density > 1/75, level-sum ≥ 5); Impossible FFA → crown if > 50% of non-fallout land; ally targets (relation ≥ Friendly); most hated `Hostile` unless our maxTroops ≥ 2× theirs; FFA crown if `crownShare - myShare > threshold`; team: strongest enemy team (50% its strongest member, 50% random). Never bots, teammates, or when `shouldAttack` says no.
- Weapon: H-bomb if affordable at perceived cost, else A-bomb (an "H nation" only uses A-bombs under heavy attack). Perceived cost rises ×1.5 per A-bomb and ×1.25 per H-bomb launched (`:750-772`) to simulate saving for a MIRV; ignored when 2 players remain, MIRV disabled, team game with > H-bomb cost, gold > MIRV+H, or Hard/Impossible under heavy attack (incoming ≥ troops) (`:431-475`).
- Tile: 10 (30 on Impossible) random target tiles + all target structure tiles; every tile within the outer radius (and half radius) must be `isValidNukeTile`; score = Σ structure values in range (City 25k, Silo 50k, Port/Factory 15k, DefensePost 5k, ×level) minus distance-to-silo terms; Impossible adds 100k×level for out-rangeable SAMs; only fires with score > 0 on Impossible, else falls to `maybeDestroyEnemySam` salvos (`:780-`).
- MIRV (`NationMIRVBehavior.considerMIRV` `:106-141`): silo + gold ≥ MIRV cost, hesitation roll, then counter-MIRV the biggest inbound sender → victory denial (land ≥ threshold%, teams by total, biggest member) → steamroll stop (leader cities > min and ≥ gap× second) ; 300-tick global per-target cooldown shared across all nations (`:24-31`). Tests: `tests/NationMIRV.test.ts`.

---

### Data-driven vs hardcoded (summary)

- Wire-configurable (`GameConfigSchema`): difficulty (single enum), bots count, nations count/disabled, `customAllianceDuration` (0-15 min), `disableAlliances`, `donateGold/Troops`, `spawnImmunityDuration`, `randomSpawn`, `playerTeams`, `maxTimerValue`, `overtime.{enabled,startMinutes}`, `doomsdayClock`, `disabledUnits`.
- Hardcoded in `Config.ts`: traitor 0.5/0.8/30 s, request 20 s / cooldown 30 s, target 10 s / 15 s, emoji 5 s / 5 s, quick chat 3 s, donate 10 s, embargo-all 10 s, temp embargo 5 min, spawn phase 100/150/200, min spawn distance 30, win 80%, team-win eligibility 70%, nuke break threshold 100, veterancy 3/20/20/10/25.
- Hardcoded in behaviours: every relation delta, every difficulty switch, strategy orders, structure ratios, nuke values. Map manifests carry only nation name/flag/coords and tribe names/coords.

---

### Gaps vs FightWars brief

#### 1. Tiered relations — **built for three rungs (Phase 5, brief §6.5, session 11); Vassal deliberately not**

**What exists.** `AllianceTier` in `Game.ts` — `NonAggression` (1), `DefensivePact` (2), `FullAlliance` (3) — carried by `AllianceImpl.tier()` / `setTier()`, `AllianceRequestImpl.tier()`, the `allianceRequest` intent (`tier?: 1..3`), `AllianceRequestUpdate.tier`, `AllianceView.tier` (compared in `allianceArrayEqual`, so a climb re-sends the array) and `AllianceInfo.tier` / `nextTier`.

- **One button, climbed by asking again.** A request with no tier asks for `nextAllianceTier(held)`: the first is a non-aggression pact, a request to a partner already held asks for the rung above. `canSendAllianceRequest` is true with no alliance or with one below `FullAlliance`; the request cooldown (`allianceRequestCooldown`, 30 s per recipient) still applies between rungs, so the ladder is climbed at the pace of a relationship, not a click. `GameImpl.acceptAllianceRequest` on an existing alliance climbs it **in place** (`setTier` + `extend()` — a deepened bond is a renewed one) rather than making a second object. A request at or below the rung held is refused (`createAllianceRequest` throws; the execution logs and drops).
- **What each rung means.** `isFriendly` — and so `canAttackPlayer`, nuke cancellation, `canTrade` — holds at every rung: a pact is peace. `allies()` — the partners nations assist and retaliate for (`AiAttackBehavior.assistAllies`, `findIncomingAttackPlayer`) — is `DefensivePact` and above. At `FullAlliance` a nation helps without charging the partner the usual −20 relation for the favour.
- **Breaking costs in proportion.** `GameImpl.breakAlliance` marks the traitor with `Config.allianceBreakTraitorScale(tier)` — 0.5 × `traitorDuration` for a pact, 1 × for a defensive pact, 1.5 × for a full alliance — via `Player.markTraitor(durationScale)`.
- **Nations.** `getAllianceDecision(other, isResponse, tier)`: a pact is granted to anyone the nation is not hostile to and who is not a traitor; a defensive pact goes through the old chain; a full alliance additionally needs `isAlliancePartnerFriendly` or the opening honeymoon. Nations ask for a pact first (`maybeSendAllianceRequests`) and climb with partners they have come to like (`maybeDeepenAlliances`, one rung at a time, one chance in twenty per cadence tick). The clean-room test helper's mock request gained `tier: () => FullAlliance`, which reproduces every prior case. **The Hard/Impossible cap counts allies, not pacts** (session-12 retune): `hasTooManyAlliances` — refuse a partner already bound to half (Hard) or a quarter (Impossible) of the non-tribe players, so enough of the map stays free to stop a runaway leader — counted every `alliances()` entry, so the cheap pacts nations hand any non-hostile neighbour blocked the defensive pacts the cap exists to ration (the impossible-nations snapshot lost eleven alive nations when tiers landed while the Medium bot run gained eleven). It now counts `allies()` (defensive pact and up); `Config.allianceCapCountsPacts()` (false) is the switch and `balance:run --pacts-count` the lever. A pact still makes the pair `isFriendly` — no nukes, no attacks — so a nation bound by pacts to the whole map is still no use against the crown; that is the argument for the old count, and the numbers in `BUILD-STATE.md` are the answer to it.
- **Client.** The one button is labelled by the rung it asks for (`player_panel.deepen_*`); the incoming card names the rung (`events_display.request_alliance_*`) and its Accept sends the same rung back (acceptance is a reciprocal request, as before). No picker: the ladder _is_ the picker.
- **Switch and lever.** `Config.allianceTiersEnabled()`; `balance:run --flat-alliances` turns it off, making every request a full alliance with no ladder — the game as it was.

**Vassal is deliberately not built.** It is asymmetric (`requestor_`/`recipient_` could carry the direction) and needs a tribute hook beside `PlayerExecution.tick`'s income, a one-way `canAttackPlayer`, and — the real cost — an offer that only a much stronger side can make and a reason for the weaker to accept. That is its own item, with its own UI; the ladder above is complete without it.

#### 2. War goals / peace terms — **not built**

Unchanged: nothing exists, and the hooks noted in the Phase 0 audit still stand (`Stats.attack`, `TargetPlayerExecution`, a "war" object beside `allianceRequests`, peace as a `NonAggression` request with an expiry — which the tier system now makes a one-line intent). The value is in the peace-terms UI, which is Phase 4 item 6 work.

#### 3. Auto-coalitions at ~40 % land — **built (session 11)**

- **The leader is published.** `WinCheckExecution` calls `Game.setLeader(side, share)` every ten ticks in both modes (share = tiles ÷ claimable land, fallout excluded like the win bar); `Game.leader()` / `leaderShare()` read it. In team games the side is the team and the offer names its largest member.
- **The offer goes out once.** `setLeader` emits a `CoalitionUpdate {leaderID, share, active}` only when `share ≥ Config.coalitionThreshold()` (0.4) flips, on the way up and on the way down — not ten times a second. The client's `ActionableEvents` shows one card ("X holds N % of the map — join the coalition?") with one button that asks every living non-leader, non-bot player for a **defensive pact**; the simulation refuses the ones that cannot be asked. The leader and its teammates get no card.
- **Nations join.** Under a coalition, `getAllianceDecision` accepts a pact or a defensive pact from any fellow non-leader it is not hostile to, without `hasTooManyAlliances` / `checkAlreadyEnoughAlliances` — that reluctance exists to keep enough enemies for the crown, and the crown is the problem now. `maybeSendAllianceRequests` asks every bordering non-leader every cadence tick (not one in thirty) for a defensive pact.
- **Lever.** `balance:run --no-coalition` sets the threshold to 1.01.

#### 4. Persistent reputation — **not built, on purpose**

The brief itself says to keep it out of the deterministic core; it is server infrastructure fed in as a lobby-join parameter. The Phase 0 hook analysis (a `PlayerSchema` field, threaded through `PlayerInfo`, read only in rendering unless nations use it — then it must be in the archived record) stands unchanged. `_betrayalCount` still counts in-game betrayals and nothing reads it.

#### 5. Doctrines at spawn — **built (Phase 5, brief §6.6, session 11)**

**What exists.** `Doctrine` in `Game.ts` — `None` (0) and the brief's eight: `Expansionist`, `Mercantile`, `Fortress`, `Naval`, `Nuclear`, `Diplomatic`, `Industrial`, `Partisan` — with `DOCTRINES` (the pickable eight, in picker order) and `DOCTRINE_KEYS` (locale stems). `Player.doctrine()` / `setDoctrine()`; `PlayerUpdate.doctrine` on the object lane (it changes once), through `diffPlayerUpdate` / `applyStateUpdate` to `PlayerState.doctrine` and `PlayerView.doctrine()`.

- **The pick rides the spawn intent.** `SpawnIntentSchema.doctrine` (`1..8`, optional) → `ExecutionManager` → `SpawnExecution(…, fromIntent, doctrine?)`, stamped after `setSpawnTile`. Absent keeps whatever is held, so a tile re-pick without a choice changes nothing; the picker sends the same tile again with the new doctrine when the choice comes second. Tribes never have one. **Nations roll one in `NationExecution.init`** from their seeded RNG — only with doctrines on, so the lever leaves the PRNG sequence, and every later nation decision, exactly as it was.
- **One passive and one unlock each**, every one a scale on a number the game already had (`Config`):

  | Doctrine     | Passive                                               | Unlock                                                             |
  | ------------ | ----------------------------------------------------- | ------------------------------------------------------------------ |
  | Expansionist | terra nullius for ¾ (`doctrineTerraNulliusCostScale`) | over-extension starts 15 tiles further out (`doctrineSupplyReach`) |
  | Mercantile   | trade pays +15 % (`doctrineTradeGoldScale`)           | ports for ¾ (`doctrineUnitCostScale`)                              |
  | Fortress     | defense posts for ¾                                   | posts defend ×1.3 (`doctrineDefensePostBonusScale`)                |
  | Naval        | warships for ¾                                        | blockade range ×1.5 (`doctrineBlockadeRangeScale`)                 |
  | Nuclear      | silos for ¾                                           | warheads for half the materials (`doctrineMaterialsScale`)         |
  | Diplomatic   | traitor mark ×0.5 (`doctrineTraitorScale`)            | alliances either side holds ×1.5 (`doctrineAllianceDurationScale`) |
  | Industrial   | factories for ¾                                       | factory output ×1.5 (`doctrineFactoryOutputScale`)                 |
  | Partisan     | recruiting +10 % (`doctrineTroopRegenScale`)          | _lands with stability (§05 6): its lost land rebels twice as fast_ |

- **Where each hook sits.** Costs: `unitInfo` wraps the unit's `cost` and `materialsCost` per calling player, on top of the curve (a Fortress state's fifth post is still dearer than its first). Attack: `AttackLogicInput.attacker.doctrine` / `defender.doctrine` (optional, so the golden fixtures stand) — terra-nullius scale in the `defender === null` branch (`AttackExplanation.terraNulliusMod`, an `attack_cost.expansionist` row on the client), post bonus beside `defensePostDefenseBonus`; reach in `AttackExecution.withDoctrineReach` on the front's supply distance, mirrored in `AttackCostEstimate.clientSupplyDistance` — a tile out of the field stays out (reach forgives distance, not absence). `Blockade.computeBlockaded` scales range per fleet owner. `AllianceImpl.duration()` takes the longer of the two parties' scales at creation and at renewal. `GameImpl.breakAlliance` multiplies the tier scale by the breaker's. `FactoryExecution` scales the per-tick grant. `Config.tradeShipGold` and `troopIncreaseRate` read the player's doctrine directly.
- **Client.** `doctrine-picker` (`src/client/hud/layers/DoctrinePicker.ts`): eight buttons under the spawn hint for the length of the spawn phase, hidden for spectators and replays and with doctrines off; the pick is session state (`src/client/DoctrinePick.ts`) sent with the next spawn intent, and what the simulation holds is what shows as chosen. `doctrine.*` locale keys. No doctrine is shown on the player panel yet — the panel is Phase 4 item 6 work.
- **Nations play theirs (session-12 retune).** A doctrine only changed prices, so a Mercantile nation built no more ports than any other and the survivors skewed away from Expansionist and Mercantile. `Config.doctrineNationBuildScale(doctrine, type)` weights the nation's build choice: `NationStructureBehavior.shouldBuildStructure` multiplies the per-city target (port, factory, silo ×1.5), `tryBuildDefensePost` the posts allowed under attack (Fortress ×1.5, ceiling), `NationWarshipBehavior.maybeSpawnWarship` keeps `floor(scale)` standing warships (Naval 2, everyone else 1); `doctrineNationExpandReserveScale` (Expansionist ¾) scales the `expandRatio` a nation keeps before taking empty land, applied once in `NationExecution.init` after the roll. Humans are untouched — they play their own doctrine. Lever `balance:run --no-doctrine-play` (every scale 1) reproduces the previous commit's hash.
- **Switch and lever.** `Config.doctrinesEnabled()`; `balance:run --no-doctrines` turns it off and reproduces the previous build's 8000-tick hash exactly.

**Deliberately not built.** A Draft mode (captains pick doctrines in turn — brief §5.7) and a doctrine column on the leaderboard (the player panel shows a doctrine chip since session 12 — `PlayerPanel.renderDoctrineBadge`, words in the panel's chip grammar, no colour); a Vassal doctrine. Nations _playing_ their doctrine was on this list until the session-12 retune (the bullet above); the rest of the §05 7 personality work (a Diplomatic nation asking for pacts more, a Partisan one garrisoning) still is.

#### 6. Stability / partisans — **built (Phase 5, brief §6.6, session 11)**

**The rule.** Land taken from another state is _occupied_ — held from its people — until it assimilates; enough of one people's land held unassimilated and ungarrisoned raises their partisans: a tribe spawned on the occupier's own ground, aimed at the occupier, that the occupier cannot absorb as an enclave and has to fight. Conquest is a commitment. Path A of the brief: the tribe machinery, reused, not a parallel system.

- **The books (`GameImpl`).** `_occupiedFrom: Uint16Array` per tile — the small id of the people it is held from, 0 for nobody's — and `_assimilateAt: Uint32Array`, the tick it settles on; both 1.3 + 2.6 MB on the world map, allocated on the first conquest of the kind. `conquer` records: a tile taken from a Human or Nation by a Human or Nation is held from the _previous owner_ (tribes neither occupy nor are occupied — except partisans, who stand for a people: their ground is that people's, so taking it from them is taking it from the people, and the people taking it back liberates it; the first cut let partisan land launder into free tribe land, and the strongest empire ate it); a tile already held from X and taken by a third party stays X's grievance in the new hands; X taking it back liberates it. `relinquish` clears it. `Player.unrestTiles()` / `unrestByPeople()` are the counts, on the object lane (`PlayerUpdate.unrestTiles` — it moves only while land changes hands). `Game.occupiedFrom(tile)`.
- **Assimilation.** A queue of `[settleTick, tile, holderSmallID]` in push order, drained once a second beside the fallout queue; an entry is current only while `_assimilateAt[tile]` still equals its tick — the same holder re-taking a tile it had lost restarts the window, and the old entry must not settle it early (the first cut did exactly that; the test caught it). `Config.unrestAssimilationTicks()` = 3000 (five minutes), ×`doctrineUnrestScale` of the _people's_ doctrine.
- **Uprisings (`UnrestExecution`, once a second).** For each living non-tribe occupier and each people it holds ≥ `unrestPartisanThreshold(occupier.numTilesOwned())` tiles from — max(300, `unrestPartisanShare()` = 10 % of the occupier's own land), ÷ the people's `doctrineUnrestScale`; the share is the session-12 retune: flat, 300 tiles kept 40 % of the world occupied and raised ~500 uprisings in 8000 ticks, every empire in permanent revolt over the first 300 tiles of each neighbour it ever bordered, so a small conqueror now feels it before an empire does — past `partisanCooldownTicks()` (1800) since that people last rose against it: the first of the occupier's tiles, _in its own tile order_, that is held from those people, out of `defensePostRange()` of any active post of the occupier's (the garrison), and with no structure of anyone's within four tiles. At most 256 candidate tiles are examined per attempt, and an attempt counts against the cooldown whether or not ground was found — the first cut walked a fully garrisoned empire's every tile once a second, two grid queries per candidate, and `determinism:full` went from eight minutes to never finishing. There a new `PlayerType.Bot` — "`<people> Partisans`", `partisanOf() === occupier`, `partisanTroops(tiles)` = min(80 000, 5 000 + 30·tiles) troops — takes the radius-4 patch (the occupier's tiles and unowned land, never a third party's), gets a `PlayerExecution` and a `TribeExecution(partisans, occupier)`, and the occupier reads `events_display.partisans_rise` (`MessageType.PARTISANS_RISE`, warn colour). Deterministic throughout: no PRNG, tile order is the occupier's `_tiles` insertion order, identical on every client.
- **Partisans (`TribeExecution` with an occupier).** They attack the occupier first whenever they border it — throwing `(1 − reserveRatio)` of their troops straight into an `AttackExecution`, because `AiAttackBehavior` would never attack a stronger neighbour and an uprising that waits to outgrow an empire never happens — and reject the occupier's alliance requests; once the occupier is dead they are a tribe like any other. `PlayerExecution.removeCluster` does not let the occupier absorb them as an enclave (`capturing === partisanOf()`), which is what makes an uprising inside an empire survive its first tick; anyone else walking in absorbs them as usual — so the people, returning, inherit their partisans' ground.
- **`Player.partisanFor()`** is the people's small id, set with `markPartisanOf(occupier, people)`.
- **Partisan doctrine's unlock (§05 5).** `doctrineUnrestScale(Partisan) = 2`: half the tiles raise their partisans, and their land takes twice as long to settle.
- **Switch and lever.** `Config.unrestEnabled()` (`GameRunner` registers the execution only when on; `conquer` records nothing when off); `balance:run --no-unrest` reproduces the previous build's hash exactly, and `--flat-unrest` (share 0, threshold a flat 300) reproduces the stability commit's.

**Deliberately not built.** Garrison as troops rather than posts (the brief says "garrisoned"; a post is the one garrison the game has); partisans flipping land _directly_ to the former owner (they hold it as a tribe, and the former owner absorbs them by walking in); a shaded "occupied" map layer (the player panel's occupied-land row is built — session 12, `PlayerPanel.renderUnrest`, the alert token beside an icon and the words, shown only when there is any); nations garrisoning on purpose (the §05 7 personality work — today a nation's posts are wherever its build logic put them).

#### 7. Utility-based AI with personalities across five tiers

- What exists: four `Difficulty` tiers as a global enum switched ~40 times across `AiAttackBehavior`, `NationAllianceBehavior`, `NationNukeBehavior`, `NationMIRVBehavior`, `NationStructureBehavior`, `NationWarshipBehavior`, `NationEmojiBehavior`, `DonateGold/TroopExecution`, `AttackExecution`, `Config` (table above). Per-nation variation is only three ratios + attack cadence rolled from a seeded RNG (`NationExecution.ts:57-59,64-65`).
- Only one genuine scoring function: `findJuicyTarget` (min-max normalised sum of three features). Everything else is ordered predicates. `NationNukeBehavior.nukeTileScore` and the structure `*Value()` placement functions are additive tile scorers that could seed a utility framework.
- To get personalities: (a) introduce a `NationProfile{aggression, loyalty, greed, caution, …}` created in `NationExecution` constructor from the seeded RNG (or from a new optional manifest field on `TerrainMapLoader.Nation`, which flows through `createNationsForGame`'s `toNation` `NationCreation.ts:35-49`); (b) replace `getAttackStrategies`' switch with a weighted list; (c) feed profile into `getAllianceDecision` thresholds and `maybeBetray`; (d) the fifth tier can simply be a new `Difficulty` value — every `switch` uses `assertNever`, so the compiler will list all ~40 sites. Determinism constraint: all randomness must stay on the `PseudoRandom` seeded from `(nation id, gameID)`; comment at `NationAllianceBehavior.ts:329` warns floats "can cause desyncs" — keep integer percentages.

#### Tests to extend

`tests/AllianceRequestExecution.test.ts`, `AllianceExtensionExecution.test.ts`, `AllianceAcceptNukes.test.ts`, `AllianceDonation.test.ts`, `CustomAllianceDuration.test.ts`, `Disconnected.test.ts`, `Donate.test.ts`, `NationAllianceBehavior.test.ts`, `AiAttackBehavior.test.ts`, `AiAttackBehaviorNukedTerritory.test.ts`, `NationCreation.test.ts`, `NationMIRV.test.ts`, `NationStructureBehavior.test.ts`, `Team.test.ts`, `TeamAssignment.test.ts`, `WarshipVeterancy.test.ts`, `TribeNameThemes.test.ts`. Replays are hash-checked, so any sim change here is a breaking change for archived games.

---

## 06 — Wire protocol, server validation, desync, lobbies, maps, controls, determinism, branding

Audited repo: `C:\Users\disbo\dev\fightwars` at commit `c77005586` (OpenFront upstream, `openfront-client` package). All paths below are relative to that root. Read-only audit; nothing modified.

Two caveats up front:

- The "brief's list of ~30 maps" and "the brief's list of controls" were not available to this audit (the scratchpad `mechanics/` directory was empty when it started). Sections 6 and 7 therefore give the **complete** present roster/control set with enough structure that the brief can be diffed against them in one pass, rather than a present/missing column against a list I never saw.
- `src/client/Api.ts` contains a non-UTF-8 byte and shows as "Binary file" to plain grep; `grep -a` was used where needed.

---

### 1. Intent catalogue

Source of truth: `src/core/Schemas.ts:32-57` (TypeScript union), `src/core/Schemas.ts:612-764` (Zod schemas), `src/core/Schemas.ts:766-792` (`IntentSchema` discriminated union, 25 members), `src/core/Schemas.ts:795-798` (`StampedIntentSchema` = intent + server-stamped `clientID`). Execution mapping: `src/core/execution/ExecutionManager.ts:51-141` (`Executor.createExec`). Server-side authorization: `src/server/IntentAuthorization.ts:32-137` (`authorizeIntent`), applied from `src/server/GameServer.ts:354-361`.

Field types: `MappedID` = clientID string matching `/^[A-Za-z0-9]{8,10}$/`, dictionary-compressed on the binary wire (`Schemas.ts:586-598`). `zb.uint()` = LEB128 varint in `[0, 2^53)`; `zb.float()` = bit-exact float64.

| Intent `type`             | Fields (beyond `type`)                                                                                 | Execution class (`ExecutionManager.ts`)                                                                          | Server-side validation                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spawn`                   | `tile: uint`                                                                                           | `SpawnExecution(gameID, player.info(), tile, fromIntent=true)` — `:74-82`                                        | Schema shape only. No check that tile is land/unowned/in spawn phase (sim does it). Authorization: default branch (`IntentAuthorization.ts:130-135`) — any websocket player.                                                                                                                                      |
| `attack`                  | `targetID: MappedID \| null`, `troops: float>=0 \| null`                                               | `AttackExecution(troops, player, targetID, null)` — `:60-67`                                                     | Schema only. `troops` is not bounded against the sender's actual troop count; `targetID` is not checked to exist or be a neighbour. Sim clamps.                                                                                                                                                                   |
| `cancel_attack`           | `attackID: string` (unbounded)                                                                         | `RetreatExecution(player, attackID)` — `:68-69`                                                                  | Schema only; `attackID` is a free `z.string()` (only the 2000-byte intent cap applies).                                                                                                                                                                                                                           |
| `boat`                    | `troops: float>=0`, `dst: uint`                                                                        | `TransportShipExecution(player, dst, troops)` — `:83-84`                                                         | Schema only.                                                                                                                                                                                                                                                                                                      |
| `cancel_boat`             | `unitID: uint`                                                                                         | `BoatRetreatExecution(player, unitID)` — `:70-71`                                                                | Schema only; ownership of the unit is checked in the execution, not the server.                                                                                                                                                                                                                                   |
| `allianceRequest`         | `recipient: MappedID`                                                                                  | `AllianceRequestExecution(player, recipient)` — `:85-86`                                                         | Schema only.                                                                                                                                                                                                                                                                                                      |
| `allianceReject`          | `requestor: MappedID`                                                                                  | `AllianceRejectExecution(requestor, player)` — `:87-88`                                                          | Schema only.                                                                                                                                                                                                                                                                                                      |
| `allianceExtension`       | `recipient: MappedID`                                                                                  | `AllianceExtensionExecution(player, recipient)` — `:115-117`                                                     | Schema only.                                                                                                                                                                                                                                                                                                      |
| `breakAlliance`           | `recipient: MappedID`                                                                                  | `BreakAllianceExecution(player, recipient)` — `:89-90`                                                           | Schema only.                                                                                                                                                                                                                                                                                                      |
| `targetPlayer`            | `target: MappedID`                                                                                     | `TargetPlayerExecution(player, target)` — `:91-92`                                                               | Schema only.                                                                                                                                                                                                                                                                                                      |
| `emoji`                   | `recipient: MappedID \| "AllPlayers"`, `emoji: uint <= flattenedEmojiTable.length-1`                   | `EmojiExecution(player, recipient, emoji)` — `:93-94`                                                            | Schema (emoji index bounded). No per-intent cooldown server-side beyond the generic 10/s, 150/min rate limit.                                                                                                                                                                                                     |
| `donate_gold`             | `recipient: MappedID`, `gold: float>=0 \| null`                                                        | `DonateGoldExecution(player, recipient, gold)` — `:101-102`                                                      | Schema only. Amount not checked against balance (sim does).                                                                                                                                                                                                                                                       |
| `donate_troops`           | `recipient: MappedID`, `troops: float>=0 \| null`                                                      | `DonateTroopsExecution(player, recipient, troops)` — `:95-100`                                                   | Schema only.                                                                                                                                                                                                                                                                                                      |
| `build_unit`              | `unit: UnitType enum`, `tile: uint`, `rocketDirectionUp?: bool`, `amount?: uint 1..MAX_UPGRADE_AMOUNT` | `ConstructionExecution(player, unit, tile, rocketDirectionUp, amount)` — `:107-114`                              | Schema only. `disabledUnits`, gold cost, placement legality all enforced in the sim.                                                                                                                                                                                                                              |
| `upgrade_structure`       | `unit: UnitType`, `unitId: uint`, `amount?: uint 1..MAX_UPGRADE_AMOUNT`                                | `UpgradeStructureExecution(player, unitId, amount)` — `:119-124` (note: `unit` field is ignored by the executor) | Schema only.                                                                                                                                                                                                                                                                                                      |
| `embargo`                 | `targetID: MappedID`, `action: "start"\|"stop"`                                                        | `EmbargoExecution(player, targetID, action)` — `:103-104`                                                        | Schema only.                                                                                                                                                                                                                                                                                                      |
| `embargo_all`             | `action: "start"\|"stop"`                                                                              | `EmbargoAllExecution(player, action)` — `:105-106`                                                               | Schema only.                                                                                                                                                                                                                                                                                                      |
| `move_warship`            | `unitIds: int[] nonempty`, `tile: uint`                                                                | `MoveWarshipExecution(player, unitIds, tile)` — `:72-73`                                                         | Schema only (array length only bounded by the 2000-byte intent cap and zbin's 2^20 element budget).                                                                                                                                                                                                               |
| `delete_unit`             | `unitId: uint`                                                                                         | `DeleteUnitExecution(player, unitId)` — `:125-126`                                                               | Schema only.                                                                                                                                                                                                                                                                                                      |
| `quick_chat`              | `recipient: MappedID`, `quickChatKey: enum from resources/QuickChat.json`, `target?: MappedID`         | `QuickChatExecution(player, recipient, key, target)` — `:127-133`                                                | Schema (key is a closed enum).                                                                                                                                                                                                                                                                                    |
| `mark_disconnected`       | `isDisconnected: bool`                                                                                 | `MarkDisconnectedExecution(player, isDisconnected)` — `:134-135`                                                 | **Rejected from clients** with 400 (`IntentAuthorization.ts:43-44`). Only the server emits it (`GameServer.ts:1708-1720`).                                                                                                                                                                                        |
| `toggle_pause`            | `paused: bool (default false)`                                                                         | `PauseExecution(player, paused)` — `:136-137`                                                                    | Lobby creator or admin bot only; refused in listed lobbies unless admin bot; refused before start (`IntentAuthorization.ts:114-128`). Server also flips its own `paused` flag and stops `endTurn()` (`GameServer.ts:413-427`, `:1312-1316`).                                                                      |
| `kick_player`             | `targetClientID?: MappedID`, `targetPublicID?: MappedID` (exactly one)                                 | **No execution** — handled entirely in `GameServer.handleIntent` (`GameServer.ts:364-395`)                       | Lobby creator or admin role; host cannot kick in a listed lobby (`IntentAuthorization.ts:46-63`); cannot kick self (`GameServer.ts:379-381`); bans the persistentID (`GameServer.ts:1657-1676`).                                                                                                                  |
| `update_game_config`      | `config: zb.json(GameConfigSchema.partial())`                                                          | **No execution** — `applyGameConfigPatch` (`src/server/ConfigPatch.ts:74-88`)                                    | Lobby creator or admin bot; private games only; before start only; may not set `gameType: Public`; listed lobbies may not enable host cheats or a join whitelist (`IntentAuthorization.ts:65-100`). Only the keys in `ConfigPatch.ts:10-45` are copied; `gameType`, `maxPlayers`, `listed` are ignored by design. |
| `toggle_game_start_timer` | (none)                                                                                                 | **No execution** — sets/clears `startsAt` (`GameServer.ts:402-411`)                                              | Lobby creator or admin bot; private; before start (`IntentAuthorization.ts:102-112`).                                                                                                                                                                                                                             |

Important structural facts:

- Every gameplay intent goes into `this.intents` and is flushed into a `Turn` on the next 100 ms tick (`GameServer.ts:1258-1260`, `:1312-1350`). While paused, intents are accepted but dropped (`GameServer.ts:429-437`).
- `Executor.createExec` returns `NoOpExecution` if `playerByClientID` finds nobody (`ExecutionManager.ts:52-56`), and throws for an unknown type (`:138-139`). Spectators never appear in `GameStartInfo.players`, so their intents (which the ingress already blocks) would be no-ops anyway.
- Client emits exactly these intent types (`src/client/Transport.ts:674-911`): allianceRequest, allianceReject, breakAlliance, allianceExtension, spawn, attack, boat, upgrade_structure, targetPlayer, emoji, donate_gold, donate_troops, quick_chat, embargo, embargo_all, build_unit, toggle_pause, cancel_attack, cancel_boat, move_warship, delete_unit, kick_player, update_game_config, toggle_game_start_timer. All 24 client-originated types are covered; `mark_disconnected` is server-only.

#### Turn, GameStartInfo, GameConfig, GameRecord shapes

- **Turn** (`Schemas.ts:810-815`): `{ turnNumber: uint, intents: StampedIntent[], hash?: float | null }`. `hash` is set by the server only for turns where every reporting client agreed (`GameServer.ts:1811-1814`).
- **GameStartInfo** (`Schemas.ts:918-930`): `{ gameID, lobbyCreatedAt: uint, visibleAt?: uint, listed?: bool, config: GameConfig, players: Player[], tribes?: Tribe[] (max 100, JSON-encoded) }`. `Player` (`:894-905`): `{ clientID, username, clanTag, cosmetics?, isLobbyCreator?, friends?, teamIndex? }`. Array order of `players` is the zbin dictionary seed and is therefore part of the wire contract (`src/core/ZbinWire.ts:14-20`, `:37-46`).
- **GameConfig** (`Schemas.ts:478-556`): required — `gameMap` (GameMapType enum, 120 values), `difficulty`, `donateGold`, `donateTroops`, `gameType`, `gameMode`, `gameMapSize`, `nations: uint 1..400 | "default" | "disabled"`, `bots: uint <= 400`, `infiniteGold`, `infiniteTroops`, `instantBuild`, `randomSpawn`. Optional — `rankedType`, `doomsdayClock {enabled?, speed?: slow|normal|fast|veryfast}`, `overtime {enabled?, startMinutes? 1..120}`, `publicGameModifiers {isCompact, isRandomSpawn, isCrowded, isHardNations, startingGold, goldMultiplier 0.1..1000, isAlliancesDisabled, isPortsDisabled, isNukesDisabled, isSAMsDisabled, isPeaceTime, isWaterNukes, isDoomsdayClock}`, `disableNavMesh`, `disableAlliances`, `disableClanTags`, `liveStatsEnabled`, `anonymizeNames`, `nameReveals[]`, `nameRevealPublicIds[] <=200`, `waterNukes`, `maxPlayers`, `allowedPublicIds[] <=200`, `trusted`, `maxTimerValue 1..120 min`, `customAllianceDuration <=15 min`, `startDelay <=600 s`, `spawnImmunityDuration (ticks)`, `disabledUnits: UnitType[]`, `playerTeams: uint | Duos | Trios | Quads | "Humans Vs Nations"`, `goldMultiplier`, `startingGold <=1e9`, `hostCheats {infiniteGold?, infiniteTroops?, goldMultiplier?, startingGold?}`.
- **GameRecord** (`Schemas.ts:1262-1264`) = `AnalyticsRecord & { turns: Turn[] }`, where `AnalyticsRecord` (`:1219-1226`) = `{ info: GameEndInfo, version: "v0.0.2", gitCommit: 40-hex | "DEV", subdomain?, domain? }` and `GameEndInfo` (`:1192-1203`) = `GameStartInfo & { players: PlayerRecord[], start, end, duration, num_turns, winner, lobbyFillTime, reports? }`. `PlayerRecord` (`:1186-1189`) adds `persistentID: uuid | null` (PII) and `stats: PlayerStats`.

#### Other wire messages

Client → server (`Schemas.ts:1169-1180`): `winner`, `live_stats`, `ping`, `intent`, `join`, `rejoin`, `log`, `hash`, `spectate`, `report`. Server → client (`:1033-1042`): `turn`, `prestart`, `start`, `ping`, `desync`, `error`, `lobby_info`, `new_lobby`. Lobby-list socket (`:386-389`): `full` / `counts`.

`ClientJoinMessage` (`:1133-1149`): `token (uuid | JWT)`, `gameID`, `username` (3–27 chars, Latin-1 letters/digits/space/`_`/`.`/`-`), `clanTag (2-5 alnum | null)`, `cosmetics?` (refs, resolved server-side), `turnstileToken: string | null`, `spectator?`, `gitCommit?`.

#### `src/core/ApiSchemas.ts` and `src/core/WorkerSchemas.ts`

`ApiSchemas.ts` (939 lines) is the schema set for the **closed-source API worker**: `TokenPayloadSchema` (`:20-49`, JWT claims incl. `sub`, `role`, `provider`), `ADMIN_ROLES = ["admin","root"]` (`:51`), `UserMeResponseSchema` (`:152-314`, includes `player.flares`, `publicId`, `friends`, `clans`, `trustTier: "untrusted"|"trusted"`, `canCreatePublicLobbies`, subscription), plus cosmetics, rewards, tribe names/boosts, payments checkout, leaderboards, player profiles/stats trees, public games. None of it is served by this repo.

`WorkerSchemas.ts` (11 lines): `CreateGameInputSchema` = full `GameConfig` **or** an empty strict object (→ `undefined`), and `GameInputSchema = GameConfigSchema.partial()`.

#### zbin binary format (one paragraph)

Every frame on the game and lobby WebSockets is a zbin payload — a bare positional byte stream derived directly from the Zod schema, with no version byte, no field tags, and no JSON fallback (`src/core/ZbinWire.ts:1-12`, `zbin/README.md:28-53`). Objects encode fields in declaration order behind a presence-bit header (optional/nullable flags and boolean values are bits), literals cost 0 bytes, discriminated-union tags ~1 byte, `zb.uint` is a minimal LEB128 varint, `zb.int` zigzag, `zb.float` bit-exact float64 LE, strings are varint-length + UTF-8, `zb.json` subtrees are varint-length + JSON, and `zb.mapped("clientId")` fields encode as a 1–2 byte dictionary index seeded identically on both peers from `GameStartInfo.players` (`zbin/README.md:102-122`, `:165-197`). Limits: 2^20 decoded elements per message, depth 64, mapping table 65,535 (`zbin/README.md:149-163`). Because there is no version negotiation, **client and server must be built from the same commit**; the server enforces this by rejecting joins whose `gitCommit` differs (`src/server/Worker.ts:433-460`), and `tests/zbin/golden.test.ts` pins the byte layout. HTTP endpoints stay JSON.

---

### 2. Server validation and abuse controls actually present

Blunt framing first, as it stood before session 13: **the server did not run the simulation.** It was an intent relay plus a lobby coordinator. It never knew how much gold, troops, or territory anyone had, never checked that an attack target was adjacent, never checked that a build was affordable or legally placed, and never checked that a unit ID belonged to the sender. All of that is decided independently by every client's copy of `src/core`, and agreement is verified after the fact by hash comparison (section 3). Since session 13 the server also runs its own copy (2e below) and refuses the stable impossibilities; the rest of this section is what a frame passes through before that.

#### 2a. Connection / join gate (`src/server/Worker.ts:400-780`)

1. First message must be `join` or `rejoin` (`:400-405`).
2. Worker routing: `simpleHash(gameID) % numWorkers` must equal this worker, else close `WrongWorker` (`:412-419`).
3. Build pin: `gitCommit` must equal `ServerEnv.gitCommit()` (or the literal `"desktop"`), else typed `version_mismatch` error and close (`:433-460`).
4. Token: `verifyClientToken` (`src/server/jwt.ts:21-63`) — EdDSA JWT verified against the API's JWKS with issuer `https://api.<DOMAIN>` and audience `DOMAIN`. In `GAME_ENV=dev` a bare UUID is accepted as the persistentID (`jwt.ts:24-33`); in prod a UUID is rejected.
5. `role === "banned"` → close `Banned` (`:474-476`).
6. Local censor of username/clanTag (`src/server/Censor.ts`, obscenity dataset + shadow-name replacement) as the fail-open fallback (`:497-500`).
7. Turnstile + name screening via the API's `POST /join_verify` (`src/server/JoinVerify.ts:102-144`, 5 s timeout, never retried). Plan (`JoinVerify.ts:54-79`): first join without a token → **reject** (unless Steam-authenticated JWT); re-admit → skip if game started or identity unchanged; otherwise verify with null token (name check only). API `"error"` (timeout/5xx/unreachable) → **fail open** with the locally censored name (`Worker.ts:577-583`). Whole block skipped in dev (`:517`).
8. If the token carried claims: `GET /users/@me` on the API (`jwt.ts:65-100`) for flares, publicId, friends, clan memberships, `trustTier`. Failure → close `AccountLookupFailed` (`:627-635`). Anonymous (UUID) joins are only allowed when `ALLOWED_FLARES` is unset (`:621-624`).
9. `ALLOWED_FLARES` allowlist (`:643-655`).
10. Clan-tag ownership resolved against the API's `/reserved_clan_tags` (`src/server/Privilege.ts`, refreshed by `PrivilegeRefresher.ts`); unowned real tags dropped (`:660-671`).
11. Cosmetic entitlement check against `/cosmetics.json` + flares (`:673-684`); forbidden → close.
12. `GameServer.joinClient` (`GameServer.ts:473-622`): ended game → reject; kicked persistentID → reject; `allowedPublicIds` allowlist (admins bypass, `:1170-1175`); `trusted` gate (`:1180-1184`); late joiner after start → forced spectator (`:504-509`); `maxPlayers` (spectators don't count, `:513-532`); **max 3 other clients from the same IP in public games** (prod/preprod only, `:542-555`); **one live socket per persistentID in prod** — the older socket is evicted with `kick_reason.duplicate_session`, not banned (`:557-590`).

#### 2b. Per-frame ingress (`src/server/SocketIngress.ts:95-186`)

1. Structural zbin decode; corrupt bytes → kick `kick_reason.invalid_message` (`:103-112`).
2. Full Zod validation of `ClientMessageSchema`; failure → kick `invalid_message` (`:113-133`). This is the only place field ranges/enums are enforced.
3. Rate limit (`src/server/ClientMsgRateLimiter.ts`): per client — **10 intents/second**, **150 intents/minute**, **5 rejoins/minute**, **any single intent > 2000 bytes → kick**, **cumulative > 5 MiB per client for the game → kick** (`ClientMsgRateLimiter.ts:4-12`, `:25-53`). Over-rate → frame dropped ("limit"), not kicked (`SocketIngress.ts:160-175`). Note: only `intent` and `rejoin` are token-bucketed; `hash`, `ping`, `winner`, `live_stats`, `report`, `spectate`, `log` count toward the 5 MiB byte cap only.
4. Spectator block: spectators cannot send `intent`, `winner`, `live_stats`, `hash`, `report` (`:18-24`, `:179-184`).
5. Roster check: frames from a client no longer on the roster are dropped (`GameServer.ts:680-682`).

#### 2c. Intent authorization (`src/server/IntentAuthorization.ts`)

Covered in the table above. Summary: the server authorizes **who may send control intents** (kick / config / start timer / pause) and rejects `mark_disconnected`; every gameplay intent from a non-spectator roster member passes with zero semantic checks (`:130-135`). Admin-bot HTTP intents are limited to control intents on private games (`:38-40`, `:132-134`).

#### 2e. The shadow simulation (`src/server/ShadowSim.ts`, FightWars, session 13)

`GameServer.start()` asks `deps.shadowSim` for a `ShadowSim` (`SHADOW_SIM=off` gives none) and calls `start()` on it, which builds a `GameRunner` through `createGameRunner` with `ServerMapLoader` — the same resolution `MapLandTiles` uses: the hashed map files under `static/` in production, `resources/maps` in dev. Every committed turn (`endTurn`) is handed to `shadow.applyTurn`, which queues it until the map has loaded and then executes it; the shadow is therefore always exactly the turns the server has committed, one turn behind the clients. On the gameplay path of `handleIntent`, `shadow.check(stamped)` runs before the intent joins a turn; a string refuses it with `403` and the reason, logged (`intent refused by shadow sim`) and counted (`GameServer.numShadowRefusals()`, `GameManager.shadowRefusalCount()`, the `refused` column on `/metrics`, the OTel gauge `shadow_refusals.total`).

What it refuses, and why only this: a client with no player in the game; a `spawn` after the spawn phase; any gameplay intent from a dead player after the spawn phase; `build_unit` of a type the lobby disabled; `attack` on oneself or on a player id the game does not have; `move_warship` / `delete_unit` / `cancel_boat` / `upgrade_structure` naming a unit that does not exist or is not the sender's. Every one of these is a fact that cannot change within a turn. Gold, territory, reachability and alliances all move within a tick, and a shadow one turn behind that refused on them would drop honest intents — so those stay where they were, in the simulation every client runs. Until the map has loaded the shadow judges nothing (an intent it cannot see goes through, never refused); if the map cannot load or a tick throws, it logs and judges nothing from then on.

The shadow also keeps the state hashes its own sim emits (every ten ticks, `GameUpdateType.Hash`, the same numbers the clients report). `DesyncDetector.check` takes a `reference(turn)`; when the shadow has a hash for the turn being checked, that hash is the correct one and every client that reported something else is out of sync — no vote, no strict-majority rule, and a lone client is checked too. A majority of tampered clients cannot outvote the server. Where the shadow has no hash (not ready, failed, or the turn is not a hash tick) the check falls back to the vote it always was.

The shadow also reads the sim's own cooldown predicates where they depend on nothing but the clock: `canSendEmoji` (five seconds per recipient), `canSendQuickChat` (three), `canEmbargoAll` (ten). An intent inside the cooldown is refused (`emoji cooldown`, `quick chat cooldown`, `embargo cooldown`); one sent the very tick a cooldown ends can be refused a tick early, which a player does not reach by hand — the client greys the button on the same predicate. The predicates that also read relations (donations, alliance requests, targeting) are deliberately not consulted: an alliance made this turn would make their answer wrong.

Before the shadow, `IntentCaps` (`src/server/IntentCaps.ts`) caps the social intents per client and family with token buckets, at rates no hand reaches: emoji 10 / 10 s, quick chat 10 / 10 s, alliance intents 15 / min, donations 10 / min, targeting 10 / min, embargoes 20 / min. Over the cap the intent is dropped with 429 and counted (`GameServer.numSpamDrops()`); the client is not kicked. The sim's cooldowns are per recipient, which is what made a per-family cap necessary — a client ignoring its own UI could send an emoji to every player in the lobby every tick and break no cooldown. Attacks, builds and moves are the game and are never capped here (`ClientMsgRateLimiter`'s ten intents a second still applies to everything).

**Automation detection** (`src/server/AutomationScorer.ts`). Every gameplay intent's arrival time is a data point, accepted or not. Once a client has forty of them the scorer asks two questions of the gaps: how fast (intents per second over the window) and how even (the coefficient of variation of the gaps). Eight a second or more over a whole window is a rate no hand sustains (`superhuman-rate`); four a second or more with a coefficient of variation under 0.08 is a machine's timing (`machine-timing`) — a hand's bursts vary by a third or more. A client is flagged once, to the log (`client flagged for automation`, with the rate and the CV) and to `GameServer.numAutomationFlags()`. A flag is a verdict, not a punishment: the caps and the shadow already bound what a script can do, and a false flag costs a player nothing. Thresholds are exported so `tests/server/AutomationScorer.test.ts` sits on either side of each.

**Fog of war — decided, not built.** The brief asks that hidden information be filtered server-side, never client-side. In this architecture every client runs the whole simulation from the same intent log; there is no per-viewer state to filter, and a server that sent each client a different view would have to send each a different game, which is a rewrite of lockstep, the replay format and the desync check together. Render-only fog would hide nothing from a client that already holds the state. Fog is therefore out of scope for this fork and recorded here so nobody builds the client-side version by mistake.

**A map of the game's own.** `loadTerrainMap` caches `TerrainMapData` per map and size for the process, and the `GameMap` inside it carries per-game tile state. That was invisible while every game ran in its own worker; a server running several shadows in one process would have had them share territory. `createGameRunner` takes `{ freshMap: true }` (the loader's `useCache = false`) and the shadow passes it; a client keeps the cache. `tests/server/ShadowSim.test.ts` pins it ("gives every game a map of its own").

The shadow also keeps the `WinUpdate` its sim declared — the same update every client votes from, winner and `allPlayersStats`. In `handleWinner`, a vote that names anyone other than the shadow's winner is overruled (logged, `numOverruledWinnerVotes()`) and does not enter the tally; the honest ballots still carry the vote, so the end of the game keeps its timing. `archiveGame` records the shadow's winner and stats whenever it has them, whoever voted for what, and logs `settledBy: "shadow"`; without a shadow, or before it saw the end, the vote stands as before. Ingest (`src/api/Matches.ts`) therefore receives the server's own result for every shadowed game.

Cost: one extra simulation per lobby on the worker. Measured on this box: the world map loads in 47 ms through the server loader; 300 turns with 50 bots took 255 ms (0.85 ms a turn early in a game; the perf gate's 150-player tick is ~3 ms). Tests: `tests/server/ShadowSim.test.ts` (the real sim on the plains test map) and `tests/server/GameServerShadow.test.ts` (the hooks, with a fake shadow), `tests/server/DesyncDetector.test.ts` (the reference).

#### 2d. HTTP surface

- Master (`src/server/Master.ts`): `express-rate-limit` **20 req/s per IP** on everything (`:102-107`), `trust proxy 3` (`:101`). Routes: `/`, `/desktop/version.json`, `/desktop/release.json`, `/cluster.json`, `/api/health`, SPA fallback.
- Worker (`src/server/Worker.ts`): `POST /api/create_game` requires a Bearer token (JWT or dev UUID), rejects `gameType: Public` (`:148-247`); `POST /api/game/:id/listing` requires creator token, refuses public/started games, one-way listing, rejects whitelist/host-cheat lobbies, requires `canCreatePublicLobbies` from `/users/@me` in non-dev, one listed lobby per creator, cluster cap `MAX_HOSTED_LOBBIES = 10` (`:253-342`); `GET /api/game/:id/exists` and `GET /api/game/:id` are **unauthenticated** and return full `gameInfo()` including the config and (anonymised if configured) client list (`:344-357`).
- Admin bot (`src/server/AdminBotRoutes.ts`): `x-admin-bot-key` shared secret, 401 on mismatch, routes disabled entirely when `ADMIN_BOT_API_KEY` is unset (`:36-49`, `ServerEnv.ts:271-274`). Routes: `create_game`, `game/:id/roster`, `game/:id/stats`, `game/:id/pin`, `game/:id/intent` (`:80-310`).

#### 2e. Post-game claims (winner / stats / reports)

- Winner is a **client claim** settled by an IP-weighted strict-majority vote among non-spectator, non-desynced, non-kicked clients (`GameServer.ts:1845-1882`, `src/server/Consensus.ts:18-60`, `src/server/VoteTally.ts:29-36`). With 2 unique IPs both must agree (`VoteTally.ts:24-28`). Re-tallied among still-active IPs whenever the electorate shrinks (`GameServer.ts:1891-1904`). Per-player stats in the archived record are whatever the winning vote's `allPlayersStats` said (`:1732`).
- Live stats: same vote, one per client per turn, last 20 pending rounds (`Consensus.ts:66-133`).
- Reports: one per (reporter, reported) pair, started games only, dropped silently otherwise (`:1782-1802`).

#### 2f. Lifecycle limits

`maxGameDuration` 3 h (`GameServer.ts:168`), `disconnectedTimeout` 30 s → `mark_disconnected` intent every 5 turns (`:170`, `:1685-1702`), stale-ping prune 60 s (`:1419`), empty-game reap 30 s warm-up + 20 s no pings, or 10 min empty backstop (`:1483-1503`), `emptyGameTimeout` 10 min (`:175`).

#### 2g. What is NOT validated server-side (explicit list)

- Any gameplay semantics: troop counts, gold, adjacency, ownership of units/attacks, build legality/cost, alliance state, embargo state, spawn-phase timing, `disabledUnits`.
- `attackID` string length/format (free `z.string()`).
- Emoji/quick-chat spam beyond the generic 10/s bucket.
- Winner/stats truthfulness beyond majority vote — a colluding majority of IPs (or a 1v1 where both agree) can archive any result.
- Hash truthfulness — a client can echo the majority hash without running the sim (it only needs to lag 10 turns; see section 3).
- `live_stats`, `hash`, `winner`, `report`, `ping`, `spectate`, `log` message rate (byte cap only).
- Turnstile in dev; account lookup in dev; listing subscription in dev.
- Nothing in `src/core` is executed on the server at all (no `GameRunner` on the server path; `MapLandTiles.ts` only reads manifest land counts for lobby sizing).

---

### 3. Desync detection

Mechanism (`src/server/DesyncDetector.ts`, `src/server/GameServer.ts:1804-1843`):

- Client side: `GameImpl.executeNextTick` emits a `Hash` update every 10 ticks (`src/core/game/GameImpl.ts:519-525`); `ClientGameRunner` converts it to `SendHashEvent` (`src/client/ClientGameRunner.ts:971-972`); `Transport` sends `{type:"hash", turnNumber: tick, hash}` (`src/client/Transport.ts:852-858`). Server stores it in `client.hashes` (`GameServer.ts:716-718`, `src/server/Client.ts:9`).
- Server side: on every committed turn, `DesyncDetector.check(turnsCommitted, activeClients)` runs (`GameServer.ts:1335`). It only acts when `turnsCommitted % 10 === 0 && turnsCommitted >= 10` and there are ≥ 2 active clients, and it examines turn `turnsCommitted - 10` (`DesyncDetector.ts:74`, `:92-104`) — i.e. hashes are compared **one second after** the turn they describe.
- Comparison (`DesyncDetector.ts:19-65`): count identical hash values among clients that reported that turn; the most common value wins (ties → first-seen); everyone else is out of sync. If the out-of-sync set is a **strict majority** of active clients, everyone is marked out of sync (`:56-59`). Clients that reported nothing are not counted.
- Outcome (`GameServer.ts:1811-1842`): no disagreement → `turns[turn].hash = mostCommonHash` (this is what gets archived). Disagreement → a `desync` message `{turn, correctHash, clientsWithCorrectHash, totalActiveClients}` is sent **once** to each newly-desynced client (`DesyncDetector.record`, `:108-119`), the client is added to a permanent `desynced` set, and the turn is archived **without** a hash. There is no re-sync, no kick, no resend of state; the desynced client keeps playing its divergent sim.
- Consequences of being desynced: `winner` and `live_stats` votes ignored (`GameServer.ts:1847`, `:1915`). Nothing else.
- Client reaction (`src/client/ClientGameRunner.ts:1045-1056`): logs `desync from server: …` and shows the `error_modal.desync_notice` string. That is the full response.
- Alerting: **none.** The only aggregate is `GameManager.desyncCount()` (`src/server/GameManager.ts:127-132`) exported as the OTel gauge `openfront.desyncs.gauge` (`src/server/WorkerMetrics.ts:59`), which is only emitted when `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_AUTH_HEADER` are set and `GAME_ENV != dev` (`ServerEnv.ts:246-251`). Log lines `sending desync to client` at info level (`GameServer.ts:1834`).
- Singleplayer / replay (`src/client/LocalServer.ts:198-235`): in singleplayer only every 100th turn's hash is stored in the record; in replay each incoming hash is compared to `replayTurns[n].hash` and a synthetic `desync` message is generated locally on mismatch.
- Headless replay verifier: `tests/replay/ReplayGame.ts` (`npm run replay:game -- <gameID|file> [--api-base] [--teams]`) re-runs a record and exits non-zero if any recomputed hash differs from the archived one. This is the only end-to-end determinism harness in the repo, and it needs either a local record file or the closed API to fetch one.

---

### 4. Replay / archive record format

Built by `GameServer.archiveGame` (`GameServer.ts:1722-1769`) → `createPartialGameRecord` (`src/core/Util.ts:289-340`) → `finalizeGameRecord` (`src/server/Archive.ts:79-88`) → `archive()` which `POST`s JSON to `https://api.<DOMAIN>/game/<gameID>` with `x-api-key` (`Archive.ts:15-45`). **There is no local/disk archive path at all** — if the API is down the record is logged as an error and lost. `readGameRecord` (`:47-77`) is the `GET` counterpart. Singleplayer records are uploaded by the client to `/archive_singleplayer_game` (`src/client/LocalServer.ts:345`).

Record contents (`PartialGameRecordSchema`, `Schemas.ts:1266-1268` + `Archive.ts:79-88`):

```
{
  version: "v0.0.2",
  gitCommit: <40-hex | "DEV">,        // stamped server-side
  subdomain, domain,                   // stamped server-side (absent on singleplayer)
  info: {
    gameID, lobbyCreatedAt, visibleAt?, lobbyFillTime,
    config: GameConfig,                // allowedPublicIds / nameRevealPublicIds stripped at start()
    players: [{ clientID, username, clanTag, persistentID (PII), stats, cosmetics?,
                teamIndex?, friends?, isLobbyCreator? }],   // same order as GameStartInfo.players
    start, end, duration (s), num_turns, winner?, tribes?, reports?
  },
  turns: Turn[]   // only turns with intents.length > 0 OR hash !== undefined are kept (Util.ts:312-314)
}
```

Turn `hash` is present only on multiples of 10 where all reporting clients agreed. `teamIndex`, `friends`, `isLobbyCreator` are documented as simulation inputs that replays need (`GameServer.ts:1743-1749`). A lenient `ArchivedAnalyticsRecordSchema` (`Schemas.ts:1230-1260`) exists for reading historical records with older username/clanTag/nations rules; replays still require an exact `gitCommit` match on the client (`src/client/JoinLobbyModal.ts` per the comment at `Schemas.ts:1236-1237`).

Wire-side `start` message for a rejoin carries `turns: this.turns.slice(lastTurn)` (`GameServer.ts:1288`) — a mid-game rejoin replays every turn since `lastTurn` locally; there is no state snapshot.

---

### 5. Lobby matrix

Enums (`src/core/game/Game.ts`): `GameType {Singleplayer, Public, Private}` (`:129-133`), `GameMode {FFA = "Free For All", Team}` (`:137-140`), `RankedType {"1v1", "2v2"}` (`:142-145`), `GameMapSize {Compact, Normal}` (`:150-153`), `Difficulty {Easy, Medium, Hard, Impossible}` (`:77-82`), team presets `Duos/Trios/Quads/"Humans Vs Nations"` (`:97-100`), `PublicGameType {ffa, team, special, hosted}` (`Schemas.ts:164-169`).

**Speed (FightWars, session 13):** `GameConfig.gameSpeed` (1–4, absent = 1) is turns per 100 ms of wall clock. The simulation never reads it — a tick is a tick, and every duration in ticks (cooldowns, the spawn phase, alliance length, `maxTimerValue` in game minutes) compresses with it. `GameServer.turnIntervalMs()` divides the deployment's 100 ms by it for the turn timer and the turn-stats budget; `LocalServer` divides the same way for singleplayer (the replay multiplier, `.`/`,`, stays the player's own dial on top); the HUD clock (`GameRightSidebar`) divides game seconds by it to show wall time, so a five-minute Blitz at 4× — `maxTimerValue` 20 game minutes — reads five on the clock. The host lobby and the single-player modal offer 1× / 2× / 4× (`GameConfigSettings`, `game-speed-selected`); the join view does not (it only reads). Beside the three, one card is **Blitz** (`BLITZ_PRESET` = 4×, `timerGameMinutes` 20; `blitz-preset-selected`): the modal sets the speed, turns the compact map on through its own handler (which rescales bots and nations) and puts twenty game minutes on the clock in one click, and the card reads pressed while all three hold (`isBlitzPreset()`) — move any one and it releases. The rotation's `isBlitz` in `MapPlaylist` builds the same by hand. `Config.gameSpeed()` is the accessor. `tests/GameSpeed.test.ts`: the schema's bounds, the server committing 10 / 20 / 40 turns a second, and nothing in the sim's config moving with it. Before this the interval was hard-coded 100 ms on both sides and `DoomsdayClockConfig.speed` (the anti-stall clock's pacing, `Schemas.ts`) was the only "speed".

**Density:** `GameMapSize.Compact` loads the `map4x` half-resolution binary (`src/core/game/TerrainMapLoader.ts:95-212`) and halves nation coordinates (`NationCreation.ts:53-87`, `TribeSpawner.ts:95-98`); bots drop to 100 (`MapPlaylist.ts:196`). `isCrowded` (`publicGameModifiers`) raises `maxPlayers` to 125 (60 if also compact) on maps whose base count is ≤ 60 (`MapPlaylist.ts:329-333`, `:810-815`). Player capacity formula: `max(round5(landTiles/1e6 * 50), 5)`, then 75 % / 50 % variants, capped at `MAX_PLAYER_COUNT = 125` (`MapPlaylist.ts:890-897`, `:29`).

| Cell                                | Exists?                  | Where / how                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Singleplayer × FFA                  | Yes                      | `src/client/SinglePlayerModal.ts` → `LocalServer` in-browser; `compactMap` toggle (`:101`, `:1110-1111`), doomsday speed (`:118`), all `GameConfig` cheats available.                                                                                                                                                                                                                                |
| Singleplayer × Team                 | Yes                      | same modal, `playerTeams` selectable.                                                                                                                                                                                                                                                                                                                                                                |
| Public × FFA                        | Yes                      | Master schedules `ffa` lobbies: 6 queued per type (`MasterLobbyService.ts:31`), countdown = `gameCreationRate()` = 2 min prod / 5 s dev (`ServerEnv.ts:111-113`), every 3rd FFA map compact (`MapPlaylist.ts:152`), overtime on, clan tags hidden, bots 400/100, nations default, difficulty Medium (`:140-200`). Every 4th scheduled public game is trusted-only (`:36`, `:129-136`).               |
| Public × Team                       | Yes                      | `team` queue; team count rolled from `TEAM_WEIGHTS` (2–7 teams, Duos, Trios, Quads, HvN) (`:38-49`); nations disabled unless HvN; HvN = Hard difficulty.                                                                                                                                                                                                                                             |
| Public × Special                    | Yes                      | `special` queue rolls FFA/Team 50/50 and up to 3 modifiers from `SPECIAL_MODIFIER_POOL` (`:57-107`, `:204-460`); modifiers: random spawn, compact, crowded, hard nations, starting gold 1M/5M/25M, gold ×2, alliances off, nukes off, SAMs off, 4-min peace, water nukes, doomsday clock.                                                                                                            |
| Public × Ranked 1v1 / 2v2           | Yes, via API matchmaking | Worker long-polls `POST /matchmaking/checkin` every ~5–6 s (`Worker.ts:813-905`); 1v1: Australia 40 % / Iceland / Asia / EuropeClassic, 20 % compact, 15 min timer (10 compact), no nations (`MapPlaylist.ts:465-494`); 2v2: same maps, 50 % compact, `playerTeams: 2` (`:496-526`). Cancelled if a matched player never connects (`GameServer.ts:791-816`). **Unavailable without the closed API.** |
| Private × FFA / Team                | Yes                      | `POST /api/create_game` with any `GameConfig` (`Worker.ts:148-247`); host edits via `update_game_config`; host cheats block; join by 8/10-char game ID.                                                                                                                                                                                                                                              |
| Private, publicly listed ("hosted") | Yes, subscribers only    | `/api/game/:id/listing` requires `canCreatePublicLobbies` from the API in non-dev (`Worker.ts:305-315`); auto-starts after 5 min listed (`Schemas.ts:193`), 10 min if featured by admin bot (`:200`); cluster cap 10.                                                                                                                                                                                |
| Any × "Fast" speed                  | **No**                   | see above.                                                                                                                                                                                                                                                                                                                                                                                           |
| Any × Compact                       | Yes                      | `gameMapSize` on every path; public FFA every 3rd map, special via modifier, ranked by roll, private/singleplayer by toggle.                                                                                                                                                                                                                                                                         |
| Any × Crowded                       | Public special only      | `isCrowded` is only produced by `MapPlaylist.getSpecialConfig` (and `forcedModifiers` such as World's `isCrowded:50`, `Maps.gen.ts:2237`); host/singleplayer UIs expose no crowded toggle (grep of `SinglePlayerModal.ts`/`HostLobbyModal.ts` finds only `compact`).                                                                                                                                 |

Infrastructure: master forks `numWorkers` cluster workers from `CLUSTER_JSON[<self>].numWorkers` (`Master.ts:136-144`, `ServerEnv.ts:50-52`, dev default 2). Each worker owns the games whose `simpleHash(gameID) % numWorkers` equals its index (`ServerEnv.ts:114-119`) and listens on port `3001 + index` (`:123-125`); master on 3000 (`Master.ts:174`). There is **no cap on lobbies per worker** — `GameManager` is an unbounded `Map` ticked every second (`GameManager.ts:19`, `:26`); the master only limits _queued public_ lobbies to 6 per type and hosted listings to 10. Workers report their lobby list to the master over IPC; master broadcasts the merged list every 500 ms and schedules every 1 s (`MasterLobbyService.ts:126-127`). Health = ≥ half the workers ready (`:101-106`). Behind the blue/green load balancer only the active colour schedules public lobbies (`Master.ts:186-198`, `ActiveDeployment.ts`).

---

### 6. Map roster

Source: `src/core/game/Maps.gen.ts` (generated from `map-generator/assets/maps/*/info.json`; `GameMapType` enum has **120** members, `maps` array has 120 entries) and `resources/maps/<id>/manifest.json` (120 directories, 524 MB, each with `map.bin`, `map4x.bin`, `map16x.bin`, `thumbnail.webp`). `docs/Maps.md` is an 11-line pointer to the Go generator. Sizes below are full-res `width×height` in tiles; compact = `map4x` (half each axis). `mp` = `multiplayerFrequency` (0 = never in the public rotation unless a per-mode frequency is set; `-` = absent from manifest).

| Map                   | Size           | Land tiles | Nations       | mp / ffa / team | Categories                                 |
| --------------------- | -------------- | ---------- | ------------- | --------------- | ------------------------------------------ |
| Achiran               | 2000×1700      | 1,149,943  | 4             | 5 / – / –       | fictional, europe                          |
| Aegean                | 1700×2000      | 1,171,283  | 29            | 6 / – / –       | europe, asia                               |
| Africa                | 1948×2032      | 2,183,279  | 44            | 7 / – / –       | featured #6, continental                   |
| Alps                  | 2000×1836      | 3,672,000  | 30            | 4               | europe                                     |
| AmazonRiver           | 5536×276       | 1,150,819  | 21            | 3               | south_america                              |
| Antarctica            | 2212×2212      | 1,292,224  | 30            | 4               | antarctica, continental                    |
| ArchipelagoSea        | 3100×1508      | 287,155    | 20            | 1 / 0 / 0       | europe                                     |
| Arctic                | 1828×1828      | 1,679,064  | 44            | 6               | europe, north_america, asia                |
| Asia                  | 2000×1200      | 1,079,587  | 25            | 6               | featured #5, continental (ranked pool)     |
| Australia             | 2000×1500      | 1,319,763  | 7             | 4               | oceania (ranked pool, 40 %)                |
| Baikal                | 2500×1564      | 2,181,746  | 11            | 0 / 5 / –       | asia                                       |
| BaikalNukeWars        | 2500×1564      | 1,968,430  | 0             | 0 / – / 30      | fictional                                  |
| BajaCalifornia        | 1800×2120      | 1,345,295  | 8             | 4               | north_america                              |
| Balkans               | 2048×2048      | 2,478,805  | 23            | 6               | europe                                     |
| Balkhash              | 3300×1500      | 2,361,045  | 26            | 4               | asia                                       |
| Baltics               | 1364×1324      | 1,039,982  | 35            | 5               | europe                                     |
| BeringSea             | 2500×1600      | 1,615,723  | 24            | 5 / – / 10      | asia, north_america                        |
| BeringStrait          | 1500×916       | 596,037    | 2             | 2 / – / 5       | asia, north_america                        |
| BetweenTwoSeas        | 1776×1060      | 1,478,803  | 15            | 5               | europe, asia                               |
| BlackSea              | 1500×1100      | 1,165,868  | 9             | 6               | europe, asia                               |
| BosphorusStraits      | 1000×612       | 382,332    | 22            | 3 / – / 10      | europe, asia                               |
| BranchingPaths        | 2480×2148      | 2,103,911  | 19            | 7               | arcade                                     |
| Britannia             | 1600×2088      | 1,183,898  | 20            | 5               | europe                                     |
| BritanniaClassic      | 2000×1396      | 933,571    | 23            | 0               | europe                                     |
| Caribbean             | 3200×1808      | 577,573    | 34            | 5               | north_america                              |
| CaspianSea            | 1008×1728      | 951,192    | 12            | 5 / – / 10      | asia                                       |
| Caucasus              | 1248×1000      | 846,140    | 21            | 5               | europe, asia                               |
| CentralAmerica        | 2500×1956      | 1,162,805  | 22            | 5               | new, north_america                         |
| China                 | 2248×2024      | 1,570,704  | 34            | 8               | countries, asia, new (has layers)          |
| ChoppingBlock         | 1616×1616      | 1,485,703  | 32            | 0               | arcade                                     |
| ClearwaterLakes       | 1872×1656      | 841,410    | 13            | 3               | north_america                              |
| Conakry               | 2456×1000      | 1,108,371  | 20            | 3 / – / 6       | africa                                     |
| Crimea                | 2040×1316      | 958,125    | 9             | 4               | europe                                     |
| DanishStraits         | 872×1224       | 587,312    | 26            | 5               | europe                                     |
| DeglaciatedAntarctica | 2300×1840      | 1,079,790  | 9             | 4               | antarctica, fictional                      |
| Didier                | 1500×1348      | 1,122,321  | 12            | 1               | arcade                                     |
| DidierFrance          | 2100×2248      | 2,303,633  | 42            | 1               | arcade                                     |
| Dyslexdria            | 3308×1440      | 2,103,253  | 82            | 8               | world, fictional                           |
| EastAsia              | 1560×1644      | 879,264    | 22            | 5               | asia                                       |
| Europe                | 2904×1672      | 2,345,907  | 52            | 7               | featured #2, continental                   |
| EuropeClassic         | 2000×1000      | 1,008,469  | 37            | 0               | europe, continental (ranked pool)          |
| FalklandIslands       | 2100×1400      | 746,474    | 12            | 4 / – / 8       | south_america                              |
| FaroeIslands          | 1600×2000      | 424,994    | 6             | 4               | europe                                     |
| FingerLakes           | 1468×1376      | 1,824,045  | 10            | 4               | north_america                              |
| FourIslands           | 1500×1500      | 517,506    | 4             | 4 / – / 30      | fictional                                  |
| France                | 2424×2424      | 2,047,093  | 25            | 8               | europe, countries                          |
| GatewayToTheAtlantic  | 2216×1968      | 2,239,824  | 27            | 5               | europe                                     |
| Germany               | 1548×1516      | 1,072,928  | 16            | 5               | europe, countries                          |
| GiantWorldMap         | 4108×1948      | 2,335,403  | 107           | 15              | world                                      |
| GreatLakes            | 2000×1300      | 1,938,051  | 34            | 6               | north_america                              |
| GulfOfGuinea          | 2500×2200      | 1,788,041  | 22            | 5               | africa                                     |
| GulfOfStLawrence      | 1620×1348      | 874,013    | 26            | 4 / – / 8       | north_america                              |
| Halkidiki             | 2200×1760      | 1,728,899  | 8             | 4               | europe                                     |
| Hawaii                | 3200×2076      | 408,264    | 9             | 4               | oceania                                    |
| Hecatestrait          | 2248×1932      | 2,266,145  | 28            | 4               | north_america                              |
| HongKong              | 2780×1996      | 2,260,689  | 71            | 6               | asia                                       |
| Iceland               | 2000×1500      | 1,069,645  | 8             | 4               | europe (ranked pool)                       |
| IndianSubcontinent    | 2000×2220      | 2,113,509  | 52            | 8               | asia                                       |
| IrishSea              | 1400×1500      | 978,363    | 19            | 5               | europe                                     |
| Italia                | 1360×1272      | 775,663    | 15            | 6               | europe                                     |
| Japan                 | 2500×2500      | 478,894    | 12            | 6               | countries, asia                            |
| JuanDeFucaStrait      | 3000×1100      | 1,666,141  | 16            | 4 / – / 8       | north_america                              |
| Korea                 | 1088×2188      | 782,048    | 32            | 5 / – / 10      | asia, countries                            |
| Labyrinth             | 1360×1360      | 1,524,448  | 26            | 2 / – / 4       | arcade                                     |
| LasVegasStrip         | 2036×4428      | 2,048,698  | 34            | 3               | north_america                              |
| Lemnos                | 1748×1420      | 874,763    | 9             | 3               | europe                                     |
| Levant                | 2000×2000      | 2,173,100  | 15            | 5               | asia                                       |
| Lisbon                | 1600×1600      | 1,495,857  | 15            | 4               | europe                                     |
| LosAngeles            | 1800×2276      | 2,065,301  | 26            | 8               | north_america                              |
| Luna                  | 1308×3508      | 1,517,614  | 25            | 0 / – / 15      | cosmic                                     |
| Manicouagan           | 1600×1600      | 1,992,029  | 11            | 4               | north_america                              |
| MareNostrum           | 2848×1448      | 2,644,620  | 38            | 6               | europe, asia, africa                       |
| Mars                  | 2000×1000      | 1,354,047  | 6             | 3               | cosmic                                     |
| Mena                  | 2200×964       | 1,621,317  | 35            | 6               | asia, africa                               |
| MiddleEast            | 2200×2060      | 3,449,078  | 27            | 8               | asia                                       |
| MilkyWay              | 1748×1748      | 442,979    | 18            | 8               | cosmic                                     |
| MississippiRiver      | 400×4200       | 1,500,944  | 11            | 3               | north_america                              |
| Montreal              | 1528×1500      | 1,954,940  | 12            | 6               | north_america                              |
| MoreThanLuck          | 1348×1344      | 915,740    | 35            | 7 / – / 14      | arcade                                     |
| NewYorkCity           | 1500×1900      | 1,648,646  | 20            | 3               | north_america                              |
| NileDelta             | 1556×1280      | 1,363,238  | 11            | 4               | africa                                     |
| NorthAmerica          | 2800×1448      | 1,243,929  | 71            | 5               | featured #3, continental                   |
| NorthwestPassage      | 2500×1664      | 1,569,905  | 21            | 5               | north_america                              |
| Oceania               | 1664×1000      | 197,878    | 22            | 0               | oceania, continental                       |
| Onion                 | 512×512        | 210,555    | 3             | 2               | arcade                                     |
| Pangaea               | 1000×1000      | 420,335    | 29            | 5               | fictional                                  |
| Passage               | 6000×400       | 803,994    | 16            | 4               | fictional                                  |
| Pluto                 | 2100×1300      | 1,987,279  | 16            | 6 / – / 12      | cosmic                                     |
| QingChina             | 2248×2024      | 1,830,648  | 32            | 4               | asia, countries                            |
| Russia                | 3200×1688      | 2,540,087  | 82            | 8               | europe, asia, countries                    |
| SanFrancisco          | 2000×1700      | 1,887,961  | 21            | 3               | north_america                              |
| Scandinavia           | 2004×2240      | 2,475,461  | 24            | 7               | europe                                     |
| Sierpinski            | 1400×1400      | 582,988    | 9             | 10              | arcade                                     |
| Sol                   | 4432×2528      | 877,664    | 53            | 20 / 0 / 0      | cosmic                                     |
| SouthAmerica          | 1744×2376      | 1,411,064  | 25            | 5               | featured #4, continental                   |
| SoutheastAsia         | 2812×1672      | 977,094    | 31            | 5               | asia                                       |
| StraitOfGibraltar     | 2900×1476      | 1,957,694  | 16            | 5 / – / 10      | europe, africa                             |
| StraitOfHormuz        | 1800×1200      | 1,255,327  | 21            | 4 / – / 8       | asia                                       |
| StraitOfMalacca       | 1832×1644      | 865,820    | 13            | 4               | asia                                       |
| Surrounded            | 1976×1976      | 767,607    | 8             | 4 / – / 8       | fictional                                  |
| Svalmel               | 1700×1580      | 1,011,623  | 5             | 8               | fictional, europe, north_america           |
| TaiwanStrait          | 1600×1600      | 907,469    | 25            | 5 / – / 10      | asia                                       |
| TheBox                | 2048×2048      | 4,194,304  | 13            | 3               | arcade                                     |
| TierraDelFuego        | 2504×1664      | 822,917    | 20            | 5               | south_america                              |
| Titan                 | 1232×2160      | 1,626,582  | 28            | 3               | cosmic                                     |
| Tourney1–4            | 1500×1500 each | 0.9–1.0 M  | 2 / 3 / 4 / 8 | 0               | tournament                                 |
| TradersDream          | 2200×1920      | 972,041    | 13            | 4 / – / 8       | fictional                                  |
| TwoLakes              | 2100×1840      | 3,426,935  | 5             | 4               | europe                                     |
| UnitedStates          | 2800×1548      | 1,868,818  | 49            | 9               | north_america, countries                   |
| Venice                | 2000×1500      | 823,860    | 15            | 6               | europe                                     |
| Vietnam               | 1976×3560      | 1,504,043  | 15            | 4 / – / 8       | countries, asia                            |
| WarshipWarship        | 3000×1396      | 1,122,343  | 10            | 3 / – / 6       | arcade                                     |
| World                 | 2000×1000      | 651,569    | 72            | 30              | featured #1, world (forced `isCrowded:50`) |
| WorldInverted         | 2500×1248      | 1,561,743  | 93            | 8               | world, fictional                           |
| YangtzeRiver          | 3840×2552      | 1,877,550  | 9             | 3               | new, asia                                  |
| YellowSea             | 1500×1152      | 1,042,745  | 8             | 5               | asia                                       |
| Yenisei               | 1200×1500      | 1,207,315  | 6             | 6               | asia                                       |

The seven `featured` maps in ranked order are World, Europe, NorthAmerica, SouthAmerica, Asia, Africa (`featuredRank` 1–6; GiantWorldMap is `world` but unranked). If the brief's ~30 are the classic OpenFront set (World, Europe, Asia, Africa, North/South America, Oceania, Australia, Britannia, Iceland, Japan, Mena, Mars, Pangaea, Baikal, Halkidiki, Black Sea, Bering Strait, Between Two Seas, Deglaciated Antarctica, Faroe Islands, Falkland Islands, Gateway to the Atlantic, Giant World Map, Strait of Gibraltar, East Asia, Pluto, Italia, Yenisei, Known World…) every one of those names is present above **except "Known World"**, which does not exist in this tree under any spelling. Diff the brief against the table to confirm.

Map binaries are **not** shipped in the server image (`Dockerfile:78-79` deletes `resources/maps`); they come from the CDN/`static` bundle.

---

### 7. Client control scheme

Defaults: `src/core/game/UserSettings.ts:16-56` (`getDefaultKeybinds(isMac)`); dispatch table: `src/client/InputHandler.ts:312-474`; all rebindable in-game via the Keybinds tab (`src/client/UserSettingModal.ts:1038+`), stored under `settings.keybinds`; `"Null"` unbinds (`UserSettings.ts:827-834`). Keys are `KeyboardEvent.code` values, optionally `Shift+`-prefixed; Digit/Numpad aliases resolve for build keys (`InputHandler.ts:1116-1127`).

#### Keyboard (default → action)

| Key                                                                                                                                                                    | Action                                                                              | Ref                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| W / A / S / D, Arrow keys                                                                                                                                              | Pan camera (`PAN_SPEED = 5` per 1 ms tick while held)                               | `:549-581`, `:559-577`                         |
| Q / E, `-` / `=`, Numpad− / Numpad+                                                                                                                                    | Zoom out / in (`ZOOM_SPEED = 10`)                                                   | `:586-599`                                     |
| C                                                                                                                                                                      | Center camera on own territory                                                      | `:325-327`                                     |
| Space (hold)                                                                                                                                                           | Alternate/terrain view (`toggleView`)                                               | `:608-614`, `:373-376`                         |
| M                                                                                                                                                                      | Toggle coordinate grid                                                              | `:616-625`                                     |
| 1 City · 2 Factory · 3 Port · 4 Defense Post · 5 Missile Silo · 6 SAM Launcher · 7 Warship · 8 Atom Bomb · 9 Hydrogen Bomb · 0 MIRV (also Numpad, and Shift+ variants) | Arm a ghost structure; pressing the same key again toggles ×1/×5 upgrade multiplier | `:412-473`, `:1058-1069`, `:1151-1179`         |
| Enter / NumpadEnter                                                                                                                                                    | Confirm ghost structure placement                                                   | `:652-658`                                     |
| Escape                                                                                                                                                                 | Cancel ghost structure / selection box / close view / deselect units                | `:627-650`                                     |
| T / Y                                                                                                                                                                  | Attack ratio down / up by `attackRatioIncrement()`                                  | `:358-365`                                     |
| Shift+wheel                                                                                                                                                            | Attack ratio down/up                                                                | `:963-970`                                     |
| B                                                                                                                                                                      | Boat attack                                                                         | `:316-318`                                     |
| G                                                                                                                                                                      | Ground attack                                                                       | `:319-321`                                     |
| Shift+R                                                                                                                                                                | Retaliate attack                                                                    | `:322-324`                                     |
| K / L                                                                                                                                                                  | Request / break alliance                                                            | `:331-336`                                     |
| U                                                                                                                                                                      | Swap rocket (nuke) direction                                                        | `:366-369`                                     |
| F                                                                                                                                                                      | Select all warships                                                                 | `:328-330`                                     |
| Shift (hold) + drag                                                                                                                                                    | Box-select warships; right-click cancels                                            | `:701`, `:712-717`, `:1004-1019`, `:1049-1054` |
| Ctrl (Cmd on Mac) + click                                                                                                                                              | Open build menu at cursor                                                           | `:872-876`, `UserSettings.ts:45`               |
| Alt + click                                                                                                                                                            | Open emoji menu at cursor                                                           | `:877-881`                                     |
| Alt + R                                                                                                                                                                | Reset/refresh graphics                                                              | `:377-410`                                     |
| P                                                                                                                                                                      | Toggle pause (`toggle_pause` intent; host only, or singleplayer)                    | `:337-343`                                     |
| `.` / `,`                                                                                                                                                              | Game speed up / down — **singleplayer & replay only** (`LocalServer.ts:115-131`)    | `:344-357`                                     |
| Shift+D                                                                                                                                                                | Toggle performance overlay (not rebindable)                                         | `:370-372`                                     |

#### Pointer / touch

| Input                                                | Action                                                                                                                                                                    | Ref                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------- | ---------- |
| Left click (no drag, < 10 px)                        | Radial context menu by default; plain `MouseUpEvent` (spawn/attack target) when `leftClickOpensMenu` is off, Shift is held, in spawn phase, or a ghost structure is armed | `:883-908`               |
| Left drag                                            | Pan (`DragEvent`)                                                                                                                                                         | `:1020-1022`             |
| Right click                                          | Context menu; cancels ghost structure or unit selection first; ignored in spawn phase                                                                                     | `:1040-1056`             |
| Middle click                                         | Auto-upgrade nearest structure (`AutoUpgradeEvent`)                                                                                                                       | `:768-771`               |
| Wheel                                                | Zoom at cursor (ignores                                                                                                                                                   | Δ                        | < 2 momentum) | `:911-937` |
| Ctrl+wheel / trackpad pinch / Safari `gesturechange` | Zoom                                                                                                                                                                      | `:916-926`, `:945-961`   |
| Two-finger pinch (touch)                             | Zoom at pinch centre                                                                                                                                                      | `:1026-1037`             |
| Tap (touch)                                          | `TouchEvent` (spawn/attack)                                                                                                                                               | `:887-896`               |
| Long-press 800 ms (touch) + drag                     | Warship box select                                                                                                                                                        | `:790-808`, `:1004-1019` |
| Window blur                                          | Clears all held keys/drag/selection state                                                                                                                                 | `:525-546`               |

`src/client/InputHandler.ts` also emits `ReplaySpeedChangeEvent`, `TickMetricsEvent`, `ShowBuildMenuEvent`, `ShowEmojiMenuEvent`, `DoRequestAllianceEvent`, `DoBreakAllianceEvent` etc. (event classes `:13-201`). Present-vs-brief: everything above exists; there is no dedicated key for "pause" in multiplayer for non-hosts, no chat-typing key (quick chat is menu-driven), and no key for "surrender"/"leave" (handled by HUD buttons).

---

### 8. Determinism enforcement

#### DetMath (`src/core/DetMath.ts`, 132 lines)

Replacements for engine-approximated `Math.*` using only `+ - * /` and IEEE bit views so every engine agrees bit-for-bit (~1e-8 relative): `pow2(n)` (`:31-37`), `exp(x)` (`:40-61`), `log(x)` (`:64-89`), `pow(x, y)` for `x >= 0` (`:92-97`), `atan2(y, x)` (`:124-132`). No `sin/cos/sqrt` replacements (sqrt is correctly rounded by spec; sin/cos are simply not used in core).

#### PseudoRandom (`src/core/PseudoRandom.ts`, 106 lines)

sfc32 with splitmix32 seeding from a 32-bit-truncated numeric seed and 12 warm-up rounds (`:11-32`). API: `next()` [0,1), `nextInt(min, max)`, `nextFloat(min, max)`, `nextID()` (8-char base-36), `randElement(arr)`, `randFromSet(set)` (iteration order!), `chance(odds)`, `shuffleArray(arr)` (Fisher–Yates). The executor seeds with `simpleHash(gameID) + 1` (`ExecutionManager.ts:44`); `simpleHash` is a 32-bit string hash (`src/core/Util.ts:120-128`).

#### Lint rules

`eslint.config.js:50-94`: for `src/core/**/*.ts` (excluding `DetMath.ts`), **error** on `Math.exp/expm1/log/log1p/log2/log10/pow/sin/cos/tan/asin/acos/atan/atan2/sinh/cosh/tanh/cbrt/hypot` and on `**` with any exponent other than the literal `2`. **`Math.random` is NOT banned by lint** — grep of `src/core` finds no `Math.random` and no `Date.now`, only `performance.now()` used for timing logs (`GameImpl.ts:131,151`, `GameRunner.ts:156-158`, `PlayerExecution.ts:116-118`, `DebugSpan.ts`), which does not feed state. `.oxlintrc.json` carries no determinism rules (only `prefer-nullish-coalescing`, `eqeqeq`, `no-case-declarations`). Server-side `MapPlaylist.ts` uses `Math.random` freely, which is fine because lobby config is produced once and shipped in `GameStartInfo`.

#### Hash coverage (what a determinism test actually compares)

```
GameImpl.hash()   = 1 + Σ_players p.hash()                              GameImpl.ts:610-616  (all players incl. dead, bots, nations: _players map, :83)
PlayerImpl.hash() = simpleHash(id) * (troops() + numTilesOwned()) + Σ_units u.hash()   PlayerImpl.ts:1828-1833
UnitImpl.hash()   = tile() + simpleHash(type()) * _id                   UnitImpl.ts:516-518
```

Emitted every 10 ticks (`GameImpl.ts:519-525`).

Covered: per-player troop count (fractional), per-player owned-tile **count**, and for every unit its tile index, type, and id (so unit creation/movement/destruction and ids). Because it is a plain floating-point sum, order of summation is fixed by Map insertion order (deterministic).

**NOT covered** (a divergence here is silent): gold (bigint), relations/alliances/embargoes/targets, _which_ tiles are owned (only the count), attack state and in-flight attack troop pools, unit level/health/cooldowns/cargo, `_ticks`, the PRNG state, executions queue, doomsday clock, overtime, rail network, nation AI state, spawn-phase state, player alive/traitor flags, team assignment. It is also arithmetically weak: `simpleHash(id) * (troops + tiles)` lets a −1 troop / +1 tile change cancel, and the hash is a float, so two different states can collide trivially. A stronger determinism test should compare a serialised state snapshot, not `hash()`.

#### Existing tests

- `tests/server/DesyncDetector.test.ts` (11 cases: majority tally, even split, missing reports, 10-turn cadence, notify-once), `tests/server/GameServerDesync.test.ts` (3 cases: agreed hash recorded, disagreeing client told once, single client skipped), `tests/server/GameServerWire.test.ts` (golden byte transcript incl. a desync frame), `tests/server/SocketIngress.test.ts`, `tests/server/ClientMsgRateLimiter.test.ts`, `tests/server/Consensus.test.ts`, `tests/server/VoteTally.test.ts`, `tests/server/WinnerVoteRetally.test.ts`, `tests/server/IntentAuthorization.test.ts`, `tests/server/KickPlayerAuthorization.test.ts`, `tests/server/TrustedJoin.test.ts`, `tests/server/TurnstileReadmit.test.ts`, `tests/server/JoinVerify.test.ts`, `tests/zbin/golden.test.ts`, `tests/zbin/protocol.test.ts`, `tests/zbin/wire.test.ts`.
- `tests/replay/ReplayGame.ts` (headless record replay, hash compare) and `tests/perf/fullgame/FullGamePerf.ts` (full game in Node) are the only whole-sim harnesses. There is **no test that runs the same seed twice in two processes/engines and diffs state**, and no cross-browser determinism CI.
- 450 `*.test.ts` files total; `npm test` = `vitest run && vitest run tests/server`.

---

### 9. External dependencies on the closed API and other third parties

The API base is `https://api.<DOMAIN>` (or `http://localhost:8787` when `DOMAIN=localhost`), computed identically in `src/server/ServerEnv.ts:84-89` (`jwtIssuer()`), `src/client/ClientEnv.ts:111-116`, and `src/client/Api.ts:1995-2007` (`getApiBase()`, with `API_DOMAIN` / `localStorage.apiHost` dev overrides). No literal `api.openfront.io` appears in code except in `package.json` `dev:staging`/`dev:prod` scripts (`API_DOMAIN=api.openfront.dev|io`), `docs/API.md`, and the replay tool's `--api-base` default.

#### Server → API calls (all with `x-api-key: API_KEY`)

| Endpoint                                         | Caller                                            | Breaks without it                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/jwks.json`                     | `ServerEnv.jwkPublicKey` (`:90-107`), `jwt.ts:37` | **Every non-dev join and create_game** — token verification throws → `InvalidToken` close. In dev, UUID tokens bypass it.                             |
| `POST /join_verify`                              | `JoinVerify.ts:109`                               | Turnstile + name moderation; **fails open** on error (locally censored name), but a _rejected_/timeout-then-reject still closes. Skipped in dev.      |
| `GET /users/@me` (Bearer)                        | `jwt.ts:73`, `Worker.ts:627`, `:307`              | Any JWT join (flares, publicId, friends, clans, trustTier) → `AccountLookupFailed`; hosted-lobby listing (`canCreatePublicLobbies`).                  |
| `GET /cosmetics.json`, `GET /reserved_clan_tags` | `Worker.ts:92-94` via `PrivilegeRefresher`        | Cosmetic entitlement and clan-tag ownership; `FailOpenPrivilegeChecker` (`Privilege.ts:256`) passes everything through when the catalog never loaded. |
| `POST /custom_tribes`                            | `CustomTribes.ts:30`                              | Purchased bot-tribe names; fail-open to organic names (1.5 s timeout).                                                                                |
| `POST /game/:id`, `GET /game/:id`                | `Archive.ts:24`, `:55`                            | **All game-record archiving and replays.** No local fallback.                                                                                         |
| `POST /matchmaking/checkin` (1v1 and 2v2 loops)  | `Worker.ts:831`                                   | Ranked matchmaking; loop logs a warning every ~5 s forever.                                                                                           |
| `GET https://<SITE_HOST>/api/health`             | `ActiveDeployment.ts:22-35`                       | Blue/green drain detection; only when `SITE_HOST` is set.                                                                                             |
| Telemetry ingest `TELEMETRY_INGEST_URL`          | `src/server/telemetry/MatchTelemetryConfig.ts`    | Off unless `TELEMETRY_ENABLED=true`.                                                                                                                  |
| OTLP `OTEL_EXPORTER_OTLP_ENDPOINT`               | `OtelResource.ts`, `WorkerMetrics.ts`             | Off unless both OTEL vars set and not dev.                                                                                                            |

#### Client → API calls (`getApiBase()` / `ClientEnv.jwtIssuer()`)

- Auth (`src/client/Auth.ts:92-673`): Discord/Google/Steam login redirects, `/auth/refresh`, `/auth/logout`, `/auth/revoke`, `/auth/login/token`, `/auth/magic-link`, `/auth/crazygames`, `/auth/steam`, `/auth/link/*`; JWKS fetch (`ClientEnv.ts:117-134`).
- Account/profile/stats (`src/client/Api.ts`, 2000+ lines): `/player/:id`, `/public/player/:id`, `/public/games`, username, creator code, rewards, tribe names/boosts/leaderboards, payments checkout (Stripe / Steam), news, streams feed.
- Cosmetics (`src/client/Cosmetics.ts:729`): `/cosmetics.json`.
- Clans (`src/client/ClanApi.ts`), friends (`src/client/FriendsApi.ts`).
- Replays (`src/client/JoinLobbyModal.ts:1387`): `/game/:id`; versioned replay host (`src/client/VersionedReplay.ts`).
- Singleplayer archive (`src/client/LocalServer.ts:345`): `/archive_singleplayer_game`.
- Matchmaking (`src/client/Matchmaking.ts:262`): `/matchmaking/join?instance_id=&mode=`.
- Steam link (`src/client/SteamLink.ts:209`, `:267`).

**Lobby polling does NOT depend on the API**: the public lobby list is a WebSocket `/w<N>/lobbies` on the game server (`src/client/LobbySocket.ts:72`, `src/server/WorkerLobbyService.ts:262-264`).

#### Other third parties in the client

Cloudflare Turnstile (site key from `TURNSTILE_SITE_KEY`, dev key `1x00000000000000000000AA`, `vite.config.ts:182-184`), Playwire/Google ads and Funding Choices (`index.html:29-78`, `:169`, `src/client/AdGatekeeper.ts`), CrazyGames SDK (`src/client/CrazyGamesSDK.ts`), Steam SDK bridge (`src/client/SteamSDK.ts`, `DesktopShell.ts`), Stripe (`STRIPE_PUBLISHABLE_KEY`, `Payments.ts`), Twitch embed (`https://embed.twitch.tv/embed/v1.js`), Discord CDN avatars, an obfuscated ad script `https://introjava.com/assets/js/gfjjtpm64er_5.v1.js` (grep hit in `src/client`; worth removing in a fork).

#### Every server env var (`src/server/ServerEnv.ts` + telemetry)

`GAME_ENV` (dev|preprod|prod, `:26`), `TURNSTILE_SITE_KEY` (throws if unset, `:53-59`), `DOMAIN` (JWT audience, throws if unset, `:60-66`; also `domain()` `:146`), `SUBDOMAIN` (`:149`), `SITE_HOST` (`:242-245`), `CLUSTER_JSON` (required outside dev; dev default `{"a":{"host":"localhost","color":"blue","numWorkers":2}}`, `:172-209`), `INSTANCE_ID` (set by master, `:67`), `WORKER_ID` (set by master, `:70-74`), `HOSTNAME` (`:75`), `HOST` (`:78`), `CDN_BASE` (`:81`), `GIT_COMMIT` (throws if unset, `:259-265`), `API_KEY` (`:266-268`), `ADMIN_BOT_API_KEY` (`:271-274`), `ALLOWED_FLARES` (comma list, `:278-285`), `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_AUTH_HEADER` (`:253-258`), `TELEMETRY_ENABLED`, `TELEMETRY_INGEST_URL` (https only), `TELEMETRY_SIGNING_SECRET`, `TELEMETRY_BATCH_SIZE`, `TELEMETRY_FLUSH_INTERVAL_MS`, `TELEMETRY_REQUEST_TIMEOUT_MS`, `TELEMETRY_MAX_QUEUE_SIZE`, `TELEMETRY_MAX_QUEUE_BYTES`, `TELEMETRY_MAX_EVENT_BYTES`, `TELEMETRY_PER_PLAYER_PER_TICK_CAP` (`src/server/telemetry/MatchTelemetryConfig.ts:29-97`). Build-time (`vite.config.ts:324-340`): `WEBSOCKET_URL`, `GAME_ENV`, `STRIPE_PUBLISHABLE_KEY`, `API_DOMAIN`, plus `VITE_HOST`, `SKIP_BROWSER_OPEN`. Dev script sets `API_KEY=WARNING_DEV_API_KEY_DO_NOT_USE_IN_PRODUCTION`, `ADMIN_BOT_API_KEY=…`, `DOMAIN=localhost`, `GIT_COMMIT=DEV` (`package.json` `start:server-dev`).

Minimum to run a fork with no API: `GAME_ENV=dev` (UUID tokens, no Turnstile, no `/users/@me`, no listing check) — but archiving, replays, ranked, cosmetics, auth, and stats are all gone, and `prod` mode is unbootable without a JWKS endpoint.

---

### 10. Branding touch points

Counts are case-insensitive matches of `openfront` unless stated.

#### Proprietary assets (`proprietary/`, All Rights Reserved — `LICENSE-ASSETS:19-26`, `proprietary/LICENSE`) — 17 files, every one must be replaced

`fonts/OpenFront.ttf`; `images/Favicon.svg`, `OF.png`, `OF.webp`, `OpenFront.png`, `OpenFront.webp`, `OpenFrontLogo.png`, `OpenFrontLogo.svg`, `OpenFrontLogoDark.svg`; `sounds/effects/game-start-alert.mp3`; `sounds/music/evan.mp3`, `of2.mp3`, `of4.mp3`, `openfront.mp3`, `war.mp3`, `win.mp3`. They override same-named files in `resources/` at build time (`vite.config.ts:169-171`, `:298`, `src/server/PublicAssetManifest.ts:262`; `Dockerfile:20`).

Code that references them: `vite.config.ts:188` (`images/Favicon.svg`), `:199-204` (`OpenFront.png`, `OF.png`), `src/server/RenderHtml.ts:63` (`images/OpenFront.png`), `src/client/Main.ts:405-410` (`fonts/OpenFront.ttf` → `FontFace("OpenFront")`), `src/client/GameVersion.ts:95` and `src/client/styles.css:9` (`--font-display: "OpenFront"`), `src/client/components/DesktopNavBar.ts:61-62`, `MobileNavBar.ts:89-90`, `PlayPage.ts:62-63`, `SteamWishlistButton.ts:40` (`OpenFrontLogo.svg`), `src/client/sound/SoundManager.ts:40` (`sounds/music/openfront.mp3`), `README.md:3-5`.

#### Brand strings in source (52 files match; per-file counts)

`src/client/DesktopShell.ts` 10 (mostly `window.openfrontDesktop`, `app://openfront`), `src/client/Auth.ts` 8, `src/server/OtelResource.ts` 6 (`service.name = "openfront"`, `openfront.*` attributes), `src/server/GameApiCors.ts` 6 (`DESKTOP_APP_ORIGIN = "app://openfront"`), `src/client/Main.ts` 6, `index.html` 5 (title `OpenFront (ALPHA)` `:9`, canonical/og `https://openfront.io/` `:100,107-108`, ad `page_url` `:169`), `src/server/WorkerMetrics.ts` 4 (`openfront.*` gauges), `src/client/components/SteamWishlist.ts` 4, `Footer.ts` 4 (GitHub/Reddit/Discord/wiki links `:47-93`), `NewsMarkdown.ts` 4, `ClientEnv.ts` 4, `src/server/DesktopRelease.ts` 3, `src/client/utilities/DisableSafariPinchZoom.ts` 3, `styles.css` 3 (`:9,11,18` incl. "Openfront Masters sub-brand" palette), `SteamSDK.ts` 3, then 2 each: `ServerEnv.ts`, `hud/layers/WinModal.ts` (`support_openfront`, Discord invite), `PlayPage.ts`, `MobileNavBar.ts`, `DesktopNavBar.ts`, `Payments.ts`, `DesktopPresence.ts`, `DesktopDisplay.ts`, `Api.ts`; 1 each: `RenderHtml.ts`, `Master.ts`, `Logger.ts` (`service: "openfront"`), `GamePreviewBuilder.ts` (`"OpenFront Game"` `:216`), `ActiveDeployment.ts`, `core/ZbinWire.ts`, `core/Util.ts:485` ("Official OpenFront Masters Scrims"), `core/ClusterConfig.ts`, `core/ApiSchemas.ts`, `SoundManager.ts`, `render/frame/TrailManager.ts`, `render/frame/RailroadCache.ts`, `SubscriptionPanel.ts`, `StreamingNow.ts`, `SteamWishlistButton.ts`, `SteamLinkModal.ts`, `LoginResult.ts`, `LobbySocket.ts`, `GameVersion.ts`, `GameStartingModal.ts` (CREDITS link), `CreatorCode.ts`, `BootInterrupts.ts`, `Admiral.ts`, `AccountModal.ts`.

#### Resources

- `resources/lang/en.json`: **1,996 strings** across 91 top-level keys; **28** lines mention OpenFront (title, copyright `© OpenFront™ and Contributors`, support email `support@openfront.io`, subscription/Steam/desktop copy, tutorial title, Firefox warning). 40 language files total; fr 21, vi/uk/sh 20 each, etc.
- `resources/manifest.json` (PWA name `OpenFront.io` / `OpenFront`, icons `/icons/icon512_*.png`), `resources/ads.txt`, `resources/changelog.md`, `resources/news.json`, `resources/icons/wiki-logo.svg`, `resources/press/index.html`, `resources/privacy-policy.html`, `resources/terms-of-service.html`, `resources/images/OfmWintersLogo.png`, `MastersIcon.png` (OpenFront Masters), fonts `resources/fonts/overpass*.woff` (open, CC-BY-SA per `LICENSE-ASSETS`).

#### Deployment / repo

`Dockerfile:96` (`DOMAIN = openfront.dev` special-case), `.github/workflows/deploy.yml:11-15`, `:60`, `:125`, `:503` (`openfront.io` / `openfront.dev` choices, repo guard `openfrontio/OpenFrontIO`), `release.yml:47,95` (`GHCR_REPO: openfront-prod`), `nginx.conf:95,106` (`openfront_workers` upstream, generated by `generate-nginx-upstream.sh`), `README.md`, `LICENSE` (AGPL v3 **with Section 7 attribution terms**: footer and loading-screen "© OpenFront and Contributors" must be preserved in a modified version per `README.md:20-27`, `LICENSING.md` Phase 5), `CREDITS.md`, `CODEOWNERS`, `package.json` name `openfront-client`.

---

### 11. CI today (`.github/workflows/`)

- **`ci.yml`** — on PR, merge-group, push to main: `build` (`npm ci` + `npm run build-prod` on Node 24, uploads `out/index.html`), `test` (`npm run test:coverage` = vitest with coverage; jsdom env, `tests/setup.ts`), `lint` (`npm run lint:github` = oxlint + eslint), `prettier` (`npx prettier --check .`), `gen-maps` (Go toolchain, `npm run gen-maps`, fails if `Maps.gen.ts` drifts from `info.json`). No e2e, no browser, no determinism cross-check, no Docker build.
- **`deploy.yml`** — on every branch push, nightly cron 07:00 UTC, and manual dispatch: builds the Docker image via `build-deploy.sh`, pushes to GHCR, SSH-deploys with `deploy.sh` to Hetzner hosts (`staging`, `masters`, `falk2`), waits for `/commit.txt` to match. Secrets: `API_KEY`, `ADMIN_BOT_API_KEY`, `OTEL_*`, `SSH_PRIVATE_KEY`, `SERVER_HOST*`, `GHCR_TOKEN`; vars: `CLUSTER_JSON`, `TURNSTILE_SITE_KEY`, `CDN_BASE`. Guarded by `github.repository == 'openfrontio/OpenFrontIO'`.
- **`release.yml`** — on GitHub release: `build.sh prod <tag>`, then sequential deploy legs alpha → beta → blue → green (`DEPLOY_TARGETS_*` matrices, `SITE_HOST` set for blue/green).
- **`pr-gate.yml`**, **`pr-author.yml`**, **`pr-description.yml`**, **`pr-close-on-label.yml`**, **`pr-stale.yml`** (14-day close), **`issue-lifecycle-cron.yml`**, **`issue-lifecycle-events.yml`** — repo hygiene bots using `pull_request_target`.
- **`claude-code-review.yml`** — Claude PR review via `pull_request_target` with `CLAUDE_CODE_OAUTH_TOKEN`.
- Local: `husky` pre-commit (`package.json` `prepare`), `npm run inst` = `npm ci --ignore-scripts`.

Runtime image (`Dockerfile`): `node:24-slim`, multi-stage (`build` → `prod-deps` → final with nginx + supervisor + curl/wget/apache2-utils), copies `src/`, `zbin/`, `resources/` (minus maps), `static/`, writes `static/commit.txt`; `supervisord.conf` runs nginx (`daemon off`) and `npm run start:server` (= `tsx src/server/Server.ts`, i.e. **TypeScript executed via tsx in production, no compile step for the server**). `nginx.conf` routes `/w<N>/*` to `127.0.0.1:300(1+N)`, `/api/create_game` and `/api/adminbot/create_game` round-robin to the `openfront_workers` upstream, everything else to the master on 3000, with aggressive proxy caching of assets and a 300 s cache on `/`. Dev: `vite` on **port 9000** (`vite.config.ts:359`) proxying `/lobbies`, `/w0`, `/w1`, `/api` to `localhost:3000-3002` (`:363-392`); `CDN_BASE` from `.env` (`:175`).

---
