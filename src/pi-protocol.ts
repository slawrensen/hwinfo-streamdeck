/**
 * Message shapes exchanged with the property inspector pages (ui/pi-common.js).
 * All are `type` aliases (not interfaces) so they satisfy the SDK's JsonValue.
 */
import streamDeck from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import type { DialAlertView } from "./alerts/dial";
import { NORMAL_SHOWN } from "./alerts/engine";
import { instantAlert } from "./alerts/instant";
import { immediateLevel, legacyLimitUnit, type KeyAlertPanel } from "./alerts/key-alerts";
import { alertFlags, DEFAULT_COMMAND_SNOOZE_MS, legacyScopeApplies, parseAlertConfig, readingRuleOf, ruleFor, valueInUnit, type AlertSettings } from "./alerts/rules";
import type { ShownAlert } from "./alerts/types";
import { detailDensityOf, detailModeOf, detailRoleOf, pressBehaviorOf } from "./detail/detail-settings";
import { detailProfileFor, type ManagedDetailProfile, type SlotCell } from "./detail/managed-profiles";
import { previewDetailPage, type DetailPreviewDraft } from "./detail/placement";
import { deviceCapabilities } from "./devices";
import { buildSupportReport } from "./diagnostics";
import { handleEditorRequest } from "./editors/editor-runtime";
import type { Reading } from "./hwinfo/types";
import { t } from "./i18n";
import { panelFolds, panelKindOf } from "./panel-folds";
import type { SensorSnapshot } from "./hwinfo/types";
import { poller, type PollerStatus } from "./poller";
import { resolveControls, schemeCanSwitchGroups } from "./controls";
import { overviewWindow, rotationGroupsOf } from "./rotation";
import { dialViewOf, overviewRowColors, stepListOf } from "./ui/dial-overview";
import { alertLevel, convertUnit, parseThreshold, thresholdsApplyTo, type DecimalsSetting } from "./ui/format";
import { drawnKeyLayout } from "./ui/key-layout";
import { formatMeasurement, formatStat, type MeasureOptions } from "./ui/measure";
import { fixedUnitsFor, measureFor } from "./ui/reading-format";
import { ownLooksCount } from "./ui/shared-looks";
import { formatFallbackOf, type DialStatView, type FormatFallback } from "./ui/reading-format-fit";
import { statusSentence } from "./ui/state-screens";
import { appliedTextMode, parseTextSettings, resolveTextColors } from "./ui/text-colors";
import { effectiveTextFor, effectiveThemeFor, getDataUnits, getDeckTheme, measureOptionsFrom, typeAccentsEnabled } from "./ui/theme-store";
import { loadThemes, resolvePalette } from "./ui/themes";

type TreeReading = {
	key: string;
	/** Every key that resolves to this reading, its own key first, then
	 * confirmed aliases (explicit cross-provider links, legacy Gadget keys)
	 * in the runtime's lookup order. A saved key found here is present, so
	 * the panel can name it, tick it and color it without name matching. */
	keys: string[];
	label: string;
	unit: string;
	value: number;
	type: number;
	/** Formatted through the runtime's own measurement authority at Auto,
	 * under the deck-wide data-unit preference (picker rows show HWiNFO's
	 * reading, not one action's Decimals, °F or per-reading format). */
	display: string;
	/** The fixed units a per-reading format may give this reading
	 * (fixedUnitsFor), for the panel's Unit select; absent when none. */
	units?: string[];
};

/** The presentation settings both sensor actions share; the PI preview is
 * formatted and colored with the OPEN action's own effective settings. */
export type PreviewSettings = {
	readingKey?: string;
	decimals?: DecimalsSetting;
	fahrenheit?: boolean;
	theme?: string;
	textMode?: string;
	textColor?: string;
	textDimSecondary?: boolean;
	warnValue?: string;
	critValue?: string;
	alertBelow?: boolean;
	/** Dial only: the unit the thresholds are scoped to (plugin-stamped). */
	alertUnit?: string;
	/** Per-reading limits and timing (src/alerts/rules.ts salvages them). */
	alertRules?: unknown;
	alertDwellMs?: unknown;
	alertHysteresis?: unknown;
	alertDisplayUnit?: unknown;
	alertDisplayUnitFor?: unknown;
	alertSnoozeMs?: unknown;
	dialView?: string;
	readingColors?: unknown;
	sensorValueColors?: unknown;
	rotationGroups?: unknown;
	/** Per-reading formats (src/ui/reading-format.ts). */
	readingFormats?: unknown;
} & Parameters<typeof stepListOf>[0];

type TreeGroup = {
	name: string;
	/** The raw source name ("" for an orphan reading): what the runtime's
	 * detail filter matches against, so the PI's live match counter can use
	 * the same candidate while `name` keeps the display fallback. */
	matchName: string;
	readings: TreeReading[];
};

type SensorTreePayload = {
	event: "sensorTree";
	groups: TreeGroup[];
	/** Poller state at fetch time — lets the PI refetch after HWiNFO comes up. */
	state: PollerStatus["state"];
	/** Active data source ("shared-memory" | "gadget"); absent when unavailable. */
	source?: string;
	/** Guidance sentence when data is unavailable; empty when ok via shared memory. */
	hint: string;
};

type PreviewPayload = {
	event: "preview";
	state: PollerStatus["state"];
	/** Active data source ("shared-memory" | "gadget"); absent when unavailable. */
	source?: string;
	hint: string;
	/** The preview line exactly as the face would show it: value and stats
	 * formatted with the action's effective settings, colored by its resolved
	 * theme and Text setting. Absent when nothing valid is selected or the
	 * reading is missing. */
	display?: {
		value: string;
		unit: string;
		stats: string;
		bg: string;
		valueColor: string;
		statsColor: string;
	};
	/** True when a reading is selected but absent from the current snapshot. */
	missing: boolean;
	/** Present (true) while the poller rides out a transient source failure
	 * on the last values: the state still reads ok or stale, but nothing new
	 * is being read, so the panel must not call it live. */
	holding?: true;
	/** Shared Memory only, while stale: how long no new producer evidence has
	 * arrived, in whole seconds' worth of milliseconds (the evidence clock
	 * the face's own hint counts). Gadget has no producer clock, so it never
	 * carries one. */
	staleForMs?: number;
	/** The action context this preview describes. The panel drops a payload
	 * naming another context, so a late reply can never paint action A's
	 * face into action B's panel after a quick switch. */
	context?: string;
	kind?: "key" | "dial";
	/** The exact SVG this action last sent to the device (setImage or the
	 * dial canvas), carried only when it changed since the last push to
	 * this panel or when the panel asked for it. Never re-rendered here. */
	face?: string;
	/** The primary reading as the face shows it: label, source, display unit. */
	reading?: { label: string; source: string; unit: string };
	/** What the runtime resolves, from the functions the faces use, so the
	 * panel's summaries report effective behavior instead of guessing. */
	effective?: PreviewEffective;
	/** Dial only, and only for a dial holding a strip copy: its role. While
	 * `status` is "joined" the face is this dial's strip slice and the
	 * individual reading above is dormant. */
	strip?: PreviewStrip;
};

/** A dial's strip role, for the panel's header and status. */
export type PreviewStrip = { status: string; column: number; groupId: string; rev: number; layout: string; mode: string };

type PreviewEffective = {
	/** drawn: the palette actually used (an unknown id draws the spec default). */
	theme: { id: string; drawn: string; own: boolean; unknown: boolean };
	/** applied: Custom without a valid color draws theme text. */
	text: { mode: string; applied: string; own: boolean; color: string | null; dimSecondary: boolean };
	/** Type accents on AND not suppressed by the drawn theme. */
	typeAccents: boolean;
	dataUnits: string;
	/** Parsed thresholds in display units; scopeUnit is the dial's stamp in
	 * the unit the dial shows those readings in (°C is °F with °F on). */
	alert: { level: string; warn: number | null; crit: number | null; below: boolean; unit: string | null; applies: boolean; scopeUnit: string | null };
	layout?: { chosen: string; drawn: string };
	press?: { behavior: string; role: string | null; detailMode: string; density: number };
	controls?: { preset: string; rotate: string; pressedRotate: string; shortPress: string; longPress: string; tap: string; touchHold: string; touchZones: string; switchesGroups: boolean };
	/** Key only: the live alert path (timing, the face, each drawn reading
	 * with its rule source, level, captured unit and notes). */
	keyAlerts?: KeyAlertPanel;
	/** Dial only, while its reading reports: the alert of the reading on
	 * the dial now (see dialReadingAlertOf). */
	readingAlert?: PreviewReadingAlert;
	/** While readingFormats holds an object: the readings whose own format
	 * the face draws in a shorter text here, what it draws and what would
	 * fit, from the renderers' own picks (formatFallbackOf). */
	formatFallback?: FormatFallback[];
};

/** The alert of the reading on a dial, for the Alerts section: which
 * limits apply, the unit a "Separate limits" capture stores, what the face
 * shows after dwell, recovery and snooze, and the validation notes. */
type PreviewReadingAlert = {
	/** The saved key on the dial: a capture is only for this reading. */
	key: string;
	/** The alertRules key the reading's own limits are saved under (its own
	 * key or a linked one), or null when it has none. */
	ruleKey: string | null;
	/** The unit the face shows this reading in, which a capture stores
	 * ("" for a unitless reading). */
	displayUnit: string;
	/** Whose limits apply: the reading's own, the dial's (Warn at, Critical
	 * at under the unit scope), or none. */
	source: "reading" | "legacy" | null;
	/** Whether the dial's own limits cover this reading's unit. */
	legacyApplies: boolean;
	level: string;
	snoozed: string | null;
	flags: { code: string; message: string }[];
	/** The parsed "Alert after" and snooze length the dial runs. */
	dwellMs: number;
	snoozeMs: number;
	/** The unit Warn at and Critical at are in for this reading
	 * (legacyLimitUnit, as a key's reading 1): the stamped unit while it is
	 * the °C/°F counterpart of the face's, else the face's. A panel edit of
	 * them stamps it (alertDisplayUnit), so a later °F switch converts. */
	legacyUnit: string;
};

// ---- Strip Display (Sensor Dial panel only) ----------------------------------
//
// The plugin is the only writer of a dial's stripGroup. The panel asks; the
// plugin validates, writes complete documents and answers. Ordered data
// travels as arrays (the app sorts object keys). Handled by src/strip/pi.ts.

export type StripEditReasonId = "stale" | "invalid" | "no-group" | "mismatch" | "device" | "incomplete" | "conflict";

export type StripEditResultPayload = {
	event: "stripEditResult";
	context: string;
	opId: string;
	op: "create" | "edit" | "join" | "leave" | "restore" | "resolve" | "reid";
	ok: boolean;
	reason?: StripEditReasonId;
	detail?: string;
	/** The group's revision after the request (unchanged when refused). */
	rev: number;
	groupId: string | null;
	/** The group's config in its stored form, or null. */
	config: JsonValue;
	/** Columns whose dial left the screen before it could be written. */
	unwritten?: number[];
	/** Leave with every dial: how many dials of the strip were off screen
	 * and keep their joined copy (absent when none). */
	offscreen?: number;
	/** This dial's stored stripGroup after the request, as written (null:
	 * none). The panel carries it in its own whole-document writes. */
	stored: JsonValue;
};

/** A Group pane's rule against the current snapshot (src/strip/group.ts). */
/** A rule pane's count now; `units` only for Ambient (every unit drawn). */
export type StripGroupCount = { status: string; title: string; unit: string; drawn: number; sameUnit: number; otherUnits: number; units?: number };

/** One screen of a strip as the panel sees it (StripStatePayload.group.screens). */
export type StripScreenEntry = { screenId: string; name: string; autoName: string; style: string; index: number };

export type StripStatePayload = {
	event: "stripState";
	context: string;
	requestId?: string;
	device: { model: string; encoders: number; strip: boolean };
	self: { column: number; status: string; groupId: string | null; rev: number; joined: boolean; foreign: { groupId: string; rev: number } | null };
	/** This dial's group: the live authority, or its own left copy. */
	group: {
		id: string;
		rev: number;
		live: boolean;
		health: string;
		conflict: { kind: "tie" | "foreign"; columns: number[] } | null;
		config: JsonValue;
		panes: { mode: "live" | "paused"; window: string }[];
		/** What this dial's gestures do while grouped: [gesture, words]. */
		controls: [string, string][];
		/** Per active pane, a Group pane's count now (null for other styles):
		 * what its rule matches in HWiNFO's list, for the panel's count line. */
		counts?: (StripGroupCount | null)[];
		/** The strip's readings, for its own Unit and decimals rows (issue
		 * #59): every stored screen's and pane's series, a rule's custom
		 * list, and the readings its rules draw on the screen on view. */
		readings: string[];
		/** Strip Screens: every screen in order (index 0 is panes[0]), with
		 * its id (a runtime "@<index>" for a screen the plugin has not given
		 * one yet), its own name ("" when none), the name the strip gives it
		 * when it has none, and its style. */
		screens: StripScreenEntry[];
		/** The id of the screen on view (the one the panel's pane box edits). */
		screen: string;
		/** Seconds between automatic screen changes, or null (by hand). */
		screenCycle: number | null;
		/** True while the automatic cycle waits (this panel is open, a pane
		 * inspects, or HWiNFO stopped). */
		cycleHeld: boolean;
	} | null;
	/** One entry per encoder column of this deck: what the plugin can see
	 * there. "none" is empty or another plugin's action (it cannot tell). */
	slots: { column: number; state: "joined" | "dormant" | "independent" | "other" | "outside" | "none"; self: boolean; groupId: string | null }[];
	/** The config a new strip's draft patch applies to (a strip seeded from
	 * this dial), in its stored form; null off a strip deck and on a running
	 * strip, whose draft applies to group.config. */
	base: JsonValue;
	/** The panel draft the plugin remembers for this strip (or a new strip
	 * on this deck) across member panels; memory only, never a setting. */
	draft: { layout?: "whole" | "split"; patch: JsonValue[]; baseRev?: number } | null;
	/** This dial's stored stripGroup as written (null: none). */
	stored: JsonValue;
	/** The plugin's own slices, left to right ("" where none): the live
	 * strip, or a draft that is never written. */
	preview: { kind: "live" | "draft" | "none"; slices: string[]; frame?: string; error?: string };
};

/** Faces longer than this (UTF-16 code units) are never carried to the
 * panel (bounded messages); the panel is told to clear its picture instead
 * of keeping an older frame. */
const MAX_FACE_CHARS = 64 * 1024;

export type PreviewExtras = {
	context?: string;
	kind?: "key" | "dial";
	face?: string;
	/** The poller's hold (see PreviewPayload.holding). */
	holding?: boolean;
	/** Key only: what the key's live alert path shows; its face level
	 * replaces the one-shot comparison in the preview and the summary. */
	keyAlerts?: KeyAlertPanel;
	/** A dial's last alert store step, by reading key: what its face shows.
	 * Without it, alerts are read from the live value alone. */
	alerts?: DialAlertView;
	/** Dial only, for a dial holding a strip copy (see PreviewPayload.strip). */
	strip?: PreviewStrip;
	/** Dial only: the instance's stat mode and session statistics, so the
	 * format overflow note measures the number the face draws after a tap
	 * (MIN/MAX/AVG), not only the live value. */
	dialStats?: DialStatView;
};

/**
 * The theme tokens for the PI's preset gallery — served over the message
 * channel because the PI webview cannot reliably fetch local files. The
 * plugin's schema-validated themes.json stays the single source of truth,
 * and `effectiveDeckTheme` is the RESOLVED deck default from the theme
 * store — the PI must never guess it from raw global settings (stale or
 * invalid values there made the "Deck default" chip lie).
 */
export function buildThemesPayload(): JsonValue {
	const config = loadThemes();
	// The Stream Deck app re-serializes plugin-to-panel messages with object
	// keys sorted, so the themes object reaches the panel alphabetized; the
	// defined order travels as a list, which keeps its order.
	return JSON.parse(JSON.stringify({ event: "themes", effectiveDeckTheme: getDeckTheme(), ...config, themeOrder: Object.keys(config.themes) })) as JsonValue;
}

/** The bundle the OPEN action's device would enter, its model name, and
 * the action's own cell (a key's, never a dial's). */
function openActionDetailTarget(): { profile: ManagedDetailProfile | undefined; model: string; opener: SlotCell | null } {
	const act = streamDeck.ui.action;
	const caps = act === undefined ? undefined : deviceCapabilities.get(act.device.id);
	const profile = detailProfileFor(caps?.type, caps === undefined ? undefined : { columns: caps.columns, rows: caps.rows });
	const coordinates = act !== undefined && act.isKey() ? act.coordinates : undefined;
	return { profile, model: caps?.model ?? "unknown device", opener: coordinates === undefined ? null : { column: coordinates.column, row: coordinates.row } };
}

const cellJson = (cell: SlotCell | null): JsonValue => (cell === null ? null : { column: cell.column, row: cell.row });

/**
 * Whether the OPEN action's device has a bundled detail profile. Answered
 * from the managed-profile registry so the PI never carries its own device
 * table; `model` is the human name for the honest unsupported note. A
 * supported deck also gets its bundle's grid (navigation cells, reading
 * cells in slot order) and the key's own cell, which the Page layout
 * editor draws; the panel keeps no layout table of its own either.
 */
export function buildDetailSupportPayload(): JsonValue {
	const { profile, model, opener } = openActionDetailTarget();
	return detailSupportPayloadOf(profile, model, opener);
}

/** The detailSupport answer for a bundle (undefined: unsupported). */
export function detailSupportPayloadOf(profile: ManagedDetailProfile | undefined, model: string, opener: SlotCell | null): JsonValue {
	if (profile === undefined) {
		return { event: "detailSupport", supported: false, model };
	}
	const { columns, rows, nav, readings } = profile.layout;
	return {
		event: "detailSupport",
		supported: true,
		model,
		bundle: profile.key,
		columns,
		rows,
		nav: { back: cellJson(nav.back), title: cellJson(nav.title), previous: cellJson(nav.previous), next: cellJson(nav.next) },
		readings: readings.map((cell) => cellJson(cell)),
		opener: cellJson(opener)
	};
}

/**
 * One page of the open opener's detail view, for the Page layout editor:
 * the panel's draft of the list settings laid out by the same resolver
 * and page walk the deck runs, against the live snapshot. Read-only by
 * construction: it never writes settings, and opening, paging or
 * previewing in the panel sends only this request.
 */
export function buildDetailPreviewPayload(draft: unknown, page: unknown): JsonValue {
	const act = streamDeck.ui.action;
	const { profile, opener } = openActionDetailTarget();
	if (act === undefined || profile === undefined) {
		return { event: "detailPreview", supported: false };
	}
	const status = poller.getStatus();
	return detailPreviewPayloadOf(status.state === "unavailable" ? null : status.snapshot, draft, profile, opener, page, act.id);
}

/** The detailPreview answer for one page of a draft on a bundle. A draft
 * that is not an object previews the defaults; a page that is not a
 * number previews the first. */
export function detailPreviewPayloadOf(snapshot: SensorSnapshot | null, draft: unknown, profile: ManagedDetailProfile, opener: SlotCell | null, page: unknown, context: string): JsonValue {
	const settings: DetailPreviewDraft = typeof draft === "object" && draft !== null && !Array.isArray(draft) ? (draft as DetailPreviewDraft) : {};
	const preview = previewDetailPage(snapshot, settings, profile, opener, typeof page === "number" ? page : 0);
	return JSON.parse(JSON.stringify({ event: "detailPreview", supported: true, context, bundle: profile.key, ...preview })) as JsonValue;
}

/** The redacted support report, for the PI's "Copy support report" button.
 *  The panel's request id comes back with it, so the panel copies only the
 *  answer to its own pending request (external review AX63). */
export function buildSupportReportPayload(requestId?: unknown): JsonValue {
	const info = streamDeck.info;
	return {
		event: "supportReport",
		...(typeof requestId === "string" ? { requestId } : {}),
		report: buildSupportReport({
			pluginVersion: info.plugin.version,
			appVersion: info.application.version,
			platformVersion: info.application.platformVersion
		})
	};
}

/** The full sensor list, grouped by source — sent on PI request. */
export function buildSensorTree(status: PollerStatus): SensorTreePayload {
	const groups: TreeGroup[] = [];
	if (status.state !== "unavailable") {
		const { snapshot } = status;
		const treeOpts: MeasureOptions = { decimals: "auto", fahrenheit: false, dataUnits: getDataUnits() };
		const byIndex = new Map<number, TreeGroup>();
		for (const reading of snapshot.readings) {
			let group = byIndex.get(reading.sensorIndex);
			if (group === undefined) {
				const source = snapshot.sensors[reading.sensorIndex]?.name;
				group = { name: source ?? t("preview.unknownSensor"), matchName: source ?? "", readings: [] };
				byIndex.set(reading.sensorIndex, group);
				groups.push(group);
			}
			const m = formatMeasurement(reading.value, reading.unit, treeOpts);
			const units = fixedUnitsFor(reading.unit);
			group.readings.push({
				key: reading.key,
				keys: [reading.key, ...(reading.linkedKeys ?? []).filter((key) => key !== reading.key)],
				label: reading.label,
				unit: reading.unit,
				value: reading.value,
				type: reading.type,
				display: `${m.valueText} ${m.unitText}`.trim(),
				...(units.length > 0 ? { units: [...units] } : {})
			});
		}
	}
	const payload: SensorTreePayload = { event: "sensorTree", groups, state: status.state, hint: statusSentence(status) };
	if (status.state !== "unavailable") {
		payload.source = status.source;
	}
	return payload;
}

/** Live preview of the selected reading — pushed to the open PI every tick,
 * formatted and colored with the open action's effective settings so the
 * panel can never contradict the face. `alertsRecolor` mirrors the face:
 * key faces flip their whole palette on warn/crit, dial faces stay themed.
 * `extras` carries the panel context, the action kind and the device face
 * the caller already rendered (never composed here). */
export function buildPreview(status: PollerStatus, settings: PreviewSettings | undefined, alertsRecolor: boolean, extras: PreviewExtras = {}): PreviewPayload {
	const payload: PreviewPayload = {
		event: "preview",
		state: status.state,
		hint: statusSentence(status),
		missing: false
	};
	if (extras.context !== undefined) {
		payload.context = extras.context;
	}
	if (extras.kind !== undefined) {
		payload.kind = extras.kind;
	}
	if (extras.face !== undefined && extras.face !== "") {
		payload.face = extras.face.length <= MAX_FACE_CHARS ? extras.face : "";
	}
	if (extras.strip !== undefined) {
		payload.strip = extras.strip;
	}
	if (status.state !== "unavailable") {
		payload.source = status.source;
		if (extras.holding === true) {
			payload.holding = true;
		}
	}
	if (status.state === "stale" && status.source === "shared-memory") {
		// Whole seconds rounded exactly like the hint's count
		// (statusSentence), so both change on the same tick: a finer or
		// differently rounded value would send the panel extra previews
		// that tell it nothing new.
		payload.staleForMs = Math.round(status.staleForMs / 1000) * 1000;
	}
	if (settings !== undefined) {
		payload.effective = effectiveOf(settings, extras.kind, undefined, extras);
	}
	const readingKey = settings?.readingKey;
	if (status.state === "unavailable" || settings === undefined || readingKey === undefined || readingKey === "") {
		return payload;
	}
	const reading = status.snapshot.byKey.get(readingKey);
	if (reading === undefined) {
		payload.missing = true;
		return payload;
	}
	const opts = measureOptionsFrom(settings);
	const config = loadThemes();
	const themeId = effectiveThemeFor(settings);
	// The key face's alert precedence, mirrored (see primaryContext): the
	// alert palettes outrank the theme and every text mode on the face, so
	// they must outrank them in the panel too.
	// Without the live path (a caller that passes none) the key's rules are
	// compared once, as the face compares them at "Alert after: Immediately";
	// with no new alert fields that is exactly the 1.7.1 comparison.
	const level = alertsRecolor ? (extras.keyAlerts?.face.level ?? immediateLevel(parseAlertConfig(settings), reading, 0, opts.fahrenheit)) : "normal";
	// A dial's type palette changes only accent (selection graphics/badges),
	// not the background/value/unit tokens used by this compact live preview.
	const palette = resolvePalette(config, themeId, null, level);
	const textSettings = effectiveTextFor(settings);
	const text = resolveTextColors(palette, textSettings, level);
	let background = palette.bg;
	let valueColor = text.value;
	let statsColor = text.unit;
	// Keys and the single dial keep their existing presentation. An overview
	// preview follows the actual selected row, including its alias spelling:
	// a curated row or the provider's own entry can outrank the saved key.
	const view = alertsRecolor ? "single" : dialViewOf(settings);
	// The text the face shows for the reading: its own format when it has
	// one (an overview's selected row resolves through its own keys), the
	// same options the face formats it with; alerts below keep HWiNFO's unit.
	let shownReading: Reading = reading;
	if (view !== "single") {
		const list = stepListOf(settings, reading.key, rotationGroupsOf(settings.rotationGroups), status.snapshot);
		const rowCount = view === "tworow" ? 2 : 3;
		const window = overviewWindow(list.length === 0 ? [reading] : list, reading.key, rowCount);
		const selected = window.rows[window.selectedIndex];
		shownReading = selected ?? reading;
		const colors = overviewRowColors({ settings, reading: selected ?? reading, level: shownIn(extras.alerts, selected ?? reading)?.level, shownValue: reading.value,
			selected: selected !== undefined, rowCount, palette, config, themeId, typeAccents: typeAccentsEnabled(), textSettings });
		background = colors.background;
		valueColor = colors.value;
		statsColor = colors.text.unit;
	}
	const shownOpts = measureFor(opts, settings.readingFormats, shownReading);
	const m = formatMeasurement(reading.value, reading.unit, shownOpts);
	payload.display = {
		value: m.valueText,
		unit: m.unitText,
		stats: status.source === "gadget" ? t("preview.statsGadget") : t("preview.stats", { min: formatStat(reading.valueMin, reading.unit, shownOpts), max: formatStat(reading.valueMax, reading.unit, shownOpts), avg: formatStat(reading.valueAvg, reading.unit, shownOpts) }),
		bg: background,
		valueColor,
		statsColor
	};
	const displayUnit = convertUnit(reading.value, reading.unit, opts.fahrenheit).unit;
	payload.reading = { label: reading.label, source: status.snapshot.sensors[reading.sensorIndex]?.name ?? "", unit: displayUnit };
	payload.effective = effectiveOf(settings, extras.kind, { unit: reading.unit, displayUnit, value: convertUnit(reading.value, reading.unit, opts.fahrenheit).value, nativeValue: reading.value }, extras);
	if (extras.kind === "dial") {
		payload.effective.readingAlert = dialReadingAlertOf(settings, reading, opts.fahrenheit, shownIn(extras.alerts, reading));
	}
	const formats = settings.readingFormats;
	if (extras.kind !== undefined && typeof formats === "object" && formats !== null && !Array.isArray(formats)) {
		payload.effective.formatFallback = formatFallbackOf(settings, opts, status.snapshot, extras.kind, extras.kind === "dial" ? extras.dialStats : undefined);
	}
	return payload;
}

/** A reading's shown alert from a dial's step, or undefined without one. */
function shownIn(alerts: DialAlertView | undefined, reading: Reading): ShownAlert | undefined {
	return alerts === undefined ? undefined : (alerts.get(reading.key) ?? NORMAL_SHOWN);
}

/** The reading on a dial, as its Alerts section needs it (resolved with the
 * functions the face uses: ruleFor, alertFlags, the store's shown alert). */
function dialReadingAlertOf(settings: PreviewSettings, reading: Reading, fahrenheit: boolean, shown: ShownAlert | undefined): PreviewReadingAlert {
	const raw: AlertSettings = settings;
	const config = parseAlertConfig(raw);
	const rule = ruleFor(config, "dial", reading, 0);
	const alert = shown ?? instantAlert(config, "dial", reading, 0, fahrenheit);
	return {
		key: reading.key,
		ruleKey: readingRuleOf(config, reading)?.key ?? null,
		displayUnit: convertUnit(reading.value, reading.unit, fahrenheit).unit,
		source: rule === null ? null : rule.source,
		legacyApplies: legacyScopeApplies(raw.alertUnit, reading.unit),
		level: alert.level,
		snoozed: alert.snoozed,
		flags: alertFlags(config, "dial", reading, 0, fahrenheit).map((flag) => ({ code: flag.code, message: flag.message })),
		dwellMs: config.dwellMs,
		snoozeMs: config.snoozeMs ?? DEFAULT_COMMAND_SNOOZE_MS,
		legacyUnit: legacyLimitUnit(config.legacy, convertUnit(reading.value, reading.unit, fahrenheit).unit)
	};
}

/**
 * The effective presentation of one action, resolved by the same authorities
 * the faces use: effectiveThemeFor + the palette table (an unknown stored id
 * draws the spec default), parseTextSettings/effectiveTextFor/appliedTextMode
 * for the Text precedence, parseThreshold/alertLevel/thresholdsApplyTo for
 * alerts, drawnKeyLayout, the detail parsers, and resolveControls.
 */
function effectiveOf(settings: PreviewSettings, kind: "key" | "dial" | undefined, live: { unit: string; displayUnit: string; value: number; nativeValue: number } | undefined, extras: PreviewExtras = {}): PreviewEffective {
	const config = loadThemes();
	const id = effectiveThemeFor(settings);
	// Own themes only: a stored "constructor" draws the spec default.
	const known = Object.hasOwn(config.themes, id);
	const drawn = known ? id : config.defaultTheme;
	const own = typeof settings.theme === "string" && settings.theme !== "";
	const text = effectiveTextFor(settings);
	const warn = parseThreshold(settings.warnValue) ?? null;
	const crit = parseThreshold(settings.critValue) ?? null;
	const below = settings.alertBelow === true;
	// The dial compares the stored anchor as it is (thresholdsApplyTo): any
	// value other than absent or the reading's own unit, junk included,
	// keeps its thresholds off. The Alerts line names that scope in the unit
	// the dial shows those readings in: °C is °F with °F on.
	const anchor = (settings as Record<string, unknown>).alertUnit;
	const scopeUnit = kind === "dial" && typeof anchor === "string" ? convertUnit(0, anchor, settings.fahrenheit === true).unit : null;
	const applies = live === undefined ? false : kind === "dial" ? thresholdsApplyTo(anchor as string | undefined, live.unit) : true;
	// Warn at and Critical at (a key's and a dial's alike) are in the unit
	// they were typed in once the panel stamped it (alertDisplayUnit,
	// converted across °C and °F), else in the displayed unit exactly as
	// 1.7.1: the summary prints that unit, and the one-shot comparison below
	// uses it. Off a dial's scope, the scope unit stands in for the
	// displayed unit.
	const shown = live === undefined ? undefined : scopeUnit !== null && !applies ? scopeUnit : live.displayUnit;
	const unit = shown === undefined ? null : legacyLimitUnit(parseAlertConfig(settings).legacy, shown);
	const compared = live === undefined || unit === null ? undefined : unit === live.displayUnit ? live.value : valueInUnit(live.nativeValue, live.unit, unit);
	// A key's live alert path (dwell, recovery band, snooze, every drawn
	// reading) outranks the one-shot comparison of the legacy pair.
	const level = kind === "key" && extras.keyAlerts !== undefined ? extras.keyAlerts.face.level : compared !== undefined && applies ? alertLevel(compared, warn ?? undefined, crit ?? undefined, below) : "normal";
	const effective: PreviewEffective = {
		theme: { id, drawn, own, unknown: own && !known },
		text: { mode: text.mode, applied: appliedTextMode(text), own: parseTextSettings(settings) !== null, color: text.color ?? null, dimSecondary: text.dimSecondary },
		typeAccents: typeAccentsEnabled() && !config.typeAccentsDisabledOn.includes(drawn),
		dataUnits: getDataUnits(),
		alert: { level, warn, crit, below, unit, applies, scopeUnit }
	};
	const raw = settings as Record<string, unknown>;
	if (kind === "key") {
		effective.layout = { chosen: typeof raw.keyLayout === "string" ? raw.keyLayout : "single", drawn: drawnKeyLayout(raw) };
		effective.press = { behavior: pressBehaviorOf(raw), role: detailRoleOf(raw) ?? null, detailMode: detailModeOf(raw), density: detailDensityOf(raw) };
		if (extras.keyAlerts !== undefined) effective.keyAlerts = extras.keyAlerts;
	} else if (kind === "dial") {
		const scheme = resolveControls(raw as Parameters<typeof resolveControls>[0]);
		effective.controls = {
			preset: scheme.preset,
			rotate: scheme.rotate,
			pressedRotate: scheme.pressedRotate,
			shortPress: scheme.shortPress,
			longPress: scheme.longPress,
			tap: scheme.tap,
			touchHold: scheme.touchHold,
			touchZones: scheme.touchZones,
			switchesGroups: schemeCanSwitchGroups(scheme)
		};
	}
	return effective;
}

/**
 * Answers a PI request message; both sensor actions delegate their
 * onSendToPlugin here (the PIs share pi-common.js and speak one protocol).
 */
export function handlePiRequest(payload: JsonValue): void {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
		return;
	}
	// The Reading links and Calculated readings editors (both plugin-wide).
	if (handleEditorRequest(payload)) return;
	if (payload.event === "getSensorTree") {
		void streamDeck.ui.sendToPropertyInspector(buildSensorTree(poller.getStatus()));
	} else if (payload.event === "getThemes") {
		void streamDeck.ui.sendToPropertyInspector(buildThemesPayload());
	} else if (payload.event === "getSupportReport") {
		void streamDeck.ui.sendToPropertyInspector(buildSupportReportPayload(payload.requestId));
	} else if (payload.event === "getDetailSupport") {
		void streamDeck.ui.sendToPropertyInspector(buildDetailSupportPayload());
	} else if (payload.event === "getDetailPreview") {
		void streamDeck.ui.sendToPropertyInspector(buildDetailPreviewPayload(payload.draft, payload.page));
	} else if (payload.event === "getOwnLooks") {
		// Advanced, Shared defaults: the count line under the shared
		// Background (src/ui/shared-looks.ts).
		void streamDeck.ui.sendToPropertyInspector({ event: "ownLooks", ...ownLooksCount() });
	} else if (payload.event === "getPanelFolds" || payload.event === "setPanelFolds") {
		// Which sections a person keeps open: a view preference held in the
		// plugin's memory (src/panel-folds.ts), never in settings or on disk.
		const kind = panelKindOf(payload.kind);
		if (kind === undefined) return;
		if (payload.event === "setPanelFolds") {
			panelFolds.set(kind, payload.folds);
		} else {
			void streamDeck.ui.sendToPropertyInspector({ event: "panelFolds", kind, folds: panelFolds.get(kind) });
		}
	}
}

/** The last face and preview pushed to the open panel, per panel context:
 * a face rides a preview only when it changed or the panel asked
 * (getPreview), and a preview identical to the last one is not sent at all.
 * HWiNFO publishes every 2 s while reads run every second by default
 * (every 250 ms at the fastest), so at the default or faster half the
 * ticks or more carry nothing new (bench 2026-09-23: about four identical
 * previews a second). Reset when another panel opens or one asks. */
let lastPanelFace = { context: "", face: "", preview: "" };

/** Makes the next push carry the face even when unchanged (panel request). */
export function forgetPanelFace(): void {
	lastPanelFace = { context: "", face: "", preview: "" };
}

/** Live numbers for the PI while it is open on one of the caller's instances
 *  (the manifestId check keeps each action class feeding only its own PI).
 *  `faceOf` reads the frame the action last sent to the device; nothing is
 *  rendered for the panel, so a closed panel costs no work at all. */
export function pushPreviewToPi(status: PollerStatus, manifestId: string | undefined, instances: { get(id: string): { settings: PreviewSettings; alertShown?: DialAlertView } | undefined }, alertsRecolor: boolean, faceOf?: (id: string) => string | undefined, extrasOf?: (id: string) => Pick<PreviewExtras, "keyAlerts" | "strip" | "dialStats">): void {
	const piAction = streamDeck.ui.action;
	if (piAction === undefined || piAction.manifestId !== manifestId) {
		return;
	}
	const state = instances.get(piAction.id);
	const current = faceOf?.(piAction.id) ?? "";
	const changed = lastPanelFace.context !== piAction.id || lastPanelFace.face !== current;
	if (changed) {
		lastPanelFace = { context: piAction.id, face: current, preview: "" };
	}
	const kind = alertsRecolor ? "key" : "dial";
	const more = state === undefined ? {} : (extrasOf?.(piAction.id) ?? {});
	const preview = buildPreview(status, state?.settings, alertsRecolor, { context: piAction.id, kind, face: changed ? current : undefined, holding: poller.isHolding(), alerts: alertsRecolor ? undefined : state?.alertShown, ...more });
	const body = JSON.stringify(preview);
	if (body === lastPanelFace.preview) {
		return; // nothing new for the panel this tick
	}
	lastPanelFace.preview = body;
	void streamDeck.ui.sendToPropertyInspector(preview);
}
