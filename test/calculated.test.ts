// Calculated readings (steer 7G, ledger "CALC"): the pure model. Salvage
// of the global `calculatedReadings`, dimensional rules, evaluation outcomes
// (every failure is NaN with a named state, never a plausible zero), the
// earlier-only reference rule with its depth limit, generated and refused
// labels, revisions, non-mutation of the provider's snapshot, and evidence
// that comes from the inputs alone.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveDetailGroup } from "../src/detail/detail-group";
import {
	CALCULATED_INVALID_LABEL,
	CALCULATED_MISSING_INPUT_NAME,
	CALCULATED_OPS,
	CALCULATED_SOURCE_NAME,
	NO_CALCULATED_READINGS,
	calculatedEvidenceOf,
	calculatedExpression,
	calculatedExpressionOf,
	calculatedGeneratedLabel,
	calculatedHeldUnit,
	calculatedInfoOf,
	calculatedLabelRefusal,
	calculatedOpsFor,
	calculatedReadingsSignature,
	calculatedResultOf,
	calculatedUnitKind,
	convertCalculatedInput,
	measurementIdentityOf,
	mintCalculatedId,
	parseCalculatedReadings,
	withCalculatedReadings,
	type CalculatedOp,
	type CalculatedPlan,
	type CalculatedRefusal,
	type CalculatedState
} from "../src/hwinfo/calculated";
import { CALCULATED_KEY, SHARED_MEMORY_KEY, keyProducerOf } from "../src/hwinfo/key-namespace";
import { applyReadingLinks, liveKeyOf, parseReadingLinks } from "../src/hwinfo/reading-links";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { convertUnit, readingStatBadge, statValue } from "../src/ui/format";

const ID = (n: number): string => mintCalculatedId(new Uint8Array(16).fill(n));
const A = ID(1);
const B = ID(2);
const C = ID(3);
const D = ID(4);

const CPU_W = "f0001234:0:1000001";
const GPU_W = "e0002000:0:2000001";
const SOC_W = "f0001234:0:1000002";
const MEM_W = "f0001234:0:1000003";
const CPU_T = "f0001234:0:3000001";
const GPU_T = "e0002000:0:3000002";
const FAN = "f0001234:0:4000001";
const NET_MB = "a0000001:0:5000001";
const NET_KB = "a0000001:0:5000002";
const THROTTLE = "f0001234:0:6000001";
const PL = "f0001234:0:6000002";
const G_GPU = "g:GPU:GPU Power";

function r(key: string, label: string, unit: string, value: number, type: SensorType, sensorIndex = 0): Reading {
	return { key, type, sensorIndex, id: 1, label, unit, value, valueMin: value, valueMax: value, valueAvg: value };
}

function snap(readings: readonly Reading[], extra: Partial<SensorSnapshot> = {}): SensorSnapshot {
	return {
		pollTime: 1_800_000_000,
		valueRevision: 7,
		freshnessRevision: 5,
		version: 2,
		revision: 3,
		sensors: [
			{ index: 0, id: 0xf0001234, instance: 0, name: "CPU [#0]: Test CPU" },
			{ index: 1, id: 0xe0002000, instance: 0, name: "GPU [#0]: Test GPU" }
		],
		readings,
		byKey: new Map(readings.map((reading) => [reading.key, reading])),
		...extra
	};
}

function base(values: Partial<Record<string, number>> = {}): SensorSnapshot {
	const v = (key: string, fallback: number): number => values[key] ?? fallback;
	return snap([
		r(CPU_W, "CPU Package Power", "W", v(CPU_W, 120), SensorType.Power),
		r(SOC_W, "SoC Power", "W", v(SOC_W, 10), SensorType.Power),
		r(MEM_W, "Memory Power", "W", v(MEM_W, 6), SensorType.Power),
		r(GPU_W, "GPU Power", "W", v(GPU_W, 300), SensorType.Power, 1),
		r(CPU_T, "CPU (Tctl/Tdie)", "°C", v(CPU_T, 70), SensorType.Temperature),
		r(GPU_T, "GPU Temperature", "°C", v(GPU_T, 60), SensorType.Temperature, 1),
		r(FAN, "CPU Fan", "RPM", v(FAN, 1200), SensorType.Fan),
		r(NET_MB, "Download", "MB/s", v(NET_MB, 1), SensorType.Other),
		r(NET_KB, "Upload", "KB/s", v(NET_KB, 500), SensorType.Other),
		r(THROTTLE, "Thermal Throttling", "Yes/No", v(THROTTLE, 0), SensorType.Other),
		r(PL, "Power Limit Exceeded", "Yes/No", v(PL, 1), SensorType.Other)
	]);
}

type Row = { id?: unknown; op?: unknown; inputs?: unknown; unit?: unknown; sensorType?: unknown; label?: unknown; [extra: string]: unknown };

const powerSum = (id: string, inputs: readonly string[] = [CPU_W, GPU_W], extra: Row = {}): Row => ({ id, op: "sum", inputs: [...inputs], unit: "W", sensorType: SensorType.Power, ...extra });

function plan(rows: readonly unknown[]): CalculatedPlan {
	return parseCalculatedReadings(rows);
}

function calc(snapshot: SensorSnapshot, key: string): Reading {
	const reading = snapshot.byKey.get(key);
	assert.ok(reading !== undefined, `${key} resolves`);
	return reading;
}

function stateOf(reading: Reading): CalculatedState | undefined {
	return calculatedInfoOf(reading)?.state;
}

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !(value instanceof Map) && !Object.isFrozen(value)) {
		for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
		Object.freeze(value);
	}
	return value;
}

/** A tiny seeded generator so the property checks are reproducible. */
function prng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe("calculated reading ids and the key namespace", () => {
	it("mints calc: plus 22 base64url characters that only the calculated producer claims", () => {
		const id = mintCalculatedId();
		assert.match(id, CALCULATED_KEY);
		assert.equal(id.length, "calc:".length + 22);
		assert.equal(keyProducerOf(id), "calculated");
		assert.notEqual(mintCalculatedId(), id, "the default draws fresh random bytes");
		assert.equal(ID(0), "calc:AAAAAAAAAAAAAAAAAAAAAA");
		assert.throws(() => mintCalculatedId(new Uint8Array(15)), RangeError);
	});

	it("a calculated id never reads as a Shared Memory or Gadget key, and is never a link endpoint", () => {
		const next = prng(7);
		for (let i = 0; i < 2000; i++) {
			const bytes = new Uint8Array(16).map(() => Math.floor(next() * 256));
			const id = mintCalculatedId(bytes);
			assert.equal(SHARED_MEMORY_KEY.test(id), false);
			assert.equal(id.startsWith("g:") || id.startsWith("g2:"), false);
			assert.equal(keyProducerOf(id), "calculated");
		}
		assert.deepEqual(parseReadingLinks([{ sharedMemory: A, gadget: G_GPU, unit: "W", sensorType: 5 }]), []);
		assert.deepEqual(parseReadingLinks([{ sharedMemory: CPU_W, gadget: A, unit: "W", sensorType: 5 }]), []);
	});

	it("no Shared Memory or Gadget spelling classifies as calculated", () => {
		const next = prng(11);
		const hex = (n: number): string => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(next() * 16)]).join("");
		for (let i = 0; i < 2000; i++) {
			const sm = `${hex(1 + Math.floor(next() * 8))}:${Math.floor(next() * 1e6)}:${hex(1 + Math.floor(next() * 8))}`;
			assert.equal(keyProducerOf(sm), "shared-memory");
			assert.equal(CALCULATED_KEY.test(sm), false);
		}
		for (const key of [G_GPU, "g2:WyJhIiwiYiJd", "calc:short", "calc:AAAAAAAAAAAAAAAAAAAAAA=", "CALC:AAAAAAAAAAAAAAAAAAAAAA"]) {
			assert.notEqual(keyProducerOf(key), "calculated", key);
		}
	});
});

describe("parseCalculatedReadings salvage", () => {
	it("an absent, empty or non-array value is no calculated readings (the shared empty plan)", () => {
		for (const raw of [undefined, null, {}, "x", 5, true, []]) {
			assert.equal(parseCalculatedReadings(raw), NO_CALCULATED_READINGS, String(raw));
		}
		assert.deepEqual(NO_CALCULATED_READINGS.definitions, []);
		assert.equal(Object.isFrozen(NO_CALCULATED_READINGS), true);
	});

	it("a valid row becomes a definition with its result unit, type and depth", () => {
		const p = plan([powerSum(A)]);
		assert.equal(p.definitions.length, 1);
		const def = p.definitions[0];
		assert.ok(def !== undefined);
		assert.deepEqual(
			{ id: def.id, index: def.index, op: def.op, inputs: def.inputs, unit: def.unit, sensorType: def.sensorType, depth: def.depth, resultUnit: def.resultUnit, resultType: def.resultType, label: def.label },
			{ id: A, index: 0, op: "sum", inputs: [CPU_W, GPU_W], unit: "W", sensorType: SensorType.Power, depth: 1, resultUnit: "W", resultType: SensorType.Power, label: undefined }
		);
		assert.match(def.definitionRevision, /^[A-Za-z0-9_-]{16}$/);
		assert.deepEqual(p.rows, [{ index: 0, id: A, ok: true }]);
		assert.equal(p.byId.get(A), def);
		assert.deepEqual(p.invalid, []);
	});

	const refusals: readonly { name: string; row: unknown; reason: CalculatedRefusal; id?: string }[] = [
		{ name: "not an object", row: "calc", reason: "malformed" },
		{ name: "an array", row: [A, "sum"], reason: "malformed" },
		{ name: "null", row: null, reason: "malformed" },
		{ name: "no id", row: { op: "sum", inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5 }, reason: "malformed-id" },
		{ name: "a short id", row: powerSum("calc:abc"), reason: "malformed-id" },
		{ name: "a Shared Memory key as id", row: powerSum(CPU_W), reason: "malformed-id" },
		{ name: "an unknown operation", row: powerSum(A, undefined, { op: "multiply" }), reason: "unknown-op", id: A },
		{ name: "an operation of another case", row: powerSum(A, undefined, { op: "SUM" }), reason: "unknown-op", id: A },
		{ name: "percent spelled as its own operation", row: { id: A, op: "percent", inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5 }, reason: "unknown-op", id: A },
		{ name: "a percentage of a sum", row: powerSum(A, undefined, { percent: true }), reason: "malformed-percent", id: A },
		{ name: "a percentage of a difference", row: { id: A, op: "diff", inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5, percent: true }, reason: "malformed-percent", id: A },
		{ name: "a percent flag written as text", row: { id: A, op: "ratio", inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5, percent: "true" }, reason: "malformed-percent", id: A },
		{ name: "a percent flag written as 1", row: { id: A, op: "ratio", inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5, percent: 1 }, reason: "malformed-percent", id: A },
		{ name: "a null percent flag", row: { id: A, op: "ratio", inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5, percent: null }, reason: "malformed-percent", id: A },
		{ name: "a numeric unit", row: powerSum(A, undefined, { unit: 5 }), reason: "malformed-unit", id: A },
		{ name: "a unit over 32 characters", row: powerSum(A, undefined, { unit: "W".repeat(33) }), reason: "malformed-unit", id: A },
		{ name: "a fractional type", row: powerSum(A, undefined, { sensorType: 5.5 }), reason: "malformed-type", id: A },
		{ name: "a type past Other", row: powerSum(A, undefined, { sensorType: 9 }), reason: "malformed-type", id: A },
		{ name: "a string type", row: powerSum(A, undefined, { sensorType: "5" }), reason: "malformed-type", id: A },
		{ name: "inputs not an array", row: powerSum(A, undefined, { inputs: CPU_W }), reason: "malformed-input", id: A },
		{ name: "one input", row: powerSum(A, [CPU_W]), reason: "input-count", id: A },
		{ name: "nine inputs", row: powerSum(A, Array.from({ length: 9 }, (_, i) => `f0001234:0:${i + 1}`)), reason: "input-count", id: A },
		{ name: "three inputs to a difference", row: { id: A, op: "diff", inputs: [CPU_W, GPU_W, SOC_W], unit: "W", sensorType: 5 }, reason: "input-count", id: A },
		{ name: "a numeric input", row: powerSum(A, undefined, { inputs: [CPU_W, 5] }), reason: "malformed-input", id: A },
		{ name: "an empty input", row: powerSum(A, [CPU_W, ""]), reason: "malformed-input", id: A },
		{ name: "a 1.6 slot spelling", row: powerSum(A, [CPU_W, "~3"]), reason: "malformed-input", id: A },
		{ name: "an input of no known producer", row: powerSum(A, [CPU_W, "?:GPU Power"]), reason: "malformed-input", id: A },
		{ name: "an rm: input, a spelling no producer owns", row: powerSum(A, [CPU_W, "rm:pc2:f0001234:0:1000001"]), reason: "malformed-input", id: A },
		{ name: "an input over 512 characters", row: powerSum(A, [CPU_W, `g:${"x".repeat(511)}`]), reason: "malformed-input", id: A },
		{ name: "the same input twice", row: powerSum(A, [CPU_W, CPU_W]), reason: "duplicate-input", id: A },
		{ name: "a sum of temperatures", row: { id: A, op: "sum", inputs: [CPU_T, GPU_T], unit: "°C", sensorType: 1 }, reason: "op-not-allowed", id: A },
		{ name: "a ratio of temperatures", row: { id: A, op: "ratio", inputs: [CPU_T, GPU_T], unit: "°C", sensorType: 1 }, reason: "op-not-allowed", id: A },
		{ name: "a sum of fan speeds", row: { id: A, op: "sum", inputs: [FAN, CPU_W], unit: "RPM", sensorType: 3 }, reason: "op-not-allowed", id: A },
		{ name: "an average of Yes/No", row: { id: A, op: "avg", inputs: [THROTTLE, PL], unit: "Yes/No", sensorType: 8 }, reason: "op-not-allowed", id: A },
		{ name: "itself as an input", row: powerSum(A, [CPU_W, A]), reason: "self-reference", id: A },
		{ name: "a definition that does not exist", row: powerSum(A, [CPU_W, B]), reason: "missing-reference", id: A }
	];
	for (const { name, row, reason, id } of refusals) {
		it(`refuses ${name} (${reason}) and keeps the other rows`, () => {
			const p = plan([row, powerSum(D)]);
			assert.deepEqual(p.rows[0], id === undefined ? { index: 0, ok: false, reason } : { index: 0, id, ok: false, reason });
			assert.deepEqual(p.definitions.map((def) => def.id), [D]);
			assert.deepEqual(p.invalid, id === undefined ? [] : [{ id, index: 0 }]);
		});
	}

	it("accepts any known producer's spelling as an input", () => {
		const p = plan([powerSum(A, [CPU_W, G_GPU, "g2:WyJhIiwiYiJd"])]);
		assert.equal(p.definitions.length, 1);
	});

	it("more than 32 rows turns the whole list off; exactly 32 is fine", () => {
		const rows = Array.from({ length: 33 }, (_, i) => powerSum(ID(i + 10)));
		const over = plan(rows);
		assert.deepEqual({ overCap: over.overCap, defs: over.definitions.length, rows: over.rows.length, invalid: over.invalid.length }, { overCap: true, defs: 0, rows: 0, invalid: 0 });
		const snapshot = base();
		assert.equal(withCalculatedReadings(snapshot, over), snapshot, "an off list publishes nothing");
		const full = plan(rows.slice(0, 32));
		assert.equal(full.overCap, false);
		assert.equal(full.definitions.length, 32);
	});

	it("an id used twice invalidates every copy, whatever their order, and their dependents", () => {
		const p = plan([powerSum(A), powerSum(B, [CPU_W, A]), powerSum(A, [SOC_W, MEM_W]), powerSum(C)]);
		assert.deepEqual(p.rows.map((row) => (row.ok ? "ok" : row.reason)), ["duplicate-id", "invalid-reference", "duplicate-id", "ok"]);
		assert.deepEqual(p.invalid, [{ id: A, index: 0 }, { id: B, index: 1 }]);
		assert.deepEqual(p.definitions.map((def) => def.id), [C]);
	});

	it("references only reach earlier definitions: a later one is a forward reference", () => {
		const p = plan([powerSum(B, [CPU_W, A]), powerSum(A)]);
		assert.deepEqual(p.rows.map((row) => (row.ok ? "ok" : row.reason)), ["forward-reference", "ok"]);
		const fixed = plan([powerSum(A), powerSum(B, [CPU_W, A])]);
		assert.deepEqual(fixed.rows.map((row) => row.ok), [true, true]);
		assert.deepEqual(fixed.definitions.map((def) => def.depth), [1, 2]);
	});

	it("a two-definition cycle cannot be written down: one side is always a forward reference", () => {
		const p = plan([powerSum(A, [CPU_W, B]), powerSum(B, [GPU_W, A])]);
		assert.deepEqual(p.rows.map((row) => (row.ok ? "ok" : row.reason)), ["forward-reference", "invalid-reference"]);
		assert.deepEqual(p.definitions, []);
	});

	it("an invalid definition invalidates everything that builds on it", () => {
		const p = plan([powerSum(A, undefined, { op: "product" }), powerSum(B, [CPU_W, A]), powerSum(C, [GPU_W, B])]);
		assert.deepEqual(p.rows.map((row) => (row.ok ? "ok" : row.reason)), ["unknown-op", "invalid-reference", "invalid-reference"]);
		assert.deepEqual(p.invalid.map((entry) => entry.id), [A, B, C]);
	});

	it("nesting stops at depth 3", () => {
		const p = plan([powerSum(A), powerSum(B, [SOC_W, A]), powerSum(C, [MEM_W, B]), powerSum(D, [GPU_W, C])]);
		assert.deepEqual(p.rows.map((row) => (row.ok ? "ok" : row.reason)), ["ok", "ok", "ok", "too-deep"]);
		assert.deepEqual(p.definitions.map((def) => def.depth), [1, 2, 3]);
	});

	it("a referenced definition's result unit must convert into the referencing unit", () => {
		const diff = { id: A, op: "diff", inputs: [CPU_T, GPU_T], unit: "°C", sensorType: 1 };
		const asTemperature = { id: B, op: "avg", inputs: [A, CPU_T], unit: "°C", sensorType: 1 };
		const asDelta = { id: C, op: "sum", inputs: [A, "f0001234:0:3000009"], unit: "Δ°F", sensorType: 1 };
		const p = plan([diff, asTemperature, asDelta]);
		assert.deepEqual(p.rows.map((row) => (row.ok ? "ok" : row.reason)), ["ok", "unit-mismatch", "ok"]);
	});

	it("ignores unknown fields, never mutates the stored document and never throws on odd values", () => {
		const raw = deepFreeze([
			powerSum(A, undefined, { future: { nested: [1, 2] }, weight: 3 }),
			Object.assign(Object.create(null) as object, powerSum(B)),
			{ id: C, op: "sum", inputs: [[CPU_W], { key: GPU_W }], unit: "W", sensorType: 5 },
			{ id: D, op: "constructor", inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5 },
			{ id: "calc:" + "A".repeat(10_000), op: "sum", inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5 }
		]);
		const before = JSON.stringify(raw);
		const p = parseCalculatedReadings(raw);
		assert.equal(JSON.stringify(raw), before);
		assert.deepEqual(p.rows.map((row) => (row.ok ? "ok" : row.reason)), ["ok", "ok", "malformed-input", "unknown-op", "malformed-id"]);
		const holey: unknown[] = [];
		holey[1] = powerSum(A);
		assert.deepEqual(parseCalculatedReadings(holey).rows, [{ index: 0, ok: false, reason: "malformed" }, { index: 1, id: A, ok: true }], "a hole still gets a verdict");
	});

	it("parses the same document to the same signature, and reorders change it", () => {
		const rows = [powerSum(A), powerSum(B, [SOC_W, MEM_W])];
		assert.equal(calculatedReadingsSignature(plan(rows)), calculatedReadingsSignature(plan(JSON.parse(JSON.stringify(rows)) as unknown[])));
		assert.equal(calculatedReadingsSignature(plan([powerSum(A, undefined, { extra: 1 }), powerSum(B, [SOC_W, MEM_W])])), calculatedReadingsSignature(plan(rows)), "unknown fields are not meaning");
		assert.notEqual(calculatedReadingsSignature(plan([rows[1], rows[0]])), calculatedReadingsSignature(plan(rows)));
		assert.equal(calculatedReadingsSignature(NO_CALCULATED_READINGS), calculatedReadingsSignature(plan([])));
	});
});

describe("dimensional rules", () => {
	const matrix: readonly { unit: string; kind: string; ops: readonly CalculatedOp[] }[] = [
		{ unit: "W", kind: "power", ops: CALCULATED_OPS },
		{ unit: "A", kind: "current", ops: CALCULATED_OPS },
		{ unit: "MB", kind: "data", ops: CALCULATED_OPS },
		{ unit: "MB/s", kind: "data", ops: CALCULATED_OPS },
		{ unit: "Mbps", kind: "data", ops: CALCULATED_OPS },
		{ unit: "Δ°C", kind: "temperature-delta", ops: CALCULATED_OPS },
		{ unit: "Δ°F", kind: "temperature-delta", ops: CALCULATED_OPS },
		{ unit: "°C", kind: "temperature", ops: ["avg", "min", "max", "diff"] },
		{ unit: "°F", kind: "temperature", ops: ["avg", "min", "max", "diff"] },
		{ unit: "V", kind: "voltage", ops: ["avg", "min", "max", "diff", "ratio"] },
		{ unit: "MHz", kind: "clock", ops: ["avg", "min", "max", "diff", "ratio"] },
		{ unit: "RPM", kind: "fan", ops: ["avg", "min", "max", "diff", "ratio"] },
		{ unit: "%", kind: "percent", ops: ["avg", "min", "max", "diff", "ratio"] },
		{ unit: "Yes/No", kind: "boolean", ops: ["min", "max"] },
		{ unit: "FPS", kind: "other", ops: ["avg", "min", "max", "diff", "ratio"] },
		{ unit: "", kind: "other", ops: ["avg", "min", "max", "diff", "ratio"] },
		{ unit: "Wh", kind: "other", ops: CALCULATED_OPS }
	];
	for (const { unit, kind, ops } of matrix) {
		it(`${unit === "" ? "unitless" : unit} (${kind}) allows ${ops.join(", ")} and refuses the rest`, () => {
			assert.equal(calculatedUnitKind(unit), kind);
			assert.deepEqual(calculatedOpsFor(unit), ops);
			for (const op of CALCULATED_OPS) {
				const inputs = op === "diff" || op === "ratio" ? [CPU_W, GPU_W] : [CPU_W, GPU_W, SOC_W];
				const p = plan([{ id: A, op, inputs, unit, sensorType: SensorType.Other }]);
				const row = p.rows[0];
				assert.ok(row !== undefined);
				assert.equal(row.ok, ops.includes(op), `${op} on ${unit}`);
				if (!row.ok) assert.equal(row.reason, "op-not-allowed");
			}
			const asPercent = plan([{ id: A, op: "ratio", percent: true, inputs: [CPU_W, GPU_W], unit, sensorType: SensorType.Other }]).rows[0];
			assert.equal(asPercent?.ok, ops.includes("ratio"), `a percentage is allowed exactly where a ratio is (${unit})`);
		});
	}

	it("converts °C and °F both ways, deltas by 1.8 alone, and data units of one kind through their base", () => {
		assert.equal(convertCalculatedInput(122, "°F", "°C"), 50);
		assert.equal(convertCalculatedInput(50, "°C", "°F"), 122);
		assert.equal(convertCalculatedInput(18, "Δ°F", "Δ°C"), 10);
		assert.equal(convertCalculatedInput(10, "Δ°C", "Δ°F"), 18);
		assert.equal(convertCalculatedInput(500, "KB/s", "MB/s"), 0.5);
		assert.equal(convertCalculatedInput(1, "GiB", "MiB"), 1024);
		assert.equal(convertCalculatedInput(42, "W", "W"), 42);
		assert.equal(convertCalculatedInput(1, "MB/s", "Mbps"), undefined, "byte and bit rates are different kinds here");
		assert.equal(convertCalculatedInput(1, "MB", "MB/s"), undefined);
		assert.equal(convertCalculatedInput(1, "°C", "Δ°C"), undefined, "a temperature is not a difference");
		assert.equal(convertCalculatedInput(1, "W", "A"), undefined);
		assert.equal(convertCalculatedInput(1, "%", ""), undefined);
	});

	it("publishes a temperature difference as a delta, a ratio as x and a percentage as Usage %", () => {
		assert.deepEqual(calculatedResultOf("diff", "°C", SensorType.Temperature), { unit: "Δ°C", type: SensorType.Temperature });
		assert.deepEqual(calculatedResultOf("diff", "°F", SensorType.Temperature), { unit: "Δ°F", type: SensorType.Temperature });
		assert.deepEqual(calculatedResultOf("diff", "W", SensorType.Power), { unit: "W", type: SensorType.Power });
		assert.deepEqual(calculatedResultOf("avg", "°C", SensorType.Temperature), { unit: "°C", type: SensorType.Temperature });
		assert.deepEqual(calculatedResultOf("ratio", "W", SensorType.Power), { unit: "x", type: SensorType.Other });
		assert.deepEqual(calculatedResultOf("ratio", "W", SensorType.Power, false), { unit: "x", type: SensorType.Other });
		assert.deepEqual(calculatedResultOf("ratio", "W", SensorType.Power, true), { unit: "%", type: SensorType.Usage });
		assert.deepEqual(calculatedResultOf("sum", "W", SensorType.Power), { unit: "W", type: SensorType.Power });
	});

	it("the display conversion scales a Celsius difference by 1.8 with no offset", () => {
		const diff = withCalculatedReadings(base(), plan([{ id: A, op: "diff", inputs: [CPU_T, GPU_T], unit: "°C", sensorType: 1 }]));
		const reading = calc(diff, A);
		assert.deepEqual({ value: reading.value, unit: reading.unit }, { value: 10, unit: "Δ°C" });
		assert.deepEqual(convertUnit(reading.value, reading.unit, true), { value: 18, unit: "Δ°F" });
		assert.deepEqual(convertUnit(reading.value, reading.unit, false), { value: 10, unit: "Δ°C" });
		assert.deepEqual(convertUnit(18, "Δ°F", true), { value: 18, unit: "Δ°F" });
		assert.deepEqual(convertUnit(10, "°C", true), { value: 50, unit: "°F" }, "a temperature keeps its offset");
	});
});

describe("evaluation", () => {
	const two = (op: CalculatedOp, unit = "W", inputs: readonly string[] = [CPU_W, GPU_W], sensorType = SensorType.Power): Row => ({ id: A, op, inputs: [...inputs], unit, sensorType });

	const values: readonly { name: string; row: Row; value: number; unit: string; type: SensorType }[] = [
		{ name: "sum", row: powerSum(A, [CPU_W, GPU_W, SOC_W]), value: 430, unit: "W", type: SensorType.Power },
		{ name: "average", row: two("avg", "W", [CPU_W, GPU_W, SOC_W]), value: 430 / 3, unit: "W", type: SensorType.Power },
		{ name: "lowest", row: two("min", "W", [CPU_W, GPU_W, SOC_W]), value: 10, unit: "W", type: SensorType.Power },
		{ name: "highest", row: two("max", "W", [CPU_W, GPU_W, SOC_W]), value: 300, unit: "W", type: SensorType.Power },
		{ name: "difference", row: two("diff"), value: -180, unit: "W", type: SensorType.Power },
		{ name: "ratio", row: two("ratio"), value: 0.4, unit: "x", type: SensorType.Other },
		{ name: "percentage", row: { ...two("ratio"), percent: true }, value: 40, unit: "%", type: SensorType.Usage },
		{ name: "temperature difference", row: two("diff", "°C", [CPU_T, GPU_T], SensorType.Temperature), value: 10, unit: "Δ°C", type: SensorType.Temperature },
		{ name: "all Yes (lowest)", row: two("min", "Yes/No", [THROTTLE, PL], SensorType.Other), value: 0, unit: "Yes/No", type: SensorType.Other },
		{ name: "any Yes (highest)", row: two("max", "Yes/No", [THROTTLE, PL], SensorType.Other), value: 1, unit: "Yes/No", type: SensorType.Other },
		{ name: "data rates of two tiers", row: { id: A, op: "sum", inputs: [NET_MB, NET_KB], unit: "MB/s", sensorType: 8 }, value: 1.5, unit: "MB/s", type: SensorType.Other }
	];
	for (const { name, row, value, unit, type } of values) {
		it(`computes the ${name}`, () => {
			const reading = calc(withCalculatedReadings(base(), plan([row])), A);
			assert.equal(stateOf(reading), "ok");
			assert.equal(reading.value, value);
			assert.equal(reading.unit, unit);
			assert.equal(reading.type, type);
		});
	}

	describe("a temperature definition follows its inputs' unit, like the provider's readings", () => {
		const celsius = (): SensorSnapshot => base();
		const fahrenheit = (): SensorSnapshot => snap([r(CPU_T, "CPU (Tctl/Tdie)", "°F", 158, SensorType.Temperature), r(GPU_T, "GPU Temperature", "°F", 140, SensorType.Temperature, 1)]);
		const temperatureRows = (unit: string): Row[] => [two("avg", unit, [CPU_T, GPU_T], SensorType.Temperature), { ...two("diff", unit, [CPU_T, GPU_T], SensorType.Temperature), id: B }];
		const shown = (snapshot: SensorSnapshot, key: string, toFahrenheit: boolean): { value: number; unit: string } => {
			const reading = calc(snapshot, key);
			const out = convertUnit(reading.value, reading.unit, toFahrenheit);
			return { value: Math.round(out.value * 1e9) / 1e9, unit: out.unit };
		};

		it("saved while HWiNFO reported °F, it reads °C once HWiNFO is back on °C, and the Fahrenheit option converts it", () => {
			const out = withCalculatedReadings(celsius(), plan(temperatureRows("°F")));
			assert.deepEqual(shown(out, A, false), { value: 65, unit: "°C" });
			assert.deepEqual(shown(out, B, false), { value: 10, unit: "Δ°C" });
			const provider = calc(out, CPU_T);
			assert.deepEqual(convertUnit(provider.value, provider.unit, false), { value: 70, unit: "°C" }, "the same unit as the provider's reading next to it");
			assert.deepEqual(shown(out, A, true), { value: 149, unit: "°F" });
			assert.deepEqual(shown(out, B, true), { value: 18, unit: "Δ°F" });
		});

		it("saved in °C, it reads °F while HWiNFO reports °F, as the provider's readings do", () => {
			const out = withCalculatedReadings(fahrenheit(), plan(temperatureRows("°C")));
			assert.deepEqual(shown(out, A, false), { value: 149, unit: "°F" });
			assert.deepEqual(shown(out, B, false), { value: 18, unit: "Δ°F" });
			assert.equal(calc(out, CPU_T).unit, "°F");
			assert.deepEqual(shown(out, A, true), { value: 149, unit: "°F" }, "the Fahrenheit option leaves °F alone");
		});

		it("converts a mixed input into the first input's unit", () => {
			const mixed = snap([r(CPU_T, "CPU (Tctl/Tdie)", "°C", 70, SensorType.Temperature), r(GPU_T, "GPU Temperature", "°F", 140, SensorType.Temperature, 1)]);
			const out = withCalculatedReadings(mixed, plan(temperatureRows("°F")));
			assert.deepEqual(shown(out, A, false), { value: 65, unit: "°C" });
			assert.deepEqual(shown(out, B, false), { value: 10, unit: "Δ°C" });
		});

		it("a difference of differences follows the inputs into Δ°F", () => {
			const p = plan([
				two("diff", "°C", [CPU_T, GPU_T], SensorType.Temperature),
				{ ...two("diff", "°C", [GPU_T, CPU_T], SensorType.Temperature), id: B },
				{ id: C, op: "max", inputs: [A, B], unit: "Δ°C", sensorType: SensorType.Temperature }
			]);
			assert.deepEqual(shown(withCalculatedReadings(fahrenheit(), p), C, false), { value: 18, unit: "Δ°F" });
			assert.deepEqual(shown(withCalculatedReadings(celsius(), p), C, false), { value: 10, unit: "Δ°C" });
		});

		it("°C and °F (and Δ°C and Δ°F) are one definition: same unit, revision and signature", () => {
			assert.equal(calculatedHeldUnit("°F"), "°C");
			assert.equal(calculatedHeldUnit("Δ°F"), "Δ°C");
			assert.equal(calculatedHeldUnit("W"), "W");
			const savedF = plan(temperatureRows("°F"));
			const savedC = plan(temperatureRows("°C"));
			assert.deepEqual(savedF.definitions.map((def) => [def.unit, def.resultUnit, def.definitionRevision]), savedC.definitions.map((def) => [def.unit, def.resultUnit, def.definitionRevision]));
			assert.deepEqual(savedC.definitions.map((def) => def.resultUnit), ["°C", "Δ°C"]);
			assert.equal(calculatedReadingsSignature(savedF), calculatedReadingsSignature(savedC), "re-saving in the other spelling repaints nothing and resets nothing");
			const deltaRow = (unit: string): Row => ({ id: C, op: "sum", inputs: [A, "f0001234:0:3000009"], unit, sensorType: SensorType.Temperature });
			const heldF = plan([two("diff", "°C", [CPU_T, GPU_T], SensorType.Temperature), deltaRow("Δ°F")]).byId.get(C);
			const heldC = plan([two("diff", "°C", [CPU_T, GPU_T], SensorType.Temperature), deltaRow("Δ°C")]).byId.get(C);
			assert.ok(heldF !== undefined && heldC !== undefined);
			assert.deepEqual([heldF.unit, heldF.definitionRevision], [heldC.unit, heldC.definitionRevision]);
		});
	});

	it("publishes producer statistics as unavailable, so MIN/MAX/AVG read N/A", () => {
		const reading = calc(withCalculatedReadings(base(), plan([powerSum(A)])), A);
		assert.equal(reading.statistics, "unavailable");
		assert.ok(Number.isNaN(reading.valueMin) && Number.isNaN(reading.valueMax) && Number.isNaN(reading.valueAvg));
		for (const mode of ["min", "max", "avg"] as const) {
			assert.ok(Number.isNaN(statValue(reading, mode)));
			assert.equal(readingStatBadge(reading, mode), "N/A");
		}
		assert.equal(statValue(reading, "current"), 420);
	});

	const linked = (): SensorSnapshot => {
		// A Gadget-side snapshot where the Shared Memory key of GPU Power is a
		// confirmed alias of the Gadget key: both spellings are one measurement.
		const gadget = snap([r(CPU_W, "CPU Package Power", "W", 120, SensorType.Power), r(G_GPU, "GPU Power", "W", 300, SensorType.Power, 1)]);
		return applyReadingLinks(gadget, parseReadingLinks([{ sharedMemory: GPU_W, gadget: G_GPU, unit: "W", sensorType: 5 }]), 1);
	};

	const failures: readonly { name: string; snapshot: () => SensorSnapshot; row: Row; state: CalculatedState; input?: string; stale?: string }[] = [
		{ name: "an input that resolves to nothing", snapshot: () => base(), row: powerSum(A, [CPU_W, "f0009999:0:1"]), state: "input-missing", input: "f0009999:0:1" },
		{ name: "both spellings of one linked measurement", snapshot: linked, row: powerSum(A, [GPU_W, G_GPU]), state: "input-ambiguous", input: G_GPU },
		{ name: "an input whose unit changed", snapshot: () => base(), row: powerSum(A, [CPU_W, FAN]), state: "unit-mismatch", input: FAN },
		{ name: "an input stale on its own evidence", snapshot: () => base(), row: powerSum(A), state: "input-stale", input: GPU_W, stale: GPU_W },
		{ name: "a NaN input", snapshot: () => base({ [GPU_W]: Number.NaN }), row: powerSum(A), state: "input-non-finite", input: GPU_W },
		{ name: "an infinite input", snapshot: () => base({ [CPU_W]: Number.POSITIVE_INFINITY }), row: powerSum(A), state: "input-non-finite", input: CPU_W },
		{ name: "a zero divisor", snapshot: () => base({ [GPU_W]: 0 }), row: two("ratio"), state: "division-by-zero" },
		{ name: "a negative zero divisor", snapshot: () => base({ [GPU_W]: -0 }), row: two("ratio"), state: "division-by-zero" },
		{ name: "zero over zero", snapshot: () => base({ [CPU_W]: 0, [GPU_W]: 0 }), row: two("ratio"), state: "division-by-zero" },
		{ name: "a zero percentage base", snapshot: () => base({ [GPU_W]: 0 }), row: { ...two("ratio"), percent: true }, state: "division-by-zero" },
		{ name: "a sum past the largest number", snapshot: () => base({ [CPU_W]: 1e308, [GPU_W]: 1e308 }), row: powerSum(A), state: "overflow" },
		{ name: "a ratio past the largest number", snapshot: () => base({ [CPU_W]: 1e308, [GPU_W]: 1e-308 }), row: two("ratio"), state: "overflow" },
		{
			name: "an input that overflows when re-scaled",
			snapshot: () => snap([r(NET_MB, "Huge", "TB", 1e300, SensorType.Other), r(NET_KB, "Small", "B", 1, SensorType.Other)]),
			row: { id: A, op: "sum", inputs: [NET_MB, NET_KB], unit: "B", sensorType: 8 },
			state: "overflow",
			input: NET_MB
		}
	];
	for (const { name, snapshot, row, state, input, stale } of failures) {
		it(`${name} is ${state}: NaN, never zero`, () => {
			const out = withCalculatedReadings(snapshot(), plan([row]), stale === undefined ? undefined : { isInputStale: (key) => key === stale });
			const reading = calc(out, A);
			assert.ok(Number.isNaN(reading.value), `value ${reading.value}`);
			assert.equal(stateOf(reading), state);
			assert.equal(calculatedInfoOf(reading)?.failedInput, input);
		});
	}

	it("reads the stored percentage spelling, ratio with percent true, as a percentage and never as a fraction", () => {
		const rows = [
			{ id: A, op: "ratio", percent: true, inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5 },
			{ id: B, op: "ratio", percent: false, inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5 },
			{ id: C, op: "ratio", inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5 }
		];
		const p = plan(rows);
		assert.deepEqual(p.definitions.map((def) => [def.op, def.percent]), [["ratio", true], ["ratio", false], ["ratio", false]]);
		const out = withCalculatedReadings(base({ [CPU_W]: 7, [GPU_W]: 100 }), p);
		const percentage = calc(out, A);
		assert.deepEqual(
			{ value: percentage.value, unit: percentage.unit, type: percentage.type, label: percentage.label, state: stateOf(percentage), percent: calculatedInfoOf(percentage)?.percent },
			{ value: 7, unit: "%", type: SensorType.Usage, label: "CPU Package Power as % of GPU Power", state: "ok", percent: true }
		);
		for (const key of [B, C]) {
			const ratio = calc(out, key);
			assert.deepEqual({ value: ratio.value, unit: ratio.unit, type: ratio.type, label: ratio.label }, { value: 0.07, unit: "x", type: SensorType.Other, label: "CPU Package Power / GPU Power" });
		}
		assert.notEqual(p.byId.get(A)?.definitionRevision, p.byId.get(B)?.definitionRevision, "a percentage and a ratio are different measurements");
		assert.equal(p.byId.get(B)?.definitionRevision, p.byId.get(C)?.definitionRevision, "false and absent are the same plain ratio");
		assert.notEqual(calculatedReadingsSignature(plan([rows[0]])), calculatedReadingsSignature(plan([{ ...rows[0], percent: false }])));
	});

	it("keeps whole percentages whole, and divides first only where scaling would overflow", () => {
		const whole = calc(withCalculatedReadings(base({ [CPU_W]: 7, [GPU_W]: 100 }), plan([{ ...two("ratio"), percent: true }])), A);
		assert.equal(whole.value, 7);
		const huge = calc(withCalculatedReadings(base({ [CPU_W]: 1e307, [GPU_W]: 1e10 }), plan([{ ...two("ratio"), percent: true }])), A);
		assert.deepEqual({ value: huge.value, state: stateOf(huge) }, { value: (1e307 / 1e10) * 100, state: "ok" });
	});

	it("an average of huge finite inputs stays finite instead of overflowing", () => {
		const reading = calc(withCalculatedReadings(base({ [CPU_W]: 1e308, [GPU_W]: 1e308 }), plan([two("avg")])), A);
		assert.equal(stateOf(reading), "ok");
		assert.equal(reading.value, 1e308);
	});

	it("a genuine zero (equal inputs, fresh) is a value, not a failure", () => {
		const reading = calc(withCalculatedReadings(base({ [CPU_W]: 300 }), plan([two("diff")])), A);
		assert.deepEqual({ value: reading.value, state: stateOf(reading) }, { value: 0, state: "ok" });
	});

	it("names the strongest failure when several inputs fail: missing, ambiguous, unit, stale, then value", () => {
		const snapshot = base({ [CPU_W]: Number.NaN });
		const missingFirst = calc(withCalculatedReadings(snapshot, plan([powerSum(A, [CPU_W, FAN, "f0009999:0:1"])])), A);
		assert.deepEqual({ state: stateOf(missingFirst), input: calculatedInfoOf(missingFirst)?.failedInput }, { state: "input-missing", input: "f0009999:0:1" });
		const unitBeforeValue = calc(withCalculatedReadings(snapshot, plan([powerSum(A, [CPU_W, FAN])])), A);
		assert.equal(stateOf(unitBeforeValue), "unit-mismatch");
		const staleBeforeValue = calc(withCalculatedReadings(snapshot, plan([powerSum(A)]), { isInputStale: (key) => key === GPU_W }), A);
		assert.equal(stateOf(staleBeforeValue), "input-stale");
		const firstOfEqualRank = calc(withCalculatedReadings(snapshot, plan([powerSum(A, [CPU_W, "f0009999:0:1", "f0009999:0:2"])])), A);
		assert.equal(calculatedInfoOf(firstOfEqualRank)?.failedInput, "f0009999:0:1");
	});

	it("an input saved as the alias of a linked pair resolves like its provider key", () => {
		const reading = calc(withCalculatedReadings(linked(), plan([powerSum(A, [CPU_W, GPU_W])])), A);
		assert.deepEqual({ value: reading.value, state: stateOf(reading) }, { value: 420, state: "ok" });
	});

	describe("a sum or average counts each measurement once, through nesting", () => {
		const ambiguous = (snapshot: SensorSnapshot, rows: readonly Row[], key: string, input: string): void => {
			const reading = calc(withCalculatedReadings(snapshot, plan(rows)), key);
			assert.ok(Number.isNaN(reading.value), `value ${reading.value}`);
			assert.deepEqual({ state: stateOf(reading), input: calculatedInfoOf(reading)?.failedInput }, { state: "input-ambiguous", input });
		};

		it("refuses a nested sum that adds a linked measurement again under its other spelling", () => {
			// On the Gadget side GPU_W is the alias of G_GPU: A already holds the GPU.
			ambiguous(linked(), [powerSum(A, [CPU_W, GPU_W]), powerSum(B, [A, G_GPU])], B, G_GPU);
		});

		it("refuses the same key added again on top of a sum, an average over an average, and a repeat three levels down", () => {
			ambiguous(base(), [powerSum(A), powerSum(B, [A, GPU_W])], B, GPU_W);
			ambiguous(base(), [two("avg"), { id: B, op: "avg", inputs: [A, GPU_W], unit: "W", sensorType: 5 }], B, GPU_W);
			ambiguous(base(), [powerSum(A, [CPU_W, SOC_W]), powerSum(B, [A, MEM_W]), powerSum(C, [B, CPU_W])], C, CPU_W);
			ambiguous(base(), [powerSum(A, [CPU_W, SOC_W]), powerSum(B, [GPU_W, SOC_W]), powerSum(C, [A, B])], C, B);
		});

		it("carries the ambiguity to everything built on it", () => {
			const out = withCalculatedReadings(base(), plan([powerSum(A), powerSum(B, [A, GPU_W]), { id: C, op: "diff", inputs: [B, SOC_W], unit: "W", sensorType: 5 }]));
			assert.deepEqual({ state: stateOf(calc(out, C)), input: calculatedInfoOf(calc(out, C))?.failedInput }, { state: "input-ambiguous", input: B });
		});

		it("lets a difference take a measurement back out, and sums of disjoint sums add up", () => {
			const p = plan([
				powerSum(A),
				{ id: B, op: "diff", inputs: [A, CPU_W], unit: "W", sensorType: 5 },
				powerSum(C, [B, CPU_W]),
				powerSum(D, [SOC_W, MEM_W])
			]);
			const out = withCalculatedReadings(base(), p);
			assert.deepEqual({ value: calc(out, B).value, state: stateOf(calc(out, B)) }, { value: 300, state: "ok" }, "(CPU + GPU) - CPU is the GPU");
			assert.deepEqual({ value: calc(out, C).value, state: stateOf(calc(out, C)) }, { value: 420, state: "ok" }, "a difference is a new quantity, not a pool");
			const disjoint = withCalculatedReadings(base(), plan([powerSum(A), powerSum(D, [SOC_W, MEM_W]), powerSum(B, [A, D])]));
			assert.deepEqual({ value: calc(disjoint, B).value, state: stateOf(calc(disjoint, B)) }, { value: 436, state: "ok" });
		});
	});

	it("evaluates references to earlier definitions in one forward pass", () => {
		const p = plan([powerSum(A), { id: B, op: "ratio", percent: true, inputs: [CPU_W, A], unit: "W", sensorType: 5 }, { id: C, op: "diff", inputs: [B, "f0001234:0:7000001"], unit: "%", sensorType: 7 }]);
		const snapshot = snap([...base().readings, r("f0001234:0:7000001", "CPU Total Usage", "%", 20, SensorType.Usage)]);
		const out = withCalculatedReadings(snapshot, p);
		assert.equal(calc(out, A).value, 420);
		assert.ok(Math.abs(calc(out, B).value - (120 / 420) * 100) < 1e-12);
		assert.ok(Math.abs(calc(out, C).value - ((120 / 420) * 100 - 20)) < 1e-12);
	});

	it("carries a calculated input's identity and freshness failures through, and its arithmetic failures as no value", () => {
		const p = plan([powerSum(A, [CPU_W, "f0009999:0:1"]), powerSum(B, [SOC_W, A]), { id: C, op: "ratio", inputs: [CPU_W, GPU_W], unit: "W", sensorType: 5 }, { id: D, op: "avg", inputs: [C, "a0000001:0:9"], unit: "x", sensorType: 8 }]);
		const snapshot = snap([...base({ [GPU_W]: 0 }).readings, r("a0000001:0:9", "Multiplier", "x", 1, SensorType.Other)]);
		const out = withCalculatedReadings(snapshot, p);
		assert.deepEqual({ state: stateOf(calc(out, B)), input: calculatedInfoOf(calc(out, B))?.failedInput }, { state: "input-missing", input: A });
		assert.equal(stateOf(calc(out, C)), "division-by-zero");
		assert.deepEqual({ state: stateOf(calc(out, D)), input: calculatedInfoOf(calc(out, D))?.failedInput }, { state: "input-non-finite", input: C });
		assert.ok(Number.isNaN(calc(out, B).value) && Number.isNaN(calc(out, D).value));
	});

	it("an invalid definition's id resolves to an invalid-definition entry that is never listed", () => {
		const out = withCalculatedReadings(base(), plan([powerSum(A, undefined, { op: "product" }), powerSum(B)]));
		const invalid = calc(out, A);
		assert.deepEqual(
			{ state: stateOf(invalid), op: calculatedInfoOf(invalid)?.op, label: invalid.label, unit: invalid.unit, statistics: invalid.statistics },
			{ state: "invalid-definition", op: null, label: CALCULATED_INVALID_LABEL, unit: "", statistics: "unavailable" }
		);
		assert.ok(Number.isNaN(invalid.value));
		assert.deepEqual(out.readings.filter((reading) => calculatedInfoOf(reading) !== undefined).map((reading) => reading.key), [B]);
	});
});

describe("labels", () => {
	const label = (row: Row, snapshot = base()): string => calc(withCalculatedReadings(snapshot, plan([row])), String(row.id)).label;

	it("names a sum of reported powers as that sum", () => {
		assert.equal(label(powerSum(A)), "CPU Package Power + GPU Power");
		assert.equal(label(powerSum(A, [CPU_W, GPU_W, SOC_W])), "CPU Package Power + GPU Power + SoC Power");
		assert.equal(label(powerSum(A, [CPU_W, GPU_W, SOC_W, MEM_W])), "Sum of 4 readings");
	});

	it("generates a label for every operation", () => {
		const row = (op: CalculatedOp, inputs: readonly string[], unit = "W"): Row => ({ id: A, op, inputs: [...inputs], unit, sensorType: 5 });
		assert.equal(label(row("avg", [CPU_W, GPU_W])), "Average of CPU Package Power and GPU Power");
		assert.equal(label(row("avg", [CPU_W, GPU_W, SOC_W])), "Average of CPU Package Power, GPU Power and SoC Power");
		assert.equal(label(row("min", [CPU_W, GPU_W])), "Lowest of CPU Package Power and GPU Power");
		assert.equal(label(row("max", [CPU_W, GPU_W, SOC_W, MEM_W])), "Highest of 4 readings");
		assert.equal(label(row("diff", [CPU_T, GPU_T], "°C")), "CPU (Tctl/Tdie) - GPU Temperature");
		assert.equal(label(row("ratio", [CPU_W, GPU_W])), "CPU Package Power / GPU Power");
		assert.equal(label({ ...row("ratio", [CPU_W, GPU_W]), percent: true }), "CPU Package Power as % of GPU Power");
		assert.equal(label(row("min", [THROTTLE, PL], "Yes/No")), "Thermal Throttling and Power Limit Exceeded");
		assert.equal(label(row("max", [THROTTLE, PL], "Yes/No")), "Thermal Throttling or Power Limit Exceeded");
		assert.equal(calculatedGeneratedLabel({ op: "max", percent: false, unit: "Yes/No" }, ["a", "b", "c", "d"]), "Any of 4 readings");
		assert.equal(calculatedGeneratedLabel({ op: "min", percent: false, unit: "Yes/No" }, ["a", "b", "c", "d"]), "All of 4 readings");
	});

	it("names a missing input as missing, and groups a calculated input in parentheses", () => {
		assert.equal(label(powerSum(A, [CPU_W, "f0009999:0:1"])), `CPU Package Power + ${CALCULATED_MISSING_INPUT_NAME}`);
		const out = withCalculatedReadings(base(), plan([powerSum(A), { id: B, op: "diff", inputs: [A, SOC_W], unit: "W", sensorType: 5 }, powerSum(C, [CPU_W, GPU_W], { label: "CPU+GPU" }), { id: D, op: "diff", inputs: [C, SOC_W], unit: "W", sensorType: 5 }]));
		assert.equal(calc(out, B).label, "(CPU Package Power + GPU Power) - SoC Power");
		assert.equal(calc(out, D).label, "CPU+GPU - SoC Power", "a custom label is used as written");
	});

	it("the expression names every input, the label shortens past three", () => {
		const p = plan([
			powerSum(A, [CPU_W, GPU_W, SOC_W, MEM_W]),
			{ id: B, op: "diff", inputs: [A, SOC_W], unit: "W", sensorType: 5 },
			powerSum(C, [CPU_W, GPU_W], { label: "CPU+GPU" }),
			{ id: D, op: "ratio", percent: true, inputs: [C, "f0009999:0:1"], unit: "W", sensorType: 5 }
		]);
		const out = withCalculatedReadings(base(), p);
		assert.equal(calculatedExpressionOf(A, p, out), "CPU Package Power + GPU Power + SoC Power + Memory Power");
		assert.equal(calc(out, B).label, "(Sum of 4 readings) - SoC Power");
		assert.equal(calculatedExpressionOf(B, p, out), "(CPU Package Power + GPU Power + SoC Power + Memory Power) - SoC Power");
		assert.equal(calculatedExpressionOf(B, p, base()), calculatedExpressionOf(B, p, out), "the linked snapshot names the same inputs");
		assert.equal(calculatedExpressionOf(D, p, out), `CPU+GPU as % of ${CALCULATED_MISSING_INPUT_NAME}`, "a custom label as written, a missing input as missing");
		assert.equal(calculatedExpressionOf(CPU_W, p, out), undefined, "not a calculated reading");
		assert.equal(calculatedExpression({ op: "avg", percent: false, unit: "W" }, ["a", "b", "c", "d"]), "Average of a, b, c and d");
	});

	it("uses a custom label, trimmed, when it is acceptable", () => {
		assert.equal(label(powerSum(A, undefined, { label: "  CPU and GPU reported power " })), "CPU and GPU reported power");
		assert.equal(label(powerSum(A, undefined, { label: "   " })), "CPU Package Power + GPU Power", "a blank label is no label");
	});

	const refused = [
		"Wall power",
		"System Power",
		"Total",
		"PSU draw",
		"Outlet",
		"SystemPower",
		"PSU1",
		"total_W",
		"WALLS",
		"My PC (system)",
		"Total power",
		// Run together, all caps, lowercase compounds and an acronym run into the next word.
		"PSUPower",
		"TOTALPOWER",
		"Totalpower",
		"systempower",
		"WALLPOWER",
		"Systemwide power",
		"cputotal",
		"TotalSystemPower",
		// An allowed word does not shelter a claim next to it.
		"Subtotal (system)",
		// Width variants fold into the plain letters.
		"ＴＯＴＡＬ"
	];
	for (const text of refused) {
		it(`refuses "${text}" on a power sum and falls back to the generated label`, () => {
			assert.equal(calculatedLabelRefusal("sum", "W", text), "claims-system-power");
			const p = plan([powerSum(A, undefined, { label: text })]);
			assert.deepEqual(p.rows[0], { index: 0, id: A, ok: true, labelRefusal: "claims-system-power" });
			assert.equal(p.definitions[0]?.label, undefined);
			assert.equal(calc(withCalculatedReadings(base(), p), A).label, "CPU Package Power + GPU Power");
		});
	}

	it("accepts the same words where they claim nothing about wall power", () => {
		assert.equal(calculatedLabelRefusal("sum", "W", "CPU + GPU"), undefined);
		assert.equal(calculatedLabelRefusal("sum", "W", "Subtotal"), undefined, "a subtotal is what a sum of some sensors is");
		assert.equal(calculatedLabelRefusal("sum", "W", "CPU and GPU subtotals"), undefined);
		assert.equal(calculatedLabelRefusal("sum", "W", "Memory subsystem"), undefined, "a subsystem is a part, not the machine");
		assert.equal(calculatedLabelRefusal("sum", "W", "Reported CPU+GPU power"), undefined);
		assert.equal(calculatedLabelRefusal("sum", "MB/s", "Total throughput"), undefined, "not a power sum");
		assert.equal(calculatedLabelRefusal("max", "W", "Highest system rail"), undefined, "the rule covers power sums (ledger scope)");
	});

	it("refuses labels that are too long, carry control characters, or are not text", () => {
		assert.equal(calculatedLabelRefusal("avg", "°C", "x".repeat(65)), "too-long");
		assert.equal(calculatedLabelRefusal("avg", "°C", "x".repeat(64)), undefined);
		assert.equal(calculatedLabelRefusal("avg", "°C", "CPU\nGPU"), "control-character");
		assert.equal(calculatedLabelRefusal("avg", "°C", "CPU\u0085GPU"), "control-character");
		const p = plan([{ id: A, op: "avg", inputs: [CPU_T, GPU_T], unit: "°C", sensorType: 1, label: 5 }]);
		assert.deepEqual(p.rows[0], { index: 0, id: A, ok: true, labelRefusal: "not-text" });
	});
});

describe("revisions and measurement identity", () => {
	const revision = (row: Row, rows: readonly Row[] = []): string => {
		const p = plan([...rows, row]);
		const def = p.byId.get(String(row.id));
		assert.ok(def !== undefined, "the row is valid");
		return def.definitionRevision;
	};

	it("changes with the operation, inputs, unit or type, never with the label", () => {
		const r0 = revision(powerSum(A));
		assert.equal(revision(powerSum(A, undefined, { label: "CPU and GPU" })), r0);
		assert.notEqual(revision(powerSum(A, undefined, { op: "avg" })), r0);
		assert.notEqual(revision(powerSum(A, [CPU_W, SOC_W])), r0);
		assert.notEqual(revision(powerSum(A, undefined, { sensorType: SensorType.Other })), r0);
		assert.notEqual(revision({ id: A, op: "avg", inputs: [NET_MB, NET_KB], unit: "MB/s", sensorType: 8 }), revision({ id: A, op: "avg", inputs: [NET_MB, NET_KB], unit: "KB/s", sensorType: 8 }));
		assert.equal(revision(powerSum(B)), r0, "the revision is the meaning, independent of the id");
	});

	it("input order matters only to the operations where it changes the result", () => {
		assert.equal(revision(powerSum(A, [CPU_W, GPU_W])), revision(powerSum(A, [GPU_W, CPU_W])));
		const diff = (inputs: readonly string[]): Row => ({ id: A, op: "diff", inputs: [...inputs], unit: "W", sensorType: 5 });
		assert.notEqual(revision(diff([CPU_W, GPU_W])), revision(diff([GPU_W, CPU_W])));
	});

	it("a changed definition changes every definition built on it", () => {
		const dependent = powerSum(B, [SOC_W, A]);
		assert.notEqual(revision(dependent, [powerSum(A)]), revision(dependent, [powerSum(A, [CPU_W, MEM_W])]));
		assert.equal(revision(dependent, [powerSum(A)]), revision(dependent, [powerSum(A, undefined, { label: "Renamed" })]));
	});

	it("a label edit is a signature change (repaint) without a revision change (no reset)", () => {
		const plain = plan([powerSum(A)]);
		const named = plan([powerSum(A, undefined, { label: "CPU and GPU" })]);
		assert.notEqual(calculatedReadingsSignature(plain), calculatedReadingsSignature(named));
		const out = (p: CalculatedPlan): string => measurementIdentityOf(calc(withCalculatedReadings(base(), p), A));
		assert.equal(out(plain), out(named));
	});

	it("provider readings keep exactly their live identity (legacy sessions and history unchanged)", () => {
		const snapshot = applyReadingLinks(base(), parseReadingLinks([{ sharedMemory: GPU_W, gadget: G_GPU, unit: "W", sensorType: 5 }]), 1);
		for (const reading of [...snapshot.readings, ...snapshot.byKey.values()]) {
			assert.equal(measurementIdentityOf(reading), liveKeyOf(reading));
		}
		assert.equal(measurementIdentityOf(calc(snapshot, G_GPU)), GPU_W);
	});

	it("a calculated reading's identity follows its definition and what its inputs resolve to", () => {
		const p = plan([powerSum(A, [CPU_W, G_GPU]), powerSum(B, [SOC_W, A])]);
		const plainOut = withCalculatedReadings(snap([...base().readings, r(G_GPU, "GPU Power", "W", 300, SensorType.Power, 1)]), p);
		const info = calculatedInfoOf(calc(plainOut, A));
		assert.equal(info?.revision, info?.definitionRevision, "inputs that stand for themselves add nothing");
		const pairedTo = (sharedMemory: string): SensorSnapshot => applyReadingLinks(base(), parseReadingLinks([{ sharedMemory, gadget: G_GPU, unit: "W", sensorType: 5 }]), 1);
		const first = withCalculatedReadings(pairedTo(GPU_W), p);
		const repaired = withCalculatedReadings(pairedTo(MEM_W), p);
		assert.notEqual(measurementIdentityOf(calc(first, A)), measurementIdentityOf(calc(plainOut, A)));
		assert.notEqual(measurementIdentityOf(calc(first, A)), measurementIdentityOf(calc(repaired, A)), "a re-paired input is another measurement");
		assert.notEqual(measurementIdentityOf(calc(first, B)), measurementIdentityOf(calc(repaired, B)), "and so is everything built on it");
		assert.equal(measurementIdentityOf(calc(first, A)), measurementIdentityOf(calc(withCalculatedReadings(pairedTo(GPU_W), p), A)), "deterministic");
		assert.equal(measurementIdentityOf(calc(first, A)).startsWith(`${A}#`), true);
	});
});

describe("withCalculatedReadings leaves the provider's snapshot alone", () => {
	it("returns the same instance when there is nothing to publish", () => {
		const snapshot = base();
		assert.equal(withCalculatedReadings(snapshot, NO_CALCULATED_READINGS), snapshot);
		assert.equal(withCalculatedReadings(snapshot, parseCalculatedReadings(undefined)), snapshot);
		assert.equal(withCalculatedReadings(snapshot, plan(Array.from({ length: 33 }, (_, i) => powerSum(ID(i + 10))))), snapshot);
	});

	it("adds readings, keys and the Calculated source to a new snapshot and touches nothing else", () => {
		const snapshot = deepFreeze(base());
		const keysBefore = [...snapshot.byKey.keys()];
		const readingsBefore = [...snapshot.readings];
		const p = plan([powerSum(A), { id: B, op: "diff", inputs: [CPU_T, GPU_T], unit: "°C", sensorType: 1 }, powerSum(C, undefined, { op: "product" })]);
		const out = withCalculatedReadings(snapshot, p);
		assert.notEqual(out, snapshot);
		assert.deepEqual([...snapshot.byKey.keys()], keysBefore, "the provider's map is unchanged");
		assert.equal(snapshot.readings.length, readingsBefore.length);
		snapshot.readings.forEach((reading, i) => assert.equal(reading, readingsBefore[i]));
		assert.equal(snapshot.sensors.length, 2);
		assert.deepEqual(out.readings.slice(0, readingsBefore.length), readingsBefore, "provider readings first, the same objects");
		assert.deepEqual(out.readings.slice(readingsBefore.length).map((reading) => reading.key), [A, B]);
		assert.equal(out.byKey.size, keysBefore.length + 3);
		assert.deepEqual(out.sensors.at(-1), { index: 2, id: 0, instance: 0, name: CALCULATED_SOURCE_NAME });
		assert.ok(out.readings.slice(readingsBefore.length).every((reading) => reading.sensorIndex === 2));
		for (const field of ["pollTime", "valueRevision", "freshnessRevision", "bindingRevision", "version", "revision", "blockedReadingCount"] as const) {
			assert.equal(out[field], snapshot[field], field);
		}
	});

	it("never shadows a key the provider publishes", () => {
		const own = r(A, "Provider row", "W", 1, SensorType.Power);
		const snapshot = snap([...base().readings, own]);
		const out = withCalculatedReadings(snapshot, plan([powerSum(A), powerSum(B, [CPU_W, A])]));
		assert.equal(out.byKey.get(A), own);
		assert.equal(out.readings.filter((reading) => reading.key === A).length, 1);
		assert.equal(calc(out, B).value, 121, "a reference reads what the key resolves to");
	});

	it("only invalid rows publish their ids without listing anything", () => {
		const snapshot = base();
		const out = withCalculatedReadings(snapshot, plan([powerSum(A, undefined, { op: "product" })]));
		assert.equal(out.readings, snapshot.readings);
		assert.equal(stateOf(calc(out, A)), "invalid-definition");
	});

	it("decorating the same snapshot again gives the same values and does not accumulate", () => {
		const snapshot = base();
		const p = plan([powerSum(A)]);
		const once = withCalculatedReadings(snapshot, p);
		const twice = withCalculatedReadings(snapshot, p);
		assert.equal(once.readings.length, twice.readings.length);
		assert.deepEqual(calc(once, A), calc(twice, A));
	});

	it("takes part in detail filters and source lists as the Calculated source", () => {
		const out = withCalculatedReadings(base(), plan([powerSum(A), { id: B, op: "diff", inputs: [CPU_T, GPU_T], unit: "°C", sensorType: 1 }]));
		const filtered = resolveDetailGroup(out, { readingKey: CPU_W, detailMode: "filter", detailFilter: "calculated*" });
		assert.deepEqual(filtered?.keys, [A, B]);
		const source = resolveDetailGroup(out, { readingKey: A, detailMode: "source" });
		assert.deepEqual({ title: source?.title, keys: source?.keys }, { title: CALCULATED_SOURCE_NAME, keys: [B] });
	});
});

describe("per-snapshot work stays bounded at the worst legal nesting", () => {
	// 32 definitions: 8 sums of 8 provider readings, 8 sums of those 8, and
	// 16 sums of those. The expression of a top sum names 8 x 8 x 8 inputs.
	const providers = Array.from({ length: 64 }, (_, i) => r(`f0001234:0:${(0x1000000 + i).toString(16)}`, `Rail ${i} Power`, "W", i, SensorType.Power));
	const leafSums = Array.from({ length: 8 }, (_, i) => powerSum(ID(10 + i), providers.slice(i * 8, i * 8 + 8).map((reading) => reading.key)));
	const midSums = Array.from({ length: 8 }, (_, i) => powerSum(ID(30 + i), leafSums.map((row) => String(row.id))));
	const topSums = Array.from({ length: 16 }, (_, i) => powerSum(ID(50 + i), midSums.map((row) => String(row.id))));
	const p = plan([...leafSums, ...midSums, ...topSums]);
	const snapshot = snap(providers);

	it("publishes no expression per snapshot, and labels stay short", () => {
		assert.equal(p.definitions.length, 32);
		const out = withCalculatedReadings(snapshot, p);
		const published = out.readings.filter((reading) => calculatedInfoOf(reading) !== undefined);
		assert.equal(published.length, 32);
		for (const reading of published) assert.equal(Object.hasOwn(calculatedInfoOf(reading) ?? {}, "expression"), false);
		const labelCharacters = published.reduce((total, reading) => total + reading.label.length, 0);
		assert.ok(labelCharacters < 2048, `${labelCharacters} label characters`);
		assert.equal(calc(out, ID(30)).value, 2016, "a sum of the 8 disjoint sums is the sum of all 64 rails");
		assert.equal(stateOf(calc(out, ID(50))), "input-ambiguous", "each mid sum holds all 64 rails, so a sum of them counts every rail 8 times");
	});

	it("builds the full expression on demand, naming every input through every level", () => {
		const expression = calculatedExpressionOf(ID(50), p, withCalculatedReadings(snapshot, p)) ?? "";
		assert.equal(expression.match(/Rail \d+ Power/g)?.length, 512);
	});
});

describe("evidence comes from the inputs alone", () => {
	const p = plan([powerSum(A, [CPU_W, GPU_W, SOC_W]), powerSum(B, [MEM_W, A])]);
	const clock: Record<string, number | null> = { [CPU_W]: 5000, [GPU_W]: 3000, [SOC_W]: 4000, [MEM_W]: 6000 };
	const evidenceOf = (key: string): number | null | undefined => clock[key];
	const decorated = withCalculatedReadings(base(), p);

	it("is as old as the oldest input, and names it", () => {
		assert.deepEqual(calculatedEvidenceOf(A, p, decorated, evidenceOf), { known: true, advancedAt: 3000, limitingInput: GPU_W });
	});

	it("recurses through calculated inputs to their provider inputs, on the decorated or the linked snapshot", () => {
		for (const snapshot of [decorated, base()]) {
			assert.deepEqual(calculatedEvidenceOf(B, p, snapshot, evidenceOf), { known: true, advancedAt: 3000, limitingInput: GPU_W });
			assert.deepEqual(calculatedEvidenceOf(B, p, snapshot, (key) => (key === MEM_W ? 1000 : clock[key])), { known: true, advancedAt: 1000, limitingInput: MEM_W });
		}
	});

	it("asks for the measurement an input saved as a linked alias resolves to", () => {
		// Shared Memory publishes GPU_W; the definition saved the Gadget
		// spelling of the same confirmed pair. The evidence clock knows the
		// provider's key only.
		const linkedSm = applyReadingLinks(base(), parseReadingLinks([{ sharedMemory: GPU_W, gadget: G_GPU, unit: "W", sensorType: 5 }]), 1);
		const aliasPlan = plan([powerSum(A, [CPU_W, G_GPU])]);
		const asked: string[] = [];
		const evidence = calculatedEvidenceOf(A, aliasPlan, withCalculatedReadings(linkedSm, aliasPlan), (key) => {
			asked.push(key);
			return clock[key];
		});
		assert.deepEqual(evidence, { known: true, advancedAt: 3000, limitingInput: G_GPU });
		assert.deepEqual(asked, [CPU_W, GPU_W]);
		assert.deepEqual(calculatedEvidenceOf(A, aliasPlan, base(), evidenceOf), { known: false, input: G_GPU }, "without the link the input resolves to nothing");
	});

	it("is unknown when any input does not resolve or has no evidence", () => {
		for (const missing of [null, undefined, Number.NaN]) {
			assert.deepEqual(calculatedEvidenceOf(B, p, decorated, (key) => (key === SOC_W ? missing : clock[key])), { known: false, input: SOC_W });
		}
		const gone = snap(base().readings.filter((reading) => reading.key !== SOC_W));
		assert.deepEqual(calculatedEvidenceOf(B, p, gone, evidenceOf), { known: false, input: SOC_W }, "an input that resolves to nothing");
		assert.deepEqual(calculatedEvidenceOf(C, p, decorated, evidenceOf), { known: false }, "no such definition");
		assert.deepEqual(calculatedEvidenceOf(CPU_W, p, decorated, evidenceOf), { known: false }, "not a calculated reading");
	});

	it("recalculating never renews it: evidence fields pass through and evidence ignores the calculation", () => {
		const snapshot = base();
		const before = calculatedEvidenceOf(A, p, decorated, evidenceOf);
		let out = snapshot;
		for (let i = 0; i < 5; i++) out = withCalculatedReadings(snapshot, p);
		assert.deepEqual(
			{ pollTime: out.pollTime, valueRevision: out.valueRevision, freshnessRevision: out.freshnessRevision },
			{ pollTime: snapshot.pollTime, valueRevision: snapshot.valueRevision, freshnessRevision: snapshot.freshnessRevision }
		);
		assert.deepEqual(calculatedEvidenceOf(A, p, out, evidenceOf), before);
		// A value change in the inputs without new producer evidence changes the
		// value and nothing about the evidence.
		const moved = withCalculatedReadings(base({ [CPU_W]: 1 }), p);
		assert.notEqual(calc(moved, A).value, calc(out, A).value);
		assert.equal(moved.pollTime, snapshot.pollTime);
		assert.deepEqual(calculatedEvidenceOf(A, p, moved, evidenceOf), before);
	});
});
