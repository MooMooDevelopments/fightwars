import { PlayerBuildableUnitType } from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  rocketDirectionUp: boolean;
  upgradeMultiplier: number;
  /** The one build waiting for gold (BuildQueueController), or none. */
  buildQueue?: BuildQueueEntry | null;
}

export interface BuildQueueEntry {
  unit: PlayerBuildableUnitType;
  tile: TileRef;
  labelKey: string;
}
