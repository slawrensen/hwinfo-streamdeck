/**
 * Message shapes exchanged with the property inspector pages (ui/pi-common.js).
 * All are `type` aliases (not interfaces) so they satisfy the SDK's JsonValue.
 */
import streamDeck from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { detailProfileFor } from "./detail/managed-profiles";
import { deviceCapabilities } from "./devices";
import { buildSupportReport } from "./diagnostics";
import { poller, type PollerStatus } from "./poller";
import { overviewWindow, rotationGroupsOf } from "./rotation";
import { dialViewOf, overviewRowColors, stepListOf } from "./ui/dial-overview";
import { alertLevel, convertUnit, parseThreshold, type DecimalsSetting } from "./ui/format";
import { formatMeasurement, formatStat, type MeasureOptions } from "./ui/measure";
import { statusSentence } from "./ui/state-screens";
import { resolveTextColors } from "./ui/text-colors";
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
	alertUnit?: string;
	dialView?: string;
	readingColors?: unknown;
	sensorValueColors?: unknown;
	rotationGroups?: unknown;
} & Parameters<typeof stepListOf>[0];

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
				keys: [reading.key, ...(reading.linkedKeys ?? []).filter((key) => key !== reading.key)],
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
 * key faces flip their whole palette on warn/crit, dial faces stay themed. */
export function buildPreview(status: PollerStatus, settings: PreviewSettings | undefined, alertsRecolor: boolean): PreviewPayload {
	const payload: PreviewPayload = {
		event: "preview",
		state: status.state,
		hint: statusSentence(status),
		missing: false
	};
	if (status.state !== "unavailable") {
		payload.source = status.source;
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
	if (view !== "single") {
		const list = stepListOf(settings, reading.key, rotationGroupsOf(settings.rotationGroups), status.snapshot);
		const rowCount = view === "tworow" ? 2 : 3;
		const window = overviewWindow(list.length === 0 ? [reading] : list, reading.key, rowCount);
		const selected = window.rows[window.selectedIndex];
		const colors = overviewRowColors({ settings, reading: selected ?? reading, shownValue: reading.value,
			selected: selected !== undefined, rowCount, palette, config, themeId, typeAccents: typeAccentsEnabled(), textSettings });
		background = colors.background;
		valueColor = colors.value;
		statsColor = colors.text.unit;
	}
	payload.display = {
		value: m.valueText,
		unit: m.unitText,
		stats: status.source === "gadget" ? "Historical statistics unavailable in Gadget" : `min ${formatStat(reading.valueMin, reading.unit, opts)} · max ${formatStat(reading.valueMax, reading.unit, opts)} · avg ${formatStat(reading.valueAvg, reading.unit, opts)}`,
		bg: background,
		valueColor,
		statsColor
	};
	return payload;
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

/** Live numbers for the PI while it is open on one of the caller's instances
 *  (the manifestId check keeps each action class feeding only its own PI). */
export function pushPreviewToPi(status: PollerStatus, manifestId: string | undefined, instances: { get(id: string): { settings: PreviewSettings } | undefined }, alertsRecolor: boolean): void {
	const piAction = streamDeck.ui.action;
	if (piAction === undefined || piAction.manifestId !== manifestId) {
		return;
	}
	const state = instances.get(piAction.id);
	void streamDeck.ui.sendToPropertyInspector(buildPreview(status, state?.settings, alertsRecolor));
}
