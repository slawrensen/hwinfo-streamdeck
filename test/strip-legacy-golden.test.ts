/**
 * Strip output from before the readout layouts and the Scale overlay,
 * locked byte for byte: a group whose stored config has
 * none of those fields must draw exactly what 1.8.0.0 drew. The golden holds
 * one SHA-256 per scene over every slice and the full-width reference, for
 * the whole seam matrix (5 styles x 10 looks x 2 decks x 2 layouts), paused
 * frames, partial groups and Segoe UI.
 *
 * The golden was written from the 1.8.0.0 candidate (b3e7c8d) with
 * STRIP_GOLDEN_WRITE=1 and regenerated on purpose on 2026-10-26, when the
 * rows moved over the graph on smoke and other units took bands of their
 * own (strips had not shipped yet), and again on 2026-10-28 for Glass
 * only, when the strip's alert colors took their floor on the look's
 * surface (stripAlertColors: 50 Glass scenes, alert colors only), and a
 * third time on 2026-10-28 for the same 50 Glass scenes, when that lift
 * took a held CIELAB hue in place of a mix toward white (alert colors
 * only), and on 2026-10-28 for the 66 scenes with a Heat pane on every
 * look, when a crit cap became twice a warn cap (the caps' height only),
 * and on 2026-10-28 for every scene, when the words over the graph took
 * Outline's 1 px edge in place of the smoke (the same 230 scenes the
 * change moved on its own branch), and on 2026-10-28 for every scene (230
 * of 230), when the Y scale went calm (src/strip/scale.ts): automatic ends
 * on round numbers at least the unit's calm span apart (a flat 50 °C on 48
 * to 53, Heat's legend on 60 to 100 where it printed 60.6 to 99.0), Lanes
 * rounded on three ticks with Scale and grid off too, and the row words
 * starting after an end column reserved for the stored setup, one digit
 * wider than its ends, so they no longer move when an end changes width
 * (reviewed scene by scene against lane26/integration d9c534a: end texts
 * where the calm span or the rounding changed them, the row words' x, and
 * the lines on the new scales), and on 2026-11-04 for 160 scenes on Glass,
 * Tint, Outline and Clear, when the words over a graph took their small
 * tabs (WORD_TAB; all 230 scenes, drawn without the tabs, still hashed to
 * what was recorded here), and on 2026-11-04 for the 66 scenes with a
 * Lanes pane, when a lane with Scale and grid off asks for six ticks (its
 * line on a tighter scale; every id checked to name lanes), and for the 66
 * scenes with a Trend of two, when the names row stopped repeating the value
 * shown large (the names after it and their chips move left, nothing else);
 * never regenerate it to make a change pass.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fixtureCase, seamMatrix, STRIP_STYLES_ALL, type FixtureCase } from "../scripts/lib/strip-fixtures";
import { setFaceFont } from "../src/ui/face-font";
import { renderLogical } from "../src/strip/scene";
import { sliceStrip } from "../src/strip/slicer";

const GOLDEN = new URL("./golden/strip-legacy-slices.json", import.meta.url);

function cases(): { font: "tahoma" | "segoe-ui"; c: FixtureCase; id: string }[] {
	const out: { font: "tahoma" | "segoe-ui"; c: FixtureCase; id: string }[] = [];
	for (const c of seamMatrix()) out.push({ font: "tahoma", c, id: c.id });
	for (const style of STRIP_STYLES_ALL) {
		for (const encoders of [4, 6] as const) {
			const paused = fixtureCase({ styles: [style], layout: "whole", encoders, background: "glass", accent: false, paused: true });
			out.push({ font: "tahoma", c: paused, id: `${paused.id}-paused` });
			const partial = fixtureCase({ styles: [style, style], layout: "split", encoders, background: "theme", accent: false, present: encoders === 4 ? [true, false, true, true] : [true, true, false, true, true, false] });
			out.push({ font: "tahoma", c: partial, id: `${partial.id}-partial` });
			const segoe = fixtureCase({ styles: [style], layout: "whole", encoders, background: "outline", accent: true, window: "1m" });
			out.push({ font: "segoe-ui", c: segoe, id: `${segoe.id}-segoe` });
		}
	}
	return out;
}

function hashOf(c: FixtureCase): string {
	const r = sliceStrip(c.input);
	return createHash("sha256")
		.update([renderLogical(r.scene), ...r.slices.map((s) => s ?? "(absent)")].join("\n"))
		.digest("hex");
}

function hashes(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const { font, c, id } of cases()) {
		setFaceFont(font);
		out[id] = hashOf(c);
	}
	setFaceFont("tahoma");
	return out;
}

describe("strip output without the new fields is 1.8.0.0's, byte for byte", () => {
	const now = hashes();
	if (process.env.STRIP_GOLDEN_WRITE === "1") writeFileSync(GOLDEN, `${JSON.stringify(now, null, "\t")}\n`);
	const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;

	it("covers every scene the golden holds", () => {
		assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
		assert.equal(Object.keys(golden).length, 230);
	});

	it("every scene draws the same bytes", () => {
		const changed = Object.keys(golden).filter((id) => now[id] !== golden[id]);
		assert.deepEqual(changed, []);
	});
});
