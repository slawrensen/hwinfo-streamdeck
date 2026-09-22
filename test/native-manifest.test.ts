// The native manifest's toolchain facts are release evidence. Runs the real
// scripts/native-manifest.mjs against the built addon (needs bin/hwsm.node,
// like the rest of test:native): under a CI run id the script must refuse a
// compiler version that is not a version (the cl.exe banner capture is
// order-dependent, so a usage line once reached the environment), and a
// bare local run keeps an honest "unknown".
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const ROOT = process.cwd();
const script = join(ROOT, "scripts/native-manifest.mjs");
const addon = join(ROOT, "com.lawrensen.hwinfo.sdPlugin/bin/hwsm.node");
// The generated project is where the script reads the SDK version from; a
// checkout whose addon was copied in has none.
const project = join(ROOT, "native/hwsm/build/hwsm.vcxproj");
// Check the generated build, not binding.gyp's declared intent: Node's
// common.gypi can override target_defaults warning settings.
describe("native compiler warning policy", { skip: !existsSync(project) && "native project not generated" }, () => {
	for (const target of ["hwsm", "hwsm_test", "hwsm_protomm"]) {
		it(`${target} enables level 4 warnings as errors in every configuration`, () => {
			const xml = fs.readFileSync(join(ROOT, `native/hwsm/build/${target}.vcxproj`), "utf8");
			const configurations = [...xml.matchAll(/<ItemDefinitionGroup[^>]*>([\s\S]*?)<\/ItemDefinitionGroup>/g)];
			assert.ok(configurations.length >= 2, "Debug and Release definitions must be present");
			for (const [, configuration] of configurations) {
				assert.match(configuration!, /<WarningLevel>Level4<\/WarningLevel>/);
				assert.match(configuration!, /<TreatWarningAsError>true<\/TreatWarningAsError>/);
			}
		});
	}
});
// Never the repo root: a kept release-native-manifest.json is release evidence.
const outDir = fs.mkdtempSync(join(os.tmpdir(), "hwsm-manifest-"));
const out = join(outDir, "release-native-manifest.json");
after(() => fs.rmSync(outDir, { recursive: true, force: true }));

function run(env: Record<string, string | undefined>): { status: number | null; stderr: string } {
	const merged: Record<string, string | undefined> = { ...process.env, GITHUB_RUN_ID: undefined, HWSM_CL_VERSION: undefined, WindowsSDKVersion: undefined, HWSM_MANIFEST_OUT: out, ...env };
	return spawnSync(process.execPath, [script, addon], { cwd: ROOT, encoding: "utf8", env: merged });
}

function manifest(): { compilerVersion: string; windowsSdkVersion: string } {
	return JSON.parse(fs.readFileSync(out, "utf8")) as { compilerVersion: string; windowsSdkVersion: string };
}

describe("native-manifest toolchain facts", { skip: !existsSync(addon) && "bin/hwsm.node not built" }, () => {
	it("refuses a compilerVersion that is not a version when GITHUB_RUN_ID is set", () => {
		for (const bad of ["usage: cl [ option... ] filename... [ /link linkoption... ]", "", "unknown", "v19", "19.44"]) {
			const r = run({ GITHUB_RUN_ID: "1", GITHUB_REPOSITORY: "x/y", HWSM_CL_VERSION: bad });
			assert.equal(r.status, 1, JSON.stringify(bad));
			assert.match(r.stderr, /not a compiler version/);
		}
	});
	it("accepts a real compiler version in CI and records the SDK from the generated project", () => {
		const r = run({ GITHUB_RUN_ID: "1", GITHUB_REPOSITORY: "x/y", HWSM_CL_VERSION: "19.44.35228" });
		assert.equal(r.status, 0, r.stderr);
		assert.equal(manifest().compilerVersion, "19.44.35228");
		if (existsSync(project)) assert.match(manifest().windowsSdkVersion, /^10\.0\.\d+\.\d+$/);
		else assert.equal(manifest().windowsSdkVersion, "unknown", "no generated project, no invented SDK version");
	});
	it("still writes an honest unknown for a bare local run", () => {
		const r = run({});
		assert.equal(r.status, 0, r.stderr);
		assert.equal(manifest().compilerVersion, "unknown");
	});
});

describe("native-manifest hardening record", { skip: !existsSync(addon) && "bin/hwsm.node not built" }, () => {
	it("records every hardening flag binding.gyp asks for as present on the built addon", () => {
		const r = run({});
		assert.equal(r.status, 0, r.stderr);
		const hardening = (JSON.parse(fs.readFileSync(out, "utf8")) as { hardening: Record<string, boolean> }).hardening;
		assert.deepEqual(Object.keys(hardening).sort(), ["cetCompat", "controlFlowGuard", "dynamicBase", "highEntropyVa", "nxCompat", "reproducibleLink"]);
		for (const [flag, on] of Object.entries(hardening)) assert.equal(on, true, flag);
	});

	it("refuses to record a binary that lacks one of them", () => {
		// The same addon with Control Flow Guard cleared in its PE header:
		// DllCharacteristics sits 70 bytes into the PE32+ optional header.
		const bytes = fs.readFileSync(addon);
		const optionalHeader = bytes.readUInt32LE(0x3c) + 4 + 20;
		const characteristics = bytes.readUInt16LE(optionalHeader + 70);
		assert.notEqual(characteristics & 0x4000, 0, "the built addon carries CFG, or this test proves nothing");
		bytes.writeUInt16LE(characteristics & ~0x4000, optionalHeader + 70);
		const weakened = join(outDir, "hwsm-no-cfg.node");
		fs.writeFileSync(weakened, bytes);
		fs.rmSync(out, { force: true });
		const r = spawnSync(process.execPath, [script, weakened], { cwd: ROOT, encoding: "utf8", env: { ...process.env, GITHUB_RUN_ID: undefined, HWSM_CL_VERSION: undefined, HWSM_MANIFEST_OUT: out } });
		assert.equal(r.status, 1);
		assert.match(r.stderr, /lacks hardening controlFlowGuard/);
		assert.equal(existsSync(out), false, "no manifest is written for a binary the gate refused");
	});
});
