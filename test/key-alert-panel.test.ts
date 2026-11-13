/**
 * The key panel's alert writes against the plugin's own answer: the preview
 * the key action sends (buildPreview with keyAlertPanelOf) read by the
 * panel's pure model (ui/pi-model.js: keyAlertSlot, alertRowPlan,
 * patchKeyAlertRule, alertsSummary), with the two write paths of pi-common.js
 * replayed here exactly as the panel runs them:
 *
 * - a row edit files the row's whole entry under fileKeyOf with the slot's
 *   limitUnit, and writes nothing while the plugin has no answer about the
 *   reading in that slot (not reporting, or a preview built for the
 *   previous reading);
 * - an edit of Warn at, Critical at or Clear after stamps alertDisplayUnit
 *   with legacyUnit in the same write, and stages nothing without an answer
 *   about reading 1.
 *
 * Then the face is computed again from the written settings, so each check
 * is about what the key shows after the edit, not about the panel's text.
 * The browser run of the same panel is scripts/e2e-pi-keys.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { immediateKeyView, keyAlertPanelOf, type KeyAlertPanel, type KeyAlertPanelSlot } from "../src/alerts/key-alerts";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { buildPreview, type PreviewSettings } from "../src/pi-protocol";
import type { PollerStatus } from "../src/poller";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";

applyGlobalThemeSettings({ theme: "void" });

type Settings = Record<string, unknown>;
type RowPlan = { slot: number; key: string; kind: "edit" | "same"; of?: number; ofRow?: boolean };
type Model = {
	keyAlertSlot(keyAlerts: unknown, slot: number, key: unknown): KeyAlertPanelSlot | null;
	alertRowPlan(settings: Settings, keyAlerts: unknown, keepFirst?: boolean): RowPlan[];
	patchKeyAlertRule(raw: unknown, fileKey: string, patch: Record<string, unknown>, unit?: string): Record<string, unknown>;
	alertsSummary(kind: string, settings: Settings, preview: unknown): string;
	alertsRoom(kind: string, settings: Settings, preview: unknown): string[];
	sortedJson(value: unknown): string;
	provenDisplayUnit(settings: Settings): string | undefined;
	alertStampProof(settings: Settings, field: string, value: unknown): Record<string, string>;
};

const source = readFileSync(fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/pi-model.js", import.meta.url)), "utf8");
const scope: { hwModel?: Model } = {};
new Function("self", source)(scope);
const model = scope.hwModel as Model;

const SLOT_FIELDS = ["readingKey", "secondaryReadingKey", "quadReadingKey3", "quadReadingKey4"];

function reading(key: string, value: number, unit = "°C", label = key.toUpperCase(), extra: Partial<Reading> = {}): Reading {
	return { key, type: SensorType.Temperature, sensorIndex: 0, id: 1, label, unit, value, valueMin: value, valueMax: value, valueAvg: value, ...extra };
}

function ok(...readings: Reading[]): Extract<PollerStatus, { state: "ok" }> {
	const snapshot: SensorSnapshot = { pollTime: 1, valueRevision: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "S" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	return { state: "ok", snapshot, source: "shared-memory" };
}

const CLOSED: PollerStatus = { state: "unavailable", reason: "not-running", message: "fixture" };

type Preview = ReturnType<typeof buildPreview> & { effective?: { keyAlerts?: KeyAlertPanel } };

/** What the key action sends its panel (sensor-reading.ts pushPreviewToPi
 * extras, compared once as at "Alert after: Immediately"). */
function previewOf(settings: Settings, status: PollerStatus): Preview {
	const snapshot = status.state === "unavailable" ? null : status.snapshot;
	const view = snapshot === null ? { face: { level: "normal" as const, snoozed: null }, slots: [], perRow: false } : immediateKeyView(settings, snapshot);
	return buildPreview(status, settings as PreviewSettings, true, { kind: "key", keyAlerts: keyAlertPanelOf(settings, snapshot, view) }) as Preview;
}

/** The face level the written settings give. */
function faceOf(settings: Settings, status: Extract<PollerStatus, { state: "ok" }>): string {
	return immediateKeyView(settings, status.snapshot).face.level;
}

/** pi-common.js commitRow: the row for `slot` written with `fields`, or
 * null when the panel writes nothing. */
function rowEdit(settings: Settings, preview: Preview, slot: number, fields: { warn?: string; crit?: string; hyst?: string; below?: boolean }): Settings | null {
	const key = settings[SLOT_FIELDS[slot] as string];
	const info = model.keyAlertSlot(preview.effective?.keyAlerts ?? null, slot, key);
	const unit = info?.limitUnit;
	if (typeof unit !== "string" || typeof key !== "string") return null;
	const fileKey = info !== null && info.source === "reading" && typeof info.ruleKey === "string" ? info.ruleKey : key;
	const raw = settings.alertRules;
	const prev = raw !== null && typeof raw === "object" && Object.hasOwn(raw, fileKey) ? ((raw as Record<string, Record<string, unknown>>)[fileKey] ?? {}) : {};
	// The row's fields hold what is stored until the person types.
	const text = (field: "warn" | "crit" | "hyst"): string => fields[field] ?? (typeof prev[field] === "string" ? (prev[field] as string) : "");
	const next = model.patchKeyAlertRule(raw, fileKey, { warn: text("warn"), crit: text("crit"), hyst: text("hyst"), below: fields.below ?? prev.below === true }, unit);
	if (model.sortedJson(next) === model.sortedJson(raw === undefined ? {} : raw)) return null;
	return { ...settings, alertRules: next };
}

/** pi-common.js stampLegacyUnit plus the field's own save. */
function legacyEdit(settings: Settings, preview: Preview, field: "warnValue" | "critValue" | "alertHysteresis", value: string): Settings {
	const info = model.keyAlertSlot(preview.effective?.keyAlerts ?? null, 0, settings.readingKey);
	const unit = info === null ? undefined : preview.effective?.keyAlerts?.legacyUnit;
	const proof = typeof unit === "string" || model.provenDisplayUnit(settings) !== undefined ? { alertDisplayUnitFor: model.alertStampProof(settings, field, value) } : {};
	return { ...settings, [field]: value, ...(typeof unit === "string" && settings.alertDisplayUnit !== unit ? { alertDisplayUnit: unit } : {}), ...proof };
}

describe("an edit never changes what the numbers it did not touch mean (K2-1)", () => {
	it("a °C row on a key switched to °F: the row is labeled and written in °C, so an edit of Critical at keeps Warn at", () => {
		const gpu50 = ok(reading("cpu", 40), reading("gpu", 50));
		let s: Settings = { keyLayout: "dual", readingKey: "cpu", secondaryReadingKey: "gpu", alertRules: { gpu: { warn: "80", unit: "°C" } }, fahrenheit: true };
		const p = previewOf(s, gpu50);
		const row = model.keyAlertSlot(p.effective?.keyAlerts, 1, "gpu");
		assert.equal(row?.limitUnit, "°C", "the unit the row's numbers are in, which its heading shows");
		assert.equal(row?.displayUnit, "°F");
		assert.equal(faceOf(s, gpu50), "normal");
		const edited = rowEdit(s, p, 1, { crit: "200" });
		assert.ok(edited !== null);
		s = edited;
		assert.deepEqual((s.alertRules as Settings).gpu, { warn: "80", unit: "°C", crit: "200" });
		assert.equal(faceOf(s, gpu50), "normal", "50 °C is still below the 80 °C it was typed as");
		assert.equal(faceOf(s, ok(reading("cpu", 40), reading("gpu", 81))), "warn");
	});

	it("reading 1 stamped °C on a key switched to °F: an edit of Critical at keeps the stamp, so Warn at keeps its meaning", () => {
		const cpu50 = ok(reading("cpu", 50));
		let s: Settings = { readingKey: "cpu", warnValue: "80", critValue: "90", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", crit: "90" }, fahrenheit: true };
		const p = previewOf(s, cpu50);
		assert.equal(p.effective?.keyAlerts?.legacyUnit, "°C");
		assert.equal(faceOf(s, cpu50), "normal");
		s = legacyEdit(s, p, "critValue", "200");
		assert.equal(s.alertDisplayUnit, "°C", "no restamp");
		assert.equal(faceOf(s, cpu50), "normal");
		assert.equal(faceOf(s, ok(reading("cpu", 81))), "warn");
	});

	it("an unstamped pair stamps the unit it is compared in today; a stamped pair with no numbers left takes the displayed unit", () => {
		const cpu = ok(reading("cpu", 50));
		const unstamped: Settings = { readingKey: "cpu", warnValue: "120", fahrenheit: true };
		assert.equal(legacyEdit(unstamped, previewOf(unstamped, cpu), "critValue", "200").alertDisplayUnit, "°F");
		const emptied: Settings = { readingKey: "cpu", warnValue: "", critValue: "", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "", crit: "" }, fahrenheit: true };
		assert.equal(legacyEdit(emptied, previewOf(emptied, cpu), "warnValue", "180").alertDisplayUnit, "°F", "new numbers are typed in the unit on the face");
	});

	it("a row whose unit no longer applies takes the reading's unit on the next edit, as its note says", () => {
		const status = ok(reading("cpu", 40), reading("gpu", 50));
		const s: Settings = { keyLayout: "dual", readingKey: "cpu", secondaryReadingKey: "gpu", alertRules: { gpu: { warn: "80", unit: "V" } } };
		const p = previewOf(s, status);
		assert.equal(model.keyAlertSlot(p.effective?.keyAlerts, 1, "gpu")?.limitUnit, "°C");
		assert.deepEqual((rowEdit(s, p, 1, { warn: "45" })?.alertRules as Settings).gpu, { warn: "45", unit: "°C" });
	});
});

describe("nothing is written for a reading that is not reporting (K2-2)", () => {
	const base: Settings = { keyLayout: "dual", readingKey: "cpu", secondaryReadingKey: "gpu" };

	it("a row whose reading is missing, or with HWiNFO closed, writes nothing", () => {
		assert.equal(rowEdit(base, previewOf(base, ok(reading("cpu", 50))), 1, { warn: "80" }), null);
		assert.equal(rowEdit(base, previewOf(base, CLOSED), 1, { warn: "80" }), null);
	});

	it("an edit once the reading reports saves its unit, and the rule alerts", () => {
		const status = ok(reading("cpu", 50), reading("gpu", 99));
		const s = rowEdit(base, previewOf(base, status), 1, { warn: "80" });
		assert.ok(s !== null);
		assert.deepEqual((s.alertRules as Settings).gpu, { warn: "80", unit: "°C" });
		assert.equal(immediateKeyView(s, status.snapshot).slots[1]?.level, "warn");
	});

	it("a rule saved without a unit says it is off until edited, never that it waits, while its reading reports; the edit turns it on", () => {
		const status = ok(reading("cpu", 50), reading("gpu", 99));
		const s: Settings = { ...base, alertRules: { gpu: { warn: "80" } } };
		const p = previewOf(s, status);
		const flags = model.keyAlertSlot(p.effective?.keyAlerts, 1, "gpu")?.flags ?? [];
		assert.deepEqual(
			flags.map((f) => f.code),
			["unit-not-captured"]
		);
		assert.doesNotMatch(flags[0]?.message ?? "", /wait/i);
		assert.match(flags[0]?.message ?? "", /off until you edit them/);
		const edited = rowEdit(s, p, 1, { warn: "85" });
		assert.ok(edited !== null);
		assert.equal(immediateKeyView(edited, status.snapshot).slots[1]?.level, "warn");
	});
});

describe("reading 1's limits are always on show (K2-3)", () => {
	it("the same reading on two rows: the later row has no fields, and Warn at stays in force", () => {
		const status = ok(reading("cpu", 90));
		const s: Settings = { keyLayout: "dual", readingKey: "cpu", secondaryReadingKey: "cpu", secondaryStatMode: "max", warnValue: "85" };
		const p = previewOf(s, status);
		assert.deepEqual(model.alertRowPlan(s, p.effective?.keyAlerts, false), [{ slot: 1, key: "cpu", kind: "same", of: 0, ofRow: false }]);
		assert.equal(faceOf(s, status), "warn");
	});

	it("alias and provider spellings of one reading count as the same reading", () => {
		const provider = reading("p:1", 90);
		const alias = reading("a:1", 90, "°C", "CPU", { aliasOf: "p:1", linkedKeys: ["p:1"] });
		const s: Settings = { keyLayout: "dual", readingKey: "a:1", secondaryReadingKey: "p:1" };
		const p = previewOf(s, ok(provider, alias));
		assert.deepEqual(
			model.alertRowPlan(s, p.effective?.keyAlerts, false).map((r) => r.kind),
			["same"]
		);
	});

	it("a lone direction box or Clear by saves no entry, so it cannot switch reading 1's Warn at off", () => {
		assert.deepEqual(model.patchKeyAlertRule(undefined, "cpu", { warn: "", crit: "", hyst: "", below: true }, "°C"), {});
		assert.deepEqual(model.patchKeyAlertRule(undefined, "cpu", { warn: "", crit: "", hyst: "3", below: false }, "°C"), {});
		assert.deepEqual(model.patchKeyAlertRule({ cpu: { warn: "70", below: true, unit: "°C" } }, "cpu", { warn: "", crit: "", hyst: "", below: true }, "°C"), {}, "clearing the last limit removes the entry");
		assert.deepEqual(model.patchKeyAlertRule({ cpu: { future: 1 } }, "cpu", { warn: "", crit: "", hyst: "", below: true }, "°C"), { cpu: { future: 1, below: true, unit: "°C" } }, "a field this build does not know keeps the entry");
		assert.deepEqual(model.patchKeyAlertRule(undefined, "cpu", { warn: "abc" }, "°C"), { cpu: { warn: "abc", unit: "°C" } }, "a typed value that is not a number stays as typed");
	});

	it("limits saved for a reading that became reading 1 get a row, and the line stops saying first reading", () => {
		const status = ok(reading("cpu", 85), reading("gpu", 70));
		const s: Settings = { keyLayout: "dual", readingKey: "gpu", secondaryReadingKey: "cpu", warnValue: "80", alertRules: { gpu: { warn: "95", unit: "°C" } } };
		const p = previewOf(s, status);
		assert.deepEqual(model.alertRowPlan(s, p.effective?.keyAlerts, false), [
			{ slot: 0, key: "gpu", kind: "edit" },
			{ slot: 1, key: "cpu", kind: "edit" }
		]);
		const summary = model.alertsSummary("key", s, p);
		assert.doesNotMatch(summary, /first reading/);
		assert.equal(summary, "Own limits on 1 reading");
		// Reading 1's row edits the entry that is in force.
		const edited = rowEdit(s, p, 0, { warn: "60" });
		assert.deepEqual((edited?.alertRules as Settings).gpu, { warn: "60", unit: "°C" });
		assert.equal(faceOf(edited as Settings, status), "warn");
	});

	it("one reading on two slots with its own limits counts once, and the later slot names the row that covers it", () => {
		const status = ok(reading("cpu", 85), reading("gpu", 70));
		const s: Settings = { keyLayout: "triple", readingKey: "cpu", secondaryReadingKey: "gpu", quadReadingKey3: "gpu", alertRules: { gpu: { warn: "60", unit: "°C" } } };
		const p = previewOf(s, status);
		assert.deepEqual(model.alertRowPlan(s, p.effective?.keyAlerts, false), [
			{ slot: 1, key: "gpu", kind: "edit" },
			{ slot: 2, key: "gpu", kind: "same", of: 1, ofRow: true }
		]);
		assert.equal(model.alertsSummary("key", s, p), "Own limits on 1 reading · warning now");
	});

	it("with HWiNFO closed, reading 1's own entry still shows as its row, read-only, and the line keeps naming it", () => {
		const s: Settings = { keyLayout: "dual", readingKey: "gpu", secondaryReadingKey: "cpu", warnValue: "80", alertRules: { gpu: { warn: "95", unit: "°C" } } };
		const p = previewOf(s, CLOSED);
		const first = model.keyAlertSlot(p.effective?.keyAlerts, 0, "gpu");
		assert.deepEqual([first?.source, first?.ruleKey, first?.limitUnit, p.effective?.keyAlerts?.legacyUnit], ["reading", "gpu", null, null]);
		assert.deepEqual(
			model.alertRowPlan(s, p.effective?.keyAlerts, false).map((r) => [r.slot, r.kind]),
			[
				[0, "edit"],
				[1, "edit"]
			]
		);
		assert.equal(rowEdit(s, p, 0, { warn: "60" }), null, "nothing to capture a unit from");
		assert.doesNotMatch(model.alertsSummary("key", s, p), /first reading/);
	});

	it("reading 1's row stays while the person is in it, after its numbers are cleared", () => {
		const s: Settings = { keyLayout: "dual", readingKey: "gpu", secondaryReadingKey: "cpu" };
		const p = previewOf(s, ok(reading("cpu", 85), reading("gpu", 70)));
		assert.deepEqual(
			model.alertRowPlan(s, p.effective?.keyAlerts, true).map((r) => r.slot),
			[0, 1]
		);
		assert.deepEqual(
			model.alertRowPlan(s, p.effective?.keyAlerts, false).map((r) => r.slot),
			[1]
		);
	});
});

describe("the Alerts line prints Warn at and Critical at in the unit they are compared in (K2-4)", () => {
	it("typed as °F, shown in °C: the line says °F, as the key compares", () => {
		const status = ok(reading("cpu", 85));
		const s: Settings = { readingKey: "cpu", warnValue: "176", alertDisplayUnit: "°F", alertDisplayUnitFor: { warn: "176" }, fahrenheit: false };
		const p = previewOf(s, status);
		assert.equal(faceOf(s, status), "warn", "85 °C is 185 °F");
		assert.equal(model.alertsSummary("key", s, p), "Warn ≥ 176 °F · warning now");
	});

	it("typed as °C, shown in °F: the line says °C", () => {
		const s: Settings = { readingKey: "cpu", warnValue: "80", critValue: "90", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", crit: "90" }, fahrenheit: true };
		assert.equal(model.alertsSummary("key", s, previewOf(s, ok(reading("cpu", 50)))), "Warn ≥ 80 °C · critical ≥ 90 °C");
	});

	it("an unstamped pair keeps the 1.7.1 line in the displayed unit", () => {
		const s: Settings = { readingKey: "cpu", warnValue: "176", fahrenheit: true };
		assert.equal(model.alertsSummary("key", s, previewOf(s, ok(reading("cpu", 85)))), "Warn ≥ 176 °F · warning now");
	});

	it("without the live path the preview compares in the stamped unit too", () => {
		const s: Settings = { readingKey: "cpu", warnValue: "176", alertDisplayUnit: "°F", alertDisplayUnitFor: { warn: "176" } };
		const p = buildPreview(ok(reading("cpu", 85)), s as PreviewSettings, true, { kind: "key" }) as Preview & { effective?: { alert?: { level: string; unit: string | null } } };
		assert.deepEqual([p.effective?.alert?.level, p.effective?.alert?.unit], ["warn", "°F"]);
	});
});

describe("the Alerts line keeps the room of its live endings", () => {
	it("holds the same text with warning now, critical now and a snooze, whatever the reading shows now", () => {
		const s: Settings = { readingKey: "cpu", warnValue: "80", critValue: "90" };
		const base = "Warn ≥ 80 °C · critical ≥ 90 °C";
		const room = [base, `${base} · warning now`, `${base} · critical now`].flatMap((t) => [t, `${t} · snoozed`]).sort();
		for (const value of [50, 85, 95]) {
			const p = previewOf(s, ok(reading("cpu", value)));
			assert.deepEqual(model.alertsRoom("key", s, p).sort(), room, String(value));
			assert.ok(model.alertsRoom("key", s, p).includes(model.alertsSummary("key", s, p)), "the line shown is one of them");
		}
		const own: Settings = { keyLayout: "dual", readingKey: "gpu", secondaryReadingKey: "cpu", alertRules: { gpu: { warn: "95", unit: "°C" } } };
		assert.deepEqual(model.alertsRoom("key", own, previewOf(own, ok(reading("cpu", 85), reading("gpu", 70)))).sort(), ["Own limits on 1 reading", "Own limits on 1 reading · warning now", "Own limits on 1 reading · critical now"].flatMap((t) => [t, `${t} · snoozed`]).sort());
	});

	it("keeps no room for a line with one text", () => {
		const off: Settings = { readingKey: "cpu" };
		assert.deepEqual(model.alertsRoom("key", off, previewOf(off, ok(reading("cpu", 85)))), []);
		const junk: Settings = { readingKey: "cpu", warnValue: "hot" };
		assert.deepEqual(model.alertsRoom("key", junk, previewOf(junk, ok(reading("cpu", 85)))), []);
	});
});

describe("a stamp counts only while the numbers are the ones it was saved with (downgrade, then re-upgrade)", () => {
	it("Warn at and Critical at retyped under 1.7.1 after a °F switch are read as typed, not in the old stamp", () => {
		// 1.8 saved 80/90 typed in °C. 1.7.1 keeps alertDisplayUnit and its
		// record through its whole-document saves, and the person, told by
		// the 1.7.1 docs to re-enter the numbers after ticking °F, types
		// 176/194.
		const saved: Settings = { readingKey: "cpu", warnValue: "80", critValue: "90", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", crit: "90" } };
		const retyped: Settings = { ...saved, fahrenheit: true, warnValue: "176", critValue: "194" };
		const at85 = ok(reading("cpu", 85));
		assert.equal(faceOf(retyped, at85), "warn", "85 °C is 185 °F: at or above 176 °F, as 1.7.1 said");
		assert.equal(faceOf(retyped, ok(reading("cpu", 91))), "crit");
		assert.equal(faceOf(retyped, ok(reading("cpu", 70))), "normal");
		assert.equal(model.alertsSummary("key", retyped, previewOf(retyped, at85)), "Warn ≥ 176 °F · critical ≥ 194 °F · warning now");
		// The reverse: stamped °F, retyped in °C.
		const reverse: Settings = { readingKey: "cpu", warnValue: "80", critValue: "90", alertDisplayUnit: "°F", alertDisplayUnitFor: { warn: "176", crit: "194" } };
		assert.equal(faceOf(reverse, at85), "warn", "compared as displayed, not 185 °F against 80");
		// A °F switch alone, numbers untouched, keeps converting.
		assert.equal(faceOf({ ...saved, fahrenheit: true }, at85), "warn", "85 °C against 80 °C");
		assert.equal(faceOf({ ...saved, fahrenheit: true }, ok(reading("cpu", 79))), "normal");
	});

	it("a stamp with no record proves nothing; a record of other text or Clear after changed ends it too", () => {
		// 50 °C is 122 °F: at or above 80 when compared as displayed, below
		// 80 when the stamp counts.
		const at50 = ok(reading("cpu", 50));
		assert.equal(faceOf({ readingKey: "cpu", warnValue: "80", alertDisplayUnit: "°C", fahrenheit: true }, at50), "warn", "80 compared as °F, exactly as 1.7.1");
		assert.equal(faceOf({ readingKey: "cpu", warnValue: "80", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", hyst: "2" }, fahrenheit: true }, at50), "warn");
		assert.equal(faceOf({ readingKey: "cpu", warnValue: "80", alertHysteresis: "2", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", hyst: "2" }, fahrenheit: true }, at50), "normal");
		assert.equal(model.provenDisplayUnit({ warnValue: 80, alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80" } }), "°C", "a number counts by its decimal spelling");
		assert.equal(model.provenDisplayUnit({ warnValue: "80", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: 80 } }), undefined, "a record holds text");
	});

	it("each panel edit records the text of all three fields with the stamp", () => {
		const cpu50 = ok(reading("cpu", 50));
		let s: Settings = { readingKey: "cpu", warnValue: "176", fahrenheit: true };
		s = legacyEdit(s, previewOf(s, cpu50), "critValue", "194");
		assert.deepEqual([s.alertDisplayUnit, s.alertDisplayUnitFor], ["°F", { warn: "176", crit: "194" }]);
		s = legacyEdit(s, previewOf(s, cpu50), "alertHysteresis", "3");
		assert.deepEqual(s.alertDisplayUnitFor, { warn: "176", crit: "194", hyst: "3" });
		assert.equal(model.provenDisplayUnit(s), "°F");
	});
});

describe("a preview about the previous reading of a slot is no answer (K2-6)", () => {
	it("after a pick, nothing is filed under the old reading or captured from its unit until the new preview arrives", () => {
		const old: Settings = { keyLayout: "dual", readingKey: "cpu", secondaryReadingKey: "gpu", alertRules: { gpu: { warn: "70", unit: "°C" } } };
		const stale = previewOf(old, ok(reading("cpu", 40), reading("gpu", 50), reading("fan", 900, "RPM")));
		const picked: Settings = { ...old, secondaryReadingKey: "fan" };
		assert.equal(model.keyAlertSlot(stale.effective?.keyAlerts, 1, "fan"), null);
		assert.equal(rowEdit(picked, stale, 1, { warn: "500" }), null);
		const fresh = previewOf(picked, ok(reading("cpu", 40), reading("gpu", 50), reading("fan", 900, "RPM")));
		const written = rowEdit(picked, fresh, 1, { warn: "500" });
		assert.deepEqual(written?.alertRules, { gpu: { warn: "70", unit: "°C" }, fan: { warn: "500", unit: "RPM" } });
	});

	it("reading 1's stamp is not staged from a stale preview either", () => {
		const old: Settings = { readingKey: "cpu", fahrenheit: true };
		const stale = previewOf(old, ok(reading("cpu", 40), reading("watts", 30, "W")));
		const picked: Settings = { readingKey: "watts", fahrenheit: true };
		assert.equal(legacyEdit(picked, stale, "warnValue", "50").alertDisplayUnit, undefined);
	});
});
