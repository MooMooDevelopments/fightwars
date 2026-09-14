import { Doctrine } from "../core/game/Game";

/**
 * The doctrine this client will send with its next spawn intent (brief
 * §6.6). Session state, not a setting: it is the choice for this game, made
 * in the picker during the spawn phase, and the simulation's answer — the
 * player's `doctrine()` — is the truth once the intent has landed.
 */
let pick: Doctrine = Doctrine.None;

export function getDoctrinePick(): Doctrine {
  return pick;
}

export function setDoctrinePick(doctrine: Doctrine): void {
  pick = doctrine;
}
