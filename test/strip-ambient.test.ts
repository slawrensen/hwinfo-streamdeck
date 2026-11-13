/**
 * The strip's Ambient style (src/strip/ambient.ts and its settings, rule,
 * history, scene, slicing and input paths): an older 1.8 build reading the
 * pane as Trend and writing it back as it was; the Unit rule (every reading
 * of this PC in one native unit, Yes/No and non-finite readings left out,
 * any unit kept by the other sources, 48 drawn); only real samples drawn,
 * each on its own
 * window range with its unit's quiet span, gaps kept, stale dimmed and
 * said; slices that join the reference frame at every seam; every slice
 * within its payload bound at the caps under worst-case data; the Ambient
 * share of the group history allowance; and the gestures.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ambientFixture, binsOf, diffRasters, renderCase, type FixtureCase } from "../scripts/lib/strip-fixtures";
import { AMBIENT_HISTORY_BUDGET_BYTES, GROUP_HISTORY_BUDGET_BYTES, HistoryStore } from "../src/history/store";
import { ENTRY_BYTES, TIERS } from "../src/history/window";
import { SensorType } from "../src/hwinfo/types";
import { AMBIENT_BOTTOM, AMBIENT_TOP, ambientCellPx, ambientPlotOf, ambientTrail, AURORA_PASSES, quietSpanOf } from "../src/strip/ambient";
import { applyStripEdit } from "../src/strip/edits";
import { paneExtents, SLICE_W } from "../src/strip/geometry";
import { resolveGroup } from "../src/strip/group";
import { routeStripInput, stripTriggerDescriptions, type StripRouting } from "../src/strip/input";
import type { SkeinPrim } from "../src/strip/prims";
import { buildStripScene, renderLogical, type StripSceneInput } from "../src/strip/scene";
import { AMBIENT_DRAW_MAX, stripConfigOf, stripConfigToJson, stripPaneOf, stripPaneToJson } from "../src/strip/settings";
import { SLICE_PAYLOAD_LIMIT, sliceStrip, svgBytes } from "../src/strip/slicer";
import { ART_PIECE_LIMIT, isArtLook } from "../src/ui/deck-art";
import { DIAL_BACKGROUNDS } from "../src/ui/dial-background";
import { IDLE_GESTURE } from "../src/gestures";
import { OLDER_BUILD_DOCS, olderBuildRecord } from "./strip-older-build-driver";
import { ruleRuntime, snap, type Spec } from "./strip-rule-runtime";

const texts = (input: StripSceneInput): string[] => buildStripScene(input).prims.flatMap((p) => (p.k === "text" ? [p.text] : []));

// ---- settings --------------------------------------------------------------------

describe("Ambient settings: a rule, salvaged and kept", () => {
	it("a pane with no rule writes as before", () => {
		const raw = { style: "trend", series: [{ key: "a" }], overlays: { current: true, minmax: false, unit: true, legend: true, time: true }, scale: {}, bands: [] };
		assert.deepEqual(stripPaneToJson(stripPaneOf(raw)), raw);
	});

	it("a Unit rule round-trips with its unit", () => {
		const stored = { style: "ambient", series: [], group: { from: "unit", unit: "°C", keys: [], view: "auto" } };
		const json = stripPaneToJson(stripPaneOf(stored), stored) as Record<string, unknown>;
		assert.deepEqual(json.group, { from: "unit", unit: "°C", keys: [], view: "auto" });
		// A unit on a Folder or Filter rule this build wrote never happens: a
		// Folder rule carrying one is a Unit rule an older 1.8 build rewrote.
		assert.deepEqual(stripPaneOf({ style: "ambient", group: { from: "filter", filter: "*x*", unit: "°C", keys: [], view: "auto" } }).group, { from: "filter", filter: "*x*", keys: [], view: "auto" });
		assert.equal(stripPaneOf({ style: "ambient", group: { from: "folder", unit: "°C", keys: [], view: "auto" } }).group?.from, "unit");
	});

	it("edits set a Unit rule exactly, and refuse anything the parser would change", () => {
		const config = stripConfigOf({ layout: "whole", encoders: 6, panes: [{ style: "ambient", series: [] }, {}] });
		const base = { id: "g", rev: 1, config };
		const rule = applyStripEdit(base, 1, [{ op: "set", path: "panes.0.group", value: { from: "unit", unit: "MHz", keys: [], view: "auto" } }]);
		assert.ok(rule.ok);
		assert.deepEqual(rule.copy.config.panes[0].group, { from: "unit", unit: "MHz", keys: [], view: "auto" });
		for (const bad of [
			{ from: "unit", unit: "", keys: [], view: "auto" },
			{ from: "unit", unit: "x".repeat(17), keys: [], view: "auto" },
			{ from: "folder", unit: "°C", keys: [], view: "auto" },
			{ from: "unit", unit: 5, keys: [], view: "auto" }
		]) {
			assert.equal(applyStripEdit(base, 1, [{ op: "set", path: "panes.0.group", value: bad }]).ok, false, JSON.stringify(bad));
		}
	});

	it("an older 1.8 build reads Ambient and Fleet as Trend, keeps them as stored, and this build reads its rewrite as it reads the stored copy", () => {
		const golden = JSON.parse(readFileSync(new URL("./golden/strip-older-build.json", import.meta.url), "utf8")) as Record<string, { style: string; storedStyle: string | null; words: string[]; rewritten: { panes: Record<string, unknown>[] } }>;
		for (const name of ["ambient", "fleet"]) {
			const older = golden[name];
			assert.ok(older !== undefined);
			// The older build: drawn as Trend, the style kept, never written as trend.
			assert.equal(older.style, "trend");
			assert.equal(older.storedStyle, name);
			assert.ok(older.words.includes("Choose readings in the dial settings"), older.words.join(" | "));
			assert.equal(older.rewritten.panes[0]?.style, name);
			// This build reads the older build's rewrite as it was stored; a
			// Fleet reads as a Group (test/strip-cut-looks.test.ts).
			const reads = name === "fleet" ? "group" : name;
			const back = stripConfigOf(older.rewritten);
			assert.equal(back.panes[0].style, reads);
			assert.deepEqual(back.panes[0].group, stripConfigOf(OLDER_BUILD_DOCS[name]).panes[0].group);
			if (name === "ambient") assert.deepEqual((stripConfigToJson(back) as { panes: Record<string, unknown>[] }).panes[0]?.ambient, { look: "silk" }, "kept, and read by nothing");
			// And this build's own reading of the stored copy.
			const now = olderBuildRecord(OLDER_BUILD_DOCS[name] as Record<string, unknown>);
			assert.equal(now.style, reads);
			assert.equal(now.storedStyle, name === "fleet" ? "fleet" : null);
		}
	});
});

// ---- the rule ------------------------------------------------------------------------

function machineSpecs(): Spec[] {
	return [
		...Array.from({ length: 60 }, (_, i) => ({ sensor: "CPU [#0]: Example", label: `Core ${i} Temperature`, unit: "°C", value: 50 + (i % 9), type: SensorType.Temperature })),
		...Array.from({ length: 8 }, (_, i) => ({ sensor: "CPU [#0]: Example", label: `Core ${i} Clock`, unit: "MHz", value: 4800 + i })),
		{ sensor: "Drive", label: "Drive Temperature", unit: "°C", value: 38, type: SensorType.Temperature },
		{ sensor: "Drive", label: "Drive Failure", unit: "Yes/No", value: 0, type: SensorType.Other },
		{ sensor: "Board", label: "Missing Temperature", unit: "°C", value: Number.NaN, type: SensorType.Temperature },
		{ sensor: "Board", label: "CPU Fan", unit: "RPM", value: 1200, type: SensorType.Fan }
	];
}

describe("Ambient readings: the rule against each snapshot", () => {
	it("every reading in a unit is this PC's readings in that native unit, in HWiNFO's order; no finite value is left out; 48 draw", () => {
		const s = snap(machineSpecs());
		const ambient = resolveGroup(s, stripPaneOf({ style: "ambient", group: { from: "unit", unit: "°C", keys: [], view: "auto" } }));
		assert.equal(ambient.status, "ok");
		assert.equal(ambient.sameUnit, 61, "60 cores and the drive; the reading with no value is left out");
		assert.equal(ambient.keys.length, AMBIENT_DRAW_MAX);
		assert.deepEqual(ambient.keys, s.readings.filter((r) => r.unit === "°C" && Number.isFinite(r.value)).slice(0, 48).map((r) => r.key));
		// A pane with no rule yet: every temperature.
		assert.equal(resolveGroup(s, stripPaneOf({ style: "ambient" })).sameUnit, 61);
		assert.equal(resolveGroup(s, stripPaneOf({ style: "ambient", group: { from: "unit", unit: "kPa", keys: [], view: "auto" } })).status, "empty");
	});

	it("a folder or filter keeps every unit for Ambient (each reading on its own range) and says how many units; Group still draws one", () => {
		const s = snap(machineSpecs());
		const anchor = s.readings[0]?.key as string;
		const ambient = resolveGroup(s, stripPaneOf({ style: "ambient", series: [{ key: anchor }], group: { from: "folder", keys: [], view: "auto" } }));
		assert.equal(ambient.otherUnits, 0);
		assert.equal(ambient.sameUnit, 68);
		const drive = resolveGroup(s, stripPaneOf({ style: "ambient", group: { from: "filter", filter: "*drive*", keys: [], view: "auto" } }));
		assert.equal(drive.sameUnit, 1, "the Yes/No reading is left out");
		const mixed = resolveGroup(s, stripPaneOf({ style: "ambient", group: { from: "list", keys: [s.readings[60]?.key, s.readings[0]?.key, s.readings[71]?.key].filter((k): k is string => k !== undefined), view: "auto" } }));
		assert.equal(mixed.units, 3);
		const group = resolveGroup(s, stripPaneOf({ style: "group", series: [{ key: anchor }], group: { from: "folder", keys: [], view: "auto" } }));
		assert.equal(group.otherUnits, 8);
	});
});

// ---- the light: real samples, own ranges --------------------------------------------------

describe("Ambient drawing: real samples on each reading's own range", () => {
	it("the cell is 8 px or one stored entry wide, and divides 200", () => {
		assert.equal(ambientCellPx(1200, "15m"), 8);
		assert.equal(ambientCellPx(1200, "5m"), 8);
		assert.equal(ambientCellPx(1200, "1m"), 20);
		assert.equal(ambientCellPx(800, "1m"), 20);
		assert.equal(ambientCellPx(599, "1m"), 10);
		assert.equal(ambientCellPx(1200, "15m", 1), 10, "one ladder step coarser");
		for (const w of [1200, 800, 599, 399]) for (const win of ["1m", "5m", "15m"] as const) for (const step of [0, 1, 2]) assert.equal(200 % ambientCellPx(w, win, step), 0);
	});

	it("each vertex is a cell's last recorded sample; the range is the window's own; a quiet reading sits on its unit's quiet span", () => {
		const bins = binsOf([
			{ j: 0, seg: 0, first: 40, min: 39, max: 41, last: 40 },
			{ j: 1, seg: 0, first: 44, min: 44, max: 60, last: 50 },
			{ j: 3, seg: 1, first: 45, min: 45, max: 45, last: 45 }
		]);
		const t = ambientTrail(bins, 4, "°C");
		assert.equal(t.norm[0], (40 - 39) / (60 - 39));
		assert.equal(t.norm[1], (50 - 39) / (60 - 39), "the cell's last sample, on the range its peak set");
		assert.ok(Number.isNaN(t.norm[2] as number), "nothing recorded");
		assert.deepEqual(t.runs, [{ j0: 0, j1: 1 }, { j0: 3, j1: 3 }], "a new segment is a new run: the gap stays a gap");
		const quiet = ambientTrail(binsOf([{ j: 0, seg: 0, first: 50, min: 50, max: 51, last: 51 }]), 1, "°C");
		assert.equal(quiet.norm[0], (51 - (50.5 - 2.5)) / 5, "a 1 °C move on the 5 °C quiet span, centered");
		assert.equal(quietSpanOf("MHz", 0, 1), 200);
		assert.equal(quietSpanOf("GB", 100, 120), 2.4, "else 2 % of its magnitude");
	});

	it("the threads are one path with the curtain as five shifted, wider, fainter copies; every point a recorded cell, short history on the right", () => {
		const c = ambientFixture({ n: 12, kind: "temp", from: 0.5 });
		const scene = buildStripScene(c.input);
		const skeins = scene.prims.filter((p): p is SkeinPrim => p.k === "skein");
		assert.equal(skeins.length, 1);
		const skein = skeins[0] as SkeinPrim;
		assert.equal(skein.passes.length, 6);
		assert.deepEqual(AURORA_PASSES.map((p) => p.dy), [-33, -22, -13, -7, -2, 0]);
		assert.ok(AURORA_PASSES.every((p, i) => i === 0 || p.width < (AURORA_PASSES[i - 1] as { width: number }).width), "each copy narrower than the one before, the thread itself last");
		const plot = ambientPlotOf(paneExtents("whole", 6)[0] as { x0: number; x1: number }, "15m", 2);
		for (const line of skein.lines) {
			for (let i = 0; i < line.length; i += 2) {
				const x = line[i] as number;
				assert.equal((x - plot.x0 - plot.bucketPx / 2) % plot.bucketPx, 0, "at a cell's middle");
				assert.ok(x >= plot.x0 + 0.5 * plot.x1, "history began half way: nothing on the left half");
				assert.ok((line[i + 1] as number) >= AMBIENT_TOP && (line[i + 1] as number) <= AMBIENT_BOTTOM);
			}
		}
		const words = texts(c.input);
		assert.ok(words.includes("15 min"), words.join(" | "));
		assert.ok(!words.some((w) => /Ambient/.test(w)), "the style's name stays out of the frame");
	});

	it("stale dims the light to 45 % and says so; nothing is extended past the last sample", () => {
		const live = buildStripScene(ambientFixture({ n: 8 }).input);
		const stale = buildStripScene(ambientFixture({ n: 8, stale: true }).input);
		assert.ok(texts(ambientFixture({ n: 8, stale: true }).input).includes("stale"));
		assert.match(stale.localPaints?.map((p) => p.def).join("") ?? "", /id="ams"/);
		assert.match(live.localPaints?.map((p) => p.def).join("") ?? "", /id="am"/);
	});

	it("draws no scale ends, alert bands or overlays; the panel's limits and overlays change nothing", () => {
		const c = ambientFixture({ n: 8 });
		const plain = renderLogical(buildStripScene(c.input));
		const config = stripConfigOf({ ...JSON.parse(JSON.stringify(stripConfigToJson(c.input.config))), panes: [{ style: "ambient", series: [], group: { from: "unit", unit: "°C", keys: [], view: "auto", limits: { warn: 50, crit: 60, below: false } }, overlays: { axes: true, minmax: true }, scale: { min: 0, max: 10 } }, {}] });
		const dressed = renderLogical(buildStripScene({ ...c.input, config }));
		assert.equal(dressed, plain);
	});

	it("says what it leaves out: readings past the cap, readings the history allowance refused", () => {
		const words = texts(ambientFixture({ n: 48, refused: 8, sameUnit: 53 }).input).join(" | ");
		assert.match(words, /48 of 53 shown/);
		assert.match(words, /history full: 40 of 48/);
	});
});

// ---- seams ---------------------------------------------------------------------------

describe("Ambient seams: the slices join the reference frame", () => {
	const seamOnly = (width: number): Set<number> => {
		const away = new Set<number>();
		for (let x = 0; x < width; x++) if (!(x % SLICE_W === 0 || x % SLICE_W === SLICE_W - 1)) away.add(x);
		return away;
	};
	it("at every seam the stitched slices differ from the reference by at most 1 level, on every deck and layout", async () => {
		const rows: string[] = [];
		for (const [layout, encoders] of [["whole", 6], ["split", 6], ["whole", 4], ["split", 4]] as const) {
			for (const kind of ["temp", "mixed"] as const) {
				const c = ambientFixture({ n: 48, kind, layout, encoders, window: kind === "temp" ? "15m" : "5m", background: "theme" });
				const r = await renderCase(c);
				const seam = diffRasters(r.reference, r.stitched, 1, seamOnly(r.width));
				rows.push(`${c.id}: seam ${seam.maxDiff}`);
				assert.ok(seam.maxDiff <= 1, `${c.id}: ${seam.maxDiff} levels at a seam (${JSON.stringify(seam.worst)})`);
			}
		}
		console.error(rows.join("\n"));
	});
});

// ---- payload ----------------------------------------------------------------------------

describe("Ambient payload: no slice over its bound at the caps", () => {
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
	const boundOf = (c: FixtureCase): number => SLICE_PAYLOAD_LIMIT - (isArtLook(c.input.config.background) ? ART_PIECE_LIMIT : 0);

	it("at its cap, every window, deck and layout, on the worst data (a random walk), Clear and Stars", () => {
		const rows: string[] = [];
		for (const [layout, encoders] of [["whole", 6], ["split", 6], ["whole", 4], ["split", 4]] as const) {
			for (const window of ["1m", "5m", "15m"] as const) {
				// A sample: Stars stands for the art looks, which share one
				// bound; the seeded scenes below draw every Background.
				for (const background of ["clear", "tint", "stars"] as const) {
					const c = ambientFixture({ n: AMBIENT_DRAW_MAX, kind: "walk", layout, encoders, window, background });
					const r = sliceStrip(c.input);
					assert.ok(r.maxBytes <= boundOf(c), `${c.id}: ${r.maxBytes} over ${boundOf(c)}`);
					assert.notEqual(r.reduced, true, `${c.id}: every reading drawn`);
					rows.push(`${c.id}: ${r.maxBytes} B at step ${r.bucketPx}`);
				}
			}
		}
		console.error(rows.join("\n"));
	});

	it("over 120 seeded worst-case Ambient scenes (noise every cell, dense gaps, every Background), every slice is within its bound", () => {
		let worst = 0;
		for (let seed = 1; seed <= 120; seed++) {
			const r = rand(seed);
			const c = ambientFixture({
				n: pick(r, [12, 24, 36, 48]),
				kind: pick(r, ["temp", "mixed", "walk"] as const),
				layout: pick(r, ["whole", "split"] as const),
				encoders: pick(r, [4, 6] as const),
				window: pick(r, ["1m", "5m", "15m"] as const),
				background: pick(r, DIAL_BACKGROUNDS),
				gapEvery: pick(r, [0, 2, 3, 7]),
				stale: r() < 0.15,
				bucketPx: pick(r, [1, 2] as const)
			});
			const result = sliceStrip(c.input);
			for (const svg of result.slices) {
				if (svg === null) continue;
				const bytes = svgBytes(svg);
				assert.ok(bytes <= boundOf(c), `seed ${seed} ${c.id}: ${bytes} bytes over ${boundOf(c)}`);
				worst = Math.max(worst, bytes);
			}
		}
		assert.ok(worst > SLICE_PAYLOAD_LIMIT * 0.5, `the generator reaches toward the bound (${worst})`);
	});
});

// ---- history: the Ambient share -----------------------------------------------------------

describe("Ambient history: at most 384 KiB of the group allowance, the shown window only", () => {
	const T2 = (TIERS[2] as { capacity: number }).capacity * ENTRY_BYTES;

	it("48 readings of 15 minutes fit the Ambient share; past it a reading is refused while a Group pane still has room", () => {
		const t = { now: 1_000 };
		const store = new HistoryStore({ now: () => t.now });
		assert.equal(AMBIENT_HISTORY_BUDGET_BYTES, 384 * 1024);
		const keys = Array.from({ length: 60 }, (_, i) => `a:0:${i}`);
		store.setInterest("strip:g:0:group", keys.slice(0, 48).map((savedKey) => ({ savedKey, window: "15m" as const })), { pool: "ambient" });
		assert.equal(store.ambientShare().bytes, 48 * T2);
		assert.equal(store.diagnostics().group.bytes, 48 * T2, "the share is part of the group allowance");
		assert.equal(store.diagnostics().bytes, 0, "the keys' budget is untouched");
		store.setInterest("strip:g:1:group", keys.slice(48, 60).map((savedKey) => ({ savedKey, window: "15m" as const })), { pool: "ambient" });
		const refused = keys.slice(48, 60).filter((k) => store.refused(k, "15m")).length;
		assert.equal(refused, 12 - Math.floor((AMBIENT_HISTORY_BUDGET_BYTES - 48 * T2) / T2), "the second Ambient pane gets what the first left");
		assert.ok(store.ambientShare().bytes <= AMBIENT_HISTORY_BUDGET_BYTES);
		// A Group pane still has the rest of the group allowance.
		store.setInterest("strip:h:0:group", Array.from({ length: 40 }, (_, i) => ({ savedKey: `g:0:${i}`, window: "15m" as const })), { pool: "group" });
		assert.equal(Array.from({ length: 40 }, (_, i) => `g:0:${i}`).filter((k) => store.refused(k, "15m")).length, 0);
		assert.ok(store.diagnostics().group.bytes <= GROUP_HISTORY_BUDGET_BYTES);
	});

	it("on the runtime, Ambient asks for the shown window only, from the Ambient share; a turn moves it", () => {
		const specs: Spec[] = Array.from({ length: 30 }, (_, i) => ({ sensor: "CPU", label: `Core ${i} Temperature`, unit: "°C", value: 50 + i, type: SensorType.Temperature }));
		const rt = ruleRuntime(specs);
		rt.make([{ op: "set", path: "panes.0.style", value: "ambient" }]);
		rt.tick();
		rt.flush();
		const found = [...rt.interest.entries()].find(([id]) => id.endsWith(":0:group"));
		assert.ok(found !== undefined);
		assert.equal(found[1].pool, "ambient");
		assert.deepEqual([...new Set((found[1].entries as { window: string }[]).map((e) => e.window))], ["5m"]);
		assert.equal((found[1].entries as unknown[]).length, 30, "every °C reading (a pane with no rule takes every temperature)");
		rt.turn(2, 1);
		const moved = [...rt.interest.entries()].find(([id]) => id.endsWith(":0:group"))?.[1];
		assert.deepEqual([...new Set((moved?.entries as { window: string }[]).map((e) => e.window))], ["15m"]);
		assert.equal(rt.history.ambientShare().bytes, rt.history.diagnostics().group.bytes);
	});

	it("on the runtime, frames draw the readings and say stale when HWiNFO stops writing", () => {
		const specs: Spec[] = Array.from({ length: 10 }, (_, i) => ({ sensor: "CPU", label: `Core ${i} Temperature`, unit: "°C", value: 50 + i, type: SensorType.Temperature }));
		const rt = ruleRuntime(specs);
		rt.make([{ op: "set", path: "panes.0.style", value: "ambient" }]);
		for (let k = 0; k < 6; k++) {
			rt.setSpecs(specs.map((s, i) => ({ ...s, value: s.value + ((k * 7 + i) % 5) })));
			rt.tick();
		}
		rt.flush();
		assert.match(rt.frame(), />5 min</);
		assert.match(rt.frame(), /<use xlink:href="#ag0"/);
		rt.stale();
		rt.flush();
		assert.match(rt.frame(), />stale</);
	});
});

// ---- input ------------------------------------------------------------------------------

describe("Ambient input: a turn changes the window, nothing else is new", () => {
	const routing: StripRouting = { layout: "whole", encoders: 6, sharedWindow: true, bucketPx: 2, panes: [{ style: "ambient", seriesCount: 0, mode: "live", group: { count: 48, draw: "lines", current: true } }] };
	it("turn: window; pressed turn, push and taps: nothing", () => {
		const route = (event: Parameters<typeof routeStripInput>[2]) => routeStripInput(routing, IDLE_GESTURE, event).action;
		assert.deepEqual(route({ kind: "dialRotate", column: 2, at: 10, ticks: 1, pressed: false }), { kind: "window", pane: 0, step: 1, scope: "shared" });
		assert.equal(route({ kind: "dialRotate", column: 2, at: 10, ticks: 1, pressed: true }), null);
		assert.equal(route({ kind: "touchTap", column: 2, at: 10, hold: false, tapPos: [50, 50] }), null);
		assert.equal(route({ kind: "touchTap", column: 2, at: 10, hold: true, tapPos: [50, 50] }), null);
		const hints = stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "live", seriesChoice: false, style: "ambient" });
		assert.deepEqual(hints, { rotate: "Time window", push: "No action", touch: "No action", longTouch: "No action" });
	});
});

// ---- goldens ----------------------------------------------------------------------------

const GOLDEN = new URL("./golden/strip-ambient-slices.json", import.meta.url);

/** The goldens: every deck x layout x window, a stale frame, Tint and Stars. */
function ambientGoldenCases(): FixtureCase[] {
	const out: FixtureCase[] = [];
	for (const [layout, encoders] of [["whole", 6], ["split", 6], ["whole", 4], ["split", 4]] as const) {
		for (const window of ["1m", "5m", "15m"] as const) out.push(ambientFixture({ n: AMBIENT_DRAW_MAX, kind: "mixed", layout, encoders, window }));
	}
	out.push({ ...ambientFixture({ n: 12, stale: true }), id: "ambient-stale" });
	out.push({ ...ambientFixture({ n: 24, background: "tint" }), id: "ambient-tint" });
	out.push({ ...ambientFixture({ n: 24, background: "stars", kind: "walk" }), id: "ambient-stars-walk" });
	return out;
}

function sceneHash(c: FixtureCase): string {
	const r = sliceStrip(c.input);
	return createHash("sha256")
		.update([renderLogical(r.scene), ...r.slices.map((s) => s ?? "(absent)")].join("\n"))
		.digest("hex");
}

describe("Ambient goldens", () => {
	const now: Record<string, string> = {};
	for (const c of ambientGoldenCases()) now[c.id] = sceneHash(c);
	if (process.env.STRIP_GOLDEN_WRITE === "1") {
		const existing = (() => {
			try {
				return JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
			} catch {
				return {};
			}
		})();
		const merged = Object.fromEntries(Object.entries({ ...existing, ...now }).sort(([a], [b]) => a.localeCompare(b)));
		writeFileSync(GOLDEN, `${JSON.stringify(merged, null, "\t")}\n`);
	}
	const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
	it("every Ambient scene draws its recorded bytes", () => {
		const ids = Object.keys(golden).filter((id) => id.startsWith("ambient-"));
		assert.deepEqual(ids.sort(), Object.keys(now).sort());
		assert.deepEqual(
			ids.filter((id) => now[id] !== golden[id]),
			[]
		);
	});
});
