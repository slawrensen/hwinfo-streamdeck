// Opener-owned page placement (7E, detailGaps): the salvage parser, the
// per-page reserved form of pageOf (and its exact equality with the
// original single mirror index), the cell-to-slot mapping through
// registered coordinates, the navigator's capture per bundle, the
// controller's blank and inert gap tiles, and the read-only preview the
// Page layout editor draws. Nothing here writes settings: the gap field is
// read, never normalized or rewritten.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DetailController } from "../src/detail/controller";
import { pageOf, projectDetailTiles, resolveDetailGroup } from "../src/detail/detail-group";
import { DETAIL_GAP_PAGES_MAX, detailGapsOf, storedDetailGapsOf, type DetailDensity, type DetailTileSpec } from "../src/detail/detail-settings";
import { DETAIL_PROFILES, readingSlotCapacity, type ManagedDetailProfile } from "../src/detail/managed-profiles";
import { DetailNavigator } from "../src/detail/navigation";
import { gapSignature, gapSlotSets, layoutSlotIndexByCell, previewDetailPage, reservedSlotsFor } from "../src/detail/placement";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";

function profile(key: ManagedDetailProfile["key"]): ManagedDetailProfile {
	const found = DETAIL_PROFILES.find((p) => p.key === key);
	assert.ok(found, key);
	return found;
}

const standard = profile("standard");

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

const cpuKeys = Array.from({ length: 30 }, (_, i) => `cpu:0:${i}`);
const snapshot = snapshotOf([...cpuKeys.map((k, i) => reading(k, 0, `CPU ${i}`)), reading("gpu:0:1", 1, "GPU Temp")], ["CPU [#0]", "GPU"]);
const ok: PollerStatus = { state: "ok", snapshot, source: "shared-memory" };

describe("detailGapsOf salvage", () => {
	// Standard deck: 5x3, Back (0,0), Title (1,0), Previous (0,1), Next (0,2).
	const cases: Array<[string, unknown, ReadonlyArray<ReadonlyArray<{ column: number; row: number }>>]> = [
		["absent", undefined, []],
		["null", null, []],
		["a string", "standard", []],
		["an array", [[{ column: 2, row: 0 }]], []],
		["another bundle only", { xl: [[{ column: 2, row: 0 }]] }, []],
		["an inherited key never counts", Object.create({ standard: [[{ column: 2, row: 0 }]] }), []],
		["a non-array bundle value", { standard: { 0: [{ column: 2, row: 0 }] } }, []],
		["one gap on page 1", { standard: [[{ column: 2, row: 0 }]] }, [[{ column: 2, row: 0 }]]],
		["extra fields on a cell are ignored, the cell kept", { standard: [[{ column: 3, row: 1, note: "x" }]] }, [[{ column: 3, row: 1 }]]],
		["a non-array page is a page without gaps, later pages stay put", { standard: ["junk", [{ column: 4, row: 2 }]] }, [[], [{ column: 4, row: 2 }]]],
		["outside the grid", { standard: [[{ column: 5, row: 0 }, { column: 0, row: 3 }, { column: -1, row: 0 }]] }, []],
		["navigation cells", { standard: [[{ column: 0, row: 0 }, { column: 1, row: 0 }, { column: 0, row: 1 }, { column: 0, row: 2 }]] }, []],
		["non-integer and non-number coordinates", { standard: [[{ column: 2.5, row: 0 }, { column: "2", row: 0 }, { column: 2, row: null }, { column: Number.NaN, row: 0 }, { column: Infinity, row: 0 }]] }, []],
		["non-object cells", { standard: [[null, 7, "2,0", [2, 0]]] }, []],
		["duplicates keep the first", { standard: [[{ column: 2, row: 0 }, { row: 0, column: 2 }, { column: 3, row: 0 }]] }, [[{ column: 2, row: 0 }, { column: 3, row: 0 }]]],
		["trailing empty pages are dropped", { standard: [[{ column: 2, row: 0 }], [], "x", [{ column: 9, row: 9 }]] }, [[{ column: 2, row: 0 }]]],
		["a layout with no usable gap is no layout", { standard: [[], [], [{ column: 0, row: 0 }]] }, []]
	];
	for (const [name, raw, expected] of cases) {
		it(name, () => {
			const settings = raw === undefined ? {} : { detailGaps: raw };
			assert.deepEqual(detailGapsOf(settings, standard), expected);
		});
	}

	it("a page whose gaps cover every reading cell is ignored for that page only", () => {
		const all = standard.layout.readings.map((cell) => ({ column: cell.column, row: cell.row }));
		const gaps = detailGapsOf({ detailGaps: { standard: [all, [{ column: 2, row: 0 }]] } }, standard);
		assert.deepEqual(gaps, [[], [{ column: 2, row: 0 }]]);
		assert.deepEqual(detailGapsOf({ detailGaps: { standard: [all.slice(1)] } }, standard), [all.slice(1)], "one reading cell left is a valid page");
	});

	it(`pages past ${DETAIL_GAP_PAGES_MAX} are ignored`, () => {
		const pages = Array.from({ length: DETAIL_GAP_PAGES_MAX + 4 }, () => [{ column: 2, row: 0 }]);
		assert.equal(detailGapsOf({ detailGaps: { standard: pages } }, standard).length, DETAIL_GAP_PAGES_MAX);
	});

	it("reads each bundle on its own: the same document gives each deck class its own layout", () => {
		const raw = { detailGaps: { standard: [[{ column: 2, row: 0 }]], "plus-xl": [[{ column: 8, row: 3 }]], future: [[{ column: 1, row: 1 }]] } };
		assert.deepEqual(detailGapsOf(raw, standard), [[{ column: 2, row: 0 }]]);
		assert.deepEqual(detailGapsOf(raw, profile("plus-xl")), [[{ column: 8, row: 3 }]]);
		assert.deepEqual(detailGapsOf(raw, profile("mini")), []);
	});

	it("never throws and never mutates what it reads", () => {
		for (const raw of [0, true, "x", [], { standard: null }, { standard: [null] }]) assert.deepEqual(detailGapsOf({ detailGaps: raw }, standard), []);
		const doc = { detailGaps: { standard: [[{ column: 2, row: 0 }, { column: 2, row: 0 }, null]] } };
		const before = JSON.stringify(doc);
		detailGapsOf(doc, standard);
		assert.equal(JSON.stringify(doc), before);
	});
});

describe("pageOf with per-page reservations", () => {
	it("the single mirror index and the per-page form agree on every input of a corpus", () => {
		const plans: DetailTileSpec[][] = [[], [{ size: 2, labels: [], colors: [], cellLabels: true }, { size: 3, labels: [], colors: [], cellLabels: true }]];
		for (const length of [0, 1, 5, 11, 12, 23, 40]) {
			const keys = Array.from({ length }, (_, i) => `k${i}`);
			for (const size of [1, 2, 5, 11]) {
				for (const mirror of [-1, 0, 3, 10, 11]) {
					for (const density of [1, 2, 4] as DetailDensity[]) {
						for (const plan of plans) {
							for (const offset of [0, 3, 11, 999, Number.NaN]) {
								const numeric = pageOf(keys, offset, size, mirror, density, plan);
								const fn = pageOf(keys, offset, size, () => new Set([mirror]), density, plan);
								assert.deepEqual(fn, numeric, JSON.stringify({ length, size, mirror, density, plan: plan.length, offset }));
							}
						}
					}
				}
			}
		}
	});

	it("each page has its own capacity, and paging forward and back lands on page starts", () => {
		const keys = Array.from({ length: 20 }, (_, i) => `k${i}`);
		// 11 slots: page 0 reserves two gaps, page 1 one, page 2 none.
		const reserved = (page: number): ReadonlySet<number> => new Set(page === 0 ? [0, 5] : page === 1 ? [10] : []);
		const first = pageOf(keys, 0, 11, reserved);
		assert.equal(first.step, 9);
		assert.deepEqual(first.reserved, [0, 5]);
		assert.equal(first.pageIndex, 0);
		assert.deepEqual(first.chunks[0], []);
		assert.deepEqual(first.chunks[1], ["k0"]);
		assert.deepEqual(first.chunks[5], []);
		assert.deepEqual(first.chunks[6], ["k4"]);
		assert.equal(first.rangeText, "1-9 / 20");
		const second = pageOf(keys, first.offset + first.step, 11, reserved);
		assert.equal(second.offset, 9);
		assert.equal(second.step, 10);
		assert.deepEqual(second.chunks[10], []);
		assert.equal(second.rangeText, "10-19 / 20");
		assert.equal(second.previousOffset, 0);
		const third = pageOf(keys, second.offset + second.step, 11, reserved);
		assert.equal(third.offset, 19);
		assert.equal(third.pageIndex, 2);
		assert.deepEqual(third.reserved, []);
		assert.equal(third.rangeText, "20-20 / 20");
		assert.equal(third.hasNext, false);
		assert.equal(third.previousOffset, 9);
		// An offset inside a page snaps down to that page's start.
		assert.equal(pageOf(keys, 12, 11, reserved).offset, 9);
	});

	it("every reading stays reachable: no reading is hidden behind a gap", () => {
		const keys = Array.from({ length: 37 }, (_, i) => `k${i}`);
		const reserved = (page: number): ReadonlySet<number> => new Set(page % 2 === 0 ? [1, 2, 3] : [7]);
		const seen: string[] = [];
		let page = pageOf(keys, 0, 11, reserved, 2);
		for (let guard = 0; guard < 50; guard++) {
			for (const chunk of page.chunks) seen.push(...chunk);
			if (!page.hasNext) break;
			page = pageOf(keys, page.offset + page.step, 11, reserved, 2);
		}
		assert.deepEqual(seen, keys);
	});

	it("a page whose reservations would leave no tile keeps none, so the walk always advances", () => {
		const keys = ["a", "b", "c", "d"];
		const page = pageOf(keys, 0, 3, () => new Set([0, 1, 2, 7, -1]));
		assert.deepEqual(page.reserved, []);
		assert.equal(page.step, 3);
		assert.deepEqual(pageOf(["a"], 0, 1, () => new Set([0])).reserved, [], "a one-slot page reserves nothing");
	});

	it("hand-grouped tiles keep their sizes around gaps", () => {
		const keys = Array.from({ length: 9 }, (_, i) => `k${i}`);
		const plan: DetailTileSpec[] = [{ size: 3, labels: [], colors: [], cellLabels: true }];
		const page = pageOf(keys, 0, 4, () => new Set([1]), 2, plan);
		assert.deepEqual(page.chunks, [["k0", "k1", "k2"], [], ["k3", "k4"], ["k5", "k6"]]);
		assert.equal(page.step, 7);
	});
});

describe("gap cells to slot indices", () => {
	const byLayout = layoutSlotIndexByCell(standard.layout.readings);

	it("the shipped layout maps reading cells to their slot order", () => {
		assert.equal(byLayout.get("2,0"), 0);
		assert.equal(byLayout.get("1,1"), 3);
		assert.equal(byLayout.get("4,2"), 10);
		assert.equal(byLayout.get("0,0"), undefined, "Back is no reading slot");
	});

	it("gaps follow registered coordinates: a moved slot carries its index", () => {
		const moved = new Map([["2,0", 5], ["3,0", 1]]);
		assert.deepEqual(gapSlotSets([[{ column: 2, row: 0 }]], moved, 11).map((s) => [...s]), [[5]]);
		assert.deepEqual(gapSlotSets([[{ column: 4, row: 0 }]], moved, 11).map((s) => [...s]), [[]], "no slot at the cell reserves nothing");
		assert.deepEqual(gapSlotSets([[{ column: 2, row: 0 }]], new Map([["2,0", 40]]), 11).map((s) => [...s]), [[]], "an index past the page is dropped");
	});

	it("the mirror rides every page and wins a cell both claim", () => {
		const fn = reservedSlotsFor([[{ column: 2, row: 0 }, { column: 3, row: 1 }], [], [{ column: 4, row: 2 }]], byLayout, 5, 11);
		assert.ok(fn);
		assert.deepEqual([...fn(0)].sort((a, b) => a - b), [0, 5]);
		assert.deepEqual([...fn(1)], [5], "a page without gaps keeps the mirror alone");
		assert.deepEqual([...fn(2)].sort((a, b) => a - b), [5, 10]);
		assert.deepEqual([...fn(9)], [5], "pages past the layout keep the mirror alone");
		const none = reservedSlotsFor([[{ column: 9, row: 9 }]], byLayout, 5, 11);
		assert.equal(none, undefined, "no gap that maps onto a slot: the caller keeps the original single index");
	});

	it("a page of gaps that would swallow the last tile beside the mirror keeps the mirror alone", () => {
		const all = standard.layout.readings.filter((_, i) => i !== 5);
		const fn = reservedSlotsFor([all], byLayout, 5, 11);
		assert.ok(fn);
		assert.deepEqual([...fn(0)], [5]);
	});

	it("the signature moves only when a reserved slot moves", () => {
		const gaps = [[{ column: 2, row: 0 }]];
		assert.equal(gapSignature(gaps, byLayout, 11), gapSignature(gaps, new Map(byLayout), 11));
		assert.notEqual(gapSignature(gaps, byLayout, 11), gapSignature(gaps, new Map([["2,0", 4]]), 11));
	});
});

describe("the navigator runs the opener's own layout", () => {
	function bed() {
		const changed: string[] = [];
		const nav = new DetailNavigator({
			switchProfile: () => Promise.resolve(),
			onChanged: (deviceId) => changed.push(deviceId),
			setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
			clearTimer: () => undefined,
			now: () => 1_000_000
		});
		return { nav, changed };
	}
	const opener = { readingKey: "cpu:0:0", detailGaps: { standard: [[{ column: 2, row: 0 }, { column: 3, row: 0 }]], xl: [[{ column: 1, row: 0 }]] } };

	it("enter captures only the resolved bundle's gaps; another bundle never borrows them", async () => {
		const { nav } = bed();
		await nav.enter({ deviceId: "std", deviceType: 0, settings: opener, snapshot });
		assert.equal(nav.stateFor("std")?.bundle, "standard");
		assert.deepEqual(nav.stateFor("std")?.gapCells, [[{ column: 2, row: 0 }, { column: 3, row: 0 }]]);
		// A Virtual Stream Deck sized 9x4 runs the + XL bundle: no layout there.
		await nav.enter({ deviceId: "vsd", deviceType: 11, grid: { columns: 9, rows: 4 }, settings: opener, snapshot });
		assert.equal(nav.stateFor("vsd")?.bundle, "plus-xl");
		assert.deepEqual(nav.stateFor("vsd")?.gapCells, []);
	});

	it("gaps reserve nothing until slots register, then page with the reduced capacity", async () => {
		const { nav, changed } = bed();
		await nav.enter({ deviceId: "std", deviceType: 0, settings: opener, snapshot, openerCell: { column: 4, row: 2 } });
		const state = nav.stateFor("std");
		assert.ok(state);
		assert.equal(nav.pageFor(state).step, 11, "no registered slot yet: the plain flow");
		const before = changed.length;
		nav.setSlotCells("std", layoutSlotIndexByCell(standard.layout.readings));
		assert.equal(changed.length, before + 1, "the reserved slots moved: one repaint");
		nav.setMirrorSlotIndex("std", 10);
		const page = nav.pageFor(state);
		assert.deepEqual(page.reserved, [0, 1, 10]);
		assert.equal(page.step, 8);
		assert.deepEqual(page.chunks[2], ["cpu:0:1"]);
		nav.pageNext("std");
		assert.equal(state.offset, 8);
		const second = nav.pageFor(state);
		assert.deepEqual(second.reserved, [10], "page 2 has no gaps: the mirror alone");
		assert.equal(second.step, 10);
		nav.pagePrevious("std");
		assert.equal(state.offset, 0);
		const repaints = changed.length;
		nav.setSlotCells("std", new Map(layoutSlotIndexByCell(standard.layout.readings)));
		assert.equal(changed.length, repaints, "the same mapping again: no repaint");
	});

	it("an opener without gaps never repaints for slot cells and pages exactly as before", async () => {
		const { nav, changed } = bed();
		await nav.enter({ deviceId: "std", deviceType: 0, settings: { readingKey: "cpu:0:0" }, snapshot, openerCell: { column: 4, row: 2 } });
		const state = nav.stateFor("std");
		assert.ok(state);
		const before = changed.length;
		nav.setSlotCells("std", layoutSlotIndexByCell(standard.layout.readings));
		assert.equal(changed.length, before);
		nav.setMirrorSlotIndex("std", 10);
		const group = resolveDetailGroup(snapshot, { readingKey: "cpu:0:0" });
		assert.ok(group);
		assert.deepEqual(nav.pageFor(state), pageOf(group.keys, 0, 11, 10, 1, projectDetailTiles(group, [])));
	});
});

describe("the controller draws gaps as space and ignores their presses", () => {
	async function surface(settings: Record<string, unknown>) {
		const nav = new DetailNavigator({ switchProfile: () => Promise.resolve(), setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimer: () => undefined, now: () => 1_000_000 });
		const controller = new DetailController(nav, { getStatus: () => ok });
		await nav.enter({ deviceId: "std", deviceType: 0, settings: { readingKey: "cpu:0:0", ...settings }, snapshot });
		const images = new Map<string, string>();
		standard.layout.readings.forEach((cell, index) => {
			controller.registerSlot(`r${index}`, "std", { slot: "reading", index }, { column: cell.column, row: cell.row }, { setImage: (svg) => void images.set(`r${index}`, svg) });
		});
		controller.renderDevice("std", ok);
		return { nav, controller, images };
	}

	it("a gap tile is the same themed blank as a tile past the list end, on data and on a status screen", async () => {
		const { controller, images, nav } = await surface({ detailGaps: { standard: [[{ column: 3, row: 0 }]] } });
		const gap = images.get("r1");
		assert.ok(gap);
		const short = await surface({ detailMode: "custom", detailKeys: ["cpu:0:1"] });
		assert.equal(gap, short.images.get("r5"), "the gap draws the page's blank");
		assert.notEqual(images.get("r0"), gap, "a reading tile draws a reading");
		const down: PollerStatus = { state: "unavailable", reason: "not-running", message: "fixture" };
		controller.renderDevice("std", down);
		assert.equal(images.get("r1"), gap, "a status screen leaves the space as space");
		assert.deepEqual(nav.stateFor("std")?.statModes.size, 0);
	});

	it("a press on a gap does nothing; a press on a reading tile cycles", async () => {
		const { controller, nav } = await surface({ detailGaps: { standard: [[{ column: 3, row: 0 }]] } });
		controller.slotKeyDown("r1");
		assert.equal(nav.stateFor("std")?.statModes.size, 0, "the gap press cycled nothing");
		controller.slotKeyDown("r0");
		assert.equal(nav.stateFor("std")?.statModes.get("cpu:0:1"), "min");
	});

	it("the mirror wins a cell it shares with a gap: Back's face, and a press goes back", async () => {
		// The opener's own cell (4,2) is slot 10 on the standard bundle and
		// is also stored as a gap on page one.
		const OPENER = { column: 4, row: 2 };
		async function mirrored(settings: Record<string, unknown>) {
			const switches: string[] = [];
			const nav = new DetailNavigator({ switchProfile: (deviceId) => {
					switches.push(deviceId);
					return Promise.resolve();
				}, setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimer: () => undefined, now: () => 1_000_000 });
			const controller = new DetailController(nav, { getStatus: () => ok });
			await nav.enter({ deviceId: "std", deviceType: 0, settings: { readingKey: "cpu:0:0", ...settings }, snapshot, openerCell: OPENER });
			const images = new Map<string, string>();
			standard.layout.readings.forEach((cell, index) => {
				controller.registerSlot(`r${index}`, "std", { slot: "reading", index }, { column: cell.column, row: cell.row }, { setImage: (svg) => void images.set(`r${index}`, svg) });
			});
			controller.renderDevice("std", ok);
			return { nav, controller, images, switches };
		}
		const shared = await mirrored({ detailGaps: { standard: [[OPENER, { column: 2, row: 0 }]] } });
		const plain = await mirrored({});
		const blank = (await surface({ detailMode: "custom", detailKeys: ["cpu:0:1"] })).images.get("r5");
		assert.equal(shared.nav.stateFor("std")?.mirrorSlotIndex, 10, "slot 10 is the mirror");
		assert.deepEqual(shared.nav.pageFor(shared.nav.stateFor("std")!).reserved, [0, 10], "the gap at (2,0) still applies beside the mirror");
		assert.equal(shared.images.get("r10"), plain.images.get("r10"), "the shared cell draws the same Back face as without a gap");
		assert.notEqual(shared.images.get("r10"), blank, "never the gap's blank");
		assert.equal(shared.images.get("r0"), blank, "the other gap draws the blank");
		const entered = shared.switches.length;
		shared.controller.slotKeyDown("r10");
		await Promise.resolve();
		assert.deepEqual(shared.switches.slice(entered), ["std"], "the press on the shared cell goes back");
		assert.equal(shared.nav.stateFor("std"), undefined);
	});

	it("a gap follows the slot actually at the cell when slots were moved", async () => {
		const nav = new DetailNavigator({ switchProfile: () => Promise.resolve(), setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimer: () => undefined, now: () => 1_000_000 });
		const controller = new DetailController(nav, { getStatus: () => ok });
		await nav.enter({ deviceId: "std", deviceType: 0, settings: { readingKey: "cpu:0:0", detailGaps: { standard: [[{ column: 2, row: 0 }]] } }, snapshot });
		// The user swapped slot 0 and slot 6 on the shared page.
		const cells = standard.layout.readings.map((cell) => ({ column: cell.column, row: cell.row }));
		const swapped = [...cells];
		[swapped[0], swapped[6]] = [cells[6] as { column: number; row: number }, cells[0] as { column: number; row: number }];
		swapped.forEach((cell, index) => controller.registerSlot(`r${index}`, "std", { slot: "reading", index }, cell, { setImage: () => undefined }));
		const state = nav.stateFor("std");
		assert.ok(state);
		assert.deepEqual(nav.pageFor(state).reserved, [6], "the gap at (2,0) reserves the slot sitting there");
	});
});

describe("the Page layout preview is the runtime's own walk, read-only", () => {
	it("lays out a page with gaps, the mirror and readings, and steps pages", () => {
		const draft = { readingKey: "cpu:0:0", detailGaps: { standard: [[{ column: 2, row: 0 }]] } };
		const doc = JSON.stringify(draft);
		const first = previewDetailPage(snapshot, draft, standard, { column: 4, row: 2 }, 0);
		assert.equal(first.resolved, true);
		assert.equal(first.pageIndex, 0);
		assert.equal(first.cells.length, readingSlotCapacity(standard));
		assert.deepEqual(first.cells[0], { column: 2, row: 0, kind: "gap" });
		assert.deepEqual(first.cells[10], { column: 4, row: 2, kind: "back" });
		assert.deepEqual(first.cells[1], { column: 3, row: 0, kind: "reading", label: "CPU 1", count: 1 });
		assert.equal(first.rangeText, "1-9 / 29");
		assert.equal(first.pageCount, 3, "9 + 10 + 10 readings");
		const second = previewDetailPage(snapshot, draft, standard, { column: 4, row: 2 }, 1);
		assert.equal(second.rangeText, "10-19 / 29");
		assert.equal(second.cells[0]?.kind, "reading");
		assert.equal(JSON.stringify(draft), doc, "the draft is never touched");
	});

	it("a page past the list end still shows its gaps and the mirror", () => {
		const draft = { readingKey: "cpu:0:0", detailMode: "custom", detailKeys: ["cpu:0:1"], detailGaps: { standard: [[], [], [{ column: 3, row: 1 }]] } };
		const page = previewDetailPage(snapshot, draft, standard, { column: 2, row: 0 }, 2);
		assert.equal(page.pageCount, 1);
		assert.equal(page.cells.find((c) => c.column === 3 && c.row === 1)?.kind, "gap");
		assert.equal(page.cells.find((c) => c.column === 2 && c.row === 0)?.kind, "back");
		assert.ok(page.cells.filter((c) => c.kind === "empty").length >= 8);
	});

	it("a page its gaps and the mirror fill shows its stored gaps as ignored, not as readings", () => {
		// Every reading cell but the opener's own (4,2) is stored as a gap on
		// page one: with the mirror on, the deck ignores that page's gaps.
		const others = standard.layout.readings.filter((c) => !(c.column === 4 && c.row === 2)).map((c) => ({ column: c.column, row: c.row }));
		const draft = { readingKey: "cpu:0:0", detailGaps: { standard: [others] } };
		const page = previewDetailPage(snapshot, draft, standard, { column: 4, row: 2 }, 0);
		assert.equal(page.rangeText, "1-10 / 29", "the deck lays the page out without the gaps");
		assert.deepEqual(page.cells.find((c) => c.column === 2 && c.row === 0), { column: 2, row: 0, kind: "gap", ignored: true });
		assert.equal(page.cells.filter((c) => c.kind === "gap" && c.ignored === true).length, others.length);
		assert.equal(page.cells.find((c) => c.column === 4 && c.row === 2)?.kind, "back");
		// Unticked, the opener's own cell is free and the gaps apply.
		const unticked = previewDetailPage(snapshot, { ...draft, detailMirrorBack: false }, standard, { column: 4, row: 2 }, 0);
		assert.deepEqual(unticked.cells.find((c) => c.column === 2 && c.row === 0), { column: 2, row: 0, kind: "gap" });
		assert.equal(unticked.cells.find((c) => c.column === 4 && c.row === 2)?.kind, "reading");
		// Every reading cell stored (the deck drops such a page outright).
		const all = previewDetailPage(snapshot, { readingKey: "cpu:0:0", detailMirrorBack: false, detailGaps: { standard: [standard.layout.readings] } }, standard, null, 0);
		assert.ok(all.cells.every((c) => c.kind === "gap" && c.ignored === true));
		assert.deepEqual(detailGapsOf({ detailGaps: { standard: [standard.layout.readings] } }, standard), []);
		assert.equal(storedDetailGapsOf({ detailGaps: { standard: [standard.layout.readings] } }, standard)[0]?.length, standard.layout.readings.length);
	});

	it("an exactly-false mirror and a list that does not resolve are honest", () => {
		const page = previewDetailPage(snapshot, { readingKey: "cpu:0:0", detailMirrorBack: false }, standard, { column: 2, row: 0 }, 0);
		assert.equal(page.cells[0]?.kind, "reading");
		const unresolved = previewDetailPage(null, { readingKey: "cpu:0:0" }, standard, null, 0);
		assert.equal(unresolved.resolved, false);
		assert.equal(unresolved.pageCount, 0);
		assert.ok(unresolved.cells.every((c) => c.kind === "empty"));
	});
});
