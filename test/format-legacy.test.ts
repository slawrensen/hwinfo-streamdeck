/**
 * Legacy invariance for byte and rate readings: every face the driver
 * composes (keys in each layout, dials in each view, detail tiles, the
 * Back tile and its fallback, under Decimal and Binary data units and both
 * face fonts) is byte for byte what 1.7.1 composed from the same settings.
 * The golden was produced by running test/format-legacy-driver.ts against
 * the v1.7.1 sources (tag v1.7.1, bb4aede). Regenerated on purpose on
 * 2026-10-29 for issue #59, after review of every face that moved (121 of
 * 477): the 109 Binary faces of byte amounts now read HWiNFO's KB to TB as
 * 1024-based (12,100 MB reads 11.82 GiB, not 11.27; no rate moved), and the
 * 12 faces of a zero byte reading in Auto read "0 B", not "0.00 B" (a
 * shorter value can take a larger size and leave its label more room).
 * Every other face is 1.7.1's. The same bytes must come out
 * when the settings carry a readingFormats field that holds nothing for the
 * readings on the face: empty, junk of every shape, entries for other
 * readings, units and decimals this version does not know, and units the
 * reading cannot take.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { formatLegacyFaces, G0, G1, LINK, NET_DL, NET_RATE, TEMP } from "./format-legacy-driver";

const golden = JSON.parse(readFileSync(new URL("./golden/format-legacy-faces.json", import.meta.url), "utf8")) as Record<string, string>;

const EVERY_KEY = [G0, G1];

/** readingFormats values that must leave every face exactly as 1.7.1 drew it. */
const INERT: ReadonlyArray<[string, unknown]> = [
	["empty object", {}],
	["null", null],
	["an array", [{ unit: "GB" }]],
	["a string", "GB"],
	["a number", 5],
	["entries for other readings only", { "zz:0:1": { unit: "GB", decimals: "2" }, "g2:abc": { decimals: "0" } }],
	["null and array entries", Object.fromEntries(EVERY_KEY.map((k, i) => [k, i === 0 ? null : ["GB"]]))],
	["string entries", Object.fromEntries(EVERY_KEY.map((k) => [k, "GB"]))],
	["empty entries", Object.fromEntries(EVERY_KEY.map((k) => [k, {}]))],
	["wrong-case and padded units", { [G0]: { unit: "gb" }, [G1]: { unit: " GB" } }],
	["future units", { [G0]: { unit: "PB" }, [G1]: { unit: "MB/s" } }],
	["junk decimals", { [G0]: { decimals: 2 }, [G1]: { decimals: "4" } }],
	["more junk decimals", { [G0]: { decimals: "02" }, [G1]: { decimals: " 2" } }],
	["a unit named like a built-in", { [G0]: { unit: "constructor" }, [G1]: { unit: "__proto__" } }],
	["byte units on readings that cannot take them", { [TEMP]: { unit: "GB" }, [NET_DL]: { unit: "KB" }, [NET_RATE]: { unit: "MB" }, [LINK]: { unit: "GB" } }],
	["prototype keys", JSON.parse(`{"__proto__": {"unit": "GB", "decimals": "2"}, "constructor": {"unit": "GB"}, "toString": {"decimals": "1"}}`)]
];

describe("byte and rate faces are the 1.7.1 faces", () => {
	const faces = formatLegacyFaces();

	it("covers every case the golden holds", () => {
		assert.deepEqual(Object.keys(faces).sort(), Object.keys(golden).sort());
		assert.ok(Object.keys(golden).length >= 400);
	});

	it("the golden holds real byte and rate faces", () => {
		const all = Object.values(golden).join("\n");
		for (const unit of [">GB<", ">MB<", ">GiB<", ">TB<", "Mbps", "MiB/s"]) assert.ok(all.includes(unit), unit);
	});

	for (const name of Object.keys(golden)) {
		it(name, () => {
			assert.equal(faces[name], golden[name]);
		});
	}
});

describe("a readingFormats field that holds nothing for the face keeps the 1.7.1 bytes", () => {
	for (const [name, value] of INERT) {
		it(name, () => {
			const faces = formatLegacyFaces((settings) => ({ ...settings, readingFormats: value }));
			const moved = Object.keys(golden).filter((face) => faces[face] !== golden[face]);
			assert.deepEqual(moved, []);
		});
	}
});
