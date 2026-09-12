/**
 * Performance gate (FightWars).
 *
 * Runs the headless full-game harness (tests/perf/fullgame/FullGamePerf.ts)
 * on the world map with 150 bots and fails when the per-tick simulation
 * cost crosses the budgets below. The budgets are set from the numbers
 * measured on the upstream baseline (BUILD-STATE.md) with headroom for a
 * slower CI runner; tighten them as the sim gets faster, never loosen them
 * without a line in FORK-CHANGES.md.
 *
 * Usage: npx tsx scripts/perfGate.ts [--ticks 1000] [--bots 150] [--map world]
 */
import { spawnSync } from "node:child_process";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const HARNESS = path.join(ROOT, "tests", "perf", "fullgame", "FullGamePerf.ts");

// Budgets in milliseconds of sim time per tick. Baseline on a 2025 desktop:
// mean 2.89, p95 5.90, p99 8.11, max 10.4 (world, 150 bots, 1000 ticks).
const BUDGET = {
  meanMs: 8,
  p95Ms: 20,
  p99Ms: 40,
  overBudgetTicks: 0, // ticks over the 100 ms turn budget
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined
    ? process.argv[i + 1]
    : fallback;
}

function main(): void {
  const args = [
    HARNESS,
    "--map",
    arg("--map", "world"),
    "--bots",
    arg("--bots", "150"),
    "--ticks",
    arg("--ticks", "1000"),
    "--seed",
    "perf-gate",
    "--no-cpu-profile",
    "--no-exec-profile",
    "--no-gc-profile",
    "--no-alloc-profile",
  ];
  const run = spawnSync(process.execPath, [TSX, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  const out = `${run.stdout}\n${run.stderr}`;
  if (run.status !== 0) {
    console.error(out);
    console.error(`perf harness exited with ${run.status}`);
    process.exit(1);
  }

  const num = (re: RegExp): number => {
    const m = out.match(re);
    if (!m) throw new Error(`could not find ${re} in harness output:\n${out}`);
    return parseFloat(m[1]);
  };
  const mean = num(/mean ([\d.]+)ms/);
  const p95 = num(/p95 ([\d.]+)ms/);
  const p99 = num(/p99 ([\d.]+)ms/);
  const over = num(/Over \d+ms budget: (\d+) \/ \d+ ticks/);
  const hash = out.match(/Final hash:\s+(\S+)/)?.[1] ?? "n/a";

  console.log(
    `perf gate: mean ${mean} ms (≤ ${BUDGET.meanMs}), p95 ${p95} ms (≤ ${BUDGET.p95Ms}), ` +
      `p99 ${p99} ms (≤ ${BUDGET.p99Ms}), over-budget ticks ${over} (≤ ${BUDGET.overBudgetTicks}), ` +
      `final hash ${hash}`,
  );
  const failures: string[] = [];
  if (mean > BUDGET.meanMs) failures.push(`mean ${mean} > ${BUDGET.meanMs}`);
  if (p95 > BUDGET.p95Ms) failures.push(`p95 ${p95} > ${BUDGET.p95Ms}`);
  if (p99 > BUDGET.p99Ms) failures.push(`p99 ${p99} > ${BUDGET.p99Ms}`);
  if (over > BUDGET.overBudgetTicks)
    failures.push(`${over} ticks over the turn budget`);
  if (failures.length > 0) {
    console.error(`PERF REGRESSION: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("perf gate passed");
}

main();
