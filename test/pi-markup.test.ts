/**
 * Static gates on the shipped panel markup. An aria-describedby target is
 * read out for its content, unless it carries its own aria-label or
 * aria-labelledby: the accessible description then takes that name instead,
 * so a screen reader heard "What the dial does now" for the Gestures select
 * rather than the gesture map written under it (RC review PI-03).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const UI_DIR = fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/", import.meta.url));

describe("panel descriptions are read for their content", () => {
	const panels = readdirSync(UI_DIR).filter((name) => name.endsWith(".html"));

	it("enumerates the shipped panels", () => {
		assert.ok(panels.length >= 4, `expected the shipped panels under ui/, found ${panels.length}`);
	});

	for (const panel of panels) {
		it(`${panel}: every aria-describedby target exists and has no name of its own`, () => {
			const html = readFileSync(join(UI_DIR, panel), "utf8");
			for (const [, ids] of html.matchAll(/aria-describedby="([^"]*)"/g)) {
				for (const id of (ids ?? "").split(/\s+/).filter((part) => part !== "")) {
					const tags = [...html.matchAll(new RegExp(String.raw`<[a-z][\w-]*\b[^>]*\bid="${id}"[^>]*>`, "g"))].map((m) => m[0]);
					assert.equal(tags.length, 1, `${panel}: aria-describedby names #${id}, found ${tags.length} elements with that id`);
					assert.doesNotMatch(tags[0] as string, /\baria-label(?:ledby)?=/, `${panel}: #${id} describes a control but carries its own name: ${tags[0]}`);
				}
			}
		});
	}
});
