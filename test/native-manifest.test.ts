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
