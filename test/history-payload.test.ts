/**
 * The compact Trend window drawing (src/ui/timeline.ts) against the plain
 * one it replaced: every column's first, min, max and last value joined in
 * order, one polyline per segment, and an under-fill through the same
 * points. The compact path must draw the same line within the half-pixel
 * grid (so each column's min and max are still drawn and nothing joins
 * across a gap), fill the same area, and keep whole faces small: about 3 KB
 * for a 15-minute key face on ordinary data. Sizes come from the seeded
 * series in scripts/history-payload.ts, which prints the full table.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { faceSizes, filledStore, SERIES_KINDS, seriesValues, type SeriesKind } from "../scripts/history-payload";
import { HistoryStore } from "../src/history/store";
import type { HistoryView, HistoryWindowId } from "../src/history/types";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { loadThemes, resolvePalette } from "../src/ui/themes";
import { timelineSvg, type TimelineBox } from "../src/ui/timeline";

const PALETTE = resolvePalette(loadThemes(), "void", null, "normal");
const FILL = `fill="${PALETTE.track}"`;
/** See "draws byte for byte what it drew before". */
const TIMELINE_DIGEST = "7466a7454525e9780bd141bf059c3baa8c505e4972cd45765d9766338475d1b9";
/** Half a grid step in x and in y, as a distance, plus float slack. */
const TOL = Math.SQRT1_2 * 0.5 + 1e-6;

type Point = { x: number; y: number };
type Seg = readonly [Point, Point];

function subpaths(d: string): Point[][] {
	const out: Point[][] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MLHVZmlhvz])([^MLHVZmlhvz]*)/g)) {
		const n = [...(args as string).matchAll(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)].map((m) => Number(m[0]));
		const rel = cmd === (cmd as string).toLowerCase();
		const upper = (cmd as string).toUpperCase();
		if (upper === "Z") continue;
		for (let i = 0; i < n.length; ) {
			if (upper === "H") x = (rel ? x : 0) + (n[i++] as number);
			else if (upper === "V") y = (rel ? y : 0) + (n[i++] as number);
			else {
				x = (rel ? x : 0) + (n[i++] as number);
				y = (rel ? y : 0) + (n[i++] as number);
			}
			if (upper === "M" && i <= 2) out.push([]);
			(out[out.length - 1] as Point[]).push({ x, y });
		}
	}
	return out;
}

interface Drawn {
	line: Point[][];
	fill: Point[][];
	dots: Point[];
	lineD: string[];
	fillD: string[];
}

function parse(svg: string): Drawn {
	const lineD = [...svg.matchAll(/<path d="([^"]*)" fill="none" stroke=/g)].map((m) => m[1] as string);
	const fillD = [...svg.matchAll(/<path d="([^"]*Z)"/g)].map((m) => m[1] as string);
	return {
		line: lineD.flatMap(subpaths),
		fill: fillD.flatMap(subpaths),
		dots: [...svg.matchAll(/<circle cx="([^"]*)" cy="([^"]*)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) })),
		lineD,
		fillD
	};
}

/** The plain drawing's geometry: per run (a brief boundary keeps the pen
 * down), every column's four values in order, unrounded. */
function reference(view: HistoryView, box: TimelineBox): { runs: Point[][]; fills: Point[][] } {
	const { cols, extent } = view;
	const span = (extent?.max ?? 0) - (extent?.min ?? 0);
	const bottom = box.y + box.h;
	const px = (col: number): number => box.x + ((col + 0.5) * box.w) / view.widthPx;
	const py = (v: number): number => bottom - (span === 0 ? 0.5 : (v - (extent?.min ?? 0)) / span) * box.h;
	const runs: Point[][] = [];
	const fills: Point[][] = [];
	let seg = -1;
	for (let i = 0; i < cols.n; i++) {
		const x = px(cols.x[i] as number);
		if (cols.seg[i] !== seg) {
			const joined = seg >= 0 && cols.seg[i] === seg + 1 && view.segments[seg + 1]?.brief === true;
			seg = cols.seg[i] as number;
			if (!joined) {
				runs.push([]);
				fills.push([{ x, y: bottom }]);
			}
		}
		for (const v of [cols.first[i], cols.min[i], cols.max[i], cols.last[i]] as number[]) (runs[runs.length - 1] as Point[]).push({ x, y: py(v) });
		(fills[fills.length - 1] as Point[]).push({ x, y: py(cols.first[i] as number) }, { x, y: py(cols.last[i] as number) });
	}
	for (const f of fills) f.push({ x: (f[f.length - 1] as Point).x, y: bottom });
	return { runs, fills };
}

function segmentsOf(paths: readonly Point[][], points: readonly Point[] = []): Seg[] {
	const out: Seg[] = [];
	for (const p of paths) {
		if (p.length === 1) out.push([p[0] as Point, p[0] as Point]);
		for (let i = 1; i < p.length; i++) out.push([p[i - 1] as Point, p[i] as Point]);
	}
	for (const d of points) out.push([d, d]);
	return out;
}

function distance(p: Point, [a, b]: Seg): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = dx * dx + dy * dy;
	const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The farthest any point of `from` (sampled along each segment) lies from
 * the skeleton `to`: one direction of the Hausdorff distance. */
function farthest(from: readonly Seg[], to: readonly Seg[]): { gap: number; at: Point } {
	let worst = { gap: 0, at: { x: 0, y: 0 } };
	for (const [a, b] of from) {
		for (let k = 0; k <= 8; k++) {
			const p = { x: a.x + ((b.x - a.x) * k) / 8, y: a.y + ((b.y - a.y) * k) / 8 };
			let best = Number.POSITIVE_INFINITY;
			for (const s of to) {
				if (Math.min(s[0].x, s[1].x) - 1 > p.x || Math.max(s[0].x, s[1].x) + 1 < p.x) continue;
				best = Math.min(best, distance(p, s));
				if (best <= TOL) break;
			}
			if (best > worst.gap) worst = { gap: best, at: p };
		}
	}
	return worst;
}

function area(polygon: readonly Point[]): number {
	let sum = 0;
	for (let i = 0; i < polygon.length; i++) {
		const a = polygon[i] as Point;
		const b = polygon[(i + 1) % polygon.length] as Point;
		sum += a.x * b.y - b.x * a.y;
	}
	return Math.abs(sum) / 2;
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function reading(key: string, value: number): Reading {
	return { key, type: SensorType.Temperature, sensorIndex: 0, id: 1, label: "CPU", unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value };
}

/** 20 minutes of one-per-second random readings with spikes, a few skipped
 * reads (each ends a segment) and a few withheld readings (missing). */
function randomStore(seed: number): { store: HistoryStore; now: number } {
	const rnd = mulberry32(seed);
	const store = new HistoryStore({ now: () => 0 });
	store.setInterest("probe", [{ savedKey: "r:0:1", window: ["1m", "5m", "15m"] }]);
	let level = 50;
	let at = 0;
	for (let i = 0; i < 1200; i++) {
		at += 1000;
		const roll = rnd();
		if (roll < 0.004) {
			store.ingest({ kind: "skipped", at });
			continue;
		}
		level = Math.max(20, Math.min(90, level + (rnd() - 0.5) * 3));
		const value = Math.round((roll > 0.99 ? level + 30 * rnd() : level + (rnd() - 0.5) * 4) * 10) / 10;
		const readings = roll < 0.008 ? [] : [reading("r:0:1", value)];
		const snapshot: SensorSnapshot = { pollTime: i + 1, valueRevision: i + 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
		store.ingest({ kind: "ok", at, snapshot, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 });
	}
	return { store, now: at + 500 };
}

/** The key strip, a two-row dial row (fractional width), and a short history. */
const CASES: ReadonlyArray<{ name: string; box: TimelineBox; widthPx: number; stroke: number }> = [
	{ name: "key strip", box: { x: 8, y: 122, w: 128, h: 12 }, widthPx: 128, stroke: 4 },
	{ name: "dial row", box: { x: 12, y: 50, w: 87.6, h: 12 }, widthPx: 87, stroke: 3 }
];

describe("the compact trend draws what the plain one drew", () => {
	for (const seed of [1, 2, 3, 4, 5, 6]) {
		for (const window of ["1m", "5m", "15m"] as const satisfies readonly HistoryWindowId[]) {
			for (const c of CASES) {
				it(`seed ${seed}, ${window}, ${c.name}`, () => {
					const { store, now } = randomStore(seed);
					const view = store.view("r:0:1", window, c.widthPx, now) as HistoryView;
					assert.ok(view.cols.n > 0);
					const drawn = parse(timelineSvg(view, c.box, c.stroke, 5, PALETTE, FILL).join(""));
					const ref = reference(view, c.box);

					// The line: same skeleton within the grid, so the same ink
					// under round joins and caps. Every column's min and max is
					// on it, and nothing crosses a gap the plain line left open.
					const mine = segmentsOf(drawn.line, drawn.dots);
					const theirs = segmentsOf(ref.runs);
					const out = farthest(mine, theirs);
					assert.ok(out.gap <= TOL, `drawn point (${out.at.x}, ${out.at.y}) is ${out.gap} px off the plain line`);
					const missing = farthest(theirs, mine);
					assert.ok(missing.gap <= TOL, `plain point (${missing.at.x}, ${missing.at.y}) is ${missing.gap} px from anything drawn`);
					assert.ok(drawn.line.length + drawn.dots.length >= ref.runs.length, "one run per segment at least");
					for (const run of drawn.line) {
						for (let i = 1; i < run.length; i++) assert.ok((run[i] as Point).x >= (run[i - 1] as Point).x, "time runs left to right");
					}

					// The under-fill: the same area, its top through each
					// column's first and last value.
					const mineFill = drawn.fill.reduce((sum, f) => sum + area(f), 0);
					const fillable = ref.fills.filter((f) => (f[0] as Point).x !== (f[f.length - 1] as Point).x);
					const theirFill = fillable.reduce((sum, f) => sum + area(f), 0);
					const width = fillable.reduce((sum, f) => sum + (f[f.length - 1] as Point).x - (f[0] as Point).x, 0);
					assert.ok(Math.abs(mineFill - theirFill) <= width * 0.25 + 1, `fill area ${mineFill} against ${theirFill}`);
					const top = farthest(segmentsOf([], fillable.flat()), segmentsOf(drawn.fill));
					assert.ok(top.gap <= TOL, `fill misses (${top.at.x}, ${top.at.y}) by ${top.gap} px`);
				});
			}
		}
	}

	it("writes only h, v, l and M commands on the half-pixel grid, with no exponent or non-number", () => {
		for (const seed of [1, 2, 3]) {
			const { store, now } = randomStore(seed);
			for (const window of ["1m", "5m", "15m"] as const) {
				const drawn = parse(timelineSvg(store.view("r:0:1", window, 128, now) as HistoryView, CASES[0]!.box, 4, 5, PALETTE, FILL).join(""));
				for (const d of [...drawn.lineD, ...drawn.fillD]) {
					assert.match(d, /^M[-0-9. hvlMZ]+$/, d.slice(0, 40));
					for (const n of d.match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g) ?? []) assert.ok(Number.isInteger(Number(n) * 2), `${n} on the half-pixel grid`);
				}
			}
		}
	});

	it("a flat run is one stroke and one fill rectangle, however long", () => {
		const { store, now } = filledStore(new Map([["p:0:1", seriesValues("flat", 1200)]]));
		const drawn = parse(timelineSvg(store.view("p:0:1", "15m", 128, now) as HistoryView, CASES[0]!.box, 4, 5, PALETTE, FILL).join(""));
		assert.deepEqual(drawn.lineD, ["M8.5 128h127"]);
		assert.deepEqual(drawn.fillD, ["M8.5 134v-6h127v6Z"]);
	});

	it("draws byte for byte what it drew before its scratch was reused, whatever was drawn in between", () => {
		// The digest pins the text of 1.8's first Trend drawing (the version
		// that built a fresh array per point) over these seeded stores: the
		// allocation-free writer must not move a byte. Each call reuses
		// module scratch, so drawing a big view between two draws of a small
		// one must leave the small one's text unchanged.
		const hash = createHash("sha256");
		const boxes = [...CASES, { name: "wide", box: { x: -3.25, y: 0, w: 1800, h: 30.1 }, widthPx: 1200, stroke: 3 }];
		for (const seed of [1, 2, 3, 4, 5, 6]) {
			const { store, now } = randomStore(seed);
			for (const window of ["1m", "5m", "15m"] as const) {
				for (const c of boxes) {
					// With nothing called brief, so the digest still pins the writer: the
					// comparison with the plain drawing above covers a brief join.
					const stored = store.view("r:0:1", window, c.widthPx, now) as HistoryView;
					const view: HistoryView = { ...stored, segments: stored.segments.map(({ brief: _brief, ...rest }) => (void _brief, rest)) };
					for (const fill of [FILL, null]) {
						const first = timelineSvg(view, c.box, c.stroke, 5, PALETTE, fill).join("\n");
						const big = store.view("r:0:1", "15m", 1200, now) as HistoryView;
						timelineSvg(big, boxes[2]!.box, 3, 3.5, PALETTE, FILL);
						assert.equal(timelineSvg(view, c.box, c.stroke, 5, PALETTE, fill).join("\n"), first);
						hash.update(`${first}\n--\n`);
					}
				}
			}
		}
		assert.equal(hash.digest("hex"), TIMELINE_DIGEST);
	});

	it("a one-column spike keeps its full height", () => {
		const { store, now } = filledStore(new Map([["p:0:1", seriesValues("spiky", 1200)]]));
		const view = store.view("p:0:1", "15m", 128, now) as HistoryView;
		const drawn = parse(timelineSvg(view, CASES[0]!.box, 4, 5, PALETTE, FILL).join(""));
		const ys = drawn.line.flat().map((p) => p.y);
		assert.equal(Math.min(...ys), 122, "the spikes reach the strip top");
		assert.equal(Math.max(...ys), 134, "the baseline sits on the strip bottom");
	});
});

describe("Trend window faces stay small", () => {
	const sizes = new Map(SERIES_KINDS.map((kind) => [kind, faceSizes(kind)] as [SeriesKind, Record<string, number>]));

	it("a 15-minute key face on ordinary data is 3 KB or less", () => {
		for (const kind of ["flat", "spiky", "walk"] as const) {
			const size = sizes.get(kind)?.["key 15m"] as number;
			assert.ok(size <= 3072, `${kind}: ${size} characters`);
		}
	});

	it("no window costs more than two and a half times the recent-samples face, noise across the whole range included", () => {
		for (const [kind, s] of sizes) {
			for (const window of ["1m", "5m", "15m"]) {
				assert.ok((s[`key ${window}`] as number) <= 2.5 * (s["key recent"] as number), `${kind} key ${window}: ${s[`key ${window}`]}`);
				assert.ok((s[`dial ${window}`] as number) <= 2.5 * (s["dial recent"] as number), `${kind} dial ${window}: ${s[`dial ${window}`]}`);
			}
		}
	});

	it("a steady reading draws a smaller face than the 36-sample line", () => {
		const flat = sizes.get("flat") as Record<string, number>;
		for (const window of ["1m", "5m", "15m"]) {
			assert.ok((flat[`key ${window}`] as number) < (flat["key recent"] as number));
			assert.ok((flat[`dial ${window}`] as number) < (flat["dial recent"] as number));
		}
	});
});
