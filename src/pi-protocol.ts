/**
 * Message shapes exchanged with the property inspector pages (ui/pi-common.js).
 * All are `type` aliases (not interfaces) so they satisfy the SDK's JsonValue.
 */
import streamDeck from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { detailDensityOf, detailModeOf, detailRoleOf, pressBehaviorOf } from "./detail/detail-settings";
import { detailProfileFor } from "./detail/managed-profiles";
import { deviceCapabilities } from "./devices";
import { buildSupportReport } from "./diagnostics";
import { poller, type PollerStatus } from "./poller";
import { resolveControls, schemeCanSwitchGroups } from "./controls";
import { alertLevel, convertUnit, parseThreshold, thresholdsApplyTo, type DecimalsSetting } from "./ui/format";
import { drawnKeyLayout } from "./ui/key-layout";
import { formatMeasurement, formatStat, type MeasureOptions } from "./ui/measure";
import { statusSentence } from "./ui/state-screens";
import { appliedTextMode, parseTextSettings, resolveTextColors } from "./ui/text-colors";
import { effectiveTextFor, effectiveThemeFor, getDataUnits, getDeckTheme, measureOptionsFrom, typeAccentsEnabled } from "./ui/theme-store";
import { loadThemes, resolvePalette } from "./ui/themes";

type TreeReading = {
	key: string;
	label: string;
	unit: string;
	value: number;
	type: number;
	/** Formatted through the runtime's own measurement authority, under the
	 * deck-wide data-unit preference, so picker rows can never drift from
	 * what the key or dial face shows. */
	display: string;
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
};

type TreeGroup = {
	name: string;
	/** The raw source name ("" for an orphan reading): what the runtime's
	 * detail filter matches against, so the PI's live match counter can
	 * use the same candidate while `name` keeps the display fallback. */
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
};

type PreviewEffective = {
	/** drawn: the palette actually used (an unknown id draws the spec default). */
	theme: { id: string; drawn: string; own: boolean; unknown: boolean };
	/** applied: Custom without a valid color draws theme text. */
	text: { mode: string; applied: string; own: boolean; color: string | null; dimSecondary: boolean };
	/** Type accents on AND not suppressed by the drawn theme. */
	typeAccents: boolean;
	dataUnits: string;
	/** Parsed thresholds in display units; scopeUnit is the dial's stamp. */
	alert: { level: string; warn: number | null; crit: number | null; below: boolean; unit: string | null; applies: boolean; scopeUnit: string | null };
	layout?: { chosen: string; drawn: string };
	press?: { behavior: string; role: string | null; detailMode: string; density: number };
	controls?: { preset: string; rotate: string; pressedRotate: string; shortPress: string; longPress: string; tap: string; touchHold: string; touchZones: string; switchesGroups: boolean };
};

/** Faces longer than this (UTF-16 code units) are never carried to the
 * panel (bounded messages); the panel is told to clear its picture instead
 * of keeping an older frame. */
const MAX_FACE_CHARS = 64 * 1024;

export type PreviewExtras = {
	context?: string;
	kind?: "key" | "dial";
	face?: string;
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
	return JSON.parse(JSON.stringify({ event: "themes", effectiveDeckTheme: getDeckTheme(), ...loadThemes() })) as JsonValue;
}

/**
 * Whether the OPEN action's device has a bundled detail profile. Answered
 * from the managed-profile registry so the PI never carries its own device
 * table; `model` is the human name for the honest unsupported note.
 */
export function buildDetailSupportPayload(): JsonValue {
	const deviceId = streamDeck.ui.action?.device.id;
	const caps = deviceId === undefined ? undefined : deviceCapabilities.get(deviceId);
	const profile = detailProfileFor(caps?.type, caps === undefined ? undefined : { columns: caps.columns, rows: caps.rows });
	return {
		event: "detailSupport",
		supported: profile !== undefined,
		model: caps?.model ?? "unknown device"
	};
}

/** The redacted support report, for the PI's "Copy support report" button. */
export function buildSupportReportPayload(): JsonValue {
	const info = streamDeck.info;
	return {
		event: "supportReport",
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
				group = { name: source ?? "Unknown sensor", matchName: source ?? "", readings: [] };
				byIndex.set(reading.sensorIndex, group);
				groups.push(group);
			}
			const m = formatMeasurement(reading.value, reading.unit, treeOpts);
			group.readings.push({
				key: reading.key,
				label: reading.label,
				unit: reading.unit,
				value: reading.value,
				type: reading.type,
				display: `${m.valueText} ${m.unitText}`.trim()
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
	if (status.state !== "unavailable") {
		payload.source = status.source;
	}
	if (settings !== undefined) {
		payload.effective = effectiveOf(settings, extras.kind, undefined);
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
	const m = formatMeasurement(reading.value, reading.unit, opts);
	const config = loadThemes();
	const themeId = effectiveThemeFor(settings);
	// The key face's alert precedence, mirrored (see primaryContext): the
	// alert palettes outrank the theme and every text mode on the face, so
	// they must outrank them in the panel too.
	const level = alertsRecolor ? alertLevel(convertUnit(reading.value, reading.unit, opts.fahrenheit).value, parseThreshold(settings.warnValue), parseThreshold(settings.critValue), settings.alertBelow === true) : "normal";
	const palette = resolvePalette(config, themeId, null, level);
	const text = resolveTextColors(palette, effectiveTextFor(settings), level);
	payload.display = {
		value: m.valueText,
		unit: m.unitText,
		stats: `min ${formatStat(reading.valueMin, reading.unit, opts)} · max ${formatStat(reading.valueMax, reading.unit, opts)} · avg ${formatStat(reading.valueAvg, reading.unit, opts)}`,
		bg: palette.bg,
		valueColor: text.value,
		statsColor: text.unit
	};
	const displayUnit = convertUnit(reading.value, reading.unit, opts.fahrenheit).unit;
	payload.reading = { label: reading.label, source: status.snapshot.sensors[reading.sensorIndex]?.name ?? "", unit: displayUnit };
	payload.effective = effectiveOf(settings, extras.kind, { unit: reading.unit, displayUnit, value: convertUnit(reading.value, reading.unit, opts.fahrenheit).value });
	return payload;
}

/**
 * The effective presentation of one action, resolved by the same authorities
 * the faces use: effectiveThemeFor + the palette table (an unknown stored id
 * draws the spec default), parseTextSettings/effectiveTextFor/appliedTextMode
 * for the Text precedence, parseThreshold/alertLevel/thresholdsApplyTo for
 * alerts, drawnKeyLayout, the detail parsers, and resolveControls.
 */
function effectiveOf(settings: PreviewSettings, kind: "key" | "dial" | undefined, live: { unit: string; displayUnit: string; value: number } | undefined): PreviewEffective {
	const config = loadThemes();
	const id = effectiveThemeFor(settings);
	const drawn = config.themes[id] !== undefined ? id : config.defaultTheme;
	const own = typeof settings.theme === "string" && settings.theme !== "";
	const text = effectiveTextFor(settings);
	const warn = parseThreshold(settings.warnValue) ?? null;
	const crit = parseThreshold(settings.critValue) ?? null;
	const below = settings.alertBelow === true;
	// The dial compares the stored anchor as it is (thresholdsApplyTo): any
	// value other than absent or the reading's own unit, junk included,
	// keeps its thresholds off.
	const anchor = (settings as Record<string, unknown>).alertUnit;
	const scopeUnit = kind === "dial" && typeof anchor === "string" ? anchor : null;
	const applies = live === undefined ? false : kind === "dial" ? thresholdsApplyTo(anchor as string | undefined, live.unit) : true;
	const level = live !== undefined && applies ? alertLevel(live.value, warn ?? undefined, crit ?? undefined, below) : "normal";
	const effective: PreviewEffective = {
		theme: { id, drawn, own, unknown: own && config.themes[id] === undefined },
		text: { mode: text.mode, applied: appliedTextMode(text), own: parseTextSettings(settings) !== null, color: text.color ?? null, dimSecondary: text.dimSecondary },
		typeAccents: typeAccentsEnabled() && !config.typeAccentsDisabledOn.includes(drawn),
		dataUnits: getDataUnits(),
		alert: { level, warn, crit, below, unit: live?.displayUnit ?? null, applies, scopeUnit }
	};
	const raw = settings as Record<string, unknown>;
	if (kind === "key") {
		effective.layout = { chosen: typeof raw.keyLayout === "string" ? raw.keyLayout : "single", drawn: drawnKeyLayout(raw) };
		effective.press = { behavior: pressBehaviorOf(raw), role: detailRoleOf(raw) ?? null, detailMode: detailModeOf(raw), density: detailDensityOf(raw) };
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
	if (payload.event === "getSensorTree") {
		void streamDeck.ui.sendToPropertyInspector(buildSensorTree(poller.getStatus()));
	} else if (payload.event === "getThemes") {
		void streamDeck.ui.sendToPropertyInspector(buildThemesPayload());
	} else if (payload.event === "getSupportReport") {
		void streamDeck.ui.sendToPropertyInspector(buildSupportReportPayload());
	} else if (payload.event === "getDetailSupport") {
		void streamDeck.ui.sendToPropertyInspector(buildDetailSupportPayload());
	}
}

/** The last face and preview pushed to the open panel, per panel context:
 * a face rides a preview only when it changed or the panel asked
 * (getPreview), and a preview identical to the last one is not sent at all.
 * HWiNFO publishes every 2 s while reads run every 250 ms, so most ticks
 * carry nothing new (bench 2026-09-23: about four identical previews a
 * second). Reset when another panel opens or one asks. */
let lastPanelFace = { context: "", face: "", preview: "" };

/** Makes the next push carry the face even when unchanged (panel request). */
export function forgetPanelFace(): void {
	lastPanelFace = { context: "", face: "", preview: "" };
}

/** Live numbers for the PI while it is open on one of the caller's instances
 *  (the manifestId check keeps each action class feeding only its own PI).
 *  `faceOf` reads the frame the action last sent to the device; nothing is
 *  rendered for the panel, so a closed panel costs no work at all. */
export function pushPreviewToPi(status: PollerStatus, manifestId: string | undefined, instances: { get(id: string): { settings: PreviewSettings } | undefined }, alertsRecolor: boolean, faceOf?: (id: string) => string | undefined): void {
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
	const preview = buildPreview(status, state?.settings, alertsRecolor, { context: piAction.id, kind, face: changed ? current : undefined });
	const body = JSON.stringify(preview);
	if (body === lastPanelFace.preview) {
		return; // nothing new for the panel this tick
	}
	lastPanelFace.preview = body;
	void streamDeck.ui.sendToPropertyInspector(preview);
}
