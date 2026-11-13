/**
 * Draws a time-window trend (a HistoryView) into a strip box: the key's
 * Sparkline strip and the two-row dial's row trend. It keeps the recent-
 * samples idiom (track under-fill, accent line, end dot) and adds what a
 * time axis needs:
 *
 * - x is the view's window position, so a short history occupies only the
 *   right part of the box and nothing is drawn left of where it began;
 * - each segment is one subpath through every column's first, min, max and
 *   last value (a vertical stroke inside the column), with the pen up
 *   between segments, so a gap is drawn as a gap and never as a zero; a
 *   brief boundary (HistoryViewSegment.brief) keeps the pen down;
 * - the end dot marks the newest sample only while its segment is still
 *   open; the line ends at that sample (no held stub up to now);
 * - y self-normalizes over the view's extent, so a °C/°F toggle (a positive
 *   affine map) draws the same shape from native values.
 *
 * Payload. A face goes to the device as text on every change, so the trend
 * is written compactly without dropping an extreme:
 *
 * - every coordinate snaps to the half-pixel grid, and points that then
 *   coincide collapse to one (a flat column is one point);
 * - a point lying on the straight segment between its neighbors is left
 *   out (a flat or steady run is one stroke), which leaves the stroked ink
 *   exactly the same under round joins and caps;
 * - the line and the under-fill are one path each for all segments, in
 *   relative commands (h, v, l);
 * - the under-fill passes through each column's first and last value only:
 *   the min and max excursions inside a column are vertical and enclose no
 *   area, so the filled region is the same as through all four.
 *
 * Cost. Every Trend key and dial row redraws on every new sample, so the
 * drawing keeps its points in reused typed arrays and writes path text into
 * a reused byte buffer: a call allocates its few result strings, not an
 * array per point and a string per step (about 4 KB per key face against
 * about 200 KB, which drove the young generation to 32 MB on a deck of
 * Trend keys).
 */
import type { HistoryView } from "../history/types";
import type { Palette } from "./themes";

export interface TimelineBox {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

const grid = (v: number): number => Math.round(v * 2);

/** A grid value as SVG number text: 3, -2.5, .5, -.5. */
function num(g: number): string {
	if (g % 2 === 0) return String(g / 2);
	const text = String(Math.abs(g) / 2);
	const short = text.startsWith("0.") ? text.slice(1) : text;
	return g < 0 ? `-${short}` : short;
}

/*
 * Scratch storage, reused by every call (drawing is synchronous and never
 * re-entrant), so a face repainted every second costs a few strings and no
 * per-point garbage. Points are half-pixel grid values ([2x, 2y]) kept as
 * float64, so every value, NaN and -0 included, compares exactly as the
 * number would. Nothing here outlives a call: the result is plain strings.
 */
let lineX = new Float64Array(256);
let lineY = new Float64Array(256);
let fillX = new Float64Array(256);
let fillY = new Float64Array(256);
/** Per run: line start, line end, fill start, fill end, first x, last x, open (1). */
const RUN_FIELDS = 7;
let runs = new Float64Array(16 * RUN_FIELDS);
/** Path data is ASCII: written byte by byte, read back as one string. */
let text = Buffer.alloc(4096);
let textLen = 0;

function reserve(points: number, runCount: number): void {
	if (lineX.length < points) {
		const size = Math.max(points, lineX.length * 2);
		lineX = new Float64Array(size);
		lineY = new Float64Array(size);
		fillX = new Float64Array(size);
		fillY = new Float64Array(size);
	}
	if (runs.length < runCount * RUN_FIELDS) runs = new Float64Array(Math.max(runCount, (runs.length / RUN_FIELDS) * 2) * RUN_FIELDS);
}

function writeByte(c: number): void {
	if (textLen >= text.length) {
		const bigger = Buffer.alloc(text.length * 2);
		text.copy(bigger, 0, 0, textLen);
		text = bigger;
	}
	text[textLen++] = c;
}

function writeString(s: string): void {
	for (let i = 0; i < s.length; i++) writeByte(s.charCodeAt(i));
}

function writeDigits(v: number): void {
	if (v >= 10) writeDigits(Math.floor(v / 10));
	writeByte(48 + (v % 10));
}

/** A grid value num() writes as plain digits (every real coordinate). */
const plainGrid = (g: number): boolean => Number.isInteger(g) && Math.abs(g) < 0x40000000;

/** Writes num(g): the same text for every value. */
function writeNum(g: number): void {
	if (!plainGrid(g)) {
		writeString(num(g));
		return;
	}
	if (g < 0) writeByte(45);
	const abs = Math.abs(g);
	if (abs % 2 === 0) {
		writeDigits(abs / 2);
		return;
	}
	const whole = (abs - 1) / 2;
	if (whole > 0) writeDigits(whole);
	writeByte(46);
	writeByte(53);
}

/** True when num(g) starts with a minus sign. */
const negative = (g: number): boolean => (plainGrid(g) ? g < 0 : num(g).startsWith("-"));

/** Two numbers as one coordinate pair: a minus sign separates on its own. */
function writePair(a: number, b: number): void {
	writeNum(a);
	if (!negative(b)) writeByte(32);
	writeNum(b);
}

function takeText(): string {
	const out = text.toString("latin1", 0, textLen);
	textLen = 0;
	return out;
}

/** True when b lies on the segment from a to c (exact on the grid). */
function between(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
	const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
	if (cross !== 0) return false;
	return (bx - ax) * (cx - bx) + (by - ay) * (cy - by) >= 0;
}

/** Appends a point to the run starting at `start`, skipping a repeat and
 * dropping earlier points of that run that it makes redundant. Each drop
 * replaces two segments with one covering the same points, so a polyline's
 * ink and a polygon's area never change. Returns the new length. */
function push(xs: Float64Array, ys: Float64Array, len: number, start: number, px: number, py: number): number {
	if (len > start && xs[len - 1] === px && ys[len - 1] === py) return len;
	while (len - start >= 2 && between(xs[len - 2] as number, ys[len - 2] as number, xs[len - 1] as number, ys[len - 1] as number, px, py)) len--;
	xs[len] = px;
	ys[len] = py;
	return len + 1;
}

/** One subpath: an absolute start, then relative steps. */
function writeSubpath(xs: Float64Array, ys: Float64Array, from: number, to: number, close: boolean): void {
	let x = xs[from] as number;
	let y = ys[from] as number;
	writeByte(77);
	writePair(x, y);
	for (let i = from + 1; i < to; i++) {
		const px = xs[i] as number;
		const py = ys[i] as number;
		const dx = px - x;
		const dy = py - y;
		if (dx === 0) {
			writeByte(118);
			writeNum(dy);
		} else if (dy === 0) {
			writeByte(104);
			writeNum(dx);
		} else {
			writeByte(108);
			writePair(dx, dy);
		}
		x = px;
		y = py;
	}
	if (close) writeByte(90);
}

/**
 * The trend's SVG parts, or [] when the view holds no observation. The
 * under-fill comes first, then the line, then dots. `underFill` is a fill
 * attribute for the area under each run (null draws none: an Outline dial).
 */
export function timelineSvg(view: HistoryView, box: TimelineBox, stroke: number, dotR: number, palette: Palette, underFill: string | null): string[] {
	const { cols, extent } = view;
	if (cols.n === 0 || extent === null) return [];
	const span = extent.max - extent.min;
	const bottom = box.y + box.h;
	const floor = grid(bottom);
	const gx = (col: number): number => grid(box.x + ((col + 0.5) * box.w) / view.widthPx);
	const gy = (value: number): number => grid(bottom - (span === 0 ? 0.5 : (value - extent.min) / span) * box.h);
	// A column adds at most four line points and two fill points; a run
	// adds a fill start and end.
	reserve(4 * cols.n + 4, cols.n + 1);
	textLen = 0;
	let lineLen = 0;
	let fillLen = 0;
	let runCount = 0;
	let runSeg = -1;
	let r = -1;
	for (let i = 0; i < cols.n; i++) {
		const s = cols.seg[i] as number;
		const x = gx(cols.x[i] as number);
		const first = gy(cols.first[i] as number);
		const last = gy(cols.last[i] as number);
		if (r >= 0 && s === runSeg + 1 && view.segments[s]?.brief === true) {
			// A reading missed for a moment: the same line goes on.
			runs[r + 6] = view.segments[s]?.open === true ? 1 : 0;
			runSeg = s;
		} else if (r < 0 || s !== runSeg) {
			if (r >= 0) fillLen = endRun(r, lineLen, fillLen, floor, underFill !== null);
			r = runCount++ * RUN_FIELDS;
			runs[r] = lineLen;
			runs[r + 2] = fillLen;
			runs[r + 4] = x;
			runs[r + 6] = view.segments[s]?.open === true ? 1 : 0;
			fillX[fillLen] = x;
			fillY[fillLen] = floor;
			fillLen++;
			runSeg = s;
		}
		runs[r + 5] = x;
		const lineStart = runs[r] as number;
		const fillStart = runs[r + 2] as number;
		// Screen y grows downward: the column's min value has the larger y.
		// A rising column visits its min first, a falling one its max, which
		// travels least and leaves the fewest points.
		const low = gy(cols.min[i] as number);
		const high = gy(cols.max[i] as number);
		const falling = first >= last;
		lineLen = push(lineX, lineY, lineLen, lineStart, x, first);
		lineLen = push(lineX, lineY, lineLen, lineStart, x, falling ? low : high);
		lineLen = push(lineX, lineY, lineLen, lineStart, x, falling ? high : low);
		lineLen = push(lineX, lineY, lineLen, lineStart, x, last);
		fillLen = push(fillX, fillY, fillLen, fillStart, x, first);
		fillLen = push(fillX, fillY, fillLen, fillStart, x, last);
	}
	endRun(r, lineLen, fillLen, floor, underFill !== null);
	const newest = (runCount - 1) * RUN_FIELDS;
	const newestOpen = runs[newest + 6] === 1;
	const dots: string[] = [];
	let lines = 0;
	for (let q = 0; q <= newest; q += RUN_FIELDS) {
		const from = runs[q] as number;
		if ((runs[q + 1] as number) - from !== 1) {
			lines++;
			continue;
		}
		// One isolated observation: a dot the width of the line (the open
		// newest run gets the end dot instead).
		if (q === newest && newestOpen) continue;
		dots.push(`<circle cx="${num(lineX[from] as number)}" cy="${num(lineY[from] as number)}" r="${stroke / 2}" fill="${palette.accent}"/>`);
	}
	const parts: string[] = [];
	if (lines > 0 && underFill !== null) {
		for (let q = 0; q <= newest; q += RUN_FIELDS) {
			if ((runs[q + 1] as number) - (runs[q] as number) !== 1 && runs[q + 4] !== runs[q + 5]) writeSubpath(fillX, fillY, runs[q + 2] as number, runs[q + 3] as number, true);
		}
		if (textLen > 0) parts.push(`<path d="${takeText()}" ${underFill}/>`);
	}
	if (lines > 0) {
		for (let q = 0; q <= newest; q += RUN_FIELDS) {
			if ((runs[q + 1] as number) - (runs[q] as number) !== 1) writeSubpath(lineX, lineY, runs[q] as number, runs[q + 1] as number, false);
		}
		parts.push(`<path d="${takeText()}" fill="none" stroke="${palette.accent}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>`);
	}
	parts.push(...dots);
	if (newestOpen) {
		const end = (runs[newest + 1] as number) - 1;
		parts.push(`<circle cx="${num(lineX[end] as number)}" cy="${num(lineY[end] as number)}" r="${dotR}" fill="${palette.accent}"/>`);
	}
	return parts;
}

/** Ends the run at `r`: where its line stops and, when it is filled and
 * spans more than one x, the under-fill's way back down to the floor.
 * Returns the new fill length. */
function endRun(r: number, lineLen: number, fillLen: number, floor: number, filled: boolean): number {
	runs[r + 1] = lineLen;
	let len = fillLen;
	if (filled && runs[r + 4] !== runs[r + 5]) len = push(fillX, fillY, len, runs[r + 2] as number, runs[r + 5] as number, floor);
	runs[r + 3] = len;
	return len;
}
