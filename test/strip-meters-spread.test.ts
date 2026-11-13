/**
 * Meters across the whole pane: equal cells, each number in a dial slot.
 *
 * - No dial slot is left to the picture with fewer readings than dials.
 * - Every number stays inside one slice, its size from the stored setup; a
 *   value wider than its setup steps down alone.
 * - Where the cell leaves room the name sits beside the number, which takes
 *   the height the name's row would, and the window draws as a line on the
 *   bar's own scale.
 * - A value past its usual reach, in any cell of any count, stays inside its
 *   slot; a value within it keeps the pane's size.
 * - An idle reading's line stays clear of the window's words or PAUSED.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixtureCase, makeView, READOUT_GEOMETRIES, type FixtureCase } from "../scripts/lib/strip-fixtures";
import type { LinePrim, TextPrim } from "../src/strip/prims";
import { METER_VALUE_MAX } from "../src/strip/meters";
import { digitMetrics } from "../src/strip/readout";
import { buildStripScene, textInkBox, type StripSceneInput } from "../src/strip/scene";
import { sliceStrip, SLICE_PAYLOAD_LIMIT } from "../src/strip/slicer";
import { ART_PIECE_LIMIT } from "../src/ui/deck-art";
import { setFaceFont } from "../src/ui/face-font";
import { inkEdges } from "../src/ui/format";

setFaceFont("tahoma");

const SLICE_W = 200;
const SIX = ["cpu", "gpu", "hot", "load", "power", "fan"];

function meters(series: readonly string[], opts: { encoders?: 4 | 6; layout?: "whole" | "split"; theme?: string; background?: "theme" | "nebula"; present?: boolean[]; paused?: boolean } = {}): FixtureCase {
	return fixtureCase({ styles: ["meters", "meters"], layout: opts.layout ?? "whole", encoders: opts.encoders ?? 6, background: opts.background ?? "theme", accent: false, ...(opts.theme === undefined ? {} : { theme: opts.theme }), ...(opts.present === undefined ? {} : { present: opts.present }), ...(opts.paused === undefined ? {} : { paused: opts.paused }), extras: [{ series: [...series] }, { series: [...series] }] });
}

const texts = (input: StripSceneInput): TextPrim[] => buildStripScene(input).prims.filter((p): p is TextPrim => p.k === "text");
const lines = (input: StripSceneInput): LinePrim[] => buildStripScene(input).prims.filter((p): p is LinePrim => p.k === "line");
const big = (input: StripSceneInput): TextPrim[] => texts(input).filter((p) => p.weight === 700 && /^[\d.]+k?$/.test(p.text));
const edges = (p: TextPrim): { left: number; right: number } => inkEdges([{ text: p.text, fontSize: p.size, fontWeight: p.weight }], p.anchor, p.x);

/** Every pane's reading `index` held at `value`, in `unit` when one is given. */
function withValue(input: StripSceneInput, index: number, value: number, unit?: string): StripSceneInput {
	const panes = input.panes.map((pane) => {
		const series = pane.series.map((s, i) => {
			if (i !== index || s.history === undefined) return s;
			return { ...s, unit: unit ?? s.unit, current: value, history: makeView({ windowMs: s.history.windowMs, widthPx: s.history.widthPx, unit: unit ?? s.unit, value: () => value }) };
		});
		return { ...pane, series };
	});
	return { ...input, panes };
}

describe("Meters spread across the pane", () => {
	it("fewer readings than dials: every dial draws its share of the strip", () => {
		for (const n of [1, 2, 3, 4, 5, 6]) {
			const r = sliceStrip(meters(SIX.slice(0, n)).input);
			r.slices.forEach((svg, column) => assert.match(svg ?? "", /<text|<path|<polyline/, `${n}: dial ${column + 1}`));
		}
	});

	it("the bars take equal shares of the strip's width", () => {
		const reach = (n: number): number[] => {
			return texts(meters(SIX.slice(0, n)).input).filter((p) => p.y === 94 && p.size === 12 && /^\d+$/.test(p.text)).map((p) => p.x);
		};
		// The scale's two ends of each meter: from the cell's left to its right.
		assert.deepEqual(reach(2).filter((_, i) => i % 2 === 0), [8, 608]);
		assert.deepEqual(reach(2).filter((_, i) => i % 2 === 1), [592, 1192]);
		assert.deepEqual(reach(3).filter((_, i) => i % 2 === 0), [8, 408, 808]);
		assert.deepEqual(reach(3).filter((_, i) => i % 2 === 1), [392, 792, 1192]);
		assert.deepEqual(reach(4).filter((_, i) => i % 2 === 0), [8, 308, 608, 908]);
		assert.deepEqual(reach(4).filter((_, i) => i % 2 === 1), [292, 592, 892, 1192]);
	});

	it("six readings on six dials keep the rows they had: a name over 43 px digits", () => {
		const seen = big(meters(SIX).input);
		assert.equal(seen.length, 6);
		for (const p of seen) assert.equal(p.size, METER_VALUE_MAX, p.text);
	});

	for (const font of ["tahoma", "segoe-ui"] as const) {
		for (const g of READOUT_GEOMETRIES) {
			for (const n of [1, 2, 3, 4, 5, 6]) {
				it(`${font}, ${g.encoders * 200} ${g.layout}, ${n}: no number crosses a seam, digits 30 px or taller`, () => {
					setFaceFont(font);
					const input = meters(SIX.slice(0, n), g).input;
					const seen = texts(input);
					for (const p of seen) {
						if (!/\d/.test(p.text)) continue;
						const e = edges(p);
						assert.equal(Math.floor(e.left / SLICE_W), Math.floor((e.right - 0.01) / SLICE_W), `"${p.text}" from ${e.left} to ${e.right}`);
					}
					const size = Math.max(...big(input).map((p) => p.size));
					const cap = size * digitMetrics().cap;
					setFaceFont("tahoma");
					assert.ok(cap >= 30, `${size} px type, ${cap} px digits`);
				});
			}
		}
	}

	it("with room beside the number the digits take the name's height too: 60 px type and more for one to four readings", () => {
		for (const n of [1, 2, 3, 4]) {
			const seen = big(meters(SIX.slice(0, n)).input);
			assert.equal(new Set(seen.map((p) => p.size)).size, 1);
			assert.ok((seen[0] as TextPrim).size >= 60, `${n}: ${(seen[0] as TextPrim).size} px`);
		}
	});

	it("the size and place come from the setup: no value moves another mark", () => {
		const base = meters(SIX.slice(0, 3)).input;
		const before = texts(base);
		const first = before.find((p) => p.text === "63.4") as TextPrim;
		for (const value of [5.2, 9.99, 42.5, 99.9, 100]) {
			const input = withValue(base, 0, value);
			const now = texts(input);
			const mine = big(input)[0] as TextPrim;
			assert.equal(mine.size, first.size, String(value));
			assert.equal(mine.y, first.y, String(value));
			assert.ok(Math.abs(edges(mine).right - edges(first).right) < 1.5, String(value));
			const others = (list: TextPrim[]): string[] => list.filter((p) => p.x >= 2 * SLICE_W && p.size > 12).map((p) => `${p.text} ${p.x} ${p.y} ${p.size}`);
			assert.deepEqual(others(now), others(before), String(value));
		}
	});

	it("a value wider than its setup steps down alone, in place", () => {
		const base = meters(SIX.slice(0, 3)).input;
		const first = big(base)[0] as TextPrim;
		const input = withValue(base, 0, 12345);
		const wide = big(input)[0] as TextPrim;
		assert.equal(wide.text, "12.3k");
		assert.ok(wide.size <= first.size);
		assert.equal(wide.y, first.y);
		assert.deepEqual(big(input).slice(1).map((p) => p.size), big(base).slice(1).map((p) => p.size));
	});

	it("a value that needs more room never takes it from another meter", () => {
		const base = fixtureCase({ styles: ["meters"], layout: "whole", encoders: 6, background: "theme", accent: false, decimals: "3", extras: [{ series: SIX }] }).input;
		const wide = withValue(base, 0, 12345.678);
		assert.ok((big(wide)[0] as TextPrim).text === "12345.678" && (big(wide)[0] as TextPrim).size < (big(base)[0] as TextPrim).size);
		assert.deepEqual(big(wide).slice(1).map((p) => [p.text, p.size, p.y]), big(base).slice(1).map((p) => [p.text, p.size, p.y]));
	});

	it("beside the number the window is a line on the bar's own scale", () => {
		const yOf = (input: StripSceneInput, x0: number, x1: number): number[] => lines(input).filter((l) => (l.pts[0] as number) >= x0 && (l.pts[0] as number) < x1).flatMap((l) => l.pts.filter((_, i) => i % 2 === 1));
		// 0 to 100 on 22 to 58: 50 sits halfway.
		const first = yOf(withValue(meters(["load", "gpu"]).input, 0, 50), 0, 600);
		assert.ok(first.length > 0);
		for (const y of first) assert.ok(Math.abs(y - 40) <= 0.5, String(y));
		// The last meter's stops above the window's words: 22 to 46.
		const last = yOf(withValue(meters(["load"]).input, 0, 50), 0, 1200);
		assert.ok(last.length > 0);
		for (const y of last) assert.ok(Math.abs(y - 34) <= 0.5, String(y));
		assert.ok(lines(meters(SIX).input).length === 0, "no line with no room beside the numbers");
	});

	it("Time span off draws no line and no window's words", () => {
		const c = meters(SIX.slice(0, 2)).input;
		const [p0, p1] = c.config.panes;
		const off = { ...c, config: { ...c.config, panes: [{ ...p0, overlays: { ...p0.overlays, time: false } }, p1] as const } };
		assert.equal(lines(off).length, 0);
		assert.ok(!texts(off).some((p) => p.text.startsWith("range ")));
	});

	it("the window's words stand once, in the last cell", () => {
		for (const n of [1, 2, 3, 4, 5, 6]) {
			const said = texts(meters(SIX.slice(0, n)).input).filter((p) => p.text === "range 5 min");
			assert.equal(said.length, 1, String(n));
			assert.ok(edges(said[0] as TextPrim).right > 1200 - 2 * SLICE_W, `${n}: ${(said[0] as TextPrim).x}`);
		}
	});

	it("a dial off the page gives its number to the next slot its cell reaches", () => {
		const present = [true, false, true, true, true, true];
		const input = meters(SIX.slice(0, 2), { present }).input;
		const seen = big(input).map((p) => Math.floor(edges(p).left / SLICE_W));
		assert.deepEqual(seen, [2, 5]);
		const gone = meters(SIX.slice(0, 3), { present }).input;
		assert.deepEqual(big(gone).map((p) => Math.floor(edges(p).left / SLICE_W)), [0, 3, 5]);
	});

	it("Nebula on Ember: every slice under its cap, at the finest buckets", () => {
		for (const n of [1, 2, 3, 4, 5, 6]) {
			const r = sliceStrip(meters(SIX.slice(0, n), { theme: "ember", background: "nebula" }).input);
			assert.ok(r.maxBytes <= SLICE_PAYLOAD_LIMIT - ART_PIECE_LIMIT, `${n}: ${r.maxBytes}`);
			assert.equal(r.coarsened, false, String(n));
		}
	});
});

describe("Meters: a value past its usual reach", () => {
	/** How many readings a half or the whole of a geometry draws. */
	const slotsOf = (g: { encoders: 4 | 6; layout: "whole" | "split" }): number => (g.layout === "whole" ? g.encoders : g.encoders / 2);

	for (const font of ["tahoma", "segoe-ui"] as const) {
		for (const g of READOUT_GEOMETRIES) {
			for (const n of [1, 2, 3, 4, 5, 6]) {
				const drawn = Math.min(n, slotsOf(g));
				it(`${font}, ${g.encoders * 200} ${g.layout}, ${n}: in every cell it stays inside its dial slot and moves no other number`, () => {
					setFaceFont(font);
					const base = meters(SIX.slice(0, n), g).input;
					const others = (input: StripSceneInput, i: number): string[] => big(input).filter((_, k) => k % drawn !== i).map((p) => `${p.text} ${p.x} ${p.y} ${p.size}`);
					const out: string[] = [];
					for (let i = 0; i < drawn; i++) {
						for (const [value, unit] of [[1034, undefined], [12500, undefined], [12345.678, undefined], [-5.5, ""], [-5.5, undefined]] as const) {
							const input = withValue(base, i, value, unit);
							for (const p of texts(input)) {
								if (!/\d/.test(p.text)) continue;
								const e = edges(p);
								if (Math.floor(e.left / SLICE_W) !== Math.floor((e.right - 0.01) / SLICE_W)) out.push(`cell ${i}: "${p.text}" from ${e.left} to ${e.right}`);
							}
							if (value > 0) assert.deepEqual(others(input, i), others(base, i), `cell ${i} at ${value}`);
						}
					}
					setFaceFont("tahoma");
					assert.deepEqual(out, []);
				});

				it(`${font}, ${g.encoders * 200} ${g.layout}, ${n}: a value within its reach keeps the pane's size`, () => {
					setFaceFont(font);
					const REACH: Readonly<Record<string, readonly number[]>> = { "°C": [99.9, 100], "%": [99.9, 100], W: [99.9, 999], RPM: [9999] };
					const base = meters(SIX.slice(0, n), g).input;
					const size = (big(base)[0] as TextPrim).size;
					const out: string[] = [];
					(base.panes[0] as StripSceneInput["panes"][number]).series.slice(0, drawn).forEach((s, i) => {
						for (const value of REACH[s.unit] ?? []) {
							const mine = big(withValue(base, i, value))[i] as TextPrim;
							if (mine.size !== size) out.push(`cell ${i}: ${mine.text} ${s.unit} at ${mine.size}, not ${size}`);
						}
					});
					setFaceFont("tahoma");
					assert.deepEqual(out, []);
				});

				it(`${font}, ${g.encoders * 200} ${g.layout}, ${n}: a scale's top end keeps its whole box off the seam`, () => {
					setFaceFont(font);
					const base = meters(SIX.slice(0, n), g).input;
					const out: string[] = [];
					for (let i = 0; i < drawn; i++) {
						for (const p of texts(withValue(base, i, 12500))) {
							if (p.size !== 12 || !/^[\d.]+k?$/.test(p.text) || p.bx0 === undefined || p.bx1 === undefined) continue;
							if (Math.floor(p.bx0 / SLICE_W) !== Math.floor((p.bx1 - 0.01) / SLICE_W)) out.push(`cell ${i}: "${p.text}" from ${p.bx0} to ${p.bx1}`);
						}
					}
					setFaceFont("tahoma");
					assert.deepEqual(out, []);
				});
			}
		}
	}

	it("a scale's top end too wide to pass the seam stays before it, clear of the next meter's low end", () => {
		const input = withValue(withValue(meters(SIX.slice(0, 5)).input, 0, 18000, "KB/s"), 1, 1, "Yes/No");
		const row = texts(input).filter((p) => p.size === 12 && p.y === 94);
		const top = row.find((p) => p.text.endsWith("bps")) as TextPrim;
		const low = row.find((p) => p.text === "No") as TextPrim;
		assert.ok(edges(top).right < edges(low).left, `"${top.text}" ends at ${edges(top).right}, "${low.text}" starts at ${edges(low).left}`);
		assert.ok(Math.floor((top.bx0 as number) / SLICE_W) === Math.floor(((top.bx1 as number) - 0.01) / SLICE_W), `${top.bx0} to ${top.bx1}`);
	});

	it("a fan at 12500 RPM steps down alone, its unit where it was", () => {
		const base = meters(["cpu", "gpu", "hot", "fan", "load"]).input;
		const before = texts(base);
		const size = (big(base)[0] as TextPrim).size;
		const input = withValue(base, 3, 12500);
		const now = big(input)[3] as TextPrim;
		assert.equal(now.text, "12.5k");
		assert.ok(now.size < size, `${now.size} against ${size}`);
		assert.equal(now.y, (big(base)[3] as TextPrim).y);
		const unitOf = (list: TextPrim[]): TextPrim[] => list.filter((p) => p.text === "RPM" || p.text === "%");
		assert.deepEqual(unitOf(texts(input)).map((p) => [p.x, p.y]), unitOf(before).map((p) => [p.x, p.y]));
	});
});

describe("Meters: an idle reading's line and the window's words", () => {
	for (const font of ["tahoma", "segoe-ui"] as const) {
		for (const g of READOUT_GEOMETRIES) {
			for (const n of [1, 2, 3, 4]) {
				for (const paused of [false, true]) {
					it(`${font}, ${g.encoders * 200} ${g.layout}, ${n}, ${paused ? "paused" : "live"}: at 3 percent the line runs clear of the words`, () => {
						setFaceFont(font);
						let input = meters(SIX.slice(0, n), { ...g, paused }).input;
						for (let i = 0; i < n; i++) input = withValue(input, i, 3, "%");
						const words = texts(input).filter((p) => p.text.startsWith("range ") || p.text.startsWith("PAUSED"));
						const boxes = words.map(textInkBox);
						const all = lines(input);
						setFaceFont("tahoma");
						assert.ok(words.length > 0);
						for (const box of boxes) {
							for (const l of all) {
								for (let k = 0; k + 1 < l.pts.length; k += 2) {
									const [x, y] = [l.pts[k] as number, l.pts[k + 1] as number];
									if (x >= box.x0 - 1 && x <= box.x1 + 1) assert.ok(y + l.width / 2 < box.y0, `line at ${x}, ${y} against the words from ${box.y0}`);
								}
							}
						}
					});
				}
			}
		}
	}

	it("the line keeps the room's whole width: nothing of the window is lost to the words", () => {
		for (const n of [1, 2, 3, 4]) {
			let input = meters(SIX.slice(0, n)).input;
			for (let i = 0; i < n; i++) input = withValue(input, i, 3, "%");
			const word = texts(input).find((p) => p.text.startsWith("range ")) as TextPrim;
			const reach = Math.max(...lines(input).map((l) => l.pts[l.pts.length - 2] as number));
			assert.ok(reach >= edges(word).right - 2, `${n}: the line ends at ${reach}, the word at ${edges(word).right}`);
		}
	});
});
