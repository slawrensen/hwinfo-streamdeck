/**
 * Brief gaps on strip graphs, on the real data path (test/brief-gap-fixture.ts):
 * a reading missed for a moment draws straight across by not splitting the
 * run, in every view that draws a line; "mark" lays a short solid stroke in a
 * neutral theme ink over that same line; "gaps" draws what a boundary always
 * drew. Inspect, extents and statistics never hear about any of it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { binsOf } from "../scripts/lib/strip-fixtures";
import type { HistoryView, HistoryViewSegment } from "../src/history/types";
import { freshView, groupFrameOf, type GroupView, type PaneView } from "../src/strip/frame";
import type { PanePlot } from "../src/strip/geometry";
import { ambientTrail } from "../src/strip/ambient";
import { eventCount, eventStates } from "../src/strip/events";
import { areaPrims, binView, linePrims, MARK_INKS, observedSpans, runPoints, runsOf, valueAt, type Bins, type YMap } from "../src/strip/graph";
import { emitPrim, type AreaPrim, type EnvelopePrim, type LinePrim, type Prim, type SkeinPrim, type TextPrim, type WordsPrim } from "../src/strip/prims";
import { buildStripScene, lookOf, renderLogical, type LogicalScene, type StripSceneInput } from "../src/strip/scene";
import { STRIP_GAP_MODES, stripConfigOf, stripConfigToJson } from "../src/strip/settings";
import { sliceStrip } from "../src/strip/slicer";
import { TILE_RAMP } from "../src/strip/tiles";
import { hexToLab } from "../src/ui/color-difference";
import { mixToward } from "../src/ui/text-colors";
import { setFaceFont } from "../src/ui/face-font";
import { evenly, pollTrace, skipsAt, traceFrame, traceGroup, tracePane, type Trace, type TraceParams } from "./brief-gap-fixture";

setFaceFont("tahoma");

const END = 1_000_000;
const lightness = (hex: string): number => hexToLab(hex)[0];
const linesOf = (scene: LogicalScene): LinePrim[] => scene.prims.filter((p): p is LinePrim => p.k === "line");
const skeinsOf = (scene: LogicalScene): SkeinPrim[] => scene.prims.filter((p): p is SkeinPrim => p.k === "skein");
const svgOf = (scene: LogicalScene): string => renderLogical(scene);
const textsOf = (prims: readonly Prim[]): string => JSON.stringify(prims.flatMap((p) => (p.k === "text" ? [(p as TextPrim).text] : p.k === "words" ? (p as WordsPrim).words.map((w) => w.text) : [])));
/** The two inks a mark may take, on every look. */
const inksOf = (): { value: string; label: string } => ({ value: MARK_INKS[0], label: MARK_INKS[1] });
const sceneOf = (trace: Trace, pane: Record<string, unknown>, options: Parameters<typeof traceFrame>[2] = {}): LogicalScene => buildStripScene(traceFrame(trace, pane, options).input);

/** A trace with `boundaries` skipped reads, evenly through its window. */
function traced(boundaries: number, params: TraceParams = {}): Trace {
	const window = params.window ?? "5m";
	const seconds = { "1m": 60, "5m": 300, "15m": 900 }[window];
	return pollTrace({ ...params, window, kind: skipsAt(evenly(boundaries, seconds, END), params.pollMs ?? 1007) });
}

/** One marked stroke: a two point line in no series' color. */
const marksOf = (scene: LogicalScene, inks: readonly string[]): LinePrim[] => linesOf(scene).filter((l) => l.pts.length === 4 && inks.includes(l.stroke) && l.backing === undefined);

const PLOT: PanePlot = { x0: 0, x1: 400, bucketPx: 2, buckets: 200 };
const MAP: YMap = { lo: 0, hi: 100, top: 10, bottom: 90 };

/** A view whose segments are the given ones, for bins written by hand. */
function viewOf(segments: readonly Partial<HistoryViewSegment>[]): HistoryView {
	return { segments: segments.map((s, ordinal) => ({ ordinal, x0: 0, x1: 0, open: false, source: "shared-memory", ...s })) } as unknown as HistoryView;
}

const BRIEF: readonly Partial<HistoryViewSegment>[] = [{ endReason: "skipped" }, { brief: true }];
const INKS = ["#FFFFFF", "#808080"] as const;

describe("runsOf: a brief boundary extends the run", () => {
	const bins: Bins = binsOf([
		{ j: 10, seg: 0, first: 40, min: 40, max: 40, last: 40 },
		{ j: 12, seg: 0, first: 41, min: 41, max: 41, last: 41 },
		{ j: 20, seg: 1, first: 50, min: 50, max: 50, last: 50 },
		{ j: 22, seg: 1, first: 51, min: 51, max: 51, last: 51 }
	]);

	it("with no view it is one run per segment, as every consumer that has no line asks", () => {
		assert.deepEqual(runsOf(bins).map((r) => [r.seg, r.from, r.to]), [[0, 0, 2], [1, 2, 4]]);
	});
	it("with a view that says brief it is one run, its segment the newest", () => {
		assert.deepEqual(runsOf(bins, viewOf(BRIEF)).map((r) => [r.seg, r.from, r.to]), [[1, 0, 4]]);
	});
	it("a boundary the view does not call brief still starts a run", () => {
		assert.equal(runsOf(bins, viewOf([{ endReason: "unavailable" }, {}])).length, 2);
	});
	it("connect carries no marks; mark carries each boundary's first bin and the two inks", () => {
		const [connect] = runsOf(bins, viewOf(BRIEF));
		assert.equal(connect?.marks, undefined);
		const [marked] = runsOf(bins, viewOf(BRIEF), INKS);
		assert.deepEqual(marked?.marks, [2]);
		assert.deepEqual(marked?.inks, INKS);
	});
	it("a middle segment with no bins is not spanned, whatever it says", () => {
		const skipping = binsOf([
			{ j: 10, seg: 0, first: 40, min: 40, max: 40, last: 40 },
			{ j: 20, seg: 2, first: 50, min: 50, max: 50, last: 50 }
		]);
		assert.equal(runsOf(skipping, viewOf([{ endReason: "skipped" }, { brief: true, endReason: "skipped" }, { brief: true }])).length, 2);
	});
	it("two brief boundaries in a row stay one run with two marks", () => {
		const three = binsOf([
			{ j: 10, seg: 0, first: 40, min: 40, max: 40, last: 40 },
			{ j: 20, seg: 1, first: 50, min: 50, max: 50, last: 50 },
			{ j: 30, seg: 2, first: 60, min: 60, max: 60, last: 60 }
		]);
		const runs = runsOf(three, viewOf([{ endReason: "skipped" }, { brief: true, endReason: "skipped" }, { brief: true }]), INKS);
		assert.deepEqual(runs.map((r) => [r.seg, r.from, r.to, r.marks]), [[2, 0, 3, [1, 2]]]);
	});
	it("a brief segment whose segment before it left the window starts its own run, with no mark", () => {
		const alone = binsOf([{ j: 20, seg: 0, first: 50, min: 50, max: 50, last: 50 }]);
		const runs = runsOf(alone, viewOf([{ brief: true }]), INKS);
		assert.deepEqual(runs.map((r) => [r.from, r.to, r.marks]), [[0, 1, undefined]]);
	});
});

describe("the merged line's vertices", () => {
	/** Both turn directions of M4 on each side of the boundary. */
	const cases = [
		["rising into rising", { first: 20, min: 20, max: 40, last: 40 }, { first: 50, min: 50, max: 70, last: 70 }],
		["rising into falling", { first: 20, min: 20, max: 40, last: 40 }, { first: 70, min: 50, max: 70, last: 50 }],
		["falling into rising", { first: 40, min: 20, max: 40, last: 20 }, { first: 50, min: 50, max: 70, last: 70 }],
		["falling into falling", { first: 40, min: 20, max: 40, last: 20 }, { first: 70, min: 50, max: 70, last: 50 }]
	] as const;
	for (const [name, before, after] of cases) {
		const bins = binsOf([
			{ j: 10, seg: 0, ...before },
			{ j: 14, seg: 1, ...after }
		]);
		const run = runsOf(bins, viewOf(BRIEF), INKS)[0];
		assert.ok(run !== undefined);
		const separate = runsOf(bins);
		const a = runPoints(separate[0] as (typeof separate)[0], PLOT, MAP);
		const b = runPoints(separate[1] as (typeof separate)[0], PLOT, MAP);

		it(`${name}: the line is both runs' own points, in order, and nothing else`, () => {
			assert.deepEqual(runPoints(run, PLOT, MAP), [...a, ...b]);
		});
		it(`${name}: the mark goes from the last vertex before to the first vertex after`, () => {
			const [line, mark] = linePrims([run], PLOT, MAP, "#102030", 2, "marks");
			assert.deepEqual(line?.pts, [...a, ...b]);
			assert.deepEqual(mark?.pts, [...a.slice(-2), ...b.slice(0, 2)]);
		});
	}

});

describe("the mark's own stroke", () => {
	const bins = binsOf([
		{ j: 10, seg: 0, first: 40, min: 40, max: 40, last: 40 },
		{ j: 20, seg: 1, first: 50, min: 50, max: 50, last: 50 }
	]);
	it("same width as the line, solid, and no backing even where the line has one", () => {
		const [line, mark] = linePrims(runsOf(bins, viewOf(BRIEF), INKS), PLOT, MAP, "#102030", 1.5, "base", { stroke: "#000000", width: 4 });
		assert.ok(line?.backing !== undefined);
		assert.equal(mark?.width, 1.5);
		assert.equal(mark?.backing, undefined);
		assert.equal(mark?.layer, "base");
		assert.doesNotMatch(emitPrim(mark as Prim, 0), /dasharray/);
	});
	it("whichever of the two inks is farther in L* from the color the line actually draws in", () => {
		const runs = runsOf(bins, viewOf(BRIEF), ["#F4F6FA", "#8B93A3"]);
		assert.equal(linePrims(runs, PLOT, MAP, "#102030", 2, "marks")[1]?.stroke, "#F4F6FA", "a dark line takes the light ink");
		assert.equal(linePrims(runs, PLOT, MAP, "#F0E442", 2, "marks")[1]?.stroke, "#8B93A3", "a light line takes the darker ink");
	});
	it("a run with no mark draws one line, as ever", () => {
		assert.equal(linePrims(runsOf(bins, viewOf(BRIEF)), PLOT, MAP, "#102030", 2, "marks").length, 1);
		assert.equal(linePrims(runsOf(bins), PLOT, MAP, "#102030", 2, "marks").length, 2);
	});
});

describe("every view draws straight across by default, and breaks in gaps mode", () => {
	const one = (params: TraceParams = {}): Trace => traced(1, { n: 2, ...params });
	const manyFor = (): Trace => traced(1, { n: 16, unit: "%", pool: "group", value: (i, at) => 40 + 20 * Math.sin(at / 9000 + i) });

	for (const [name, make, pane, drawn] of [
		["Trend", () => one(), (t: Trace, m: unknown) => tracePane(t, "trend", m), 2],
		["Compare", () => one(), (t: Trace, m: unknown) => tracePane(t, "compare", m), 2],
		["Lanes", () => one(), (t: Trace, m: unknown) => tracePane(t, "lanes", m), 2],
		["Area", () => one({ n: 1 }), (t: Trace, m: unknown) => tracePane(t, "area", m), 1],
		["Group Lines", () => one({ n: 3, pool: "group" }), (t: Trace, m: unknown) => traceGroup(t, "auto", m), 3],
		["the readout-only mini trend", () => one({ n: 1 }), (t: Trace, m: unknown) => tracePane(t, "trend", m, { readout: "only" }), 1]
	] as const) {
		it(`${name}: one line per reading on Connect, two on Leave gaps`, () => {
			const trace = make();
			const graphLines = (mode: unknown): LinePrim[] => linesOf(sceneOf(trace, pane(trace, mode)));
			const connect = graphLines(undefined);
			const gaps = graphLines("gaps");
			assert.equal(gaps.length - connect.length, drawn, `${connect.length} lines against ${gaps.length}`);
		});
	}

	it("Spread: the lead line and the band both run on across the boundary", () => {
		const trace = manyFor();
		const highlighted = traceFrame(trace, traceGroup(trace, "spread", undefined));
		const scene = buildStripScene(highlighted.input);
		const bands = scene.prims.filter((p): p is EnvelopePrim => p.k === "envelope");
		assert.equal(bands.length, 1, "one band across a brief boundary");
		const lead = linesOf(scene).filter((l) => l.width === 2);
		assert.equal(lead.length, 1, "one lead line");
		const gaps = sceneOf(trace, traceGroup(trace, "spread", "gaps"));
		assert.equal(gaps.prims.filter((p) => p.k === "envelope").length, 2);
		assert.equal(linesOf(gaps).filter((l) => l.width === 2).length, 2);
	});

	it("a longer stretch stays open in every mode", () => {
		const trace = pollTrace({ n: 1, window: "1m", kind: (_tick, at) => (at > END - 30_000 && at < END - 20_000 ? "skipped" : undefined) });
		for (const mode of [undefined, ...STRIP_GAP_MODES]) assert.equal(linesOf(sceneOf(trace, tracePane(trace, "trend", mode))).filter((l) => l.pts.length > 4).length, 2, String(mode));
	});

	it("an outage stays open in every mode, even with a skipped read beside it", () => {
		const trace = pollTrace({ n: 1, window: "1m", kind: (_tick, at) => (at > END - 30_000 && at < END - 29_000 ? "skipped" : at >= END - 29_000 && at < END - 28_000 ? "unavailable" : undefined) });
		for (const mode of [undefined, ...STRIP_GAP_MODES]) assert.equal(linesOf(sceneOf(trace, tracePane(trace, "trend", mode))).filter((l) => l.pts.length > 4).length, 2, String(mode));
	});
});

describe("Area fills", () => {
	const trace = traced(1, { n: 1 });
	const fills = (mode: unknown): readonly AreaPrim[] => sceneOf(trace, tracePane(trace, "area", mode)).prims.filter((p): p is AreaPrim => p.k === "area");

	it("continuous on Connect and on Connect in color, open on Leave gaps", () => {
		assert.equal(fills(undefined).length, 1);
		assert.equal(fills("mark").length, 1);
		assert.equal(fills("gaps").length, 2);
	});
	it("on Connect in color only the line carries the mark, so the fill is Connect's", () => {
		assert.deepEqual(fills("mark"), fills(undefined));
	});

	it("no helper draws anything across a run that was not merged", () => {
		const bins = binsOf([
			{ j: 10, seg: 0, first: 40, min: 40, max: 40, last: 40 },
			{ j: 11, seg: 0, first: 41, min: 41, max: 41, last: 41 },
			{ j: 90, seg: 1, first: 50, min: 50, max: 50, last: 50 },
			{ j: 91, seg: 1, first: 51, min: 51, max: 51, last: 51 }
		]);
		const runs = runsOf(bins, viewOf([{ endReason: "unavailable" }, {}]));
		assert.equal(areaPrims(runs, PLOT, MAP, 'fill="#000000"').length, 2);
	});

	it("no fill crosses an outage, with a lone bucket between the outage and a skipped read", () => {
		const t0 = END - 40_000;
		const trace2 = pollTrace({
			n: 1,
			window: "1m",
			kind: (_tick, at) => {
				if (at >= t0 && at < t0 + 20_000) return "unavailable";
				if (at >= t0 + 20_500 && at < t0 + 21_500) return "skipped";
				return undefined;
			}
		});
		const view = trace2.store.view(trace2.keys[0] as string, "1m", 1200, trace2.now) as HistoryView;
		assert.ok(view.segments.some((s) => s.brief === true), "the skipped read's boundary is brief");
		const outageFrom = view.segments.find((s) => s.endReason === "unavailable")?.x1 as number;
		const outageTo = view.segments[view.segments.findIndex((s) => s.endReason === "unavailable") + 1]?.x0 as number;
		for (const mode of [undefined, "mark"]) {
			const polygons = sceneOf(trace2, tracePane(trace2, "area", mode)).prims.filter((p): p is AreaPrim => p.k === "area");
			assert.ok(polygons.length > 0);
			for (const p of polygons) {
				const x0 = p.pts[0] as number;
				const x1 = p.pts[p.pts.length - 2] as number;
				assert.ok(x1 <= outageFrom + 12 || x0 >= outageTo - 12, `${String(mode)}: a polygon ${x0}..${x1} crosses the outage ${outageFrom}..${outageTo}`);
			}
		}
	});
});

describe("Tiles", () => {
	const labels2 = (i: number): string => `Core ${i} T0 Usage`;
	const usage = (i: number, at: number): number => 40 + 30 * Math.sin(at / 9000 + i);
	const skeinLines = (scene: LogicalScene): number => skeinsOf(scene).filter((s) => s.id.startsWith("tl")).reduce((sum, s) => sum + s.lines.length, 0);

	for (const n of [2, 16, 32]) {
		const trace = traced(1, { n, unit: "%", pool: "group", value: usage, ...(n === 2 ? { label: labels2 } : {}) });
		it(`${n} readings: one line per tile on Connect, two on Leave gaps`, () => {
			assert.equal(skeinLines(sceneOf(trace, traceGroup(trace, "tiles", undefined))), n);
			assert.equal(skeinLines(sceneOf(trace, traceGroup(trace, "tiles", "gaps"))), 2 * n);
		});
		it(`${n} readings: Connect in color adds one mark per tile on top of Connect's lines`, () => {
			const scene = sceneOf(trace, traceGroup(trace, "tiles", "mark"));
			assert.equal(skeinLines(scene), n);
			const marks = skeinsOf(scene).filter((s) => s.id.startsWith("tm"));
			assert.ok(marks.length >= 1, "a path of marks");
			assert.equal(marks.reduce((sum, s) => sum + s.lines.length, 0), n);
			for (const skein of marks) {
				assert.equal(skein.passes.length, 1, "no glow pass");
				for (const line of skein.lines) assert.equal(line.length, 4, "one short stroke");
				assert.doesNotMatch(skein.attrs, /url\(/, "not the ramp");
				assert.doesNotMatch(skein.attrs, /dasharray/);
			}
		});
	}

	it("a stack of one height draws its marks as one path, whatever the tile count", () => {
		const trace = traced(2, { n: 32, unit: "%", pool: "group", value: usage });
		const marks = skeinsOf(sceneOf(trace, traceGroup(trace, "tiles", "mark"))).filter((s) => s.id.startsWith("tm"));
		assert.equal(marks.length, 1, "16 cores of two threads: one stack height");
		assert.equal(marks[0]?.lines.length, 64);
	});

	it("the mark's ink is the fixed ink farther in L* from the ramp's middle, never an alert color", () => {
		const trace = traced(1, { n: 2, unit: "%", pool: "group", value: usage, label: labels2 });
		const { input } = traceFrame(trace, traceGroup(trace, "tiles", "mark"), { theme: "graphite" });
		const skein = skeinsOf(buildStripScene(input)).find((s) => s.id.startsWith("tm"));
		const stroke = /stroke="(#[0-9A-Fa-f]{6})"/.exec(skein?.attrs ?? "")?.[1] as string;
		const middle = (TILE_RAMP[1] as { color: string }).color;
		const { value, label } = inksOf();
		assert.ok([value, label].includes(stroke));
		const other = stroke === value ? label : value;
		assert.ok(Math.abs(lightness(stroke) - lightness(middle)) >= Math.abs(lightness(other) - lightness(middle)));
		assert.ok(!Object.values(input.alertColors).includes(stroke));
	});
});

describe("Group 8 lines on Nebula keep their graph", () => {
	const frame = (trace: Trace, mode: unknown): ReturnType<typeof sliceStrip> => sliceStrip(traceFrame(trace, traceGroup(trace, "auto", mode), { background: "nebula", screens: 6 }).input);

	for (const [window, seconds, boundaries] of [["5m", 300, 4], ["5m", 300, 8], ["5m", 300, 16], ["15m", 900, 4], ["15m", 900, 12], ["15m", 900, 16]] as const) {
		it(`${boundaries} boundaries in ${window}: Connect keeps its graph, its bucket and its size`, () => {
			const clean = frame(pollTrace({ n: 8, window, pool: "group" }), undefined);
			const trace = pollTrace({ n: 8, window, pool: "group", kind: skipsAt(evenly(boundaries, seconds, END)) });
			const drawn = frame(trace, undefined);
			assert.equal(drawn.reduced === true, false, "no values-only frame");
			assert.equal(drawn.bucketPx, clean.bucketPx);
			assert.ok(drawn.maxBytes <= clean.maxBytes + 200, `max ${drawn.maxBytes} B against ${clean.maxBytes} B with no boundary`);
		});
	}

	// Each mark is a path of its own, about 95 B, so eight lines cost 760 B at
	// every boundary: Connect in color spends its room sooner than Leave gaps
	// does (9 boundaries in 5 minutes, 4 in 15 minutes, MEASURED), and past
	// that the ladder's values-only frame stands in, as it does for Leave gaps.
	for (const [window, seconds, boundaries] of [["5m", 300, 4], ["5m", 300, 8], ["15m", 900, 3]] as const) {
		it(`${boundaries} boundaries in ${window}: Connect in color keeps its graph at the bucket Leave gaps keeps`, () => {
			const trace = pollTrace({ n: 8, window, pool: "group", kind: skipsAt(evenly(boundaries, seconds, END)) });
			const gaps = frame(trace, "gaps");
			const mark = frame(trace, "mark");
			assert.equal(gaps.reduced === true, false);
			assert.equal(mark.reduced === true, false);
			assert.equal(mark.bucketPx, gaps.bucketPx);
		});
	}
});

describe("Mark's ink on real frames", () => {
	const trace = traced(1, { n: 1 });
	it("Ember and Graphite mark a line in the same white, so an amber theme cannot swallow it", () => {
		const strokes = (["ember", "graphite"] as const).map((theme) => {
			const scene = buildStripScene(traceFrame(trace, tracePane(trace, "trend", "mark"), { theme }).input);
			return marksOf(scene, [...MARK_INKS]).map((m) => m.stroke);
		});
		assert.deepEqual(strokes, [["#FFFFFF"], ["#FFFFFF"]]);
	});
	it("one reading: the overlay strokes in the fixed ink, not the series color, and is 2 px like the line", () => {
		const { input } = traceFrame(trace, tracePane(trace, "trend", "mark"));
		const scene = buildStripScene(input);
		const { value, label } = inksOf();
		const line = linesOf(scene).filter((l) => l.pts.length > 4);
		assert.equal(line.length, 1, "a merged line");
		const marks = marksOf(scene, [value, label]);
		assert.equal(marks.length, 1, "one overlay");
		const color = (line[0] as LinePrim).stroke;
		const mark = marks[0] as LinePrim;
		assert.notEqual(mark.stroke, color);
		assert.equal(mark.width, (line[0] as LinePrim).width);
		const other = mark.stroke === value ? label : value;
		assert.ok(Math.abs(lightness(mark.stroke) - lightness(color)) >= Math.abs(lightness(other) - lightness(color)));
		assert.doesNotMatch(svgOf(scene), /stroke-dasharray/, "solid");
	});
	it("Clear: the line keeps its backing, the mark has none", () => {
		const { input } = traceFrame(trace, tracePane(trace, "trend", "mark"), { background: "clear" });
		const scene = buildStripScene(input);
		const { value, label } = inksOf();
		const marks = marksOf(scene, [value, label]);
		assert.equal(marks.length, 1);
		assert.equal(marks[0]?.backing, undefined);
		assert.ok(linesOf(scene).some((l) => l.pts.length > 4 && l.backing !== undefined));
	});
	it("a mark across a slice seam draws in both slices", () => {
		const seam = END - 300_000 + (300_000 * 400) / 1200;
		const seamed = pollTrace({ n: 1, kind: skipsAt([seam]) });
		const slices = sliceStrip(traceFrame(seamed, tracePane(seamed, "trend", "mark")).input).slices;
		const inked = slices.map((svg) => (svg === null ? 0 : (svg.match(/stroke-width="2"/g) ?? []).length));
		assert.ok((inked[1] as number) >= 2 && (inked[2] as number) >= 2, `strokes per slice: ${inked.join(",")}`);
	});
});

describe("what never hears about a mode", () => {
	const manyKeys = (draw: string): [Trace, (mode: unknown) => Record<string, unknown>] => {
		const trace = traced(2, { n: 16, unit: "%", pool: "group", value: (i, at) => 40 + 20 * Math.sin(at / 9000 + i) });
		return [trace, (mode) => traceGroup(trace, draw, mode)];
	};
	const twoKeys = (style: string, extra: Record<string, unknown> = {}): [Trace, (mode: unknown) => Record<string, unknown>] => {
		const trace = traced(2, { n: 2, unit: "%", value: (i, at) => 40 + 20 * Math.sin(at / 9000 + i) });
		return [trace, (mode) => tracePane(trace, style, mode, extra)];
	};
	for (const [name, [trace, pane]] of [
		["Heat", twoKeys("heat")],
		["Meters", twoKeys("meters")],
		["Events", twoKeys("events", { bands: [{ key: "f0:0:100", warn: 50, crit: 65, below: false, unit: "%" }] })],
		["Group Rows", manyKeys("rows")],
		["Group Now", manyKeys("now")]
	] as const) {
		it(`${name}: byte-identical in all three modes`, () => {
			const connect = svgOf(sceneOf(trace, pane(undefined)));
			assert.equal(svgOf(sceneOf(trace, pane("mark"))), connect);
			assert.equal(svgOf(sceneOf(trace, pane("gaps"))), connect);
		});
	}
	it("Ambient: byte-identical in all three modes", () => {
		const trace = traced(2, { n: 16, unit: "%", pool: "group", value: (i, at) => 40 + 20 * Math.sin(at / 9000 + i) });
		const pane = (mode: unknown): Record<string, unknown> => ({ style: "ambient", series: [], group: { from: "list", keys: trace.keys, view: "auto" }, ...(mode === undefined ? {} : { gapMode: mode }) });
		const connect = svgOf(sceneOf(trace, pane(undefined)));
		assert.equal(svgOf(sceneOf(trace, pane("mark"))), connect);
		assert.equal(svgOf(sceneOf(trace, pane("gaps"))), connect);
	});

	it("the mode is the strip's: a value stored on a pane is ignored, and every pane of a split draws the strip's", () => {
		const trace = traced(2, { n: 2 });
		const plain = traceFrame(trace, tracePane(trace, "trend", undefined));
		const onPane = stripConfigToJson(plain.config) as { panes: Record<string, unknown>[] };
		onPane.panes = onPane.panes.map((p) => ({ ...p, gapMode: "gaps" }));
		assert.equal(svgOf(buildStripScene({ ...plain.input, config: stripConfigOf(onPane) })), svgOf(buildStripScene(plain.input)));
		const series = tracePane(trace, "trend", undefined).series;
		const split = (mode: unknown): string => {
			const { input, config } = traceFrame(trace, tracePane(trace, "trend", mode), { layout: "split" });
			const json = stripConfigToJson(config) as { panes: Record<string, unknown>[] };
			json.panes = [json.panes[0] as Record<string, unknown>, { ...json.panes[1], style: "lanes", series }];
			return svgOf(buildStripScene({ ...input, config: stripConfigOf(json), panes: [input.panes[0] as (typeof input.panes)[number], input.panes[0] as (typeof input.panes)[number]] }));
		};
		assert.notEqual(split("gaps"), split(undefined));
	});

	it("gaps mode draws exactly what the same history draws with nothing called brief", () => {
		const trace = traced(4, { n: 2 });
		const withoutBrief = {
			...trace,
			store: new Proxy(trace.store, {
				get(target, prop) {
					if (prop !== "view") return Reflect.get(target, prop) as unknown;
					return (...args: Parameters<typeof target.view>) => {
						const view = target.view(...args);
						return view === undefined ? undefined : { ...view, segments: view.segments.map(({ brief: _brief, ...rest }) => (void _brief, rest)) };
					};
				}
			})
		};
		const pane = tracePane(trace, "trend", "gaps");
		assert.equal(svgOf(buildStripScene(traceFrame(trace, pane).input)), svgOf(buildStripScene(traceFrame(withoutBrief, tracePane(trace, "trend", undefined)).input)));
	});

	describe("Inspect", () => {
		const atGap = (trace: Trace, pane: (mode: unknown) => Record<string, unknown>, gapAt: number, mode: unknown): StripSceneInput => {
			const live = traceFrame(trace, pane(mode));
			const paused = (p: 0 | 1): PaneView => ({ mode: "paused", agoMs: trace.now - gapAt, label: "14:02:51", frozenAt: trace.now, window: trace.window, series: live.input.panes[p]?.series ?? live.input.panes[0]?.series ?? [], group: groupFrameOf(live.config.panes[p], trace.status) });
			const view: GroupView = { ...freshView(), panes: [paused(0), paused(1)] };
			return traceFrame(trace, pane(mode), { view }).input;
		};
		const gapAt = END - 150_000;
		const trace = pollTrace({ n: 2, kind: skipsAt([gapAt]) });
		const many = pollTrace({ n: 16, unit: "%", pool: "group", value: (i, at) => 40 + 20 * Math.sin(at / 9000 + i), kind: skipsAt([gapAt]) });

		for (const [name, on, pane] of [
			["Trend", trace, (mode: unknown): Record<string, unknown> => tracePane(trace, "trend", mode, { overlays: { current: true, minmax: true, unit: true, legend: true, time: true } })],
			["Compare", trace, (mode: unknown): Record<string, unknown> => tracePane(trace, "compare", mode)],
			["Lanes", trace, (mode: unknown): Record<string, unknown> => tracePane(trace, "lanes", mode)],
			["Group Spread", many, (mode: unknown): Record<string, unknown> => traceGroup(many, "spread", mode)],
			["Group Tiles", many, (mode: unknown): Record<string, unknown> => traceGroup(many, "tiles", mode)]
		] as const) {
			it(`${name}: every word is identical in all three modes with the cursor in the gap`, () => {
				const connect = textsOf(buildStripScene(atGap(on, pane, gapAt, undefined)).prims);
				assert.ok(connect.length > 2);
				assert.equal(textsOf(buildStripScene(atGap(on, pane, gapAt, "mark")).prims), connect);
				assert.equal(textsOf(buildStripScene(atGap(on, pane, gapAt, "gaps")).prims), connect);
			});
		}

		it("the cursor in the gap reads no data in every mode, over a drawn line or not", () => {
			for (const mode of [undefined, "mark", "gaps"]) {
				const words = textsOf(buildStripScene(atGap(trace, (m) => tracePane(trace, "trend", m), gapAt, mode)).prims);
				assert.match(words, /no data/, String(mode));
			}
		});

		it("live words and every extent are identical across the modes too", () => {
			const connect = textsOf(sceneOf(trace, tracePane(trace, "trend", undefined)).prims);
			for (const mode of ["mark", "gaps"]) assert.equal(textsOf(sceneOf(trace, tracePane(trace, "trend", mode)).prims), connect);
			const view = trace.store.view(trace.keys[0] as string, "5m", 600, trace.now) as HistoryView;
			assert.equal(view.segments.length, 2, "the boundary stays recorded");
			assert.equal(view.segments[0]?.endReason, "skipped");
		});
	});
});

describe("a brief boundary counts as watched, with no setting", () => {
	const KEY_GAP = END - 100_000;
	/** A reading past 80 for 40 s, with `kind` for the ticks inside it. */
	const excursion = (kind: TraceParams["kind"]): Trace => pollTrace({ n: 1, value: (_i, at) => (at >= END - 120_000 && at <= END - 80_000 ? 90 : 50), kind });
	const outage: TraceParams["kind"] = (_tick, at) => (at >= KEY_GAP - 10_000 && at <= KEY_GAP + 10_000 ? "unavailable" : undefined);
	const eventsPane = (t: Trace, gapMode: unknown): Record<string, unknown> => tracePane(t, "events", gapMode, { bands: [{ key: t.keys[0], warn: 80 }] });
	const viewOfTrace = (t: Trace, width = 600): HistoryView => t.store.view(t.keys[0] as string, t.window, width, t.now) as HistoryView;

	describe("observedSpans", () => {
		it("one watched stretch across a brief boundary, and each segment's own edges kept", () => {
			const view = viewOfTrace(excursion(skipsAt([KEY_GAP])));
			const bins = binView(view, 600);
			const spans = observedSpans(view, bins, 600);
			assert.equal(spans.length, 1);
			const parts = spans[0]?.parts ?? [];
			assert.equal(parts.length, 2);
			assert.equal(spans[0]?.j0, parts[0]?.j0, "from where the first segment was watched");
			assert.equal(spans[0]?.j1, 599, "an open segment runs to the newest bucket");
			assert.ok((parts[0]?.j1 as number) < (parts[1]?.j0 as number), "the moment nothing was read stays between them");
		});
		it("an outage still splits it, and so does a skip that runs too long", () => {
			for (const kind of [outage, skipsAt(Array.from({ length: 9 }, (_, i) => KEY_GAP + i * 1007))]) {
				const view = viewOfTrace(excursion(kind));
				const spans = observedSpans(view, binView(view, 600), 600);
				assert.equal(spans.length, 2);
				assert.equal(spans[0]?.parts, undefined);
			}
		});
		it("Inspect still reads the segment under the cursor: each side its own value, and no data in the moment between", () => {
			const view = viewOfTrace(excursion(skipsAt([KEY_GAP])));
			const bins = binView(view, 600);
			const spans = observedSpans(view, bins, 600);
			const parts = spans[0]?.parts ?? [];
			const before = parts[0]?.j1 as number;
			const after = parts[1]?.j0 as number;
			assert.equal(valueAt(bins, spans, before), 90, "the older side keeps its reading");
			assert.equal(valueAt(bins, spans, after), 90);
			assert.equal(valueAt(bins, spans, 10), 50, "well before the boundary too");
			assert.equal(valueAt(bins, spans, 599), 50, "the newest bucket");
			assert.equal(valueAt(bins, spans, before + 1), undefined, "no sample is carried across");
		});
	});

	describe("Events", () => {
		const countOf = (t: Trace): number => {
			const view = viewOfTrace(t);
			const bins = binView(view, 600);
			return eventCount(eventStates({ bins, spans: observedSpans(view, bins, 600) }, 600, (_min, max) => (max >= 80 ? "warn" : null)));
		};
		for (const mode of [undefined, "mark", "gaps"]) {
			it(`${String(mode)}: one excursion across a brief boundary says once`, () => {
				const t = excursion(skipsAt([KEY_GAP]));
				assert.equal(countOf(t), 1);
				assert.match(textsOf(sceneOf(t, eventsPane(t, mode)).prims), /once past 80/);
			});
		}
		it("the words match the same reading with no skip at all", () => {
			const clean = excursion(undefined);
			assert.match(textsOf(sceneOf(clean, eventsPane(clean, undefined)).prims), /once past 80/);
		});
		it("an outage inside it still counts two: nobody was watching", () => {
			const t = excursion(outage);
			assert.equal(countOf(t), 2);
			assert.match(textsOf(sceneOf(t, eventsPane(t, undefined)).prims), /2 times past 80/);
		});
	});

	describe("Ambient", () => {
		const ambientPane = (t: Trace, gapMode?: unknown): Record<string, unknown> => ({ style: "ambient", series: [], group: { from: "list", keys: t.keys, view: "auto" }, ...(gapMode === undefined ? {} : { gapMode }) });
		const ambientTrace = (n: number, window: "1m" | "5m" | "15m", kind?: TraceParams["kind"]): Trace => pollTrace({ n, window, pool: "group", ...(kind === undefined ? {} : { kind }) });
		const seconds = { "1m": 60, "5m": 300, "15m": 900 };
		const trailOf = (t: Trace): ReturnType<typeof ambientTrail> => {
			const view = viewOfTrace(t, 120);
			return ambientTrail(binView(view, 120), 120, "°C", undefined, view);
		};
		it("one trail across a brief boundary, with nothing recorded in the moment between", () => {
			const trail = trailOf(ambientTrace(1, "1m", skipsAt([END - 30_000])));
			assert.equal(trail.runs.length, 1);
			const hole = Array.from({ length: 120 }, (_, j) => j).filter((j) => (trail.run[j] as number) === 0 && !Number.isFinite(trail.norm[j] as number));
			assert.ok(hole.length > 0, "the norm stays empty there");
		});
		it("an outage still cuts it", () => {
			assert.equal(trailOf(ambientTrace(1, "1m", (_tick, at) => (at >= END - 40_000 && at <= END - 20_000 ? "unavailable" : undefined))).runs.length, 2);
		});
		for (const window of ["1m", "5m"] as const) {
			it(`${window}: every reading stays one line through a skip, on every setting`, () => {
				const t = ambientTrace(12, window, skipsAt([END - (seconds[window] * 1000) / 2]));
				for (const mode of [undefined, "mark", "gaps"]) {
					const skein = skeinsOf(sceneOf(t, ambientPane(t, mode)))[0];
					assert.equal(skein?.lines.length, 12, String(mode));
				}
			});
		}
	});

	describe("a stale graph dims its marks with its lines", () => {
		const staleOf = (input: StripSceneInput): StripSceneInput => ({ ...input, panes: input.panes.map((p) => ({ ...p, series: p.series.map((s) => ({ ...s, state: "stale" as const })) })) });
		const many = traced(1, { n: 4, unit: "%", pool: "group", value: (i, at) => 40 + 20 * Math.sin(at / 9000 + i) });
		for (const [name, on, pane] of [
			["Group lines", many, traceGroup(many, "auto", "mark")],
			["the Spread lead line", many, traceGroup(many, "spread", "mark")]
		] as const) {
			it(name, () => {
				const { input } = traceFrame(on, pane);
				const surface = lookOf(input.config, input.palette, input.text).surface;
				const dimmed = MARK_INKS.map((ink) => mixToward(ink, surface, 0.5));
				const shortStrokes = (scene: LogicalScene): string[] => linesOf(scene).filter((l) => l.pts.length === 4 && l.backing === undefined).map((l) => l.stroke);
				assert.ok(shortStrokes(buildStripScene(input)).some((s) => (MARK_INKS as readonly string[]).includes(s)), "live: full ink");
				const stale = shortStrokes(buildStripScene(staleOf(input)));
				assert.ok(stale.some((s) => dimmed.includes(s)), stale.join(","));
				assert.ok(!stale.some((s) => (MARK_INKS as readonly string[]).includes(s)), stale.join(","));
			});
		}
	});
});
