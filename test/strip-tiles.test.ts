/**
 * The Group style's Tiles view (src/strip/tiles.ts): one small history graph
 * per reading, Task Manager's logical processors with the strip's look. A
 * stored view Auto never picks; a column per physical core laid out from the
 * readings' labels alone (T0 over T1, P-cores apart from E-cores, a gap
 * every 8 cores from 12), across the whole pane with no readout slot; one
 * 0 to 100 scale and one color ramp by height for every tile; labels in
 * fixed slots that never straddle a seam and never move with a value; the
 * highlight as a border and a tab, never a recolored line; one cursor at
 * one moment across every tile; no limit line, a tile past a limit takes a
 * bar and a 1 px outline in the alert color; a missing reading as an empty
 * dashed tile; the gestures; and every slice within the payload bound, the
 * owner's deck at 1 min on the default buckets.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { busyCpu, threadLabels, tilesFixture, tilesKeyOf, tilesSamples, type TilesFixtureParams } from "../scripts/lib/tiles-fixtures";
import { diffRasters, renderCase } from "../scripts/lib/strip-fixtures";
import { deriveCapabilities } from "../src/devices";
import { IDLE_GESTURE } from "../src/gestures";
import { HistoryStore } from "../src/history/store";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { StripController, type StripDialHandle, type StripHost } from "../src/strip/controller";
import { paneExtents, SLICE_W, type StripEncoders, type StripLayout } from "../src/strip/geometry";
import { GROUP_TURN_PICKS_READING, groupDrawOf } from "../src/strip/group";
import { routeStripInput, stripTriggerDescriptions, type StripRouting } from "../src/strip/input";
import { emitPrim, type CellsPrim, type Prim, type SkeinPrim, type Word, type WordsPrim } from "../src/strip/prims";
import { nameRungs } from "../src/strip/readout";
import { buildStripScene, type LogicalScene, type StripSceneInput } from "../src/strip/scene";
import { MIN_FRAME_MS, type SchedulerClock } from "../src/strip/scheduler";
import { GROUP_VIEWS, stripPaneOf, stripPaneToJson } from "../src/strip/settings";
import { cullPrim, SLICE_PAYLOAD_LIMIT, SLICE_RETURN_SHARE, sliceStrip, svgBytes, type StripSlices } from "../src/strip/slicer";
import { straight, threadOf, TILE_RAMP, TILES, tileShapeOf, tilesOf, type Tile } from "../src/strip/tiles";
import { hexToLab } from "../src/ui/color-difference";
import { INK_CLEAR_GAP, inkEdges, inkSpan, type DecimalsSetting } from "../src/ui/format";
import { ART_PIECE_LIMIT } from "../src/ui/deck-art";
import { setFaceFont } from "../src/ui/face-font";
import { formatMeasurement } from "../src/ui/measure";

setFaceFont("tahoma");

// ---- helpers ------------------------------------------------------------------

const CORES16 = threadLabels(16);
const busy = (seconds = 60): TilesFixtureParams["samples"] => tilesSamples(32, (i, t) => busyCpu(i, t), seconds);

function tilesOfInput(input: StripSceneInput, pane: 0 | 1 = 0): Tile[] {
	const extent = paneExtents(input.config.layout, input.encoders)[pane];
	assert.ok(extent !== undefined);
	return tilesOf(tileShapeOf((input.panes[pane]?.series ?? []).map((s) => s.name)), extent);
}

const cellsOf = (scene: LogicalScene): CellsPrim[] => scene.prims.filter((p): p is CellsPrim => p.k === "cells");
const wordsOf = (scene: LogicalScene, weight?: 600 | 700): Word[] => scene.prims.filter((p): p is WordsPrim => p.k === "words" && (weight === undefined || p.weight === weight)).flatMap((p) => p.words);
const skeinsOf = (scene: LogicalScene): SkeinPrim[] => scene.prims.filter((p): p is SkeinPrim => p.k === "skein");
const framesOf = (scene: LogicalScene): CellsPrim[] => cellsOf(scene).filter((p) => p.round !== undefined && !p.paint.includes("dasharray") && !p.paint.includes('fill="none"'));
const rectsOf = (p: { readonly rects: readonly number[] }): number[][] => {
	const out: number[][] = [];
	for (let i = 0; i + 3 < p.rects.length; i += 4) out.push(p.rects.slice(i, i + 4) as number[]);
	return out;
};
/** The color of a `stroke="..."` or `fill="..."` attribute. */
const attrOf = (paint: string, name: string): string | undefined => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(paint)?.[1];
/** The bars along tiles' bottoms in one alert color. (Their path also holds
 * any right edge painted again, 1 px wide, where the line's glow reaches it.) */
const barsOf = (scene: LogicalScene, color: string): number[][] =>
	cellsOf(scene)
		.filter((p) => p.layer === "marks" && attrOf(p.paint, "fill") === color)
		.flatMap(rectsOf)
		.filter((r) => (r[2] as number) > 1);
/** The outlines in one alert color: rounded boxes stroked in it. */
const outlinesOf = (scene: LogicalScene, color: string): CellsPrim[] => cellsOf(scene).filter((p) => p.round !== undefined && attrOf(p.paint, "stroke") === color);
const inTile = (t: Tile, x: number, y: number): boolean => x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1;
const seamsIn = (x0: number, x1: number): number[] => {
	const out: number[] = [];
	for (let s = (Math.floor(x0 / SLICE_W) + 1) * SLICE_W; s < x1; s += SLICE_W) out.push(s);
	return out;
};
/** Every text a tile prints for a reading in `unit` on the scale lo to hi
 * (Auto decimals, a percentage in whole numbers), by brute force: 4000
 * steps across it, the values just under each power of ten (9.997 prints
 * 10.00, 99.97 prints 100.0, 9999.6 prints 10000) and every run of one
 * digit at each size and place (4444, 44.4, 44.4k). */
const printedOn = (unit: string, lo: number, hi: number): string[] => {
	const decimals: DecimalsSetting = unit === "%" ? "0" : "auto";
	const values = new Set<number>([lo, hi]);
	for (let i = 0; i <= 4000; i++) values.add(lo + ((hi - lo) * i) / 4000);
	for (let p = 10; p <= 1e9; p *= 10) for (const k of [0.9996, 0.99996, 0.999996, 0.9999996]) values.add(p * k);
	for (let digits = 1; digits <= 7; digits++) for (let d = 1; d <= 9; d++) for (let e = -3; e <= 4; e++) values.add((d * (10 ** digits - 1)) / 9 * 10 ** e);
	const texts = new Set<string>();
	for (const v of values) if (v >= lo && v <= hi) texts.add(formatMeasurement(v, unit, { decimals, fahrenheit: false, dataUnits: "decimal" }).valueText);
	return [...texts];
};

// ---- settings ------------------------------------------------------------------

describe("Tiles: a stored Group view Auto never picks", () => {
	it("a Group pane stores view tiles and writes it back", () => {
		assert.ok((GROUP_VIEWS as readonly string[]).includes("tiles"));
		const pane = stripPaneOf({ style: "group", series: [], group: { from: "filter", filter: "*core*t?*usage*", keys: [], view: "tiles" } });
		assert.equal(pane.group?.view, "tiles");
		assert.equal((stripPaneOf(stripPaneToJson(pane)) as typeof pane).group?.view, "tiles");
	});

	it("Auto keeps its count rule for every count, so a stored setup keeps its look; Tiles draws tiles at any count", () => {
		for (let n = 0; n <= 64; n++) {
			assert.notEqual(groupDrawOf("auto", n), "tiles", `auto at ${n}`);
			assert.equal(groupDrawOf("tiles", n), "tiles");
		}
	});
});

// ---- layout from the labels ------------------------------------------------------

describe("Tiles: the layout comes from the readings' labels and count alone", () => {
	it("per-thread labels parse, HWiNFO's P-core and E-core forms too; totals, clocks per perf and temperatures do not", () => {
		assert.deepEqual(threadOf("Core 3 T1 Usage"), { kind: "core", core: 3, thread: 1 });
		assert.deepEqual(threadOf("Core 12 T0 Effective Clock"), { kind: "core", core: 12, thread: 0 });
		assert.deepEqual(threadOf("P-core 0 T1 Usage"), { kind: "p", core: 0, thread: 1 });
		assert.deepEqual(threadOf("E-core 8 T0 Usage"), { kind: "e", core: 8, thread: 0 });
		for (const label of ["Total CPU Usage", "Max CPU/Thread Usage", "Core 3 Clock (perf #2)", "Core 0 Temperature", "CPU Core Usage", "Core Max"]) assert.equal(threadOf(label), undefined, label);
	});

	it("a column per physical core in core order, its threads stacked T0 over T1, whatever order the Group lists them in", () => {
		const shape = tileShapeOf(CORES16);
		assert.equal(shape.columns.length, 16);
		shape.columns.forEach((slots, c) => assert.deepEqual(slots, [2 * c, 2 * c + 1]));
		assert.deepEqual(shape.cores, Array.from({ length: 16 }, (_, c) => c));
		// The same readings listed T1 first and cores backwards.
		const shuffled = [...CORES16].reverse();
		const again = tileShapeOf(shuffled);
		again.columns.forEach((slots, c) => assert.deepEqual(slots.map((i) => shuffled[i]), [`Core ${c} T0 Usage`, `Core ${c} T1 Usage`]));
	});

	it("blocks: a gap every 8 cores from 12 cores, none below; P-cores apart from E-cores; never from another sensor", () => {
		assert.deepEqual(tileShapeOf(threadLabels(16)).grid, [8, 8]);
		assert.deepEqual(tileShapeOf(threadLabels(12)).grid, [8, 4]);
		assert.deepEqual(tileShapeOf(threadLabels(24)).grid, [8, 8, 8]);
		assert.deepEqual(tileShapeOf(threadLabels(8)).grid, [8]);
		assert.deepEqual(tileShapeOf(threadLabels(11)).grid, [11]);
		const hybrid = [...threadLabels(6, 2, "P-core"), ...Array.from({ length: 8 }, (_, i) => `E-core ${6 + i} T0 Usage`)];
		const shape = tileShapeOf(hybrid);
		assert.deepEqual(shape.grid, [6, 8]);
		assert.deepEqual(shape.columns.map((c) => c.length), [2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1], "a one-thread core takes one tile");
		// A CCD temperature in the list is a reading of its own, not a block.
		const withTemps = [...threadLabels(8), "CPU CCD1 (Tdie)", "CPU CCD2 (Tdie)"];
		assert.deepEqual(tileShapeOf(withTemps).columns.slice(0, 8).map((c) => c.length), new Array(8).fill(2));
	});

	it("readings that do not parse take one tile each, as an even grid", () => {
		const clocks = Array.from({ length: 16 }, (_, i) => `Core ${i} Clock (perf #${i})`);
		const shape = tileShapeOf(clocks);
		assert.deepEqual(shape.grid, [8]);
		assert.deepEqual(shape.columns.map((c) => c.length), new Array(8).fill(2));
		assert.deepEqual(shape.columns.flat().sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i));
		assert.deepEqual(tileShapeOf(clocks.slice(0, 6)).columns.map((c) => c.length), new Array(6).fill(1), "up to 8 readings: one row");
	});
});

// ---- geometry --------------------------------------------------------------------

describe("Tiles: the columns divide the whole pane, the tiles take its full height", () => {
	const columnsOf = (labels: readonly string[], layout: StripLayout, encoders: StripEncoders, pane = 0): { x0: number; x1: number }[] => {
		const extent = paneExtents(layout, encoders)[pane];
		assert.ok(extent !== undefined);
		const tiles = tilesOf(tileShapeOf(labels), extent);
		const out = new Map<number, { x0: number; x1: number }>();
		for (const t of tiles) out.set(t.column, { x0: t.x0, x1: t.x1 });
		return [...out.values()];
	};

	it("16 cores fill the + XL's 1200 px; 8 cores stretch to about 145 px; a 600 px half shrinks them; the + whole fits 16", () => {
		const xl = columnsOf(CORES16, "whole", 6);
		assert.equal(xl[0]?.x0, TILES.pad);
		assert.equal(xl[15]?.x1, 1200 - TILES.pad);
		for (const c of xl) assert.ok(c.x1 - c.x0 >= 69 && c.x1 - c.x0 <= 71, `${c.x1 - c.x0}`);
		assert.equal((xl[8]?.x0 ?? 0) - (xl[7]?.x1 ?? 0), TILES.blockGap, "the gap between blocks of 8");
		for (const c of columnsOf(threadLabels(8), "whole", 6)) assert.ok(c.x1 - c.x0 >= 140, `${c.x1 - c.x0}`);
		const half = columnsOf(CORES16, "split", 6, 0);
		const extent = paneExtents("split", 6)[0] as { x0: number; x1: number };
		assert.equal(half[15]?.x1, extent.x1 - TILES.pad);
		for (const c of half) assert.ok(c.x1 - c.x0 >= 31 && c.x1 - c.x0 <= 34, `${c.x1 - c.x0}`);
		const plus = columnsOf(CORES16, "whole", 4);
		assert.equal(plus[15]?.x1, 800 - TILES.pad);
		for (const c of plus) assert.ok(c.x1 - c.x0 >= 44 && c.x1 - c.x0 <= 46, `${c.x1 - c.x0}`);
	});

	it("no readout slot: with Current value on, the tiles start at the pane's edge and no large value draws", () => {
		const input = tilesFixture({ labels: CORES16, samples: busy(), encoders: 6 }).input;
		assert.equal(input.config.panes[0].overlays.current, true);
		const scene = buildStripScene(input);
		const frames = framesOf(scene).flatMap(rectsOf);
		assert.equal(frames.length, 32, "a frame per tile");
		assert.equal(Math.min(...frames.map((r) => r[0] as number)), TILES.pad + 0.5);
		assert.ok(!scene.prims.some((p) => p.k === "text" && p.size > 16), "no readout value");
	});

	it("two-thread tiles split the height, a one-thread core takes it all, with no row kept for words", () => {
		const hybrid = [...threadLabels(6, 2, "P-core"), ...Array.from({ length: 8 }, (_, i) => `E-core ${6 + i} T0 Usage`)];
		const tiles = tilesOf(tileShapeOf(hybrid), { x0: 0, x1: 1200 });
		for (const t of tiles) {
			if (t.slots === 1) assert.deepEqual([t.y0, t.y1], [TILES.top, TILES.bottom]);
			else assert.deepEqual([t.y0, t.y1], t.slot === 0 ? [TILES.top, 49] : [51, TILES.bottom]);
		}
		assert.ok(TILES.top <= 4 && TILES.bottom >= 96);
	});
});

// ---- the scene -------------------------------------------------------------------

describe("Tiles: each tile a history graph that fills up on one scale and one ramp", () => {
	it("every live tile draws its line and its fill on one gradient fixed to the tile heights, the ramp's stops in order", () => {
		const scene = buildStripScene(tilesFixture({ labels: CORES16, samples: busy(), encoders: 6 }).input);
		const skeins = skeinsOf(scene);
		assert.equal(skeins.length, 1, "one line path for every two-thread tile");
		const grad = attrOf((skeins[0] as SkeinPrim).attrs, "stroke");
		assert.match(grad ?? "", /^url\(#tg\w+\)$/);
		const id = (grad as string).slice(5, -1);
		const def = scene.localPaints?.find((p) => p.id === id)?.def ?? "";
		assert.match(def, /gradientUnits="userSpaceOnUse"/);
		const stops = [...def.matchAll(/stop-color="(#[0-9A-F]{6})"/g)].map((m) => m[1]);
		assert.deepEqual(stops, [...TILE_RAMP, ...TILE_RAMP].map((s) => s.color), "the ramp once per stacked tile, cool at the floor");
		const fills = scene.prims.filter((p) => p.k === "areas");
		assert.equal(fills.length, 1);
		assert.match((fills[0] as { paint: string }).paint, new RegExp(`fill="url\\(#${id}\\)" fill-opacity="\\.\\d+"`), "a see-through fill on the same ramp");
		assert.equal((skeins[0] as SkeinPrim).lines.length, 32);
	});

	it("a percentage is 0 to 100 on every tile: an idle machine's lines lie near the floor, the mid line at half height", () => {
		const scene = buildStripScene(tilesFixture({ labels: CORES16, samples: tilesSamples(32, () => 10), encoders: 6 }).input);
		const tiles = tilesOfInput(tilesFixture({ labels: CORES16, samples: tilesSamples(32, () => 10), encoders: 6 }).input);
		const line = skeinsOf(scene)[0] as SkeinPrim;
		for (const pts of line.lines) {
			const t = tiles.find((k) => inTile(k, pts[pts.length - 2] as number, pts[pts.length - 1] as number)) as Tile;
			const top = t.y0 + 2;
			const bottom = t.y1 - 1;
			for (let i = 1; i < pts.length; i += 2) assert.ok(Math.abs((pts[i] as number) - (bottom - 0.1 * (bottom - top))) <= 1, `y ${pts[i]} in ${t.y0}..${t.y1}`);
		}
		const mids = cellsOf(scene).find((p) => attrOf(p.paint, "stroke-opacity") === ".1" && p.hair === true);
		assert.ok(mids !== undefined, "one 1 px line per tile");
		for (const [, , , h] of rectsOf(mids)) assert.equal(h, 1);
		for (const [x, y] of rectsOf(mids)) {
			const t = tiles.find((k) => inTile(k, (x as number) + 1, y as number)) as Tile;
			assert.ok(Math.abs((y as number) - (t.y0 + 2 + t.y1 - 1) / 2) <= 1);
		}
	});

	it("nothing moves with the values: frames, mid lines and every word's place are the same for other values", () => {
		const a = buildStripScene(tilesFixture({ labels: CORES16, samples: busy(), encoders: 6 }).input);
		const b = buildStripScene(tilesFixture({ labels: CORES16, samples: tilesSamples(32, (i, t) => ((i * 37 + t / 700) % 101) | 0), encoders: 6 }).input);
		const fixed = (s: LogicalScene) => ({ cells: cellsOf(s).filter((p) => p.layer === "base").map((p) => [p.paint, p.rects]), words: wordsOf(s).map((w) => [w.x, w.y, w.anchor, w.size]) });
		assert.deepEqual(fixed(a), fixed(b));
		assert.equal(wordsOf(a, 700).length, 0, "at home no value");
		assert.deepEqual(wordsOf(a, 600).map((w) => w.text), Array.from({ length: 32 }, (_, i) => String(i >> 1)), "a core number on every tile");
		const inspected = (samples: TilesFixtureParams["samples"]): LogicalScene => buildStripScene(tilesFixture({ labels: CORES16, samples, encoders: 6, pausedAgoMs: 20_000 }).input);
		const c = inspected(busy());
		assert.deepEqual(fixed(c), fixed(inspected(tilesSamples(32, (i, t) => ((i * 37 + t / 700) % 101) | 0))));
		assert.equal(wordsOf(c, 700).length, 32, "inspected, a value on every tile");
	});

	it("labels never straddle a seam, stay in their own tile, and step down with the tile size: inspected a number and a value, then the value alone, then the number; at home a number on every tile", () => {
		const cases: { id: string; encoders: StripEncoders; layout: StripLayout; labels: readonly string[]; names: boolean; values: boolean }[] = [
			{ id: "+ XL whole, 16 cores", encoders: 6, layout: "whole", labels: CORES16, names: true, values: true },
			{ id: "+ XL whole, 8 cores", encoders: 6, layout: "whole", labels: threadLabels(8), names: true, values: true },
			{ id: "+ XL whole, 12 cores", encoders: 6, layout: "whole", labels: threadLabels(12), names: true, values: true },
			{ id: "+ XL whole, hybrid", encoders: 6, layout: "whole", labels: [...threadLabels(6, 2, "P-core"), ...Array.from({ length: 8 }, (_, i) => `E-core ${6 + i} T0 Usage`)], names: true, values: true },
			{ id: "+ whole, 16 cores", encoders: 4, layout: "whole", labels: CORES16, names: false, values: true },
			{ id: "+ XL split, 16 cores a half", encoders: 6, layout: "split", labels: CORES16, names: false, values: true },
			{ id: "+ split, 16 cores a half", encoders: 4, layout: "split", labels: CORES16, names: false, values: false }
		];
		for (const c of cases) {
			const params = { labels: c.labels, samples: tilesSamples(c.labels.length, (i, t) => busyCpu(i % 32, t)), encoders: c.encoders, layout: c.layout };
			const input = tilesFixture(params).input;
			const panes = c.layout === "split" ? ([0, 1] as const) : ([0] as const);
			const tiles = panes.flatMap((p) => tilesOfInput(input, p));
			const home = buildStripScene(input);
			const inspected = buildStripScene(tilesFixture({ ...params, pausedAgoMs: 20_000 }).input);
			assert.equal(wordsOf(home, 700).length, 0, `${c.id}: no value at home`);
			assert.equal(wordsOf(inspected, 700).length, c.values ? tiles.length : 0, `${c.id}: values inspected`);
			assert.equal(wordsOf(inspected, 600).length, c.names ? tiles.length : c.values ? 0 : wordsOf(home, 600).length, `${c.id}: core numbers inspected`);
			assert.ok(wordsOf(home, 600).length >= tiles.length - 4, `${c.id}: ${wordsOf(home, 600).length} core numbers at home on ${tiles.length} tiles`);
			for (const scene of [home, inspected]) {
				for (const w of wordsOf(scene)) {
					for (const s of seamsIn(0, input.encoders * SLICE_W)) assert.ok(w.bx1 <= s - 2 || w.bx0 >= s + 2, `${c.id}: "${w.text}" at ${w.x} straddles the seam at ${s}`);
					assert.ok(tiles.some((t) => w.bx0 >= t.x0 - 4 && w.bx1 <= t.x1 + 4 && w.y > t.y0 && w.y < t.y1), `${c.id}: "${w.text}" at ${w.x} sits in no tile`);
					assert.equal(scene.prims.find((p) => p.k === "words" && p.words.includes(w))?.layer, "rows", "tile words draw in the rows' edge");
				}
			}
		}
	});

	it("under Names, every tile of a reading that names no core keeps its name, shortened until it finds a place clear of every seam", () => {
		const sets: Record<string, { readonly unit: string; readonly labels: (n: number) => string[]; readonly value: (i: number, t: number) => number }> = {
			clocks: { unit: "MHz", labels: (n) => Array.from({ length: n }, (_, i) => `Core ${i} Clock (perf #${((i * 5) % 16) + 1})`), value: (i, t) => 3000 + ((i * 331 + t / 7) % 2400) },
			temperatures: { unit: "°C", labels: (n) => Array.from({ length: n }, (_, i) => `CPU CCD${i + 1} (Tdie)`), value: (i, t) => 40 + ((i * 7 + t / 900) % 50) },
			mixed: { unit: "%", labels: (n) => Array.from({ length: n }, (_, i) => `${["Total CPU Usage", "Max CPU/Thread Usage", "CPU Package Power", "GPU Temperature", "Core VIDs (avg)", "CPU Core Voltage", "Package C6 Residency", "Memory Clock"][i % 8] as string}${i >= 8 ? ` ${i}` : ""}`), value: (i, t) => (i * 13 + t / 700) % 100 }
		};
		const cases: { encoders: StripEncoders; layout: StripLayout; n: number }[] = [
			{ encoders: 6, layout: "whole", n: 16 },
			{ encoders: 6, layout: "whole", n: 8 },
			{ encoders: 4, layout: "whole", n: 6 },
			{ encoders: 4, layout: "whole", n: 12 },
			{ encoders: 6, layout: "split", n: 4 }
		];
		for (const c of cases) {
			for (const [kind, set] of Object.entries(sets)) {
				const id = `${c.layout} ${c.encoders}, ${c.n} ${kind}`;
				const labels = set.labels(c.n);
				const input = tilesFixture({ labels, unit: set.unit, samples: tilesSamples(c.n, set.value), encoders: c.encoders, layout: c.layout }).input;
				const scene = buildStripScene(input);
				const tiles = (c.layout === "split" ? ([0, 1] as const) : ([0] as const)).flatMap((p) => tilesOfInput(input, p));
				const names = wordsOf(scene, 600);
				assert.equal(names.length, tiles.length, `${id}: a name on every tile (${names.map((w) => w.text).join(", ")})`);
				for (const t of tiles) {
					const own = names.filter((w) => w.bx0 >= t.x0 && w.bx1 <= t.x1 && w.y > t.y0 && w.y < t.y1);
					assert.equal(own.length, 1, `${id}: one name in the tile of ${labels[t.index]}`);
					const name = (own[0] as Word).text;
					assert.ok(nameRungs(labels[t.index] as string, labels).includes(name), `${id}: "${name}" is a shortened form of ${labels[t.index]}`);
					for (const v of wordsOf(scene, 700)) if (Math.abs(v.y - (own[0] as Word).y) < 8) assert.ok(v.bx1 <= (own[0] as Word).bx0 || v.bx0 >= (own[0] as Word).bx1, `${id}: "${name}" and the value "${v.text}" overlap`);
				}
				for (const w of wordsOf(scene)) for (const s of seamsIn(0, input.encoders * SLICE_W)) assert.ok(w.bx1 <= s - 2 || w.bx0 >= s + 2, `${id}: "${w.text}" at ${w.x} straddles the seam at ${s}`);
			}
		}
	});

	it("with Alert bands set, no value takes a color: a tile past a limit says so with its bar, as a Group Rows row does, and no word turns a pale alert color", () => {
		const fx = tilesFixture({ labels: CORES16, samples: tilesSamples(32, (i) => (i === 0 ? 95 : i === 1 ? 75 : 15 + ((i * 11) % 50))), encoders: 6, limits: { warn: 70, crit: 90 }, pausedAgoMs: 20_000 });
		const scene = buildStripScene(fx.input);
		const tiles = tilesOfInput(fx.input);
		const valueIn = (s: LogicalScene, index: number): Word => {
			const t = tiles.find((k) => k.index === index) as Tile;
			const w = wordsOf(s, 700).find((v) => v.bx0 >= t.x0 - 4 && v.bx1 <= t.x1 + 4 && v.y > t.y0 && v.y < t.y1);
			assert.ok(w !== undefined, `a value in tile ${index}`);
			return w;
		};
		const chroma = (c: string): number => Math.hypot(hexToLab(c)[1], hexToLab(c)[2]);
		for (let i = 0; i < 32; i++) assert.ok(chroma(valueIn(scene, i).fill) < 8, `${valueIn(scene, i).text} in ${valueIn(scene, i).fill}: no level's or alert's color while limits are set`);
		const { warn, crit } = fx.input.alertColors;
		assert.deepEqual([barsOf(scene, crit).length, barsOf(scene, warn).length], [1, 1], "the crit and the warn tile each take their bar");
		// The same frame drawn with other alert colors moves no word: none is alert colored.
		const other = buildStripScene({ ...fx.input, alertColors: { warn: "#2060A0", crit: "#20A060" } });
		assert.deepEqual(wordsOf(other).map((w) => w.fill), wordsOf(scene).map((w) => w.fill));
		// Without limits a value takes its level's color on the ramp, as before.
		const free = buildStripScene(tilesFixture({ labels: CORES16, samples: tilesSamples(32, (i) => 15 + ((i * 11) % 60)), encoders: 6, pausedAgoMs: 20_000 }).input);
		for (let i = 2; i < 32; i++) assert.ok(chroma(valueIn(free, i).fill) >= 8, `${valueIn(free, i).text} in ${valueIn(free, i).fill}: its level's color without limits`);
	});

	it("the bottom row is the Group's own, over the bottom tiles: the window, LIVE, and what the rule left out", () => {
		const labels = threadLabels(24);
		const scene = buildStripScene(tilesFixture({ labels, samples: tilesSamples(48, (i, t) => busyCpu(i % 32, t)), encoders: 6 }).input);
		const texts = scene.prims.filter((p) => p.k === "text" && p.layer === "rows").map((p) => (p as { text: string }).text);
		assert.ok(texts.some((s) => s.startsWith("1 min")), JSON.stringify(texts));
		assert.ok(texts.includes("LIVE"));
		assert.ok(texts.some((s) => s.includes("32 of 48 shown")), JSON.stringify(texts));
	});

	it("a reading whose history the allowance refused shows as the Group reports it: its tile without a line, counted on the bottom row", () => {
		const scene = buildStripScene(tilesFixture({ labels: CORES16, samples: busy(), encoders: 6, groupBudgetBytes: 4096 }).input);
		const texts = scene.prims.filter((p) => p.k === "text").map((p) => (p as { text: string }).text);
		assert.ok(texts.some((s) => /history full: \d+ of 32/.test(s)), JSON.stringify(texts));
		assert.equal(framesOf(scene).flatMap(rectsOf).length, 32, "every tile keeps its frame");
		assert.ok((skeinsOf(scene)[0]?.lines.length ?? 0) < 32, "a refused reading draws no line");
	});

	it("the tile words draw inside the rows' edge filter in every slice that carries them", () => {
		const r = sliceStrip(tilesFixture({ labels: CORES16, samples: busy(), encoders: 6, background: "nebula" }).input);
		for (const s of r.slices) {
			if (s === null) continue;
			const edge = s.indexOf('<g filter="url(#o)">');
			assert.ok(edge > 0 && s.indexOf("<text") > edge, "every word after the edge filter opens");
		}
	});
});

// ---- every word in its own tile ------------------------------------------------------

describe("Tiles: every word inside its own tile and clear of every other word, on every deck and in both face fonts", () => {
	/** How far a word's ink may reach past its own tile (tiles.ts OVERHANG),
	 * how far it keeps from a seam (SEAM_CLEAR), how far its ink keeps from
	 * one at the least (SEAM_INK), and the small value size (VALUE_SMALL). */
	const OVER = 3;
	const SEAM = 3;
	const SEAM_INK = 2.5;
	const SMALL = 11;
	/** Where the ink of the Group's bottom row starts (its LIVE, drawn large): a word's baseline may rest on it, no lower. */
	const BOTTOM_ROW_TOP = 84;
	/** The owner's 9950X3D2 as Build screens' Core clocks filter
	 * (*core*clock*) lists it in his capture: the 16 clocks per perf, then
	 * the 32 effective clocks per thread. The Group shows the first 32. */
	const PERF = [2, 4, 1, 5, 1, 3, 6, 7, 11, 8, 10, 13, 12, 9, 14, 15];
	const BUILD_CLOCKS = [...PERF.map((k, i) => `Core ${i} Clock (perf #${k})`), ...threadLabels(16, 2, "Core", "Effective Clock")];
	const clocks = (n: number): string[] => Array.from({ length: n }, (_, i) => `Core ${i} Clock (perf #${((i * 5) % 16) + 1})`);
	const corePowers = (n: number): string[] => Array.from({ length: n }, (_, i) => `Core ${i} Power`);
	const RAILS = ["CPU Package Power", "CPU Core Power", "CPU SoC Power", "CPU PPT", "GPU Power", "GPU Core (NVVDD) Input Power", "GPU FBVDD Input Power", "GPU PCIe +12V Input Power"];
	const counters = (n: number): string[] => Array.from({ length: n }, (_, i) => `Pump Counter ${i}`);
	const temperatures = (n: number): string[] => Array.from({ length: n }, (_, i) => `CPU CCD${i + 1} (Tdie)`);
	/** A set's readings all print `value` now; with `lo` and `hi`, two
	 * earlier polls of the minute read those, so the scale holds them. */
	type SweepSet = { readonly id: string; readonly unit: string; readonly labels: readonly string[]; readonly value: number; readonly lo?: number; readonly hi?: number };
	// 4444 inks the widest any four digits do (a 4 sits closest to both
	// edges of its advance, and Segoe UI's bold 4 is its widest digit); 100
	// is the widest percentage. The rest print wider than either end of
	// their scale: just under a precision band's top (9.997 prints 10.00,
	// 99.97 prints 100.0, 9999.6 prints 10000), the k form (44.4k against a
	// 150k end) and one decimal against a 3-digit end (44.4 against 100).
	const SETS: readonly SweepSet[] = [
		...Array.from({ length: 30 }, (_, k) => ({ id: `${k + 3} clocks (an even grid)`, unit: "MHz", labels: clocks(k + 3), value: 4444 })),
		...[6, 8, 10, 12, 16].flatMap((cores) => [
			{ id: `${cores} cores' effective clocks`, unit: "MHz", labels: threadLabels(cores, 2, "Core", "Effective Clock"), value: 4444 },
			{ id: `${cores} cores at 100 %`, unit: "%", labels: threadLabels(cores), value: 100 }
		]),
		...[4, 8].flatMap((cores) => [
			{ id: `${cores} cores of 4 threads at 100 %`, unit: "%", labels: threadLabels(cores, 4), value: 100 },
			{ id: `${cores} cores of 4 effective clocks`, unit: "MHz", labels: threadLabels(cores, 4, "Core", "Effective Clock"), value: 4444 }
		]),
		{ id: "8 cores of 3 threads at 100 %", unit: "%", labels: threadLabels(8, 3), value: 100 },
		...[[6, 8], [8, 16]].flatMap(([p, e]) => {
			const labels = (suffix: string): string[] => [...threadLabels(p as number, 2, "P-core", suffix), ...Array.from({ length: e as number }, (_, i) => `E-core ${(p as number) + i} T0 ${suffix}`), `LP E-core ${(p as number) + (e as number)} T0 ${suffix}`];
			return [
				{ id: `${p} P-cores, ${e} E-cores and an LP E-core at 100 %`, unit: "%", labels: labels("Usage"), value: 100 },
				{ id: `${p} P-cores, ${e} E-cores and an LP E-core's effective clocks`, unit: "MHz", labels: labels("Effective Clock"), value: 4444 }
			];
		}),
		{ id: "Build's Core clocks (48 readings)", unit: "MHz", labels: BUILD_CLOCKS, value: 4444 },
		{ id: "16 per-core powers at 9.997 W on 0 to 15 W", unit: "W", labels: corePowers(16), value: 9.997, lo: 0, hi: 15 },
		{ id: "8 power rails at 99.97 W on 0 to 150 W", unit: "W", labels: RAILS, value: 99.97, lo: 0, hi: 150 },
		...[10, 16].flatMap((cores) => [
			{ id: `${cores} cores' effective clocks at 99.97 MHz on 0 to 5888`, unit: "MHz", labels: threadLabels(cores, 2, "Core", "Effective Clock"), value: 99.97, lo: 0, hi: 5888 },
			{ id: `${cores} cores' effective clocks at 9.997 MHz on 0 to 5888`, unit: "MHz", labels: threadLabels(cores, 2, "Core", "Effective Clock"), value: 9.997, lo: 0, hi: 5888 }
		]),
		...Array.from({ length: 30 }, (_, k) => ({ id: `${k + 3} counters at 44.4k on 0 to 150k`, unit: "RPM", labels: counters(k + 3), value: 44_444, lo: 0, hi: 150_000 })),
		...[3, 5, 8, 12, 16, 21, 25, 29, 32].map((n) => ({ id: `${n} counters at 9999.6 on 0 to 44.4k`, unit: "RPM", labels: counters(n), value: 9999.6, lo: 0, hi: 44_444 })),
		...[6, 8, 16, 27].map((n) => ({ id: `${n} temperatures at 44.4 °C on 31 to 95 °C`, unit: "°C", labels: temperatures(n), value: 44.4, lo: 31, hi: 95 }))
	];
	const DECKS = [
		{ id: "+ XL whole", layout: "whole", encoders: 6 },
		{ id: "+ XL split", layout: "split", encoders: 6 },
		{ id: "+ whole", layout: "whole", encoders: 4 },
		{ id: "+ split", layout: "split", encoders: 4 }
	] as const;
	const FONTS = ["tahoma", "segoe-ui"] as const;

	/** How far a word's drawn ink can run past its modeled ink, on the side
	 * it grows toward from its anchor: Segoe UI's model has no ink table and
	 * runs short (a measured 1.72 px on "150k" and 1.63 px on "Clock", through
	 * librsvg); Tahoma's matches within 0.1 px. */
	const shortOf = (font: string): number => (font === "segoe-ui" ? 2 : 0);
	/** A tile word as its ink: the words' boxes are their ink and half a pixel. */
	type Ink = { readonly text: string; readonly value: boolean; readonly size: number; readonly y: number; readonly top: number; readonly x0: number; readonly x1: number };
	const inksOf = (scene: LogicalScene, short = 0): Ink[] => scene.prims.filter((p): p is WordsPrim => p.k === "words").flatMap((p) => p.words.map((w) => ({ text: w.text, value: p.weight === 700, size: w.size, y: w.y, top: w.y - 0.75 * w.size, x0: w.bx0 + 0.5 - (w.anchor === "end" ? short : w.anchor === "middle" ? short / 2 : 0), x1: w.bx1 - 0.5 + (w.anchor === "start" ? short : w.anchor === "middle" ? short / 2 : 0) })));
	const within = (t: Tile, w: Ink): boolean => w.y > t.y0 && w.y < t.y1 && w.x0 >= t.x0 - OVER - 0.01 && w.x1 <= t.x1 + OVER + 0.01;
	/** Whether `ink` px of ink fit in a tile's reach, SEAM px clear of every seam. */
	const canHold = (t: Tile, ink: number): boolean => {
		let free: [number, number][] = [[t.x0 - OVER, t.x1 + OVER]];
		for (const s of seamsIn(t.x0 - OVER, t.x1 + OVER)) {
			free = free.flatMap(([a, b]): [number, number][] => {
				const parts: [number, number][] = [
					[a, Math.min(b, s - SEAM)],
					[Math.max(a, s + SEAM), b]
				];
				return parts.filter((part) => part[1] > part[0]);
			});
		}
		return free.some(([a, b]) => b - a >= ink);
	};

	/** Whether `ink` px of ink fit inside a tile's border, SEAM px clear of every seam. */
	const canHoldInside = (t: Tile, ink: number): boolean => {
		let free: [number, number][] = [[t.x0 + 1, t.x1 - 1]];
		for (const s of seamsIn(t.x0, t.x1)) {
			free = free.flatMap(([a, b]): [number, number][] => {
				const parts: [number, number][] = [
					[a, Math.min(b, s - SEAM)],
					[Math.max(a, s + SEAM), b]
				];
				return parts.filter((part) => part[1] > part[0]);
			});
		}
		return free.some(([a, b]) => b - a >= ink + 0.5);
	};

	type Sweep = { layouts: number; readonly outside: string[]; readonly close: string[]; readonly seam: string[]; readonly lost: string[]; readonly split: string[]; readonly rungs: string[]; readonly unnamed: string[]; readonly bottom: string[]; readonly early: string[]; readonly unnumbered: string[]; readonly moved: string[] };
	let swept: Sweep | undefined;
	/** One frame's words: what sweep() collects from it. `asked`: every value shows. */
	const sweepFrame = (out: Sweep, id: string, font: string, deck: (typeof DECKS)[number], set: SweepSet, input: StripSceneInput, asked: boolean): void => {
		out.layouts++;
		const scene = buildStripScene(input);
		const short = shortOf(font);
		const inks = inksOf(scene, short);
		for (const w of inks) for (const s of seamsIn(0, input.encoders * SLICE_W)) if (!(w.x1 <= s - SEAM_INK + 0.01 || w.x0 >= s + SEAM_INK - 0.01)) out.seam.push(`${id}: "${w.text}" inks ${w.x0.toFixed(1)} to ${w.x1.toFixed(1)} by the seam at ${s}`);
		for (const p of deck.layout === "split" ? ([0, 1] as const) : ([0] as const)) {
			// The small size's widest ink of any value the pane's scale prints.
			const held = scene.scales[p]?.held.group;
			const small = short + (held === undefined ? 0 : Math.max(...printedOn(set.unit, held.lo, held.hi).map((text) => ((e) => e.right - e.left)(inkEdges([{ text, fontSize: SMALL, fontWeight: 700 }], "start", 0)))));
			const names = (input.panes[p]?.series ?? []).map((s) => s.name);
			const shape = tileShapeOf(names);
			const tiles = tilesOfInput(input, p);
			const extent = paneExtents(deck.layout, deck.encoders)[p] as { x0: number; x1: number };
			const mine = inks.filter((w) => w.x1 > extent.x0 - OVER - 1 && w.x0 < extent.x1 + OVER + 1);
			for (const w of mine) if (!tiles.some((t) => within(t, w))) out.outside.push(`${id}: "${w.text}" inks ${w.x0.toFixed(1)} to ${w.x1.toFixed(1)} at y ${w.y}`);
			for (let i = 0; i < mine.length; i++) {
				for (let j = i + 1; j < mine.length; j++) {
					const a = mine[i] as Ink;
					const b = mine[j] as Ink;
					if (!(a.top < b.y && b.top < a.y)) continue;
					const gap = Math.max(b.x0 - a.x1, a.x0 - b.x1);
					if (gap < INK_CLEAR_GAP) out.close.push(`${id}: "${a.text}" and "${b.text}" ${gap.toFixed(1)} px apart at y ${a.y}`);
				}
			}
			// A stack of 3 or more: its words keep off the Group's bottom row
			// and inside their tile, under its top border.
			for (const t of tiles) {
				if (t.slots < 3) continue;
				for (const w of mine) if (within(t, w) && (w.y > BOTTOM_ROW_TOP || w.top < t.y0 + 0.5)) out.bottom.push(`${id}: "${w.text}" at baseline ${w.y}, its top at ${w.top.toFixed(1)}, in the tile from ${t.y0} to ${t.y1}`);
			}
			const valued = asked && mine.some((w) => w.value);
			for (const t of tiles) {
				const values = mine.filter((w) => w.value && within(t, w));
				if (valued && values.length !== 1 && canHold(t, small)) out.lost.push(`${id}: the tile of ${names[t.index]} (${t.x0} to ${t.x1}) holds ${values.length} values`);
			}
			// A core column: its values on one side of each seam through it (a
			// value is its tile's when its middle is in the tile's reach).
			shape.columns.forEach((slots, c) => {
				const col = tiles.filter((t) => t.column === c);
				const first = col[0];
				if (shape.cores[c] === null || first === undefined || col.length < 2) return;
				for (const s of seamsIn(first.x0, first.x1)) {
					const sides = new Set(col.flatMap((t) => mine.filter((w) => w.value && w.y > t.y0 && w.y < t.y1 && (w.x0 + w.x1) / 2 >= t.x0 - OVER && (w.x0 + w.x1) / 2 <= t.x1 + OVER).map((w) => ((w.x0 + w.x1) / 2 <= s ? "left" : "right"))));
					if (sides.size > 1) out.split.push(`${id}: core ${shape.cores[c]}'s values on both sides of the seam at ${s}`);
				}
			});
			// Tiles that name their reading: one rung of its shortened forms for
			// all, a shorter ladder at its own last rung.
			const shown: { readonly rungs: readonly string[]; readonly text: string }[] = [];
			for (const w of mine) {
				if (w.value) continue;
				const t = tiles.find((k) => within(k, w));
				if (t === undefined || shape.cores[t.column] !== null) continue;
				shown.push({ rungs: nameRungs(names[t.index] as string, names), text: w.text });
			}
			const depth = Math.max(0, ...shown.map((s) => s.rungs.length));
			const one = Array.from({ length: depth }, (_, k) => k).some((k) => shown.every((s) => s.rungs[Math.min(k, s.rungs.length - 1)] === s.text));
			if (shown.length > 0 && !one) out.rungs.push(`${id}, pane ${p}: names take rungs ${[...new Set(shown.map((s) => s.rungs.indexOf(s.text)))].sort().join(", ")}`);
			// With values at their full size (the tier that names tiles), a tile
			// clear of every seam with room for its shortest name beside the
			// small value (tiles.ts withName: INSET 4 a side, LABEL_GAP 6) shows a
			// name.
			const smallSlot = scene.scales[p]?.slots["tiles:small"] ?? 0;
			if (mine.some((w) => w.value && w.size === 13)) {
				for (const t of tiles) {
					if (shape.cores[t.column] !== null || seamsIn(t.x0 - OVER - 1, t.x1 + OVER + 1).length > 0) continue;
					const shortest = short + Math.min(...nameRungs(names[t.index] as string, names).map((rung) => inkSpan([{ text: rung, fontSize: 11, fontWeight: 600 }]).advance));
					const room = t.x1 - t.x0 - 6 - (smallSlot + 6);
					if (shortest + 0.5 <= room && !mine.some((w) => !w.value && within(t, w))) out.unnamed.push(`${id}: the tile of ${names[t.index]} (${t.x0} to ${t.x1}) shows no name though ${room.toFixed(1)} px hold its ${shortest.toFixed(1)} px shortest one beside the small value`);
				}
			}
		}
	};
	/** One font, deck and set, at home and inspected (every value asked for). */
	const sweepOne = (out: Sweep, font: string, deck: (typeof DECKS)[number], set: SweepSet): void => {
		const samples = tilesSamples(set.labels.length, (_, t) => {
			const k = Math.round((t - 10_000) / 2000);
			return set.lo !== undefined && k === 2 ? set.hi : set.lo !== undefined && k === 3 ? set.lo : set.value;
		});
		const params = { labels: set.labels, unit: set.unit, samples, encoders: deck.encoders, layout: deck.layout, background: "nebula" } as const;
		const home = tilesFixture(params).input;
		const inspected = tilesFixture({ ...params, pausedAgoMs: 20_000 }).input;
		sweepFrame(out, `${font}, ${deck.id}, ${set.id}, inspected`, font, deck, set, inspected, true);
		sweepFrame(out, `${font}, ${deck.id}, ${set.id}, at home`, font, deck, set, home, false);
		// A number that prints with every value showing stands where it stands at home.
		const placeOf = (w: Word): string => `"${w.text}" at ${w.x}, ${w.y}`;
		const atHome = new Set(wordsOf(buildStripScene(home), 600).map(placeOf));
		for (const w of wordsOf(buildStripScene(inspected), 600)) if (!atHome.has(placeOf(w))) out.moved.push(`${font}, ${deck.id}, ${set.id}: ${placeOf(w)} inspected, not at home`);
		// At home: a per-thread tile prints no value, and its number wherever the
		// tile holds it clear of every seam.
		const short = shortOf(font);
		const inks = inksOf(buildStripScene(home), short);
		for (const p of deck.layout === "split" ? ([0, 1] as const) : ([0] as const)) {
			const names = (home.panes[p]?.series ?? []).map((s) => s.name);
			const shape = tileShapeOf(names);
			for (const t of tilesOfInput(home, p)) {
				const cored = shape.cores[t.column] ?? null;
				if (cored === null) continue;
				const own = inks.filter((w) => w.y > t.y0 && w.y < t.y1 && (w.x0 + w.x1) / 2 >= t.x0 - OVER && (w.x0 + w.x1) / 2 <= t.x1 + OVER);
				const label = `${font}, ${deck.id}, ${set.id}: the tile of ${names[t.index]} (${t.x0} to ${t.x1})`;
				for (const w of own) if (w.value) out.early.push(`${label} prints "${w.text}" at home`);
				const number = own.filter((w) => !w.value);
				const ink = short + inkSpan([{ text: String(cored), fontSize: 11, fontWeight: 600 }]).advance;
				if (number.length > 1 || (number[0] !== undefined && number[0].text !== String(cored))) out.unnumbered.push(`${label} prints ${number.map((w) => w.text).join(" and ")}`);
				else if (number.length === 0 && canHoldInside(t, ink)) out.unnumbered.push(`${label} prints no number though its ${ink.toFixed(1)} px fit`);
			}
		}
	};
	/** Every font, deck and set once: the words that leave their tile, the
	 * pairs closer than two blank pixel columns, the words whose ink comes
	 * nearer a seam than the slicer's bleed and half a pixel, the tiles that
	 * lose a value they have room for, the core columns whose values sit on
	 * both sides of a seam, the panes whose names shorten differently tile
	 * to tile, and the tiles that show no name though one fits beside the
	 * small value. */
	const sweep = (): Sweep => {
		if (swept !== undefined) return swept;
		const out: Sweep = { layouts: 0, outside: [], close: [], seam: [], lost: [], split: [], rungs: [], unnamed: [], bottom: [], early: [], unnumbered: [], moved: [] };
		try {
			for (const font of FONTS) {
				setFaceFont(font);
				for (const deck of DECKS) for (const set of SETS) sweepOne(out, font, deck, set);
			}
		} finally {
			setFaceFont("tahoma");
		}
		swept = out;
		return out;
	};
	const report = (list: readonly string[]): string => `${list.length} in ${sweep().layouts} layouts: ${list.slice(0, 12).join("; ")}`;

	it("no word's ink reaches more than 3 px past its own tile: 4-digit even grids of 3 to 32, CPU layouts of 4-digit and 100 % threads, Build's Core clocks, powers, counters and temperatures at values wider than their scale's ends, on the + XL and the +, whole and split, in Tahoma and Segoe UI", () => {
		assert.ok(sweep().layouts >= 2 * 2 * 4 * 90);
		assert.deepEqual(sweep().outside, [], report(sweep().outside));
	});

	it("no two words come closer than two blank pixel columns, so two labels never read as one number", () => {
		assert.deepEqual(sweep().close, [], report(sweep().close));
	});

	it("no word's ink comes nearer a seam than the slicer's bleed and half a pixel, so no word straddles one", () => {
		assert.deepEqual(sweep().seam, [], report(sweep().seam));
	});

	it("every tile holds its own value inside its reach while it has room for the small size", () => {
		assert.deepEqual(sweep().lost, [], report(sweep().lost));
	});

	it("a core column's values take one side of a seam through it", () => {
		assert.deepEqual(sweep().split, [], report(sweep().split));
	});

	it("tiles that name their reading take one rung of the names for every tile, the longest that fits them all", () => {
		assert.deepEqual(sweep().rungs, [], report(sweep().rungs));
	});

	it("a tile with room for a name only beside the small value still shows one: no grid loses every name because none fits beside the full value", () => {
		assert.deepEqual(sweep().unnamed, [], report(sweep().unnamed));
	});

	it("a stack of 3 or more threads keeps its words off the Group's bottom row, each under its tile's top border", () => {
		assert.deepEqual(sweep().bottom, [], report(sweep().bottom));
	});

	it("at home a per-thread tile prints no value, on every deck and in both face fonts", () => {
		assert.deepEqual(sweep().early, [], report(sweep().early));
	});

	it("at home a per-thread tile prints its one core number wherever the tile holds it clear of every seam, on every deck and in both face fonts", () => {
		assert.deepEqual(sweep().unnumbered, [], report(sweep().unnumbered));
	});

	it("a word stands in one place at home and with every value showing, on every deck and in both face fonts", () => {
		assert.deepEqual(sweep().moved, [], report(sweep().moved));
	});

	it("the owner's deck (16 cores of %, + XL whole) keeps every core number and every value at its full size", () => {
		const input = tilesFixture({ labels: CORES16, samples: tilesSamples(32, () => 100), encoders: 6, background: "nebula", theme: "ember", screens: 6, pausedAgoMs: 20_000 }).input;
		const scene = buildStripScene(input);
		assert.deepEqual(wordsOf(scene, 600).map((w) => [w.text, w.size]), Array.from({ length: 32 }, (_, i) => [String(i >> 1), 11]));
		assert.deepEqual(wordsOf(scene, 700).map((w) => w.size), new Array(32).fill(13));
	});

	it("a value's slot and its ink hold the widest text the reading prints anywhere on the scale, not only at its ends, in Tahoma and Segoe UI", () => {
		const cases: { readonly id: string; readonly unit: string; readonly labels: readonly string[]; readonly lo: number; readonly hi: number }[] = [
			{ id: "per-core powers on 0 to 15 W (10.00)", unit: "W", labels: corePowers(16), lo: 0, hi: 15 },
			{ id: "power rails on 0 to 150 W (100.0)", unit: "W", labels: RAILS, lo: 0, hi: 150 },
			{ id: "effective clocks on 0 to 5888 MHz (100.0)", unit: "MHz", labels: threadLabels(16, 2, "Core", "Effective Clock"), lo: 0, hi: 5888 },
			{ id: "clocks on 4300 to 4500 MHz (4444 in Segoe UI)", unit: "MHz", labels: threadLabels(16, 2, "Core", "Effective Clock"), lo: 4300, hi: 4500 },
			{ id: "counters on 0 to 150k (10000, 44.4k)", unit: "RPM", labels: counters(8), lo: 0, hi: 150_000 },
			{ id: "temperatures on 31 to 95 °C (44.4)", unit: "°C", labels: temperatures(8), lo: 31, hi: 95 },
			{ id: "usage on 0 to 100 %", unit: "%", labels: CORES16, lo: 0, hi: 100 }
		];
		try {
			for (const font of FONTS) {
				setFaceFont(font);
				for (const c of cases) {
					const samples = tilesSamples(c.labels.length, (i, t) => (Math.round((t - 10_000) / 2000) === 2 ? c.hi : c.lo + ((c.hi - c.lo) * ((i * 7 + t / 2000) % 10)) / 10));
					const scene = buildStripScene(tilesFixture({ labels: c.labels, unit: c.unit, samples, encoders: 6, background: "nebula" }).input);
					const out = scene.scales[0];
					const held = out?.held.group;
					assert.ok(out !== null && out !== undefined && held !== undefined, c.id);
					const texts = printedOn(c.unit, held.lo, held.hi);
					for (const [size, key] of [[13, "tiles:value"], [11, "tiles:small"]] as const) {
						const widest = Math.max(...texts.map((text) => inkSpan([{ text, fontSize: size, fontWeight: 700 }]).advance));
						assert.ok((out.slots[key] ?? 0) >= widest - 0.01, `${font}, ${c.id}, ${held.lo} to ${held.hi}: the ${size} px slot is ${out.slots[key]} px, "${texts.find((text) => inkSpan([{ text, fontSize: size, fontWeight: 700 }]).advance === widest)}" ${widest.toFixed(2)}`);
					}
					for (const [size, key] of [[13, "tiles:ink"], [11, "tiles:ink-small"]] as const) {
						const spans = texts.map((text) => inkSpan([{ text, fontSize: size, fontWeight: 700 }]));
						const lead = Math.max(...spans.map((s) => s.advance - s.left));
						const reach = Math.max(...spans.map((s) => s.right));
						assert.ok((out.slots[`${key}:lead`] ?? 0) >= lead - 0.01, `${font}, ${c.id}: an end-anchored value inks ${lead.toFixed(2)} px before its anchor, the slot holds ${out.slots[`${key}:lead`]}`);
						assert.ok((out.slots[`${key}:reach`] ?? 0) >= reach - 0.01, `${font}, ${c.id}: a start-anchored value inks ${reach.toFixed(2)} px past its anchor, the slot holds ${out.slots[`${key}:reach`]}`);
					}
				}
			}
		} finally {
			setFaceFont("tahoma");
		}
	});
});

describe("Tiles: every cell of a per-thread grid prints HWiNFO's core number", () => {
	/** The number each tile prints, by its reading's label. */
	const numbersOf = (labels: readonly string[], encoders: StripEncoders = 6): Record<string, string[]> => {
		const input = tilesFixture({ labels, samples: tilesSamples(labels.length, () => 100), encoders, background: "nebula", theme: "ember", screens: 6 }).input;
		const words = wordsOf(buildStripScene(input), 600);
		return Object.fromEntries(tilesOfInput(input).map((t) => [labels[t.index] as string, words.filter((w) => w.bx0 >= t.x0 - 3 && w.bx1 <= t.x1 + 3 && w.y > t.y0 && w.y < t.y1).map((w) => w.text)]));
	};

	it("Core 5 is 5 over 5: both threads of every core print its number, in one place in the column", () => {
		const numbers = numbersOf(CORES16);
		for (const label of CORES16) assert.deepEqual(numbers[label], [String(threadOf(label)?.core)], label);
		const input = tilesFixture({ labels: CORES16, samples: tilesSamples(32, () => 100), encoders: 6, background: "nebula", theme: "ember", screens: 6 }).input;
		const words = wordsOf(buildStripScene(input), 600);
		for (let core = 0; core < 16; core++) assert.equal(new Set(words.filter((w) => w.text === String(core)).map((w) => w.x)).size, 1, `core ${core}'s numbers share a place in the column`);
	});

	it("a core of four threads prints its number on all four, and a one-thread core on its one tile", () => {
		const four = threadLabels(8, 4);
		const numbers = numbersOf(four);
		for (const label of four) assert.deepEqual(numbers[label], [String(threadOf(label)?.core)], label);
		const one = numbersOf(["Core 0 T0 Usage", "Core 1 T0 Usage", "Core 2 T0 Usage"]);
		assert.deepEqual(Object.values(one), [["0"], ["1"], ["2"]]);
	});

	it("P, E and LP-E cores print the numbers HWiNFO prints, whatever the order or the gaps", () => {
		const hybrid = [...threadLabels(6, 2, "P-core"), ...Array.from({ length: 6 }, (_, i) => `E-core ${8 + i} T0 Usage`), "LP E-core 20 T0 Usage", "LP E-core 21 T0 Usage"];
		const numbers = numbersOf(hybrid);
		for (const label of hybrid) assert.deepEqual(numbers[label], [String(threadOf(label)?.core)], label);
		assert.deepEqual(numbers["E-core 8 T0 Usage"], ["8"], "an E-core's own number, never its place in the row");
		assert.deepEqual(numbers["LP E-core 21 T0 Usage"], ["21"]);
		const both = numbersOf(["P-core 0 T0 Usage", "P-core 0 T1 Usage", "E-core 0 T0 Usage", "E-core 1 T0 Usage"]);
		assert.deepEqual(Object.values(both), [["0"], ["0"], ["0"], ["1"]], "a P-core 0 and an E-core 0 both print 0, in their own blocks");
		const gaps = numbersOf(["Core 2 T0 Usage", "Core 2 T1 Usage", "Core 7 T0 Usage", "Core 7 T1 Usage"]);
		assert.deepEqual(Object.values(gaps), [["2"], ["2"], ["7"], ["7"]], "a CPU that skips core numbers keeps them");
	});
});

describe("Tiles: a per-thread tile's value prints only when it is highlighted, past a limit or inspected", () => {
	const OWNER = { encoders: 6, background: "nebula", theme: "ember", screens: 6 } as const;
	const EFFECTIVE = threadLabels(16, 2, "Core", "Effective Clock");
	/** The value in a tile: a word of the values' weight whose middle is in the tile's reach. */
	const valueIn = (scene: LogicalScene, t: Tile): Word | undefined => wordsOf(scene, 700).find((w) => (w.bx0 + w.bx1) / 2 >= t.x0 - 3 && (w.bx0 + w.bx1) / 2 <= t.x1 + 3 && w.y > t.y0 && w.y < t.y1);
	const placeOf = (w: Word | undefined): readonly unknown[] | undefined => (w === undefined ? undefined : [w.x, w.y, w.anchor, w.size]);
	const valuesAt = (scene: LogicalScene, tiles: readonly Tile[]): number[] => tiles.filter((t) => valueIn(scene, t) !== undefined).map((t) => t.index);

	it("at home every tile keeps its number and prints no value", () => {
		const scene = buildStripScene(tilesFixture({ ...OWNER, labels: CORES16, samples: busy() }).input);
		assert.deepEqual(wordsOf(scene, 700), []);
		assert.equal(wordsOf(scene, 600).length, 32);
	});

	it("a highlighted tile prints its value, and no other tile does", () => {
		for (const highlight of [0, 9, 31]) {
			const fx = tilesFixture({ ...OWNER, labels: CORES16, samples: busy(), highlight });
			assert.deepEqual(valuesAt(buildStripScene(fx.input), tilesOfInput(fx.input)), [highlight]);
		}
	});

	it("a tile past a limit prints its value at either level, a limit from below too, and a calm tile under the same limits does not", () => {
		const fx = tilesFixture({ ...OWNER, labels: CORES16, samples: tilesSamples(32, (i) => (i === 4 ? 95 : i === 17 ? 75 : 20)), limits: { warn: 70, crit: 90 } });
		const scene = buildStripScene(fx.input);
		assert.deepEqual(valuesAt(scene, tilesOfInput(fx.input)), [4, 17]);
		assert.equal(valueIn(scene, tilesOfInput(fx.input).find((t) => t.index === 4) as Tile)?.text, "95");
		const below = tilesFixture({ ...OWNER, labels: CORES16, samples: tilesSamples(32, (i) => (i === 3 ? 5 : 60)), limits: { warn: 20, below: true } });
		assert.deepEqual(valuesAt(buildStripScene(below.input), tilesOfInput(below.input)), [3]);
	});

	it("inspecting, every tile prints its value at the cursor", () => {
		const samples = tilesSamples(32, (_i, t) => (t < 40_000 ? 10 : 90));
		const fx = tilesFixture({ ...OWNER, labels: CORES16, samples, pausedAgoMs: 45_000 });
		const scene = buildStripScene(fx.input);
		assert.deepEqual(valuesAt(scene, tilesOfInput(fx.input)), Array.from({ length: 32 }, (_, i) => i));
		assert.deepEqual([...new Set(wordsOf(scene, 700).map((w) => w.text))], ["10"]);
	});

	it("live, a limit a tile passed earlier in the window asks for nothing", () => {
		const samples = tilesSamples(32, (i, t) => (i === 6 && t < 40_000 ? 95 : 20));
		const live = tilesFixture({ ...OWNER, labels: CORES16, samples, limits: { warn: 70 } });
		assert.deepEqual(valuesAt(buildStripScene(live.input), tilesOfInput(live.input)), []);
	});

	it("the Current value box still turns values off: none highlighted, past a limit or inspected, and the numbers stay", () => {
		const overlays = { current: false };
		const base = { ...OWNER, labels: CORES16, overlays };
		for (const fx of [tilesFixture({ ...base, samples: busy(), highlight: 9 }), tilesFixture({ ...base, samples: tilesSamples(32, () => 95), limits: { warn: 70, crit: 90 } }), tilesFixture({ ...base, samples: busy(), pausedAgoMs: 20_000 })]) {
			const scene = buildStripScene(fx.input);
			assert.deepEqual(wordsOf(scene, 700), []);
			assert.equal(wordsOf(scene, 600).length, 32);
		}
	});

	it("Names off: no number; the value still comes when it is asked for", () => {
		const overlays = { legend: false };
		const home = buildStripScene(tilesFixture({ ...OWNER, labels: CORES16, overlays, samples: busy() }).input);
		assert.deepEqual(wordsOf(home), []);
		const fx = tilesFixture({ ...OWNER, labels: CORES16, overlays, samples: busy(), highlight: 9 });
		const scene = buildStripScene(fx.input);
		assert.deepEqual(wordsOf(scene, 600), []);
		assert.deepEqual(valuesAt(scene, tilesOfInput(fx.input)), [9]);
	});

	it("nothing moves when a value appears: every number and every value keeps its one place at home, highlighted, past a limit and inspected, seams and four-digit clocks too", () => {
		const decks = [
			{ id: "+ XL whole", encoders: 6, layout: "whole" },
			{ id: "+ whole", encoders: 4, layout: "whole" },
			{ id: "+ XL split", encoders: 6, layout: "split" },
			{ id: "+ split", encoders: 4, layout: "split" }
		] as const;
		const sets = [
			{ id: "16 cores of %", labels: CORES16, unit: "%", value: 40, past: 95, warn: 70 },
			{ id: "16 cores' effective clocks", labels: EFFECTIVE, unit: "MHz", value: 3000, past: 4444, warn: 4000 },
			{ id: "8 cores of 4 threads", labels: threadLabels(8, 4), unit: "%", value: 40, past: 95, warn: 70 },
			{ id: "hybrid", labels: [...threadLabels(6, 2, "P-core"), ...Array.from({ length: 8 }, (_, i) => `E-core ${6 + i} T0 Usage`)], unit: "%", value: 40, past: 95, warn: 70 }
		];
		for (const deck of decks) {
			for (const set of sets) {
				const id = `${deck.id}, ${set.id}`;
				const n = set.labels.length;
				// Two early polls hold the scale, so every frame has the same one.
				const value = (at: readonly number[]) => (i: number, t: number) => (t < 20_000 ? set.past : at.includes(i) ? set.past : set.value);
				const frame = (at: readonly number[], rest: Partial<TilesFixtureParams> = {}): StripSceneInput => tilesFixture({ labels: set.labels, unit: set.unit, encoders: deck.encoders, layout: deck.layout, background: "nebula", samples: tilesSamples(n, value(at)), limits: { warn: set.warn }, ...rest }).input;
				const input = frame([]);
				const tiles = (deck.layout === "split" ? ([0, 1] as const) : ([0] as const)).flatMap((p) => tilesOfInput(input, p));
				const allAsked = buildStripScene(frame([], { pausedAgoMs: 10_000 }));
				const homeWords = wordsOf(buildStripScene(input), 600).map((w) => [w.text, w.x, w.y]).map(String);
				for (const t of tiles) {
					const at = `${id}, tile ${t.index} (${t.x0} to ${t.x1})`;
					const want = placeOf(valueIn(allAsked, t));
					for (const [how, scene] of [["highlighted", buildStripScene(frame([], { highlight: t.index }))], ["past a limit", buildStripScene(frame([t.index]))]] as const) {
						assert.deepEqual(placeOf(valueIn(scene, t)), want, `${at}: the value ${how} keeps its place`);
						for (const w of wordsOf(scene, 600)) assert.ok(homeWords.includes(String([w.text, w.x, w.y])), `${at} ${how}: "${w.text}" at ${w.x} moved`);
					}
				}
			}
		}
	});

	it("a column with no room for a number beside its value prints the number at home, and the value in its place when it is asked for", () => {
		// 45 px tiles: a + whole of 16 cores.
		const home = tilesFixture({ labels: CORES16, samples: busy(), encoders: 4, background: "nebula" });
		assert.deepEqual(wordsOf(buildStripScene(home.input), 700), []);
		assert.equal(wordsOf(buildStripScene(home.input), 600).length, 32, "a number in every tile");
		const fx = tilesFixture({ labels: CORES16, samples: busy(), encoders: 4, background: "nebula", highlight: 9 });
		const scene = buildStripScene(fx.input);
		assert.deepEqual(valuesAt(scene, tilesOfInput(fx.input)), [9]);
		assert.equal(wordsOf(scene, 600).length, 31, "the highlighted tile's value takes its number's place; the others keep theirs");
		const paused = buildStripScene(tilesFixture({ labels: CORES16, samples: busy(), encoders: 4, background: "nebula", pausedAgoMs: 20_000 }).input);
		assert.equal(wordsOf(paused, 700).length, 32);
		assert.deepEqual(wordsOf(paused, 600), [], "inspected, the values read the moment");
	});

	it("the narrowest tiles, with no room for any value, still print the number", () => {
		// 20 px tiles: a + split of 16 cores a half.
		const fx = tilesFixture({ labels: CORES16, samples: busy(), encoders: 4, layout: "split", background: "nebula", highlight: 9 });
		const scene = buildStripScene(fx.input);
		const numbers = wordsOf(scene, 600);
		assert.deepEqual(wordsOf(scene, 700), [], "no room for a value");
		const tiles = [...tilesOfInput(fx.input, 0), ...tilesOfInput(fx.input, 1)];
		assert.equal(tiles.length, 64);
		assert.ok(numbers.length >= 60, `${numbers.length} numbers in 64 tiles`);
		for (const w of numbers) assert.ok(tiles.some((t) => w.bx0 >= t.x0 && w.bx1 <= t.x1 && w.y > t.y0 && w.y < t.y1), `"${w.text}" at ${w.x} inside a tile`);
	});

	it("a grid of names keeps its values at home; in a grid of both, the cores wait and the reading that names no core keeps its value and its name", () => {
		const names = Array.from({ length: 8 }, (_, i) => `CPU CCD${i + 1} (Tdie)`);
		const grid = tilesFixture({ labels: names, unit: "°C", samples: tilesSamples(8, (i) => 40 + i), encoders: 6 });
		assert.equal(wordsOf(buildStripScene(grid.input), 700).length, 8);
		const both = [...threadLabels(4), "Total CPU Usage"];
		const fx = tilesFixture({ labels: both, samples: tilesSamples(9, () => 40), encoders: 6 });
		const scene = buildStripScene(fx.input);
		assert.deepEqual(valuesAt(scene, tilesOfInput(fx.input)), [8]);
		assert.ok(wordsOf(scene, 600).some((w) => w.text.includes("Total")), "its name");
	});

	it("bytes on a frame like the owner's: at home less than with every value, and every state keeps the 5 min graph inside Nebula's limit", () => {
		const limit = SLICE_PAYLOAD_LIMIT - ART_PIECE_LIMIT;
		const deck = { ...OWNER, labels: CORES16, window: "5m" as const, samples: busy(300) };
		const home = sliceStrip(tilesFixture(deck).input);
		const inspected = sliceStrip(tilesFixture({ ...deck, pausedAgoMs: 60_000 }).input);
		const past = sliceStrip(tilesFixture({ ...deck, samples: tilesSamples(32, (i, t) => (t < 310_000 ? busyCpu(i, t) : 99), 300), limits: { warn: 80, crit: 95 } }).input);
		const lit = sliceStrip(tilesFixture({ ...deck, highlight: 9 }).input);
		assert.ok(home.maxBytes < inspected.maxBytes, `${home.maxBytes} B at home, ${inspected.maxBytes} B inspected`);
		for (const [id, r] of [["home", home], ["inspected", inspected], ["every tile past a limit", past], ["highlighted", lit]] as const) {
			assert.ok(r.maxBytes <= limit, `${id}: ${r.maxBytes} B`);
			assert.equal(r.reduced === true, false, `${id}: keeps its graph`);
			assert.equal(r.bucketPx, home.bucketPx, `${id}: keeps home's buckets (${r.maxBytes} B)`);
		}
	});
});

describe("Tiles: the bottom row names a highlighted thread as HWiNFO labels it", () => {
	const rowTexts = (scene: LogicalScene): string[] => scene.prims.filter((p) => p.k === "text" && p.layer === "rows").map((p) => (p as { text: string }).text);
	const nameIn = (labels: readonly string[], highlight: number): string[] => rowTexts(buildStripScene(tilesFixture({ labels, samples: tilesSamples(labels.length, () => 40), encoders: 6, background: "nebula", theme: "ember", screens: 6, highlight }).input));

	it("Core 5 T1 stands after the window while its tile is highlighted, and at home the row is the window alone", () => {
		assert.ok(nameIn(CORES16, 11).includes("1 min · Core 5 T1"), JSON.stringify(nameIn(CORES16, 11)));
		assert.ok(nameIn(CORES16, 10).includes("1 min · Core 5 T0"), JSON.stringify(nameIn(CORES16, 10)));
		const home = rowTexts(buildStripScene(tilesFixture({ labels: CORES16, samples: busy(), encoders: 6 }).input));
		assert.ok(home.includes("1 min"), JSON.stringify(home));
		assert.ok(!home.some((text) => text.includes("Core")), JSON.stringify(home));
	});

	it("a hybrid CPU's P, E and LP-E threads, four threads a core, and a reading of another kind each read as HWiNFO prints them", () => {
		const hybrid = ["P-core 0 T0 Usage", "P-core 0 T1 Usage", "E-core 8 T0 Usage", "LP E-core 20 T0 Usage"];
		assert.ok(nameIn(hybrid, 1).includes("1 min · P-core 0 T1"), JSON.stringify(nameIn(hybrid, 1)));
		assert.ok(nameIn(hybrid, 2).includes("1 min · E-core 8 T0"), JSON.stringify(nameIn(hybrid, 2)));
		assert.ok(nameIn(hybrid, 3).includes("1 min · LP E-core 20 T0"), JSON.stringify(nameIn(hybrid, 3)));
		assert.ok(nameIn(threadLabels(8, 4), 15).includes("1 min · Core 3 T3"), JSON.stringify(nameIn(threadLabels(8, 4), 15)));
		assert.ok(nameIn(threadLabels(16, 2, "Core", "Effective Clock"), 25).includes("1 min · Core 12 T1"));
	});

	it("nothing else moves: the window keeps its place, and inspecting the moment follows the name", () => {
		const at = (highlight?: number): { x: number; text: string } => {
			const words = buildStripScene(tilesFixture({ labels: CORES16, samples: busy(), encoders: 6, ...(highlight === undefined ? {} : { highlight }) }).input).prims.filter((p) => p.k === "text" && p.layer === "rows") as unknown as { x: number; text: string }[];
			return words.find((w) => w.text.startsWith("1 min")) as { x: number; text: string };
		};
		assert.equal(at(11).x, at().x, "the row starts where it starts at home");
		const inspected = rowTexts(buildStripScene(tilesFixture({ labels: CORES16, samples: busy(), encoders: 6, highlight: 11, pausedAgoMs: 45_000 }).input));
		assert.equal(inspected.filter((text) => !text.startsWith("PAUSED")).join(" "), "1 min · Core 5 T1 · at -0:45");
	});

	it("no digit of the row crosses a seam when the words reach one", () => {
		const scene = buildStripScene(tilesFixture({ labels: CORES16, samples: busy(), encoders: 6, highlight: 31, pausedAgoMs: 45_000 }).input);
		const words = scene.prims.filter((p): p is Extract<Prim, { k: "text" }> => p.k === "text" && p.layer === "rows");
		assert.ok(words.some((w) => w.text.includes("Core 15 T1")), JSON.stringify(words.map((w) => w.text)));
		const right = (w: { size: number; weight: 600 | 700 }, text: string): number => (text === "" ? 0 : inkEdges([{ text, fontSize: w.size, fontWeight: w.weight }], "start", 0).right);
		for (const w of words) {
			for (const m of w.text.matchAll(/[-+]?\d[\d.,:]*/g)) {
				const l = w.x + right(w, w.text.slice(0, m.index));
				const r = w.x + right(w, w.text.slice(0, m.index + m[0].length));
				for (const seam of seamsIn(0, 1200)) assert.ok(r <= seam || l >= seam, `"${m[0]}" of "${w.text}" inks ${l.toFixed(1)} to ${r.toFixed(1)} across ${seam}`);
			}
		}
	});

	it("Names off draws no name; a grid of names, and a tile that names no core in a grid of both, keep their row", () => {
		const off = rowTexts(buildStripScene(tilesFixture({ labels: CORES16, samples: busy(), encoders: 6, highlight: 11, overlays: { legend: false } }).input));
		assert.ok(off.includes("1 min"), JSON.stringify(off));
		const clocks = Array.from({ length: 16 }, (_, i) => `Core ${i} Clock (perf #${i})`);
		const grid = rowTexts(buildStripScene(tilesFixture({ labels: clocks, unit: "MHz", samples: tilesSamples(16, () => 4000), encoders: 6, highlight: 3 }).input));
		assert.ok(grid.includes("1 min"), JSON.stringify(grid));
		const both = [...threadLabels(4), "Total CPU Usage"];
		const named = rowTexts(buildStripScene(tilesFixture({ labels: both, samples: tilesSamples(9, () => 40), encoders: 6, highlight: 8 }).input));
		assert.ok(named.includes("1 min"), JSON.stringify(named));
	});
});

describe("Tiles: the highlight, inspect, limits and a missing reading", () => {
	it("a highlighted reading: its tile's border and a small tab outside it in the highlight color; its line keeps the ramp", () => {
		const fx = tilesFixture({ labels: CORES16, samples: busy(), encoders: 6, highlight: 9 });
		const scene = buildStripScene(fx.input);
		const tiles = tilesOfInput(fx.input);
		const t = tiles.find((k) => k.index === 9) as Tile;
		const border = cellsOf(scene).find((p) => p.layer === "marks" && attrOf(p.paint, "fill") === "none");
		assert.ok(border !== undefined, "a border");
		const color = attrOf(border.paint, "stroke") as string;
		assert.deepEqual(rectsOf(border), [[t.x0 + 0.5, t.y0 + 0.5, t.x1 - t.x0 - 1, t.y1 - t.y0 - 1]]);
		const tab = cellsOf(scene).find((p) => p.layer === "marks" && attrOf(p.paint, "fill") === color);
		assert.ok(tab !== undefined, "a tab");
		for (const [x, y, w, h] of rectsOf(tab)) {
			assert.ok((x as number) >= t.x0 && (x as number) + (w as number) <= t.x1, "under its own column");
			assert.ok((y as number) + (h as number) <= t.y0 || (y as number) >= t.y1, "outside the tile");
			assert.ok((w as number) <= 18 && (h as number) <= 3, "small");
		}
		for (const s of skeinsOf(scene)) assert.ok(!s.attrs.includes(color), "no line in the highlight color");
		// Home: nothing marks a lead.
		const home = buildStripScene(tilesFixture({ labels: CORES16, samples: busy(), encoders: 6 }).input);
		assert.ok(!cellsOf(home).some((p) => p.layer === "marks"), "no border, tab or bar at home on calm values");
		const lit = wordsOf(scene, 700).find((w) => w.bx0 >= t.x0 && w.bx1 <= t.x1 && w.y > t.y0 && w.y < t.y1);
		assert.ok(lit !== undefined, "the highlighted tile's value");
		assert.deepEqual(wordsOf(scene).filter((w) => w.fill === lit.fill).map((w) => w.text).sort(), [lit.text, "4"].sort(), "only the highlighted tile's number and value take its color");
		assert.ok(!wordsOf(home).some((w) => w.fill === lit.fill), "no word in the highlight color at home");
	});

	it("a highlighted top tile's tab points at it: above it, or with Strip Screens on its top edge, never under the tile below", () => {
		const tabOf = (screens?: number): { t: Tile; tab: number[] } => {
			const fx = tilesFixture({ labels: CORES16, samples: busy(), encoders: 6, highlight: 6, ...(screens === undefined ? {} : { screens }) });
			const scene = buildStripScene(fx.input);
			const t = tilesOfInput(fx.input).find((k) => k.index === 6) as Tile;
			assert.equal(t.slot, 0, "Core 3 T0 is the column's top tile");
			const border = cellsOf(scene).find((p) => p.layer === "marks" && attrOf(p.paint, "fill") === "none") as CellsPrim;
			const color = attrOf(border.paint, "stroke") as string;
			const tabs = cellsOf(scene)
				.filter((p) => p.layer === "marks" && attrOf(p.paint, "fill") === color)
				.flatMap(rectsOf);
			assert.equal(tabs.length, 1, "one tab");
			return { t, tab: tabs[0] as number[] };
		};
		const plain = tabOf();
		const [x, y, w, h] = plain.tab as [number, number, number, number];
		assert.ok(x >= plain.t.x0 && x + w <= plain.t.x1 && y + h <= plain.t.y0, "above the tile while rows 0 to 3 are free");
		for (const screens of [2, 6]) {
			const { t, tab } = tabOf(screens);
			const [sx, sy, sw, sh] = tab as [number, number, number, number];
			assert.ok(sx >= t.x0 && sx + sw <= t.x1, `${screens} screens: over its own column`);
			assert.ok(sy >= t.y0 && sy + sh <= t.y0 + 4, `${screens} screens: on the tile's top edge (${sy}, ${sh}), clear of the position line's rows`);
			assert.ok(sh <= 3 && sw <= 18, "small");
		}
	});

	it("inspecting: one cursor at the same moment in every tile, and the tile values read that moment", () => {
		// Every reading steps from 10 to 90 halfway through the minute.
		const samples = tilesSamples(32, (_i, t) => (t < 40_000 ? 10 : 90));
		const late = buildStripScene(tilesFixture({ labels: CORES16, samples, encoders: 6, pausedAgoMs: 5_000 }).input);
		assert.deepEqual([...new Set(wordsOf(late, 700).map((w) => w.text))], ["90"]);
		const fx = tilesFixture({ labels: CORES16, samples, encoders: 6, pausedAgoMs: 45_000 });
		const scene = buildStripScene(fx.input);
		assert.deepEqual([...new Set(wordsOf(scene, 700).map((w) => w.text))], ["10"], "the values at the cursor");
		const tiles = tilesOfInput(fx.input);
		const cursor = cellsOf(scene).find((p) => p.layer === "marks" && rectsOf(p).length === 32);
		assert.ok(cursor !== undefined, "a cursor in every tile");
		const at = rectsOf(cursor).map(([x, y]) => {
			const t = tiles.find((k) => inTile(k, x as number, (y as number) + 1)) as Tile;
			return ((x as number) - t.x0) / (t.x1 - t.x0);
		});
		for (const r of at) assert.ok(Math.abs(r - (at[0] as number)) <= 0.02, `${r} vs ${at[0]}`);
		assert.ok((at[0] as number) > 0.15 && (at[0] as number) < 0.4, `45 s back of 60 sits in the left part: ${at[0]}`);
		assert.ok(scene.prims.some((p) => p.k === "text" && p.text.startsWith("PAUSED")));
		assert.ok(scene.prims.some((p) => p.k === "text" && p.text.includes("at -0:45")), "the bottom row says the moment");
	});

	it("limits: no limit line crosses a tile; a tile past warn or crit takes a bar whose size says the level and a 1 px outline in the alert color, and every number stays clear", () => {
		const fx = tilesFixture({ labels: CORES16, samples: tilesSamples(32, (i) => (i === 0 ? 95 : i === 1 ? 75 : 20)), encoders: 6, limits: { warn: 70, crit: 90 } });
		const scene = buildStripScene(fx.input);
		const { warn, crit } = fx.input.alertColors;
		const tiles = tilesOfInput(fx.input);
		const bars = (color: string) => barsOf(scene, color);
		const t0 = tiles.find((k) => k.index === 0) as Tile;
		const t1 = tiles.find((k) => k.index === 1) as Tile;
		assert.deepEqual(bars(crit), [[t0.x0 + 1, t0.y1 - 7, t0.x1 - t0.x0 - 2, 6]], "crit: a 6 px bar along the tile's bottom");
		assert.deepEqual(bars(warn), [[t1.x0 + 1, t1.y1 - 4, t1.x1 - t1.x0 - 2, 3]], "warn: a 3 px bar");
		const outlines = (color: string) => outlinesOf(scene, color);
		const frameOf = (t: Tile): number[] => [t.x0 + 0.5, t.y0 + 0.5, t.x1 - t.x0 - 1, t.y1 - t.y0 - 1];
		assert.deepEqual(outlines(crit).flatMap(rectsOf), [frameOf(t0)], "crit: an outline on the tile's frame");
		assert.deepEqual(outlines(warn).flatMap(rectsOf), [frameOf(t1)], "warn: an outline on the tile's frame");
		// The only base cells in an alert color are those frames: nothing crosses a tile.
		for (const p of cellsOf(scene)) if (p.layer === "base" && (p.paint.includes(warn) || p.paint.includes(crit))) assert.equal(p.round, TILES.radius, `no limit line under the graphs: ${p.paint}`);
		for (const p of [...outlines(crit), ...outlines(warn)]) {
			assert.equal(attrOf(p.paint, "stroke-width"), undefined, "1 px, the stroke's default");
			assert.equal(p.round, TILES.radius, "rounded as the frame is");
		}
		assert.equal(framesOf(scene).flatMap(rectsOf).length, 32, "every tile keeps its frame, so nothing moves");
		assert.deepEqual(wordsOf(scene, 700).map((w) => w.text).sort(), ["75", "95"], "the two past a limit print their values, the calm ones none");
		// Every number stays clear: an alert's fill is the bar alone, under the words of its tile.
		for (const [t, bar] of [[t0, bars(crit)[0]], [t1, bars(warn)[0]]] as const) {
			for (const word of wordsOf(scene)) if (inTile(t, word.x, word.y)) assert.ok(word.y <= (bar as number[])[1]!, `"${word.text}" clear of the bar`);
		}
		// Calm values under the same limits: no mark at all.
		const calm = buildStripScene(tilesFixture({ labels: CORES16, samples: tilesSamples(32, () => 20), encoders: 6, limits: { warn: 70, crit: 90 } }).input);
		assert.ok(!cellsOf(calm).some((p) => p.layer === "marks"), "no outline or bar while no reading is past a limit");
	});

	it("a tile past a limit writes its corners once: its own frame, with the frames' fill and the alert's stroke, one path a level", () => {
		const limits = { warn: 80, crit: 95 };
		for (const look of [{}, { background: "glass" }, { background: "nebula" }, { theme: "paper" }] as const) {
			const past = tilesFixture({ labels: CORES16, samples: tilesSamples(32, (i) => (i % 2 ? 99 : 85)), encoders: 6, limits, ...look });
			const scene = buildStripScene(past.input);
			const id = JSON.stringify(look);
			const rounded = cellsOf(scene).filter((p) => p.round !== undefined);
			assert.equal(rounded.flatMap(rectsOf).length, 32, `${id}: one rounded box a tile, however many are past a limit`);
			assert.ok(rounded.every((p) => p.layer === "base"), `${id}: under the graph, not a second box over it`);
			const calm = buildStripScene(tilesFixture({ labels: CORES16, samples: tilesSamples(32, () => 20), encoders: 6, limits, ...look }).input);
			const frame = (framesOf(calm)[0] as CellsPrim).paint;
			const boxes = (s: LogicalScene): string[] => framesOf(s).flatMap(rectsOf).map(String).sort();
			assert.deepEqual(boxes(scene), boxes(calm), `${id}: crossing a limit moves no box`);
			for (const color of [past.input.alertColors.warn, past.input.alertColors.crit]) {
				const paths = outlinesOf(scene, color);
				assert.equal(paths.length, 1, `${id}: one path a level`);
				assert.equal(rectsOf(paths[0] as CellsPrim).length, 16);
				for (const attr of ["fill", "fill-opacity"]) assert.equal(attrOf((paths[0] as CellsPrim).paint, attr), attrOf(frame, attr), `${id}: the frames' own ${attr}`);
				assert.equal(attrOf((paths[0] as CellsPrim).paint, "stroke-opacity"), undefined, `${id}: the alert's stroke at full strength`);
				assert.equal(attrOf((paths[0] as CellsPrim).paint, "stroke-width"), undefined, `${id}: 1 px, the stroke's default`);
			}
		}
	});

	it("a line rising at a tile's right end leaves the outline's right edge its exact alert color, where the line's glow would reach it", async () => {
		for (const theme of ["ember", "graphite"] as const) {
			const end = 70_000;
			const fx = tilesFixture({ labels: CORES16, samples: tilesSamples(32, (i, t) => (t < end ? busyCpu(i, t) : i % 2 ? 99 : 85)), encoders: 6, background: "theme", theme, screens: 6, limits: { warn: 80, crit: 95 } });
			const r = await renderCase({ id: `right edge ${theme}`, input: fx.input });
			assert.equal(r.slices.bucketPx, 2, "the finest buckets, where the last point sits nearest the edge");
			const worst: string[] = [];
			for (const t of tilesOfInput(fx.input)) {
				if (t.index === 31) continue; // LIVE sits over the last tile's corner, as it does on every frame.
				const color = t.index % 2 ? fx.input.alertColors.crit : fx.input.alertColors.warn;
				const want = [1, 3, 5].map((o) => parseInt(color.slice(o, o + 2), 16));
				for (let y = t.y0 + 3; y < t.y1 - 3; y++) {
					const at = (y * r.reference.width + t.x1 - 1) * 4;
					const off = Math.max(...want.map((v, c) => Math.abs((r.reference.data[at + c] as number) - v)));
					if (off > 2) worst.push(`tile ${t.index} y${y} off by ${off}`);
				}
			}
			assert.deepEqual(worst, [], `${theme}: ${worst.length} px`);
		}
	});

	it("a highlighted tile past a limit keeps both readable: the outline takes the alert color, the highlight keeps its tab and its value's color", () => {
		const limits = { warn: 70, crit: 90 };
		const samples = (at: number) => tilesSamples(32, (i) => (i === at ? 95 : 20));
		// A calm tile highlighted beside one past a limit: each its own mark.
		const beside = tilesFixture({ labels: CORES16, samples: samples(5), encoders: 6, limits, highlight: 7 });
		const besideScene = buildStripScene(beside.input);
		const { crit } = beside.input.alertColors;
		const borders = (scene: LogicalScene): CellsPrim[] => cellsOf(scene).filter((p) => p.layer === "marks" && attrOf(p.paint, "fill") === "none");
		const lit = borders(besideScene).find((p) => attrOf(p.paint, "stroke") !== crit);
		assert.ok(lit !== undefined, "a calm highlighted tile keeps its highlight border");
		const color = attrOf(lit.paint, "stroke") as string;
		assert.equal(attrOf(lit.paint, "stroke-width"), "1.5");
		assert.equal(outlinesOf(besideScene, crit).length, 1, "and the tile past the limit its outline");
		// The same tile both: the alert's outline on its frame, the highlight's tab outside it.
		const fx = tilesFixture({ labels: CORES16, samples: samples(5), encoders: 6, limits, highlight: 5 });
		const scene = buildStripScene(fx.input);
		const t = tilesOfInput(fx.input).find((k) => k.index === 5) as Tile;
		assert.deepEqual(borders(scene), [], "no highlight border over the outline");
		assert.deepEqual(outlinesOf(scene, crit).flatMap(rectsOf), [[t.x0 + 0.5, t.y0 + 0.5, t.x1 - t.x0 - 1, t.y1 - t.y0 - 1]], "the outline takes the alert color");
		assert.deepEqual(barsOf(scene, crit), [[t.x0 + 1, t.y1 - 7, t.x1 - t.x0 - 2, 6]], "the bar stays");
		const tabs = cellsOf(scene).filter((p) => p.layer === "marks" && attrOf(p.paint, "fill") === color).flatMap(rectsOf);
		assert.equal(tabs.length, 1, "one tab in the highlight color");
		const [x, y, w, h] = tabs[0] as [number, number, number, number];
		assert.ok(x >= t.x0 && x + w <= t.x1 && y >= t.y1 && w <= 18 && h <= 3, "under its own column, outside the tile");
		const value = wordsOf(scene, 700).find((v) => v.bx0 >= t.x0 && v.bx1 <= t.x1 && v.y > t.y0 && v.y < t.y1);
		assert.ok(value !== undefined, "the highlighted tile's value");
		assert.notEqual(value.fill, crit, "the value never takes the alert color");
		assert.deepEqual(wordsOf(scene).filter((v) => v.fill === value.fill).map((v) => v.text).sort(), [value.text, "2"].sort(), "only the highlighted tile's number and value take the highlight color");
		// A top tile under Strip Screens has its tab on its top edge: the tab draws over the outline.
		const top = buildStripScene(tilesFixture({ labels: CORES16, samples: samples(4), encoders: 6, limits, highlight: 4, screens: 6 }).input);
		const cells = cellsOf(top);
		const outlineAt = cells.findIndex((p) => p.round !== undefined && attrOf(p.paint, "stroke") === crit);
		const tabAt = cells.findIndex((p) => p.layer === "marks" && attrOf(p.paint, "fill") === color);
		assert.ok(outlineAt >= 0 && tabAt > outlineAt, `the tab (${tabAt}) after the outline (${outlineAt})`);
	});

	it("a missing reading is an empty dashed tile; the bottom row counts it", () => {
		const fx = tilesFixture({ labels: CORES16, samples: busy(), encoders: 6, missing: [6] });
		const scene = buildStripScene(fx.input);
		const t = tilesOfInput(fx.input).find((k) => k.index === 6) as Tile;
		const dashed = cellsOf(scene).filter((p) => p.paint.includes("stroke-dasharray"));
		assert.deepEqual(dashed.flatMap(rectsOf), [[t.x0 + 0.5, t.y0 + 0.5, t.x1 - t.x0 - 1, t.y1 - t.y0 - 1]]);
		assert.equal(framesOf(scene).flatMap(rectsOf).length, 31);
		for (const s of skeinsOf(scene)) for (const pts of s.lines) for (let i = 0; i < pts.length; i += 2) assert.ok(!inTile(t, pts[i] as number, pts[i + 1] as number) || (pts[i] as number) <= t.x0 || (pts[i] as number) >= t.x1, "no line in the missing tile");
		assert.ok(!wordsOf(scene, 700).some((w) => w.x > t.x0 && w.x < t.x1 && w.y < t.y1 && w.y > t.y0), "no value in it");
		assert.ok(scene.prims.some((p) => p.k === "text" && p.text.includes("1 not found")));
	});
});

// ---- gestures --------------------------------------------------------------------

describe("Tiles: gestures as Group has them, a touch inspects", () => {
	const routing = (mode: "live" | "paused" = "live"): StripRouting => ({ layout: "whole", encoders: 6, sharedWindow: true, bucketPx: 2, panes: [{ style: "group", seriesCount: 0, mode, group: { count: 32, draw: "tiles", current: true, grid: [8, 8] } }] });
	const tap = (column: number, x: number, hold = false, mode: "live" | "paused" = "live") => routeStripInput(routing(mode), IDLE_GESTURE, { kind: "touchTap", column, at: 0, hold, tapPos: [x, 50] }).action;

	it("a plain turn steps the highlight; a pressed turn changes the window, paused it moves the cursor", () => {
		const turn = (pressed: boolean, mode: "live" | "paused" = "live") => routeStripInput(routing(mode), pressed ? { downAt: 0, rotatedWhileDown: false } : IDLE_GESTURE, { kind: "dialRotate", column: 2, at: 10, ticks: 1, pressed }).action;
		assert.deepEqual(turn(!GROUP_TURN_PICKS_READING), { kind: "groupStep", pane: 0, step: 1 });
		assert.deepEqual(turn(GROUP_TURN_PICKS_READING), { kind: "window", pane: 0, step: 1, scope: "shared" });
		assert.deepEqual(turn(GROUP_TURN_PICKS_READING, "paused"), { kind: "cursor", pane: 0, delta: 1 });
	});

	it("a touch inspects at the moment under it in the tile under it, the first dial included (no readout slot); a long touch goes home", () => {
		const tiles = tilesOf(tileShapeOf(CORES16), { x0: 0, x1: 1200 });
		const first = tiles[0] as Tile;
		const newest = tap(0, first.x1 - 2);
		assert.deepEqual(newest, { kind: "inspect", pane: 0, cursor: 0 }, "the right end of a tile is the newest moment");
		const oldest = tap(0, first.x0 + 2) as { kind: string; cursor: number };
		assert.equal(oldest.kind, "inspect");
		assert.ok(oldest.cursor >= first.x1 - first.x0 - 6, `the left end is the oldest: ${oldest.cursor}`);
		// The same place in a tile on another dial is the same moment.
		const t = tiles.find((k) => k.column === 9) as Tile;
		assert.equal((tap(Math.floor((t.x0 + 30) / SLICE_W), (t.x0 + 30) % SLICE_W) as { cursor: number }).cursor, (tap(0, first.x0 + 30) as { cursor: number }).cursor);
		assert.equal(tap(3, 50, false, "paused")?.kind, "cursorTo");
		assert.deepEqual(tap(3, 50, true), { kind: "groupHome", pane: 0, live: true });
	});

	it("the dials' hints say what each gesture does on Tiles; a long touch has a hint only while a tile is highlighted", () => {
		const live = (highlighted: boolean) => stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "live", seriesChoice: true, group: true, style: "group", tiles: true, highlighted });
		const rotate = GROUP_TURN_PICKS_READING ? "Reading · pressed: window" : "Time window · pressed: reading";
		assert.deepEqual(live(true), { rotate, push: "Inspect", touch: "Inspect here", longTouch: "Clear highlight" });
		assert.deepEqual(live(false), { rotate, push: "Inspect", touch: "Inspect here" }, "nothing highlighted: no long touch hint at all");
		assert.ok(!("longTouch" in live(false)), "the key is left out, so the app shows no line for it");
		const rows = stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "live", seriesChoice: true, group: true, style: "group" });
		assert.equal(rows.longTouch, "Top reading", "the other Group views keep theirs");
		const paused = stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "paused", seriesChoice: true, group: true, style: "group", tiles: true });
		assert.deepEqual([paused.push, paused.touch, paused.longTouch], ["Back to live", "Move cursor here", "Back to live"]);
	});
});

// ---- the runtime -------------------------------------------------------------------

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

/** A + XL whole strip on a 16-core, 32-thread CPU, polled every second. */
function runtime() {
	const clock = new FakeClock();
	const panel: unknown[] = [];
	const settings = new Map<string, Record<string, unknown>>();
	const history = new HistoryStore({ now: () => clock.t });
	const labels = [...CORES16, "Total CPU Usage", "Max CPU/Thread Usage"];
	let poll = 0;
	const snap = (): SensorSnapshot => {
		const readings: Reading[] = labels.map((label, i) => {
			const value = i < 32 ? busyCpu(i, poll * 2000) : 40;
			return { key: tilesKeyOf(i), type: SensorType.Usage, sensorIndex: 0, id: 0x100 + i, label, unit: "%", value, valueMin: value, valueMax: value, valueAvg: value };
		});
		return { pollTime: poll, version: 1, revision: 1, valueRevision: poll, sensors: [{ index: 0, id: 0xf0, instance: 0, name: "CPU [#0]: Example" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) } as SensorSnapshot;
	};
	let status: PollerStatus = { state: "ok", snapshot: snap(), source: "shared-memory" };
	const host: StripHost = {
		settingsOf: (c) => settings.get(c),
		stored: (c, d) => settings.set(c, d),
		claimChanged: () => {},
		status: () => status,
		history: {
			setInterest: (id, entries, options) => history.setInterest(id, entries, options),
			dropInterest: (id) => history.dropInterest(id),
			view: (key, window, width, now, linked) => history.view(key, window, width, now, linked),
			refused: (key, window) => history.refused(key, window),
			get revision() {
				return history.revision;
			}
		},
		panelContext: () => undefined,
		sendToPanel: (payload) => panel.push(payload)
	};
	const ctl = new StripController(host, { clock, capabilities: { get: () => deriveCapabilities({ type: 13, columns: 9, rows: 4 }) }, mintId: () => "0123456789abcdef0123456789abcdef" });
	const dials = Array.from({ length: 6 }, (_, c) => new Dial(`x${c}`, c));
	for (const d of dials) {
		settings.set(d.id, { readingKey: tilesKeyOf(0) });
		ctl.appear(d, { readingKey: tilesKeyOf(0) });
	}
	return {
		clock,
		dials,
		make(group: Record<string, unknown>): void {
			ctl.handlePi("x0", { event: "stripCreate", opId: "c", layout: "whole", patch: [{ op: "set", path: "panes.0.style", value: "group" }, { op: "set", path: "panes.0.group", value: group }] });
			clock.advance(MIN_FRAME_MS * 3);
		},
		tick(n = 1): void {
			for (let k = 0; k < n; k++) {
				poll++;
				clock.advance(2000);
				const s = snap();
				history.ingest({ kind: "ok", at: clock.t, snapshot: s, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 });
				status = { state: "ok", snapshot: s, source: "shared-memory" };
				ctl.onTick(status);
			}
			clock.advance(MIN_FRAME_MS * 3);
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
		/** The panel's list of gestures for a member's dial. */
		controls(): readonly (readonly [string, string])[] {
			const before = panel.length;
			ctl.handlePi("x1", { event: "stripGet", requestId: "s" });
			const state = panel.slice(before).find((p) => (p as { event?: string }).event === "stripState") as { group: { controls: [string, string][] } };
			return state.group.controls;
		},
		frame(): string {
			return dials.map((d) => d.feedback.at(-1) ?? "").join("\n");
		}
	};
}

describe("Tiles on the runtime: the readings a filter takes, laid out and driven on the strip", () => {
	it("a Tiles Group of the per-thread usages draws 32 tiles across the strip; a turn highlights one; a touch inspects; a long touch clears", () => {
		const rt = runtime();
		rt.make({ from: "filter", filter: "*Core * T? Usage", keys: [], view: "tiles" });
		rt.tick(40);
		const frame = rt.frame();
		assert.match(frame, /LIVE/);
		assert.doesNotMatch(frame, /of 32|max of/, "no readout line");
		assert.equal((frame.match(/q2 0 2 2/g) ?? []).length >= 32, true, "a rounded frame per tile");
		assert.doesNotMatch(frame, /stroke-width="1\.5"/, "nothing highlighted at home");
		assert.doesNotMatch(frame, /Core \d+ T\d/, "at home the bottom line names no thread");
		assert.ok(!("longTouch" in (rt.dials[1]?.triggers.at(-1) ?? {})), "nothing to clear at home: no long touch hint is sent");
		const blank = String.fromCharCode(0xa0);
		assert.deepEqual(rt.controls().at(-1), [blank, blank], "the panel's list: no long touch line, a blank row holds its height");
		assert.equal(rt.controls().length, 4);
		rt.turn(2, 3, !GROUP_TURN_PICKS_READING);
		assert.match(rt.frame(), /fill="none" stroke="#[0-9A-F]{6}" stroke-width="1\.5"/, "the third reading's tile takes the border");
		assert.match(rt.frame(), /· Core 1 T0</, "and the bottom line names it as HWiNFO does");
		const hint = rt.dials[1]?.triggers.at(-1);
		assert.equal(hint?.touch, "Inspect here");
		assert.equal(hint?.longTouch, "Clear highlight");
		assert.deepEqual(rt.controls().at(-1), ["longTouch", "Clear highlight"], "the panel's list says it too");
		rt.tap(0, 40, 30);
		assert.match(rt.frame(), /PAUSED/, "a touch on the first dial inspects: no readout slot sends it home");
		rt.tap(4, 50, 50, true);
		const back = rt.frame();
		assert.match(back, /LIVE/);
		assert.doesNotMatch(back, /stroke-width="1\.5"/, "a long touch clears the highlight and goes live");
		assert.ok(!("longTouch" in (rt.dials[1]?.triggers.at(-1) ?? {})), "cleared: no long touch hint again");
		assert.deepEqual(rt.controls().at(-1), [blank, blank], "cleared: the panel's list has no long touch line again");
	});
});

// ---- bytes and seams -----------------------------------------------------------------

describe("Tiles: every slice within the payload bound through the slicer's ladder", () => {
	const limitOf = (background: string): number => SLICE_PAYLOAD_LIMIT - (background === "nebula" || background === "stars" ? ART_PIECE_LIMIT : 0);
	/** Every thread swinging between idle and full load every poll: the
	 * most a minute of polls can draw. */
	const zigzag = (i: number, t: number): number => ((Math.round(t / 2000) + i) % 2 === 0 ? 3 + ((i * 7) % 10) : 88 + ((i * 3) % 12));

	it("the owner's deck (+ XL whole, Nebula, Graphite, 1 min) keeps the default buckets, busy or at its worst", () => {
		for (const value of [busyCpu, zigzag]) {
			const r = sliceStrip(tilesFixture({ labels: CORES16, samples: tilesSamples(32, value), encoders: 6, background: "nebula", theme: "graphite", screens: 6 }).input);
			assert.equal(r.bucketPx, 2, `${value.name}: ${r.maxBytes}`);
			assert.equal(r.coarsened, false);
			assert.ok(r.maxBytes <= limitOf("nebula"), `${r.maxBytes}`);
		}
	});

	it("the owner's 1 min frame sits under the slicer's return share with room to spare, so a burst that steps it comes back", () => {
		const r = sliceStrip(tilesFixture({ labels: CORES16, samples: tilesSamples(32, busyCpu), encoders: 6, background: "nebula", theme: "graphite", screens: 6 }).input);
		assert.equal(r.bucketPx, 2);
		assert.ok(r.maxBytes <= limitOf("nebula") * SLICE_RETURN_SHARE - 50, `${r.maxBytes} B, the return share ${limitOf("nebula") * SLICE_RETURN_SHARE} B`);
	});

	/** A window's history, then the first `past` tiles past a limit on the last poll, warn and crit in turn. */
	const burst = (value: (i: number, t: number) => number, past: number, seconds: number): TilesFixtureParams["samples"] => {
		const last = 10_000 + seconds * 1000;
		return tilesSamples(32, (i, t) => (t < last ? value(i, t) : i < past ? (i % 2 ? 99 : 85) : 20), seconds);
	};
	const WINDOWS = [["1m", 60], ["5m", 300], ["15m", 900]] as const;
	const LIMITS = { warn: 80, crit: 95 };

	it("every window, deck, layout and look stays within the bound and keeps its graph, with no limits and with adjacent tiles past one", () => {
		for (const [window, seconds] of WINDOWS) {
			for (const [layout, encoders] of [["whole", 6], ["whole", 4], ["split", 6], ["split", 4]] as const) {
				for (const background of ["nebula", "theme", "glass"] as const) {
					const check = (id: string, input: StripSceneInput): void => {
						const r = sliceStrip(input);
						assert.ok(r.maxBytes <= limitOf(background), `${id}: ${r.maxBytes}`);
						assert.notEqual(r.reduced, true, `${id}: the graph is kept`);
						for (const s of r.slices) if (s !== null) assert.ok(svgBytes(s) <= limitOf(background), id);
					};
					const at = `${window} ${layout} ${encoders} ${background}`;
					const deck = { labels: CORES16, window, layout, encoders, background };
					check(at, tilesFixture({ ...deck, samples: tilesSamples(32, zigzag, seconds) }).input);
					check(`${at} inspected, the most words a frame draws`, tilesFixture({ ...deck, samples: tilesSamples(32, zigzag, seconds), pausedAgoMs: 20_000 }).input);
					for (const [name, value] of [["busy", busyCpu], ["zigzag", zigzag]] as const) {
						for (const past of [12, 32]) check(`${at} ${name}, ${past} past a limit`, tilesFixture({ ...deck, samples: burst(value, past, seconds), limits: LIMITS }).input);
					}
				}
			}
		}
	});

	it("four threads a core at 1 min, every tile past a limit, keeps the graph it has with none past", () => {
		const r = (past: number) => sliceStrip(tilesFixture({ labels: threadLabels(8, 4), samples: tilesSamples(32, (i, t) => (t < 70_000 ? busyCpu(i, t) : i < past ? 99 : 20)), encoders: 6, background: "nebula", theme: "ember", screens: 6, limits: LIMITS }).input);
		assert.notEqual(r(0).reduced, true);
		assert.notEqual(r(32).reduced, true, `${r(32).maxBytes} B`);
		assert.equal(r(32).bucketPx, r(0).bucketPx);
		const inspected = sliceStrip(tilesFixture({ labels: threadLabels(8, 4), samples: tilesSamples(32, busyCpu), encoders: 6, background: "nebula", theme: "ember", screens: 6, pausedAgoMs: 20_000 }).input);
		assert.equal(inspected.reduced === true, false, `inspected: ${inspected.maxBytes} B`);
		assert.equal(inspected.bucketPx, r(0).bucketPx, `inspected: ${inspected.maxBytes} B`);
	});

	it("a burst of alerts on the owner's Whole deck holds every window's buckets, comes back to the calm frame, and costs what its marks and values take", () => {
		for (const [window, seconds] of WINDOWS) {
			const frame = (past: number): StripSceneInput => tilesFixture({ labels: CORES16, samples: burst(busyCpu, past, seconds), window, encoders: 6, background: "nebula", theme: "ember", screens: 6, limits: LIMITS }).input;
			const calm = sliceStrip(frame(0));
			let held: StripSlices["bucketPx"] | undefined = calm.bucketPx;
			for (const past of [6, 12, 16, 32, 0]) {
				const r = sliceStrip(frame(past), held, true);
				held = r.bucketPx;
				assert.equal(r.bucketPx, calm.bucketPx, `${window}, ${past} past a limit: ${r.maxBytes} B`);
				assert.ok(r.maxBytes - calm.maxBytes <= 600, `${window}, ${past} past a limit costs ${r.maxBytes - calm.maxBytes} B`);
				assert.ok(r.maxBytes <= limitOf("nebula"), `${window}, ${past} past a limit: ${r.maxBytes} B`);
			}
			assert.equal(sliceStrip(frame(0), held, true).maxBytes, calm.maxBytes, `${window}: calm again is the calm frame`);
		}
	});

	it("a tile cut by a seam is square at the slice's bleed, outside its view: no corner where the tile goes on", () => {
		const p: CellsPrim = { k: "cells", layer: "base", rects: [180.5, 4.5, 69, 44], paint: 'fill="#000000"', round: 2 };
		const [left] = cullPrim(p, -2, 202) as CellsPrim[];
		const [right] = cullPrim(p, 198, 402) as CellsPrim[];
		const d = (q: Prim | undefined, dx: number): string => emitPrim(q as Prim, dx);
		assert.equal((d(left, 0).match(/q/g) ?? []).length, 2, "the left slice: the tile's left corners only");
		assert.match(d(left, 0), /^<path d="M182\.5 4\.5h19\.5v44h-19\.5q/, "square at the bleed, x 202");
		assert.equal((d(right, 200).match(/q/g) ?? []).length, 2, "the right slice: its right corners only");
		assert.match(d(right, 200), /^<path d="M-2 4\.5/);
		assert.equal((d(p, 0).match(/q/g) ?? []).length, 4, "whole in the full frame");
	});

	it("stitched slices draw what the full-width frame draws, on the + XL and the +, whole and split", async () => {
		for (const [layout, encoders] of [["whole", 6], ["split", 6], ["whole", 4]] as const) {
			for (const background of ["theme", "glass"] as const) {
				const c = { id: `tiles ${layout} ${encoders} ${background}`, input: tilesFixture({ labels: CORES16, samples: tilesSamples(32, (i, t) => (i === 5 ? 96 : i === 9 ? 84 : busyCpu(i, t))), layout, encoders, background, highlight: 5, missing: [12], limits: { warn: 80, crit: 95 } }).input };
				const r = await renderCase(c, true);
				const d = diffRasters(r.reference, r.stitched, 2);
				assert.ok(d.maxDiff <= 40 && d.over <= 32, `${c.id}: max ${d.maxDiff}, ${d.over} px over (worst ${JSON.stringify(d.worst)})`);
			}
		}
	});

	it("a straight run's inner points go, a spike's tip stays", () => {
		assert.deepEqual(straight([0, 10, 2, 10, 4, 10, 6, 10]), [0, 10, 6, 10]);
		assert.deepEqual(straight([0, 10, 2, 12, 4, 14, 6, 10]), [0, 10, 4, 14, 6, 10]);
		assert.deepEqual(straight([0, 10, 0, 2, 0, 10, 2, 10]), [0, 10, 0, 2, 0, 10, 2, 10], "a vertical spike and back keeps its tip");
		assert.deepEqual(straight([0, 10, 0, 10, 2, 10]), [0, 10, 2, 10]);
	});
});
