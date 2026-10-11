/** Value formatting, unit conversion and stat-mode selection. */
import type { Reading } from "../hwinfo/types";
import { faceFont, isTahoma, SEGOE_UI } from "./face-font";

export type StatMode = "current" | "min" | "max" | "avg";
export type DecimalsSetting = "auto" | "0" | "1" | "2" | "3";

export const STAT_MODES: readonly StatMode[] = ["current", "min", "max", "avg"];

/** Short badge shown when a non-current stat is displayed. */
export const STAT_BADGE: Record<StatMode, string> = {
	current: "",
	min: "MIN",
	max: "MAX",
	avg: "AVG"
};

export function isStatMode(value: unknown): value is StatMode {
	return typeof value === "string" && (STAT_MODES as readonly string[]).includes(value);
}

/** The press-cycle successor: current, min, max, avg, wrapping. */
export function nextStatMode(mode: StatMode): StatMode {
	return STAT_MODES[(STAT_MODES.indexOf(mode) + 1) % STAT_MODES.length] as StatMode;
}

export function statValue(reading: Reading, mode: StatMode): number {
	if (mode !== "current" && reading.statistics === "unavailable") return Number.NaN;
	switch (mode) {
		case "min":
			return reading.valueMin;
		case "max":
			return reading.valueMax;
		case "avg":
			return reading.valueAvg;
		default:
			return reading.value;
	}
}

/** An unavailable historical field must never wear a numeric MIN/MAX/AVG. */
export function readingStatBadge(reading: Reading | undefined, mode: StatMode): string {
	return mode !== "current" && reading !== undefined && !Number.isFinite(statValue(reading, mode)) ? "N/A" : STAT_BADGE[mode];
}

/** One badge shared by several rows reads N/A only when no present row has
 * the stat; while any row has it, the badge names the stat, as 1.6.0's did. */
export function sharedStatBadge(readings: ReadonlyArray<Reading | undefined>, mode: StatMode): string {
	const present = readings.filter((reading): reading is Reading => reading !== undefined);
	return mode !== "current" && present.length > 0 && present.every((reading) => !Number.isFinite(statValue(reading, mode))) ? "N/A" : STAT_BADGE[mode];
}

/** Converts a value for display; only °C→°F is meaningful in HWiNFO data. */
export function convertUnit(value: number, unit: string, fahrenheit: boolean): { value: number; unit: string } {
	if (fahrenheit && unit === "°C") {
		return { value: value * 1.8 + 32, unit: "°F" };
	}
	return { value, unit };
}

/** The generic magnitude ladder auto-compaction climbs (thousand steps). */
const MAGNITUDES = [
	{ suffix: "k", scale: 1_000 },
	{ suffix: "M", scale: 1_000_000 },
	{ suffix: "G", scale: 1_000_000_000 },
	{ suffix: "T", scale: 1_000_000_000_000 }
] as const;

/**
 * Precision by magnitude band: whole numbers from 100, one decimal from 10,
 * two below. The key's established rhythm, reused at every compacted tier.
 */
export function bandPrecision(abs: number): 0 | 1 | 2 {
	return abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
}

/** toFixed with the sign dropped from a zero result: "-0.00" reads as a
 * negative reading that isn't there. */
export function fixed(value: number, digits: number): string {
	const text = value.toFixed(digits);
	return Number(text) === 0 ? (0).toFixed(digits) : text;
}

/**
 * Formats a value for a 72 px key. "auto" scales precision with magnitude and
 * compacts large values through k/M/G/T (48700 → "48.7k", 48700000 → "48.7M")
 * so they never overflow the key. Rounding rolls over cleanly: a value that
 * would round to "1000k" is promoted to "1.00M" instead.
 */
export function formatValue(value: number, decimals: DecimalsSetting): string {
	if (!Number.isFinite(value)) {
		return "—";
	}
	if (decimals !== "auto") {
		return fixed(value, Number(decimals));
	}
	const abs = Math.abs(value);
	if (abs < 10_000) {
		return fixed(value, bandPrecision(abs));
	}
	let tier = 0;
	while (tier < MAGNITUDES.length - 1 && abs / (MAGNITUDES[tier] as (typeof MAGNITUDES)[number]).scale >= 1000) {
		tier++;
	}
	for (;;) {
		const { suffix, scale } = MAGNITUDES[tier] as (typeof MAGNITUDES)[number];
		const scaled = value / scale;
		const text = fixed(scaled, bandPrecision(Math.abs(scaled)));
		const rounded = Math.abs(Number(text));
		if (rounded >= 1000 && tier < MAGNITUDES.length - 1) {
			tier++;
			continue;
		}
		// Rounding can cross a precision band (9.99 → "10.0"): settle on the
		// band the rounded value actually lands in.
		return `${fixed(scaled, bandPrecision(rounded))}${suffix}`;
	}
}

/**
 * Formats a value for one 72 px quad-grid cell: at most 4 glyphs through
 * ±9999T, which covers every HWiNFO reading. The
 * shared decimals setting is the starting precision ("auto" starts from
 * formatValue's magnitude rule); decimals drop first, then the magnitude
 * compacts through k/M/G/T, so 48700 reads "49k" instead of overflowing the
 * cell. The sign counts as a glyph. Past ±9999T the text runs longer and
 * the renderer truncates it at 7 code points.
 */
export function formatQuadValue(value: number, decimals: DecimalsSetting): string {
	if (!Number.isFinite(value)) {
		return "—";
	}
	const startPrecision = (abs: number): number => {
		if (decimals !== "auto") {
			return Number(decimals);
		}
		return bandPrecision(abs);
	};
	const tiers = [
		{ suffix: "", scale: 1 },
		{ suffix: "k", scale: 1_000 },
		{ suffix: "M", scale: 1_000_000 },
		{ suffix: "G", scale: 1_000_000_000 },
		{ suffix: "T", scale: 1_000_000_000_000 }
	];
	for (const { suffix, scale } of tiers) {
		const scaled = value / scale;
		for (let d = startPrecision(Math.abs(scaled)); d >= 0; d--) {
			const text = `${fixed(scaled, d)}${suffix}`;
			if (Array.from(text).length <= 4) {
				return text;
			}
		}
	}
	// Past ±9999T, which no HWiNFO reading approaches: no tier fits, so the
	// T-scaled text runs long and the renderer truncates it.
	return `${Math.round(value / 1_000_000_000_000)}T`;
}

/** Parses a threshold field coming from the PI (string or number, may be empty). */
export function parseThreshold(raw: unknown): number | undefined {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return raw;
	}
	if (typeof raw === "string" && raw.trim() !== "") {
		// The PI accepts locale decimal commas ("70,5") — Number() does not.
		const n = Number(raw.trim().replace(",", "."));
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
}

/**
 * Whether thresholds and manual bar ranges configured against `alertUnit`
 * apply to a reading measured in `readingUnit`. A warn value typed for a
 * temperature must never fire on a fan's RPM after rotating to it: numbers
 * only compare within one unit.
 *
 * `undefined` means unscoped: settings that predate unit scoping keep the
 * old apply-everywhere behavior until the user next edits a threshold
 * (which anchors it to the reading on screen). An empty string is a REAL
 * unit (a unitless reading) and scopes to unitless readings only; conflating it with unscoped would both widen alerts and defeat the
 * stamped-check.
 */
export function thresholdsApplyTo(alertUnit: string | undefined, readingUnit: string): boolean {
	if (alertUnit === undefined || alertUnit === readingUnit) return true;
	// Through 1.6.0 a Gadget boolean reading published its display word as
	// the unit, so a threshold edited there was stamped "Yes" or "No". The
	// reading's unit is "Yes/No" now; that stamp still means this reading.
	return readingUnit === "Yes/No" && (alertUnit === "Yes" || alertUnit === "No");
}

/**
 * The unit as a width-capped dense row draws it. HWiNFO's boolean unit does
 * not survive a cap ("Yes/…" beside a 0 says nothing), and the 0 or 1
 * already carries the state, so those rows draw no unit and the label keeps
 * the room.
 */
export function cappedUnit(unit: string, max: number): string {
	return unit === "" || unit === "Yes/No" ? "" : truncateLabel(unit, max);
}

export type AlertLevel = "normal" | "warn" | "crit";

/**
 * Evaluates warn/critical thresholds against the *live* (current) value in the
 * displayed unit. With `alertBelow`, lower is worse (e.g. fan RPM); otherwise
 * higher is worse (temperatures, power). A value that is not a finite number
 * never alerts: NaN compares false anyway, but an overflowed raw field
 * ("1e400" in a Gadget row) parses to Infinity, which is beyond every limit
 * in one direction while the face shows the value as unavailable.
 */
export function alertLevel(current: number, warn: number | undefined, crit: number | undefined, alertBelow: boolean): AlertLevel {
	if (!Number.isFinite(current)) return "normal";
	const beyond = (limit: number): boolean => (alertBelow ? current <= limit : current >= limit);
	if (crit !== undefined && beyond(crit)) {
		return "crit";
	}
	if (warn !== undefined && beyond(warn)) {
		return "warn";
	}
	return "normal";
}

/**
 * Truncates a label to fit a key, appending an ellipsis when cut. Operates on
 * code points, not UTF-16 units — slicing through a surrogate pair would leave
 * a lone surrogate that makes encodeURIComponent throw on the rendered SVG.
 */
export function truncateLabel(label: string, max: number): string {
	const chars = Array.from(label);
	return chars.length <= max ? label : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * Estimated pixel width of a string at the dial footer's 12 px/600, by
 * glyph class (the Stream Deck engine cannot be asked to measure). Narrow
 * lowercase, digits, caps, spaces and the footer's marker glyphs each carry
 * their own budget, so a footer full of narrow letters fits more characters
 * than one full of caps, instead of both being cut at a flat count.
 */
export function estimateFooterWidth(text: string): number {
	// Tahoma prices footers with its measured table; the classes below are
	// Segoe UI's.
	if (isTahoma()) return estimateKeyTextWidth(text, 12);
	let width = 0;
	for (const ch of text) {
		if (ch === "▼" || ch === "▲") {
			width += 12;
		} else if (ch === " ") {
			width += 3.4;
		} else if (ch === "·") {
			width += 5;
		} else if (ch === "…") {
			width += 10;
		} else if (ch === "i" || ch === "j" || ch === "l" || ch === "." || ch === ",") {
			width += 3.2;
		} else if (ch >= "0" && ch <= "9") {
			width += 6.3;
		} else if (ch >= "A" && ch <= "Z") {
			width += 7.6;
		} else if (ch >= "a" && ch <= "z") {
			width += 6.1;
		} else {
			width += 7;
		}
	}
	return width;
}

/**
 * East Asian wide and fullwidth code points advance a full em (Segoe UI
 * falls back to the system CJK fonts): CJK ideographs (base and extensions),
 * kana, hangul, CJK punctuation/compatibility, fullwidth forms, and the
 * supplementary ideographic planes. Estimating them at the 7 px default
 * would undercount by ~40% and overflow the face.
 */
function isWideGlyph(code: number): boolean {
	return (
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0x303e) ||
		(code >= 0x3041 && code <= 0x33ff) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0xa000 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe4f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		// Emoji and symbol planes plus the supplementary ideographs: all
		// full-width-or-wider in every fallback font.
		code >= 0x1f000
	);
}

/** One glyph's advance at the 12 px basis, from the deck's face font
 * (face-font.ts holds the measured tables). */
function keyGlyphWidth12(ch: string): number {
	const mapped = faceFont().advance12[ch];
	if (mapped !== undefined) {
		return mapped;
	}
	// East Asian wide and fullwidth glyphs advance a full em.
	if (isWideGlyph(ch.codePointAt(0) as number)) {
		return 12;
	}
	return faceFont().unmapped12;
}


export type TextFitOptions = {
	/** Glyph weight the caller will render; the face font's table is at its
	 * label weight. */
	fontWeight?: 600 | 700;
	/** Extra px the fit must leave unused, on top of the caller's budget. */
	minimumSlack?: number;
};

/**
 * Estimated ink width of a string as a key face renders it: the measured
 * advance table scaled linearly from its 12 px calibration, minus the
 * terminal-bearing credit and a flat widening for weight 700. Estimation only (the Stream Deck engine cannot be
 * asked to measure), but calibrated against rasterized ink, so callers can
 * spend their whole pixel budget.
 */
export function estimateKeyTextWidth(text: string, fontSize: number, options?: TextFitOptions): number {
	const font = faceFont();
	const bold = options?.fontWeight === 700;
	// A bold face may draw its digits wider than the table's narrow ones; the
	// floor is divided back out so the bold factor below restores it.
	const digitFloor = bold && font.boldDigit12 !== undefined ? font.boldDigit12 / font.boldFactor : 0;
	let width = 0;
	let count = 0;
	for (const ch of text) {
		const advance = keyGlyphWidth12(ch);
		width += ch >= "0" && ch <= "9" ? Math.max(advance, digitFloor) : advance;
		count++;
	}
	if (count > 0) {
		width -= font.bearingCredit12;
	}
	width = (width * fontSize) / 12;
	if (bold) {
		width *= font.boldFactor;
	}
	return width;
}

/** One fitted string: what to draw, at what size. */
export type FittedText = {
	text: string;
	fontSize: number;
};

/**
 * Fits text into a pixel budget down a font-size ladder: the largest size
 * whose whole-string estimate fits wins; when even the smallest size cannot
 * hold the whole string, the widest fitting prefix plus an ellipsis renders
 * at that floor size. Code-point based (never splits a surrogate pair) and
 * deterministic: same text, budget and ladder always fit identically.
 */
export function fitTextLadder(text: string, maxWidth: number, sizes: readonly number[], options?: TextFitOptions): FittedText {
	if (text === "") {
		return { text: "", fontSize: sizes[0] as number };
	}
	const budget = maxWidth - (options?.minimumSlack ?? 0);
	const floor = sizes[sizes.length - 1] as number;
	for (const size of sizes) {
		if (estimateKeyTextWidth(text, size, options) <= budget) {
			return { text, fontSize: size };
		}
	}
	const chars = Array.from(text);
	// Pre-cut the prefix walk: the narrowest glyph advance is 2.9px at
	// size 12 (scaled by the floor), so no prefix longer than budget/perChar
	// can ever fit. Without the cut, the walk from the far end of an
	// unbounded label (a panel paste, a hand-edited profile, a registry
	// label) is quadratic: 16.8 s at 40k chars, synchronous inside the tick.
	const perChar = (2.9 * floor) / 12;
	const maxFit = Math.max(1, Math.ceil(budget / perChar) + 2);
	for (let i = Math.min(chars.length - 1, maxFit); i > 0; i--) {
		const candidate = `${chars.slice(0, i).join("").trimEnd()}…`;
		if (estimateKeyTextWidth(candidate, floor, options) <= budget) {
			return { text: candidate, fontSize: floor };
		}
	}
	return { text: "…", fontSize: floor };
}

/** One run of a drawn line: the text element's own text or one of its
 * tspans, each at its own size. */
export type TextRun = { text: string; fontSize: number; fontWeight?: 600 | 700 };

/** A line's extent from its pen start: the advance, and where its ink
 * starts and ends. Tahoma carries each glyph's measured ink insets; a glyph
 * without them (unmapped, wide, or any glyph under Segoe UI) inks its whole
 * advance, and a blank glyph inks nothing. */
export type InkSpan = { advance: number; left: number; right: number };

export function inkSpan(runs: readonly TextRun[]): InkSpan {
	const insets = faceFont().insets12;
	if (insets === undefined) {
		const advance = runs.reduce((sum, run) => sum + estimateKeyTextWidth(run.text, run.fontSize, { fontWeight: run.fontWeight }), 0);
		return { advance, left: 0, right: advance };
	}
	let pen = 0;
	let left = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	for (const run of runs) {
		const k = run.fontSize / 12;
		for (const ch of run.text) {
			const advance = keyGlyphWidth12(ch) * k;
			const inset = insets.get(ch);
			if (inset !== null) {
				left = Math.min(left, pen + (inset === undefined ? 0 : inset[0] * k));
				right = Math.max(right, pen + advance - (inset === undefined ? 0 : inset[1] * k));
			}
			pen += advance;
		}
	}
	return left === Number.POSITIVE_INFINITY ? { advance: pen, left: 0, right: 0 } : { advance: pen, left, right };
}

/**
 * The pixel rule behind every ink fit, measured through the app's QtSvg
 * 6.9.3 on 405,856 probe strings (every generated Tahoma Bold glyph at both
 * ends of a line, 11 to 52 px, 10 to 32 subpixel phases; a column counts as
 * ink above 60/255, the review census's test): a modeled right ink edge at or
 * left of column + 0.900 never lit a column past it, and a left edge at or
 * right of column - 0.450 never lit one before it (the generated insets are
 * already reduced where a glyph drew closer). The fits keep 0.05 of that.
 */
export const INK_RIGHT_SLACK = 0.85;
export const INK_LEFT_SLACK = 0.4;
/** Two lines whose modeled ink edges sit this far apart leave at least the
 * census's two blank columns between their drawn ink. */
export const INK_CLEAR_GAP = 4 - INK_LEFT_SLACK - INK_RIGHT_SLACK;

export type TextAnchor = "start" | "middle" | "end";

/** Where a line drawn at x with this text-anchor puts its ink. */
export function inkEdges(runs: readonly TextRun[], anchor: TextAnchor, x: number): { left: number; right: number } {
	const span = inkSpan(runs);
	const start = anchor === "start" ? x : anchor === "middle" ? x - span.advance / 2 : x - span.advance;
	return { left: start + span.left, right: start + span.right };
}

/** True when the line inks no pixel column outside first..last. */
export function inksWithin(runs: readonly TextRun[], anchor: TextAnchor, x: number, first: number, last: number): boolean {
	const edges = inkEdges(runs, anchor, x);
	return edges.left >= first - INK_LEFT_SLACK && edges.right <= last + INK_RIGHT_SLACK;
}

/** The widest prefix plus an ellipsis that `fits` accepts, else the lone
 * ellipsis. A longer prefix never inks less, so a binary search finds it
 * without the quadratic walk a pasted 40k-character label would cost. */
export function cutToFit(text: string, fits: (line: string) => boolean): string {
	const chars = Array.from(text);
	const cut = (i: number): string => `${chars.slice(0, i).join("").trimEnd()}…`;
	let lo = 0;
	let hi = chars.length - 1;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (fits(cut(mid))) lo = mid;
		else hi = mid - 1;
	}
	return lo === 0 ? "…" : cut(lo);
}

/** fitTextLadder by what the line inks instead of a width budget: the
 * largest size `fits` accepts, else the widest prefix plus an ellipsis it
 * accepts at the floor size. */
export function fitLadderBy(text: string, sizes: readonly number[], fits: (line: string, size: number) => boolean): FittedText {
	if (text === "") {
		return { text: "", fontSize: sizes[0] as number };
	}
	for (const size of sizes) {
		if (fits(text, size)) return { text, fontSize: size };
	}
	const floor = sizes[sizes.length - 1] as number;
	return { text: cutToFit(text, (line) => fits(line, floor)), fontSize: floor };
}

/**
 * 1.6.0's own label estimate, kept to recognize the sizes it drew: its Segoe
 * UI Semibold Latin table (the rows below U+0370 that SEGOE_UI still carries,
 * plus the ellipsis), 9.1 for any other non-wide glyph, a full em for wide
 * ones, less its 1.5 bearing credit, at weight 600. The device drew Tahoma
 * whatever 1.6.0 estimated, and the same text at the same size draws the same
 * ink in both releases, so a size this estimate picks is one 1.6.0 users saw.
 */
export function legacyLabelWidth(text: string, fontSize: number): number {
	const table = SEGOE_UI.advance12;
	let width = 0;
	let count = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0) as number;
		const mapped = code < 0x370 || ch === "…" ? table[ch] : undefined;
		width += mapped ?? (isWideGlyph(code) ? 12 : 9.1);
		count++;
	}
	return count === 0 ? 0 : ((width - 1.5) * fontSize) / 12;
}

/** The size 1.6.0's label ladder picked for this text in its 120 px band, or
 * null when it cut the text at the floor. */
export function legacyLabelSize(text: string, sizes: readonly number[]): number | null {
	for (const size of sizes) {
		if (legacyLabelWidth(text, size) <= 120) return size;
	}
	return null;
}

/**
 * Fits text to a pixel budget at the footer's metrics: kept whole when the
 * estimate fits, else trimmed from the end with an ellipsis at the widest
 * fitting prefix. Estimation-based, so the budget should leave the caller's
 * layout a few pixels of slack.
 */
export function fitFooter(text: string, maxPx: number): string {
	if (estimateFooterWidth(text) <= maxPx) {
		return text;
	}
	const chars = Array.from(text);
	let width = estimateFooterWidth("…");
	let kept = 0;
	for (const ch of chars) {
		const next = width + estimateFooterWidth(ch);
		if (next > maxPx) {
			break;
		}
		width = next;
		kept++;
	}
	return `${chars.slice(0, kept).join("").trimEnd()}…`;
}

/**
 * Greedy two-line word wrap for the dial's two-row view. Fills the first
 * line with whole words up to `line1Max` code points, puts the rest on the
 * second line (ellipsized past `line2Max`). A first word too long for line
 * one is truncated there and nothing wraps (labels are names, not prose).
 */
export function wrapLabelTwoLines(label: string, line1Max: number, line2Max: number): string[] {
	const text = label.trim();
	if (Array.from(text).length <= line1Max) {
		return [text];
	}
	const words = text.split(" ").filter((w) => w !== "");
	let line1 = "";
	let index = 0;
	while (index < words.length) {
		const candidate = line1 === "" ? (words[index] as string) : `${line1} ${words[index] as string}`;
		if (Array.from(candidate).length > line1Max) {
			break;
		}
		line1 = candidate;
		index++;
	}
	if (line1 === "") {
		// One unbreakable word: keep it to a single truncated line.
		return [truncateLabel(text, line1Max)];
	}
	const rest = words.slice(index).join(" ");
	return rest === "" ? [line1] : [line1, truncateLabel(rest, line2Max)];
}

/** The two-line wrap by what each line inks: line one takes whole words
 * while `line1Fits` holds, the rest goes to line two, cut to `line2Fits`;
 * a first word too long for line one is cut there and nothing wraps. */
export function wrapLabelTwoLinesBy(label: string, line1Fits: (line: string) => boolean, line2Fits: (line: string) => boolean): string[] {
	const text = label.trim();
	if (line1Fits(text)) return [text];
	const words = text.split(" ").filter((w) => w !== "");
	let line1 = "";
	let index = 0;
	while (index < words.length) {
		const candidate = line1 === "" ? (words[index] as string) : `${line1} ${words[index] as string}`;
		if (!line1Fits(candidate)) break;
		line1 = candidate;
		index++;
	}
	if (line1 === "") return [cutToFit(text, line1Fits)];
	const rest = words.slice(index).join(" ");
	return rest === "" ? [line1] : [line1, line2Fits(rest) ? rest : cutToFit(rest, line2Fits)];
}

/**
 * Drops the leading whole words every unlocked label shares, so rows like
 * "GPU Temperature / GPU Hot Spot / GPU Thermal Limit" read as
 * "Temperature / Hot Spot / Thermal Limit" where truncation would otherwise
 * eat exactly the distinguishing tail. The removed words come back as
 * `prefix` so the face can keep the context in one place (the footer)
 * instead of three. Locked labels (user-typed names) are neither considered
 * nor changed. The prefix is whole space-separated words only and needs two
 * or more unlocked labels to exist. A label the strip would empty (one that
 * IS the shared prefix, or a set of identical labels) keeps its original
 * text instead of disabling the strip for everyone; `prefix` is empty when
 * no label actually changed.
 */
export function dedupeSharedLabelPrefix(labels: readonly string[], locked: readonly boolean[]): { labels: string[]; prefix: string } {
	const open = labels.filter((_, i) => locked[i] !== true);
	if (open.length < 2) {
		return { labels: [...labels], prefix: "" };
	}
	const split = open.map((label) => label.split(" "));
	const first = split[0] as string[];
	let shared = 0;
	while (shared < first.length && split.every((words) => words.length === shared || words[shared] === first[shared])) {
		shared++;
	}
	if (shared === 0) {
		return { labels: [...labels], prefix: "" };
	}
	let stripped = false;
	const result = labels.map((label, i) => {
		if (locked[i] === true) {
			return label;
		}
		const rest = label.split(" ").slice(shared).join(" ");
		if (rest === "") {
			return label;
		}
		stripped = true;
		return rest;
	});
	return { labels: result, prefix: stripped ? first.slice(0, shared).join(" ") : "" };
}
