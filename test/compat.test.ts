/**
 * Compatibility proof: faces rendered from legacy-shaped inputs (no gauge, no
 * text overrides, no data-unit re-tiering in play) must preserve captured
 * geometry and content from test/golden/legacy-faces.json. The two explicit
 * numeric-unit color replacements below are the readability correction.
 * The dial
 * faces and the quad key are the untouched 1.2.0 capture; the single and
 * dual key entries were re-baselined for the adaptive label typography
 * (issue #3), and the three single-key entries again for the measured
 * advance table, the unit baseline lift to 112/18px (bottom-zone fix), the
 * stat badge's move into the title/number gap, and once more for the
 * balanced unit corridor (unit 114, spark span inset to pin stroke ink at
 * y=120) — label/unit/badge geometry changed intentionally there, and
 * these fixtures pin everything else (anchors, values, sparkline) against
 * drift. A theme-mode text
 * resolution must also be byte-identical to passing no text at all.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { renderDial, renderDialOverview, renderDialTwoRow } from "../src/ui/dial-renderer";
import { renderDualKey, renderQuadKey, renderReadingKey } from "../src/ui/key-renderer";
import { resolveTextColors, themeTextColors } from "../src/ui/text-colors";
import { applyGlobalThemeSettings, effectiveThemeFor, getDeckTheme } from "../src/ui/theme-store";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const legacy = JSON.parse(readFileSync(new URL("./golden/legacy-faces.json", import.meta.url), "utf8")) as Record<string, string>;
// Retain the historical artifacts. Authorize only these foreground changes;
// all other bytes still compare exactly, including number and unit geometry.
const golden = Object.fromEntries(Object.entries(legacy).map(([name, svg]) => [name, svg.replaceAll("#667082", "#6B7586").replaceAll("#8A6326", "#926E35")]));
const config = loadThemes();
const VOID = resolvePalette(config, "void", null, "normal");
const EMBER = resolvePalette(config, "ember", "temperature", "normal");

describe("legacy faces retain all bytes except the approved numeric colors", () => {
	it("single key, plain (no sparkline field ever set)", () => {
		assert.equal(renderReadingKey({ label: "CPU Package", valueText: "56.3", unitText: "°C", statBadge: "", palette: VOID }), golden.singlePlain);
	});

	it("single key with the legacy sparkline", () => {
		assert.equal(renderReadingKey({ label: "CPU Package", valueText: "56.3", unitText: "°C", statBadge: "", history: [50, 60, 55, 70, 65], palette: VOID }), golden.singleSparkline);
	});

	it("single key with a stat badge, type accent and sparkline", () => {
		assert.equal(renderReadingKey({ label: "CPU Package", valueText: "56.3", unitText: "°C", statBadge: "MAX", history: [50, 60, 55, 70, 65], palette: EMBER }), golden.singleBadge);
	});

	it("dual layout defaults", () => {
		const svg = renderDualKey({
			top: { label: "CPU Package", valueText: "56.3", unitText: "°C", statBadge: "" },
			bottom: { label: "GPU Temp", valueText: "48.2", unitText: "°C", statBadge: "" },
			sharedBadge: "",
			palette: VOID
		});
		assert.equal(svg, golden.dual);
	});

	it("quad layout defaults", () => {
		const svg = renderQuadKey({
			cells: [
				{ label: "CPU", valueText: "56.3", unitText: "°C", color: "#4CC2FF" },
				{ label: "GPU", valueText: "48.2", unitText: "°C", color: "#FF7E8E" },
				{ label: "Pump", valueText: "2850", unitText: "RPM", color: "#38CD89" },
				{ label: "Power", valueText: "142", unitText: "W", color: "#D4AB33" }
			],
			palette: VOID
		});
		assert.equal(svg, golden.quad);
	});

	it("quad micro-label variant (pinned at the adaptive-label change)", () => {
		const svg = renderQuadKey({
			cells: [
				{ label: "CPU", valueText: "56.3", unitText: "°C", color: "#4CC2FF" },
				{ label: "GPU", valueText: "48.2", unitText: "°C", color: "#FF7E8E" },
				{ label: "Pump", valueText: "2850", unitText: "RPM", color: "#38CD89" },
				{ label: "Power", valueText: "142", unitText: "W", color: "#D4AB33" }
			],
			labels: true,
			palette: VOID
		});
		assert.equal(svg, golden.quadLabeled);
	});

	it("dial with no thresholds: track and fill only, exactly as before", () => {
		const svg = renderDial({ title: "CPU Package", valueText: "56.3", unitText: "°C", statsText: "▼ 41.2   ▲ 79.0   session", fraction: 0.42, palette: VOID, barColor: VOID.accent });
		assert.equal(svg, golden.dialNoThreshold);
	});

	it("dial at full bar with an inline badge", () => {
		const svg = renderDial({ title: "CPU Package", valueText: "79.0", unitText: "°C · MAX", statsText: "", fraction: 1, palette: EMBER, barColor: EMBER.accent });
		assert.equal(svg, golden.dialFullBar);
	});

	it("three-row overview defaults", () => {
		const svg = renderDialOverview({
			rows: [
				{ label: "Temperature", valueText: "56.3", unitText: "°C", selected: true, valueColor: VOID.value },
				{ label: "Hot Spot", valueText: "62.1", unitText: "°C", selected: false, valueColor: VOID.value },
				{ label: "Memory", valueText: "48.0", unitText: "°C", selected: false, valueColor: VOID.value }
			],
			contextText: "GPU",
			statsText: "▼41.2 ▲79.0",
			palette: VOID
		});
		assert.equal(svg, golden.overview);
	});

	it("two-row view defaults", () => {
		const svg = renderDialTwoRow({
			rows: [
				{ label: "CPU Package", valueText: "56.3", unitText: "°C", selected: true, valueColor: VOID.value, history: [50, 60, 55] },
				{ label: "GPU Temp", valueText: "48.2", unitText: "°C", selected: false, valueColor: VOID.value }
			],
			footerText: "▼ 41.2  ▲ 79.0  session",
			palette: VOID
		});
		assert.equal(svg, golden.twoRow);
	});
});

describe("theme text mode is byte-identical to the palette path", () => {
	const themeText = resolveTextColors(VOID, { mode: "theme", color: undefined, dimSecondary: false }, "normal");

	it("resolves to exactly the palette tokens", () => {
		assert.deepEqual(themeText, themeTextColors(VOID));
	});

	it("rendering with resolved theme text equals rendering with none", () => {
		const base = { label: "CPU Package", valueText: "56.3", unitText: "°C", statBadge: "MAX" as const, palette: VOID };
		assert.equal(renderReadingKey({ ...base, text: themeText }), renderReadingKey(base));
		const dial = { title: "CPU", valueText: "56.3", unitText: "°C", statsText: "▼ 41   ▲ 79", fraction: 0.4, palette: VOID, barColor: VOID.accent };
		assert.equal(renderDial({ ...dial, text: themeText }), renderDial(dial));
	});

	it("an empty zones array leaves the dial bar untouched", () => {
		const base = { title: "CPU", valueText: "56.3", unitText: "°C", statsText: "", fraction: 0.4, palette: VOID, barColor: VOID.accent };
		assert.equal(renderDial({ ...base, zones: [] }), renderDial(base));
	});
});

describe("malformed theme settings salvage without rewriting", () => {
	it("prototype-named local themes render the default face", () => {
		const base = { label: "CPU", valueText: "40.0", unitText: "°C", statBadge: "", palette: VOID };
		for (const theme of Object.getOwnPropertyNames(Object.prototype)) {
			const settings = { theme };
			const palette = resolvePalette(config, effectiveThemeFor(settings), null, "normal");
			assert.equal(renderReadingKey({ ...base, palette }), renderReadingKey(base), theme);
			assert.deepEqual(settings, { theme });
		}
	});

	it("prototype-named global themes retain the last valid deck theme", () => {
		try {
			applyGlobalThemeSettings({ theme: "paper" });
			for (const theme of Object.getOwnPropertyNames(Object.prototype)) {
				const settings = { theme };
				applyGlobalThemeSettings(settings);
				assert.equal(getDeckTheme(), "paper", theme);
				assert.deepEqual(settings, { theme });
			}
		} finally {
			applyGlobalThemeSettings({ theme: "void" });
		}
	});
});
