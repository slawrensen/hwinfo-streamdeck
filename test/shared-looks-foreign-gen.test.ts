/**
 * "Use it everywhere" (Advanced, Shared defaults) raises looksResetGen, a
 * count of this PC's own presses, and drops every own Background and Words
 * stamped with an older looksGen (src/ui/shared-looks.ts). The docs promise
 * it "sets every HWiNFO key, dial and strip back to Default for these two
 * choices only" and that only "a choice made after that stays"
 * (docs/themes.md, Per-key vs. shared).
 *
 * An own look can reach this PC already stamped by another PC: a key
 * document copied there and pasted into Replace this key's settings here.
 * That look was chosen before this PC's next press, so that press must set
 * it back to Default.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { staleLooksReset, type LooksKind } from "../src/ui/shared-looks";

const A_GEN = 3;
const KEY = "f0000300:1:1000000";

/** How many presses of Use it everywhere on this PC it takes before the
 * document's own look is dropped (0: never within 20). */
function pressesUntilDropped(doc: Record<string, unknown>, kind: LooksKind, from: number): number {
	for (let gen = from + 1; gen <= from + 20; gen++) if (staleLooksReset(doc, kind, gen) !== undefined) return gen - from;
	return 0;
}

describe("Use it everywhere reaches an own look that came from another PC", () => {
	it("Replace this key's settings with a document copied on another PC: the next press on this PC sets it back to Default", () => {
		// The panel's model, from the shipped bytes (pi-common.js runs it on
		// Replace this key's settings: model.stampOwnLooks(doc, kind, looksResetGen)).
		const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "com.lawrensen.hwinfo.sdPlugin", "ui");
		const scope: { hwModel?: { stampOwnLooks(doc: unknown, kind: string, rawGen: unknown): Record<string, unknown> } } = {};
		new Function("self", readFileSync(path.join(uiDir, "pi-model.js"), "utf8"))(scope);
		const model = scope.hwModel;
		assert.ok(model !== undefined);
		// This PC pressed once before (generation 1); the pasted key came from
		// a PC at generation 3.
		const pasted = { readingKey: KEY, keyBackground: "glass", keyAccentWords: true, looksGen: A_GEN };
		const written = model.stampOwnLooks(pasted, "key", 1);
		// The person presses Use it everywhere on this PC: generation 2.
		const gen = 2;
		assert.notEqual(staleLooksReset(written, "key", gen), undefined, `the pasted key's own Glass should go; it is dropped only at press ${pressesUntilDropped(written, "key", 1)}`);
	});
});
