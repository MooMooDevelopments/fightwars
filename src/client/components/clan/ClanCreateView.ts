import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  CLAN_DESCRIPTION_MAX,
  CLAN_NAME_MAX,
  CLAN_TAG_RE,
  createClan,
  fetchClanExists,
} from "../../ClanApi";
import { translateText } from "../../Utils";
import { showToast } from "./ClanShared";

/**
 * The form that creates a clan and makes you its leader.
 *
 * Upstream created clans on its website, so the game client never had this
 * screen — the API route existed with nothing to call it. Everything here
 * mirrors a rule the server already enforces (src/api/ClanRoutes.ts): the tag
 * pattern, the two length caps, and the one-clan-per-account rule. Mirrored,
 * not trusted: the server still rejects anything this misses. The point of
 * checking here is that a player finds out while they are still typing.
 *
 * The tag is the one field worth checking against the server before submit —
 * it is the only one that can be taken by someone else, and discovering that
 * after filling in a description and a Discord link is the frustrating case.
 */
@customElement("clan-create-view")
export class ClanCreateView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @state() private tag = "";
  @state() private name = "";
  @state() private description = "";
  @state() private discordUrl = "";
  @state() private isOpen = true;
  @state() private submitting = false;
  @state() private errorMsg = "";
  /** null while unknown or unchecked; true when the tag is already someone's. */
  @state() private tagTaken: boolean | null = null;
  @state() private checkingTag = false;

  private tagDebounce: ReturnType<typeof setTimeout> | null = null;
  /** Guards against a slow availability check overwriting a newer one. */
  private tagGeneration = 0;

  disconnectedCallback() {
    if (this.tagDebounce) clearTimeout(this.tagDebounce);
    super.disconnectedCallback();
  }

  private get tagValid(): boolean {
    return CLAN_TAG_RE.test(this.tag);
  }

  private get canSubmit(): boolean {
    return (
      !this.submitting &&
      this.tagValid &&
      this.tagTaken !== true &&
      this.name.trim().length > 0 &&
      this.name.trim().length <= CLAN_NAME_MAX &&
      this.description.length <= CLAN_DESCRIPTION_MAX
    );
  }

  private onTagInput(e: Event) {
    // The server upper-cases the tag; showing it that way means the player
    // sees what they will actually be called in game.
    this.tag = (e.target as HTMLInputElement).value.toUpperCase();
    this.tagTaken = null;
    this.errorMsg = "";
    if (this.tagDebounce) clearTimeout(this.tagDebounce);
    if (!this.tagValid) {
      this.checkingTag = false;
      return;
    }
    this.checkingTag = true;
    this.tagDebounce = setTimeout(() => this.checkTag(), 400);
  }

  private async checkTag() {
    const gen = ++this.tagGeneration;
    const wanted = this.tag;
    const exists = await fetchClanExists(wanted);
    if (gen !== this.tagGeneration || wanted !== this.tag) return;
    this.checkingTag = false;
    // A null answer means the check itself failed; leave the field neutral
    // and let the server be the judge on submit.
    this.tagTaken = exists;
  }

  private async submit() {
    if (!this.canSubmit) return;
    this.submitting = true;
    this.errorMsg = "";
    const result = await createClan({
      tag: this.tag,
      name: this.name.trim(),
      description: this.description.trim() || undefined,
      isOpen: this.isOpen,
      discordUrl: this.discordUrl.trim() || undefined,
    });
    this.submitting = false;
    if ("error" in result) {
      this.errorMsg = translateText(result.error);
      // A taken tag is the one failure the form can point at directly.
      if (result.error === "clan_modal.create_tag_taken") this.tagTaken = true;
      return;
    }
    showToast(
      translateText("clan_modal.create_done", { tag: result.tag }),
      "green",
    );
    this.dispatchEvent(
      new CustomEvent("clan-created", {
        detail: { tag: result.tag },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private tagHint() {
    if (this.tag === "") return "";
    if (!this.tagValid) {
      return html`<p class="text-xs text-amber-400 mt-1.5">
        ${translateText("clan_modal.create_tag_rule")}
      </p>`;
    }
    if (this.checkingTag) {
      return html`<p class="text-xs text-white/40 mt-1.5">
        ${translateText("clan_modal.create_tag_checking")}
      </p>`;
    }
    if (this.tagTaken === true) {
      return html`<p class="text-xs text-red-400 mt-1.5">
        ${translateText("clan_modal.create_tag_taken")}
      </p>`;
    }
    if (this.tagTaken === false) {
      return html`<p class="text-xs text-emerald-400 mt-1.5">
        ${translateText("clan_modal.create_tag_free", { tag: this.tag })}
      </p>`;
    }
    return "";
  }

  private field(label: string, control: unknown, hint: unknown = "") {
    return html`
      <label class="block">
        <span
          class="block text-xs font-bold uppercase tracking-wider text-white/50 mb-1.5"
          >${label}</span
        >
        ${control}${hint}
      </label>
    `;
  }

  private inputClass(invalid = false) {
    return `w-full px-3 py-2.5 bg-white/5 border rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 transition-colors text-sm ${
      invalid
        ? "border-red-500/40 focus:ring-red-500/40"
        : "border-white/10 focus:ring-action/50 focus:border-action/50"
    }`;
  }

  render() {
    return html`
      <form
        class="space-y-4"
        @submit=${(e: Event) => {
          e.preventDefault();
          this.submit();
        }}
      >
        ${this.field(
          translateText("clan_modal.create_tag"),
          html`<input
            type="text"
            maxlength="5"
            autocomplete="off"
            spellcheck="false"
            .value=${this.tag}
            @input=${(e: Event) => this.onTagInput(e)}
            class=${this.inputClass(this.tagTaken === true)}
            placeholder=${translateText("clan_modal.create_tag_placeholder")}
            aria-describedby="clan-tag-hint"
          />`,
          html`<span id="clan-tag-hint" aria-live="polite"
            >${this.tagHint()}</span
          >`,
        )}
        ${this.field(
          translateText("clan_modal.create_name"),
          html`<input
            type="text"
            autocomplete="off"
            maxlength=${CLAN_NAME_MAX}
            .value=${this.name}
            @input=${(e: Event) => {
              this.name = (e.target as HTMLInputElement).value;
            }}
            class=${this.inputClass()}
            placeholder=${translateText("clan_modal.create_name_placeholder")}
          />`,
        )}
        ${this.field(
          translateText("clan_modal.create_description"),
          html`<textarea
            rows="3"
            maxlength=${CLAN_DESCRIPTION_MAX}
            .value=${this.description}
            @input=${(e: Event) => {
              this.description = (e.target as HTMLTextAreaElement).value;
            }}
            class="${this.inputClass()} resize-none"
            placeholder=${translateText(
              "clan_modal.create_description_placeholder",
            )}
          ></textarea>`,
          html`<p class="text-xs text-white/30 mt-1.5 text-right">
            ${this.description.length} / ${CLAN_DESCRIPTION_MAX}
          </p>`,
        )}
        ${this.field(
          translateText("clan_modal.create_discord"),
          html`<input
            type="url"
            autocomplete="off"
            maxlength="255"
            .value=${this.discordUrl}
            @input=${(e: Event) => {
              this.discordUrl = (e.target as HTMLInputElement).value;
            }}
            class=${this.inputClass()}
            placeholder="https://discord.gg/…"
          />`,
        )}

        <button
          type="button"
          role="switch"
          aria-checked=${this.isOpen ? "true" : "false"}
          @click=${() => {
            this.isOpen = !this.isOpen;
          }}
          class="w-full flex items-center justify-between gap-4 p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors text-left"
        >
          <span>
            <span class="block text-sm font-bold text-white"
              >${translateText("clan_modal.create_open")}</span
            >
            <span class="block text-xs text-white/40 mt-0.5">
              ${translateText(
                this.isOpen
                  ? "clan_modal.create_open_desc"
                  : "clan_modal.create_closed_desc",
              )}
            </span>
          </span>
          <span
            class="shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${this
              .isOpen
              ? "bg-action"
              : "bg-white/15"}"
          >
            <span
              class="block w-5 h-5 rounded-full bg-white transition-transform ${this
                .isOpen
                ? "translate-x-5"
                : ""}"
            ></span>
          </span>
        </button>

        ${this.errorMsg
          ? html`<p role="alert" class="text-red-400 text-sm text-center">
              ${this.errorMsg}
            </p>`
          : ""}

        <button
          type="submit"
          ?disabled=${!this.canSubmit}
          class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider rounded-lg transition-colors ${this
            .canSubmit
            ? "bg-action hover:bg-action-hover active:bg-action/80"
            : "bg-white/10 text-white/30 cursor-not-allowed"}"
        >
          ${translateText(
            this.submitting
              ? "clan_modal.create_submitting"
              : "clan_modal.create_submit",
          )}
        </button>
      </form>
    `;
  }
}
