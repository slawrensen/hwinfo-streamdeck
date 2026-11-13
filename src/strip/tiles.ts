/**
 * The Group style's Tiles view: one small history graph per reading, the
 * way Task Manager draws a processor's logical processors. Every tile spans
 * the pane's whole window, newest at its right edge, and fills up from its
 * bottom: a line through the buckets graph.ts draws for every line graph
 * (runPoints: a bucket that moved draws its lowest and highest sample, so a
 * spike keeps its height at any width), a see-through fill under it, on a
 * faint tile with a thin border, rounded corners and a faint mid-scale line.
 * Every tile shares one value scale (the Group's held scale, so 0 to 100 for
 * a percentage) and one fixed color ramp by height, cool blue at the floor
 * through teal and gold to peach at the top: a color always means the same
 * level, in every tile.
 *
 * The layout comes from the readings' labels and count, never their values,
 * so nothing reflows as the values move (tileShapeOf, tilesOf):
 * - Labels that parse as per-thread readings ("Core 3 T1 Usage", HWiNFO's
 *   "P-core 0 T0 ..." and "E-core 8 T0 ...") take a column per physical
 *   core in core order, its threads stacked (T0 over T1); a core with one
 *   thread takes one full-height tile. Blocks: the P-cores apart from the
 *   E-cores when both are listed, else a wider gap every 8 cores from 12
 *   cores (Rows marks blocks of 8 the same way). No other sensor decides a
 *   block.
 * - Readings that do not parse take one tile each: an even grid (one row up
 *   to TILES_ROW_MAX readings, two rows past that), or a block after the
 *   cores when some readings parse.
 * - The columns divide the pane's whole width (there is no readout slot):
 *   16 cores take 70 px each on a + XL, 8 cores about 145, and a split half
 *   shrinks them.
 *
 * Words go through the strip's row words and their edge (scene.ts
 * ROWS_FILTER), in slots fixed by the geometry alone: the core number as
 * HWiNFO prints it (Names) small and dim at the top left of every tile of
 * a core's column (Core 5 is 5 over 5, the top tile T0), or on each tile
 * of a reading that names no core its name, shortened to fit, one rung of
 * the shortened forms for every such tile (the longest all of them hold)
 * when one fits them all, otherwise each tile its own; the value
 * (Current value) at the top right of a tile. A core column's tile prints
 * its value only when it is highlighted, past a limit or inspected; a tile
 * that names its reading always does. Either way the value has its slot,
 * sized for the widest text the reading prints anywhere on the scale, not
 * only at its ends (valueForms: 9.997 prints 10.00 on a 0 to 30 scale, 44.4k
 * is wider than 150k, and Segoe UI draws a bold 4 wider than its other
 * digits). A narrower column keeps the value alone,
 * centered and smaller, or on a core column the number at home and the
 * value in its place when asked for; narrower still, only the number.
 * A value slot a seam would cut moves to the nearest place in its tile
 * clear of it (beside the name by 6 px, else 3), else reaches 3 px into
 * the gap past the tile, else sits beside the seam with only its ink
 * (every value it can print) inside 3 px of the tile. The name and the
 * value are chosen together: where no place holds both, the value takes
 * the small size, then the name goes; a value goes only from a tile with
 * no room for it at the small size. A core number that loses its place
 * beside the value keeps the tile until the value prints. A core column's
 * later tiles keep the first one's value side of a seam and its size. No
 * word straddles a seam or reaches more than 3 px past its own tile, every
 * word keeps 3 px from the others, and where a word goes depends on the
 * tile, the labels, the seams and the widest text the held scale prints,
 * never on a value within that scale, and never on whether a value shows (a
 * word can move once, when the held scale steps up).
 * The bottom row (window, a highlighted thread's label, notes, the unit when
 * it is not %, LIVE or PAUSED) is the Group's own (groupBottomRow), drawn
 * over the bottom tiles, so a stack of four, whose bottom tile would reach
 * it, takes smaller words higher in its tiles (baselineOf).
 *
 * Bytes: the lines and fills go through the slicer's ladder like every
 * graph (tileBucketPx), their points on whole pixels and without the inner
 * points of a straight run (straight); a tile's frame and fill start from
 * the one before (prims.ts writeMove), the mid-scale lines are 1 px
 * strokes (CellsPrim.hair), and the words write what they share once
 * (prims.ts WordsPrim).
 *
 * Marks: the highlighted reading's tile takes a border and a small tab in
 * the highlight color (its line keeps the ramp); with nothing highlighted
 * nothing marks a lead. Inspecting, one cursor marks the same moment in
 * every tile and the values read there. No limit draws as a line, so every
 * number stays clear: a tile whose value is past a limit carries a bar along
 * its bottom, 3 px for warn and 6 for crit (Rows' bar widths), so no alert
 * rests on color alone, and a 1 px outline in the alert color: its own frame
 * with the alert's stroke, so a tile past a limit writes no second box. A
 * highlighted tile past a limit keeps both: the outline takes the alert color, the
 * highlight keeps its tab and its value's color. With limits set the values
 * keep the rows' own color, as Rows' words do, so no word reads as an alert.
 * A reading HWiNFO no longer lists is an empty dashed tile.
 */
import { faceFont } from "../ui/face-font";
import { inkEdges, inkSpan, type InkSpan } from "../ui/format";
import { formatMeasurement, type MeasureOptions, type Measurement } from "../ui/measure";
import { luminance, mixToward } from "../ui/text-colors";
import { SLICE_W, type PaneExtent, type PanePlot } from "./geometry";
import { bucketX, MARK_INKS, markInkOf, markPoints, runPoints, type YMap } from "./graph";
import { snap, type AreasPrim, type CellsPrim, type SkeinPrim, type Word, type WordsPrim } from "./prims";
import { nameRungs } from "./readout";
import type { GroupPaneInfo, PaneFrame, SceneBuilder, SeriesDraw } from "./scene";
import type { StripPaneV1 } from "./settings";

// ---- labels ------------------------------------------------------------------

/** One per-thread reading's place, from its label. */
export type ThreadLabel = { readonly kind: "core" | "p" | "e" | "lpe"; readonly core: number; readonly thread: number };

/** "Core 3 T1 ...", and HWiNFO's hybrid forms "P-core 0 T0 ...", "E-core 8
 * T0 ..." and "LP E-core 20 T0 ...". */
const THREAD_LABEL = /^(?:(p|e|lp[- ]?e)[- ]?)?core\s+(\d{1,4})\s+t(\d{1,2})(?=\s|$)/i;

/** The core and thread a label names, or undefined when it names none
 * ("Total CPU Usage", "Max CPU/Thread Usage", "Core 3 Clock (perf #2)"). */
export function threadOf(label: string): ThreadLabel | undefined {
	const m = THREAD_LABEL.exec(label.trim());
	if (m === null) return undefined;
	const prefix = (m[1] ?? "").toLowerCase().replace(/[- ]/g, "");
	const kind = prefix === "" ? "core" : prefix === "p" ? "p" : prefix === "e" ? "e" : "lpe";
	return { kind, core: Number(m[2]), thread: Number(m[3]) };
}

/** The words of a per-thread label that say which thread it is, as HWiNFO
 * prints them ("Core 5 T1", "P-core 0 T0", "LP E-core 20 T0"), or undefined. */
export function threadPlaceOf(label: string): string | undefined {
	return THREAD_LABEL.exec(label.trim())?.[0];
}

const KIND_ORDER: Readonly<Record<ThreadLabel["kind"], number>> = { core: 0, p: 1, e: 2, lpe: 3 };
/** The most threads one core's column stacks; any more take tiles of
 * their own after the cores. */
const THREADS_MAX = 4;
/** An even grid keeps one row up to this many readings, two past it. */
export const TILES_ROW_MAX = 8;

/** Where a Tiles pane's readings go: its columns left to right, each a
 * stack of slots top to bottom (a reading's index in the Group's order, or
 * -1 for an empty slot), the core each column stands for (null where each
 * tile names its own reading) and how many columns each block holds. */
export type TileShape = {
	readonly columns: readonly (readonly number[])[];
	readonly cores: readonly (number | null)[];
	readonly grid: readonly number[];
};

function gridOf(blocks: readonly number[]): number[] {
	const grid: number[] = [];
	blocks.forEach((block, i) => {
		if (i > 0 && block === blocks[i - 1]) grid[grid.length - 1] = (grid[grid.length - 1] as number) + 1;
		else grid.push(1);
	});
	return grid;
}

/** One tile per reading, row by row: one row up to TILES_ROW_MAX, else two. */
function evenGrid(n: number): TileShape {
	if (n <= 0) return { columns: [], cores: [], grid: [] };
	const rows = n > TILES_ROW_MAX ? 2 : 1;
	const cols = Math.ceil(n / rows);
	const columns = Array.from({ length: cols }, (_, c) => Array.from({ length: rows }, (_, r) => (r * cols + c < n ? r * cols + c : -1)));
	return { columns, cores: columns.map(() => null), grid: [cols] };
}

/**
 * The layout of `names` (the Group's readings' labels, in its order): the
 * CPU layout when two or more parse as per-thread readings and no core and
 * thread is listed twice (two processors' "Core 0 T0" would), else the
 * even grid.
 */
export function tileShapeOf(names: readonly string[]): TileShape {
	const parsed = names.map(threadOf);
	const seen = new Set<string>();
	let count = 0;
	for (const t of parsed) {
		if (t === undefined) continue;
		const id = `${t.kind}:${t.core}:${t.thread}`;
		if (seen.has(id)) return evenGrid(names.length);
		seen.add(id);
		count++;
	}
	if (count < 2) return evenGrid(names.length);
	const cores = new Map<string, { kind: ThreadLabel["kind"]; core: number; threads: { thread: number; index: number }[] }>();
	parsed.forEach((t, index) => {
		if (t === undefined) return;
		const id = `${t.kind}:${t.core}`;
		const own = cores.get(id) ?? { kind: t.kind, core: t.core, threads: [] };
		own.threads.push({ thread: t.thread, index });
		cores.set(id, own);
	});
	const list = [...cores.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.core - b.core);
	const kinds = [...new Set(list.map((c) => c.kind))];
	const columns: number[][] = [];
	const coreOf: (number | null)[] = [];
	const blocks: number[] = [];
	const placed = new Set<number>();
	list.forEach((c, i) => {
		const slots = [...c.threads].sort((a, b) => a.thread - b.thread).slice(0, THREADS_MAX).map((t) => t.index);
		for (const s of slots) placed.add(s);
		columns.push(slots);
		coreOf.push(c.core);
		blocks.push(kinds.length >= 2 ? kinds.indexOf(c.kind) : list.length >= 12 ? Math.floor(i / 8) : 0);
	});
	// Readings that name no core: a block of their own after the cores,
	// stacked like the cores' threads.
	const rest = names.map((_, i) => i).filter((i) => !placed.has(i));
	if (rest.length > 0) {
		const k = Math.min(2, Math.max(...columns.map((c) => c.length)));
		const block = (blocks[blocks.length - 1] as number) + 1;
		for (let i = 0; i < rest.length; i += k) {
			const column = rest.slice(i, i + k);
			while (column.length < k) column.push(-1);
			columns.push(column);
			coreOf.push(null);
			blocks.push(block);
		}
	}
	return { columns, cores: coreOf, grid: gridOf(blocks) };
}

/** The grid a pane's tiles take when it draws Tiles (its columns per
 * block, what the history width and input routing need), else undefined. */
export function tileGridFor(pane: Pick<StripPaneV1, "style" | "group">, names: readonly string[]): readonly number[] | undefined {
	return pane.style === "group" && pane.group?.view === "tiles" ? tileShapeOf(names).grid : undefined;
}

// ---- geometry ----------------------------------------------------------------

/** The tiles' frame: the band they fill top to bottom (row 0 to 3 stay free
 * for the Strip Screens position line and its backing, rows 96 to 99 for a
 * tab), the gap between stacked tiles, the pane's end pads, the gaps
 * between columns and between blocks, and the corner radius. */
export const TILES = { top: 4, bottom: 96, rowGap: 2, pad: 6, colGap: 4, blockGap: 12, radius: 2 } as const;

export type TileColumn = { readonly x0: number; readonly x1: number };

/** The columns of a grid (columns per block) across a pane, each edge on a
 * whole pixel, so columns differ by at most 1 px. */
export function tileColumns(extent: PaneExtent, grid: readonly number[]): TileColumn[] {
	const blocks = grid.filter((g) => g > 0);
	const cols = blocks.reduce((a, g) => a + g, 0);
	if (cols === 0) return [];
	const inner = extent.x1 - extent.x0 - 2 * TILES.pad - TILES.colGap * (cols - blocks.length) - TILES.blockGap * (blocks.length - 1);
	const w = Math.max(1, inner / cols);
	const out: TileColumn[] = [];
	let x = extent.x0 + TILES.pad;
	blocks.forEach((count, b) => {
		if (b > 0) x += TILES.blockGap;
		for (let i = 0; i < count; i++) {
			if (i > 0) x += TILES.colGap;
			out.push({ x0: Math.round(x), x1: Math.round(x + w) });
			x += w;
		}
	});
	return out;
}

/** One tile: its reading, its column and slot (of `slots` stacked), and
 * its box (edges on whole pixels). */
export type Tile = { readonly index: number; readonly column: number; readonly slot: number; readonly slots: number; readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };

/** The rows a column of `slots` stacked tiles gives slot `s`. */
export function tileRows(slots: number, s: number): { readonly y0: number; readonly y1: number } {
	const h = (TILES.bottom - TILES.top - TILES.rowGap * (slots - 1)) / slots;
	return { y0: Math.round(TILES.top + s * (h + TILES.rowGap)), y1: Math.round(TILES.top + s * (h + TILES.rowGap) + h) };
}

export function tilesOf(shape: TileShape, extent: PaneExtent): Tile[] {
	const cols = tileColumns(extent, shape.grid);
	const out: Tile[] = [];
	shape.columns.forEach((slots, c) => {
		const col = cols[c];
		if (col === undefined) return;
		slots.forEach((index, s) => {
			if (index < 0) return;
			out.push({ index, column: c, slot: s, slots: slots.length, x0: col.x0, x1: col.x1, ...tileRows(slots.length, s) });
		});
	});
	return out;
}

/** A tile's time bucket width for the strip's: half of the default 2 px,
 * so a 1 minute tile draws every sample where samples land a pixel or more
 * apart; the payload ladder's 4 px as it is, which thins the tiles' points
 * about fourfold (a 1 px bucket that moved already draws two); and 6 px
 * for its last step, 8, so a 30 px tile of a 600 px half keeps five
 * buckets, not three. The ladder's 4 px is not halved: 5 minutes of 32
 * threads at 2 px came to 6130 B a slice on a whole + XL against Nebula's
 * 5120 (3 px 5152), so on the art looks it would only move the same 4 px
 * to the last step and lose that step's margin. */
export function tileBucketPx(bucketPx: number): number {
	return bucketPx <= 2 ? bucketPx / 2 : bucketPx === 8 ? 6 : bucketPx;
}

/** How many time buckets every tile has: the narrowest column's plot at
 * the tile bucket width, so one bucket is one moment in every tile. */
export function tileBucketsOf(columns: readonly TileColumn[], bucketPx: number): number {
	if (columns.length === 0) return 0;
	const inner = Math.min(...columns.map((c) => c.x1 - c.x0 - 2));
	return Math.max(1, Math.floor(inner / tileBucketPx(bucketPx)));
}

/** A column's plot (inside its 1 px border), `buckets` across. */
export function tilePlotOf(column: TileColumn, buckets: number): PanePlot {
	const x0 = column.x0 + 1;
	const x1 = column.x1 - 1;
	return { x0, x1, bucketPx: buckets > 0 ? (x1 - x0) / buckets : 1, buckets };
}

/** The time grid every tile shares, as the plot of the first column: what
 * the scene bins the readings on, the history is asked at, and input
 * routing counts the cursor in. Empty without columns. */
export function tilesTimePlot(extent: PaneExtent, grid: readonly number[], bucketPx: number): PanePlot {
	const cols = tileColumns(extent, grid);
	const first = cols[0];
	if (first === undefined) return { x0: extent.x0, x1: extent.x0, bucketPx: 1, buckets: 0 };
	return tilePlotOf(first, tileBucketsOf(cols, bucketPx));
}

/** The column under a tap's x: the nearest. */
export function tileColumnAt(columns: readonly TileColumn[], x: number): number {
	let best = 0;
	let bestD = Number.POSITIVE_INFINITY;
	columns.forEach((c, i) => {
		const d = x < c.x0 ? c.x0 - x : x >= c.x1 ? x - c.x1 + 1 : 0;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	});
	return best;
}

// ---- color -------------------------------------------------------------------

/** The ramp by height, 0 at a tile's floor and 1 at its top: calm blue, sea
 * teal, soft gold, warm peach. Every tile's line and fill take it in a
 * gradient fixed to the tile's own height, so a color is a level. */
export const TILE_RAMP: readonly { readonly at: number; readonly color: string }[] = [
	{ at: 0, color: "#3D8BD4" },
	{ at: 0.45, color: "#4FC1B9" },
	{ at: 0.78, color: "#EDB867" },
	{ at: 1, color: "#FF9A6A" }
];

/** The ramp's color at `t` (0 to 1), as the gradient draws it. */
export function tileRampAt(t: number): string {
	const f = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
	for (let i = 1; i < TILE_RAMP.length; i++) {
		const a = TILE_RAMP[i - 1] as { at: number; color: string };
		const b = TILE_RAMP[i] as { at: number; color: string };
		if (f <= b.at) return mixToward(a.color, b.color, (f - a.at) / (b.at - a.at));
	}
	return (TILE_RAMP[TILE_RAMP.length - 1] as { color: string }).color;
}

const r2 = (v: number): string => {
	const r = Math.round(v * 100) / 100;
	return r === 0 ? "0" : String(r).replace(/^0\./, ".");
};

const r3 = (v: number): string => {
	const r = Math.round(v * 1000) / 1000;
	return r === 0 ? "0" : String(r).replace(/^0\./, ".");
};

/** A tile's plot, top to bottom: 1 px inside its border at the floor, 2 at
 * the top (so a full line keeps clear of the border). */
export function tilePlotRows(t: { readonly y0: number; readonly y1: number }): { readonly top: number; readonly bottom: number } {
	return { top: t.y0 + 2, bottom: t.y1 - 1 };
}

/** One gradient for every tile of a column of `slots` stacked tiles: the
 * ramp once per slot, each fixed to that slot's plot, from the bottom slot's
 * floor to the top slot's top in strip coordinates. */
function rampPaint(id: string, slots: number): string {
	const bands = Array.from({ length: slots }, (_, s) => tilePlotRows(tileRows(slots, s))).reverse();
	const y1 = (bands[0] as { bottom: number }).bottom;
	const y2 = (bands[bands.length - 1] as { top: number }).top;
	const stops: string[] = [];
	for (const band of bands) {
		for (const s of TILE_RAMP) {
			const offset = (y1 - (band.bottom - s.at * (band.bottom - band.top))) / (y1 - y2);
			stops.push(`<stop${offset === 0 ? "" : ` offset="${r3(offset)}"`} stop-color="${s.color}"/>`);
		}
	}
	return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x2="0" y1="${y1}" y2="${y2}">${stops.join("")}</linearGradient>`;
}

/** A line's points with y on whole pixels (a tile's plot is 40 px or more,
 * so a pixel is at most 2.5 % of it): the same line, in fewer bytes. */
function whole(pts: readonly number[]): number[] {
	const out = [...pts];
	for (let i = 1; i < out.length; i += 2) out[i] = Math.round(out[i] as number);
	return out;
}

/** A line's points less each vertex on a straight run between its
 * neighbours (one slope, one direction) and each repeat of the vertex
 * before it: the same line, in fewer bytes. A spike's tip turns back, so it
 * stays. */
export function straight(pts: readonly number[]): number[] {
	if (pts.length <= 4) return [...pts];
	const out: number[] = [pts[0] as number, pts[1] as number];
	for (let i = 2; i + 2 < pts.length; i += 2) {
		const ax = out[out.length - 2] as number;
		const ay = out[out.length - 1] as number;
		const bx = pts[i] as number;
		const by = pts[i + 1] as number;
		const ux = bx - ax;
		const uy = by - ay;
		const vx = (pts[i + 2] as number) - bx;
		const vy = (pts[i + 3] as number) - by;
		if (ux === 0 && uy === 0) continue;
		if (ux * vy === uy * vx && ux * vx + uy * vy > 0) continue;
		out.push(bx, by);
	}
	out.push(pts[pts.length - 2] as number, pts[pts.length - 1] as number);
	return out;
}

/** Below this share of the scale a value reads as idle: its word takes the
 * dim unit color, not the ramp's blue. */
const IDLE_SHARE = 0.1;
/** The dark tiles' veil, and how far a core number dims toward it from
 * the rows' unit color (about 6.5:1 still on a Graphite tile). */
export const TILE_VEIL = "#06080C";
export const CORE_DIM = 0.3;
/** The line itself, the width a mark over it takes. */
const LINE_CORE_WIDTH = 1.3;
/** The line: a soft wide pass (the glow), then the line itself. */
const LINE_PASSES: readonly { readonly dy: number; readonly width: number; readonly opacity: number }[] = [
	{ dy: 0, width: 3.5, opacity: 0.2 },
	{ dy: 0, width: LINE_CORE_WIDTH, opacity: 1 }
];
const STALE_PASSES = LINE_PASSES.map((p) => ({ ...p, opacity: Math.round(p.opacity * 50) / 100 }));
const MARK_PASSES = [{ dy: 0, width: LINE_CORE_WIDTH, opacity: 1 }] as const;
const MARK_PASSES_STALE = [{ dy: 0, width: LINE_CORE_WIDTH, opacity: 0.5 }] as const;
/** The ramp's stop a mark's ink is chosen against. */
const MARK_RAMP_COLOR = (TILE_RAMP[1] as { color: string }).color;
/** How far the widest pass reaches either side of a line. */
const LINE_REACH = Math.max(...LINE_PASSES.map((p) => p.width)) / 2;
/** Whether a line's newest point sits near enough the plot's right end for
 * its glow to reach the frame beside it (the finest buckets). */
const reachesRightEdge = (plot: PanePlot): boolean => plot.buckets > 0 && snap(bucketX(plot, plot.buckets - 1)) + LINE_REACH > plot.x1;
const FILL_OPACITY = 0.36;
/** A tile past a limit: the bar along its bottom, by level. */
export const TILE_BAR = { warn: 3, crit: 6 } as const;

// ---- words -------------------------------------------------------------------

const CORE_SIZE = 11;
const VALUE_SIZE = 13;
const VALUE_SMALL = 11;
/** A word's baseline in its tile. A stack of four's tiles are 21 or 22 px
 * tall and its bottom one starts at row 75, so its words sit higher, at the
 * small size: there they end just above the ink of the Group's bottom row
 * (its 16 px LIVE, on baseline 95). A stack of three's bottom tile ends its
 * words on row 80 as it is. */
const STACK_OF_FOUR = 4;
const baselineOf = (t: Pick<Tile, "y0" | "slots">, centered: boolean): number => t.y0 + (t.slots >= STACK_OF_FOUR ? 9 : centered ? 12 : 14);
/** How far a word's drawn ink can run past its modeled ink, on the side it
 * grows toward from its anchor. A face whose ink is not measured (Segoe UI)
 * models its advances alone, and they run short (through librsvg, 1.72 px on
 * "150k" and 1.63 on "Clock"); Tahoma's model matches its ink within 0.1 px. */
const inkShort = (): number => (faceFont().insets12 === undefined ? 2 : 0);
/** A word's ink from its tile's side, and between a core number and a value. */
const INSET = 4;
const LABEL_GAP = 6;
/** The least gap between a core number and a value, where a seam leaves
 * no room for LABEL_GAP. */
const NEAR_GAP = 3;
/** A word's ink keeps this far from a seam: 2 px, and past the slicer's
 * bleed so the neighbour's slice never carries it. */
const SEAM_CLEAR = 3;
/** The least a word's modeled ink keeps from a seam: the slicer's 2 px bleed
 * and the half pixel a word's box adds to its ink (slicer.ts cullPrim), so
 * the neighbour's slice never carries it. A slot no place in its tile holds
 * whole may come this close. */
const SEAM_INK = 2.5;
/** How far a word's ink may reach past its own tile, into the gap between
 * columns (4 px), when a seam leaves it no room in the tile. */
const OVERHANG = 3;
const EPS = 0.01;

/** The measure a tile's value prints with: the reading's own, and a
 * percentage on the Auto decimals in whole numbers ("81", Task Manager's
 * way). */
export function tileMeasure(b: SceneBuilder, d: Pick<SeriesDraw, "input" | "unit">): MeasureOptions {
	const m = b.measureOf(d);
	return m.decimals === "auto" && d.unit.trim() === "%" ? { ...m, decimals: "0" } : m;
}

/** A box to keep clear of (a word's ink or its slot), and by how much. */
type Clear = { readonly x0: number; readonly x1: number; readonly gap: number };

/**
 * The right edge of a slot `w` wide nearest `pref` that lies in [lo, hi],
 * keeps SEAM_CLEAR from every seam and each box's gap from every box in
 * `avoid` (the words already placed); null when there is none. The word
 * anchors `k` of the slot from its right edge (0 at the end, 0.5 in the
 * middle, 1 at the start), on the half pixel the words snap to, so the
 * slot holds where the word is drawn. Decided by the geometry alone.
 */
function placeSlot(w: number, pref: number, lo: number, hi: number, seams: readonly number[], avoid: readonly Clear[], k = 0): number | null {
	const candidates = [pref, hi, lo + w];
	for (const s of seams) candidates.push(s - SEAM_CLEAR, s + SEAM_CLEAR + w);
	for (const a of avoid) candidates.push(a.x0 - a.gap, a.x1 + a.gap + w);
	const ok = (r: number): boolean => r - w >= lo - EPS && r <= hi + EPS && seams.every((s) => r <= s - SEAM_CLEAR + EPS || r - w >= s + SEAM_CLEAR - EPS) && avoid.every((a) => r <= a.x0 - a.gap + EPS || r - w >= a.x1 + a.gap - EPS);
	let best: number | null = null;
	for (const c of candidates) {
		for (const x of [Math.floor((c - k * w) * 2) / 2, Math.ceil((c - k * w) * 2) / 2]) {
			const r = x + k * w;
			if (ok(r) && (best === null || Math.abs(r - pref) < Math.abs(best - pref) - EPS)) best = r;
		}
	}
	return best;
}

// ---- what a value can print ----------------------------------------------------

/** One way a value prints: each glyph place, as the glyphs it may take (a
 * digit's place the digits it can hold, a sign, point or suffix itself). */
export type ValueForm = readonly (readonly string[])[];

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

/** A printed value's shape: its digits as #, and its unit (a data unit's
 * tier prints the same digits as the next). */
const shapeOf = (m: Measurement): string => `${m.valueText.replace(/\d/g, "#")}|${m.unitText}`;

/**
 * Every form `print` puts a value in over lo to hi (native units), whatever
 * the value: not only the scale's ends. Each shape a value prints in (its
 * digits, decimals and suffix, and its unit's tier) holds one run of the
 * scale, so halving the scale where the shape changes finds them all,
 * among them the top of a band that rounds up into one more digit (9.997
 * prints 10.00, 99.97 100.0, 9999.6 10000) and the k form (44.4k on a 150k
 * scale). 0 and 1 are asked too where the scale holds them: the only
 * values that print as words (No, Yes) or as a lone zero (0 B). Each
 * shape's places, from the lowest text it prints to the highest: the same
 * glyph before the first place where they differ, the digits between there,
 * any digit after it.
 */
export function valueForms(print: (v: number) => Measurement, lo: number, hi: number): ValueForm[] {
	const runs = new Map<string, { min: string; max: string }>();
	const note = (m: Measurement): void => {
		const text = m.valueText;
		if (text === "") return;
		const key = shapeOf(m);
		const run = runs.get(key);
		if (run === undefined) runs.set(key, { min: text, max: text });
		else if (text < run.min) run.min = text;
		else if (text > run.max) run.max = text;
	};
	const walk = (a: number, z: number, ma: Measurement, mz: Measurement, depth: number): void => {
		const m = a + (z - a) / 2;
		if (shapeOf(ma) === shapeOf(mz) || depth > 1100 || !(m > a && m < z)) {
			note(ma);
			note(mz);
			return;
		}
		const mm = print(m);
		walk(a, m, ma, mm, depth + 1);
		walk(m, z, mm, mz, depth + 1);
	};
	const a = Math.min(lo, hi);
	const z = Math.max(lo, hi);
	if (!Number.isFinite(a) || !Number.isFinite(z)) return [];
	walk(a, z, print(a), print(z), 0);
	for (const v of [0, 1]) if (v > a && v < z) note(print(v));
	return [...runs.values()].map(({ min, max }) => {
		const low = Array.from(min);
		const high = Array.from(max);
		const k = low.findIndex((ch, i) => ch !== high[i]);
		return low.map((ch, i) => (k < 0 || i < k || !isDigit(ch) ? [ch] : i === k ? DIGITS.filter((d) => d >= ch && d <= (high[i] as string)) : DIGITS));
	});
}

/** How far the values of `forms` reach at one size: the widest advance,
 * and the ink of every text the forms hold, end anchored at r from
 * r - lead to r - tail, start anchored at x from x + head to x + reach. */
export type ValueInk = { readonly w: number; readonly lead: number; readonly tail: number; readonly head: number; readonly reach: number };

/** The ink of `forms` at `size`: each place at its widest glyph, the
 * first and the last place at every glyph they may take (the advances
 * add up, and a text's ink starts at its first glyph and ends at its last). */
export function valueInkOf(forms: readonly ValueForm[], size: number): ValueInk {
	const span = (text: string): InkSpan => inkSpan([{ text, fontSize: size, fontWeight: 700 }]);
	let w = 0;
	let lead = 0;
	let reach = 0;
	let head = Number.POSITIVE_INFINITY;
	let tail = Number.POSITIVE_INFINITY;
	for (const form of forms) {
		if (form.length === 0) continue;
		const big = form.map((place) => place.reduce((best, ch) => (span(ch).advance > span(best).advance ? ch : best)));
		const textWith = (i: number, ch: string): string => big.map((g, j) => (j === i ? ch : g)).join("");
		w = Math.max(w, span(big.join("")).advance);
		for (const ch of form[0] as readonly string[]) {
			const s = span(textWith(0, ch));
			lead = Math.max(lead, s.advance - s.left);
			head = Math.min(head, s.left);
		}
		const last = form.length - 1;
		for (const ch of form[last] as readonly string[]) {
			const s = span(textWith(last, ch));
			reach = Math.max(reach, s.right);
			tail = Math.min(tail, s.advance - s.right);
		}
	}
	return { w, lead, reach, head: Number.isFinite(head) ? head : 0, tail: Number.isFinite(tail) ? tail : 0 };
}

/** The forms and inks asked for lately, by what decides them: the printing
 * of the readings and the scale (the forms), the face font and the size
 * (the ink). A setup asks for the same few every frame. */
const formsMemo = new Map<string, ValueForm[]>();
const inkMemo = new Map<string, ValueInk>();
const MEMO_MAX = 64;
const memo = <T>(map: Map<string, T>, key: string, make: () => T): T => {
	const had = map.get(key);
	if (had !== undefined) return had;
	if (map.size >= MEMO_MAX) map.clear();
	const made = make();
	map.set(key, made);
	return made;
};

/** The one value Tiles prints without a scale (nothing observed yet): 100. */
const HUNDRED: readonly ValueForm[] = [[["1"], ["0"], ["0"]]];

/** A value slot at one size: its width (the widest text the readings print
 * on the scale, held for the setup) and the ink of every value it can
 * print (ValueInk). */
type ValueSlot = { readonly size: number; readonly w: number; readonly lead: number; readonly tail: number; readonly head: number; readonly reach: number };

/** The slot at `size`, `w` wide (held), its reaches held like the width,
 * so the slot only ever grows. */
function valueSlotOf(b: SceneBuilder, key: string, ink: ValueInk, size: number, w: number): ValueSlot {
	return { size, w, lead: b.slot(`${key}:lead`, ink.lead, () => ink.lead), tail: ink.tail, head: ink.head, reach: b.slot(`${key}:reach`, ink.reach, () => ink.reach) };
}

/** A value's place: where its word anchors, how, and the ink every value
 * of its slot keeps within there. */
type ValuePlace = { readonly x: number; readonly anchor: Word["anchor"]; readonly box: readonly [number, number] };

/**
 * For a slot no place in the tile holds whole, where its ink alone fits:
 * the ink of every value it prints inside [lo, hi], SEAM_INK from every
 * seam and each box's gap from every box in `avoid`, on the half pixel the
 * words snap to. First beside a seam it cuts, the ink growing away from
 * the seam (its side nearer `home` first), else end anchored nearest
 * `home`; null when nothing holds it.
 */
function inkSlot(v: ValueSlot, home: number, lo: number, hi: number, seams: readonly number[], avoid: readonly Clear[]): ValuePlace | null {
	const ok = (a: number, c: number): boolean => a >= lo - EPS && c <= hi + EPS && seams.every((s) => c <= s - SEAM_INK + EPS || a >= s + SEAM_INK - EPS) && avoid.every((k) => c <= k.x0 - k.gap + EPS || a >= k.x1 + k.gap - EPS);
	const start = (x: number): ValuePlace => ({ x, anchor: "start", box: [x + v.head, x + v.reach] });
	const end = (r: number): ValuePlace => ({ x: r, anchor: "end", box: [r - v.lead, r - v.tail] });
	const beside = seams
		.flatMap((s) => [start(Math.ceil((s + SEAM_INK - v.head) * 2) / 2), end(Math.floor((s - SEAM_INK + v.tail) * 2) / 2)])
		.filter((p) => ok(p.box[0], p.box[1]))
		.sort((p, q) => Math.abs((p.box[0] + p.box[1]) / 2 - home) - Math.abs((q.box[0] + q.box[1]) / 2 - home));
	if (beside[0] !== undefined) return beside[0];
	// What each seam and box rules out for an end anchor, as open spans.
	const cuts: (readonly [number, number])[] = [...seams.map((s) => [s - SEAM_INK + v.tail, s + SEAM_INK + v.lead] as const), ...avoid.map((k) => [k.x0 - k.gap + v.tail, k.x1 + k.gap + v.lead] as const)];
	let best: number | null = null;
	for (const c of [home, lo + v.lead, hi + v.tail, ...cuts.flat()]) {
		for (const r of [Math.floor(c * 2) / 2, Math.ceil(c * 2) / 2]) if (ok(r - v.lead, r - v.tail) && (best === null || Math.abs(r - home) < Math.abs(best - home) - EPS)) best = r;
	}
	return best === null ? null : end(best);
}

/** One word for the rows (their edge), its box its own ink where it is
 * drawn: placed clear of every seam, it reaches one slice only. */
function wordOf(x: number, y: number, anchor: Word["anchor"], size: number, weight: 600 | 700, fill: string, text: string): Word {
	const at = snap(x);
	const e = inkEdges([{ text, fontSize: size, fontWeight: weight }], anchor, at);
	return { x: at, y, anchor, size, fill, text, bx0: e.left - 0.5, bx1: e.right + 0.5 };
}

// ---- the view ----------------------------------------------------------------

/**
 * Draws a Group pane's readings as tiles (the caller has drawn nothing of
 * the pane yet and has `draws` binned on f.plot, the tiles' shared time
 * grid, tilesTimePlot). `topFree`: rows 0 to 3 hold nothing else (no Strip
 * Screens position line), so a top tile's tab can sit above it.
 */
export function tilesPane(b: SceneBuilder, f: PaneFrame, draws: readonly SeriesDraw[], info: GroupPaneInfo, topFree: boolean): void {
	const shape = tileShapeOf(draws.map((d) => d.input.name));
	const tiles = tilesOf(shape, f.extent);
	const buckets = f.plot.buckets;
	const look = b.look;
	const light = luminance(look.surface) > 0.5;
	const ink = light ? look.palette.label : "#A9BED4";
	const frameFill = light ? `fill="${look.palette.label}" fill-opacity=".05"` : `fill="${TILE_VEIL}" fill-opacity="${look.background === "glass" ? ".3" : ".42"}"`;
	const framePaint = `${frameFill} stroke="${ink}" stroke-opacity="${light ? ".22" : ".24"}"`;
	const scale = b.groupScale(f, draws, 4);
	const lo = scale?.held.lo ?? 0;
	const hi = scale?.held.hi ?? 1;
	const values = draws.map((d) => (d.input.state === "missing" ? undefined : b.readoutValue(f, d)));
	const highlighted = info.highlightKey === null ? -1 : draws.findIndex((d) => d.input.key === info.highlightKey);
	const mapOf = (t: Tile): YMap => ({ lo, hi, ...tilePlotRows(t) });

	// Frames: a missing reading's tile is dashed and empty. A tile past a limit
	// (now, or at the cursor) takes the alert's stroke on its own frame, a path
	// a level with the same fill, so its corners are written once.
	const levels = draws.map((d, i) => b.levelOf(f, d, values[i]));
	const frames: number[] = [];
	const dashed: number[] = [];
	const alerted = { warn: [] as number[], crit: [] as number[] };
	for (const t of tiles) {
		const level = levels[t.index] ?? null;
		(draws[t.index]?.input.state === "missing" ? dashed : level === null ? frames : alerted[level]).push(t.x0 + 0.5, t.y0 + 0.5, t.x1 - t.x0 - 1, t.y1 - t.y0 - 1);
	}
	if (frames.length > 0) b.prims.push({ k: "cells", layer: "base", rects: frames, paint: framePaint, round: TILES.radius } satisfies CellsPrim);
	for (const level of ["warn", "crit"] as const) {
		if (alerted[level].length > 0) b.prims.push({ k: "cells", layer: "base", rects: alerted[level], paint: `${frameFill} stroke="${b.alertColors[level]}"`, round: TILES.radius } satisfies CellsPrim);
	}
	if (dashed.length > 0) b.prims.push({ k: "cells", layer: "base", rects: dashed, paint: `fill="none" stroke="${ink}" stroke-opacity=".5" stroke-dasharray="3 3"`, round: TILES.radius, whole: true } satisfies CellsPrim);

	const live = tiles.filter((t) => draws[t.index]?.input.state !== "missing");
	// The mid-scale line.
	const mids: number[] = [];
	for (const t of live) mids.push(t.x0 + 1, Math.floor((t.y0 + 2 + t.y1 - 1) / 2), t.x1 - t.x0 - 2, 1);
	if (mids.length > 0) b.prims.push({ k: "cells", layer: "base", rects: mids, paint: `stroke="${light ? look.palette.label : "#C9D3E0"}" stroke-opacity=".1"`, hair: true } satisfies CellsPrim);

	if (scale !== null && buckets > 0) {
		// Fills, then the lines: one path each for every tile of one stack
		// height, on its one gradient.
		const fills = new Map<string, { runs: number[][]; bases: number[]; grad: string; stale: boolean }>();
		const lines = new Map<string, { lines: number[][]; grad: string; stale: boolean }>();
		const marks = new Map<string, { lines: number[][]; stale: boolean }>();
		for (const t of live) {
			const d = draws[t.index] as SeriesDraw;
			const map = mapOf(t);
			const grad = `tg${f.index}${t.slots}`;
			b.localDef(grad, rampPaint(grad, t.slots));
			const stale = d.input.state === "stale";
			const key = `${t.slots}${stale ? "s" : ""}`;
			const plot = tilePlotOf(t, buckets);
			const fill = fills.get(key) ?? { runs: [], bases: [], grad, stale };
			const line = lines.get(key) ?? { lines: [], grad, stale };
			for (const run of d.runs) {
				const pts = straight(whole(runPoints(run, plot, map)));
				line.lines.push(pts.length === 2 ? [...pts, ...pts] : pts);
				if (pts.length >= 4) {
					fill.runs.push(pts);
					fill.bases.push(map.bottom);
				}
				if (run.marks === undefined) continue;
				const stack = marks.get(key) ?? { lines: [], stale };
				for (const at of run.marks) stack.lines.push(whole(markPoints(run, at, plot, map)));
				marks.set(key, stack);
			}
			fills.set(key, fill);
			lines.set(key, line);
		}
		for (const fill of fills.values()) if (fill.runs.length > 0) b.prims.push({ k: "areas", layer: "base", runs: fill.runs, bases: fill.bases, paint: `fill="url(#${fill.grad})" fill-opacity="${r2(fill.stale ? FILL_OPACITY / 2 : FILL_OPACITY)}"` } satisfies AreasPrim);
		for (const [key, line] of lines) {
			if (line.lines.length === 0) continue;
			b.prims.push({ k: "skein", layer: "base", id: `tl${f.index}${key}`, lines: line.lines, attrs: `fill="none" stroke="url(#${line.grad})" stroke-linejoin="round"`, passes: line.stale ? STALE_PASSES : LINE_PASSES, reach: Math.ceil(Math.max(...LINE_PASSES.map((p) => p.width)) / 2) + 1, tight: true } satisfies SkeinPrim);
		}
		// Brief gaps in color: one path per stack, on top of the lines, with no
		// glow, its ink against the ramp's middle (the ramp colors by height,
		// not by reading, and most of a tile's line sits low on it).
		const markInk = markInkOf(MARK_RAMP_COLOR, MARK_INKS);
		for (const [key, stack] of marks) {
			b.prims.push({ k: "skein", layer: "base", id: `tm${f.index}${key}`, lines: stack.lines, attrs: `fill="none" stroke="${markInk}"`, passes: stack.stale ? MARK_PASSES_STALE : MARK_PASSES, reach: Math.ceil(LINE_CORE_WIDTH / 2) + 1, tight: true } satisfies SkeinPrim);
		}
	}

	// Past a limit: a bar along the tile's bottom. The outline is the tile's
	// frame, under the graph, and on the finest buckets the line's glow reaches
	// its right edge, tinting it just as a line climbs past a limit: that edge
	// is painted again here, 1 px in the bar's own path, clear of the corners.
	for (const level of ["warn", "crit"] as const) {
		const past = live.filter((t) => levels[t.index] === level);
		if (past.length === 0) continue;
		const rects = past.flatMap((t) => [t.x0 + 1, t.y1 - 1 - TILE_BAR[level], t.x1 - t.x0 - 2, TILE_BAR[level], ...(reachesRightEdge(tilePlotOf(t, buckets)) ? [t.x1 - 1, t.y0 + 3, 1, t.y1 - t.y0 - 6] : [])]);
		b.prims.push({ k: "cells", layer: "marks", rects, paint: `fill="${b.alertColors[level]}"` } satisfies CellsPrim);
	}

	// The highlighted reading: its border and a small tab that points at
	// it. A column's bottom tile has it under the column; a top tile above
	// it while rows 0 to 3 are free, else (the Strip Screens line holds
	// them), like a tile between two, on its own top edge, so the tab never
	// sits by the tile below. A tile past a limit keeps the alert's outline
	// in place of the border; the tab draws over it.
	const highlight = b.groupHighlightColor();
	const lit = tiles.find((t) => t.index === highlighted);
	if (lit !== undefined) {
		if (levels[lit.index] === null) b.prims.push({ k: "cells", layer: "marks", rects: [lit.x0 + 0.5, lit.y0 + 0.5, lit.x1 - lit.x0 - 1, lit.y1 - lit.y0 - 1], paint: `fill="none" stroke="${highlight}" stroke-width="1.5"`, round: TILES.radius } satisfies CellsPrim);
		const tw = Math.max(4, Math.min(18, lit.x1 - lit.x0 - 8));
		const y = lit.slot === lit.slots - 1 ? TILES.bottom + 1 : lit.slot === 0 && topFree ? 0.5 : lit.y0 + 0.5;
		b.prims.push({ k: "cells", layer: "marks", rects: [(lit.x0 + lit.x1) / 2 - tw / 2, y, tw, 2.5], paint: `fill="${highlight}"` } satisfies CellsPrim);
	}

	// Inspecting: one cursor, the same moment in every tile.
	const j = b.cursorBucket(f);
	if (j !== undefined && buckets > 0) {
		const rects: number[] = [];
		for (const t of live) rects.push(snap(bucketX(tilePlotOf(t, buckets), j) - 0.5), t.y0 + 1, 1, t.y1 - t.y0 - 2);
		b.prims.push({ k: "cells", layer: "marks", rects, paint: `fill="${look.text.badge}"` } satisfies CellsPrim);
	}

	tileWords(b, f, draws, tiles, shape, values, levels, highlighted, scale === null ? null : { lo, hi });
	// The bottom row: the Group's own, and the unit before LIVE (a
	// percentage needs none).
	const d0 = draws.find((d) => d.input.state !== "missing");
	const unit = d0 === undefined || !f.pane.overlays.unit ? "" : formatMeasurement(hi, d0.unit, tileMeasure(b, d0)).unitText;
	// Under Names, a highlighted thread by the label HWiNFO gives it: its tile
	// prints only the core's number.
	const thread = lit === undefined || (shape.cores[lit.column] ?? null) === null || !f.pane.overlays.legend ? undefined : threadPlaceOf(draws[lit.index]?.input.name ?? "");
	b.groupBottomRow(f, info, draws, unit === "" || unit === "%" ? [] : [[{ kind: "text", text: unit, fill: b.rowColors.unit, gap: 0 }]], thread);
}

/** A value as its tile prints it, "" for none. */
function tileText(b: SceneBuilder, d: SeriesDraw, v: number | undefined): string {
	return v === undefined ? "" : formatMeasurement(v, d.unit, tileMeasure(b, d)).valueText;
}

/** Each way the readings print (a unit and a measure), once, by a key. */
function printingsOf(b: SceneBuilder, draws: readonly SeriesDraw[]): Map<string, { readonly unit: string; readonly measure: MeasureOptions }> {
	const out = new Map<string, { readonly unit: string; readonly measure: MeasureOptions }>();
	for (const d of draws) {
		const measure = tileMeasure(b, d);
		const key = `${d.unit}|${measure.decimals}|${measure.fahrenheit ? 1 : 0}|${measure.dataUnits}|${measure.fixedUnit ?? ""}`;
		if (!out.has(key)) out.set(key, { unit: d.unit, measure });
	}
	return out;
}

function formsKeyOf(b: SceneBuilder, draws: readonly SeriesDraw[], scale: { readonly lo: number; readonly hi: number }): string {
	return `${scale.lo}|${scale.hi}|${[...printingsOf(b, draws).keys()].sort().join("/")}`;
}

/** Every form a tile of these readings prints a value in on the scale. */
function printedForms(b: SceneBuilder, draws: readonly SeriesDraw[], scale: { readonly lo: number; readonly hi: number }): ValueForm[] {
	const out: ValueForm[] = [];
	for (const [key, p] of printingsOf(b, draws)) out.push(...memo(formsMemo, `${scale.lo}|${scale.hi}|${key}`, () => valueForms((v) => formatMeasurement(v, p.unit, p.measure), scale.lo, scale.hi)));
	return out;
}

/** The words of every tile, in slots fixed by the geometry (see the module
 * comment). A value's color is its level on the ramp; a reading with limits
 * (Alert bands) keeps the rows' own value color, as Group Rows does, so
 * its tile's bar and outline tell an alert and no word reads as one. A core
 * column's values print only when asked for, and every slot is placed either
 * way, so what shows never decides where anything goes. */
function tileWords(b: SceneBuilder, f: PaneFrame, draws: readonly SeriesDraw[], tiles: readonly Tile[], shape: TileShape, values: readonly (number | undefined)[], levels: readonly ("warn" | "crit" | null)[], highlighted: number, scale: { readonly lo: number; readonly hi: number } | null): void {
	const showValue = f.pane.overlays.current;
	const showName = f.pane.overlays.legend;
	if ((!showValue && !showName) || tiles.length === 0) return;
	if (draws.length === 0) return;
	// The value slot holds the widest text any reading prints anywhere on
	// the scale (valueForms), held for the setup.
	const formsKey = scale === null ? "100" : formsKeyOf(b, draws, scale);
	const short = inkShort();
	const inkAt = (size: number): ValueInk =>
		memo(inkMemo, `${faceFont().id}|${size}|${formsKey}`, () => {
			const ink = valueInkOf(scale === null ? HUNDRED : printedForms(b, draws, scale), size);
			return { ...ink, w: ink.w + short, lead: ink.lead + short, reach: ink.reach + short };
		});
	const widest = (size: number): number => Math.ceil(inkAt(size).w * 10) / 10;
	const nameW = (name: string): number => b.widthOf(name, CORE_SIZE, 600) + short;
	const wideW = b.slot("tiles:value", widest(VALUE_SIZE), () => widest(VALUE_SIZE));
	const smallW = b.slot("tiles:small", widest(VALUE_SMALL), () => widest(VALUE_SMALL));
	const coreW = Math.max(0, ...shape.cores.map((c) => (c === null ? 0 : nameW(String(c)))));
	const narrowest = Math.min(...tiles.map((t) => t.x1 - t.x0));
	const wide = narrowest >= INSET + (showName ? coreW + LABEL_GAP : 0) + (showValue ? wideW : 0) + INSET;
	const medium = !wide && showValue && narrowest >= smallW + 6;
	const numbered = showName && shape.cores.some((c) => c !== null);
	if (!wide && !medium && !numbered) return;
	const seams: number[] = [];
	for (let s = (Math.floor(f.extent.x0 / SLICE_W) + 1) * SLICE_W; s < f.extent.x1; s += SLICE_W) seams.push(s);
	// The value's two sizes, the full one first.
	const full = valueSlotOf(b, "tiles:ink", inkAt(VALUE_SIZE), VALUE_SIZE, wideW);
	const small = valueSlotOf(b, "tiles:ink-small", inkAt(VALUE_SMALL), VALUE_SMALL, smallW);
	const sizes = showValue ? [full, small] : [];
	const t0 = b.rowColors;
	// The core numbers a step dimmer than an idle value, on the dark tiles.
	const coreFill = luminance(b.look.surface) > 0.5 ? t0.unit : mixToward(t0.unit, TILE_VEIL, CORE_DIM);
	const highlight = b.onRows(b.groupHighlightColor());
	const peers = draws.map((d) => d.input.name || d.input.key);

	// Every slot placed so far, by its baseline: a later tile's words keep
	// NEAR_GAP from them (a word in the gap between two columns is the one
	// a neighbour's can reach).
	const placed: { readonly y: number; readonly size: number; readonly x0: number; readonly x1: number }[] = [];
	const nearOf = (y: number, size: number): Clear[] => placed.filter((p) => p.y - 0.75 * p.size < y && y - 0.75 * size < p.y).map((p) => ({ x0: p.x0, x1: p.x1, gap: NEAR_GAP }));
	type Side = readonly [number, number];
	const FREE: Side = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
	type ValueAt = { readonly v: ValueSlot; readonly x: number; readonly anchor: Word["anchor"]; readonly box: Side };
	type Choice = { readonly name: string; readonly nameAt: Side | null; readonly value: ValueAt | null };

	/** A value's place in tile t at slot v, inside `side`: at home (the
	 * top right; centered on a medium tile), else the nearest place in the
	 * tile clear of the seams and LABEL_GAP from the name, else NEAR_GAP
	 * from it, else its slot reaching OVERHANG past the tile, else where its
	 * ink alone keeps within OVERHANG of the tile; null where none holds. */
	const valueAt = (t: Tile, v: ValueSlot, nameAt: Side | null, side: Side, centered: boolean): ValueAt | null => {
		const lo = Math.max(t.x0 + INSET - 1, side[0]);
		const hi = Math.min(t.x1 - INSET + 1, side[1]);
		const reachLo = Math.max(t.x0 - OVERHANG, side[0]);
		const reachHi = Math.min(t.x1 + OVERHANG, side[1]);
		const near = nearOf(baselineOf(t, centered), v.size);
		const own = (gap: number): Clear[] => (nameAt === null ? near : [...near, { x0: nameAt[0], x1: nameAt[1], gap }]);
		const home = centered ? (t.x0 + t.x1) / 2 + v.w / 2 : t.x1 - INSET;
		let r: number | null = null;
		if (centered) {
			r = placeSlot(v.w, home, lo, hi, seams, near, 0.5) ?? placeSlot(v.w, home, reachLo, reachHi, seams, near, 0.5);
			if (r !== null) return { v, x: r - v.w / 2, anchor: "middle", box: [r - v.w, r] };
		} else {
			for (const gap of [LABEL_GAP, NEAR_GAP]) r ??= placeSlot(v.w, home, lo, hi, seams, own(gap));
			r ??= placeSlot(v.w, home, lo, reachHi, seams, own(NEAR_GAP));
			if (r !== null) return { v, x: r, anchor: "end", box: [r - v.w, r] };
		}
		const ink = inkSlot(v, home, reachLo, reachHi, seams, own(NEAR_GAP));
		return ink === null ? null : { v, ...ink };
	};

	/** A name from `rungs` and the value of slot v beside it (none: the name
	 * alone), in that order: the name where the value keeps its home room,
	 * else anywhere in the tile clear of every seam, taken only where the
	 * value then finds its place; null when none does. */
	const withName = (t: Tile, rungs: readonly string[], v: ValueSlot | undefined, side: Side): Choice | null => {
		const lo = t.x0 + INSET - 1;
		const hi = t.x1 - INSET + 1;
		const room = hi - lo - (v === undefined ? 0 : v.w + LABEL_GAP);
		const fits = rungs.filter((rung) => rung !== "" && nameW(rung) <= room);
		const near = nearOf(baselineOf(t, false), CORE_SIZE);
		for (const right of v === undefined ? [hi] : [hi - (v.w + NEAR_GAP), hi]) {
			for (const rung of fits) {
				const w = nameW(rung);
				const r = placeSlot(w, lo + 1 + w, lo, right, seams, near, 1);
				if (r === null) continue;
				const nameAt: Side = [r - w, r];
				if (v === undefined) return { name: rung, nameAt, value: null };
				const value = valueAt(t, v, nameAt, side, false);
				if (value !== null) return { name: rung, nameAt, value };
			}
		}
		return null;
	};

	/** A tile's words, the name and the value chosen together: a name with
	 * the full value, else with the small one, else the value alone at
	 * either size (`from`: the first size to try); a value goes only where
	 * the tile has no room for its small size, and then the name may still
	 * show. */
	const choose = (t: Tile, rungs: readonly string[], side: Side, from: number): Choice => {
		const none: Choice = { name: "", nameAt: null, value: null };
		if (!showValue) return withName(t, rungs, undefined, side) ?? none;
		const tried = sizes.slice(from);
		for (const v of tried) {
			const c = withName(t, rungs, v, side);
			if (c !== null) return c;
		}
		for (const v of tried) {
			const value = valueAt(t, v, null, side, false);
			if (value !== null) return { ...none, value };
		}
		return withName(t, rungs, undefined, side) ?? none;
	};

	/** A core number's place where its tile has none beside the value (a
	 * narrow column, a seam through the tile): where it starts on the other
	 * tiles, else the nearest clear of the seams inside the tile's border. */
	const numberAlone = (t: Tile, y: number, number: string): Side | null => {
		const w = nameW(number);
		const r = placeSlot(w, t.x0 + INSET + w, t.x0 + 1, t.x1 - 1, seams, nearOf(y, CORE_SIZE), 1);
		return r === null ? null : [r - w, r];
	};

	// Tiles that name their reading take one of its shortened forms for all:
	// the longest that every tile with room for one beside the full value
	// holds; where no tile has room for one there, beside the small value
	// (-1 where none has room at either size: each takes its own).
	const rungsOf = (t: Tile): readonly string[] => {
		const d = draws[t.index] as SeriesDraw;
		return nameRungs(d.input.name || d.input.key, peers);
	};
	const rungAt = (t: Tile, k: number): string => {
		const rungs = rungsOf(t);
		return rungs[Math.min(k, rungs.length - 1)] ?? "";
	};
	let level = -1;
	const named = wide && showName ? tiles.filter((t) => shape.cores[t.column] === null) : [];
	if (named.length > 0) {
		const depth = Math.max(...named.map((t) => rungsOf(t).length));
		for (const v of showValue ? sizes : [undefined]) {
			const able = named.filter((t) => withName(t, rungsOf(t), v, FREE) !== null);
			if (able.length === 0) continue;
			for (let k = 0; k < depth && level < 0; k++) if (able.every((t) => withName(t, [rungAt(t, k)], v, FREE) !== null)) level = k;
			break;
		}
	}

	// A core column's later tiles keep their values on the side of each seam
	// through it that its first tile's value took, and at its size or less.
	const sides = new Map<number, Side>();
	const sizeFrom = new Map<number, number>();
	const sideOf = (t: Tile, box: Side): Side => {
		let lo = Number.NEGATIVE_INFINITY;
		let hi = Number.POSITIVE_INFINITY;
		for (const s of seams) {
			if (s <= t.x0 || s >= t.x1) continue;
			if (box[1] <= s + EPS) hi = Math.min(hi, s - SEAM_INK);
			else lo = Math.max(lo, s + SEAM_INK);
		}
		return [lo, hi];
	};

	const inspecting = f.input.view.mode === "paused";
	const bold: Word[] = [];
	const plain: Word[] = [];
	const put = (into: Word[], x: number, y: number, anchor: Word["anchor"], size: number, weight: 600 | 700, fill: string, text: string): void => {
		if (text !== "") into.push(wordOf(x, y, anchor, size, weight, fill, text));
	};
	for (const t of tiles) {
		const d = draws[t.index] as SeriesDraw;
		const lit = t.index === highlighted;
		const v = values[t.index];
		const share = scale === null || v === undefined ? 0 : (v - scale.lo) / (scale.hi - scale.lo);
		const limited = f.input.bands.some((band) => band.readingKey === d.input.key);
		const valueFill = lit ? highlight : d.input.state !== "ok" || share < IDLE_SHARE ? t0.unit : limited ? t0.value : b.onRows(tileRampAt(share));
		const cored = shape.cores[t.column] ?? null;
		// A core column's value waits to be asked for: highlighted, past a limit
		// or inspected. Its slot is placed below either way.
		const asked = cored === null || lit || inspecting || (levels[t.index] ?? null) !== null;
		const text = showValue && asked ? tileText(b, d, v) : "";
		const fill = lit ? highlight : coreFill;
		const side = sides.get(t.column) ?? FREE;
		let choice: Choice;
		if (medium) {
			const value = valueAt(t, small, null, side, true) ?? (side === FREE ? null : valueAt(t, small, null, FREE, true));
			choice = { name: "", nameAt: null, value };
		} else if (!wide) {
			choice = { name: "", nameAt: null, value: null };
		} else {
			// The name: the core's number as HWiNFO prints it on every tile of
			// its column, else the reading's own name on each tile, shortened.
			const rungs = !showName ? [] : cored !== null ? [String(cored)] : level < 0 ? rungsOf(t) : [rungAt(t, level)];
			const from = sizeFrom.get(t.column) ?? (t.slots >= STACK_OF_FOUR ? 1 : 0);
			choice = choose(t, rungs, side, from);
			if (choice.value === null && side !== FREE) choice = choose(t, rungs, FREE, from);
		}
		const y = baselineOf(t, medium);
		const at = choice.value;
		// No room beside the value: the number alone (placed before the value's
		// slot goes down, they never show together), and a value that prints
		// takes the tile from it.
		const number = cored !== null && showName && choice.nameAt === null ? String(cored) : "";
		const alone = number === "" ? null : numberAlone(t, y, number);
		if (at !== null) {
			put(bold, at.x, y, at.anchor, at.v.size, 700, valueFill, text);
			placed.push({ y, size: at.v.size, x0: at.box[0], x1: at.box[1] });
			if (cored !== null && !sides.has(t.column)) {
				sides.set(t.column, sideOf(t, at.box));
				sizeFrom.set(t.column, Math.max(0, sizes.indexOf(at.v)));
			}
		}
		if (choice.nameAt !== null) {
			put(plain, choice.nameAt[0], y, "start", CORE_SIZE, 600, fill, choice.name);
			placed.push({ y, size: CORE_SIZE, x0: choice.nameAt[0], x1: choice.nameAt[1] });
		}
		if (alone !== null) {
			if (at === null || text === "") put(plain, alone[0], y, "start", CORE_SIZE, 600, fill, number);
			placed.push({ y, size: CORE_SIZE, x0: alone[0], x1: alone[1] });
		}
	}
	if (plain.length > 0) b.prims.push({ k: "words", layer: "rows", weight: 600, words: plain } satisfies WordsPrim);
	if (bold.length > 0) b.prims.push({ k: "words", layer: "rows", weight: 700, words: bold } satisfies WordsPrim);
}
