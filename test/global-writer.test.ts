// The plugin's one write path for the global fields the settings panel
// edits through the plugin (readingLinks, calculatedReadings): a
// serialized compare-and-swap on one field. Two panels holding the same
// basis get one success and one stale refusal (never a lost update), a
// stale basis writes nothing, and every other field, known or not, rides
// along exactly as it was read.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { JsonObject, JsonValue } from "@elgato/utils";

import { canonicalJson, globalFieldSignature, GlobalSettingsWriter, type GlobalFieldEdit } from "../src/global-writer";

/** An app-like store: reads hand back a copy of the stored document after a
 * tick, writes replace it after a tick. */
function store(initial: JsonObject): { doc: () => JsonObject; writes: JsonObject[]; reads: number; failRead?: boolean; failWrite?: boolean; readonly api: { read(): Promise<JsonObject>; write(doc: JsonObject): Promise<void> } } {
	let doc: JsonObject = structuredClone(initial);
	const s = {
		doc: () => doc,
		writes: [] as JsonObject[],
		reads: 0,
		failRead: false,
		failWrite: false,
		api: {
			read: async (): Promise<JsonObject> => {
				await new Promise((resolve) => setImmediate(resolve));
				s.reads++;
				if (s.failRead) throw new Error("no answer");
				return structuredClone(doc);
			},
			write: async (next: JsonObject): Promise<void> => {
				await new Promise((resolve) => setImmediate(resolve));
				if (s.failWrite) throw new Error("socket closed");
				s.writes.push(structuredClone(next));
				doc = structuredClone(next);
			}
		}
	};
	return s;
}

const append = (row: JsonValue): GlobalFieldEdit<"cap", never> => (current) => ({ ok: true, next: [...(Array.isArray(current) ? (current as JsonValue[]) : []), row] });

describe("global-writer: canonical signature", () => {
	it("ignores key order and dropped undefined members, but sees every value", () => {
		assert.equal(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] }), canonicalJson({ a: [1, { c: 3, d: 2 }], b: 1 }));
		assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
		assert.notEqual(globalFieldSignature([{ a: 1 }]), globalFieldSignature([{ a: 1, future: true }]), "an unknown field is part of the basis");
		assert.notEqual(canonicalJson(JSON.parse('{"__proto__":1}')), canonicalJson({}), "a member named __proto__ is part of the basis");
		assert.notEqual(globalFieldSignature([1, 2]), globalFieldSignature([2, 1]), "order is meaning for a stored list");
		assert.notEqual(globalFieldSignature(undefined), globalFieldSignature(null), "absent and null are distinct");
		assert.notEqual(globalFieldSignature(undefined), globalFieldSignature([]));
		assert.equal(globalFieldSignature([{ b: 2, a: 1 }]).length, 22);
	});
});

describe("global-writer: serialized compare-and-swap", () => {
	it("writes the latest document with only the field replaced, unknown fields kept", async () => {
		const s = store({ pollIntervalMs: "1000", theme: "void", futureThing: { nested: [1, 2] }, readingLinks: [{ keep: "me" }] });
		const writer = new GlobalSettingsWriter(s.api);
		const result = await writer.commit("readingLinks", globalFieldSignature([{ keep: "me" }]), append({ row: 2 }));
		assert.ok(result.ok);
		assert.deepEqual(s.writes, [{ pollIntervalMs: "1000", theme: "void", futureThing: { nested: [1, 2] }, readingLinks: [{ keep: "me" }, { row: 2 }] }]);
		assert.deepEqual(result.previous, [{ keep: "me" }]);
		assert.equal(result.previousPresent, true);
		assert.equal(result.signature, globalFieldSignature([{ keep: "me" }, { row: 2 }]));
	});

	it("a stale basis is refused with a typed reason and writes nothing", async () => {
		const s = store({ readingLinks: [{ a: 1 }] });
		const writer = new GlobalSettingsWriter(s.api);
		const result = await writer.commit("readingLinks", globalFieldSignature([]), append({ b: 2 }));
		assert.deepEqual(result, { ok: false, field: "readingLinks", reason: "stale-basis", signature: globalFieldSignature([{ a: 1 }]) });
		assert.equal(s.writes.length, 0);
	});

	it("two panels holding the same basis: one success, one stale refusal, no lost update", async () => {
		const s = store({ readingLinks: [] });
		const writer = new GlobalSettingsWriter(s.api);
		const basis = globalFieldSignature([]);
		const [first, second] = await Promise.all([writer.commit("readingLinks", basis, append("panel A")), writer.commit("readingLinks", basis, append("panel B"))]);
		assert.equal(first.ok, true);
		assert.equal(second.ok, false);
		assert.equal(!second.ok && second.reason, "stale-basis");
		assert.deepEqual(s.doc().readingLinks, ["panel A"]);
		// The refused panel re-reads (its refusal carries the new basis) and wins next.
		const retry = await writer.commit("readingLinks", second.signature, append("panel B"));
		assert.ok(retry.ok);
		assert.deepEqual(s.doc().readingLinks, ["panel A", "panel B"]);
	});

	it("commits run one at a time, each reading the document the previous one wrote", async () => {
		const s = store({});
		const writer = new GlobalSettingsWriter(s.api);
		const order: string[] = [];
		// Each panel saw the document its predecessor will have written.
		const bases = [globalFieldSignature(undefined), globalFieldSignature(["a"]), globalFieldSignature(["a", "b"])];
		const results = ["a", "b", "c"].map((name, i) => {
			const edit: GlobalFieldEdit<never, never> = (current) => {
				order.push(name);
				return { ok: true, next: [...(Array.isArray(current) ? (current as JsonValue[]) : []), name] };
			};
			return writer.commit("calculatedReadings", bases[i] as string, edit);
		});
		const settled = await Promise.all(results);
		assert.deepEqual(settled.map((r) => r.ok), [true, true, true]);
		assert.deepEqual(order, ["a", "b", "c"]);
		assert.deepEqual(s.doc().calculatedReadings, ["a", "b", "c"]);
		assert.equal(s.writes.length, 3);
	});

	it("another field changed between commits does not make the basis stale and is kept", async () => {
		const s = store({ readingLinks: [], pollIntervalMs: "1000" });
		const writer = new GlobalSettingsWriter(s.api);
		s.doc().pollIntervalMs = "250"; // a panel saved the poll interval meanwhile
		const result = await writer.commit("readingLinks", globalFieldSignature([]), append("x"));
		assert.ok(result.ok);
		assert.deepEqual(s.doc(), { readingLinks: ["x"], pollIntervalMs: "250" });
	});

	it("an edit's own refusal, a throwing edit, a failed read and a failed write write nothing and keep the queue going", async () => {
		const s = store({ readingLinks: [] });
		const writer = new GlobalSettingsWriter(s.api);
		const basis = globalFieldSignature([]);
		const refused = await writer.commit<"cap", { n: number }>("readingLinks", basis, () => ({ ok: false, reason: "cap", detail: { n: 128 } }));
		assert.deepEqual(refused, { ok: false, field: "readingLinks", reason: "cap", signature: basis, detail: { n: 128 } });
		const thrown = await writer.commit("readingLinks", basis, () => {
			throw new Error("defect");
		});
		assert.equal(!thrown.ok && thrown.reason, "write-failed");
		s.failRead = true;
		const unread = await writer.commit("readingLinks", basis, append("x"));
		assert.deepEqual(unread, { ok: false, field: "readingLinks", reason: "read-failed", signature: "" });
		s.failRead = false;
		s.failWrite = true;
		const unwritten = await writer.commit("readingLinks", basis, append("x"));
		assert.equal(!unwritten.ok && unwritten.reason, "write-failed");
		s.failWrite = false;
		assert.equal(s.writes.length, 0);
		const ok = await writer.commit("readingLinks", basis, append("x"));
		assert.ok(ok.ok, "the queue survives every failure");
	});

	it("an absent field is an empty basis of its own; a reply that is not a document reads as empty", async () => {
		const s = store({ theme: "void" });
		const writer = new GlobalSettingsWriter(s.api);
		const result = await writer.commit("readingLinks", globalFieldSignature(undefined), append("x"));
		assert.ok(result.ok);
		assert.equal(result.previousPresent, false);
		assert.equal(result.previous, null);
		const odd = new GlobalSettingsWriter({ read: async () => null as unknown as JsonObject, write: async () => undefined });
		const r = await odd.commit("readingLinks", globalFieldSignature(undefined), append("x"));
		assert.ok(r.ok);
	});
});
