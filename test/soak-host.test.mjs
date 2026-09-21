import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { creationMs, selectSoakHost } from "../scripts/lib/soak-host.mjs";
import { makeLogTail } from "../scripts/lib/soak-log-tail.mjs";

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

// The soak gate's "New log WARN / ERROR lines" reads the plugin log through
// this tail. The SDK rotates the log on every plugin start (.0.log becomes
// .1.log, a fresh .0.log opens), so the lines written between the last poll
// and a restart sit in the ROTATED file: the window a soak most needs.
describe("soak log tail across a rotation", () => {
	const WARN = "2026-09-18T00:00:10.000Z WARN  HwinfoPoller: HWiNFO unavailable [busy]\n";
	const ERROR = "2026-09-18T00:00:11.000Z ERROR Uncaught exception: boom\n";
	const INFO = "2026-09-18T00:00:12.000Z INFO  Device known: Stream Deck (StreamDeck, 5x3)\n";

	/** A synthetic log directory with a clock of its own: every write stamps
	 * the next second, so "newest by mtime" never rides on timer resolution. */
	function logDir(t) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-soak-tail-"));
		t.after(() => {
			assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
			assert(path.basename(dir).startsWith("hwinfo-soak-tail-"));
			fs.rmSync(dir, { recursive: true, force: true });
		});
		let clock = 1_800_000_000;
		const log = (index) => path.join(dir, `com.lawrensen.hwinfo.${index}.log`);
		const append = (index, text) => {
			fs.appendFileSync(log(index), text);
			clock++;
			fs.utimesSync(log(index), clock, clock);
		};
		/** The SDK's reIndex: shift every index up by one, then open a fresh .0.log. */
		const rotate = (firstLines) => {
			for (let i = 8; i >= 0; i--) {
				if (fs.existsSync(log(i))) fs.renameSync(log(i), log(i + 1));
			}
			append(0, firstLines);
		};
		return { dir, log, append, rotate };
	}

	it("fails closed on stat/open rotation races and retries the ERROR tail", (t) => {
		const { dir, log, append, rotate } = logDir(t);
		append(0, INFO);
		const poll = makeLogTail(dir);
		poll();
		append(0, ERROR);
		const realOpen = fs.openSync;
		let changed = false;
		try {
			fs.openSync = (file, ...args) => {
				if (file === log(0) && !changed) { changed = true; rotate(INFO); }
				return realOpen(file, ...args);
			};
			assert.throws(() => poll(), /observation incomplete/);
		} finally { fs.openSync = realOpen; }
		assert.deepEqual(poll(), { warn: 0, error: 1, note: "log-rotated" });
		assert.deepEqual(poll(), { warn: 0, error: 0, note: "" });
	});

	it("never advances the old cursor after a short read during rotation", (t) => {
		const { dir, append, rotate } = logDir(t);
		append(0, INFO);
		const poll = makeLogTail(dir);
		poll();
		append(0, ERROR);
		rotate(INFO + WARN);
		const realRead = fs.readSync;
		try {
			fs.readSync = (fd, buf, offset, length, position) => realRead(fd, buf, offset, length - 1, position);
			assert.throws(() => poll(), /observation incomplete/);
		} finally { fs.readSync = realRead; }
		assert.deepEqual(poll(), { warn: 1, error: 1, note: "log-rotated" });
		assert.deepEqual(poll(), { warn: 0, error: 0, note: "" });
	});

	it("counts the lines written between the last poll and the rotation", (t) => {
		const { dir, append, rotate } = logDir(t);
		append(0, INFO);
		const poll = makeLogTail(dir);
		assert.deepEqual(poll(), { warn: 0, error: 0, note: "" });
		append(0, WARN);
		rotate(INFO);
		assert.deepEqual(poll(), { warn: 1, error: 0, note: "log-rotated" });
		assert.deepEqual(poll(), { warn: 0, error: 0, note: "" });
	});

	it("a poll between the SDK's rename and its first new line re-counts nothing", (t) => {
		const { dir, log, append } = logDir(t);
		append(0, WARN + WARN + ERROR); // history from before the soak
		const poll = makeLogTail(dir);
		poll();
		append(0, WARN);
		assert.deepEqual(poll(), { warn: 1, error: 0, note: "" });
		// A plugin start renames the log away; the new one does not exist
		// until the plugin writes its first line.
		fs.renameSync(log(0), log(1));
		assert.deepEqual(poll(), { warn: 0, error: 0, note: "" });
		fs.appendFileSync(log(1), ERROR); // the old process's last words
		append(0, INFO + WARN);
		assert.deepEqual(poll(), { warn: 1, error: 1, note: "log-rotated" });
	});

	it("counts both sides of the rotation once, and never the history from before the soak", (t) => {
		const { dir, append, rotate } = logDir(t);
		append(1, ERROR + ERROR); // an older log, already rotated before the soak
		append(0, WARN + WARN); // the live log's own history: the baseline
		const poll = makeLogTail(dir);
		poll();
		append(0, INFO);
		assert.deepEqual(poll(), { warn: 0, error: 0, note: "" });
		append(0, ERROR);
		rotate(INFO + WARN);
		assert.deepEqual(poll(), { warn: 1, error: 1, note: "log-rotated" });
		append(0, ERROR);
		assert.deepEqual(poll(), { warn: 0, error: 1, note: "" });
	});

	it("two restarts inside one interval: the log between them is counted whole", (t) => {
		const { dir, append, rotate } = logDir(t);
		append(1, ERROR); // history
		append(0, INFO);
		const poll = makeLogTail(dir);
		poll();
		append(0, WARN);
		rotate(INFO + ERROR); // first restart: this log is never the newest at a poll
		rotate(INFO + WARN); // second restart
		assert.deepEqual(poll(), { warn: 2, error: 1, note: "log-rotated" });
	});

	it("a tail that is gone is reported, never a silent zero", (t) => {
		const { dir, log, append } = logDir(t);
		append(0, INFO);
		const poll = makeLogTail(dir);
		poll();
		append(0, ERROR);
		// Pruned at the SDK's file cap: the tailed file leaves the directory.
		// The replacement exists before the old one goes, so the two can
		// never share a file identity.
		append(9, INFO);
		fs.rmSync(log(0));
		fs.renameSync(log(9), log(0));
		assert.deepEqual(poll(), { warn: 0, error: 0, note: "log-rotated-tail-lost" });
	});

	it("harness device lines stay excluded on both sides", (t) => {
		const { dir, append, rotate } = logDir(t);
		append(0, INFO);
		const poll = makeLogTail(dir);
		poll();
		append(0, "2026-09-18T00:00:13.000Z WARN  Device gone: Harness Deck\n" + ERROR);
		rotate("2026-09-18T00:00:14.000Z WARN  Device gone: Load Deck\n");
		assert.deepEqual(poll(), { warn: 0, error: 1, note: "log-rotated" });
	});
});
