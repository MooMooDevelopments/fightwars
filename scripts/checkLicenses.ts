/**
 * Dependency licence gate (FightWars).
 *
 * FightWars is AGPL-3.0. Every package we ship in the client bundle or run
 * on the server must be under a licence the AGPL can combine with. This
 * script walks node_modules for the production dependency tree (dev
 * dependencies are tooling and never ship) and fails on anything outside
 * the allowlist, so CI catches an incompatible package the day it is added.
 *
 * Usage:  npx tsx scripts/checkLicenses.ts [--all]   (--all includes devDependencies)
 * Exit code 1 on any disallowed or unknown licence.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// SPDX identifiers the AGPL-3.0 can be combined with. Add to this list only
// with a one-line reason in FORK-CHANGES.md.
const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Apache-2.0",
  "CC0-1.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "Zlib",
  "WTFPL",
  "MPL-2.0",
  "LGPL-2.1",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-or-later",
  "GPL-2.0-or-later",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
]);

// Packages whose package.json carries a non-standard licence string that we
// have verified by hand. Key: name, value: the reason.
const VERIFIED: Record<string, string> = {};

interface Pkg {
  name: string;
  version: string;
  license: string;
  dir: string;
}

function readPkg(dir: string): Pkg | null {
  const file = path.join(dir, "package.json");
  if (!fs.existsSync(file)) return null;
  const json = JSON.parse(fs.readFileSync(file, "utf8")) as {
    name?: string;
    version?: string;
    license?: string | { type?: string };
    licenses?: { type?: string }[];
  };
  let license = "";
  if (typeof json.license === "string") license = json.license;
  else if (json.license && typeof json.license === "object")
    license = json.license.type ?? "";
  else if (Array.isArray(json.licenses))
    license = json.licenses.map((l) => l.type ?? "").join(" OR ");
  return {
    name: json.name ?? path.basename(dir),
    version: json.version ?? "?",
    license,
    dir,
  };
}

function resolveDep(name: string, from: string): string | null {
  // Walk up node_modules directories the way Node does.
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** True when an SPDX expression is satisfied by the allowlist. */
function allowed(expr: string): boolean {
  const e = expr.trim().replace(/^\(|\)$/g, "");
  if (e === "") return false;
  if (e.includes(" OR ")) return e.split(" OR ").some((p) => allowed(p));
  if (e.includes(" AND ")) return e.split(" AND ").every((p) => allowed(p));
  return ALLOWED.has(e.replace(/\+$/, "-or-later"));
}

function main(): void {
  const includeDev = process.argv.includes("--all");
  const rootJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const roots = Object.keys({
    ...(rootJson.dependencies ?? {}),
    ...(includeDev ? (rootJson.devDependencies ?? {}) : {}),
  });

  const seen = new Map<string, Pkg>();
  const queue: { name: string; from: string }[] = roots.map((name) => ({
    name,
    from: ROOT,
  }));
  const missing: string[] = [];
  while (queue.length > 0) {
    const { name, from } = queue.shift()!;
    const dir = resolveDep(name, from);
    if (dir === null) {
      missing.push(name);
      continue;
    }
    if (seen.has(dir)) continue;
    const pkg = readPkg(dir);
    if (pkg === null) continue;
    seen.set(dir, pkg);
    const json = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dep of Object.keys({
      ...(json.dependencies ?? {}),
      ...(json.optionalDependencies ?? {}),
    })) {
      queue.push({ name: dep, from: dir });
    }
  }

  const bad: Pkg[] = [];
  for (const pkg of seen.values()) {
    if (pkg.name in VERIFIED) continue;
    if (!allowed(pkg.license)) bad.push(pkg);
  }

  console.log(
    `Checked ${seen.size} packages (${includeDev ? "prod + dev" : "prod"}).`,
  );
  if (missing.length > 0) {
    console.log(
      `Not installed (skipped, likely optional): ${missing.sort().join(", ")}`,
    );
  }
  if (bad.length > 0) {
    console.error(
      `\n${bad.length} package(s) with a disallowed or unknown licence:`,
    );
    for (const p of bad.sort((a, b) => a.name.localeCompare(b.name))) {
      console.error(
        `  ${p.name}@${p.version}  licence="${p.license || "(none)"}"  ${path.relative(ROOT, p.dir)}`,
      );
    }
    console.error(
      "\nEither replace the package, or (after reading its licence) add it to " +
        "VERIFIED in scripts/checkLicenses.ts with a reason.",
    );
    process.exit(1);
  }
  console.log("All licences are AGPL-3.0-compatible.");
}

main();
