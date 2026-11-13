/**
 * Strip slices: bounded per-slice SVG in slice-local coordinates, exact cuts
 * at the bleed, the payload bound, and SEAM CONTINUITY: for every graph
 * style, every background with Words in the accent color on and off, both
 * decks and both layouts, the stitched slices rasterized with sharp
 * (librsvg) match the full-width reference frame, including a one-bucket
 * spike next to a seam and a label that crosses one.
 *
 * Outline and Tint: librsvg clips a filter's input to the canvas, so a
 * plain 200 px render cannot see the marks 1 px past a slice edge and its
 * edge ring differs in the two columns at each seam (an engine limit; QtSvg
 * must be proven on the device). Those looks are compared on a canvas
 * widened by the bleed and cropped back, which is what a renderer that
 * honors the widened filter region draws; the plain render is held to
 * differing only in those seam columns.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { fixtureCase, makeView, renderCase, diffRasters, seamMatrix, STRIP_STYLES_ALL, type FixtureCase } from "../scripts/lib/strip-fixtures";
import { dialFaceOpen, haloFilterDefsAt, haloRingColor, type DialBackground } from "../src/ui/dial-background";
import { setFaceFont } from "../src/ui/face-font";
import { loadThemes, resolvePalette } from "../src/ui/themes";
import { cursorAgoMs, cursorBucketsBack, paneExtents, plotFor, SLICE_W, type BucketPx } from "../src/strip/geometry";
import { buildStripScene, stripBandsFor, type StripSceneInput, type StripSeriesInput } from "../src/strip/scene";
import { stripPaneOf } from "../src/strip/settings";
import { cutPolyline, sliceScene, sliceStrip, SLICE_PAYLOAD_LIMIT, SLICE_RETURN_SHARE, svgBytes } from "../src/strip/slicer";

setFaceFont("tahoma");

describe("the independent dial's Outline filter is untouched", () => {
	it("dialFaceOpen draws 1.7.1's bytes for every theme, look and filter region", () => {
		const themes = loadThemes();
		const all: string[] = [];
		for (const t of Object.keys(themes.themes)) {
			for (const bg of ["theme", "glass", "tint", "outline", "clear"] as DialBackground[]) {
				for (const [top, height] of [[0, 100], [30, 40], [12, 60]] as const) all.push(JSON.stringify(dialFaceOpen(bg, resolvePalette(themes, t, null, "normal"), top, height)));
			}
		}
		// Hash of the same 105 openings rendered by the 1.7.1 implementation.
		assert.equal(createHash("sha256").update(all.join("\n")).digest("hex"), "eb0af352930a27bd0f12640a6f52a868bb3fec35cae0694760edcefefa8fb227");
	});

	it("haloFilterDefsAt over the 200 px slot is the dial's own filter", () => {
		const palette = resolvePalette(loadThemes(), "paper", null, "normal");
		assert.equal(dialFaceOpen("outline", palette, 30, 40)[1], haloFilterDefsAt(haloRingColor(palette), 0, 30, 200, 40));
		assert.match(haloFilterDefsAt("#000000", -3, 0, 206, 100), /x="-3" y="0" width="206" height="100"/);
	});
});

describe("cutPolyline", () => {
	it("keeps the points inside and cuts exactly at the band edges", () => {
		assert.deepEqual(cutPolyline([0, 10, 10, 20, 20, 30], 5, 15), [5, 15, 10, 20, 15, 25]);
		assert.deepEqual(cutPolyline([0, 0, 100, 100], 40, 60), [40, 40, 60, 60], "a segment passing straight through");
		assert.equal(cutPolyline([0, 0, 10, 10], 20, 30), undefined);
		assert.equal(cutPolyline([50, 0, 60, 10], 20, 30), undefined);
		assert.deepEqual(cutPolyline([10, 1, 10, 9, 12, 5], 10, 11), [10, 1, 10, 9, 11, 7], "a vertical bucket segment on the edge stays whole");
	});
});

/** Absolute x of every geometry coordinate in a slice (paths walked
 * command by command, rect x and x + width). */
function geometryXs(svg: string): number[] {
	const xs: number[] = [];
	for (const m of svg.matchAll(/<rect x="(-?[\d.]+)" y="-?[\d.]+" width="([\d.]+)"[^>]*>/g)) xs.push(Number(m[1]), Number(m[1]) + Number(m[2]));
	for (const m of svg.matchAll(/<path d="([^"]+)"/g)) {
		const tokens = (m[1] as string).match(/[MlVhvZ]|-?[\d.]+/g) ?? [];
		let cmd = "";
		let x = 0;
		let start = 0;
		for (let i = 0; i < tokens.length; i++) {
			const t = tokens[i] as string;
			if (/[MlVhvZ]/.test(t)) {
				cmd = t;
				if (t === "Z") x = start;
				continue;
			}
			if (cmd === "M") {
				x = Number(t);
				start = x;
				i++;
				cmd = "l";
				xs.push(x);
			} else if (cmd === "l") {
				x += Number(t);
				i++;
				xs.push(x);
			} else if (cmd === "h") {
				x += Number(t);
				xs.push(x);
			}
		}
	}
	return xs;
}

type TextEl = { x: number; rest: string };
function texts(svg: string): TextEl[] {
	return [...svg.matchAll(/<text x="(-?[\d.]+)"([^>]*>[^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), rest: m[2] as string }));
}

describe("slice bounds", () => {
	const cases = seamMatrix();
	it("every slice is a 200 x 100 slice-local SVG with every geometry coordinate within [-2, 202]", () => {
		let checked = 0;
		for (const c of cases) {
			const { slices } = sliceStrip(c.input);
			for (const svg of slices) {
				assert.ok(svg !== null);
				assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">'), c.id);
				for (const x of geometryXs(svg)) {
					assert.ok(x >= -2 - 1e-9 && x <= 202 + 1e-9, `${c.id}: x ${x}`);
					checked++;
				}
				if (svg.includes('filter id="h"')) assert.match(svg, /filterUnits="userSpaceOnUse" x="-3" y="0" width="206" height="100"/);
			}
		}
		assert.ok(checked > 10_000);
	});

	it("a text anchored outside the slice is a label crossing a seam, drawn identically in its neighbour", () => {
		let crossing = 0;
		for (const c of cases) {
			const { slices } = sliceStrip(c.input);
			slices.forEach((svg, column) => {
				for (const t of texts(svg as string)) {
					if (t.x >= -2 && t.x <= 202) continue;
					const neighbour = t.x < 0 ? column - 1 : column + 1;
					const shifted = t.x < 0 ? t.x + SLICE_W : t.x - SLICE_W;
					const twin = texts(slices[neighbour] ?? "").find((u) => Math.abs(u.x - shifted) < 1e-9 && u.rest === t.rest);
					assert.ok(twin, `${c.id} column ${column}: ${t.rest}`);
					crossing++;
				}
			});
		}
		assert.ok(crossing > 0, "the matrix holds labels that cross a seam");
	});

	it("each slice stays under the payload bound and is deterministic", () => {
		let worst = 0;
		for (const c of cases) {
			const a = sliceStrip(c.input);
			const b = sliceStrip(c.input);
			assert.deepEqual(a.slices, b.slices, c.id);
			assert.ok(a.maxBytes <= SLICE_PAYLOAD_LIMIT, `${c.id}: ${a.maxBytes}`);
			worst = Math.max(worst, a.maxBytes);
		}
		assert.ok(worst > 1000);
	});

	it("a slice over the bound is rebuilt from coarser buckets, for every slice at once", () => {
		const base = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "clear", accent: false });
		// One column per pixel, each a different value: the densest line there is.
		const dense = (k: number) => makeView({ windowMs: 300_000, widthPx: 1200, unit: "°C", value: (f) => 50 + 40 * Math.sin(f * 1200 * (1.3 + k)) });
		const noisy = {
			...base.input,
			bucketPx: 1 as const,
			panes: base.input.panes.map((p) => ({ ...p, series: p.series.map((s, k) => ({ ...s, history: dense(k) })) }))
		};
		const fine = buildStripScene(noisy);
		const fineBytes = Math.max(...fine.present.map((_, c) => svgBytes(sliceScene(fine, c))));
		assert.ok(fineBytes > SLICE_PAYLOAD_LIMIT, `fixture must start over the bound (${fineBytes})`);
		const result = sliceStrip(noisy);
		assert.equal(result.coarsened, true);
		assert.ok(result.bucketPx > 1);
		assert.ok(result.maxBytes <= SLICE_PAYLOAD_LIMIT, String(result.maxBytes));
		assert.ok(result.slices.every((s) => s !== null && s.length > 0));
	});

	it("an absent member gets no slice; present ones keep their time positions", () => {
		const whole = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: "theme", accent: false });
		const partial = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: "theme", accent: false, present: [true, false, true, true] });
		const a = sliceStrip(whole.input);
		const b = sliceStrip(partial.input);
		assert.equal(b.slices[1], null);
		const pathsOf = (svg: string | null | undefined): string[] => [...(svg ?? "").matchAll(/<path d="[^"]+" fill="none"[^>]*>/g)].map((m) => m[0]);
		assert.deepEqual(pathsOf(b.slices[3]), pathsOf(a.slices[3]), "the graph in a present slot is not stretched into the gap");
		assert.match(b.slices[0] ?? "", /Dial 2 missing/);
	});
});

const TOLERANCE = 2;
/** Antialiasing noise allowed per case: cairo's scan converter picks its
 * row mode from every edge in a row, so geometry in another slice can move
 * a pixel's coverage by a few levels. A seam break (a restarted graph, a
 * doubled panel, a missing ring) moves hundreds of pixels by far more. */
const NOISE_MAX = 40;
const NOISE_PIXELS = 32;

/** Whether a case draws an edge filter: Outline and Tint ring their marks,
 * and every look rings the words its rows draw over the plot (scene.ts
 * ROWS_FILTER). A filter that sees only its slice's viewport (librsvg)
 * loses the ring where ink sits in the neighbour, so these render as the
 * app's QtSvg does: past the viewport. */
function isHalo(c: FixtureCase): boolean {
	return c.input.config.background === "tint" || c.input.config.background === "outline" || buildStripScene(c.input).prims.some((p) => p.layer === "rows");
}

describe("seam continuity: stitched slices match the full-width frame", () => {
	const cases = seamMatrix();
	it(`covers ${cases.length} scenes: 5 styles x 10 looks x 2 decks x 2 layouts`, () => {
		assert.equal(cases.length, 200);
		const ids = new Set(cases.map((c) => c.id));
		assert.equal(ids.size, cases.length);
	});

	it("each fixture puts a sharp spike next to a seam", () => {
		const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: "theme", accent: false });
		const scene = buildStripScene(c.input);
		// A point standing more than 20 px above both neighbours.
		const spikes = scene.prims.filter((p) => p.k === "line").flatMap((p) => {
			const out: number[] = [];
			for (let i = 2; i + 2 < p.pts.length; i += 2) {
				const y = p.pts[i + 1] as number;
				if ((p.pts[i - 1] as number) - y > 20 && (p.pts[i + 3] as number) - y > 20) out.push(p.pts[i] as number);
			}
			return out;
		});
		assert.ok(spikes.some((x) => Math.abs(x - 200) <= 2), `spikes at ${spikes.join(",")}`);
	});

	for (const encoders of [4, 6] as const) {
		for (const layout of ["whole", "split"] as const) {
			it(`${encoders === 4 ? "Stream Deck +" : "Stream Deck + XL"}, ${layout}: every style and look`, async () => {
				for (const c of cases.filter((k) => k.input.encoders === encoders && k.input.config.layout === layout)) {
					const halo = isHalo(c);
					const r = await renderCase(c, halo);
					const d = diffRasters(r.reference, r.stitched, TOLERANCE);
					assert.ok(d.maxDiff <= NOISE_MAX && d.over <= NOISE_PIXELS, `${c.id}: max ${d.maxDiff}, ${d.over} px over ${TOLERANCE} (worst ${JSON.stringify(d.worst)})`);
					if (halo) {
						// The plain render may differ only at the seams.
						const plain = await renderCase(c, false);
						const seams = new Set<number>();
						for (let s = SLICE_W; s < r.width; s += SLICE_W) seams.add(s - 1).add(s);
						const p = diffRasters(plain.reference, plain.stitched, NOISE_MAX);
						for (const x of p.columns) assert.ok(seams.has(x), `${c.id}: plain render differs at x ${x}, away from a seam`);
					}
				}
			});
		}
	}
});

describe("the bucket width holds from frame to frame", () => {
	// Three noisy Trend series on Clear: the densest common look. The noise
	// amplitude is found, not fixed: the first that puts the largest 2 px
	// slice at the bound, so it flips with each scrolled frame (`shift`),
	// and the first whose 2 px frame sits inside the return margin. A
	// change of a few bytes anywhere in the face moves the amplitude, not
	// what these tests prove.
	const base = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: "clear", accent: false });
	const pane = stripPaneOf({ style: "trend", series: [{ key: "a" }, { key: "b" }, { key: "c" }] });
	const frame = (amp: number, shift: number): StripSceneInput => ({
		...base.input,
		config: { ...base.input.config, panes: [pane, pane] },
		panes: [
			{
				series: ["a", "b", "c"].map((key, k) => ({ key, name: key, unit: "°C", state: "ok" as const, current: 50, history: makeView({ windowMs: 300_000, widthPx: 400, unit: "°C", value: (f) => 50 + 10 * k + amp * Math.sin((f + shift) * 997 * (1.7 + k)) }) })),
				bands: [],
				view: { mode: "live" },
				highlight: 0
			}
		]
	});
	const shifts = Array.from({ length: 20 }, (_, i) => i * 0.003);
	const amps = Array.from({ length: 581 }, (_, i) => 0.1 + i * 0.005);
	/** The largest slice of a frame at 2 px. */
	const at2 = (amp: number, shift: number): number => {
		const scene = buildStripScene({ ...frame(amp, shift), bucketPx: 2 });
		return Math.max(...scene.present.map((_, c) => svgBytes(sliceScene(scene, c))));
	};
	// The bytes move with the amplitude in steps of hundreds and with the
	// scroll by tens: only amplitudes near the bound are tried scrolled.
	const flips = amps
		.filter((amp) => Math.abs(at2(amp, 0) - SLICE_PAYLOAD_LIMIT) < 200)
		.find((amp) => {
			const widths = shifts.map((s) => sliceStrip(frame(amp, s)).bucketPx);
			return widths.includes(2) && widths.includes(4);
		});
	const inMargin = amps.find((amp) => {
		const r = sliceStrip(frame(amp, 0));
		return r.bucketPx === 2 && r.maxBytes > SLICE_PAYLOAD_LIMIT * SLICE_RETURN_SHARE && r.maxBytes <= SLICE_PAYLOAD_LIMIT;
	});

	it("without the held width a frame at the bound flips between widths (the fixture is at the bound)", () => {
		assert.ok(flips !== undefined, "an amplitude between 0.1 and 3 puts the frame at the bound");
		const widths = shifts.map((s) => sliceStrip(frame(flips, s)).bucketPx);
		assert.ok(widths.includes(2) && widths.includes(4), widths.join(","));
	});

	it("with the previous frame's width held, the width changes at most once", () => {
		let held: BucketPx | undefined;
		const widths: number[] = [];
		for (const s of shifts) {
			const r = sliceStrip(frame(flips ?? 2.1, s), held);
			assert.ok(r.maxBytes <= SLICE_PAYLOAD_LIMIT);
			held = r.bucketPx;
			widths.push(r.bucketPx);
		}
		const changes = widths.filter((w, i) => i > 0 && w !== widths[i - 1]).length;
		assert.ok(changes <= 1, widths.join(","));
	});

	it("a finer width that fits only without the margin is not taken back; one that fits with it is", () => {
		assert.ok(inMargin !== undefined, "an amplitude between 0.1 and 3 sits in the margin");
		const atBound = frame(inMargin, 0);
		const fine = sliceStrip(atBound);
		assert.equal(fine.bucketPx, 2);
		assert.ok(fine.maxBytes > SLICE_PAYLOAD_LIMIT * SLICE_RETURN_SHARE && fine.maxBytes <= SLICE_PAYLOAD_LIMIT, `fixture sits in the margin (${fine.maxBytes})`);
		assert.equal(sliceStrip(atBound, 4).bucketPx, 4, "held coarse: the margin keeps it");
		assert.equal(sliceStrip(atBound, 2).bucketPx, 2, "held fine: the bound alone decides");
		const light = frame(0.05, 0);
		assert.ok(sliceStrip(light).maxBytes <= SLICE_PAYLOAD_LIMIT * SLICE_RETURN_SHARE);
		assert.equal(sliceStrip(light, 4).bucketPx, 2, "room to spare: back to the finer width");
		assert.equal(sliceStrip(light, 1 as BucketPx).bucketPx, 2, "a held width finer than the input's own start is ignored");
	});

	it("the inspect cursor is a time: a change of width keeps it where the user put it", () => {
		const extent = paneExtents("whole", 4)[0] as { x0: number; x1: number };
		const fine = plotFor("trend", extent, 2);
		const coarse = plotFor("trend", extent, 4);
		for (const back of [0, 1, 37, 99, 250, 399]) {
			const agoMs = cursorAgoMs(fine, 300_000, back);
			assert.equal(cursorBucketsBack(fine, 300_000, agoMs), back, `round trip at ${back}`);
			assert.equal(cursorBucketsBack(coarse, 300_000, agoMs), Math.floor(back / 2), `the same time at 4 px (${back})`);
		}
		// The scene marks the same moment at both widths: the cursor line sits
		// inside the coarse bucket that holds the fine bucket.
		const paused = (bucketPx: BucketPx): number => {
			const input = { ...frame(1, 0), bucketPx, panes: frame(1, 0).panes.map((p) => ({ ...p, view: { mode: "paused" as const, agoMs: cursorAgoMs(fine, 300_000, 99) } })) };
			const scene = buildStripScene(input);
			return (scene.prims.find((p) => p.k === "rect" && p.w === 1 && p.h > 50) as { x: number }).x;
		};
		const atFine = paused(2);
		const atCoarse = paused(4);
		assert.ok(Math.abs(atFine - atCoarse) <= 2, `${atFine} vs ${atCoarse}`);
	});
});

describe("no slice is ever sent over the payload bound", () => {
	// A seeded generator of worst-case scenes: every style, look, deck and
	// layout, one to four readings each with noise, spikes and gaps as dense
	// as every other column, Scale and grid, min and max, bands, readouts
	// and a finer start width. The bucket ladder handles most; what it
	// cannot is drawn as values without the graph, never sent over.
	const rand = (seed: number): (() => number) => {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	};
	const STYLES = STRIP_STYLES_ALL;
	const LOOKS = ["theme", "glass", "tint", "outline", "clear"] as const;
	const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;

	function worstCase(seed: number): StripSceneInput {
		const r = rand(seed);
		const encoders = pick(r, [4, 6] as const);
		const layout = pick(r, ["whole", "split"] as const);
		const background = pick(r, LOOKS);
		const base = fixtureCase({ styles: [pick(r, STYLES), pick(r, STYLES)], layout, encoders, background, accent: r() < 0.5 });
		const n = layout === "whole" ? 1 : 2;
		const width = encoders * 200;
		const panes = Array.from({ length: n }, (_, i) => {
			const style = base.input.config.panes[i]?.style ?? "trend";
			const count = 1 + Math.floor(r() * 4);
			const keys = Array.from({ length: count }, (_, k) => `s${i}${k}:0:1`);
			const gapEvery = pick(r, [0, 2, 3, 7]);
			const gaps: [number, number][] = gapEvery === 0 ? [] : Array.from({ length: Math.floor(width / gapEvery) }, (_, g) => [(g * gapEvery) / width, (g * gapEvery + 1) / width]);
			const amp = 1 + r() * 60;
			const series: StripSeriesInput[] = keys.map((key, k) => ({
				key,
				name: `Reading ${i}${k} Temperature Sensor`,
				unit: "°C",
				state: "ok",
				current: 50 + k,
				history: makeView({ windowMs: 300_000, widthPx: width, unit: "°C", value: (f) => 50 + 10 * k + amp * Math.sin(f * 4001 * (1.3 + k)), gaps, spike: { column: Math.floor(r() * width), value: 150 } })
			}));
			const pane = stripPaneOf({
				style,
				series: keys.map((key) => ({ key })),
				overlays: { current: true, minmax: true, unit: true, legend: true, time: true, ...(r() < 0.5 ? { axes: true } : {}) },
				bands: keys.slice(0, 2).map((key) => ({ key, warn: 60, crit: 80 })),
				...(r() < 0.3 ? { readout: pick(r, ["left", "only"] as const) } : {})
			});
			return { pane, input: { series, bands: stripBandsFor(pane, series, { fahrenheit: false, decimals: "auto" }), view: r() < 0.2 ? { mode: "paused" as const, label: "12:00:01", agoMs: 30_000 } : { mode: "live" as const }, highlight: 0 } };
		});
		const config = { ...base.input.config, panes: [panes[0]?.pane ?? stripPaneOf({}), panes[1]?.pane ?? stripPaneOf({})] as const };
		return { ...base.input, config, panes: panes.map((p) => p.input), bucketPx: pick(r, [1, 2] as const) };
	}

	it("over 160 seeded worst-case scenes, every slice is at most 8192 bytes", () => {
		let worst = 0;
		let reduced = 0;
		for (let seed = 1; seed <= 160; seed++) {
			const result = sliceStrip(worstCase(seed));
			for (const svg of result.slices) {
				if (svg === null) continue;
				const bytes = svgBytes(svg);
				assert.ok(bytes <= SLICE_PAYLOAD_LIMIT, `seed ${seed}: ${bytes} bytes`);
				worst = Math.max(worst, bytes);
			}
			if (result.reduced === true) reduced++;
		}
		assert.ok(worst > SLICE_PAYLOAD_LIMIT * 0.5, `the generator reaches near the bound (${worst})`);
		assert.ok(reduced > 0, "some scenes pass the whole ladder and fall back");
	});

	it("a graph too dense for the coarsest buckets draws its values without the graph", () => {
		const base = fixtureCase({ styles: ["compare"], layout: "whole", encoders: 6, background: "clear", accent: false });
		const gaps: [number, number][] = Array.from({ length: 600 }, (_, g) => [(g * 2) / 1200, (g * 2 + 1) / 1200]);
		const keys = ["a", "b", "c", "d"];
		const pane = stripPaneOf({ style: "compare", series: keys.map((key) => ({ key })), overlays: { minmax: true, axes: true } });
		const input: StripSceneInput = {
			...base.input,
			bucketPx: 1,
			config: { ...base.input.config, panes: [pane, pane] },
			panes: [{ series: keys.map((key, k) => ({ key, name: key.toUpperCase(), unit: "°C", state: "ok" as const, current: 40 + k, history: makeView({ windowMs: 300_000, widthPx: 1200, unit: "°C", value: (f) => 50 + 30 * Math.sin(f * 5000 * (1 + k)), gaps }) })), bands: [], view: { mode: "live" }, highlight: 0 }]
		};
		const coarsest = buildStripScene({ ...input, bucketPx: 8 });
		const over = Math.max(...coarsest.present.map((_, c) => svgBytes(sliceScene(coarsest, c))));
		assert.ok(over > SLICE_PAYLOAD_LIMIT, `fixture must pass the bound even at 8 px (${over})`);
		const result = sliceStrip(input);
		assert.equal(result.reduced, true);
		assert.ok(result.maxBytes <= SLICE_PAYLOAD_LIMIT, String(result.maxBytes));
		assert.ok(result.slices.every((s) => s !== null && !/<path d="M[^"]*l/.test(s)), "no graph line is drawn");
		const texts = result.scene.prims.filter((p) => p.k === "text").map((p) => (p as { text: string }).text);
		for (const v of ["40.0", "41.0", "42.0", "43.0"]) assert.ok(texts.some((t) => t.startsWith(v.slice(0, 2))), `the value ${v} is there: ${JSON.stringify(texts)}`);
	});
});
