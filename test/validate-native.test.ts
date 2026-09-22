// The packaging gate (scripts/validate-native.mjs) must refuse a vendored
// addon that no longer matches the native sources next to it. Runs the real
// script over a staged copy of this tree: the built bin/hwsm.node, the
// loader, the native sources and the gate itself, so a case can edit one
// native file without touching the checkout. Needs bin/hwsm.node, like the
// rest of test:native.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const ROOT = process.cwd();
const addon = path.join(ROOT, "com.lawrensen.hwinfo.sdPlugin", "bin", "hwsm.node");
const onWindows = process.platform === "win32" && process.arch === "x64";
const staged: string[] = [];
after(() => { for (const dir of staged) fs.rmSync(dir, { recursive: true, force: true }); });

const STAGED_FILES = [
	"scripts/validate-native.mjs",
	"scripts/lib/soak-producer-freshness.mjs",
	"src/hwinfo/hwsm-loader.ts",
	"native/hwsm/hwsm.c",
	"native/hwsm/hwsm.rc",
	"native/hwsm/hwsm-version.h",
	"native/hwsm/binding.gyp",
	"com.lawrensen.hwinfo.sdPlugin/bin/hwsm.node"
];

function stage(edit?: (root: string) => void): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "hwsm-validate-"));
	staged.push(root);
	for (const rel of STAGED_FILES) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
	}
	edit?.(root);
	return root;
}

function run(root: string): { status: number | null; stdout: string; stderr: string } {
	return spawnSync(process.execPath, [path.join(root, "scripts", "validate-native.mjs")], { cwd: root, encoding: "utf8" });
}

describe("native packaging gate: the vendored addon matches the native sources", { skip: !onWindows ? "win32-x64 only" : !fs.existsSync(addon) ? "bin/hwsm.node not built" : false }, () => {
	it("passes on an addon built from this tree's native sources", () => {
		const result = run(stage());
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /NATIVE VALIDATION: OK/);
	});

	it("refuses an addon whose native sources changed after it was built", () => {
		const root = stage((dir) => fs.appendFileSync(path.join(dir, "native", "hwsm", "hwsm.c"), "\n/* an edit that npm run build alone would never compile */\n"));
		const result = run(root);
		assert.equal(result.status, 1, "a stale vendored addon must fail the gate");
		assert.match(result.stderr, /built from other native sources/);
	});

	it("refuses a native version the header no longer states", () => {
		const root = stage((dir) => {
			const header = path.join(dir, "native", "hwsm", "hwsm-version.h");
			fs.writeFileSync(header, fs.readFileSync(header, "utf8").replace(/#define HWSM_NATIVE_VERSION_STR "[^"]+"/, '#define HWSM_NATIVE_VERSION_STR "9.9.9"'));
		});
		const result = run(root);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /native version/);
	});

	it("refuses a loader whose protocol disagrees with the native header", () => {
		const root = stage((dir) => {
			const loader = path.join(dir, "src", "hwinfo", "hwsm-loader.ts");
			fs.writeFileSync(loader, fs.readFileSync(loader, "utf8").replace("export const HWSM_PROTOCOL_VERSION = 1;", "export const HWSM_PROTOCOL_VERSION = 2;"));
		});
		const result = run(root);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /protocol/);
	});
});
