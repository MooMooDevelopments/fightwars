import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
} from "../game/Game";
import { PlayerExecution } from "./PlayerExecution";
import { TribeExecution } from "./TribeExecution";

/**
 * Capital Strike (brief §6.7): take the capital and the nation collapses
 * into rebels.
 *
 * A nation's capital is its spawn tile, the tile its supply network already
 * feeds from. Once a second this execution looks at every living human and
 * nation; one whose capital another player holds falls. The taker is paid
 * as for a conquest (gold, the kill, the finishing place), and everything
 * else the nation held — its land, its troops, its structures and ships —
 * passes to a rebel tribe raised against the taker, the same machinery as
 * the partisans of §6.6, so the taker cannot absorb the remains as an
 * enclave and has to fight for them. A capital that is merely lost — nuked,
 * irradiated, relinquished — does not fall: nobody took it.
 */
export class CapitalStrikeExecution implements Execution {
  private mg: Game | null = null;

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const mg = this.mg;
    if (mg === null || ticks % 10 !== 0) return;
    if (mg.inSpawnPhase()) return;
    const fallen: [Player, Player][] = [];
    for (const player of mg.players()) {
      if (!player.isAlive() || player.type() === PlayerType.Bot) continue;
      const capital = player.spawnTile();
      if (capital === undefined) continue;
      const holder = mg.owner(capital);
      if (!holder.isPlayer() || holder === player) continue;
      fallen.push([player, holder as Player]);
    }
    for (const [player, taker] of fallen) this.collapse(mg, player, taker);
  }

  private collapse(mg: Game, player: Player, taker: Player): void {
    mg.conquerPlayer(taker, player);
    const tiles = [...player.tiles()];
    const units = player.units().filter((u) => u.isActive());
    const info = new PlayerInfo(
      `${player.name()} Rebels`,
      PlayerType.Bot,
      null,
      `rebels:${player.smallID()}:${mg.ticks()}`,
    );
    const rebels = mg.addPlayer(info);
    rebels.markPartisanOf(taker, player.smallID());
    rebels.setTroops(player.troops());
    player.setTroops(0);
    for (const tile of tiles) rebels.conquer(tile);
    for (const unit of units) rebels.captureUnit(unit);
    if (tiles.length > 0) rebels.setSpawnTile(tiles[0]);
    mg.addExecution(
      new PlayerExecution(rebels),
      new TribeExecution(rebels, taker),
    );
    mg.displayMessage(
      "events_display.capital_fell",
      MessageType.CAPITAL_FELL,
      null,
      undefined,
      { name: player.displayName(), taker: taker.displayName() },
    );
  }

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
