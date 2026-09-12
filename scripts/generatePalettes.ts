/**
 * Generates the player-colour palettes in src/client/render/gl/*-theme.json.
 *
 * Run with `npm run palettes:generate`. The output is committed; this script
 * is not part of the build. Palettes are data, and data that ships should be
 * reviewable in a diff — a reviewer can see a colour change, and the client
 * pays nothing at boot.
 *
 * Method
 * ------
 * Farthest-point sampling over an OKLCH lattice. Starting from one seed, each
 * subsequent colour is the candidate whose nearest already-chosen neighbour is
 * furthest away, measured in CIEDE2000. That maximises the smallest pairwise
 * difference greedily, and it produces a *sequence*: every prefix is itself
 * well spread, so the pool's first 40 colours (a typical lobby) are further
 * apart than its first 128 (a full one), and the tail can serve as the
 * overflow tier without a second search.
 *
 * Two bands, one decision: human players and AI nations are drawn from
 * separate regions of colour space, so a glance at the map separates people
 * from scenery before any label is read. Which axis carries that split
 * depends on the viewer — see SPLITS. Humans are sampled first and nations are
 * sampled with the human colours already seeded, so no nation lands next to a
 * player's colour.
 *
 * For the three colourblind palettes every distance is measured *after*
 * simulating that dichromacy. Simulation is a projection, so it can only pull
 * colours together: anything distinct under the simulation is also distinct to
 * unimpaired vision, and no second constraint is needed.
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { Lab, deltaE2000, rgbToLab } from "../src/client/theme/DeltaE";
import {
  Oklch,
  Vision,
  hexToRgb,
  isInSrgbGamut,
  oklchToHex,
  oklchToRgb,
  simulateVision,
} from "../src/client/theme/Oklch";

const THEME_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "src",
  "client",
  "render",
  "gl",
);

/** How many colours each pool holds before the overflow tier begins. */
const HUMAN_COUNT = 128;
const NATION_COUNT = 128;
/** Overflow tier, shared by both pools once they are exhausted. */
const FALLBACK_COUNT = 128;

/** The OKLCH lattice every palette is sampled from. */
const LATTICE = {
  lightness: { min: 0.2, max: 0.96, step: 0.02 },
  chroma: { min: 0, max: 0.32, step: 0.02 },
  hueStep: 3,
};

/**
 * Players are prominent, AI nations recede — one glance separates people from
 * scenery before any label is read.
 *
 * Which axis carries that split depends on the viewer, and the threshold is
 * applied to the colour *as that viewer sees it*, never to the OKLCH value it
 * was generated from. That distinction is the whole point: protanopia darkens
 * reds heavily, so a nominally bright red lands darker on a protanope's
 * retina than a nominally dark blue, and a band defined on source lightness
 * would promise a separation the player never receives.
 *
 * For unimpaired vision the split is chroma: players saturated, nations
 * washed out, both free to use the whole hue circle. A dichromat cannot read
 * that — the lost axis pulls saturated and washed-out colours together — so
 * those palettes split on lightness instead, which every dichromacy leaves
 * intact. The gap between the two thresholds is deliberate headroom: it keeps
 * the quietest player colour clear of the loudest nation one.
 */
interface Split {
  /** Which Lab property of the simulated colour the bands are cut on. */
  axis: "chroma" | "lightness";
  /** A player colour must sit at or above this. */
  humanMin: number;
  /** A nation colour must sit at or below this. */
  nationMax: number;
}

const SPLITS: Record<Vision, Split> = {
  normal: { axis: "chroma", humanMin: 45, nationMax: 30 },
  deuteranopia: { axis: "lightness", humanMin: 56, nationMax: 50 },
  protanopia: { axis: "lightness", humanMin: 56, nationMax: 50 },
  tritanopia: { axis: "lightness", humanMin: 56, nationMax: 50 },
};

/**
 * Colours a player colour must never be mistaken for. Tribes render in a flat
 * neutral grey and have to stay readable as "not a player" at a glance, so
 * every candidate within RESERVED_MARGIN of one is dropped before sampling
 * begins — a seed would only push the early picks away, and it is the 128th
 * that would land on the grey.
 */
const RESERVED = ["#d1cdc7"];
const RESERVED_MARGIN = 11;

interface Candidate {
  hex: string;
  /** Lab of the colour as the target viewer sees it. */
  lab: Lab;
}

/** The reserved colours as a given viewer sees them, computed once each. */
const reservedLabCache = new Map<Vision, Lab[]>();
function reservedLabs(vision: Vision): Lab[] {
  let labs = reservedLabCache.get(vision);
  if (labs === undefined) {
    labs = RESERVED.map((hex) =>
      rgbToLab(simulateVision(hexToRgb(hex), vision)),
    );
    reservedLabCache.set(vision, labs);
  }
  return labs;
}

/** Every in-gamut lattice point, as the given viewer sees it. */
function candidates(vision: Vision): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const { lightness: l, chroma: c } = LATTICE;
  for (let li = 0; l.min + li * l.step <= l.max + 1e-9; li++) {
    for (let ci = 0; c.min + ci * c.step <= c.max + 1e-9; ci++) {
      for (let h = 0; h < 360; h += LATTICE.hueStep) {
        const color: Oklch = {
          l: l.min + li * l.step,
          c: c.min + ci * c.step,
          h,
        };
        // Skip out-of-gamut points rather than letting oklchToRgb pull their
        // chroma in: mapped points pile up on the gamut boundary and would
        // give the sampler many near-duplicate candidates.
        if (!isInSrgbGamut(color)) continue;
        const hex = oklchToHex(color);
        if (seen.has(hex)) continue;
        seen.add(hex);
        const lab = rgbToLab(simulateVision(oklchToRgb(color), vision));
        if (
          reservedLabs(vision).some(
            (reserved) => deltaE2000(lab, reserved) < RESERVED_MARGIN,
          )
        ) {
          continue;
        }
        out.push({ hex, lab });
      }
    }
  }
  return out;
}

/**
 * Pick `count` colours from `pool`, each as far as possible from every colour
 * already picked (including anything in `seeded`). Returns the picks in
 * selection order together with the smallest pairwise distance of the result.
 */
function farthestPointSample(
  pool: Candidate[],
  count: number,
  seeded: Candidate[],
): { picks: Candidate[]; minDeltaE: number } {
  const remaining = pool.filter(
    (candidate) => !seeded.some((s) => s.hex === candidate.hex),
  );
  // nearest[i] = distance from remaining[i] to the closest chosen colour.
  const nearest = new Array<number>(remaining.length).fill(Infinity);

  const absorb = (chosen: Candidate) => {
    for (let i = 0; i < remaining.length; i++) {
      const d = deltaE2000(remaining[i].lab, chosen.lab);
      if (d < nearest[i]) nearest[i] = d;
    }
  };
  for (const seed of seeded) absorb(seed);

  const picks: Candidate[] = [];
  let worst = Infinity;

  for (let n = 0; n < count; n++) {
    let bestIndex = -1;
    if (picks.length === 0 && seeded.length === 0) {
      // Deterministic, and a reasonable first move: the most chromatic point
      // of the band, which anchors the sequence at a corner rather than the
      // middle where the second pick would be arbitrary.
      let bestChroma = -1;
      for (let i = 0; i < remaining.length; i++) {
        const chroma = Math.hypot(remaining[i].lab.a, remaining[i].lab.b);
        if (chroma > bestChroma) {
          bestChroma = chroma;
          bestIndex = i;
        }
      }
    } else {
      let best = -1;
      for (let i = 0; i < remaining.length; i++) {
        if (nearest[i] > best) {
          best = nearest[i];
          bestIndex = i;
        }
      }
      worst = Math.min(worst, best);
    }
    const chosen = remaining[bestIndex];
    picks.push(chosen);
    // Remove by swapping the tail in; order of `remaining` is irrelevant.
    remaining[bestIndex] = remaining[remaining.length - 1];
    nearest[bestIndex] = nearest[nearest.length - 1];
    remaining.pop();
    nearest.pop();
    absorb(chosen);
  }

  return { picks, minDeltaE: worst };
}

/** The candidates a viewer would read as a player colour / as a nation one. */
function split(
  pool: Candidate[],
  vision: Vision,
): {
  human: Candidate[];
  nation: Candidate[];
} {
  const { axis, humanMin, nationMax } = SPLITS[vision];
  const value = (candidate: Candidate) =>
    axis === "chroma"
      ? Math.hypot(candidate.lab.a, candidate.lab.b)
      : candidate.lab.l;
  return {
    human: pool.filter((candidate) => value(candidate) >= humanMin),
    nation: pool.filter((candidate) => value(candidate) <= nationMax),
  };
}

/** Smallest pairwise CIEDE2000 within a set, as the viewer sees it. */
function minPairwise(colors: Candidate[]): number {
  let min = Infinity;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      min = Math.min(min, deltaE2000(colors[i].lab, colors[j].lab));
    }
  }
  return min;
}

/**
 * Team colours: seven well-separated vivid colours, then matched to the team
 * names by hue so "Red" stays the reddest of them. Separation comes first —
 * a team colour nobody can tell apart from another team's is worse than one
 * whose name is approximate.
 */
const TEAM_HUE_ORDER: Record<string, number> = {
  Red: 27,
  Orange: 55,
  Yellow: 95,
  Green: 145,
  Teal: 185,
  Blue: 260,
  Purple: 320,
};

function teamColors(vision: Vision): Record<string, string> {
  const pool = split(candidates(vision), vision).human;
  const names = Object.keys(TEAM_HUE_ORDER);
  const { picks } = farthestPointSample(pool, names.length, []);

  // Assign by hue: each name takes the nearest unused pick on the hue circle.
  const unused = picks.map((pick) => ({
    hex: pick.hex,
    hue: (Math.atan2(pick.lab.b, pick.lab.a) * 180) / Math.PI,
  }));
  const out: Record<string, string> = {};
  for (const name of names) {
    const want = TEAM_HUE_ORDER[name];
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < unused.length; i++) {
      const raw = Math.abs(((unused[i].hue - want + 540) % 360) - 180);
      const dist = 180 - raw;
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }
    out[name] = unused[bestIndex].hex;
    unused.splice(bestIndex, 1);
  }

  // Tribes are deliberately colourless, and the two single-team modes reuse
  // the Blue/Red identities rather than inventing more.
  out.Bot = "#d1cdc7";
  out.Humans = out.Blue;
  out.Nations = out.Red;
  return out;
}

interface PaletteSpec {
  file: string;
  vision: Vision;
  borderDarken: number;
  borderLightnessScale: number;
}

const PALETTES: PaletteSpec[] = [
  {
    file: "default-theme.json",
    vision: "normal",
    borderDarken: 0.125,
    borderLightnessScale: 1,
  },
  // Dichromat palettes darken borders proportionally rather than absolutely,
  // so a dark fill's border does not collapse into the fill.
  {
    file: "deuteranopia-theme.json",
    vision: "deuteranopia",
    borderDarken: 0,
    borderLightnessScale: 0.6,
  },
  {
    file: "protanopia-theme.json",
    vision: "protanopia",
    borderDarken: 0,
    borderLightnessScale: 0.6,
  },
  {
    file: "tritanopia-theme.json",
    vision: "tritanopia",
    borderDarken: 0,
    borderLightnessScale: 0.6,
  },
];

function generate(spec: PaletteSpec): void {
  const { human: vivid, nation: muted } = split(
    candidates(spec.vision),
    spec.vision,
  );

  const humans = farthestPointSample(vivid, HUMAN_COUNT, []);
  // Nations avoid every human colour as well as each other.
  const nations = farthestPointSample(muted, NATION_COUNT, humans.picks);
  // The overflow tier continues from everything already handed out.
  const fallback = farthestPointSample(vivid, FALLBACK_COUNT, [
    ...humans.picks,
    ...nations.picks,
  ]);

  const teams = teamColors(spec.vision);
  const teamSet = Object.entries(teams)
    .filter(
      ([name]) => name !== "Bot" && name !== "Humans" && name !== "Nations",
    )
    .map(([, hex]) => hex);

  const theme = {
    vision: spec.vision,
    teamColors: teams,
    humanColors: humans.picks.map((p) => p.hex),
    nationColors: nations.picks.map((p) => p.hex),
    fallbackColors: fallback.picks.map((p) => p.hex),
    borderDarken: spec.borderDarken,
    borderLightnessScale: spec.borderLightnessScale,
    defendedBorderDarkenLight: 0.2,
    defendedBorderDarkenDark: 0.4,
    structureContrastTarget: 0.5,
    focusedBorderColor: "#e6e6e6",
    spawnHighlightColor: "#ffd54f",
  };

  writeFileSync(
    join(THEME_DIR, spec.file),
    JSON.stringify(theme, null, 2) + "\n",
    "utf8",
  );

  const all = [...humans.picks, ...nations.picks];
  const first120 = all.slice(0, 120);
  const teamCandidates = teamSet.map((hex) => ({
    hex,
    lab: rgbToLab(
      simulateVision(
        {
          r: parseInt(hex.slice(1, 3), 16),
          g: parseInt(hex.slice(3, 5), 16),
          b: parseInt(hex.slice(5, 7), 16),
        },
        spec.vision,
      ),
    ),
  }));

  console.log(
    [
      spec.file.padEnd(26),
      `humans ${humans.picks.length}`,
      `nations ${nations.picks.length}`,
      `fallback ${fallback.picks.length}`,
      `minΔE(first 120) ${minPairwise(first120).toFixed(2)}`,
      `minΔE(all ${all.length}) ${minPairwise(all).toFixed(2)}`,
      `minΔE(teams) ${minPairwise(teamCandidates).toFixed(2)}`,
    ].join("  "),
  );
}

for (const spec of PALETTES) generate(spec);
