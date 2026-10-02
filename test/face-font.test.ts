/**
 * The deck-wide Text font. Tahoma is the default because every release
 * through 1.6.0 drew Tahoma Bold on the device (the app's QtSvg read the old
 * "Segoe UI, Arial, sans-serif" list as one unknown family and fell back to
 * it); Segoe UI is the option. These tests hold what a person sees: the
 * family each face names, the 1.6.0 title sizes, labels kept clear of their
 * values, and a stored choice that only the exact value can change.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { faceFont, parseFaceFont, setFaceFont } from "../src/ui/face-font";
import { estimateKeyTextWidth } from "../src/ui/format";
import { renderDialOverview, renderDialTwoRow } from "../src/ui/dial-renderer";
import { renderDetailTitleKey } from "../src/ui/detail-renderer";
import { renderDualKey, renderQuadKey, renderReadingKey, renderStatusKey, renderTripleKey, type TripleKeyRow } from "../src/ui/key-renderer";
import { applyGlobalThemeSettings, onThemeChange } from "../src/ui/theme-store";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const VOID = resolvePalette(loadThemes(), "void", null, "normal");

function single(label: string): string {
	return renderReadingKey({ label, valueText: "56.3", unitText: "°C", statBadge: "", palette: VOID });
}

function attr(element: string, name: string): string {
	const m = new RegExp(` ${name}="([^"]*)"`).exec(element);
	assert.ok(m, `no ${name} on ${element}`);
	return m[1] as string;
}

describe("the stored Text font", () => {
	it("is Tahoma unless the document holds exactly segoe-ui, so an upgrade writes nothing", () => {
		for (const raw of [undefined, null, "", "tahoma", "Tahoma", "segoe", "Segoe UI", "SEGOE-UI", 1, true, {}]) {
			assert.equal(parseFaceFont(raw), "tahoma", JSON.stringify(raw));
		}
		assert.equal(parseFaceFont("segoe-ui"), "segoe-ui");
	});

	it("starts as Tahoma before any settings arrive", () => {
		assert.equal(faceFont().id, "tahoma");
	});

	it("follows the deck settings and repaints only when it changes", () => {
		let repaints = 0;
		onThemeChange(() => repaints++);
		applyGlobalThemeSettings({ theme: "void" });
		const settled = repaints;
		applyGlobalThemeSettings({ theme: "void", textFont: "segoe-ui" });
		assert.equal(faceFont().id, "segoe-ui");
		assert.equal(repaints, settled + 1);
		applyGlobalThemeSettings({ theme: "void", textFont: "segoe-ui" });
		assert.equal(repaints, settled + 1, "an unchanged choice does not repaint");
		applyGlobalThemeSettings({ theme: "void" });
		assert.equal(faceFont().id, "tahoma", "removing the choice returns to Tahoma");
	});
});

describe("Tahoma, the default face", () => {
	it("every text names Tahoma alone, never a family list", () => {
		setFaceFont("tahoma");
		const svg = single("CPU Package") + renderStatusKey({ icon: "power", accent: "#4cc2ff", lines: ["Start HWiNFO", "not detected"] });
		const families = [...svg.matchAll(/font-family="([^"]*)"/g)].map((m) => m[1]);
		assert.ok(families.length >= 4);
		assert.deepEqual([...new Set(families)], ["Tahoma"]);
	});

	it("keeps the 1.6.0 title sizes: CPU Package at 20 px, Total CPU Usage whole at 16", () => {
		setFaceFont("tahoma");
		const title = (label: string): string => (single(label).match(/<text x="72" y="32"[^>]*>[^<]*<\/text>/) as RegExpMatchArray)[0];
		assert.equal(attr(title("CPU Package"), "font-size"), "20");
		assert.match(title("CPU Package"), />CPU Package</);
		assert.equal(attr(title("Total CPU Usage"), "font-size"), "16");
		assert.match(title("Total CPU Usage"), />Total CPU Usage</);
	});

	it("prices Tahoma Bold no narrower than the app draws it", () => {
		// QtSvg 6.9.3 (the app's own renderer) drew this string 373 px wide at
		// 30 px in Tahoma Bold, 2026-10-02. Under-pricing is what put labels
		// into values; a few px over is the safe side.
		setFaceFont("tahoma");
		const estimate = estimateKeyTextWidth("CPU Package 56.3 °C Wo", 30);
		assert.ok(estimate >= 373 && estimate <= 380, `estimate ${estimate}`);
	});

	it("three-row labels stop before their value on the rows that collided on hardware", () => {
		setFaceFont("tahoma");
		const rows: TripleKeyRow[][] = [
			[{ label: "CPU Package", valueText: "56.3", unitText: "°C" }, { label: "CPU Fan", valueText: "1785", unitText: "RPM" }, { label: "GPU Power", valueText: "316", unitText: "W" }],
			[{ label: "GPU Memory Junction Temperature", valueText: "92.4", unitText: "°C" }, { label: "Core 0 Effective Clock", valueText: "5462", unitText: "MHz" }, { label: "+12V", valueText: "12.1", unitText: "V" }],
			[{ label: "CPU Package", valueText: "111.1", unitText: "°C" }, { label: "Battery", valueText: "100", unitText: "%" }, { label: "-12V", valueText: "-11.9", unitText: "V" }]
		];
		for (const set of rows) {
			const svg = renderTripleKey({ rows: set, palette: VOID });
			// Each label is followed by the opaque mask that starts its value chunk.
			const pairs = [...svg.matchAll(/(<text x="12"[^>]*>([^<]*)<\/text>)<rect x="([\d.]+)"/g)];
			assert.equal(pairs.length, 3, svg);
			for (const [, element, text, maskX] of pairs) {
				const right = 12 + estimateKeyTextWidth(text as string, Number(attr(element as string, "font-size")));
				assert.ok(right <= Number(maskX), `"${text}" ends at ${right.toFixed(1)}, its value chunk starts at ${maskX}`);
			}
		}
	});

	it("long status headlines step down to fit the key instead of running off its edges", () => {
		setFaceFont("tahoma");
		for (const headline of ["Sensor missing", "Shared Memory", "Start HWiNFO", "Access denied"]) {
			const svg = renderStatusKey({ icon: "warning", accent: "#E8940D", lines: [headline, "pick again"] });
			const element = (svg.match(new RegExp(`<text[^>]*>${headline}</text>`)) as RegExpMatchArray)[0];
			const size = Number(attr(element, "font-size"));
			assert.ok(estimateKeyTextWidth(headline, size) <= faceFont().titleBand, `${headline} at ${size}`);
			assert.ok(size >= 16, `${headline} stays large (${size})`);
		}
	});

	it("two-reading keys keep a common unit whole, giving the value at most two size steps", () => {
		// The unit tells 1785 RPM from 1785 MHz; a review render cut it to "R…".
		setFaceFont("tahoma");
		for (const [value, unit] of [["1023", "MiB/s"], ["4850.5", "MHz"], ["1785.0", "RPM"], ["987.65", "Mbps"], ["56.3", "°C"]] as const) {
			const row = { label: "CPU", valueText: value, unitText: unit, statBadge: "" };
			const svg = renderDualKey({ top: row, bottom: { ...row, label: "GPU" }, palette: VOID });
			const m = /<text x="72" y="56"[^>]*font-size="(\d+)"[^>]*>([^<]*)<tspan[^>]*>([^<]*)<\/tspan>/.exec(svg);
			assert.ok(m, `${value} ${unit}: ${svg}`);
			assert.equal(m[2], value);
			assert.equal((m[3] as string).trim(), unit, `${value} keeps ${unit} whole`);
			const size = Number(m[1]);
			assert.ok(estimateKeyTextWidth(value, size, { fontWeight: 700 }) + 6 + estimateKeyTextWidth(unit, 14) <= 120, `${value} ${unit} at ${size} fits the band`);
		}
	});

	it("three-row dials keep labels 1.6.0 drew whole (the Committed regression)", () => {
		setFaceFont("tahoma");
		const row = (label: string, valueText: string, unitText: string, selected = false) => ({ label, valueText, unitText, selected, valueColor: "#FFFFFF" });
		const svg = renderDialOverview({
			rows: [row("Committed", "63.5K", "MB", true), row("Available", "11.1K", "MB"), row("Load", "85.1", "%")],
			contextText: "session",
			statsText: "▼42.0 ▲78.5",
			palette: VOID
		});
		for (const label of ["COMMITTED", "AVAILABLE", "LOAD"]) assert.match(svg, new RegExp(`>${label}<`));
		assert.doesNotMatch(svg, /…/);
	});

	it("a two-row dial's wrapped second line ends before the value's mask", () => {
		setFaceFont("tahoma");
		const r = (label: string, valueText: string, unitText: string, selected = false) => ({ label, valueText, unitText, selected, valueColor: "#FFFFFF" });
		for (const [label, value] of [["Core 0 Effective Clock Average", "4850"], ["GPU Memory Junction Temperature", "10.5k"], ["CPU Package", "56.3"]] as const) {
			const svg = renderDialTwoRow({ rows: [r(label, value, "MHz", true), r("GPU Temp", "123.4", "MB/s")], footerText: "", palette: VOID });
			// Row 1 sits at y=4: its wrapped second label line shares baseline 40 with the value.
			const second = /<text x="12" y="40"[^>]*font-size="13"[^>]*>([^<]*)<\/text>/.exec(svg);
			const mask = /<rect x="([\d.]+)" y="22"/.exec(svg);
			if (second === null || mask === null) continue; // one line: the trend takes line 2
			assert.ok(12 + estimateKeyTextWidth(second[1] as string, 13) <= Number(mask[1]), `"${second[1]}" runs under the mask at ${mask[1]}`);
		}
	});

	it("every renderer names Tahoma alone", () => {
		setFaceFont("tahoma");
		const row = { label: "CPU", valueText: "56.3", unitText: "°C", statBadge: "" };
		const cell = { label: "CPU", valueText: "56.3", unitText: "°C", color: "#4CC2FF" };
		const faces = [
			renderDualKey({ top: row, bottom: row, palette: VOID }),
			renderTripleKey({ rows: [row, row, row], palette: VOID }),
			renderQuadKey({ cells: [cell, cell, cell, cell], palette: VOID } as never),
			renderDialOverview({ rows: [{ ...row, selected: true, valueColor: "#FFF" }], contextText: "", statsText: "", palette: VOID }),
			renderDialTwoRow({ rows: [{ ...row, selected: true, valueColor: "#FFF" }], footerText: "x", palette: VOID }),
			renderDetailTitleKey({ title: "CPU [#0]: AMD Ryzen 9 9950X3D2", rangeText: "1-11 / 71", palette: VOID, text: { label: "#FFF", unit: "#AAA" } } as never)
		];
		for (const svg of faces) assert.deepEqual([...new Set([...svg.matchAll(/font-family="([^"]*)"/g)].map((m) => m[1]))], ["Tahoma"], svg.slice(0, 160));
	});

	it("the action icons the app draws itself name Tahoma, like the faces", () => {
		for (const icon of ["control/key.svg", "reading/key.svg", "dial/dial.svg"]) {
			const svg = readFileSync(new URL(`../com.lawrensen.hwinfo.sdPlugin/imgs/actions/${icon}`, import.meta.url), "utf8");
			assert.deepEqual([...new Set([...svg.matchAll(/font-family="([^"]*)"/g)].map((m) => m[1]))], ["Tahoma"], icon);
		}
	});
});

describe("Segoe UI, the option", () => {
	it("names Segoe UI alone", () => {
		setFaceFont("segoe-ui");
		assert.deepEqual([...new Set([...single("CPU Package").matchAll(/font-family="([^"]*)"/g)].map((m) => m[1]))], ["Segoe UI"]);
	});

	it("prices a bold 1 like any other digit, since Segoe UI Bold draws them all one width", () => {
		// Before: "111.1" priced 6 px narrow and a three-row label ran into it.
		setFaceFont("segoe-ui");
		const ones = estimateKeyTextWidth("1111", 20, { fontWeight: 700 });
		const eights = estimateKeyTextWidth("8888", 20, { fontWeight: 700 });
		assert.ok(Math.abs(ones - eights) < 0.5, `${ones} vs ${eights}`);
	});
});
