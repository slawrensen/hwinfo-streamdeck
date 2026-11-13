/**
 * Per-reading formats (issue #59) on every surface, through the production
 * composers: key layouts, dial views and their stats, detail tiles, the
 * Back tile and its fallback, and the panel preview. Each reading resolves
 * its own format; the readings without one draw exactly what they drew
 * before; a number that cannot fit drops its decimals, then compacts, its
 * unit kept, never a lone "…" (reading-format-fallback.test.ts); alerts,
 * gauges and session statistics never move.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { composeDialSvg, type DialSettings } from "../src/actions/sensor-dial";
import { backFallbackSettings, compose, type ReadingSettings } from "../src/actions/sensor-reading";
import { immediateKeyView, keyAlertPanelOf, KeyAlerts } from "../src/alerts/key-alerts";
import { AlertStore } from "../src/alerts/store";
import { composeBackFace, composeChunkFace, composeReadingFace, type DetailFaceContext } from "../src/detail/detail-faces";
import { DetailNavigator, type DeviceDetailState } from "../src/detail/navigation";
import type { Reading, SensorSnapshot } from "../src/hwinfo/types";
import { buildPreview, buildSensorTree } from "../src/pi-protocol";
import type { PollerStatus } from "../src/poller";
import { SessionStatsStore } from "../src/stats";
import { setFaceFont } from "../src/ui/face-font";
import { fixed, type StatMode } from "../src/ui/format";
import { formatStat } from "../src/ui/measure";
import type { FormatFallback } from "../src/ui/reading-format-fit";
import { applyGlobalThemeSettings, effectiveTextFor, measureOptionsFrom } from "../src/ui/theme-store";
import { loadThemes } from "../src/ui/themes";
import { DISK, G0, G0_ALLOC, G1, HUGE, NET_DL, NO_STATS, snapshotAt, TEMP } from "./format-legacy-driver";

applyGlobalThemeSettings({ dataUnits: "decimal", textFont: "tahoma" });
setFaceFont("tahoma");

const snapshot = snapshotAt(0);
const ok: PollerStatus = { state: "ok", snapshot, source: "shared-memory" };
const PLAIN = /^-?\d+(\.\d+)?$/;
const GB2 = { unit: "GB", decimals: "2" };

type Drawn = { size: number; text: string };

function decode(text: string): string {
	return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** Every <text> element: its font size and its words, tspans included. */
function drawn(svg: string): Drawn[] {
	return [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map((m) => ({ size: Number(/font-size="([\d.]+)"/.exec(m[1] as string)?.[1]), text: decode((m[2] as string).replace(/<[^>]+>/g, "")) }));
}

/** The words, with the inline gaps (en and thin spaces) read as one space. */
function words(svg: string): string[] {
	return drawn(svg).map((d) => d.text.replace(/\s+/gu, " ").trim());
}

/** The face with its words taken out: gauges, zones, bars, colors, layout. */
function withoutText(svg: string): string {
	return svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, "");
}

function key(settings: ReadingSettings, status: PollerStatus = ok): string {
	return compose(settings, status);
}

function sessionStats(): SessionStatsStore {
	const stats = new SessionStatsStore();
	for (const drift of [0.1, -0.2, 0]) {
		const snap = snapshotAt(drift);
		for (const reading of snap.readings) stats.observe(reading, snap, "shared-memory");
	}
	return stats;
}

function dial(settings: DialSettings, stats = sessionStats(), view: { statMode?: StatMode; pinned?: boolean; cyclePaused?: boolean } = {}, status: PollerStatus = ok): string {
	return composeDialSvg({ settings, stats, statMode: view.statMode ?? "current", overlay: null, pinned: view.pinned === true, cyclePaused: view.cyclePaused === true }, status, () => undefined);
}

const v = (key: string): number => (snapshot.byKey.get(key) as Reading).value;

describe("keys: each reading its own format", () => {
	it("single: the issue's examples in fixed GB at 2 decimals, value and unit", () => {
		for (const k of [G0, G0_ALLOC, G1]) {
			const w = words(key({ readingKey: k, readingFormats: { [k]: GB2 } }));
			assert.ok(w.includes(fixed((v(k) * 1e6) / 1e9, 2)), `${k}: ${w.join(" | ")}`);
			assert.ok(w.includes("GB"), k);
		}
	});

	it("single: MIN, MAX and AVG in the same unit and decimals", () => {
		const r = snapshot.byKey.get(G1) as Reading;
		for (const [mode, value] of [["min", r.valueMin], ["max", r.valueMax], ["avg", r.valueAvg]] as const) {
			const w = words(key({ readingKey: G1, statMode: mode, readingFormats: { [G1]: { unit: "TB", decimals: "3" } } }));
			assert.ok(w.includes(fixed((value * 1e6) / 1e12, 3)), `${mode}: ${w.join(" | ")}`);
			assert.ok(w.includes("TB"));
			assert.ok(w.includes(mode.toUpperCase()));
		}
	});

	it("dual: two GPUs with different formats; a slot swap keeps each reading's format", () => {
		const formats = { [G0]: GB2, [G1]: { unit: "MB", decimals: "0" } };
		const a = words(key({ readingKey: G0, keyLayout: "dual", secondaryReadingKey: G1, readingFormats: formats }));
		const b = words(key({ readingKey: G1, keyLayout: "dual", secondaryReadingKey: G0, readingFormats: formats }));
		for (const w of [a, b]) {
			assert.ok(w.some((t) => t.startsWith("0.45") && t.endsWith("GB")), w.join(" | "));
			assert.ok(w.some((t) => t.startsWith("12100") && t.endsWith("MB")), w.join(" | "));
		}
	});

	it("dual: two readings that both have their own format draw their values at one size (issue #59 G3)", () => {
		// 12.10 GB and 0.45 GB: 1.8 drew 12.10 at 24 px over 0.45 at 32 px, so
		// the GPU with less headroom looked bigger.
		// The value lines: a dual key's labels draw at 16 px and under.
		const valueSizes = (svg: string): number[] => drawn(svg).filter((d) => d.size > 16).map((d) => d.size);
		const both = valueSizes(key({ readingKey: G1, keyLayout: "dual", secondaryReadingKey: G0, label: "4090 free", secondaryLabel: "3060 free", readingFormats: { [G0]: GB2, [G1]: GB2 } }));
		assert.equal(both.length, 2, JSON.stringify(both));
		assert.equal(both[0], both[1], JSON.stringify(both));
		assert.equal(both[0], 24, "the smaller of the two fits");
		// A row without a format keeps its own size: nothing moves on a key
		// where one reading follows the key's Decimals.
		const one = valueSizes(key({ readingKey: G1, keyLayout: "dual", secondaryReadingKey: G0, readingFormats: { [G1]: GB2 } }));
		assert.deepEqual(one, [24, 32], "12.10 GB with its format, 453 MB on the key's Decimals");
	});

	it("triple: a formatted row, an Auto row and a temperature row stay independent", () => {
		const base: ReadingSettings = { readingKey: G1, keyLayout: "triple", secondaryReadingKey: G0, quadReadingKey3: TEMP };
		const plain = words(key(base));
		const formatted = words(key({ ...base, readingFormats: { [G1]: GB2 } }));
		assert.ok(formatted.some((t) => t === "12.10GB"), formatted.join(" | "));
		assert.ok(plain.includes("453MB") && formatted.includes("453MB"), "the Auto row is unchanged");
		assert.ok(plain.includes("61.3°C") && formatted.includes("61.3°C"), "the temperature row is unchanged");
	});

	it("quad: formatted cells keep their exact text at one shared, measured size", () => {
		const settings: ReadingSettings = { readingKey: G0, keyLayout: "quad", secondaryReadingKey: G1, quadReadingKey3: G0_ALLOC, quadReadingKey4: DISK, decimals: "2", readingFormats: { [G0]: GB2, [G1]: GB2, [G0_ALLOC]: GB2 } };
		const d = drawn(key(settings));
		const cell = (text: string): Drawn | undefined => d.find((t) => t.text === text);
		for (const text of ["0.45", "12.10", "3.02"]) assert.equal(cell(text)?.size, 22, `${text}: ${JSON.stringify(d)}`);
		assert.equal(cell("12.3")?.size, 26, "the cell without a format keeps the four-glyph quad text and size");
		const legacy = drawn(key({ ...settings, readingFormats: undefined }));
		assert.ok(legacy.some((t) => t.text === "12.1" && t.size === 26), "without formats the quad keeps its 1.7.1 decimal drop");
	});

	it("quad: a reading moved to another slot keeps its text and size", () => {
		const one = drawn(key({ readingKey: G1, keyLayout: "quad", secondaryReadingKey: TEMP, readingFormats: { [G1]: GB2 } }));
		const two = drawn(key({ readingKey: TEMP, keyLayout: "quad", secondaryReadingKey: G1, readingFormats: { [G1]: GB2 } }));
		const of = (faces: Drawn[]): Drawn | undefined => faces.find((t) => t.text === "12.10");
		assert.deepEqual(of(one), of(two));
		assert.equal(of(one)?.size, 22);
	});

	it("quad: a number no size can hold takes four glyphs over its unit, never cut", () => {
		const d = drawn(key({ readingKey: HUGE, keyLayout: "quad", secondaryReadingKey: G1, readingFormats: { [HUGE]: { unit: "B", decimals: "0" }, [G1]: GB2 } }));
		const texts = d.map((t) => t.text);
		assert.ok(texts.includes("4P") && texts.includes("B"), texts.join(" | "));
		for (const t of texts) assert.ok(!t.includes("…"), `a cut value: ${t}`);
		assert.ok(texts.includes("12.10"));
	});

	it("single, dual and triple: the same rule, the value compacted with its unit", () => {
		const formats = { [HUGE]: { unit: "B", decimals: "3" } };
		for (const font of ["tahoma", "segoe-ui"] as const) {
			setFaceFont(font);
			const single = words(key({ readingKey: HUGE, readingFormats: formats }));
			assert.ok(single.includes("4.00P") && single.includes("B"), `${font}: ${single.join(" | ")}`);
			const dual = words(key({ readingKey: HUGE, keyLayout: "dual", secondaryReadingKey: G1, readingFormats: formats }));
			assert.ok(dual.includes("4.00PB") || dual.includes("4.00P B"), `${font}: ${dual.join(" | ")}`);
			const triple = words(key({ readingKey: HUGE, keyLayout: "triple", secondaryReadingKey: G1, quadReadingKey3: TEMP, readingFormats: formats }));
			assert.ok(triple.includes("4.00PB"), `${font}: ${triple.join(" | ")}`);
		}
		setFaceFont("tahoma");
	});

	it("never a stacked prefix: formatted values are plain numbers, or compact numbers past their room", () => {
		const formats = { [G0]: { unit: "B" }, [G1]: { unit: "KB" }, [G0_ALLOC]: { unit: "MB" }, [DISK]: { unit: "TB" } };
		for (const layout of ["single", "dual", "triple", "quad"]) {
			const d = drawn(key({ readingKey: G0, keyLayout: layout, secondaryReadingKey: G1, quadReadingKey3: G0_ALLOC, quadReadingKey4: DISK, readingFormats: formats }));
			for (const t of d) {
				const text = t.text.replace(/\s+/gu, "");
				const unit = /(KB|MB|GB|TB|B)$/.exec(text)?.[1];
				if (unit === undefined || !/^[\d.-]/.test(text)) continue;
				const value = text.slice(0, -unit.length);
				assert.ok(value === "" || PLAIN.test(value), `${layout}: ${t.text}`);
			}
		}
	});

	it("Gadget-style missing statistics keep the placeholder, the source unit and N/A, byte for byte", () => {
		for (const mode of ["min", "max", "avg"] as const) {
			const plain = key({ readingKey: NO_STATS, statMode: mode });
			assert.equal(key({ readingKey: NO_STATS, statMode: mode, readingFormats: { [NO_STATS]: GB2 } }), plain, mode);
			assert.ok(words(plain).includes("N/A") && words(plain).includes("MB"));
		}
	});

	it("a saved reading HWiNFO no longer lists shows Sensor missing, format or not; the format returns with it", () => {
		const gone: SensorSnapshot = { ...snapshot, readings: snapshot.readings.filter((r) => r.key !== G1), byKey: new Map([...snapshot.byKey].filter(([k]) => k !== G1)) };
		const goneStatus: PollerStatus = { state: "ok", snapshot: gone, source: "shared-memory" };
		for (const layout of [{}, { keyLayout: "dual", secondaryReadingKey: G0 }]) {
			const base = { readingKey: G1, ...layout } as ReadingSettings;
			assert.equal(key({ ...base, readingFormats: { [G1]: GB2 } }, goneStatus), key(base, goneStatus));
		}
		assert.equal(dial({ readingKey: G1, readingFormats: { [G1]: GB2 } }, sessionStats(), {}, goneStatus), dial({ readingKey: G1 }, sessionStats(), {}, goneStatus));
		assert.ok(words(key({ readingKey: G1, readingFormats: { [G1]: GB2 } })).includes("12.10"), "back in the snapshot, back in its format");
	});

	it("an entry only for another reading, or a junk one, changes nothing", () => {
		const base: ReadingSettings = { readingKey: G1, keyLayout: "dual", secondaryReadingKey: G0 };
		const plain = key(base);
		assert.equal(key({ ...base, readingFormats: { [TEMP]: GB2 } }), plain);
	});

	it("a GiB on an MB reading draws the true GiB, its stats with it (issue #59)", () => {
		const w = words(key({ readingKey: G1, readingFormats: { [G1]: { unit: "GiB", decimals: "2" } } }));
		assert.ok(w.includes("11.82") && w.includes("GiB"), w.join(" | "));
		const max = words(key({ readingKey: G1, statMode: "max", readingFormats: { [G1]: { unit: "GiB", decimals: "2" } } }));
		assert.ok(max.some((t) => /GiB/.test(t)) && !max.some((t) => /\bGB\b/.test(t)), max.join(" | "));
	});

	it("a confirmed alias spelling finds the entry filed under the provider key", () => {
		const live = snapshot.byKey.get(G1) as Reading;
		const alias: Reading = { ...live, key: "g2:alias", linkedKeys: ["g2:alias", G1], aliasOf: G1 };
		const snap: SensorSnapshot = { ...snapshot, byKey: new Map([...snapshot.byKey, ["g2:alias", alias]]) };
		const w = words(key({ readingKey: "g2:alias", readingFormats: { [G1]: GB2 } }, { state: "ok", snapshot: snap, source: "shared-memory" }));
		assert.ok(w.includes("12.10") && w.includes("GB"), w.join(" | "));
	});
});

describe("keys: a per-reading format and a key Background together", () => {
	const LOOKS = ["glass", "tint", "outline", "clear"] as const;
	/** Every text run with its fills taken out: position, size, words. */
	const runs = (svg: string): string[] => [...svg.matchAll(/<text\b[\s\S]*?<\/text>/g)].map((m) => m[0].replace(/ fill="#[0-9A-Fa-f]{6}"/g, ""));
	const quad: ReadingSettings = { readingKey: G0, keyLayout: "quad", secondaryReadingKey: G1, quadReadingKey3: G0_ALLOC, quadReadingKey4: DISK, decimals: "2", readingFormats: { [G0]: GB2, [G1]: GB2, [G0_ALLOC]: GB2 } };
	const labeledQuad: ReadingSettings = { ...quad, quadLabels: true };
	const pinnedDual: ReadingSettings = { readingKey: G0, keyLayout: "dual", secondaryReadingKey: G1, secondaryStatMode: "max", readingFormats: { [G0]: GB2, [G1]: { unit: "MB", decimals: "0" } } };
	const cases: [string, ReadingSettings][] = [["quad", quad], ["labeled quad", labeledQuad], ["pinned dual", pinnedDual]];

	for (const font of ["tahoma", "segoe-ui"] as const) {
		it(`${font}: every look draws the formatted words where Theme draws them, over the look's own surface`, () => {
			setFaceFont(font);
			applyGlobalThemeSettings({ dataUnits: "decimal", textFont: font });
			try {
				for (const [name, settings] of cases) {
					const themed = key(settings);
					const unformatted: ReadingSettings = { ...settings, readingFormats: undefined };
					assert.match(themed, /<rect width="144" height="144" fill="#[0-9A-Fa-f]{6}"\/>/, `${name}: Theme fills the face`);
					for (const look of LOOKS) {
						const face = key({ ...settings, keyBackground: look });
						const where = `${font} ${name} on ${look}`;
						assert.notEqual(face, themed, `${where}: the look applies`);
						assert.doesNotMatch(face, /<rect width="144" height="144" fill="#[0-9A-Fa-f]{6}"\/>/, `${where}: no opaque face`);
						assert.deepEqual(runs(face), runs(themed), `${where}: the format's words, sizes and places survive the look`);
						assert.equal(withoutText(face), withoutText(key({ ...unformatted, keyBackground: look })), `${where}: the look's surface and structure survive the format`);
					}
				}
			} finally {
				setFaceFont("tahoma");
				applyGlobalThemeSettings({ dataUnits: "decimal", textFont: "tahoma" });
			}
		});
	}

	it("a fixed-unit quad on Glass and a pinned dual on Tint read as the format says", () => {
		const glassQuad = drawn(key({ ...quad, keyBackground: "glass" }));
		const cell = (text: string): Drawn | undefined => glassQuad.find((t) => t.text === text);
		for (const text of ["0.45", "12.10", "3.02"]) assert.equal(cell(text)?.size, 22, `${text}: ${JSON.stringify(glassQuad)}`);
		assert.equal(cell("12.3")?.size, 26, "the cell without a format keeps its quad text and size on Glass");
		const tintDual = words(key({ ...pinnedDual, keyBackground: "tint" }));
		const max = (snapshot.byKey.get(G1) as Reading).valueMax;
		assert.ok(tintDual.includes("0.45 GB"), tintDual.join(" | "));
		assert.ok(tintDual.includes(`${fixed(max, 0)} MB MAX`), `the pinned row's MAX in its own unit and decimals: ${tintDual.join(" | ")}`);
	});

	it("an overflowing fixed cell takes four glyphs over its unit on every look", () => {
		const settings: ReadingSettings = { readingKey: HUGE, keyLayout: "quad", secondaryReadingKey: G1, readingFormats: { [HUGE]: { unit: "B", decimals: "0" }, [G1]: GB2 } };
		for (const look of LOOKS) {
			const texts = drawn(key({ ...settings, keyBackground: look })).map((t) => t.text);
			assert.ok(texts.includes("4P") && texts.includes("B") && texts.includes("12.10"), `${look}: ${texts.join(" | ")}`);
		}
	});
});

describe("dials: per reading on every view", () => {
	it("single: value and the session low and high in the reading's format", () => {
		const stats = sessionStats();
		const s = stats.get(G1);
		assert.ok(s !== undefined);
		const w = words(dial({ readingKey: G1, readingFormats: { [G1]: GB2 } }, stats));
		assert.ok(w.some((t) => t.startsWith("12.10") && t.endsWith("GB")), w.join(" | "));
		const opts = { ...measureOptionsFrom({}), fixedUnit: "GB" as const, decimals: "2" as const, exact: true };
		assert.ok(w.includes(`▼${formatStat(s.min, "MB", opts)} ▲${formatStat(s.max, "MB", opts)} session`), w.join(" | "));
	});

	it("single: an overflowing number drops its decimals, then compacts, with its unit; stats never cut a number", () => {
		for (const font of ["tahoma", "segoe-ui"] as const) {
			setFaceFont(font);
			for (const view of [{}, { pinned: true }, { cyclePaused: true }]) {
				const svg = dial({ readingKey: HUGE, readingFormats: { [HUGE]: { unit: "B", decimals: "3" } }, autoCycleMs: "5000" } as DialSettings, sessionStats(), view);
				const w = words(svg);
				assert.ok(w.some((t) => /^\d+(\.\d+)?[kMGTPE]? ?B$/.test(t)), `${font}: ${w.join(" | ")}`);
				assert.ok(!w.some((t) => t.includes("…")), `${font}: ${w.join(" | ")}`);
				const statsLine = w.find((t) => t.startsWith("▼")) ?? "";
				for (const token of statsLine.split(/\s+/).filter((t) => /^[▼▲]/.test(t))) {
					assert.match(token, /^[▼▲]-?\d+(\.\d+)?[kMGTPE]?B$/, `${font}: ${statsLine}`);
				}
			}
		}
		setFaceFont("tahoma");
	});

	it("single: a long stats line drops its tag, then both numbers' decimals", () => {
		const svg = dial({ readingKey: G1, readingFormats: { [G1]: { unit: "KB", decimals: "3" } } }, sessionStats(), { pinned: true });
		const statsLine = words(svg).find((t) => t.startsWith("▼")) ?? "";
		assert.match(statsLine, /^▼\d+KB ▲\d+KB$/, statsLine);
		assert.ok(!statsLine.includes("…"), statsLine);
	});

	it("rotation: each reading keeps its format as the dial turns and back", () => {
		const formats = { [G1]: GB2 };
		const first = words(dial({ readingKey: G1, rotationKeys: [G0, G1, TEMP], readingFormats: formats }));
		const other = words(dial({ readingKey: G0, rotationKeys: [G0, G1, TEMP], readingFormats: formats }));
		const back = words(dial({ readingKey: G1, rotationKeys: [G0, G1, TEMP], readingFormats: formats }));
		assert.deepEqual(first, back);
		assert.ok(first.some((t) => t.startsWith("12.10")));
		assert.ok(other.some((t) => t.startsWith("453")), "the other reading stays Auto");
		assert.ok(other.some((t) => /▼\d+MB/.test(t)), "and its stats follow its own (Auto) format");
	});

	for (const dialView of ["tworow", "overview"] as const) {
		it(`${dialView}: only the formatted row changes; the footer follows the selection`, () => {
			const base: DialSettings = { dialView, readingKey: G1, rotationKeys: dialView === "tworow" ? [G0, G1] : [G0, G1, TEMP] };
			const plain = words(dial(base));
			const formatted = words(dial({ ...base, readingFormats: { [G1]: GB2 } }));
			assert.ok(formatted.includes("12.10"), formatted.join(" | "));
			assert.ok(plain.includes("453") && formatted.includes("453"), `GPU0's row is unchanged: ${plain.join(" | ")}`);
			if (dialView === "overview") assert.ok(plain.includes("61.3") && formatted.includes("61.3"), "the temperature row is unchanged");
			assert.ok(formatted.some((t) => /▼ ?\d+\.\d\dGB ▲ ?\d+\.\d\dGB/.test(t)), `footer in GB/2: ${formatted.join(" | ")}`);
			const onG0 = words(dial({ ...base, readingKey: G0, readingFormats: { [G1]: GB2 } }));
			assert.ok(!onG0.some((t) => /▼ ?\d+\.\d\dGB/.test(t)), `GPU0 selected: Auto stats ${onG0.join(" | ")}`);
		});
	}

	it("two rows with different units share the columns", () => {
		const w = words(dial({ dialView: "tworow", readingKey: G0, rotationKeys: [G0, G1], readingFormats: { [G0]: GB2, [G1]: { unit: "MB", decimals: "1" } } }));
		assert.ok(w.includes("0.45") && w.includes("GB") && w.includes("12100.0") && w.includes("MB"), w.join(" | "));
	});

	it("rows that cannot hold the number draw it compacted", () => {
		const w = words(dial({ dialView: "overview", readingKey: G1, rotationKeys: [HUGE, G1, TEMP], readingFormats: { [HUGE]: { unit: "B", decimals: "3" } } }));
		assert.ok(w.includes("4.00P") && w.includes("B"), w.join(" | "));
		for (const t of w) assert.ok(!/(^|\d)…/.test(t), t);
	});

	it("composing never touches the session statistics", () => {
		const stats = sessionStats();
		const before = JSON.stringify([G0, G1, TEMP].map((k) => stats.get(k)));
		dial({ readingKey: G1, readingFormats: { [G1]: GB2 } }, stats);
		dial({ dialView: "overview", readingKey: G1, rotationKeys: [G0, G1, TEMP], readingFormats: { [G1]: { unit: "TB" } } }, stats);
		assert.equal(JSON.stringify([G0, G1, TEMP].map((k) => stats.get(k))), before);
	});
});

describe("detail tiles and the Back tile follow the opener", () => {
	function state(presentation: Record<string, unknown>, primaryKey = G1): DeviceDetailState {
		return {
			deviceId: "dev1",
			pageSize: 11,
			density: 1,
			tilePlan: [],
			primaryKey,
			groupSettings: { readingKey: primaryKey },
			presentation: presentation as DeviceDetailState["presentation"],
			group: { mode: "source", primaryKey, title: "GPU", keys: [G0, G1] },
			offset: 0,
			statModes: new Map(),
			surfaceCount: 1,
			pending: false,
			dispatchedAt: 0,
			openerCell: null,
			mirrorSlotIndex: null
		};
	}
	function ctx(presentation: Record<string, unknown>): DetailFaceContext {
		const config = loadThemes();
		return { config, deckThemeId: config.defaultTheme, typeAccents: true, measure: measureOptionsFrom(presentation), text: effectiveTextFor(presentation) };
	}

	it("a tile for a reading the opener formats draws that format; other tiles keep the opener's Decimals", () => {
		const p = { decimals: "1", readingFormats: { [G1]: GB2 } };
		const s = state(p);
		assert.ok(words(composeReadingFace(s, G1, "current", ok, ctx(p))).includes("12.10"));
		assert.equal(composeReadingFace(s, G0, "current", ok, ctx(p)), composeReadingFace(state({ decimals: "1" }), G0, "current", ok, ctx({ decimals: "1" })));
	});

	it("dense tiles resolve per cell, the quad by the quad rule", () => {
		const p = { readingFormats: { [G1]: GB2, [G0]: { unit: "MB", decimals: "0" } } };
		const dual = words(composeChunkFace(state(p), [G0, G1], "current", ok, ctx(p)));
		assert.ok(dual.some((t) => t.startsWith("453") && t.endsWith("MB")) && dual.some((t) => t.startsWith("12.10")), dual.join(" | "));
		const quad = drawn(composeChunkFace(state(p), [G0, G1, G0_ALLOC, DISK], "max", ok, ctx(p)));
		assert.ok(quad.some((t) => t.text === "16.30" && t.size <= 22), JSON.stringify(quad));
	});

	it("a dense tile of two readings with their own formats draws both at one size, as the key does", () => {
		const p = { readingFormats: { [G1]: GB2, [G0]: GB2 } };
		const sizes = drawn(composeChunkFace(state(p), [G1, G0], "current", ok, ctx(p))).filter((d) => /^\d+\.\d\d\b/.test(d.text)).map((d) => d.size);
		assert.equal(sizes.length, 2, JSON.stringify(sizes));
		assert.equal(sizes[0], sizes[1], JSON.stringify(sizes));
	});

	it("the unconfigured Back fallback equals the Back tile with a format present", () => {
		for (const p of [{ readingFormats: { [G1]: GB2 } }, { decimals: "3", readingFormats: { [G1]: { unit: "TB" } } }, { readingFormats: { [G1]: { unit: "B", decimals: "3" } } }, { readingFormats: { [TEMP]: GB2 } }]) {
			const s = state(p);
			assert.equal(compose(backFallbackSettings(s), ok, true), composeBackFace(s, ok, ctx(p)), JSON.stringify(p));
		}
		assert.ok(words(composeBackFace(state({ readingFormats: { [G1]: GB2 } }), ok, ctx({}))).includes("12.10"));
	});

	it("a tile for a reading the opener has no entry for stays byte-identical", () => {
		const p = { readingFormats: { [TEMP]: GB2 } };
		assert.equal(composeChunkFace(state(p), [G0, NET_DL], "current", ok, ctx(p)), composeChunkFace(state({}), [G0, NET_DL], "current", ok, ctx({})));
	});
});

describe("alerts, gauges and their captured units never move", () => {
	const limits: ReadingSettings = { warnValue: "10000", critValue: "12000" };
	const rules = { alertRules: { [G1]: { warn: 10000, crit: 12050, unit: "MB" } } };

	it("the key's alert view and panel units are the same with and without a format", () => {
		for (const extra of [limits, rules, { ...limits, ...rules }]) {
			for (const layout of [{}, { keyLayout: "dual", secondaryReadingKey: G0 }, { keyLayout: "quad", secondaryReadingKey: G0, quadReadingKey3: TEMP }]) {
				const base = { readingKey: G1, ...extra, ...layout } as ReadingSettings;
				const formatted = { ...base, readingFormats: { [G1]: GB2, [G0]: { unit: "KB" } } } as ReadingSettings;
				assert.deepEqual(immediateKeyView(formatted, snapshot), immediateKeyView(base, snapshot));
				assert.deepEqual(keyAlertPanelOf(formatted, snapshot, immediateKeyView(formatted, snapshot)), keyAlertPanelOf(base, snapshot, immediateKeyView(base, snapshot)));
			}
		}
	});

	it("a format edit does not reset dwell or end a snooze", () => {
		const alerts = new KeyAlerts(new AlertStore());
		const settings = { readingKey: G1, warnValue: "10000", alertDwellMs: "5000" } as ReadingSettings;
		alerts.appear("k", settings, ok, 0);
		alerts.tick(ok, 1000);
		alerts.update("k", { ...settings, readingFormats: { [G1]: GB2 } } as ReadingSettings, ok, 3000);
		alerts.tick(ok, 5000);
		alerts.tick(ok, 6100);
		assert.equal(alerts.view("k").face.level, "warn", "the dwell carried through the format edit");
		const control = new KeyAlerts(new AlertStore());
		control.appear("k", settings, ok, 0);
		control.tick(ok, 1000);
		control.update("k", { ...settings, fahrenheit: true } as ReadingSettings, ok, 3000);
		control.tick(ok, 6100);
		assert.equal(control.view("k").face.level, "normal", "a °F switch still restarts it");
	});

	it("gauges, zones, bars and alert colors are the same: only the words change", () => {
		const faces: Array<[string, () => string, () => string]> = [
			["key bar", () => key({ readingKey: G1, displayMode: "bar", ...limits }), () => key({ readingKey: G1, displayMode: "bar", ...limits, readingFormats: { [G1]: GB2 } })],
			["key ring", () => key({ readingKey: G1, displayMode: "ring", ...rules }), () => key({ readingKey: G1, displayMode: "ring", ...rules, readingFormats: { [G1]: { unit: "TB" } } })],
			["dial bar", () => dial({ readingKey: G1, warnValue: "10000", critValue: "15000", barMin: "0", barMax: "16303" }), () => dial({ readingKey: G1, warnValue: "10000", critValue: "15000", barMin: "0", barMax: "16303", readingFormats: { [G1]: GB2 } })],
		];
		for (const [name, plain, formatted] of faces) {
			assert.notEqual(formatted(), plain(), `${name}: the words do change`);
			assert.equal(withoutText(formatted()), withoutText(plain()), name);
		}
	});

	it("dial rows keep their alert colors", () => {
		const fills = (svg: string): string[] => [...svg.matchAll(/<text\b[^>]*font-weight="700" fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1] as string);
		const base: DialSettings = { dialView: "overview", readingKey: G1, rotationKeys: [G0, G1, TEMP], warnValue: "10000", critValue: "12050" };
		assert.deepEqual(fills(dial({ ...base, readingFormats: { [G1]: GB2, [G0]: GB2 } })), fills(dial(base)));
	});

	it("the preview's alert units stay HWiNFO's unit (a capture never stores GB)", () => {
		const base = { readingKey: G1, warnValue: "10000" };
		for (const kind of ["key", "dial"] as const) {
			const plain = buildPreview(ok, base, kind === "key", { kind });
			const formatted = buildPreview(ok, { ...base, readingFormats: { [G1]: GB2 } }, kind === "key", { kind });
			assert.deepEqual(formatted.reading, plain.reading);
			assert.equal(formatted.reading?.unit, "MB");
			assert.deepEqual(formatted.effective?.alert, plain.effective?.alert);
			assert.deepEqual(formatted.effective?.readingAlert, plain.effective?.readingAlert);
			if (kind === "dial") assert.equal(formatted.effective?.readingAlert?.displayUnit, "MB");
		}
	});
});

describe("the panel preview formats like the face", () => {
	it("display value, unit and stats use the reading's format", () => {
		const p = buildPreview(ok, { readingKey: G1, readingFormats: { [G1]: GB2 } }, true, { kind: "key" });
		assert.equal(p.display?.value, "12.10");
		assert.equal(p.display?.unit, "GB");
		assert.equal(p.display?.stats, `min ${fixed(3.02, 2)}GB · max ${fixed(16.303, 2)}GB · avg ${fixed(9.0005, 2)}GB`);
		assert.ok(words(key({ readingKey: G1, readingFormats: { [G1]: GB2 } })).includes(p.display?.value as string));
	});

	it("an overview previews its selected row's own format", () => {
		const p = buildPreview(ok, { dialView: "overview", readingKey: G1, rotationKeys: [G0, G1, TEMP], readingFormats: { [G1]: GB2 } }, false, { kind: "dial" });
		assert.equal(p.display?.value, "12.10");
	});

	it("Gadget keeps its sentence", () => {
		const gadget: PollerStatus = { state: "ok", snapshot, source: "gadget" };
		assert.equal(buildPreview(gadget, { readingKey: G1, readingFormats: { [G1]: GB2 } }, true, { kind: "key" }).display?.stats, "Historical statistics unavailable in Gadget");
	});

	it("reports the readings the face draws past their exact text, what it draws and what would fit", () => {
		const settings = { readingKey: G1, keyLayout: "quad", secondaryReadingKey: HUGE, readingFormats: { [G1]: GB2, [HUGE]: { unit: "B", decimals: "0" } } };
		assert.deepEqual(buildPreview(ok, settings, true, { kind: "key" }).effective?.formatFallback, [{ key: HUGE, shows: "4P B", fits: { unit: "TB", decimals: "0" } }]);
		assert.ok(words(key(settings as ReadingSettings)).includes("4P"));
		assert.deepEqual(buildPreview(ok, { ...settings, readingFormats: { [G1]: GB2 } }, true, { kind: "key" }).effective?.formatFallback, []);
		assert.equal(buildPreview(ok, { readingKey: G1 }, true, { kind: "key" }).effective?.formatFallback, undefined, "absent without formats");
		const dialSettings = { readingKey: G1, rotationKeys: [G1, HUGE], readingFormats: { [HUGE]: { unit: "B", decimals: "3" } } };
		assert.deepEqual(
			buildPreview(ok, dialSettings, false, { kind: "dial" }).effective?.formatFallback?.map((n) => n.key),
			[HUGE],
			"a dial reports every reading it can show"
		);
	});

	it("the tree lists the fixed units a reading may take, none for others", () => {
		const tree = buildSensorTree(ok);
		const row = (k: string): { units?: string[] } | undefined => tree.groups.flatMap((g) => g.readings).find((r) => r.key === k);
		assert.deepEqual(row(G1)?.units, ["B", "KB", "MB", "GB", "TB", "KiB", "MiB", "GiB", "TiB"]);
		assert.equal(row(NET_DL)?.units, undefined);
		assert.equal(row(TEMP)?.units, undefined);
	});
});

describe("the panel note, detail tiles and quad sizes agree with the face", () => {
	/** Whether the face draws this exact value text (a value line starting with it). */
	const drawsExact = (w: string[], valueText: string): boolean => w.some((t) => t === valueText || t.startsWith(`${valueText} `) || new RegExp(`^${valueText.replace(/\./g, "\\.")}[A-Za-z]`).test(t));

	it("a dual key's pinned Row 2 is measured at its own stat, as the face draws it", () => {
		const base = { readingKey: G1, secondaryReadingKey: G0, keyLayout: "dual", readingFormats: { [G0]: { unit: "B", decimals: "2" } } };
		const pinned = { ...base, secondaryStatMode: "max" } as ReadingSettings;
		const max = (snapshot.byKey.get(G0) as Reading).valueMax;
		assert.ok(!drawsExact(words(key(pinned)), fixed(max * 1e6, 2)), `the face draws the pinned MAX past its exact text: ${words(key(pinned)).join(" | ")}`);
		assert.deepEqual(buildPreview(ok, pinned, true, { kind: "key" }).effective?.formatFallback, [{ key: G0, shows: `${fixed(max * 1e6, 0)} B`, fits: { unit: "KB", decimals: "2" } }]);
		assert.ok(words(key(pinned)).some((t) => t.startsWith(fixed(max * 1e6, 0))), "the note says what the face draws");
		assert.ok(drawsExact(words(key(base as ReadingSettings)), fixed(v(G0) * 1e6, 2)), "unpinned, Row 2 draws the live value whole");
		assert.deepEqual(buildPreview(ok, base, true, { kind: "key" }).effective?.formatFallback, []);
		// The pin is Row 2's alone: the first row keeps the key's stat.
		const firstRow = { readingKey: G0, secondaryReadingKey: G1, keyLayout: "dual", secondaryStatMode: "max", readingFormats: { [G0]: { unit: "B", decimals: "2" } } };
		assert.ok(drawsExact(words(key(firstRow as ReadingSettings)), fixed(v(G0) * 1e6, 2)));
		assert.deepEqual(buildPreview(ok, firstRow, true, { kind: "key" }).effective?.formatFallback, []);
		// A junk pin follows the first row, on the face and in the note.
		const junk = { ...base, secondaryStatMode: "peak" };
		assert.equal(key(junk as unknown as ReadingSettings), key(base as ReadingSettings));
		assert.deepEqual(buildPreview(ok, junk, true, { kind: "key" }).effective?.formatFallback, []);
	});

	it("a dial is measured at the stat the face draws after a tap (MIN, MAX, AVG)", () => {
		// The session saw GPU0's free memory at 12100 MB; it reads 453 now.
		const highReadings = snapshot.readings.map((r) => (r.key === G0 ? { ...r, value: 12100 } : r));
		const high: SensorSnapshot = { ...snapshot, readings: highReadings, byKey: new Map(highReadings.map((r) => [r.key, r])) };
		const stats = new SessionStatsStore();
		for (const snap of [high, snapshot]) for (const r of snap.readings) stats.observe(r, snap, "shared-memory");
		const dialStats = (mode: StatMode): { mode: StatMode; stats: (k: string) => ReturnType<SessionStatsStore["get"]> } => ({ mode, stats: (k: string) => stats.get(k) });
		let disagreed = 0;
		for (const unit of ["B", "KB"]) {
			for (const decimals of ["0", "1", "2", "3"]) {
				for (const dialView of ["single", "overview"] as const) {
					for (const mode of ["current", "min", "max", "avg"] as const) {
						const settings = { dialView, readingKey: G0, rotationKeys: [G0, G1, TEMP], readingFormats: { [G0]: { unit, decimals } } } as DialSettings;
						const w = words(dial(settings, stats, { statMode: mode }));
						const s = stats.get(G0);
						const shown = mode === "current" || s === undefined ? v(G0) : mode === "min" ? s.min : mode === "max" ? s.max : s.sum / s.count;
						const exactText = fixed((shown * 1e6) / (unit === "B" ? 1 : 1e3), Number(decimals));
						const facePast = !drawsExact(w, exactText);
						const notes: FormatFallback[] = buildPreview(ok, settings, false, { kind: "dial", dialStats: dialStats(mode) }).effective?.formatFallback ?? [];
						const note = notes.find((n: FormatFallback) => n.key === G0);
						assert.equal(note !== undefined, facePast, `${unit}/${decimals} ${dialView} ${mode}: ${w.join(" | ")}`);
						if (note !== undefined) assert.ok(w.some((t) => t.replace(/ · .*$/, "").replace(/\s+/g, "") === note.shows.replace(/\s+/g, "") || t === note.shows.split(" ")[0]), `the note's text is on the face: ${note.shows} / ${w.join(" | ")}`);
						const live = (buildPreview(ok, settings, false, { kind: "dial" }).effective?.formatFallback ?? []).some((n) => n.key === G0);
						if (live !== facePast) disagreed++;
					}
				}
			}
		}
		assert.ok(disagreed > 0, "the live value alone would miss some of these");
		// The case the council found: KB at 2 decimals, MAX after a tap.
		const kb2 = { readingKey: G0, readingFormats: { [G0]: { unit: "KB", decimals: "2" } } } as DialSettings;
		assert.ok(!drawsExact(words(dial(kb2, stats, { statMode: "max" })), fixed(12100 * 1e3, 2)));
		assert.deepEqual(
			buildPreview(ok, kb2, false, { kind: "dial", dialStats: dialStats("max") }).effective?.formatFallback?.map((n) => n.key),
			[G0]
		);
		assert.deepEqual(buildPreview(ok, kb2, false, { kind: "dial", dialStats: dialStats("current") }).effective?.formatFallback, []);
	});

	it("detail entry carries an entry filed under a linked spelling; key, tiles and Back agree", async () => {
		const OLD = "g2:old-spelling";
		const live = snapshot.byKey.get(G1) as Reading;
		const linked: Reading = { ...live, linkedKeys: [G1, OLD] };
		const readings = snapshot.readings.map((r) => (r.key === G1 ? linked : r));
		const snap: SensorSnapshot = { ...snapshot, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
		const status: PollerStatus = { state: "ok", snapshot: snap, source: "shared-memory" };
		type EnterSettings = Parameters<DetailNavigator["enter"]>[0]["settings"];
		const navigator = (): DetailNavigator => new DetailNavigator({ switchProfile: () => Promise.resolve(), setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimer: () => undefined, now: () => 1_000_000 });
		const opener = { readingKey: G1, readingFormats: { [OLD]: GB2, "g2:another-reading": { unit: "TB" } } } as ReadingSettings;
		const keyWords = words(key(opener, status));
		assert.ok(keyWords.includes("12.10") && keyWords.includes("GB"), keyWords.join(" | "));
		const nav = navigator();
		assert.equal(await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener as EnterSettings, snapshot: snap }), "entered");
		const s = nav.stateFor("dev1") as DeviceDetailState;
		assert.deepEqual(s.presentation.readingFormats, { [OLD]: GB2 }, "only what the key itself can find");
		const c: DetailFaceContext = { config: loadThemes(), deckThemeId: loadThemes().defaultTheme, typeAccents: true, measure: measureOptionsFrom(opener), text: effectiveTextFor(opener) };
		assert.ok(words(composeReadingFace(s, G1, "current", status, c)).includes("12.10"), "the tile");
		assert.ok(words(composeBackFace(s, status, c)).includes("12.10"), "the Back tile");
		assert.ok(words(compose(backFallbackSettings(s), status, true)).includes("12.10"), "the Back fallback");
		// Both spellings filed: the first entry in the reading's walk decides, on the key and on the Back tile alike.
		const both = { readingKey: G1, readingFormats: { [G1]: GB2, [OLD]: { unit: "TB" } } } as ReadingSettings;
		const nav2 = navigator();
		await nav2.enter({ deviceId: "dev1", deviceType: 0, settings: both as EnterSettings, snapshot: snap });
		const s2 = nav2.stateFor("dev1") as DeviceDetailState;
		assert.deepEqual(s2.presentation.readingFormats, { [G1]: GB2, [OLD]: { unit: "TB" } });
		assert.ok(words(key(both, status)).includes("12.10") && words(composeBackFace(s2, status, c)).includes("12.10"));
		assert.equal(composeBackFace(s2, status, c), compose(backFallbackSettings(s2), status, true));
	});

	it("quad: a cell whose exact text needs less than 18 px drops its decimals at its own size and leaves the others at theirs", () => {
		const both: ReadingSettings = { readingKey: G1, keyLayout: "quad", secondaryReadingKey: G0, readingFormats: { [G1]: { unit: "MB", decimals: "3" }, [G0]: GB2 } };
		const d = drawn(key(both));
		assert.ok(!d.some((t) => t.text === fixed(v(G1), 3)), `12100.000 never draws under 18 px: ${JSON.stringify(d)}`);
		const longCell = d.find((t) => t.text === fixed(v(G1), 0));
		const shortCell = d.find((t) => t.text === "0.45");
		assert.ok(longCell !== undefined && shortCell !== undefined, JSON.stringify(d));
		assert.ok(longCell.size >= 16 && longCell.size < (shortCell.size as number), `the long cell takes its own size: ${longCell.size}`);
		const alone = drawn(key({ ...both, readingFormats: { [G0]: GB2 } })).find((t) => t.text === "0.45");
		assert.equal(shortCell.size, alone?.size, "the short cell keeps the size it has alone");
		assert.ok(shortCell.size >= 18);
		// Cells that fit at 18 px or more still share the smallest of them.
		const shared = drawn(key({ readingKey: G1, keyLayout: "quad", secondaryReadingKey: G0, readingFormats: { [G1]: GB2, [G0]: GB2 } }));
		assert.equal(shared.find((t) => t.text === "12.10")?.size, shared.find((t) => t.text === "0.45")?.size);
		assert.equal(shared.find((t) => t.text === "12.10")?.size, 22);
	});
});

describe("the pages say what a reading's format draws", () => {
	const page = (name: string): string => fs.readFileSync(fileURLToPath(new URL(`../docs/${name}`, import.meta.url)), "utf8");

	/** The ok status with one reading at another value. */
	const withValue = (readingKey: string, value: number): PollerStatus => {
		const readings = snapshot.readings.map((r) => (r.key === readingKey ? { ...r, value } : r));
		return { state: "ok", snapshot: { ...snapshot, readings, byKey: new Map(readings.map((r) => [r.key, r])) }, source: "shared-memory" };
	};

	it("docs/sensor-reading.md: two formatted values share one size, and both step down when one of them needs it", () => {
		// The value lines: a dual key's labels draw at 16 px and under.
		const valueSizes = (mb: number): number[] => drawn(key({ readingKey: G1, keyLayout: "dual", secondaryReadingKey: G0, readingFormats: { [G0]: GB2, [G1]: GB2 } }, withValue(G1, mb))).filter((d) => d.size > 16).map((d) => d.size);
		const below = valueSizes(9990);
		const above = valueSizes(10000);
		assert.equal(below.length, 2, JSON.stringify(below));
		assert.equal(below[0], below[1], `9.99 GB over 0.45 GB: ${JSON.stringify(below)}`);
		assert.equal(above[0], above[1], `10.00 GB over 0.45 GB: ${JSON.stringify(above)}`);
		assert.ok((above[0] as number) < (below[0] as number), `0.45 GB steps down with the other value at 10.00 GB: ${JSON.stringify(below)} then ${JSON.stringify(above)}`);
		const line = /^On a two-reading key where both readings have their own format\b.*$/m.exec(page("sensor-reading.md"))?.[0];
		assert.ok(line, "docs/sensor-reading.md says how a two-reading key sizes two formats");
		assert.doesNotMatch(line, /neither changes size/, `docs/sensor-reading.md says "${line}", but both values change size together when one reaches 10.00 GB`);
		assert.match(line, /when one value needs a smaller size both take it/, `docs/sensor-reading.md "${line}"`);
	});

	it("docs/thresholds-alerts.md: KB to TB rescale HWiNFO's number, KiB to TiB read it as 1024-based", () => {
		// 12,100 MB: 12.10 GB in thousands, 11.82 GiB as 12100 / 1024.
		assert.ok(words(key({ readingKey: G1, readingFormats: { [G1]: GB2 } })).includes("12.10"));
		assert.ok(words(key({ readingKey: G1, readingFormats: { [G1]: { unit: "GiB", decimals: "2" } } })).includes("11.82"));
		const paragraph = /^A fixed unit under \[Unit and decimals per reading\].*$/m.exec(page("thresholds-alerts.md"))?.[0];
		assert.ok(paragraph, "docs/thresholds-alerts.md says how a fixed unit meets the limits");
		assert.doesNotMatch(paragraph, /does not reinterpret|not GiB/, "docs/thresholds-alerts.md says the face never reinterprets HWiNFO's number, but GiB reads 12,100 MB as 11.82 GiB");
		assert.match(paragraph, /KB to TB rescale HWiNFO's number by 1000 per step/, paragraph);
		assert.match(paragraph, /KiB to TiB read HWiNFO's MB and GB as the 1024-based units they are/, paragraph);
	});
});
