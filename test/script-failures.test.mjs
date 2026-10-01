import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const script of ["docs-v17-images.mjs", "dial-color-comparison.mjs", "back-face-sheet.ts", "readability-report.mjs"]) {
	test(`${script} reports an output failure despite the SDK exception logger`, () => {
		const directory = mkdtempSync(path.join(os.tmpdir(), "hwinfo-script-failure-"));
		try {
			const blocker = path.join(directory, "output-is-a-file");
			writeFileSync(blocker, "The generator must fail before rendering.");
			const result = spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}`, blocker], { cwd: root, encoding: "utf8", timeout: 15_000, windowsHide: true });
			assert.equal(result.error, undefined);
			assert.equal(result.signal, null);
			assert.equal(result.status, 1, result.stderr);
			assert.match(result.stderr, /EEXIST/);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
}

// pi-lab's evidence runs: a missing axe-core file used to exit 0 with no
// report, so a release script could take the failure for an audit (external
// review AX65).
test("pi-lab a11y reports a missing AXE_CORE despite the SDK exception logger", () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "hwinfo-script-failure-"));
	try {
		const report = path.join(directory, "a11y.json");
		const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/pi-lab.mjs", "a11y", report], { cwd: root, encoding: "utf8", timeout: 15_000, windowsHide: true, env: { ...process.env, AXE_CORE: path.join(directory, "missing-axe.js") } });
		assert.equal(result.error, undefined);
		assert.equal(result.signal, null);
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /ENOENT/);
		assert.equal(existsSync(report), false, "no report is written");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

// A callback that throws outside the command's promise (a simulator route,
// say) is handled by the SDK logger, so the command finishes; only the
// failure monitor turns that into a nonzero exit (external review AX87).
// The preload handles the exception itself, as the SDK logger does, so the
// test does not lean on the logger being loaded.
test("pi-lab reports an asynchronous simulator callback failure outside its command promise", () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "hwinfo-script-failure-"));
	try {
		const preload = path.join(directory, "fail-callback.mjs");
		writeFileSync(preload, `import http from "node:http";
const emit = http.Server.prototype.emit;
let injected = false;
http.Server.prototype.emit = function(event, ...args) {
	const result = Reflect.apply(emit, this, [event, ...args]);
	if (event === "listening" && !injected) {
		injected = true;
		process.once("uncaughtException", () => {});
		setImmediate(() => { throw new Error("PI_LAB_ASYNC_CALLBACK_FAILURE"); });
	}
	return result;
};
`);
		const output = path.join(directory, "faces.png");
		const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, "--import", "tsx", "scripts/pi-lab.mjs", "faces", output], {
			cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
			// Its own ports (36390, 36391), clear of a lab on the default 29310.
			env: { ...process.env, PI_LAB_PORT_BASE: "36390" }
		});
		assert.equal(result.error, undefined);
		assert.equal(result.signal, null);
		assert.equal(existsSync(output), true, "precondition: the command finished despite the callback failure");
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /PI_LAB_ASYNC_CALLBACK_FAILURE/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
