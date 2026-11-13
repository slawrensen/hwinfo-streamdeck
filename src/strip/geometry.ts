/**
 * Touch strip geometry for Strip Display groups. Every number here derives
 * from src/devices.ts: a strip is `encoders` touch segments of
 * TOUCH_SEGMENT (200 x 100) side by side, so a Stream Deck + is 800 x 100
 * and a + XL is 1200 x 100. Key-grid columns never enter this module.
 *
 * Group coordinates ("logical" x) run from 0 at the left edge of the first
 * encoder's segment to `encoders * 200` at the right edge of the last one.
 * A member at encoder column c owns the slice [c * 200, c * 200 + 200).
 *
 * Panes: the whole layout has one pane over the full width; the split
 * layout has two panes that meet at the middle seam, with a 2 px gutter
 * (1 px taken from each side) where neither draws. A pane's plot area is
 * aligned to whole buckets of `bucketPx` in group coordinates, and every
 * bucket width divides 200, so no bucket ever straddles a slice seam.
 */
import { TOUCH_SEGMENT } from "../devices";

/** Width and height of one member's slice, the SDK's per-encoder canvas. */
export const SLICE_W = TOUCH_SEGMENT.width;
export const SLICE_H = TOUCH_SEGMENT.height;

/** The encoder counts a strip group can be designed for (+ and + XL). */
export type StripEncoders = 4 | 6;
export type StripLayout = "whole" | "split";

/** Bucket widths in px. Each divides 200, and each step is twice the last,
 * so the payload fallback can coarsen one step at a time. */
export const BUCKET_LADDER = [1, 2, 4, 8] as const;
export type BucketPx = (typeof BUCKET_LADDER)[number];
export const DEFAULT_BUCKET_PX: BucketPx = 2;

/** Half the split gutter: each pane gives up this many px at the middle. */
export const GUTTER_HALF = 1;

export function isStripEncoders(n: unknown): n is StripEncoders {
	return n === 4 || n === 6;
}

/** The logical width of a strip with this many encoders. */
export function stripWidth(encoders: StripEncoders): number {
	return encoders * SLICE_W;
}

export type PaneExtent = {
	/** Pane edges in group coordinates, gutter excluded: [x0, x1). */
	readonly x0: number;
	readonly x1: number;
};

/** The panes of a layout on a strip of `encoders` segments. */
export function paneExtents(layout: StripLayout, encoders: StripEncoders): readonly PaneExtent[] {
	const width = stripWidth(encoders);
	if (layout === "whole") return [{ x0: 0, x1: width }];
	const mid = width / 2;
	return [
		{ x0: 0, x1: mid - GUTTER_HALF },
		{ x0: mid + GUTTER_HALF, x1: width }
	];
}

export type PanePlot = {
	/** Bucket-aligned plot edges in group coordinates: [x0, x1). */
	readonly x0: number;
	readonly x1: number;
	/** Bucket width in px: a ladder width (BucketPx), heat cells, or a
	 * Group heat row's wider cells (8, 20 or 40 px). Each divides 200. */
	readonly bucketPx: number;
	/** Number of buckets across the plot; the newest bucket ends at x1. */
	readonly buckets: number;
};

/** The bucket-aligned plot area inside a pane: whole buckets only, aligned
 * to multiples of bucketPx in group coordinates. */
export function panePlot(extent: PaneExtent, bucketPx: BucketPx): PanePlot {
	const x0 = Math.ceil(extent.x0 / bucketPx) * bucketPx;
	const x1 = Math.floor(extent.x1 / bucketPx) * bucketPx;
	return { x0, x1, bucketPx, buckets: Math.max(0, (x1 - x0) / bucketPx) };
}

/** Heat strip cells: one time bin per 8 px (divides 200, so no cell
 * straddles a seam), whatever the line bucket width. */
export const HEAT_CELL_PX: BucketPx = 8;

/** The plot a pane of this style draws on: heat bins on its own cell grid,
 * Events on the line bucket grid of its timeline, every other style on the
 * line bucket grid. */
export function plotFor(style: string, extent: PaneExtent, bucketPx: BucketPx): PanePlot {
	if (style === "events") return panePlot(eventsTimeline(extent), bucketPx);
	return panePlot(extent, style === "heat" ? HEAT_CELL_PX : bucketPx);
}

/** Styles that lay out their own pane and never take a Readout (Meters,
 * Events): a stored readout stays saved and is not drawn. */
export function ownsLayout(style: string): boolean {
	return style === "meters" || style === "events";
}

/** An Events pane's timeline: the pane after its first dial slot, which
 * holds the readings' names and states (no text sits on the timeline). */
export function eventsTimeline(extent: PaneExtent): PaneExtent {
	const seam = (Math.floor(extent.x0 / SLICE_W) + 1) * SLICE_W;
	return { x0: Math.min(seam, extent.x1), x1: extent.x1 };
}

/**
 * The part of a pane a large readout takes (src/strip/readout.ts): with
 * "left", the pane's leftmost dial slot, from the pane's left edge to the
 * first slice seam after it, so its text never crosses a seam; with "only",
 * the whole pane. Null without a readout.
 */
export function readoutExtent(readout: string | undefined, extent: PaneExtent): PaneExtent | null {
	if (readout === "only") return extent;
	if (readout !== "left") return null;
	const seam = (Math.floor(extent.x0 / SLICE_W) + 1) * SLICE_W;
	return { x0: extent.x0, x1: Math.min(seam, extent.x1) };
}

/** The part of a pane its graph draws on: the pane, less a left readout's
 * slot; empty (x0 === x1) when the pane shows values only. The graph maps
 * the same window onto whatever width it gets, so a narrower graph never
 * stands for a longer time. */
export function graphExtent(readout: string | undefined, extent: PaneExtent): PaneExtent {
	const slot = readoutExtent(readout, extent);
	if (slot === null) return extent;
	if (readout === "only") return { x0: extent.x1, x1: extent.x1 };
	return { x0: slot.x1, x1: extent.x1 };
}

/** A dial slot's inner margin on a spread pane. */
export const SPREAD_PAD = 8;
/** The narrowest stretch of a cell beside its digits a trend draws in. */
const TREND_BESIDE_MIN = 72;

/** One reading's share of a pane (spreadCells): its cell, and the dial slot
 * inside it that holds its number. */
export type SpreadCell = { readonly x0: number; readonly x1: number; readonly column: number; readonly slotX0: number; readonly slotX1: number };

/**
 * A pane's readings spread across its whole width: `count` equal cells, each
 * with the dial slot that holds most of it for its number, so no number
 * crosses a seam however the cells fall. Among slots a cell holds equally,
 * `prefer` takes its first or its last. A slot not on the page, or one a
 * cell before already took, gives way to the next one the cell reaches; a
 * cell with no slot left keeps its first, and that number does not draw.
 * Stored setup only (the count and which dials are on the page): nothing
 * here moves with a value.
 */
export function spreadCells(extent: PaneExtent, count: number, prefer: "first" | "last", present?: readonly boolean[]): SpreadCell[] {
	const w = (extent.x1 - extent.x0) / count;
	// A cell's edge that lands by a seam is the seam: a split's gutter takes
	// 1 px from a slot, and that slot is still whole.
	const edgeOf = (i: number): number => {
		const x = Math.round(extent.x0 + i * w);
		const seam = Math.round(x / SLICE_W) * SLICE_W;
		return i > 0 && i < count && Math.abs(x - seam) <= 2 * GUTTER_HALF ? seam : x;
	};
	const used = new Set<number>();
	return Array.from({ length: count }, (_, i) => {
		const x0 = edgeOf(i);
		const x1 = edgeOf(i + 1);
		const reach: { column: number; overlap: number }[] = [];
		for (let c = Math.floor(x0 / SLICE_W); c * SLICE_W < x1; c++) reach.push({ column: c, overlap: Math.min(x1, (c + 1) * SLICE_W) - Math.max(x0, c * SLICE_W) });
		if (prefer === "last") reach.reverse();
		// A split's gutter takes 1 px from a slot: that slot still counts as whole.
		reach.sort((a, b) => (Math.abs(a.overlap - b.overlap) <= 2 * GUTTER_HALF ? 0 : b.overlap - a.overlap));
		const free = reach.filter((r) => !used.has(r.column));
		const chosen = (free.find((r) => present?.[r.column] !== false) ?? free[0] ?? reach[0]) as { column: number };
		used.add(chosen.column);
		return { x0, x1, column: chosen.column, slotX0: Math.max(extent.x0, chosen.column * SLICE_W), slotX1: Math.min(extent.x1, (chosen.column + 1) * SLICE_W) };
	});
}

/** The stretch of a cell left beside its number, on the side that has more,
 * when a trend can draw in it. */
export function besideOf(cell: SpreadCell): { readonly x0: number; readonly x1: number } | null {
	const before = cell.slotX0 - cell.x0;
	const after = cell.x1 - cell.slotX1;
	const out = after >= before ? { x0: cell.slotX1 + SPREAD_PAD / 2, x1: cell.x1 - SPREAD_PAD } : { x0: cell.x0 + SPREAD_PAD, x1: cell.slotX0 - SPREAD_PAD / 2 };
	return out.x1 - out.x0 >= TREND_BESIDE_MIN ? out : null;
}

/** Where a trend under a number runs: from the number's dial slot to the next
 * number's, so each line starts under its own number and a slot that holds no
 * number goes to the line before it. */
export function underOf(cells: readonly SpreadCell[], i: number): { readonly x0: number; readonly x1: number } {
	const cell = cells[i] as SpreadCell;
	return { x0: cell.slotX0 + SPREAD_PAD, x1: Math.max(cells[i + 1]?.slotX0 ?? cell.x1, cell.slotX1) - SPREAD_PAD };
}

/** Bucket count of the trends of a values-only pane of `count` readings: its
 * widest trend's width in `bucketPx` buckets, beside the number where the
 * cell leaves room, else under it. */
export function onlyTrendBuckets(extent: PaneExtent, count: number, bucketPx: BucketPx): number {
	const slots = Math.ceil(extent.x1 / SLICE_W) - Math.floor(extent.x0 / SLICE_W);
	const n = Math.max(1, count);
	if (n > slots) return Math.floor((SLICE_W - 2 * SPREAD_PAD) / bucketPx);
	const cells = spreadCells(extent, n, "first");
	const besideAll = cells.every((cell) => besideOf(cell) !== null);
	const width = Math.max(...cells.map((cell, i) => {
		const room = (besideAll ? besideOf(cell) : null) ?? underOf(cells, i);
		return room.x1 - room.x0;
	}));
	return Math.max(1, Math.floor(width / bucketPx));
}

/** The plot a pane draws on, readout included (plotFor over graphExtent). */
export function panePlotOf(pane: { readonly style: string; readonly readout?: string }, extent: PaneExtent, bucketPx: BucketPx): PanePlot {
	return plotFor(pane.style, graphExtent(ownsLayout(pane.style) ? undefined : pane.readout, extent), bucketPx);
}

/** The band Lanes share, top to bottom; the bottom row draws over the last
 * lane. One definition for the scene, which draws the lanes, and input
 * routing, which maps a tap to the lane under it. */
export const LANES_TOP = 3;
export const LANES_BOTTOM = 95;

/** One lane's height when `lanes` lanes share the band. */
export function laneHeight(lanes: number): number {
	return Math.floor((LANES_BOTTOM - LANES_TOP) / Math.max(1, lanes));
}

/** The lane drawn under y: lane i covers [LANES_TOP + i * h, LANES_TOP +
 * (i + 1) * h). Above the first lane is the first lane; below the last
 * (the bottom row) is the last. */
export function laneAtY(lanes: number, y: number): number {
	const h = laneHeight(lanes);
	return Math.min(lanes - 1, Math.max(0, Math.floor((y - LANES_TOP) / h)));
}

/** The pane an encoder column belongs to. Split halves meet at a seam, so a
 * column belongs to exactly one pane. */
export function paneOfColumn(layout: StripLayout, encoders: StripEncoders, column: number): 0 | 1 {
	return layout === "whole" ? 0 : column < encoders / 2 ? 0 : 1;
}

/** The pane that owns a group x coordinate. The split boundary is the middle
 * seam, so this always agrees with paneOfColumn for the tapped column. */
export function paneOfGroupX(layout: StripLayout, encoders: StripEncoders, groupX: number): 0 | 1 {
	return layout === "whole" ? 0 : groupX < stripWidth(encoders) / 2 ? 0 : 1;
}

/** A cursor `back` buckets from the newest on `plot`, as the time it marks:
 * ms before the newest bucket's end. Input routing counts buckets at the
 * width the user saw; the scene takes this time, so a change of bucket
 * width between frames never moves the cursor. */
export function cursorAgoMs(plot: PanePlot, windowMs: number, back: number): number {
	if (plot.buckets === 0 || !Number.isFinite(back)) return 0;
	return (Math.max(0, Math.floor(back)) * windowMs) / plot.buckets;
}

/** The bucket (counted back from the newest) that holds the time `agoMs`
 * before the newest bucket's end, clamped to the plot. */
export function cursorBucketsBack(plot: PanePlot, windowMs: number, agoMs: number): number {
	if (plot.buckets === 0 || !(windowMs > 0) || !Number.isFinite(agoMs)) return 0;
	// A hair of tolerance: an agoMs made by cursorAgoMs lands on its own
	// bucket's edge, which floating point may put a hair short of it.
	const back = Math.floor((agoMs * plot.buckets) / windowMs + 1e-9);
	return Math.min(plot.buckets - 1, Math.max(0, back));
}

/** Buckets back from the newest for a group x inside a plot (0 = newest),
 * clamped to the plot. */
export function bucketsBackAt(plot: PanePlot, groupX: number): number {
	if (plot.buckets === 0) return 0;
	const x = Math.min(plot.x1 - 1, Math.max(plot.x0, groupX));
	return Math.floor((plot.x1 - 1 - x) / plot.bucketPx);
}
