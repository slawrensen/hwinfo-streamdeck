// Per-reading session statistics. Keyed by the stable reading identity so
// no group member can ever inherit another member's numbers, and bounded by
// relevance (prune) so a hidden dial cannot grow without limit while a big
// rotation set can never thrash its own sessions.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SessionStatsStore } from "../src/stats";
import { thresholdsApplyTo } from "../src/ui/format";

describe("SessionStatsStore", () => {
	it("folds samples per reading, independently", () => {
		const store = new SessionStatsStore();
		store.sample("cpu", 50);
		store.sample("cpu", 60);
		store.sample("gpu", 30);
		assert.deepEqual(store.get("cpu"), { min: 50, max: 60, sum: 110, count: 2 });
		assert.deepEqual(store.get("gpu"), { min: 30, max: 30, sum: 30, count: 1 });
	});

	it("rotating away and back finds the member's own session again", () => {
		const store = new SessionStatsStore();
		store.sample("a", 10);
		store.sample("b", 99); // the dial moved on...
		assert.equal(store.get("a")?.min, 10); // ...but a's session is intact
		assert.equal(store.get("b")?.max, 99);
	});

	it("ignores non-finite samples", () => {
		const store = new SessionStatsStore();
		store.sample("k", Number.NaN);
		store.sample("k", Number.POSITIVE_INFINITY);
		assert.equal(store.get("k"), undefined);
	});

	it("reset of listed keys deletes only those sessions", () => {
		const store = new SessionStatsStore();
		store.sample("a", 1);
		store.sample("b", 2);
		store.reset(["a", "never-tracked"]);
		assert.equal(store.get("a"), undefined);
		assert.equal(store.get("b")?.max, 2);
	});

	it("reset without keys clears everything", () => {
		const store = new SessionStatsStore();
		store.sample("a", 1);
		store.sample("b", 2);
		store.reset();
		assert.equal(store.size, 0);
	});

	it("prune drops only strays, oldest first, down to keep+slack", () => {
		const store = new SessionStatsStore();
		const keep = new Set(["a", "b"]);
		store.sample("old1", 1);
		store.sample("a", 1);
		store.sample("old2", 1);
		store.sample("b", 1);
		store.sample("old3", 1);
		store.prune(keep, 1);
		assert.equal(store.size, 3); // keep(2) + slack(1)
		assert.notEqual(store.get("a"), undefined);
		assert.notEqual(store.get("b"), undefined);
		assert.equal(store.get("old1"), undefined); // oldest stray went first
		assert.equal(store.get("old2"), undefined);
		assert.notEqual(store.get("old3"), undefined); // newest stray fits the slack
	});

	it("a sampled set larger than any slack never thrashes its own sessions", () => {
		// Regression: an insert-time cap silently reset EVERY session each tick
		// once the sampled working set outgrew it (65 keys vs cap 64).
		const store = new SessionStatsStore();
		const keys = Array.from({ length: 65 }, (_, i) => `k${i}`);
		const keep = new Set(keys);
		for (let tick = 0; tick < 100; tick++) {
			for (const key of keys) {
				store.sample(key, tick);
			}
			store.prune(keep, 64);
		}
		for (const key of keys) {
			assert.equal(store.get(key)?.count, 100, `${key} lost its session`);
			assert.equal(store.get(key)?.min, 0);
			assert.equal(store.get(key)?.max, 99);
		}
	});
});

describe("thresholdsApplyTo (mixed-unit safety)", () => {
	it("unscoped (pre-existing settings) applies everywhere", () => {
		assert.equal(thresholdsApplyTo(undefined, "°C"), true);
		assert.equal(thresholdsApplyTo(undefined, "RPM"), true);
	});

	it("a stamped unit applies only to that unit", () => {
		assert.equal(thresholdsApplyTo("°C", "°C"), true);
		assert.equal(thresholdsApplyTo("°C", "RPM"), false);
	});

	it("the empty string is a real unit (unitless readings), not a wildcard", () => {
		assert.equal(thresholdsApplyTo("", ""), true);
		// A threshold stamped on a Gadget boolean by 1.6.0 carries the word.
		assert.equal(thresholdsApplyTo("No", "Yes/No"), true);
		assert.equal(thresholdsApplyTo("Yes", "Yes/No"), true);
		assert.equal(thresholdsApplyTo("Yes", "°C"), false);
		assert.equal(thresholdsApplyTo("Yes/No", "Yes"), false);
		assert.equal(thresholdsApplyTo("", "RPM"), false);
	});
});

describe("a reset aims at measurements", () => {
	it("resetIdentities clears every spelling sampled for one measurement and nothing else", async () => {
		const { SessionStatsStore } = await import("../src/stats");
		const store = new SessionStatsStore();
		const snapshot = { pollTime: 1, version: 1, revision: 0, sensors: [], readings: [], byKey: new Map() };
		const live = { key: "f0001234:0:1000001", type: 1, sensorIndex: 0, id: 1, label: "Temperature", unit: "°C", value: 40, valueMin: 40, valueMax: 40, valueAvg: 40 };
		const alias = { ...live, key: "g:GPU:Temperature", aliasOf: live.key, linkedKeys: [live.key, "g:GPU:Temperature"] };
		const other = { ...live, key: "f0001234:0:1000002", id: 2, value: 70 };
		for (const reading of [live, alias, other]) store.observe(reading, snapshot, "shared-memory");
		assert.equal(store.size, 3);
		store.resetIdentities(new Set([live.key]));
		assert.equal(store.get(live.key), undefined);
		assert.equal(store.get(alias.key), undefined, "the other spelling's session goes with it");
		assert.deepEqual(store.get(other.key), { min: 70, max: 70, sum: 70, count: 1 });
	});
});
