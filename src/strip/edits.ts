/**
 * The single-writer edit protocol for strip groups, as pure functions.
 *
 * The plugin is the only writer of `stripGroup`. A settings panel asks for a
 * change with the revision it was looking at (baseRev); the change applies
 * only to that exact revision, only through whitelisted paths, only when
 * every operation is valid (never partially), and always produces a
 * complete new copy at rev + 1, which the panel handler (src/strip/pi.ts)
 * lifts above every copy a visible dial of the strip holds, left copies
 * included. The planners below return the exact, complete settings
 * document for each context to write: the member's own
 * document with one field, stripGroup, replaced. They never touch a dial's
 * individual fields, so leaving a group restores the dial as it was; the one
 * exception is "Use it everywhere" (planLooksReset), which also drops the
 * dial's own Background and Words when they predate it and stamps looksGen
 * on that write.
 */
import { randomBytes } from "node:crypto";

import { DETAIL_FILTER_MAX, detailFilterOf } from "../detail/detail-settings";
import { parseHistoryWindow } from "../history/window";
import { artStarsOf, artToneOf } from "../ui/deck-art";
import { dialBackgroundOf } from "../ui/dial-background";
import { parseThreshold } from "../ui/format";
import { HEX6 } from "../ui/text-colors";
import { isStripEncoders, type StripEncoders, type StripLayout } from "./geometry";
import {
	DECIMALS,
	EMPTY_PANE,
	exactReadingFormats,
	GROUP_KEYS_MAX,
	GROUP_SOURCES,
	GROUP_VIEWS,
	groupLimitsOf,
	isStripLayout,
	isStripStyle,
	settleCutStyle,
	MAX_BANDS,
	MAX_KEY_LENGTH,
	MAX_LINK_ID_LENGTH,
	MAX_NAME_LENGTH,
	MAX_SCREENS,
	MAX_SERIES,
	MAX_THEME_LENGTH,
	MAX_UNIT_LENGTH,
	newStripConfig,
	AXES_OVERLAY,
	OVERLAY_NAMES,
	SCREEN_ID_PATTERN,
	SCREEN_ORIGIN_PATTERN,
	screenCycleOf,
	screenKeysOf,
	STAMP_TEXT_MAX,
	STAMP_UNIT_MAX,
	stripBandOf,
	stripBandToJson,
	type StripBandV1,
	stripConfigOf,
	stripGapModeOf,
	stripMeterLookOf,
	stripReadoutOf,
	stripConfigToJson,
	stripGroupOf,
	stripGroupToJson,
	STRIP_PASTED_FIELD,
	stripSeedOf,
	stripSeriesOf,
	stripGroupRuleOf,
	stripGroupRuleToJson,
	stripPaneToJson,
	stripReadingFormatsOf,
	stripReadingFormatsToJson,
	withDefaultLooks,
	type StripConfigV1,
	type StripGroupCopy,
	type StripGroupRule
} from "./settings";

export const MAX_EDIT_OPS = 40;

export type StripEditReason = "stale" | "invalid" | "no-group" | "mismatch";

/** An applied edit's `screenKeys`: each screen of the base still in the
 * copy, from its runtime key before (screenKeysOf) to its key after. A
 * screen keyed by its place changes key when the edit gives it an id. */
export type ScreenKeyMap = ReadonlyMap<string, string>;

export type StripEditResult =
	| { readonly ok: true; readonly copy: StripGroupCopy; readonly screenKeys: ScreenKeyMap }
	| { readonly ok: false; readonly reason: StripEditReason; readonly rev: number; readonly config: StripConfigV1 | null; readonly detail?: string };

/** What an edit applies to: the group's in-memory authority. */
export type EditBase = { readonly id: string; readonly rev: number; readonly config: StripConfigV1 };

type Draft = Record<string, unknown> & { panes: Record<string, unknown>[]; screens?: Record<string, unknown>[] };

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);

/** One validated operation: the draft mutation it performs, or why it
 * cannot apply to the draft as earlier operations left it (a screen that
 * is not there). */
type Applier = (draft: Draft) => string | undefined;

/** A fresh screen id: 8 lowercase hex characters. */
export function mintScreenId(): string {
	return randomBytes(4).toString("hex");
}

/** The draft's screens as one list: panes[0], then `screens`. */
function screenList(d: Draft): Record<string, unknown>[] {
	return [d.panes[0] as Record<string, unknown>, ...(Array.isArray(d.screens) ? d.screens : [])];
}

/** Writes a screen list back: the first into panes[0], the rest into
 * `screens` (absent when there are none). */
function setScreenList(d: Draft, list: readonly Record<string, unknown>[]): void {
	d.panes[0] = list[0] as Record<string, unknown>;
	if (list.length > 1) d.screens = list.slice(1);
	else delete d.screens;
}

/** A whole number in [lo, hi], else undefined. */
function indexIn(raw: unknown, lo: number, hi: number): number | undefined {
	return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= lo && raw <= hi ? raw : undefined;
}

/** The new screen Add makes: Group over a filter rule with no filter yet. */
function groupScreenJson(): Record<string, unknown> {
	return stripPaneToJson({ ...EMPTY_PANE, style: "group", group: { from: "filter", keys: [], view: "auto" } });
}

/** A structural op on the list of screens, validated for its shape; the
 * positions are checked against the draft when it applies. */
function screenOpOf(op: Record<string, unknown>): Applier | undefined {
	if (op.op === "addScreen") {
		const from = op.from ?? "group";
		if ((from !== "group" && from !== "copy") || indexIn(op.at, 0, MAX_SCREENS) === undefined) return undefined;
		const at = op.at as number;
		return (d) => {
			const list = screenList(d);
			if (list.length >= MAX_SCREENS) return `a strip keeps at most ${MAX_SCREENS} screens`;
			if (at > list.length) return `addScreen: no place ${at}`;
			let screen = groupScreenJson();
			if (from === "copy") {
				screen = JSON.parse(JSON.stringify(list[Math.max(0, at - 1)])) as Record<string, unknown>;
				delete screen.name;
				delete screen.origin;
				delete screen.seed;
			}
			delete screen.screenId;
			list.splice(at, 0, screen);
			setScreenList(d, list);
			return undefined;
		};
	}
	if (op.op === "removeScreen") {
		if (indexIn(op.at, 0, MAX_SCREENS - 1) === undefined) return undefined;
		const at = op.at as number;
		return (d) => {
			const list = screenList(d);
			if (list.length < 2) return "removeScreen: the last screen stays";
			if (at >= list.length) return `removeScreen: no screen ${at}`;
			list.splice(at, 1);
			setScreenList(d, list);
			return undefined;
		};
	}
	if (op.op === "moveScreen") {
		if (indexIn(op.from, 0, MAX_SCREENS - 1) === undefined || indexIn(op.to, 0, MAX_SCREENS - 1) === undefined) return undefined;
		const from = op.from as number;
		const to = op.to as number;
		return (d) => {
			const list = screenList(d);
			if (from >= list.length || to >= list.length) return `moveScreen: no screen ${Math.max(from, to)}`;
			const [moved] = list.splice(from, 1);
			list.splice(to, 0, moved as Record<string, unknown>);
			setScreenList(d, list);
			return undefined;
		};
	}
	return undefined;
}

/** Every screen of a strip with two or more gets an id; ids stay unique. */
function mintScreenIds(d: Draft, mint: () => string): void {
	const list = screenList(d);
	if (list.length < 2) return;
	const seen = new Set<string>();
	for (const screen of list) {
		const id = screen.screenId;
		if (typeof id === "string" && SCREEN_ID_PATTERN.test(id) && !seen.has(id)) {
			seen.add(id);
			continue;
		}
		let fresh = mint();
		for (let tries = 0; (!SCREEN_ID_PATTERN.test(fresh) || seen.has(fresh)) && tries < 64; tries++) fresh = mint();
		if (!SCREEN_ID_PATTERN.test(fresh) || seen.has(fresh)) throw new Error("screen id source returned no usable id");
		screen.screenId = fresh;
		seen.add(fresh);
	}
}

const TOP_FIELDS: Readonly<Record<string, (value: unknown) => { ok: true; value: unknown } | { ok: false }>> = {
	layout: (v) => (isStripLayout(v) ? { ok: true, value: v } : { ok: false }),
	window: (v) => (parseHistoryWindow(v) !== undefined ? { ok: true, value: v } : { ok: false }),
	sharedWindow: boolOnly,
	textDimSecondary: boolOnly,
	// The strip's own Words; null goes back to Default (the shared Words).
	accentWords: (v) => (v === null ? { ok: true, value: undefined } : boolOnly(v)),
	fahrenheit: boolOnly,
	theme: (v) => clearable(v, (s) => s.length <= MAX_THEME_LENGTH),
	textMode: (v) => clearable(v, (s) => s === "theme" || s === "dim" || s === "custom"),
	textColor: (v) => clearable(v, (s) => HEX6.test(s)),
	// Exact names only, as dialBackgroundOf reads them: "theme" is a valid
	// stored value; a case or space variant is refused, never stored. ""
	// goes back to Default (the shared Background).
	background: (v) => clearable(v, (s) => dialBackgroundOf(s) === s),
	// The strip's own Stars and Sky color: exact names only (deck-art.ts
	// artStarsOf, artToneOf); "" goes back to Default (the shared one).
	stars: (v) => clearable(v, (s) => artStarsOf(s) === s),
	skyColor: (v) => clearable(v, (s) => artToneOf(s) === s),
	decimals: (v) => (typeof v === "string" && (DECIMALS as readonly string[]).includes(v) ? { ok: true, value: v } : { ok: false }),
	linkId: (v) => (typeof v === "string" && v.trim().length <= MAX_LINK_ID_LENGTH ? { ok: true, value: v.trim() === "" ? undefined : v.trim() } : { ok: false }),
	// The strip's own unit and decimals per reading (issue #59): the whole
	// map at once, exactly as stored; null or {} clears it.
	readingFormats: (v) => {
		if (v === null || (isObject(v) && Object.keys(v).length === 0)) return { ok: true, value: undefined };
		if (!exactReadingFormats(v)) return { ok: false };
		const parsed = stripReadingFormatsOf(v);
		return parsed === undefined ? { ok: false } : { ok: true, value: stripReadingFormatsToJson(parsed) };
	}
};

function boolOnly(v: unknown): { ok: true; value: unknown } | { ok: false } {
	return typeof v === "boolean" ? { ok: true, value: v } : { ok: false };
}

/** A string field where "" clears it back to the deck default. */
function clearable(v: unknown, valid: (s: string) => boolean): { ok: true; value: unknown } | { ok: false } {
	if (v === "") return { ok: true, value: undefined };
	return typeof v === "string" && valid(v) ? { ok: true, value: v } : { ok: false };
}

/** True when `entry` is exactly one series as stored: known fields only,
 * each valid. A field the parser would drop makes the whole edit invalid. */
function exactSeries(entry: unknown): boolean {
	if (!isObject(entry) || Object.keys(entry).some((k) => k !== "key" && k !== "name" && k !== "color")) return false;
	const parsed = stripSeriesOf(entry);
	if (parsed === undefined || parsed.key.length > MAX_KEY_LENGTH) return false;
	if ("name" in entry && (parsed.name === undefined || parsed.name.length > MAX_NAME_LENGTH)) return false;
	return !("color" in entry) || parsed.color !== undefined;
}

/** A display-unit stamp as an edit sends it (src/strip/settings.ts
 * StripScale.displayUnit): a unit of at most STAMP_UNIT_MAX characters ("":
 * a reading with no unit) and a record whose own values are strings of at
 * most STAMP_TEXT_MAX. Whether it counts is the parser's to say. */
function exactStamp(entry: Record<string, unknown>): boolean {
	if ("displayUnit" in entry && (typeof entry.displayUnit !== "string" || entry.displayUnit.length > STAMP_UNIT_MAX)) return false;
	if ("displayUnitFor" in entry && !exactStampRecord(entry.displayUnitFor)) return false;
	return true;
}

function exactStampRecord(value: unknown): boolean {
	return isObject(value) && Object.values(value).every((v) => typeof v === "string" && v.length <= STAMP_TEXT_MAX);
}

function exactBand(entry: unknown): boolean {
	if (!isObject(entry) || Object.keys(entry).some((k) => !["key", "warn", "crit", "below", "unit", "displayUnit", "displayUnitFor"].includes(k))) return false;
	const parsed = stripBandOf(entry);
	if (parsed === undefined) return false;
	if ("warn" in entry && parsed.warn === undefined) return false;
	if ("crit" in entry && parsed.crit === undefined) return false;
	if ("below" in entry && typeof entry.below !== "boolean") return false;
	if (!exactStamp(entry)) return false;
	return !("unit" in entry) || parsed.unit !== undefined;
}

/** True when `value` is exactly one Group rule as stored: known fields
 * only, each valid (a filter the detail grammar keeps, at most
 * GROUP_KEYS_MAX distinct keys, a known source and view, limits with a
 * number). A field the parser would drop or change refuses the edit. */
function exactGroupRule(value: unknown): boolean {
	if (!isObject(value) || Object.keys(value).some((k) => !["from", "filter", "unit", "keys", "view", "limits"].includes(k))) return false;
	if (!(GROUP_SOURCES as readonly unknown[]).includes(value.from)) return false;
	if (!(GROUP_VIEWS as readonly unknown[]).includes(value.view)) return false;
	if ("filter" in value && (typeof value.filter !== "string" || value.filter.length > DETAIL_FILTER_MAX || detailFilterOf({ detailFilter: value.filter }) !== value.filter)) return false;
	// A Unit rule's unit: a non-empty native unit, as HWiNFO spells it.
	if ("unit" in value && (value.from !== "unit" || typeof value.unit !== "string" || value.unit === "" || value.unit.length > MAX_UNIT_LENGTH)) return false;
	const keys = value.keys;
	if (!Array.isArray(keys) || keys.length > GROUP_KEYS_MAX || !keys.every((k) => typeof k === "string" && k !== "" && k.length <= MAX_KEY_LENGTH) || new Set(keys).size !== keys.length) return false;
	if ("limits" in value) {
		const limits = value.limits;
		if (!isObject(limits) || Object.keys(limits).some((k) => !["warn", "crit", "below", "unit", "displayUnit", "displayUnitFor"].includes(k))) return false;
		const parsed = groupLimitsOf(limits);
		if (parsed === undefined) return false;
		if ("warn" in limits && parsed.warn === undefined) return false;
		if ("crit" in limits && parsed.crit === undefined) return false;
		if ("below" in limits && typeof limits.below !== "boolean") return false;
		if ("unit" in limits && parsed.unit === undefined) return false;
		if (!exactStamp(limits)) return false;
	}
	return true;
}

/** Validates one operation against the whitelist; undefined when refused. */
function applierOf(op: unknown, deviceEncoders: StripEncoders | undefined): Applier | undefined {
	if (!isObject(op)) return undefined;
	if (op.op !== "set") return screenOpOf(op);
	if (typeof op.path !== "string") return undefined;
	const value = op.value;
	const parts = op.path.split(".");
	if (parts.length === 1) {
		const name = parts[0] as string;
		if (name === "encoders") {
			// Re-target a mismatched group to the deck it is on; only that value.
			if (!isStripEncoders(value) || value !== deviceEncoders) return undefined;
			return (d) => {
				d.encoders = value;
			};
		}
		if (name === "gapMode") {
			// "connect" removes the field: a strip without it connects.
			if (value !== "connect" && stripGapModeOf(value) === undefined) return undefined;
			return (d) => {
				if (value === "connect") delete d.gapMode;
				else d.gapMode = value;
			};
		}
		if (name === "screenCycle") {
			// Exact seconds only; 0 or null goes back to by hand.
			if (value !== 0 && value !== null && screenCycleOf(value) === undefined) return undefined;
			return (d) => {
				if (value === 0 || value === null) delete d.screenCycle;
				else d.screenCycle = value;
			};
		}
		const check = Object.hasOwn(TOP_FIELDS, name) ? TOP_FIELDS[name] : undefined;
		const result = check?.(value);
		if (result === undefined || !result.ok) return undefined;
		return (d) => {
			if (result.value === undefined) delete d[name];
			else d[name] = result.value;
		};
	}
	// A pane (panes.0, panes.1) or one of the screens after the first
	// (screens.0 to screens.6), which take exactly the panes.0 appliers.
	const screen = parts[0] === "screens" && /^[0-6]$/.test(parts[1] ?? "");
	if (!screen && (parts[0] !== "panes" || (parts[1] !== "0" && parts[1] !== "1"))) return undefined;
	const index = Number(parts[1]);
	const field = parts[2];
	const target = (d: Draft): Record<string, unknown> | undefined => (screen ? (Array.isArray(d.screens) ? d.screens[index] : undefined) : d.panes[index]);
	const missing = `${parts[0]}.${index}: no such screen`;
	// This pane is being edited: a cut look's becomes what it reads as.
	const pane = (d: Draft): Record<string, unknown> => {
		const stored = target(d) as Record<string, unknown>;
		settleCutStyle(stored);
		return stored;
	};
	const inner = applierOfPane(parts, field, value, pane, screen || index === 0);
	if (inner === undefined) return undefined;
	return (d) => (target(d) === undefined ? missing : inner(d));
}

/** The appliers of one pane's fields. `named` is true where a screen's
 * name may be set (panes.0 and the screens after it). */
function applierOfPane(parts: readonly string[], field: string | undefined, value: unknown, pane: (d: Draft) => Record<string, unknown>, named: boolean): Applier | undefined {
	if (parts.length === 3) {
		switch (field) {
			case "name": {
				// A screen's name, trimmed; "" goes back to the automatic name.
				if (!named || typeof value !== "string" || value.trim().length > MAX_NAME_LENGTH) return undefined;
				const name = value.trim();
				return (d) => {
					if (name === "") delete pane(d).name;
					else pane(d).name = name;
				};
			}
			case "origin": {
				// What made the screen (Build screens for this PC); "" clears it.
				if (!named || typeof value !== "string" || (value !== "" && !SCREEN_ORIGIN_PATTERN.test(value))) return undefined;
				return (d) => {
					if (value === "") delete pane(d).origin;
					else pane(d).origin = value;
				};
			}
			case "style":
				if (!isStripStyle(value)) return undefined;
				return (d) => {
					pane(d).style = value;
				};
			case "readout":
				// "off" removes the field: a pane without it draws as before.
				if (value !== "off" && stripReadoutOf(value) === undefined) return undefined;
				return (d) => {
					if (value === "off") delete pane(d).readout;
					else pane(d).readout = value;
				};
			case "meterLook":
				// "thin" removes the field: a Meters pane without it draws Thin bar.
				if (value !== "thin" && stripMeterLookOf(value) === undefined) return undefined;
				return (d) => {
					if (value === "thin") delete pane(d).meterLook;
					else pane(d).meterLook = value;
				};
			case "window":
				if (value !== null && parseHistoryWindow(value) === undefined) return undefined;
				return (d) => {
					if (value === null) delete pane(d).window;
					else pane(d).window = value;
				};
			case "series": {
				if (!Array.isArray(value) || value.length > MAX_SERIES || !value.every(exactSeries)) return undefined;
				const keys = value.map((s) => (s as { key: string }).key);
				if (new Set(keys).size !== keys.length) return undefined;
				const copy = JSON.parse(JSON.stringify(value)) as unknown[];
				// Readings chosen here: the pane is no longer the strip's
				// untouched start.
				return (d) => {
					pane(d).series = copy;
					delete pane(d).seed;
				};
			}
			case "bands": {
				if (!Array.isArray(value) || value.length > MAX_BANDS || !value.every(exactBand)) return undefined;
				// Each band as stored, its stamp's record written from the numbers
				// it keeps (a stamp that does not count for them is dropped).
				const copy = value.map((b) => stripBandToJson(stripBandOf(b) as StripBandV1));
				return (d) => {
					pane(d).bands = copy;
				};
			}
			case "group": {
				// The whole rule at once, exactly as stored; null removes it.
				if (value === null) {
					return (d) => {
						delete pane(d).group;
					};
				}
				if (!exactGroupRule(value)) return undefined;
				const rule = stripGroupRuleOf(value) as StripGroupRule;
				return (d) => {
					pane(d).group = stripGroupRuleToJson(rule, pane(d).group);
				};
			}
			default:
				return undefined;
		}
	}
	if (parts.length === 4 && field === "overlays") {
		const name = parts[3] as string;
		if ((!(OVERLAY_NAMES as readonly string[]).includes(name) && name !== AXES_OVERLAY) || typeof value !== "boolean") return undefined;
		return (d) => {
			const overlays = isObject(pane(d).overlays) ? (pane(d).overlays as Record<string, unknown>) : {};
			pane(d).overlays = { ...overlays, [name]: value };
		};
	}
	if (parts.length === 4 && field === "scale" && (parts[3] === "min" || parts[3] === "max")) {
		const end = parts[3];
		const clear = value === null || value === "";
		const number = clear ? undefined : parseThreshold(value);
		if (!clear && number === undefined) return undefined;
		return (d) => {
			const scale = isObject(pane(d).scale) ? { ...(pane(d).scale as Record<string, unknown>) } : {};
			if (number === undefined) delete scale[end];
			else scale[end] = number;
			pane(d).scale = scale;
		};
	}
	// The scale's unit stamp: the unit on view when the ends were typed ("":
	// a reading with no unit), and the record of the numbers it covers.
	// Null clears either.
	if (parts.length === 4 && field === "scale" && parts[3] === "displayUnit") {
		const clear = value === null;
		if (!clear && (typeof value !== "string" || value.length > STAMP_UNIT_MAX)) return undefined;
		return (d) => {
			const scale = isObject(pane(d).scale) ? { ...(pane(d).scale as Record<string, unknown>) } : {};
			if (clear) delete scale.displayUnit;
			else scale.displayUnit = value;
			pane(d).scale = scale;
		};
	}
	if (parts.length === 4 && field === "scale" && parts[3] === "displayUnitFor") {
		const clear = value === null;
		if (!clear && !exactStampRecord(value)) return undefined;
		const record = clear ? undefined : (JSON.parse(JSON.stringify(value)) as Record<string, unknown>);
		return (d) => {
			const scale = isObject(pane(d).scale) ? { ...(pane(d).scale as Record<string, unknown>) } : {};
			if (record === undefined) delete scale.displayUnitFor;
			else scale.displayUnitFor = record;
			pane(d).scale = scale;
		};
	}
	return undefined;
}

/** The draft's own consistency, after every operation applied: every band
 * names a reading of its pane, and a manual range is a range. A pane may
 * hold more readings than its style draws (up to MAX_SERIES): the extra
 * ones are kept and not drawn, so a style switch never loses a reading. */
function draftProblem(draft: Draft): string | undefined {
	const screens = Array.isArray(draft.screens) ? draft.screens : [];
	const panes: [string, Record<string, unknown>][] = [...draft.panes.map((pane, i): [string, Record<string, unknown>] => [`panes.${i}`, pane]), ...screens.map((pane, i): [string, Record<string, unknown>] => [`screens.${i}`, pane])];
	for (const [path, pane] of panes) {
		if (!isObject(pane)) return `${path}: not a screen`;
		const series = Array.isArray(pane.series) ? pane.series : [];
		const keys = new Set(series.map((s) => (isObject(s) ? s.key : undefined)));
		const bands = Array.isArray(pane.bands) ? pane.bands : [];
		if (bands.some((b) => !isObject(b) || !keys.has(b.key))) return `${path}.bands: every band must name a reading of its pane`;
		const scale = isObject(pane.scale) ? pane.scale : {};
		const min = parseThreshold(scale.min);
		const max = parseThreshold(scale.max);
		if (min !== undefined && max !== undefined && !(min < max)) return `${path}.scale: min must be below max`;
	}
	// The screens: at most MAX_SCREENS, each id valid and used once.
	if (1 + screens.length > MAX_SCREENS) return `a strip keeps at most ${MAX_SCREENS} screens`;
	if (screens.length > 0) {
		const ids = [draft.panes[0], ...screens].map((pane) => pane?.screenId);
		if (!ids.every((id) => typeof id === "string" && SCREEN_ID_PATTERN.test(id)) || new Set(ids).size !== ids.length) return "screens: every screen needs its own id";
	}
	return undefined;
}

/**
 * Applies a settings panel's patch to the group's authority. Stale bases are
 * refused with the current config; a single invalid operation refuses the
 * whole patch. Success is a complete copy at rev + 1.
 *
 * Operations. `set` writes one whitelisted path:
 *   top-level fields, `panes.<0|1>.<field>`, `screens.<n>.<field>` (n 0
 *   to 6: the screens after the first, with exactly the panes.0 appliers),
 *   `panes.0.name` / `screens.<n>.name` ("" clears), the same paths'
 *   `origin` (what made the screen, SCREEN_ORIGIN_PATTERN; "" clears),
 *   and `screenCycle`
 *   (10, 30, 60 or 300 seconds; 0 or null clears).
 * The structural ops work on the list of screens [panes[0], ...screens]:
 *   addScreen    insert at `at` (0 to the count): a Group screen of a
 *                filter rule with no filter yet ("group", the default), or
 *                a copy of the screen before `at` ("copy": every stored
 *                field, a new id, no name, no origin, no seed);
 *   removeScreen remove the screen at `at` (never the last one);
 *   moveScreen   move the screen at `from` to `to`.
 * Removing or moving the first screen promotes the next into panes[0],
 * with its id. Whenever the strip has two or more screens after a patch,
 * every screen without an id gets a fresh one.
 */
export function applyStripEdit(base: EditBase | null, baseRev: unknown, patch: unknown, options: { readonly deviceEncoders?: StripEncoders; readonly mintScreenId?: () => string; readonly looksGen?: number } = {}): StripEditResult {
	if (base === null) return { ok: false, reason: "no-group", rev: 0, config: null };
	const refuse = (reason: StripEditReason, detail?: string): StripEditResult => ({ ok: false, reason, rev: base.rev, config: base.config, ...(detail === undefined ? {} : { detail }) });
	if (baseRev !== base.rev) return refuse("stale");
	if (!Array.isArray(patch) || patch.length === 0 || patch.length > MAX_EDIT_OPS) return refuse("invalid", `a patch holds 1 to ${MAX_EDIT_OPS} operations`);
	const appliers: Applier[] = [];
	for (const [i, op] of patch.entries()) {
		const applier = applierOf(op, options.deviceEncoders);
		if (applier === undefined) return refuse("invalid", `operation ${i} is not an allowed change`);
		appliers.push(applier);
	}
	const draft = stripConfigToJson(base.config) as Draft;
	// Each screen's key before, on the draft object the operations move.
	const keysBefore = screenKeysOf(base.config);
	const keyOf = new Map(screenList(draft).map((screen, i) => [screen, keysBefore[i] as string]));
	for (const [i, apply] of appliers.entries()) {
		const failed = apply(draft);
		if (failed !== undefined) return refuse("invalid", `operation ${i}: ${failed}`);
	}
	// A Background or Words picked for the strip after a "Use it
	// everywhere" carries that generation, so the reset never drops it
	// (src/ui/shared-looks.ts).
	if ((options.looksGen ?? 0) > 0 && patch.some((op) => isObject(op) && op.op === "set" && (op.path === "background" || op.path === "accentWords" || op.path === "stars" || op.path === "skyColor") && op.value !== "" && op.value !== null)) draft.looksGen = options.looksGen;
	mintScreenIds(draft, options.mintScreenId ?? mintScreenId);
	const problem = draftProblem(draft);
	if (problem !== undefined) return refuse("invalid", problem);
	const config = stripConfigOf(draft);
	if (options.deviceEncoders !== undefined && config.encoders !== options.deviceEncoders) return refuse("mismatch");
	const keysAfter = screenKeysOf(config);
	const screenKeys = new Map<string, string>();
	screenList(draft).forEach((screen, i) => {
		const before = keyOf.get(screen);
		if (before !== undefined) screenKeys.set(before, keysAfter[i] as string);
	});
	return { ok: true, copy: { v: 1, id: base.id, rev: base.rev + 1, joined: true, config }, screenKeys };
}

// ---- planners: exact per-context documents ---------------------------------

export type SettingsDoc = Readonly<Record<string, unknown>>;
export type MemberDoc = { readonly context: string; readonly settings: SettingsDoc };
export type PlannedWrite = { readonly context: string; readonly settings: Record<string, unknown> };

/** The member's whole document with stripGroup replaced by `copy`. Unknown
 * fields of the copy it replaces are kept when it is the same group. */
export function withStripGroup(settings: SettingsDoc, copy: StripGroupCopy): Record<string, unknown> {
	const before = stripGroupOf(settings.stripGroup);
	const preserve = before?.id === copy.id ? settings.stripGroup : undefined;
	return { ...settings, stripGroup: stripGroupToJson(copy, preserve) };
}

/** The member's whole document without stripGroup (it never had one before a
 * pasted copy arrived). */
export function withoutStripGroup(settings: SettingsDoc): Record<string, unknown> {
	const next: Record<string, unknown> = { ...settings };
	delete next.stripGroup;
	return next;
}

function writesOf(members: readonly MemberDoc[], copy: StripGroupCopy): PlannedWrite[] {
	const seen = new Set<string>();
	const out: PlannedWrite[] = [];
	for (const m of members) {
		if (seen.has(m.context)) continue;
		seen.add(m.context);
		out.push({ context: m.context, settings: withStripGroup(m.settings, copy) });
	}
	return out;
}

/** After a successful applyStripEdit: the new copy for every visible joined
 * member, written in one synchronous loop by the caller. */
export function planEditWrites(copy: StripGroupCopy, joined: readonly MemberDoc[]): PlannedWrite[] {
	return writesOf(joined, copy);
}

export type CreatePlan = { readonly ok: true; readonly copy: StripGroupCopy; readonly writes: PlannedWrite[] } | { readonly ok: false; readonly reason: "invalid"; readonly detail: string };

/**
 * A new group at rev 1 over the chosen visible Sensor Dials. The look is
 * copied once from the creating dial (`seedFrom`); an optional patch sets
 * readings and styles in the same deliberate step.
 */
export function planCreate(params: { readonly id: string; readonly layout: StripLayout; readonly encoders: StripEncoders; readonly seedFrom: SettingsDoc; readonly members: readonly MemberDoc[]; readonly patch?: unknown; readonly looksGen?: number }): CreatePlan {
	if (params.members.length === 0) return { ok: false, reason: "invalid", detail: "no dials chosen" };
	if (!isStripLayout(params.layout) || !isStripEncoders(params.encoders)) return { ok: false, reason: "invalid", detail: "layout or encoders" };
	let config = newStripConfig(params.layout, params.encoders, stripSeedOf(params.seedFrom));
	if (params.patch !== undefined) {
		const edited = applyStripEdit({ id: params.id, rev: 0, config }, 0, params.patch, { deviceEncoders: params.encoders, ...(params.looksGen === undefined ? {} : { looksGen: params.looksGen }) });
		if (!edited.ok) return { ok: false, reason: "invalid", detail: edited.detail ?? edited.reason };
		config = edited.copy.config;
	}
	const copy: StripGroupCopy = { v: 1, id: params.id, rev: 1, joined: true, config };
	return { ok: true, copy, writes: writesOf(params.members, copy) };
}

/**
 * The newest copy of group `id` among the live authority and the copies
 * the given dials hold, when one of those copies is newer than the
 * authority (a dial that was off screen during an edit, or a strip left
 * while one of its dials was hidden). Undefined when the authority is the
 * newest, or when no dial holds a newer copy.
 */
function newerCopyOf(id: string, authority: EditBase | null, docs: readonly MemberDoc[]): StripGroupCopy | undefined {
	let newest: StripGroupCopy | undefined;
	for (const m of docs) {
		const copy = stripGroupOf(m.settings.stripGroup);
		if (copy === undefined || copy.id !== id) continue;
		if (newest === undefined || copy.rev > newest.rev) newest = copy;
	}
	if (newest === undefined || authority === null || authority.id !== id) return undefined;
	return newest.rev > authority.rev ? newest : undefined;
}

/** A newer copy than the live authority becomes the group's setup at a
 * revision above both, so the revision only moves up, written to every
 * visible joined member and every dial the request takes. */
function promoted(authority: EditBase, newer: StripGroupCopy, joined: readonly MemberDoc[], taking: readonly MemberDoc[]): { readonly copy: StripGroupCopy; readonly writes: PlannedWrite[] } {
	const copy: StripGroupCopy = { v: 1, id: authority.id, rev: Math.max(authority.rev, newer.rev) + 1, joined: true, config: newer.config };
	return { copy, writes: writesOf([...joined, ...taking], copy) };
}

/** Members join the group as it is now: the authority copy, joined. The
 * revision does not move; nothing about the group changed. A joining dial
 * that holds a newer copy of the same group brings that setup back
 * instead, at a revision above both (`joined` is then written too). */
export function planJoin(authority: EditBase, members: readonly MemberDoc[], joined: readonly MemberDoc[] = []): { readonly copy: StripGroupCopy; readonly writes: PlannedWrite[] } {
	const newer = newerCopyOf(authority.id, authority, members);
	if (newer !== undefined) return promoted(authority, newer, joined, members);
	const copy: StripGroupCopy = { v: 1, id: authority.id, rev: authority.rev, joined: true, config: authority.config };
	return { copy, writes: writesOf(members, copy) };
}

/** Members leave: each keeps the group's current copy as a dormant copy
 * (joined false) for Restore, and draws its own individual face again. */
export function planLeave(authority: EditBase, members: readonly MemberDoc[]): PlannedWrite[] {
	return writesOf(members, { v: 1, id: authority.id, rev: authority.rev, joined: false, config: authority.config });
}

/**
 * Members with a dormant copy of group `id` rejoin, with the newest setup
 * known among the live authority and the dormant copies of `candidates`
 * (every visible dial that left the strip, whether it rejoins now or not;
 * the members by default). The revision never goes down: with a live
 * authority that is the newest they take it as it is; when a dormant copy
 * is newer than the live authority, that setup comes back at a revision
 * above both, written to the visible joined members (`joined`) as well.
 * With no live authority the newest dormant copy comes back at its own
 * revision, the highest any of them holds: a dial that left first and
 * rejoins alone takes the setup the others left with, not its own older
 * one. Only the members are written, plus `joined` on a promotion.
 */
export function planRestore(
	id: string,
	authority: EditBase | null,
	members: readonly MemberDoc[],
	joined: readonly MemberDoc[] = [],
	candidates: readonly MemberDoc[] = members
): { readonly copy: StripGroupCopy; readonly writes: PlannedWrite[] } | undefined {
	const isDormant = (m: MemberDoc): boolean => {
		const copy = stripGroupOf(m.settings.stripGroup);
		return copy !== undefined && copy.id === id && !copy.joined;
	};
	const dormant = members.filter(isDormant);
	if (dormant.length === 0) return undefined;
	// The members first, so a tie at the top revision keeps their own copy.
	const known = [...dormant, ...candidates.filter(isDormant)];
	if (authority !== null && authority.id === id) {
		const newer = newerCopyOf(id, authority, known);
		if (newer !== undefined) return promoted(authority, newer, joined, dormant);
		const copy: StripGroupCopy = { v: 1, id, rev: authority.rev, joined: true, config: authority.config };
		return { copy, writes: writesOf(dormant, copy) };
	}
	const copies = known.map((m) => stripGroupOf(m.settings.stripGroup) as StripGroupCopy).sort((a, b) => b.rev - a.rev);
	const newest = copies[0] as StripGroupCopy;
	const copy: StripGroupCopy = { ...newest, joined: true };
	return { copy, writes: writesOf(dormant, copy) };
}

/**
 * Settles a foreign copy on one dial.
 * - "group": the dial goes back to what the plugin knew for it (the group's
 *   current copy when it was a joined member, else its prior copy, else no
 *   stripGroup at all).
 * - "thisDial": the dial's copy becomes the group's new authority at a
 *   revision above both, written to every visible joined member and the dial.
 */
export function planResolve(params: {
	readonly use: "group" | "thisDial";
	readonly dial: MemberDoc;
	readonly prior: StripGroupCopy | undefined;
	readonly foreign: StripGroupCopy;
	readonly authority: EditBase | null;
	readonly joined: readonly MemberDoc[];
}): { readonly copy: StripGroupCopy | undefined; readonly writes: PlannedWrite[] } {
	const { prior, foreign, authority } = params;
	// The choice is made: the pasted copy kept apart goes.
	const settled: Record<string, unknown> = { ...params.dial.settings };
	delete settled[STRIP_PASTED_FIELD];
	const dial: MemberDoc = { context: params.dial.context, settings: settled };
	if (params.use === "group") {
		if (prior === undefined) return { copy: undefined, writes: [{ context: dial.context, settings: withoutStripGroup(dial.settings) }] };
		const copy: StripGroupCopy = prior.joined && authority !== null && authority.id === prior.id ? { v: 1, id: authority.id, rev: authority.rev, joined: true, config: authority.config } : prior;
		return { copy, writes: writesOf([dial], copy) };
	}
	const id = prior?.id ?? foreign.id;
	const rev = Math.max(authority !== null && authority.id === id ? authority.rev : 0, prior?.rev ?? 0, foreign.rev) + 1;
	const copy: StripGroupCopy = { v: 1, id, rev, joined: true, config: foreign.config };
	return { copy, writes: writesOf([...params.joined, dial], copy) };
}

/** "Make independent of copies": the visible joined members get a new group
 * id, so copies of this profile elsewhere no longer share its identity. */
export function planReid(authority: EditBase, newId: string, joined: readonly MemberDoc[]): { readonly copy: StripGroupCopy; readonly writes: PlannedWrite[] } {
	const copy: StripGroupCopy = { v: 1, id: newId, rev: 1, joined: true, config: authority.config };
	return { copy, writes: writesOf(joined, copy) };
}

/**
 * "Use it everywhere" on a strip (src/ui/shared-looks.ts): the group's
 * Background and Words go back to Default at rev + 1, one edit written to
 * every visible joined member once. `own` takes the member's document
 * before its stripGroup is replaced (the dial's own stale looks dropped in
 * the same write) and returns it unchanged when it has none. This is the
 * one planner that may touch a dial's individual fields: only those two,
 * plus looksGen on that write.
 */
export function planLooksReset(authority: EditBase, joined: readonly MemberDoc[], own: (settings: SettingsDoc) => SettingsDoc = (s) => s): { readonly copy: StripGroupCopy; readonly writes: PlannedWrite[] } {
	const copy: StripGroupCopy = { v: 1, id: authority.id, rev: authority.rev + 1, joined: true, config: withDefaultLooks(authority.config) };
	return { copy, writes: writesOf(joined.map((m) => ({ context: m.context, settings: own(m.settings) })), copy) };
}
