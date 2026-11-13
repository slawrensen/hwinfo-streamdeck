/**
 * One strip frame of a rule screen allocates no more than it did when it
 * kept the plugin under V8's young-generation shrink threshold (measured
 * 2026-10-27), give or take GROWTH_MB.
 *
 * Why: V8 doubles its young generation (up to two 16 MB semi-spaces under
 * Node 20) while objects survive its scavenges, and shrinks it back only
 * at a scavenge that finds the whole plugin's allocation rate under about
 * 1 MB/s. A strip frame comes with each HWiNFO poll (every 2 s), so a
 * screen whose frame allocates too much keeps the plugin about 30 MB
 * larger for as long as it is on view. Measured on a837796 under the app's Node
 * 20.20.2 (the plugin under a mock Stream Deck app and a synthetic
 * HWiNFO, no input, panel closed): Every temperature on view held the
 * young generation at 32 MB and the plugin at 96 to 98 MB private, against
 * 58 MB for a Trend strip; the heap after a full GC stayed flat.
 * In this process (fixtures past the caps, at the width the frame holds,
 * so no ladder): Group rows over 48 readings 3.2 to 3.5 MB a frame,
 * Ambient over 75 readings 3.4 MB, Trend 0.9 MB. Most of it was per-cell,
 * per-reading garbage: binView (an object per cell), heatCells, auroraLines,
 * ambientTrail and the slices' serialisation.
 *
 * Since bins, heat cells and trails come from a reused Scratch
 * (graph.ts) and path text from one reused buffer (prims.ts), under Node
 * 24.16 and 20.20.2: Group rows over 48 readings 0.7 MB a frame, Ambient
 * over 75 readings 0.6 to 0.7 MB.
 * With Every temperature on view the same plugin-level check (22 minutes)
 * kept new space at 8 MB at most and at 1 to 4 MB from the third minute
 * on (32 MB before), and the plugin at 70 MB private (90 MB before, 60 MB
 * for a Trend strip). Group Spread, which those figures left out, was
 * still 2.6 to 2.7 MB at its 32 readings (an array and a sorted copy per
 * bucket for its median) and is 0.6 to 0.7 MB since.
 *
 * How much is too much: on Every temperature (the same check, 16 minutes
 * each, Node 20.20.2) the plugin allocated 0.87 MB/s with the frame as it
 * is, and new space stayed at 8 MB at most, the plugin at 71 MB private.
 * With 0.23 MB more garbage a frame: 1.03 MB/s, 10 MB, 72 MB. With 0.58 MB
 * more: 1.09 MB/s, new space held at 32 MB, 96 MB private; with 0.94 MB
 * more, the same. The rest of the plugin (the poll, the history views a
 * screen draws, the keys and dials) takes most of the 1 MB/s, so a frame
 * that grows by half a megabyte loses the win well before 1.5 MB. Each case
 * may allocate at most GROWTH_MB more than it did then (its `today`, the
 * larger of Node 24.16 and 20.20.2, rounded up); a change that draws more
 * on purpose measures again and moves `today`, as a drawing change moves
 * the frame digest (strip-frame-scratch.test.ts).
 *
 * The cases are every view a person can pick, each at the most readings a
 * pane draws (group.ts ruleDrawMax: Group 32, Ambient 48; Auto draws
 * lines up to 8), on a whole + XL strip.
 * Not in the npm test list; run with
 *   npx tsx --test test/strip-frame-garbage.test.ts
 */
import assert from "node:assert/strict";
import { Session } from "node:inspector/promises";
import { it } from "node:test";

import { ambientFixture, groupFixture } from "../scripts/lib/strip-fixtures";
import type { StripSceneInput } from "../src/strip/scene";
import { AMBIENT_DRAW_MAX, GROUP_DRAW_MAX } from "../src/strip/settings";
import { sliceStrip } from "../src/strip/slicer";

const MB = 1048576;
/** How much more a frame may allocate than its `today`: 0.23 MB more a
 * frame kept the win, 0.58 MB more lost it (see the header). */
const GROWTH_MB = 0.2;

type ProfileNode = { selfSize: number; children: ProfileNode[] };

/** Bytes one frame allocates at the width it holds, garbage included: the
 * sampling heap profiler, with the objects later collected kept. 50 frames
 * first, as a plugin that has run a while (after 5, a case still counted up
 * to 0.2 MB of the JIT's own work). */
async function bytesPerFrame(input: StripSceneInput, frames = 30): Promise<number> {
	const held = sliceStrip(input).bucketPx;
	const atHeld = { ...input, bucketPx: held };
	for (let i = 0; i < 50; i++) sliceStrip(atHeld, held);
	const session = new Session();
	session.connect();
	try {
		await session.post("HeapProfiler.enable");
		await session.post("HeapProfiler.startSampling", { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
		for (let i = 0; i < frames; i++) sliceStrip(atHeld, held);
		const { profile } = (await session.post("HeapProfiler.stopSampling")) as unknown as { profile: { head: ProfileNode } };
		const sum = (n: ProfileNode): number => n.selfSize + n.children.reduce((s, c) => s + sum(c), 0);
		return sum(profile.head) / frames;
	} finally {
		session.disconnect();
	}
}

const whole = { layout: "whole", encoders: 6, window: "15m" } as const;
const CASES: readonly { readonly name: string; readonly today: number; readonly input: () => StripSceneInput }[] = [
	{ name: `Group rows over ${GROUP_DRAW_MAX} temperatures`, today: 0.55, input: () => groupFixture({ ...whole, n: GROUP_DRAW_MAX, view: "rows", kind: "temp", background: "theme" }).input },
	{ name: `Group Now over ${GROUP_DRAW_MAX} temperatures`, today: 0.65, input: () => groupFixture({ ...whole, n: GROUP_DRAW_MAX, view: "now", kind: "temp", background: "theme" }).input },
	{ name: `Group Spread over ${GROUP_DRAW_MAX} temperatures`, today: 0.65, input: () => groupFixture({ ...whole, n: GROUP_DRAW_MAX, view: "spread", kind: "temp", background: "nebula" }).input },
	{ name: "Group lines over 8 clocks", today: 1.0, input: () => groupFixture({ ...whole, n: 8, view: "auto", kind: "clock", background: "theme" }).input },
	{ name: `Ambient over ${AMBIENT_DRAW_MAX} temperatures`, today: 0.5, input: () => ambientFixture({ ...whole, n: AMBIENT_DRAW_MAX, kind: "temp", background: "theme" }).input }
];

for (const c of CASES) {
	const limit = (c.today + GROWTH_MB).toFixed(2);
	it(`${c.name}: a frame allocates under ${limit} MB`, async () => {
		const bytes = await bytesPerFrame(c.input());
		assert.ok(bytes < Number(limit) * MB, `${c.name}: ${(bytes / MB).toFixed(2)} MB a frame, ${c.today} MB when measured (limit ${limit} MB)`);
	});
}
