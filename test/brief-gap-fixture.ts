/**
 * Brief gap fixtures on the real data path: a HistoryStore fed one tick per
 * poll, as the poller feeds it, from a producer that writes on its own scan
 * interval, and the frame the controller builds from it (frameInput). A
 * skipped read here is the store's real skipped tick, and what it leaves
 * behind is what a deck would draw. Nothing here reads HWiNFO.
 */
import { HistoryStore, type HistoryTick } from "../src/history/store";
import type { HistoryView, HistoryWindowId } from "../src/history/types";
import type { SnapshotSource } from "../src/hwinfo/provider";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { frameInput, freshView, type GroupView } from "../src/strip/frame";
import type { StripEncoders, StripLayout } from "../src/strip/geometry";
import type { StripSceneInput } from "../src/strip/scene";
import { stripConfigOf, type StripConfigV1 } from "../src/strip/settings";

const KEY = "cpu:0:1";

/** One reading through a few polls and one gap of `gapMs` from the sample
 * before it to the sample after, every tick in between of kind `reason`. */
export function briefGapFixture(options: { gapMs?: number; reason?: "skipped" | "stale" | "unavailable"; after?: Partial<Reading>; source?: SnapshotSource; linkedKeys?: readonly string[]; width?: number; producerPeriodMs?: number; scheduledIntervalMs?: number } = {}): { store: HistoryStore; view: HistoryView; now: number } {
	let now = 1_000;
	const store = new HistoryStore({ now: () => now, ...(options.scheduledIntervalMs === undefined ? {} : { scheduledIntervalMs: options.scheduledIntervalMs }) });
	store.setInterest("strip", [{ savedKey: KEY, window: "1m" }]);
	const sample = (at: number, value: number, after: Partial<Reading> = {}, source: SnapshotSource = "shared-memory"): void => {
		now = at;
		const reading: Reading = { key: KEY, sensorIndex: 0, id: 1, type: SensorType.Temperature, label: "CPU", unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value, ...after };
		const snapshot: SensorSnapshot = { pollTime: at / 1000, version: 1, revision: 1, sensors: [], readings: [reading], byKey: new Map([[reading.key, reading]]), ...(options.producerPeriodMs === undefined ? {} : { producerPeriodMs: options.producerPeriodMs }) };
		const tick: HistoryTick = { kind: "ok", at, snapshot, source, evidence: true, stampAdvanced: true, evidenceAgeMs: 0 };
		store.ingest(tick);
	};
	sample(1_000, 40);
	sample(2_000, 50);
	const recovery = 2_000 + (options.gapMs ?? 3_000);
	for (let at = 3_000; at < recovery; at += 1_000) {
		now = at;
		store.ingest({ kind: options.reason ?? "skipped", at });
	}
	sample(recovery, 60, options.after, options.source);
	sample(recovery + 1_000, 55, options.after, options.source);
	const view = store.view(KEY, "1m", options.width ?? 400, now, options.linkedKeys);
	if (view === undefined) throw new Error("Missing history fixture");
	return { store, view, now };
}

export const traceKeyOf = (i: number): string => `f0:0:${(0x100 + i).toString(16)}`;

export type TraceParams = {
	/** How many readings (default 2). */
	readonly n?: number;
	readonly window?: HistoryWindowId;
	/** The plugin's poll; 1007 ms is what the owner's machine measured. */
	readonly pollMs?: number;
	/** How often the producer writes (default 2000 ms, HWiNFO's default). */
	readonly scanMs?: number;
	readonly seconds?: number;
	/** What the producer reports its scan interval as (HWiNFO's header). */
	readonly producerPeriodMs?: number;
	readonly endMs?: number;
	readonly unit?: string;
	/** A reading's label by index. */
	readonly label?: (i: number) => string;
	readonly value?: (i: number, at: number) => number;
	/** A tick that is not an ok read: the kind it records. */
	readonly kind?: (tick: number, at: number) => "skipped" | "stale" | "unavailable" | undefined;
	/** A reading not listed at this tick. */
	readonly drop?: (i: number, at: number) => boolean;
	readonly pool?: "group";
};

export type Trace = { readonly store: HistoryStore; readonly keys: readonly string[]; readonly now: number; readonly status: PollerStatus; readonly window: HistoryWindowId; readonly labels: readonly string[] };

/** Times spread evenly through a window, one per boundary. */
export function evenly(boundaries: number, seconds: number, endMs = 1_000_000): number[] {
	const period = (seconds * 1000) / (boundaries + 1);
	return Array.from({ length: boundaries }, (_, b) => Math.round(endMs - seconds * 1000 + (b + 1) * period));
}

/** The poll that lands on each of `times` reads as skipped. */
export function skipsAt(times: readonly number[], pollMs = 1007): NonNullable<TraceParams["kind"]> {
	return (_tick, at) => (times.some((t) => at - t > -pollMs / 2 && at - t <= pollMs / 2) ? "skipped" : undefined);
}

/** A producer writing every scanMs, polled every pollMs through a real store. */
export function pollTrace(params: TraceParams = {}): Trace {
	const n = params.n ?? 2;
	const pollMs = params.pollMs ?? 1007;
	const scanMs = params.scanMs ?? 2000;
	const window = params.window ?? "5m";
	const seconds = params.seconds ?? { "1m": 60, "5m": 300, "15m": 900 }[window];
	const endMs = params.endMs ?? 1_000_000;
	const startMs = endMs - seconds * 1000 - 5000;
	const unit = params.unit ?? "°C";
	const keys = Array.from({ length: n }, (_, i) => traceKeyOf(i));
	const labels = keys.map((_, i) => params.label?.(i) ?? (n <= 4 ? (["CPU (Tctl/Tdie)", "GPU Temperature", "Sensor 2", "Sensor 3"][i] as string) : `Core ${Math.floor(i / 2)} T${i % 2} Usage`));
	const value = params.value ?? ((i: number, at: number): number => (i === 0 ? 56 + 7 * Math.sin(at / 17000) + 2 * Math.sin(at / 3500) : 40 + 3 * Math.sin(at / 33000) + i * 0.7));
	let now = startMs;
	const store = new HistoryStore({ now: () => now, scheduledIntervalMs: pollMs });
	store.setInterest("strip", keys.map((savedKey) => ({ savedKey, window: [window] })), params.pool === undefined ? undefined : { pool: params.pool });
	let lastStamp = -1;
	let snapshot: SensorSnapshot | null = null;
	let tick = 0;
	let last = startMs;
	for (let at = startMs; at <= endMs; at += pollMs, tick++) {
		now = at;
		last = at;
		const kind = params.kind?.(tick, at);
		if (kind !== undefined) {
			store.ingest({ kind, at });
			continue;
		}
		const stamp = Math.floor(at / scanMs);
		const advanced = stamp !== lastStamp;
		lastStamp = stamp;
		const readings: Reading[] = [];
		keys.forEach((key, i) => {
			if (params.drop?.(i, at) === true) return;
			const v = value(i, stamp * scanMs);
			readings.push({ key, id: 0x100 + i, sensorIndex: 0, label: labels[i] as string, type: unit === "%" ? SensorType.Usage : SensorType.Temperature, unit, value: v, valueMin: v, valueMax: v, valueAvg: v });
		});
		snapshot = { pollTime: stamp, valueRevision: stamp, version: 1, revision: 1, sensors: [{ index: 0, id: 0xf0, instance: 0, name: "Example" }], readings, byKey: new Map(readings.map((r) => [r.key, r])), ...(params.producerPeriodMs === undefined ? {} : { producerPeriodMs: params.producerPeriodMs }) };
		store.ingest({ kind: "ok", at, snapshot, source: "shared-memory", evidence: advanced, stampAdvanced: advanced, evidenceAgeMs: 0 });
	}
	if (snapshot === null) throw new Error("Missing trace");
	return { store, keys, now: last, status: { state: "ok", snapshot, source: "shared-memory" }, window, labels };
}

export type TraceFrameOptions = { readonly background?: string; readonly theme?: string; readonly encoders?: StripEncoders; readonly layout?: StripLayout; readonly fahrenheit?: boolean; readonly screens?: number; readonly view?: GroupView };

/** The scene input of one pane over a trace, as the controller builds it. The
 * pane helpers below carry the mode beside the pane; it is stored where the
 * plugin reads it, on the strip. */
export function traceFrame(trace: Trace, withMode: Record<string, unknown>, options: TraceFrameOptions = {}): { input: StripSceneInput; config: StripConfigV1 } {
	const { gapMode, ...pane } = withMode;
	const config = stripConfigOf({ ...(gapMode === undefined ? {} : { gapMode }), layout: options.layout ?? "whole", encoders: options.encoders ?? 6, window: trace.window, background: options.background ?? "theme", theme: options.theme ?? "graphite", ...(options.fahrenheit === true ? { fahrenheit: true } : {}), panes: [pane, pane], ...(options.screens === undefined ? {} : { screens: Array.from({ length: options.screens - 1 }, () => pane) }) });
	const sources = { status: trace.status, history: trace.store, now: trace.now, labelOf: (key: string) => trace.labels[trace.keys.indexOf(key)] };
	const screens = options.screens === undefined ? {} : { screens: { count: options.screens, at: 0, alerts: Array.from({ length: options.screens }, () => false) } };
	return { input: frameInput({ config, encoders: config.encoders ?? 6, view: options.view ?? freshView(), sources, ...screens }), config };
}

/** A pane of a plain style over the trace's readings. */
export const tracePane = (trace: Trace, style: string, gapMode: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ style, series: trace.keys.map((key) => ({ key })), ...(gapMode === undefined ? {} : { gapMode }), ...extra });

/** A Group pane listing the trace's readings, in one stored view. */
export const traceGroup = (trace: Trace, view: string, gapMode: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ style: "group", series: [], group: { from: "list", keys: trace.keys, view }, ...(gapMode === undefined ? {} : { gapMode }), ...extra });
