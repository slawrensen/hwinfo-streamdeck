/**
 * The history view (src/history/view.ts): M4 column extremes against a
 * brute-force reference on random data, short history that is never
 * stretched, identity breaks that hide an older unit, and linked keys that
 * keep one scale across a source flip.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HistoryStore, type HistoryTick } from "../src/history/store";
import type { HistoryView, HistoryWindowId } from "../src/history/types";
import { HISTORY_WINDOWS, TIERS } from "../src/history/window";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";

const KEY = "gpu:0:2";

function reading(key: string, value: number, over: Partial<Reading> = {}): Reading {
	return { key, type: SensorType.Power, sensorIndex: 0, id: 2, label: "GPU Power", unit: "W", value, valueMin: value, valueMax: value, valueAvg: value, ...over };
}

function snap(...readings: Reading[]): SensorSnapshot {
	return { pollTime: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "GPU" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

function ok(at: number, value: number, over: Partial<Reading> = {}, source: "shared-memory" | "gadget" = "shared-memory"): HistoryTick {
	return { kind: "ok", at, snapshot: snap(reading(KEY, value, over)), source, evidence: true, stampAdvanced: true, evidenceAgeMs: 0 };
}

/** Deterministic PRNG (mulberry32), so a failure reproduces exactly. */
function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Column = { x: number; first: number; min: number; max: number; last: number };

/**
 * The reference: group raw samples into the tier's buckets, keep the
 * buckets holding an observation inside [now - windowMs, now], place each
 * at the column of its observed midpoint and merge neighbors in one column.
 */
function bruteForce(samples: ReadonlyArray<{ at: number; value: number }>, window: HistoryWindowId, widthPx: number, now: number): Column[] {
	const { windowMs, tier } = HISTORY_WINDOWS[window];
	const width = (TIERS[tier] as { widthMs: number }).widthMs;
	const winStart = now - windowMs;
	const buckets: Array<{ seq: number; tFirst: number; tLast: number; first: number; min: number; max: number; last: number }> = [];
	for (const { at, value } of samples) {
		const seq = Math.floor(at / width);
		const b = buckets[buckets.length - 1];
		if (b !== undefined && b.seq === seq) {
			b.min = Math.min(b.min, value);
			b.max = Math.max(b.max, value);
			b.last = value;
			b.tLast = at;
		} else {
			buckets.push({ seq, tFirst: at, tLast: at, first: value, min: value, max: value, last: value });
		}
	}
	const columns: Column[] = [];
	for (const b of buckets) {
		if (b.tLast < winStart || b.tFirst > now) continue;
		const x = Math.min(widthPx - 1, Math.max(0, Math.floor((((b.tFirst + b.tLast) / 2) - winStart) * widthPx / windowMs)));
		const c = columns[columns.length - 1];
		if (c !== undefined && c.x === x) {
			c.min = Math.min(c.min, b.min);
			c.max = Math.max(c.max, b.max);
			c.last = b.last;
		} else {
			columns.push({ x, first: b.first, min: b.min, max: b.max, last: b.last });
		}
	}
	return columns;
}

function columnsOf(view: HistoryView): Column[] {
	return Array.from({ length: view.cols.n }, (_, i) => ({ x: view.cols.x[i] as number, first: view.cols.first[i] as number, min: view.cols.min[i] as number, max: view.cols.max[i] as number, last: view.cols.last[i] as number }));
}

describe("M4 columns keep every extreme", () => {
	let seed = 1;
	for (const window of ["1m", "5m", "15m"] as const) {
		for (const widthPx of [40, 128, 800, 1200]) {
			it(`${window} at ${widthPx} px: column extremes equal the brute-force extremes, spikes survive, nothing is replicated`, () => {
				for (let trial = 0; trial < 12; trial++) {
					const rand = prng(seed++);
					const { windowMs } = HISTORY_WINDOWS[window];
					const store = new HistoryStore({ now: () => 0 });
					store.setInterest("probe", [{ savedKey: KEY, window }]);
					const samples: Array<{ at: number; value: number }> = [];
					// Ticks between 250 ms and 3 s apart (inside the tick-gap
					// threshold at a 1 s interval), over up to 1.4 windows.
					let at = 1 + Math.floor(rand() * 5000);
					const end = at + Math.floor(windowMs * (0.2 + rand() * 1.2));
					while (at <= end) {
						const spike = rand() < 0.02;
						const value = spike ? (rand() < 0.5 ? -1000 : 1000) * (1 + rand()) : 50 + Math.sin(at / 7000) * 20 + rand() * 5;
						samples.push({ at, value });
						store.ingest(ok(at, value));
						at += 250 + Math.floor(rand() * 2750);
					}
					const now = (samples[samples.length - 1] as { at: number }).at + Math.floor(rand() * 900);
					const view = store.view(KEY, window, widthPx, now);
					assert.ok(view);
					const expected = bruteForce(samples, window, widthPx, now);
					assert.deepEqual(columnsOf(view), expected, `trial ${trial}`);
					const inWindow = samples.filter((s) => s.at >= now - windowMs && s.at <= now);
					const top = Math.max(...inWindow.map((s) => s.value));
					const bottom = Math.min(...inWindow.map((s) => s.value));
					assert.ok([...view.cols.max].includes(top), "the highest sample in the window is some column's max");
					assert.ok([...view.cols.min].includes(bottom), "the lowest sample in the window is some column's min");
					assert.ok(view.extent !== null && view.extent.max >= top && view.extent.min <= bottom);
					const buckets = new Set(inWindow.map((s) => Math.floor(s.at / (TIERS[HISTORY_WINDOWS[window].tier] as { widthMs: number }).widthMs))).size;
					assert.ok(view.cols.n <= buckets + 1, `columns (${view.cols.n}) never exceed the buckets behind them (${buckets})`);
					for (let i = 1; i < view.cols.n; i++) assert.ok((view.cols.x[i] as number) >= (view.cols.x[i - 1] as number), "columns run left to right");
				}
			});
		}
	}
});

describe("time axis", () => {
	it("20 s of data in a 5-minute window sits in the right fifteenth and is never stretched", () => {
		const store = new HistoryStore({ now: () => 0 });
		store.setInterest("probe", [{ savedKey: KEY, window: "5m" }]);
		const now = 400_000;
		for (let at = now - 20_000; at <= now; at += 1000) store.ingest(ok(at, 100 + (at % 7)));
		const view = store.view(KEY, "5m", 128, now);
		assert.ok(view);
		const from = Math.floor((128 * 280) / 300);
		assert.equal(view.observedFromX, from);
		assert.ok([...view.cols.x].every((x) => x >= from), "nothing left of where observation began");
		assert.ok((view.cols.x[view.cols.n - 1] as number) <= 127);
		assert.ok(view.cols.n <= 10, "about 20 s over 2.3 s per pixel: a few columns, not 128");
	});

	it("an empty new window shows nothing and claims no observation", () => {
		const store = new HistoryStore({ now: () => 0 });
		store.setInterest("probe", [{ savedKey: KEY, window: "1m" }]);
		const view = store.view(KEY, "1m", 60, 10_000);
		assert.ok(view);
		assert.equal(view.cols.n, 0);
		assert.equal(view.extent, null);
		assert.equal(view.observedFromX, null);
		assert.equal(view.lastSampleAgeMs, null);
		assert.deepEqual(view.segments, []);
	});

	it("a window allocated after its run began starts where the tier began recording", () => {
		const clock = { now: 0 };
		const store = new HistoryStore({ now: () => clock.now });
		store.setInterest("a", [{ savedKey: KEY, window: "1m" }]);
		for (let at = 1000; at <= 100_000; at += 1000) store.ingest(ok(at, 10));
		clock.now = 100_500;
		store.setInterest("b", [{ savedKey: KEY, window: "15m" }]);
		for (let at = 101_000; at <= 110_000; at += 1000) store.ingest(ok(at, 10));
		const wide = store.view(KEY, "15m", 900, 110_000);
		const narrow = store.view(KEY, "1m", 60, 110_000);
		assert.equal(wide?.observedFromX, Math.floor((100_500 - (110_000 - 900_000)) / 1000));
		assert.equal(wide?.segments[0]?.x0, (100_500 - (110_000 - 900_000)) / 1000);
		assert.equal(narrow?.observedFromX, null, "the 1m tier recorded the run since before its window");
	});

	it("an entry wider than a column is emitted once (15m at 1200 px: 8 px per 6 s bucket)", () => {
		const store = new HistoryStore({ now: () => 0 });
		store.setInterest("probe", [{ savedKey: KEY, window: "15m" }]);
		for (let at = 1000; at <= 901_000; at += 2000) store.ingest(ok(at, at % 13));
		const view = store.view(KEY, "15m", 1200, 901_000);
		assert.ok(view);
		assert.ok(view.cols.n <= 151, `${view.cols.n} columns for 150 buckets`);
		assert.equal(new Set(view.cols.x).size, view.cols.n, "one column per bucket, none repeated");
	});

	it("lastSampleAgeMs is the newest sample's age at the view's instant", () => {
		const store = new HistoryStore({ now: () => 0 });
		store.setInterest("probe", [{ savedKey: KEY, window: "1m" }]);
		store.ingest(ok(5_000, 1));
		store.ingest({ kind: "stale", at: 6_000 });
		assert.equal(store.view(KEY, "1m", 60, 9_000)?.lastSampleAgeMs, 4_000);
	});
});

describe("identity in the view", () => {
	it("°C to °F mid-window: the °C run is hidden with a unit marker and never mixed into the scale", () => {
		const store = new HistoryStore({ now: () => 0 });
		store.setInterest("probe", [{ savedKey: KEY, window: "1m" }]);
		for (let at = 1000; at <= 10_000; at += 1000) store.ingest(ok(at, 50, { unit: "°C", type: SensorType.Temperature }));
		for (let at = 11_000; at <= 20_000; at += 1000) store.ingest(ok(at, 122, { unit: "°F", type: SensorType.Temperature }));
		const view = store.view(KEY, "1m", 60, 21_000);
		assert.ok(view);
		assert.equal(view.unit, "°F");
		assert.deepEqual(view.hidden, [{ x: (10_000 - (21_000 - 60_000)) / 1000, reason: "unit" }]);
		assert.deepEqual(view.extent, { min: 122, max: 122 });
		assert.ok([...view.cols.x].every((x) => x >= 50), "only the °F run draws");
	});

	it("a confirmed source flip keeps one scale with a pen-up; without the link it is a hidden binding", () => {
		const store = new HistoryStore({ now: () => 0 });
		store.setInterest("probe", [{ savedKey: KEY, window: "1m" }]);
		for (let at = 1000; at <= 5_000; at += 1000) store.ingest(ok(at, 100));
		// Auto fell back to Gadget: the saved Shared Memory key now resolves
		// as a confirmed alias of the Gadget key.
		const linkedKeys = ["g:GPU:Power", KEY];
		for (let at = 6_000; at <= 10_000; at += 1000) store.ingest(ok(at, 200, { aliasOf: "g:GPU:Power", linkedKeys }, "gadget"));
		const linked = store.view(KEY, "1m", 60, 11_000, linkedKeys);
		assert.ok(linked);
		assert.deepEqual(linked.segments.map((s) => [s.source, s.endReason ?? null]), [["shared-memory", "source"], ["gadget", null]]);
		assert.deepEqual(linked.extent, { min: 100, max: 200 }, "one scale across both runs");
		assert.deepEqual(linked.hidden, []);
		const unlinked = store.view(KEY, "1m", 60, 11_000);
		assert.deepEqual(unlinked?.hidden.map((h) => h.reason), ["binding"]);
		assert.deepEqual(unlinked?.extent, { min: 200, max: 200 });
	});
});
