import type { Reading } from "../hwinfo/types";
import { appliedTextMode, DIM_VALUE_BLEND, mixToward, readableValueColor, type TextSettings } from "./text-colors";
import { classifyTypeAccent, resolvePalette, type ThemesConfig } from "./themes";

/** Opt-in normal numeric color only. The caller keeps alert precedence. */
export function sensorValueColor(options: {
	enabled: unknown;
	reading: Pick<Reading, "type" | "unit" | "label">;
	value: number;
	config: ThemesConfig;
	themeId: string;
	typeAccents: boolean;
	textSettings: TextSettings;
	normalColor: string;
	background: string;
}): string {
	const { enabled, reading, value, config, themeId, typeAccents, textSettings, normalColor, background } = options;
	const mode = appliedTextMode(textSettings);
	if (enabled !== true || !typeAccents || !Number.isFinite(value) || mode === "custom") return normalColor;
	const category = classifyTypeAccent(reading.type, reading.unit, reading.label);
	const palette = resolvePalette(config, themeId, category, "normal");
	// The theme authority returns its base palette for unknown categories
	// and themes that opt out of type accents. Keep ordinary resolved text.
	if (palette === resolvePalette(config, themeId, null, "normal")) return normalColor;
	const color = mode === "dim" ? mixToward(palette.accent, background, DIM_VALUE_BLEND) : palette.accent;
	return readableValueColor(color, background);
}
