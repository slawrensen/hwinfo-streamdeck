import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { browserDebuggerPort } from "../scripts/lib/process-ownership.mjs";

const scriptPath = fileURLToPath(new URL("../scripts/docs-site-shots.mjs", import.meta.url));
const source = readFileSync(scriptPath, "utf8").replace(/^import .*;\r?\n/gm, "");

async function inspectLaunch({ port, exitCode = null, signalCode = null, pageReady = false, spawnError = false } = {}) {
	const profile = mkdtempSync(path.join(os.tmpdir(), "docs-shots-owned-test-"));
	if (port !== undefined) writeFileSync(path.join(profile, "DevToolsActivePort"), `${port}\n/devtools/browser/fixture`);
	const fetches = [];
	const cleanups = [];
	const launches = [];
	const reads = [];
	const connections = [];
	const child = Object.assign(new EventEmitter(), { pid: 123, exitCode, signalCode, kill() {} });
	let failure;
	try {
		await vm.runInNewContext(`(async () => { ${source}\n })()`, {
			path,
			process: { argv: ["node", "script", "fixture-output", "https://docs.example.test/"], env: { TEMP: "fixture-temp" }, exit: (code) => { throw new Error(`exit ${code}`); } },
			console: { log() {}, error() {} },
			mkdirSync() {}, writeFileSync() { throw new Error("no screenshot should be written before debugger ownership is established"); },
			browserDebuggerPort: (ownedProfile) => {
				reads.push(path.join(ownedProfile, "DevToolsActivePort"));
				return browserDebuggerPort(ownedProfile);
			},
			createBrowserProfile: () => profile,
			cleanupBrowser: (...args) => { cleanups.push(args); },
			spawn: (...args) => {
				launches.push(args);
				if (spawnError) queueMicrotask(() => child.emit("error", new Error("synthetic Chrome spawn failure")));
				return child;
			},
			spawnSync: () => ({ status: 1 }), // legacy cleanup is inert in the negative control
			fetch: async (url) => { fetches.push(url); return { json: async () => pageReady ? [{ type: "page", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/fixture` }] : [] }; },
			WebSocket: class { constructor(url) { connections.push(url); throw new Error("owned debugger accepted; fixture stops before CDP"); } },
			setTimeout: (callback, ms) => { if (ms < 300_000) queueMicrotask(callback); return { unref() {} }; },
			clearTimeout() {}
		}, { filename: scriptPath, timeout: 1000 });
	} catch (err) {
		failure = err;
	} finally {
		rmSync(profile, { recursive: true, force: true });
	}
	return { failure, profile, fetches, cleanups, launches, reads, connections };
}

test("docs screenshots never probe a shared debugger when their own port file is absent", async () => {
	const result = await inspectLaunch();
	assert.match(String(result.failure), /chrome debugger never came up/);
	assert.deepEqual(result.fetches, [], "an unrelated fixed-port listener must not be adopted");
	assert.ok(result.reads.every((file) => file === path.join(result.profile, "DevToolsActivePort")));
	assert.equal(result.cleanups.length, 1);
	assert.equal(result.cleanups[0][0], result.profile);
});

test("docs screenshots use only their unique profile's assigned port and scoped cleanup", async () => {
	const result = await inspectLaunch({ port: 49123 });
	assert.match(String(result.failure), /chrome debugger never came up/);
	assert.ok(result.fetches.length > 0);
	assert.ok(result.fetches.every((url) => url === "http://127.0.0.1:49123/json/list"));
	assert.ok(result.launches[0][1].includes("--remote-debugging-port=0"));
	assert.ok(result.launches[0][1].includes(`--user-data-dir=${result.profile}`));
	assert.equal(result.launches[0][2].windowsHide, true);
	assert.equal(result.cleanups.length, 1);
	assert.equal(result.cleanups[0][0], result.profile);
	assert.match(result.cleanups[0][1], /^\d{4}-\d{2}-\d{2}T/);
});

test("docs screenshots fail before endpoint access when Chrome exits or fails to spawn", async () => {
	for (const options of [{ exitCode: 1 }, { signalCode: "SIGTERM" }, { spawnError: true }]) {
		const result = await inspectLaunch({ port: 49123, ...options });
		assert.match(String(result.failure), /Chrome (?:exited|spawn failure)/);
		assert.deepEqual(result.fetches, []);
		assert.equal(result.cleanups.length, 1);
	}
});

test("docs screenshots accept a zero-exit launcher handoff through their owned debugger", async () => {
	const result = await inspectLaunch({ port: 49123, exitCode: 0, pageReady: true });
	assert.match(String(result.failure), /owned debugger accepted/);
	assert.deepEqual(result.fetches, ["http://127.0.0.1:49123/json/list"]);
	assert.deepEqual(result.connections, ["ws://127.0.0.1:49123/fixture"]);
	assert.equal(result.cleanups.length, 1);
});

test("docs screenshots still need their own debugger after a zero-exit launcher handoff", async () => {
	const result = await inspectLaunch({ exitCode: 0, pageReady: true });
	assert.match(String(result.failure), /chrome debugger never came up/);
	assert.deepEqual(result.fetches, []);
	assert.deepEqual(result.connections, []);
	assert.equal(result.cleanups.length, 1);
});

test("docs screenshots refuse malformed assigned ports without probing an endpoint", async () => {
	for (const port of ["garbage", 0, -1, 65536]) {
		const result = await inspectLaunch({ port });
		assert.match(String(result.failure), /chrome debugger never came up/);
		assert.deepEqual(result.fetches, []);
	}
});
