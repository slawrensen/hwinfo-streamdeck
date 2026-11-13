/**
 * The data side of a strip pane: history views binned onto the pane's own
 * bucket grid, value scales, and the line, area, heat and band primitives.
 *
 * Time is truthful: a HistoryView's columns sit at their place in the WHOLE
 * window (x over view.widthPx), so each column lands in the bucket for its
 * time, and short history occupies only the right part of the plot instead
 * of being stretched across it. Buckets keep first/min/max/last, so a peak
 * survives any bucket width. A gap stays a gap, except that a line goes
 * straight on across a boundary the store calls brief (runsOf); that draws
 * no sample, so the bins keep every segment apart and Inspect, the extents
 * and every statistic read them as they are.
 * Values stay in the reading's native unit here; the scale and the bands
 * arrive in display units and are mapped back (°F is the only conversion,
 * and it is affine, so the drawing is identical).
 *
 * Cost. A strip frame comes with every poll and a rule screen bins dozens
 * of readings, so bins are columns of typed arrays, not an object per
 * bucket, and a scene build takes them from a Scratch it reuses frame
 * after frame (a Group frame of 48 readings allocated 1.7 MB of bucket
 * objects and heat cells, and kept V8's young generation at 32 MB).
 */
import type { AlertBand } from "../alerts/types";
import type { HistoryView } from "../history/types";
import type { PanePlot } from "./geometry";
import { snap, type AreaPrim, type Layer, type LinePrim } from "./prims";
import type { StripGapMode } from "./settings";
import { hexToLab } from "../ui/color-difference";
import { convertUnit, valueBetweenUnits } from "../ui/format";

/** One pool of typed arrays, handed out in order (Scratch). */
class Pool<T extends Float64Array | Int32Array> {
	private readonly buffers: (T | undefined)[] = [];
	private readonly views: (T | undefined)[] = [];
	/** The most each place was asked for since the last trim. */
	private readonly wanted: number[] = [];
	next = 0;

	constructor(private readonly make: (n: number) => T) {}

	take(n: number): T {
		const at = this.next++;
		if (n > (this.wanted[at] ?? -1)) this.wanted[at] = n;
		const view = this.views[at];
		if (view !== undefined && view.length === n) return view;
		let buffer = this.buffers[at];
		if (buffer === undefined || buffer.length < n) {
			buffer = this.make(Math.max(n, 2 * (buffer?.length ?? 0)));
			this.buffers[at] = buffer;
		}
		const out = buffer.subarray(0, n) as T;
		this.views[at] = out;
		return out;
	}

	/** Gives back what the builds since the last trim did not need: the
	 * places past the last one they took, and an array more than twice the
	 * most its place was asked for (it grew for a screen no longer on view;
	 * growing doubles, so an array in use is never more than that). The
	 * next take that needs one makes it again. */
	trim(): void {
		const places = this.wanted.length;
		if (this.buffers.length > places) this.buffers.length = places;
		if (this.views.length > places) this.views.length = places;
		for (let at = 0; at < this.buffers.length; at++) {
			const buffer = this.buffers[at];
			if (buffer === undefined || buffer.length <= 2 * (this.wanted[at] as number)) continue;
			this.buffers[at] = undefined;
			this.views[at] = undefined;
		}
		this.wanted.length = 0;
	}
}

/** How many builds a Scratch hands its arrays out to between trims: a
 * minute of one strip at HWiNFO's 2 s poll, so what a screen grew is given
 * back within two minutes of it leaving, and a strip whose screen stays,
 * or two strips taking turns, keep theirs. */
const TRIM_BUILDS = 30;

/**
 * Typed arrays one scene build hands out and the next one reuses (building
 * is synchronous and never re-entrant): binView, heatCells and the Ambient
 * drawings take their working arrays here, so a frame bins and
 * fills them with no garbage once the arrays have grown. reset() at the
 * start of a build hands the same arrays out again, in the same order, so
 * nothing a scene keeps may point into them: its primitives hold plain
 * arrays of their own. Every TRIM_BUILDS builds it gives back what those
 * builds did not need (Pool.trim), so a screen that left does not keep its
 * arrays. A fresh Scratch (the default) is plain allocation.
 */
export class Scratch {
	private readonly floats = new Pool((n) => new Float64Array(n));
	private readonly ints = new Pool((n) => new Int32Array(n));
	private builds = 0;

	reset(): void {
		if (++this.builds % TRIM_BUILDS === 0) {
			this.floats.trim();
			this.ints.trim();
		}
		this.floats.next = 0;
		this.ints.next = 0;
	}

	/** `n` float64 values, as the last build that took this one left them
	 * (zeros after a trim): written before they are read. */
	float64(n: number): Float64Array {
		return this.floats.take(n);
	}

	/** `n` int32 values, as the last build that took this one left them
	 * (zeros after a trim): written before they are read. */
	int32(n: number): Int32Array {
		return this.ints.take(n);
	}
}

/**
 * A view's columns re-binned onto a plot's buckets, in time order: bucket i
 * of `n` is bucket j[i] of the plot, observed in segment seg[i], with its
 * first, lowest, highest and last value. The arrays may be longer than n.
 */
export type Bins = {
	readonly n: number;
	readonly j: Int32Array;
	readonly seg: Int32Array;
	readonly first: Float64Array;
	readonly min: Float64Array;
	readonly max: Float64Array;
	readonly last: Float64Array;
};

/** No buckets: a series with no history, or a plot with no room. */
export const NO_BINS: Bins = { n: 0, j: new Int32Array(0), seg: new Int32Array(0), first: new Float64Array(0), min: new Float64Array(0), max: new Float64Array(0), last: new Float64Array(0) };

/** The two inks a mark chooses from (markInkOf). */
export type MarkInks = readonly [light: string, dark: string];

/** One meaning, one color on every look: white, or mid-gray on a line nearly
 * that light. Not the theme's text colors: Ember's are amber, and an orange
 * line swallows them. Never an alert color. */
export const MARK_INKS: MarkInks = ["#FFFFFF", "#8B93A3"];

/** Consecutive buckets one line goes through: bins from..to-1. `seg` is the
 * newest segment among them. `marks` lists each brief boundary's first bin
 * on a graph that marks them, and `inks` what those marks may take. */
export type Run = { readonly bins: Bins; readonly seg: number; readonly from: number; readonly to: number; readonly marks?: readonly number[]; readonly inks?: MarkInks };

/** Re-bins a view's columns into `buckets` equal time bins across the
 * whole window. Non-finite columns are skipped, never drawn as zero. */
export function binView(view: HistoryView, buckets: number, scratch = new Scratch()): Bins {
	const width = view.widthPx > 0 ? view.widthPx : 1;
	const cols = view.cols;
	// A column starts at most one bucket.
	const out = { j: scratch.int32(cols.n), seg: scratch.int32(cols.n), first: scratch.float64(cols.n), min: scratch.float64(cols.n), max: scratch.float64(cols.n), last: scratch.float64(cols.n) };
	let n = 0;
	for (let i = 0; i < cols.n; i++) {
		const first = cols.first[i] as number;
		const min = cols.min[i] as number;
		const max = cols.max[i] as number;
		const last = cols.last[i] as number;
		if (!Number.isFinite(first) || !Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(last)) continue;
		const x = cols.x[i] as number;
		const j = Math.min(buckets - 1, Math.max(0, Math.floor(((x + 0.5) / width) * buckets)));
		const seg = cols.seg[i] as number;
		if (n > 0 && out.j[n - 1] === j && out.seg[n - 1] === seg) {
			out.min[n - 1] = Math.min(out.min[n - 1] as number, min);
			out.max[n - 1] = Math.max(out.max[n - 1] as number, max);
			out.last[n - 1] = last;
		} else {
			out.j[n] = j;
			out.seg[n] = seg;
			out.first[n] = first;
			out.min[n] = min;
			out.max[n] = max;
			out.last[n] = last;
			n++;
		}
	}
	return { n, ...out };
}

/**
 * Consecutive buckets of one segment. A new segment starts a run, except
 * that with `view` a brief one (HistoryViewSegment.brief) goes on with the
 * segment right before it, when that one has bins here too: there is nothing
 * new to draw, so every line, fill and tile inherits it, in fewer bytes than
 * a run of its own. With `inks` such a boundary is also listed as a mark.
 */
export function runsOf(bins: Bins, view?: HistoryView, inks?: MarkInks): Run[] {
	const runs: Run[] = [];
	let from = 0;
	for (let i = 1; i <= bins.n; i++) {
		if (i < bins.n && bins.seg[i] === bins.seg[i - 1]) continue;
		const seg = bins.seg[from] as number;
		const previous = runs[runs.length - 1];
		if (previous !== undefined && previous.seg + 1 === seg && view?.segments[seg]?.brief === true) {
			runs[runs.length - 1] = { ...previous, seg, to: i, ...(inks === undefined ? {} : { marks: [...(previous.marks ?? []), from], inks }) };
		} else {
			runs.push({ bins, seg, from, to: i });
		}
		from = i;
	}
	return runs;
}

/** A reading's line runs, as the strip's Brief gaps setting (StripConfigV1.gapMode) draws them. */
export function lineRunsOf(bins: Bins, view: HistoryView | undefined, gapMode: StripGapMode | undefined): Run[] {
	if (gapMode === "gaps") return runsOf(bins);
	return runsOf(bins, view, gapMode === "mark" ? MARK_INKS : undefined);
}

/**
 * The ink a mark takes on a line of `color`: whichever is farther from it in
 * CIE L*. At 5 minutes a missed read is about 8 px of 2 px line, too small to
 * read by hue and too short for a dash, so lightness has to carry it.
 */
export function markInkOf(color: string, inks: MarkInks): string {
	const l = hexToLab(color)[0];
	return Math.abs(hexToLab(inks[1])[0] - l) > Math.abs(hexToLab(inks[0])[0] - l) ? inks[1] : inks[0];
}

export type Extent = { lo: number; hi: number };

export function extentOf(bins: Bins): Extent | null {
	if (bins.n === 0) return null;
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < bins.n; i++) {
		lo = Math.min(lo, bins.min[i] as number);
		hi = Math.max(hi, bins.max[i] as number);
	}
	return { lo, hi };
}

export function unionExtent(extents: readonly (Extent | null)[]): Extent | null {
	let out: Extent | null = null;
	for (const e of extents) {
		if (e === null) continue;
		out = out === null ? { ...e } : { lo: Math.min(out.lo, e.lo), hi: Math.max(out.hi, e.hi) };
	}
	return out;
}

/**
 * The unit a reading draws in: its history's, whose values are in it (the
 * newest segment's identity), once the history holds a segment; else the
 * reading's own. A view with nothing in it yet (the first frames after a
 * strip appears, or the plugin starts) has no unit, "", and drawing by it
 * printed a 14.4 GB reading as "14.4k" with no unit (issue #59 side
 * defect: the panel's strip preview).
 */
export function drawnUnitOf(s: { readonly unit: string; readonly history?: Pick<HistoryView, "unit" | "segments"> }): string {
	return s.history !== undefined && s.history.segments.length > 0 ? s.history.unit : s.unit;
}

/** Display value back to the native unit (the inverse of convertUnit). */
export function toNative(value: number, unit: string, fahrenheit: boolean): number {
	if (!fahrenheit) return value;
	return valueBetweenUnits(value, convertUnit(0, unit, true).unit, unit) ?? value;
}

/** The scale a plot maps: manual ends (display units) win; otherwise the
 * window's own extent. A flat series gets a symmetric span so it draws
 * mid-plot instead of on an edge. */
export function scaleOf(extent: Extent | null, manual: { min?: number; max?: number }, unit: string, fahrenheit: boolean): Extent | null {
	const lo = manual.min !== undefined ? toNative(manual.min, unit, fahrenheit) : extent?.lo;
	const hi = manual.max !== undefined ? toNative(manual.max, unit, fahrenheit) : extent?.hi;
	if (lo === undefined || hi === undefined) return null;
	if (hi > lo) return { lo, hi };
	const pad = Math.max(Math.abs(lo) * 0.05, 0.5);
	return manual.min !== undefined && manual.max === undefined ? { lo, hi: lo + 2 * pad } : manual.max !== undefined && manual.min === undefined ? { lo: hi - 2 * pad, hi } : { lo: lo - pad, hi: hi + pad };
}

export type YMap = { readonly lo: number; readonly hi: number; readonly top: number; readonly bottom: number };

/** A value's y, clamped to the plot band and snapped to the half pixel. */
export function yOf(map: YMap, value: number): number {
	const t = (value - map.lo) / (map.hi - map.lo);
	const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0.5));
	return snap(map.bottom - clamped * (map.bottom - map.top));
}

/** Center x of bucket j on a plot. */
export function bucketX(plot: PanePlot, j: number): number {
	return plot.x0 + j * plot.bucketPx + plot.bucketPx / 2;
}

/** A run as polyline points: one point for a flat bucket, two for a bucket
 * with range (its min and max, ordered by its direction), so a spike keeps
 * its full height at any bucket width. */
export function runPoints(run: Run, plot: PanePlot, map: YMap): number[] {
	const pts: number[] = [];
	const bins = run.bins;
	for (let i = run.from; i < run.to; i++) {
		const x = snap(bucketX(plot, bins.j[i] as number));
		const lo = yOf(map, bins.min[i] as number);
		const hi = yOf(map, bins.max[i] as number);
		if (lo === hi) {
			pts.push(x, lo);
		} else if ((bins.first[i] as number) <= (bins.last[i] as number)) {
			pts.push(x, lo, x, hi);
		} else {
			pts.push(x, hi, x, lo);
		}
	}
	return pts;
}

/** A mark's two ends on a line through runPoints: the last vertex of the
 * bucket before the boundary, and the first of the bucket after it. */
export function markPoints(run: Run, at: number, plot: PanePlot, map: YMap): number[] {
	const bins = run.bins;
	const before = at - 1;
	const leaves = (bins.first[before] as number) <= (bins.last[before] as number) ? bins.max[before] : bins.min[before];
	const enters = (bins.first[at] as number) <= (bins.last[at] as number) ? bins.min[at] : bins.max[at];
	return [snap(bucketX(plot, bins.j[before] as number)), yOf(map, leaves as number), snap(bucketX(plot, bins.j[at] as number)), yOf(map, enters as number)];
}

export function linePrims(runs: readonly Run[], plot: PanePlot, map: YMap, stroke: string, width: number, layer: Layer, backing?: { stroke: string; width: number }, dimMark?: (ink: string) => string): LinePrim[] {
	const out: LinePrim[] = [];
	for (const run of runs) {
		const pts = runPoints(run, plot, map);
		// A lone point still draws: a round-capped zero-length step.
		const drawn = pts.length === 2 ? [pts[0] as number, pts[1] as number, pts[0] as number, pts[1] as number] : pts;
		out.push({ k: "line", layer, pts: drawn, stroke, width, ...(backing === undefined ? {} : { backing }) });
		if (run.marks !== undefined && run.inks !== undefined) {
			const chosen = markInkOf(stroke, run.inks);
			const ink = dimMark === undefined ? chosen : dimMark(chosen);
			for (const at of run.marks) out.push({ k: "line", layer, pts: markPoints(run, at, plot, map), stroke: ink, width });
		}
	}
	return out;
}

export function areaPrims(runs: readonly Run[], plot: PanePlot, map: YMap, paint: string): AreaPrim[] {
	const out: AreaPrim[] = [];
	for (const run of runs) {
		const pts = runPoints(run, plot, map);
		if (pts.length < 4) continue;
		out.push({ k: "area", layer: "base", pts, base: map.bottom, paint });
	}
	return out;
}

/** The buckets one watched stretch runs over, both ends included. A brief
 * boundary does not end a stretch: `seg` is then its newest segment, and
 * `parts` holds each segment's own buckets for whatever reads a value. */
export type Span = { readonly seg: number; readonly j0: number; readonly j1: number; readonly parts?: readonly Span[] };

/**
 * Where each drawn segment was being observed, in buckets: from its first
 * to its last observation (the view's own segment edges widen this when a
 * column sits inside them). An open segment is still receiving samples, so
 * it runs through the newest bucket; a closed one ends at its last sample.
 * A bucket outside every span is a gap, or lies before history began. A brief
 * boundary (HistoryViewSegment.brief) counts as watched on every setting, so
 * one event across it stays one event; an outage still splits the stretch.
 */
export function observedSpans(view: HistoryView | undefined, bins: Bins, buckets: number): Span[] {
	const width = view !== undefined && view.widthPx > 0 ? view.widthPx : 1;
	const out: Span[] = [];
	for (const run of runsOf(bins)) {
		let j0 = bins.j[run.from] as number;
		let j1 = bins.j[run.to - 1] as number;
		const seg = view?.segments.find((s) => s.ordinal === run.seg);
		if (seg !== undefined) {
			j0 = Math.min(j0, Math.max(0, Math.floor((seg.x0 / width) * buckets)));
			j1 = Math.max(j1, seg.open ? buckets - 1 : Math.min(buckets - 1, Math.ceil((seg.x1 / width) * buckets) - 1));
		}
		const own: Span = { seg: run.seg, j0, j1 };
		const previous = out[out.length - 1];
		if (previous !== undefined && previous.seg + 1 === run.seg && seg?.brief === true) {
			out[out.length - 1] = { seg: run.seg, j0: previous.j0, j1: Math.max(previous.j1, j1), parts: [...(previous.parts ?? [previous]), own] };
		} else {
			out.push(own);
		}
	}
	return out;
}

/**
 * The reading at bucket j (the inspect cursor's, or the newest bucket's):
 * the last value at or before j of the segment observed at j. Inside a gap,
 * or before history began, there is none, so the pane says "no data"
 * instead of carrying the value from before the gap across it. That holds in
 * a brief gap too: it counts as watched, but nothing was read there.
 */
export function valueAt(bins: Bins, spans: readonly Span[], j: number): number | undefined {
	const stretch = spans.find((s) => s.j0 <= j && j <= s.j1);
	const span = stretch?.parts === undefined ? stretch : stretch.parts.find((s) => s.j0 <= j && j <= s.j1);
	if (span === undefined) return undefined;
	let found: number | undefined;
	for (let i = 0; i < bins.n; i++) {
		if ((bins.j[i] as number) > j) break;
		if (bins.seg[i] === span.seg) found = bins.last[i] as number;
	}
	return found;
}

/**
 * Heat cells: one value per cell (the cell's maximum, so a peak is never
 * averaged away), NaN where nothing was observed (a value is always
 * finite). A cell inside an observed segment that no sample happened to
 * land in holds the segment's previous value, because the reading was being
 * watched the whole time; outside every segment (a gap, or before history
 * began) the cell is missing. With `pick` "min", each cell takes its
 * minimum instead (a reading where lower is worse, so a dip is never
 * averaged away either).
 */
export function heatCells(view: HistoryView, cells: number, pick: "max" | "min" = "max", scratch = new Scratch()): Float64Array {
	const out = scratch.float64(cells).fill(Number.NaN);
	const width = view.widthPx > 0 ? view.widthPx : 1;
	const owner = scratch.int32(cells).fill(-1);
	for (const seg of view.segments) {
		const c0 = Math.max(0, Math.floor((seg.x0 / width) * cells));
		const c1 = Math.min(cells - 1, Math.max(c0, Math.ceil((seg.x1 / width) * cells) - 1));
		for (let c = c0; c <= c1; c++) owner[c] = seg.ordinal;
	}
	const bins = binView(view, cells, scratch);
	for (let i = 0; i < bins.n; i++) {
		const j = bins.j[i] as number;
		const prev = out[j] as number;
		out[j] = pick === "min" ? (Number.isNaN(prev) ? (bins.min[i] as number) : Math.min(prev, bins.min[i] as number)) : Number.isNaN(prev) ? (bins.max[i] as number) : Math.max(prev, bins.max[i] as number);
		if (owner[j] === -1) owner[j] = bins.seg[i] as number;
	}
	let held = Number.NaN;
	let heldSeg = -1;
	for (let c = 0; c < cells; c++) {
		const seg = owner[c] as number;
		const value = out[c] as number;
		if (!Number.isNaN(value)) {
			held = value;
			heldSeg = seg;
		} else if (seg !== -1 && seg === heldSeg && !Number.isNaN(held)) {
			out[c] = held;
		}
	}
	return out;
}

/** A heat cell's value; undefined where nothing was observed. */
export function cellAt(cells: Float64Array, c: number): number | undefined {
	const v = cells[c];
	return v === undefined || Number.isNaN(v) ? undefined : v;
}

/** The lowest and highest heat cell, or null when no cell was observed. */
export function cellsExtent(cells: Float64Array): Extent | null {
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	let seen = false;
	for (let c = 0; c < cells.length; c++) {
		const v = cells[c] as number;
		if (Number.isNaN(v)) continue;
		lo = Math.min(lo, v);
		hi = Math.max(hi, v);
		seen = true;
	}
	return seen ? { lo, hi } : null;
}

/** Whether a reading's bands open upward (higher is worse): any band of it
 * that runs to +Infinity says so, any that runs from -Infinity says the
 * opposite; a lone finite band reads as upward. */
export function bandsOpenUpward(bands: readonly AlertBand[], readingKey: string): boolean {
	const own = bands.filter((b) => b.readingKey === readingKey);
	if (own.some((b) => b.to === Number.POSITIVE_INFINITY)) return true;
	return !own.some((b) => b.from === Number.NEGATIVE_INFINITY);
}

/** A band's vertical extent on a plot, or null when it lies outside the
 * scale. `edge` is the y of the limit that faces normal readings. */
export function bandSpan(band: AlertBand, map: YMap, unit: string, fahrenheit: boolean, upward: boolean): { top: number; bottom: number; edge: number } | null {
	const from = Number.isFinite(band.from) ? toNative(band.from, unit, fahrenheit) : band.from;
	const to = Number.isFinite(band.to) ? toNative(band.to, unit, fahrenheit) : band.to;
	if (!(to > map.lo) || !(from < map.hi)) return null;
	const top = yOf(map, Math.min(to, map.hi));
	const bottom = yOf(map, Math.max(from, map.lo));
	if (!(bottom > top)) return null;
	return { top, bottom, edge: upward ? bottom : top };
}
