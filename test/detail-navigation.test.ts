// Device-scoped drill-down navigation: entry validation and rollback,
// previous-profile restore with the name omitted, boundary-safe paging,
// per-device isolation, ephemeral stat modes, source re-resolution, and
// the bounded cleanup paths (unconfirmed entry, manual profile change,
// disconnect). The SDK switch is a recording fake throughout.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DetailNavigator } from "../src/detail/navigation";
import { tickSignature } from "../src/detail/tick-signature";
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

function bed(overrides?: { failSwitch?: boolean; deferSwitch?: boolean }): {
	nav: DetailNavigator;
	switches: Switch[];
	changed: string[];
	fireTimers: () => void;
	pendingTimers: () => number;
	advance: (ms: number) => void;
	settleSwitch: (fail?: boolean) => void;
} {
	const switches: Switch[] = [];
	const changed: string[] = [];
	let next = 1;
	let clock = 1_000_000;
	const timers = new Map<number, () => void>();
	let pendingSettle: { resolve: () => void; reject: (err: Error) => void } | null = null;
	const nav = new DetailNavigator({
		switchProfile: (deviceId, profileName, page) => {
			switches.push({ deviceId, profileName, page });
			if (overrides?.deferSwitch === true) {
				return new Promise<void>((resolve, reject) => {
					pendingSettle = { resolve, reject };
				});
			}
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
		},
		now: () => clock
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
		pendingTimers: (): number => timers.size,
		advance: (ms: number): void => {
			clock += ms;
		},
		settleSwitch: (fail = false): void => {
			if (pendingSettle !== null) {
				const settle = pendingSettle;
				pendingSettle = null;
				if (fail) {
					settle.reject(new Error("late no"));
				} else {
					settle.resolve();
				}
			}
		}
	};
}

const opener = { readingKey: "cpu:0:0" };

describe("entry", () => {
	it("switches a supported device to its class profile and holds state", async () => {
		const { nav, switches } = bed();
		const result = await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		assert.equal(result, "entered");
		assert.deepEqual(switches, [{ deviceId: "dev1", profileName: "profiles/detail-r3-standard", page: undefined }]);
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

	it("a Virtual Stream Deck enters as a guest of the bundle its grid fits", async () => {
		const { nav, switches } = bed();
		const result = await nav.enter({ deviceId: "vsd", deviceType: 11, grid: { columns: 10, rows: 10 }, settings: opener, snapshot });
		assert.equal(result, "entered");
		assert.equal(switches[0]?.profileName, "profiles/detail-r3-plus-xl");
		assert.equal(nav.stateFor("vsd")?.pageSize, 32);
	});

	it("a too-small virtual deck refuses honestly", async () => {
		const { nav, switches } = bed();
		assert.equal(await nav.enter({ deviceId: "vsd2", deviceType: 11, grid: { columns: 2, rows: 2 }, settings: opener, snapshot }), "unsupported");
		assert.equal(await nav.enter({ deviceId: "vsd3", deviceType: 11, settings: opener, snapshot }), "unsupported");
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

	it("a second press while the switch is in flight is refused, and a late rejection rolls back only its own session", async () => {
		const { nav, switches, settleSwitch } = bed({ deferSwitch: true });
		const first = nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		const second = await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		assert.equal(second, "already-active");
		assert.equal(switches.length, 1); // no stacked switch call
		settleSwitch(true); // the app rejects the first call late
		assert.equal(await first, "switch-failed");
		assert.equal(nav.stateFor("dev1"), undefined);
		// A retry after the failure works normally.
		const retry = nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		settleSwitch(false);
		assert.equal(await retry, "entered");
		assert.notEqual(nav.stateFor("dev1"), undefined);
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

	it("a rapid double Back is one hop; a later stateless Back still works", async () => {
		const { nav, switches, advance } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		await nav.leave("dev1");
		await nav.leave("dev1"); // double-tap or contact bounce
		assert.equal(switches.filter((s) => s.profileName === undefined).length, 1);
		advance(2_000); // past the debounce: a genuine second Back (stateless) hops
		await nav.leave("dev1");
		assert.equal(switches.filter((s) => s.profileName === undefined).length, 2);
	});

	it("the just-left blackout flushes before the restore is dispatched", async () => {
		const order: string[] = [];
		const nav = new DetailNavigator({
			switchProfile: () => {
				order.push("switch");
				return Promise.resolve();
			},
			onLeaving: () => order.push("blackout"),
			now: () => 1
		});
		await nav.leave("dev1");
		assert.deepEqual(order, ["blackout", "switch"]);
	});

	it("recentlyLeft covers exactly the switch beat, and a new entry clears it", async () => {
		const { nav, advance } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		assert.equal(nav.recentlyLeft("dev1"), false);
		await nav.leave("dev1");
		assert.equal(nav.recentlyLeft("dev1"), true);
		advance(1_400);
		assert.equal(nav.recentlyLeft("dev1"), true);
		advance(200); // past the beat: honest idle faces may return
		assert.equal(nav.recentlyLeft("dev1"), false);
		await nav.leave("dev1"); // stateless Back re-arms the window
		assert.equal(nav.recentlyLeft("dev1"), true);
		advance(300);
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		assert.equal(nav.recentlyLeft("dev1"), false); // fresh session, no ghost
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
		assert.equal(switches[1]?.profileName, "profiles/detail-r3-plus-xl");
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

describe("switch-beat and late-accept seams", () => {
	it("a double-tapped opener dispatches one switch; the pending entry stays retryable past the beat", async () => {
		const { nav, switches, advance } = bed();
		assert.equal(await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot }), "entered");
		// The second tap lands while the app is still switching (or the
		// install prompt just opened): no second switchToProfile, which
		// could stamp the detail profile into the app's "previous" register.
		assert.equal(await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot }), "already-active");
		assert.equal(switches.length, 1);
		// Past the beat the pending session is retryable (declined install).
		advance(1_600);
		assert.equal(await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot }), "entered");
		assert.equal(switches.length, 2);
	});

	it("a confirmed re-entry clears the leave debounce: Back on the new view works immediately", async () => {
		const { nav, switches, advance } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		await nav.leave("dev1");
		advance(400);
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		advance(700); // 1.1 s after the first Back: inside the old debounce
		await nav.leave("dev1");
		assert.equal(switches.filter((s) => s.profileName === undefined).length, 2);
		assert.equal(nav.stateFor("dev1"), undefined);
	});

	it("an install prompt accepted after the pending expiry backs out instead of stranding", async () => {
		const { nav, switches, fireTimers } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		fireTimers(); // 30 s: the unconfirmed entry expires
		nav.surfaceSeen("dev1"); // the user accepts late; the app switches in
		assert.deepEqual(switches.at(-1), { deviceId: "dev1", profileName: undefined, page: undefined });
		assert.equal(nav.stateFor("dev1"), undefined);
	});

	it("a stale tombstone or a plain restart keeps the honest idle surface", async () => {
		const { nav, switches, fireTimers, advance } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		fireTimers();
		advance(11 * 60_000); // the accept comes far too late to correlate
		nav.surfaceSeen("dev1");
		assert.equal(switches.filter((s) => s.profileName === undefined).length, 0);
		// No tombstone at all (the restart-inside-the-view shape): same.
		nav.surfaceSeen("dev1");
		assert.equal(switches.filter((s) => s.profileName === undefined).length, 0);
	});

	it("a retry whose switch call fails puts the expiry tombstone back", async () => {
		const { nav, switches, fireTimers, advance, settleSwitch } = bed({ deferSwitch: true });
		const first = nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		settleSwitch();
		assert.equal(await first, "entered");
		fireTimers(); // 30 s: the unconfirmed entry expires into a tombstone
		advance(2_000);
		const retry = nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		settleSwitch(true); // the app rejects the retry's dispatch
		assert.equal(await retry, "switch-failed");
		// The ORIGINAL prompt is still out there; a late accept must bounce
		// out, which only works if the rollback restored the tombstone.
		nav.surfaceSeen("dev1");
		assert.deepEqual(switches.at(-1), { deviceId: "dev1", profileName: undefined, page: undefined });
	});

	it("leave arms a one-shot repaint so a no-op restore cannot leave the blackout up", async () => {
		const { nav, changed, fireTimers, pendingTimers } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		await nav.leave("dev1");
		changed.length = 0;
		assert.equal(pendingTimers(), 1, "the repaint shot is armed");
		fireTimers();
		assert.deepEqual(changed, ["dev1"]);
		assert.equal(pendingTimers(), 0);
	});

	it("a fresh entry replaces the post-leave repaint with its own expiry timer", async () => {
		const { nav, pendingTimers, advance } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		await nav.leave("dev1");
		assert.equal(pendingTimers(), 1); // the repaint shot
		advance(2_000);
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		assert.equal(pendingTimers(), 1); // the new entry's expiry only
	});

	it("a fresh entry after an expiry claims the appearing surface (no bounce)", async () => {
		const { nav, switches, fireTimers, advance } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		fireTimers();
		advance(2_000);
		assert.equal(await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot }), "entered");
		nav.surfaceSeen("dev1");
		assert.equal(nav.stateFor("dev1")?.pending, false);
		assert.equal(switches.filter((s) => s.profileName === undefined).length, 0);
	});
});

describe("mirror Back slot", () => {
	it("carries the opener cell, pages with the reduced stride, and restores it when cleared", async () => {
		const { nav, changed } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot, openerCell: { column: 2, row: 1 } });
		const state = nav.stateFor("dev1");
		assert.deepEqual(state?.openerCell, { column: 2, row: 1 });
		if (state === undefined) return;
		nav.setMirrorSlotIndex("dev1", 4);
		assert.equal(nav.pageFor(state).step, 10); // 11 slots, one mirrored
		assert.equal(nav.pageFor(state).slots[4], undefined);
		nav.pageNext("dev1");
		assert.equal(state.offset, 10);
		assert.equal(nav.pageFor(state).rangeText, "11-13 / 13");
		nav.pagePrevious("dev1");
		assert.equal(state.offset, 0);
		const repaints = changed.length;
		nav.setMirrorSlotIndex("dev1", 4); // unchanged value: no repaint
		assert.equal(changed.length, repaints);
		nav.setMirrorSlotIndex("dev1", null);
		assert.equal(nav.pageFor(state).step, 11);
	});

	it("a session without an opener cell has no mirror; unknown devices no-op", async () => {
		const { nav } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		const state = nav.stateFor("dev1");
		assert.equal(state?.openerCell, null);
		nav.setMirrorSlotIndex("ghost", 3); // no state: silently ignored
		assert.equal(state?.mirrorSlotIndex, null);
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

describe("tickSignature — the detail render gate", () => {
	const ok = (snapshot: SensorSnapshot) => ({ state: "ok", snapshot, source: "shared-memory" }) as const;

	it("holds still while nothing moves, and follows pollTime", () => {
		const snap = snapshotOf([reading("cpu:0:0", 0)], ["CPU"]);
		assert.equal(tickSignature(ok(snap)), tickSignature(ok(snap)));
		const later = { ...snap, pollTime: snap.pollTime + 1 };
		assert.notEqual(tickSignature(ok(later)), tickSignature(ok(snap)));
	});

	it("a valueRevision bump repaints even under an unchanged pollTime second", () => {
		// HWiNFO polling faster than 1 Hz: same stamp, same count, new values.
		// The provider bumps valueRevision; the gate must see it (the Codex
		// review caught the old pollTime:count signature capping the detail
		// view at 1 Hz while ordinary keys tracked every change).
		const snap = { ...snapshotOf([reading("cpu:0:0", 0)], ["CPU"]), valueRevision: 7 };
		const moved = { ...snap, valueRevision: 8 };
		assert.equal(moved.pollTime, snap.pollTime);
		assert.equal(moved.readings.length, snap.readings.length);
		assert.notEqual(tickSignature(ok(moved)), tickSignature(ok(snap)));
	});

	it("the source is part of the ok line, so a provider swap can never replay a spent string", () => {
		const snap = { ...snapshotOf([reading("cpu:0:0", 0)], ["CPU"]), valueRevision: 1 };
		assert.notEqual(tickSignature({ state: "ok", snapshot: snap, source: "gadget" }), tickSignature(ok(snap)));
	});

	it("a provider without revisions still gates on pollTime, and states keep their own lines", () => {
		const snap = snapshotOf([reading("cpu:0:0", 0)], ["CPU"]);
		assert.equal(snap.valueRevision, undefined);
		assert.equal(tickSignature(ok(snap)), tickSignature(ok({ ...snap })));
		assert.notEqual(tickSignature({ state: "stale", snapshot: snap, source: "shared-memory", staleForMs: 20_000 }), tickSignature(ok(snap)));
		assert.notEqual(tickSignature({ state: "unavailable", reason: "busy", message: "" }), tickSignature({ state: "unavailable", reason: "not-running", message: "" }));
	});
});
