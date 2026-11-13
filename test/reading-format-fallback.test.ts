/**
 * A reading with its own unit and decimals (issue #59) whose text does not
 * fit its place on the face: it still shows a number, never a lone "…"
 * and never text under the layout's readable floor. The face draws the
 * first that fits of three texts:
 *
 * 1. the exact text (on a four-reading key, at 26 px, 24 labeled, down to
 *    18 px),
 * 2. the same value in the same unit with no decimals (down to 16 px on a
 *    four-reading key),
 * 3. that value compacted by the layout's own rule (a four-reading key's
 *    four glyphs, "123k"; elsewhere the Auto rule, "22.0T"), at the
 *    layout's normal size.
 *
 * The panel says what the reading shows on the face and what would fit,
 * only while a reading takes step 2 or 3.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeView } from "../scripts/lib/strip-fixtures";
import { composeDialSvg, type DialSettings } from "../src/actions/sensor-dial";
import { backFallbackSettings, compose, type ReadingSettings } from "../src/actions/sensor-reading";
import { composeBackFace, composeChunkFace, type DetailFaceContext } from "../src/detail/detail-faces";
import type { DeviceDetailState } from "../src/detail/navigation";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { buildPreview } from "../src/pi-protocol";
import type { PollerStatus } from "../src/poller";
import { SessionStatsStore } from "../src/stats";
import { buildStripScene, historyWidthFor, stripAlertColors, stripBandsFor, WINDOW_MS, type StripSceneInput, type StripSeriesInput } from "../src/strip/scene";
import { stripConfigOf } from "../src/strip/settings";
import { setFaceFont } from "../src/ui/face-font";
import { applyGlobalThemeSettings, effectiveTextFor, measureOptionsFrom } from "../src/ui/theme-store";
import { loadThemes, resolvePalette } from "../src/ui/themes";

applyGlobalThemeSettings({ dataUnits: "decimal", textFont: "tahoma" });
setFaceFont("tahoma");

type Formats = Record<string, { unit: string; decimals: string }>;
type Drawn = { size: number; bold: boolean; x: number; y: number; text: string };

function decode(text: string): string {
	return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function drawn(svg: string): Drawn[] {
	return [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map((m) => {
		const attr = (name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(m[1] as string)?.[1];
		return {
			size: Number(attr("font-size")),
			bold: attr("font-weight") === "700",
			x: Number(attr("x")),
			y: Number(attr("y")),
			text: decode((m[2] as string).replace(/<[^>]+>/g, "")).replace(/\s+/gu, " ").trim()
		};
	});
}

/** A value drawn as a lone "…" (a value line starting with it, or a stats
 * number), or a number cut short ("12345…"). */
function overflowMarks(svg: string): string[] {
	return drawn(svg)
		.filter((d) => (d.bold && /^…|\d…/u.test(d.text)) || /[▼▲]…/u.test(d.text))
		.map((d) => d.text);
}

const T = SensorType.Other;
const R = (key: string, label: string, unit: string, value: number): Reading => ({ key, type: T, sensorIndex: 0, id: 1, label, unit, value, valueMin: value, valueMax: value, valueAvg: value }) as Reading;
const snapOf = (readings: readonly Reading[]): SensorSnapshot => ({ pollTime: 1, version: 2, revision: 0, sensors: [{ index: 0, id: 1, instance: 0, name: "Drive" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) }) as unknown as SensorSnapshot;
const okOf = (readings: readonly Reading[]): PollerStatus => ({ state: "ok", snapshot: snapOf(readings), source: "shared-memory" });

// The owner's key: Total Host Writes in GB at GB 2 decimals beside three
// readings on Auto (fixed values; his deck's read 22,031 GB).
const W = "f0000100:4:8000002";
const HR = "f0000100:1:8000004";
const VC = "f0000301:0:8000000";
const VA = "f0000301:0:8000001";
const writes = (gb: number): Reading => R(W, "Total Host Writes", "GB", gb);
const others = [R(HR, "Total Host Reads", "GB", 28840), R(VC, "Virtual Memory Committed", "MB", 82634), R(VA, "Virtual Memory Available", "MB", 15066)];
const his = (unit = "GB", decimals = "2"): ReadingSettings => ({ keyLayout: "quad", readingKey: W, secondaryReadingKey: HR, quadReadingKey3: VC, quadReadingKey4: VA, readingFormats: { [W]: { unit, decimals } } });
/** The top-left cell's value and unit (unlabeled quad: value at y 40, unit at y 58). */
function topLeft(svg: string): { value?: Drawn; unit?: Drawn } {
	const d = drawn(svg);
	return { value: d.find((t) => t.x === 36 && t.y === 40), unit: d.find((t) => t.x === 36 && t.y === 58) };
}

describe("four-reading key: exact text down to 18 px, then the whole number down to 16 px, then four glyphs", () => {
	it("his key: 22031.00 GB does not fit at 18 px, so the cell draws 22031 GB at 20 px", () => {
		const cell = topLeft(compose(his(), okOf([writes(22031), ...others])));
		assert.equal(cell.value?.text, "22031");
		assert.equal(cell.value?.size, 20);
		assert.equal(cell.unit?.text, "GB");
	});

	it("the same key at TB 2 keeps its exact text, 22.03 TB at 22 px", () => {
		const cell = topLeft(compose(his("TB", "2"), okOf([writes(22031), ...others])));
		assert.equal(cell.value?.text, "22.03");
		assert.equal(cell.value?.size, 22);
		assert.equal(cell.unit?.text, "TB");
	});

	it("the issue's two GPUs at GB 2 keep 12.10, 3.02, 0.45 and 8.24 at one size, 22 px", () => {
		const gpu = [R("g:0:1", "GPU Memory Allocated", "MB", 12100), R("g:0:2", "GPU Memory Available", "MB", 3020), R("g:1:1", "GPU Memory Allocated", "MB", 453), R("g:1:2", "GPU Memory Available", "MB", 8236)];
		const gb2 = { unit: "GB", decimals: "2" };
		const svg = compose({ keyLayout: "quad", readingKey: gpu[0]?.key, secondaryReadingKey: gpu[1]?.key, quadReadingKey3: gpu[2]?.key, quadReadingKey4: gpu[3]?.key, readingFormats: Object.fromEntries(gpu.map((r) => [r.key, gb2])) }, okOf(gpu));
		const values = drawn(svg).filter((d) => d.bold);
		assert.deepEqual(
			values.map((d) => [d.text, d.size]),
			[
				["12.10", 22],
				["3.02", 22],
				["0.45", 22],
				["8.24", 22]
			]
		);
	});

	it("123,238 GB at GB 2: the whole number fits at 16 px", () => {
		const cell = topLeft(compose(his(), okOf([writes(123238), ...others])));
		assert.equal(cell.value?.text, "123238");
		assert.equal(cell.value?.size, 16);
		assert.equal(cell.unit?.text, "GB");
	});

	it("a whole number too wide even at 16 px takes the quad's four glyphs at the cell's normal size", () => {
		const cell = topLeft(compose(his(), okOf([writes(1234567), ...others])));
		assert.equal(cell.value?.text, "1.2M");
		assert.equal(cell.value?.size, 26);
		assert.equal(cell.unit?.text, "GB");
		const huge = topLeft(compose(his("B", "3"), okOf([writes(4_000_000), ...others])));
		assert.equal(huge.value?.text, "4.0P");
		assert.equal(huge.unit?.text, "B");
	});

	it("a cell that takes its whole number keeps its own size; cells with their exact text share theirs", () => {
		const gb2 = { unit: "GB", decimals: "2" };
		const svg = compose({ ...his(), readingFormats: { [W]: gb2, [HR]: gb2 } }, okOf([writes(22031), ...others]));
		const d = drawn(svg).filter((t) => t.bold);
		assert.deepEqual(d.slice(0, 2).map((t) => [t.text, t.size]), [
			["22031", 20],
			["28840", 20]
		]);
		const mixed = drawn(compose({ ...his(), readingFormats: { [W]: gb2, [VA]: gb2 } }, okOf([writes(22031), ...others]))).filter((t) => t.bold);
		assert.deepEqual(mixed.map((t) => [t.text, t.size]), [
			["22031", 20],
			["28.8", 26],
			["82.6", 26],
			["15.07", 22]
		]);
	});

	it("without a format the quad is unchanged", () => {
		const plain = compose({ ...his(), readingFormats: undefined }, okOf([writes(22031), ...others]));
		assert.equal(topLeft(plain).value?.text, "22.0");
		assert.equal(topLeft(plain).unit?.text, "TB");
	});
});

describe("every other face: the whole number, then the layout's compact text, never a lone ellipsis", () => {
	const net = R(W, "Network Total DL", "MB", 4_800_000);
	const huge = R(W, "Data Read", "GB", 4_000_000);
	const temp = R("t:0:1", "GPU Temperature", "°C", 61.3);
	const status = (r: Reading): PollerStatus => okOf([r, temp]);
	const mb3 = { [W]: { unit: "MB", decimals: "3" } };
	const b3 = { [W]: { unit: "B", decimals: "3" } };

	it("single key: 4800000.000 MB is too wide, so 4800000 MB", () => {
		const d = drawn(compose({ readingKey: W, readingFormats: mb3 }, status(net)));
		assert.ok(d.some((t) => t.bold && t.text === "4800000"), JSON.stringify(d));
		assert.ok(d.some((t) => t.text === "MB"));
	});

	it("single key, Ring, two and three readings: a value of 4 PB in B compacts, its unit kept", () => {
		const faces: [string, ReadingSettings][] = [
			["single", { readingKey: W, readingFormats: b3 }],
			["ring", { readingKey: W, displayMode: "ring", readingFormats: b3 }],
			["dual", { readingKey: W, keyLayout: "dual", secondaryReadingKey: temp.key, readingFormats: b3 }],
			["triple", { readingKey: W, keyLayout: "triple", secondaryReadingKey: temp.key, quadReadingKey3: temp.key, readingFormats: b3 }]
		];
		for (const font of ["tahoma", "segoe-ui"] as const) {
			setFaceFont(font);
			for (const [name, settings] of faces) {
				const svg = compose(settings, status(huge));
				assert.deepEqual(overflowMarks(svg), [], `${font} ${name}`);
				const value = drawn(svg).find((t) => t.bold && /^4\.00P/.test(t.text));
				assert.ok(value !== undefined, `${font} ${name}: ${JSON.stringify(drawn(svg))}`);
				assert.ok(drawn(svg).some((t) => /(^|\s|P)B$/.test(t.text)), `${font} ${name}: the unit stays B`);
			}
		}
		setFaceFont("tahoma");
	});

	it("dial single view: the value and the session low and high take the same steps", () => {
		const stats = new SessionStatsStore();
		const low = { ...net, value: 4_704_000 };
		for (const r of [net, low]) stats.observe(r, snapOf([r]), "shared-memory");
		const svg = composeDialSvg({ settings: { readingKey: W, readingFormats: mb3 }, stats, statMode: "current", overlay: null, pinned: false, cyclePaused: false }, status(net), () => undefined);
		assert.deepEqual(overflowMarks(svg), []);
		const stat = drawn(svg).find((t) => t.text.startsWith("▼"));
		assert.equal(stat?.text, "▼4704000MB ▲4800000MB");
	});

	for (const dialView of ["tworow", "overview"] as const) {
		it(`dial ${dialView}: a row compacts, and the footer drops decimals before it compacts`, () => {
			const stats = new SessionStatsStore();
			stats.observe(huge, snapOf([huge]), "shared-memory");
			const settings: DialSettings = { dialView, readingKey: W, rotationKeys: [W, temp.key], readingFormats: b3 };
			const svg = composeDialSvg({ settings, stats, statMode: "current", overlay: null, pinned: false, cyclePaused: false }, status(huge), () => undefined);
			assert.deepEqual(overflowMarks(svg), []);
			assert.ok(drawn(svg).some((t) => t.bold && t.text === "4.00P"), JSON.stringify(drawn(svg)));
		});
	}
});

describe("detail tiles and the Back tile take the same steps", () => {
	const huge = R(W, "Data Read", "GB", 4_000_000);
	const temp = R("t:0:1", "GPU Temperature", "°C", 61.3);
	const status = okOf([huge, temp]);
	const presentation = { readingFormats: { [W]: { unit: "B", decimals: "3" } } };
	const state: DeviceDetailState = {
		deviceId: "dev1",
		pageSize: 11,
		density: 1,
		tilePlan: [],
		primaryKey: W,
		groupSettings: { readingKey: W },
		presentation: presentation as DeviceDetailState["presentation"],
		group: { mode: "source", primaryKey: W, title: "Drive", keys: [W, temp.key] },
		offset: 0,
		statModes: new Map(),
		surfaceCount: 1,
		pending: false,
		dispatchedAt: 0,
		openerCell: null,
		mirrorSlotIndex: null
	} as DeviceDetailState;
	const config = loadThemes();
	const ctx: DetailFaceContext = { config, deckThemeId: config.defaultTheme, typeAccents: true, measure: measureOptionsFrom({}), text: effectiveTextFor({}) };

	it("Back tile and its fallback", () => {
		const back = composeBackFace(state, status, ctx);
		assert.deepEqual(overflowMarks(back), []);
		assert.equal(back, compose(backFallbackSettings(state), status, true));
	});

	it("tiles of two, three and four readings", () => {
		for (const keys of [[W, temp.key], [W, temp.key, temp.key], [W, temp.key, temp.key, temp.key]]) {
			const svg = composeChunkFace(state, keys, "current", status, ctx);
			assert.deepEqual(overflowMarks(svg), [], `${keys.length} readings`);
		}
	});
});

describe("the panel note: what the reading shows here and what would fit", () => {
	const status = (gb: number): PollerStatus => okOf([writes(gb), ...others]);

	it("his key: 22031 GB shows, TB fits with 2 decimals", () => {
		assert.deepEqual(buildPreview(status(22031), his(), true, { kind: "key" }).effective?.formatFallback, [{ key: W, shows: "22031 GB", fits: { unit: "TB", decimals: "2" } }]);
	});

	it("no note while the exact text fits", () => {
		assert.deepEqual(buildPreview(status(22031), his("TB", "2"), true, { kind: "key" }).effective?.formatFallback, []);
		assert.equal(buildPreview(status(22031), { ...his(), readingFormats: undefined }, true, { kind: "key" }).effective?.formatFallback, undefined);
	});

	it("at TB with 3 decimals and too wide: fewer decimals fit", () => {
		const fallback = buildPreview(status(912_345_678), his("TB", "3"), true, { kind: "key" }).effective?.formatFallback;
		assert.equal(fallback?.length, 1);
		assert.equal(fallback?.[0]?.shows, "912346 TB");
		assert.equal(fallback?.[0]?.fits, undefined, "no larger unit and no fewer decimals: only what it shows");
		// 912.345 TB: "912.345" needs less than 18 px, "912.35" fits at 18.
		const notWide = buildPreview(status(912_345), his("TB", "3"), true, { kind: "key" }).effective?.formatFallback;
		assert.deepEqual(notWide, [{ key: W, shows: "912 TB", fits: { decimals: "2" } }]);
	});

	it("1,234,567 GB at GB 2: no larger unit holds 2 decimals, so the note names a larger unit with fewer", () => {
		assert.deepEqual(buildPreview(status(1_234_567), his(), true, { kind: "key" }).effective?.formatFallback, [{ key: W, shows: "1.2M GB", fits: { unit: "TB", decimals: "1" } }]);
	});

	it("a dial reports the reading on its value line", () => {
		const net = R(W, "Network Total DL", "MB", 4_800_000);
		const fallback = buildPreview(okOf([net]), { readingKey: W, dialView: "overview", rotationKeys: [W], readingFormats: { [W]: { unit: "B", decimals: "0" } } }, false, { kind: "dial" }).effective?.formatFallback;
		assert.equal(fallback?.length, 1);
		assert.equal(fallback?.[0]?.key, W);
		assert.match(fallback?.[0]?.shows ?? "", /^\d+(\.\d+)?[kMGTPE] B$/);
		assert.deepEqual(fallback?.[0]?.fits, { unit: "KB", decimals: "0" });
	});
});

describe("no finite value with its own format draws a lone ellipsis or a cut number", () => {
	const UNITS = ["B", "KB", "MB", "GB", "TB", "KiB", "MiB", "GiB", "TiB"];
	const VALUES: number[] = [];
	for (let k = -3; k <= 15; k++) for (const m of [1, 2.2031, 9.99951]) VALUES.push(m * 10 ** k);
	const temp = R("t:0:1", "GPU Temperature", "°C", 61.3);
	const KEYS: [string, (f: Formats) => ReadingSettings][] = [
		["single", (f) => ({ readingKey: W, readingFormats: f })],
		["ring", (f) => ({ readingKey: W, displayMode: "ring", readingFormats: f })],
		["dual", (f) => ({ readingKey: W, keyLayout: "dual", secondaryReadingKey: temp.key, readingFormats: f })],
		["triple", (f) => ({ readingKey: W, keyLayout: "triple", secondaryReadingKey: temp.key, quadReadingKey3: temp.key, readingFormats: f })],
		["quad", (f) => ({ readingKey: W, keyLayout: "quad", secondaryReadingKey: temp.key, readingFormats: f })],
		["quad labeled", (f) => ({ readingKey: W, keyLayout: "quad", quadLabels: true, secondaryReadingKey: temp.key, readingFormats: f })]
	];
	const DIALS: [string, (f: Formats) => DialSettings][] = [
		["dial single", (f) => ({ readingKey: W, readingFormats: f })],
		["dial two rows", (f) => ({ readingKey: W, dialView: "tworow", rotationKeys: [W, temp.key], readingFormats: f })],
		["dial three rows", (f) => ({ readingKey: W, dialView: "overview", rotationKeys: [W, temp.key], readingFormats: f })]
	];

	for (const font of ["tahoma", "segoe-ui"] as const) {
		it(`${font}: 0.001 to 1e15 MB in every fixed unit, decimals 0 to 3, on every key layout and dial view`, () => {
			setFaceFont(font);
			applyGlobalThemeSettings({ dataUnits: "decimal", textFont: font });
			const bad: string[] = [];
			try {
				for (const value of VALUES) {
					const r: Reading = { ...R(W, "Data", "MB", value), valueMin: value * 0.98 };
					const status = okOf([r, temp]);
					const stats = new SessionStatsStore();
					stats.observe(r, status.state === "ok" ? status.snapshot : snapOf([r]), "shared-memory");
					stats.observe({ ...r, value: r.valueMin }, snapOf([r]), "shared-memory");
					for (const unit of UNITS) {
						for (const decimals of ["0", "1", "2", "3"]) {
							const f = { [W]: { unit, decimals } };
							const faces: [string, string][] = [
								...KEYS.map(([name, s]): [string, string] => [name, compose(s(f), status)]),
								...DIALS.map(([name, s]): [string, string] => [name, composeDialSvg({ settings: s(f), stats, statMode: "current", overlay: null, pinned: false, cyclePaused: false }, status, () => undefined)])
							];
							for (const [name, svg] of faces) {
								const marks = overflowMarks(svg);
								if (marks.length > 0) bad.push(`${name} ${value} MB at ${unit} ${decimals}: ${marks.join(" / ")}`);
								if (name.startsWith("quad")) {
									// The value lines (y 40 or 45 in each 72 px row); micro-labels draw above.
									const small = drawn(svg).filter((t) => t.bold && (t.y % 72 === 40 || t.y % 72 === 45) && t.size < 16);
									if (small.length > 0) bad.push(`${name} ${value} MB at ${unit} ${decimals}: ${small.map((t) => `${t.text} at ${t.size} px`).join(" / ")}`);
								}
							}
						}
					}
				}
			} finally {
				setFaceFont("tahoma");
				applyGlobalThemeSettings({ dataUnits: "decimal", textFont: "tahoma" });
			}
			assert.deepEqual(bad.slice(0, 12), [], `${bad.length} faces`);
		});
	}
});

describe("the Strip Display takes the same steps where a number cannot fit", () => {
	const A = "a1:0:5";
	const B = "a2:0:5";
	const themes = loadThemes();
	const palette = resolvePalette(themes, "void", null, "normal");
	const PANES: Record<string, Record<string, unknown>> = {
		"readout left": { style: "trend", readout: "left", series: [{ key: A, name: "Writes" }, { key: B, name: "Reads" }] },
		"readout only": { style: "trend", readout: "only", series: [{ key: A, name: "Writes" }] },
		meters: { style: "meters", series: [{ key: A, name: "Writes" }, { key: B, name: "Reads" }] }
	};
	/** The texts one whole + XL strip draws for both readings at one value. */
	function texts(pane: Record<string, unknown>, value: number, formats: Formats): string[] {
		const config = stripConfigOf({ layout: "whole", encoders: 6, window: "5m", theme: "void", readingFormats: formats, panes: [pane] });
		const width = historyWidthFor(config, 6, 0, 2);
		const series: StripSeriesInput[] = [A, B].map((key) => ({ key, name: key, unit: "MB", state: "ok", history: makeView({ windowMs: WINDOW_MS[config.window], widthPx: width, unit: "MB", type: T, value: (f: number) => value * (0.98 + 0.02 * f) }), current: value }));
		const measure = { fahrenheit: config.fahrenheit, decimals: config.decimals, dataUnits: "decimal" as const };
		const input: StripSceneInput = {
			config,
			encoders: 6,
			palette,
			text: { mode: "theme", color: undefined, dimSecondary: false },
			alertColors: stripAlertColors(themes.alertValues, palette, config.background),
			dataUnits: "decimal",
			panes: [{ series, bands: stripBandsFor(config.panes[0], series, measure, formats), view: { mode: "live" }, highlight: 0 }]
		};
		return buildStripScene(input)
			.prims.filter((p) => p.k === "text")
			.map((p) => (p as { text: string }).text);
	}

	it("meters: 22,031 GB of host writes in B with 2 decimals draws a number, not a lone ellipsis", () => {
		const shown = texts(PANES.meters as Record<string, unknown>, 22_031_000, { [A]: { unit: "B", decimals: "2" }, [B]: { unit: "B", decimals: "2" } });
		assert.ok(!shown.includes("…"), shown.join(" | "));
		assert.ok(shown.includes("22031000000000"), shown.join(" | "));
	});

	for (const font of ["tahoma", "segoe-ui"] as const) {
		it(`${font}: 0.001 to 1e15 MB in every fixed unit, decimals 0 to 3, on readouts and meters`, () => {
			setFaceFont(font);
			const bad: string[] = [];
			try {
				for (let k = -3; k <= 15; k++) {
					const value = 9.99951 * 10 ** k;
					for (const unit of ["B", "KB", "MB", "GB", "TB", "KiB", "MiB", "GiB", "TiB"]) {
						for (const decimals of ["0", "1", "2", "3"]) {
							for (const [name, pane] of Object.entries(PANES)) {
								const marks = texts(pane, value, { [A]: { unit, decimals }, [B]: { unit, decimals } }).filter((t) => t === "…" || /d…/u.test(t));
								if (marks.length > 0) bad.push(`${name} ${value} MB at ${unit} ${decimals}: ${marks.join(" / ")}`);
							}
						}
					}
				}
			} finally {
				setFaceFont("tahoma");
			}
			assert.deepEqual(bad.slice(0, 12), [], `${bad.length} panes`);
		});
	}
});
