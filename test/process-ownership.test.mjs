import assert from "node:assert/strict";
import { test } from "node:test";
import { browserProcesses, classifyNewProcesses, hasBrowserProfile, ownedDescendants, processIdentity } from "../scripts/lib/process-ownership.mjs";

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
