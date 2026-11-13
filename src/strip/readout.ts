/**
 * Large current values on the strip (StripPaneV1.readout), as pure layout:
 * how big the digits can be in a box, where each value, unit, name and
 * color mark goes. The scene (scene.ts) turns a plan into primitives.
 *
 * Sizes come from the deck's face font, never from guesses: widths from the
 * measured advances and ink insets (estimateKeyTextWidth, inkSpan), heights
 * from each font's own digit outlines (DIGIT_METRICS, read from tahomabd.ttf
 * and segoeuib.ttf). A box holds one to four values at ONE shared size, so
 * no reading looks more important than another, and that size is the
 * largest at which the widest text the window can show (the current value,
 * the window's min and its max) fits whole: the digits do not jump size as
 * the value moves through the window. Text that cannot fit even at the
 * floor is never cut into another number: a reading with its own format
 * draws the first of its shorter texts that fits (ReadoutItem.fallback, the
 * keys' and dials' rule), any other value the lone "…".
 *
 * A number never crosses a slice seam (the left readout is one dial slot,
 * a values-only pane gives each value a slot of its cell, planSpread), because
 * two slices are never presented at the same instant: a number split over a
 * seam could show half of an old value beside half of a new one.
 */
import { faceFont } from "../ui/face-font";
import { estimateKeyTextWidth, inkSpan } from "../ui/format";
import { besideOf, SPREAD_PAD, underOf, type SpreadCell } from "./geometry";

/** Digit outlines in em: the top of the tallest digit above the baseline,
 * the overshoot of the round digits below it, and the flat cap height
 * (1, 4, 7) that "digit height" means in the legibility numbers. Read from
 * the fonts' glyf tables (2048 units per em): Tahoma Bold 0 to 9 reach
 * 1523 up and 34 down, caps 1489; Segoe UI Bold 1466 up, 25 down, 1434. */
export const DIGIT_METRICS = {
	tahoma: { top: 1523 / 2048, drop: 34 / 2048, cap: 1489 / 2048 },
	"segoe-ui": { top: 1466 / 2048, drop: 25 / 2048, cap: 1434 / 2048 }
} as const;

export function digitMetrics(): { readonly top: number; readonly drop: number; readonly cap: number } {
	return DIGIT_METRICS[faceFont().id];
}

/** The largest and the smallest digit size a readout tries. */
export const READOUT_MAX_SIZE = 140;
export const READOUT_MIN_SIZE = 12;
/** The mark a number that cannot fit draws instead (never a cut number). */
export const READOUT_OVERFLOW = "…";

export type ReadoutItem = {
	/** What draws in the value's place: the number, or a status word. */
	readonly text: string;
	/** True for a number; a status word ("stale") draws smaller and dimmer. */
	readonly numeric: boolean;
	/** Every text this value may show in the window (current, min, max);
	 * the digits are sized so the widest fits. */
	readonly sizing: readonly string[];
	/** A reading with its own format: its value with no decimals, then
	 * compact (measure.ts exactFallback), for when `text` cannot fit even
	 * at the floor. */
	readonly fallback?: readonly string[];
	/** Unit text, "" for none. */
	readonly unit: string;
	/** The reading's name from longest to shortest (nameRungs); the first
	 * that fits whole is drawn, never a cut one. Empty when names are off. */
	readonly names: readonly string[];
};

export type ReadoutBox = { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };

export type ReadoutAlign = "right" | "center";

export type ReadoutCell = {
	readonly item: number;
	readonly box: ReadoutBox;
	/** The value's text as drawn (the item's text, or the lone "…"). */
	readonly text: string;
	/** The value's baseline and the x its text ends at (text-anchor end). */
	readonly baseline: number;
	readonly valueEnd: number;
	/** Status words draw at their own size. */
	readonly valueSize: number;
	/** The color mark: a bar the height of the digits, left of them. */
	readonly bar: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
	readonly unit?: { readonly x: number; readonly y: number; readonly anchor: "start" | "end" };
	readonly name?: { readonly x: number; readonly y: number; readonly anchor: "start" | "middle"; readonly text: string; readonly room: number };
	/** Room under the value for a small trend, when the digits leave it:
	 * its vertical band and the block's horizontal span. */
	readonly trend?: { readonly y0: number; readonly y1: number; readonly x0: number; readonly x1: number };
};

export type ReadoutPlan = {
	/** Digit size shared by every value in the box. */
	readonly size: number;
	readonly unitSize: number;
	readonly nameSize: number;
	readonly namePlace: "above" | "beside" | "none";
	readonly unitPlace: "beside" | "under";
	readonly cols: number;
	readonly rows: number;
	readonly cells: readonly ReadoutCell[];
};

const PAD_X = 8;
const PAD_Y = 4;
/** Each stacked cell keeps only this much above and below its value: the
 * box keeps PAD_Y, so stacked rows do not each pay it. */
const CELL_PAD_Y = 1;
const UNIT_GAP = 4;
const NAME_GAP = 8;
/** A name beside its value gets at least this much room, or the name goes
 * above the value instead. */
const NAME_BESIDE_MIN = 48;
/** The least height a small trend under a value is drawn in. */
export const TREND_MIN_H = 12;

/** Space between the color mark and the digits: 0.15 of the type size,
 * never under 6 px, so the mark never reads as a "1" or a bar of the
 * first digit. */
export function barGapFor(size: number): number {
	return Math.max(6, Math.ceil(size * 0.15));
}

/** Ink width of a bold run at `size`, from the face font's measured ink. */
function inkWidth(text: string, size: number, weight: 600 | 700): number {
	const span = inkSpan([{ text, fontSize: size, fontWeight: weight }]);
	return Math.max(0, span.right - span.left);
}

/** Where the ink ends inside a run's advance, from the right (Tahoma's
 * measured trailing inset; 0 for a face without insets). */
function trailInset(text: string, size: number, weight: 600 | 700): number {
	const span = inkSpan([{ text, fontSize: size, fontWeight: weight }]);
	return Math.max(0, span.advance - span.right);
}

/** Segoe UI has no measured ink, only advances that can price a line a
 * little under what it draws: its readout keeps this share of the width
 * spare. Tahoma fits to its measured ink. */
function widthMargin(size: number): number {
	return faceFont().id === "tahoma" ? 1 : Math.max(2, size * 0.04);
}

export function unitSizeFor(size: number): number {
	return Math.max(11, Math.min(24, Math.round(size * 0.34)));
}

function barWidthFor(size: number): number {
	return size >= 40 ? 5 : size >= 24 ? 4 : 3;
}

type Arrangement = { readonly cols: number; readonly rows: number; readonly namePlace: ReadoutPlan["namePlace"]; readonly unitPlace: ReadoutPlan["unitPlace"] };

/** Arrangements with the unit on the digits' baseline; `under` gives the
 * fallbacks with the unit under the number (one row only). */
function arrangements(n: number, names: boolean, unitPlace: ReadoutPlan["unitPlace"]): Arrangement[] {
	const out: Arrangement[] = [];
	for (const cols of n >= 2 ? [1, 2] : [1]) {
		const rows = Math.ceil(n / cols);
		if (unitPlace === "under" && rows !== 1) continue;
		for (const namePlace of names ? (["above", "beside"] as const) : (["none"] as const)) out.push({ cols, rows, namePlace, unitPlace });
	}
	return out;
}

function nameSizeFor(rows: number): number {
	return rows === 1 ? 13 : 11;
}

function boxesOf(outer: ReadoutBox, a: Arrangement, n: number): ReadoutBox[] {
	const box = { ...outer, y0: outer.y0 + PAD_Y - CELL_PAD_Y, y1: outer.y1 - PAD_Y + CELL_PAD_Y };
	const w = (box.x1 - box.x0) / a.cols;
	const h = (box.y1 - box.y0) / a.rows;
	return Array.from({ length: n }, (_, i) => {
		const c = i % a.cols;
		const r = Math.floor(i / a.cols);
		return { x0: box.x0 + c * w, x1: box.x0 + (c + 1) * w, y0: box.y0 + r * h, y1: box.y0 + (r + 1) * h };
	});
}

/** The widest number text of an item at `size`. */
function digitsWidth(item: ReadoutItem, size: number): number {
	const texts = item.numeric ? [item.text, ...item.sizing] : item.sizing.length > 0 ? item.sizing : ["00.0"];
	return Math.max(...texts.map((t) => inkWidth(t, size, 700)));
}

/** Height of the value block at `size` for an arrangement. */
function blockHeight(a: Arrangement, size: number): number {
	const m = digitMetrics();
	const unitUnder = a.unitPlace === "under" ? 3 + unitSizeFor(size) * m.top : 0;
	const nameAbove = a.namePlace === "above" ? nameSizeFor(a.rows) + 4 : 0;
	return nameAbove + (m.top + m.drop) * size + unitUnder;
}

/** Whether every item fits its cell at `size` (number widths at the
 * shared size; units, the color mark and a name's least room beside). */
function fitsAt(items: readonly ReadoutItem[], cells: readonly ReadoutBox[], a: Arrangement, size: number, unitW: number): boolean {
	const bar = barWidthFor(size) + barGapFor(size);
	for (const [i, item] of items.entries()) {
		const cell = cells[i] as ReadoutBox;
		const width = cell.x1 - cell.x0 - 2 * PAD_X;
		const unit = item.unit === "" || a.unitPlace === "under" ? 0 : UNIT_GAP + unitW;
		const name = a.namePlace === "beside" ? NAME_BESIDE_MIN + NAME_GAP : 0;
		if (bar + name + digitsWidth(item, size) + unit + widthMargin(size) > width) return false;
		if (a.unitPlace === "under" && item.unit !== "" && bar + estimateKeyTextWidth(item.unit, unitSizeFor(size), { fontWeight: 600 }) > width) return false;
		if (blockHeight(a, size) > cell.y1 - cell.y0 - 2 * CELL_PAD_Y) return false;
	}
	return true;
}

/** The largest size every item fits at, for one arrangement; 0 when even
 * the floor does not. */
function largestSize(items: readonly ReadoutItem[], box: ReadoutBox, a: Arrangement, cap: number): number {
	const cells = boxesOf(box, a, items.length);
	let lo = READOUT_MIN_SIZE;
	let hi = Math.max(READOUT_MIN_SIZE, Math.min(READOUT_MAX_SIZE, Math.floor(cap)));
	const unitWidth = (size: number): number => Math.max(0, ...items.map((it) => (it.unit === "" ? 0 : estimateKeyTextWidth(it.unit, unitSizeFor(size), { fontWeight: 600 }))));
	if (!fitsAt(items, cells, a, lo, unitWidth(lo))) return 0;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (fitsAt(items, cells, a, mid, unitWidth(mid))) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/** The first of a reading's names (longest first) that fits `room` whole,
 * or "" when none does: the color mark then stands alone. A name is never
 * cut: a cut name ("CPU P…") reads worse than none. */
export function fitNameRung(names: readonly string[], size: number, room: number): string {
	return names.find((n) => n !== "" && estimateKeyTextWidth(n, size, { fontWeight: 600 }) <= room) ?? "";
}

/**
 * Lays out 1 to 4 values in a box at the largest shared size. Arrangements
 * tried: one column or two, names above or beside the value (or none), the
 * unit on the digits' baseline beside them; the one with the largest digits
 * wins, the earlier one on a tie. Only when nothing fits that way does the
 * unit go under the number. With `trend`, a value whose cell leaves at least
 * TREND_MIN_H px under it gets room for a small trend there, and its block
 * moves up to make that room; the digits never shrink for it.
 */
/** What a number that cannot fit draws: the first of its shorter texts
 * that fits, else its last; the lone "…" for a value without them. */
function overflowText(item: ReadoutItem, fits: (text: string) => boolean): string {
	const fallback = item.fallback ?? [];
	return fallback.find(fits) ?? fallback[fallback.length - 1] ?? READOUT_OVERFLOW;
}

export function planReadout(items: readonly ReadoutItem[], box: ReadoutBox, options: { readonly align: ReadoutAlign; readonly names: boolean; readonly trend?: boolean; readonly maxSize?: number }): ReadoutPlan | null {
	if (items.length === 0 || box.x1 - box.x0 < 2 * PAD_X + 10) return null;
	let best: { a: Arrangement; size: number } | undefined;
	for (const place of ["beside", "under"] as const) {
		for (const a of arrangements(items.length, options.names, place)) {
			const size = largestSize(items, box, a, options.maxSize ?? READOUT_MAX_SIZE);
			if (size > 0 && (best === undefined || size > best.size)) best = { a, size };
		}
		if (best !== undefined) break;
	}
	// Nothing fits even at the floor: the floor size, one column, each value
	// that cannot fit drawn as the lone overflow mark.
	const a = best?.a ?? { cols: 1, rows: items.length, namePlace: options.names ? "above" : "none", unitPlace: "beside" };
	const size = best?.size ?? READOUT_MIN_SIZE;
	const m = digitMetrics();
	const unitSize = unitSizeFor(size);
	const nameSize = nameSizeFor(a.rows);
	const cells = boxesOf(box, a, items.length);
	const unitW = Math.max(0, ...items.map((it) => (it.unit === "" ? 0 : estimateKeyTextWidth(it.unit, unitSize, { fontWeight: 600 }))));
	const barW = barWidthFor(size);
	const barGap = barGapFor(size);
	const out: ReadoutCell[] = items.map((item, i) => {
		const cell = cells[i] as ReadoutBox;
		const left = cell.x0 + PAD_X;
		const right = cell.x1 - PAD_X;
		const unitRoom = item.unit === "" || a.unitPlace === "under" ? 0 : UNIT_GAP + unitW;
		const valueSize = item.numeric ? size : Math.max(12, Math.min(22, Math.round(size * 0.4)));
		const fits = (text: string): boolean => barW + barGap + (a.namePlace === "beside" ? NAME_BESIDE_MIN + NAME_GAP : 0) + inkWidth(text, valueSize, 700) + unitRoom + widthMargin(valueSize) <= right - left;
		const text = item.numeric && best === undefined && !fits(item.text) ? overflowText(item, fits) : item.text;
		const inkW = inkWidth(text, valueSize, 700);
		// The value column is as wide as the widest text the window can show,
		// so the value stays put as it changes. Its ink ends at `inkEnd`;
		// text-anchor end sits past that by the run's trailing inset.
		const widest = Math.max(inkW, item.numeric ? digitsWidth(item, size) : inkW);
		const centered = options.align === "center" && a.namePlace !== "beside";
		const blockW = barW + barGap + Math.ceil(widest) + unitRoom;
		const blockLeft = centered ? Math.round(Math.min(right - blockW, Math.max(left, (left + right) / 2 - blockW / 2))) : left;
		const inkEnd = centered ? blockLeft + barW + barGap + Math.ceil(widest) : right - unitRoom;
		const valueEnd = inkEnd + trailInset(text, valueSize, 700);
		const digitsTop = m.top * size;
		const below = m.drop * size + (a.unitPlace === "under" && item.unit !== "" ? 3 + unitSize * m.top : 0);
		const nameH = a.namePlace === "above" ? nameSize + 4 : 0;
		const avail = cell.y1 - cell.y0 - 2 * CELL_PAD_Y;
		const used = nameH + digitsTop + below;
		const spare = avail - used;
		const trendRoom = options.trend === true && spare >= TREND_MIN_H + 4;
		const top = cell.y0 + CELL_PAD_Y + (trendRoom ? 0 : Math.max(0, spare / 2));
		const baseline = Math.round(top + nameH + digitsTop);
		const barH = Math.round(m.cap * (item.numeric ? size : valueSize));
		const bar = { x: blockLeft, y: baseline - barH, w: barW, h: barH };
		const unit = item.unit === "" ? undefined : a.unitPlace === "under" ? { x: inkEnd, y: Math.round(baseline + m.drop * size + 3 + unitSize * m.top), anchor: "end" as const } : { x: inkEnd + UNIT_GAP, y: baseline, anchor: "start" as const };
		let name: ReadoutCell["name"];
		if (a.namePlace === "above" && item.names.length > 0) {
			if (centered) {
				// Centered over the block, as wide as the cell allows around it.
				const mid = blockLeft + blockW / 2;
				const room = 2 * Math.min(mid - left, right - mid);
				name = { x: Math.round(mid), y: Math.round(top + nameSize - 1), anchor: "middle", text: fitNameRung(item.names, nameSize, room), room };
			} else {
				const room = right - left;
				name = { x: left, y: Math.round(top + nameSize - 1), anchor: "start", text: fitNameRung(item.names, nameSize, room), room };
			}
		} else if (a.namePlace === "beside" && item.names.length > 0) {
			const nameLeft = left + barW + barGap;
			const room = inkEnd - widest - NAME_GAP - nameLeft;
			name = { x: nameLeft, y: Math.round(baseline - (m.cap * size) / 2 + (nameSize * m.cap) / 2), anchor: "start", text: fitNameRung(item.names, nameSize, room), room };
		}
		const trend = trendRoom ? { y0: Math.round(baseline + below + 5), y1: Math.round(cell.y1 - CELL_PAD_Y - 1), x0: blockLeft, x1: blockLeft + blockW } : undefined;
		return { item: i, box: cell, text, baseline, valueEnd, valueSize, bar, ...(unit === undefined ? {} : { unit }), ...(name === undefined || name.text === "" ? {} : { name }), ...(trend === undefined || trend.y1 - trend.y0 < TREND_MIN_H ? {} : { trend }) };
	});
	return { size, unitSize, nameSize, namePlace: a.namePlace, unitPlace: a.unitPlace, cols: a.cols, rows: a.rows, cells: out };
}

/** A reading on a spread pane: what planSpread sizes and places. */
export type SpreadItem = ReadoutItem & {
	/** The unit the setup keeps room for, whatever the reading says now. */
	readonly setupUnit: string;
	/** The reading has limits: its name keeps room for the word a reached
	 * limit draws (warn, crit), whether or not one is reached. */
	readonly limits: boolean;
};

export type SpreadPlace = {
	readonly item: number;
	readonly cell: SpreadCell;
	/** The value's text as drawn, its size, and where it ends (text-anchor
	 * end): a value wider than its setup steps down on its own, in place. */
	readonly text: string;
	readonly valueSize: number;
	readonly baseline: number;
	readonly valueEnd: number;
	readonly bar: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
	readonly unit?: { readonly x: number; readonly y: number };
	readonly name?: { readonly x: number; readonly y: number; readonly text: string; readonly room: number };
	/** Where a reached limit's word ends (text-anchor end). */
	readonly word?: { readonly x: number; readonly y: number };
	readonly trend?: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number; readonly beside: boolean };
};

export type SpreadPlan = { readonly size: number; readonly unitSize: number; readonly nameSize: number; readonly wordSize: number; readonly places: readonly SpreadPlace[] };

/** A spread pane's top row: the name, a reached limit's word, the unit. */
const SPREAD_NAME_SIZE = 14;
const SPREAD_NAME_ROW = 16;
const SPREAD_WORD_SIZE = 13;
const SPREAD_WORD_ROOM = 36;
const SPREAD_UNIT_SIZE = 16;

/** The widest number the setup says this item can print at `size`. */
function setupWidth(item: ReadoutItem, size: number): number {
	return Math.ceil(Math.max(...(item.sizing.length > 0 ? item.sizing : ["00.0"]).map((t) => inkWidth(t, size, 700))));
}

/**
 * Values only across a pane: each reading in its cell (spreadCells), its
 * number in the cell's dial slot under its name and unit, the rest of the
 * cell its trend's. One size for every number of the pane, the largest at
 * which the widest number each reading's setup can print (ReadoutItem.sizing,
 * no value in it) fills a dial slot, so nothing here moves with a value. A
 * value wider than its setup steps down on its own, keeping its baseline and
 * its right end; one that cannot fit even at READOUT_MIN_SIZE draws the lone
 * "…". The trend draws beside the number where the cell leaves room
 * (besideOf), else under it from the number to the strip's edge, from the
 * number's slot to the next number's (underOf).
 */
export function planSpread(items: readonly SpreadItem[], cells: readonly SpreadCell[], options: { readonly names: boolean; readonly trend: boolean; readonly paused?: boolean }): SpreadPlan {
	const m = digitMetrics();
	const beside = cells.map((cell) => (options.trend && cells.every((other) => besideOf(other) !== null) ? besideOf(cell) : null));
	// The top row stands while anything can draw on it, so a reading that
	// loses its unit or reaches a limit moves nothing. Over a trend under the
	// numbers, the digits stand at the top: PAUSED takes a row of its own for
	// the moment an inspect lasts, when nothing else keeps one.
	const nameRow = options.names || items.some((item) => item.setupUnit !== "" || item.limits) || (options.paused === true && options.trend && beside.some((room) => room === null)) ? SPREAD_NAME_ROW : 0;
	const roomFor = (i: number, size: number): number => {
		const cell = cells[i] as SpreadCell;
		return cell.slotX1 - cell.slotX0 - 2 * SPREAD_PAD - barWidthFor(size) - barGapFor(size) - widthMargin(size);
	};
	const fits = (size: number): boolean => items.every((item, i) => setupWidth(item, size) <= roomFor(i, size) && nameRow + (m.top + m.drop) * size + (options.trend && beside[i] === null ? 5 + TREND_MIN_H : 0) <= 100 - 2 * PAD_Y);
	let size = READOUT_MAX_SIZE;
	while (size > READOUT_MIN_SIZE && !fits(size)) size--;
	const places = items.map((item, i): SpreadPlace => {
		const cell = cells[i] as SpreadCell;
		const barW = barWidthFor(size);
		const barGap = barGapFor(size);
		const left = cell.slotX0 + SPREAD_PAD;
		const inkEnd = left + barW + barGap + setupWidth(item, size);
		// A value past its setup steps down; a status word takes its own size.
		let text = item.text;
		let valueSize = item.numeric ? size : Math.max(12, Math.min(22, Math.round(size * 0.4)));
		if (item.numeric) {
			const room = cell.slotX1 - SPREAD_PAD - left - barW - barGap - widthMargin(size);
			while (valueSize > READOUT_MIN_SIZE && inkWidth(text, valueSize, 700) > room) valueSize--;
			if (inkWidth(text, valueSize, 700) > room) text = overflowText(item, (t) => inkWidth(t, READOUT_MIN_SIZE, 700) <= room);
			if (text !== item.text && item.fallback !== undefined) {
				valueSize = size;
				while (valueSize > READOUT_MIN_SIZE && inkWidth(text, valueSize, 700) > room) valueSize--;
			}
		}
		const under = options.trend && beside[i] === null;
		const digitsH = (m.top + m.drop) * size;
		const block = nameRow + digitsH;
		const top = under ? PAD_Y : Math.round((100 - block) / 2);
		const baseline = Math.round(top + nameRow + m.top * size);
		const barH = Math.round(m.cap * size);
		const valueEnd = Math.max(inkEnd, left + barW + barGap + inkWidth(text, valueSize, 700)) + trailInset(text, valueSize, 700);
		const rowY = top + 11;
		const unitW = item.setupUnit === "" ? 0 : estimateKeyTextWidth(item.setupUnit, SPREAD_UNIT_SIZE, { fontWeight: 600 });
		const rowEnd = cell.slotX1 - SPREAD_PAD;
		const wordEnd = rowEnd - (unitW === 0 ? 0 : unitW + UNIT_GAP);
		const nameRoom = wordEnd - (item.limits ? SPREAD_WORD_ROOM : 0) - 4 - left;
		const name = options.names && item.names.length > 0 ? fitNameRung(item.names, SPREAD_NAME_SIZE, nameRoom) : "";
		const trend = !options.trend ? undefined : beside[i] !== null ? { ...(beside[i] as { x0: number; x1: number }), y0: 8, y1: 92, beside: true } : { ...underOf(cells, i), y0: Math.round(baseline + m.drop * size + 5), y1: 98, beside: false };
		return {
			item: i,
			cell,
			text,
			valueSize,
			baseline,
			valueEnd,
			bar: { x: left, y: baseline - barH, w: barW, h: barH },
			...(unitW === 0 ? {} : { unit: { x: rowEnd, y: rowY } }),
			...(name === "" ? {} : { name: { x: left, y: rowY, text: name, room: nameRoom } }),
			...(item.limits ? { word: { x: wordEnd, y: rowY } } : {}),
			...(trend === undefined || trend.y1 - trend.y0 < TREND_MIN_H ? {} : { trend })
		};
	});
	return { size, unitSize: SPREAD_UNIT_SIZE, nameSize: SPREAD_NAME_SIZE, wordSize: SPREAD_WORD_SIZE, places };
}

/**
 * Values only, stacked: which dial slots (0-based, counted inside the pane)
 * hold which readings when the pane is too narrow for a cell each. Every
 * slot is used and the first ones stack one more, in order.
 */
export function onlyStacks(readings: number, slots: number): number[][] {
	if (readings <= 0 || slots <= 0) return [];
	const groups = Math.min(readings, slots);
	const out: number[][] = [];
	let next = 0;
	for (let g = 0; g < groups; g++) {
		const size = Math.floor(readings / groups) + (g < readings % groups ? 1 : 0);
		out.push(Array.from({ length: size }, (_, k) => next + k));
		next += size;
	}
	return out;
}

/** Common words a reading name can lose or shorten and still say what it
 * is ("CPU Package Temperature" to "CPU Pkg Temp" to "CPU Pkg"). */
const SHORT_WORDS: Readonly<Record<string, string>> = {
	temperature: "Temp",
	package: "Pkg",
	average: "Avg",
	maximum: "Max",
	minimum: "Min",
	utilization: "Util",
	memory: "Mem",
	frequency: "Freq",
	voltage: "Volt",
	controller: "Ctrl",
	effective: "Eff",
	processor: "CPU",
	graphics: "GPU",
	total: "Total"
};
/** Words a unit already says, dropped last-but-one (never the only word). */
const UNIT_WORDS = /^(temp|temperature|usage|load|power|speed|clock|freq|frequency|voltage|volt|rpm)$/i;

/**
 * A reading name's rungs, longest first, for a place too narrow for it
 * whole: the name; without bracketed parts; with long words shortened;
 * without the last words every reading of the pane shares ("Core 1 T1"
 * across "Core 0 T0 Effective Clock" to "Core 1 T1 Effective Clock"), then
 * also without its shared leading words ("1 T1"); without the leading
 * words every reading of the pane shares (e.g. "GPU"
 * across "GPU Temperature" and "GPU Hot Spot"); without a last word the
 * unit already says ("CPU Pkg Temp" with °C reads "CPU Pkg"); without
 * its leading word ("Hot Spot"), unless only a unit word is left; its
 * first word. Duplicates and empty rungs are left out. `peers` are the names of
 * every reading in the same pane, this one included.
 */
export function nameRungs(name: string, peers: readonly string[]): string[] {
	return readingRungs(name, peers);
}

/** Words that join others and never end a shortened name. */
const JOINING_WORDS = /^(and|or|of|with|for|in|on|at|to|the|a|&|\+|·|-|\||\/|,)$/i;

/**
 * A name the person typed (a strip screen's), shortest last, by whole
 * words: as typed; without bracketed parts; with long words shortened (the
 * readout's words, "Temperature" to "Temp"); then fewer words from the end,
 * never ending on a joining word ("CPU and GPU temps", "CPU and GPU",
 * "CPU"). Duplicates are left out.
 */
export function phraseRungs(name: string): string[] {
	const words = (s: string): string[] => s.split(/\s+/).filter((w) => w !== "");
	const plain = words(name.replace(/\([^)]*\)|\[[^\]]*\]/g, " ")).join(" ");
	const short = words(plain).map((w) => SHORT_WORDS[w.toLowerCase()] ?? w);
	const out: string[] = [name.trim(), plain, short.join(" ")];
	for (let n = short.length - 1; n >= 1; n--) {
		const head = short.slice(0, n);
		while (head.length > 0 && JOINING_WORDS.test(head[head.length - 1] as string)) head.pop();
		if (head.length > 0) out.push(head.join(" "));
	}
	return out.filter((rung, i) => rung !== "" && out.indexOf(rung) === i);
}

function readingRungs(name: string, peers: readonly string[]): string[] {
	const words = (s: string): string[] => s.split(/\s+/).filter((w) => w !== "");
	const plain = (s: string): string => words(s.replace(/\([^)]*\)|\[[^\]]*\]/g, " ")).join(" ");
	const short = (s: string): string => words(s).map((w) => SHORT_WORDS[w.toLowerCase()] ?? w).join(" ");
	const out: string[] = [name.trim()];
	const shortened = short(plain(name));
	out.push(plain(name), shortened);
	const peerWords = peers.map((p) => words(short(plain(p))));
	let shared = 0;
	let sharedTail = 0;
	if (peerWords.length >= 2) {
		const cap = Math.min(...peerWords.map((w) => w.length)) - 1;
		const first = peerWords[0] as string[];
		while (shared < cap && peerWords.every((w) => (w[shared] as string).toLowerCase() === (first[shared] as string).toLowerCase())) shared++;
		const tailOf = (w: readonly string[], k: number): string => (w[w.length - 1 - k] as string).toLowerCase();
		while (sharedTail < cap && peerWords.every((w) => tailOf(w, sharedTail) === tailOf(first, sharedTail))) sharedTail++;
	}
	// Words every reading of the pane ends with ("Effective Clock" across
	// "Core 0 T0" to "Core 1 T1") go before any leading word: first without
	// them, then also without the leading words every reading shares.
	const shortWords = words(shortened);
	if (sharedTail > 0 && sharedTail < shortWords.length) {
		out.push(shortWords.slice(0, -sharedTail).join(" "));
		if (shared > 0 && shared + sharedTail < shortWords.length) out.push(shortWords.slice(shared, -sharedTail).join(" "));
	}
	const own = shortWords.slice(shared);
	out.push(own.join(" "));
	if (own.length > 1 && UNIT_WORDS.test(own[own.length - 1] as string)) out.push(own.slice(0, -1).join(" "));
	// "GPU Hot Spot" reads "Hot Spot" before plain "GPU"; "GPU Temp" never
	// becomes a bare "Temp".
	const rest = shared === 0 ? own.slice(1) : [];
	if (rest.length > 0 && !(rest.length === 1 && UNIT_WORDS.test(rest[0] as string))) out.push(rest.join(" "));
	if (own.length > 0) out.push(own[0] as string);
	return out.filter((rung, i) => rung !== "" && out.indexOf(rung) === i);
}
