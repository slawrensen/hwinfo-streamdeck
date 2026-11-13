// The settings panel's Reading links editor, plugin side, and the request
// service in front of it (steer 7D): opening, searching and refreshing
// build a workspace and write nothing; the other provider is read only on
// an explicit scan, at most once per 5 s, never while a Data source mode is
// forced and never into the poller; a Gadget value is never called live;
// an explicit Link, Unlink or relink commits through the compare-and-swap
// writer with one write that changes only its row.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { JsonObject, JsonValue } from "@elgato/utils";

import { CalcEditor } from "../src/editors/calc-editor";
import { EditorService } from "../src/editors/editor-service";
import { LINK_PEEK_INTERVAL_MS, LinkEditor, linkEditOf, type LinkWorkspace } from "../src/editors/link-editor";
import { globalFieldSignature, GlobalSettingsWriter } from "../src/global-writer";
import { ReadingCatalog } from "../src/hwinfo/link-pairing";
import type { SnapshotSource } from "../src/hwinfo/provider";
import { applyReadingLinks, parseReadingLinks } from "../src/hwinfo/reading-links";
import { HwinfoError, SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus, SourceMode } from "../src/poller";

const SM_CPU = "f0001234:0:1000001";
const SM_GPU = "f0001234:0:1000002";
const G_CPU = "g:CPU Test:CPU Package";
const G_GPU = "g:GPU Test:GPU Temperature";
const G_FAN = "g:Board:Pump";

type Row = { key: string; label: string; unit: string; type: SensorType; sensor: string; value: number };

function snapshotOf(rows: readonly Row[], extra: Partial<SensorSnapshot> = {}): SensorSnapshot {
	const sensors: { index: number; id: number; instance: number; name: string }[] = [];
	const readings: Reading[] = rows.map((row, i) => {
		let sensorIndex = sensors.findIndex((s) => s.name === row.sensor);
		if (sensorIndex < 0) {
			sensorIndex = sensors.length;
			sensors.push({ index: sensorIndex, id: 0xf0001234 + sensorIndex, instance: 0, name: row.sensor });
		}
		return { key: row.key, type: row.type, sensorIndex, id: i, label: row.label, unit: row.unit, value: row.value, valueMin: row.value, valueMax: row.value, valueAvg: row.value };
	});
	return { pollTime: 5, valueRevision: 5, freshnessRevision: 5, version: 1, revision: 1, sensors, readings, byKey: new Map(readings.map((r) => [r.key, r])), ...extra };
}

const SM_SNAPSHOT = snapshotOf([
	{ key: SM_CPU, label: "CPU Package", unit: "°C", type: SensorType.Temperature, sensor: "CPU [#0]: Test", value: 61 },
	{ key: SM_GPU, label: "GPU Temperature", unit: "°C", type: SensorType.Temperature, sensor: "GPU [#0]: Test", value: 55 }
]);
const GADGET_SNAPSHOT = snapshotOf([
	{ key: G_CPU, label: "CPU Package", unit: "°C", type: SensorType.Temperature, sensor: "CPU [#0]: Test", value: 62 },
	{ key: G_GPU, label: "GPU Temperature", unit: "°C", type: SensorType.Temperature, sensor: "GPU [#0]: Test", value: 54 },
	{ key: G_FAN, label: "Pump", unit: "RPM", type: SensorType.Fan, sensor: "Board", value: 1800 }
]);

/** The editor over a canned poller view and a fake app store. */
function rig(options: { source?: SnapshotSource | null; mode?: SourceMode; globals?: JsonObject; peek?: (p: SnapshotSource) => SensorSnapshot } = {}) {
	const source = options.source === undefined ? "shared-memory" : options.source;
	const catalog = new ReadingCatalog();
	let now = 10_000;
	const doc: { value: JsonObject } = { value: structuredClone(options.globals ?? {}) };
	const writes: JsonObject[] = [];
	const peeks: SnapshotSource[] = [];
	const raw = (): { snapshot: SensorSnapshot; source: SnapshotSource } | null => (source === null ? null : { snapshot: source === "gadget" ? GADGET_SNAPSHOT : SM_SNAPSHOT, source });
	const status = (): PollerStatus => {
		const r = raw();
		if (r === null) return { state: "unavailable", reason: "not-running", message: "HWiNFO is not running" };
		return { state: "ok", snapshot: applyReadingLinks(r.snapshot, parseReadingLinks(doc.value.readingLinks), 1), source: r.source };
	};
	const initial = raw();
	if (initial !== null) catalog.observe(initial.snapshot, initial.source, now);
	const editor = new LinkEditor({
		status,
		raw,
		mode: () => options.mode ?? "auto",
		catalog,
		now: () => now,
		globals: () => doc.value,
		peek: (p) => {
			peeks.push(p);
			if (options.peek !== undefined) return options.peek(p);
			return p === "gadget" ? GADGET_SNAPSHOT : SM_SNAPSHOT;
		},
		dataUnits: () => "decimal"
	});
	const writer = new GlobalSettingsWriter({
		read: async () => structuredClone(doc.value),
		write: async (next) => {
			writes.push(structuredClone(next));
			doc.value = structuredClone(next);
		}
	});
	const sent: JsonObject[] = [];
	const calc = new CalcEditor({ status, linked: () => null, globals: () => doc.value, dataUnits: () => "decimal", mintId: () => "calc:AAAAAAAAAAAAAAAAAAAAAA" });
	const service = new EditorService({ links: editor, calc, writer, send: (p) => sent.push(structuredClone(p)) });
	return { editor, catalog, writes, peeks, sent, service, doc, advance: (ms: number) => (now += ms) };
}

const workspaceOf = (message: JsonObject | undefined): LinkWorkspace => (message?.workspace as unknown as LinkWorkspace);
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("link-editor: opening and searching write nothing and read no other provider", () => {
	it("a workspace request without a scan never peeks and never writes", () => {
		const r = rig({ globals: { readingLinks: [{ sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }], theme: "void" } });
		for (let i = 0; i < 5; i++) r.service.handle({ event: "getLinks", requestId: `r${i}`, focusKey: SM_CPU });
		assert.equal(r.peeks.length, 0);
		assert.equal(r.writes.length, 0);
		assert.equal(r.sent.length, 5);
		assert.ok(r.sent.every((m, i) => m.event === "links" && m.requestId === `r${i}`));
	});

	it("an explicit scan peeks the other provider once per 5 s, into the catalog only", () => {
		const r = rig();
		const first = r.editor.workspace({ focusKey: SM_CPU, scan: true });
		assert.deepEqual(r.peeks, ["gadget"]);
		assert.equal(first.scan?.throttled, false);
		assert.match(first.scan?.text ?? "", /Read Gadget registry once: 3 readings/);
		assert.equal(r.catalog.lastSeen("gadget")?.via, "peek");
		const again = r.editor.workspace({ focusKey: SM_CPU, scan: true });
		assert.equal(again.scan?.throttled, true);
		assert.deepEqual(r.peeks, ["gadget"], "throttled");
		r.advance(LINK_PEEK_INTERVAL_MS);
		r.editor.workspace({ scan: true });
		assert.deepEqual(r.peeks, ["gadget", "gadget"]);
		assert.equal(r.writes.length, 0);
	});

	it("never peeks the provider in use, and never while a Data source mode is forced", () => {
		const r = rig({ source: "gadget" });
		r.editor.workspace({ scan: true, provider: "gadget" });
		assert.deepEqual(r.peeks, ["shared-memory"], "the provider in use is read every tick already");
		const forced = rig({ mode: "shared-memory" });
		const ws = forced.editor.workspace({ scan: true });
		assert.deepEqual(forced.peeks, []);
		assert.match(ws.scan?.text ?? "", /Data source setting/);
		assert.ok(ws.prerequisites.some((p) => p.id === "forced-source" && p.action === "source"));
	});

	it("a failed peek is a named prerequisite, never an error state", () => {
		const r = rig({ source: "gadget", peek: () => { throw new HwinfoError("disabled", "dead"); } });
		const ws = r.editor.workspace({ scan: true });
		assert.match(ws.scan?.text ?? "", /free version turns it off after 12 hours/);
		assert.ok(ws.prerequisites.some((p) => p.id === "shared-memory-unreadable"));
		const empty = rig({ peek: () => { throw new HwinfoError("gadget-empty", "empty"); } });
		const ews = empty.editor.workspace({ scan: true });
		assert.ok(ews.prerequisites.some((p) => p.id === "gadget-unreadable" && /Report value in Gadget/.test(p.text)));
	});

	it("before any read of the other provider, the panel is told what is unknown and offered a scan", () => {
		const ws = rig().editor.workspace({});
		assert.ok(ws.prerequisites.some((p) => p.id === "not-read" && p.action === "scan"));
	});
});

describe("link-editor: what the panel shows", () => {
	it("both readings' source, sensor, unit, availability and value; Gadget is never live", () => {
		const r = rig({ globals: { readingLinks: [{ sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }] } });
		r.editor.workspace({ scan: true });
		const ws = r.editor.workspace({ focusKey: SM_CPU });
		const row = ws.rows[0];
		assert.equal(row?.health, "active-shared-memory");
		assert.equal(row?.sm?.availability, "live");
		assert.equal(row?.sm?.sensor, "CPU [#0]: Test");
		assert.equal(row?.sm?.display, "61.0 °C", "formatted by the faces' own measurement authority");
		assert.equal(row?.gd?.availability, "read-once");
		assert.match(row?.gd?.availabilityText ?? "", /age unknown/);
		assert.equal(row?.readiness, "ready", "the Gadget endpoint was seen in the same unit: fallback ready");
		assert.deepEqual(ws.counts, { stored: 1, active: 1, waiting: 0, ignored: 0 });
		const gadgetSide = rig({ source: "gadget" }).editor.workspace({ focusKey: G_CPU });
		assert.equal(gadgetSide.focus?.endpoint?.availability, "age-unknown", "a published Gadget value is never a heartbeat");
	});

	it("the focus lists suggestions first, with the reason, and blocked rows with the refusal in words", () => {
		const r = rig();
		r.editor.workspace({ scan: true });
		const focus = r.editor.workspace({ focusKey: SM_CPU }).focus;
		assert.equal(focus?.endpoint?.label, "CPU Package");
		assert.deepEqual(focus?.candidates.map((c) => [c.key, c.suggestion, c.blocked]), [
			[G_CPU, "same-name", null],
			[G_GPU, null, null],
			[G_FAN, null, "unit-mismatch"]
		]);
		assert.match(focus?.candidates[2]?.blockedText ?? "", /units differ \(°C and RPM\)/);
	});

	it("the 2 s refresh sends the candidate list only when it changed; otherwise just the chosen one", () => {
		const r = rig({ globals: { readingLinks: [] } });
		r.editor.workspace({ scan: true });
		const first = r.editor.workspace({ focusKey: SM_CPU });
		assert.equal(first.focus?.candidatesUnchanged, false);
		assert.equal(first.focus?.candidates.length, 3);
		const held = first.focus?.candidatesSignature;
		const again = r.editor.workspace({ focusKey: SM_CPU, candidatesSignature: held, chosen: G_GPU });
		assert.equal(again.focus?.candidatesUnchanged, true);
		assert.equal(again.focus?.candidatesSignature, held);
		assert.deepEqual(again.focus?.candidates.map((c) => c.key), [G_GPU], "only the chosen one, with its live value");
		assert.deepEqual(r.editor.workspace({ focusKey: SM_CPU, candidatesSignature: held }).focus?.candidates, [], "nothing chosen: no candidate at all");
		r.doc.value = { readingLinks: [{ sharedMemory: SM_GPU, gadget: G_GPU, unit: "°C", sensorType: 1 }] };
		const changed = r.editor.workspace({ focusKey: SM_CPU, candidatesSignature: held, chosen: G_GPU });
		assert.equal(changed.focus?.candidatesUnchanged, false, "a stored link changed what is blocked: the whole list goes");
		assert.equal(changed.focus?.candidates.find((c) => c.key === G_GPU)?.blocked, "conflict");
		assert.notEqual(changed.focus?.candidatesSignature, held);
		assert.equal(r.editor.workspace({ focusKey: SM_GPU, candidatesSignature: held }).focus?.candidatesUnchanged, false, "another focus never matches");
	});

	it("a refresh of a 600-reading pool is a small message", () => {
		const pool = Array.from({ length: 600 }, (_u, i): Row => ({ key: `g:Sensor ${i % 40}:Reading ${i}`, label: `Reading ${i}`, unit: "°C", type: SensorType.Temperature, sensor: `Sensor ${i % 40}`, value: 40 + (i % 7) }));
		const r = rig({ peek: () => snapshotOf(pool) });
		r.editor.workspace({ scan: true });
		const full = r.editor.workspace({ focusKey: SM_CPU });
		const refresh = r.editor.workspace({ focusKey: SM_CPU, candidatesSignature: full.focus?.candidatesSignature, chosen: pool[7]?.key });
		const size = (ws: LinkWorkspace): number => JSON.stringify(ws).length;
		assert.ok(size(full) > 100_000, `the first answer carries the list (${size(full)} bytes)`);
		assert.ok(size(refresh) < 5_000, `the refresh does not (${size(refresh)} bytes)`);
	});

	it("rows the plugin ignores are shown as stored, and a calculated focus is explained", () => {
		const r = rig({ globals: { readingLinks: ["junk", { sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }, { sharedMemory: SM_CPU, gadget: G_GPU, unit: "°C", sensorType: 1 }] } });
		const ws = r.editor.workspace({ focusKey: "calc:AAAAAAAAAAAAAAAAAAAAAA" });
		assert.deepEqual(ws.rows.map((row) => row.health), ["malformed", "conflict", "conflict"]);
		assert.match(ws.rows[0]?.healthText ?? "", /Kept as stored/);
		assert.equal(ws.counts.ignored, 3);
		assert.match(ws.focus?.notLinkable ?? "", /follows its inputs/);
	});

	it("withheld Gadget readings are a prerequisite", () => {
		const r = rig({ source: "gadget" });
		const withheld = rig({ source: "shared-memory", peek: () => ({ ...GADGET_SNAPSHOT, blockedReadingCount: 2 }) });
		withheld.editor.workspace({ scan: true });
		assert.ok(withheld.editor.workspace({}).prerequisites.some((p) => p.id === "withheld" && /2 Gadget readings are withheld/.test(p.text)));
		assert.ok(!r.editor.workspace({}).prerequisites.some((p) => p.id === "withheld"));
	});
});

describe("link-editor: an explicit press commits one row-scoped write", () => {
	it("Link: one write, the row appended, every other field and unknown row kept, applied in the reply", async () => {
		const globals = { theme: "void", pollIntervalMs: "250", futureField: { keep: [1] }, readingLinks: [{ future: "row" }] };
		const r = rig({ globals });
		r.editor.workspace({ scan: true });
		const basis = workspaceOf(((): JsonObject => { r.service.handle({ event: "getLinks", requestId: "a" }); return r.sent.at(-1) as JsonObject; })()).signature;
		r.service.handle({ event: "applyLink", requestId: "b", op: "link", sharedMemory: SM_CPU, gadget: G_CPU, baseSignature: basis, focusKey: SM_CPU });
		await settle();
		await settle();
		assert.equal(r.writes.length, 1);
		assert.deepEqual(r.writes[0], { ...globals, readingLinks: [{ future: "row" }, { sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }] });
		const reply = r.sent.at(-1) as JsonObject;
		assert.equal(reply.event, "linkApplied");
		assert.equal(reply.ok, true);
		assert.deepEqual(reply.previous, [{ future: "row" }]);
		assert.deepEqual(reply.next, [{ future: "row" }, { sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }]);
		assert.equal(reply.signature, globalFieldSignature(reply.next));
		assert.equal(workspaceOf(reply).signature, reply.signature, "the fresh workspace is the new basis");
		assert.equal(workspaceOf(reply).focus?.linkedRow, 1);
	});

	it("two panels pressing Link from the same basis: one write, one stale refusal with a fresh workspace", async () => {
		const r = rig({ globals: { readingLinks: [] } });
		r.editor.workspace({ scan: true });
		const basis = globalFieldSignature([]);
		r.service.handle({ event: "applyLink", requestId: "p1", op: "link", sharedMemory: SM_CPU, gadget: G_CPU, baseSignature: basis });
		r.service.handle({ event: "applyLink", requestId: "p2", op: "link", sharedMemory: SM_GPU, gadget: G_GPU, baseSignature: basis });
		for (let i = 0; i < 6; i++) await settle();
		assert.equal(r.writes.length, 1);
		const second = r.sent.find((m) => m.requestId === "p2") as JsonObject;
		assert.equal(second.ok, false);
		assert.equal(second.reason, "stale-basis");
		assert.match(String(second.reasonText), /changed in another panel/);
		assert.equal(workspaceOf(second).rows.length, 1, "the refusal carries the list as it is now");
	});

	it("a refused Link writes nothing and names the units", async () => {
		const r = rig({ globals: {} });
		r.editor.workspace({ scan: true });
		r.service.handle({ event: "applyLink", requestId: "x", op: "link", sharedMemory: SM_CPU, gadget: G_FAN, baseSignature: globalFieldSignature(undefined) });
		await settle();
		await settle();
		assert.equal(r.writes.length, 0);
		const reply = r.sent.at(-1) as JsonObject;
		assert.equal(reply.reason, "unit-mismatch");
		assert.match(String(reply.reasonText), /°C and RPM/);
	});

	it("a linked focus offers Replace link: its other counterparts are open and one relink is one write", async () => {
		const wrong = { sharedMemory: SM_CPU, gadget: G_GPU, unit: "°C", sensorType: 1, note: "mine" };
		const r = rig({ globals: { theme: "void", readingLinks: [wrong] } });
		r.editor.workspace({ scan: true });
		const ws = r.editor.workspace({ focusKey: SM_CPU });
		assert.equal(ws.focus?.linkedRow, 0);
		assert.deepEqual(ws.focus?.candidates.map((c) => [c.key, c.blocked]), [
			[G_CPU, null],
			[G_GPU, "duplicate"],
			[G_FAN, "unit-mismatch"]
		], "the focus's own row blocks nothing but its own pair");
		r.service.handle({ event: "applyLink", requestId: "rl", op: "relink", sharedMemory: SM_CPU, gadget: G_CPU, previous: { sharedMemory: SM_CPU, gadget: G_GPU }, baseSignature: ws.signature, focusKey: SM_CPU });
		await settle();
		await settle();
		assert.deepEqual(r.writes, [{ theme: "void", readingLinks: [{ ...wrong, gadget: G_CPU }] }], "replaced in place, the row's own fields kept");
		assert.equal((r.sent.at(-1) as JsonObject).ok, true);
	});

	it("Unlink removes only its row; a malformed message is refused without reaching the writer", async () => {
		const keep = { sharedMemory: SM_GPU, gadget: G_GPU, unit: "°C", sensorType: 1, note: "mine" };
		const r = rig({ globals: { readingLinks: [{ sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }, keep] } });
		r.service.handle({ event: "applyLink", requestId: "u", op: "unlink", sharedMemory: SM_CPU, gadget: G_CPU, baseSignature: globalFieldSignature(r.doc.value.readingLinks) });
		await settle();
		await settle();
		assert.deepEqual(r.writes.map((w) => w.readingLinks), [[keep]]);
		r.service.handle({ event: "applyLink", requestId: "m", op: "link", sharedMemory: SM_CPU });
		await settle();
		assert.equal(r.writes.length, 1);
		assert.equal((r.sent.at(-1) as JsonObject).reason, "malformed");
	});

	it("reads a link edit out of a panel message strictly", () => {
		const base: Record<string, JsonValue> = { sharedMemory: SM_CPU, gadget: G_CPU };
		assert.deepEqual(linkEditOf({ ...base, op: "link" }), { op: "link", sharedMemory: SM_CPU, gadget: G_CPU });
		assert.deepEqual(linkEditOf({ ...base, op: "relink", previous: { sharedMemory: SM_CPU, gadget: G_GPU } }), { op: "relink", sharedMemory: SM_CPU, gadget: G_CPU, previous: { sharedMemory: SM_CPU, gadget: G_GPU } });
		assert.equal(linkEditOf({ ...base, op: "relink" }), undefined);
		assert.equal(linkEditOf({ ...base, op: "replace" }), undefined);
		assert.equal(linkEditOf({ op: "link", sharedMemory: 4, gadget: G_CPU }), undefined);
	});
});
