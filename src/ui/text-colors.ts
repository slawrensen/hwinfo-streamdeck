/**
 * Effective text-color resolution for the Text setting (issue #2): Theme,
 * Dim, or Custom, deck-wide with per-key/per-dial overrides. Purely textual:
 * the structural palette tokens (backgrounds, accents as graphics, tracks,
 * gauge fills, sparklines) never resolve through here.
 *
 * Precedence, in order: warn/critical alert palettes, then the effective
 * local/global text mode, then plain theme text.
 */
import type { AlertLevel } from "./format";
import type { Palette } from "./themes";

export type TextMode = "theme" | "dim" | "custom";

/** One scope's parsed Text settings (local override or deck-wide default). */
export type TextSettings = {
	mode: TextMode;
	/** Valid #RRGGBB only; anything else parses to undefined and Custom
	 * degrades to theme text at resolve time. */
	color: string | undefined;
	dimSecondary: boolean;
};

/** Resolved fills for the four textual roles every face draws. */
export type TextColors = {
	/** Primary values. */
	value: string;
	/** Labels, wrapped label lines, context/footer text. */
	label: string;
	/** Units, suffixes, min/max/avg stats. */
	unit: string;
	/** Stat badges (MIN/MAX/AVG), drawn in the accent token on theme faces. */
	badge: string;
};

/** The one #RRGGBB gate every color-bearing setting parses through
 * (quad colors, tile colors, custom text, themes.json palettes). The
 * ui/pi-common.js HEX_COLOR mirror cannot share it across the webview
 * boundary and keeps its own keep-in-sync comment. */
export const HEX6 = /^#[0-9A-Fa-f]{6}$/;

/**
 * Dim blends toward the theme background: polarity-correct on dark and light
 * themes alike, hue retained. Values keep more presence than secondary text
 * so the hierarchy survives. Constants tuned on real renders of Void,
 * Graphite, Ember and Paper (see test/text-colors.test.ts contrast floors).
 */
export const DIM_VALUE_BLEND = 0.42;
export const DIM_SECONDARY_BLEND = 0.3;
/** Custom secondary text: the selected hue, stepped toward the background. */
export const CUSTOM_SECONDARY_BLEND = 0.35;

/** Channel-wise linear blend of `color` toward `toward` by `amount` (0..1). */
export function mixToward(color: string, toward: string, amount: number): string {
	const channel = (offset: number): string => {
		const from = parseInt(color.slice(offset, offset + 2), 16);
		const to = parseInt(toward.slice(offset, offset + 2), 16);
		return Math.round(from + (to - from) * amount)
			.toString(16)
			.padStart(2, "0")
			.toUpperCase();
	};
	return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** WCAG relative luminance for the validated sRGB theme/settings colors. */
function luminance(color: string): number {
	const linear = (offset: number): number => {
		const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

/** WCAG contrast ratio between two validated #RRGGBB colors. */
export function contrastRatio(a: string, b: string): number {
	const x = luminance(a);
	const y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The one lifting primitive. A color that already reads at `floor`:1 or
 * better on `background` remains byte-identical. Otherwise retain the hue
 * while moving toward the higher-contrast endpoint until it passes. */
export function readableColor(color: string, background: string, floor: number): string {
	if (contrastRatio(color, background) >= floor) return color;
	const bg = luminance(background);
	const target = (bg + 0.05) / 0.05 >= 1.05 / (bg + 0.05) ? "#000000" : "#FFFFFF";
	let low = 0;
	let high = 1;
	let result = target;
	// Keep the passing, quantized candidate, not a rounded estimate of the
	// threshold. A value just below the floor must never round into a pass.
	for (let i = 0; i < 12; i++) {
		const middle = (low + high) / 2;
		const candidate = mixToward(color, target, middle);
		if (contrastRatio(candidate, background) >= floor) {
			high = middle;
			result = candidate;
		} else {
			low = middle;
		}
	}
	return result;
}

/** Built-in numeric foregrounds use a 4.5:1 floor on their actual surface.
 * Custom Text and chosen per-reading or quad cell colors deliberately
 * bypass this function: their contract is the exact user-selected color. */
export function readableValueColor(color: string, background: string): string {
	return readableColor(color, background, 4.5);
}

/** Keeps a secondary token from reading dimmer than its reference on the
 * same surface. The unit token lifts to the numeric floor; the label token
 * then lifts at least to the unit's ratio, so the theme's label over unit
 * hierarchy survives every mode (dials mark the selected row with the label
 * token and paint the other rows in the unit token). A label that already
 * reads better than its reference remains byte-identical. */
export function noDimmerThan(color: string, reference: string, background: string): string {
	return readableColor(color, background, contrastRatio(reference, background));
}

/**
 * Parses one scope of raw Text settings. Settings are untyped JSON at
 * runtime: only the exact mode markers count, and anything else (absent, "",
 * junk, a newer version's future value) returns null, which means "follow
 * the wider scope" locally and "theme" deck-wide.
 */
export function parseTextSettings(raw: { textMode?: unknown; textColor?: unknown; textDimSecondary?: unknown }): TextSettings | null {
	const mode = raw.textMode;
	if (mode !== "theme" && mode !== "dim" && mode !== "custom") {
		return null;
	}
	const color = typeof raw.textColor === "string" && HEX6.test(raw.textColor) ? raw.textColor : undefined;
	return { mode, color, dimSecondary: raw.textDimSecondary === true };
}

const THEME_TEXT: TextSettings = { mode: "theme", color: undefined, dimSecondary: false };

/** Local override wins; absent/malformed local follows the deck default;
 * absent/malformed deck default resolves to theme. */
export function effectiveTextSettings(local: TextSettings | null, deck: TextSettings | null): TextSettings {
	return local ?? deck ?? THEME_TEXT;
}

/** The mode that actually applies: Custom without a valid color is theme. */
export function appliedTextMode(settings: TextSettings): TextMode {
	return settings.mode === "custom" && settings.color === undefined ? "theme" : settings.mode;
}

/** The theme's own text tokens, as a TextColors (the identity resolution).
 * The unit meets the numeric floor and the label reads no dimmer than it;
 * every shipped theme already orders its tokens that way, so this returns
 * the palette tokens byte-identical. */
export function themeTextColors(palette: Palette): TextColors {
	const unit = readableValueColor(palette.unit, palette.bg);
	return { value: palette.value, label: noDimmerThan(palette.label, unit, palette.bg), unit, badge: palette.accent };
}

/** One quad slot's identity as the action resolved it: the hue, and whether
 * a person chose it (a saved quadColors entry, a hand-grouped detail tile
 * color) or the slot fell back to its automatic default. */
export type QuadIdentity = { readonly color: string; readonly chosen: boolean };

/**
 * A quad cell's identity color under the effective Text setting. The slot
 * colors are textual (the value glyphs, or the micro-label), so Custom
 * governs them too: the exact color for values, the secondary shade for
 * micro-labels. A chosen hue follows the dial per-reading color contract
 * (sensor-value-color.ts): exact in Theme, only blended in Dim, never
 * lifted. The automatic defaults keep the readable lift for the surface.
 * Shared by the standalone quad layout and the detail view's dense tiles.
 */
export function quadIdentityColor(identity: QuadIdentity, labeled: boolean, settings: TextSettings, text: TextColors, palette: { bg: string }): string {
	const mode = appliedTextMode(settings);
	if (mode === "custom") {
		return labeled ? text.label : text.value;
	}
	const color = mode === "dim" ? mixToward(identity.color, palette.bg, labeled ? DIM_SECONDARY_BLEND : DIM_VALUE_BLEND) : identity.color;
	return identity.chosen ? color : readableValueColor(color, palette.bg);
}

/**
 * Resolves the final textual fills. Alert faces always return the (alert)
 * palette's numeric tokens: warn/critical presentation outranks text modes.
 * The main value in Custom is the exact selected color, never adjusted.
 */
export function resolveTextColors(palette: Palette, settings: TextSettings, level: AlertLevel): TextColors {
	const mode = appliedTextMode(settings);
	if (level !== "normal" || mode === "theme") {
		return themeTextColors(palette);
	}
	if (mode === "dim") {
		// The unit lifts to the numeric floor (statistics are numbers); the
		// label then lifts at least to the unit's ratio, or Dim would invert
		// the theme's label over unit hierarchy on every face.
		const unit = readableValueColor(mixToward(palette.unit, palette.bg, DIM_SECONDARY_BLEND), palette.bg);
		return {
			value: readableValueColor(mixToward(palette.value, palette.bg, DIM_VALUE_BLEND), palette.bg),
			label: noDimmerThan(mixToward(palette.label, palette.bg, DIM_SECONDARY_BLEND), unit, palette.bg),
			unit,
			badge: mixToward(palette.accent, palette.bg, DIM_SECONDARY_BLEND)
		};
	}
	const color = settings.color as string;
	const secondary = settings.dimSecondary ? mixToward(color, palette.bg, CUSTOM_SECONDARY_BLEND) : color;
	return { value: color, label: secondary, unit: secondary, badge: secondary };
}
