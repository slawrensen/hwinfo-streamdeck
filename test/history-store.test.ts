/**
 * The timestamped history store (src/history/store.ts) and its window
 * parser, driven with injected times and no timers: aggregation, every gap
 * reason, segment ends at the last sample, tier bounds independent of the
 * poll rate, the byte budget, the linger, and interest by consumer id.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLOSED_SEGMENTS, GROUP_HISTORY_BUDGET_BYTES, HISTORY_BUDGET_BYTES, HistoryStore, LINGER_MS, type HistoryTick } from "../src/history/store";
import type { HistoryView, HistoryWindowId } from "../src/history/types";
import { ENTRY_BYTES, HISTORY_WINDOWS, parseHistoryWindow, TIERS } from "../src/history/window";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { briefGapFixture, pollTrace, skipsAt } from "./brief-gap-fixture";

const KEY = "cpu:0:1";
const T1_BYTES = 168 * ENTRY_BYTES;
/** The Group panes' allowance, untouched by every key and dial here. */
const NO_GROUP = { bytes: 0, budget: GROUP_HISTORY_BUDGET_BYTES, overflow: 0 };

function reading(key: string, value: number, over: Partial<Reading> = {}): Reading {
	return { key, type: SensorType.Temperature, sensorIndex: 0, id: 1, label: "CPU", unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value, ...over };
}

function snap(...readings: Reading[]): SensorSnapshot {
	return { pollTime: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

function ok(at: number, snapshot: SensorSnapshot, over: Partial<Extract<HistoryTick, { kind: "ok" }>> = {}): HistoryTick {
	return { kind: "ok", at, snapshot, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0, ...over };
}

/** A store on a hand-moved clock, with one consumer on KEY. */
function fixture(window: HistoryWindowId | readonly HistoryWindowId[] = "1m", options: { budgetBytes?: number } = {}) {
	const logs: string[] = [];
	const clock = { now: 1_000 };
	const store = new HistoryStore({ now: () => clock.now, log: (line) => void logs.push(line), ...options });
	store.setInterest("key-1", [{ savedKey: KEY, window }]);
	/** Ingests a sample of KEY at `at` (the clock follows). */
	const sample = (at: number, value: number, over: Partial<Reading> = {}, tick: Partial<Extract<HistoryTick, { kind: "ok" }>> = {}): void => {
		clock.now = at;
		store.ingest(ok(at, snap(reading(KEY, value, over)), tick));
	};
	const tick = (at: number, kind: "stale" | "unavailable" | "skipped"): void => {
		clock.now = at;
		store.ingest({ kind, at });
	};
	return { store, clock, logs, sample, tick };
}

describe("parseHistoryWindow reads exact strings only", () => {
	it("accepts 1m, 5m and 15m", () => {
		for (const id of ["1m", "5m", "15m"] as const) assert.equal(parseHistoryWindow(id), id);
	});
	it("everything else keeps the legacy line", () => {
		for (const raw of [undefined, null, "", 5, "5", "5M", " 5m", "5m ", "30m", "1h", {}, ["5m"], true, Number.NaN]) {
			assert.equal(parseHistoryWindow(raw), undefined, JSON.stringify(raw));
		}
	});
	it("each window has its own tier; widths are whole multiples, capacities cover the window with slack", () => {
		assert.deepEqual(Object.values(HISTORY_WINDOWS).map((w) => w.tier), [0, 1, 2]);
		for (const w of Object.values(HISTORY_WINDOWS)) {
			const tier = TIERS[w.tier] as { widthMs: number; capacity: number };
			assert.ok(tier.capacity > w.windowMs / tier.widthMs, "visible buckets fit with slack for segment splits");
		}
		assert.equal((TIERS[1] as { widthMs: number }).widthMs % (TIERS[0] as { widthMs: number }).widthMs, 0);
		assert.equal((TIERS[2] as { widthMs: number }).widthMs % (TIERS[1] as { widthMs: number }).widthMs, 0);
		assert.deepEqual(TIERS.map((t) => t.capacity * ENTRY_BYTES), [3168, 7392, 7392]);
		assert.equal(HISTORY_BUDGET_BYTES, 2 * 1024 * 1024);
		assert.equal(LINGER_MS, 16 * 60_000);
	});
});

describe("aggregation and evidence", () => {
	it("samples inside one bucket keep first, min, max and last exactly", () => {
		const f = fixture();
		f.sample(10_000, 5);
		f.sample(10_250, 1);
		f.sample(10_500, 9);
		f.sample(10_750, 3);
		const view = f.store.view(KEY, "1m", 60, 11_000);
		assert.ok(view);
		assert.equal(view.cols.n, 1, "one 1 s bucket, one column");
		assert.deepEqual([view.cols.first[0], view.cols.min[0], view.cols.max[0], view.cols.last[0]], [5, 1, 9, 3]);
		assert.deepEqual(view.extent, { min: 1, max: 9 });
	});

	it("samples across buckets give one column per bucket at its time", () => {
		const f = fixture();
		for (let s = 0; s < 5; s++) f.sample(10_000 + s * 1000, 50 + s);
		const view = f.store.view(KEY, "1m", 60, 15_000);
		assert.ok(view);
		// x = (t - (now - 60 s)) * 60 / 60 s: one pixel per second.
		assert.deepEqual([...view.cols.x], [55, 56, 57, 58, 59]);
		assert.deepEqual([...view.cols.last], [50, 51, 52, 53, 54]);
	});

	it("ticks without evidence add nothing and bump no revision", () => {
		const f = fixture();
		f.sample(10_000, 40);
		const revision = f.store.revision;
		for (let i = 1; i <= 30; i++) f.sample(10_000 + i * 500, 40 + i, {}, { evidence: false });
		assert.equal(f.store.revision, revision, "a held value is never a sample");
		assert.equal(f.store.view(KEY, "1m", 60, 25_000)?.cols.n, 1);
	});

	it("a steady value under an advancing stamp is a sample; a same-value repeat without one is not", () => {
		const f = fixture();
		f.sample(10_000, 40);
		f.sample(11_000, 40, {}, { stampAdvanced: true });
		f.sample(12_000, 40, {}, { stampAdvanced: false });
		f.sample(13_000, 41, {}, { stampAdvanced: false });
		const view = f.store.view(KEY, "1m", 60, 14_000);
		assert.deepEqual([...(view?.cols.x ?? [])], [56, 57, 59], "10 s, 11 s and 13 s; the 12 s repeat is the 11 s observation read twice");
	});

	it("the newest sample's evidence age is kept beside it and never moves a point", () => {
		const f = fixture();
		const g = fixture();
		assert.equal(f.store.evidenceAgeOf(KEY), undefined, "no sample yet");
		f.sample(10_000, 40, {}, { evidenceAgeMs: 12_000 });
		g.sample(10_000, 40);
		assert.equal(f.store.evidenceAgeOf(KEY), 12_000, "a stamp first seen 12 s after it was written");
		assert.deepEqual([...(f.store.view(KEY, "1m", 60, 11_000)?.cols.x ?? [])], [...(g.store.view(KEY, "1m", 60, 11_000)?.cols.x ?? [])], "placed at acquisition time either way");
		f.sample(11_000, 41, {}, { evidenceAgeMs: 0 });
		assert.equal(f.store.evidenceAgeOf(KEY), 0, "a value change between reads is live");
		f.sample(12_000, 42, {}, { evidenceAgeMs: 3000, evidence: false });
		assert.equal(f.store.evidenceAgeOf(KEY), 0, "a tick without evidence is no sample and keeps the age");
		f.sample(13_000, 43, {}, { evidenceAgeMs: Number.NaN });
		assert.equal(f.store.evidenceAgeOf(KEY), 0, "a junk age reads as live, never as NaN");
		f.tick(14_000, "stale");
		assert.equal(f.store.evidenceAgeOf(KEY), 0, "a closed run keeps its newest sample's age");
		assert.equal(f.store.evidenceAgeOf("other:0:1"), undefined);
	});
});

describe("gaps end a segment at its last sample", () => {
	for (const kind of ["stale", "unavailable", "skipped"] as const) {
		it(`${kind} closes the open segment at the last sample, and the next sample opens a new one`, () => {
			const f = fixture();
			f.sample(10_000, 40);
			f.sample(12_000, 41);
			f.tick(15_000, kind);
			f.sample(16_000, 42);
			const view = f.store.view(KEY, "1m", 60, 17_000);
			assert.ok(view);
			assert.equal(view.segments.length, 2);
			const [first, second] = view.segments;
			assert.equal(first?.endReason, kind);
			assert.equal(first?.open, false);
			assert.equal(first?.x1, (12_000 - (17_000 - 60_000)) / 1000, "the end is the last sample, not the detection at 15 s");
			assert.equal(second?.open, true);
			assert.deepEqual([...view.cols.seg], [0, 0, 1], "pen up between the runs");
		});
	}

	for (const [name, missing] of [["a withheld reading", "absent"], ["a NaN value", "nan"]] as const) {
		it(`${name} closes the segment as missing and never stores a value`, () => {
			const f = fixture();
			f.sample(10_000, 40);
			f.clock.now = 11_000;
			f.store.ingest(ok(11_000, missing === "absent" ? snap() : snap(reading(KEY, Number.NaN))));
			f.clock.now = 12_000;
			f.store.ingest(ok(12_000, missing === "absent" ? snap() : snap(reading(KEY, Number.NaN))));
			f.sample(13_000, 42);
			const view = f.store.view(KEY, "1m", 60, 14_000);
			assert.ok(view);
			assert.equal(view.segments[0]?.endReason, "missing");
			assert.deepEqual([...view.cols.x], [56, 59], "no column in the gap");
			assert.ok(![...view.cols.min].some((v) => v === 0 || !Number.isFinite(v)), "a gap never becomes a zero");
		});
	}

	const identity: Array<[string, Partial<Reading>, "unit" | "type" | "binding", string?]> = [
		["a unit rewrite", { unit: "°F" }, "unit"],
		["a type change", { type: SensorType.Other }, "type"],
		["a re-paired saved key", { aliasOf: "other:0:9" }, "binding"]
	];
	for (const [name, change, reason] of identity) {
		it(`${name} closes the segment with reason ${reason}`, () => {
			const f = fixture();
			f.sample(10_000, 40);
			f.sample(11_000, 41, change);
			const view = f.store.view(KEY, "1m", 60, 12_000);
			assert.ok(view);
			assert.equal(view.hidden.length, 1, "the older identity is left out");
			assert.equal(view.hidden[0]?.reason, reason);
			assert.equal(view.segments.length, 1);
			assert.equal(view.cols.n, 1);
		});
	}

	it("a source change closes the segment with reason source", () => {
		const f = fixture();
		f.sample(10_000, 40);
		f.clock.now = 11_000;
		f.store.ingest({ ...ok(11_000, snap(reading(KEY, 41))), source: "gadget" } as HistoryTick);
		const view = f.store.view(KEY, "1m", 60, 12_000);
		assert.deepEqual(view?.segments.map((s) => [s.source, s.endReason ?? null]), [["shared-memory", "source"], ["gadget", null]]);
	});

	it("an identity change on a tick without evidence closes the run and adds nothing", () => {
		const f = fixture();
		f.sample(10_000, 40);
		const before = f.store.view(KEY, "1m", 60, 12_000);
		f.sample(11_000, 41, { unit: "°F" }, { evidence: false });
		const after = f.store.view(KEY, "1m", 60, 12_000);
		assert.equal(before?.segments[0]?.open, true);
		assert.equal(after?.segments[0]?.endReason, "unit");
		assert.equal(after?.cols.n, 1);
	});

	it("only the last closed segments are remembered; older entries stop drawing", () => {
		const f = fixture("15m");
		for (let i = 0; i < CLOSED_SEGMENTS + 6; i++) {
			f.sample(10_000 + i * 10_000, 40 + i);
			f.tick(10_000 + i * 10_000 + 1000, "skipped");
		}
		const view = f.store.view(KEY, "15m", 300, 10_000 + (CLOSED_SEGMENTS + 6) * 10_000);
		assert.ok(view);
		assert.equal(view.segments.length, CLOSED_SEGMENTS);
		assert.equal(view.cols.n, CLOSED_SEGMENTS);
	});
});

describe("tick gaps, sleep, wake and page flips", () => {
	it("an hour-long tick gap (machine sleep) ends the run at its last sample; afterwards only post-wake data shows", () => {
		const f = fixture("15m");
		for (let s = 0; s < 10; s++) f.sample(10_000 + s * 2000, 50);
		const wake = 10_000 + 3_600_000;
		f.sample(wake, 60);
		f.sample(wake + 2000, 61);
		const view = f.store.view(KEY, "15m", 128, wake + 4000);
		assert.ok(view);
		assert.equal(view.segments.length, 1, "the pre-sleep run is out of the window");
		assert.equal(view.cols.n, 1, "both post-wake samples share one 6 s bucket");
		assert.ok(view.observedFromX !== null && view.observedFromX >= 127, `observation began at the right edge (${view.observedFromX})`);
		const wide = f.store.view(KEY, "15m", 128, 10_000 + 20_000);
		assert.equal(wide?.segments[0]?.endReason, "sleep");
		assert.equal(wide?.segments[0]?.x1, (28_000 - (30_000 - 900_000)) * 128 / 900_000);
	});

	it("the wake event closes the run even without a tick gap", () => {
		const f = fixture();
		f.sample(10_000, 50);
		f.store.noteWake(10_500);
		f.sample(11_000, 51);
		const view = f.store.view(KEY, "1m", 60, 12_000);
		assert.deepEqual(view?.segments.map((s) => s.endReason ?? null), ["sleep", null]);
	});

	it("a wake event after the first post-wake tick keeps the post-wake run: the tick gap already ended the sleep", () => {
		const f = fixture();
		f.sample(10_000, 50);
		f.sample(11_000, 50);
		const wake = 11_000 + 3_600_000;
		// Node runs the overdue tick on resume; the app relays the wake after.
		f.sample(wake, 60);
		f.store.noteWake(wake + 400);
		f.sample(wake + 1000, 61);
		f.sample(wake + 2000, 62);
		const view = f.store.view(KEY, "1m", 60, wake + 2500);
		assert.ok(view);
		assert.deepEqual(view.segments.map((s) => [s.open, s.endReason ?? null]), [[true, null]], "one open run since the wake, no pen-up inside it");
		assert.deepEqual([...view.cols.last], [60, 61, 62], "the first post-wake sample belongs to it, not to an isolated dot");
		assert.equal(f.store.view(KEY, "1m", 60, 12_000)?.segments[0]?.endReason, "sleep", "the pre-sleep run ended at the gap");
	});

	it("a wake event long after the last tick gap still ends the run", () => {
		const f = fixture();
		f.sample(10_000, 50);
		f.sample(30_000, 51);
		for (let at = 31_000; at <= 100_000; at += 1000) f.sample(at, 52);
		f.store.noteWake(100_500);
		f.sample(101_000, 53);
		const view = f.store.view(KEY, "1m", 60, 101_500);
		assert.deepEqual(view?.segments.map((s) => s.endReason ?? null), ["sleep", null], "a gap 70 s earlier was another event");
	});

	it("a page flip (stop, then a tick milliseconds later) keeps the run; a long stop names the gap", () => {
		const f = fixture();
		f.sample(10_000, 50);
		f.store.noteStopped(10_100);
		f.sample(10_105, 51);
		assert.equal(f.store.view(KEY, "1m", 60, 11_000)?.segments.length, 1, "closing on stop would cut every line at every page change");
		f.store.noteStopped(11_000);
		f.sample(19_000, 52);
		const view = f.store.view(KEY, "1m", 60, 20_000);
		assert.deepEqual(view?.segments.map((s) => s.endReason ?? null), ["stopped", null]);
	});

	it("the tick-gap threshold follows the scheduled interval; a cadence change keeps history", () => {
		const f = fixture();
		f.sample(10_000, 50);
		f.sample(19_000, 51);
		assert.equal(f.store.view(KEY, "1m", 60, 20_000)?.segments[0]?.endReason, "sleep", "9 s exceeds max(3 x 1 s, 5 s)");
		const g = fixture();
		g.store.setScheduledInterval(5000);
		g.sample(10_000, 50);
		g.sample(19_000, 51);
		const view = g.store.view(KEY, "1m", 60, 20_000);
		assert.equal(view?.segments.length, 1, "9 s is within 3 x 5 s");
		assert.equal(view?.cols.n, 2, "nothing was emptied by the interval change");
	});

	it("a cadence change from slow to fast keeps the run: the first tick after it can come up to both intervals late", () => {
		const f = fixture();
		f.store.setScheduledInterval(5000);
		for (let at = 5_000; at <= 30_000; at += 5000) f.sample(at, 50);
		// Read every moves to 1 s in the last second of a 5 s cycle, and the
		// poller restarts its timer without ticking: the next tick lands
		// 5.6 s after the last one.
		f.store.setScheduledInterval(2000);
		f.store.setScheduledInterval(1000);
		f.sample(35_600, 51);
		f.sample(36_600, 52);
		assert.deepEqual(f.store.view(KEY, "1m", 60, 37_000)?.segments.map((s) => s.endReason ?? null), [null], "one run across the change");
		// The slower cadence judges that one tick only.
		f.sample(42_200, 53);
		assert.deepEqual(f.store.view(KEY, "1m", 60, 43_000)?.segments.map((s) => s.endReason ?? null), ["sleep", null], "5.6 s at a 1 s cadence is a gap again");
		const g = fixture();
		g.store.setScheduledInterval(5000);
		g.sample(10_000, 50);
		g.store.setScheduledInterval(1000);
		g.sample(26_000, 51);
		assert.deepEqual(g.store.view(KEY, "1m", 60, 27_000)?.segments.map((s) => s.endReason ?? null), ["sleep", null], "a sleep right after a change still ends the run (16 s exceeds 3 x 5 s)");
	});

	it("realign after a pairing change ends a re-bound run and adds no sample", () => {
		const f = fixture();
		f.sample(10_000, 50);
		const revision = f.store.revision;
		f.store.realign(snap(reading(KEY, 50, { aliasOf: "g:CPU:Temp" })), "shared-memory");
		const view = f.store.view(KEY, "1m", 60, 11_000);
		assert.equal(view?.cols.n, 1);
		assert.equal(f.store.revision, revision + 1, "the close is the only change");
		assert.equal(view?.hidden[0]?.reason ?? view?.segments[0]?.endReason, "binding");
		f.store.realign(snap(), "shared-memory");
		assert.equal(f.store.revision, revision + 1, "nothing open, nothing to end");
	});
});

describe("bounded memory", () => {
	for (const intervalMs of [250, 1000, 5000]) {
		it(`24 h of evidence at ${intervalMs} ms stays inside every tier, at the same bytes`, () => {
			const f = fixture(["1m", "5m", "15m"]);
			f.store.setScheduledInterval(intervalMs);
			const end = 24 * 3_600_000;
			let value = 0;
			for (let at = 1000; at <= end; at += intervalMs) f.store.ingest(ok(at, snap(reading(KEY, (value = (value + 7) % 100)))));
			assert.equal(f.store.diagnostics().bytes, 3168 + 7392 + 7392, "bytes depend on the windows, never the rate");
			for (const [id, w] of Object.entries(HISTORY_WINDOWS) as Array<[HistoryWindowId, (typeof HISTORY_WINDOWS)[HistoryWindowId]]>) {
				const view = f.store.view(KEY, id, 150, end);
				const width = (TIERS[w.tier] as { widthMs: number }).widthMs;
				assert.ok(view);
				assert.ok(view.cols.n <= 150 && view.cols.n >= Math.floor(w.windowMs / Math.max(width, intervalMs)) - 2, `${id}: ${view.cols.n} columns`);
				assert.equal(view.observedFromX, null, `${id}: the window is full after the ring wrapped`);
			}
		});
	}

	it("diagnostics count bytes as the allocated buffers and carry no key or value", () => {
		const f = fixture(["1m", "15m"]);
		f.sample(10_000, 123.456);
		const diag = f.store.diagnostics();
		assert.deepEqual(Object.keys(diag).sort(), ["budget", "bytes", "group", "lingering", "overflow", "series"]);
		assert.equal(diag.bytes, 3168 + 7392);
		assert.doesNotMatch(JSON.stringify(diag), /cpu|123/);
	});

	it("past the budget, lingering tiers are evicted oldest first and active ones never; refusal draws legacy and logs once", () => {
		const f = fixture("5m", { budgetBytes: 2 * T1_BYTES });
		const { store, clock, logs } = f;
		store.setInterest("key-2", [{ savedKey: "b:0:1", window: "5m" }]);
		assert.equal(store.diagnostics().bytes, 2 * T1_BYTES);
		clock.now = 2_000;
		store.dropInterest("key-1");
		assert.equal(store.diagnostics().lingering, 1);
		store.setInterest("key-3", [{ savedKey: "c:0:1", window: "5m" }]);
		assert.equal(store.view(KEY, "5m", 128, 3_000), undefined, "the lingering series made room");
		assert.ok(store.view("c:0:1", "5m", 128, 3_000));
		store.setInterest("key-4", [{ savedKey: "d:0:1", window: "5m" }]);
		store.setInterest("key-5", [{ savedKey: "e:0:1", window: "5m" }]);
		assert.equal(store.view("d:0:1", "5m", 128, 3_000), undefined, "refused: the key draws its recent-samples line");
		assert.ok(store.view("b:0:1", "5m", 128, 3_000), "an active tier is never evicted");
		assert.equal(logs.length, 1, "the overflow is logged once");
		assert.match(logs[0] ?? "", /recent samples on a key or dial, and "no history room" on a strip/, "the log says what each consumer draws");
		assert.equal(store.refused("d:0:1", "5m"), true, "refused() names the refused window");
		assert.equal(store.refused("d:0:1", "1m"), false, "a window nobody asked for is not refused");
		assert.equal(store.refused("b:0:1", "5m"), false, "an allocated window is not refused");
		assert.equal(store.refused("zz:0:1", "5m"), false, "an unknown series is not refused");
		assert.equal(store.diagnostics().overflow, 2);
		clock.now = 4_000;
		store.dropInterest("key-2");
		store.ingest(ok(5_000, snap(reading("d:0:1", 1))));
		const late = store.view("d:0:1", "5m", 128, 6_000);
		assert.ok(late, "a refused window gets its tier once room exists");
		assert.equal(store.refused("d:0:1", "5m"), false);
		assert.equal(store.diagnostics().overflow, 1);
		assert.ok(store.diagnostics().bytes <= 2 * T1_BYTES);
	});
});

describe("interest by consumer id", () => {
	it("a replayed appear (the same set again) changes nothing and keeps the history", () => {
		const f = fixture("5m");
		f.sample(10_000, 50);
		const before = f.store.diagnostics();
		f.store.setInterest("key-1", [{ savedKey: KEY, window: "5m" }]);
		f.store.setInterest("key-1", [{ savedKey: KEY, window: ["5m"] }]);
		assert.deepEqual(f.store.diagnostics(), before);
		assert.equal(f.store.view(KEY, "5m", 128, 11_000)?.cols.n, 1);
	});

	it("two keys and a dial row on one saved key share one series", () => {
		const f = fixture("5m");
		f.store.setInterest("key-2", [{ savedKey: KEY, window: "5m" }]);
		f.store.setInterest("dial-1:rows", [{ savedKey: KEY, window: "5m" }, { savedKey: "b:0:1", window: "5m" }]);
		assert.deepEqual(f.store.diagnostics(), { series: 2, lingering: 0, bytes: 2 * T1_BYTES, budget: HISTORY_BUDGET_BYTES, overflow: 0, group: NO_GROUP });
	});

	it("a set replace releases the rows that dropped out; they linger, still fed, and come back with their history", () => {
		const clock = { now: 1_000 };
		const store = new HistoryStore({ now: () => clock.now });
		store.setInterest("dial-1:rows", [{ savedKey: "a:0:1", window: "5m" }, { savedKey: "b:0:1", window: "5m" }]);
		clock.now = 2_000;
		store.setInterest("dial-1:rows", [{ savedKey: "b:0:1", window: "5m" }, { savedKey: "c:0:1", window: "5m" }]);
		assert.deepEqual(store.diagnostics(), { series: 3, lingering: 1, bytes: 3 * T1_BYTES, budget: HISTORY_BUDGET_BYTES, overflow: 0, group: NO_GROUP });
		store.ingest(ok(3_000, snap(reading("a:0:1", 7), reading("b:0:1", 8), reading("c:0:1", 9))));
		store.setInterest("dial-1:rows", [{ savedKey: "a:0:1", window: "5m" }]);
		assert.deepEqual([...(store.view("a:0:1", "5m", 150, 4_000)?.cols.last ?? [])], [7], "fed while lingering");
	});

	it("a lingering series is freed after 16 minutes; re-interest inside the linger keeps it", () => {
		const f = fixture("5m");
		f.sample(10_000, 50);
		f.clock.now = 20_000;
		f.store.dropInterest("key-1");
		f.sample(20_000 + LINGER_MS - 1, 51);
		assert.equal(f.store.diagnostics().series, 1);
		f.store.setInterest("key-1", [{ savedKey: KEY, window: "5m" }]);
		assert.equal(f.store.view(KEY, "5m", 150, 20_000 + LINGER_MS)?.cols.n, 1, "the old sample aged out, the new one kept");
		f.clock.now = 30_000 + LINGER_MS;
		f.store.dropInterest("key-1");
		f.store.ingest({ kind: "skipped", at: 30_000 + 2 * LINGER_MS });
		assert.deepEqual(f.store.diagnostics(), { series: 0, lingering: 0, bytes: 0, budget: HISTORY_BUDGET_BYTES, overflow: 0, group: NO_GROUP });
	});

	it("a window switch lingers the old tier and allocates the new one empty (short history)", () => {
		const f = fixture("5m");
		f.sample(10_000, 50);
		f.store.setInterest("key-1", [{ savedKey: KEY, window: "15m" }]);
		assert.equal(f.store.view(KEY, "15m", 150, 11_000)?.cols.n, 0, "a new window starts empty, never back-filled from another");
		assert.equal(f.store.diagnostics().bytes, 2 * T1_BYTES);
		f.store.setInterest("key-1", [{ savedKey: KEY, window: "5m" }]);
		assert.equal(f.store.view(KEY, "5m", 150, 11_000)?.cols.n, 1, "switching back inside the linger keeps the 5m history");
	});

	it("junk interest entries ask for nothing", () => {
		const store = new HistoryStore();
		store.setInterest("x", [{ savedKey: "", window: "5m" }, { savedKey: KEY, window: "5M" as HistoryWindowId }, { savedKey: KEY, window: [] }]);
		assert.equal(store.diagnostics().series, 0);
		assert.equal(store.view(KEY, "5m", 128, 0), undefined);
	});
});

describe("views are frozen copies", () => {
	it("a held view is not changed by later ingests", () => {
		const f = fixture();
		f.sample(10_000, 50);
		f.sample(11_000, 52);
		const view = f.store.view(KEY, "1m", 60, 12_000);
		assert.ok(view);
		assert.ok(Object.isFrozen(view) && Object.isFrozen(view.cols) && Object.isFrozen(view.segments) && Object.isFrozen(view.segments[0]));
		const bytes = JSON.stringify([...view.cols.x, ...view.cols.first, ...view.cols.min, ...view.cols.max, ...view.cols.last, ...view.cols.seg]);
		f.sample(11_500, 99);
		f.sample(12_000, 1);
		f.tick(13_000, "stale");
		assert.equal(JSON.stringify([...view.cols.x, ...view.cols.first, ...view.cols.min, ...view.cols.max, ...view.cols.last, ...view.cols.seg]), bytes);
		assert.equal(view.segments[0]?.open, true);
	});

	it("the same question gets the same frozen view until the series, width, instant, links or ring change", () => {
		const f = fixture(["1m", "5m"]);
		f.sample(10_000, 50);
		f.sample(11_000, 52);
		const view = f.store.view(KEY, "1m", 60, 12_000);
		assert.ok(view);
		assert.equal(f.store.view(KEY, "1m", 60, 12_000), view, "nothing changed: no rebuild");
		assert.equal(f.store.view(KEY, "1m", 60.9, 12_000), view, "the width is whole pixels");
		assert.notEqual(f.store.view(KEY, "1m", 61, 12_000), view);
		assert.notEqual(f.store.view(KEY, "1m", 60, 12_001), f.store.view(KEY, "1m", 60, 12_000));
		const linked = f.store.view(KEY, "1m", 60, 12_000, ["cpu:0:2"]);
		assert.notEqual(linked, f.store.view(KEY, "1m", 60, 12_000));
		assert.equal(f.store.view(KEY, "1m", 60, 12_000, ["cpu:0:2"]), f.store.view(KEY, "1m", 60, 12_000, ["cpu:0:2"]), "an equal list of links is the same question");
		assert.notEqual(f.store.view(KEY, "5m", 60, 12_000), f.store.view(KEY, "1m", 60, 12_000), "each window has its own");
		const before = f.store.view(KEY, "1m", 60, 13_000);
		f.sample(12_500, 99);
		const after = f.store.view(KEY, "1m", 60, 13_000);
		assert.notEqual(after, before, "a new sample rebuilds at the same instant");
		assert.equal(before?.cols.n, 2);
		assert.equal(after?.cols.max.at(-1), 99);
		f.tick(13_000, "stale");
		assert.equal(f.store.view(KEY, "1m", 60, 13_000)?.segments[0]?.open, false, "a segment end rebuilds too");
		// A ring freed and allocated again starts empty: never the old ring's view.
		f.store.dropInterest("key-1");
		f.clock.now = 13_000 + LINGER_MS;
		f.store.ingest({ kind: "skipped", at: f.clock.now });
		f.store.setInterest("key-1", [{ savedKey: KEY, window: "1m" }]);
		assert.equal(f.store.view(KEY, "1m", 60, 13_000)?.cols.n, 0);
	});

	it("view refuses a window it was not asked for, a junk window or width", () => {
		const f = fixture("5m");
		assert.equal(f.store.view(KEY, "1m", 128, 1000), undefined, "tier not allocated");
		assert.equal(f.store.view(KEY, "30m" as HistoryWindowId, 128, 1000), undefined);
		assert.equal(f.store.view(KEY, "5m", 0, 1000), undefined);
		assert.equal(f.store.view(KEY, "5m", Number.NaN, 1000), undefined);
		assert.equal(f.store.view("other:0:1", "5m", 128, 1000), undefined);
	});
});

describe("what counts as a brief boundary", () => {
	const OF = (gapMs: number, options: Parameters<typeof briefGapFixture>[0] = {}): boolean[] => briefGapFixture({ gapMs, ...options }).view.segments.map((s) => s.brief === true);

	it("keeps every raw segment and sample, and says brief on the segment after a skipped read", () => {
		const { view } = briefGapFixture();
		assert.deepEqual(view.segments.map((s) => [s.endReason ?? null, s.brief ?? null]), [["skipped", null], [null, true]]);
		assert.equal(view.cols.n, 4, "no sample was invented");
		assert.deepEqual(view.extent, { min: 40, max: 60 }, "extents are untouched");
		assert.equal(Object.hasOwn(view.segments[1] as object, "skippedGapMs"), false);
	});

	it("up to 5 s at the default cadence, and not a millisecond more", () => {
		assert.deepEqual(OF(5_000), [false, true]);
		assert.deepEqual(OF(5_001), [false, false]);
		assert.deepEqual(OF(12_000), [false, false]);
	});

	it("up to 2.5 x HWiNFO's scan interval, or the poll interval when that is longer", () => {
		for (const [period, poll, limit] of [[1_000, 1_000, 5_000], [2_000, 1_000, 5_000], [5_000, 1_000, 12_500], [10_000, 1_000, 25_000], [2_000, 5_000, 12_500], [10_000, 5_000, 25_000]] as const) {
			assert.deepEqual(OF(limit, { producerPeriodMs: period, scheduledIntervalMs: poll }), [false, true], `scan ${period} poll ${poll}: ${limit}`);
			assert.deepEqual(OF(limit + 1, { producerPeriodMs: period, scheduledIntervalMs: poll }), [false, false], `scan ${period} poll ${poll}: ${limit + 1}`);
		}
	});

	it("a source with no scan interval, Gadget and an older header, goes by the poll interval", () => {
		assert.deepEqual(OF(12_500, { scheduledIntervalMs: 5_000 }), [false, true]);
		assert.deepEqual(OF(12_501, { scheduledIntervalMs: 5_000 }), [false, false]);
		assert.deepEqual(OF(5_000, { scheduledIntervalMs: 500 }), [false, true]);
		assert.deepEqual(OF(5_001, { scheduledIntervalMs: 500 }), [false, false]);
	});

	for (const [name, options] of [
		["stale", { reason: "stale" }],
		["unavailable", { reason: "unavailable" }],
		["a change of source", { source: "gadget" }],
		["a change of unit", { after: { unit: "°F" } }],
		["a change of type", { after: { type: SensorType.Power } }],
		["a change of measurement", { after: { aliasOf: "another:0:1" }, linkedKeys: ["cpu:0:1"] }]
	] as const) {
		it(`never across ${name}`, () => {
			assert.ok(briefGapFixture(options).view.segments.every((s) => s.brief === undefined));
		});
	}

	describe("real polls through every phase of a scan", () => {
		const END = 1_000_000;
		for (const [name, scanMs, pollMs, producerPeriodMs] of [
			["a 1 s scan", 1_000, 1_007, 1_000],
			["a 2 s scan", 2_000, 1_007, 2_000],
			["a 5 s scan", 5_000, 1_007, 5_000],
			["a 10 s scan", 10_000, 1_007, 10_000],
			["Poll every 5 s on a 2 s scan", 2_000, 5_000, 2_000],
			["Poll every 5 s and an older header", 2_000, 5_000, undefined],
			["Poll every 250 ms on a 5 s scan", 5_000, 250, 5_000]
		] as const) {
			it(`${name}: one skipped read is brief at every phase`, () => {
				for (let phase = 0; phase < 40; phase++) {
					const at = END - 30_000 + phase * Math.round(Math.max(scanMs, pollMs) / 40);
					const trace = pollTrace({ n: 1, window: "1m", scanMs, pollMs, ...(producerPeriodMs === undefined ? {} : { producerPeriodMs }), kind: skipsAt([at], pollMs) });
					const view = trace.store.view(trace.keys[0] as string, "1m", 400, trace.now) as HistoryView;
					assert.equal(view.segments.length, 2, `phase ${phase}`);
					assert.equal(view.segments[1]?.brief, true, `phase ${phase}`);
				}
			});
		}

		it("a 1 s scan: a burst past 5 s stays open", () => {
			const start = END - 30_000;
			const trace = pollTrace({ n: 1, window: "1m", scanMs: 1_000, pollMs: 1_007, producerPeriodMs: 1_000, kind: (_tick, at) => (at >= start && at < start + 5_500 ? "skipped" : undefined) });
			const view = trace.store.view(trace.keys[0] as string, "1m", 400, trace.now) as HistoryView;
			assert.deepEqual(view.segments.map((s) => s.brief ?? null), [null, null]);
		});
	});

	describe("the newer reason replaces skipped, so that boundary is not brief", () => {
		const series = (): { store: HistoryStore; sample: (at: number) => void; view: () => HistoryView } => {
			const store = new HistoryStore({ now: () => 0 });
			store.setInterest("a", [{ savedKey: KEY, window: "1m" }]);
			return { store, sample: (at) => store.ingest(ok(at, snap(reading(KEY, at)))), view: () => store.view(KEY, "1m", 400, 20_000) as HistoryView };
		};
		for (const later of ["unavailable", "stale"] as const) {
			it(`a skipped read, then ${later}`, () => {
				const f = series();
				f.sample(1_000);
				f.store.ingest({ kind: "skipped", at: 2_000 });
				f.store.ingest({ kind: later, at: 3_000 });
				f.sample(4_000);
				assert.deepEqual(f.view().segments.map((s) => [s.endReason ?? null, s.brief ?? null]), [[later, null], [null, null]]);
			});
			it(`${later}, then a skipped read: the first reason holds`, () => {
				const f = series();
				f.sample(1_000);
				f.store.ingest({ kind: later, at: 2_000 });
				f.store.ingest({ kind: "skipped", at: 3_000 });
				f.sample(4_000);
				assert.deepEqual(f.view().segments.map((s) => [s.endReason ?? null, s.brief ?? null]), [[later, null], [null, null]]);
			});
		}
		it("a skipped read, then one tick the reading is missing", () => {
			const f = series();
			f.sample(1_000);
			f.store.ingest({ kind: "skipped", at: 2_000 });
			f.store.ingest(ok(3_000, snap(reading("other:0:1", 1))));
			f.sample(4_000);
			assert.deepEqual(f.view().segments.map((s) => [s.endReason ?? null, s.brief ?? null]), [["missing", null], [null, null]]);
		});
		it("a skipped read, then a wake", () => {
			const f = series();
			f.sample(1_000);
			f.store.ingest({ kind: "skipped", at: 2_000 });
			f.store.noteWake(2_500);
			f.sample(3_000);
			assert.deepEqual(f.view().segments.map((s) => [s.endReason ?? null, s.brief ?? null]), [["sleep", null], [null, null]]);
		});
		it("a skipped read, then a tick gap the scheduler cannot explain", () => {
			const f = series();
			f.sample(1_000);
			f.store.ingest({ kind: "skipped", at: 2_000 });
			f.store.noteStopped(2_100);
			f.sample(9_000);
			assert.deepEqual(f.view().segments.map((s) => [s.endReason ?? null, s.brief ?? null]), [["stopped", null], [null, null]]);
		});
		it("a view already built does not outlive the change of reason", () => {
			const f = series();
			f.sample(1_000);
			f.store.ingest({ kind: "skipped", at: 2_000 });
			assert.equal(f.view().segments[0]?.endReason, "skipped");
			const revision = f.store.revision;
			f.store.ingest({ kind: "unavailable", at: 3_000 });
			assert.ok(f.store.revision > revision);
			assert.equal(f.view().segments[0]?.endReason, "unavailable");
		});
	});
});
