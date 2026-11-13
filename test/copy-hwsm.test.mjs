// The vendor step (scripts/copy-hwsm.mjs) is how the release packs the
// exact native bytes its build and sign jobs produced: <PREFIX>_VENDOR names
// each file, <PREFIX>_VENDOR_SHA256 the hash it must have. Runs the real
// script over a staged tree with synthetic PE32+ images
// (scripts/lib/pe-fixture.mjs), so no native build is needed: a wrong hash,
// a half-set configuration or a file that is not a shippable PE image must
// leave bin/ exactly as it was. The plugin ships one binary, hwsm.node; the
// staged binary list gains a synthetic second one (second.node,
// SECOND_VENDOR), so the rules for more than one stay held.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildPe, fakeSign } from "../scripts/lib/pe-fixture.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const STAGED = ["scripts/copy-hwsm.mjs", "scripts/lib/native-binaries.mjs", "scripts/lib/authenticode.mjs", "LICENSE", "NOTICE.md"];
const roots = [];
after(() => { for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true }); });

/** The shipped binary list with a synthetic second binary after hwsm.node. */
function withSecondBinary(listSource) {
	const second = `\tObject.freeze({ file: "second.node", target: "second", dir: "native/second", sources: Object.freeze(["second.c"]), versionHeader: "second-version.h", macroPrefix: "SECOND", contract: Object.freeze({ path: "src/second.ts", constant: "SECOND_PROTOCOL_VERSION" }), testVariants: Object.freeze(["second_test.node"]), exports: Object.freeze(["getBuildInfo"]) })\n]);`;
	const end = "\t})\n]);";
	assert.equal(listSource.split(end).length, 2, "the binary list ends where the test expects");
	return listSource.replace(end, () => `\t}),\n${second}`);
}

/** A tree holding the vendor script, the legal files, the previous bin/
 * addons and two release files to vendor (`shipped`: the list as it ships,
 * hwsm.node alone). */
function stage({ shipped = false } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-vendor-"));
	roots.push(root);
	for (const rel of STAGED) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
	}
	const list = path.join(root, "scripts", "lib", "native-binaries.mjs");
	if (!shipped) fs.writeFileSync(list, withSecondBinary(fs.readFileSync(list, "utf8")));
	const bin = path.join(root, "com.lawrensen.hwinfo.sdPlugin", "bin");
	fs.mkdirSync(bin, { recursive: true });
	fs.writeFileSync(path.join(bin, "hwsm.node"), buildPe({ code: Buffer.from("previous hwsm") }));
	fs.writeFileSync(path.join(bin, "second.node"), buildPe({ code: Buffer.from("previous second") }));
	const release = path.join(root, "release-files");
	fs.mkdirSync(release);
	const hwsm = buildPe({ code: Buffer.from("release hwsm"), pdb: "hwsm.pdb" });
	const second = buildPe({ code: Buffer.from("release second"), pdb: "second.pdb" });
	fs.writeFileSync(path.join(release, "hwsm.node"), hwsm);
	fs.writeFileSync(path.join(release, "second.node"), second);
	return { root, bin, release, hwsm, second };
}

function vendor(root, env) {
	const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/_VENDOR(_SHA256)?$/.test(key)));
	return spawnSync(process.execPath, [path.join(root, "scripts", "copy-hwsm.mjs")], { cwd: root, encoding: "utf8", env: { ...clean, ...env } });
}

const binBytes = (bin) => [fs.readFileSync(path.join(bin, "hwsm.node")), fs.readFileSync(path.join(bin, "second.node"))];

describe("vendor step: the shipped binary list", () => {
	it("vendors hwsm.node alone from HWSM_VENDOR, and from build/Release when unset", () => {
		const { root, bin, release, hwsm } = stage({ shipped: true });
		const named = vendor(root, { HWSM_VENDOR: path.join(release, "hwsm.node"), HWSM_VENDOR_SHA256: sha256(hwsm) });
		assert.equal(named.status, 0, named.stderr);
		assert.ok(fs.readFileSync(path.join(bin, "hwsm.node")).equals(hwsm));
		assert.match(named.stdout, /Vendored hwsm\.node from HWSM_VENDOR/);
		assert.doesNotMatch(named.stdout, /second\.node/);
		const built = path.join(root, "native", "hwsm", "build", "Release");
		fs.mkdirSync(built, { recursive: true });
		const local = buildPe({ code: Buffer.from("local hwsm") });
		fs.writeFileSync(path.join(built, "hwsm.node"), local);
		const unset = vendor(root, {});
		assert.equal(unset.status, 0, unset.stderr);
		assert.ok(fs.readFileSync(path.join(bin, "hwsm.node")).equals(local));
	});
});

describe("vendor step: release files through HWSM_VENDOR and SECOND_VENDOR", () => {
	it("vendors the named files when their hashes match, and says where they came from", () => {
		const { root, bin, release, hwsm, second } = stage();
		const result = vendor(root, { HWSM_VENDOR: path.join(release, "hwsm.node"), HWSM_VENDOR_SHA256: sha256(hwsm), SECOND_VENDOR: path.join(release, "second.node"), SECOND_VENDOR_SHA256: sha256(second) });
		assert.equal(result.status, 0, result.stderr);
		const [a, b] = binBytes(bin);
		assert.ok(a.equals(hwsm) && b.equals(second));
		assert.match(result.stdout, new RegExp(`Vendored hwsm\\.node from HWSM_VENDOR \\(\\d+ KB, sha256 ${sha256(hwsm)}\\)`));
		assert.match(result.stdout, /Vendored second\.node from SECOND_VENDOR/);
		assert.ok(fs.existsSync(path.join(root, "com.lawrensen.hwinfo.sdPlugin", "LICENSE")), "the legal files are still staged");
	});

	it("vendors a signed copy (a certificate table after the image)", () => {
		const { root, bin, release, hwsm } = stage();
		const signed = fakeSign(hwsm, { digestHex: "11".repeat(32) });
		fs.writeFileSync(path.join(release, "hwsm.node"), signed);
		const result = vendor(root, { HWSM_VENDOR: path.join(release, "hwsm.node"), HWSM_VENDOR_SHA256: sha256(signed), SECOND_VENDOR: path.join(release, "second.node") });
		assert.equal(result.status, 0, result.stderr);
		assert.ok(binBytes(bin)[0].equals(signed));
	});

	it("refuses a file whose hash is not the one named, and leaves bin/ untouched", () => {
		const { root, bin, release, second } = stage();
		const before = binBytes(bin);
		const result = vendor(root, { HWSM_VENDOR: path.join(release, "hwsm.node"), HWSM_VENDOR_SHA256: sha256(second), SECOND_VENDOR: path.join(release, "second.node"), SECOND_VENDOR_SHA256: sha256(second) });
		assert.equal(result.status, 1);
		assert.match(result.stderr, new RegExp(`hwsm\\.node from HWSM_VENDOR is [0-9a-f]{64}, not the ${sha256(second)} HWSM_VENDOR_SHA256 names\\.`));
		assert.match(result.stderr, /Nothing in bin\/ was replaced\./);
		assert.deepEqual(binBytes(bin), before, "both addons keep their previous bytes");
	});

	it("refuses a wrong hash on the second binary without swapping in the first", () => {
		// hwsm.node is right and would vendor on its own; the hash named for
		// second.node is wrong. Every source is checked before any is written.
		const { root, bin, release, hwsm } = stage();
		const before = binBytes(bin);
		const result = vendor(root, { HWSM_VENDOR: path.join(release, "hwsm.node"), HWSM_VENDOR_SHA256: sha256(hwsm), SECOND_VENDOR: path.join(release, "second.node"), SECOND_VENDOR_SHA256: "0".repeat(64) });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /second\.node from SECOND_VENDOR is [0-9a-f]{64}, not the 0{64} SECOND_VENDOR_SHA256 names\./);
		assert.deepEqual(binBytes(bin), before, "hwsm.node is not swapped in while second.node is refused");
		assert.equal(fs.existsSync(path.join(root, "com.lawrensen.hwinfo.sdPlugin", "LICENSE")), false, "a refused run stages nothing");
	});

	it("refuses a second binary that is not a shippable PE image without swapping in the first", () => {
		const { root, bin, release, hwsm, second } = stage();
		const before = binBytes(bin);
		fs.writeFileSync(path.join(release, "second.node"), Buffer.concat([second, Buffer.from("appended")]));
		const result = vendor(root, { HWSM_VENDOR: path.join(release, "hwsm.node"), HWSM_VENDOR_SHA256: sha256(hwsm), SECOND_VENDOR: path.join(release, "second.node") });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /second\.node from SECOND_VENDOR is not a native binary this plugin can ship \(8 bytes follow the last section/);
		assert.deepEqual(binBytes(bin), before);
	});

	it("refuses to vendor one binary from the release files and the other from a local build", () => {
		const { root, bin, release } = stage();
		const before = binBytes(bin);
		const result = vendor(root, { HWSM_VENDOR: path.join(release, "hwsm.node") });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /HWSM_VENDOR set but SECOND_VENDOR not: vendor every native binary from the release files or none/);
		assert.deepEqual(binBytes(bin), before);
	});

	it("refuses a hash without a file, and a hash that is not 64 lowercase hex digits", () => {
		const { root, bin, release, hwsm } = stage();
		const before = binBytes(bin);
		assert.match(vendor(root, { HWSM_VENDOR_SHA256: sha256(hwsm) }).stderr, /HWSM_VENDOR_SHA256 is set but HWSM_VENDOR is not/);
		for (const bad of [sha256(hwsm).toUpperCase(), "abc", `${sha256(hwsm)} `]) {
			const result = vendor(root, { HWSM_VENDOR: path.join(release, "hwsm.node"), HWSM_VENDOR_SHA256: bad, SECOND_VENDOR: path.join(release, "second.node") });
			assert.equal(result.status, 1, JSON.stringify(bad));
			assert.match(result.stderr, /HWSM_VENDOR_SHA256 must be 64 lowercase hex digits/);
		}
		assert.deepEqual(binBytes(bin), before);
	});

	it("refuses a named file that is missing, not a PE image, or carries bytes after its image", () => {
		const { root, bin, release, hwsm } = stage();
		const before = binBytes(bin);
		const missing = vendor(root, { HWSM_VENDOR: path.join(release, "absent.node"), SECOND_VENDOR: path.join(release, "second.node") });
		assert.equal(missing.status, 1);
		assert.match(missing.stderr, /Missing .*absent\.node \(HWSM_VENDOR\)/);
		fs.writeFileSync(path.join(release, "text.node"), "not a module");
		const text = vendor(root, { HWSM_VENDOR: path.join(release, "text.node"), SECOND_VENDOR: path.join(release, "second.node") });
		assert.equal(text.status, 1);
		assert.match(text.stderr, /hwsm\.node from HWSM_VENDOR is not a native binary this plugin can ship \(not a PE image/);
		fs.writeFileSync(path.join(release, "overlay.node"), Buffer.concat([hwsm, Buffer.from("appended")]));
		const overlay = vendor(root, { HWSM_VENDOR: path.join(release, "overlay.node"), SECOND_VENDOR: path.join(release, "second.node") });
		assert.equal(overlay.status, 1);
		assert.match(overlay.stderr, /8 bytes follow the last section and there is no certificate table/);
		assert.deepEqual(binBytes(bin), before);
	});

	it("unset, vendors from build/Release exactly as before", () => {
		const { root, bin, hwsm, second } = stage();
		for (const [dir, bytes, file] of [["hwsm", hwsm, "hwsm.node"], ["second", second, "second.node"]]) {
			const built = path.join(root, "native", dir, "build", "Release");
			fs.mkdirSync(built, { recursive: true });
			fs.writeFileSync(path.join(built, file), bytes);
		}
		const result = vendor(root, {});
		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(result.stdout, /_VENDOR/);
		const [a, b] = binBytes(bin);
		assert.ok(a.equals(hwsm) && b.equals(second));
	});
});
