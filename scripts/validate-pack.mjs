// The packed-archive gate: holds release/com.lawrensen.hwinfo.streamDeckPlugin
// (or the archive named as the first argument) to scripts/lib/pack-contract.mjs
// and to the staging directory it was packed from. Runs at the end of
// `npm run pack` (scripts/pack.mjs), so the release workflow's pack step
// carries it; run it by hand to re-check any archive:
//   node scripts/validate-pack.mjs [archive] [stagingDir]
// Read-only. Exits 1 with one line per failure.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack } from "./lib/pack-validation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archivePath = path.resolve(process.argv[2] ?? path.join(repoRoot, "release", "com.lawrensen.hwinfo.streamDeckPlugin"));
const stagingDir = path.resolve(process.argv[3] ?? path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin"));

if (!fs.existsSync(archivePath)) {
	console.error(`validate-pack: ${path.relative(repoRoot, archivePath)} not found; run \`npm run pack\` first.`);
	process.exit(1);
}
const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
const { failures, members, payload } = validatePack({ archiveBytes: fs.readFileSync(archivePath), stagingDir, packageVersion });
if (failures.length > 0) {
	console.error(`PACK VALIDATION: ${failures.length} failure(s) in ${path.relative(repoRoot, archivePath)}`);
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
console.log(`PACK VALIDATION: OK (${members} members match the shipping contract and the staged build)`);
console.log(`  bin/plugin.js ${payload.get("bin/plugin.js")}`);
console.log(`  bin/hwsm.node ${payload.get("bin/hwsm.node")}`);
