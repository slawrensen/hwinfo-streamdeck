/**
 * A strip frame takes its working arrays from one Scratch it reuses frame
 * after frame (graph.ts), so a rule screen grows them to its size: on the
 * Group and Ambient screens at their caps over a split + XL strip,
 * about 1.3 MB outside the JS heap (measured 2026-10-27, Node 24.16 and
 * 20.20.2). Once only a Trend strip draws, that memory must be given back
 * within two minutes, or the plugin keeps it for as long as it runs.
 *
 * Its own file: the measure is what the process holds, so no frame drawn
 * by another test may come before it.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { ambientFixture, fixtureCase, groupFixture } from "../scripts/lib/strip-fixtures";
import { sliceStrip } from "../src/strip/slicer";

const MB = 1048576;

it("gives back what the rule screens grew within two minutes of Trend frames", () => {
	// The arrays live outside the JS heap; a full collection frees the ones
	// nothing holds, so what is left after it is what the strip keeps.
	setFlagsFromString("--expose-gc");
	const gc = runInNewContext("gc") as () => void;
	const held = (): number => {
		gc();
		gc();
		return process.memoryUsage().arrayBuffers;
	};
	// Every input is made first, so its history views count in every figure.
	const trend = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "theme", accent: false }).input;
	const screens = [
		groupFixture({ n: 32, view: "rows", window: "15m", layout: "split" }).input,
		groupFixture({ n: 32, view: "spread", window: "15m", layout: "split" }).input,
		ambientFixture({ n: 48, kind: "walk", window: "15m", layout: "split" }).input,
		ambientFixture({ n: 24, kind: "mixed", window: "15m", layout: "split" }).input
	];
	sliceStrip(trend);
	const before = held();
	for (const input of screens) sliceStrip(input);
	const grown = held() - before;
	assert.ok(grown > 0.5 * MB, `the rule screens grew the strip's arrays by ${(grown / MB).toFixed(2)} MB, too little to tell`);
	// Two minutes of HWiNFO's 2 s poll.
	for (let i = 0; i < 60; i++) sliceStrip(trend);
	const kept = held() - before;
	assert.ok(kept < 0.1 * MB, `still ${(kept / MB).toFixed(2)} MB more than before the rule screens (they grew ${(grown / MB).toFixed(2)} MB)`);
});
