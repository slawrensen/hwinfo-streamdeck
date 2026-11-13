/**
 * CIEDE2000 against the published reference data (Sharma, Wu and Dalal,
 * "The CIEDE2000 color-difference formula: implementation notes,
 * supplementary test data, and mathematical observations", 2005, Table 1),
 * plus the sRGB to CIELAB step on known anchors.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ciede2000, ciede2000Lab, hexToLab, type Lab } from "../src/ui/color-difference";

/** [L1, a1, b1, L2, a2, b2, ΔE00], all 34 pairs. */
const SHARMA: ReadonlyArray<readonly [number, number, number, number, number, number, number]> = [
	[50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425],
	[50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
	[50, 2.8361, -74.02, 50, 0, -82.7485, 3.4412],
	[50, -1.3802, -84.2814, 50, 0, -82.7485, 1],
	[50, -1.1848, -84.8006, 50, 0, -82.7485, 1],
	[50, -0.9009, -85.5211, 50, 0, -82.7485, 1],
	[50, 0, 0, 50, -1, 2, 2.3669],
	[50, -1, 2, 50, 0, 0, 2.3669],
	[50, 2.49, -0.001, 50, -2.49, 0.0009, 7.1792],
	[50, 2.49, -0.001, 50, -2.49, 0.001, 7.1792],
	[50, 2.49, -0.001, 50, -2.49, 0.0011, 7.2195],
	[50, 2.49, -0.001, 50, -2.49, 0.0012, 7.2195],
	[50, -0.001, 2.49, 50, 0.0009, -2.49, 4.8045],
	[50, -0.001, 2.49, 50, 0.001, -2.49, 4.8045],
	[50, -0.001, 2.49, 50, 0.0011, -2.49, 4.7461],
	[50, 2.5, 0, 50, 0, -2.5, 4.3065],
	[50, 2.5, 0, 73, 25, -18, 27.1492],
	[50, 2.5, 0, 61, -5, 29, 22.8977],
	[50, 2.5, 0, 56, -27, -3, 31.903],
	[50, 2.5, 0, 58, 24, 15, 19.4535],
	[50, 2.5, 0, 50, 3.1736, 0.5854, 1],
	[50, 2.5, 0, 50, 3.2972, 0, 1],
	[50, 2.5, 0, 50, 1.8634, 0.5757, 1],
	[50, 2.5, 0, 50, 3.2592, 0.335, 1],
	[60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
	[63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
	[61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
	[35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
	[22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
	[36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
	[90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
	[90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
	[6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
	[2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082]
];

describe("CIEDE2000", () => {
	it("matches all 34 published reference pairs to four decimals", () => {
		for (const [l1, a1, b1, l2, a2, b2, expected] of SHARMA) {
			const first: Lab = [l1, a1, b1];
			const second: Lab = [l2, a2, b2];
			const forward = ciede2000Lab(first, second);
			assert.ok(Math.abs(forward - expected) < 5e-5, `${first} vs ${second}: ${forward} (expected ${expected})`);
			// The formula is symmetric.
			assert.ok(Math.abs(ciede2000Lab(second, first) - forward) < 1e-9);
		}
	});

	it("is zero for one color and positive for two", () => {
		assert.equal(ciede2000("#E8940D", "#E8940D"), 0);
		assert.equal(ciede2000("#000000", "#000000"), 0);
		assert.ok(ciede2000("#000000", "#000001") > 0);
	});

	it("converts sRGB anchors to CIELAB under D65", () => {
		const near = (lab: Lab, expected: Lab, tolerance: number): void => {
			for (let i = 0; i < 3; i++) assert.ok(Math.abs((lab[i] ?? NaN) - (expected[i] ?? NaN)) < tolerance, `${lab} vs ${expected}`);
		};
		near(hexToLab("#FFFFFF"), [100, 0, 0], 0.01);
		near(hexToLab("#000000"), [0, 0, 0], 1e-9);
		near(hexToLab("#808080"), [53.585, 0, 0], 0.01);
		near(hexToLab("#FF0000"), [53.24, 80.09, 67.2], 0.02);
	});
});
