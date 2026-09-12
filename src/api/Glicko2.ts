/**
 * Glicko-2 (Glickman, 2012 — http://www.glicko.net/glicko/glicko2.pdf).
 *
 * Pure functions, no I/O. One rating period per match: a player's results
 * against every opponent in that match are folded into a single update,
 * exactly as the paper's Step 3–8 describe. Constants follow the paper's
 * recommendations; the system constant tau = 0.5 damps volatility swings
 * on a ladder where most matches are many-player FFAs.
 */

export interface Rating {
  rating: number;
  rd: number;
  volatility: number;
}

export interface Result {
  opponent: Rating;
  /** 1 win, 0.5 draw, 0 loss. */
  score: number;
}

export const DEFAULT_RATING: Rating = {
  rating: 1500,
  rd: 350,
  volatility: 0.06,
};

const SCALE = 173.7178;
const TAU = 0.5;
const EPS = 0.000001;

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function E(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Update `player` with the results of one rating period. An empty result
 * list only inflates RD (Step 6, the "did not compete" case).
 */
export function updateRating(player: Rating, results: Result[]): Rating {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  if (results.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: phiStar * SCALE, volatility: sigma };
  }

  // Step 3: estimated variance v; Step 4: estimated improvement delta.
  let vInv = 0;
  let deltaSum = 0;
  for (const r of results) {
    const muJ = (r.opponent.rating - 1500) / SCALE;
    const phiJ = r.opponent.rd / SCALE;
    const gj = g(phiJ);
    const e = E(mu, muJ, phiJ);
    vInv += gj * gj * e * (1 - e);
    deltaSum += gj * (r.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5: new volatility by the illustrative iterative algorithm.
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  let guard = 0;
  while (Math.abs(B - A) > EPS && guard++ < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);

  // Step 6–7: new RD and rating.
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * deltaSum;

  return {
    rating: 1500 + SCALE * muNew,
    rd: SCALE * phiNew,
    volatility: sigmaNew,
  };
}

/**
 * Results for a many-player match, per player: the winner beats everyone,
 * every non-winner loses to the winner and draws with the other non-winners
 * (the record carries no finer placement than "won"). Team wins count each
 * winning-team member as a winner against each losing-team member.
 */
export function matchResults(
  players: { id: string; rating: Rating; won: boolean }[],
): Map<string, Result[]> {
  const out = new Map<string, Result[]>();
  for (const p of players) {
    const results: Result[] = [];
    for (const o of players) {
      if (o.id === p.id) continue;
      if (p.won && o.won) continue; // teammates: no result between them
      const score = p.won ? 1 : o.won ? 0 : 0.5;
      results.push({ opponent: o.rating, score });
    }
    out.set(p.id, results);
  }
  return out;
}
