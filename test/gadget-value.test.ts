import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GadgetRegistryProvider } from "../src/hwinfo/gadget-registry";
import { gadgetRawValue, gadgetUnitOf, gadgetValueAgrees } from "../src/hwinfo/gadget-value";

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
	it("rejects contradictory recognized boolean fields without guessing other words", () => {
		for (const [word, expected] of [["Yes", 1], ["No", 0]] as const) {
			for (const formatted of [word, ` ${word} `, `\t${word}\r\n`]) {
				assert.equal(gadgetUnitOf(formatted), "Yes/No");
				assert.equal(gadgetValueAgrees(formatted, gadgetRawValue(word)), true);
				assert.equal(gadgetValueAgrees(formatted, gadgetRawValue(String(expected))), true);
				for (const raw of [1 - expected, -1, 0.5, 2]) {
					assert.equal(gadgetValueAgrees(formatted, raw), false, `${JSON.stringify(formatted)} contradicts ${raw}`);
				}
			}
		}
		for (const text of ["On", "Off", "yes", "no", "Yes/No", "Yes please", "Unavailable", ""]) assert.equal(gadgetValueAgrees(text, 1), true);
	});
	it("keeps unavailable raw readings unavailable instead of repairing them from display words", () => {
		for (const text of ["Yes", "No", "On", "Off", "Unavailable", ""]) {
			assert.equal(gadgetValueAgrees(text, gadgetRawValue("unavailable")), true);
			assert.equal(gadgetValueAgrees(text, gadgetRawValue("1junk")), true);
		}
		assert.equal(gadgetValueAgrees("40 °C", Number.NaN), true, "a nonfinite raw value remains unavailable, never repaired from display text");
	});
	it("reads a boolean reading's raw field as HWiNFO writes it", () => {
		// HWiNFO 8.48 writes ValueRaw "Yes" or "No" for these rows, not 1 or 0.
		assert.equal(gadgetRawValue("Yes"), 1);
		assert.equal(gadgetRawValue("No"), 0);
		assert.equal(gadgetRawValue("1"), 1, "a numeric raw value is still the number");
		assert.equal(gadgetRawValue("2295,04"), 2295.04, "the locale decimal comma still parses");
		for (const raw of ["On", "yes", "Unavailable", ""]) assert.ok(Number.isNaN(gadgetRawValue(raw)), `${JSON.stringify(raw)} stays unavailable`);
	});
	it("rejects malformed numeric grouping rather than accepting a numeric prefix", () => {
		for (const text of ["1.2.3 °C", "1,23,45 W", "12 34 V"]) assert.equal(gadgetValueAgrees(text, 1), false, text);
	});
	it("rejects malformed raw fields instead of publishing their numeric prefix", () => {
		const malformed = ["40junk", "40 °C", "40,1.2", "1e", "1e+", "1e-", "1 234", "1'234", "1\u00a0234", "0x10", "0b10", "0o10", "1\u00002", "1\n2", "1,,2", "1..2"];
		const accepted = malformed.filter((raw) => Number.isFinite(gadgetRawValue(raw)));
		assert.deepEqual(accepted, [], "malformed raw text must stay unavailable even when its prefix agrees with the display");
	});
	it("retains complete decimal, locale, exponent and signed-zero raw values", () => {
		const cases: readonly (readonly [string, number])[] = [
			["0", 0], ["-0", -0], ["+0", 0], ["40", 40], ["-40.25", -40.25],
			["2295,04", 2295.04], [".5", 0.5], [",5", 0.5], ["1.", 1], ["1,", 1],
			["1.23e4", 12300], ["1,23E-3", 0.00123], [" +.5e-2 ", 0.005],
			["\t2295,04\r\n", 2295.04], ["5e-324", Number.MIN_VALUE]
		];
		for (const [raw, value] of cases) assert.ok(Object.is(gadgetRawValue(raw), value), raw);
		for (const raw of ["", " \t\r\n", "--1", "+", ".", ",", "Infinity", "1e999"]) {
			assert.equal(Number.isFinite(gadgetRawValue(raw)), false, raw);
		}
	});
	it("preserves seeded complete numbers and refuses every corrupted tail", () => {
		const seed = 0x33c0ffee;
		let state = seed;
		const next = (): number => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
		for (let i = 0; i < 2000; i++) {
			const integer = String(next() % 1000000);
			const fraction = String(next() % 1000000).padStart(6, "0");
			const sign = ["", "+", "-"][next() % 3];
			const decimal = next() % 2 ? "," : ".";
			const exponent = next() % 13 - 6;
			const token = `${sign}${integer}${decimal}${fraction}e${exponent >= 0 ? "+" : ""}${exponent}`;
			assert.ok(Object.is(gadgetRawValue(token), Number(token.replace(",", "."))), `seed=${seed} case=${i}`);
			for (const tail of ["junk", " °C", "e+", ".0", "\u0000tail", "\n2"]) {
				assert.ok(Number.isNaN(gadgetRawValue(token + tail)), `seed=${seed} case=${i} token=${JSON.stringify(token + tail)}`);
			}
		}
	});
	it("refuses long malformed numeric fields without accepting a prefix", () => {
		for (const raw of ["1".repeat(32768) + "x", "0." + "0".repeat(32768) + "e+", "1," + "0".repeat(32768) + ",2"]) {
			assert.ok(Number.isNaN(gadgetRawValue(raw)));
		}
	});
});

// The query boundary is fake; all scanning and notice logic is production
// code. No native addon, registry key or running HWiNFO is involved. The
// names end in a line break and what would read as a new ERROR line of the
// plugin log: a notice quotes outside text, so it never starts a line of
// its own (external review AX50, AX85).
describe("Gadget notices through a query-only test key", () => {
	const fakeLogLine = "\n2026-09-27T00:00:00.000Z ERROR fake\r";
	for (const [what, rows, quoted] of [
		["contradictory values", { Sensor0: `CPU${fakeLogLine}`, Label0: `Temp "one"${fakeLogLine}`, Value0: "100 °C", ValueRaw0: "40" }, `Temp "one"${fakeLogLine}`],
		["duplicate names", { Sensor0: `CPU${fakeLogLine}`, Label0: "T", Value0: "40 °C", ValueRaw0: "40", Sensor1: `CPU${fakeLogLine}`, Label1: "T", Value1: "41 °C", ValueRaw1: "41" }, `CPU${fakeLogLine}`]
	] as const) {
		it(`${what} produces one escaped notice over repeated scans`, () => {
			let closes = 0;
			const values: Readonly<Record<string, string>> = rows;
			const key = { queryString: (name: string): string | null => values[name] ?? null, close: (): void => { closes++; } };
			// Reflect.construct reaches the private constructor, which takes the
			// key; open() would load the native registry bridge instead.
			const provider = Reflect.construct(GadgetRegistryProvider, [key]) as GadgetRegistryProvider;
			try {
				// A condition is reported only once it holds on consecutive
				// complete scans (a first sighting may be a torn read), and
				// then once: four scans cover the wait and the repeats.
				const lines: string[] = [];
				for (let scan = 0; scan < 4; scan++) {
					provider.read();
					lines.push(...provider.notices());
				}
				assert.equal(lines.length, 1);
				assert.doesNotMatch(lines[0]!, /[\r\n]/);
				assert.ok(lines[0]!.includes(JSON.stringify(quoted)), lines[0]);
			} finally {
				provider.close();
			}
			assert.equal(closes, 1);
		});
	}
});
