import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeGenerations, distribution, frameGeneration } from "../scripts/lib/scaling-metrics.mjs";

describe("complete rendered generation witnesses", () => {
	const svg = (texts) => `<svg>${texts.map((text) => `<text>${text}</text>`).join("")}</svg>`;
	it("recognizes every value while excluding labels and combined session statistics", () => {
		assert.equal(frameGeneration(svg(["R1001", "1,003", "1003", "Min 1001 Max 1003"]), 2), 3);
		assert.equal(frameGeneration(svg(["Start HWiNFO"]), 1), null);
	});
	it("rejects partially updated or incomplete multi-reading faces", () => {
		assert.throws(() => frameGeneration(svg(["1003", "1002"]), 2), /mixed-generation/);
		assert.throws(() => frameGeneration(svg(["1003"]), 2), /Incomplete/);
		assert.throws(() => frameGeneration("not svg", 1), /Malformed/);
	});
});

const fixture = (overrides = {}) => ({
	publications: [{ generation: 0, publishedAt: 0 }, { generation: 1, publishedAt: 250 }],
	frames: [],
	contexts: ["key", "dial"],
	endAt: 2250,
	pollMs: 250,
	producerMs: 250,
	...overrides
});

describe("scaling distributions", () => {
	it("uses numeric sorting and nearest-rank percentiles without mutating inputs", () => {
		const values = [100, 2, 10, 1];
		assert.deepEqual(distribution(values), { count: 4, mean: 28.25, p50: 2, p95: 100, p99: 100, max: 100 });
		assert.deepEqual(values, [100, 2, 10, 1]);
		assert.deepEqual(distribution(Array.from({ length: 100 }, (_, index) => 100 - index)), { count: 100, mean: 50.5, p50: 50, p95: 95, p99: 99, max: 100 });
		assert.deepEqual(distribution([0]), { count: 1, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
	});

	it("rejects empty, negative and nonfinite observations instead of dropping them", () => {
		for (const values of [[], null, [NaN], [Infinity], [-1], [0, undefined], ["1"], new Array(2)]) {
			assert.throws(() => distribution(values), RangeError);
		}
		assert.equal(distribution([Number.MAX_VALUE, Number.MAX_VALUE]).mean, Number.MAX_VALUE);
	});
});

describe("generation coverage and command-to-output latency", () => {
	it("preserves every expected pair when no frame arrives", () => {
		const result = analyzeGenerations(fixture());
		assert.equal(result.totalPairs, 4);
		assert.equal(result.receivedPairs, 0);
		assert.equal(result.missingPairs, 4);
		assert.equal(result.coverageRatio, 0);
		assert.equal(result.completeGenerations, 0);
		assert.equal(result.unobservedGenerations, 2);
		assert.equal(result.latency, null);
		assert.equal(result.completeLatency, null);
		assert.equal(result.finalComplete, false);
		assert.equal(result.graceComplete, true);
		assert.deepEqual(result.generations.map((row) => row.missingContexts), [["key", "dial"], ["key", "dial"]]);
	});

	it("reports coalesced publications without silently shrinking the denominator", () => {
		const result = analyzeGenerations(fixture({ frames: [
			{ context: "key", generation: 1, at: 260 },
			{ context: "dial", generation: 1, at: 500 }
		] }));
		assert.equal(result.missingPairs, 2);
		assert.equal(result.totalPairs, 4);
		assert.equal(result.coverageRatio, 0.5);
		assert.equal(result.completeGenerations, 1);
		assert.equal(result.unobservedGenerations, 1);
		assert.equal(result.finalComplete, true, "the final state can complete despite earlier coalescing");
		assert.equal(result.overBudgetPairs, 0, "latency equal to one poll interval is not over budget");
		assert.deepEqual(result.latency, { count: 2, mean: 130, p50: 10, p95: 250, p99: 250, max: 250 });
		assert.equal(result.completeLatency.mean, 250);
	});

	it("counts first receipts, duplicates, old generations and unknown contexts separately", () => {
		const result = analyzeGenerations(fixture({ frames: [
			{ context: "key", generation: 1, at: 260 },
			{ context: "key", generation: 1, at: 270 },
			{ context: "foreign", generation: 1, at: 280 },
			{ context: "key", generation: 0, at: 300 },
			{ context: "key", generation: 0, at: 310 },
			{ context: "dial", generation: 0, at: 320 },
			{ context: "dial", generation: 1, at: 330 }
		] }));
		assert.equal(result.receivedPairs, 4);
		assert.equal(result.missingPairs, 0);
		assert.equal(result.latency.count, 4, "duplicates do not inflate latency samples");
		assert.equal(result.latency.mean, 177.5);
		assert.equal(result.duplicates, 2);
		assert.equal(result.outOfOrder, 2, "an old repeated generation is both duplicate and out of order");
		assert.equal(result.unknownFrames, 1);
		assert.equal(result.overBudgetPairs, 2);
		assert.equal(result.completeGenerations, 2);
		assert.deepEqual(result.completeLatency, { count: 2, mean: 200, p50: 80, p95: 320, p99: 320, max: 320 });
		assert.deepEqual(result.perContext[0], {
			context: "key", receivedPairs: 2, missingPairs: 0,
			latency: { count: 2, mean: 155, p50: 10, p95: 300, p99: 300, max: 300 },
			duplicates: 2, outOfOrder: 2
		});
	});

	it("requires all final contexts and the full grace interval for finalComplete", () => {
		const frames = [{ context: "key", generation: 1, at: 250 }, { context: "dial", generation: 1, at: 250 }];
		assert.equal(analyzeGenerations(fixture({ frames, endAt: 2249 })).finalComplete, false);
		assert.equal(analyzeGenerations(fixture({ frames, endAt: 2250 })).finalComplete, true);
		assert.equal(analyzeGenerations(fixture({ frames: frames.slice(0, 1) })).finalComplete, false);
		const slowPoll = analyzeGenerations(fixture({ frames, pollMs: 1000, endAt: 4249 }));
		assert.equal(slowPoll.graceMs, 4000);
		assert.equal(slowPoll.finalComplete, false);
		assert.equal(analyzeGenerations(fixture({ frames, pollMs: 1000, endAt: 4250 })).finalComplete, true);
	});

	it("uses published IDs instead of inventing generations in numeric gaps", () => {
		const result = analyzeGenerations(fixture({
			publications: [{ generation: 4, publishedAt: 10 }, { generation: 100, publishedAt: 260 }],
			frames: [{ context: "key", generation: 100, at: 260 }], endAt: 2260
		}));
		assert.equal(result.totalPairs, 4);
		assert.equal(result.receivedPairs, 1);
		assert.equal(result.latency.mean, 0);
		assert.equal(result.completeLatency, null);
	});

	it("rejects unknown generations and impossible frame times, including foreign contexts", () => {
		for (const frame of [
			{ context: "key", generation: 2, at: 260 },
			{ context: "key", generation: 1, at: 249 },
			{ context: "key", generation: 1, at: 2251 },
			{ context: "foreign", generation: 2, at: 260 },
			{ context: "foreign", generation: 1, at: 249 },
			{ context: "key", generation: NaN, at: 260 },
			{ context: "key", generation: 1, at: NaN },
			{ context: "key", generation: 1, at: Infinity }
		]) assert.throws(() => analyzeGenerations(fixture({ frames: [frame] })), RangeError);
		assert.throws(() => analyzeGenerations(fixture({ frames: [
			{ context: "key", generation: 0, at: 10 }, { context: "dial", generation: 0, at: 9 }
		] })), /receipt-time order/);
	});

	it("refuses malformed populations, intervals and publication ordering", () => {
		for (const overrides of [
			{ contexts: [] }, { contexts: ["key", "key"] }, { contexts: [""] }, { contexts: [0] },
			{ publications: [] }, { frames: null }, { endAt: -1 }, { endAt: 249 }, { endAt: NaN },
			{ pollMs: 0 }, { pollMs: NaN }, { pollMs: Infinity }, { producerMs: -1 }, { producerMs: Infinity },
			{ publications: [{ generation: 0, publishedAt: 0 }, { generation: 0, publishedAt: 250 }] },
			{ publications: [{ generation: 1, publishedAt: 0 }, { generation: 0, publishedAt: 250 }] },
			{ publications: [{ generation: 0, publishedAt: 0 }, { generation: 1, publishedAt: 0 }] },
			{ publications: [{ generation: 0, publishedAt: 1 }, { generation: 1, publishedAt: 0 }] },
			{ publications: [{ generation: Number.MAX_SAFE_INTEGER + 1, publishedAt: 0 }] },
			{ publications: [{ generation: 0.5, publishedAt: 0 }] },
			{ publications: [{ generation: 0, publishedAt: Infinity }] }
		]) assert.throws(() => analyzeGenerations(fixture(overrides)));
	});
});
