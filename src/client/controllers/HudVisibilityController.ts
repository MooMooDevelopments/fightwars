import { EventBus } from "../../core/EventBus";
import { UserSettings } from "../../core/game/UserSettings";
import { Controller } from "../Controller";
import { ToggleHudEvent } from "../InputHandler";
import { Platform } from "../Platform";
import { translateText } from "../Utils";

/** Class on the document root while the chrome is hidden; styles.css reads it. */
export const HUD_HIDDEN_CLASS = "hud-hidden";

/**
 * The chrome hides with one key (brief §7): the leaderboard, the control
 * panel, the feeds and the top-right cluster all go at once, and the map is
 * the whole screen. Modals and the radial menus are untouched — they are
 * things the player opened, not chrome.
 *
 * The hiding itself is one class on the root and a rule in styles.css, so
 * every surface marked `data-hud` in index.html follows without knowing.
 * What this owns is the state, and the one thing that must stay: a small
 * button that says how to get the interface back, because a phone has no Z.
 */
export class HudVisibilityController implements Controller {
  private hidden = false;
  private hint: HTMLButtonElement | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly userSettings: UserSettings,
    private readonly root: HTMLElement = document.documentElement,
    private readonly host: HTMLElement = document.body,
  ) {}

  init(): void {
    // A game always starts with its interface: a class left by a previous
    // game on a page that was put back rather than reloaded must not carry.
    this.setHidden(false);
    this.eventBus.on(ToggleHudEvent, this.onToggle);
  }

  private onToggle = (): void => {
    this.setHidden(!this.hidden);
  };

  isHidden(): boolean {
    return this.hidden;
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.root.classList.toggle(HUD_HIDDEN_CLASS, hidden);
    if (hidden) {
      this.showHint();
    } else {
      this.hint?.remove();
      this.hint = null;
    }
  }

  private showHint(): void {
    if (this.hint !== null) return;
    const key = this.userSettings.keybinds(Platform.isMac).toggleHud ?? "";
    const hint = document.createElement("button");
    hint.type = "button";
    hint.dataset.hudHint = "";
    hint.className =
      "fixed bottom-2 right-2 z-[1001] rounded-md bg-gray-800/92 px-2.5 py-1.5 " +
      "text-xs font-semibold text-white backdrop-blur-sm shadow-xs " +
      "hover:bg-gray-700/92 focus-visible:outline-2 focus-visible:outline-white";
    hint.textContent = translateText("hud.show_hint", {
      key: keyLabel(key),
    });
    hint.addEventListener("click", () => this.setHidden(false));
    this.host.appendChild(hint);
    this.hint = hint;
  }
}

/** "KeyZ" → "Z", "Digit1" → "1", "Shift+KeyR" → "Shift+R". */
export function keyLabel(code: string): string {
  return code
    .split("+")
    .map((part) => part.replace(/^Key|^Digit/, ""))
    .join("+");
}
