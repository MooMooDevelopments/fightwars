import { RateLimiter } from "limiter";
import { ClientID, Intent } from "../core/Schemas";

/**
 * Spam caps per client on the social intents (brief §8, HANDOFF §7).
 *
 * The simulation has cooldowns on these — an emoji every five seconds to
 * the same recipient, a quick chat every three — but they are per
 * recipient, and a client that ignores its own UI can send one to every
 * player in the lobby every tick. ClientMsgRateLimiter caps all intents at
 * ten a second, which an attack-heavy game legitimately reaches; this caps
 * each social family on its own, at a rate no player reaches by hand and a
 * flooder reaches in the first second. Attacks, builds and moves are the
 * game and are not capped here.
 *
 * Over the cap the intent is dropped with 429 and counted; the client is
 * not kicked — the byte cap in ClientMsgRateLimiter is what kicks.
 */
type Family = "emoji" | "chat" | "alliance" | "donate" | "target" | "embargo";

const FAMILY_OF: Partial<Record<Intent["type"], Family>> = {
  emoji: "emoji",
  quick_chat: "chat",
  allianceRequest: "alliance",
  allianceReject: "alliance",
  allianceExtension: "alliance",
  breakAlliance: "alliance",
  donate_gold: "donate",
  donate_troops: "donate",
  targetPlayer: "target",
  embargo: "embargo",
  embargo_all: "embargo",
};

/** Tokens per interval, per family. */
export const INTENT_CAPS: Record<
  Family,
  { tokensPerInterval: number; interval: "second" | "minute" | number }
> = {
  emoji: { tokensPerInterval: 10, interval: 10_000 },
  chat: { tokensPerInterval: 10, interval: 10_000 },
  alliance: { tokensPerInterval: 15, interval: "minute" },
  donate: { tokensPerInterval: 10, interval: "minute" },
  target: { tokensPerInterval: 10, interval: "minute" },
  embargo: { tokensPerInterval: 20, interval: "minute" },
};

export class IntentCaps {
  private readonly buckets = new Map<ClientID, Map<Family, RateLimiter>>();

  /** The family this intent type is capped under, or null if uncapped. */
  static familyOf(type: Intent["type"]): Family | null {
    return FAMILY_OF[type] ?? null;
  }

  /** True if the intent may go ahead; false if this client is over the cap. */
  allow(clientID: ClientID, type: Intent["type"]): boolean {
    const family = IntentCaps.familyOf(type);
    if (family === null) return true;
    let perClient = this.buckets.get(clientID);
    if (perClient === undefined) {
      perClient = new Map();
      this.buckets.set(clientID, perClient);
    }
    let bucket = perClient.get(family);
    if (bucket === undefined) {
      bucket = new RateLimiter(INTENT_CAPS[family]);
      perClient.set(family, bucket);
    }
    return bucket.tryRemoveTokens(1);
  }
}
