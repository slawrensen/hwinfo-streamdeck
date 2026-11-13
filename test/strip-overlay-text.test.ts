/**
 * The rows over the graph: the plot takes the strip's height, and the top
 * row (names, values) and the bottom row (the window's words, LIVE or
 * PAUSED) draw over it at larger sizes, in an edge of their own: Outline's
 * one filter pass (ROWS_FILTER) grows every row word, chip and swatch by
 * 1 px, black on the dark themes and the theme background on Paper, above
 * the marks, with no patch under them. What this holds:
 *
 * - no smoke: no gradient paint, patch or panel behind the words, in any
 *   slice of any look;
 * - every row word draws inside the row edge, one filter group a slice
 *   with row words and none without, its region around the words' ink,
 *   above Outline's and Tint's marks and under the Strip Screens line;
 * - every row word reads at 4.5:1 or better against the weakest pixel the
 *   edge lays next to its ink (7/8 of the edge color) over the worst
 *   picture, on every look and theme; and rasterized over white and black
 *   with a full-height zigzag line under the words, every pixel next to a
 *   word's ink does;
 * - the plot gained the rows' height, and the rows' words keep their sizes;
 * - no row word and no row edge lies on a large readout's digits;
 * - a reading in another unit draws in a band of its own: every reading
 *   draws, each band on its own scale with its ends named, and the legend
 *   carries every value;
 * - every slice stays inside the payload bound, the deck art's piece
 *   included.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import { fixtureCase, groupFixture, makeView, readoutMatrix, type FixtureCase } from "../scripts/lib/strip-fixtures";
import { EVENTS_BOTTOM, EVENTS_TOP } from "../src/strip/events";
import { GROUP_BOTTOM, GROUP_TOP } from "../src/strip/group";
import { laneHeight, LANES_BOTTOM, LANES_TOP, SLICE_W } from "../src/strip/geometry";
import { emitPrim, type Prim, type TextPrim } from "../src/strip/prims";
import { blendOver, buildStripScene, ROWS_FILTER, STRIP_ROWS, textInkBox, unitBands, type LogicalScene, type StripSceneInput } from "../src/strip/scene";
import { SLICE_BLEED, sliceStrip, SLICE_PAYLOAD_LIMIT, svgBytes } from "../src/strip/slicer";
import type { StripStyle } from "../src/strip/settings";
import { ART_LOOKS, ART_PIECE_LIMIT, artPlace, isArtLook, paintArt } from "../src/ui/deck-art";
import { DIAL_BACKGROUNDS, haloRingColor, type DialBackground } from "../src/ui/dial-background";
import { setFaceFont } from "../src/ui/face-font";
import { loadThemes, resolvePalette } from "../src/ui/themes";
import { contrast, luminance } from "./wcag";

setFaceFont("tahoma");
const themes = loadThemes();
const THEMES = Object.keys(themes.themes);
const LOOKS: readonly DialBackground[] = DIAL_BACKGROUNDS;
const ROW_STYLES: readonly StripStyle[] = ["trend", "area", "compare", "lanes", "heat", "events"];

/** Every scene a row can draw in: each style that has rows, both decks and
 * layouts, live and paused, with and without Scale and grid, on `looks`
 * and `theme`; Group views; a mixed-unit Trend and Compare. */
function scenes(looks: readonly DialBackground[], theme = "graphite"): FixtureCase[] {
	const out: FixtureCase[] = [];
	for (const background of looks) {
		for (const encoders of [4, 6] as const) {
			for (const layout of ["whole", "split"] as const) {
				for (const style of ROW_STYLES) {
					for (const paused of [false, true]) {
						for (const axes of [false, true]) out.push(fixtureCase({ styles: [style, style], layout, encoders, background, accent: false, theme, paused, extras: [{ axes }, { axes }] }));
					}
				}
				for (const style of ["trend", "compare"] as const) out.push(mixed(style, background, encoders, layout, theme));
				for (const view of ["auto", "rows", "now", "spread"] as const) out.push(groupFixture({ n: view === "auto" ? 4 : 16, view, layout, encoders, background, theme, limits: { warn: 85, crit: 95 } }));
			}
		}
	}
	return out;
}

/** The owner's mixed-unit pane: Virtual Memory Committed and Available
 * (MB) and Load (%). */
function mixed(style: "trend" | "compare", background: DialBackground, encoders: 4 | 6, layout: "whole" | "split", theme = "graphite"): FixtureCase {
	const series = ["vmCommitted", "vmAvailable", "vmLoad"];
	const c = fixtureCase({ styles: [style, style], layout, encoders, background, accent: false, theme, extras: [{ series }, { series }] });
	return { ...c, id: `${c.id}-vm` };
}

const rowWords = (prims: readonly Prim[]): TextPrim[] => prims.filter((p): p is TextPrim => p.k === "text" && p.layer === "rows");

/** The row edge of one slice: its filter region and what its group holds. */
function rowEdgeOf(svg: string): { filters: number; groups: number; region: { x: number; y: number; w: number; h: number } | null; inside: string; flood: string | null } {
	const def = new RegExp(`<filter id="${ROWS_FILTER}" filterUnits="userSpaceOnUse" x="(-?[\\d.]+)" y="(-?[\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"[^>]*>(.*?)</filter>`).exec(svg);
	const open = `<g filter="url(#${ROWS_FILTER})">`;
	const at = svg.indexOf(open);
	const inside = at < 0 ? "" : svg.slice(at + open.length, svg.indexOf("</g>", at));
	return {
		filters: (svg.match(new RegExp(`<filter id="${ROWS_FILTER}"`, "g")) ?? []).length,
		groups: svg.split(open).length - 1,
		region: def === null ? null : { x: Number(def[1]), y: Number(def[2]), w: Number(def[3]), h: Number(def[4]) },
		inside,
		flood: def === null ? null : (/<feFlood flood-color="(#[0-9A-Fa-f]{6})"/.exec(def[5] as string)?.[1] ?? null)
	};
}

/** The row words a slice carries: the ones whose slicing box reaches it. */
const wordsIn = (scene: LogicalScene, column: number): TextPrim[] => rowWords(scene.prims).filter((p) => p.bx1 > column * SLICE_W - SLICE_BLEED && p.bx0 < (column + 1) * SLICE_W + SLICE_BLEED);

describe("the rows over the graph: in an edge of their own, no smoke", () => {
	it("no smoke: no gradient paint, patch or panel behind the words in any slice (every look)", () => {
		let slices = 0;
		for (const c of scenes(LOOKS)) {
			const r = sliceStrip(c.input);
			for (const svg of r.slices) {
				if (svg === null) continue;
				slices++;
				assert.ok(!/id="s[vc]"|url\(#s[vc]\)|radialGradient/.test(svg), `${c.id}: smoke in a slice`);
				// Inside the edge: the words, their chips and swatches only.
				const { inside } = rowEdgeOf(svg);
				const kinds = new Set((inside.match(/<([a-z]+)[ >]/g) ?? []).map((m) => m.slice(1, -1)));
				for (const k of kinds) assert.ok(k === "text" || k === "rect", `${c.id}: <${k}> in the row edge`);
				for (const m of inside.matchAll(/<rect [^>]*width="([\d.]+)" height="([\d.]+)"/g)) assert.ok(Number(m[2]) <= STRIP_ROWS.swatch, `${c.id}: a ${m[1]} x ${m[2]} rect in the row edge`);
			}
		}
		assert.ok(slices > 2000, String(slices));
	});

	it("every row word draws in the row edge: one filter a slice with row words, none without, its region around their ink", () => {
		let words = 0;
		for (const c of scenes(LOOKS)) {
			const r = sliceStrip(c.input);
			const ring = haloRingColor(c.input.palette);
			r.slices.forEach((svg, column) => {
				if (svg === null) return;
				const edge = rowEdgeOf(svg);
				const here = wordsIn(r.scene, column);
				if (here.length === 0) {
					assert.equal(edge.filters + edge.groups, 0, `${c.id} column ${column}: a row edge with no row word`);
					return;
				}
				assert.equal(edge.filters, 1, `${c.id} column ${column}: row filters`);
				assert.equal(edge.groups, 1, `${c.id} column ${column}: row groups`);
				const region = edge.region as { x: number; y: number; w: number; h: number };
				// Across the slice and its bleed, as Outline's own edge.
				assert.ok(region.x <= -SLICE_BLEED - 1 && region.x + region.w >= SLICE_W + SLICE_BLEED + 1, `${c.id} column ${column}: region x ${region.x} + ${region.w}`);
				assert.ok(region.y >= 0 && region.y + region.h <= 100);
				// The edge's color: black reads the drawn alpha, a light ring floods.
				assert.equal(edge.flood, ring === "#000000" ? null : ring, `${c.id}: the edge color`);
				const texts = (edge.inside.match(/<text /g) ?? []).length;
				assert.equal(texts, here.length, `${c.id} column ${column}: ${texts} texts in the edge for ${here.length} row words`);
				for (const p of here) {
					const b = textInkBox(p);
					assert.ok(region.y <= b.y0 - 1 && region.y + region.h >= Math.min(100, b.y1 + 1), `${c.id} column ${column}: "${p.text}" ink ${b.y0.toFixed(1)}..${b.y1.toFixed(1)} outside the region ${region.y}..${region.y + region.h}`);
					assert.ok(edge.inside.includes(emitPrim(p, column * SLICE_W)), `${c.id} column ${column}: "${p.text}" outside the edge`);
					words++;
				}
				// Above Outline's and Tint's edge group, so no line draws over a row
				// word's edge; under the Strip Screens line.
				const halo = svg.indexOf('<g filter="url(#h)">');
				if (halo >= 0) assert.ok(svg.indexOf("</g>", halo) < svg.indexOf(`<g filter="url(#${ROWS_FILTER})">`), `${c.id}: the row edge under the marks`);
			});
		}
		assert.ok(words > 10000, String(words));
	});

	it("the Strip Screens position line draws above the row edge, outside it", () => {
		const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "clear", accent: false });
		const r = sliceStrip({ ...c.input, screens: { count: 3, at: 1, alerts: [false, false, true] } });
		const svg = r.slices[0] as string;
		const close = svg.indexOf("</g>", svg.indexOf(`<g filter="url(#${ROWS_FILTER})">`));
		const line = svg.search(/<rect [^>]*y="0" [^>]*height="3"/);
		assert.ok(close > 0 && line > close, "the position line after the row edge");
	});

	for (const theme of THEMES) {
		it(`${theme}: every row word reads at 4.5:1 or better against 7/8 of its edge over white (black on a light theme), on every look`, () => {
			let worst = Number.POSITIVE_INFINITY;
			let worstAt = "";
			const palette = resolvePalette(themes, theme, null, "normal");
			const dark = luminance(palette.value) < luminance(palette.bg);
			// The weakest pixel next to a word's ink: each of the filter's three
			// stacked dilation layers holds at least half there, 1 - 1/8 in all;
			// blended as QtSvg can, two steps of 255 thinner.
			const weakest = blendOver(haloRingColor(palette), 7 / 8, dark ? "#000000" : "#FFFFFF");
			for (const c of scenes(LOOKS, theme)) {
				for (const p of rowWords(buildStripScene(c.input).prims)) {
					const r = contrast(p.fill, weakest);
					if (r < worst) {
						worst = r;
						worstAt = `${c.id}: "${p.text}" ${p.fill} on ${weakest}`;
					}
				}
			}
			assert.ok(worst >= 4.5, `worst ${worst.toFixed(2)}: ${worstAt}`);
		});
	}

	it("the edge holds three stacked dilation layers (what the 7/8 above rests on)", () => {
		const svg = sliceStrip(fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "clear", accent: false }).input).slices[0] as string;
		const def = new RegExp(`<filter id="${ROWS_FILTER}".*?</filter>`).exec(svg)?.[0] ?? "";
		const last = /<feMerge>(.*?)<\/feMerge>/.exec(def)?.[1] ?? "";
		assert.equal((last.match(/<feMergeNode in="[cdq]"\/>/g) ?? []).length, 9, def);
		assert.ok(last.endsWith('<feMergeNode in="SourceGraphic"/>'), "the words over their edge");
	});
});

/** The worst contrast between a row word's fill and a pixel next to its ink
 * (8-neighbour, no word's ink there), rasterized over a flat backdrop as a
 * renderer that draws a filter's source past the viewport does (QtSvg 6.9:
 * each slice on a canvas widened by the bleed, then cut to its slot). */
async function worstNextToInk(input: StripSceneInput, backdrop: string): Promise<{ ratio: number; at: string }> {
	const r = sliceStrip(input);
	const width = input.encoders * SLICE_W;
	const layers = await Promise.all(
		r.slices.flatMap((svg, i) => {
			if (svg === null) return [];
			const wide = svg.replace('viewBox="0 0 200 100" width="200" height="100"', 'viewBox="-3 0 206 100" width="206" height="100"');
			return [sharp(Buffer.from(wide)).extract({ left: 3, top: 0, width: 200, height: 100 }).png().toBuffer().then((png) => ({ input: png, left: i * SLICE_W, top: 0 }))];
		})
	);
	const data = await sharp({ create: { width, height: 100, channels: 4, background: backdrop } }).composite(layers).raw().toBuffer();
	const words = rowWords(r.scene.prims);
	const tall = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${100 * words.length}" width="${width}" height="${100 * words.length}">${words.map((p, k) => `<g transform="translate(0 ${100 * k})">${emitPrim({ ...p, fill: "#FFFFFF" }, 0)}</g>`).join("")}</svg>`;
	const masks = await sharp(Buffer.from(tall)).ensureAlpha().raw().toBuffer();
	const alpha = (k: number, x: number, y: number): number => masks[((k * 100 + y) * width + x) * 4 + 3] as number;
	const inked = (x: number, y: number): boolean => words.some((_, k) => alpha(k, x, y) > 0);
	const lum = (i: number): number => {
		const hex = `#${[data[i], data[i + 1], data[i + 2]].map((v) => (v as number).toString(16).padStart(2, "0")).join("")}`;
		return luminance(hex);
	};
	let ratio = Number.POSITIVE_INFINITY;
	let at = "";
	words.forEach((p, k) => {
		const b = textInkBox(p);
		const fill = luminance(p.fill);
		for (let y = Math.max(0, Math.floor(b.y0) - 3); y < Math.min(100, Math.ceil(b.y1) + 3); y++) {
			for (let x = Math.max(0, Math.floor(b.x0) - 3); x < Math.min(width, Math.ceil(b.x1) + 3); x++) {
				if (inked(x, y)) continue;
				let next = false;
				for (let dy = -1; dy <= 1 && !next; dy++) for (let dx = -1; dx <= 1 && !next; dx++) next = y + dy >= 0 && y + dy < 100 && x + dx >= 0 && x + dx < width && alpha(k, x + dx, y + dy) > 128;
				if (!next) continue;
				const l = lum((y * width + x) * 4);
				const c = (Math.max(fill, l) + 0.05) / (Math.min(fill, l) + 0.05);
				if (c < ratio) {
					ratio = c;
					at = `"${p.text}" at ${x},${y}`;
				}
			}
		}
	});
	return { ratio, at };
}

/** One slice drawn as QtSvg draws a filtered group (its canvas widened by
 * the bleed, then cut to its slot), as raw RGBA over black. */
async function sliceRaster(svg: string): Promise<Buffer> {
	const wide = svg.replace('viewBox="0 0 200 100" width="200" height="100"', 'viewBox="-3 0 206 100" width="206" height="100"');
	return sharp(Buffer.from(wide)).extract({ left: 3, top: 0, width: 200, height: 100 }).flatten({ background: "#000000" }).raw().toBuffer();
}

describe("the row edge's region clips no letter beyond ASCII", () => {
	const NAMES = ["Lüfter Çıkış ÉÅ", "ÅÉÖÑŸ Temperature", "Температура ядра", "Température çà", "温度 GPU", "Şıçğ Ąę Ţ"];
	for (const font of ["tahoma", "segoe-ui"] as const) {
		it(`${font}: every slice draws the same as with the region the strip's full height`, async () => {
			setFaceFont(font);
			try {
				let compared = 0;
				for (const name of NAMES) {
					for (const [encoders, layout] of [[6, "whole"], [4, "split"]] as const) {
						const c = fixtureCase({ styles: ["trend", "area"], layout, encoders, background: "clear", accent: false });
						const input: StripSceneInput = { ...c.input, panes: c.input.panes.map((p) => ({ ...p, series: p.series.map((s) => ({ ...s, name })) })) };
						for (const svg of sliceStrip(input).slices) {
							if (svg === null || rowEdgeOf(svg).region === null) continue;
							const full = svg.replace(new RegExp(`(<filter id="${ROWS_FILTER}" filterUnits="userSpaceOnUse" x="-?[\\d.]+") y="[\\d.]+" width="([\\d.]+)" height="[\\d.]+"`), '$1 y="0" width="$2" height="100"');
							assert.notEqual(full, svg, `${name}: the region was not widened for the reference`);
							const [banded, reference] = await Promise.all([sliceRaster(svg), sliceRaster(full)]);
							assert.ok(banded.equals(reference), `${font} ${name} ${encoders} ${layout}: the row edge's region cuts pixels a full-height region draws`);
							compared++;
						}
					}
				}
				assert.ok(compared >= 12, String(compared));
			} finally {
				setFaceFont("tahoma");
			}
		});
	}
});

/** A full-height zigzag under every row word. */
function zigzag(background: DialBackground, theme: string, encoders: 4 | 6, layout: "whole" | "split"): StripSceneInput {
	const c = fixtureCase({ styles: ["trend", "compare"], layout, encoders, background, accent: false, theme, extras: [{ series: ["cpu"] }, { series: ["cpu", "gpu"] }] });
	const zig = (i: number) => (f: number) => 50 + 30 * Math.sign(Math.sin(f * 70 + i)) * Math.min(1, Math.abs(Math.sin(f * 70 + i)) * 3);
	return { ...c.input, panes: c.input.panes.map((p) => ({ ...p, series: p.series.map((s, i) => ({ ...s, history: makeView({ windowMs: s.history?.windowMs ?? 300_000, widthPx: s.history?.widthPx ?? 100, unit: s.unit, value: zig(i) }), current: 62.4 })) })) };
}

describe("rasterized: every pixel next to a row word's ink reads at 4.5:1 or better", () => {
	for (const theme of ["graphite", "ember", "paper"]) {
		it(`${theme}: Clear and Outline over white and black, a zigzag line under the words, + XL whole and + split`, async () => {
			for (const background of ["clear", "outline"] as const) {
				for (const backdrop of ["#FFFFFF", "#000000"]) {
					for (const [encoders, layout] of [[6, "whole"], [4, "split"]] as const) {
						const { ratio, at } = await worstNextToInk(zigzag(background, theme, encoders, layout), backdrop);
						assert.ok(ratio >= 4.5, `${theme} ${background} over ${backdrop} ${encoders} ${layout}: ${ratio.toFixed(2)} ${at}`);
					}
				}
			}
		});
	}
});

describe("the plot gained the rows' height; the rows keep their sizes", () => {
	it("the plot runs from PLOT_TOP to PLOT_BOTTOM (88 px; 60 px under a top row before), bands, lanes, cells and rows likewise", () => {
		assert.deepEqual(unitBands(1), [{ top: STRIP_ROWS.plotTop, bottom: STRIP_ROWS.plotBottom }]);
		assert.equal(STRIP_ROWS.plotBottom - STRIP_ROWS.plotTop, 88);
		assert.equal(LANES_BOTTOM - LANES_TOP, 92);
		assert.equal(laneHeight(2), 46);
		assert.deepEqual([EVENTS_TOP, EVENTS_BOTTOM, GROUP_TOP, GROUP_BOTTOM], [4, 94, 4, 94]);
		// Paused, the cursor runs the plot's height; every line stays in it.
		const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "theme", accent: false, paused: true });
		const prims = buildStripScene(c.input).prims;
		assert.ok(prims.some((p) => p.k === "rect" && p.w === 1 && p.y === STRIP_ROWS.plotTop && p.h === STRIP_ROWS.plotBottom - STRIP_ROWS.plotTop), "the cursor line");
		const ys = prims.flatMap((p) => (p.k === "line" ? p.pts.filter((_, i) => i % 2 === 1) : []));
		assert.ok(Math.min(...ys) >= STRIP_ROWS.plotTop && Math.max(...ys) <= STRIP_ROWS.plotBottom, `${Math.min(...ys)}..${Math.max(...ys)}`);
		// Heat cells take the same height.
		const heat = buildStripScene(fixtureCase({ styles: ["heat"], layout: "whole", encoders: 6, background: "theme", accent: false }).input).prims;
		assert.ok(heat.some((p) => p.k === "rect" && p.layer === "base" && p.y === STRIP_ROWS.plotTop && p.h === STRIP_ROWS.plotBottom - STRIP_ROWS.plotTop));
	});

	it("a row that runs out of room leaves its trailing parts out whole (never \"min…\" or \"max 8…\"), and a long first part steps down before it is cut", () => {
		let stepped = 0;
		for (const c of scenes(LOOKS)) {
			for (const p of rowWords(buildStripScene(c.input).prims)) {
				if (p.y !== STRIP_ROWS.bottomBaseline || p.anchor !== "start" || p.weight !== 600) continue;
				if (p.text.endsWith("…")) {
					assert.ok(!p.text.includes(" · "), `${c.id}: "${p.text}" cut inside a part`);
					assert.equal(p.size, 11, `${c.id}: "${p.text}" cut at ${p.size} px, before its smallest size`);
				}
				if (p.size < STRIP_ROWS.row && /times|once|never/.test(p.text)) stepped++;
			}
		}
		// The Events sentence on a + split pane's one timeline slot.
		assert.ok(stepped > 0, "no first part stepped down");
	});

	it("names and words at 16 px, LIVE at 15 px, the current value at 24 px, on both decks and layouts", () => {
		assert.deepEqual([STRIP_ROWS.label, STRIP_ROWS.row, STRIP_ROWS.badge, STRIP_ROWS.value], [16, 16, 15, 24]);
		for (const encoders of [4, 6] as const) {
			for (const layout of ["whole", "split"] as const) {
				for (const style of ["trend", "area", "heat"] as const) {
					const c = fixtureCase({ styles: [style, style], layout, encoders, background: "glass", accent: false, extras: [{ series: [style === "heat" ? "hot" : "cpu"] }, { series: [style === "heat" ? "hot" : "cpu"] }] });
					const words = rowWords(buildStripScene(c.input).prims);
					const id = `${style} ${encoders} ${layout}`;
					const value = words.find((p) => p.y === STRIP_ROWS.topBaseline && p.weight === 700);
					assert.equal(value?.size, 24, `${id}: the current value`);
					const name = words.find((p) => p.y === STRIP_ROWS.topBaseline && p.anchor === "start" && !/(warn|crit) \d/.test(p.text));
					if (style !== "heat") assert.equal(name?.size, 16, `${id}: the name`);
					assert.equal(words.find((p) => p.text === "LIVE")?.size, 15, `${id}: LIVE`);
					assert.equal(words.find((p) => p.y === STRIP_ROWS.bottomBaseline && p.anchor === "start" && p.text.startsWith("5 min"))?.size, 16, `${id}: the window's words`);
				}
			}
		}
	});
});

const meets = (a: { x0: number; x1: number; y0: number; y1: number }, b: { x0: number; x1: number; y0: number; y1: number }): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("no row word and no row edge lies on a large readout's digits", () => {
	it("across the readout matrix and Group's readout", () => {
		const cases: FixtureCase[] = [...readoutMatrix().filter((c) => c.id.includes("-left")), ...(["auto", "rows", "spread"] as const).map((view) => groupFixture({ n: 16, view, encoders: 4, layout: "split", limits: { warn: 85, crit: 95 } }))];
		let digits = 0;
		for (const c of cases) {
			const scene = buildStripScene(c.input);
			const big = scene.prims.filter((p): p is TextPrim => p.k === "text" && p.size >= 24 && p.layer !== "rows").map((p) => ({ p, b: textInkBox(p) }));
			// A row word's edge reaches 1 px past its ink.
			const words = rowWords(scene.prims).map(textInkBox).map((w) => ({ x0: w.x0 - 1, x1: w.x1 + 1, y0: w.y0 - 1, y1: w.y1 + 1 }));
			for (const { p, b } of big) {
				digits++;
				assert.equal(p.layer, "marks", `${c.id}: "${p.text}" in the row edge`);
				assert.ok(!words.some((w) => meets(w, b)), `${c.id}: a row word over "${p.text}"`);
			}
		}
		assert.ok(digits > 200, String(digits));
	});
});

describe("a reading in another unit draws in a band of its own", () => {
	for (const style of ["compare", "trend"] as const) {
		it(`${style} of Virtual Memory Committed, Available (MB) and Load (%): every reading draws, two bands, values and scale ends`, () => {
			// One look of each kind (no backdrop, the art, Theme): the bands'
			// layout does not depend on the look.
			for (const background of ["clear", "stars", "theme"] as const) {
				for (const encoders of [4, 6] as const) {
					for (const layout of ["whole", "split"] as const) {
						const c = mixed(style, background, encoders, layout);
						const r = sliceStrip(c.input);
						const id = `${c.id}`;
						assert.ok(r.slices.every((s) => s === null || !s.includes("other unit")), `${id}: "other unit" in a slice`);
						const prims = r.scene.prims;
						const panes = layout === "whole" ? 1 : 2;
						assert.equal(prims.filter((p) => p.k === "line").length >= 3 * panes, true, `${id}: three lines a pane`);
						// Two bands: the hairline between them, and each band's ends.
						const [top, bottom] = unitBands(2) as [{ top: number; bottom: number }, { top: number; bottom: number }];
						const hairlines = prims.filter((p) => p.k === "rect" && p.h === 1 && p.y > top.bottom && p.y < bottom.top);
						assert.equal(hairlines.length, panes, `${id}: one hairline a pane`);
						const ends = rowWords(prims).filter((p) => p.size === 11 && p.x < SLICE_W && p.anchor === "start").map((p) => p.text);
						assert.ok(ends.some((t) => /GB$/.test(t)) && ends.some((t) => / %$/.test(t)), `${id}: each band's top end names its unit: ${ends.join("|")}`);
						assert.ok(ends.length >= 4, `${id}: two ends a band: ${ends.join("|")}`);
						// The legend: every reading, each with its value and unit.
						const legend = rowWords(prims).filter((p) => p.y === STRIP_ROWS.topBaseline).map((p) => p.text).join(" ");
						for (const v of [/\d+(\.\d)? GB/, /\d+(\.\d)? %/]) assert.match(legend, v, `${id}: ${legend}`);
						assert.ok(/Load|Committed|Available/.test(legend), `${id}: ${legend}`);
					}
				}
			}
		});
	}

	it("one unit draws one band, as before: no hairline, both ends of its scale named", () => {
		const prims = buildStripScene(fixtureCase({ styles: ["compare"], layout: "whole", encoders: 6, background: "theme", accent: false, extras: [{ series: ["cpu", "gpu", "hot"] }] }).input).prims;
		const ends = rowWords(prims).filter((p) => p.size === 11 && p.x < SLICE_W).map((p) => p.text);
		assert.equal(ends.length, 2, ends.join("|"));
		assert.ok(ends.some((t) => t.endsWith("°C")));
		// Structure lines: the baseline alone (no gridlines without Scale and grid).
		const track = `fill="${resolvePalette(themes, "graphite", null, "normal").track}"`;
		assert.deepEqual(prims.filter((p) => p.k === "rect" && p.h === 1 && p.paint === track).map((p) => (p as { y: number }).y), [STRIP_ROWS.plotBottom + 1]);
	});
});

describe("payload: every slice inside the bound, the deck art's piece included", () => {
	it("every row style, Group and the mixed-unit panes on every art look and Clear, painted", () => {
		let worst = 0;
		let worstId = "";
		for (const c of scenes([...ART_LOOKS, "clear"])) {
			const r = sliceStrip(c.input);
			const art = isArtLook(c.input.config.background);
			const limit = SLICE_PAYLOAD_LIMIT - (art ? ART_PIECE_LIMIT : 0);
			assert.ok(r.maxBytes <= limit, `${c.id}: ${r.maxBytes} over ${limit}`);
			const encoders = c.input.encoders;
			r.slices.forEach((svg, column) => {
				if (svg === null) return;
				const painted = art ? paintArt(svg, artPlace({ id: "deck", type: encoders === 6 ? 13 : 7, columns: encoders === 6 ? 9 : 4, rows: encoders === 6 ? 4 : 2 }, { column, row: 0 }, `dial-${column}`, true)) : svg;
				const bytes = svgBytes(painted);
				assert.ok(bytes <= SLICE_PAYLOAD_LIMIT, `${c.id} column ${column}: ${bytes}`);
				if (bytes > worst) {
					worst = bytes;
					worstId = `${c.id} column ${column}`;
				}
			});
		}
		console.error(`overlay rows: largest painted slice ${worst} bytes (${worstId})`);
	});
});
