/**
 * No number that can change from one frame to the next straddles a slice
 * seam. The app shows each slice's new picture at its own moment, so a value
 * split by a seam can read half old, half new: a legend value, a Group
 * scale's ends. Words and the limits a person typed (warn and crit labels,
 * the same in every frame) may cross. Scenes: every style, both decks and
 * layouts, readouts, Scale and grid, paused, Group views, and
 * every style as one of several screens with its name and place shown.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixtureCase, groupFixture, readoutMatrix, scaleMatrix, screensMatrix, seamMatrix, type FixtureCase } from "../scripts/lib/strip-fixtures";
import { sliceStrip } from "../src/strip/slicer";
import { inkEdges } from "../src/ui/format";

const SLICE_W = 200;

function scenes(): FixtureCase[] {
	const out: FixtureCase[] = [...seamMatrix(), ...readoutMatrix()];
	for (const encoders of [6, 4] as const) {
		for (const layout of ["whole", "split"] as const) {
			for (const style of ["meters", "events", "trend", "area", "compare", "lanes", "heat"] as const) {
				for (const axes of [false, true]) {
					out.push(fixtureCase({ styles: [style, style], layout, encoders, background: "theme", accent: false, extras: [{ axes }, { axes }] }));
					out.push(fixtureCase({ styles: [style, style], layout, encoders, background: "theme", accent: false, paused: true, extras: [{ axes }, { axes }] }));
				}
			}
			for (const n of [3, 8, 16, 32]) {
				for (const view of ["auto", "rows", "now", "spread"] as const) {
					for (const kind of ["temp", "clock", "usage"] as const) {
						out.push(groupFixture({ n, kind, view, layout, encoders, limits: { warn: 85, crit: 95 } }));
						out.push(groupFixture({ n, kind, view, layout, encoders, paused: true, highlight: 2 }));
					}
				}
			}
		}
	}
	// Strip Screens: every style as screen 2 of 8 with its name and place
	// in the window words ("CPU and GPU · 2 of 8"), on two looks.
	out.push(...screensMatrix().filter((c) => /-(theme|clear)-/.test(c.id)));
	// The Y scale: typed ends on every style that draws a scale (the Lanes
	// captions, the Heat legend, the Meters ends) and passed ends.
	out.push(...scaleMatrix());
	return out;
}

/** A limit label: the threshold a person typed, unchanged between frames. */
const isLimitLabel = (text: string): boolean => /\b(warn|crit)\b/.test(text);

/**
 * Whether the number at [start, end) of a text is a value rather than part of
 * a reading's name: not glued to letters ("T1", "CCD1"), and followed by
 * nothing, a unit, or a separator, never by a further word ("Core 1 T1").
 */
function isValue(text: string, start: number, end: number): boolean {
	if (/[A-Za-z]/.test(text[start - 1] ?? "")) return false;
	const rest = text.slice(end);
	if (!/^ ?[A-Za-z]/.test(rest)) return true;
	return /^ ?(MHz|GHz|kHz|RPM|FPS|ms|W|V|A|x|[KMGT]i?B(\/s)?|[kMG]bps)\b/.test(rest);
}

describe("strip: no changing number straddles a slice seam", () => {
	it("across every style, deck, layout and view", () => {
		const crossings: string[] = [];
		let checked = 0;
		for (const c of scenes()) {
			const { scene } = sliceStrip(c.input);
			for (const p of scene.prims) {
				if (p.k !== "text" || isLimitLabel(p.text)) continue;
				const right = (t: string): number => (t === "" ? 0 : inkEdges([{ text: t, fontSize: p.size, fontWeight: p.weight }], "start", 0).right);
				const start = inkEdges([{ text: p.text, fontSize: p.size, fontWeight: p.weight }], p.anchor, p.x).left - inkEdges([{ text: p.text, fontSize: p.size, fontWeight: p.weight }], "start", 0).left;
				for (const m of p.text.matchAll(/[-+]?\d[\d.,:]*/g)) {
					if (!isValue(p.text, m.index ?? 0, (m.index ?? 0) + m[0].length)) continue;
					checked++;
					const l = start + right(p.text.slice(0, m.index));
					const r = start + right(p.text.slice(0, (m.index ?? 0) + m[0].length));
					for (let x = SLICE_W; x < scene.width; x += SLICE_W) if (l < x && r > x) crossings.push(`${c.id}: "${p.text}" over ${x}`);
				}
			}
		}
		assert.ok(checked > 1000, `values checked: ${checked}`);
		assert.deepEqual(crossings.slice(0, 10), [], `${crossings.length} values straddle a seam`);
	});
});
