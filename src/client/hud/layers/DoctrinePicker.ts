import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { Doctrine, DOCTRINE_KEYS, DOCTRINES } from "../../../core/game/Game";
import { Controller } from "../../Controller";
import { getDoctrinePick, setDoctrinePick } from "../../DoctrinePick";
import { SendSpawnIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

/**
 * The doctrine picker (brief §6.6): eight buttons under the spawn hint for
 * as long as the spawn phase lasts. A pick before the tile is chosen rides
 * the spawn intent; a pick after it re-sends the same tile with the new
 * doctrine, so the order of the two choices does not matter. What the
 * simulation holds is what is shown as chosen — the pick is only a request.
 */
@customElement("doctrine-picker")
export class DoctrinePicker extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private visible = false;

  @state()
  private held: Doctrine = Doctrine.None;

  createRenderRoot() {
    return this;
  }

  init() {}

  tick() {
    const me = this.game.myPlayer();
    const config = this.game.config();
    const visible =
      this.game.inSpawnPhase() &&
      me !== null &&
      config.doctrinesEnabled() &&
      !config.isReplay() &&
      !config.isIntentionalSpectator();
    const held = me?.doctrine() ?? Doctrine.None;
    if (visible !== this.visible || held !== this.held) {
      this.visible = visible;
      this.held = held;
      this.requestUpdate();
    }
  }

  private pick(doctrine: Doctrine) {
    setDoctrinePick(doctrine);
    const tile = this.game.myPlayer()?.spawnTile();
    if (tile !== undefined) {
      this.eventBus.emit(new SendSpawnIntentEvent(tile, doctrine));
    }
    this.requestUpdate();
  }

  render() {
    if (!this.visible) return html``;
    const chosen = this.held !== Doctrine.None ? this.held : getDoctrinePick();
    return html`
      <div
        class="fixed bottom-[14%] left-1/2 -translate-x-1/2 z-[799]
               flex flex-col items-center gap-2 w-fit max-w-[95vw]
               bg-gray-800/70 rounded-md lg:rounded-lg backdrop-blur-xs
               text-white px-3 lg:px-4 py-2"
        style="pointer-events: auto;"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="text-sm lg:text-base font-medium">
          ${chosen === Doctrine.None
            ? translateText("doctrine.title")
            : translateText("doctrine.picked", {
                name: translateText(`doctrine.${DOCTRINE_KEYS[chosen]}`),
              })}
        </div>
        <div class="flex flex-wrap justify-center gap-1">
          ${DOCTRINES.map((doctrine) => {
            const key = DOCTRINE_KEYS[doctrine];
            const active = doctrine === chosen;
            return html`
              <button
                class="px-2 py-1 rounded text-xs lg:text-sm border
                       ${active
                  ? "bg-white/90 text-gray-900 border-white"
                  : "bg-black/20 hover:bg-black/40 border-white/20"}"
                title=${translateText(`doctrine.${key}_desc`)}
                @click=${() => this.pick(doctrine)}
              >
                ${translateText(`doctrine.${key}`)}
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }
}
