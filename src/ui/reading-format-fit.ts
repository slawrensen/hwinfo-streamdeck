/**
 * Which readings with their own format the face draws in a shorter text
 * than their own right now, what it draws, and what would fit, for the
 * panel's note under that reading's row. It runs the same formatting
 * (measureFor and the measure.ts formatters) and the same picks the
 * renderers use (each layout's exact rung), so the note and the face can
 * never disagree.
 *
 * Keys: every slot of the drawn layout, each at the stat its row draws
 * (the key's stat; a dual key's pinned Row 2 at its own, as composeDual
 * draws it). Dials: every reading the dial can show (its rotation steps,
 * else the reading's source), each measured at the stat the face draws
 * (the live value, or the session MIN/MAX/AVG after a tap, from the
 * instance's own session statistics, with the single view's stat badge in
 * the unit run as the face draws it) and fitted by the current view's
 * rule, so the note follows the reading's value, not which reading happens
 * to be on the dial. Without the instance's statistics (no dial instance
 * behind the preview) a dial reading is measured at its live value. The
 * dial's stats lines are not reported: they take the same steps (no
 * decimals, then compact) but decide on their own.
 */
import type { Reading, SensorSnapshot } from "../hwinfo/types";
import { rotationGroupsOf } from "../rotation";
import { rowStatValue, type SessionStats } from "../stats";
import { dialViewOf, stepListOf } from "./dial-overview";
import { dialExactRung, rowExactRung } from "./dial-renderer";
import { isStatMode, STAT_BADGE, statValue, type DecimalsSetting, type StatMode } from "./format";
import { dualExactRung, quadExactRung, singleExactRung, tripleExactRung, type ExactTexts } from "./key-renderer";
import { drawnKeyLayout } from "./key-layout";
import { exactFallback, formatMeasurement, formatQuadMeasurement, type FixedDataUnit, type MeasureOptions } from "./measure";
import { fixedUnitsFor, measureFor } from "./reading-format";

type FitSettings = Parameters<typeof stepListOf>[0] & {
	readingKey?: unknown;
	secondaryReadingKey?: unknown;
	quadReadingKey3?: unknown;
	quadReadingKey4?: unknown;
	keyLayout?: unknown;
	quadLabels?: unknown;
	displayMode?: unknown;
	statMode?: unknown;
	secondaryStatMode?: unknown;
	dialView?: unknown;
	rotationGroups?: unknown;
	readingFormats?: unknown;
};

/** What a dial face draws its numbers at: the instance's stat mode (a tap
 * cycles it) and its session statistics by reading key. */
export type DialStatView = { readonly mode: StatMode; readonly stats: (key: string) => SessionStats | undefined };

/** A reading the face draws past its exact text: its saved key, the text
 * the face draws ("22031 GB"), and the format that would show the exact
 * text here, when one would: a larger unit at the same decimals, else
 * fewer decimals in the same unit. */
export type FormatFallback = { key: string; shows: string; fits?: { unit?: FixedDataUnit; decimals: DecimalsSetting } };

function keyOf(raw: unknown): string | undefined {
	return typeof raw === "string" && raw !== "" ? raw : undefined;
}

/** Which of a reading's texts one layout draws (0 = its exact text). */
type RungOf = (texts: ExactTexts) => number;

/**
 * The note for one reading: undefined while the face draws its exact
 * text, else what it draws and what would fit. `textsAt` formats the
 * reading's texts under given options, as the face does.
 */
function noteFor(key: string, reading: Reading, opts: MeasureOptions, rungOf: RungOf, textsAt: (o: MeasureOptions) => ExactTexts): FormatFallback | undefined {
	const texts = textsAt(opts);
	const index = rungOf(texts);
	if (index === 0) return undefined;
	const drawn = texts[index] as ExactTexts[number];
	const shows = `${drawn.valueText} ${drawn.unitText}`.trim();
	const exactAt = (o: MeasureOptions): boolean => rungOf(textsAt(o)) === 0;
	// A larger unit of the same family at the decimals asked for first,
	// then fewer decimals in this unit, then a larger unit with fewer.
	const offered = fixedUnitsFor(reading.unit);
	const fixed = opts.fixedUnit;
	const family = fixed === undefined ? [] : /i/.test(fixed) || !offered.includes("KB") ? ["B", "KiB", "MiB", "GiB", "TiB"] : ["B", "KB", "MB", "GB", "TB"];
	const larger = (fixed === undefined ? [] : family.slice(family.indexOf(fixed) + 1)).filter((u): u is FixedDataUnit => offered.includes(u as FixedDataUnit));
	const fewer = opts.decimals === "auto" ? [] : Array.from({ length: Number(opts.decimals) }, (_, i) => String(Number(opts.decimals) - 1 - i) as DecimalsSetting);
	for (const unit of larger) {
		if (exactAt({ ...opts, fixedUnit: unit })) return { key, shows, fits: { unit, decimals: opts.decimals } };
	}
	for (const decimals of fewer) {
		if (exactAt({ ...opts, decimals })) return { key, shows, fits: { decimals } };
	}
	for (const unit of larger) {
		for (const decimals of fewer) {
			if (exactAt({ ...opts, fixedUnit: unit, decimals })) return { key, shows, fits: { unit, decimals } };
		}
	}
	return { key, shows };
}

/** The readings whose own format the face draws past its exact text. */
export function formatFallbackOf(settings: FitSettings, base: MeasureOptions, snapshot: SensorSnapshot, kind: "key" | "dial", dialStats?: DialStatView): FormatFallback[] {
	const raw = settings.readingFormats;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return [];
	}
	const out: FormatFallback[] = [];
	const add = (note: FormatFallback | undefined): void => {
		if (note !== undefined && !out.some((n) => n.key === note.key)) out.push(note);
	};
	if (kind === "key") {
		const layout = drawnKeyLayout(settings);
		const slots = [settings.readingKey, settings.secondaryReadingKey, settings.quadReadingKey3, settings.quadReadingKey4].map(keyOf).slice(0, layout === "quad" ? 4 : layout === "triple" ? 3 : layout === "dual" ? 2 : 1);
		const mode: StatMode = isStatMode(settings.statMode) ? settings.statMode : "current";
		// composeDual: only an explicit stat mode pins Row 2; anything else
		// follows the key's stat.
		const secondMode: StatMode = layout === "dual" && isStatMode(settings.secondaryStatMode) ? settings.secondaryStatMode : mode;
		const quad = layout === "quad";
		const labeled = settings.quadLabels === true;
		const ring = settings.displayMode === "ring";
		const rungOf: RungOf = (texts) => (quad ? quadExactRung(texts, labeled) : layout === "triple" ? tripleExactRung(texts) : layout === "dual" ? dualExactRung(texts) : singleExactRung(texts, ring)).index;
		for (const [index, key] of slots.entries()) {
			const reading = key === undefined ? undefined : snapshot.byKey.get(key);
			if (key === undefined || reading === undefined) continue;
			const opts = measureFor(base, raw, reading);
			if (opts.exact !== true) continue;
			const value = statValue(reading, index === 1 ? secondMode : mode);
			const textsAt = (o: MeasureOptions): ExactTexts => [quad ? formatQuadMeasurement(value, reading.unit, o) : formatMeasurement(value, reading.unit, o), ...exactFallback(value, reading.unit, o, quad)];
			add(noteFor(key, reading, opts, rungOf, textsAt));
		}
		return out;
	}
	const key = keyOf(settings.readingKey);
	const reading = key === undefined ? undefined : snapshot.byKey.get(key);
	if (key === undefined || reading === undefined) {
		return out;
	}
	const view = dialViewOf(settings);
	const list = stepListOf(settings, reading.key, rotationGroupsOf(settings.rotationGroups), snapshot);
	const members: Reading[] = [...list];
	if (!members.some((member) => member.key === reading.key)) members.push(reading);
	// The single view's unit run carries the stat badge (" · MAX"), as
	// composeDialSvg draws it, so the badge costs the number room.
	const badge = dialStats === undefined ? "" : STAT_BADGE[dialStats.mode];
	const withBadge = (unit: string): string => `${unit}${badge !== "" ? " · " + badge : ""}`.trim();
	const rungOf: RungOf = ([first, ...rest]) => (view === "single" ? dialExactRung([{ ...first, unitText: withBadge(first.unitText) }, ...rest.map((m) => ({ ...m, unitText: withBadge(m.unitText) }))]) : rowExactRung([first, ...rest])).index;
	for (const member of members) {
		const opts = measureFor(base, raw, member);
		if (opts.exact !== true) continue;
		// The single view reads the dial's reading's session under its saved
		// key; the rows read each member's under its own (composeDialSvg).
		const stats = dialStats === undefined ? undefined : member.key === reading.key && view === "single" ? dialStats.stats(key) : dialStats.stats(member.key);
		const value = dialStats === undefined ? member.value : rowStatValue(member.value, stats, dialStats.mode);
		add(noteFor(member.key, member, opts, rungOf, (o) => [formatMeasurement(value, member.unit, o), ...exactFallback(value, member.unit, o, false)]));
	}
	return out;
}
