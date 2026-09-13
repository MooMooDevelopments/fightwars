import { Game, Unit, UnitType } from "../game/Game";

/**
 * Blockades (brief §6.3). A port is blockaded while a warship belonging to
 * someone its owner is not friendly with sits within `Config.blockadeRange()`
 * of it. A blockaded port launches no trade ships and receives none — the
 * routing filter in PortExecution.tradingPorts reads this too — so parking a
 * warship off a rival's harbour is a way to take its trade without taking
 * its land, and a fleet is worth building for something other than piracy.
 *
 * Answered once per tick for every port on the map and cached, because
 * PortExecution asks for every candidate destination of every source port
 * and a fresh grid query per pair would be the dearest thing in the tick.
 */
const cache = new WeakMap<Game, { tick: number; blockaded: Set<number> }>();

export function isBlockaded(game: Game, port: Unit): boolean {
  const tick = game.ticks();
  let entry = cache.get(game);
  if (entry === undefined || entry.tick !== tick) {
    entry = { tick, blockaded: computeBlockaded(game) };
    cache.set(game, entry);
  }
  return entry.blockaded.has(port.id());
}

function computeBlockaded(game: Game): Set<number> {
  const range = game.config().blockadeRange();
  const blockaded = new Set<number>();
  if (range <= 0) return blockaded;
  // Scan from the warships, not the ports: a map has a few dozen warships
  // and a couple of hundred ports, and each grid query costs the same, so
  // this is the cheap direction. A warship that has no port in reach costs
  // one query and marks nothing.
  for (const warship of game.units(UnitType.Warship)) {
    if (!warship.isActive()) continue;
    const fleet = warship.owner();
    const ports = game.nearbyUnits(
      warship.tile(),
      range,
      UnitType.Port,
      ({ unit }) => {
        const port = unit as Unit;
        return port.isActive() && !port.owner().isFriendly(fleet);
      },
    );
    for (const { unit } of ports) blockaded.add(unit.id());
  }
  return blockaded;
}
