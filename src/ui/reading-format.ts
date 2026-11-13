/**
 * Per-reading display formats (issue #59): one optional settings field on
 * Sensor Reading keys and Sensor Dials,
 *
 *     readingFormats?: { [savedReadingKey]: { unit?: string; decimals?: string } }
 *
 * filed under the stable key the panel shows on that reading's row. A
 * reading with an entry shows in that unit at every value (never moving to
 * another one) and with those decimals; every other reading follows the
 * action's Decimals and the deck's Data units exactly as before.
 *
 * The rules, all here so every face and the panel preview resolve alike:
 * - Settings are untyped JSON. Only a plain object counts; lookups go key by
 *   key through Object.hasOwn over the reading's own keys (its key, then its
 *   confirmed linkedKeys, the walk readingColors and alertRules take), so
 *   "__proto__" or "constructor" is an entry like any other and the map is
 *   never iterated, whatever its size. The first own object entry in that
 *   walk decides; inside it each field is checked on its own and a field
 *   that fails inherits the action's value.
 * - `unit` is one of a closed list of exact strings and applies only while
 *   the reading's own unit takes it (fixedUnitsFor): HWiNFO's KB/MB/GB/TB
 *   take B, KB, MB, GB and TB (HWiNFO's number rescaled by 1000 per step)
 *   and KiB, MiB, GiB and TiB (true 1024-based values: HWiNFO counts its
 *   own MB as MiB, measure.ts binaryBytesBase); an IEC-labelled byte unit
 *   (KiB, MiB...) takes B, KiB, MiB, GiB and TiB. Anything else, rates
 *   included, keeps Auto while the entry's decimals still apply.
 * - `decimals` is exactly "auto" or "0" to "3"; anything else inherits.
 * - Nothing here writes settings. The panel is the only writer.
 *
 * Display only: alerts, gauges, history and statistics never read this
 * field (test/reading-format.test.ts holds src/alerts to that).
 */
import type { Reading } from "../hwinfo/types";
import type { DecimalsSetting } from "./format";
import { parseDataUnit, type FixedDataUnit, type MeasureOptions } from "./measure";

export type { FixedDataUnit } from "./measure";

/** One reading's own format, as resolved from its entry. */
export type ReadingFormat = { readonly unit?: FixedDataUnit; readonly decimals?: DecimalsSetting };

/** Gadget keys reach about 1026 characters (CJK source and label); longer
 * keys are never looked up. */
export const READING_FORMAT_KEY_MAX = 2048;

const DECIMAL_FAMILY: readonly FixedDataUnit[] = ["B", "KB", "MB", "GB", "TB"];
const IEC_FAMILY: readonly FixedDataUnit[] = ["B", "KiB", "MiB", "GiB", "TiB"];
/** HWiNFO's own byte amounts: both families, the 1000 steps first. */
const BOTH_FAMILIES: readonly FixedDataUnit[] = [...DECIMAL_FAMILY, "KiB", "MiB", "GiB", "TiB"];
const NO_UNITS: readonly FixedDataUnit[] = [];

/**
 * The fixed units a reading may take, from its own unit: both families for
 * HWiNFO's KB/MB/GB/TB (and a bare B), B to TB rescaling HWiNFO's number
 * by 1000 per step and KiB to TiB reading it as 1024-based; the IEC family
 * for a unit that is itself IEC-labelled; none for rates, bits and every
 * other unit. The plugin sends this list to the panel, so the panel never
 * matches units.
 */
export function fixedUnitsFor(readingUnit: string): readonly FixedDataUnit[] {
	const data = parseDataUnit(readingUnit);
	if (data === null || data.kind !== "bytes") {
		return NO_UNITS;
	}
	return /i/.test(readingUnit) ? IEC_FAMILY : BOTH_FAMILIES;
}

const UNITS: ReadonlySet<string> = new Set<string>(BOTH_FAMILIES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One stored entry, salvaged field by field; null when it is not an object. */
function parseEntry(raw: unknown): ReadingFormat | null {
	if (!isPlainObject(raw)) {
		return null;
	}
	const unit = Object.hasOwn(raw, "unit") ? raw.unit : undefined;
	const decimals = Object.hasOwn(raw, "decimals") ? raw.decimals : undefined;
	return {
		...(typeof unit === "string" && UNITS.has(unit) ? { unit: unit as FixedDataUnit } : {}),
		...(decimals === "auto" || decimals === "0" || decimals === "1" || decimals === "2" || decimals === "3" ? { decimals } : {})
	};
}

/** Parsed entries per stored map, filled lazily per key looked up. Keyed
 * by the nested readingFormats object itself: a settings receipt brings a
 * new object (a new memo); a spread of the same settings, a detail
 * presentation copy and the Back fallback carry the same one (a hit). The
 * memo can never carry one action's format to another: it is a pure
 * function of the object it is keyed by. */
const memo = new WeakMap<object, Map<string, ReadingFormat | null>>();
/** Bounds one map's memo; past it entries are parsed on every lookup. */
const MEMO_KEYS_MAX = 512;

function entryOf(formats: Record<string, unknown>, key: string): ReadingFormat | null {
	let parsed = memo.get(formats);
	if (parsed === undefined) {
		parsed = new Map();
		memo.set(formats, parsed);
	}
	const hit = parsed.get(key);
	if (hit !== undefined) {
		return hit;
	}
	const entry = parseEntry(Object.hasOwn(formats, key) ? formats[key] : undefined);
	if (parsed.size < MEMO_KEYS_MAX) {
		parsed.set(key, entry);
	}
	return entry;
}

/** The reading's own entry and the key it is filed under, or null: its key
 * first, then its confirmed aliases; the first own object entry decides. */
export function readingFormatEntryOf(raw: unknown, reading: Pick<Reading, "key" | "linkedKeys">): { key: string; format: ReadingFormat } | null {
	if (!isPlainObject(raw)) {
		return null;
	}
	for (const key of [reading.key, ...(reading.linkedKeys ?? [])]) {
		if (typeof key !== "string" || key === "" || key.length > READING_FORMAT_KEY_MAX) {
			continue;
		}
		const format = entryOf(raw, key);
		if (format !== null) {
			return { key, format };
		}
	}
	return null;
}

/** The reading's own format, or undefined when no entry applies. */
export function readingFormatOf(raw: unknown, reading: Pick<Reading, "key" | "linkedKeys">): ReadingFormat | undefined {
	return readingFormatEntryOf(raw, reading)?.format;
}

/**
 * One reading's measurement options: `base` itself (the same object, so a
 * face with no format for this reading takes exactly the path it took
 * before) when no entry applies, else base with the entry's decimals, its
 * unit while the reading's own unit takes it, and `exact` set, which tells
 * the renderers to keep the text as formatted where it fits, never cut:
 * past that, the same unit with no decimals, then compact
 * (measure.ts exactFallback).
 */
export function measureFor(base: MeasureOptions, raw: unknown, reading: Pick<Reading, "key" | "linkedKeys" | "unit">): MeasureOptions {
	const format = readingFormatOf(raw, reading);
	if (format === undefined) {
		return base;
	}
	const unit = format.unit !== undefined && fixedUnitsFor(reading.unit).includes(format.unit) ? format.unit : undefined;
	if (unit === undefined && format.decimals === undefined) {
		return base;
	}
	return { ...base, decimals: format.decimals ?? base.decimals, ...(unit === undefined ? {} : { fixedUnit: unit }), exact: true };
}

/**
 * The entries a detail session takes from its opener: only those filed
 * under the given keys (the opener's slot keys and the key walks of the
 * readings in them, see formatsPresentation), copied as stored.
 * Entries for readings that left every slot stay inert on the detail page,
 * as they are on the key. Undefined when there is nothing to carry.
 */
export function formatsForKeys(raw: unknown, keys: readonly (string | undefined)[]): Record<string, unknown> | undefined {
	if (!isPlainObject(raw)) {
		return undefined;
	}
	const out: Record<string, unknown> = {};
	let any = false;
	for (const key of keys) {
		if (key === undefined || key.length > READING_FORMAT_KEY_MAX || !Object.hasOwn(raw, key)) {
			continue;
		}
		// defineProperty: a "__proto__" key stays an own data entry.
		Object.defineProperty(out, key, { value: raw[key], enumerable: true, writable: true, configurable: true });
		any = true;
	}
	return any ? out : undefined;
}
