import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import sharp from "sharp";
import { browserDebuggerPort } from "../scripts/lib/process-ownership.mjs";

const scriptPath = fileURLToPath(new URL("../scripts/docs-site-shots.mjs", import.meta.url));
const source = readFileSync(scriptPath, "utf8").replace(/^import .*;\r?\n/gm, "");

async function inspectLaunch({ port, exitCode = null, signalCode = null, pageReady = false, spawnError = false, platform = "win32", env = {}, executableExists = true } = {}) {
	const profile = mkdtempSync(path.join(os.tmpdir(), "docs-shots-owned-test-"));
	if (port !== undefined) writeFileSync(path.join(profile, "DevToolsActivePort"), `${port}\n/devtools/browser/fixture`);
	const fetches = [];
	const cleanups = [];
	const launches = [];
	const reads = [];
	const connections = [];
	const kills = [];
	const removedProfiles = [];
	const child = Object.assign(new EventEmitter(), { pid: 123, exitCode, signalCode, kill(signal) { kills.push(signal); queueMicrotask(() => { child.signalCode = signal; child.emit("exit", null, signal); }); } });
	let failure;
	try {
		await vm.runInNewContext(`(async () => { ${source}\n })()`, {
			path,
			process: { argv: ["node", "script", "fixture-output", "https://docs.example.test/"], platform, env: { TEMP: "fixture-temp", ...env }, getuid: () => 0, on() {}, off() {}, exit: (code) => { throw new Error(`exit ${code}`); } },
			console: { log() {}, error() {} },
			existsSync: () => executableExists, rmSync: (directory) => { removedProfiles.push(directory); }, mkdirSync() {}, writeFileSync() { throw new Error("no screenshot should be written before debugger ownership is established"); },
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
	return { failure, profile, fetches, cleanups, launches, reads, connections, kills, removedProfiles };
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


test("POSIX screenshots stop only their spawned browser and remove its own profile", async () => {
	const result = await inspectLaunch({ platform: "linux", port: 49123, pageReady: true });
	assert.match(String(result.failure), /owned debugger accepted/);
	assert.deepEqual(result.kills, ["SIGTERM"]);
	assert.deepEqual(result.cleanups, [], "Windows process discovery must never run on POSIX");
	assert.deepEqual(result.removedProfiles, [result.profile]);
	assert.ok(result.launches[0][1].includes("--no-sandbox"));
});

test("a POSIX launcher that already exited is never signaled by an old PID", async () => {
	const result = await inspectLaunch({ platform: "linux", exitCode: 1 });
	assert.match(String(result.failure), /Chrome exited/);
	assert.deepEqual(result.kills, []);
	assert.deepEqual(result.cleanups, []);
	assert.deepEqual(result.removedProfiles, [result.profile]);
});

test("an explicit browser path is used and a missing one fails before launching", async () => {
	const chosen = "/opt/documentation-tests/chrome";
	const valid = await inspectLaunch({ platform: "linux", env: { CHROME: chosen }, port: 49123, pageReady: true });
	assert.equal(valid.launches[0][0], chosen);
	const missing = await inspectLaunch({ platform: "linux", env: { CHROME: chosen }, executableExists: false });
	assert.match(String(missing.failure), /No Chrome\/Chromium binary found/);
	assert.deepEqual(missing.launches, []);
	assert.deepEqual(missing.fetches, []);
});

test("malformed extended viewport input fails before browser launch", async () => {
	for (const value of ["wide", "30x800", "1280x20", "390x844,garbage"]) {
		const result = await inspectLaunch({ env: { DOCS_SHOTS_VIEWPORTS: value } });
		assert.match(String(result.failure), /DOCS_SHOTS_VIEWPORTS/);
		assert.deepEqual(result.launches, []);
	}
});


// Optional integration pass through an actual disposable browser. Ordinary
// unit runs remain independent of a locally installed Chrome executable.
test("browser captures complete long pages, paints lazy images and exposes broken assets", { skip: process.env.DOCS_SHOTS_BROWSER_TESTS !== "1", timeout: 30000 }, async (t) => {
	const output = mkdtempSync(path.join(os.tmpdir(), "docs-shot-browser-test-"));
	const server = createServer((req, res) => {
		if (req.url?.endsWith("missing.png")) { res.writeHead(404); res.end("missing"); return; }
		if (req.url?.endsWith("swatch.svg")) { res.writeHead(200, { "content-type": "image/svg+xml" }); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#f02814"/></svg>'); return; }
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capture fixture</title><link rel="icon" href="data:,"><style>html{scroll-behavior:smooth}body{margin:0}</style></head><body><h1>Capture fixture</h1>${req.url?.endsWith("broken.html") ? '<img src="missing.png" alt="Missing fixture">' : '<div style="height:19000px">Long article</div><img src="swatch.svg" alt="Lazy image fixture" width="80" height="80" loading="lazy" decoding="async" style="display:block"><footer style="height:40px">End</footer>'}</body></html>`);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		rmSync(output, { recursive: true, force: true });
	});
	const result = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [scriptPath, output, `http://127.0.0.1:${server.address().port}/docs/`, "fixture", "long.html", "broken.html"], { env: { ...process.env, DOCS_SHOTS_VIEWPORTS: "390x844" }, stdio: ["ignore", "pipe", "pipe"] });
		let text = "";
		child.stdout.on("data", (chunk) => { text += chunk; });
		child.stderr.on("data", (chunk) => { text += chunk; });
		child.once("error", reject);
		child.once("close", (code) => resolve({ code, text }));
	});
	assert.equal(result.code, 1, result.text);
	const manifest = JSON.parse(readFileSync(path.join(output, "manifest.json"), "utf8"));
	const long = manifest.find((entry) => entry.url.endsWith("long.html"));
	assert.equal(long.documentStatus, 200);
	assert.ok(long.pageHeight > 19000);
	assert.equal(readFileSync(path.join(output, long.file)).readUInt32BE(20), long.pageHeight, "full-page screenshots must not truncate at 16000px");
	assert.equal(readFileSync(path.join(output, long.viewportFile)).readUInt32BE(20), 844);
	assert.deepEqual(long.failedRequests, []);
	const pixel = await sharp(path.join(output, long.file)).extract({ left: 40, top: long.pageHeight - 80, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
	assert.deepEqual([...pixel], [240, 40, 20], "a decoded lazy image below the fold must be painted, not left as a blank reservation");
	const broken = manifest.find((entry) => entry.url.endsWith("broken.html"));
	assert.ok(broken.brokenImages.some((url) => url.endsWith("missing.png")));
	assert.ok(broken.failedRequests.some((request) => request.includes("404")));
});
