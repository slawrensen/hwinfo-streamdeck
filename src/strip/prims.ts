/**
 * The primitives of one logical strip frame, in group coordinates, and the
 * one writer that turns them into SVG at an x offset. The full-width
 * reference frame and every 200 px slice are written by the same code, so a
 * slice differs from the reference only in what it leaves out.
 *
 * Coordinates are rounded once, in group coordinates, to the half pixel
 * (snap). A slice subtracts a whole-pixel offset, so no slice re-rounds.
 */
import { escapeXml, fontFamily } from "../ui/key-renderer";

/** Base primitives draw under Outline's edge; marks draw inside it (on
 * Outline and Tint). Rows are the words a graph carries over its plot on
 * its top and bottom rows, with their chips and swatches: they draw above
 * the marks in an edge of their own on every look (scene.ts ROWS_FILTER),
 * so a line or a picture under them never touches a letter. Over draws
 * above everything (the Strip Screens position line). */
export type Layer = "base" | "marks" | "rows" | "over";

export type RectPrim = {
	readonly k: "rect";
	readonly layer: Layer;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
	/** A complete fill attribute: fill="#RRGGBB" or fill="url(#p)". */
	readonly paint: string;
};

export type LinePrim = {
	readonly k: "line";
	readonly layer: Layer;
	/** x,y pairs with x non-decreasing. */
	readonly pts: readonly number[];
	readonly stroke: string;
	readonly width: number;
	/** A wider stroke drawn first (Clear's track backing). */
	readonly backing?: { readonly stroke: string; readonly width: number };
};

export type AreaPrim = {
	readonly k: "area";
	readonly layer: Layer;
	readonly pts: readonly number[];
	readonly base: number;
	readonly paint: string;
};

/** A band between two polylines over the same x positions (a Group's Spread,
 * its lowest to its highest reading): `top` left to right, `bottom` at the
 * same x, closed into one filled shape. */
export type EnvelopePrim = {
	readonly k: "envelope";
	readonly layer: Layer;
	/** x,y pairs with x non-decreasing; `bottom` has the same x values. */
	readonly top: readonly number[];
	readonly bottom: readonly number[];
	readonly paint: string;
};

/** Small marks at fixed positions (the heat strip's missing-data dashes):
 * one path of independent rectangles. */
export type MarksPrim = {
	readonly k: "marks";
	readonly layer: Layer;
	readonly xs: readonly number[];
	readonly w: number;
	readonly y: number;
	readonly h: number;
	readonly paint: string;
};

/** Rectangles of one paint as one path (a Group pane's heat cells and
 * columns): x, y, w, h quadruples, each drawn square. */
export type CellsPrim = {
	readonly k: "cells";
	readonly layer: Layer;
	readonly rects: readonly number[];
	readonly paint: string;
	/** Corners of this radius (the Group Tiles view's tiles). */
	readonly round?: number;
	/** Per rectangle of a rounded set, the sides a slice cut (1 the left, 2
	 * the right, 3 both): a cut side is drawn square at the slice's bleed,
	 * outside the slice's view, so no slice draws a corner where the tile
	 * goes on (slicer.ts cullPrim sets it). */
	readonly cuts?: readonly number[];
	/** Each rectangle kept whole in every slice it touches (a dashed
	 * outline: one path in both slices of a seam, so its dashes meet). */
	readonly whole?: true;
	/** Each rectangle 1 px tall, written as a line through its middle for
	 * a 1 px stroke (the paint strokes): the same pixels in fewer bytes (the
	 * Group Tiles view's mid-scale lines). */
	readonly hair?: true;
};

/** Filled areas of one paint as one path (the Group Tiles view's fills):
 * each run from its base up to its points and back down, closed, cut at a
 * slice's edges exactly as an area is. */
export type AreasPrim = {
	readonly k: "areas";
	readonly layer: Layer;
	/** Each run: x,y pairs with x non-decreasing, at least one point. */
	readonly runs: readonly (readonly number[])[];
	/** Each run's base y. */
	readonly bases: readonly number[];
	readonly paint: string;
};

export type TextPrim = {
	readonly k: "text";
	readonly layer: Layer;
	readonly x: number;
	readonly y: number;
	readonly anchor: "start" | "middle" | "end";
	readonly size: number;
	readonly weight: 600 | 700;
	readonly fill: string;
	readonly text: string;
	/** Estimated horizontal ink extent, used only to decide which slices
	 * carry the text. */
	readonly bx0: number;
	readonly bx1: number;
	/** Placed wholly inside one slice, its box from measured ink (large
	 * values, scale and time labels): never drawn across a seam. */
	readonly pinned?: true;
};

/** One word of a WordsPrim: a text's own place, anchor, size and fill,
 * and the horizontal box that decides which slices carry it. */
export type Word = Pick<TextPrim, "x" | "y" | "anchor" | "size" | "fill" | "text" | "bx0" | "bx1">;

/** Many short words of one weight as one group (the Group Tiles view's
 * numbers): the family and the weight written once on the group, each word
 * its own text element. A slice keeps the words whose box reaches it. */
export type WordsPrim = {
	readonly k: "words";
	readonly layer: Layer;
	readonly weight: 600 | 700;
	readonly words: readonly Word[];
};

/**
 * Polylines that draw as ONE path, stroked once per pass (the Ambient
 * style's threads and their curtain): the path sits in its own defs and
 * each pass is a <use> of it, shifted by `dy`, so a pass costs a few bytes
 * whatever the lines hold.
 */
export type SkeinPrim = {
	readonly k: "skein";
	readonly layer: Layer;
	/** The path's id, unique in the frame. */
	readonly id: string;
	/** Each polyline: x,y pairs with x non-decreasing, at least two points. */
	readonly lines: readonly (readonly number[])[];
	/** Attributes the passes share (the stroke paint, joins and caps). */
	readonly attrs: string;
	/** Each pass: a y offset, a stroke width and a stroke opacity. */
	readonly passes: readonly { readonly dy: number; readonly width: number; readonly opacity: number }[];
	/** How far past a slice's band the lines are kept: the widest pass's
	 * half width and a margin, so a cut end never reaches a visible pixel. */
	readonly reach: number;
	/** Written tight (no space before a minus sign). */
	readonly tight?: true;
};

export type Prim = RectPrim | LinePrim | AreaPrim | AreasPrim | MarksPrim | TextPrim | WordsPrim | EnvelopePrim | CellsPrim | SkeinPrim;

/** Half-pixel rounding, applied once in group coordinates. */
export function snap(v: number): number {
	return Math.round(v * 2) / 2;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Number text for SVG: at most two decimals, never "-0". */
export function num(v: number): string {
	const r = round2(v);
	return r === 0 ? "0" : String(r);
}

/*
 * Path data is written byte by byte into one reused buffer and read back as
 * one string (emitting is synchronous and never re-entrant), so a primitive
 * costs the string it emits, not a string per number and per step (the six
 * slices of 75 Ambient threads cost about 0.6 MB of those a frame). Every
 * writer takes its text before it returns, so the buffer is empty between
 * calls.
 */
let text = Buffer.alloc(8192);
let textLen = 0;
/** The last point a path wrote, as written, and how many steps it took. */
let atX = 0;
let atY = 0;
let steps = 0;
/** Tight writing (the Group Tiles view's primitives, tight in their
 * types): no space before a number written with a minus sign, which
 * separates it already, and a subpath that starts where the one before
 * left the pen is moved to relatively when that is shorter (writeMove).
 * Every other primitive is written as before. */
let tight = false;
/** Where the subpath before left the pen, as written (NaN: no subpath yet
 * in this primitive); kept by the tight writers only. */
let penX = Number.NaN;
let penY = Number.NaN;

/** The separator before `v` as writeNum writes it. */
function writeSep(v: number): void {
	if (!(tight && Math.round(v * 100) < 0)) writeByte(32);
}

function writeByte(c: number): void {
	if (textLen >= text.length) {
		const bigger = Buffer.alloc(text.length * 2);
		text.copy(bigger, 0, 0, textLen);
		text = bigger;
	}
	text[textLen++] = c;
}

function writeString(s: string): void {
	for (let i = 0; i < s.length; i++) writeByte(s.charCodeAt(i));
}

function writeDigits(v: number): void {
	if (v >= 10) writeDigits(Math.floor(v / 10));
	writeByte(48 + (v % 10));
}

/** Writes num(v): the same text for every value. num() rounds v to a whole
 * number k of hundredths; when k fits an int32 (any coordinate a strip
 * draws), k's digits with the point put back are the text String(k / 100)
 * gives; anything else (huge, NaN, infinite) goes through num() itself. */
function writeNum(v: number): void {
	const k = Math.round(v * 100);
	if (!(k > -2147483648 && k < 2147483648)) {
		writeString(num(v));
		return;
	}
	if (k === 0) {
		writeByte(48);
		return;
	}
	if (k < 0) writeByte(45);
	const abs = Math.abs(k);
	writeDigits(Math.floor(abs / 100));
	const cents = abs % 100;
	if (cents === 0) return;
	writeByte(46);
	writeByte(48 + Math.floor(cents / 10));
	if (cents % 10 !== 0) writeByte(48 + (cents % 10));
}

function takeText(): string {
	const out = text.toString("latin1", 0, textLen);
	textLen = 0;
	return out;
}

/** A tight subpath's start: "M x y", or "m dx dy" from the pen when that
 * is shorter; the point lands on the same written hundredths either way. */
function writeMove(x: number, y: number): void {
	const ax = round2(x);
	const ay = round2(y);
	const abs = `M${num(ax)}${ay < 0 ? "" : " "}${num(ay)}`;
	if (Number.isFinite(penX) && Number.isFinite(penY)) {
		const dx = round2(ax - penX);
		const dy = round2(ay - penY);
		const rel = `m${num(dx)}${dy < 0 ? "" : " "}${num(dy)}`;
		writeString(rel.length < abs.length ? rel : abs);
	} else writeString(abs);
	penX = ax;
	penY = ay;
}

/** A path's absolute start, shifted left by `dx`. */
function writeStart(x: number, y: number, dx: number): void {
	writeByte(77);
	writeNum(x - dx);
	writeSep(y);
	writeNum(y);
	atX = round2(x);
	atY = round2(y);
	steps = 0;
}

/** A relative step from the point before, both as written (two decimals),
 * so a path that starts at a cut point lands every later point exactly
 * where the reference frame puts it. */
function writeStep(x: number, y: number): void {
	const rx = round2(x);
	const ry = round2(y);
	if (steps++ === 0) writeByte(108);
	else writeSep(rx - atX);
	writeNum(rx - atX);
	writeSep(ry - atY);
	writeNum(ry - atY);
	atX = rx;
	atY = ry;
}

/** A rectangle as a closed subpath: its corner, then across, down and back. */
function writeBox(x: number, y: number, w: number, h: number): void {
	writeByte(77);
	writeNum(x);
	writeByte(32);
	writeNum(y);
	writeByte(104);
	writeNum(w);
	writeByte(118);
	writeNum(h);
	writeByte(104);
	writeNum(-w);
	writeByte(90);
}

/** A rectangle with corners of radius r as a closed subpath: from the end
 * of its first corner across the top, then round, quadratic corners. A
 * side in `cut` (1 the left, 2 the right) is square. */
function writeRoundBox(x: number, y: number, w: number, h: number, r: number, cut: number): void {
	const c = Math.max(0, Math.min(r, w / 2, h / 2));
	const cl = (cut & 1) === 0 ? c : 0;
	const cr = (cut & 2) === 0 ? c : 0;
	const corner = (ax: number, ay: number, bx: number, by: number): void => {
		if (ax === 0 && ay === 0 && bx === 0 && by === 0) return;
		writeByte(113);
		writeNum(ax);
		writeSep(ay);
		writeNum(ay);
		writeSep(bx);
		writeNum(bx);
		writeSep(by);
		writeNum(by);
	};
	// Z brings the pen back to this start, where the next box moves from.
	writeMove(x + cl, y);
	writeByte(104);
	writeNum(w - cl - cr);
	corner(cr, 0, cr, cr);
	writeByte(118);
	writeNum(h - 2 * cr);
	corner(0, cr, -cr, cr);
	writeByte(104);
	writeNum(cl + cr - w);
	corner(-cl, 0, -cl, -cl);
	// A square left side is the closing segment itself.
	if (cl > 0) {
		writeByte(118);
		writeNum(2 * cl - h);
		corner(0, -cl, cl, -cl);
	}
	writeByte(90);
}

/** The value of `of` most of `words` share (the first of the most common). */
function mostOf(words: readonly Word[], of: (w: Word) => string): string {
	const counts = new Map<string, number>();
	let best = words[0] === undefined ? "" : of(words[0]);
	for (const w of words) {
		const v = of(w);
		const n = (counts.get(v) ?? 0) + 1;
		counts.set(v, n);
		if (n > (counts.get(best) ?? 0)) best = v;
	}
	return best;
}

/** An area: from the base up to the first point, which the steps start
 * from, then back down to the base, closed. */
function writeArea(pts: readonly number[], base: number, dx: number): void {
	if (tight) {
		// Z brings the pen back to this start (the next run moves from it).
		writeMove((pts[0] as number) - dx, base);
		atX = round2(pts[0] as number);
		atY = round2(base);
		steps = 0;
	} else writeStart(pts[0] as number, base, dx);
	writeByte(86);
	writeNum(pts[1] as number);
	atY = round2(pts[1] as number);
	for (let i = 2; i < pts.length; i += 2) writeStep(pts[i] as number, pts[i + 1] as number);
	writeByte(86);
	writeNum(base);
	writeByte(90);
}

function writePath(pts: readonly number[], dx: number): void {
	writeStart(pts[0] as number, pts[1] as number, dx);
	for (let i = 2; i < pts.length; i += 2) writeStep(pts[i] as number, pts[i + 1] as number);
}

function pathOf(pts: readonly number[], dx: number): string {
	writePath(pts, dx);
	return takeText();
}

/** One primitive as SVG, shifted left by `dx` (a slice's group x). */
export function emitPrim(p: Prim, dx: number): string {
	// Nothing a writer that threw left behind goes into this one.
	textLen = 0;
	tight = (p.k === "cells" && (p.round !== undefined || p.hair === true)) || p.k === "areas" || (p.k === "skein" && p.tight === true);
	penX = Number.NaN;
	penY = Number.NaN;
	switch (p.k) {
		case "rect":
			return `<rect x="${num(p.x - dx)}" y="${num(p.y)}" width="${num(p.w)}" height="${num(p.h)}" ${p.paint}/>`;
		case "line": {
			const d = pathOf(p.pts, dx);
			const stroke = (color: string, width: number): string => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${num(width)}" stroke-linejoin="round" stroke-linecap="round"/>`;
			return (p.backing === undefined ? "" : stroke(p.backing.stroke, p.backing.width)) + stroke(p.stroke, p.width);
		}
		case "area":
			writeArea(p.pts, p.base, dx);
			return `<path d="${takeText()}" ${p.paint}/>`;
		case "areas": {
			p.runs.forEach((pts, i) => {
				if (pts.length >= 2) writeArea(pts, p.bases[i] as number, dx);
			});
			return textLen === 0 ? "" : `<path d="${takeText()}" ${p.paint}/>`;
		}
		case "envelope": {
			// The top edge left to right, then the bottom edge back.
			writePath(p.top, dx);
			for (let i = p.bottom.length - 2; i >= 0; i -= 2) writeStep(p.bottom[i] as number, p.bottom[i + 1] as number);
			writeByte(90);
			return `<path d="${takeText()}" ${p.paint}/>`;
		}
		case "marks": {
			for (const x of p.xs) writeBox(x - dx, p.y, p.w, p.h);
			return textLen === 0 ? "" : `<path d="${takeText()}" ${p.paint}/>`;
		}
		case "cells": {
			const r = p.round;
			for (let i = 0; i + 3 < p.rects.length; i += 4) {
				const x = (p.rects[i] as number) - dx;
				if (p.hair === true) {
					// A line through the rectangle's middle; the pen stays at its end.
					writeMove(x, (p.rects[i + 1] as number) + (p.rects[i + 3] as number) / 2);
					writeByte(104);
					writeNum(p.rects[i + 2] as number);
					penX = round2(penX + round2(p.rects[i + 2] as number));
				} else if (r === undefined) writeBox(x, p.rects[i + 1] as number, p.rects[i + 2] as number, p.rects[i + 3] as number);
				else writeRoundBox(x, p.rects[i + 1] as number, p.rects[i + 2] as number, p.rects[i + 3] as number, r, p.cuts?.[i / 4] ?? 0);
			}
			return textLen === 0 ? "" : `<path d="${takeText()}" ${p.paint}/>`;
		}
		case "text":
			return `<text x="${num(p.x - dx)}" y="${num(p.y)}" text-anchor="${p.anchor}" font-family="${fontFamily()}" font-size="${p.size}" font-weight="${p.weight}" fill="${p.fill}">${escapeXml(p.text)}</text>`;
		case "words": {
			// The anchor, size and fill most words share are written once, on
			// the group, and a word that differs carries its own (the art's
			// quiet boxes read both through the group: deck-art.ts textBoxes).
			const anchor = mostOf(p.words, (w) => w.anchor);
			const size = mostOf(p.words, (w) => String(w.size));
			const fill = mostOf(p.words, (w) => w.fill);
			const words = p.words.map((w) => `<text x="${num(w.x - dx)}" y="${num(w.y)}"${w.anchor === anchor ? "" : ` text-anchor="${w.anchor}"`}${String(w.size) === size ? "" : ` font-size="${w.size}"`}${w.fill === fill ? "" : ` fill="${w.fill}"`}>${escapeXml(w.text)}</text>`).join("");
			// Start is every renderer's own default anchor: left out.
			return words === "" ? "" : `<g${anchor === "start" ? "" : ` text-anchor="${anchor}"`} font-family="${fontFamily()}" font-size="${size}" font-weight="${p.weight}" fill="${fill}">${words}</g>`;
		}
		case "skein": {
			for (const pts of p.lines) writePath(pts, dx);
			const d = takeText();
			if (d === "") return "";
			const uses = p.passes.map((q) => `<use xlink:href="#${p.id}"${q.dy === 0 ? "" : ` y="${num(q.dy)}"`} stroke-width="${num(q.width)}"${q.opacity === 1 ? "" : ` stroke-opacity="${num(q.opacity)}"`}/>`).join("");
			// The xlink namespace is declared where it is used, so a frame with
			// no skein is written exactly as before.
			return `<defs><path id="${p.id}" d="${d}"/></defs><g xmlns:xlink="http://www.w3.org/1999/xlink" ${p.attrs}>${uses}</g>`;
		}
	}
}
