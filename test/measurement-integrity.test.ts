import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gadgetReadingKey } from "../src/hwinfo/gadget-identity";
import { applyReadingLinks, parseReadingLinks } from "../src/hwinfo/reading-links";
import type { Reading, SensorSnapshot } from "../src/hwinfo/types";

const link = { sharedMemory: "f0001234:0:1000001", gadget: "g:GPU:Temperature", unit: "°C", sensorType: 1 };
const reading: Reading = { key: link.sharedMemory, sensorIndex: 0, id: 1, label: "Temperature", type: 1, unit: "°C", value: 40, valueMin: 30, valueMax: 60, valueAvg: 42 };
const snapshot = (r: Reading = reading, pollTime = 1): SensorSnapshot => ({ pollTime, valueRevision: pollTime, version: 1, revision: 0, sensors: [{ index: 0, id: 1, instance: 0, name: "GPU" }], readings: [r], byKey: new Map([[r.key, r]]) });

describe("refutation: identity and explicit links", () => {
	it("reserved names, empty names and spaces produce injective keys", () => {
		const parts = ["", "GPU", "GPU:0", "GPU~1", "GPU %", "a:b", "a", "b:c", "a\nb", "é", "\"[]", " Two words "];
		const keys = parts.flatMap((source) => parts.map((label) => gadgetReadingKey(source, label)));
		assert.equal(new Set(keys).size, parts.length ** 2);
		assert.equal(gadgetReadingKey("Two words", "CPU Temp"), "g:Two words:CPU Temp");
	});
	it("links are opt in and never inferred from identical names or numbers", () => {
		assert.equal(applyReadingLinks(snapshot(), [], 0).byKey.get(link.gadget), undefined);
		const original = snapshot();
		const linked = applyReadingLinks(original, [link], 1);
		assert.equal(linked.byKey.get(link.gadget)?.value, 40);
		assert.equal(original.byKey.get(link.gadget), undefined, "never mutate a provider's cached snapshot");
		assert.equal(linked.byKey.get(link.gadget)?.key, link.gadget, "personalization continues to use the saved key");
	});
	it("conflicting links have no order-dependent winner", () => {
		const conflict = { ...link, gadget: "g:GPU:Other" };
		assert.deepEqual(parseReadingLinks([link, conflict]), []);
		assert.deepEqual(parseReadingLinks([conflict, link]), []);
		assert.deepEqual(parseReadingLinks([link, link]), []);
	});
	it("malformed settings and legacy duplicate suffixes cannot create links", () => {
		for (const raw of [null, {}, "junk", [null, 4, { ...link, unit: [] }], [{ ...link, sensorType: 100 }], [{ ...link, gadget: "g:GPU:Temperature~1" }], Array.from({ length: 129 }, () => link)]) assert.deepEqual(parseReadingLinks(raw), []);
		assert.deepEqual(parseReadingLinks([{ bad: true }, link]), [link]);
	});
	it("unit/type changes and missing endpoints fail closed in either direction", () => {
		for (const key of [link.sharedMemory, link.gadget]) {
			const other = key === link.gadget ? link.sharedMemory : link.gadget;
			assert.equal(applyReadingLinks(snapshot({ ...reading, key, unit: "°F" }), [link], 1).byKey.get(other), undefined);
			assert.equal(applyReadingLinks(snapshot({ ...reading, key, type: 5 }), [link], 1).byKey.get(other), undefined);
			assert.equal(applyReadingLinks({ ...snapshot(), readings: [], byKey: new Map() }, [link], 1).byKey.size, 0);
		}
	});
});

