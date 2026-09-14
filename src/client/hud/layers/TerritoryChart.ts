import { html, LitElement, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { renderDuration, translateText } from "../../Utils";
import { GameView } from "../../view";

/**
 * Land share over time (brief §6.7), drawn the same way wherever it appears:
 * the match report at the end and the caster panel during the game. Five
 * categorical hues in fixed rank order validated on the HUD's dark surface,
 * two-pixel lines, three hairlines, one axis in percent of land, direct
 * labels pushed apart at the line ends, a legend, and a hover readout.
 */
export const REPORT_SERIES_COLORS = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
] as const;

const W = 600;
const H = 200;
const PAD = { top: 10, right: 110, bottom: 24, left: 40 };
const LABEL_GAP = 12;

/** An axis label: whole percents until the scale is small enough to need a decimal. */
export function fmtShare(share: number, max: number): string {
  return max < 0.05
    ? `${(share * 100).toFixed(1)}%`
    : `${Math.round(share * 100)}%`;
}

/**
 * The end-of-line labels, pushed apart so none overlaps: sorted by their
 * line's end, each at least LABEL_GAP below the one above, the stack pushed
 * back up if it runs past the bottom.
 */
export function labelRows(
  ys: readonly number[],
  top: number,
  bottom: number,
): { index: number; y: number }[] {
  const rows = ys
    .map((y, index) => ({ index, y: Math.max(top, y) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < rows.length; i++) {
    rows[i].y = Math.max(rows[i].y, rows[i - 1].y + LABEL_GAP);
  }
  const overflow = rows.length === 0 ? 0 : rows[rows.length - 1].y - bottom;
  if (overflow > 0) {
    for (const r of rows) r.y -= overflow;
    for (let i = 1; i < rows.length; i++) {
      rows[i].y = Math.max(rows[i].y, rows[i - 1].y + LABEL_GAP);
    }
  }
  return rows;
}

@customElement("territory-chart")
export class TerritoryChart extends LitElement {
  @property({ attribute: false }) game: GameView | null = null;
  /** smallIDs in rank order; the colours follow the order. */
  @property({ attribute: false }) ids: number[] = [];
  /** A short chart for the side panel. */
  @property({ type: Boolean }) compact = false;
  @state() private hover: number | null = null;

  createRenderRoot() {
    return this;
  }

  private nameOf(smallID: number): string {
    const p = this.game?.playerBySmallID(smallID);
    return p !== undefined && p.isPlayer() ? p.displayName() : String(smallID);
  }

  render() {
    const game = this.game;
    if (game === null) return nothing;
    const timeline = game.timeline();
    if (timeline.samples.length < 2) {
      return html`<p class="text-sm text-white/60">
        ${translateText("win_modal.report_too_short")}
      </p>`;
    }
    const series = timeline.series(this.ids);
    const land = Math.max(1, game.numLandTiles());
    return html`${this.renderChart(series, land)} ${this.renderLegend(this.ids)}`;
  }

  private xOf(i: number, n: number): number {
    return PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right));
  }

  private yOf(share: number, max: number): number {
    const inner = H - PAD.top - PAD.bottom;
    return PAD.top + inner - (max <= 0 ? 0 : (share / max) * inner);
  }

  private renderChart(
    series: { smallID: number; points: number[] }[],
    land: number,
  ) {
    const timeline = this.game!.timeline();
    const n = timeline.samples.length;
    const maxShare = Math.max(
      0.01,
      ...series.map((s) => Math.max(...s.points.map((p) => p / land))),
    );
    const ticksAt = (i: number) => timeline.samples[i]?.tick ?? 0;
    const gridShares = [0, maxShare / 2, maxShare];
    const hover = this.hover;
    return html`<div class="relative">
      <svg
        viewBox="0 0 ${W} ${H}"
        class="w-full h-auto"
        role="img"
        aria-label=${translateText("win_modal.report_territory")}
        @mousemove=${(e: MouseEvent) => this.onHover(e, n)}
        @mouseleave=${() => (this.hover = null)}
      >
        ${gridShares.map(
          (g) => svg`<line
            x1=${PAD.left} x2=${W - PAD.right}
            y1=${this.yOf(g, maxShare)} y2=${this.yOf(g, maxShare)}
            stroke="rgba(255,255,255,0.10)" stroke-width="1" />
          <text x=${PAD.left - 6} y=${this.yOf(g, maxShare) + 4}
            text-anchor="end" font-size="11" fill="#898781">${fmtShare(g, maxShare)}</text>`,
        )}
        <text x=${PAD.left} y=${H - 6} font-size="11" fill="#898781">0:00</text>
        <text
          x=${W - PAD.right}
          y=${H - 6}
          text-anchor="end"
          font-size="11"
          fill="#898781"
        >
          ${renderDuration(ticksAt(n - 1) / 10)}
        </text>
        ${series.map((s, k) => {
          const d = s.points
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"}${this.xOf(i, n).toFixed(1)},${this.yOf(p / land, maxShare).toFixed(1)}`,
            )
            .join(" ");
          return svg`<path d=${d} fill="none" stroke=${REPORT_SERIES_COLORS[k]}
              stroke-width="2" stroke-linejoin="round" data-series=${s.smallID} />`;
        })}
        ${labelRows(
          series.map((s) =>
            this.yOf(s.points[s.points.length - 1] / land, maxShare),
          ),
          PAD.top + 4,
          H - PAD.bottom,
        ).map(
          ({ index, y }) => svg`<text x=${W - PAD.right + 6} y=${y + 4}
              font-size="11" fill="#ffffff" data-series-label=${series[index].smallID}>${this.nameOf(series[index].smallID)}</text>`,
        )}
        ${hover === null
          ? nothing
          : svg`<line x1=${this.xOf(hover, n)} x2=${this.xOf(hover, n)}
              y1=${PAD.top} y2=${H - PAD.bottom} stroke="rgba(255,255,255,0.4)" stroke-width="1" />`}
      </svg>
      ${hover === null
        ? nothing
        : html`<div
            class="absolute top-1 left-12 bg-black/70 rounded px-2 py-1 text-xs text-white pointer-events-none"
            data-report-tooltip
          >
            <div class="text-white/60">
              ${renderDuration(ticksAt(hover) / 10)}
            </div>
            ${series.map(
              (s, k) =>
                html`<div class="flex items-center gap-1">
                  <span
                    class="inline-block w-2 h-2 rounded-full"
                    style="background:${REPORT_SERIES_COLORS[k]}"
                  ></span>
                  ${this.nameOf(s.smallID)}:
                  ${((s.points[hover] / land) * 100).toFixed(1)}%
                </div>`,
            )}
          </div>`}
    </div>`;
  }

  private onHover(e: MouseEvent, n: number) {
    const svgEl = e.currentTarget as SVGSVGElement;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width === 0 || n < 2) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const t = (x - PAD.left) / (W - PAD.left - PAD.right);
    this.hover = Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
  }

  private renderLegend(ids: number[]) {
    return html`<div
      class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/80 mt-1"
      data-report-legend
    >
      ${ids.map(
        (id, k) =>
          html`<span class="flex items-center gap-1">
            <span
              class="inline-block w-2.5 h-2.5 rounded-full"
              style="background:${REPORT_SERIES_COLORS[k]}"
            ></span>
            ${this.nameOf(id)}
          </span>`,
      )}
    </div>`;
  }
}
