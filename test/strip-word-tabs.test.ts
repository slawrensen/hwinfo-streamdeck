/**
 * The small tabs behind the words over a strip graph (F, 2026-11-04): on
 * Glass, Tint, Outline and Clear one tab stands behind each left scale
 * number and one behind the window's words ("5 min"), in the theme's track
 * tone. A tab follows its word: it draws while that word draws, where that
 * word starts this frame, as wide as the widest word its slot holds, so no
 * value, stale source or window moves or resizes it, and a reading gone
 * leaves no tab standing with no word on it. Nothing else changes: every
 * other look draws integration's bytes, and on these four looks the frame
 * without its tabs draws integration's bytes too, so no word and no line
 * moved. test/golden/strip-word-tabs.json holds those hashes, written from
 * integration 0fc047a8 before the tabs existed with
 * STRIP_TABS_GOLDEN_WRITE=1, and again on 2026-11-04 for the 16 Lanes
 * scenes, when a lane with Scale and grid off asks for six ticks, and for 88
 * scenes the same day, when machine words left the strip (Trend and Envelope
 * of two, the owner's strip, Group's foot, Ambient's mark), and for the 8
 * Tiles scenes the same day, when a core column's words changed to a number
 * on every tile and its values on demand, and twice for the 8 Large values
 * only scenes the same day, when a first reading stopped taking the accent and
 * when the readings spread across the pane; never regenerate it to make a
 * change pass.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import sharp from "sharp";

import { ambientFixture, fixtureCase, groupFixture, makeView, withScreens, type FixtureCase, type PaneExtras } from "../scripts/lib/strip-fixtures";
import { threadLabels, tilesFixture, tilesSamples } from "../scripts/lib/tiles-fixtures";
import type { CellsPrim, Prim } from "../src/strip/prims";
import { historyWidthFor, renderLogical, textInkBox, WORD_TAB, type LogicalScene, type PaneScaleOut, type StripSceneInput, type StripSeriesInput } from "../src/strip/scene";
import { sliceScene, SLICE_PAYLOAD_LIMIT, sliceStrip, svgBytes } from "../src/strip/slicer";
import type { StripStyle } from "../src/strip/settings";
import { ART_PIECE_LIMIT, ART_LOOKS } from "../src/ui/deck-art";
import { DIAL_BACKGROUNDS, type DialBackground } from "../src/ui/dial-background";
import { setFaceFont } from "../src/ui/face-font";
import { estimateKeyTextWidth } from "../src/ui/format";

const GOLDEN = new URL("./golden/strip-word-tabs.json", import.meta.url);
const SEE_THROUGH: readonly DialBackground[] = ["glass", "tint", "outline", "clear"];
const OTHER_LOOKS: readonly DialBackground[] = DIAL_BACKGROUNDS.filter((b) => !SEE_THROUGH.includes(b));
const SLICE_W = 200;
const WINDOW_MS = 300_000;

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

function isTab(p: Prim, track: string): p is CellsPrim {
	return p.k === "cells" && p.layer === "base" && p.round !== undefined && p.paint === `fill="${track}"`;
}

function tabsOf(scene: LogicalScene, track: string): Box[] {
	const out: Box[] = [];
	for (const p of scene.prims) {
		if (!isTab(p, track)) continue;
		for (let i = 0; i + 3 < p.rects.length; i += 4) out.push({ x: p.rects[i] as number, y: p.rects[i + 1] as number, w: p.rects[i + 2] as number, h: p.rects[i + 3] as number });
	}
	return out;
}

type Ink = { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };

/** The rows' words of a frame, with their ink. */
function rowWords(scene: LogicalScene): { text: string; size: number; ink: Ink }[] {
	return scene.prims.flatMap((p) => (p.k === "text" && p.layer === "rows" ? [{ text: p.text, size: p.size, ink: textInkBox(p) }] : []));
}

const isBadge = (text: string): boolean => text === "LIVE" || text.startsWith("PAUSED");
const meets = (t: Box, i: Ink): boolean => i.x0 < t.x + t.w && t.x < i.x1 && i.y0 < t.y + t.h && t.y < i.y1;
const startsOn = (t: Box, i: Ink): boolean => t.x <= i.x0 && i.x0 <= t.x + t.w && t.y <= i.y0 + 1 && i.y1 - 1 <= t.y + t.h;
const holds = (t: Box, i: Ink): boolean => startsOn(t, i) && i.x1 <= t.x + t.w;

/** What every frame owes: a word starts on every tab, a badge never meets
 * one, and the window's tab has its whole window word at the row's size. */
function assertTabsCarryWords(scene: LogicalScene, track: string, id: string): void {
	const words = rowWords(scene);
	for (const t of tabsOf(scene, track)) {
		const on = words.filter((w) => !isBadge(w.text) && startsOn(t, w.ink));
		assert.ok(on.length > 0, `${id}: a blank tab ${JSON.stringify(t)} among ${JSON.stringify(words.map((w) => w.text))}`);
		for (const w of on) if (w.size !== 11) assert.ok(w.size === 16 && /^(1|5|15) min/.test(w.text), `${id}: "${w.text}" at ${w.size} px on the window's tab`);
		for (const w of words) if (isBadge(w.text)) assert.ok(!meets(t, w.ink), `${id}: ${w.text} meets ${JSON.stringify(t)}`);
	}
}

/** Every scale end of a pane at the strip's left edge sits whole on a tab. */
function assertEndsOnTabs(scene: LogicalScene, track: string, count: number, id: string): void {
	const tabs = tabsOf(scene, track);
	const ends = rowWords(scene).filter((w) => w.size === 11 && !isBadge(w.text) && w.ink.x0 < 12 && !w.text.includes(" to "));
	assert.equal(ends.length, count, `${id}: ${JSON.stringify(ends.map((w) => w.text))}`);
	for (const e of ends) assert.ok(tabs.some((t) => holds(t, e.ink)), `${id}: ${e.text} ${JSON.stringify(e.ink)} on ${JSON.stringify(tabs)}`);
}

/** The window's words and the tab they start on, where they start this frame. */
function timeTabOf(scene: LogicalScene, track: string): { word: Ink; tab: Box | undefined } {
	const word = rowWords(scene).find((w) => /^(1|5|15) min/.test(w.text));
	assert.ok(word !== undefined, "the window's words");
	return { word: word.ink, tab: tabsOf(scene, track).find((t) => startsOn(t, word.ink)) };
}

/** The readings at these places gone from HWiNFO's list. */
function goneAt(input: StripSceneInput, ...at: readonly number[]): StripSceneInput {
	return { ...input, panes: input.panes.map((p) => ({ ...p, series: p.series.map((s, i) => (at.includes(i) ? { ...s, state: "missing" as const, current: undefined } : s)) })) };
}

function compare(background: DialBackground, series: readonly string[]): FixtureCase {
	return fixtureCase({ styles: ["compare"], layout: "whole", encoders: 6, background, accent: false, extras: [{ series }] });
}

/** The owner's strip: + XL, Whole, six screens, two readings of one unit
 * on Trend, 5 min, no min and max line. */
function ownerShape(background: DialBackground, theme = "graphite"): FixtureCase {
	const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background, accent: false, theme, window: "5m", extras: [{ series: ["cpu", "gpu"] }] });
	const [a, b] = c.input.config.panes;
	const plain: FixtureCase = { id: `owner-${background}-${theme}`, input: { ...c.input, config: { ...c.input.config, panes: [{ ...a, overlays: { ...a.overlays, minmax: false } }, b] } } };
	return withScreens(plain, { count: 6, at: 0 });
}

function trend(background: DialBackground, extras: PaneExtras = { series: ["cpu"] }, layout: "whole" | "split" = "whole", encoders: 4 | 6 = 6): FixtureCase {
	return fixtureCase({ styles: ["trend", "trend"], layout, encoders, background, accent: false, extras: [extras, extras] });
}

function tiles(background: DialBackground): FixtureCase {
	return { id: `tiles-${background}`, input: tilesFixture({ labels: threadLabels(16), samples: tilesSamples(32, () => 50), encoders: 6, background }).input };
}

/** The readings at `value` (window fraction to native value). */
function atValues(input: StripSceneInput, value: (f: number) => number, current: number, patch: Partial<StripSeriesInput> = {}): StripSceneInput {
	return {
		...input,
		panes: input.panes.map((p, i) => ({
			...p,
			series: p.series.map((s) => ({ ...s, current, history: makeView({ windowMs: WINDOW_MS, widthPx: historyWidthFor(input.config, input.encoders, i, 2), unit: s.unit, value }), ...patch }))
		}))
	};
}

/** Frames in order, each given the scales and widths the frame before it
 * came to, as the runtime hands them over (controller.ts). */
function runFrames(frames: readonly StripSceneInput[]): { scene: LogicalScene; tabs: Box[] }[] {
	let held: readonly (PaneScaleOut | null)[] = [null, null];
	let at = 1000;
	return frames.map((frame) => {
		const panes = frame.panes.map((p, i) => {
			const h = held[i];
			return { ...p, scale: { ...(h === null || h === undefined ? {} : { prev: h.held, slots: h.slots }), at } };
		});
		const { scene } = sliceStrip({ ...frame, panes });
		held = scene.scales;
		at += 2000;
		return { scene, tabs: tabsOf(scene, frame.palette.track) };
	});
}

/** Every scene the proof covers: each look, each style, both decks, the
 * panes that hold other words, and the owner's own strip. */
function goldenCases(): { id: string; c: FixtureCase; font: "tahoma" | "segoe-ui" }[] {
	const out: { id: string; c: FixtureCase; font: "tahoma" | "segoe-ui" }[] = [];
	const styles: readonly StripStyle[] = ["trend", "area", "compare", "lanes", "heat", "meters", "events"];
	for (const background of DIAL_BACKGROUNDS) {
		const add = (c: FixtureCase, id: string, font: "tahoma" | "segoe-ui" = "tahoma"): void => void out.push({ id: `${background}-${id}`, c, font });
		add(ownerShape(background), "owner");
		add(ownerShape(background, "ember"), "owner-ember");
		add(ownerShape(background), "owner-segoe", "segoe-ui");
		for (const style of styles) {
			add(fixtureCase({ styles: [style], layout: "whole", encoders: 6, background, accent: false }), `${style}-whole-xl`);
			add(fixtureCase({ styles: [style, style], layout: "split", encoders: 4, background, accent: false }), `${style}-split-plus`);
		}
		add(fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background, accent: true, paused: true }), "trend-paused-accent");
		add(fixtureCase({ styles: ["trend", "trend"], layout: "split", encoders: 6, background, accent: false, present: [true, true, false, true, true, false] }), "trend-absent-slots");
		add(fixtureCase({ styles: ["compare"], layout: "whole", encoders: 6, background, accent: false, extras: [{ series: ["cpu", "power", "fan"] }] }), "compare-three-units");
		add(trend(background, { series: ["cpu"], axes: true }), "trend-scale-and-grid");
		add(trend(background, { series: ["cpu"], readout: "left" }), "trend-readout-left");
		add(trend(background, { series: ["cpu"], readout: "only" }), "trend-readout-only");
		add(groupFixture({ n: 16, kind: "temp", view: "auto", encoders: 6, background }), "group-auto");
		add(tiles(background), "group-tiles");
		add(ambientFixture({ n: 24, kind: "mixed", encoders: 6, background }), "ambient");
	}
	return out;
}

/** A frame's every byte, without its tabs and without what they hold. */
function hashWithoutTabs(c: FixtureCase): string {
	const r = sliceStrip(c.input);
	const bare: LogicalScene = { ...r.scene, prims: r.scene.prims.filter((p) => !isTab(p, c.input.palette.track)) };
	const scales = bare.scales.map((s) => (s === null ? null : { held: s.held, slots: Object.fromEntries(Object.entries(s.slots).filter(([k]) => !k.startsWith("tab:"))) }));
	return createHash("sha256")
		.update([renderLogical(bare), ...bare.present.map((here, column) => (here ? sliceScene(bare, column) : "(absent)")), JSON.stringify(scales), String(r.bucketPx)].join("\n"))
		.digest("hex");
}

function hashes(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const { id, c, font } of goldenCases()) {
		setFaceFont(font);
		out[id] = hashWithoutTabs(c);
	}
	setFaceFont("tahoma");
	return out;
}

describe("strip word tabs: nothing else changes", () => {
	const now = hashes();
	if (process.env.STRIP_TABS_GOLDEN_WRITE === "1") writeFileSync(GOLDEN, `${JSON.stringify(now, null, "\t")}\n`);
	const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;

	it("covers every look: the see-through four, Theme and the deck art, Nebula among them", () => {
		assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
		for (const look of DIAL_BACKGROUNDS) assert.ok(Object.keys(golden).some((id) => id.startsWith(`${look}-`)), look);
		assert.ok(ART_LOOKS.includes("nebula"));
		assert.ok(Object.keys(golden).length >= 200, `${Object.keys(golden).length} scenes`);
	});

	it("Nebula, the owner's look, draws integration's bytes", () => {
		const changed = Object.keys(golden).filter((id) => id.startsWith("nebula-") && now[id] !== golden[id]);
		assert.deepEqual(changed, []);
	});

	it("Theme and the other art looks draw integration's bytes", () => {
		const changed = Object.keys(golden).filter((id) => OTHER_LOOKS.some((look) => id.startsWith(`${look}-`)) && now[id] !== golden[id]);
		assert.deepEqual(changed, []);
	});

	it("a see-through frame without its tabs is integration's: no word, no line, no bucket moved", () => {
		const changed = Object.keys(golden).filter((id) => SEE_THROUGH.some((look) => id.startsWith(`${look}-`)) && now[id] !== golden[id]);
		assert.deepEqual(changed, []);
	});

	it("no look but the see-through four draws a tab, nor keeps a width for one", () => {
		for (const { c, id } of goldenCases()) {
			if (SEE_THROUGH.includes(c.input.config.background as DialBackground)) continue;
			const { scene } = sliceStrip(c.input);
			assert.deepEqual(tabsOf(scene, c.input.palette.track), [], id);
			for (const s of scene.scales) assert.deepEqual(Object.keys(s?.slots ?? {}).filter((k) => k.startsWith("tab:")), [], id);
		}
	});
});

describe("strip word tabs: where they stand", () => {
	for (const background of SEE_THROUGH) {
		it(`${background}: one behind each scale end and one behind the window's words, each round its word's ink`, () => {
			const c = ownerShape(background);
			const { scene } = sliceStrip(c.input);
			const tabs = tabsOf(scene, c.input.palette.track);
			assert.equal(tabs.length, 3, JSON.stringify(tabs));
			const words = scene.prims.filter((p) => p.k === "text" && p.layer === "rows");
			const hi = words.find((p) => p.k === "text" && p.size === 11 && p.y < 50);
			const lo = words.find((p) => p.k === "text" && p.size === 11 && p.y > 50);
			const time = words.find((p) => p.k === "text" && p.text.startsWith("5 min"));
			for (const word of [hi, lo, time]) {
				assert.ok(word !== undefined && word.k === "text");
				const ink = textInkBox(word);
				assert.ok(
					tabs.some((t) => t.x <= ink.x0 && ink.x1 <= t.x + t.w && t.y <= ink.y0 + 1 && ink.y1 - 1 <= t.y + t.h),
					`${word.text} ${JSON.stringify(ink)} on ${JSON.stringify(tabs)}`
				);
			}
		});

		it(`${background}: LIVE and PAUSED beside a line never stand on a tab`, () => {
			for (const c of [ownerShape(background), fixtureCase({ styles: ["trend", "compare"], layout: "split", encoders: 4, background, accent: false, paused: true })]) {
				const { scene } = sliceStrip(c.input);
				const tabs = tabsOf(scene, c.input.palette.track);
				assert.ok(tabs.length > 0, c.id);
				for (const p of scene.prims) {
					if (p.k !== "text" || !/^(LIVE|PAUSED)/.test(p.text)) continue;
					const ink = textInkBox(p);
					for (const t of tabs) assert.ok(ink.x1 <= t.x || t.x + t.w <= ink.x0 || ink.y1 <= t.y || t.y + t.h <= ink.y0, `${c.id}: ${p.text} meets ${JSON.stringify(t)}`);
				}
			}
		});

		it(`${background}: a tab stays off the Strip Screens line and draws under every line and word, over the panel`, () => {
			const c = ownerShape(background);
			const { scene, slices } = sliceStrip(c.input);
			for (const t of tabsOf(scene, c.input.palette.track)) assert.ok(t.y >= 4, `screens line rows 0 to 3: ${JSON.stringify(t)}`);
			const svg = slices[0] as string;
			const tab = svg.search(new RegExp(`<path d="[^"]*q[^"]*" fill="${c.input.palette.track}"/>`));
			assert.ok(tab > 0, "the first slice carries the tabs");
			const line = svg.search(/stroke-linejoin="round" stroke-linecap="round"/);
			const word = svg.indexOf("<text");
			assert.ok(line > tab, "the line draws after its tabs");
			assert.ok(word > tab, "the words draw after their tabs");
			const panel = svg.search(/<rect[^>]*fill="url\(#[pt]\)"/);
			if (background === "glass" || background === "tint") assert.ok(panel >= 0 && panel < tab, "the panel draws before the tabs");
		});
	}

	it("the tabs take the theme's track tone, on every theme, with no paint definition of their own", () => {
		for (const theme of ["graphite", "ember", "paper"]) {
			const c = ownerShape("clear", theme);
			const { scene } = sliceStrip(c.input);
			assert.ok(
				scene.prims.some((p) => isTab(p, c.input.palette.track)),
				theme
			);
			assert.ok(!scene.paints.includes(c.input.palette.track), "a plain fill");
		}
	});

	it("a split strip's second pane takes its own tabs, inside its own slots", () => {
		const c = trend("clear", { series: ["cpu"] }, "split", 6);
		const tabs = tabsOf(sliceStrip(c.input).scene, c.input.palette.track);
		assert.equal(tabs.length, 6, JSON.stringify(tabs));
		assert.equal(tabs.filter((t) => t.x < 600).length, 3);
		assert.equal(tabs.filter((t) => t.x >= 600).length, 3);
	});

	it("every unit's band takes tabs behind both its ends", () => {
		const c = fixtureCase({ styles: ["compare"], layout: "whole", encoders: 6, background: "clear", accent: false, extras: [{ series: ["cpu", "power"] }] });
		assert.equal(tabsOf(sliceStrip(c.input).scene, c.input.palette.track).length, 5);
	});

	it("Lanes takes one behind its window's words; its scale stays in the lanes' headers", () => {
		const c = fixtureCase({ styles: ["lanes"], layout: "whole", encoders: 6, background: "clear", accent: false });
		assert.equal(tabsOf(sliceStrip(c.input).scene, c.input.palette.track).length, 1);
	});

	it("no tab where cells or meters would lie under it, on Scale and grid's number column, or on a pane with no graph", () => {
		const none: FixtureCase[] = [
			...(["heat", "meters", "events"] as const).map((style) => fixtureCase({ styles: [style], layout: "whole", encoders: 6, background: "clear", accent: false })),
			groupFixture({ n: 16, kind: "temp", view: "rows", encoders: 6, background: "clear" }),
			tiles("clear"),
			ambientFixture({ n: 24, kind: "mixed", encoders: 6, background: "clear" }),
			trend("clear", { series: ["cpu"], axes: true }),
			trend("clear", { series: ["cpu"], readout: "only" })
		];
		for (const c of none) assert.deepEqual(tabsOf(sliceStrip(c.input).scene, c.input.palette.track), [], c.id);
	});

	it("no tab behind the window's words when the pane does not print them", () => {
		const c = trend("clear");
		const [a, b] = c.input.config.panes;
		const off: StripSceneInput = { ...c.input, config: { ...c.input.config, panes: [{ ...a, overlays: { ...a.overlays, time: false, minmax: false } }, b] } };
		assert.equal(tabsOf(sliceStrip(off).scene, c.input.palette.track).length, 2);
	});
});

describe("strip word tabs: always on", () => {
	/** Frames a value sweep, the states a reading keeps its words through, a
	 * pause, a screen's name and a turned window run through. */
	function sweep(input: StripSceneInput): StripSceneInput[] {
		const flat = (v: number): StripSceneInput => atValues(input, () => v, v);
		const busy = (v: number): StripSceneInput => atValues(input, (f) => v + 9 * Math.sin(f * 900), v);
		const state = (patch: Partial<StripSeriesInput>): StripSceneInput => ({ ...input, panes: input.panes.map((p) => ({ ...p, series: p.series.map((s) => ({ ...s, ...patch })) })) });
		const each = (patch: Partial<StripSceneInput["panes"][number]>): StripSceneInput => ({ ...input, panes: input.panes.map((p) => ({ ...p, ...patch })) });
		const windowed = (window: "1m" | "15m"): StripSceneInput => ({ ...input, config: { ...input.config, window } });
		return [
			input,
			flat(33.9),
			busy(36),
			flat(9.5),
			flat(99.9),
			flat(100.1),
			flat(-20),
			flat(36),
			state({ state: "stale" }),
			state({ state: "unavailable", current: undefined }),
			state({ current: Number.NaN }),
			flat(36),
			each({ view: { mode: "paused", label: "14:02:51", agoMs: 60_000 } }),
			each({ screenLabel: { name: "CPU and GPU temperatures", place: "2 of 6" } }),
			windowed("1m"),
			windowed("15m"),
			input
		];
	}

	for (const background of SEE_THROUGH) {
		it(`${background}: no value, stale source, pause, screen name or window moves, resizes or takes away a tab`, () => {
			for (const c of [ownerShape(background), trend(background), trend(background, { series: ["load"] }), trend(background, { series: ["cpu"], readout: "left" }), trend(background, { series: ["power"] }, "split", 4)]) {
				const frames = runFrames(sweep(c.input));
				const first = frames[0]?.tabs ?? [];
				assert.ok(first.length > 0, c.id);
				frames.forEach((f, i) => assert.deepEqual(f.tabs, first, `${c.id}: frame ${i}`));
			}
		});
	}

	it("a fan that starts at 0 RPM and spins up keeps its ends' tabs, and the window's tab moves only with its word, once, as the column grows", () => {
		const c = trend("clear", { series: ["fan"] });
		const track = c.input.palette.track;
		const frames = runFrames([atValues(c.input, () => 0, 0), atValues(c.input, () => 2800, 2800), atValues(c.input, () => 12_000, 12_000), atValues(c.input, () => 300, 300), atValues(c.input, () => 0, 0)]);
		const places = new Set<number>();
		for (const f of frames) {
			assert.equal(f.tabs.length, 3);
			assert.deepEqual(f.tabs.slice(0, 2), frames[0]?.tabs.slice(0, 2));
			assertTabsCarryWords(f.scene, track, "fan");
			const { word, tab } = timeTabOf(f.scene, track);
			assert.ok(tab !== undefined, JSON.stringify(word));
			const margin = word.x0 - tab.x;
			assert.ok(margin >= WORD_TAB.pad - 1 && margin <= WORD_TAB.pad + 3, `the word ${margin} px into its tab`);
			places.add(tab.x);
		}
		assert.ok(places.size <= 2, `the window's tab stood at ${[...places].join(", ")}`);
		assert.deepEqual(frames.at(-1)?.tabs, frames.at(-2)?.tabs, "it stays once the column has grown");
	});

	it("a tab's size is its slot's, not its word's: two scales in one slot draw one tab", () => {
		const c = trend("clear");
		const narrow = sliceStrip(atValues(c.input, () => 36, 36));
		const wide = sliceStrip(atValues(c.input, () => 96, 96));
		const widths = (r: ReturnType<typeof sliceStrip>): number[] => tabsOf(r.scene, c.input.palette.track).map((t) => t.w);
		assert.equal(widths(narrow).length, 3);
		assert.deepEqual(widths(narrow), widths(wide));
	});

	it("the window's tab is as wide as its widest words, on 1, 5 and 15 min alike", () => {
		const widths = (["1m", "5m", "15m"] as const).map((window) => {
			const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "clear", accent: false, window, extras: [{ series: ["cpu"] }] });
			const tabs = tabsOf(sliceStrip(c.input).scene, c.input.palette.track);
			return tabs.at(-1)?.w;
		});
		assert.ok(widths[0] !== undefined);
		assert.deepEqual(widths, [widths[0], widths[0], widths[0]]);
	});

	it("before a pane's first scale it has no number to stand behind: the window's words have their tab, and the ends' come with that scale and then stay", () => {
		const c = trend("clear");
		const none: StripSceneInput = { ...c.input, panes: c.input.panes.map((p) => ({ ...p, series: p.series.map((s) => ({ ...s, state: "unavailable" as const, current: undefined, history: undefined, unit: "" })) })) };
		const frames = runFrames([none, c.input, atValues(c.input, () => 80, 80)]);
		assert.equal(frames[0]?.tabs.length, 1);
		assertTabsCarryWords(frames[0]?.scene as LogicalScene, c.input.palette.track, "no scale yet");
		assert.equal(frames[1]?.tabs.length, 3);
		assert.deepEqual(frames[2]?.tabs, frames[1]?.tabs);
	});

	it("a dial leaving the pane's first slot carries the tabs with the pane's left edge", () => {
		const c = trend("clear");
		const left: StripSceneInput = { ...c.input, present: [false, true, true, true, true, true] };
		const frames = runFrames([c.input, left]);
		const moved = (frames[0]?.tabs ?? []).map((t) => ({ ...t, x: t.x + SLICE_W }));
		assert.equal(moved.length, 3);
		assert.deepEqual(frames[1]?.tabs, moved);
	});
});

describe("strip word tabs: a reading gone", () => {
	for (const background of SEE_THROUGH) {
		it(`${background}: a second unit's reading gone restacks the tabs with the words, none blank, and they come back as they were`, () => {
			const c = compare(background, ["cpu", "power"]);
			const track = c.input.palette.track;
			const gone = goneAt(c.input, 1);
			const frames = runFrames([c.input, gone, gone, c.input]);
			assert.equal(frames[0]?.tabs.length, 5);
			assert.equal(frames[1]?.tabs.length, 3);
			assert.deepEqual(frames[2]?.tabs, frames[1]?.tabs, "while it stays gone");
			assert.deepEqual(frames[3]?.tabs, frames[0]?.tabs, "and back");
			frames.forEach((f, i) => {
				assertTabsCarryWords(f.scene, track, `frame ${i}`);
				assertEndsOnTabs(f.scene, track, i === 1 || i === 2 ? 2 : 4, `frame ${i}`);
			});
		});

		it(`${background}: with no reading left the window's tab goes with its word to the pane's edge, and comes back with it`, () => {
			for (const c of [trend(background), compare(background, ["cpu", "power"])]) {
				const track = c.input.palette.track;
				const gone = goneAt(c.input, 0, 1);
				const frames = runFrames([c.input, gone, gone, c.input]);
				for (const i of [1, 2]) {
					assert.equal(frames[i]?.tabs.length, 1, c.id);
					assertTabsCarryWords(frames[i]?.scene as LogicalScene, track, `${c.id}: frame ${i}`);
					const { word, tab } = timeTabOf(frames[i]?.scene as LogicalScene, track);
					assert.ok(word.x0 < 12, `the word at ${word.x0}`);
					assert.ok(tab !== undefined && holds(tab, word), `${JSON.stringify(word)} on ${JSON.stringify(tab)}`);
				}
				assert.deepEqual(frames[3]?.tabs, frames[0]?.tabs, c.id);
			}
		});
	}

	it("three units: any one gone leaves two bands' tabs on their words, each unit keeping its own widths", () => {
		const c = compare("clear", ["cpu", "power", "fan"]);
		const track = c.input.palette.track;
		const live = runFrames([c.input])[0]?.tabs ?? [];
		assert.equal(live.length, 7);
		const widths = (from: readonly Box[]): number[] => from.map((t) => t.w);
		for (const [at, kept] of [
			[0, [2, 3, 4, 5, 6]],
			[1, [0, 1, 4, 5, 6]],
			[2, [0, 1, 2, 3, 6]]
		] as const) {
			const frames = runFrames([c.input, goneAt(c.input, at), c.input]);
			assert.deepEqual(widths(frames[1]?.tabs ?? []), widths(kept.map((k) => live[k] as Box)), `reading ${at} gone`);
			assertTabsCarryWords(frames[1]?.scene as LogicalScene, track, `reading ${at} gone`);
			assertEndsOnTabs(frames[1]?.scene as LogicalScene, track, 4, `reading ${at} gone`);
			assert.deepEqual(frames[2]?.tabs, live, `reading ${at} back`);
		}
	});

	it("a setup that first draws with a reading already gone stacks the tabs on the words' bands", () => {
		const c = compare("clear", ["cpu", "power"]);
		const { scene } = sliceStrip(goneAt(c.input, 1));
		assert.equal(tabsOf(scene, c.input.palette.track).length, 3);
		assertTabsCarryWords(scene, c.input.palette.track, "first frame");
		assertEndsOnTabs(scene, c.input.palette.track, 2, "first frame");
	});

	it("a reading whose history is gone too leaves no end tab, and its window's tab stays on its word", () => {
		const c = trend("clear");
		const track = c.input.palette.track;
		const empty: StripSceneInput = { ...c.input, panes: c.input.panes.map((p) => ({ ...p, series: p.series.map((s) => ({ ...s, state: "unavailable" as const, current: undefined, history: undefined })) })) };
		const frames = runFrames([c.input, empty, c.input]);
		assert.equal(frames[1]?.tabs.length, 1);
		assertTabsCarryWords(frames[1]?.scene as LogicalScene, track, "empty");
		assert.deepEqual(frames[2]?.tabs, frames[0]?.tabs);
	});
});

describe("strip word tabs: beside the badge", () => {
	/** The panes the window's tab cannot clear PAUSED on: graphs of one slot. */
	function narrow(background: DialBackground, paused: boolean): { c: FixtureCase; tabs: number }[] {
		const one = [true, false, false, false, false, false];
		const base = { background, accent: false, paused } as const;
		return [
			{ c: fixtureCase({ ...base, styles: ["trend", "trend"], layout: "split", encoders: 4, extras: [{ series: ["fan"], readout: "left" }, { series: ["cpu"], readout: "left" }] }), tabs: 4 },
			{ c: fixtureCase({ ...base, styles: ["trend"], layout: "whole", encoders: 6, present: one, extras: [{ series: ["cpu"] }] }), tabs: 2 },
			{ c: fixtureCase({ ...base, styles: ["trend"], layout: "whole", encoders: 6, present: one, extras: [{ series: ["fan"] }] }), tabs: 2 },
			{ c: fixtureCase({ ...base, styles: ["compare"], layout: "whole", encoders: 6, window: "15m", present: one, extras: [{ series: ["fan", "power", "load", "cpu"] }] }), tabs: 0 }
		];
	}

	for (const background of SEE_THROUGH) {
		it(`${background}: a graph of one slot takes no window's tab, live or paused, so a pause changes no tab and none lies under a badge`, () => {
			const live = narrow(background, false);
			const paused = narrow(background, true);
			live.forEach(({ c, tabs }, i) => {
				const held = paused[i]?.c as FixtureCase;
				const track = c.input.palette.track;
				const drawn = tabsOf(sliceStrip(c.input).scene, track);
				assert.equal(drawn.length, tabs, `${c.id}: ${JSON.stringify(drawn)}`);
				assert.deepEqual(tabsOf(sliceStrip(held.input).scene, track), drawn, held.id);
				assertTabsCarryWords(sliceStrip(c.input).scene, track, c.id);
				assertTabsCarryWords(sliceStrip(held.input).scene, track, held.id);
				const widest: StripSceneInput = { ...held.input, panes: held.input.panes.map((p) => ({ ...p, view: { mode: "paused", label: "44:44:44", agoMs: 60_000 } })) };
				assert.deepEqual(tabsOf(sliceStrip(widest).scene, track), drawn, `${held.id}, widest time`);
				assertTabsCarryWords(sliceStrip(widest).scene, track, `${held.id}, widest time`);
			});
		});
	}

	it("a graph of one slot keeps that choice while its reading is gone", () => {
		const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "clear", accent: false, present: [true, false, false, false, false, false], extras: [{ series: ["cpu"] }] });
		const frames = runFrames([c.input, goneAt(c.input, 0), c.input]);
		assert.equal(frames[0]?.tabs.length, 2);
		assert.deepEqual(frames[1]?.tabs, []);
		assert.deepEqual(frames[2]?.tabs, frames[0]?.tabs);
	});

	it("PAUSED 44:44:44 is the widest time a badge can print, in both fonts", () => {
		for (const font of ["tahoma", "segoe-ui"] as const) {
			setFaceFont(font);
			const width = (text: string): number => estimateKeyTextWidth(text, 11, { fontWeight: 700 });
			const widest = Math.max(...[..."0123456789"].map((d) => width(`PAUSED ${d}${d}:${d}${d}:${d}${d}`)));
			assert.equal(width("PAUSED 44:44:44"), widest, font);
		}
		setFaceFont("tahoma");
	});

	it("a graph of two slots keeps its window's tab beside the widest badge", () => {
		const c = fixtureCase({ styles: ["trend", "trend"], layout: "split", encoders: 4, background: "clear", accent: false, paused: true, extras: [{ series: ["fan"] }, { series: ["cpu"] }] });
		const widest: StripSceneInput = { ...c.input, panes: c.input.panes.map((p) => ({ ...p, view: { mode: "paused", label: "44:44:44", agoMs: 60_000 } })) };
		const { scene } = sliceStrip(widest);
		assert.equal(tabsOf(scene, c.input.palette.track).length, 6);
		assertTabsCarryWords(scene, c.input.palette.track, c.id);
	});

	it("a conflict notice in the window's place takes the window's tab away while it shows, and a screen's name keeps it", () => {
		const c = trend("clear");
		const each = (patch: Partial<StripSceneInput["panes"][number]>): StripSceneInput => ({ ...c.input, panes: c.input.panes.map((p) => ({ ...p, ...patch })) });
		const frames = runFrames([c.input, each({ notice: "Pasted strip setup differs, see dial settings" }), c.input, each({ screenLabel: { name: "CPU", place: "2 of 6" } }), c.input]);
		assert.equal(frames[0]?.tabs.length, 3);
		assert.deepEqual(frames[1]?.tabs, frames[0]?.tabs.slice(0, 2), "the notice");
		assert.deepEqual(frames[2]?.tabs, frames[0]?.tabs, "the notice gone");
		assert.deepEqual(frames[3]?.tabs, frames[0]?.tabs, "the screen's name");
		assert.deepEqual(frames[4]?.tabs, frames[0]?.tabs, "the name gone");
	});

	it("across decks, layouts, dials present, windows, readouts and readings gone: a word on every tab, none under a badge, the window's tab only under its whole word", () => {
		let scenes = 0;
		let tabs = 0;
		for (const encoders of [4, 6] as const) {
			const first = (n: number): boolean[] => Array.from({ length: encoders }, (_, i) => i < n);
			for (const layout of ["whole", "split"] as const) {
				for (const present of [first(encoders), first(1), first(2), first(3)]) {
					for (const series of [["cpu"], ["fan"], ["power", "cpu"], ["fan", "power", "load"], ["fan", "power", "load", "cpu"]]) {
						for (const readout of [undefined, "left"] as const) {
							for (const window of ["1m", "15m"] as const) {
								const extras = { series, ...(readout === undefined ? {} : { readout }) };
								for (const paused of [false, true]) {
									const c = fixtureCase({ styles: ["compare", "compare"], layout, encoders, background: "clear", accent: false, window, paused, present, extras: [extras, extras] });
									for (const input of [c.input, goneAt(c.input, 0), goneAt(c.input, ...series.map((_, i) => i))]) {
										const { scene } = sliceStrip(input);
										assertTabsCarryWords(scene, input.palette.track, `${c.id} ${series.join("+")} ${String(readout)} ${present.filter(Boolean).length} dials`);
										scenes++;
										tabs += tabsOf(scene, input.palette.track).length;
									}
								}
							}
						}
					}
				}
			}
		}
		assert.ok(scenes > 1000 && tabs > 1000, `${scenes} scenes, ${tabs} tabs`);
	});
});

describe("strip word tabs: bytes and seams", () => {
	const cap = (background: DialBackground): number => ((ART_LOOKS as readonly string[]).includes(background) ? SLICE_PAYLOAD_LIMIT - ART_PIECE_LIMIT : SLICE_PAYLOAD_LIMIT);

	for (const background of SEE_THROUGH) {
		it(`${background}: the owner's strip adds under 200 B to its first slice, nothing to the rest, and stays under the cap`, () => {
			for (const theme of ["graphite", "ember"]) {
				const c = ownerShape(background, theme);
				const r = sliceStrip(c.input);
				const bare: LogicalScene = { ...r.scene, prims: r.scene.prims.filter((p) => !isTab(p, c.input.palette.track)) };
				const added = r.slices.map((svg, column) => svgBytes(svg as string) - svgBytes(sliceScene(bare, column)));
				assert.ok((added[0] as number) > 0 && (added[0] as number) < 200, `first slice +${added[0]} B`);
				assert.deepEqual(added.slice(1), [0, 0, 0, 0, 0]);
				assert.ok(r.maxBytes <= cap(background), `${r.maxBytes} B`);
				assert.equal(r.bucketPx, 2);
			}
		});
	}

	it("every see-through scene's slices stay under the cap, and no tab crosses a seam in any of them", () => {
		let checked = 0;
		for (const { c, id } of goldenCases()) {
			const background = c.input.config.background as DialBackground;
			if (!SEE_THROUGH.includes(background)) continue;
			const r = sliceStrip(c.input);
			assert.ok(r.maxBytes <= cap(background), `${id}: ${r.maxBytes} B`);
			for (const t of tabsOf(r.scene, c.input.palette.track)) {
				checked++;
				assert.equal(Math.floor(t.x / SLICE_W), Math.floor((t.x + t.w - 0.01) / SLICE_W), `${id}: ${JSON.stringify(t)}`);
				assert.notEqual(r.scene.present[Math.floor(t.x / SLICE_W)], false, `${id}: a tab in an absent slot`);
			}
		}
		assert.ok(checked > 100, `${checked} tabs`);
	});

	it("a tab placed across a seam still splits with no difference from the full frame", async () => {
		const c = ownerShape("clear");
		const { scene } = sliceStrip(c.input);
		const track = c.input.palette.track;
		const prim: Prim = { k: "cells", layer: "base", rects: [180, 40, 40, 18], paint: `fill="${track}"`, round: 2 };
		const moved: LogicalScene = { ...scene, prims: [...scene.prims.filter((p) => !isTab(p, track)), prim] };
		const reference = await sharp(Buffer.from(renderLogical(moved))).raw().toBuffer();
		const layers = moved.present.map((_, column) => ({ input: Buffer.from(sliceScene(moved, column)), left: column * SLICE_W, top: 0 }));
		const stitched = await sharp({ create: { width: 1200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).raw().toBuffer();
		const at = (buf: Buffer, x: number, y: number): number[] => [...buf.subarray((y * 1200 + x) * 4, (y * 1200 + x) * 4 + 4)];
		for (const y of [40, 41, 49, 56, 57]) for (const x of [196, 198, 199, 200, 201, 203]) assert.deepEqual(at(stitched, x, y), at(reference, x, y), `x ${x}, y ${y}`);
	});
});
