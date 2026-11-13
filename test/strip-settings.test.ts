/**
 * Strip Display settings: the appended `stripGroup` field salvage-parses to
 * safe defaults, reads only exact values, never throws, and writes nothing.
 * An absent field is an independent dial exactly as before.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sortedJson } from "../src/sorted-json";
import { STRIP_GAP_MODES, stripGapModeOf } from "../src/strip/settings";
import {
	activePanes,
	DEFAULT_OVERLAYS,
	drawnSeries,
	EMPTY_PANE,
	MAX_SERIES,
	mintStripId,
	newStripConfig,
	paneWindowOf,
	SERIES_LIMITS,
	stripConfigOf,
	stripConfigToJson,
	stripGroupOf,
	stripGroupToJson,
	stripPaneOf,
	stripPaneToJson,
	stripSeedOf,
	withDefaultLooks
} from "../src/strip/settings";
import { DIAL_BACKGROUNDS } from "../src/ui/dial-background";

const ID = "0123456789abcdef0123456789abcdef";
const JUNK: unknown[] = [undefined, null, 0, 1, true, false, "", "x", [], ["whole"], {}, { v: 1 }, Number.NaN];

describe("Brief gaps settings", () => {
	it("reads exactly mark and gaps; anything else, connect included, is the default", () => {
		for (const raw of JUNK) assert.equal(stripGapModeOf(raw), undefined);
		assert.equal(stripGapModeOf("connect"), undefined);
		assert.deepEqual(STRIP_GAP_MODES, ["mark", "gaps"]);
		for (const mode of STRIP_GAP_MODES) {
			assert.equal(stripGapModeOf(mode), mode);
			assert.equal(stripConfigOf({ gapMode: mode }).gapMode, mode);
			assert.equal(stripConfigToJson(stripConfigOf({ gapMode: mode })).gapMode, mode);
		}
	});
	it("a strip with none writes none", () => {
		assert.equal(Object.hasOwn(stripConfigToJson(stripConfigOf({})), "gapMode"), false);
		assert.equal(Object.hasOwn(stripConfigOf({}), "gapMode"), false);
	});
	it("a value a newer version stored reads as Connect and survives an unrelated write", () => {
		const raw = { layout: "whole", gapMode: "future-mode", futureField: { kept: true } };
		const config = stripConfigOf(raw);
		assert.equal(config.gapMode, undefined);
		assert.equal(stripConfigToJson(config).gapMode, "future-mode");
		assert.deepEqual(stripConfigToJson(config).futureField, { kept: true });
	});
	it("a value on a pane means nothing", () => {
		assert.equal(Object.hasOwn(stripPaneOf({ gapMode: "mark" }), "gapMode"), false);
		assert.equal(stripConfigOf({ panes: [{ style: "trend", gapMode: "mark" }] }).gapMode, undefined);
	});
});

describe("stripGroupOf", () => {
	it("absent and every malformed value is an independent dial (undefined)", () => {
		for (const raw of JUNK) assert.equal(stripGroupOf(raw), undefined, JSON.stringify(raw));
	});

	it("needs v exactly 1 and a 32 lowercase hex id", () => {
		const ok = { v: 1, id: ID, rev: 3, joined: true, config: {} };
		assert.ok(stripGroupOf(ok));
		for (const v of [2, "1", 0, 1.5, null]) assert.equal(stripGroupOf({ ...ok, v }), undefined, `v ${String(v)}`);
		for (const id of [ID.toUpperCase(), ID.slice(1), `${ID}0`, `${ID.slice(0, 31)}g`, ` ${ID.slice(1)}`, 12, null, "0123456789abcdef-0123456789abcde"]) {
			assert.equal(stripGroupOf({ ...ok, id }), undefined, `id ${String(id)}`);
		}
	});

	it("rev reads as a safe integer >= 1, else 0 (never authority over a valid copy)", () => {
		const base = { v: 1, id: ID, joined: true, config: {} };
		assert.equal(stripGroupOf({ ...base, rev: 1 })?.rev, 1);
		assert.equal(stripGroupOf({ ...base, rev: 2 ** 40 })?.rev, 2 ** 40);
		for (const rev of [0, -1, 1.5, "3", Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY, Number.NaN, null, undefined]) {
			assert.equal(stripGroupOf({ ...base, rev })?.rev, 0, `rev ${String(rev)}`);
		}
	});

	it("joined is exactly true; anything else is a dormant copy", () => {
		const base = { v: 1, id: ID, rev: 1, config: {} };
		assert.equal(stripGroupOf({ ...base, joined: true })?.joined, true);
		for (const joined of [false, "true", 1, null, undefined, {}]) assert.equal(stripGroupOf({ ...base, joined })?.joined, false, String(joined));
	});

	it("never throws on hostile shapes", () => {
		const hostile = [{ v: 1, id: ID, rev: 1, joined: true, config: { panes: "x", layout: {}, window: [] } }, { v: 1, id: ID, rev: 1, joined: true, config: { panes: [null, 5, { series: "x", bands: {} }] } }, Object.create(null) as object];
		for (const raw of hostile) assert.doesNotThrow(() => stripGroupOf(raw));
	});
});

describe("stripConfigOf: exact values, field by field", () => {
	it("defaults for an absent config", () => {
		const c = stripConfigOf(undefined);
		assert.equal(c.layout, "whole");
		assert.equal(c.encoders, null);
		assert.equal(c.window, "5m");
		assert.equal(c.sharedWindow, true);
		assert.equal(c.background, undefined, "absent is Default: the shared dial Background");
		assert.equal(c.accentWords, undefined, "absent is Default: the shared Words");
		assert.equal(c.looksGen, undefined);
		assert.equal(c.fahrenheit, false);
		assert.equal(c.decimals, "auto");
		assert.equal(c.textDimSecondary, false);
		assert.equal(c.theme, undefined);
		assert.equal(c.textMode, undefined);
		assert.equal(c.linkId, undefined);
		assert.deepEqual(c.panes, [EMPTY_PANE, EMPTY_PANE]);
	});

	const table: { field: string; good: [unknown, unknown][]; bad: unknown[]; fallback: unknown }[] = [
		{ field: "layout", good: [["whole", "whole"], ["split", "split"]], bad: ["Split", " split", "half", 1, true], fallback: "whole" },
		{ field: "encoders", good: [[4, 4], [6, 6]], bad: [5, 8, "4", 0, 4.5], fallback: null },
		{ field: "window", good: [["1m", "1m"], ["5m", "5m"], ["15m", "15m"]], bad: ["10m", "5M", 5, "5 m", ""], fallback: "5m" },
		{ field: "sharedWindow", good: [[false, false], [true, true]], bad: ["false", 0, null], fallback: true },
		{ field: "decimals", good: [["0", "0"], ["3", "3"], ["auto", "auto"]], bad: [0, "4", "1.0", ""], fallback: "auto" },
		{ field: "fahrenheit", good: [[true, true]], bad: ["true", 1, false], fallback: false },
		{ field: "textMode", good: [["dim", "dim"], ["custom", "custom"], ["theme", "theme"]], bad: ["Dim", "", "auto"], fallback: undefined },
		{ field: "textColor", good: [["#12AB9f", "#12AB9f"]], bad: ["#12AB9", "12AB9F", "red", "#12AB9FF"], fallback: undefined },
		{ field: "theme", good: [["graphite", "graphite"]], bad: ["", 7, "x".repeat(65)], fallback: undefined },
		{ field: "linkId", good: [["left", "left"]], bad: ["", 3, "x".repeat(65)], fallback: undefined }
	];
	for (const row of table) {
		it(`${row.field}: exact values only`, () => {
			for (const [raw, expected] of row.good) assert.deepEqual((stripConfigOf({ [row.field]: raw }) as Record<string, unknown>)[row.field], expected);
			for (const raw of row.bad) assert.deepEqual((stripConfigOf({ [row.field]: raw }) as Record<string, unknown>)[row.field], row.fallback, `${row.field} ${JSON.stringify(raw)}`);
		});
	}

	it("background and accent words read only through the dial's own readers; anything else is Default", () => {
		for (const look of DIAL_BACKGROUNDS) assert.equal(stripConfigOf({ background: look }).background, look);
		for (const junk of ["", "Glass", "glass ", "THEME", "frost", 1, null, true]) assert.equal(stripConfigOf({ background: junk }).background, undefined, String(junk));
		assert.equal(stripConfigOf({ accentWords: true }).accentWords, true);
		assert.equal(stripConfigOf({ accentWords: false }).accentWords, false, "an own false keeps plain words under shared accent words");
		for (const junk of ["true", 1, "", null]) assert.equal(stripConfigOf({ accentWords: junk }).accentWords, undefined, String(junk));
		for (const [raw, gen] of [[3, 3], [0, undefined], [-1, undefined], [1.5, undefined], ["3", undefined]] as const) assert.equal(stripConfigOf({ background: "clear", looksGen: raw }).looksGen, gen, String(raw));
	});

	it("an own look round-trips; Default writes no field", () => {
		const own = stripConfigToJson(stripConfigOf({ background: "clear", accentWords: false, looksGen: 2 }));
		assert.equal(own.background, "clear");
		assert.equal(own.accentWords, false);
		assert.equal(own.looksGen, 2);
		const def = stripConfigToJson(stripConfigOf({}));
		assert.ok(!("background" in def) && !("accentWords" in def) && !("looksGen" in def), JSON.stringify(def));
		const reset = stripConfigToJson(withDefaultLooks(stripConfigOf({ background: "nebula", accentWords: true, looksGen: 4, futureField: { x: 1 } })));
		assert.ok(!("background" in reset) && !("accentWords" in reset) && !("looksGen" in reset), JSON.stringify(reset));
		assert.deepEqual(reset.futureField, { x: 1 }, "an unknown field rides along a reset");
	});

	it("always two panes; extra panes are ignored; the whole layout draws the first", () => {
		const c = stripConfigOf({ layout: "whole", panes: [{ style: "area" }, { style: "heat" }, { style: "lanes" }] });
		assert.equal(c.panes.length, 2);
		assert.equal(activePanes(c).length, 1);
		assert.equal(activePanes(c)[0]?.style, "area");
		assert.equal(activePanes(stripConfigOf({ layout: "split", panes: [{ style: "area" }] })).length, 2);
		assert.deepEqual(stripConfigOf({ layout: "split", panes: [{ style: "area" }] }).panes[1], EMPTY_PANE);
	});
});

describe("stripPaneOf", () => {
	it("style exact, else trend", () => {
		for (const style of ["trend", "area", "compare", "lanes", "heat"]) assert.equal(stripPaneOf({ style }).style, style);
		for (const junk of ["Trend", "line", "", 3]) assert.equal(stripPaneOf({ style: junk }).style, "trend");
	});

	it("series: valid keys, unique, at most MAX_SERIES whatever the style, bad entries dropped", () => {
		const series = [{ key: "a" }, { key: "a" }, { key: "" }, { key: 5 }, null, { key: "b", name: "B", color: "#112233" }, { key: "c", color: "blue", name: 7 }, { key: "d" }, { key: "e" }, { key: "f" }, { key: "g" }];
		const pane = stripPaneOf({ style: "compare", series });
		assert.deepEqual(pane.series, [{ key: "a" }, { key: "b", name: "B", color: "#112233" }, { key: "c" }, { key: "d" }, { key: "e" }, { key: "f" }]);
		// The parser never cuts to a style's limit: that cut is the renderer's.
		for (const style of ["heat", "trend", "lanes"]) assert.deepEqual(stripPaneOf({ style, series }).series, pane.series, style);
		assert.equal(MAX_SERIES, Math.max(...Object.values(SERIES_LIMITS).map((l) => l.max)));
		assert.deepEqual(drawnSeries(stripPaneOf({ style: "heat", series })), [{ key: "a" }]);
		// Large values only draws every reading it stores, whatever Graph is stored.
		for (const style of ["trend", "area", "compare", "lanes", "heat"]) assert.equal(drawnSeries(stripPaneOf({ style, readout: "only", series })).length, MAX_SERIES, style);
		assert.equal(drawnSeries(stripPaneOf({ style: "events", readout: "only", series })).length, Math.min(series.length, SERIES_LIMITS.events.max), "Events keeps a stored readout unused");
		assert.deepEqual(drawnSeries(stripPaneOf({ style: "trend", series })).length, SERIES_LIMITS.trend.max);
		assert.deepEqual(stripPaneOf({ series: "a,b" }).series, []);
	});

	it("four readings in a two- or three-reading style survive a parse and a rewrite", () => {
		const four = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
		for (const style of ["trend", "area", "lanes", "heat"]) {
			const stored = stripConfigToJson(stripConfigOf({ encoders: 4, panes: [{ style, series: four, bands: [{ key: "d", warn: 80 }] }] }));
			const again = stripConfigOf(stored);
			assert.deepEqual(again.panes[0].series, four, style);
			assert.deepEqual(again.panes[0].bands.map((b) => b.key), ["d"], `${style}: a band on a reading past the limit stays too`);
		}
	});

	it("overlays: exact booleans over the defaults", () => {
		assert.deepEqual(stripPaneOf({}).overlays, DEFAULT_OVERLAYS);
		const o = stripPaneOf({ overlays: { current: false, minmax: true, unit: "no", legend: 0, time: null } }).overlays;
		assert.deepEqual(o, { ...DEFAULT_OVERLAYS, current: false, minmax: true });
	});

	it("scale: parseThreshold semantics, an inverted range is auto", () => {
		assert.deepEqual(stripPaneOf({ scale: { min: "20", max: 100 } }).scale, { min: 20, max: 100 });
		assert.deepEqual(stripPaneOf({ scale: { min: "70,5" } }).scale, { min: 70.5 });
		assert.deepEqual(stripPaneOf({ scale: { min: 90, max: 10 } }).scale, {});
		assert.deepEqual(stripPaneOf({ scale: { min: 50, max: 50 } }).scale, {});
		assert.deepEqual(stripPaneOf({ scale: { min: "abc", max: "" } }).scale, {});
	});

	it("bands are reading-scoped: a band for a reading the pane does not draw is dropped", () => {
		const pane = stripPaneOf({
			series: [{ key: "cpu" }, { key: "gpu" }],
			bands: [{ key: "cpu", warn: 80, crit: "90" }, { key: "fan", warn: 1 }, { key: "gpu" }, { key: "gpu", crit: 95, below: "yes", unit: "°C" }, 7]
		});
		assert.deepEqual(pane.bands, [
			{ key: "cpu", warn: 80, crit: 90, below: false },
			{ key: "gpu", crit: 95, below: false, unit: "°C" }
		]);
	});
});

describe("windows and seeds", () => {
	it("a split pane keeps its own window only when sharedWindow is exactly false", () => {
		const shared = stripConfigOf({ layout: "split", window: "1m", panes: [{ window: "15m" }, { window: "5m" }] });
		assert.equal(paneWindowOf(shared, 0), "1m");
		assert.equal(paneWindowOf(shared, 1), "1m");
		const own = stripConfigOf({ layout: "split", window: "1m", sharedWindow: false, panes: [{ window: "15m" }, {}] });
		assert.equal(paneWindowOf(own, 0), "15m");
		assert.equal(paneWindowOf(own, 1), "1m");
		const whole = stripConfigOf({ layout: "whole", window: "1m", sharedWindow: false, panes: [{ window: "15m" }] });
		assert.equal(paneWindowOf(whole, 0), "1m");
	});

	it("the seed copies the creating dial's theme and text once, never its Background or Words", () => {
		const seed = stripSeedOf({ theme: "ember", textMode: "dim", dialBackground: "tint", dialAccentWords: true, fahrenheit: true, decimals: "1", linkId: "  left ", readingKey: "a:0:1", label: "ignored" });
		assert.deepEqual(seed, { theme: "ember", textMode: "dim", textDimSecondary: false, fahrenheit: true, decimals: "1", linkId: "left", readingKey: "a:0:1" });
		const junk = stripSeedOf({ dialBackground: "Tint", dialAccentWords: "true", decimals: 2 });
		assert.equal(junk.decimals, "auto");
		const config = newStripConfig("split", 6, seed);
		assert.equal(config.background, undefined, "a new strip follows the shared Background");
		assert.equal(config.accentWords, undefined, "and the shared Words");
		assert.equal(config.window, "5m");
		assert.equal(config.encoders, 6);
		assert.deepEqual(config.panes[0].series, [{ key: "a:0:1" }]);
		assert.deepEqual(config.panes[1], EMPTY_PANE);
	});

	it("minted ids are 32 lowercase hex", () => {
		assert.match(mintStripId(), /^[0-9a-f]{32}$/);
		assert.equal(mintStripId(() => "ABCDEF01-2345-6789-ABCD-EF0123456789"), "abcdef0123456789abcdef0123456789");
		assert.throws(() => mintStripId(() => "short"));
	});
});

describe("writing: canonical, round-trips, keeps unknown fields", () => {
	it("a parsed config writes and parses back to itself", () => {
		const raw = { layout: "split", encoders: 4, window: "15m", sharedWindow: false, background: "glass", accentWords: true, theme: "forest", textMode: "custom", textColor: "#ABCDEF", textDimSecondary: true, fahrenheit: true, decimals: "2", linkId: "deck", panes: [{ style: "lanes", series: [{ key: "a" }, { key: "b", name: "Bee" }], window: "1m", overlays: { minmax: true }, scale: { min: 0 }, bands: [{ key: "a", warn: 1 }] }, { style: "heat", series: [{ key: "c" }] }] };
		const parsed = stripConfigOf(raw);
		assert.equal(sortedJson(stripConfigOf(stripConfigToJson(parsed))), sortedJson(parsed));
	});

	it("unknown fields of the replaced copy survive a rewrite (forward compatible)", () => {
		const stored = { v: 1, id: ID, rev: 2, joined: true, future: { a: 1 }, config: { layout: "whole", glow: "soft", panes: [{ style: "area", sparkle: true, overlays: { grid: true } }] } };
		const copy = stripGroupOf(stored);
		assert.ok(copy);
		const json = stripGroupToJson({ ...copy, rev: 3 }, stored) as Record<string, unknown>;
		assert.deepEqual(json.future, { a: 1 });
		const config = json.config as Record<string, unknown>;
		assert.equal(config.glow, "soft");
		const pane = (config.panes as Record<string, unknown>[])[0] as Record<string, unknown>;
		assert.equal(pane.sparkle, true);
		assert.equal((pane.overlays as Record<string, unknown>).grid, true);
		assert.equal(json.rev, 3);
	});

	it("unknown fields inside series, scale and band entries survive a rewrite too", () => {
		const stored = {
			v: 1,
			id: ID,
			rev: 2,
			joined: true,
			config: {
				panes: [
					{
						style: "trend",
						series: [{ key: "a:0:1", stat: "avg" }, { key: "b" }, { key: "", lost: 1 }],
						scale: { min: 0, log: true },
						bands: [{ key: "a:0:1", warn: 80, dwellMs: 5000 }, { key: "a:0:1", crit: 95, dwellMs: 9000 }, { key: "b", dwellMs: 1 }]
					}
				]
			}
		};
		const copy = stripGroupOf(stored);
		assert.ok(copy);
		const pane = ((stripGroupToJson({ ...copy, rev: 3 }, stored).config as Record<string, unknown>).panes as Record<string, unknown>[])[0] as Record<string, unknown>;
		assert.deepEqual(pane.series, [{ stat: "avg", key: "a:0:1" }, { key: "b" }]);
		assert.deepEqual(pane.scale, { log: true, min: 0 });
		// Each band takes the unknown fields of its own stored band, in order.
		assert.deepEqual(pane.bands, [
			{ dwellMs: 5000, key: "a:0:1", warn: 80, below: false },
			{ dwellMs: 9000, key: "a:0:1", crit: 95, below: false }
		]);
		// An entry with no stored match carries nothing.
		const fresh = stripGroupToJson({ ...copy, config: { ...copy.config, panes: [{ ...copy.config.panes[0], series: [{ key: "c" }] }, copy.config.panes[1]] } }, stored);
		assert.deepEqual(((fresh.config as Record<string, unknown>).panes as Record<string, unknown>[])[0]?.series, [{ key: "c" }]);
	});

	it("parsing never writes: the input object is untouched", () => {
		const raw = { v: 1, id: ID, rev: "7", joined: "yes", config: { layout: "Whole", panes: [{ style: "x", series: [{ key: "" }] }] } };
		const before = JSON.stringify(raw);
		stripGroupOf(raw);
		assert.equal(JSON.stringify(raw), before);
	});
});

describe("the unit stamp (40-spec-final.md section 4.2)", () => {
	it("33. a scale and a band keep a stamp whose record matches their numbers, and drop one that no longer does", () => {
		assert.deepEqual(stripPaneOf({ scale: { min: 30, max: 90, displayUnit: "°C", displayUnitFor: { min: "30", max: "90" } } }).scale, { min: 30, max: 90, displayUnit: "°C" });
		assert.deepEqual(stripPaneOf({ scale: { min: 30, max: 90, displayUnit: "°C", displayUnitFor: { min: "30", max: "91" } } }).scale, { min: 30, max: 90 });
		const band = (record: Record<string, string>) => stripPaneOf({ series: [{ key: "a" }], bands: [{ key: "a", warn: 80, below: false, unit: "°C", displayUnit: "°C", displayUnitFor: record }] }).bands[0];
		assert.equal(band({ warn: "80" })?.displayUnit, "°C");
		assert.equal(band({ warn: "81" })?.displayUnit, undefined);
	});

	it("a reading with no unit is stamped with the empty unit, which counts like any other", () => {
		assert.deepEqual(stripPaneOf({ scale: { max: 2, displayUnit: "", displayUnitFor: { max: "2" } } }).scale, { max: 2, displayUnit: "" });
		assert.deepEqual(stripPaneOf({ scale: { max: 2, displayUnit: "", displayUnitFor: { max: "3" } } }).scale, { max: 2 }, "a record that no longer matches proves nothing");
		assert.deepEqual(stripPaneOf({ scale: { max: 2, displayUnit: "" } }).scale, { max: 2 }, "no record, no stamp");
		const pane = stripPaneOf({ series: [{ key: "a" }], scale: { max: 2, displayUnit: "", displayUnitFor: { max: "2" } }, bands: [{ key: "a", warn: 0.8, below: false, unit: "", displayUnit: "", displayUnitFor: { warn: "0.8" } }] });
		assert.equal(pane.bands[0]?.displayUnit, "");
		const json = stripPaneToJson(pane) as { scale?: Record<string, unknown>; bands?: Record<string, unknown>[] };
		assert.deepEqual(json.scale, { max: 2, displayUnit: "", displayUnitFor: { max: "2" } }, "written back as read");
		assert.equal(json.bands?.[0]?.displayUnit, "");
	});
});
