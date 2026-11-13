// Vendors the native addons into the .sdPlugin bundle: every shipped binary
// in scripts/lib/native-binaries.mjs (hwsm.node, the shared-memory reader),
// each built by `npm run build:native`.
// N-API addons cannot be inlined by rollup; they ship in bin/ next to the
// bundled plugin.js, where the loaders' createRequire finds them.
//
// Every source is checked first (the hash it must have, when one is named,
// and its PE layout), and a refusal of any one leaves bin/ exactly as it
// was: nothing is written until every binary has passed.
//
// Replacement is careful because Windows locks a loaded .node until the
// owning process exits: identical bytes are skipped, changed bytes are
// staged to a temporary file in the destination directory, verified by
// hash, and swapped in with rename. A locked destination fails CLEANLY:
// that binary stays byte-identical, the temp file is removed, and the fix
// (stop the plugin) is printed. A half-written addon can never occur. Past
// the checks each binary is swapped on its own, so one that is loaded never
// blocks another's update, and the run fails if any one could not be
// replaced.
//
// The release workflow packs the exact bytes its build and sign jobs
// produced instead of a local build: <PREFIX>_VENDOR (HWSM_VENDOR) names
// the file to vendor for each binary, and
// <PREFIX>_VENDOR_SHA256 the SHA-256 it must have. A file that is not a PE
// image laid out the way a linker or signing leaves it, or whose hash
// differs, is refused before bin/ is touched. Vendoring is all or nothing:
// naming a file for some binaries and not others is refused, so a pack can
// never mix release bytes with a local build. Unset, every binary comes
// from build/Release exactly as before.
//
// Also stages the license/attribution files into the pack: `streamdeck pack`
// only bundles the .sdPlugin directory, so without these copies the MIT
// license and the REALiX non-affiliation disclosure would never reach
// installed users. All copies gitignored.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticodeStructureProblem } from "./lib/authenticode.mjs";
import { NATIVE_BINARIES, builtPath } from "./lib/native-binaries.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdPluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const destDir = path.join(sdPluginDir, "bin");

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Where each binary comes from: { path, expected, from } with `from` the
 * environment variable that named it, or null for build/Release. Exits on
 * a configuration that names a hash without a file, a malformed hash, or
 * a file for some binaries and not others. */
function sources() {
	const named = NATIVE_BINARIES.map((binary) => {
		const variable = `${binary.macroPrefix}_VENDOR`;
		const file = process.env[variable] || "";
		const expected = process.env[`${variable}_SHA256`] || "";
		if (file === "" && expected !== "") {
			console.error(`${variable}_SHA256 is set but ${variable} is not; name the file to vendor or unset both.`);
			process.exit(1);
		}
		if (expected !== "" && !/^[0-9a-f]{64}$/.test(expected)) {
			console.error(`${variable}_SHA256 must be 64 lowercase hex digits.`);
			process.exit(1);
		}
		return file === "" ? { binary, path: builtPath(repoRoot, binary), expected: null, from: null } : { binary, path: path.resolve(file), expected: expected || null, from: variable };
	});
	const vendored = named.filter((source) => source.from !== null);
	if (vendored.length > 0 && vendored.length < named.length) {
		console.error(`${vendored.map((source) => source.from).join(", ")} set but ${named.filter((source) => source.from === null).map((source) => `${source.binary.macroPrefix}_VENDOR`).join(", ")} not: vendor every native binary from the release files or none.`);
		process.exit(1);
	}
	return named;
}

const plan = sources();
const missing = plan.filter((source) => !fs.existsSync(source.path));
if (missing.length > 0) {
	if (missing.some((source) => source.from === null)) console.error(`Missing ${missing.map((source) => path.relative(repoRoot, source.path)).join(", ")}; run \`npm run build:native\` first (needs the MSVC build tools node-gyp expects).`);
	else console.error(`Missing ${missing.map((source) => `${source.path} (${source.from})`).join(", ")}.`);
	process.exit(1);
}

// Check every source before writing anything: a wrong hash or layout on
// the second binary must not leave the first one already swapped in.
const refusals = [];
for (const source of plan) {
	const bytes = fs.readFileSync(source.path);
	const origin = source.from === null ? "" : ` from ${source.from}`;
	source.hash = createHash("sha256").update(bytes).digest("hex");
	if (source.expected !== null && source.hash !== source.expected) {
		refusals.push(`${source.binary.file}${origin} is ${source.hash}, not the ${source.expected} ${source.from}_SHA256 names.`);
		continue;
	}
	const layoutProblem = authenticodeStructureProblem(bytes);
	if (layoutProblem !== null) refusals.push(`${source.binary.file}${origin} is not a native binary this plugin can ship (${layoutProblem}).`);
}
if (refusals.length > 0) {
	for (const refusal of refusals) console.error(refusal);
	console.error("Nothing in bin/ was replaced.");
	process.exit(1);
}

fs.copyFileSync(path.join(repoRoot, "LICENSE"), path.join(sdPluginDir, "LICENSE"));
fs.copyFileSync(path.join(repoRoot, "NOTICE.md"), path.join(sdPluginDir, "NOTICE.md"));

fs.mkdirSync(destDir, { recursive: true });

/** Vendors one checked binary; returns true when bin/ holds the source bytes. */
function vendor({ binary, path: built, hash: builtHash, from }) {
	const dest = path.join(destDir, binary.file);
	const origin = from === null ? "" : ` from ${from}`;

	// Stale staging files from an earlier failed swap: safe to clear, never
	// the destination itself. Removal can fail if that temp is itself in
	// use; a leftover here must not fail the build.
	for (const entry of fs.readdirSync(destDir)) {
		if (entry.startsWith(`${binary.file}.staging-`)) {
			try {
				fs.rmSync(path.join(destDir, entry));
			} catch {
				console.error(`Warning: could not remove stale ${entry}; continuing.`);
			}
		}
	}

	if (fs.existsSync(dest) && sha256(dest) === builtHash) {
		console.log(`Vendored ${binary.file}${origin} already current, skipped.`);
		return true;
	}

	// Stage next to the destination (same volume, so the final rename is a
	// metadata swap, not a copy), verify the staged bytes, then swap.
	const staging = path.join(destDir, `${binary.file}.staging-${process.pid}`);
	try {
		fs.copyFileSync(built, staging);
		const stagedHash = sha256(staging);
		if (stagedHash !== builtHash) {
			throw new Error(`staged copy hash mismatch (${stagedHash} != ${builtHash})`);
		}
		fs.renameSync(staging, dest);
	} catch (err) {
		try {
			fs.rmSync(staging, { force: true });
		} catch {
			// The staging file itself is busy; leave it for the next run's sweep.
		}
		const code = err?.code ?? "";
		if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
			console.error(`bin/${binary.file} is loaded by the running plugin and cannot be replaced (${code}).`);
			console.error("The previous binary is untouched. Swap it in ONE chained command so the");
			console.error("stop window stays seconds long (a long window makes the Stream Deck app");
			console.error("orphan the profile tiles into '?' placeholders until an app relaunch):");
			console.error("  streamdeck stop com.lawrensen.hwinfo && npm run build && streamdeck restart com.lawrensen.hwinfo");
			return false;
		}
		console.error(`Vendoring ${binary.file} failed: ${err?.message ?? err}`);
		return false;
	}

	const verifyHash = sha256(dest);
	if (verifyHash !== builtHash) {
		console.error(`Vendored ${binary.file} hash mismatch after swap (${verifyHash} != ${builtHash}).`);
		return false;
	}
	console.log(`Vendored ${binary.file}${origin} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB, sha256 ${from === null ? `${builtHash.slice(0, 12)}…` : builtHash}) into ${path.relative(repoRoot, dest)}`);
	return true;
}

const results = plan.map(vendor);
if (results.includes(false)) process.exit(1);
console.log("Legal files staged.");
