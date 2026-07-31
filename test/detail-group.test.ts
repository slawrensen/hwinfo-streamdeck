// Detail settings parsing and group resolution (issue #5): defensive
// parsing of the appended opener fields, stable-key source resolution,
// custom ordering with positional missing readings, primary exclusion,
// and the pagination math every device class shares.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clampOffset, pageOf, resolveDetailGroup } from "../src/detail/detail-group";
import { DETAIL_KEYS_MAX, detailKeysOf, detailModeOf, detailTitleOf, pressBehaviorOf } from "../src/detail/detail-settings";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";

function reading(key: string, sensorIndex: number, label = key): Reading {
	return { key, type: SensorType.Temperature, sensorIndex, id: 0, label, unit: "°C", value: 50, valueMin: 40, valueMax: 60, valueAvg: 50 };
}

function snapshotOf(readings: Reading[], sensorNames: string[]): SensorSnapshot {
	return {
		pollTime: 1,
		version: 1,
		revision: 1,
		sensors: sensorNames.map((name, index) => ({ index, id: index, instance: 0, name })),
		readings,
		byKey: new Map(readings.map((r) => [r.key, r]))
	};
}

const snapshot = snapshotOf(
	[reading("a:0:1", 0, "CPU Tctl"), reading("a:0:2", 0, "CPU Tdie"), reading("b:0:1", 1, "GPU Temp"), reading("a:0:3", 0, "CPU CCD1"), reading("b:0:2", 1, "GPU Hotspot")],
	["CPU [#0]", "GPU"]
);

describe("detail settings parsing", () => {
	it("pressBehavior: absent, junk, and future values behave as cycle-stat", () => {
		assert.equal(pressBehaviorOf({}), "cycle-stat");
		assert.equal(pressBehaviorOf({ pressBehavior: "cycle-stat" }), "cycle-stat");
		assert.equal(pressBehaviorOf({ pressBehavior: "open-details" }), "open-details");
		assert.equal(pressBehaviorOf({ pressBehavior: "tap-cycle-hold-details" }), "tap-cycle-hold-details");
		assert.equal(pressBehaviorOf({ pressBehavior: "teleport-from-the-future" }), "cycle-stat");
		assert.equal(pressBehaviorOf({ pressBehavior: 42 }), "cycle-stat");
		assert.equal(pressBehaviorOf({ pressBehavior: null }), "cycle-stat");
	});

	it("detailMode: only the exact 'custom' marker leaves source mode", () => {
		assert.equal(detailModeOf({}), "source");
		assert.equal(detailModeOf({ detailMode: "custom" }), "custom");
		assert.equal(detailModeOf({ detailMode: "Custom" }), "source");
		assert.equal(detailModeOf({ detailMode: ["custom"] }), "source");
	});

	it("detailKeys: order kept, duplicates dropped at first occurrence, junk entries ignored", () => {
		assert.deepEqual(detailKeysOf({ detailKeys: ["b", "a", "b", "", 42, null, "c", "a"] as unknown as string[] }), ["b", "a", "c"]);
		assert.deepEqual(detailKeysOf({}), []);
		assert.deepEqual(detailKeysOf({ detailKeys: "nope" as unknown as string[] }), []);
	});

	it("detailKeys: capped without erroring", () => {
		const many = Array.from({ length: DETAIL_KEYS_MAX + 40 }, (_, i) => `k${i}`);
		const parsed = detailKeysOf({ detailKeys: many });
		assert.equal(parsed.length, DETAIL_KEYS_MAX);
		assert.equal(parsed[0], "k0");
	});

	it("detailTitle: trimmed, whitespace-only and non-strings unset", () => {
		assert.equal(detailTitleOf({ detailTitle: "  My CPU  " }), "My CPU");
		assert.equal(detailTitleOf({ detailTitle: "   " }), undefined);
		assert.equal(detailTitleOf({ detailTitle: 42 }), undefined);
	});
});

describe("source-mode resolution", () => {
	it("selects every reading of the primary's source, snapshot order, primary excluded", () => {
		const group = resolveDetailGroup(snapshot, { readingKey: "a:0:2" });
		assert.notEqual(group, null);
		assert.equal(group?.mode, "source");
		assert.equal(group?.title, "CPU [#0]");
		assert.deepEqual(group?.keys, ["a:0:1", "a:0:3"]);
	});

	it("filter mode matches source name or label with * and ?, case-insensitively, in snapshot order", () => {
		const gpuOnly = resolveDetailGroup(snapshot, { readingKey: "a:0:1", detailMode: "filter", detailFilter: "*gpu*" });
		assert.deepEqual(gpuOnly?.keys, ["b:0:1", "b:0:2"]);
		assert.equal(gpuOnly?.title, "*gpu*");
		const anchored = resolveDetailGroup(snapshot, { readingKey: "b:0:1", detailMode: "filter", detailFilter: "?PU*tctl*" });
		assert.deepEqual(anchored?.keys, ["a:0:1"]);
		const upper = resolveDetailGroup(snapshot, { readingKey: "a:0:1", detailMode: "filter", detailFilter: "TDIE" });
		assert.deepEqual(upper?.keys, ["a:0:2"]); // plain text = substring, any case
	});

	it("filter mode excludes the primary, titles from detailTitle when set, and resolves without the primary present", () => {
		const all = resolveDetailGroup(snapshot, { readingKey: "a:0:1", detailMode: "filter", detailFilter: "*", detailTitle: "Everything" });
		assert.deepEqual(all?.keys, ["a:0:2", "b:0:1", "a:0:3", "b:0:2"]);
		assert.equal(all?.title, "Everything");
		// A primary the snapshot no longer publishes: the pattern still works
		// (it lives on the Back tile as Sensor missing, like custom mode).
		const orphaned = resolveDetailGroup(snapshot, { readingKey: "gone:0:0", detailMode: "filter", detailFilter: "hotspot" });
		assert.deepEqual(orphaned?.keys, ["b:0:2"]);
	});

	it("filter mode without a usable pattern (or snapshot) is unresolvable", () => {
		assert.equal(resolveDetailGroup(snapshot, { readingKey: "a:0:1", detailMode: "filter" }), null);
		assert.equal(resolveDetailGroup(snapshot, { readingKey: "a:0:1", detailMode: "filter", detailFilter: "   " }), null);
		assert.equal(resolveDetailGroup(snapshot, { readingKey: "a:0:1", detailMode: "filter", detailFilter: 42 }), null);
		assert.equal(resolveDetailGroup(null, { readingKey: "a:0:1", detailMode: "filter", detailFilter: "*gpu*" }), null);
	});

	it("an orphan primary (sensorIndex -1) is unresolvable, never a cross-source group", () => {
		// The reader parks readings whose SHM row points past the sensor
		// table at sensorIndex -1; every orphan shares it. Grouping by it
		// would list another source's strays under this reading's label.
		const orphans = snapshotOf([reading("?:5:a", -1, "Orphan A"), reading("?:9:b", -1, "Orphan B"), reading("a:0:1", 0, "CPU Tctl")], ["CPU [#0]"]);
		assert.equal(resolveDetailGroup(orphans, { readingKey: "?:5:a" }), null);
	});

	it("resolves by stable key only: a missing primary returns null (ride on the last list)", () => {
		assert.equal(resolveDetailGroup(snapshot, { readingKey: "gone:0:0" }), null);
		assert.equal(resolveDetailGroup(null, { readingKey: "a:0:1" }), null);
	});

	it("a custom title overrides the source name", () => {
		const group = resolveDetailGroup(snapshot, { readingKey: "b:0:1", detailTitle: "Graphics" });
		assert.equal(group?.title, "Graphics");
		assert.deepEqual(group?.keys, ["b:0:2"]);
	});

	it("re-resolution follows a layout change (new reading joins its source)", () => {
		const grown = snapshotOf([reading("a:0:1", 0), reading("a:0:9", 0, "CPU new"), reading("a:0:2", 0)], ["CPU [#0]"]);
		const group = resolveDetailGroup(grown, { readingKey: "a:0:1" });
		assert.deepEqual(group?.keys, ["a:0:9", "a:0:2"]);
	});
});

describe("custom-mode resolution", () => {
	it("uses configured order and never needs the snapshot", () => {
		const group = resolveDetailGroup(null, { readingKey: "a:0:1", detailMode: "custom", detailKeys: ["b:0:2", "x:0:9", "a:0:3"] });
		assert.equal(group?.mode, "custom");
		assert.deepEqual(group?.keys, ["b:0:2", "x:0:9", "a:0:3"]);
		assert.equal(group?.title, "Custom set");
	});

	it("keeps a missing configured reading's position (no shifting)", () => {
		const group = resolveDetailGroup(snapshot, { readingKey: "a:0:1", detailMode: "custom", detailKeys: ["b:0:1", "not-there:0:0", "b:0:2"] });
		assert.deepEqual(group?.keys, ["b:0:1", "not-there:0:0", "b:0:2"]);
	});

	it("excludes the opener's primary key (it lives on the Back tile)", () => {
		const group = resolveDetailGroup(snapshot, { readingKey: "b:0:1", detailMode: "custom", detailKeys: ["b:0:1", "b:0:2"] });
		assert.deepEqual(group?.keys, ["b:0:2"]);
	});

	it("no primary key resolves nothing, and settings are never mutated", () => {
		const settings = { readingKey: "", detailMode: "custom", detailKeys: ["a:0:1", "a:0:1", 42] as unknown as string[] };
		const before = JSON.stringify(settings);
		assert.equal(resolveDetailGroup(snapshot, settings), null);
		resolveDetailGroup(snapshot, { ...settings, readingKey: "a:0:1" });
		assert.equal(JSON.stringify(settings), before);
	});
});

describe("pagination", () => {
	const keys = Array.from({ length: 25 }, (_, i) => `k${i}`);

	it("projects a full first page with correct range and flags", () => {
		const page = pageOf(keys, 0, 11);
		assert.equal(page.slots.length, 11);
		assert.equal(page.slots[0], "k0");
		assert.equal(page.rangeText, "1-11 / 25");
		assert.equal(page.hasPrevious, false);
		assert.equal(page.hasNext, true);
	});

	it("clamps arbitrary offsets onto page boundaries", () => {
		assert.equal(clampOffset(25, 999, 11), 22);
		assert.equal(clampOffset(25, -5, 11), 0);
		assert.equal(clampOffset(25, 13, 11), 11);
		assert.equal(clampOffset(0, 7, 11), 0);
		assert.equal(clampOffset(25, Number.NaN, 11), 0);
	});

	it("the last page shows the remainder and disables next", () => {
		const page = pageOf(keys, 22, 11);
		assert.equal(page.rangeText, "23-25 / 25");
		assert.equal(page.slots[2], "k24");
		assert.equal(page.slots[3], undefined);
		assert.equal(page.hasPrevious, true);
		assert.equal(page.hasNext, false);
	});

	it("an empty group renders 0 / 0 with both pagers disabled", () => {
		const page = pageOf([], 0, 4);
		assert.equal(page.rangeText, "0 / 0");
		assert.equal(page.hasPrevious, false);
		assert.equal(page.hasNext, false);
		assert.deepEqual(page.slots, [undefined, undefined, undefined, undefined]);
	});

	it("a junk page size still yields a sane one-slot page", () => {
		const page = pageOf(["a"], 0, 0);
		assert.equal(page.slots.length, 1);
		assert.equal(page.rangeText, "1-1 / 1");
	});

	it("a reserved mirror slot: readings flow around it, the step shrinks, nothing hides", () => {
		const ten = Array.from({ length: 10 }, (_, i) => `k${i}`);
		const first = pageOf(ten, 0, 5, 1);
		assert.equal(first.step, 4);
		assert.deepEqual(first.slots, ["k0", undefined, "k1", "k2", "k3"]);
		assert.equal(first.rangeText, "1-4 / 10");
		assert.equal(first.hasNext, true);
		const second = pageOf(ten, first.offset + first.step, 5, 1);
		assert.deepEqual(second.slots, ["k4", undefined, "k5", "k6", "k7"]);
		assert.equal(second.rangeText, "5-8 / 10");
		const last = pageOf(ten, second.offset + second.step, 5, 1);
		assert.deepEqual(last.slots, ["k8", undefined, "k9", undefined, undefined]);
		assert.equal(last.rangeText, "9-10 / 10");
		assert.equal(last.hasNext, false);
	});

	it("a mirror outside the page (or on a one-slot page) is ignored", () => {
		assert.equal(pageOf(["a", "b"], 0, 2, 7).step, 2);
		assert.equal(pageOf(["a", "b"], 0, 2, -1).step, 2);
		assert.equal(pageOf(["a"], 0, 1, 0).step, 1);
		assert.equal(pageOf(["a", "b"], 0, 2, 1.5).step, 2);
	});
});
