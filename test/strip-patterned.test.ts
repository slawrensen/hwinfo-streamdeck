/**
 * The Meters and Events strip styles (src/strip/meters.ts, events.ts).
 *
 * - Settings: the two ids round-trip; a pane keeps up to six readings
 *   (Meters on a + XL); an unknown style is kept as stored and draws Trend.
 * - Meters: at most one per dial slot (test/strip-meters-spread.test.ts holds
 *   the spread), the value size and its digit height against the readout's
 *   30 px floor in both faces, a stale value's word and no bar, limits as
 *   ticks with numbers.
 * - Events: Yes/No and limit rows, the hold rule inside a watched stretch,
 *   no hairline where not watched, the count sentence, "no limit".
 * - Input: a meter tap and an Events legend tap inspect the newest moment.
 * - Seams: stitched slices equal the full-width frame.
 * - Payload: seeded worst-case scenes on every geometry, window and look
 *   (the art looks less the deck art piece) stay within the bound.
 * - Goldens: one hash per scene of the two styles' matrix.
 * - Docs: the 15 to 24 px the strip page and the CHANGELOG give a graph's
 *   names, value, window words and LIVE or PAUSED holds on every style
 *   they name (Trend, Area, Compare and Heat with every dial present; Meters and Lanes only if a page names them).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { binsOf, diffRasters, fixtureCase, makeView, READOUT_GEOMETRIES, renderCase, withScreens, type FixtureCase } from "../scripts/lib/strip-fixtures";
import { routeStripInput, hasSeriesChoice, type StripRouting } from "../src/strip/input";
import { IDLE_GESTURE } from "../src/gestures";
import { applyStripEdit } from "../src/strip/edits";
import { eventsTimeline, SLICE_W } from "../src/strip/geometry";
import type { CellsPrim, Prim, TextPrim } from "../src/strip/prims";
import { eventCount, eventStates } from "../src/strip/events";
import { METER_VALUE_MAX, meterCells } from "../src/strip/meters";
import { tidyRungs } from "../src/strip/patterned";
import { digitMetrics } from "../src/strip/readout";
import { buildStripScene, historyWidthFor, renderLogical, STRIP_ROWS, WINDOW_MS, type StripSceneInput } from "../src/strip/scene";
import { MAX_SERIES, SERIES_LIMITS, STRIP_STYLES, stripConfigOf, stripConfigToJson, stripPaneOf, type StripStyle } from "../src/strip/settings";
import { sliceStrip, SLICE_PAYLOAD_LIMIT, svgBytes } from "../src/strip/slicer";
import { ART_PIECE_LIMIT, isArtLook } from "../src/ui/deck-art";
import { DIAL_BACKGROUNDS, type DialBackground } from "../src/ui/dial-background";
import { setFaceFont } from "../src/ui/face-font";
import { inkEdges } from "../src/ui/format";

setFaceFont("tahoma");

const PATTERNED: readonly StripStyle[] = ["meters", "events"];
const set = (path: string, value: unknown): { op: "set"; path: string; value: unknown } => ({ op: "set", path, value });
const texts = (prims: readonly Prim[]): TextPrim[] => prims.filter((p): p is TextPrim => p.k === "text");
const cells = (prims: readonly Prim[]): CellsPrim[] => prims.filter((p): p is CellsPrim => p.k === "cells");
const rectsOf = (c: CellsPrim): { x: number; y: number; w: number; h: number }[] => {
	const out: { x: number; y: number; w: number; h: number }[] = [];
	for (let i = 0; i + 3 < c.rects.length; i += 4) out.push({ x: c.rects[i] as number, y: c.rects[i + 1] as number, w: c.rects[i + 2] as number, h: c.rects[i + 3] as number });
	return out;
};

/** A case with its pane's readings replaced (fixture ids). */
function scene(style: StripStyle, opts: { encoders?: 4 | 6; layout?: "whole" | "split"; background?: DialBackground; window?: "1m" | "5m" | "15m"; series?: string[]; paused?: boolean; present?: boolean[] } = {}): FixtureCase {
	return fixtureCase({ styles: [style, style], layout: opts.layout ?? "whole", encoders: opts.encoders ?? 6, background: opts.background ?? "theme", accent: false, window: opts.window ?? "5m", ...(opts.paused === true ? { paused: true } : {}), ...(opts.present === undefined ? {} : { present: opts.present }), ...(opts.series === undefined ? {} : { extras: [{ series: opts.series }, { series: opts.series }] }) });
}

describe("settings: Meters and Events", () => {
	it("the two ids parse and round-trip as themselves", () => {
		for (const style of PATTERNED) {
			assert.ok((STRIP_STYLES as readonly string[]).includes(style));
			const pane = stripPaneOf({ style, series: [{ key: "a" }] });
			assert.equal(pane.style, style);
			assert.equal("storedStyle" in pane, false);
			const json = stripConfigToJson(stripConfigOf({ panes: [{ style, series: [{ key: "a" }] }] })) as { panes: { style: string }[] };
			assert.equal(json.panes[0]?.style, style);
		}
		assert.deepEqual(SERIES_LIMITS.meters, { min: 1, max: 6 });
		assert.deepEqual(SERIES_LIMITS.events, { min: 1, max: 4 });
	});

	it("a pane keeps six readings (a + XL's dials); a seventh is refused by an edit and cut by the parser", () => {
		assert.equal(MAX_SERIES, 6);
		const seven = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}` }));
		assert.equal(stripPaneOf({ style: "meters", series: seven }).series.length, 6);
		const base = { id: "0123456789abcdef0123456789abcdef", rev: 2, config: stripConfigOf({ layout: "whole", encoders: 6, panes: [{ style: "trend", series: [{ key: "k0" }] }] }) };
		const six = applyStripEdit(base, 2, [set("panes.0.style", "meters"), set("panes.0.series", seven.slice(0, 6))]);
		assert.ok(six.ok);
		assert.equal(six.copy.config.panes[0].series.length, 6);
		assert.equal(applyStripEdit(base, 2, [set("panes.0.series", seven)]).ok, false);
		for (const style of PATTERNED) assert.ok(applyStripEdit(base, 2, [set("panes.0.style", style)]).ok, style);
	});

	it("a style this version does not know is kept as stored and draws exactly as Trend", () => {
		const raw = { layout: "whole", encoders: 6, panes: [{ style: "dots", series: [{ key: "f0:0:1" }] }] };
		const config = stripConfigOf(raw);
		assert.equal(config.panes[0].style, "trend");
		assert.equal(config.panes[0].storedStyle, "dots");
		assert.equal((stripConfigToJson(config, raw) as { panes: { style: string }[] }).panes[0]?.style, "dots");
		// Drawn as Trend, byte for byte.
		const c = scene("trend", { series: ["cpu"] });
		const unknown: StripSceneInput = { ...c.input, config: { ...c.input.config, panes: [{ ...c.input.config.panes[0], storedStyle: "dots" }, c.input.config.panes[1]] } };
		assert.equal(renderLogical(buildStripScene(unknown)), renderLogical(buildStripScene(c.input)));
	});

	it("a stored Readout stays saved and is not drawn on the two styles", () => {
		for (const style of PATTERNED) {
			const plain = scene(style);
			const withReadout: StripSceneInput = { ...plain.input, config: { ...plain.input.config, panes: [{ ...plain.input.config.panes[0], readout: "left" }, plain.input.config.panes[1]] } };
			assert.equal(renderLogical(buildStripScene(withReadout)), renderLogical(buildStripScene(plain.input)), style);
		}
	});
});

describe("Meters", () => {
	it("a reading per dial slot at most, each number inside its slice", () => {
		assert.deepEqual(meterCells({ x0: 601, x1: 1200 }).map((c) => [c.x0, c.x1]), [
			[601, 800],
			[800, 1000],
			[1000, 1200]
		]);
		const c = scene("meters", { series: ["cpu", "gpu"] });
		const r = sliceStrip(c.input);
		assert.match(r.slices[2] as string, /63\.4/);
		for (const p of texts(r.scene.prims).filter((t) => /\d/.test(t.text))) {
			const e = inkEdges([{ text: p.text, fontSize: p.size, fontWeight: p.weight }], p.anchor, p.x);
			assert.equal(Math.floor(e.left / SLICE_W), Math.floor((e.right - 0.01) / SLICE_W), `"${p.text}" inside one slice`);
		}
	});

	it("the value is large enough to read from the chair: digits of 30 px or more in Tahoma and Segoe UI", () => {
		const rows: string[] = [];
		for (const font of ["tahoma", "segoe-ui"] as const) {
			for (const g of READOUT_GEOMETRIES) {
				setFaceFont(font);
				const s = buildStripScene(scene("meters", { encoders: g.encoders, layout: g.layout }).input);
				const size = Math.max(...texts(s.prims).filter((p) => p.weight === 700 && p.pinned === true).map((p) => p.size));
				const cap = size * digitMetrics().cap;
				rows.push(`${font} ${g.encoders * 200} ${g.layout}: ${size} px type, ${cap.toFixed(1)} px digits`);
				assert.ok(cap >= 30, rows[rows.length - 1]);
			}
		}
		setFaceFont("tahoma");
		// 36 px type would give 26.2 (Tahoma) and 25.2 (Segoe UI) px digits,
		// under the floor; the cap is the least size that clears it in both.
		for (const cap of [1489 / 2048, 1434 / 2048]) {
			assert.ok(36 * cap < 30);
			assert.ok(METER_VALUE_MAX * cap >= 30 && (METER_VALUE_MAX - 1) * (1434 / 2048) < 30);
		}
		console.error(`meter digit heights:\n${rows.join("\n")}`);
	});

	it("a stale reading shows its word and no bar; its window's range stays", () => {
		const c = scene("meters", { series: ["cpu"] });
		const pane = c.input.panes[0];
		assert.ok(pane !== undefined);
		const stale: StripSceneInput = { ...c.input, panes: [{ ...pane, series: pane.series.map((s) => ({ ...s, state: "stale" as const })) }, ...c.input.panes.slice(1)] };
		const s = buildStripScene(stale);
		assert.ok(texts(s.prims).some((p) => p.text === "stale"));
		assert.ok(!texts(s.prims).some((p) => p.text === "63.4"));
		const bars = cells(s.prims).flatMap(rectsOf).filter((r) => r.h === 8 && r.w > 1);
		assert.equal(bars.length, 0, "no bar");
		assert.ok(cells(s.prims).flatMap(rectsOf).some((r) => r.h === 2), "range line");
	});

	it("limits are ticks with their number; a value past one takes its color", () => {
		const s = buildStripScene(scene("meters").input);
		const c = scene("meters").input;
		const ticks = cells(s.prims).filter((p) => p.paint.includes(c.alertColors.warn) || p.paint.includes(c.alertColors.crit)).flatMap(rectsOf).filter((r) => r.w === 2 && r.h === 16);
		assert.equal(ticks.length, 3, "hot spot warn and crit, pump warn");
		const words = texts(s.prims).map((p) => p.text);
		assert.ok(words.includes("warn 1200"), `the pump's limit is labelled: ${words.join(" | ")}`);
		assert.ok(words.includes("warn 85.0") && words.includes("crit 95.0"), "the hot spot's limits are named beside their ticks");
		assert.ok(texts(s.prims).some((p) => p.text === "range 5 min"));
	});

	it("pressed rotation has nothing to choose on Meters, and a tap inspects the newest moment", () => {
		assert.equal(hasSeriesChoice({ style: "meters", seriesCount: 6, mode: "live" }), false);
		const routing: StripRouting = { layout: "whole", encoders: 6, sharedWindow: true, bucketPx: 2, panes: [{ style: "meters", seriesCount: 6, mode: "live" }] };
		const r = routeStripInput(routing, IDLE_GESTURE, { kind: "touchTap", column: 1, at: 1000, hold: false, tapPos: [100, 50] });
		assert.deepEqual(r.action, { kind: "inspect", pane: 0, cursor: 0 });
	});
});

describe("Events", () => {
	it("a Yes/No row marks each stretch it said Yes; a numeric row with limits marks each stretch past them; a row without limits says so", () => {
		const c = scene("events", { series: ["htc", "plim", "hot", "power"] });
		const s = buildStripScene(c.input);
		const marks = cells(s.prims).filter((p) => p.layer === "marks").flatMap(rectsOf);
		assert.ok(marks.length >= 6);
		const timeline = eventsTimeline({ x0: 0, x1: 1200 });
		for (const m of marks) assert.ok(m.x >= timeline.x0, "marks only on the timeline");
		const words = texts(s.prims).map((p) => p.text);
		assert.ok(words.includes("no limit"), words.join(" | "));
		assert.ok(words.some((w) => /^Thermal Throttling \(HTC\): Yes \d times in 5 min$/.test(w)), words.join(" | "));
	});

	it("the count sentence says how often the highlighted row crossed its limit", () => {
		const c = scene("events", { series: ["hot"], window: "15m" });
		const words = texts(buildStripScene(c.input).prims).map((p) => p.text);
		assert.ok(words.some((w) => /^\d+ times past 85\.0 °C in 15 min$/.test(w) || /^once past 85\.0 °C in 15 min$/.test(w)), words.join(" | "));
	});

	it("states hold inside a watched stretch, are null where nothing was watched, and a gap splits an event", () => {
		const bins = binsOf([
			{ j: 0, seg: 0, first: 1, min: 1, max: 1, last: 1 },
			{ j: 3, seg: 0, first: 0, min: 0, max: 0, last: 0 },
			{ j: 6, seg: 1, first: 1, min: 1, max: 1, last: 1 }
		]);
		const spans = [
			{ seg: 0, j0: 0, j1: 4 },
			{ seg: 1, j0: 6, j1: 7 }
		];
		const states = eventStates({ bins, spans }, 8, (_min, max) => (max >= 0.5 ? "warn" : null));
		assert.deepEqual(states, ["warn", "warn", "warn", "ok", "ok", null, "warn", "warn"]);
		assert.equal(eventCount(states), 2);
	});

	it("no hairline where the reading was not watched", () => {
		const c = scene("events", { series: ["htc"] });
		const s = buildStripScene(c.input);
		const hair = cells(s.prims).filter((p) => p.layer === "base").flatMap(rectsOf).filter((r) => r.h === 1);
		assert.equal(hair.length, 2, "two watched stretches either side of the gap");
	});

	it("a tap on the legend inspects the newest moment; on the timeline, the moment under it", () => {
		const routing: StripRouting = { layout: "whole", encoders: 6, sharedWindow: true, bucketPx: 2, panes: [{ style: "events", seriesCount: 2, mode: "live" }] };
		const legend = routeStripInput(routing, IDLE_GESTURE, { kind: "touchTap", column: 0, at: 1000, hold: false, tapPos: [100, 50] });
		assert.deepEqual(legend.action, { kind: "inspect", pane: 0, cursor: 0 });
		const timeline = routeStripInput(routing, IDLE_GESTURE, { kind: "touchTap", column: 3, at: 2000, hold: false, tapPos: [100, 50] });
		assert.ok(timeline.action?.kind === "inspect" && timeline.action.cursor > 0);
	});

	it("names lose a dangling separator when a word goes", () => {
		assert.deepEqual(tidyRungs(["GPU Performance Limit - Power", "GPU Performance Limit -", "GPU"]), ["GPU Performance Limit - Power", "GPU Performance Limit", "GPU"]);
	});
});

// ---- seams, payload, goldens -------------------------------------------------------

/** The matrix: each style on every geometry, on Glass, Tint and Clear, live
 * and (whole Glass) paused. */
function matrix(): FixtureCase[] {
	const out: FixtureCase[] = [];
	for (const style of PATTERNED) {
		for (const g of READOUT_GEOMETRIES) {
			for (const background of ["glass", "tint", "clear"] as const) {
				const c = scene(style, { encoders: g.encoders, layout: g.layout, background });
				out.push({ ...c, id: `${style}-${g.encoders * 200}-${g.layout}-${background}` });
			}
			const paused = scene(style, { encoders: g.encoders, layout: g.layout, background: "theme", paused: true, window: "1m" });
			out.push({ ...paused, id: `${style}-${g.encoders * 200}-${g.layout}-theme-paused-1m` });
		}
	}
	return out;
}

describe("seams: stitched slices equal the full-width frame", () => {
	it("every scene of the two styles' matrix", async () => {
		for (const c of matrix()) {
			// Tint rings its marks, and every look rings the row words over the
			// plot (scene.ts ROWS_FILTER): drawn past the viewport, as QtSvg does.
			const halo = c.input.config.background === "tint" || buildStripScene(c.input).prims.some((p) => p.layer === "rows");
			const r = await renderCase(c, halo);
			const d = diffRasters(r.reference, r.stitched, 2);
			assert.ok(d.maxDiff <= 40 && d.over <= 32, `${c.id}: max ${d.maxDiff}, ${d.over} px over 2`);
		}
	});
});

describe("payload: no slice over 8192 bytes", () => {
	const rand = (seed: number): (() => number) => {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	};
	const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;

	/** A case whose every reading moves on every column, crosses its limits
	 * all the time and has gaps every few columns. */
	function worst(r: () => number, style: StripStyle): FixtureCase {
		const encoders = pick(r, [4, 6] as const);
		const layout = pick(r, ["whole", "split"] as const);
		const window = pick(r, ["1m", "5m", "15m"] as const);
		const background = pick(r, DIAL_BACKGROUNDS);
		const ids = style === "events" ? ["htc", "plim", "hot", "power"] : style === "meters" ? ["cpu", "gpu", "hot", "load", "power", "fan"] : ["power", "load", "fan"];
		const c = fixtureCase({ styles: [style, style], layout, encoders, background, accent: r() < 0.5, window, paused: r() < 0.2, extras: [{ series: ids }, { series: ids }] });
		const every = pick(r, [0, 3, 5, 9]);
		const noise = 1 + r() * 200;
		const panes = c.input.panes.map((pane, p) => {
			const width = historyWidthFor(c.input.config, encoders, p, 2);
			return {
				...pane,
				series: pane.series.map((s, i) => {
					const yesNo = s.unit === "Yes/No";
					const value = yesNo ? (f: number) => (Math.sin(f * 4001 * (1.3 + i)) > 0 ? 1 : 0) : (f: number) => Math.abs(150 + noise * Math.sin(f * 4001 * (1.3 + i * 0.37)));
					const gaps: [number, number][] = every > 0 ? Array.from({ length: Math.floor(width / every) }, (_, g) => [(g * every) / width, (g * every + 1) / width]) : [];
					return { ...s, history: makeView({ windowMs: WINDOW_MS[window], widthPx: width, unit: s.unit, value, gaps }), current: value(1) };
				})
			};
		});
		return { ...c, id: `${style}-${encoders}-${layout}-${window}-${background}`, input: { ...c.input, panes } };
	}

	for (const style of PATTERNED) {
		it(`${style}: 120 seeded worst-case scenes on every geometry, window and look stay within the bound (less the deck art piece on the art looks)`, () => {
			let largest = 0;
			let largestArt = 0;
			let coarsened = 0;
			let reduced = 0;
			for (let seed = 1; seed <= 120; seed++) {
				const r = rand(seed * 7 + style.length);
				const c = worst(r, style);
				const result = sliceStrip(c.input);
				const bound = SLICE_PAYLOAD_LIMIT - (isArtLook(c.input.config.background) ? ART_PIECE_LIMIT : 0);
				for (const svg of result.slices) {
					if (svg === null) continue;
					const bytes = svgBytes(svg);
					assert.ok(bytes <= bound, `seed ${seed} ${c.id}: ${bytes} over ${bound}`);
					largest = Math.max(largest, bytes);
					if (isArtLook(c.input.config.background)) largestArt = Math.max(largestArt, bytes);
				}
				if (result.coarsened) coarsened++;
				if (result.reduced === true) reduced++;
			}
			console.error(`${style}: largest worst-case slice ${largest} B (the art looks ${largestArt} B of ${SLICE_PAYLOAD_LIMIT - ART_PIECE_LIMIT}), ${coarsened} of 120 coarsened, ${reduced} drawn as values`);
			if (style !== "events") assert.equal(reduced, 0, "drawn as itself");
		});
	}

	it("every scene of the matrix fits at the finest width", () => {
		const rows: string[] = [];
		for (const c of matrix()) {
			const r = sliceStrip(c.input);
			assert.equal(r.coarsened, false, c.id);
			rows.push(`${c.id}: ${r.maxBytes}`);
			assert.ok(r.maxBytes <= 8192);
		}
		console.error(rows.join("\n"));
	});
});

const GOLDEN = new URL("./golden/strip-patterned-slices.json", import.meta.url);

describe("goldens: Meters and Events, one hash per scene", () => {
	const now: Record<string, string> = {};
	for (const c of matrix()) {
		const r = sliceStrip(c.input);
		now[c.id] = createHash("sha256")
			.update([renderLogical(r.scene), ...r.slices.map((s) => s ?? "(absent)")].join("\n"))
			.digest("hex");
	}
	if (process.env.STRIP_GOLDEN_WRITE === "1") writeFileSync(GOLDEN, `${JSON.stringify(now, null, "\t")}\n`);
	const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
	it("covers every scene", () => {
		assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
		assert.equal(Object.keys(golden).length, 32);
	});
	it("every scene draws the same bytes", () => {
		assert.deepEqual(
			Object.keys(golden).filter((id) => now[id] !== golden[id]),
			[]
		);
	});
});

/**
 * The strip page and the CHANGELOG say a graph's names, its current value,
 * the window's words and LIVE or PAUSED draw at 15 to 24 px. Each page's
 * claim covers the styles its sentence (with the one before it) names, or
 * every style when it names none; a page without the claim covers none.
 */
function sizeClaim(file: string): { readonly file: string; readonly styles: readonly StripStyle[] } {
	const text = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8").replace(/\*\*/g, "").replace(/\s+/g, " ");
	const at = text.indexOf("15 to 24 px");
	if (at === -1) return { file, styles: [] };
	const stop = (before: number): number => Math.max(text.lastIndexOf(". ", before), text.lastIndexOf("; ", before));
	const start = stop(stop(at) - 1) + 2;
	const ends = [text.indexOf(". ", at), text.indexOf("; ", at)].filter((i) => i !== -1);
	const sentence = text.slice(Math.max(0, start), ends.length === 0 ? text.length : Math.min(...ends));
	const named = STRIP_STYLES.filter((s) => new RegExp(`\\b${s[0]?.toUpperCase()}${s.slice(1)}\\b`).test(sentence));
	return { file, styles: named.length === 0 ? STRIP_STYLES : named };
}

describe("the docs' 15 to 24 px for a graph's words holds on every style they say it for", () => {
	const FLOOR = 15;
	const claims = ["docs/strip-display.md", "CHANGELOG.md"].map(sizeClaim);
	const claimedBy = (style: StripStyle): string => claims.filter((c) => c.styles.includes(style)).map((c) => c.file).join(" and ");
	const words = (c: FixtureCase): TextPrim[] => texts(buildStripScene(c.input).prims);
	const under = (c: FixtureCase, picked: readonly TextPrim[]): string[] => picked.filter((p) => p.size < FLOOR).map((p) => `${c.id}: ${p.size} px "${p.text}"`);

	// The words drawn over the graph sit on the top and bottom rows
	// (SceneBuilder.rowText). Every dial present and no conflict note: the
	// "smaller where room is short" the pages allow does not apply.
	it("Trend, Area, Compare and Heat with every dial present: the names, the value, the window's words and LIVE or PAUSED", () => {
		const styles = (["trend", "area", "compare", "heat"] as const).filter((s) => claimedBy(s) !== "");
		assert.ok(styles.length > 0, "the strip page and the CHANGELOG say 15 to 24 px for these styles");
		const sets: (readonly string[] | undefined)[] = [undefined, ["gpu"], ["gpu", "hot"], ["gpu", "load"], ["gpu", "hot", "load"]];
		const off: string[] = [];
		for (const style of styles) {
			for (const layout of ["whole", "split"] as const) {
				for (const encoders of [4, 6] as const) {
					for (const paused of [false, true]) {
						for (const series of sets) {
							if (series !== undefined && (series.length < SERIES_LIMITS[style].min || series.length > SERIES_LIMITS[style].max)) continue;
							const c = fixtureCase({ styles: [style], layout, encoders, background: "glass", accent: false, paused, ...(series === undefined ? {} : { extras: [{ series }] }) });
							const id = `${c.id}${paused ? "-paused" : ""}${series === undefined ? "" : `-${series.join("+")}`}`;
							const panes = c.input.panes.length;
							const row = (y: number): TextPrim[] => words(c).filter((p) => p.layer === "rows" && p.y === y);
							const top = row(STRIP_ROWS.topBaseline);
							// Heat's color scale shares the bottom row; its numbers are a scale, not words.
							const bottom = row(STRIP_ROWS.bottomBaseline).filter((p) => !(style === "heat" && /^-?[\d.]+( \S+)?$/.test(p.text)));
							const names = c.input.panes.flatMap((p) => p.series.map((s) => s.name.split(" ")[0] as string));
							// A half of a split can drop names and keep chips and values
							// (the page says so). Readings in more than one unit give their
							// values on the names line instead of one large value.
							if (layout === "whole") assert.ok(top.some((p) => p.weight === 600 && names.some((n) => p.text.startsWith(n))), `${id}: a name`);
							assert.ok(top.some((p) => p.weight === 700 || (/\d/.test(p.text) && !/\b(warn|crit)\b/.test(p.text))), `${id}: the current value`);
							assert.equal(bottom.filter((p) => p.text.startsWith("5 min")).length, panes, `${id}: the window's words`);
							assert.equal(bottom.filter((p) => p.text === (paused ? "PAUSED 14:02:51" : "LIVE")).length, panes, `${id}: LIVE or PAUSED`);
							for (const p of [...top, ...bottom]) if (p.size < FLOOR || p.size > 24) off.push(`${id}: ${p.size} px "${p.text}"`);
						}
					}
				}
			}
		}
		assert.deepEqual(off, [], `${styles.join(", ")}: ${FLOOR} to 24 px with every dial present`);
	});

	it("Meters: PAUSED, the window's words, and a screen's name and place where the window's words stand", () => {
		const by = claimedBy("meters");
		if (by === "") return;
		const short: string[] = [];
		for (const encoders of [4, 6] as const) {
			const base = { styles: ["meters"] as StripStyle[], layout: "whole" as const, encoders, background: "glass" as const, accent: false };
			const live = fixtureCase(base);
			const paused = fixtureCase({ ...base, paused: true });
			const screen = withScreens(fixtureCase(base), { count: 3, at: 1, name: "Temps" });
			const window = words(live).filter((p) => p.text.startsWith("range "));
			const badge = words(paused).filter((p) => p.text.startsWith("PAUSED"));
			const place = words(screen).filter((p) => p.text.includes("2 of 3"));
			assert.ok(window.length > 0 && badge.length > 0 && place.length > 0, `${encoders * 200} px: the window's words, PAUSED and the screen's place are drawn`);
			short.push(...under(live, window), ...under(paused, badge), ...under(screen, place));
		}
		assert.deepEqual(short, [], `${by} say ${FLOOR} to 24 px for these words on every graph style, Meters included`);
	});

	it("Lanes with three lanes: each lane's name and current value", () => {
		const by = claimedBy("lanes");
		if (by === "") return;
		const short: string[] = [];
		for (const encoders of [4, 6] as const) {
			const c = fixtureCase({ styles: ["lanes"], layout: "whole", encoders, background: "glass", accent: false });
			const names = (c.input.panes[0]?.series ?? []).map((s) => s.name);
			const prims = words(c);
			const named = prims.filter((p) => p.weight === 600 && names.some((n) => p.text.startsWith(n)));
			const values = prims.filter((p) => p.weight === 700 && p.text !== "LIVE" && /^[\d.]+ (°C|%|W)$/.test(p.text));
			assert.equal(named.length, 3, `${c.id}: three lane names`);
			assert.equal(values.length, 3, `${c.id}: three lane values`);
			short.push(...under(c, named), ...under(c, values));
		}
		assert.deepEqual(short, [], `${by} say ${FLOOR} to 24 px for these words on every graph style, Lanes included`);
	});
});
