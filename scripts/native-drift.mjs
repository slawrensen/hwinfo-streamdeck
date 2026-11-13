// Says how this build's native binaries moved against a previous release,
// and fails only when the bytes moved while no recorded input did.
//
//   node scripts/native-drift.mjs --previous <previous-manifest.json>
//        [--current release-native-manifest.json]
//        [--previous-pack <previous.streamDeckPlugin>] [--previous-binary <file.node>]...
//        [--previous-label v1.7.1] [--current-label <text>]
//
// Classes and their meaning are in scripts/lib/native-drift.mjs. The
// summary goes to stdout and, under GitHub Actions, to the job summary,
// with one annotation per binary that moved. Exit 1 only for
// "unexplained"; a missing previous manifest is a notice and exit 0 (the
// first release, or an API outage, must not block a release by itself).
// A previous release whose manifest has no toolchain record (1.7.1 and
// earlier) is explained from its binaries when --previous-pack or
// --previous-binary hands them in.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_MEMBERS, PLUGIN_ROOT } from "./lib/pack-contract.mjs";
import { classifyDrift, peFactsOf, renderDriftMarkdown } from "./lib/native-drift.mjs";
import { listZip, readZipEntry } from "./lib/zip.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
const options = (name) => args.flatMap((arg, i) => (arg === name && args[i + 1] !== undefined ? [args[i + 1]] : []));
const annotate = process.env.GITHUB_ACTIONS === "true";

const currentPath = path.resolve(option("--current") ?? path.join(repoRoot, "release-native-manifest.json"));
const previousPath = option("--previous") ? path.resolve(option("--previous")) : null;
if (!fs.existsSync(currentPath)) {
	console.error(`native-drift: ${currentPath} not found; run \`node scripts/native-manifest.mjs\` first.`);
	process.exit(1);
}
if (previousPath === null || !fs.existsSync(previousPath)) {
	const line = "no previous native manifest to compare with; drift not classified";
	console.log(annotate ? `::notice title=native drift check skipped::${line}` : line);
	process.exit(0);
}
const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
const previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));

const previousBinaries = new Map();
const previousPack = option("--previous-pack");
if (previousPack) {
	const bytes = fs.readFileSync(previousPack);
	const { entries, problems } = listZip(bytes);
	if (problems.length > 0) {
		console.error(`native-drift: the previous pack cannot be read: ${problems.join("; ")}`);
		process.exit(1);
	}
	for (const rel of NATIVE_MEMBERS) {
		const entry = entries.find((candidate) => candidate.name === `${PLUGIN_ROOT}/${rel}`);
		if (entry) previousBinaries.set(path.posix.basename(rel), readZipEntry(bytes, entry));
	}
}
for (const file of options("--previous-binary")) previousBinaries.set(path.basename(file), fs.readFileSync(file));

let previousPe;
try {
	previousPe = peFactsOf(previousBinaries);
} catch (err) {
	console.error(`native-drift: a previous binary could not be parsed: ${err.message}`);
	process.exit(1);
}
const report = classifyDrift({ previous, current, previousPe });
const markdown = renderDriftMarkdown(report, { previousLabel: option("--previous-label") ?? path.basename(previousPath), currentLabel: option("--current-label") ?? "this build" });
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
for (const result of report.results) {
	if (["identical", "source-changed", "new-binary"].includes(result.class)) continue;
	const level = result.class === "unexplained" ? "error" : "warning";
	const line = `${result.file} ${result.class}: ${result.reasons[0] ?? ""}`;
	if (annotate) console.log(`::${level} title=native bytes moved::${line}`);
}
if (report.failed) {
	console.error("NATIVE DRIFT: bytes moved with unchanged source and unchanged recorded inputs (unexplained); compare the two builds before publishing.");
	process.exit(1);
}
console.log(`NATIVE DRIFT: ${report.results.map((result) => `${result.file} ${result.class}`).join(", ")}`);
