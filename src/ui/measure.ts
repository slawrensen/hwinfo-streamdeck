/**
 * The one measurement-formatting authority: native HWiNFO value/unit in,
 * display text out. Every face (key layouts, dial views, footers) and the
 * property-inspector preview/tree format through here, so the runtime and the
 * PI can never disagree about what "12000000 B/s" reads as.
 *
 * Data units (bytes and transfer rates) are re-tiered under the deck-wide
 * preference: Decimal shows byte quantities in B/KB/MB/GB/TB (base 1000) and
 * rates as bits (bps/kbps/Mbps/Gbps/Tbps, byte rates × 8); Binary shows
 * quantities in B/KiB/MiB/GiB/TiB (base 1024) and rates as bytes
 * (B/s…TiB/s, bit rates ÷ 8). The incoming value is normalized to a
 * canonical base before the display tier is chosen, so an already-prefixed
 * source ("12500 MB") is never double-scaled. Everything else keeps the
 * generic formatValue behavior unchanged.
 *
 * Scaling here is presentation only: thresholds, bar ranges and alert math
 * stay in the native/display-temperature domain of the raw reading.
 */
import { bandPrecision, convertUnit, fixed, formatCompactValue, formatQuadValue, formatValue, type DecimalsSetting } from "./format";

/** Deck-wide data-unit preference; absent/junk resolves to "decimal".
 * Decimal re-tiers by 1000 per step on the number as labelled: a re-tier
 * shows HWiNFO's figure in thousands rather than reinterpreting it. HWiNFO's
 * own KB/MB/GB/TB count in steps of 1024 (its author says so, disk sizes
 * aside, and GPU memory checks out that way against nvidia-smi: 16,303 MB
 * in HWiNFO is 16,303 MiB), so Binary reads those byte amounts as
 * 1024-based (binaryBytesBase) and prints the true KiB to TiB. Transfer
 * rates keep the label as written under both: their basis is not verified. */
export type DataUnitsPref = "decimal" | "binary";

export function parseDataUnitsPref(raw: unknown): DataUnitsPref {
	return raw === "binary" ? "binary" : "decimal";
}

type DataKind = "bytes" | "byteRate" | "bitRate";

/** A recognized data unit: what it measures, and the factor to the canonical
 * base (bytes, bytes/s, or bits/s). */
export type DataUnit = { kind: DataKind; toBase: number };

const PREFIX_SCALE: Readonly<Record<string, number>> = {
	"": 1,
	K: 1e3,
	k: 1e3,
	M: 1e6,
	G: 1e9,
	T: 1e12,
	Ki: 1024,
	ki: 1024,
	Mi: 1024 ** 2,
	Gi: 1024 ** 3,
	Ti: 1024 ** 4
};

/** Case is semantic: "B" is bytes, "b"/"bit" is bits; "Ki/Mi/Gi/Ti" are the
 * 1024-based prefixes. Covers HWiNFO's forms: KB, MB/s, KiB/s, Mbps, kbit/s. */
const DATA_UNIT = /^([KkMGT]i?)?(B|b|bits?)(\/s|ps)?$/;

/**
 * Parses a data unit into its kind and canonical-base factor. Plain bit
 * quantities ("Mb" with no rate marker) are ambiguous relabeling targets and
 * ordinary units (W, RPM, MHz, °C, %) don't match at all — both return null
 * and keep their current formatting.
 */
export function parseDataUnit(unit: string): DataUnit | null {
	const match = DATA_UNIT.exec(unit.trim());
	if (match === null) {
		return null;
	}
	const scale = PREFIX_SCALE[match[1] ?? ""];
	if (scale === undefined) {
		return null;
	}
	const bytes = match[2] === "B";
	const rate = match[3] !== undefined;
	if (bytes) {
		return { kind: rate ? "byteRate" : "bytes", toBase: scale };
	}
	return rate ? { kind: "bitRate", toBase: scale } : null;
}

/** 1024 to the power of a prefix's step, IEC or not. */
const BINARY_STEP: Readonly<Record<string, number>> = { "": 1, K: 1024, k: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, Ki: 1024, ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 };

/**
 * The bytes one unit of a byte amount labelled `unit` stands for when it is
 * read as 1024-based: HWiNFO's KB, MB, GB and TB count in steps of 1024, so
 * printed in a 1024-based unit (Binary, or a fixed KiB to TiB) they are
 * KiB, MiB, GiB and TiB; an IEC label and a bare B are exact as written.
 * The label's own factor (parseDataUnit) for anything that is not a byte
 * amount, which keeps transfer rates as they were.
 */
export function binaryBytesBase(unit: string, data: DataUnit): number {
	if (data.kind !== "bytes") return data.toBase;
	const match = DATA_UNIT.exec(unit.trim());
	return BINARY_STEP[match?.[1] ?? ""] ?? data.toBase;
}

/** The bytes (or bytes or bits per second) one unit of a data reading
 * stands for under the deck preference: Binary reads byte amounts as
 * 1024-based (binaryBytesBase); everything else as labelled. */
export function dataBaseOf(unit: string, data: DataUnit, pref: DataUnitsPref): number {
	return pref === "binary" ? binaryBytesBase(unit, data) : data.toBase;
}

const DECIMAL_BYTES = ["B", "KB", "MB", "GB", "TB"] as const;
const BINARY_BYTES = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
const DECIMAL_BIT_RATES = ["bps", "kbps", "Mbps", "Gbps", "Tbps"] as const;
const BINARY_BYTE_RATES = ["B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s"] as const;

/** The canonical value and display ladder one kind+preference resolves to. */
function dataDisplay(baseValue: number, kind: DataKind, pref: DataUnitsPref): { canonical: number; ladder: readonly string[]; base: number } {
	if (kind === "bytes") {
		return pref === "binary" ? { canonical: baseValue, ladder: BINARY_BYTES, base: 1024 } : { canonical: baseValue, ladder: DECIMAL_BYTES, base: 1000 };
	}
	if (pref === "binary") {
		return { canonical: kind === "bitRate" ? baseValue / 8 : baseValue, ladder: BINARY_BYTE_RATES, base: 1024 };
	}
	return { canonical: kind === "byteRate" ? baseValue * 8 : baseValue, ladder: DECIMAL_BIT_RATES, base: 1000 };
}

/** One scaled number in the established rhythm: band precision for "auto"
 * (settled on the band the ROUNDED value lands in), fixed otherwise. */
function formatScaled(scaled: number, decimals: DecimalsSetting): string {
	if (decimals !== "auto") {
		return fixed(scaled, Number(decimals));
	}
	const text = fixed(scaled, bandPrecision(Math.abs(scaled)));
	return fixed(scaled, bandPrecision(Math.abs(Number(text))));
}

function measureData(canonical: number, ladder: readonly string[], base: number, decimals: DecimalsSetting, quad: boolean): Measurement {
	const { valueText, tier } = dataTier(canonical, ladder, base, decimals, quad);
	return { valueText, unitText: ladder[tier] as string };
}

/** The tier a data value prints in and its text there. */
function dataTier(canonical: number, ladder: readonly string[], base: number, decimals: DecimalsSetting, quad: boolean): { valueText: string; tier: number } {
	const abs = Math.abs(canonical);
	let tier = 0;
	while (tier < ladder.length - 1 && abs >= base ** (tier + 1)) {
		tier++;
	}
	for (;;) {
		const scaled = canonical / base ** tier;
		const valueText = quad ? formatQuadValue(scaled, decimals) : formatScaled(scaled, decimals);
		// Rounding can hit the next tier ("1024 KiB"), and a quad cell squeezes
		// a 5-glyph value ("-1010") into its own magnitude suffix ("-1k", NaN
		// here): both promote a tier instead, so a value suffix never stacks on
		// a unit prefix. Past the top tier the value keeps its own suffix.
		const rounded = Math.abs(Number(valueText));
		if (tier < ladder.length - 1 && !(rounded < base)) {
			tier++;
			continue;
		}
		return { valueText, tier };
	}
}

export type Measurement = { valueText: string; unitText: string };

/** Zero bytes in Auto: "0 B", as the strip's scale prints zero, not the
 * band precision's "0.00 B". Fixed decimals keep their places, and rates
 * keep their text. Null for anything else. */
function zeroBytes(canonical: number, data: DataUnit, ladder: readonly string[], decimals: DecimalsSetting): Measurement | null {
	return canonical === 0 && data.kind === "bytes" && decimals === "auto" ? { valueText: "0", unitText: ladder[0] as string } : null;
}

/** The unit both sources give HWiNFO's boolean readings. */
const BOOLEAN_UNIT = "Yes/No";

/**
 * A boolean reading as the word HWiNFO's own windows show. Both sources
 * publish these as 0 or 1 in the unit "Yes/No", so the face read "0.00
 * Yes/No", which says nothing to the person looking at the key. The number
 * itself is untouched: thresholds, gauges and evidence still see 0 and 1.
 * Only exactly 0 and 1 are words; anything else stays a number, because a
 * reading that is not one of the two is not a boolean this can name.
 */
function booleanMeasurement(value: number, unit: string): Measurement | null {
	if (unit !== BOOLEAN_UNIT || (value !== 0 && value !== 1)) {
		return null;
	}
	return { valueText: value === 1 ? "Yes" : "No", unitText: "" };
}

/** The fixed units a per-reading format may name (reading-format.ts decides
 * which a reading may take). */
export const FIXED_DATA_UNITS = ["B", "KB", "MB", "GB", "TB", "KiB", "MiB", "GiB", "TiB"] as const;
export type FixedDataUnit = (typeof FIXED_DATA_UNITS)[number];

/** The bytes each fixed unit stands for, by exact string (a closed table,
 * so no stored text is ever parsed into a factor). */
function fixedUnitFactor(unit: FixedDataUnit): number {
	switch (unit) {
		case "B":
			return 1;
		case "KB":
			return 1e3;
		case "MB":
			return 1e6;
		case "GB":
			return 1e9;
		case "TB":
			return 1e12;
		case "KiB":
			return 1024;
		case "MiB":
			return 1024 ** 2;
		case "GiB":
			return 1024 ** 3;
		default:
			return 1024 ** 4;
	}
}

export type MeasureOptions = {
	decimals: DecimalsSetting;
	fahrenheit: boolean;
	dataUnits: DataUnitsPref;
	/** A reading's own fixed byte unit (resolved by measureFor, set only for
	 * a byte reading whose unit takes it): the value shows in exactly this
	 * unit at every size. Absent keeps the tier the deck preference picks. */
	fixedUnit?: FixedDataUnit;
	/** Set when the reading has its own format (measureFor): the quad text is
	 * the full text, and renderers keep it exact where it fits, else draw
	 * exactFallback's text. */
	exact?: boolean;
};

/** No fixed-unit value at or past this many units prints: toFixed switches
 * to exponent notation ("1e+21") there. */
const FIXED_LIMIT = 1e21;

/** The 1024-based fixed units. */
function isBinaryUnit(unit: FixedDataUnit): boolean {
	return unit === "KiB" || unit === "MiB" || unit === "GiB" || unit === "TiB";
}

/** The bytes one unit of the source label counts as in a fixed unit: a
 * 1024-based target reads HWiNFO's KB to TB as 1024-based, as Binary does
 * (binaryBytesBase); B and KB to TB rescale HWiNFO's number by 1000 per
 * step, the label as written, as Decimal does. */
function fixedSourceBase(data: DataUnit, sourceUnit: string, target: FixedDataUnit): number {
	return isBinaryUnit(target) ? binaryBytesBase(sourceUnit, data) : data.toBase;
}

/** How many `target` units one unit of a byte reading labelled `unit` is
 * (the strip's scale prints a fixed unit with it), or null when the unit
 * is not a byte amount. */
export function fixedUnitScale(unit: string, target: FixedDataUnit): number | null {
	const data = parseDataUnit(unit);
	if (data === null || data.kind !== "bytes") return null;
	return fixedSourceBase(data, unit, target) / fixedUnitFactor(target);
}

/**
 * A byte reading in its fixed unit: HWiNFO's number times the source
 * label's factor (fixedSourceBase), divided by the target's, in that order
 * (the arithmetic the Auto tiers use, so a fixed unit equal to Auto's tier
 * gives Auto's text, in Decimal and in Binary), then the action's or the
 * reading's decimals. Never promoted to another unit, never compacted with
 * k/M/G, never parsed back from text. Zero keeps the unit ("0" with Auto
 * decimals, as Auto prints it); a rounded zero drops its sign (fixed); a
 * value whose text would need an exponent shows
 * the placeholder with the source unit, like any other value that
 * overflows (AX44). Null when the fixed unit does not apply (no fixed unit,
 * or not a finite byte quantity).
 */
function fixedMeasurement(value: number, data: DataUnit | null, sourceUnit: string, opts: MeasureOptions): Measurement | null {
	if (opts.fixedUnit === undefined || data === null || data.kind !== "bytes" || !Number.isFinite(value)) {
		return null;
	}
	const scaled = (value * fixedSourceBase(data, sourceUnit, opts.fixedUnit)) / fixedUnitFactor(opts.fixedUnit);
	if (!Number.isFinite(scaled) || Math.abs(scaled) >= FIXED_LIMIT) {
		return { valueText: formatValue(Number.NaN, opts.decimals), unitText: sourceUnit };
	}
	// Zero with Auto decimals is "0", as in Auto (zeroBytes).
	return { valueText: scaled === 0 && opts.decimals === "auto" ? "0" : formatScaled(scaled, opts.decimals), unitText: opts.fixedUnit };
}

/**
 * Formats one reading for display: °C→°F conversion, then either data-unit
 * re-tiering (under the deck preference) or the generic magnitude ladder.
 * Non-finite values keep the placeholder glyph and the source unit.
 */
export function formatMeasurement(value: number, unit: string, opts: MeasureOptions): Measurement {
	const word = booleanMeasurement(value, unit);
	if (word !== null) {
		return word;
	}
	const converted = convertUnit(value, unit, opts.fahrenheit);
	const data = parseDataUnit(converted.unit);
	const pinned = fixedMeasurement(converted.value, data, converted.unit, opts);
	if (pinned !== null) {
		return pinned;
	}
	if (data === null || !Number.isFinite(converted.value)) {
		return { valueText: formatValue(converted.value, opts.decimals), unitText: converted.unit };
	}
	const { canonical, ladder, base } = dataDisplay(converted.value * dataBaseOf(converted.unit, data, opts.dataUnits), data.kind, opts.dataUnits);
	// A finite reading can still overflow once normalized (AX44): it gets the
	// same placeholder and source unit as any other non-finite value.
	if (!Number.isFinite(canonical)) {
		return { valueText: formatValue(canonical, opts.decimals), unitText: converted.unit };
	}
	return zeroBytes(canonical, data, ladder, opts.decimals) ?? measureData(canonical, ladder, base, opts.decimals, false);
}

/**
 * The number a reading with its own format prints, before it becomes text,
 * and its unit: the value in its fixed unit, or in the tier Auto picks for
 * it with no decimals, or as converted. Null for a word, a value that is
 * not finite, and one past what a fixed unit prints: those draw their own
 * short text.
 */
function shownNumber(value: number, unit: string, opts: MeasureOptions): { n: number; unitText: string } | null {
	if (booleanMeasurement(value, unit) !== null) {
		return null;
	}
	const converted = convertUnit(value, unit, opts.fahrenheit);
	if (!Number.isFinite(converted.value)) {
		return null;
	}
	const data = parseDataUnit(converted.unit);
	if (opts.fixedUnit !== undefined && data !== null && data.kind === "bytes") {
		const scaled = (converted.value * fixedSourceBase(data, converted.unit, opts.fixedUnit)) / fixedUnitFactor(opts.fixedUnit);
		return Number.isFinite(scaled) && Math.abs(scaled) < FIXED_LIMIT ? { n: scaled, unitText: opts.fixedUnit } : null;
	}
	if (data === null) {
		return { n: converted.value, unitText: converted.unit };
	}
	const { canonical, ladder, base } = dataDisplay(converted.value * dataBaseOf(converted.unit, data, opts.dataUnits), data.kind, opts.dataUnits);
	if (!Number.isFinite(canonical)) {
		return null;
	}
	const { tier } = dataTier(canonical, ladder, base, "0", false);
	return { n: canonical / base ** tier, unitText: ladder[tier] as string };
}

/**
 * What a face draws for a reading with its own format when its exact text
 * (formatMeasurement) has no room (issue #59), in order: the same value in
 * the same unit with no decimals, then that value compacted by the face's
 * own rule (formatCompactValue: a four-reading key's four glyphs, "123k",
 * from the reading's decimals; any other face the Auto rule, "22.0T"), its
 * unit kept. A face never draws a lone "…" or a cut number for a finite
 * value. Empty without an own format, and for a word or the placeholder.
 */
export function exactFallback(value: number, unit: string, opts: MeasureOptions, quad: boolean): Measurement[] {
	if (opts.exact !== true) {
		return [];
	}
	const shown = shownNumber(value, unit, opts);
	if (shown === null) {
		return [];
	}
	return [formatMeasurement(value, unit, { ...opts, decimals: "0" }), { valueText: formatCompactValue(shown.n, opts.decimals, quad), unitText: shown.unitText }];
}

/** A stat's text (formatStat) for each of exactFallback's steps, for the
 * dial footers: the stat itself first, then with no decimals, then
 * compact; only the stat itself without an own format. */
export function exactStatTexts(value: number, unit: string, opts: MeasureOptions): [string, ...string[]] {
	const data = isDataUnit(unit);
	return [formatStat(value, unit, opts), ...exactFallback(value, unit, opts, false).map((m) => (data ? `${m.valueText}${m.unitText}` : m.valueText))];
}

/** The quad-cell variant: same tiering, value aimed at the quad glyph
 * budget. A value that only fits with its own magnitude suffix (a negative
 * near a binary tier edge, "-1010") promotes a tier instead. A reading with
 * its own format keeps its full text (formatMeasurement): the quad renderer
 * fits it by size, and drops its decimals only when no size it allows
 * holds it (exactFallback). */
export function formatQuadMeasurement(value: number, unit: string, opts: MeasureOptions): Measurement {
	if (opts.exact === true) {
		return formatMeasurement(value, unit, opts);
	}
	const word = booleanMeasurement(value, unit);
	if (word !== null) {
		return word;
	}
	const converted = convertUnit(value, unit, opts.fahrenheit);
	const data = parseDataUnit(converted.unit);
	if (data === null || !Number.isFinite(converted.value)) {
		return { valueText: formatQuadValue(converted.value, opts.decimals), unitText: converted.unit };
	}
	const { canonical, ladder, base } = dataDisplay(converted.value * dataBaseOf(converted.unit, data, opts.dataUnits), data.kind, opts.dataUnits);
	if (!Number.isFinite(canonical)) {
		return { valueText: formatQuadValue(canonical, opts.decimals), unitText: converted.unit };
	}
	return zeroBytes(canonical, data, ladder, opts.decimals) ?? measureData(canonical, ladder, base, opts.decimals, true);
}

/** Whether a reading's unit re-tiers under the data-unit preference (the
 * footers switch to their tight layout for the longer unit-suffixed stats). */
export function isDataUnit(unit: string): boolean {
	return parseDataUnit(unit) !== null;
}

/**
 * One stat (session/HWiNFO min, max, avg) for a footer or stats line. Plain
 * readings keep the bare number exactly as before (the face's unit applies
 * 1:1); data units carry their own tier suffix ("8.19GB") because each stat
 * picks its own tier and a bare number would read in the wrong unit.
 */
export function formatStat(value: number, unit: string, opts: MeasureOptions): string {
	const word = booleanMeasurement(value, unit);
	if (word !== null) {
		return word.valueText;
	}
	if (!isDataUnit(unit)) {
		return formatValue(convertUnit(value, unit, opts.fahrenheit).value, opts.decimals);
	}
	const m = formatMeasurement(value, unit, opts);
	return `${m.valueText}${m.unitText}`;
}
