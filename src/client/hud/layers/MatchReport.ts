import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PlayerType } from "../../../core/game/Game";
import { AllPlayersStats } from "../../../core/Schemas";
import {
  ATTACK_INDEX_SENT,
  GOLD_INDEX_STEAL,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_TRAIN_OTHER,
  GOLD_INDEX_TRAIN_SELF,
  GOLD_INDEX_UPKEEP,
  GOLD_INDEX_WAR,
  GOLD_INDEX_WORK,
} from "../../../core/StatsSchemas";
import { renderDuration, renderNumber, translateText } from "../../Utils";
import { GameView } from "../../view";
import "./TerritoryChart";
import { fmtShare, labelRows, REPORT_SERIES_COLORS } from "./TerritoryChart";

export { fmtShare, labelRows, REPORT_SERIES_COLORS };

/**
 * Post-match analytics (brief §6.7), shown in the win modal.
 *
 * Territory over time for the five largest players at the end (the viewer
 * always among them), gold by source for the viewer, tiles taken per
 * thousand troops sent, and every alliance that broke with the minute it
 * broke. The chart follows the dataviz rules: five categorical hues in a
 * fixed order (validated on this surface: every adjacent pair clears the
 * colour-blind floor), a legend and direct labels, two-pixel lines, one
 * axis, a hover readout, and a table of the same numbers for anyone who
 * would rather read them.
 */
const GOLD_SOURCES: { index: number; key: string }[] = [
  { index: GOLD_INDEX_WORK, key: "win_modal.gold_work" },
  { index: GOLD_INDEX_WAR, key: "win_modal.gold_war" },
  { index: GOLD_INDEX_TRADE, key: "win_modal.gold_trade" },
  { index: GOLD_INDEX_STEAL, key: "win_modal.gold_steal" },
  { index: GOLD_INDEX_TRAIN_SELF, key: "win_modal.gold_train_self" },
  { index: GOLD_INDEX_TRAIN_OTHER, key: "win_modal.gold_train_other" },
  { index: GOLD_INDEX_UPKEEP, key: "win_modal.gold_upkeep" },
];

@customElement("match-report")
export class MatchReport extends LitElement {
  @property({ attribute: false }) game: GameView | null = null;
  @property({ attribute: false }) stats: AllPlayersStats | undefined =
    undefined;
  @state() private hover: number | null = null;
  @state() private showTable = false;

  createRenderRoot() {
    return this;
  }

  /** The five to chart: the largest at the end, and the viewer if not among them. */
  private chartedIDs(): number[] {
    const game = this.game;
    if (game === null) return [];
    const leaders = game.timeline().leaders(5);
    const me = game.myPlayer();
    if (me !== null && me.hasSpawned() && !leaders.includes(me.smallID())) {
      leaders.splice(Math.max(0, leaders.length - 1), 1, me.smallID());
    }
    return leaders;
  }

  private nameOf(smallID: number): string {
    const p = this.game?.playerBySmallID(smallID);
    return p !== undefined && p.isPlayer() ? p.displayName() : String(smallID);
  }

  render() {
    const game = this.game;
    if (game === null) return nothing;
    const timeline = game.timeline();
    const ids = this.chartedIDs();
    const series = timeline.series(ids);
    const land = Math.max(1, game.numLandTiles());
    return html`
      <section class="mb-6 text-left" data-match-report>
        <h3 class="text-lg font-semibold text-white mb-2">
          ${translateText("win_modal.report_title")}
        </h3>
        ${timeline.samples.length < 2
          ? html`<p class="text-sm text-white/60">
              ${translateText("win_modal.report_too_short")}
            </p>`
          : html`
              <div class="text-xs uppercase tracking-widest text-white/50 mb-1">
                ${translateText("win_modal.report_territory")}
              </div>
              <territory-chart .game=${game} .ids=${ids}></territory-chart>
              <button
                class="mt-1 text-xs text-white/60 underline"
                @click=${() => (this.showTable = !this.showTable)}
                aria-expanded=${this.showTable ? "true" : "false"}
                data-report-table-toggle
              >
                ${translateText("win_modal.report_table")}
              </button>
              ${this.showTable ? this.renderTable(series, land) : nothing}
            `}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          ${this.renderGold()} ${this.renderEfficiency()}
        </div>
        ${this.renderBreaks()}
      </section>
    `;
  }

  private renderTable(
    series: { smallID: number; points: number[] }[],
    land: number,
  ) {
    const timeline = this.game!.timeline();
    const n = timeline.samples.length;
    const cols = Math.min(6, n);
    const idx = Array.from({ length: cols }, (_, c) =>
      Math.round((c / Math.max(1, cols - 1)) * (n - 1)),
    );
    return html`<div class="overflow-x-auto mt-2">
      <table class="text-xs text-white/80 border-collapse" data-report-table>
        <thead>
          <tr>
            <th class="text-left pr-3"></th>
            ${idx.map(
              (i) =>
                html`<th class="text-right px-2 font-normal text-white/50">
                  ${renderDuration(timeline.samples[i].tick / 10)}
                </th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${series.map(
            (s) =>
              html`<tr>
                <td class="pr-3 text-white">${this.nameOf(s.smallID)}</td>
                ${idx.map(
                  (i) =>
                    html`<td class="text-right px-2 tabular-nums">
                      ${((s.points[i] / land) * 100).toFixed(1)}%
                    </td>`,
                )}
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  private myStats() {
    const me = this.game?.myPlayer();
    if (me === null || me === undefined || this.stats === undefined)
      return null;
    return this.stats[me.id()] ?? null;
  }

  private renderGold() {
    const stats = this.myStats();
    const gold = stats?.gold ?? [];
    const rows = GOLD_SOURCES.map((g) => ({
      key: g.key,
      value: Number(gold[g.index] ?? 0),
    }));
    const max = Math.max(1, ...rows.map((r) => r.value));
    return html`<div class="bg-black/30 rounded-sm p-2.5" data-report-gold>
      <div class="text-xs uppercase tracking-widest text-white/50 mb-2">
        ${translateText("win_modal.report_gold")}
      </div>
      ${stats === null
        ? html`<p class="text-xs text-white/60">
            ${translateText("win_modal.report_at_end")}
          </p>`
        : rows.map(
            (r) =>
              html`<div class="flex items-center gap-2 text-xs mb-1">
                <span class="w-28 shrink-0 text-white/80"
                  >${translateText(r.key)}</span
                >
                <span class="flex-1 h-2 rounded bg-white/10 overflow-hidden">
                  <span
                    class="block h-full rounded bg-action"
                    style="width:${((r.value / max) * 100).toFixed(1)}%"
                  ></span>
                </span>
                <span class="w-16 text-right tabular-nums text-white">
                  ${renderNumber(r.value)}
                </span>
              </div>`,
          )}
    </div>`;
  }

  private renderEfficiency() {
    const stats = this.myStats();
    const me = this.game?.myPlayer();
    const sent = Number(stats?.attacks?.[ATTACK_INDEX_SENT] ?? 0);
    const tiles = me?.numTilesOwned() ?? 0;
    const perThousand = sent > 0 ? (tiles / sent) * 1000 : null;
    return html`<div
      class="bg-black/30 rounded-sm p-2.5"
      data-report-efficiency
    >
      <div class="text-xs uppercase tracking-widest text-white/50 mb-2">
        ${translateText("win_modal.report_efficiency")}
      </div>
      <div class="text-2xl font-bold text-white tabular-nums">
        ${perThousand === null ? "—" : perThousand.toFixed(1)}
      </div>
      <div class="text-xs text-white/60">
        ${translateText("win_modal.report_efficiency_hint", {
          tiles: renderNumber(tiles),
          sent: renderNumber(sent),
        })}
      </div>
    </div>`;
  }

  private renderBreaks() {
    const game = this.game!;
    const breaks = game.timeline().breaks;
    const humansOnly = breaks.filter((b) => {
      const t = game.playerBySmallID(b.traitorID);
      return t.isPlayer() && t.type() === PlayerType.Human;
    });
    const shown = humansOnly.length > 0 ? humansOnly : breaks;
    return html`<div class="mt-4" data-report-breaks>
      <div class="text-xs uppercase tracking-widest text-white/50 mb-1">
        ${translateText("win_modal.report_breaks")}
      </div>
      ${shown.length === 0
        ? html`<p class="text-xs text-white/60">
            ${translateText("win_modal.report_none")}
          </p>`
        : html`<ul class="text-xs text-white/80 space-y-0.5">
            ${shown.slice(-8).map(
              (b) =>
                html`<li>
                  <span class="text-white/50 tabular-nums"
                    >${renderDuration(b.tick / 10)}</span
                  >
                  ${translateText("win_modal.betrayed", {
                    traitor: this.nameOf(b.traitorID),
                    victim: this.nameOf(b.betrayedID),
                  })}
                </li>`,
            )}
          </ul>`}
    </div>`;
  }
}
