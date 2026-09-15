import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ChallengeProgress } from "../../core/ApiSchemas";
import { renderNumber, translateText } from "../Utils";

/**
 * The challenges panel (brief §6.7): what is live this day and this week,
 * and how far the account has come. The API sends translation keys and
 * numbers, never prose, so this renders and does not decide.
 */
@customElement("challenge-list")
export class ChallengeList extends LitElement {
  @property({ attribute: false }) challenges: ChallengeProgress[] = [];

  createRenderRoot() {
    return this;
  }

  render() {
    if (this.challenges.length === 0) {
      return html`<p class="text-sm text-white/60" data-challenges-empty>
        ${translateText("challenge.none")}
      </p>`;
    }
    const groups: { period: "daily" | "weekly"; labelKey: string }[] = [
      { period: "daily", labelKey: "challenge.daily" },
      { period: "weekly", labelKey: "challenge.weekly" },
    ];
    return html`<div class="flex flex-col gap-4" data-challenges>
      ${groups.map((g) => {
        const rows = this.challenges.filter((c) => c.period === g.period);
        if (rows.length === 0) return nothing;
        return html`<section>
          <div
            class="text-xs font-bold text-white/40 uppercase tracking-widest mb-2"
          >
            ${translateText(g.labelKey)}
          </div>
          <ul class="flex flex-col gap-2">
            ${rows.map((c) => this.renderRow(c))}
          </ul>
        </section>`;
      })}
    </div>`;
  }

  private renderRow(c: ChallengeProgress) {
    const share = c.target <= 0 ? 0 : Math.min(1, c.progress / c.target);
    return html`<li
      class="rounded-lg border border-white/10 bg-white/5 p-2"
      data-challenge=${c.id}
    >
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-sm text-white">${translateText(c.nameKey)}</span>
        <span
          class="text-xs ${c.completed ? "text-status-gain" : "text-white/60"}"
          data-challenge-status
        >
          ${c.completed
            ? translateText("challenge.done")
            : translateText("challenge.progress", {
                progress: renderNumber(c.progress),
                target: renderNumber(c.target),
              })}
        </span>
      </div>
      <span class="mt-1 block h-1.5 w-full overflow-hidden rounded bg-white/10">
        <span
          class="block h-full rounded ${c.completed
            ? "bg-status-gain"
            : "bg-action"}"
          style="width:${(share * 100).toFixed(1)}%"
        ></span>
      </span>
    </li>`;
  }
}
