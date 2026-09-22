import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { browserDebuggerPort, browserProcesses, classifyNewProcesses, cleanupBrowser, createChildCleanup, hasBrowserProfile, ownedDescendants, processIdentity, processSnapshot } from "../scripts/lib/process-ownership.mjs";

const row = (pid, parentPid, createdAt, commandLine = "node harness.mjs", name = "node.exe") => ({ pid, parentPid, createdAt, commandLine, name });
const startedAt = "2026-09-21T01:00:00.000Z";
const later = "2026-09-21T01:00:01.000Z";

test("product names and headless flags confer no cleanup authority", () => {
	const root = row(10, 1, startedAt);
	const own = row(11, 10, later);
	const retail = row(12, 999, later, "node com.lawrensen.hwinfo.sdPlugin/bin/plugin.js");
	const otherBrowser = row(13, 999, later, "chrome --headless=new", "chrome.exe");
	assert.deepEqual(ownedDescendants([root, own, retail, otherBrowser], new Set([processIdentity(root)])).map((p) => p.pid), [10, 11]);
	assert.deepEqual(classifyNewProcesses([root], [root, own, retail, otherBrowser], [root, own]), { owned: [own], ambiguous: [], unrelated: [retail, otherBrowser] });
});

test("unobserved descendants of exited processes are possible leaks, never kill targets", () => {
	const root = row(10, 1, startedAt);
	const step = row(11, 10, later);
	const unseen = row(12, 11, later);
	assert.deepEqual(classifyNewProcesses([root], [root, unseen], [root, step]), { owned: [], ambiguous: [unseen], unrelated: [] });
});

test("missing intermediate ancestors cannot hide processes in this run's directories", () => {
	const root = row(10, 1, startedAt);
	const step = row(11, 10, later);
	const scope = "C:\\Temp\\hwinfo-suite-browser-owned";
	const unseen = row(13, 12, later, `chrome --type=renderer --user-data-dir=${scope}\\pi-capture-profile-child`, "chrome.exe");
	const other = row(14, 99, later, `chrome --user-data-dir=${scope}-other\\pi-capture-profile-child`, "chrome.exe");
	assert.deepEqual(classifyNewProcesses([root], [root, unseen, other], [root, step], [scope]), { owned: [], ambiguous: [unseen], unrelated: [other] });
});

test("recorded identities retain descendants but reject PID reuse and missing ancestors", () => {
	const root = row(10, 1, startedAt);
	const own = row(11, 10, later);
	const grandchild = row(12, 11, later);
	const known = new Set(ownedDescendants([grandchild, own, root], new Set([processIdentity(root)])).map(processIdentity));
	assert.deepEqual(ownedDescendants([grandchild], known), [grandchild]);
	assert.deepEqual(ownedDescendants([row(11, 999, "2026-09-21T02:00:00.000Z"), row(13, 11, "2026-09-21T02:00:01.000Z")], known), []);
	assert.deepEqual(ownedDescendants([row(20, 10, startedAt)], new Set([processIdentity(root)])), []);
	assert.deepEqual(ownedDescendants([root, row(21, 10, "2026-09-20T23:00:00.000Z")], new Set([processIdentity(root)])).map((p) => p.pid), [10]);
});

test("browser cleanup matches the exact unique profile and its descendants", () => {
	const profile = "C:\\Temp Space\\pi-persist-profile-owned";
	assert.equal(hasBrowserProfile(`chrome "--user-data-dir=${profile}" --headless`, profile), true);
	assert.equal(hasBrowserProfile(`chrome --user-data-dir="${profile}" --headless`, profile), true);
	assert.equal(hasBrowserProfile(`chrome "--user-data-dir=${profile}-other"`, profile), false);
	assert.equal(hasBrowserProfile(`chrome --title="--user-data-dir=${profile}"`, profile), false);
	const browser = row(50, 10, later, `chrome "--user-data-dir=${profile}"`, "chrome.exe");
	const renderer = row(51, 50, later, "chrome --type=renderer", "chrome.exe");
	const unrelated = row(52, 999, later, `chrome "--user-data-dir=${profile}-other"`, "chrome.exe");
	const previous = row(53, 999, "2026-09-20T00:00:00.000Z", `chrome "--user-data-dir=${profile}"`, "chrome.exe");
	assert.deepEqual(browserProcesses([browser, renderer, unrelated, previous], profile, startedAt).map((p) => p.pid), [50, 51]);
});

test("browser cleanup reports survivors even after their observed parent exits", () => {
	const profile = "C:\\Temp\\owned-profile";
	const browser = row(50, 10, later, `chrome --user-data-dir=${profile}`, "chrome.exe");
	const renderer = row(51, 50, later, "chrome --type=renderer", "chrome.exe");
	const snapshots = [[browser, renderer], [renderer], [renderer]];
	const terminated = [];
	assert.throws(() => cleanupBrowser(profile, startedAt, { snapshot: () => snapshots.shift(), terminate: (rows) => terminated.push(rows.map((p) => p.pid)) }), /left 1 owned process/);
	assert.deepEqual(terminated, [[50, 51], [51]]);
});

test("browser cleanup succeeds only after the final snapshot proves exit", () => {
	const profile = "C:\\Temp\\owned-profile";
	const browser = row(50, 10, later, `chrome --user-data-dir=${profile}`, "chrome.exe");
	const unrelated = row(90, 99, later, "chrome --headless", "chrome.exe");
	const snapshots = [[browser, unrelated], [unrelated], [unrelated]];
	const terminated = [];
	cleanupBrowser(profile, startedAt, { snapshot: () => snapshots.shift(), terminate: (rows) => terminated.push(rows.map((p) => p.pid)) });
	assert.deepEqual(terminated, [[50], []]);
});

test("capture cleanup retains an observed plugin when its harness has exited", () => {
	const root = row(10, 1, startedAt);
	const harness = row(11, 10, later);
	const plugin = row(12, 11, later);
	const unrelated = row(99, 999, later);
	const snapshots = [[root, unrelated], [root, harness, plugin, unrelated], [root, plugin, unrelated], [root, unrelated], [root, unrelated]];
	const terminated = [];
	const children = createChildCleanup({ pid: 10, snapshot: () => snapshots.shift(), terminate: (rows) => terminated.push(rows.map((p) => p.pid)) });
	children.observe();
	children.cleanup();
	assert.deepEqual(terminated, [[12], []]);
});

test("capture cleanup reports unobserved orphans without killing or reused-PID authority", () => {
	const root = row(10, 1, startedAt);
	const harness = row(11, 10, later);
	const reused = row(11, 999, "2026-09-21T02:00:00.000Z");
	const orphan = row(12, 11, later);
	const snapshots = [[root], [root, harness], [root, reused, orphan], [root, reused, orphan], [root, reused, orphan]];
	const terminated = [];
	const children = createChildCleanup({ pid: 10, snapshot: () => snapshots.shift(), terminate: (rows) => terminated.push(rows.map((p) => p.pid)) });
	children.observe();
	assert.throws(() => children.cleanup(), /0 owned and 1 ambiguous/);
	assert.deepEqual(terminated, [[], []]);
});

test("capture cleanup fails when a recorded child survives termination", () => {
	const root = row(10, 1, startedAt);
	const child = row(11, 10, later);
	const snapshots = [[root], [root, child], [root, child], [root, child]];
	const children = createChildCleanup({ pid: 10, snapshot: () => snapshots.shift(), terminate: () => {} });
	assert.throws(() => children.cleanup(), /1 owned and 0 ambiguous/);
});

test("capture cleanup fails for an unobserved ancestor inside its run directory without killing it", () => {
	const root = row(10, 1, startedAt);
	const directory = "C:\\Temp\\owned-worktree\\plugin";
	const orphan = row(12, 11, later, `node "${directory}\\bin\\plugin.js"`);
	const snapshots = [[root], [root, orphan], [root, orphan], [root, orphan]];
	const terminated = [];
	const children = createChildCleanup({ pid: 10, snapshot: () => snapshots.shift(), terminate: (rows) => terminated.push(rows), runDirectories: [directory] });
	assert.throws(() => children.cleanup(), /0 owned and 1 ambiguous/);
	assert.deepEqual(terminated, [[], []]);
});

test("process snapshot fails closed on query failures, empty output, and malformed identities", () => {
	assert.throws(() => processSnapshot({ execute: () => { throw new Error("CIM unavailable"); } }), /CIM unavailable/);
	for (const output of ["", " ", "null", "{}", "[{\"pid\":1}]"]) assert.throws(() => processSnapshot({ execute: () => output }));
	const expected = [row(10, 1, startedAt)];
	assert.deepEqual(processSnapshot({ execute: (_file, args) => {
		assert.match(args[2], /\$ErrorActionPreference = 'Stop'/);
		assert.match(args[2], /-ErrorAction Stop/);
		return JSON.stringify(expected);
	} }), expected);
});

test("browser debugger port comes from the exact disposable profile and validates its range", () => {
	const profile = mkdtempSync(path.join(os.tmpdir(), "hwinfo-debug-port-"));
	try {
		assert.throws(() => browserDebuggerPort(profile), /ENOENT/);
		for (const value of ["0", "-1", "65536", "1.5", "NaN", ""]) {
			writeFileSync(path.join(profile, "DevToolsActivePort"), `${value}\n/devtools/browser/owned`);
			assert.throws(() => browserDebuggerPort(profile), /Invalid browser debugger port/);
		}
		writeFileSync(path.join(profile, "DevToolsActivePort"), "54321\r\n/devtools/browser/owned");
		assert.equal(browserDebuggerPort(profile), 54321);
	} finally {
		rmSync(profile, { recursive: true, force: true });
	}
});
