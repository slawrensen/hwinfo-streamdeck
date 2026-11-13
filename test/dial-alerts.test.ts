/**
 * Per-reading alerts on the Sensor Dial: the dial's side of the alert
 * store's tick contract (src/alerts/dial.ts), the critical hunt, the face,
 * the overview rows, Ember Option B, the snooze gesture and the HWiNFO
 * Control key's snooze commands, and the panel preview's reading payload.
 *
 * Action-level tests construct the real SensorDialAction (its tick listener
 * sits on the poller, its command handler on the Control bus) and replace
 * only the SDK's sends, the poller's retain/release/status/hold, the panel
 * push and the clock. Each test file runs in its own process, so the alert
 * store singleton here is this file's alone; every test uses its own
 * contexts.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { SensorDialAction, composeDialSvg, type DialSettings, type InstanceState } from "../src/actions/sensor-dial";
import { criticalKeysOf, dialAlertReadings, stepDialAlerts, type DialAlertView } from "../src/alerts/dial";
import { instantAlert } from "../src/alerts/instant";
import { parseAlertConfig } from "../src/alerts/rules";
import { AlertStore, alertStore } from "../src/alerts/store";
import type { ShownAlert } from "../src/alerts/types";
import { dispatchDialCommand, type ControlCommandId } from "../src/commands";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { buildPreview } from "../src/pi-protocol";
import { poller, type PollerStatus } from "../src/poller";
import { SessionStatsStore } from "../src/stats";
import { alertTrackFill } from "../src/ui/alert-track";
import { dialSnoozeBandSvg } from "../src/ui/dial-renderer";
import { overviewRowColors } from "../src/ui/dial-overview";
import { alertLevel, convertUnit, parseThreshold, thresholdsApplyTo } from "../src/ui/format";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";
import { mixToward, type TextSettings } from "../src/ui/text-colors";
import { ZONE_BG_BLEND } from "../src/ui/gauge";
import { alertValueColor, loadThemes, resolvePalette } from "../src/ui/themes";

applyGlobalThemeSettings({ theme: "void" });

const T1 = "a1:0:1";
const T2 = "a1:0:2";
const T3 = "a1:0:3";
const FAN = "a1:0:4";
const V1 = "b2:0:5";
const ALIAS = "gadget:CPU:Package";

const CONFIG = loadThemes();
const WARN_FILL = CONFIG.alerts.warn.bg;
const CRIT_FILL = CONFIG.alerts.crit.bg;

type Values = Partial<Record<string, number>>;

/** CPU: three temperatures and a fan; GPU: a voltage (no type accent). A
 * value of undefined withholds the reading. Every snapshot carries the same
 * stamp unless `pollTime` names another, so ticks on it are held data. */
function snapshot(values: Values, extra: { alias?: boolean; pollTime?: number } = {}): SensorSnapshot {
	const spec: Array<[string, SensorType, number, string, string]> = [
		[T1, SensorType.Temperature, 0, "CPU Package", "°C"],
		[T2, SensorType.Temperature, 0, "CPU Core", "°C"],
		[T3, SensorType.Temperature, 0, "CPU SoC", "°C"],
		[FAN, SensorType.Fan, 0, "CPU Fan", "RPM"],
		[V1, SensorType.Voltage, 1, "GPU Core Voltage", "V"]
	];
	const readings: Reading[] = [];
	for (const [key, type, sensorIndex, label, unit] of spec) {
		const value = values[key];
		if (value === undefined) continue;
		readings.push({ key, type, sensorIndex, id: readings.length + 1, label, unit, value, valueMin: value, valueMax: value, valueAvg: value, ...(key === T1 && extra.alias === true ? { linkedKeys: [T1, ALIAS] } : {}) });
	}
	if (extra.alias === true && values[T1] !== undefined) {
		const own = readings.find((r) => r.key === T1);
		if (own !== undefined) readings.push({ ...own, key: ALIAS, aliasOf: T1 });
	}
	return {
		pollTime: extra.pollTime ?? 1,
		...(extra.pollTime === undefined ? {} : { valueRevision: extra.pollTime }),
		version: 1,
		revision: 1,
		sensors: [{ index: 0, id: 0xa1, instance: 0, name: "CPU" }, { index: 1, id: 0xb2, instance: 0, name: "GPU" }],
		readings,
		byKey: new Map(readings.map((r) => [r.key, r]))
	};
}

const ok = (values: Values, extra?: { alias?: boolean; pollTime?: number }): PollerStatus => ({ state: "ok", source: "shared-memory", snapshot: snapshot(values, extra) });
const STALE: PollerStatus = { state: "stale", source: "shared-memory", snapshot: snapshot({ [T1]: 99 }), staleForMs: 16_000 };
const UNAVAILABLE: PollerStatus = { state: "unavailable", reason: "not-running", message: "fixture" };

const THEME_TEXT: TextSettings = { mode: "theme", color: undefined, dimSecondary: false };
const NORMAL: ShownAlert = { level: "normal", snoozed: null };
const WARN: ShownAlert = { level: "warn", snoozed: null };
const CRIT: ShownAlert = { level: "crit", snoozed: null };

describe("the dial's referenced readings", () => {
	it("are the selection, the rotation set, every group member and the step list, one entry per spelling", () => {
		const settings: DialSettings = { readingKey: T1, rotationKeys: [T1, T2, "gone:0:1"], rotationGroups: [{ name: "Temps", keys: [T1, T2] }, { name: "Fan", keys: [FAN, "gone:0:1"] }] };
		const { found, missing } = dialAlertReadings(settings, snapshot({ [T1]: 50, [T2]: 50, [T3]: 50, [FAN]: 900, [V1]: 1 }));
		assert.deepEqual(found.map((r) => r.key).sort(), [FAN, T1, T2].sort());
		assert.deepEqual(missing, ["gone:0:1"]);
	});

	it("with no set, every reading of the selection's sensor (what rotation moves through)", () => {
		const { found, missing } = dialAlertReadings({ readingKey: T2 }, snapshot({ [T1]: 50, [T2]: 50, [T3]: 50, [FAN]: 900, [V1]: 1 }));
		assert.deepEqual(found.map((r) => r.key).sort(), [FAN, T1, T2, T3].sort());
		assert.deepEqual(missing, []);
	});

	it("an alias and its provider key are two spellings of one measurement", () => {
		const { found } = dialAlertReadings({ readingKey: ALIAS, rotationKeys: [ALIAS, T1] }, snapshot({ [T1]: 50 }, { alias: true }));
		assert.deepEqual(found.map((r) => r.key).sort(), [ALIAS, T1].sort());
	});
});

describe("one dial's alert generation (stepDialAlerts)", () => {
	const legacy: DialSettings = { readingKey: T1, rotationKeys: [T1, T2, T3], warnValue: "80", critValue: "95" };
	const at = (n: number): number => 10_000 + n * 2000;

	it("steps every referenced reading under the legacy pair, exactly as alertLevel reads each value", () => {
		const store = new AlertStore();
		const view = stepDialAlerts(store, "g1", legacy, ok({ [T1]: 85, [T2]: 95, [T3]: 60 }), at(0));
		assert.deepEqual(view.get(T1), WARN);
		assert.deepEqual(view.get(T2), CRIT);
		assert.deepEqual(view.get(T3), NORMAL);
	});

	it("an Alert after dwell holds a level back until it has stood for the whole time over valid readings", () => {
		const store = new AlertStore();
		const settings: DialSettings = { ...legacy, alertDwellMs: "5000" };
		const seen = [0, 1, 2, 3, 4].map((n) => stepDialAlerts(store, "g2", settings, ok({ [T1]: 85, [T2]: 50, [T3]: 50 }), at(n)).get(T1)?.level);
		// Entered at tick 0; 2000, 4000 short of 5000; 6000 and on shows.
		assert.deepEqual(seen, ["normal", "normal", "normal", "warn", "warn"]);
		const restarted = new AlertStore();
		const gapped = [
			stepDialAlerts(restarted, "g2b", settings, ok({ [T1]: 85, [T2]: 50, [T3]: 50 }), at(0)),
			stepDialAlerts(restarted, "g2b", settings, ok({ [T1]: 85, [T2]: 50, [T3]: 50 }), at(1)),
			stepDialAlerts(restarted, "g2b", settings, STALE, at(2)),
			stepDialAlerts(restarted, "g2b", settings, ok({ [T1]: 85, [T2]: 50, [T3]: 50 }), at(3)),
			stepDialAlerts(restarted, "g2b", settings, ok({ [T1]: 85, [T2]: 50, [T3]: 50 }), at(4)),
			stepDialAlerts(restarted, "g2b", settings, ok({ [T1]: 85, [T2]: 50, [T3]: 50 }), at(6))
		].map((view) => view.get(T1)?.level);
		assert.deepEqual(gapped, ["normal", "normal", undefined, "normal", "normal", "warn"], "a stale tick restarts the dwell");
	});

	it("a recovery band holds a level until the value is back past the limit by the band", () => {
		const store = new AlertStore();
		const settings: DialSettings = { ...legacy, alertHysteresis: "3" };
		const levels = [81, 79, 77, 76.9, 79.9, 80].map((value, n) => stepDialAlerts(store, "g3", settings, ok({ [T1]: value, [T2]: 50, [T3]: 50 }), at(n)).get(T1)?.level);
		assert.deepEqual(levels, ["warn", "warn", "warn", "normal", "normal", "warn"]);
	});

	it("a snoozed warning breaks through when the value reaches critical, and recovery ends the snooze", () => {
		const store = new AlertStore();
		assert.deepEqual(stepDialAlerts(store, "g4", legacy, ok({ [T1]: 85, [T2]: 50, [T3]: 50 }), at(0)).get(T1), WARN);
		assert.equal(store.snoozeContext("g4", at(0), 900_000), 1);
		assert.deepEqual(stepDialAlerts(store, "g4", legacy, ok({ [T1]: 88, [T2]: 50, [T3]: 50 }), at(1)).get(T1), { level: "normal", snoozed: "warn" });
		assert.deepEqual(stepDialAlerts(store, "g4", legacy, ok({ [T1]: 96, [T2]: 50, [T3]: 50 }), at(2)).get(T1), CRIT, "escalation");
		store.snoozeContext("g4", at(2), 900_000);
		assert.deepEqual(stepDialAlerts(store, "g4", legacy, ok({ [T1]: 60, [T2]: 50, [T3]: 50 }), at(3)).get(T1), NORMAL);
		assert.deepEqual(stepDialAlerts(store, "g4", legacy, ok({ [T1]: 97, [T2]: 50, [T3]: 50 }), at(4)).get(T1), CRIT, "a recovered reading alerts again at once");
	});

	it("stale or unavailable data never raises an alarm, and a snooze waits for a valid reading to expire", () => {
		const store = new AlertStore();
		stepDialAlerts(store, "g5", legacy, ok({ [T1]: 85, [T2]: 50, [T3]: 50 }), at(0));
		store.snoozeContext("g5", at(0), 300_000);
		for (const [n, status] of [[1, STALE], [2, UNAVAILABLE], [200, STALE]] as const) {
			const view = stepDialAlerts(store, "g5", legacy, status, at(n));
			assert.equal(view.size, 0, "nothing shows from data that is not current");
		}
		// The snooze ran out during the outage; it ends on this valid reading.
		assert.deepEqual(stepDialAlerts(store, "g5", legacy, ok({ [T1]: 85, [T2]: 50, [T3]: 50 }), at(201)).get(T1), WARN);
		// A stale frame's frozen 99 °C never starts an alarm on a reading that was normal.
		const fresh = new AlertStore();
		stepDialAlerts(fresh, "g5b", legacy, ok({ [T1]: 50, [T2]: 50, [T3]: 50 }), at(0));
		assert.equal(stepDialAlerts(fresh, "g5b", legacy, STALE, at(1)).size, 0);
		assert.equal(fresh.size().tracks, 0);
	});

	it("a withheld reading takes a gap: nothing shows for it, and its latched level resumes without a new dwell", () => {
		const store = new AlertStore();
		const settings: DialSettings = { ...legacy, alertDwellMs: "2000" };
		stepDialAlerts(store, "g6", settings, ok({ [T1]: 85, [T2]: 50, [T3]: 50 }), at(0));
		assert.deepEqual(stepDialAlerts(store, "g6", settings, ok({ [T1]: 85, [T2]: 50, [T3]: 50 }), at(1)).get(T1), WARN);
		const gap = stepDialAlerts(store, "g6", settings, ok({ [T2]: 50, [T3]: 50 }), at(2));
		assert.equal(gap.get(T1), undefined);
		assert.ok(store.has("g6", T1), "the track waits in its gap");
		assert.deepEqual(stepDialAlerts(store, "g6", settings, ok({ [T1]: 84, [T2]: 50, [T3]: 50 }), at(3)).get(T1), WARN);
	});

	it("a non-finite value never alarms", () => {
		const store = new AlertStore();
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			assert.deepEqual(stepDialAlerts(store, "g7", legacy, ok({ [T1]: value, [T2]: 50, [T3]: 50 }), at(0)).get(T1), NORMAL);
		}
	});

	it("a reading's own limits replace the dial's for it alone, and alertUnit never scopes them", () => {
		const store = new AlertStore();
		const settings: DialSettings = { ...legacy, alertUnit: "RPM", alertRules: { [T2]: { warn: "60", crit: "70", unit: "°C" } } };
		const view = stepDialAlerts(store, "g8", settings, ok({ [T1]: 99, [T2]: 65, [T3]: 99, [FAN]: 900 }), at(0));
		assert.deepEqual(view.get(T2), WARN, "its own limits, in its own unit");
		assert.deepEqual(view.get(T1), NORMAL, "the dial's limits stay scoped to RPM");
		assert.deepEqual(view.get(T3), NORMAL);
	});

	it("limits saved for a unit the reading no longer reports stand down", () => {
		const store = new AlertStore();
		const settings: DialSettings = { readingKey: T1, alertRules: { [T1]: { warn: "60", unit: "RPM" } } };
		assert.deepEqual(stepDialAlerts(store, "g9", settings, ok({ [T1]: 90 }), at(0)).get(T1), NORMAL);
		const fahrenheit: DialSettings = { readingKey: T1, fahrenheit: true, alertRules: { [T1]: { warn: "60", unit: "°C" } } };
		assert.deepEqual(stepDialAlerts(store, "g9b", fahrenheit, ok({ [T1]: 61 }), at(0)).get(T1), WARN, "°C limits compare across °F");
	});

	it("limits saved under a linked key reach the provider's reading through the alias walk", () => {
		const store = new AlertStore();
		const settings: DialSettings = { readingKey: T1, alertRules: { [ALIAS]: { warn: "60", unit: "°C" } } };
		assert.deepEqual(stepDialAlerts(store, "g10", settings, ok({ [T1]: 61 }, { alias: true }), at(0)).get(T1), WARN);
	});

	it("a rule that is cleared or moves ends its track at the prune: every referenced reading is stepped, a null rule included", () => {
		const store = new AlertStore();
		const withRule: DialSettings = { readingKey: T1, rotationKeys: [T1, T2], alertRules: { [T2]: { warn: "60", unit: "°C" } } };
		stepDialAlerts(store, "g11", withRule, ok({ [T1]: 50, [T2]: 65 }), at(0));
		assert.ok(store.has("g11", T2));
		const cleared: DialSettings = { readingKey: T1, rotationKeys: [T1, T2] };
		assert.deepEqual(stepDialAlerts(store, "g11", cleared, ok({ [T1]: 50, [T2]: 65 }), at(1)).get(T2), NORMAL);
		assert.equal(store.has("g11", T2), false);
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 0 });
	});

	it("ticking Separate limits (the dial's limits copied in) keeps the reading's snooze, wait and shown level; a changed limit starts fresh", () => {
		const dwell: DialSettings = { ...legacy, alertDwellMs: "5000" };
		const seeded: DialSettings = { ...dwell, alertRules: { [T1]: { warn: "80", crit: "95", unit: "°C" } } };
		const values = { [T1]: 85, [T2]: 50, [T3]: 50 };
		const store = new AlertStore();
		for (let n = 0; n <= 3; n++) stepDialAlerts(store, "g12", dwell, ok(values), at(n));
		assert.deepEqual(stepDialAlerts(store, "g12", dwell, ok(values), at(4)).get(T1), WARN, "shown after the wait");
		assert.deepEqual(stepDialAlerts(store, "g12", seeded, ok(values), at(5)).get(T1), WARN, "the tick alone hides nothing");
		store.snoozeContext("g12", at(5), 900_000);
		assert.deepEqual(stepDialAlerts(store, "g12", dwell, ok(values), at(6)).get(T1), { level: "normal", snoozed: "warn" }, "clearing it again keeps the snooze");
		assert.deepEqual(stepDialAlerts(store, "g12", seeded, ok(values), at(7)).get(T1), { level: "normal", snoozed: "warn" }, "and ticking it again");
		assert.equal(store.size().tracks, 1, "one track, moved between filings");
		// A wait in progress moves too: entered under the dial's limits,
		// shown under the reading's after the whole dwell, not a new one.
		const waiting = new AlertStore();
		stepDialAlerts(waiting, "g13", dwell, ok(values), at(0));
		stepDialAlerts(waiting, "g13", dwell, ok(values), at(1));
		assert.deepEqual(stepDialAlerts(waiting, "g13", seeded, ok(values), at(2)).get(T1), NORMAL);
		assert.deepEqual(stepDialAlerts(waiting, "g13", seeded, ok(values), at(3)).get(T1), WARN, "6 s since it entered");
		// A reading's own limit that compares differently starts fresh.
		const edited: DialSettings = { ...dwell, alertRules: { [T1]: { warn: "82", crit: "95", unit: "°C" } } };
		const fresh = new AlertStore();
		for (let n = 0; n <= 4; n++) stepDialAlerts(fresh, "g14", dwell, ok(values), at(n));
		assert.deepEqual(stepDialAlerts(fresh, "g14", edited, ok(values), at(5)).get(T1), NORMAL, "new limits wait again");
	});

	it("the critical hunt counts a reading only while it shows critical: not a warning, not snoozed, not in a gap", () => {
		const view: DialAlertView = new Map([[T1, CRIT], [T2, WARN], [T3, { level: "normal", snoozed: "crit" }]]);
		const list = [T1, T2, T3, FAN].map((key) => ({ key }));
		assert.deepEqual([...criticalKeysOf(view, list)], [T1]);
	});

	it("with no dwell, band or snooze, the critical hunt is exactly 1.7.1's over random settings and values", () => {
		// 1.7.1's criticalKeys, verbatim: the legacy pair under alertUnit,
		// crit first, on the displayed value.
		const oracle = (settings: DialSettings, list: readonly Reading[]): string[] => {
			const warn = parseThreshold(settings.warnValue);
			const crit = parseThreshold(settings.critValue);
			if (crit === undefined && warn === undefined) return [];
			return list.filter((m) => thresholdsApplyTo(settings.alertUnit, m.unit) && alertLevel(convertUnit(m.value, m.unit, settings.fahrenheit === true).value, warn, crit, settings.alertBelow === true) === "crit").map((m) => m.key);
		};
		let seed = 7;
		const rand = (): number => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		const pick = <T>(choices: readonly T[]): T => choices[Math.floor(rand() * choices.length)] as T;
		const store = new AlertStore();
		for (let n = 0; n < 2000; n++) {
			const settings: DialSettings = {
				readingKey: T1,
				rotationKeys: [T1, T2, FAN],
				warnValue: pick([undefined, "80", "85,5", "abc", "", "1200"]),
				critValue: pick([undefined, "95", "90", "x", "600"]),
				alertBelow: pick([undefined, true, false]),
				alertUnit: pick([undefined, "°C", "RPM", "", "Yes"]),
				fahrenheit: pick([undefined, true])
			};
			const values = { [T1]: pick([60, 79.9, 80, 85.5, 90, 95, 99, Number.NaN]), [T2]: pick([70, 95, 194, 203]), [FAN]: pick([300, 600, 1200, 1500]) };
			const status = ok(values) as Extract<PollerStatus, { state: "ok" }>;
			const view = stepDialAlerts(store, `p${n % 5}`, settings, status, n * 2000);
			const list = [T1, T2, FAN].map((key) => status.snapshot.byKey.get(key) as Reading);
			assert.deepEqual([...criticalKeysOf(view, list)], oracle(settings, list), JSON.stringify({ settings, values }));
		}
	});
});

describe("overview rows take the shown level", () => {
	const reading: Reading = { key: T1, type: SensorType.Temperature, sensorIndex: 0, id: 1, label: "CPU Package", unit: "°C", value: 90, valueMin: 90, valueMax: 90, valueAvg: 90 };
	const palette = resolvePalette(CONFIG, "void", null, "normal");
	const colors = (level: "normal" | "warn" | "crit" | undefined) => overviewRowColors({ settings: { warnValue: "80", critValue: "95" }, reading, level, shownValue: 90, selected: false, rowCount: 3, palette, config: CONFIG, themeId: "void", typeAccents: false, textSettings: THEME_TEXT });

	it("an alerting row's value takes the alert color of its shown level", () => {
		assert.equal(colors("warn").value, alertValueColor(CONFIG, "warn", palette.bg));
		assert.equal(colors("crit").value, alertValueColor(CONFIG, "crit", palette.bg));
	});

	it("a row whose alert is held back (dwell) or snoozed draws its normal color although its value is past the limit", () => {
		const plain = overviewRowColors({ settings: {}, reading, shownValue: 90, selected: false, rowCount: 3, palette, config: CONFIG, themeId: "void", typeAccents: false, textSettings: THEME_TEXT });
		assert.notEqual(colors("normal").value, alertValueColor(CONFIG, "warn", palette.bg));
		assert.equal(colors("normal").value, plain.value, "the color of a row with no limits at all");
	});

	it("without a step, the row reads its rule from the live value alone: 1.7.1's result", () => {
		assert.equal(colors(undefined).value, colors("warn").value);
		assert.deepEqual(instantAlert(parseAlertConfig({ warnValue: "80", critValue: "95" }), "dial", reading, 0, false), WARN);
	});

	it("an overview face colors exactly the rows its step shows alerting", () => {
		const settings: DialSettings = { dialView: "overview", readingKey: T1, rotationKeys: [T1, T2, T3], warnValue: "80", critValue: "95" };
		const status = ok({ [T1]: 90, [T2]: 90, [T3]: 90 });
		const face = (alertShown?: DialAlertView): string => composeDialSvg({ settings, stats: new SessionStatsStore(), statMode: "current", overlay: null, pinned: false, cyclePaused: false, alertShown }, status);
		const warnText = alertValueColor(CONFIG, "warn", palette.bg);
		const count = (svg: string): number => svg.split(`fill="${warnText}"`).length - 1;
		assert.equal(count(face()), 3, "no step: every row past warn is colored, as 1.7.1");
		assert.equal(count(face(new Map([[T1, WARN], [T2, { level: "normal", snoozed: "warn" }], [T3, NORMAL]]))), 1, "only the row that shows a warning");
	});
});

describe("the snoozed cue on a dial face", () => {
	const voidBg = resolvePalette(CONFIG, "void", null, "normal").bg;
	const warnBand = dialSnoozeBandSvg(mixToward(WARN_FILL, voidBg, ZONE_BG_BLEND));
	const critBand = dialSnoozeBandSvg(mixToward(CRIT_FILL, voidBg, ZONE_BG_BLEND));
	const SNOOZED_WARN: ShownAlert = { level: "normal", snoozed: "warn" };
	const SNOOZED_CRIT: ShownAlert = { level: "normal", snoozed: "crit" };
	const face = (settings: DialSettings, values: Values, alertShown?: DialAlertView): string => composeDialSvg({ settings, stats: new SessionStatsStore(), statMode: "current", overlay: null, pinned: false, cyclePaused: false, alertShown }, ok(values));
	const single: DialSettings = { readingKey: T1, warnValue: "80", critValue: "95" };

	it("a deliberately snoozed warning draws the key's thin band in the warning zone shade, right after the background", () => {
		const svg = face(single, { [T1]: 85 }, new Map([[T1, SNOOZED_WARN]]));
		assert.equal(svg.split(warnBand).length - 1, 1);
		const plain = face(single, { [T1]: 85 }, new Map([[T1, NORMAL]]));
		assert.equal(svg.replace(warnBand, ""), plain, "the band is the only difference from the same face held back by a dwell");
	});

	it("a snoozed critical draws the critical shade", () => {
		const svg = face(single, { [T1]: 99 }, new Map([[T1, SNOOZED_CRIT]]));
		assert.ok(svg.includes(critBand));
		assert.ok(!svg.includes(warnBand));
	});

	it("no band without a deliberate snooze: no step, normal, warning and critical faces look as before", () => {
		for (const alertShown of [undefined, new Map([[T1, NORMAL]]), new Map([[T1, WARN]]), new Map([[T1, CRIT]])]) {
			const svg = face(single, { [T1]: 99 }, alertShown);
			assert.ok(!svg.includes(`width="200" height="3"`), JSON.stringify(alertShown ? [...alertShown] : null));
		}
	});

	it("the overview and two-row faces draw the band for a snoozed row they show, the worst level winning", () => {
		for (const dialView of ["overview", "tworow"] as const) {
			const settings: DialSettings = { dialView, readingKey: T1, rotationKeys: [T1, T2], warnValue: "80", critValue: "95" };
			const values = { [T1]: 90, [T2]: 99 };
			assert.ok(!face(settings, values, new Map([[T1, WARN], [T2, CRIT]])).includes(`width="200" height="3"`), dialView);
			assert.ok(face(settings, values, new Map([[T1, NORMAL], [T2, SNOOZED_WARN]])).includes(warnBand), dialView);
			const both = face(settings, values, new Map([[T1, SNOOZED_WARN], [T2, SNOOZED_CRIT]]));
			assert.ok(both.includes(critBand) && !both.includes(warnBand), dialView);
		}
	});

	it("every background look keeps the band outside the halo group and the bar", () => {
		for (const dialBackground of ["theme", "glass", "tint", "outline", "clear"]) {
			const svg = face({ ...single, dialBackground }, { [T1]: 85 }, new Map([[T1, SNOOZED_WARN]]));
			const at = svg.indexOf(warnBand);
			assert.ok(at > 0, dialBackground);
			const halo = svg.indexOf("<g filter");
			if (halo !== -1) assert.ok(at < halo, dialBackground);
			assert.ok(at < svg.indexOf("<text"), dialBackground);
		}
	});
});

describe("a dial's stamped Warn at and Critical at", () => {
	const face = (settings: DialSettings, values: Values): string => composeDialSvg({ settings, stats: new SessionStatsStore(), statMode: "current", overlay: null, pinned: false, cyclePaused: false }, ok(values));

	it("a pair typed in °C draws its zones and alerts where it converts to on a °F dial", () => {
		const stamped = face({ readingKey: T1, warnValue: "80", critValue: "95", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", crit: "95" }, fahrenheit: true }, { [T1]: 85 });
		const typedInF = face({ readingKey: T1, warnValue: "176", critValue: "203", fahrenheit: true }, { [T1]: 85 });
		assert.equal(stamped, typedInF, "80 °C and 95 °C draw exactly as 176 °F and 203 °F");
		assert.match(stamped, new RegExp(`fill="${WARN_FILL}"`), "85 °C is past 80 °C");
	});

	it("without a stamp the numbers stay in the unit on the face, as 1.7.1", () => {
		const plain = face({ readingKey: T1, warnValue: "80", critValue: "95", fahrenheit: true }, { [T1]: 85 });
		assert.match(plain, new RegExp(`fill="${CRIT_FILL}"`), "185 °F is past 95");
		assert.equal(face({ readingKey: T1, warnValue: "80", critValue: "95", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", crit: "95" } }, { [T1]: 85 }), face({ readingKey: T1, warnValue: "80", critValue: "95" }, { [T1]: 85 }), "a stamp in the face's own unit changes nothing");
	});
});

describe("the single view's bar and Ember Option B", () => {
	const ember = resolvePalette(CONFIG, "ember", null, "normal");
	const zone = alertTrackFill(ember.accent, "warn", CONFIG.alerts, ember.bg) as string;
	const face = (settings: DialSettings, values: Values, alertShown?: DialAlertView): string => composeDialSvg({ settings, stats: new SessionStatsStore(), statMode: "current", overlay: null, pinned: false, cyclePaused: false, alertShown }, ok(values));

	it("the bar fill follows the shown level, not the raw value", () => {
		const settings: DialSettings = { readingKey: T1, warnValue: "80", critValue: "95" };
		assert.match(face(settings, { [T1]: 85 }), new RegExp(`fill="${WARN_FILL}"`));
		assert.doesNotMatch(face(settings, { [T1]: 85 }, new Map([[T1, NORMAL]])), new RegExp(`fill="${WARN_FILL}"`), "held back by a dwell");
		assert.doesNotMatch(face(settings, { [T1]: 85 }, new Map([[T1, { level: "normal", snoozed: "warn" }]])), new RegExp(`fill="${WARN_FILL}"`), "snoozed");
		assert.match(face(settings, { [T1]: 85 }, new Map([[T1, CRIT]])), new RegExp(`fill="${CRIT_FILL}"`));
	});

	it("Ember lights the track in the warning zone shade while a warning shows on a bar in its own accent", () => {
		assert.equal(zone, "#805107");
		const settings: DialSettings = { readingKey: V1, theme: "ember", alertRules: { [V1]: { warn: "1.2", crit: "1.4", unit: "V" } } };
		// The warning zone itself is drawn in the same shade, so count the
		// shade's rectangles against the same face with nothing showing.
		const shade = (svg: string): number => svg.split(`fill="${zone}"`).length - 1;
		const lit = face(settings, { [V1]: 1.3 }, new Map([[V1, WARN]]));
		const held = face(settings, { [V1]: 1.3 }, new Map([[V1, NORMAL]]));
		assert.equal(shade(lit), shade(held) + 1, "one track rectangle more");
		// A snooze draws its edge band in the same zone shade; the track stays dark.
		assert.equal(shade(face(settings, { [V1]: 1.3 }, new Map([[V1, { level: "normal", snoozed: "warn" }]])).replace(dialSnoozeBandSvg(zone), "")), shade(held), "not while snoozed");
		const crit = face(settings, { [V1]: 1.5 }, new Map([[V1, CRIT]]));
		assert.equal(shade(crit), shade(face(settings, { [V1]: 1.5 }, new Map([[V1, NORMAL]]))), "critical's fill is far from Ember's accent");
	});

	it("every other theme's bar stays the established track and fill", () => {
		for (const theme of ["void", "graphite", "ultraviolet", "midnight", "forest", "paper"]) {
			const palette = resolvePalette(CONFIG, theme, null, "normal");
			assert.equal(alertTrackFill(palette.accent, "warn", CONFIG.alerts, palette.bg), null, theme);
			assert.equal(alertTrackFill(palette.accent, "crit", CONFIG.alerts, palette.bg), null, theme);
		}
	});

	it("a reading's own limits draw the zones; while they stand down nothing is drawn", () => {
		const own: DialSettings = { readingKey: T1, alertRules: { [T1]: { warn: "70", crit: "90", unit: "°C" } } };
		const legacyScale: DialSettings = { readingKey: T1, warnValue: "70", critValue: "90" };
		// Same limits, so the same face: the own rule draws exactly what the
		// legacy pair would.
		assert.equal(face(own, { [T1]: 75 }, new Map([[T1, WARN]])), face(legacyScale, { [T1]: 75 }, new Map([[T1, WARN]])));
		const mismatch: DialSettings = { readingKey: T1, warnValue: "70", critValue: "90", alertRules: { [T1]: { warn: "70", crit: "90", unit: "RPM" } } };
		assert.equal(face(mismatch, { [T1]: 75 }), face({ readingKey: T1 }, { [T1]: 75 }), "no zones and no alert from limits for another unit");
	});
});

describe("Sensor Dial action: alerts every tick, snooze and the Control key", () => {
	type Internals = {
		instances: Map<string, InstanceState>;
		hidden: Map<string, { at: number; state: InstanceState }>;
		onPollerTick(status: PollerStatus): void;
		stripClaimChanged(context: string, claimed: boolean): void;
		strip: { claims(context: string): boolean };
	};
	type Handle = { id: string; device: { id: string; name: string }; coordinates: { column: number; row: number }; isDial(): true; isKey(): false; setFeedback(payload: { canvas: string }): Promise<void>; setTriggerDescription(): Promise<void>; setSettings(settings: unknown): Promise<void> };

	let mono = 0;
	let latest: PollerStatus = UNAVAILABLE;
	const restores: Array<() => void> = [];
	beforeEach(() => {
		mono = 7_000_000;
		latest = UNAVAILABLE;
		for (const m of [
			mock.method(performance, "now", () => mono),
			mock.method(poller, "retain", () => {}),
			mock.method(poller, "release", () => {}),
			mock.method(poller, "getStatus", () => latest),
			mock.method(poller, "isHolding", () => false)
		]) restores.push(() => m.mock.restore());
	});
	afterEach(() => {
		for (const restore of restores.splice(0)) restore();
	});

	/** A real action with visible dials; returns their frames and writes. */
	function rig(dials: Record<string, DialSettings>) {
		const action = new SensorDialAction();
		const internals = action as unknown as Internals;
		(action as unknown as { pushPanelPreview(): void }).pushPanelPreview = () => {};
		const frames = new Map<string, string[]>();
		const writes: Array<{ id: string; settings: unknown }> = [];
		const handles = new Map<string, Handle>();
		for (const id of Object.keys(dials)) {
			frames.set(id, []);
			handles.set(id, {
				id, device: { id: "dev", name: "fixture" }, coordinates: { column: handles.size, row: 0 },
				isDial: () => true, isKey: () => false,
				setFeedback: async (payload) => void frames.get(id)?.push(decodeURIComponent(payload.canvas)),
				setTriggerDescription: async () => {},
				setSettings: async (settings) => void writes.push({ id, settings })
			});
		}
		Object.defineProperty(action, "actions", { get: () => [...handles.values()].filter((h) => internals.instances.has(h.id)) });
		const tick = (status: PollerStatus, advanceMs = 2000): void => {
			mono += advanceMs;
			latest = status;
			internals.onPollerTick(status);
		};
		const appear = (id: string): void => action.onWillAppear({ action: handles.get(id), payload: { settings: dials[id] } } as never);
		const disappear = (id: string): void => action.onWillDisappear({ action: handles.get(id), payload: { settings: dials[id] } } as never);
		const state = (id: string): InstanceState => (internals.instances.get(id) ?? internals.hidden.get(id)?.state) as InstanceState;
		const lastFace = (id: string): string => frames.get(id)?.at(-1) ?? "";
		const cleanup = (): void => {
			for (const entry of [...internals.instances.values(), ...[...internals.hidden.values()].map((h) => h.state)]) {
				if (entry.overlayTimer !== null) clearTimeout(entry.overlayTimer);
			}
			for (const id of Object.keys(dials)) alertStore.forget(id);
		};
		return { action, internals, frames, writes, handles, tick, appear, disappear, state, lastFace, cleanup };
	}

	const control = (command: ControlCommandId, target = ""): number => dispatchDialCommand({ command, target, scope: "current" });

	it("each tick steps the dial's alerts before the face is drawn, and a dwell lands on time alone", () => {
		const r = rig({ "dial-dwell": { readingKey: T1, warnValue: "80", critValue: "95", alertDwellMs: "5000" } });
		try {
			latest = ok({ [T1]: 85, [T2]: 50, [T3]: 50 });
			r.appear("dial-dwell");
			assert.doesNotMatch(r.lastFace("dial-dwell"), new RegExp(`fill="${WARN_FILL}"`), "entered, not yet shown");
			r.tick(ok({ [T1]: 85, [T2]: 50, [T3]: 50 }));
			r.tick(ok({ [T1]: 85, [T2]: 50, [T3]: 50 }));
			assert.doesNotMatch(r.lastFace("dial-dwell"), new RegExp(`fill="${WARN_FILL}"`));
			r.tick(ok({ [T1]: 85, [T2]: 50, [T3]: 50 }));
			assert.match(r.lastFace("dial-dwell"), new RegExp(`fill="${WARN_FILL}"`), "the same values, 6 s on: the warning shows");
			assert.deepEqual(r.writes, [], "no settings write from ticks or appear");
		} finally { r.cleanup(); }
	});

	/** Counts the composes the dial's ticks run (renderAll is the only path
	 * from a tick to a face). */
	const countRenders = (action: SensorDialAction) => mock.method(action as unknown as { renderAll(...args: unknown[]): void }, "renderAll");

	it("a held tick composes nothing: the same data, the same alerts and no change the tick made", () => {
		const r = rig({ "dial-held": { readingKey: T1, rotationKeys: [T1, T2, T3], warnValue: "80", critValue: "95" } });
		try {
			const held = ok({ [T1]: 60, [T2]: 50, [T3]: 50 }, { pollTime: 100 });
			latest = held;
			r.appear("dial-held");
			r.tick(held);
			const before = r.lastFace("dial-held");
			const renders = countRenders(r.action);
			restores.push(() => renders.mock.restore());
			r.tick(held);
			r.tick(held);
			assert.equal(renders.mock.callCount(), 0, "two held ticks compose nothing");
			assert.equal(r.lastFace("dial-held"), before);
			const fresh = ok({ [T1]: 63, [T2]: 50, [T3]: 50 }, { pollTime: 101 });
			r.tick(fresh);
			assert.equal(renders.mock.callCount(), 1, "new data composes once");
			assert.notEqual(r.lastFace("dial-held"), before, "and draws the new value");
		} finally { r.cleanup(); }
	});

	it("an alert that changes on held data draws on that tick: a snooze ends on time alone", () => {
		const r = rig({ "dial-wake": { readingKey: T1, warnValue: "80", critValue: "95", alertSnoozeMs: "300000" } });
		try {
			const hot = ok({ [T1]: 85, [T2]: 50, [T3]: 50 }, { pollTime: 200 });
			latest = hot;
			r.appear("dial-wake");
			r.tick(hot);
			assert.match(r.lastFace("dial-wake"), new RegExp(`fill="${WARN_FILL}"`));
			assert.equal(control("snoozeAlerts"), 1);
			r.tick(hot);
			assert.doesNotMatch(r.lastFace("dial-wake"), new RegExp(`fill="${WARN_FILL}"`), "snoozed: the bar is back to normal");
			r.tick(hot, 300_000);
			assert.deepEqual(r.state("dial-wake").alertShown?.get(T1), WARN);
			assert.match(r.lastFace("dial-wake"), new RegExp(`fill="${WARN_FILL}"`), "the same values, the snooze over: the warning draws on that tick");
		} finally { r.cleanup(); }
	});

	it("a dial back from a data gap names it on a held tick", () => {
		const r = rig({ "dial-gap": { readingKey: T1 } });
		try {
			const first = ok({ [T1]: 50, [T2]: 50, [T3]: 50 }, { pollTime: 300 });
			latest = first;
			r.appear("dial-gap");
			r.tick(first);
			r.disappear("dial-gap");
			r.tick(STALE);
			const back = ok({ [T1]: 52, [T2]: 50, [T3]: 50 }, { pollTime: 301 });
			r.tick(back);
			r.appear("dial-gap");
			assert.doesNotMatch(r.lastFace("dial-gap"), /data gap/, "the appear draws the face; the note waits for the tick");
			r.tick(back);
			assert.match(r.lastFace("dial-gap"), /data gap/, "the held tick that names the gap draws it");
		} finally { r.cleanup(); }
	});

	it("an auto cycle move on held data draws the new reading on the tick that moved", () => {
		const r = rig({ "dial-move": { readingKey: T1, rotationKeys: [T1, T2, T3], autoCycleMs: "2000" } });
		try {
			const held = ok({ [T1]: 50, [T2]: 51, [T3]: 52 }, { pollTime: 400 });
			latest = held;
			r.appear("dial-move");
			r.tick(held);
			assert.match(r.lastFace("dial-move"), /CPU Package/);
			r.tick(held);
			assert.equal(r.state("dial-move").settings.readingKey, T2, "the interval passed: it moved");
			assert.match(r.lastFace("dial-move"), /CPU Core/, "drawn on that tick, before the selection write lands");
		} finally { r.cleanup(); }
	});

	it("a unit stamp that lands on a held tick draws on that tick", () => {
		const limits = { rotationKeys: [T1, FAN], warnValue: "60000", critValue: "90000" };
		const r = rig({ "dial-stamp": { readingKey: T1, ...limits, warnValue: "70000" } });
		try {
			const held = ok({ [T1]: 50, [T2]: 50, [T3]: 50, [FAN]: 900 }, { pollTime: 500 });
			latest = held;
			r.appear("dial-stamp");
			r.tick(held);
			const joined = new Set(["dial-stamp"]);
			const claims = mock.method(r.internals.strip, "claims", (id: string) => joined.has(id));
			restores.push(() => claims.mock.restore());
			r.internals.stripClaimChanged("dial-stamp", true);
			// While grouped: Warn at is edited on the package, then the dial
			// moves to the fan. The stamp waits for the dial to stand alone.
			const receive = (next: DialSettings): void => r.action.onDidReceiveSettings({ action: r.handles.get("dial-stamp"), payload: { settings: next } } as never);
			receive({ readingKey: T1, ...limits });
			receive({ readingKey: FAN, ...limits });
			assert.equal(r.state("dial-stamp").pendingAlertUnitStamp, true);
			joined.clear();
			r.internals.stripClaimChanged("dial-stamp", false);
			const left = r.lastFace("dial-stamp");
			r.tick(held);
			assert.equal(r.state("dial-stamp").settings.alertUnit, "°C", "stamped from the reading the edit was made on");
			assert.notEqual(r.lastFace("dial-stamp"), left, "°C limits no longer mark the fan's bar, on that tick");
		} finally { r.cleanup(); }
	});

	it("a hidden dial's session takes the new data that comes while it is away, held ticks between", () => {
		const r = rig({ "dial-away-peak": { readingKey: T1 }, "dial-stays": { readingKey: T2 } });
		try {
			latest = ok({ [T1]: 50, [T2]: 50, [T3]: 50 }, { pollTime: 600 });
			r.appear("dial-away-peak");
			r.appear("dial-stays");
			r.tick(latest);
			r.disappear("dial-away-peak");
			for (const [value, pollTime] of [[88, 601], [60, 602]]) {
				const status = ok({ [T1]: value, [T2]: 50, [T3]: 50 }, { pollTime });
				r.tick(status);
				r.tick(status);
			}
			assert.equal(r.state("dial-away-peak").stats.get(T1)?.max, 88, "the peak it missed on screen is in its session");
			r.appear("dial-away-peak");
			assert.match(r.lastFace("dial-away-peak"), /▲ 88\.0/, "and its face shows it on return");
		} finally { r.cleanup(); }
	});

	it("a Control reset reaches a hidden dial as it does a visible one: the held reading starts both sessions", () => {
		const r = rig({ "dial-away-reset": { readingKey: T1 }, "dial-stays-reset": { readingKey: T1 } });
		try {
			latest = ok({ [T1]: 50, [T2]: 50, [T3]: 50 }, { pollTime: 700 });
			r.appear("dial-away-reset");
			r.appear("dial-stays-reset");
			r.tick(latest);
			const peak = ok({ [T1]: 90, [T2]: 50, [T3]: 50 }, { pollTime: 701 });
			r.tick(peak);
			r.disappear("dial-away-reset");
			assert.equal(control("resetStats"), 2, "the press reaches the hidden dial too");
			r.tick(peak);
			const after = ok({ [T1]: 60, [T2]: 50, [T3]: 50 }, { pollTime: 702 });
			r.tick(after);
			r.tick(after);
			assert.equal(r.state("dial-stays-reset").stats.get(T1)?.max, 90, "the visible dial's new session starts at the reading it held");
			assert.equal(r.state("dial-away-reset").stats.get(T1)?.max, 90, "and so does the hidden dial's");
			r.appear("dial-away-reset");
			assert.match(r.lastFace("dial-away-reset"), /▲ 90\.0/, "the face it comes back to says so");
		} finally { r.cleanup(); }
	});

	it("the auto cycle holds on a critical reading, jumps to one, and a snoozed critical neither holds nor pulls", () => {
		const settings: DialSettings = { readingKey: T1, rotationKeys: [T1, T2, T3], warnValue: "80", critValue: "95", autoCycleMs: "2000", alertInterrupt: true };
		const r = rig({ "dial-cycle": settings });
		try {
			const hot = ok({ [T1]: 96, [T2]: 50, [T3]: 50 });
			latest = hot;
			r.appear("dial-cycle");
			for (let n = 0; n < 4; n++) r.tick(hot);
			assert.equal(r.state("dial-cycle").settings.readingKey, T1, "held on the critical reading");
			assert.equal(control("snoozeAlerts"), 1);
			for (let n = 0; n < 3; n++) r.tick(hot);
			assert.notEqual(r.state("dial-cycle").settings.readingKey, T1, "the snoozed critical no longer holds");
			// T3 turns critical elsewhere: the hunt jumps to it.
			const elsewhere = ok({ [T1]: 96, [T2]: 50, [T3]: 97 });
			for (let n = 0; n < 3; n++) r.tick(elsewhere);
			assert.equal(r.state("dial-cycle").settings.readingKey, T3);
			// The one write each move makes is the selection (and the auto
			// label it drops); no alert state is ever written.
			assert.ok(r.writes.length >= 2);
			const rest: DialSettings = { ...settings };
			delete rest.readingKey;
			for (const write of r.writes) {
				const { readingKey, label, ...others } = write.settings as DialSettings;
				assert.ok(readingKey === T2 || readingKey === T3, String(readingKey));
				assert.equal(label, undefined);
				assert.deepEqual(others, rest);
			}
		} finally { r.cleanup(); }
	});

	it("pin and pause still stop the auto cycle, a critical hunt included", () => {
		const settings: DialSettings = { readingKey: T2, rotationKeys: [T1, T2, T3], warnValue: "80", critValue: "95", autoCycleMs: "2000", alertInterrupt: true };
		const r = rig({ "dial-pin": settings });
		try {
			const hot = ok({ [T1]: 96, [T2]: 50, [T3]: 50 });
			latest = hot;
			r.appear("dial-pin");
			control("pin");
			for (let n = 0; n < 4; n++) r.tick(hot);
			assert.equal(r.state("dial-pin").settings.readingKey, T2, "pinned");
			control("unpin");
			control("pauseCycle");
			for (let n = 0; n < 4; n++) r.tick(hot);
			assert.equal(r.state("dial-pin").settings.readingKey, T2, "paused");
			control("resumeCycle");
			for (let n = 0; n < 3; n++) r.tick(hot);
			assert.equal(r.state("dial-pin").settings.readingKey, T1, "resumed: the hunt finds the critical reading");
		} finally { r.cleanup(); }
	});

	it("Snooze alerts and End alert snooze reach visible and hidden dials by Link ID, and count them", () => {
		const legacy = { readingKey: T1, warnValue: "80", critValue: "95" };
		const r = rig({ "dial-a": { ...legacy, linkId: "cpu" }, "dial-b": { ...legacy }, "dial-c": { ...legacy, linkId: " cpu " }, "dial-d": { ...legacy, linkId: "cpu" } });
		try {
			const hot = ok({ [T1]: 85, [T2]: 50, [T3]: 50 });
			latest = hot;
			for (const id of ["dial-a", "dial-b", "dial-c", "dial-d"]) r.appear(id);
			r.tick(hot);
			r.disappear("dial-c");
			r.disappear("dial-d");
			// dial-d has been away past the 30 minute window.
			const hiddenD = r.internals.hidden.get("dial-d");
			if (hiddenD !== undefined) hiddenD.at -= 31 * 60_000;
			assert.equal(control("snoozeAlerts", "cpu"), 2, "dial-a on screen and dial-c hidden; dial-d expired");
			assert.equal(r.internals.hidden.has("dial-d"), false, "the expired dial was dropped, not counted");
			r.tick(hot);
			assert.deepEqual(r.state("dial-a").alertShown?.get(T1), { level: "normal", snoozed: "warn" });
			assert.deepEqual(r.state("dial-c").alertShown?.get(T1), { level: "normal", snoozed: "warn" }, "the hidden dial kept stepping, snoozed");
			assert.deepEqual(r.state("dial-b").alertShown?.get(T1), WARN, "another Link ID is not reached");
			assert.equal(control("unsnoozeAlerts", ""), 3, "every dial: a, b on screen and c hidden");
			r.tick(hot);
			assert.deepEqual(r.state("dial-a").alertShown?.get(T1), WARN);
			assert.deepEqual(r.state("dial-c").alertShown?.get(T1), WARN);
			assert.equal(control("snoozeAlerts", "nobody"), 0, "no dial matches: the key shows its alert");
			assert.deepEqual(r.writes, [], "snooze commands write no settings");
		} finally { r.cleanup(); }
	});

	it("a snooze survives a page flip within 30 minutes, and is gone past it", () => {
		const r = rig({ "dial-flip": { readingKey: T1, warnValue: "80", critValue: "95" } });
		try {
			const hot = ok({ [T1]: 85, [T2]: 50, [T3]: 50 });
			latest = hot;
			r.appear("dial-flip");
			r.tick(hot);
			control("snoozeAlerts");
			r.disappear("dial-flip");
			r.tick(hot, 60_000);
			r.appear("dial-flip");
			r.tick(hot);
			assert.deepEqual(r.state("dial-flip").alertShown?.get(T1), { level: "normal", snoozed: "warn" }, "back within the window: still snoozed");
			r.disappear("dial-flip");
			mono += 31 * 60_000;
			r.appear("dial-flip");
			assert.deepEqual(r.state("dial-flip").alertShown?.get(T1), WARN, "past the window: the snooze is gone");
			assert.deepEqual(r.writes, []);
		} finally { r.cleanup(); }
	});

	it("the snooze gesture silences what shows now, says so, and writes nothing", async () => {
		const settings: DialSettings = { readingKey: T1, warnValue: "80", critValue: "95", controlPreset: "custom", gestureShortPress: "snooze", alertSnoozeMs: "300000" };
		const r = rig({ "dial-gesture": settings });
		try {
			const hot = ok({ [T1]: 85, [T2]: 50, [T3]: 50 });
			latest = hot;
			r.appear("dial-gesture");
			r.tick(hot);
			assert.match(r.lastFace("dial-gesture"), new RegExp(`fill="${WARN_FILL}"`));
			const event = { action: r.handles.get("dial-gesture"), payload: { settings } } as never;
			await r.action.onDialDown(event);
			mono += 120;
			await r.action.onDialUp(event);
			assert.deepEqual(r.state("dial-gesture").alertShown?.get(T1), { level: "normal", snoozed: "warn" });
			assert.equal((r.state("dial-gesture").overlay as { text: string } | null)?.text, "alerts snoozed 5 min");
			assert.doesNotMatch(r.lastFace("dial-gesture"), new RegExp(`fill="${WARN_FILL}"`), "the bar is back to its normal color");
			assert.ok(r.lastFace("dial-gesture").includes(dialSnoozeBandSvg(mixToward(WARN_FILL, resolvePalette(CONFIG, "void", null, "normal").bg, ZONE_BG_BLEND))), "the snoozed cue shows on the face");
			// Five minutes on, the next valid reading ends the snooze.
			r.tick(hot, 300_000);
			assert.deepEqual(r.state("dial-gesture").alertShown?.get(T1), WARN);
			// Nothing alerting: the gesture says so and snoozes nothing.
			r.tick(ok({ [T1]: 60, [T2]: 50, [T3]: 50 }));
			await r.action.onDialDown(event);
			mono += 120;
			await r.action.onDialUp(event);
			assert.equal((r.state("dial-gesture").overlay as { text: string } | null)?.text, "no alert to snooze");
			assert.deepEqual(r.writes, []);
		} finally { r.cleanup(); }
	});

	it("editing a reading's limits, the dwell, the band or the snooze length never re-anchors alertUnit", () => {
		const settings: DialSettings = { readingKey: T1, warnValue: "80", critValue: "95", alertUnit: "°C" };
		const r = rig({ "dial-edit": settings });
		try {
			latest = ok({ [T1]: 85, [T2]: 50, [T3]: 50 });
			r.appear("dial-edit");
			const receive = (next: DialSettings): void => r.action.onDidReceiveSettings({ action: r.handles.get("dial-edit"), payload: { settings: next } } as never);
			receive({ ...settings, alertRules: { [T2]: { warn: "60", unit: "°C" } } });
			receive({ ...settings, alertRules: { [T2]: { warn: "60", unit: "°C" } }, alertDwellMs: "10000", alertHysteresis: "2", alertSnoozeMs: "3600000" });
			assert.deepEqual(r.writes, [], "only Warn at, Critical at and the bar range re-anchor the unit");
			assert.equal(r.state("dial-edit").settings.alertUnit, "°C");
		} finally { r.cleanup(); }
	});

	it("stale and unavailable ticks show the status face and raise nothing; live data resumes the alert", () => {
		const r = rig({ "dial-stale": { readingKey: T1, warnValue: "80", critValue: "95" } });
		try {
			latest = ok({ [T1]: 50, [T2]: 50, [T3]: 50 });
			r.appear("dial-stale");
			r.tick(STALE);
			assert.equal(r.state("dial-stale").alertShown?.size, 0);
			assert.doesNotMatch(r.lastFace("dial-stale"), new RegExp(`fill="${WARN_FILL}"|fill="${CRIT_FILL}"`), "a frozen 99 °C draws no alarm");
			r.tick(UNAVAILABLE);
			assert.equal(r.state("dial-stale").alertShown?.size, 0);
			r.tick(ok({ [T1]: 96, [T2]: 50, [T3]: 50 }));
			assert.match(r.lastFace("dial-stale"), new RegExp(`fill="${CRIT_FILL}"`));
		} finally { r.cleanup(); }
	});

	it("time away while nothing was read never counts toward Alert after: the wait starts again on return", () => {
		const r = rig({ "dial-away": { readingKey: T1, warnValue: "80", critValue: "95", alertDwellMs: "30000" } });
		try {
			const hot = ok({ [T1]: 85, [T2]: 50, [T3]: 50 });
			latest = hot;
			r.appear("dial-away");
			r.tick(hot);
			assert.equal(r.state("dial-away").alertShown?.get(T1)?.level, "normal", "entered, 2 s of 30 s");
			// Off screen with nothing else on screen: the poller idles, so no
			// tick steps the hidden dial for five minutes.
			r.disappear("dial-away");
			mono += 300_000;
			r.appear("dial-away");
			assert.equal(r.state("dial-away").alertShown?.get(T1)?.level, "normal", "two readings five minutes apart are not 30 s past the limit");
			assert.doesNotMatch(r.lastFace("dial-away"), new RegExp(`fill="${WARN_FILL}"`));
			for (let n = 0; n < 14; n++) r.tick(hot);
			assert.equal(r.state("dial-away").alertShown?.get(T1)?.level, "normal", "28 s of readings since the return");
			r.tick(hot);
			assert.equal(r.state("dial-away").alertShown?.get(T1)?.level, "warn", "30 s of readings: it shows");
			// Ticks that keep coming (the poller kept for another action)
			// step a hidden dial, so its wait carries on through the flip.
			r.disappear("dial-away");
			r.tick(hot);
			r.appear("dial-away");
			assert.equal(r.state("dial-away").alertShown?.get(T1)?.level, "warn", "a latched level carries on");
			assert.deepEqual(r.writes, []);
		} finally { r.cleanup(); }
	});

	it("a snooze command that reaches a hidden dial while nothing is read steps nothing on the old data", () => {
		const r = rig({ "dial-idle": { readingKey: T1, warnValue: "80", critValue: "95", alertDwellMs: "30000" } });
		try {
			const hot = ok({ [T1]: 85, [T2]: 50, [T3]: 50 });
			latest = hot;
			r.appear("dial-idle");
			r.tick(hot);
			r.disappear("dial-idle");
			const before = r.state("dial-idle").alertShown;
			mono += 120_000;
			// The poller idles: its last status is two minutes old.
			control("snoozeAlerts");
			control("unsnoozeAlerts");
			assert.equal(r.state("dial-idle").alertShown, before, "the hidden dial was not stepped on a status nobody read");
			// On return it steps on current data, after the gap.
			latest = ok({ [T1]: 60, [T2]: 50, [T3]: 50 });
			r.appear("dial-idle");
			assert.deepEqual(r.state("dial-idle").alertShown?.get(T1), NORMAL);
		} finally { r.cleanup(); }
	});

	it("while the poller rides out a source reopen on its last values, the store is left alone", () => {
		const r = rig({ "dial-hold": { readingKey: T1, warnValue: "80", critValue: "95", alertDwellMs: "5000" } });
		try {
			latest = ok({ [T1]: 85, [T2]: 50, [T3]: 50 });
			r.appear("dial-hold");
			const before = r.state("dial-hold").alertShown;
			const holding = mock.method(poller, "isHolding", () => true);
			restores.push(() => holding.mock.restore());
			for (let n = 0; n < 5; n++) r.tick(latest);
			assert.equal(r.state("dial-hold").alertShown, before, "nothing new was observed");
		} finally { r.cleanup(); }
	});
});

describe("the panel preview's reading alert (dial)", () => {
	const status = ok({ [T1]: 85, [T2]: 50, [T3]: 50, [FAN]: 900 });

	it("names whose limits apply, the unit a capture stores, and what the face shows", () => {
		const legacy = buildPreview(status, { readingKey: T1, warnValue: "80" }, false, { kind: "dial" });
		assert.deepEqual(legacy.effective?.readingAlert, { key: T1, ruleKey: null, displayUnit: "°C", source: "legacy", legacyApplies: true, level: "warn", snoozed: null, flags: [], dwellMs: 0, snoozeMs: 900_000, legacyUnit: "°C" });
		const own = buildPreview(status, { readingKey: T1, warnValue: "80", alertUnit: "RPM", alertRules: { [T1]: { warn: "90", unit: "°C" } }, alertDwellMs: "2000", alertSnoozeMs: "300000" }, false, { kind: "dial", alerts: new Map([[T1, { level: "normal", snoozed: "warn" }]]) });
		assert.deepEqual(own.effective?.readingAlert, { key: T1, ruleKey: T1, displayUnit: "°C", source: "reading", legacyApplies: false, level: "normal", snoozed: "warn", flags: [], dwellMs: 2000, snoozeMs: 300_000, legacyUnit: "°C" });
	});

	it("captures the unit the face shows (°F when °F is on) and flags limits saved for another unit", () => {
		const fahrenheit = buildPreview(status, { readingKey: T1, fahrenheit: true }, false, { kind: "dial" });
		assert.equal(fahrenheit.effective?.readingAlert?.displayUnit, "°F");
		assert.equal(fahrenheit.effective?.readingAlert?.source, null);
		const mismatch = buildPreview(status, { readingKey: T1, alertRules: { [T1]: { warn: "60", unit: "RPM" } } }, false, { kind: "dial" });
		assert.deepEqual(mismatch.effective?.readingAlert?.flags.map((f) => f.code), ["unit-mismatch"]);
	});

	it("names the unit Warn at and Critical at are in: a stamped °C pair on a °F dial stays °C, everything else is the face's", () => {
		const stamped = buildPreview(status, { readingKey: T1, warnValue: "80", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80" }, fahrenheit: true }, false, { kind: "dial" });
		assert.equal(stamped.effective?.readingAlert?.legacyUnit, "°C");
		assert.equal(stamped.effective?.alert.unit, "°C", "the Alerts line prints the unit they compare in");
		assert.equal(stamped.effective?.alert.level, "warn", "85 °C against 80 °C, not 185 °F against 80");
		const plain = buildPreview(status, { readingKey: T1, warnValue: "80", fahrenheit: true }, false, { kind: "dial" });
		assert.equal(plain.effective?.readingAlert?.legacyUnit, "°F", "no stamp: the unit on the face, as 1.7.1");
		assert.equal(plain.effective?.alert.unit, "°F");
		const other = buildPreview(status, { readingKey: FAN, warnValue: "80", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80" } }, false, { kind: "dial" });
		assert.equal(other.effective?.readingAlert?.legacyUnit, "RPM", "a stamp that cannot convert to the face's unit gives way");
		// Scoped to °C and rotated to the fan: off there, and printed in the
		// unit of the readings it covers, never the fan's.
		const away = (extra: { fahrenheit?: boolean; alertDisplayUnit?: string; alertDisplayUnitFor?: Record<string, string> }) => buildPreview(status, { readingKey: FAN, warnValue: "80", alertUnit: "°C", ...extra }, false, { kind: "dial" }).effective?.alert;
		assert.deepEqual([away({})?.applies, away({})?.unit], [false, "°C"], "80 °C on the fan, not 80 RPM");
		assert.equal(away({ fahrenheit: true })?.unit, "°F", "unstamped on a °F dial: the unit those readings show");
		assert.equal(away({ fahrenheit: true, alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80" } })?.unit, "°C", "a °C stamp on a °F dial stays °C");
	});

	it("is a dial payload only: a key's preview carries none", () => {
		assert.equal(buildPreview(status, { readingKey: T1, warnValue: "80" }, true, { kind: "key" }).effective?.readingAlert, undefined);
	});
});
