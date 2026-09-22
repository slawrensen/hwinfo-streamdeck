import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessLoadMetrics, expectedRssSampleCount } from "../scripts/lib/load-metrics.mjs";

describe("load evidence requires complete observations", () => {
	it("includes baseline and final observation for exact and partial intervals", () => {
		for (const [seconds, expected] of [[1, 2], [15, 2], [16, 3], [30, 3], [45, 4], [90, 7]]) {
			assert.equal(expectedRssSampleCount(seconds * 1000, 15_000), expected);
		}
		for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			assert.throws(() => expectedRssSampleCount(duration, 15_000), RangeError);
		}
	});

	it("refutes the former one-success-then-failures false pass", () => {
		const samples = [75, -1, -1, -1, -1, -1, -1];
		const former = samples.filter((value) => value > 0);
		assert.ok(Math.max(...former) < 300 && former.at(-1) - former[0] < 25, "negative control: the old gate passed");
		const result = assessLoadMetrics(samples, 7, 0);
		assert.equal(result.complete, false);
		assert.equal(result.validSamples, 1);
		assert.equal(result.peak, null, "no peak claim from incomplete observations");
		assert.equal(result.growth, null, "no fabricated zero growth");
	});

	it("refuses missing samples and failed, nonfinite or empty measurements", () => {
		for (const samples of [[], [75], [75, 76], [75, -1, 77], [75, Number.NaN, 77], [75, Number.POSITIVE_INFINITY, 77], [75, 0, 77]]) {
			assert.equal(assessLoadMetrics(samples, 3, 0).complete, false);
		}
		assert.equal(assessLoadMetrics([75], 1, 0).complete, false);
	});

	it("reports measured bounds only when every expected sample succeeded", () => {
		assert.deepEqual(assessLoadMetrics([75, 82, 78, 80], 4, 0), { complete: true, validSamples: 4, expectedSamples: 4, peak: 82, growth: 5, framesValid: true });
		assert.equal(assessLoadMetrics([75, 320, 80], 3, 0).peak, 320);
		assert.equal(assessLoadMetrics([75, 80, 110], 3, 0).growth, 35);
	});

	it("an invalid frame arriving after the initial sweep fails the final verdict", () => {
		const samples = [75, 76, 77];
		let invalidFrames = 0;
		assert.equal(assessLoadMetrics(samples, 3, invalidFrames).framesValid, true);
		invalidFrames++;
		assert.equal(assessLoadMetrics(samples, 3, invalidFrames).framesValid, false);
	});
});
