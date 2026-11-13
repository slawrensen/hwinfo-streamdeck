/**
 * The Sensor Reading key's alert path (src/alerts/key-alerts.ts) and the
 * faces it feeds: every drawn reading stepped once per tick through the
 * shared store, dwell, the recovery band, snooze, resets on a rule edit,
 * the hidden window, and the face. A key with no new alert fields draws
 * exactly what 1.7.1 drew: its level is the first reading's legacy
 * comparison, rows never give way, and no snooze band is drawn.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compose, type ReadingSettings } from "../src/actions/sensor-reading";
import { immediateKeyView, KeyAlerts, keyAlertPanelOf, referencedSlotKeys, rowGivesWay, type KeyAlertSettings, type KeyAlertView } from "../src/alerts/key-alerts";
import { AlertStore, HIDDEN_TTL_MS } from "../src/alerts/store";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { alertLevel, convertUnit, parseThreshold } from "../src/ui/format";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";
import { loadThemes } from "../src/ui/themes";

applyGlobalThemeSettings({ theme: "void" });

const WARN_BG = loadThemes().alerts.warn.bg;
const CRIT_BG = loadThemes().alerts.crit.bg;
const BAND = /<rect x="10" y="10" width="124" height="3" fill="#[0-9A-Fa-f]{6}"\/>/;

function reading(key: string, value: number, unit = "°C", label = "CPU"): Reading {
	return { key, type: SensorType.Temperature, sensorIndex: 0, id: 1, label, unit, value, valueMin: value, valueMax: value, valueAvg: value };
}

function ok(...readings: Reading[]): Extract<PollerStatus, { state: "ok" }> {
	const snapshot: SensorSnapshot = { pollTime: 1, valueRevision: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	return { state: "ok", snapshot, source: "shared-memory" };
}

const STALE: PollerStatus = { state: "unavailable", reason: "not-running", message: "fixture" };

function fresh(): KeyAlerts {
	return new KeyAlerts(new AlertStore());
}

describe("which readings a key alerts on", () => {
	it("follows the drawn layout, one slot per drawn reading", () => {
		assert.deepEqual(referencedSlotKeys({ readingKey: "a" }), ["a"]);
		assert.deepEqual(referencedSlotKeys({ readingKey: "a", secondaryReadingKey: "b" }), ["a"], "dual needs the exact marker");
		assert.deepEqual(referencedSlotKeys({ readingKey: "a", secondaryReadingKey: "b", keyLayout: "dual" }), ["a", "b"]);
		assert.deepEqual(referencedSlotKeys({ readingKey: "a", secondaryReadingKey: "b", quadReadingKey3: "c", keyLayout: "triple" }), ["a", "b", "c"]);
		assert.deepEqual(referencedSlotKeys({ readingKey: "a", quadReadingKey3: "c", quadReadingKey4: "d", keyLayout: "quad" }), ["a", undefined, "c", "d"]);
		assert.deepEqual(referencedSlotKeys({}), []);
	});
});

describe("a key with no new alert fields alerts exactly as 1.7.1", () => {
	it("the live view equals the one-shot legacy comparison of reading 1 on every layout", () => {
		const layouts: ReadonlyArray<Partial<ReadingSettings>> = [{}, { keyLayout: "dual" }, { keyLayout: "triple" }, { keyLayout: "quad" }];
		const values = [-5, 0, 49.99, 50, 50.01, 79, 80, 95, Number.NaN, Number.POSITIVE_INFINITY];
		const pairs: ReadonlyArray<Partial<ReadingSettings>> = [{ warnValue: "50", critValue: "80" }, { warnValue: "80", critValue: "50" }, { warnValue: "50", alertBelow: true }, { critValue: "79,5" }, { warnValue: "junk" }, { fahrenheit: true, warnValue: "122" }];
		let now = 0;
		for (const layout of layouts) {
			for (const pair of pairs) {
				const alerts = fresh();
				const settings: KeyAlertSettings = { readingKey: "a", secondaryReadingKey: "b", quadReadingKey3: "c", quadReadingKey4: "d", ...layout, ...pair };
				alerts.appear("k", settings, ok(reading("a", 0)), now);
				for (const value of values) {
					now += 1000;
					const status = ok(reading("a", value), reading("b", 999), reading("c", 999), reading("d", 999));
					alerts.tick(status, now);
					const legacy = alertLevel(convertUnit(value, "°C", settings.fahrenheit === true).value, parseThreshold(settings.warnValue), parseThreshold(settings.critValue), settings.alertBelow === true);
					const view = alerts.view("k");
					assert.equal(view.face.level, legacy, `${JSON.stringify(settings)} at ${value}`);
					assert.equal(view.face.snoozed, null);
					assert.equal(view.perRow, false, "no rule entries: rows never give way");
					assert.deepEqual(view, immediateKeyView(settings, status.snapshot), "the live view equals the stateless one at the defaults");
				}
			}
		}
	});

	it("the face draws the legacy level, no snooze band and no per-row color", () => {
		const settings: ReadingSettings = { readingKey: "a", secondaryReadingKey: "b", warnValue: "50" };
		for (const layout of [undefined, "dual", "triple", "quad"]) {
			const s: ReadingSettings = { ...settings, ...(layout === undefined ? {} : { keyLayout: layout, quadReadingKey3: "c" }) };
			const status = ok(reading("a", 60), reading("b", 10), reading("c", 10));
			const level = alertLevel(60, 50, undefined, false);
			const explicit: KeyAlertView = { face: { level, snoozed: null }, slots: [], perRow: false };
			const svg = compose(s, status);
			assert.equal(svg, compose(s, status, false, undefined, explicit), `layout ${layout ?? "single"}: the stateless path is the 1.7.1 level path`);
			assert.ok(svg.includes(`fill="${WARN_BG}"`), "the whole key recolors");
			assert.doesNotMatch(svg, BAND);
		}
	});
});

describe("dwell, recovery and snooze through the key path", () => {
	it("Alert after holds a level back until it has lasted, over valid readings", () => {
		const alerts = fresh();
		const settings: KeyAlertSettings = { readingKey: "a", warnValue: "80", alertDwellMs: "2000" };
		alerts.appear("k", settings, ok(reading("a", 70)), 0);
		alerts.tick(ok(reading("a", 85)), 1000);
		assert.equal(alerts.view("k").face.level, "normal", "1 s past the limit");
		alerts.tick(ok(reading("a", 86)), 2999);
		assert.equal(alerts.view("k").face.level, "normal");
		alerts.tick(ok(reading("a", 86)), 3000);
		assert.equal(alerts.view("k").face.level, "warn", "2 s past the limit");
		alerts.tick(STALE, 4000);
		assert.equal(alerts.view("k").face.level, "normal", "no alarm drawn from data that is not current");
	});

	it("an invalid reading restarts the dwell, and missing data never alerts", () => {
		const alerts = fresh();
		const settings: KeyAlertSettings = { readingKey: "a", warnValue: "80", alertDwellMs: "2000" };
		alerts.appear("k", settings, ok(reading("a", 85)), 0);
		alerts.tick(ok(reading("a", Number.NaN)), 1500);
		alerts.tick(ok(reading("a", 85)), 2500);
		assert.equal(alerts.view("k").face.level, "normal", "the dwell started again at 2.5 s");
		alerts.tick(ok(), 5000);
		assert.equal(alerts.view("k").face.level, "normal", "a reading the snapshot lacks shows nothing");
		assert.equal(alerts.view("k").slots[0], undefined);
	});

	it("the recovery band holds a level until the value is back past it", () => {
		const alerts = fresh();
		alerts.appear("k", { readingKey: "a", warnValue: "80", alertHysteresis: "5" }, ok(reading("a", 81)), 0);
		assert.equal(alerts.view("k").face.level, "warn");
		alerts.tick(ok(reading("a", 76)), 1000);
		assert.equal(alerts.view("k").face.level, "warn", "within the band");
		alerts.tick(ok(reading("a", 74.9)), 2000);
		assert.equal(alerts.view("k").face.level, "normal", "past the band");
		alerts.tick(ok(reading("a", 79)), 3000);
		assert.equal(alerts.view("k").face.level, "normal", "entry is still at the limit itself");
	});

	it("a snooze silences what alerts now, ends on escalation, recovery or expiry, and waits for valid data", () => {
		const alerts = fresh();
		const settings: KeyAlertSettings = { readingKey: "a", warnValue: "80", critValue: "90", alertSnoozeMs: "300000" };
		alerts.appear("k", settings, ok(reading("a", 85)), 0);
		assert.equal(alerts.snoozeArmed("k"), true);
		assert.equal(alerts.snooze("k", 10), 1);
		assert.deepEqual(alerts.view("k").face, { level: "normal", snoozed: "warn" });
		assert.equal(alerts.snoozeArmed("k"), false, "nothing unsnoozed shows");
		alerts.tick(ok(reading("a", 86)), 1000);
		assert.deepEqual(alerts.view("k").face, { level: "normal", snoozed: "warn" });
		alerts.tick(ok(reading("a", 95)), 2000);
		assert.deepEqual(alerts.view("k").face, { level: "crit", snoozed: null }, "escalation ends the snooze");
		alerts.snooze("k", 2000);
		alerts.tick(STALE, 400_000);
		alerts.tick(STALE, 500_000);
		assert.deepEqual(alerts.view("k").face, { level: "normal", snoozed: null });
		alerts.tick(ok(reading("a", 95)), 600_000);
		assert.deepEqual(alerts.view("k").face, { level: "crit", snoozed: null }, "expiry lands on the first valid reading after its end");
	});

	it("a key without a snooze length never arms a snooze", () => {
		const alerts = fresh();
		alerts.appear("k", { readingKey: "a", warnValue: "80", alertSnoozeMs: "123" }, ok(reading("a", 85)), 0);
		assert.equal(alerts.snoozeArmed("k"), false);
		assert.equal(alerts.snooze("k", 0), 0);
		assert.equal(alerts.view("k").face.level, "warn");
	});
});

describe("edits and lifecycle", () => {
	it("a rule edit starts that reading fresh; a dwell change keeps it", () => {
		const alerts = fresh();
		const base: KeyAlertSettings = { readingKey: "a", warnValue: "80", alertDwellMs: "5000" };
		alerts.appear("k", base, ok(reading("a", 85)), 0);
		alerts.update("k", { ...base, alertDwellMs: "2000" }, ok(reading("a", 85)), 2000);
		assert.equal(alerts.view("k").face.level, "warn", "the pending entry from 0 s survived the dwell change");
		const alerts2 = fresh();
		alerts2.appear("k", base, ok(reading("a", 85)), 0);
		alerts2.update("k", { ...base, warnValue: "81" }, ok(reading("a", 85)), 4000);
		alerts2.tick(ok(reading("a", 85)), 5000);
		assert.equal(alerts2.view("k").face.level, "normal", "the new limit dwells from the edit");
		alerts2.tick(ok(reading("a", 85)), 9000);
		assert.equal(alerts2.view("k").face.level, "warn");
	});

	it("turning °F on resets the reading instead of carrying a level across units", () => {
		const alerts = fresh();
		const base: KeyAlertSettings = { readingKey: "a", warnValue: "80", alertHysteresis: "50" };
		alerts.appear("k", base, ok(reading("a", 85)), 0);
		assert.equal(alerts.view("k").face.level, "warn");
		alerts.update("k", { ...base, fahrenheit: true }, ok(reading("a", 20)), 1000);
		assert.equal(alerts.view("k").face.level, "normal", "68 °F against 80: fresh, so the old band does not latch it");
	});

	it("a hidden key with limits keeps stepping for the window; one with none is dropped", () => {
		const alerts = fresh();
		alerts.appear("k", { readingKey: "a", warnValue: "80" }, ok(reading("a", 85)), 0);
		alerts.appear("plain", { readingKey: "a" }, ok(reading("a", 85)), 0);
		alerts.hide("k", 10);
		alerts.hide("plain", 10);
		assert.equal(alerts.isTracked("plain"), false);
		alerts.tick(ok(reading("a", 85)), 1000);
		assert.deepEqual(alerts.shownFor("k", "a"), { level: "warn", snoozed: null }, "the Back tile reads the opener's live alert");
		alerts.tick(ok(reading("a", 85)), 10 + HIDDEN_TTL_MS + 1);
		assert.equal(alerts.isTracked("k"), false);
		assert.equal(alerts.shownFor("k", "a"), undefined, "past the window the Back tile compares once");
	});

	it("a key without limits shows what the full step shows, keeps its view while nothing moves, and leaves the store empty", () => {
		const store = new AlertStore();
		const alerts = new KeyAlerts(store);
		const settings: KeyAlertSettings = { readingKey: "a", secondaryReadingKey: "b", quadReadingKey3: "c", keyLayout: "triple" };
		alerts.appear("k", settings, ok(reading("a", 85), reading("b", 1)), 0);
		const first = alerts.view("k");
		assert.deepEqual(first, { face: { level: "normal", snoozed: null }, slots: [{ level: "normal", snoozed: null }, { level: "normal", snoozed: null }, undefined], perRow: false });
		alerts.tick(ok(reading("a", 90), reading("b", 2)), 1000);
		assert.equal(alerts.view("k"), first, "values moved, the view did not");
		alerts.tick(ok(reading("a", 90)), 2000);
		assert.deepEqual(alerts.view("k").slots, [{ level: "normal", snoozed: null }, undefined, undefined], "a slot whose reading left is empty");
		alerts.tick(ok(reading("a", 90), reading("b", 2), reading("c", 3)), 3000);
		assert.deepEqual(alerts.view("k").slots, [{ level: "normal", snoozed: null }, { level: "normal", snoozed: null }, { level: "normal", snoozed: null }]);
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 0 });
		// Limits removed from a key that was alerting: the store still holds
		// its track, so the full step runs and the track ends.
		alerts.update("k", { ...settings, warnValue: "80" }, ok(reading("a", 90), reading("b", 2), reading("c", 3)), 4000);
		assert.equal(alerts.view("k").face.level, "warn");
		alerts.update("k", settings, ok(reading("a", 90), reading("b", 2), reading("c", 3)), 5000);
		alerts.tick(ok(reading("a", 90), reading("b", 2), reading("c", 3)), 6000);
		assert.equal(alerts.view("k").face.level, "normal");
		assert.equal(store.holds("k"), false);
	});

	it("a replayed appear keeps the dwell and the snooze", () => {
		const alerts = fresh();
		const settings: KeyAlertSettings = { readingKey: "a", warnValue: "80", alertSnoozeMs: "900000" };
		alerts.appear("k", settings, ok(reading("a", 85)), 0);
		alerts.snooze("k", 0);
		alerts.hide("k", 100);
		alerts.appear("k", settings, ok(reading("a", 85)), 200);
		assert.deepEqual(alerts.view("k").face, { level: "normal", snoozed: "warn" });
	});
});

describe("per-reading rules on a multi-reading key", () => {
	const rules = { b: { warn: "50", unit: "°C" } };

	it("each reading alerts on its own rule; the face takes the highest; rows not alerting give way", () => {
		const alerts = fresh();
		const settings: KeyAlertSettings = { readingKey: "a", secondaryReadingKey: "b", keyLayout: "dual", warnValue: "90", alertRules: rules };
		alerts.appear("k", settings, ok(reading("a", 40), reading("b", 60)), 0);
		const view = alerts.view("k");
		assert.equal(view.face.level, "warn");
		assert.equal(view.perRow, true);
		assert.equal(view.slots[0]?.level, "normal");
		assert.equal(view.slots[1]?.level, "warn");
		assert.equal(rowGivesWay(view, 0), true);
		assert.equal(rowGivesWay(view, 1), false);
		const status = ok(reading("a", 40), reading("b", 60));
		const svg = compose(settings as ReadingSettings, status, false, undefined, view);
		const unit = loadThemes().alerts.warn.unit;
		assert.ok(svg.includes(`fill="${WARN_BG}"`), "the whole key recolors");
		assert.ok(svg.includes(`font-weight="700" fill="${unit}"`), "the row that is not alerting draws its value in the alert unit color");
	});

	it("a rule saved for another unit stands down instead of reinterpreting its numbers", () => {
		const alerts = fresh();
		const settings: KeyAlertSettings = { readingKey: "a", secondaryReadingKey: "b", keyLayout: "dual", alertRules: { b: { warn: "50", unit: "V" } } };
		alerts.appear("k", settings, ok(reading("a", 40), reading("b", 60)), 0);
		assert.equal(alerts.view("k").face.level, "normal");
		const panel = keyAlertPanelOf(settings, ok(reading("a", 40), reading("b", 60)).snapshot, alerts.view("k"));
		assert.ok(panel.slots[1]?.flags.some((f) => f.code === "unit-mismatch"));
		assert.equal(panel.slots[1]?.displayUnit, "°C", "the unit a new save captures");
		assert.equal(panel.slots[1]?.ruleKey, "b");
	});

	it("a °F key keeps a °C rule in its own unit", () => {
		const alerts = fresh();
		const settings: KeyAlertSettings = { readingKey: "a", fahrenheit: true, alertRules: { a: { warn: "50", unit: "°C" } } };
		alerts.appear("k", settings, ok(reading("a", 51)), 0);
		assert.equal(alerts.view("k").face.level, "warn", "51 °C is past 50 °C whatever the key shows");
	});

	it("a deliberate snooze draws the edge band in the silenced level's blended fill, on every layout", () => {
		const status = ok(reading("a", 95), reading("b", 10), reading("c", 10), reading("d", 10));
		const view: KeyAlertView = { face: { level: "normal", snoozed: "crit" }, slots: [{ level: "normal", snoozed: "crit" }], perRow: false };
		for (const layout of [{}, { keyLayout: "dual" }, { keyLayout: "triple" }, { keyLayout: "quad" }]) {
			const settings: ReadingSettings = { readingKey: "a", secondaryReadingKey: "b", quadReadingKey3: "c", quadReadingKey4: "d", critValue: "90", ...layout };
			const svg = compose(settings, status, false, undefined, view);
			assert.match(svg, BAND, JSON.stringify(layout));
			assert.ok(!svg.includes(`fill="${CRIT_BG}"`), "silenced: the face keeps its theme");
		}
	});
});
