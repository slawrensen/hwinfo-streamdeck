// The settings panel's Calculated readings editor, plugin side, and its
// half of the request service (steer 7G): the list, the live preview of a
// draft (which writes nothing), and the row-scoped Save and Delete plans
// committed through the compare-and-swap writer.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { JsonObject } from "@elgato/utils";

import { CalcEditor, calcDraftOf, type CalcWorkspace } from "../src/editors/calc-editor";
import { EditorService } from "../src/editors/editor-service";
import { LinkEditor } from "../src/editors/link-editor";
import { globalFieldSignature, GlobalSettingsWriter } from "../src/global-writer";
import { parseCalculatedReadings, withCalculatedReadings } from "../src/hwinfo/calculated";
import { ReadingCatalog } from "../src/hwinfo/link-pairing";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";

const CPU_W = "f0001234:0:5000001";
const GPU_W = "f0001234:0:5000002";
const CPU_T = "f0001234:0:1000001";
const GPU_T = "f0001234:0:1000002";
const ZERO_W = "f0001234:0:5000003";

function linkedSnapshot(drop: readonly string[] = []): SensorSnapshot {
	const rows: [string, string, string, SensorType, number][] = [
		[CPU_W, "CPU Package Power", "W", SensorType.Power, 65],
		[GPU_W, "GPU Power", "W", SensorType.Power, 180],
		[CPU_T, "CPU Package", "°C", SensorType.Temperature, 61],
		[GPU_T, "GPU Temperature", "°C", SensorType.Temperature, 55],
		[ZERO_W, "Idle Rail", "W", SensorType.Power, 0]
	];
	const readings: Reading[] = rows.filter(([key]) => !drop.includes(key)).map(([key, label, unit, type, value], i) => ({ key, label, unit, type, sensorIndex: 0, id: i, value, valueMin: value, valueMax: value, valueAvg: value }));
	return { pollTime: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 1, instance: 0, name: "Test Source" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

function rig(initial: JsonObject = {}, options: { drop?: readonly string[]; unavailable?: boolean } = {}) {
	const doc = { value: structuredClone(initial) };
	const writes: JsonObject[] = [];
	let minted = 0;
	const linked = (): SensorSnapshot | null => (options.unavailable === true ? null : linkedSnapshot(options.drop));
	const status = (): PollerStatus => {
		const snapshot = linked();
		return snapshot === null ? { state: "unavailable", reason: "not-running", message: "no" } : { state: "ok", snapshot: withCalculatedReadings(snapshot, parseCalculatedReadings(doc.value.calculatedReadings)), source: "shared-memory" };
	};
	const calc = new CalcEditor({ status, linked, globals: () => doc.value, dataUnits: () => "decimal", mintId: () => `calc:${String(++minted).padStart(22, "A")}` });
	const writer = new GlobalSettingsWriter({ read: async () => structuredClone(doc.value), write: async (next) => { writes.push(structuredClone(next)); doc.value = structuredClone(next); } });
	const links = new LinkEditor({ status, raw: () => null, mode: () => "auto", catalog: new ReadingCatalog(), now: () => 0, globals: () => doc.value, peek: () => { throw new Error("never"); }, dataUnits: () => "decimal" });
	const sent: JsonObject[] = [];
	const service = new EditorService({ links, calc, writer, send: (p) => sent.push(structuredClone(p)) });
	return { calc, doc, writes, sent, service };
}

const settle = async (): Promise<void> => {
	for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
};
const ID1 = `calc:${"1".padStart(22, "A")}`;
const sumRow = { id: "calc:SSSSSSSSSSSSSSSSSSSSSS", op: "sum", inputs: [CPU_W, GPU_W], unit: "W", sensorType: SensorType.Power };

describe("calc-editor: the list and the live preview write nothing", () => {
	it("each stored row with its verdict, label, live value, inputs, expression and unit", () => {
		const r = rig({ calculatedReadings: [sumRow, { id: "calc:BAD", op: "sum" }, { ...sumRow, id: "calc:TTTTTTTTTTTTTTTTTTTTTT", op: "diff", inputs: [CPU_T, GPU_T], unit: "°C", sensorType: SensorType.Temperature, label: "CPU over GPU" }] });
		const ws = r.calc.workspace();
		assert.equal(ws.rows.length, 3);
		const [sum, bad, diff] = ws.rows;
		assert.deepEqual([sum?.ok, sum?.label, sum?.display, sum?.unit, sum?.opText, sum?.expression], [true, "CPU Package Power + GPU Power", "245 W", "W", "Sum", "CPU Package Power + GPU Power"]);
		assert.deepEqual(sum?.inputs.map((i) => [i.label, i.source, i.present]), [["CPU Package Power", "Test Source", true], ["GPU Power", "Test Source", true]]);
		assert.equal(bad?.ok, false);
		assert.equal(bad?.reason, "malformed-id");
		assert.match(bad?.reasonText ?? "", /not a valid definition/);
		assert.deepEqual([diff?.label, diff?.custom, diff?.display, diff?.unit], ["CPU over GPU", true, "6.00 Δ°C", "Δ°C"]);
		assert.equal(ws.signature, globalFieldSignature(r.doc.value.calculatedReadings));
		assert.equal(r.writes.length, 0);
	});

	it("previewing drafts (generated label, refusals, states) never writes", () => {
		const r = rig({ calculatedReadings: [] });
		const sum = r.calc.preview(calcDraftOf({ op: "sum", inputs: [CPU_W, GPU_W], label: "" }), undefined);
		assert.deepEqual([sum.ok, sum.generatedLabel, sum.display, sum.unit, sum.state], [true, "CPU Package Power + GPU Power", "245 W", "W", "ok"]);
		assert.deepEqual(sum.allowedOps, ["sum", "avg", "min", "max", "diff", "ratio"]);
		const wall = r.calc.preview(calcDraftOf({ op: "sum", inputs: [CPU_W, GPU_W], label: "Total System Power" }), undefined);
		assert.equal(wall.labelRefusal, "claims-system-power");
		assert.match(wall.labelRefusalText, /not what the machine draws/);
		assert.equal(wall.label, "CPU Package Power + GPU Power", "the generated label is used instead");
		const temps = r.calc.preview(calcDraftOf({ op: "sum", inputs: [CPU_T, GPU_T] }), undefined);
		assert.equal(temps.ok, false);
		assert.equal(temps.reason, "op-not-allowed");
		assert.deepEqual(temps.allowedOps, ["avg", "min", "max", "diff"]);
		const zero = r.calc.preview(calcDraftOf({ op: "ratio", inputs: [CPU_W, ZERO_W], percent: true }), undefined);
		assert.equal(zero.state, "division-by-zero");
		assert.equal(zero.display.startsWith("NaN"), false);
		assert.match(zero.stateText, /division by zero/);
		const mixed = r.calc.preview(calcDraftOf({ op: "avg", inputs: [CPU_W, CPU_T] }), undefined);
		assert.equal(mixed.ok, false);
		assert.equal(mixed.reason, "input-units");
		assert.equal(r.calc.preview(undefined, undefined).reason, "malformed-draft");
		assert.equal(r.writes.length, 0);
		assert.deepEqual(r.doc.value, { calculatedReadings: [] });
	});

	it("reads a draft out of a panel message strictly", () => {
		assert.deepEqual(calcDraftOf({ op: "sum", inputs: [CPU_W, GPU_W], percent: true, label: "x", extra: 1 }), { op: "sum", inputs: [CPU_W, GPU_W], percent: true, label: "x" });
		for (const bad of [null, { op: "eval", inputs: [CPU_W, GPU_W] }, { op: "sum", inputs: [CPU_W] }, { op: "sum", inputs: Array(9).fill(CPU_W) }, { op: "sum", inputs: [CPU_W, ""] }, { op: "sum", inputs: [CPU_W, 4] }]) assert.equal(calcDraftOf(bad), undefined);
	});
});

describe("calc-editor: plans change one row or refuse with a reason", () => {
	it("create appends a row whose unit and type come from the inputs, with a fresh id", () => {
		const r = rig();
		const plan = r.calc.plan([{ keep: "me" }], { op: "create", draft: { op: "ratio", inputs: [CPU_W, GPU_W], percent: true, label: "" } });
		assert.ok(plan.ok);
		assert.equal(plan.id, ID1);
		assert.deepEqual(plan.next, [{ keep: "me" }, { id: ID1, op: "ratio", inputs: [CPU_W, GPU_W], unit: "W", sensorType: SensorType.Power, percent: true }]);
	});

	it("update replaces one row in place and keeps its unknown fields; delete removes only it", () => {
		const r = rig();
		const stored = [{ x: 0 }, { ...sumRow, future: { keep: true } }, { y: 2 }];
		const update = r.calc.plan(stored, { op: "update", id: sumRow.id, draft: { op: "max", inputs: [CPU_W, GPU_W], percent: false, label: "Hotter rail" } });
		assert.ok(update.ok);
		assert.deepEqual(update.next, [{ x: 0 }, { ...sumRow, future: { keep: true }, op: "max", label: "Hotter rail" }, { y: 2 }]);
		const del = r.calc.plan(stored, { op: "delete", id: sumRow.id });
		assert.ok(del.ok);
		assert.deepEqual(del.next, [{ x: 0 }, { y: 2 }]);
	});

	it("a label or operation edit on stored inputs works while an input is missing; new inputs must be present", () => {
		const r = rig({}, { drop: [GPU_W] });
		const label = r.calc.plan([sumRow], { op: "update", id: sumRow.id, draft: { op: "sum", inputs: [CPU_W, GPU_W], percent: false, label: "Mine" } });
		assert.ok(label.ok, "the stored definition keeps its unit and type");
		const fresh = r.calc.plan([], { op: "create", draft: { op: "sum", inputs: [CPU_W, GPU_W], percent: false, label: "" } });
		assert.deepEqual(fresh, { ok: false, reason: "input-missing" });
		const offline = rig({}, { unavailable: true });
		assert.deepEqual(offline.calc.plan([], { op: "create", draft: { op: "sum", inputs: [CPU_W, GPU_W], percent: false, label: "" } }), { ok: false, reason: "input-missing" });
	});

	const nested = { id: "calc:NNNNNNNNNNNNNNNNNNNNNN", op: "diff", inputs: [sumRow.id, CPU_W], unit: "W", sensorType: SensorType.Power };
	const refusals: { name: string; stored: unknown; edit: Parameters<CalcEditor["plan"]>[1]; reason: string }[] = [
		{ name: "a stored value that is not a list", stored: { a: 1 }, edit: { op: "delete", id: sumRow.id }, reason: "unreadable-list" },
		{ name: "deleting a definition a later one uses", stored: [sumRow, nested], edit: { op: "delete", id: sumRow.id }, reason: "referenced" },
		{ name: "an id that is no longer stored", stored: [sumRow], edit: { op: "delete", id: "calc:ZZZZZZZZZZZZZZZZZZZZZZ" }, reason: "not-found" },
		{ name: "a 33rd definition", stored: Array.from({ length: 32 }, (_u, i) => ({ ...sumRow, id: `calc:${String(i).padStart(22, "Q")}` })), edit: { op: "create", draft: { op: "sum", inputs: [CPU_W, GPU_W], percent: false, label: "" } }, reason: "cap" },
		{ name: "a power-sum label claiming wall power", stored: [], edit: { op: "create", draft: { op: "sum", inputs: [CPU_W, GPU_W], percent: false, label: "Wall power" } }, reason: "label" },
		{ name: "an edit that would break a dependent", stored: [sumRow, nested], edit: { op: "update", id: sumRow.id, draft: { op: "avg", inputs: [CPU_T, GPU_T], percent: false, label: "" } }, reason: "breaks-dependent" },
		{ name: "a reading counted twice", stored: [sumRow], edit: { op: "create", draft: { op: "sum", inputs: [sumRow.id, CPU_W], percent: false, label: "" } }, reason: "input-ambiguous" },
		{ name: "a forward reference", stored: [{ ...sumRow, inputs: [CPU_W, nested.id] }, nested], edit: { op: "update", id: sumRow.id, draft: { op: "sum", inputs: [CPU_W, nested.id], percent: false, label: "x" } }, reason: "forward-reference" },
		{ name: "the same reading twice", stored: [], edit: { op: "create", draft: { op: "sum", inputs: [CPU_W, CPU_W], percent: false, label: "" } }, reason: "duplicate-input" }
	];
	for (const c of refusals) {
		it(`refuses ${c.name} (${c.reason})`, () => {
			const plan = rig().calc.plan(c.stored, c.edit);
			assert.equal(plan.ok, false);
			assert.equal(!plan.ok && plan.reason, c.reason);
		});
	}
});

describe("calc-editor: Save and Delete commit one row-scoped write", () => {
	it("create: one write, every other field kept, the new id and a fresh list in the reply", async () => {
		const r = rig({ theme: "void", readingLinks: [{ keep: 1 }], future: { x: [1] } });
		r.service.handle({ event: "applyCalculated", requestId: "c1", op: "create", draft: { op: "sum", inputs: [CPU_W, GPU_W], label: "" }, baseSignature: globalFieldSignature(undefined) });
		await settle();
		assert.equal(r.writes.length, 1);
		assert.deepEqual(r.writes[0], { theme: "void", readingLinks: [{ keep: 1 }], future: { x: [1] }, calculatedReadings: [{ id: ID1, op: "sum", inputs: [CPU_W, GPU_W], unit: "W", sensorType: SensorType.Power }] });
		const reply = r.sent.at(-1) as JsonObject;
		assert.deepEqual([reply.event, reply.ok, reply.id, reply.previousPresent], ["calculatedApplied", true, ID1, false]);
		const ws = reply.workspace as unknown as CalcWorkspace;
		assert.equal(ws.rows[0]?.display, "245 W");
		assert.equal(ws.signature, reply.signature);
	});

	it("a stale basis and a refused edit write nothing and explain themselves", async () => {
		const r = rig({ calculatedReadings: [sumRow] });
		r.service.handle({ event: "applyCalculated", requestId: "s", op: "delete", id: sumRow.id, baseSignature: globalFieldSignature([]) });
		await settle();
		assert.equal(r.writes.length, 0);
		assert.equal((r.sent.at(-1) as JsonObject).reason, "stale-basis");
		const basis = globalFieldSignature([sumRow]);
		r.service.handle({ event: "applyCalculated", requestId: "l", op: "update", id: sumRow.id, draft: { op: "sum", inputs: [CPU_W, GPU_W], label: "PSU output" }, baseSignature: basis });
		await settle();
		assert.equal(r.writes.length, 0);
		assert.match(String((r.sent.at(-1) as JsonObject).reasonText), /wall, system, total, PSU or outlet/);
		r.service.handle({ event: "applyCalculated", requestId: "m", op: "update", draft: { op: "sum", inputs: [CPU_W, GPU_W] }, baseSignature: basis });
		await settle();
		assert.equal((r.sent.at(-1) as JsonObject).reason, "malformed-draft");
		assert.equal(r.writes.length, 0);
	});

	it("deleting a used definition names the one that uses it", async () => {
		const nested = { id: "calc:NNNNNNNNNNNNNNNNNNNNNN", op: "diff", inputs: [sumRow.id, CPU_W], unit: "W", sensorType: SensorType.Power, label: "GPU share" };
		const r = rig({ calculatedReadings: [sumRow, nested] });
		r.service.handle({ event: "applyCalculated", requestId: "d", op: "delete", id: sumRow.id, baseSignature: globalFieldSignature([sumRow, nested]) });
		await settle();
		assert.match(String((r.sent.at(-1) as JsonObject).reasonText), /^GPU share uses this one/);
	});

	it("previews and list requests through the service write nothing", () => {
		const r = rig({ calculatedReadings: [sumRow] });
		for (let i = 0; i < 3; i++) {
			r.service.handle({ event: "getCalculated", requestId: `g${i}` });
			r.service.handle({ event: "previewCalculated", requestId: `p${i}`, draft: { op: "avg", inputs: [CPU_T, GPU_T] }, editingId: sumRow.id });
		}
		assert.equal(r.writes.length, 0);
		assert.deepEqual(r.sent.map((m) => m.event), ["calculated", "calculatedPreview", "calculated", "calculatedPreview", "calculated", "calculatedPreview"]);
		assert.equal(((r.sent[1] as JsonObject).preview as JsonObject).display, "58.0 °C");
	});
});
