/**
 * Meters' Look (StripPaneV1.meterLook): Thin bar (absent, today's Meters
 * byte for byte), Full bar and Liquid, a tank with a straight surface at
 * the level.
 *
 * - The stored field: exact strings only; absent and anything else read as
 *   Thin bar ("flat", a 1.8 preview's flat tank, included); a known value
 *   round-trips; a value a newer version stored survives a rewrite; an
 *   older build keeps it (extrasOf).
 * - Geometry: the bar's end or the liquid's level lands on the reading, a
 *   percentage on 0 to 100 whatever Scale from and Scale to hold, a reading
 *   past 100 fills the frame and prints its own number.
 * - No word ever sits on the fill: the bar, its end, the liquid, its
 *   surface and the line along it stay clear of every letter at every value.
 * - A reading's words sit against its own frame: aligned to the column's
 *   edge toward it, nearer it than any other frame by 10 px or more; two
 *   readings' frames 20 px apart or more; one pane's frames equally wide,
 *   and the CPU and RAM usage pair's two alike.
 * - Past a limit the value takes the alert color exactly as Meters draws it
 *   (red stays red on every look), the fill past the limit takes it at least
 *   as strong as the bar, and a bar along the foot tells warn (3 px) from
 *   crit (6 px).
 * - The fill reads as a filled bar: 3:1 or more against the empty frame;
 *   every word keeps 4.5:1 on what is behind it.
 * - Liquid's surface is one straight line at the level, so it moves only
 *   with a new value: the same value at a later time draws the same frame;
 *   paused stands still, stale and missing draw no liquid.
 * - Docs: what docs/strip-display.md says each look draws holds on dark,
 *   light and see-through looks: the bar's edge, the liquid's strength
 *   under its surface, and which words take the reading's color.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fixtureCase, makeView, screensMatrix } from "../scripts/lib/strip-fixtures";
import { applyStripEdit } from "../src/strip/edits";
import { fillStrengths } from "../src/strip/fill";
import { paneExtents, spreadCells, type SpreadCell } from "../src/strip/geometry";
import { meterCells } from "../src/strip/meters";
import type { AreaPrim, LinePrim, Prim, TextPrim } from "../src/strip/prims";
import { buildStripScene, historyWidthFor, lookOf, renderLogical, stripAlertColors, stripBandsFor, textInkBox, WINDOW_MS, type StripPaneInput, type StripSceneInput, type StripSeriesInput } from "../src/strip/scene";
import { STRIP_METER_LOOKS, stripConfigOf, stripConfigToJson, stripMeterLookOf, stripPaneOf, stripPaneToJson, type StripConfigV1 } from "../src/strip/settings";
import { sliceStrip, type StripSlices } from "../src/strip/slicer";
import type { JsonObject } from "../src/strip/settings";
import { DIAL_BACKGROUNDS, type DialBackground } from "../src/ui/dial-background";
import { setFaceFont } from "../src/ui/face-font";
import { contrastRatio, luminance, mixToward, readableValueColor } from "../src/ui/text-colors";
import { loadThemes, resolvePalette } from "../src/ui/themes";

setFaceFont("tahoma");

const CPU = { key: "f0000300:0:7000021", name: "Total CPU Usage", unit: "%", type: 7 };
const RAM = { key: "f0000301:0:8000005", name: "Physical Memory Load", unit: "%", type: 8 };
const FAN = { key: "f7006600:0:3000003", name: "CPU Fan", unit: "RPM", type: 3 };
type Reading = typeof CPU;
const FILL_LOOKS = ["full", "liquid"] as const;
const LOOKS: readonly DialBackground[] = ["theme", "glass", "tint", "outline", "clear", "dusk", "stars"];

type One = { r: Reading; now: number; name?: string; color?: string; state?: "ok" | "stale" | "missing"; flat?: boolean };
type Spec = {
	layout: "whole" | "split";
	encoders?: 4 | 6;
	panes: { readings: One[]; crit?: number; warn?: number; below?: boolean; scale?: { min?: number; max?: number } }[];
	look?: string;
	theme?: string;
	background?: DialBackground;
	paused?: boolean;
	nowMs?: number;
	time?: boolean;
};

/** A scene of Meters panes as a strip stores them, each reading's window
 * wandering toward its value now. */
function sceneOf(spec: Spec): StripSceneInput {
	const theme = spec.theme ?? "ember";
	const encoders = spec.encoders ?? 6;
	const rawPanes = spec.panes.map((p) => ({
		style: "meters",
		...(spec.look === undefined ? {} : { meterLook: spec.look }),
		series: p.readings.map((x) => ({ key: x.r.key, ...(x.name === undefined ? {} : { name: x.name }), ...(x.color === undefined ? {} : { color: x.color }) })),
		...(spec.time === false ? { overlays: { time: false } } : {}),
		...(p.scale === undefined ? {} : { scale: p.scale }),
		bands: p.readings.flatMap((x) => (p.crit === undefined && p.warn === undefined ? [] : [{ key: x.r.key, below: p.below === true, ...(p.warn === undefined ? {} : { warn: p.warn }), ...(p.crit === undefined ? {} : { crit: p.crit }) }]))
	}));
	const config: StripConfigV1 = stripConfigOf({ layout: spec.layout, encoders, window: "5m", background: spec.background ?? "theme", accentWords: false, theme, panes: spec.layout === "whole" ? [rawPanes[0], { style: "trend", series: [] }] : rawPanes });
	const themes = loadThemes();
	const palette = resolvePalette(themes, theme, null, "normal");
	const windowMs = WINDOW_MS[config.window];
	const panes: StripPaneInput[] = spec.panes.map((p, i) => {
		const width = historyWidthFor(config, encoders, i, 2);
		const series: StripSeriesInput[] = p.readings.map((x, k) => {
			// A series' own name comes first, as src/strip/frame.ts gives it.
			const name = x.name ?? x.r.name;
			if (x.state === "missing") return { key: x.r.key, name, unit: x.r.unit, state: "missing" };
			const seed = i * 7 + k * 3;
			const history = makeView({ windowMs, widthPx: width, unit: x.r.unit, type: x.r.type, value: (f: number) => Math.max(0, x.now + (1 - f) * (9 * Math.sin(f * 17 + seed) + 4.5 * Math.sin(f * 53 + seed * 3))) });
			return { key: x.r.key, name, unit: x.r.unit, state: x.state ?? "ok", history: spec.nowMs === undefined ? history : { ...history, now: spec.nowMs }, current: x.now };
		});
		return { series, bands: stripBandsFor(config.panes[i as 0 | 1], series, { fahrenheit: false, decimals: config.decimals }), view: spec.paused === true ? { mode: "paused", label: "17:24:06", agoMs: 60_000 } : { mode: "live" }, highlight: 0 };
	});
	return { config, encoders, palette, text: { mode: "theme", color: undefined, dimSecondary: false }, alertColors: stripAlertColors(themes.alertValues, palette, config.background), dataUnits: "decimal", panes };
}

const prims = (input: StripSceneInput): readonly Prim[] => buildStripScene(input).prims;
const texts = (ps: readonly Prim[]): TextPrim[] => ps.filter((p): p is TextPrim => p.k === "text");
type Box = { x0: number; x1: number; y0: number; y1: number };
const meet = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Each fill look's frames: the 1 px outline's top line (marks, 1 px tall
 * at y 2), as boxes from y 2 to 98, left to right. */
function framesOf(ps: readonly Prim[]): Box[] {
	const out: Box[] = [];
	for (const p of ps) {
		if (p.k !== "cells" || p.layer !== "marks") continue;
		for (let i = 0; i < p.rects.length; i += 4) {
			const [x, y, w, h] = p.rects.slice(i, i + 4) as [number, number, number, number];
			if (y === 2 && h === 1 && w > 20) out.push({ x0: x, x1: x + w, y0: 2, y1: 98 });
		}
	}
	return out.sort((a, b) => a.x0 - b.x0);
}
/** The Full bar's fill: base-layer cells inside a frame, as [x0, x1]. */
function barReach(ps: readonly Prim[], frame: Box): { x0: number; x1: number } | null {
	let lo = Infinity;
	let hi = -Infinity;
	for (const p of ps) {
		if (p.k !== "cells" || p.layer !== "base") continue;
		for (let i = 0; i < p.rects.length; i += 4) {
			const [x, , w] = p.rects.slice(i, i + 4) as [number, number, number, number];
			if (x >= frame.x0 && x + w <= frame.x1) {
				lo = Math.min(lo, x);
				hi = Math.max(hi, x + w);
			}
		}
	}
	return lo === Infinity ? null : { x0: lo, x1: hi };
}
/** The line along a liquid's surface inside a frame. */
const surfaceOf = (ps: readonly Prim[], frame: Box): LinePrim | undefined => ps.find((p): p is LinePrim => p.k === "line" && (p.pts[0] as number) >= frame.x0 && (p.pts[p.pts.length - 2] as number) <= frame.x1);
const liquidOf = (ps: readonly Prim[], frame: Box): AreaPrim[] => ps.filter((p): p is AreaPrim => p.k === "area" && (p.pts[0] as number) >= frame.x0 && (p.pts[p.pts.length - 2] as number) <= frame.x1);

/** The value's place as the frame's inner box maps it: from 3 to 97 high,
 * one px in from each side. */
const innerOf = (frame: Box): Box => ({ x0: frame.x0 + 1, x1: frame.x1 - 1, y0: 3, y1: 97 });

/** A stored pane of a stored config. */
const paneJson = (json: JsonObject, i: number): Record<string, unknown> => ((json.panes as unknown as Record<string, unknown>[])[i] ?? {});

const PINNED_METERS = "c0d9440e5e02afe1d3e0d414cef8171475f18ba7614b47f64963abe8506f572a";
const hashOf = (r: StripSlices): string => `${r.bucketPx} ${r.coarsened} ${r.reduced === true} ${r.maxBytes}\n${renderLogical(r.scene)}\n${r.slices.map((s) => s ?? "-").join("\n")}`;

describe("Meters' Look: the stored field", () => {
	it("reads exactly full and liquid; absent, thin, flat and anything else are Thin bar", () => {
		assert.deepEqual([...STRIP_METER_LOOKS], ["full", "liquid"]);
		for (const look of STRIP_METER_LOOKS) assert.equal(stripMeterLookOf(look), look);
		for (const raw of [undefined, null, "", "thin", "flat", "Liquid", "cells", 1, true, {}, []]) assert.equal(stripMeterLookOf(raw), undefined, JSON.stringify(raw));
		assert.equal(Object.hasOwn(stripPaneOf({ style: "meters" }), "meterLook"), false);
		assert.equal(Object.hasOwn(stripPaneOf({ style: "meters", meterLook: "cells" }), "meterLook"), false);
	});

	it("a known look round-trips; a pane with none writes none", () => {
		for (const look of STRIP_METER_LOOKS) {
			const pane = stripPaneOf({ style: "meters", series: [{ key: CPU.key }], meterLook: look });
			assert.equal(pane.meterLook, look);
			assert.equal(stripPaneToJson(pane).meterLook, look);
			assert.equal(paneJson(stripConfigToJson(stripConfigOf({ panes: [{ style: "meters", meterLook: look }] })), 0).meterLook, look);
		}
		assert.equal(Object.hasOwn(stripPaneToJson(stripPaneOf({ style: "meters" })), "meterLook"), false);
	});

	it("a value a newer version stored draws as Thin bar and survives an unrelated edit", () => {
		const config = stripConfigOf({ layout: "whole", panes: [{ style: "meters", meterLook: "cells", series: [{ key: CPU.key }] }] });
		const edited = applyStripEdit({ id: "0".repeat(32), rev: 2, config }, 2, [{ op: "set", path: "window", value: "1m" }]);
		assert.ok(edited.ok);
		if (!edited.ok) return;
		assert.equal(paneJson(stripConfigToJson(edited.copy.config), 0).meterLook, "cells");
	});

	it("a stored flat (a 1.8 preview's flat tank) is any other unknown value: Thin bar on the strip, kept in the stored pane, refused as an edit", () => {
		const raw = (look?: string): Record<string, unknown> => ({ layout: "split", panes: [{ style: "meters", ...(look === undefined ? {} : { meterLook: look }), series: [{ key: CPU.key }] }, { style: "meters", series: [{ key: RAM.key }] }] });
		const config = stripConfigOf(raw("flat"));
		assert.equal(Object.hasOwn(config.panes[0], "meterLook"), false, "flat reads as Thin bar");
		// The strip draws it as Thin bar, byte for byte.
		const drawn = (look?: string): string[] => sliceStrip({ ...sceneOf({ layout: "split", panes: [{ readings: [{ r: CPU, now: 57 }] }, { readings: [{ r: RAM, now: 46 }] }] }), config: stripConfigOf(raw(look)) }).slices.map((x) => x ?? "-");
		assert.deepEqual(drawn("flat"), drawn(undefined), "a stored flat draws Thin bar");
		assert.notDeepEqual(drawn("liquid"), drawn(undefined), "the case can tell a tank from Thin bar");
		// An edit elsewhere writes it back as stored.
		const edited = applyStripEdit({ id: "0".repeat(32), rev: 2, config }, 2, [{ op: "set", path: "window", value: "1m" }]);
		assert.ok(edited.ok);
		if (edited.ok) assert.equal(paneJson(stripConfigToJson(edited.copy.config), 0).meterLook, "flat", "kept in the stored pane");
		assert.equal(applyStripEdit({ id: "0".repeat(32), rev: 2, config }, 2, [{ op: "set", path: "panes.0.meterLook", value: "flat" }]).ok, false, "no Look edit writes flat");
	});

	it("one edit sets it, thin removes it, anything else is refused", () => {
		const config = stripConfigOf({ layout: "whole", panes: [{ style: "meters", series: [{ key: CPU.key }] }] });
		const base = { id: "0".repeat(32), rev: 2, config };
		for (const look of STRIP_METER_LOOKS) {
			const r = applyStripEdit(base, 2, [{ op: "set", path: "panes.0.meterLook", value: look }]);
			assert.ok(r.ok, look);
			if (!r.ok) continue;
			assert.equal(paneJson(stripConfigToJson(r.copy.config), 0).meterLook, look);
			const back = applyStripEdit({ ...base, rev: 3, config: r.copy.config }, 3, [{ op: "set", path: "panes.0.meterLook", value: "thin" }]);
			assert.ok(back.ok);
			if (back.ok) assert.equal(Object.hasOwn(paneJson(stripConfigToJson(back.copy.config), 0), "meterLook"), false);
		}
		for (const bad of ["cells", "flat", "", null, 1, "Liquid"]) assert.equal(applyStripEdit(base, 2, [{ op: "set", path: "panes.0.meterLook", value: bad }]).ok, false, JSON.stringify(bad));
	});

	it("an older build keeps it: its rewrite after an edit of the window or of the readings keeps every pane's look (extrasOf)", () => {
		const older = JSON.parse(readFileSync(new URL("./golden/strip-older-build-meter-look.json", import.meta.url), "utf8")) as { window: { panes: Record<string, unknown>[]; screens: Record<string, unknown>[] }; series: { panes: Record<string, unknown>[] }; lookEditTaken: boolean };
		assert.deepEqual([...older.window.panes.map((p) => p.meterLook), older.window.screens[0]?.meterLook], ["liquid", "full", "flat"]);
		assert.deepEqual(older.series.panes.map((p) => p.meterLook), ["liquid", "full"]);
		assert.equal(older.lookEditTaken, false, "the older build refuses the Look edit, so a newer panel's change never half lands there");
		// "flat", the flat tank's name in a 1.8 preview, now reads as Thin bar
		// and stays in the stored screen as any unknown value does.
		const back = stripConfigOf(older.window);
		assert.deepEqual([back.panes[0].meterLook, back.panes[1].meterLook, back.screens?.[0]?.meterLook], ["liquid", "full", undefined]);
		assert.equal((stripConfigToJson(back).screens as unknown as Record<string, unknown>[] | undefined)?.[0]?.meterLook, "flat");
	});
});

describe("Meters' Look: Thin bar is today's Meters", () => {
	it("the Meters corpus (every look, both decks, whole and split, paused, states, the Screens frames) keeps every byte", () => {
		const meters = createHash("sha256");
		let n = 0;
		for (const background of DIAL_BACKGROUNDS) {
			for (const encoders of [4, 6] as const) {
				for (const layout of ["whole", "split"] as const) {
					for (const paused of [false, true]) {
						const c = fixtureCase({ styles: ["meters", "meters"], layout, encoders, background, accent: background === "tint", paused });
						for (const input of [c.input, withStates(c.input)]) {
							meters.update(hashOf(sliceStrip(input)));
							n++;
						}
					}
				}
			}
		}
		for (const c of screensMatrix()) {
			if (!c.id.includes("-meters-")) continue;
			meters.update(hashOf(sliceStrip(c.input)));
			n++;
		}
		assert.equal(n, 144);
		assert.equal(meters.digest("hex"), PINNED_METERS);
	});
});

/** Missing, stale and NaN readings among the rest, and a window with gaps
 * (test/strip-frame-scratch.test.ts withStates). */
function withStates(input: StripSceneInput): StripSceneInput {
	const gaps = (view: NonNullable<StripSeriesInput["history"]>): NonNullable<StripSeriesInput["history"]> => {
		const c = view.cols;
		const cols = { ...c, first: Float64Array.from(c.first), min: Float64Array.from(c.min), max: Float64Array.from(c.max), last: Float64Array.from(c.last) };
		for (let j = 1; j < cols.n; j += 7) (j % 2 === 0 ? cols.min : cols.last)[j] = Number.NaN;
		return { ...view, cols };
	};
	return {
		...input,
		panes: input.panes.map((p) => ({
			...p,
			series: p.series.map((s, i) => (i % 5 === 1 ? { key: s.key, name: s.name, unit: s.unit, state: "missing" as const } : i % 5 === 2 ? { ...s, state: "stale" as const } : i % 5 === 3 ? { ...s, current: Number.NaN } : i % 5 === 4 && s.history !== undefined ? { ...s, history: gaps(s.history) } : s))
		}))
	};
}

describe("Full bar and Liquid: the fill lands on the reading", () => {
	it("the bar's end and the liquid's level sit on the value, 0 to 100 for a percentage", () => {
		for (const look of FILL_LOOKS) {
			for (const encoders of [4, 6] as const) {
				for (const value of [0, 1, 12, 33.3, 50, 57, 90, 99, 100]) {
					const ps = prims(sceneOf({ layout: "split", encoders, look, panes: [{ readings: [{ r: CPU, now: value }] }, { readings: [{ r: RAM, now: value }] }] }));
					const frames = framesOf(ps);
					assert.equal(frames.length, 2, `${look} ${encoders}: a frame per half`);
					for (const frame of frames) {
						const inner = innerOf(frame);
						if (look === "full") {
							const reach = barReach(ps, frame);
							if (value === 0) assert.equal(reach, null, "nothing to fill at 0");
							else assert.deepEqual(reach, { x0: inner.x0, x1: Math.round(inner.x0 + (value / 100) * (inner.x1 - inner.x0)) }, `${encoders} ${value}`);
						} else {
							const line = surfaceOf(ps, frame);
							if (value === 0) {
								assert.equal(line, undefined, "no liquid at 0");
								continue;
							}
							const level = inner.y1 - (value / 100) * (inner.y1 - inner.y0);
							assert.ok(line !== undefined, `${look} ${value}`);
							const ys = line.pts.filter((_, k) => k % 2 === 1);
							// One straight line from wall to wall, at the level.
							assert.deepEqual(line.pts.filter((_, k) => k % 2 === 0), [inner.x0, inner.x1], `${look} ${encoders} ${value}: the surface is one line from wall to wall`);
							assert.ok(ys.every((y) => Math.abs(y - level) <= 0.06), `${look} ${encoders} ${value}: the surface at the level ${level}: ${ys.join(", ")}`);
						}
					}
				}
			}
		}
	});

	it("a percentage keeps 0 to 100 whatever Scale from and Scale to hold", () => {
		for (const look of FILL_LOOKS) {
			const ps = prims(sceneOf({ layout: "whole", look, panes: [{ readings: [{ r: CPU, now: 50 }], scale: { min: 0, max: 50 } }] }));
			const frame = framesOf(ps)[0] as Box;
			const inner = innerOf(frame);
			if (look === "full") assert.equal(barReach(ps, frame)?.x1, Math.round((inner.x0 + inner.x1) / 2), "a typed Scale to of 50 draws 50 % half full");
			else assert.ok(Math.abs(((surfaceOf(ps, frame) as LinePrim).pts[1] as number) - (inner.y0 + inner.y1) / 2) <= 0.06, `${look}: half full`);
		}
	});

	it("past 100 the fill is full and the number is the reading's own", () => {
		for (const look of FILL_LOOKS) {
			const ps = prims(sceneOf({ layout: "split", look, panes: [{ readings: [{ r: CPU, now: 120 }] }, { readings: [{ r: RAM, now: 64 }] }] }));
			const frame = framesOf(ps)[0] as Box;
			const inner = innerOf(frame);
			if (look === "full") assert.equal(barReach(ps, frame)?.x1, inner.x1);
			else assert.ok(((surfaceOf(ps, frame) as LinePrim).pts[1] as number) <= inner.y0 + 0.05);
			assert.ok(texts(ps).some((p) => p.text === "120.0" || p.text === "120"), `${look}: ${texts(ps).map((p) => p.text).join("|")}`);
		}
	});

	it("another unit takes Meters' scale and prints its ends", () => {
		for (const look of FILL_LOOKS) {
			const ps = prims(sceneOf({ layout: "whole", look, panes: [{ readings: [{ r: FAN, now: 1450 }] }] }));
			const words = texts(ps).map((p) => p.text);
			assert.ok(words.some((w) => /^0 to \d+$/.test(w)), `${look}: ${words.join("|")}`);
		}
	});
});

describe("Full bar and Liquid: no word on the fill", () => {
	// HWiNFO's own names, as long as a strip of them gets.
	const NAMES = ["Total CPU Usage", "Physical Memory Load", "GPU Core Load", "GPU Memory Usage", "Virtual Memory Load", "Core 5 Usage"];
	const many = (n: number, value: number, from = 0): One[] =>
		Array.from({ length: n }, (_, k) => ({
			r: { ...CPU, key: `f0:0:${from + k}`, name: NAMES[(from + k) % NAMES.length] as string },
			now: (value + (from + k) * 17) % 101,
			// Now and then a reading has no value: its word stands in the column.
			...(k === 1 && value % 7 === 3 ? { state: "stale" as const } : k === 0 && value % 7 === 5 ? { state: "missing" as const } : {})
		}));
	it("with every count of readings a pane holds, at every value from 0 to 100 on both decks, whole and split, live and paused, no letter meets a frame, the fill, its end, the liquid or its surface, or crosses a seam", () => {
		let checked = 0;
		for (const look of FILL_LOOKS) {
			for (const encoders of [4, 6] as const) {
				// A split half holds one reading per dial of its half, a whole
				// pane one per dial of the deck.
				const shapes = [...Array.from({ length: encoders / 2 }, (_, k) => ({ layout: "split" as const, n: k + 1 })), ...Array.from({ length: encoders }, (_, k) => ({ layout: "whole" as const, n: k + 1 }))];
				for (const { layout, n } of shapes) {
					const shape = `${layout}${n}`;
					for (let value = 0; value <= 100; value++) {
						const panes = layout === "split" ? [{ readings: many(n, value) }, { readings: many(n, 100 - value, n) }] : [{ readings: many(n, value) }];
						const ps = prims(sceneOf({ layout, encoders, look, panes, paused: value % 25 === 0, ...(value % 10 === 0 ? { panes: panes.map((p) => ({ ...p, crit: 90, warn: 70 })) } : {}) }));
						const frames = framesOf(ps);
						assert.ok(frames.length > 0, `${look} ${shape} ${encoders}`);
						const boxes = texts(ps).map((p) => ({ p, box: textInkBox(p) }));
						for (const { p, box } of boxes) for (const frame of frames) assert.ok(!meet(box, frame), `${look} ${shape} ${encoders} ${value}: "${p.text}" meets the frame at ${frame.x0} to ${frame.x1}`);
						for (const { p, box } of boxes) assert.equal(Math.floor(box.x0 / 200), Math.floor((box.x1 - 0.01) / 200), `${look} ${shape} ${encoders} ${value}: "${p.text}" (${box.x0.toFixed(1)} to ${box.x1.toFixed(1)}) crosses a seam`);
						for (const q of ps) {
							if (q.k !== "line" && q.k !== "area" && q.k !== "envelope") continue;
							const pts = q.k === "envelope" ? [...q.top, ...q.bottom] : q.pts;
							for (let k = 0; k + 1 < pts.length; k += 2) {
								const x = pts[k] as number;
								const y = pts[k + 1] as number;
								for (const { p, box } of boxes) assert.ok(!(x > box.x0 - 1 && x < box.x1 + 1 && y > box.y0 - 1 && y < box.y1 + 1), `${look} ${value}: the surface at ${x},${y} meets "${p.text}"`);
							}
						}
						checked++;
					}
				}
			}
		}
		// Stream Deck +: 2 split shapes and 4 whole; + XL: 3 and 6.
		assert.equal(checked, 2 * (6 + 9) * 101);
	});
});

describe("Full bar and Liquid: a reading's words sit against its own frame", () => {
	// A frame sits 10 px from its own column. Each of a reading's words (its
	// name; its value with the unit beside it, or the word standing for it;
	// the words at its column's foot) is nearer its own frame than any other
	// by WORD_MARGIN px or more, and its edge toward its own frame is the
	// column's (right-aligned left of the frame, left-aligned right of it).
	// Two frames of different readings keep FRAME_GAP px between them: twice
	// the gap between a frame and its own words, so a frame groups with its
	// words and never with the next frame.
	const WORD_MARGIN = 10;
	const FRAME_GAP = 20;
	// The frames of one pane differ in width by at most this (cells are
	// equal to a pixel, and a cell edge snaps to a seam within 2 px).
	const FRAME_SPREAD = 3;
	const NAMES = ["Total CPU Usage", "Physical Memory Load", "GPU Core Load", "GPU Memory Controller Load", "Virtual Memory Load", "Core 5 T0 Usage", "GPU Video Engine Load", "Max CPU/Thread Usage"];
	const many = (n: number, value: number, from = 0): One[] =>
		Array.from({ length: n }, (_, k) => ({
			r: { ...CPU, key: `f0:0:${from + k}`, name: NAMES[(from + k) % NAMES.length] as string },
			now: (value + (from + k) * 17) % 101,
			...(k === 1 && value % 7 === 3 ? { state: "stale" as const } : k === 0 && value % 7 === 5 ? { state: "missing" as const } : {})
		}));
	/** The horizontal gap between a word and a frame (frames run the strip's height). */
	const gapTo = (a: Box, frame: Box): number => (a.x1 <= frame.x0 ? frame.x0 - a.x1 : a.x0 >= frame.x1 ? a.x0 - frame.x1 : 0);
	it("1 to 8 readings a pane on a whole + XL, a whole +, and both halves of a split of each, every look, every value from 0 to 100", () => {
		let checked = 0;
		let least = Infinity;
		let leastFrames = Infinity;
		let widest = 0;
		for (const look of FILL_LOOKS) {
			for (const encoders of [4, 6] as const) {
				for (const layout of ["whole", "split"] as const) {
					const extents = paneExtents(layout, encoders);
					for (let n = 1; n <= 8; n++) {
						// The cells the readings take (stored setup only): a word
						// belongs to the reading whose cell holds it.
						const cells = extents.flatMap((ext) => spreadCells(ext, Math.min(n, meterCells(ext).length), "last"));
						for (let value = 0; value <= 100; value++) {
							const id = `${look} ${encoders === 6 ? "+XL" : "+"} ${layout}${n} ${value}`;
							const panes = layout === "split" ? [{ readings: many(n, value) }, { readings: many(n, 100 - value, n) }] : [{ readings: many(n, value) }];
							const ps = prims(sceneOf({ layout, encoders, look, paused: value % 25 === 0, panes: value % 10 === 0 ? panes.map((p) => ({ ...p, crit: 90, warn: 70 })) : panes }));
							const frames = framesOf(ps);
							for (let k = 1; k < frames.length; k++) {
								const gap = (frames[k] as Box).x0 - (frames[k - 1] as Box).x1;
								leastFrames = Math.min(leastFrames, gap);
								assert.ok(gap >= FRAME_GAP, `${id}: frames at ${(frames[k - 1] as Box).x1} and ${(frames[k] as Box).x0} keep ${gap} px`);
							}
							// A fill's length compares across a pane's readings: its frames are equally wide.
							for (const ext of extents) {
								const widths = frames.filter((fr) => fr.x0 >= ext.x0 && fr.x1 <= ext.x1).map((fr) => fr.x1 - fr.x0);
								widest = Math.max(widest, Math.max(...widths) - Math.min(...widths));
								assert.ok(Math.max(...widths) - Math.min(...widths) <= FRAME_SPREAD, `${id}: one pane's frames ${widths.join(", ")} px wide`);
							}
							// Each word, by its cell and its row (the unit joins its value).
							const rows = new Map<string, { cell: number; box: Box; text: string }>();
							for (const p of texts(ps)) {
								const box = textInkBox(p);
								const cell = cells.findIndex((c) => box.x0 >= c.x0 - 0.5 && box.x1 <= c.x1 + 0.5);
								assert.ok(cell >= 0, `${id}: "${p.text}" (${box.x0.toFixed(1)} to ${box.x1.toFixed(1)}) inside a cell`);
								const key = `${cell}/${p.y}`;
								const had = rows.get(key);
								rows.set(key, had === undefined ? { cell, box, text: p.text } : { cell, box: { x0: Math.min(had.box.x0, box.x0), x1: Math.max(had.box.x1, box.x1), y0: Math.min(had.box.y0, box.y0), y1: Math.max(had.box.y1, box.y1) }, text: `${had.text} ${p.text}` });
							}
							const edges = new Map<number, number[]>();
							for (const { cell, box, text } of rows.values()) {
								const c = cells[cell] as SpreadCell;
								const own = frames.filter((fr) => fr.x0 >= c.x0 && fr.x1 <= c.x1);
								assert.equal(own.length, 1, `${id}: one frame in the cell of "${text}"`);
								const frame = own[0] as Box;
								const near = gapTo(box, frame);
								const others = frames.filter((fr) => fr !== frame).map((fr) => gapTo(box, fr));
								if (others.length > 0) {
									const far = Math.min(...others);
									least = Math.min(least, far - near);
									assert.ok(far - near >= WORD_MARGIN, `${id}: "${text}" is ${near.toFixed(1)} px from its own frame and ${far.toFixed(1)} px from another`);
								}
								// The edge toward its own frame.
								const edge = frame.x0 >= box.x1 ? box.x1 : box.x0;
								edges.set(cell, [...(edges.get(cell) ?? []), edge]);
							}
							for (const [cell, list] of edges) assert.ok(Math.max(...list) - Math.min(...list) <= 1, `${id}: cell ${cell}'s words align toward their frame: ${list.map((x) => x.toFixed(1)).join(", ")}`);
							checked++;
						}
					}
				}
			}
		}
		assert.equal(checked, 2 * 2 * 2 * 8 * 101);
		assert.ok(least >= WORD_MARGIN && leastFrames >= FRAME_GAP && widest <= FRAME_SPREAD, `least word margin ${least}, least frame gap ${leastFrames}, widest spread of a pane's frames ${widest}`);
	});

	it("the CPU and RAM usage pair draws its two frames alike, each half on its own, on both decks and every look", () => {
		for (const look of FILL_LOOKS) {
			for (const encoders of [4, 6] as const) {
				for (const [cpu, ram] of [[12, 46], [100, 100], [0, 57]] as const) {
					const ps = prims(sceneOf({ layout: "split", encoders, look, panes: [{ readings: [{ r: CPU, now: cpu, name: "CPU usage" }] }, { readings: [{ r: RAM, now: ram, name: "RAM usage" }] }] }));
					const widths = framesOf(ps).map((fr) => fr.x1 - fr.x0);
					assert.equal(widths.length, 2);
					assert.equal(widths[0], widths[1], `${look} ${encoders} ${cpu} ${ram}: ${widths.join(", ")}`);
				}
			}
		}
	});
});

describe("Full bar and Liquid: limits", () => {
	it("past crit the value is the crit color exactly, on every look of Ember and Paper, and a 6 px bar runs along the foot; past warn 3 px", () => {
		for (const theme of ["ember", "paper"]) {
			for (const background of LOOKS) {
				for (const look of FILL_LOOKS) {
					const input = sceneOf({ layout: "split", look, theme, background, panes: [{ readings: [{ r: CPU, now: 96 }], crit: 90, warn: 70 }, { readings: [{ r: RAM, now: 80 }], crit: 90, warn: 70 }] });
					const ps = prims(input);
					const value = (text: string): TextPrim | undefined => texts(ps).find((p) => p.text === text && p.weight === 700);
					assert.equal(value("96.0")?.fill, input.alertColors.crit, `${theme} ${background} ${look}: crit stays the crit color`);
					assert.equal(value("80.0")?.fill, input.alertColors.warn, `${theme} ${background} ${look}: warn stays the warn color`);
					const foot = (color: string): number[] =>
						ps.flatMap((p) => {
							if (p.k !== "cells" || p.paint !== `fill="${color}"`) return [];
							const hs: number[] = [];
							for (let i = 0; i < p.rects.length; i += 4) if ((p.rects[i + 1] as number) + (p.rects[i + 3] as number) === 97 && (p.rects[i + 2] as number) > 100) hs.push(p.rects[i + 3] as number);
							return hs;
						});
					assert.deepEqual(foot(input.alertColors.crit), [6], `${theme} ${background} ${look}: crit's foot bar`);
					assert.deepEqual(foot(input.alertColors.warn), [3], `${theme} ${background} ${look}: warn's foot bar`);
				}
			}
		}
	});

	it("under a limit nothing is alert-colored but the limit's own mark", () => {
		for (const look of FILL_LOOKS) {
			const input = sceneOf({ layout: "split", look, panes: [{ readings: [{ r: CPU, now: 12 }], crit: 90 }, { readings: [{ r: RAM, now: 46 }], crit: 90 }] });
			const ps = prims(input);
			assert.ok(!texts(ps).some((p) => p.fill === input.alertColors.crit), look);
			assert.ok(!ps.some((p) => p.k === "cells" && p.paint === `fill="${input.alertColors.crit}"` && p.rects.some((_, i) => i % 4 === 2 && (p.rects[i] as number) > 20)), `${look}: no foot bar or frame in the alert color under the limit`);
		}
	});
});

describe("Full bar and Liquid: contrast", () => {
	it("the fill reads as a bar: 3:1 or more against the empty frame, and past a limit at least as strong", () => {
		const themes = loadThemes();
		for (const theme of ["ember", "paper", "graphite", "void", "midnight", "forest", "ultraviolet"]) {
			const palette = resolvePalette(themes, theme, null, "normal");
			for (const background of [...LOOKS, "nebula"] as DialBackground[]) {
				const config = stripConfigOf({ layout: "split", background, theme });
				const look = lookOf(config, palette, { mode: "theme", color: undefined, dimSecondary: false });
				const alerts = stripAlertColors(themes.alertValues, palette, config.background);
				const k = fillStrengths(look.surface, palette.accent, alerts);
				const body = contrastRatio(mixToward(look.surface, palette.accent, k.body), look.surface);
				assert.ok(body >= 3, `${theme} ${background}: the bar ${body.toFixed(2)}:1`);
				for (const level of ["warn", "crit"] as const) {
					const piece = contrastRatio(mixToward(look.surface, alerts[level], k[level]), look.surface);
					assert.ok(piece >= body - 0.01, `${theme} ${background} ${level}: ${piece.toFixed(2)} against the bar's ${body.toFixed(2)}`);
					if (luminance(look.surface) < 0.4) assert.ok(luminance(mixToward(look.surface, alerts[level], k[level])) >= luminance(mixToward(look.surface, palette.accent, k.body)) - 0.002, `${theme} ${background} ${level}: brighter past the limit`);
				}
			}
		}
	});

	it("every word keeps 4.5:1 on what is behind it (the panel, never the fill), alert colors included", () => {
		for (const theme of ["ember", "paper"]) {
			for (const background of LOOKS) {
				for (const look of FILL_LOOKS) {
					const input = sceneOf({ layout: "split", look, theme, background, paused: true, panes: [{ readings: [{ r: CPU, now: 96 }], crit: 90 }, { readings: [{ r: RAM, now: 57 }] }] });
					const surface = lookOf(input.config, input.palette, input.text).surface;
					for (const p of texts(prims(input))) assert.ok(contrastRatio(p.fill, surface) >= 4.5, `${theme} ${background} ${look}: "${p.text}" ${p.fill} on ${surface} ${contrastRatio(p.fill, surface).toFixed(2)}`);
				}
			}
		}
	});
});

describe("Liquid: the surface is the level, so it moves only with a new value", () => {
	const liquidPrims = (ps: readonly Prim[]): string => JSON.stringify(ps.filter((p) => p.k === "area" || p.k === "line" || p.k === "envelope"));
	it("the same value later in time draws the same frame, byte for byte", () => {
		for (const look of ["liquid"] as const) {
			for (const time of [false, true]) {
				const at = (nowMs: number): StripSlices => sliceStrip(sceneOf({ layout: "split", look, time, nowMs, panes: [{ readings: [{ r: CPU, now: 13 }] }, { readings: [{ r: RAM, now: 46 }] }] }));
				const a = at(1_000_000);
				const b = at(1_002_000);
				assert.deepEqual(b.slices, a.slices, `${look} time ${time}`);
			}
		}
	});

	it("a new value moves the level and nothing else: the surface stays one straight line", () => {
		const surface = (now: number): number[] => {
			const ps = prims(sceneOf({ layout: "whole", look: "liquid", panes: [{ readings: [{ r: CPU, now }] }] }));
			const frame = framesOf(ps)[0] as Box;
			const line = surfaceOf(ps, frame) as LinePrim;
			const level = 97 - (now / 100) * 94;
			return line.pts.filter((_, k) => k % 2 === 1).map((y) => Math.round((y - level) * 10) / 10);
		};
		for (const now of [3, 40, 44, 97]) {
			const off = surface(now);
			assert.ok(off.length === 2 && off.every((d) => d === 0), `${now} %: one line at the level, off by ${off.join(", ")}`);
		}
	});

	it("paused stands still, and stale and missing draw no liquid", () => {
		for (const look of ["liquid", "full"] as const) {
			const paused = (nowMs: number): string => liquidPrims(prims(sceneOf({ layout: "split", look, paused: true, nowMs, panes: [{ readings: [{ r: CPU, now: 13 }] }, { readings: [{ r: RAM, now: 46 }] }] })));
			assert.equal(paused(1_000_000), paused(1_002_000), look);
			for (const state of ["stale", "missing"] as const) {
				const ps = prims(sceneOf({ layout: "split", look, panes: [{ readings: [{ r: CPU, now: 57, state }] }, { readings: [{ r: RAM, now: 46 }] }] }));
				const frame = framesOf(ps)[0] as Box;
				assert.equal(liquidOf(ps, frame).length, 0, `${look} ${state}: no liquid`);
				assert.equal(look === "full" ? barReach(ps, frame) : surfaceOf(ps, frame) ?? null, null, `${look} ${state}: no fill`);
				assert.ok(texts(ps).some((p) => p.text === state || p.text === "not found" || /stale|missing|not found|no data/.test(p.text)), `${look} ${state}: says so: ${texts(ps).map((p) => p.text).join("|")}`);
			}
		}
	});
});

describe("Full bar and Liquid: within the payload", () => {
	it("every slice stays within the bound on every look, both decks, with limits past crit", () => {
		for (const look of FILL_LOOKS) {
			for (const background of [...DIAL_BACKGROUNDS] as DialBackground[]) {
				for (const encoders of [4, 6] as const) {
					for (const shape of ["split", "whole6"] as const) {
						const input = sceneOf({ layout: shape === "split" ? "split" : "whole", encoders, look, background, panes: shape === "split" ? [{ readings: [{ r: CPU, now: 96 }], crit: 90, warn: 70 }, { readings: [{ r: RAM, now: 57 }], crit: 90 }] : [{ readings: Array.from({ length: encoders }, (_, k) => ({ r: { ...CPU, key: `f0:0:${k}`, name: `Core ${k} Usage` }, now: 50 + k * 9 })), crit: 90, warn: 70 }] });
						const r = sliceStrip(input);
						assert.equal(r.coarsened, false, `${look} ${background} ${encoders} ${shape}`);
						assert.ok(r.maxBytes <= 8192, `${look} ${background} ${encoders} ${shape}: ${r.maxBytes}`);
					}
				}
			}
		}
	});

	it("draws no mask, clip, pattern, new filter, animation, letter-spacing or fill-opacity on Theme", () => {
		for (const look of FILL_LOOKS) {
			for (const background of [...DIAL_BACKGROUNDS] as DialBackground[]) {
				const svg = sliceStrip(sceneOf({ layout: "split", look, background, panes: [{ readings: [{ r: CPU, now: 96 }], crit: 90 }, { readings: [{ r: RAM, now: 57 }] }] })).slices.join("");
				assert.doesNotMatch(svg, /<mask|<clipPath|<pattern|<animate|<set |letter-spacing/, `${look} ${background}`);
				if (background === "theme") assert.doesNotMatch(svg, /fill-opacity/, `${look} on Theme`);
			}
		}
	});
});

describe("the strip page says what Full bar and Liquid draw", () => {
	const page = readFileSync(new URL("../docs/strip-display.md", import.meta.url), "utf8");
	const lineOf = (start: string): string => page.split("\n").find((l) => l.startsWith(start)) ?? "";
	const OWN = "#3FA7FF";
	// Dark, light and see-through looks, with the accent and with a reading's own color.
	const CASES = [
		["ember", "theme"],
		["paper", "theme"],
		["graphite", "theme"],
		["ember", "glass"],
		["paper", "glass"],
		["ember", "clear"],
		["paper", "clear"],
		["ember", "stars"]
	] as const;
	const one = (look: string, theme: string, background: DialBackground, color?: string): StripSceneInput => sceneOf({ layout: "whole", look, theme, background, panes: [{ readings: [{ r: CPU, now: 57, ...(color === undefined ? {} : { color }) }] }] });

	it("Full bar ends in a 2 px edge in the reading's full color", () => {
		const line = lineOf("- **Full bar**:");
		assert.match(line, /ended by a 2 px edge in the reading's full color\./);
		assert.doesNotMatch(line, /bright/, "on Paper the edge is the darkest paint in the frame");
		for (const [theme, background] of CASES) {
			for (const own of [undefined, OWN]) {
				const input = one("full", theme, background, own);
				const color = own ?? input.palette.accent;
				const ps = prims(input);
				const frame = framesOf(ps)[0] as Box;
				const end = barReach(ps, frame)?.x1 as number;
				const marks = ps.flatMap((p) => (p.k === "cells" && p.layer === "marks" ? Array.from({ length: p.rects.length / 4 }, (_, i) => ({ paint: p.paint, x: p.rects[i * 4] as number, w: p.rects[i * 4 + 2] as number, h: p.rects[i * 4 + 3] as number })) : []));
				const edge = marks.find((r) => r.w === 2 && r.h === 94 && r.x + r.w === end);
				assert.equal(edge?.paint, `fill="${color}"`, `${theme} ${background} ${own ?? "accent"}: the edge at ${end}`);
			}
		}
	});

	it("Liquid fills to a straight surface at the level, strongest in color under it and fainter toward the bottom, on dark and light looks alike", () => {
		const line = lineOf("- **Liquid**:");
		assert.match(line, /fills from its bottom to a straight surface at the level, its color strongest under the surface and fainter toward the bottom\./);
		assert.doesNotMatch(page, /\bwaves?\b|Liquid, flat|the liquids/, "no wave and no second Liquid on the page");
		assert.doesNotMatch(line, /lighter under the surface/, "on Paper the liquid is darker under its surface");
		let darkerOnTop = 0;
		for (const [theme, background] of CASES) {
			for (const own of [undefined, OWN]) {
				const input = one("liquid", theme, background, own);
				const surface = lookOf(input.config, input.palette, input.text).surface;
				const svg = sliceStrip(input).slices.join("");
				const grad = /<linearGradient id="ml[^"]*" gradientUnits="userSpaceOnUse" x2="0" y1="([\d.]+)" y2="([\d.]+)">(.*?)<\/linearGradient>/.exec(svg);
				assert.ok(grad !== null, `${theme} ${background}: the liquid's gradient`);
				const [, y1, y2, stops] = grad as unknown as [string, string, string, string];
				assert.ok(Number(y1) < Number(y2), "its first stop is at the surface, its last deeper");
				const [top, deep] = [...stops.matchAll(/stop-color="(#[0-9A-F]{6})"(?: stop-opacity="([\d.]+)")?/g)].map((m) => ({ color: m[1] as string, opacity: m[2] === undefined ? 1 : Number(m[2]) }));
				assert.ok(top !== undefined && deep !== undefined, `${theme} ${background}: two stops`);
				if (top.opacity === 1 && deep.opacity === 1) {
					assert.ok(contrastRatio(top.color, surface) > contrastRatio(deep.color, surface), `${theme} ${background} ${own ?? "accent"}: ${top.color} under the surface, ${deep.color} deep, on ${surface}`);
					if (luminance(top.color) < luminance(deep.color)) darkerOnTop++;
				} else {
					assert.equal(top.color, deep.color);
					assert.ok(top.opacity > deep.opacity, `${theme} ${background} ${own ?? "accent"}: ${top.opacity} under the surface, ${deep.opacity} deep`);
				}
			}
		}
		assert.ok(darkerOnTop > 0, "a light look's liquid is darker under its surface, not lighter");
	});

	it("the fill and the value take the accent or the reading's own color, the number on Clear the value color as the name and unit do; the name keeps the label color", () => {
		const words = lineOf("With **Full bar** and **Liquid**");
		assert.doesNotMatch(words, /They draw in/, "the name does not take the reading's color");
		assert.match(words, /The fill and the value take the theme's accent color, or a reading's own color; where that color falls short of 4\.5:1 the value takes a shade of it that does\. On \*\*Clear\*\* the number takes the theme's value color, as the name and the unit do\./);
		for (const [theme, background] of CASES) {
			for (const own of [undefined, OWN]) {
				for (const look of FILL_LOOKS) {
					const input = one(look, theme, background, own);
					const color = own ?? input.palette.accent;
					const t = lookOf(input.config, input.palette, input.text);
					const ps = prims(input);
					const id = `${theme} ${background} ${look} ${own ?? "accent"}`;
					const value = texts(ps).find((p) => p.text === "57.0");
					const name = texts(ps).find((p) => p.text.startsWith("Total"));
					assert.equal(value?.fill, background === "clear" ? t.text.value : readableValueColor(color, t.surface), `${id}: the value`);
					assert.equal(name?.fill, t.text.label, `${id}: the name`);
					if (background !== "clear" && own !== undefined) assert.notEqual(name?.fill, own, `${id}: the name is not the reading's color`);
					if (background === "clear") for (const word of [name, texts(ps).find((p) => p.text === "%")]) assert.equal(word?.fill, value?.fill, `${id}: on Clear "${word?.text}" takes the value color too`);
					if (look === "full" && background === "theme") {
						const k = fillStrengths(t.surface, color, input.alertColors);
						assert.ok(ps.some((p) => p.k === "cells" && p.layer === "base" && p.paint === `fill="${mixToward(input.palette.bg, color, k.body)}"`), `${id}: the fill`);
					}
				}
			}
		}
	});
});
