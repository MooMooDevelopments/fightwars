/**
 * THE determinism gate (FightWars).
 *
 * Two independent processes run the same intent log through the real
 * simulation and must produce byte-identical state digests every
 * DETERMINISM_EVERY ticks. Any mismatch is a desync bug in src/core and
 * blocks every merge.
 *
 * Process A records: scripted humans issue real wire intents (spawn, attack,
 * boat, build, upgrade, alliance, embargo, donate, target, emoji, cancel,
 * break) against bots and nations, writing the intent log and a digest
 * stream. Processes B and C replay that log from scratch. The digest streams
 * are compared as strings.
 *
 * Two control tests prove the gate can fail: a different seed must produce a
 * different digest, and a replay with a single intent removed must diverge.
 *
 * Quick mode (default, runs under `npm test`, ~3.5 s per process):
 *   pangaea (1000x1000, 29 nations), 60 bots, 6 humans, 3000 ticks
 *   (5 minutes of game time).
 * Full mode (`npm run test:determinism:full`, ~1 min per process):
 *   world, 150 bots, 8 humans, 24000 ticks (a 40-minute match).
 *
 * Override with DETERMINISM_MAP / _BOTS / _HUMANS / _TICKS / _EVERY.
 */
import fs from "fs";
import { execFileSync } from "node:child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import type { RunOutput } from "./determinism/DeterminismRunner";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const RUNNER = path.join(ROOT, "tests", "determinism", "DeterminismRunner.ts");

const MAP = process.env.DETERMINISM_MAP ?? "pangaea";
const BOTS = Number(process.env.DETERMINISM_BOTS ?? 60);
const HUMANS = Number(process.env.DETERMINISM_HUMANS ?? 6);
const TICKS = Number(process.env.DETERMINISM_TICKS ?? 3000);
const EVERY = Number(process.env.DETERMINISM_EVERY ?? 100);
const SEED = process.env.DETERMINISM_SEED ?? "fightwars-det-1";

// A 40-minute world match takes a few minutes per process.
const TIMEOUT_MS = 30 * 60 * 1000;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-determinism-"));

function runProcess(args: string[]): void {
  execFileSync(process.execPath, [TSX, RUNNER, ...args], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "pipe"],
    maxBuffer: 64 << 20,
    env: { ...process.env },
  });
}

function record(name: string, seed: string, ticks: number): RunOutput {
  const log = path.join(workDir, `${name}.intents.json`);
  const out = path.join(workDir, `${name}.out.json`);
  runProcess([
    "--mode",
    "record",
    "--log",
    log,
    "--out",
    out,
    "--map",
    MAP,
    "--seed",
    seed,
    "--ticks",
    String(ticks),
    "--bots",
    String(BOTS),
    "--humans",
    String(HUMANS),
    "--every",
    String(EVERY),
  ]);
  return JSON.parse(fs.readFileSync(out, "utf8")) as RunOutput;
}

function replay(
  name: string,
  logName: string,
  extra: string[] = [],
): RunOutput {
  const log = path.join(workDir, `${logName}.intents.json`);
  const out = path.join(workDir, `${name}.out.json`);
  runProcess(["--mode", "replay", "--log", log, "--out", out, ...extra]);
  return JSON.parse(fs.readFileSync(out, "utf8")) as RunOutput;
}

function digestString(o: RunOutput): string {
  return o.digests
    .map((d) => `${d.tick}:${d.upstreamHash}:${d.digest}`)
    .join("\n");
}

describe("determinism", () => {
  let recorded: RunOutput;

  it(
    "two independent processes replaying one intent log produce byte-identical digests",
    () => {
      recorded = record("a", SEED, TICKS);
      const replayB = replay("b", "a");
      const replayC = replay("c", "a");

      // The run has to be a real game before the comparison means anything.
      expect(recorded.digests.length).toBeGreaterThanOrEqual(
        Math.floor(TICKS / EVERY),
      );
      expect(recorded.final.ticks).toBe(TICKS);
      expect(recorded.final.humans.filter((h) => h.spawned)).toHaveLength(
        HUMANS,
      );
      // Scripted humans attack constantly and never defend, so they may all
      // be dead by the end — but they must have held land along the way.
      expect(recorded.final.peakHumanTiles).toBeGreaterThan(0);
      expect(recorded.intentCount).toBeGreaterThan(HUMANS * 10);
      expect(Object.keys(recorded.intentTypes)).toEqual(
        expect.arrayContaining(["spawn", "attack", "build_unit"]),
      );
      // The live game's own hash must be flowing too.
      expect(
        recorded.digests[recorded.digests.length - 1].upstreamHash,
      ).not.toBeNull();

      expect(digestString(replayB)).toBe(digestString(recorded));
      expect(digestString(replayC)).toBe(digestString(recorded));
      expect(replayB.intentCount).toBe(recorded.intentCount);
    },
    TIMEOUT_MS,
  );

  it(
    "the digest changes over time and with the seed (the gate can fail)",
    () => {
      const shortTicks = Math.min(TICKS, 600);
      const other = record("d", `${SEED}-other`, shortTicks);
      const first = recorded.digests[0];
      const last = recorded.digests[recorded.digests.length - 1];
      expect(first.digest).not.toBe(last.digest);

      const at = other.digests[other.digests.length - 1];
      const same = recorded.digests.find((d) => d.tick === at.tick);
      expect(same).toBeDefined();
      expect(at.digest).not.toBe(same!.digest);
    },
    TIMEOUT_MS,
  );

  it(
    "a replay with one intent removed diverges (the comparison is sensitive)",
    () => {
      // Drop the first intent of a post-spawn turn that opens with an attack
      // (an emoji or a refused alliance request could legitimately leave the
      // state untouched; a committed attack cannot).
      const log = JSON.parse(
        fs.readFileSync(path.join(workDir, "a.intents.json"), "utf8"),
      ) as {
        turns: { turnNumber: number; intents: { type: string }[] }[];
      };
      // Spawn phase is 200 turns in a Private lobby; pick a turn after it.
      const turn = log.turns.find(
        (t) => t.turnNumber > 250 && t.intents[0]?.type === "attack",
      );
      expect(turn).toBeDefined();
      const tampered = replay("e", "a", [
        "--drop-intent-at",
        String(turn!.turnNumber),
      ]);
      expect(tampered.intentCount).toBe(recorded.intentCount - 1);
      expect(digestString(tampered)).not.toBe(digestString(recorded));
    },
    TIMEOUT_MS,
  );
});
