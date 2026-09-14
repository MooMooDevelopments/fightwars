/**
 * Cold-load gate: reads the production build in static/ and fails when the
 * page's critical path would take longer than the budget on a 10 Mbps line,
 * or when the initial download with the largest map exceeds 90 MB.
 * `npm run coldload:gate`, after `npm run build-prod`. See coldLoadModel.ts.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import zlib from "zlib";
import {
  COLD_LOAD_BUDGET_SECONDS,
  criticalAssets,
  INITIAL_DOWNLOAD_BUDGET_BYTES,
  wireSeconds,
} from "./coldLoadModel";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const staticDir = path.join(root, "static");
const indexPath = path.join(staticDir, "index.html");
if (!fs.existsSync(indexPath)) {
  console.error(
    "cold-load gate: no static/index.html — run npm run build-prod",
  );
  process.exit(2);
}
const html = fs.readFileSync(indexPath, "utf8");
const gz = (buf: Buffer) => zlib.gzipSync(buf, { level: 6 }).length;

const files = criticalAssets(html).filter((u) => !/^https?:/.test(u));
const sizes = [gz(Buffer.from(html))];
const rows: string[] = [`index.html ${sizes[0]} gz`];
for (const u of files) {
  const p = path.join(staticDir, u.replace(/^\//, ""));
  if (!fs.existsSync(p)) {
    console.error(`cold-load gate: ${u} referenced by index.html is missing`);
    process.exit(1);
  }
  const size = gz(fs.readFileSync(p));
  sizes.push(size);
  rows.push(`${u} ${size} gz`);
}
const seconds = wireSeconds(sizes);

// The initial download: every asset the build emits plus the largest map.
const walk = (dir: string): number =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((a, e) => {
    const p = path.join(dir, e.name);
    return a + (e.isDirectory() ? walk(p) : fs.statSync(p).size);
  }, 0);
const assets = walk(path.join(staticDir, "assets"));
const maps = path.join(root, "resources", "maps");
let largest = { name: "", bytes: 0 };
for (const m of fs.readdirSync(maps)) {
  const dir = path.join(maps, m);
  if (!fs.statSync(dir).isDirectory()) continue;
  const bytes = walk(dir);
  if (bytes > largest.bytes) largest = { name: m, bytes };
}
const initial = sizes[0] + assets + largest.bytes;

console.log(rows.join("\n"));
console.log(
  `cold load: ${files.length} files, ${sizes.reduce((a, b) => a + b, 0)} gz bytes on the critical path, ${seconds.toFixed(2)} s modelled at 10 Mbps (budget ${COLD_LOAD_BUDGET_SECONDS} s)`,
);
console.log(
  `initial download: assets ${(assets / 1048576).toFixed(1)} MB + largest map ${largest.name} ${(largest.bytes / 1048576).toFixed(1)} MB = ${(initial / 1048576).toFixed(1)} MB (budget ${INITIAL_DOWNLOAD_BUDGET_BYTES / 1048576} MB)`,
);
let ok = true;
if (seconds > COLD_LOAD_BUDGET_SECONDS) {
  console.error("cold-load gate: over the cold-load budget");
  ok = false;
}
if (initial > INITIAL_DOWNLOAD_BUDGET_BYTES) {
  console.error("cold-load gate: over the initial-download budget");
  ok = false;
}
if (!ok) process.exit(1);
console.log("cold-load gate passed");
