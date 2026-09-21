import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { report } from "../scripts/scaling-report.mjs";

function fixture() {
	const base = { inventory: 512, keys: 36, dials: 6, rotation: 16, pollMs: 250, producerMs: 250, pi: false, rich: false, timing: true };
	const cases = [{ ...base, name: "changing-250" }, { ...base, name: "inventory-2048", inventory: 2048 }];
	return {
		schema: 1, ok: true, mode: "benchmark", seconds: 120, warmup: 30, repeats: 3,
		machine: { label: "fixture", node: "v20.20.0" }, source: "revision", pluginSha256: "a".repeat(64), nativeSha256: "b".repeat(64), cases,
		results: cases.flatMap((config, index) => [10, 30, 20].map((cpu, repeat) => ({
			name: config.name, repeat: repeat + 1, config, ok: true, budget: { cpu: true, callback: true },
			cpuPercentOneCore: cpu * (index + 1), callbackMs: { p95: 2 * (index + 1) }, drainMs: { p95: 4 * (index + 1) },
			rssPeak: 100 * 1024 ** 2, updates: { coverageRatio: 1, latency: { p95: 100 } }
		})))
	};
}

describe("scaling report", () => {
	it("reports medians of repeat p95s and labeled ratios", () => {
		const output = report(fixture());
		assert.match(output, /\| changing-250 \| 20\.00 \| 2\.00 \| 4\.00 \| 100\.00 \| 100\.00 \| 100\.00 \| PASS \|/);
		assert.match(output, /changing-250 → inventory-2048 \(inventory\) \| 2\.00x \| 2\.00x \| 2\.00x \| 1\.00x/);
		assert.match(output, /not a pooled percentile/);
		assert.match(output, /smoke run is not capacity proof/);
	});

	it("leaves missing metrics and ratios involving zero unknown", () => {
		const input = fixture();
		for (const row of input.results.filter((row) => row.name === "changing-250")) { row.callbackMs = null; row.cpuPercentOneCore = 0; row.budget.callback = null; }
		input.results[0].rssPeak = NaN;
		const output = report(input);
		assert.match(output, /\| changing-250 \| 0\.00 \| unknown \| 4\.00 \| 100\.00 \| 100\.00 \| unknown \| UNKNOWN \|/);
		assert.match(output, /changing-250 → inventory-2048 \(inventory\) \| unknown \| unknown/);
		const other = fixture(); other.results.forEach((row) => { row.cpuPercentOneCore = 0; });
		assert.match(report(fixture(), other), /changing-250 \(second \/ first\) \| unknown/);
	});

	it("refuses ratios when a repeat or whole declared case is missing", () => {
		for (const keep of [(row) => row.repeat !== 3, (row) => row.name === "changing-250"]) {
			const input = fixture(); input.results = input.results.filter(keep);
			const output = report(input);
			assert.match(output, /Ratios refused: incomplete, duplicate or mismatched case repetitions/);
			assert.doesNotMatch(output, /2\.00x/);
		}
		const duplicate = fixture(); duplicate.results[1].repeat = 1;
		assert.match(report(duplicate), /Ratios refused/);
		const undeclared = fixture(); delete undeclared.cases;
		assert.match(report(undeclared), /Ratios refused: missing declared case manifest/);
	});

	it("refuses unintended changes on a purported single scaling axis", () => {
		const input = fixture(); input.cases[1].pollMs = 1000;
		assert.match(report(input), /refused: axis mismatch/);
	});

	it("requires compatible complete workloads and measurement modes for a second machine", () => {
		for (const change of [
			(input) => { input.seconds++; }, (input) => { input.warmup++; }, (input) => { input.repeats++; },
			(input) => { input.machine.node = "v22.1.0"; }, (input) => { input.mode = "smoke"; },
			(input) => { input.measurementMode = "different"; }, (input) => { input.cases[1].keys++; },
			(input) => { input.results.pop(); }, (input) => { input.ok = false; }, (input) => { input.results[0].ok = false; },
			(input) => { delete input.pluginSha256; }, (input) => { delete input.source; }
		]) {
			const other = fixture(); change(other);
			const comparison = report(fixture(), other).split("## Second-run comparison")[1];
			assert.match(comparison, /Ratios refused:/);
			assert.doesNotMatch(comparison, /\(second \/ first\) \|/);
		}
	});

	it("allows compatible different bytes with a code-comparison qualification", () => {
		const other = fixture(); other.pluginSha256 = "c".repeat(64); other.source = "new-revision";
		for (const row of other.results) row.cpuPercentOneCore *= 2;
		const comparison = report(fixture(), other).split("## Second-run comparison")[1];
		assert.match(comparison, /also a code comparison; hardware effects are not isolated/);
		assert.match(comparison, /changing-250 \(second \/ first\) \| 2\.00x/);
		assert.doesNotMatch(comparison, /Ratios refused/);
	});

	it("distinguishes a budget review from failed or absent evidence", () => {
		const input = fixture(); input.results[0].budget.cpu = false;
		assert.match(report(input), /\| REVIEW \|/);
		input.results[0].ok = false;
		assert.match(report(input), /\| FAIL \|/);
		input.results[0].ok = true; input.results[0].budget = {};
		input.results[1].budget = {}; input.results[2].budget = {};
		assert.match(report(input), /\| UNKNOWN \|/);
		assert.throws(() => report({ schema: 2, results: [], repeats: 1 }), TypeError);
	});
});
