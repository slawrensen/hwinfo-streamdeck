/**
 * Text-color resolution (issue #2): parse salvage, deck-default inheritance,
 * exact custom colors, secondary dimming, alert precedence, and the Dim
 * constants' legibility floors on the shipped themes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { appliedTextMode, contrastRatio, CUSTOM_SECONDARY_BLEND, DIM_SECONDARY_BLEND, DIM_VALUE_BLEND, effectiveTextSettings, mixToward, noDimmerThan, parseTextSettings, quadIdentityColor, readableColor, readableValueColor, resolveTextColors, themeTextColors, type QuadIdentity, type TextSettings } from "../src/ui/text-colors";
import { loadThemes, resolvePalette } from "../src/ui/themes";
import { QUAD_DEFAULT_COLORS } from "../src/ui/key-renderer";
import { contrast } from "./wcag";

const config = loadThemes();
const VOID = resolvePalette(config, "void", null, "normal");

const custom = (color: string | undefined, dimSecondary = false): TextSettings => ({ mode: "custom", color, dimSecondary });

describe("built-in numeric text contrast", () => {
	for (const [name, palette] of Object.entries(config.themes)) {
		for (const mode of ["theme", "dim"] as const) {
			it(`${name} ${mode}: primary and every quad identity value meet 4.5:1`, () => {
				const settings: TextSettings = { mode, color: undefined, dimSecondary: false };
				const text = resolveTextColors(palette, settings, "normal");
				assert.ok(contrast(text.value, palette.bg) >= 4.5, `primary ${contrast(text.value, palette.bg)}`);
				assert.ok(contrast(text.unit, palette.bg) >= 4.5, `numeric statistics/unit ${contrast(text.unit, palette.bg)}`);
				for (const identity of QUAD_DEFAULT_COLORS) {
					const color = quadIdentityColor({ color: identity, chosen: false }, false, settings, text, palette);
					assert.ok(contrast(color, palette.bg) >= 4.5, `${identity} value ${contrast(color, palette.bg)}`);
				}
			});
		}
	}
});

describe("secondary hierarchy: the label never reads dimmer than the unit on its surface", () => {
	// Dials mark the selected row with the label token and paint the other
	// rows in the unit token; keys stack title over value over unit. Lifting
	// the unit to the numeric floor must not leave the label under it, on
	// the face or on the selected two-row band (the track).
	for (const [name, palette] of Object.entries(config.themes)) {
		for (const mode of ["theme", "dim"] as const) {
			it(`${name} ${mode}: label >= unit on the face and on the track band; values keep the 4.5 floor`, () => {
				const settings: TextSettings = { mode, color: undefined, dimSecondary: false };
				const face = resolveTextColors(palette, settings, "normal");
				assert.ok(contrast(face.label, palette.bg) >= contrast(face.unit, palette.bg), `face label ${face.label} ${contrast(face.label, palette.bg).toFixed(2)} < unit ${face.unit} ${contrast(face.unit, palette.bg).toFixed(2)}`);
				assert.ok(contrast(face.value, palette.bg) >= 4.5, `face value ${contrast(face.value, palette.bg).toFixed(2)}`);
				const band = resolveTextColors({ ...palette, bg: palette.track }, settings, "normal");
				assert.ok(contrast(band.label, palette.track) >= contrast(band.unit, palette.track), `band label ${band.label} ${contrast(band.label, palette.track).toFixed(2)} < unit ${band.unit} ${contrast(band.unit, palette.track).toFixed(2)}`);
				assert.ok(contrast(band.value, palette.track) >= 4.5, `band value ${contrast(band.value, palette.track).toFixed(2)}`);
			});
		}
	}

	it("theme mode returns the palette tokens byte-identical on every shipped theme and both alert palettes", () => {
		// The alert faces resolve through the same function: a palette whose
		// label read dimmer than its unit would be silently rewritten on
		// every critical key, so the authored tokens must already be ordered.
		for (const palette of [...Object.values(config.themes), config.alerts.warn, config.alerts.crit]) {
			const text = themeTextColors(palette);
			assert.equal(text.label, palette.label);
			assert.equal(text.value, palette.value);
			assert.equal(text.unit, palette.unit);
		}
	});
});

describe("readableColor, noDimmerThan and contrastRatio", () => {
	it("contrastRatio agrees with the WCAG reference implementation", () => {
		for (const [a, b] of [["#000000", "#FFFFFF"], ["#7A8393", "#000000"], ["#555C67", "#161A21"], ["#4A4740", "#E9E6DE"]]) {
			assert.ok(Math.abs(contrastRatio(a as string, b as string) - contrast(a as string, b as string)) < 1e-9, `${a} on ${b}`);
		}
	});

	it("readableColor keeps a passing color byte-identical and lifts a failing one to the floor, quantized above it", () => {
		assert.equal(readableColor("#7A8393", "#000000", 4.5), "#7A8393");
		const lifted = readableColor("#555C67", "#000000", 4.5);
		assert.notEqual(lifted, "#555C67");
		assert.ok(contrast(lifted, "#000000") >= 4.5);
		assert.ok(contrast(lifted, "#000000") < 4.6, "the lift stops at the first quantized pass, not far above it");
		assert.equal(readableColor("#555C67", "#000000", 1), "#555C67", "a floor already met changes nothing");
		assert.ok(contrast(readableColor("#555C67", "#000000", 7), "#000000") >= 7);
		assert.equal(readableValueColor("#555C67", "#000000"), lifted, "readableValueColor is the 4.5 floor");
	});

	it("noDimmerThan lifts to the reference's own ratio and leaves an already brighter color alone", () => {
		const reference = readableValueColor("#474E5B", "#000000");
		const lifted = noDimmerThan("#555C67", reference, "#000000");
		assert.ok(contrast(lifted, "#000000") >= contrast(reference, "#000000"), `${lifted} reads under ${reference}`);
		assert.equal(noDimmerThan("#FFFFFF", reference, "#000000"), "#FFFFFF");
		assert.equal(noDimmerThan(reference, reference, "#000000"), reference, "a color is never dimmer than itself");
		// Light surface, same rule: the label steps toward black instead.
		const paper = noDimmerThan("#7A776F", "#6B675E", "#E9E6DE");
		assert.ok(contrast(paper, "#E9E6DE") >= contrast("#6B675E", "#E9E6DE"));
	});
});

describe("parseTextSettings salvage", () => {
	it("only the exact mode markers parse; everything else follows", () => {
		assert.deepEqual(parseTextSettings({ textMode: "theme" }), { mode: "theme", color: undefined, dimSecondary: false });
		assert.deepEqual(parseTextSettings({ textMode: "dim" }), { mode: "dim", color: undefined, dimSecondary: false });
		assert.deepEqual(parseTextSettings({ textMode: "custom", textColor: "#660000", textDimSecondary: true }), { mode: "custom", color: "#660000", dimSecondary: true });
		for (const junk of [undefined, "", "DIM", "future-mode", 42, null, {}]) {
			assert.equal(parseTextSettings({ textMode: junk }), null, JSON.stringify(junk));
		}
	});

	it("invalid colors parse to undefined (custom then degrades to theme)", () => {
		for (const bad of ["660000", "#66000", "#66000000", "red", 42, undefined, "#66 000"]) {
			assert.equal(parseTextSettings({ textMode: "custom", textColor: bad })?.color, undefined, JSON.stringify(bad));
		}
		assert.equal(appliedTextMode(custom(undefined)), "theme");
		assert.equal(appliedTextMode(custom("#660000")), "custom");
	});

	it("dimSecondary only on the exact true", () => {
		assert.equal(parseTextSettings({ textMode: "custom", textDimSecondary: "yes" })?.dimSecondary, false);
		assert.equal(parseTextSettings({ textMode: "custom", textDimSecondary: true })?.dimSecondary, true);
	});
});

describe("deck default and local override resolution", () => {
	const deckDim: TextSettings = { mode: "dim", color: undefined, dimSecondary: false };

	it("local wins; absent local follows the deck; absent both is theme", () => {
		assert.equal(effectiveTextSettings(custom("#660000"), deckDim).mode, "custom");
		assert.equal(effectiveTextSettings(null, deckDim).mode, "dim");
		assert.equal(effectiveTextSettings(null, null).mode, "theme");
	});

	it("a local Theme override bypasses a deck Dim or Custom", () => {
		const local: TextSettings = { mode: "theme", color: undefined, dimSecondary: false };
		const resolved = resolveTextColors(VOID, effectiveTextSettings(local, deckDim), "normal");
		assert.deepEqual(resolved, themeTextColors(VOID));
	});
});

describe("resolveTextColors", () => {
	it("theme mode is identical to the palette's own tokens", () => {
		const resolved = resolveTextColors(VOID, { mode: "theme", color: undefined, dimSecondary: false }, "normal");
		assert.deepEqual(resolved, { value: VOID.value, label: VOID.label, unit: VOID.unit, badge: VOID.accent });
	});

	it("custom uses the exact selected color for the main value", () => {
		const resolved = resolveTextColors(VOID, custom("#660000"), "normal");
		assert.equal(resolved.value, "#660000");
	});

	it("secondary dim off: every textual element takes the exact color", () => {
		const resolved = resolveTextColors(VOID, custom("#660000", false), "normal");
		assert.deepEqual(resolved, { value: "#660000", label: "#660000", unit: "#660000", badge: "#660000" });
	});

	it("secondary dim on: the same hue stepped toward the background", () => {
		const resolved = resolveTextColors(VOID, custom("#660000", true), "normal");
		assert.equal(resolved.value, "#660000");
		const expected = mixToward("#660000", VOID.bg, CUSTOM_SECONDARY_BLEND);
		assert.equal(resolved.label, expected);
		assert.equal(resolved.unit, expected);
		assert.equal(resolved.badge, expected);
		assert.notEqual(resolved.label, "#660000");
	});

	it("custom without a valid color degrades to theme text, never throws", () => {
		assert.deepEqual(resolveTextColors(VOID, custom(undefined), "normal"), themeTextColors(VOID));
	});

	it("alert levels outrank every text mode", () => {
		const warnPalette = resolvePalette(config, "void", null, "warn");
		for (const settings of [custom("#660000"), { mode: "dim", color: undefined, dimSecondary: false } as TextSettings]) {
			const resolved = resolveTextColors(warnPalette, settings, "warn");
			assert.deepEqual(resolved, themeTextColors(warnPalette));
		}
	});
});

describe("mixToward", () => {
	it("blends channel-wise and stays uppercase #RRGGBB", () => {
		assert.equal(mixToward("#FFFFFF", "#000000", 0.5), "#808080");
		assert.equal(mixToward("#660000", "#000000", 0.5), "#330000");
		assert.match(mixToward("#4CC2FF", "#10061F", 0.3), /^#[0-9A-F]{6}$/);
	});

	it("amount 0 returns the color, amount 1 the target", () => {
		assert.equal(mixToward("#4CC2FF", "#000000", 0), "#4CC2FF");
		assert.equal(mixToward("#4CC2FF", "#123456", 1), "#123456");
	});
});

describe("dim constants hold legibility on the shipped themes", () => {
	const dim: TextSettings = { mode: "dim", color: undefined, dimSecondary: false };
	for (const id of ["void", "graphite", "ember", "paper"]) {
		it(`${id}: visibly dimmer, never illegible`, () => {
			const palette = resolvePalette(config, id, null, "normal");
			const resolved = resolveTextColors(palette, dim, "normal");
			// Dimmer than the theme's own text...
			assert.ok(contrast(resolved.value, palette.bg) < contrast(palette.value, palette.bg), `${id} value dims`);
			assert.ok(contrast(resolved.label, palette.bg) < contrast(palette.label, palette.bg), `${id} label dims`);
			// ...but never black-on-black or white-on-white.
			assert.ok(contrast(resolved.value, palette.bg) >= 3, `${id} value stays readable (${contrast(resolved.value, palette.bg).toFixed(2)})`);
			assert.ok(contrast(resolved.label, palette.bg) >= 1.7, `${id} label stays visible (${contrast(resolved.label, palette.bg).toFixed(2)})`);
			assert.ok(contrast(resolved.unit, palette.bg) >= 1.6, `${id} unit stays visible (${contrast(resolved.unit, palette.bg).toFixed(2)})`);
		});
	}
});

describe("quadIdentityColor", () => {
	const identity: QuadIdentity = { color: "#4CC2FF", chosen: false };
	// A saved dark cell color: about 2:1 on the void face, below every floor.
	const chosen: QuadIdentity = { color: "#123456", chosen: true };
	const theme: TextSettings = { mode: "theme", color: undefined, dimSecondary: false };
	const dim: TextSettings = { mode: "dim", color: undefined, dimSecondary: false };
	const PAPER = resolvePalette(config, "paper", null, "normal");

	it("theme mode returns a readable default identity unchanged for values and labels", () => {
		assert.equal(quadIdentityColor(identity, false, theme, themeTextColors(VOID), VOID), identity.color);
		assert.equal(quadIdentityColor(identity, true, theme, themeTextColors(VOID), VOID), identity.color);
	});

	it("theme mode lifts a default identity that cannot read on its surface", () => {
		const gold: QuadIdentity = { color: "#D4AB33", chosen: false };
		assert.ok(contrast(gold.color, PAPER.bg) < 4.5, "the fixture must start below the floor");
		const lifted = quadIdentityColor(gold, false, theme, themeTextColors(PAPER), PAPER);
		assert.equal(lifted, readableValueColor(gold.color, PAPER.bg));
		assert.ok(contrast(lifted, PAPER.bg) >= 4.5);
	});

	it("a chosen color renders exact in Theme, whatever its contrast (the dial readingColors contract)", () => {
		assert.ok(contrast(chosen.color, VOID.bg) < 4.5, "the fixture must start below the floor");
		assert.equal(quadIdentityColor(chosen, false, theme, themeTextColors(VOID), VOID), "#123456");
		assert.equal(quadIdentityColor(chosen, true, theme, themeTextColors(VOID), VOID), "#123456");
		assert.equal(quadIdentityColor({ color: "#D4AB33", chosen: true }, false, theme, themeTextColors(PAPER), PAPER), "#D4AB33");
	});

	it("a chosen color in Dim is only blended toward the surface, never lifted", () => {
		const text = resolveTextColors(VOID, dim, "normal");
		const value = quadIdentityColor(chosen, false, dim, text, VOID);
		const label = quadIdentityColor(chosen, true, dim, text, VOID);
		assert.equal(value, mixToward("#123456", VOID.bg, DIM_VALUE_BLEND));
		assert.equal(label, mixToward("#123456", VOID.bg, DIM_SECONDARY_BLEND));
		assert.ok(contrast(value, VOID.bg) < 4.5 && contrast(label, VOID.bg) < 4.5, "no lift happened");
	});

	it("custom mode routes to the resolved text colors by role, chosen or not", () => {
		const text = resolveTextColors(VOID, custom("#660000"), "normal");
		for (const slot of [identity, chosen]) {
			assert.equal(quadIdentityColor(slot, false, custom("#660000"), text, VOID), text.value);
			assert.equal(quadIdentityColor(slot, true, custom("#660000"), text, VOID), text.label);
		}
	});

	it("dim mode blends a default identity per role, retaining the numeric contrast floor", () => {
		const text = resolveTextColors(VOID, dim, "normal");
		assert.equal(quadIdentityColor(identity, false, dim, text, VOID), readableValueColor(mixToward(identity.color, VOID.bg, DIM_VALUE_BLEND), VOID.bg));
		assert.equal(quadIdentityColor(identity, true, dim, text, VOID), readableValueColor(mixToward(identity.color, VOID.bg, DIM_SECONDARY_BLEND), VOID.bg));
	});
});

describe("readableValueColor", () => {
	it("retains passing colors and adjusts failing colors against light, dark and middle surfaces", () => {
		for (const background of ["#000000", "#FFFFFF", "#808080", "#14181F", "#CDC9BD"]) {
			for (const color of ["#000000", "#FFFFFF", "#808080", "#4CC2FF", "#660000", "#00FF00"]) {
				const resolved = readableValueColor(color, background);
				assert.ok(contrast(resolved, background) >= 4.5, `${color} on ${background}: ${resolved}`);
				if (contrast(color, background) >= 4.5) assert.equal(resolved, color);
			}
		}
	});
});
