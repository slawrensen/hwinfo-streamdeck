// npm run pack must leave the tracked plugin directory untouched whether the
// packer succeeds, fails, or produces an archive the gate refuses. The
// packer is injected: each fake behaves like the Elgato CLI in one respect
// (it rewrites the staged manifest, it fails, it drops a member, it writes
// nothing) and the source directory is hashed before and after.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PLUGIN_ROOT, PLUGIN_UUID } from "../scripts/lib/pack-contract.mjs";
import { packWithStaging } from "../scripts/pack.mjs";
import { validatePack } from "../scripts/lib/pack-validation.mjs";
import { writeZip } from "../scripts/lib/zip.mjs";
import { archiveEntries, FIXTURE_VERSION, makeStaging, sameSnapshot, snapshotDir } from "../scripts/lib/pack-fixture.mjs";

describe("pack through a staged copy", () => {
	let source;
	let outputDir;
	let before_;
	const stagedSeen = [];
	before(() => {
		source = makeStaging("hwinfo-pack-source-");
		// What a local run leaves in the tracked directory: the plugin's own
		// logs and a vendoring leftover. Neither may reach the packer.
		fs.mkdirSync(path.join(source, "logs"), { recursive: true });
		fs.writeFileSync(path.join(source, "logs", "com.lawrensen.hwinfo.0.log"), "a log line\n");
		fs.writeFileSync(path.join(source, "bin", "hwsm.node.staging-4242"), "leftover");
		outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-pack-out-"));
		before_ = snapshotDir(source);
	});
	after(() => {
		fs.rmSync(source, { recursive: true, force: true });
		fs.rmSync(outputDir, { recursive: true, force: true });
	});

	const archiveName = `${PLUGIN_UUID}.streamDeckPlugin`;
	const cliLike = (stagedDir, out) => {
		stagedSeen.push(stagedDir);
		assert.equal(path.basename(stagedDir), PLUGIN_ROOT, "the staged copy keeps the plugin directory name the CLI derives the UUID from");
		assert.equal(fs.existsSync(path.join(stagedDir, "logs")), false, "logs never reach the packer");
		assert.equal(fs.existsSync(path.join(stagedDir, "bin", "hwsm.node.staging-4242")), false, "vendoring leftovers never reach the packer");
		// The CLI re-serializes the manifest it packs: no trailing newline.
		const manifestPath = path.join(stagedDir, "manifest.json");
		fs.writeFileSync(manifestPath, JSON.stringify(JSON.parse(fs.readFileSync(manifestPath, "utf8")), null, "\t"));
		fs.writeFileSync(path.join(out, archiveName), writeZip(archiveEntries(stagedDir)));
	};

	it("packs, validates, leaves the source untouched and removes the staged copy", () => {
		const archive = packWithStaging({ sourceDir: source, outputDir, packageVersion: FIXTURE_VERSION, runPacker: cliLike, log: () => {} });
		assert.equal(archive, path.join(outputDir, archiveName));
		assert.ok(sameSnapshot(before_, snapshotDir(source)), "every source file, the manifest newline included, is byte-identical after packing");
		assert.equal(fs.existsSync(stagedSeen.at(-1)), false, "the staged copy is removed");
		const result = validatePack({ archiveBytes: fs.readFileSync(archive), stagingDir: source, packageVersion: FIXTURE_VERSION });
		assert.deepEqual(result.failures, []);
	});

	it("packing twice changes nothing and the archives carry the same payload", () => {
		const first = fs.readFileSync(packWithStaging({ sourceDir: source, outputDir, packageVersion: FIXTURE_VERSION, runPacker: cliLike, log: () => {} }));
		const second = fs.readFileSync(packWithStaging({ sourceDir: source, outputDir, packageVersion: FIXTURE_VERSION, runPacker: cliLike, log: () => {} }));
		assert.ok(sameSnapshot(before_, snapshotDir(source)));
		const payload = (bytes) => [...validatePack({ archiveBytes: bytes, stagingDir: source, packageVersion: FIXTURE_VERSION }).payload.entries()].sort();
		assert.deepEqual(payload(first), payload(second));
	});

	it("a failing packer leaves no archive, no staged copy and no change", () => {
		fs.rmSync(path.join(outputDir, archiveName), { force: true });
		assert.throws(() => packWithStaging({ sourceDir: source, outputDir, packageVersion: FIXTURE_VERSION, runPacker: (stagedDir) => { stagedSeen.push(stagedDir); throw new Error("streamdeck pack exited with 1"); }, log: () => {} }), /exited with 1/);
		assert.equal(fs.existsSync(path.join(outputDir, archiveName)), false);
		assert.equal(fs.existsSync(stagedSeen.at(-1)), false);
		assert.ok(sameSnapshot(before_, snapshotDir(source)));
	});

	it("a packer that writes nothing is reported", () => {
		assert.throws(() => packWithStaging({ sourceDir: source, outputDir, packageVersion: FIXTURE_VERSION, runPacker: () => {}, log: () => {} }), /left no/);
		assert.ok(sameSnapshot(before_, snapshotDir(source)));
	});

	it("an archive the gate refuses is removed and the failure names the member", () => {
		assert.throws(() => packWithStaging({ sourceDir: source, outputDir, packageVersion: FIXTURE_VERSION, log: () => {}, runPacker: (stagedDir, out) => {
			fs.writeFileSync(path.join(out, archiveName), writeZip(archiveEntries(stagedDir, (entries) => entries.filter((entry) => !entry.name.endsWith("/bin/hwsm.node")))));
		} }), /PACK VALIDATION.*\n.*missing member "bin\/hwsm\.node"/);
		assert.equal(fs.existsSync(path.join(outputDir, archiveName)), false, "a refused archive does not stay behind looking valid");
		assert.ok(sameSnapshot(before_, snapshotDir(source)));
	});

	it("an unrelated edit in the source survives packing untouched", () => {
		fs.writeFileSync(path.join(source, "themes.json"), "{ \"edited\": true }\n");
		const edited = snapshotDir(source);
		packWithStaging({ sourceDir: source, outputDir, packageVersion: FIXTURE_VERSION, runPacker: cliLike, log: () => {} });
		assert.ok(sameSnapshot(edited, snapshotDir(source)));
	});
});
