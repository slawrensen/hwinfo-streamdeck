/**
 * The dial panel's alert helpers in ui/pi-model.js (the shipped bytes,
 * evaluated against a stub `self`): the Timing summary and the parsers it
 * mirrors from the runtime, the lossless "Separate limits" write helpers,
 * the notes in the panel's words, the Alerts summary for a reading with
 * limits of its own, and the Control key's snooze command names.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { alertFlags, DEFAULT_COMMAND_SNOOZE_MS, parseAlertConfig, parseAlertDwellMs, parseAlertSnoozeMs, readingRuleOf, ruleFor, ruleUnitFor, ruleValue, type ResolvedRule } from "../src/alerts/rules";
import { SensorType, type Reading } from "../src/hwinfo/types";
import { buildPreview, type PreviewSettings } from "../src/pi-protocol";
import type { PollerStatus } from "../src/poller";
import { convertUnit, parseThreshold } from "../src/ui/format";

type Settings = Record<string, unknown>;
type Found = { key: string; entry: Record<string, unknown> } | null;
type Model = {
	alertTimingSummary(settings: Settings): string;
	alertDwellMsOf(settings: Settings): number;
	alertSnoozeMsOf(settings: Settings): number;
	alertRuleOf(rules: unknown, keys: readonly string[]): Found;
	patchAlertRule(rules: unknown, key: string, fields: Record<string, unknown>): Record<string, unknown>;
	withoutAlertRule(rules: unknown, keys: readonly string[]): Record<string, unknown>;
	alertNoteText(flag: unknown, source?: unknown): string | null;
	alertUnitUsable(stored: unknown, displayUnit: unknown): boolean;
	alertEditFields(entry: unknown, displayUnit: unknown, fields: Record<string, unknown>): Record<string, unknown>;
	alertFieldUnit(entry: unknown, displayUnit: unknown): string;
	alertRuleSeed(settings: Settings, readingAlert: { displayUnit: string; legacyApplies: boolean }): Record<string, unknown>;
	alertOwnFieldNotes(values: Record<string, unknown> | null): string[];
	alertNotes(ownValues: Record<string, unknown> | null, flags: unknown, source: unknown): string;
	alertsSummary(kind: string, settings: Settings, preview: unknown): string;
	alertsRoom(kind: string, settings: Settings, preview: unknown): string[];
	controlSummary(settings: Settings): { command: string; target: string };
	gestureWords(command: string, settings: Settings): string;
};

const source = readFileSync(fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/pi-model.js", import.meta.url)), "utf8");
const scope: { hwModel?: Model } = {};
new Function("self", source)(scope);
const model = scope.hwModel as Model;

const RAW_VALUES: readonly unknown[] = [undefined, null, "", "0", "2000", "5000", "10000", "30000", "300000", "900000", "3600000", 2000, "2000 ", "1e3", "abc", true, [], {}];

describe("Timing", () => {
	it("reads Alert after and the snooze length exactly as the runtime does", () => {
		for (const raw of RAW_VALUES) {
			assert.equal(model.alertDwellMsOf({ alertDwellMs: raw }), parseAlertDwellMs(raw), JSON.stringify(raw));
			assert.equal(model.alertSnoozeMsOf({ alertSnoozeMs: raw }), parseAlertSnoozeMs(raw) ?? DEFAULT_COMMAND_SNOOZE_MS, JSON.stringify(raw));
		}
	});

	it("summarizes what runs, defaults included", () => {
		assert.equal(model.alertTimingSummary({}), "Alerts show at once · snooze 15 min");
		assert.equal(model.alertTimingSummary({ alertDwellMs: "5000", alertSnoozeMs: "3600000" }), "Alerts show after 5 s · snooze 1 hour");
		assert.equal(model.alertTimingSummary({ alertDwellMs: "30000", alertSnoozeMs: "300000" }), "Alerts show after 30 s · snooze 5 min");
		assert.equal(model.alertTimingSummary({ alertDwellMs: 5000, alertSnoozeMs: "forever" }), "Alerts show at once · snooze 15 min", "junk reads as the runtime reads it");
	});
});

describe("Separate limits: finding and writing one entry", () => {
	it("finds the entry the runtime uses: own key first, then the linked keys, objects only", () => {
		const rules = JSON.parse('{"__proto__":{"warn":"1","unit":"V"},"b:0:1":"junk","c:0:1":{"warn":"70","unit":"°C"},"d:0:1":{"crit":"90","unit":"°C"}}') as Record<string, unknown>;
		const cases: Array<readonly string[]> = [["c:0:1"], ["b:0:1", "c:0:1"], ["d:0:1", "c:0:1"], ["__proto__"], ["x:0:1"], ["b:0:1"]];
		for (const keys of cases) {
			const runtime = readingRuleOf(parseAlertConfig({ alertRules: rules }), { key: keys[0] as string, linkedKeys: keys });
			assert.equal(model.alertRuleOf(rules, keys)?.key ?? null, runtime?.key ?? null, JSON.stringify(keys));
		}
		assert.equal(model.alertRuleOf("junk", ["c:0:1"]), null);
		assert.equal(model.alertRuleOf(["c:0:1"], ["0"]), null);
	});

	it("patches one entry's named fields and keeps everything else as stored", () => {
		const stored = { "c:0:1": { warn: "70", unit: "°C", future: 1 }, "e:0:1": 42, other: { crit: "x" } };
		const next = model.patchAlertRule(stored, "c:0:1", { warn: "75", below: true, hyst: undefined });
		assert.deepEqual(next, { "c:0:1": { warn: "75", unit: "°C", future: 1, below: true }, "e:0:1": 42, other: { crit: "x" } });
		assert.deepEqual(stored["c:0:1"], { warn: "70", unit: "°C", future: 1 }, "the stored map is not mutated");
		const created = model.patchAlertRule(undefined, "f:0:1", { unit: "RPM", warn: undefined });
		assert.deepEqual(created, { "f:0:1": { unit: "RPM" } });
		const proto = model.patchAlertRule({}, "__proto__", { unit: "V" });
		assert.equal(Object.hasOwn(proto, "__proto__"), true, "a reading key spelled __proto__ is an own entry");
		assert.deepEqual(JSON.parse(JSON.stringify(proto)), JSON.parse('{"__proto__":{"unit":"V"}}'));
	});

	it("clearing the box removes every entry the runtime would use for the reading, and nothing else", () => {
		const stored = { "c:0:1": { warn: "70" }, "g:CPU": { warn: "71" }, "d:0:1": { warn: "72" }, "h:0:1": "junk" };
		assert.deepEqual(model.withoutAlertRule(stored, ["c:0:1", "g:CPU", "h:0:1"]), { "d:0:1": { warn: "72" }, "h:0:1": "junk" });
		assert.deepEqual(model.withoutAlertRule(null, ["c:0:1"]), {});
	});
});

describe("notes in the panel's words", () => {
	it("leaves a field that is not a number to the panel's own check and names the recovery band by the field that applies", () => {
		assert.equal(model.alertNoteText({ code: "warn-not-number", message: "Warn value is not a number" }), null);
		assert.equal(model.alertNoteText({ code: "hyst-not-number", message: "x" }, "reading"), null);
		assert.equal(model.alertNoteText({ code: "hyst-negative", message: "x" }), "Clear by is below 0, so it counts as 0");
		assert.equal(model.alertNoteText({ code: "band-wider-than-gap", message: "x" }, "legacy"), "Clear by is as wide as the gap between warn and critical, or wider");
		assert.equal(model.alertNoteText({ code: "hyst-negative", message: "x" }, "reading"), "Its clear by is below 0, so it counts as 0");
		assert.equal(model.alertNoteText({ code: "band-wider-than-gap", message: "x" }, "reading"), "Its clear by is as wide as the gap between warn and critical, or wider");
		assert.equal(model.alertNoteText({ code: "unit-mismatch", message: "These limits were set for RPM" }), "These limits were set for RPM");
		for (const junk of [null, undefined, "unit-mismatch", { code: 1, message: "x" }, { code: "x" }]) assert.equal(model.alertNoteText(junk), null);
	});
});

describe("the dial's Alerts summary", () => {
	const effective = (alert: Record<string, unknown>, readingAlert?: Record<string, unknown>): Record<string, unknown> => ({ effective: { alert, ...(readingAlert === undefined ? {} : { readingAlert }) } });
	const legacyAlert = { level: "warn", warn: 80, crit: 95, below: false, unit: "°C", applies: true, scopeUnit: "°C" };
	const readingAlert = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ key: "c:0:1", ruleKey: null, displayUnit: "°C", source: "legacy", legacyApplies: true, level: "warn", snoozed: null, flags: [], dwellMs: 0, snoozeMs: 900000, ...over });
	const endings = (text: string): string[] => [text, `${text} · warning now`, `${text} · critical now`, `${text} · snoozed`];

	it("a reading with limits of its own is summarized by them, with what its face shows", () => {
		const settings = { warnValue: "80", alertRules: { "c:0:1": { warn: "90", crit: "95", unit: "°C" } } };
		assert.equal(model.alertsSummary("dial", settings, effective(legacyAlert, readingAlert({ ruleKey: "c:0:1", source: "reading", level: "normal", snoozed: "warn" }))), "This reading: warn ≥ 90 °C · critical ≥ 95 °C · snoozed");
		const below = { alertRules: { "c:0:1": { crit: "400", below: true, unit: "RPM" } } };
		assert.equal(model.alertsSummary("dial", below, effective(legacyAlert, readingAlert({ ruleKey: "c:0:1", source: "reading", level: "crit" }))), "This reading: critical ≤ 400 RPM · critical now");
		const empty = { alertRules: { "c:0:1": { unit: "°C" } } };
		assert.equal(model.alertsSummary("dial", empty, effective(legacyAlert, readingAlert({ ruleKey: "c:0:1", source: null, level: "normal" }))), "This reading: off");
	});

	it("the dial's own limits say what the face shows after Alert after and a snooze", () => {
		assert.equal(model.alertsSummary("dial", { warnValue: "80", critValue: "95" }, effective(legacyAlert, readingAlert())), "Warn ≥ 80 °C · critical ≥ 95 °C · °C readings only · warning now");
		assert.equal(model.alertsSummary("dial", { warnValue: "80", critValue: "95" }, effective(legacyAlert, readingAlert({ level: "normal" }))), "Warn ≥ 80 °C · critical ≥ 95 °C · °C readings only", "held back by Alert after");
		assert.equal(model.alertsSummary("dial", { warnValue: "80", critValue: "95" }, effective(legacyAlert, readingAlert({ level: "normal", snoozed: "warn" }))), "Warn ≥ 80 °C · critical ≥ 95 °C · °C readings only · snoozed");
	});

	it("keeps the room of every live ending: the same text with warning now, critical now or snoozed, and none for a line with one text", () => {
		const settings = { warnValue: "80", critValue: "95" };
		const base = "Warn ≥ 80 °C · critical ≥ 95 °C · °C readings only";
		const room = [base, `${base} · warning now`, `${base} · critical now`, `${base} · snoozed`].sort();
		for (const shown of [{ level: "normal" }, { level: "warn" }, { level: "crit" }, { level: "normal", snoozed: "crit" }]) {
			const preview = effective(legacyAlert, readingAlert(shown));
			assert.deepEqual(model.alertsRoom("dial", settings, preview).sort(), room, JSON.stringify(shown));
			assert.ok(model.alertsRoom("dial", settings, preview).includes(model.alertsSummary("dial", settings, preview)), "the line shown is one of them");
		}
		assert.deepEqual(model.alertsRoom("dial", settings, effective(legacyAlert)).sort(), [base, `${base} · warning now`, `${base} · critical now`].sort(), "before the plugin answers with the reading");
		const own = { alertRules: { "c:0:1": { warn: "90", unit: "°C" } } };
		const mine = "This reading: warn ≥ 90 °C";
		assert.deepEqual(model.alertsRoom("dial", own, effective(legacyAlert, readingAlert({ ruleKey: "c:0:1", source: "reading", level: "normal" }))).sort(), [mine, base].flatMap(endings).sort(), "a step off it shows the dial's limits");
		assert.deepEqual(model.alertsRoom("dial", {}, effective({ ...legacyAlert, warn: null, crit: null }, readingAlert({ level: "normal" }))), []);
	});

	it("keeps the same room on every step onto or off a reading with limits of its own, and the line shown is always in it", () => {
		const settings = { warnValue: "80", critValue: "90", alertUnit: "°C", alertRules: { "c:0:2": { warn: "60", crit: "90", unit: "°C" } } };
		const alert = { ...legacyAlert, crit: 90 };
		const onShared = effective(alert, readingAlert({ key: "c:0:1", level: "normal" }));
		const onOwn = effective(alert, readingAlert({ key: "c:0:2", ruleKey: "c:0:2", source: "reading", level: "normal" }));
		const room = model.alertsRoom("dial", settings, onShared).sort();
		assert.deepEqual(model.alertsRoom("dial", settings, onOwn).sort(), room);
		assert.deepEqual(room, ["Warn ≥ 80 °C · critical ≥ 90 °C · °C readings only", "This reading: warn ≥ 60 °C · critical ≥ 90 °C"].flatMap(endings).sort());
		for (const preview of [onShared, onOwn]) assert.ok(room.includes(model.alertsSummary("dial", settings, preview)), model.alertsSummary("dial", settings, preview));
		assert.deepEqual(model.alertsRoom("dial", settings, effective(alert)).sort(), endings("Warn ≥ 80 °C · critical ≥ 90 °C · °C readings only").slice(0, 3).sort(), "before the plugin answers with the reading, as before");
		assert.deepEqual(model.alertsRoom("key", settings, effective({ ...alert, scopeUnit: null })).sort(), ["Warn ≥ 80 °C · critical ≥ 90 °C", "Warn ≥ 80 °C · critical ≥ 90 °C · critical now", "Warn ≥ 80 °C · critical ≥ 90 °C · warning now"].sort(), "a key, as before");
	});

	it("a key, and a dial before the plugin answers with the reading, summarize exactly as before", () => {
		assert.equal(model.alertsSummary("dial", { warnValue: "80", critValue: "95" }, effective(legacyAlert)), "Warn ≥ 80 °C · critical ≥ 95 °C · °C readings only · warning now");
		assert.equal(model.alertsSummary("key", { warnValue: "80" }, effective({ ...legacyAlert, scopeUnit: null }, readingAlert({ ruleKey: "c:0:1", level: "normal" }))), "Warn ≥ 80 °C · critical ≥ 95 °C · warning now");
	});

	it("names the readings the limits cover in the unit the dial shows them in, °F with °F on, on every reading of the rotation", () => {
		const temp: Reading = { key: "t:0:1", type: SensorType.Temperature, sensorIndex: 0, id: 1, label: "GPU Temperature", unit: "°C", value: 58, valueMin: 58, valueMax: 58, valueAvg: 58 };
		const power: Reading = { ...temp, key: "p:0:2", type: SensorType.Power, id: 2, label: "GPU Power", unit: "W", value: 212, valueMin: 212, valueMax: 212, valueAvg: 212 };
		const status: PollerStatus = { state: "ok", source: "shared-memory", snapshot: { pollTime: 1, valueRevision: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "GPU" }], readings: [temp, power], byKey: new Map([temp, power].map((r) => [r.key, r])) } };
		const lines = (settings: Settings): string[] => [temp, power].map((r) => model.alertsSummary("dial", settings, buildPreview(status, { ...settings, readingKey: r.key } as PreviewSettings, false, { kind: "dial" })));
		const both = (line: string): string[] => [line, line];
		assert.deepEqual(lines({ warnValue: "176", critValue: "194", alertUnit: "°C", fahrenheit: true }), both("Warn ≥ 176 °F · critical ≥ 194 °F · °F readings only"));
		assert.deepEqual(lines({ warnValue: "80", critValue: "90", alertUnit: "°C", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", crit: "90" }, fahrenheit: true }), both("Warn ≥ 80 °C · critical ≥ 90 °C · °F readings only"), "typed in °C, then °F ticked: the limits keep °C, the readings show °F");
		assert.deepEqual(lines({ warnValue: "80", critValue: "90", alertUnit: "°C" }), both("Warn ≥ 80 °C · critical ≥ 90 °C · °C readings only"));
		assert.deepEqual(lines({ warnValue: "250", alertUnit: "W", fahrenheit: true }), both("Warn ≥ 250 W · W readings only"));
	});
});

describe("snooze command names", () => {
	it("the Control key names both snooze commands and their reach", () => {
		assert.deepEqual(model.controlSummary({ command: "snoozeAlerts" }), { command: "Snooze alerts", target: "every dial" });
		assert.deepEqual(model.controlSummary({ command: "unsnoozeAlerts", target: "cpu" }), { command: "End alert snooze", target: 'dials with Link ID "cpu"' });
	});

	it("a dial gesture mapped to snooze is described", () => {
		assert.equal(model.gestureWords("snooze", {}), "snoozes alerts");
	});
});

/** A reading the face shows in `display`, as HWiNFO reports it. */
function readingShownIn(display: string): { reading: { key: string; unit: string; value: number }; fahrenheit: boolean } {
	if (display === "°F") return { reading: { key: "c:0:1", unit: "°C", value: 70 }, fahrenheit: true };
	if (display === "Δ°F") return { reading: { key: "c:0:1", unit: "Δ°C", value: 3 }, fahrenheit: true };
	return { reading: { key: "c:0:1", unit: display, value: 70 }, fahrenheit: false };
}

const DISPLAYS: readonly string[] = ["°C", "°F", "Δ°C", "Δ°F", "W", "RPM", "MB", "Yes/No", ""];
const STORED_UNITS: readonly unknown[] = [undefined, null, 7, true, "", "°C", "°F", "Δ°C", "Δ°F", "W", "RPM", "MB", "MB/s", "Yes/No"];

describe("Separate limits: the unit an edit keeps or saves", () => {
	it("a saved unit compares exactly when the runtime's ruleUnitFor says it does", () => {
		for (const display of DISPLAYS) {
			const { reading, fahrenheit } = readingShownIn(display);
			assert.equal(convertUnit(reading.value, reading.unit, fahrenheit).unit, display);
			for (const stored of STORED_UNITS) {
				const rule: ResolvedRule = { source: "reading", ruleKey: reading.key, warn: 1, below: false, hyst: 0, unit: typeof stored === "string" ? { kind: "captured", unit: stored } : { kind: "uncaptured" } };
				assert.equal(model.alertUnitUsable(stored, display), ruleUnitFor(rule, reading, fahrenheit) !== undefined, `${JSON.stringify(stored)} on a ${JSON.stringify(display)} face`);
			}
		}
	});

	it("an edit of limits that were off saves the unit on the face with it, and the limits apply again", () => {
		const watts = { key: "p:0:1", unit: "W", value: 320 };
		const stored = { [watts.key]: { warn: "300", crit: "400", unit: "°C", future: 1 } };
		const before = parseAlertConfig({ alertRules: stored });
		assert.deepEqual(alertFlags(before, "dial", watts, 0, false).map((f) => f.code), ["unit-mismatch"], "the fixture's limits are off");
		const next = model.patchAlertRule(stored, watts.key, model.alertEditFields(stored[watts.key], "W", { warn: "350" }));
		assert.deepEqual(next[watts.key], { warn: "350", crit: "400", unit: "W", future: 1 });
		const after = parseAlertConfig({ alertRules: next });
		assert.deepEqual(alertFlags(after, "dial", watts, 0, false), [], "no note once edited");
		const rule = ruleFor(after, "dial", watts, 0);
		assert.ok(rule !== null && ruleValue(rule, watts, false) === 320, "they compare the value again");
		// The direction is an edit too, and so is an entry saved before its
		// reading reported a unit.
		assert.deepEqual(model.alertEditFields({ warn: "300", unit: "°C" }, "W", { below: true }), { below: true, unit: "W" });
		assert.deepEqual(model.alertEditFields({ warn: "300" }, "W", { warn: "310" }), { warn: "310", unit: "W" });
		assert.deepEqual(model.alertEditFields("junk", "W", { warn: "310" }), { warn: "310", unit: "W" });
	});

	it("a unit that still compares is kept, so the entry's other limits are never reinterpreted", () => {
		assert.deepEqual(model.alertEditFields({ warn: "80", crit: "90", unit: "°C" }, "°F", { warn: "85" }), { warn: "85" }, "°C limits on a °F face stay °C");
		assert.deepEqual(model.alertEditFields({ warn: "80", unit: "°C" }, "°C", { crit: "95" }), { crit: "95" });
		assert.deepEqual(model.alertEditFields({ warn: "300", unit: "°C" }, undefined, { warn: "310" }), { warn: "310" }, "no reading reporting: the edit goes alone");
	});

	it("the brackets name the unit the fields are typed in", () => {
		assert.equal(model.alertFieldUnit({ unit: "°C" }, "°F"), "°C", "a compared °C entry is typed in °C");
		assert.equal(model.alertFieldUnit({ unit: "°C" }, "W"), "W", "limits that are off take the face's unit with the next edit");
		assert.equal(model.alertFieldUnit({ warn: "1" }, "RPM"), "RPM");
		assert.equal(model.alertFieldUnit({ unit: "MB" }, undefined), "MB", "not reporting: the saved unit");
		assert.equal(model.alertFieldUnit({}, undefined), "");
		assert.equal(model.alertFieldUnit({ unit: "" }, ""), "", "a unitless reading");
	});
});

describe("Separate limits: the tick's starting point", () => {
	const LIMITS: readonly unknown[] = [undefined, "", "  ", "80", " 80 ", "85,5", 80, 0, -5, Number.NaN, "8o", null, true];
	const BANDS: readonly unknown[] = [undefined, "2", 2, "1,5", "-1", "x"];
	const STAMPS: readonly unknown[] = [undefined, "°C", "°F", "W"];

	it("compares exactly as the dial's own limits did for the reading, numbers stored as numbers included", () => {
		let compared = 0;
		for (const display of ["°C", "°F", "W"]) {
			const { reading, fahrenheit } = readingShownIn(display);
			for (const warnValue of LIMITS) {
				for (const critValue of [undefined, "95", 95]) {
					for (const alertHysteresis of BANDS) {
						for (const alertDisplayUnit of STAMPS) {
							for (const alertBelow of [undefined, true]) {
								const settings = { warnValue, critValue, alertHysteresis, alertDisplayUnit, alertBelow, fahrenheit };
								const seed = model.alertRuleSeed(settings, { displayUnit: display, legacyApplies: true });
								const legacy = ruleFor(parseAlertConfig(settings), "dial", reading, 0);
								const own = ruleFor(parseAlertConfig({ ...settings, alertRules: { [reading.key]: seed } }), "dial", reading, 0);
								const label = JSON.stringify({ display, settings, seed });
								if (legacy === null) {
									assert.equal(own, null, label);
									continue;
								}
								assert.ok(own !== null, label);
								assert.deepEqual([own.warn, own.crit, own.below, own.hyst], [legacy.warn, legacy.crit, legacy.below, legacy.hyst], label);
								assert.equal(ruleValue(own, reading, fahrenheit), ruleValue(legacy, reading, fahrenheit), label);
								compared++;
							}
						}
					}
				}
			}
		}
		assert.ok(compared > 500, `compared ${compared}`);
	});

	it("copies a limit stored as a number as its text, and nothing when the dial's limits do not cover the reading", () => {
		assert.deepEqual(model.alertRuleSeed({ warnValue: 80, critValue: "90", alertHysteresis: 2 }, { displayUnit: "°C", legacyApplies: true }), { warn: "80", crit: "90", hyst: "2", unit: "°C" });
		assert.deepEqual(model.alertRuleSeed({ warnValue: "80", alertBelow: true }, { displayUnit: "RPM", legacyApplies: false }), { unit: "RPM" });
	});
});

describe("Separate limits: a field that is not a number", () => {
	it("is named in the note line exactly when the runtime cannot read it", () => {
		for (const text of ["", " ", "80", "85,5", "1e3", "-2", "8o", "abc", "1,2,3", "Infinity", "0x10", " 7 "]) {
			const notes = model.alertOwnFieldNotes({ warn: text, crit: "", hyst: "" });
			assert.equal(notes.length === 1, text.trim() !== "" && parseThreshold(text) === undefined, JSON.stringify(text));
		}
		assert.deepEqual(model.alertOwnFieldNotes({ warn: "8o", crit: "x", hyst: "y" }), ["Its warn at is not a number, so it is ignored", "Its critical at is not a number, so it is ignored", "Its clear by is not a number, so it counts as 0"]);
		assert.deepEqual(model.alertOwnFieldNotes(null), []);
	});

	it("shares the one line with the plugin's notes, which never repeat a field's check", () => {
		const flags = [{ code: "warn-not-number", message: "Warn value is not a number" }, { code: "unit-mismatch", message: "These limits were set for °C. This reading now reports W, so they are off until you edit them" }];
		assert.equal(model.alertNotes({ warn: "8o", crit: "", hyst: "" }, flags, "reading"), "Its warn at is not a number, so it is ignored. These limits were set for °C. This reading now reports W, so they are off until you edit them.");
		assert.equal(model.alertNotes(null, flags, "legacy"), "These limits were set for °C. This reading now reports W, so they are off until you edit them.", "no limits of its own: only the plugin's notes");
		assert.equal(model.alertNotes({ warn: "80", crit: "", hyst: "" }, [], "reading"), "");
		assert.equal(model.alertNotes(null, "junk", null), "");
	});
});

describe("the dial panel's note line", () => {
	const html = readFileSync(fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/sensor-dial.html", import.meta.url)), "utf8");
	const tagOf = (id: string): string => new RegExp(String.raw`<[a-z]+\b[^>]*\bid="${id}"[^>]*>`).exec(html)?.[0] ?? "";

	it("is no live region: it changes as the auto cycle moves, with no action of the user's", () => {
		const note = tagOf("alert-notes");
		assert.ok(note !== "", "the note line is in the dial panel");
		assert.doesNotMatch(note, /\brole=|\baria-live=/);
	});

	it("is linked from every field it describes, and those fields have no error line that could move the panel", () => {
		for (const id of ["alert-own", "alert-own-warn", "alert-own-crit", "alert-own-hyst"]) {
			assert.match(tagOf(id), /\baria-describedby="[^"]*\balert-notes\b[^"]*"/, id);
			assert.equal(tagOf(`${id}-error`), "", `${id} keeps no error line of its own`);
		}
	});
});
