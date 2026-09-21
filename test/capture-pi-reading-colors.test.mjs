import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { browserDebuggerPort } from "../scripts/lib/process-ownership.mjs";

const scriptPath = fileURLToPath(new URL("../scripts/capture-pi-reading-colors.mjs", import.meta.url));
const source = readFileSync(scriptPath, "utf8").replace(/^import .*;\r?\n/gm, "").replace("fileURLToPath(import.meta.url)", JSON.stringify(scriptPath));

async function inspectLaunch({ port, spawnError = false, cleanupError = false } = {}) {
	const profile = mkdtempSync(path.join(os.tmpdir(), "capture-pi-owned-test-"));
	if (port !== undefined) writeFileSync(path.join(profile, "DevToolsActivePort"), `${port}\n/devtools/browser/fixture`);
	const fetches = [];
	const cleanups = [];
	const launches = [];
	const observations = [];
	let failure;
	try {
		await vm.runInNewContext(`(async () => { ${source}\n })()`, {
			assert, path,
			process: { argv: ["node", "script", "fixture-output"], execPath: "node", exit: (code) => { throw new Error(`exit ${code}`); } },
			console: { log() {}, error() {} },
			mkdirSync() {},
			createBrowserProfile: () => profile,
			browserDebuggerPort,
			cleanupBrowser: (...args) => { cleanups.push(["browser", ...args]); if (cleanupError) throw new Error("synthetic survivor"); },
			createChildCleanup: (options) => ({
				observe: () => { observations.push(options); },
				cleanup: () => { cleanups.push(["children"]); }
			}),
			spawn: (...args) => {
				launches.push(args);
				const child = Object.assign(new EventEmitter(), { pid: 100 + launches.length, exitCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
				queueMicrotask(() => {
					if (launches.length === 1) child.stdout.emit("data", "PI at http://127.0.0.1:28997");
					else if (spawnError) child.emit("error", new Error("synthetic Chrome spawn failure"));
				});
				return child;
			},
			fetch: async (url) => {
				if (url === "http://127.0.0.1:28997") throw new Error("no pre-existing harness");
				fetches.push(url);
				return { json: async () => [] };
			},
			AbortSignal: { timeout: () => undefined },
			setTimeout: (callback, ms) => { if (ms < 90_000) queueMicrotask(callback); return { unref() {} }; },
			clearTimeout() {}
		}, { filename: scriptPath, timeout: 1000 });
	} catch (error) {
		failure = error;
	} finally {
		rmSync(profile, { recursive: true, force: true });
	}
	return { profile, failure, fetches, cleanups, launches, observations };
}

test("focused PI capture never probes a fixed debugger when its profile has no port", async () => {
	const result = await inspectLaunch();
	assert.match(String(result.failure), /Chrome debugger did not start/);
	assert.deepEqual(result.fetches, []);
	assert.equal(result.cleanups[0][0], "browser");
	assert.equal(result.cleanups[0][1], result.profile);
	assert.deepEqual(result.cleanups[1], ["children"]);
});

test("focused PI capture uses its assigned port and records harness descendants before launch", async () => {
	const result = await inspectLaunch({ port: 49124 });
	assert.match(String(result.failure), /Chrome debugger did not start/);
	assert.ok(result.fetches.length > 0);
	assert.ok(result.fetches.every((url) => url === "http://127.0.0.1:49124/json/list"));
	assert.ok(result.launches[1][1].includes("--remote-debugging-port=0"));
	assert.ok(result.launches[1][1].includes(`--user-data-dir=${result.profile}`));
	assert.equal(result.launches[1][2].windowsHide, true);
	assert.equal(result.observations.length, 2);
	assert.ok(result.observations[0].runDirectories.includes(result.profile));
});

test("focused PI capture rejects spawn failure and still attempts both cleanup paths", async () => {
	const failedSpawn = await inspectLaunch({ port: 49124, spawnError: true });
	assert.match(String(failedSpawn.failure), /Chrome spawn failure/);
	assert.deepEqual(failedSpawn.fetches, []);
	assert.equal(failedSpawn.cleanups.length, 2);
	const survivor = await inspectLaunch({ cleanupError: true });
	assert.match(String(survivor.failure), /PI capture cleanup failed/);
	assert.deepEqual(survivor.cleanups[1], ["children"]);
});
