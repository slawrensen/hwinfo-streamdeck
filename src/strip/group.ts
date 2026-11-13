/**
 * The strip's Group style, as pure functions: which readings a Group
 * pane's rule (StripGroupRule) stands for in one snapshot, how a pane
 * remembers a reading that left HWiNFO's list, which view the reading
 * count picks, and the geometry the scene draws and input routing reads
 * taps from (one definition for both, like the Lanes geometry).
 *
 * A rule is resolved against every snapshot, never stored as a key list,
 * so a sensor HWiNFO adds or renames follows without an edit:
 *
 *   folder  every reading of the sensor (HWiNFO's folder) the pane's first
 *           reading belongs to, in HWiNFO's order, that reading included
 *   filter  every reading whose "source name label" matches the detail
 *           filter grammar (compileDetailFilter, issue #35)
 *   list    the listed keys in order; a listed reading HWiNFO does not list
 *           now keeps its place and its count
 *
 * One unit per pane: the unit with the most readings wins (the first one
 * seen on a tie), the rest are counted, never drawn on its scale. At most
 * GROUP_DRAW_MAX readings draw; the others are counted. Readings that are
 * the same measurement (a reading link) count once.
 */
import { compileDetailFilter } from "../detail/detail-settings";
import { liveKeyOf } from "../hwinfo/reading-links";
import type { Reading, SensorSnapshot } from "../hwinfo/types";
import { graphExtent, panePlot, SLICE_W, type BucketPx, type PaneExtent, type PanePlot } from "./geometry";
import { AMBIENT_DRAW_MAX, GROUP_DRAW_MAX, type GroupViewChoice, type StripGroupRule, type StripPaneV1 } from "./settings";
import { tilesTimePlot } from "./tiles";

/**
 * Whether a plain turn of a Group pane's dial moves the highlight through
 * its readings (and a pressed turn changes the time window), the mapping
 * the research behind Group recommends; false keeps every other style's
 * mapping on Group too (a turn changes the window, a pressed turn picks
 * the reading). One switch, read by input routing and the gesture hints.
 */
export const GROUP_TURN_PICKS_READING = true;

/** What a resolution found, in a word. */
export type GroupStatus = "ok" | "no-anchor" | "anchor-missing" | "no-filter" | "empty" | "unavailable";

export type GroupResolution = {
	readonly status: GroupStatus;
	/** What the pane names as its source: the folder's name, the filter as
	 * typed, or "" for a custom list. */
	readonly title: string;
	/** The native unit the pane draws ("" when nothing resolved). */
	readonly unit: string;
	/** The readings that draw, in order: at most GROUP_DRAW_MAX. */
	readonly keys: readonly string[];
	/** Readings the rule matched in the drawn unit (keys plus the ones past
	 * the cap). */
	readonly sameUnit: number;
	/** Readings the rule matched in other units, left out. */
	readonly otherUnits: number;
	/** Ambient only (every unit drawn, each on its own range): how many
	 * units the drawn readings span. */
	readonly units?: number;
};

const NONE: Omit<GroupResolution, "status" | "title"> = { unit: "", keys: [], sameUnit: 0, otherUnits: 0 };

/** The rule a Group pane draws: its own, or a Folder rule over the pane's
 * first reading when it has none yet. */
export function groupRuleOf(pane: StripPaneV1): StripGroupRule {
	// An Ambient pane with no rule yet takes every temperature: the
	// smoothest family of readings, and every PC has them.
	return pane.group ?? (pane.style === "ambient" ? { from: "unit", unit: "°C", keys: [], view: "auto" } : { from: "folder", keys: [], view: "auto" });
}

/** The most readings a rule pane draws: Group 32, Ambient 48. */
export function ruleDrawMax(pane: Pick<StripPaneV1, "style">): number {
	return pane.style === "ambient" ? AMBIENT_DRAW_MAX : GROUP_DRAW_MAX;
}

/** Keeps the readings of the majority unit, in order, cut at the cap; with
 * `mixed` (Ambient, which reads nothing off a scale) every unit. */
function byUnit(candidates: readonly { readonly key: string; readonly unit: string | undefined }[], max = GROUP_DRAW_MAX, mixed = false): Pick<GroupResolution, "unit" | "keys" | "sameUnit" | "otherUnits" | "units"> {
	const counts = new Map<string, number>();
	for (const c of candidates) if (c.unit !== undefined) counts.set(c.unit, (counts.get(c.unit) ?? 0) + 1);
	let unit: string | undefined;
	for (const [u, n] of counts) if (unit === undefined || n > (counts.get(unit) as number)) unit = u;
	if (mixed) {
		const drawn = candidates.slice(0, max);
		const units = new Set(drawn.flatMap((c) => (c.unit === undefined ? [] : [c.unit])));
		return { unit: unit ?? "", keys: drawn.map((c) => c.key), sameUnit: candidates.length, otherUnits: 0, units: units.size };
	}
	// A listed reading HWiNFO does not list now has no unit: it keeps its
	// place among the pane's readings (it was asked for), drawn as missing.
	const same = candidates.filter((c) => c.unit === undefined || c.unit === unit);
	return { unit: unit ?? "", keys: same.slice(0, max).map((c) => c.key), sameUnit: same.length, otherUnits: candidates.length - same.length };
}

/** What an Ambient pane leaves out as noise: Yes/No readings (a 0/1 square
 * wave) and readings with no finite value. */
function ambientDraws(reading: Reading): boolean {
	return reading.unit !== "Yes/No" && Number.isFinite(reading.value);
}

/** Readings of one measurement count once: the first spelling stays. */
function distinct(readings: readonly Reading[]): Reading[] {
	const seen = new Set<string>();
	const out: Reading[] = [];
	for (const r of readings) {
		const id = liveKeyOf(r);
		if (seen.has(id)) continue;
		seen.add(id);
		out.push(r);
	}
	return out;
}

/** A pane's rule against one snapshot (null: HWiNFO is not available). */
export function resolveGroup(snapshot: SensorSnapshot | null, pane: StripPaneV1): GroupResolution {
	const rule = groupRuleOf(pane);
	const anchor = pane.series[0]?.key;
	const max = ruleDrawMax(pane);
	const mixed = pane.style === "ambient";
	const keep = pane.style === "ambient" ? ambientDraws : (): boolean => true;
	if (rule.from === "unit") {
		// Every reading in one native unit, in HWiNFO's order.
		if (rule.unit === undefined) return { status: "empty", title: "", ...NONE };
		if (snapshot === null) return { status: "unavailable", title: rule.unit, ...NONE };
		const readings = distinct(snapshot.readings.filter((r) => r.unit === rule.unit && keep(r)));
		if (readings.length === 0) return { status: "empty", title: rule.unit, ...NONE };
		return { status: "ok", title: rule.unit, ...byUnit(readings.map((r) => ({ key: r.key, unit: r.unit })), max, mixed) };
	}
	if (rule.from === "list") {
		if (rule.keys.length === 0) return { status: "empty", title: "", ...NONE };
		if (snapshot === null) return { status: "unavailable", title: "", ...NONE, keys: rule.keys.slice(0, max), sameUnit: rule.keys.length };
		const seen = new Set<string>();
		const candidates: { key: string; unit: string | undefined }[] = [];
		for (const key of rule.keys) {
			const reading = snapshot.byKey.get(key);
			if (reading === undefined) {
				candidates.push({ key, unit: undefined });
				continue;
			}
			const id = liveKeyOf(reading);
			if (seen.has(id) || !keep(reading)) continue;
			seen.add(id);
			candidates.push({ key, unit: reading.unit });
		}
		return { status: "ok", title: "", ...byUnit(candidates, max, mixed) };
	}
	if (rule.from === "filter") {
		if (rule.filter === undefined) return { status: "no-filter", title: "", ...NONE };
		if (snapshot === null) return { status: "unavailable", title: rule.filter, ...NONE };
		const matches = compileDetailFilter(rule.filter);
		const found = snapshot.readings.filter((reading) => keep(reading) && matches(`${snapshot.sensors[reading.sensorIndex]?.name ?? ""} ${reading.label}`));
		const readings = distinct(found);
		if (readings.length === 0) return { status: "empty", title: rule.filter, ...NONE };
		return { status: "ok", title: rule.filter, ...byUnit(readings.map((r) => ({ key: r.key, unit: r.unit })), max, mixed) };
	}
	if (anchor === undefined) return { status: "no-anchor", title: "", ...NONE };
	if (snapshot === null) return { status: "unavailable", title: "", ...NONE };
	const primary = snapshot.byKey.get(anchor);
	// An orphan reading (sensor index -1) has no folder to read.
	if (primary === undefined || primary.sensorIndex < 0) return { status: "anchor-missing", title: "", ...NONE };
	const readings = distinct(snapshot.readings.filter((r) => r.sensorIndex === primary.sensorIndex && keep(r)));
	const title = snapshot.sensors[primary.sensorIndex]?.name ?? "";
	return { status: "ok", title, ...byUnit(readings.map((r) => ({ key: r.key, unit: r.unit })), max, mixed) };
}

/**
 * The pane's readings with the ones it drew before kept in place: a
 * reading HWiNFO no longer lists (a sensor that went away) keeps its row
 * after the reading it followed, so nothing below it moves up and the
 * count does not drop silently. A reading that is still listed but no
 * longer matches the rule (renamed out of a filter) goes. At most
 * GROUP_DRAW_MAX in all.
 */
export function mergeRemembered(fresh: readonly string[], remembered: readonly string[], listed: (key: string) => boolean, max = GROUP_DRAW_MAX): string[] {
	const out = [...fresh];
	const present = new Set(out);
	remembered.forEach((key, i) => {
		if (present.has(key) || listed(key)) return;
		let at = 0;
		for (let k = i - 1; k >= 0; k--) {
			const before = out.indexOf(remembered[k] as string);
			if (before >= 0) {
				at = before + 1;
				break;
			}
		}
		out.splice(at, 0, key);
		present.add(key);
	});
	return out.slice(0, max);
}

/** How a Group pane draws: the view chosen, or by count (Auto): named
 * lines for up to 4 readings, one highlighted line against muted ones for
 * 5 to 8, a heat row per reading from 9. Auto never picks Tiles. */
export type GroupDraw = "lines" | "rows" | "now" | "spread" | "tiles";

export function groupDrawOf(view: GroupViewChoice, count: number): GroupDraw {
	if (view !== "auto") return view;
	return count <= 8 ? "lines" : "rows";
}

/** Lines up to this many readings draw each in its own color with names;
 * past it, one highlighted line over muted ones. */
export const GROUP_NAMED_LINES = 4;

// ---- geometry ----------------------------------------------------------------

/** Space kept free at each end of a Group plot: the alert bars at the
 * left, the highlight marker at the right. */
export const GROUP_INSET = 6;
/** The band rows and columns share, top to bottom: the strip's height,
 * the bottom row's words drawn over it in their edge. */
export const GROUP_TOP = 4;
export const GROUP_BOTTOM = 94;

/** The part of a Group pane its graph takes: the pane less its readout slot
 * (the pane's first dial slot) while the readout shows. Tiles have no
 * readout slot: their Current value overlay is each tile's own value. */
export function groupGraphExtent(pane: { readonly overlays: { readonly current: boolean } }, extent: PaneExtent, draw?: GroupDraw): PaneExtent {
	return graphExtent(pane.overlays.current && draw !== "tiles" ? "left" : undefined, extent);
}

/** Heat row cells per line bucket width: 8 px normally, and wider cells
 * (each divides 200, so no cell straddles a seam) as the payload ladder
 * coarsens. */
export function groupCellPx(bucketPx: BucketPx): 8 | 20 | 40 {
	return bucketPx >= 8 ? 40 : bucketPx >= 4 ? 20 : 8;
}

/** The plot a Group pane draws on, inset at both ends: heat cells for
 * Rows, the line bucket grid for every other view, and for Tiles the time
 * grid every tile shares (src/strip/tiles.ts tilesTimePlot), which depends
 * on its `grid` (the tiles' columns per block; none, no tiles). */
export function groupPlotOf(pane: { readonly overlays: { readonly current: boolean } }, extent: PaneExtent, draw: GroupDraw, bucketPx: BucketPx, grid?: readonly number[]): PanePlot {
	if (draw === "tiles") return tilesTimePlot(extent, grid ?? [], bucketPx);
	const g = groupGraphExtent(pane, extent);
	const inner = { x0: Math.min(g.x1, g.x0 + GROUP_INSET), x1: Math.max(g.x0, g.x1 - GROUP_INSET) };
	if (draw === "rows") {
		const cell = groupCellPx(bucketPx);
		const x0 = Math.ceil(inner.x0 / cell) * cell;
		const x1 = Math.floor(inner.x1 / cell) * cell;
		return { x0, x1, bucketPx: cell, buckets: Math.max(0, (x1 - x0) / cell) };
	}
	return panePlot(inner, bucketPx);
}

/** Heat rows: where each of `n` rows sits in the band, on whole pixels,
 * filling it (rows differ by at most 1 px). Rows keep a 1 px gap up to 8
 * readings; from 16, a 1 px gap every 8 rows marks blocks (a CCD, a bank
 * of threads). Every row is at least 1 px. */
export function groupRows(n: number): { readonly y0: number; readonly y1: number }[] {
	if (n <= 0) return [];
	const band = GROUP_BOTTOM - GROUP_TOP;
	const rowGap = n <= 8 ? 1 : 0;
	const blockGaps = n >= 16 ? Math.ceil(n / 8) - 1 : 0;
	const inked = Math.max(n, band - rowGap * (n - 1) - blockGaps);
	const out: { y0: number; y1: number }[] = [];
	let gaps = 0;
	for (let i = 0; i < n; i++) {
		if (i > 0) gaps += rowGap + (n >= 16 && i % 8 === 0 ? 1 : 0);
		const y0 = GROUP_TOP + gaps + Math.round((i * inked) / n);
		const y1 = GROUP_TOP + gaps + Math.max(Math.round(((i + 1) * inked) / n), Math.round((i * inked) / n) + 1);
		out.push({ y0, y1 });
	}
	return out;
}

/** The row under a tap's y: the nearest row (rows are thinner than a
 * finger, so a turn corrects it). */
export function groupRowAt(n: number, y: number): number {
	const rows = groupRows(n);
	let best = 0;
	let bestD = Number.POSITIVE_INFINITY;
	rows.forEach((r, i) => {
		const d = y < r.y0 ? r.y0 - y : y >= r.y1 ? y - r.y1 + 1 : 0;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	});
	return best;
}

/** Space at a Now plot's left end for its value scale's labels. */
export const GROUP_NOW_GUTTER = 44;

/** Now columns: one per reading, in order, after the scale's gutter, laid
 * out per dial slot so no column crosses a seam (a gap at every seam).
 * Slots take readings in proportion to their width, so columns keep one
 * pitch; with fewer readings than slots, one a slot, spread to both ends. */
export function groupColumns(plot: Pick<PanePlot, "x0" | "x1">, n: number): { readonly x0: number; readonly x1: number }[] {
	const start = plot.x0 + GROUP_NOW_GUTTER;
	if (n <= 0 || !(plot.x1 > start)) return [];
	const slots: { x0: number; x1: number }[] = [];
	for (let s = Math.floor(start / SLICE_W); s * SLICE_W < plot.x1; s++) {
		const x0 = Math.max(start, s * SLICE_W + 4);
		const x1 = Math.min(plot.x1, (s + 1) * SLICE_W - 4);
		if (x1 - x0 >= 8) slots.push({ x0, x1 });
	}
	if (slots.length === 0) return [];
	const counts = new Array<number>(slots.length).fill(0);
	if (n < slots.length) {
		for (let g = 0; g < n; g++) counts[n === 1 ? 0 : Math.round((g * (slots.length - 1)) / (n - 1))] = 1;
	} else {
		// Largest remainder over the slots' widths.
		const total = slots.reduce((w, sl) => w + sl.x1 - sl.x0, 0);
		const ideal = slots.map((sl) => (n * (sl.x1 - sl.x0)) / total);
		ideal.forEach((v, i) => (counts[i] = Math.max(1, Math.floor(v))));
		let left = n - counts.reduce((a, c) => a + c, 0);
		const order = ideal.map((v, i) => [v - Math.floor(v), i] as const).sort((p, q) => q[0] - p[0]);
		for (let k = 0; left > 0; k = (k + 1) % order.length, left--) {
			const i = (order[k] as readonly [number, number])[1];
			counts[i] = (counts[i] as number) + 1;
		}
		for (let i = counts.length - 1; left < 0 && i >= 0; i--) {
			if ((counts[i] as number) <= 1) continue;
			counts[i] = (counts[i] as number) - 1;
			left++;
		}
	}
	const out: { x0: number; x1: number }[] = [];
	slots.forEach((slot, i) => {
		const count = counts[i] as number;
		if (count === 0) return;
		const pitch = (slot.x1 - slot.x0) / count;
		const gap = pitch >= 10 ? 2 : 1;
		for (let k = 0; k < count; k++) {
			const x0 = Math.round(slot.x0 + k * pitch);
			const x1 = Math.max(x0 + 1, Math.round(slot.x0 + (k + 1) * pitch) - gap);
			out.push({ x0, x1 });
		}
	});
	return out;
}

/** The column under a tap's x: the nearest column. */
export function groupColumnAt(plot: Pick<PanePlot, "x0" | "x1">, n: number, x: number): number {
	const cols = groupColumns(plot, n);
	let best = 0;
	let bestD = Number.POSITIVE_INFINITY;
	cols.forEach((c, i) => {
		const d = x < c.x0 ? c.x0 - x : x >= c.x1 ? x - c.x1 + 1 : 0;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	});
	return best;
}

/** The ice ramp (8 steps through the dark theme's accent, equal OKLab
 * steps, monotonic lightness): it holds no warm hue, so the warn and
 * critical colors stand apart from every step under each color vision
 * deficiency. */
export const ICE_RAMP = ["#0E2A3F", "#194561", "#256286", "#3281AD", "#3FA1D5", "#4CC2FF", "#9ADBFF", "#D9F2FF"] as const;

/** Units with a true zero, where a Now column is a bar from zero. Every
 * other unit (temperatures, clocks, volts) draws a range and a tick, since
 * a bar from an arbitrary floor would overstate a difference. */
export function ratioUnit(unit: string): boolean {
	return /^(%|W|kW|mW|RPM|A|mA|MB\/s|KB\/s|GB\/s|B\/s|Mbps|Kbps|Gbps|FPS|ms)$/i.test(unit.trim());
}

/** How opaque a Group pane's Now bars are: the strip picture shows through
 * them, as it does through the dial's own translucent looks. */
export const GROUP_BAR_OPACITY = 0.78;

/** How opaque a Group pane's Spread band is. */
export const GROUP_BAND_OPACITY = 0.4;

/**
 * Which reading the home readout names (no highlight): the group's highest
 * (lowest when lower is worse), held against close calls so the name does
 * not flip between two readings a hair apart. The current one stays until
 * another leads it by more than `margin` (the caller's max of 0.5 % of the
 * scale span and one display step), or until the same other reading has
 * led for two data frames in a row. A current one that left the group, or
 * that has no value now, gives way at once.
 */
export type HomeState = { readonly key: string; readonly challenger: string | null; readonly wins: number };

export function nextHome(prev: HomeState | undefined, candidates: readonly { readonly key: string; readonly value: number }[], margin: number, below: boolean): HomeState | undefined {
	let best: { key: string; value: number } | undefined;
	for (const c of candidates) if (Number.isFinite(c.value) && (best === undefined || (below ? c.value < best.value : c.value > best.value))) best = c;
	if (best === undefined) return undefined;
	const current = prev === undefined ? undefined : candidates.find((c) => c.key === prev.key && Number.isFinite(c.value));
	if (prev === undefined || current === undefined || best.key === prev.key) return { key: best.key, challenger: null, wins: 0 };
	const lead = below ? current.value - best.value : best.value - current.value;
	if (lead > margin) return { key: best.key, challenger: null, wins: 0 };
	const wins = prev.challenger === best.key ? prev.wins + 1 : 1;
	return wins >= 2 ? { key: best.key, challenger: null, wins: 0 } : { key: prev.key, challenger: best.key, wins };
}

/** One display step of a formatted value ("48.4" is 0.1, "5060" is 1). */
export function displayStep(text: string): number {
	const dot = text.indexOf(".");
	const digits = dot < 0 ? 0 : text.slice(dot + 1).replace(/\D.*$/, "").length;
	return 10 ** -digits;
}
