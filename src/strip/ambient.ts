/**
 * The strip's Ambient style: real recorded readings drawn as light, for the
 * pleasure of watching the machine work. Nothing here is read off a scale:
 * every reading is drawn on its own range, so it is the one strip style
 * that takes readings of any unit (src/strip/group.ts resolves them from
 * the pane's rule, up to 48).
 *
 * Every reading is a thread, all in ONE path stroked with a vertical
 * spectrum fixed in strip coordinates: a thread takes the color (and the
 * brightness) of where it is in its own range, red-orange near its window
 * maximum through yellow, green and cyan to violet near its minimum. A
 * curtain of five fainter, wider copies rises off each thread (<use> of the
 * same path, shifted up).
 *
 * Honest by construction:
 * - Every vertex is a recorded sample: the last sample in its cell (8 px,
 *   or one stored tier entry when that is wider: 20 px at 1 minute). A cell
 *   with no sample inside a segment is the straight line between two
 *   recorded samples; nothing is smoothed.
 * - Each reading's range is its own window minimum to maximum (true
 *   extremes, so a peak inside a cell still sets it); a reading that moved
 *   less than its unit's quiet span is drawn on that span, centered, so a
 *   one-step jitter is a ripple and not a cliff.
 * - Gaps stay gaps, short history sits on the right, a reading that appears
 *   late is a short trail, stale data dims to 45 % and the mark says so.
 * - The mark (bottom left of the first slot) says what this is and which
 *   window: "Ambient · 15 min", "Ambient · stale".
 *
 * Paints are plain SVG Tiny: strokes and fills with flat or vertical
 * linear gradients and stop opacity, no blend modes, masks or filters. The
 * one feature the strip had not used before is <use> with a y offset (the
 * curtain); everything sits under Outline's edge filter (the base layer),
 * so the threads are never ringed. Cells divide 200 px and the gradient is
 * fixed in strip coordinates, so slices join with no seam.
 */
import type { HistoryView, HistoryWindowId } from "../history/types";
import { HISTORY_WINDOWS, TIERS } from "../history/window";
import { t } from "../i18n";
import { isArtLook } from "../ui/deck-art";
import { estimateKeyTextWidth } from "../ui/format";
import { haloRingColor } from "../ui/dial-background";
import type { PaneExtent, PanePlot } from "./geometry";
import { SLICE_W } from "./geometry";
import { binView, drawnUnitOf, NO_BINS, runsOf, Scratch, type Bins } from "./graph";
import type { SkeinPrim } from "./prims";
import type { GroupPaneInfo, PaneFrame, SceneBuilder } from "./scene";

/** The band the light draws in, top to bottom (the mark sits below). */
export const AMBIENT_TOP = 6;
export const AMBIENT_BOTTOM = 90;

/** Cell widths in px, finest first: each divides 200, so no cell straddles
 * a slice seam, and the payload ladder steps through them. */
export const AMBIENT_CELLS = [8, 10, 20, 25, 40, 50, 100, 200] as const;

/**
 * An Ambient pane's cell: the smallest width of AMBIENT_CELLS at least 8 px
 * and at least one stored tier entry wide (so a cell holds about one
 * recorded sample), stepped `step` widths coarser by the payload ladder.
 */
export function ambientCellPx(paneWidth: number, window: HistoryWindowId, step = 0): number {
	const spec = HISTORY_WINDOWS[window];
	const entryPx = (paneWidth * (TIERS[spec.tier] as { widthMs: number }).widthMs) / spec.windowMs;
	const base = AMBIENT_CELLS.findIndex((d) => d >= Math.max(8, entryPx - 0.01));
	const at = Math.min(AMBIENT_CELLS.length - 1, (base < 0 ? AMBIENT_CELLS.length - 1 : base) + Math.max(0, step));
	return AMBIENT_CELLS[at] as number;
}

/** The ladder step a strip bucket width stands for: 2 px (the default) is
 * the finest cell, 4 one step coarser, 8 two. */
function ambientStepOf(bucketPx: number): number {
	return bucketPx >= 8 ? 2 : bucketPx >= 4 ? 1 : 0;
}

/** The cell grid an Ambient pane draws on: whole cells aligned to group
 * coordinates inside the pane. */
export function ambientPlotOf(extent: PaneExtent, window: HistoryWindowId, bucketPx: number): PanePlot {
	const cell = ambientCellPx(extent.x1 - extent.x0, window, ambientStepOf(bucketPx));
	const x0 = Math.ceil(extent.x0 / cell) * cell;
	const x1 = Math.floor(extent.x1 / cell) * cell;
	return { x0, x1, bucketPx: cell, buckets: Math.max(0, (x1 - x0) / cell) };
}

/** A reading whose window range is smaller than this is drawn on this span,
 * centered, so jitter stays a calm thread (native units). */
export const QUIET_SPAN: Readonly<Record<string, number>> = { "°C": 5, "°F": 9, MHz: 200, "%": 10, W: 5, RPM: 100, V: 0.05, A: 1, x: 2 };

export function quietSpanOf(unit: string, lo: number, hi: number): number {
	return QUIET_SPAN[unit] ?? Math.max(1e-9, 0.02 * Math.max(Math.abs(lo), Math.abs(hi)));
}

// ---- color ------------------------------------------------------------------

function srgbOf(c: number): number {
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** An OKLCH color at lightness `L` and hue `h` (degrees), its chroma cut
 * until it is inside sRGB: every hue at the same perceived lightness. */
function oklchHex(L: number, C: number, h: number): string {
	const rad = (h * Math.PI) / 180;
	let c = C;
	for (let k = 0; k < 60; k++) {
		const lin = oklabToLinear(L, c * Math.cos(rad), c * Math.sin(rad));
		if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) {
			return `#${lin.map((v) => Math.round(Math.max(0, Math.min(1, srgbOf(v))) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
		}
		c *= 0.95;
	}
	return "#B4B4B4";
}

/** Ambient's one lightness (OKLCH L) and the chroma it pushes for. */
const LIGHTNESS = 0.72;
const CHROMA = 0.3;

/** Aurora's spectrum, top (a reading at its window maximum) to bottom:
 * red-orange through yellow, green and cyan to violet, nine stops, opacity
 * falling from 1 at the top to 0.4 at the bottom. */
export const AURORA_STOPS: readonly { readonly offset: number; readonly color: string; readonly opacity: number }[] = Array.from({ length: 9 }, (_, k) => {
	const f = k / 8;
	return { offset: f, color: oklchHex(LIGHTNESS, CHROMA, 28 + 280 * f), opacity: 1 - 0.6 * f };
});

const AURORA_PAINT = "am";
const AURORA_STALE_PAINT = "ams";
/** How much of its light a stale frame keeps. */
const AMBIENT_STALE_OPACITY = 0.45;

const r2 = (v: number): string => {
	const r = Math.round(v * 100) / 100;
	return r === 0 ? "0" : String(r);
};

function auroraPaint(id: string, dim: number): string {
	const stops = AURORA_STOPS.map((s) => `<stop offset="${r2(s.offset)}" stop-color="${s.color}"${s.opacity * dim < 1 ? ` stop-opacity="${r2(s.opacity * dim)}"` : ""}/>`).join("");
	return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${AMBIENT_TOP}" x2="0" y2="${AMBIENT_BOTTOM}">${stops}</linearGradient>`;
}

/** The curtain: five copies of the threads shifted up, wider and fainter
 * (the widest first), then the threads themselves. */
export const AURORA_PASSES: readonly { readonly dy: number; readonly width: number; readonly opacity: number }[] = [
	...[5, 4, 3, 2, 1].map((v) => ({ dy: -Math.round(v * (v + 1) * 1.1), width: Math.round((1.6 + v * 1.1) * 10) / 10, opacity: Math.round(0.3 * 0.66 ** (v - 1) * 100) / 100 })),
	{ dy: 0, width: 1.3, opacity: 1 }
];

// ---- the data -----------------------------------------------------------------

/** One reading as light: per cell its normalized value (0 at its window
 * minimum, 1 at its maximum; NaN where nothing was recorded) and the run
 * each cell belongs to (-1 outside every run). A run goes straight across a
 * brief boundary (runsOf, given `view`), always: Ambient has no setting for
 * it. The arrays are the build's scratch (graph.ts): read while the frame is
 * built. */
export type AmbientTrail = { readonly norm: Float64Array; readonly run: Int32Array; readonly runs: readonly { readonly j0: number; readonly j1: number }[] };

export function ambientTrail(bins: Bins, cells: number, unit: string, scratch = new Scratch(), view?: HistoryView): AmbientTrail {
	const norm = scratch.float64(cells).fill(Number.NaN);
	const run = scratch.int32(cells).fill(-1);
	const runs: { j0: number; j1: number }[] = [];
	if (bins.n === 0) return { norm, run, runs };
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < bins.n; i++) {
		if ((bins.min[i] as number) < lo) lo = bins.min[i] as number;
		if ((bins.max[i] as number) > hi) hi = bins.max[i] as number;
	}
	const quiet = quietSpanOf(unit, lo, hi);
	if (hi - lo < quiet) {
		const mid = (hi + lo) / 2;
		lo = mid - quiet / 2;
		hi = mid + quiet / 2;
	}
	runsOf(bins, view).forEach((r, k) => {
		const j0 = bins.j[r.from] as number;
		const j1 = bins.j[r.to - 1] as number;
		for (let i = r.from; i < r.to; i++) norm[bins.j[i] as number] = Math.min(1, Math.max(0, ((bins.last[i] as number) - lo) / (hi - lo)));
		for (let j = j0; j <= j1; j++) run[j] = k;
		runs.push({ j0, j1 });
	});
	return { norm, run, runs };
}

/** Removes points that lie exactly on the line through their neighbors
 * (flat stretches above all): the drawn geometry is identical. Reads the
 * first `len` values of `pts`. */
function dropCollinear(pts: ArrayLike<number>, len = pts.length): number[] {
	if (len <= 4) return Array.from({ length: len }, (_, i) => pts[i] as number);
	const out = [pts[0] as number, pts[1] as number];
	for (let i = 2; i < len - 2; i += 2) {
		const ax = out[out.length - 2] as number;
		const ay = out[out.length - 1] as number;
		const bx = pts[i] as number;
		const by = pts[i + 1] as number;
		const cx = pts[i + 2] as number;
		const cy = pts[i + 3] as number;
		if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) === 0) continue;
		out.push(bx, by);
	}
	out.push(pts[len - 2] as number, pts[len - 1] as number);
	return out;
}

const cellX = (plot: PanePlot, j: number): number => plot.x0 + j * plot.bucketPx + plot.bucketPx / 2;
const yOfNorm = (v: number): number => Math.round(AMBIENT_BOTTOM - Math.min(1, Math.max(0, v)) * (AMBIENT_BOTTOM - AMBIENT_TOP));

/** A trail's runs as polylines (one point per recorded cell). A lone point
 * is drawn as a zero-length step, a dot under the round caps. */
export function auroraLines(plot: PanePlot, trail: AmbientTrail, scratch = new Scratch()): number[][] {
	const out: number[][] = [];
	for (const r of trail.runs) {
		// Every recorded point first (scratch), then only the ones it draws.
		const pts = scratch.float64(2 * (r.j1 - r.j0 + 1));
		let len = 0;
		for (let j = r.j0; j <= r.j1; j++) {
			const v = trail.norm[j] as number;
			if (!Number.isFinite(v)) continue;
			pts[len++] = cellX(plot, j);
			pts[len++] = yOfNorm(v);
		}
		if (len === 0) continue;
		out.push(len === 2 ? [pts[0] as number, pts[1] as number, pts[0] as number, pts[1] as number] : dropCollinear(pts, len));
	}
	return out;
}

// ---- the pane -------------------------------------------------------------------

/** The mark and the notes: bold, at the strip's word size. */
const MARK_SIZE = 15;
const MARK_BASELINE = 95;
const WINDOW_LABEL: Readonly<Record<HistoryWindowId, string>> = { "1m": "1 min", "5m": "5 min", "15m": "15 min" };

/**
 * Draws an Ambient pane on its cell grid (f.plot from ambientPlotOf). The
 * caller has said why when there is nothing to draw. `reduced` is the
 * payload fallback past the ladder: the first half of the readings only,
 * and the mark says how many of how many.
 */
export function ambientPane(b: SceneBuilder, f: PaneFrame, info: GroupPaneInfo, reduced = false): void {
	const paneStart = b.prims.length;
	const all = f.input.series;
	const series = reduced ? all.slice(0, Math.max(1, Math.ceil(all.length / 2))) : all;
	const plot = f.plot;
	// Stale (or unavailable) is a source-wide state: the light dims as one.
	const stale = everyReadingStopped(series);
	const trails = series.map((s) => ambientTrail(s.history === undefined || plot.buckets === 0 ? NO_BINS : binView(s.history, plot.buckets, b.scratch), plot.buckets, drawnUnitOf(s), b.scratch, s.history));
	const lines = trails.flatMap((tr) => auroraLines(plot, tr, b.scratch));
	if (lines.length > 0) {
		const id = stale ? AURORA_STALE_PAINT : AURORA_PAINT;
		b.localDef(id, auroraPaint(id, stale ? AMBIENT_STALE_OPACITY : 1));
		const widest = Math.max(...AURORA_PASSES.map((p) => p.width));
		const skein: SkeinPrim = { k: "skein", layer: "base", id: `ag${f.index}`, lines, attrs: `fill="none" stroke="url(#${id})" stroke-linejoin="round" stroke-linecap="round"`, passes: AURORA_PASSES, reach: Math.ceil(widest / 2) + 1 };
		b.prims.push(skein);
	}
	ambientWords(b, f, info, series.length, all.length, stale, reduced, paneStart);
}

/** Whether every reading the source still lists has stopped: stale or
 * unavailable, a source-wide state. A missing reading says nothing either
 * way, and with none listed this is false. */
export function everyReadingStopped(series: readonly { readonly state: string }[]): boolean {
	const listed = series.filter((s) => s.state !== "missing");
	return listed.length > 0 && listed.every((s) => s.state === "stale" || s.state === "unavailable");
}

/** The mark at the bottom left of the pane's first present slot, and what
 * the pane leaves out at the bottom right of its last ("history full: 40
 * of 48", "48 of 53 shown"), in the slot's own slice. */
function ambientWords(b: SceneBuilder, f: PaneFrame, info: GroupPaneInfo, drawn: number, resolved: number, stale: boolean, reduced: boolean, paneStart: number): void {
	const unavailable = f.input.series.length > 0 && f.input.series.every((s) => s.state === "unavailable");
	const x = f.left + 6;
	// For a moment after a screen change the screen's name and place take
	// the mark's words; a stale or missing source keeps saying so.
	const mark = unavailable ? t("strip.ambient.unavailable") : stale ? t("strip.ambient.stale") : (b.screenWords(f, x, f.right - 6 - x, MARK_SIZE, 700) ?? t("strip.ambient.mark", { window: WINDOW_LABEL[f.window] }));
	const color = b.look.text.label;
	// With no panel and no edge (Clear, Stars, Nebula) a shadow keeps the
	// words readable over the picture.
	const shadowed = !b.look.halo && (b.look.background === "clear" || isArtLook(b.look.background));
	if (shadowed) b.inkText(x + 1, MARK_BASELINE + 1, "start", MARK_SIZE, 700, haloRingColor(b.look.palette), mark);
	b.inkText(x, MARK_BASELINE, "start", MARK_SIZE, 700, color, mark);
	const parts: string[] = [];
	const total = Math.max(info.sameUnit, resolved);
	if (reduced || total > drawn) parts.push(t("strip.group.shown", { shown: drawn, total }));
	const missing = f.input.series.filter((s) => s.state === "missing").length;
	if (missing > 0) parts.push(t("strip.group.notFound", { count: missing }));
	if (info.refused > 0) parts.push(t("strip.group.historyFull", { kept: resolved - info.refused, total: resolved }));
	// One note a slot, from the pane's last slot leftward, never in the
	// mark's slot and never over another word.
	const markSlot = Math.floor(x / SLICE_W);
	let slot = Math.floor((f.right - 1) / SLICE_W);
	for (const note of parts) {
		while (slot > markSlot && slot * SLICE_W + 6 >= f.left && estimateKeyTextWidth(note, MARK_SIZE, { fontWeight: 700 }) > Math.min(f.right, (slot + 1) * SLICE_W) - 6 - Math.max(f.left, slot * SLICE_W) - 6) slot--;
		if (slot <= markSlot) return;
		const right = Math.min(f.right, (slot + 1) * SLICE_W) - 6;
		const at = { x: right, y: MARK_BASELINE, anchor: "end" as const, size: MARK_SIZE, weight: 700 as const, text: note };
		if (b.clearOfText(at, paneStart)) {
			if (shadowed) b.inkText(right + 1, MARK_BASELINE + 1, "end", MARK_SIZE, 700, haloRingColor(b.look.palette), note);
			b.inkText(right, MARK_BASELINE, "end", MARK_SIZE, 700, color, note);
		}
		slot--;
	}
}
