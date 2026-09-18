import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gadgetUnitOf, gadgetValueAgrees } from "../src/hwinfo/gadget-value";

describe("Gadget formatted/raw numeric consistency", () => {
	it("rejects a paused native-unit rewrite with contradictory numbers", () => {
		assert.equal(gadgetValueAgrees("176 °F", 80), false);
		assert.equal(gadgetValueAgrees("176 °F", 176), true);
	});
	it("accepts locale grouping and decimal forms without choosing a locale", () => {
		for (const formatted of ["2,295.0 MHz", "2.295,0 MHz", "2 295,0 MHz", "2\u00a0295.0 MHz", "2\u202f295,0 MHz", "2'295.0 MHz", "2’295,0 MHz"]) {
			assert.equal(gadgetValueAgrees(formatted, 2295.04), true, formatted);
			assert.equal(gadgetValueAgrees(formatted, 2296), false, formatted);
			assert.equal(gadgetUnitOf(formatted), "MHz");
		}
		assert.equal(gadgetValueAgrees("12,34,567 W", 1234567), true);
		assert.equal(gadgetValueAgrees("1,200 RPM", 1200), true);
		assert.equal(gadgetValueAgrees("1,200 V", 1.2), true, "ambiguous punctuation has two permissible interpretations");
	});
	it("checks the shown precision and retains raw authority at rounding boundaries", () => {
		for (const [formatted, value] of [["1.2 V", 1.249], ["1,2 V", 1.25], ["-1.2 A", -1.249], ["−1,2 A", -1.25], ["+1.2 V", 1.2], [".5 V", 0.51], ["1.23e4 Hz", 12345], ["1,23E-3 V", 0.001234]]) {
			assert.equal(gadgetValueAgrees(formatted as string, value as number), true, String(formatted));
		}
		assert.equal(gadgetValueAgrees("1.2 V", 1.251), false);
		assert.equal(gadgetValueAgrees("-1.2 A", -1.251), false);
		assert.equal(gadgetValueAgrees("1.23e4 Hz", 12400), false);
	});
	it("keeps boolean/nonnumeric and unavailable raw readings explicit", () => {
		for (const text of ["Yes", "No", "On", "Off", "Unavailable", ""]) assert.equal(gadgetValueAgrees(text, 1), true);
		assert.equal(gadgetValueAgrees("40 °C", Number.NaN), true, "a nonfinite raw value remains unavailable, never repaired from display text");
	});
	it("rejects malformed numeric grouping rather than accepting a numeric prefix", () => {
		for (const text of ["1.2.3 °C", "1,23,45 W", "12 34 V"]) assert.equal(gadgetValueAgrees(text, 1), false, text);
	});
});
