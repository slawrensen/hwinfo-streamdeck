/**
 * Cuts a logical strip frame into one bounded 200 x 100 SVG per member.
 *
 * Each slice is written in SLICE-LOCAL coordinates with viewBox "0 0 200
 * 100" (QtSvg's handling of a non-zero viewBox origin is unproven), by the
 * same writer as the full-width reference frame, shifted by the slice's
 * group x. Only what can touch the slice is kept:
 *
 * - every primitive outside the slice plus a 2 px bleed is dropped;
 * - lines and areas keep their points inside that band and are cut exactly
 *   where they cross its edges, so the segment that crosses a seam is the
 *   same segment in both neighbours and the viewport trims it at the seam;
 *   with strokes no wider than 2 px (4 px for Clear's backing) nothing
 *   outside the band can reach a visible pixel or the edge filter's 1 px
 *   reach;
 * - panels, bands and other rectangles are clamped to the band, square, so
 *   no slice draws a corner and no pixel gets two layers of a translucent
 *   panel;
 * - text whose ink can touch the slice is kept whole with identical
 *   attributes in every slice it crosses (its anchor may then sit outside
 *   the slice; everything else stays within [-2, 202]);
 * - Outline's edge filter region spans the band plus one more pixel, so a
 *   renderer that draws filter regions past the viewport (QtSvg 6.9 draws
 *   a filtered group into a buffer the size of its region) sees the marks
 *   that continue into the next slice; the row words' edge (scene.ts
 *   ROWS_FILTER) spans the same columns, only as tall as the words that
 *   reach the slice need.
 *
 * A slice whose SVG passes SLICE_PAYLOAD_LIMIT is rebuilt from coarser
 * buckets (the next step of the bucket ladder), for every slice of that
 * frame at once. The width it settles on is held for the next frame and
 * returns to a finer one only with a margin (SLICE_RETURN_SHARE). Past the
 * last step the panes draw their values without the graph, so no slice is
 * ever sent over the bound.
 */
import { BUCKET_LADDER, DEFAULT_BUCKET_PX, ownsLayout, SLICE_W, type BucketPx } from "./geometry";
import { ART_PIECE_LIMIT, isArtLook } from "../ui/deck-art";
import { lookOn } from "../ui/dial-background";
import { emitPrim, type Prim } from "./prims";
import { buildStripScene, rowsPart, writeFrame, type LogicalScene, type StripSceneInput } from "./scene";
import type { StripPaneV1 } from "./settings";

export const SLICE_BLEED = 2;
export const SLICE_PAYLOAD_LIMIT = 8192;

/** Linear interpolation of y at x on the segment (ax, ay)-(bx, by), ax < bx. */
function yAt(ax: number, ay: number, bx: number, by: number, x: number): number {
	return ay + ((by - ay) * (x - ax)) / (bx - ax);
}

/** The part of a polyline (x non-decreasing) inside [lo, hi], cut exactly at
 * the edges it crosses. Undefined when it does not reach the band. */
export function cutPolyline(pts: readonly number[], lo: number, hi: number): number[] | undefined {
	const n = pts.length / 2;
	if (n < 1) return undefined;
	const x = (i: number): number => pts[2 * i] as number;
	const y = (i: number): number => pts[2 * i + 1] as number;
	if (x(n - 1) < lo || x(0) > hi) return undefined;
	let i = 0;
	while (i < n && x(i) < lo) i++;
	const out: number[] = [];
	if (i > 0 && x(i) > hi) {
		// No point inside the band: one segment passes straight through it.
		return [lo, yAt(x(i - 1), y(i - 1), x(i), y(i), lo), hi, yAt(x(i - 1), y(i - 1), x(i), y(i), hi)];
	}
	if (i > 0 && x(i) > lo) out.push(lo, yAt(x(i - 1), y(i - 1), x(i), y(i), lo));
	let k = i;
	while (k < n && x(k) <= hi) {
		out.push(x(k), y(k));
		k++;
	}
	if (k < n && x(k - 1) < hi) out.push(hi, yAt(x(k - 1), y(k - 1), x(k), y(k), hi));
	return out.length >= 2 ? out : undefined;
}

/** The vertices of a polyline (x non-decreasing) from the last at or
 * before `lo` to the first at or after `hi`; undefined when none reaches
 * the band. */
export function vertexSpan(pts: readonly number[], lo: number, hi: number): number[] | undefined {
	const n = pts.length / 2;
	if (n < 1 || (pts[2 * (n - 1)] as number) < lo || (pts[0] as number) > hi) return undefined;
	let a = 0;
	while (a + 1 < n && (pts[2 * (a + 1)] as number) <= lo) a++;
	let b = n - 1;
	while (b - 1 >= 0 && (pts[2 * (b - 1)] as number) >= hi) b--;
	const out = pts.slice(2 * a, 2 * b + 2);
	return out.length === 2 ? [...out, ...out] : out;
}

/** One primitive reduced to the band [lo, hi], or undefined when it cannot
 * touch it. May return a rect for marks cut at the band edge. */
export function cullPrim(p: Prim, lo: number, hi: number): Prim[] {
	switch (p.k) {
		case "rect": {
			const x1 = p.x + p.w;
			if (x1 <= lo || p.x >= hi) return [];
			const nx = Math.max(p.x, lo);
			return [{ ...p, x: nx, w: Math.min(x1, hi) - nx }];
		}
		case "marks": {
			const inside = p.xs.filter((x) => x >= lo && x + p.w <= hi);
			const partial = p.xs.filter((x) => x + p.w > lo && x < hi && !(x >= lo && x + p.w <= hi));
			const out: Prim[] = inside.length === 0 ? [] : [{ ...p, xs: inside }];
			for (const x of partial) {
				const nx = Math.max(x, lo);
				out.push({ k: "rect", layer: p.layer, x: nx, y: p.y, w: Math.min(x + p.w, hi) - nx, h: p.h, paint: p.paint });
			}
			return out;
		}
		case "cells": {
			const rects: number[] = [];
			// A rounded rectangle's cut sides are drawn square, at the band's
			// edge outside the slice's view (CellsPrim.cuts): no corner where
			// the tile goes on.
			const cuts: number[] = [];
			for (let i = 0; i + 3 < p.rects.length; i += 4) {
				const x = p.rects[i] as number;
				const x1 = x + (p.rects[i + 2] as number);
				if (x1 <= lo || x >= hi) continue;
				if (p.whole === true) {
					rects.push(x, p.rects[i + 1] as number, x1 - x, p.rects[i + 3] as number);
					cuts.push(p.cuts?.[i / 4] ?? 0);
					continue;
				}
				const nx = Math.max(x, lo);
				rects.push(nx, p.rects[i + 1] as number, Math.min(x1, hi) - nx, p.rects[i + 3] as number);
				cuts.push((x < lo ? 1 : 0) | (x1 > hi ? 2 : 0) | (p.cuts?.[i / 4] ?? 0));
			}
			return rects.length === 0 ? [] : [p.round === undefined ? { ...p, rects } : { ...p, rects, cuts }];
		}
		case "areas": {
			const runs: number[][] = [];
			const bases: number[] = [];
			p.runs.forEach((pts, i) => {
				const cut = cutPolyline(pts, lo, hi);
				if (cut === undefined) return;
				runs.push(cut);
				bases.push(p.bases[i] as number);
			});
			return runs.length === 0 ? [] : [{ ...p, runs, bases }];
		}
		case "text":
			return p.bx1 > lo && p.bx0 < hi ? [p] : [];
		case "words": {
			const words = p.words.filter((w) => w.bx1 > lo && w.bx0 < hi);
			return words.length === 0 ? [] : [{ ...p, words }];
		}
		case "skein": {
			// Each line keeps its own vertices from the last one at or before
			// the band (less the passes' reach) to the first one at or after
			// it: never a new vertex, so every segment that can reach the
			// slice is the very segment the reference frame strokes.
			const lines: number[][] = [];
			for (const pts of p.lines) {
				const kept = vertexSpan(pts, lo - p.reach, hi + p.reach);
				if (kept !== undefined) lines.push(kept);
			}
			return lines.length === 0 ? [] : [{ ...p, lines }];
		}
		case "line":
		case "area": {
			const pts = cutPolyline(p.pts, lo, hi);
			return pts === undefined ? [] : [{ ...p, pts }];
		}
		case "envelope": {
			// Both edges share their x values, so they cut at the same x.
			const top = cutPolyline(p.top, lo, hi);
			const bottom = cutPolyline(p.bottom, lo, hi);
			return top === undefined || bottom === undefined ? [] : [{ ...p, top, bottom }];
		}
	}
}

/** One member's slice of the frame: column c covers group x [c*200, c*200+200). */
export function sliceScene(scene: LogicalScene, column: number): string {
	const x0 = column * SLICE_W;
	const lo = x0 - SLICE_BLEED;
	const hi = x0 + SLICE_W + SLICE_BLEED;
	const base: string[] = [];
	const marks: string[] = [];
	const rows: Prim[] = [];
	const over: string[] = [];
	for (const p of scene.prims) {
		for (const kept of cullPrim(p, lo, hi)) {
			if (kept.layer === "rows") {
				rows.push(kept);
				continue;
			}
			const svg = emitPrim(kept, x0);
			if (svg === "") continue;
			(kept.layer === "base" ? base : kept.layer === "marks" ? marks : over).push(svg);
		}
	}
	const part = rowsPart(rows, x0);
	return writeFrame(withLocalPaints(scene, [...base, ...marks, ...part.svg, ...over]), base, marks, SLICE_W, -SLICE_BLEED - 1, SLICE_W + 2 * SLICE_BLEED + 2, part, over);
}

/** A scene whose slice-local paints (LogicalScene.localPaints) are added
 * to its paints, the ones this slice's primitives use only. */
function withLocalPaints(scene: LogicalScene, parts: readonly string[]): LogicalScene {
	if (scene.localPaints === undefined || scene.localPaints.length === 0) return scene;
	// Part by part, with no copy of the slice: a reference never spans two
	// primitives' SVG.
	const used = scene.localPaints.filter((p) => {
		const ref = `url(#${p.id})`;
		return parts.some((part) => part.includes(ref));
	}).map((p) => p.def);
	return used.length === 0 ? scene : { ...scene, paints: scene.paints + used.join("") };
}

export function svgBytes(svg: string): number {
	return Buffer.byteLength(svg, "utf8");
}

/** The setFeedback canvas value, exactly as independent dials send theirs. */
export function feedbackUri(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export type StripSlices = {
	readonly scene: LogicalScene;
	/** By encoder column; null where no member owns the slot. */
	readonly slices: readonly (string | null)[];
	readonly bucketPx: BucketPx;
	/** True when the payload bound forced coarser buckets. */
	readonly coarsened: boolean;
	readonly maxBytes: number;
	/** True when even the coarsest buckets passed the bound and the panes
	 * draw their values without the graph. */
	readonly reduced?: true;
};

/**
 * A coarser bucket width goes back to a finer one only when the finer
 * width's largest slice fits within this share of the bound. Without the
 * margin a frame that sits at the bound flips between widths from one tick
 * to the next, and the whole graph flickers with it.
 */
export const SLICE_RETURN_SHARE = 0.85;

/**
 * A strip that held a coarser width tries the finer ones again only on a
 * probe frame: the caller asks for one every HOLD_PROBE_FRAMES frames (and
 * whenever the strip's config or screen changes). Between probes a frame
 * starts at the width it holds, so a dense screen builds its scene once a
 * frame instead of once per finer width it already passed (each build of a
 * Group or Ambient screen is megabytes of garbage).
 */
export const HOLD_PROBE_FRAMES = 15;

/**
 * Builds one frame and every present slice, coarsening the buckets while
 * any slice passes the payload bound (the last ladder step is kept).
 *
 * `held` is the width the group's previous frame used (StripSlices.bucketPx).
 * A width finer than it is taken only with SLICE_RETURN_SHARE of margin, so
 * the width changes once when a frame crosses the bound, not on every tick.
 * Callers keep it per group and pass it back on the next frame.
 *
 * `probe` false starts the ladder at `held`: the frame does not try the
 * finer widths again (the caller probes every HOLD_PROBE_FRAMES frames).
 */
export function sliceStrip(input: StripSceneInput, held?: BucketPx, probe = true): StripSlices {
	// A Stars or Nebula slice is sent with its piece of the deck's scene in
	// place of the backdrop marker (src/ui/deck-art.ts): the bound keeps
	// room for the longest piece.
	const limit = SLICE_PAYLOAD_LIMIT - (isArtLook(lookOn(input.config.background, input.palette)) ? ART_PIECE_LIMIT : 0);
	const start = input.bucketPx ?? DEFAULT_BUCKET_PX;
	const ladder = BUCKET_LADDER.filter((b) => b >= start);
	const hold = held !== undefined && (ladder as readonly number[]).includes(held) ? held : start;
	const from = probe ? start : hold;
	let result: StripSlices | undefined;
	for (const bucketPx of ladder) {
		if (bucketPx < from) continue;
		const scene = buildStripScene({ ...input, bucketPx });
		result = slicesOf(scene, bucketPx, bucketPx !== start);
		const bound = bucketPx < hold ? limit * SLICE_RETURN_SHARE : limit;
		if (result.maxBytes <= bound) break;
	}
	const coarsest = result as StripSlices;
	if (coarsest.maxBytes <= limit) return coarsest;
	// Past the ladder the graph itself is too dense to send (many short
	// segments at the coarsest buckets): every pane draws its values without
	// the graph, the face its "Large values only" readout draws: a few
	// texts per slot, current values only, nothing that misleads. A slice
	// still over the bound (never seen) keeps only its texts and panels.
	const values = buildStripScene({ ...input, bucketPx: coarsest.bucketPx, config: valuesOnly(input.config), reduced: true });
	const reduced = slicesOf(values, coarsest.bucketPx, true);
	const slices = reduced.slices.map((s, c) => (s === null || svgBytes(s) <= limit ? s : sliceScene(bareScene(values), c)));
	const maxBytes = Math.max(0, ...slices.map((s) => (s === null ? 0 : svgBytes(s))));
	return { scene: values, slices, bucketPx: coarsest.bucketPx, coarsened: true, maxBytes, reduced: true };
}

function slicesOf(scene: LogicalScene, bucketPx: BucketPx, coarsened: boolean): StripSlices {
	const slices = scene.present.map((here, c) => (here ? sliceScene(scene, c) : null));
	const maxBytes = Math.max(0, ...slices.map((s) => (s === null ? 0 : svgBytes(s))));
	return { scene, slices, bucketPx, coarsened, maxBytes };
}

/** The config's panes as values only, with no trend beside them. A Group
 * pane draws its Now columns: every reading's value, no time, a few
 * rectangles whatever the history holds. An Ambient pane stays as it is and
 * draws its own reduced form (StripSceneInput.reduced); Events draws as
 * Meters' Thin bar: a value and a bar a reading. */
function valuesOnly(config: StripSceneInput["config"]): StripSceneInput["config"] {
	const pane = (p: StripPaneV1): StripPaneV1 => (p.style === "ambient" ? p : p.style === "group" ? { ...p, group: { ...(p.group ?? { from: "folder", keys: [] }), view: "now" } } : ownsLayout(p.style) ? { ...thinOf(p), style: "meters", overlays: { ...p.overlays, time: false } } : { ...p, readout: "only", overlays: { ...p.overlays, time: false } });
	return { ...config, panes: [pane(config.panes[0]), pane(config.panes[1])] };
}

/** An Events pane without a Meters Look it kept from before (only Meters
 * reads one). */
function thinOf(p: StripPaneV1): StripPaneV1 {
	if (p.style !== "events" || p.meterLook === undefined) return p;
	const { meterLook: _look, ...rest } = p;
	void _look;
	return rest;
}

/** A scene's texts and full-height panels only. */
function bareScene(scene: LogicalScene): LogicalScene {
	return { ...scene, prims: scene.prims.filter((p) => p.k === "text" || (p.k === "rect" && p.layer === "base" && p.h >= 100)) };
}
