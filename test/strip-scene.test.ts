/**
 * The logical strip frame: truthful time (short history is never stretched,
 * gaps stay gaps, peaks survive bucketing), honest scales (Compare never
 * shares a scale across units, Lanes give each reading its own), heat cells
 * with a distinct missing mark, reading-scoped labelled bands, LIVE and
 * PAUSED, and no plausible-looking zero for a missing value.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bucketsOf, fixtureCase, groupFixture, makeView, STRIP_STYLES_ALL, type FixtureCase } from "../scripts/lib/strip-fixtures";
import { busyCpu, threadLabels, tilesFixture, tilesSamples } from "../scripts/lib/tiles-fixtures";
import type { HistoryView } from "../src/history/types";
import { SensorType } from "../src/hwinfo/types";
import { estimateKeyTextWidth } from "../src/ui/format";
import { setFaceFont } from "../src/ui/face-font";
import { alertValueColor, loadThemes, resolvePalette } from "../src/ui/themes";
import { cursorAgoMs, laneHeight, LANES_TOP, paneExtents, panePlot, plotFor } from "../src/strip/geometry";
import { binView, heatCells, observedSpans, scaleOf, valueAt, yOf } from "../src/strip/graph";
import type { LinePrim, Prim, TextPrim } from "../src/strip/prims";
import { stripLookOf } from "../src/strip/frame";
import { eventRows } from "../src/strip/events";
import { GROUP_BAND_OPACITY, GROUP_BAR_OPACITY, GROUP_BOTTOM, GROUP_TOP, groupRows, ICE_RAMP } from "../src/strip/group";
import { alignedNow, blendOver, buildStripScene, historyWidthFor, renderLogical, ROW_SURFACE_OPACITY, STRIP_ROWS, STRIP_SERIES_COLORS, stripBandsFor, stripMessageFace, unitBands, type StripPaneInput, type StripSceneInput, type StripSeriesInput } from "../src/strip/scene";
import { ciede2000, hexToLab } from "../src/ui/color-difference";
import { DIAL_BACKGROUNDS, dialTextColors, dialTextPalette, lookOn, type DialBackground } from "../src/ui/dial-background";
import { GLASS_INK_OPACITY, GLASS_OPACITY, TINT_OPACITY } from "../src/ui/glass";
import { contrastRatio, luminance, mixToward, noDimmerThan, readableColor, readableValueColor } from "../src/ui/text-colors";
import { stripConfigOf, stripPaneOf, type StripConfigV1, type StripPaneV1, type StripStyle } from "../src/strip/settings";
import { CORE_DIM, TILE_VEIL, tileRampAt } from "../src/strip/tiles";
import { sliceStrip } from "../src/strip/slicer";

setFaceFont("tahoma");
const themes = loadThemes();
const palette = resolvePalette(themes, "graphite", null, "normal");
const THEME_TEXT = { mode: "theme" as const, color: undefined, dimSecondary: false };

function scene(opts: { style: StripStyle; series: StripSeriesInput[]; overlays?: Record<string, boolean>; bands?: unknown[]; fahrenheit?: boolean; paused?: boolean; cursor?: number; encoders?: 4 | 6; background?: string; scale?: Record<string, unknown>; dataUnits?: "decimal" | "binary" }): { input: StripSceneInput; prims: readonly Prim[]; pane: StripPaneV1 } {
	const pane = stripPaneOf({ style: opts.style, series: opts.series.map((s) => ({ key: s.key })), overlays: opts.overlays ?? {}, bands: opts.bands ?? [], scale: opts.scale ?? {} });
	const config = { ...stripConfigOf({ encoders: opts.encoders ?? 4, fahrenheit: opts.fahrenheit === true, background: opts.background ?? "theme" }), panes: [pane, pane] as const };
	const input: StripSceneInput = {
		config,
		encoders: opts.encoders ?? 4,
		palette,
		text: THEME_TEXT,
		alertColors: { warn: "#FFB000", crit: "#FF3B30" },
		dataUnits: opts.dataUnits ?? "decimal",
		panes: [{ series: opts.series, bands: stripBandsFor(pane, opts.series, { fahrenheit: opts.fahrenheit === true, decimals: "auto" }), view: opts.paused === true || opts.cursor !== undefined ? { mode: "paused", label: "12:00:01", agoMs: cursorAgoMs(plotFor(opts.style, paneExtents("whole", opts.encoders ?? 4)[0] as { x0: number; x1: number }, 2), 300_000, opts.cursor ?? 10) } : { mode: "live" }, highlight: 0 }]
	};
	return { input, prims: buildStripScene(input).prims, pane };
}

const lines = (prims: readonly Prim[]): LinePrim[] => prims.filter((p): p is LinePrim => p.k === "line");
const textsOf = (prims: readonly Prim[]): string[] => prims.filter((p): p is TextPrim => p.k === "text").map((p) => p.text);
const WIDTH = 400; // the whole pane on a + at 2 px buckets
/** The legend's color chips sit on the names' row, their top on the cap line. */
const CHIP_Y = STRIP_ROWS.topBaseline - STRIP_ROWS.chip - 1;
const series = (key: string, unit: string, view: Parameters<typeof makeView>[0] | undefined, extra: Partial<StripSeriesInput> = {}): StripSeriesInput => ({ key, name: key.toUpperCase(), unit, state: "ok", ...(view === undefined ? {} : { history: makeView(view) }), ...extra });

describe("truthful time", () => {
	it("short history occupies only the right part of the plot", () => {
		const { prims } = scene({ style: "trend", series: [series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 50, from: 0.75 })] });
		const line = lines(prims)[0] as LinePrim;
		assert.ok((line.pts[0] as number) >= 0.75 * 800 - 2, `starts at ${line.pts[0]}`);
		assert.ok((line.pts[line.pts.length - 2] as number) >= 797);
	});

	it("a view of any width lands each column at its own time (no stretching by sample count)", () => {
		const view = makeView({ windowMs: 60_000, widthPx: 37, unit: "W", value: (f) => f * 100, from: 0.5 });
		const bins = bucketsOf(binView(view, 400));
		assert.ok((bins[0]?.j as number) >= 199, "half the window is unobserved, so half the plot stays empty");
		for (let i = 0; i < view.cols.n; i++) {
			const x = view.cols.x[i] as number;
			const j = bins.find((b) => b.first === view.cols.first[i])?.j as number;
			assert.ok(j >= (x / 37) * 400 && j < ((x + 1) / 37) * 400, `column ${x} in bucket ${j}`);
		}
	});

	it("a gap is a gap: segments never join", () => {
		const { prims } = scene({ style: "trend", series: [series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: (f) => 40 + f * 10, gaps: [[0.3, 0.4], [0.6, 0.65]] })] });
		assert.equal(lines(prims).length, 3);
	});

	it("a one-bucket spike keeps its full height at every bucket width", () => {
		const view = makeView({ windowMs: 300_000, widthPx: 800, unit: "°C", value: () => 40, spike: { column: 401, value: 95 } });
		for (const buckets of [800, 400, 200, 100]) {
			const peak = Math.max(...bucketsOf(binView(view, buckets)).map((b) => b.max));
			assert.equal(peak, 95, `at ${buckets} buckets`);
		}
	});

	it("history is asked for at the plot's own bucket count, and right edges align to whole buckets", () => {
		const config = stripConfigOf({ layout: "split", encoders: 6, panes: [{ style: "trend" }, { style: "heat" }] });
		assert.equal(historyWidthFor(config, 6, 0), panePlot(paneExtents("split", 6)[0] as { x0: number; x1: number }, 2).buckets);
		assert.equal(historyWidthFor(config, 6, 1), plotFor("heat", paneExtents("split", 6)[1] as { x0: number; x1: number }, 2).buckets);
		assert.equal(alignedNow(1001, 300_000, 400), 1500);
		assert.equal(alignedNow(1500, 300_000, 400), 1500);
	});
});

describe("no number twice, no lone unit", () => {
	const v = (u: string, base: number) => ({ windowMs: 300_000, widthPx: WIDTH, unit: u, value: (f: number) => base + f });
	const two = (unit: string): StripSeriesInput[] => [series("cpu", unit, v(unit, 50), { current: 51 }), series("gpu", unit, v(unit, 60), { current: 61 })];

	for (const style of ["trend", "area"] as const) {
		it(`${style} of two: the reading shown large keeps its name alone, the other its value`, () => {
			const words = textsOf(scene({ style, series: two("°C"), encoders: 6 }).prims);
			assert.ok(words.includes("CPU"), words.join(" | "));
			assert.ok(!words.some((w) => w.startsWith("CPU ")), words.join(" | "));
			assert.ok(words.some((w) => /^GPU 61/.test(w)), words.join(" | "));
			assert.equal(words.filter((w) => /^51(\.0)?$/.test(w)).length, 1, "large at the right, once");
		});
	}

	it("a turn to the other reading swaps which one stands alone", () => {
		const { input } = scene({ style: "trend", series: two("°C"), encoders: 6 });
		const words = textsOf(buildStripScene({ ...input, panes: [{ ...(input.panes[0] as StripPaneInput), highlight: 1 }] }).prims);
		assert.ok(words.includes("GPU") && words.some((w) => /^CPU 51/.test(w)), words.join(" | "));
	});

	it("names too long to sit beside the large value keep every value, in the names row", () => {
		const long = two("°C").map((s) => ({ ...s, name: `${s.name} Temperature Sensor Reading Package` }));
		const words = textsOf(scene({ style: "trend", series: long, encoders: 4 }).prims);
		assert.ok(words.some((w) => /51/.test(w)) && words.some((w) => /61/.test(w)), words.join(" | "));
	});

	it("Compare says its unit on the scale's end, not again at the far right", () => {
		const words = textsOf(scene({ style: "compare", series: two("°C"), encoders: 6 }).prims);
		assert.ok(!words.includes("°C"), words.join(" | "));
		assert.ok(words.some((w) => /\d °C$/.test(w)), `the scale's top end: ${words.join(" | ")}`);
		assert.ok(words.some((w) => /^CPU 51/.test(w)) && words.some((w) => /^GPU 61/.test(w)), "each reading's value stays in the names line");
	});

	it("Compare with the unit box off prints no unit at all", () => {
		const words = textsOf(scene({ style: "compare", series: two("°C"), encoders: 6, overlays: { unit: false } }).prims);
		assert.ok(!words.some((w) => /°C/.test(w)), words.join(" | "));
		assert.ok(words.some((w) => /^CPU 51/.test(w)), words.join(" | "));
	});

	it("a Compare with no history yet still says the unit on the scale's end", () => {
		const { input } = scene({ style: "compare", series: two("°C"), encoders: 6 });
		const empty = input.panes.map((p) => ({ ...p, series: p.series.map((s) => ({ ...s, history: undefined })) }));
		assert.ok(textsOf(buildStripScene({ ...input, panes: empty }).prims).some((w) => /\d °C$/.test(w)));
	});
});

describe("honest scales", () => {
	it("Compare draws same-unit series on one scale and another unit in a band of its own, below it", () => {
		const v = (u: string, base: number) => ({ windowMs: 300_000, widthPx: WIDTH, unit: u, value: (f: number) => base + f });
		const { prims } = scene({ style: "compare", series: [series("cpu", "°C", v("°C", 50)), series("gpu", "°C", v("°C", 60)), series("pwr", "W", v("W", 200))] });
		const drawn = lines(prims);
		assert.equal(drawn.length, 3, "every reading draws");
		const [top, bottom] = unitBands(2) as [{ top: number; bottom: number }, { top: number; bottom: number }];
		const within = (l: LinePrim, b: { top: number; bottom: number }): boolean => l.pts.every((v, i) => i % 2 === 0 || (v >= b.top - 1 && v <= b.bottom + 1));
		assert.ok(within(drawn[0] as LinePrim, top) && within(drawn[1] as LinePrim, top), "the °C readings share the top band");
		assert.ok(within(drawn[2] as LinePrim, bottom), "the W reading has the bottom band");
		assert.ok(!textsOf(prims).some((t) => t.includes("other unit")));
		assert.ok(textsOf(prims).some((t) => t.startsWith("PWR") && t.includes("W")), "its value carries its unit");
	});

	it("Trend with a second unit does the same: no silent normalization, no reading left out", () => {
		const { prims } = scene({ style: "trend", series: [series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 50 }), series("rpm", "RPM", { windowMs: 300_000, widthPx: WIDTH, unit: "RPM", value: () => 2000 })] });
		assert.equal(lines(prims).length, 2);
		const ends = prims.filter((p): p is TextPrim => p.k === "text" && p.layer === "rows" && p.size === 11 && p.anchor === "start" && p.x < 12).map((p) => p.text);
		assert.ok(ends.some((t) => t.endsWith("°C")) && ends.some((t) => t.endsWith("RPM")), `each band names its scale and unit: ${ends.join("|")}`);
	});

	it("Lanes give each reading its own scale and its own label", () => {
		const s = [series("tmp", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: (f) => 40 + f * 20 }), series("rpm", "RPM", { windowMs: 300_000, widthPx: WIDTH, unit: "RPM", value: (f) => 900 + f * 2000 })];
		const { prims } = scene({ style: "lanes", series: s });
		const [a, b] = lines(prims) as [LinePrim, LinePrim];
		const ys = (l: LinePrim): number[] => l.pts.filter((_, i) => i % 2 === 1);
		// Each line draws on its own lane's scale, and the lanes do not
		// overlap: 40 to 60 °C fills its lane; 900 to 2900 RPM, on a scale
		// from zero with room above, sits in the upper part of its own.
		assert.ok(Math.max(...ys(a)) < Math.min(...ys(b)));
		assert.ok(Math.max(...ys(a)) - Math.min(...ys(a)) > 20);
		assert.ok(Math.max(...ys(b)) - Math.min(...ys(b)) > 10);
		const t = textsOf(prims);
		assert.ok(t.includes("TMP") && t.includes("RPM"));
	});

	it("manual scale ends win; a flat series sits mid-plot", () => {
		assert.deepEqual(scaleOf({ lo: 40, hi: 60 }, { min: 0, max: 100 }, "°C", false), { lo: 0, hi: 100 });
		assert.deepEqual(scaleOf({ lo: 50, hi: 50 }, {}, "W", false), { lo: 47.5, hi: 52.5 });
		// °F scale ends map back to the native °C the history holds.
		assert.deepEqual(scaleOf({ lo: 40, hi: 60 }, { min: 32, max: 212 }, "°C", true), { lo: 0, hi: 100 });
		// A temperature difference shown in Δ°F maps back by 1.8, no offset.
		assert.deepEqual(scaleOf({ lo: 2, hi: 8 }, { min: 0, max: 18 }, "Δ°C", true), { lo: 0, hi: 10 });
		assert.deepEqual(scaleOf({ lo: 2, hi: 8 }, { min: 0, max: 18 }, "Δ°C", false), { lo: 0, hi: 18 });
	});
});

describe("heat", () => {
	it("cells hold the bin maximum, hold through sparse samples inside a segment, and are missing outside", () => {
		const view = makeView({ windowMs: 300_000, widthPx: 50, unit: "°C", value: (f) => 40 + f * 40, gaps: [[0.5, 0.6]], from: 0.1 });
		const cells = heatCells(view, 100);
		assert.ok(Number.isNaN(cells[0]), "before history began");
		assert.ok(Number.isNaN(cells[55]), "inside the gap");
		assert.ok(cells.slice(15, 45).every((c) => !Number.isNaN(c)), "sparse samples inside a segment hold");
	});

	it("a missing cell draws the distinct mark; band cells take the alert color", () => {
		const s = [series("hot", "°C", { windowMs: 300_000, widthPx: 100, unit: "°C", value: (f) => 60 + f * 40, gaps: [[0.2, 0.3]] })];
		const { prims } = scene({ style: "heat", series: s, bands: [{ key: "hot", warn: 80, crit: 95 }] });
		assert.ok(prims.some((p) => p.k === "marks" && p.xs.length > 0));
		const fills = prims.filter((p) => p.k === "rect").map((p) => (p as { paint: string }).paint);
		assert.ok(fills.includes('fill="#FFB000"') && fills.includes('fill="#FF3B30"'));
		assert.ok(textsOf(prims).some((t) => t.startsWith("5 min · max per")));
		assert.ok(textsOf(prims).includes("HOT warn 80.0 °C · crit 95.0 °C"), "the legend names the limits the caps stand for");
	});

	it("a band typed in Δ°F caps a temperature difference where it converts to, labelled Δ°F", () => {
		// 12 Δ°C is 21.6 Δ°F: at or above an 18 Δ°F (10 Δ°C) warn band.
		const s = [series("gap", "Δ°C", { windowMs: 300_000, widthPx: 100, unit: "Δ°C", value: () => 12 }, { current: 12 })];
		const { prims } = scene({ style: "heat", series: s, fahrenheit: true, bands: [{ key: "gap", warn: 18, unit: "Δ°C" }] });
		const fills = prims.filter((p) => p.k === "rect").map((p) => (p as { paint: string }).paint);
		assert.ok(fills.includes('fill="#FFB000"'), "the warn color caps the cells");
		assert.ok(textsOf(prims).some((t) => t.includes("warn 18.0 Δ°F")), textsOf(prims).join("|"));
		const below = scene({ style: "heat", series: s, fahrenheit: true, bands: [{ key: "gap", warn: 25, unit: "Δ°C" }] });
		assert.ok(!below.prims.filter((p) => p.k === "rect").map((p) => (p as { paint: string }).paint).includes('fill="#FFB000"'), "21.6 Δ°F stays under 25 Δ°F");
	});
});

describe("bands", () => {
	const two = [series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: (f) => 50 + f * 50 }), series("gpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 60 })];

	it("a band names its reading when the graph carries more than one", () => {
		const pane = stripPaneOf({ series: [{ key: "cpu" }, { key: "gpu" }], bands: [{ key: "cpu", warn: 80, crit: 90 }] });
		const bands = stripBandsFor(pane, two, { fahrenheit: false, decimals: "auto" });
		assert.deepEqual(bands.map((b) => [b.level, b.from, b.to, b.readingKey, b.label]), [
			["warn", 80, 90, "cpu", "CPU warn 80.0 °C"],
			["crit", 90, Number.POSITIVE_INFINITY, "cpu", "CPU crit 90.0 °C"]
		]);
		assert.ok(bands.every((b) => b.source === "strip"));
	});

	it("below bands open downward; °F labels convert; a band typed for another unit is not drawn", () => {
		const fan = [series("fan", "RPM", undefined)];
		const below = stripBandsFor(stripPaneOf({ series: [{ key: "fan" }], bands: [{ key: "fan", warn: 600, crit: 300, below: true }] }), fan, { fahrenheit: false, decimals: "0" });
		assert.deepEqual(below.map((b) => [b.level, b.from, b.to, b.label]), [
			["crit", Number.NEGATIVE_INFINITY, 300, "crit 300 RPM"],
			["warn", 300, 600, "warn 600 RPM"]
		]);
		const f = stripBandsFor(stripPaneOf({ series: [{ key: "cpu" }], bands: [{ key: "cpu", crit: 194 }] }), two, { fahrenheit: true, decimals: "0" });
		assert.equal(f[0]?.label, "crit 194 °F");
		const wrongUnit = stripBandsFor(stripPaneOf({ series: [{ key: "cpu" }], bands: [{ key: "cpu", crit: 90, unit: "W" }] }), two, { fahrenheit: false, decimals: "0" });
		assert.deepEqual(wrongUnit, []);
	});

	it("a data-unit limit reads in the value's own tier language, never a magnitude suffix before its unit", () => {
		const mem = [series("mem", "MB", undefined)];
		const bands = stripBandsFor(stripPaneOf({ series: [{ key: "mem" }], bands: [{ key: "mem", warn: 12100, crit: 20000 }] }), mem, { fahrenheit: false, decimals: "auto", dataUnits: "decimal" });
		assert.deepEqual(bands.map((b) => b.label), ["warn 12.1GB", "crit 20.0GB"]);
		assert.deepEqual(bands.map((b) => [b.from, b.to]), [[12100, 20000], [20000, Number.POSITIVE_INFINITY]], "the limits themselves stay HWiNFO's numbers");
		const rate = [series("dl", "KB/s", undefined)];
		assert.equal(stripBandsFor(stripPaneOf({ series: [{ key: "dl" }], bands: [{ key: "dl", warn: 450000 }] }), rate, { fahrenheit: false, decimals: "auto", dataUnits: "decimal" })[0]?.label, "warn 3.60Gbps", "a rate's limit reads in the bits the value shows");
		assert.equal(stripBandsFor(stripPaneOf({ series: [{ key: "mem" }], bands: [{ key: "mem", warn: 12100 }] }), mem, { fahrenheit: false, decimals: "auto", dataUnits: "binary" })[0]?.label, "warn 11.8GiB", "Binary reads HWiNFO's MB as MiB (issue #59)");
		for (const label of bands.map((b) => b.label)) assert.doesNotMatch(label, /\d[kMGT] /, label);
	});

	it("a band is drawn only where its reading is: a GPU band never sits on the CPU lane", () => {
		const { prims } = scene({ style: "lanes", series: two, bands: [{ key: "gpu", crit: 59 }] });
		const crit = prims.filter((p) => p.k === "rect" && (p as { paint: string }).paint === 'fill="#FF3B30"');
		assert.ok(crit.length > 0);
		// The GPU lane is the second, lower lane.
		assert.ok(crit.every((p) => (p as { y: number }).y > 40));
	});
});

describe("overlays, badges and values", () => {
	const flat = (extra: Partial<StripSeriesInput> = {}): StripSeriesInput[] => [series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 50 }, extra)];

	it("LIVE or PAUSED is always shown; inspect adds the cursor and its offset", () => {
		assert.ok(textsOf(scene({ style: "trend", series: flat() }).prims).includes("LIVE"));
		const paused = scene({ style: "trend", series: flat(), paused: true }).prims;
		assert.ok(textsOf(paused).includes("PAUSED 12:00:01"));
		assert.ok(textsOf(paused).some((t) => /at -\d+:\d\d/.test(t)));
	});

	describe("LIVE goes while every reading has stopped", () => {
		const v = (u: string, base: number) => ({ windowMs: 300_000, widthPx: WIDTH, unit: u, value: () => base });
		const two = (a: StripSeriesInput["state"], c: StripSeriesInput["state"]): StripSeriesInput[] => [series("cpu", "°C", v("°C", 50), { state: a }), series("gpu", "°C", v("°C", 60), { state: c })];
		it("every reading stale or unavailable: no LIVE", () => {
			assert.ok(!textsOf(scene({ style: "trend", series: two("stale", "stale") }).prims).includes("LIVE"));
			assert.ok(!textsOf(scene({ style: "trend", series: two("stale", "unavailable") }).prims).includes("LIVE"));
			assert.ok(!textsOf(scene({ style: "trend", series: two("stale", "missing") }).prims).includes("LIVE"), "a missing reading says nothing about the source");
		});
		it("one reading still live, or none listed at all: LIVE stays", () => {
			assert.ok(textsOf(scene({ style: "trend", series: two("ok", "stale") }).prims).includes("LIVE"));
			assert.ok(textsOf(scene({ style: "trend", series: two("missing", "missing") }).prims).includes("LIVE"));
		});
		it("inspecting says PAUSED whatever the readings do", () => {
			assert.ok(textsOf(scene({ style: "trend", series: two("stale", "stale"), paused: true }).prims).includes("PAUSED 12:00:01"));
		});
		it("its slot stays reserved: nothing else on the bottom row moves", () => {
			const c = groupFixture({ n: 12, view: "rows", limits: { warn: 85, crit: 95 } });
			const staleInput: StripSceneInput = { ...c.input, panes: c.input.panes.map((p) => ({ ...p, series: p.series.map((s) => ({ ...s, state: "stale" as const })) })) };
			const row = (input: StripSceneInput): string[] => buildStripScene(input).prims.filter((p): p is TextPrim => p.k === "text" && p.y === STRIP_ROWS.bottomBaseline && p.text !== "LIVE").map((p) => `${p.text}@${p.x}`);
			assert.ok(row(c.input).length > 0);
			assert.deepEqual(row(staleInput), row(c.input));
			assert.ok(!textsOf(buildStripScene(staleInput).prims).includes("LIVE"));
		});
	});

	it("overlays off keep the normal view bare: no value, no names, the scale's ends, the plot takes the height", () => {
		const { prims } = scene({ style: "trend", series: flat(), overlays: { current: false, legend: false, time: false } });
		// A flat 50 °C: the calm 5 °C span on round ends near it.
		assert.deepEqual(textsOf(prims).sort(), ["48", "53 °C", "LIVE"]);
		const ys = lines(prims)[0]?.pts.filter((_, i) => i % 2 === 1) ?? [];
		assert.ok(ys.every((y) => y >= STRIP_ROWS.plotTop && y <= STRIP_ROWS.plotBottom));
	});

	it("min/max carry the window", () => {
		// The bottom row's words, in order: a part whose number would cross a
		// seam is its own text, moved past it.
		const words = (prims: readonly Prim[]): string =>
			prims
				.filter((p): p is TextPrim => p.k === "text" && p.y === STRIP_ROWS.bottomBaseline && p.anchor === "start")
				.sort((a, b) => a.x - b.x)
				.map((p) => p.text)
				.join(" ");
		assert.ok(words(scene({ style: "trend", series: flat(), overlays: { minmax: true } }).prims).startsWith("5 min · min 50.0 · max 50.0 °C"));
		assert.ok(words(scene({ style: "trend", series: flat(), overlays: { minmax: true, time: false } }).prims).endsWith("over 5 min"));
	});

	it("a missing or stale reading says so; it never shows as zero", () => {
		const missing = textsOf(scene({ style: "trend", series: [series("cpu", "°C", undefined, { state: "missing" })] }).prims);
		assert.ok(missing.includes("not found"));
		assert.ok(!missing.some((t) => /^0(\.0+)?$/.test(t)));
		const stale = textsOf(scene({ style: "trend", series: flat({ state: "stale", current: Number.NaN }) }).prims);
		assert.ok(stale.includes("stale"));
		const nan = textsOf(scene({ style: "trend", series: [series("cpu", "°C", undefined, { current: Number.NaN })] }).prims);
		assert.ok(nan.includes("no data"));
	});

	it("an empty pane asks for readings; Compare and Lanes ask for a second one", () => {
		assert.ok(textsOf(scene({ style: "trend", series: [] }).prims).includes("Choose readings in the dial settings"));
		assert.ok(textsOf(scene({ style: "compare", series: flat() }).prims).includes("Compare needs a second reading"));
		assert.ok(textsOf(scene({ style: "lanes", series: flat() }).prims).includes("Lanes needs a second reading"));
	});
});

describe("looks", () => {
	it("one square panel per pane: Theme opaque, Glass and Tint translucent, Outline and Clear none", () => {
		const panelOf = (background: string): string[] => {
			const c = fixtureCase({ styles: ["trend", "area"], layout: "split", encoders: 4, background: background as "theme", accent: false });
			return buildStripScene(c.input).prims.filter((p) => p.k === "rect" && p.y === 0 && p.h === 100 && p.w > 100).map((p) => `${(p as { x: number }).x}+${(p as { w: number }).w} ${(p as { paint: string }).paint}`);
		};
		assert.deepEqual(panelOf("theme"), [`0+399 fill="${palette.bg}"`, `401+399 fill="${palette.bg}"`]);
		assert.deepEqual(panelOf("glass"), ['0+399 fill="url(#p)"', '401+399 fill="url(#p)"']);
		assert.deepEqual(panelOf("tint"), ['0+399 fill="url(#t)"', '401+399 fill="url(#t)"']);
		assert.deepEqual(panelOf("outline"), []);
		assert.deepEqual(panelOf("clear"), []);
		assert.ok(!renderLogical(buildStripScene(fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: "glass", accent: false }).input)).includes(" rx="), "square corners");
	});

	it("Outline and Tint draw every mark inside the edge group; Clear backs its lines", () => {
		const outline = buildStripScene(fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: "outline", accent: false }).input);
		assert.ok(outline.ring !== null);
		assert.ok(renderLogical(outline).includes('<g filter="url(#h)">'));
		const clear = buildStripScene(fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: "clear", accent: false }).input);
		assert.ok(lines(clear.prims).every((l) => l.backing !== undefined && l.backing.width === l.width + 2));
		assert.ok(lines(clear.prims).every((l) => l.width <= 2), "strokes stay within the 2 px bleed");
	});

	it("Words in the accent color change words on Glass, Tint and Outline only", () => {
		const words = (background: string, accent: boolean): string => {
			const s = buildStripScene(fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: background as "theme", accent }).input);
			return s.prims.filter((p): p is TextPrim => p.k === "text").map((p) => p.fill).join(",");
		};
		for (const look of ["theme", "clear"]) assert.equal(words(look, true), words(look, false), look);
		for (const look of ["glass", "tint", "outline"]) assert.notEqual(words(look, true), words(look, false), look);
	});

	it("no em dash in any word a strip draws", () => {
		for (const style of ["trend", "area", "compare", "lanes", "heat"] as const) {
			const svg = sliceStrip(fixtureCase({ styles: [style], layout: "whole", encoders: 6, background: "theme", accent: false, paused: true }).input).slices.join("");
			assert.ok(!svg.includes("\u2014"), style);
		}
	});

	it("explained faces for slots that cannot draw use the dial's own look", () => {
		const face = stripMessageFace(["Strip set up for", "Stream Deck + XL (6 dials)"], { background: "outline", palette, text: THEME_TEXT, accent: false });
		assert.ok(face.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">'));
		assert.ok(face.includes("Stream Deck + XL (6 dials)") && face.includes('<g filter="url(#h)">') && face.endsWith("</g></svg>"));
	});
});

// ---- readings at a time: gaps stay gaps ------------------------------------

/** One open or closed segment over [0, last], sampled every `every` px:
 * the empty columns between samples are inside the segment. */
function sparseView(open: boolean, every = 10, last = 391): HistoryView {
	const xs: number[] = [];
	for (let x = 0; x <= last; x += every) xs.push(x);
	const n = xs.length;
	const col = (v: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => v(i));
	return {
		windowMs: 60_000,
		widthPx: 400,
		now: 1_000_000,
		unit: "°C",
		type: SensorType.Temperature,
		cols: { x: Float64Array.from(xs), first: col((i) => 50 + i), min: col((i) => 50 + i), max: col((i) => 50 + i), last: col((i) => 50 + i), seg: new Uint16Array(n), n },
		segments: [{ ordinal: 0, x0: 0, x1: last + 0.5, open, source: "shared-memory" }],
		hidden: [],
		extent: { min: 50, max: 50 + n - 1 },
		observedFromX: null,
		lastSampleAgeMs: 0,
		revision: 1
	};
}

/** The top row's right-aligned value or status word of a one-pane scene. */
const topRight = (prims: readonly Prim[]): string[] => prims.filter((p): p is TextPrim => p.k === "text" && p.y === STRIP_ROWS.topBaseline && p.anchor === "end").map((p) => p.text);

describe("a reading at a time is only ever an observed one", () => {
	// 70 until f = 0.3, nothing over [0.3, 0.8), then 40.
	const gapped = (extra: Partial<StripSeriesInput> = {}): StripSeriesInput => series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: (f) => (f < 0.3 ? 70 : 40), gaps: [[0.3, 0.8]] }, extra);
	const atBucket = (j: number): number => 399 - j;

	it("Trend paused inside a gap says no data, never the value from before the gap", () => {
		const inGap = topRight(scene({ style: "trend", series: [gapped()], cursor: atBucket(200) }).prims);
		assert.ok(inGap.includes("no data"), inGap.join("|"));
		assert.ok(!inGap.includes("70.0"));
		assert.ok(topRight(scene({ style: "trend", series: [gapped()], cursor: atBucket(100) }).prims).includes("70.0"));
		assert.ok(topRight(scene({ style: "trend", series: [gapped()], cursor: atBucket(350) }).prims).includes("40.0"));
	});

	it("before history began there is no reading either", () => {
		const late = series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 55, from: 0.5 });
		const t = topRight(scene({ style: "trend", series: [late], cursor: atBucket(100) }).prims);
		assert.ok(t.includes("no data") && !t.includes("55.0"), t.join("|"));
	});

	it("Lanes paused inside a gap say no data in every lane", () => {
		const other = series("pwr", "W", { windowMs: 300_000, widthPx: WIDTH, unit: "W", value: (f) => (f < 0.3 ? 10 : 20), gaps: [[0.3, 0.8]] });
		const t = textsOf(scene({ style: "lanes", series: [gapped(), other], cursor: atBucket(200) }).prims);
		assert.ok(!t.includes("70.0 °C") && !t.includes("10.0 W"), t.join("|"));
		assert.equal(t.filter((x) => x === "no data").length, 2);
		const before = textsOf(scene({ style: "lanes", series: [gapped(), other], cursor: atBucket(100) }).prims);
		assert.ok(before.includes("70.0 °C") && before.includes("10.0 W"));
	});

	it("Compare paused inside a gap shows no data for that series only", () => {
		const steady = series("gpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 60 });
		const t = textsOf(scene({ style: "compare", series: [gapped(), steady], cursor: atBucket(200) }).prims);
		assert.ok(t.includes("CPU no data") && t.includes("GPU 60.0"), t.join("|"));
	});

	it("live, the reading is the poller's current value; without one there is none, open segment or not", () => {
		// The poller lists the reading (state ok) but passes no current value
		// when it is not finite: a calculated reading whose input went
		// missing publishes NaN, and its last value must not read as current.
		const closed = series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 45, gaps: [[0.8, 1.01]] });
		assert.ok(topRight(scene({ style: "trend", series: [closed] }).prims).includes("no data"));
		const open = series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 45 });
		for (const style of ["trend", "area"] as const) {
			const t = topRight(scene({ style, series: [open] }).prims);
			assert.ok(!t.includes("45.0"), `${style}: ${t.join("|")}`);
			assert.ok(topRight(scene({ style, series: [{ ...open, current: 45 }] }).prims).includes("45.0"), style);
		}
		const steady = series("gpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 60 }, { current: 60 });
		for (const style of ["lanes", "compare"] as const) {
			const t = textsOf(scene({ style, series: [open, steady] }).prims);
			assert.ok(!t.some((x) => /45.0/.test(x)) && t.some((x) => /60.0/.test(x)), `${style}: ${t.join("|")}`);
		}
		const paused = topRight(scene({ style: "trend", series: [open], cursor: 0 }).prims);
		assert.ok(paused.includes("45.0"), `inspecting the history still reads it: ${paused.join("|")}`);
	});

	it("between sparse samples of one segment the last sample holds; an open segment runs to the newest bucket", () => {
		const open = sparseView(true);
		const bins = binView(open, 400);
		const spans = observedSpans(open, bins, 400);
		assert.deepEqual(spans, [{ seg: 0, j0: 0, j1: 399 }]);
		assert.equal(valueAt(bins, spans, 15), 51, "an empty bucket inside the segment holds the sample before it");
		assert.equal(valueAt(bins, spans, 399), 89, "the newest bucket of an open segment holds its last sample");
		const closed = sparseView(false);
		const closedBins = binView(closed, 400);
		const closedSpans = observedSpans(closed, closedBins, 400);
		assert.equal(valueAt(closedBins, closedSpans, 391), 89);
		assert.equal(valueAt(closedBins, closedSpans, 399), undefined, "after a closed segment's last sample there is no reading");
	});
});

// ---- units -----------------------------------------------------------------

describe("Compare units", () => {
	const rate = (key: string, value: number): StripSeriesInput => series(key, "KB/s", { windowMs: 300_000, widthPx: WIDTH, unit: "KB/s", value: () => value }, { current: value });

	it("data readings carry their own size step beside each value, never one shared unit word", () => {
		const s = [rate("up", 80), rate("down", 250_000)];
		const t = textsOf(scene({ style: "compare", series: s }).prims);
		assert.ok(t.includes("UP 640 kbps") && t.includes("DOWN 2.00 Gbps"), t.join("|"));
		assert.ok(!t.includes("kbps") && !t.includes("Gbps"), "no shared unit word");
		const binary = textsOf(scene({ style: "compare", series: s, dataUnits: "binary" }).prims);
		assert.ok(binary.includes("UP 78.1 KiB/s") && binary.some((x) => /^DOWN 23\d MiB\/s$/.test(x)), binary.join("|"));
	});

	it("a series without a value never picks the unit word by formatting zero", () => {
		const s = [series("up", "KB/s", undefined), rate("down", 250_000)];
		const t = textsOf(scene({ style: "compare", series: s }).prims);
		assert.ok(t.includes("UP no data") && t.includes("DOWN 2.00 Gbps"), t.join("|"));
		assert.ok(!t.includes("bps"));
	});

	it("plain units say their unit once, on the shared scale's end", () => {
		const v = (u: string, base: number) => ({ windowMs: 300_000, widthPx: WIDTH, unit: u, value: () => base });
		const t = textsOf(scene({ style: "compare", series: [series("cpu", "°C", v("°C", 50), { current: 50 }), series("gpu", "°C", v("°C", 60), { current: 60 })] }).prims);
		assert.equal(t.filter((x) => /°C/.test(x)).length, 1, t.join("|"));
		assert.ok(t.includes("CPU 50.0") && t.includes("GPU 60.0"), t.join("|"));
	});

	it("°C and °F readings never share a scale, even when °F displays both", () => {
		const cpu = series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 50 }, { current: 50 });
		const probe = series("probe", "°F", { windowMs: 300_000, widthPx: WIDTH, unit: "°F", value: () => 122 }, { current: 122 });
		const gpu = series("gpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 60 });
		for (const fahrenheit of [true, false]) {
			const { prims } = scene({ style: "compare", series: [cpu, probe, gpu], fahrenheit });
			const drawn = lines(prims);
			assert.equal(drawn.length, 3, `fahrenheit ${fahrenheit}: every reading draws`);
			// The probe's own band, below the two °C readings' (native units).
			const [, bottom] = unitBands(2) as [{ top: number; bottom: number }, { top: number; bottom: number }];
			const probeLine = drawn.find((l) => l.pts.every((v, i) => i % 2 === 0 || v >= bottom.top - 1));
			assert.ok(probeLine !== undefined, `fahrenheit ${fahrenheit}: the °F reading has a band of its own`);
			assert.ok(!textsOf(prims).some((x) => x.includes("other unit")), `fahrenheit ${fahrenheit}`);
		}
	});
});

// ---- paints and labels -------------------------------------------------------

describe("paints and band labels", () => {
	it("two Area panes each fill with their own color", () => {
		const base = fixtureCase({ styles: ["area", "area"], layout: "split", encoders: 4, background: "outline", accent: false });
		const pane1 = { ...base.input.config.panes[1], series: [{ key: base.input.config.panes[1].series[0]?.key as string, color: "#00FF00" }] };
		const input: StripSceneInput = { ...base.input, config: { ...base.input.config, panes: [base.input.config.panes[0], pane1] } };
		const s = buildStripScene(input);
		const fills = s.prims.filter((p) => p.k === "area").map((p) => (p as { paint: string }).paint);
		const ids = [...new Set(fills)];
		assert.equal(ids.length, 2, fills.join(","));
		const gradientColor = (fill: string): string | undefined => {
			const id = /url\(#(\w+)\)/.exec(fill)?.[1] ?? "";
			return new RegExp(`<linearGradient id="${id}"[^>]*><stop offset="0" stop-color="(#[0-9A-Fa-f]{6})"`).exec(s.paints)?.[1];
		};
		assert.equal(gradientColor(ids[1] as string), "#00FF00");
		assert.notEqual(gradientColor(ids[0] as string), "#00FF00");
	});

	it("two readings with the same limit get two readable labels that never share a box", () => {
		const two = [series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: (f) => 50 + f * 45 }), series("gpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: (f) => 55 + f * 40 })];
		for (const style of ["compare", "trend"] as const) {
			const { prims } = scene({ style, series: two, bands: [{ key: "cpu", warn: 80, crit: 90 }, { key: "gpu", warn: 80, crit: 90 }] });
			const labels = prims.filter((p): p is TextPrim => p.k === "text" && /(warn|crit) /.test(p.text));
			assert.deepEqual(labels.map((l) => l.text).sort(), ["CPU crit 90.0 °C", "CPU warn 80.0 °C", "GPU crit 90.0 °C", "GPU warn 80.0 °C"], style);
			for (const a of labels) {
				for (const b of labels) {
					if (a === b || Math.abs(a.y - b.y) >= 13) continue;
					assert.ok(a.bx1 <= b.bx0 || b.bx1 <= a.bx0, `${style}: "${a.text}" and "${b.text}" overlap`);
				}
			}
		}
	});

	it("a band label too long for its room shortens the reading's name and keeps the limit; one the rows' words leave no room keeps its edge", () => {
		const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: "theme", accent: false, present: [true, false, true, true] });
		const s = buildStripScene(c.input);
		const labels = textsOf(s.prims).filter((t) => /(warn|crit) \d/.test(t));
		assert.ok(labels.some((t) => t.startsWith("CPU Package") && t.includes("…") && t.endsWith(" warn 70.0 °C")), labels.join("|"));
		assert.ok(labels.every((t) => / (warn 70|crit 85)\.0 °C$/.test(t)), labels.join("|"));
		// The critical edge sits under the names and the value on the top
		// row: its label has no room there and gives way; the edge stays.
		assert.ok(s.prims.some((p) => p.k === "rect" && p.h === 1 && p.paint === `fill="${c.input.alertColors.crit}"`));
	});

	it("the gap note says a dial on screen left the strip, and only an absent one is missing", () => {
		const note = (present: boolean[], left?: boolean[]): string[] => {
			const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "theme", accent: false, present });
			return textsOf(buildStripScene({ ...c.input, ...(left === undefined ? {} : { left }) }).prims).filter((t) => /missing|left|strip|out$/.test(t));
		};
		assert.deepEqual(note([true, true, false, true, true, true]), ["Dial 3 missing"]);
		assert.deepEqual(note([true, true, false, true, true, true], [false, false, true, false, false, false]), ["Dial 3 left the strip"]);
		// Mixed: whatever fits, never calling a dial on screen missing.
		const mixed = note([true, false, false, true, true, true], [false, true, false, false, false, false]);
		assert.equal(mixed.length, 1, mixed.join("|"));
		assert.ok(["Dial 2 left the strip, 3 missing", "2 dials not in the strip", "2 dials out"].includes(mixed[0] as string), mixed[0]);
		// A left flag on a present slot means nothing.
		assert.deepEqual(note([true, true, true, true, true, true], [true, false, false, false, false, false]), []);
	});

	it("lanes are drawn where input routing finds them", () => {
		const s = [series("tmp", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 50 }), series("rpm", "RPM", { windowMs: 300_000, widthPx: WIDTH, unit: "RPM", value: () => 900 })];
		const { prims } = scene({ style: "lanes", series: s });
		const separators = prims.filter((p) => p.k === "rect" && p.h === 1 && p.w > 300 && p.y < 80).map((p) => (p as { y: number }).y);
		assert.deepEqual(separators, [LANES_TOP + laneHeight(2)]);
	});
});

// ---- the heat strip ------------------------------------------------------------

describe("the heat strip keeps its scale and its missing marks", () => {
	const { bottomBaseline, topBaseline, swatch } = STRIP_ROWS;
	const swatches = (prims: readonly Prim[], x0: number, x1: number, w = 6): number => prims.filter((p) => p.k === "rect" && p.w === w && p.h === swatch && p.y === bottomBaseline - swatch && p.x >= x0 && p.x < x1).length;

	it("a heat pane on one present slot keeps a narrowed scale, live and paused", () => {
		for (const encoders of [4, 6] as const) {
			const present = encoders === 4 ? [true, false, true, true] : [true, false, false, true, true, true];
			for (const paused of [false, true]) {
				const prims = buildStripScene(fixtureCase({ styles: ["heat", "heat"], layout: "split", encoders, background: "theme", accent: false, paused, present }).input).prims;
				const tag = `${encoders} ${paused ? "paused" : "live"}`;
				assert.equal(swatches(prims, 0, 200, 3), 8, `${tag}: the narrowed scale`);
				const bottom = prims.filter((p): p is TextPrim => p.k === "text" && p.y === bottomBaseline && p.x < 200).map((p) => p.text);
				if (!paused) assert.ok(bottom.includes("5 min"), `${tag}: the window label stays (${bottom.join("|")})`);
				const top = prims.filter((p): p is TextPrim => p.k === "text" && p.y === topBaseline && p.x < 200).map((p) => p.text);
				assert.ok(top.some((x) => x.includes("warn 80.0") && x.includes("crit 90.0")), `${tag}: the limits behind the caps stay named (${top.join("|")})`);
				// The other half keeps its scale too: full live, and paused full
				// or narrowed beside PAUSED and the window's words.
				assert.equal(swatches(prims, encoders * 100, encoders * 200) + (paused ? swatches(prims, encoders * 100, encoders * 200, 3) : 0), 8, `${tag}: the scale on the other half`);
			}
		}
	});

	it("a split heat keeps the numeric color scale in both halves, live and paused, on both decks", () => {
		for (const encoders of [4, 6] as const) {
			for (const paused of [false, true]) {
				const c = fixtureCase({ styles: ["heat", "heat"], layout: "split", encoders, background: "theme", accent: false, paused });
				const prims = buildStripScene(c.input).prims;
				const mid = encoders * 100;
				// Full (6 px steps) or narrowed (3 px) where PAUSED and the
				// window's words crowd the row: never left out.
				const scaleIn = (x0: number, x1: number): number => swatches(prims, x0, x1) + swatches(prims, x0, x1, 3);
				assert.equal(scaleIn(0, mid), 8, `${encoders} ${paused ? "paused" : "live"} left`);
				assert.equal(scaleIn(mid, mid * 2), 8, `${encoders} ${paused ? "paused" : "live"} right`);
				if (paused) assert.equal(textsOf(prims).filter((t) => t.startsWith("PAUSED")).length, 2);
			}
		}
	});

	it("the time line gives way to the scale and never runs into it", () => {
		const c = fixtureCase({ styles: ["heat", "heat"], layout: "split", encoders: 4, background: "theme", accent: false, paused: true });
		const prims = buildStripScene(c.input).prims;
		const bottom = prims.filter((p): p is TextPrim => p.k === "text" && p.y === bottomBaseline);
		const left = bottom.find((p) => p.anchor === "start" && p.x < 200) as TextPrim;
		assert.ok(left.text.includes("at -"), left.text);
		const firstSwatch = Math.min(...prims.filter((p) => p.k === "rect" && p.w === 6 && p.h === swatch && p.y === bottomBaseline - swatch && p.x < 400).map((p) => (p as { x: number }).x));
		const lo = bottom.filter((p) => p.anchor === "end" && p.x <= firstSwatch).sort((a, b) => b.x - a.x)[0] as TextPrim;
		assert.ok(left.x + estimateKeyTextWidth(left.text, left.size) < lo.x - estimateKeyTextWidth(lo.text, lo.size), `${left.text} runs into ${lo.text}`);
	});

	it("before any history every cell carries the missing mark", () => {
		const { prims } = scene({ style: "heat", series: [series("hot", "°C", undefined, { current: 70 })] });
		const marks = prims.filter((p) => p.k === "marks");
		assert.equal(marks.length, 1);
		assert.equal((marks[0] as { xs: readonly number[] }).xs.length, plotFor("heat", paneExtents("whole", 4)[0] as { x0: number; x1: number }, 2).buckets);
	});

	it("with the legend off the alert caps still name their limits", () => {
		const s = [series("hot", "°C", { windowMs: 300_000, widthPx: 100, unit: "°C", value: (f) => 60 + f * 40 })];
		for (const overlays of [{ legend: false }, { legend: false, current: false }] as Record<string, boolean>[]) {
			const { prims } = scene({ style: "heat", series: s, bands: [{ key: "hot", warn: 80, crit: 90 }], overlays });
			const t = textsOf(prims);
			assert.ok(t.some((x) => x.includes("warn 80.0 °C") && x.includes("crit 90.0 °C")), t.join("|"));
			// The cells take the strip's height; the limits draw over them on
			// the top row, in the rows' edge.
			const cells = prims.filter((p) => p.k === "rect" && p.layer === "base" && p.h > 10 && p.w === 8);
			assert.ok(cells.length > 0 && cells.every((p) => (p as { y: number }).y === STRIP_ROWS.plotTop));
			const limits = prims.find((p): p is TextPrim => p.k === "text" && /warn 80\.0/.test(p.text)) as TextPrim;
			assert.equal(limits.layer, "rows");
		}
		const bare = scene({ style: "heat", series: s, overlays: { legend: false, current: false, time: false } });
		assert.deepEqual(textsOf(bare.prims).filter((x) => /warn|crit/.test(x)), [], "no bands, no limits line");
	});
});

// ---- partial groups ------------------------------------------------------------

describe("partial groups", () => {
	/** Estimated ink extent of a text prim. */
	const ink = (p: TextPrim): [number, number] => {
		const w = estimateKeyTextWidth(p.text, p.size, p.weight === 700 ? { fontWeight: 700 } : undefined);
		return p.anchor === "start" ? [p.x, p.x + w] : p.anchor === "end" ? [p.x - w, p.x] : [p.x - w / 2, p.x + w / 2];
	};
	const patterns = (n: number): boolean[][] => Array.from({ length: 2 ** n - 1 }, (_, m) => Array.from({ length: n }, (_, c) => ((m >> c) & 1) === 0)).filter((p) => p.some((x) => x));

	it("no text of a present slot runs into a missing column", () => {
		let checked = 0;
		for (const encoders of [4, 6] as const) {
			for (const layout of ["whole", "split"] as const) {
				for (const style of STRIP_STYLES_ALL) {
					for (const present of patterns(encoders)) {
						for (const paused of [false, true]) {
							const c = fixtureCase({ styles: [style, style], layout, encoders, background: "theme", accent: false, present, paused });
							for (const p of buildStripScene(c.input).prims) {
								if (p.k !== "text") continue;
								const [a, b] = ink(p);
								present.forEach((here, col) => {
									if (here) return;
									assert.ok(b <= col * 200 + 0.5 || a >= col * 200 + 200 - 0.5, `${c.id} ${present.map(Number).join("")}: "${p.text}" ${a.toFixed(0)}-${b.toFixed(0)} crosses missing column ${col}`);
								});
								checked++;
							}
						}
					}
				}
			}
		}
		assert.ok(checked > 1000);
	});

	it("the overlays sit in the longest run of present slots, the rightmost of equal runs", () => {
		const badgeX = (present: boolean[]): number => {
			const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: "theme", accent: false, present });
			return (buildStripScene(c.input).prims.find((p): p is TextPrim => p.k === "text" && p.text === "LIVE") as TextPrim).x;
		};
		assert.equal(badgeX([true, false, true, true]), 794);
		assert.equal(badgeX([true, true, false, true]), 394);
		assert.equal(badgeX([true, false, true, false]), 594);
		assert.equal(badgeX([true, true, true, false]), 594);
	});

	it("a split half marks only its own missing dials, named once, and a healthy half draws as if whole", () => {
		const full = fixtureCase({ styles: ["trend", "area"], layout: "split", encoders: 4, background: "theme", accent: false });
		const halfGone = fixtureCase({ styles: ["trend", "area"], layout: "split", encoders: 4, background: "theme", accent: false, present: [true, true, false, false] });
		const inLeft = (prims: readonly Prim[]): string[] => prims.filter((p) => (p.k === "text" || p.k === "rect" ? p.x < 400 : p.k === "line" || p.k === "area" ? (p.pts[0] as number) < 400 : false)).map((p) => JSON.stringify(p));
		assert.deepEqual(inLeft(buildStripScene(halfGone.input).prims), inLeft(buildStripScene(full.input).prims), "the left half is untouched by the right half's absence");
		const oneEach = fixtureCase({ styles: ["trend", "area"], layout: "split", encoders: 6, background: "theme", accent: false, present: [true, false, false, true, true, false] });
		const prims = buildStripScene(oneEach.input).prims;
		const notes = prims.filter((p): p is TextPrim => p.k === "text" && p.text.includes("missing"));
		assert.deepEqual(notes.map((p) => p.text).sort(), ["Dial 6 missing", "Dials 2 and 3 missing"]);
		const six = notes.find((p) => p.text === "Dial 6 missing") as TextPrim;
		assert.ok(six.x > 800 && six.anchor === "end", "the right half names its own gap beside it, not the left half's");
		assert.ok((notes.find((p) => p.text === "Dials 2 and 3 missing") as TextPrim).x < 600);
		// Edge bars face missing slots of the same half only: none at the gutter.
		const bars = prims.filter((p) => p.k === "rect" && p.w === 2 && p.h === 100).map((p) => (p as { x: number }).x);
		assert.deepEqual(bars, [198, 998]);
	});

	it("a missing-dial note never covers another text, and is always there", () => {
		for (const style of STRIP_STYLES_ALL) {
			for (const present of [[true, false, true, true], [false, true, true, true], [true, true, true, false], [true, false, true, false]]) {
				const prims = buildStripScene(fixtureCase({ styles: [style], layout: "whole", encoders: 4, background: "theme", accent: false, present }).input).prims;
				const texts = prims.filter((p): p is TextPrim => p.k === "text");
				const notes = texts.filter((p) => p.text.includes("missing"));
				assert.equal(notes.length, 1, `${style} ${present.map(Number).join("")}: the missing dials are named once`);
				for (const note of notes) {
					const [a, b] = ink(note);
					for (const other of texts) {
						if (other === note || !(other.y - other.size < note.y + 2 && note.y - note.size < other.y + 2)) continue;
						const [c, d] = ink(other);
						assert.ok(b <= c || d <= a, `${style} ${present.map(Number).join("")}: "${note.text}" covers "${other.text}"`);
					}
				}
			}
		}
	});
});

describe("a reading the history budget refused says so", () => {
	const room = (key: string, unit: string, current: number): StripSeriesInput => ({ key, name: key.toUpperCase(), unit, state: "ok", current, noRoom: true });

	it("Compare names it in the legend, beside the others' values", () => {
		const { prims } = scene({ style: "compare", series: [series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 50 }), room("gpu", "°C", 61)] });
		assert.ok(textsOf(prims).includes("GPU no history room"), JSON.stringify(textsOf(prims)));
		assert.equal(lines(prims).length, 1, "only the reading with history draws a line");
	});

	it("a lone Trend reading says it where the graph would be and in its name", () => {
		const { prims } = scene({ style: "trend", series: [room("cpu", "°C", 50)] });
		const texts = textsOf(prims);
		assert.ok(texts.includes("no history room"), JSON.stringify(texts));
		assert.ok(texts.includes("CPU no history room"), JSON.stringify(texts));
	});

	it("a lane names it in its header", () => {
		const { prims } = scene({ style: "lanes", series: [series("cpu", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 50 }), room("fan", "RPM", 1200)] });
		assert.ok(textsOf(prims).some((t) => t.startsWith("FAN") && t.endsWith("no history room")), JSON.stringify(textsOf(prims)));
	});

	it("the frame marks a series whose window the store refused, and only that one", async () => {
		const { paneSeriesInputs } = await import("../src/strip/frame");
		const config = stripConfigOf({ encoders: 4, panes: [{ style: "compare", series: [{ key: "a" }, { key: "b" }] }] });
		const status = { state: "unavailable" } as unknown as Parameters<typeof paneSeriesInputs>[3]["status"];
		const inputs = paneSeriesInputs(config, 4, 0, { status, now: 1_000_000, history: { view: () => undefined, refused: (key) => key === "b" } });
		assert.deepEqual(inputs.map((s) => s.noRoom === true), [false, true]);
		const without = paneSeriesInputs(config, 4, 0, { status, now: 1_000_000, history: { view: () => undefined } });
		assert.ok(without.every((s) => s.noRoom === undefined), "a reader without refused() marks nothing");
	});
});

describe("the legend shows every drawn series", () => {
	const long = ["CPU Core Temperature Package", "GPU Hot Spot Temperature", "Motherboard Chipset Temperature", "Drive Temperature 2"];
	const view = (k: number) => ({ windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 40 + k });

	for (const layout of ["whole", "split"] as const) {
		it(`four Compare readings with long names on a ${layout} Stream Deck +: a chip and a value each, names cut only at whole words`, () => {
			const input = long.map((name, k) => ({ ...series(`k${k}`, "°C", view(k)), name, current: 40.5 + k }));
			const pane = stripPaneOf({ style: "compare", series: input.map((s) => ({ key: s.key })) });
			const base = scene({ style: "compare", series: input }).input;
			const config = { ...stripConfigOf({ encoders: 4, layout }), panes: [pane, pane] as const };
			const paneInput = base.panes[0] as StripSceneInput["panes"][number];
			const prims = buildStripScene({ ...base, config, panes: layout === "split" ? [paneInput, paneInput] : [paneInput] }).prims;
			const chips = prims.filter((p) => p.k === "rect" && p.y === CHIP_Y && p.w === STRIP_ROWS.chip && p.h === STRIP_ROWS.chip);
			assert.equal(chips.length, layout === "split" ? 8 : 4, "one chip per drawn series in every pane");
			const legendTexts = prims.filter((p): p is TextPrim => p.k === "text" && p.y === STRIP_ROWS.topBaseline && p.size === STRIP_ROWS.label && p.anchor === "start").map((p) => p.text);
			assert.equal(legendTexts.length, chips.length, JSON.stringify(legendTexts));
			for (const text of legendTexts) {
				assert.ok(!text.includes("…") && !text.includes("..."), `never cut mid-name: ${text}`);
				assert.match(text, /\d/, `each item keeps its value: ${text}`);
				const name = text.replace(/\s*[\d.]+$/, "");
				assert.ok(name === "" || long.some((full) => full.split(" ").some((w) => name.split(" ").includes(w))), `a whole-word rung: ${text}`);
			}
		});
	}
});

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear
// sRGB: how a color reads to a dichromat.
const CVD: Record<string, readonly (readonly [number, number, number])[]> = {
	deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
	protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
	tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]]
};
const simulate = (hex: string, kind: string): string => {
	const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	const enc = (c: number): number => {
		const v = Math.min(1, Math.max(0, c));
		return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
	};
	const rgb = [1, 3, 5].map((o) => lin(parseInt(hex.slice(o, o + 2), 16) / 255)) as [number, number, number];
	return `#${(CVD[kind] as readonly (readonly [number, number, number])[]).map((row) => Math.round(enc(row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};
/** The floors the default series colors hold pairwise (below): 20 dE00 for
 * normal vision, 4.5 under deuteranopia and protanopia, 3.5 under
 * tritanopia. */
const SERIES_FLOORS = { normal: 20, deuteranopia: 4.5, protanopia: 4.5, tritanopia: 3.5 } as const;

describe("the default series colors stay apart for colorblind eyes on every look", () => {
	const LOOKS = ["theme", "glass", "tint", "outline", "clear"] as const;
	/** The four chip colors a Compare pane draws, as drawn. */
	const chipsOf = (theme: string, background: (typeof LOOKS)[number]): string[] => {
		const keys = ["a", "b", "c", "d"];
		const pane = stripPaneOf({ style: "compare", series: keys.map((key) => ({ key })) });
		const config = { ...stripConfigOf({ encoders: 4, background, theme }), panes: [pane, pane] as const };
		const input: StripSceneInput = {
			config,
			encoders: 4,
			palette: resolvePalette(themes, theme, null, "normal"),
			text: THEME_TEXT,
			alertColors: { warn: "#FFB000", crit: "#FF3B30" },
			dataUnits: "decimal",
			panes: [{ series: keys.map((key, k) => series(key, "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 40 + k }, { current: 40 + k })), bands: [], view: { mode: "live" }, highlight: 0 }]
		};
		return buildStripScene(input).prims.filter((p) => p.k === "rect" && p.y === CHIP_Y && p.w === STRIP_ROWS.chip && p.h === STRIP_ROWS.chip).map((p) => /fill="(#[0-9A-Fa-f]{6})"/.exec((p as { paint: string }).paint)?.[1] ?? "");
	};

	it("the palette is the documented one", () => {
		assert.deepEqual([...STRIP_SERIES_COLORS], ["#56B4E9", "#F0E442", "#CC79A7", "#009E73"]);
	});

	for (const theme of Object.keys(themes.themes)) {
		it(`${theme}: on Theme, Glass, Tint, Outline and Clear each chip meets the 4.5:1 floor and every pair stays apart`, () => {
			for (const background of LOOKS) {
				const surface = dialTextPalette(background, resolvePalette(themes, theme, null, "normal")).bg;
				const chips = chipsOf(theme, background);
				assert.equal(chips.length, 4, `${background}: four chips`);
				assert.deepEqual(chips, STRIP_SERIES_COLORS.map((c) => readableValueColor(c, surface)), `${background}: the palette lifted on the look's surface`);
				for (const c of chips) assert.ok(contrastRatio(c, surface) >= 4.5, `${background}: ${c} on ${surface}`);
				for (let i = 0; i < 4; i++) {
					for (let j = i + 1; j < 4; j++) {
						const a = chips[i] as string;
						const b = chips[j] as string;
						assert.ok(ciede2000(a, b) >= 20, `${background}: ${a} and ${b} for normal vision`);
						for (const kind of ["deuteranopia", "protanopia"]) assert.ok(ciede2000(simulate(a, kind), simulate(b, kind)) >= 4.5, `${background} ${kind}: ${a} and ${b}`);
						assert.ok(ciede2000(simulate(a, "tritanopia"), simulate(b, "tritanopia")) >= 3.5, `${background} tritanopia: ${a} and ${b}`);
					}
				}
			}
		});
	}

	it("the key quad colors this replaces on strips fall together under deuteranopia (why it changed)", () => {
		const quad = ["#4CC2FF", "#FF7E8E", "#38CD89", "#D4AB33"];
		let worst = Number.POSITIVE_INFINITY;
		for (const theme of Object.keys(themes.themes)) {
			for (const background of LOOKS) {
				const surface = dialTextPalette(background, resolvePalette(themes, theme, null, "normal")).bg;
				const drawn = quad.map((c) => readableValueColor(c, surface));
				for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) worst = Math.min(worst, ciede2000(simulate(drawn[i] as string, "deuteranopia"), simulate(drawn[j] as string, "deuteranopia")));
			}
		}
		assert.ok(worst < 1, `rose and green under deuteranopia: ${worst.toFixed(2)}`);
	});

	it("a color the person chose for a reading is drawn exactly as chosen", () => {
		const pane = stripPaneOf({ style: "compare", series: [{ key: "a", color: "#FF7E8E" }, { key: "b" }] });
		const config = { ...stripConfigOf({ encoders: 4 }), panes: [pane, pane] as const };
		const input: StripSceneInput = { ...scene({ style: "compare", series: [series("a", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 40 }), series("b", "°C", { windowMs: 300_000, widthPx: WIDTH, unit: "°C", value: () => 41 })] }).input, config };
		const chips = buildStripScene(input).prims.filter((p) => p.k === "rect" && p.y === CHIP_Y && p.w === STRIP_ROWS.chip && p.h === STRIP_ROWS.chip).map((p) => (p as { paint: string }).paint);
		assert.deepEqual(chips, ['fill="#FF7E8E"', `fill="${readableValueColor("#F0E442", palette.bg)}"`]);
	});
});

// The alert-color blocks below draw every look on every theme.
const ALERT_THEMES = Object.keys(themes.themes);
const ALERT_LOOKS: readonly DialBackground[] = DIAL_BACKGROUNDS;
const ALERT_STYLES: readonly StripStyle[] = ["trend", "area", "compare", "lanes", "heat", "meters", "events"];
/** Alert colors no look draws: a frame drawn again with these shows which
 * paints are the alert colors. */
const OTHER_ALERTS = { warn: "#2060A0", crit: "#20A060" };
/** The case with each reading's limits just under its value, both on the
 * plot: past warn and under crit, or past both. Yes/No readings keep none
 * (Events draws their Yes in the warn color). */
function pastLimits(c: FixtureCase, level: "warn" | "crit"): FixtureCase {
	const { config } = c.input;
	const panes = config.panes.map((pane, i) => {
		const bands = (c.input.panes[i]?.series ?? [])
			.filter((s) => s.unit !== "Yes/No" && Number.isFinite(s.current))
			.map((s) => {
				const v = s.current as number;
				const d = Math.max(1, Math.abs(v) * 0.02);
				return level === "crit" ? { key: s.key, warn: v - 2 * d, crit: v - d, below: false } : { key: s.key, warn: v - d, crit: v + 2 * d, below: false };
			});
		return { ...pane, bands };
	}) as unknown as StripConfigV1["panes"];
	const next: StripConfigV1 = { ...config, panes };
	return { id: `${c.id}-${level}`, input: { ...c.input, config: next, panes: c.input.panes.map((p, i) => ({ ...p, bands: stripBandsFor(next.panes[i as 0 | 1], p.series, { fahrenheit: next.fahrenheit, decimals: next.decimals }) })) } };
}
/** The surfaces a look's words sit on: the look's (Glass's hardest panel,
 * the art's ceiling, else the theme background) and the one the words on
 * the rows over a graph are lifted on (RowText.surface). */
function surfacesOf(theme: string, background: DialBackground): { look: string; rows: string } {
	const palette = resolvePalette(themes, theme, null, "normal");
	const light = luminance(palette.value) > luminance(palette.bg);
	return { look: dialTextPalette(lookOn(background, palette), palette).bg, rows: blendOver(palette.bg, ROW_SURFACE_OPACITY, light ? "#FFFFFF" : "#000000") };
}

describe("alert colors read on the surface they sit on", () => {
	// Every word or value a strip draws in a warn or crit color: the words
	// beside the limit bands, the large values, and the values and limits of
	// Meters and Events. Each frame is drawn twice, the second
	// time with other alert colors, and the words whose fill moved are the
	// alert-colored ones. A word on the rows over the graph is held to the
	// surface the rows lift on; every other word sits on the look's surface
	// (Glass's hardest panel, the art's ceiling, else the theme background).
	const ALL = ALERT_THEMES;
	const LOOKS = ALERT_LOOKS;
	const STYLES = ALERT_STYLES;
	const OTHER = OTHER_ALERTS;
	const casesOf = (theme: string, background: DialBackground): { site: string; c: FixtureCase }[] => [
		...STYLES.flatMap((style) =>
			[{}, { readout: "left" as const, axes: true }, { readout: "only" as const }].flatMap((extras) => {
				const c = fixtureCase({ styles: [style], layout: "whole", encoders: 6, background, accent: false, theme, extras: [extras] });
				return [pastLimits(c, "warn"), pastLimits(c, "crit")].map((x) => ({ site: style, c: x }));
			})
		),
		...(["auto", "rows", "now", "spread"] as const).map((view) => ({ site: "group", c: groupFixture({ n: 16, view, background, theme, limits: { warn: 60, crit: 75 } }) }))
	];
	/** A frame's alert-colored words, each with the surface it sits on. */
	const alertWords = (input: StripSceneInput, surfaces: { look: string; rows: string }): { p: TextPrim; surface: string }[] => {
		const drawn = buildStripScene(input).prims;
		const other = buildStripScene({ ...input, alertColors: OTHER }).prims;
		assert.equal(other.length, drawn.length, "the alert colors move no primitive");
		return drawn.flatMap((p, i) => {
			const q = other[i];
			return p.k === "text" && q?.k === "text" && p.fill !== q.fill ? [{ p, surface: p.layer === "rows" ? surfaces.rows : surfaces.look }] : [];
		});
	};

	it("every alert-colored word and value holds 4.5:1 on its surface, on every look and theme (Glass and the art looks included)", () => {
		const misses = new Map<string, number>();
		const found = new Map<string, number>();
		for (const theme of ALL) {
			for (const background of LOOKS) {
				const surfaces = surfacesOf(theme, background);
				for (const { site, c } of casesOf(theme, background)) {
					for (const { p, surface } of alertWords(c.input, surfaces)) {
						if (p.layer === "rows") found.set(`${background} rows`, (found.get(`${background} rows`) ?? 0) + 1);
						const where = `${site} ${p.layer === "rows" ? "row" : "face"} ${p.size}px ${/(?:^|\s)(warn|crit) \d/.test(p.text) ? "limit" : "value"}`;
						found.set(`${background} ${site}`, (found.get(`${background} ${site}`) ?? 0) + 1);
						const ratio = contrastRatio(p.fill, surface);
						const key = `${background} ${theme} ${where} ${p.fill} on ${surface}`;
						if (ratio < 4.5) misses.set(key, Math.min(misses.get(key) ?? Number.POSITIVE_INFINITY, ratio));
					}
				}
			}
		}
		for (const background of LOOKS) for (const site of [...STYLES, "group"]) assert.ok((found.get(`${background} ${site}`) ?? 0) > 0, `${background} ${site}: alert-colored words drawn`);
		assert.deepEqual([...misses].map(([key, ratio]) => `${key}: ${ratio.toFixed(2)}`).sort(), []);
	});

	it("on Theme, Tint, Outline and Clear the strip's alert colors are the theme's as every key and dial draws them; on Glass and the art looks they hold a CIELab hue (warn 73, crit 40) and take more chroma than a mix toward white", () => {
		const misses: string[] = [];
		const hueOf = (c: string): number => {
			const [, a, b] = hexToLab(c);
			const h = (Math.atan2(b, a) * 180) / Math.PI;
			return h < 0 ? h + 360 : h;
		};
		const chromaOf = (c: string): number => Math.hypot(hexToLab(c)[1], hexToLab(c)[2]);
		for (const theme of ALL) {
			const palette = resolvePalette(themes, theme, null, "normal");
			for (const background of LOOKS) {
				const { look: surface } = surfacesOf(theme, background);
				const drawn = stripLookOf(stripConfigOf({ theme, background })).alertColors;
				for (const level of ["warn", "crit"] as const) {
					const own = themes.alertValues[level];
					const where = `${background} ${theme} ${level} ${drawn[level]} on ${surface}`;
					if (surface === palette.bg) {
						assert.equal(drawn[level], alertValueColor(themes, level, palette.bg), `${where}: as before`);
						continue;
					}
					if (contrastRatio(drawn[level], surface) < 4.5) misses.push(`${where}: ${contrastRatio(drawn[level], surface).toFixed(2)}:1`);
					if (contrastRatio(own, surface) >= 4.5 && level === "crit") {
						if (drawn.crit !== own) misses.push(`${where}: reads unlifted, so it is ${own}`);
						continue;
					}
					if (drawn[level] === own) continue;
					// The CIELab hue a lift holds (8-bit rounding moves it a little).
					const hue = level === "crit" ? 40 : 73;
					if (Math.abs(hueOf(drawn[level]) - hue) > 1.5) misses.push(`${where}: hue ${hueOf(drawn[level]).toFixed(1)}, held ${hue.toFixed(1)}`);
					// More chroma than a mix toward white or black to the same contrast.
					const mixed = readableColor(own, surface, contrastRatio(drawn[level], surface));
					if (chromaOf(drawn[level]) < chromaOf(mixed)) misses.push(`${where}: chroma ${chromaOf(drawn[level]).toFixed(1)} under the mix's ${chromaOf(mixed).toFixed(1)} (${mixed})`);
				}
			}
		}
		assert.deepEqual(misses, []);
	});
});

describe("an alert color never reads as another color the strip draws", () => {
	// Every paint a frame draws, split into alert and other paints by drawing
	// it again with other alert colors (the paints that move are the alert
	// colors), each resolved to the color it shows over the look's surface
	// (the rows' lift surface, for the words over a graph). The corpus: every style past
	// warn and past crit in three layouts, the same with every reading stale,
	// every Group view with 4, 8 and 16 readings, some
	// stale. Every alert color must stay 20 dE00
	// (the series colors' own rule) from every other color the look draws:
	// the series colors as lifted, their dimmed (45 %), stale (50 %) and
	// translucent (Group's columns) versions, the accent and its heat steps,
	// the ice ramp, Group's muted lines, the theme's words. A
	// color a person typed for a reading by hand (the strip's settings JSON;
	// the panel has no picker for it) is drawn exactly as typed and unlifted,
	// so it can match an alert color on any look: out of scope here.
	type Paint = { readonly color: string; readonly opacity: number };
	/** The flat paints a frame defines (glass.ts flatPaint), by id. */
	const flatPaints = (scene: { paints: string; localPaints?: readonly { def: string }[] }): Map<string, Paint> => {
		const out = new Map<string, Paint>();
		const all = `${scene.paints}${(scene.localPaints ?? []).map((x) => x.def).join("")}`;
		for (const g of all.matchAll(/<linearGradient id="([^"]+)"[^>]*>(.*?)<\/linearGradient>/g)) {
			const stops = [...(g[2] as string).matchAll(/stop-color="(#[0-9A-Fa-f]{6})" stop-opacity="([0-9.]+)"/g)];
			const [a, b] = stops;
			if (stops.length === 2 && a !== undefined && b !== undefined && a[1] === b[1] && a[2] === b[2]) out.set(g[1] as string, { color: (a[1] as string).toUpperCase(), opacity: Number(a[2]) });
		}
		return out;
	};
	const attrPaints = (attr: string, defs: Map<string, Paint>): Paint[] => {
		const out: Paint[] = [];
		const fill = /fill="([^"]+)"/.exec(attr)?.[1];
		const opacity = Number(/fill-opacity="([0-9.]+)"/.exec(attr)?.[1] ?? "1");
		if (fill?.startsWith("#") === true) out.push({ color: fill.toUpperCase(), opacity });
		else if (fill?.startsWith("url(#") === true) {
			const def = defs.get(fill.slice(5, -1));
			if (def !== undefined) out.push({ color: def.color, opacity: def.opacity * opacity });
		}
		const stroke = /stroke="(#[0-9A-Fa-f]{6})"/.exec(attr)?.[1];
		if (stroke !== undefined) out.push({ color: stroke.toUpperCase(), opacity: 1 });
		return out;
	};
	const primPaints = (p: Prim, defs: Map<string, Paint>): Paint[] => {
		switch (p.k) {
			case "line":
				return [{ color: p.stroke.toUpperCase(), opacity: 1 }, ...(p.backing === undefined ? [] : [{ color: p.backing.stroke.toUpperCase(), opacity: 1 }])];
			case "text":
				return [{ color: p.fill.toUpperCase(), opacity: 1 }];
			case "words":
				return p.words.map((w) => ({ color: w.fill.toUpperCase(), opacity: 1 }));
			case "skein":
				return attrPaints(p.attrs, defs).flatMap((x) => p.passes.map((q) => ({ color: x.color, opacity: x.opacity * q.opacity })));
			default:
				// The art backdrop's marker rect is replaced before sending.
				return p.paint.includes("data-art") ? [] : attrPaints(p.paint, defs);
		}
	};
	const over = (color: string, opacity: number, ground: string): string => (opacity >= 1 ? color : mixToward(ground, color, opacity));
	const stale = (c: FixtureCase, which: (k: number) => boolean = () => true): FixtureCase => ({ id: `${c.id}-stale`, input: { ...c.input, panes: c.input.panes.map((p) => ({ ...p, series: p.series.map((s, k) => (which(k) ? { ...s, state: "stale" as const } : s)) })) } });
	const corpusOf = (theme: string, background: DialBackground): { site: string; c: FixtureCase }[] => {
		const out: { site: string; c: FixtureCase }[] = [];
		for (const style of ALERT_STYLES) {
			for (const extras of [{}, { readout: "left" as const, axes: true }, { readout: "only" as const }]) {
				const c = fixtureCase({ styles: [style], layout: "whole", encoders: 6, background, accent: false, theme, extras: [extras] });
				for (const level of ["warn", "crit"] as const) out.push({ site: style, c: pastLimits(c, level) }, { site: `${style} stale`, c: stale(pastLimits(c, level)) });
			}
		}
		for (const view of ["auto", "rows", "now", "spread"] as const) {
			for (const n of [4, 16]) {
				const c = groupFixture({ n, view, background, theme, limits: { warn: 60, crit: 75 } });
				out.push({ site: `group ${view}`, c }, { site: `group ${view} stale`, c: stale(c, (k) => k % 3 === 0) });
			}
			out.push({ site: `group ${view}`, c: groupFixture({ n: 8, view, kind: "usage", background, theme, limits: { warn: 50, crit: 70 } }) });
		}
		// Tiles: a 16-core CPU's 32 threads at work, past both limits and under
		// them, some stale.
		const tiles: FixtureCase = { id: "tiles", input: tilesFixture({ labels: threadLabels(16), samples: tilesSamples(32, busyCpu), encoders: 6, background, theme, limits: { warn: 60, crit: 85 } }).input };
		out.push({ site: "group tiles", c: tiles }, { site: "group tiles stale", c: stale(tiles, (k) => k % 3 === 0) });
		return out;
	};
	/** Washes: a band's 18 % tint. Each
	 * draws only with a solid mark of its color beside it (the band's edge
	 * line and its word), and lies under it. */
	const WASH = 0.18;
	/** What a look draws: its alert colors (every form) and its other colors,
	 * each with where it was first drawn. */
	const drawnOf = (theme: string, background: DialBackground): { alert: Map<string, string>; other: Map<string, string>; washes: number } => {
		const surfaces = surfacesOf(theme, background);
		const alert = new Map<string, string>();
		const other = new Map<string, string>();
		let washes = 0;
		for (const { site, c } of corpusOf(theme, background)) {
			const a = buildStripScene(c.input);
			const b = buildStripScene({ ...c.input, alertColors: OTHER_ALERTS });
			assert.equal(b.prims.length, a.prims.length, `${site}: the alert colors move no primitive`);
			const da = flatPaints(a);
			const db = flatPaints(b);
			a.prims.forEach((p, i) => {
				const q = b.prims[i] as Prim;
				const mine = primPaints(p, da);
				const theirs = primPaints(q, db);
				const ground = p.layer === "rows" ? surfaces.rows : surfaces.look;
				mine.forEach((x, k) => {
					const y = theirs[k];
					const shown = over(x.color, x.opacity, ground);
					const where = `${site} ${p.k}${x.opacity < 1 ? ` at ${x.opacity}` : ""}`;
					if (y !== undefined && y.color === x.color && y.opacity === x.opacity) {
						if (!other.has(shown)) other.set(shown, where);
					} else if (x.opacity <= WASH) washes++;
					else if (!alert.has(shown)) alert.set(shown, where);
				});
			});
		}
		return { alert, other, washes };
	};
	/** The forms an alert color takes on a look, by name: the color itself,
	 * lifted for a row's word, and a Group Now
	 * column (78 %). */
	const alertFormsOf = (theme: string, background: DialBackground): Map<string, string> => {
		const { look, rows } = surfacesOf(theme, background);
		const colors = stripLookOf(stripConfigOf({ theme, background })).alertColors;
		const out = new Map<string, string>();
		for (const level of ["warn", "crit"] as const) {
			const c = colors[level];
			for (const [name, color] of [[`${level} column`, over(c, GROUP_BAR_OPACITY, look)], [`${level} on the rows`, readableValueColor(c, rows)], [level, c]] as const) out.set(color, name);
		}
		return out;
	};
	/** Every other color a look can draw, by name, as the strip's code
	 * derives it: each source color (the series colors as lifted, the
	 * accent, Group's muted line, the theme's words, the ice
	 * ramp) and each way the strip mixes it toward the
	 * surface, draws it translucent or lifts it for the rows. */
	const namedOf = (theme: string, background: DialBackground): Map<string, string> => {
		const palette = resolvePalette(themes, theme, null, "normal");
		const effective = lookOn(background, palette);
		const { look: s, rows } = surfacesOf(theme, background);
		const text = dialTextColors(effective, palette, THEME_TEXT);
		const rowsUnit = readableValueColor(text.unit, rows);
		const out = new Map<string, string>();
		const add = (color: string, name: string): void => {
			if (!out.has(color)) out.set(color, name);
		};
		const toward = (c: string, k: number): string => mixToward(c, s, k);
		const series = ["sky blue", "yellow", "reddish purple", "bluish green"].map((name, i): [string, string] => [name, readableValueColor(STRIP_SERIES_COLORS[i] as string, s)]);
		// Lines and marks: drawn, dimmed when not highlighted (Trend, 45 %),
		// stale (50 %), Area's fill (30 %), a value lifted for the rows.
		for (const [name, c] of [...series, ["accent", palette.accent] as [string, string]]) {
			add(c, name);
			add(toward(c, 0.45), `${name} 45% toward the surface`);
			add(toward(c, 0.5), `${name} stale`);
			add(over(c, 0.3, s), `${name} area`);
			add(readableValueColor(c, rows), `${name} on the rows`);
		}
		// Heat: the accent's steps (series 0 of a Heat pane is the accent).
		for (let k = 0; k < 8; k++) add(toward(palette.accent, 0.85 * (1 - k / 7)), `accent heat step ${k}`);
		// Group: the highlight (the lifted yellow) and its column, the muted
		// lines, the whisker and median, the ice ramp (reversed on a light
		// surface), its columns, stale cells, and the spread band.
		const yellow = readableValueColor(STRIP_SERIES_COLORS[1], s);
		add(over(yellow, GROUP_BAR_OPACITY, s), `yellow at ${GROUP_BAR_OPACITY}`);
		const muted = toward(text.label, 0.6);
		for (const [name, c] of [["muted", muted], ["whisker", toward(text.label, 0.35)], ["median", toward(text.label, 0.2)]] as const) {
			add(c, name);
			add(toward(c, 0.5), `${name} stale`);
		}
		const ramp = luminance(s) > 0.5 ? [...ICE_RAMP].reverse() : [...ICE_RAMP];
		ramp.forEach((c, k) => {
			add(c, `ice ${k}`);
			add(toward(c, 0.5), `ice ${k} stale`);
			add(over(c, GROUP_BAR_OPACITY, s), `ice ${k} at ${GROUP_BAR_OPACITY}`);
		});
		add(over(ICE_RAMP[4], GROUP_BAND_OPACITY, s), `ice 4 at ${GROUP_BAND_OPACITY}`);
		// Tiles: the ramp by height its lines draw in (a gradient, which the
		// frame's flat paints do not show), half as strong for a stale reading,
		// and its fills (36 %, 18 % stale).
		for (let k = 0; k <= 50; k++) {
			const c = tileRampAt(k / 50);
			add(c, `tiles ramp at ${k * 2}%`);
			add(over(c, 0.5, s), `tiles ramp at ${k * 2}% stale`);
			add(over(c, 0.36, s), `tiles ramp at ${k * 2}% fill`);
			add(over(c, 0.18, s), `tiles ramp at ${k * 2}% fill, stale`);
		}
		// The theme's words and structure: values, labels, units and badges
		// (lifted for the rows too), the Events hairline (55 %), the Meters range
		// (30 %, 60 % stale), the track, Glass's ink and panel, Tint's panel.
		for (const [name, c] of [["value", text.value], ["label", text.label], ["unit", text.unit], ["badge", text.badge], ["rows unit", rowsUnit], ["rows label", noDimmerThan(readableValueColor(text.label, rows), rowsUnit, rows)], ["rows value", readableValueColor(text.value, rows)], ["track", palette.track]] as const) add(c, name);
		// Tiles: a core's number, the rows' unit a step toward the tiles' veil.
		add(mixToward(rowsUnit, TILE_VEIL, CORE_DIM), "rows unit toward the Tiles veil");
		add(toward(text.label, 0.55), "label 55% toward the surface");
		add(toward(text.label, 0.3), "label 30% toward the surface");
		add(over(palette.label, GLASS_INK_OPACITY, s), `label at ${GLASS_INK_OPACITY}`);
		for (const a of [TINT_OPACITY, GLASS_OPACITY, 1]) add(over(palette.bg, a, s), `theme background at ${a}`);
		return out;
	};
	const SOURCE = /^(sky blue|yellow|reddish purple|bluish green|accent|value|label|unit|badge|rows unit|rows label|rows value|muted|whisker|median|track|theme background|ice \d)\b/;
	const sourceOf = (name: string): string => SOURCE.exec(name)?.[1] ?? name;
	type Pair = { readonly theme: string; readonly background: DialBackground; readonly alert: string; readonly other: string };
	/**
	 * Pairs under 20 dE00 that differ by more than color, each with its cue.
	 */
	const CUED: readonly { readonly why: string; readonly holds: (p: Pair) => boolean }[] = [
		{
			// scene.ts groupNowView: the limits cross every column as lines with
			// their labels, so a column past one stands past its labelled line,
			// and the highlighted column has its tab under it.
			why: "a Group Now column: its level is where it stands against the labelled limit lines that cross every column",
			holds: (p) => / column$/.test(p.alert) || /^(yellow|ice \d) at 0\.78$/.test(p.other)
		}
	];
	/**
	 * Pairs under 20 dE00 this test knows of and does not excuse: each is
	 * named, measured and owed a fix of its own (the strip's alert colors on
	 * Theme, Tint, Outline and Clear are the theme's as every key and dial
	 * draws them, held byte for byte).
	 */
	const KNOWN: readonly { readonly why: string; readonly holds: (p: Pair) => boolean }[] = [
		{
			// themes.json: Ember's accent #E0912F, value #FFB84D and label
			// #A47632 are amber, warn's own hue (#E8940D, 3.3 dE00 from the
			// accent), on every Background and on keys and dials alike.
			why: "Ember draws its accent and words in warn's amber",
			holds: (p) => p.theme === "ember" && p.alert.startsWith("warn") && /^(accent|value|label|unit|badge|rows unit|rows label|rows value|muted|whisker|median)$/.test(sourceOf(p.other))
		},
		{
			// Paper's warn #915C08 is 16.1 dE00 from the lifted yellow on the
			// theme background (as before this test); on Glass's Paper panel no
			// dark amber at 4.5:1 stands 20 from the olive yellow, Paper's dark
			// words and crit at once.
			why: "on Paper the lifted yellow and Paper's dark words are olive and brown, as dark as warn must be",
			holds: (p) => p.theme === "paper" && p.alert.startsWith("warn") && (sourceOf(p.other) === "yellow" || (p.background === "glass" && /^(accent|value|label|unit|badge|rows unit|rows label|rows value|muted|whisker|median|theme background|track)$/.test(sourceOf(p.other))))
		},
		{
			// tiles.ts TILE_RAMP: the Tiles lines and fills take one fixed ramp
			// by height whose gold and peach sit near warn and crit (5.9 and 6.6
			// dE00 on Graphite with Nebula). The owner chose alert marks and kept
			// the ramp (the five-way sheet's option B): no limit line, a tile
			// past a limit takes a bar along its bottom (3 px warn, 6 px crit)
			// and a 1 px outline in the alert color, and with limits set no value
			// takes a color.
			why: "the Tiles ramp's warm end, on its lines and fills, sits near warn and crit",
			holds: (p) => /^(warn|crit)\b/.test(p.alert) && /^tiles ramp at /.test(p.other)
		}
	];

	it("the strip draws an alert color only as itself, lifted for a row's word, or as a Group Now column: never dimmed for a stale reading", () => {
		const misses: string[] = [];
		for (const theme of ALERT_THEMES) {
			for (const background of ALERT_LOOKS) {
				const forms = alertFormsOf(theme, background);
				const { alert, washes } = drawnOf(theme, background);
				assert.ok(washes > 0, `${background} ${theme}: band tints drawn`);
				for (const [color, where] of alert) if (!forms.has(color)) misses.push(`${background} ${theme}: ${color} (${where})`);
				for (const name of ["warn", "crit"]) assert.ok([...alert.keys()].some((c) => forms.get(c) === name), `${background} ${theme}: ${name} drawn`);
			}
		}
		assert.deepEqual(misses.sort(), []);
	});

	it("every alert color stays 20 dE00 from every other color its look draws, on every Background and theme", () => {
		const misses: string[] = [];
		const cued = new Set<string>();
		const known = new Set<string>();
		for (const theme of ALERT_THEMES) {
			for (const background of ALERT_LOOKS) {
				const forms = alertFormsOf(theme, background);
				const named = namedOf(theme, background);
				const { alert, other } = drawnOf(theme, background);
				// Every drawn other color, by name where the strip derives it from
				// a source color; the named ones the corpus did not draw as well.
				const others = new Map<string, string>([...named].map(([c, n]) => [c, n]));
				for (const [c, where] of other) if (!others.has(c)) others.set(c, `drawn ${c} (${where})`);
				for (const color of new Set([...forms.keys()].filter((c) => alert.has(c) || forms.get(c) === "warn" || forms.get(c) === "crit"))) {
					const name = forms.get(color) as string;
					for (const [o, oName] of others) {
						const d = ciede2000(color, o);
						if (d >= 20) continue;
						const pair: Pair = { theme, background, alert: name, other: oName };
						const line = `${background} ${theme}: ${name} ${color} and ${oName} ${o}: ${d.toFixed(1)}`;
						const cue = CUED.find((x) => x.holds(pair));
						const k = KNOWN.find((x) => x.holds(pair));
						if (cue !== undefined) cued.add(cue.why);
						else if (k !== undefined) known.add(k.why);
						else misses.push(line);
					}
				}
			}
		}
		assert.deepEqual(misses.sort(), []);
		// Each excuse is still needed: one that no pair uses comes out.
		assert.deepEqual([...cued].sort(), CUED.map((x) => x.why).sort());
		assert.deepEqual([...known].sort(), KNOWN.map((x) => x.why).sort());
	});

	it("warn and crit stay apart as the series colors do (20 dE00, and under each color vision deficiency), with a luminance step where the gamut allows", () => {
		const misses: string[] = [];
		for (const theme of ALERT_THEMES) {
			for (const background of ALERT_LOOKS) {
				const { warn, crit } = stripLookOf(stripConfigOf({ theme, background })).alertColors;
				const { look: surface } = surfacesOf(theme, background);
				const where = `${background} ${theme} ${warn} and ${crit}`;
				const normal = ciede2000(warn, crit);
				if (normal < SERIES_FLOORS.normal) misses.push(`${where}: ${normal.toFixed(1)}`);
				for (const kind of ["deuteranopia", "protanopia", "tritanopia"] as const) {
					const d = ciede2000(simulate(warn, kind), simulate(crit, kind));
					// KNOWN, owed a fix of its own: Paper's warn and crit (#915C08
					// and #C32D25 on the theme background, as every key and dial
					// draws them) sit at one luminance, 2.9 apart under
					// deuteranopia, and Glass's Paper panel, where both must be as
					// dark as L* 31, leaves no step between them either (2.3).
					// Where color was their only cue they differ by size as well
					// (below).
					if (theme === "paper" && kind === "deuteranopia" && d >= 2) continue;
					if (d < SERIES_FLOORS[kind]) misses.push(`${where} ${kind}: ${d.toFixed(1)}`);
				}
				// A dark surface keeps warn the lighter of the two, as the theme
				// does (1.46:1 on Theme), by at least the smallest step.
				if (luminance(surface) < 0.18 && !(luminance(warn) > luminance(crit) && contrastRatio(warn, crit) >= 1.05)) misses.push(`${where}: warn ${contrastRatio(warn, crit).toFixed(2)}:1 ${luminance(warn) > luminance(crit) ? "lighter" : "darker"}`);
			}
		}
		assert.deepEqual(misses.sort(), []);
	});
});

describe("warn and crit differ by size where color was their only cue", () => {
	// Events runs, Heat caps, Group Rows cells and the bar at a row's left
	// end told warn from crit by color alone; on Glass and the art looks
	// the two are lifted toward one luminance, and under tritanopia they sit
	// 3.5 dE00 apart at the least. Each now differs by size as well. The
	// alert pieces are found by drawing each frame again with other alert
	// colors, each level by its own.
	type Box = { x: number; y: number; w: number; h: number; level: "warn" | "crit" };
	/** The rects of a frame's alert-colored cells, rects and marks. */
	const alertBoxes = (input: StripSceneInput, layer?: string): Box[] => {
		const drawn = buildStripScene(input).prims;
		const other = buildStripScene({ ...input, alertColors: OTHER_ALERTS }).prims;
		const out: Box[] = [];
		drawn.forEach((p, i) => {
			const q = other[i] as Prim;
			if (!("paint" in p) || !("paint" in q) || p.paint === q.paint || (layer !== undefined && p.layer !== layer)) return;
			const level = q.paint.includes(OTHER_ALERTS.crit) ? "crit" : q.paint.includes(OTHER_ALERTS.warn) ? "warn" : null;
			if (level === null) return;
			if (p.k === "rect") out.push({ x: p.x, y: p.y, w: p.w, h: p.h, level });
			if (p.k === "cells") for (let k = 0; k + 3 < p.rects.length; k += 4) out.push({ x: p.rects[k] as number, y: p.rects[k + 1] as number, w: p.rects[k + 2] as number, h: p.rects[k + 3] as number, level });
		});
		return out;
	};
	const looks = [["graphite", "glass"], ["graphite", "theme"], ["paper", "glass"]] as const;

	for (const [theme, background] of looks) {
		it(`Events on ${background} ${theme}: a warn run is half the height of a crit run, on the same line (Yes/No marks are warn marks)`, () => {
			const c = fixtureCase({ styles: ["events"], layout: "whole", encoders: 6, background, accent: false, theme });
			const rows = eventRows(c.input.panes[0]?.series.length ?? 0);
			const boxes = alertBoxes(c.input, "marks");
			assert.ok(boxes.some((b) => b.level === "warn") && boxes.some((b) => b.level === "crit"), "warn and crit runs drawn");
			for (const b of boxes) {
				const row = rows.find((r) => b.y >= r.y0 && b.y + b.h <= r.y1);
				assert.ok(row !== undefined, `${b.level} run at y ${b.y} inside a row`);
				const cy = Math.round((row.y0 + row.y1) / 2);
				assert.equal(b.h, b.level === "crit" ? row.mark : Math.round(row.mark / 2), `${b.level} run height`);
				assert.equal(b.y, cy - Math.floor(b.h / 2), `${b.level} run centered on its row's line`);
			}
		});

		it(`Heat on ${background} ${theme}: a crit cap is twice a warn cap`, () => {
			const c = pastLimits(fixtureCase({ styles: ["heat"], layout: "whole", encoders: 6, background, accent: false, theme }), "warn");
			const bands = [{ key: "f0:0:3", warn: 80, crit: 90, below: false }];
			const pane = { ...c.input.config.panes[0], bands } as unknown as StripPaneV1;
			const config: StripConfigV1 = { ...c.input.config, panes: [pane, c.input.config.panes[1]] };
			const input: StripSceneInput = { ...c.input, config, panes: c.input.panes.map((p, i) => (i === 0 ? { ...p, bands: stripBandsFor(pane, p.series, { fahrenheit: false, decimals: config.decimals }) } : p)) };
			const caps = alertBoxes(input, "base").filter((b) => b.h <= 10);
			assert.ok(caps.some((b) => b.level === "warn") && caps.some((b) => b.level === "crit"), "warn and crit caps drawn");
			for (const b of caps) assert.equal(b.h, b.level === "crit" ? 10 : 5, `${b.level} cap at x ${b.x}`);
			assert.equal(new Set(caps.map((b) => b.y)).size, 1, "every cap hangs from the cells' top");
		});

		it(`Group Rows on ${background} ${theme}: a crit cell fills its row, a warn cell keeps its ramp color under a cap over its upper half, and a crit row bar is twice a warn bar`, () => {
			const c = groupFixture({ n: 8, view: "rows", background, theme, limits: { warn: 54, crit: 57.5 } });
			const rows = groupRows(8);
			const cells = alertBoxes(c.input, "base");
			const bars = alertBoxes(c.input, "marks");
			assert.ok(cells.some((b) => b.level === "warn") && cells.some((b) => b.level === "crit"), "warn and crit cells drawn");
			const drawn = buildStripScene(c.input).prims;
			const rampRects = drawn.filter((p) => p.k === "cells" && p.layer === "base").flatMap((p) => {
				const r = (p as { rects: readonly number[] }).rects;
				return Array.from({ length: r.length / 4 }, (_, k) => ({ x: r[4 * k] as number, y: r[4 * k + 1] as number, w: r[4 * k + 2] as number, h: r[4 * k + 3] as number }));
			});
			for (const b of cells) {
				const row = rows.find((r) => r.y0 === b.y);
				assert.ok(row !== undefined, `${b.level} cell at the top of a row (y ${b.y})`);
				const h = row.y1 - row.y0;
				assert.equal(b.h, b.level === "crit" ? h : Math.max(1, Math.floor(h / 2)), `${b.level} cell height`);
				if (b.level !== "warn") continue;
				// Ramp cells (no alert color) of the full row height under every
				// pixel of the cap.
				const under = rampRects.filter((r) => r.y === row.y0 && r.h === h && !cells.some((x) => x.x === r.x && x.y === r.y && x.w === r.w && x.h === r.h));
				for (let x = b.x; x < b.x + b.w; x++) assert.ok(under.some((r) => r.x <= x && x < r.x + r.w), `a ramp cell under the warn cap at x ${x}`);
			}
			assert.ok(bars.some((b) => b.level === "warn") && bars.some((b) => b.level === "crit"), `rows alerting now in both levels: ${JSON.stringify(bars)}`);
			for (const b of bars) assert.equal(b.w, b.level === "crit" ? 6 : 3, `${b.level} row bar width`);
			assert.equal(new Set(bars.map((b) => b.x + b.w)).size, 1, "the bars share their right edge");
		});
	}
});

// ---- the Y scale (40-spec-final.md section 10.1) --------------------------------

describe("the Y scale: calm Auto, typed ends kept as typed, the unit stamp", () => {
	/** A reading moving between lo and hi across the window (a triangle). */
	const swing =
		(lo: number, hi: number) =>
		(f: number): number =>
			lo + (hi - lo) * Math.abs(((f * 6) % 2) - 1);
	const reading = (key: string, unit: string, value: (f: number) => number, name = key.toUpperCase(), width = 600): StripSeriesInput => ({ key, name, unit, state: "ok", history: makeView({ windowMs: 300_000, widthPx: width, unit, value }), current: value(1) });
	/** The scale ends of a line pane's column at x 3, top to bottom. */
	const ends = (prims: readonly Prim[]): TextPrim[] => prims.filter((p): p is TextPrim => p.k === "text" && p.layer === "rows" && p.size === 11 && p.anchor === "start" && Math.abs(p.x - 3) < 0.6).sort((a, b) => a.y - b.y);
	const endTexts = (prims: readonly Prim[]): string[] => ends(prims).map((p) => p.text);
	const stamp = (scale: { min?: number; max?: number }, unit: string): Record<string, unknown> => ({ ...scale, displayUnit: unit, displayUnitFor: Object.fromEntries(Object.entries(scale).map(([k, v]) => [k, String(v)])) });
	const rowsSurface = (): string => {
		const lum = (hex: string): number => 0.2126 * (parseInt(hex.slice(1, 3), 16) / 255) + 0.7152 * (parseInt(hex.slice(3, 5), 16) / 255) + 0.0722 * (parseInt(hex.slice(5, 7), 16) / 255);
		return blendOver(palette.bg, ROW_SURFACE_OPACITY, lum(palette.value) > lum(palette.bg) ? "#FFFFFF" : "#000000");
	};

	it("1. an idle GPU at 36.1 to 36.9 °C draws on 34 to 39 °C, on a whole + XL strip too", () => {
		for (const encoders of [4, 6] as const) {
			const { prims } = scene({ style: "trend", encoders, series: [reading("gpu", "°C", swing(36.1, 36.9))] });
			assert.deepEqual(endTexts(prims), ["39 °C", "34"], `${encoders} dials`);
		}
	});

	it("2. a CPU fan at 1180 to 1220 RPM draws from 0 to 2000 RPM, its line under the top row", () => {
		const { prims } = scene({ style: "trend", encoders: 6, series: [reading("fan", "RPM", swing(1180, 1220))] });
		assert.deepEqual(endTexts(prims), ["2000 RPM", "0"]);
		for (const l of lines(prims)) for (let i = 1; i < l.pts.length; i += 2) assert.ok((l.pts[i] as number) >= 32 && (l.pts[i] as number) <= 94, `line y ${l.pts[i]}`);
	});

	it("3. GPU power at 14.8 to 16.2 W draws from 0 to 25 W", () => {
		const { prims } = scene({ style: "trend", encoders: 6, series: [reading("pwr", "W", swing(14.8, 16.2))] });
		assert.deepEqual(endTexts(prims), ["25 W", "0"]);
	});

	it("4. CPU usage at 1.2 to 4.8 % draws from 0 to 100 %", () => {
		const { prims } = scene({ style: "trend", encoders: 6, series: [reading("use", "%", swing(1.2, 4.8))] });
		assert.deepEqual(endTexts(prims), ["100 %", "0"]);
	});

	it("5. a stopped fan draws from 0 to 100 RPM", () => {
		const { prims } = scene({ style: "trend", encoders: 6, series: [reading("fan", "RPM", () => 0)] });
		assert.deepEqual(endTexts(prims), ["100 RPM", "0"]);
	});

	it("6. a Yes/No reading at No draws from No to Yes, with no unit word", () => {
		const { prims } = scene({ style: "trend", encoders: 6, series: [reading("thr", "Yes/No", () => 0)] });
		assert.deepEqual(endTexts(prims), ["Yes", "No"]);
		assert.ok(!endTexts(prims).some((t) => t.includes("Yes/No")));
	});

	it("7. data scales are chosen in the unit the strip prints: Mbps and kbps under Decimal, KiB/s under Binary", () => {
		const disk = scene({ style: "trend", encoders: 6, series: [reading("dsk", "MB/s", swing(0, 0.4))] });
		assert.deepEqual(endTexts(disk.prims), ["5Mbps", "0"]);
		const net = scene({ style: "trend", encoders: 6, series: [reading("net", "KB/s", swing(0, 20))] });
		assert.deepEqual(endTexts(net.prims), ["250kbps", "0"]);
		const binary = scene({ style: "trend", encoders: 6, dataUnits: "binary", series: [reading("net", "KB/s", swing(0, 20))] });
		assert.deepEqual(endTexts(binary.prims), ["30KiB/s", "0"]);
	});

	it("8. a hot spot delta at 8.2 to 8.9 Δ°C draws on 6 to 11 Δ°C", () => {
		const { prims } = scene({ style: "trend", encoders: 6, series: [reading("dlt", "Δ°C", swing(8.2, 8.9))] });
		assert.deepEqual(endTexts(prims), ["11 Δ°C", "6"]);
	});

	it("9. a typed end prints as typed: 30.5 stays 30.5", () => {
		const { prims } = scene({ style: "trend", encoders: 6, scale: stamp({ min: 30.5, max: 90 }, "°C"), series: [reading("gpu", "°C", swing(36.1, 36.9))] });
		assert.equal(ends(prims).at(-1)?.text, "30.5");
	});

	it("10. a scale stamped in W applies to the W band; the °C band stays on Auto", () => {
		const { prims } = scene({ style: "trend", encoders: 6, scale: stamp({ min: 0, max: 300 }, "W"), series: [reading("gpu", "°C", swing(36.1, 36.9)), reading("pwr", "W", swing(14.8, 16.2))] });
		assert.deepEqual(endTexts(prims), ["40 °C", "35", "300 W", "0"]);
	});

	it("11. Lanes take a stamped scale for the lane in its unit", () => {
		const { prims } = scene({ style: "lanes", encoders: 6, overlays: { axes: true }, scale: stamp({ min: 30, max: 90 }, "°C"), series: [reading("gpu", "°C", swing(36.1, 36.9)), reading("pwr", "W", swing(14.8, 16.2))] });
		assert.ok(textsOf(prims).includes("30 to 90 °C"), textsOf(prims).join("|"));
	});

	it("13. Meters take a stamped °C scale for the °C meter only", () => {
		const { prims } = scene({ style: "meters", encoders: 6, scale: stamp({ min: 30, max: 90 }, "°C"), series: [reading("gpu", "°C", swing(36.1, 36.9)), reading("pwr", "W", swing(14.8, 16.2))] });
		const scaleTexts = (x0: number): string[] => prims.filter((p): p is TextPrim => p.k === "text" && p.size === 12 && p.y === 94 && p.x >= x0 && p.x < x0 + 600 && /^\d+$/.test(p.text)).sort((a, b) => a.x - b.x).map((p) => p.text);
		assert.deepEqual(scaleTexts(0), ["30", "90"]);
		assert.deepEqual(scaleTexts(600), ["0", "20"]);
	});

	// A reading with no unit (a calculated ratio, test/calculated.test.ts) is
	// a unit on view of its own: ends typed for it carry an empty stamp, and
	// they apply to the readings with no unit, on Lanes and Meters too.
	it("a scale stamped for readings with no unit applies to them on Lanes and Meters, and to nothing else", () => {
		const lanes = scene({ style: "lanes", encoders: 6, overlays: { axes: true }, scale: stamp({ min: 0, max: 2 }, ""), series: [reading("ratio", "", swing(0.4, 0.6)), reading("gpu", "°C", swing(36.1, 36.9))] });
		assert.ok(textsOf(lanes.prims).includes("0 to 2"), textsOf(lanes.prims).join("|"));
		assert.ok(!textsOf(lanes.prims).some((t) => /^0 to 2 °C$/.test(t)), "the °C lane keeps its own scale");
		const meters = scene({ style: "meters", encoders: 6, scale: stamp({ min: 0, max: 2 }, ""), series: [reading("ratio", "", swing(0.4, 0.6)), reading("gpu", "°C", swing(36.1, 36.9))] });
		const scaleEnds = (x0: number): number[] => meters.prims.filter((p): p is TextPrim => p.k === "text" && p.size === 12 && p.y === 94 && p.x >= x0 && p.x < x0 + 600 && /^[\d.]+$/.test(p.text)).sort((a, b) => a.x - b.x).map((p) => Number(p.text));
		assert.deepEqual(scaleEnds(0), [0, 2]);
		assert.notDeepEqual(scaleEnds(600), [0, 2], "the °C meter keeps its own ends");
	});

	it("15. Group ignores a stored scale it hides", () => {
		const c = groupFixture({ n: 4, kind: "clock" });
		const withScale: StripSceneInput = { ...c.input, config: { ...c.input.config, panes: [{ ...c.input.config.panes[0], scale: { min: 0, max: 6000 } }, c.input.config.panes[1]] } };
		assert.equal(renderLogical(buildStripScene(withScale)), renderLogical(buildStripScene(c.input)));
	});

	/** A Group Now pane of constant readings in `unit` with `limits`. */
	function groupNow(unit: string, values: readonly number[], limits: { warn?: number; crit?: number }): StripSceneInput {
		const c = groupFixture({ n: values.length, view: "now", limits });
		const series: StripSeriesInput[] = values.map((v, i) => ({ key: `c0:0:${(0x1000000 + i).toString(16)}`, name: `Core ${i}`, unit, state: "ok", history: makeView({ windowMs: 300_000, widthPx: 600, unit, value: () => v }), current: v }));
		const pane = c.input.config.panes[0];
		const first = c.input.panes[0] as StripPaneInput;
		return { ...c.input, panes: [{ ...first, series, bands: stripBandsFor(pane, series, { fahrenheit: false, decimals: "auto" }), group: { ...(first.group as NonNullable<StripPaneInput["group"]>), unit } }] };
	}

	it("16. Group Now leaves a limit outside its scale undrawn", () => {
		const input = groupNow("°C", [37, 40, 42, 45], { warn: 80, crit: 90 });
		const limitLines = buildStripScene(input).prims.filter((p) => p.k === "rect" && p.h === 1 && (p.paint === `fill="${input.alertColors.warn}"` || p.paint === `fill="${input.alertColors.crit}"`));
		assert.deepEqual(limitLines, []);
	});

	it("17. Group Now of power readings takes a far crit into its scale and draws it in its place", () => {
		const input = groupNow("W", [15, 25, 35, 50], { crit: 300 });
		const prims = buildStripScene(input).prims;
		const gutter = prims.filter((p): p is TextPrim => p.k === "text" && p.size === 11 && p.anchor === "start" && /^\d+$/.test(p.text)).map((p) => Number(p.text));
		const top = Math.max(...gutter);
		assert.ok(top >= 300, `scale top ${top}`);
		const crit = prims.find((p) => p.k === "rect" && p.h === 1 && p.paint === `fill="${input.alertColors.crit}"`);
		assert.ok(crit !== undefined && crit.k === "rect");
		assert.equal(crit.y, Math.round(yOf({ lo: 0, hi: top, top: GROUP_TOP + 14, bottom: GROUP_BOTTOM }, 300)));
	});

	it("18. Heat's legend prints the held round scale: 34 to 39 °C", () => {
		const { prims } = scene({ style: "heat", encoders: 6, series: [reading("gpu", "°C", swing(36.1, 36.9))] });
		const legend = prims.filter((p): p is TextPrim => p.k === "text" && p.layer === "rows" && p.y === 95 && p.size === 13).map((p) => p.text);
		assert.ok(legend.includes("34") && legend.includes("39 °C"), legend.join("|"));
	});

	it("19. Heat of a steady fan: every cell one step, not the reading's own color", () => {
		const { prims } = scene({ style: "heat", encoders: 6, series: [reading("fan", "RPM", swing(1180, 1220))] });
		const fills = new Set(prims.filter((p) => p.k === "rect" && p.layer === "base" && p.h === STRIP_ROWS.plotBottom - STRIP_ROWS.plotTop).map((p) => (p as { paint: string }).paint));
		assert.equal(fills.size, 1, [...fills].join(" "));
		assert.ok(!fills.has(`fill="${palette.accent}"`), "not the top step");
	});

	it("20. a band stamped in °C reads in °F after the switch", () => {
		const pane = stripPaneOf({ style: "trend", series: [{ key: "gpu" }], bands: [{ key: "gpu", warn: 80, below: false, unit: "°C", displayUnit: "°C", displayUnitFor: { warn: "80" } }] });
		const bands = stripBandsFor(pane, [reading("gpu", "°C", () => 40)], { fahrenheit: true, decimals: "auto" });
		assert.equal(bands[0]?.from, 176);
		assert.ok(bands[0]?.label.includes("176"), bands[0]?.label);
	});

	it("21. a scale stamped in °C reads in °F after the switch", () => {
		const { prims } = scene({ style: "trend", encoders: 6, fahrenheit: true, scale: stamp({ min: 30, max: 90 }, "°C"), series: [reading("gpu", "°C", swing(36.1, 36.9))] });
		assert.deepEqual(endTexts(prims), ["194 °F", "86"]);
	});

	it("22. a native °F reading takes a scale stamped in °C, converted", () => {
		const { prims } = scene({ style: "trend", encoders: 6, scale: stamp({ min: 30, max: 90 }, "°C"), series: [reading("gpu", "°F", swing(97, 98.4))] });
		assert.deepEqual(endTexts(prims), ["194 °F", "86"]);
	});

	it("23. a reading past a typed end colors that end: the line's color, the alert color in an alert", () => {
		const surface = rowsSurface();
		const past = scene({ style: "trend", encoders: 6, scale: stamp({ min: 30, max: 35 }, "°C"), series: [reading("gpu", "°C", () => 36)] });
		assert.equal(ends(past.prims)[0]?.fill, readableValueColor(palette.accent, surface));
		const alert = scene({ style: "trend", encoders: 6, scale: stamp({ min: 30, max: 35 }, "°C"), bands: [{ key: "gpu", crit: 35.5 }], series: [reading("gpu", "°C", () => 36)] });
		assert.equal(ends(alert.prims)[0]?.fill, readableValueColor("#FF3B30", surface));
	});
});
