/**
 * Large readouts and the Scale and grid overlay.
 *
 * - Settings: exact values only, written only when set; an edit adds,
 *   changes and removes them, and a copy without them is written as before.
 * - Geometry: a left readout takes the pane's first dial slot, the graph the
 *   rest, over the same window (a narrower graph never claims a longer one).
 * - Layout: digits sized by measured ink, one size per box, never cut (the
 *   lone "…"), legibility floors (digit cap heights) per mode and geometry.
 * - Honesty: stale, missing and non-finite readings show their word, never
 *   a number; an alert colors the value; every look keeps a contrast floor.
 * - Seams: a large value, a scale label or a time label never crosses one,
 *   and the stitched slices of every new scene equal the full-width frame.
 * - Payload: every slice of the readout matrix stays inside the 8 KB bound.
 * - Goldens: one hash per scene of the readout matrix (mode x style x look
 *   x geometry), so a later change to these faces is a deliberate one.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { diffRasters, fixtureCase, readoutMatrix, READOUT_GEOMETRIES, renderCase, type FixtureCase } from "../scripts/lib/strip-fixtures";
import { setFaceFont } from "../src/ui/face-font";
import { inkEdges } from "../src/ui/format";
import { contrastRatio } from "../src/ui/text-colors";
import { shortSpan, timeTicks, valueTicks } from "../src/strip/axes";
import { applyStripEdit } from "../src/strip/edits";
import { graphExtent, paneExtents, panePlotOf, plotFor, readoutExtent, SLICE_W } from "../src/strip/geometry";
import type { TextPrim } from "../src/strip/prims";
import { barGapFor, digitMetrics, nameRungs, onlyStacks, planReadout, READOUT_OVERFLOW, type ReadoutItem } from "../src/strip/readout";
import { buildStripScene, historyWidthFor, renderLogical, textInkBox, type StripSceneInput } from "../src/strip/scene";
import { stripConfigOf, stripConfigToJson, stripPaneOf } from "../src/strip/settings";
import { sliceStrip, SLICE_PAYLOAD_LIMIT, svgBytes } from "../src/strip/slicer";

setFaceFont("tahoma");

const set = (path: string, value: unknown): { op: "set"; path: string; value: unknown } => ({ op: "set", path, value });

describe("settings: readout, Scale and grid", () => {
	it("reads exact values only; anything else is off, trend, or absent", () => {
		assert.equal(stripPaneOf({ readout: "left" }).readout, "left");
		assert.equal(stripPaneOf({ readout: "only" }).readout, "only");
		for (const raw of ["off", "Left", " left", true, 1, null, {}]) assert.equal("readout" in stripPaneOf({ readout: raw }), false, String(raw));
		assert.equal(stripPaneOf({ overlays: { axes: true } }).overlays.axes, true);
		for (const raw of [false, "true", 1]) assert.equal("axes" in stripPaneOf({ overlays: { axes: raw } }).overlays, false, String(raw));
	});

	it("a copy without the new fields is written exactly as before", () => {
		const config = stripConfigOf({ layout: "whole", encoders: 6, panes: [{ style: "compare", series: [{ key: "a" }, { key: "b" }] }] });
		const json = JSON.stringify(stripConfigToJson(config));
		assert.doesNotMatch(json, /readout|axes/);
	});

	it("an edit sets, changes and clears them; bad values refuse the whole patch", () => {
		const base = { id: "0123456789abcdef0123456789abcdef", rev: 2, config: stripConfigOf({ layout: "split", encoders: 4, panes: [{ style: "trend", series: [{ key: "a" }] }, { style: "trend", series: [{ key: "b" }] }] }) };
		const on = applyStripEdit(base, 2, [set("panes.0.readout", "left"), set("panes.1.readout", "only"), set("panes.0.overlays.axes", true), set("panes.1.style", "area")]);
		assert.ok(on.ok);
		assert.equal(on.copy.config.panes[0].readout, "left");
		assert.equal(on.copy.config.panes[1].readout, "only");
		assert.equal(on.copy.config.panes[0].overlays.axes, true);
		assert.equal(on.copy.config.panes[1].style, "area");
		const json = stripConfigToJson(on.copy.config) as { panes: { readout?: string; overlays: Record<string, unknown> }[] };
		assert.equal(json.panes[0]?.readout, "left");
		assert.equal(json.panes[0]?.overlays.axes, true);
		const off = applyStripEdit({ ...base, rev: 3, config: on.copy.config }, 3, [set("panes.0.readout", "off"), set("panes.0.overlays.axes", false)]);
		assert.ok(off.ok);
		assert.equal("readout" in off.copy.config.panes[0], false);
		assert.doesNotMatch(JSON.stringify(stripConfigToJson(off.copy.config).panes), /"readout":"left"|"axes"/);
		for (const bad of [set("panes.0.readout", "big"), set("panes.0.readout", true), set("panes.0.overlays.axes", "yes"), set("panes.0.overlays.grid", true), set("panes.0.style", "range")]) {
			assert.equal(applyStripEdit(base, 2, [set("window", "1m"), bad]).ok, false, JSON.stringify(bad));
		}
	});

	it("a field a newer version adds to the overlays survives an edit", () => {
		const raw = { layout: "whole", encoders: 6, panes: [{ style: "trend", series: [{ key: "a" }], overlays: { axes: true, future: 3 } }] };
		const config = stripConfigOf(raw);
		const json = stripConfigToJson(config, raw) as { panes: { overlays: Record<string, unknown> }[] };
		assert.equal(json.panes[0]?.overlays.future, 3);
		assert.equal(json.panes[0]?.overlays.axes, true);
	});
});

describe("geometry: the readout's slot and the graph's rest", () => {
	it("a left readout is the pane's first dial slot, never past a seam", () => {
		for (const g of READOUT_GEOMETRIES) {
			for (const extent of paneExtents(g.layout, g.encoders)) {
				const slot = readoutExtent("left", extent);
				assert.ok(slot !== null);
				assert.equal(slot.x0, extent.x0);
				assert.equal(Math.floor(slot.x0 / SLICE_W), Math.floor((slot.x1 - 1) / SLICE_W), "inside one slice");
				assert.equal(slot.x1 % SLICE_W, 0, "ends on a seam");
				const graph = graphExtent("left", extent);
				assert.equal(graph.x0, slot.x1);
				assert.equal(graph.x1, extent.x1);
			}
		}
		const only = paneExtents("whole", 6)[0] as { x0: number; x1: number };
		assert.equal(graphExtent("only", only).x1 - graphExtent("only", only).x0, 0);
		assert.deepEqual(graphExtent(undefined, only), only);
		assert.equal(readoutExtent(undefined, only), null);
	});

	it("the narrower graph shows the same window: each bucket is longer, the span is not", () => {
		const extent = paneExtents("whole", 6)[0] as { x0: number; x1: number };
		const full = plotFor("trend", extent, 2);
		const beside = panePlotOf({ style: "trend", readout: "left" }, extent, 2);
		assert.equal(full.buckets, 600);
		assert.equal(beside.buckets, 500);
		const config = stripConfigOf({ layout: "whole", encoders: 6, panes: [{ style: "trend", series: [{ key: "a" }], readout: "left" }] });
		assert.equal(historyWidthFor(config, 6, 0), 500, "history is asked at the graph's own width, over the whole window");
		const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "theme", accent: false, extras: [{ readout: "left", series: ["cpu"] }] });
		const view = c.input.panes[0]?.series[0]?.history;
		assert.equal(view?.widthPx, 500);
		assert.equal(view?.windowMs, 300_000);
	});
});

describe("readout layout", () => {
	const item = (text: string, unit = "°C", name = "CPU Package", sizing: string[] = []): ReadoutItem => ({ text, numeric: true, sizing, unit, names: name === "" ? [] : [name] });
	const slot = { x0: 0, x1: 200, y0: 0, y1: 100 };

	it("digits fit by measured ink inside the cell, one size for every value", () => {
		for (const font of ["tahoma", "segoe-ui"] as const) {
			setFaceFont(font);
			for (const n of [1, 2, 3, 4]) {
				const items = Array.from({ length: n }, (_, i) => item(["63.4", "1250", "0.85", "100.0"][i] as string));
				const plan = planReadout(items, slot, { align: "right", names: true });
				assert.ok(plan !== null);
				for (const cell of plan.cells) {
					assert.equal(cell.valueSize, plan.size);
					const ink = inkEdges([{ text: cell.text, fontSize: cell.valueSize, fontWeight: 700 }], "end", cell.valueEnd);
					assert.ok(ink.left >= cell.box.x0 && ink.right <= cell.box.x1, `${font} ${n}: ${cell.text} ink ${ink.left}..${ink.right} in ${cell.box.x0}..${cell.box.x1}`);
					const m = digitMetrics();
					assert.ok(cell.baseline - m.top * plan.size >= cell.box.y0 - 0.5 && cell.baseline + m.drop * plan.size <= cell.box.y1 + 0.5, `${font} ${n}: vertical`);
				}
			}
		}
		setFaceFont("tahoma");
	});

	it("the size follows the widest value the window can show, so it holds as the value moves", () => {
		const narrow = planReadout([item("9.5", "°C", "x", ["9.5", "120.4"])], slot, { align: "right", names: true });
		const wide = planReadout([item("120.4", "°C", "x", ["9.5", "120.4"])], slot, { align: "right", names: true });
		assert.equal(narrow?.size, wide?.size);
	});

	it("a number that cannot fit even at the floor draws the lone overflow mark, never a cut number", () => {
		const plan = planReadout([item("123456789012345678901234567890")], slot, { align: "right", names: false });
		assert.equal(plan?.cells[0]?.text, READOUT_OVERFLOW);
	});

	it("the color mark keeps 0.15 of the type size clear of the digits", () => {
		for (const n of [1, 2, 3]) {
			const plan = planReadout(Array.from({ length: n }, () => item("63.4")), slot, { align: "right", names: true });
			assert.ok(plan !== null);
			for (const cell of plan.cells) {
				const ink = inkEdges([{ text: cell.text, fontSize: cell.valueSize, fontWeight: 700 }], "end", cell.valueEnd);
				assert.ok(ink.left - (cell.bar.x + cell.bar.w) >= barGapFor(plan.size) - 0.5, `${n}: gap ${ink.left - (cell.bar.x + cell.bar.w)} at ${plan.size} px`);
				assert.ok(barGapFor(plan.size) >= 0.15 * plan.size);
			}
		}
	});

	it("the unit sits on the digits' baseline, to their right, whenever it fits there", () => {
		for (const n of [1, 2, 3]) {
			const plan = planReadout(Array.from({ length: n }, () => item("63.4")), slot, { align: "center", names: true });
			assert.equal(plan?.unitPlace, "beside");
			for (const cell of plan?.cells ?? []) {
				assert.equal(cell.unit?.y, cell.baseline);
				assert.ok((cell.unit?.x ?? 0) > cell.valueEnd - 1);
			}
		}
	});

	it("a name shortens by rungs and is never cut: the longest whole rung that fits, else none", () => {
		assert.deepEqual(nameRungs("CPU Package Temperature (Tdie average)", ["CPU Package Temperature (Tdie average)", "GPU Temperature"]), ["CPU Package Temperature (Tdie average)", "CPU Package Temperature", "CPU Pkg Temp", "CPU Pkg", "Pkg Temp", "CPU"]);
		assert.deepEqual(nameRungs("GPU Hot Spot", ["GPU Temperature", "GPU Hot Spot"]), ["GPU Hot Spot", "Hot Spot", "Hot"]);
		assert.deepEqual(nameRungs("GPU Hot Spot", ["CPU Package Power", "GPU Hot Spot"]), ["GPU Hot Spot", "Hot Spot", "GPU"]);
		assert.deepEqual(nameRungs("GPU Temperature", ["CPU Package Temperature (Tdie average)", "GPU Temperature"]), ["GPU Temperature", "GPU Temp", "GPU"]);
		for (const n of [1, 2, 3]) {
			const names = ["CPU Package Temperature (Tdie average)", "GPU Temperature", "GPU Hot Spot"].slice(0, n);
			const items = names.map((name, i): ReadoutItem => ({ text: ["63.4", "58.4", "80.1"][i] as string, numeric: true, sizing: [], unit: "°C", names: nameRungs(name, names) }));
			const plan = planReadout(items, slot, { align: "right", names: true });
			for (const cell of plan?.cells ?? []) {
				if (cell.name === undefined) continue;
				assert.ok(!cell.name.text.includes("…"), cell.name.text);
				assert.ok((items[cell.item]?.names ?? []).includes(cell.name.text));
			}
		}
		const tight = planReadout([{ text: "63.4", numeric: true, sizing: [], unit: "°C", names: ["Supercalifragilistic"] }], { x0: 0, x1: 60, y0: 0, y1: 100 }, { align: "right", names: true });
		assert.equal(tight?.cells[0]?.name, undefined, "no rung fits: the color mark stands alone");
	});

	it("values only: more readings than dial slots stack in every slot, the first ones one more", () => {
		assert.deepEqual(onlyStacks(4, 2), [[0, 1], [2, 3]]);
		assert.deepEqual(onlyStacks(3, 2), [[0, 1], [2]]);
});
});

/** The large values' digit size in a scene (font-size of its 700 text). */
function readoutSize(scene: ReturnType<typeof buildStripScene>): number {
	return Math.max(0, ...scene.prims.filter((p): p is TextPrim => p.k === "text" && p.pinned === true && p.weight === 700).map((p) => p.size));
}

describe("legibility: digit cap heights per mode and geometry", () => {
	const cap = (size: number): number => size * digitMetrics().cap;
	const rows: string[] = [];
	for (const font of ["tahoma", "segoe-ui"] as const) {
		for (const g of READOUT_GEOMETRIES) {
			for (const [mode, series] of [
				["left", ["cpu"]],
				["left", ["cpu", "gpu"]],
				["left", ["cpu", "gpu", "hot"]],
				["only", ["cpu"]],
				["only", ["cpu", "gpu", "hot"]]
			] as const) {
				it(`${font}, ${g.encoders * 200} ${g.layout}, ${mode}, ${series.length} reading${series.length > 1 ? "s" : ""}`, () => {
					setFaceFont(font);
					const c = fixtureCase({ styles: [series.length === 1 ? "trend" : "compare"], layout: g.layout, encoders: g.encoders, background: "theme", accent: false, extras: [{ readout: mode, series: [...series] }] });
					const size = readoutSize(buildStripScene(c.input));
					setFaceFont("tahoma");
					const px = cap(size);
					rows.push(`${font} ${g.encoders * 200} ${g.layout} ${mode} x${series.length}: ${size} px type, ${px.toFixed(1)} px digits`);
					// Floors for reading at arm's length and past it (16 arcmin at
					// 50 cm is about 24 px of digit height on the strip's 7 px/mm).
					// Values only stacks readings when the pane has fewer slots than them.
					const slots = (g.encoders * (g.layout === "whole" ? 1 : 0.5));
					const floor = mode === "only" ? (series.length > slots ? 24 : 30) : series.length === 1 ? 30 : 24;
					assert.ok(px >= floor, `${px.toFixed(1)} px < ${floor}`);
				});
			}
		}
	}
	it("prints the table", () => {
		console.error(`readout digit heights:\n${rows.join("\n")}`);
	});
});

describe("honest values", () => {
	const base = (extras: { readout: "left" | "only"; series: string[] }, background: "theme" | "clear" | "glass" | "tint" | "outline" = "theme", accent = false): StripSceneInput => fixtureCase({ styles: [extras.series.length === 1 ? "trend" : "compare"], layout: "whole", encoders: 6, background, accent, extras: [extras] }).input;
	const withSeries = (input: StripSceneInput, patch: (s: StripSceneInput["panes"][number]["series"][number], i: number) => StripSceneInput["panes"][number]["series"][number]): StripSceneInput => ({ ...input, panes: input.panes.map((p) => ({ ...p, series: p.series.map(patch) })) });
	const bigTexts = (input: StripSceneInput): TextPrim[] => buildStripScene(input).prims.filter((p): p is TextPrim => p.k === "text" && p.pinned === true && p.weight === 700);

	it("stale, missing and unavailable readings show their word, never a number", () => {
		for (const mode of ["left", "only"] as const) {
			for (const [state, word] of [
				["stale", "stale"],
				["missing", "not found"],
				["unavailable", "unavailable"]
			] as const) {
				const input = withSeries(base({ readout: mode, series: ["cpu", "gpu"] }), (s, i) => (i === 0 ? { ...s, state } : s));
				const texts = bigTexts(input).map((p) => p.text);
				assert.ok(texts.includes(word), `${mode} ${state}: ${texts.join(",")}`);
				assert.ok(!texts.some((t) => /^\d/.test(t) && t.startsWith("63")), `${mode} ${state}: no stale number`);
			}
		}
	});

	it("a non-finite live value with no history is no data, not zero", () => {
		const input = withSeries(base({ readout: "left", series: ["cpu"] }), (s) => {
			const { current: _c, history: _h, ...rest } = s;
			void _c;
			void _h;
			return { ...rest, current: Number.NaN };
		});
		const texts = bigTexts(input).map((p) => p.text);
		assert.deepEqual(texts, ["no data"]);
	});

	it("a value inside its reading's band takes the alert color", () => {
		const input = base({ readout: "left", series: ["power"] });
		const pane = input.panes[0];
		assert.ok(pane !== undefined);
		const crit = { ...input, panes: [{ ...pane, series: pane.series.map((s) => ({ ...s, current: 300 })), bands: [{ level: "crit" as const, from: 250, to: Number.POSITIVE_INFINITY, readingKey: pane.series[0]?.key as string, label: "crit 250 W", source: "strip" as const }] }] };
		const value = bigTexts(crit).find((p) => p.text === "300");
		assert.equal(value?.fill, crit.alertColors.crit);
	});

	it("every look keeps the value above the numeric contrast floor on its surface; Clear draws one ink", () => {
		for (const background of ["theme", "glass", "tint", "outline", "clear"] as const) {
			for (const accent of [false, true]) {
				const input = base({ readout: "only", series: ["cpu", "gpu", "hot"] }, background, accent);
				const values = bigTexts(input);
				assert.ok(values.length === 3);
				if (background === "clear") {
					assert.equal(new Set(values.map((v) => v.fill)).size, 1, "one ink");
					continue;
				}
				// Glass resolves text on its hardest surface; Tint and Outline draw
				// an edge as well, so the theme background is the floor's surface.
				const surface = input.palette.bg;
				for (const v of values) assert.ok(contrastRatio(v.fill, surface) >= 4.4, `${background}${accent ? "+accent" : ""}: ${v.fill} on ${surface}`);
			}
		}
	});
});

describe("Scale and grid", () => {
	it("value ticks are round numbers, at most as many as asked, widening a followed end", () => {
		assert.deepEqual(valueTicks(33.8, 67.9, 5)?.values, [30, 40, 50, 60, 70]);
		assert.deepEqual(valueTicks(0.12, 0.47, 4)?.values, [0, 0.2, 0.4, 0.6]);
		assert.equal(valueTicks(0.12, 0.47, 4)?.decimals, 1);
		const typed = valueTicks(20, 95, 5, { lo: true, hi: true });
		assert.equal(typed?.lo, 20);
		assert.equal(typed?.hi, 95);
		assert.ok(typed?.values.every((v) => v >= 20 && v <= 95));
		assert.equal(valueTicks(5, 5, 4), null);
		assert.equal(valueTicks(Number.NaN, 5, 4), null);
	});

	it("time ticks: every 15 s on 1 minute, every minute on 5, every 5 on 15", () => {
		assert.deepEqual(timeTicks(60_000).map((t) => t.label), ["-15s", "-30s", "-45s"]);
		assert.deepEqual(timeTicks(300_000).map((t) => t.label), ["-1m", "-2m", "-3m", "-4m"]);
		assert.deepEqual(timeTicks(900_000).map((t) => t.label), ["-5m", "-10m"]);
		assert.equal(shortSpan(300_000), "5m");
	});

	it("ticks are labelled in °F when the strip shows °F, and the window's extremes are named as the window's", () => {
		const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "theme", accent: false, fahrenheit: true, extras: [{ axes: true, series: ["cpu"] }] });
		const prims = buildStripScene(c.input).prims;
		const texts = prims.filter((p): p is TextPrim => p.k === "text").map((p) => p.text);
		assert.ok(texts.some((t) => /^\d+ °F$/.test(t)), texts.join(" | "));
		// The extremes are marked where they happened; a label, where the
		// rows' words leave it room, names them as the window's.
		assert.ok(prims.filter((p) => p.k === "rect" && p.w === 4 && p.h === 4).length >= 2, "both extremes marked");
		assert.ok(texts.filter((t) => /^(max|min) /.test(t)).every((t) => /^(max|min) \d+(\.\d)? in 5 min$/.test(t)), texts.join(" | "));
		// The time ticks the bottom row's words leave free are labelled.
		assert.ok(["-1m", "-2m", "-3m"].every((t) => texts.includes(t)) && texts.some((t) => t.startsWith("-5m")), texts.join(" | "));
	});

	it("the window's extremes are named as the window's where the plot has room for them", () => {
		const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "theme", accent: false, extras: [{ axes: true, series: ["gpu"] }] });
		const texts = buildStripScene(c.input).prims.filter((p): p is TextPrim => p.k === "text").map((p) => p.text);
		assert.ok(texts.some((t) => /^(max|min) \d+(\.\d)? in 5 min$/.test(t)), texts.join(" | "));
	});
});

describe("seams: large values and labels stay in one slice", () => {
	const cases = readoutMatrix();
	it(`covers ${cases.length} scenes: 4 modes x 5 styles x 6 looks x 4 geometries`, () => {
		assert.equal(cases.length, 480);
		assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
	});

	it("every pinned text (large values, scale and time labels) inks inside one slice and is sent only there", () => {
		let checked = 0;
		for (const c of cases) {
			const r = sliceStrip(c.input);
			for (const p of r.scene.prims) {
				if (p.k !== "text" || p.pinned !== true) continue;
				const ink = inkEdges([{ text: p.text, fontSize: p.size, fontWeight: p.weight }], p.anchor, p.x);
				const column = Math.floor(ink.left / SLICE_W);
				assert.equal(Math.floor((ink.right - 0.01) / SLICE_W), column, `${c.id}: "${p.text}" ink ${ink.left.toFixed(1)}..${ink.right.toFixed(1)}`);
				const holders = r.slices.filter((svg) => svg !== null && svg.includes(`>${p.text.replace(/&/g, "&amp;")}</text>`) && svg.includes(`font-size="${p.size}"`));
				assert.ok(holders.length >= 1, `${c.id}: "${p.text}" drawn`);
				checked++;
			}
		}
		assert.ok(checked > 2000, String(checked));
	});

	it("no two words of a scene touch: band labels, extremes, ticks, captions, readouts, rows (measured boxes)", () => {
		const clash: string[] = [];
		for (const c of cases) {
			const scene = buildStripScene(c.input);
			const boxes = scene.prims.filter((p): p is TextPrim => p.k === "text").map((p) => ({ p, b: textInkBox(p) }));
			for (let i = 0; i < boxes.length; i++) {
				for (let j = i + 1; j < boxes.length; j++) {
					const a = boxes[i] as { p: TextPrim; b: ReturnType<typeof textInkBox> };
					const z = boxes[j] as { p: TextPrim; b: ReturnType<typeof textInkBox> };
					if (a.b.x0 < z.b.x1 && z.b.x0 < a.b.x1 && a.b.y0 < z.b.y1 && z.b.y0 < a.b.y1) clash.push(`${c.id}: "${a.p.text}" / "${z.p.text}"`);
				}
			}
		}
		assert.deepEqual(clash.slice(0, 20), [], `${clash.length} touching pairs`);
	});

	it("alert band labels shorten the reading's name whole, then drop it; the limit is never cut", () => {
		let bands = 0;
		for (const c of cases) {
			for (const p of buildStripScene(c.input).prims) {
				if (p.k !== "text" || !/(warn|crit) \d/.test(p.text)) continue;
				bands++;
				assert.ok(!p.text.includes("…"), `${c.id}: "${p.text}"`);
				assert.match(p.text, /(warn|crit) [\d.]+( \S+)?$/, `${c.id}: "${p.text}"`);
			}
		}
		assert.ok(bands > 100, String(bands));
	});

	it("a small trend under a value breaks only where its history does", () => {
		const trends = (series: string[]): number[] => {
			const c = fixtureCase({ styles: ["compare"], layout: "whole", encoders: 6, background: "theme", accent: false, extras: [{ readout: "only", series }] });
			const lines = buildStripScene(c.input).prims.filter((p) => p.k === "line");
			return [...new Set(lines.map((p) => (p.k === "line" ? p.stroke : "")))].map((stroke) => lines.filter((p) => p.k === "line" && p.stroke === stroke).length);
		};
		// GPU temperature has no gap (it starts late); load has none at all.
		assert.deepEqual(trends(["gpu", "load"]), [1, 1]);
		// The CPU fixture has a gap at 55 to 60 % of the window, the hot spot
		// one at 40 to 47 %: each of those trends is two pieces.
		assert.deepEqual(trends(["cpu", "hot"]), [2, 2]);
	});

	it("every slice stays inside the payload bound", () => {
		let worst = 0;
		let worstId = "";
		for (const c of cases) {
			const r = sliceStrip(c.input);
			for (const svg of r.slices) {
				if (svg === null) continue;
				const bytes = svgBytes(svg);
				if (bytes > worst) {
					worst = bytes;
					worstId = c.id;
				}
			}
			assert.ok(r.maxBytes <= SLICE_PAYLOAD_LIMIT, `${c.id}: ${r.maxBytes}`);
		}
		console.error(`readout matrix: largest slice ${worst} bytes (${worstId})`);
	});

	const TOLERANCE = 2;
	const NOISE_MAX = 40;
	const NOISE_PIXELS = 32;
	// Outline and Tint ring their marks, and every look rings the row words
	// over the plot (scene.ts ROWS_FILTER): drawn past the viewport, as
	// QtSvg does.
	const halo = (c: FixtureCase): boolean => c.input.config.background === "tint" || c.input.config.background === "outline" || buildStripScene(c.input).prims.some((p) => p.layer === "rows");
	for (const g of READOUT_GEOMETRIES) {
		it(`stitched slices equal the full-width frame: ${g.encoders * 200} ${g.layout}`, async () => {
			const subset = cases.filter((c) => c.input.encoders === g.encoders && c.input.config.layout === g.layout && (c.input.config.background === "glass" || (c.input.config.background === "outline" && !c.input.config.accentWords)));
			assert.ok(subset.length === 40);
			for (const c of subset) {
				const r = await renderCase(c, halo(c));
				const d = diffRasters(r.reference, r.stitched, TOLERANCE);
				// Since the plot takes the strip's height every line's steep
				// strokes have long steep edges across the whole strip, where cairo's scan converter
				// moves coverage by a few levels anywhere along them (row mode
				// follows every edge in a row): every case is held to the noise
				// ceiling everywhere and to the pixel count at the seams, where a
				// break would show. A slice that lost a primitive differs by far
				// more than the ceiling.
				const away = new Set<number>();
				for (let x = 0; x < r.width; x++) if (Math.min(x % SLICE_W, SLICE_W - (x % SLICE_W)) > 2) away.add(x);
				const atSeams = diffRasters(r.reference, r.stitched, TOLERANCE, away);
				assert.ok(d.maxDiff <= NOISE_MAX && atSeams.over <= NOISE_PIXELS, `${c.id}: max ${d.maxDiff}, ${d.over} px over ${TOLERANCE}, ${atSeams.over} at seams (worst ${JSON.stringify(d.worst)})`);
			}
		});
	}
});

/** One SHA-256 per scene of readoutMatrix. Regenerated on 2026-10-28 for 390
 * of 576 scenes, when the Y scale went calm (src/strip/scale.ts): every
 * graph beside large values and every Scale and grid scene takes the calm
 * round ends and the reserved end column (Lanes rounded and held, Heat's
 * legend on round held ends); every Large values only scene kept its bytes
 * (its small trends keep the key sparkline's grammar). Regenerated on
 * 2026-11-04 for 100 scenes on the see-through looks, when the words over a
 * graph took their small tabs (WORD_TAB; all 576 scenes, drawn without the
 * tabs, still hashed to what was recorded here), for 24 Lanes scenes, when a
 * lane with Scale and grid off asks for six ticks, for 48 Trend and
 * Envelope scenes of two, when the names row stopped repeating the value
 * shown large, and for the 72 Large values only scenes of a Trend, Area or Heat
 * pane, when the stored Graph stopped mattering there: a first reading takes
 * the series' first hue in place of the accent. Regenerated the same day for
 * every Large values only scene, when the readings spread across the pane
 * (planSpread); no other scene moved. */
const GOLDEN = new URL("./golden/strip-readout-slices.json", import.meta.url);

describe("readout goldens: every mode x style x look x geometry", () => {
	const now: Record<string, string> = {};
	for (const c of readoutMatrix()) {
		const r = sliceStrip(c.input);
		now[c.id] = createHash("sha256")
			.update([renderLogical(r.scene), ...r.slices.map((s) => s ?? "(absent)")].join("\n"))
			.digest("hex");
	}
	if (process.env.STRIP_GOLDEN_WRITE === "1") writeFileSync(GOLDEN, `${JSON.stringify(now, null, "\t")}\n`);
	const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;

	it("covers every scene the golden holds", () => {
		assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
	});

	it("every scene draws its recorded bytes", () => {
		assert.deepEqual(
			Object.keys(golden).filter((id) => now[id] !== golden[id]),
			[]
		);
	});
});
