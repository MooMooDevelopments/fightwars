import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { EventBus } from "../../../core/EventBus";
import { Controller } from "../../Controller";
import { renderDuration, renderNumber, translateText } from "../../Utils";
import { GameView } from "../../view";
import { MatchTimeline } from "../../view/MatchTimeline";
import "./TerritoryChart";
import { REPORT_SERIES_COLORS } from "./TerritoryChart";

/** The last few samples the projection reads: two and a half minutes. */
const PROJECTION_WINDOW = 30;

/**
 * Where the leader is heading (brief §6.7, the caster's win projection): a
 * straight line through the last samples of their land share, read against
 * the win bar. Minutes until the bar at that pace; 0 when already past it;
 * null when the share is flat or falling.
 */
export function projectWin(
  shares: readonly number[],
  sampleSeconds: number,
  bar: number,
): number | null {
  if (shares.length < 2) return null;
  const last = shares[shares.length - 1];
  if (last >= bar) return 0;
  const first = shares[0];
  const seconds = (shares.length - 1) * sampleSeconds;
  const perSecond = (last - first) / seconds;
  if (perSecond <= 0) return null;
  return (bar - last) / perSecond / 60;
}

/**
 * The caster panel: for whoever is watching rather than playing — a
 * spectator, a replay, a player who has died — the game read the way a
 * commentator reads it. Land share over time for the five largest, their
 * troops and gold now, and where the leader is heading against the win
 * bar. Hidden for a living player, who has a game to play.
 */
@customElement("caster-panel")
export class CasterPanel extends LitElement implements Controller {
  public game: GameView | null = null;
  public eventBus: EventBus | null = null;
  @state() private active = false;
  @state() private collapsed = false;
  @state() private tickCount = 0;

  createRenderRoot() {
    return this;
  }

  init() {}

  tick() {
    const game = this.game;
    if (game === null) return;
    const active = game.isSpectator() && !game.inSpawnPhase();
    if (active !== this.active) this.active = active;
    if (active && game.ticks() % 10 === 0) this.tickCount++;
  }

  /** The five largest by the last sample; live tiles when no sample yet. */
  private leaders(): number[] {
    const game = this.game!;
    const ids = game.timeline().leaders(5);
    if (ids.length > 0) return ids;
    return game
      .players()
      .filter((p) => p.isAlive())
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())
      .slice(0, 5)
      .map((p) => p.smallID());
  }

  private nameOf(smallID: number): string {
    const p = this.game?.playerBySmallID(smallID);
    return p !== undefined && p.isPlayer() ? p.displayName() : String(smallID);
  }

  render() {
    const game = this.game;
    if (game === null || !this.active) return nothing;
    if (this.collapsed) {
      return html`<button
        class="fixed right-2 top-24 z-800 rounded-md bg-gray-800/90 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-white/80 backdrop-blur-sm"
        data-caster-show
        @click=${() => (this.collapsed = false)}
      >
        ${translateText("caster.show")}
      </button>`;
    }
    const ids = this.leaders();
    return html`<aside
      class="fixed right-2 top-24 z-800 w-[min(92vw,22rem)] max-h-[calc(100vh-8rem)] overflow-y-auto rounded-lg bg-gray-800/92 p-3 text-white shadow-xl backdrop-blur-sm"
      data-caster-panel
      aria-label=${translateText("caster.title")}
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="text-xs font-bold uppercase tracking-widest text-white/60">
          ${translateText("caster.title")}
        </span>
        <button
          class="text-xs text-white/60 underline"
          data-caster-hide
          @click=${() => (this.collapsed = true)}
        >
          ${translateText("caster.hide")}
        </button>
      </div>
      ${this.renderProjection(ids)}
      <div class="mt-3 text-[11px] uppercase tracking-widest text-white/50">
        ${translateText("win_modal.report_territory")}
      </div>
      <territory-chart .game=${game} .ids=${ids} compact></territory-chart>
      ${this.renderEconomy(ids)}
    </aside>`;
  }

  private renderProjection(ids: number[]) {
    const game = this.game!;
    if (ids.length === 0) return nothing;
    const leader = ids[0];
    const land = Math.max(1, game.numLandTiles() - game.numTilesWithFallout());
    const p = game.playerBySmallID(leader);
    const share = p.isPlayer() ? p.numTilesOwned() / land : 0;
    const elapsed = game.elapsedGameSeconds();
    const bar = game.config().percentageTilesOwnedToWin(elapsed) / 100;
    const points = game
      .timeline()
      .series([leader])[0]
      .points.slice(-PROJECTION_WINDOW)
      .map((t) => t / land);
    const minutes = projectWin(points, MatchTimeline.SAMPLE_EVERY / 10, bar);
    const timer = game.config().gameConfig().maxTimerValue;
    const timerLeft =
      timer === undefined || timer === null ? null : timer * 60 - elapsed;
    return html`<div class="rounded-sm bg-black/30 p-2" data-caster-projection>
      <div class="text-[11px] uppercase tracking-widest text-white/50">
        ${translateText("caster.projection")}
      </div>
      <div class="mt-1 flex items-center gap-2 text-sm">
        <span
          class="inline-block h-2.5 w-2.5 rounded-full"
          style="background:${REPORT_SERIES_COLORS[0]}"
        ></span>
        <span class="truncate">
          ${translateText("caster.leader", {
            name: this.nameOf(leader),
            share: (share * 100).toFixed(1),
          })}
        </span>
      </div>
      <div class="mt-1 h-2 w-full overflow-hidden rounded bg-white/10">
        <span
          class="block h-full rounded bg-action"
          style="width:${Math.min(
            100,
            (share / Math.max(0.01, bar)) * 100,
          ).toFixed(1)}%"
        ></span>
      </div>
      <div class="mt-1 flex justify-between text-xs text-white/60">
        <span
          >${translateText("caster.bar", { bar: Math.round(bar * 100) })}</span
        >
        <span data-caster-eta>
          ${minutes === null
            ? translateText("caster.eta_none")
            : minutes === 0
              ? translateText("caster.eta_now")
              : translateText("caster.eta", {
                  minutes: Math.max(1, Math.round(minutes)),
                })}
        </span>
      </div>
      ${timerLeft === null
        ? nothing
        : html`<div class="mt-1 text-xs text-white/60">
            ${translateText("caster.timer", {
              time: renderDuration(Math.max(0, timerLeft)),
            })}
          </div>`}
    </div>`;
  }

  private renderEconomy(ids: number[]) {
    const game = this.game!;
    const rows = ids.map((id) => {
      const p = game.playerBySmallID(id);
      return {
        id,
        troops: p.isPlayer() ? p.troops() : 0,
        gold: p.isPlayer() ? Number(p.gold()) : 0,
      };
    });
    const maxTroops = Math.max(1, ...rows.map((r) => r.troops));
    const maxGold = Math.max(1, ...rows.map((r) => r.gold));
    return html`<div class="mt-3" data-caster-economy>
      <div class="text-[11px] uppercase tracking-widest text-white/50">
        ${translateText("caster.economy")}
      </div>
      <table class="mt-1 w-full text-xs">
        <thead>
          <tr class="text-white/50">
            <th class="text-left font-normal"></th>
            <th class="text-right font-normal">
              ${translateText("caster.troops")}
            </th>
            <th class="text-right font-normal">
              ${translateText("caster.gold")}
            </th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r, k) =>
              html`<tr data-caster-row=${r.id}>
                <td class="truncate pr-2">
                  <span
                    class="mr-1 inline-block h-2 w-2 rounded-full"
                    style="background:${REPORT_SERIES_COLORS[k]}"
                  ></span>
                  ${this.nameOf(r.id)}
                </td>
                <td class="text-right tabular-nums">
                  <span
                    class="mr-1 inline-block h-1.5 rounded bg-white/25 align-middle"
                    style="width:${((r.troops / maxTroops) * 40).toFixed(0)}px"
                  ></span
                  >${renderNumber(r.troops)}
                </td>
                <td class="text-right tabular-nums">
                  <span
                    class="mr-1 inline-block h-1.5 rounded bg-signal/60 align-middle"
                    style="width:${((r.gold / maxGold) * 40).toFixed(0)}px"
                  ></span
                  >${renderNumber(r.gold)}
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }
}
