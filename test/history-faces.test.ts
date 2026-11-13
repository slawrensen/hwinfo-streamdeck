/**
 * Trend windows on faces: the timeline renderer (one stroked subpath per segment,
 * pen up across gaps, nothing left of where observation began, the line
 * ending at the last sample), its use on the key strip and the two-row
 * dial, the key and dial consumers' interest on appear, settings and
 * disappear (never writing settings), and the key's tick gate.
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { composeDialSvg, dialHistoryWindowOf, SensorDialAction, type DialSettings, type InstanceState, type TimelineSource } from "../src/actions/sensor-dial";
import { compose, historyWindowOf, SensorReadingAction, type ReadingSettings } from "../src/actions/sensor-reading";
import { PressEngine } from "../src/detail/press-engine";
import { IDLE_GESTURE } from "../src/gestures";
import { HistoryStore, type HistoryTick } from "../src/history/store";
import type { HistoryView, HistoryWindowId } from "../src/history/types";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { poller, type PollerStatus } from "../src/poller";
import { SessionStatsStore } from "../src/stats";
import { dialBackgroundTraits } from "../src/ui/dial-background";
import { renderDialTwoRow, twoRowColumns } from "../src/ui/dial-renderer";
import { renderReadingKey } from "../src/ui/key-renderer";
import { loadThemes, resolvePalette } from "../src/ui/themes";
import { timelineSvg } from "../src/ui/timeline";
import { briefGapFixture } from "./brief-gap-fixture";

const PALETTE = resolvePalette(loadThemes(), "void", null, "normal");
const BOX = { x: 8, y: 122, w: 128, h: 12 } as const;

function reading(key: string, value: number, over: Partial<Reading> = {}): Reading {
	return { key, type: SensorType.Temperature, sensorIndex: 0, id: 1, label: "CPU Package", unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value, ...over };
}

function snap(...readings: Reading[]): SensorSnapshot {
	return { pollTime: 1, valueRevision: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

function ok(at: number, snapshot: SensorSnapshot): HistoryTick {
	return { kind: "ok", at, snapshot, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 };
}

/** A store holding `runs` of one-per-second samples of `key`, each run
 * ended by a skipped read unless it is the last and `openEnd` is set. */
function storeWith(key: string, window: HistoryWindowId, runs: ReadonlyArray<{ from: number; to: number; value: (at: number) => number }>, openEnd = true): HistoryStore {
	const store = new HistoryStore({ now: () => 0 });
	store.setInterest("probe", [{ savedKey: key, window }]);
	runs.forEach((run, i) => {
		for (let at = run.from; at <= run.to; at += 1000) store.ingest(ok(at, snap(reading(key, run.value(at)))));
		if (i < runs.length - 1 || !openEnd) store.ingest({ kind: "skipped", at: run.to + 500 });
	});
	return store;
}

type Point = { x: number; y: number };

/** The absolute points of every subpath in a path's data (M, L, H, V and
 * their relative forms, Z, implicit repeats). */
function subpaths(d: string): Point[][] {
	const out: Point[][] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MLHVZmlhvz])([^MLHVZmlhvz]*)/g)) {
		const n = [...(args as string).matchAll(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)].map((m) => Number(m[0]));
		const rel = cmd === (cmd as string).toLowerCase();
		const upper = (cmd as string).toUpperCase();
		if (upper === "Z") continue;
		for (let i = 0; i < n.length; ) {
			if (upper === "H") x = (rel ? x : 0) + (n[i++] as number);
			else if (upper === "V") y = (rel ? y : 0) + (n[i++] as number);
			else {
				x = (rel ? x : 0) + (n[i++] as number);
				y = (rel ? y : 0) + (n[i++] as number);
			}
			if (upper === "M" && i <= 2) out.push([]);
			(out[out.length - 1] as Point[]).push({ x, y });
		}
	}
	return out;
}

/** Every stroked run of the trend: one subpath per segment. */
function polylines(svg: string): Point[][] {
	return [...svg.matchAll(/<path d="([^"]*)" fill="none" stroke=/g)].flatMap((m) => subpaths(m[1] as string));
}

/** Every under-fill subpath (closed, filled). */
function fills(svg: string): Point[][] {
	return [...svg.matchAll(/<path d="([^"]*Z)"/g)].flatMap((m) => subpaths(m[1] as string));
}

describe("timeline renderer", () => {
	it("draws one stroked run per segment with the pen up across a gap, and the end dot only on an open run", () => {
		const store = storeWith("k:0:1", "1m", [{ from: 10_000, to: 20_000, value: (at) => 40 + (at % 7_000) / 1000 }, { from: 30_000, to: 40_000, value: () => 45 }]);
		const view = store.view("k:0:1", "1m", 128, 41_000);
		assert.ok(view);
		const svg = timelineSvg(view, BOX, 4, 5, PALETTE, `fill="${PALETTE.track}"`).join("");
		const lines = polylines(svg);
		assert.equal(lines.length, 2);
		const [a, b] = lines as [Point[], Point[]];
		assert.ok(Math.max(...a.map((p) => p.x)) < Math.min(...b.map((p) => p.x)), "nothing spans the 20 s to 30 s gap");
		const gapFrom = BOX.x + ((20_000 - (41_000 - 60_000)) * 128) / 60_000 + 1;
		const gapTo = BOX.x + ((30_000 - (41_000 - 60_000)) * 128) / 60_000 - 1;
		assert.ok(![...a, ...b].some((p) => p.x > gapFrom && p.x < gapTo), "no point inside the gap");
		for (const p of [...a, ...b]) {
			assert.ok(p.x >= BOX.x && p.x <= BOX.x + BOX.w, `x ${p.x} inside the strip`);
			assert.ok(p.y >= BOX.y && p.y <= BOX.y + BOX.h, `y ${p.y} inside the strip`);
		}
		assert.equal(fills(svg).length, 2, "one under-fill per run");
		const dots = [...svg.matchAll(/<circle cx="([^"]*)" cy="([^"]*)" r="5"/g)];
		assert.equal(dots.length, 1);
		assert.equal(Number(dots[0]?.[1]), (b[b.length - 1] as Point).x, "the dot sits on the newest sample: the line ends there, no held stub");
		const closed = storeWith("k:0:1", "1m", [{ from: 10_000, to: 20_000, value: () => 40 }], false).view("k:0:1", "1m", 128, 41_000);
		assert.ok(closed);
		assert.doesNotMatch(timelineSvg(closed, BOX, 4, 5, PALETTE, null).join(""), /r="5"/, "a run that ended draws no live dot");
	});

	describe("a brief boundary keeps the pen down, with no setting", () => {
		const SPACED: Parameters<typeof briefGapFixture>[0] = { width: 128 };
		it("one subpath across it, through both runs' points, one under-fill, and the end dot on the newest run", () => {
			const { view } = briefGapFixture(SPACED);
			assert.equal(view.segments[1]?.brief, true);
			const svg = timelineSvg(view, BOX, 4, 5, PALETTE, `fill="${PALETTE.track}"`).join("");
			assert.equal(polylines(svg).length, 1, "no pen up");
			assert.equal(fills(svg).length, 1);
			assert.equal([...svg.matchAll(/r="5"/g)].length, 1, "the run is open: the end dot");
		});
		it("the same history with nothing called brief still lifts the pen", () => {
			const { view } = briefGapFixture(SPACED);
			const plain = { ...view, segments: view.segments.map(({ brief: _brief, ...rest }) => (void _brief, rest)) };
			assert.equal(polylines(timelineSvg(plain, BOX, 4, 5, PALETTE, null).join("")).length, 2);
		});
		it("a longer stretch, and an outage, still lift it", () => {
			assert.equal(polylines(timelineSvg(briefGapFixture({ ...SPACED, gapMs: 5_001 }).view, BOX, 4, 5, PALETTE, null).join("")).length, 2);
			assert.equal(polylines(timelineSvg(briefGapFixture({ ...SPACED, reason: "unavailable" }).view, BOX, 4, 5, PALETTE, null).join("")).length, 2);
		});
		it("a brief segment with no column of its own does not join across the one missing", () => {
			const { view } = briefGapFixture(SPACED);
			const cols = view.cols;
			const third = { ...view, segments: [view.segments[0], { ...view.segments[1], brief: undefined }, view.segments[1]].map((s, ordinal) => ({ ...s, ordinal })), cols: { ...cols, seg: Uint16Array.from(cols.seg, (s) => (s === 0 ? 0 : 2)) } } as unknown as HistoryView;
			assert.equal(polylines(timelineSvg(third, BOX, 4, 5, PALETTE, null).join("")).length, 2);
		});
	});

	it("short history draws only right of where observation began, unstretched", () => {
		const store = storeWith("k:0:2", "5m", [{ from: 380_000, to: 400_000, value: (at) => at / 1000 }]);
		const view = store.view("k:0:2", "5m", 128, 400_000);
		assert.ok(view && view.observedFromX !== null);
		const left = BOX.x + view.observedFromX;
		const points = polylines(timelineSvg(view, BOX, 4, 5, PALETTE, null).join("")).flat();
		assert.ok(points.length > 0);
		assert.ok(points.every((p) => p.x >= left), "nothing left of observedFromX");
		assert.ok(Math.min(...points.map((p) => p.x)) > BOX.x + 110, "20 s of a 5-minute window stays at the right edge");
	});

	it("an empty view draws nothing; a flat run sits mid-strip; Outline draws no under-fill; an isolated old sample is a small dot", () => {
		const empty = new HistoryStore({ now: () => 0 });
		empty.setInterest("p", [{ savedKey: "k:0:3", window: "1m" }]);
		assert.deepEqual(timelineSvg(empty.view("k:0:3", "1m", 128, 1000) as HistoryView, BOX, 4, 5, PALETTE, "x"), []);
		const flat = storeWith("k:0:3", "1m", [{ from: 1000, to: 5000, value: () => 50 }]).view("k:0:3", "1m", 128, 6000) as HistoryView;
		const svg = timelineSvg(flat, BOX, 4, 5, PALETTE, null).join("");
		assert.ok(polylines(svg).flat().every((p) => p.y === 128), "span 0 draws at mid-height");
		assert.equal(fills(svg).length, 0);
		const lone = storeWith("k:0:3", "1m", [{ from: 1000, to: 1000, value: () => 50 }, { from: 7000, to: 10000, value: () => 60 }]).view("k:0:3", "1m", 128, 11000) as HistoryView;
		assert.match(timelineSvg(lone, BOX, 4, 5, PALETTE, null).join(""), /<circle [^>]*r="2"/);
	});

	it("a °C/°F toggle draws the same shape (native values, self-normalized)", () => {
		const c = storeWith("k:0:4", "1m", [{ from: 1000, to: 20_000, value: (at) => 30 + ((at / 1000) % 5) }]).view("k:0:4", "1m", 128, 21_000) as HistoryView;
		const a = renderReadingKey({ label: "CPU", valueText: "33.0", unitText: "°C", statBadge: "", timeline: c, palette: PALETTE });
		const b = renderReadingKey({ label: "CPU", valueText: "91.4", unitText: "°F", statBadge: "", timeline: c, palette: PALETTE });
		assert.deepEqual(polylines(a), polylines(b));
	});
});

describe("Trend window on the key face", () => {
	const view = storeWith("k:1:1", "5m", [{ from: 100_000, to: 200_000, value: (at) => 50 + ((at / 1000) % 9) }]).view("k:1:1", "5m", 128, 200_000) as HistoryView;
	const base = { label: "CPU", valueText: "56.3", unitText: "°C", statBadge: "", palette: PALETTE };

	it("draws the timeline in the strip instead of the recent-samples line", () => {
		const svg = renderReadingKey({ ...base, history: [1, 2, 3], timeline: view });
		const lines = polylines(svg);
		assert.equal(lines.length, 1);
		assert.ok(lines[0]!.length > 36, "the window's columns, not 36 samples");
		assert.ok(lines.flat().every((p) => p.x >= 8 && p.x <= 136 && p.y >= 122 && p.y <= 134), "inside the spark strip");
	});

	it("a Back tile masks the hook's corner over a drawn timeline, and draws no mask over an empty one", () => {
		assert.match(renderReadingKey({ ...base, timeline: view, returnMark: true }), /<rect x="0" y="116" width="40" height="28"/);
		const empty = new HistoryStore({ now: () => 0 });
		empty.setInterest("p", [{ savedKey: "k:1:2", window: "5m" }]);
		assert.doesNotMatch(renderReadingKey({ ...base, timeline: empty.view("k:1:2", "5m", 128, 1) as HistoryView, returnMark: true }), /<rect x="0" y="116"/);
	});

	it("without a timeline the renderer output is unchanged", () => {
		assert.equal(renderReadingKey({ ...base, history: [50, 60, 55, 70, 65], timeline: undefined }), renderReadingKey({ ...base, history: [50, 60, 55, 70, 65] }));
	});
});

describe("Trend window on the two-row dial", () => {
	const store = storeWith("d:0:1", "5m", [{ from: 100_000, to: 200_000, value: (at) => 1200 + ((at / 1000) % 11) * 10 }]);
	const rowBase = { label: "CPU Fan", valueText: "1250", unitText: "RPM", selected: true, valueColor: "#FFFFFF", history: [1200, 1300, 1250] };

	it("asks for the view at the trend's own width and draws it instead of the samples", () => {
		const widths: number[] = [];
		const svg = renderDialTwoRow({ rows: [{ ...rowBase, timeline: (w) => (widths.push(w), store.view("d:0:1", "5m", w, 200_000)) }], footerText: "", palette: PALETTE });
		assert.equal(widths.length, 1);
		assert.ok(Number.isInteger(widths[0]) && (widths[0] as number) >= 40);
		const lines = polylines(svg);
		assert.equal(lines.length, 1);
		assert.ok(lines[0]!.length > 3);
	});

	it("a refused window (no view) draws the recent-samples line exactly as before", () => {
		const legacy = renderDialTwoRow({ rows: [rowBase], footerText: "", palette: PALETTE });
		assert.equal(renderDialTwoRow({ rows: [{ ...rowBase, timeline: () => undefined }], footerText: "", palette: PALETTE }), legacy);
	});

	it("Outline draws the timeline without its under-fill", () => {
		const svg = renderDialTwoRow({ rows: [{ ...rowBase, timeline: (w) => store.view("d:0:1", "5m", w, 200_000) }], footerText: "", palette: PALETTE, background: "outline" });
		assert.equal(polylines(svg).length, 1);
		assert.doesNotMatch(svg, /<path d="M[^"]*Z"/);
	});

	it("twoRowColumns is the box the face draws a window in: asked at its whole-pixel width, a full minute spans it with now at its right end", () => {
		// The Trend window e2e reads a built plugin's dial face through this
		// function, so it must be the renderer's own geometry, not a copy.
		const full = storeWith("d:0:2", "1m", [{ from: 0, to: 60_000, value: (at) => 40 + ((at / 1000) % 7) }]);
		const widths: number[] = [];
		const svg = renderDialTwoRow({
			rows: [
				{ ...rowBase, label: "Test Temp", valueText: "52.5", unitText: "°C", history: undefined, timeline: (w) => (widths.push(w), full.view("d:0:2", "1m", w, 60_000)) },
				{ ...rowBase, label: "Test Fan", selected: false, history: undefined }
			],
			footerText: "",
			palette: PALETTE
		});
		const { valueEndX, unitX, trend } = twoRowColumns([{ valueText: "52.5", unitText: "°C" }, { valueText: "1250", unitText: "RPM" }], dialBackgroundTraits(undefined).overflowRects);
		const columns = Math.floor(trend.w);
		assert.deepEqual(widths, [columns], "the view is asked at the box's whole-pixel width");
		assert.deepEqual([...svg.matchAll(/<text x="([^"]*)"[^>]*text-anchor="end"[^>]*font-weight="700"/g)].map((m) => m[1]), [valueEndX.toFixed(1), valueEndX.toFixed(1)], "both values end at the shared anchor");
		assert.deepEqual([...svg.matchAll(/<text x="([^"]*)" y="(?:40|82)" text-anchor="start"/g)].map((m) => m[1]), [unitX.toFixed(1), unitX.toFixed(1)], "both units start at the shared anchor");
		const lines = polylines(svg);
		assert.equal(lines.length, 1, "one run, on the temperature row");
		const xs = (lines[0] as Point[]).map((p) => p.x);
		const onGrid = (v: number): number => Math.round(v * 2) / 2;
		const column = trend.w / columns;
		assert.equal(Math.min(...xs), onGrid(trend.x + column / 2), "the minute's oldest sample sits in the box's first column");
		assert.equal(Math.max(...xs), onGrid(trend.x + trend.w - column / 2), "now sits in the box's last column");
	});
});

describe("settings: only exact windows where a trend is drawn", () => {
	it("historyWindowOf: the single layout's Sparkline display only", () => {
		const s: ReadingSettings = { readingKey: "a:0:1", displayMode: "sparkline", historyWindow: "5m" };
		assert.equal(historyWindowOf(s), "5m");
		assert.equal(historyWindowOf({ readingKey: "a:0:1", sparkline: true, historyWindow: "15m" }), "15m", "the legacy flag is a Sparkline display");
		for (const other of [{ displayMode: "bar" }, { displayMode: "ring" }, { displayMode: "none" }, { displayMode: undefined }, { keyLayout: "dual", secondaryReadingKey: "b:0:1" }, { historyWindow: "5M" }, { historyWindow: "" }]) {
			assert.equal(historyWindowOf({ ...s, ...other } as ReadingSettings), undefined, JSON.stringify(other));
		}
	});

	it("dialHistoryWindowOf: the two-row view only", () => {
		assert.equal(dialHistoryWindowOf({ dialView: "tworow", dialHistoryWindow: "1m" }), "1m");
		for (const other of [{ dialView: "overview" }, { dialView: "single" }, {}, { dialView: "tworow", dialHistoryWindow: 5 }, { dialView: "tworow", dialHistoryWindow: "15M" }]) {
			assert.equal(dialHistoryWindowOf({ dialHistoryWindow: "1m", ...other } as DialSettings), undefined, JSON.stringify(other));
		}
	});
});

let clockAt = Math.round(performance.now());
/** Feeds the poller's own history store `count` one-per-second samples. */
function feedPoller(key: string, count: number, value: (i: number) => number): { status: PollerStatus; now: number } {
	let snapshot = snap(reading(key, value(0)));
	for (let i = 0; i < count; i++) {
		clockAt += 1000;
		snapshot = snap(reading(key, value(i)));
		poller.history.ingest(ok(clockAt, snapshot));
	}
	return { status: { state: "ok", snapshot, source: "shared-memory" }, now: clockAt + 500 };
}

describe("compose draws a Trend window from the poller's history", () => {
	it("a key with a window and interest draws the timeline; a window with no tier keeps the recent-samples line", () => {
		const key = "c:0:1";
		poller.history.setInterest("compose-test", [{ savedKey: key, window: "1m" }]);
		const { status, now } = feedPoller(key, 30, (i) => 40 + (i % 6));
		const windowed = compose({ readingKey: key, displayMode: "sparkline", historyWindow: "1m" }, status, false, now);
		const lines = polylines(windowed);
		assert.equal(lines.length, 1);
		assert.ok(lines.flat().every((p) => p.x >= 8 + 128 / 2), "30 s of a 1-minute window: the right half only");
		// The store holds only 1m for this key (as when the budget refused
		// 15m): the face draws exactly what it draws with no window.
		const refused = compose({ readingKey: key, displayMode: "sparkline", historyWindow: "15m" }, status, false, now);
		assert.equal(refused, compose({ readingKey: key, displayMode: "sparkline" }, status, false, now), "no 15m tier: the legacy line, byte for byte");
		poller.history.dropInterest("compose-test");
	});

	it("the two-row dial draws each visible row's window through the injected source, and ignores it elsewhere", () => {
		const keys = ["c:0:2", "c:0:3"];
		const stores = new Map(keys.map((k) => [k, storeWith(k, "5m", [{ from: 100_000, to: 200_000, value: (at) => (at / 1000) % 13 }])]));
		const asked: string[] = [];
		const source: TimelineSource = (key, window, widthPx, linkedKeys) => (asked.push(`${key}/${window}/${linkedKeys === undefined ? "-" : "linked"}`), stores.get(key)?.view(key, window, widthPx, 200_000));
		const status: PollerStatus = { state: "ok", snapshot: snap(reading(keys[0]!, 5), reading(keys[1]!, 6, { label: "CPU Core" })), source: "shared-memory" };
		const state = (settings: DialSettings) => ({ settings, stats: new SessionStatsStore(), statMode: "current" as const, overlay: null, pinned: false, cyclePaused: false });
		const tworow: DialSettings = { dialView: "tworow", readingKey: keys[0], rotationKeys: keys, dialHistoryWindow: "5m" };
		const svg = composeDialSvg(state(tworow), status, undefined, source);
		assert.deepEqual(asked.sort(), [`${keys[0]}/5m/-`, `${keys[1]}/5m/-`]);
		assert.equal(polylines(svg).length, 2);
		asked.length = 0;
		composeDialSvg(state({ ...tworow, dialView: "overview" }), status, undefined, source);
		composeDialSvg(state({ ...tworow, dialView: undefined }), status, undefined, source);
		composeDialSvg(state({ ...tworow, dialHistoryWindow: "5M" }), status, undefined, source);
		assert.deepEqual(asked, [], "no other view, and no junk window, asks for history");
	});
});

describe("consumers keep interest by id and never write settings", () => {
	type Handle = { id: string; device: { id: string; name: string }; isKey(): boolean; isDial(): boolean; coordinates?: { column: number; row: number }; setSettings(settings: unknown): Promise<void> };
	type KeyBoundary = {
		instances: Map<string, { settings: ReadingSettings }>;
		presses: PressEngine;
		detailNavigator: { stateFor(deviceId: string): undefined; recentlyLeft(deviceId: string): boolean };
		renderAll(status?: PollerStatus): void;
		pushPanelPreview(): void;
		onPollerTick(status: PollerStatus): void;
		onWillAppear(ev: { action: Handle; payload: { settings: ReadingSettings } }): void;
		onWillDisappear(ev: { action: Handle; payload: { settings: ReadingSettings } }): void;
		onDidReceiveSettings(ev: { action: Handle; payload: { settings: ReadingSettings } }): void;
	};

	function keyFixture() {
		const action = Object.create(SensorReadingAction.prototype) as KeyBoundary;
		action.instances = new Map();
		action.presses = new PressEngine(() => undefined);
		// No detail session anywhere: an appear records none (detailScope).
		action.detailNavigator = { stateFor: () => undefined, recentlyLeft: () => false };
		Object.assign(action, { snoozeTaps: new Set() });
		const renders: number[] = [];
		action.renderAll = () => void renders.push(1);
		action.pushPanelPreview = () => {};
		const writes: unknown[] = [];
		const handle: Handle = { id: "key-ctx", device: { id: "dev", name: "fixture" }, isKey: () => true, isDial: () => false, setSettings: async (s) => void writes.push(s) };
		const interest: Array<[string, unknown]> = [];
		const set = mock.method(poller.history, "setInterest", (id: string, entries: unknown) => void interest.push([id, entries]));
		const drop = mock.method(poller.history, "dropInterest", (id: string) => void interest.push([id, "drop"]));
		const retain = mock.method(poller, "retain", () => {});
		const release = mock.method(poller, "release", () => {});
		const getStatus = mock.method(poller, "getStatus", (): PollerStatus => ({ state: "unavailable", reason: "not-running", message: "fixture" }));
		const subscribe = mock.method(poller, "subscribeSeries", () => {});
		return {
			action, handle, writes, interest, renders,
			event: (settings: ReadingSettings) => ({ action: handle, payload: { settings } }),
			close: () => { for (const m of [set, drop, retain, release, getStatus, subscribe]) m.mock.restore(); }
		};
	}

	it("a key asks on appear, repeats harmlessly on a replay, replaces on settings and releases on disappear", () => {
		const f = keyFixture();
		try {
			const windowed: ReadingSettings = { readingKey: "a:0:1", displayMode: "sparkline", historyWindow: "5m" };
			f.action.onWillAppear(f.event(windowed));
			f.action.onWillAppear(f.event(windowed));
			f.action.onDidReceiveSettings(f.event({ ...windowed, historyWindow: "15m" }));
			f.action.onDidReceiveSettings(f.event({ ...windowed, historyWindow: "" }));
			f.action.onDidReceiveSettings(f.event({ ...windowed, displayMode: "bar" }));
			f.action.onDidReceiveSettings(f.event({ ...windowed, keyLayout: "dual", secondaryReadingKey: "b:0:1" }));
			f.action.onDidReceiveSettings(f.event(windowed));
			f.action.onWillDisappear(f.event(windowed));
			const five = [{ savedKey: "a:0:1", window: "5m" }];
			assert.deepEqual(f.interest, [
				["key-ctx", five],
				["key-ctx", five],
				["key-ctx", [{ savedKey: "a:0:1", window: "15m" }]],
				["key-ctx", "drop"],
				["key-ctx", "drop"],
				["key-ctx", "drop"],
				["key-ctx", five],
				["key-ctx", "drop"]
			]);
			assert.deepEqual(f.writes, [], "no setSettings on appear, settings receipt or disappear");
		} finally {
			f.close();
		}
	});

	it("a key without a window keeps the status-only tick gate; with one, history moving repaints", () => {
		const f = keyFixture();
		try {
			const status: PollerStatus = { state: "ok", snapshot: snap(reading("a:0:9", 1)), source: "shared-memory" };
			f.action.instances.set("key-ctx", { settings: { readingKey: "a:0:9", displayMode: "sparkline" } });
			f.action.onPollerTick(status);
			const bump = mock.getter(poller.history, "revision", () => 77);
			f.action.onPollerTick(status);
			assert.equal(f.renders.length, 1, "no window: history never repaints the key");
			f.action.instances.set("key-ctx", { settings: { readingKey: "a:0:9", displayMode: "sparkline", historyWindow: "1m" } });
			f.action.onPollerTick(status);
			bump.mock.mockImplementation(() => 78);
			f.action.onPollerTick(status);
			f.action.onPollerTick(status);
			assert.equal(f.renders.length, 3, "one repaint per history change, none for an unchanged tick");
			bump.mock.restore();
			assert.deepEqual(f.writes, []);
		} finally {
			f.close();
		}
	});

	it("a two-row dial keeps interest equal to its visible rows and releases it on disappear", () => {
		type DialBoundary = {
			instances: Map<string, InstanceState>;
			hidden: Map<string, unknown>;
			syncRowHistory(id: string, state: InstanceState, status: PollerStatus): void;
			onWillDisappear(ev: { action: Handle }): void;
			traceLifecycle(): void;
		};
		const action = Object.create(SensorDialAction.prototype) as DialBoundary;
		action.instances = new Map();
		action.hidden = new Map();
		action.traceLifecycle = () => {};
		const interest: Array<[string, unknown]> = [];
		const set = mock.method(poller.history, "setInterest", (id: string, entries: unknown) => void interest.push([id, entries]));
		const drop = mock.method(poller.history, "dropInterest", (id: string) => void interest.push([id, "drop"]));
		const release = mock.method(poller, "release", () => {});
		try {
			const keys = ["r:0:1", "r:0:2", "r:0:3"];
			const status: PollerStatus = { state: "ok", snapshot: snap(...keys.map((k, i) => reading(k, i))), source: "shared-memory" };
			const state = { settings: { dialView: "tworow", readingKey: keys[2], rotationKeys: keys, dialHistoryWindow: "1m" }, stats: new SessionStatsStore(), statMode: "current", lastFeedback: "", nextCycleAt: null, cyclePaused: false, pinned: false, gesture: IDLE_GESTURE, overlay: null, overlayTimer: null, deviceId: "dev", pendingAlertUnitStamp: false } as InstanceState;
			action.syncRowHistory("dial-ctx", state, status);
			action.syncRowHistory("dial-ctx", state, { state: "stale", snapshot: status.state === "ok" ? status.snapshot : snap(), source: "shared-memory", staleForMs: 20_000 });
			action.syncRowHistory("dial-ctx", { ...state, settings: { ...state.settings, dialView: "overview" } }, status);
			action.instances.set("dial-ctx", state);
			action.onWillDisappear({ action: { id: "dial-ctx", device: { id: "dev", name: "fixture" }, isKey: () => false, isDial: () => true, setSettings: async () => {} } });
			assert.deepEqual(interest, [
				["dial-ctx:rows", [{ savedKey: keys[1], window: "1m" }, { savedKey: keys[2], window: "1m" }]],
				["dial-ctx:rows", "drop"],
				["dial-ctx:rows", "drop"]
			], "rows on screen; unknown rows while stale keep the last interest; another view drops; disappear drops");
		} finally {
			set.mock.restore();
			drop.mock.restore();
			release.mock.restore();
		}
	});
});
