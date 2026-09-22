// Pairing edits (readingLinks) take effect at the settings commit, and only
// a change in meaning is a change.
//
// The poller holds the provider's own observation and derives the published
// snapshot from it, so removing, replacing or restoring a pair republishes at
// once (no wait for a new read, no dependence on the poll cadence) through
// the same tick event a read emits, without inventing a sample: sessions
// and rings dedupe on producer evidence, and a ring or session ends only
// for a saved key that now stands for a different measurement.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HwinfoError, SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { poller, type PollerStatus } from "../src/poller";
import { SessionStatsStore } from "../src/stats";

type Provider = { source: "shared-memory" | "gadget"; read(): SensorSnapshot | null; close(): void };
type Subject = Pick<typeof poller, "setReadingLinks" | "getStatus" | "onTick" | "subscribeSeries" | "getSeries"> & {
	openProvider(): Provider;
	tick(): void;
	lastAdvanceAt: number;
	lastReopenProbeAt: number;
	bindingRevision: number;
};
const isolated = (): Subject => new (poller.constructor as unknown as { new (): Subject })();

const SM = "f0001234:0:1000001";
const SM2 = "f0001234:0:1000002";
const G = "g:Test Source:Test Temp";
const G2 = "g:Test Source:Other Temp";
const A = { sharedMemory: SM, gadget: G, unit: "°C", sensorType: 1 };
const B = { sharedMemory: SM, gadget: G2, unit: "°C", sensorType: 1 };
const C = { sharedMemory: SM2, gadget: G2, unit: "°C", sensorType: 1 };
const REPAIRED = { sharedMemory: SM2, gadget: G, unit: "°C", sensorType: 1 };

function snap(pollTime: number, value: number, second = 70): SensorSnapshot {
	const r1: Reading = { key: SM, type: SensorType.Temperature, sensorIndex: 0, id: 1, label: "Test Temp", unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value };
	const r2: Reading = { ...r1, key: SM2, id: 2, label: "Other Temp", value: second };
	return { pollTime, valueRevision: pollTime, freshnessRevision: pollTime, version: 1, revision: 1, sensors: [{ index: 0, id: 0xf0001234, instance: 0, name: "Test Source" }], readings: [r1, r2], byKey: new Map([[SM, r1], [SM2, r2]]) };
}

function view(s: Subject): { state: string; alias: number | undefined; alias2: number | undefined; revision: number | undefined; linked: readonly string[] | undefined } {
	const st = s.getStatus();
	const snapshot = st.state === "unavailable" ? undefined : st.snapshot;
	return { state: st.state, alias: snapshot?.byKey.get(G)?.value, alias2: snapshot?.byKey.get(G2)?.value, revision: snapshot?.bindingRevision, linked: snapshot?.byKey.get(SM)?.linkedKeys };
}

/** An ok status carrying link A, one successful read behind it, with counters. */
function withLinkA(): { s: Subject; reads: { fn: () => SensorSnapshot | null; count: number }; ticks: () => number } {
	const s = isolated();
	s.setReadingLinks([A]);
	const reads = { fn: (): SensorSnapshot | null => snap(100, 40), count: 0 };
	s.openProvider = () => ({ source: "shared-memory", read: () => { reads.count++; return reads.fn(); }, close() {} });
	let emitted = 0;
	s.onTick(() => { emitted++; });
	s.tick();
	assert.deepEqual(view(s), { state: "ok", alias: 40, alias2: undefined, revision: 1, linked: [SM, G] }, "precondition: link A is live");
	return { s, reads, ticks: () => emitted };
}

describe("pairing edits republish the held observation at the commit", () => {
	it("removing the only pair stops the alias at once, with one tick and no read", () => {
		const { s, reads, ticks } = withLinkA();
		const before = { reads: reads.count, ticks: ticks() };
		s.setReadingLinks([]);
		assert.deepEqual(view(s), { state: "ok", alias: undefined, alias2: undefined, revision: 2, linked: undefined });
		assert.equal(reads.count, before.reads, "no read was performed");
		assert.equal(ticks(), before.ticks + 1, "consumers were told once");
	});

	it("replacing, restoring, malformed and conflicting edits each derive from the raw observation", () => {
		const { s } = withLinkA();
		s.setReadingLinks([B]);
		assert.deepEqual(view(s), { state: "ok", alias: undefined, alias2: 40, revision: 2, linked: [SM, G2] });
		s.setReadingLinks("junk");
		assert.deepEqual(view(s), { state: "ok", alias: undefined, alias2: undefined, revision: 3, linked: undefined });
		s.setReadingLinks([A]);
		assert.deepEqual(view(s), { state: "ok", alias: 40, alias2: undefined, revision: 4, linked: [SM, G] });
		s.setReadingLinks([A, { ...A, gadget: G2 }]);
		assert.deepEqual(view(s), { state: "ok", alias: undefined, alias2: undefined, revision: 5, linked: undefined }, "conflicting pairs are all refused");
	});

	it("a stale status is re-derived too and keeps its state", () => {
		const { s } = withLinkA();
		s.lastAdvanceAt = -60_000;
		s.lastReopenProbeAt = Number.POSITIVE_INFINITY;
		s.tick();
		assert.equal(s.getStatus().state, "stale");
		s.setReadingLinks([]);
		const status = s.getStatus();
		assert.equal(status.state, "stale");
		assert.equal(view(s).alias, undefined);
		assert.equal(view(s).revision, 2);
	});

	it("skipped reads and held transient failures after the edit keep the new pairing", () => {
		const { s, reads } = withLinkA();
		reads.fn = () => null;
		s.setReadingLinks([]);
		for (let i = 0; i < 3; i++) {
			s.tick();
			assert.deepEqual(view(s), { state: "ok", alias: undefined, alias2: undefined, revision: 2, linked: undefined });
		}
		reads.fn = () => { throw new HwinfoError("busy", "synthetic"); };
		s.tick();
		assert.equal(view(s).state, "ok", "a transient failure inside the freshness window rides on the held status");
		assert.equal(view(s).alias, undefined);
	});

	it("the next real read carries the same pairing and revision", () => {
		const { s, reads } = withLinkA();
		s.setReadingLinks([]);
		reads.fn = () => snap(101, 41);
		s.tick();
		assert.deepEqual(view(s), { state: "ok", alias: undefined, alias2: undefined, revision: 2, linked: undefined });
	});
});

describe("the first delivery of an absent or empty document is not a change", () => {
	for (const raw of [undefined, null, [], "junk", [{ bad: true }]]) {
		it(`launch with ${JSON.stringify(raw) ?? "undefined"} emits nothing and leaves the revision at 0`, () => {
			const s = isolated();
			s.openProvider = () => ({ source: "shared-memory", read: () => snap(100, 40), close() {} });
			s.subscribeSeries(SM);
			s.tick();
			let emitted = 0;
			s.onTick(() => { emitted++; });
			s.setReadingLinks(raw);
			assert.equal(s.bindingRevision, 0);
			assert.equal(emitted, 0);
			assert.deepEqual([...(s.getSeries(SM) ?? [])], [40]);
		});
	}
});

describe("re-applying or reordering the same pairs changes nothing", () => {
	it("document order is not meaning", () => {
		const s = isolated();
		s.setReadingLinks([A, C]);
		s.openProvider = () => ({ source: "shared-memory", read: () => snap(100, 40), close() {} });
		s.subscribeSeries(SM);
		let emitted = 0;
		s.onTick(() => { emitted++; });
		s.tick();
		const revision = s.bindingRevision;
		const ring = [...(s.getSeries(SM) ?? [])];
		assert.deepEqual(ring, [40]);
		s.setReadingLinks([C, A]);
		assert.equal(s.bindingRevision, revision, "a reorder is not a change");
		assert.equal(emitted, 1, "nothing was republished");
		assert.deepEqual([...(s.getSeries(SM) ?? [])], ring, "history is untouched");
		s.setReadingLinks([{ ...A, unit: "°C", sensorType: 1, extra: true } as unknown as typeof A, C]);
		assert.equal(s.bindingRevision, revision, "unknown fields and identical re-applies are no-ops");
		for (const change of [[A], [A, C, { sharedMemory: "f0001234:0:1000003", gadget: "g:Test Source:Third", unit: "°C", sensorType: 1 }], [B, C], [{ ...A, unit: "°F" }, C], [{ ...A, sensorType: 5 }, C]]) {
			const before = s.bindingRevision;
			s.setReadingLinks(change);
			assert.equal(s.bindingRevision, before + 1, `a real change bumps the revision: ${JSON.stringify(change)}`);
		}
	});
});

describe("a pairing edit is not evidence", () => {
	it("launch: the globals reply that merely delivers saved links resets no session and no ring", () => {
		const s = isolated();
		s.subscribeSeries(SM);
		let value = 40;
		let pollTime = 100;
		s.openProvider = () => ({ source: "shared-memory", read: () => snap(pollTime, value), close() {} });
		const store = new SessionStatsStore();
		// willAppear: retain runs the first tick before any globals arrive.
		s.tick();
		let status = s.getStatus() as Extract<PollerStatus, { state: "ok" }>;
		assert.equal(store.observe(status.snapshot.byKey.get(SM) as Reading, status.snapshot, status.source), undefined);
		assert.deepEqual([...(s.getSeries(SM) ?? [])], [40]);
		// didReceiveGlobalSettings hands the saved pairs to the poller.
		s.setReadingLinks([A]);
		status = s.getStatus() as Extract<PollerStatus, { state: "ok" }>;
		assert.equal(store.observe(status.snapshot.byKey.get(SM) as Reading, status.snapshot, status.source), undefined, "the same measurement gained an alias; that is not a pairing change for its session");
		assert.equal(store.get(SM)?.count, 1, "the re-emit added no sample");
		assert.deepEqual([...(s.getSeries(SM) ?? [])], [40], "the ring kept its history");
		value = 41;
		pollTime = 101;
		s.tick();
		status = s.getStatus() as Extract<PollerStatus, { state: "ok" }>;
		assert.equal(store.observe(status.snapshot.byKey.get(SM) as Reading, status.snapshot, status.source), undefined);
		assert.equal(store.get(SM)?.count, 2);
		assert.deepEqual([...(s.getSeries(SM) ?? [])], [40, 41]);
	});

	it("a saved key that comes to stand for another measurement ends its session and its ring", () => {
		const s = isolated();
		s.setReadingLinks([A]);
		s.subscribeSeries(G);
		let pollTime = 100;
		s.openProvider = () => ({ source: "shared-memory", read: () => snap(pollTime, 40 + (pollTime - 100)), close() {} });
		const store = new SessionStatsStore();
		s.tick();
		pollTime = 101;
		s.tick();
		let status = s.getStatus() as Extract<PollerStatus, { state: "ok" }>;
		store.observe(status.snapshot.byKey.get(G) as Reading, status.snapshot, status.source);
		assert.deepEqual([...(s.getSeries(G) ?? [])], [40, 41]);
		assert.equal(store.get(G)?.count, 1);
		// The Gadget key is re-paired to the other shared-memory reading. The
		// consumer told about it must never see the old measurement's samples
		// under the key's new meaning.
		let ringAtEmit: number[] | undefined;
		s.onTick(() => { ringAtEmit ??= [...(s.getSeries(G) ?? [])]; });
		s.setReadingLinks([REPAIRED]);
		assert.deepEqual(ringAtEmit, [], "the ring ended its segment before the re-emit");
		status = s.getStatus() as Extract<PollerStatus, { state: "ok" }>;
		assert.equal(status.snapshot.byKey.get(G)?.value, 70, "G now resolves to the other measurement at once");
		assert.equal(store.observe(status.snapshot.byKey.get(G) as Reading, status.snapshot, status.source), "binding");
		assert.deepEqual(store.get(G), { min: 70, max: 70, sum: 70, count: 1 }, "the session restarted from the new measurement");
		pollTime = 102;
		s.tick();
		assert.deepEqual([...(s.getSeries(G) ?? [])], [70], "the ring ended its old segment and holds only the new measurement");
	});
});
