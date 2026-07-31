/**
 * Unit conversion and alert threshold evaluation: the two functions that
 * decide what number a key shows and what color it wears. Neither had a
 * single test before 1.4.1; both can put a wrong number or a wrong color on
 * a hardware monitor, which is the one thing this product must never do.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alertLevel, convertUnit } from "../src/ui/format";

describe("convertUnit", () => {
	it("converts °C to °F when Fahrenheit is on", () => {
		assert.deepEqual(convertUnit(80, "°C", true), { value: 176, unit: "°F" });
		assert.deepEqual(convertUnit(0, "°C", true), { value: 32, unit: "°F" });
		assert.deepEqual(convertUnit(-40, "°C", true), { value: -40, unit: "°F" });
	});

	it("leaves °C alone when Fahrenheit is off", () => {
		assert.deepEqual(convertUnit(80, "°C", false), { value: 80, unit: "°C" });
	});

	it("never converts a value HWiNFO already publishes in °F", () => {
		// The runtime-flip case: HWiNFO switched to Fahrenheit, the snapshot
		// unit says °F, and converting again would show 176 °F as 348.8 °F.
		assert.deepEqual(convertUnit(176, "°F", true), { value: 176, unit: "°F" });
	});

	it("touches no non-temperature unit, Fahrenheit on or off", () => {
		for (const unit of ["RPM", "%", "W", "V", "MHz", "MB", ""]) {
			assert.deepEqual(convertUnit(1200, unit, true), { value: 1200, unit });
			assert.deepEqual(convertUnit(1200, unit, false), { value: 1200, unit });
		}
	});
});

describe("alertLevel, higher is worse (default)", () => {
	it("stays normal below both thresholds", () => {
		assert.equal(alertLevel(69.9, 70, 90, false), "normal");
	});

	it("fires warn exactly at the warn threshold", () => {
		assert.equal(alertLevel(70, 70, 90, false), "warn");
	});

	it("fires crit exactly at the crit threshold, outranking warn", () => {
		assert.equal(alertLevel(90, 70, 90, false), "crit");
		assert.equal(alertLevel(150, 70, 90, false), "crit");
	});

	it("evaluates each threshold independently when the other is unset", () => {
		assert.equal(alertLevel(80, 70, undefined, false), "warn");
		assert.equal(alertLevel(80, undefined, 75, false), "crit");
		assert.equal(alertLevel(80, undefined, undefined, false), "normal");
	});
});

describe("alertLevel, lower is worse (alertBelow)", () => {
	it("fires when the value drops to or under the limit", () => {
		assert.equal(alertLevel(500, 600, 300, true), "warn");
		assert.equal(alertLevel(300, 600, 300, true), "crit");
		assert.equal(alertLevel(601, 600, 300, true), "normal");
	});

	it("fires warn exactly at the warn threshold", () => {
		assert.equal(alertLevel(600, 600, 300, true), "warn");
	});
});

describe("alertLevel, degenerate inputs stay safe", () => {
	it("a non-finite current value never alerts", () => {
		assert.equal(alertLevel(Number.NaN, 70, 90, false), "normal");
		assert.equal(alertLevel(Number.NaN, 600, 300, true), "normal");
	});

	it("crit wins when the user sets crit below warn", () => {
		// Misconfigured but representable: crit 60, warn 70, value 65.
		assert.equal(alertLevel(65, 70, 60, false), "crit");
	});
});
