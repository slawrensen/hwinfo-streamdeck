/**
 * The strip's Group style (src/strip/group.ts and its scene, frame,
 * history, input and panel paths): a rule stored, never a key list, and
 * an older 1.8 reading a style it does not know as Trend without writing
 * it back; the rule resolved against each snapshot (folder, filter, list,
 * one unit, one PC, 32 drawn of more counted, readings HWiNFO adds or
 * renames followed, readings that leave kept in place); the density
 * ladder; Rows, Now, Spread and Lines drawn honestly (no alert by color
 * alone, the readout at its digit floor, every count said); every slice
 * within 8192 bytes under worst-case data; the group history allowance
 * apart from the keys' budget; and the gestures.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { JsonObject, JsonValue } from "@elgato/utils";

import { evenly, pollTrace, skipsAt, traceFrame, traceGroup } from "./brief-gap-fixture";
import { groupFixture } from "../scripts/lib/strip-fixtures";
import { deriveCapabilities } from "../src/devices";
import { ART_PIECE_LIMIT, isArtLook } from "../src/ui/deck-art";
import { DIAL_BACKGROUNDS } from "../src/ui/dial-background";
import { IDLE_GESTURE } from "../src/gestures";
import { GROUP_HISTORY_BUDGET_BYTES, HistoryStore, LINGER_MS } from "../src/history/store";
import { ENTRY_BYTES, TIERS } from "../src/history/window";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { StripController, type StripDialHandle, type StripHost } from "../src/strip/controller";
import { applyStripEdit } from "../src/strip/edits";
import { groupFrameOf } from "../src/strip/frame";
import { paneExtents, SLICE_W } from "../src/strip/geometry";
import { displayStep, GROUP_BOTTOM, GROUP_TOP, GROUP_TURN_PICKS_READING, groupColumns, groupDrawOf, groupPlotOf, groupRows, mergeRemembered, nextHome, resolveGroup } from "../src/strip/group";
import { routeStripInput, stripTriggerDescriptions, type StripRouting } from "../src/strip/input";
import type { CellsPrim, EnvelopePrim, LinePrim, TextPrim } from "../src/strip/prims";
import { digitMetrics } from "../src/strip/readout";
import { buildStripScene, renderLogical, stripBandsFor, textInkBox, type GroupPaneInfo, type StripPaneInput, type StripSceneInput } from "../src/strip/scene";
import { GROUP_DRAW_MAX, stripConfigOf, stripConfigToJson, stripPaneOf, stripPaneToJson, type StripPaneV1 } from "../src/strip/settings";
import { SLICE_PAYLOAD_LIMIT, sliceStrip, svgBytes } from "../src/strip/slicer";
import { MIN_FRAME_MS, type SchedulerClock } from "../src/strip/scheduler";

// ---- a synthetic HWiNFO list ------------------------------------------------

type Spec = { sensor: string; label: string; unit: string; value: number; type?: SensorType };

/** A snapshot: readings in the order given, one sensor per distinct name. */
function snap(specs: readonly Spec[], extra: Partial<SensorSnapshot> = {}): SensorSnapshot {
	const sensors: { index: number; id: number; instance: number; name: string }[] = [];
	const readings: Reading[] = specs.map((s, i) => {
		let index = sensors.findIndex((x) => x.name === s.sensor);
		if (index < 0) {
			index = sensors.length;
			sensors.push({ index, id: 0xf0 + index, instance: 0, name: s.sensor });
		}
		const key = `${(0xf0 + index).toString(16)}:0:${(0x100 + i).toString(16)}`;
		return { key, type: s.type ?? SensorType.Clock, sensorIndex: index, id: 0x100 + i, label: s.label, unit: s.unit, value: s.value, valueMin: s.value, valueMax: s.value, valueAvg: s.value };
	});
	return { pollTime: 1, version: 1, revision: 1, sensors, readings, byKey: new Map(readings.map((r) => [r.key, r])), ...extra };
}

/** 48 core clocks and 8 core temperatures in one folder, a fan folder. */
function cpu(clocks = 48, temps = 8): Spec[] {
	return [
		...Array.from({ length: clocks }, (_, i) => ({ sensor: "CPU [#0]: Example", label: `Core ${i} Clock`, unit: "MHz", value: 4800 + i })),
		...Array.from({ length: temps }, (_, i) => ({ sensor: "CPU [#0]: Example", label: `Core ${i} Temperature`, unit: "°C", value: 50 + i, type: SensorType.Temperature })),
		{ sensor: "Board", label: "CPU Fan", unit: "RPM", value: 1200, type: SensorType.Fan },
		{ sensor: "Board", label: "Pump", unit: "RPM", value: 2800, type: SensorType.Fan }
	];
}

const groupPane = (group: Record<string, unknown>, series: string[] = []): StripPaneV1 => stripPaneOf({ style: "group", series: series.map((key) => ({ key })), group });

// ---- settings ------------------------------------------------------------------

describe("Group settings: a rule, salvaged and kept", () => {
	it("a Group pane stores its rule; junk reads as safe defaults and is never thrown on", () => {
		const pane = groupPane({ from: "filter", filter: "  *core*clock* | *core*temp*  ", keys: ["a", "a", "", 5, "b"], view: "rows", limits: { warn: "85", crit: 95, below: "yes" } });
		assert.equal(pane.style, "group");
		assert.deepEqual(pane.group, { from: "filter", filter: "*core*clock* | *core*temp*", keys: ["a", "b"], view: "rows", limits: { warn: 85, crit: 95, below: false } });
		const junk = groupPane({ from: "everything", filter: " | ", keys: "nope", view: "horizon", limits: { warn: "hot" } });
		assert.deepEqual(junk.group, { from: "folder", keys: [], view: "auto" });
		assert.equal(stripPaneOf({ style: "group", group: 7 }).group, undefined);
		const long = groupPane({ from: "list", keys: Array.from({ length: 200 }, (_, i) => `k${i}`) });
		assert.equal(long.group?.keys.length, 128, "a custom list keeps the detail list's bound");
	});

	it("a pane without the rule writes exactly what it wrote before Group existed", () => {
		const raw = { style: "trend", series: [{ key: "a" }], overlays: { current: true, minmax: false, unit: true, legend: true, time: true }, scale: {}, bands: [] };
		assert.deepEqual(stripPaneToJson(stripPaneOf(raw)), raw);
	});

	it("the rule round-trips, and a newer version's fields inside it are kept on a rewrite", () => {
		const stored = { style: "group", series: [], group: { from: "list", keys: ["x", "y"], view: "now", future: { keep: 1 }, limits: { warn: 80, below: true, unit: "°C", shade: "pink" } } };
		const json = stripPaneToJson(stripPaneOf(stored), stored) as JsonObject;
		assert.deepEqual(json.group, { future: { keep: 1 }, from: "list", keys: ["x", "y"], view: "now", limits: { shade: "pink", warn: 80, below: true, unit: "°C" } });
	});

	it("a style this build does not know draws as Trend and is written back as stored, never as trend", () => {
		const stored = { layout: "whole", encoders: 4, window: "5m", panes: [{ style: "bump", series: [{ key: "a" }], group: { from: "folder", keys: [], view: "auto" } }, {}] };
		const config = stripConfigOf(stored);
		assert.equal(config.panes[0].style, "trend", "drawn as Trend");
		assert.equal(config.panes[0].storedStyle, "bump");
		// An unrelated edit rewrites the copy: the unknown style survives.
		const edited = applyStripEdit({ id: "g", rev: 3, config }, 3, [{ op: "set", path: "window", value: "15m" }]);
		assert.ok(edited.ok);
		const json = stripConfigToJson(edited.copy.config, stored) as { panes: JsonObject[] };
		assert.equal(json.panes[0]?.style, "bump");
		// A deliberate style choice replaces it.
		const chosen = applyStripEdit({ id: "g", rev: 3, config }, 3, [{ op: "set", path: "panes.0.style", value: "area" }]);
		assert.ok(chosen.ok);
		assert.equal((stripConfigToJson(chosen.copy.config) as { panes: JsonObject[] }).panes[0]?.style, "area");
	});

	it("an edit sets the whole rule exactly as stored, refuses anything the parser would change, and null removes it", () => {
		const config = stripConfigOf({ layout: "whole", encoders: 6, panes: [{ style: "trend", series: [{ key: "a" }] }, {}] });
		const base = { id: "g", rev: 1, config };
		const set = (value: unknown): ReturnType<typeof applyStripEdit> => applyStripEdit(base, 1, [{ op: "set", path: "panes.0.group", value }]);
		const ok = set({ from: "filter", filter: "*core*", keys: [], view: "auto", limits: { warn: 85, below: false } });
		assert.ok(ok.ok);
		assert.deepEqual(ok.copy.config.panes[0].group, { from: "filter", filter: "*core*", keys: [], view: "auto", limits: { warn: 85, below: false } });
		for (const bad of [
			{ from: "filter", filter: " *core* ", keys: [], view: "auto" },
			{ from: "all", keys: [], view: "auto" },
			{ from: "list", keys: ["a", "a"], view: "auto" },
			{ from: "list", keys: Array.from({ length: 129 }, (_, i) => `k${i}`), view: "auto" },
			{ from: "list", keys: [], view: "horizon" },
			{ from: "list", keys: [], view: "auto", extra: 1 },
			{ from: "list", keys: [], view: "auto", limits: { below: true } },
			{ from: "list", keys: [], view: "auto", limits: { warn: "x" } }
		]) {
			assert.equal(set(bad).ok, false, JSON.stringify(bad));
		}
		const cleared = applyStripEdit({ id: "g", rev: 2, config: ok.copy.config }, 2, [{ op: "set", path: "panes.0.group", value: null }]);
		assert.ok(cleared.ok);
		assert.equal(cleared.copy.config.panes[0].group, undefined);
	});
});

// ---- resolution ------------------------------------------------------------------

describe("Group resolution: the rule against each snapshot", () => {
	const s = snap(cpu());
	const clock0 = s.readings[0] as Reading;
	const fan = s.readings.find((r) => r.label === "Pump") as Reading;

	it("a folder is every reading of the first reading's sensor, in HWiNFO's order, the majority unit drawn, 32 of 48 counted", () => {
		const r = resolveGroup(s, groupPane({ from: "folder", keys: [], view: "auto" }, [clock0.key]));
		assert.equal(r.status, "ok");
		assert.equal(r.title, "CPU [#0]: Example");
		assert.equal(r.unit, "MHz");
		assert.equal(r.keys.length, GROUP_DRAW_MAX);
		assert.deepEqual(r.keys, s.readings.slice(0, 32).map((x) => x.key), "the first 32 in HWiNFO's order, the anchor included");
		assert.equal(r.sameUnit, 48, "48 in the drawn unit");
		assert.equal(r.otherUnits, 8, "8 in another unit, left out and counted");
		const fans = resolveGroup(s, groupPane({ from: "folder", keys: [], view: "auto" }, [fan.key]));
		assert.deepEqual([fans.title, fans.unit, fans.keys.length, fans.otherUnits], ["Board", "RPM", 2, 0]);
	});

	it("a filter uses the detail grammar over 'sensor label', this PC only, and counts what it matches", () => {
		const r = resolveGroup(s, groupPane({ from: "filter", filter: "*core*clock*", keys: [], view: "auto" }));
		assert.deepEqual([r.status, r.unit, r.keys.length, r.sameUnit, r.otherUnits], ["ok", "MHz", 32, 48, 0]);
		const union = resolveGroup(s, groupPane({ from: "filter", filter: "*core 1? clock* | pump", keys: [], view: "auto" }));
		assert.deepEqual([union.unit, union.sameUnit, union.otherUnits], ["MHz", 10, 1], "Core 10..19 clocks; the pump in RPM is left out");
		const nothing = resolveGroup(s, groupPane({ from: "filter", filter: "*gpu*", keys: [], view: "auto" }));
		assert.equal(nothing.status, "empty");
		assert.equal(resolveGroup(s, groupPane({ from: "filter", keys: [], view: "auto" })).status, "no-filter");
	});

	it("a list keeps its order and keeps a reading HWiNFO does not list in its place", () => {
		const keys = [s.readings[3]?.key, "gone:0:1", s.readings[1]?.key, fan.key] as string[];
		const r = resolveGroup(s, groupPane({ from: "list", keys, view: "auto" }));
		assert.deepEqual(r.keys, [keys[0], "gone:0:1", keys[2]], "MHz is the majority; the missing reading keeps its place");
		assert.equal(r.otherUnits, 1);
	});

	it("a sensor HWiNFO adds or renames follows on the next snapshot, with no edit", () => {
		const pane = groupPane({ from: "filter", filter: "*fan*", keys: [], view: "auto" });
		const before = snap([{ sensor: "Board", label: "CPU Fan", unit: "RPM", value: 1 }, { sensor: "Board", label: "Pump", unit: "RPM", value: 2 }]);
		assert.equal(resolveGroup(before, pane).keys.length, 1);
		const after = snap([{ sensor: "Board", label: "CPU Fan", unit: "RPM", value: 1 }, { sensor: "Board", label: "Pump Fan", unit: "RPM", value: 2 }, { sensor: "Board", label: "Rear Fan", unit: "RPM", value: 3 }]);
		assert.equal(resolveGroup(after, pane).keys.length, 3, "the renamed pump and the new fan are in");
	});

	it("a reading that leaves HWiNFO's list keeps its row after the one it followed; one renamed out of a filter goes", () => {
		assert.deepEqual(mergeRemembered(["a", "c"], ["a", "b", "c"], () => false), ["a", "b", "c"]);
		assert.deepEqual(mergeRemembered(["a", "c"], ["a", "b", "c"], (k) => k === "b"), ["a", "c"], "still listed: it no longer matches");
		assert.deepEqual(mergeRemembered(["c"], ["b", "c"], () => false), ["b", "c"]);
		const status: PollerStatus = { state: "ok", snapshot: snap(cpu(2, 0)), source: "shared-memory" };
		const frame = groupFrameOf(groupPane({ from: "filter", filter: "*clock*", keys: [], view: "auto" }), status, ["f0:0:100", "lost:0:1", "f0:0:101"]);
		assert.deepEqual(frame.keys, ["f0:0:100", "lost:0:1", "f0:0:101"]);
		const away = groupFrameOf(groupPane({ from: "filter", filter: "*clock*", keys: [], view: "auto" }), { state: "unavailable", reason: "not-running" } as PollerStatus, ["a", "b"]);
		assert.deepEqual(away.keys, ["a", "b"], "HWiNFO away: the readings drawn before stay, each saying so");
	});

	it("Auto: named lines to 4, a highlight over muted lines to 8, heat rows from 9; a chosen view at any count", () => {
		assert.deepEqual([1, 4, 5, 8, 9, 32].map((n) => groupDrawOf("auto", n)), ["lines", "lines", "lines", "lines", "rows", "rows"]);
		for (const view of ["rows", "now", "spread"] as const) assert.equal(groupDrawOf(view, 3), view);
	});
});

// ---- geometry ---------------------------------------------------------------------

describe("Group geometry", () => {
	it("rows fill the band on whole pixels, in order, at least 1 px each, with block gaps from 16", () => {
		for (const n of [1, 2, 4, 8, 9, 16, 24, 32]) {
			const rows = groupRows(n);
			assert.equal(rows.length, n);
			assert.equal(rows[0]?.y0, GROUP_TOP);
			const last = rows[n - 1] as { y1: number };
			assert.ok(last.y1 <= GROUP_BOTTOM && last.y1 >= GROUP_BOTTOM - 1, `${n}: ends at ${last.y1}`);
			const heights = rows.map((r) => r.y1 - r.y0);
			assert.ok(Math.min(...heights) >= 1 && Math.max(...heights) - Math.min(...heights) <= 1, `${n}: ${heights.join(",")}`);
			rows.forEach((r, i) => {
				if (i === 0) return;
				const gap = r.y0 - (rows[i - 1] as { y1: number }).y1;
				const want = (n <= 8 ? 1 : 0) + (n >= 16 && i % 8 === 0 ? 1 : 0);
				assert.equal(gap, want, `${n}: gap before row ${i}`);
			});
		}
	});

	it("Now columns never cross a seam, keep the group's order and fill the slots evenly", () => {
		for (const [layout, encoders] of [["whole", 6], ["split", 6], ["whole", 4], ["split", 4]] as const) {
			for (const extent of paneExtents(layout, encoders)) {
				const plot = groupPlotOf({ overlays: { current: true } }, extent, "now", 2);
				for (const n of [1, 4, 8, 16, 32]) {
					const cols = groupColumns(plot, n);
					assert.equal(cols.length, n);
					for (const c of cols) assert.equal(Math.floor(c.x0 / SLICE_W), Math.floor((c.x1 - 1) / SLICE_W), `${layout} ${encoders} n${n}: ${c.x0}..${c.x1}`);
					cols.forEach((c, i) => i > 0 && assert.ok(c.x0 >= (cols[i - 1] as { x1: number }).x1));
				}
			}
		}
	});
});

// ---- the scene ----------------------------------------------------------------------

/** Value labels above Now bars are 11 px bold; the readout is far larger. */
const SMALL_TEXT = 12;
const texts = (input: StripSceneInput): TextPrim[] => buildStripScene(input).prims.filter((p): p is TextPrim => p.k === "text");
const allText = (input: StripSceneInput): string => texts(input).map((p) => p.text).join(" | ");

describe("Group scene", () => {
	it("Rows draws one row per reading, every row inside the band", () => {
		for (const n of [9, 16, 32]) {
			const scene = buildStripScene(groupFixture({ n, view: "rows" }).input);
			const ys = new Set<number>();
			for (const p of scene.prims) if (p.k === "cells" && p.layer === "base") for (let i = 1; i < p.rects.length; i += 4) ys.add(p.rects[i] as number);
			assert.equal(ys.size, n, `${n} rows`);
			for (const y of ys) assert.ok(y >= GROUP_TOP && y < GROUP_BOTTOM);
		}
	});

	it("an alert in Rows is never color alone: an alerting row carries a bar at its left end, and the limits are named", () => {
		const c = groupFixture({ n: 16, view: "rows", limits: { warn: 55, crit: 95 } });
		const scene = buildStripScene(c.input);
		const warn = c.input.alertColors.warn;
		const bars = scene.prims.filter((p): p is CellsPrim => p.k === "cells" && p.layer === "marks" && p.paint === `fill="${warn}"`);
		assert.ok(bars.length > 0, "a bar for the rows past warn now");
		const plotX0 = Math.min(...scene.prims.filter((p): p is CellsPrim => p.k === "cells" && p.layer === "base").map((p) => p.rects[0] as number));
		for (const b of bars) for (let i = 0; i < b.rects.length; i += 4) assert.ok((b.rects[i] as number) < plotX0, "left of the cells");
		assert.match(allText(c.input), /warn 55/);
		assert.match(allText(c.input), /crit 95/);
	});

	it("Rows names limits typed under °C in °F once the strip shows °F, as its bands draw them; unstamped ones as stored", () => {
		/** The fixture's rows with these limits, the strip in °F. */
		const inF = (limits: Record<string, unknown>): StripSceneInput => {
			const c = groupFixture({ n: 16, view: "rows" });
			const pane = stripPaneOf({ style: "group", series: [], group: { from: "filter", filter: "*core*", keys: [], view: "rows", limits: { below: false, ...limits } } });
			const config = { ...c.input.config, fahrenheit: true, panes: [pane, pane] as const };
			return { ...c.input, config, panes: c.input.panes.map((p) => ({ ...p, bands: stripBandsFor(pane, p.series, { fahrenheit: true, decimals: config.decimals }) })) };
		};
		const stamped = inF({ warn: 80, crit: 90, unit: "°C", displayUnit: "°C", displayUnitFor: { warn: "80", crit: "90" } });
		const bands = stamped.panes[0]?.bands ?? [];
		assert.deepEqual(
			bands.slice(0, 2).map((b) => b.from),
			[176, 194],
			"the bands draw at 176 and 194 °F"
		);
		assert.match(allText(stamped), /warn 176(\.0)?(?!\d)/);
		assert.match(allText(stamped), /crit 194(\.0)?(?!\d)/);
		assert.doesNotMatch(allText(stamped), /warn 80|crit 90/);
		const plain = inF({ warn: 80, crit: 90, unit: "°C" });
		assert.match(allText(plain), /warn 80(\.0)?(?!\d)/, "an unstamped limit is a number in the unit on view");
		assert.match(allText(plain), /crit 90(\.0)?(?!\d)/);
	});

	it("the highlighted reading is named large in the first slot with 'n of N' under it; home names the group's highest", () => {
		const lit = groupFixture({ n: 32, view: "rows", highlight: 5 });
		assert.match(allText(lit.input), /Core 5 Temperature/);
		assert.match(allText(lit.input), /\| 6 of 32 \|/);
		const home = groupFixture({ n: 32, view: "rows", highlight: null });
		const series = home.input.panes[0]?.series ?? [];
		const top = series.reduce((best, s) => ((s.current ?? -Infinity) > (best.current ?? -Infinity) ? s : best));
		assert.match(allText(home.input), new RegExp(top.name));
		assert.match(allText(home.input), /\| max of 32 \|/);
	});

	describe("the line under the large value says which reading, and the sensor when that tells the person something", () => {
		const footOf = (group: Record<string, unknown>, title: string, highlight: number | null = null): string => {
			const c = groupFixture({ n: 16, view: "rows", highlight });
			const pane = stripPaneOf({ style: "group", series: [], group: { keys: [], view: "rows", ...group } });
			const first = c.input.panes[0] as StripPaneInput;
			const input: StripSceneInput = { ...c.input, config: { ...c.input.config, panes: [pane, pane] }, panes: [{ ...first, group: { ...(first.group as GroupPaneInfo), title } }] };
			const found = buildStripScene(input).prims.filter((p): p is TextPrim => p.k === "text" && /^(max|min|\d+) of 16/.test(p.text)).map((p) => p.text);
			assert.equal(found.length, 1, found.join(" | "));
			return found[0] as string;
		};
		it("a filter's words and a unit never print", () => {
			assert.equal(footOf({ from: "filter", filter: "*core ? clock*|*core ?? clock*" }, "*core ? clock*|*core ?? clock*"), "max of 16");
			assert.equal(footOf({ from: "filter", filter: "*core*" }, "*core*", 4), "5 of 16");
		});
		it("a list says no 'custom list'", () => {
			assert.equal(footOf({ from: "list", keys: ["a", "b"] }, ""), "max of 16");
		});
		it("a folder keeps its sensor's name", () => {
			assert.equal(footOf({ from: "folder" }, "CPU"), "max of 16 · CPU");
		});
	});

	it("the readout holds the digit floor (30 px single) on every deck and layout, inside one slice", () => {
		for (const [layout, encoders] of [["whole", 6], ["split", 6], ["whole", 4], ["split", 4]] as const) {
			for (const view of ["auto", "rows", "now", "spread"] as const) {
				const c = groupFixture({ n: 16, view, layout, encoders, highlight: 3 });
				const big = texts(c.input).filter((p) => p.pinned === true && p.weight === 700 && p.size > SMALL_TEXT);
				assert.ok(big.length >= 1, `${layout} ${encoders} ${view}: a value`);
				for (const p of big) {
					const cap = digitMetrics().cap * p.size;
					assert.ok(cap >= 30, `${layout} ${encoders} ${view}: ${cap.toFixed(1)} px digits`);
					const ink = textInkBox(p);
					assert.equal(Math.floor(ink.x0 / SLICE_W), Math.floor((ink.x1 - 0.01) / SLICE_W), "inside one slice");
				}
			}
		}
	});

	it("every count is said: 32 of 48 shown, readings in other units left out, history full, not found", () => {
		const c = groupFixture({ n: 32, view: "rows", sameUnit: 48, otherUnits: 8, refused: 4 });
		const words = allText(c.input);
		assert.match(words, /32 of 48 shown/);
		assert.match(words, /8 in other units left out/);
		assert.match(words, /history full: 28 of 32/);
		const missing: StripSceneInput = { ...c.input, panes: c.input.panes.map((p) => ({ ...p, series: p.series.map((s, i) => (i < 2 ? { ...s, state: "missing" as const, current: undefined } : s)) })) };
		assert.match(allText(missing), /2 not found/);
	});

	it("Now marks the highlighted column by position as well as color, and a stale reading draws dimmer", () => {
		const c = groupFixture({ n: 8, view: "now", highlight: 2 });
		const svg = renderLogical(buildStripScene(c.input));
		const plot = groupPlotOf({ overlays: { current: true } }, paneExtents("whole", 6)[0] as { x0: number; x1: number }, "now", 2);
		const col = groupColumns(plot, 8)[2] as { x0: number; x1: number };
		assert.match(svg, new RegExp(`M${col.x0} ${GROUP_BOTTOM + 2}h${col.x1 - col.x0}v2`), "a tab under the highlighted column");
		const stale: StripSceneInput = { ...c.input, panes: c.input.panes.map((p) => ({ ...p, series: p.series.map((s) => ({ ...s, state: "stale" as const })) })) };
		assert.notEqual(renderLogical(buildStripScene(stale)), svg);
	});

	it("Lines never draws more than 8 full lines; above 8 Auto draws rows", () => {
		for (const n of [1, 4, 8, 9, 32]) {
			const lines = buildStripScene(groupFixture({ n, view: "auto" }).input).prims.filter((p) => p.k === "line" && p.width >= 1);
			const series = new Set(lines.map((p) => (p as { stroke: string }).stroke));
			if (n <= 8) assert.ok(lines.length > 0 && series.size <= 8, `${n}: ${series.size} line colors`);
			else assert.equal(lines.length, 0, `${n}: rows, no lines`);
		}
	});

	it("a Group pane with nothing to draw says why where the graph would be", () => {
		const c = groupFixture({ n: 0, view: "auto" });
		const input: StripSceneInput = { ...c.input, panes: c.input.panes.map((p) => ({ ...p, group: { ...(p.group as NonNullable<typeof p.group>), status: "no-filter" } })) };
		assert.match(allText(input), /Type a filter in the dial settings/);
	});
});

// ---- payload ----------------------------------------------------------------------

describe("Group payload: no slice over 8192 bytes", () => {
	const rand = (seed: number): (() => number) => {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	};
	const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;

	it("every view, count, window, deck and layout at the caps with realistic data stays well inside the bound", () => {
		let worst = 0;
		for (const [layout, encoders] of [["whole", 6], ["split", 6], ["whole", 4], ["split", 4]] as const) {
			for (const window of ["1m", "5m", "15m"] as const) {
				for (const view of ["auto", "rows", "now", "spread"] as const) {
					for (const n of [4, 8, 16, 32]) {
						const r = sliceStrip(groupFixture({ n, view, layout, encoders, window, limits: { warn: 85, crit: 95 }, highlight: 5 }).input);
						assert.ok(r.maxBytes <= SLICE_PAYLOAD_LIMIT, `${layout} ${encoders} ${window} ${view} ${n}: ${r.maxBytes}`);
						assert.notEqual(r.reduced, true, `${layout} ${encoders} ${window} ${view} ${n}: drawn, not reduced`);
						worst = Math.max(worst, r.maxBytes);
					}
				}
			}
		}
		assert.ok(worst > 1000);
	});

	it("over 120 seeded worst-case Group scenes (noise every column, dense gaps, every look), every slice is at most 8192 bytes (less the deck art piece on the art looks)", () => {
		let worst = 0;
		for (let seed = 1; seed <= 120; seed++) {
			const r = rand(seed);
			const c = groupFixture({
				n: pick(r, [4, 8, 9, 16, 24, 32]),
				view: pick(r, ["auto", "rows", "now", "spread"] as const),
				kind: pick(r, ["temp", "clock", "usage"] as const),
				layout: pick(r, ["whole", "split"] as const),
				encoders: pick(r, [4, 6] as const),
				window: pick(r, ["1m", "5m", "15m"] as const),
				background: pick(r, DIAL_BACKGROUNDS),
				accent: r() < 0.5,
				noise: 1 + r() * 60,
				gapEvery: pick(r, [0, 2, 3, 7]),
				limits: r() < 0.5 ? { warn: 60, crit: 80 } : undefined,
				highlight: r() < 0.5 ? 3 : null,
				paused: r() < 0.2
			} as Parameters<typeof groupFixture>[0]);
			const result = sliceStrip({ ...c.input, bucketPx: pick(r, [1, 2] as const) });
			// The art looks keep room for the deck art piece each slice carries.
			const bound = SLICE_PAYLOAD_LIMIT - (isArtLook(c.input.config.background) ? ART_PIECE_LIMIT : 0);
			for (const svg of result.slices) {
				if (svg === null) continue;
				const bytes = svgBytes(svg);
				assert.ok(bytes <= bound, `seed ${seed}: ${bytes} bytes over ${bound}`);
				worst = Math.max(worst, bytes);
			}
		}
		assert.ok(worst > SLICE_PAYLOAD_LIMIT * 0.4, `the generator reaches toward the bound (${worst})`);
	});
});

// ---- history: the group allowance ------------------------------------------------------

describe("Group history: its own allowance, the shown window only", () => {
	const T1 = (TIERS[1] as { capacity: number }).capacity * ENTRY_BYTES;

	it("a group fills only the group allowance; keys and dials keep their whole budget", () => {
		const t = { now: 1_000 };
		const store = new HistoryStore({ now: () => t.now, budgetBytes: 4 * T1, groupBudgetBytes: 3 * T1 });
		store.setInterest("strip:g:0:group", ["a", "b", "c", "d", "e"].map((savedKey) => ({ savedKey, window: "5m" as const })), { pool: "group" });
		const d = store.diagnostics();
		assert.deepEqual(d.group, { bytes: 3 * T1, budget: 3 * T1, overflow: 2 });
		assert.equal(d.bytes, 0, "the keys' budget untouched");
		assert.equal(store.refused("d", "5m"), true, "the fourth reading is refused: the pane says history full");
		store.setInterest("key-1", ["x", "y", "z", "w"].map((savedKey) => ({ savedKey, window: "5m" as const })));
		assert.equal(store.diagnostics().bytes, 4 * T1, "every key still gets its window");
		assert.equal(store.refused("w", "5m"), false);
	});

	it("a key that shares a group's reading moves its tier to the main budget, freeing the group's room", () => {
		const store = new HistoryStore({ now: () => 1, budgetBytes: 4 * T1, groupBudgetBytes: 2 * T1 });
		store.setInterest("strip:g:0:group", [{ savedKey: "a", window: "5m" }, { savedKey: "b", window: "5m" }, { savedKey: "c", window: "5m" }], { pool: "group" });
		assert.equal(store.refused("c", "5m"), true);
		store.setInterest("key-1", [{ savedKey: "a", window: "5m" }]);
		assert.deepEqual([store.diagnostics().bytes, store.diagnostics().group.bytes], [T1, T1]);
		// The next tick's sweep retries the refused tier in the room freed.
		store.ingest({ kind: "stale", at: 2 });
		assert.equal(store.refused("c", "5m"), false);
	});

	it("a hidden group lingers 16 minutes, still fed, then frees its allowance; the group's linger never evicts a key", () => {
		const t = { now: 1_000 };
		const store = new HistoryStore({ now: () => t.now, groupBudgetBytes: 2 * T1 });
		store.setInterest("strip:g:0:group", [{ savedKey: "a", window: "15m" }], { pool: "group" });
		store.dropInterest("strip:g:0:group");
		assert.equal(store.diagnostics().group.bytes, T1, "lingering");
		t.now += LINGER_MS + 1;
		store.ingest({ kind: "stale", at: t.now });
		assert.equal(store.diagnostics().group.bytes, 0);
		assert.equal(GROUP_HISTORY_BUDGET_BYTES, 768 * 1024);
	});
});

// ---- the runtime: interest and gestures ---------------------------------------------------

class FakeClock implements SchedulerClock {
	t = 1_000_000;
	private seq = 0;
	private readonly timers = new Map<number, { at: number; fn: () => void }>();
	now(): number {
		return this.t;
	}
	setTimeout(fn: () => void, ms: number): unknown {
		const id = ++this.seq;
		this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
		return id;
	}
	clearTimeout(handle: unknown): void {
		this.timers.delete(handle as number);
	}
	advance(ms: number): void {
		const end = this.t + ms;
		for (;;) {
			let next: [number, { at: number; fn: () => void }] | undefined;
			for (const entry of this.timers) if (entry[1].at <= end && (next === undefined || entry[1].at < next[1].at)) next = entry;
			if (next === undefined) break;
			this.timers.delete(next[0]);
			this.t = Math.max(this.t, next[1].at);
			next[1].fn();
		}
		this.t = end;
	}
}

class Dial implements StripDialHandle {
	readonly feedback: string[] = [];
	readonly triggers: ({ rotate?: string; push?: string; touch?: string; longTouch?: string } | undefined)[] = [];
	readonly device = { id: "devX" };
	readonly coordinates: { column: number; row: number };
	constructor(
		readonly id: string,
		column: number
	) {
		this.coordinates = { column, row: 0 };
	}
	setFeedback(f: { canvas: string }): Promise<void> {
		this.feedback.push(decodeURIComponent(f.canvas.slice("data:image/svg+xml,".length)));
		return Promise.resolve();
	}
	setTriggerDescription(d?: { rotate?: string; push?: string; touch?: string; longTouch?: string }): Promise<void> {
		this.triggers.push(d);
		return Promise.resolve();
	}
	setSettings(): Promise<void> {
		return Promise.resolve();
	}
}

function runtime(specs: Spec[]) {
	const clock = new FakeClock();
	const settings = new Map<string, Record<string, unknown>>();
	const interest = new Map<string, { entries: unknown; pool?: string }>();
	const history = new HistoryStore({ now: () => clock.t });
	let status: PollerStatus = { state: "ok", snapshot: snap(specs), source: "shared-memory" };
	const panel: JsonValue[] = [];
	const host: StripHost = {
		settingsOf: (c) => settings.get(c),
		stored: (c, d) => settings.set(c, d),
		claimChanged: () => {},
		status: () => status,
		history: {
			setInterest: (id, entries, options) => {
				interest.set(id, { entries, ...(options?.pool === undefined ? {} : { pool: options.pool }) });
				history.setInterest(id, entries, options);
			},
			dropInterest: (id) => {
				interest.delete(id);
				history.dropInterest(id);
			},
			view: (key, window, width, now, linked) => history.view(key, window, width, now, linked),
			refused: (key, window) => history.refused(key, window),
			get revision() {
				return history.revision;
			}
		},
		panelContext: () => undefined,
		sendToPanel: (p) => panel.push(p)
	};
	const ctl = new StripController(host, { clock, capabilities: { get: () => deriveCapabilities({ type: 13, columns: 9, rows: 4 }) }, mintId: () => "0123456789abcdef0123456789abcdef" });
	const dials = Array.from({ length: 6 }, (_, c) => new Dial(`x${c}`, c));
	const first = status.state === "ok" ? (status.snapshot.readings[0] as Reading).key : "";
	for (const d of dials) {
		settings.set(d.id, { readingKey: first });
		ctl.appear(d, { readingKey: first });
	}
	let poll = 1;
	return {
		clock,
		ctl,
		dials,
		interest,
		history,
		settings,
		tick(): void {
			poll++;
			clock.advance(1000);
			const s = snap(specs, { pollTime: poll, valueRevision: poll });
			history.ingest({ kind: "ok", at: clock.t, snapshot: s, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 });
			status = { state: "ok", snapshot: s, source: "shared-memory" };
			ctl.onTick(status);
		},
		setSpecs(next: Spec[]): void {
			specs = next;
		},
		flush(): void {
			clock.advance(MIN_FRAME_MS * 3);
		},
		request(payload: Record<string, unknown>): Record<string, unknown> {
			const before = panel.length;
			ctl.handlePi("x0", payload);
			return panel.slice(before).find((p) => typeof p === "object" && p !== null && !Array.isArray(p) && p.event === (payload.event === "stripGet" ? "stripState" : "stripEditResult")) as Record<string, unknown>;
		},
		turn(column: number, ticks: number, pressed = false): void {
			if (pressed) ctl.input(`x${column}`, { kind: "dialDown", column, at: clock.t });
			ctl.input(`x${column}`, { kind: "dialRotate", column, at: clock.t + 1, ticks, pressed });
			if (pressed) ctl.input(`x${column}`, { kind: "dialUp", column, at: clock.t + 2 });
			clock.advance(MIN_FRAME_MS * 3);
		},
		tap(column: number, x: number, y: number, hold = false): void {
			ctl.input(`x${column}`, { kind: "touchTap", column, at: clock.t, hold, tapPos: [x, y] });
			clock.advance(MIN_FRAME_MS * 3);
		},
		frame(): string {
			return dials.map((d) => d.feedback.at(-1) ?? "").join("\n");
		}
	};
}

describe("Group runtime", () => {
	const make = (rt: ReturnType<typeof runtime>, group: Record<string, unknown>): string => {
		const made = rt.request({ event: "stripCreate", opId: "c", layout: "whole", patch: [{ op: "set", path: "panes.0.style", value: "group" }, { op: "set", path: "panes.0.group", value: group }] });
		assert.equal(made.ok, true, JSON.stringify(made));
		rt.flush();
		return made.groupId as string;
	};

	it("a Group pane asks for its readings in the shown window only, from the group allowance; a pressed turn moves it", () => {
		const rt = runtime(cpu(12, 0));
		make(rt, { from: "folder", keys: [], view: "auto" });
		rt.tick();
		rt.flush();
		const found = [...rt.interest.entries()].find(([id]) => id.endsWith(":0:group"));
		assert.ok(found !== undefined, JSON.stringify([...rt.interest.keys()]));
		const [, value] = found;
		assert.equal(value.pool, "group");
		assert.deepEqual((value.entries as { window: string }[]).map((e) => e.window), new Array(12).fill("5m"));
		assert.ok(![...rt.interest.entries()].some(([id, v]) => !id.endsWith(":group") && JSON.stringify(v.entries).includes("f0:0:100")), "no main-budget interest for the group's readings");
		rt.turn(2, 1, GROUP_TURN_PICKS_READING);
		const moved = [...rt.interest.entries()].find(([id]) => id.endsWith(":0:group"))?.[1];
		assert.deepEqual([...new Set((moved?.entries as { window: string }[]).map((e) => e.window))], ["15m"]);
		assert.deepEqual(rt.history.diagnostics().group.overflow, 0);
	});

	it("a turn picks the reading (clamped; left past the first is home); a tap on a row picks it; a long touch goes home", () => {
		const rt = runtime(cpu(16, 0));
		make(rt, { from: "folder", keys: [], view: "rows" });
		rt.tick();
		rt.flush();
		assert.match(rt.frame(), /max of 16/);
		rt.turn(3, 1, !GROUP_TURN_PICKS_READING);
		assert.match(rt.frame(), />1 of 16 · /);
		assert.doesNotMatch(rt.frame(), /1 of 16 · MHz/);
		rt.turn(3, 3, !GROUP_TURN_PICKS_READING);
		assert.match(rt.frame(), />4 of 16 · /);
		rt.turn(3, -10, !GROUP_TURN_PICKS_READING);
		assert.match(rt.frame(), /max of 16/, "left past the first reading is home, clamped");
		rt.turn(3, 40, !GROUP_TURN_PICKS_READING);
		assert.match(rt.frame(), />16 of 16/, "clamped at the last reading");
		const rows = groupRows(16);
		const row = rows[9] as { y0: number; y1: number };
		rt.tap(3, 50, Math.floor((row.y0 + row.y1) / 2));
		assert.match(rt.frame(), />10 of 16/, "a tap on a row picks it");
		rt.tap(4, 50, 50, true);
		assert.match(rt.frame(), /max of 16/, "a long touch goes home");
		const hint = rt.dials[1]?.triggers.at(-1);
		assert.equal(hint?.rotate, GROUP_TURN_PICKS_READING ? "Reading · pressed: window" : "Time window · pressed: reading");
		assert.equal(hint?.longTouch, "Top reading");
	});

	it("a sensor HWiNFO adds draws without an edit; one that goes keeps its row and is counted as not found", () => {
		const rt = runtime(cpu(10, 0));
		make(rt, { from: "filter", filter: "*clock*", keys: [], view: "rows" });
		rt.tick();
		rt.flush();
		rt.turn(0, 50, !GROUP_TURN_PICKS_READING);
		assert.match(rt.frame(), />10 of 10/);
		rt.setSpecs(cpu(11, 0));
		rt.tick();
		rt.flush();
		rt.turn(0, 50, !GROUP_TURN_PICKS_READING);
		assert.match(rt.frame(), />11 of 11/, "the new clock is in");
		rt.setSpecs(cpu(11, 0).filter((s) => s.label !== "Core 3 Clock"));
		rt.tick();
		rt.flush();
		assert.match(rt.frame(), /1 not found/);
		assert.match(rt.frame(), /11 of 11/, "its row is kept; nothing below moves up");
	});

	it("the panel's state carries the count the rule matches now", () => {
		const rt = runtime(cpu(48, 8));
		make(rt, { from: "folder", keys: [], view: "auto" });
		const state = rt.request({ event: "stripGet", requestId: "r" }) as { group: { counts: unknown[] } };
		assert.deepEqual(state.group.counts, [{ status: "ok", title: "CPU [#0]: Example", unit: "MHz", drawn: 32, sameUnit: 48, otherUnits: 8 }]);
		rt.tick();
		rt.flush();
		assert.match(rt.frame(), /32 of 48 shown/);
		assert.match(rt.frame(), /8 in other units left out/);
	});
});

describe("Group input routing", () => {
	const routing = (draw: "rows" | "now" | "lines", mode: "live" | "paused" = "live"): StripRouting => ({ layout: "whole", encoders: 6, sharedWindow: true, bucketPx: 2, panes: [{ style: "group", seriesCount: 1, mode, group: { count: 16, draw, current: true } }] });

	it("turns, taps and holds route per the Group table; the switch flips which turn picks", () => {
		const turn = (pressed: boolean) => routeStripInput(routing("rows"), pressed ? { downAt: 0, rotatedWhileDown: false } : IDLE_GESTURE, { kind: "dialRotate", column: 2, at: 10, ticks: 1, pressed }).action;
		assert.deepEqual(turn(!GROUP_TURN_PICKS_READING), { kind: "groupStep", pane: 0, step: 1 });
		assert.deepEqual(turn(GROUP_TURN_PICKS_READING), { kind: "window", pane: 0, step: 1, scope: "shared" });
		const tap = (draw: "rows" | "now" | "lines", column: number, x: number, y: number, hold = false, mode: "live" | "paused" = "live") => routeStripInput(routing(draw, mode), IDLE_GESTURE, { kind: "touchTap", column, at: 0, hold, tapPos: [x, y] }).action;
		assert.deepEqual(tap("rows", 0, 50, 50), { kind: "groupHome", pane: 0, live: false }, "the readout slot goes home");
		assert.equal(tap("rows", 3, 50, 5)?.kind, "groupPick");
		assert.equal((tap("rows", 3, 50, 92) as { index: number }).index, 15, "the bottom row");
		assert.equal(tap("now", 3, 50, 50)?.kind, "groupPick");
		assert.equal(tap("lines", 3, 50, 50)?.kind, "inspect", "lines and spread inspect at the tap");
		assert.deepEqual(tap("rows", 3, 50, 50, true, "paused"), { kind: "groupHome", pane: 0, live: true });
		assert.ok("cursor" in (tap("rows", 3, 50, 50, false, "paused") as object), "paused: the cursor follows the tap on Rows");
		assert.equal(stripTriggerDescriptions({ layout: "split", sharedWindow: true, mode: "live", seriesChoice: true, group: true }).rotate, GROUP_TURN_PICKS_READING ? "Reading · pressed: window, both halves" : "Window, both halves · pressed: reading");
	});
});

describe("Group home reading: held against close calls", () => {
	const c = (key: string, value: number) => ({ key, value });

	it("a reading a hair ahead does not take the name; one past the margin does, at once", () => {
		let s = nextHome(undefined, [c("a", 5000), c("b", 4999)], 1, false);
		assert.equal(s?.key, "a");
		s = nextHome(s, [c("a", 5000), c("b", 5000.6)], 1, false);
		assert.equal(s?.key, "a", "0.6 ahead, inside a margin of 1: held");
		s = nextHome(s, [c("a", 5000), c("b", 5002)], 1, false);
		assert.equal(s?.key, "b", "2 ahead: switched");
	});

	it("the same reading leading two data frames in a row takes the name; challengers that alternate never do", () => {
		let s = nextHome(undefined, [c("a", 50), c("b", 49), c("x", 49)], 1, false);
		s = nextHome(s, [c("a", 50), c("b", 50.4), c("x", 49)], 1, false);
		assert.equal(s?.key, "a");
		s = nextHome(s, [c("a", 50), c("b", 50.4), c("x", 49)], 1, false);
		assert.equal(s?.key, "b", "b led twice in a row");
		let t = nextHome(undefined, [c("a", 50), c("b", 49), c("x", 49)], 1, false);
		for (let i = 0; i < 10; i++) t = nextHome(t, [c("a", 50), c("b", i % 2 === 0 ? 50.3 : 49), c("x", i % 2 === 0 ? 49 : 50.3)], 1, false);
		assert.equal(t?.key, "a", "b and x take turns by a hair: the name stays");
	});

	it("lower is worse holds the lowest; a reading that left or has no value gives way at once", () => {
		let s = nextHome(undefined, [c("a", 900), c("b", 1200)], 10, true);
		assert.equal(s?.key, "a");
		s = nextHome(s, [c("b", 1200), c("c", 1300)], 10, true);
		assert.equal(s?.key, "b");
		assert.equal(nextHome(s, [], 10, true), undefined);
	});

	it("one display step comes from the formatted value", () => {
		assert.deepEqual(["48.4", "5060", "1.275", "12"].map(displayStep), [0.1, 1, 0.001, 1]);
	});

	it("the scene names the held reading live, and the highest at the cursor when paused", () => {
		const hold = (input: StripSceneInput): StripSceneInput => ({ ...input, panes: input.panes.map((p) => ({ ...p, group: { ...(p.group as NonNullable<typeof p.group>), homeKey: p.series[3]?.key as string } })) });
		const live = groupFixture({ n: 16, view: "rows", highlight: null });
		const held = live.input.panes[0]?.series[3]?.name as string;
		const names = (input: StripSceneInput): string[] => texts(input).filter((p) => p.size === 13).map((p) => p.text);
		assert.ok(names(hold(live.input)).includes(held), `the held reading is named: ${names(hold(live.input)).join(" | ")}`);
		assert.ok(!names(live.input).includes(held), "without the hold, the highest now is named");
		const paused = groupFixture({ n: 16, view: "rows", highlight: null, paused: true });
		assert.deepEqual(names(hold(paused.input)), names(paused.input), "paused: the cursor's highest, not the held one");
	});

	it("on the runtime, a reading edging ahead for one frame keeps the name; two frames or a clear lead move it", () => {
		const specs = (a: number, b: number): Spec[] => [
			{ sensor: "CPU", label: "Core 0 Clock", unit: "MHz", value: a },
			{ sensor: "CPU", label: "Core 1 Clock", unit: "MHz", value: b },
			{ sensor: "CPU", label: "Core 2 Clock", unit: "MHz", value: 4000 }
		];
		const rt = runtime(specs(5000, 4999));
		const made = rt.request({ event: "stripCreate", opId: "c", layout: "whole", patch: [{ op: "set", path: "panes.0.style", value: "group" }, { op: "set", path: "panes.0.group", value: { from: "folder", keys: [], view: "now" } }] });
		assert.equal(made.ok, true);
		const name = (): string => /font-size="13"[^>]*>(Core \d Clock)</.exec(rt.dials[0]?.feedback.at(-1) ?? "")?.[1] ?? "";
		rt.tick();
		rt.flush();
		assert.equal(name(), "Core 0 Clock");
		rt.setSpecs(specs(5000, 5000.4));
		rt.tick();
		rt.flush();
		assert.equal(name(), "Core 0 Clock", "one frame by a hair: held");
		rt.turn(2, 1, GROUP_TURN_PICKS_READING);
		rt.turn(2, -1, GROUP_TURN_PICKS_READING);
		assert.equal(name(), "Core 0 Clock", "repaints for input judge nothing");
		rt.tick();
		rt.flush();
		assert.equal(name(), "Core 1 Clock", "two data frames in a row: moved");
		rt.setSpecs(specs(5010, 5000.4));
		rt.tick();
		rt.flush();
		assert.equal(name(), "Core 0 Clock", "a clear lead moves it at once");
	});
});

describe("Group Now: a labelled scale and translucent bars", () => {
	it("bars are translucent, sit inside one slice each, and the scale is labelled with its unit once", () => {
		const c = groupFixture({ n: 32, kind: "clock", view: "now", highlight: 5 });
		const scene = buildStripScene(c.input);
		const bars = scene.prims.filter((p): p is CellsPrim => p.k === "cells" && p.layer === "base" && /fill-opacity=/.test(p.paint));
		assert.ok(bars.length > 0);
		const opaque = scene.prims.filter((p): p is CellsPrim => p.k === "cells" && p.rects.some((_, i) => i % 4 === 3 && (p.rects[i] as number) > 6 && (p.rects[i - 1] as number) > 2) && !/fill-opacity=/.test(p.paint));
		assert.deepEqual(opaque, [], "no opaque fill wider than the 1 px whisker");
		for (const p of bars) for (let i = 0; i < p.rects.length; i += 4) assert.equal(Math.floor((p.rects[i] as number) / SLICE_W), Math.floor(((p.rects[i] as number) + (p.rects[i + 2] as number) - 0.01) / SLICE_W), "inside one slice");
		const words = texts(c.input).map((p) => p.text);
		assert.equal(words.filter((w) => w === "MHz").length, 2, "the unit once on the scale, once beside the readout");
		assert.ok(words.filter((w) => /^\d{4}$/.test(w)).length >= 4, `scale ticks and the highlighted value: ${words.join(" | ")}`);
	});

	it("values stand above every bar when they fit, else above the highlighted and the highest only", () => {
		const few = texts(groupFixture({ n: 8, kind: "clock", view: "now", highlight: 5 }).input).filter((p) => p.size === 11 && p.weight === 700 && /^\d{4}$/.test(p.text));
		assert.equal(few.length, 8);
		const many = texts(groupFixture({ n: 32, kind: "clock", view: "now", highlight: 2, layout: "split", encoders: 4 }).input).filter((p) => p.size === 11 && p.weight === 700 && /^\d{4}$/.test(p.text));
		assert.ok(many.length >= 1 && many.length <= 4, `two per pane at most: ${many.length}`);
	});

	it("limits cross the columns as lines with their labels", () => {
		const words = allText(groupFixture({ n: 16, view: "now", limits: { warn: 85, crit: 95 } }).input);
		assert.match(words, /warn 85/);
		assert.match(words, /crit 95/);
	});
});

describe("Group Spread: a visible band, a median, no ringed context strokes", () => {
	it("the band is translucent ramp blue, the median 1.5 px outside the edge filter, the highlighted line on top", () => {
		const scene = buildStripScene(groupFixture({ n: 16, view: "spread", background: "tint", highlight: 5 }).input);
		assert.ok(scene.prims.some((p) => p.k === "envelope"), "the band");
		assert.match(scene.paints, /#3FA1D5/);
		const median = scene.prims.find((p) => p.k === "line" && p.width === 1.5);
		assert.equal(median?.layer, "base", "the median is not ringed by Tint's edge filter");
		const lines = scene.prims.filter((p) => p.k === "line");
		assert.equal(lines.at(-1)?.k === "line" ? lines.at(-1)?.width : 0, 2, "the highlighted line last, on top");
		assert.ok(lines.every((p) => p.k !== "line" || p.backing === undefined), "no backing strokes off Clear");
		const auto = buildStripScene(groupFixture({ n: 8, view: "auto", background: "tint", highlight: 5 }).input);
		assert.ok(auto.prims.filter((p) => p.k === "line" && p.width === 1).every((p) => p.layer === "base"), "muted lines stay out of the edge filter");
	});
});

describe("Group Spread on real history: empty buckets inside a run are continuous, as the line treats them", () => {
	const bandsOf = (input: StripSceneInput): EnvelopePrim[] => buildStripScene(input).prims.filter((p): p is EnvelopePrim => p.k === "envelope");
	const spanOf = (band: EnvelopePrim): readonly [number, number] => [band.top[0] as number, band.top[band.top.length - 2] as number];

	it("16 readings at 5 minutes, 2 px buckets and 2 s between samples: one band, one median and two edges across the whole plot", () => {
		const trace = pollTrace({ n: 16, unit: "%", pool: "group", value: (i, at) => 40 + 20 * Math.sin(at / 9000 + i) });
		const { input } = traceFrame(trace, traceGroup(trace, "spread", "gaps"));
		const bands = bandsOf(input);
		assert.equal(bands.length, 1, `one band, not ${bands.length} fragments`);
		const [x0, x1] = spanOf(bands[0] as EnvelopePrim);
		assert.ok(x1 - x0 > 900, `the band spans the plot, ${x0}..${x1}`);
		const lines = buildStripScene(input).prims.filter((p): p is LinePrim => p.k === "line" && p.layer === "base" && p.width === 1.5);
		assert.equal(lines.length, 1, `one median, not ${lines.length} dots`);
	});

	it("a stretch no reading was observed still breaks all three", () => {
		const end = 1_000_000;
		const trace = pollTrace({ n: 16, unit: "%", pool: "group", value: (i, at) => 40 + 20 * Math.sin(at / 9000 + i), kind: (_tick, at) => (at > end - 120_000 && at < end - 100_000 ? "unavailable" : undefined) });
		const bands = bandsOf(traceFrame(trace, traceGroup(trace, "spread", "gaps")).input);
		assert.equal(bands.length, 2, "the band ends at the outage and starts again after it");
		const first = spanOf(bands[0] as EnvelopePrim);
		const second = spanOf(bands[1] as EnvelopePrim);
		assert.ok(second[0] - first[1] >= 60, `the outage stays open, ${first[1]}..${second[0]}`);
	});

	it("Leave gaps breaks the band at a skipped read, as it breaks the line", () => {
		const times = evenly(1, 300);
		const trace = pollTrace({ n: 16, unit: "%", pool: "group", value: (i, at) => 40 + 20 * Math.sin(at / 9000 + i), kind: skipsAt(times) });
		assert.equal(bandsOf(traceFrame(trace, traceGroup(trace, "spread", "gaps")).input).length, 2);
	});
});

describe("Group Spread: the highlighted line lies inside the band", () => {
	/** At every x the lead line has a point, the band's top and bottom at
	 * that x (the band is built from every reading, the lead included). */
	function outside(input: StripSceneInput): string[] {
		const scene = buildStripScene(input);
		const bands = scene.prims.filter((p): p is EnvelopePrim => p.k === "envelope");
		const lead = scene.prims.filter((p): p is LinePrim => p.k === "line" && p.width === 2);
		const misses: string[] = [];
		if (lead.length === 0) misses.push("no highlighted line");
		for (const line of lead) {
			for (let i = 0; i < line.pts.length; i += 2) {
				const x = line.pts[i] as number;
				const y = line.pts[i + 1] as number;
				const band = bands.find((b) => (b.top[0] as number) <= x && x <= (b.top[b.top.length - 2] as number));
				const k = band === undefined ? -1 : band.top.findIndex((v, j) => j % 2 === 0 && v === x);
				if (band === undefined || k < 0) {
					misses.push(`x ${x}: no band`);
					continue;
				}
				const top = band.top[k + 1] as number;
				const bottom = band.bottom[k + 1] as number;
				if (y < top - 1 || y > bottom + 1) misses.push(`x ${x}: line ${y} outside ${top}..${bottom}`);
			}
		}
		return misses;
	}

	it("at every bucket, at N = 4, 8, 16 and 32, with gaps and stale readings, on every deck and layout", () => {
		for (const n of [4, 8, 16, 32]) {
			for (const [layout, encoders] of [["whole", 6], ["split", 6], ["whole", 4], ["split", 4]] as const) {
				for (const gapEvery of [0, 7]) {
					for (const highlight of [0, 5 % n, n - 1]) {
						const c = groupFixture({ n, view: "spread", layout, encoders, gapEvery, highlight, noise: gapEvery === 0 ? undefined : 12, limits: { warn: 85, crit: 95 } });
						const stale: StripSceneInput = { ...c.input, panes: c.input.panes.map((p) => ({ ...p, series: p.series.map((s, i) => (i % 3 === 1 ? { ...s, state: "stale" as const } : s)) })) };
						for (const input of [c.input, stale]) {
							const misses = outside(input);
							assert.deepEqual(misses.slice(0, 3), [], `n ${n} ${layout} ${encoders} gaps ${gapEvery} lead ${highlight}: ${misses.length} points outside`);
						}
					}
				}
			}
		}
	});

	it("the band's edges are drawn, and the limit lines stay out of Tint's edge filter", () => {
		const c = groupFixture({ n: 16, view: "spread", background: "tint", limits: { warn: 85, crit: 95 }, highlight: 5 });
		const scene = buildStripScene(c.input);
		const edges = scene.prims.filter((p): p is LinePrim => p.k === "line" && p.width === 1 && p.layer === "base");
		assert.ok(edges.length >= 2, "top and bottom edges");
		for (const level of ["warn", "crit"] as const) {
			const line = scene.prims.find((p) => p.k === "rect" && p.h === 1 && p.paint === `fill="${c.input.alertColors[level]}"`);
			assert.equal(line?.layer, "base", `${level} line in the warn or crit color, unringed`);
		}
	});
});
