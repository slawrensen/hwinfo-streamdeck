/**
 * Unit conversion and alert threshold evaluation: the two functions that
 * decide what number a key shows and what color it wears. Neither had a
 * single test before 1.4.1; both can put a wrong number or a wrong color on
 * a hardware monitor, which is the one thing this product must never do.
 * Also the decimals salvage at the measureOptionsFrom seam: hand-edited
 * settings must degrade to "auto", never throw mid-render.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alertLevel, convertUnit, fitTextLadder, type DecimalsSetting } from "../src/ui/format";
import { formatMeasurement } from "../src/ui/measure";
import { measureOptionsFrom } from "../src/ui/theme-store";

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

describe("measureOptionsFrom salvages hand-edited decimals", () => {
	// Settings are untyped JSON at runtime: the PI only ever writes
	// "auto"/"0"/"1"/"2"/"3", but a hand-edited decimals outside toFixed's
	// [0,100] range would throw RangeError from the render path (keys,
	// dials, detail faces and the PI preview all format through this seam).
	const auto = formatMeasurement(48.7, "°C", { decimals: "auto", fahrenheit: false, dataUnits: "decimal" });

	it("junk values render as auto instead of throwing", () => {
		for (const junk of ["101", "-1", "1e3", 500, null] as unknown as DecimalsSetting[]) {
			assert.deepEqual(formatMeasurement(48.7, "°C", measureOptionsFrom({ decimals: junk })), auto);
		}
	});

	it("a legal fixed setting keeps its exact rendering", () => {
		assert.deepEqual(formatMeasurement(48.7, "°C", measureOptionsFrom({ decimals: "2" })), { valueText: "48.70", unitText: "°C" });
	});
});

describe("fitTextLadder stays bounded on pathological labels", () => {
	it("a multi-kilobyte label ellipsizes through the pre-cut, identical to the cut input and in bounded time", () => {
		// Nothing caps label length before the renderer (panel paste,
		// hand-edited profile JSON, or a registry label up to ~32k units),
		// and the ellipsis fallback walks prefixes from the far end: without
		// the pre-cut that walk is quadratic (16.8 s measured at 40k chars,
		// synchronous inside the tick). The budget here is ~1000x the fixed
		// walk's cost; a reintroduced quadratic overshoots it by ~10x.
		const huge = "GPU Memory Junction Temperature ".repeat(1250).trimEnd() + "X";
		const started = performance.now();
		const fitted = fitTextLadder(huge, 120, [20, 18, 16]);
		const elapsed = performance.now() - started;
		assert.deepEqual(fitted, fitTextLadder(huge.slice(0, 200), 120, [20, 18, 16]));
		assert.equal(fitted.fontSize, 16);
		assert.ok(fitted.text.endsWith("…"));
		assert.ok(elapsed < 2000, `pathological label took ${elapsed.toFixed(0)} ms; the pre-cut keeps it in single-digit milliseconds`);
	});
});
