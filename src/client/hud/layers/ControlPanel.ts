import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { ClientID } from "../../../core/Schemas";
import { Config } from "../../../core/configuration/Config";
import { GameMode, GameType, Gold } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import {
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import { AttackRatioEvent } from "../../InputHandler";
import { UIState } from "../../UIState";
import {
  getGamesPlayed,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";
import { GameView } from "../../view";
import { PlayerView } from "../../view/PlayerView";
import { goldCoinIcon, soldierIcon } from "../HotbarIcons";
import { TutorialHighlight, TutorialHighlightEvent } from "../Tutorial";
const swordIcon = assetUrl("images/SwordIcon.svg");

@customElement("control-panel")
export class ControlPanel extends LitElement implements Controller {
  public game: GameView;
  public clientID: ClientID;
  public eventBus: EventBus;
  public uiState: UIState;

  @state()
  private attackRatio: number = 0.2;

  @state()
  private _maxTroops: number;

  @state()
  private troopRate: number;

  @state()
  private _troops: number;

  @state()
  private _isVisible = false;

  @state()
  private _notification: { type: "warning" | "info"; message: string } | null =
    null;

  @state()
  private _gold: Gold;

  @state()
  private _attackingTroops: number = 0;

  /**
   * Whether troop growth is past its peak — the rate fell this tick.
   *
   * Kept because the tutorial teaches it ("growth slows down once your troops
   * approach half of your max") and because it is the cue to go and spend
   * troops. It is *not* the number in the tile: the tile shows the rate, this
   * is the sign of its slope, which is why it needs a channel of its own.
   */
  @state()
  private _troopGrowthSlowing: boolean = false;

  private _lastTroopIncreaseRate: number = 0;

  @state()
  private _goldGain: bigint | null = null;
  @state()
  private _goldGainPulseId: number = 0;
  private _goldGainTimeoutId: ReturnType<typeof setTimeout> | null = null;

  @state()
  private _tutorialHighlight: TutorialHighlight | null = null;

  // Border detection cache
  private _nearbyPlayerIDs: Set<number> = new Set();
  private _borderRefreshCounter: number = 0;
  private _borderTilesPromise: Promise<void> | null = null;
  // Track last attack tick per target player (for 15-second threshold)
  private _lastAttackTickByTarget: Map<number, number> = new Map();
  private static readonly BORDER_REFRESH_INTERVAL = 10; // recompute every 1s
  private static readonly ATTACK_THRESHOLD_TICKS = 15 * 10; // 15 seconds

  connectedCallback() {
    super.connectedCallback();
    // The attack ratio is cached below for the lifetime of the game, but the
    // settings modal is now reachable mid-match, so follow the stored value
    // when it changes there. (This panel's own slider is session-only: it
    // never writes UserSettings, so there is no loop.)
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.attackRatio`,
      this.onAttackRatioSettingChanged,
    );
  }

  init() {
    this.attackRatio = new UserSettings().attackRatio();
    this.uiState.attackRatio = this.attackRatio;
    this.eventBus.on(TutorialHighlightEvent, (e) => {
      this._tutorialHighlight = e.target;
    });
    this.eventBus.on(AttackRatioEvent, (event) => {
      let newAttackRatio = this.attackRatio + event.attackRatio / 100;

      if (newAttackRatio < 0.01) {
        newAttackRatio = 0.01;
      }

      if (newAttackRatio > 1) {
        newAttackRatio = 1;
      }

      if (newAttackRatio === 0.11 && this.attackRatio === 0.01) {
        // If we're changing the ratio from 1%, then set it to 10% instead of 11% to keep a consistency
        newAttackRatio = 0.1;
      }

      this.attackRatio = newAttackRatio;
      this.onAttackRatioChange(this.attackRatio);
    });
  }

  tick() {
    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this.setVisibile(true);
    }

    const player = this.game.myPlayer();
    if (player === null || !player.isAlive()) {
      this.setVisibile(false);
      return;
    }

    this.updateTroopGrowthSlope();

    const config = this.game.config();
    this._maxTroops = config.maxTroops(player);
    this._gold = player.gold();
    this._troops = player.troops();
    this._attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);
    this.troopRate = config.troopIncreaseRate(player) * 10;

    const helpEnabled = new UserSettings().helpMessages();

    // Don't target veteran players
    if (helpEnabled && getGamesPlayed() < 20) {
      // Track outgoing attacks for 15-second threshold
      this.trackOutgoingAttacks(player);

      // Refresh border detection cache periodically
      this.refreshNearbyPlayers(player);

      // Compute notification
      this._notification = this.computeNotification(player, config);
    }

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      const myID = player.id();
      const bonusEvents = updates[GameUpdateType.BonusEvent];
      if (bonusEvents) {
        for (const ev of bonusEvents) {
          if (ev.player === myID && ev.gold > 0) {
            this.addGoldGain(BigInt(ev.gold));
          }
        }
      }
      const conquestEvents = updates[GameUpdateType.ConquestEvent];
      if (conquestEvents) {
        for (const ev of conquestEvents) {
          if (ev.conquerorId === myID && ev.gold > 0n) {
            this.addGoldGain(ev.gold);
          }
        }
      }
      const donateEvents = updates[GameUpdateType.DonateEvent];
      if (donateEvents) {
        for (const ev of donateEvents) {
          if (
            ev.donationType === "gold" &&
            ev.recipientId === myID &&
            ev.amount > 0n
          ) {
            this.addGoldGain(ev.amount);
          }
        }
      }
    }

    this.requestUpdate();
  }

  // Last-wins: when multiple gold events arrive in one tick, the pip shows
  // only the most recent amount (not a sum) — each gain restarts the pulse.
  private addGoldGain(amount: bigint) {
    this._goldGain = amount;
    this._goldGainPulseId++;
    if (this._goldGainTimeoutId !== null) {
      clearTimeout(this._goldGainTimeoutId);
    }
    this._goldGainTimeoutId = setTimeout(() => {
      this._goldGain = null;
      this._goldGainTimeoutId = null;
      this.requestUpdate();
    }, 2000);
  }

  private trackOutgoingAttacks(player: PlayerView) {
    const currentTick = this.game.ticks();
    for (const attack of player.outgoingAttacks()) {
      if (attack.targetID !== 0 && !attack.retreating) {
        this._lastAttackTickByTarget.set(attack.targetID, currentTick);
      }
    }
    // Clean up old entries
    for (const [playerID, tick] of this._lastAttackTickByTarget.entries()) {
      if (currentTick - tick > ControlPanel.ATTACK_THRESHOLD_TICKS * 2) {
        this._lastAttackTickByTarget.delete(playerID);
      }
    }
  }

  private refreshNearbyPlayers(player: PlayerView) {
    this._borderRefreshCounter++;
    if (
      this._borderRefreshCounter < ControlPanel.BORDER_REFRESH_INTERVAL ||
      this._borderTilesPromise !== null
    ) {
      return;
    }
    this._borderRefreshCounter = 0;
    this._borderTilesPromise = player.borderTiles().then((bt) => {
      this._borderTilesPromise = null;
      const myID = player.smallID();
      const nearby = new Set<number>();
      for (const tile of bt.borderTiles) {
        for (const neighbor of this.game.neighbors(tile as TileRef)) {
          const ownerID = this.game.ownerID(neighbor);
          if (ownerID !== 0 && ownerID !== myID) {
            nearby.add(ownerID);
          }
        }
      }
      this._nearbyPlayerIDs = nearby;
    });
  }

  private computeNotification(
    player: PlayerView,
    config: Config,
  ): { type: "warning" | "info"; message: string } | null {
    const currentTick = this.game.ticks();

    // Army limit warning
    const { gameMode, gameType } = config.gameConfig();
    const isPublicTeamGame =
      gameMode === GameMode.Team && gameType === GameType.Public;
    const canDonateTroops = config.donateTroops();
    if (isPublicTeamGame && canDonateTroops) {
      const ratio = this._troops / Math.max(this._maxTroops, 1);
      if (ratio >= config.armyLimitWarningThreshold()) {
        return {
          type: "warning",
          message: "control_panel.army_limit_warning",
        };
      }
    }

    // Low troops (Less than 1k) warning
    if (this._troops < 10000 && this._troops > 0) {
      return { type: "warning", message: "control_panel.low_troops_warning" };
    }

    // Info messages: check nearby players for traitors, AFK allies, AFK teammates
    for (const nearbyID of this._nearbyPlayerIDs) {
      let other;
      try {
        other = this.game.playerBySmallID(nearbyID);
      } catch {
        continue;
      }
      if (!other.isPlayer() || !other.isAlive()) continue;

      const lastAttackTick = this._lastAttackTickByTarget.get(nearbyID) ?? -1;
      const secondsSinceAttack = (currentTick - lastAttackTick) / 10;
      const hasNotAttackedRecently =
        lastAttackTick < 0 || secondsSinceAttack > 15;

      if (!hasNotAttackedRecently) continue;

      if (other.isTraitor() && player.isAlliedWith(other)) {
        return { type: "info", message: "control_panel.traitor_neighbor_info" };
      }
      if (other.isDisconnected() && player.isAlliedWith(other)) {
        return {
          type: "info",
          message: "control_panel.allied_afk_neighbor_info",
        };
      }
      if (other.isDisconnected() && player.isOnSameTeam(other)) {
        return {
          type: "info",
          message: "control_panel.teammate_afk_neighbor_info",
        };
      }
    }

    return null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    globalThis.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.attackRatio`,
      this.onAttackRatioSettingChanged,
    );
    if (this._goldGainTimeoutId !== null) {
      clearTimeout(this._goldGainTimeoutId);
      this._goldGainTimeoutId = null;
    }
  }

  /**
   * Track whether the growth rate is rising or falling.
   *
   * The comparison is against the previous tick rather than against a
   * fraction of the cap, which is what the tutorial describes — the two
   * coincide, because the rate peaks around half of max and falls from there.
   */
  private updateTroopGrowthSlope() {
    const player = this.game?.myPlayer();
    if (player === null) return;
    const rate = this.game.config().troopIncreaseRate(player);
    this._troopGrowthSlowing = rate < this._lastTroopIncreaseRate;
    this._lastTroopIncreaseRate = rate;
  }

  onAttackRatioChange(newRatio: number) {
    this.uiState.attackRatio = newRatio;
  }

  private onAttackRatioSettingChanged = () => {
    // The element outlives any one game; uiState only exists once init() ran.
    if (this.uiState === undefined) return;
    this.attackRatio = new UserSettings().attackRatio();
    this.onAttackRatioChange(this.attackRatio);
    this.requestUpdate();
  };

  setVisibile(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  private handleRatioSliderInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const value = Number(input.value);
    this.attackRatio = value / 100;
    this.onAttackRatioChange(this.attackRatio);
  }

  private handleRatioSliderPointerUp(e: Event) {
    (e.target as HTMLInputElement).blur();
  }

  /**
   * The two segments of the troop meter, as percentages of the cap: troops at
   * home, then troops already committed to attacks. Named for what they are
   * rather than for what colour they used to be — they were `greenPercent`
   * and `orangePercent` until the palette stopped being hue-named.
   *
   * The committed segment is clamped to whatever room the first leaves, so
   * the two can never sum past the track.
   */
  private calculateTroopBar(): {
    atHomePercent: number;
    committedPercent: number;
  } {
    const base = Math.max(this._maxTroops, 1);
    const atHomePercent = Math.max(
      0,
      Math.min(100, (this._troops / base) * 100),
    );
    const committedPercent = Math.max(
      0,
      Math.min(100 - atHomePercent, (this._attackingTroops / base) * 100),
    );

    return { atHomePercent, committedPercent };
  }

  /**
   * The troop meter's track and its two stacked segments.
   *
   * Shared by both layouts because the segments are the part that has rules —
   * the layouts differ only in which labels they put on top. Everything the
   * bar is made of comes from the meter's component tokens, so a white label
   * is legible wherever the fill happens to end; that is what retired the
   * per-label `drop-shadow` this bar used to wear.
   *
   * The 2px sliver in the track colour between the segments is the gap that
   * separates them. A stroke around either segment would add ink that is not
   * data; a gap in the surface behind them is the mechanism that does not.
   *
   * The segments are driven by `transform` rather than `width` so the browser
   * can animate them off the main thread — this bar reticks ten times a
   * second. The cost is that neither segment can carry a rounded data-end of
   * its own (a scaled radius stretches), so the rounding lives on the track
   * and the segments are clipped by it.
   */
  private renderTroopMeterFill() {
    const { atHomePercent, committedPercent } = this.calculateTroopBar();
    return html`
      <div class="relative h-full">
        <div
          class="absolute inset-y-0 left-0 w-full origin-left bg-meter-fill transition-transform duration-200 ease-out"
          style="transform: scaleX(${atHomePercent / 100});"
        ></div>
        <div
          class="absolute inset-y-0 left-0 w-full origin-left bg-meter-committed transition-transform duration-200 ease-out"
          style="transform: translateX(${atHomePercent}%) scaleX(${committedPercent /
          100});"
        ></div>
        ${committedPercent > 0
          ? html`<div
              class="absolute inset-y-0 left-0 w-full pointer-events-none transition-transform duration-200 ease-out"
              style="transform: translateX(${atHomePercent}%);"
            >
              <div class="absolute inset-y-0 left-0 w-0.5 bg-meter-track"></div>
            </div>`
          : ""}
      </div>
    `;
  }

  private renderMobileTroopBar() {
    return html`
      <div
        class="w-full h-6 rounded-md bg-meter-track overflow-hidden relative"
      >
        ${this.renderTroopMeterFill()}
        <div
          class="absolute inset-0 flex items-center justify-between px-1.5 text-xs font-display font-semibold tabular-nums leading-none pointer-events-none"
          translate="no"
        >
          <span class="text-ink">${renderTroops(this._troops)}</span>
          <span class="text-ink">${renderTroops(this._maxTroops)}</span>
        </div>
        <div
          class="absolute inset-0 flex items-center justify-center pointer-events-none"
          translate="no"
        >
          <div
            class="flex items-center gap-0.5 px-1 ${this.tutorialHighlightClass(
              "troop_rate",
            )}"
          >
            <img
              src=${soldierIcon}
              alt=""
              aria-hidden="true"
              width="12"
              height="12"
              class="brightness-0 invert"
            />
            <span
              class="text-[10px] font-display font-semibold tabular-nums ${this
                ._troopGrowthSlowing
                ? "text-signal"
                : "text-ink"}"
              >+${renderTroops(this.troopRate)}/s${this._troopGrowthSlowing
                ? "▼"
                : ""}</span
            >
          </div>
        </div>
      </div>
    `;
  }

  private renderDesktopTroopBar() {
    return html`
      <div
        class="w-full h-6 rounded-md bg-meter-track overflow-hidden relative"
      >
        ${this.renderTroopMeterFill()}
        <div
          class="absolute inset-0 flex items-center text-lg font-display font-semibold tabular-nums leading-none pointer-events-none"
          translate="no"
        >
          <span class="flex-1 flex justify-end h-full items-center pr-0.5">
            <span class="text-ink">${renderTroops(this._troops)}</span>
          </span>
          <span class="h-full flex items-center px-0.5 text-ink-dim">/</span>
          <span
            class="flex-1 flex justify-start h-full items-center pl-0.5 gap-0.5"
          >
            <span class="text-ink w-[3.5rem]"
              >${renderTroops(this._maxTroops)}</span
            >
            <img
              src=${soldierIcon}
              alt=""
              aria-hidden="true"
              width="22"
              height="22"
              class="shrink-0 brightness-0 invert ml-1.5"
            />
          </span>
        </div>
      </div>
    `;
  }

  private tutorialHighlightClass(target: TutorialHighlight): string {
    return this._tutorialHighlight === target ? "tutorial-highlight" : "";
  }

  private renderNotification() {
    if (!this._notification) return html``;
    const isWarning = this._notification.type === "warning";
    return html`
      <div
        class="flex items-center gap-1.5 px-1.5 py-1 rounded-md border text-xs font-medium mb-1 ${isWarning
          ? "border-signal/60 bg-signal/10 text-signal"
          : "border-action-ink/60 bg-action-ink/10 text-action-ink"}"
      >
        <span class="shrink-0">${isWarning ? "⚠" : "ℹ"}</span>
        <span>${translateText(this._notification.message)}</span>
      </div>
    `;
  }

  private renderDesktop() {
    return html`
      ${this.renderNotification()}
      <!-- Row 1: troop rate | troop bar | gold -->
      <div class="flex gap-1.5 items-center mb-1">
        <!-- Troop rate -->
        <div
          class="flex items-center gap-1 shrink-0 border rounded-md text-sm py-0.5 px-1 w-[5.5rem] ${this.tutorialHighlightClass(
            "troop_rate",
          )} ${this._troopGrowthSlowing
            ? "border-signal/60"
            : "border-ink-dim/40"}"
          translate="no"
          title=${translateText(
            this._troopGrowthSlowing
              ? "control_panel.troop_rate_slowing"
              : "control_panel.troop_rate_rising",
          )}
        >
          <img
            src=${soldierIcon}
            alt=""
            aria-hidden="true"
            width="13"
            height="13"
            class="shrink-0 brightness-0 invert opacity-70"
          />
          <span
            class="text-sm font-display font-semibold tabular-nums ${this
              ._troopGrowthSlowing
              ? "text-signal"
              : "text-ink"}"
            >+${renderTroops(this.troopRate)}/s</span
          >
          <!-- The caret, not the colour, is what carries this state to a
               player who cannot see the colour. -->
          <span
            class="text-[10px] leading-none ${this._troopGrowthSlowing
              ? "text-signal"
              : "invisible"}"
            aria-hidden="true"
            >▼</span
          >
        </div>
        <!-- Troop bar -->
        <div class="flex-1 ${this.tutorialHighlightClass("troops")}">
          ${this.renderDesktopTroopBar()}
        </div>
        <!-- Gold. The coin carries the identity; the figure wears ink. -->
        <div
          class="flex items-center gap-1 shrink-0 border border-ink-dim/40 rounded-md text-sm py-0.5 px-1 min-w-[4.5rem] relative ${this.tutorialHighlightClass(
            "gold",
          )}"
          translate="no"
        >
          ${this._goldGain !== null
            ? keyed(
                this._goldGainPulseId,
                html`<span
                  class="gold-gain-pop absolute -top-5 right-[5px] min-[1015px]:right-[9px] text-ink text-sm font-display font-semibold tabular-nums whitespace-nowrap pointer-events-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]"
                  >+${renderNumber(this._goldGain)}</span
                >`,
              )
            : ""}
          <img
            src=${goldCoinIcon}
            alt=""
            aria-hidden="true"
            width="13"
            height="13"
            class="shrink-0"
          />
          <span class="font-display font-semibold tabular-nums text-ink"
            >${renderNumber(this._gold)}</span
          >
        </div>
      </div>
      <!-- Row 2: attack ratio | slider -->
      <div
        class="flex items-center gap-1.5 ${this.tutorialHighlightClass(
          "attack_ratio",
        )}"
        translate="no"
      >
        <div
          class="flex items-center gap-1 shrink-0 border border-ink-dim/40 rounded-md px-1 py-0.5 text-sm text-ink cursor-pointer w-[8rem]"
        >
          <img
            src=${swordIcon}
            alt=""
            aria-hidden="true"
            width="12"
            height="12"
            style="filter: brightness(0) invert(1);"
          />
          <span class="font-display font-semibold tabular-nums"
            >${(this.attackRatio * 100).toFixed(0)}%
            (${renderTroops(
              (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
            )})</span
          >
        </div>
        <input
          type="range"
          min="1"
          max="100"
          .value=${String(Math.round(this.attackRatio * 100))}
          @input=${(e: Event) => this.handleRatioSliderInput(e)}
          @pointerup=${(e: Event) => this.handleRatioSliderPointerUp(e)}
          class="flex-1 h-1.5 accent-action cursor-pointer"
        />
      </div>
    `;
  }

  private renderMobile() {
    return html`
      ${this.renderNotification()}
      <div class="flex gap-2 items-center">
        <!-- Gold -->
        <div
          class="flex items-center justify-center p-1 gap-0.5 border border-ink-dim/40 rounded-md text-ink text-xs w-1/5 shrink-0 relative ${this.tutorialHighlightClass(
            "gold",
          )}"
          translate="no"
        >
          ${this._goldGain !== null
            ? keyed(
                this._goldGainPulseId,
                html`<span
                  class="gold-gain-pop absolute -top-5 right-[5px] min-[1015px]:right-[9px] text-ink text-xs font-display font-semibold tabular-nums whitespace-nowrap pointer-events-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]"
                  >+${renderNumber(this._goldGain)}</span
                >`,
              )
            : ""}
          <img
            src=${goldCoinIcon}
            alt=""
            aria-hidden="true"
            width="13"
            height="13"
          />
          <span class="px-0.5 font-display font-semibold tabular-nums"
            >${renderNumber(this._gold)}</span
          >
        </div>
        <!-- Troop bar -->
        <div
          class="w-[40%] shrink-0 flex items-center ${this.tutorialHighlightClass(
            "troops",
          )}"
        >
          ${this.renderMobileTroopBar()}
        </div>
        <!-- Sword + % label -->
        <div
          class="flex flex-col items-center shrink-0 gap-0.5 w-8"
          translate="no"
        >
          <img
            src=${swordIcon}
            alt=""
            aria-hidden="true"
            width="10"
            height="10"
            style="filter: brightness(0) invert(1);"
          />
          <span class="text-ink text-xs font-display font-semibold tabular-nums"
            >${(this.attackRatio * 100).toFixed(0)}%</span
          >
        </div>
        <!-- Attack ratio slider -->
        <div
          class="flex-1 ${this.tutorialHighlightClass("attack_ratio")}"
          translate="no"
        >
          <input
            type="range"
            min="1"
            max="100"
            .value=${String(Math.round(this.attackRatio * 100))}
            @input=${(e: Event) => this.handleRatioSliderInput(e)}
            @pointerup=${(e: Event) => this.handleRatioSliderPointerUp(e)}
            class="w-full h-1.5 accent-action cursor-pointer"
          />
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <style>
        @keyframes gold-gain-pop {
          0% {
            transform: translateY(4px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .gold-gain-pop {
          animation: gold-gain-pop 0.25s ease-out;
        }
      </style>
      <div
        class="relative pointer-events-auto ${this._isVisible
          ? "relative w-full text-sm px-2 py-1"
          : "hidden"}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="lg:hidden">${this.renderMobile()}</div>
        <div class="hidden lg:block">${this.renderDesktop()}</div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
