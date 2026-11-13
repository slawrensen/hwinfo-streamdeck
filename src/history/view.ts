/**
 * One frozen view of a series over a window at one instant, downsampled to
 * pixel columns without losing extremes.
 *
 * - x maps the WHOLE window: x = (t - (now - windowMs)) * widthPx / windowMs,
 *   whatever the amount of data. Short history sits on the right; nothing
 *   is stretched to fill the width.
 * - The newest identity (the open segment, else the last closed one) sets
 *   the scale. Older segments in the same unit and type, of the same
 *   measurement or of one the current reading is linked to (a confirmed
 *   source flip), are drawn on that scale with a pen-up between them.
 *   Segments of another unit, type or binding are left out and reported as
 *   `hidden` boundaries; values are never converted or mixed across units.
 * - Each bucket entry lands in the column of its observed midpoint, and
 *   entries of one segment in one column merge: first of the earliest, last
 *   of the latest, min of mins, max of maxes (M4, Jugel et al., PVLDB 2014).
 *   So every column's extremes equal the extremes of the samples behind it,
 *   and an entry wider than a column is emitted once, never replicated.
 * - An entry is in the window when it holds an observation inside
 *   [now - windowMs, now]; one that straddles the left edge lands in
 *   column 0.
 * - A segment's span in this view starts no earlier than the tier did
 *   (a tier is allocated empty when a consumer asks for its window), and
 *   `observedFromX` is where the earliest drawn run, so recorded, began:
 *   null when that lies at or before the window's left edge.
 *
 * The typed arrays are fresh per view (gathered in shared scratch and
 * copied out at their exact count), so later ingests never change a view a
 * paused display is still holding.
 */
import { SensorType } from "../hwinfo/types";
import type { BucketRing, Segment } from "./store";
import type { HistoryColumns, HistoryView, HistoryViewSegment } from "./types";

export interface ViewSource {
	readonly ring: BucketRing;
	readonly windowMs: number;
	readonly open: Segment | null;
	readonly closed: readonly Segment[];
	readonly revision: number;
}

/**
 * Column scratch, reused by every build (a build is synchronous), so a view
 * allocates only its own exact-size copy: one buffer for all six arrays.
 */
const scratch = {
	x: new Float64Array(0),
	first: new Float64Array(0),
	min: new Float64Array(0),
	max: new Float64Array(0),
	last: new Float64Array(0),
	seg: new Uint16Array(0)
};

function reserve(size: number): void {
	if (scratch.x.length >= size) return;
	const n = Math.max(size, scratch.x.length * 2, 64);
	scratch.x = new Float64Array(n);
	scratch.first = new Float64Array(n);
	scratch.min = new Float64Array(n);
	scratch.max = new Float64Array(n);
	scratch.last = new Float64Array(n);
	scratch.seg = new Uint16Array(n);
}

/** The view's own frozen copy of the first n scratch columns: five float64
 * arrays and the segment array over one buffer. */
function columnsOf(n: number): HistoryColumns {
	const f64 = Float64Array.BYTES_PER_ELEMENT;
	const buffer = new ArrayBuffer(n * (5 * f64 + Uint16Array.BYTES_PER_ELEMENT));
	const copy = (from: Float64Array, k: number): Float64Array => {
		const out = new Float64Array(buffer, k * n * f64, n);
		out.set(from.subarray(0, n));
		return out;
	};
	const seg = new Uint16Array(buffer, 5 * n * f64, n);
	seg.set(scratch.seg.subarray(0, n));
	return Object.freeze({ x: copy(scratch.x, 0), first: copy(scratch.first, 1), min: copy(scratch.min, 2), max: copy(scratch.max, 3), last: copy(scratch.last, 4), seg, n });
}

export function buildView(src: ViewSource, widthPx: number, now: number, linkedKeys?: readonly string[]): HistoryView {
	const { ring, windowMs } = src;
	const winStart = now - windowMs;
	const scale = widthPx / windowMs;
	const xOf = (t: number): number => (t - winStart) * scale;
	const known = src.open === null ? src.closed : [...src.closed, src.open];
	const newest = known[known.length - 1];

	const segments: HistoryViewSegment[] = [];
	const hidden: { x: number; reason: "unit" | "type" | "binding" }[] = [];
	/** Stored (16-bit) ordinal to the view's segment index. */
	const included = new Map<number, number>();
	/** When the earliest drawn run began recording in this tier. */
	let began: number | null = null;
	if (newest !== undefined) {
		const sameMeasurement = new Set(linkedKeys ?? []);
		sameMeasurement.add(newest.identity);
		for (const seg of known) {
			const start = Math.max(seg.startAt, ring.createdAt);
			if (seg.lastSampleAt < winStart || seg.lastSampleAt < ring.createdAt || start > now) continue;
			if (seg.unit === newest.unit && seg.type === newest.type && sameMeasurement.has(seg.identity)) {
				included.set(seg.ordinal & 0xffff, segments.length);
				began ??= start;
				segments.push(Object.freeze({
					ordinal: segments.length,
					x0: Math.max(0, xOf(start)),
					x1: Math.min(widthPx, xOf(seg.lastSampleAt)),
					open: seg === src.open,
					source: seg.source,
					...(seg.endReason !== undefined ? { endReason: seg.endReason } : {}),
					...(seg.brief === true ? { brief: true as const } : {})
				}));
			} else {
				hidden.push(Object.freeze({ x: Math.min(widthPx, Math.max(0, xOf(seg.lastSampleAt))), reason: seg.unit !== newest.unit ? "unit" : seg.type !== newest.type ? "type" : "binding" }));
			}
		}
	}

	const size = ring.size;
	reserve(size);
	const { x, first, min, max, last, seg } = scratch;
	let n = 0;
	const { vals, meta, widthMs } = ring;
	for (let i = 0; i < size && included.size > 0; i++) {
		const s = ring.slot(i);
		const word = meta[s * 3 + 1] as number;
		const index = included.get(word >>> 16);
		if (index === undefined) continue;
		const start = (meta[s * 3] as number) * widthMs;
		const offsets = meta[s * 3 + 2] as number;
		const tFirst = start + (offsets >>> 16);
		const tLast = start + (offsets & 0xffff);
		if (tLast < winStart || tFirst > now) continue;
		const col = Math.min(widthPx - 1, Math.max(0, Math.floor(xOf((tFirst + tLast) / 2))));
		const v = s * 4;
		if (n > 0 && x[n - 1] === col && seg[n - 1] === index) {
			const k = n - 1;
			if ((vals[v + 1] as number) < (min[k] as number)) min[k] = vals[v + 1] as number;
			if ((vals[v + 2] as number) > (max[k] as number)) max[k] = vals[v + 2] as number;
			last[k] = vals[v + 3] as number;
			continue;
		}
		x[n] = col;
		first[n] = vals[v] as number;
		min[n] = vals[v + 1] as number;
		max[n] = vals[v + 2] as number;
		last[n] = vals[v + 3] as number;
		seg[n] = index;
		n++;
	}

	let extent: { readonly min: number; readonly max: number } | null = null;
	if (n > 0) {
		let lo = Number.POSITIVE_INFINITY;
		let hi = Number.NEGATIVE_INFINITY;
		for (let k = 0; k < n; k++) {
			lo = Math.min(lo, min[k] as number);
			hi = Math.max(hi, max[k] as number);
		}
		extent = Object.freeze({ min: lo, max: hi });
	}
	const observedFrom = began === null ? 0 : xOf(began);
	return Object.freeze({
		windowMs,
		widthPx,
		now,
		unit: newest?.unit ?? "",
		type: newest?.type ?? SensorType.None,
		cols: columnsOf(n),
		segments: Object.freeze(segments),
		hidden: Object.freeze(hidden),
		extent,
		// Column-aligned, so no column (and nothing drawn) lies left of it.
		observedFromX: observedFrom > 0 ? Math.floor(observedFrom) : null,
		lastSampleAgeMs: newest === undefined ? null : Math.max(0, now - newest.lastSampleAt),
		revision: src.revision
	});
}
