// Writes the toolchain record of the native build in this tree (see
// scripts/lib/native-toolchain.mjs) and compares it with the reviewed
// toolchain policy, native/toolchain-policy.json.
//
//   node scripts/native-toolchain.mjs [--out <file>] [--policy <file>] [--enforce]
//
// Run after `npm run build:native`. The record goes to --out (default
// native-toolchain.json at the repo root, gitignored) and a summary to
// stdout. A policy mismatch is a warning (a GitHub annotation under
// Actions) unless --enforce is given or the policy's own mode is
// "enforce"; then it exits 1 and prints the policy JSON that would match
// this build, which is the deliberate update path: a reviewed change to the
// policy file. The policy is record-only for now, so local builds (which
// use a different toolset than the release runner) only warn.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_BINARIES } from "./lib/native-binaries.mjs";
import { collectToolchain, comparePolicy } from "./lib/native-toolchain.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
const outPath = path.resolve(option("--out") ?? path.join(repoRoot, "native-toolchain.json"));
const policyPath = path.resolve(option("--policy") ?? path.join(repoRoot, "native", "toolchain-policy.json"));
const annotate = process.env.GITHUB_ACTIONS === "true";

let record;
try {
	record = collectToolchain({ repoRoot, binaries: NATIVE_BINARIES });
} catch (err) {
	console.error(`native-toolchain: ${err.message}`);
	process.exit(1);
}
fs.writeFileSync(outPath, `${JSON.stringify(record, null, "\t")}\n`);

console.log(`toolchain record -> ${path.relative(repoRoot, outPath) || outPath}`);
console.log(`  MSVC ${record.msvc.toolsVersion} (cl ${record.msvc.clFileVersion}, link ${record.msvc.linkFileVersion}), ${record.msvc.toolset}`);
console.log(`  Windows SDK ${record.windowsSdk.targetPlatformVersion} (servicing ${record.windowsSdk.servicingVersion ?? "unknown"})`);
console.log(`  Visual Studio ${record.vsInstance?.version ?? "unknown"}${record.runnerImage.version ? `, image ${record.runnerImage.os} ${record.runnerImage.version}` : ""}`);
console.log(`  Node headers ${record.nodeHeaders.version} (node.lib ${record.nodeHeaders.nodeLibSha256?.slice(0, 16) ?? "missing"}...), node-gyp ${record.nodeGyp.version}`);
for (const [file, binary] of Object.entries(record.binaries)) {
	console.log(`  ${file}: ${binary.inputs.length} recorded inputs, inputsDigest ${binary.inputsDigest.slice(0, 16)}...`);
}

if (!fs.existsSync(policyPath)) {
	console.log(`no toolchain policy at ${path.relative(repoRoot, policyPath)}; record only`);
	process.exit(0);
}
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const enforce = args.includes("--enforce") || policy.mode === "enforce";
const { mismatches, unpinned, suggested } = comparePolicy(record, policy);
if (unpinned.length > 0) console.log(`  not pinned by the policy yet: ${unpinned.join(", ")}`);
if (mismatches.length === 0) {
	console.log(`TOOLCHAIN POLICY: OK (${path.relative(repoRoot, policyPath)}, mode ${policy.mode ?? "unset"})`);
	process.exit(0);
}
for (const { field, expected, actual } of mismatches) {
	const line = `${field}: policy ${JSON.stringify(expected)}, this build ${JSON.stringify(actual)}`;
	if (annotate) console.log(`::${enforce ? "error" : "warning"} title=native toolchain differs from the policy::${line}`);
	console.log(`  ${line}`);
}
console.log(`TOOLCHAIN POLICY: ${mismatches.length} difference(s) from ${path.relative(repoRoot, policyPath)}${enforce ? "" : " (record-only: not a failure)"}`);
console.log("A policy that would describe this build (review before adopting it):");
console.log(JSON.stringify({ ...policy, ...suggested }, null, "\t"));
process.exit(enforce ? 1 : 0);
