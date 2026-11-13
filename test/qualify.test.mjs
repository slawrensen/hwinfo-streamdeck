// The qualification entrypoint's contract that other things depend on: the
// stage order is the documented one (a clean clone must be able to run it
// top to bottom), an unknown stage is refused before anything runs, and a
// stage that does not pass stops the stages after it (a later PASS must
// never be read over an earlier FAIL).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildPe } from "../scripts/lib/pe-fixture.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(ROOT, "scripts", "qualify.mjs");
const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: "utf8" });

describe("qualification entrypoint", () => {
	it("lists the stages in the clean-clone order", () => {
		const r = run("--list");
		assert.equal(r.status, 0);
		assert.deepEqual(r.stdout.trim().split(/\r?\n/), ["prerequisites", "lint", "typecheck", "build:native", "toolchain", "build", "native-identity", "bundle", "unit", "native", "pack", "archive", "abi", "recovery", "native-gate", "cli-validate", "copy", "tree"]);
	});

	it("refuses an unknown stage before running anything", () => {
		const r = run("--stages", "prerequisites,nope");
		assert.equal(r.status, 3);
		assert.match(r.stderr, /unknown stage "nope"/);
	});

	it("a stage that cannot pass fails the run and skips the stages after it", (t) => {
		// The archive stage over a release directory that holds no archive:
		// the missing artifact is rejected there, with the remedy, and the
		// ABI and recovery stages that would consume it are skipped, never
		// run over an older extraction.
		// The record directory sits INSIDE the checkout here, as CI keeps it:
		// it is the run's own output, and the unchanged-tree stage must not
		// count it as a changed input.
		const out = fs.mkdtempSync(path.join(ROOT, "qualification-test-"));
		t.after(() => fs.rmSync(out, { recursive: true, force: true }));
		const archive = path.join(ROOT, "release", "com.lawrensen.hwinfo.streamDeckPlugin");
		const packed = fs.existsSync(archive);
		const r = run("--stages", packed ? "tree" : "archive,abi,recovery", "--out", out);
		if (packed) {
			// With a real archive present the negative path is proven by the
			// validator's own fixtures; here only the runner's bookkeeping.
			assert.equal(r.status, 0, r.stdout + r.stderr);
			const record = JSON.parse(fs.readFileSync(path.join(out, "record.json"), "utf8"));
			assert.equal(record.verdict, "PASS");
			assert.equal(record.stages.find((s) => s.id === "archive").status, "SKIPPED");
			return;
		}
		assert.equal(r.status, 1, r.stdout + r.stderr);
		const record = JSON.parse(fs.readFileSync(path.join(out, "record.json"), "utf8"));
		assert.equal(record.verdict, "FAIL");
		assert.equal(record.stages.find((s) => s.id === "archive").status, "FAIL");
		assert.equal(record.stages.find((s) => s.id === "abi").status, "SKIPPED");
		assert.equal(record.stages.find((s) => s.id === "recovery").status, "SKIPPED");
		assert.match(fs.readFileSync(path.join(out, "12-archive.log"), "utf8"), /not found; run `npm run pack` first/);
	});
});

// --native <dir> --native-manifest <json> qualifies a release's exact native
// binaries. Run over a staged tree (the qualification script, its libraries,
// synthetic PE32+ addons in bin/ and a package.json whose build script only
// reports the vendor variables), so no native build or pack is needed.
describe("qualification of a release's native binaries", () => {
	const STAGED = ["scripts/qualify.mjs", "scripts/lib/elgato-cli.mjs", "scripts/lib/pack-contract.mjs", "scripts/lib/zip.mjs", "scripts/lib/authenticode.mjs", "scripts/lib/native-binaries.mjs"];
	const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
	function stage(t) {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-qualify-native-"));
		t.after(() => fs.rmSync(root, { recursive: true, force: true }));
		for (const rel of STAGED) {
			fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
			fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
		}
		// The build stage runs `npm run -s build`; here it only writes what
		// the vendor step would have been told.
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.8.0", scripts: { build: "node -e \"require('fs').writeFileSync('vendor-env.json', JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => /_VENDOR(_SHA256)?$|^HWSM_NATIVE_MANIFEST$/.test(k)))))\"" } }));
		const bin = path.join(root, "com.lawrensen.hwinfo.sdPlugin", "bin");
		const release = path.join(root, "release-files");
		fs.mkdirSync(bin, { recursive: true });
		fs.mkdirSync(release);
		const files = { "hwsm.node": buildPe({ code: Buffer.from("release hwsm"), pdb: "hwsm.pdb" }) };
		for (const [file, bytes] of Object.entries(files)) {
			fs.writeFileSync(path.join(bin, file), bytes);
			fs.writeFileSync(path.join(release, file), bytes);
		}
		const manifest = { manifestVersion: 2, binaries: Object.entries(files).map(([file, bytes]) => ({ file, sha256: sha256(bytes), unsignedSha256: sha256(bytes), signature: null })) };
		const manifestPath = path.join(root, "published-manifest.json");
		fs.writeFileSync(manifestPath, JSON.stringify(manifest));
		return { root, bin, release, files, manifest, manifestPath, out: path.join(root, "record") };
	}
	const run = (root, ...args) => spawnSync(process.execPath, [path.join(root, "scripts", "qualify.mjs"), ...args], { cwd: root, encoding: "utf8", env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_VENDOR(_SHA256)?$|^HWSM_NATIVE_MANIFEST$/.test(k))) });

	it("records the release's files as vendored, held to their manifest", (t) => {
		const { root, release, files, manifestPath, out } = stage(t);
		const r = run(root, "--stages", "native-identity", "--native", release, "--native-manifest", manifestPath, "--out", out);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		const record = JSON.parse(fs.readFileSync(path.join(out, "record.json"), "utf8"));
		assert.equal(record.native.source, "vendored");
		assert.equal(record.native.manifest, "published-manifest.json");
		assert.deepEqual(record.native.binaries["hwsm.node"], { sha256: sha256(files["hwsm.node"]), unsignedSha256: sha256(files["hwsm.node"]), signed: false, signer: null });
		assert.match(fs.readdirSync(out).filter((f) => f.startsWith("QUALIFICATION-")).map((f) => fs.readFileSync(path.join(out, f), "utf8")).join(""), /Native binaries: the release's files, held to `published-manifest\.json`/);
	});

	it("without --native, records a local build and says it is not a release's files", (t) => {
		const { root, out } = stage(t);
		const r = run(root, "--stages", "native-identity", "--out", out);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.equal(JSON.parse(fs.readFileSync(path.join(out, "record.json"), "utf8")).native.source, "local-build");
		assert.match(fs.readFileSync(path.join(out, "07-native-identity.log"), "utf8"), /These are local native bytes, not a release's files/);
	});

	it("fails when bin/ does not hold the release's file", (t) => {
		const { root, bin, release, manifestPath, out } = stage(t);
		fs.writeFileSync(path.join(bin, "hwsm.node"), buildPe({ code: Buffer.from("a local hwsm") }));
		const r = run(root, "--stages", "native-identity", "--native", release, "--native-manifest", manifestPath, "--out", out);
		assert.equal(r.status, 1);
		assert.match(fs.readFileSync(path.join(out, "07-native-identity.log"), "utf8"), /bin\/hwsm\.node is [0-9a-f]{12}…, not the release's [0-9a-f]{12}…: the build stage did not vendor the release's file/);
	});

	it("hands the build stage the release's files and hashes, and the gates the manifest", (t) => {
		const { root, release, manifest, manifestPath, out } = stage(t);
		const r = run(root, "--stages", "build", "--native", release, "--native-manifest", manifestPath, "--out", out);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "vendor-env.json"), "utf8")), {
			HWSM_VENDOR: path.join(release, "hwsm.node"),
			HWSM_VENDOR_SHA256: manifest.binaries[0].sha256,
			HWSM_NATIVE_MANIFEST: manifestPath
		});
	});

	it("refuses a half-given or unusable release before running anything", (t) => {
		const { root, release, manifest, manifestPath, out } = stage(t);
		const alone = run(root, "--stages", "native-identity", "--native", release, "--out", out);
		assert.equal(alone.status, 3);
		assert.match(alone.stderr, /--native and --native-manifest go together/);
		fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, binaries: [] }));
		const partial = run(root, "--stages", "native-identity", "--native", release, "--native-manifest", manifestPath, "--out", out);
		assert.equal(partial.status, 3);
		assert.match(partial.stderr, /--native-manifest records no sha256 for hwsm\.node/);
		fs.writeFileSync(manifestPath, JSON.stringify(manifest));
		fs.rmSync(path.join(release, "hwsm.node"));
		const missing = run(root, "--stages", "native-identity", "--native", release, "--native-manifest", manifestPath, "--out", out);
		assert.equal(missing.status, 3);
		assert.match(missing.stderr, /holds no hwsm\.node/);
		assert.equal(fs.existsSync(path.join(out, "record.json")), false, "nothing ran");
	});
});
