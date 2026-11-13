/**
 * Calculated readings (steer 7G): a bounded, plugin-side combination of
 * readings the deck already resolves. Six operations and nothing else: sum,
 * average, lowest, highest, difference and ratio, where a ratio may be
 * published as a percentage. There is no expression language and no
 * evaluation of text of any kind; a definition is data that selects one of
 * those operations.
 *
 * Definitions live in the global setting `calculatedReadings`, an array of
 * at most 32 rows:
 *
 *   { id: "calc:<22 base64url>", op: "sum"|"avg"|"min"|"max"|"diff"|"ratio",
 *     inputs: string[2..8], unit, sensorType, percent?: boolean, label? }
 *
 * - `id` is the reading key (key-namespace.ts); it can never collide with a
 *   Shared Memory or Gadget key and is never a link endpoint.
 * - `inputs` are saved reading keys, exactly two for diff and ratio. An
 *   input may be the id of an EARLIER definition, never a later one or
 *   itself, so a cycle cannot be written down and evaluation is one forward
 *   pass. Nesting depth is at most 3.
 * - `unit` is the unit every input is held to (the inputs' unit when the
 *   definition was made). Data units of one kind are re-scaled into it;
 *   anything else must match exactly at runtime or the result is
 *   unit-mismatch. A temperature unit names the family only: °C and °F
 *   (and Δ°C and Δ°F) are the same definition, the inputs convert into
 *   each other, and the result is published in the unit the inputs carry
 *   now, exactly like the provider's own readings when HWiNFO switches
 *   between Celsius and Fahrenheit.
 * - `sensorType` is the HWiNFO type the result carries (except a ratio,
 *   which carries its own).
 * - `percent` exactly true publishes a ratio as a percentage ("%", Usage);
 *   a plain ratio is "x" (Other). Absent or false is a plain ratio. Any
 *   other value, or true on another operation, refuses the row
 *   (malformed-percent) rather than publish a fraction where a percentage
 *   was meant.
 * - `label` is an optional custom name. Without it the label is generated
 *   from the inputs ("CPU Package Power + GPU Power"). A custom label that
 *   names wall, system, total, PSU or outlet power on a power sum is refused:
 *   a sum of reported sensor powers is not what the machine draws.
 *
 * Salvage: the parser never throws and never writes anything back. A
 * malformed row is reported (rows[]) and ignored; an id used by two rows
 * invalidates every copy; more than 32 rows turns the whole list off, like
 * the 128-row rule for readingLinks.
 *
 * Results (withCalculatedReadings) are derived after links from the
 * snapshot the poller already holds: the provider's snapshot is never
 * mutated, statistics are "unavailable" (no producer MIN/MAX/AVG), and every
 * failure is NaN with an explicit state, never a plausible zero. The snapshot
 * evidence fields (pollTime, valueRevision, freshnessRevision) pass through
 * untouched, so recalculating never renews freshness; a derived reading is
 * exactly as fresh as its oldest input (calculatedEvidenceOf).
 *
 * Work per snapshot: each definition reads its at most 8 inputs, and a sum
 * or average also checks the measurements pooled under nested sums and
 * averages (at most 8 x 8 x 8 per definition, depth 3). The inspectable
 * expression, which names every input through every level, is built only
 * on demand (calculatedExpressionOf), never per snapshot.
 */
import { createHash, randomBytes } from "node:crypto";

import { parseDataUnit } from "../ui/measure";
import { CALCULATED_KEY, CALCULATED_KEY_PREFIX, keyProducerOf } from "./key-namespace";
import { liveKeyOf } from "./reading-links";
import { SensorType, type Reading, type SensorSnapshot } from "./types";

export const CALCULATED_READINGS_MAX = 32;
export const CALCULATED_INPUTS_MIN = 2;
export const CALCULATED_INPUTS_MAX = 8;
export const CALCULATED_DEPTH_MAX = 3;
export const CALCULATED_UNIT_MAX = 32;
export const CALCULATED_LABEL_MAX = 64;
export const CALCULATED_INPUT_KEY_MAX = 512;

/** The source name every calculated reading is listed under (pickers group
 * by source; detail filters match "<source> <label>"). "(plugin)" tells
 * these apart from HWiNFO's own custom sensors, which arrive under their
 * own source names. */
export const CALCULATED_SOURCE_NAME = "Calculated (plugin)";
/** Label of a saved key whose definition failed salvage. */
export const CALCULATED_INVALID_LABEL = "Invalid calculation";
/** Stands in for an input's name in a generated label while it is missing. */
export const CALCULATED_MISSING_INPUT_NAME = "missing reading";

/** The stored operation names. A percentage is a ratio with `percent: true`. */
export type CalculatedOp = "sum" | "avg" | "min" | "max" | "diff" | "ratio";

export const CALCULATED_OPS: readonly CalculatedOp[] = ["sum", "avg", "min", "max", "diff", "ratio"];

/** Operations that take exactly two inputs, in order (a then b). */
const TWO_INPUT_OPS: ReadonlySet<CalculatedOp> = new Set<CalculatedOp>(["diff", "ratio"]);
/** Operations whose result does not depend on input order. */
const ORDER_FREE_OPS: ReadonlySet<CalculatedOp> = new Set<CalculatedOp>(["sum", "avg", "min", "max"]);
/** Operations that pool their inputs into one quantity: a measurement may
 * enter a pool once, through any nesting of sums and averages. */
const POOLING_OPS: ReadonlySet<CalculatedOp> = new Set<CalculatedOp>(["sum", "avg"]);

// ---------------------------------------------------------------------------
// Units and dimensional rules

const CELSIUS = "°C";
const FAHRENHEIT = "°F";
/** A temperature difference. Never "°C": the display conversion adds 32 to
 * any °C value, which is right for a temperature and wrong for a difference
 * (format.ts converts Δ°C to Δ°F by x1.8 with no offset). */
const DELTA_CELSIUS = "Δ°C";
const DELTA_FAHRENHEIT = "Δ°F";
const BOOLEAN_UNIT = "Yes/No";
/** A plain ratio: how many times b fits in a (HWiNFO's own multiplier unit). */
const RATIO_UNIT = "x";
const PERCENT_UNIT = "%";

export type CalculatedUnitKind =
	| "temperature"
	| "temperature-delta"
	| "power"
	| "current"
	| "data"
	| "boolean"
	| "percent"
	| "voltage"
	| "clock"
	| "fan"
	| "other";

const KIND_BY_UNIT: ReadonlyMap<string, CalculatedUnitKind> = new Map<string, CalculatedUnitKind>([
	[CELSIUS, "temperature"],
	[FAHRENHEIT, "temperature"],
	[DELTA_CELSIUS, "temperature-delta"],
	[DELTA_FAHRENHEIT, "temperature-delta"],
	["W", "power"],
	["A", "current"],
	["V", "voltage"],
	["MHz", "clock"],
	["RPM", "fan"],
	[PERCENT_UNIT, "percent"],
	[BOOLEAN_UNIT, "boolean"]
]);

/** What a unit measures, for the dimensional rules. Data units (bytes and
 * transfer rates) are recognized by the same parser the faces use. */
export function calculatedUnitKind(unit: string): CalculatedUnitKind {
	return KIND_BY_UNIT.get(unit) ?? (parseDataUnit(unit) !== null ? "data" : "other");
}

const EVERY_OP = CALCULATED_OPS;
/** Levels: a sum of two clocks, fan speeds, voltages or percentages is not a
 * measurement of anything, but their average, extremes, difference and ratio
 * are. A ratio may be a percentage wherever a ratio is allowed. */
const LEVEL_OPS: readonly CalculatedOp[] = ["avg", "min", "max", "diff", "ratio"];

const OPS_BY_KIND: Readonly<Record<CalculatedUnitKind, readonly CalculatedOp[]>> = {
	power: EVERY_OP,
	current: EVERY_OP,
	data: EVERY_OP,
	"temperature-delta": EVERY_OP,
	// A temperature is not on an absolute scale here: no sum, no ratio.
	temperature: ["avg", "min", "max", "diff"],
	voltage: LEVEL_OPS,
	clock: LEVEL_OPS,
	fan: LEVEL_OPS,
	percent: LEVEL_OPS,
	other: LEVEL_OPS,
	// Lowest is "all Yes", highest is "any Yes".
	boolean: ["min", "max"]
};

/** Units outside the named kinds whose quantities add up (energy). */
const SUMMABLE_OTHER_UNITS: ReadonlySet<string> = new Set(["Wh", "mWh", "kWh", "J"]);

/** The operations a definition held to `unit` may use. */
export function calculatedOpsFor(unit: string): readonly CalculatedOp[] {
	const kind = calculatedUnitKind(unit);
	return kind === "other" && SUMMABLE_OTHER_UNITS.has(unit) ? EVERY_OP : OPS_BY_KIND[kind];
}

/**
 * Converts an input value from its unit into the definition's unit, or
 * undefined when the two do not measure the same thing. Identical units pass
 * through; °C and °F convert both ways; Δ°C and Δ°F scale by 1.8; data units
 * of one kind (bytes, byte rates, bit rates) re-scale through their base.
 */
export function convertCalculatedInput(value: number, from: string, to: string): number | undefined {
	if (from === to) return value;
	if (from === FAHRENHEIT && to === CELSIUS) return (value - 32) / 1.8;
	if (from === CELSIUS && to === FAHRENHEIT) return value * 1.8 + 32;
	if (from === DELTA_FAHRENHEIT && to === DELTA_CELSIUS) return value / 1.8;
	if (from === DELTA_CELSIUS && to === DELTA_FAHRENHEIT) return value * 1.8;
	const source = parseDataUnit(from);
	const target = parseDataUnit(to);
	if (source !== null && target !== null && source.kind === target.kind) return (value * source.toBase) / target.toBase;
	return undefined;
}

/** Whether a reading in `from` can be held to a definition in `to`. */
export function calculatedUnitsCompatible(from: string, to: string): boolean {
	return convertCalculatedInput(1, from, to) !== undefined;
}

/** The unit a definition saved with `unit` is held to. A temperature unit
 * names its family, written as the Celsius spelling: °F reads as °C and
 * Δ°F as Δ°C, so the two spellings are one definition (one revision) and
 * the published unit comes from the inputs (temperatureUnitOf). */
export function calculatedHeldUnit(unit: string): string {
	if (unit === FAHRENHEIT) return CELSIUS;
	if (unit === DELTA_FAHRENHEIT) return DELTA_CELSIUS;
	return unit;
}

/** The unit an evaluation works in: the held unit, except that a
 * temperature definition works in the temperature unit its inputs carry now
 * (the first input of that family), so it reads °F next to the provider's
 * °F readings and °C next to °C ones, and the action's Fahrenheit option
 * converts it like any other reading. */
function temperatureUnitOf(heldUnit: string, inputs: readonly (Reading | undefined)[]): string {
	const kind = calculatedUnitKind(heldUnit);
	if (kind !== "temperature" && kind !== "temperature-delta") return heldUnit;
	return inputs.find((reading) => reading !== undefined && calculatedUnitKind(reading.unit) === kind)?.unit ?? heldUnit;
}

/** The unit and type an operation's result is published with. A
 * temperature difference is a delta unit; a ratio is "x" (Other), or "%"
 * (Usage) as a percentage. */
export function calculatedResultOf(op: CalculatedOp, unit: string, sensorType: SensorType, percent = false): { unit: string; type: SensorType } {
	if (op === "ratio") return percent ? { unit: PERCENT_UNIT, type: SensorType.Usage } : { unit: RATIO_UNIT, type: SensorType.Other };
	if (op === "diff" && unit === CELSIUS) return { unit: DELTA_CELSIUS, type: sensorType };
	if (op === "diff" && unit === FAHRENHEIT) return { unit: DELTA_FAHRENHEIT, type: sensorType };
	return { unit, type: sensorType };
}

// ---------------------------------------------------------------------------
// Labels

export type CalculatedLabelRefusal = "not-text" | "too-long" | "control-character" | "claims-system-power";

/** Words that claim what the machine draws. Matched anywhere in the label,
 * case folded, so a word run into the next ("PSUPower", "systempower",
 * "Systemwide") counts as well as a spaced one. A label that merely contains
 * one of them is refused too; the generated label is the safe side. */
const SYSTEM_POWER_CLAIM = /wall|system|total|psu|outlet/;
/** Words that contain a claim and claim nothing: a subtotal is part of a
 * sum, and a subsystem is a part of the machine. Blanked out (with a space,
 * so the text around them cannot join into a claim) before the claim
 * check. */
const SYSTEM_POWER_EXCEPTIONS = /subtotals?|subsystems?/g;

function claimsSystemPower(text: string): boolean {
	// NFKC folds width variants ("ＴＯＴＡＬ") into the plain letters.
	return SYSTEM_POWER_CLAIM.test(text.normalize("NFKC").toLowerCase().replace(SYSTEM_POWER_EXCEPTIONS, " "));
}

/** C0 and C1 control characters (a line break in a label breaks a face). */
function hasControlCharacter(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
	}
	return false;
}

/**
 * Why a custom label cannot name this definition, or undefined when it can.
 * The label is judged trimmed. A sum of power readings is the sum of what
 * the sensors report, so a name claiming wall, system, total, PSU or outlet
 * power is refused; the generated label (which names the inputs) is used
 * instead.
 */
export function calculatedLabelRefusal(op: CalculatedOp, unit: string, label: string): CalculatedLabelRefusal | undefined {
	const text = label.trim();
	if (text.length > CALCULATED_LABEL_MAX) return "too-long";
	if (hasControlCharacter(text)) return "control-character";
	if (op === "sum" && calculatedUnitKind(unit) === "power" && claimsSystemPower(text)) return "claims-system-power";
	return undefined;
}

/** Up to this many inputs are named in a generated label; more read as a
 * count ("Sum of 5 readings"). The expression always names every input. */
const LABEL_NAMES_MAX = 3;

function listOf(names: readonly string[], conjunction: "and" | "or"): string {
	return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} ${conjunction} ${names.at(-1) ?? ""}`;
}

type LabelShape = Pick<CalculatedDefinition, "op" | "percent" | "unit">;

function expressionText({ op, percent, unit }: LabelShape, names: readonly string[], shorten: boolean): string {
	const count = shorten && names.length > LABEL_NAMES_MAX ? `${names.length} readings` : undefined;
	const a = names[0] ?? CALCULATED_MISSING_INPUT_NAME;
	const b = names[1] ?? CALCULATED_MISSING_INPUT_NAME;
	const boolean = calculatedUnitKind(unit) === "boolean";
	switch (op) {
		case "sum":
			return count === undefined ? names.join(" + ") : `Sum of ${count}`;
		case "avg":
			return `Average of ${count ?? listOf(names, "and")}`;
		case "min":
			if (boolean) return count === undefined ? listOf(names, "and") : `All of ${count}`;
			return `Lowest of ${count ?? listOf(names, "and")}`;
		case "max":
			if (boolean) return count === undefined ? listOf(names, "or") : `Any of ${count}`;
			return `Highest of ${count ?? listOf(names, "and")}`;
		case "diff":
			return `${a} - ${b}`;
		case "ratio":
			return percent ? `${a} as % of ${b}` : `${a} / ${b}`;
	}
}

/** The generated label: inputs named for up to three, a count beyond. */
export function calculatedGeneratedLabel(def: LabelShape, names: readonly string[]): string {
	return expressionText(def, names, true);
}

/** The inspectable expression over the given input names: every input
 * named, never shortened. calculatedExpressionOf supplies the names. */
export function calculatedExpression(def: LabelShape, names: readonly string[]): string {
	return expressionText(def, names, false);
}

// ---------------------------------------------------------------------------
// Definitions and salvage

export interface CalculatedDefinition {
	readonly id: string;
	/** Position of the row in the stored array. */
	readonly index: number;
	readonly op: CalculatedOp;
	/** A ratio published as a percentage (stored `percent: true`). */
	readonly percent: boolean;
	/** Saved input keys exactly as stored, in order. */
	readonly inputs: readonly string[];
	/** The unit every input is held to (calculatedHeldUnit of the stored
	 * unit: a temperature family is written as its Celsius spelling). */
	readonly unit: string;
	readonly sensorType: SensorType;
	/** The accepted custom label (trimmed); absent means generated. */
	readonly label?: string;
	/** 1 for readings over provider keys only; 1 + the deepest referenced definition otherwise. */
	readonly depth: number;
	/** The result's unit for the held unit. A temperature result is
	 * published in its inputs' current unit of the same family (°F for °C
	 * when HWiNFO reports Fahrenheit); this is the Celsius spelling, used to
	 * check that a referencing definition can hold it. */
	readonly resultUnit: string;
	readonly resultType: SensorType;
	/**
	 * Changes exactly when what the definition measures changes: the
	 * operation, the inputs (as a set for order-free operations), the unit,
	 * the type, or the definition of a referenced calculated input. A label
	 * edit leaves it alone. Consumers end history segments and sessions when
	 * it changes (see measurementIdentityOf).
	 */
	readonly definitionRevision: string;
}

export type CalculatedRefusal =
	| "malformed"
	| "malformed-id"
	| "duplicate-id"
	| "unknown-op"
	/** `percent` is present but not a boolean, or true on an operation other than ratio. */
	| "malformed-percent"
	| "malformed-unit"
	| "malformed-type"
	| "malformed-input"
	| "input-count"
	| "duplicate-input"
	| "op-not-allowed"
	| "self-reference"
	| "forward-reference"
	| "missing-reference"
	| "invalid-reference"
	| "unit-mismatch"
	| "too-deep";

export type CalculatedRowVerdict =
	| { readonly index: number; readonly id: string; readonly ok: true; readonly labelRefusal?: CalculatedLabelRefusal }
	| { readonly index: number; readonly id?: string; readonly ok: false; readonly reason: CalculatedRefusal };

export interface CalculatedPlan {
	/** Valid definitions in stored order. */
	readonly definitions: readonly CalculatedDefinition[];
	readonly byId: ReadonlyMap<string, CalculatedDefinition>;
	/** One verdict per stored row (empty when the list is off or absent). */
	readonly rows: readonly CalculatedRowVerdict[];
	/** More than 32 rows: every row is off until the list is back in bounds. */
	readonly overCap: boolean;
	/** Well-formed ids of rows that failed salvage, once each (first row),
	 * in stored order. A saved key on one resolves (byKey only, never listed
	 * among the readings) to an "invalid-definition" entry instead of looking
	 * like a missing sensor. */
	readonly invalid: readonly { readonly id: string; readonly index: number }[];
}

export const NO_CALCULATED_READINGS: CalculatedPlan = Object.freeze({
	definitions: Object.freeze([]),
	byId: new Map<string, CalculatedDefinition>(),
	rows: Object.freeze([]),
	overCap: false,
	invalid: Object.freeze([])
});

/** A fresh reading key for a new definition: "calc:" + 16 random bytes in
 * base64url (22 characters). `bytes` is injectable for tests. */
export function mintCalculatedId(bytes: Uint8Array = randomBytes(16)): string {
	if (bytes.length !== 16) throw new RangeError("a calculated reading id takes exactly 16 bytes");
	return `${CALCULATED_KEY_PREFIX}${Buffer.from(bytes).toString("base64url")}`;
}

function digest(text: string): string {
	return createHash("sha256").update(text).digest("base64url").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCalculatedOp(value: unknown): value is CalculatedOp {
	return typeof value === "string" && (CALCULATED_OPS as readonly string[]).includes(value);
}

function wellFormedId(row: unknown): string | undefined {
	if (!isRecord(row)) return undefined;
	const id = row.id;
	return typeof id === "string" && CALCULATED_KEY.test(id) ? id : undefined;
}

type RowOutcome = { ok: true; def: CalculatedDefinition; labelRefusal?: CalculatedLabelRefusal } | { ok: false; reason: CalculatedRefusal };

function parseRow(
	row: Record<string, unknown>,
	id: string,
	index: number,
	earlier: ReadonlyMap<string, CalculatedDefinition | null>,
	later: ReadonlySet<string>
): RowOutcome {
	const op = row.op;
	if (!isCalculatedOp(op)) return { ok: false, reason: "unknown-op" };
	// Absent and false are a plain ratio. Anything else that is not true on
	// a ratio is refused: read as absent it would publish a fraction where
	// the writer meant a percentage, a plausible wrong number.
	const percent = row.percent === true;
	if (row.percent !== undefined && row.percent !== false && !(percent && op === "ratio")) return { ok: false, reason: "malformed-percent" };
	const storedUnit = row.unit;
	if (typeof storedUnit !== "string" || storedUnit.length > CALCULATED_UNIT_MAX) return { ok: false, reason: "malformed-unit" };
	const unit = calculatedHeldUnit(storedUnit);
	const sensorType = row.sensorType;
	if (typeof sensorType !== "number" || !Number.isInteger(sensorType) || sensorType < SensorType.None || sensorType > SensorType.Other) {
		return { ok: false, reason: "malformed-type" };
	}
	const rawInputs = row.inputs;
	if (!Array.isArray(rawInputs)) return { ok: false, reason: "malformed-input" };
	const count = rawInputs.length;
	if (TWO_INPUT_OPS.has(op) ? count !== 2 : count < CALCULATED_INPUTS_MIN || count > CALCULATED_INPUTS_MAX) {
		return { ok: false, reason: "input-count" };
	}
	const inputs: string[] = [];
	for (const input of rawInputs as unknown[]) {
		if (typeof input !== "string" || input.length === 0 || input.length > CALCULATED_INPUT_KEY_MAX || keyProducerOf(input) === "unknown") {
			return { ok: false, reason: "malformed-input" };
		}
		inputs.push(input);
	}
	if (new Set(inputs).size !== inputs.length) return { ok: false, reason: "duplicate-input" };
	if (!calculatedOpsFor(unit).includes(op)) return { ok: false, reason: "op-not-allowed" };
	let depth = 1;
	const revisionInputs: string[] = [];
	for (const input of inputs) {
		if (keyProducerOf(input) !== "calculated") {
			revisionInputs.push(input);
			continue;
		}
		if (input === id) return { ok: false, reason: "self-reference" };
		if (!earlier.has(input)) return { ok: false, reason: later.has(input) ? "forward-reference" : "missing-reference" };
		const ref = earlier.get(input);
		if (ref === null || ref === undefined) return { ok: false, reason: "invalid-reference" };
		if (!calculatedUnitsCompatible(ref.resultUnit, unit)) return { ok: false, reason: "unit-mismatch" };
		depth = Math.max(depth, ref.depth + 1);
		revisionInputs.push(`${input}@${ref.definitionRevision}`);
	}
	if (depth > CALCULATED_DEPTH_MAX) return { ok: false, reason: "too-deep" };
	const type = sensorType as SensorType;
	const result = calculatedResultOf(op, unit, type, percent);
	const canonicalInputs = ORDER_FREE_OPS.has(op) ? [...revisionInputs].sort() : revisionInputs;
	const definitionRevision = digest(JSON.stringify([1, op, percent, canonicalInputs, unit, type]));
	let label: string | undefined;
	let labelRefusal: CalculatedLabelRefusal | undefined;
	if (row.label !== undefined) {
		if (typeof row.label !== "string") {
			labelRefusal = "not-text";
		} else if (row.label.trim() !== "") {
			labelRefusal = calculatedLabelRefusal(op, unit, row.label);
			if (labelRefusal === undefined) label = row.label.trim();
		}
	}
	const def: CalculatedDefinition = {
		id,
		index,
		op,
		percent,
		inputs,
		unit,
		sensorType: type,
		...(label === undefined ? {} : { label }),
		depth,
		resultUnit: result.unit,
		resultType: result.type,
		definitionRevision
	};
	return labelRefusal === undefined ? { ok: true, def } : { ok: true, def, labelRefusal };
}

/**
 * Salvage-parses the global `calculatedReadings` value. Never throws, never
 * rewrites: every row gets a verdict, valid rows become definitions, and
 * anything the parser does not recognize (extra fields, unknown future
 * operations) is left in the stored document for the writer to carry.
 */
export function parseCalculatedReadings(raw: unknown): CalculatedPlan {
	if (!Array.isArray(raw) || raw.length === 0) return NO_CALCULATED_READINGS;
	if (raw.length > CALCULATED_READINGS_MAX) {
		return { definitions: [], byId: new Map(), rows: [], overCap: true, invalid: [] };
	}
	const rawRows = raw as unknown[];
	const ids = rawRows.map(wellFormedId);
	const uses = new Map<string, number>();
	for (const id of ids) if (id !== undefined) uses.set(id, (uses.get(id) ?? 0) + 1);
	// Ids of rows still ahead of the one being parsed, to tell a forward
	// reference from a reference to nothing.
	const ahead = new Map(uses);
	const earlier = new Map<string, CalculatedDefinition | null>();
	const definitions: CalculatedDefinition[] = [];
	const rows: CalculatedRowVerdict[] = [];
	const invalid: { id: string; index: number }[] = [];
	const invalidSeen = new Set<string>();
	const refuse = (index: number, reason: CalculatedRefusal, id?: string): void => {
		rows.push(id === undefined ? { index, ok: false, reason } : { index, id, ok: false, reason });
		if (id !== undefined && !invalidSeen.has(id)) {
			invalidSeen.add(id);
			invalid.push({ id, index });
		}
	};
	// An index loop, not forEach: a hole in the array still gets a verdict.
	for (let index = 0; index < rawRows.length; index++) {
		const row = rawRows[index];
		const id = ids[index];
		if (id !== undefined) {
			const left = (ahead.get(id) ?? 1) - 1;
			if (left === 0) ahead.delete(id);
			else ahead.set(id, left);
		}
		if (!isRecord(row)) {
			refuse(index, "malformed");
			continue;
		}
		if (id === undefined) {
			refuse(index, "malformed-id");
			continue;
		}
		if ((uses.get(id) ?? 0) > 1) {
			earlier.set(id, null);
			refuse(index, "duplicate-id", id);
			continue;
		}
		const outcome = parseRow(row, id, index, earlier, new Set(ahead.keys()));
		if (!outcome.ok) {
			earlier.set(id, null);
			refuse(index, outcome.reason, id);
			continue;
		}
		earlier.set(id, outcome.def);
		definitions.push(outcome.def);
		rows.push(outcome.labelRefusal === undefined ? { index, id, ok: true } : { index, id, ok: true, labelRefusal: outcome.labelRefusal });
	}
	return { definitions, byId: new Map(definitions.map((def) => [def.id, def])), rows, overCap: false, invalid };
}

/**
 * The meaning of a plan for change detection: a re-delivery of the same
 * document (or one differing only in unknown fields, in the spelling of a
 * temperature unit, or in rows that were and stay invalid for the same ids)
 * is not a change. Stored order is part of the meaning (it fixes which
 * references are earlier and the order readings are listed in). A label
 * edit IS a change (it repaints) but leaves every definitionRevision alone
 * (no reset).
 */
export function calculatedReadingsSignature(plan: CalculatedPlan): string {
	return JSON.stringify([
		plan.overCap,
		plan.definitions.map((def) => [def.id, def.definitionRevision, def.op, def.percent, def.inputs, def.unit, def.sensorType, def.label ?? null]),
		plan.invalid.map((entry) => entry.id)
	]);
}

// ---------------------------------------------------------------------------
// Evaluation

export type CalculatedState =
	| "ok"
	/** The definition failed salvage (see the plan's row verdict). */
	| "invalid-definition"
	/** An input key resolves to nothing (asleep, withheld, removed). */
	| "input-missing"
	/** Two inputs resolve to one measurement (a linked pair listed twice),
	 * or a sum or average pools one measurement twice through nested sums
	 * and averages. */
	| "input-ambiguous"
	/** An input's unit cannot be held to the definition's unit. */
	| "unit-mismatch"
	/** An input is stale on its own evidence (CalculatedOptions.isInputStale). */
	| "input-stale"
	/** An input's value is not a finite number, or a calculated input has no value. */
	| "input-non-finite"
	/** The divisor of a ratio or percent is zero. */
	| "division-by-zero"
	/** The result (or an input converted into the definition's unit) is not finite. */
	| "overflow";

export interface CalculatedInfo {
	readonly state: CalculatedState;
	/** Null for an invalid definition (its stored operation is not trusted). */
	readonly op: CalculatedOp | null;
	/** A ratio published as a percentage (false for an invalid definition). */
	readonly percent: boolean;
	/** Saved input keys as stored (empty for an invalid definition). */
	readonly inputs: readonly string[];
	/** The first input behind a failed state, when one input is to blame. */
	readonly failedInput?: string;
	/** Static: changes only when the definition's meaning changes. */
	readonly definitionRevision: string;
	/** The definition plus what its inputs resolve to now: equal to
	 * definitionRevision unless an input is a confirmed alias of another
	 * key or a calculated input's own revision moved. */
	readonly revision: string;
}

/** A published calculated reading: an ordinary Reading plus its calculation. */
export interface CalculatedReading extends Reading {
	readonly calculated: CalculatedInfo;
}

export function calculatedInfoOf(reading: Reading): CalculatedInfo | undefined {
	return (reading as Partial<CalculatedReading>).calculated;
}

/**
 * The identity sessions and history follow. For a provider reading it is
 * exactly liveKeyOf (unchanged behavior). For a calculated reading it adds
 * the revision, so a changed definition, a re-paired input or a changed
 * calculated input starts a new session and a new history segment, while a
 * label edit does neither.
 */
export function measurementIdentityOf(reading: Reading): string {
	const info = calculatedInfoOf(reading);
	return info === undefined ? liveKeyOf(reading) : `${reading.key}#${info.revision}`;
}

export interface CalculatedOptions {
	/**
	 * Whether a resolved provider input is stale on its own evidence. The
	 * poller judges one snapshot at a time today, so the default (absent) is
	 * never; a per-source evidence clock plugs in here.
	 */
	readonly isInputStale?: (key: string, reading: Reading) => boolean;
}

type InputFailure = "input-missing" | "input-ambiguous" | "unit-mismatch" | "input-stale" | "input-non-finite" | "overflow";

/** Earlier entries win when several inputs fail differently: identity
 * problems first, then units, then freshness, then values. */
const INPUT_FAILURE_RANK: Readonly<Record<InputFailure, number>> = {
	"input-missing": 0,
	"input-ambiguous": 1,
	"unit-mismatch": 2,
	"input-stale": 3,
	"input-non-finite": 4,
	overflow: 5
};

/** What a failed calculated input means to a definition that uses it. Its
 * identity and freshness problems carry through; its arithmetic failures
 * are, from here, an input without a value. */
function upstreamFailure(state: CalculatedState): InputFailure {
	switch (state) {
		case "input-missing":
		case "input-ambiguous":
		case "unit-mismatch":
		case "input-stale":
			return state;
		default:
			return "input-non-finite";
	}
}

function combine(op: CalculatedOp, percent: boolean, values: readonly number[]): { value: number; state: "ok" | "division-by-zero" | "overflow" } {
	const a = values[0] ?? Number.NaN;
	const b = values[1] ?? Number.NaN;
	let value: number;
	switch (op) {
		case "sum":
			value = values.reduce((total, v) => total + v, 0);
			break;
		case "avg": {
			const sum = values.reduce((total, v) => total + v, 0);
			// Each term divided first cannot overflow for finite inputs.
			value = Number.isFinite(sum) ? sum / values.length : values.reduce((total, v) => total + v / values.length, 0);
			break;
		}
		case "min":
			value = Math.min(...values);
			break;
		case "max":
			value = Math.max(...values);
			break;
		case "diff":
			value = a - b;
			break;
		case "ratio":
			if (b === 0) return { value: Number.NaN, state: "division-by-zero" };
			// As a percentage, scaling first keeps whole percentages whole (7 of
			// 100 is 7, where 7 / 100 * 100 is 7.000000000000001); dividing
			// first only where the scaled numerator itself would overflow.
			value = !percent ? a / b : Number.isFinite(a * 100) ? (a * 100) / b : (a / b) * 100;
			break;
	}
	return Number.isFinite(value) ? { value, state: "ok" } : { value: Number.NaN, state: "overflow" };
}

/**
 * Evaluates one definition against the readings resolved so far. `pools`
 * holds, per sum or average already evaluated, the measurements it pooled
 * (provider inputs by live key; any other calculated input as itself); this
 * definition's own pool is added to it.
 */
function evaluate(
	def: CalculatedDefinition,
	plan: CalculatedPlan,
	byKey: ReadonlyMap<string, Reading>,
	sensorIndex: number,
	options: CalculatedOptions | undefined,
	pools: Map<string, ReadonlySet<string>>
): CalculatedReading {
	// A holder, not a reassigned local: the closure's writes stay visible to
	// the type checker at the use below.
	const failed: { state?: InputFailure; input?: string } = {};
	const fail = (state: InputFailure, input: string): void => {
		if (failed.state === undefined || INPUT_FAILURE_RANK[state] < INPUT_FAILURE_RANK[failed.state]) {
			failed.state = state;
			failed.input = input;
		}
	};
	const resolved = def.inputs.map((key) => byKey.get(key));
	const workingUnit = temperatureUnitOf(def.unit, resolved);
	const values: number[] = [];
	// A calculated input is named by its custom label as the user wrote it,
	// or by its generated text in parentheses, so "(A + B) - C" groups.
	const labelNames: string[] = [];
	const identities: string[] = [];
	const measurements = new Set<string>();
	// Only sums and averages pool: diff(sum(CPU, GPU), CPU) is a fair way to
	// get the GPU, while sum(sum(CPU, GPU), GPU) counts the GPU twice.
	const pooled = POOLING_OPS.has(def.op) ? new Set<string>() : undefined;
	let plain = true;
	for (const [i, key] of def.inputs.entries()) {
		const reading = resolved[i];
		if (reading === undefined) {
			labelNames.push(CALCULATED_MISSING_INPUT_NAME);
			identities.push(key);
			fail("input-missing", key);
			continue;
		}
		const info = calculatedInfoOf(reading);
		const generated = info !== undefined && plan.byId.get(key)?.label === undefined;
		labelNames.push(generated ? `(${reading.label})` : reading.label);
		const measurement = info === undefined ? liveKeyOf(reading) : reading.key;
		identities.push(info === undefined ? measurement : info.revision);
		if (info === undefined ? measurement !== key : info.revision !== info.definitionRevision) plain = false;
		if (measurements.has(measurement)) fail("input-ambiguous", key);
		measurements.add(measurement);
		if (pooled !== undefined) {
			for (const leaf of (info === undefined ? undefined : pools.get(key)) ?? [measurement]) {
				if (pooled.has(leaf)) {
					fail("input-ambiguous", key);
					break;
				}
				pooled.add(leaf);
			}
		}
		if (info !== undefined && info.state !== "ok") {
			fail(upstreamFailure(info.state), key);
			continue;
		}
		const converted = convertCalculatedInput(reading.value, reading.unit, workingUnit);
		if (converted === undefined) {
			fail("unit-mismatch", key);
			continue;
		}
		if (info === undefined && options?.isInputStale?.(key, reading) === true) {
			fail("input-stale", key);
			continue;
		}
		if (!Number.isFinite(reading.value)) {
			fail("input-non-finite", key);
			continue;
		}
		if (!Number.isFinite(converted)) {
			fail("overflow", key);
			continue;
		}
		values.push(converted);
	}
	if (pooled !== undefined) pools.set(def.id, pooled);
	const outcome = failed.state === undefined ? combine(def.op, def.percent, values) : { value: Number.NaN, state: failed.state };
	const revision = plain ? def.definitionRevision : digest(JSON.stringify([def.definitionRevision, identities]));
	const result = calculatedResultOf(def.op, workingUnit, def.sensorType, def.percent);
	return {
		key: def.id,
		type: result.type,
		sensorIndex,
		id: def.index,
		label: def.label ?? calculatedGeneratedLabel(def, labelNames),
		unit: result.unit,
		value: outcome.value,
		statistics: "unavailable",
		valueMin: Number.NaN,
		valueMax: Number.NaN,
		valueAvg: Number.NaN,
		calculated: {
			state: outcome.state,
			op: def.op,
			percent: def.percent,
			inputs: def.inputs,
			...(failed.input === undefined ? {} : { failedInput: failed.input }),
			definitionRevision: def.definitionRevision,
			revision
		}
	};
}

function invalidReading(id: string, sensorIndex: number, index: number): CalculatedReading {
	return {
		key: id,
		type: SensorType.Other,
		sensorIndex,
		id: index,
		label: CALCULATED_INVALID_LABEL,
		unit: "",
		value: Number.NaN,
		statistics: "unavailable",
		valueMin: Number.NaN,
		valueMax: Number.NaN,
		valueAvg: Number.NaN,
		calculated: { state: "invalid-definition", op: null, percent: false, inputs: [], definitionRevision: "", revision: "" }
	};
}

/**
 * The snapshot with calculated readings added: a new snapshot object whose
 * `readings` gain one entry per valid definition (stored order, after the
 * provider's readings), whose `byKey` also resolves invalid definitions'
 * ids, and whose `sensors` gain the "Calculated (plugin)" source. The provider's
 * snapshot, its arrays, its map and its readings are never modified, and a
 * provider key is never shadowed. Evidence fields pass through untouched.
 * With nothing to publish, the same snapshot instance comes back (zero cost
 * for a deck without calculated readings).
 *
 * Call it on the snapshot links were already applied to, so an input saved
 * as either endpoint of a confirmed pair resolves.
 */
export function withCalculatedReadings(snapshot: SensorSnapshot, plan: CalculatedPlan, options?: CalculatedOptions): SensorSnapshot {
	if (plan.definitions.length === 0 && plan.invalid.length === 0) return snapshot;
	const sensorIndex = snapshot.sensors.length;
	const byKey = new Map(snapshot.byKey);
	const added: Reading[] = [];
	const pools = new Map<string, ReadonlySet<string>>();
	for (const def of plan.definitions) {
		if (byKey.has(def.id)) continue;
		const reading = evaluate(def, plan, byKey, sensorIndex, options, pools);
		byKey.set(def.id, reading);
		added.push(reading);
	}
	for (const { id, index } of plan.invalid) {
		if (!byKey.has(id)) byKey.set(id, invalidReading(id, sensorIndex, index));
	}
	return {
		...snapshot,
		sensors: [...snapshot.sensors, { index: sensorIndex, id: 0, instance: 0, name: CALCULATED_SOURCE_NAME }],
		readings: added.length === 0 ? snapshot.readings : [...snapshot.readings, ...added],
		byKey
	};
}

/** How an input of a definition resolves in a snapshot: the definition it
 * names (a calculated input), or the provider reading it names (possibly
 * undefined). A calculated id the provider itself publishes is that
 * provider reading, as in withCalculatedReadings. */
function inputSourceOf(input: string, plan: CalculatedPlan, byKey: ReadonlyMap<string, Reading>): { readonly def: CalculatedDefinition } | { readonly reading: Reading | undefined } {
	const reading = byKey.get(input);
	const def = plan.byId.get(input);
	return def !== undefined && (reading === undefined || calculatedInfoOf(reading) !== undefined) ? { def } : { reading };
}

// ---------------------------------------------------------------------------
// Inspection

/**
 * The inspectable expression of a calculated reading, for the panel: every
 * input named, never shortened, through every level of nesting (a nested
 * definition by its custom label, or by its own expression in parentheses).
 * Undefined when `key` is not a valid definition. Built on demand only: it
 * names up to 8 x 8 x 8 inputs at depth 3, which is panel work, not
 * per-snapshot work. `snapshot` supplies the provider inputs' labels (the
 * decorated or the linked snapshot both work).
 */
export function calculatedExpressionOf(key: string, plan: CalculatedPlan, snapshot: Pick<SensorSnapshot, "byKey">): string | undefined {
	const def = plan.byId.get(key);
	if (def === undefined) return undefined;
	const names = def.inputs.map((input) => {
		const source = inputSourceOf(input, plan, snapshot.byKey);
		if ("reading" in source) return source.reading?.label ?? CALCULATED_MISSING_INPUT_NAME;
		return source.def.label ?? `(${calculatedExpressionOf(input, plan, snapshot) ?? CALCULATED_MISSING_INPUT_NAME})`;
	});
	return calculatedExpression(def, names);
}

// ---------------------------------------------------------------------------
// Evidence

/** Producer evidence of a derived reading. `advancedAt` is the evidence
 * time (monotonic ms) of the OLDEST provider input, and `limitingInput`
 * names that input as its definition saves it; unknown when any input does
 * not resolve or has no evidence (`input` names it the same way). */
export type CalculatedEvidence =
	| { readonly known: true; readonly advancedAt: number; readonly limitingInput: string }
	| { readonly known: false; readonly input?: string };

/**
 * A calculated reading's evidence, as a function of its inputs' evidence
 * only. Each provider input is resolved through `snapshot` (so an input
 * saved as either spelling of a linked pair finds its measurement), and
 * `evidenceOf(liveKey)` returns that measurement's last producer advance
 * (monotonic ms), or null/undefined when unknown. Nothing about the
 * calculation itself (when it ran, how often, its value) enters, so a
 * recalculation can never make a derived reading look fresher than the
 * inputs it was computed from. Calculated inputs recurse through the plan
 * (bounded by the depth limit).
 */
export function calculatedEvidenceOf(
	key: string,
	plan: CalculatedPlan,
	snapshot: Pick<SensorSnapshot, "byKey">,
	evidenceOf: (liveKey: string) => number | null | undefined
): CalculatedEvidence {
	const def = plan.byId.get(key);
	if (def === undefined) return { known: false };
	let oldest: { advancedAt: number; limitingInput: string } | undefined;
	for (const input of def.inputs) {
		let advancedAt: number;
		let limitingInput: string;
		const source = inputSourceOf(input, plan, snapshot.byKey);
		if ("def" in source) {
			const nested = calculatedEvidenceOf(input, plan, snapshot, evidenceOf);
			if (!nested.known) return nested;
			advancedAt = nested.advancedAt;
			limitingInput = nested.limitingInput;
		} else {
			if (source.reading === undefined) return { known: false, input };
			const at = evidenceOf(liveKeyOf(source.reading));
			if (at === null || at === undefined || !Number.isFinite(at)) return { known: false, input };
			advancedAt = at;
			limitingInput = input;
		}
		if (oldest === undefined || advancedAt < oldest.advancedAt) oldest = { advancedAt, limitingInput };
	}
	return oldest === undefined ? { known: false } : { known: true, ...oldest };
}
