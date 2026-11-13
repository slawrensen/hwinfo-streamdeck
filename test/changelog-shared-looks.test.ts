/**
 * The 1.8.0.0 CHANGELOG Compatibility section against the shared looks code
 * (src/ui/shared-looks.ts, Advanced, Shared defaults, "Use it everywhere").
 *
 * The section says 1.8 only adds settings, and what going back to 1.7.1
 * draws. "Use it everywhere" removes a dial's own dialBackground and
 * dialAccentWords, two fields 1.7.1 reads (bb4aede src/actions/sensor-dial.ts
 * lines 156 and 164, read through dialBackgroundOf and dialAccentWordsOf,
 * with no shared default). A dial whose own 1.7.1 look was removed, or that
 * was left on Default under a shared look, draws Theme after going back.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { staleLooksReset } from "../src/ui/shared-looks";

/** 1.7.1's one reader of a dial's dialBackground, copied from bb4aede
 * src/ui/dial-background.ts line 39. */
function v171DialBackgroundOf(raw: unknown): string {
	return raw === "glass" || raw === "tint" || raw === "outline" || raw === "clear" ? raw : "theme";
}

/** 1.7.1's one reader of a dial's dialAccentWords (bb4aede line 46). */
function v171DialAccentWordsOf(raw: unknown): boolean {
	return raw === true;
}

const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const entryStart = changelog.indexOf("\n## 1.8.0.0 - ");
assert.ok(entryStart >= 0, "the CHANGELOG has a 1.8.0.0 entry");
const entryEnd = changelog.indexOf("\n## ", entryStart + 1);
const entry = changelog.slice(entryStart, entryEnd < 0 ? undefined : entryEnd);
const compatStart = entry.indexOf("\nCompatibility:\n");
assert.ok(compatStart >= 0, "the 1.8.0.0 entry has a Compatibility section");
const compatEnd = entry.indexOf("\nChecked so far:", compatStart);
const compat = entry.slice(compatStart, compatEnd < 0 ? undefined : compatEnd);
/** The section's bullets, each on one line with its whitespace collapsed. */
const bullets = compat
	.split(/\n- /)
	.slice(1)
	.map((b) => b.replace(/\s+/g, " ").trim());
const compatText = bullets.join(" ");

describe("CHANGELOG 1.8.0.0 Compatibility: the shared Background and Words", () => {
	it("Use it everywhere removes a 1.7.1 dial field, and the section that says 1.8 only adds settings says so", () => {
		const v171Dial = { readingKey: "0:0:1", dialBackground: "tint", dialAccentWords: true };
		const after = staleLooksReset(v171Dial, "dial", 1);
		assert.ok(after !== undefined, "the reset writes this dial");
		assert.equal(Object.hasOwn(after, "dialBackground"), false, "the reset removes dialBackground");
		assert.equal(v171DialBackgroundOf(v171Dial.dialBackground), "tint");
		assert.equal(v171DialBackgroundOf(after.dialBackground), "theme", "1.7.1 draws Theme after the reset");
		assert.equal(v171DialAccentWordsOf(after.dialAccentWords), false, "1.7.1 draws plain words after the reset");
		assert.match(compatText, /only adds settings/);
		assert.match(compatText, /Use it everywhere[^.]*removes fields/, "Compatibility says 1.8 only adds settings and never says Use it everywhere removes fields");
	});

	it("Going back to 1.7.1 says what a dial left on Default under a shared look draws", () => {
		// A dial on Default follows the shared look in 1.8; 1.7.1 reads only the dial's own field.
		assert.equal(v171DialBackgroundOf(undefined), "theme");
		const goingBack = bullets.find((b) => b.startsWith("Going back to 1.7.1"));
		assert.ok(goingBack !== undefined, "a Going back to 1.7.1 bullet");
		assert.match(goingBack, /\bdials?\b[^;.]*\b(background|Theme)\b/i, "Going back to 1.7.1 says only that keys draw the theme's background");
	});
});
