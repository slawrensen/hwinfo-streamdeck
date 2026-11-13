/**
 * Per-reading formats (issue #59): the resolver (src/ui/reading-format.ts)
 * and the fixed-unit path in the measurement authority (src/ui/measure.ts).
 * Expected texts are computed from the conversion contract (HWiNFO's number
 * times the source label's factor over the target's, then toFixed through
 * fixed(), which rounds the binary double and drops a zero's sign), never
 * copied from the issue. Property checks use a seeded generator, so a
 * failure names a reproducible input.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { setFaceFont } from "../src/ui/face-font";
import { fixed, formatValue } from "../src/ui/format";
import { formatMeasurement, formatQuadMeasurement, formatStat, parseDataUnit, type FixedDataUnit, type MeasureOptions } from "../src/ui/measure";
import { fixedUnitsFor, formatsForKeys, measureFor, READING_FORMAT_KEY_MAX, readingFormatEntryOf, readingFormatOf } from "../src/ui/reading-format";

setFaceFont("tahoma");

const DEC: MeasureOptions = { decimals: "auto", fahrenheit: false, dataUnits: "decimal" };
const BIN: MeasureOptions = { decimals: "auto", fahrenheit: false, dataUnits: "binary" };
const FACTOR: Record<FixedDataUnit, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };
const DECIMALS = ["0", "1", "2", "3"] as const;
const PLAIN = /^-?\d+(\.\d+)?$/;

/** The options a reading with only a fixed unit (and maybe decimals) gets. */
function pinned(unit: FixedDataUnit, decimals: MeasureOptions["decimals"] = "auto", base: MeasureOptions = DEC): MeasureOptions {
	return { ...base, decimals, fixedUnit: unit, exact: true };
}

/** mulberry32: a 20-line seeded generator, no dependency. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The bytes one unit of `source` counts as when printed in `target`: a
 * 1024-based target (KiB to TiB) reads HWiNFO's KB, MB, GB and TB as
 * 1024-based too (issue #59: HWiNFO's MB are MiB); every other target reads
 * the label as written, HWiNFO's number rescaled by 1000 per step. */
function sourceBytes(source: string, target: FixedDataUnit): number {
	if (!target.includes("i")) return parseDataUnit(source)?.toBase ?? Number.NaN;
	const prefix = /^([KkMGT]?)i?B$/.exec(source)?.[1] ?? "";
	return 1024 ** ["", "K", "M", "G", "T"].indexOf(prefix.toUpperCase());
}

/** The contract, computed independently of the implementation's helpers. */
function expected(value: number, source: string, target: FixedDataUnit, decimals: number): string {
	return fixed((value * sourceBytes(source, target)) / FACTOR[target], decimals);
}

describe("the issue's examples, computed from the contract", () => {
	for (const value of [453, 3020, 12100]) {
		it(`${value} MB in fixed GB at 2 decimals`, () => {
			const opts = pinned("GB", "2");
			const want = ((value * 1e6) / 1e9).toFixed(2);
			assert.deepEqual(formatMeasurement(value, "MB", opts), { valueText: want, unitText: "GB" });
			assert.deepEqual(formatQuadMeasurement(value, "MB", opts), { valueText: want, unitText: "GB" });
			assert.equal(formatStat(value, "MB", opts), `${want}GB`);
		});
	}

	it("the three read as the issue asks once computed", () => {
		// The contract's results, checked against the reporter's table only
		// after being computed above: 0.453, 3.02 and 12.1 GB at 2 decimals.
		assert.deepEqual([453, 3020, 12100].map((v) => expected(v, "MB", "GB", 2)), ["0.45", "3.02", "12.10"]);
	});

	it("Auto with a fixed unit keeps band precision on the scaled value", () => {
		assert.equal(formatMeasurement(453, "MB", pinned("GB")).valueText, fixed(0.453, 2));
		assert.equal(formatMeasurement(12100, "MB", pinned("GB")).valueText, fixed(12.1, 1));
		assert.equal(formatMeasurement(453, "MB", pinned("MB")).valueText, fixed(453, 0));
	});
});

describe("a fixed unit never moves to another unit and never compacts", () => {
	it("does not promote at the tier edge (Auto would)", () => {
		assert.deepEqual(formatMeasurement(999.6, "MB", DEC), { valueText: "1.00", unitText: "GB" }, "the Auto control");
		assert.deepEqual(formatMeasurement(999.6, "MB", pinned("MB", "2")), { valueText: expected(999.6, "MB", "MB", 2), unitText: "MB" });
		assert.deepEqual(formatMeasurement(999.996, "MB", pinned("MB", "2")), { valueText: expected(999.996, "MB", "MB", 2), unitText: "MB" });
		assert.equal(formatMeasurement(999.996, "MB", pinned("MB", "2")).valueText, "1000.00");
		assert.deepEqual(formatMeasurement(1023.9, "KiB", pinned("KiB", "0")), { valueText: "1024", unitText: "KiB" });
	});

	it("never stacks a k/M/G/T on the unit, the quad included", () => {
		for (const fn of [formatMeasurement, formatQuadMeasurement]) {
			const m = fn(12100, "MB", pinned("B"));
			assert.equal(m.unitText, "B");
			assert.equal(m.valueText, fixed(12100e6, 0));
			assert.match(m.valueText, PLAIN);
			assert.equal(fn(12100, "MB", pinned("MB")).valueText, "12100");
		}
		assert.equal(formatStat(12100, "MB", pinned("KB", "0")), `${fixed(12100e3, 0)}KB`);
	});

	it("zero keeps the fixed unit (Auto tiers it down to B)", () => {
		assert.deepEqual(formatMeasurement(0, "MB", DEC), { valueText: "0", unitText: "B" }, "the Auto control");
		assert.deepEqual(formatMeasurement(0, "MB", pinned("GB", "2")), { valueText: "0.00", unitText: "GB" });
	});

	it("draws no negative zero and keeps a real negative's sign", () => {
		for (const value of [-0, -1e-9, -0.004 * 1000, -5e-324]) {
			assert.equal(formatMeasurement(value, "MB", pinned("GB", "2")).valueText, "0.00", String(value));
		}
		assert.equal(formatMeasurement(-0.001, "MB", pinned("GB", "2")).valueText, "0.00");
		assert.equal(formatMeasurement(-3.5, "MB", pinned("GB", "3")).valueText, expected(-3.5, "MB", "GB", 3));
		assert.equal(formatMeasurement(-120, "MB", pinned("MB", "0")).valueText, "-120");
		assert.equal(formatStat(-0.0004, "GB", pinned("GB", "2")), "0.00GB");
	});

	it("non-finite values and values past an exponent keep the placeholder and the source unit", () => {
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE]) {
			assert.deepEqual(formatMeasurement(value, "MB", pinned("GB", "2")), { valueText: formatValue(Number.NaN, "2"), unitText: "MB" }, String(value));
			assert.deepEqual(formatQuadMeasurement(value, "MB", pinned("GB", "2")), { valueText: "—", unitText: "MB" }, String(value));
		}
		assert.deepEqual(formatMeasurement(1e15, "MB", pinned("B", "0")), { valueText: "—", unitText: "MB" }, "1e21 B would print 1e+21");
		assert.deepEqual(formatMeasurement(9.99e14, "MB", pinned("B", "0")), { valueText: "999000000000000000000", unitText: "B" });
		assert.equal(formatMeasurement(1e-9, "MB", pinned("TB", "3")).valueText, "0.000");
	});

	it("ties follow toFixed on the binary double, as Auto does everywhere", () => {
		// 1005 MB is 1.00499... GB as a double: toFixed gives 1.00, not 1.01.
		for (const value of [1005, 2675, 15, 105, 3025]) {
			assert.equal(formatMeasurement(value, "MB", pinned("GB", "2")).valueText, fixed((value * 1e6) / 1e9, 2), String(value));
		}
		assert.equal(formatMeasurement(1005, "MB", pinned("GB", "2")).valueText, formatMeasurement(1005, "MB", { ...DEC, decimals: "2" }).valueText);
	});
});

describe("properties over seeded values", () => {
	const SOURCES = ["B", "KB", "kB", "MB", "GB", "TB", "KiB", "MiB", "GiB", "TiB"];
	const TARGETS = Object.keys(FACTOR) as FixedDataUnit[];
	const values = (() => {
		const next = rng(59);
		const out = [0, -0, 5e-324, 0.004999, 0.005, 999.995, 1000, 1023.995, 1024, 12100, 3020, 453];
		for (const edge of [1e3, 1e6, 1e9, 1024, 1024 ** 2, 1024 ** 3]) out.push(edge * (1 + 1e-9), edge * (1 - 1e-9));
		for (let i = 0; i < 300; i++) {
			const magnitude = 10 ** (next() * 24 - 6); // log-uniform 1e-6 .. 1e18
			out.push(next() < 0.25 ? -magnitude : magnitude);
		}
		return out;
	})();

	it("every finite value keeps the unit, prints plainly and round-trips", () => {
		let checked = 0;
		for (const source of SOURCES) {
			for (const target of TARGETS) {
				const toBase = sourceBytes(source, target);
				for (const decimals of [...DECIMALS, "auto"] as const) {
					const opts = pinned(target, decimals);
					for (const value of values) {
						const m = formatMeasurement(value, source, opts);
						const scaled = (value * toBase) / FACTOR[target];
						if (Math.abs(scaled) >= 1e21) {
							assert.deepEqual(m, { valueText: "—", unitText: source });
							continue;
						}
						assert.equal(m.unitText, target, `${value} ${source} -> ${target}`);
						assert.match(m.valueText, PLAIN, `${value} ${source} -> ${target} ${decimals}`);
						assert.ok(m.valueText !== "-0" && !/^-0(\.0+)?$/.test(m.valueText), m.valueText);
						// Half a unit in the last drawn place, plus 1e-12 relative
						// (a double holds about 15.9 significant digits).
						const drawn = (m.valueText.split(".")[1] ?? "").length;
						const error = Math.abs(Number(m.valueText) * FACTOR[target] - value * toBase);
						assert.ok(error <= 0.5 * 10 ** -drawn * FACTOR[target] * (1 + 1e-9) + Math.abs(value * toBase) * 1e-12, `${value} ${source} -> ${target} ${decimals}: ${m.valueText}`);
						assert.deepEqual(formatQuadMeasurement(value, source, opts), m, "the quad keeps the full text");
						assert.equal(formatStat(value, source, opts), `${m.valueText}${m.unitText}`);
						checked++;
					}
				}
			}
		}
		assert.ok(checked > 100_000, String(checked));
	});

	it("a fixed unit equal to Auto's tier gives Auto's text (decimal and binary)", () => {
		let same = 0;
		for (const base of [DEC, BIN]) {
			for (const decimals of [...DECIMALS, "auto"] as const) {
				for (const value of values) {
					for (const source of ["MB", "GB", "KB", "MiB"]) {
						const auto = formatMeasurement(value, source, { ...base, decimals });
						if (!(auto.unitText in FACTOR)) continue;
						// A fixed B rescales HWiNFO's KB to TB by 1000 per step whatever
						// the deck says (a stored B keeps its meaning); Binary's own B
						// tier counts them 1024-based (issue #59), so under Binary the
						// two meet only on an IEC-labelled source.
						if (base === BIN && auto.unitText === "B" && !source.includes("i")) continue;
						const fixedText = formatMeasurement(value, source, pinned(auto.unitText as FixedDataUnit, decimals, base));
						assert.deepEqual(fixedText, auto, `${value} ${source} ${decimals} ${base.dataUnits}`);
						same++;
					}
				}
			}
		}
		assert.ok(same > 1000, String(same));
	});
});

describe("which units a reading may take", () => {
	it("HWiNFO's KB/MB/GB/TB take both families (issue #59); IEC labels take the IEC family", () => {
		for (const unit of ["B", "KB", "kB", "MB", "GB", "TB"]) assert.deepEqual(fixedUnitsFor(unit), ["B", "KB", "MB", "GB", "TB", "KiB", "MiB", "GiB", "TiB"], unit);
		for (const unit of ["KiB", "MiB", "GiB", "TiB"]) assert.deepEqual(fixedUnitsFor(unit), ["B", "KiB", "MiB", "GiB", "TiB"], unit);
	});

	it("rates, bits and every other unit take none", () => {
		for (const unit of ["KB/s", "MB/s", "GB/s", "MiB/s", "Mbps", "kbit/s", "Mb", "°C", "°F", "Δ°C", "%", "RPM", "W", "V", "A", "MHz", "GT/s", "T", "x", "FPS", "ms", "Yes/No", ""]) {
			assert.deepEqual(fixedUnitsFor(unit), [], unit);
		}
	});

	it("a stored unit the reading cannot take stands down; the entry's decimals still apply", () => {
		const formats = { r: { unit: "GB", decimals: "2" } };
		for (const unit of ["°C", "%", "RPM", "W", "MHz", "Yes/No", "", "KB/s", "MB/s", "Mbps", "GT/s"]) {
			const opts = measureFor(DEC, formats, { key: "r", unit });
			assert.equal(opts.fixedUnit, undefined, unit);
			assert.equal(opts.decimals, "2", unit);
		}
		assert.equal(formatMeasurement(55.256, "°C", measureFor(DEC, formats, { key: "r", unit: "°C" })).valueText, "55.26");
		assert.equal(formatStat(55.25, "°C", measureFor(DEC, formats, { key: "r", unit: "°C" })), "55.25");
		assert.deepEqual(formatMeasurement(1, "Yes/No", measureFor(DEC, formats, { key: "r", unit: "Yes/No" })), { valueText: "Yes", unitText: "" });
	});

	it("an IEC unit on an HWiNFO MB reading applies, the true GiB (issue #59); a 1000-based unit on an IEC label stands down", () => {
		// A GiB stored on an MB reading fell back to Auto ("12.1 GB") before.
		const gib = measureFor(DEC, { r: { unit: "GiB" } }, { key: "r", unit: "MB" });
		assert.equal(gib.fixedUnit, "GiB");
		assert.deepEqual(formatMeasurement(12100, "MB", gib), { valueText: "11.8", unitText: "GiB" });
		assert.deepEqual(formatMeasurement(12100, "MB", measureFor(DEC, { r: { unit: "GiB", decimals: "2" } }, { key: "r", unit: "MB" })), { valueText: "11.82", unitText: "GiB" });
		assert.deepEqual(formatMeasurement(453, "MB", measureFor(DEC, { r: { unit: "GB", decimals: "2" } }, { key: "r", unit: "MB" })), { valueText: "0.45", unitText: "GB" });
		assert.deepEqual(formatMeasurement(453, "MB", measureFor(DEC, { r: { unit: "MiB", decimals: "2" } }, { key: "r", unit: "MB" })), { valueText: "453.00", unitText: "MiB" });
		assert.equal(measureFor(DEC, { r: { unit: "GB" } }, { key: "r", unit: "MiB" }), DEC);
		assert.equal(measureFor(DEC, { r: { unit: "GiB" } }, { key: "r", unit: "MiB" }).fixedUnit, "GiB");
		assert.equal(formatMeasurement(12100, "MiB", measureFor(DEC, { r: { unit: "GiB", decimals: "2" } }, { key: "r", unit: "MiB" })).valueText, fixed(12100 / 1024, 2));
	});

	it("a unit change under a stable key is checked on every render", () => {
		const formats = { "calc:abc": { unit: "GB", decimals: "1" } };
		assert.equal(measureFor(DEC, formats, { key: "calc:abc", unit: "MB" }).fixedUnit, "GB");
		assert.equal(measureFor(DEC, formats, { key: "calc:abc", unit: "W" }).fixedUnit, undefined);
		assert.equal(measureFor(DEC, formats, { key: "calc:abc", unit: "MB/s" }).fixedUnit, undefined);
		assert.equal(measureFor(DEC, formats, { key: "calc:abc", unit: "W" }).decimals, "1");
	});

	it("a fixed unit ignores the deck preference; Auto still follows it", () => {
		const opts = measureFor(BIN, { r: { unit: "GB", decimals: "2" } }, { key: "r", unit: "MB" });
		assert.deepEqual(formatMeasurement(12100, "MB", opts), { valueText: "12.10", unitText: "GB" });
		assert.deepEqual(formatMeasurement(12100, "MB", BIN), { valueText: "11.8", unitText: "GiB" });
	});

	it("a 1024-based unit reads HWiNFO's KB to TB as 1024-based, as Binary does (issue #59)", () => {
		// HWiNFO's MB are MiB, so the true GiB of 12,100 MB is 11.82, not 11.27.
		assert.deepEqual(formatMeasurement(12100, "MB", pinned("GiB", "2")), { valueText: "11.82", unitText: "GiB" });
		assert.deepEqual(formatMeasurement(453, "MB", pinned("GiB", "2")), { valueText: "0.44", unitText: "GiB" });
		assert.deepEqual(formatMeasurement(16303, "MB", pinned("GiB", "2")), { valueText: "15.92", unitText: "GiB" });
		assert.deepEqual(formatMeasurement(453, "MB", pinned("MiB")), { valueText: "453", unitText: "MiB" });
		assert.deepEqual(formatMeasurement(2048, "GB", pinned("TiB", "2")), { valueText: "2.00", unitText: "TiB" });
		assert.deepEqual(formatMeasurement(1, "KB", pinned("KiB", "0")), { valueText: "1", unitText: "KiB" });
		// The Binary Auto text and the fixed GiB text of one reading agree.
		assert.deepEqual(formatMeasurement(12100, "MB", { ...BIN, decimals: "2" }), formatMeasurement(12100, "MB", pinned("GiB", "2")));
		// A 1000-based unit is HWiNFO's number rescaled by 1000, as before.
		assert.deepEqual(formatMeasurement(12100, "MB", pinned("GB", "2")), { valueText: "12.10", unitText: "GB" });
		assert.deepEqual(formatMeasurement(453, "MB", pinned("B", "0")), { valueText: "453000000", unitText: "B" });
	});
});

describe("salvage: malformed settings inherit, never throw, never write", () => {
	const reading = { key: "s:0:1", unit: "MB" };
	const junkMaps: unknown[] = [undefined, null, [], [{ unit: "GB" }], "GB", 5, true, {}, { other: { unit: "GB" } }];
	for (const raw of junkMaps) {
		it(`map ${JSON.stringify(raw)} returns the base options object itself`, () => {
			assert.equal(measureFor(DEC, raw, reading), DEC);
		});
	}

	const junkEntries: unknown[] = [null, [], ["GB"], "GB", 5, { unit: 5 }, { unit: null }, { unit: ["GB"] }, { unit: {} }, { unit: "gb" }, { unit: " GB" }, { unit: "GB " }, { unit: "PB" }, { unit: "MB/s" }, { unit: "Mbps" }, { unit: "kbit/s" }, { unit: "constructor" }, { unit: "__proto__" }, { unit: "auto" }, { decimals: 2 }, { decimals: "4" }, { decimals: "-1" }, { decimals: "02" }, { decimals: "1e0" }, { decimals: " 2" }, { decimals: null }, {}];
	for (const entry of junkEntries) {
		it(`entry ${JSON.stringify(entry)} keeps the base options`, () => {
			const raw = { "s:0:1": entry };
			const before = JSON.stringify(raw);
			assert.equal(measureFor(DEC, raw, reading), DEC);
			assert.equal(JSON.stringify(raw), before, "never written");
		});
	}

	it("each field of an entry is salvaged on its own", () => {
		assert.deepEqual(readingFormatOf({ r: { unit: "PB", decimals: "2" } }, { key: "r" }), { decimals: "2" });
		assert.deepEqual(readingFormatOf({ r: { unit: "GB", decimals: 9 } }, { key: "r" }), { unit: "GB" });
		assert.deepEqual(readingFormatOf({ r: { unit: "GB", decimals: "auto", extra: { nested: true } } }, { key: "r" }), { unit: "GB", decimals: "auto" });
	});

	it('decimals "auto" overrides fixed action Decimals', () => {
		const opts = measureFor({ ...DEC, decimals: "3" }, { r: { decimals: "auto" } }, { key: "r", unit: "MB" });
		assert.equal(opts.decimals, "auto");
		assert.equal(formatMeasurement(12100, "MB", opts).valueText, "12.1");
	});

	it("prototype names are ordinary keys, own entries only", () => {
		const raw = JSON.parse('{"__proto__": {"unit": "GB", "decimals": "2"}, "constructor": {"unit": "TB"}}') as unknown;
		assert.equal(measureFor(DEC, raw, { key: "__proto__", unit: "MB" }).fixedUnit, "GB");
		assert.equal(measureFor(DEC, raw, { key: "constructor", unit: "MB" }).fixedUnit, "TB");
		for (const key of ["toString", "hasOwnProperty", "valueOf", "__defineGetter__"]) {
			assert.equal(measureFor(DEC, raw, { key, unit: "MB" }), DEC, key);
			assert.equal(measureFor(DEC, {}, { key, unit: "MB" }), DEC, key);
		}
		assert.equal(Object.getPrototypeOf({}), Object.prototype);
	});

	it("an inherited entry never counts", () => {
		const raw = Object.create({ "s:0:1": { unit: "GB" } }) as object;
		assert.equal(measureFor(DEC, raw, reading), DEC);
	});

	it("keys up to 2048 characters are looked up; longer ones never are", () => {
		const long = `g2:${"x".repeat(READING_FORMAT_KEY_MAX - 3)}`;
		const longer = `${long}y`;
		assert.equal(long.length, 2048);
		assert.equal(measureFor(DEC, { [long]: { unit: "GB" } }, { key: long, unit: "MB" }).fixedUnit, "GB");
		assert.equal(measureFor(DEC, { [longer]: { unit: "GB" } }, { key: longer, unit: "MB" }), DEC);
	});

	it("a huge map is never iterated: lookups go key by key", () => {
		const big: Record<string, unknown> = {};
		for (let i = 0; i < 200_000; i++) big[`k${i}`] = { unit: "GB" };
		big["s:0:1"] = { unit: "TB", decimals: "1" };
		const guarded = new Proxy(big, {
			ownKeys() {
				throw new Error("the map was iterated");
			}
		});
		assert.equal(measureFor(DEC, guarded, reading).fixedUnit, "TB");
		assert.equal(measureFor(DEC, guarded, { key: "absent", unit: "MB" }), DEC);
	});
});

describe("lookup by the reading's own keys", () => {
	it("its key first, then its confirmed aliases", () => {
		const raw = { "g2:a": { unit: "GB" }, "f1:0:5": { unit: "MB" } };
		assert.equal(readingFormatEntryOf(raw, { key: "f1:0:5", linkedKeys: ["f1:0:5", "g2:a"] })?.key, "f1:0:5");
		assert.equal(readingFormatEntryOf(raw, { key: "f1:0:6", linkedKeys: ["f1:0:6", "g2:a"] })?.key, "g2:a");
		assert.equal(readingFormatEntryOf(raw, { key: "zz", linkedKeys: ["zz"] }), null);
	});

	it("the first object entry decides; a junk field there inherits instead of falling through", () => {
		const raw = { saved: { unit: "PB" }, alias: { unit: "GB", decimals: "2" } };
		const opts = measureFor(DEC, raw, { key: "saved", linkedKeys: ["saved", "alias"], unit: "MB" });
		assert.equal(opts, DEC);
		const skip = { saved: "junk", alias: { unit: "GB" } };
		assert.equal(measureFor(DEC, skip, { key: "saved", linkedKeys: ["saved", "alias"], unit: "MB" }).fixedUnit, "GB", "a non-object entry is not an entry");
	});

	it("every key spelling resolves (Shared Memory, Gadget, calculated)", () => {
		for (const key of ["f0000301:0:8000005", "g:GPU [#0]|GPU Memory Available", "g2:R1BV|R1BV", "calc:AbCdEfGhIjKlMnOpQrStUv"]) {
			assert.equal(measureFor(DEC, { [key]: { unit: "GB" } }, { key, unit: "MB" }).fixedUnit, "GB", key);
		}
	});

	it("two actions never share a format (the memo is keyed by each map)", () => {
		const a = { r: { unit: "GB", decimals: "2" } };
		const b = { r: { unit: "MB", decimals: "0" } };
		assert.equal(measureFor(DEC, a, { key: "r", unit: "MB" }).fixedUnit, "GB");
		assert.equal(measureFor(DEC, b, { key: "r", unit: "MB" }).fixedUnit, "MB");
		assert.equal(measureFor(DEC, a, { key: "r", unit: "MB" }).fixedUnit, "GB");
		assert.equal(measureFor(DEC, { ...a }, { key: "r", unit: "MB" }).fixedUnit, "GB", "a spread copy resolves alike");
	});
});

describe("what a detail session carries from its opener", () => {
	it("only the entries under the keys the opener draws, as stored", () => {
		const raw = { a: { unit: "GB" }, b: { decimals: "1" }, orphan: { unit: "TB" } };
		assert.deepEqual(formatsForKeys(raw, ["a", undefined, "b"]), { a: { unit: "GB" }, b: { decimals: "1" } });
		assert.equal(formatsForKeys(raw, ["c"]), undefined);
		assert.equal(formatsForKeys([], ["a"]), undefined);
		assert.equal(formatsForKeys("x", ["a"]), undefined);
	});

	it("a __proto__ key stays an own entry", () => {
		const raw = JSON.parse('{"__proto__": {"unit": "GB"}}') as unknown;
		const carried = formatsForKeys(raw, ["__proto__"]) as Record<string, unknown>;
		assert.ok(Object.hasOwn(carried, "__proto__"));
		assert.equal(Object.getPrototypeOf(carried), Object.prototype);
	});
});

describe("the module carries no dead exports", () => {
	it("no panel cap and no unit list re-export: the panel owns its cap, measure.ts its units", async () => {
		const mod: Record<string, unknown> = await import("../src/ui/reading-format");
		assert.equal(mod.READING_FORMATS_PANEL_CAP, undefined);
		assert.equal(mod.FIXED_DATA_UNITS, undefined);
	});
});

describe("alerts never see a display format", () => {
	it("no file under src/alerts imports the measurement or format modules or names readingFormats", () => {
		const dir = new URL("../src/alerts/", import.meta.url);
		const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
		assert.ok(files.length >= 5);
		for (const name of files) {
			const source = readFileSync(new URL(name, dir), "utf8");
			assert.doesNotMatch(source, /ui\/measure|ui\/reading-format|readingFormats|fixedUnit/, name);
		}
	});
});
