/**
 * The Events style: when something happened in the window, for the
 * readings people look for after a stutter. A row per reading (1 to 4):
 *
 * - a Yes/No reading (HWiNFO's limiters and throttling flags: Performance
 *   Limit, Thermal Throttling, PROCHOT) marks each stretch it said Yes;
 * - a numeric reading with alert bands marks each stretch it spent past a
 *   limit (under it, when lower is worse), in that band's alert color, a
 *   warn mark half the height of a crit mark (warnMark), so the level never
 *   rests on color alone;
 * - a numeric reading without bands has nothing to mark: its row says "no
 *   limit" and draws nothing.
 *
 * The pane's first dial slot is the legend: each row's name and its state
 * now (at the cursor when paused), so no name sits on the timeline. The
 * rest of the pane is the timeline, on the line bucket grid, the strip's
 * height; only the bottom row's words draw over it, in their edge. A mark is
 * a run of buckets, never wider than the time it covers. A hairline runs
 * along a row only where the reading was watched, so "never happened" and
 * "not watched" never look alike. A bucket with no sample of its own inside
 * a watched stretch keeps the state before it. The bottom row counts the
 * highlighted row's events in the window ("3 times past 85.0 °C in 15
 * min"), as marked, a run broken by a gap counting twice.
 */
import type { AlertBand } from "../alerts/types";
import { t } from "../i18n";
import { convertUnit } from "../ui/format";
import { isDataUnit } from "../ui/measure";
import { mixToward } from "../ui/text-colors";
import { eventsTimeline, SLICE_W } from "./geometry";
import { bandsOpenUpward } from "./graph";
import { bandEdge, CellPaths, fillOf, isYesNo, LABEL_SIZE, ownBands, PAD, ROW_SIZE, tidyRungs, windowWords } from "./patterned";
import { fitNameRung, nameRungs } from "./readout";
import type { PaneFrame, SceneBuilder, SeriesDraw } from "./scene";

/** The band the rows share, top to bottom: the strip's height, the bottom
 * row's words drawn over the timeline in their edge. */
export const EVENTS_TOP = 4;
export const EVENTS_BOTTOM = 94;
/** The legend's names and states with three or four rows: the largest at
 * which "GPU Performance Limit" stays whole beside "No" in the slot (14 px
 * drops it to "GPU"). */
const EVENTS_NAME_3 = 13;

export type EventLevel = "warn" | "crit";

/** What a row marks: Yes/No, past a limit, or nothing (no limit). */
export type EventKind = "yes" | "limit" | "none";

export function eventKindOf(unit: string, bands: readonly AlertBand[]): EventKind {
	if (isYesNo(unit)) return "yes";
	return bands.length > 0 ? "limit" : "none";
}

/** A warn mark's height: half a crit mark's, centered on the same line, so
 * the two levels differ by size as well as by color (Yes/No marks are warn
 * marks). */
export function warnMark(mark: number): number {
	return Math.round(mark / 2);
}

/** Each row's place in the band: equal rows, whole pixels. */
export function eventRows(n: number): { readonly y0: number; readonly y1: number; readonly mark: number }[] {
	const band = EVENTS_BOTTOM - EVENTS_TOP;
	return Array.from({ length: n }, (_, i) => {
		const y0 = EVENTS_TOP + Math.round((i * band) / n);
		const y1 = EVENTS_TOP + Math.round(((i + 1) * band) / n);
		const h = y1 - y0;
		return { y0, y1, mark: n === 1 ? 28 : n === 2 ? 20 : Math.max(10, h - 8) };
	});
}

/**
 * A row's state in each bucket of the timeline: its level where it
 * happened, "ok" where it was watched and did not, null where it was not
 * watched. A bucket with no sample inside a watched stretch keeps the
 * state before it.
 */
export function eventStates(d: Pick<SeriesDraw, "bins" | "spans">, buckets: number, levelOf: (min: number, max: number) => EventLevel | null): (EventLevel | "ok" | null)[] {
	const out: (EventLevel | "ok" | null)[] = new Array<EventLevel | "ok" | null>(buckets).fill(null);
	const sampled = new Array<boolean>(buckets).fill(false);
	const bins = d.bins;
	for (let i = 0; i < bins.n; i++) {
		const j = bins.j[i] as number;
		const level = levelOf(bins.min[i] as number, bins.max[i] as number);
		const prev = out[j];
		// Two segments in one bucket: the worse state wins.
		out[j] = prev === "crit" || level === "crit" ? "crit" : prev === "warn" || level === "warn" ? "warn" : "ok";
		sampled[j] = true;
	}
	for (const s of d.spans) {
		let held: EventLevel | "ok" | null = null;
		for (let j = s.j0; j <= s.j1 && j < buckets; j++) {
			if (sampled[j]) held = out[j] ?? null;
			else if (held !== null) out[j] = held;
			else out[j] = "ok";
		}
	}
	return out;
}

/** Runs of events (any level): each a stretch of consecutive buckets that
 * happened, ended by a bucket that did not or was not watched. */
export function eventCount(states: readonly (EventLevel | "ok" | null)[]): number {
	let count = 0;
	let inside = false;
	for (const s of states) {
		const on = s === "warn" || s === "crit";
		if (on && !inside) count++;
		inside = on;
	}
	return count;
}

export function eventsStyle(b: SceneBuilder, f: PaneFrame, draws: readonly SeriesDraw[]): void {
	const t0 = b.look.text;
	const n = draws.length;
	if (n === 0) return;
	const plot = f.plot;
	const timeline = eventsTimeline(f.extent);
	const legend = { x0: f.extent.x0, x1: timeline.x0 };
	const rows = eventRows(n);
	const highlight = ((f.input.highlight % n) + n) % n;
	const marks = new CellPaths();
	const hairlines = new CellPaths();
	const hair = mixToward(t0.label, b.look.surface, 0.55);
	const paneStart = b.prims.length;
	const legendShown = f.left < legend.x1;
	// Three or four names share the first dial slot with their states.
	const nameSize = n <= 2 ? LABEL_SIZE : EVENTS_NAME_3;
	const peers = draws.map((d) => d.input.name || d.input.key);
	const sentences: string[] = [];
	if (f.pane.overlays.axes === true) b.timeGrid(f, EVENTS_TOP, EVENTS_BOTTOM);
	draws.forEach((d, i) => {
		const row = rows[i] as { y0: number; y1: number; mark: number };
		const own = ownBands(f.input.bands, d.input.key);
		const kind = eventKindOf(d.unit, own);
		const upward = bandsOpenUpward(f.input.bands, d.input.key);
		const tester = b.levelTester(f, d);
		const levelOf = (min: number, max: number): EventLevel | null => (kind === "yes" ? (max >= 0.5 ? "warn" : null) : kind === "limit" ? tester(upward ? max : min) : null);
		const states = kind === "none" ? [] : eventStates(d, plot.buckets, levelOf);
		const cy = Math.round((row.y0 + row.y1) / 2);
		const height = { warn: warnMark(row.mark), crit: row.mark };
		// The hairline where watched, the marks where it happened.
		let runStart = -1;
		let runLevel: EventLevel | "ok" | null = null;
		const flush = (end: number): void => {
			if (runStart < 0 || runLevel === null) return;
			const x = plot.x0 + runStart * plot.bucketPx;
			const w = (end - runStart) * plot.bucketPx;
			// Never dimmed for a stale reading (its legend says stale): a
			// dimmed alert color falls toward the series colors.
			if (runLevel !== "ok") marks.add(fillOf(b.alertColors[runLevel]), x, cy - Math.floor(height[runLevel] / 2), w, height[runLevel]);
		};
		// One hairline per watched stretch, under its marks.
		if (kind !== "none") for (const span of d.spans) hairlines.add(fillOf(hair), plot.x0 + span.j0 * plot.bucketPx, cy, (Math.min(span.j1, plot.buckets - 1) - span.j0 + 1) * plot.bucketPx, 1);
		states.forEach((s, j) => {
			if (s === runLevel) return;
			flush(j);
			runStart = j;
			runLevel = s;
		});
		flush(states.length);
		// The legend: name, and the state now (or at the cursor).
		if (legendShown) {
			const baseline = n === 1 ? 52 : Math.round(cy + nameSize * 0.36);
			const state = stateText(b, f, d, kind);
			const right = legend.x1 - PAD;
			const prim = b.inkText(right, baseline, "end", nameSize, 700, state.color, state.text);
			const room = (prim?.bx0 ?? right) - 6 - (legend.x0 + PAD);
			if (f.pane.overlays.legend) {
				const name = fitNameRung(tidyRungs(nameRungs(d.input.name || d.input.key, peers)), nameSize, room);
				if (name !== "") b.inkText(legend.x0 + PAD, baseline, "start", nameSize, 600, i === highlight ? t0.label : t0.unit, name);
			}
		}
		sentences.push(sentenceOf(b, f, d, kind, own, upward, eventCount(states)));
	});
	b.prims.push(...hairlines.prims("base"), ...marks.prims("marks"));
	b.cursorLine(f, EVENTS_TOP, EVENTS_BOTTOM);
	// The bottom row: the highlighted row's count, the cursor, the badge.
	const sentence = sentences[highlight] ?? "";
	const name = draws[highlight]?.input.name || draws[highlight]?.input.key || "";
	const parts = (who: string): string => [who === "" ? sentence : `${who}: ${sentence}`, b.cursorNote(f)].filter((s): s is string => s !== undefined && s !== "").join(" · ");
	// The legend keeps the first dial slot: the bottom row draws over the
	// timeline only.
	const row: PaneFrame = f.right - timeline.x0 >= SLICE_W / 2 ? { ...f, left: Math.max(f.left, timeline.x0) } : f;
	const badgeLeft = b.badge(row).left;
	const room = badgeLeft - 10 - (row.left + PAD);
	const rungs = n === 1 ? [""] : [...tidyRungs(nameRungs(name, peers)), ""];
	const text = rungs.map(parts).find((s) => b.widthOf(s, ROW_SIZE, 600) <= room) ?? parts("");
	b.bottomRow(row, text);
	if (f.pane.overlays.axes === true) b.timeAxis(row, paneStart, EVENTS_BOTTOM);
	b.rowBands(row, paneStart);
}

/** A row's state as the legend shows it: Yes or No, the value past its
 * limit or not, "no limit", or the reading's status word. */
function stateText(b: SceneBuilder, f: PaneFrame, d: SeriesDraw, kind: EventKind): { text: string; color: string } {
	const t0 = b.look.text;
	const value = b.readoutValue(f, d);
	if (value === undefined) return { text: b.statusOf(d) ?? "no data", color: t0.unit };
	if (kind === "none") return { text: t("strip.events.noLimit"), color: t0.unit };
	if (kind === "yes") return value >= 0.5 ? { text: "Yes", color: b.alertColors.warn } : { text: "No", color: t0.unit };
	const m = b.formatOf(d, value);
	const level = b.levelOf(f, d, value);
	const text = f.pane.overlays.unit && m.unitText !== "" ? `${m.valueText} ${m.unitText}` : m.valueText;
	return { text, color: level !== null ? b.alertColors[level] : t0.value };
}

/** "3 times past 85.0 °C in 15 min", "never Yes in 15 min". */
function sentenceOf(b: SceneBuilder, f: PaneFrame, d: SeriesDraw, kind: EventKind, own: readonly AlertBand[], upward: boolean, count: number): string {
	const window = windowWords(f.windowMs);
	if (kind === "none") return t("strip.events.noLimit");
	const how = count === 0 ? "never" : count === 1 ? "once" : "many";
	if (kind === "yes") return SENTENCES.yes[how]({ count, window });
	// The limit that faces normal readings: warn when there is one.
	const first = own.find((x) => x.level === "warn") ?? own[0];
	if (first === undefined) return t("strip.events.noLimit");
	const displayUnit = convertUnit(0, d.unit, b.measure.fahrenheit).unit;
	const limit = `${b.limitText(bandEdge(first, upward), d.unit, d)}${displayUnit === "" || isDataUnit(d.unit) ? "" : ` ${displayUnit}`}`;
	return SENTENCES[upward ? "past" : "under"][how]({ count, limit, window });
}

type Params = Readonly<Record<string, string | number>>;
/** The count sentences, by what a row marks and how often. */
const SENTENCES: Readonly<Record<"yes" | "past" | "under", Readonly<Record<"never" | "once" | "many", (p: Params) => string>>>> = {
	yes: { never: (p) => t("strip.events.yesNever", p), once: (p) => t("strip.events.yesOnce", p), many: (p) => t("strip.events.yesMany", p) },
	past: { never: (p) => t("strip.events.pastNever", p), once: (p) => t("strip.events.pastOnce", p), many: (p) => t("strip.events.pastMany", p) },
	under: { never: (p) => t("strip.events.underNever", p), once: (p) => t("strip.events.underOnce", p), many: (p) => t("strip.events.underMany", p) }
};
