import { html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { MapPackageFile } from "../core/ApiSchemas";
import {
  buildMapPackage,
  createGrid,
  EditorGrid,
  gridFromPacked,
  MapPackageNation,
  TERRAIN_CODES,
  validatePackage,
} from "../core/game/MapPackage";
import { publishCommunityMap } from "./Api";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";

/**
 * The map editor (brief §6.9, creation tools): paint terrain, place the
 * nations that spawn on it, export a package the game can load.
 *
 * The rules of the format live in `src/core/game/MapPackage.ts` and are
 * tested against the real terrain loader; this is the surface — a canvas,
 * five brushes, a nation list — in the game's own modal grammar, so no new
 * visual world and no design pass beyond the one this chrome already had.
 */
const BRUSHES = [
  {
    id: "water",
    labelKey: "map_editor.brush_water",
    terrain: TERRAIN_CODES.water,
    elevation: 0,
    color: "#1d4ed8",
  },
  {
    id: "plains",
    labelKey: "map_editor.brush_plains",
    terrain: TERRAIN_CODES.land,
    elevation: 5,
    color: "#4d7c3a",
  },
  {
    id: "highland",
    labelKey: "map_editor.brush_highland",
    terrain: TERRAIN_CODES.land,
    elevation: 15,
    color: "#8a7a44",
  },
  {
    id: "mountain",
    labelKey: "map_editor.brush_mountain",
    terrain: TERRAIN_CODES.land,
    elevation: 25,
    color: "#9a9a9a",
  },
  {
    id: "impassable",
    labelKey: "map_editor.brush_impassable",
    terrain: TERRAIN_CODES.impassable,
    elevation: 0,
    color: "#2b2b2b",
  },
] as const;

type BrushId = (typeof BRUSHES)[number]["id"];

export const EDITOR_SIZES = [
  { width: 128, height: 80 },
  { width: 256, height: 160 },
  { width: 512, height: 320 },
] as const;

/** The colour a tile paints at, shared by the canvas and its tests. */
export function tileColor(terrain: number, elevation: number): string {
  if (terrain === TERRAIN_CODES.impassable) return "#2b2b2b";
  if (terrain === TERRAIN_CODES.water) return "#1d4ed8";
  if (elevation >= 20) return "#9a9a9a";
  if (elevation >= 10) return "#8a7a44";
  return "#4d7c3a";
}

@customElement("map-editor-modal")
export class MapEditorModal extends BaseModal {
  protected routerName = "map-editor";

  @state() private grid: EditorGrid = createGrid(
    EDITOR_SIZES[0].width,
    EDITOR_SIZES[0].height,
  );
  @state() private brush: BrushId = "plains";
  @state() private brushSize = 3;
  @state() private mapName = "";
  @state() private nations: MapPackageNation[] = [];
  @state() private nationName = "";
  @state() private placingNation = false;
  @state() private problems: string[] = [];
  @state() private exported: string | null = null;
  @state() private published: string | null = null;
  @query("canvas") private canvas?: HTMLCanvasElement | null;

  private painting = false;

  protected modalConfig() {
    return { title: translateText("map_editor.title"), alwaysMaximized: true };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("map_editor.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected updated(): void {
    this.drawGrid();
  }

  /** The whole grid onto the canvas, one pixel a tile, scaled by CSS. */
  private drawGrid(): void {
    // Null before the first render, and in a test that drives the state
    // without a DOM: the grid is the truth, the canvas only shows it.
    const canvas = this.canvas;
    if (canvas === undefined || canvas === null) return;
    const { width, height, terrain, elevation } = this.grid;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const image = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const hex = tileColor(terrain[i], elevation[i]);
      image.data[i * 4] = parseInt(hex.slice(1, 3), 16);
      image.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
      image.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    // The nations, as a dot each, drawn over the terrain.
    ctx.fillStyle = "#ffd700";
    for (const n of this.nations) {
      ctx.fillRect(n.coordinates[0], n.coordinates[1], 1, 1);
    }
  }

  /** The tile under a pointer, or null when the event missed the canvas. */
  private tileAt(e: PointerEvent): { x: number; y: number } | null {
    const canvas = this.canvas;
    if (canvas === undefined || canvas === null) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = Math.floor(
      ((e.clientX - rect.left) / rect.width) * this.grid.width,
    );
    const y = Math.floor(
      ((e.clientY - rect.top) / rect.height) * this.grid.height,
    );
    if (x < 0 || y < 0 || x >= this.grid.width || y >= this.grid.height) {
      return null;
    }
    return { x, y };
  }

  /** Paints a square of the brush's size centred on the tile. */
  paintAt(x: number, y: number): void {
    const brush = BRUSHES.find((b) => b.id === this.brush)!;
    const r = Math.floor(this.brushSize / 2);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (
          px < 0 ||
          py < 0 ||
          px >= this.grid.width ||
          py >= this.grid.height
        ) {
          continue;
        }
        const ref = py * this.grid.width + px;
        this.grid.terrain[ref] = brush.terrain;
        this.grid.elevation[ref] = brush.elevation;
      }
    }
    this.exported = null;
    this.drawGrid();
  }

  private onPointerDown = (e: PointerEvent) => {
    const at = this.tileAt(e);
    if (at === null) return;
    if (this.placingNation) {
      this.addNation(at.x, at.y);
      return;
    }
    this.painting = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.paintAt(at.x, at.y);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.painting) return;
    const at = this.tileAt(e);
    if (at !== null) this.paintAt(at.x, at.y);
  };

  private onPointerUp = () => {
    this.painting = false;
  };

  addNation(x: number, y: number): void {
    const name = this.nationName.trim();
    if (name === "") return;
    this.nations = [...this.nations, { name, coordinates: [x, y] }];
    this.nationName = "";
    this.placingNation = false;
    this.exported = null;
  }

  removeNation(index: number): void {
    this.nations = this.nations.filter((_, i) => i !== index);
    this.exported = null;
  }

  /** Open a published package (brief §6.9, the browser's Open). */
  loadPackage(pkg: MapPackageFile): void {
    const bin = Uint8Array.from(atob(pkg.mapBin), (c) => c.charCodeAt(0));
    this.grid = gridFromPacked(pkg.manifest.map, bin);
    this.nations = pkg.manifest.nations.map((n) => ({
      name: n.name,
      coordinates: [n.coordinates[0], n.coordinates[1]] as [number, number],
      ...(n.flag === undefined ? {} : { flag: n.flag }),
    }));
    this.mapName = pkg.manifest.name;
    this.problems = [];
    this.exported = null;
    this.published = null;
  }

  /** Publish to the community browser; the API validates before it stores. */
  async publish(): Promise<void> {
    const input = {
      name: this.mapName,
      grid: this.grid,
      nations: this.nations,
    };
    this.problems = validatePackage(input);
    if (this.problems.length > 0) {
      this.published = null;
      return;
    }
    const pkg = buildMapPackage(input);
    const result = await publishCommunityMap({
      format: "fightwars-map/1",
      manifest: pkg.manifest,
      mapBin: base64(pkg.mapBin),
      map4xBin: base64(pkg.map4xBin),
      map16xBin: base64(pkg.map16xBin),
    });
    this.published =
      "id" in result
        ? translateText("map_editor.published")
        : translateText("map_editor.publish_failed", { error: result.error });
  }

  resize(width: number, height: number): void {
    this.grid = createGrid(width, height);
    this.nations = [];
    this.exported = null;
  }

  /** Validate, then hand the package over as one downloadable file. */
  exportPackage(): void {
    const input = {
      name: this.mapName,
      grid: this.grid,
      nations: this.nations,
    };
    this.problems = validatePackage(input);
    if (this.problems.length > 0) {
      this.exported = null;
      return;
    }
    const pkg = buildMapPackage(input);
    const file = {
      format: "fightwars-map/1",
      manifest: pkg.manifest,
      mapBin: base64(pkg.mapBin),
      map4xBin: base64(pkg.map4xBin),
      map16xBin: base64(pkg.map16xBin),
    };
    const blob = new Blob([JSON.stringify(file)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(this.mapName)}.fwmap.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.exported = a.download;
  }

  protected renderBody() {
    return html`
      <div class="flex flex-col gap-4 p-4" data-map-editor>
        <p class="text-sm text-white/60">${translateText("map_editor.hint")}</p>
        <div class="flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1 text-xs text-white/60">
            ${translateText("map_editor.name")}
            <input
              class="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
              data-map-name
              .value=${this.mapName}
              @input=${(e: Event) =>
                (this.mapName = (e.target as HTMLInputElement).value)}
            />
          </label>
          <div class="flex flex-col gap-1 text-xs text-white/60">
            ${translateText("map_editor.size")}
            <div class="flex gap-2">
              ${EDITOR_SIZES.map(
                (s) =>
                  html`<button
                    class="rounded-lg border px-2 py-1 text-sm ${this.grid
                      .width === s.width
                      ? "border-action bg-action/20 text-white"
                      : "border-white/10 text-white/70"}"
                    data-size=${s.width}
                    @click=${() => this.resize(s.width, s.height)}
                  >
                    ${s.width}×${s.height}
                  </button>`,
              )}
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2" role="group">
          ${BRUSHES.map(
            (b) =>
              html`<button
                class="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm ${this
                  .brush === b.id
                  ? "border-action bg-action/20 text-white"
                  : "border-white/10 text-white/70"}"
                data-brush=${b.id}
                aria-pressed=${this.brush === b.id ? "true" : "false"}
                @click=${() => {
                  this.brush = b.id;
                  this.placingNation = false;
                }}
              >
                <span
                  class="inline-block h-3 w-3 rounded-sm"
                  style="background:${b.color}"
                ></span>
                ${translateText(b.labelKey)}
              </button>`,
          )}
          <label class="ml-2 flex items-center gap-2 text-xs text-white/60">
            ${translateText("map_editor.brush_size")}
            <input
              type="range"
              min="1"
              max="21"
              step="2"
              data-brush-size
              .value=${String(this.brushSize)}
              @input=${(e: Event) =>
                (this.brushSize = Number((e.target as HTMLInputElement).value))}
            />
            <span class="tabular-nums text-white">${this.brushSize}</span>
          </label>
        </div>

        <canvas
          class="w-full rounded-lg border border-white/10 bg-black/40"
          style="image-rendering: pixelated; aspect-ratio: ${this.grid
            .width} / ${this.grid.height}; touch-action: none;"
          data-map-canvas
          @pointerdown=${this.onPointerDown}
          @pointermove=${this.onPointerMove}
          @pointerup=${this.onPointerUp}
          @pointercancel=${this.onPointerUp}
        ></canvas>

        <div class="flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1 text-xs text-white/60">
            ${translateText("map_editor.nation_name")}
            <input
              class="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
              data-nation-name
              .value=${this.nationName}
              @input=${(e: Event) =>
                (this.nationName = (e.target as HTMLInputElement).value)}
            />
          </label>
          <button
            class="rounded-lg border px-3 py-1.5 text-sm ${this.placingNation
              ? "border-action bg-action/20 text-white"
              : "border-white/10 text-white/70"}"
            data-place-nation
            aria-pressed=${this.placingNation ? "true" : "false"}
            ?disabled=${this.nationName.trim() === ""}
            @click=${() => (this.placingNation = !this.placingNation)}
          >
            ${translateText("map_editor.place_nation")}
          </button>
        </div>
        ${this.nations.length === 0
          ? null
          : html`<ul class="flex flex-wrap gap-2" data-nation-list>
              ${this.nations.map(
                (n, i) =>
                  html`<li
                    class="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
                  >
                    ${n.name} (${n.coordinates[0]}, ${n.coordinates[1]})
                    <button
                      class="text-white/50"
                      data-remove-nation=${i}
                      aria-label=${translateText("map_editor.remove_nation", {
                        name: n.name,
                      })}
                      @click=${() => this.removeNation(i)}
                    >
                      ✕
                    </button>
                  </li>`,
              )}
            </ul>`}

        <div class="flex items-center gap-3">
          <o-button
            variant="primary"
            .title=${translateText("map_editor.export")}
            data-export
            @click=${() => this.exportPackage()}
          ></o-button>
          <o-button
            variant="secondary"
            .title=${translateText("map_editor.publish")}
            data-publish
            @click=${() => this.publish()}
          ></o-button>
          ${this.published === null
            ? null
            : html`<span class="text-xs text-white/70" data-published>
                ${this.published}
              </span>`}
          ${this.exported === null
            ? null
            : html`<span class="text-xs text-status-gain" data-exported>
                ${translateText("map_editor.exported", {
                  file: this.exported,
                })}
              </span>`}
        </div>
        ${this.problems.length === 0
          ? null
          : html`<ul class="text-xs text-status-loss" data-problems>
              ${this.problems.map((p) => html`<li>${translateText(p)}</li>`)}
            </ul>`}
      </div>
    `;
  }
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "map"
  );
}
