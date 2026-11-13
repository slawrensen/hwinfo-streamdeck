// Calculated readings reach every consumer through the snapshot (steer 7G):
// the panel's sensor tree lists them in their own "Calculated (plugin)"
// group, detail filters match them under that source name, a source-mode
// list opened on one lists the others, and with nothing defined every
// payload is byte-identical to a deck without the feature.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveDetailGroup } from "../src/detail/detail-group";
import { CALCULATED_SOURCE_NAME, NO_CALCULATED_READINGS, parseCalculatedReadings, withCalculatedReadings } from "../src/hwinfo/calculated";
import { applyReadingLinks } from "../src/hwinfo/reading-links";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { buildSensorTree } from "../src/pi-protocol";
import type { PollerStatus } from "../src/poller";

const CPU = "f0001234:0:5000001";
const GPU = "f0001234:0:5000002";
const TEMP = "f0001234:0:1000001";
const SUM = "calc:SSSSSSSSSSSSSSSSSSSSSS";
const MAX = "calc:MMMMMMMMMMMMMMMMMMMMMM";

function provider(): SensorSnapshot {
	const rows: [string, string, string, SensorType, number, number][] = [
		[CPU, "CPU Package Power", "W", SensorType.Power, 65, 0],
		[GPU, "GPU Power", "W", SensorType.Power, 180, 1],
		[TEMP, "CPU Package", "°C", SensorType.Temperature, 61, 0]
	];
	const readings: Reading[] = rows.map(([key, label, unit, type, value, sensorIndex], i) => ({ key, label, unit, type, sensorIndex, id: i, value, valueMin: value, valueMax: value, valueAvg: value }));
	return {
		pollTime: 9,
		valueRevision: 9,
		version: 1,
		revision: 1,
		sensors: [
			{ index: 0, id: 0xf0001234, instance: 0, name: "CPU [#0]: Test" },
			{ index: 1, id: 0xe0002000, instance: 0, name: "GPU [#0]: Test" }
		],
		readings,
		byKey: new Map(readings.map((r) => [r.key, r]))
	};
}

const DEFS = [
	{ id: SUM, op: "sum", inputs: [CPU, GPU], unit: "W", sensorType: SensorType.Power },
	{ id: MAX, op: "max", inputs: [CPU, GPU], unit: "W", sensorType: SensorType.Power, label: "Hungrier chip" }
];
const decorated = (): SensorSnapshot => withCalculatedReadings(applyReadingLinks(provider(), [], 0), parseCalculatedReadings(DEFS));
const ok = (snapshot: SensorSnapshot): PollerStatus => ({ state: "ok", snapshot, source: "shared-memory" });

describe("calculated readings in the panel's sensor tree", () => {
	it("are one group named Calculated (plugin), after HWiNFO's sources, in stored order", () => {
		const tree = buildSensorTree(ok(decorated()));
		assert.deepEqual(tree.groups.map((g) => g.name), ["CPU [#0]: Test", "GPU [#0]: Test", CALCULATED_SOURCE_NAME]);
		const group = tree.groups[2];
		assert.equal(group?.matchName, "Calculated (plugin)", "the name the panel's filter counter matches");
		assert.deepEqual(group?.readings.map((r) => [r.key, r.label, r.unit, r.display]), [
			[SUM, "CPU Package Power + GPU Power", "W", "245 W"],
			[MAX, "Hungrier chip", "W", "180 W"]
		]);
	});

	it("with nothing defined the tree is byte-identical to the provider's own", () => {
		const plain = buildSensorTree(ok(provider()));
		const derived = buildSensorTree(ok(withCalculatedReadings(applyReadingLinks(provider(), [], 0), NO_CALCULATED_READINGS)));
		assert.equal(JSON.stringify(derived), JSON.stringify(plain));
	});
});

describe("calculated readings in detail lists", () => {
	it("a filter matches them under their source name, and a broad filter includes them", () => {
		const snapshot = decorated();
		const calc = resolveDetailGroup(snapshot, { readingKey: TEMP, detailMode: "filter", detailFilter: "Calculated*" });
		assert.deepEqual(calc?.keys, [SUM, MAX]);
		const byLabel = resolveDetailGroup(snapshot, { readingKey: TEMP, detailMode: "filter", detailFilter: "*hungrier*" });
		assert.deepEqual(byLabel?.keys, [MAX]);
		const everything = resolveDetailGroup(snapshot, { readingKey: TEMP, detailMode: "filter", detailFilter: "*" });
		assert.deepEqual(everything?.keys, [CPU, GPU, SUM, MAX], "a saved '*' starts listing them once any are defined (documented)");
		const either = resolveDetailGroup(snapshot, { readingKey: TEMP, detailMode: "filter", detailFilter: "gpu power|calculated*" });
		assert.deepEqual(either?.keys, [GPU, SUM, MAX], "OR filters union in snapshot order");
	});

	it("a source list opened on a calculated reading lists the other calculated readings", () => {
		const group = resolveDetailGroup(decorated(), { readingKey: SUM });
		assert.equal(group?.title, CALCULATED_SOURCE_NAME);
		assert.deepEqual(group?.keys, [MAX]);
	});

	it("a custom list holds calculated keys like any other, and a missing one stays a missing cell", () => {
		const group = resolveDetailGroup(decorated(), { readingKey: TEMP, detailMode: "custom", detailKeys: [SUM, "calc:ZZZZZZZZZZZZZZZZZZZZZZ", MAX] });
		assert.ok(group !== null);
		assert.ok(JSON.stringify(group).includes(SUM) && JSON.stringify(group).includes(MAX));
	});
});
