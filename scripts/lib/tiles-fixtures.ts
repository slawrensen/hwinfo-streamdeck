/**
 * Group Tiles fixtures (src/strip/tiles.ts) on the real data path: a
 * HistoryStore fed one snapshot per poll, as the poller feeds it, and the
 * frame the controller builds from it (frameInput: the rule resolved, each
 * reading named by its label, the history asked at the tiles' time grid).
 * Shared by test/strip-tiles.test.ts and the renderer boards; nothing here
 * reads HWiNFO.
 */
import { HistoryStore } from "../../src/history/store";
import type { HistoryWindowId } from "../../src/history/types";
import { SensorType, type Reading, type SensorSnapshot } from "../../src/hwinfo/types";
import type { PollerStatus } from "../../src/poller";
import { frameInput, freshView, groupFrameOf, type GroupView, type PaneView } from "../../src/strip/frame";
import type { StripEncoders, StripLayout } from "../../src/strip/geometry";
import type { StripSceneInput } from "../../src/strip/scene";
import { stripConfigOf, type StripConfigV1 } from "../../src/strip/settings";
import type { DialBackground } from "../../src/ui/dial-background";

/** One poll: its time (ms) and each reading's value (undefined: not listed). */
export type TilesSample = { readonly t: number; readonly values: readonly (number | undefined)[] };

export type TilesFixtureParams = {
	/** The readings' labels, in the Group's order. */
	readonly labels: readonly string[];
	readonly unit?: string;
	readonly samples: readonly TilesSample[];
	readonly window?: HistoryWindowId;
	readonly layout?: StripLayout;
	readonly encoders?: StripEncoders;
	readonly background?: DialBackground;
	readonly theme?: string;
	readonly overlays?: Record<string, boolean>;
	readonly limits?: { readonly warn?: number; readonly crit?: number; readonly below?: boolean };
	/** The highlighted reading's index; absent or null is home. */
	readonly highlight?: number | null;
	/** Inspecting, the cursor this many ms before the newest bucket's end. */
	readonly pausedAgoMs?: number;
	/** Readings HWiNFO stops listing at the last poll. */
	readonly missing?: readonly number[];
	/** A whole strip of this many screens (the position line). */
	readonly screens?: number;
	readonly decimals?: string;
	/** The history allowance (bytes) the Group pool may spend. */
	readonly groupBudgetBytes?: number;
};

export type TilesFixture = { readonly input: StripSceneInput; readonly config: StripConfigV1; readonly keys: readonly string[]; readonly status: PollerStatus; readonly now: number; readonly store: HistoryStore };

const SENSOR = "CPU [#0]: Example";

export function tilesKeyOf(i: number): string {
	return `f0:0:${(0x100 + i).toString(16)}`;
}

function snapshotOf(labels: readonly string[], unit: string, sample: TilesSample, leave: ReadonlySet<number>): SensorSnapshot {
	const readings: Reading[] = [];
	labels.forEach((label, i) => {
		const value = sample.values[i];
		if (value === undefined || leave.has(i)) return;
		readings.push({ key: tilesKeyOf(i), type: unit === "%" ? SensorType.Usage : SensorType.Clock, sensorIndex: 0, id: 0x100 + i, label, unit, value, valueMin: value, valueMax: value, valueAvg: value });
	});
	return { pollTime: Math.floor(sample.t / 1000), version: 1, revision: 1, sensors: [{ index: 0, id: 0xf0, instance: 0, name: SENSOR }], readings, byKey: new Map(readings.map((r) => [r.key, r])) } as SensorSnapshot;
}

/** The scene input of a Group Tiles pane (pane 0, and pane 1 on a split)
 * after every sample was polled. */
export function tilesFixture(params: TilesFixtureParams): TilesFixture {
	const unit = params.unit ?? "%";
	const keys = params.labels.map((_, i) => tilesKeyOf(i));
	const window = params.window ?? "1m";
	const group = { from: "list", keys, view: "tiles", ...(params.limits === undefined ? {} : { limits: { below: false, ...params.limits, unit } }) };
	const raw = { style: "group", series: [], group, ...(params.overlays === undefined ? {} : { overlays: params.overlays }) };
	const config = stripConfigOf({ layout: params.layout ?? "whole", encoders: params.encoders ?? 6, window, background: params.background ?? "theme", theme: params.theme ?? "graphite", decimals: params.decimals ?? "auto", panes: [raw, raw] });
	const clock = { now: 0 };
	const store = new HistoryStore({ now: () => clock.now, scheduledIntervalMs: 2000, ...(params.groupBudgetBytes === undefined ? {} : { groupBudgetBytes: params.groupBudgetBytes }) });
	store.setInterest("strip", keys.map((savedKey) => ({ savedKey, window: [window] })), { pool: "group" });
	const leave = new Set(params.missing ?? []);
	let snapshot = snapshotOf(params.labels, unit, params.samples[0] ?? { t: 0, values: [] }, new Set());
	params.samples.forEach((sample, n) => {
		clock.now = sample.t;
		snapshot = snapshotOf(params.labels, unit, sample, n === params.samples.length - 1 ? leave : new Set());
		store.ingest({ kind: "ok", at: sample.t, snapshot, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 });
	});
	const now = clock.now;
	const status: PollerStatus = { state: "ok", snapshot, source: "shared-memory" };
	const highlight = params.highlight ?? null;
	const base: GroupView = { ...freshView(), groupHighlight: [highlight === null ? null : (keys[highlight] ?? null), highlight === null ? null : (keys[highlight] ?? null)] };
	const sources = { status, history: store, now, labelOf: (key: string) => params.labels[keys.indexOf(key)] };
	const screens = params.screens === undefined ? {} : { screens: { count: params.screens, at: 0, alerts: [] } };
	const live = frameInput({ config, encoders: config.encoders ?? 6, view: base, sources, ...screens });
	if (params.pausedAgoMs === undefined) return { input: live, config, keys, status, now, store };
	const paused = (p: 0 | 1): PaneView => ({ mode: "paused", agoMs: params.pausedAgoMs as number, label: "14:02:51", frozenAt: now, window, series: live.panes[p]?.series ?? [], group: groupFrameOf(config.panes[p], status) });
	const view: GroupView = { ...base, panes: [paused(0), paused(1)] };
	return { input: frameInput({ config, encoders: config.encoders ?? 6, view, sources, ...screens }), config, keys, status, now, store };
}

/** Polls every `pollMs` over `seconds`, the values from `value(i, t)`. */
export function tilesSamples(n: number, value: (i: number, t: number) => number | undefined, seconds = 60, pollMs = 2000, start = 10_000): TilesSample[] {
	const out: TilesSample[] = [];
	for (let t = start; t <= start + seconds * 1000; t += pollMs) out.push({ t, values: Array.from({ length: n }, (_, i) => value(i, t)) });
	return out;
}

/** "Core N T0 Usage", "Core N T1 Usage" for `cores` cores of `threads`. */
export function threadLabels(cores: number, threads = 2, prefix = "Core", suffix = "Usage"): string[] {
	const out: string[] = [];
	for (let c = 0; c < cores; c++) for (let t = 0; t < threads; t++) out.push(`${prefix} ${c} T${t} ${suffix}`);
	return out;
}

/**
 * A busy machine like the owner's capture: the first half of the cores
 * work (two threads trading one task on some cores, a 4-poll cycle; steady
 * load on others), the second half idles at 0 to 12 %, with noise from a
 * fixed hash so a run is repeatable.
 */
export function busyCpu(i: number, t: number, cores = 16): number {
	const core = Math.floor(i / 2);
	const thread = i % 2;
	const poll = Math.round(t / 2000);
	const h = (((Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(poll + 7, 0x85ebca77)) >>> 0) % 1000) / 1000;
	if (core >= cores / 2) return Math.round((h * 12 + (thread === 0 ? 2 : 0)) * 10) / 10;
	if (core % 2 === 0 && core > 0) {
		const on = Math.floor(poll / 2) % 2 === thread;
		return Math.round((on ? 88 + h * 10 : 2 + h * 8) * 10) / 10;
	}
	return Math.round(Math.min(100, Math.max(0, (thread === 0 ? 55 : 12) + 30 * Math.sin(poll / 5 + core) + h * 14)) * 10) / 10;
}
