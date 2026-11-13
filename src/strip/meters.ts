/**
 * The Meters style: the readings spread across the pane in equal cells, up
 * to one per dial slot, for reading the strip from the chair. No number
 * crosses a seam (two slices are never presented at the same instant): a
 * cell's value sits in the dial slot that holds most of the cell. Each cell
 * holds:
 *
 * - the reading's name, shortened by whole words, never cut mid-word, beside
 *   the number where the cell leaves room (besideOf), else over it;
 * - its value now (at the cursor when paused), at one size shared by every
 *   meter of the pane: the largest up to METER_VALUE_WIDE (a name beside it)
 *   or METER_VALUE_MAX (a name over it) at which the widest usual number of
 *   each reading's setup fits its slot (SceneBuilder.setupSizing), so the size
 *   never moves with a value; a value wider than its setup steps down on its
 *   own, in place. METER_VALUE_MAX puts the digits at 30 px of cap height in
 *   Tahoma and Segoe UI alike;
 * - where the cell leaves room, with Time span on, the window as a line on the
 *   bar's own scale;
 * - a bar across the cell from the scale's low end to the value, the part
 *   past a limit in the limit's alert color; a stale, missing or unknown value
 *   draws its word in place of the number and no bar (it is not current);
 * - the window's lowest to highest reading as a thin band under the bar,
 *   with end ticks: the window's history is real even when the value is
 *   stale;
 * - each limit as a tick in its alert color across the bar's row, with its
 *   number under it when it clears the scale's ends: a limit is never
 *   shown by color alone;
 * - the scale's ends, always printed: from zero (or a round floor under a
 *   negative reading, or the typed Scale from) to a round top that keeps
 *   every limit on the scale (100 for a percentage, or the typed Scale
 *   to).
 *
 * The window's words, a moment's screen name and place, or PAUSED and the
 * cursor's time sit at the top right of the last meter, or with room beside
 * its number at the foot of that room, under its line.
 */
import { estimateKeyTextWidth, inkSpan } from "../ui/format";
import { mixToward, readableValueColor } from "../ui/text-colors";
import { besideOf, SLICE_W, spreadCells, type PaneExtent, type SpreadCell } from "./geometry";
import { endText } from "./scale";
import { bandsOpenUpward, extentOf, toNative } from "./graph";
import { bandEdge, CellPaths, fillOf, ownBands, tidyRungs, windowWords } from "./patterned";
import { fitNameRung, nameRungs, READOUT_OVERFLOW } from "./readout";
import type { PaneFrame, SceneBuilder, SeriesDraw } from "./scene";

/** The largest and smallest value size: 43 px puts the digits' cap height
 * at 31.3 px in Tahoma Bold and 30.1 px in Segoe UI Bold. */
export const METER_VALUE_MAX = 43;
export const METER_VALUE_MIN = 18;
/** The value's size where its name sits beside it (a cell of two slots or
 * more): from the bar's row up to the strip's top edge. */
export const METER_VALUE_WIDE = 66;
/** The window's line beside the number, in the name's row and the bar's. The
 * last meter's stops above the words at the foot of its room, so a reading
 * near the scale's low end keeps its newest stretch in sight. */
const METER_TREND_TOP = 22;
const METER_TREND_BOTTOM = 58;
const METER_TREND_ABOVE_WORDS = 46;
/** The window's words at the foot of the room beside the number, the size
 * of the scale's row. */
const METER_WINDOW_SIZE = 12;
const METER_WINDOW_BASELINE = 58;
/** A cell's inner margin, and its rows (baselines and bands, top down). */
export const METER_PAD = 8;
export const METER_NAME_SIZE = 15;
export const METER_NAME_BASELINE = 16;
/** The window or PAUSED at the top right of the last meter, bold. A
 * screen's name and place, longer, keep the 11 px they were measured at:
 * in a third of the meter less they would cost the meter its name. */
export const METER_BADGE_SIZE = 13;
const METER_SCREEN_SIZE = 11;
/** The scale's ends and the limits' numbers on the bottom row: the
 * largest at which a limit keeps its word beside its tick between the
 * scale's ends ("warn 1200" on a 0 to 3000 meter). */
export const METER_SCALE_SIZE = 12;
export const METER_VALUE_BASELINE = 56;
export const METER_UNIT_SIZE = 14;
export const METER_BAR_Y = 63;
export const METER_BAR_H = 8;
export const METER_RANGE_Y = 77;
export const METER_LIMIT_Y = 60;
export const METER_LIMIT_H = 16;
export const METER_SCALE_BASELINE = 94;
const UNIT_GAP = 4;

/** A right-anchored text `w` wide, moved the least that takes its drawn box
 * (its ink and SceneBuilder.inkText's margin) off a seam, and no further right
 * than `limit`. */
function offSeam(right: number, w: number, seams: readonly number[], limit: number): number {
	const seam = seams.find((x) => right - w - 3 < x && x < right + 3);
	if (seam === undefined) return right;
	const after = seam + 4 + w;
	const before = seam - 3;
	return after <= limit && Math.abs(after - right) <= Math.abs(before - right) ? after : before;
}

/** The cells of a pane: one per dial slot it covers, inside the pane. */
export function meterCells(extent: PaneExtent): { readonly column: number; readonly x0: number; readonly x1: number }[] {
	const out: { column: number; x0: number; x1: number }[] = [];
	for (let c = Math.floor(extent.x0 / SLICE_W); c * SLICE_W < extent.x1; c++) out.push({ column: c, x0: Math.max(extent.x0, c * SLICE_W), x1: Math.min(extent.x1, (c + 1) * SLICE_W) });
	return out;
}

function inkWidth(text: string, size: number, weight: 600 | 700 = 700): number {
	const span = inkSpan([{ text, fontSize: size, fontWeight: weight }]);
	return Math.max(0, span.right - span.left);
}

/** A meter's scale, native: its ends, their texts, and the color a typed
 * end a reading has passed takes (absent: the unit's ink). */
export type MeterScale = { readonly lo: number; readonly hi: number; readonly loText: string; readonly hiText: string; readonly cue: { readonly lo?: string; readonly hi?: string } };

/** The most ticks a meter's scale rounds to. */
const METER_TICKS = 5;

/**
 * A reading's scale, held like every strip scale (key "m:<reading key>",
 * src/strip/scale.ts) on Meters' own rule: from zero (a round floor under a
 * negative reading) to a round top over the window, the value now and every
 * limit (100 for a percentage), no headroom (a meter is a bar to its
 * value); a typed end for readings in its unit kept as typed (an unstamped
 * scale reaches every meter, as before the stamp).
 */
export function meterScale(b: SceneBuilder, f: PaneFrame, d: SeriesDraw): MeterScale {
	const fahrenheit = b.measure.fahrenheit;
	const e = extentOf(d.bins);
	const values: number[] = [];
	if (e !== null) values.push(e.lo, e.hi);
	const v = d.input.current;
	if (v !== undefined && Number.isFinite(v)) values.push(v);
	const upward = bandsOpenUpward(f.input.bands, d.input.key);
	for (const band of ownBands(f.input.bands, d.input.key)) {
		const edge = bandEdge(band, upward);
		if (Number.isFinite(edge)) values.push(toNative(edge, d.unit, fahrenheit));
	}
	const need = values.length === 0 ? { lo: 0, hi: 0 } : { lo: Math.min(...values), hi: Math.max(...values) };
	const kept = b.typedEnds(d.unit, true);
	const fixedUnit = b.fixedUnitOf([d]);
	const s = b.scaleFor(`m:${d.input.key}`, d.unit, need, METER_TICKS, { ...(kept === undefined ? {} : { kept }), meter: true, ...(fixedUnit === undefined ? {} : { fixedUnit }) });
	const st = s?.st ?? null;
	if (s === null || st === null) return { lo: 0, hi: 1, loText: "0", hiText: "1", cue: {} };
	return { lo: s.held.lo, hi: s.held.hi, loText: endText(st.ticks.lo, st, true), hiText: endText(st.ticks.hi, st, true), cue: b.passedEnds(f, [d], s, d.index) };
}

type MeterText = {
	readonly value?: string;
	/** A reading with its own format: its value with no decimals, then
	 * compact (measure.ts exactFallback), for a value that cannot fit. */
	readonly fallback?: readonly string[];
	/** The unit drawn beside the value. */
	readonly unit: string;
	/** What the setup sizes the meter by: the widest number and the unit
	 * (SceneBuilder.setupSizing, setupUnit), whatever it reads now. */
	readonly sizing: readonly string[];
	readonly setupUnit: string;
	readonly word?: string;
};

/** The largest value size, from `max` down, at which every meter's setup
 * (its widest usual number, MeterText.sizing) fits its dial slot;
 * METER_VALUE_MIN when none does. A value never changes it. */
export function meterValueSize(texts: readonly MeterText[], slotWidths: readonly number[], max: number = METER_VALUE_MAX): number {
	for (let size = max; size > METER_VALUE_MIN; size--) {
		if (texts.every((m, i) => setupFits(m, slotWidths[i] as number, size))) return size;
	}
	return METER_VALUE_MIN;
}

function unitRoom(m: MeterText): number {
	return m.setupUnit === "" ? 0 : UNIT_GAP + estimateKeyTextWidth(m.setupUnit, METER_UNIT_SIZE, { fontWeight: 600 });
}

function setupFits(m: MeterText, slotW: number, size: number): boolean {
	const widest = Math.max(0, ...m.sizing.map((s) => inkWidth(s, size)));
	return widest + unitRoom(m) + 1 <= slotW - 2 * METER_PAD;
}

/** The size a value draws at: the pane's, or on its own smaller where the
 * value is wider than the `room` its slot leaves left of where its ink ends
 * (in place, nothing else moves); null when it cannot fit even at
 * METER_VALUE_MIN. */
function valueSizeOf(value: string, room: number, size: number): number | null {
	for (let s = size; s >= METER_VALUE_MIN; s--) if (inkWidth(value, s) <= room) return s;
	return null;
}

export function metersStyle(b: SceneBuilder, f: PaneFrame, draws: readonly SeriesDraw[], present: readonly boolean[]): void {
	const t0 = b.look.text;
	const shown = draws.slice(0, meterCells(f.extent).length);
	if (shown.length === 0) return;
	const cells = spreadCells(f.extent, shown.length, "last", present);
	const fahrenheit = b.measure.fahrenheit;
	const peers = shown.map((d) => d.input.name || d.input.key);
	const values = shown.map((d) => b.readoutValue(f, d));
	const texts: MeterText[] = shown.map((d, i) => {
		const v = values[i];
		const m = v === undefined ? undefined : b.formatOf(d, v);
		const e = extentOf(d.bins);
		const unitText = m?.unitText ?? (e === null ? "" : b.formatOf(d, e.hi).unitText);
		const fallback = v === undefined || m === undefined ? [] : b.fallbackOf(d, v, m.unitText);
		return { ...(m === undefined || m.valueText === "—" ? {} : { value: m.valueText }), ...(fallback.length === 0 ? {} : { fallback }), unit: f.pane.overlays.unit ? unitText : "", sizing: b.setupSizing(d), setupUnit: f.pane.overlays.unit ? b.setupUnit(d) : "", ...(m === undefined || m.valueText === "—" ? { word: b.statusOf(d) ?? "no data" } : {}) };
	});
	// A cell with room beside its number holds the name there, so the number
	// takes the height the name's row would.
	const wide = cells.every((c) => besideOf(c) !== null);
	const size = meterValueSize(texts, cells.map((c) => c.slotX1 - c.slotX0), wide ? METER_VALUE_WIDE : METER_VALUE_MAX);
	const seamsIn = (x0: number, x1: number): number[] => {
		const out: number[] = [];
		for (let seam = (Math.floor(x0 / SLICE_W) + 1) * SLICE_W; seam < x1; seam += SLICE_W) out.push(seam);
		return out;
	};
	const drawn = shown.map((_, i) => i).filter((i) => present[(cells[i] as SpreadCell).column] !== false);
	const last = drawn[drawn.length - 1];
	const paused = f.input.view.mode === "paused";
	const badge = paused ? ["PAUSED", b.cursorNote(f)].filter((s) => s !== undefined).join(" ") : f.pane.overlays.time ? `range ${windowWords(f.windowMs)}` : "";
	const bars = new CellPaths();
	const backs = new CellPaths();
	const tracks = new CellPaths();
	const clear = b.look.background === "clear";
	for (const i of drawn) {
		const d = shown[i] as SeriesDraw;
		const cell = cells[i] as SpreadCell;
		const text = texts[i] as MeterText;
		const left = cell.x0 + METER_PAD;
		const right = cell.x1 - METER_PAD;
		const scale = meterScale(b, f, d);
		const nativeLo = scale.lo;
		const nativeHi = scale.hi;
		const xOf = (native: number): number => {
			const k = (native - nativeLo) / (nativeHi - nativeLo);
			return Math.round(left + Math.min(1, Math.max(0, Number.isFinite(k) ? k : 0)) * (right - left));
		};
		// The number's place: at the cell's right end where the cell's last
		// slot holds it, else against the seam its slot ends at.
		const slotW = cell.slotX1 - cell.slotX0;
		const unitW = text.unit === "" ? 0 : estimateKeyTextWidth(text.unit, METER_UNIT_SIZE, { fontWeight: 600 });
		const blockW = Math.ceil(Math.max(0, ...text.sizing.map((t) => inkWidth(t, size)))) + unitRoom(text);
		const valueRight = Math.max(Math.min(right, cell.slotX1 - METER_PAD), cell.slotX0 + METER_PAD + Math.min(blockW, slotW - 2 * METER_PAD));
		// Top row: the name, and on the last meter the window or PAUSED. For
		// a moment after a screen change the screen's name and place take
		// the window's place, in at most two thirds of the meter.
		const room = wide ? (besideOf(cell) as { x0: number; x1: number }) : null;
		const nameLeft = room?.x0 ?? left;
		let nameRight = room?.x1 ?? right;
		// With room beside the number they take the foot of that room, up to
		// the whole slot it ends in, and the name keeps its row.
		const labelLeft = room === null ? left + Math.round((right - left) / 3) : Math.floor((room.x1 - 1) / SLICE_W) * SLICE_W + METER_PAD / 2;
		const wordsEnd = room?.x1 ?? right;
		const said = i !== last || paused ? undefined : b.screenWords(f, labelLeft, wordsEnd - labelLeft, METER_SCREEN_SIZE, 700);
		const top = said ?? badge;
		if (i === last && top !== "") {
			if (room !== null) {
				b.inkText(wordsEnd, METER_WINDOW_BASELINE, "end", said === undefined ? METER_WINDOW_SIZE : METER_SCREEN_SIZE, said === undefined && !paused ? 600 : 700, paused ? t0.badge : t0.unit, top, "rows");
			} else {
				const prim = b.inkText(wordsEnd, METER_NAME_BASELINE, "end", said === undefined ? METER_BADGE_SIZE : METER_SCREEN_SIZE, 700, paused ? t0.badge : t0.unit, top);
				nameRight = (prim?.bx0 ?? wordsEnd) - 6;
			}
		}
		if (f.pane.overlays.legend) {
			// For the moment a screen's name shares its row, the last meter's
			// name steps down to 12 px rather than lose the word that tells it
			// apart.
			const size = said === undefined || room !== null ? METER_NAME_SIZE : 12;
			const name = fitNameRung(tidyRungs(nameRungs(d.input.name || d.input.key, peers)), size, nameRight - nameLeft);
			if (name !== "") b.inkText(nameLeft, METER_NAME_BASELINE, "start", size, 600, t0.label, name);
		}
		// The value, right-aligned, its unit beside it.
		const value = values[i];
		const level = b.levelOf(f, d, value);
		if (text.value !== undefined) {
			const inkEnd = valueRight - (unitW === 0 ? 0 : unitW + UNIT_GAP);
			const room = inkEnd - (cell.slotX0 + METER_PAD);
			// Never cut: a reading with its own format takes the first of its
			// shorter texts that fits (its last at the floor), any other value
			// the lone mark.
			const own = [text.value, ...(text.fallback ?? [])];
			const shown = own.find((t) => valueSizeOf(t, room, size) !== null);
			const fitted = shown === undefined ? null : valueSizeOf(shown, room, size);
			const valueText = shown ?? (text.fallback === undefined ? READOUT_OVERFLOW : (own[own.length - 1] as string));
			const valueSize = fitted ?? METER_VALUE_MIN;
			const color = level !== null ? b.alertColors[level] : clear ? t0.value : readableValueColor(d.color, b.look.surface);
			if (text.unit !== "") b.inkText(valueRight, METER_VALUE_BASELINE, "end", METER_UNIT_SIZE, 600, t0.unit, text.unit);
			const span = inkSpan([{ text: valueText, fontSize: valueSize, fontWeight: 700 }]);
			const end = inkEnd + Math.max(0, span.advance - span.right);
			b.inkText(end, METER_VALUE_BASELINE, "end", valueSize, 700, color, valueText);
		} else {
			b.inkText(valueRight, METER_VALUE_BASELINE, "end", 18, 600, t0.unit, text.word ?? "no data");
		}
		// Where the cell leaves room beside the number: its window as a line on
		// the bar's own scale, so a wobble keeps the size it has on the bar.
		// It draws straight across a brief gap: Meters has no Brief gaps choice.
		if (room !== null && f.pane.overlays.time) b.windowLine(f, d, room, { lo: nativeLo, hi: nativeHi, top: METER_TREND_TOP, bottom: i === last ? METER_TREND_ABOVE_WORDS : METER_TREND_BOTTOM }, undefined);
		// The bar's track, the window's range under it, and the bar.
		if (clear) backs.add(`fill="${b.look.palette.track}"`, left - 1, METER_BAR_Y + METER_BAR_H / 2 - 1, right - left + 2, 3);
		tracks.add(b.look.structure, left, METER_BAR_Y + METER_BAR_H / 2, right - left, 1);
		const e = extentOf(d.bins);
		if (e !== null) {
			const x0 = xOf(e.lo);
			const x1 = Math.max(x0 + 1, xOf(e.hi));
			const range = d.input.state === "stale" ? mixToward(t0.label, b.look.surface, 0.6) : mixToward(t0.label, b.look.surface, 0.3);
			if (clear) backs.add(`fill="${b.look.palette.track}"`, x0 - 1, METER_RANGE_Y - 4, x1 - x0 + 2, 9);
			bars.add(fillOf(range), x0, METER_RANGE_Y, x1 - x0, 2);
			bars.add(fillOf(range), x0, METER_RANGE_Y - 3, 1, 8);
			bars.add(fillOf(range), x1 - 1, METER_RANGE_Y - 3, 1, 8);
		}
		const upward = bandsOpenUpward(f.input.bands, d.input.key);
		const bands = ownBands(f.input.bands, d.input.key).map((band) => ({ band, edge: toNative(bandEdge(band, upward), d.unit, fahrenheit) }));
		if (value !== undefined && text.value !== undefined) {
			const zero = Math.min(Math.max(0, nativeLo), nativeHi);
			const from = Math.min(zero, value);
			const to = Math.max(zero, value);
			const cuts = bands.map((x) => x.edge).filter((v) => Number.isFinite(v) && v > from && v < to).sort((a, c) => a - c);
			const points = [from, ...cuts, to];
			const tester = b.levelTester(f, d);
			for (let k = 0; k + 1 < points.length; k++) {
				const a = points[k] as number;
				const c = points[k + 1] as number;
				// Higher is worse: each piece in its own band's color. Lower is
				// worse: the whole bar in the value's level.
				const pieceLevel = upward ? tester((a + c) / 2) : level;
				const color = pieceLevel !== null ? b.alertColors[pieceLevel] : d.color;
				const xa = xOf(a);
				const xc = Math.max(xa + 1, xOf(c));
				if (clear) backs.add(`fill="${b.look.palette.track}"`, xa - 1, METER_BAR_Y - 1, xc - xa + 2, METER_BAR_H + 2);
				bars.add(fillOf(color), xa, METER_BAR_Y, xc - xa, METER_BAR_H);
			}
		}
		// The scale's ends, then each limit's tick, and the limits' numbers
		// on the scale row beside the ticks: named ("warn 85 · crit 95"), else
		// the numbers alone in the ticks' order, left of the ticks or right
		// of them, wherever they clear the scale's ends.
		const loPrim = b.inkText(left, METER_SCALE_BASELINE, "start", METER_SCALE_SIZE, 600, scale.cue.lo ?? t0.unit, scale.loText);
		const hiPrim = b.inkText(offSeam(right, inkWidth(scale.hiText, METER_SCALE_SIZE, 600), seamsIn(cell.x0, cell.x1), cell.x1 + METER_PAD / 2), METER_SCALE_BASELINE, "end", METER_SCALE_SIZE, 600, scale.cue.hi ?? t0.unit, scale.hiText);
		const free = { lo: (loPrim?.bx1 ?? left) + 4, hi: (hiPrim?.bx0 ?? right) - 4 };
		const ticks = bands.filter(({ edge }) => Number.isFinite(edge)).map(({ band, edge }) => ({ band, x: Math.min(right - 2, Math.max(left, xOf(edge) - 1)) })).sort((a, c) => a.x - c.x);
		for (const { band, x } of ticks) {
			if (clear) backs.add(`fill="${b.look.palette.track}"`, x - 1, METER_LIMIT_Y - 1, 4, METER_LIMIT_H + 2);
			bars.add(fillOf(b.alertColors[band.level]), x, METER_LIMIT_Y, 2, METER_LIMIT_H);
		}
		if (ticks.length > 0) {
			const GAP = 6;
			const minX = (ticks[0] as { x: number }).x;
			const maxX = (ticks[ticks.length - 1] as { x: number }).x + 2;
			for (const named of [true, false]) {
				const parts = ticks.map(({ band }) => ({ color: b.alertColors[band.level], text: `${named ? `${band.level} ` : ""}${b.limitText(bandEdge(band, upward), d.unit, d)}` }));
				const widths = parts.map((p) => b.widthOf(p.text, METER_SCALE_SIZE, 600));
				const total = widths.reduce((a, w) => a + w, 0) + GAP * (parts.length - 1);
				// Beside the ticks where that clears the scale's ends and every
				// seam, else beside the seam nearest them.
				const seams = seamsIn(cell.x0, cell.x1);
				const crosses = (x0: number): boolean => {
					let x = x0;
					return widths.some((w) => {
						const hit = seams.some((seam) => x - 1 < seam && seam < x + w + 1);
						x += w + GAP;
						return hit;
					});
				};
				const near = seams.flatMap((seam) => [seam + 3, seam - 3 - total]).sort((a, c) => Math.abs(a + total / 2 - minX) - Math.abs(c + total / 2 - minX));
				const start = [minX - 4 - total, maxX + 4, ...near].find((x0) => x0 >= free.lo && x0 + total <= free.hi && !crosses(x0));
				if (start === undefined) continue;
				let x = start;
				parts.forEach((p, k) => {
					b.inkText(x, METER_SCALE_BASELINE, "start", METER_SCALE_SIZE, 600, p.color, p.text);
					x += (widths[k] as number) + GAP;
				});
				break;
			}
		}
	}
	// Clear's track-colored edges first, then the tracks, then the marks.
	b.prims.push(...backs.prims("marks"), ...tracks.prims("marks"), ...bars.prims("marks"));
}
