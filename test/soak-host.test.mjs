import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { creationMs, selectSoakHost } from "../scripts/lib/soak-host.mjs";

const host = (pid = 20, session = 1, started = 1000) => ({
	Name: "StreamDeck.exe", ProcessId: pid, SessionId: session, CreationDate: `/Date(${started})/`
});
const plugin = (parent = 20, session = 1, started = 2000) => ({
	Name: "node.exe", ProcessId: 10, ParentProcessId: parent, SessionId: session, CreationDate: `/Date(${started})/`
});

describe("soak host attribution", () => {
	it("never establishes an association while the plugin is absent", () => {
		for (const hosts of [[], [host()], [host(30, 2)], [host(), host(30, 2)]]) {
			const result = selectSoakHost(null, hosts);
			assert.equal(result.host, null);
			assert.equal(result.identity, null);
			assert.equal(result.matches, 0);
		}
	});

	it("prefers a verified parent over other eligible hosts, regardless of ordering", () => {
		const parent = host();
		for (const hosts of [[host(30), parent], [parent, host(30)]]) {
			const result = selectSoakHost(plugin(), hosts);
			assert.equal(result.host, parent);
			assert.deepEqual(result.identity, { pid: 20, startedMs: 1000, sessionId: 1 });
		}
	});

	it("requires a parent to be in the plugin session and no newer than the plugin", () => {
		for (const invalidParent of [host(20, 2), host(20, 1, 3000)]) {
			assert.equal(selectSoakHost(plugin(), [invalidParent]).host, null);
			const fallback = host(30);
			assert.equal(selectSoakHost(plugin(), [invalidParent, fallback]).host, fallback);
		}
		assert.equal(selectSoakHost(plugin(), [host(20, 1, 2000)]).host.ProcessId, 20);
	});

	it("uses only a unique eligible session fallback and fails closed on ambiguity", () => {
		const fallback = host(30);
		assert.equal(selectSoakHost(plugin(99), [host(40, 2), host(50, 1, 3000), fallback]).host, fallback);
		const prior = selectSoakHost(plugin(30), [fallback]).identity;
		const result = selectSoakHost(plugin(99), [host(40), fallback], prior);
		assert.equal(result.host, null);
		assert.equal(result.identity, null);
		assert.equal(result.matches, 2);
		assert.equal(result.reason, "host-ambiguous");
	});

	it("retains only the known PID, creation and session lifetime during plugin absence", () => {
		const original = host();
		const prior = selectSoakHost(plugin(), [original]).identity;
		assert.equal(selectSoakHost(null, [host(30), original, host(40, 2)], prior).host, original);
		for (const replacement of [host(30), host(20, 2), host(20, 1, 3000)]) {
			assert.equal(selectSoakHost(null, [replacement], prior).host, null);
		}
		const missing = selectSoakHost(null, [], prior);
		assert.equal(missing.host, null);
		assert.deepEqual(missing.identity, prior);
		assert.equal(selectSoakHost(null, [original], missing.identity).host, original);
	});

	it("clears the old association when a present plugin cannot identify its host", () => {
		const original = host();
		const prior = selectSoakHost(plugin(), [original]).identity;
		const moved = selectSoakHost(plugin(99, 2), [original], prior);
		assert.equal(moved.identity, null);
		assert.equal(selectSoakHost(null, [original], moved.identity).host, null);
	});

	it("rejects missing or malformed process identity evidence", () => {
		for (const [field, value] of [
			["SessionId", undefined], ["SessionId", null], ["SessionId", "1"],
			["SessionId", -1], ["ProcessId", 0], ["CreationDate", undefined],
			["CreationDate", ""], ["CreationDate", "invalid"], ["CreationDate", 1000]
		]) {
			assert.equal(selectSoakHost({ ...plugin(), [field]: value }, [host()]).host, null);
			const badHost = { ...host(), [field]: value };
			assert.equal(selectSoakHost(plugin(), [badHost]).host, null);
			const prior = selectSoakHost(plugin(), [host()]).identity;
			assert.equal(selectSoakHost(null, [badHost], prior).host, null);
		}
		assert.equal(selectSoakHost(plugin(), [{ ...host(), Name: "unrelated.exe" }]).host, null);
	});

	it("treats duplicate lifetime observations as ambiguous", () => {
		const prior = selectSoakHost(plugin(), [host()]).identity;
		for (const target of [null, plugin()]) {
			const result = selectSoakHost(target, [host(), host()], prior);
			assert.equal(result.host, null);
			assert.equal(result.reason, "host-ambiguous");
		}
	});

	it("normalizes supported creation formats without using an offset as a new identity", () => {
		assert.equal(creationMs("/Date(1000)/"), 1000);
		assert.equal(creationMs("/Date(1000-0700)/"), 1000);
		assert.equal(creationMs("1970-01-01T00:00:01.000Z"), 1000);
		assert.equal(creationMs("1970-01-01T01:00:01+01:00"), 1000);
		for (const bad of [null, undefined, "0", "prefix/Date(1000)/", "/Date(-1)/", "/Date(9007199254740992)/"]) {
			assert.equal(creationMs(bad), null);
		}
	});
});
