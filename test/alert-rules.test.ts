/**
 * Alert rules: salvage of the new fields, precedence between per-reading
 * rules and the legacy pair, the captured unit and its stand-down, °C/°F,
 * validation notes, and parity with the 1.7.1 comparisons where the new
 * fields are absent.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FRESH_TRACK, shown, stepAlert } from "../src/alerts/engine";
import {
	ALERT_RULES_CAP,
	DEFAULT_COMMAND_SNOOZE_MS,
	alertFlags,
	alertObservation,
	legacyScopeApplies,
	parseAlertConfig,
	parseAlertDwellMs,
	parseAlertRules,
	parseAlertSnoozeMs,
	parseHysteresis,
	ruleFor,
	ruleSignature,
	ruleValue,
	stampedDisplayUnit,
	stampForLimitsCopy,
	type AlertReading,
	type AlertSettings,
	type ResolvedRule
} from "../src/alerts/rules";
import { alertLevel, convertUnit, parseThreshold, thresholdsApplyTo } from "../src/ui/format";

function reading(key: string, unit: string, value: number, extra: Partial<Pick<AlertReading, "linkedKeys">> = {}): AlertReading {
	return { key, unit, value, ...extra };
}

describe("parseAlertRules salvage", () => {
	it("accepts only a plain object", () => {
		for (const raw of [undefined, null, [], [{ warn: "80" }], "x", 5, true]) {
			assert.equal(parseAlertRules(raw).size, 0, JSON.stringify(raw));
		}
	});

	it("drops entries that are not objects and keeps the rest", () => {
		const rules = parseAlertRules({ a: "80", b: 5, c: null, d: [], e: { warn: "80", unit: "°C" } });
		assert.deepEqual([...rules.keys()], ["e"]);
	});

	it("reads own keys only, so __proto__ is an ordinary reading key", () => {
		const raw: unknown = JSON.parse('{"__proto__": {"warn": "70", "unit": "°C"}, "constructor": {"crit": "90", "unit": "°C"}}');
		const rules = parseAlertRules(raw);
		assert.deepEqual([...rules.keys()].sort(), ["__proto__", "constructor"]);
		assert.equal(rules.get("__proto__")?.warn, 70);
		assert.equal(({} as Record<string, unknown>).warn, undefined, "no prototype was touched");
		// Inherited keys and inherited entry fields count for nothing.
		const inherited = Object.create({ inheritedKey: { warn: "80", unit: "°C" } }) as Record<string, unknown>;
		inherited.own = Object.create({ warn: "80", unit: "°C" }) as unknown;
		const parsed = parseAlertRules(inherited);
		assert.deepEqual([...parsed.keys()], ["own"]);
		assert.equal(parsed.get("own")?.warn, undefined);
		assert.equal(parsed.get("own")?.unit, undefined);
	});

	it("keeps at most 128 entries, counting only usable ones", () => {
		const raw: Record<string, unknown> = {};
		for (let i = 0; i < 50; i++) raw[`junk${i}`] = "x";
		for (let i = 0; i < 200; i++) raw[`k${i}`] = { warn: String(i), unit: "W" };
		const rules = parseAlertRules(raw);
		assert.equal(rules.size, ALERT_RULES_CAP);
		assert.equal(rules.has("k0"), true);
		assert.equal(rules.has("k127"), true);
		assert.equal(rules.has("k128"), false);
	});

	it("salvages each field", () => {
		const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
			[{ warn: "70,5", crit: 90, below: true, unit: "°C", hyst: "2,5" }, { warn: 70.5, crit: 90, below: true, unit: "°C", hyst: 2.5, junk: [], negativeHyst: false }],
			[{ warn: " 80 ", crit: "", below: "true", unit: "" }, { warn: 80, below: false, unit: "", hyst: 0, junk: [], negativeHyst: false }],
			[{ warn: "abc", crit: "9O", unit: 5, hyst: "x" }, { below: false, hyst: 0, junk: ["warn", "crit", "hyst"], negativeHyst: false }],
			[{ warn: null, crit: true, below: 1, hyst: -2 }, { below: false, hyst: 0, junk: ["crit"], negativeHyst: true }],
			[{ hyst: "-0,5" }, { below: false, hyst: 0, junk: [], negativeHyst: true }],
			[{}, { below: false, hyst: 0, junk: [], negativeHyst: false }]
		];
		for (const [entry, expected] of cases) {
			assert.deepEqual(parseAlertRules({ k: entry }).get("k"), expected, JSON.stringify(entry));
		}
	});

	it("is never written back: the raw object is untouched", () => {
		const raw = { k: { warn: "abc", unit: 5, extra: "kept" } };
		const before = JSON.stringify(raw);
		parseAlertConfig({ alertRules: raw, alertDwellMs: "nonsense" });
		assert.equal(JSON.stringify(raw), before);
	});
});

describe("timing fields", () => {
	it("dwell takes exact choices only, else 0", () => {
		const cases: Array<[unknown, number]> = [
			["0", 0],
			["2000", 2000],
			["5000", 5000],
			["10000", 10000],
			["30000", 30000],
			[undefined, 0],
			[2000, 0],
			["2000 ", 0],
			["1000", 0],
			["-5000", 0],
			["2e3", 0],
			[null, 0]
		];
		for (const [raw, expected] of cases) assert.equal(parseAlertDwellMs(raw), expected, JSON.stringify(raw));
	});

	it("snooze takes exact choices only, else off", () => {
		const cases: Array<[unknown, number | null]> = [
			["300000", 300000],
			["900000", 900000],
			["3600000", 3600000],
			["", null],
			[undefined, null],
			[900000, null],
			["60000", null],
			["900000.0", null]
		];
		for (const [raw, expected] of cases) assert.equal(parseAlertSnoozeMs(raw), expected, JSON.stringify(raw));
		assert.equal(DEFAULT_COMMAND_SNOOZE_MS, 900000);
	});

	it("the legacy recovery band is a number >= 0, else 0", () => {
		const cases: Array<[unknown, number]> = [
			["3", 3],
			["2,5", 2.5],
			[4, 4],
			["-1", 0],
			["x", 0],
			["", 0],
			[undefined, 0],
			[Number.NaN, 0]
		];
		for (const [raw, expected] of cases) assert.equal(parseHysteresis(raw), expected, JSON.stringify(raw));
	});

	it("an action with none of the new fields has 1.7.1 timing", () => {
		const config = parseAlertConfig({ warnValue: "80", critValue: "90" });
		assert.equal(config.dwellMs, 0);
		assert.equal(config.snoozeMs, null);
		assert.equal(config.legacy.hyst, 0);
		assert.equal(config.legacy.displayUnit, undefined);
		assert.equal(config.rules.size, 0);
	});
});

describe("the display-unit stamp counts only for the numbers it was saved with", () => {
	const stamp = { warnValue: "80", critValue: "90", alertHysteresis: "2", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", crit: "90", hyst: "2" } };

	it("a record of exactly the stored text proves the stamp", () => {
		assert.equal(stampedDisplayUnit(stamp), "°C");
		assert.equal(parseAlertConfig(stamp).legacy.displayUnit, "°C");
		assert.equal(stampedDisplayUnit({ warnValue: "80", alertDisplayUnit: "°F", alertDisplayUnitFor: { warn: "80" } }), "°F", "absent fields are absent in the record");
	});

	it("text retyped by a version that keeps the stamp without knowing it ends the stamp", () => {
		for (const changed of [{ warnValue: "176" }, { critValue: "194" }, { alertHysteresis: "3.6" }, { alertHysteresis: undefined }, { warnValue: "80 " }]) {
			const settings = { ...stamp, ...changed };
			assert.equal(stampedDisplayUnit(settings), undefined, JSON.stringify(changed));
			assert.equal(parseAlertConfig(settings).legacy.displayUnit, undefined, JSON.stringify(changed));
		}
	});

	it("a stamp with no record, or a record that is not text, proves nothing", () => {
		for (const proof of [undefined, null, [], "80", { warn: 80, crit: "90", hyst: "2" }]) {
			assert.equal(stampedDisplayUnit({ ...stamp, alertDisplayUnitFor: proof }), undefined, JSON.stringify(proof));
		}
		assert.equal(stampedDisplayUnit({ ...stamp, alertDisplayUnit: 1 }), undefined);
	});

	it("a downgrade edit compares as displayed after a re-upgrade, as 1.7.1 did", () => {
		const cpu = reading("1:0:a", "°C", 85);
		const retyped = { ...stamp, warnValue: "176", critValue: "194", alertHysteresis: undefined };
		const rule = ruleFor(parseAlertConfig(retyped), "key", cpu, 0);
		assert.ok(rule !== null);
		assert.equal(ruleValue(rule, cpu, true), 185, "185 °F against 176, not 85 against 176");
	});

	it("a copy that carries only Warn at and Critical at keeps a stamp that counts, re-recorded for those two", () => {
		const copy = stampForLimitsCopy(stamp);
		assert.deepEqual(copy, { alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", crit: "90" } });
		assert.equal(stampedDisplayUnit({ warnValue: "80", critValue: "90", ...copy }), "°C");
		assert.equal(stampForLimitsCopy({ ...stamp, warnValue: "176" }), undefined, "a stamp that does not count is not copied");
		assert.equal(stampForLimitsCopy({ warnValue: "80" }), undefined);
	});
});

describe("temperature differences (Δ°C, Δ°F) convert like temperatures, by 1.8 with no offset", () => {
	const gap = reading("calc:g", "Δ°C", 8); // 14.4 Δ°F

	it("a legacy pair stamped Δ°C is not reinterpreted when °F is ticked", () => {
		const settings = { warnValue: "10", alertDisplayUnit: "Δ°C", alertDisplayUnitFor: { warn: "10" } };
		const rule = ruleFor(parseAlertConfig(settings), "key", gap, 0);
		assert.ok(rule !== null);
		assert.equal(ruleValue(rule, gap, false), 8);
		assert.equal(ruleValue(rule, gap, true), 8, "compared in Δ°C, the unit it was typed in");
		const typedInF = ruleFor(parseAlertConfig({ warnValue: "18", alertDisplayUnit: "Δ°F", alertDisplayUnitFor: { warn: "18" } }), "key", gap, 0);
		assert.ok(typedInF !== null);
		assert.ok(Math.abs((ruleValue(typedInF, gap, false) ?? 0) - 14.4) < 1e-9, "typed in Δ°F, shown in Δ°C: converted to Δ°F");
	});

	it("a rule captured in Δ°C converts on °F instead of standing down", () => {
		const config = parseAlertConfig({ alertRules: { "calc:g": { warn: "6", unit: "Δ°C" } } });
		const rule = ruleFor(config, "key", gap, 0);
		assert.ok(rule !== null);
		assert.equal(ruleValue(rule, gap, true), 8);
		assert.deepEqual(alertFlags(config, "key", gap, 0, true).filter((f) => f.code === "unit-mismatch"), []);
	});

	it("a delta and a plain temperature never convert into each other", () => {
		const rule = ruleFor(parseAlertConfig({ alertRules: { "calc:g": { warn: "6", unit: "°C" } } }), "key", gap, 0);
		assert.ok(rule !== null);
		assert.equal(ruleValue(rule, gap, false), undefined);
		assert.equal(ruleValue(rule, gap, true), undefined);
	});
});

describe("ruleFor precedence", () => {
	const cpu = reading("1:0:a", "°C", 85);

	it("a per-reading rule wins over the legacy pair, on keys and dials", () => {
		const config = parseAlertConfig({ warnValue: "50", alertRules: { "1:0:a": { warn: "80", crit: "95", unit: "°C" } } });
		for (const kind of ["key", "dial"] as const) {
			const rule = ruleFor(config, kind, cpu, 0);
			assert.equal(rule?.source, "reading");
			assert.equal(rule?.ruleKey, "1:0:a");
			assert.equal(rule?.warn, 80);
			assert.equal(rule?.crit, 95);
		}
	});

	it("the legacy pair on a key covers the first reading only", () => {
		const config = parseAlertConfig({ warnValue: "80" });
		assert.equal(ruleFor(config, "key", cpu, 0)?.source, "legacy");
		for (const slot of [1, 2, 3]) assert.equal(ruleFor(config, "key", cpu, slot), null);
		// A per-reading rule covers its reading in any slot.
		const withRule = parseAlertConfig({ warnValue: "80", alertRules: { "1:0:a": { warn: "70", unit: "°C" } } });
		assert.equal(ruleFor(withRule, "key", cpu, 2)?.warn, 70);
	});

	it("the legacy pair on a dial follows alertUnit exactly as thresholdsApplyTo", () => {
		const cases: Array<[unknown, string, boolean]> = [
			[undefined, "°C", true],
			[undefined, "RPM", true],
			["°C", "°C", true],
			["°C", "RPM", false],
			["", "", true],
			["", "%", false],
			["Yes", "Yes/No", true],
			["No", "Yes/No", true],
			["Yes", "Yes", true],
			["Yes", "%", false],
			[5, "°C", false],
			[null, "°C", false],
			[{}, "°C", false],
			[["°C"], "°C", false]
		];
		for (const [alertUnit, unit, applies] of cases) {
			const config = parseAlertConfig({ warnValue: "80", alertUnit });
			assert.equal(ruleFor(config, "dial", reading("1:0:a", unit, 85), 0) !== null, applies, `${JSON.stringify(alertUnit)} vs ${unit}`);
			// The scope is the shipped comparison, junk included.
			assert.equal(legacyScopeApplies(alertUnit, unit), thresholdsApplyTo(alertUnit as string | undefined, unit));
		}
	});

	it("walks the reading's keys, exact key first", () => {
		// An alias entry (Gadget spelling) of a Shared Memory reading.
		const alias = reading("g2:abc", "°C", 85, { linkedKeys: ["1:0:a", "g2:abc"] });
		const provider = reading("1:0:a", "°C", 85, { linkedKeys: ["1:0:a", "g2:abc"] });
		const onProvider = parseAlertConfig({ alertRules: { "1:0:a": { warn: "70", unit: "°C" } } });
		assert.equal(ruleFor(onProvider, "dial", alias, 0)?.ruleKey, "1:0:a");
		const onAlias = parseAlertConfig({ alertRules: { "g2:abc": { warn: "75", unit: "°C" } } });
		assert.equal(ruleFor(onAlias, "dial", provider, 0)?.ruleKey, "g2:abc");
		const onBoth = parseAlertConfig({ alertRules: { "1:0:a": { warn: "70", unit: "°C" }, "g2:abc": { warn: "75", unit: "°C" } } });
		assert.equal(ruleFor(onBoth, "dial", alias, 0)?.warn, 75);
		assert.equal(ruleFor(onBoth, "dial", provider, 0)?.warn, 70);
	});

	it("a rule with no usable limit means no alert, not the legacy pair", () => {
		const config = parseAlertConfig({ warnValue: "50", alertRules: { "1:0:a": { warn: "abc", unit: "°C" } } });
		assert.equal(ruleFor(config, "key", cpu, 0), null);
		assert.equal(ruleFor(parseAlertConfig({ warnValue: "", critValue: "x" }), "key", cpu, 0), null);
		assert.equal(ruleFor(parseAlertConfig({}), "dial", cpu, 0), null);
	});

	it("a rule saved before its unit was captured is resolved but uncaptured", () => {
		const config = parseAlertConfig({ alertRules: { "1:0:a": { warn: "80" } } });
		assert.deepEqual(ruleFor(config, "dial", cpu, 0)?.unit, { kind: "uncaptured" });
	});
});

describe("ruleValue: the number a rule compares", () => {
	const legacy = (displayUnit?: string): ResolvedRule => ({ source: "legacy", warn: 80, below: false, unit: displayUnit === undefined ? { kind: "legacy" } : { kind: "legacy", displayUnit }, hyst: 0 });
	const captured = (unit: string): ResolvedRule => ({ source: "reading", ruleKey: "k", warn: 80, below: false, unit: { kind: "captured", unit }, hyst: 0 });

	it("the legacy pair compares the displayed value, as 1.7.1", () => {
		assert.equal(ruleValue(legacy(), reading("k", "°C", 80), false), 80);
		// The °F box reinterprets unstamped numbers, as it always has.
		assert.equal(ruleValue(legacy(), reading("k", "°C", 80), true), 176);
		assert.equal(ruleValue(legacy(), reading("k", "RPM", 1200), true), 1200);
		assert.equal(ruleValue(legacy(), reading("k", "°F", 176), false), 176);
	});

	it("a stamped display unit converts across °C and °F instead", () => {
		assert.equal(ruleValue(legacy("°C"), reading("k", "°C", 80), true), 80);
		assert.equal(ruleValue(legacy("°F"), reading("k", "°C", 80), false), 176);
		assert.equal(ruleValue(legacy("°C"), reading("k", "°F", 176), false), 80);
		// Equal or unrelated units: the displayed value, unchanged.
		assert.equal(ruleValue(legacy("°F"), reading("k", "°C", 80), true), 176);
		assert.equal(ruleValue(legacy("°C"), reading("k", "RPM", 1200), false), 1200);
	});

	it("a captured rule compares in its own unit", () => {
		assert.equal(ruleValue(captured("°C"), reading("k", "°C", 80), false), 80);
		assert.equal(ruleValue(captured("°C"), reading("k", "°C", 80), true), 80, "the °F box does not reinterpret it");
		assert.equal(ruleValue(captured("°F"), reading("k", "°C", 80), false), 176);
		assert.equal(ruleValue(captured("°F"), reading("k", "°C", 80), true), 176);
		assert.equal(ruleValue(captured("°C"), reading("k", "°F", 176), false), 80);
		assert.equal(ruleValue(captured(""), reading("k", "", 3), false), 3);
	});

	it("a unit change other than °C/°F stands the rule down", () => {
		assert.equal(ruleValue(captured("°C"), reading("k", "RPM", 1200), false), undefined);
		assert.equal(ruleValue(captured(""), reading("k", "%", 50), false), undefined);
		assert.equal(ruleValue(captured("MB/s"), reading("k", "KB/s", 50), false), undefined);
		assert.equal(ruleValue({ ...captured("°C"), unit: { kind: "uncaptured" } }, reading("k", "°C", 80), false), undefined);
	});

	it("data-unit tiers never enter: HWiNFO's own unit and number are compared", () => {
		assert.equal(ruleValue(captured("MB/s"), reading("k", "MB/s", 48_700), false), 48_700);
		assert.equal(ruleValue(legacy(), reading("k", "MB", 48_700), true), 48_700);
	});

	it("a value at a limit reaches it after a °C/°F round trip", () => {
		// Typed as 80 in °C, shown in °F now: HWiNFO's 80 °C still alerts.
		const rule: ResolvedRule = { ...legacy("°C"), crit: 80 };
		const value = ruleValue(rule, reading("k", "°C", 80), true);
		assert.equal(alertLevel(value ?? Number.NaN, rule.warn, rule.crit, false), "crit");
		for (let c = -40; c <= 150; c += 0.1) {
			const native = Math.round(c * 10) / 10;
			assert.equal(ruleValue(captured("°C"), reading("k", "°C", native), true), native);
		}
	});
});

describe("alertObservation", () => {
	const config = parseAlertConfig({ alertRules: { k: { warn: "80", unit: "°C" } } });
	const rule = ruleFor(config, "dial", reading("k", "°C", 85), 0);

	it("is valid only with current data, a reading, a rule, a comparable unit and a finite value", () => {
		assert.deepEqual(alertObservation(rule, reading("k", "°C", 85), false, true), { valid: true, value: 85 });
		assert.deepEqual(alertObservation(rule, reading("k", "°C", 85), false, false), { valid: false });
		assert.deepEqual(alertObservation(rule, undefined, false, true), { valid: false });
		assert.deepEqual(alertObservation(null, reading("k", "°C", 85), false, true), { valid: false });
		assert.deepEqual(alertObservation(rule, reading("k", "RPM", 85), false, true), { valid: false });
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			assert.deepEqual(alertObservation(rule, reading("k", "°C", value), false, true), { valid: false });
		}
	});
});

describe("ruleSignature", () => {
	it("changes with anything that changes the comparison", () => {
		const base = ruleFor(parseAlertConfig({ alertRules: { k: { warn: "80", crit: "90", unit: "°C", hyst: "2" } } }), "dial", reading("k", "°C", 1), 0)!;
		const variants: Array<Record<string, unknown>> = [{ warn: "81", crit: "90", unit: "°C", hyst: "2" }, { warn: "80", crit: "91", unit: "°C", hyst: "2" }, { warn: "80", crit: "90", unit: "°F", hyst: "2" }, { warn: "80", crit: "90", unit: "°C", hyst: "3" }, { warn: "80", crit: "90", unit: "°C", hyst: "2", below: true }];
		for (const entry of variants) {
			const other = ruleFor(parseAlertConfig({ alertRules: { k: entry } }), "dial", reading("k", "°C", 1), 0)!;
			assert.notEqual(ruleSignature(other), ruleSignature(base), JSON.stringify(entry));
		}
		// The same numbers typed differently compare the same way.
		const same = ruleFor(parseAlertConfig({ alertRules: { k: { warn: "80,0", crit: 90, unit: "°C", hyst: "2" } } }), "dial", reading("k", "°C", 1), 0)!;
		assert.equal(ruleSignature(same), ruleSignature(base));
		// The legacy pair and a reading rule with equal numbers differ.
		const legacy = ruleFor(parseAlertConfig({ warnValue: "80", critValue: "90", alertHysteresis: "2" }), "dial", reading("k", "°C", 1), 0)!;
		assert.notEqual(ruleSignature(legacy), ruleSignature(base));
	});
});

describe("validation notes", () => {
	const codes = (settings: AlertSettings, r: AlertReading | undefined, kind: "key" | "dial" = "dial", slot = 0, fahrenheit = false): string[] => alertFlags(parseAlertConfig(settings), kind, r, slot, fahrenheit).map((flag) => flag.code);
	const cpu = reading("k", "°C", 50);

	it("flags fields that are not numbers", () => {
		assert.deepEqual(codes({ warnValue: "abc", critValue: "9O", alertHysteresis: "x" }, undefined), ["warn-not-number", "crit-not-number", "hyst-not-number"]);
		assert.deepEqual(codes({ warnValue: "", critValue: " " }, undefined), []);
		assert.deepEqual(codes({ alertRules: { k: { warn: "abc", crit: "90", unit: "°C" } } }, cpu), ["warn-not-number"]);
		assert.deepEqual(codes({ alertRules: { k: { warn: "80", unit: "°C", hyst: "-1" } } }, cpu), ["hyst-negative"]);
	});

	it("flags a contradictory pair without changing the comparison", () => {
		assert.deepEqual(codes({ warnValue: "80", critValue: "80" }, cpu), ["warning-never-shows"]);
		assert.deepEqual(codes({ warnValue: "80", critValue: "70" }, cpu), ["straight-to-critical"]);
		assert.deepEqual(codes({ warnValue: "1000", critValue: "1500", alertBelow: true }, cpu), ["straight-to-critical"]);
		assert.deepEqual(codes({ warnValue: "1000", critValue: "500", alertBelow: true }, cpu), []);
		assert.deepEqual(codes({ warnValue: "80", critValue: "90" }, cpu), []);
	});

	it("flags a recovery band as wide as the gap", () => {
		assert.deepEqual(codes({ warnValue: "80", critValue: "90", alertHysteresis: "10" }, cpu), ["band-wider-than-gap"]);
		assert.deepEqual(codes({ warnValue: "80", critValue: "90", alertHysteresis: "9.5" }, cpu), []);
		assert.deepEqual(codes({ alertRules: { k: { warn: "80", crit: "90", unit: "°C", hyst: "12" } } }, cpu), ["band-wider-than-gap"]);
	});

	it("flags a captured unit the reading no longer reports, and one never captured", () => {
		const mismatch = alertFlags(parseAlertConfig({ alertRules: { k: { warn: "80", unit: "°C" } } }), "dial", reading("k", "RPM", 1200), 0, false);
		assert.deepEqual(
			mismatch.map((flag) => flag.code),
			["unit-mismatch"]
		);
		assert.match(mismatch[0]!.message, /set for °C\. This reading now reports RPM/);
		assert.deepEqual(codes({ alertRules: { k: { warn: "80", unit: "°C" } } }, cpu, "dial", 0, true), [], "°F display converts");
		assert.deepEqual(codes({ alertRules: { k: { warn: "80" } } }, cpu), ["unit-not-captured"]);
	});

	it("flags limits saved under two keys of one reading and says which set applies", () => {
		const both: AlertSettings = { alertRules: { "1:0:a": { warn: "70", unit: "°C" }, "g2:abc": { warn: "75", unit: "°C" } } };
		const alias = reading("g2:abc", "°C", 50, { linkedKeys: ["1:0:a", "g2:abc"] });
		assert.deepEqual(codes(both, alias), ["two-limits"]);
		// The reading on screen owns a set: that set applies to it, and the
		// linked reading keeps its own (the store tracks each set apart).
		assert.equal(ruleFor(parseAlertConfig(both), "dial", alias, 0)?.ruleKey, "g2:abc");
		assert.match(alertFlags(parseAlertConfig(both), "dial", alias, 0, false)[0]?.message ?? "", /This reading uses its own limits, and the linked reading uses its own wherever it shows/);
		// A third spelling with no set of its own uses the first linked set.
		const third = reading("g:old", "°C", 50, { linkedKeys: ["1:0:a", "g2:abc", "g:old"] });
		assert.equal(ruleFor(parseAlertConfig(both), "dial", third, 0)?.ruleKey, "1:0:a");
		assert.match(alertFlags(parseAlertConfig(both), "dial", third, 0, false)[0]?.message ?? "", /this reading uses the first of them. Save limits for this reading to give it its own/);
	});

	it("notes a legacy field that is not a number wherever the pair covers the reading (AC-5)", () => {
		assert.deepEqual(codes({ warnValue: "abc" }, cpu, "key", 0), ["warn-not-number"]);
		assert.deepEqual(codes({ warnValue: "abc" }, cpu, "dial"), ["warn-not-number"]);
		assert.deepEqual(codes({ warnValue: "abc", alertUnit: "°C" }, cpu, "dial"), ["warn-not-number"]);
		assert.deepEqual(codes({ alertHysteresis: "x" }, cpu, "dial"), ["hyst-not-number"]);
		// The same as with a valid partner limit, and as with no reading.
		assert.deepEqual(codes({ warnValue: "abc", critValue: "90" }, cpu, "key", 0), ["warn-not-number"]);
		assert.deepEqual(codes({ warnValue: "abc" }, undefined), ["warn-not-number"]);
		// Not covered: a key's second row, a dial reading outside the unit scope.
		assert.deepEqual(codes({ warnValue: "abc" }, cpu, "key", 1), []);
		assert.deepEqual(codes({ warnValue: "abc", alertUnit: "RPM" }, cpu, "dial"), []);
	});

	it("notes nothing for a reading the legacy pair does not cover", () => {
		assert.deepEqual(codes({ warnValue: "80", critValue: "80" }, cpu, "key", 1), []);
		assert.deepEqual(codes({ warnValue: "80", critValue: "80", alertUnit: "RPM" }, cpu, "dial"), []);
	});

	it("writes notes without em dashes", () => {
		const all = [
			...alertFlags(parseAlertConfig({ warnValue: "x", critValue: "y", alertHysteresis: "z" }), "dial", undefined, 0, false),
			...alertFlags(parseAlertConfig({ warnValue: "80", critValue: "80", alertHysteresis: "-1" }), "dial", undefined, 0, false),
			...alertFlags(parseAlertConfig({ warnValue: "80", critValue: "70", alertHysteresis: "20" }), "dial", undefined, 0, false),
			...alertFlags(parseAlertConfig({ alertRules: { k: { warn: "80", unit: "" } } }), "dial", reading("k", "%", 1), 0, false),
			...alertFlags(parseAlertConfig({ alertRules: { k: { warn: "80" } } }), "dial", reading("k", "%", 1), 0, false),
			...alertFlags(parseAlertConfig({ alertRules: { a: { warn: "1", unit: "%" }, b: { warn: "2", unit: "%" } } }), "dial", reading("a", "%", 1, { linkedKeys: ["a", "b"] }), 0, false),
			...alertFlags(parseAlertConfig({ alertRules: { a: { warn: "1", unit: "%" }, b: { warn: "2", unit: "%" } } }), "dial", reading("c", "%", 1, { linkedKeys: ["a", "b", "c"] }), 0, false)
		];
		assert.equal(new Set(all.map((flag) => flag.message)).size, all.length, "no two notes share a message");
		assert.equal(new Set(all.map((flag) => flag.code)).size, 10, "every note is exercised");
		for (const flag of all) assert.ok(!flag.message.includes(String.fromCharCode(0x2014)), flag.code);
	});
});

describe("parity with 1.7.1 where the new fields are absent", () => {
	function lcg(seed: number): () => number {
		let state = seed >>> 0;
		return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
	}

	it("keys and dials resolve the shipped level through the new path on every tick", () => {
		const random = lcg(0x171);
		const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
		const thresholdTexts: unknown[] = [undefined, "", " ", "80", "80,5", " 90 ", "-5", "abc", "1e3", 70, Number.NaN, null, true, "0"];
		const scopes: unknown[] = [undefined, "°C", "°F", "RPM", "%", "", "Yes", "No", "Yes/No", 5, null];
		const units = ["°C", "°F", "RPM", "%", "", "Yes/No", "W"];
		const values = [-5, 0, 1, 70, 79.9, 80, 80.5, 90, 1000, 1e3, Number.NaN, Number.POSITIVE_INFINITY, 176, 26.6667];
		let compared = 0;
		for (let runIndex = 0; runIndex < 600; runIndex++) {
			const settings = {
				warnValue: pick(thresholdTexts),
				critValue: pick(thresholdTexts),
				alertBelow: pick<unknown>([undefined, true, false, "true", 1]),
				alertUnit: pick(scopes)
			};
			const config = parseAlertConfig(settings);
			const fahrenheit = random() < 0.5;
			const unit = pick(units);
			for (const kind of ["key", "dial"] as const) {
				const slot = kind === "key" ? pick([0, 0, 1, 3]) : 0;
				let track = FRESH_TRACK;
				for (let tick = 0; tick < 12; tick++) {
					const r = reading("1:0:a", unit, random() < 0.6 ? pick(values) : random() * 120 - 10);
					const rule = ruleFor(config, kind, r, slot);
					track = stepAlert(track, alertObservation(rule, r, fahrenheit, true), rule ?? { below: false, hyst: 0 }, tick * 1000, config.dwellMs);
					const live = convertUnit(r.value, r.unit, fahrenheit).value;
					const warn = parseThreshold(settings.warnValue);
					const crit = parseThreshold(settings.critValue);
					const below = settings.alertBelow === true;
					// sensor-reading.ts primaryContext, and sensor-dial.ts's single view.
					const expected = kind === "key" ? (slot === 0 ? alertLevel(live, warn, crit, below) : "normal") : thresholdsApplyTo(settings.alertUnit as string | undefined, r.unit) ? alertLevel(live, warn, crit, below) : "normal";
					assert.equal(shown(track).level, expected, `${kind} slot ${slot} ${JSON.stringify(settings)} ${r.value} ${r.unit} F=${fahrenheit}`);
					compared++;
				}
			}
		}
		assert.equal(compared, 600 * 2 * 12);
	});
});
