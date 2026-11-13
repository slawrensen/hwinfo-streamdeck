// Which panel sections a person keeps open, held by the plugin while it
// runs: the app gives every panel fresh web storage, so this memory is what
// carries the folds from key to key. It must keep each kind apart, keep
// junk out, hand out copies and never throw.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { MAX_SECTIONS, PanelFoldMemory, panelKindOf, salvageFolds } from "../src/panel-folds";

describe("panel folds", () => {
	it("hands the folds a panel stored to the next panel of that kind", () => {
		const memory = new PanelFoldMemory();
		memory.set("key", { "sec-alerts": true, "sec-advanced": false });
		assert.deepEqual(memory.get("key"), { "sec-alerts": true, "sec-advanced": false });
	});

	it("merges a partial update instead of erasing the other sections", () => {
		const memory = new PanelFoldMemory();
		memory.set("key", { "sec-alerts": true, "sec-interaction": true });
		memory.set("key", { "sec-advanced": true, "sec-alerts": false });
		assert.deepEqual(memory.get("key"), { "sec-alerts": false, "sec-interaction": true, "sec-advanced": true });
	});

	it("keeps each kind apart and starts empty", () => {
		const memory = new PanelFoldMemory();
		memory.set("dial", { "sec-interaction": true });
		assert.deepEqual(memory.get("key"), {});
		assert.deepEqual(memory.get("dial"), { "sec-interaction": true });
	});

	it("drops ids and values of the wrong shape", () => {
		assert.deepEqual(salvageFolds({ "sec-alerts": true, "sec-x": "yes", "sec-UPPER": true, advanced: false, "sec-display": false }), { "sec-alerts": true, "sec-display": false });
		for (const junk of [null, 7, "sec-alerts", [true], undefined]) assert.deepEqual(salvageFolds(junk), {});
	});

	it("bounds what one kind can carry", () => {
		const many: Record<string, boolean> = {};
		for (let i = 0; i < 40; i++) many[`sec-${String.fromCharCode(97 + (i % 26))}${"z".repeat(Math.floor(i / 26))}`] = true;
		assert.equal(Object.keys(salvageFolds(many)).length, MAX_SECTIONS);
		assert.equal(MAX_SECTIONS, 24, "more sections than any panel has");
	});

	it("hands out copies, never its own record", () => {
		const memory = new PanelFoldMemory();
		memory.set("key", { "sec-alerts": true });
		memory.get("key")["sec-alerts"] = false;
		assert.deepEqual(memory.get("key"), { "sec-alerts": true });
	});

	it("knows only the three panel kinds", () => {
		assert.equal(panelKindOf("dial"), "dial");
		for (const junk of ["slot", "", "KEY", 1, null]) assert.equal(panelKindOf(junk), undefined);
	});
});

describe("every panel's sections fit the fold memory", () => {
	const dir = fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/", import.meta.url));
	for (const panel of readdirSync(dir).filter((name) => name.endsWith(".html"))) {
		it(`${panel}: every remembered section id is storable, and they all fit`, () => {
			const html = readFileSync(join(dir, panel), "utf8");
			const ids = [...html.matchAll(/<details class="hw-(?:sec|sub)[^"]*" id="([^"]+)"/g)].map((m) => m[1] as string);
			const folds = Object.fromEntries(ids.map((id) => [id, true]));
			assert.deepEqual(Object.keys(salvageFolds(folds)), ids, `${panel}: ${ids.length} sections, at most ${MAX_SECTIONS} are kept`);
		});
	}
});

describe("the shipped panels' sections", () => {
	// Every section a panel sends (pi-shell.js: details.hw-sec[id] and
	// details.hw-sub[id]) must survive the salvage, or its fold is sent and
	// dropped, and only that section forgets whether it was open.
	const UI_DIR = fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/", import.meta.url));
	const panels = readdirSync(UI_DIR).filter((name) => name.endsWith(".html"));

	it("enumerates the shipped panels", () => {
		assert.ok(panels.length >= 4, `expected the shipped panels under ui/, found ${panels.length}`);
	});

	for (const panel of panels) {
		it(`${panel}: every remembered section id survives the salvage, all of them together`, () => {
			const html = readFileSync(join(UI_DIR, panel), "utf8");
			const ids = [...html.matchAll(/<details\b[^>]*>/g)]
				.map((m) => m[0])
				.filter((tag) => /\bclass="[^"]*\bhw-(?:sec|sub)\b[^"]*"/.test(tag))
				.map((tag) => /\bid="([^"]*)"/.exec(tag)?.[1])
				.filter((id): id is string => id !== undefined);
			for (const id of ids) assert.deepEqual(salvageFolds({ [id]: true }), { [id]: true }, `${panel}: #${id} is dropped by the fold salvage`);
			assert.equal(Object.keys(salvageFolds(Object.fromEntries(ids.map((id) => [id, true])))).length, ids.length, `${panel}: more sections than one kind can carry`);
		});
	}
});
