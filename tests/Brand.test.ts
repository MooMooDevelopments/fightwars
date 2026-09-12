import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { BRAND } from "../src/brand/Brand";

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.join(REPO_ROOT, "src");
const BRAND_DIR = path.join(SRC_ROOT, "brand");

// i18n keys are frozen (other language files share them), so a key that
// happens to carry the upstream name is allowed where it is referenced. The
// VALUE behind it is brand-neutral in en.json.
const I18N_KEY_ALLOWLIST = ["win_modal.support_openfront"];

// Third-party ad / tracking hooks that upstream's index.html carried and
// FightWars must never ship.
const FORBIDDEN_IN_INDEX_HTML = [
  "playwire",
  "googletag",
  "introjava",
  "cloudflareinsights",
  "HgWESkOz",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

describe("Brand", () => {
  it("keeps the upstream copyright notice byte-identical (AGPL §7)", () => {
    expect(BRAND.upstream.copyright).toBe("© OpenFront and Contributors");
  });

  it("only names the upstream project through BRAND.upstream", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      if (file.startsWith(BRAND_DIR + path.sep)) continue;
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue; // binary asset
      }
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (!/openfront/i.test(line)) return;
        if (line.includes("BRAND.upstream")) return;
        if (I18N_KEY_ALLOWLIST.some((key) => line.includes(key))) return;
        offenders.push(
          `${path.relative(REPO_ROOT, file).replace(/\\/g, "/")}:${i + 1}: ${line.trim()}`,
        );
      });
    }
    expect(offenders).toEqual([]);
  });

  it("ships no ad or tracking code in index.html", () => {
    const html = readFileSync(path.join(REPO_ROOT, "index.html"), "utf8");
    const lower = html.toLowerCase();
    for (const needle of FORBIDDEN_IN_INDEX_HTML) {
      expect(lower, `index.html must not contain "${needle}"`).not.toContain(
        needle.toLowerCase(),
      );
    }
  });
});
