// Packs the plugin without touching the tracked source. The Elgato CLI
// rewrites the manifest of the directory it packs (it re-serializes
// manifest.json and drops the trailing newline), so packing the checkout in
// place left a one-line diff behind every release. This stages a copy of
// com.lawrensen.hwinfo.sdPlugin under the temp directory, minus the log
// directory and vendoring leftovers, packs THAT, validates the archive
// against the untouched checkout and the shipping contract
// (scripts/lib/pack-contract.mjs), and removes the copy. A failed pack or a
// failed gate leaves no archive behind and no change in the tree.
//   npm run pack        (verify-pack-version.mjs runs first, see package.json)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { elgatoCli, pinnedElgatoCliVersion } from "./lib/elgato-cli.mjs";
import { NATIVE_MEMBERS, PLUGIN_ROOT, PLUGIN_UUID, STAGING_ONLY } from "./lib/pack-contract.mjs";
import { nativeExpectationsFromManifest, validatePack } from "./lib/pack-validation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The locked CLI from node_modules (scripts/lib/elgato-cli.mjs), run by
 * its entry script under this Node: no shell, so the paths go through as
 * plain arguments. It must be the exact version package.json pins. */
function runElgatoPacker(stagedDir, outputDir) {
	const cli = elgatoCli(repoRoot);
	if (cli === null) throw new Error("the Elgato CLI is not installed in node_modules; run `npm ci`");
	const pinned = pinnedElgatoCliVersion(repoRoot);
	if (cli.version !== pinned) throw new Error(`node_modules holds @elgato/cli ${cli.version}, package.json pins ${pinned}; run \`npm ci\``);
	const result = spawnSync(process.execPath, [cli.entry, "pack", stagedDir, "--output", outputDir, "--force"], { cwd: repoRoot, stdio: "inherit" });
	if (result.error) throw new Error(`streamdeck pack could not start: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`streamdeck pack exited with ${result.status ?? `signal ${result.signal}`}`);
}

/** Copies the plugin directory minus the staging-only entries, one walk of
 * its own: a directory is tested with its trailing slash so the log
 * directory itself stays behind, not only the files in it, and the copy
 * does not depend on how a given Node release applies a cpSync filter to
 * directories (Node 20 and 24 differ). */
function copyStaged(fromDir, toDir, rel) {
	fs.mkdirSync(toDir, { recursive: true });
	for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
		const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
		if (entry.isDirectory()) {
			if (STAGING_ONLY.some((pattern) => pattern.test(`${relPath}/`))) continue;
			copyStaged(path.join(fromDir, entry.name), path.join(toDir, entry.name), relPath);
		} else if (entry.isFile()) {
			if (STAGING_ONLY.some((pattern) => pattern.test(relPath))) continue;
			fs.copyFileSync(path.join(fromDir, entry.name), path.join(toDir, entry.name));
		}
	}
}

/** The native hashes release-native-manifest.json records, when that file
 * exists (the release workflow writes it right before packing); an empty
 * map otherwise. */
export function nativeExpectations(manifestPath) {
	if (!fs.existsSync(manifestPath)) return new Map();
	return nativeExpectationsFromManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
}

/**
 * Stages, packs, validates. `runPacker(stagedDir, outputDir)` must leave
 * `<outputDir>/<uuid>.streamDeckPlugin` behind; tests inject one.
 * `expectedNative` (archive path -> sha256) holds the native members to a
 * native manifest. Returns the archive path. Throws (after removing any
 * archive it wrote) when the packer fails or the archive does not pass the
 * gate.
 */
export function packWithStaging({ sourceDir, outputDir, packageVersion, runPacker = runElgatoPacker, log = console.log, expectedNative = new Map() }) {
	const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-pack-"));
	const stagedDir = path.join(stagingRoot, PLUGIN_ROOT);
	const archivePath = path.join(outputDir, `${PLUGIN_UUID}.streamDeckPlugin`);
	try {
		copyStaged(sourceDir, stagedDir, "");
		fs.mkdirSync(outputDir, { recursive: true });
		// The previous archive goes before the packer runs: a packer that
		// fails must not leave yesterday's file where a later stage would
		// validate it as today's.
		fs.rmSync(archivePath, { force: true });
		runPacker(stagedDir, outputDir);
		if (!fs.existsSync(archivePath)) throw new Error(`the packer left no ${path.basename(archivePath)} in ${outputDir}`);
		const { failures, members, payload } = validatePack({ archiveBytes: fs.readFileSync(archivePath), stagingDir: sourceDir, packageVersion, expectedNative });
		if (failures.length > 0) {
			throw new Error(`PACK VALIDATION: ${failures.length} failure(s); the archive was removed\n  ${failures.join("\n  ")}`);
		}
		log(`PACK VALIDATION: OK (${members} members match the shipping contract and the staged build)`);
		log(`  bin/plugin.js ${payload.get("bin/plugin.js")}`);
		for (const rel of NATIVE_MEMBERS) log(`  ${rel} ${payload.get(rel)}${expectedNative.has(rel) ? " (matches the native manifest)" : ""}`);
		return archivePath;
	} catch (error) {
		// Whatever failed, including a packer that wrote its archive and
		// then exited nonzero, nothing it wrote is left to pass as good.
		fs.rmSync(archivePath, { force: true });
		throw error;
	} finally {
		fs.rmSync(stagingRoot, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
	try {
		// HWSM_NATIVE_MANIFEST names the manifest to hold the native members
		// to (qualify.mjs --native-manifest); it must exist when named.
		const manifestPath = process.env.HWSM_NATIVE_MANIFEST ? path.resolve(process.env.HWSM_NATIVE_MANIFEST) : path.join(repoRoot, "release-native-manifest.json");
		if (process.env.HWSM_NATIVE_MANIFEST && !fs.existsSync(manifestPath)) throw new Error(`HWSM_NATIVE_MANIFEST names ${manifestPath}, which does not exist`);
		const expectedNative = nativeExpectations(manifestPath);
		const archive = packWithStaging({ sourceDir: path.join(repoRoot, PLUGIN_ROOT), outputDir: path.join(repoRoot, "release"), packageVersion, expectedNative });
		console.log(`packed ${path.relative(repoRoot, archive)}`);
	} catch (err) {
		console.error(`pack: ${err.message}`);
		process.exit(1);
	}
}
