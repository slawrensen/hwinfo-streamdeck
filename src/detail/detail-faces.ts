/**
 * Pure composition of every detail-view key face. The controller feeds
 * in the poller status plus a presentation context resolved ONCE per
 * device render pass (theme config, deck default, accents toggle, the
 * opener's measurement and text settings); everything here is a pure
 * function of those inputs, so the whole surface is unit-testable
 * without the SDK.
 *
 * Threshold policy: the Back tile represents the opener itself and keeps
 * its warn/crit recolor; ordinary reading slots deliberately do NOT
 * inherit the opener's thresholds (a temperature limit is meaningless on
 * a power or clock reading), so they always render at the normal level.
 */
import type { PollerStatus } from "../poller";
import type { Reading } from "../hwinfo/types";
import { renderDetailBlankKey, renderDetailIdleBackKey, renderDetailIdleKey, renderDetailPagerKey, renderDetailTitleKey, renderDetailVoidKey } from "../ui/detail-renderer";
import { alertLevel, convertUnit, parseThreshold, STAT_BADGE } from "../ui/format";
import { renderReadingKey, renderStatusKey } from "../ui/key-renderer";
import { formatMeasurement, type MeasureOptions } from "../ui/measure";
import { keyLabel, missingReadingScreen, statusScreen } from "../ui/state-screens";
import { resolveTextColors, type TextSettings } from "../ui/text-colors";
import { classifyTypeAccent, resolvePalette, type Palette, type ThemesConfig } from "../ui/themes";
import type { DetailPage } from "./detail-group";
import type { DetailNavRole } from "./managed-profiles";
import type { DeviceDetailState } from "./navigation";
import type { StatMode } from "../ui/format";

/** Presentation authorities resolved once per device render pass. */
export type DetailFaceContext = {
	readonly config: ThemesConfig;
	readonly deckThemeId: string;
	readonly typeAccents: boolean;
	/** The opener's measurement options (decimals, °F, deck data units). */
	readonly measure: MeasureOptions;
	/** The opener's effective Text setting (own override else deck-wide). */
	readonly text: TextSettings;
};

function themePaletteFor(state: DeviceDetailState, ctx: DetailFaceContext, accent: ReturnType<typeof classifyTypeAccent> | null, level: "normal" | "warn" | "crit"): Palette {
	const theme = state.presentation.theme;
	const themeId = typeof theme === "string" && theme !== "" ? theme : ctx.deckThemeId;
	return resolvePalette(ctx.config, themeId, accent, level);
}

/** The Back tile: the opener's live reading (its theme, text, units and
 * thresholds) plus the return mark; on any non-ok status the ordinary
 * status screen rides under the same mark, so the way out never blanks. */
export function composeBackFace(state: DeviceDetailState, status: PollerStatus, ctx: DetailFaceContext): string {
	const screen = statusScreen(status);
	if (screen !== null) {
		return renderStatusKey({ ...screen, returnMark: true });
	}
	const { snapshot } = status as Extract<PollerStatus, { state: "ok" }>;
	const reading = snapshot.byKey.get(state.primaryKey);
	if (reading === undefined) {
		return renderStatusKey({ ...missingReadingScreen(), returnMark: true });
	}
	const p = state.presentation;
	const level = alertLevel(convertUnit(reading.value, reading.unit, ctx.measure.fahrenheit).value, parseThreshold(p.warnValue), parseThreshold(p.critValue), p.alertBelow === true);
	const accent = ctx.typeAccents ? classifyTypeAccent(reading.type, reading.unit, reading.label) : null;
	const palette = themePaletteFor(state, ctx, accent, level);
	const text = resolveTextColors(palette, ctx.text, level);
	const measured = formatMeasurement(reading.value, reading.unit, ctx.measure);
	return renderReadingKey({
		label: keyLabel(p.label, reading.label),
		valueText: measured.valueText,
		unitText: measured.unitText,
		statBadge: "",
		palette,
		text,
		returnMark: true
	});
}

/** One reading slot. `key` undefined = an empty slot past the group end. */
export function composeReadingFace(state: DeviceDetailState, key: string | undefined, mode: StatMode, status: PollerStatus, ctx: DetailFaceContext): string {
	const screen = statusScreen(status);
	if (screen !== null) {
		return renderStatusKey(screen);
	}
	const blankPalette = themePaletteFor(state, ctx, null, "normal");
	if (key === undefined) {
		return renderDetailBlankKey(blankPalette);
	}
	const { snapshot } = status as Extract<PollerStatus, { state: "ok" }>;
	const reading: Reading | undefined = snapshot.byKey.get(key);
	if (reading === undefined) {
		// A configured reading the snapshot does not publish keeps its slot
		// (custom-mode order is positional); the placeholder value is the
		// key face's one permitted em dash.
		return renderReadingKey({
			label: "Sensor missing",
			valueText: "—",
			unitText: "",
			statBadge: "",
			palette: blankPalette,
			text: resolveTextColors(blankPalette, ctx.text, "normal")
		});
	}
	const accent = ctx.typeAccents ? classifyTypeAccent(reading.type, reading.unit, reading.label) : null;
	const palette = themePaletteFor(state, ctx, accent, "normal");
	const text = resolveTextColors(palette, ctx.text, "normal");
	const value = mode === "min" ? reading.valueMin : mode === "max" ? reading.valueMax : mode === "avg" ? reading.valueAvg : reading.value;
	const measured = formatMeasurement(value, reading.unit, ctx.measure);
	return renderReadingKey({
		label: keyLabel(undefined, reading.label),
		valueText: measured.valueText,
		unitText: measured.unitText,
		statBadge: STAT_BADGE[mode],
		palette,
		text
	});
}

/** The title/page tile: group title over the visible range. */
export function composeTitleFace(state: DeviceDetailState, page: DetailPage, ctx: DetailFaceContext): string {
	const palette = themePaletteFor(state, ctx, null, "normal");
	return renderDetailTitleKey({
		title: state.group.title,
		rangeText: page.rangeText,
		palette,
		text: resolveTextColors(palette, ctx.text, "normal")
	});
}

/** A pager tile, visibly disabled at its boundary. */
export function composePagerFace(direction: "previous" | "next", page: DetailPage, state: DeviceDetailState, ctx: DetailFaceContext): string {
	const palette = themePaletteFor(state, ctx, null, "normal");
	return renderDetailPagerKey({
		direction,
		enabled: direction === "previous" ? page.hasPrevious : page.hasNext,
		palette,
		text: resolveTextColors(palette, ctx.text, "normal")
	});
}

/** Faces for a visible detail surface with NO selected state (plugin
 * restarted inside the profile): honest idle tiles, Back stays live. */
export function composeIdleFace(role: DetailNavRole | "reading"): string {
	return role === "back" ? renderDetailIdleBackKey() : renderDetailIdleKey();
}

/** A just-left surface during the app's switch beat: pure black, so the
 * app's per-key image cache replays black (not an idle wall) when the
 * profile is next entered. See DetailNavigator.recentlyLeft. */
export function composeVoidFace(): string {
	return renderDetailVoidKey();
}
