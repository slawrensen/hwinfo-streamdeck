/**
 * Issue #59 on the Strip Display (Stream Deck + and + XL): each reading's
 * own unit and decimals. The strip keeps its own map, readingFormats,
 * filed under each reading's saved key like a dial's, seeded once from the
 * creating dial and edited from the strip's own rows in the panel. Every
 * number a strip draws for a reading with a format follows it: values,
 * legends, min/max, readouts, band and limit labels, scale ends and ticks
 * (the Y scale prints in the fixed unit), Meters, Lanes, Compare,
 * Heat, Events and Group. A strip with no format draws byte for
 * byte what it drew.
 *
 * The readings are the issue's: two GPUs' "GPU Memory Available" in MB,
 * an RTX 4090 at 14,880 MB free and an RTX 3060 at 453 MB (then 3,020),
 * five minutes of history moving from 23,410 and 12,100 MB.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { makeView } from "../scripts/lib/strip-fixtures";
import { SensorType } from "../src/hwinfo/types";
import { applyStripEdit, type EditBase } from "../src/strip/edits";
import { endText, scaleTicks, scaleView, toView } from "../src/strip/scale";
import { buildStripScene, historyWidthFor, renderLogical, stripAlertColors, stripBandsFor, WINDOW_MS, type StripSceneInput, type StripSeriesInput } from "../src/strip/scene";
import { newStripConfig, stripConfigOf, stripConfigToJson, stripPaneOf, stripReadingKeysOf, stripSeedOf } from "../src/strip/settings";
import { setFaceFont } from "../src/ui/face-font";
import { loadThemes, resolvePalette } from "../src/ui/themes";

setFaceFont("tahoma");

/** A config's own formats (StripConfigV1.readingFormats). */
const formatsOf = (config: { readonly readingFormats?: unknown }): Record<string, unknown> | undefined => config.readingFormats as Record<string, unknown> | undefined;

const A = "a1:0:5";
const B = "a2:0:5";
const GB2 = { unit: "GB", decimals: "2" };
const GIB2 = { unit: "GiB", decimals: "2" };
const ENC = 6;
const themes = loadThemes();
const palette = resolvePalette(themes, "void", null, "normal");
const band = { key: B, warn: 2000, crit: 1000, below: true, unit: "MB" };
const PAIR = [
	{ key: A, name: "4090 free" },
	{ key: B, name: "3060 free" }
];

type Opts = { readonly formats?: unknown; readonly b?: number; readonly only?: "B"; readonly dataUnits?: "decimal" | "binary"; readonly rule?: boolean; readonly decimals?: string; readonly emptyHistory?: boolean };

/** One whole + XL strip of the two GPUs, as frame.ts builds its input. */
function scene(pane: Record<string, unknown>, opts: Opts = {}): { input: StripSceneInput; texts: string[]; svg: string } {
	const config = stripConfigOf({ layout: "whole", encoders: ENC, window: "5m", theme: "void", ...(opts.decimals === undefined ? {} : { decimals: opts.decimals }), ...(opts.formats === undefined ? {} : { readingFormats: opts.formats }), panes: [pane] });
	const windowMs = WINDOW_MS[config.window];
	const width = historyWidthFor(config, ENC, 0, 2);
	const ease = (f: number): number => (f < 0.15 ? 0 : f > 0.85 ? 1 : (1 - Math.cos(((f - 0.15) / 0.7) * Math.PI)) / 2);
	const move = (from: number, to: number) => (f: number) => (f >= 0.999 ? to : from + (to - from) * ease(f));
	const b = opts.b ?? 453;
	const view = (from: number, to: number) => {
		const v = makeView({ windowMs, widthPx: width, unit: "MB", type: SensorType.Other, value: move(from, to), ...(opts.emptyHistory === true ? { from: 1.01 } : {}) });
		// The store's view before its first sample: no segment, no unit.
		return opts.emptyHistory === true ? { ...v, unit: "" } : v;
	};
	const all: StripSeriesInput[] = [
		{ key: A, name: "4090 free", unit: "MB", state: "ok", history: view(23410, 14880), current: 14880 },
		{ key: B, name: "3060 free", unit: "MB", state: "ok", history: view(12100, b), current: b }
	];
	const series = opts.only === "B" ? [all[1] as StripSeriesInput] : all;
	const dataUnits = opts.dataUnits ?? "decimal";
	const measure = { fahrenheit: config.fahrenheit, decimals: config.decimals, dataUnits };
	const input: StripSceneInput = {
		config,
		encoders: ENC,
		palette,
		text: { mode: "theme", color: undefined, dimSecondary: false },
		alertColors: stripAlertColors(themes.alertValues, palette, config.background),
		dataUnits,
		panes: [
			{
				series,
				bands: stripBandsFor(config.panes[0], series, measure, formatsOf(config)),
				view: { mode: "live" },
				highlight: 1,
				...(opts.rule === true ? { group: { status: "ok" as const, title: "", unit: "MB", sameUnit: 2, otherUnits: 0, refused: 0, highlightKey: null } } : {})
			}
		]
	};
	const logical = buildStripScene(input);
	return { input, texts: logical.prims.filter((p) => p.k === "text").map((p) => (p as { text: string }).text), svg: renderLogical(logical) };
}

const FORMATS = { [A]: GB2, [B]: GB2 };
const trend = { style: "trend", series: PAIR, overlays: { minmax: true, axes: true }, bands: [band] };

/** Every number with a data unit attached or beside it, by unit. */
function byteUnits(texts: readonly string[]): string[] {
	const out: string[] = [];
	for (const t of texts) for (const m of t.matchAll(/\b(\d[\d.]*)\s?(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\b/g)) out.push(m[2] as string);
	for (const t of texts) if (/^(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/.test(t)) out.push(t);
	return out;
}

describe("the strip's own readingFormats: stored, seeded and edited", () => {
	it("parses entry by entry: valid units and decimals only, bounded keys, prototype names as own entries", () => {
		const raw = JSON.parse(`{"a": {"unit": "GB", "decimals": "2", "extra": 1}, "b": {"unit": "gb"}, "c": {"decimals": 2}, "d": "GB", "e": null, "": {"unit": "GB"}, "__proto__": {"unit": "GiB"}, "f": {"decimals": "auto"}}`);
		const config = stripConfigOf({ readingFormats: raw });
		const formats = formatsOf(config) as Record<string, unknown>;
		assert.deepEqual(Object.keys(formats).sort(), ["__proto__", "a", "f"].sort());
		assert.deepEqual(formats.a, { unit: "GB", decimals: "2" });
		assert.deepEqual(formats.f, { decimals: "auto" });
		assert.ok(Object.hasOwn(formats, "__proto__"));
		assert.deepEqual(Object.getOwnPropertyDescriptor(formats, "__proto__")?.value, { unit: "GiB" });
		assert.equal(formatsOf(stripConfigOf({ readingFormats: "GB" })), undefined);
		assert.equal(formatsOf(stripConfigOf({ readingFormats: {} })), undefined);
		assert.equal(formatsOf(stripConfigOf({ readingFormats: { ["x".repeat(257)]: GB2 } })), undefined, "a key longer than any strip reading key");
		const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, GB2]));
		assert.equal(Object.keys(formatsOf(stripConfigOf({ readingFormats: many })) ?? {}).length, 128);
	});

	it("writes its known form back, and a config without it as before", () => {
		const json = stripConfigToJson(stripConfigOf({ readingFormats: { [A]: GB2, [B]: { decimals: "1" } } }));
		assert.deepEqual(json.readingFormats, { [A]: GB2, [B]: { decimals: "1" } });
		assert.ok(!Object.hasOwn(stripConfigToJson(stripConfigOf({})), "readingFormats"));
		const again = stripConfigOf(JSON.parse(JSON.stringify(stripConfigToJson(stripConfigOf({ readingFormats: JSON.parse(`{"__proto__": {"unit": "GB"}}`) })))));
		assert.ok(Object.hasOwn(formatsOf(again) ?? {}, "__proto__"), "a prototype name survives a round trip");
	});

	it("a new strip starts with the creating dial's per-reading formats", () => {
		const seed = stripSeedOf({ readingKey: A, decimals: "1", readingFormats: { [A]: GB2, [B]: GIB2, junk: "GB" } });
		const config = newStripConfig("whole", 6, seed);
		assert.deepEqual(formatsOf(config), { [A]: GB2, [B]: GIB2 });
		assert.equal(formatsOf(newStripConfig("whole", 6, stripSeedOf({ readingKey: A }))), undefined);
	});

	it("one edit sets the whole map exactly; junk is refused; null or {} clears it", () => {
		const base: EditBase = { id: "0123456789abcdef0123456789abcdef", rev: 2, config: stripConfigOf({ layout: "whole", encoders: 6, panes: [{ style: "trend", series: PAIR }] }) };
		const set = applyStripEdit(base, 2, [{ op: "set", path: "readingFormats", value: FORMATS }]);
		assert.ok(set.ok);
		assert.deepEqual(formatsOf(set.copy.config), FORMATS);
		for (const bad of [{ [A]: { unit: "gb" } }, { [A]: { decimals: 2 } }, { [A]: { unit: "GB", other: 1 } }, { [A]: {} }, { [A]: "GB" }, { "": GB2 }, { ["x".repeat(257)]: GB2 }, [GB2], "GB", Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`k${i}`, GB2]))]) {
			assert.equal(applyStripEdit(base, 2, [{ op: "set", path: "readingFormats", value: bad }]).ok, false, JSON.stringify(bad).slice(0, 60));
		}
		const held = set.ok ? { ...base, rev: 3, config: set.copy.config } : base;
		for (const clear of [null, {}]) {
			const r = applyStripEdit(held, 3, [{ op: "set", path: "readingFormats", value: clear }]);
			assert.ok(r.ok && formatsOf(r.copy.config) === undefined, JSON.stringify(clear));
		}
	});

	it("names the strip's readings for the panel's rows: every screen's and pane's, then the rules' lists", () => {
		const config = stripConfigOf({
			layout: "split",
			encoders: 6,
			panes: [
				{ style: "trend", series: PAIR },
				{ style: "group", series: [], group: { from: "list", keys: [B, "c:0:1"], view: "auto" } }
			],
			screens: [{ style: "heat", series: [{ key: "d:0:1" }] }]
		});
		assert.deepEqual(stripReadingKeysOf(config), [A, B, "d:0:1", "c:0:1"]);
	});
});

describe("every number of a reading with a format follows it", () => {
	it("Trend: the legend, min/max, band labels and the scale ends, at GB with 2 decimals", () => {
		const { texts } = scene(trend, { formats: FORMATS });
		assert.ok(texts.includes("4090 free 14.88 GB") && texts.includes("3060 free") && texts.includes("0.45") && texts.includes("GB"), texts.join(" | "));
		assert.ok(texts.some((t) => t.includes("min 0.45GB · max 12.10GB")), texts.join(" | "));
		assert.ok(texts.includes("3060 free crit 1.00GB") && texts.includes("3060 free warn 2.00GB"), texts.join(" | "));
		assert.ok(!byteUnits(texts).includes("MB"), "no MB anywhere");
		// Today, with no format: the unit moves with the value.
		const plain = scene(trend).texts;
		assert.ok(plain.includes("453") && plain.includes("MB") && plain.some((t) => t.includes("min 453MB")), plain.join(" | "));
	});

	it("the Y scale prints in the fixed unit: its ends and ticks, and the tier it chose", () => {
		const mb = scene(trend, { formats: { [A]: { unit: "MB" }, [B]: { unit: "MB" } } }).texts;
		const ends = mb.filter((t) => /^\d+(\.\d+)?(MB|GB)$/.test(t));
		assert.ok(ends.length >= 2 && ends.every((t) => t.endsWith("MB")), ends.join(" | "));
		const gib = scene(trend, { formats: { [A]: GIB2, [B]: GIB2 } }).texts;
		const gibEnds = gib.filter((t) => /^\d+(\.\d+)?(GiB|GB|MiB)$/.test(t));
		assert.ok(gibEnds.length >= 2 && gibEnds.every((t) => t.endsWith("GiB")), gibEnds.join(" | "));
		assert.ok(gib.includes("4090 free 14.53 GiB") && gib.includes("0.44") && gib.includes("GiB"), gib.join(" | "));
	});

	it("a scale view in a fixed unit: one tier, HWiNFO's number in that unit", () => {
		const view = scaleView("MB", { fahrenheit: false, dataUnits: "decimal" }, "GB");
		assert.equal(toView(view, 12100), 12.1);
		const st = scaleTicks(view, { lo: 0, hi: 20000 }, 6);
		assert.ok(st !== null && endText(st.ticks.hi, st, true) === "20GB", st === null ? "no ticks" : endText(st.ticks.hi, st, true));
		const gib = scaleView("MB", { fahrenheit: false, dataUnits: "decimal" }, "GiB");
		assert.equal(toView(gib, 12100), 12100 / 1024);
	});

	it("a readout keeps its unit as the value moves (453 MB, then 3,020 MB)", () => {
		const pane = { style: "trend", readout: "only", series: [PAIR[1]] };
		const low = scene(pane, { only: "B", b: 453, formats: FORMATS }).texts;
		const high = scene(pane, { only: "B", b: 3020, formats: FORMATS }).texts;
		assert.ok(low.includes("0.45") && low.includes("GB") && !low.includes("MB"), low.join(" | "));
		assert.ok(high.includes("3.02") && high.includes("GB"), high.join(" | "));
		const plain = scene(pane, { only: "B", b: 453 }).texts;
		assert.ok(plain.includes("453") && plain.includes("MB"), plain.join(" | "));
	});

	it("Readout beside the graph, Compare and Lanes", () => {
		const left = scene({ style: "trend", readout: "left", series: PAIR, bands: [band] }, { formats: FORMATS }).texts;
		assert.ok(left.includes("14.88") && left.includes("0.45") && !byteUnits(left).includes("MB"), left.join(" | "));
		const compare = scene({ style: "compare", series: PAIR, bands: [band] }, { formats: FORMATS }).texts;
		assert.ok(compare.includes("4090 free 14.88 GB") && compare.includes("3060 free 0.45 GB"), compare.join(" | "));
		const lanes = scene({ style: "lanes", series: PAIR, overlays: { minmax: true, axes: true }, bands: [band] }, { formats: FORMATS }).texts;
		assert.ok(lanes.includes("14.88 GB") && lanes.includes("0.45 GB") && lanes.includes("0.45GB to 12.10GB") && lanes.includes("3060 free (crit 1.00GB)"), lanes.join(" | "));
		assert.ok(!byteUnits(lanes).includes("MB"), lanes.join(" | "));
	});

	it("Meters, Heat and Events", () => {
		const meters = scene({ style: "meters", series: PAIR, bands: [band] }, { formats: FORMATS }).texts;
		assert.ok(meters.includes("14.88") && meters.includes("0.45") && !meters.includes("MB") && meters.includes("crit 1.00GB") && meters.includes("warn 2.00GB"), meters.join(" | "));
		const heat = scene({ style: "heat", series: [PAIR[1]], bands: [band] }, { only: "B", formats: FORMATS }).texts;
		assert.ok(heat.includes("0.45") && heat.includes("GB") && heat.includes("3060 free crit 1.00GB · warn 2.00GB") && !heat.includes("MB"), heat.join(" | "));
		const events = scene({ style: "events", series: [PAIR[1]], bands: [band] }, { only: "B", formats: FORMATS }).texts;
		assert.ok(events.includes("0.45 GB") && events.some((t) => t.includes("2.00GB")), events.join(" | "));
	});

	it("Group (rows, now, lines): values, readouts, limits and scales", () => {
		const limits = { warn: 2000, crit: 1000, below: true, unit: "MB" };
		for (const view of ["rows", "now", "auto"]) {
			const texts = scene({ style: "group", series: [], group: { from: "list", keys: [A, B], view, limits } }, { rule: true, formats: FORMATS }).texts;
			assert.ok(!byteUnits(texts).includes("MB"), `${view}: ${texts.join(" | ")}`);
			assert.ok(texts.some((t) => /^(0\.45|14\.88)$/.test(t)), `${view}: ${texts.join(" | ")}`);
		}
		const now = scene({ style: "group", series: [], group: { from: "list", keys: [A, B], view: "now", limits } }, { rule: true, formats: FORMATS }).texts;
		assert.ok(now.includes("14.88") && now.includes("0.45"), now.join(" | "));
		const rows = scene({ style: "group", series: [], group: { from: "list", keys: [A, B], view: "rows", limits } }, { rule: true, formats: FORMATS }).texts;
		assert.ok(rows.includes("warn 2.00GB") && rows.includes("crit 1.00GB") && rows.some((t) => /^\d+GB$/.test(t)), rows.join(" | "));
		assert.ok(rows.includes("min of 2"), rows.join(" | "));
	});

	it("a format with decimals only keeps Auto's unit and takes its decimals; the strip's Decimals serve the rest", () => {
		const { texts } = scene(trend, { formats: { [B]: { decimals: "3" } } });
		assert.ok(texts.includes("453.000") && texts.includes("MB") && texts.includes("4090 free 14.9 GB"), texts.join(" | "));
		const strip2 = scene(trend, { decimals: "2", formats: { [B]: { unit: "GB" } } }).texts;
		assert.ok(strip2.includes("0.45") && strip2.includes("GB") && strip2.includes("4090 free 14.88 GB"), strip2.join(" | "));
	});

	it("under Binary a GiB format and the Auto text agree, as on keys", () => {
		const fixed = scene(trend, { formats: { [A]: GIB2, [B]: GIB2 }, dataUnits: "binary" }).texts;
		const auto = scene(trend, { decimals: "2", dataUnits: "binary" }).texts;
		assert.ok(fixed.includes("4090 free 14.53 GiB") && auto.includes("4090 free 14.53 GiB"), `${fixed.join(" | ")} // ${auto.join(" | ")}`);
	});
});

describe("no format: the strip draws byte for byte what it drew", () => {
	const panes: Record<string, unknown>[] = [
		trend,
		{ style: "trend", readout: "left", series: PAIR, bands: [band] },
		{ style: "lanes", series: PAIR, overlays: { minmax: true, axes: true }, bands: [band] },
		{ style: "meters", series: PAIR, bands: [band] },
		{ style: "compare", series: PAIR, bands: [band] }
	];
	for (const pane of panes) {
		it(`${String(pane.style)}${pane.readout === undefined ? "" : ` ${String(pane.readout)}`}: no map, an empty one, junk, or entries for other readings`, () => {
			const plain = scene(pane).svg;
			for (const formats of [{}, "GB", [GB2], { other: GB2 }, { [A]: { unit: "gb" } }, { [A]: { decimals: 2 } }]) {
				assert.equal(scene(pane, { formats }).svg, plain, JSON.stringify(formats));
			}
		});
	}
});

describe("a reading's unit before its history has a sample", () => {
	it("an empty history view (no segment yet, unit \"\") keeps the reading's own unit: 14.4 GB, never 14.4k", () => {
		const { texts } = scene({ style: "trend", series: PAIR }, { emptyHistory: true });
		assert.ok(texts.includes("4090 free 14.9 GB") && texts.includes("453") && texts.includes("MB"), texts.join(" | "));
		assert.ok(!texts.some((t) => /\d(\.\d)?k\b/.test(t)), texts.join(" | "));
	});

	it("its bands and limits are labelled in that unit too", () => {
		const series: StripSeriesInput[] = [{ key: B, name: "3060 free", unit: "MB", state: "ok", history: { ...makeView({ windowMs: 300_000, widthPx: 100, unit: "MB", value: () => 0, from: 1.01 }), unit: "" }, current: 453 }];
		const labels = stripBandsFor(stripPaneOf({ series: [{ key: B }], bands: [band] }), series, { fahrenheit: false, decimals: "auto", dataUnits: "decimal" }).map((x) => x.label);
		assert.deepEqual(labels, ["crit 1.00GB", "warn 2.00GB"]);
	});
});

describe("the alerts page says what a strip does with a reading's format", () => {
	it("docs/thresholds-alerts.md does not exempt strips: their band and limit labels follow the reading's unit", () => {
		const heat = scene({ style: "heat", series: [PAIR[1]], bands: [band] }, { only: "B", formats: FORMATS }).texts;
		assert.ok(heat.includes("3060 free crit 1.00GB · warn 2.00GB"), heat.join(" | "));
		const lanes = scene({ style: "lanes", series: PAIR, overlays: { minmax: true, axes: true }, bands: [band] }, { formats: FORMATS }).texts;
		assert.ok(lanes.includes("3060 free (crit 1.00GB)"), lanes.join(" | "));
		const markdown = fs.readFileSync(fileURLToPath(new URL("../docs/thresholds-alerts.md", import.meta.url)), "utf8");
		assert.match(markdown, /the strip's band labels show the limit in the reading's unit/, "the page says a strip's band labels follow the reading's unit");
		assert.doesNotMatch(markdown, /Strip displays are not covered/, "docs/thresholds-alerts.md says strips are not covered, but a strip's 1,000 MB limit reads crit 1.00GB in GB");
		assert.doesNotMatch(markdown, /band labels keep the strip's own \*\*Decimals\*\*/, "docs/thresholds-alerts.md says a strip's band labels keep the strip's Decimals");
	});
});
