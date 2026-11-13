/**
 * Strip Display settings: the appended Sensor Dial fields `stripGroup` and
 * `stripGroupPasted`, and their salvage parsers.
 *
 * Each member dial carries a FULL copy of its group's configuration:
 *
 *   stripGroup: { v: 1, id, rev, joined, config }
 *
 * - id: 32 lowercase hex characters minted by the plugin at create. Any
 *   other id makes the whole copy undefined, so the dial is independent.
 * - rev: the plugin-authoritative revision, a safe integer >= 1. Anything
 *   else reads as 0, the lowest priority, never authority over a valid copy.
 * - joined: exactly true means the dial takes part in the group. Anything
 *   else is a dormant copy, kept for Restore, and the dial draws its own
 *   individual face from its untouched individual fields.
 * - config: salvaged field by field to safe defaults (stripConfigOf).
 *
 * stripGroupPasted holds a copy that arrived from outside the plugin (a
 * pasted configuration document) and differs from the dial's own, until
 * the person chooses in the dial's panel. The plugin moves such a copy
 * there in reply to the write that brought it, so it stays a question
 * after a restart; nothing ever reads it as membership.
 *
 * Parsing never throws and never writes: a malformed value draws the safe
 * default and stays on disk as it is until a deliberate edit replaces the
 * copy. The background and accent flag are read only through the dial's
 * own exact readers (ownBackgroundOf, ownAccentWordsOf), so the strip and
 * an independent dial can never disagree about a stored value. Absent is
 * Default: the strip draws the shared dial Background and Words
 * (shared-looks.ts, resolved per frame in frame.ts), so a shared change
 * repaints it with no write. A new group stores neither; the strip keeps
 * an own look only once one is picked for it under More.
 */
import { randomUUID } from "node:crypto";

import type { HistoryWindowId } from "../history/types";
import { parseHistoryWindow } from "../history/window";
import { artStarsOf, artToneOf, type ArtStars, type ArtTone } from "../ui/deck-art";
import { ownAccentWordsOf, ownBackgroundOf, type DialBackground } from "../ui/dial-background";
import { looksGenOf } from "../ui/shared-looks";
import { detailFilterOf } from "../detail/detail-settings";
import { parseThreshold, type DecimalsSetting } from "../ui/format";
import { FIXED_DATA_UNITS, type FixedDataUnit } from "../ui/measure";
import { stampCounts, stampRecordOf } from "../alerts/rules";
import { HEX6 } from "../ui/text-colors";
import { isStripEncoders, type StripEncoders, type StripLayout } from "./geometry";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const STRIP_GROUP_VERSION = 1;
export const STRIP_ID_PATTERN = /^[0-9a-f]{32}$/;

export const STRIP_STYLES = ["trend", "area", "compare", "lanes", "heat", "group", "ambient", "meters", "events"] as const;
export type StripStyle = (typeof STRIP_STYLES)[number];

/** Series bounds per style. Fewer than `min` draws the pane's "add a
 * reading" state; more than `max` stay in the stored list and are not
 * drawn: the cut is the renderer's (frame.ts, scene.ts), never the
 * parser's, so a style switch or any later edit keeps every reading. */
export const SERIES_LIMITS: Readonly<Record<StripStyle, { readonly min: number; readonly max: number }>> = {
	trend: { min: 1, max: 3 },
	area: { min: 1, max: 3 },
	compare: { min: 2, max: 4 },
	lanes: { min: 2, max: 3 },
	heat: { min: 1, max: 1 },
	// Group draws a rule's readings (StripGroupRule), not the series list:
	// its first series is only the folder a Folder rule reads from.
	group: { min: 0, max: 1 },
	// Ambient draws a rule's readings too (src/strip/ambient.ts).
	ambient: { min: 0, max: 1 },
	// Meters: one reading per dial slot; a pane draws as many as it has
	// slots (src/strip/meters.ts).
	meters: { min: 1, max: 6 },
	// Events: a row per Yes/No reading or reading with limits
	// (src/strip/events.ts).
	events: { min: 1, max: 4 }
};

/** The styles that draw a rule's readings (StripGroupRule) rather than the
 * ticked series list. */
export function isRuleStyle(style: StripStyle): boolean {
	return style === "group" || style === "ambient";
}

/**
 * Large current values per pane (absent: off, today's pane byte for byte).
 *   left  the pane's leftmost dial slot shows each reading's value large,
 *         and the graph takes the rest of the pane over the same window;
 *   only  values only, for reading from across a room: the readings spread
 *         across the pane, each number in a dial slot, no graph, and the
 *         stored style means nothing (isValuesOnly).
 * Exact strings only; "off" and anything else read as off.
 */
export const STRIP_READOUTS = ["left", "only"] as const;
export type StripReadout = (typeof STRIP_READOUTS)[number];

export function stripReadoutOf(raw: unknown): StripReadout | undefined {
	return raw === "left" || raw === "only" ? raw : undefined;
}

/**
 * How a Meters pane draws each reading (absent: Thin bar, its number over
 * an 8 px bar, src/strip/meters.ts byte for byte).
 *   full    a bar as tall as the strip, filling from its left end to the
 *           reading, beside a column with the name and the number;
 *   liquid  the same frame as a tank filling from its bottom to a
 *           straight surface at the level.
 * src/strip/fill.ts draws both. Exact strings only; anything else reads as
 * Thin bar, and a value a newer version stored stays in the stored pane (it
 * is not a known key, so extrasOf keeps it). Kept whatever the style; only
 * Meters reads it.
 */
export const STRIP_METER_LOOKS = ["full", "liquid"] as const;
export type StripMeterLook = (typeof STRIP_METER_LOOKS)[number];

export function stripMeterLookOf(raw: unknown): StripMeterLook | undefined {
	return raw === "full" || raw === "liquid" ? raw : undefined;
}

/**
 * What a graph draws across a reading missed for a moment (the store's brief
 * boundaries, HistoryViewSegment.brief). Absent is Connect, one straight
 * line in the series' own color; "mark" draws that stretch of it in a neutral
 * theme ink; "gaps" leaves it open. Exact strings only; "connect" and
 * anything else read as Connect, and a value a newer version stored stays
 * in the stored config (it is not a known key, so extrasOf keeps it). It is
 * the strip's, not a pane's: a missed read closes every reading at once.
 */
export const STRIP_GAP_MODES = ["mark", "gaps"] as const;
export type StripGapMode = (typeof STRIP_GAP_MODES)[number];

export function stripGapModeOf(raw: unknown): StripGapMode | undefined {
	return raw === "mark" || raw === "gaps" ? raw : undefined;
}

/** The most readings one pane stores, whatever its style: the largest
 * style limit (Meters' six, one per dial of a + XL). Edits refuse more;
 * parsing keeps the first this many valid, distinct entries. */
export const MAX_SERIES = 6;

/** Whether a pane draws Large values only: no graph, so its stored Graph
 * means nothing (Meters, Events, Group and Ambient draw themselves and keep
 * a stored readout unused). */
export function isValuesOnly(pane: { readonly style: StripStyle; readonly readout?: StripReadout }): boolean {
	return pane.readout === "only" && pane.style !== "meters" && pane.style !== "events" && !isRuleStyle(pane.style);
}

/** How many readings a pane draws: its style's limits, or on Large values
 * only every reading it stores. */
export function seriesLimitsOf(pane: { readonly style: StripStyle; readonly readout?: StripReadout }): { readonly min: number; readonly max: number } {
	return isValuesOnly(pane) ? { min: 1, max: MAX_SERIES } : SERIES_LIMITS[pane.style];
}

/** The readings a pane draws: the first seriesLimitsOf(pane).max of its
 * stored list. */
export function drawnSeries<T>(pane: { readonly style: StripStyle; readonly readout?: StripReadout; readonly series: readonly T[] }): readonly T[] {
	return pane.series.slice(0, seriesLimitsOf(pane).max);
}

export const HISTORY_WINDOWS: readonly HistoryWindowId[] = ["1m", "5m", "15m"];
/** The window a new group starts with and a malformed one reads as. */
export const DEFAULT_WINDOW: HistoryWindowId = "5m";
export const MAX_BANDS = 4;
export const MAX_KEY_LENGTH = 256;
export const MAX_NAME_LENGTH = 64;
export const MAX_LINK_ID_LENGTH = 64;
export const MAX_THEME_LENGTH = 64;
export const DECIMALS: readonly DecimalsSetting[] = ["auto", "0", "1", "2", "3"];

export type StripSeriesV1 = {
	/** Stable saved reading key (never a list position). */
	readonly key: string;
	/** Optional display name for this graph; else the reading's own label. */
	readonly name?: string;
	/** Optional identity color (#RRGGBB). */
	readonly color?: string;
};

export type StripOverlays = {
	readonly current: boolean;
	readonly minmax: boolean;
	readonly unit: boolean;
	readonly legend: boolean;
	readonly time: boolean;
	/** Scale and grid: labelled value ticks, time ticks, light gridlines and
	 * the window's min and max marked. Exact true only, and present only
	 * when on, so a copy without it is written as before. */
	readonly axes?: true;
};

/** Overlay defaults: the value, its unit, the names and the time span stay
 * on; min/max is opt in. Each field reads exact booleans only. */
export const DEFAULT_OVERLAYS: StripOverlays = { current: true, minmax: false, unit: true, legend: true, time: true };
export const OVERLAY_NAMES = ["current", "minmax", "unit", "legend", "time"] as const;
export type OverlayName = (typeof OVERLAY_NAMES)[number];
/** The Scale and grid overlay's stored name (StripOverlays.axes). */
export const AXES_OVERLAY = "axes";

/** A threshold band scoped to ONE reading of its pane, in that reading's
 * display unit (after the group's °F choice). */
export type StripBandV1 = {
	readonly key: string;
	readonly warn?: number;
	readonly crit?: number;
	/** Lower is worse (fans): bands open downward. Exact true only. */
	readonly below: boolean;
	/** The reading unit the numbers were typed against; a band whose unit no
	 * longer matches its reading is not drawn. */
	readonly unit?: string;
	/** The unit on view when the numbers were typed (the 1.8 key grammar,
	 * src/alerts/rules.ts stampCounts), kept only while its stored record
	 * (displayUnitFor) still matches them: the numbers then convert to the
	 * unit on view (°C and °F, Δ°C and Δ°F). */
	readonly displayUnit?: string;
};

/** Typed scale ends (Scale from, Scale to), stamped like a band with the
 * unit they were typed in (displayUnit, kept only while it counts). An
 * unstamped scale reads as typed in the unit on view, with the reach it had
 * before the stamp (src/strip/scale.ts resolvedScale). */
export type StripScale = { readonly min?: number; readonly max?: number; readonly displayUnit?: string };

/** The longest stamp unit and record text kept. */
export const STAMP_UNIT_MAX = 16;
export const STAMP_TEXT_MAX = 32;

/** Where a Group pane's readings come from: the folder (HWiNFO sensor) of
 * the pane's first reading, a detail filter (the Sensor Reading key's
 * grammar, issue #35), or a custom list. */
export const GROUP_SOURCES = ["folder", "filter", "list", "unit"] as const;
export type GroupSource = (typeof GROUP_SOURCES)[number];
/** How a Group pane draws: chosen from the reading count (auto), or one
 * view for any count. Auto never picks Tiles (src/strip/tiles.ts), so a
 * stored setup keeps the look it had. */
export const GROUP_VIEWS = ["auto", "rows", "now", "spread", "tiles"] as const;
export type GroupViewChoice = (typeof GROUP_VIEWS)[number];
/** The most readings a Group pane draws; a rule that matches more is
 * counted and says so ("32 of 48 shown"). */
export const GROUP_DRAW_MAX = 32;
/** The most readings a custom list keeps (the detail list's own bound). */
export const GROUP_KEYS_MAX = 128;

/** Group-wide alert limits, in the display unit of the pane's readings
 * (after the group's °F choice), stamped with the unit they were typed for
 * and, once edited here, the unit on view then (displayUnit, as a band). */
export type GroupLimits = { readonly warn?: number; readonly crit?: number; readonly below: boolean; readonly unit?: string; readonly displayUnit?: string };

/** A Group pane's rule, resolved live against every snapshot (src/strip/
 * group.ts), so a new or renamed sensor follows without an edit. */
export type StripGroupRule = {
	readonly from: GroupSource;
	/** Filter rules only: the pattern, as detailFilterOf keeps it. */
	readonly filter?: string;
	/** Unit rules only: the native unit every reading is taken in ("°C"). */
	readonly unit?: string;
	/** Custom lists only: stable saved keys, in order. */
	readonly keys: readonly string[];
	readonly view: GroupViewChoice;
	readonly limits?: GroupLimits;
};

/** The most readings an Ambient pane draws (every slice within the payload
 * bound on worst-case data, src/strip/ambient.ts). A stored `ambient` field
 * (a preview's look, Aurora or Silk) is kept as any unknown field is, and
 * nothing reads it: Ambient is Aurora. */
export const AMBIENT_DRAW_MAX = 48;
/** The longest unit a Unit rule keeps. */
export const MAX_UNIT_LENGTH = 16;

export type StripPaneV1 = {
	readonly style: StripStyle;
	readonly series: readonly StripSeriesV1[];
	/** Used only by a split group whose sharedWindow is exactly false. */
	readonly window?: HistoryWindowId;
	readonly overlays: StripOverlays;
	readonly scale: StripScale;
	readonly bands: readonly StripBandV1[];
	/** Large values (StripReadout); absent is off. */
	readonly readout?: StripReadout;
	/** Meters' look (StripMeterLook); absent is Thin bar. */
	readonly meterLook?: StripMeterLook;
	/** The Group style's rule; kept whatever the style, absent until set. */
	readonly group?: StripGroupRule;
	/** A style this version does not know, a newer version's or a look cut
	 * from 1.8 (CUT_STYLES): drawn as what it reads as and written back as it
	 * was, never as "trend". */
	readonly storedStyle?: string;
	/** A stored Fleet's rule as stored: the pane draws `group`, at View Now,
	 * and writes this back until a person edits the pane. */
	readonly storedGroup?: JsonValue;
	/** Screens: the screen's name (at most MAX_NAME_LENGTH); absent, the
	 * strip names it from its readings (src/strip/screens.ts). */
	readonly name?: string;
	/** Screens: a stable id (SCREEN_ID_PATTERN), minted by the plugin when a
	 * strip has two or more screens. It names the screen to the runtime
	 * view, the panel and the stored-extras match, never a position. */
	readonly screenId?: string;
	/** Screens: what made the screen (SCREEN_ORIGIN_PATTERN), the id of the
	 * Build screens for this PC proposal ("cpu", "gpu", "cooling",
	 * "clocks", "temps"), so a second Build never proposes it again
	 * whatever its name or readings became. Absent for a screen made by
	 * hand. Nothing draws from it. */
	readonly origin?: string;
	/** The reading the strip was made with (its creating dial's), on the
	 * first pane of a new strip. While that pane draws it alone, it is the
	 * strip's untouched start, whichever dial's panel looks: Fill both
	 * halves may replace it without asking. An edit of the pane's readings
	 * drops it. Nothing draws from it. */
	readonly seed?: string;
};

/** The most screens a strip keeps: panes[0] and up to seven in `screens`. */
export const MAX_SCREENS = 8;
/** A screen's id: 8 lowercase hex characters, minted by the plugin. */
export const SCREEN_ID_PATTERN = /^[0-9a-f]{8}$/;
/** A screen's origin: a short lowercase id. */
export const SCREEN_ORIGIN_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
/** Seconds between automatic screen changes: exact values only; anything
 * else reads as by hand (absent). */
export const SCREEN_CYCLES = [10, 30, 60, 300] as const;
export type ScreenCycle = (typeof SCREEN_CYCLES)[number];

export function screenCycleOf(raw: unknown): ScreenCycle | undefined {
	return (SCREEN_CYCLES as readonly unknown[]).includes(raw) ? (raw as ScreenCycle) : undefined;
}

export type StripConfigV1 = {
	readonly layout: StripLayout;
	/** The geometry the group was designed for; null (absent or malformed)
	 * never matches a device, so the members show the mismatch state. */
	readonly encoders: StripEncoders | null;
	readonly window: HistoryWindowId;
	/** Split only: both halves follow `window` unless exactly false. */
	readonly sharedWindow: boolean;
	/** Brief gaps (StripGapMode), for the whole strip; absent is Connect. */
	readonly gapMode?: StripGapMode;
	/** The group's own look, seeded once from the creating dial. */
	readonly theme?: string;
	readonly textMode?: "theme" | "dim" | "custom";
	readonly textColor?: string;
	readonly textDimSecondary: boolean;
	/** The strip's own Background, one of the seven exact names; absent is
	 * Default, the shared dial Background. */
	readonly background?: DialBackground;
	/** The strip's own Words in the accent color; absent is Default. */
	readonly accentWords?: boolean;
	/** The strip's own Stars and Sky color (deck-art.ts ART_STARS,
	 * ART_TONES), each an exact name; absent is Default, the shared dial
	 * one. */
	readonly stars?: ArtStars;
	readonly skyColor?: ArtTone;
	/** The looks generation an own Background or Words was chosen at
	 * (shared-looks.ts); absent is 0. */
	readonly looksGen?: number;
	readonly fahrenheit: boolean;
	readonly decimals: DecimalsSetting;
	/** Control key target for strip commands. */
	readonly linkId?: string;
	/** Always two panes; the whole layout draws only the first. Keeping the
	 * second lets a group go whole and back to split without losing it. */
	readonly panes: readonly [StripPaneV1, StripPaneV1];
	/** Whole layout only: the screens after the first, in order (the first
	 * is panes[0]). Absent: one screen, the strip as before screens. Kept
	 * and not drawn while the layout is split, as panes[1] is kept while
	 * whole. At most MAX_SCREENS - 1. */
	readonly screens?: readonly StripPaneV1[];
	/** Seconds between automatic screen changes; absent is by hand. */
	readonly screenCycle?: ScreenCycle;
	/** Issue #59: each reading's own unit and decimals on the strip, filed
	 * under its saved key like a Sensor Dial's readingFormats (src/ui/
	 * reading-format.ts reads both alike). Seeded once from the creating
	 * dial, edited from the strip's own rows. Absent: every reading follows
	 * the strip's Decimals and the deck's Data units, as before. */
	readonly readingFormats?: StripReadingFormats;
};

/** One reading's own format on a strip: a fixed unit, decimals, or both. */
export type StripReadingFormat = { readonly unit?: FixedDataUnit; readonly decimals?: DecimalsSetting };
export type StripReadingFormats = Readonly<Record<string, StripReadingFormat>>;
/** The most readings a strip keeps a format for (the panel's own cap). */
export const MAX_READING_FORMATS = 128;

const FIXED_UNITS: ReadonlySet<string> = new Set<string>(FIXED_DATA_UNITS);

/** One stored entry, its valid fields only; undefined with none. */
export function stripReadingFormatOf(raw: unknown): StripReadingFormat | undefined {
	if (!isObject(raw)) return undefined;
	const unit = typeof raw.unit === "string" && FIXED_UNITS.has(raw.unit) ? (raw.unit as FixedDataUnit) : undefined;
	const decimals = typeof raw.decimals === "string" && (DECIMALS as readonly string[]).includes(raw.decimals) ? (raw.decimals as DecimalsSetting) : undefined;
	if (unit === undefined && decimals === undefined) return undefined;
	return { ...(unit === undefined ? {} : { unit }), ...(decimals === undefined ? {} : { decimals }) };
}

/** A key a strip format may be filed under: a reading key a strip can draw. */
function formatKeyOk(key: string): boolean {
	return key !== "" && key.length <= MAX_KEY_LENGTH;
}

/**
 * The strip's readingFormats, salvaged entry by entry: a key a strip can
 * draw (1 to MAX_KEY_LENGTH characters), an entry with a valid unit or
 * decimals (its other fields dropped), at most MAX_READING_FORMATS of
 * them in stored order. Keys are own data entries, so "__proto__" is an
 * entry like any other. Undefined when nothing is left.
 */
export function stripReadingFormatsOf(raw: unknown): StripReadingFormats | undefined {
	if (!isObject(raw)) return undefined;
	const out: Record<string, StripReadingFormat> = {};
	let n = 0;
	for (const key of Object.keys(raw)) {
		if (!formatKeyOk(key)) continue;
		const entry = stripReadingFormatOf(raw[key]);
		if (entry === undefined) continue;
		Object.defineProperty(out, key, { value: entry, enumerable: true, writable: true, configurable: true });
		if (++n === MAX_READING_FORMATS) break;
	}
	return n === 0 ? undefined : out;
}

/** The map in its stored form (own data entries, the known fields). */
export function stripReadingFormatsToJson(formats: StripReadingFormats): JsonObject {
	const out: JsonObject = {};
	for (const key of Object.keys(formats)) {
		const entry = formats[key] as StripReadingFormat;
		Object.defineProperty(out, key, { value: { ...(entry.unit === undefined ? {} : { unit: entry.unit }), ...(entry.decimals === undefined ? {} : { decimals: entry.decimals }) }, enumerable: true, writable: true, configurable: true });
	}
	return out;
}

/** True when the value is exactly a map as stored: a plain object of at
 * most MAX_READING_FORMATS entries, each under a key a strip can draw,
 * each an object of "unit" and "decimals" only with at least one, each
 * valid. */
export function exactReadingFormats(value: unknown): boolean {
	if (!isObject(value)) return false;
	const keys = Object.keys(value);
	if (keys.length > MAX_READING_FORMATS) return false;
	return keys.every((key) => {
		const entry = value[key];
		if (!formatKeyOk(key) || !isObject(entry)) return false;
		const fields = Object.keys(entry);
		if (fields.length === 0 || fields.some((f) => f !== "unit" && f !== "decimals")) return false;
		const parsed = stripReadingFormatOf(entry);
		return parsed !== undefined && (!("unit" in entry) || parsed.unit !== undefined) && (!("decimals" in entry) || parsed.decimals !== undefined);
	});
}

/**
 * The readings a strip's own Unit and decimals rows name, in order: each
 * stored screen's series (panes[0], then the screens after it), then the
 * split's second pane's, then the keys of a rule's custom list in any of
 * them; each once. A rule that resolves live (a folder, a filter, a unit)
 * adds the readings it draws now in the runtime (src/strip/pi.ts).
 */
export function stripReadingKeysOf(config: Pick<StripConfigV1, "layout" | "panes" | "screens">): string[] {
	const panes = [...screensOf(config), ...(config.layout === "split" ? [config.panes[1]] : [])];
	const out: string[] = [];
	const add = (key: string): void => {
		if (!out.includes(key)) out.push(key);
	};
	for (const pane of panes) if (!isRuleStyle(pane.style)) for (const series of pane.series) add(series.key);
	for (const pane of panes) if (isRuleStyle(pane.style) && pane.group?.from === "list") for (const key of pane.group.keys) add(key);
	return out;
}

export type StripGroupCopy = {
	readonly v: 1;
	readonly id: string;
	readonly rev: number;
	readonly joined: boolean;
	readonly config: StripConfigV1;
};

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);

export function isStripStyle(raw: unknown): raw is StripStyle {
	return typeof raw === "string" && (STRIP_STYLES as readonly string[]).includes(raw);
}

export function isStripLayout(raw: unknown): raw is StripLayout {
	return raw === "whole" || raw === "split";
}

export function decimalsOf(raw: unknown): DecimalsSetting {
	return raw === "0" || raw === "1" || raw === "2" || raw === "3" ? raw : "auto";
}

/** A non-empty string no longer than `max`, else undefined. */
function boundedString(raw: unknown, max: number): string | undefined {
	return typeof raw === "string" && raw !== "" && raw.length <= max ? raw : undefined;
}

/** One series entry, or undefined when it has no usable key. */
export function stripSeriesOf(raw: unknown): StripSeriesV1 | undefined {
	if (!isObject(raw)) return undefined;
	const key = boundedString(raw.key, MAX_KEY_LENGTH);
	if (key === undefined) return undefined;
	const name = boundedString(raw.name, MAX_NAME_LENGTH);
	const color = typeof raw.color === "string" && HEX6.test(raw.color) ? raw.color : undefined;
	return { key, ...(name === undefined ? {} : { name }), ...(color === undefined ? {} : { color }) };
}

function seriesListOf(raw: unknown): StripSeriesV1[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: StripSeriesV1[] = [];
	for (const entry of raw) {
		const series = stripSeriesOf(entry);
		if (series === undefined || seen.has(series.key)) continue;
		seen.add(series.key);
		out.push(series);
		if (out.length === MAX_SERIES) break;
	}
	return out;
}

export function stripOverlaysOf(raw: unknown): StripOverlays {
	if (!isObject(raw)) return DEFAULT_OVERLAYS;
	const pick = (name: OverlayName): boolean => {
		const value = raw[name];
		return value === true ? true : value === false ? false : DEFAULT_OVERLAYS[name];
	};
	return { current: pick("current"), minmax: pick("minmax"), unit: pick("unit"), legend: pick("legend"), time: pick("time"), ...(raw.axes === true ? { axes: true as const } : {}) };
}

/**
 * The stamp of a stored entry when it counts for the numbers it stores
 * (stampCounts on the raw entry, so a record written for numbers an older
 * build rewrote proves nothing), within the length bounds; else undefined.
 * "" is a unit like any other: numbers typed for a reading with no unit.
 */
function stampOf(raw: Record<string, unknown>, names: readonly string[]): string | undefined {
	const unit = raw.displayUnit;
	const record = raw.displayUnitFor;
	if (typeof unit !== "string" || unit.length > STAMP_UNIT_MAX || !isObject(record)) return undefined;
	if (Object.values(record).some((v) => typeof v !== "string" || v.length > STAMP_TEXT_MAX)) return undefined;
	return stampCounts(
		unit,
		record,
		names.map((name) => [name, raw[name]] as const)
	);
}

export function stripScaleOf(raw: unknown): StripScale {
	if (!isObject(raw)) return {};
	const min = parseThreshold(raw.min);
	const max = parseThreshold(raw.max);
	// An empty or inverted range cannot place a value: auto scale instead.
	if (min !== undefined && max !== undefined && !(min < max)) return {};
	const displayUnit = min === undefined && max === undefined ? undefined : stampOf(raw, ["min", "max"]);
	return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), ...(displayUnit === undefined ? {} : { displayUnit }) };
}

/** One band, or undefined when it names no limit. */
export function stripBandOf(raw: unknown): StripBandV1 | undefined {
	if (!isObject(raw)) return undefined;
	const key = boundedString(raw.key, MAX_KEY_LENGTH);
	if (key === undefined) return undefined;
	const limits = groupLimitsOf(raw);
	return limits === undefined ? undefined : { key, ...limits };
}

function bandListOf(raw: unknown, series: readonly StripSeriesV1[]): StripBandV1[] {
	if (!Array.isArray(raw)) return [];
	const keys = new Set(series.map((s) => s.key));
	const out: StripBandV1[] = [];
	for (const entry of raw) {
		const band = stripBandOf(entry);
		// Reading-scoped: a band for a reading the pane does not draw is
		// never shown against another reading.
		if (band === undefined || !keys.has(band.key)) continue;
		out.push(band);
		if (out.length === MAX_BANDS) break;
	}
	return out;
}

export function groupLimitsOf(raw: unknown): GroupLimits | undefined {
	if (!isObject(raw)) return undefined;
	const warn = parseThreshold(raw.warn);
	const crit = parseThreshold(raw.crit);
	if (warn === undefined && crit === undefined) return undefined;
	const unit = typeof raw.unit === "string" && raw.unit.length <= 16 ? raw.unit : undefined;
	const displayUnit = stampOf(raw, ["warn", "crit"]);
	return { ...(warn === undefined ? {} : { warn }), ...(crit === undefined ? {} : { crit }), below: raw.below === true, ...(unit === undefined ? {} : { unit }), ...(displayUnit === undefined ? {} : { displayUnit }) };
}

/** The Group rule, salvaged field by field: an unknown source reads as
 * Folder, an unknown view as Auto, a filter by the detail filter's own
 * reader, a list as its first GROUP_KEYS_MAX valid distinct keys. */
export function stripGroupRuleOf(raw: unknown): StripGroupRule | undefined {
	if (!isObject(raw)) return undefined;
	const unit = typeof raw.unit === "string" && raw.unit !== "" && raw.unit.length <= MAX_UNIT_LENGTH ? raw.unit : undefined;
	// A Unit rule an older 1.8 build rewrote: it knew no "unit" source, so it
	// wrote the rule back as a Folder rule and kept `unit` as a field it did
	// not know. This build writes `unit` only on a Unit rule, so a Folder rule
	// that carries one can only be that, and reads as the Unit rule again.
	const from: GroupSource = raw.from === "filter" || raw.from === "list" || raw.from === "unit" ? raw.from : unit !== undefined ? "unit" : "folder";
	const filter = detailFilterOf({ detailFilter: raw.filter });
	const keys: string[] = [];
	if (Array.isArray(raw.keys)) {
		const seen = new Set<string>();
		for (const entry of raw.keys) {
			const key = boundedString(entry, MAX_KEY_LENGTH);
			if (key === undefined || seen.has(key)) continue;
			seen.add(key);
			keys.push(key);
			if (keys.length === GROUP_KEYS_MAX) break;
		}
	}
	const view: GroupViewChoice = (GROUP_VIEWS as readonly unknown[]).includes(raw.view) ? (raw.view as GroupViewChoice) : "auto";
	const limits = groupLimitsOf(raw.limits);
	return { from, ...(filter === undefined ? {} : { filter }), ...(unit === undefined || from !== "unit" ? {} : { unit }), keys, view, ...(limits === undefined ? {} : { limits }) };
}

/**
 * Looks 1.8 previews stored that were cut before 1.8 shipped, and what each
 * reads as. A stored pane draws as that and is written back as it was until
 * a person edits it (settleCutStyle). Silk is not here: it was a field of
 * Ambient, now an unknown field nothing reads.
 */
const CUT_STYLES: Readonly<Record<string, StripStyle>> = { envelope: "trend", bars: "trend", fleet: "group" };

/** A stored Fleet's rule as drawn: the same readings, a column each. */
function fleetRuleOf(raw: unknown): StripGroupRule {
	return { ...(stripGroupRuleOf(raw) ?? { from: "folder", keys: [] }), view: "now" };
}

/** A stored pane (JSON) about to take a person's edit: a cut look's pane
 * becomes what it reads as, so their edit holds. */
export function settleCutStyle(stored: Record<string, unknown>): void {
	if (typeof stored.style !== "string" || !Object.hasOwn(CUT_STYLES, stored.style)) return;
	if (stored.style === "fleet") stored.group = stripGroupRuleToJson(fleetRuleOf(stored.group), stored.group);
	stored.style = CUT_STYLES[stored.style];
}

export const EMPTY_PANE: StripPaneV1 = { style: "trend", series: [], overlays: DEFAULT_OVERLAYS, scale: {}, bands: [] };

export function stripPaneOf(raw: unknown): StripPaneV1 {
	if (!isObject(raw)) return EMPTY_PANE;
	const cutTo = typeof raw.style === "string" && Object.hasOwn(CUT_STYLES, raw.style) ? CUT_STYLES[raw.style] : undefined;
	const style = isStripStyle(raw.style) ? raw.style : (cutTo ?? "trend");
	// A style string this version does not know (a newer one's, or a cut
	// look): drawn as what it reads as, and written back exactly as stored.
	const storedStyle = typeof raw.style === "string" && raw.style !== "" && raw.style.length <= MAX_NAME_LENGTH && !isStripStyle(raw.style) ? raw.style : undefined;
	const series = seriesListOf(raw.series);
	const window = parseHistoryWindow(raw.window);
	const readout = stripReadoutOf(raw.readout);
	const meterLook = stripMeterLookOf(raw.meterLook);
	const fleet = raw.style === "fleet";
	const group = fleet ? fleetRuleOf(raw.group) : stripGroupRuleOf(raw.group);
	const name = typeof raw.name === "string" && raw.name.trim() !== "" && raw.name.length <= MAX_NAME_LENGTH ? raw.name : undefined;
	const screenId = typeof raw.screenId === "string" && SCREEN_ID_PATTERN.test(raw.screenId) ? raw.screenId : undefined;
	const origin = typeof raw.origin === "string" && SCREEN_ORIGIN_PATTERN.test(raw.origin) ? raw.origin : undefined;
	const seed = boundedString(raw.seed, MAX_KEY_LENGTH);
	return {
		style,
		series,
		...(window === undefined ? {} : { window }),
		overlays: stripOverlaysOf(raw.overlays),
		scale: stripScaleOf(raw.scale),
		bands: bandListOf(raw.bands, series),
		...(readout === undefined ? {} : { readout }),
		...(meterLook === undefined ? {} : { meterLook }),
		...(group === undefined ? {} : { group }),
		...(storedStyle === undefined ? {} : { storedStyle }),
		...(fleet && isObject(raw.group) ? { storedGroup: raw.group as JsonValue } : {}),
		...(name === undefined ? {} : { name }),
		...(screenId === undefined ? {} : { screenId }),
		...(origin === undefined ? {} : { origin }),
		...(seed === undefined ? {} : { seed })
	};
}

/** Where each parsed screen was read from in its stored `screens` list, so
 * a screen with no id still takes its own stored entry's unknown fields
 * (an entry that is not an object is skipped, which shifts positions). */
const screenRawIndex = new WeakMap<StripPaneV1, number>();

/** A pane without the id it was stored with (a later duplicate). */
function withoutScreenId(pane: StripPaneV1): StripPaneV1 {
	if (pane.screenId === undefined) return pane;
	const { screenId: _id, ...rest } = pane;
	void _id;
	return rest;
}

/** The stored screens after the first: the first MAX_SCREENS - 1 entries
 * that are objects, each parsed as a pane. An id that an earlier screen
 * (panes[0] included) already uses is dropped from the later one, so ids
 * stay unique; such a screen runs on a runtime key until the next edit
 * mints it a real id. */
function screenListOf(raw: unknown, first: StripPaneV1): StripPaneV1[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const seen = new Set<string>(first.screenId === undefined ? [] : [first.screenId]);
	const out: StripPaneV1[] = [];
	for (const [index, entry] of raw.entries()) {
		if (!isObject(entry)) continue;
		let pane = stripPaneOf(entry);
		if (pane.screenId !== undefined && seen.has(pane.screenId)) pane = withoutScreenId(pane);
		if (pane.screenId !== undefined) seen.add(pane.screenId);
		screenRawIndex.set(pane, index);
		out.push(pane);
		if (out.length === MAX_SCREENS - 1) break;
	}
	return out.length === 0 ? undefined : out;
}

/** Every screen of a stored config in order: panes[0], then `screens`.
 * Read it from the stored copy, never from an effective config (which has
 * the screen on view in panes[0]). */
export function screensOf(config: Pick<StripConfigV1, "panes" | "screens">): readonly StripPaneV1[] {
	return config.screens === undefined ? [config.panes[0]] : [config.panes[0], ...config.screens];
}

/** The runtime key of each screen: its id, else "@<position>" (never
 * written; the next edit mints real ids). */
export function screenKeysOf(config: Pick<StripConfigV1, "panes" | "screens">): string[] {
	return screensOf(config).map((pane, i) => pane.screenId ?? `@${i}`);
}

/** How many screens the strip draws in turn: one unless the layout is
 * whole and it keeps more. */
export function screenCountOf(config: Pick<StripConfigV1, "layout" | "panes" | "screens">): number {
	return config.layout === "whole" ? screensOf(config).length : 1;
}

/**
 * The stored JSON each parsed config (and the stripGroup copy around it) was
 * read from. A config is written to dials other than the one it came from
 * (a dial joining, Make independent, a pasted copy chosen), and those writes
 * must keep the fields a newer version stored with it, not the target dial's
 * own. Parsed configs are never mutated, so identity is a safe key.
 */
const configSource = new WeakMap<StripConfigV1, Record<string, unknown>>();
const groupSource = new WeakMap<StripConfigV1, Record<string, unknown>>();

export function stripConfigOf(raw: unknown): StripConfigV1 {
	const config = parsedConfigOf(raw);
	if (isObject(raw)) configSource.set(config, raw);
	return config;
}

function parsedConfigOf(raw: unknown): StripConfigV1 {
	const r = isObject(raw) ? raw : {};
	const panesRaw = Array.isArray(r.panes) ? r.panes : [];
	const textMode = r.textMode === "theme" || r.textMode === "dim" || r.textMode === "custom" ? r.textMode : undefined;
	const textColor = typeof r.textColor === "string" && HEX6.test(r.textColor) ? r.textColor : undefined;
	const theme = boundedString(r.theme, MAX_THEME_LENGTH);
	const linkId = boundedString(r.linkId, MAX_LINK_ID_LENGTH);
	const first = stripPaneOf(panesRaw[0]);
	const screens = screenListOf(r.screens, first);
	const screenCycle = screenCycleOf(r.screenCycle);
	const background = ownBackgroundOf(r.background);
	const accentWords = ownAccentWordsOf(r.accentWords);
	const stars = artStarsOf(r.stars);
	const skyColor = artToneOf(r.skyColor);
	const looksGen = looksGenOf(r.looksGen);
	const readingFormats = stripReadingFormatsOf(r.readingFormats);
	const gapMode = stripGapModeOf(r.gapMode);
	return {
		layout: isStripLayout(r.layout) ? r.layout : "whole",
		encoders: isStripEncoders(r.encoders) ? r.encoders : null,
		window: parseHistoryWindow(r.window) ?? DEFAULT_WINDOW,
		sharedWindow: r.sharedWindow !== false,
		...(gapMode === undefined ? {} : { gapMode }),
		...(theme === undefined ? {} : { theme }),
		...(textMode === undefined ? {} : { textMode }),
		...(textColor === undefined ? {} : { textColor }),
		textDimSecondary: r.textDimSecondary === true,
		...(background === null ? {} : { background }),
		...(accentWords === null ? {} : { accentWords }),
		...(stars === null ? {} : { stars }),
		...(skyColor === null ? {} : { skyColor }),
		...(looksGen === 0 ? {} : { looksGen }),
		fahrenheit: r.fahrenheit === true,
		decimals: decimalsOf(r.decimals),
		...(linkId === undefined ? {} : { linkId }),
		panes: [first, stripPaneOf(panesRaw[1])],
		...(screens === undefined ? {} : { screens }),
		...(screenCycle === undefined ? {} : { screenCycle }),
		...(readingFormats === undefined ? {} : { readingFormats })
	};
}

/** The one reader of DialSettings.stripGroup. Undefined means the dial is
 * independent, exactly as before strips existed. */
export function stripGroupOf(raw: unknown): StripGroupCopy | undefined {
	if (!isObject(raw) || raw.v !== STRIP_GROUP_VERSION) return undefined;
	if (typeof raw.id !== "string" || !STRIP_ID_PATTERN.test(raw.id)) return undefined;
	const rev = typeof raw.rev === "number" && Number.isSafeInteger(raw.rev) && raw.rev >= 1 ? raw.rev : 0;
	const config = stripConfigOf(raw.config);
	groupSource.set(config, raw);
	return { v: 1, id: raw.id, rev, joined: raw.joined === true, config };
}

/** The panes a layout draws. */
export function activePanes(config: StripConfigV1): readonly StripPaneV1[] {
	return config.layout === "whole" ? [config.panes[0]] : config.panes;
}

/** The window one pane shows: its own only in a split group whose
 * sharedWindow is exactly false. */
export function paneWindowOf(config: StripConfigV1, paneIndex: number): HistoryWindowId {
	if (config.layout !== "split" || config.sharedWindow) return config.window;
	return config.panes[paneIndex === 1 ? 1 : 0].window ?? config.window;
}

// ---- writing ---------------------------------------------------------------

const CONFIG_KEYS = new Set(["layout", "encoders", "window", "sharedWindow", "theme", "textMode", "textColor", "textDimSecondary", "background", "accentWords", "stars", "skyColor", "looksGen", "fahrenheit", "decimals", "linkId", "panes", "screens", "screenCycle", "readingFormats"]);
const PANE_KEYS = new Set(["style", "series", "window", "overlays", "scale", "bands", "readout", "group", "name", "screenId", "origin", "seed"]);
const GROUP_RULE_KEYS = new Set(["from", "filter", "unit", "keys", "view", "limits"]);
const GROUP_LIMIT_KEYS = new Set(["warn", "crit", "below", "unit", "displayUnit", "displayUnitFor"]);
const OVERLAY_KEYS = new Set<string>([...OVERLAY_NAMES, AXES_OVERLAY]);
const GROUP_KEYS = new Set(["v", "id", "rev", "joined", "config"]);
const SERIES_KEYS = new Set(["key", "name", "color"]);
// The stamp's two fields are known: a stamp that does not count is dropped
// on the next rewrite, as it proves nothing.
const SCALE_KEYS = new Set(["min", "max", "displayUnit", "displayUnitFor"]);
const BAND_KEYS = new Set(["key", "warn", "crit", "below", "unit", "displayUnit", "displayUnitFor"]);

/** A stamp in its stored form: the unit and the record of the numbers it
 * covers, recomputed from the numbers written beside it. */
function stampToJson(displayUnit: string | undefined, numbers: readonly (readonly [string, number | undefined])[]): JsonObject {
	return displayUnit === undefined ? {} : { displayUnit, displayUnitFor: stampRecordOf(numbers) };
}

/** A scale in its stored form (no unknown fields). */
export function stripScaleToJson(scale: StripScale): JsonObject {
	return {
		...(scale.min === undefined ? {} : { min: scale.min }),
		...(scale.max === undefined ? {} : { max: scale.max }),
		...stampToJson(scale.displayUnit, [
			["min", scale.min],
			["max", scale.max]
		])
	};
}

/**
 * Fields a newer version stored that this one does not know: kept on
 * every rewrite so a deliberate edit here never strips them. That holds at
 * every level: the group, its config, each pane and its overlays and
 * scale, and each series and band entry. An entry takes the unknown fields
 * of the stored entry for the same reading (the first unused valid one, in
 * order, when a reading has several bands); an entry with no stored match,
 * or one an edit removed, has none to carry.
 */
function extrasOf(preserve: unknown, known: ReadonlySet<string>): JsonObject {
	if (!isObject(preserve)) return {};
	const out: JsonObject = {};
	for (const [key, value] of Object.entries(preserve)) {
		if (!known.has(key) && value !== undefined) out[key] = JSON.parse(JSON.stringify(value)) as JsonValue;
	}
	return out;
}

function seriesToJson(series: StripSeriesV1): JsonObject {
	return { key: series.key, ...(series.name === undefined ? {} : { name: series.name }), ...(series.color === undefined ? {} : { color: series.color }) };
}

/** A band in its stored form (no unknown fields). */
export function stripBandToJson(band: StripBandV1): JsonObject {
	return {
		key: band.key,
		...(band.warn === undefined ? {} : { warn: band.warn }),
		...(band.crit === undefined ? {} : { crit: band.crit }),
		below: band.below,
		...(band.unit === undefined ? {} : { unit: band.unit }),
		...stampToJson(band.displayUnit, [
			["warn", band.warn],
			["crit", band.crit]
		])
	};
}

/** The stored entries of a list that parse, grouped by reading key in
 * order; each rewritten entry takes (and uses up) the first of its key. */
function storedByKey(raw: unknown, valid: (entry: unknown) => boolean): Map<string, unknown[]> {
	const out = new Map<string, unknown[]>();
	if (!Array.isArray(raw)) return out;
	for (const entry of raw) {
		if (!isObject(entry) || typeof entry.key !== "string" || !valid(entry)) continue;
		const list = out.get(entry.key);
		if (list === undefined) out.set(entry.key, [entry]);
		else list.push(entry);
	}
	return out;
}

/** A Group rule in its stored form, with any fields a newer version kept
 * in the rule it replaces. */
export function stripGroupRuleToJson(rule: StripGroupRule, preserve?: unknown): JsonObject {
	const stored = isObject(preserve) ? preserve : {};
	const limits = rule.limits;
	return {
		...extrasOf(preserve, GROUP_RULE_KEYS),
		from: rule.from,
		...(rule.filter === undefined ? {} : { filter: rule.filter }),
		...(rule.unit === undefined ? {} : { unit: rule.unit }),
		keys: [...rule.keys],
		view: rule.view,
		...(limits === undefined
			? {}
			: {
					limits: {
						...extrasOf(stored.limits, GROUP_LIMIT_KEYS),
						...(limits.warn === undefined ? {} : { warn: limits.warn }),
						...(limits.crit === undefined ? {} : { crit: limits.crit }),
						below: limits.below,
						...(limits.unit === undefined ? {} : { unit: limits.unit }),
						...stampToJson(limits.displayUnit, [
							["warn", limits.warn],
							["crit", limits.crit]
						])
					}
				})
	};
}

export function stripPaneToJson(pane: StripPaneV1, preserve?: unknown): JsonObject {
	const stored = isObject(preserve) ? preserve : {};
	const series = storedByKey(stored.series, (e) => stripSeriesOf(e) !== undefined);
	const bands = storedByKey(stored.bands, (e) => stripBandOf(e) !== undefined);
	return {
		...extrasOf(preserve, PANE_KEYS),
		style: pane.storedStyle ?? pane.style,
		series: pane.series.map((s) => ({ ...extrasOf(series.get(s.key)?.shift(), SERIES_KEYS), ...seriesToJson(s) })),
		...(pane.window === undefined ? {} : { window: pane.window }),
		overlays: { ...extrasOf(stored.overlays, OVERLAY_KEYS), ...pane.overlays },
		scale: { ...extrasOf(stored.scale, SCALE_KEYS), ...stripScaleToJson(pane.scale) },
		bands: pane.bands.map((b) => ({ ...extrasOf(bands.get(b.key)?.shift(), BAND_KEYS), ...stripBandToJson(b) })),
		...(pane.readout === undefined ? {} : { readout: pane.readout }),
		...(pane.meterLook === undefined ? {} : { meterLook: pane.meterLook }),
		// A stored Fleet writes its rule back as stored, or none if it had none.
		...(pane.storedStyle === "fleet" ? (pane.storedGroup === undefined ? {} : { group: pane.storedGroup }) : pane.group === undefined ? {} : { group: stripGroupRuleToJson(pane.group, stored.group) }),
		...(pane.name === undefined ? {} : { name: pane.name }),
		...(pane.screenId === undefined || !SCREEN_ID_PATTERN.test(pane.screenId) ? {} : { screenId: pane.screenId }),
		...(pane.origin === undefined || !SCREEN_ORIGIN_PATTERN.test(pane.origin) ? {} : { origin: pane.origin }),
		...(pane.seed === undefined ? {} : { seed: pane.seed })
	};
}

/**
 * The stored entry each screen takes its unknown fields from: the stored
 * screen with the same id (in panes[0] or `screens`), so a screen's
 * unknown fields follow its id through a reorder, a removal and a
 * promotion into panes[0]; a screen with no id takes the entry it was
 * parsed from, else the entry at its position.
 */
function screenPreserves(config: StripConfigV1, source: unknown): { readonly first: unknown; readonly screens: readonly unknown[] } {
	const panesRaw = isObject(source) && Array.isArray(source.panes) ? source.panes : [];
	const screensRaw = isObject(source) && Array.isArray(source.screens) ? source.screens : [];
	const byId = new Map<string, unknown>();
	for (const entry of [panesRaw[0], ...screensRaw]) {
		if (isObject(entry) && typeof entry.screenId === "string" && SCREEN_ID_PATTERN.test(entry.screenId) && !byId.has(entry.screenId)) byId.set(entry.screenId, entry);
	}
	const ofId = (pane: StripPaneV1): unknown => (pane.screenId === undefined ? undefined : byId.get(pane.screenId));
	return {
		first: ofId(config.panes[0]) ?? panesRaw[0],
		screens: (config.screens ?? []).map((pane, i) => ofId(pane) ?? screensRaw[screenRawIndex.get(pane) ?? i])
	};
}

/** The canonical stored form of a config: every known field in its exact
 * spelling, plus the unknown fields of the JSON it was read from, else of
 * `preserve` (the copy it replaces). */
export function stripConfigToJson(config: StripConfigV1, preserve?: unknown): JsonObject {
	const source = configSource.get(config) ?? preserve;
	const panesRaw = isObject(source) && Array.isArray(source.panes) ? source.panes : [];
	const kept = screenPreserves(config, source);
	return {
		...extrasOf(source, CONFIG_KEYS),
		layout: config.layout,
		...(config.encoders === null ? {} : { encoders: config.encoders }),
		window: config.window,
		sharedWindow: config.sharedWindow,
		...(config.gapMode === undefined ? {} : { gapMode: config.gapMode }),
		...(config.theme === undefined ? {} : { theme: config.theme }),
		...(config.textMode === undefined ? {} : { textMode: config.textMode }),
		...(config.textColor === undefined ? {} : { textColor: config.textColor }),
		textDimSecondary: config.textDimSecondary,
		...(config.background === undefined ? {} : { background: config.background }),
		...(config.accentWords === undefined ? {} : { accentWords: config.accentWords }),
		...(config.stars === undefined ? {} : { stars: config.stars }),
		...(config.skyColor === undefined ? {} : { skyColor: config.skyColor }),
		...(config.looksGen === undefined ? {} : { looksGen: config.looksGen }),
		fahrenheit: config.fahrenheit,
		decimals: config.decimals,
		...(config.linkId === undefined ? {} : { linkId: config.linkId }),
		panes: [stripPaneToJson(config.panes[0], kept.first), stripPaneToJson(config.panes[1], panesRaw[1])],
		...(config.screens === undefined || config.screens.length === 0 ? {} : { screens: config.screens.map((pane, i) => stripPaneToJson(pane, kept.screens[i])) }),
		...(config.screenCycle === undefined ? {} : { screenCycle: config.screenCycle }),
		...(config.readingFormats === undefined ? {} : { readingFormats: stripReadingFormatsToJson(config.readingFormats) })
	};
}

/** The config with no Background or Words of its own (Default, the shared
 * ones), every other field, unknown ones included, as it was: what "Use it
 * everywhere" leaves a strip with (shared-looks.ts). */
export function withDefaultLooks(config: StripConfigV1): StripConfigV1 {
	const json = stripConfigToJson(config);
	delete json.background;
	delete json.accentWords;
	delete json.stars;
	delete json.skyColor;
	delete json.looksGen;
	return stripConfigOf(json);
}

/** A copy in its stored form. Group-level unknown fields come from
 * `preserve` (the same group's copy it replaces), else from the copy its
 * config was read from. */
export function stripGroupToJson(copy: StripGroupCopy, preserve?: unknown): JsonObject {
	return {
		...extrasOf(isObject(preserve) ? preserve : groupSource.get(copy.config), GROUP_KEYS),
		v: STRIP_GROUP_VERSION,
		id: copy.id,
		rev: copy.rev,
		joined: copy.joined,
		config: stripConfigToJson(copy.config, isObject(preserve) ? preserve.config : undefined)
	};
}

/** The field that holds a pasted copy waiting for the person's choice. */
export const STRIP_PASTED_FIELD = "stripGroupPasted";

/** A fresh group id: 32 lowercase hex characters. */
export function mintStripId(uuid: () => string = randomUUID): string {
	const id = uuid().replace(/-/g, "").toLowerCase();
	if (!STRIP_ID_PATTERN.test(id)) throw new Error("strip id source returned an unusable id");
	return id;
}

/** What a new group copies, once, from the dial that creates it. Read with
 * the same exact readers the dial uses. Its Background and Words are not
 * copied: a new strip follows the shared ones (Default). Its unit and
 * decimals per reading are (issue #59): a strip made from a dial set to GB
 * draws those readings in GB. */
export type StripSeed = {
	readonly theme?: string;
	readonly textMode?: "theme" | "dim" | "custom";
	readonly textColor?: string;
	readonly textDimSecondary: boolean;
	readonly fahrenheit: boolean;
	readonly decimals: DecimalsSetting;
	readonly linkId?: string;
	readonly readingKey?: string;
	/** The dial's own unit and decimals per reading (issue #59). */
	readonly readingFormats?: StripReadingFormats;
};

export function stripSeedOf(dialSettings: unknown): StripSeed {
	const r = isObject(dialSettings) ? dialSettings : {};
	const config = stripConfigOf({
		theme: r.theme,
		textMode: r.textMode,
		textColor: r.textColor,
		textDimSecondary: r.textDimSecondary,
		fahrenheit: r.fahrenheit,
		decimals: r.decimals,
		linkId: typeof r.linkId === "string" ? r.linkId.trim() : undefined
	});
	const readingKey = boundedString(r.readingKey, MAX_KEY_LENGTH);
	const readingFormats = stripReadingFormatsOf(r.readingFormats);
	return {
		...(config.theme === undefined ? {} : { theme: config.theme }),
		...(config.textMode === undefined ? {} : { textMode: config.textMode }),
		...(config.textColor === undefined ? {} : { textColor: config.textColor }),
		textDimSecondary: config.textDimSecondary,
		fahrenheit: config.fahrenheit,
		decimals: config.decimals,
		...(config.linkId === undefined ? {} : { linkId: config.linkId }),
		...(readingKey === undefined ? {} : { readingKey }),
		...(readingFormats === undefined ? {} : { readingFormats })
	};
}

/** A new group's config: the seed's theme and text, no Background or Words
 * of its own (Default), the default window, and the creating dial's reading
 * in the first pane so the strip draws at once, kept beside it as the
 * pane's `seed` (the untouched start, on every member's panel). */
export function newStripConfig(layout: StripLayout, encoders: StripEncoders, seed: StripSeed): StripConfigV1 {
	const first: StripPaneV1 = seed.readingKey === undefined ? EMPTY_PANE : { ...EMPTY_PANE, series: [{ key: seed.readingKey }], seed: seed.readingKey };
	return {
		layout,
		encoders,
		window: DEFAULT_WINDOW,
		sharedWindow: true,
		...(seed.theme === undefined ? {} : { theme: seed.theme }),
		...(seed.textMode === undefined ? {} : { textMode: seed.textMode }),
		...(seed.textColor === undefined ? {} : { textColor: seed.textColor }),
		textDimSecondary: seed.textDimSecondary,
		fahrenheit: seed.fahrenheit,
		decimals: seed.decimals,
		...(seed.linkId === undefined ? {} : { linkId: seed.linkId }),
		panes: [first, EMPTY_PANE],
		...(seed.readingFormats === undefined ? {} : { readingFormats: seed.readingFormats })
	};
}
