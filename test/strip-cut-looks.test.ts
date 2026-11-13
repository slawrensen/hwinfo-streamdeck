/**
 * Fleet, Bars, Envelope and Silk left the strip before 1.8 shipped. A setup
 * stored by a 1.8 preview must still draw sensibly and stay as stored until
 * a person edits that pane:
 *
 * - a stored Envelope or Bars reads as a Trend with its series;
 * - a stored Fleet reads as a Group over the same rule, view Now;
 * - a stored Silk reads as Ambient, which is Aurora;
 * - an edit elsewhere writes the pane back exactly as stored; a person's
 *   edit of the pane writes what it reads as, and their edit holds.
 *
 * And what the panel offers follows: nine graphs, no Look row for the cut
 * looks (the only Look is Meters' own: Thin bar, Full bar and Liquid),
 * Build's Cooling as a Group column per fan when fans outnumber dials.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { EN, PANEL } from "../src/i18n-catalog";
import { SensorType } from "../src/hwinfo/types";
import { applyStripEdit } from "../src/strip/edits";
import { resolveGroup } from "../src/strip/group";
import { STRIP_STYLES, stripConfigOf, stripConfigToJson, stripPaneOf } from "../src/strip/settings";
import { loadPanelModels } from "./panel-models";
import { ruleRuntime, snap, type RuleRuntime, type Spec } from "./strip-rule-runtime";

const ID = "0123456789abcdef0123456789abcdef";
const KEPT = ["trend", "area", "compare", "lanes", "heat", "group", "ambient", "meters", "events"];

const repo = (p: string): string => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p: string): string => readFileSync(repo(p), "utf8");

/** A PC with eight fans, a few temperatures and a usage. */
function machine(): Spec[] {
	return [
		...Array.from({ length: 8 }, (_, i) => ({ sensor: "Board", label: `Fan ${i + 1}`, unit: "RPM", value: 900 + 100 * i, type: SensorType.Fan })),
		...Array.from({ length: 30 }, (_, i) => ({ sensor: "CPU", label: `Core ${i} Temperature`, unit: "°C", value: 45 + (i % 9), type: SensorType.Temperature })),
		{ sensor: "CPU", label: "Total CPU Usage", unit: "%", value: 40, type: SensorType.Usage }
	];
}
const KEY0 = (snap(machine()).readings[0] as { key: string }).key;
const KEY1 = (snap(machine()).readings[1] as { key: string }).key;

const stored = (pane: Record<string, unknown>, top: Record<string, unknown> = {}): Record<string, unknown> => ({ layout: "whole", encoders: 6, window: "5m", panes: [pane, {}], ...top });

/** A real runtime whose six dials appear holding `pane` as stored. */
function runtimeOf(pane: Record<string, unknown>): RuleRuntime {
	const rt = ruleRuntime(machine());
	rt.dials.forEach((d, c) => {
		rt.ctl.disappear(d.id, c);
		const doc = { readingKey: KEY0, stripGroup: { v: 1, id: ID, rev: 3, joined: true, config: stored(pane) } };
		rt.settings.set(d.id, doc);
		rt.ctl.appear(d, doc);
	});
	for (let k = 0; k < 4; k++) rt.tick();
	rt.flush();
	return rt;
}

const set = (path: string, value: unknown): { op: "set"; path: string; value: unknown } => ({ op: "set", path, value });

/** The first pane written back after `patch` on a config read from `doc`. */
function afterEdit(doc: Record<string, unknown>, patch: readonly unknown[]): Record<string, unknown> {
	const edited = applyStripEdit({ id: ID, rev: 1, config: stripConfigOf(doc) }, 1, patch);
	if (!edited.ok) throw new Error(JSON.stringify(edited));
	return (stripConfigToJson(edited.copy.config) as { panes: Record<string, unknown>[] }).panes[0] as Record<string, unknown>;
}

describe("the Graph list after the cuts", () => {
	it("holds nine styles, and an edit cannot pick a cut one", () => {
		assert.deepEqual([...STRIP_STYLES], KEPT);
		for (const style of ["fleet", "bars", "envelope"]) assert.equal(applyStripEdit({ id: ID, rev: 1, config: stripConfigOf(stored({ style: "trend" })) }, 1, [set("panes.0.style", style)]).ok, false, style);
		assert.equal(applyStripEdit({ id: ID, rev: 1, config: stripConfigOf(stored({ style: "ambient" })) }, 1, [set("panes.0.ambient", { look: "aurora" })]).ok, false, "no Look to set");
	});
});

describe("a stored Envelope or Bars reads as a Trend with its series", () => {
	for (const style of ["envelope", "bars"]) {
		it(`${style}: the same frame as a Trend, the style and every field kept through an edit elsewhere`, () => {
			const pane = { series: [{ key: KEY0 }, { key: KEY1 }], overlays: { current: true, minmax: true, unit: true, legend: true, time: true }, future: 1 };
			const parsed = stripPaneOf({ style, ...pane });
			assert.equal(parsed.style, "trend");
			assert.deepEqual(parsed.series.map((s) => s.key), [KEY0, KEY1]);
			assert.deepEqual(runtimeOf({ style, ...pane }).slices(), runtimeOf({ style: "trend", ...pane }).slices());
			const written = afterEdit(stored({ style, ...pane }), [set("window", "15m")]);
			assert.equal(written.style, style);
			assert.equal(written.future, 1);
		});

		it(`${style}: a person's edit of the pane writes a Trend`, () => {
			assert.equal(afterEdit(stored({ style, series: [{ key: KEY0 }] }), [set("panes.0.readout", "left")]).style, "trend");
		});
	}
});

describe("a stored Fleet reads as a Group over the same rule, view Now", () => {
	const rule = { from: "unit", unit: "RPM", keys: [], view: "auto" };

	it("the Fleet Build made: the same frame as a Group Now of the eight fans, not an empty Trend", () => {
		const pane = { series: [], group: rule, name: "Cooling", origin: "cooling" };
		const parsed = stripPaneOf({ style: "fleet", ...pane });
		assert.equal(parsed.style, "group");
		assert.deepEqual(parsed.group, { ...rule, view: "now" });
		assert.equal(resolveGroup(snap(machine()), parsed).keys.length, 8);
		const fleet = runtimeOf({ style: "fleet", ...pane }).slices();
		assert.deepEqual(fleet, runtimeOf({ style: "group", ...pane, group: { ...rule, view: "now" } }).slices());
		assert.match(fleet.join(""), />1600</, "a column's value");
		assert.doesNotMatch(fleet.join(""), /Choose readings/);
	});

	it("whatever view it kept, and with no rule at all: the folder of its reading", () => {
		assert.equal(stripPaneOf({ style: "fleet", group: { ...rule, view: "tiles" } }).group?.view, "now");
		assert.deepEqual(stripPaneOf({ style: "fleet", series: [{ key: KEY0 }] }).group, { from: "folder", keys: [], view: "now" });
		assert.equal(resolveGroup(snap(machine()), stripPaneOf({ style: "fleet", series: [{ key: KEY0 }] })).keys.length, 8);
	});

	it("a filter rule and its limits come along", () => {
		const limits = { warn: 2000, crit: 3000, below: false, unit: "RPM" };
		const parsed = stripPaneOf({ style: "fleet", group: { from: "filter", filter: "*fan*", keys: [], view: "auto", limits } });
		assert.deepEqual(parsed.group, { from: "filter", filter: "*fan*", keys: [], view: "now", limits });
	});

	it("an edit elsewhere writes the pane back exactly as stored", () => {
		for (const pane of [{ style: "fleet", series: [], group: { ...rule, future: 2 }, name: "Cooling", origin: "cooling", future: 1 }, { style: "fleet", series: [{ key: KEY0 }] }]) {
			const written = afterEdit(stored(pane), [set("window", "15m")]);
			for (const [field, value] of Object.entries(pane)) assert.deepEqual(written[field], value, field);
			assert.equal("group" in written, "group" in pane);
		}
	});

	it("a person's edit of the pane makes it the Group it reads as, keeping what it holds", () => {
		const pane = { style: "fleet", series: [], group: { ...rule, limits: { crit: 3000, below: false, unit: "RPM" }, future: 2 }, future: 1 };
		const named = afterEdit(stored(pane), [set("panes.0.name", "Fans")]);
		assert.equal(named.style, "group");
		assert.deepEqual(named.group, { future: 2, from: "unit", unit: "RPM", keys: [], view: "now", limits: { crit: 3000, below: false, unit: "RPM" } });
		assert.equal(named.future, 1);
		assert.equal((afterEdit(stored({ style: "fleet", series: [{ key: KEY0 }] }), [set("panes.0.overlays.current", false)]).group as { view: string }).view, "now", "no rule stored: the folder rule, view Now");
		assert.equal(afterEdit(stored(pane), [set("panes.0.style", "trend")]).style, "trend");
	});

	it("a person's View holds: it is not read back as Now", () => {
		const doc = stored({ style: "fleet", series: [], group: rule });
		const edited = applyStripEdit({ id: ID, rev: 1, config: stripConfigOf(doc) }, 1, [set("panes.0.group", { ...rule, view: "rows" })]);
		assert.ok(edited.ok);
		assert.equal(edited.copy.config.panes[0].style, "group");
		assert.equal(edited.copy.config.panes[0].group?.view, "rows");
		const again = stripConfigOf(stripConfigToJson(edited.copy.config));
		assert.equal(again.panes[0].group?.view, "rows");
	});

	it("a stored Fleet as a later screen too", () => {
		const doc = stored({ style: "trend", screenId: "00000001" }, { screens: [{ style: "fleet", series: [], group: rule, screenId: "00000002" }] });
		const config = stripConfigOf(doc);
		assert.equal(config.screens?.[0]?.style, "group");
		const edited = applyStripEdit({ id: ID, rev: 1, config }, 1, [set("window", "15m")]);
		assert.ok(edited.ok);
		const written = stripConfigToJson(edited.copy.config) as { screens: Record<string, unknown>[] };
		assert.equal(written.screens[0]?.style, "fleet");
		assert.deepEqual(written.screens[0]?.group, rule);
	});
});

describe("a stored Silk reads as Ambient, which is Aurora", () => {
	const rule = { from: "unit", unit: "°C", keys: [], view: "auto" };

	it("the same frame as an Ambient with no look, and every reading a thread: past Silk's 24", () => {
		const silk = { style: "ambient", series: [], ambient: { look: "silk" }, group: rule };
		assert.equal(resolveGroup(snap(machine()), stripPaneOf(silk)).keys.length, 30);
		assert.deepEqual(runtimeOf(silk).slices(), runtimeOf({ style: "ambient", series: [], group: rule }).slices());
	});

	it("the stored field stays as it was through every edit", () => {
		const silk = { style: "ambient", series: [], ambient: { look: "silk", sheen: 2 }, group: rule };
		assert.deepEqual(afterEdit(stored(silk), [set("window", "15m")]).ambient, silk.ambient);
		assert.deepEqual(afterEdit(stored(silk), [set("panes.0.name", "Heat")]).ambient, silk.ambient);
	});
});

// ---- the panel --------------------------------------------------------------------

type Model = {
	STYLES: string[];
	STYLE_NAMES: Record<string, string>;
	paneOf(raw: unknown): { style: string; series: { key: string }[]; group: { view: string; from: string } | null; ambient?: unknown };
	workingOf(config: unknown): { panes: { group: { view: string } | null }[] };
	patchOf(base: unknown, working: unknown): unknown[];
	proposeScreens(groups: unknown, options: { slots: number }): { id: string; style: string; group: unknown; count: number; labels: string[]; unit?: string }[];
	buildScreenLine(screen: unknown): string;
	buildScreensOps(screens: unknown, options?: { start?: number; first?: unknown }): unknown[] | null;
};
const m = loadPanelModels<Model>().hwStripModel;

const fans = (n: number): unknown[] => [
	{ name: "CPU", readings: [{ key: "c:0:1", label: "CPU (Tctl/Tdie)", unit: "°C", type: 1 }] },
	{ name: "Board", readings: Array.from({ length: n }, (_, i) => ({ key: `b:0:${i + 1}`, label: `Fan ${i + 1}`, unit: "RPM", type: 3, value: 900 })) }
];

describe("the panel reads a stored cut look as the plugin does", () => {
	const rule = { from: "unit", unit: "RPM", keys: [], view: "auto" };

	it("the model's list is the plugin's", () => {
		assert.deepEqual(m.STYLES, KEPT);
		assert.deepEqual(Object.keys(m.STYLE_NAMES).sort(), [...KEPT].sort());
	});

	it("Fleet as Group, view Now; Envelope and Bars as Trend; Silk with no look", () => {
		const fleet = m.paneOf({ style: "fleet", series: [], group: rule });
		assert.equal(fleet.style, "group");
		assert.equal(fleet.group?.view, "now");
		assert.equal(fleet.group?.from, "unit");
		assert.equal(m.paneOf({ style: "fleet", series: [{ key: "k" }] }).group?.view, "now", "no rule stored");
		for (const style of ["envelope", "bars"]) assert.equal(m.paneOf({ style, series: [{ key: "k" }] }).style, "trend", style);
		assert.equal("ambient" in m.paneOf({ style: "ambient", ambient: { look: "silk" } }), false);
	});

	it("opening sends nothing, and a change of View lands through the plugin's edit", () => {
		const doc = stored({ style: "fleet", series: [], group: rule });
		const working = m.workingOf(doc);
		assert.deepEqual(m.patchOf(doc, working), []);
		for (const style of ["envelope", "bars"]) assert.deepEqual(m.patchOf(stored({ style, series: [{ key: "k" }] }), m.workingOf(stored({ style, series: [{ key: "k" }] }))), [], style);
		const silk = stored({ style: "ambient", ambient: { look: "silk" } });
		assert.deepEqual(m.patchOf(silk, m.workingOf(silk)), []);
		(working.panes[0]?.group as { view: string }).view = "rows";
		const edited = applyStripEdit({ id: ID, rev: 1, config: stripConfigOf(doc) }, 1, m.patchOf(doc, working));
		assert.ok(edited.ok);
		assert.equal(edited.copy.config.panes[0].style, "group");
		assert.equal(edited.copy.config.panes[0].group?.view, "rows");
	});
});

describe("Build's Cooling", () => {
	it("is a meter a fan while they fit the dials, then a Group column per fan", () => {
		assert.equal(m.proposeScreens(fans(6), { slots: 6 }).find((s) => s.id === "cooling")?.style, "meters");
		const cooling = m.proposeScreens(fans(8), { slots: 6 }).find((s) => s.id === "cooling");
		assert.ok(cooling !== undefined);
		assert.deepEqual([cooling.style, cooling.group, cooling.count], ["group", { from: "unit", unit: "RPM", keys: [], view: "now" }, 8]);
		assert.equal(m.buildScreenLine(cooling), "Cooling · Group Now · 8 readings in RPM");
	});

	it("lands through the plugin's edit as a Group Now of every fan", () => {
		const cooling = m.proposeScreens(fans(8), { slots: 6 }).filter((s) => s.id === "cooling");
		const ops = m.buildScreensOps(cooling, { start: 1 });
		assert.ok(ops !== null);
		let serial = 1;
		const edited = applyStripEdit({ id: ID, rev: 1, config: stripConfigOf(stored({ style: "trend", series: [{ key: KEY0 }] })) }, 1, ops, { mintScreenId: () => (serial++).toString(16).padStart(8, "0") });
		assert.ok(edited.ok, JSON.stringify(edited));
		const screen = edited.copy.config.screens?.[0];
		assert.equal(screen?.style, "group");
		assert.deepEqual(screen?.group, { from: "unit", unit: "RPM", keys: [], view: "now" });
		assert.equal(screen?.origin, "cooling");
		assert.equal(screen?.name, "Cooling");
	});
});

describe("what a person can see of the four looks", () => {
	const dialHtml = read("com.lawrensen.hwinfo.sdPlugin/ui/sensor-dial.html");

	it("both Graph lists hold the nine, and the one Look row is Meters' own, with none of the cut looks", () => {
		for (const pane of [0, 1]) {
			const list = new RegExp(`<select id="sp${pane}-style"[^>]*>([\\s\\S]*?)</select>`).exec(dialHtml)?.[1] ?? "";
			assert.deepEqual([...list.matchAll(/value="(\w+)"/g)].map((x) => x[1]), KEPT, `pane ${pane}`);
			const looks = new RegExp(`<select id="sp${pane}-look"[^>]*>([\\s\\S]*?)</select>`).exec(dialHtml)?.[1] ?? "";
			assert.deepEqual([...looks.matchAll(/value="(\w+)"/g)].map((x) => x[1]), ["thin", "full", "liquid"], `pane ${pane}`);
			assert.equal((dialHtml.match(new RegExp(`id="sp${pane}-look"`, "g")) ?? []).length, 1, `pane ${pane}: one Look`);
		}
	});

	it("no word of theirs in the catalogs or the generated strings", () => {
		const words = /\b(Fleet|Silk|Envelope)\b|\bBars\b|\bships?\b/;
		const catalog = JSON.stringify({ strip: EN.strip, pi: PANEL.pi.strip });
		assert.doesNotMatch(catalog, words);
		const looks = Object.entries(PANEL.pi.strip).filter(([, v]) => typeof v === "string" && /\bLook\b/.test(v));
		assert.deepEqual(looks, [["look", "Look"]], "Look names Meters' select and nothing else");
		assert.doesNotMatch(read("com.lawrensen.hwinfo.sdPlugin/en.json"), /\b(Fleet|Silk|Envelope)\b|Bars start|\bships\b/);
		assert.doesNotMatch(read("com.lawrensen.hwinfo.sdPlugin/ui/pi-strings.js"), /\b(Fleet|Silk|Envelope)\b|Bars ·/);
	});

	it("the docs and the changelog's 1.8 entry do not offer them", () => {
		const entry = read("CHANGELOG.md").split(/^## /m)[1] ?? "";
		for (const [name, text] of [["docs/strip-display.md", read("docs/strip-display.md")], ["README.md", read("README.md")], ["CHANGELOG 1.8", entry]] as const) {
			assert.doesNotMatch(text, /\b(Fleet|Silk|Envelope)\b|\*\*Bars\*\*/, name);
		}
		assert.match(read("README.md"), /A graph is one of nine styles: Trend, Area, Compare, Lanes, Heat, Group, Ambient, Meters or Events\./);
	});
});
