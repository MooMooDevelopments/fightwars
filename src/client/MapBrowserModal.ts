import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { CommunityMap } from "../core/ApiSchemas";
import { fetchCommunityMap, fetchCommunityMaps, rateCommunityMap } from "./Api";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import type { MapEditorModal } from "./MapEditorModal";

/**
 * The community map browser (brief §6.9): what other people have made, newest
 * or best rated, with a star row that rates and an Open that loads the map
 * into the editor. The API validates every package before it stores one, so
 * a listed map is a loadable map.
 */
@customElement("map-browser-modal")
export class MapBrowserModal extends BaseModal {
  protected routerName = "map-browser";

  @state() private maps: CommunityMap[] = [];
  @state() private sort: "new" | "rating" = "new";
  @state() private loading = false;
  // Named to avoid BaseModal's own `opening` flag.
  @state() private fetchingId: string | null = null;
  @state() private message: string | null = null;

  protected modalConfig() {
    return { title: translateText("map_browser.title"), alwaysMaximized: true };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("map_browser.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  public async open(): Promise<void> {
    await super.open();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.maps = await fetchCommunityMaps(this.sort);
    this.loading = false;
  }

  async setSort(sort: "new" | "rating"): Promise<void> {
    if (this.sort === sort) return;
    this.sort = sort;
    await this.refresh();
  }

  async rate(id: string, stars: number): Promise<void> {
    const result = await rateCommunityMap(id, stars);
    if (result === null) {
      this.message = translateText("map_browser.rate_failed");
      return;
    }
    this.message = null;
    this.maps = this.maps.map((m) =>
      m.id === id
        ? { ...m, ratingAverage: result.average, ratingCount: result.count }
        : m,
    );
  }

  /** Fetch the package and hand it to the editor, which opens on top. */
  async openInEditor(id: string): Promise<void> {
    this.fetchingId = id;
    const pkg = await fetchCommunityMap(id);
    this.fetchingId = null;
    if (pkg === null) {
      this.message = translateText("map_browser.open_failed");
      return;
    }
    const editor = document.querySelector(
      "map-editor-modal",
    ) as MapEditorModal | null;
    if (editor === null) {
      this.message = translateText("map_browser.open_failed");
      return;
    }
    editor.loadPackage(pkg);
    this.close();
    void editor.open();
  }

  protected renderBody() {
    return html`
      <div class="flex flex-col gap-4 p-4" data-map-browser>
        <div class="flex items-center gap-2">
          ${(
            [
              ["new", "map_browser.sort_new"],
              ["rating", "map_browser.sort_rating"],
            ] as const
          ).map(
            ([key, labelKey]) =>
              html`<button
                class="rounded-lg border px-3 py-1 text-sm ${this.sort === key
                  ? "border-action bg-action/20 text-white"
                  : "border-white/10 text-white/70"}"
                data-sort=${key}
                aria-pressed=${this.sort === key ? "true" : "false"}
                @click=${() => this.setSort(key)}
              >
                ${translateText(labelKey)}
              </button>`,
          )}
        </div>
        ${this.message === null
          ? null
          : html`<p class="text-xs text-status-loss" data-message>
              ${this.message}
            </p>`}
        ${this.loading
          ? html`<p class="text-sm text-white/60">
              ${translateText("map_browser.loading")}
            </p>`
          : this.maps.length === 0
            ? html`<p class="text-sm text-white/60" data-empty>
                ${translateText("map_browser.empty")}
              </p>`
            : html`<ul
                class="grid grid-cols-1 gap-3 md:grid-cols-2"
                data-map-list
              >
                ${this.maps.map((m) => this.renderMap(m))}
              </ul>`}
      </div>
    `;
  }

  private renderMap(m: CommunityMap) {
    return html`<li
      class="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3"
      data-map=${m.id}
    >
      <div class="flex items-baseline justify-between gap-2">
        <span class="truncate text-sm font-bold text-white">${m.name}</span>
        <span class="text-xs text-white/50">
          ${m.width}×${m.height} ·
          ${translateText("map_browser.nations", { count: m.nations })}
        </span>
      </div>
      <div class="text-xs text-white/60">
        ${translateText("map_browser.by", {
          author: m.author ?? translateText("map_browser.anonymous"),
        })}
      </div>
      <div class="flex items-center gap-2">
        <span class="flex" data-stars>
          ${[1, 2, 3, 4, 5].map(
            (n) =>
              html`<button
                class="px-0.5 text-sm ${m.ratingAverage !== null &&
                n <= Math.round(m.ratingAverage)
                  ? "text-rank-gold"
                  : "text-white/30"}"
                data-star=${n}
                aria-label=${translateText("map_browser.rate", { stars: n })}
                @click=${() => this.rate(m.id, n)}
              >
                ★
              </button>`,
          )}
        </span>
        <span class="text-xs text-white/60" data-rating>
          ${m.ratingAverage === null
            ? translateText("map_browser.unrated")
            : translateText("map_browser.rating", {
                average: m.ratingAverage.toFixed(1),
                count: m.ratingCount,
              })}
        </span>
      </div>
      <o-button
        variant="secondary"
        size="sm"
        .title=${this.fetchingId === m.id
          ? translateText("map_browser.opening")
          : translateText("map_browser.open")}
        data-open=${m.id}
        @click=${() => this.openInEditor(m.id)}
      ></o-button>
    </li>`;
  }
}
