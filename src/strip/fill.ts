/**
 * Meters' Full bar and Liquid looks (StripPaneV1.meterLook "full" and
 * "liquid"). Each reading takes Meters' cell (spreadCells, up to one per
 * dial slot); in it a frame as tall as the strip holds the reading as a
 * fill, and a column beside it, in the part of the cell's number slot
 * inside the cell, holds the reading's name over its value. No word sits
 * on the fill or crosses into the next cell, so the fill's end, the liquid
 * and its surface never touch a letter at any value or count of readings,
 * and every word keeps the 4.5:1 its look gives it on the panel. A
 * reading's words sit against its own frame: each takes the column's edge
 * toward that frame (right-aligned left of it, left-aligned right of it),
 * COLUMN_GAP from it, and another reading's words or frame keep BETWEEN, so
 * no word is nearer another reading's frame and two frames never read as one.
 *
 * - Full bar: the frame fills from its left end to the reading, ended by a
 *   2 px edge in the full color, the way Task Manager draws a usage bar.
 * - Liquid: the frame is a tank that fills from its bottom to a straight
 *   surface at the level, a vertical gradient strongest under the surface
 *   and fainter toward the bottom, and along the surface a line a step
 *   lighter (darker on a light look). The surface is the value alone, so it
 *   moves only on a frame with a new value, and paused, stale and missing
 *   readings add no motion.
 *
 * The scale: a percentage is 0 to 100 whatever Scale from and Scale to
 * hold; a reading past 100 fills the frame and prints its own number. Any
 * other unit takes Meters' scale (meterScale) and prints its ends under the
 * number. Quarter ticks mark 25, 50 and 75 % of the scale; with Time span on
 * a short mark shows the window's highest reading.
 *
 * The fill is the reading's chosen color, else the theme's accent, at the
 * strength that sets it 3.2:1 from the empty frame (fillStrengths). A limit
 * is a short mark in its alert color. Past it the fill beyond it takes the
 * alert color at least as strong as the bar, the frame takes the alert
 * color, a bar runs along the foot (3 px for warn, 6 for crit: size, not
 * only color, tells which) and the value takes the alert color exactly as
 * Meters draws it. Lower is worse: the whole fill in the value's level.
 * A stale, missing or unknown value draws its word in place of the number
 * and no fill.
 *
 * Paint: on Theme every tone is blended over the panel into one opaque
 * color; on a see-through look it is a two-stop gradient in user space
 * (the alpha in its stops, as Glass carries it), carried only by the
 * slices that use it. Paths, rectangles, text and those gradients only.
 */
import { flatPaint } from "../ui/glass";
import { estimateKeyTextWidth, inkSpan } from "../ui/format";
import { contrastRatio, luminance, mixToward, readableValueColor } from "../ui/text-colors";
import { GUTTER_HALF, SLICE_W, spreadCells, type SpreadCell } from "./geometry";
import { bandsOpenUpward, extentOf, toNative } from "./graph";
import { meterCells, meterScale, METER_NAME_SIZE, METER_PAD, METER_VALUE_MIN } from "./meters";
import { bandEdge, CellPaths, fillOf, ownBands, tidyRungs } from "./patterned";
import type { AreaPrim, EnvelopePrim, LinePrim } from "./prims";
import { fitNameRung, nameRungs, READOUT_OVERFLOW } from "./readout";
import type { PaneFrame, SceneBuilder, SeriesDraw } from "./scene";
import type { StripMeterLook } from "./settings";

/** The frame's rows (its 1 px outline from y 2 to 98, the fill inside from
 * 3 to 97) and its inset from the cell's outer edge. */
export const FILL_TOP = 2;
export const FILL_BOTTOM = 98;
const FILL_INSET = 2;
/** Between the frame and its own column. */
const COLUMN_GAP = 10;
/** Between one reading's frame and another reading's words or frame: twice
 * COLUMN_GAP, so each word is 10 px nearer its own frame than any other and
 * a frame groups with its own words, never with the next reading's frame. */
const BETWEEN = 2 * COLUMN_GAP;
/** The column takes at most this share of its cell. */
const COLUMN_SHARE = 0.45;
/** The value's largest size and its rows; the name's row; the words at the
 * column's foot (PAUSED, a screen's name, another unit's scale ends). */
export const FILL_VALUE_MAX = 52;
const VALUE_BASELINE = 80;
const NAME_BASELINE = 17;
const FOOT_SIZE = 12;
const FOOT_BASELINE = 96;
const SCREEN_SIZE = 11;
const UNIT_GAP = 4;
/** The fill against the empty frame, and the range its strength keeps. */
const FILL_CONTRAST = 3.2;
const STRENGTH_MIN = 0.3;
const STRENGTH_MAX = 0.85;
/** Past a limit: this much stronger than the bar, at most ALERT_MAX. */
const ALERT_STEP = 0.2;
const ALERT_MAX = 0.95;
/** The frame's strength under no alert. */
const FRAME_STRENGTH = 0.5;
/** Marks: a quarter tick, a limit's mark, the window's peak, the foot bar. */
const QUARTER_TICK = 4;
const MARK_LONG = 8;
const MARK_THICK = 2;
const FOOT_BAR = { warn: 3, crit: 6 } as const;
/** The liquid: the depth over which it goes from its surface tone to its
 * deep tone, and that deep tone's share of the surface's strength. */
const DEPTH = 64;
const DEEP_SHARE = 0.55;

/** What the formatter writes alone for a value it cannot show (U+2014). */
const NO_VALUE = String.fromCharCode(0x2014);
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;

function inkWidth(text: string, size: number, weight: 600 | 700 = 700): number {
	const span = inkSpan([{ text, fontSize: size, fontWeight: weight }]);
	return Math.max(0, span.right - span.left);
}

/** The unit beside a value of `size`. */
const unitSizeOf = (size: number): number => Math.max(14, Math.min(20, Math.round(size * 0.36)));

/** The smallest strength (0 to 1, in hundredths) at which `color` over
 * `surface` stands `floor`:1 from it, within the strength range. */
function strengthFor(surface: string, color: string, floor: number, max = STRENGTH_MAX): number {
	for (let k = STRENGTH_MIN; k < max; k += 0.01) if (contrastRatio(mixToward(surface, color, r2(k)), surface) >= floor) return r2(k);
	return max;
}

/**
 * The strengths a fill of `color` takes over `surface`: the bar's, at
 * FILL_CONTRAST from the empty frame, and past each limit its alert color's,
 * ALERT_STEP stronger and at least as far from the empty frame as the bar
 * (on a dark look, so at least as bright).
 */
export function fillStrengths(surface: string, color: string, alerts: { readonly warn: string; readonly crit: string }): FillStrengths {
	// Pure, over a few theme and reading colors, and asked for every meter
	// of every frame: remembered.
	const key = `${surface}|${color}|${alerts.warn}|${alerts.crit}`;
	const known = STRENGTHS.get(key);
	if (known !== undefined) return known;
	const body = strengthFor(surface, color, FILL_CONTRAST);
	const bar = contrastRatio(mixToward(surface, color, body), surface);
	const alert = (c: string): number => Math.min(ALERT_MAX, Math.max(r2(body + ALERT_STEP), strengthFor(surface, c, bar, ALERT_MAX)));
	const out = { body, warn: alert(alerts.warn), crit: alert(alerts.crit) };
	if (STRENGTHS.size >= STRENGTHS_MAX) STRENGTHS.clear();
	STRENGTHS.set(key, out);
	return out;
}

type FillStrengths = { readonly body: number; readonly warn: number; readonly crit: number };
const STRENGTHS = new Map<string, FillStrengths>();
const STRENGTHS_MAX = 256;

type Span = { readonly x0: number; readonly x1: number };
/** A cell's column and frame; `first` when the column is left of the frame. */
type Place = { readonly col: Span; readonly frame: Span; readonly first: boolean };

/** The part of a cell's dial slot inside the cell: a cell narrower or
 * wider than a dial can start or end inside its slot, and the column stays
 * within both, so its words never reach a seam or the cell beside it. */
function ownSlot(cell: SpreadCell): Span {
	return { x0: Math.max(cell.x0, cell.slotX0), x1: Math.min(cell.x1, cell.slotX1) };
}

/**
 * Each cell's column and frame. The column sits in the part of the dial
 * slot that holds the cell's number, at the end of the cell with less room
 * beside it; the frame takes the rest, COLUMN_GAP from the column. Past the
 * frame's other end it keeps BETWEEN from another reading's column, half of
 * BETWEEN from another reading's frame (that frame keeps the other half),
 * and at a split's gutter BETWEEN from where the other half's column can
 * sit; at the strip's own end FILL_INSET is enough. Every frame of the pane
 * keeps the most of these, and a split's half at least the gutter's, so a
 * pane's frames are equally wide and so are two halves alike (CPU and RAM
 * usage). Stored setup only.
 */
function placesOf(extent: Span, cells: readonly SpreadCell[], colW: number): Place[] {
	const cols = cells.map((cell) => {
		const slot = ownSlot(cell);
		const first = cell.x1 - slot.x1 > slot.x0 - cell.x0;
		const x0 = first ? slot.x0 + METER_PAD : slot.x1 - METER_PAD - colW;
		return { first, col: { x0, x1: x0 + colW } };
	});
	// The strip's ends sit on a seam; a split's gutter edges GUTTER_HALF off one.
	const atGutter = (x: number): boolean => x % SLICE_W !== 0;
	const gutter = BETWEEN - METER_PAD - 2 * GUTTER_HALF;
	// What lies past a cell's end: the strip's end, the gutter, or the next
	// cell's frame or column.
	const insetAt = (i: number, left: boolean): number => {
		const next = cols[left ? i - 1 : i + 1];
		const cell = cells[i] as SpreadCell;
		if (next === undefined) return atGutter(left ? extent.x0 : extent.x1) ? gutter : FILL_INSET;
		if (next.first === left) return BETWEEN / 2;
		return Math.max(FILL_INSET, BETWEEN - (left ? cell.x0 - next.col.x1 : next.col.x0 - cell.x1));
	};
	const inset = Math.max(atGutter(extent.x0) || atGutter(extent.x1) ? gutter : FILL_INSET, ...cols.map(({ first }, i) => insetAt(i, !first)));
	return cols.map(({ first, col }, i) => {
		const cell = cells[i] as SpreadCell;
		const frame = first ? { x0: col.x1 + COLUMN_GAP, x1: cell.x1 - inset } : { x0: cell.x0 + inset, x1: col.x0 - COLUMN_GAP };
		return { col, frame, first };
	});
}

/** The x that sets a word's ink edge on `edge` under `anchor`: its right
 * edge with "end", its left with "start". */
function inkAt(text: string, size: number, weight: 600 | 700, anchor: "start" | "end", edge: number): number {
	const span = inkSpan([{ text, fontSize: size, fontWeight: weight }]);
	return anchor === "end" ? edge + span.advance - span.right : edge - span.left;
}

export function fillStyle(b: SceneBuilder, f: PaneFrame, draws: readonly SeriesDraw[], present: readonly boolean[], look: StripMeterLook): void {
	const t0 = b.look.text;
	const shown = draws.slice(0, meterCells(f.extent).length);
	if (shown.length === 0) return;
	const cells = spreadCells(f.extent, shown.length, "last", present);
	const fahrenheit = b.measure.fahrenheit;
	const surface = b.look.surface;
	const theme = b.look.background === "theme";
	const clear = b.look.background === "clear";
	const peers = shown.map((d) => d.input.name || d.input.key);
	const values = shown.map((d) => b.readoutValue(f, d));
	type FillText = { readonly value?: string; readonly fallback?: readonly string[]; readonly word?: string; readonly unit: string; readonly sizing: readonly string[]; readonly setupUnit: string };
	const texts = shown.map((d, i): FillText => {
		const v = values[i];
		const m = v === undefined ? undefined : b.formatOf(d, v);
		const e = extentOf(d.bins);
		const unitText = m?.unitText ?? (e === null ? "" : b.formatOf(d, e.hi).unitText);
		const numeric = m !== undefined && m.valueText !== NO_VALUE;
		return { ...(numeric ? { value: m.valueText, fallback: v === undefined ? [] : b.fallbackOf(d, v, m.unitText) } : { word: b.statusOf(d) ?? "no data" }), unit: f.pane.overlays.unit ? unitText : "", sizing: b.setupSizing(d), setupUnit: f.pane.overlays.unit ? b.setupUnit(d) : "" };
	});
	// One value size and one column width for the pane, from each setup's
	// widest number and unit and each name, never from a value.
	const blockW = (i: number, size: number): number => {
		const m = texts[i] as (typeof texts)[number];
		return Math.ceil(Math.max(0, ...m.sizing.map((s) => inkWidth(s, size))) + (m.setupUnit === "" ? 0 : UNIT_GAP + estimateKeyTextWidth(m.setupUnit, unitSizeOf(size), { fontWeight: 600 })));
	};
	const capOf = (c: SpreadCell): number => {
		const slot = ownSlot(c);
		return Math.min(slot.x1 - slot.x0 - 2 * METER_PAD, Math.floor((c.x1 - c.x0) * COLUMN_SHARE));
	};
	let size = FILL_VALUE_MAX;
	while (size > METER_VALUE_MIN && !cells.every((c, i) => blockW(i, size) <= capOf(c))) size--;
	const nameW = f.pane.overlays.legend ? Math.max(0, ...peers.map((p) => Math.ceil(estimateKeyTextWidth(p, METER_NAME_SIZE, { fontWeight: 600 })))) : 0;
	const colW = Math.min(Math.min(...cells.map(capOf)), Math.max(...shown.map((_, i) => blockW(i, size)), nameW));
	const unitSize = unitSizeOf(size);
	const places = placesOf(f.extent, cells, colW);
	const drawn = shown.map((_, i) => i).filter((i) => present[(cells[i] as SpreadCell).column] !== false);
	const last = drawn[drawn.length - 1];
	const paused = f.input.view.mode === "paused";
	const marks = new CellPaths();
	const fills = new CellPaths();
	const backs = new CellPaths();
	const lines: (AreaPrim | EnvelopePrim | LinePrim)[] = [];
	const liquids: (AreaPrim | EnvelopePrim)[] = [];
	// A tone of `color` at strength `k` over the panel: opaque on Theme, a
	// slice-local flat paint elsewhere.
	const tones = new Map<string, string>();
	const tone = (color: string, k: number): string => {
		if (theme) return fillOf(mixToward(b.look.palette.bg, color, k));
		const key = `${color}/${k}`;
		let id = tones.get(key);
		if (id === undefined) {
			id = `mf${f.index}${tones.size}`;
			tones.set(key, id);
			b.localDef(id, flatPaint(id, color, k));
		}
		return `fill="url(#${id})"`;
	};
	for (const i of drawn) {
		const d = shown[i] as SeriesDraw;
		const text = texts[i] as (typeof texts)[number];
		const { col, frame, first } = places[i] as Place;
		const color = f.pane.series[d.index]?.color ?? b.look.palette.accent;
		const k = fillStrengths(surface, color, b.alertColors);
		const value = values[i];
		const current = value !== undefined && text.value !== undefined;
		const level = b.levelOf(f, d, value);
		const upward = bandsOpenUpward(f.input.bands, d.input.key);
		const bands = ownBands(f.input.bands, d.input.key).map((band) => ({ band, edge: toNative(bandEdge(band, upward), d.unit, fahrenheit) })).filter((x) => Number.isFinite(x.edge));
		// The scale: a percentage 0 to 100, else Meters' own.
		const percent = d.unit === "%";
		const scale = percent ? null : meterScale(b, f, d);
		const lo = scale?.lo ?? 0;
		const hi = scale?.hi ?? 100;
		const shareOf = (native: number): number => {
			const s = (native - lo) / (hi - lo);
			return Math.min(1, Math.max(0, Number.isFinite(s) ? s : 0));
		};
		const inner = { x0: frame.x0 + 1, x1: frame.x1 - 1, y0: FILL_TOP + 1, y1: FILL_BOTTOM - 1 };
		const xOf = (native: number): number => Math.round(inner.x0 + shareOf(native) * (inner.x1 - inner.x0));
		const yOf = (native: number): number => inner.y1 - shareOf(native) * (inner.y1 - inner.y0);
		const frameColor = level !== null ? b.alertColors[level] : mixToward(surface, color, FRAME_STRENGTH);
		const framePaint = fillOf(frameColor);
		if (inner.x1 - inner.x0 >= 8) {
			// The frame (on Clear over a ring in the track color: no panel backs it).
			if (clear) {
				const back = `fill="${b.look.palette.track}"`;
				backs.add(back, frame.x0 - 1, FILL_TOP - 1, frame.x1 - frame.x0 + 2, 1);
				backs.add(back, frame.x0 - 1, FILL_BOTTOM, frame.x1 - frame.x0 + 2, 1);
				backs.add(back, frame.x0 - 1, FILL_TOP, 1, FILL_BOTTOM - FILL_TOP);
				backs.add(back, frame.x1, FILL_TOP, 1, FILL_BOTTOM - FILL_TOP);
			}
			marks.add(framePaint, frame.x0, FILL_TOP, frame.x1 - frame.x0, 1);
			marks.add(framePaint, frame.x0, FILL_BOTTOM - 1, frame.x1 - frame.x0, 1);
			marks.add(framePaint, frame.x0, inner.y0, 1, inner.y1 - inner.y0);
			marks.add(framePaint, frame.x1 - 1, inner.y0, 1, inner.y1 - inner.y0);
			// The fill, in pieces at each limit it passes: higher is worse,
			// each piece past a limit in that limit's color; lower is worse,
			// the whole fill in the value's level.
			const tester = b.levelTester(f, d);
			const zero = Math.min(Math.max(0, lo), hi);
			type Piece = { a: number; c: number; level: "warn" | "crit" | null };
			const pieces: Piece[] = [];
			if (current) {
				const from = Math.min(zero, value);
				const to = Math.max(zero, value);
				const cuts = bands.map((x) => x.edge).filter((v) => v > from && v < to).sort((a, c) => a - c);
				const points = [from, ...cuts, to];
				for (let n = 0; n + 1 < points.length; n++) {
					const a = points[n] as number;
					const c = points[n + 1] as number;
					pieces.push({ a, c, level: upward ? tester((a + c) / 2) : level });
				}
			}
			const colorOf = (l: "warn" | "crit" | null): string => (l === null ? color : b.alertColors[l]);
			const strengthOf = (l: "warn" | "crit" | null): number => (l === null ? k.body : k[l]);
			const top = pieces[pieces.length - 1];
			if (look === "full") {
				for (const p of pieces) {
					const xa = xOf(p.a);
					const xc = xOf(p.c);
					if (xc > xa) fills.add(tone(colorOf(p.level), strengthOf(p.level)), xa, inner.y0, xc - xa, inner.y1 - inner.y0);
				}
				if (current && top !== undefined) {
					const end = xOf(value);
					const edge = value >= zero ? Math.max(inner.x0, end - 2) : end;
					if (Math.abs(end - xOf(zero)) >= 1) marks.add(fillOf(level !== null ? b.alertColors[level] : color), edge, inner.y0, 2, inner.y1 - inner.y0);
				}
			} else if (current && shareOf(value) > 0) {
				// The liquid rises from the bottom to its surface, one straight
				// line at the level.
				const yl = yOf(value);
				const pts = [inner.x0, r1(yl), inner.x1, r1(yl)];
				// Lower is worse: the whole liquid in the value's level.
				const body = !upward && level !== null ? level : null;
				const bodyColor = colorOf(body);
				const kTop = strengthOf(body);
				const id = `ml${f.index}${i}`;
				const stop = (offset: number, kk: number): string => (theme ? `<stop offset="${offset}" stop-color="${mixToward(b.look.palette.bg, bodyColor, kk)}"/>` : `<stop offset="${offset}" stop-color="${bodyColor}" stop-opacity="${r2(kk)}"/>`);
				b.localDef(id, `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x2="0" y1="${r1(yl)}" y2="${r1(yl + DEPTH)}">${stop(0, kTop)}${stop(1, kTop * DEEP_SHARE)}</linearGradient>`);
				liquids.push({ k: "area", layer: "base", pts, base: inner.y1, paint: `fill="url(#${id})"` });
				// Higher is worse: the liquid past each limit in its color, from
				// the limit's line up to the next limit or the surface.
				let surfaceColor = bodyColor;
				if (upward) {
					for (const p of pieces) {
						if (p.level === null) continue;
						const yBottom = r1(yOf(p.a));
						const yTop = p === top ? Math.min(r1(yl), yBottom) : r1(yOf(p.c));
						liquids.push({ k: "envelope", layer: "base", top: [inner.x0, yTop, inner.x1, yTop], bottom: [inner.x0, yBottom, inner.x1, yBottom], paint: tone(b.alertColors[p.level], k[p.level]) });
						if (p === top) surfaceColor = b.alertColors[p.level];
					}
				}
				// The line along the surface, a step lighter (darker on a light look).
				const glint = luminance(surface) > 0.4 ? surfaceColor : mixToward(surfaceColor, "#FFFFFF", 0.35);
				lines.push({ k: "line", layer: "marks", pts, stroke: glint, width: 1.5 });
			}
			// Quarter ticks: along the top and foot of a bar, on a tank's left wall.
			for (const q of [0.25, 0.5, 0.75]) {
				const native = lo + q * (hi - lo);
				if (look === "full") {
					const x = xOf(native);
					marks.add(framePaint, x, inner.y0, 1, QUARTER_TICK);
					marks.add(framePaint, x, inner.y1 - QUARTER_TICK, 1, QUARTER_TICK);
				} else marks.add(framePaint, inner.x0, Math.round(yOf(native)), QUARTER_TICK, 1);
			}
			// Each limit: a short mark in its alert color where it falls.
			for (const { band, edge } of bands) {
				if (!(edge > lo && edge < hi)) continue;
				const paint = fillOf(b.alertColors[band.level]);
				if (look === "full") marks.add(paint, Math.min(inner.x1 - MARK_THICK, Math.max(inner.x0, xOf(edge) - 1)), inner.y0, MARK_THICK, MARK_LONG);
				else marks.add(paint, inner.x0, Math.round(yOf(edge)) - 1, MARK_LONG, MARK_THICK);
			}
			// With Time span on, the window's highest reading as a short mark.
			const e = extentOf(d.bins);
			if (f.pane.overlays.time && e !== null && current) {
				const peakPaint = fillOf(color);
				if (look === "full") {
					const x = xOf(e.hi);
					if (Math.abs(x - xOf(value)) >= 3) marks.add(peakPaint, Math.min(inner.x1 - MARK_THICK, Math.max(inner.x0, x - 1)), inner.y1 - MARK_LONG, MARK_THICK, MARK_LONG);
				} else {
					const y = yOf(e.hi);
					if (Math.abs(y - yOf(value)) >= 3) marks.add(peakPaint, inner.x1 - MARK_LONG, Math.round(y) - 1, MARK_LONG, MARK_THICK);
				}
			}
			// Past a limit, a bar along the foot: 3 px for warn, 6 for crit.
			if (level !== null) marks.add(fillOf(b.alertColors[level]), inner.x0, inner.y1 - FOOT_BAR[level], inner.x1 - inner.x0, FOOT_BAR[level]);
		}
		// The column: the name at its top, the value and its unit, the words
		// at its foot, each with its ink's edge on the column's edge toward
		// its own frame (right-aligned left of the frame, left-aligned right
		// of it), so a reading's words sit against its own frame.
		const anchor = first ? "end" : "start";
		const word = (y: number, s: number, weight: 600 | 700, fill: string, words: string, edge = first ? col.x1 : col.x0): void => {
			b.inkText(inkAt(words, s, weight, anchor, edge), y, anchor, s, weight, fill, words);
		};
		if (f.pane.overlays.legend) {
			const name = fitNameRung(tidyRungs(nameRungs(d.input.name || d.input.key, peers)), METER_NAME_SIZE, col.x1 - col.x0);
			if (name !== "") word(NAME_BASELINE, METER_NAME_SIZE, 600, t0.label, name);
		}
		if (text.value !== undefined) {
			const unitW = text.unit === "" ? 0 : inkWidth(text.unit, unitSize, 600);
			const room = col.x1 - col.x0 - (unitW === 0 ? 0 : unitW + UNIT_GAP);
			const sizeFor = (t: string): number | null => {
				for (let s = size; s >= METER_VALUE_MIN; s--) if (inkWidth(t, s) <= room) return s;
				return null;
			};
			const own = [text.value, ...(text.fallback ?? [])];
			const fits = own.find((t) => sizeFor(t) !== null);
			const valueText = fits ?? ((text.fallback ?? []).length === 0 ? READOUT_OVERFLOW : (own[own.length - 1] as string));
			const valueSize = fits === undefined ? METER_VALUE_MIN : (sizeFor(fits) as number);
			const valueColor = level !== null ? b.alertColors[level] : clear ? t0.value : readableValueColor(color, surface);
			// The unit ends the row left of the frame and follows the value right of it.
			const unitGap = unitW === 0 ? 0 : unitW + UNIT_GAP;
			if (text.unit !== "") word(VALUE_BASELINE, unitSize, 600, t0.unit, text.unit, first ? col.x1 : col.x0 + inkWidth(valueText, valueSize) + UNIT_GAP);
			word(VALUE_BASELINE, valueSize, 700, valueColor, valueText, first ? col.x1 - unitGap : col.x0);
		} else {
			word(VALUE_BASELINE, 18, 600, t0.unit, text.word ?? "no data");
		}
		const room = col.x1 - col.x0;
		const fitted = (words: string, s: number, weight: 600 | 700): boolean => b.widthOf(words, s, weight) <= room;
		const said = i === last && !paused ? b.screenWords(f, col.x0, room, SCREEN_SIZE, 700) : undefined;
		if (i === last && paused) {
			const full = ["PAUSED", b.cursorNote(f)].filter((s) => s !== undefined).join(" ");
			word(FOOT_BASELINE, FOOT_SIZE, 700, t0.badge, fitted(full, FOOT_SIZE, 700) ? full : "PAUSED");
		} else if (said !== undefined) {
			word(FOOT_BASELINE, SCREEN_SIZE, 700, t0.unit, said);
		} else if (scale !== null) {
			const ends = `${scale.loText} to ${scale.hiText}`;
			if (fitted(ends, FOOT_SIZE, 600)) word(FOOT_BASELINE, FOOT_SIZE, 600, scale.cue.hi ?? scale.cue.lo ?? t0.unit, ends);
		}
	}
	b.prims.push(...backs.prims("marks"), ...fills.prims("base"), ...liquids, ...lines, ...marks.prims("marks"));
}
