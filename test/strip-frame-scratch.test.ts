/**
 * A strip frame reuses its working arrays from frame to frame (graph.ts
 * Scratch: the bins, the heat cells, the Ambient trails) and writes path
 * text through one reused buffer (prims.ts), so a Group or Ambient frame
 * stops allocating megabytes of garbage. Neither may
 * change a byte: the digest pins every slice and reference frame of a
 * corpus of frames as 1.8 drew them before the reuse (cff212c; a larger
 * corpus of 62,317 slices matched byte for byte when the change was made),
 * and a scene a caller keeps (the controller's lastScene, the panel's
 * reference frame) must read the same after later frames of its own group
 * and of another one.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { ambientFixture, fixtureCase, groupFixture, type FixtureCase } from "../scripts/lib/strip-fixtures";
import type { HistoryView } from "../src/history/types";
import { renderLogical, type StripSceneInput } from "../src/strip/scene";
import { sliceScene, sliceStrip, type StripSlices } from "../src/strip/slicer";

/** See "draws byte for byte what it drew before its scratch was reused".
 * Cutting a look (Silk, Bars, Envelope and Fleet, 2026-11-04) shortens the
 * corpus: the digest of what is left is taken on the tree before the cut,
 * and the cut must not move it.
 * It moved twice since, each time in the Nebula frames' alert colors only:
 * first the warn and crit words beside a limit band lifted to their floor
 * on the art's ceiling (23 of 553 hashed chunks), then every alert color
 * did (stripAlertColors: 65 of 553, the bands' paints and edges, values,
 * cells and their paint names, and stale marks mixed from
 * them; #E8940D to #EA9E23 and #FF3B30 to #FF8D86 on Graphite). Theme,
 * Outline and Clear frames kept every byte both times. A third move: that
 * lift holds a CIELAB hue (on Nebula Graphite warn #FFAE3A, crit #FF8F73),
 * and a stale reading's alert pieces draw undimmed (74 of 514 cases: 62
 * Nebula frames' alert colors, and 12 Theme, Outline and Clear frames with
 * stale readings, whose Events runs and Group cells past a limit kept their
 * place and size and lost the dimming). A fourth: warn and crit differ
 * by size where color was their only cue (74 of 514 cases, every look:
 * 28 Events frames, whose warn and Yes runs are half a crit run's height;
 * 18 Heat frames, whose crit caps are twice a warn cap; 28 Group Rows
 * frames, Auto from 9 readings among them, whose warn cells keep their
 * ramp color under a cap over their upper half and whose crit row bars
 * are twice as wide). A fifth: the words over the graph draw in Outline's
 * 1 px edge with no smoke behind them (323 of 514 cases on every look, the
 * graph styles' and Group's frames; every Ambient frame kept its
 * bytes), and each case drew the same bytes with the corpus run forward
 * and in reverse. A sixth, on 2026-10-28: the Y scale went calm and held
 * (src/strip/scale.ts; 242 of 514 cases against lane26/integration d9c534a:
 * 111 graph frames' ends, lines and row words' x, 122 Group frames, whose
 * Lines, Spread, Rows and Now take round held scales; every Ambient frame
 * kept its
 * bytes), and each case drew the same bytes forward and in reverse (0 of
 * 514 differing). A seventh, on 2026-11-04: the words over a graph took
 * their small tabs on the see-through looks (WORD_TAB; 30 of 514 cases, all
 * Outline and Clear graph frames; every Group, Ambient, Theme and
 * Nebula frame kept its bytes). Drawn without the tabs, all 514 still matched
 * the digest they replace, and each case drew the same bytes forward and in
 * reverse (0 of 514 differing). An eighth, on 2026-11-04: a lane with Scale
 * and grid off asks for six ticks (9 of 514 cases, all Lanes frames with the
 * box off; compared case by case against integration 00534cb2). A ninth, the
 * same day: machine words left the strip (252 of 514 cases, every one a
 * Group foot, an Ambient mark or the names row of a Trend, Area or Envelope
 * of two; 225 differ in text alone, and 27 Trend, Heat+Trend and Envelope
 * frames also in the second reading's chip, which follows its name left; no
 * line, band or bucket moved, and no slice grew). A tenth, on 2026-11-04:
 * Large values only stopped reading the stored Graph, so a first reading takes
 * the series' first hue in place of the accent (24 of the corpus's 392 first
 * drawings, every one a Trend, Area or Heat pane on values only; compared case
 * by case against the frame before). An eleventh, the same day: the readings of
 * values only spread across the pane (40 of the 392, every values-only pane in
 * the corpus and no other). */
const FRAME_DIGEST = "06f803e6e1ffe12ec1ab3dc086df03267d30cc2cca16afe474bcdd77d8046911";

/** Some columns with a non-finite field, which binning skips. */
function withNaN(view: HistoryView, every: number): HistoryView {
	const c = view.cols;
	const cols = { ...c, first: Float64Array.from(c.first), min: Float64Array.from(c.min), max: Float64Array.from(c.max), last: Float64Array.from(c.last) };
	for (let i = 1; i < cols.n; i += every) (i % 2 === 0 ? cols.min : cols.last)[i] = Number.NaN;
	return { ...view, cols };
}

/** A later frame: every column's values from `k` columns on. */
function later(input: StripSceneInput, k: number): StripSceneInput {
	return {
		...input,
		panes: input.panes.map((p) => ({
			...p,
			series: p.series.map((s) => {
				if (s.history === undefined) return s;
				const c = s.history.cols;
				const at = (a: Float64Array): Float64Array => Float64Array.from(a, (_, i) => a[(i + k) % Math.max(1, c.n)] as number);
				return { ...s, history: { ...s.history, cols: { ...c, first: at(c.first), min: at(c.min), max: at(c.max), last: at(c.last) } } };
			})
		}))
	};
}

/** Missing, stale and NaN readings among the rest. */
function withStates(input: StripSceneInput): StripSceneInput {
	return {
		...input,
		panes: input.panes.map((p) => ({
			...p,
			series: p.series.map((s, i) => (i % 5 === 1 ? { key: s.key, name: s.name, unit: s.unit, state: "missing" as const } : i % 5 === 2 ? { ...s, state: "stale" as const } : i % 5 === 3 ? { ...s, current: Number.NaN } : i % 5 === 4 && s.history !== undefined ? { ...s, history: withNaN(s.history, 7) } : s))
		}))
	};
}

/** Every rule style and view, the styles that share the binning, the
 * coarser buckets and the values-only face, alerts, gaps and missing
 * readings, both decks and both layouts. */
function corpus(): FixtureCase[] {
	const out: FixtureCase[] = [];
	// A pinned corpus, not a catalog: the reused scratch does not depend on
	// the look, Nebula stands for the art, and a look added here moves the
	// digest below.
	for (const background of ["theme", "outline", "clear", "nebula"] as const) {
		for (const view of ["auto", "rows", "now", "spread"] as const) {
			for (const n of [3, 6, 16, 48]) out.push(groupFixture({ n, view, background, kind: n === 6 ? "clock" : "temp", limits: n === 16 ? { warn: 70, crit: 85 } : undefined, highlight: n === 6 ? 2 : null, paused: view === "spread", layout: n === 3 ? "split" : "whole", encoders: n === 3 ? 4 : 6 }));
		}
		out.push(groupFixture({ n: 32, kind: "clock", view: "rows", background, limits: { warn: 4800, crit: 4700, below: true }, noise: 40, gapEvery: 13 }));
		for (const kind of ["temp", "mixed", "walk"] as const) out.push(ambientFixture({ n: 48, kind, background, stale: kind === "walk" && background === "clear", gapEvery: kind === "mixed" ? 11 : 0, refused: 1, missing: 1 }));
		out.push(ambientFixture({ n: 75, kind: "walk", window: "5m", background, layout: "split" }));
		for (const style of ["trend", "area", "compare", "lanes", "heat", "meters", "events"] as const) {
			for (const extras of [{}, { readout: "left" as const, axes: true }, { readout: "only" as const }]) out.push(fixtureCase({ styles: [style, "trend"], layout: style === "heat" ? "split" : "whole", encoders: 6, background, accent: background === "outline", extras: [extras, extras], paused: style === "lanes" }));
		}
	}
	const all = out.flatMap((c, i) => [c, { id: `${c.id}-states`, input: withStates(c.input) }, ...(i % 3 === 0 ? [{ id: `${c.id}-b4`, input: { ...c.input, bucketPx: 4 as const } }] : [])]);
	return all.map((c, i) => ({ id: `${i}:${c.id}`, input: c.input }));
}

const hashOf = (r: StripSlices): string => `${r.bucketPx} ${r.coarsened} ${r.reduced === true} ${r.maxBytes}\n${renderLogical(r.scene)}\n${r.slices.map((s) => s ?? "-").join("\n")}`;

describe("a strip frame's reused scratch", () => {
	it("draws byte for byte what it drew before its scratch was reused, whatever was drawn in between", () => {
		// The frames run in order, each after a different one; every fourth is
		// drawn again after a frame of a large other group and must match. A
		// frame that coarsened is drawn again from the width it holds, as the
		// controller asks between probes.
		const big = groupFixture({ n: 48, view: "rows", window: "15m", background: "nebula" }).input;
		const hash = createHash("sha256");
		const cases = corpus();
		cases.forEach((c, i) => {
			const first = sliceStrip(c.input);
			hash.update(`${c.id}\n${hashOf(first)}\n`);
			if (first.coarsened) hash.update(`${hashOf(sliceStrip(c.input, first.bucketPx, false))}\n`);
			if (i % 4 !== 0) return;
			sliceStrip(big);
			assert.equal(hashOf(sliceStrip(c.input)), hashOf(first), c.id);
		});
		assert.ok(cases.length > 300);
		assert.equal(hash.digest("hex"), FRAME_DIGEST);
	});

	it("a scene a caller keeps reads the same after later frames of its own group and of another", () => {
		const groups = [groupFixture({ n: 48, view: "rows", background: "nebula", limits: { warn: 70, crit: 85 } }).input, ambientFixture({ n: 48, kind: "walk", background: "theme" }).input, ambientFixture({ n: 24, kind: "mixed", background: "clear" }).input, groupFixture({ n: 32, view: "spread", kind: "clock" }).input, fixtureCase({ styles: ["heat"], layout: "whole", encoders: 6, background: "outline", accent: false }).input];
		for (const [i, input] of groups.entries()) {
			const kept = sliceStrip(input);
			const reference = renderLogical(kept.scene);
			const recut = kept.scene.present.map((here, c) => (here ? sliceScene(kept.scene, c) : null));
			// Later frames of the same group (the data moved on, the ladder
			// tried every width) and of every other group, interleaved.
			for (let k = 1; k <= 4; k++) {
				sliceStrip(later(input, k), kept.bucketPx, k % 2 === 0);
				sliceStrip({ ...later(input, k), bucketPx: 8 });
				const other = groups[(i + k) % groups.length] as StripSceneInput;
				sliceStrip(later(other, k));
			}
			assert.equal(renderLogical(kept.scene), reference, `group ${i}: the kept reference frame`);
			assert.deepEqual(
				kept.scene.present.map((here, c) => (here ? sliceScene(kept.scene, c) : null)),
				recut,
				`group ${i}: slices cut again from the kept scene`
			);
		}
	});
});
