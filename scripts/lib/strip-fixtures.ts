/**
 * Strip Display fixtures shared by test/strip-slicer.test.ts and
 * scripts/strip-boards.mjs: synthetic history views (no HWiNFO needed), the
 * scene matrix (every style x background x accent x geometry x layout), and
 * the rasterizing used to compare stitched slices against the full-width
 * reference frame with sharp (librsvg).
 *
 * Each fixture deliberately puts a one-bucket spike right before the first
 * seam and a label across a seam, the two places where a slice that
 * restarted its graph would show.
 */
import sharp from "sharp";

import type { HistoryView, HistoryViewSegment, HistoryWindowId } from "../../src/history/types";
import { SensorType } from "../../src/hwinfo/types";
import { DIAL_BACKGROUNDS, type DialBackground } from "../../src/ui/dial-background";
import type { TextSettings } from "../../src/ui/text-colors";
import { loadThemes, resolvePalette } from "../../src/ui/themes";
import { cursorAgoMs, paneExtents, panePlotOf, SLICE_W, stripWidth, type StripEncoders, type StripLayout } from "../../src/strip/geometry";
import type { Bins } from "../../src/strip/graph";
import { historyWidthFor, renderLogical, stripAlertColors, stripBandsFor, WINDOW_MS, type StripPaneInput, type StripSceneInput, type StripSeriesInput } from "../../src/strip/scene";
import { EMPTY_PANE, stripConfigOf, type StripConfigV1, type StripPaneV1, type StripStyle } from "../../src/strip/settings";
import { sliceStrip, type StripSlices } from "../../src/strip/slicer";

export type ViewSpec = {
	readonly windowMs: number;
	readonly widthPx: number;
	readonly unit: string;
	readonly type?: SensorType;
	/** Value at window fraction f (0 oldest, 1 newest). */
	readonly value: (f: number) => number;
	/** Window fractions with no observation: [from, to). */
	readonly gaps?: readonly (readonly [number, number])[];
	/** History begins at this fraction (short history). */
	readonly from?: number;
	/** One view column forced to this value (a sharp spike). */
	readonly spike?: { readonly column: number; readonly value: number };
};

/** A HistoryView as the store would hand it over: M4 columns over the whole
 * window, segments split at gaps. */
export function makeView(spec: ViewSpec): HistoryView {
	const n = spec.widthPx;
	const x = new Float64Array(n);
	const first = new Float64Array(n);
	const min = new Float64Array(n);
	const max = new Float64Array(n);
	const last = new Float64Array(n);
	const seg = new Uint16Array(n);
	const segments: HistoryViewSegment[] = [];
	const observed = (f: number): boolean => f >= (spec.from ?? 0) && !(spec.gaps ?? []).some(([a, b]) => f >= a && f < b);
	let count = 0;
	let ordinal = -1;
	let open = false;
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (let c = 0; c < n; c++) {
		const samples: number[] = [];
		for (let s = 0; s < 4; s++) {
			const f = (c + (s + 0.5) / 4) / n;
			if (observed(f)) samples.push(spec.spike !== undefined && spec.spike.column === c ? spec.spike.value : spec.value(f));
		}
		if (samples.length === 0) {
			if (open) {
				const current = segments[segments.length - 1] as HistoryViewSegment;
				segments[segments.length - 1] = { ...current, x1: c, open: false, endReason: "stale" };
				open = false;
			}
			continue;
		}
		if (!open) {
			ordinal++;
			segments.push({ ordinal, x0: c, x1: c + 1, open: true, source: "shared-memory" });
			open = true;
		} else {
			const current = segments[segments.length - 1] as HistoryViewSegment;
			segments[segments.length - 1] = { ...current, x1: c + 1 };
		}
		x[count] = c;
		first[count] = samples[0] as number;
		last[count] = samples[samples.length - 1] as number;
		min[count] = Math.min(...samples);
		max[count] = Math.max(...samples);
		seg[count] = ordinal;
		lo = Math.min(lo, min[count] as number);
		hi = Math.max(hi, max[count] as number);
		count++;
	}
	const fromX = spec.from !== undefined && spec.from > 0 ? spec.from * n : null;
	return {
		windowMs: spec.windowMs,
		widthPx: n,
		now: 1_000_000,
		unit: spec.unit,
		type: spec.type ?? SensorType.Temperature,
		cols: { x, first, min, max, last, seg, n: count },
		segments,
		hidden: [],
		extent: count === 0 ? null : { min: lo, max: hi },
		observedFromX: fromX,
		lastSampleAgeMs: 0,
		revision: 1
	};
}

/** One bucket of a view's bins, as a test lists it. */
export type BucketSpec = { readonly j: number; readonly seg: number; readonly first: number; readonly min: number; readonly max: number; readonly last: number };

/** Bins (src/strip/graph.ts) holding these buckets, in order. */
export function binsOf(buckets: readonly BucketSpec[]): Bins {
	const n = buckets.length;
	return {
		n,
		j: Int32Array.from(buckets, (b) => b.j),
		seg: Int32Array.from(buckets, (b) => b.seg),
		first: Float64Array.from(buckets, (b) => b.first),
		min: Float64Array.from(buckets, (b) => b.min),
		max: Float64Array.from(buckets, (b) => b.max),
		last: Float64Array.from(buckets, (b) => b.last)
	};
}

/** The buckets bins hold, one by one. */
export function bucketsOf(bins: Bins): BucketSpec[] {
	return Array.from({ length: bins.n }, (_, i) => ({ j: bins.j[i] as number, seg: bins.seg[i] as number, first: bins.first[i] as number, min: bins.min[i] as number, max: bins.max[i] as number, last: bins.last[i] as number }));
}

const wave = (base: number, amp: number, k: number) => (f: number) => base + amp * Math.sin(f * k) + (amp / 3) * Math.cos(f * k * 3.1);

type SeriesSpec = { key: string; name: string; unit: string; type: SensorType; value: (f: number) => number; gaps?: [number, number][]; from?: number; spike?: number };

const SERIES: Record<string, SeriesSpec> = {
	cpu: { key: "f0:0:1", name: "CPU Package Temperature (Tdie average)", unit: "°C", type: SensorType.Temperature, value: wave(62, 14, 9), spike: 96, gaps: [[0.55, 0.6]] },
	gpu: { key: "f0:0:2", name: "GPU Temperature", unit: "°C", type: SensorType.Temperature, value: wave(58, 10, 6), from: 0.2 },
	hot: { key: "f0:0:3", name: "GPU Hot Spot", unit: "°C", type: SensorType.Temperature, value: wave(76, 12, 7), spike: 99, gaps: [[0.4, 0.47]] },
	load: { key: "f0:0:4", name: "GPU Load", unit: "%", type: SensorType.Usage, value: (f) => Math.max(0, Math.min(100, 55 + 40 * Math.sin(f * 11))) },
	power: { key: "f0:0:5", name: "CPU Package Power", unit: "W", type: SensorType.Power, value: wave(90, 45, 13), spike: 210 },
	fan: { key: "f0:0:6", name: "Pump", unit: "RPM", type: SensorType.Fan, value: wave(2800, 90, 5) },
	// Yes/No limiters (0 is No, 1 is Yes): three stretches of throttling,
	// one across the first seam, and a power limit that comes and goes.
	htc: { key: "f0:0:7", name: "Thermal Throttling (HTC)", unit: "Yes/No", type: SensorType.Other, value: (f) => ((f > 0.18 && f < 0.24) || (f > 0.47 && f < 0.49) || f > 0.86 ? 1 : 0), gaps: [[0.62, 0.66]] },
	plim: { key: "f0:0:8", name: "GPU Performance Limit - Power", unit: "Yes/No", type: SensorType.Other, value: (f) => (Math.sin(f * 23) > 0.7 ? 1 : 0) },
	// Windows' virtual memory as HWiNFO lists it: two sizes in MB and a load
	// in %, the readings of the owner's mixed-unit Compare (2026-10-26).
	vmCommitted: { key: "f0:0:9", name: "Virtual Memory Committed", unit: "MB", type: SensorType.Other, value: (f) => 92_400 + 500 * Math.sin(f * 17) + 200 * Math.sin(f * 61) },
	vmAvailable: { key: "f0:0:10", name: "Virtual Memory Available", unit: "MB", type: SensorType.Other, value: (f) => 37_900 - 500 * Math.sin(f * 17) - 200 * Math.sin(f * 61) },
	vmLoad: { key: "f0:0:11", name: "Virtual Memory Load", unit: "%", type: SensorType.Usage, value: (f) => 71 + 0.4 * Math.sin(f * 17) }
};

const STYLE_SERIES: Record<StripStyle, string[]> = {
	trend: ["cpu", "gpu"],
	area: ["hot"],
	compare: ["cpu", "gpu", "power"],
	lanes: ["hot", "load", "power"],
	heat: ["hot"],
	group: ["cpu"],
	ambient: ["cpu"],
	meters: ["cpu", "gpu", "hot", "load", "power", "fan"],
	events: ["htc", "plim", "hot"]
};

const STYLE_BANDS: Record<StripStyle, { key: string; warn?: number; crit?: number; below?: boolean }[]> = {
	trend: [{ key: "f0:0:1", warn: 70, crit: 85 }],
	area: [{ key: "f0:0:3", warn: 80, crit: 90 }],
	compare: [{ key: "f0:0:2", warn: 64 }],
	lanes: [{ key: "f0:0:3", crit: 85 }],
	heat: [{ key: "f0:0:3", warn: 80, crit: 90 }],
	group: [],
	ambient: [],
	meters: [
		{ key: "f0:0:3", warn: 85, crit: 95 },
		{ key: "f0:0:6", warn: 1200, below: true }
	],
	events: [{ key: "f0:0:3", warn: 85, crit: 95 }]
};

export const STRIP_STYLES_ALL: readonly StripStyle[] = ["trend", "area", "compare", "lanes", "heat"];
export const LOOKS: readonly { readonly background: DialBackground; readonly accent: boolean }[] = (["theme", "glass", "tint", "outline", "clear"] as const).flatMap((background) => [
	{ background, accent: false },
	{ background, accent: true }
]);

/** The readout layouts and overlays a fixture pane can add (absent: none,
 * the pane exactly as before them). `series` picks fixture readings by id
 * (cpu, gpu, hot, load, power, fan) in place of the style's own. `scale`
 * is a stored Scale from / Scale to as the panel writes it (stampedScale
 * builds one with its unit stamp; without a stamp it is a scale stored
 * before the stamp, with its old reach). */
export type PaneExtras = { readonly readout?: "left" | "only"; readonly axes?: boolean; readonly series?: readonly string[]; readonly names?: boolean; readonly scale?: Readonly<Record<string, unknown>> };

/** A stored scale stamped with the unit it was typed in, as the panel
 * writes it: the ends, the unit on view, the record of the numbers. */
export function stampedScale(ends: { readonly min?: number; readonly max?: number }, unit: string): Record<string, unknown> {
	const record: Record<string, string> = {};
	if (ends.min !== undefined) record.min = String(ends.min);
	if (ends.max !== undefined) record.max = String(ends.max);
	return { ...ends, displayUnit: unit, displayUnitFor: record };
}

export function fixturePane(style: StripStyle, extras: PaneExtras = {}): StripPaneV1 {
	const series = (extras.series ?? STYLE_SERIES[style]).map((id) => ({ key: (SERIES[id] as SeriesSpec).key }));
	const overlays = { minmax: style === "trend", ...(extras.axes === true ? { axes: true } : {}), ...(extras.names === false ? { legend: false } : {}) };
	const raw = { style, series, overlays, bands: STYLE_BANDS[style], ...(extras.readout === undefined ? {} : { readout: extras.readout }), ...(extras.scale === undefined ? {} : { scale: extras.scale }) };
	return (stripConfigOf({ panes: [raw] }).panes[0] ?? EMPTY_PANE) as StripPaneV1;
}

/** The fixture readings by id, for callers that pick their own. */
export const FIXTURE_SERIES: readonly string[] = Object.keys(SERIES);

export type FixtureCase = {
	readonly id: string;
	readonly input: StripSceneInput;
};

/** One scene: `styles[0]` in pane 0, `styles[1]` in pane 1 when split. */
export function fixtureCase(params: { styles: readonly StripStyle[]; layout: StripLayout; encoders: StripEncoders; background: DialBackground; accent: boolean; theme?: string; window?: HistoryWindowId; paused?: boolean; present?: boolean[]; extras?: readonly PaneExtras[]; fahrenheit?: boolean; decimals?: string }): FixtureCase {
	const config: StripConfigV1 = stripConfigOf({
		layout: params.layout,
		encoders: params.encoders,
		window: params.window ?? "5m",
		background: params.background,
		accentWords: params.accent,
		theme: params.theme ?? "graphite",
		...(params.fahrenheit === true ? { fahrenheit: true } : {}),
		...(params.decimals === undefined ? {} : { decimals: params.decimals })
	});
	const extras = params.extras ?? [];
	const panes = params.layout === "whole" ? [fixturePane(params.styles[0] as StripStyle, extras[0])] : [fixturePane(params.styles[0] as StripStyle, extras[0]), fixturePane((params.styles[1] ?? params.styles[0]) as StripStyle, extras[1] ?? extras[0])];
	const fullConfig: StripConfigV1 = { ...config, panes: [panes[0] as StripPaneV1, panes[1] ?? EMPTY_PANE] };
	const themes = loadThemes();
	const palette = resolvePalette(themes, params.theme ?? "graphite", null, "normal");
	const extents = paneExtents(params.layout, params.encoders);
	const windowMs = WINDOW_MS[fullConfig.window];
	const paneInputs: StripPaneInput[] = panes.map((pane, i) => {
		const plot = panePlotOf(pane, extents[i] as { x0: number; x1: number }, 2);
		const width = historyWidthFor(fullConfig, params.encoders, i, 2);
		// The spike lands in the bucket just left of the first seam inside the pane.
		const seamX = (Math.floor(plot.x0 / SLICE_W) + 1) * SLICE_W;
		const spikeColumn = Math.max(0, Math.floor((seamX - plot.x0) / plot.bucketPx) - 1);
		const series: StripSeriesInput[] = pane.series.map((s) => {
			const spec = Object.values(SERIES).find((x) => x.key === s.key) as SeriesSpec;
			const history = makeView({ windowMs, widthPx: width, unit: spec.unit, type: spec.type, value: spec.value, ...(spec.gaps === undefined ? {} : { gaps: spec.gaps }), ...(spec.from === undefined ? {} : { from: spec.from }), ...(spec.spike === undefined ? {} : { spike: { column: spikeColumn, value: spec.spike } }) });
			return { key: s.key, name: spec.name, unit: spec.unit, state: "ok", history, current: spec.value(1) };
		});
		return {
			series,
			bands: stripBandsFor(pane, series, { fahrenheit: fullConfig.fahrenheit, decimals: fullConfig.decimals }),
			view: params.paused === true ? { mode: "paused", label: "14:02:51", agoMs: cursorAgoMs(plot, windowMs, Math.floor(plot.buckets / 3)) } : { mode: "live" },
			highlight: 0
		};
	});
	const text: TextSettings = { mode: "theme", color: undefined, dimSecondary: false };
	const input: StripSceneInput = {
		config: fullConfig,
		encoders: params.encoders,
		palette,
		text,
		alertColors: stripAlertColors(themes.alertValues, palette, config.background),
		dataUnits: "decimal",
		panes: paneInputs,
		...(params.present === undefined ? {} : { present: params.present })
	};
	const look = `${params.background}${params.accent ? "+accent" : ""}`;
	const tag = extras.length === 0 ? "" : `-${extras.map((e) => `${e.readout ?? "graph"}${e.axes === true ? "+scale" : ""}`).join("+")}`;
	return { id: `${params.layout}-${params.encoders === 4 ? "plus" : "plusxl"}-${params.styles.slice(0, params.layout === "whole" ? 1 : 2).join("+")}-${look}${tag}`, input };
}

/** The seam matrix: every style in whole and in split (each style in both
 * halves across the set), every look with accent on and off, both decks. */
/**
 * The Y scale's boards (40-spec-final.md 10.4), on a whole + XL strip:
 * a stamped Scale from / Scale to on every style that draws one; a typed
 * scale the readings pass at both ends (each passed end takes the passing
 * reading's color), on Graphite with Theme, Tint and Outline, Words in the
 * accent color off and on.
 */
export function scaleMatrix(): FixtureCase[] {
	const out: FixtureCase[] = [];
	const stamped: [StripStyle, Record<string, unknown>, PaneExtras][] = [
		["trend", stampedScale({ min: 30, max: 90 }, "°C"), {}],
		["lanes", stampedScale({ min: 30, max: 90 }, "°C"), { axes: true }],
		["heat", stampedScale({ min: 50, max: 100 }, "°C"), {}],
		["meters", stampedScale({ min: 30, max: 90 }, "°C"), {}]
	];
	for (const [style, scale, extra] of stamped) out.push({ ...fixtureCase({ styles: [style], layout: "whole", encoders: 6, background: "theme", accent: false, extras: [{ ...extra, scale }] }), id: `scale-stamped-${style}` });
	for (const background of ["theme", "tint", "outline"] as const) {
		for (const accent of [false, true]) {
			const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background, accent, theme: "graphite", extras: [{ series: ["cpu"], scale: stampedScale({ min: 55, max: 70 }, "°C") }] });
			out.push({ ...c, id: `scale-passed-${background}-${accent ? "accent" : "plain"}` });
		}
	}
	return out;
}

export function seamMatrix(): FixtureCase[] {
	const out: FixtureCase[] = [];
	for (const encoders of [4, 6] as const) {
		for (const look of LOOKS) {
			STRIP_STYLES_ALL.forEach((style, i) => {
				out.push(fixtureCase({ styles: [style], layout: "whole", encoders, background: look.background, accent: look.accent }));
				out.push(fixtureCase({ styles: [style, STRIP_STYLES_ALL[(i + 1) % STRIP_STYLES_ALL.length] as StripStyle], layout: "split", encoders, background: look.background, accent: look.accent }));
			});
		}
	}
	return out;
}

/** The readout matrix's geometries: + XL whole (1200) and split (600 a
 * half), + whole (800) and split (400 a half). */
export const READOUT_GEOMETRIES: readonly { readonly encoders: StripEncoders; readonly layout: StripLayout }[] = [
	{ encoders: 6, layout: "whole" },
	{ encoders: 6, layout: "split" },
	{ encoders: 4, layout: "whole" },
	{ encoders: 4, layout: "split" }
];

/** The readout modes the matrix covers: large values beside the graph,
 * values only, either with Scale and grid, and the graph alone with it. */
export const READOUT_MODES: readonly { readonly name: string; readonly extras: PaneExtras }[] = [
	{ name: "left", extras: { readout: "left" } },
	{ name: "left+scale", extras: { readout: "left", axes: true } },
	{ name: "only", extras: { readout: "only" } },
	{ name: "scale", extras: { axes: true } }
];

export const READOUT_LOOKS: readonly { readonly background: DialBackground; readonly accent: boolean }[] = [
	{ background: "theme", accent: false },
	{ background: "glass", accent: false },
	{ background: "tint", accent: false },
	{ background: "outline", accent: false },
	{ background: "outline", accent: true },
	{ background: "clear", accent: false }
];

/** Every readout mode x graph style x look x geometry;
 * a split puts the same mode and style in both halves. */
export function readoutMatrix(styles: readonly StripStyle[] = STRIP_STYLES_ALL, looks = READOUT_LOOKS): FixtureCase[] {
	const out: FixtureCase[] = [];
	for (const g of READOUT_GEOMETRIES) {
		for (const mode of READOUT_MODES) {
			for (const style of styles) {
				for (const look of looks) {
					const c = fixtureCase({ styles: [style, style], layout: g.layout, encoders: g.encoders, background: look.background, accent: look.accent, extras: [mode.extras, mode.extras] });
					out.push({ ...c, id: `${g.layout}-${g.encoders * 200}-${style}-${mode.name}-${look.background}${look.accent ? "+accent" : ""}` });
				}
			}
		}
	}
	return out;
}

// ---- Group panes ---------------------------------------------------------------

/** The readings a Group fixture can stand for: per-core temperatures (core
 * 5 runs hot and crosses 85 and 95), per-core clocks (core 5 throttles when
 * it is hot), per-thread usage, fans. Every core is a little different. */
export type GroupFixtureKind = "temp" | "clock" | "usage";

const GROUP_KIND: Record<GroupFixtureKind, { unit: string; type: SensorType; label: (i: number) => string; value: (i: number, f: number) => number }> = {
	temp: { unit: "°C", type: SensorType.Temperature, label: (i) => `Core ${i} Temperature`, value: (i, f) => 52 + (i >= 8 ? 2 : 0) + 6 * Math.sin(f * 7 + i * 0.7) + (i === 5 ? 40 * Math.max(0, Math.sin(f * 3.1)) : 18 * Math.max(0, Math.sin(f * 3.1 + i * 0.2)) * (i < 6 ? 1 : 0.4)) },
	clock: { unit: "MHz", type: SensorType.Clock, label: (i) => `Core ${i} Clock`, value: (i, f) => 4900 + 120 * Math.sin(f * 9 + i) + (i === 5 ? -220 * Math.max(0, Math.sin(f * 3.1)) : 0) + (i % 3) * 25 },
	usage: { unit: "%", type: SensorType.Usage, label: (i) => `Core ${i} T${i % 2} Usage`, value: (i, f) => Math.max(0, Math.min(100, 30 + 45 * Math.sin(f * 5 + i * 0.9) + (i === 5 ? 30 : 0))) }
};

export type GroupFixtureParams = {
	readonly n: number;
	readonly kind?: GroupFixtureKind;
	readonly view?: "auto" | "rows" | "now" | "spread" | "tiles";
	readonly layout?: StripLayout;
	readonly encoders?: StripEncoders;
	readonly background?: DialBackground;
	readonly accent?: boolean;
	readonly theme?: string;
	readonly window?: HistoryWindowId;
	readonly limits?: { readonly warn?: number; readonly crit?: number; readonly below?: boolean };
	/** The highlighted reading's index, or null (home). */
	readonly highlight?: number | null;
	readonly paused?: boolean;
	/** Worst case for the payload: every reading moves on every column and
	 * gaps as dense as every `gapEvery` columns (0: none). */
	readonly noise?: number;
	readonly gapEvery?: number;
	/** What the rule matched beyond the drawn readings. */
	readonly sameUnit?: number;
	readonly otherUnits?: number;
	readonly refused?: number;
	readonly present?: boolean[];
	readonly overlays?: Record<string, boolean>;
};

/** A Group pane in pane 0 (both halves of a split): the scene input a
 * frame of `n` readings of one kind would make. */
export function groupFixture(params: GroupFixtureParams): FixtureCase {
	const layout = params.layout ?? "whole";
	const encoders = params.encoders ?? 6;
	const kind = GROUP_KIND[params.kind ?? "temp"];
	const window = params.window ?? "5m";
	const group = { from: "filter", filter: "*core*", keys: [], view: params.view ?? "auto", ...(params.limits === undefined ? {} : { limits: { below: false, ...params.limits } }) };
	const raw = { style: "group", series: [], group, ...(params.overlays === undefined ? {} : { overlays: params.overlays }) };
	const config: StripConfigV1 = stripConfigOf({ layout, encoders, window, background: params.background ?? "theme", accentWords: params.accent === true, theme: params.theme ?? "graphite", panes: [raw, raw] });
	const themes = loadThemes();
	const palette = resolvePalette(themes, params.theme ?? "graphite", null, "normal");
	const windowMs = WINDOW_MS[window];
	const panes: StripPaneInput[] = (layout === "whole" ? [0] : [0, 1]).map((p) => {
		const width = historyWidthFor(config, encoders, p, 2);
		const series: StripSeriesInput[] = Array.from({ length: params.n }, (_, i) => {
			const value = params.noise === undefined ? (f: number) => kind.value(i, f) : (f: number) => kind.value(i, f) + (params.noise as number) * Math.sin(f * 4001 * (1.3 + i * 0.37));
			const every = params.gapEvery ?? 0;
			const gaps: [number, number][] = every > 0 ? Array.from({ length: Math.floor(width / every) }, (_, g) => [(g * every) / width, (g * every + 1) / width]) : [[0.62, 0.65]];
			const refused = i < (params.refused ?? 0);
			const history = refused ? undefined : makeView({ windowMs, widthPx: width, unit: kind.unit, type: kind.type, value, gaps, from: i % 7 === 3 ? 0.1 : 0 });
			return { key: `c0:0:${(0x1000000 + i).toString(16)}`, name: kind.label(i), unit: kind.unit, state: "ok", ...(history === undefined ? { noRoom: true as const } : { history }), current: value(1) };
		});
		const pane = config.panes[p as 0 | 1];
		const highlight = params.highlight ?? null;
		return {
			series,
			bands: stripBandsFor(pane, series, { fahrenheit: config.fahrenheit, decimals: config.decimals }),
			view: params.paused === true ? { mode: "paused", label: "14:02:51", agoMs: windowMs / 3 } : { mode: "live" },
			highlight: 0,
			group: { status: "ok", title: "*core*", unit: kind.unit, sameUnit: params.sameUnit ?? params.n, otherUnits: params.otherUnits ?? 0, refused: params.refused ?? 0, highlightKey: highlight === null ? null : (series[highlight]?.key ?? null) }
		};
	});
	const text: TextSettings = { mode: "theme", color: undefined, dimSecondary: false };
	const input: StripSceneInput = {
		config,
		encoders,
		palette,
		text,
		alertColors: stripAlertColors(themes.alertValues, palette, config.background),
		dataUnits: "decimal",
		panes,
		...(params.present === undefined ? {} : { present: params.present })
	};
	return { id: `group-${layout}-${encoders * 200}-${params.view ?? "auto"}-n${params.n}-${params.kind ?? "temp"}-${params.background ?? "theme"}`, input };
}

// ---- Ambient panes ---------------------------------------------------------

/** Readings an Ambient fixture stands for: this PC's temperatures (smooth,
 * whole-degree drives), every unit mixed in HWiNFO's order (clocks first,
 * the noisiest real data), or a random walk that moves every reading on
 * every column (the worst case for bytes). */
export type AmbientFixtureKind = "temp" | "mixed" | "walk";

const MIXED_UNITS: readonly { unit: string; type: SensorType; base: number; amp: number; label: string }[] = [
	{ unit: "MHz", type: SensorType.Clock, base: 4800, amp: 400, label: "Core {i} Clock" },
	{ unit: "°C", type: SensorType.Temperature, base: 55, amp: 20, label: "Core {i} Temperature" },
	{ unit: "%", type: SensorType.Usage, base: 40, amp: 45, label: "Core {i} T0 Usage" },
	{ unit: "W", type: SensorType.Power, base: 90, amp: 60, label: "Core {i} Power" },
	{ unit: "RPM", type: SensorType.Fan, base: 1400, amp: 500, label: "Fan {i}" }
];

/** A deterministic hash in [0, 1) of two integers. */
function hash01(a: number, b: number): number {
	let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca77)) >>> 0;
	h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
	h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
	return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export type AmbientFixtureParams = {
	readonly n: number;
	readonly kind?: AmbientFixtureKind;
	readonly layout?: StripLayout;
	readonly encoders?: StripEncoders;
	readonly background?: DialBackground;
	readonly theme?: string;
	readonly window?: HistoryWindowId;
	/** Every reading stale (the source stopped). */
	readonly stale?: boolean;
	/** History starts at this window fraction (short history). */
	readonly from?: number;
	/** Gaps every `gapEvery` columns (0: the one pause at 0.62). */
	readonly gapEvery?: number;
	readonly refused?: number;
	readonly missing?: number;
	readonly sameUnit?: number;
	readonly present?: boolean[];
	readonly bucketPx?: 1 | 2 | 4 | 8;
	/** Moves the data in time (a later frame of the same readings). */
	readonly shift?: number;
};

/** One Ambient reading's value at window fraction f. */
function ambientValue(kind: AmbientFixtureKind, i: number, f: number): number {
	if (kind === "walk") {
		const m = MIXED_UNITS[i % MIXED_UNITS.length] as (typeof MIXED_UNITS)[number];
		return m.base + m.amp * (hash01(i, Math.floor(f * 4000)) - 0.5);
	}
	if (kind === "mixed") {
		const m = MIXED_UNITS[i % MIXED_UNITS.length] as (typeof MIXED_UNITS)[number];
		const load = Math.max(0, Math.sin(f * 6.3 + 0.4)) * (0.6 + 0.4 * Math.sin(i));
		return m.base + m.amp * (load - 0.3) + (m.amp / 8) * Math.sin(f * 90 + i * 1.7) + (m.amp / 20) * (hash01(i, Math.floor(f * 600)) - 0.5);
	}
	// Temperatures: cores follow the load with their own lag, drives move
	// in whole degrees.
	if (i % 9 === 8) return Math.round(38 + 4 * Math.sin(f * 2 + i));
	const load = Math.max(0, Math.sin(f * 6.3 + i * 0.05)) ** 1.5;
	return 46 + (i % 5) * 1.5 + 32 * load + 2 * Math.sin(f * 40 + i);
}

/** An Ambient pane in pane 0 (both halves of a split). */
export function ambientFixture(params: AmbientFixtureParams): FixtureCase {
	const layout = params.layout ?? "whole";
	const encoders = params.encoders ?? 6;
	const kind = params.kind ?? "temp";
	const window = params.window ?? "15m";
	const raw = { style: "ambient", series: [], group: { from: "unit", unit: "°C", keys: [], view: "auto" } };
	const config: StripConfigV1 = stripConfigOf({ layout, encoders, window, background: params.background ?? "clear", theme: params.theme ?? "graphite", panes: [raw, raw] });
	const themes = loadThemes();
	const palette = resolvePalette(themes, params.theme ?? "graphite", null, "normal");
	const windowMs = WINDOW_MS[window];
	const panes: StripPaneInput[] = (layout === "whole" ? [0] : [0, 1]).map((p) => {
		const width = historyWidthFor(config, encoders, p, params.bucketPx ?? 2);
		const series: StripSeriesInput[] = Array.from({ length: params.n }, (_, i) => {
			const m = kind === "temp" ? { unit: "°C", type: SensorType.Temperature, label: i % 9 === 8 ? "Drive {i} Temperature" : "Core {i} Temperature" } : (MIXED_UNITS[i % MIXED_UNITS.length] as (typeof MIXED_UNITS)[number]);
			const shift = params.shift ?? 0;
			const value = (f: number): number => ambientValue(kind, i, f + shift);
			const every = params.gapEvery ?? 0;
			const gaps: [number, number][] = every > 0 ? Array.from({ length: Math.floor(width / every) }, (_, g) => [(g * every) / width, (g * every + 1) / width]) : [[0.62, 0.65]];
			const refused = i >= params.n - (params.refused ?? 0);
			const missing = i < (params.missing ?? 0);
			const history = refused || missing ? undefined : makeView({ windowMs, widthPx: width, unit: m.unit, type: m.type, value, gaps, ...(params.from === undefined ? (i % 11 === 6 ? { from: 0.8 } : {}) : { from: params.from }) });
			const state = missing ? ("missing" as const) : params.stale === true ? ("stale" as const) : ("ok" as const);
			return { key: `d0:0:${(0x1000000 + i).toString(16)}`, name: m.label.replace("{i}", String(i)), unit: m.unit, state, ...(history === undefined ? (refused ? { noRoom: true as const } : {}) : { history }), ...(state === "ok" ? { current: value(1) } : {}) };
		});
		return {
			series,
			bands: [],
			view: { mode: "live" },
			highlight: 0,
			group: { status: "ok", title: "°C", unit: kind === "temp" ? "°C" : "MHz", sameUnit: params.sameUnit ?? params.n, otherUnits: 0, refused: params.refused ?? 0, highlightKey: null }
		};
	});
	const text: TextSettings = { mode: "theme", color: undefined, dimSecondary: false };
	const input: StripSceneInput = {
		config,
		encoders,
		palette,
		text,
		alertColors: stripAlertColors(themes.alertValues, palette, config.background),
		dataUnits: "decimal",
		panes,
		...(params.bucketPx === undefined ? {} : { bucketPx: params.bucketPx }),
		...(params.present === undefined ? {} : { present: params.present })
	};
	return { id: `ambient-${layout}-${encoders * 200}-${window}-n${params.n}-${kind}-${params.background ?? "clear"}`, input };
}

// ---- Strip Screens -------------------------------------------------------------

export type ScreensSpec = {
	/** Screens on the strip (2 to 8) and the one on view (0-based). */
	readonly count: number;
	readonly at: number;
	/** Screens (0-based) holding a reading past a critical limit. */
	readonly alerts?: readonly number[];
	/** The name the window words take for a moment after a change; with
	 * no name, the place alone ("2 of 5"). Absent: the window words. */
	readonly name?: string;
};

/** A whole-strip fixture shown as one of several screens: the position
 * line, the hidden screens' critical marks, and with `name` the screen's
 * name and place in its window words (StripSceneInput.screens). */
export function withScreens(c: FixtureCase, spec: ScreensSpec): FixtureCase {
	const alerts = Array.from({ length: spec.count }, (_, i) => spec.alerts?.includes(i) === true);
	const label = spec.name === undefined ? undefined : { name: spec.name, place: `${spec.at + 1} of ${spec.count}` };
	const panes = c.input.panes.map((p, i) => (i === 0 && label !== undefined ? { ...p, screenLabel: label } : p));
	return { id: `${c.id}-screens${spec.at + 1}of${spec.count}${spec.alerts === undefined ? "" : "+alert"}${spec.name === undefined ? "" : "+name"}`, input: { ...c.input, panes, screens: { count: spec.count, at: spec.at, alerts } } };
}

/** Screens over every whole-strip style, both decks, every look (the art
 * looks included), the name shown and a hidden critical screen, at the
 * most screens a strip keeps. */
export function screensMatrix(count = 8): FixtureCase[] {
	const out: FixtureCase[] = [];
	const name = "CPU and GPU temperatures";
	for (const encoders of [4, 6] as const) {
		for (const background of DIAL_BACKGROUNDS) {
			const spec = { count, at: 1, alerts: [count - 1], name };
			for (const style of ["trend", "area", "compare", "lanes", "heat", "meters", "events"] as const) out.push(withScreens(fixtureCase({ styles: [style], layout: "whole", encoders, background, accent: false }), spec));
			out.push(withScreens(fixtureCase({ styles: ["trend"], layout: "whole", encoders, background, accent: false, extras: [{ readout: "left", axes: true }] }), spec));
			out.push(withScreens(groupFixture({ n: 32, kind: "clock", view: "auto", encoders, background, limits: { warn: 85, crit: 95 } }), spec));
			out.push(withScreens(groupFixture({ n: 16, kind: "temp", view: "rows", encoders, background }), spec));
			out.push(withScreens(ambientFixture({ n: 48, kind: "mixed", encoders, background }), spec));
		}
	}
	return out;
}

// ---- rasterizing -------------------------------------------------------------

/** A deterministic stand-in for the touch strip picture: a diagonal color
 * ramp with bright and dark bars, so translucent panels and the edge show. */
export function backdrop(width: number): Buffer {
	const buf = Buffer.alloc(width * 100 * 4);
	for (let y = 0; y < 100; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const bar = Math.floor((x + y) / 37) % 3;
			buf[i] = bar === 0 ? 240 : Math.round(40 + (x / width) * 160);
			buf[i + 1] = bar === 1 ? 20 : Math.round(60 + (y / 100) * 140);
			buf[i + 2] = bar === 2 ? 250 : 90;
			buf[i + 3] = 255;
		}
	}
	return buf;
}

export type Raster = { readonly data: Buffer; readonly width: number; readonly height: number };

/** An SVG rendered over the backdrop at its own size, as raw RGBA. */
async function renderAt(svg: string, width: number, bg: Buffer, slices: readonly { svg: string; left: number; expanded?: boolean }[] = []): Promise<Raster> {
	const layers: Parameters<ReturnType<typeof sharp>["composite"]>[0] = [];
	if (svg !== "") layers.push({ input: Buffer.from(svg), left: 0, top: 0 });
	for (const s of slices) {
		if (s.expanded === true) {
			// A renderer that draws a filter region past the viewport: render the
			// slice on a canvas widened by the bleed, then keep the slot.
			const wide = s.svg.replace('viewBox="0 0 200 100" width="200" height="100"', 'viewBox="-3 0 206 100" width="206" height="100"');
			const png = await sharp(Buffer.from(wide)).extract({ left: 3, top: 0, width: 200, height: 100 }).png().toBuffer();
			layers.push({ input: png, left: s.left, top: 0 });
		} else {
			layers.push({ input: Buffer.from(s.svg), left: s.left, top: 0 });
		}
	}
	const { data, info } = await sharp(bg, { raw: { width, height: 100, channels: 4 } }).composite(layers).raw().toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
}

export async function rasterReference(svg: string, width: number): Promise<Raster> {
	return renderAt(svg, width, backdrop(width));
}

/** Slices placed side by side at their encoder columns over the backdrop. */
export async function rasterStitched(slices: readonly (string | null)[], width: number, expanded = false): Promise<Raster> {
	const placed = slices.flatMap((svg, c) => (svg === null ? [] : [{ svg, left: c * SLICE_W, expanded }]));
	return renderAt("", width, backdrop(width), placed);
}

export type PixelDiff = { readonly maxDiff: number; readonly over: number; readonly worst: { x: number; y: number } | null; readonly columns: ReadonlySet<number> };

/** Per-pixel channel difference; `over` counts pixels whose largest channel
 * difference passes `tolerance`, `columns` lists their x. */
export function diffRasters(a: Raster, b: Raster, tolerance: number, skipColumns: ReadonlySet<number> = new Set()): PixelDiff {
	let maxDiff = 0;
	let over = 0;
	let worst: { x: number; y: number } | null = null;
	const columns = new Set<number>();
	for (let y = 0; y < a.height; y++) {
		for (let x = 0; x < a.width; x++) {
			if (skipColumns.has(x)) continue;
			const i = (y * a.width + x) * 4;
			const d = Math.max(Math.abs((a.data[i] as number) - (b.data[i] as number)), Math.abs((a.data[i + 1] as number) - (b.data[i + 1] as number)), Math.abs((a.data[i + 2] as number) - (b.data[i + 2] as number)));
			if (d > maxDiff) {
				maxDiff = d;
				worst = { x, y };
			}
			if (d > tolerance) {
				over++;
				columns.add(x);
			}
		}
	}
	return { maxDiff, over, worst, columns };
}

/** The full-width reference and the stitched slices of one case, plus the
 * slices' own payload. */
export async function renderCase(c: FixtureCase, expanded = false): Promise<{ slices: StripSlices; reference: Raster; stitched: Raster; width: number }> {
	const slices = sliceStrip(c.input);
	const width = stripWidth(c.input.encoders);
	const reference = await rasterReference(renderLogical(slices.scene), width);
	const stitched = await rasterStitched(slices.slices, width, expanded);
	return { slices, reference, stitched, width };
}

/** Raw RGBA to PNG, for boards. */
export async function rasterPng(r: Raster): Promise<Buffer> {
	return sharp(r.data, { raw: { width: r.width, height: r.height, channels: 4 } }).png().toBuffer();
}
