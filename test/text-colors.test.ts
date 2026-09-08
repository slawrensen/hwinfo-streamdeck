/**
 * Text-color resolution (issue #2): parse salvage, deck-default inheritance,
 * exact custom colors, secondary dimming, alert precedence, and the Dim
 * constants' legibility floors on the shipped themes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { appliedTextMode, CUSTOM_SECONDARY_BLEND, DIM_SECONDARY_BLEND, DIM_VALUE_BLEND, effectiveTextSettings, mixToward, parseTextSettings, quadIdentityColor, readableValueColor, resolveTextColors, themeTextColors, type TextSettings } from "../src/ui/text-colors";
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
					const color = quadIdentityColor(identity, false, settings, text, palette);
					assert.ok(contrast(color, palette.bg) >= 4.5, `${identity} value ${contrast(color, palette.bg)}`);
				}
			});
		}
	}
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
	const identity = "#4CC2FF";
	const dim: TextSettings = { mode: "dim", color: undefined, dimSecondary: false };

	it("theme mode returns the identity unchanged for values and labels", () => {
		const theme: TextSettings = { mode: "theme", color: undefined, dimSecondary: false };
		assert.equal(quadIdentityColor(identity, false, theme, themeTextColors(VOID), VOID), identity);
		assert.equal(quadIdentityColor(identity, true, theme, themeTextColors(VOID), VOID), identity);
	});

	it("custom mode routes to the resolved text colors by role", () => {
		const text = resolveTextColors(VOID, custom("#660000"), "normal");
		assert.equal(quadIdentityColor(identity, false, custom("#660000"), text, VOID), text.value);
		assert.equal(quadIdentityColor(identity, true, custom("#660000"), text, VOID), text.label);
	});

	it("dim mode blends identity per role, retaining the numeric contrast floor", () => {
		const text = resolveTextColors(VOID, dim, "normal");
		assert.equal(quadIdentityColor(identity, false, dim, text, VOID), readableValueColor(mixToward(identity, VOID.bg, DIM_VALUE_BLEND), VOID.bg));
		assert.equal(quadIdentityColor(identity, true, dim, text, VOID), readableValueColor(mixToward(identity, VOID.bg, DIM_SECONDARY_BLEND), VOID.bg));
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
