/**
 * Renders the 200×100 Stream Deck + touchscreen slot as a raw SVG string
 * (sent through `setFeedback` into a full-canvas pixmap layout item — layout
 * text items cannot mix font sizes on one line, which the spec's inline unit
 * requires).
 *
 * Spec geometry: title 18/600 x12 y24 · value 34/700 x12 y58 (24/700 from
 * 10 glyphs, 17/700 from 14, so prose faces never run off the slot) with
 * inline unit 17/600 · stats 12/600 x12 y78 · bar x12 y84 176×6 r3.
 */
import { HISTORY_LENGTH } from "../series";
import { cappedUnit, cutToFit, estimateFooterWidth, estimateKeyTextWidth, fitFooter, fitLadderBy, fitTextLadder, INK_CLEAR_GAP, INK_RIGHT_SLACK, inkEdges, inksWithin, truncateLabel, wrapLabelTwoLines, wrapLabelTwoLinesBy, type FittedText, type TextRun } from "./format";
import { faceFont, isTahoma } from "./face-font";
import { barSegment, escapeXml, fontFamily, inlineGap, PRESERVE, sparklinePoints, sparklineSvg, svgOpen, type DrawnZone } from "./key-renderer";
import { noDimmerThan, themeTextColors, type TextColors } from "./text-colors";
import type { Palette } from "./themes";

const BAR = { x: 12, y: 84, w: 176, h: 6, r: 3 } as const;
/** 18 px/600 runs ~10 px per glyph; 17 chars keeps clear of the right edge. */
const TITLE_MAX = 17;
/** The last pixel column a dial line may ink: 1.6.0 drew whole lines with
 * ink to column 198 and the census flags column 199, the slot's edge. */
const DIAL_LAST_COL = 198;
/** True when a line drawn from x inks nothing past DIAL_LAST_COL. */
function dialLineFits(runs: readonly TextRun[], x: number): boolean {
	return inksWithin(runs, "start", x, 1, DIAL_LAST_COL);
}
/** A start-anchored 12 to 18 px dial line: whole while its ink ends by the
 * edge, else cut where it still does. Runs of spaces draw as one, so they
 * are priced as one; a whole line keeps its own bytes. */
function fitDialLine(text: string, x: number, fontSize: number): string {
	const drawn = text.replace(/\s+/g, " ").trim();
	const fits = (line: string): boolean => dialLineFits([{ text: line, fontSize }], x);
	return fits(drawn) ? text : cutToFit(drawn, fits);
}
/** The smallest value tier fits ~19 glyphs; longer text ellipsizes. */
const VALUE_MAX = 19;

/**
 * 34 px/700 runs ~19 px per glyph: right for numeric values ("56.3"), far
 * too wide for the prose the status faces and the no-selection face put in
 * the value slot ("not detected", "rotate to pick", "un-elevate HWiNFO").
 * Two smaller tiers keep every such line inside the 200 px slot instead of
 * clipping at the edge (seen on the + XL strip with HWiNFO stopped).
 */
function valueFontSize(text: string): 34 | 24 | 17 {
	if (text.length <= 9) {
		return 34;
	}
	return text.length <= 13 ? 24 : 17;
}

/**
 * The wide three-row tile (V3): shared fixed columns and one CONTEXT LINE
 * carrying the deduped shared name plus the session stats. The stats always
 * render in full, right-anchored; the name is the only element that yields
 * (fill-to-width, one ellipsis). The active reading is a 4 px rail thumb on
 * the left groove, which doubles as the window's position in the full list.
 * The context line sits at the top (default) or the bottom, under the rows
 * and above a thin rule.
 */
const WIDE = { labelX: 12, valueRight: 168, unitLeft: 172, unitRight: 197, lineLeft: 2, lineRight: 196, lineGap: 6 } as const;
/** Value size ladder: largest step where the widest visible value fits the
 * shared column (right edge at x=168 unless a wide unit slides both
 * columns left, ~110 px of room). */
const WIDE_LADDER = [20, 18, 16, 14, 13, 12] as const;
const WIDE_VALUE_ROOM = 110;
/** Gap between a row's label run and its value's booked start. Thin on
 * purpose: labels fill all the way to their own row's value, because the
 * bg mask and the value paint after (over) the label, so the value owns
 * the pixels even when a width estimate runs hot. */
const WIDE_LABEL_GAP = 2;
/** Header position resolves the vertical layout. Bottom mode trades band
 * height for the rule separating rows from the context line. */
const WIDE_GEO = {
	top: { lineBaseline: 11, rule: null, rowsTop: 16, rowsBottom: 100, bandH: 26 },
	bottom: { lineBaseline: 95, rule: 81, rowsTop: 2, rowsBottom: 80, bandH: 24 }
} as const;
const ROW_VALUE_MAX = 12;
/** Units cap at 4 code points ("Mbps" stays whole, "Mbit/s" ellipsizes).
 * The cap counts glyphs, not pixels: wideUnitShift below is what keeps the
 * capped unit on the canvas. */
const WIDE_UNIT_MAX = 4;
/** Footer pixel budget for the TWO-ROW face (x=6 to ~x=194 at y=96), fitted
 * by estimated glyph widths (fitFooter). Exported so the dial action sizes
 * its roomy/tight footer choice against the same budget. */
export const FOOTER_PX = 188;
/** Whether the two-row footer draws this text whole: Tahoma by its ink
 * against the slot edge, Segoe UI by FOOTER_PX. */
export function footerFits(text: string): boolean {
	return isTahoma() ? dialLineFits([{ text: text.replace(/\s+/g, " ").trim(), fontSize: 12 }], 6) : estimateFooterWidth(text) <= FOOTER_PX;
}

/**
 * Ladder fit: the largest step where every visible value stays inside the
 * shared column. Character counts quantize up to even so the most common
 * length flicker (99.9 to 100) cannot re-truncate labels every tick.
 * Returns the chosen size and the estimated width the column books.
 */
/** One value's booked column width at `size`. Segoe UI: the even-quantized
 * character count (the flicker damping above) times its flat 700-weight char
 * factor, 0.6 (the previous per-tier table's 9.6/16 = 7.8/13 = 7.2/12).
 * Tahoma: its measured bold width, below. The end anchor makes alignment
 * exact regardless, and estimate error only moves the label budget. */
function wideValueWidth(text: string, size: number): number {
	const count = Array.from(text).length;
	if (isTahoma()) {
		// Tahoma books the larger of its measured bold width and 1.6.0's even-
		// quantized count (the flicker damping), so the size never steps above
		// 1.6.0's, nor past what Tahoma's real digits need.
		return Math.max(estimateKeyTextWidth(text, size, { fontWeight: 700 }), Math.ceil(count / 2) * 2 * 0.6 * size);
	}
	return Math.ceil(count / 2) * 2 * faceFont().valueEm * size;
}

export function wideValueFit(values: readonly string[]): { size: number; maxW: number } {
	for (const size of WIDE_LADDER) {
		const maxW = Math.max(0, ...values.map((v) => wideValueWidth(v, size)));
		if (maxW <= WIDE_VALUE_ROOM) {
			return { size, maxW };
		}
	}
	const floor = WIDE_LADDER[WIDE_LADDER.length - 1] as number;
	return { size: floor, maxW: Math.max(0, ...values.map((v) => wideValueWidth(v, floor))) };
}

/**
 * How far the shared value and unit columns slide left so the widest
 * VISIBLE unit's ink ends by WIDE.unitRight (the two-row view's idiom: the
 * widest unit places the anchors every row uses). Zero for every unit the
 * slot from x=172 already holds (°C, %, W, RPM, MHz, kbps, KB/s), so those
 * faces keep their columns to the byte. The 4-glyph rate units did not fit:
 * from x=172 "Mbps" inks to 202.4 on the 200 px canvas and lost its s, with
 * "MB/s" and "Gbps" on the edge. The estimate prices ink width, so the first
 * glyph's left bearing (~1 px) rides on top; the 3 px to the edge absorb it.
 */
function wideUnitShift(units: readonly string[]): number {
	if (isTahoma()) {
		// Tahoma: only as far as the widest unit's ink needs to end by the
		// slot edge from x=172 (RPM and MHz from there end by column 197).
		const right = Math.max(0, ...units.map((unit) => (unit === "" ? 0 : inkEdges([{ text: unit, fontSize: 12 }], "start", WIDE.unitLeft).right)));
		return Math.max(0, Math.ceil((right - DIAL_LAST_COL - INK_RIGHT_SLACK) * 10) / 10);
	}
	const maxW = Math.max(0, ...units.map((unit) => estimateKeyTextWidth(unit, 12)));
	return Math.max(0, Math.round((WIDE.unitLeft + maxW - WIDE.unitRight) * 10) / 10);
}

export interface OverviewRow {
	label: string;
	valueText: string;
	unitText: string;
	/** The reading on the dial right now; drawn as the rail thumb. */
	selected: boolean;
	/** Fully resolved value color (alert tint already applied by the caller,
	 * mirroring how the single view passes barColor). Alerts recolor the
	 * value TEXT only; nothing else on the face tints. */
	valueColor: string;
}

export interface DialOverviewOptions {
	/** Up to three visible rows, in rotation order. */
	rows: readonly OverviewRow[];
	/** The context line's left region: deduped shared name, state tags, or
	 * a transient overlay. Yields to the stats; empty to omit. */
	contextText: string;
	/** Session stats ("▼min ▲max"), right-anchored and ALWAYS in full; the
	 * caller owns the format. Empty omits it and the context text reclaims
	 * the width. */
	statsText: string;
	/** Context line position; default "top". */
	header?: "top" | "bottom";
	/** Thin track separators between rows (and the bottom-mode rule);
	 * default on. */
	separators?: boolean;
	palette: Palette;
	/** Resolved textual fills; defaults to the palette's own text tokens.
	 * Row value colors arrive per row, already resolved by the caller. */
	text?: TextColors;
}

/** The context line: the name yields into the remainder at 13 px, dropping
 * to 12 px, then fill-to-width ellipsis; the stats never yield. The canvas
 * still outranks the contract: a physically impossible stats width (fixed
 * decimals on 1e9-scale counters) pixel-fits to the whole line rather than
 * paint past the left edge, exactly like the single view's stats cap. The
 * stats draw LAST so a hot name estimate paints under the numbers, and the
 * name budget keeps 2 px of slack against them. */
function wideContextLine(baseline: number, contextText: string, statsText: string, colors: TextColors): string {
	const stats = statsText === "" ? "" : fitFooter(statsText, WIDE.lineRight - WIDE.lineLeft);
	const rightX = stats === "" ? WIDE.lineRight : WIDE.lineRight - estimateFooterWidth(stats) - WIDE.lineGap;
	let out = "";
	if (contextText !== "" && isTahoma()) {
		// Tahoma: the name's ink ends a clear gap before the stats' first ink
		// column, or by the slot edge when no stats show (an overlay).
		const statsInk = stats === "" ? null : inkEdges([{ text: stats, fontSize: 12 }], "end", WIDE.lineRight).left;
		const fits = (line: string, size: number): boolean => {
			const right = inkEdges([{ text: line, fontSize: size }], "start", WIDE.lineLeft).right;
			return statsInk === null ? right <= DIAL_LAST_COL + INK_RIGHT_SLACK : right <= statsInk - INK_CLEAR_GAP;
		};
		const name = fitLadderBy(contextText, [13, 12], fits);
		if (name.text !== "…") {
			out += `<text x="${WIDE.lineLeft}" y="${baseline}" text-anchor="start" font-family="${fontFamily()}" font-size="${name.fontSize}" font-weight="600" fill="${colors.label}">${escapeXml(name.text)}</text>`;
		}
	} else if (contextText !== "") {
		const maxW = rightX - WIDE.lineLeft - 2;
		if (maxW > 8) {
			// estimateFooterWidth is 12/600-calibrated; scale for the 13 px try.
			const size = estimateFooterWidth(contextText) * (13 / 12) <= maxW ? 13 : 12;
			const text = size === 13 ? contextText : fitFooter(contextText, maxW);
			out += `<text x="${WIDE.lineLeft}" y="${baseline}" text-anchor="start" font-family="${fontFamily()}" font-size="${size}" font-weight="600" fill="${colors.label}">${escapeXml(text)}</text>`;
		}
	}
	if (stats !== "") {
		out += `<text x="${WIDE.lineRight}" y="${baseline}" text-anchor="end" font-family="${fontFamily()}" font-size="12" font-weight="600" fill="${colors.unit}">${escapeXml(stats)}</text>`;
	}
	return out;
}

/**
 * The overview face, V3 wide tile: rail groove and thumb on the left, one
 * shared right-anchored value column (ladder-sized) with a unit column that
 * only leaves x=172 for a unit too wide to end on the canvas from there,
 * UPPERCASE pixel-fitted labels that fill to their own row's value,
 * optional separators, and the stats-priority context line. Same 200×100
 * pixmap contract as renderDial.
 */
export function renderDialOverview(opts: DialOverviewOptions): string {
	const { palette } = opts;
	const text = opts.text ?? themeTextColors(palette);
	const g = WIDE_GEO[opts.header === "bottom" ? "bottom" : "top"];
	const separators = opts.separators !== false;
	const rows = opts.rows.slice(0, 3).map((row) => {
		const valueText = truncateLabel(row.valueText, ROW_VALUE_MAX);
		return { ...row, valueText, unitText: cappedUnit(row.unitText, WIDE_UNIT_MAX) };
	});
	const fit = wideValueFit(rows.map((row) => row.valueText));
	// Both columns move together, so the value-to-unit gap never changes;
	// one decimal at most, and the unshifted face prints the bare 168/172.
	const shift = wideUnitShift(rows.map((row) => row.unitText));
	const valueRight = Math.round((WIDE.valueRight - shift) * 10) / 10;
	const unitLeft = Math.round((WIDE.unitLeft - shift) * 10) / 10;
	const pitch = (g.rowsBottom - g.rowsTop) / 3;
	const parts: string[] = [
		...svgOpen(200, 100, palette.bg),
		// The rail groove spans the rows region; the thumb rides in it.
		`<rect x="0" y="${g.rowsTop}" width="4" height="${g.rowsBottom - g.rowsTop}" fill="${palette.track}"/>`
	];
	if (separators) {
		for (let p = 1; p < rows.length; p++) {
			parts.push(`<rect x="4" y="${Math.round(g.rowsTop + p * pitch)}" width="196" height="1" fill="${palette.track}"/>`);
		}
		if (g.rule !== null) {
			parts.push(`<rect x="0" y="${g.rule}" width="200" height="1" fill="${palette.track}"/>`);
		}
	}
	rows.forEach((row, pos) => {
		const bandTop = Math.round(g.rowsTop + pos * pitch + (pitch - g.bandH) / 2);
		// Baseline computed (no dominant-baseline on this engine): optical
		// center of the band plus 0.34 em.
		const baseline = Math.round((bandTop + g.bandH / 2 + fit.size * 0.34) * 10) / 10;
		if (row.selected) {
			parts.push(`<rect x="0" y="${bandTop}" width="4" height="${g.bandH}" rx="2" fill="${palette.accent}"/>`);
		}
		// The label fills to ITS OWN row's value, not the widest row's, and
		// ellipsizes only when genuinely longer. Painting order is the real
		// guarantee: the mask and the value draw after the label, so a hot
		// estimate ends up under the value, never over it.
		// Tahoma: the label's ink ends a clear gap before this row's value ink;
		// the mask starts 1.5 px before that ink, past the label's last column.
		const valueInk = isTahoma() ? inkEdges([{ text: row.valueText, fontSize: fit.size, fontWeight: 700 }], "end", valueRight).left : 0;
		const labelRight = isTahoma() ? valueInk - 1.5 : valueRight - wideValueWidth(row.valueText, fit.size) - WIDE_LABEL_GAP;
		// Both fonts price the label on their measured tables, with no
		// letter-spacing: the app's QtSvg draws none (measured even at 3 px),
		// so writing it only made previews wider than the device. Segoe UI's
		// estimate credits side bearings, so it keeps 2 px of slack.
		const label = isTahoma()
			? fitLadderBy(row.label.toUpperCase(), [12], (line) => inkEdges([{ text: line, fontSize: 12 }], "start", WIDE.labelX).right <= valueInk - INK_CLEAR_GAP).text
			: fitTextLadder(row.label.toUpperCase(), Math.max(0, labelRight - WIDE.labelX), [12], { minimumSlack: 2 }).text;
		parts.push(
			`<text x="${WIDE.labelX}" y="${baseline}" text-anchor="start" font-family="${fontFamily()}" font-size="12" font-weight="600" fill="${row.selected ? text.label : text.unit}">${escapeXml(label)}</text>`,
			// Bg-colored insurance between the label run and this row's value:
			// invisible (rows sit on plain bg), and renderer-proof where the
			// label estimate ran hot (clipPath is unproven on this engine).
			`<rect x="${labelRight.toFixed(1)}" y="${bandTop}" width="${(200 - labelRight).toFixed(1)}" height="${g.bandH}" fill="${palette.bg}"/>`,
			`<text x="${valueRight}" y="${baseline}" text-anchor="end" font-family="${fontFamily()}" font-size="${fit.size}" font-weight="700" fill="${row.valueColor}">${escapeXml(row.valueText)}</text>`
		);
		if (row.unitText !== "") {
			parts.push(`<text x="${unitLeft}" y="${baseline}" text-anchor="start" font-family="${fontFamily()}" font-size="12" font-weight="600" fill="${text.unit}">${escapeXml(row.unitText)}</text>`);
		}
	});
	parts.push(wideContextLine(g.lineBaseline, opts.contextText, opts.statsText, text));
	parts.push("</svg>");
	return parts.join("");
}

/** Two-row view: 40 px rows at y=4 and y=46, the footer in its usual slot.
 * Each row is a label line over a value line; the value line's left side
 * carries either the label's wrapped second line or a sparkline. Its table
 * columns are placed by the widest VISIBLE unit and value, estimated from
 * character counts (the engine cannot be asked to measure); the end anchor
 * makes digit alignment exact regardless of estimate error. */
const TWO_ROW = { tops: [4, 46], height: 40, labelBaseline: 13, valueBaseline: 36 } as const;
const RIGHT_EDGE = 192;
const VALUE_UNIT_GAP = 4;
/** Units are mostly caps (RPM, MHz, W): budget them at caps width. */
const EST_UNIT_CHAR = 8;
const EST_LABEL_CHAR = 6.5;
const ROW_LABEL_MIN = 8;
const ROW_UNIT_MAX = 5;
/** The label line spans the full slot: ~27 chars at 13 px/600. */
const TWO_ROW_LINE1_MAX = 27;
const TWO_ROW_SPARK = { y: 25, h: 12, minW: 40 } as const;
/** Big-value tiers for the two-row view; per-char width estimates below. */
const EST_TWO_ROW_VALUE: Record<26 | 20 | 16, number> = { 26: 15.6, 20: 12, 16: 9.6 };

/** Two-row value size: 26 px for the numeric norm, stepped for extremes. */
export function twoRowValueFontSize(text: string): 26 | 20 | 16 {
	const count = Array.from(text).length;
	if (count <= 6) {
		return 26;
	}
	return count <= 9 ? 20 : 16;
}

export interface TwoRowRow {
	/** Units share the selected row's actual surface with its value. */
	unitColor?: string;
	/** This row's label fill when it is the selected row, resolved on the
	 * track band like unitColor (resolveTextColors keeps that label no dimmer
	 * than its unit in every mode). Unselected rows ignore it: they take the
	 * unit token, which is the selection cue. Absent, the renderer lifts the
	 * face label to read no dimmer than this row's unit on the band. */
	selectedLabelColor?: string;
	label: string;
	valueText: string;
	unitText: string;
	selected: boolean;
	/** Fully resolved value color (alert tint applied by the caller). */
	valueColor: string;
	/** Recent native values; drawn as a sparkline when the label does not
	 * need its second line and 2+ points exist. */
	history?: readonly number[];
}

export interface DialTwoRowOptions {
	/** Up to two visible rows, in rotation order. */
	rows: readonly TwoRowRow[];
	/** Stats/overlay/state line under the rows; empty to omit. */
	footerText: string;
	palette: Palette;
	/** Resolved textual fills; defaults to the palette's own text tokens.
	 * Row value colors arrive per row, already resolved by the caller. */
	text?: TextColors;
}

/**
 * The two-row face: bigger values than the three-row overview (26 px vs
 * 16 px), a full-width label line per row, and the value line's left side
 * put to work: a long label wraps onto it, a short label frees it for a
 * sparkline of that reading's recent values (the key strip's own idiom:
 * track under-fill, accent line, end dot). Values and units share the same
 * table columns as the three-row view, footer semantics included.
 */
export function renderDialTwoRow(opts: DialTwoRowOptions): string {
	const { palette } = opts;
	const text = opts.text ?? themeTextColors(palette);
	const rows = opts.rows.slice(0, 2).map((row) => {
		const valueText = truncateLabel(row.valueText, ROW_VALUE_MAX);
		return {
			...row,
			valueText,
			unitText: cappedUnit(row.unitText, ROW_UNIT_MAX),
			size: twoRowValueFontSize(valueText)
		};
	});
	// Shared table columns, like the three-row view: widest unit, then the
	// widest value, place the anchors every row uses.
	const maxUnitW = Math.max(0, ...rows.map((row) => (row.unitText === "" ? 0 : isTahoma() ? Math.ceil(estimateKeyTextWidth(row.unitText, 13)) : Array.from(row.unitText).length * EST_UNIT_CHAR)));
	const unitX = RIGHT_EDGE - maxUnitW;
	const valueEndX = maxUnitW === 0 ? RIGHT_EDGE : unitX - VALUE_UNIT_GAP;
	// Tahoma books measured bold widths (one digit of flicker damping on odd
	// counts), so the second label line is sized to the room the value
	// really leaves.
	const maxValueW = Math.max(
		0,
		...rows.map((row) =>
			isTahoma()
				? estimateKeyTextWidth(row.valueText, row.size, { fontWeight: 700 }) + (Array.from(row.valueText).length % 2 === 1 ? estimateKeyTextWidth("0", row.size, { fontWeight: 700 }) : 0)
				: Math.ceil(Array.from(row.valueText).length / 2) * 2 * EST_TWO_ROW_VALUE[row.size]
		)
	);
	const valueStartEst = valueEndX - maxValueW;
	const line2Max = Math.max(ROW_LABEL_MIN, Math.floor((valueStartEst - 20) / EST_LABEL_CHAR));
	const parts: string[] = svgOpen(200, 100, palette.bg);
	rows.forEach((row, i) => {
		const top = TWO_ROW.tops[i] as number;
		const rowBg = row.selected ? palette.track : palette.bg;
		if (row.selected) {
			parts.push(
				`<rect x="0" y="${top}" width="200" height="${TWO_ROW.height}" fill="${palette.track}"/>`,
				`<rect x="2" y="${top + 4}" width="4" height="32" rx="2" fill="${palette.accent}"/>`
			);
		}
		// Tahoma: a second line only where the value leaves it readable room;
		// otherwise one cut line, and line 2 goes to the trend.
		// Tahoma: line two ends a clear gap before THIS row's value ink (the
		// other row's wider value no longer costs it room), line one by the
		// slot edge.
		const rowInk = isTahoma() ? inkEdges([{ text: row.valueText, fontSize: row.size, fontWeight: 700 }], "end", valueEndX).left : valueStartEst;
		const room2 = isTahoma() ? rowInk - INK_CLEAR_GAP - 12 : valueStartEst - 20;
		const line1Fits = (line: string): boolean => dialLineFits([{ text: line, fontSize: 13 }], 12);
		const line2Fits = (line: string): boolean => inkEdges([{ text: line, fontSize: 13 }], "start", 12).right <= rowInk - INK_CLEAR_GAP;
		const lines = isTahoma() ? (room2 >= 40 ? wrapLabelTwoLinesBy(row.label, line1Fits, line2Fits) : [fitLadderBy(row.label, [13], line1Fits).text]) : wrapLabelTwoLines(row.label, TWO_ROW_LINE1_MAX, line2Max);
		// The label token marks the selected row; the unit token paints the
		// other. The selected row sits on the track, where the face label
		// can read dimmer than the row's own unit (Dim lifts units to the
		// numeric floor), so the caller resolves the label there too; failing
		// that, the label lifts to its unit's ratio on the band. A label that
		// already passes (every theme in Theme mode) keeps its bytes.
		const labelColor = row.selected ? (row.selectedLabelColor ?? noDimmerThan(text.label, row.unitColor ?? text.unit, rowBg)) : text.unit;
		parts.push(
			`<text x="12" y="${top + TWO_ROW.labelBaseline}" text-anchor="start" font-family="${fontFamily()}" font-size="13" font-weight="600" fill="${labelColor}">${escapeXml(lines[0] as string)}</text>`
		);
		if (lines.length > 1) {
			parts.push(
				`<text x="12" y="${top + TWO_ROW.valueBaseline}" text-anchor="start" font-family="${fontFamily()}" font-size="13" font-weight="600" fill="${labelColor}">${escapeXml(lines[1] as string)}</text>`
			);
		} else if (row.history !== undefined) {
			// The freed line hosts the trend: self-normalized over its own
			// samples, drawn only when it has real width and 2+ points.
			const sparkW = valueStartEst - 12 - 12;
			const samples = row.history.slice(-HISTORY_LENGTH);
			const points = sparkW >= TWO_ROW_SPARK.minW ? sparklinePoints(samples, 12, top + TWO_ROW_SPARK.y, sparkW, TWO_ROW_SPARK.h) : [];
			if (points.length > 0) {
				parts.push(...sparklineSvg(points, top + TWO_ROW_SPARK.y + TWO_ROW_SPARK.h, 3, 3.5, palette));
			}
		}
		parts.push(
			// The mask covers only the value line's band, so a wrapped label
			// or sparkline that ran long is clipped renderer-proof, while the
			// full-width label line above stays untouched.
			`<rect x="${(isTahoma() ? rowInk - 1.5 : valueStartEst - 4).toFixed(1)}" y="${top + 18}" width="${(isTahoma() ? 201.5 - rowInk : 204 - valueStartEst).toFixed(1)}" height="${TWO_ROW.height - 18}" fill="${rowBg}"/>`,
			`<text x="${valueEndX.toFixed(1)}" y="${top + TWO_ROW.valueBaseline}" text-anchor="end" font-family="${fontFamily()}" font-size="${row.size}" font-weight="700" fill="${row.valueColor}">${escapeXml(row.valueText)}</text>`
		);
		if (row.unitText !== "") {
			parts.push(`<text x="${unitX.toFixed(1)}" y="${top + TWO_ROW.valueBaseline}" text-anchor="start" font-family="${fontFamily()}" font-size="13" font-weight="600" fill="${row.unitColor ?? text.unit}">${escapeXml(row.unitText)}</text>`);
		}
	});
	if (opts.footerText !== "") {
		parts.push(`<text x="6" y="96" text-anchor="start" font-family="${fontFamily()}" font-size="12" font-weight="600" fill="${text.unit}">${escapeXml(isTahoma() ? fitDialLine(opts.footerText, 6, 12) : fitFooter(opts.footerText, FOOTER_PX))}</text>`);
	}
	parts.push("</svg>");
	return parts.join("");
}

export interface DialRenderOptions {
	title: string;
	valueText: string;
	/** Rendered inline after the value; empty to omit. */
	unitText: string;
	/** Single stats line under the value; empty to omit. */
	statsText: string;
	/** Bar fill fraction 0–1; NaN hides the fill. */
	fraction: number;
	/** Theme tokens — dials stay themed even while alerting. */
	palette: Palette;
	/** Bar fill: accent (or type accent) normally, the alert bg when alerting. */
	barColor: string;
	/** Threshold zones on the bar track, colors resolved by the caller;
	 * absent or empty keeps the established track+fill bar untouched. */
	zones?: readonly DrawnZone[];
	/** Resolved textual fills; defaults to the palette's own text tokens. */
	text?: TextColors;
}

/** One zone segment on the dial bar: squared mid-track, pill-rounded where
 * it reaches an end of the track (the key bar's shared segment idiom). */
function dialZoneSvg(zone: DrawnZone): string {
	const x = BAR.x + zone.from * BAR.w;
	const w = (zone.to - zone.from) * BAR.w;
	if (w <= 0) {
		return "";
	}
	return barSegment(x, w, BAR.y, BAR.h, BAR.r, zone.color, zone.from <= 0, zone.to >= 1);
}

/** Tahoma: the single dial keeps the char-count tier while the value line's
 * ink ends by the slot edge; the inline gap gives way before the size does,
 * as on a two-reading key, so a line 1.6.0 drew tight keeps its size. */
function tahomaDialValueFit(value: string, unit: string): { size: 34 | 24 | 17; gap: boolean } {
	const tier = valueFontSize(value);
	const line = (size: number, gap: boolean): TextRun[] => [{ text: value, fontSize: size, fontWeight: 700 }, ...(unit === "" ? [] : [{ text: (gap ? inlineGap(17) : "") + unit, fontSize: 17 }])];
	for (const s of [34, 24, 17] as const) {
		if (s > tier) continue;
		if (dialLineFits(line(s, true), 12)) return { size: s, gap: true };
		if (unit !== "" && dialLineFits(line(s, false), 12)) return { size: s, gap: false };
	}
	// Past the edge even at the floor: the tighter line runs out least.
	return { size: 17, gap: unit === "" };
}

/** Segoe UI's stats line room, from x=12. Tahoma fits by ink to the slot
 * edge; Segoe UI has only its per-class footer estimate, which can price a
 * line about a pixel under its ink, so it keeps 4 px of margin
 * ("▼0.000bps ▲784.000Mbps session" inked to column 199 at 186). */
const SEGOE_STATS_LINE_BUDGET = 182;

/** The stats line, priced as drawn (SVG draws a run of spaces as one):
 * whole at 12 px while it fits, else whole at 11 px, so "▼ 1540   ▲ 2238
 * cycle paused" and a long rate line keep every word. Only a line 11 px
 * cannot hold leaves off its quiet "session" tag, and only then is it cut.
 * A whole line keeps its own bytes. */
function fitStatsLine(stats: string): FittedText {
	const drawn = stats.replace(/\s+/g, " ").trim();
	const wholeSize = (line: string): number => {
		if (isTahoma()) return dialLineFits([{ text: line, fontSize: 12 }], 12) ? 12 : dialLineFits([{ text: line, fontSize: 11 }], 12) ? 11 : 0;
		const width = estimateFooterWidth(line);
		return width <= SEGOE_STATS_LINE_BUDGET ? 12 : (width * 11) / 12 <= SEGOE_STATS_LINE_BUDGET ? 11 : 0;
	};
	const size = wholeSize(drawn);
	if (size !== 0) return { text: stats, fontSize: size };
	const quiet = drawn.startsWith("▼") ? drawn.replace(/ session$/, "") : drawn;
	const quietSize = quiet === drawn ? 0 : wholeSize(quiet);
	if (quietSize !== 0) return { text: quiet, fontSize: quietSize };
	return { text: isTahoma() ? cutToFit(drawn, (line) => dialLineFits([{ text: line, fontSize: 12 }], 12)) : fitFooter(drawn, SEGOE_STATS_LINE_BUDGET), fontSize: 12 };
}

/** Tahoma: where a whole 12 px stats line starts when ending it by the slot
 * edge from x=12 would cost it 11 px: up to 2.5 px left, where its ink still
 * starts by x=12, so it keeps 1.6.0's size. 12 when no such start exists. */
function statsLineShift(stats: string): number {
	const drawn = stats.replace(/\s+/g, " ").trim();
	const right = inkEdges([{ text: drawn, fontSize: 12 }], "start", 12).right;
	const over = Math.ceil((right - DIAL_LAST_COL - INK_RIGHT_SLACK) * 10) / 10;
	return over > 0 && over <= 2.5 ? Number((12 - over).toFixed(1)) : 12;
}

export function renderDial(opts: DialRenderOptions): string {
	const { palette, barColor } = opts;
	const text = opts.text ?? themeTextColors(palette);
	const parts: string[] = [
		...svgOpen(200, 100, palette.bg),
		`<text x="12" y="24" text-anchor="start" font-family="${fontFamily()}" font-size="18" font-weight="600" fill="${text.label}">${escapeXml(isTahoma() ? fitDialLine(opts.title, 12, 18) : truncateLabel(opts.title, TITLE_MAX))}</text>`
	];
	const valueText = truncateLabel(opts.valueText, VALUE_MAX);
	const valueFit = isTahoma() ? tahomaDialValueFit(valueText, opts.unitText) : { size: valueFontSize(valueText), gap: true };
	const unit = opts.unitText !== "" ? `<tspan font-size="17" font-weight="600" fill="${text.unit}">${valueFit.gap ? inlineGap(17) : ""}${escapeXml(opts.unitText)}</tspan>` : "";
	parts.push(`<text x="12" y="58" text-anchor="start"${unit === "" || !valueFit.gap ? "" : PRESERVE} font-family="${fontFamily()}" font-size="${valueFit.size}" font-weight="700" fill="${text.value}">${escapeXml(valueText)}${unit}</text>`);
	if (opts.statsText !== "") {
		const stats = fitStatsLine(opts.statsText);
		const statsX = isTahoma() && stats.fontSize === 11 ? statsLineShift(opts.statsText) : 12;
		const shifted = statsX < 12;
		parts.push(`<text x="${statsX}" y="78" text-anchor="start" font-family="${fontFamily()}" font-size="${shifted ? 12 : stats.fontSize}" font-weight="600" fill="${text.unit}">${escapeXml(shifted ? opts.statsText : stats.text)}</text>`);
	}
	parts.push(`<rect x="${BAR.x}" y="${BAR.y}" width="${BAR.w}" height="${BAR.h}" rx="${BAR.r}" fill="${palette.track}"/>`);
	for (const zone of opts.zones ?? []) {
		parts.push(dialZoneSvg(zone));
	}
	if (Number.isFinite(opts.fraction) && opts.fraction > 0) {
		const w = Math.max(BAR.h, Math.min(1, opts.fraction) * BAR.w);
		parts.push(`<rect x="${BAR.x}" y="${BAR.y}" width="${w.toFixed(1)}" height="${BAR.h}" rx="${BAR.r}" fill="${barColor}"/>`);
	}
	parts.push("</svg>");
	return parts.join("");
}
