// The packed-archive gate: holds release/com.lawrensen.hwinfo.streamDeckPlugin
// (or the archive named as the first argument) to scripts/lib/pack-contract.mjs
// and to the staging directory it was packed from, and, when
// release-native-manifest.json exists (or --native-manifest or the
// HWSM_NATIVE_MANIFEST environment variable names one), its native members
// to the hashes that manifest records. Runs at the end of
// `npm run pack` (scripts/pack.mjs), so the release workflow's pack step
// carries it; run it by hand to re-check any archive:
//   node scripts/validate-pack.mjs [archive] [stagingDir] [--native-manifest <file>]
// Read-only. Exits 1 with one line per failure.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_MEMBERS } from "./lib/pack-contract.mjs";
import { nativeExpectationsFromManifest, validatePack } from "./lib/pack-validation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const manifestAt = args.indexOf("--native-manifest");
const manifestOption = manifestAt >= 0 ? args[manifestAt + 1] : process.env.HWSM_NATIVE_MANIFEST || undefined;
const positional = args.filter((_, i) => manifestAt < 0 || (i !== manifestAt && i !== manifestAt + 1));
const archivePath = path.resolve(positional[0] ?? path.join(repoRoot, "release", "com.lawrensen.hwinfo.streamDeckPlugin"));
const stagingDir = path.resolve(positional[1] ?? path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin"));
const manifestPath = path.resolve(manifestOption ?? path.join(repoRoot, "release-native-manifest.json"));
if (manifestOption !== undefined && !fs.existsSync(manifestPath)) {
	console.error(`validate-pack: native manifest ${manifestOption} not found.`);
	process.exit(1);
}
const expectedNative = fs.existsSync(manifestPath) ? nativeExpectationsFromManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8"))) : new Map();

if (!fs.existsSync(archivePath)) {
	console.error(`validate-pack: ${path.relative(repoRoot, archivePath)} not found; run \`npm run pack\` first.`);
	process.exit(1);
}
const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
const { failures, members, payload } = validatePack({ archiveBytes: fs.readFileSync(archivePath), stagingDir, packageVersion, expectedNative });
if (failures.length > 0) {
	console.error(`PACK VALIDATION: ${failures.length} failure(s) in ${path.relative(repoRoot, archivePath)}`);
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
console.log(`PACK VALIDATION: OK (${members} members match the shipping contract and the staged build)`);
console.log(`  bin/plugin.js ${payload.get("bin/plugin.js")}`);
for (const rel of NATIVE_MEMBERS) console.log(`  ${rel} ${payload.get(rel)}${expectedNative.has(rel) ? " (matches the native manifest)" : ""}`);
