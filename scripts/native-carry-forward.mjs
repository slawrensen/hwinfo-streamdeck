// The release build job's carry-forward step (scripts/lib/native-carry-forward.mjs
// says what it decides and why). Rewrites the staged unsigned build in
// place: a carried binary and the previous release's PDB take the place of
// this run's, which move to <dir>/rebuilt/ as evidence, and
// <dir>/carry-forward.json records every decision for native-manifest.mjs
// --carry-forward. A refusal changes nothing in <dir>.
//
//   node scripts/native-carry-forward.mjs --check-mode
//   node scripts/native-carry-forward.mjs --dir <native-unsigned> [--previous-dir <dir>]
//
// <native-unsigned> holds this run's binaries, their PDBs and its unsigned
// build manifest (release-native-manifest.json). <previous-dir> is what the
// workflow read from the previous public release: release.json ({ status:
// "read" | "none" | "unreadable", tag, reason, digestVerified: { asset:
// true when its bytes matched the digest GitHub records } }), and when
// read, that release's release-native-manifest.json, its pack and its
// PDBs. A carry rests only on assets digestVerified marks true. Without
// --previous-dir there is no previous release. NATIVE_CARRY_FORWARD (the
// repository variable) is "off" to ship every rebuild, unset or "on" to
// carry forward; --check-mode refuses any other value before anything is
// installed. Builtins only.
import fs from "node:fs";
import path from "node:path";
import { NATIVE_BINARIES } from "./lib/native-binaries.mjs";
import { carryForwardMode, carryForwardRecord, pdbNameOf, planCarryForward, renderCarryForwardMarkdown } from "./lib/native-carry-forward.mjs";
import { PLUGIN_ROOT, PLUGIN_UUID } from "./lib/pack-contract.mjs";
import { listZip, readZipEntry } from "./lib/zip.mjs";

const args = process.argv.slice(2);
const option = (name) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
const annotate = process.env.GITHUB_ACTIONS === "true";
const OFF_REMEDY = "Set the repository variable NATIVE_CARRY_FORWARD to off to ship this run's rebuild instead.";
const refuse = (lines) => {
	console.error("NATIVE CARRY-FORWARD: refused, nothing changed");
	for (const line of lines) console.error(`  ${line}`);
	process.exit(1);
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

const mode = carryForwardMode(process.env.NATIVE_CARRY_FORWARD);
if (mode === null) {
	console.error(`NATIVE_CARRY_FORWARD is ${JSON.stringify(process.env.NATIVE_CARRY_FORWARD)}; it must be "off", "on" or unset.`);
	process.exit(1);
}
if (args.includes("--check-mode")) {
	console.log(`native carry-forward: ${mode}`);
	process.exit(0);
}

const dirOption = option("--dir");
if (!dirOption) {
	console.error("usage: native-carry-forward.mjs --dir <native-unsigned> [--previous-dir <dir>] | --check-mode");
	process.exit(2);
}
const dir = path.resolve(dirOption);
const currentPath = path.join(dir, "release-native-manifest.json");
if (!fs.existsSync(currentPath)) refuse([`${currentPath} not found: the staged unsigned build must carry its manifest.`]);
const current = readJson(currentPath);
const rebuilt = new Map();
for (const binary of NATIVE_BINARIES) {
	const file = path.join(dir, binary.file);
	if (fs.existsSync(file)) rebuilt.set(binary.file, fs.readFileSync(file));
}

let previous = null;
let previousLabel = "the previous release";
const previousMembers = new Map();
const previousPdbs = new Map();
const previousVerified = new Set();
const previousDirOption = option("--previous-dir");
if (previousDirOption) {
	const previousDir = path.resolve(previousDirOption);
	const release = fs.existsSync(path.join(previousDir, "release.json")) ? readJson(path.join(previousDir, "release.json")) : { status: "unreadable", reason: "release.json is missing" };
	if (release.status === "unreadable" && mode === "on") {
		refuse([`The previous release could not be read (${release.reason ?? "no reason given"}), so whether a native binary carries forward cannot be decided. Run the release again, or ship this run's rebuild on purpose.`, OFF_REMEDY]);
	}
	if (release.status === "read") {
		previousLabel = typeof release.tag === "string" && release.tag !== "" ? release.tag : previousLabel;
		for (const [asset, verified] of Object.entries(release.digestVerified ?? {})) if (verified === true) previousVerified.add(asset);
		previous = readJson(path.join(previousDir, "release-native-manifest.json"));
		const packPath = path.join(previousDir, `${PLUGIN_UUID}.streamDeckPlugin`);
		if (fs.existsSync(packPath)) {
			const bytes = fs.readFileSync(packPath);
			const { entries, problems } = listZip(bytes);
			if (problems.length > 0) refuse([`${previousLabel}'s pack cannot be read: ${problems.join("; ")}`, OFF_REMEDY]);
			for (const binary of NATIVE_BINARIES) {
				const entry = entries.find((candidate) => candidate.name === `${PLUGIN_ROOT}/bin/${binary.file}`);
				if (entry) previousMembers.set(binary.file, readZipEntry(bytes, entry));
			}
		}
		for (const binary of NATIVE_BINARIES) {
			const pdb = path.join(previousDir, pdbNameOf(binary.file));
			if (fs.existsSync(pdb)) previousPdbs.set(pdbNameOf(binary.file), fs.readFileSync(pdb));
		}
	}
}

const plan = planCarryForward({ current, rebuilt, previous, previousLabel, previousMembers, previousPdbs, previousVerified, mode });
if (plan.problems.length > 0) refuse([...plan.problems, OFF_REMEDY]);

// Every check passed: rewrite <dir>. The rebuild moves aside first, so a
// carried file never overwrites the only copy of this run's build.
for (const decision of plan.decisions) {
	if (decision.decision !== "carried") continue;
	const pdbName = pdbNameOf(decision.file);
	const aside = path.join(dir, "rebuilt");
	fs.mkdirSync(aside, { recursive: true });
	fs.renameSync(path.join(dir, decision.file), path.join(aside, decision.file));
	if (fs.existsSync(path.join(dir, pdbName))) fs.renameSync(path.join(dir, pdbName), path.join(aside, pdbName));
	fs.writeFileSync(path.join(dir, decision.file), decision.bytes);
	fs.writeFileSync(path.join(dir, pdbName), decision.pdb);
}
fs.writeFileSync(path.join(dir, "carry-forward.json"), `${JSON.stringify(carryForwardRecord(plan, mode), null, "\t")}\n`);

const markdown = renderCarryForwardMarkdown(plan, mode);
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
for (const decision of plan.decisions) {
	if (decision.decision === "carried" && annotate) console.log(`::notice title=native binary carried forward::${decision.file} ships ${decision.record.sha256.slice(0, 12)} from ${decision.record.carriedFrom.firstShippedIn}; this run's rebuild ${decision.record.rebuiltSha256.slice(0, 12)} is kept as evidence`);
}
console.log(`NATIVE CARRY-FORWARD: ${plan.decisions.map((decision) => `${decision.file} ${decision.decision}`).join(", ")}`);
