/**
 * Proposed additions to test/face-font.test.ts (describe "Tahoma, the default
 * face"): every fit reads measured ink against the edge a person sees, and a
 * line 1.6.0 drew whole and clean keeps that drawing. Each case is a face the
 * review rendered through the app's QtSvg 6.9.3: 1.6.0 drew it whole and
 * clean, the 1.7 candidate cut it, stepped it down or ran it into the lens.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compose } from "../src/actions/sensor-reading";
import type { Reading, SensorSnapshot } from "../src/hwinfo/types";
import { setFaceFont } from "../src/ui/face-font";
import { renderDetailTitleKey } from "../src/ui/detail-renderer";
import { footerFits, renderDial, renderDialOverview, renderDialTwoRow, wideValueFit } from "../src/ui/dial-renderer";
import { renderDualKey, renderQuadKey, renderReadingKey, renderStatusKey, renderTripleKey } from "../src/ui/key-renderer";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const VOID = resolvePalette(loadThemes(), "void", null, "normal");
type Drawn = { x: number; y: number; size: number; text: string; raw: string };
const drawn = (svg: string): Drawn[] =>
	[...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="(\d+)"[^>]*>(.*?)<\/text>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), size: Number(m[3]), text: (m[4] as string).replace(/<[^>]+>/g, ""), raw: m[4] as string }));
const at = (svg: string, y: number, x?: number): Drawn => {
	const t = drawn(svg).find((d) => d.y === y && (x === undefined || d.x === x));
	assert.ok(t, `no text at y=${y} in ${svg}`);
	return t;
};
const single = (label: string, valueText = "56.3", unitText = "°C"): string => renderReadingKey({ label, valueText, unitText, statBadge: "", palette: VOID });
const row = (label: string, valueText: string, unitText: string, statBadge = "") => ({ label, valueText, unitText, statBadge });
const orow = (label: string, valueText: string, unitText: string, selected = false) => ({ label, valueText, unitText, selected, valueColor: "#FFFFFF" });

describe("Tahoma fits read measured ink against the edge a person sees", () => {
	it("accented Latin titles keep the text and size 1.6.0 drew", () => {
		setFaceFont("tahoma");
		assert.deepEqual([at(single("Użycie pamięci"), 32).text, at(single("Użycie pamięci"), 32).size], ["Użycie pamięci", 16]);
		assert.equal(at(single("Hőmérséklet"), 32).size, 18);
	});

	it("a title takes a larger size only where the lens shows its ink or 1.6.0 drew it there", () => {
		setFaceFont("tahoma");
		assert.equal(at(single("AMD Ryzen 9"), 32).size, 18, "20 px ran ink to x=6..137; 1.6.0 drew 18");
		assert.equal(at(single("CPU Package"), 32).size, 20, "1.6.0 drew it at 20");
		assert.deepEqual([at(single("Total CPU Usage"), 32).text, at(single("Total CPU Usage"), 32).size], ["Total CPU Usage", 16]);
	});

	it("a single value keeps 1.6.0's size while it draws there as 1.6.0 did", () => {
		setFaceFont("tahoma");
		assert.equal(at(single("+12V", "12.096", "V"), 94).size, 36);
		assert.equal(at(single("Count", "99999", ""), 94).size, 40);
		assert.equal(at(single("Used", "5462.4", ""), 94).size, 34, "at 36 its ink crossed x=133 in 1.6.0 too");
	});

	it("status lines fit the lens, and a Back tile's sub-line clears the return hook", () => {
		setFaceFont("tahoma");
		const face = (lines: string[], returnMark = false): string => renderStatusKey({ icon: "clock", accent: "#f5a623", lines, returnMark });
		assert.equal(at(face(["Age unknown", "check Gadget"]), 100).size, 18);
		assert.equal(at(face(["Not updating", "check sharing"]), 100).size, 19);
		assert.equal(at(face(["Access denied", "open settings"], true), 122).x, 85);
		assert.equal(at(face(["Access denied", "open settings"]), 122).x, 72);
	});

	it("a pinned row's badge rides its label line only where that line stays in the lens; else 1.6.0's value line", () => {
		setFaceFont("tahoma");
		const svg = renderDualKey({ top: row("CPU Package", "88.9", "°C", "MAX"), bottom: row("CPU Fan", "1785", "RPM"), palette: VOID });
		assert.equal(at(svg, 22).text, "CPU Package");
		assert.equal(at(svg, 22).size, 15);
		assert.match(at(svg, 56).text, /88\.9\s*°C\s*MAX$/);
		const short = renderDualKey({ top: row("CPU Fan", "2210", "RPM", "MAX"), bottom: row("CPU", "56.3", "°C"), palette: VOID });
		assert.match(at(short, 22).text, /^CPU Fan\s+MAX$/);
	});

	it("two-reading values keep 1.6.0's size and unit wherever the line draws as 1.6.0 did", () => {
		setFaceFont("tahoma");
		const value = (top: ReturnType<typeof row>): Drawn => at(renderDualKey({ top, bottom: row("CPU", "56.3", "°C"), palette: VOID }), 56);
		assert.equal(value(row("Read", "1011", "MiB/s")).size, 32);
		assert.equal(value(row("Core 0 Clock", "98765432.00", "MHz")).text, "98765432.00MHz");
		assert.ok(value(row("Flow", "98765432", "m³/h")).size >= 14, "never under the 14 px floor");
	});

	it("a shared badge reads N/A only when no row has the stat, and a same-stat pin shares the divider badge", () => {
		setFaceFont("tahoma");
		const glitch: Reading = { key: "g:0:1", sensorIndex: 0, id: 1, label: "Sensor glitch", type: 1, unit: "°C", value: Number.NaN, valueMin: Number.NaN, valueMax: Number.NaN, valueAvg: Number.NaN };
		const gpu: Reading = { key: "g:0:2", sensorIndex: 0, id: 2, label: "GPU Power", type: 5, unit: "W", value: 316.4, valueMin: 22.7, valueMax: 349, valueAvg: 210.8 };
		const snapshot: SensorSnapshot = { pollTime: 1, valueRevision: 1, version: 1, revision: 0, sensors: [{ index: 0, id: 1, instance: 0, name: "GPU" }], readings: [glitch, gpu], byKey: new Map([[glitch.key, glitch], [gpu.key, gpu]]) };
		const ok = { state: "ok" as const, source: "shared-memory" as const, snapshot };
		const divider = (svg: string): string => at(svg, 76).text;
		assert.equal(divider(compose({ readingKey: glitch.key, secondaryReadingKey: gpu.key, keyLayout: "dual", statMode: "max" }, ok)), "MAX");
		const pinnedSame = compose({ readingKey: gpu.key, secondaryReadingKey: gpu.key, keyLayout: "dual", statMode: "max", secondaryStatMode: "max" }, ok);
		assert.equal(divider(pinnedSame), "MAX");
		assert.doesNotMatch(pinnedSame, /<tspan font-size="12" font-weight="700"[^>]*>\s*MAX<\/tspan>/);
	});

	it("three-row labels keep a measured clear gap to their value instead of a 5 px advance gap", () => {
		setFaceFont("tahoma");
		const labels = (rows: Array<ReturnType<typeof row>>): string[] => drawn(renderTripleKey({ rows, palette: VOID })).filter((d) => d.x === 12).map((d) => `${d.text}@${d.size}`);
		assert.equal(labels([row("CPU Package Power", "253", "W"), row("GPU Power", "349", "W"), row("Total System Power", "1950", "W")])[1], "GPU Power@12");
		assert.deepEqual(labels([row("CCD1", "66.9", "°C"), row("CCD2", "64.1", "°C"), row("Core Max", "71.4", "°C")]), ["CCD1@15", "CCD2@15", "Core Max@13"]);
	});

	it("three-row values keep 1.6.0's 16 px where Tahoma's chunk is up to 94 px", () => {
		setFaceFont("tahoma");
		const svg = renderTripleKey({ rows: [row("CPU Package", "56.3", "°C"), row("CPU Package", "56.3", "°C"), row("CPU Fan", "1785.0", "RPM")], palette: VOID });
		assert.ok(drawn(svg).filter((d) => d.x === 132).every((d) => d.size === 16));
	});

	it("a quad micro-label draws at 14 px wherever its ink stays inside the cell's lens side", () => {
		setFaceFont("tahoma");
		const cell = (label: string) => ({ label, valueText: "56", unitText: "°C", color: "#4CC2FF" });
		const svg = renderQuadKey({ cells: [cell("CPU"), cell("QWQW"), cell("QWQW"), cell("WWWW")], labels: true, palette: VOID });
		assert.equal(at(svg, 20, 108).size, 14);
		assert.equal(at(svg, 92, 108).size, 12, "four W's would cross x=133 at 14");
	});

	it("a detail title wraps by its lines' ink, so 1.6.0's two whole lines stay whole", () => {
		setFaceFont("tahoma");
		const lines = (title: string): string[] => drawn(renderDetailTitleKey({ title, rangeText: "1-11 / 58", palette: VOID, text: { label: "#FFF", unit: "#AAA" } } as never)).filter((d) => d.size === 16).map((d) => d.text);
		assert.deepEqual(lines("CPU [#0]: AMD Ryzen 9 7950X"), ["CPU [#0]: AMD", "Ryzen 9 7950X"]);
		assert.deepEqual(lines("*Temperature*"), ["*Temperature*"]);
	});

	it("single-dial lines end by the slot's last visible column: value, stats and title keep 1.6.0's size", () => {
		setFaceFont("tahoma");
		const dial = (title: string, valueText: string, unitText: string, statsText: string): string => renderDial({ title, valueText, unitText, statsText, fraction: 0.5, palette: VOID, barColor: VOID.accent });
		assert.equal(at(dial("CPU Fan", "2210", "RPM · MAX", ""), 58).size, 34);
		assert.equal(at(dial("Current UP rate", "312", "KiB/s", "▼0.00B/s ▲1.14MiB/s session"), 78).size, 12);
		assert.equal(at(dial("GPU HOTSPOT TEMP", "78.5", "°C", ""), 24).text, "GPU HOTSPOT TEMP");
		assert.equal(at(dial("İşlemci Sıcaklığı", "56.3", "°C", ""), 24).text, "İşlemci Sıcaklığı");
	});

	it("three-row dials keep 1.6.0's context name size, row labels and value size", () => {
		setFaceFont("tahoma");
		const ctx = renderDialOverview({ rows: [orow("Load", "41.8", "%", true), orow("Used", "23.5", "GB"), orow("Available", "41.2", "GB")], contextText: "Physical Memory", statsText: "▼39.2 ▲77.1", palette: VOID });
		assert.equal(at(ctx, 11, 2).size, 13);
		const rows = renderDialOverview({ rows: [orow("CPU Package", "56.3", "°C", true), orow("CPU Fan", "1785", "RPM"), orow("Package Power", "142", "W")], contextText: "", statsText: "▼41.2 ▲88.9", palette: VOID });
		assert.ok(drawn(rows).some((d) => d.text === "PACKAGE POWER"));
		assert.equal(wideValueFit(["123456789"]).size, 18);
	});

	it("two-row dials keep the footer and wrapped labels 1.6.0 drew whole", () => {
		setFaceFont("tahoma");
		const footer = renderDialTwoRow({ rows: [orow("Load", "41.8", "%", true), orow("Used", "640", "RPM")], footerText: "▼640 ▲2210 MAX · Процессор", palette: VOID });
		assert.equal(at(footer, 96).text, "▼640 ▲2210 MAX · Процессор");
		const labels = renderDialTwoRow({ rows: [orow("GPU Memory Junction Temperature", "924", "°C", true), orow("Pump", "125k", "RPM")], footerText: "", palette: VOID });
		assert.equal(at(labels, 40, 12).text, "Temperature");
		// The dial action picks the roomy footer by the same ink test; the
		// candidate's 188 px estimate (199.2 here) chose the tight one.
		assert.equal(footerFits("▼ 41.2  ▲ 88.9  MAX  · Processor"), true);
	});
});
