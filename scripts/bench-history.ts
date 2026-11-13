// History store microbenchmark on synthetic data (no HWiNFO, no Stream
// Deck): what one poller tick costs the store with many retained series,
// what a Trend window view and its drawing cost at key and strip widths,
// and the allocation per tick from process.memoryUsage() deltas. It times
// the store alone, never the whole plugin; the plugin-level comparison
// against 1.7.1 belongs to the release soak and perf-report.
//
// Run: node --expose-gc --import tsx scripts/bench-history.ts
// BENCH_ITERS (default 2000), BENCH_SERIES (default 128), BENCH_READINGS
// (default 512, the snapshot size each tick carries).
import { HistoryStore, type HistoryTick } from "../src/history/store";
import type { HistoryWindowId } from "../src/history/types";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { KEY_TREND_WIDTH_PX, renderReadingKey } from "../src/ui/key-renderer";
import { loadThemes, resolvePalette } from "../src/ui/themes";
import { timelineSvg } from "../src/ui/timeline";

const ITERS = Number(process.env.BENCH_ITERS ?? "2000");
const SERIES = Number(process.env.BENCH_SERIES ?? "128");
const READINGS = Math.max(SERIES, Number(process.env.BENCH_READINGS ?? "512"));
const TICK_MS = 1000;

const gc = (globalThis as { gc?: () => void }).gc;
if (gc === undefined) {
	console.error("Run with --expose-gc: node --expose-gc --import tsx scripts/bench-history.ts");
	process.exit(1);
}

interface Stats {
	mean: number;
	p50: number;
	p95: number;
}

function stats(samplesNs: number[]): Stats {
	const sorted = [...samplesNs].sort((a, b) => a - b);
	const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
	const us = (ns: number): number => Math.round(ns / 100) / 10;
	return { mean: us(samplesNs.reduce((a, b) => a + b, 0) / samplesNs.length), p50: us(at(0.5)), p95: us(at(0.95)) };
}

function timePass(fn: (i: number) => unknown): Stats {
	const samples = new Array<number>(ITERS);
	for (let i = 0; i < ITERS; i++) {
		const t0 = process.hrtime.bigint();
		fn(i);
		samples[i] = Number(process.hrtime.bigint() - t0);
	}
	return stats(samples);
}

/** Positive heapUsed deltas per call, after a gc. */
function allocPass(fn: (i: number) => unknown): number {
	gc?.();
	let allocated = 0;
	let prev = process.memoryUsage().heapUsed;
	for (let i = 0; i < ITERS; i++) {
		fn(i);
		const now = process.memoryUsage().heapUsed;
		if (now > prev) allocated += now - prev;
		prev = now;
	}
	return Math.round(allocated / ITERS);
}

const keys = Array.from({ length: READINGS }, (_, i) => `f000${(i >> 6).toString(16)}:0:${(0x1000000 + i).toString(16)}`);
function snapshotAt(step: number): SensorSnapshot {
	const readings: Reading[] = keys.map((key, i) => {
		const value = 40 + ((step * 7 + i * 13) % 50) + (step % 97 === 0 ? 30 : 0);
		return { key, type: SensorType.Temperature, sensorIndex: i >> 6, id: i, label: `Reading ${i}`, unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value };
	});
	return { pollTime: step, valueRevision: step, version: 1, revision: 1, sensors: [], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

/** A store retaining the first SERIES keys in `windows`, filled with 20
 * minutes of one-per-second evidence so every ring has wrapped. */
function filledStore(windows: readonly HistoryWindowId[]): { store: HistoryStore; at: number; snapshots: SensorSnapshot[] } {
	const store = new HistoryStore({ now: () => 0 });
	for (let i = 0; i < SERIES; i++) store.setInterest(`consumer-${i}`, [{ savedKey: keys[i] as string, window: windows }]);
	const snapshots = Array.from({ length: 64 }, (_, s) => snapshotAt(s));
	let at = 0;
	for (let step = 0; step < 1200; step++) {
		at += TICK_MS;
		store.ingest({ kind: "ok", at, snapshot: snapshots[step % snapshots.length] as SensorSnapshot, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 });
	}
	return { store, at, snapshots };
}

function tickBench(windows: readonly HistoryWindowId[]): Record<string, unknown> {
	const { store, at: start, snapshots } = filledStore(windows);
	let at = start;
	const tick = (kind: "evidence" | "held"): ((i: number) => void) => (i) => {
		at += TICK_MS;
		const snapshot = snapshots[i % snapshots.length] as SensorSnapshot;
		const t: HistoryTick = { kind: "ok", at, snapshot, source: "shared-memory", evidence: kind === "evidence", stampAdvanced: kind === "evidence", evidenceAgeMs: 0 };
		store.ingest(t);
	};
	return {
		windows,
		bytes: store.diagnostics().bytes,
		evidenceTickUs: timePass(tick("evidence")),
		heldTickUs: timePass(tick("held")),
		evidenceAllocPerTickB: allocPass(tick("evidence")),
		heldAllocPerTickB: allocPass(tick("held"))
	};
}

function viewBench(): Record<string, unknown> {
	const { store, at } = filledStore(["1m", "5m", "15m"]);
	const palette = resolvePalette(loadThemes(), "void", null, "normal");
	// Whole key faces: the 36-sample line against each window at the key's
	// strip width, same value and label (SVG characters before URI encoding).
	const base = { label: "CPU Package", valueText: "56.3", unitText: "°C", statBadge: "", palette };
	const faceBytes: Record<string, number> = { recentSamples: renderReadingKey({ ...base, history: Array.from({ length: 36 }, (_, i) => 40 + ((i * 7) % 50)) }).length };
	for (const window of ["1m", "5m", "15m"] as const) {
		const view = store.view(keys[0] as string, window, KEY_TREND_WIDTH_PX, at);
		if (view !== undefined) faceBytes[window] = renderReadingKey({ ...base, timeline: view }).length;
	}
	const out: Record<string, unknown> = { keyFaceBytes: faceBytes };
	for (const window of ["1m", "5m", "15m"] as const) {
		for (const width of [128, 1200]) {
			const key = keys[0] as string;
			const view = store.view(key, window, width, at);
			if (view === undefined) throw new Error(`no ${window} view`);
			out[`${window}@${width}`] = {
				columns: view.cols.n,
				viewUs: timePass(() => store.view(key, window, width, at)),
				drawUs: timePass(() => timelineSvg(view, { x: 0, y: 0, w: width, h: 12 }, 4, 5, palette, `fill="${palette.track}"`)),
				svgBytes: timelineSvg(view, { x: 0, y: 0, w: width, h: 12 }, 4, 5, palette, `fill="${palette.track}"`).join("").length
			};
		}
	}
	return out;
}

const fitting = Math.floor(2 * 1024 * 1024 / (3168 + 7392 + 7392));
const tick5m = tickBench(["5m"]);
const tickAllWindows = SERIES <= fitting ? tickBench(["1m", "5m", "15m"]) : `skipped: ${SERIES} series in all three windows exceed the 2 MiB budget (${fitting} fit)`;
const views = viewBench();
console.log(JSON.stringify({
	iters: ITERS,
	series: SERIES,
	readingsPerSnapshot: READINGS,
	node: process.version,
	// What the heapUsed probe itself reports per call, measured warm: the
	// per-tick allocation figures are only meaningful above it.
	probeAllocPerCallB: allocPass(() => undefined),
	tick5m,
	tickAllWindows,
	views
}));
