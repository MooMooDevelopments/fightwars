import {
  AllianceTier,
  Difficulty,
  Game,
  GameMode,
  nextAllianceTier,
  Player,
  PlayerType,
  Relation,
  Team,
} from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { assertNever } from "../../Util";
import { AllianceExtensionExecution } from "../alliance/AllianceExtensionExecution";
import { AllianceRequestExecution } from "../alliance/AllianceRequestExecution";
import {
  EMOJI_CONFUSED,
  EMOJI_HANDSHAKE,
  EMOJI_LOVE,
  EMOJI_SCARED_OF_THREAT,
  NationEmojiBehavior,
} from "./NationEmojiBehavior";
import { findJuiciestTarget } from "./NationUtils";

export class NationAllianceBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private emojiBehavior: NationEmojiBehavior,
  ) {}

  handleAllianceRequests() {
    if (this.game.config().disableAlliances()) return;

    for (const req of this.player.incomingAllianceRequests()) {
      // Alliance Request intents created during the spawn phase are executed on
      // the first tick post-spawn phase. With the following condition we reject
      // all requests created during the spawn phase.
      if (req.createdAt() <= this.game.config().numSpawnPhaseTurns() + 1) {
        req.reject();
        continue;
      }
      if (this.getAllianceDecision(req.requestor(), true, req.tier())) {
        req.accept();
      } else {
        req.reject();
      }
    }
  }

  handleAllianceExtensionRequests() {
    if (this.game.config().disableAlliances()) return;

    for (const alliance of this.player.alliances()) {
      // Alliance expiration tracked by Events Panel, only human ally can click Request to Renew
      // Skip if no expiration yet/ ally didn't request extension yet / nation already agreed to extend
      if (!alliance.onlyOneAgreedToExtend()) continue;

      const human = alliance.other(this.player);
      if (!this.getAllianceDecision(human, true, alliance.tier())) continue;

      this.game.addExecution(
        new AllianceExtensionExecution(this.player, human.id()),
      );
    }
  }

  maybeSendAllianceRequests(borderingEnemies: Player[]) {
    if (this.game.config().disableAlliances()) return;

    // Only easy nations are allowed to send alliance requests to bots
    const isAcceptablePlayerType = (p: Player) =>
      (p.type() === PlayerType.Bot &&
        this.game.config().gameConfig().difficulty === Difficulty.Easy) ||
      p.type() !== PlayerType.Bot;

    // Under a coalition, everyone who is not the leader is worth a pact,
    // and worth asking every time rather than one time in thirty.
    const coalition = this.coalitionAgainst();
    for (const enemy of borderingEnemies) {
      const inCoalition =
        coalition !== null && !this.isLeader(enemy, coalition);
      if (
        (inCoalition || this.random.chance(30)) &&
        isAcceptablePlayerType(enemy) &&
        this.player.canSendAllianceRequest(enemy) &&
        this.getAllianceDecision(enemy, false, this.firstTier())
      ) {
        this.game.addExecution(
          new AllianceRequestExecution(
            this.player,
            enemy.id(),
            inCoalition ? AllianceTier.DefensivePact : this.firstTier(),
          ),
        );
      }
    }
  }

  /**
   * Climb the ladder with partners the nation has come to like: a pact
   * becomes a defensive pact, a defensive pact a full alliance, one rung at
   * a time and not every tick.
   */
  maybeDeepenAlliances() {
    if (this.game.config().disableAlliances()) return;
    if (!this.game.config().allianceTiersEnabled()) return;
    for (const alliance of this.player.alliances()) {
      if (alliance.tier() >= AllianceTier.FullAlliance) continue;
      if (!this.random.chance(20)) continue;
      const partner = alliance.other(this.player);
      const next = nextAllianceTier(alliance.tier());
      if (!this.player.canSendAllianceRequest(partner)) continue;
      if (!this.getAllianceDecision(partner, false, next)) continue;
      this.game.addExecution(
        new AllianceRequestExecution(this.player, partner.id(), next),
      );
    }
  }

  /** What a nation asks for first: a pact when tiers are on, else the old full alliance. */
  private firstTier(): AllianceTier {
    return this.game.config().allianceTiersEnabled()
      ? AllianceTier.NonAggression
      : AllianceTier.FullAlliance;
  }

  /** The side a coalition is forming against, or null when there is none. */
  private coalitionAgainst(): Player | Team | null {
    const leader = this.game.leader();
    if (leader === null) return null;
    if (this.game.leaderShare() < this.game.config().coalitionThreshold()) {
      return null;
    }
    // The leader itself, and the leader's own team, get no coalition.
    if (this.isLeader(this.player, leader)) return null;
    return leader;
  }

  private isLeader(p: Player, leader: Player | Team): boolean {
    return typeof leader === "string" ? p.team() === leader : p === leader;
  }

  private getAllianceDecision(
    otherPlayer: Player,
    isResponse: boolean,
    tier: AllianceTier = AllianceTier.FullAlliance,
  ): boolean {
    // Easy (dumb) nations sometimes get confused and accept/reject randomly (Just like dumb humans do)
    if (this.isConfused()) {
      return this.random.chance(2);
    }
    // Nearly always reject traitors
    if (otherPlayer.isTraitor() && this.random.nextInt(0, 100) >= 10) {
      if (isResponse && this.random.chance(3)) {
        this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_CONFUSED);
      }
      return false;
    }
    // Coalition (brief §6.5): against a side holding the map, any pact or
    // defensive pact with a fellow non-leader is taken without the usual
    // reluctance about too many friends — the reluctance exists to keep
    // enough enemies for the crown, and the crown is the problem now.
    const coalition = this.coalitionAgainst();
    if (
      coalition !== null &&
      !this.isLeader(otherPlayer, coalition) &&
      tier <= AllianceTier.DefensivePact &&
      this.player.relation(otherPlayer) >= Relation.Neutral
    ) {
      return true;
    }
    // A non-aggression pact asks for nothing but peace, and peace with a
    // neighbour that is not hostile is cheap to give.
    if (
      tier === AllianceTier.NonAggression &&
      this.game.config().allianceTiersEnabled()
    ) {
      return this.player.relation(otherPlayer) >= Relation.Neutral;
    }
    // A full alliance is only for players the nation actually likes, or in
    // the honeymoon of the opening; everything below it goes through the
    // usual reckoning about threats and numbers.
    if (
      tier === AllianceTier.FullAlliance &&
      this.game.config().allianceTiersEnabled() &&
      !this.isAlliancePartnerFriendly(otherPlayer) &&
      !this.isEarlygame()
    ) {
      return false;
    }
    // Reject if otherPlayer has allied with a lot of players (Hard and Impossible only)
    // To make sure there are enough non-friendly players in the game to stop the crown with nukes
    if (this.hasTooManyAlliances(otherPlayer)) {
      return false;
    }
    // Before caring about the relation, first check if the otherPlayer is a threat
    // Easy (dumb) nations are blinded by hatred, they don't care about threats, they care about the relation
    // Impossible (smart) nations on the other hand are analyzing the facts
    if (this.isAlliancePartnerThreat(otherPlayer)) {
      if (!isResponse && this.random.chance(6)) {
        this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_SCARED_OF_THREAT);
      }
      if (isResponse && this.random.chance(6)) {
        this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_LOVE);
      }
      return true;
    }
    // Maybe reject if we are in a team game (allying makes less sense there)
    if (this.shouldRejectInTeamGame()) {
      return false;
    }
    // Reject if relation is bad
    if (this.player.relation(otherPlayer) < Relation.Neutral) {
      if (isResponse && this.random.chance(3)) {
        this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_CONFUSED);
      }
      return false;
    }
    // Maybe accept if relation is friendly
    if (this.isAlliancePartnerFriendly(otherPlayer)) {
      if (this.random.chance(3)) {
        this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_HANDSHAKE);
      }
      return true;
    }
    // Reject if we already have some alliances, we don't want to ally with the entire map
    if (this.checkAlreadyEnoughAlliances(otherPlayer)) {
      return false;
    }
    // Maybe accept if we are in the earlygame
    if (this.isEarlygame()) {
      return true;
    }
    // Accept if we are similarly strong
    return this.isAlliancePartnerSimilarlyStrong(otherPlayer);
  }

  private hasTooManyAlliances(otherPlayer: Player): boolean {
    const { difficulty } = this.game.config().gameConfig();
    if (
      difficulty !== Difficulty.Hard &&
      difficulty !== Difficulty.Impossible
    ) {
      return false;
    }

    const totalPlayers = this.game
      .players()
      .filter((p) => p.type() !== PlayerType.Bot).length;
    // A pact is peace and nothing more; the cap rations the partners who
    // would actually fight for each other (brief §6.5, session-12 retune).
    const otherPlayerAlliances = this.game.config().allianceCapCountsPacts()
      ? otherPlayer.alliances().length
      : otherPlayer.allies().length;

    if (difficulty === Difficulty.Hard) {
      return otherPlayerAlliances >= totalPlayers * 0.5;
    } else {
      return otherPlayerAlliances >= totalPlayers * 0.25;
    }
  }

  private isConfused(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return this.random.chance(10); // 10% chance to be confused on easy
      case Difficulty.Medium:
        return this.random.chance(20); // 5% chance to be confused on medium
      case Difficulty.Hard:
        return this.random.chance(40); // 2.5% chance to be confused on hard
      case Difficulty.Impossible:
        return false; // No confusion on impossible
      default:
        assertNever(difficulty);
    }
  }

  private isEarlygame(): boolean {
    const spawnTicks = this.game.config().numSpawnPhaseTurns();
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        // On easy, accept 90% in the first 5 minutes
        return (
          this.game.ticks() < 3000 + spawnTicks &&
          this.random.nextInt(0, 100) >= 10
        );
      case Difficulty.Medium:
        // On medium, accept 70% in the first 3 minutes
        return (
          this.game.ticks() < 1800 + spawnTicks &&
          this.random.nextInt(0, 100) >= 30
        );
      case Difficulty.Hard:
        // On hard, accept 50% in the first 3 minutes
        return (
          this.game.ticks() < 1800 + spawnTicks &&
          this.random.nextInt(0, 100) >= 50
        );
      case Difficulty.Impossible:
        // On impossible, accept 30% in the first minute
        return (
          this.game.ticks() < 600 + spawnTicks &&
          this.random.nextInt(0, 100) >= 70
        );
      default:
        assertNever(difficulty);
    }
  }

  private isAlliancePartnerThreat(otherPlayer: Player): boolean {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        // On easy we are very dumb, we don't see anybody as a threat
        return false;
      case Difficulty.Medium:
        // On medium we just see players with much more troops as a threat
        return otherPlayer.troops() > this.player.troops() * 2.5;
      case Difficulty.Hard:
        // On hard we are smarter, we check for maxTroops to see the actual strength
        return (
          otherPlayer.troops() > this.player.troops() &&
          this.game.config().maxTroops(otherPlayer) >
            this.game.config().maxTroops(this.player) * 2
        );
      case Difficulty.Impossible: {
        // On impossible we check for multiple factors and try to not mess with stronger players (we want to steamroll over weaklings)
        const otherHasMoreTroops =
          otherPlayer.troops() > this.player.troops() * 1.5;
        const otherHasMoreMaxTroops =
          otherPlayer.troops() > this.player.troops() &&
          this.game.config().maxTroops(otherPlayer) >
            this.game.config().maxTroops(this.player) * 1.5;
        const otherHasMoreTiles =
          otherPlayer.troops() > this.player.troops() &&
          otherPlayer.numTilesOwned() > this.player.numTilesOwned() * 1.5;
        return otherHasMoreTroops || otherHasMoreMaxTroops || otherHasMoreTiles;
      }
      default:
        assertNever(difficulty);
    }
  }

  private shouldRejectInTeamGame(): boolean {
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
      return false;
    }

    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return this.random.nextInt(0, 100) < 25; // 25% chance to reject on easy
      case Difficulty.Medium:
        return this.random.nextInt(0, 100) < 50; // 50% chance to reject on medium
      case Difficulty.Hard:
        return this.random.nextInt(0, 100) < 75; // 75% chance to reject on hard
      case Difficulty.Impossible:
        return true; // 100% chance to reject on impossible
      default:
        assertNever(difficulty);
    }
  }

  private checkAlreadyEnoughAlliances(otherPlayer: Player): boolean {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return false; // On easy we never think we have enough alliances
      case Difficulty.Medium:
        return this.player.alliances().length >= this.random.nextInt(4, 6);
      case Difficulty.Hard:
      case Difficulty.Impossible: {
        // On hard and impossible we try to not ally with all our neighbors (If we have 2+ neighbors)
        const borderingPlayers = this.player
          .nearby()
          .filter(
            (n): n is Player => n.isPlayer() && n.type() !== PlayerType.Bot,
          );
        const borderingFriends = borderingPlayers.filter(
          (o) => this.player?.isFriendly(o) === true,
        );
        if (
          borderingPlayers.length >= 2 &&
          borderingPlayers.includes(otherPlayer)
        ) {
          return borderingPlayers.length <= borderingFriends.length + 1;
        }
        if (difficulty === Difficulty.Hard) {
          return this.player.alliances().length >= this.random.nextInt(3, 5);
        }
        return this.player.alliances().length >= this.random.nextInt(2, 4);
      }
      default:
        assertNever(difficulty);
    }
  }

  private isAlliancePartnerFriendly(otherPlayer: Player): boolean {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
      case Difficulty.Medium:
        return this.player.relation(otherPlayer) === Relation.Friendly;
      case Difficulty.Hard:
        return (
          this.player.relation(otherPlayer) === Relation.Friendly &&
          this.random.nextInt(0, 100) >= 17
        );
      case Difficulty.Impossible:
        return (
          this.player.relation(otherPlayer) === Relation.Friendly &&
          this.random.nextInt(0, 100) >= 33
        );
      default:
        assertNever(difficulty);
    }
  }

  // It would make a lot of sense to use nextFloat here, but "there's a chance floats can cause desyncs"
  private isAlliancePartnerSimilarlyStrong(otherPlayer: Player): boolean {
    const { difficulty } = this.game.config().gameConfig();
    const troopPercentRangeByDifficulty = {
      [Difficulty.Easy]: [60, 70],
      [Difficulty.Medium]: [70, 80],
      [Difficulty.Hard]: [75, 85],
      [Difficulty.Impossible]: [80, 90],
    } as const;
    const tilePercentRangeByDifficulty = {
      [Difficulty.Easy]: [70, 80],
      [Difficulty.Medium]: [80, 90],
      [Difficulty.Hard]: [85, 95],
      [Difficulty.Impossible]: [90, 100],
    } as const;

    const troopRange = troopPercentRangeByDifficulty[difficulty];
    const tileRange = tilePercentRangeByDifficulty[difficulty];

    const playerOutgoingTroops = this.player
      .outgoingAttacks()
      .reduce((sum, attack) => sum + attack.troops(), 0);
    const otherOutgoingTroops = otherPlayer
      .outgoingAttacks()
      .reduce((sum, attack) => sum + attack.troops(), 0);
    const playerTotalTroops = this.player.troops() + playerOutgoingTroops;
    const otherTotalTroops = otherPlayer.troops() + otherOutgoingTroops;

    const troopThreshold =
      playerTotalTroops *
      (this.random.nextInt(troopRange[0], troopRange[1]) / 100);
    const tileThreshold =
      this.player.numTilesOwned() *
      (this.random.nextInt(tileRange[0], tileRange[1]) / 100);

    const hasComparableTroops = otherTotalTroops > troopThreshold;
    const hasComparableTiles =
      otherPlayer.numTilesOwned() > tileThreshold &&
      otherTotalTroops > playerTotalTroops * 0.5;
    return hasComparableTroops || hasComparableTiles;
  }

  // juiciestAlly comes from findJuiciestAlly(borderingFriends) - callers looping
  // over borderingFriends should compute it once, not on every call
  maybeBetray(
    otherPlayer: Player,
    juiciestAlly: Player | null,
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ): boolean {
    if (!this.player.isAlliedWith(otherPlayer)) return false;

    const { difficulty } = this.game.config().gameConfig();

    // Betray our juiciest ally (e.g. a MIRVed one), if it's safe to do so (everybody around us is weak)
    if (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      juiciestAlly === otherPlayer &&
      this.isSafeToBetray(otherPlayer, borderingFriends, borderingEnemies)
    ) {
      this.betray(otherPlayer);
      return true;
    }

    // Betray very weak players (similar check as above but for the easier difficulties)
    // This doesn't check for maxTroops and isn't really smart. It makes nations vulnerable, but that's intended.
    // On easy, don't betray humans
    if (
      (difficulty === Difficulty.Easy || difficulty === Difficulty.Medium) &&
      !(
        difficulty === Difficulty.Easy &&
        otherPlayer.type() === PlayerType.Human
      ) &&
      this.player.troops() >= otherPlayer.troops() * 10
    ) {
      this.betray(otherPlayer);
      return true;
    }

    // Betray traitors who aren't significantly stronger than us
    if (
      difficulty !== Difficulty.Easy &&
      otherPlayer.isTraitor() &&
      otherPlayer.troops() < this.player.troops() * 1.2
    ) {
      this.betray(otherPlayer);
      return true;
    }

    // Betray our only bordering player if we are much stronger than them
    if (
      difficulty !== Difficulty.Easy &&
      borderingFriends.length + borderingEnemies.length === 1 &&
      otherPlayer.troops() * 3 < this.player.troops()
    ) {
      this.betray(otherPlayer);
      return true;
    }

    return false;
  }

  // Juiciest ally regardless of strength; isSafeToBetray() rejects the too-strong ones
  findJuiciestAlly(borderingFriends: Player[]): Player | null {
    const candidates = borderingFriends.filter((friend) =>
      this.player.isAlliedWith(friend),
    );
    return findJuiciestTarget(this.game, candidates);
  }

  // Safe if target + non-allied neighbors + (unless target's already a traitor,
  // since betraying them wouldn't make us one) our other allies stay under a third of our troops
  private isSafeToBetray(
    target: Player,
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ): boolean {
    const otherAllies = target.isTraitor()
      ? []
      : borderingFriends.filter(
          (f) => f !== target && this.player.isAlliedWith(f),
        );
    const threats = [target, ...borderingEnemies, ...otherAllies];
    const nearbyThreatTroops = threats.reduce((sum, threat) => {
      const outgoing = threat
        .outgoingAttacks()
        .reduce((s, attack) => s + attack.troops(), 0);
      return sum + threat.troops() + outgoing;
    }, 0);
    return nearbyThreatTroops < this.player.troops() * 0.33;
  }

  private betray(target: Player): void {
    const alliance = this.player.allianceWith(target);
    if (!alliance) return;
    this.player.breakAlliance(alliance);
  }
}
