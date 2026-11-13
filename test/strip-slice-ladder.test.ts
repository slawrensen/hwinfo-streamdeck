/**
 * A strip frame that settled on a coarse bucket rebuilds the whole scene
 * at every finer bucket again on the next frame (src/strip/slicer.ts
 * sliceStrip: the ladder starts at the finest rung each frame; `held`
 * only tightens the bound of the finer rungs).
 *
 * Why it matters (2026-10-27, measured on a837796's bundle
 * under Node 20.20.2): with Build screens for this PC's "Every
 * temperature" (Ambient) on view over Nebula and no input at all,
 * every frame built the scene three times (call counts over 60 s:
 * scheduler frame 30, sliceStrip 30, buildStripScene 90, Ambient pane 90,
 * slicesOf 90, sliceScene 540), about 2.4 MB/s of garbage, 80 % of it in
 * that frame. V8's young generation grew to its 16 MB semi-space maximum
 * and stayed there: the plugin held 96 to 98 MB private for as long as
 * the screen was on view (Group "Core clocks" the same), the soak's 100 to 105 MB plateau. Nothing is retained (the heap
 * after a full GC is flat); the memory is the young generation sized for
 * the churn.
 *
 * Expected after a fix: a frame whose previous frame held a rung builds
 * one scene when that rung still fits (a finer rung tried now and then,
 * not every frame).
 */
import assert from "node:assert/strict";
import { it } from "node:test";

import { ambientFixture, fixtureCase } from "../scripts/lib/strip-fixtures";
import type { StripSceneInput } from "../src/strip/scene";
import { HOLD_PROBE_FRAMES, sliceStrip } from "../src/strip/slicer";

/** The input with a counter on `config`: sliceStrip reads it once for the
 * bound, and every scene it builds spreads the input (one more read). */
function counted(input: StripSceneInput): { input: StripSceneInput; reads: () => number } {
	let reads = 0;
	const { config, ...rest } = input;
	const wrapped = { ...rest } as StripSceneInput;
	Object.defineProperty(wrapped, "config", {
		enumerable: true,
		get() {
			reads++;
			return config;
		}
	});
	return { input: wrapped, reads: () => reads };
}

it("a dense Ambient frame over Nebula that held the coarsest bucket builds its scene once on the next frame", () => {
	const c = ambientFixture({ n: 48, kind: "walk", layout: "whole", encoders: 6, window: "5m", background: "nebula" });
	const first = sliceStrip(c.input);
	assert.ok(first.bucketPx > (c.input.bucketPx ?? 2) && first.reduced !== true, `precondition: the frame needs a coarser bucket than it starts at (${c.input.bucketPx ?? 2} -> ${first.bucketPx}, reduced ${String(first.reduced)})`);
	const next = counted(c.input);
	// Between probes (the controller asks for one every HOLD_PROBE_FRAMES frames).
	const again = sliceStrip(next.input, first.bucketPx, false);
	assert.equal(again.bucketPx, first.bucketPx, "the next frame lands on the same bucket");
	const builds = next.reads() - 1;
	assert.equal(builds, 1, `scenes built for one frame that held bucket ${first.bucketPx}: ${builds}`);
});

it("a frame between probes keeps the width the strip holds, and a probe frame takes a finer width once it fits", () => {
	const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "nebula", accent: false });
	const fine = sliceStrip(c.input);
	assert.equal(fine.bucketPx, c.input.bucketPx ?? 2, "precondition: the Trend frame fits at the finest width it starts at");
	assert.equal(sliceStrip(c.input, 8, false).bucketPx, 8, "between probes the strip stays at the coarse width it holds");
	assert.equal(sliceStrip(c.input, 8, true).bucketPx, fine.bucketPx, "a probe frame goes back to the finer width that fits");
	assert.ok(HOLD_PROBE_FRAMES >= 2 && HOLD_PROBE_FRAMES <= 30, `a probe at least once a minute at HWiNFO's 2 s (${HOLD_PROBE_FRAMES} frames)`);
});
