/**
 * The starts an Equal split offers (ui/pi-strip-model.js), on the owner's
 * pick of 2026-11-06 (variant C): each pair only where this PC's sensors
 * fill both halves, in order, the first that fits the default. Read from the
 * same bytes the panel loads, over sensor lists in the panel's sensorTree
 * shape, made by the plugin's own tree builder: the panel fixture's PC, one
 * with no GPU, a CPU alone and one with many fans.
 *
 * What a pair writes is held to the plugin's edit protocol: one edit that
 * lands both halves, on a new strip and over a running split, with every
 * screen of the Whole strip after the first, every id and every field Fill
 * does not write kept (panes[0] is also the Whole strip's first screen).
 * What Fill would replace in each half is either harmless (empty, the
 * reading the strip was made with, which the stored strip keeps until a
 * person changes that half's readings, or a pair's own half and nothing
 * more) or protected, and Use asks first only over a protected one.
 *
 * The panel's use of them (the dropdown, Fill both halves, the remembered
 * pick) runs on the simulated host: scripts/e2e-pi-strip.mjs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupSnapshot, keyOf, sampleSnapshot } from "../scripts/lib/pi-fixtures.mjs";
import { buildSensorTree } from "../src/pi-protocol.ts";
import { applyStripEdit, MAX_EDIT_OPS } from "../src/strip/edits.ts";
import { DECIMALS, exactReadingFormats, MAX_READING_FORMATS, newStripConfig, stripConfigOf, stripConfigToJson, stripSeedOf } from "../src/strip/settings.ts";
import { FIXED_DATA_UNITS } from "../src/ui/measure.ts";
import { loadPanelModels } from "./panel-models.ts";

// The strip model, and the Sensor Dial panel's own per-reading formats
// (ui/pi-model.js), from the bytes the panel loads.
const { hwStripModel: m, hwModel: panelModel } = loadPanelModels();

const groupsOf = (snapshot) => buildSensorTree({ state: "ok", snapshot, source: "shared-memory" }).groups;
const T = { temp: 1, fan: 3, power: 5, clock: 6, usage: 7 };
const hex = (n) => n.toString(16).padStart(8, "0");
/** A snapshot of named sensors, each [label, unit, value, type]. */
function make(sources) {
	const sensors = [];
	const readings = [];
	sources.forEach(([name, rows], index) => {
		const id = 0xf0000000 + index;
		sensors.push({ index, id, instance: 0, name });
		rows.forEach(([label, unit, value, type], i) => readings.push({ key: `${hex(id)}:0:${(0x1000000 + i).toString(16)}`, type, sensorIndex: index, id: 0x1000000 + i, label, unit, value, valueMin: value - 1, valueMax: value + 1, valueAvg: value }));
	});
	return { pollTime: 1_000_000, version: 1, revision: 1, sensors, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}
const CPU_ROWS = [
	["Total CPU Usage", "%", 12, T.usage],
	["CPU Package", "°C", 55, T.temp],
	["CPU Package Power", "W", 20, T.power]
];
const fixture = sampleSnapshot();
const key = (sensor, label) => keyOf(fixture, sensor, label);
const CPU = key(0, "CPU (Tctl/Tdie)");
const CPU_USAGE = key(0, "Total CPU Usage");
const CPU_POWER = key(0, "CPU Package Power");
const GPU = key(1, "GPU Temperature");
const GPU_LOAD = key(1, "GPU Core Load");
const halves = (start) => start.panes.map((h) => [h.style, h.readout ?? "off", h.series, h.group]);
const RPM_NOW = { from: "unit", unit: "RPM", keys: [], view: "now" };

describe("the pairs an Equal split offers, per sensor list", () => {
	it("the panel fixture's PC (+ XL): CPU and GPU, Temperature and load, CPU and cooling, in that order", () => {
		const starts = m.proposeSplits(groupsOf(fixture), { slots: 6 });
		assert.deepEqual(
			starts.map((s) => [s.id, s.name]),
			[
				["cpu-gpu", "CPU and GPU"],
				["temp-load", "Temperature and load"],
				["cpu-cooling", "CPU and cooling"]
			]
		);
		const [cpuGpu, tempLoad, cooling] = starts;
		assert.deepEqual(
			halves(cpuGpu),
			[
				["area", "left", [CPU], null],
				["area", "left", [GPU], null]
			],
			"each temperature large beside its own graph"
		);
		assert.deepEqual(
			halves(tempLoad),
			[
				["compare", "off", [CPU, GPU], null],
				["compare", "off", [CPU_USAGE, GPU_LOAD], null]
			],
			"the two temperatures, then the two loads, each a Compare in one unit"
		);
		assert.deepEqual(halves(cooling)[0], ["lanes", "off", [CPU, CPU_USAGE, CPU_POWER], null], "the CPU's temperature, usage and power in Lanes");
		assert.deepEqual(halves(cooling)[1], ["group", "off", [], RPM_NOW], "four fans outnumber a half's three dials: Group Now");
		assert.equal(cooling.panes[1].count, 4);
	});

	it("the same PC on a Stream Deck + (two dials a half): the fans are a Group too", () => {
		const starts = m.proposeSplits(groupsOf(fixture), { slots: 4 });
		assert.deepEqual(starts.map((s) => s.id), ["cpu-gpu", "temp-load", "cpu-cooling"]);
		assert.deepEqual(starts[2].panes[1].group, RPM_NOW);
	});

	it("fans that fit the half's dials are a meter each, the pump first", () => {
		const snapshot = make([
			["CPU [#0]: Example", CPU_ROWS],
			["GPU [#0]: Example Graphics", [["GPU Temperature", "°C", 50, T.temp], ["GPU Core Load", "%", 30, T.usage], ["GPU Fan1", "RPM", 900, T.fan]]],
			["Motherboard: Example", [["CPU Fan", "RPM", 1100, T.fan], ["AIO Pump", "RPM", 2700, T.fan]]]
		]);
		const cooling = m.proposeSplits(groupsOf(snapshot), { slots: 6 }).find((s) => s.id === "cpu-cooling");
		assert.equal(cooling.panes[1].style, "meters");
		assert.deepEqual(cooling.panes[1].labels, ["AIO Pump", "CPU Fan", "GPU Fan1"], "the pump, then the CPU and GPU fans");
		const plus = m.proposeSplits(groupsOf(snapshot), { slots: 4 }).find((s) => s.id === "cpu-cooling");
		assert.deepEqual([plus.panes[1].style, plus.panes[1].group], ["group", RPM_NOW], "three fans outnumber two dials");
	});

	it("many fans: one Group Now of every reading in RPM", () => {
		const snapshot = make([
			["CPU [#0]: Example", CPU_ROWS],
			["Fan controller: Example", Array.from({ length: 9 }, (_, i) => [`Fan ${i + 1}`, "RPM", 800 + i * 10, T.fan])]
		]);
		const starts = m.proposeSplits(groupsOf(snapshot), { slots: 6 });
		assert.deepEqual(starts.map((s) => s.id), ["cpu-cooling"], "no GPU: no pair that needs one");
		assert.deepEqual([starts[0].panes[1].style, starts[0].panes[1].group, starts[0].panes[1].count], ["group", RPM_NOW, 9]);
	});

	it("no GPU: only CPU and cooling", () => {
		const noGpu = sampleSnapshot();
		noGpu.readings = noGpu.readings.filter((r) => noGpu.sensors[r.sensorIndex]?.name.startsWith("GPU") !== true);
		noGpu.byKey = new Map(noGpu.readings.map((r) => [r.key, r]));
		const starts = m.proposeSplits(groupsOf(noGpu), { slots: 6 });
		assert.deepEqual(starts.map((s) => s.id), ["cpu-cooling"]);
		assert.deepEqual(starts[0].panes[1].labels, ["AIO Pump", "CPU Fan"], "the board's two fans fit three dials");
	});

	it("a CPU alone, no GPU and no fan: no pair, so the split starts as today", () => {
		assert.deepEqual(m.proposeSplits(groupsOf(make([["CPU [#0]: Example", CPU_ROWS]])), { slots: 6 }), []);
		assert.deepEqual(m.proposeSplits([], { slots: 6 }), []);
		assert.deepEqual(m.proposeSplits(null, { slots: 6 }), []);
	});

	it("one CPU reading draws as Trend in CPU and cooling", () => {
		const snapshot = make([
			["CPU [#0]: Example", [["CPU Package", "°C", 55, T.temp]]],
			["ACPI", [["Fan1", "RPM", 2400, T.fan]]]
		]);
		const starts = m.proposeSplits(groupsOf(snapshot), { slots: 6 });
		assert.deepEqual(halves(starts[0]), [
			["trend", "off", [keyOf(snapshot, 0, "CPU Package")], null],
			["meters", "off", [keyOf(snapshot, 1, "Fan1")], null]
		]);
	});

	it("a GPU's load is a reading that says GPU and load, never its memory, a fan in % or the CPU's usage", () => {
		const snapshot = make([
			["CPU [#0]: Example", [...CPU_ROWS, ["Max CPU/Thread Usage", "%", 40, T.usage]]],
			["GPU [#0]: NVIDIA Example", [["GPU Temperature", "°C", 50, T.temp], ["GPU Memory Usage", "%", 30, T.usage], ["GPU Fan1", "%", 40, T.usage], ["GPU Video Engine Load", "%", 2, T.usage]]]
		]);
		assert.deepEqual(m.proposeSplits(groupsOf(snapshot), { slots: 6 }).map((s) => s.id), ["cpu-gpu"], "no GPU load here: no Temperature and load");
		const intel = make([
			["CPU [#0]: Intel Core Ultra 7", CPU_ROWS],
			["GPU [#0]: Intel Arc Graphics", [["GPU Temperature", "°C", 50, T.temp], ["GPU Memory Usage", "%", 30, T.usage], ["GPU D3D Usage", "%", 10, T.usage]]]
		]);
		const tempLoad = m.proposeSplits(groupsOf(intel), { slots: 6 }).find((s) => s.id === "temp-load");
		assert.deepEqual(tempLoad.panes[1].labels, ["Total CPU Usage", "GPU D3D Usage"]);
	});

	it("two GPUs: the load is the same GPU's as the temperature beside it", () => {
		// HWiNFO's own labels on a laptop that lists its iGPU first.
		const laptop = make([
			["CPU [#0]: AMD Ryzen 9 6900HX", CPU_ROWS],
			["GPU [#0]: AMD Radeon 680M", [["GPU Temperature", "°C", 45, T.temp], ["GPU Utilization", "%", 3, T.usage]]],
			["GPU [#1]: NVIDIA GeForce RTX 3070 Ti Laptop GPU", [["GPU Temperature", "°C", 70, T.temp], ["GPU Core Load", "%", 95, T.usage]]]
		]);
		const tempLoad = m.proposeSplits(groupsOf(laptop), { slots: 6 }).find((s) => s.id === "temp-load");
		assert.deepEqual(tempLoad.panes[0].series, [keyOf(laptop, 0, "CPU Package"), keyOf(laptop, 1, "GPU Temperature")]);
		assert.deepEqual(tempLoad.panes[1].series, [keyOf(laptop, 0, "Total CPU Usage"), keyOf(laptop, 1, "GPU Utilization")], "the Radeon's load beside the Radeon's temperature, not the NVIDIA's");
		// A temperature HWiNFO lists outside any GPU (a laptop's embedded
		// controller): the load comes from where there is one.
		const ec = make([
			["CPU [#0]: Example", CPU_ROWS],
			["Embedded Controller: Example", [["GPU", "°C", 60, T.temp]]],
			["GPU [#0]: NVIDIA Example", [["GPU Core Load", "%", 40, T.usage]]]
		]);
		const ecPair = m.proposeSplits(groupsOf(ec), { slots: 6 }).find((s) => s.id === "temp-load");
		assert.deepEqual(ecPair.panes[1].series, [keyOf(ec, 0, "Total CPU Usage"), keyOf(ec, 2, "GPU Core Load")]);
	});
});

describe("what a pair writes", () => {
	const groups = groupsOf(groupSnapshot({ threads: 16 }));
	const starts = m.proposeSplits(groups, { slots: 6 });
	const seed = stripSeedOf({ readingKey: key(1, "GPU Hot Spot Temperature") });

	it("each pair is one edit the plugin accepts on a new Equal split, and it draws the pair", () => {
		const base = newStripConfig("split", 6, seed);
		for (const start of starts) {
			const ops = m.splitStartOps(start, stripConfigToJson(base));
			assert.ok(Array.isArray(ops) && ops.length > 0 && ops.length <= MAX_EDIT_OPS, `${start.id}: ${ops?.length} operations`);
			const result = applyStripEdit({ id: "draft", rev: 0, config: base }, 0, ops, { deviceEncoders: 6 });
			assert.ok(result.ok, `${start.id}: ${JSON.stringify(result)}`);
			const json = stripConfigToJson(result.copy.config);
			const drawn = json.panes.map((p) => [p.style, p.readout ?? "off", (p.series ?? []).map((s) => s.key), p.group ?? null]);
			assert.deepEqual(drawn, halves(start), start.id);
			assert.equal(json.screens, undefined, `${start.id}: no screen added`);
			assert.equal(m.splitStartIn(json, starts), start.id, `${start.id}: the halves read back as the pair`);
		}
	});

	it("over a running split, both halves start again: the right half's bands and rule go, each half's look stays", () => {
		const running = stripConfigOf({
			layout: "split",
			encoders: 6,
			window: "5m",
			sharedWindow: false,
			panes: [
				{ style: "trend", series: [{ key: CPU }], overlays: { minmax: true }, scale: {}, bands: [], window: "15m" },
				{ style: "group", readout: "only", series: [{ key: GPU }], group: { from: "folder", keys: [], view: "rows" }, overlays: {}, scale: {}, bands: [{ key: GPU, warn: 80, below: false }] }
			]
		});
		const before = stripConfigToJson(running);
		assert.equal(before.panes[1].group?.from, "folder", "the right half keeps a folder rule before");
		assert.equal(before.panes[1].bands?.length, 1, "and a band");
		const ops = m.splitStartOps(starts[0], before);
		const result = applyStripEdit({ id: "g", rev: 7, config: running }, 7, ops, { deviceEncoders: 6 });
		assert.ok(result.ok, JSON.stringify(result));
		const json = stripConfigToJson(result.copy.config);
		assert.equal(m.splitStartIn(json, starts), "cpu-gpu");
		assert.equal(json.panes[1].group, undefined, "the right half's folder rule goes with its Group");
		assert.deepEqual(json.panes[1].bands ?? [], [], "a band names a reading of its own half: it goes with it");
		assert.equal(json.panes[1].readout, "left", "Large values only becomes on the left");
		assert.equal(json.panes[0].overlays?.minmax, true, "Show on the graph stays");
		assert.equal(json.panes[0].window, "15m", "the half's own window stays");
		// Drawing a pair now, the split can take another one.
		const again = m.splitStartOps(starts[1], json);
		assert.ok(Array.isArray(again) && again.length > 0, "a left half that is a pair's takes another pair");
		assert.equal(applyStripEdit({ id: "g", rev: 8, config: result.copy.config }, 8, again, { deviceEncoders: 6 }).ok, true);
	});

});

describe("what Fill both halves would replace, half by half", () => {
	const groups = groupsOf(groupSnapshot({ threads: 16 }));
	const starts = m.proposeSplits(groups, { slots: 6 });
	const HOT = key(1, "GPU Hot Spot Temperature");
	const fresh = stripConfigToJson(newStripConfig("split", 6, stripSeedOf({ readingKey: HOT })));
	const empty = stripConfigToJson(newStripConfig("split", 6, stripSeedOf({})));
	const risk = (config) => m.fillRisk(config, starts);
	/** A stored split after a stripEdit, as the plugin stores it. */
	const edited = (config, patch) => {
		const result = applyStripEdit({ id: "g", rev: 2, config: stripConfigOf(config) }, 2, patch, { deviceEncoders: 6 });
		assert.ok(result.ok, JSON.stringify(result));
		return stripConfigToJson(result.copy.config);
	};
	const withPanes = (config, left, right) => ({ ...config, panes: [left === undefined ? config.panes[0] : { ...config.panes[0], ...left }, right === undefined ? config.panes[1] : { ...config.panes[1], ...right }] });
	/** A half exactly as Fill writes it for `start` at place `i`. */
	const pairHalf = (start, i) => {
		const h = start.panes[i];
		return m.isRuleStyle(h.style) ? { style: h.style, series: [], group: h.group, ...(h.readout === undefined ? {} : { readout: h.readout }) } : { style: h.style, series: h.series.map((k) => ({ key: k })), ...(h.readout === undefined ? {} : { readout: h.readout }) };
	};
	/** A running split that draws `start`, as the plugin stores it. */
	const drawing = (start, base = fresh) => {
		const result = applyStripEdit({ id: "g", rev: 3, config: stripConfigOf(base) }, 3, m.splitStartOps(start, base), { deviceEncoders: 6 });
		assert.ok(result.ok, JSON.stringify(result));
		return stripConfigToJson(result.copy.config);
	};
	const LANES = { style: "lanes", series: [{ key: CPU }, { key: CPU_POWER }] };

	it("fresh defaults: a new split's start, or one from a dial with no reading, is harmless in both halves", () => {
		assert.deepEqual(risk(fresh), ["harmless", "harmless"], "a strip dial's reading in Trend on the left, the right half empty");
		assert.deepEqual(risk(empty), ["harmless", "harmless"], "both halves empty");
	});

	it("one reading in Trend is the untouched start while it is the reading the strip was made with, which the stored strip keeps: the same on every member dial's panel", () => {
		assert.equal(fresh.panes[0].seed, HOT, "a new strip keeps the reading it was made with beside its first pane");
		assert.equal(empty.panes[0].seed, undefined, "a strip made from a dial with no reading keeps none");
		assert.deepEqual(risk(fresh), ["harmless", "harmless"], "the start as made");
		assert.deepEqual(risk(edited(fresh, [{ op: "set", path: "window", value: "15m" }])), ["harmless", "harmless"], "an edit of something else keeps the start");
		// A reading a person picks, even one a dial of the strip shows as its
		// own: the plugin drops the seed with the edit.
		const picked = edited(fresh, [{ op: "set", path: "panes.0.series", value: [{ key: GPU_LOAD }] }]);
		assert.equal(picked.panes[0].seed, undefined, "an edit of the half's readings drops the seed");
		assert.deepEqual(risk(picked), ["protected", "harmless"], "a reading a person picked");
		assert.deepEqual(risk(edited(picked, [{ op: "set", path: "panes.0.series", value: [{ key: HOT }] }])), ["protected", "harmless"], "the start's reading picked again by a person");
		const unrecorded = withPanes(fresh, {});
		delete unrecorded.panes[0].seed;
		assert.deepEqual(risk(unrecorded), ["protected", "harmless"], "a strip that keeps no start: nothing tells its reading from a person's pick");
		assert.deepEqual(risk(withPanes(fresh, { series: [{ key: CPU }] })), ["protected", "harmless"], "a stored reading that is not the one the strip was made with");
		assert.deepEqual(risk(withPanes(fresh, { style: "area" })), ["protected", "harmless"], "the start's reading in another style");
		assert.deepEqual(risk(withPanes(fresh, undefined, { series: [{ key: HOT }], seed: HOT })), ["harmless", "protected"], "the right half never starts with a reading");
	});

	it("a custom left half, a custom right half and both are protected; the other half stays harmless", () => {
		assert.deepEqual(risk(withPanes(fresh, LANES)), ["protected", "harmless"]);
		assert.deepEqual(risk(withPanes(fresh, undefined, LANES)), ["harmless", "protected"]);
		assert.deepEqual(risk(withPanes(fresh, LANES, { style: "heat", series: [{ key: GPU }] })), ["protected", "protected"]);
		assert.deepEqual(risk(withPanes(fresh, { style: "group", series: [], group: { from: "folder", keys: [], view: "rows" } })), ["protected", "harmless"], "a Group by its rule");
		assert.deepEqual(risk(withPanes(fresh, { name: "My GPU" })), ["protected", "harmless"], "a left half with a name");
		assert.deepEqual(risk(withPanes(fresh, { origin: "gpu" })), ["protected", "harmless"], "a left half Build made");
		assert.deepEqual(risk(withPanes(fresh, { readout: "left" })), ["protected", "harmless"], "Large values on the start's one reading");
	});

	it("a pair's halves are Fill's own only together: a half that matches a pair beside one that is not that pair's is protected", () => {
		for (const start of starts) assert.deepEqual(risk(drawing(start)), ["harmless", "harmless"], `${start.id} as Fill wrote it`);
		for (const left of starts) for (const right of starts) assert.deepEqual(risk(withPanes(fresh, pairHalf(left, 0), pairHalf(right, 1))), left === right ? ["harmless", "harmless"] : ["protected", "protected"], `${left.id} left, ${right.id} right`);
		const [cpuGpu, tempLoad] = starts;
		assert.deepEqual(risk(withPanes(fresh, pairHalf(cpuGpu, 1), pairHalf(cpuGpu, 0))), ["protected", "protected"], "a pair's halves swapped are no pair's halves at their place");
		assert.deepEqual(risk(withPanes(fresh, undefined, pairHalf(cpuGpu, 1))), ["harmless", "protected"], "the start on the left, a right half built by hand that matches a pair's");
		assert.deepEqual(risk(withPanes(empty, pairHalf(cpuGpu, 0))), ["protected", "harmless"], "a start changed by hand into a pair's left half (Area, Large values), the right half empty");
		assert.deepEqual(m.fillRisk(drawing(tempLoad), []), ["protected", "protected"], "with none of the pairs on this PC any more, nothing tells them apart");
	});

	it("an edited pair: a band, a renamed or recolored reading or a newer field protects its own half; an edit to what Fill writes protects both", () => {
		const [cpuGpu, tempLoad, cooling] = starts;
		const left = drawing(cpuGpu);
		const at = (config, i, pane) => (i === 0 ? withPanes(config, pane) : withPanes(config, undefined, pane));
		for (const [what, config, expect] of [
			["a band on the left half", at(left, 0, { bands: [{ key: CPU, warn: 90, below: false }] }), ["protected", "harmless"]],
			["a band on the right half", at(left, 1, { bands: [{ key: GPU, warn: 80, below: false }] }), ["harmless", "protected"]],
			["a reading renamed", at(left, 0, { series: [{ key: CPU, name: "Die" }] }), ["protected", "harmless"]],
			["a reading's own color", at(left, 1, { series: [{ key: GPU, color: "#ff7e8e" }] }), ["harmless", "protected"]],
			["a newer version's field on a reading", at(left, 0, { series: [{ key: CPU, smooth: 3 }] }), ["protected", "harmless"]],
			["a reading added", at(left, 0, { series: [{ key: CPU }, { key: CPU_POWER }] }), ["protected", "protected"]],
			["Large values off", at(left, 0, { readout: undefined }), ["protected", "protected"]],
			["Large values only", at(left, 1, { readout: "only" }), ["protected", "protected"]],
			["a Compare reordered", at(drawing(tempLoad), 0, { series: [{ key: GPU }, { key: CPU }] }), ["protected", "protected"]],
			["Group Now with limits", at(drawing(cooling), 1, { group: { ...cooling.panes[1].group, limits: { warn: 2000, below: false } } }), ["protected", "protected"]],
			["Group Now as Rows", at(drawing(cooling), 1, { group: { ...cooling.panes[1].group, view: "rows" } }), ["protected", "protected"]],
			["a rule kept on a series half", at(left, 0, { group: { from: "folder", keys: [], view: "auto" } }), ["protected", "protected"]]
		]) {
			const json = { ...config, panes: config.panes.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))) };
			assert.deepEqual(risk(json), expect, what);
		}
	});

	it("an ambiguous or imported half is protected: an unknown or cut style, a shape the plugin never writes; a right half's name or origin, which nothing shows or reads, does not count", () => {
		const left = drawing(starts[0]);
		for (const [what, config, expect] of [
			["a style this version does not know", withPanes(left, { style: "radar" }), ["protected", "protected"]],
			["a cut style (Bars)", withPanes(left, { style: "bars" }), ["protected", "protected"]],
			["a stored Fleet", withPanes(left, undefined, { style: "fleet" }), ["protected", "protected"]],
			["a name on the right half (only an import writes one)", withPanes(left, undefined, { name: "Fans" }), ["harmless", "harmless"]],
			["an origin on the right half", withPanes(left, undefined, { origin: "cooling" }), ["harmless", "harmless"]],
			["a name on a right half built by hand", withPanes(left, undefined, { ...LANES, name: "Fans" }), ["protected", "protected"]],
			["series that is not a list", withPanes(left, { series: "cpu" }), ["protected", "protected"]],
			["bands that are not a list", withPanes(left, undefined, { bands: {} }), ["harmless", "protected"]],
			["a rule that is not a rule", withPanes(left, undefined, { group: "rpm" }), ["protected", "protected"]],
			["a half that is not a pane", { ...left, panes: [left.panes[0], null] }, ["protected", "protected"]],
			["no halves at all", { ...left, panes: [] }, ["protected", "protected"]]
		]) {
			assert.deepEqual(risk(config), expect, what);
		}
		assert.deepEqual(risk(null), ["protected", "protected"], "no copy");
		assert.deepEqual(risk("split"), ["protected", "protected"], "not a config");
	});

	it("fields Fill never writes do not count: its look, scale, window, ids and a newer version's own pane fields", () => {
		const left = drawing(starts[0]);
		const kept = withPanes(left, { overlays: { ...left.panes[0].overlays, minmax: true }, scale: { min: 20, max: 95 }, window: "15m", future: { keep: 1 } }, { screenId: "0a0b0c0d", future: [1] });
		assert.deepEqual(risk(kept), ["harmless", "harmless"]);
	});

	it("over a Whole strip's screens Fill offers its pairs and changes only the two halves: every other screen, its id, order and fields kept", () => {
		const base = withPanes(fresh, { ...LANES, name: "CPU overview", origin: "cpu", screenId: "0000000a", future: "kept" });
		const screens = [
			{ style: "group", series: [], overlays: {}, scale: {}, bands: [], group: { from: "filter", filter: "*fan*", keys: [], view: "auto" }, name: "Fans", screenId: "0000000b", origin: "cooling", future: { deep: [1, 2] } },
			{ style: "trend", series: [{ key: GPU, name: "Die", future: true }], overlays: {}, scale: { min: 0 }, bands: [], screenId: "0000000c" }
		];
		const stored = stripConfigToJson(stripConfigOf({ ...base, screens, layout: "split", future: { top: true } }));
		assert.deepEqual(risk(stored), ["protected", "harmless"], "the left half is a screen built for the Whole strip");
		for (const start of starts) {
			const ops = m.splitStartOps(start, stored);
			assert.ok(Array.isArray(ops) && ops.length <= MAX_EDIT_OPS, start.id);
			assert.ok(ops.every((op) => op.op === "set" && /^panes\.[01]\./.test(op.path)), `${start.id}: only the halves' paths, ${JSON.stringify(ops.map((op) => op.path))}`);
			const result = applyStripEdit({ id: "g", rev: 9, config: stripConfigOf(stored) }, 9, ops, { deviceEncoders: 6 });
			assert.ok(result.ok, `${start.id}: ${JSON.stringify(result)}`);
			const json = stripConfigToJson(result.copy.config);
			assert.deepEqual(json.screens, stored.screens, `${start.id}: every screen after the first as it was, byte for byte`);
			assert.equal(json.future?.top, true, `${start.id}: the config's own unknown field`);
			assert.equal(json.panes[0].screenId, "0000000a", `${start.id}: the first screen keeps its id`);
			assert.equal(json.panes[0].future, "kept", `${start.id}: and its unknown field`);
			assert.equal(json.panes[0].name, undefined, `${start.id}: the replaced screen's name goes with it`);
			assert.equal(json.panes[0].origin, undefined, `${start.id}: and the origin Build stored on it`);
			assert.equal(m.splitStartIn(json, starts), start.id, `${start.id}: the halves draw the pair`);
			for (const key of ["overlays", "scale", "window"]) for (const i of [0, 1]) assert.deepEqual(json.panes[i][key], stored.panes[i][key], `${start.id}: panes.${i}.${key} kept`);
			assert.deepEqual(m.screenListOf({ ...json, layout: "whole" }).map((s) => s.id), ["0000000a", "0000000b", "0000000c"], `${start.id}: the Whole strip's screens in their order`);
		}
	});

	it("over harmless halves Fill sends exactly the operations it sent before: no name, no origin", () => {
		for (const config of [fresh, empty, ...starts.map((s) => drawing(s))]) {
			for (const start of starts) {
				const ops = m.splitStartOps(start, config);
				assert.ok(ops.length > 0 && ops.every((op) => !/\.(name|origin)$/.test(op.path)), `${start.id}: ${JSON.stringify(ops)}`);
			}
		}
	});

	it("the question names each protected half by its place and its name, and the Whole strip's first screen whenever Replace changes the left half", () => {
		const fahrenheit = false;
		const readingOf = (k) => {
			const hit = fixture.readings.find((r) => r.key === k);
			return hit === undefined ? { found: false } : { label: hit.label, source: fixture.sensors[hit.sensorIndex].name, found: true };
		};
		const ctx = { readingOf, fahrenheit };
		const [cpuGpu] = starts;
		/** A pair whose left half is the start as it stands: Replace leaves the left half as it is. */
		const keepsLeft = { id: "keeps", name: "Keeps", panes: [{ style: "trend", series: [HOT], group: null }, cpuGpu.panes[1]] };
		const left = withPanes(fresh, { ...LANES, name: "CPU overview" });
		assert.deepEqual(m.fillAsk(left, risk(left), cpuGpu, ctx), { text: "Replace the left half, 'CPU overview'?", whole: true });
		const right = withPanes(fresh, undefined, LANES);
		assert.deepEqual(m.fillAsk(right, risk(right), cpuGpu, ctx), { text: "Replace the right half, 'CPU (Tctl/Tdie) +1'?", whole: true }, "the untouched start on the left changes too, and it is the Whole strip's first screen");
		assert.deepEqual(m.fillAsk(right, risk(right), keepsLeft, ctx), { text: "Replace the right half, 'CPU (Tctl/Tdie) +1'?", whole: false }, "the left half stays as it is: no word of the Whole strip");
		const both = withPanes(fresh, LANES, { style: "heat", series: [{ key: GPU }] });
		assert.deepEqual(m.fillAsk(both, risk(both), cpuGpu, ctx), { text: "Replace both halves, 'CPU (Tctl/Tdie) +1' and 'GPU Temperature'?", whole: true });
		const nameless = withPanes(fresh, { style: "group", series: [], group: { from: "folder", keys: [], view: "rows" } }, { style: "trend", series: [{ key: "f0099999:0:1000000" }] });
		assert.deepEqual(m.fillAsk(nameless, risk(nameless), cpuGpu, ctx), { text: "Replace both halves?", whole: true }, "nothing to name them by");
		assert.deepEqual(m.fillAsk(withPanes(fresh, { style: "group", series: [], group: { from: "folder", keys: [], view: "rows" } }), ["protected", "harmless"], cpuGpu, ctx), { text: "Replace the left half?", whole: true });
		const plainRight = withPanes(fresh, undefined, { series: [{ key: "f0099999:0:1000000" }] });
		assert.deepEqual(m.fillAsk(plainRight, ["harmless", "protected"], keepsLeft, ctx), { text: "Replace the right half?", whole: false });
		const imported = withPanes(fresh, undefined, { ...LANES, name: "Fans", origin: "cooling" });
		assert.deepEqual(m.fillAsk(imported, risk(imported), cpuGpu, ctx), { text: "Replace the right half, 'CPU (Tctl/Tdie) +1'?", whole: true }, "a right half's imported name is shown nowhere else, so the question names it by what it draws");
		assert.equal(m.fillAsk(fresh, risk(fresh), cpuGpu, ctx), null, "nothing protected: no question");
	});
});

describe("a pick follows the person to another dial", () => {
	const groups = groupsOf(fixture);
	const starts = m.proposeSplits(groups, { slots: 6 });
	const base = stripConfigToJson(newStripConfig("whole", 6, stripSeedOf({ readingKey: GPU })));
	const other = stripConfigToJson(newStripConfig("whole", 6, stripSeedOf({})));

	it("a remembered draft's operations name the pair they came from, whichever dial drafted them", () => {
		for (const start of starts) {
			assert.equal(m.splitStartOf(m.splitStartOps(start, base), starts), start.id, `${start.id} from a dial with a reading`);
			assert.equal(m.splitStartOf(m.splitStartOps(start, other), starts), start.id, `${start.id} from a dial with none`);
		}
	});

	it("no operations is each half chosen; operations of no pair here name none", () => {
		assert.equal(m.splitStartOf([], starts), "own");
		assert.equal(m.splitStartOf(null, starts), "own");
		assert.equal(m.splitStartOf([{ op: "set", path: "panes.0.style", value: "heat" }], starts), null);
		assert.equal(m.splitStartOf(m.splitStartOps(starts[1], base), starts.slice(0, 1)), null, "a pair this PC does not offer");
	});

	it("a split drawing none of the pairs names none", () => {
		assert.equal(m.splitStartIn(base, starts), null);
		assert.equal(m.splitStartIn(null, starts), null);
	});
});

describe("CPU and RAM usage: a liquid meter of each, listed first", () => {
	const OTHER = 8;
	/** HWiNFO's own labels on this PC (MEASURED through bin/hwsm.node on
	 * 2026-11-08): Total CPU Usage is a Usage reading (7), Physical Memory
	 * Load an Other reading (8); beside them the readings the role must
	 * never take. */
	const usagePc = () =>
		make([
			["CPU [#0]: AMD Ryzen 9 9950X3D2", [["Total CPU Usage", "%", 13, T.usage], ["Max CPU/Thread Usage", "%", 40, T.usage], ["CPU (Tctl/Tdie)", "°C", 55, T.temp], ["CPU Package Power", "W", 60, T.power]]],
			["GPU [#0]: NVIDIA GeForce RTX 5090", [["GPU Temperature", "°C", 50, T.temp], ["GPU Core Load", "%", 3, T.usage], ["GPU Memory Usage", "%", 12, T.usage], ["GPU Memory Load", "%", 9, OTHER], ["GPU Fan1", "RPM", 900, T.fan]]],
			["System: MSI MS-7E49", [["Virtual Memory Committed", "MB", 30000, OTHER], ["Virtual Memory Load", "%", 38, OTHER], ["Physical Memory Used", "MB", 22000, OTHER], ["Physical Memory Load", "%", 46, OTHER]]]
		]);
	const snapshot = usagePc();
	const CPU_U = keyOf(snapshot, 0, "Total CPU Usage");
	const RAM_U = keyOf(snapshot, 2, "Physical Memory Load");
	const starts = m.proposeSplits(groupsOf(snapshot), { slots: 6 });
	const cpuRam = starts[0];

	it("is the first pair, named CPU and RAM usage: Total CPU Usage on the left, Physical Memory Load on the right, each a Meters Liquid", () => {
		assert.deepEqual(starts.map((s) => s.id), ["cpu-ram", "cpu-gpu", "temp-load", "cpu-cooling"]);
		assert.equal(cpuRam.name, "CPU and RAM usage");
		assert.deepEqual(halves(cpuRam), [
			["meters", "off", [CPU_U], null],
			["meters", "off", [RAM_U], null]
		]);
		assert.deepEqual(cpuRam.panes.map((h) => [h.look, h.names, h.decimals]), [
			["liquid", ["CPU usage"], "0"],
			["liquid", ["RAM usage"], "0"]
		]);
	});

	it("RAM usage is Physical Memory Load (an Other reading), never Virtual Memory Load or a GPU's memory", () => {
		const noPhysical = usagePc();
		noPhysical.readings = noPhysical.readings.filter((r) => r.label !== "Physical Memory Load");
		noPhysical.byKey = new Map(noPhysical.readings.map((r) => [r.key, r]));
		assert.ok(!m.proposeSplits(groupsOf(noPhysical), { slots: 6 }).some((s) => s.id === "cpu-ram"), "with no Physical Memory Load the pair is not offered");
		const noCpu = usagePc();
		noCpu.readings = noCpu.readings.filter((r) => r.label !== "Total CPU Usage" && r.label !== "Max CPU/Thread Usage");
		noCpu.byKey = new Map(noCpu.readings.map((r) => [r.key, r]));
		assert.ok(!m.proposeSplits(groupsOf(noCpu), { slots: 6 }).some((s) => s.id === "cpu-ram"), "with no CPU usage the pair is not offered");
		assert.ok(!m.proposeSplits(groupsOf(fixture), { slots: 6 }).some((s) => s.id === "cpu-ram"), "the panel fixture lists its memory load as a Usage reading, which HWiNFO does not: not taken");
	});

	it("on a new split it is one edit the plugin accepts: Meters Liquid, the short names, whole percents", () => {
		const base = newStripConfig("split", 6, stripSeedOf({ readingKey: CPU_U }));
		const ops = m.splitStartOps(cpuRam, stripConfigToJson(base));
		assert.ok(Array.isArray(ops) && ops.length <= MAX_EDIT_OPS);
		const result = applyStripEdit({ id: "draft", rev: 0, config: base }, 0, ops, { deviceEncoders: 6 });
		assert.ok(result.ok, JSON.stringify(result));
		const json = stripConfigToJson(result.copy.config);
		assert.deepEqual(json.panes.map((p) => [p.style, p.meterLook, p.series]), [
			["meters", "liquid", [{ key: CPU_U, name: "CPU usage" }]],
			["meters", "liquid", [{ key: RAM_U, name: "RAM usage" }]]
		]);
		assert.deepEqual(json.readingFormats, { [CPU_U]: { decimals: "0" }, [RAM_U]: { decimals: "0" } });
		assert.equal(m.splitStartIn(json, starts), "cpu-ram");
		assert.equal(m.splitStartOf(ops, starts), "cpu-ram");
		assert.deepEqual(m.fillRisk(json, starts), ["harmless", "harmless"], "as Fill wrote it");
	});

	it("a reading's own decimals or unit on this strip stay as the person set them", () => {
		const base = stripConfigToJson(newStripConfig("split", 6, stripSeedOf({})));
		const own = { ...base, readingFormats: { [CPU_U]: { decimals: "2" }, [RAM_U]: { unit: "GB" }, other: { decimals: "1" } } };
		const result = applyStripEdit({ id: "g", rev: 2, config: stripConfigOf(own) }, 2, m.splitStartOps(cpuRam, own), { deviceEncoders: 6 });
		assert.ok(result.ok, JSON.stringify(result));
		assert.deepEqual(stripConfigToJson(result.copy.config).readingFormats, { [CPU_U]: { decimals: "2" }, [RAM_U]: { unit: "GB", decimals: "0" }, other: { decimals: "1" } });
	});

	it("its whole percents keep step with the plugin's formats and the panel's own Decimals row: the same units, decimals and cap, and the same entry", () => {
		assert.deepEqual(m.DECIMALS, [...DECIMALS]);
		assert.deepEqual(m.DECIMALS, [...panelModel.FORMAT_DECIMALS]);
		const others = (n, entry) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f7006600:0:${(0x3000000 + i).toString(16)}`, entry(i)]));
		const raws = [
			undefined,
			{},
			{ [CPU_U]: { decimals: "2" } },
			{ [CPU_U]: { decimals: "auto" }, [RAM_U]: { unit: "GB" } },
			...FIXED_DATA_UNITS.map((unit) => ({ [RAM_U]: { unit }, other: { unit, decimals: "1" } })),
			...DECIMALS.map((decimals) => ({ [CPU_U]: { decimals }, other: { decimals } })),
			// What the plugin drops: a unit or decimals it does not know, a field it does not keep.
			{ [CPU_U]: { unit: "kB", decimals: "9" }, [RAM_U]: { unit: "GB", decimals: 1, note: "newer" }, other: { unit: "PB" }, junk: "x", list: [] },
			// A key spelled like an object's own machinery is an entry like any other.
			JSON.parse(`{"__proto__":{"decimals":"1"},"constructor":{"unit":"MB"},"${RAM_U}":{"unit":"TiB"}}`),
			// At and under the cap: a new entry fits under it and not at it.
			others(MAX_READING_FORMATS - 1, (i) => ({ decimals: DECIMALS[i % DECIMALS.length] })),
			others(MAX_READING_FORMATS, (i) => ({ unit: FIXED_DATA_UNITS[i % FIXED_DATA_UNITS.length] })),
			{ ...others(MAX_READING_FORMATS - 1, () => ({ decimals: "1" })), [RAM_U]: { unit: "GiB" } }
		];
		const base = stripConfigToJson(newStripConfig("split", 6, stripSeedOf({})));
		for (const [n, raw] of raws.entries()) {
			// The map as the plugin stores it, which is what the panel reads.
			const stored = stripConfigToJson(stripConfigOf(raw === undefined ? base : { ...base, readingFormats: raw }));
			const kept = stored.readingFormats;
			let expected = kept;
			for (const k of [CPU_U, RAM_U]) {
				const own = panelModel.readingFormatOf(expected, [k]);
				if (own !== null && own.entry.decimals !== undefined) continue;
				const patched = panelModel.patchReadingFormat(expected, [k], k, { decimals: "0" });
				if (patched.refused === undefined) expected = patched.next;
			}
			const ops = m.splitStartOps(cpuRam, stored);
			const written = ops.find((op) => op.path === "readingFormats");
			assert.deepEqual(written?.value ?? kept, expected, `case ${n}: the entries the pair writes`);
			if (written !== undefined) assert.deepEqual(Object.keys(written.value).sort(), Object.keys(expected).sort(), `case ${n}: every key an own entry`);
			if (written !== undefined) assert.ok(exactReadingFormats(written.value), `case ${n}: the plugin takes the map as sent`);
			const result = applyStripEdit({ id: "g", rev: 2, config: stripConfigOf(stored) }, 2, ops, { deviceEncoders: 6 });
			assert.ok(result.ok, `case ${n}: ${JSON.stringify(result)}`);
			assert.deepEqual(stripConfigToJson(result.copy.config).readingFormats, expected, `case ${n}: as the plugin keeps it`);
		}
	});

	it("an edited pair is protected as any other: a renamed reading its own half, a changed Look both", () => {
		const base = stripConfigToJson(newStripConfig("split", 6, stripSeedOf({})));
		const result = applyStripEdit({ id: "g", rev: 2, config: stripConfigOf(base) }, 2, m.splitStartOps(cpuRam, base), { deviceEncoders: 6 });
		assert.ok(result.ok);
		const json = stripConfigToJson(result.copy.config);
		const renamed = { ...json, panes: [{ ...json.panes[0], series: [{ key: CPU_U, name: "Processor" }] }, json.panes[1]] };
		assert.deepEqual(m.fillRisk(renamed, starts), ["protected", "harmless"]);
		const full = { ...json, panes: [json.panes[0], { ...json.panes[1], meterLook: "full" }] };
		assert.deepEqual(m.fillRisk(full, starts), ["protected", "protected"]);
		assert.equal(m.splitStartIn(full, starts), null, "a half in another Look is not the pair");
	});

	it("another pair over it clears the Look a meter it writes would keep: CPU and cooling's fans are Thin bars", () => {
		const base = stripConfigToJson(newStripConfig("split", 6, stripSeedOf({})));
		const first = applyStripEdit({ id: "g", rev: 2, config: stripConfigOf(base) }, 2, m.splitStartOps(cpuRam, base), { deviceEncoders: 6 });
		assert.ok(first.ok);
		const json = stripConfigToJson(first.copy.config);
		const fewFans = make([
			["CPU [#0]: Example", CPU_ROWS],
			["Motherboard: Example", [["CPU Fan", "RPM", 1100, T.fan], ["AIO Pump", "RPM", 2700, T.fan]]]
		]);
		const cooling = m.proposeSplits(groupsOf(fewFans), { slots: 6 }).find((s) => s.id === "cpu-cooling");
		const second = applyStripEdit({ id: "g", rev: 3, config: first.copy.config }, 3, m.splitStartOps(cooling, json), { deviceEncoders: 6 });
		assert.ok(second.ok, JSON.stringify(second));
		const after = stripConfigToJson(second.copy.config);
		assert.equal(after.panes[1].style, "meters");
		assert.equal(Object.hasOwn(after.panes[1], "meterLook"), false, "the fans draw as Thin bars");
		assert.equal(m.splitStartIn(after, [cooling]), "cpu-cooling");
	});
});
