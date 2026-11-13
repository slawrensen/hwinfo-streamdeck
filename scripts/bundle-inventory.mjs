// The bundle gate (scripts/lib/bundle-inventory.mjs) on the built plugin:
// re-runs the production rollup configuration in memory, proves the result
// is byte for byte the bin/plugin.js on disk (so the inventory describes
// the shipped bytes, not a fresh guess), prints the rendered bytes per npm
// package, and fails on zod or on any package NOTICE.md does not cover.
//
//   node scripts/bundle-inventory.mjs [--out <inventory.json>]
//
// Run it after `npm run build`; CI and release:validate do.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_PACKAGES, generateBundle, inventoryProblems, summarize } from "./lib/bundle-inventory.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const outPath = outAt >= 0 && args[outAt + 1] ? path.resolve(args[outAt + 1]) : null;
const pluginJs = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin", "bin", "plugin.js");

if (!fs.existsSync(pluginJs)) {
	console.error("bundle-inventory: bin/plugin.js not found; run `npm run build` first.");
	process.exit(1);
}
const shipped = createHash("sha256").update(fs.readFileSync(pluginJs)).digest("hex");
const bundle = await generateBundle(repoRoot);
const summary = summarize(bundle.modules, repoRoot);
const problems = inventoryProblems(summary);
if (bundle.sha256 !== shipped) problems.unshift(`the production rollup configuration renders ${bundle.sha256.slice(0, 12)}, bin/plugin.js is ${shipped.slice(0, 12)}: the bundle on disk is stale or was not built from this tree; run \`npm run build\``);

console.log(`bin/plugin.js ${shipped}${bundle.sha256 === shipped ? " (the in-memory build matches)" : ""}`);
console.log("rendered bytes per package:");
for (const [name, bytes] of Object.entries(summary.packages)) console.log(`  ${name.padEnd(20)} ${String(bytes).padStart(8)}${Object.hasOwn(BUNDLED_PACKAGES, name) ? "" : "  NOT IN NOTICE.md"}`);
console.log(`  ${"(this repository)".padEnd(20)} ${String(summary.firstParty).padStart(8)}`);
console.log(`  ${"(rollup helpers)".padEnd(20)} ${String(summary.generated).padStart(8)}`);
if (outPath !== null) fs.writeFileSync(outPath, `${JSON.stringify({ pluginJsSha256: shipped, generatedSha256: bundle.sha256, ...summary, allowed: Object.keys(BUNDLED_PACKAGES), problems }, null, "\t")}\n`);
if (problems.length > 0) {
	console.error(`BUNDLE INVENTORY: ${problems.length} failure(s)`);
	for (const problem of problems) console.error(`  ${problem}`);
	process.exit(1);
}
console.log(`BUNDLE INVENTORY: OK (${Object.keys(summary.packages).join(", ")}; no zod)`);
