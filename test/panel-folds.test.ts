// Which panel sections a person keeps open, held by the plugin while it
// runs: the app gives every panel fresh web storage, so this memory is what
// carries the folds from key to key. It must keep each kind apart, keep
// junk out, hand out copies and never throw.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PanelFoldMemory, panelKindOf, salvageFolds } from "../src/panel-folds";

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
		assert.equal(Object.keys(salvageFolds(many)).length, 12);
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
