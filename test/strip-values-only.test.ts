/**
 * Large values only (StripPaneV1.readout "only"): no graph, so the stored
 * Graph means nothing, and every ticked reading draws.
 *
 * - The stored style: the five styles a Readout applies to draw the same
 *   bytes and ask the same history; a Lanes tap picks no lane, Heat offers the
 *   same choice as the rest.
 * - The readings: every stored one draws, up to two a dial slot.
 * - Hue: a reading with no color of its own takes its place in the series'
 *   hues whatever Graph is stored, so the theme's accent never stands for a
 *   normal digit: on Ember the accent sits next to the warn color.
 * - Inspecting: PAUSED and the time meet no other word, on any layout, and a
 *   trend keeps both its scale's ends.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixtureCase, makeView, READOUT_GEOMETRIES, type FixtureCase } from "../scripts/lib/strip-fixtures";
import { besideOf, onlyTrendBuckets, SLICE_W, spreadCells, type SpreadCell } from "../src/strip/geometry";
import { hasSeriesChoice, routeStripInput, type StripRouting } from "../src/strip/input";
import { IDLE_GESTURE } from "../src/gestures";
import type { LinePrim, TextPrim } from "../src/strip/prims";
import { digitMetrics, planSpread, type SpreadItem } from "../src/strip/readout";
import { buildStripScene, historyWidthFor, textInkBox, type StripSceneInput } from "../src/strip/scene";
import type { StripStyle } from "../src/strip/settings";
import { sliceStrip, SLICE_PAYLOAD_LIMIT } from "../src/strip/slicer";
import { ART_PIECE_LIMIT } from "../src/ui/deck-art";
import { ciede2000 } from "../src/ui/color-difference";
import { setFaceFont } from "../src/ui/face-font";
import { inkEdges } from "../src/ui/format";

setFaceFont("tahoma");

const ONLY_STYLES: readonly StripStyle[] = ["trend", "area", "compare", "lanes", "heat"];
const SIX = ["cpu", "gpu", "hot", "load", "power", "fan"];

function only(series: readonly string[], opts: { encoders?: 4 | 6; layout?: "whole" | "split"; theme?: string; background?: "theme" | "nebula"; paused?: boolean; names?: boolean } = {}): FixtureCase {
	const extra = { readout: "only" as const, series: [...series], ...(opts.names === undefined ? {} : { names: opts.names }) };
	return fixtureCase({ styles: ["trend", "trend"], layout: opts.layout ?? "whole", encoders: opts.encoders ?? 6, background: opts.background ?? "theme", accent: false, ...(opts.theme === undefined ? {} : { theme: opts.theme }), ...(opts.paused === undefined ? {} : { paused: opts.paused }), extras: [extra, extra] });
}

/** The same scene with `style` stored on its panes, nothing else. */
function stored(input: StripSceneInput, style: StripStyle): StripSceneInput {
	const [p0, p1] = input.config.panes;
	return { ...input, config: { ...input.config, panes: [{ ...p0, style }, { ...p1, style }] } };
}

const digits = (input: StripSceneInput): TextPrim[] => buildStripScene(input).prims.filter((p): p is TextPrim => p.k === "text" && /^\d+\.\d+$|^\d{4}$/.test(p.text) && p.weight === 700);

describe("Large values only: the stored Graph means nothing", () => {
	for (const series of [["cpu"], ["cpu", "gpu"], ["cpu", "gpu", "hot"], SIX.slice(0, 4), SIX]) {
		it(`${series.length} reading${series.length === 1 ? "" : "s"}: every style draws the same bytes`, () => {
			const base = only(series).input;
			const bytes = sliceStrip(base).slices.join("|");
			for (const style of ONLY_STYLES) assert.equal(sliceStrip(stored(base, style)).slices.join("|"), bytes, style);
		});
		it(`${series.length} reading${series.length === 1 ? "" : "s"}: every style asks the same history`, () => {
			const base = only(series).input;
			const width = historyWidthFor(base.config, 6, 0, 2);
			for (const style of ONLY_STYLES) assert.equal(historyWidthFor(stored(base, style).config, 6, 0, 2), width, style);
		});
	}

	it("a Meters, Events, Group or Ambient pane keeps a stored readout unused", () => {
		for (const style of ["meters", "events"] as const) {
			const plain = fixtureCase({ styles: [style], layout: "whole", encoders: 6, background: "theme", accent: false }).input;
			const kept = fixtureCase({ styles: [style], layout: "whole", encoders: 6, background: "theme", accent: false, extras: [{ readout: "only" }] }).input;
			assert.equal(sliceStrip(kept).slices.join("|"), sliceStrip(plain).slices.join("|"), style);
		}
	});

	it("a tap picks no lane and a pressed turn chooses the same way whatever Graph is stored", () => {
		for (const style of ONLY_STYLES) assert.equal(hasSeriesChoice({ style, seriesCount: 2, readout: "only", mode: "live" }), true, style);
		const routing: StripRouting = { layout: "whole", encoders: 6, sharedWindow: true, bucketPx: 2, panes: [{ style: "lanes", seriesCount: 2, readout: "only", mode: "live" }] };
		const routed = routeStripInput(routing, IDLE_GESTURE, { kind: "touchTap", column: 0, at: 1000, tapPos: [50, 90], hold: false });
		assert.deepEqual(routed.action, { kind: "inspect", pane: 0, cursor: 0 });
	});
});

describe("Large values only: every ticked reading draws", () => {
	for (const n of [1, 2, 3, 4, 5, 6]) {
		it(`${n} on a whole + XL, stored as Trend, Compare or Heat`, () => {
			const base = only(SIX.slice(0, n)).input;
			for (const style of ["trend", "compare", "heat"] as const) assert.equal(digits(stored(base, style)).length, n, style);
		});
	}

	it("one reading is enough, whatever Graph is stored", () => {
		for (const style of ONLY_STYLES) assert.equal(digits(stored(only(["cpu"]).input, style)).length, 1, style);
	});

	it("a half of a + draws two a dial slot; the rest stay saved", () => {
		const c = only(SIX, { encoders: 4, layout: "split" });
		const drawn = digits(c.input).filter((p) => p.x < 400);
		assert.equal(drawn.length, 4);
	});
});

describe("Large values only: a reading's hue does not depend on the stored Graph", () => {
	it("the first reading takes the first series hue, never the theme's accent", () => {
		const c = only(["cpu", "gpu"], { theme: "ember", background: "nebula" }).input;
		const fills = new Set(digits(c).map((p) => p.fill));
		assert.ok(!fills.has(c.palette.accent), `${[...fills].join(" ")} against ${c.palette.accent}`);
	});

	it("on Ember a normal digit stands well apart from a warn digit, in every place of the hues", () => {
		const c = only(SIX, { theme: "ember", background: "nebula" }).input;
		const apart = digits(c).map((p) => ciede2000(p.fill, c.alertColors.warn));
		console.error(`dE00 of each normal digit to warn on Nebula Ember: ${apart.map((d) => d.toFixed(1)).join(" ")}`);
		assert.equal(apart.length, 6);
		for (const d of apart) assert.ok(d >= 20, d.toFixed(1));
	});
});

/** The scene's prims with one reading's value and window replaced. */
function withValue(input: StripSceneInput, index: number, value: number): StripSceneInput {
	const pane = input.panes[0] as StripSceneInput["panes"][number];
	const series = pane.series.map((s, i) => {
		if (i !== index || s.history === undefined) return s;
		const history = makeView({ windowMs: s.history.windowMs, widthPx: s.history.widthPx, unit: s.unit, value: () => value });
		return { ...s, current: value, history };
	});
	return { ...input, panes: [{ ...pane, series }, ...input.panes.slice(1)] };
}

const texts = (input: StripSceneInput): TextPrim[] => buildStripScene(input).prims.filter((p): p is TextPrim => p.k === "text");
const inkRight = (p: TextPrim): number => inkEdges([{ text: p.text, fontSize: p.size, fontWeight: p.weight }], p.anchor, p.x).right;
const insideOneSlice = (p: TextPrim): boolean => {
	const e = inkEdges([{ text: p.text, fontSize: p.size, fontWeight: p.weight }], p.anchor, p.x);
	return Math.floor(e.left / SLICE_W) === Math.floor((e.right - 0.01) / SLICE_W);
};
const lines = (input: StripSceneInput): LinePrim[] => buildStripScene(input).prims.filter((p): p is LinePrim => p.k === "line");

describe("spreadCells: a pane's readings in equal cells, each number in a dial slot", () => {
	const xl = { x0: 0, x1: 1200 };
	const columns = (n: number, prefer: "first" | "last", present?: boolean[]): number[] => spreadCells(xl, n, prefer, present).map((c) => c.column);
	it("the cells cover the pane", () => {
		for (const n of [1, 2, 3, 4, 5, 6]) {
			const cells = spreadCells(xl, n, "first");
			assert.equal(cells[0]?.x0, 0);
			assert.equal(cells[n - 1]?.x1, 1200);
			cells.forEach((c, i) => assert.equal(c.x1 - c.x0, 1200 / n === Math.floor(1200 / n) ? 1200 / n : c.x1 - c.x0, `${n}:${i}`));
		}
	});
	it("which dial slot holds each number", () => {
		assert.deepEqual(columns(1, "first"), [0]);
		assert.deepEqual(columns(2, "first"), [0, 3]);
		assert.deepEqual(columns(3, "first"), [0, 2, 4]);
		assert.deepEqual(columns(4, "first"), [0, 2, 3, 5]);
		assert.deepEqual(columns(5, "first"), [0, 1, 2, 4, 5]);
		assert.deepEqual(columns(6, "first"), [0, 1, 2, 3, 4, 5]);
		assert.deepEqual(columns(1, "last"), [5]);
		assert.deepEqual(columns(2, "last"), [2, 5]);
		assert.deepEqual(columns(3, "last"), [1, 3, 5]);
		assert.deepEqual(columns(4, "last"), [0, 2, 3, 5]);
	});
	it("a dial not on the page gives its number to the next slot the cell reaches, and never one a cell before took", () => {
		assert.deepEqual(columns(3, "first", [false, true, true, true, true, true]), [1, 2, 4]);
		assert.deepEqual(columns(4, "first", [false, true, false, true, true, true]), [1, 2, 3, 5], "the second cell's own slot is off the page and so is the first's: each keeps a slot it reaches");
	});
	it("the room beside a number: on the side that has more, or none under a useful width", () => {
		const cells = spreadCells(xl, 4, "first");
		assert.deepEqual(besideOf(cells[0] as SpreadCell), { x0: 204, x1: 292 });
		assert.deepEqual(besideOf(cells[1] as SpreadCell), { x0: 308, x1: 396 });
		assert.equal(besideOf(spreadCells(xl, 5, "first")[0] as SpreadCell), null);
		assert.equal(besideOf(spreadCells(xl, 6, "first")[0] as SpreadCell), null);
	});
	it("a trend asks the history its width takes", () => {
		assert.equal(onlyTrendBuckets(xl, 1, 2), 494);
		assert.equal(onlyTrendBuckets(xl, 2, 2), 194);
		assert.equal(onlyTrendBuckets(xl, 3, 2), 94);
		assert.equal(onlyTrendBuckets(xl, 4, 2), 44);
		assert.equal(onlyTrendBuckets(xl, 5, 2), 192, "the widest runs across the slot with no number");
		assert.equal(onlyTrendBuckets(xl, 6, 2), 92);
		assert.equal(onlyTrendBuckets({ x0: 0, x1: 800 }, 3, 2), 192, "the same on a +");
		assert.equal(onlyTrendBuckets({ x0: 0, x1: 400 }, 4, 2), 92, "more readings than slots: one under each stack");
	});
});

describe("Large values only spread across the pane", () => {
	for (const font of ["tahoma", "segoe-ui"] as const) {
		for (const g of READOUT_GEOMETRIES) {
			for (const n of [1, 2, 3, 4, 5, 6]) {
				it(`${font}, ${g.encoders * 200} ${g.layout}, ${n}: every number inside one dial slot, every slot used`, () => {
					setFaceFont(font);
					const c = only(SIX.slice(0, n), g);
					const seen = texts(c.input);
					const r = sliceStrip(c.input);
					setFaceFont("tahoma");
					setFaceFont(font);
					for (const p of seen) if (/\d/.test(p.text)) assert.ok(insideOneSlice(p), `"${p.text}" at ${p.x}`);
					setFaceFont("tahoma");
					if (n <= g.encoders / (g.layout === "whole" ? 1 : 2)) r.slices.forEach((svg, column) => assert.match(svg ?? "", /<text|<path|<polyline/, `dial ${column + 1} is used`));
				});
			}
		}
	}

	it("the digits are never smaller than the old layout drew them: 63 px for one to three, 57 for four, in Tahoma", () => {
		const size = (n: number): number => Math.max(...digits(only(SIX.slice(0, n)).input).map((p) => p.size));
		assert.ok(size(1) >= 63 && size(2) >= 63 && size(3) >= 63, `${size(1)} ${size(2)} ${size(3)}`);
		assert.ok(size(4) >= 57, String(size(4)));
		assert.ok(size(6) >= 57, String(size(6)));
		console.error(`values only type, 1 to 6 readings: ${[1, 2, 3, 4, 5, 6].map(size).join(" ")} px`);
	});

	it("every number of a pane is one size", () => {
		for (const n of [2, 3, 4, 5, 6]) assert.equal(new Set(digits(only(SIX.slice(0, n)).input).map((p) => p.size)).size, 1, String(n));
	});

	it("the size and place come from the setup: no value moves any mark but its own digits' text", () => {
		const base = only(["cpu", "gpu", "hot"]).input;
		const before = texts(base);
		const big = before.find((p) => p.text === "63.4") as TextPrim;
		for (const value of [5.2, 9.99, 42.5, 99.9, 100, 104]) {
			const now = texts(withValue(base, 0, value));
			const mine = now.find((p) => p.weight === 700 && p.size === big.size && p.x < SLICE_W) as TextPrim;
			assert.equal(mine.size, big.size, String(value));
			assert.equal(mine.y, big.y, String(value));
			assert.ok(Math.abs(inkRight(mine) - inkRight(big)) < 1.5, `${value}: right edge ${inkRight(mine)} against ${inkRight(big)}`);
			// The other readings' words and the first one's name and unit stay
			// where they were; only the first trend's scale ends may print new
			// numbers.
			const fixed = (list: TextPrim[]): string[] => list.filter((p) => p.size > 12 && p !== big && p !== mine && p.text !== "warn" && p.text !== "crit").map((p) => `${p.text} ${p.x} ${p.y} ${p.size}`);
			assert.deepEqual(fixed(now), fixed(before), String(value));
		}
	});

	it("a value wider than its setup steps down alone, keeping its baseline and its right end", () => {
		const base = only(["cpu", "gpu", "hot"]).input;
		const before = digits(base);
		const big = before[0] as TextPrim;
		const now = texts(withValue(base, 0, 12345));
		const wide = now.find((p) => p.text === "12.3k") as TextPrim;
		assert.ok(wide.size < big.size, `${wide.size} against ${big.size}`);
		assert.equal(wide.y, big.y);
		assert.ok(insideOneSlice(wide));
		assert.deepEqual(digits(withValue(base, 0, 12345)).slice(0).filter((p) => p.x >= SLICE_W).map((p) => [p.text, p.size, p.x, p.y]), before.slice(1).map((p) => [p.text, p.size, p.x, p.y]));
	});

	it("a value past a limit says so in a word, and nothing moves for it", () => {
		const withBand = (from: number): StripSceneInput => {
			const c = only(["cpu", "gpu"]).input;
			const pane = c.panes[0] as StripSceneInput["panes"][number];
			return { ...c, panes: [{ ...pane, bands: [{ level: "warn", from, to: Number.POSITIVE_INFINITY, readingKey: pane.series[0]?.key as string, label: "warn", source: "strip" }] }, ...c.panes.slice(1)] };
		};
		const quiet = texts(withBand(90));
		const reached = texts(withBand(60));
		assert.ok(!quiet.some((p) => p.text === "warn"));
		const word = reached.find((p) => p.text === "warn") as TextPrim;
		assert.equal(word.fill, withBand(60).alertColors.warn);
		const placed = (list: TextPrim[]): string[] => list.filter((p) => p.text !== "warn").map((p) => `${p.text} ${p.x} ${p.y} ${p.size}`);
		assert.deepEqual(placed(reached), placed(quiet));
		const digit = reached.find((p) => p.text === "63.4") as TextPrim;
		assert.equal(digit.fill, withBand(60).alertColors.warn);
	});

	it("a stale or lost reading keeps its cell and takes nothing from its neighbours", () => {
		const base = only(["cpu", "gpu", "hot"]).input;
		const pane = base.panes[0] as StripSceneInput["panes"][number];
		const lost: StripSceneInput = { ...base, panes: [{ ...pane, series: pane.series.map((s, i) => (i === 0 ? { key: s.key, name: s.name, unit: s.unit, state: "missing" as const } : s)) }, ...base.panes.slice(1)] };
		const others = (input: StripSceneInput): string[] => texts(input).filter((p) => p.x >= 2 * SLICE_W).map((p) => `${p.text} ${p.x} ${p.y} ${p.size}`);
		assert.deepEqual(others(lost), others(base));
		assert.equal(digits(lost).length, 2);
	});

	it("beside a number a trend prints its scale's ends, and the last one the window", () => {
		for (const n of [1, 2, 3, 4]) {
			const seen = texts(only(SIX.slice(0, n)).input).filter((p) => p.size === 12).map((p) => p.text);
			assert.equal(seen.filter((t) => t === "5 min").length, 1, String(n));
			assert.equal(seen.filter((t) => /^\d+$/.test(t)).length, 2 * n, `${n}: ${seen.join(" ")}`);
		}
		assert.ok(!texts(only(SIX).input).some((p) => p.text === "5 min"), "under the numbers there is no room for words");
	});

	it("a trend stands on the strip's own scale: a wobble is not stretched to the height it gets", () => {
		const flat = withValue(only(["cpu"]).input, 0, 60);
		const ys = lines(flat).flatMap((l) => l.pts.filter((_, i) => i % 2 === 1));
		assert.ok(Math.max(...ys) - Math.min(...ys) < 1, "a flat reading draws flat");
		// A 1 degree wobble takes a small share of the height.
		const pane = flat.panes[0] as StripSceneInput["panes"][number];
		const s = pane.series[0] as StripSceneInput["panes"][number]["series"][number];
		const wobble = makeView({ windowMs: (s.history as { windowMs: number }).windowMs, widthPx: (s.history as { widthPx: number }).widthPx, unit: s.unit, value: (f) => 60 + 0.5 * Math.sin(f * 20) });
		const wobbled = lines({ ...flat, panes: [{ ...pane, series: [{ ...s, history: wobble }] }, ...flat.panes.slice(1)] }).flatMap((l) => l.pts.filter((_, i) => i % 2 === 1));
		assert.ok(Math.max(...wobbled) - Math.min(...wobbled) < 20, `${Math.max(...wobbled) - Math.min(...wobbled)} px of 84`);
	});

	it("Time span off draws the numbers alone", () => {
		const c = only(["cpu", "gpu"]).input;
		const [p0, p1] = c.config.panes;
		const off = { ...c, config: { ...c.config, panes: [{ ...p0, overlays: { ...p0.overlays, time: false } }, p1] as const } };
		assert.equal(lines(off).length, 0);
		assert.equal(digits(off).length, 2);
	});

	it("Nebula on Ember: every slice under its cap, at the finest buckets", () => {
		for (const n of [1, 2, 3, 4, 5, 6]) {
			const r = sliceStrip(only(SIX.slice(0, n), { theme: "ember", background: "nebula" }).input);
			assert.ok(r.maxBytes <= SLICE_PAYLOAD_LIMIT - ART_PIECE_LIMIT, `${n}: ${r.maxBytes}`);
			assert.equal(r.coarsened, false, String(n));
		}
	});
});

describe("Large values only: a trend under its number", () => {
	const item: SpreadItem = { text: "63.4", numeric: true, sizing: ["99.9"], unit: "°C", names: ["CPU"], setupUnit: "°C", limits: false };
	const reach = (extent: { x0: number; x1: number }, n: number): (readonly [number, number] | undefined)[] => {
		const plan = planSpread(Array.from({ length: n }, () => item), spreadCells(extent, n, "first"), { names: true, trend: true });
		return plan.places.map((p) => (p.trend === undefined ? undefined : [p.trend.x0, p.trend.x1]));
	};

	it("five on a whole + XL: each line starts under its number, and the slot with no number goes to the line before it", () => {
		assert.deepEqual(reach({ x0: 0, x1: 1200 }, 5), [[8, 192], [208, 392], [408, 792], [808, 992], [1008, 1192]]);
	});

	it("three on a whole +: the same", () => {
		assert.deepEqual(reach({ x0: 0, x1: 800 }, 3), [[8, 192], [208, 592], [608, 792]]);
	});

	it("as many readings as slots: each line stays under its own number", () => {
		assert.deepEqual(reach({ x0: 0, x1: 1200 }, 6), [0, 1, 2, 3, 4, 5].map((c) => [c * 200 + 8, c * 200 + 192]));
		assert.deepEqual(reach({ x0: 0, x1: 800 }, 4), [0, 1, 2, 3].map((c) => [c * 200 + 8, c * 200 + 192]));
	});

	it("drawn: no number's line starts in another number's slot, and every dial still draws", () => {
		const input = only(SIX.slice(0, 5)).input;
		const starts = lines(input).map((l) => l.pts[0] as number);
		const slots = [0, 1, 2, 4, 5].map((c) => c * SLICE_W + 8);
		for (const x of slots) assert.ok(starts.some((start) => start >= x && start < x + 40), `no line starts at ${x}: ${starts.join(" ")}`);
		sliceStrip(input).slices.forEach((svg, column) => assert.match(svg ?? "", /<path|<polyline/, `dial ${column + 1}`));
	});
});

describe("Large values only while inspecting", () => {
	const MANY = [...SIX, "vmCommitted", "vmAvailable", "htc", "plim"];
	/** A drawn word's ink: a number by the font's own digit outlines. */
	const inkBox = (p: TextPrim): { x0: number; x1: number; y0: number; y1: number } => {
		const box = textInkBox(p);
		if (!/^[\d.,k…-]+$/.test(p.text)) return box;
		const m = digitMetrics();
		return { ...box, y0: p.y - m.top * p.size, y1: p.y + m.drop * p.size };
	};
	const meet = (a: TextPrim, b: TextPrim): boolean => {
		const [p, q] = [inkBox(a), inkBox(b)];
		return Math.min(p.x1, q.x1) > Math.max(p.x0, q.x0) && Math.min(p.y1, q.y1) > Math.max(p.y0, q.y0);
	};

	for (const font of ["tahoma", "segoe-ui"] as const) {
		for (const g of READOUT_GEOMETRIES) {
			for (const names of [true, false]) {
				for (let n = 1; n <= MANY.length; n++) {
					it(`${font}, ${g.encoders * 200} ${g.layout}, ${n}, names ${names ? "on" : "off"}: no two words meet, and PAUSED stays inside one dial slot`, () => {
						setFaceFont(font);
						const seen = texts(only(MANY.slice(0, n), { ...g, paused: true, names, theme: "ember", background: "nebula" }).input);
						const met: string[] = [];
						seen.forEach((a, i) => seen.slice(i + 1).forEach((b) => (meet(a, b) ? met.push(`"${a.text}" and "${b.text}"`) : undefined)));
						const badges = seen.filter((p) => p.text.startsWith("PAUSED"));
						const across = badges.filter((p) => !insideOneSlice(p)).map((p) => p.x);
						setFaceFont("tahoma");
						assert.deepEqual(met, []);
						assert.ok(badges.length > 0, "no PAUSED");
						assert.deepEqual(across, []);
					});
				}
			}
		}
	}

	it("with no name and no unit on the top row PAUSED still meets no number", () => {
		for (const g of READOUT_GEOMETRIES) {
			// The fixture's first reading has limits, and those keep the row.
			for (let n = 1; n < SIX.length; n++) {
				const c = only(SIX.slice(1, n + 1), { ...g, paused: true, names: false }).input;
				const [p0, p1] = c.config.panes;
				const bare = { ...c, config: { ...c.config, panes: [{ ...p0, overlays: { ...p0.overlays, unit: false } }, { ...p1, overlays: { ...p1.overlays, unit: false } }] as const } };
				const seen = texts(bare);
				for (const badge of seen.filter((p) => p.text.startsWith("PAUSED"))) {
					for (const other of seen) if (other !== badge) assert.ok(!meet(badge, other), `${g.encoders * 200} ${g.layout} ${n}: PAUSED and "${other.text}"`);
				}
			}
		}
	});

	it("a trend beside its number keeps both its scale's ends, and only the window's words go", () => {
		for (const g of READOUT_GEOMETRIES) {
			for (const n of [1, 2, 3, 4]) {
				const scale = (paused: boolean): string[] => texts(only(SIX.slice(0, n), { ...g, paused }).input).filter((p) => p.size === 12 && p.anchor === "start").map((p) => `${p.x} ${p.y}`);
				assert.deepEqual(scale(true), scale(false), `${g.encoders * 200} ${g.layout} ${n}`);
			}
		}
	});

	it("four on a whole + XL: PAUSED takes the end of its number's row, as five or six do, and the name steps aside for the moment", () => {
		const seen = texts(only(SIX.slice(0, 4), { paused: true }).input);
		const badge = seen.find((p) => p.text.startsWith("PAUSED")) as TextPrim;
		assert.equal(badge.x, 1200 - 8);
		const live = texts(only(SIX.slice(0, 4)).input);
		const nameOf = (list: TextPrim[]): TextPrim => list.find((p) => p.text === "GPU Load" || p.text === "GPU") as TextPrim;
		assert.equal(badge.y, nameOf(live).y);
		const unit = seen.find((p) => p.text === "%") as TextPrim;
		assert.ok(inkBox(unit).x1 < inkBox(badge).x0, "the unit stands left of PAUSED");
	});

	it("one to three on a whole + XL: PAUSED keeps the corner of the last trend, clear of its scale's end", () => {
		for (const n of [1, 2, 3]) {
			const seen = texts(only(SIX.slice(0, n), { paused: true }).input);
			const badge = seen.find((p) => p.text.startsWith("PAUSED")) as TextPrim;
			assert.equal(badge.x, 1200 - 8, String(n));
			assert.ok(badge.y < 15, String(n));
		}
	});
});

describe("Values only: a value with no shorter texts that cannot fit", () => {
	it("draws the lone ellipsis at the floor, as before readings had their own formats", () => {
		for (const width of [50, 60, 80]) {
			const item: SpreadItem = { text: "12345678", numeric: true, sizing: ["0.0"], unit: "", names: [], setupUnit: "", limits: false };
			const place = planSpread([item], [{ x0: 0, x1: width, column: 0, slotX0: 0, slotX1: width }], { names: false, trend: false }).places[0];
			assert.equal(place?.text, "…", String(width));
			assert.equal(place?.valueSize, 12, String(width));
		}
	});
});
