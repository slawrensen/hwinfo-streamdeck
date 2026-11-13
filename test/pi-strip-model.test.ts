/**
 * The Strip section's pure model (ui/pi-strip-model.js), evaluated against
 * a stub `self` from the same bytes the panel loads: its limits mirror the
 * plugin's strip settings, every patch it builds is one the plugin's edit
 * protocol accepts and lands exactly the edited config, each row says
 * what its style draws (a reading past the limit is kept and marked, never
 * cut), recipes propose readings by type and name from a sensor list
 * (never a fixed key) and leave a visible gap where nothing fits, and the
 * slot map's words.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { compileDetailFilter, detailFilterAlternatives } from "../src/detail/detail-settings";
import { SensorType, type Reading, type SensorSnapshot, type SensorSource } from "../src/hwinfo/types";
import { GROUP_HISTORY_BUDGET_BYTES } from "../src/history/store";
import { ENTRY_BYTES, TIERS } from "../src/history/window";
import { buildSensorTree } from "../src/pi-protocol";
import { applyStripEdit, MAX_EDIT_OPS } from "../src/strip/edits";
import { resolveGroup } from "../src/strip/group";
import { autoScreenName } from "../src/strip/screens";
import { tileShapeOf } from "../src/strip/tiles";
import * as stripSettings from "../src/strip/settings";
import { DIAL_BACKGROUNDS, dialBackgroundOf } from "../src/ui/dial-background";
import { loadPanelModels } from "./panel-models";
import { AXES_OVERLAY, DEFAULT_OVERLAYS, HISTORY_WINDOWS, STRIP_GAP_MODES, STRIP_READOUTS, MAX_BANDS, MAX_NAME_LENGTH, MAX_SERIES, newStripConfig, OVERLAY_NAMES, SERIES_LIMITS, STRIP_STYLES, stripConfigOf, stripConfigToJson, stripPaneOf, stripSeedOf } from "../src/strip/settings";

type Pane = { style: string; readout: string; series: { key: string; name?: string }[]; window?: string; overlays: Record<string, boolean>; scale: { min?: number; max?: number }; bands: Record<string, unknown>[]; group?: Record<string, unknown> | null };
type Working = { layout: "whole" | "split"; window: string; sharedWindow: boolean; gapMode: string; background: string; accentWords: boolean | null; stars?: string; skyColor?: string; theme?: string; linkId: string; panes: [Pane, Pane] };
type Slot = { column: number; state: string; self: boolean; groupId: string | null };
type StripModel = {
	STYLES: string[];
	SERIES_LIMITS: Record<string, { min: number; max: number }>;
	MAX_SERIES: number;
	WINDOWS: string[];
	OVERLAYS: string[];
	DEFAULT_OVERLAYS: Record<string, boolean>;
	MAX_BANDS: number;
	MAX_OPS: number;
	BACKGROUNDS: string[];
	STARS: string[];
	TONES: string[];
	GAP_MODES: string[];
	gapModeShown(pane: unknown): boolean;
	gapModeOnStrip(config: unknown): boolean;
	startEvents(w: unknown, pane: unknown, screens: number): void;
	readingsFieldOf(pane: unknown): "picker" | "filter" | "unit";
	alertBandsLine(panes: unknown[]): string;
	paneOf(raw: unknown): Pane;
	READOUTS: string[];
	AXES: string;
	workingOf(config: unknown): Working;
	patchOf(base: unknown, working: Working, options?: { layout?: boolean }): { op: string; path: string; value: unknown }[];
	diffOps(before: Working, after: Working, options?: { layout?: boolean }): { op: string; path: string; value: unknown }[];
	numberOf(text: unknown): number | null | undefined;
	displayUnit(unit: string, fahrenheit: boolean): string;
	styleCheck(style: string, readings: { key: string; label: string; unit?: string }[]): { note: string | null; fit: string | null };
	seriesRows(style: string, readings: { key: string; label: string; unit?: string }[]): { drawn: boolean; reason: string | null }[];
	fitStyle(style: string, readings: { key: string; label: string; unit?: string }[]): string | null;
	styleOffer(style: string, readings: { key: string; label: string; unit?: string }[], ctx?: { slots?: number }): { offered: boolean; label: string | null };
	unitsOf(readings: { key: string; label: string; unit?: string }[]): Set<string>;
	scaleCheck(min: number | null | undefined, max: number | null | undefined): string | null;
	paneColumns(layout: string, encoders: number, index: number): number[];
	slotLine(slot: Slot, ctx: { groupId: string | null; live: boolean; conflictColumns: number[] }): { kind: string; text: string; action: string | null };
	summary(state: unknown): string;
};

/** The panel's filter grammar (ui/pi-model.js), which the strip model reads. */
type PanelFilter = { detailFilterAlternatives(pattern: string): string[]; detailFilterMatcher(pattern: string): (candidate: string) => boolean };
const { hwStripModel: m, hwModel: panelModel } = loadPanelModels<StripModel, PanelFilter>();

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A sensor list in the panel's sensorTree shape, with fixture-style names. */
const T = { temp: 1, volt: 2, fan: 3, power: 5, clock: 6, usage: 7, other: 8 };
function tree(): { name: string; readings: { key: string; label: string; unit: string; type: number; display: string }[] }[] {
	const group = (name: string, id: string, rows: [string, string, number][]) => ({ name, readings: rows.map(([label, unit, type], i) => ({ key: `${id}:0:${(0x1000000 + i).toString(16)}`, label, unit, type, display: "" })) });
	return [
		group("CPU [#0]: Example 16-Core Processor: Enhanced", "f0000300", [
			["CPU (Tctl/Tdie)", "°C", T.temp],
			["CPU CCD1 (Tdie)", "°C", T.temp],
			["CPU Package Power", "W", T.power],
			["Total CPU Usage", "%", T.usage],
			["Thermal Throttling (HTC)", "Yes/No", T.other]
		]),
		group("GPU [#0]: Example Graphics 24GB", "e0002000", [
			["GPU Hot Spot Temperature", "°C", T.temp],
			["GPU Temperature", "°C", T.temp],
			["GPU Power", "W", T.power],
			["GPU Core Load", "%", T.usage],
			["GPU Fan1", "RPM", T.fan]
		]),
		group("Motherboard: Example X670", "f7006600", [
			["CPU", "°C", T.temp],
			["CPU Fan", "RPM", T.fan],
			["AIO Pump", "RPM", T.fan]
		]),
		group("System: Example Desktop", "f0100000", [["Physical Memory Load", "%", T.usage]])
	];
}

const GPU_TEMP = "e0002000:0:1000001";
const baseJsonOf = (): ReturnType<typeof stripConfigToJson> => stripConfigToJson(newStripConfig("whole", 4, stripSeedOf({ readingKey: GPU_TEMP })));
const CPU_TEMP = "f0000300:0:1000000";

describe("the Strip section's limits mirror the plugin's settings", () => {
	it("styles, series limits, windows, overlays, bands and the patch cap", () => {
		assert.deepEqual(m.STYLES, [...STRIP_STYLES]);
		assert.deepEqual(m.SERIES_LIMITS, clone(SERIES_LIMITS));
		assert.equal(m.MAX_SERIES, MAX_SERIES);
		assert.deepEqual(m.WINDOWS, [...HISTORY_WINDOWS]);
		assert.deepEqual(m.OVERLAYS, [...OVERLAY_NAMES]);
		assert.deepEqual(m.DEFAULT_OVERLAYS, clone(DEFAULT_OVERLAYS));
		assert.equal(m.MAX_BANDS, MAX_BANDS);
		assert.equal(m.MAX_OPS, MAX_EDIT_OPS);
		for (const bg of m.BACKGROUNDS) assert.equal(dialBackgroundOf(bg), bg);
		assert.deepEqual(m.BACKGROUNDS, [...DIAL_BACKGROUNDS]);
		assert.deepEqual(m.READOUTS, ["off", ...STRIP_READOUTS]);
		assert.deepEqual(m.GAP_MODES, ["connect", ...STRIP_GAP_MODES]);
		assert.equal(m.AXES, AXES_OVERLAY);
	});
});

describe("patches the plugin accepts", () => {
	const base = newStripConfig("whole", 4, stripSeedOf({ readingKey: GPU_TEMP, dialBackground: "tint" }));
	const baseJson = stripConfigToJson(base);

	it("an untouched draft sends nothing", () => {
		assert.deepEqual(m.patchOf(baseJson, m.workingOf(baseJson), { layout: true }), []);
	});

	it("Brief gaps defaults without a write, is one edit of the strip, and Connect restores absence", () => {
		assert.equal(m.workingOf(baseJson).gapMode, "connect");
		for (const mode of ["mark", "gaps"]) {
			const w = m.workingOf(baseJson);
			w.gapMode = mode;
			const patch = m.patchOf(baseJson, w);
			assert.deepEqual(patch, [{ op: "set", path: "gapMode", value: mode }]);
			const result = applyStripEdit({ id: "x", rev: 3, config: base }, 3, patch);
			assert.ok(result.ok);
			assert.deepEqual(m.workingOf(stripConfigToJson(result.copy.config)), w);
			const back = applyStripEdit({ id: "x", rev: 4, config: result.copy.config }, 4, [{ op: "set", path: "gapMode", value: "connect" }]);
			assert.ok(back.ok);
			assert.equal(back.copy.config.gapMode, undefined);
			assert.equal(Object.hasOwn(stripConfigToJson(back.copy.config), "gapMode"), false, "selecting Connect removes the field");
		}
		for (const value of [null, true, 2, "smooth", {}, []]) assert.equal(applyStripEdit({ id: "x", rev: 3, config: base }, 3, [{ op: "set", path: "gapMode", value }]).ok, false);
		assert.equal(applyStripEdit({ id: "x", rev: 3, config: base }, 3, [{ op: "set", path: "panes.0.gapMode", value: "mark" }]).ok, false, "a pane has no such field");
	});
	it("Brief gaps: a value a newer version stored reads as Connect, sends nothing, and survives an unrelated edit", () => {
		const raw = { ...(stripConfigToJson(base) as Record<string, unknown>), gapMode: "future-mode" };
		const w = m.workingOf(raw);
		assert.equal(w.gapMode, "connect");
		assert.deepEqual(m.patchOf(raw, m.workingOf(raw)), []);
		const parsed = stripConfigOf(raw);
		const edited = applyStripEdit({ id: "x", rev: 3, config: parsed }, 3, [{ op: "set", path: "panes.0.readout", value: "left" }]);
		assert.ok(edited.ok);
		assert.equal(stripConfigToJson(edited.copy.config).gapMode, "future-mode");
	});
	it("Brief gaps: a value on a pane is not read, and writes nothing", () => {
		const raw = stripConfigToJson(base) as { panes: Record<string, unknown>[] };
		raw.panes[0] = { ...raw.panes[0], gapMode: "mark" };
		assert.equal(m.workingOf(raw).gapMode, "connect");
		assert.deepEqual(m.patchOf(raw, m.workingOf(raw)), []);
	});
	describe("Brief gaps shows while any screen the strip draws has a line", () => {
		const heat = { style: "heat", series: [] };
		it("one screen of a Whole strip", () => {
			assert.equal(m.gapModeOnStrip({ layout: "whole", panes: [{ style: "trend" }, heat] }), true);
			assert.equal(m.gapModeOnStrip({ layout: "whole", panes: [heat, { style: "trend" }] }), false, "the second pane waits for a split");
		});
		it("a later screen", () => {
			assert.equal(m.gapModeOnStrip({ layout: "whole", panes: [heat, heat], screens: [{ style: "meters" }, { style: "lanes" }] }), true);
			assert.equal(m.gapModeOnStrip({ layout: "whole", panes: [heat, heat], screens: [{ style: "meters" }, { style: "group", group: { from: "folder", keys: [], view: "rows" } }] }), false);
			assert.equal(m.gapModeOnStrip({ layout: "whole", panes: [heat, heat], screens: [{ style: "group", group: { from: "folder", keys: [], view: "tiles" } }] }), true);
		});
		it("either half of a split, and not the screens it keeps undrawn", () => {
			assert.equal(m.gapModeOnStrip({ layout: "split", panes: [heat, { style: "area" }] }), true);
			assert.equal(m.gapModeOnStrip({ layout: "split", panes: [heat, heat], screens: [{ style: "trend" }] }), false);
		});
		it("nothing stored, nothing shown", () => {
			assert.equal(m.gapModeOnStrip(null), false);
			assert.equal(m.gapModeOnStrip({}), false);
		});
	});
	describe("Brief gaps shows by the stored pane, never by live data", () => {
		const shown = (raw: Record<string, unknown>): boolean => m.gapModeShown(m.paneOf(raw));
		for (const style of ["trend", "area", "compare", "lanes"]) {
			it(`${style}: shown`, () => assert.equal(shown({ style }), true));
			it(`${style} with Large values only: shown`, () => assert.equal(shown({ style, readout: "only" }), true));
		}
		for (const style of ["heat", "meters", "events", "ambient"]) {
			it(`${style}: hidden`, () => assert.equal(shown({ style }), false));
		}
		it("Heat with Large values only draws a line: shown", () => assert.equal(shown({ style: "heat", readout: "only" }), true));
		it("Meters with a stored Large values only draws no line: hidden", () => assert.equal(shown({ style: "meters", readout: "only" }), false));
		for (const [view, expected] of [["auto", true], ["spread", true], ["tiles", true], ["rows", false], ["now", false]] as const) {
			it(`Group, stored view ${view}: ${expected ? "shown" : "hidden"}`, () => assert.equal(shown({ style: "group", group: { from: "list", keys: ["a"], view } }), expected));
		}
		it("a Group with no stored rule yet: shown", () => assert.equal(shown({ style: "group" }), true));
		it("a style this version does not know reads as Trend: shown", () => assert.equal(shown({ style: "from-the-future" }), true));
	});

	it("every edited field lands exactly through applyStripEdit, and nothing else moves", () => {
		const w = m.workingOf(baseJson);
		w.layout = "split";
		w.window = "15m";
		w.sharedWindow = false;
		w.panes[0].style = "compare";
		w.panes[0].series = [{ key: GPU_TEMP }, { key: CPU_TEMP }];
		w.panes[0].overlays.minmax = true;
		w.panes[0].scale = { min: 20, max: 100 };
		w.panes[0].bands = [{ key: CPU_TEMP, warn: 80, crit: 90, below: false, unit: "°C" }];
		w.panes[1].style = "lanes";
		w.panes[1].window = "1m";
		w.panes[1].series = [{ key: "a" }, { key: "b" }];
		w.panes[1].overlays.legend = false;
		w.background = "outline";
		w.accentWords = true;
		w.linkId = " strip-a ";
		const patch = m.patchOf(baseJson, w, { layout: true });
		assert.ok(patch.length <= MAX_EDIT_OPS);
		const result = applyStripEdit({ id: "x", rev: 3, config: base }, 3, patch, { deviceEncoders: 4 });
		assert.equal(result.ok, true, JSON.stringify(result));
		if (!result.ok) return;
		const landed = stripConfigToJson(result.copy.config);
		assert.deepEqual(m.workingOf(landed), { ...w, linkId: "strip-a" });
		assert.equal(landed.background, "outline");
		assert.equal(landed.theme, base.theme, "fields the section does not edit stay as they were");
	});

	it("Readout, Scale and grid and a style land through applyStripEdit, and Off clears them from the copy", () => {
		const w = m.workingOf(baseJson);
		assert.equal(w.panes[0].readout, "off");
		assert.equal(w.panes[0].overlays.axes, false);
		w.panes[0].readout = "left";
		w.panes[0].overlays.axes = true;
		w.panes[0].style = "area";
		w.panes[1].readout = "only";
		const patch = m.patchOf(baseJson, w);
		assert.deepEqual(patch.map((op) => op.path).sort(), ["panes.0.overlays.axes", "panes.0.readout", "panes.0.style", "panes.1.readout"]);
		const on = applyStripEdit({ id: "x", rev: 3, config: base }, 3, patch, { deviceEncoders: 4 });
		assert.ok(on.ok);
		const landed = stripConfigToJson(on.copy.config);
		assert.deepEqual(m.workingOf(landed), w);
		const back = m.workingOf(landed);
		back.panes[0].readout = "off";
		back.panes[0].overlays.axes = false;
		const off = applyStripEdit({ id: "x", rev: 4, config: on.copy.config }, 4, m.patchOf(landed, back), { deviceEncoders: 4 });
		assert.ok(off.ok);
		assert.doesNotMatch(JSON.stringify((stripConfigToJson(off.copy.config).panes as unknown[])[0]), /readout|axes/);
	});

	it("Stars and Sky color land through applyStripEdit and read back; the panel's names are the plugin's", () => {
		assert.deepEqual(m.STARS, ["all", "few", "off"]);
		assert.deepEqual(m.TONES, ["theme", "deep", "warm", "cool", "mono"]);
		const json0 = stripConfigToJson(stripConfigOf(baseJson));
		const w = m.workingOf(json0);
		assert.deepEqual([w.stars, w.skyColor], ["", ""]);
		const next = m.workingOf(json0);
		next.stars = "off";
		next.skyColor = "warm";
		const patch = m.patchOf(json0, next);
		assert.deepEqual(patch, [
			{ op: "set", path: "stars", value: "off" },
			{ op: "set", path: "skyColor", value: "warm" }
		]);
		const landed = applyStripEdit({ id: "x", rev: 1, config: stripConfigOf(json0) }, 1, patch, { deviceEncoders: 4 });
		assert.ok(landed.ok);
		const json = stripConfigToJson(landed.copy.config);
		assert.deepEqual([json.stars, json.skyColor], ["off", "warm"]);
		assert.deepEqual(m.workingOf(json), next);
		const junk = m.workingOf(stripConfigToJson(stripConfigOf({ ...baseJson, stars: "some", skyColor: "teal" })));
		assert.deepEqual([junk.stars, junk.skyColor], ["", ""], "a name the plugin does not keep (some) reads as Default");
	});

	it("Background Default: absent reads as Default; picking Default sends \"\" and null, and the copy follows the shared look again", () => {
		const fresh = m.workingOf(stripConfigToJson(newStripConfig("whole", 4, stripSeedOf({ dialBackground: "clear", dialAccentWords: true }))));
		assert.equal(fresh.background, "", "a new strip is on Default");
		assert.equal(fresh.accentWords, null);
		const ownJson = stripConfigToJson(stripConfigOf({ ...baseJson, background: "glass", accentWords: false }));
		const own = m.workingOf(ownJson);
		assert.equal(own.background, "glass");
		assert.equal(own.accentWords, false);
		const back = m.workingOf(ownJson);
		back.background = "";
		back.accentWords = null;
		const patch = m.patchOf(ownJson, back);
		assert.deepEqual(patch, [
			{ op: "set", path: "background", value: "" },
			{ op: "set", path: "accentWords", value: null }
		]);
		const landed = applyStripEdit({ id: "x", rev: 1, config: stripConfigOf(ownJson) }, 1, patch, { deviceEncoders: 4 });
		assert.ok(landed.ok);
		const json = stripConfigToJson(landed.copy.config);
		assert.ok(!("background" in json) && !("accentWords" in json), JSON.stringify(json));
	});

	it("the strip's own theme: a pick is one edit the plugin lands, and Default clears it so the strip follows the shared theme", () => {
		const w = m.workingOf(baseJson);
		assert.equal(w.theme, "", "a strip with no theme of its own is on Default");
		const picked = { ...clone(w), theme: "ember" };
		const patch = m.diffOps(w, picked, { layout: true });
		assert.deepEqual(patch, [{ op: "set", path: "theme", value: "ember" }]);
		const on = applyStripEdit({ id: "x", rev: 1, config: base }, 1, patch, { deviceEncoders: 4 });
		assert.ok(on.ok, JSON.stringify(on));
		if (!on.ok) return;
		assert.equal(on.copy.config.theme, "ember");
		assert.equal(m.workingOf(stripConfigToJson(on.copy.config)).theme, "ember");
		const cleared = m.diffOps(picked, w, { layout: true });
		assert.deepEqual(cleared, [{ op: "set", path: "theme", value: "" }]);
		const off = applyStripEdit({ id: "x", rev: 2, config: on.copy.config }, 2, cleared, { deviceEncoders: 4 });
		assert.ok(off.ok && off.copy.config.theme === undefined, JSON.stringify(off));
	});

	it("clearing a scale end and a pane window sends null, which the plugin takes as clear", () => {
		const start = m.workingOf(baseJson);
		start.panes[0].scale = { min: 10 };
		start.panes[1].window = "1m";
		const edited = applyStripEdit({ id: "x", rev: 1, config: base }, 1, m.patchOf(baseJson, start));
		assert.equal(edited.ok, true);
		if (!edited.ok) return;
		const mid = stripConfigToJson(edited.copy.config);
		const back = m.workingOf(mid);
		back.panes[0].scale = {};
		delete back.panes[1].window;
		const patch = m.patchOf(mid, back);
		assert.deepEqual(
			patch.map((p) => [p.path, p.value]),
			[
				["panes.0.scale.min", null],
				["panes.1.window", null]
			]
		);
		const cleared = applyStripEdit({ id: "x", rev: 2, config: edited.copy.config }, 2, patch);
		assert.equal(cleared.ok, true);
		if (cleared.ok) assert.deepEqual(m.workingOf(stripConfigToJson(cleared.copy.config)), back);
	});

	it("one change sends only its own operation, and the plugin lands it", () => {
		const shown = m.workingOf(baseJson);
		const after = clone(shown);
		after.panes[0].series.push({ key: CPU_TEMP });
		const ops = m.diffOps(shown, after, { layout: true });
		assert.deepEqual(ops, [{ op: "set", path: "panes.0.series", value: [{ key: GPU_TEMP }, { key: CPU_TEMP }] }]);
		const landed = applyStripEdit({ id: "x", rev: 1, config: base }, 1, ops, { deviceEncoders: 4 });
		assert.ok(landed.ok && landed.copy.config.panes[0].series.length === 2);
		const split = clone(shown);
		split.layout = "split";
		assert.deepEqual(m.diffOps(shown, split, { layout: true }), [{ op: "set", path: "layout", value: "split" }], "a running strip's layout is one operation");
		assert.deepEqual(m.diffOps(shown, clone(shown), { layout: true }), [], "no change sends nothing");
	});

	it("four readings in a three-reading style land whole, and switching styles keeps all four", () => {
		const four = [GPU_TEMP, CPU_TEMP, "a:0:1", "b:0:1"].map((key) => ({ key }));
		let config = stripConfigOf({ ...baseJson, panes: [{ style: "compare", series: four }, {}] });
		let rev = 1;
		for (const style of ["trend", "lanes", "heat", "compare"]) {
			const shown = m.workingOf(stripConfigToJson(config));
			assert.deepEqual(shown.panes[0].series, four, `the panel shows all four before ${style}`);
			const after = clone(shown);
			after.panes[0].style = style;
			const r = applyStripEdit({ id: "x", rev, config }, rev, m.diffOps(shown, after, { layout: true }), { deviceEncoders: 4 });
			assert.ok(r.ok, style);
			config = r.copy.config;
			rev = r.copy.rev;
			assert.deepEqual(config.panes[0].series, four, `${style} keeps all four`);
		}
	});

	it("a new strip's patch leaves the layout out (stripCreate names it)", () => {
		const w = m.workingOf(baseJson);
		w.layout = "split";
		assert.deepEqual(m.patchOf(baseJson, w), []);
	});

	it("typed numbers read like the plugin's threshold parser", () => {
		assert.equal(m.numberOf("70,5"), 70.5);
		assert.equal(m.numberOf(" -3 "), -3);
		assert.equal(m.numberOf(""), undefined);
		assert.equal(m.numberOf("hot"), null);
		assert.equal(m.scaleCheck(10, 5), "Scale from must be below Scale to.");
		assert.equal(m.scaleCheck(undefined, 5), null);
		assert.equal(m.scaleCheck(null, 5), "Scale ends must be numbers.");
		assert.equal(m.displayUnit("°C", true), "°F");
		assert.equal(m.displayUnit("Δ°C", true), "Δ°F", "a temperature difference is shown in Δ°F too");
		assert.equal(m.displayUnit("Δ°C", false), "Δ°C");
		assert.equal(m.displayUnit("W", true), "W");
	});
});

describe("style checks say what a style draws, and nothing stops a change", () => {
	const r = (key: string, label: string, unit?: string): { key: string; label: string; unit?: string } => ({ key, label, ...(unit === undefined ? {} : { unit }) });
	const temps = [r("a", "A", "°C"), r("b", "B", "°C"), r("c", "C", "°C"), r("d", "D", "°C")];

	it("readings past a style's limit are kept, marked not drawn (the row says it), and the style that draws them all is offered", () => {
		assert.deepEqual(m.seriesRows("trend", temps).map((x) => x.reason), [null, null, null, "limit"]);
		assert.deepEqual(m.styleCheck("trend", temps), { note: "Compare draws them all.", fit: "compare" }, "the row says not drawn; the line only offers the style");
		assert.deepEqual(m.styleCheck("heat", temps.slice(0, 2)), { note: "Compare draws them all.", fit: "compare" });
		assert.deepEqual(m.styleCheck("compare", temps), { note: null, fit: null }, "Compare draws all four");
		assert.deepEqual(m.styleCheck("lanes", [...temps, r("e", "E", "°C")].slice(0, 5)), { note: null, fit: null }, "nothing draws five: the rows say it, no line");
	});

	it("a reading in another unit is drawn in its own band, never left out", () => {
		const mixed = [r("a", "CPU Package", "°C"), r("b", "GPU Power", "W")];
		for (const style of ["trend", "area"]) {
			assert.deepEqual(m.seriesRows(style, mixed).map((x) => x.reason), [null, null], style);
			assert.deepEqual(m.styleCheck(style, mixed), { note: null, fit: null }, style);
		}
		assert.deepEqual(m.seriesRows("compare", mixed).map((x) => x.reason), [null, null], "a stored mixed Compare still draws both, a band per unit");
		assert.deepEqual(m.styleCheck("lanes", mixed), { note: null, fit: null });
		assert.deepEqual(m.styleCheck("lanes", [...mixed, r("c", "C", "°C"), r("d", "D", "RPM")]), { note: null, fit: null }, "four readings in three units: nothing draws them all, and the row says which is not drawn");
	});

	it("Compare is offered only while the ticked readings share one unit, and a mixed Compare points to Lanes (owner, 2026-10-26)", () => {
		const two = [r("a", "CPU Package", "°C"), r("b", "GPU Power", "W")];
		const four = [...two, r("c", "C", "°C"), r("d", "D", "RPM")];
		assert.deepEqual(m.styleOffer("compare", temps), { offered: true, label: null }, "four in one unit");
		assert.deepEqual(m.styleOffer("compare", two), { offered: false, label: "units" }, "two units: not offered, and the option says why");
		assert.deepEqual(m.styleOffer("compare", four), { offered: false, label: "units" });
		assert.deepEqual(m.styleOffer("compare", [r("a", "A", "°C"), r("b", "Saved reading")]), { offered: true, label: null }, "a reading HWiNFO does not list is not compared");
		assert.equal(m.fitStyle("trend", [...two, r("c", "C", "°C"), r("e", "E", "W")]), null, "Compare is never the fit for several units");
		assert.equal(m.fitStyle("trend", [...temps]), "compare", "and still is for one");
		assert.deepEqual(m.styleCheck("compare", two), { note: "Compare is for one unit; these draw in two bands, one per unit. Lanes gives each its own scale.", fit: "lanes", warn: true }, "a stored mixed Compare says so, with Use Lanes");
		assert.deepEqual(m.styleCheck("compare", four), { note: "Compare is for one unit; these draw in three bands, one per unit. Lanes gives each its own scale.", fit: null, warn: true }, "four readings: Lanes draws three, so no switch");
		assert.deepEqual(m.unitsOf(four), new Set(["°C", "W", "RPM"]));
	});

	it("a stored mixed Compare's line agrees with its rows and the strip: every reading still draws, a band per unit (docs/strip-display.md: 'still draws them, and says so')", () => {
		const two = [r("a", "CPU Package", "°C"), r("b", "GPU Power", "W")];
		const four = [...two, r("c", "C", "°C"), r("d", "D", "RPM")];
		for (const readings of [two, four]) {
			const units = [...m.unitsOf(readings)].join(", ");
			assert.ok(m.seriesRows("compare", readings).every((row) => row.drawn), `${units}: the rows mark every reading drawn`);
			const { note, warn } = m.styleCheck("compare", readings) as { note: string | null; warn?: boolean };
			assert.equal(warn, true, `${units}: the line still points out Compare is for one unit`);
			assert.ok(note !== null, `${units}: a line`);
			assert.doesNotMatch(note, /draws one unit/, `${units}: the line must not say Compare draws one unit while the rows and the strip draw every reading`);
			assert.match(note, /still draws?|draws? (them|both|all|each)|band/i, `${units}: the line says these readings still draw (a band per unit), as the docs promise`);
		}
	});

	it("too few readings explain the empty state", () => {
		assert.deepEqual(m.styleCheck("lanes", [r("a", "A", "°C")]), { note: "Lanes draws two to three readings; add one.", fit: null });
		assert.deepEqual(m.styleCheck("trend", []), { note: "Pick a reading for this graph.", fit: null });
	});

	it("a reading not in HWiNFO's list is not compared", () => {
		assert.deepEqual(m.styleCheck("compare", [r("a", "A", "°C"), r("b", "Saved reading")]), { note: null, fit: null });
		assert.equal(m.fitStyle("compare", [r("a", "A", "°C"), r("b", "Saved reading")]), null);
	});
});

describe("the slot map and the summary", () => {
	const ctx = { groupId: "g", live: true, conflictColumns: [] as number[] };
	it("names each state and the action a person can take", () => {
		assert.deepEqual(m.slotLine({ column: 0, state: "joined", self: true, groupId: "g" }, ctx), { kind: "joined", text: "Dial 1: in this strip (this dial)", action: null });
		assert.deepEqual(m.slotLine({ column: 2, state: "none", self: false, groupId: null }, ctx), { kind: "missing", text: "Dial 3: no Sensor Dial. Drag one here in the Stream Deck app", action: null });
		assert.equal(m.slotLine({ column: 1, state: "independent", self: false, groupId: null }, ctx).action, "add");
		assert.equal(m.slotLine({ column: 1, state: "independent", self: false, groupId: null }, { ...ctx, live: false, groupId: null }).kind, "independent");
		assert.equal(m.slotLine({ column: 1, state: "dormant", self: false, groupId: "g" }, ctx).action, "rejoin");
		assert.equal(m.slotLine({ column: 1, state: "other", self: false, groupId: "h" }, ctx).action, "move");
		assert.equal(m.slotLine({ column: 3, state: "joined", self: false, groupId: "g" }, { ...ctx, conflictColumns: [3] }).kind, "conflict");
	});

	it("never says the plugin places a dial", () => {
		for (const state of ["joined", "none", "independent", "dormant", "other", "outside"]) {
			const line = m.slotLine({ column: 0, state, self: false, groupId: null }, ctx);
			assert.doesNotMatch(line.text, /automatic|we place|will place|placed for you/i);
		}
	});

	it("summaries name the layout, the dial's place and missing dials", () => {
		const slots = (states: string[]) => states.map((state, column) => ({ column, state, self: column === 1, groupId: "g" }));
		const st = (layout: string, states: string[]) => ({ device: { strip: true, encoders: 4 }, self: { column: 1, joined: true, foreign: null }, group: { config: { layout } }, slots: slots(states) });
		assert.equal(m.summary(st("whole", ["joined", "joined", "joined", "joined"])), "Whole strip · dial 2 of 4");
		assert.equal(m.summary(st("split", ["joined", "joined", "none", "joined"])), "Equal split, left half · dial 2 of 4 · 1 dial missing");
		assert.equal(m.summary({ device: { strip: false } }), "Needs a Stream Deck + or + XL");
		assert.equal(m.summary({ device: { strip: true, encoders: 4 }, self: { joined: false, foreign: null }, group: null, slots: [] }), "Independent dial");
		assert.equal(m.summary(null), "");
	});

	it("pane columns split the strip in two equal halves", () => {
		assert.deepEqual(m.paneColumns("split", 6, 1), [3, 4, 5]);
		assert.deepEqual(m.paneColumns("whole", 4, 0), [0, 1, 2, 3]);
		assert.deepEqual(m.paneColumns("whole", 4, 1), []);
	});
});

describe("the Strip section's Group controls", () => {
	type GroupModel = StripModel & {
		GROUP_SOURCES: string[];
		GROUP_VIEWS: string[];
		GROUP_DRAW_MAX: number;
		GROUP_KEYS_MAX: number;
		NEW_GROUP(): Record<string, unknown>;
		groupRuleOf(raw: unknown): Record<string, unknown> | null;
		groupFilterOf(raw: unknown): string | undefined;
		groupCheck(rule: unknown, count: unknown, fahrenheit: boolean): { note: string | null; tone: string };
	};
	const g = m as GroupModel;

	it("mirrors the plugin's sources, views and bounds", async () => {
		const settings = await import("../src/strip/settings");
		assert.deepEqual(g.GROUP_SOURCES, [...settings.GROUP_SOURCES]);
		assert.deepEqual(g.GROUP_VIEWS, [...settings.GROUP_VIEWS]);
		assert.equal(g.GROUP_DRAW_MAX, settings.GROUP_DRAW_MAX);
		assert.equal(g.GROUP_KEYS_MAX, settings.GROUP_KEYS_MAX);
	});

	it("the View select offers every view the plugin draws, in its order, on both panes", () => {
		const html = readFileSync(fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/sensor-dial.html", import.meta.url)), "utf8");
		for (const id of ["sp0-view", "sp1-view"]) {
			const select = new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`).exec(html)?.[1];
			assert.ok(select !== undefined, `#${id} is in the panel`);
			assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map((x) => x[1]), g.GROUP_VIEWS, id);
		}
	});

	it("a filter as the plugin keeps it (detailFilterOf), so the plugin accepts what the panel sends", async () => {
		const { detailFilterOf } = await import("../src/detail/detail-settings");
		for (const raw of ["", "  ", " | ", "*core*", "  *core*clock* | pump  ", "x".repeat(140), " a|b ", 5]) assert.equal(g.groupFilterOf(raw), detailFilterOf({ detailFilter: raw }), JSON.stringify(raw));
	});

	it("switching a pane to Group sends the style and a whole rule the plugin accepts; each Group control sends one operation", () => {
		const base = baseJsonOf();
		const before = m.workingOf(base);
		const after = clone(before) as Working & { panes: (Pane & { group: unknown })[] };
		after.panes[0].style = "group";
		after.panes[0].group = g.NEW_GROUP();
		const ops = m.diffOps(before, after);
		assert.deepEqual(ops, [
			{ op: "set", path: "panes.0.style", value: "group" },
			{ op: "set", path: "panes.0.group", value: { from: "folder", keys: [], view: "auto" } }
		]);
		const edited = applyStripEdit({ id: "g", rev: 1, config: stripConfigOf(base) }, 1, ops);
		assert.ok(edited.ok, JSON.stringify(edited));
		const shown = m.workingOf(stripConfigToJson(edited.copy.config)) as Working & { panes: (Pane & { group: Record<string, unknown> })[] };
		assert.deepEqual(shown.panes[0].group, { from: "folder", keys: [], view: "auto" });
		const next = clone(shown);
		next.panes[0].group = { ...next.panes[0].group, from: "filter", filter: "*core*clock*", view: "rows", limits: { warn: 85, below: false, unit: "MHz" } };
		const more = m.diffOps(shown, next);
		assert.equal(more.length, 1);
		const again = applyStripEdit({ id: "g", rev: 2, config: edited.copy.config }, 2, more);
		assert.ok(again.ok, JSON.stringify(again));
		assert.deepEqual(again.copy.config.panes[0].group, { from: "filter", filter: "*core*clock*", keys: [], view: "rows", limits: { warn: 85, below: false, unit: "MHz" } });
		// Limits with no number yet stay in the panel and send nothing.
		const waiting = clone(shown);
		waiting.panes[0].group = { ...waiting.panes[0].group, limits: { below: false } };
		assert.deepEqual(m.diffOps(shown, waiting), []);
	});

	it("the count line says what the rule matches, in which unit, how many draw and what is left out", () => {
		const count = (over: Record<string, unknown>) => ({ status: "ok", title: "CPU", unit: "MHz", drawn: 16, sameUnit: 16, otherUnits: 0, ...over });
		assert.deepEqual(g.groupCheck({ from: "folder" }, count({}), false), { note: "16 readings, all in MHz.", tone: "" });
		assert.deepEqual(g.groupCheck({ from: "filter" }, count({ drawn: 32, sameUnit: 48 }), false), { note: "48 readings, all in MHz. The strip graphs the first 32.", tone: "warn" });
		assert.equal(g.groupCheck({ from: "folder" }, count({ drawn: 32, sameUnit: 48, otherUnits: 8 }), false).note, "56 readings: 48 in MHz drawn, 8 in other units left out. The strip graphs the first 32.");
		assert.equal(g.groupCheck({ from: "list" }, count({ unit: "°C", drawn: 3, sameUnit: 3 }), true).note, "3 readings, all in °F.");
		assert.equal(g.groupCheck({ from: "filter" }, count({ status: "no-filter" }), false).note, "Type a filter for this graph.");
		assert.equal(g.groupCheck({ from: "filter" }, count({ status: "empty" }), false).note, "Matches nothing right now.");
		assert.equal(g.groupCheck({ from: "folder" }, null, false).note, null);
		for (const line of [g.groupCheck({ from: "folder" }, count({ drawn: 32, sameUnit: 48, otherUnits: 8 }), false).note ?? ""]) assert.doesNotMatch(line, /—/);
	});
});

describe("Meters and Events in the Graph select", () => {
	type Offer = { offered: boolean; label: string | null };
	type Patterned = {
		OWN_LAYOUT: string[];
		EVENTS_WINDOW: string;
		drawMax(style: string, slots?: number): number;
		styleOffer(style: string, readings: { key: string; label: string; unit?: string }[], ctx?: { bands?: { key: string }[]; slots?: number }): Offer;
		styleCheck(style: string, readings: { key: string; label: string; unit?: string }[], ctx?: { bands?: { key: string }[]; slots?: number }): { note: string | null; fit: string | null };
		seriesRows(style: string, readings: { key: string; label: string; unit?: string }[], ctx?: { bands?: { key: string }[]; slots?: number }): { drawn: boolean; reason: string | null }[];
	};
	const p = m as unknown as Patterned;
	const cpuTemp = { key: "t", label: "CPU Package", unit: "°C" };
	const power = { key: "w", label: "CPU Package Power", unit: "W" };
	const htc = { key: "h", label: "Thermal Throttling (HTC)", unit: "Yes/No" };

	it("own layout: Meters and Events; Events starts on 15 minutes", () => {
		assert.deepEqual(p.OWN_LAYOUT, ["meters", "events"]);
		assert.equal(p.EVENTS_WINDOW, "15m");
	});

	it("Meters takes one reading per dial slot of its pane", () => {
		const six = Array.from({ length: 6 }, (_, i) => ({ ...power, key: `w${i}` }));
		assert.equal(p.drawMax("meters", 6), 6);
		assert.equal(p.drawMax("meters", 2), 2);
		assert.deepEqual(p.styleOffer("meters", six, { slots: 6 }), { offered: true, label: null });
		assert.deepEqual(p.styleOffer("meters", six, { slots: 3 }), { offered: false, label: null });
		assert.deepEqual(p.seriesRows("meters", six.slice(0, 3), { slots: 2 }).map((r) => r.reason), [null, null, "limit"]);
		assert.deepEqual(p.styleCheck("meters", six.slice(0, 3), { slots: 2 }), { note: null, fit: null }, "the third row says it is not drawn; the line does not say it again");
	});

	it("Events is offered for Yes/No readings and readings with a band, and says why otherwise", () => {
		assert.deepEqual(p.styleOffer("events", [htc]), { offered: true, label: null });
		assert.deepEqual(p.styleOffer("events", [htc, cpuTemp]), { offered: false, label: "limits" });
		assert.deepEqual(p.styleOffer("events", [htc, cpuTemp], { bands: [{ key: "t" }] }), { offered: true, label: null });
		assert.match(p.styleCheck("events", [htc, cpuTemp]).note ?? "", /^Events marks Yes\/No readings and readings with an alert band: CPU Package has none\.$/);
		assert.equal(p.styleOffer("group", [cpuTemp, power, htc, cpuTemp, power]).offered, true, "Group draws a rule");
	});

	it("a switch to a new style is one accepted edit, and so is six readings", () => {
		const base = baseJsonOf();
		const w = m.workingOf(base);
		w.panes[0].style = "meters";
		w.panes[0].series = Array.from({ length: 6 }, (_, i) => ({ key: `k${i}` }));
		const ops = m.patchOf(base, w);
		const result = applyStripEdit({ id: "0123456789abcdef0123456789abcdef", rev: 1, config: stripConfigOf(base) }, 1, ops as never);
		assert.ok(result.ok);
		assert.equal(result.copy.config.panes[0].style, "meters");
		assert.equal(result.copy.config.panes[0].series.length, 6);
	});
});

// --- Screens ------------------------------------------------------------------
type Screen = { id: string; index: number; name: string; autoName: string; style: string };
type Op = { op: string; path?: string; value?: unknown; at?: number; from?: unknown; to?: number };
type Count = { status: string; title: string; unit: string; drawn: number; sameUnit: number; otherUnits: number; units?: number };
type TreeGroup = { name: string; matchName?: string; readings: { key: string; keys?: string[]; label: string; unit: string; value?: number }[] };
type ScreenWorking = Working & { screen: number; screenCycle: number };
type Screens = Omit<StripModel, "workingOf" | "diffOps"> & {
	MAX_SCREENS: number;
	SCREEN_CYCLES: number[];
	SCREEN_NAME_MAX: number;
	SCREEN_LABEL_MAX: number;
	FILTER_EXAMPLES: string[];
	workingOf(config: unknown, options?: { screen?: number }): ScreenWorking;
	diffOps(before: Working, after: Working, options?: { layout?: boolean }): Op[];
	screenCycleOf(raw: unknown): number;
	screenPrefix(index: number): string;
	screenPathOf(path: unknown): { index: number; field: string } | null;
	screensOf(st: unknown): { list: Screen[]; currentId: string | null; current: number; cycle: number; held: boolean } | null;
	screenListOf(config: unknown, reported?: Screen[]): Screen[];
	screenIndexOf(list: Screen[], id: string): number;
	autoName(pane: unknown, ctx?: { readingOf?: (key: string) => { label: string; source: string; found: boolean }; fahrenheit?: boolean }): string;
	screenLabel(text: unknown): string;
	screenNameOf(screen: Screen, pane: unknown, ctx?: { readingOf?: (key: string) => { label: string; source: string; found: boolean } }): string;
	addScreenOp(current: number, count: number): Op | null;
	removeScreenOp(index: number, count: number): Op | null;
	moveScreenOp(from: number, to: number, count: number): Op | null;
	renameScreenOp(index: number, name: unknown): Op;
	afterRemove(list: Screen[], index: number): string | null;
	retargetOp(op: Op, index: number): Op;
	filterReport(filter: unknown, groups: unknown, options?: { style?: string }): { count: Count; alternatives: { text: string; count: number }[] };
	filterCheck(rule: unknown, count: unknown, alternatives: unknown, fahrenheit: boolean, style?: string): { note: string | null; tone: string };
	filterExamples(groups: unknown, options?: { max?: number }): string[];
};
const s = m as unknown as Screens;

// The plugin side of Screens lands in its own lane: where it already
// exports its bounds or accepts the structural operations, the panel is
// held to it; until then those checks are skipped and say why.
const pluginSettings = stripSettings as unknown as Record<string, unknown>;
const screensBase = (): ReturnType<typeof newStripConfig> => newStripConfig("whole", 4, stripSeedOf({ readingKey: GPU_TEMP }));
const pluginTakesScreens = applyStripEdit({ id: "p", rev: 1, config: screensBase() }, 1, [{ op: "addScreen", at: 1, from: "group" }], { deviceEncoders: 4 }).ok;
const NO_PLUGIN_SCREENS = pluginTakesScreens ? false : "the plugin side takes no screen operations yet (the runtime lane)";

/** A stored config with three screens: CPU temps (Trend), a filter Group
 * and a folder Group, each with its own id and only the first named. */
function threeScreens(): Record<string, unknown> {
	const json = stripConfigToJson(screensBase()) as Record<string, unknown>;
	const panes = json.panes as Record<string, unknown>[];
	return {
		...json,
		panes: [{ ...panes[0], screenId: "0000000a", name: "CPU temps" }, panes[1]],
		screens: [
			{ screenId: "0000000b", style: "group", series: [], group: { from: "filter", filter: "*core*clock*", keys: [], view: "auto" } },
			{ screenId: "0000000c", style: "group", series: [{ key: CPU_TEMP }], group: { from: "folder", keys: [], view: "auto" } }
		],
		screenCycle: 30
	};
}

describe("Meters' Look in the panel", () => {
	type Looks = { METER_LOOKS: string[]; scaleShown(style: string, readout: string | undefined, units: readonly string[], look?: string): string };
	const p = m as unknown as Looks;
	const meters = (look?: string): Record<string, unknown> => ({ ...baseJsonOf(), panes: [{ style: "meters", series: [{ key: "k0" }], ...(look === undefined ? {} : { meterLook: look }) }, {}] });

	it("Thin bar, Full bar and Liquid; a pane with none, or one this panel does not know (a 1.8 preview's flat included), is Thin bar", () => {
		assert.deepEqual(p.METER_LOOKS, ["thin", "full", "liquid"]);
		assert.equal((m.workingOf(meters()).panes[0] as Pane & { look?: string }).look, "thin");
		for (const unknown of ["cells", "flat"]) {
			assert.equal((m.workingOf(meters(unknown)).panes[0] as Pane & { look?: string }).look, "thin", unknown);
			assert.deepEqual(m.patchOf(meters(unknown), m.workingOf(meters(unknown))), [], `${unknown}: opening sends nothing, so the stored value stays`);
		}
		for (const look of ["full", "liquid"]) assert.equal((m.workingOf(meters(look)).panes[0] as Pane & { look?: string }).look, look);
	});

	it("a pick is one operation the plugin accepts, and opening sends none", () => {
		for (const look of ["full", "liquid"]) {
			const base = meters();
			assert.deepEqual(m.patchOf(base, m.workingOf(base)), [], "opening");
			const w = m.workingOf(base);
			(w.panes[0] as Pane & { look?: string }).look = look;
			const ops = m.patchOf(base, w);
			assert.deepEqual(ops, [{ op: "set", path: "panes.0.meterLook", value: look }]);
			const result = applyStripEdit({ id: "0123456789abcdef0123456789abcdef", rev: 1, config: stripConfigOf(base) }, 1, ops as never);
			assert.ok(result.ok);
			if (!result.ok) continue;
			const json = stripConfigToJson(result.copy.config);
			assert.equal((json.panes as unknown as Record<string, unknown>[])[0]?.meterLook, look);
			assert.deepEqual(m.workingOf(json), w, "the panel reads back what it sent");
			const back = m.workingOf(json);
			(back.panes[0] as Pane & { look?: string }).look = "thin";
			assert.deepEqual(m.patchOf(json, back), [{ op: "set", path: "panes.0.meterLook", value: "thin" }]);
		}
	});

	it("a percentage on Full bar or Liquid keeps 0 to 100: Scale from and Scale to go; another unit keeps them", () => {
		for (const look of ["full", "liquid"]) {
			assert.equal(p.scaleShown("meters", "off", ["%"], look), "none", look);
			assert.equal(p.scaleShown("meters", "off", ["%", "Yes/No"], look), "none", `${look}: a Yes/No beside it`);
			assert.equal(p.scaleShown("meters", "off", ["%", "RPM"], look), "both", `${look}: a fan beside it`);
		}
		// The strip page says so: the fields go only for a pane of percentages (or Yes/No).
		const page = readFileSync(fileURLToPath(new URL("../docs/strip-display.md", import.meta.url)), "utf8");
		assert.doesNotMatch(page, /A percentage always runs from 0 to 100, so \*\*Scale from\*\* and \*\*Scale to\*\* go/);
		assert.match(page, /A percentage always runs from 0 to 100, whatever \*\*Scale from\*\* and \*\*Scale to\*\* say: when every reading in the pane is a percentage or Yes\/No, the two fields go, and beside a reading in another unit they stay for that reading\./);
		assert.equal(p.scaleShown("meters", "off", ["%"], "thin"), "both");
		assert.equal(p.scaleShown("meters", "off", ["%"], "flat"), "both", "a Look this panel does not know is Thin bar, which keeps them");
		assert.equal(p.scaleShown("meters", "off", ["%"]), "both");
		assert.equal(p.scaleShown("trend", "off", ["%"], "liquid"), "both", "only Meters reads the Look");
	});
});

describe("Screens: the list, the screen on the strip and the cycle", () => {
	it("keeps the design's bounds, and the plugin's own where it exports them", () => {
		assert.equal(s.MAX_SCREENS, 8);
		assert.deepEqual(s.SCREEN_CYCLES, [10, 30, 60, 300]);
		assert.equal(s.SCREEN_NAME_MAX, MAX_NAME_LENGTH, "a name is capped like a series name");
		assert.equal(s.SCREEN_LABEL_MAX, 24);
		if (typeof pluginSettings.MAX_SCREENS === "number") assert.equal(s.MAX_SCREENS, pluginSettings.MAX_SCREENS);
		if (Array.isArray(pluginSettings.SCREEN_CYCLES)) assert.deepEqual(s.SCREEN_CYCLES, [...(pluginSettings.SCREEN_CYCLES as number[])]);
		for (const [raw, cycle] of [[10, 10], [30, 30], [60, 60], [300, 300], [0, 0], [15, 0], ["30", 0], [null, 0], [undefined, 0], [-30, 0]] as const) assert.equal(s.screenCycleOf(raw), cycle, String(raw));
	});

	it("a state with no list beside a group offers no screens", () => {
		assert.equal(s.screensOf({ event: "stripState", group: { config: {}, rev: 1 } }), null);
		assert.equal(s.screensOf(null), null);
		assert.equal(s.screensOf({ group: null }), null);
	});

	it("reads the plugin's list in order, the screen on the strip, the cycle and the hold, beside the group", () => {
		const reported = [
			{ screenId: "0000000c", name: "", autoName: "CPU [#0]: Example", style: "group", index: 2 },
			{ screenId: "0000000a", name: "CPU temps", autoName: "CPU (Tctl/Tdie) +1", style: "trend", index: 0 },
			{ screenId: "0000000b", name: "", autoName: "*core*clock*", style: "group", index: 1 },
			{ screenId: "0000000b", name: "twice", autoName: "", style: "trend", index: 3 },
			{ screenId: 7, index: 4 },
			"junk"
		];
		const fromGroup = s.screensOf({ group: { screens: reported, screen: "0000000b", screenCycle: 30, cycleHeld: true } });
		assert.deepEqual(
			fromGroup?.list.map((x) => [x.id, x.index, x.name, x.autoName, x.style]),
			[
				["0000000a", 0, "CPU temps", "CPU (Tctl/Tdie) +1", "trend"],
				["0000000b", 1, "", "*core*clock*", "group"],
				["0000000c", 2, "", "CPU [#0]: Example", "group"]
			],
			"sorted by place, one entry per id, junk dropped"
		);
		assert.equal(fromGroup?.currentId, "0000000b");
		assert.equal(fromGroup?.current, 1);
		assert.equal(fromGroup?.cycle, 30);
		assert.equal(fromGroup?.held, true);
		const top = s.screensOf({ group: { config: {}, screens: reported.slice(0, 3), screen: "nope", screenCycle: 45 } });
		assert.equal(top?.currentId, "0000000a", "an unknown screen on the strip reads as the first");
		assert.equal(top?.cycle, 0, "a cycle outside the four is By hand");
		assert.equal(top?.held, false);
		assert.deepEqual(s.screensOf({ group: { screens: [] } }), { list: [], currentId: null, current: 0, cycle: 0, held: false });
	});

	it("the config is the truth for what exists and where; the plugin lends automatic names and an id the config lacks", () => {
		const config = threeScreens();
		const reported = s.screensOf({ group: { screens: [{ screenId: "0000000b", autoName: "*core*clock*", index: 2 }, { screenId: "0000000a", autoName: "CPU (Tctl/Tdie)", index: 0 }] } })?.list ?? [];
		const list = s.screenListOf(config, reported);
		assert.deepEqual(
			list.map((x) => [x.id, x.index, x.name, x.autoName, x.style]),
			[
				["0000000a", 0, "CPU temps", "CPU (Tctl/Tdie)", "trend"],
				["0000000b", 1, "", "*core*clock*", "group"],
				["0000000c", 2, "", "", "group"]
			]
		);
		assert.equal(s.screenIndexOf(list, "0000000c"), 2);
		assert.equal(s.screenIndexOf(list, "gone"), -1);
		// A strip saved before screens: no id stored, the plugin names it.
		const plain = stripConfigToJson(screensBase());
		assert.deepEqual(s.screenListOf(plain, [{ id: "@0", index: 0, name: "", autoName: "GPU Temperature", style: "trend" }]).map((x) => [x.id, x.autoName]), [["@0", "GPU Temperature"]]);
		assert.deepEqual(s.screenListOf(plain).map((x) => x.id), ["@0"]);
		// Never more than eight.
		const many = { ...config, screens: Array.from({ length: 12 }, (_, i) => ({ screenId: `1000000${i.toString(16)}`, style: "trend", series: [] })) };
		assert.equal(s.screenListOf(many).length, 8);
	});
});

describe("Screens: the box edits the screen on the strip", () => {
	it("Brief gaps set from a later screen is the strip's: one edit, and every screen shows it", () => {
		const config = threeScreens();
		const second = s.workingOf(config, { screen: 1 });
		const after = clone(second);
		after.gapMode = "mark";
		const patch = s.diffOps(second, after);
		assert.deepEqual(patch, [{ op: "set", path: "gapMode", value: "mark" }]);
		const result = applyStripEdit({ id: "x", rev: 3, config: stripConfigOf(config) }, 3, patch);
		assert.ok(result.ok);
		const json = stripConfigToJson(result.copy.config);
		for (const screen of [0, 1, 2]) assert.equal(s.workingOf(json, { screen }).gapMode, "mark");
	});

	it("the screen's pane stands in pane 0, and its edits go to its own path", () => {
		const config = threeScreens();
		const second = s.workingOf(config, { screen: 1 });
		assert.equal(second.screen, 1);
		assert.equal(second.panes[0].style, "group");
		assert.equal(second.screenCycle, 30);
		assert.deepEqual(second.panes[0].group, { from: "filter", filter: "*core*clock*", keys: [], view: "auto" });
		const after = clone(second);
		after.panes[0].group = { ...(after.panes[0].group as Record<string, unknown>), filter: "*core*clock*|*l3 cahce*" };
		after.panes[0].overlays.minmax = true;
		assert.deepEqual(s.diffOps(second, after), [
			{ op: "set", path: "screens.0.overlays.minmax", value: true },
			{ op: "set", path: "screens.0.group", value: { from: "filter", filter: "*core*clock*|*l3 cahce*", keys: [], view: "auto" } }
		]);
		const first = s.workingOf(config);
		assert.equal(first.screen, 0);
		const firstAfter = clone(first);
		firstAfter.panes[0].style = "area";
		assert.deepEqual(s.diffOps(first, firstAfter), [{ op: "set", path: "panes.0.style", value: "area" }], "the first screen is panes.0, as before screens");
		const third = s.workingOf(config, { screen: 2 });
		const thirdAfter = clone(third);
		thirdAfter.panes[0].series = [];
		assert.deepEqual(s.diffOps(third, thirdAfter).map((op) => op.path), ["screens.1.series"]);
		assert.equal(s.workingOf(config, { screen: 7 }).screen, 0, "a screen the config does not hold is the first");
		assert.equal(s.workingOf(config, { screen: -1 }).screen, 0);
	});

	it("Next screen is one operation: a cycle in seconds, or null for By hand", () => {
		const shown = s.workingOf(stripConfigToJson(screensBase()));
		assert.equal(shown.screenCycle, 0);
		const timed = clone(shown);
		timed.screenCycle = 30;
		assert.deepEqual(s.diffOps(shown, timed), [{ op: "set", path: "screenCycle", value: 30 }]);
		assert.deepEqual(s.diffOps(timed, shown), [{ op: "set", path: "screenCycle", value: null }]);
	});

	it("an operation made for one screen goes to wherever that screen sits when it is sent", () => {
		assert.equal(s.screenPrefix(0), "panes.0");
		assert.equal(s.screenPrefix(1), "screens.0");
		assert.equal(s.screenPrefix(7), "screens.6");
		assert.deepEqual(s.screenPathOf("screens.3.overlays.minmax"), { index: 4, field: "overlays.minmax" });
		assert.deepEqual(s.screenPathOf("panes.0.name"), { index: 0, field: "name" });
		for (const path of ["panes.1.style", "window", "screenCycle", "screens.x.style", 5]) assert.equal(s.screenPathOf(path), null, String(path));
		assert.deepEqual(s.retargetOp({ op: "set", path: "screens.0.group", value: 1 }, 3), { op: "set", path: "screens.2.group", value: 1 });
		assert.deepEqual(s.retargetOp({ op: "set", path: "screens.4.name", value: "x" }, 0), { op: "set", path: "panes.0.name", value: "x" });
		assert.deepEqual(s.retargetOp({ op: "set", path: "panes.0.scale.min", value: 2 }, 2), { op: "set", path: "screens.1.scale.min", value: 2 });
		const window = { op: "set", path: "window", value: "1m" };
		assert.equal(s.retargetOp(window, 5), window, "an operation outside every screen goes as it is");
	});
});

describe("Screens: Add, Remove, Earlier and Later, Rename", () => {
	it("Add puts a Group over a filter still to type right after the screen on the strip, up to eight", () => {
		assert.deepEqual(s.addScreenOp(0, 1), { op: "addScreen", at: 1, from: "group" });
		assert.deepEqual(s.addScreenOp(2, 4), { op: "addScreen", at: 3, from: "group" });
		assert.deepEqual(s.addScreenOp(6, 7), { op: "addScreen", at: 7, from: "group" });
		assert.equal(s.addScreenOp(3, 8), null, "eight is the most a strip keeps");
		assert.deepEqual(s.addScreenOp(-1, 3), { op: "addScreen", at: 3, from: "group" }, "no screen on the strip known: at the end");
		assert.deepEqual(s.addScreenOp(0, 0), { op: "addScreen", at: 1, from: "group" });
	});

	it("Remove takes the screen on the strip, never the last one; the next screen shows, else the one before", () => {
		assert.deepEqual(s.removeScreenOp(1, 3), { op: "removeScreen", at: 1 });
		assert.deepEqual(s.removeScreenOp(0, 2), { op: "removeScreen", at: 0 });
		assert.equal(s.removeScreenOp(0, 1), null);
		assert.equal(s.removeScreenOp(3, 3), null);
		const list = s.screenListOf(threeScreens());
		assert.equal(s.afterRemove(list, 0), "0000000b");
		assert.equal(s.afterRemove(list, 1), "0000000c");
		assert.equal(s.afterRemove(list, 2), "0000000b");
		assert.equal(s.afterRemove(list.slice(0, 1), 0), null);
	});

	it("Earlier and Later move by one, the ends clamp, and a move that stays sends nothing", () => {
		assert.deepEqual(s.moveScreenOp(1, 0, 3), { op: "moveScreen", from: 1, to: 0 });
		assert.deepEqual(s.moveScreenOp(1, 2, 3), { op: "moveScreen", from: 1, to: 2 });
		assert.equal(s.moveScreenOp(0, -1, 3), null, "the first cannot go earlier");
		assert.equal(s.moveScreenOp(2, 3, 3), null, "the last cannot go later");
		assert.deepEqual(s.moveScreenOp(2, 0, 3), { op: "moveScreen", from: 2, to: 0 }, "Alt+Home");
		assert.deepEqual(s.moveScreenOp(0, 99, 3), { op: "moveScreen", from: 0, to: 2 }, "Alt+End clamps to the last place");
		assert.equal(s.moveScreenOp(5, 4, 3), null);
	});

	it("Rename sends the trimmed name for the screen's own path; empty returns the automatic name", () => {
		assert.deepEqual(s.renameScreenOp(0, "  Core clocks "), { op: "set", path: "panes.0.name", value: "Core clocks" });
		assert.deepEqual(s.renameScreenOp(2, ""), { op: "set", path: "screens.1.name", value: "" });
		assert.equal((s.renameScreenOp(1, "x".repeat(90)).value as string).length, MAX_NAME_LENGTH);
		assert.deepEqual(s.renameScreenOp(1, null), { op: "set", path: "screens.0.name", value: "" });
	});

	it("the operations are the ones the plugin accepts, and land where the panel aimed them", { skip: NO_PLUGIN_SCREENS }, () => {
		let config = screensBase();
		let rev = 1;
		const apply = (patch: Op[]): void => {
			const r = applyStripEdit({ id: "p", rev, config }, rev, patch, { deviceEncoders: 4 });
			assert.ok(r.ok, JSON.stringify(r));
			config = r.copy.config;
			rev = r.copy.rev;
		};
		const listNow = (): Screen[] => s.screenListOf(stripConfigToJson(config));
		apply([s.addScreenOp(0, 1) as Op]);
		assert.equal(listNow().length, 2);
		const added = s.workingOf(stripConfigToJson(config), { screen: 1 });
		assert.equal(added.panes[0].style, "group", "a new screen is a Group");
		assert.equal((added.panes[0].group as Record<string, unknown>)?.from, "filter", "over a filter");
		assert.equal((added.panes[0].group as Record<string, unknown>)?.filter, undefined, "still to type");
		const typed = clone(added);
		typed.panes[0].group = { ...(typed.panes[0].group as Record<string, unknown>), filter: "*core*clock*" };
		apply(s.diffOps(added, typed));
		apply([s.renameScreenOp(1, "Core clocks")]);
		const id = listNow()[1]?.id ?? "";
		apply([s.moveScreenOp(1, 0, 2) as Op]);
		assert.equal(s.screenIndexOf(listNow(), id), 0, "the moved screen keeps its id");
		assert.equal(listNow()[0]?.name, "Core clocks");
		assert.equal(s.workingOf(stripConfigToJson(config)).panes[0].group?.filter, "*core*clock*");
		apply([s.removeScreenOp(1, 2) as Op]);
		assert.deepEqual(listNow().map((x) => x.id), [id]);
		const json = stripConfigToJson(config) as Record<string, unknown>;
		assert.equal(json.screens === undefined || (Array.isArray(json.screens) && json.screens.length === 0), true);
	});
});

describe("Screens: names", () => {
	const readings: Record<string, { label: string; source: string; found: boolean }> = {
		[CPU_TEMP]: { label: "CPU (Tctl/Tdie)", source: "CPU [#0]: Example 16-Core Processor: Enhanced", found: true },
		[GPU_TEMP]: { label: "GPU Temperature", source: "GPU [#0]: Example Graphics 24GB", found: true },
		"gone:0:1": { label: "gone:0:1", source: "", found: false }
	};
	const ctx = { readingOf: (key: string) => readings[key] ?? { label: key, source: "", found: false } };

	it("an automatic name: a filter as typed, a folder's name, Every and a unit, the first ticked reading plus how many more", () => {
		assert.equal(s.autoName({ style: "group", group: { from: "filter", filter: "*core*clock* | *gpu*temp*", keys: [] } }, ctx), "*core*clock* | *gpu*temp*");
		assert.equal(s.autoName({ style: "group", series: [{ key: CPU_TEMP }], group: { from: "folder", keys: [] } }, ctx), "CPU [#0]: Example 16-Core Processor: Enhanced");
		assert.equal(s.autoName({ style: "group", series: [{ key: CPU_TEMP }] }, ctx), "CPU [#0]: Example 16-Core Processor: Enhanced", "a Group with no rule draws its folder");
		assert.equal(s.autoName({ style: "group", group: { from: "unit", unit: "MHz", keys: [] } }, ctx), "Every MHz");
		assert.equal(s.autoName({ style: "ambient", group: { from: "unit", unit: "°C", keys: [] } }, { ...ctx, fahrenheit: true }), "Every °F");
		assert.equal(s.autoName({ style: "ambient" }, ctx), "Every °C", "an Ambient with no rule takes every temperature");
		assert.equal(s.autoName({ style: "group", group: { from: "list", keys: [GPU_TEMP, CPU_TEMP, "x"] } }, ctx), "GPU Temperature +2");
		assert.equal(s.autoName({ style: "trend", series: [{ key: CPU_TEMP }, { key: GPU_TEMP }] }, ctx), "CPU (Tctl/Tdie) +1");
		assert.equal(s.autoName({ style: "heat", series: [{ key: GPU_TEMP }] }, ctx), "GPU Temperature");
		assert.equal(s.autoName({ style: "trend", series: [{ key: "gone:0:1" }] }, ctx), "", "a reading HWiNFO does not list names nothing");
		assert.equal(s.autoName({ style: "group", group: { from: "filter", keys: [] } }, ctx), "", "an empty filter names nothing yet");
		assert.equal(s.autoName({ style: "trend", series: [] }, ctx), "");
	});

	it("a ticked screen counts the readings its style draws, and a reading's own name leads", () => {
		assert.equal(s.autoName({ style: "heat", series: [{ key: GPU_TEMP }, { key: CPU_TEMP }] }, ctx), "GPU Temperature", "Heat draws one: no +1");
		assert.equal(s.autoName({ style: "trend", series: [{ key: CPU_TEMP, name: "Package" }, { key: GPU_TEMP }] }, ctx), "Package +1");
		assert.equal(s.autoName({ style: "trend", series: [{ key: "gone:0:1", name: "Kept" }] }, ctx), "Kept", "a reading's own name needs no list");
	});

	it("a screen shows its own name, else the panel's from the copy it shows, else the plugin's, else its place", () => {
		const screen = (over: Partial<Screen>): Screen => ({ id: "x", index: 2, name: "", autoName: "", style: "trend", ...over });
		const pane = { style: "trend", series: [{ key: GPU_TEMP }] };
		assert.equal(s.screenNameOf(screen({ name: "Mine", autoName: "Plugin's" }), pane, ctx), "Mine");
		// The deck (2026-10-26): the chips said Screen 1 and Screen 2 while
		// the box showed GPU Temperature ticked. The copy the box shows names
		// its screen, whatever name the plugin reported last.
		assert.equal(s.screenNameOf(screen({ autoName: "" }), pane, ctx), "GPU Temperature");
		assert.equal(s.screenNameOf(screen({ autoName: "An older name" }), pane, ctx), "GPU Temperature");
		assert.equal(s.screenNameOf(screen({ autoName: "GPU Temperature" }), { style: "trend", series: [{ key: "gone:0:1" }] }, ctx), "GPU Temperature", "a reading HWiNFO no longer lists keeps the plugin's remembered name");
		assert.equal(s.screenNameOf(screen({}), { style: "group", group: { from: "filter", keys: [] } }, ctx), "Screen 3");
	});

	it("a chip shows whole words up to 24 characters", () => {
		assert.equal(s.screenLabel("Core clocks"), "Core clocks");
		assert.equal(s.screenLabel("  CPU   temps  "), "CPU temps");
		assert.equal(s.screenLabel("x".repeat(24)), "x".repeat(24));
		assert.equal(s.screenLabel("CPU [#0]: Example 16-Core Processor: Enhanced"), "CPU [#0]: Example…");
		assert.equal(s.screenLabel("*effective clock*|*clock (perf*"), "*effective clock*…");
		assert.equal(s.screenLabel("Supercalifragilisticexpialidocious"), "Supercalifragilisticexp…", "one long word is cut, not dropped");
		assert.equal(s.screenLabel("Virtual Memory Committed +2"), "Virtual Memory… +2", "an automatic name keeps its count when it is cut");
		assert.equal(s.screenLabel("Core 0 T0 Effective Clock +15"), "Core 0 T0 Effective… +15");
		for (const text of ["CPU [#0]: Example 16-Core Processor: Enhanced", "a b c d e f g h i j k l m n o p q"]) assert.ok(s.screenLabel(text).length <= s.SCREEN_LABEL_MAX, text);
		assert.equal(s.screenLabel(undefined), "");
	});
});

/** A sensor list on the pattern of an AMD CPU and an NVIDIA GPU (the
 * owner's PC census names) and a Yes/No flag: the same
 * snapshot feeds the plugin's resolver and, through the plugin's own tree
 * builder, the panel. */
function censusSnapshot(): SensorSnapshot {
	const sensors: SensorSource[] = [
		{ index: 0, id: 0xf0000300, instance: 0, name: "CPU [#0]: AMD Ryzen 9 9950X3D: Enhanced" },
		{ index: 1, id: 0xf7006687, instance: 0, name: "MSI MAG X870E (MS-7E49) (Nuvoton NCT6687D)" },
		{ index: 2, id: 0xe0002000, instance: 0, name: "dGPU [#0]: NVIDIA GeForce RTX 5080" },
		{ index: 3, id: 0xf0000301, instance: 0, name: "CPU [#0]: AMD Ryzen 9 9950X3D: Performance Limit Reasons" }
	];
	const rows: [number, string, string, SensorType][] = [
		[0, "Core0 (CCD1)", "°C", SensorType.Temperature],
		[0, "Core1 (CCD1)", "°C", SensorType.Temperature],
		[0, "Core8 (CCD2)", "°C", SensorType.Temperature],
		[0, "CPU (Tctl/Tdie)", "°C", SensorType.Temperature],
		[0, "CPU CCD1 (Tdie)", "°C", SensorType.Temperature],
		[0, "CPU CCD2 (Tdie)", "°C", SensorType.Temperature],
		[0, "Core 0 Clock (perf #2/3)", "MHz", SensorType.Clock],
		[0, "Core 1 Clock (perf #1/2)", "MHz", SensorType.Clock],
		[0, "Core 0 T0 Effective Clock", "MHz", SensorType.Clock],
		[0, "L3 Cache (CCD1)", "MHz", SensorType.Clock],
		[0, "CPU Package Power", "W", SensorType.Power],
		[1, "CPU", "°C", SensorType.Temperature],
		[1, "VRM MOS", "°C", SensorType.Temperature],
		[1, "CPU Fan", "RPM", SensorType.Fan],
		[1, "Pump Fan", "RPM", SensorType.Fan],
		[1, "System 1", "RPM", SensorType.Fan],
		[2, "GPU Temperature", "°C", SensorType.Temperature],
		[2, "GPU Memory Junction Temperature", "°C", SensorType.Temperature],
		[2, "GPU Clock", "MHz", SensorType.Clock],
		[2, "GPU Fan1", "RPM", SensorType.Fan],
		[2, "GPU Fan1", "%", SensorType.Usage],
		[2, "GPU Memory Allocated", "MB", SensorType.Other],
		[3, "Thermal Throttling (HTC)", "Yes/No", SensorType.Other],
		[3, "Thermal Throttling (PROCHOT CPU)", "Yes/No", SensorType.Other]
	];
	const readings: Reading[] = rows.map(([sensorIndex, label, unit, type], i) => ({
		key: `${(sensors[sensorIndex] as SensorSource).id.toString(16)}:0:${(0x1000000 + i).toString(16)}`,
		label,
		unit,
		type,
		sensorIndex,
		id: i,
		value: unit === "Yes/No" ? 0 : 40 + i,
		valueMin: 0,
		valueMax: 100,
		valueAvg: 50
	}));
	return { pollTime: 1, valueRevision: 1, version: 1, revision: 1, sensors, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

describe("the field that names a pane's readings", () => {
	const m2 = m as unknown as StripModel;
	it("is Filter or Unit under those rules, which take no picker, and the picker otherwise", () => {
		const of = (raw: Record<string, unknown>): string => m2.readingsFieldOf(m2.paneOf(raw));
		assert.equal(of({ style: "trend", series: [{ key: "a" }] }), "picker");
		assert.equal(of({ style: "meters", series: [] }), "picker");
		assert.equal(of({ style: "group", group: { from: "filter", filter: "*gpu*", keys: [], view: "auto" } }), "filter");
		assert.equal(of({ style: "group", group: { from: "unit", unit: "RPM", keys: [], view: "auto" } }), "unit");
		assert.equal(of({ style: "ambient", group: { from: "unit", unit: "°C", keys: [], view: "auto" } }), "unit");
		assert.equal(of({ style: "group", group: { from: "list", keys: ["a"], view: "auto" } }), "picker");
		assert.equal(of({ style: "group", series: [{ key: "a" }] }), "picker", "a Group with no rule yet takes a folder's reading");
		assert.equal(of({ style: "ambient", series: [] }), "unit", "an Ambient with no rule yet reads a unit");
	});
});

describe("Choosing Events starts on 15 minutes where nothing else shares the window", () => {
	const m2 = m as unknown as StripModel;
	const shape = (layout: string, sharedWindow = true): { layout: string; sharedWindow: boolean; window: string; panes: { window?: string }[] } => ({ layout, sharedWindow, window: "5m", panes: [{}, {}] });

	it("a Whole strip of one screen: the strip's window", () => {
		const w = shape("whole");
		m2.startEvents(w, w.panes[0], 1);
		assert.equal(w.window, "15m");
	});
	it("a Whole strip of several screens keeps the window every screen saved", () => {
		const w = shape("whole");
		m2.startEvents(w, w.panes[0], 2);
		assert.equal(w.window, "5m");
		assert.equal(w.panes[0]?.window, undefined);
	});
	it("a split with windows of its own: that half's", () => {
		const w = shape("split", false);
		m2.startEvents(w, w.panes[1], 1);
		assert.deepEqual([w.window, w.panes[0]?.window, w.panes[1]?.window], ["5m", undefined, "15m"]);
	});
	it("a split sharing its window keeps it", () => {
		const w = shape("split");
		m2.startEvents(w, w.panes[1], 1);
		assert.deepEqual([w.window, w.panes[1]?.window], ["5m", undefined]);
	});
});

describe("The Scale and alerts fold's line", () => {
	const m2 = m as unknown as StripModel;
	const pane = (fields: Record<string, unknown>): unknown => m2.paneOf({ style: "trend", series: [{ key: "a" }], ...fields });

	it("says nothing with no limit set, and a band waiting for its first number is not set yet", () => {
		assert.equal(m2.alertBandsLine([pane({})]), "");
		assert.equal(m2.alertBandsLine([pane({ bands: [{ key: "a", below: false }] })]), "");
	});

	it("counts a band with a limit, on either half, and a Group's limits as one", () => {
		assert.equal(m2.alertBandsLine([pane({ bands: [{ key: "a", warn: 70 }] })]), "1 alert band");
		assert.equal(m2.alertBandsLine([pane({ bands: [{ key: "a", crit: 85 }, { key: "a", warn: 70 }] })]), "2 alert bands");
		assert.equal(m2.alertBandsLine([pane({ bands: [{ key: "a", warn: 70 }] }), pane({ bands: [{ key: "a", warn: 1 }] })]), "2 alert bands");
		const group = m2.paneOf({ style: "group", series: [], group: { from: "folder", keys: [], view: "auto", limits: { warn: 70, below: false } } });
		assert.equal(m2.alertBandsLine([group]), "1 alert band");
		const waiting = m2.paneOf({ style: "group", series: [], group: { from: "folder", keys: [], view: "auto" } });
		assert.equal(m2.alertBandsLine([waiting]), "");
	});
});

describe("Screens: the Filter field's count slot", () => {
	const snapshot = censusSnapshot();
	const groups = buildSensorTree({ state: "ok", snapshot, source: "shared-memory" }).groups as unknown as TreeGroup[];

	it("the panel's matcher answers exactly as the plugin's, union and anchoring included", () => {
		const patterns = ["*core*clock*", "core", "CORE 0", "*core*clock*|*gpu*temp*", " *ccd*tdie* | | *l3 cahce* ", "GPU*temp*", "*gpu*temp*", "*core ? clock*|*core ?? clock*", "?PU*", "*(ccd?)", "*fan1", "Fan1", "s.m.a.r.t.*", "*Ä*", "a*b", "*", "?", "|x|"];
		const candidates = groups.flatMap((g) => g.readings.map((r) => `${g.matchName ?? g.name} ${r.label}`));
		candidates.push("Älter *star* ?query? Ä", "ab", "a*b", "");
		for (const pattern of patterns) {
			assert.deepEqual(panelModel.detailFilterAlternatives(pattern), [...detailFilterAlternatives(pattern)], pattern);
			const plugin = compileDetailFilter(pattern);
			const panel = panelModel.detailFilterMatcher(pattern);
			for (const c of candidates) assert.equal(panel(c), plugin(c), `${JSON.stringify(pattern)} on ${JSON.stringify(c)}`);
		}
	});

	it("counts what the plugin's resolver counts, for Group and Ambient, on this PC only", () => {
		const filters = ["*core*clock*", "*core*clock*|*gpu*temp*", "*fan*", "*gpu*", "*throttling*", "*ccd*tdie*|*l3 cahce*", "*core*clok*", "*clock*|*temp*"];
		for (const style of ["group", "ambient"]) {
			for (const filter of filters) {
				const r = resolveGroup(snapshot, stripPaneOf({ style, group: { from: "filter", filter, keys: [], view: "auto" } }));
				const plugin = { status: r.status, unit: r.unit, drawn: r.keys.length, sameUnit: r.sameUnit, otherUnits: r.otherUnits, ...(r.units === undefined ? {} : { units: r.units }) };
				const { count } = s.filterReport(filter, groups, { style });
				const panel = { status: count.status, unit: count.unit, drawn: count.drawn, sameUnit: count.sameUnit, otherUnits: count.otherUnits, ...(count.units === undefined ? {} : { units: count.units }) };
				assert.deepEqual(panel, plugin, `${style} ${filter}`);
			}
		}
	});

	it("names an alternative that matches nothing, and a filter that takes nothing as typed", () => {
		const dead = s.filterReport("*ccd*tdie* | *l3 cahce*", groups);
		assert.deepEqual(dead.alternatives, [
			{ text: "*ccd*tdie*", count: 2 },
			{ text: "*l3 cahce*", count: 0 }
		]);
		const rule = { from: "filter", filter: "*ccd*tdie* | *l3 cahce*" };
		assert.deepEqual(s.filterCheck(rule, dead.count, dead.alternatives, false), { note: "2 readings, all in °C. *l3 cahce* matches nothing.", tone: "warn" });
		const two = s.filterReport("*vrm*|*l3 cahce*|*pmup*", groups);
		assert.equal(s.filterCheck({ from: "filter", filter: "*vrm*|*l3 cahce*|*pmup*" }, two.count, two.alternatives, false).note, "1 reading, in °C. *l3 cahce* and *pmup* match nothing.");
		const typo = s.filterReport("*core*clok*", groups);
		assert.deepEqual(s.filterCheck({ from: "filter", filter: "*core*clok*" }, typo.count, typo.alternatives, false), { note: "*core*clok* matches nothing right now.", tone: "warn" });
		const fine = s.filterReport("*core*clock*|*gpu*clock*", groups);
		assert.deepEqual(s.filterCheck({ from: "filter", filter: "*core*clock*|*gpu*clock*" }, fine.count, fine.alternatives, false), { note: "4 readings, all in MHz.", tone: "" }, "every alternative takes something: the plain count");
		assert.equal(s.filterCheck({ from: "filter" }, s.filterReport("", groups).count, [], false).note, "Type a filter for this graph.");
		assert.equal(s.filterReport("*core*", null).count.status, "unavailable");
		assert.equal(s.filterCheck({ from: "filter", filter: "*x*" }, null, [], false).note, null, "nothing before a count");
		for (const line of [dead, two, typo].map((x) => s.filterCheck({ from: "filter", filter: x.count.title }, x.count, x.alternatives, false).note ?? "")) assert.doesNotMatch(line, /—/);
	});

	it("offers examples only when they take two or more readings in one unit on this PC", () => {
		assert.deepEqual(s.filterExamples(groups), ["*core ? clock*|*core ?? clock*", "*gpu*temp*", "*core*(ccd*", "*ccd*tdie*"]);
		assert.deepEqual(s.filterExamples(groups, { max: 2 }), ["*core ? clock*|*core ?? clock*", "*gpu*temp*"]);
		// A GPU with one temperature: *gpu*temp* takes one and is not offered.
		const oneGpuTemp = groups.map((g) => ({ ...g, readings: g.readings.filter((r) => r.label !== "GPU Memory Junction Temperature") }));
		assert.ok(!s.filterExamples(oneGpuTemp).includes("*gpu*temp*"));
		assert.deepEqual(s.filterExamples([]), []);
		for (const example of s.FILTER_EXAMPLES) assert.match(example, /^\*/, "a leading * is the safe habit");
	});

	it("the Filter placeholder matches on an AMD CPU with an NVIDIA GPU: every alternative takes readings", () => {
		const html = readFileSync(fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/sensor-dial.html", import.meta.url)), "utf8");
		const placeholders = [...html.matchAll(/id="sp[01]-filter"[^>]*placeholder="([^"]+)"/g)].map((x) => x[1] as string);
		assert.equal(placeholders.length, 2);
		for (const placeholder of placeholders) {
			const report = s.filterReport(placeholder, groups);
			assert.ok(report.alternatives.length >= 1, placeholder);
			for (const alt of report.alternatives) assert.ok(alt.count >= 2, `${alt.text} takes ${alt.count}`);
		}
	});
});

type Mark = { column: number; look: string; kind: string; self: boolean; needs: boolean; half: number; line: { kind: string; text: string; action: string | null }; label: string };
type DialMap = { marks: Mark[]; status: { lead: string; text: string; tone: string; full: string; title: string } | null; shown: boolean; focus: number | null; action: string | null };
type BuiltScreen = { id: string; name: string; style: string; readout?: string; series: string[]; group: Record<string, unknown> | null; labels: string[]; count: number; unit?: string; shownName?: string; storeName?: string };
type Build = {
	dialMap(st: unknown, ctx?: { layout?: string; live?: boolean; making?: boolean; take?: number[]; actionWord?: (action: string) => string; focus?: number | null }): DialMap;
	stayedColumns(st: unknown, making: boolean): number[];
	proposeScreens(groups: unknown, options?: { slots?: number }): BuiltScreen[];
	buildProposal(groups: unknown, options?: { slots?: number; existing?: { name: string; raw: unknown; origin?: string }[]; canon?: (key: string) => string }): { screens: BuiltScreen[]; skipped: string[] };
	readingsOf(raw: unknown, canon?: (key: string) => string): string | null;
	ruleRingsOf(raw: unknown, groups: unknown): number;
	sensorShortName(name: string): string;
	firstReadingOf(raw: unknown, groups: unknown): string | null;
	moreOf(raw: unknown): number;
	contentNames(raw: unknown, origin: string | undefined, ctx: { groups: unknown; readingOf: (key: string) => { label: string; source: string; found: boolean }; slots?: number; canon?: (key: string) => string }): string[];
	nameAfter(args: { own: string; before: string[]; after: string[]; others: string[] }): string | null;
	buildScreensOps(screens: BuiltScreen[], options?: { start?: number; first?: unknown }): Op[] | null;
	buildScreenLine(screen: BuiltScreen): string;
	originsOfOps(ops: unknown): string[];
	BUILD_MAX: number;
	BUILD_RULE_RINGS: number;
	MAX_SCREENS: number;
};
const bm = m as unknown as Build;

describe("the dial map: a mark per dial and one status line", () => {
	const slotsOf = (states: string[], self: number, groupId: string | null) => states.map((state, column) => ({ column, state, self: column === self, groupId: state === "none" ? null : state === "other" ? "h" : groupId }));
	const st = (states: string[], { self = 4, joined = true, model = "Stream Deck + XL" } = {}) => ({ device: { strip: true, encoders: states.length, model }, self: { column: self, joined, groupId: joined ? "g" : null, foreign: null }, group: joined ? { live: true, config: {} } : null, slots: slotsOf(states, self, joined ? "g" : null) });
	const six = ["joined", "joined", "joined", "joined", "joined", "joined"];

	it("a healthy strip: every mark filled, this dial's ringed, nothing to do, and one line with the layout and this dial's place", () => {
		const map = bm.dialMap(st(six), { live: true });
		assert.deepEqual(map.marks.map((x) => x.look), ["on", "on", "on", "on", "on", "on"]);
		assert.deepEqual(map.marks.map((x) => x.self), [false, false, false, false, true, false]);
		assert.ok(map.marks.every((x) => !x.needs));
		assert.deepEqual(map.status, { lead: "Whole strip · ", text: "dial 5 of 6", tone: "", full: "Whole strip · dial 5 of 6", title: "Whole strip · dial 5 of 6" });
		assert.deepEqual([map.shown, map.focus, map.action], [false, null, null], "every dial in the strip: no row, nothing to act on");
		assert.equal(map.marks[4]?.label, "Dial 5, in this strip, this dial");
		assert.equal(map.marks[0]?.label, "Dial 1, in this strip");
	});

	it("an Equal split names this dial's half and marks where the second half starts", () => {
		const four = ["joined", "joined", "joined", "joined"];
		const right = bm.dialMap(st(four, { self: 3 }), { live: true, layout: "split" });
		assert.equal(right.status?.full, "Right half · dial 4 of 4");
		assert.deepEqual(right.marks.map((x) => x.half), [0, 0, 1, 1]);
		assert.equal(bm.dialMap(st(four, { self: 0 }), { live: true, layout: "split" }).status?.full, "Left half · dial 1 of 4");
		assert.deepEqual(bm.dialMap(st(four, { self: 0 }), { live: true }).marks.map((x) => x.half), [0, 0, 0, 0]);
	});

	it("each dial that needs the person has its look, its words and its one action, and the line names one with its action", () => {
		const map = bm.dialMap(st(["joined", "dormant", "joined", "none", "joined", "other"]), { live: true, actionWord: (a) => a.toUpperCase() });
		assert.deepEqual(map.marks.map((x) => x.look), ["on", "hollow", "on", "dashed", "on", "dot"]);
		assert.deepEqual(map.marks.filter((x) => x.needs).map((x) => x.column), [1, 3, 5]);
		assert.deepEqual([map.shown, map.status?.full, map.status?.tone, map.focus, map.action], [true, "Dial 2 left the strip", "warn", 1, "rejoin"], "the first dial that needs the person, and its one action");
		// A mark picks the dial the line names: its words, its action or none.
		const missing = bm.dialMap(st(["joined", "dormant", "joined", "none", "joined", "other"]), { live: true, focus: 3 });
		assert.deepEqual([missing.status?.full, missing.focus, missing.action], ["Dial 4 is missing", 3, null]);
		assert.match(missing.status?.title ?? "", /Drag one here in the Stream Deck app/, "where to place it is in the line's title");
		const other = bm.dialMap(st(["joined", "dormant", "joined", "none", "joined", "other"]), { live: true, focus: 5 });
		assert.deepEqual([other.status?.full, other.action], ["Dial 6 is in another strip", "move"]);
		const healthy = bm.dialMap(st(["joined", "dormant", "joined", "none", "joined", "other"]), { live: true, focus: 0 });
		assert.deepEqual([healthy.status?.full, healthy.status?.tone, healthy.focus, healthy.action], ["Dial 1 is in the strip", "", 0, null], "a dial in the strip has nothing to do");
		assert.equal(map.marks[1]?.label, "Dial 2, left the strip, REJOIN");
		assert.equal(map.marks[3]?.label, "Dial 4, missing, add a Sensor Dial");
		assert.equal(map.marks[5]?.label, "Dial 6, in another strip, MOVE");
		const one = (state: string): string | undefined => bm.dialMap(st(["joined", "joined", "joined", state, "joined", "joined"]), { live: true }).status?.full;
		assert.equal(one("none"), "Dial 4 is missing");
		assert.equal(one("dormant"), "Dial 4 left the strip");
		assert.equal(one("independent"), "Dial 4 is not in the strip");
		assert.equal(one("other"), "Dial 4 is in another strip");
		assert.equal(one("outside"), "Dial 4 is outside the strip");
		const tie = bm.dialMap({ ...st(six), group: { live: true, config: {}, conflict: { columns: [2] } } }, { live: true });
		assert.deepEqual([tie.shown, tie.status?.full, tie.marks[2]?.look, tie.marks[2]?.needs, tie.action], [true, "Dial 3 holds a different copy", "hollow", true, null]);
	});

	it("an independent dial names its deck and place, and only a strip being made asks for anything", () => {
		const alone = bm.dialMap(st(["independent", "independent", "independent", "independent"], { self: 1, joined: false, model: "Stream Deck +" }), {});
		assert.equal(alone.status?.full, "Stream Deck + · dial 2 of 4");
		assert.equal(alone.shown, false, "nothing to act on: no row");
		assert.ok(alone.marks.every((x) => x.look === "hollow" && !x.needs));
		const making = st(["independent", "independent", "other", "none"], { self: 1, joined: false, model: "Stream Deck +" });
		const made = bm.dialMap(making, { making: true });
		assert.deepEqual([made.shown, made.status?.full, made.action], [true, "Dial 3 is in another strip", "include"]);
		const taken = bm.dialMap(making, { making: true, take: [2] });
		assert.deepEqual([taken.status?.full, taken.action], ["Dial 4 is missing", null], "a dial ticked to move here needs nothing more");
		const again = bm.dialMap(making, { making: true, take: [2], focus: 2 });
		assert.deepEqual([again.status?.full, again.action], ["Dial 3 is in another strip", "include"], "its mark brings its Include back, to untick it");
		assert.equal(bm.dialMap(making, { making: true, actionWord: (a) => a }).marks[2]?.label, "Dial 3, in another strip, include");
		const ready = bm.dialMap(st(["independent", "independent", "independent", "independent"], { self: 1, joined: false, model: "Stream Deck +" }), { making: true });
		assert.deepEqual([ready.shown, ready.status?.full], [true, "Whole strip · dial 2 of 4"], "a strip being made shows the row with this dial's place");
		assert.equal(bm.dialMap(making, {}).status?.full, "Stream Deck + · dial 2 of 4");
		assert.deepEqual(bm.dialMap({ device: { strip: false } }, {}), { marks: [], status: null, shown: true, focus: null, action: null });
		// The panel of a dial that left: the strip runs on the others.
		const left = { device: { strip: true, encoders: 4, model: "Stream Deck +" }, self: { column: 1, joined: false, groupId: "g", foreign: null }, group: { live: true, config: {} }, slots: ["joined", "dormant", "joined", "joined"].map((state, column) => ({ column, state, self: column === 1, groupId: "g" })) };
		const map = bm.dialMap(left, {});
		assert.deepEqual([map.status?.full, map.marks[1]?.look, map.marks[1]?.label], ["Stream Deck + · dial 2 of 4", "hollow", "Dial 2, left the strip, this dial"]);
		// A new strip made there: the dials still in the strip it left are
		// taken (the plugin refuses a new strip over them) and offer no
		// Include; Rejoin is the way back (the panel's reason says so).
		const over = bm.dialMap(left, { making: true, actionWord: (a) => a });
		assert.deepEqual(over.marks.filter((x) => x.needs).map((x) => x.column), [0, 2, 3]);
		assert.deepEqual([over.shown, over.status?.tone, over.action], [true, "warn", null]);
		assert.ok(over.marks.every((x) => !/include/.test(x.label)), JSON.stringify(over.marks.map((x) => x.label)));
		// Their line, title, labels and marks name the strip this dial left,
		// never "in this strip" (the strip being made is another one).
		assert.deepEqual([over.status?.full, over.status?.title], ["Dial 1 is still in the strip this dial left", "Dial 1 is still in the strip this dial left"]);
		assert.deepEqual(
			over.marks.map((x) => [x.label, x.look]),
			[
				["Dial 1, still in the strip this dial left", "dot"],
				["Dial 2, left the strip, this dial", "hollow"],
				["Dial 3, still in the strip this dial left", "dot"],
				["Dial 4, still in the strip this dial left", "dot"]
			]
		);
		assert.equal(bm.dialMap(left, { making: true, focus: 2 }).status?.full, "Dial 3 is still in the strip this dial left", "a mark names its own dial");
		assert.deepEqual(bm.stayedColumns(left, true), [0, 2, 3]);
		assert.deepEqual(bm.stayedColumns(left, false), [], "only while a strip is being made");
		// A joined dial (its strip not running here) left nothing behind.
		assert.deepEqual(bm.stayedColumns({ ...left, self: { ...left.self, joined: true } }, true), []);
		// The strip it left runs with a dial outside its dials: that one stayed too.
		assert.deepEqual(bm.stayedColumns({ ...left, slots: left.slots.map((x) => (x.column === 3 ? { ...x, state: "outside" } : x)) }, true), [0, 2, 3]);
	});

	it("never says the plugin places a dial", () => {
		for (const state of ["joined", "none", "independent", "dormant", "other", "outside"]) {
			const map = bm.dialMap(st(["joined", "joined", "joined", state, "joined", "joined"]), { live: true });
			for (const text of [map.status?.full ?? "", ...map.marks.map((x) => x.label)]) assert.doesNotMatch(text, /automatic|we place|will place|placed for you/i);
		}
	});
});

describe("Build screens for this PC", () => {
	const snapshot = censusSnapshot();
	const groups = buildSensorTree({ state: "ok", snapshot, source: "shared-memory" }).groups as unknown as TreeGroup[];
	/** The census list plus `n` core clocks in the CPU's folder and `fans` more fans on the board. */
	const more = (n: number, fans = 0): TreeGroup[] =>
		groups.map((g, i) => {
			if (g.name.startsWith("CPU [#0]: AMD") && i === 0) return { ...g, readings: [...g.readings, ...Array.from({ length: n }, (_, k) => ({ key: `f0000300:0:${(0x2000000 + k).toString(16)}`, label: `Core ${k + 2} Clock`, unit: "MHz", value: 5000 }))] };
			if (g.name.startsWith("MSI")) return { ...g, readings: [...g.readings, ...Array.from({ length: fans }, (_, k) => ({ key: `f7006687:0:${(0x2000000 + k).toString(16)}`, label: `System ${k + 2}`, unit: "RPM", value: 900 }))] };
			return g;
		});

	it("proposes only the screens this PC's own sensors fill, in order, each named and counted", () => {
		const screens = bm.proposeScreens(groups, { slots: 6 });
		assert.deepEqual(
			screens.map((x) => [x.id, x.name, x.style, x.count]),
			[
				["cpu", "CPU", "lanes", 2],
				["gpu", "GPU", "area", 1],
				["cpu-gpu", "CPU and GPU", "compare", 2],
				["cooling", "Cooling", "meters", 4],
				["temps", "Every temperature", "ambient", 10]
			],
			"two core clocks are not four: no Core clocks screen; no CPU usage here: Lanes of two"
		);
		assert.deepEqual(screens[0]?.labels, ["CPU (Tctl/Tdie)", "CPU Package Power"]);
		assert.deepEqual([screens[1]?.labels, screens[1]?.readout], [["GPU Temperature"], "left"]);
		assert.deepEqual([screens[2]?.labels, screens[2]?.series, screens[2]?.readout], [["CPU (Tctl/Tdie)", "GPU Temperature"], [screens[0]?.series[0], screens[1]?.series[0]], undefined], "the same two temperatures the CPU and GPU screens name, with nothing beside them");
		assert.deepEqual(screens[3]?.labels, ["Pump Fan", "CPU Fan", "GPU Fan1", "System 1"], "the pump first, then the CPU and GPU fans");
		assert.deepEqual(
			screens.map((x) => bm.buildScreenLine(x)),
			["CPU · Lanes · CPU (Tctl/Tdie) and CPU Package Power", "GPU · Area with large values · GPU Temperature", "CPU and GPU · Compare · CPU (Tctl/Tdie) and GPU Temperature", "Cooling · Meters · Pump Fan, CPU Fan, GPU Fan1 and System 1", "Every temperature · Ambient · 10 readings in °C"]
		);
	});

	it("Core clocks takes four or more, and Cooling turns into Group Now past the dials", () => {
		const screens = bm.proposeScreens(more(6, 1), { slots: 4 });
		assert.deepEqual(screens.map((x) => x.id), ["cpu", "gpu", "cpu-gpu", "cooling", "clocks", "temps"], "no per-thread usages here: no CPU cores");
		const cooling = screens[3] as BuiltScreen;
		assert.deepEqual([cooling.style, cooling.group, cooling.count], ["group", { from: "unit", unit: "RPM", keys: [], view: "now" }, 5], "five fans on four dials: a Group column per RPM reading");
		const clocks = screens[4] as BuiltScreen;
		assert.deepEqual([clocks.style, clocks.group, clocks.count], ["group", { from: "filter", filter: "*core ? clock*|*core ?? clock*", keys: [], view: "rows" }, 8]);
		assert.equal(bm.buildScreenLine(clocks), "Core clocks · Group Rows · 8 readings matching *core ? clock*|*core ?? clock*");
		assert.equal(bm.buildScreenLine(cooling), "Cooling · Group Now · 5 readings in RPM");
	});

	it("skips a screen whose readings are not here", () => {
		const noGpu = groups.filter((g) => !g.name.startsWith("dGPU"));
		assert.deepEqual(bm.proposeScreens(noGpu, { slots: 6 }).map((x) => x.id), ["cpu", "cooling", "temps"]);
		assert.deepEqual(bm.proposeScreens([], { slots: 6 }), []);
	});

	it("appends after the screens there are, in one edit the plugin accepts, and leaves those screens as they were", () => {
		const stored = stripConfigOf(threeScreens());
		const screens = bm.proposeScreens(more(6), { slots: 4 }).filter((x) => x.id !== "cpu-gpu");
		const ops = bm.buildScreensOps(screens, { start: 3 });
		assert.ok(ops !== null && ops.length <= MAX_EDIT_OPS, `${ops?.length} operations`);
		const result = applyStripEdit({ id: "g", rev: 4, config: stored }, 4, ops, { deviceEncoders: 4 });
		assert.ok(result.ok, JSON.stringify(result));
		if (!result.ok) return;
		const json = stripConfigToJson(result.copy.config) as { panes: Record<string, unknown>[]; screens: Record<string, unknown>[] };
		const all = [json.panes[0], ...json.screens] as Record<string, unknown>[];
		assert.equal(all.length, 8);
		const before = threeScreens() as { panes: Record<string, unknown>[]; screens: Record<string, unknown>[] };
		assert.deepEqual(all.slice(0, 3), [before.panes[0], ...before.screens].map((p) => (stripConfigToJson(stripConfigOf({ panes: [p] })) as { panes: unknown[] }).panes[0]), "the three screens there were are untouched");
		assert.deepEqual(
			all.slice(3).map((p) => [p.origin, p.style, p.name]),
			[
				["cpu", "lanes", "CPU"],
				["gpu", "area", "GPU"],
				["cooling", "meters", "Cooling"],
				["clocks", "group", "Core clocks"],
				["temps", "ambient", "Every temperature"]
			],
			"each built screen stores what made it and Build's own label, never a filter or a unit phrase"
		);
		assert.ok(all.every((p) => typeof p.screenId === "string") && new Set(all.map((p) => p.screenId)).size === 8, "every screen has its own id");
		assert.equal(all[4]?.readout, "left");
		assert.equal(all[3]?.group, undefined, "a series screen keeps no rule");
		assert.deepEqual((all[3]?.series as { key: string }[]).map((x) => x.key), screens[0]?.series);
		assert.deepEqual(all[6]?.group, { from: "filter", filter: "*core ? clock*|*core ?? clock*", keys: [], view: "rows" });
		assert.deepEqual(all[7]?.group, { from: "unit", unit: "°C", keys: [], view: "auto" });
	});

	it("CPU and GPU is a Compare of the two temperatures, the one the recipes offered, and only with both", () => {
		const screens = bm.proposeScreens(groups, { slots: 6 });
		const versus = screens.find((x) => x.id === "cpu-gpu") as BuiltScreen;
		assert.deepEqual(versus.series, screens.filter((x) => x.id === "cpu" || x.id === "gpu").map((x) => x.series[0]));
		const noGpu = groups.filter((g) => !g.name.startsWith("dGPU"));
		assert.equal(bm.proposeScreens(noGpu, { slots: 6 }).some((x) => x.id === "cpu-gpu"), false, "no GPU: nothing to compare");
		const noCpu = groups.filter((g) => !g.name.startsWith("CPU")).map((g) => ({ ...g, readings: g.readings.filter((r) => !/cpu|tctl|tdie|package/i.test(r.label)) }));
		assert.equal(bm.proposeScreens(noCpu, { slots: 6 }).some((x) => x.id === "cpu-gpu"), false, "no CPU temperature: nothing to compare");
		assert.deepEqual(bm.buildProposal(groups, { slots: 6, existing: [{ name: "Mine", raw: { style: "compare", series: versus.series.map((key) => ({ key })) } }] }).skipped, ["CPU and GPU"], "a strip already drawing the two is not offered them again");
	});

	it("every proposal fits one edit the plugin accepts, on a new strip and after a screen", () => {
		const screens = bm.proposeScreens(more(6), { slots: 6 });
		const base = newStripConfig("whole", 6, stripSeedOf({ readingKey: GPU_TEMP }));
		const first = (stripConfigToJson(base) as { panes: unknown[] }).panes[0];
		const fresh = bm.buildScreensOps(screens, { start: 0, first });
		assert.ok(fresh !== null && fresh.length <= MAX_EDIT_OPS, `new strip: ${fresh?.length} operations`);
		assert.ok(applyStripEdit({ id: "draft", rev: 0, config: base }, 0, fresh, { deviceEncoders: 6 }).ok);
		const after = bm.buildScreensOps(screens, { start: 1 });
		assert.ok(after !== null && after.length <= MAX_EDIT_OPS, `after a screen: ${after?.length} operations`);
		assert.ok(applyStripEdit({ id: "g", rev: 4, config: base }, 4, after, { deviceEncoders: 6 }).ok);
	});

	it("a ticked list comes back from the operations it became, so another dial's panel shows the same ticks", () => {
		const screens = bm.proposeScreens(more(6), { slots: 6 });
		const some = screens.filter((x) => x.id !== "cooling");
		assert.deepEqual(bm.originsOfOps(bm.buildScreensOps(some, { start: 0 })), some.map((x) => x.id));
		assert.deepEqual(bm.originsOfOps([]), []);
		assert.deepEqual(bm.originsOfOps(null), []);
		assert.deepEqual(bm.originsOfOps([{ op: "set", path: "panes.0.style", value: "trend" }]), []);
	});

	it("stops at eight screens, and a full strip gets no operation", () => {
		const screens = bm.proposeScreens(more(6), { slots: 4 });
		const ops = bm.buildScreensOps(screens, { start: 6 }) ?? [];
		assert.deepEqual(ops.filter((op) => op.op === "addScreen").map((op) => op.at), [6, 7]);
		assert.deepEqual(ops.filter((op) => op.path?.endsWith(".origin")).map((op) => op.value), ["cpu", "gpu"]);
		assert.deepEqual(ops.filter((op) => op.path?.endsWith(".name")).map((op) => op.value), ["CPU", "GPU"]);
		assert.deepEqual(bm.buildScreensOps(screens, { start: 8 }), []);
	});

	it("a new strip takes the first screen in its own fields and the rest after it, in the one create", () => {
		const base = newStripConfig("whole", 6, stripSeedOf({ readingKey: GPU_TEMP }));
		const first = (stripConfigToJson(base) as { panes: unknown[] }).panes[0];
		const screens = bm.proposeScreens(more(6), { slots: 6 });
		const ops = bm.buildScreensOps(screens, { start: 0, first });
		assert.ok(ops !== null && ops.length <= MAX_EDIT_OPS && !ops.some((op) => op.op === "addScreen" && op.at === 0));
		const made = applyStripEdit({ id: "draft", rev: 0, config: base }, 0, ops, { deviceEncoders: 6 });
		assert.ok(made.ok, JSON.stringify(made));
		if (!made.ok) return;
		const json = stripConfigToJson(made.copy.config) as { panes: Record<string, unknown>[]; screens: Record<string, unknown>[] };
		assert.deepEqual([json.panes[0]?.origin, json.panes[0]?.name, json.panes[0]?.style, (json.panes[0]?.series as { key: string }[]).map((x) => x.key)], ["cpu", "CPU", "lanes", screens[0]?.series]);
		assert.deepEqual(json.screens.map((p) => [p.origin, p.name]), [["gpu", "GPU"], ["cpu-gpu", "CPU and GPU"], ["cooling", "Cooling"], ["clocks", "Core clocks"], ["temps", "Every temperature"]]);
		// A rule screen first: the seeded reading goes with the old pane.
		const temps = screens.filter((x) => x.id === "temps");
		const ruleFirst = applyStripEdit({ id: "draft", rev: 0, config: base }, 0, bm.buildScreensOps(temps, { start: 0, first }), { deviceEncoders: 6 });
		assert.ok(ruleFirst.ok && ruleFirst.copy.config.panes[0].style === "ambient" && ruleFirst.copy.config.panes[0].series.length === 0, JSON.stringify(ruleFirst));
	});
});

/** The census list plus a CPU's per-thread readings in a sensor of their
 * own, on the pattern of HWiNFO's main CPU sensor (the owner's 9950X3D2
 * capture): a usage and an effective clock per thread (`threads`, "Core 3
 * T1" or "P-core 0 T0"), and the two totals HWiNFO lists beside them. */
function threadSnapshot(name: string, threads: readonly string[], coreClocks: readonly string[] = []): SensorSnapshot {
	const base = censusSnapshot();
	const index = base.sensors.length;
	const id = 0xf0000200;
	const rows: [string, string, SensorType][] = [["Total CPU Usage", "%", SensorType.Usage], ["Max CPU/Thread Usage", "%", SensorType.Usage], ...threads.map((t): [string, string, SensorType] => [`${t} Usage`, "%", SensorType.Usage]), ...threads.map((t): [string, string, SensorType] => [`${t} Effective Clock`, "MHz", SensorType.Clock]), ...coreClocks.map((label): [string, string, SensorType] => [label, "MHz", SensorType.Clock])];
	const sensors: SensorSource[] = [...base.sensors, { index, id, instance: 0, name }];
	const readings: Reading[] = [...base.readings, ...rows.map(([label, unit, type], i) => ({ key: `${id.toString(16)}:0:${(0x1000000 + i).toString(16)}`, label, unit, type, sensorIndex: index, id: 0x1000000 + i, value: 10 + (i % 80), valueMin: 0, valueMax: 100, valueAvg: 50 }))];
	return { ...base, sensors, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}
/** "Core 0 T0" to "Core 15 T1": 16 cores of two threads. */
const AMD_THREADS = Array.from({ length: 32 }, (_, i) => `Core ${i >> 1} T${i & 1}`);
/** A hybrid Intel part: 8 P-cores of two threads, 16 E-cores of one. */
const INTEL_THREADS = [...Array.from({ length: 16 }, (_, i) => `P-core ${i >> 1} T${i & 1}`), ...Array.from({ length: 16 }, (_, i) => `E-core ${8 + i} T0`)];
const PER_THREAD_USAGE = /^(?:[PE]-core|Core) \d+ T\d Usage$/;

/** Core 2 to Core 15's clocks: the census list holds Core 0 and Core 1's. */
const CORE_CLOCKS = Array.from({ length: 14 }, (_, i) => `Core ${i + 2} Clock (perf #${i + 3}/16)`);

describe("Build screens: CPU cores, a Tiles Group of every thread's usage", () => {
	const amd = threadSnapshot("CPU [#0]: AMD Ryzen 9 9950X3D2", AMD_THREADS, CORE_CLOCKS);
	const intel = threadSnapshot("CPU [#0]: Intel Core i9-13900K", INTEL_THREADS);
	const treeOf = (snapshot: SensorSnapshot): TreeGroup[] => buildSensorTree({ state: "ok", snapshot, source: "shared-memory" }).groups as unknown as TreeGroup[];
	const coresOf = (snapshot: SensorSnapshot): BuiltScreen | undefined => bm.proposeScreens(treeOf(snapshot), { slots: 6 }).find((x) => x.id === "cores");

	it("proposes CPU cores right after CPU, a Group of the per-thread usages in the Tiles view, named and counted; seven is the most", () => {
		const screens = bm.proposeScreens(treeOf(amd), { slots: 6 });
		assert.deepEqual(screens.map((x) => x.id), ["cpu", "cores", "gpu", "cpu-gpu", "cooling", "clocks", "temps"]);
		assert.equal(bm.BUILD_MAX, 7);
		assert.equal(screens.length, bm.BUILD_MAX);
		const cores = screens[1] as BuiltScreen;
		assert.deepEqual([cores.name, cores.style, cores.series, cores.labels, cores.count, cores.unit], ["CPU cores", "group", [], [], 32, "%"]);
		assert.deepEqual(cores.group, { from: "filter", filter: "*core * t? usage", keys: [], view: "tiles" });
		assert.equal(bm.buildScreenLine(cores), "CPU cores · Group Tiles · 32 readings matching *core * t? usage");
		assert.ok(stripSettings.GROUP_VIEWS.includes("tiles"), "the plugin stores the view");
	});

	it("the filter takes only the per-thread usages on the plugin as in the panel, never a total, even where the CPU's name says Core; the tiles lay them out as cores", () => {
		for (const [snapshot, columns, grid] of [
			[amd, 16, [8, 8]],
			[intel, 24, [8, 16]]
		] as const) {
			const cores = coresOf(snapshot) as BuiltScreen;
			assert.ok(cores !== undefined, snapshot.sensors.at(-1)?.name);
			const resolved = resolveGroup(snapshot, stripPaneOf({ style: "group", group: cores.group }));
			const labels = resolved.keys.map((key) => snapshot.byKey.get(key)?.label ?? "");
			assert.equal(resolved.sameUnit, 32, "the plugin takes every thread");
			assert.ok(labels.every((label) => PER_THREAD_USAGE.test(label)), JSON.stringify(labels.filter((label) => !PER_THREAD_USAGE.test(label))));
			assert.equal(new Set(labels).size, 32);
			assert.equal(cores.count, resolved.sameUnit, "the panel counts what the plugin takes");
			const shape = tileShapeOf(labels);
			assert.deepEqual([shape.columns.length, shape.grid], [columns, grid], "a column per physical core, in blocks");
		}
		// The census CPU's name says Ryzen, the Intel one's says Core: neither
		// total is a thread's, on either.
		const candidates = (snapshot: SensorSnapshot): string[] => snapshot.readings.map((r) => `${snapshot.sensors[r.sensorIndex]?.name ?? ""} ${r.label}`);
		const match = compileDetailFilter("*core * t? usage");
		assert.deepEqual(
			candidates(intel).filter((c) => /Total CPU Usage|Max CPU\/Thread Usage|Effective Clock/.test(c)).filter(match),
			[],
			"the totals and clocks of an Intel Core part"
		);
	});

	it("needs four per-thread usages: three propose no CPU cores screen", () => {
		assert.equal(coresOf(threadSnapshot("CPU [#0]: AMD Ryzen 5 9600X", AMD_THREADS.slice(0, 3))), undefined);
		assert.equal(coresOf(threadSnapshot("CPU [#0]: AMD Ryzen 5 9600X", AMD_THREADS.slice(0, 4)))?.count, 4);
		assert.equal(coresOf(censusSnapshot()), undefined, "no per-thread usages, no screen");
	});

	it("all seven fit one edit the plugin accepts, after one screen, the first six after two, and as a new strip; CPU cores stores its Tiles view", () => {
		const screens = bm.proposeScreens(treeOf(amd), { slots: 6 });
		assert.deepEqual(
			screens.map((x) => x.style),
			["lanes", "group", "area", "compare", "meters", "group", "ambient"],
			"the costliest kinds: Lanes, a readout, a meter per fan"
		);
		const one = stripConfigToJson(screensBase()) as Record<string, unknown>;
		const two = { ...one, panes: [{ ...(one.panes as Record<string, unknown>[])[0], screenId: "0000000a" }, (one.panes as unknown[])[1]], screens: [{ screenId: "0000000b", style: "group", series: [], group: { from: "filter", filter: "*fan*", keys: [], view: "auto" } }] };
		for (const [start, raw] of [
			[1, one],
			[2, two]
		] as const) {
			const ops = bm.buildScreensOps(screens, { start });
			assert.ok(ops !== null && ops.length <= MAX_EDIT_OPS, `${start}: ${ops?.length} operations`);
			const result = applyStripEdit({ id: "g", rev: 4, config: stripConfigOf(raw) }, 4, ops, { deviceEncoders: 4 });
			assert.ok(result.ok, JSON.stringify(result));
			if (!result.ok) continue;
			const json = stripConfigToJson(result.copy.config) as { panes: Record<string, unknown>[]; screens: Record<string, unknown>[] };
			const all = [json.panes[0], ...json.screens] as Record<string, unknown>[];
			assert.deepEqual(all.slice(start).map((p) => [p.origin, p.style, p.name]), [
				["cpu", "lanes", "CPU"],
				["cores", "group", "CPU cores"],
				["gpu", "area", "GPU"],
				["cpu-gpu", "compare", "CPU and GPU"],
				["cooling", "meters", "Cooling"],
				["clocks", "group", "Core clocks"],
				["temps", "ambient", "Every temperature"]
			].slice(0, 8 - start));
			assert.deepEqual(all[start + 1]?.group, { from: "filter", filter: "*core * t? usage", keys: [], view: "tiles" });
			assert.deepEqual(all[start + 5]?.group, { from: "filter", filter: "*core ? clock*|*core ?? clock*", keys: [], view: "rows" });
		}
		const base = newStripConfig("whole", 6, stripSeedOf({ readingKey: GPU_TEMP }));
		const ops = bm.buildScreensOps(screens, { start: 0, first: (stripConfigToJson(base) as { panes: unknown[] }).panes[0] });
		assert.ok(ops !== null && ops.length <= MAX_EDIT_OPS, `new strip: ${ops?.length} operations`);
		const made = applyStripEdit({ id: "draft", rev: 0, config: base }, 0, ops, { deviceEncoders: 6 });
		assert.ok(made.ok, JSON.stringify(made));
		if (made.ok) assert.deepEqual(made.copy.config.screens?.[0]?.group, { from: "filter", filter: "*core * t? usage", keys: [], view: "tiles" });
	});

	it("a built CPU cores screen keeps Build's name while it draws what Build gave it", () => {
		const groups = treeOf(amd);
		const cores = coresOf(amd) as BuiltScreen;
		const readingOf = (key: string): { label: string; source: string; found: boolean } => {
			for (const g of groups) for (const r of g.readings) if (r.key === key || r.keys?.includes(key)) return { label: r.label, source: g.name, found: true };
			return { label: key, source: "", found: false };
		};
		const raw = { style: "group", series: [], group: cores.group };
		assert.deepEqual(bm.contentNames(raw, "cores", { groups, readingOf, slots: 6 }), ["CPU cores", "CPU cores (Group Tiles)"]);
		const built = bm.buildProposal(groups, { slots: 6, existing: [{ name: "Threads", raw }] });
		assert.ok(!built.screens.some((x) => x.id === "cores") && built.skipped.includes("CPU cores"), "a screen that already draws them is not proposed again");
	});
});

describe("Build screens: Core clocks takes the clocks, and the screens fit the history share", () => {
	const treeOf = (snapshot: SensorSnapshot): TreeGroup[] => buildSensorTree({ state: "ok", snapshot, source: "shared-memory" }).groups as unknown as TreeGroup[];
	/** More readings in the folder threadSnapshot added. */
	const withRows = (base: SensorSnapshot, rows: readonly [string, string, SensorType][], start: number): SensorSnapshot => {
		const sensorIndex = base.sensors.length - 1;
		const readings: Reading[] = [...base.readings, ...rows.map(([label, unit, type], i) => ({ key: `f0000200:0:${(start + i).toString(16)}`, label, unit, type, sensorIndex, id: start + i, value: 40, valueMin: 0, valueMax: 100, valueAvg: 50 }))];
		return { ...base, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	};
	const fans = (n: number): [string, string, SensorType][] => Array.from({ length: n }, (_, i) => [`Fan ${i}`, "RPM", SensorType.Fan]);
	const temps = (n: number): [string, string, SensorType][] => Array.from({ length: n }, (_, i) => [`Spot ${i}`, "°C", SensorType.Temperature]);
	const ringsOf = (x: BuiltScreen): number => (x.style === "ambient" ? Math.min(x.count, 48) : x.style === "group" ? Math.min(x.count, 32) : 0);
	const CLOCK_RULE = "*core ? clock*|*core ?? clock*";
	const hybrid = [...Array.from({ length: 8 }, (_, i) => `P-core ${i} Clock`), ...Array.from({ length: 16 }, (_, i) => `E-core ${8 + i} Clock`)];

	it("takes a clock per core and no thread's effective clock, on the panel and the plugin", () => {
		for (const [snapshot, count] of [
			[threadSnapshot("CPU [#0]: AMD Ryzen 9 9950X3D2", AMD_THREADS, CORE_CLOCKS), 16],
			[threadSnapshot("CPU [#0]: Intel Core i9-13900K", INTEL_THREADS, hybrid), 26]
		] as const) {
			const screen = bm.proposeScreens(treeOf(snapshot), { slots: 6 }).find((x) => x.id === "clocks") as BuiltScreen;
			assert.deepEqual([screen.count, screen.group?.filter, screen.group?.view], [count, CLOCK_RULE, "rows"], "the clocks alone, the census list's two with them");
			const resolved = resolveGroup(snapshot, stripPaneOf({ style: "group", group: screen.group }));
			assert.equal(resolved.sameUnit, count, "the plugin takes what the panel counts");
			assert.deepEqual(resolved.keys.map((key) => snapshot.byKey.get(key)?.label).filter((label) => /Effective/.test(label ?? "")), [], "no effective clock draws");
		}
	});

	it("the first filter an empty Filter field offers is the same one", () => {
		assert.equal(s.FILTER_EXAMPLES[0], CLOCK_RULE);
	});

	it("the Filter field's greyed example is one the Try chips offer and draws all it takes", () => {
		const html = readFileSync(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/sensor-dial.html", import.meta.url), "utf8");
		const examples = [...html.matchAll(/<input id="sp[01]-filter"[^>]*placeholder="([^"]*)"/g)].map((x) => x[1] as string);
		assert.equal(examples.length, 2, "both panes");
		const groups = treeOf(threadSnapshot("CPU [#0]: AMD Ryzen 9 9950X3D2", AMD_THREADS, CORE_CLOCKS));
		for (const example of examples) {
			assert.ok(s.FILTER_EXAMPLES.includes(example), example);
			const { count } = s.filterReport(example, groups);
			assert.equal(count.drawn, count.sameUnit, `${example} takes ${count.sameUnit} and draws ${count.drawn}`);
		}
	});

	it("all seven fit on a 16-core PC with eight fans: 104 rings of the 106 the share holds", () => {
		const snapshot = withRows(withRows(threadSnapshot("CPU [#0]: AMD Ryzen 9 9950X3D2", AMD_THREADS, CORE_CLOCKS), fans(4), 0x3000000), temps(48), 0x4000000);
		const screens = bm.proposeScreens(treeOf(snapshot), { slots: 6 });
		assert.deepEqual(screens.map((x) => x.id), ["cpu", "cores", "gpu", "cpu-gpu", "cooling", "clocks", "temps"]);
		assert.deepEqual(screens.map(ringsOf), [0, 32, 0, 0, 8, 16, 48], "Group Now of the eight RPM readings on six dials");
	});

	it("leaves out a rule screen whose rings would pass the share, in order, and keeps the screens that take none", () => {
		const many = Array.from({ length: 32 }, (_, i) => `Core ${i} Clock`);
		const snapshot = withRows(withRows(threadSnapshot("CPU [#0]: AMD Ryzen Threadripper", AMD_THREADS, many), fans(4), 0x3000000), temps(48), 0x4000000);
		const screens = bm.proposeScreens(treeOf(snapshot), { slots: 6 });
		assert.deepEqual(screens.map((x) => x.id), ["cpu", "cores", "gpu", "cpu-gpu", "cooling", "clocks"], "32 + 8 + 32 = 72, and 48 more would be 120");
		assert.ok(screens.map(ringsOf).reduce((a, b) => a + b, 0) <= bm.BUILD_RULE_RINGS);
		const smaller = threadSnapshot("CPU [#0]: AMD Ryzen Threadripper", AMD_THREADS, many);
		assert.deepEqual(bm.proposeScreens(treeOf(smaller), { slots: 6 }).map((x) => x.id), ["cpu", "cores", "gpu", "cpu-gpu", "cooling", "clocks", "temps"], "the census list's few temperatures still fit");
	});

	describe("with the rule screens a strip already has", () => {
		const owner = withRows(withRows(threadSnapshot("CPU [#0]: AMD Ryzen 9 9950X3D2", AMD_THREADS, CORE_CLOCKS), fans(4), 0x3000000), temps(48), 0x4000000);
		const groups = treeOf(owner);
		const rawOf = (x: BuiltScreen): Record<string, unknown> => ({ style: x.style, series: x.series.map((key) => ({ key })), ...(x.group === null ? {} : { group: x.group }) });

		it("a hand-made Group of 32 takes its share, so Every temperature is left out and nothing passes 106", () => {
			const threads = { name: "Threads", raw: { style: "group", series: [], group: { from: "filter", filter: "*t? usage*", keys: [], view: "rows" } } };
			assert.equal(bm.ruleRingsOf(threads.raw, groups), 32);
			const built = bm.buildProposal(groups, { slots: 6, existing: [threads] });
			assert.deepEqual(built.screens.map((x) => x.id), ["cpu", "cores", "gpu", "cpu-gpu", "cooling", "clocks"], "32 + 32 + 8 + 16 = 88, and 48 more would be 136");
			assert.deepEqual(built.skipped, [], "it is not on the strip, so it is not said to be");
			assert.ok(32 + built.screens.map(ringsOf).reduce((a, b) => a + b, 0) <= bm.BUILD_RULE_RINGS);
		});

		it("a screen Build made counts once: the one taken off comes back beside the others", () => {
			const all = bm.proposeScreens(groups, { slots: 6 });
			const kept = all.filter((x) => x.id !== "clocks").map((x) => ({ name: x.name, raw: rawOf(x), origin: x.id }));
			assert.deepEqual(bm.buildProposal(groups, { slots: 6, existing: kept }).screens.map((x) => x.id), ["clocks"], "88 held and 16 more is 104");
		});

		it("screens that take no rings leave Build's own share whole", () => {
			const graphs = [{ name: "Trend", raw: { style: "trend", series: [{ key: "a" }] } }, { name: "Meters", raw: { style: "meters", series: [{ key: "a" }] } }];
			assert.equal(bm.buildProposal(groups, { slots: 6, existing: graphs }).screens.filter((x) => ringsOf(x) > 0).length, 4);
		});

		it("each rule counts the readings the plugin draws for it, at the style's cap", () => {
			const rings = (raw: Record<string, unknown>): number => bm.ruleRingsOf(raw, groups);
			assert.equal(rings({ style: "trend", series: [{ key: "a" }] }), 0, "a series graph holds no ring of the share");
			assert.equal(rings({ style: "group", group: { from: "filter", filter: "*t? usage*", keys: [], view: "auto" } }), 32, "a filter, at Group's cap");
			assert.equal(rings({ style: "ambient", group: { from: "unit", unit: "°C", keys: [], view: "auto" } }), 48, "Ambient draws 48");
			assert.equal(rings({ style: "group", group: { from: "unit", unit: "RPM", keys: [], view: "now" } }), 8);
			assert.equal(rings({ style: "group", group: { from: "list", keys: ["a", "b", "c"], view: "auto" } }), 3, "a list, each kept reading");
			assert.equal(rings({ style: "group", series: [] }), 0, "a folder with no reading yet draws none");
			assert.equal(rings({ style: "group", group: { from: "filter", keys: [], view: "auto" } }), 0, "an empty filter draws none");
		});

		it("the count is the plugin's: resolveGroup draws as many readings for each rule", () => {
			const fan = groups.flatMap((g) => g.readings).find((r) => r.unit === "RPM")?.key as string;
			const rules: Record<string, unknown>[] = [
				{ style: "group", series: [], group: { from: "filter", filter: "*t? usage*", keys: [], view: "auto" } },
				{ style: "ambient", series: [], group: { from: "filter", filter: "*", keys: [], view: "auto" } },
				{ style: "ambient", series: [], group: { from: "unit", unit: "°C", keys: [], view: "auto" } },
				{ style: "group", series: [], group: { from: "unit", unit: "RPM", keys: [], view: "now" } },
				{ style: "group", series: [{ key: fan }], group: { from: "folder", keys: [], view: "auto" } },
				{ style: "ambient", series: [{ key: fan }], group: { from: "folder", keys: [], view: "auto" } }
			];
			for (const raw of rules) assert.equal(bm.ruleRingsOf(raw, groups), resolveGroup(owner, stripPaneOf(raw)).keys.length, JSON.stringify(raw));
		});
	});

	it("the rings the panel counts are the ones the plugin's share pays for at 5 and 15 minutes", () => {
		for (const tier of [TIERS[1], TIERS[2]]) assert.equal(bm.BUILD_RULE_RINGS, Math.floor(GROUP_HISTORY_BUDGET_BYTES / ((tier as { capacity: number }).capacity * ENTRY_BYTES)));
	});
});

describe("Build screens on a strip that has screens, and names from what a screen draws", () => {
	const snapshot = censusSnapshot();
	const groups = buildSensorTree({ state: "ok", snapshot, source: "shared-memory" }).groups as unknown as TreeGroup[];
	const rawOf = (x: BuiltScreen): Record<string, unknown> => ({ style: x.style, series: x.series.map((key) => ({ key })), ...(x.group === null ? {} : { group: x.group }), ...(x.readout === undefined ? {} : { readout: x.readout }) });

	/** The census list's readings as the panel names them. */
	const readingOf = (key: string): { label: string; source: string; found: boolean } => {
		for (const g of groups) for (const r of g.readings) if (r.key === key || r.keys?.includes(key)) return { label: r.label, source: g.name, found: true };
		return { label: key, source: "", found: false };
	};

	it("a proposal already on the strip is left out, by the origin Build stored or by the same readings; each takes Build's label, told apart when taken", () => {
		const all = bm.proposeScreens(groups, { slots: 6 });
		const [cpu, gpu] = all as [BuiltScreen, BuiltScreen];
		const existing = [
			{ name: "GPU Temperature", raw: rawOf(gpu) },
			{ name: "CPU", raw: { style: "trend", series: [{ key: cpu.series[0] }] } },
			// Built before, then changed by hand: its origin still says Cooling.
			{ name: "Fans", raw: { style: "group", group: { from: "filter", filter: "*fan*", keys: [], view: "auto" } }, origin: "cooling" }
		];
		const built = bm.buildProposal(groups, { slots: 6, existing });
		assert.deepEqual(built.skipped, ["GPU", "Cooling"], "GPU draws what the first screen draws; Cooling was built before");
		assert.deepEqual(
			built.screens.map((x) => [x.id, x.shownName, x.storeName]),
			[
				["cpu", "CPU (Lanes)", "CPU (Lanes)"],
				["cpu-gpu", "CPU and GPU", "CPU and GPU"],
				["temps", "Every temperature", "Every temperature"]
			],
			"Build's label, told apart by how it draws when another screen shows it; never a number"
		);
		// Built again with what the first Build added: everything is there.
		const withBuilt = [...existing, ...built.screens.map((x) => ({ name: x.shownName ?? x.name, raw: rawOf(x), origin: x.id }))];
		const again = bm.buildProposal(groups, { slots: 6, existing: withBuilt });
		assert.deepEqual([again.screens.length, again.skipped], [0, ["CPU", "GPU", "CPU and GPU", "Cooling", "Every temperature"]]);
		const named = bm.buildProposal(groups, { slots: 6, existing: [{ name: "every temperature", raw: { style: "trend", series: [{ key: cpu.series[0] }] } }] });
		assert.deepEqual(named.screens.find((x) => x.id === "temps")?.storeName, "Every temperature (Ambient)", "a name taken in any case is told apart");
		assert.ok([...built.screens, ...named.screens].every((x) => !/\s\d+$/.test(x.shownName ?? "")), "never CPU 2");
		// A new strip: nothing to compare with, each by Build's label.
		assert.deepEqual(bm.buildProposal(groups, { slots: 6 }).screens.map((x) => [x.id, x.storeName]), all.map((x) => [x.id, x.name]));
	});

	it("what a screen draws compares as a set of readings, a filter as typed in any case, a unit, a folder by its reading", () => {
		const same = (k: string): string => (k === "b" ? "a" : k);
		assert.equal(bm.readingsOf({ style: "trend", series: [{ key: "b" }, { key: "c" }] }), bm.readingsOf({ style: "lanes", series: [{ key: "c" }, { key: "b" }] }));
		assert.equal(bm.readingsOf({ style: "trend", series: [{ key: "a" }, { key: "b" }] }, same), "keys:a", "a linked alias is its reading");
		assert.equal(bm.readingsOf({ style: "group", group: { from: "list", keys: ["c", "b"], view: "auto" } }), bm.readingsOf({ style: "compare", series: [{ key: "b" }, { key: "c" }] }));
		assert.equal(bm.readingsOf({ style: "group", group: { from: "filter", filter: "*Core*Clock*", keys: [], view: "rows" } }), bm.readingsOf({ style: "ambient", group: { from: "filter", filter: "*core*clock*", keys: [], view: "auto" } }));
		assert.equal(bm.readingsOf({ style: "ambient", group: { from: "unit", unit: "°C", keys: [], view: "auto" } }), "unit:°C");
		assert.equal(bm.readingsOf({ style: "group", series: [{ key: "a" }] }), "folder:a");
		assert.equal(bm.readingsOf({ style: "group", group: { from: "filter", keys: [], view: "auto" } }), null, "an empty filter draws nothing yet");
		assert.equal(bm.readingsOf({ style: "trend", series: [] }), null);
	});

	it("names from what a screen draws: Build's label while it draws what Build gave it, else its first reading's sensor with +N; never a filter or a unit phrase", () => {
		assert.equal(bm.sensorShortName("CPU [#0]: AMD Ryzen 9 7950X: Enhanced"), "CPU");
		assert.equal(bm.sensorShortName("GPU [#1]: NVIDIA GeForce RTX 4090"), "GPU [#1]");
		assert.equal(bm.sensorShortName("ASUS ROG STRIX X670E-E GAMING WIFI (Nuvoton NCT6799D)"), "ASUS ROG STRIX X670E-E GAMING WIFI");
		assert.equal(bm.sensorShortName("Windows Hardware Errors (WHEA)"), "Windows Hardware Errors");
		assert.equal(bm.sensorShortName("DIMM Temperature Sensor"), "DIMM Temperature Sensor");
		const ctx = { groups, readingOf, slots: 6 };
		const all = bm.proposeScreens(groups, { slots: 6 });
		const cpu = all.find((x) => x.id === "cpu") as BuiltScreen;
		const temps = all.find((x) => x.id === "temps") as BuiltScreen;
		const tctl = cpu.series[0] as string;
		const gpuTemp = (all.find((x) => x.id === "gpu") as BuiltScreen).series[0] as string;
		// Built, and still drawing what Build gave it: Build's label.
		assert.deepEqual(bm.contentNames(rawOf(cpu), "cpu", ctx), ["CPU", "CPU (Lanes)", "CPU (CPU (Tctl/Tdie))"]);
		assert.deepEqual(bm.contentNames({ ...rawOf(cpu), style: "trend" }, "cpu", ctx)[0], "CPU", "another style over the same readings keeps it");
		assert.deepEqual(bm.contentNames(rawOf(temps), "temps", ctx)[0], "Every temperature");
		// Its readings changed: the origin no longer names it.
		assert.deepEqual(bm.contentNames({ style: "lanes", series: [{ key: tctl }, { key: gpuTemp }] }, "cpu", ctx), ["CPU +1", "CPU (Tctl/Tdie) +1", "CPU: CPU (Tctl/Tdie)"]);
		assert.deepEqual(bm.contentNames({ style: "trend", series: [{ key: tctl }] }, "cpu", ctx), ["CPU", "CPU (Tctl/Tdie)", "CPU: CPU (Tctl/Tdie)"]);
		// A filter or a unit with no Build label: its first reading's sensor.
		const clocks = bm.contentNames({ style: "group", group: { from: "filter", filter: "*core*clock*", keys: [], view: "rows" } }, "clocks", ctx);
		assert.equal(clocks[0], "CPU", "a filter is named by its first reading's sensor, never as typed");
		assert.ok(!clocks.some((x) => x.includes("*")));
		const unit = bm.contentNames({ style: "ambient", group: { from: "unit", unit: "°C", keys: [], view: "auto" } }, undefined, ctx);
		assert.ok(unit[0] === "CPU" && !unit.some((x) => /Every/.test(x)), JSON.stringify(unit));
		assert.deepEqual(bm.contentNames({ style: "group", group: { from: "filter", keys: [], view: "auto" } }, undefined, ctx), [], "nothing yet: no name");
		assert.deepEqual(bm.contentNames({ style: "trend", series: [{ key: "f0099999:0:1" }] }, undefined, ctx), [], "a reading HWiNFO does not list names nothing");
		assert.equal(bm.moreOf({ style: "trend", series: [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }] }), 2, "+N counts what the style draws");
		// The first reading of each kind of screen.
		const t = tree();
		assert.equal(bm.firstReadingOf({ style: "trend", series: [{ key: GPU_TEMP }, { key: CPU_TEMP }] }, t), GPU_TEMP);
		assert.equal(bm.firstReadingOf({ style: "group", group: { from: "filter", filter: "*gpu*temp*", keys: [], view: "auto" } }, t), "e0002000:0:1000000", "a filter: the first reading it takes on this PC");
		assert.equal(bm.firstReadingOf({ style: "group", group: { from: "list", keys: [CPU_TEMP], view: "auto" } }, t), CPU_TEMP);
		assert.equal(bm.firstReadingOf({ style: "group", series: [{ key: GPU_TEMP }] }, t), GPU_TEMP, "a folder: its reading");
		assert.equal(bm.firstReadingOf({ style: "ambient", group: { from: "unit", unit: "°C", keys: [], view: "auto" } }, t), CPU_TEMP, "a unit: its first reading in that unit");
		// How a name moves with what the screen draws.
		const label = bm.contentNames(rawOf(cpu), "cpu", ctx);
		const changed = bm.contentNames({ style: "lanes", series: [{ key: tctl }, { key: gpuTemp }] }, "cpu", ctx);
		const gpu = bm.contentNames({ style: "trend", series: [{ key: gpuTemp }] }, undefined, ctx);
		assert.equal(bm.nameAfter({ own: "", before: [], after: gpu, others: ["CPU"] }), "dGPU", "a screen added by hand takes its first reading's sensor (dGPU [#0]: ...)");
		assert.equal(bm.nameAfter({ own: "", before: [], after: gpu, others: ["DGPU"] }), "GPU Temperature", "never a name another screen shows");
		assert.equal(bm.nameAfter({ own: "CPU", before: label, after: changed, others: [] }), "CPU +1", "Build's label goes when the readings change");
		assert.equal(bm.nameAfter({ own: "CPU +1", before: changed, after: label, others: [] }), "CPU", "and comes back when they are Build's again");
		assert.equal(bm.nameAfter({ own: "CPU (Lanes)", before: label, after: changed, others: ["CPU +1"] }), "CPU (Tctl/Tdie) +1", "a told-apart label follows too, told apart again");
		assert.equal(bm.nameAfter({ own: "dGPU", before: gpu, after: [], others: [] }), "", "a taken name goes when the screen draws nothing again");
		assert.equal(bm.nameAfter({ own: "dGPU", before: gpu, after: gpu, others: [] }), null, "the same name sends nothing");
		assert.equal(bm.nameAfter({ own: "My CPU", before: label, after: changed, others: [] }), null, "a name the person gave stays");
		assert.equal(bm.nameAfter({ own: "", before: gpu, after: changed, others: [] }), null, "a screen that drew before without a name keeps its automatic one");
	});
});

describe("Screens: the plugin and the panel name a screen alike", () => {
	for (const fahrenheit of [false, true]) {
		it(`over every style, every rule source, listed, unlisted and self-named readings, ${fahrenheit ? "°F" : "°C"} on the strip`, () => {
			names(fahrenheit);
		});
	}
	function names(fahrenheit: boolean): void {
		const snapshot = censusSnapshot();
		const tree = buildSensorTree({ state: "ok", snapshot, source: "shared-memory" }).groups as unknown as TreeGroup[];
		const index = new Map<string, { group: TreeGroup; label: string }>();
		for (const group of tree) for (const r of group.readings) for (const key of [r.key, ...(r.keys ?? [])]) if (!index.has(key)) index.set(key, { group, label: r.label });
		const readingOf = (key: string): { label: string; source: string; found: boolean } => {
			const hit = index.get(key);
			return hit === undefined ? { label: key, source: "", found: false } : { label: hit.label, source: hit.group.name, found: true };
		};
		const keyOf = (label: string): string => (snapshot.readings.find((r) => r.label === label) as Reading).key;
		const gpu = keyOf("GPU Temperature");
		const cpu = keyOf("CPU (Tctl/Tdie)");
		const rules = [undefined, { from: "folder", keys: [], view: "auto" }, { from: "filter", keys: [], view: "auto" }, { from: "filter", filter: "*gpu*temp*", keys: [], view: "auto" }, { from: "list", keys: [gpu, cpu], view: "auto" }, { from: "list", keys: ["f0099999:0:1", gpu], view: "auto" }, { from: "unit", unit: "°C", keys: [], view: "auto" }, { from: "unit", keys: [], view: "auto" }];
		const lists = [[], [{ key: gpu }], [{ key: gpu }, { key: cpu }], [{ key: "f0099999:0:1" }], [{ key: cpu, name: "Package" }, { key: gpu }]];
		let compared = 0;
		for (const style of STRIP_STYLES) {
			for (const group of rules) {
				for (const series of lists) {
					const raw = { style, series, ...(group === undefined ? {} : { group }) };
					assert.equal(s.autoName(raw, { readingOf, fahrenheit }), autoScreenName(stripPaneOf(raw), snapshot, undefined, { fahrenheit }), JSON.stringify(raw));
					compared++;
				}
			}
		}
		assert.equal(compared, STRIP_STYLES.length * rules.length * lists.length);
	}
});

describe("Large values only: no graph, so Graph means nothing", () => {
	type OnlyModel = {
		isValuesOnly(pane: { style: string; readout?: string }): boolean;
		drawMax(style: string, slots?: number, readout?: string): number;
		seriesRows(style: string, readings: { key: string; label: string; unit?: string }[], ctx?: { slots?: number; readout?: string }): { drawn: boolean; reason: string | null }[];
		styleCheck(style: string, readings: { key: string; label: string; unit?: string }[], ctx?: { slots?: number; readout?: string }): { note: string | null; fit: string | null };
		overlayUsed(style: string, overlay: string, view?: string, readout?: string): boolean;
		moreOf(raw: unknown): number;
	};
	const o = m as unknown as OnlyModel;
	const reading = (i: number): { key: string; label: string; unit: string } => ({ key: String(i), label: `R${i}`, unit: i % 2 === 0 ? "°C" : "W" });
	const six = [0, 1, 2, 3, 4, 5].map(reading);

	it("it is a pane's own state: Meters, Events, Group and Ambient keep a stored readout unused", () => {
		for (const style of ["trend", "area", "compare", "lanes", "heat"]) assert.equal(o.isValuesOnly({ style, readout: "only" }), true, style);
		for (const style of ["meters", "events", "group", "ambient"]) assert.equal(o.isValuesOnly({ style, readout: "only" }), false, style);
		for (const readout of ["off", "left", undefined]) assert.equal(o.isValuesOnly({ style: "trend", readout }), false, String(readout));
	});

	it("every ticked reading draws, up to two a dial slot, whatever Graph is stored", () => {
		for (const style of ["trend", "area", "compare", "lanes", "heat"]) {
			assert.equal(o.drawMax(style, 6, "only"), 6, style);
			assert.equal(o.drawMax(style, 2, "only"), 4, style);
			assert.deepEqual(o.seriesRows(style, six, { slots: 6, readout: "only" }).map((r) => r.reason), [null, null, null, null, null, null], style);
			assert.deepEqual(o.seriesRows(style, six, { slots: 2, readout: "only" }).map((r) => r.reason), [null, null, null, null, "limit", "limit"], style);
		}
		assert.equal(o.drawMax("trend", 6), 3, "Trend itself still draws three");
		assert.equal(o.drawMax("meters", 2, "only"), 2, "Meters draws one a slot, a stored readout or not");
	});

	it("no line asks for another Graph or for a second reading", () => {
		for (const style of ["trend", "compare", "lanes", "heat"]) {
			assert.deepEqual(o.styleCheck(style, six.slice(0, 1), { slots: 6, readout: "only" }), { note: null, fit: null }, style);
			assert.deepEqual(o.styleCheck(style, six, { slots: 6, readout: "only" }), { note: null, fit: null }, style);
		}
		assert.deepEqual(o.styleCheck("trend", [], { slots: 6, readout: "only" }), { note: "Pick a reading for this graph.", fit: null });
	});

	it("a screen's +N counts what it draws", () => {
		const series = six.map((r) => ({ key: r.key }));
		assert.equal(o.moreOf({ style: "trend", readout: "only", series }), 5);
		assert.equal(o.moreOf({ style: "trend", series }), 2);
	});

	it("Show on the graph: Unit, Names and Time span, whatever Graph is stored", () => {
		for (const style of ["trend", "area", "compare", "lanes", "heat"]) {
			for (const [overlay, used] of [["current", false], ["minmax", false], ["axes", false], ["unit", true], ["legend", true], ["time", true]] as const) assert.equal(o.overlayUsed(style, overlay, undefined, "only"), used, `${style} ${overlay}`);
		}
		assert.equal(o.overlayUsed("meters", "unit", undefined, "only"), true, "Meters keeps its own");
		assert.equal(o.overlayUsed("meters", "current", undefined, "only"), false, "Meters keeps its own");
	});
});

describe("Scale from and Scale to keep the unit they were typed in (40-spec-final.md 7.3)", () => {
	type ScaleModel = {
		scaleTypedOf(scale: Record<string, unknown>, end: "min" | "max", n: number | undefined, view: string | undefined): Record<string, unknown>;
		scaleShownOf(scale: Record<string, unknown>, view: string | undefined): { min?: number; max?: number };
		stampOf(entry: unknown, names: readonly string[]): string | undefined;
		scaleTagOf(scale: Record<string, unknown>, view: string | undefined): string;
		scaleHelpKey(style: string, scale: Record<string, unknown>, views: readonly string[]): string | null;
		scaleShown(style: string, readout: string | undefined, units: readonly string[]): string;
		shownNumber(n: number): string;
		limitsTypedOf(entry: Record<string, unknown>, kind: "warn" | "crit", n: number | undefined, view: string): Record<string, unknown>;
		limitsShownOf(entry: Record<string, unknown>, view: string): { warn?: number; crit?: number };
	};
	const s = m as unknown as StripModel & ScaleModel;

	it("typing writes both ends as they show with a record that makes the stamp count, and the plugin lands it", () => {
		const typed = s.scaleTypedOf({}, "max", 90, "°C");
		assert.deepEqual(typed, { max: 90, displayUnit: "°C", displayUnitFor: { max: "90" } });
		assert.equal(s.stampOf(typed, ["min", "max"]), "°C");
		assert.equal(stripPaneOf({ scale: typed }).scale.displayUnit, "°C", "the plugin's parser agrees");
		assert.deepEqual(s.scaleTypedOf(typed, "max", undefined, "°C"), {}, "both blank clears all four fields");
	});

	it("diffOps sends the four scale fields, and the plugin applies them", () => {
		const base = newStripConfig("whole", 4, stripSeedOf({ readingKey: GPU_TEMP }));
		const w = m.workingOf(stripConfigToJson(base));
		const typed = clone(w);
		typed.panes[0].scale = s.scaleTypedOf({}, "max", 90, "°C");
		const ops = m.diffOps(w, typed, { layout: true });
		assert.deepEqual(ops, [
			{ op: "set", path: "panes.0.scale.max", value: 90 },
			{ op: "set", path: "panes.0.scale.displayUnit", value: "°C" },
			{ op: "set", path: "panes.0.scale.displayUnitFor", value: { max: "90" } }
		]);
		const on = applyStripEdit({ id: "x", rev: 1, config: base }, 1, ops, { deviceEncoders: 4 });
		assert.ok(on.ok, JSON.stringify(on));
		if (!on.ok) return;
		assert.deepEqual(on.copy.config.panes[0].scale, { max: 90, displayUnit: "°C" });
		assert.deepEqual(m.workingOf(stripConfigToJson(on.copy.config)).panes[0].scale, { max: 90, displayUnit: "°C", displayUnitFor: { max: "90" } });
		const cleared = m.diffOps(typed, w, { layout: true });
		assert.deepEqual(
			cleared.map((o) => o.path),
			["panes.0.scale.max", "panes.0.scale.displayUnit", "panes.0.scale.displayUnitFor"]
		);
	});

	it("90 typed in °C shows 194 after the °F switch; an unstamped number shows as stored", () => {
		const typed = { max: 90, displayUnit: "°C", displayUnitFor: { max: "90" } };
		assert.equal(s.shownNumber(s.scaleShownOf(typed, "°F").max as number), "194");
		assert.equal(s.scaleTagOf(typed, "°F"), "(°F)");
		assert.deepEqual(s.scaleShownOf({ max: 90 }, "°F"), { max: 90 });
		// Typing the other end under °F stamps both in °F.
		assert.deepEqual(s.scaleTypedOf(typed, "min", 86, "°F"), { min: 86, max: 194, displayUnit: "°F", displayUnitFor: { min: "86", max: "194" } });
	});

	it("bands and Group limits are stamped the same way", () => {
		const band = s.limitsTypedOf({ key: "k", below: false, unit: "°C" }, "warn", 80, "°C");
		assert.deepEqual(band, { key: "k", below: false, unit: "°C", warn: 80, displayUnit: "°C", displayUnitFor: { warn: "80" } });
		assert.deepEqual(s.limitsShownOf(band, "°F"), { warn: 176 });
		assert.equal(stripPaneOf({ series: [{ key: "k" }], bands: [band] }).bands[0]?.displayUnit, "°C");
	});

	// Help never grows (the owner, 2026-10-25): no standing line under the
	// fields. Their placeholder Auto and the unit tag carry it; the one line
	// shows only while stored ends do not apply to the graph.
	it("the help line, only while the ends do not apply, and where the fields show", () => {
		assert.equal(s.scaleHelpKey("trend", {}, ["°C"]), null, "blank ends: no line");
		assert.equal(s.scaleHelpKey("trend", { max: 90, displayUnit: "°C", displayUnitFor: { max: "90" } }, ["°C"]), null, "ends in use: no line");
		assert.equal(s.scaleHelpKey("trend", { min: 30, max: 90, displayUnit: "°C", displayUnitFor: { min: "30", max: "90" } }, ["W"]), "pi.strip.scaleNotUsed", "a °C scale over a W reading");
		assert.equal(s.scaleHelpKey("lanes", { min: 30, max: 90 }, ["°C", "W"]), "pi.strip.scaleNotUsed", "a scale stored before the stamp on Lanes");
		assert.equal(s.scaleShown("trend", "off", ["°C"]), "both");
		assert.equal(s.scaleShown("trend", "only", ["°C"]), "none", "Large values only");
		assert.equal(s.scaleShown("trend", "off", ["Yes/No"]), "none", "Yes/No is always 0 to 1");
		for (const style of ["group", "events", "ambient"]) assert.equal(s.scaleShown(style, "off", ["°C"]), "none", style);
	});

	it("a reading with no unit stamps the empty unit: the ends apply on Lanes, and no line says they do not", () => {
		const typed = s.scaleTypedOf({}, "max", 2, "");
		assert.deepEqual(typed, { max: 2, displayUnit: "", displayUnitFor: { max: "2" } });
		assert.equal(s.stampOf(typed, ["min", "max"]), "");
		assert.equal(stripPaneOf({ scale: typed }).scale.displayUnit, "", "the plugin's parser agrees");
		for (const style of ["lanes", "trend", "meters"]) assert.equal(s.scaleHelpKey(style, typed, ["", "°C"]), null, style);
		assert.equal(s.scaleHelpKey("lanes", typed, ["°C"]), "pi.strip.scaleNotUsed", "no reading without a unit left");
		assert.equal(s.scaleTagOf(typed, ""), "", "no unit, no tag");
		assert.deepEqual(s.scaleShownOf(typed, ""), { max: 2 });
		assert.deepEqual(s.scaleTypedOf({}, "max", 2, undefined), { max: 2 }, "an unknown reading stamps nothing");
		const base = newStripConfig("whole", 4, stripSeedOf({ readingKey: GPU_TEMP }));
		const w = m.workingOf(stripConfigToJson(base));
		const next = clone(w);
		next.panes[0].scale = typed;
		const ops = m.diffOps(w, next, { layout: true });
		assert.deepEqual(ops, [
			{ op: "set", path: "panes.0.scale.max", value: 2 },
			{ op: "set", path: "panes.0.scale.displayUnit", value: "" },
			{ op: "set", path: "panes.0.scale.displayUnitFor", value: { max: "2" } }
		]);
		const on = applyStripEdit({ id: "x", rev: 1, config: base }, 1, ops, { deviceEncoders: 4 });
		assert.ok(on.ok, JSON.stringify(on));
		if (!on.ok) return;
		assert.deepEqual(on.copy.config.panes[0].scale, { max: 2, displayUnit: "" });
		assert.deepEqual(m.workingOf(stripConfigToJson(on.copy.config)).panes[0].scale, typed, "the working copy keeps the empty stamp");
		const cleared = m.diffOps(next, w, { layout: true });
		assert.deepEqual(
			cleared.map((o) => [o.path, o.value]),
			[
				["panes.0.scale.max", null],
				["panes.0.scale.displayUnit", null],
				["panes.0.scale.displayUnitFor", null]
			]
		);
	});

});

describe("the strip's own unit and decimals per reading (issue #59)", () => {
	const A = "a1:0:5";
	const B = "a2:0:5";
	const live = (): ReturnType<typeof stripConfigToJson> => stripConfigToJson(stripConfigOf({ layout: "whole", encoders: 6, panes: [{ style: "trend", series: [{ key: A }, { key: B }] }], readingFormats: { [A]: { unit: "GB", decimals: "2" } } }));
	type WithFormats = Working & { readingFormats?: Record<string, unknown> | null };

	it("the working draft holds the strip's map, and a change is one set of the whole map the plugin accepts", () => {
		const base = live();
		const w = m.workingOf(base) as WithFormats;
		assert.deepEqual(w.readingFormats, { [A]: { unit: "GB", decimals: "2" } });
		assert.deepEqual(m.patchOf(base, w), [], "opening sends nothing");
		const next = clone(w);
		next.readingFormats = { [A]: { unit: "GB", decimals: "2" }, [B]: { unit: "GiB" } };
		const ops = m.patchOf(base, next);
		assert.deepEqual(ops, [{ op: "set", path: "readingFormats", value: { [A]: { unit: "GB", decimals: "2" }, [B]: { unit: "GiB" } } }]);
		const applied = applyStripEdit({ id: "0123456789abcdef0123456789abcdef", rev: 1, config: stripConfigOf(base) }, 1, ops);
		const stored = applied.ok ? applied.copy.config.readingFormats : undefined;
		assert.ok(stored !== undefined && Object.keys(stored).length === 2, JSON.stringify(stored));
		const cleared = clone(w);
		cleared.readingFormats = null;
		assert.deepEqual(m.patchOf(base, cleared), [{ op: "set", path: "readingFormats", value: null }]);
	});

});
