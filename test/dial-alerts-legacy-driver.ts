/**
 * A recorded tick sequence and a matrix of Sensor Dial settings that carry
 * only the 1.7.1 alert fields (Warn at, Critical at, the direction, the
 * alertUnit scope, the bar range, the °F box) across every view, background
 * and a spread of themes. The faces composed here must stay byte for byte
 * what 1.7.1 composed: test/golden/dial-alerts-legacy-faces.json holds the
 * SHA-256 of every face this module composed against the integration base
 * (claude/release-1.8.0 at 616964b, whose dial alert code is v1.7.1's),
 * where nothing stepped an alert store.
 *
 * The one deliberate exception is Ember's single view while a warning shows
 * (owner decision, Option B): its accent sits within CIEDE2000 10 of the
 * warning fill, so the bar's track is lit in the zone shade. The test proves
 * that face is the 1.7.1 face plus exactly that one track rectangle.
 *
 * The driver imports nothing from src/alerts, so it runs unchanged against
 * the base sources; the caller passes in how the alert view is made each
 * tick (the production stepDialAlerts in the test, nothing for the golden).
 */
import { composeDialSvg, type DialSettings } from "../src/actions/sensor-dial";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { SessionStatsStore } from "../src/stats";

export const T1 = "a1:0:1";
export const F1 = "a1:0:2";
export const Y1 = "a1:0:3";
export const P1 = "b2:0:4";
export const V1 = "b2:0:5";

const WARN_CRIT = { warnValue: "80", critValue: "95" };

/** Legacy alert settings only: no field this release adds. */
export const DIAL_CASES: Readonly<Record<string, Record<string, unknown>>> = {
	"single, unscoped": { readingKey: T1, ...WARN_CRIT },
	"single, scoped to °C": { readingKey: T1, ...WARN_CRIT, alertUnit: "°C" },
	"single, scoped to RPM (another unit)": { readingKey: T1, ...WARN_CRIT, alertUnit: "RPM" },
	"single, unitless scope": { readingKey: T1, ...WARN_CRIT, alertUnit: "" },
	"single, junk scope": { readingKey: T1, ...WARN_CRIT, alertUnit: 5 },
	"single, fan below": { readingKey: F1, warnValue: "600", critValue: "400", alertBelow: true, alertUnit: "RPM" },
	"single, below flag junk": { readingKey: F1, warnValue: "600", critValue: "400", alertBelow: "true", alertUnit: "RPM" },
	"single, °F on": { readingKey: T1, warnValue: "176", critValue: "203", alertUnit: "°C", fahrenheit: true },
	"single, junk warn and decimal comma": { readingKey: T1, warnValue: "abc", critValue: "95,5" },
	"single, inverted pair": { readingKey: T1, warnValue: "95", critValue: "80" },
	"single, equal pair": { readingKey: T1, warnValue: "90", critValue: "90" },
	"single, warn only": { readingKey: T1, warnValue: "85" },
	"single, crit only": { readingKey: T1, critValue: "90" },
	"single, Yes/No legacy stamp": { readingKey: Y1, critValue: "1", alertUnit: "Yes" },
	"single, bar range": { readingKey: T1, ...WARN_CRIT, alertUnit: "°C", barMin: "40", barMax: "110" },
	"single, Glass": { readingKey: T1, ...WARN_CRIT, dialBackground: "glass" },
	"single, Tint": { readingKey: T1, ...WARN_CRIT, dialBackground: "tint", dialAccentWords: true },
	"single, Outline": { readingKey: T1, ...WARN_CRIT, dialBackground: "outline" },
	"single, Clear": { readingKey: T1, ...WARN_CRIT, dialBackground: "clear" },
	"single, Paper": { readingKey: T1, ...WARN_CRIT, theme: "paper" },
	"single, Forest": { readingKey: P1, warnValue: "150", critValue: "200", theme: "forest" },
	"single, Ember": { readingKey: T1, ...WARN_CRIT, theme: "ember" },
	"single, Ember voltage (no type accent)": { readingKey: V1, warnValue: "1.2", critValue: "1.4", theme: "ember" },
	"single, Ember fan below": { readingKey: F1, warnValue: "600", critValue: "400", alertBelow: true, theme: "ember" },
	"overview, scoped to °C": { dialView: "overview", readingKey: T1, rotationKeys: [T1, F1, P1], ...WARN_CRIT, alertUnit: "°C" },
	"overview, unscoped": { dialView: "overview", readingKey: F1, rotationKeys: [T1, F1, P1, Y1], ...WARN_CRIT },
	"overview, no set (the sensor's readings)": { dialView: "overview", readingKey: T1, ...WARN_CRIT },
	"overview, Ember": { dialView: "overview", readingKey: T1, rotationKeys: [T1, F1, P1], ...WARN_CRIT, theme: "ember" },
	"overview, groups (Elite)": { dialView: "overview", readingKey: T1, controlPreset: "elite", rotationGroups: [{ name: "Temps", keys: [T1, Y1] }, { name: "Power", keys: [P1, F1] }], rotationKeys: [T1, Y1, P1, F1], ...WARN_CRIT },
	"two rows, scoped to °C": { dialView: "tworow", readingKey: T1, rotationKeys: [T1, F1, Y1], ...WARN_CRIT, alertUnit: "°C" },
	"two rows, fan below on Outline": { dialView: "tworow", readingKey: F1, rotationKeys: [T1, F1], warnValue: "600", critValue: "400", alertBelow: true, dialBackground: "outline" },
	"single, power under a °C scope with auto cycle settings": { readingKey: P1, rotationKeys: [T1, F1, P1], ...WARN_CRIT, alertUnit: "°C", autoCycleMs: "2000", alertInterrupt: true }
};

/** The temperature crosses warn and critical (limits hit exactly), drops
 * back, and reports a non-finite value once (the voltage follows the same
 * pattern against its own limits); the fan falls through both
 * low limits; the Yes/No reading flips; one frame withholds the fan. */
const TEMPS = [60, 79.9, 80, 85, 95, 96, 94.9, 80, 79, Number.NaN, 97, 70];
const FANS = [1200, 700, 600, 550, 400, 300, 450, 650, 900, 300, 1000, 1200];
const FLAGS = [0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0];
const POWER = [90, 120, 151, 180, 205, 230, 199, 140, 100, 160, 210, 95];
const VOLTS = [1.0, 1.19, 1.2, 1.3, 1.4, 1.45, 1.39, 1.2, 1.1, Number.NaN, 1.5, 1.0];

export const TICKS = TEMPS.length;

export function frame(tick: number): SensorSnapshot {
	const readings: Reading[] = [
		{ key: T1, type: SensorType.Temperature, sensorIndex: 0, id: 1, label: "CPU Package", unit: "°C", value: TEMPS[tick] ?? 0, valueMin: 38, valueMax: 99, valueAvg: 70 },
		{ key: F1, type: SensorType.Fan, sensorIndex: 0, id: 2, label: "CPU Fan", unit: "RPM", value: FANS[tick] ?? 0, valueMin: 300, valueMax: 1600, valueAvg: 900 },
		{ key: Y1, type: SensorType.Other, sensorIndex: 0, id: 3, label: "Thermal Throttling", unit: "Yes/No", value: FLAGS[tick] ?? 0, valueMin: 0, valueMax: 1, valueAvg: 0 },
		{ key: P1, type: SensorType.Power, sensorIndex: 1, id: 4, label: "GPU Power", unit: "W", value: POWER[tick] ?? 0, valueMin: 80, valueMax: 240, valueAvg: 150 },
		{ key: V1, type: SensorType.Voltage, sensorIndex: 1, id: 5, label: "GPU Core Voltage", unit: "V", value: VOLTS[tick] ?? 0, valueMin: 0.9, valueMax: 1.5, valueAvg: 1.2 }
	].filter((r) => !(tick === 7 && r.key === F1));
	return {
		pollTime: tick,
		version: 1,
		revision: 1,
		sensors: [{ index: 0, id: 0xa1, instance: 0, name: "CPU" }, { index: 1, id: 0xb2, instance: 0, name: "GPU" }],
		readings,
		byKey: new Map(readings.map((r) => [r.key, r]))
	};
}

/** What the caller hands the face each tick as its alert view (absent in a
 * build without an alert store). */
export type AlertsFor = (caseName: string, settings: DialSettings, status: PollerStatus, now: number) => unknown;

/**
 * Composes every case at every tick, after observing the tick into that
 * case's own session stats exactly like the dial does. `alertsFor` runs
 * before the face is composed, like the dial's tick step.
 */
export function legacyDialFaces(alertsFor?: AlertsFor): Record<string, string[]> {
	const faces: Record<string, string[]> = {};
	for (const [name, raw] of Object.entries(DIAL_CASES)) {
		const settings = raw as DialSettings;
		const stats = new SessionStatsStore();
		const list: string[] = [];
		for (let tick = 0; tick < TICKS; tick++) {
			const snapshot = frame(tick);
			const status: PollerStatus = { state: "ok", snapshot, source: "shared-memory" };
			for (const reading of snapshot.readings) stats.observe(reading, snapshot, "shared-memory");
			const alertShown = alertsFor?.(name, settings, status, 1000 + tick * 2000);
			const state = { settings, stats, statMode: "current" as const, overlay: null, pinned: false, cyclePaused: false, ...(alertShown === undefined ? {} : { alertShown }) };
			list.push(composeDialSvg(state as Parameters<typeof composeDialSvg>[0], status, () => [1, 2, 3, 2, 4]));
		}
		faces[name] = list;
	}
	return faces;
}
