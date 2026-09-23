/**
 * The panel's pure model (ui/pi-model.js): section summaries that must
 * describe effective behavior truthfully, and the lossless write helpers
 * that keep stored fields, entries and metadata this build does not know.
 * The file is a plain browser script; it is evaluated here against a stub
 * `self`, the same bytes the panels load.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

type Settings = Record<string, unknown>;
type Model = {
	readingSummary(kind: string, settings: Settings, preview: unknown, labelOf: (key: string) => string | null): string;
	displaySummary(kind: string, settings: Settings, globals: Settings, preview: unknown): string;
	alertsSummary(kind: string, settings: Settings, preview: unknown): string;
	keyInteractionSummary(settings: Settings): string;
	dialInteractionSummary(settings: Settings, preview: unknown): string;
	controlSummary(settings: Settings): { command: string; target: string };
	advancedSummary(globals: Settings): string;
	splitKeyList(raw: unknown, cap?: number): { known: string[]; kept: unknown[] };
	patchEntry(raw: unknown, base: unknown, current: Record<string, unknown>, fields: string[]): Record<string, unknown>;
	patchNames(raw: unknown, key: string, name: string): Record<string, unknown>;
	patchColors(raw: unknown, updates: Record<number, string>, defaults: string[]): unknown[];
};

const source = readFileSync(fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/pi-model.js", import.meta.url)), "utf8");
const scope: { hwModel?: Model } = {};
new Function("self", source)(scope);
const model = scope.hwModel as Model;
const noLabel = (): null => null;

const effective = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	theme: { id: "void", drawn: "void", own: false, unknown: false },
	text: { mode: "theme", applied: "theme", own: false, color: null, dimSecondary: false },
	typeAccents: true,
	dataUnits: "decimal",
	alert: { level: "normal", warn: null, crit: null, below: false, unit: "°C", applies: true, scopeUnit: null },
	...over
});

describe("reading summary", () => {
	it("says when nothing is selected", () => {
		assert.equal(model.readingSummary("key", {}, null, noLabel), "No reading selected");
	});
	it("names a missing reading only when the plugin reports it missing", () => {
		assert.equal(model.readingSummary("key", { readingKey: "a:0:1" }, { state: "ok", missing: true }, noLabel), "Saved reading not found in HWiNFO");
	});
	it("never calls an unknown reading missing while HWiNFO is unavailable", () => {
		const text = model.readingSummary("key", { readingKey: "a:0:1" }, { state: "unavailable", missing: false }, noLabel);
		assert.equal(text, "Saved reading");
	});
	it("prefers the custom label and reports the drawn layout honestly", () => {
		const preview = { state: "ok", missing: false, reading: { label: "CPU", source: "S" }, effective: effective({ layout: { chosen: "quad", drawn: "single" } }) };
		assert.equal(model.readingSummary("key", { readingKey: "a", keyLayout: "quad", label: "Mine" }, preview, noLabel), "Four readings, quad grid chosen; shows one reading until another is picked");
		const drawn = { ...preview, effective: effective({ layout: { chosen: "quad", drawn: "quad" } }) };
		assert.equal(model.readingSummary("key", { readingKey: "a", secondaryReadingKey: "b", keyLayout: "quad" }, drawn, noLabel), "Four readings, quad grid · 2 picked");
	});
	it("tells the dial's current reading apart from its rotation membership", () => {
		const preview = { state: "ok", missing: false, reading: { label: "GPU", source: "S" } };
		assert.equal(model.readingSummary("dial", { readingKey: "g", rotationKeys: ["g", "h", "i"] }, preview, noLabel), "GPU · rotation: 3 readings");
		assert.equal(model.readingSummary("dial", { readingKey: "g", rotationGroups: [{ keys: ["g"] }, { keys: ["h"] }] }, preview, noLabel), "GPU · rotation: 2 groups");
		assert.equal(model.readingSummary("dial", { readingKey: "g" }, preview, noLabel), "GPU · rotation: this sensor's readings");
	});
});

describe("display summary", () => {
	it("marks inherited choices as shared and own choices without the mark", () => {
		const shared = model.displaySummary("key", {}, {}, { effective: effective({ text: { mode: "dim", applied: "dim", own: false, color: null, dimSecondary: false } }) });
		assert.equal(shared, "Current value · auto decimals · Void (shared) · dimmed text (shared)");
		const own = model.displaySummary("key", { statMode: "max", decimals: "1" }, {}, { effective: effective({ theme: { id: "ember", drawn: "ember", own: true, unknown: false }, text: { mode: "custom", applied: "custom", own: true, color: "#8A2B2B", dimSecondary: true } }) });
		assert.equal(own, "Maximum · 1 decimals · Ember · custom text #8A2B2B");
	});
	it("reports what is drawn when Custom has no valid color", () => {
		const text = model.displaySummary("key", { textMode: "custom", textColor: "red" }, {}, { effective: effective({ text: { mode: "custom", applied: "theme", own: true, color: null, dimSecondary: false } }) });
		assert.match(text, /theme text$/);
	});
	it("names the dial view instead of a stat", () => {
		assert.match(model.displaySummary("dial", { dialView: "tworow" }, {}, null), /^Overview, two rows · auto decimals/);
	});
	it("says only what is stored when the plugin has not answered", () => {
		assert.equal(model.displaySummary("key", { theme: "paper" }, {}, null), "Current value · auto decimals · Paper · shared text");
	});
});

describe("alerts summary", () => {
	it("uses the runtime's at-or-beyond operator, units and scope", () => {
		const above = model.alertsSummary("key", {}, { effective: effective({ alert: { level: "normal", warn: 80, crit: 90, below: false, unit: "°C", applies: true, scopeUnit: null } }) });
		assert.equal(above, "Warn ≥ 80 °C · critical ≥ 90 °C");
		const below = model.alertsSummary("key", {}, { effective: effective({ alert: { level: "crit", warn: null, crit: 800, below: true, unit: "RPM", applies: true, scopeUnit: null } }) });
		assert.equal(below, "Critical ≤ 800 RPM · critical now");
	});
	it("names the dial's unit scope and a multi-reading key's first-reading rule", () => {
		const dial = model.alertsSummary("dial", {}, { effective: effective({ alert: { level: "normal", warn: 70, crit: null, below: false, unit: "°C", applies: true, scopeUnit: "°C" } }) });
		assert.equal(dial, "Warn ≥ 70 °C · °C readings only");
		const quad = model.alertsSummary("key", {}, { effective: effective({ layout: { chosen: "quad", drawn: "quad" }, alert: { level: "warn", warn: 1, crit: null, below: false, unit: "V", applies: true, scopeUnit: null } }) });
		assert.equal(quad, "Warn ≥ 1 V · first reading · warning now");
	});
	it("says Off, and says when typed values are not numbers", () => {
		assert.equal(model.alertsSummary("key", {}, { effective: effective() }), "Off");
		assert.equal(model.alertsSummary("key", { warnValue: "hot" }, { effective: effective() }), "Off: the values entered are not numbers");
	});
});

describe("interaction summaries", () => {
	it("lets the Back role win over any stored press behavior", () => {
		assert.equal(model.keyInteractionSummary({ detailRole: "back", pressBehavior: "open-details" }), "Press returns to the previous profile (Back tile)");
		assert.equal(model.keyInteractionSummary({ detailRole: "future", pressBehavior: "junk" }), "Press cycles current, min, max, avg");
	});
	it("describes the details destination", () => {
		assert.equal(model.keyInteractionSummary({ pressBehavior: "open-details", detailMode: "custom", detailKeys: ["a", "b", "a", 3] }), "Press opens details: custom list of 2");
		assert.equal(model.keyInteractionSummary({ pressBehavior: "tap-cycle-hold-details", detailMode: "filter", detailFilter: " *gpu* " }), 'Tap cycles; hold opens details: filter "*gpu*"');
	});
	it("reads the dial's resolved scheme and names a dead tap", () => {
		const controls = { preset: "custom", rotate: "step", pressedRotate: "step", shortPress: "pin", longPress: "resetStats", tap: "cycleStat", touchHold: "backToCurrent", touchZones: "two", switchesGroups: false };
		assert.equal(model.dialInteractionSummary({ autoCycleMs: "30000" }, { effective: { controls } }), "Custom: turn cycles readings · push pins the reading · touch sides switch readings · auto cycle 30 s");
		assert.equal(model.dialInteractionSummary({ rotationDisabled: true }, null), "Legacy controls · turns ignored");
	});
	it("follows the Control action's rules for command and target", () => {
		assert.deepEqual(model.controlSummary({}), { command: "Next reading", target: "every dial" });
		assert.deepEqual(model.controlSummary({ command: "resetStats", resetScope: "all", target: "x" }), { command: "Reset session stats", target: "every dial on every Stream Deck (Target ignored)" });
		assert.deepEqual(model.controlSummary({ command: "resetStats", target: " cpu " }), { command: "Reset session stats, current reading", target: 'dials with Link ID "cpu"' });
		assert.match(model.controlSummary({ command: "warp" }).command, /^Unknown command/);
	});
	it("summarizes the shared connection choices", () => {
		assert.equal(model.advancedSummary({}), "Auto source · poll 1 s · decimal data units");
		assert.equal(model.advancedSummary({ source: "gadget", pollIntervalMs: "250", dataUnits: "binary" }), "Gadget only · poll 250 ms · binary data units");
	});
});

describe("lossless write helpers", () => {
	it("keeps list entries this build does not edit", () => {
		assert.deepEqual(model.splitKeyList(["a", 7, "", "b", { future: 1 }, "c"], 2), { known: ["a", "b"], kept: [7, "", { future: 1 }, "c"] });
		assert.deepEqual(model.splitKeyList("junk"), { known: [], kept: [] });
	});
	it("rewrites only the fields an edit changed", () => {
		const raw = { name: "CPU", keys: ["a"], futureGroupField: { deep: [1] } };
		const base = { name: "CPU", keys: ["a"] };
		assert.deepEqual(model.patchEntry(raw, base, { name: "CPU", keys: ["a", "b"] }, ["name", "keys"]), { name: "CPU", keys: ["a", "b"], futureGroupField: { deep: [1] } });
		const junk = { size: 4, labels: "ABCD", extra: true };
		assert.deepEqual(model.patchEntry(junk, { size: 4, labels: ["", "", "", ""] }, { size: 4, labels: ["", "", "", ""] }, ["size", "labels"]), junk);
		assert.deepEqual(model.patchEntry(null, null, { size: 1 }, ["size"]), { size: 1 });
	});
	it("sets or removes one name and leaves junk entries alone", () => {
		assert.deepEqual(model.patchNames({ a: "A", b: 5 }, "c", "C"), { a: "A", b: 5, c: "C" });
		assert.deepEqual(model.patchNames({ a: "A", b: 5 }, "a", ""), { b: 5 });
	});
	it("sets color indices, keeps entries past them, fills gaps with defaults", () => {
		assert.deepEqual(model.patchColors(["#111111", "bad", "#333333", "#444444", "#FUTURE"], { 1: "#222222" }, ["d0", "d1", "d2", "d3"]), ["#111111", "#222222", "#333333", "#444444", "#FUTURE"]);
		assert.deepEqual(model.patchColors(undefined, { 2: "#ABCDEF" }, ["d0", "d1", "d2", "d3"]), ["d0", "d1", "#ABCDEF"]);
	});
});
