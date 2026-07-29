// Device-scoped drill-down navigation: entry validation and rollback,
// previous-profile restore with the name omitted, boundary-safe paging,
// per-device isolation, ephemeral stat modes, source re-resolution, and
// the bounded cleanup paths (unconfirmed entry, manual profile change,
// disconnect). The SDK switch is a recording fake throughout.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DetailNavigator } from "../src/detail/navigation";
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

const cpuKeys = Array.from({ length: 14 }, (_, i) => `cpu:0:${i}`);
const snapshot = snapshotOf(
	[...cpuKeys.map((k) => reading(k, 0, `CPU ${k}`)), reading("gpu:0:1", 1)],
	["CPU [#0]", "GPU"]
);

type Switch = { deviceId: string; profileName?: string; page?: number };

function bed(overrides?: { failSwitch?: boolean }): {
	nav: DetailNavigator;
	switches: Switch[];
	changed: string[];
	fireTimers: () => void;
	pendingTimers: () => number;
} {
	const switches: Switch[] = [];
	const changed: string[] = [];
	let next = 1;
	const timers = new Map<number, () => void>();
	const nav = new DetailNavigator({
		switchProfile: (deviceId, profileName, page) => {
			switches.push({ deviceId, profileName, page });
			return overrides?.failSwitch === true ? Promise.reject(new Error("app said no")) : Promise.resolve();
		},
		onChanged: (deviceId) => changed.push(deviceId),
		setTimer: (fn) => {
			const id = next++;
			timers.set(id, fn);
			return id as unknown as ReturnType<typeof setTimeout>;
		},
		clearTimer: (h) => {
			timers.delete(h as unknown as number);
		}
	});
	return {
		nav,
		switches,
		changed,
		fireTimers: (): void => {
			for (const [id, fn] of [...timers]) {
				timers.delete(id);
				fn();
			}
		},
		pendingTimers: (): number => timers.size
	};
}

const opener = { readingKey: "cpu:0:0" };

describe("entry", () => {
	it("switches a supported device to its class profile and holds state", async () => {
		const { nav, switches } = bed();
		const result = await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		assert.equal(result, "entered");
		assert.deepEqual(switches, [{ deviceId: "dev1", profileName: "profiles/detail-standard", page: undefined }]);
		const state = nav.stateFor("dev1");
		assert.equal(state?.pageSize, 11);
		assert.equal(state?.group.keys.length, 13); // 14 CPU readings minus the primary
		assert.equal(state?.pending, true);
	});

	it("refuses an unsupported device type without switching", async () => {
		const { nav, switches } = bed();
		assert.equal(await nav.enter({ deviceId: "ped", deviceType: 5, settings: opener, snapshot }), "unsupported");
		assert.equal(await nav.enter({ deviceId: "unk", deviceType: undefined, settings: opener, snapshot }), "unsupported");
		assert.equal(switches.length, 0);
	});

	it("source mode with no snapshot or a missing primary refuses honestly", async () => {
		const { nav, switches } = bed();
		assert.equal(await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot: null }), "unresolved");
		assert.equal(await nav.enter({ deviceId: "dev1", deviceType: 0, settings: { readingKey: "gone:0:0" }, snapshot }), "unresolved");
		assert.equal(switches.length, 0);
		assert.equal(nav.stateFor("dev1"), undefined);
	});

	it("rolls state back when the switch call itself fails", async () => {
		const { nav, switches } = bed({ failSwitch: true });
		assert.equal(await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot }), "switch-failed");
		assert.equal(switches.length, 1);
		assert.equal(nav.stateFor("dev1"), undefined);
	});

	it("refuses a second entry while the surface is live (no nesting)", async () => {
		const { nav } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		assert.equal(await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot }), "already-active");
	});

	it("an unconfirmed entry (declined install) expires quietly", async () => {
		const { nav, fireTimers } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		assert.notEqual(nav.stateFor("dev1"), undefined);
		fireTimers();
		assert.equal(nav.stateFor("dev1"), undefined);
	});

	it("custom mode enters with HWiNFO down (keys are configured statically)", async () => {
		const { nav } = bed();
		const result = await nav.enter({
			deviceId: "dev1",
			deviceType: 0,
			settings: { readingKey: "cpu:0:0", detailMode: "custom", detailKeys: ["gpu:0:1", "x:0:0"] },
			snapshot: null
		});
		assert.equal(result, "entered");
		assert.deepEqual(nav.stateFor("dev1")?.group.keys, ["gpu:0:1", "x:0:0"]);
	});
});

describe("leaving", () => {
	it("Back clears state and restores the previous profile by omitting the name", async () => {
		const { nav, switches } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		await nav.leave("dev1");
		assert.equal(nav.stateFor("dev1"), undefined);
		assert.deepEqual(switches.at(-1), { deviceId: "dev1", profileName: undefined, page: undefined });
	});

	it("Back with no state still issues the restore (restart inside the view)", async () => {
		const { nav, switches } = bed();
		await nav.leave("dev1");
		assert.deepEqual(switches, [{ deviceId: "dev1", profileName: undefined, page: undefined }]);
	});

	it("stat modes die with the session", async () => {
		const { nav } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		nav.cycleSlotStat("dev1", "cpu:0:1");
		const before = nav.stateFor("dev1");
		assert.equal(before === undefined ? "" : nav.statModeFor(before, "cpu:0:1"), "min");
		await nav.leave("dev1");
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		const after = nav.stateFor("dev1");
		assert.equal(after === undefined ? "" : nav.statModeFor(after, "cpu:0:1"), "current");
	});
});

describe("paging and stats", () => {
	it("pages forward and back with no wraparound", async () => {
		const { nav, changed } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		const state = nav.stateFor("dev1");
		assert.notEqual(state, undefined);
		if (state === undefined) return;
		nav.pagePrevious("dev1"); // already at the start: no move, no repaint
		assert.equal(state.offset, 0);
		nav.pageNext("dev1");
		assert.equal(state.offset, 11);
		nav.pageNext("dev1"); // 13 keys, page size 11: no third page
		assert.equal(state.offset, 11);
		nav.pagePrevious("dev1");
		assert.equal(state.offset, 0);
		// Exactly the two real moves repainted (plus the entry notification).
		assert.equal(changed.filter((d) => d === "dev1").length, 3);
	});

	it("per-reading stat modes cycle current → min → max → avg → current", async () => {
		const { nav } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		const state = nav.stateFor("dev1");
		if (state === undefined) {
			assert.fail("no state");
		}
		for (const expected of ["min", "max", "avg", "current"]) {
			nav.cycleSlotStat("dev1", "cpu:0:2");
			assert.equal(nav.statModeFor(state, "cpu:0:2"), expected);
		}
		assert.equal(nav.statModeFor(state, "cpu:0:3"), "current"); // untouched reading unaffected
	});

	it("two devices hold independent groups, pages and stats", async () => {
		const { nav, switches } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		await nav.enter({ deviceId: "devxl", deviceType: 13, settings: { readingKey: "gpu:0:1" }, snapshot });
		assert.equal(switches[1]?.profileName, "profiles/detail-plus-xl");
		nav.pageNext("dev1");
		nav.cycleSlotStat("dev1", "cpu:0:1");
		const xl = nav.stateFor("devxl");
		assert.equal(xl?.offset, 0);
		assert.equal(xl === undefined ? "" : nav.statModeFor(xl, "cpu:0:1"), "current");
		nav.deviceDisconnected("dev1");
		assert.equal(nav.stateFor("dev1"), undefined);
		assert.notEqual(nav.stateFor("devxl"), undefined);
	});
});

describe("re-resolution", () => {
	it("source mode follows a layout change and clamps the offset", async () => {
		const { nav } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.pageNext("dev1");
		assert.equal(nav.stateFor("dev1")?.offset, 11);
		// HWiNFO restarts with only 3 CPU readings: the second page vanishes.
		const shrunk = snapshotOf([reading("cpu:0:0", 0), reading("cpu:0:1", 0), reading("cpu:0:2", 0), reading("cpu:0:3", 0)], ["CPU [#0]"]);
		nav.refresh("dev1", shrunk);
		const state = nav.stateFor("dev1");
		assert.deepEqual(state?.group.keys, ["cpu:0:1", "cpu:0:2", "cpu:0:3"]);
		assert.equal(state?.offset, 0);
	});

	it("a temporarily missing primary rides on the last valid list", async () => {
		const { nav } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		const keysBefore = nav.stateFor("dev1")?.group.keys;
		nav.refresh("dev1", snapshotOf([reading("other:0:0", 0)], ["Other"]));
		assert.deepEqual(nav.stateFor("dev1")?.group.keys, keysBefore);
		nav.refresh("dev1", null);
		assert.deepEqual(nav.stateFor("dev1")?.group.keys, keysBefore);
	});

	it("custom order never re-sorts on refresh", async () => {
		const { nav } = bed();
		await nav.enter({
			deviceId: "dev1",
			deviceType: 0,
			settings: { readingKey: "cpu:0:0", detailMode: "custom", detailKeys: ["cpu:0:5", "gpu:0:1", "cpu:0:2"] },
			snapshot
		});
		nav.refresh("dev1", snapshot);
		assert.deepEqual(nav.stateFor("dev1")?.group.keys, ["cpu:0:5", "gpu:0:1", "cpu:0:2"]);
	});
});

describe("surface lifecycle", () => {
	it("a manual profile change (all slots gone, no Back) drops the session after the grace", async () => {
		const { nav, fireTimers, switches } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		nav.surfaceSeen("dev1");
		nav.surfaceGone("dev1");
		assert.notEqual(nav.stateFor("dev1"), undefined); // one slot still up
		nav.surfaceGone("dev1");
		fireTimers();
		assert.equal(nav.stateFor("dev1"), undefined);
		assert.equal(switches.length, 1); // cleanup never force-switches anything
	});

	it("slots reappearing within the grace keep the session", async () => {
		const { nav, fireTimers } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		nav.surfaceGone("dev1");
		nav.surfaceSeen("dev1"); // page repaint churn
		fireTimers();
		assert.notEqual(nav.stateFor("dev1"), undefined);
	});

	it("disconnect cancels timers and only that device's state", async () => {
		const { nav, pendingTimers } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		await nav.enter({ deviceId: "dev2", deviceType: 1, settings: opener, snapshot });
		nav.deviceDisconnected("dev1");
		assert.equal(nav.stateFor("dev1"), undefined);
		assert.notEqual(nav.stateFor("dev2"), undefined);
		nav.shutdown();
		assert.equal(pendingTimers(), 0);
		assert.equal(nav.stateFor("dev2"), undefined);
	});
});
