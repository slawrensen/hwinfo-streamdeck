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
import { PLUGIN_ROOT, PLUGIN_UUID, STAGING_ONLY } from "./lib/pack-contract.mjs";
import { validatePack } from "./lib/pack-validation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The CLI, as `npm run pack` has always called it: a global install, the
 * exact version the release workflow pins. */
function runElgatoPacker(stagedDir, outputDir) {
	// The global CLI is a .cmd shim on Windows, and Node runs a .cmd only
	// through a shell (it refuses with EINVAL otherwise), so the command is
	// one quoted line: both paths are this script's own temp and release
	// directories, quoted whole, and a path carrying a quote or a newline is
	// refused rather than escaped.
	for (const arg of [stagedDir, outputDir]) {
		if (/["\r\n]/.test(arg)) throw new Error(`refusing to pack through a path with a quote or newline: ${arg}`);
	}
	const command = process.platform === "win32" ? "streamdeck.cmd" : "streamdeck";
	const line = [command, "pack", `"${stagedDir}"`, "--output", `"${outputDir}"`, "--force"].join(" ");
	const result = spawnSync(line, { cwd: repoRoot, stdio: "inherit", shell: true });
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

/**
 * Stages, packs, validates. `runPacker(stagedDir, outputDir)` must leave
 * `<outputDir>/<uuid>.streamDeckPlugin` behind; tests inject one. Returns
 * the archive path. Throws (after removing any archive it wrote) when the
 * packer fails or the archive does not pass the gate.
 */
export function packWithStaging({ sourceDir, outputDir, packageVersion, runPacker = runElgatoPacker, log = console.log }) {
	const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-pack-"));
	const stagedDir = path.join(stagingRoot, PLUGIN_ROOT);
	const archivePath = path.join(outputDir, `${PLUGIN_UUID}.streamDeckPlugin`);
	try {
		copyStaged(sourceDir, stagedDir, "");
		fs.mkdirSync(outputDir, { recursive: true });
		runPacker(stagedDir, outputDir);
		if (!fs.existsSync(archivePath)) throw new Error(`the packer left no ${path.basename(archivePath)} in ${outputDir}`);
		const { failures, members, payload } = validatePack({ archiveBytes: fs.readFileSync(archivePath), stagingDir: sourceDir, packageVersion });
		if (failures.length > 0) {
			fs.rmSync(archivePath, { force: true });
			throw new Error(`PACK VALIDATION: ${failures.length} failure(s); the archive was removed\n  ${failures.join("\n  ")}`);
		}
		log(`PACK VALIDATION: OK (${members} members match the shipping contract and the staged build)`);
		log(`  bin/plugin.js ${payload.get("bin/plugin.js")}`);
		log(`  bin/hwsm.node ${payload.get("bin/hwsm.node")}`);
		return archivePath;
	} finally {
		fs.rmSync(stagingRoot, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
	try {
		const archive = packWithStaging({ sourceDir: path.join(repoRoot, PLUGIN_ROOT), outputDir: path.join(repoRoot, "release"), packageVersion });
		console.log(`packed ${path.relative(repoRoot, archive)}`);
	} catch (err) {
		console.error(`pack: ${err.message}`);
		process.exit(1);
	}
}
