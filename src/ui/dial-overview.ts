import { resolveControls, schemeCanSwitchGroups } from "../controls";
import type { Reading, SensorSnapshot } from "../hwinfo/types";
import { groupReadings, rotationReadings, type RotationGroup } from "../rotation";
import { alertLevel, convertUnit, parseThreshold, thresholdsApplyTo } from "./format";
import { sensorValueColor } from "./sensor-value-color";
import { resolveTextColors, type TextSettings } from "./text-colors";
import { alertValueColor, type Palette, type ThemesConfig } from "./themes";

/** Settings are untyped JSON: anything but an array of usable strings
 * degrades to no set. Runtime and preview must resolve the same row identity. */
export function rotationKeysOf(settings: { rotationKeys?: unknown }): string[] | undefined {
	if (!Array.isArray(settings.rotationKeys)) return undefined;
	const keys = settings.rotationKeys.filter((key): key is string => typeof key === "string");
	return keys.length > 0 ? keys : undefined;
}

/** Only exact multi-row markers count; absent, malformed or future views
 * retain the single face after a rollback, without rewriting settings. */
export function dialViewOf(settings: { dialView?: unknown }): "single" | "overview" | "tworow" {
	return settings.dialView === "overview" ? "overview" : settings.dialView === "tworow" ? "tworow" : "single";
}

/** Groups scope stepping only when the control scheme can switch groups.
 * Otherwise the mirrored flat set keeps Legacy and rollback behavior. */
export function stepListOf(settings: Parameters<typeof resolveControls>[0] & { rotationKeys?: unknown }, key: string | undefined, groups: readonly RotationGroup[] | undefined, snapshot: SensorSnapshot): readonly Reading[] {
	if (groups !== undefined && schemeCanSwitchGroups(resolveControls(settings))) {
		return groupReadings(groups, key, snapshot);
	}
	return rotationReadings(rotationKeysOf(settings), key, snapshot);
}

/** The actual row surface and numeric precedence, shared with Live value.
 * Alerts depend on the live reading, even when the face shows a session stat. */
export function overviewRowColors(options: {
	settings: { sensorValueColors?: unknown; readingColors?: unknown; alertUnit?: string; warnValue?: string; critValue?: string; alertBelow?: boolean; fahrenheit?: boolean };
	reading: Reading;
	shownValue: number;
	selected: boolean;
	rowCount: 2 | 3;
	palette: Palette;
	config: ThemesConfig;
	themeId: string;
	typeAccents: boolean;
	textSettings: TextSettings;
}): { background: string; text: ReturnType<typeof resolveTextColors>; value: string } {
	const { settings, reading, shownValue, selected, rowCount, palette, config, themeId, typeAccents, textSettings } = options;
	const background = rowCount === 2 && selected ? palette.track : palette.bg;
	const text = resolveTextColors({ ...palette, bg: background }, textSettings, "normal");
	const live = convertUnit(reading.value, reading.unit, settings.fahrenheit === true).value;
	const level = thresholdsApplyTo(settings.alertUnit, reading.unit)
		? alertLevel(live, parseThreshold(settings.warnValue), parseThreshold(settings.critValue), settings.alertBelow === true)
		: "normal";
	const value = level !== "normal" ? alertValueColor(config, level, background) : sensorValueColor({
		enabled: settings.sensorValueColors, readingColors: settings.readingColors, reading, value: shownValue,
		config, themeId, typeAccents, textSettings, normalColor: text.value, background
	});
	return { background, text, value };
}
