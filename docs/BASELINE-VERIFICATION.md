# Baseline verification (brief §5)

Phase 3 of the build brief: "verify everything in Section 5 works, fix what's weak, bring
test coverage on core systems to a level you'd trust." This is the evidence, item by item.
Each row names where the behaviour lives, what pins it (a test that fails if it breaks, or a
recorded run), and any deviation from the brief's wording. Deviations are decisions, recorded
in `BUILD-STATE.md`; the baseline is the code as forked, not the brief's numbers. Every test
path below exists as written (checked 2026-09-12); paths are relative to `tests/`.

Coverage of `src/core` (the deterministic simulation) is measured by `npm run test:coverage`
and gated in `vite.config.ts` (`test.coverage.thresholds`): a change that drops it below the
floor fails CI.

## The loop

| Item                                  | Where                                                                      | Evidence                                                                                                                                                                                                              | Deviation                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Spawn phase, click a homeland tile    | `SpawnExecution`, `SpawnTimerExecution`, `PlayerSpawner`                   | `core/execution/SpawnExecution.test.ts`, `core/execution/SpawnExecutionInvalidTile.test.ts`; solo and two-window runs in `BUILD-STATE.md` session 1                                                                   | Spawn phase length comes from the lobby config, not a fixed 30 s            |
| Expand into neutral land              | `AttackExecution` against terra nullius                                    | `Attack.test.ts`, `AttackScenarios.test.ts`, `DiplomacyVerbs.test.ts` (retreat mid-expansion)                                                                                                                         |                                                                             |
| Fight neighbours                      | `AttackExecution`, `Config.attackLogic`                                    | `AttackLogicGolden.test.ts` (per-tile formula golden), `Attack.test.ts`, `AttackScenarios.test.ts`                                                                                                                    |                                                                             |
| Build economy                         | `PlayerExecution`, `PortExecution`, `TradeShipExecution`, `TrainExecution` | `core/executions/PlayerExecution.test.ts`, `PortExecution.test.ts`, `core/executions/TradeShipExecution.test.ts`, `core/executions/TrainExecution.test.ts`, `TradeTrainGolden.test.ts`, `TradeTrainScenarios.test.ts` |                                                                             |
| Nuke or invade the leader             | `NukeExecution`, `MIRVExecution`, `TransportShipExecution`                 | `core/executions/NukeExecution.test.ts`, `core/executions/MIRVExecution.test.ts`, `nukes/HydrogenAndMirv.test.ts`, `Attack.test.ts` (boats)                                                                           |                                                                             |
| Win at 72 % of land, or last standing | `WinCheckExecution`                                                        | `core/executions/WinCheckExecution.test.ts`; solo match won at 208 228 / 210 555 tiles (session 1)                                                                                                                    | **80 %** of (land − fallout); overtime lowers it 2 pts/min after 30 min     |
| 30–150 players per lobby              | `MapPlaylist` capacity formula, `MAX_PLAYER_COUNT = 125`                   | `server/MapPlaylistOvertime.test.ts`, `server/MapPlaylistTrusted.test.ts`; 150-client load run in `BUILD-STATE.md` (0 desyncs)                                                                                        | Public lobbies cap at 125; the load harness proves 150 in one private lobby |
| Same simulation on every client       | `GameRunner` + the intent log                                              | `determinism.test.ts` (SHA-256 over every player, unit and tile every 100 ticks, two replays in separate processes); nightly full 24 000-tick world match                                                             |                                                                             |

## Resources

| Item                                          | Where                                               | Evidence                                                                                              | Deviation                                       |
| --------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Troops per tile, faster per city, max-pop cap | `Config.maxTroops`, `Config.troopIncreaseRate`      | `core/executions/PlayerExecution.test.ts`, `PlayerStats.test.ts`; formulas in `docs/MECHANICS.md` §01 |                                                 |
| Gold from trade ships and kills               | `TradeShipExecution.complete`, `Config.conquerGold` | `TradeTrainGolden.test.ts`, `LiveTradeRevenue.test.ts`, `ConquerGold.test.ts`                         | Also 100 gold/tick flat income and train income |
| Gold is a bigint                              | `PlayerImpl._gold`, `Gold` type                     | The type system (`Gold = bigint`), `economy/ConstructionGold.test.ts`; `replacer` on every wire       |                                                 |

## Attack model

| Item                                 | Where                                       | Evidence                                                                                 |
| ------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Attack-ratio slider commits a share  | `ControlPanel` → `attack` intent `troops`   | `client/ControlPanelAttackRatio.test.ts`; `ExecutionManagerIntents.test.ts`              |
| Tile-by-tile spread along the border | `AttackExecution.tick`, `AttackImpl` border | `Attack.test.ts`, `AttackImplBorder.test.ts` (border bookkeeping, front representatives) |
| Both sides bleed per tile            | `Config.attackLogic`                        | `AttackLogicGolden.test.ts`                                                              |
| Terrain and Defense Posts raise cost | `terrainAttackBase`, defense-post branch    | `AttackLogicGolden.test.ts`, `AttackScenarios.test.ts`                                   |
| Retreat / cancel boat                | `RetreatExecution`, `BoatRetreatExecution`  | `DiplomacyVerbs.test.ts`                                                                 |

## Structures

Every row of the brief's table exists as a `UnitType` with a cost curve in `Config.unitInfo`
and a build path through `ConstructionExecution` (`economy/ConstructionCost.test.ts`,
`economy/ConstructionGold.test.ts`, `core/executions/UpgradeStructureExecution.test.ts`).
Deviations from the brief's reference costs are listed in `docs/MECHANICS.md` "Where the brief
and the code disagree" (port build time 5 s, silo flat 1M, MIRV `25M + 15M × launched`, shells
200–300). Per-type behaviour: `Warship.test.ts`, `WarshipMultiSelection.test.ts`,
`core/executions/SAMLauncherExecution.test.ts`, `MissileSilo.test.ts`,
`core/executions/NukeExecution.test.ts`, `core/executions/MIRVExecution.test.ts`,
`core/executions/TradeShipExecution.test.ts`, `core/executions/TrainExecution.test.ts`,
`core/game/TrainStation.test.ts`, `core/game/RailNetwork.test.ts`, `Attack.test.ts`
(transports), `DeleteUnitExecution.test.ts` + `DeleteUnitCooldown.test.ts`,
`FindAndUpgradeNearestBuilding.test.ts` (auto-upgrade).

## Diplomacy verbs — all of them

Every verb reaches the simulation through one door, `Executor.createExec`;
`ExecutionManagerIntents.test.ts` pins every wire intent type to its execution and that an
intent from an unknown client is a no-op.

| Verb              | Execution                                 | Behaviour test                                                                                         |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Request alliance  | `AllianceRequestExecution`                | `AllianceRequestExecution.test.ts`, `AllianceExtensionExecution.test.ts`, `PlayerAllianceList.test.ts` |
| Break alliance    | `BreakAllianceExecution` (traitor mark)   | `PlayerAllianceList.test.ts`, `MirvBetrayal.test.ts`; traitor cost in `AttackLogicGolden.test.ts`      |
| Donate troops     | `DonateTroopsExecution`                   | `Donate.test.ts`, `AllianceDonation.test.ts`                                                           |
| Donate gold       | `DonateGoldExecution`                     | `Donate.test.ts`                                                                                       |
| Trade embargo     | `EmbargoExecution`, `EmbargoAllExecution` | `DiplomacyVerbs.test.ts`                                                                               |
| Emoji             | `EmojiExecution`                          | `DiplomacyVerbs.test.ts`                                                                               |
| Quick-chat        | `QuickChatExecution`                      | `QuickChat.test.ts`                                                                                    |
| Target player     | `TargetPlayerExecution`                   | `DiplomacyVerbs.test.ts`                                                                               |
| Move warship      | `MoveWarshipExecution`                    | `Warship.test.ts`, `WarshipMultiSelection.test.ts`                                                     |
| Delete own unit   | `DeleteUnitExecution`                     | `DeleteUnitExecution.test.ts`, `DeleteUnitCooldown.test.ts`                                            |
| Pause (host/solo) | `PauseExecution`                          | `DiplomacyVerbs.test.ts`                                                                               |

Deviation: the traitor mark lasts 30 s (`Config.traitorDuration`), which the brief calls
"a visible timer" without a value.

## Lobby matrix, maps, controls

- **Lobby matrix**: every cell except "Fast speed" exists and is enumerated with file
  references in `docs/MECHANICS.md` §06.5 (server tests: `server/CreateNextLobby.test.ts`,
  `server/HostedLobbyListing.test.ts`, `server/MasterLobbyServiceActive.test.ts`). There is no
  game-speed setting in the wire config; the 100 ms turn is fixed (decision recorded, revisit
  in Phase 5/6).
- **Maps**: the brief's ~30 are a subset of the 120 in `src/core/game/Maps.gen.ts`
  (`docs/MECHANICS.md` §06.6 lists all of them with sizes). `npm run gen-maps` + the CI
  "Generated maps up to date" job keep the roster and the binaries in step.
- **Controls**: every binding in the brief's list is in `src/client/InputHandler.ts` and the
  keybind UI (`UserSettingModal.ts`, `HelpModal.ts`); `docs/MECHANICS.md` §06.7 maps each
  to its handler. Client-side behaviour: `InputHandler.test.ts`,
  `client/ClientGameRunnerActions.test.ts`, `client/ControlPanelAttackRatio.test.ts`.

## Repairs made in Phase 3

- **Rejoin after a reload** (`src/client/TurnSequencer.ts`): live turns that outran the
  start snapshot were dropped with an error each (122 in one observed rejoin). They are now
  held and applied in order once the snapshot closes the gap; duplicates are ignored. Unit
  tests: `client/TurnSequencer.test.ts`, `client/ClientGameRunnerMessages.test.ts`.
- **Cooldowns count from tick 0**: `deleteUnitCooldown`, `embargoAllCooldown` and the target
  cooldown all refuse the first use until one cooldown has elapsed since the game began.
  Upstream behaviour, now documented by the tests above rather than changed (a fresh lobby's
  first minute is not the moment to delete a city).
