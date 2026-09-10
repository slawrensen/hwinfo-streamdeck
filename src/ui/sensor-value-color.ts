import type { Reading } from "../hwinfo/types";
import { appliedTextMode, DIM_VALUE_BLEND, HEX6, mixToward, readableValueColor, type TextSettings } from "./text-colors";
import { classifyTypeAccent, resolvePalette, type ThemesConfig } from "./themes";

/** Opt-in normal numeric color only. The caller keeps alert precedence. */
export function sensorValueColor(options: {
	enabled: unknown;
	readingColors?: unknown;
	reading: Pick<Reading, "key" | "type" | "unit" | "label">;
	value: number;
	config: ThemesConfig;
	themeId: string;
	typeAccents: boolean;
	textSettings: TextSettings;
	normalColor: string;
	background: string;
}): string {
	const { enabled, readingColors, reading, value, config, themeId, typeAccents, textSettings, normalColor, background } = options;
	const mode = appliedTextMode(textSettings);
	if (!Number.isFinite(value) || mode === "custom") return normalColor;
	// Explicit colors follow stable reading identity, like rotationNames.
	// Salvage one entry at a time without rewriting settings. Like quad cell
	// colors, chosen hues stay exact in Theme and use the existing Dim blend.
	if (typeof readingColors === "object" && readingColors !== null && !Array.isArray(readingColors) && Object.hasOwn(readingColors, reading.key)) {
		const color: unknown = (readingColors as Record<string, unknown>)[reading.key];
		if (typeof color === "string" && HEX6.test(color)) return mode === "dim" ? mixToward(color, background, DIM_VALUE_BLEND) : color;
	}
	if (enabled !== true || !typeAccents) return normalColor;
	const category = classifyTypeAccent(reading.type, reading.unit, reading.label);
	const palette = resolvePalette(config, themeId, category, "normal");
	// The theme authority returns its base palette for unknown categories
	// and themes that opt out of type accents. Keep ordinary resolved text.
	if (palette === resolvePalette(config, themeId, null, "normal")) return normalColor;
	const color = mode === "dim" ? mixToward(palette.accent, background, DIM_VALUE_BLEND) : palette.accent;
	return readableValueColor(color, background);
}
