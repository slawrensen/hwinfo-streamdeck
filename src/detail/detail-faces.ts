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
import { alertLevel, convertUnit, parseThreshold, STAT_BADGE, statValue } from "../ui/format";
import { QUAD_DEFAULT_COLORS, renderDualKey, renderQuadKey, renderReadingKey, renderStatusKey, renderTripleKey, type DualKeyRow, type QuadKeyCell, type TripleKeyRow } from "../ui/key-renderer";
import { formatMeasurement, formatQuadMeasurement, type MeasureOptions } from "../ui/measure";
import { keyLabel, missingReadingScreen, statusScreen } from "../ui/state-screens";
import { quadIdentityColor, resolveTextColors, type TextSettings } from "../ui/text-colors";
import { classifyTypeAccent, resolvePalette, type Palette, type ThemesConfig } from "../ui/themes";
import type { DetailPage } from "./detail-group";
import type { DetailTileSpec } from "./detail-settings";
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

/** One reading slot. `key` undefined = an empty slot past the group end.
 * `customLabel` is the hand-grouped tile's label override; undefined (the
 * only value every pre-grouping caller passes) keeps the original bytes. */
export function composeReadingFace(state: DeviceDetailState, key: string | undefined, mode: StatMode, status: PollerStatus, ctx: DetailFaceContext, customLabel?: string): string {
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
			label: keyLabel(customLabel, "Sensor missing"),
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
		label: keyLabel(customLabel, reading.label),
		valueText: measured.valueText,
		unitText: measured.unitText,
		statBadge: STAT_BADGE[mode],
		palette,
		text
	});
}

/**
 * Micro-labels for one dense quad tile: the leading tokens every present
 * label shares are stripped, so a chunk of "GPU Memory Junction
 * Temperature / GPU Hot Spot Temperature / GPU Thermal Limit / GPU Core
 * Voltage" reads MEMO / HOT / THER / CORE instead of GPU four times, and
 * "Core 0..3 VID" reads 0 / 1 / 2 / 3. Every label keeps at least one
 * token, missing readings (undefined) sit out the comparison, and with
 * fewer than two present labels nothing is stripped, which is exactly
 * the standalone quad's first-word fallback. The renderer's 4-code-point
 * uppercase cut still applies downstream. Exported for the unit suite.
 */
export function chunkMicroLabels(labels: readonly (string | undefined)[]): string[] {
	const tokenized = labels.map((label) => (label === undefined ? null : label.split(/\s+/).filter((t) => t !== "")));
	const present = tokenized.filter((t): t is string[] => t !== null && t.length > 0);
	let shared = 0;
	if (present.length >= 2) {
		const cap = Math.min(...present.map((t) => t.length)) - 1;
		const first = present[0] as string[];
		while (shared < cap && present.every((t) => (t[shared] as string).toUpperCase() === (first[shared] as string).toUpperCase())) {
			shared++;
		}
	}
	return tokenized.map((t) => (t === null || t.length === 0 ? "" : (t[Math.min(shared, t.length - 1)] ?? "")));
}

/**
 * One row of a multi-reading face, shared by the standalone dual and
 * triple layouts and the dense detail tiles: label fallback, stat-mode
 * value through the measurement path, and the positional "Sensor
 * missing" placeholder (its value is the key face's one permitted em
 * dash). `statBadge` stays "" everywhere except a dual row pinned to a
 * stat of its own; a missing reading never badges.
 */
export function readingRow(reading: Reading | undefined, mode: StatMode, measure: MeasureOptions, customLabel?: string, statBadge = ""): DualKeyRow & TripleKeyRow {
	if (reading === undefined) {
		return { label: keyLabel(customLabel, "Sensor missing"), valueText: "—", unitText: "", statBadge: "" };
	}
	const measured = formatMeasurement(statValue(reading, mode), reading.unit, measure);
	return { label: keyLabel(customLabel, reading.label), valueText: measured.valueText, unitText: measured.unitText, statBadge };
}

/** A hand-grouped tile's label override for one cell; "" means none. */
function specLabel(spec: DetailTileSpec | undefined, cell: number): string | undefined {
	const label = spec?.labels[cell];
	return label !== undefined && label !== "" ? label : undefined;
}

/**
 * One dense reading tile: a chunk of the group's readings on a single
 * physical key, rendered through the standalone dual/triple/quad
 * renderers (issue #5 follow-up). The layout follows what the chunk
 * actually holds, so a page's trailing tile renders two readings as a
 * dual face rather than a quad with dead quadrants, and a one-reading
 * chunk takes composeReadingFace's exact path, byte for byte, which is
 * what keeps every density-1 page identical to the pre-density plugin.
 *
 * Tile policies, decided for issue #5's dense pages:
 * - The whole tile shows ONE stat (the shared badge; a press cycles the
 *   whole chunk together) derived from its first reading's session mode.
 * - The type accent follows the FIRST reading, exactly like the
 *   standalone multi-reading layouts follow their first sensor.
 * - No thresholds at any density: reading tiles never inherit the
 *   opener's warn/crit levels (see the module doc), so chunks always
 *   render at the normal level.
 * - Quad chunks draw shared-token-stripped micro-labels in the quad's
 *   identity colors: four bare color-coded values would be unreadable on
 *   auto-picked readings, and first words alone collapse on real HWiNFO
 *   groups ("GPU" four times, with a constant limit posing as a live
 *   temperature).
 *
 * A hand-grouped tile's `spec` layers the per-tile knobs a standalone
 * key of the same size has: per-cell label overrides at every size (the
 * micro-label on a quad, the row label on stacked and rows faces, the
 * main label on a single), plus quad identity colors and the cell-labels
 * variant. No spec means exactly the uniform-density face.
 */
export function composeChunkFace(state: DeviceDetailState, keys: readonly string[], mode: StatMode, status: PollerStatus, ctx: DetailFaceContext, spec?: DetailTileSpec): string {
	if (keys.length <= 1) {
		return composeReadingFace(state, keys[0], mode, status, ctx, specLabel(spec, 0));
	}
	const screen = statusScreen(status);
	if (screen !== null) {
		return renderStatusKey(screen);
	}
	const { snapshot } = status as Extract<PollerStatus, { state: "ok" }>;
	const readings = keys.map((key) => snapshot.byKey.get(key));
	const first = readings[0];
	const accent = ctx.typeAccents && first !== undefined ? classifyTypeAccent(first.type, first.unit, first.label) : null;
	const palette = themePaletteFor(state, ctx, accent, "normal");
	const text = resolveTextColors(palette, ctx.text, "normal");
	const sharedBadge = STAT_BADGE[mode];
	if (keys.length === 2) {
		return renderDualKey({
			top: readingRow(readings[0], mode, ctx.measure, specLabel(spec, 0)),
			bottom: readingRow(readings[1], mode, ctx.measure, specLabel(spec, 1)),
			sharedBadge,
			palette,
			text
		});
	}
	if (keys.length === 3) {
		return renderTripleKey({
			rows: readings.map((reading, i) => readingRow(reading, mode, ctx.measure, specLabel(spec, i))),
			sharedBadge,
			palette,
			text
		});
	}
	const labeled = spec === undefined ? true : spec.cellLabels;
	const micros = chunkMicroLabels(readings.map((reading) => reading?.label));
	return renderQuadKey({
		cells: readings.slice(0, 4).map((reading, i): QuadKeyCell => {
			const color = quadIdentityColor(spec?.colors[i] ?? (QUAD_DEFAULT_COLORS[i] as string), labeled, ctx.text, text, palette);
			const label = specLabel(spec, i) ?? micros[i] ?? "";
			if (reading === undefined) {
				// The same positional placeholder as the rows above.
				return { label, valueText: "—", unitText: "", color };
			}
			const measured = formatQuadMeasurement(statValue(reading, mode), reading.unit, ctx.measure);
			return { label, valueText: measured.valueText, unitText: measured.unitText, color };
		}),
		labels: labeled,
		sharedBadge,
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
