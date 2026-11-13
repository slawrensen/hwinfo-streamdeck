/**
 * Threshold bands for graphs: one reading's warn and critical spans in the
 * graph's unit, labelled with that reading, and nothing on a unit mismatch.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alertBands, limitText } from "../src/alerts/bands";
import { parseAlertConfig, type AlertReading, type AlertSettings } from "../src/alerts/rules";
import { computeGauge } from "../src/ui/gauge";

const cpu: AlertReading = { key: "1:0:a", unit: "°C", value: 60 };
const INF = Number.POSITIVE_INFINITY;

function bands(settings: AlertSettings, r: AlertReading, graphUnit: string, options: { kind?: "key" | "dial"; slot?: number; fahrenheit?: boolean; name?: string } = {}): Array<[string, number, number, string, string]> {
	return alertBands(parseAlertConfig(settings), options.kind ?? "dial", r, options.slot ?? 0, options.fahrenheit ?? false, graphUnit, options.name === undefined ? {} : { name: options.name }).map((band) => [band.level, band.from, band.to, band.label, band.source]);
}

describe("alertBands", () => {
	it("draws a high alarm: warn up to critical, critical to the open edge", () => {
		assert.deepEqual(bands({ alertRules: { "1:0:a": { warn: "80", crit: "95", unit: "°C" } } }, cpu, "°C"), [
			["warn", 80, 95, "Warn 80 °C", "reading"],
			["crit", 95, INF, "Critical 95 °C", "reading"]
		]);
	});

	it("draws a low alarm the other way", () => {
		const fan: AlertReading = { key: "f", unit: "RPM", value: 900 };
		assert.deepEqual(bands({ warnValue: "600", critValue: "300", alertBelow: true }, fan, "RPM"), [
			["warn", 300, 600, "Warn 600 RPM", "legacy"],
			["crit", -INF, 300, "Critical 300 RPM", "legacy"]
		]);
	});

	it("draws one open band when only one limit is set", () => {
		assert.deepEqual(bands({ warnValue: "80" }, cpu, "°C"), [["warn", 80, INF, "Warn 80 °C", "legacy"]]);
		assert.deepEqual(bands({ critValue: "300", alertBelow: true }, { key: "f", unit: "RPM", value: 1 }, "RPM"), [["crit", -INF, 300, "Critical 300 RPM", "legacy"]]);
	});

	it("draws no warn band for a pair that goes straight to critical", () => {
		assert.deepEqual(bands({ warnValue: "90", critValue: "80" }, cpu, "°C"), [["crit", 80, INF, "Critical 80 °C", "legacy"]]);
		assert.deepEqual(bands({ warnValue: "80", critValue: "80" }, cpu, "°C"), [["crit", 80, INF, "Critical 80 °C", "legacy"]]);
	});

	it("matches the gauge zones' rule on which band exists", () => {
		const cases: AlertSettings[] = [
			{ warnValue: "80", critValue: "95" },
			{ warnValue: "95", critValue: "80" },
			{ warnValue: "80" },
			{ critValue: "80" },
			{ warnValue: "600", critValue: "300", alertBelow: true },
			{ warnValue: "300", critValue: "600", alertBelow: true }
		];
		for (const settings of cases) {
			const zones = computeGauge({ value: 50, manualMin: 0, manualMax: 1000, warn: Number(settings.warnValue ?? NaN), crit: Number(settings.critValue ?? NaN), alertBelow: settings.alertBelow === true }).zones.map((zone) => zone.level);
			assert.deepEqual(
				bands(settings, { key: "k", unit: "", value: 1 }, "").map((band) => band[0]),
				zones,
				JSON.stringify(settings)
			);
		}
	});

	it("converts into the graph's unit across °C and °F", () => {
		const settings = { alertRules: { "1:0:a": { warn: "80", crit: "95", unit: "°C" } } };
		assert.deepEqual(bands(settings, cpu, "°F", { fahrenheit: true }), [
			["warn", 176, 203, "Warn 176 °F", "reading"],
			["crit", 203, INF, "Critical 203 °F", "reading"]
		]);
		// The legacy pair with a stamped display unit.
		assert.deepEqual(bands({ warnValue: "176", alertDisplayUnit: "°F", alertDisplayUnitFor: { warn: "176" } }, cpu, "°C"), [["warn", 80, INF, "Warn 80 °C", "legacy"]]);
		// A temperature difference converts by 1.8 with no offset.
		const gap: AlertReading = { key: "calc:g", unit: "Δ°C", value: 8 };
		assert.deepEqual(bands({ alertRules: { "calc:g": { warn: "10", unit: "Δ°C" } } }, gap, "Δ°F", { fahrenheit: true }), [["warn", 18, INF, "Warn 18 Δ°F", "reading"]]);
		// The unstamped legacy pair keeps 1.7.1's displayed-unit meaning.
		assert.deepEqual(bands({ warnValue: "176" }, cpu, "°F", { fahrenheit: true }), [["warn", 176, INF, "Warn 176 °F", "legacy"]]);
	});

	it("draws nothing on a unit mismatch", () => {
		const settings = { alertRules: { "1:0:a": { warn: "80", unit: "°C" } } };
		assert.deepEqual(bands(settings, cpu, "RPM"), []);
		assert.deepEqual(bands(settings, { ...cpu, unit: "RPM" }, "RPM"), [], "the rule stands down for a reading that changed unit");
		assert.deepEqual(bands({ alertRules: { "1:0:a": { warn: "80" } } }, cpu, "°C"), [], "a unit never captured");
		assert.deepEqual(bands({ warnValue: "80" }, cpu, "%"), []);
	});

	it("draws the legacy pair only where it applies", () => {
		assert.deepEqual(bands({ warnValue: "80" }, cpu, "°C", { kind: "key", slot: 1 }), []);
		assert.equal(bands({ warnValue: "80" }, cpu, "°C", { kind: "key", slot: 0 }).length, 1);
		assert.deepEqual(bands({ warnValue: "80", alertUnit: "RPM" }, cpu, "°C"), []);
		assert.equal(bands({ warnValue: "80", alertUnit: "°C" }, cpu, "°C").length, 1);
	});

	it("names the reading first when several readings share a graph", () => {
		assert.deepEqual(bands({ warnValue: "80", critValue: "95" }, cpu, "°C", { name: " CPU " }), [
			["warn", 80, 95, "CPU warn 80 °C", "legacy"],
			["crit", 95, INF, "CPU critical 95 °C", "legacy"]
		]);
		assert.deepEqual(bands({ warnValue: "80" }, cpu, "°C", { name: "  " }), [["warn", 80, INF, "Warn 80 °C", "legacy"]]);
	});

	it("carries the saved key the rule belongs to, and omits a blank unit", () => {
		const alias: AlertReading = { key: "g2:abc", unit: "%", value: 1, linkedKeys: ["1:0:a", "g2:abc"] };
		const out = alertBands(parseAlertConfig({ alertRules: { "1:0:a": { warn: "90", unit: "%" } } }), "dial", alias, 0, false, "%");
		assert.equal(out[0]?.readingKey, "g2:abc");
		assert.equal(bands({ warnValue: "1" }, { key: "k", unit: "", value: 0 }, "")[0]?.[3], "Warn 1");
	});

	it("skips a limit that overflows in conversion", () => {
		assert.deepEqual(bands({ alertRules: { "1:0:a": { warn: "1e308", unit: "°C" } } }, cpu, "°F", { fahrenheit: true }), []);
	});

	it("prints limits with up to three decimals", () => {
		assert.equal(limitText(1.35), "1.35");
		assert.equal(limitText(1.23456), "1.235");
		assert.equal(limitText(-0.0001), "0");
		assert.equal(limitText(162.5), "162.5");
	});
});
