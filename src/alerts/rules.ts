/**
 * Alert rules: what limits apply to one reading, and the number they are
 * compared against. Pure; nothing here writes settings.
 *
 * Saved settings keep their 1.7.1 meaning. The legacy pair (warnValue,
 * critValue, alertBelow, plus the dial's alertUnit) stays in charge wherever
 * no per-reading rule exists: on a key it covers the first reading only, in
 * the displayed unit; on a dial it covers every reading thresholdsApplyTo
 * admits. A per-reading rule in `alertRules` is filed under a stable reading
 * key and carries the display unit the settings panel captured when it was
 * saved, so a later unit change stands the rule down instead of silently
 * reinterpreting its numbers.
 */
import type { Reading } from "../hwinfo/types";
import { convertUnit, parseThreshold, thresholdsApplyTo, valueBetweenUnits } from "../ui/format";

/** The most per-reading rules one action keeps; further entries are ignored. */
export const ALERT_RULES_CAP = 128;

/** "Alert after" choices, exact strings only. Anything else is 0. */
export const ALERT_DWELL_CHOICES: readonly string[] = ["0", "2000", "5000", "10000", "30000"];
/** Snooze durations, exact strings only. Anything else is off. */
export const ALERT_SNOOZE_CHOICES: readonly string[] = ["300000", "900000", "3600000"];
/** The snooze length a dial gesture or Control command uses when the action
 * has no saved duration. */
export const DEFAULT_COMMAND_SNOOZE_MS = 900_000;

/**
 * The alert fields of a key's or a dial's settings, as untyped JSON: any
 * settings object is accepted and every field is salvaged.
 */
export type AlertSettings = {
	readonly warnValue?: unknown;
	readonly critValue?: unknown;
	readonly alertBelow?: unknown;
	/** Dial only: the unit the legacy pair is scoped to (plugin-stamped). */
	readonly alertUnit?: unknown;
	readonly alertRules?: unknown;
	readonly alertDwellMs?: unknown;
	readonly alertHysteresis?: unknown;
	readonly alertDisplayUnit?: unknown;
	/** The exact Warn at, Critical at and Clear after text alertDisplayUnit
	 * was saved with ({ warn, crit, hyst }, absent fields omitted): see
	 * {@link stampedDisplayUnit}. */
	readonly alertDisplayUnitFor?: unknown;
	readonly alertSnoozeMs?: unknown;
};

/** One salvaged `alertRules` entry. */
export interface ParsedAlertRule {
	readonly warn?: number;
	readonly crit?: number;
	readonly below: boolean;
	/** The captured display unit; "" is a real unitless capture. Absent means
	 * the unit was never captured and the rule waits (it never alerts). */
	readonly unit?: string;
	/** Recovery band in the rule's unit, >= 0. */
	readonly hyst: number;
	/** Fields that hold something other than a number or a blank. */
	readonly junk: readonly AlertField[];
	/** The recovery band was a number below zero (counted as 0). */
	readonly negativeHyst: boolean;
}

export type AlertField = "warn" | "crit" | "hyst";

/** The legacy pair, salvaged exactly as 1.7.1 reads it. */
export interface LegacyAlertPair {
	readonly warn?: number;
	readonly crit?: number;
	readonly below: boolean;
	readonly hyst: number;
	/** The displayed unit the numbers were typed in, when the panel stamped it. */
	readonly displayUnit?: string;
	/** The raw dial alertUnit, compared as thresholdsApplyTo compares it. */
	readonly scope: unknown;
	readonly junk: readonly AlertField[];
	readonly negativeHyst: boolean;
}

/** Everything alert-related an action's settings say, parsed once per
 * settings change. */
export interface AlertConfig {
	readonly rules: ReadonlyMap<string, ParsedAlertRule>;
	readonly legacy: LegacyAlertPair;
	readonly dwellMs: number;
	/** null when presses never snooze. */
	readonly snoozeMs: number | null;
}

/** How a resolved rule's numbers relate to the reading's units. */
export type RuleUnit =
	/** The legacy pair: the displayed value, as 1.7.1 compares it, unless the
	 * panel stamped the displayed unit and it differs only by °C/°F. */
	| { readonly kind: "legacy"; readonly displayUnit?: string }
	/** A per-reading rule with the unit captured at save. */
	| { readonly kind: "captured"; readonly unit: string }
	/** A per-reading rule saved before its reading reported a unit. */
	| { readonly kind: "uncaptured" };

/** The limits that apply to one reading. */
export interface ResolvedRule {
	readonly source: "reading" | "legacy";
	/** The `alertRules` key a reading rule is filed under. */
	readonly ruleKey?: string;
	readonly warn?: number;
	readonly crit?: number;
	readonly below: boolean;
	readonly unit: RuleUnit;
	readonly hyst: number;
}

/** A reading as alert resolution sees it. */
export type AlertReading = Pick<Reading, "key" | "linkedKeys" | "unit" | "value">;

function isObject(raw: unknown): raw is Record<string, unknown> {
	return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function ownField(record: Record<string, unknown>, name: string): unknown {
	return Object.hasOwn(record, name) ? record[name] : undefined;
}

/** Present, not blank, and not a number: the value the user sees as typed
 * but the runtime cannot use. */
function isJunk(raw: unknown, parsed: number | undefined): boolean {
	if (parsed !== undefined || raw === undefined || raw === null) return false;
	return !(typeof raw === "string" && raw.trim() === "");
}

function parseBand(raw: unknown): { hyst: number; junk: boolean; negative: boolean } {
	const parsed = parseThreshold(raw);
	if (parsed === undefined) return { hyst: 0, junk: isJunk(raw, parsed), negative: false };
	return parsed < 0 ? { hyst: 0, junk: false, negative: true } : { hyst: parsed, junk: false, negative: false };
}

/** A recovery band field: a number >= 0, else 0. */
export function parseHysteresis(raw: unknown): number {
	return parseBand(raw).hyst;
}

/** "Alert after" in milliseconds; anything but an exact choice is 0. */
export function parseAlertDwellMs(raw: unknown): number {
	return typeof raw === "string" && ALERT_DWELL_CHOICES.includes(raw) ? Number(raw) : 0;
}

/** Snooze length in milliseconds, or null (off) for anything but an exact
 * choice. */
export function parseAlertSnoozeMs(raw: unknown): number | null {
	return typeof raw === "string" && ALERT_SNOOZE_CHOICES.includes(raw) ? Number(raw) : null;
}

function parseRuleEntry(raw: Record<string, unknown>): ParsedAlertRule {
	const warnRaw = ownField(raw, "warn");
	const critRaw = ownField(raw, "crit");
	const warn = parseThreshold(warnRaw);
	const crit = parseThreshold(critRaw);
	const band = parseBand(ownField(raw, "hyst"));
	const unit = ownField(raw, "unit");
	const junk: AlertField[] = [];
	if (isJunk(warnRaw, warn)) junk.push("warn");
	if (isJunk(critRaw, crit)) junk.push("crit");
	if (band.junk) junk.push("hyst");
	return {
		...(warn !== undefined ? { warn } : {}),
		...(crit !== undefined ? { crit } : {}),
		below: ownField(raw, "below") === true,
		...(typeof unit === "string" ? { unit } : {}),
		hyst: band.hyst,
		junk,
		negativeHyst: band.negative
	};
}

/**
 * Salvages `alertRules` entry by entry: only a plain (non-array) object
 * counts, only its own keys are read (so "__proto__" is an ordinary reading
 * key), entries that are not objects are dropped, and at most
 * ALERT_RULES_CAP entries are kept. Never throws, never writes back.
 */
export function parseAlertRules(raw: unknown): ReadonlyMap<string, ParsedAlertRule> {
	const rules = new Map<string, ParsedAlertRule>();
	if (!isObject(raw)) return rules;
	for (const key of Object.keys(raw)) {
		if (rules.size >= ALERT_RULES_CAP) break;
		const entry = raw[key];
		if (!isObject(entry)) continue;
		rules.set(key, parseRuleEntry(entry));
	}
	return rules;
}

/** The legacy fields a display-unit stamp covers, with the name each takes
 * in alertDisplayUnitFor. */
export const ALERT_STAMP_FIELDS = [
	["warnValue", "warn"],
	["critValue", "crit"],
	["alertHysteresis", "hyst"]
] as const;

/** A stored limit as the text a stamp records: a string as it is, a finite
 * number as its decimal spelling, anything else as absent. */
function stampText(raw: unknown): string | undefined {
	if (typeof raw === "string") return raw;
	return typeof raw === "number" && Number.isFinite(raw) ? String(raw) : undefined;
}

/**
 * The unit Warn at, Critical at and Clear after were typed in, when the
 * stamp still covers the numbers stored: alertDisplayUnit counts only while
 * alertDisplayUnitFor records exactly the text those three fields hold. A
 * version that does not know the stamp (1.7.1) keeps both fields through
 * its whole-document saves while the person retypes the numbers in the unit
 * on the face, so a stamp whose record no longer matches is ignored and the
 * pair compares as displayed, exactly as 1.7.1 did. A stamp without a
 * record proves nothing either. Undefined when no stamp counts.
 */
export function stampedDisplayUnit(settings: AlertSettings): string | undefined {
	const fields = settings as Record<string, unknown>;
	return stampCounts(
		settings.alertDisplayUnit,
		settings.alertDisplayUnitFor,
		ALERT_STAMP_FIELDS.map(([field, name]) => [name, ownField(fields, field)] as const)
	);
}

/**
 * The one display-unit stamp grammar, for keys, dials and strip scales,
 * bands and Group limits: `unit` counts only while `record` (an object)
 * holds, under each name, exactly the text of the number stored for it
 * (absent where none is stored). A stamp without a record, or whose record
 * no longer matches (a version that does not know the stamp rewrote a
 * number in the unit on its face), proves nothing. Undefined when it does
 * not count.
 */
export function stampCounts(unit: unknown, record: unknown, numbers: readonly (readonly [string, unknown])[]): string | undefined {
	if (typeof unit !== "string" || !isObject(record)) return undefined;
	for (const [name, stored] of numbers) {
		const recorded = ownField(record, name);
		if (recorded !== undefined && typeof recorded !== "string") return undefined;
		if (stampText(stored) !== recorded) return undefined;
	}
	return unit;
}

/** The record a stamp writes beside numbers: each one's text, by name. */
export function stampRecordOf(numbers: readonly (readonly [string, number | undefined])[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, n] of numbers) {
		const text = stampText(n);
		if (text !== undefined) out[name] = text;
	}
	return out;
}

/**
 * The stamp for a copy that carries Warn at and Critical at but not Clear
 * after (the detail view's Back tile): the unit when it counts for
 * `settings`, with a record of those two fields alone, so it counts for
 * the copy too; nothing when it does not count.
 */
export function stampForLimitsCopy(settings: AlertSettings): { readonly alertDisplayUnit: string; readonly alertDisplayUnitFor: Readonly<Record<string, string>> } | undefined {
	const unit = stampedDisplayUnit(settings);
	if (unit === undefined) return undefined;
	const warn = stampText(settings.warnValue);
	const crit = stampText(settings.critValue);
	return { alertDisplayUnit: unit, alertDisplayUnitFor: { ...(warn !== undefined ? { warn } : {}), ...(crit !== undefined ? { crit } : {}) } };
}

/** Parses every alert field of one action's settings. */
export function parseAlertConfig(settings: AlertSettings): AlertConfig {
	const warn = parseThreshold(settings.warnValue);
	const crit = parseThreshold(settings.critValue);
	const band = parseBand(settings.alertHysteresis);
	const junk: AlertField[] = [];
	if (isJunk(settings.warnValue, warn)) junk.push("warn");
	if (isJunk(settings.critValue, crit)) junk.push("crit");
	if (band.junk) junk.push("hyst");
	const displayUnit = stampedDisplayUnit(settings);
	return {
		rules: parseAlertRules(settings.alertRules),
		legacy: {
			...(warn !== undefined ? { warn } : {}),
			...(crit !== undefined ? { crit } : {}),
			below: settings.alertBelow === true,
			hyst: band.hyst,
			...(typeof displayUnit === "string" ? { displayUnit } : {}),
			scope: settings.alertUnit,
			junk,
			negativeHyst: band.negative
		},
		dwellMs: parseAlertDwellMs(settings.alertDwellMs),
		snoozeMs: parseAlertSnoozeMs(settings.alertSnoozeMs)
	};
}

/** Whether the settings set any limit at all: the legacy pair or an
 * `alertRules` entry. */
export function hasAnyLimit(config: AlertConfig): boolean {
	return config.legacy.warn !== undefined || config.legacy.crit !== undefined || config.rules.size > 0;
}

/** The keys a reading answers to, exact key first, then its confirmed
 * aliases in the runtime's lookup order (the reading-colors walk). */
function walkKeys(reading: Pick<Reading, "key" | "linkedKeys">): string[] {
	return [...new Set([reading.key, ...(reading.linkedKeys ?? [])])];
}

/** The dial's legacy unit scope, compared exactly as the 1.7.1 dial does:
 * absent applies everywhere, any value other than a matching unit (junk
 * included) applies nowhere. */
export function legacyScopeApplies(scope: unknown, readingUnit: string): boolean {
	return (scope === undefined || typeof scope === "string") && thresholdsApplyTo(scope, readingUnit);
}

/** Whether the legacy pair covers a reading, numbers aside: a key's first
 * reading only, a dial's readings under thresholdsApplyTo(alertUnit). */
function legacyCovers(legacy: LegacyAlertPair, kind: "key" | "dial", reading: Pick<Reading, "unit">, slot: number): boolean {
	return kind === "key" ? slot === 0 : legacyScopeApplies(legacy.scope, reading.unit);
}

/** The `alertRules` entry for a reading and the key it is filed under. */
export function readingRuleOf(config: AlertConfig, reading: Pick<Reading, "key" | "linkedKeys">): { key: string; rule: ParsedAlertRule } | undefined {
	for (const key of walkKeys(reading)) {
		const rule = config.rules.get(key);
		if (rule !== undefined) return { key, rule };
	}
	return undefined;
}

/**
 * The rule for one reading. Precedence:
 * 1. an `alertRules` entry found through [key, ...linkedKeys], exact key
 *    first;
 * 2. otherwise the legacy pair exactly as shipped: a key's first reading
 *    only (slot 0), a dial's readings under thresholdsApplyTo(alertUnit);
 * 3. otherwise null.
 * A rule with neither warn nor crit is null: an entry with no usable limit
 * means no alert for that reading, it does not fall back to the legacy pair.
 */
export function ruleFor(config: AlertConfig, kind: "key" | "dial", reading: Pick<Reading, "key" | "linkedKeys" | "unit">, slot: number): ResolvedRule | null {
	const found = readingRuleOf(config, reading);
	if (found !== undefined) {
		const { key, rule } = found;
		if (rule.warn === undefined && rule.crit === undefined) return null;
		return {
			source: "reading",
			ruleKey: key,
			...(rule.warn !== undefined ? { warn: rule.warn } : {}),
			...(rule.crit !== undefined ? { crit: rule.crit } : {}),
			below: rule.below,
			unit: rule.unit === undefined ? { kind: "uncaptured" } : { kind: "captured", unit: rule.unit },
			hyst: rule.hyst
		};
	}
	const legacy = config.legacy;
	if ((legacy.warn === undefined && legacy.crit === undefined) || !legacyCovers(legacy, kind, reading, slot)) return null;
	return {
		source: "legacy",
		...(legacy.warn !== undefined ? { warn: legacy.warn } : {}),
		...(legacy.crit !== undefined ? { crit: legacy.crit } : {}),
		below: legacy.below,
		unit: legacy.displayUnit === undefined ? { kind: "legacy" } : { kind: "legacy", displayUnit: legacy.displayUnit },
		hyst: legacy.hyst
	};
}

/** °C and °F, or Δ°C and Δ°F: the two halves of a pair the °F choice
 * converts between. */
function isTemperaturePair(a: string, b: string): boolean {
	return a !== b && valueBetweenUnits(0, a, b) !== undefined;
}

/** A value moved between units: identity, °C and °F, or Δ°C and Δ°F (the
 * formulas convertUnit uses), else undefined. */
export function valueInUnit(value: number, unit: string, target: string): number | undefined {
	return valueBetweenUnits(value, unit, target);
}

/**
 * The unit a rule's numbers are in for this reading, or undefined when the
 * rule stands down (a captured unit the reading no longer reports, or a
 * unit that was never captured).
 */
export function ruleUnitFor(rule: ResolvedRule, reading: Pick<Reading, "unit" | "value">, fahrenheit: boolean): string | undefined {
	const displayed = convertUnit(reading.value, reading.unit, fahrenheit).unit;
	switch (rule.unit.kind) {
		case "uncaptured":
			return undefined;
		case "captured": {
			const unit = rule.unit.unit;
			return unit === displayed || isTemperaturePair(unit, displayed) ? unit : undefined;
		}
		default: {
			const stamped = rule.unit.displayUnit;
			return stamped !== undefined && isTemperaturePair(stamped, displayed) ? stamped : displayed;
		}
	}
}

/**
 * The number a rule compares. The legacy pair compares the displayed value
 * exactly as 1.7.1 does, except that a stamped display unit converts across
 * °C and °F instead of reinterpreting the typed numbers. A captured rule
 * compares in its own unit, converting only across °C and °F; any other unit
 * change returns undefined, and the rule stands down. Data-unit tiers never
 * enter: the reading's unit is HWiNFO's own. A conversion always starts from
 * HWiNFO's value, so a value at a limit never misses it by a rounding step.
 */
export function ruleValue(rule: ResolvedRule, reading: Pick<Reading, "unit" | "value">, fahrenheit: boolean): number | undefined {
	const displayed = convertUnit(reading.value, reading.unit, fahrenheit);
	const target = ruleUnitFor(rule, reading, fahrenheit);
	if (target === undefined) return undefined;
	if (target === displayed.unit) return displayed.value;
	return valueInUnit(reading.value, reading.unit, target);
}

/** An observation for the engine: valid only with data that is current
 * (`ok`), a published reading, a rule, a comparable unit and a finite value. */
export type AlertObservation = { readonly valid: false } | { readonly valid: true; readonly value: number };

export const INVALID_OBSERVATION: AlertObservation = Object.freeze({ valid: false });

export function alertObservation(rule: ResolvedRule | null, reading: Pick<Reading, "unit" | "value"> | undefined, fahrenheit: boolean, ok: boolean): AlertObservation {
	if (!ok || rule === null || reading === undefined) return INVALID_OBSERVATION;
	const value = ruleValue(rule, reading, fahrenheit);
	return value === undefined || !Number.isFinite(value) ? INVALID_OBSERVATION : { valid: true, value };
}

/** Equal for rules that compare the same way; a change resets dwell,
 * recovery and snooze state for the reading. */
export function ruleSignature(rule: ResolvedRule): string {
	return JSON.stringify([rule.source, rule.ruleKey ?? null, rule.warn ?? null, rule.crit ?? null, rule.below, rule.unit, rule.hyst]);
}

export type AlertFlagCode =
	| "warn-not-number"
	| "crit-not-number"
	| "hyst-not-number"
	| "hyst-negative"
	| "warning-never-shows"
	| "straight-to-critical"
	| "band-wider-than-gap"
	| "unit-mismatch"
	| "unit-not-captured"
	| "two-limits";

/** A validation note for the settings panel. Notes never block a write. */
export interface AlertFlag {
	readonly code: AlertFlagCode;
	readonly message: string;
}

function limitFlags(limits: { warn?: number; crit?: number; below: boolean; hyst: number; junk: readonly AlertField[]; negativeHyst: boolean }): AlertFlag[] {
	const flags: AlertFlag[] = [];
	if (limits.junk.includes("warn")) flags.push({ code: "warn-not-number", message: "Warn value is not a number" });
	if (limits.junk.includes("crit")) flags.push({ code: "crit-not-number", message: "Critical value is not a number" });
	if (limits.junk.includes("hyst")) flags.push({ code: "hyst-not-number", message: "Recovery band is not a number, so it counts as 0" });
	if (limits.negativeHyst) flags.push({ code: "hyst-negative", message: "Recovery band is below 0, so it counts as 0" });
	const { warn, crit } = limits;
	if (warn !== undefined && crit !== undefined) {
		if (warn === crit) flags.push({ code: "warning-never-shows", message: "Warning never shows: the warn and critical values are the same" });
		else if (limits.below ? crit > warn : crit < warn) flags.push({ code: "straight-to-critical", message: "Goes straight to critical: the critical value is reached before the warn value" });
		if (limits.hyst > 0 && limits.hyst >= Math.abs(crit - warn)) flags.push({ code: "band-wider-than-gap", message: "Recovery band is as wide as the gap between warn and critical, or wider" });
	}
	return flags;
}

const TWO_LIMITS_OWN = "Limits are also saved for a linked reading. This reading uses its own limits, and the linked reading uses its own wherever it shows";
const TWO_LIMITS_LINKED = "Limits are saved for more than one reading linked to this one, and this reading uses the first of them. Save limits for this reading to give it its own";

function unitText(unit: string): string {
	return unit === "" ? "no unit" : unit;
}

/**
 * Validation notes for the rule a reading resolves to (or, with no reading,
 * for the legacy pair alone): fields that are not numbers, a contradictory
 * pair, a recovery band wider than the gap, a captured unit the reading no
 * longer reports, a rule still waiting for its unit, and limits saved under
 * more than one key of one reading.
 */
export function alertFlags(config: AlertConfig, kind: "key" | "dial", reading: Pick<Reading, "key" | "linkedKeys" | "unit" | "value"> | undefined, slot: number, fahrenheit: boolean): AlertFlag[] {
	if (reading === undefined) return limitFlags(config.legacy);
	const found = readingRuleOf(config, reading);
	// The legacy notes apply wherever the pair covers this reading, even
	// when no limit in it parses (a lone junk field still gets its note).
	if (found === undefined) return legacyCovers(config.legacy, kind, reading, slot) ? limitFlags(config.legacy) : [];
	const flags = limitFlags(found.rule);
	const owners = walkKeys(reading).filter((key) => config.rules.has(key));
	// Each spelling uses the first set found from its own key, and the alert
	// store keeps a separate track per set, so both notes say what happens.
	if (owners.length > 1) flags.push({ code: "two-limits", message: found.key === reading.key ? TWO_LIMITS_OWN : TWO_LIMITS_LINKED });
	const rule = ruleFor(config, kind, reading, slot);
	if (rule === null) return flags;
	if (rule.unit.kind === "uncaptured") {
		// Only a reading that reports gets here, so the note asks for the edit
		// that captures its unit instead of saying it waits.
		flags.push({ code: "unit-not-captured", message: "These limits were saved without a unit, so they are off until you edit them" });
	} else if (rule.unit.kind === "captured" && ruleUnitFor(rule, reading, fahrenheit) === undefined) {
		const displayed = convertUnit(reading.value, reading.unit, fahrenheit).unit;
		flags.push({ code: "unit-mismatch", message: `These limits were set for ${unitText(rule.unit.unit)}. This reading now reports ${unitText(displayed)}, so they are off until you edit them` });
	}
	return flags;
}
