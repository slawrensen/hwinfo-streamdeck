/**
 * Strip Screens, the pure pieces: the stored form (config.screens, a
 * screen's name and id, screenCycle), the edit paths and the three
 * structural ops with their refusals, unknown fields following a screen's
 * id, the effective config's substitution, the Screens dial's routing and
 * hints on both decks, the settings-key walker, and the payload bound with
 * the position line and the name on every style and look.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixtureCase, screensMatrix, withScreens } from "../scripts/lib/strip-fixtures";
import { applyStripEdit, MAX_EDIT_OPS, type EditBase } from "../src/strip/edits";
import { effectiveConfig, freshView, screenIndexOf } from "../src/strip/frame";
import { IDLE_GESTURE } from "../src/gestures";
import { routeStripInput, screensTriggerDescriptions, stripTriggerDescriptions, type StripRouting } from "../src/strip/input";
import { tidyRungs } from "../src/strip/patterned";
import { fitNameRung, nameRungs, phraseRungs } from "../src/strip/readout";
import { autoScreenName, screenCritical, screenLabelOf, screenStep, screensColumnOf, wipeOrder } from "../src/strip/screens";
import { MAX_SCREENS, screenCountOf, screenKeysOf, screensOf, stripConfigOf, stripConfigToJson, stripPaneOf, type StripConfigV1, type StripPaneV1 } from "../src/strip/settings";
import type { StripSceneInput } from "../src/strip/scene";
import { SLICE_PAYLOAD_LIMIT, sliceStrip, svgBytes } from "../src/strip/slicer";
import { ART_PIECE_LIMIT, isArtLook } from "../src/ui/deck-art";
import { SensorType, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { snap } from "./strip-rule-runtime";

const ID = "0123456789abcdef0123456789abcdef";
const set = (path: string, value: unknown): { op: "set"; path: string; value: unknown } => ({ op: "set", path, value });
const ids = (...list: string[]): (() => string) => {
	const queue = [...list];
	return () => queue.shift() ?? "ffffffff";
};

/** A stored whole strip: panes[0] and `extra` screens after it. */
function stored(extra: readonly unknown[] = [], more: Record<string, unknown> = {}): Record<string, unknown> {
	return { layout: "whole", encoders: 6, window: "5m", panes: [{ style: "trend", series: [{ key: "a" }], screenId: "00000001" }, { style: "trend", series: [] }], ...(extra.length === 0 ? {} : { screens: extra }), ...more };
}
const baseOf = (raw: Record<string, unknown>, rev = 3): EditBase => ({ id: ID, rev, config: stripConfigOf(raw) });
const json = (config: StripConfigV1): Record<string, unknown> => stripConfigToJson(config) as Record<string, unknown>;

describe("screens: the stored form", () => {
	it("a strip without screens writes exactly what it did before them", () => {
		const raw = { layout: "whole", encoders: 6, window: "5m", panes: [{ style: "trend", series: [{ key: "a" }] }, { style: "heat", series: [] }] };
		const out = json(stripConfigOf(raw));
		assert.equal("screens" in out, false);
		assert.equal("screenCycle" in out, false);
		const panes = out.panes as Record<string, unknown>[];
		assert.deepEqual(Object.keys(panes[0] ?? {}), ["style", "series", "overlays", "scale", "bands"]);
		assert.equal(screenCountOf(stripConfigOf(raw)), 1);
		assert.deepEqual(screenKeysOf(stripConfigOf(raw)), ["@0"]);
	});

	it("screens, names, ids and the cycle round trip exactly", () => {
		const raw = stored([{ style: "meters", series: [{ key: "b" }], name: "GPU", screenId: "00000002" }, { style: "group", series: [], group: { from: "filter", filter: "*clock*", keys: [], view: "auto" }, screenId: "00000003" }], { screenCycle: 30 });
		const config = stripConfigOf(raw);
		assert.equal(screenCountOf(config), 3);
		assert.deepEqual(screenKeysOf(config), ["00000001", "00000002", "00000003"]);
		assert.equal(config.screenCycle, 30);
		assert.equal(config.screens?.[0]?.name, "GPU");
		const again = stripConfigOf(json(config));
		assert.deepEqual(json(again), json(config));
		assert.deepEqual((json(config).screens as Record<string, unknown>[]).map((s) => s.screenId), ["00000002", "00000003"]);
	});

	it("bounds: seven screens after the first, objects only, valid unique ids, names up to 64, exact cycle values", () => {
		const many = Array.from({ length: 10 }, (_, i) => ({ style: "trend", series: [{ key: `k${i}` }], screenId: `0000000${(i + 2).toString(16)}` }));
		const config = stripConfigOf(stored(["junk", null, ...many]));
		assert.equal(screensOf(config).length, MAX_SCREENS);
		assert.deepEqual(config.screens?.map((s) => s.series[0]?.key), ["k0", "k1", "k2", "k3", "k4", "k5", "k6"]);
		const odd = stripConfigOf(stored([{ screenId: "00000001" }, { screenId: "ABCDEF12" }, { screenId: "abc" }, { name: "x".repeat(65) }, { name: "   " }, { name: "Clocks" }]));
		assert.deepEqual(
			odd.screens?.map((s) => s.screenId),
			[undefined, undefined, undefined, undefined, undefined, undefined],
			"a duplicate of panes[0]'s id and malformed ids are dropped"
		);
		assert.deepEqual(screenKeysOf(odd), ["00000001", "@1", "@2", "@3", "@4", "@5", "@6"]);
		assert.deepEqual(odd.screens?.map((s) => s.name), [undefined, undefined, undefined, undefined, undefined, "Clocks"]);
		for (const [value, kept] of [[10, 10], [30, 30], [60, 60], [300, 300], [15, undefined], ["30", undefined], [0, undefined], [5, undefined]] as const) {
			assert.equal(stripConfigOf(stored([], { screenCycle: value })).screenCycle, kept, `screenCycle ${String(value)}`);
		}
		assert.equal(screenCountOf(stripConfigOf(stored([{}], { layout: "split" }))), 1, "split draws one screen and keeps the rest");
		assert.equal(stripConfigOf(stored([{}], { layout: "split" })).screens?.length, 1);
	});

	it("an id-less screen keeps its own stored fields when a junk entry sits before it", () => {
		const config = stripConfigOf(stored([7, { style: "heat", series: [{ key: "h" }], future: "mine" }]));
		const out = json(config).screens as Record<string, unknown>[];
		assert.equal(out[0]?.future, "mine");
	});
});

describe("screens: edits", () => {
	const three = (): EditBase =>
		baseOf(
			stored([
				{ style: "heat", series: [{ key: "b" }], screenId: "00000002", future: "two" },
				{ style: "meters", series: [{ key: "c" }], screenId: "00000003", future: "three" }
			])
		);

	it("screens.<n>.<field> takes the panes.0 appliers; a screen that is not there is refused", () => {
		const r = applyStripEdit(three(), 3, [set("screens.0.style", "area"), set("screens.1.overlays.minmax", true), set("screens.1.scale.max", "100"), set("screens.0.series", [{ key: "b" }, { key: "d" }])]);
		assert.ok(r.ok);
		assert.equal(r.copy.config.screens?.[0]?.style, "area");
		assert.equal(r.copy.config.screens?.[1]?.overlays.minmax, true);
		assert.deepEqual(r.copy.config.screens?.[1]?.scale, { max: 100 });
		assert.equal(r.copy.config.panes[0].style, "trend", "panes[0] untouched");
		for (const path of ["screens.2.style", "screens.7.style", "screens.x.style", "screens.-1.style", "screens.0", "screens.0.screenId"]) {
			const refused = applyStripEdit(three(), 3, [set(path, "area")]);
			assert.ok(!refused.ok && refused.reason === "invalid", path);
		}
	});

	it("names: set and trimmed on panes.0 and every screen, empty clears, too long or on panes.1 refused", () => {
		const r = applyStripEdit(three(), 3, [set("panes.0.name", "  CPU  "), set("screens.1.name", "Clocks")]);
		assert.ok(r.ok);
		assert.equal(r.copy.config.panes[0].name, "CPU");
		assert.equal(r.copy.config.screens?.[1]?.name, "Clocks");
		const cleared = applyStripEdit({ id: ID, rev: 4, config: r.copy.config }, 4, [set("panes.0.name", "")]);
		assert.ok(cleared.ok && cleared.copy.config.panes[0].name === undefined);
		for (const bad of [set("panes.0.name", "x".repeat(65)), set("panes.1.name", "x"), set("panes.0.name", 3)]) assert.equal(applyStripEdit(three(), 3, [bad]).ok, false, bad.path);
	});

	it("origin (what made a screen, Build screens for this PC): set on panes.0 and every screen, kept through a save, empty clears, a copy drops it, anything else refused", () => {
		const r = applyStripEdit(three(), 3, [set("panes.0.origin", "cpu"), set("screens.1.origin", "temps")]);
		assert.ok(r.ok);
		assert.equal(r.copy.config.panes[0].origin, "cpu");
		assert.equal(r.copy.config.screens?.[1]?.origin, "temps");
		const saved = json(r.copy.config) as { panes: Record<string, unknown>[]; screens: Record<string, unknown>[] };
		assert.deepEqual([saved.panes[0]?.origin, saved.screens[1]?.origin], ["cpu", "temps"], "written as stored");
		assert.equal(stripConfigOf(saved).screens?.[1]?.origin, "temps", "and read back");
		const cleared = applyStripEdit({ id: ID, rev: 4, config: r.copy.config }, 4, [set("panes.0.origin", "")]);
		assert.ok(cleared.ok && cleared.copy.config.panes[0].origin === undefined);
		const copied = applyStripEdit({ id: ID, rev: 4, config: r.copy.config }, 4, [{ op: "addScreen", at: 1, from: "copy" }], { mintScreenId: ids("0000000a") });
		assert.ok(copied.ok && copied.copy.config.screens?.[0]?.style === "trend" && copied.copy.config.screens?.[0]?.origin === undefined, "a copy is not what Build made");
		for (const bad of [set("panes.0.origin", "CPU"), set("panes.0.origin", "x".repeat(33)), set("panes.1.origin", "cpu"), set("panes.0.origin", 3), set("screens.0.origin", "a b")]) assert.equal(applyStripEdit(three(), 3, [bad]).ok, false, JSON.stringify(bad));
		assert.equal(stripConfigOf(stored([{ style: "heat", series: [], origin: "Not An Id" }])).screens?.[0]?.origin, undefined, "a stored origin out of form is not read");
	});

	it("screenCycle: exact seconds set; 0 or null clears; anything else refused", () => {
		for (const v of [10, 30, 60, 300]) {
			const r = applyStripEdit(three(), 3, [set("screenCycle", v)]);
			assert.ok(r.ok && r.copy.config.screenCycle === v);
		}
		const on = applyStripEdit(three(), 3, [set("screenCycle", 60)]);
		assert.ok(on.ok);
		for (const v of [0, null]) {
			const off = applyStripEdit({ id: ID, rev: 4, config: on.copy.config }, 4, [set("screenCycle", v)]);
			assert.ok(off.ok && off.copy.config.screenCycle === undefined);
		}
		for (const v of [15, "30", 5, -10, true]) assert.equal(applyStripEdit(three(), 3, [set("screenCycle", v)]).ok, false, String(v));
	});

	it("addScreen: a Group screen of a filter rule with no filter, at its place, every screen given an id", () => {
		const one = baseOf({ layout: "whole", encoders: 6, panes: [{ style: "trend", series: [{ key: "a" }] }, {}] });
		const r = applyStripEdit(one, 3, [{ op: "addScreen", at: 1 }, set("screens.0.group", { from: "filter", filter: "*clock*", keys: [], view: "auto" })], { mintScreenId: ids("0000000a", "0000000b") });
		assert.ok(r.ok, JSON.stringify(r));
		assert.deepEqual(screenKeysOf(r.copy.config), ["0000000a", "0000000b"], "panes[0] gets an id too");
		const added = r.copy.config.screens?.[0];
		assert.equal(added?.style, "group");
		assert.deepEqual(added?.group, { from: "filter", filter: "*clock*", keys: [], view: "auto" });
		const front = applyStripEdit(one, 3, [{ op: "addScreen", at: 0 }], { mintScreenId: ids("0000000c", "0000000d") });
		assert.ok(front.ok && front.copy.config.panes[0].style === "group" && front.copy.config.screens?.[0]?.series[0]?.key === "a", "at 0 the new screen is panes[0]");
	});

	it("addScreen copy: the screen before it with its stored fields, a new id and no name", () => {
		const named = applyStripEdit(three(), 3, [set("screens.0.name", "Heat")]);
		assert.ok(named.ok);
		const r = applyStripEdit({ id: ID, rev: 4, config: named.copy.config }, 4, [{ op: "addScreen", at: 2, from: "copy" }], { mintScreenId: ids("0000000e") });
		assert.ok(r.ok);
		const screens = json(r.copy.config).screens as Record<string, unknown>[];
		assert.equal(screens[1]?.style, "heat");
		assert.equal(screens[1]?.future, "two", "the copied screen's unknown fields come along");
		assert.equal(screens[1]?.name, undefined);
		assert.equal(screens[1]?.screenId, "0000000e");
	});

	it("addScreen: at most eight screens; a place past the end or a bad source is refused", () => {
		let config = three().config;
		let rev = 3;
		for (let n = 3; n < MAX_SCREENS; n++) {
			const r = applyStripEdit({ id: ID, rev, config }, rev, [{ op: "addScreen", at: n }]);
			assert.ok(r.ok, `screen ${n + 1}`);
			config = r.copy.config;
			rev++;
		}
		assert.equal(screensOf(config).length, MAX_SCREENS);
		const ninth = applyStripEdit({ id: ID, rev, config }, rev, [{ op: "addScreen", at: 1 }]);
		assert.ok(!ninth.ok && ninth.reason === "invalid");
		for (const op of [{ op: "addScreen", at: 4 }, { op: "addScreen", at: 1, from: "list" }, { op: "addScreen", at: -1 }, { op: "addScreen", at: 1.5 }, { op: "addScreen" }]) assert.equal(applyStripEdit(three(), 3, [op]).ok, false, JSON.stringify(op));
	});

	it("removeScreen: never the last one; removing the first promotes the next with its id and its fields", () => {
		const r = applyStripEdit(three(), 3, [{ op: "removeScreen", at: 0 }]);
		assert.ok(r.ok);
		assert.deepEqual(screenKeysOf(r.copy.config), ["00000002", "00000003"]);
		assert.equal((json(r.copy.config).panes as Record<string, unknown>[])[0]?.future, "two", "the promoted screen's unknown field follows its id");
		const down = applyStripEdit({ id: ID, rev: 4, config: r.copy.config }, 4, [{ op: "removeScreen", at: 1 }]);
		assert.ok(down.ok);
		assert.equal(down.copy.config.screens, undefined, "one screen left: no screens list");
		assert.equal("screens" in json(down.copy.config), false);
		const last = applyStripEdit({ id: ID, rev: 5, config: down.copy.config }, 5, [{ op: "removeScreen", at: 0 }]);
		assert.ok(!last.ok && last.reason === "invalid");
		assert.equal(applyStripEdit(three(), 3, [{ op: "removeScreen", at: 3 }]).ok, false);
	});

	it("moveScreen: unknown fields follow each id; moving the first promotes the next", () => {
		const r = applyStripEdit(three(), 3, [{ op: "moveScreen", from: 0, to: 2 }]);
		assert.ok(r.ok);
		assert.deepEqual(screenKeysOf(r.copy.config), ["00000002", "00000003", "00000001"]);
		const out = json(r.copy.config);
		assert.equal((out.panes as Record<string, unknown>[])[0]?.future, "two");
		assert.deepEqual((out.screens as Record<string, unknown>[]).map((s) => s.future), ["three", undefined]);
		const back = applyStripEdit({ id: ID, rev: 4, config: r.copy.config }, 4, [{ op: "moveScreen", from: 2, to: 0 }]);
		assert.ok(back.ok);
		assert.deepEqual(json(back.copy.config), json(three().config), "moved back: the same stored copy");
		assert.equal(applyStripEdit(three(), 3, [{ op: "moveScreen", from: 0, to: 3 }]).ok, false);
		assert.equal(applyStripEdit(three(), 3, [{ op: "moveScreen", from: "0", to: 1 }]).ok, false);
	});

	it("an applied edit names where each screen went, by its key before and after; a screen keyed by its place takes its new id", () => {
		const moved = applyStripEdit(three(), 3, [{ op: "moveScreen", from: 0, to: 2 }, { op: "removeScreen", at: 0 }]);
		assert.ok(moved.ok);
		assert.deepEqual(Object.fromEntries(moved.screenKeys), { "00000003": "00000003", "00000001": "00000001" }, "the removed screen is not named");
		// Stored with no ids: each screen keyed by its place.
		const bare = baseOf(stored([{ style: "heat", series: [{ key: "b" }] }, { style: "meters", series: [{ key: "c" }] }]));
		const bareConfig = stripConfigToJson(bare.config) as { panes: Record<string, unknown>[] };
		delete bareConfig.panes[0]?.screenId;
		const placed: EditBase = { id: ID, rev: 3, config: stripConfigOf(bareConfig) };
		assert.deepEqual(screenKeysOf(placed.config), ["@0", "@1", "@2"]);
		const r = applyStripEdit(placed, 3, [{ op: "moveScreen", from: 2, to: 1 }], { mintScreenId: ids("0000000a", "0000000b", "0000000c") });
		assert.ok(r.ok);
		assert.deepEqual(screenKeysOf(r.copy.config), ["0000000a", "0000000b", "0000000c"]);
		assert.deepEqual(Object.fromEntries(r.screenKeys), { "@0": "0000000a", "@2": "0000000b", "@1": "0000000c" });
		const added = applyStripEdit(placed, 3, [{ op: "addScreen", at: 1, from: "copy" }], { mintScreenId: ids("0000000a", "0000000b", "0000000c", "0000000d") });
		assert.ok(added.ok);
		assert.deepEqual(Object.fromEntries(added.screenKeys), { "@0": "0000000a", "@1": "0000000c", "@2": "0000000d" }, "the new screen is not named");
	});

	it("every screen is checked: its bands name its readings, its range is a range; one bad op refuses the patch", () => {
		const band = applyStripEdit(three(), 3, [set("screens.1.bands", [{ key: "b", crit: 80 }])]);
		assert.ok(!band.ok && band.reason === "invalid" && /screens\.1\.bands/.test(band.detail ?? ""), JSON.stringify(band));
		const ranged = applyStripEdit(three(), 3, [set("screens.0.scale.min", 90), set("screens.0.scale.max", 10)]);
		assert.ok(!ranged.ok && /screens\.0\.scale/.test(ranged.detail ?? ""));
		const before = JSON.stringify(json(three().config));
		const mixed = applyStripEdit(three(), 3, [{ op: "addScreen", at: 1 }, set("screens.5.style", "heat")]);
		assert.ok(!mixed.ok);
		assert.equal(JSON.stringify(json(three().config)), before);
		const bound = applyStripEdit(three(), 3, Array.from({ length: MAX_EDIT_OPS + 1 }, () => ({ op: "moveScreen", from: 0, to: 1 })));
		assert.ok(!bound.ok && bound.reason === "invalid");
	});

	it("ids are made unique when a pasted copy repeats one", () => {
		const raw = stored([{ style: "heat", series: [{ key: "b" }], screenId: "00000002" }, { style: "heat", series: [{ key: "c" }], screenId: "00000002" }]);
		const r = applyStripEdit(baseOf(raw), 3, [set("window", "1m")], { mintScreenId: ids("00000009") });
		assert.ok(r.ok);
		assert.deepEqual(screenKeysOf(r.copy.config), ["00000001", "00000002", "00000009"]);
	});
});

describe("screens: the effective config and the steps", () => {
	const config = stripConfigOf(stored([{ style: "meters", series: [{ key: "b" }], screenId: "00000002" }, { style: "heat", series: [{ key: "c" }], screenId: "00000003" }]));

	it("the screen on view takes panes[0]; the first, an unknown key, or a split draw the stored copy", () => {
		const view = { ...freshView(), screen: "00000003" };
		const effective = effectiveConfig(config, view);
		assert.equal(effective.panes[0].style, "heat");
		assert.equal(effective.panes[0].series[0]?.key, "c");
		assert.equal(screenIndexOf(config, view), 2);
		assert.equal(effectiveConfig(config, { ...freshView(), screen: "00000001" }), config);
		assert.equal(effectiveConfig(config, { ...freshView(), screen: "0000dead" }), config);
		assert.equal(effectiveConfig(config, freshView()), config);
		const split = stripConfigOf({ ...stored([{ style: "meters", series: [], screenId: "00000002" }]), layout: "split" });
		assert.equal(effectiveConfig(split, { ...freshView(), screen: "00000002" }).panes[0].style, "trend");
		assert.equal(effectiveConfig(config, { ...view, shared: "15m" }).window, "15m", "the turned window applies to the screen on view");
	});

	it("a turn clamps at the ends; Control and the cycle wrap", () => {
		assert.equal(screenStep(0, 3, 1, false), 1);
		assert.equal(screenStep(2, 3, 1, false), 2);
		assert.equal(screenStep(1, 3, -9, false), 0);
		assert.equal(screenStep(2, 3, 1, true), 0);
		assert.equal(screenStep(0, 3, -1, true), 2);
		assert.equal(screenStep(0, 1, 1, true), 0);
	});

	it("the wipe sweeps from the Screens dial: next right to left, previous left to right, present slices only", () => {
		assert.deepEqual(wipeOrder([0, 1, 2, 3, 4, 5], 1), [5, 4, 3, 2, 1, 0]);
		assert.deepEqual(wipeOrder([3, 0, 2], -1), [0, 2, 3]);
	});

	it("automatic names: the filter as typed, the folder, every unit, the first reading and +N", () => {
		const snapshot: SensorSnapshot = {
			pollTime: 1,
			version: 1,
			revision: 1,
			sensors: [{ index: 0, id: 1, instance: 0, name: "CPU [#0]: Test" }],
			readings: [
				{ key: "r1", type: SensorType.Temperature, sensorIndex: 0, id: 1, label: "CPU Package", unit: "°C", value: 60, valueMin: 60, valueMax: 60, valueAvg: 60 },
				{ key: "r2", type: SensorType.Temperature, sensorIndex: 0, id: 2, label: "Core 0", unit: "°C", value: 60, valueMin: 60, valueMax: 60, valueAvg: 60 }
			],
			byKey: new Map()
		};
		const byKey = new Map(snapshot.readings.map((r) => [r.key, r]));
		const snap = { ...snapshot, byKey };
		const pane = (raw: Record<string, unknown>) => stripConfigOf({ panes: [raw] }).panes[0];
		assert.equal(autoScreenName(pane({ style: "group", group: { from: "filter", filter: "*core*|*ccd*", keys: [], view: "auto" } }), snap), "*core*|*ccd*");
		assert.equal(autoScreenName(pane({ style: "group", series: [{ key: "r1" }], group: { from: "folder", keys: [], view: "auto" } }), snap), "CPU [#0]: Test");
		assert.equal(autoScreenName(pane({ style: "group", group: { from: "unit", unit: "°C", keys: [], view: "auto" } }), snap), "Every °C");
		assert.equal(autoScreenName(pane({ style: "ambient" }), snap), "Every °C", "Ambient with no rule takes every temperature");
		assert.equal(autoScreenName(pane({ style: "trend", series: [{ key: "r1" }, { key: "r2" }] }), snap), "CPU Package +1");
		assert.equal(autoScreenName(pane({ style: "trend", series: [{ key: "r1", name: "Package" }] }), snap), "Package");
		assert.equal(autoScreenName(pane({ style: "trend", series: [] }), snap), "");
		// A reading HWiNFO does not list, never seen: no name, never its saved
		// key, and no count alone (the panel names it the same way).
		assert.equal(autoScreenName(pane({ style: "trend", series: [{ key: "f0099999:0:1" }, { key: "r1" }] }), snap), "");
		assert.equal(autoScreenName(pane({ style: "trend", series: [{ key: "f0099999:0:1" }] }), snap, (key) => (key === "f0099999:0:1" ? "Seen before" : undefined)), "Seen before", "a name seen before stays");
		assert.equal(autoScreenName(pane({ style: "group", group: { from: "list", keys: ["f0099999:0:1", "r1"], view: "auto" } }), snap), "");
		assert.deepEqual(screenLabelOf(pane({ style: "trend", series: [{ key: "f0099999:0:1" }, { key: "r2" }] }), 1, 2, snap), { name: "", place: "2 of 2" }, "the strip says the place alone");
	});

	it("a unit rule names the unit the strip shows: °F and Δ°F with °F ticked, any other unit as it is", () => {
		const snap = { pollTime: 1, version: 1, revision: 1, sensors: [], readings: [], byKey: new Map() } as SensorSnapshot;
		const pane = (raw: Record<string, unknown>) => stripConfigOf({ panes: [raw] }).panes[0];
		const unit = (u: string) => pane({ style: "group", group: { from: "unit", unit: u, keys: [], view: "auto" } });
		const f = { fahrenheit: true };
		assert.equal(autoScreenName(unit("°C"), snap, undefined, f), "Every °F");
		assert.equal(autoScreenName(unit("Δ°C"), snap, undefined, f), "Every Δ°F");
		assert.equal(autoScreenName(unit("%"), snap, undefined, f), "Every %");
		assert.equal(autoScreenName(pane({ style: "ambient" }), snap, undefined, f), "Every °F", "Ambient's default rule too");
		assert.equal(autoScreenName(unit("°C"), snap, undefined, { fahrenheit: false }), "Every °C");
		assert.deepEqual(screenLabelOf(unit("°C"), 0, 2, snap, undefined, f), { name: "Every °F", place: "1 of 2" }, "the window words say it the same way");
	});

	it("an automatic name keeps its +N however much it shortens", () => {
		const snap = { pollTime: 1, version: 1, revision: 1, sensors: [], readings: [], byKey: new Map() } as SensorSnapshot;
		const pane = stripConfigOf({ panes: [{ style: "meters", series: ["a", "b", "c", "d"].map((key, i) => ({ key, name: `Core ${i >> 1} T${i & 1} Effective Clock` })) }] }).panes[0];
		assert.deepEqual(screenLabelOf(pane, 2, 3, snap), { name: "Core 0 T0 Effective Clock", more: 3, place: "3 of 3" });
		assert.equal(autoScreenName(pane, snap), "Core 0 T0 Effective Clock +3");
		const named = stripConfigOf({ panes: [{ style: "meters", name: "Clocks", series: [{ key: "a" }, { key: "b" }] }] }).panes[0];
		assert.deepEqual(screenLabelOf(named, 0, 3, snap), { name: "Clocks", place: "1 of 3" }, "a typed name has no count");
	});

	it("a typed name shortens by whole words and never ends on a joining word", () => {
		assert.deepEqual(phraseRungs("CPU and GPU temperatures (live)"), ["CPU and GPU temperatures (live)", "CPU and GPU temperatures", "CPU and GPU", "CPU"]);
		assert.deepEqual(phraseRungs("CPU Package Temperature"), ["CPU Package Temperature", "CPU Pkg Temp", "CPU Pkg", "CPU"]);
		assert.deepEqual(phraseRungs("Fans & pumps"), ["Fans & pumps", "Fans"]);
	});
});

describe("names that share their last words", () => {
	const cores = ["Core 0 T0 Effective Clock", "Core 0 T1 Effective Clock", "Core 1 T0 Effective Clock", "Core 1 T1 Effective Clock"];

	it("drop the words every reading shares at the end before a leading word, and a leading word only when shared", () => {
		assert.deepEqual(nameRungs("Core 1 T1 Effective Clock", cores).slice(0, 4), ["Core 1 T1 Effective Clock", "Core 1 T1 Eff Clock", "Core 1 T1", "1 T1"]);
		for (const name of cores) assert.equal(fitNameRung(tidyRungs(nameRungs(name, cores)), 12, 64), name.replace(" Effective Clock", ""), name);
	});

	it("leave a set with no shared ending as lane7 left it", () => {
		const mixed = ["CPU Package Temperature", "GPU Temperature", "GPU Hot Spot"];
		assert.deepEqual(
			mixed.map((n) => nameRungs(n, mixed)),
			[
				["CPU Package Temperature", "CPU Pkg Temp", "CPU Pkg", "Pkg Temp", "CPU"],
				["GPU Temperature", "GPU Temp", "GPU"],
				["GPU Hot Spot", "Hot Spot", "GPU"]
			]
		);
		const gpu = ["GPU Temperature", "GPU Hot Spot"];
		assert.deepEqual(
			gpu.map((n) => nameRungs(n, gpu)),
			[
				["GPU Temperature", "GPU Temp", "Temp"],
				["GPU Hot Spot", "Hot Spot", "Hot"]
			]
		);
	});

	it("Meters names each meter by what tells it apart, also while the screen's name and +N are shown", () => {
		const c = fixtureCase({ styles: ["meters"], layout: "whole", encoders: 6, background: "theme", accent: false, extras: [{ series: ["cpu", "gpu", "hot", "load"] }] });
		const input = { ...c.input, panes: c.input.panes.map((p) => ({ ...p, series: p.series.map((s, i) => ({ ...s, name: cores[i] ?? s.name })) })) };
		const texts = (scene: StripSceneInput): string[] => sliceStrip(scene).scene.prims.flatMap((p) => (p.k === "text" ? [p.text] : []));
		const rest = texts(input);
		assert.ok(rest.includes("Core 1 T1") && rest.includes("range 5 min"), JSON.stringify(rest));
		const shown = withScreens({ id: "meters", input }, { count: 3, at: 2, name: "x" }).input;
		const labelled = { ...shown, panes: shown.panes.map((p) => ({ ...p, screenLabel: { name: "Core 0 T0 Effective Clock", more: 3, place: "3 of 3" } })) };
		const said = texts(labelled);
		assert.ok(said.includes("Core 0 T0 Eff Clock +3 · 3 of 3"), JSON.stringify(said));
		assert.ok(said.includes("Core 1 T1"), "the meter keeps its name beside the screen's");
		assert.equal(said.some((t) => /Eff$|Eff Clock$/.test(t) && !t.startsWith("Core")), false);
	});
});

describe("screens: the Screens dial", () => {
	const routing = (encoders: 4 | 6, screensColumn: number | undefined, style: "trend" | "group" = "trend"): StripRouting => ({
		layout: "whole",
		encoders,
		sharedWindow: true,
		bucketPx: 2,
		panes: [{ style, seriesCount: 2, mode: "live", ...(style === "group" ? { group: { count: 8, draw: "lines" as const, current: true } } : {}) }],
		...(screensColumn === undefined ? {} : { screens: { column: screensColumn } })
	});
	const turn = (r: StripRouting, column: number, pressed = false) => routeStripInput(r, pressed ? { downAt: 0, rotatedWhileDown: false } : IDLE_GESTURE, { kind: "dialRotate", column, at: 10, ticks: 1, pressed }).action;

	it("is the last dial of the strip, else the rightmost present member", () => {
		assert.equal(screensColumnOf([0, 1, 2, 3]), 3);
		assert.equal(screensColumnOf([0, 1, 2, 3, 4, 5]), 5);
		assert.equal(screensColumnOf([0, 1, 2, 3, 4]), 4, "+ XL with the last dial missing");
		assert.equal(screensColumnOf([2, 0, 1]), 2, "+ with the last dial missing");
		assert.equal(screensColumnOf([]), undefined);
	});

	for (const [deck, encoders, column] of [["+", 4, 3], ["+ XL", 6, 5], ["+ XL, last dial missing", 6, 4]] as const) {
		it(`${deck}: its plain turn moves screens; its pressed turn and every other dial stay the screen's own`, () => {
			const r = routing(encoders, column);
			assert.deepEqual(turn(r, column), { kind: "screen", pane: 0, step: 1 });
			assert.deepEqual(turn(r, column, true), { kind: "series", pane: 0, step: 1 }, "pressed turn: the series highlight");
			assert.equal(turn(r, 0)?.kind, "window");
			assert.equal(turn(r, column - 1)?.kind, "window");
			const group = routing(encoders, column, "group");
			assert.deepEqual(turn(group, column), { kind: "screen", pane: 0, step: 1 });
			assert.equal(turn(group, 0)?.kind, "groupStep");
			assert.equal(turn(group, column, true)?.kind, "window", "Group's pressed turn: the window");
		});
	}

	it("one screen: nothing changes", () => {
		assert.equal(turn(routing(6, undefined), 5)?.kind, "window");
	});

	it("its hints: Screen plus the pane's pressed turn", () => {
		const trend = stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "live", seriesChoice: true, style: "trend" });
		assert.deepEqual(screensTriggerDescriptions(trend), { ...trend, rotate: "Screen · pressed: series" });
		const plain = stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "live", seriesChoice: false, style: "trend" });
		assert.equal(screensTriggerDescriptions(plain).rotate, "Screen");
		const group = stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "live", seriesChoice: true, group: true, style: "group" });
		assert.equal(screensTriggerDescriptions(group).rotate, "Screen · pressed: window");
		const paused = stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "paused", seriesChoice: true, style: "trend" });
		assert.equal(screensTriggerDescriptions(paused).rotate, "Screen · pressed: series");
		assert.equal(screensTriggerDescriptions(paused).push, "Back to live");
	});
});

describe("screens: the payload bound", () => {
	it("every slice of every style and look stays inside the bound with the line, a dashed segment and the name", () => {
		const over: string[] = [];
		let named = 0;
		for (const c of screensMatrix()) {
			const art = isArtLook(c.input.config.background);
			const limit = SLICE_PAYLOAD_LIMIT - (art ? ART_PIECE_LIMIT : 0);
			const r = sliceStrip(c.input);
			for (const [i, s] of r.slices.entries()) if (s !== null && svgBytes(s) > limit) over.push(`${c.id} slice ${i}: ${svgBytes(s)} > ${limit}`);
			if (r.scene.prims.some((p) => p.k === "text" && p.text.includes("2 of 8"))) named++;
			assert.ok(
				r.scene.prims.some((p) => p.k === "rect" && p.y === 0 && p.h === 3),
				`${c.id}: the position line`
			);
		}
		assert.deepEqual(over, []);
		assert.equal(named, screensMatrix().length, "the name and place drew in every scene");
	});

	it("a strip with one screen draws no line", () => {
		const [c] = screensMatrix();
		assert.ok(c !== undefined);
		const { screens: _s, ...plain } = c.input;
		void _s;
		assert.equal(sliceStrip(plain).scene.prims.some((p) => p.k === "rect" && p.y === 0 && p.h === 3), false);
	});
});

describe("screens: the critical mark reads limits as the scene draws them", () => {
	// A band or Group limit stamped with the unit it was typed in
	// (displayUnit) means that unit's number, converted after a °F switch
	// and after HWiNFO switched its own °F, as stripBandsFor draws it; an
	// unstamped one stays in the unit on view. A hidden screen's mark agrees
	// with the band it shows once on view.
	const KEY = "f0:0:100";
	const status = (value: number, unit = "°C"): PollerStatus => ({ state: "ok", source: "shared-memory", snapshot: snap([{ sensor: "CPU", label: "CPU Package", unit, value, type: SensorType.Temperature }]) });
	const trend = (band: Record<string, unknown>): StripPaneV1 => stripPaneOf({ style: "trend", series: [{ key: KEY }], bands: [{ key: KEY, below: false, ...band }] });
	const group = (limits: Record<string, unknown>): StripPaneV1 => stripPaneOf({ style: "group", series: [], group: { from: "unit", unit: "°C", keys: [], view: "rows", limits: { below: false, ...limits } } });
	const typedC = { crit: 90, unit: "°C", displayUnit: "°C", displayUnitFor: { crit: "90" } };
	const typedF = { crit: 194, unit: "°C", displayUnit: "°F", displayUnitFor: { crit: "194" } };

	it("a band typed as 90 under °C marks at 90 °C with the strip in °F, not at 90 °F", () => {
		assert.equal(screenCritical(trend(typedC), status(45), true), false, "45 °C is under 194 °F");
		assert.equal(screenCritical(trend(typedC), status(95), true), true);
		assert.equal(screenCritical(trend(typedC), status(45), false), false);
		assert.equal(screenCritical(trend(typedC), status(95), false), true);
	});

	it("a band typed as 194 under °F marks at 90 °C with the strip back in °C", () => {
		assert.equal(screenCritical(trend(typedF), status(95), false), true, "95 °C is past 194 °F");
		assert.equal(screenCritical(trend(typedF), status(85), false), false);
		assert.equal(screenCritical(trend(typedF), status(95), true), true);
	});

	it("a band typed under °C still marks once HWiNFO itself reads °F", () => {
		assert.equal(screenCritical(trend(typedC), status(200, "°F"), false), true, "200 °F is past 90 °C");
		assert.equal(screenCritical(trend(typedC), status(180, "°F"), false), false);
	});

	it("Group limits typed under °C mark at 90 °C with the strip in °F", () => {
		assert.equal(screenCritical(group(typedC), status(45), true, [KEY]), false);
		assert.equal(screenCritical(group(typedC), status(95), true, [KEY]), true);
	});

	it("an unstamped band keeps its number in the unit on view, as before the stamp", () => {
		const plain = { crit: 90, unit: "°C" };
		assert.equal(screenCritical(trend(plain), status(45), true), true, "90 °F is 32.2 °C");
		assert.equal(screenCritical(trend(plain), status(45), false), false);
		assert.equal(screenCritical(trend(plain), status(200, "°F"), false), false, "typed for a °C reading: not applied to a °F one");
	});
});
