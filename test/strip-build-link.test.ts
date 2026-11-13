/**
 * One Build screens link in place of Quick setup, on the owner's word,
 * 2026-11-04: "i like the build link keep the existing pattern". These hold
 * what the panel files say once it is in: the select and its six recipes are
 * out, the link sits beside Add a screen and among the tools, and a strip
 * being made has Build's own list with one button and one way out.
 *
 * What the panel does with them runs on the simulated host:
 * scripts/e2e-pi-strip.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadPanelModels } from "./panel-models";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const UI = path.join(ROOT, "com.lawrensen.hwinfo.sdPlugin", "ui");
const ui = (name: string): string => readFileSync(path.join(UI, name), "utf8");
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");

/** The markup from one piece of text up to the next piece. */
function between(html: string, from: string, to: string): string {
	const start = html.indexOf(from);
	assert.ok(start >= 0, `${from} is in the panel`);
	const end = html.indexOf(to, start);
	assert.ok(end > start, `${to} follows ${from}`);
	return html.slice(start, end);
}

describe("Quick setup and its recipes are out", () => {
	it("the panel has no select for them, and no words for them", () => {
		const html = ui("sensor-dial.html");
		assert.doesNotMatch(html, /strip-quick|strip-recipe|pi\.strip\.recipe|Quick setup|Choose a setup/);
		assert.doesNotMatch(ui("pi-strip.js"), /proposeRecipe|applyRecipe|RECIPES|strip-quick|strip-recipe|quickOn/);
		assert.doesNotMatch(ui("pi-strings.js"), /"quickSetup"|"chooseASetup"|"recipe[A-Z]\w*"|"quickWholeOnly"|"quickOneScreen"|"useTheseReadings"|"makeToUse"|"makeToUseScreens"/);
	});

	it("the model keeps what Build reads and drops what only the recipes read", () => {
		const model = loadPanelModels().hwStripModel;
		assert.equal(typeof model.proposeScreens, "function", "Build's own");
		assert.equal(typeof model.buildProposal, "function", "Build's own");
		assert.equal(typeof model.buildScreensOps, "function", "Build's own");
		assert.equal(model.RECIPES, undefined);
		assert.equal(model.proposeRecipe, undefined);
		assert.equal(model.applyRecipe, undefined);
	});

	it("no document of 1.8 names it", () => {
		const notes = read("CHANGELOG.md");
		assert.doesNotMatch(notes.slice(0, notes.indexOf("## 1.7.1.0")), /Quick setup/);
		assert.doesNotMatch(read("docs", "strip-display.md"), /Quick setup/);
		assert.doesNotMatch(read("docs", "changelog.md"), /Quick setup/);
	});
});

describe("the Build screens link", () => {
	it("sits with Add a screen on the row that names the screen", () => {
		const head = between(ui("sensor-dial.html"), 'class="hw-strip-screen-head"', 'id="strip-screen-pick"');
		const add = head.indexOf('id="strip-add-screen"');
		const build = head.indexOf('id="strip-build"');
		assert.ok(add >= 0 && build > add, "Build screens right after Add a screen");
		assert.match(head, /<button type="button" class="hw-link[^"]*" id="strip-build"[^>]*data-l10n="pi\.strip\.buildLink"[^>]*>Build screens<\/button>/);
	});

	it("is among the screen tools once there are several screens", () => {
		const tools = between(ui("sensor-dial.html"), 'id="strip-screen-tools"', "</div>");
		assert.deepEqual([...tools.matchAll(/data-tool="(\w+)"/g)].map((m) => m[1]), ["rename", "earlier", "later", "remove", "add", "build"]);
	});

	it("opens Build's own list, which holds the one button and the one way out", () => {
		const box = between(ui("sensor-dial.html"), 'id="strip-build-box"', 'id="strip-edit"');
		for (const id of ["strip-build-title", "strip-build-list", "strip-build-use", "strip-build-no"]) assert.ok(box.includes(`id="${id}"`), id);
		assert.match(ui("pi-strings.js"), /"oneReadingOnly": "One reading only"/);
	});
});

describe("the running strip's rows share a line where they fit", () => {
	const html = ui("sensor-dial.html");
	it("Graph with its View or Readout", () => {
		const row = between(html, 'class="hw-strip-graph-row" id="sp0-graph-row"', 'id="sp0-from-item"');
		for (const id of ["sp0-style", "sp0-view", "sp0-readout"]) assert.ok(row.includes(`id="${id}"`), id);
	});
	it("Scale and alerts with Strip Link ID", () => {
		const row = between(html, 'class="hw-strip-folds"', 'id="strip-bar"');
		assert.ok(row.indexOf('id="sec-stripmore"') >= 0 && row.indexOf('id="sec-striplink"') > row.indexOf('id="sec-stripmore"'));
	});
	it("nothing a running strip has is lost", () => {
		for (const id of ["strip-add-screen", "strip-window", "strip-cycle", "sp0-style", "sp0-readout", "sp0-search", "sec-stripmore", "sec-striplink", "strip-screen-edit"]) assert.ok(html.includes(`id="${id}"`), id);
	});
});
