/**
 * Writes the tunables registry as the versioned ruleset of record:
 * resources/rulesets/default.json. `npm run rules:export`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defaultRuleset } from "../src/core/configuration/Tunables";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "resources", "rulesets", "default.json");
fs.writeFileSync(out, JSON.stringify(defaultRuleset(), null, 2) + "\n");
console.log(`wrote ${out}`);
