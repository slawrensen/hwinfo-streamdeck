/**
 * What the Meters and Events styles share (src/strip/meters.ts, events.ts):
 * the rows every strip style draws on, the words for a window, which
 * readings have a true zero, and the rectangles of one paint written as one
 * path.
 *
 * Those styles draw through the scene's builder (src/strip/scene.ts) and
 * import only its types, so the scene can import them without a cycle.
 */
import type { AlertBand } from "../alerts/types";
import { isDataUnit } from "../ui/measure";
import type { Layer, Prim } from "./prims";

/** The rows every strip style uses (scene.ts keeps the same numbers): the
 * plot takes the strip's height, and the top and bottom rows draw over it,
 * in their edge (scene.ts ROWS_FILTER). */
export const TOP_BASELINE = 22;
export const BOTTOM_BASELINE = 95;
export const PLOT_TOP = 6;
export const PLOT_BOTTOM = 94;
export const PAD = 6;
export const VALUE_SIZE = 24;
export const LABEL_SIZE = 16;
export const ROW_SIZE = 16;
/** A scale's caption and numbers on a row over the graph. */
export const SCALE_SIZE = 13;
export const SMALL_SIZE = 11;

/** A window in words: "1 min", "15 min". */
export function windowWords(ms: number): string {
	const seconds = Math.round(ms / 1000);
	return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 6) / 10} min`;
}

/** The unit HWiNFO gives a Yes/No reading (0 is No, 1 is Yes). */
export const YES_NO_UNIT = "Yes/No";

export function isYesNo(unit: string): boolean {
	return unit === YES_NO_UNIT;
}

/**
 * Units with a true zero, where a bar's length from zero is the value:
 * percent, power, current, fan speed, clocks, frame rate and frame time,
 * and every data size and rate. Temperatures, voltages, multipliers, a
 * Yes/No and an empty unit are left out: a bar from zero on a temperature
 * axis would show 60 and 70 °C as nearly the same and say nothing about
 * where the reading sits.
 */
export function startsAtZero(unit: string): boolean {
	const u = unit.trim();
	if (u === "") return false;
	if (isDataUnit(u)) return true;
	return /^(%|W|kW|mW|A|mA|RPM|MHz|GHz|FPS|ms|Wh|kWh|Mbit\/s|Gbit\/s|Kbit\/s)$/i.test(u);
}

/** A reading's own bands, its limits in its display unit. */
export function ownBands(bands: readonly AlertBand[], key: string): AlertBand[] {
	return bands.filter((b) => b.readingKey === key);
}

/** A band's limit, the edge that faces normal readings (display unit). */
export function bandEdge(band: AlertBand, upward: boolean): number {
	return upward ? band.from : band.to;
}

/** Rectangles collected by paint, written as one path per paint
 * (CellsPrim), in the order each paint first appeared. */
export class CellPaths {
	private readonly byPaint = new Map<string, number[]>();

	add(paint: string, x: number, y: number, w: number, h: number): void {
		if (!(w > 0 && h > 0)) return;
		const list = this.byPaint.get(paint);
		if (list === undefined) this.byPaint.set(paint, [x, y, w, h]);
		else list.push(x, y, w, h);
	}

	prims(layer: Layer): Prim[] {
		return [...this.byPaint].map(([paint, rects]) => ({ k: "cells", layer, rects, paint }));
	}
}

/** A fill attribute, translucent when `opacity` is under 1. */
export function fillOf(color: string, opacity = 1): string {
	return opacity >= 1 ? `fill="${color}"` : `fill="${color}" fill-opacity="${opacity}"`;
}

/** A name's rungs (readout.ts nameRungs) without a dangling separator a
 * dropped word can leave ("GPU Performance Limit -" reads "GPU
 * Performance Limit"). */
export function tidyRungs(rungs: readonly string[]): string[] {
	const out = rungs.map((r) => r.replace(/\s*[-:·,]+$/, "").trim()).filter((r) => r !== "");
	return out.filter((r, i) => out.indexOf(r) === i);
}
